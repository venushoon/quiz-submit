/***********************
 * Firebase (모듈)
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

let MODE   = "admin";           // 'admin' | 'student'  ← 기본을 'admin'으로
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;
let selectedChoiceIndex = null; // 학생 객관식 선택값

const els = {
  // header
  roomName: $("#roomName"), roomState: $("#roomState"),
  adminControls: $("#adminControls"), studentJoinBox: $("#studentJoinBox"),
  roomId: $("#roomId"), btnConnect: $("#btnConnect"),
  btnAdmin: $("#btnAdmin"), btnStudent: $("#btnStudent"),
  studentName: $("#studentName"), btnJoin: $("#btnJoin"),

  // admin tabs + panels
  adminTabs: $("#adminTabs"),
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  panelBuild: $("#panelBuild"), panelOptions: $("#panelOptions"),
  panelPresent: $("#panelPresent"), panelResults: $("#panelResults"),

  // builder
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"),
  builder: $("#builder"),

  // options
  chkPolicyDevice: $("#chkPolicyDevice"), chkPolicyName: $("#chkPolicyName"),
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"),
  chkAutoNext: $("#chkAutoNext"), timerSec: $("#timerSec"),
  btnSaveOptions: $("#btnSaveOptions"),
  qrBox: $("#qrBox"), qrCanvas: $("#qrCanvas"),
  studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

  // present
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  leftSec: $("#leftSec"), btnTimerGo: $("#btnTimerGo"), btnTimerStop: $("#btnTimerStop"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pOpts: $("#pOpts"), progress: $("#progress"),

  // results
  chips: $("#chips"), shortAnswers: $("#shortAnswers"), resultsTable: $("#resultsTable"),
  leaderboard: $("#leaderboard"), goldenBell: $("#goldenBell"),
  btnExportCSV: $("#btnExportCSV"), btnSaveJSON: $("#btnSaveJSON"), fileLoad: $("#fileLoad"),
  btnResetAll: $("#btnResetAll"),

  // student view
  studentPanel: $("#studentPanel"),
  sTitle: $("#sTitle"), sQText: $("#sQText"), sTimer: $("#sTimer"),
  sMcqBox: $("#sMcqBox"), sShortBox: $("#sShortBox"), shortInput: $("#shortInput"),
  btnShortSend: $("#btnShortSend"), btnSubmitChoice: $("#btnSubmitChoice"), submitHint: $("#submitHint"),
};

Object.keys(els).forEach(k=>{ if(!els[k]) console.warn("[missing]",k); });

/***********************
 * Local cache
 ***********************/
