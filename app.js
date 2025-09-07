/***********************
 * Firebase & 기본 준비
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

const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));
const pad = n=>String(n).padStart(2,"0");

let MODE="admin";
let roomId="";
let me={ id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;

/* 학생의 '이번 문항' 제출 여부 UI 차단용(로컬) */
let lastSubmittedIndex = -1;

/* 필수 엘리먼트(이름은 이전 최종본 기준) */
const els = {
  // 상단
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnSessionOut: $("#btnSessionOut"), roomStatus: $("#roomStatus"),
  btnAdmin: $("#btnAdmin"), btnStudent: $("#btnStudent"),

  // 탭/패널
  tabBuild: $("#tabBuild"), tabControl: $("#tabControl"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"), pControl: $("#panelControl"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),

  // 빌더
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"), btnBuildForm: $("#btnBuildForm"),
  btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"), builder: $("#builder"),

  // 진행(옵션)
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"),
  timerSec: $("#timerSec"), btnTimerGo: $("#btnTimerGo"), btnTimerStop: $("#btnTimerStop"),
  btnEndAll: $("#btnEndAll"),
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),
  leftSec: $("#leftSec"),

  // 프레젠테이션
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"),
  pWait: $("#pWait"), pCard: $("#pCard"), pTitle: $("#pTitle"), pQ: $("#pQ"), pOpts: $("#pOpts"),
  progress: $("#progress"), leftSec2: $("#leftSec2"), chips: $("#chips"),
  statJoined: $("#statJoined"), statSubmitted: $("#statSubmitted"), statCorrect: $("#statCorrect"), statWrong: $("#statWrong"),

  // 결과
  btnExportCSV: $("#btnExportCSV"), resultsTable: $("#resultsTable"),

  // 학생
  studentPanel: $("#studentPanel"), studentName: $("#studentName"), btnJoin: $("#btnJoin"),
  studentTopInfo: $("#studentTopInfo"),
  badgeType: $("#badgeType"), sQText: $("#sQText"), mcqBox: $("#mcqBox"),
  shortBox: $("#shortBox"), shortInput: $("#shortInput"), btnShortSend: $("#btnShortSend"),
};

/***********************
 * 로컬 저장
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
 * Firestore helpers
 ***********************/
const roomRef = id => doc(db,"rooms",id);
const respCol = id => collection(db,"rooms",id,"responses");

