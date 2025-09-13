// ===== app.js 헤더/초기화(교체) =====
// FS(doc/collection/…): index.html에서 window.FS 로 주입됨
const {
  doc, collection, setDoc, getDoc, getDocs,
  onSnapshot, updateDoc, runTransaction, serverTimestamp
} = window.FS || {};

if (!window.db || !window.FS) {
  // Firebase/FS가 먼저 안 올라오면 더 진행하지 않음
  throw new Error("[firebase] not loaded. Ensure compat scripts are included in index.html");
}

// 전역 유틸(중복 선언 가드)
const $  = window.$  || ((s, el = document) => el.querySelector(s));
const $$ = window.$$ || ((s, el = document) => Array.from(el.querySelectorAll(s)));

// -------- 엘리먼트(필요 요소만 정리) --------
const els = {
  // 헤더 / 탭
  roomId: $("#roomId"),
  btnConnect: $("#btnConnect"),
  btnSignOut: $("#btnSignOut"),
  roomStatus: $("#roomStatus"),
  tabBuild: $("#tabBuild"),
  tabOptions: $("#tabOptions"),
  tabPresent: $("#tabPresent"),
  tabResults: $("#tabResults"),

  // 패널
  pBuild: $("#panelBuild"),
  pOptions: $("#panelOptions"),
  pPresent: $("#panelPresent"),
  pResults: $("#panelResults"),

  // 옵션의 학생접속
  qrCanvas: $("#qrCanvas"),
  studentLink: $("#studentLink"),
  btnCopyLink: $("#btnCopyLink"),
  btnOpenStudent: $("#btnOpenStudent"),

  // 프레젠테이션
  btnStart: $("#btnStart"),
  btnPrev: $("#btnPrev"),
  btnNext: $("#btnNext"),
  btnEndAll: $("#btnEndAll"),
  leftSec: $("#leftSec"),
  nowQuestion: $("#nowQuestion"),

  // 학생 입장 모달/뷰
  joinModal: $("#joinModal"),
  joinName: $("#joinName"),
  btnJoinGo: $("#btnJoinGo"),
  sState: $("#sState"),
  sWrap: $("#sWrap"),
  sQTitle: $("#sQTitle"),
  sQImg: $("#sQImg"),
  sOptBox: $("#sOptBox"),
  sShortWrap: $("#sShortWrap"),
  sShortInput: $("#sShortInput"),
  btnShortSend: $("#btnShortSend"),
  sDone: $("#sDone"),
  btnShowMy: $("#btnShowMy"),
  myResult: $("#myResult"),
};

// -------- 상태 --------
let MODE   = "admin";            // 기본은 관리자 모드
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null, timerHandle=null;

// -------- 헬퍼 --------
const roomRef = (id)=>doc(window.db,"rooms",id);
const respCol = (id)=>collection(window.db,"rooms",id,"responses");
const pad = n=>String(n).padStart(2,"0");

function saveLocal(){ localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me })); }
function loadLocal(){
  try{
    const d=JSON.parse(localStorage.getItem("quiz.live")||"{}");
    roomId=d.roomId||""; MODE=d.MODE||"admin"; me=d.me||{id:null,name:""};
    if(roomId && els.roomId) els.roomId.value=roomId;
  }catch{}
}

// -------- 탭/모드 표시 --------
function showTab(name){
  const map = { build:els.pBuild, options:els.pOptions, present:els.pPresent, results:els.pResults };
  Object.values(map).forEach(p=>p && p.classList.add("hide"));
  if (map[name]) map[name].classList.remove("hide");

  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults]
    .forEach(t=>t && t.classList.remove("active"));
  ({build:els.tabBuild, options:els.tabOptions, present:els.tabPresent, results:els.tabResults}[name])
    ?.classList.add("active");
}

function setMode(m){
  MODE=m;
  // 관리자 UI 표시/학생 UI 숨김
  $$(".admin-only").forEach(n=>n.classList.toggle("hide", m!=="admin"));
  $("#studentAccess")?.classList.toggle("hide", m!=="student");
  if(m==="admin") showTab("build");
}

// -------- 룸 리스너 --------
function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom = onSnapshot(roomRef(id),(snap)=>{
    if(!snap.exists()) return;
    const r=snap.data();
    window.__room=r;
    renderRoom?.(r);   // 기존 렌더 함수가 아래에 있다면 그대로 사용
  });
}
function listenResponses(id){
  if(unsubResp) unsubResp();
  unsubResp = onSnapshot(respCol(id),(qs)=>{
    const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    window.__resp = arr;
    renderResponses?.(arr);
  });
}

