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

let roomId="";                      // 세션
let timerHandle=null;               // 타이머
let policy="device";                // device | realname

const els = {
  liveDot: $("#liveDot"),
  roomId: $("#roomId"),
  btnConnect: $("#btnConnect"),
  roomStatus: $("#roomStatus"),
  btnLogout: $("#btnLogout"),

  // 탭
  tabBuild: $("#tabBuild"),
  tabOptions: $("#tabOptions"),
  tabPresent: $("#tabPresent"),
  tabResults: $("#tabResults"),

  // 패널
  pBuild: $("#panelBuild"),
  pOptions: $("#panelOptions"),
  pPresent: $("#panelPresent"),
  pResults: $("#panelResults"),

  // 빌더
  quizTitle: $("#quizTitle"),
  questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"),
  btnLoadSample: $("#btnLoadSample"),
  btnSaveQuiz: $("#btnSaveQuiz"),
  builder: $("#builder"),

  // 옵션
  chkAccept: $("#chkAccept"),
  chkReveal: $("#chkReveal"),
  chkBright: $("#chkBright"),
  timerSec: $("#timerSec"),
  btnTimerGo: $("#btnTimerGo"),
  btnTimerStop: $("#btnTimerStop"),
  btnSaveOptions: $("#btnSaveOptions"),

  // 학생 접속
  qrCanvas: $("#qrCanvas"),
  studentLink: $("#studentLink"),
  btnCopyLink: $("#btnCopyLink"),
  btnOpenStudent: $("#btnOpenStudent"),

  // 프레젠테이션
  btnStart: $("#btnStart"),
  btnPrev: $("#btnPrev"),
  btnNext: $("#btnNext"),
  btnEndAll: $("#btnEndAll"),
  btnFullscreen: $("#btnFullscreen"),
  leftSec_present: $("#leftSec_present"),
  presentCounters: $("#presentCounters"),
  pTitle: $("#pTitle"),
  pQ: $("#pQ"),
  pOpts: $("#pOpts"),

  // 결과
  btnExportCSV: $("#btnExportCSV"),
  btnLeaderboardOnly: $("#btnLeaderboardOnly"),
  resultsTable: $("#resultsTable"),
};

/***********************
 * Local cache
 ***********************/
function saveLocal(){
  localStorage.setItem("quiz.live", JSON.stringify({
    roomId,
    policy,
    bright: !!els.chkBright?.checked
  }));
}
function loadLocal(){
  try{
    const d=JSON.parse(localStorage.getItem("quiz.live")||"{}");
    roomId=d.roomId||"";
    policy=d.policy||"device";
    if(els.chkBright) els.chkBright.checked = !!d.bright;
    if(roomId && els.roomId) els.roomId.value=roomId;
  }catch{}
}

/***********************
 * Firestore refs
 ***********************/
const roomRef = (id)=>doc(db,"rooms",id);
const respCol = (id)=>collection(db,"rooms",id,"responses");

/***********************
 * Session / Connect
 ***********************/
async function ensureRoom(id){
  const snap=await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false,
      createdAt: serverTimestamp(), questions:[]
    });
  }
}
let unsubRoom=null, unsubResp=null, roomCache=null, respCache=[];
function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom=onSnapshot(roomRef(id),(snap)=>{
    if(!snap.exists()) return;
    roomCache=snap.data();
    renderRoom();
  });
}
function listenResponses(id){
  if(unsubResp) unsubResp();
  unsubResp=onSnapshot(respCol(id),(qs)=>{
    const list=[]; qs.forEach(d=>list.push({ id:d.id, ...d.data() }));
    respCache=list;
    renderResponses();
    renderCounters();
  });
}

async function connect(){
  const id=(els.roomId?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId=id; await ensureRoom(roomId);
  listenRoom(roomId); listenResponses(roomId);
  buildStudentLink(true);
  setOnline(true);
  activateTab(els.tabBuild); // 접속 후 문항만들기 탭 기본
  saveLocal();
}
function setOnline(on){
  els.roomStatus && (els.roomStatus.textContent = on ? `세션: ${roomId} · 온라인` : "오프라인");
  els.liveDot?.classList.toggle("on", !!on);
}
function logout(){
  roomId=""; saveLocal();
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  setOnline(false);
}

/***********************
 * Tabs
 ***********************/
function activateTab(btn){
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
  btn?.classList.add("active");
  els.pBuild?.classList.toggle("hide", btn!==els.tabBuild);
  els.pOptions?.classList.toggle("hide", btn!==els.tabOptions);
  els.pPresent?.classList.toggle("hide", btn!==els.tabPresent);
  els.pResults?.classList.toggle("hide", btn!==els.tabResults);

  // 프레젠테이션/결과에선 가이드/학생영역 숨김 (index 구조상 Options 패널에만 가이드 존재)
  // 여기서는 별도 숨길 요소가 없어도 레이아웃이 깔끔하게 유지됩니다.

  // 밝은 모드 적용
  document.body.classList.toggle("bright", !!els.chkBright?.checked && btn===els.tabPresent);
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
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기 ${i+1}" value="${v}">`).join('')}
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
  const radios = $$(`input[name="type-${no}"]`, wrap);
  const mcq = $(".mcq",wrap), short=$(".short",wrap);
  radios.forEach(r=> r.addEventListener("change", ()=>{
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
      const ans = Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans };
    } else {
      return { type:'short', text, answerText:c.querySelector(".ansText").value.trim() };
    }
  }).filter(Boolean);
  return { title: els.quizTitle?.value||"퀴즈", questions:list };
}

