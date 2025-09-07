/***********************
 * Firebase
 ***********************/
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc,
  collection, getDocs, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo",
  authDomain: "live-quiz-a14d1.firebaseapp.com",
  projectId: "live-quiz-a14d1",
};
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

/***********************
 * Helpers & State
 ***********************/
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));
const pad = (n)=>String(n).padStart(2,'0');

let roomId="", policy="device";
let roomCache=null, respCache=[];
let unsubRoom=null, unsubResp=null, timerHandle=null;

/* 학생 상태 */
let S_MODE=false;
let me = { id:null, name:"" };
let sSelectedIdx=null; // 객관식 선택 index

/***********************
 * Elements
 ***********************/
const A = {
  adminRoot: $("#adminRoot"),
  liveDot: $("#liveDot"),
  roomId: $("#roomId"),
  btnConnect: $("#btnConnect"),
  roomStatus: $("#roomStatus"),
  btnLogout: $("#btnLogout"),
  // tabs & panels
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"),  pOptions: $("#panelOptions"),  pPresent: $("#panelPresent"), pResults: $("#panelResults"),
  // builder
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"), btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"),
  btnSaveQuiz: $("#btnSaveQuiz"), builder: $("#builder"),
  // options
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright: $("#chkBright"),
  timerSec: $("#timerSec"), btnTimerGo: $("#btnTimerGo"), btnTimerStop: $("#btnTimerStop"),
  btnSaveOptions: $("#btnSaveOptions"),
  // student connect
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),
  // present
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  btnFullscreen: $("#btnFullscreen"), leftSec_present: $("#leftSec_present"),
  cJoin: $("#cJoin"), cSubmit: $("#cSubmit"), cOk: $("#cOk"), cNo: $("#cNo"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pOpts: $("#pOpts"),
  // results
  btnExportCSV: $("#btnExportCSV"), btnLeaderboardOnly: $("#btnLeaderboardOnly"), resultsTable: $("#resultsTable"),
};
const S = {
  root: $("#studentRoot"),
  sLiveDot: $("#sLiveDot"), sRoomBadge: $("#sRoomBadge"), sStatus: $("#sStatus"),
  sName: $("#sName"), sBtnJoin: $("#sBtnJoin"),
  sQTitle: $("#sQTitle"), sQText: $("#sQText"),
  sMcqBox: $("#sMcqBox"), sMcq: $("#sMcq"), sMcqSubmit: $("#sMcqSubmit"),
  sShort: $("#sShort"), sShortInput: $("#sShortInput"), sShortSend: $("#sShortSend"),
  sResult: $("#sResult"), sHint: $("#sHint"),
};

/***********************
 * Local storage
 ***********************/
function saveLocal(){
  localStorage.setItem("quiz.live", JSON.stringify({ roomId, policy, bright: !!A.chkBright?.checked }));
  if(S_MODE && me.id) localStorage.setItem(`quiz.device.${roomId}`, JSON.stringify(me));
}
function loadLocal(){
  try{
    const d=JSON.parse(localStorage.getItem("quiz.live")||"{}");
    roomId=d.roomId||""; policy=d.policy||"device";
    if(A.chkBright) A.chkBright.checked = !!d.bright;
    if(roomId && A.roomId) A.roomId.value=roomId;
    if(roomId){ const m=JSON.parse(localStorage.getItem(`quiz.device.${roomId}`)||"null"); if(m){ me=m; } }
  }catch{}
}

/***********************
 * Firestore refs
 ***********************/
const roomRef = (id)=>doc(db,"rooms",id);
const respCol = (id)=>collection(db,"rooms",id,"responses");

/***********************
 * Connect / listen
 ***********************/