async function ensureRoom(id){
  const s=await getDoc(roomRef(id));
  if(!s.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false,
      createdAt: serverTimestamp(), questions:[]
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
 * 접속/세션아웃/모드
 ***********************/
function setMode(m){
  MODE=m;
  els.pBuild?.classList.toggle("hide", m!=="admin");
  els.pControl?.classList.toggle("hide", m!=="admin");
  els.pResults?.classList.toggle("hide", m!=="admin");
  els.pPresent?.classList.toggle("hide", false);
  els.studentPanel?.classList.toggle("hide", m!=="student");
  els.roomStatus && (els.roomStatus.textContent = roomId ? `세션: ${roomId} · 온라인` :
    (m==='admin'?'관리자 모드: 세션에 접속해 주세요.':'학생 모드: 세션 접속 후 참가하세요.'));
  [els.tabBuild,els.tabControl,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
  (m==='admin'?els.tabControl:els.tabPresent)?.classList.add("active");
}

async function connect(){
  const id=(els.roomId?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId=id; await ensureRoom(roomId);
  listenRoom(roomId); listenResponses(roomId);
  buildStudentLink();
  els.roomStatus && (els.roomStatus.textContent=`세션: ${roomId} · 온라인`);

  // ✅ 접속 후 세션코드 비활성화 + 세션아웃 활성화
  if(els.roomId)         els.roomId.disabled = true;
  if(els.btnConnect)     els.btnConnect.disabled = true;
  if(els.btnSessionOut)  els.btnSessionOut.disabled = false;

  saveLocal();
}

function sessionOut(){
  if(unsubRoom){ unsubRoom(); unsubRoom=null; }
  if(unsubResp){ unsubResp(); unsubResp=null; }
  roomId="";
  if(els.roomId){ els.roomId.disabled=false; els.roomId.value=""; }
  if(els.btnConnect) els.btnConnect.disabled=false;
  if(els.btnSessionOut) els.btnSessionOut.disabled=true;
  if(els.studentLink) els.studentLink.value="";
  const ctx=els.qrCanvas?.getContext?.("2d"); ctx?.clearRect(0,0,els.qrCanvas.width,els.qrCanvas.height);
  if(els.roomStatus) els.roomStatus.textContent="세션이 해제되었습니다.";
  saveLocal();
}

function autoReconnect(){ loadLocal(); setMode(MODE); if(roomId) connect(); }

/***********************
 * 빌더 (생략: 이전 최종본 그대로 사용)
 ***********************/
// …(기존 cardRow/collectBuilder/샘플 등 그대로)

/***********************
 * 진행/타이머
 ***********************/
async function startQuiz(){
  if(!roomId) return;
  lastSubmittedIndex = -1;                 // 새 라운드 시작 시 초기화
  await updateDoc(roomRef(roomId), {
    mode:"active", currentIndex:0, accept:true
  });
}
async function step(delta){
  await runTransaction(db, async (tx)=>{
    const ref=roomRef(roomId);
    const snap=await tx.get(ref);
    const r=snap.data(); const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){ tx.update(ref, { currentIndex: total-1, mode:"ended", accept:false }); return; }
    next=Math.max(0,next);
    lastSubmittedIndex = -1;               // 다음/이전 이동 시 제출표시 리셋
    tx.update(ref, { currentIndex: next, accept:true });
  });
}
async function finishAll(){ if(confirm("퀴즈를 종료할까요?")) await updateDoc(roomRef(roomId), { mode:"ended", accept:false }); }

function startTimer(sec){
  stopTimer();
  const end = Date.now()+sec*1000;
  timerHandle=setInterval(async ()=>{
    const remain=Math.max(0, Math.floor((end-Date.now())/1000));
    const t=`${pad(Math.floor(remain/60))}:${pad(remain%60)}`;
    els.leftSec  && (els.leftSec.textContent  = t);
    els.leftSec2 && (els.leftSec2.textContent = t);
    if(remain<=0){
      stopTimer();
      await updateDoc(roomRef(roomId), { accept:false });
      setTimeout(()=> step(+1), 400);
    }
  }, 250);
}
function stopTimer(){
  if(timerHandle){ clearInterval(timerHandle); timerHandle=null; }
  els.leftSec  && (els.leftSec.textContent="00:00");
  els.leftSec2 && (els.leftSec2.textContent="00:00");
}

/***********************
 * 제출/채점
 ***********************/
async function join(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name=(els.studentName?.value||"").trim(); if(!name) return alert("이름을 입력하세요.");
  me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem("quiz.device", me.id);
  await setDoc(doc(respCol(roomId), me.id), {
    name, joinedAt:serverTimestamp(), answers:{}, alive:true
  }, { merge:true });
  alert("참가 완료! 이제 ‘제출버튼을 눌러주세요’ 안내가 뜨면 답을 제출하세요.");
  saveLocal();
}

/* 한 문항당 1회 제출 UX 차단(로컬 표시 + 서버 중복 방지) */
async function submit(value){
  const r=window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=r.currentIndex; if(idx==null || idx<0) return;
  if(lastSubmittedIndex===idx) return alert("이 문항은 이미 제출했습니다.");

  const q=r.questions?.[idx]; if(!q) return;
  const ref=doc(respCol(roomId), me.id);
  const snap=await getDoc(ref); const prev=snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null){ lastSubmittedIndex=idx; return alert("이 문항은 이미 제출했습니다."); }

  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true), revealed:r.reveal||false } }, { merge:true });

  // ✅ 로컬 표시/버튼 차단
  lastSubmittedIndex = idx;
  els.sQText && (els.sQText.textContent="제출 완료!");
  // 버튼/입력 차단
  $$(".optbtn").forEach(b=> b.disabled=true);
  if(els.btnShortSend) els.btnShortSend.disabled=true;
}

/***********************
 * 렌더링
 ***********************/
function renderRoom(r){
  const total=r.questions?.length||0; const idx=r.currentIndex;

  els.progress && (els.progress.textContent = `${Math.max(0,idx+1)}/${total}`);
  if(els.chkAccept) els.chkAccept.checked=!!r.accept;
  if(els.chkReveal) els.chkReveal.checked=!!r.reveal;

  // 프레젠테이션: 시작 전 안내 / 시작 후 카드
  if(els.pWait && els.pCard){
    const showCard = (r.mode==='active' && idx>=0 && r.questions?.[idx]);
    els.pWait.classList.toggle("hide", !!showCard);
    els.pCard.classList.toggle("hide", !showCard);
  }
  // 프레젠테이션 문항/보기
  if(idx>=0 && r.questions?.[idx]){
    const q=r.questions[idx];
    els.pTitle && (els.pTitle.textContent = r.title||roomId);
    els.pQ && (els.pQ.textContent = q.text);
    if(els.pOpts){
      els.pOpts.innerHTML="";
      if(q.type==='mcq'){
        q.options.forEach((t,i)=>{
          const d=document.createElement("div");
          d.className="popt";
          d.textContent=`${i+1}. ${t}`;
          els.pOpts.appendChild(d);
        });
      }
    }
  }

  // 학생 화면
  if(MODE==='student'){
    // 시작 전
    if(r.mode!=='active' || idx<0){
      els.badgeType && (els.badgeType.textContent="대기");
      els.sQText && (els.sQText.textContent="참가 완료! 시작을 기다려 주세요.");
      els.mcqBox && (els.mcqBox.innerHTML="");
      els.shortBox && els.shortBox.classList.add("hide");
      return;
    }
    // 시작 후
    const q=r.questions[idx];
    els.badgeType && (els.badgeType.textContent = q.type==='mcq'?'객관식':'주관식');
    els.sQText && (els.sQText.textContent = (lastSubmittedIndex===idx) ? "제출 완료!" : "제출버튼을 눌러주세요");

    if(q.type==='mcq'){
      els.shortBox && els.shortBox.classList.add("hide");
      if(els.mcqBox){
        els.mcqBox.innerHTML="";
        q.options.forEach((opt,i)=>{
          const b=document.createElement("button");
          b.className="optbtn"; b.textContent=`${i+1}. ${opt}`;
          b.disabled = !r.accept || lastSubmittedIndex===idx;
          b.addEventListener("click", ()=> submit(i));
          els.mcqBox.appendChild(b);
        });
      }
    }else{
      els.mcqBox && (els.mcqBox.innerHTML="");
      if(els.shortBox){
        els.shortBox.classList.remove("hide");
        if(els.btnShortSend) els.btnShortSend.disabled = !r.accept || lastSubmittedIndex===idx;
      }
    }
  }
}

