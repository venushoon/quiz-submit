/***********************
 * Firebase helpers (전역 db는 index.html에서 주입)
 ***********************/
import {
  doc, setDoc, getDoc, onSnapshot, updateDoc,
  collection, getDocs, runTransaction, serverTimestamp, deleteDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/***********************
 * DOM helpers & state
 ***********************/
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));
const pad = n => String(n).padStart(2,'0');

let MODE   = "admin";           // 'admin' | 'student'
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;

const els = {
  // top/admin
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnSignOut: $("#btnSignOut"), roomStatus: $("#roomStatus"),
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"), pOptions: $("#panelOptions"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),

  // builder
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"),
  fileUploadTxt: $("#fileUploadTxt"), btnUploadTxt: $("#btnUploadTxt"), btnDownloadTemplate: $("#btnDownloadTemplate"),
  builder: $("#builder"),

  // options
  policyDevice: $("#policyDevice"), policyName: $("#policyName"),
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright: $("#chkBright"),
  timerSec: $("#timerSec"), btnSaveOptions: $("#btnSaveOptions"),
  btnResetAll: $("#btnResetAll"), btnResetAll2: $("#btnResetAll2"),
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"),
  btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

  // present
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pImg: $("#pImg"), pOpts: $("#pOpts"), leftSec: $("#leftSec"),
  chipJoin: $("#chipJoin"), chipSubmit: $("#chipSubmit"), chipOk: $("#chipOk"), chipNo: $("#chipNo"),

  // results
  btnExportCSV: $("#btnExportCSV"), resultsTable: $("#resultsTable"),

  // student
  studentPanel: $("#studentPanel"),
  sRoom: $("#sRoom"), sOnline: $("#sOnline"),
  joinArea: $("#joinArea"), studentName: $("#studentName"), btnJoin: $("#btnJoin"),
  waitArea: $("#waitArea"), qArea: $("#qArea"),
  badgeType: $("#badgeType"), sQText: $("#sQText"), sQImg: $("#sQImg"),
  mcqBox: $("#mcqBox"), shortBox: $("#shortBox"), shortInput: $("#shortInput"),
  btnShortSend: $("#btnShortSend"), btnSubmitMCQ: $("#btnSubmitMCQ"),
  studentEnd: $("#studentEnd"), btnMyResult: $("#btnMyResult"), myResult: $("#myResult"),
};

/***********************
 * local cache
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
const roomRef = id => doc(db,"rooms",id);
const respCol = id => collection(db,"rooms",id,"responses");

async function ensureRoom(id){
  const snap=await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false,
      createdAt: serverTimestamp(), questions:[]
    });
  }
}

/***********************
 * listen
 ***********************/
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
 * mode & connect
 ***********************/
function setMode(m){
  MODE=m;
  document.body.dataset.mode=m;
  $$(".admin-only").forEach(el=> el.classList.toggle("hide", m!=="admin"));
  // 패널 보이기: 관리자는 빌드 우선, 학생은 studentPanel만
  if(m==="admin"){
    showPanel("build");
  }else{
    hideAllPanels(); els.studentPanel?.classList.remove("hide");
  }
  // 헤더 상태
  if(els.roomStatus){
    els.roomStatus.textContent = roomId ? `세션: ${roomId} · 온라인` : (m==='admin'?'세션: - · 오프라인':'학생 모드');
  }
}
function hideAllPanels(){
  [els.pBuild,els.pOptions,els.pPresent,els.pResults,els.studentPanel].forEach(p=>p?.classList.add("hide"));
}
function showPanel(key){
  hideAllPanels();
  if(key==="build") els.pBuild?.classList.remove("hide");
  if(key==="options") els.pOptions?.classList.remove("hide");
  if(key==="present") els.pPresent?.classList.remove("hide");
  if(key==="results") els.pResults?.classList.remove("hide");
}
async function connect(){
  const id=(els.roomId?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId=id; await ensureRoom(roomId);
  listenRoom(roomId); listenResponses(roomId);
  buildStudentLink();
  els.roomStatus && (els.roomStatus.textContent=`세션: ${roomId} · 온라인`);
  els.roomId?.setAttribute("disabled","true");
  els.btnConnect?.classList.add("hide");
  els.btnSignOut?.classList.remove("hide");
  saveLocal();
}
function signOut(){
  // 단순 UI 해제(세션 삭제 아님)
  els.roomId?.removeAttribute("disabled");
  els.btnConnect?.classList.remove("hide");
  els.btnSignOut?.classList.add("hide");
  roomId=""; saveLocal();
  location.reload();
}
function autoReconnect(){
  loadLocal();
  const url=new URL(location.href);
  const role=url.searchParams.get("role");
  const rid=url.searchParams.get("room");
  if(role==='student'){ setMode("student"); }
  else setMode(MODE||"admin");

  if(rid){ roomId=rid; }
  if(roomId){
    if(els.roomId) els.roomId.value=roomId;
    connect();
  }
}

/***********************
 * Builder
 ***********************/
function cardRow(no,q){
  const wrap=document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'} /> 객관식</label>
      <label><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''} /> 주관식</label>
      <input type="file" accept="image/*" class="input" id="img-${no}" />
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항" value="${q?.text||''}" />
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기${i+1}" value="${v}">`).join('')}
      </div>
      <div class="row">
        <span class="hint">정답 번호</span>
        <input class="ansIndex input sm" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
      </div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <input class="ansText input" data-no="${no}" placeholder="정답텍스트(선택)" value="${q?.answerText||''}">
    </div>
  `;
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
  const list=[];
  for (let idx=0; idx<cards.length; idx++){
    const c=cards[idx]; const no=idx+1;
    const type=c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text=c.querySelector(".qtext").value.trim(); if(!text) continue;
    const imgInput=c.querySelector(`#img-${no}`);
    let image=null;
    if(imgInput?.files?.[0]){
      // dataURL 저장(간단 버전)
      image = URL.createObjectURL(imgInput.files[0]);
    }
    if(type==='mcq'){
      const opts=$$(".opt",c).map(i=>i.value.trim()).filter(Boolean);
      const ans = Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      list.push({ type:'mcq', text, options:opts, answerIndex:ans, image });
    } else {
      list.push({ type:'short', text, answerText:c.querySelector(".ansText").value.trim(), image });
    }
  }
  return { title: els.quizTitle?.value||"퀴즈", questions:list };
}