function saveLocal(){ localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me })); }
function loadLocal(){
  try{
    const d=JSON.parse(localStorage.getItem("quiz.live")||"{}");
    roomId=d.roomId||""; /* MODE는 URL 우선 정책으로 강제 설정하므로 여기서 복원하지 않음 */
    me=d.me||{id:null,name:""};
    if(roomId && els.roomId) els.roomId.value=roomId;
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
      policy:"device", autoNext:false, timerSec:30, createdAt: serverTimestamp(), questions:[]
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
  // 상단 컨트롤 표시
  els.adminControls?.classList.toggle("hide", m!=="admin");
  els.studentJoinBox?.classList.toggle("hide", m!=="student");

  // 탭/패널 표시
  els.adminTabs?.classList.toggle("hide", m!=="admin");
  els.panelBuild?.classList.toggle("hide", m!=="admin");
  els.panelOptions?.classList.toggle("hide", m!=="admin");
  els.panelResults?.classList.toggle("hide", m!=="admin");
  els.panelPresent?.classList.toggle("hide", m!=="admin");

  // 학생 패널 표시
  els.studentPanel?.classList.toggle("hide", m!=="student");

  // 헤더 상태
  els.roomName && (els.roomName.textContent = `세션: ${roomId||'-'}`);
  els.roomState && (els.roomState.className = `state ${roomId?'on':'off'}`);
  els.roomState && (els.roomState.textContent = roomId? "온라인":"오프라인");

  // 기본 활성 탭
  if(m==='admin'){
    [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
    els.tabPresent?.classList.add("active");
    showPanel("present");
  }
  saveLocal();
}

async function connect(){
  const id=(els.roomId?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId=id; await ensureRoom(roomId);
  listenRoom(roomId); listenResponses(roomId);
  els.roomName && (els.roomName.textContent = `세션: ${roomId}`);
  els.roomState && (els.roomState.className = "state on");
  els.roomState && (els.roomState.textContent = "온라인");
  saveLocal();
  // 옵션 로드 → 토글값 반영
  const r=(await getDoc(roomRef(roomId))).data();
  if(r){
    (r.policy==="name" ? els.chkPolicyName : els.chkPolicyDevice).checked = true;
    if(els.chkAutoNext) els.chkAutoNext.checked = !!r.autoNext;
    if(els.chkAccept)   els.chkAccept.checked   = !!r.accept;
    if(els.chkReveal)   els.chkReveal.checked   = !!r.reveal;
    if(els.timerSec)    els.timerSec.value      = String(r.timerSec ?? 30);
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
      <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'} /><span>객관식</span></label>
      <label class="switch"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''} /><span>주관식</span></label>
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항 내용" value="${q?.text||''}" />
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기 ${i+1}" value="${v}">`).join('')}
      </div>
      <div class="row">
        <span class="hint">정답 번호</span>
        <input class="ansIndex input xs" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
      </div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <input class="ansText input" data-no="${no}" placeholder="정답(선택, 자동채점용)" value="${q?.answerText||''}">
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
 * Flow + Timer(자동 다음)
 ***********************/
async function startQuiz(){ 
  await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true });
}
async function step(delta){
  await runTransaction(db, async (tx)=>{
    const ref=roomRef(roomId);
    const snap=await tx.get(ref);
    const r=snap.data(); const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){ // 종료
      tx.update(ref, { currentIndex: total-1, mode:"ended", accept:false });
      setTimeout(()=> switchToResults(), 200);
      return;
    }
    next=Math.max(0,next);
    tx.update(ref, { currentIndex: next, accept:true });
  });
}
async function finishAll(){
  if(!confirm("퀴즈를 종료할까요?")) return;
  await updateDoc(roomRef(roomId), { mode:"ended", accept:false });
  switchToResults();
}
function switchToResults(){
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
  els.tabResults?.classList.add("active");
  showPanel("results");
}

function startTimer(sec){
  stopTimer();
  const end = Date.now()+sec*1000;
  timerHandle=setInterval(async ()=>{
    const remain=Math.max(0, Math.floor((end-Date.now())/1000));
    els.leftSec && (els.leftSec.textContent = `${pad(Math.floor(remain/60))}:${pad(remain%60)}`);
    if(remain<=0){
      stopTimer();
      const r=window.__room||{};
      await updateDoc(roomRef(roomId), { accept:false });
      if(r.autoNext){ setTimeout(()=> step(+1), 500); }
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
  // 정책에 따라 id 결정
  const r=(await getDoc(roomRef(roomId))).data()||{};
  let id;
  if(r.policy==="name"){
    id = `name:${name}`;
  }else{
    id = localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10);
    localStorage.setItem("quiz.device", id);
  }
  me = { id, name };
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{}, alive:true }, { merge:true });
  alert("참가 완료! 시작을 기다려 주세요.");
  saveLocal();
}
async function submitChoice(){
  if(selectedChoiceIndex==null) return alert("보기를 선택하세요.");
  await submit(selectedChoiceIndex);
  els.btnSubmitChoice && (els.btnSubmitChoice.disabled=true);
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
async function grade(uid, qIndex, ok){
  await setDoc(doc(respCol(roomId), uid), { [`answers.${qIndex}.correct`]: !!ok, [`answers.${qIndex}.revealed`]: true }, { merge:true });
}

/***********************
 * GoldenBell(탈락/부활) & Leaderboard
 ***********************/
async function setAlive(uid, alive){
  await setDoc(doc(respCol(roomId), uid), { alive: !!alive }, { merge:true });
}
function computeScores(room, list){
  const qs = room.questions||[];
  return list.map(s=>{
    let score=0;
    qs.forEach((q,i)=>{ if(s.answers?.[i]?.correct) score++; });
    return { id:s.id, name:s.name||s.id, score, alive: s.alive!==false };
  });
}
function renderLeaderboardSorted(room, list){
  if(!els.leaderboard) return;
  const rows = computeScores(room, list)
    .sort((a,b)=> b.score-a.score || (a.name||'').localeCompare(b.name||''));
  const tbl=document.createElement("table");
  const thead=document.createElement("thead"), tr=document.createElement("tr");
  ["순위","이름","점수","상태"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; tr.appendChild(th); });
  thead.appendChild(tr); tbl.appendChild(thead);
  const tb=document.createElement("tbody");
  rows.forEach((x,i)=>{
    const tr=document.createElement("tr");
    [i+1, x.name, x.score, x.alive?"alive":"out"].forEach(v=>{
      const td=document.createElement("td"); td.textContent=String(v); tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  els.leaderboard.innerHTML=""; els.leaderboard.appendChild(tbl);
}
function renderGoldenBell(room, list){
  if(!els.goldenBell) return;
  els.goldenBell.innerHTML="";
  const rows = computeScores(room, list)
    .sort((a,b)=> (a.alive===b.alive? 0 : a.alive?-1:1) || (a.name||'').localeCompare(b.name||''));
  rows.forEach(x=>{
    const row=document.createElement("div"); row.className="row between";
    const left=document.createElement("div"); left.textContent=`${x.name} · ${x.alive?"alive":"out"}`;
    const right=document.createElement("div");
    const btnOut=document.createElement("button"); btnOut.className="btn ghost"; btnOut.textContent="탈락";
    const btnRev=document.createElement("button"); btnRev.className="btn ghost"; btnRev.textContent="부활";
    btnOut.onclick=()=>setAlive(x.id,false);
    btnRev.onclick=()=>setAlive(x.id,true);
    right.append(btnOut,btnRev);
    row.append(left,right);
    els.goldenBell.appendChild(row);
  });
}

/***********************
 * Render
 ***********************/
function renderRoom(r){
  // 공통 상태
  els.roomName && (els.roomName.textContent = `세션: ${roomId||'-'}`);
  els.roomState && (els.roomState.className = `state ${roomId?'on':'off'}`);
  els.roomState && (els.roomState.textContent = roomId? "온라인":"오프라인");

  const total=r.questions?.length||0; const idx=r.currentIndex;
  els.progress && (els.progress.textContent = `${Math.max(0,idx+1)}/${total}`);

  // 옵션 토글 미러
  if(els.chkAccept) els.chkAccept.checked=!!r.accept;
  if(els.chkReveal) els.chkReveal.checked=!!r.reveal;

  // 프레젠테이션(관리자)
  if(els.pTitle) els.pTitle.textContent = r.title||roomId||"-";
  if(els.pQ && els.pOpts){
    els.pOpts.innerHTML="";
    if(r.mode==="active" && idx>=0 && r.questions[idx]){
      const q=r.questions[idx]; els.pQ.textContent=q.text;
      if(q.type==='mcq'){
        q.options.forEach((t,i)=>{ const d=document.createElement("div"); d.className="popt"; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d); });
      } else {
        els.pQ.textContent = q.text + " (주관식)";
      }
    } else {
      els.pQ.textContent="대기 중입니다…";
    }
  }

  // 학생 화면
  if(MODE==='student'){
    selectedChoiceIndex = null;
    if(els.btnSubmitChoice) els.btnSubmitChoice.disabled = true;

    els.sTitle && (els.sTitle.textContent = r.title||roomId||"-");

    if(r.mode!=="active" || idx<0){
      els.sQText && (els.sQText.textContent="대기 중입니다…");
      els.sMcqBox && (els.sMcqBox.innerHTML="");
      els.sShortBox && els.sShortBox.classList.add("hide");
      return;
    }
    const q=r.questions[idx];
    els.sQText && (els.sQText.textContent=q.text);

    if(q.type==='mcq'){
      els.sMcqBox && (els.sMcqBox.innerHTML="");
      q.options.forEach((opt,i)=>{
        const b=document.createElement("button");
        b.className="optbtn"; b.textContent=`${i+1}. ${opt}`; b.disabled=!r.accept;
        b.addEventListener("click", ()=>{
          if(!r.accept) return;
          selectedChoiceIndex = i;
          $$(".optbtn", els.sMcqBox).forEach(x=>x.classList.remove("sel"));
          b.classList.add("sel");
          if(els.btnSubmitChoice) els.btnSubmitChoice.disabled=false;
        });
        els.sMcqBox.appendChild(b);
      });
      els.sShortBox && els.sShortBox.classList.add("hide");
    } else {
      els.sMcqBox && (els.sMcqBox.innerHTML="");
      if(els.sShortBox){
        els.sShortBox.classList.remove("hide");
        if(els.btnShortSend) els.btnShortSend.disabled = !r.accept;
      }
    }
  }
}

function renderResponses(list){
  if(MODE!=='admin') return;
  const r=window.__room||{}; const idx=r.currentIndex; const q=r.questions?.[idx];

  // 칩
  if(els.chips){
    els.chips.innerHTML="";
    list.forEach(s=>{
      const a=s.answers?.[idx]; const chip=document.createElement("div");
      chip.className="chip " + (a? (a.correct?'ok':'no') : 'wait');
      chip.textContent=s.name||s.id; els.chips.appendChild(chip);
    });
  }

  // 주관식 채점
  if(els.shortAnswers){
    els.shortAnswers.innerHTML="";
    if(q && q.type==='short'){
      list.forEach(s=>{
        const a=s.answers?.[idx]; if(!a || typeof a.value!=='string') return;
        const row=document.createElement("div"); row.className="row between";
        row.innerHTML=`<span>${s.name}: ${a.value}</span>`;
        const box=document.createElement("div");
        const ok=document.createElement("button"); ok.className="btn ghost"; ok.textContent="정답";
        const no=document.createElement("button"); no.className="btn ghost"; no.textContent="오답";
        ok.onclick=()=>grade(s.id, idx, true); no.onclick=()=>grade(s.id, idx, false);
        box.append(ok,no); row.append(box); els.shortAnswers.appendChild(row);
      });
    }
  }

  // 리더보드 + 골든벨
  renderLeaderboardSorted(r, list);
  renderGoldenBell(r, list);

  // 전체 결과표
  if(els.resultsTable){
    const tbl=document.createElement("table");
    const thead=document.createElement("thead"), tr=document.createElement("tr");
    ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수","상태"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; tr.appendChild(th); });
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb=document.createElement("tbody");
    list.forEach(s=>{
      let score=0; const tr=document.createElement("tr");
      const tdn=document.createElement("td"); tdn.textContent=s.name||s.id; tr.appendChild(tdn);
      (r.questions||[]).forEach((q,i)=>{
        const a=s.answers?.[i]; const td=document.createElement("td");
        td.textContent = a? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : "-") : (a.value??"-")) : "-";
        if(a?.correct) score++; tr.appendChild(td);
      });
      const tds=document.createElement("td"); tds.textContent=String(score); tr.appendChild(tds);
      const tdl=document.createElement("td"); tdl.textContent= s.alive===false? "out":"alive"; tr.appendChild(tdl);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
  }
}

/***********************
 * Link / QR
 ***********************/
function buildStudentLink(){
  const url=new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", roomId);
  if(els.studentLink) els.studentLink.value = url.toString();
  if(els.qrCanvas && window.QRCode && els.studentLink?.value){
    try{ window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:192 }, ()=>{}); }catch(e){}
  }
}

/***********************
 * Panel switch
 ***********************/
function showPanel(name){
  const map = {
    build: els.panelBuild,
    options: els.panelOptions,
    present: els.panelPresent,
    results: els.panelResults,
  };
  Object.values(map).forEach(el=>el?.classList.add("hide"));
  map[name]?.classList.remove("hide");
}

/***********************
 * Events
 ***********************/
els.btnAdmin?.addEventListener("click", ()=> setMode("admin"));
els.btnStudent?.addEventListener("click", ()=> setMode("student"));
els.btnConnect?.addEventListener("click", connect);

[els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>{
  b?.addEventListener("click", ()=>{
    [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(x=>x?.classList.remove("active"));
    b.classList.add("active");
    if(b===els.tabBuild)   showPanel("build");
    if(b===els.tabOptions) showPanel("options");
    if(b===els.tabPresent) showPanel("present");
    if(b===els.tabResults) showPanel("results");
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
    {type:'mcq', text:'우리 은하 이름은?', options:['솔라','밀키웨이','루나','오리온'], answerIndex:1},
  ];
  if(els.builder){ els.builder.innerHTML=""; S.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q))); }
  if(els.quizTitle) els.quizTitle.value="샘플 퀴즈";
  if(els.questionCount) els.questionCount.value=S.length;
});
els.btnSaveQuiz?.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const payload=collectBuilder(); if(!payload.questions.length) return alert("문항을 추가하세요.");
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("문항 저장 완료!");
});

