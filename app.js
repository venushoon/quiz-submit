/***********************
 * Firebase (compat)
 ***********************/
if (!window.firebase) {
  console.error("[firebase] not loaded. Ensure compat scripts are included in index.html");
}
const firebaseConfig = {
  apiKey: "AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo",
  authDomain: "live-quiz-a14d1.firebaseapp.com",
  projectId: "live-quiz-a14d1",
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

/***********************
 * Helpers & State
 ***********************/
const $  = (s, el=document)=>el.querySelector(s);
const $$ = (s, el=document)=>Array.from(el.querySelectorAll(s));
const pad = (n)=>String(n).padStart(2,'0');

let MODE   = "admin";   // 'admin' | 'student'
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;
window.__room = null;

const els = {
  // 상단/탭
  roomInput: $("#roomId"), btnConnect: $("#btnConnect"), btnLogout: $("#btnLogout"),
  tabBuild: $("#tabBuild"), tabOpt: $("#tabControl"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),

  // 빌더(문항)
  builder: $("#builder"), quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"),

  // 옵션
  chkDeviceOnce: $("#chkDeviceOnce"), chkNameOnce: $("#chkNameOnce"),
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"),
  chkBright: $("#chkBright"), timerSec: $("#timerSec"),
  btnOptSave: $("#btnOptSave"),

  // 학생 접속
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

  // 프레젠테이션
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnFinish: $("#btnEndAll"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pOpts: $("#pOpts"), leftSec: $("#leftSec"),
  chipJoin: $("#chipJoin"), chipSubmit: $("#chipSubmit"), chipCorrect: $("#chipCorrect"), chipWrong: $("#chipWrong"),
  nowQuestion: $("#nowQuestion"), progress: $("#progress"),

  // 학생 화면
  studentAccess: $("#studentAccess"),
  joinModal: $("#joinModal"), joinName: $("#joinName"), btnJoinGo: $("#btnJoinGo"),
  sState: $("#sState"), sQTitle: $("#sQTitle"), sQText: $("#sQText"),
  sImg: $("#sImg"), sOptBox: $("#mcqBox"), sShortWrap: $("#shortBox"),
  sShortInput: $("#shortInput"), sShortSend: $("#btnShortSend"),
  sEnded: $("#sEnded"), sMyResult: $("#btnMyResult"),

  // 결과
  resultsTable: $("#resultsTable"), leaderboard: $("#leaderboard"),
  btnExportCSV: $("#btnExportCSV"), btnResetAll: $("#btnResetAll"),
};

Object.entries(els).forEach(([k,v])=>{ if(!v) console.warn("[warn] missing element:", k); });

/***********************
 * Firestore refs (compat)
 ***********************/
const roomRef = (id)=> db.collection("rooms").doc(id);
const respCol = (id)=> roomRef(id).collection("responses");

/***********************
 * Local cache
 ***********************/
function saveLocal(){ localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me })); }
function loadLocal(){
  try{
    const d=JSON.parse(localStorage.getItem("quiz.live")||"{}");
    roomId=d.roomId||""; MODE=d.MODE||"admin"; me=d.me||{id:null,name:""};
    if(roomId && els.roomInput) els.roomInput.value=roomId;
  }catch{}
}

/***********************
 * Room bootstrap
 ***********************/
async function ensureRoom(id){
  const snap = await roomRef(id).get();
  if (!snap.exists) {
    await roomRef(id).set({
      title:"새 세션",
      mode:"idle",            // ← 시작 전 대기 상태
      currentIndex:-1,        // ← 시작 전엔 -1
      accept:false,
      reveal:false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      questions:[]
    },{merge:true});
  } else {
    // 저장 과정에서 실수로 활성화되어 있던 세션을 보호: 여기선 건드리지 않음
  }
}

/***********************
 * Mode & Connect
 ***********************/
function setMode(m){
  MODE=m;
  // 학생 UI/관리자 UI 분리(보이는/숨김 처리) — HTML 구조에 맞춰 적용하세요.
  document.body.dataset.role = m;  // CSS에서 [data-role="student"] 등으로 제어 가능
  saveLocal();
}

async function connect(){
  const id=(els.roomInput?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId=id; await ensureRoom(roomId);
  listenRoom(roomId); listenResponses(roomId);
  buildStudentLink();
  saveLocal();
}

function autoReconnect(){
  loadLocal();
  if(!MODE) MODE="admin";
  setMode(MODE);
  if(roomId) connect();
}

function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom = roomRef(id).onSnapshot((snap)=>{
    if(!snap.exists) return;
    const r=snap.data();
    window.__room=r;
    renderRoom(r);
  });
}
function listenResponses(id){
  if(unsubResp) unsubResp();
  unsubResp = respCol(id).onSnapshot((qs)=>{
    const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    renderResponses(arr);
  });
}

/***********************
 * Builder helpers
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
 * Flow control (Start/Step/End)
 ***********************/