/***********************
 * Flow + Timer
 ***********************/
async function startQuiz(){ await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true }); }
async function step(delta){
  await runTransaction(db, async (tx)=>{
    const snap=await tx.get(roomRef(roomId)); const r=snap.data(); const total=(r.questions?.length||0);
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
  timerHandle=setInterval(async ()=>{
    const remain=Math.max(0, Math.floor((end-Date.now())/1000));
    els.leftSec && (els.leftSec.textContent = `${pad(Math.floor(remain/60))}:${pad(remain%60)}`);
    if(remain<=0){
      stopTimer();
      await updateDoc(roomRef(roomId), { accept:false });
      setTimeout(()=> step(+1), 400);
    }
  }, 250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } els.leftSec && (els.leftSec.textContent="00:00"); }

/***********************
 * Submit / Grade
 ***********************/
async function join(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name=(els.studentName?.value||"").trim(); if(!name) return alert("이름을 입력하세요.");
  me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem("quiz.device", me.id);
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{}, alive:true }, { merge:true });
  // 학생 대기화면 고정
  els.joinArea?.classList.add("hide");
  els.waitArea?.classList.remove("hide");
  els.qArea?.classList.add("hide");
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
    const norm=s=>String(s).trim().toLowerCase();
    if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true), revealed:r.reveal||false } }, { merge:true });
  // 제출 후 버튼/입력 잠금
  els.btnSubmitMCQ?.classList.add("hide");
  els.btnShortSend && (els.btnShortSend.disabled=true);
}

/***********************
 * Render (admin & student)
 ***********************/
