/***********************
 * Firebase helpers
 ***********************/
import {
  doc, setDoc, getDoc, updateDoc, onSnapshot,
  collection, getDocs, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));
const pad = n => String(n).padStart(2,"0");

let MODE = "admin";              // 'admin' | 'student'
let roomId = "";
let me = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;

const els = {
  // 공통
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnSignOut: $("#btnSignOut"),
  roomStatus: $("#roomStatus"),
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"), pOptions: $("#panelOptions"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),
  studentPanel: $("#studentPanel"),
  adminTop: $(".topbar"),

  // 빌더
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"),
  builder: $("#builder"),
  fileUploadTxt: $("#fileUploadTxt"), btnUploadTxt: $("#btnUploadTxt"), btnDownloadTemplate: $("#btnDownloadTemplate"),

  // 옵션
  policyDevice: $("#policyDevice"), policyName: $("#policyName"),
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright: $("#chkBright"),
  timerSec: $("#timerSec"), btnSaveOptions: $("#btnSaveOptions"), btnResetAll: $("#btnResetAll"),
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),
  studentAccessBlock: $("#studentAccessBlock"),

  // 프레젠테이션
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pImg: $("#pImg"), pOpts: $("#pOpts"),
  cntJoin: $("#cntJoin"), cntSubmit: $("#cntSubmit"), cntOK: $("#cntOK"), cntNG: $("#cntNG"),
  leftSec: $("#leftSec"),

  // 결과
  btnExportCSV: $("#btnExportCSV"), btnResetScore: $("#btnResetScore"), resultsTable: $("#resultsTable"), progress: $("#progress"),

  // 학생
  joinDialog: $("#joinDialog"), studentStatus: $("#studentStatus"),
  studentName: $("#studentName"), btnJoin: $("#btnJoin"),
  badgeType: $("#badgeType"), sQText: $("#sQText"), sImg: $("#sImg"),
  mcqBox: $("#mcqBox"), shortBox: $("#shortBox"), shortInput: $("#shortInput"), btnShortSend: $("#btnShortSend"),
  studentEnd: $("#studentEnd"), btnMyResult: $("#btnMyResult"), studentTimer: $("#studentTimer"),
};

function hideAdminUI(isStudent){
  // 상단바·탭 전체 감춤
  if(els.adminTop){
    els.adminTop.classList.toggle("hide", !!isStudent);
    // 패널도 학생/관리자 모드에 맞춰 노출
    els.pBuild?.classList.toggle("hide", !!isStudent);
    els.pOptions?.classList.toggle("hide", !!isStudent);
    els.pPresent?.classList.toggle("hide", !!isStudent);
    els.pResults?.classList.toggle("hide", !!isStudent);
  }
  // 학생 전용 패널
  els.studentPanel?.classList.toggle("hide", !isStudent);
}

function setMode(m){
  MODE = m;
  hideAdminUI(MODE==="student");
  // 옵션 탭에서만 학생 접속 블록 보이기(관리자모드 전용)
  if(MODE==="admin"){
    els.studentAccessBlock?.classList.toggle("hide", els.tabOptions?.classList.contains("active")?false:true);
  }
}

/***********************
 * Local cache
 ***********************/
function saveLocal(){ localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me })); }
function loadLocal(){
  try{
    const d=JSON.parse(localStorage.getItem("quiz.live")||"{}");
    roomId=d.roomId||""; MODE=d.MODE||"admin"; me=d.me||{id:null,name:""};
    if(roomId && els.roomId) els.roomId.value=roomId;
  }catch{}
}

/***********************
 * Firestore refs
 ***********************/
const roomRef = (id)=>doc(window.db,"rooms",id);
const respCol = (id)=>collection(window.db,"rooms",id,"responses");

async function ensureRoom(id){
  const snap=await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션", mode:"idle", currentIndex:-1,
      accept:false, reveal:false, bright:false, timer:30,
      createdAt: serverTimestamp(), questions:[]
    });
  }
}

function listenRoom(id){
  unsubRoom && unsubRoom();
  unsubRoom = onSnapshot(roomRef(id),(snap)=>{
    if(!snap.exists()) return;
    const r=snap.data(); window.__room=r;
    renderRoom(r);
  });
}
function listenResponses(id){
  unsubResp && unsubResp();
  unsubResp = onSnapshot(respCol(id),(qs)=>{
    const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    renderResponses(arr);
  });
}

/***********************
 * URL 모드 & 연결
 ***********************/