// -------- 접속/복구 --------
async function ensureRoom(id){
  const s=await getDoc(roomRef(id));
  if(!s.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false,
      policy:"device", timer:30, bright:false, createdAt:serverTimestamp(), questions:[]
    });
  }
}

async function connect(){
  const id=(els.roomId?.value||"").trim();
  if(!id) return alert("세션 코드를 입력하세요.");
  roomId=id;
  await ensureRoom(roomId);
  listenRoom(roomId);
  listenResponses(roomId);

  if(els.roomStatus) els.roomStatus.textContent=`세션: ${roomId} · 온라인`;
  els.btnConnect?.setAttribute("disabled","disabled");
  els.roomId?.setAttribute("disabled","disabled");
  els.btnSignOut?.classList.remove("hide");

  buildStudentLink(); // QR/링크 갱신
  saveLocal();
}

function signOut(){
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  roomId=""; if(els.roomId){ els.roomId.value=""; els.roomId.removeAttribute("disabled"); }
  els.btnConnect?.removeAttribute("disabled");
  els.btnSignOut?.classList.add("hide");
  if(els.roomStatus) els.roomStatus.textContent="세션: - · 오프라인";
  showTab("build");
  saveLocal();
}

function autoReconnect(){
  loadLocal();
  setMode(MODE || "admin");   // ✅ 기본 관리자 모드로 시작
  if(roomId) connect();
}

// -------- 학생 링크/QR --------
function buildStudentLink(){
  if(!roomId || !els.studentLink) return;
  const url=new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", roomId);
  els.studentLink.value=url.toString();

  // QRCode 가드
  if (window.QRCode?.toCanvas && els.qrCanvas) {
    try{ window.QRCode.toCanvas(els.qrCanvas, url.toString(), { width:140 }); }
    catch(e){ console.warn("[qrcode]", e); }
  }
}

// -------- 프레젠테이션 제어(핵심) --------
async function startQuiz(){
  if(!roomId) return alert("세션 먼저 접속하세요.");
  await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true });
}
async function step(delta){
  if(!roomId) return;
  await runTransaction(window.db, async (tx)=>{
    const snap=await tx.get(roomRef(roomId));
    const r=snap.data()||{};
    const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){ tx.update(roomRef(roomId), { mode:"ended", accept:false }); return; }
    next=Math.max(0,next);
    tx.update(roomRef(roomId), { currentIndex: next, accept:true });
  });
}
async function finishAll(){ if(roomId) await updateDoc(roomRef(roomId), { mode:"ended", accept:false }); }

// -------- 이벤트 바인딩 & 시작 --------
function bind(){
  els.btnConnect?.addEventListener("click", connect);
  els.btnSignOut?.addEventListener("click", signOut);

  els.tabBuild?.addEventListener("click", ()=>showTab("build"));
  els.tabOptions?.addEventListener("click", ()=>showTab("options"));
  els.tabPresent?.addEventListener("click", ()=>showTab("present"));
  els.tabResults?.addEventListener("click", ()=>showTab("results"));

  els.btnStart?.addEventListener("click", startQuiz);
  els.btnPrev?.addEventListener("click", ()=>step(-1));
  els.btnNext?.addEventListener("click", ()=>step(+1));
  els.btnEndAll?.addEventListener("click", finishAll);

  els.btnCopyLink?.addEventListener("click", ()=>{
    if (!els.studentLink?.value) return;
    navigator.clipboard.writeText(els.studentLink.value);
  });
  els.btnOpenStudent?.addEventListener("click", ()=>{
    if (!els.studentLink?.value) return;
    window.open(els.studentLink.value, "_blank","noopener");
  });
}

function init(){
  // URL 파라미터로 학생 모드 진입 시 학생 UI만 노출
  const params=new URLSearchParams(location.search);
  const role=params.get("role");
  const room=params.get("room");
  if(role==="student"){
    MODE="student";
    setMode("student");
  }else{
    MODE="admin";
    setMode("admin"); // ✅ 관리자 모드가 기본
  }
  if(room && els.roomId) els.roomId.value=room;

  bind();
  autoReconnect();
}

document.addEventListener("DOMContentLoaded", init);
// ===== app.js 헤더/초기화(교체 끝) =====

  // ---------- 초기화 ----------
  function init(){
    bind();
    autoReconnect(); // URL/LocalStorage 보고 모드/세션 결정
    // 기본은 **관리자 모드**로 시작
    if (!new URLSearchParams(location.search).get("role")) setMode("admin");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