/***********************
 * Options / Timer / Policy
 ***********************/
function readPolicy(){
  const p=document.querySelector('input[name="policy"]:checked');
  policy=p?.value||"device";
}
function startTimer(sec){
  stopTimer();
  const end = Date.now()+sec*1000;
  timerHandle=setInterval(async ()=>{
    const remain=Math.max(0, Math.floor((end-Date.now())/1000));
    const m=pad(Math.floor(remain/60)), s=pad(remain%60);
    const t=`${m}:${s}`;
    const a=els.leftSec_present; if(a) a.textContent=t;
    if(remain<=0){
      stopTimer();
      await updateDoc(roomRef(roomId), { accept:false });
      setTimeout(()=> step(+1), 450);
    }
  }, 250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } if(els.leftSec_present) els.leftSec_present.textContent="00:00"; }

/***********************
 * Present flow
 ***********************/
async function startQuiz(){ await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true }); }
async function step(delta){
  await runTransaction(db, async (tx)=>{
    const snap=await tx.get(roomRef(roomId));
    const r=snap.data(); const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){
      tx.update(roomRef(roomId), { currentIndex: total-1, mode:"ended", accept:false });
      activateTab(els.tabResults);
      return;
    }
    next=Math.max(0,next);
    tx.update(roomRef(roomId), { currentIndex: next, accept:true });
  });
}
async function finishAll(){
  if(confirm("퀴즈를 종료하고 결과 화면으로 이동할까요?")){
    await updateDoc(roomRef(roomId), { mode:"ended", accept:false });
    activateTab(els.tabResults);
  }
}

/***********************
 * Render
 ***********************/
function renderRoom(){
  if(!roomCache) return;
  const r=roomCache;
  els.pTitle && (els.pTitle.textContent = r.title||roomId);

  // 프레젠테이션: 문제/옵션
  const idx=r.currentIndex, total=r.questions?.length||0;
  const q = (idx>=0 && r.questions[idx]) ? r.questions[idx] : null;
  els.pQ && (els.pQ.textContent = q ? q.text : "대기 중…");
  if(els.pOpts){
    els.pOpts.innerHTML="";
    if(q?.type==='mcq'){
      q.options.forEach((t,i)=>{ const d=document.createElement("div"); d.className="popt"; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d); });
    }
  }

  // 옵션 체크 표시 반영
  if(els.chkAccept) els.chkAccept.checked=!!r.accept;
  if(els.chkReveal) els.chkReveal.checked=!!r.reveal;

  // 상단 상태
  if(els.roomStatus) els.roomStatus.textContent = roomId ? `세션: ${roomId} · 온라인` : "오프라인";
  els.liveDot?.classList.toggle("on", !!roomId);
}

function renderResponses(){
  if(!roomCache) return;
  const r=roomCache;

  // 결과표
  if(els.resultsTable){
    const tbl=document.createElement("table");
    const thead=document.createElement("thead"), tr=document.createElement("tr");
    ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; tr.appendChild(th); });
    thead.appendChild(tr); tbl.appendChild(thead);

    const body=document.createElement("tbody");
    // 점수 계산 + 정렬 (리더보드)
    const rows = respCache.map(s=>{
      let score=0;
      (r.questions||[]).forEach((q,i)=>{ if(s.answers?.[i]?.correct) score++; });
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

    tbl.appendChild(body);
    els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
  }
}

function renderCounters(){
  if(!roomCache || !els.presentCounters) return;
  const r=roomCache, idx=r.currentIndex;
  const joined = respCache.length;
  let submitted=0, ok=0, no=0;
  respCache.forEach(s=>{
    const a=s.answers?.[idx];
    if(a!=null){ submitted++; if(a.correct) ok++; else no++; }
  });
  els.presentCounters.textContent = `참가 ${joined} · 제출 ${submitted} · 정답 ${ok} · 오답 ${no}`;
}