async function ensureRoom(id){
  const snap=await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false, createdAt:serverTimestamp(), questions:[]
    });
  }
}
function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom=onSnapshot(roomRef(id),(snap)=>{ if(!snap.exists()) return; roomCache=snap.data(); renderAll(); });
}
function listenResponses(id){
  if(unsubResp) unsubResp();
  unsubResp=onSnapshot(respCol(id),(qs)=>{ const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() })); respCache=arr; renderAll(); });
}
async function connect(){
  const id=(A.roomId?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId=id; await ensureRoom(roomId);
  listenRoom(roomId); listenResponses(roomId);
  setOnline(true);
  buildStudentLink(true);
  activateTab(A.tabBuild);
  A.roomId.disabled = true;          // ★ 접속 시 세션 입력 비활성
  saveLocal();
}
function setOnline(on){
  A.roomStatus && (A.roomStatus.textContent = on ? `세션: ${roomId} · 온라인` : "오프라인");
  A.liveDot?.classList.toggle("on", !!on);
  if(S.sStatus){ S.sStatus.textContent = on ? "온라인" : "오프라인"; S.sLiveDot?.classList.toggle("on", !!on); }
}
function logout(){
  roomId=""; setOnline(false);
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  A.roomId.disabled = false;         // ★ 세션아웃 시 다시 활성화
  if(A.studentLink) A.studentLink.value="";
  if(A.qrCanvas) { const ctx=A.qrCanvas.getContext?.('2d'); ctx && ctx.clearRect(0,0,A.qrCanvas.width,A.qrCanvas.height); }
  saveLocal(); location.search=""; location.reload();
}

/***********************
 * Tabs
 ***********************/
function activateTab(btn){
  [A.tabBuild,A.tabOptions,A.tabPresent,A.tabResults].forEach(b=>b?.classList.remove("active"));
  btn?.classList.add("active");
  A.pBuild?.classList.toggle("hide", btn!==A.tabBuild);
  A.pOptions?.classList.toggle("hide", btn!==A.tabOptions);
  A.pPresent?.classList.toggle("hide", btn!==A.tabPresent);
  A.pResults?.classList.toggle("hide", btn!==A.tabResults);
  document.body.classList.toggle("bright", !!A.chkBright?.checked && btn===A.tabPresent);
}

/***********************
 * Builder
 ***********************/
function qCard(no,q){
  const wrap=document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="chk"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'}> 객관식</label>
      <label class="chk"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''}> 주관식</label>
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항 내용" value="${q?.text||''}" />
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`<div style="flex:1"><input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기 ${i+1}" value="${v}"></div>`).join('')}
      </div>
      <div class="row gap8">
        <span class="muted">정답 번호</span>
        <input class="ansIndex input xs" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
      </div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <input class="ansText input" data-no="${no}" placeholder="정답(선택)" value="${q?.answerText||''}">
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
function collectQuiz(){
  const cards=$$("#builder>.qcard");
  const list=cards.map((c,idx)=>{
    const no=idx+1;
    const type=c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text=c.querySelector(".qtext").value.trim();
    if(!text) return null;
    if(type==='mcq'){
      const opts=$$(".opt",c).map(i=>i.value.trim()).filter(Boolean);
      const ans=Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans };
    } else {
      return { type:'short', text, answerText:c.querySelector(".ansText").value.trim() };
    }
  }).filter(Boolean);
  return { title: A.quizTitle?.value||"퀴즈", questions:list };
}

/***********************
 * Options / Timer
 ***********************/
function readPolicy(){ const p=document.querySelector('input[name="policy"]:checked'); policy=p?.value||"device"; }
function startTimer(sec){
  stopTimer();
  const end = Date.now()+sec*1000;
  timerHandle=setInterval(async ()=>{
    const remain=Math.max(0, Math.floor((end-Date.now())/1000));
    const t=`${pad(Math.floor(remain/60))}:${pad(remain%60)}`;
    if(A.leftSec_present) A.leftSec_present.textContent=t;
    const localLeft=$("#leftSec"); if(localLeft) localLeft.textContent=t;
    if(remain<=0){ stopTimer(); await updateDoc(roomRef(roomId), { accept:false }); setTimeout(()=> step(+1), 450); }
  }, 250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } if(A.leftSec_present) A.leftSec_present.textContent="00:00"; const l=$("#leftSec"); if(l) l.textContent="00:00"; }

/***********************
 * Present flow
 ***********************/
async function startQuiz(){ sSelectedIdx=null; await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true }); }
async function step(delta){
  sSelectedIdx=null;
  await runTransaction(db, async (tx)=>{
    const snap=await tx.get(roomRef(roomId)); const r=snap.data();
    const total=(r.questions?.length||0); let next=(r.currentIndex??-1)+delta;
    if(next>=total){ tx.update(roomRef(roomId), { currentIndex: total-1, mode:"ended", accept:false }); activateTab(A.tabResults); return; }
    next=Math.max(0,next); tx.update(roomRef(roomId), { currentIndex: next, accept:true });
  });
}
async function finishAll(){ if(confirm("퀴즈를 종료하고 결과 화면으로 이동할까요?")){ await updateDoc(roomRef(roomId), { mode:"ended", accept:false }); activateTab(A.tabResults); } }

/***********************
 * Student flows
 ***********************/