els.btnSaveOptions?.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const policy = els.chkPolicyName?.checked ? "name" : "device";
  const autoNext = !!els.chkAutoNext?.checked;
  const accept   = !!els.chkAccept?.checked;
  const reveal   = !!els.chkReveal?.checked;
  const sec      = Math.max(5, Math.min(600, parseInt(els.timerSec?.value,10)||30));
  await setDoc(roomRef(roomId), { policy, autoNext, accept, reveal, timerSec:sec }, { merge:true });
  buildStudentLink();
  els.qrBox?.classList.remove("hide");
  alert("옵션 저장 완료!");
});

els.btnCopyLink?.addEventListener("click", async ()=>{
  if(!els.studentLink?.value) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="복사", 1200);
});
els.btnOpenStudent?.addEventListener("click", ()=> window.open(els.studentLink?.value||"#","_blank"));

// 진행 (프레젠테이션)
els.btnStart?.addEventListener("click", startQuiz);
els.btnPrev?.addEventListener("click", ()=>step(-1));
els.btnNext?.addEventListener("click", ()=>step(+1));
els.btnEndAll?.addEventListener("click", finishAll);

// 제출 허용/공개
els.chkAccept?.addEventListener("change", ()=> roomId && updateDoc(roomRef(roomId), { accept: !!els.chkAccept.checked }));
els.chkReveal?.addEventListener("change", ()=> roomId && updateDoc(roomRef(roomId), { reveal: !!els.chkReveal.checked }));