function buildStudentURL(id){
  const u=new URL(location.href);
  u.searchParams.set("role","student");
  u.searchParams.set("room",id);
  return u.toString();
}
function buildQR(){
  if(!els.studentLink) return;
  const url=buildStudentURL(roomId);
  els.studentLink.value=url;
  if(window.QRCode && els.qrCanvas){
    QRCode.toCanvas(els.qrCanvas,url,{width:140},(e)=>e&&console.warn(e));
  }
}

async function connect(){
  const id=(els.roomId?.value||"").trim();
  if(!id) return alert("세션 코드를 입력하세요.");
  roomId=id;
  await ensureRoom(roomId);
  listenRoom(roomId); listenResponses(roomId);
  if(els.roomStatus) els.roomStatus.textContent=`세션: ${roomId} · 온라인`;
  els.btnSignOut?.classList.remove("hide");
  els.roomId?.setAttribute("disabled","disabled");
  buildQR();
  saveLocal();
}
function signOut(){
  roomId=""; saveLocal();
  els.roomId?.removeAttribute("disabled");
  els.roomStatus && (els.roomStatus.textContent="세션: - · 오프라인");
  els.btnSignOut?.classList.add("hide");
  unsubRoom && unsubRoom(); unsubResp && unsubResp();
}

/***********************
 * 빌더
 ***********************/
