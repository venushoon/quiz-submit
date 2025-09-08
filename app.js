/***********************
 * Firestore helpers (no import — uses window.db)
 ***********************/
const db = window.db;
const { doc, setDoc, getDoc, updateDoc, onSnapshot, collection, getDocs, runTransaction, serverTimestamp } =
  await (async () => {
    // 동적 import로 필요한 함수만 가져오기(모듈 에러 방지)
    const m = await import("https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js");
    return m;
  })();

/***********************
 * Small utils
 ***********************/
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));
const pad = (n)=>String(n).padStart(2,'0');

let MODE   = "admin";        // 'admin' | 'student'
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;

/***********************
 * Elements
 ***********************/
const els = {
  // header/admin
  liveDot: $("#liveDot"),
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnSignOut: $("#btnSignOut"), roomStatus: $("#roomStatus"),
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"), pOptions: $("#panelOptions"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),

  // builder
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"),
  builder: $("#builder"), fileUploadTxt: $("#fileUploadTxt"), btnUploadTxt: $("#btnUploadTxt"), btnDownloadTemplate: $("#btnDownloadTemplate"),

  // options
  policyDevice: $("#policyDevice"), policyName: $("#policyName"),
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright: $("#chkBright"),
  timerSec: $("#timerSec"), btnSaveOptions: $("#btnSaveOptions"), btnResetAll: $("#btnResetAll"),

  // student access
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

  // present
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  nJoin: $("#nJoin"), nSubmit: $("#nSubmit"), nCorrect: $("#nCorrect"), nWrong: $("#nWrong"), leftSec: $("#leftSec"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pImg: $("#pImg"), pOpts: $("#pOpts"),

  // results
  btnExportCSV: $("#btnExportCSV"), btnResetAll2: $("#btnResetAll2"), resultsTable: $("#resultsTable"),

  // student ui
  studentPanel: $("#studentPanel"), studentTop: $("#studentTop"),
  studentWait: $("#studentWait"), sRoom: $("#sRoom"),
  sQuestionCard: $("#sQuestionCard"), badgeType: $("#badgeType"), sQText: $("#sQText"), sImg: $("#sImg"),
  mcqBox: $("#mcqBox"), shortBox: $("#shortBox"), shortInput: $("#shortInput"), btnShortSend: $("#btnShortSend"),
  studentResult: $("#studentResult"),
};

/***********************
 * Admin-only toggle helper
 ***********************/
function setAdminVisible(on){
  $$(".admin-only").forEach(el=>el.classList.toggle("hide", !on));
}

/***********************
 * Local cache
 ***********************/
function saveLocal(){ localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me })); }
function loadLocal(){
  try{
    const d=JSON.parse(localStorage.getItem("quiz.live")||"{}");
    roomId=d.roomId||""; MODE=d.MODE||"admin"; me=d.me||{id:null,name:""};
    if(els.roomId) els.roomId.value=roomId;
  }catch{}
}

/***********************
 * Firestore refs
 ***********************/
const roomRef = (id)=>doc(db,"rooms",id);
const respCol = (id)=>collection(db,"rooms",id,"responses");

async function ensureRoom(id){
  const snap=await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false,
      timer:30, bright:false, createdAt: serverTimestamp(), questions:[]
    });
  }
}

function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom=onSnapshot(roomRef(id),(snap)=>{
    if(!snap.exists()) return;
    const r=snap.data(); window.__room=r; renderRoom(r);
  });
}
function listenResponses(id){
  if(unsubResp) unsubResp();
  unsubResp=onSnapshot(respCol(id),(qs)=>{
    const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    renderResponses(arr);
  });
}

/***********************
 * Mode & Connect
 ***********************/
