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

let S_MODE=false;                  // 학생모드 여부
let me = { id:null, name:"" };     // 학생
let sSelectedIdx=null;             // 객관식 선택 index

/***********************
 * Elements
 ***********************/
const A = {
  adminRoot: $("#adminRoot"),
  liveDot: $("#liveDot"),
  roomId: $("#roomId"),
  btnConnect: $("#btnConnect"),
  roomStatus: $("#roomStatus"),
  // tabs & panels
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"),  pOptions: $("#panelOptions"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),
  // builder
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"), btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"),
  btnSaveQuiz: $("#btnSaveQuiz"), builder: $("#builder"),
  // options
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright: $("#chkBright"),
  timerSec: $("#timerSec"), btnTimerGo: $("#btnTimerGo"), btnTimerStop: $("#btnTimerStop"),
  btnSaveOptions: $("#btnSaveOptions"),
  // student connect (옵션 탭 전용)
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

/* 🔒 세션 잠금/해제 UI 토글 */
function lockSessionUI(locked){
  if(!A.roomId || !A.btnConnect) return;
  A.roomId.disabled = !!locked;
  if(locked){
    A.btnConnect.textContent = "세션아웃";
    A.btnConnect.classList.remove("primary");
    A.btnConnect.classList.add("danger");
    A.btnConnect.dataset.mode = "logout";
  }else{
    A.btnConnect.textContent = "접속";
    A.btnConnect.classList.remove("danger");
    A.btnConnect.classList.add("primary");
    A.btnConnect.dataset.mode = "connect";
  }
}

async function connect(){
  const id=(A.roomId?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId=id; await ensureRoom(roomId);
  listenRoom(roomId); listenResponses(roomId);
  setOnline(true);
  lockSessionUI(true);                    // 입력 잠금 + 버튼 ‘세션아웃’
  buildStudentLink(true);                 // 접속 즉시 QR/링크 생성
  activateTab(A.tabBuild);
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
  lockSessionUI(false);                  // 입력 해제 + 버튼 ‘접속’
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

  // 옵션 탭 들어올 때도 QR 즉시 보장
  if(btn===