function cardRow(no,q){
  const wrap=document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="radio"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'} /> 객관식</label>
      <label class="radio"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''} /> 주관식</label>
      <label class="radio right"><input type="file" accept="image/*" data-img="${no}" class="hide" /><button class="btn ghost" data-imgbtn="${no}">이미지</button></label>
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항 내용" value="${q?.text||''}" />
    <img class="qthumb ${q?.imageUrl?'':'hide'}" data-thumb="${no}" src="${q?.imageUrl||''}" alt="" />
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기 ${i+1}" value="${v}">`).join('')}
      </div>
      <div class="row">
        <span class="muted">정답 번호</span>
        <input class="ansIndex input sm" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
      </div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <input class="ansText input" data-no="${no}" placeholder="정답(선택)" value="${q?.answerText||''}">
    </div>
  `;
  // 타입 토글
  const radios=$$(`input[name="type-${no}"]`,wrap);
  const mcq=$(".mcq",wrap), short=$(".short",wrap);
  radios.forEach(r=>r.addEventListener("change",()=>{
    const isShort = radios.find(x=>x.checked)?.value==='short';
    mcq.classList.toggle("hide", isShort);
    short.classList.toggle("hide", !isShort);
  }));
  // 이미지 버튼
  const f=$(`input[data-img="${no}"]`,wrap);
  const b=$(`button[data-imgbtn="${no}"]`,wrap);
  const th=$(`img[data-thumb="${no}"]`,wrap);
  b.addEventListener("click",()=>f.click());
  f.addEventListener("change",async (e)=>{
    const file=e.target.files?.[0]; if(!file) return;
    const url=URL.createObjectURL(file);
    th.src=url; th.classList.remove("hide");
    th.dataset.temp=url; // 저장 시 반영(간단 버전: data URL/Blob URL 그대로 사용)
  });
  return wrap;
}
function collectBuilder(){
  const cards=$$("#builder>.qcard");
  const list=cards.map((c,idx)=>{
    const no=idx+1;
    const type=c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text=c.querySelector(".qtext").value.trim();
    const th=c.querySelector(`[data-thumb="${no}"]`);
    const imageUrl = th && !th.classList.contains("hide") ? th.src : "";
    if(!text) return null;
    if(type==='mcq'){
      const opts=$$(".opt",c).map(i=>i.value.trim()).filter(Boolean);
      const ans = Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans, imageUrl };
    } else {
      return { type:'short', text, answerText:c.querySelector(".ansText").value.trim(), imageUrl };
    }
  }).filter(Boolean);
  return { title: els.quizTitle?.value||"퀴즈", questions:list };
}

/***********************
 * 진행 & 타이머
 ***********************/
async function startQuiz(){ await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true }); }
async function step(delta){
  await runTransaction(window.db, async (tx)=>{
    const snap=await tx.get(roomRef(roomId));
    const r=snap.data(); const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){ // 종료
      tx.update(roomRef(roomId), { currentIndex: total-1, mode:"ended", accept:false });
      return;
    }
    next=Math.max(0,next);
    tx.update(roomRef(roomId), { currentIndex: next, accept:true });
  });
}
async function finishAll(){ if(confirm("퀴즈를 종료할까요?")) await updateDoc(roomRef(roomId), { mode:"ended", accept:false }); }

function startTimer(sec){
  stopTimer();
  const end = Date.now()+sec*1000;
  timerHandle=setInterval(()=>{
    const remain=Math.max(0, Math.floor((end-Date.now())/1000));
    els.leftSec && (els.leftSec.textContent = `${pad(Math.floor(remain/60))}:${pad(remain%60)}`);
    if(MODE==='student') els.studentTimer.textContent=els.leftSec.textContent;
    if(remain<=0){ stopTimer(); updateDoc(roomRef(roomId), { accept:false }); setTimeout(()=>step(+1),500); }
  },250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } els.leftSec && (els.leftSec.textContent="00:00"); }

/***********************
 * 제출/채점
 ***********************/
async function join(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name=(els.studentName?.value||"").trim(); if(!name) return alert("이름을 입력하세요.");
  me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem("quiz.device", me.id);
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{}, alive:true }, { merge:true });
  els.joinDialog.close();
  els.studentStatus.textContent="참가 완료! 제출 버튼을 눌러주세요. 교사가 시작하면 1번 문항이 표시됩니다.";
  saveLocal();
}
async function submit(value){
  const r=window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
  const ref=doc(respCol(roomId), me.id);
  const snap=await getDoc(ref); const prev=snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert("이미 제출했습니다.");
  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true), revealed:r.reveal||false } }, { merge:true });
}

/***********************
 * 렌더링
 ***********************/
function renderRoom(r){
  // 옵션 반영
  if(els.chkAccept) els.chkAccept.checked=!!r.accept;
  if(els.chkReveal) els.chkReveal.checked=!!r.reveal;

  // 프레젠테이션 보드
  els.pTitle && (els.pTitle.textContent = r.title||roomId);
  const idx=r.currentIndex; const total=r.questions?.length||0;
  if(idx==null || idx<0 || r.mode!=="active"){
    els.pQ && (els.pQ.textContent = "시작 버튼을 누르면 문항이 제시됩니다.");
    els.pImg?.classList.add("hide"); els.pImg.removeAttribute("src");
    els.pOpts && (els.pOpts.innerHTML="");
  }else{
    const q=r.questions[idx];
    els.pQ && (els.pQ.textContent=q.text||"-");
    // 이미지 안전 표시
    if(q.imageUrl){ els.pImg.src=q.imageUrl; els.pImg.classList.remove("hide"); }
    else { els.pImg.classList.add("hide"); els.pImg.removeAttribute("src"); }
    // 보기도 렌더
    if(q.type==='mcq'){
      els.pOpts.innerHTML="";
      q.options.forEach((t,i)=>{ const d=document.createElement("div"); d.className="popt"; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d); });
    }else{ els.pOpts.innerHTML=""; }
  }

  // 학생 화면
  if(MODE==='student'){
    // 대기/종료 안내
    if(r.mode==='ended'){
      $("#sQText").textContent="퀴즈가 종료되었습니다!";
      els.mcqBox.innerHTML=""; els.shortBox.classList.add("hide");
      els.studentEnd.classList.remove("hide");
      return;
    }
    if(r.mode!=='active' || idx<0){
      els.badgeType.textContent="대기";
      els.sQText.textContent="대기 중… 교사가 시작하면 1번 문항이 표시됩니다.";
      els.mcqBox.innerHTML=""; els.shortBox.classList.add("hide");
      return;
    }
    // 현재 문항
    const q=r.questions[idx];
    els.badgeType.textContent = q.type==='mcq'?'객관식':'주관식';
    els.sQText.textContent = q.text;
    if(q.imageUrl){ els.sImg.src=q.imageUrl; els.sImg.classList.remove("hide"); }
    else { els.sImg.classList.add("hide"); els.sImg.removeAttribute("src"); }

    if(q.type==='mcq'){
      els.mcqBox.innerHTML="";
      q.options.forEach((opt,i)=>{
        const b=document.createElement("button");
        b.className="optbtn"; b.textContent=`${i+1}. ${opt}`; b.disabled=!r.accept;
        b.addEventListener("click", ()=>{
          // 보기 선택 후 제출 버튼 한 번만 생성
          [...els.mcqBox.querySelectorAll(".optbtn")].forEach(x=>x.classList.remove("selected"));
          b.classList.add("selected");
          renderSubmitButton(()=>submit(i));
        });
        els.mcqBox.appendChild(b);
      });
      els.shortBox.classList.add("hide");
    } else {
      els.mcqBox.innerHTML="";
      els.shortBox.classList.remove("hide");
      els.btnShortSend.disabled=!r.accept;
    }
  }

  // 진행 현황
  if(els.progress) els.progress.textContent = `${Math.max(0,(idx??-1)+1)}/${total}`;
}

function renderSubmitButton(onSubmit){
  // 중복 제출 버튼 제거 후 1개만
  const old=$("#mcqSubmit");
  if(old) old.remove();
  const sb=document.createElement("button");
  sb.id="mcqSubmit"; sb.className="btn success mt"; sb.textContent="제출";
  sb.addEventListener("click", onSubmit);
  els.mcqBox.appendChild(sb);
}

function renderResponses(list){
  const r=window.__room||{}; const idx=r.currentIndex; const q=r.questions?.[idx];
  // 카운터(프레젠테이션)
  if(els.cntJoin)  els.cntJoin.textContent = String(list.length);
  if(els.cntSubmit) els.cntSubmit.textContent = String(list.filter(s=>s.answers && s.answers[idx]!=null).length);
  if(els.cntOK)    els.cntOK.textContent = String(list.filter(s=>s.answers?.[idx]?.correct===true).length);
  if(els.cntNG)    els.cntNG.textContent = String(list.filter(s=>s.answers?.[idx]?.correct===false).length);

  // 결과표(관리자)
  if(els.resultsTable){
    const tbl=document.createElement("table");
    const thead=document.createElement("thead"), tr=document.createElement("tr");
    ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; tr.appendChild(th); });
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb=document.createElement("tbody");
    // 점수 계산 & 정렬
    const rows=list.map(s=>{
      let score=0; const cells=[s.name||s.id];
      (r.questions||[]).forEach((q,i)=>{
        const a=s.answers?.[i];
        if(a?.correct) score++;
        cells.push(a ? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : "-") : (a.value??"-")) : "-");
      });
      return { s, score, cells };
    }).sort((a,b)=>b.score-a.score);

    rows.forEach(({s,score,cells})=>{
      const tr=document.createElement("tr");
      cells.forEach(t=>{ const td=document.createElement("td"); td.textContent=t; tr.appendChild(td); });
      const td=document.createElement("td"); td.textContent=String(score); tr.appendChild(td);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
  }
}

/***********************
 * 이벤트
 ***********************/
els.btnConnect?.addEventListener("click", connect);
els.btnSignOut?.addEventListener("click", signOut);

[els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(btn=>{
  btn?.addEventListener("click", ()=>{
    [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
    btn.classList.add("active");
    els.pBuild?.classList.toggle("hide", btn!==els.tabBuild);
    els.pOptions?.classList.toggle("hide", btn!==els.tabOptions);
    els.pPresent?.classList.toggle("hide", btn!==els.tabPresent);
    els.pResults?.classList.toggle("hide", btn!==els.tabResults);
    // 옵션 탭에서만 학생접속 블록
    if(MODE==='admin') els.studentAccessBlock?.classList.toggle("hide", btn!==els.tabOptions);
  });
});

els.btnBuildForm?.addEventListener("click", ()=>{
  const n=Math.max(1,Math.min(50, parseInt(els.questionCount?.value,10)||3));
  if(els.builder){ els.builder.innerHTML=""; for(let i=0;i<n;i++) els.builder.appendChild(cardRow(i+1)); }
});
els.btnLoadSample?.addEventListener("click", ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
    {type:'mcq', text:'태양계 별명?', options:['Milky','Solar','Sunset','Lunar'], answerIndex:1},
  ];
  if(els.builder){ els.builder.innerHTML=""; S.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q))); }
  els.quizTitle.value="샘플 퀴즈"; els.questionCount.value=S.length;
});
els.btnUploadTxt?.addEventListener("click", ()=> els.fileUploadTxt.click());
els.fileUploadTxt?.addEventListener("change", async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const text=await f.text();
  const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const list=lines.map((ln)=>{
    const arr=ln.split(",").map(s=>s.trim());
    if(arr.length===3 && arr[1]==='주관식') return { type:'short', text:arr[0], answerText:arr[2] };
    if(arr.length>=6) return { type:'mcq', text:arr[0], options:arr.slice(1,5), answerIndex:Math.max(0,parseInt(arr[5],10)-1) };
    return null;
  }).filter(Boolean);
  if(!list.length) return alert("지원되지 않는 형식입니다.");
  els.builder.innerHTML=""; list.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q)));
  els.quizTitle.value="업로드 퀴즈"; els.questionCount.value=list.length;
});
els.btnDownloadTemplate?.addEventListener("click", ()=>{
  const sample=`가장 큰 행성?,지구,목성,화성,금성,2