function studentView(on){ S.root.classList.toggle("hide", !on); A.adminRoot.classList.toggle("hide", on); }
function studentInitUI(){
  S.sRoomBadge.textContent = `세션 ${roomId}`;
  S.sStatus.textContent    = roomId ? "온라인":"오프라인";
  S.sLiveDot?.classList.toggle("on", !!roomId);
  S.sQTitle.textContent="대기 중…";
  S.sQText.textContent ="QR로 접속한 경우 먼저 이름(번호)을 입력하세요.";
  S.sMcq.innerHTML=""; S.sMcqBox.classList.add("hide");
  S.sShort.classList.add("hide"); S.sResult.classList.add("hide"); S.sHint.textContent="";
}
async function sJoin(){
  const name=(S.sName?.value||"").trim();
  if(!name) return alert("이름(또는 번호)을 입력하세요.");
  me = { id: localStorage.getItem(`did.${roomId}`) || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem(`did.${roomId}`, me.id);
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{} }, { merge:true });
  saveLocal();
  S.sHint.textContent="참가 완료! 시작을 기다려 주세요.";
}
async function sSubmitMCQ(){
  if(sSelectedIdx==null) return alert("보기를 선택하세요.");
  return sSubmit(sSelectedIdx);
}
async function sSubmit(value){
  if(!roomCache?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=roomCache.currentIndex; const q=roomCache.questions?.[idx]; if(!q) return;
  const ref=doc(respCol(roomId), me.id);
  const snap=await getDoc(ref); const prev=snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null){ S.sHint.textContent="이미 제출했습니다."; return; }
  if(policy==='realname'){
    const sameName = respCache.find(x=> x.name && x.name===me.name && x.answers?.[idx]!=null);
    if(sameName){ S.sHint.textContent="(실명 1회) 이미 제출된 이름입니다."; return; }
  }
  let correct=null;
  if(typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true), revealed: !!roomCache.reveal } }, { merge:true });
  S.sHint.textContent="제출 완료!";
}

/***********************
 * Render
 ***********************/