/***********************
 * Student Link / QR (옵션 저장 후 반드시 표시)
 ***********************/
function buildStudentLink(alsoQR=false){
  if(!els.studentLink) return;
  if(!roomId){ els.studentLink.value=""; return; }
  const url=new URL(location.href); url.searchParams.set("role","student"); url.searchParams.set("room", roomId);
  els.studentLink.value = url.toString();
  if(alsoQR){
    try{
      if(window.QRCode && els.qrCanvas){
        window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, {width:220}, (err)=>{ if(err) console.warn(err); });
      }
    }catch(e){ console.warn(e); }
  }
}

/***********************
 * Events
 ***********************/
els.btnConnect?.addEventListener("click", connect);
els.btnLogout?.addEventListener("click", ()=>{ logout(); location.reload(); });

els.tabBuild?.addEventListener("click", ()=>activateTab(els.tabBuild));
els.tabOptions?.addEventListener("click", ()=>activateTab(els.tabOptions));
els.tabPresent?.addEventListener("click", ()=>activateTab(els.tabPresent));
els.tabResults?.addEventListener("click", ()=>activateTab(els.tabResults));

els.btnBuildForm?.addEventListener("click", ()=>{
  const n=Math.max(1,Math.min(20, parseInt(els.questionCount?.value,10)||3));
  if(els.builder){ els.builder.innerHTML=""; for(let i=0;i<n;i++) els.builder.appendChild(qCard(i+1)); }
});
els.btnLoadSample?.addEventListener("click", ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)은?', answerText:'100'},
    {type:'mcq', text:'대한민국의 수도는?', options:['부산','인천','서울','대전'], answerIndex:2},
  ];
  if(els.builder){ els.builder.innerHTML=""; S.forEach((q,i)=>els.builder.appendChild(qCard(i+1,q))); }
  if(els.quizTitle) els.quizTitle.value="샘플 퀴즈";
  if(els.questionCount) els.questionCount.value=S.length;
});
els.btnSaveQuiz?.addEventListener("click", async ()=>{
  if(!roomId) return alert("먼저 세션에 접속하세요.");
  const payload=collectQuiz(); if(!payload.questions.length) return alert("문항을 추가하세요.");
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("문항 저장 완료!");
});

els.btnSaveOptions?.addEventListener("click", async ()=>{
  if(!roomId) return alert("먼저 세션에 접속하세요.");
  readPolicy();
  await updateDoc(roomRef(roomId), {
    accept: !!els.chkAccept?.checked,
    reveal: !!els.chkReveal?.checked,
    policy
  });
  // 저장 직후 학생 QR/링크 표시
  buildStudentLink(true);
  saveLocal();
  alert("옵션 저장 완료!");
});

els.chkBright?.addEventListener("change", ()=>{
  document.body.classList.toggle("bright", !!els.chkBright.checked && !els.pPresent.classList.contains("hide"));
  saveLocal();
});

els.btnTimerGo?.addEventListener("click", ()=> startTimer(Math.max(5,Math.min(600, parseInt(els.timerSec?.value,10)||30))));
els.btnTimerStop?.addEventListener("click", stopTimer);

els.btnCopyLink?.addEventListener("click", async ()=>{
  if(!els.studentLink?.value) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="복사", 1200);
});
els.btnOpenStudent?.addEventListener("click", ()=> window.open(els.studentLink?.value||"#","_blank"));

els.btnStart?.addEventListener("click", ()=>{ activateTab(els.tabPresent); startQuiz(); });
els.btnPrev?.addEventListener("click", ()=> step(-1));
els.btnNext?.addEventListener("click", ()=> step(+1));
els.btnEndAll?.addEventListener("click", finishAll);

els.btnFullscreen?.addEventListener("click", ()=>{
  const tgt=$("#presentStage");
  if(!document.fullscreenElement){ (tgt||document.documentElement).requestFullscreen?.(); }
  else { document.exitFullscreen?.(); }
});

els.btnExportCSV?.addEventListener("click", async ()=>{
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

els.btnLeaderboardOnly?.addEventListener("click", ()=>{
  // 결과 표만 꽉 차게
  activateTab(els.tabResults);
  window.scrollTo({top:0,behavior:'smooth'});
});

/***********************
 * Boot
 ***********************/
(function init(){
  loadLocal();
  // 최초 화면: 문항만들기 탭
  activateTab(els.tabBuild);
  if(roomId){ connect(); }
})();