// 타이머
els.btnTimerGo?.addEventListener("click", async ()=>{
  if(!roomId) return;
  const r=(await getDoc(roomRef(roomId))).data()||{};
  const sec = Math.max(5, Math.min(600, parseInt(els.timerSec?.value,10) || r.timerSec || 30));
  startTimer(sec);
});
els.btnTimerStop?.addEventListener("click", stopTimer);

// 결과 I/O
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
els.btnSaveJSON?.addEventListener("click", async ()=>{
  if(!roomId) return;
  const r=(await getDoc(roomRef(roomId))).data();
  const res=await getDocs(respCol(roomId));
  const obj={ roomId, room:r, responses: res.docs.map(d=>({ id:d.id, ...d.data() })) };
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:"application/json"}));
  a.download=`${roomId}-backup.json`; a.click(); URL.revokeObjectURL(a.href);
});
els.fileLoad?.addEventListener("change", async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const data=JSON.parse(await f.text());
  if(data.room) await setDoc(roomRef(roomId), data.room, { merge:true });
  if(Array.isArray(data.responses)) await Promise.all(data.responses.map(x=> setDoc(doc(respCol(roomId), x.id), x, { merge:true })));
  alert("불러오기 완료"); e.target.value="";
});
els.btnResetAll?.addEventListener("click", async ()=>{
  if(!roomId) return;
  if(!confirm("세션, 응답, 상태를 초기화합니다. 계속할까요?")) return;
  await setDoc(roomRef(roomId), { mode:"idle", currentIndex:-1, accept:false, reveal:false }, { merge:true });
  const snap=await getDocs(respCol(roomId)); const tasks=[];
  snap.forEach(d=> tasks.push(setDoc(doc(respCol(roomId), d.id), { answers:{}, alive:true }, { merge:true })));
  await Promise.all(tasks); alert("초기화 완료");
});

// 학생 제출
els.btnJoin?.addEventListener("click", join);
els.btnShortSend?.addEventListener("click", ()=> submit((els.shortInput?.value||"").trim()));
els.btnSubmitChoice?.addEventListener("click", submitChoice);

/***********************
 * Boot
 ***********************/
function boot(){
  // 1) 저장된 세션코드만 복원 (MODE는 무조건 admin으로 시작)
  loadLocal();
  // 2) URL이 학생 모드이면 학생으로, 아니면 ‘항상 관리자’로 시작  ← #1 요구사항
  const url=new URL(location.href);
  const role=url.searchParams.get("role");
  if(role==='student') setMode("student"); else setMode("admin");
  // 3) roomId가 있으면 자동 연결
  if(roomId) connect();
}
boot();

// 별도: 직접 학생 링크로 진입 시에도 동작
(function fromURL(){
  const url=new URL(location.href);
  const rid=url.searchParams.get("room");
  if(rid){ els.roomId && (els.roomId.value=rid); roomId=rid; connect(); }
})();