function setMode(m){
  MODE=m;
  // admin-only 영역 제어
  setAdminVisible(m==="admin");
  // 패널 표시
  els.pBuild?.classList.toggle("hide", m!=="admin");
  els.pOptions?.classList.toggle("hide", m!=="admin");
  els.pResults?.classList.toggle("hide", m!=="admin");
  els.pPresent?.classList.add("hide"); // 탭 클릭 시만 열기
  // 학생 패널
  els.studentPanel?.classList.toggle("hide", m!=="student");
  // 상태
  els.roomStatus && (els.roomStatus.textContent = roomId ? `세션: ${roomId} · 온라인` :
    (m==='admin'?'세션: - · 오프라인':'학생 모드'));
  els.sRoom && (els.sRoom.textContent = roomId? `세션: ${roomId} · 온라인` : `세션: - · 오프라인`);
}

async function connect(){
  const id=(els.roomId?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId=id; await ensureRoom(roomId);
  listenRoom(roomId); listenResponses(roomId);
  buildStudentLink();
  if(els.roomId){ els.roomId.disabled=true; }
  els.btnConnect?.classList.add("hide");
  els.btnSignOut?.classList.remove("hide");
  els.roomStatus && (els.roomStatus.textContent=`세션: ${roomId} · 온라인`);
  saveLocal();
}
function signOut(){
  if(els.roomId){ els.roomId.disabled=false; }
  els.btnConnect?.classList.remove("hide");
  els.btnSignOut?.classList.add("hide");
  els.roomStatus && (els.roomStatus.textContent=`세션: - · 오프라인`);
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  roomId=""; saveLocal();
}

function autoReconnect(){
  loadLocal();
  // URL 파라미터 우선
  const url=new URL(location.href);
  const role=url.searchParams.get("role"); const rid=url.searchParams.get("room");
  if(role==='student') MODE='student';
  setMode(MODE);
  if(rid){ roomId=rid; saveLocal(); }
  if(roomId){ if(els.roomId) els.roomId.value=roomId; connect(); }
}

/***********************
 * Builder (간단폼)
 ***********************/
function cardRow(no,q){
  const wrap=document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap gap">
      <span class="badge">${no}번</span>
      <label><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'} /> 객관식</label>
      <label><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''} /> 주관식</label>
      <input type="file" accept="image/*" class="imgUp" data-no="${no}" />
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항" value="${q?.text||''}" />
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap gap">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기${i+1}" value="${v}">`).join('')}
      </div>
      <div class="row gap mt">
        <span class="muted">정답 번호</span>
        <input class="ansIndex input sm" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
      </div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <input class="ansText input" data-no="${no}" placeholder="정답(선택, 자동채점용)" value="${q?.answerText||''}">
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
  return wrap;
}
function collectBuilder(){
  const cards=$$("#builder>.qcard");
  const list=cards.map((c,idx)=>{
    const no=idx+1;
    const type=c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text=c.querySelector(".qtext").value.trim();
    let image=null;
    const up=c.querySelector(".imgUp").files?.[0];
    if(up) image=URL.createObjectURL(up); // (데모: 실제 배포 시 Storage 업로드 권장)
    if(!text) return null;
    if(type==='mcq'){
      const opts=$$(".opt",c).map(i=>i.value.trim()).filter(Boolean);
      const ans = Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans, image };
    } else {
      return { type:'short', text, answerText:c.querySelector(".ansText").value.trim(), image };
    }
  }).filter(Boolean);
  return { title: els.quizTitle?.value||"퀴즈", questions:list };
}

/***********************
 * Flow + Timer
 ***********************/
async function startQuiz(){ await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true }); }
async function step(delta){
  await runTransaction(db, async (tx)=>{
    const ref=roomRef(roomId);
    const snap=await tx.get(ref);
    const r=snap.data(); const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){ // 종료
      tx.update(ref, { currentIndex: Math.max(0,total-1), mode:"ended", accept:false });
      return;
    }
    next=Math.max(0,next);
    tx.update(ref, { currentIndex: next, accept:true });
  });
}
async function finishAll(){ if(confirm("퀴즈를 종료할까요?")) await updateDoc(roomRef(roomId), { mode:"ended", accept:false }); }

function startTimer(sec){
  stopTimer();
  const end = Date.now()+sec*1000;
  timerHandle=setInterval(()=>{
    const remain=Math.max(0, Math.floor((end-Date.now())/1000));
    els.leftSec && (els.leftSec.textContent = `${pad(Math.floor(remain/60))}:${pad(remain%60)}`);
    if(remain<=0){ stopTimer(); step(+1); }
  }, 250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } els.leftSec && (els.leftSec.textContent="00:00"); }

/***********************
 * Student join & submit
 ***********************/
async function join(name){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const id = localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10);
  localStorage.setItem("quiz.device", id);
  me = { id, name: name.trim() };
  await setDoc(doc(respCol(roomId), id), { name:me.name, joinedAt:serverTimestamp(), answers:{}, alive:true }, { merge:true });
  saveLocal();
  alert("참가 완료! 제출 버튼을 눌러주세요.");
}
async function submit(value){
  const r=window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
  const ref=doc(respCol(roomId), me.id);
  const snap=await getDoc(ref); const prev=snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert("이미 제출했습니다."); // 중복 방지
  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true) } }, { merge:true });
}

/***********************
 * Renderers
 ***********************/
function renderRoom(r){
  const total=r.questions?.length||0; const idx=r.currentIndex;
  els.pTitle && (els.pTitle.textContent = r.title||roomId);
  els.pQ && (els.pQ.textContent = (r.mode==='active' && idx>=0 && r.questions[idx]) ? r.questions[idx].text : "시작 버튼을 누르면 문항이 제시됩니다.");

  // 이미지(있을 때만)
  if(els.pImg){
    const img = (r.mode==='active' && idx>=0 && r.questions[idx]?.image) ? r.questions[idx].image : null;
    els.pImg.classList.toggle("hide", !img); 
    if(img) els.pImg.src = img;
  }

  // 프레젠테이션 옵션/타이머
  if(r.timer && r.mode==='active' && idx>=0) startTimer(r.timer); else stopTimer();

  // 학생
  if(MODE==='student'){
    els.studentWait?.classList.toggle("hide", !(r.mode!=='active' || idx<0));
    els.sQuestionCard?.classList.toggle("hide", !(r.mode==='active' && idx>=0));
    if(r.mode==='ended'){ // 학생 안내 & 결과 버튼
      els.sQuestionCard?.classList.add("hide");
      els.studentResult.classList.remove("hide");
      els.studentResult.innerHTML = `<h3>퀴즈가 종료되었습니다!</h3><button class="btn" id="btnMyResult">내 결과 보기</button>`;
      $("#btnMyResult")?.addEventListener("click", showMyResult);
      return;
    }
    if(r.mode==='active' && idx>=0){
      const q=r.questions[idx];
      els.badgeType && (els.badgeType.textContent = q.type==='mcq'?'객관식':'주관식');
      els.sQText && (els.sQText.textContent=q.text);
      // 이미지
      if(els.sImg){
        const img=q.image||null;
        els.sImg.classList.toggle("hide", !img);
        if(img) els.sImg.src=img;
      }
      // 객관식 버튼(제출 버튼 하나만 — 중복 제거)
      if(q.type==='mcq' && els.mcqBox){
        els.shortBox?.classList.add("hide");
        els.mcqBox.innerHTML="";
        q.options.forEach((opt,i)=>{
          const b=document.createElement("button");
          b.className="btn"; b.textContent=`${i+1}. ${opt}`;
          b.addEventListener("click", ()=> submit(i));
          els.mcqBox.appendChild(b);
        });
      } else {
        els.mcqBox && (els.mcqBox.innerHTML="");
        els.shortBox?.classList.remove("hide");
        els.btnShortSend && (els.btnShortSend.onclick = ()=> submit((els.shortInput?.value||"").trim()));
      }
    }
  }

  // 링크/밝은모드
  document.body.classList.toggle("bright", !!r.bright);
}
function renderResponses(list){
  // 집계 카운터
  const r=window.__room||{}; const idx=r.currentIndex; const q=r.questions?.[idx];
  let join=list.length, submit=0, ok=0, no=0;
  list.forEach(s=>{
    const a=s.answers?.[idx];
    if(a){ submit++; if(a.correct) ok++; else no++; }
  });
  els.nJoin && (els.nJoin.textContent=join);
  els.nSubmit && (els.nSubmit.textContent=submit);
  els.nCorrect && (els.nCorrect.textContent=ok);
  els.nWrong && (els.nWrong.textContent=no);

  // 결과표(관리자)
  if(MODE!=='admin' || !els.resultsTable) return;
  const tbl=document.createElement("table");
  const thead=document.createElement("thead"), tr=document.createElement("tr");
  ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; tr.appendChild(th); });
  thead.appendChild(tr); tbl.appendChild(thead);
  const tb=document.createElement("tbody");
  list.forEach(s=>{
    let score=0; const tr=document.createElement("tr");
    const tdn=document.createElement("td"); tdn.textContent=s.name||s.id; tr.appendChild(tdn);
    (r.questions||[]).forEach((q,i)=>{
      const a=s.answers?.[i]; const td=document.createElement("td");
      td.textContent = a? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value??'-')) : '-';
      if(a?.correct) score++; tr.appendChild(td);
    });
    const tds=document.createElement("td"); tds.textContent=String(score); tr.appendChild(tds);
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
}

/***********************
 * Link / QR
 ***********************/
function buildStudentLink(){
  if(!els.studentLink) return;
  const url=new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", roomId);
  els.studentLink.value=url.toString();
  // QR
  if(window.QRCode && els.qrCanvas){
    QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:128 }, (err)=>{ if(err) console.warn(err); });
  }
}

/***********************
 * Events
 ***********************/
els.btnConnect?.addEventListener("click", connect);
els.btnSignOut?.addEventListener("click", signOut);

[els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(btn=>{
  btn?.addEventListener("click", ()=>{
    [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
    btn.classList.add("active");
    const id=btn.dataset.tab;
    els.pBuild?.classList.toggle("hide", id!=="build");
    els.pOptions?.classList.toggle("hide", id!=="options");
    els.pPresent?.classList.toggle("hide", id!=="present");
    els.pResults?.classList.toggle("hide", id!=="results");
  });
});

// builder
els.btnBuildForm?.addEventListener("click", ()=>{
  const n=Math.max(1,Math.min(50, parseInt(els.questionCount?.value,10)||3));
  if(els.builder){ els.builder.innerHTML=""; for(let i=0;i<n;i++) els.builder.appendChild(cardRow(i+1)); }
});
els.btnLoadSample?.addEventListener("click", ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
    {type:'mcq', text:'태양계 별명?', options:['Milky','Solar','Sunset','Lunar'], answerIndex:1},
  ];
  if(els.builder){ els.builder.innerHTML=""; S.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q))); }
  if(els.quizTitle) els.quizTitle.value="샘플 퀴즈";
  if(els.questionCount) els.questionCount.value=S.length;
});
els.btnSaveQuiz?.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션부터 접속하세요.");
  const payload=collectBuilder(); if(!payload.questions.length) return alert("문항을 추가하세요.");
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("저장 완료!");
});

// 업로드/샘플양식
els.btnUploadTxt?.addEventListener("click", ()=> els.fileUploadTxt?.click());
els.fileUploadTxt?.addEventListener("change", async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const lines=(await f.text()).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const qs=[];
  lines.forEach(line=>{
    const arr=line.split(",").map(s=>s.trim());
    if(arr.length>=3){
      if(arr[1]==='주관식'){ qs.push({type:'short', text:arr[0], answerText:arr[2]||''}); }
      else { const opts=arr.slice(1,5); const ans=parseInt(arr[5]||"1",10)-1; qs.push({type:'mcq', text:arr[0], options:opts, answerIndex:Math.max(0,ans)}); }
    }
  });
  els.builder.innerHTML=""; qs.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q)));
  els.quizTitle.value = els.quizTitle.value || "수동 업로드";
  els.questionCount.value = qs.length;
  e.target.value="";
});
els.btnDownloadTemplate?.addEventListener("click", ()=>{
  const sample = [
    "가장 큰 행성은?,지구,목성,화성,금성,2",
    "물의 끓는점(°C)?,주관식,100"
  ].join("\n");
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([sample],{type:"text/plain"}));
  a.download="quiz_sample.txt"; a.click(); URL.revokeObjectURL(a.href);
});

// options
els.btnSaveOptions?.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션부터 접속하세요.");
  const timer = Math.max(5,Math.min(600, parseInt(els.timerSec?.value,10)||30));
  await setDoc(roomRef(roomId), {
    accept: !!els.chkAccept?.checked,
    reveal: !!els.chkReveal?.checked,
    bright: !!els.chkBright?.checked,
    timer
  }, { merge:true });
  buildStudentLink();
  alert("저장 완료! 학생 QR/링크를 갱신했어요.");
});
els.btnResetAll?.addEventListener("click", doReset);
els.btnResetAll2?.addEventListener("click", doReset);

async function doReset(){
  if(!roomId) return alert("세션부터 접속하세요.");
  if(!confirm("모든 문항/옵션/결과를 초기화하고 처음 상태로 되돌립니다.")) return;
  await setDoc(roomRef(roomId), {
    title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false, bright:false,
    timer:30, questions:[]
  }, { merge:true });
  const snap=await getDocs(respCol(roomId));
  await Promise.all(snap.docs.map(d=> setDoc(d.ref, { answers:{}, alive:true }, { merge:true })));
  // 로컬 UI 초기화
  els.quizTitle.value=""; els.questionCount.value=3; els.builder.innerHTML="";
  ["chkAccept","chkReveal","chkBright"].forEach(k=> els[k] && (els[k].checked=false));
  els.timerSec.value=30;
  alert("초기화 완료");
}

// present
els.btnStart?.addEventListener("click", startQuiz);
els.btnPrev?.addEventListener("click", ()=>step(-1));
els.btnNext?.addEventListener("click", ()=>step(+1));
els.btnEndAll?.addEventListener("click", finishAll);

// student link
els.btnCopyLink?.addEventListener("click", async ()=>{
  if(!els.studentLink?.value) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="복사", 1200);
});
els.btnOpenStudent?.addEventListener("click", ()=> window.open(els.studentLink?.value||"#","_blank"));

/***********************
 * Student prompt on open (?role=student)
 ***********************/
function promptStudentName(){
  const name = prompt("이름 혹은 번호를 입력하세요!");
  if(!name){ alert("이름이 필요합니다."); return null; }
  return name.trim();
}

/***********************
 * My result (student)
 ***********************/
async function showMyResult(){
  if(!roomId || !me.id) return;
  const r=(await getDoc(roomRef(roomId))).data();
  const s=(await getDoc(doc(respCol(roomId), me.id))).data()||{};
  const qs=r.questions||[];
  let score=0;
  const rows = qs.map((q,i)=>{
    const a=s.answers?.[i];
    const isOk=a?.correct===true; if(isOk) score++;
    return `<tr><td>${i+1}</td><td>${a? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value??'-')) : '-'}</td><td>${isOk?'O':'X'}</td></tr>`;
  }).join("");
  els.studentResult.innerHTML = `
    <h3>내 결과</h3>
    <p>이름: ${s.name||'-'} · 점수: ${score}</p>
    <table><thead><tr><th>문항</th><th>제출</th><th>정답</th></tr></thead><tbody>${rows}</tbody></table>
  `;
}

/***********************
 * Boot
 ***********************/
(function init(){
  // URL로 학생 모드 인입 시: 이름 받고 대기 → 시작 후 1번 문항
  const url=new URL(location.href);
  if(url.searchParams.get("role")==='student'){
    MODE='student'; setMode('student');
    const rid=url.searchParams.get("room");
    if(rid){ roomId=rid; }
    // 관리자 UI 숨김
    setAdminVisible(false);
    // 참가
    setTimeout(async ()=>{
      const name = promptStudentName();
      if(!name) return;
      await connectIfNeed();
      await join(name);
      els.studentWait?.classList.remove("hide"); // 대기 표시
    }, 50);
  }else{
    MODE='admin'; setMode('admin');
  }
  autoReconnect();
})();

async function connectIfNeed(){
  if(roomId && (!els.roomId || els.roomId.value!==roomId)){
    if(els.roomId) els.roomId.value=roomId;
  }
  if(roomId && (!unsubRoom || !unsubResp)) await connect();
}