function renderRoom(){
  if(!roomCache) return;
  const r=roomCache; if(A.pTitle) A.pTitle.textContent=r.title||roomId;
  const idx=r.currentIndex, q=(idx>=0 && r.questions?.[idx])? r.questions[idx]:null;

  // 프레젠테이션 상단 문구(초기 안내) ★
  if(A.pQ) A.pQ.textContent = q ? q.text : "시작 버튼을 누르면 문항이 제시됩니다.";
  if(A.pOpts){
    A.pOpts.innerHTML="";
    if(q?.type==='mcq'){
      q.options.forEach((t,i)=>{ const d=document.createElement("div"); d.className="popt"; d.textContent=`${i+1}. ${t}`; A.pOpts.appendChild(d); });
    }
  }

  if(A.chkAccept) A.chkAccept.checked=!!r.accept;
  if(A.chkReveal) A.chkReveal.checked=!!r.reveal;
  if(A.roomStatus) A.roomStatus.textContent = roomId ? `세션: ${roomId} · 온라인` : "오프라인";
  A.liveDot?.classList.toggle("on", !!roomId);
}
function renderResults(){
  if(!roomCache || !A.resultsTable) return;
  const r=roomCache;
  const tbl=document.createElement("table");
  const thead=document.createElement("thead"), tr=document.createElement("tr");
  ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; tr.appendChild(th); });
  thead.appendChild(tr); tbl.appendChild(thead);

  const body=document.createElement("tbody");
  const rows = respCache.map(s=>{
    let score=0; (r.questions||[]).forEach((q,i)=>{ if(s.answers?.[i]?.correct) score++; });
    return { s, score };
  }).sort((a,b)=> b.score-a.score);

  rows.forEach(({s,score})=>{
    const tr=document.createElement("tr");
    const tdName=document.createElement("td"); tdName.textContent=s.name||s.id; tr.appendChild(tdName);
    (r.questions||[]).forEach((q,i)=>{
      const a=s.answers?.[i]; const td=document.createElement("td");
      td.textContent = a? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value??'-')) : '-';
      tr.appendChild(td);
    });
    const tdScore=document.createElement("td"); tdScore.textContent=String(score); tr.appendChild(tdScore);
    body.appendChild(tr);
  });

  tbl.appendChild(body); A.resultsTable.innerHTML=""; A.resultsTable.appendChild(tbl);
}
function renderCounters(){
  if(!roomCache) return;
  const r=roomCache, idx=r.currentIndex;
  const joined=respCache.length; let submitted=0, ok=0, no=0;
  respCache.forEach(s=>{ const a=s.answers?.[idx]; if(a!=null){ submitted++; if(a.correct) ok++; else no++; }});
  if(A.cJoin){ A.cJoin.textContent=joined; A.cSubmit.textContent=submitted; A.cOk.textContent=ok; A.cNo.textContent=no; }
}
function renderStudent(){
  if(!S_MODE || !roomCache) return;
  const r=roomCache, idx=r.currentIndex, q=(idx>=0 && r.questions?.[idx])? r.questions[idx]:null;

  // 종료 → 개인결과
  if(r.mode==='ended'){
    S.sMcqBox.classList.add("hide"); S.sShort.classList.add("hide");
    if(me.id){
      const mine = respCache.find(x=>x.id===me.id);
      let score=0; const rows=(r.questions||[]).map((qq,i)=>{
        const a=mine?.answers?.[i];
        const val = a ? (qq.type==='mcq' ? (typeof a.value==='number'? (a.value+1) : '-') : (a.value??'-')) : '-';
        const ok  = a?.correct===true; if(ok) score++; return {no:i+1,val,ok};
      });
      S.sResult.innerHTML = `
        <h3>내 결과</h3>
        <p class="muted">이름: <b>${mine?.name||'-'}</b> · 점수: <b>${score}</b></p>
        <table class="mt12"><thead><tr><th>문항</th><th>제출</th><th>정답</th></tr></thead>
          <tbody>${rows.map(r=>`<tr><td>${r.no}</td><td>${r.val}</td><td>${r.ok?'○':'×'}</td></tr>`).join('')}</tbody>
        </table>`;
      S.sResult.classList.remove("hide");
      S.sQTitle.textContent=r.title||roomId; S.sQText.textContent="퀴즈가 종료되었습니다.";
      S.sHint.textContent="";
    }
    return;
  }

  // 진행 전/대기
  S.sResult.classList.add("hide");
  S.sQTitle.textContent = r.title || roomId;

  if(!q || r.mode!=='active'){
    S.sQText.textContent="대기 중입니다…";
    S.sMcqBox.classList.add("hide"); S.sShort.classList.add("hide");
    return;
  }

  // 시작 후 안내 문구 ★
  S.sQText.textContent=q.text;
  if(r.accept) {
    S.sHint.textContent="제출 버튼을 눌러주세요.";
  } else {
    S.sHint.textContent="";
  }

  sSelectedIdx=null; S.sMcqSubmit.disabled=true;

  if(q.type==='mcq'){
    S.sMcq.innerHTML="";
    q.options.forEach((opt,i)=>{
      const b=document.createElement("div");
      b.className="opt"; b.textContent=`${i+1}. ${opt}`;
      if(!r.accept) b.classList.add("disabled");
      b.onclick=()=>{
        if(!r.accept) return;
        sSelectedIdx = i;
        Array.from(S.sMcq.children).forEach(x=>x.classList.remove("sel"));
        b.classList.add("sel");
        S.sMcqSubmit.disabled=false;
      };
      S.sMcq.appendChild(b);
    });
    S.sMcqBox.classList.remove("hide"); S.sShort.classList.add("hide");
  } else {
    S.sMcqBox.classList.add("hide");
    S.sShort.classList.remove("hide");
    S.sShortSend.disabled = !r.accept;
  }
}
function renderAll(){ renderRoom(); renderResults(); renderCounters(); renderStudent(); }

/***********************
 * Student link / QR
 ***********************/
function buildStudentLink(alsoQR=false){
  if(!A.studentLink) return;
  if(!roomId){ A.studentLink.value=""; return; }
  const url=new URL(location.href); url.searchParams.set("role","student"); url.searchParams.set("room", roomId);
  A.studentLink.value=url.toString();
  if(alsoQR && window.QRCode && A.qrCanvas){
    window.QRCode.toCanvas(A.qrCanvas, A.studentLink.value, {width:220}, (err)=>{ if(err) console.warn(err); });
  }
}

/***********************
 * Events
 ***********************/
A.btnConnect?.addEventListener("click", connect);
A.roomId?.addEventListener("change", ()=>{ roomId=A.roomId.value.trim(); buildStudentLink(true); saveLocal(); });
A.btnLogout?.addEventListener("click", logout);