function renderRoom(r){
  const total=r.questions?.length||0; const idx=r.currentIndex;
  // Present
  els.pTitle && (els.pTitle.textContent = (r.title||roomId||"-"));
  if(els.pQ && els.pOpts){
    els.pOpts.innerHTML="";
    if(r.mode==="active" && idx>=0 && r.questions[idx]){
      const q=r.questions[idx]; els.pQ.textContent=q.text;
      // 이미지: 있을 때만 보이기
      if(els.pImg){
        if(q.image){ els.pImg.src=q.image; els.pImg.classList.remove("hide"); }
        else { els.pImg.classList.add("hide"); els.pImg.removeAttribute("src"); }
      }
      if(q.type==='mcq'){
        q.options.forEach((t,i)=>{ const d=document.createElement("div"); d.className="badge"; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d); });
      }
    } else {
      els.pQ.textContent="시작 버튼을 누르면 문항이 제시됩니다.";
      els.pImg?.classList.add("hide");
    }
  }

  // 학생 화면
  if(MODE==='student'){
    els.sRoom && (els.sRoom.textContent = roomId||"-");
    if(r.mode!=='active' || idx<0){
      els.qArea?.classList.add("hide");
      // 참가 완료 후에는 대기 표기, 미참가면 join 표기
      const snapJoin = !!me?.id;
      if(snapJoin){
        els.joinArea?.classList.add("hide");
        els.waitArea?.classList.remove("hide");
      } else {
        els.joinArea?.classList.remove("hide");
        els.waitArea?.classList.add("hide");
      }
      if(r.mode==="ended"){
        els.waitArea?.classList.add("hide");
        els.studentEnd?.classList.remove("hide");
      } else {
        els.studentEnd?.classList.add("hide");
      }
      return;
    }
    const q=r.questions[idx];
    els.waitArea?.classList.add("hide");
    els.qArea?.classList.remove("hide");
    els.badgeType && (els.badgeType.textContent = q.type==='mcq'?'객관식':'주관식');
    els.sQText && (els.sQText.textContent=q.text);

    // 학생 이미지
    if(els.sQImg){
      if(q.image){ els.sQImg.src=q.image; els.sQImg.classList.remove("hide"); }
      else { els.sQImg.classList.add("hide"); els.sQImg.removeAttribute("src"); }
    }

    if(q.type==='mcq'){
      if(els.mcqBox){
        els.mcqBox.innerHTML="";
        q.options.forEach((opt,i)=>{
          const b=document.createElement("button");
          b.className="btn"; b.textContent=`${i+1}. ${opt}`;
          b.addEventListener("click",()=> { els.btnSubmitMCQ.dataset.choice=i; $$("#mcqBox .btn").forEach(x=>x.classList.remove("primary")); b.classList.add("primary"); els.btnSubmitMCQ.classList.remove("hide"); });
          els.mcqBox.appendChild(b);
        });
      }
      els.shortBox?.classList.add("hide");
    } else {
      els.mcqBox && (els.mcqBox.innerHTML="");
      els.shortBox?.classList.remove("hide");
      els.btnShortSend && (els.btnShortSend.disabled=false);
      els.btnSubmitMCQ?.classList.add("hide");
    }
  }
}

function renderResponses(list){
  // 칩(집계)
  const r=window.__room||{}; const idx=r.currentIndex; const q=r.questions?.[idx];
  if(els.chipJoin)   els.chipJoin.textContent   = String(list.length);
  if(els.chipSubmit) els.chipSubmit.textContent = String(list.filter(s=> s.answers?.[idx]!=null).length);
  if(els.chipOk)     els.chipOk.textContent     = String(list.filter(s=> s.answers?.[idx]?.correct===true).length);
  if(els.chipNo)     els.chipNo.textContent     = String(list.filter(s=> s.answers?.[idx] && s.answers?.[idx]?.correct===false).length);

  // 결과표(관리자)
  if(MODE!=='admin' || !els.resultsTable) return;
  const tbl=document.createElement("table");
  const thead=document.createElement("thead"), tr=document.createElement("tr");
  ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; tr.appendChild(th); });
  thead.appendChild(tr); tbl.appendChild(thead);
  const tb=document.createElement("tbody");
  // 점수 순 정렬
  const scored=list.map(s=>{
    let score=0; (r.questions||[]).forEach((q,i)=>{ if(s.answers?.[i]?.correct) score++; });
    return { ...s, _score:score };
  }).sort((a,b)=> b._score - a._score);

  scored.forEach(s=>{
    const tr=document.createElement("tr");
    const tdn=document.createElement("td"); tdn.textContent=s.name||s.id; tr.appendChild(tdn);
    (r.questions||[]).forEach((q,i)=>{
      const a=s.answers?.[i]; const td=document.createElement("td");
      td.textContent = a? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value??'-')) : '-';
      tr.appendChild(td);
    });
    const tds=document.createElement("td"); tds.textContent=String(s._score); tr.appendChild(tds);
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
  if(window.QRCode && els.qrCanvas){
    try{
      window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:128 }, (err)=>{ if(err) console.warn(err); });
    }catch(e){ console.warn("QR draw failed", e); }
  }
}