서울의 별칭은?,주관식,한양`;
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([sample],{type:"text/plain"}));
  a.download="quiz-template.txt"; a.click(); URL.revokeObjectURL(a.href);
});

els.btnSaveQuiz?.addEventListener("click", async ()=>{
  const payload=collectBuilder(); if(!payload.questions.length) return alert("문항을 추가하세요.");
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("저장 완료!");
});

els.btnSaveOptions?.addEventListener("click", async ()=>{
  await updateDoc(roomRef(roomId), {
    accept: !!els.chkAccept.checked, reveal: !!els.chkReveal.checked,
    bright: !!els.chkBright.checked, timer: Math.max(5,Math.min(600, parseInt(els.timerSec?.value,10)||30)),
    policy: els.policyName.checked ? "name" : "device"
  });
  buildQR();
  alert("옵션 저장 완료!");
});
els.btnResetAll?.addEventListener("click", async ()=>{
  if(!confirm("문항/설정/응답을 모두 초기화할까요?")) return;
  await setDoc(roomRef(roomId), { mode:"idle", currentIndex:-1, accept:false, reveal:false, questions:[], title:"새 세션" }, { merge:true });
  const snap=await getDocs(respCol(roomId));
  const tasks=[]; snap.forEach(d=> tasks.push(setDoc(doc(respCol(roomId), d.id), { answers:{}, alive:true }, { merge:true })));
  await Promise.all(tasks);
  alert("완전 초기화 완료");
});

els.btnStart?.addEventListener("click", ()=> startQuiz());
els.btnPrev?.addEventListener("click", ()=> step(-1));
els.btnNext?.addEventListener("click", ()=> step(+1));
els.btnEndAll?.addEventListener("click", finishAll);

els.btnCopyLink?.addEventListener("click", async ()=>{
  await navigator.clipboard.writeText(els.studentLink.value||"");
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="복사", 1200);
});
els.btnOpenStudent?.addEventListener("click", ()=> window.open(els.studentLink?.value||"#","_blank"));

els.btnExportCSV?.addEventListener("click", async ()=>{
  const r=(await getDoc(roomRef(roomId))).data();
  const snap=await getDocs(respCol(roomId));
  const rows=[]; rows.push(["userId","name",...(r.questions||[]).map((_,i)=>`Q${i+1}`),"score"].join(","));
  snap.forEach(d=>{
    const s=d.data(); let score=0;
    const answers=(r.questions||[]).map((q,i)=>{ const a=s.answers?.[i]; if(a?.correct) score++; return q.type==='mcq' ? (typeof a?.value==='number'? a.value+1 : "") : (a?.value??""); });
    rows.push([d.id, `"${(s.name||"").replace(/"/g,'""')}"`, ...answers, score].join(","));
  });
  const blob=new Blob([rows.join("\n")],{type:"text/csv"}); const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=`${r.title||roomId}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
});
els.btnResetScore?.addEventListener("click", async ()=>{
  if(!confirm("응답/점수만 초기화할까요?")) return;
  const snap=await getDocs(respCol(roomId)); const tasks=[];
  snap.forEach(d=> tasks.push(setDoc(doc(respCol(roomId), d.id), { answers:{} }, { merge:true })));
  await Promise.all(tasks); alert("점수 초기화 완료");
});

// 학생 이벤트
els.btnJoin?.addEventListener("click", join);
els.btnShortSend?.addEventListener("click", ()=> submit((els.shortInput?.value||"").trim()));
els.btnMyResult?.addEventListener("click", ()=> {
  // 간단: 결과 탭 이동은 관리자 화면이므로 학생은 개인 표만 유지
  location.hash="#myresult";
});

/***********************
 * 부트스트랩
 ***********************/
function autoReconnect(){
  loadLocal();

  // URL 파라미터 모드
  const url=new URL(location.href);
  const role=url.searchParams.get("role"); const rid=url.searchParams.get("room");
  if(role==='student'){ setMode("student"); }
  else setMode(MODE); // 저장된 모드

  if(rid){ roomId=rid; if(els.roomId) els.roomId.value=rid; }

  if(MODE==='student'){
    hideAdminUI(true);
    els.joinDialog.showModal(); // 첫 진입 팝업
  }

  if(roomId) connect();
}
autoReconnect();