A.tabBuild?.addEventListener("click", ()=>activateTab(A.tabBuild));
A.tabOptions?.addEventListener("click", ()=>activateTab(A.tabOptions));
A.tabPresent?.addEventListener("click", ()=>activateTab(A.tabPresent));
A.tabResults?.addEventListener("click", ()=>activateTab(A.tabResults));

A.btnBuildForm?.addEventListener("click", ()=>{
  const n=Math.max(1,Math.min(20, parseInt(A.questionCount?.value,10)||3));
  if(A.builder){ A.builder.innerHTML=""; for(let i=0;i<n;i++) A.builder.appendChild(qCard(i+1)); }
});
A.btnLoadSample?.addEventListener("click", ()=>{
  const SAMP=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)은?', answerText:'100'},
    {type:'mcq', text:'대한민국 수도?', options:['부산','인천','서울','대전'], answerIndex:2},
  ];
  if(A.builder){ A.builder.innerHTML=""; SAMP.forEach((q,i)=>A.builder.appendChild(qCard(i+1,q))); }
  if(A.quizTitle) A.quizTitle.value="샘플 퀴즈"; if(A.questionCount) A.questionCount.value=SAMP.length;
});
A.btnSaveQuiz?.addEventListener("click", async ()=>{
  if(!roomId) return alert("먼저 세션에 접속하세요.");
  const payload=collectQuiz(); if(!payload.questions.length) return alert("문항을 추가하세요.");
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("문항 저장 완료!");
});

A.btnSaveOptions?.addEventListener("click", async ()=>{
  if(!roomId) return alert("먼저 세션에 접속하세요.");
  readPolicy();
  await updateDoc(roomRef(roomId), { accept: !!A.chkAccept.checked, reveal: !!A.chkReveal.checked, policy });
  buildStudentLink(true);          // ★ 옵션 저장 후 링크/QR 갱신
  saveLocal();
  alert("옵션 저장 완료!");
});

A.chkBright?.addEventListener("change", ()=>{
  document.body.classList.toggle("bright", !!A.chkBright.checked && !A.pPresent.classList.contains("hide"));
  saveLocal();
});
A.btnTimerGo?.addEventListener("click", ()=> startTimer(Math.max(5,Math.min(600, parseInt(A.timerSec?.value,10)||30))));
A.btnTimerStop?.addEventListener("click", stopTimer);

A.btnCopyLink?.addEventListener("click", async ()=>{
  if(!A.studentLink?.value) return;
  await navigator.clipboard.writeText(A.studentLink.value);
  A.btnCopyLink.textContent="복사됨"; setTimeout(()=> A.btnCopyLink.textContent="복사", 1200);
});
A.btnOpenStudent?.addEventListener("click", ()=> window.open(A.studentLink?.value||"#","_blank"));

A.btnStart?.addEventListener("click", ()=>{ activateTab(A.tabPresent); startQuiz(); });
A.btnPrev?.addEventListener("click", ()=> step(-1));
A.btnNext?.addEventListener("click", ()=> step(+1));
A.btnEndAll?.addEventListener("click", finishAll);

A.btnFullscreen?.addEventListener("click", ()=>{
  const tgt=$("#presentStage"); if(!document.fullscreenElement){ (tgt||document.documentElement).requestFullscreen?.(); } else { document.exitFullscreen?.(); }
});

A.btnExportCSV?.addEventListener("click", async ()=>{
  if(!roomId) return;
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
A.btnLeaderboardOnly?.addEventListener("click", ()=>{ activateTab(A.tabResults); window.scrollTo({top:0,behavior:'smooth'}); });

/***********************
 * Student events
 ***********************/
S.sBtnJoin?.addEventListener("click", sJoin);
S.sMcqSubmit?.addEventListener("click", sSubmitMCQ);
S.sShortSend?.addEventListener("click", ()=> sSubmit((S.sShortInput?.value||"").trim()));

/***********************
 * Boot
 ***********************/
(function init(){
  const url=new URL(location.href); const role=url.searchParams.get("role"); const rid=url.searchParams.get("room");
  S_MODE = (role==='student');
  if(S_MODE){
    $("#adminRoot")?.classList.add("hide");
    S.root.classList.remove("hide");
    if(rid){ roomId=rid; } else { S.sQText.textContent="링크에 room 파라미터가 없습니다."; return; }
    setOnline(true); studentInitUI();
    S.sName?.focus();
    listenRoom(roomId); listenResponses(roomId);
    return;
  }

  loadLocal();
  activateTab(A.tabBuild);   // 접속 시 기본 탭
  if(roomId){ connect(); }
})();