/***********************
 * Export / Reset
 ***********************/
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
  a.href=URL.createObjectURL(blob); a.download=`${(r.title||roomId||"quiz")}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
});

async function resetAll(){
  if(!roomId) return alert("세션부터 접속하세요.");
  if(!confirm("문항/옵션/응답을 모두 초기화합니다. 계속할까요?")) return;
  // 방 상태 초기화
  await setDoc(roomRef(roomId), { title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false, questions:[] }, { merge:true });
  // 응답 제거
  const snap=await getDocs(respCol(roomId));
  await Promise.all(snap.docs.map(d=> deleteDoc(d.ref)));
  // UI
  alert("초기화 완료");
}
els.btnResetAll?.addEventListener("click", resetAll);
els.btnResetAll2?.addEventListener("click", resetAll);

/***********************
 * Events
 ***********************/
els.btnConnect?.addEventListener("click", connect);
els.btnSignOut?.addEventListener("click", signOut);

[els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(btn=>{
  btn?.addEventListener("click", ()=>{
    [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
    btn.classList.add("active");
    showPanel(btn.dataset.tab);
  });
});

els.btnBuildForm?.addEventListener("click", ()=>{
  const n=Math.max(1,Math.min(20, parseInt(els.questionCount?.value,10)||3));
  if(els.builder){ els.builder.innerHTML=""; for(let i=0;i<n;i++) els.builder.appendChild(cardRow(i+1)); }
});
els.btnLoadSample?.addEventListener("click", ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성?', options:['지구','목성','화성','금성'], answerIndex:1},
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

els.btnUploadTxt?.addEventListener("click", ()=> els.fileUploadTxt?.click());
els.fileUploadTxt?.addEventListener("change", async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const text=await f.text();
  const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const questions=[];
  for(const line of lines){
    const cols=line.split(",").map(s=>s.trim());
    if(cols.length>=6){ // 객관식
      questions.push({type:"mcq", text:cols[0], options:cols.slice(1,5), answerIndex:Math.max(0,parseInt(cols[5],10)-1)});
    }else if(cols.length>=3 && cols[1]==="주관식"){
      questions.push({type:"short", text:cols[0], answerText:cols[2]});
    }
  }
  if(els.builder){ els.builder.innerHTML=""; questions.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q))); }
  if(els.quizTitle) els.quizTitle.value="업로드 퀴즈";
  if(els.questionCount) els.questionCount.value=questions.length;
  e.target.value="";
});
els.btnDownloadTemplate?.addEventListener("click", ()=>{
  const tpl = [
    "가장 큰 행성?,지구,목성,화성,금성,2",
    "물의 끓는점은?,주관식,100"
  ].join("\n");
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([tpl],{type:"text/plain"}));
  a.download="quiz-template.csv"; a.click(); URL.revokeObjectURL(a.href);
});

els.btnSaveOptions?.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션부터 접속하세요.");
  const payload={
    policy: els.policyName?.checked ? "name":"device",
    accept: !!els.chkAccept?.checked,
    reveal: !!els.chkReveal?.checked,
    bright: !!els.chkBright?.checked,
    timer:  Math.max(5,Math.min(600, parseInt(els.timerSec?.value,10)||30)),
  };
  await setDoc(roomRef(roomId), payload, { merge:true });
  buildStudentLink();
  alert("옵션 저장 완료!");
});

els.btnCopyLink?.addEventListener("click", async ()=>{
  if(!els.studentLink?.value) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="복사", 1200);
});
els.btnOpenStudent?.addEventListener("click", ()=> window.open(els.studentLink?.value||"#","_blank"));

els.btnStart?.addEventListener("click", ()=> startQuiz());
els.btnPrev?.addEventListener("click", ()=> step(-1));
els.btnNext?.addEventListener("click", ()=> step(+1));
els.btnEndAll?.addEventListener("click", finishAll);

// 학생 제출
els.btnJoin?.addEventListener("click", join);
els.btnSubmitMCQ?.addEventListener("click", ()=> submit(parseInt(els.btnSubmitMCQ.dataset.choice,10)));
els.btnShortSend?.addEventListener("click", ()=> submit((els.shortInput?.value||"").trim()));

// 학생: 내 결과 보기
els.btnMyResult?.addEventListener("click", async ()=>{
  const r=(await getDoc(roomRef(roomId))).data();
  const my=await getDoc(doc(respCol(roomId), me.id));
  if(!my.exists()) return;
  const data=my.data();
  let score=0; const rows=(r.questions||[]).map((q,i)=>{
    const a=data.answers?.[i];
    const ok=a?.correct===true; if(ok) score++;
    return `<tr><td>${i+1}</td><td>${a? (q.type==='mcq'?(a.value+1):a.value):"-"}</td><td>${ok?"○":"×"}</td></tr>`;
  }).join("");
  els.myResult.innerHTML = `
    <h4>내 결과</h4>
    <div class="muted">이름: ${data.name||me.id} · 점수: ${score}</div>
    <table><thead><tr><th>문항</th><th>제출</th><th>정답</th></tr></thead><tbody>${rows}</tbody></table>
  `;
  els.myResult.classList.remove("hide");
});

/***********************
 * Boot
 ***********************/
autoReconnect();