function renderResponses(list){
  if(MODE!=='admin') return;
  const r=window.__room||{}; const idx=r.currentIndex; const q=r.questions?.[idx];

  // 통계(점표시)
  if(els.statJoined)   els.statJoined.textContent   = String(list.length);
  if(els.statSubmitted)els.statSubmitted.textContent= String(list.filter(s=> s.answers?.[idx]!=null).length);
  if(els.statCorrect)  els.statCorrect.textContent  = String(list.filter(s=> s.answers?.[idx]?.correct===true).length);
  if(els.statWrong)    els.statWrong.textContent    = String(list.filter(s=> {
    const a=s.answers?.[idx]; return (a && a.correct===false);
  }).length);

  // 칩
  if(els.chips){
    els.chips.innerHTML="";
    list.forEach(s=>{
      const a=s.answers?.[idx];
      const chip=document.createElement("div");
      chip.className="chip " + (a? (a.correct?'ok':'no') : 'wait');
      chip.textContent=s.name||s.id; els.chips.appendChild(chip);
    });
  }

  // 결과표(이전 최종본 동일)
  if(els.resultsTable){
    const tbl=document.createElement("table");
    const thead=document.createElement("thead"), tr=document.createElement("tr");
    ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수","상태"].forEach(h=>{
      const th=document.createElement("th"); th.textContent=h; tr.appendChild(th);
    });
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
      const tdl=document.createElement("td"); tdl.textContent= s.alive===false? "out":"alive"; tr.appendChild(tdl);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
  }
}

/***********************
 * 링크/QR
 ***********************/
function buildStudentLink(){
  if(!els.studentLink) return;
  const url=new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", roomId);
  els.studentLink.value=url.toString();
  if(window.QRCode && els.qrCanvas){
    try{ window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:192 }); }catch(e){}
  }
}

/***********************
 * 이벤트 바인딩
 ***********************/
els.btnConnect?.addEventListener("click", connect);
els.btnSessionOut?.addEventListener("click", sessionOut);
els.btnAdmin?.addEventListener("click", ()=>{ setMode("admin"); saveLocal(); });
els.btnStudent?.addEventListener("click", ()=>{ setMode("student"); saveLocal(); });

els.btnStart?.addEventListener("click", startQuiz);
els.btnPrev?.addEventListener("click", ()=>step(-1));
els.btnNext?.addEventListener("click", ()=>step(+1));
els.btnEndAll?.addEventListener("click", finishAll);

els.chkAccept?.addEventListener("change", ()=> updateDoc(roomRef(roomId), { accept: !!els.chkAccept.checked }));
els.chkReveal?.addEventListener("change", ()=> updateDoc(roomRef(roomId), { reveal: !!els.chkReveal.checked }));

els.btnTimerGo?.addEventListener("click", ()=> startTimer(Math.max(5,Math.min(600, parseInt(els.timerSec?.value,10)||30))));
els.btnTimerStop?.addEventListener("click", stopTimer);

els.btnCopyLink?.addEventListener("click", async ()=>{
  if(!els.studentLink) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="링크 복사", 1200);
});
els.btnOpenStudent?.addEventListener("click", ()=> window.open(els.studentLink?.value||"#","_blank"));

els.btnJoin?.addEventListener("click", join);
els.btnShortSend?.addEventListener("click", ()=> submit((els.shortInput?.value||"").trim()));

/***********************
 * 부팅 & URL 파라미터
 ***********************/
autoReconnect();

// ?role=student&room=class1 로 바로 학생 모드 열기
(function fromURL(){
  const url=new URL(location.href);
  const role=url.searchParams.get("role"); const rid=url.searchParams.get("room");
  if(role==='student') setMode("student");
  if(rid){ els.roomId && (els.roomId.value=rid); connect(); }
})();