async function startQuiz(){
  const snap = await roomRef(roomId).get();
  const r = snap.data();
  const total = (r.questions||[]).length;

  if(total<=0){
    // 문항이 없으면 바로 종료 상태로
    await roomRef(roomId).set({ mode:"ended", currentIndex:-1, accept:false },{merge:true});
    return;
  }
  // 반드시 여기서만 active로 전환
  await roomRef(roomId).set({ mode:"active", currentIndex:0, accept:true },{merge:true});
}

async function step(delta){
  await db.runTransaction(async (tx)=>{
    const doc = await tx.get(roomRef(roomId));
    const r=doc.data();
    const total=(r.questions||[]).length;
    let next=(r.currentIndex??-1)+delta;

    if(next>=total){
      // 마지막 다음 → 종료
      tx.update(roomRef(roomId), { mode:"ended", accept:false });
      return;
    }
    if(next<0) next=0;
    tx.update(roomRef(roomId), { currentIndex: next, accept:true });
  });
}

async function finishAll(){
  if(!confirm("퀴즈를 종료할까요?")) return;
  await roomRef(roomId).set({ mode:"ended", accept:false },{merge:true});
}

/***********************
 * Student Join/Submit
 ***********************/
async function joinStudent(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name=(els.joinName?.value||"").trim();
  if(!name) return alert("이름(번호)을 입력하세요.");

  me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem("quiz.device", me.id);

  await respCol(roomId).doc(me.id).set({
    name, joinedAt: firebase.firestore.FieldValue.serverTimestamp(), answers:{}, alive:true
  }, { merge:true });

  // 참가 → 대기상태로 전환 안내
  if(els.studentAccess) els.studentAccess.classList.add("hide");
  if(els.sState) els.sState.textContent = "참가 완료! 시작을 기다려 주세요.";
}

async function submitAnswer(value){
  const r=window.__room; if(!r) return;
  if(r.mode!=="active" || !r.accept) return alert("지금은 제출할 수 없습니다.");

  const idx=r.currentIndex;
  const q=r.questions?.[idx]; if(!q) return;

  const ref=respCol(roomId).doc(me.id);
  const snap=await ref.get();
  const prev=snap.exists ? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert("이미 제출했습니다.");

  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }

  await ref.set({
    name: me.name,
    [`answers.${idx}`]: { value, correct:(correct===true), revealed:r.reveal||false }
  }, { merge:true });
}

/***********************
 * Render
 ***********************/
function renderRoom(r){
  // 상단 진행 수치
  if(els.progress) els.progress.textContent = r.currentIndex>=0 ? `${r.currentIndex+1}/${(r.questions||[]).length}` : `0/${(r.questions||[]).length}`;

  /* ========== 프레젠테이션(관리자) ========== */
  if(MODE==='admin'){
    if(els.pTitle) els.pTitle.textContent = r.title || roomId;

    // 시작 전 안내
    if(r.mode!=='active' || (r.currentIndex ?? -1) < 0){
      if(els.pQ) els.pQ.textContent = "시작 버튼을 누르면 문항이 보입니다.";
      if(els.pOpts) els.pOpts.innerHTML = "";
    }else{
      const q=r.questions?.[r.currentIndex];
      if(q){
        if(els.pQ) els.pQ.textContent = q.text;
        if(els.pOpts){
          els.pOpts.innerHTML="";
          if(q.type==='mcq'){
            q.options.forEach((t,i)=>{
              const d=document.createElement("div");
              d.className="popt";
              d.textContent=`${i+1}. ${t}`;
              els.pOpts.appendChild(d);
            });
          }else{
            const d=document.createElement("div");
            d.className="popt";
            d.textContent="주관식 문제입니다.";
            els.pOpts.appendChild(d);
          }
        }
      }
    }
  }

  /* ========== 학생 화면 ========== */
  if(MODE==='student'){
    // 종료 화면
    if(r.mode==='ended'){
      if(els.sEnded) els.sEnded.classList.remove("hide");
      if(els.sState) els.sState.textContent = "퀴즈가 종료되었습니다!";
      if(els.sOptBox) els.sOptBox.innerHTML="";
      if(els.sShortWrap) els.sShortWrap.classList.add("hide");
      return;
    }

    // 아직 시작 전 → 대기
    if(r.mode!=='active' || (r.currentIndex ?? -1) < 0){
      if(els.sState) els.sState.textContent = "참가 완료! 시작을 기다려 주세요.";
      if(els.sQTitle) els.sQTitle.textContent = "";
      if(els.sQText) els.sQText.textContent = "";
      if(els.sOptBox) els.sOptBox.innerHTML="";
      if(els.sShortWrap) els.sShortWrap.classList.add("hide");
      return;
    }

    // 문제 표시
    const q=r.questions?.[r.currentIndex]; if(!q) return;
    if(els.sEnded) els.sEnded.classList.add("hide");
    if(els.sState) els.sState.textContent = q
