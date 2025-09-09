// app.js  (ESM)

// ---------- Firebase (모듈러) ----------
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot,
  collection, getDocs, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// 프로젝트 설정
const firebaseConfig = {
  apiKey: "AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo",
  authDomain: "live-quiz-a14d1.firebaseapp.com",
  projectId:  "live-quiz-a14d1",
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ---------- 엘리먼트 헬퍼 ----------
const $  = (s, el=document)=>el.querySelector(s);
const $$ = (s, el=document)=>Array.from(el.querySelectorAll(s));

// UI refs (필요한 것만)
const els = {
  // 헤더
  roomId:    $("#roomId"),
  btnConnect:$("#btnConnect"),
  btnSignOut:$("#btnSignOut"),
  roomStatus:$("#roomStatus"),
  tabs:      $$(".tab"),
  panelBuild:   $("#panelBuild"),
  panelOptions: $("#panelOptions"),
  panelPresent: $("#panelPresent"),
  panelResults: $("#panelResults"),

  // 옵션 쪽 QR
  qrCanvas:     $("#qrCanvas"),
  studentLink:  $("#studentLink"),
  btnCopyLink:  $("#btnCopyLink"),
  btnOpenStu:   $("#btnOpenStudent"),

  // 진행/프레젠 관련
  btnStart: $("#btnStart"),
  btnPrev:  $("#btnPrev"),
  btnNext:  $("#btnNext"),
  btnEnd:   $("#btnEndAll"),
  nowQuestion: $("#nowQuestion"),
  pTitle:  $("#pTitle"),
  pQ:      $("#pQ"),
  pImg:    $("#pImg"),
  pOpts:   $("#pOpts"),

  // 학생(페이지 하단 섹션)
  sWrap:    $("#studentAccess"),
  sDialog:  $("#joinModal"),
  sName:    $("#joinName"),
  sJoinBtn: $("#btnJoinGo"),
  sState:   $("#sState"),
  sQTitle:  $("#sQTitle"),
  sQImg:    $("#sQImg"),
  sOptBox:  $("#sOptBox"),
  sShortWrap: $("#sShortWrap"),
  sShortInput: $("#sShortInput"),
  sShortSend:  $("#sShortSend"),

  // 결과 (리더보드)
  leaderboard: $("#leaderboard"),

  // 초기화/저장
  btnOptSave: $("#btnOptSave"),
  chkAllow:   $("#chkAllow"),
  chkReveal:  $("#chkReveal"),
  chkBright:  $("#chkBright"),
  chkDeviceOnce: $("#chkDeviceOnce"),
  chkNameOnce:   $("#chkNameOnce"),
  timerSec:  $("#timerSec"),
  btnResetAll: $("#btnResetAll"),
};

const state = {
  mode: "admin",        // 'admin' | 'student'
  roomId: "",
  me: { id:null, name:"" },
  unsubRoom: null,
  unsubResp: null,
  lastQrFor: "",
};

// ---------- Firestore helpers ----------
const roomRef = id => doc(db, "rooms", id);
const respCol = id => collection(db, "rooms", id, "responses");

async function ensureRoom(id){
  const r = await getDoc(roomRef(id));
  if(!r.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션",
      mode:"idle",            // idle | active | ended
      currentIndex:-1,
      accept:false,
      reveal:false,
      bright:false,
      policy:{ deviceOnce:true, nameOnce:false },
      questions:[],
      createdAt: serverTimestamp()
    });
  }
}

// ---------- 모드 & 탭 ----------
function setMode(m){
  state.mode = m;
  // admin UI 토글
  $$(".admin-only").forEach(el=>{
    el.classList.toggle("hide", m !== "admin");
  });
  // 학생 섹션은 항상 표시하되, 학생 모드일 때 상단 관리자 바는 숨김됨
  setActiveTab(m==="admin" ? "build" : "present");
}

function setActiveTab(key){
  els.tabs.forEach(t=>{
    const on = t.dataset.tab === key;
    t.classList.toggle("active", on);
  });
  els.panelBuild.classList.toggle("hide", key!=="build");
  els.panelOptions.classList.toggle("hide", key!=="options");
  els.panelPresent.classList.toggle("hide", key!=="present");
  els.panelResults.classList.toggle("hide", key!=="results");
}

// ---------- 세션 접속/아웃 ----------
async function connect(){
  const id = (els.roomId?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  state.roomId = id;

  // 최초 생성 보장
  await ensureRoom(state.roomId);

  // 실시간 수신
  listenRoom(); listenResponses();

  // 상태반영
  els.roomId.disabled = true;
  els.btnConnect.classList.add("hide");
  els.btnSignOut.classList.remove("hide");
  els.roomStatus.textContent = `세션: ${state.roomId} · 온라인`;

  // 학생 링크 / QR 갱신
  refreshStudentLink();
  saveLocal();
}

function signOut(){
  cleanupListeners();
  state.roomId = "";
  els.roomId.disabled = false;
  els.btnConnect.classList.remove("hide");
  els.btnSignOut.classList.add("hide");
  els.roomStatus.textContent = "세션: - · 오프라인";
  els.studentLink.value = "";
  if(els.qrCanvas) els.qrCanvas.getContext("2d")?.clearRect(0,0,els.qrCanvas.width, els.qrCanvas.height);
  saveLocal();
}

function cleanupListeners(){
  state.unsubRoom && state.unsubRoom(); state.unsubRoom=null;
  state.unsubResp && state.unsubResp(); state.unsubResp=null;
}

// ---------- 구독 ----------
function listenRoom(){
  state.unsubRoom && state.unsubRoom();
  state.unsubRoom = onSnapshot(roomRef(state.roomId), snap=>{
    if(!snap.exists()) return;
    const r = snap.data();
    renderRoom(r);
  });
}
function listenResponses(){
  state.unsubResp && state.unsubResp();
  state.unsubResp = onSnapshot(respCol(state.roomId), qs=>{
    const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    renderResponses(arr);
  });
}

// ---------- 링크/QR ----------
function refreshStudentLink(){
  if(!state.roomId || !els.studentLink) return;
  const u = new URL(location.href);
  u.searchParams.set("role","student");
  u.searchParams.set("room", state.roomId);
  els.studentLink.value = u.toString();

  if(window.QRCode && els.qrCanvas){
    try{
      window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width: 120 }, ()=>{});
    }catch(e){ console.warn("QR draw failed", e); }
  }
}

// ---------- 진행 제어 ----------
async function startQuiz(){
  if(!state.roomId) return;
  await runTransaction(db, async (tx)=>{
    const rs = await tx.get(roomRef(state.roomId));
    const qn = (rs.data().questions||[]).length;
    if(qn<=0){ alert("저장된 문항이 없습니다."); return; }
    tx.update(roomRef(state.roomId), { mode:"active", currentIndex:0, accept:true });
  });
}

async function step(delta){
  if(!state.roomId) return;
  await runTransaction(db, async (tx)=>{
    const rs = await tx.get(roomRef(state.roomId));
    const r = rs.data(); const total=(r.questions||[]).length;
    let next = (r.currentIndex??-1) + delta;
    if(next >= total){
      tx.update(roomRef(state.roomId), { mode:"ended", accept:false, currentIndex: total-1 });
      return;
    }
    next = Math.max(0, next);
    tx.update(roomRef(state.roomId), { currentIndex: next, accept:true });
  });
}

async function endQuiz(){
  if(!state.roomId) return;
  await updateDoc(roomRef(state.roomId), { mode:"ended", accept:false });
}

// ---------- 렌더 ----------
function renderRoom(r){
  // 헤더 상태/탭
  els.nowQuestion && (els.nowQuestion.textContent = (r.currentIndex>=0 && r.questions?.[r.currentIndex]) ? r.questions[r.currentIndex].text : "-");

  // 프레젠테이션
  if(els.pTitle) els.pTitle.textContent = r.title || state.roomId;
  if(els.pQ && els.pOpts){
    els.pOpts.innerHTML="";
    if(r.mode!=="active"){
      els.pQ.textContent = "시작 버튼을 누르면 문항이 제시됩니다.";
      els.pImg?.classList.add("hide");
    }else{
      const q = r.questions?.[r.currentIndex];
      if(q){
        els.pQ.textContent = q.text || "-";
        if(q.image){
          els.pImg?.setAttribute("src", q.image);
          els.pImg?.classList.remove("hide");
        }else{
          els.pImg?.classList.add("hide");
        }
        if(q.type==='mcq'){
          (q.options||[]).forEach((t,i)=>{
            const d=document.createElement("div");
            d.className="popt"; d.textContent=`${i+1}. ${t}`;
            els.pOpts.appendChild(d);
          });
        }
      }
    }
  }

  // 학생 화면
  renderStudent(r);
}

function renderResponses(list){
  // 간단 리더보드 (점수 집계)
  if(!els.leaderboard) return;
  const r = window.__room || {};
  const rows = list.map(s=>{
    let score=0;
    (r.questions||[]).forEach((q,i)=>{
      const a=s.answers?.[i];
      if(a?.correct) score++;
    });
    return { name:s.name||s.id, score };
  }).sort((a,b)=>b.score-a.score);

  els.leaderboard.innerHTML = rows.map((x,i)=>`<div class="row between card"><span>${i+1}. ${x.name}</span><strong>${x.score}</strong></div>`).join("");
}

// ---------- 학생 플로우 ----------
function requireJoinDialog(){
  if(!els.sDialog) return;
  els.sDialog.classList.remove("hide");
  els.sName?.focus();
}
async function join(){
  const name = (els.sName?.value||"").trim();
  if(!name){ alert("이름(번호)을 입력하세요."); return; }
  state.me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem("quiz.device", state.me.id);
  await setDoc(doc(respCol(state.roomId), state.me.id), { name, joinedAt: serverTimestamp(), answers:{}, alive:true }, { merge:true });
  if(els.sDialog) els.sDialog.classList.add("hide");
  if(els.sState)  els.sState.textContent = "참가 완료! 제출 버튼을 눌러주세요.";
}

async function submitAnswer(value){
  const r = window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx = r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
  const ref = doc(respCol(state.roomId), state.me.id);
  const snap = await getDoc(ref); const prev = snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert("이미 제출했습니다.");
  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:state.me.name, [`answers.${idx}`]: { value, correct:(correct===true) } }, { merge:true });
}

// 학생 화면 렌더
function renderStudent(r){
  if(!els.sWrap) return;
  // 모드 전환: 학생은 상단 관리자 UI 숨김 (CSS .admin-only 처리)
  // 상태 안내
  if(r.mode==='ended'){
    els.sState && (els.sState.innerHTML = `퀴즈가 종료되었습니다! <button id="btnMine" class="btn">내 결과 보기</button>`);
    $("#btnMine")?.addEventListener("click", async ()=>{
      // 내 결과 간단 요약 (필요 시 확장)
      const snap = await getDoc(doc(respCol(state.roomId), state.me.id));
      const me = snap.exists()? snap.data() : { name:state.me.name, answers:{} };
      const score = (r.questions||[]).reduce((acc,q,i)=> acc + (me.answers?.[i]?.correct?1:0), 0);
      alert(`${me.name} 님 점수: ${score}/${(r.questions||[]).length}`);
    });
    els.sQTitle && (els.sQTitle.textContent="");
    els.sOptBox && (els.sOptBox.innerHTML="");
    els.sShortWrap && els.sShortWrap.classList.add("hide");
    return;
  }

  if(r.mode!=='active'){
    els.sState && (els.sState.textContent = "대기 중… 교사가 시작하면 1번 문항이 표시됩니다.");
    els.sQTitle && (els.sQTitle.textContent="");
    els.sOptBox && (els.sOptBox.innerHTML="");
    els.sShortWrap && els.sShortWrap.classList.add("hide");
    return;
  }

  const q = r.questions?.[r.currentIndex];
  if(!q){ return; }

  els.sState && (els.sState.textContent = q.type==='mcq' ? "보기 클릭 후 제출 버튼을 누르세요." : "정답을 입력 후 제출을 누르세요.");
  els.sQTitle && (els.sQTitle.textContent = q.text||"");

  if(q.image){
    els.sQImg?.setAttribute("src", q.image);
    els.sQImg?.classList.remove("hide");
  }else{
    els.sQImg?.classList.add("hide");
  }

  // 보기/입력 구성
  if(q.type==='mcq'){
    els.sShortWrap && els.sShortWrap.classList.add("hide");
    if(els.sOptBox){
      els.sOptBox.innerHTML="";
      q.options.forEach((t,i)=>{
        const b=document.createElement("button");
        b.className="btn"; b.textContent=`${i+1}. ${t}`;
        b.addEventListener("click", ()=> submitAnswer(i));
        els.sOptBox.appendChild(b);
      });
      // 별도의 '제출' 버튼이 필요하다면 아래 주석 해제
      // const submitBtn=document.createElement("button"); submitBtn.className="btn success"; submitBtn.textContent="제출";
      // submitBtn.onclick=()=>{}; els.sOptBox.appendChild(submitBtn);
    }
  }else{
    if(els.sShortWrap){
      els.sShortWrap.classList.remove("hide");
      els.sShortSend.onclick = ()=> submitAnswer((els.sShortInput?.value||"").trim());
    }
    els.sOptBox && (els.sOptBox.innerHTML="");
  }
}

// ---------- 옵션 저장 / 전체 초기화 ----------
els.btnOptSave?.addEventListener("click", async ()=>{
  if(!state.roomId) return alert("세션에 먼저 접속하세요.");
  await updateDoc(roomRef(state.roomId), {
    accept: !!els.chkAllow?.checked,
    reveal: !!els.chkReveal?.checked,
    bright: !!els.chkBright?.checked,
    policy: { deviceOnce: !!els.chkDeviceOnce?.checked, nameOnce: !!els.chkNameOnce?.checked },
    timer: Math.max(5, Math.min(600, parseInt(els.timerSec?.value||"30",10)))
  });
  refreshStudentLink(); // 저장 후 QR/링크 갱신
  alert("옵션 저장 완료");
});

els.btnResetAll?.addEventListener("click", async ()=>{
  if(!state.roomId) return;
  if(!confirm("문항/옵션/응답을 모두 초기화합니다. 계속할까요?")) return;

  await setDoc(roomRef(state.roomId), {
    title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false, bright:false,
    policy:{ deviceOnce:true, nameOnce:false }, questions:[], createdAt: serverTimestamp()
  }, { merge:false });

  const res = await getDocs(respCol(state.roomId));
  await Promise.all(res.docs.map(d=>setDoc(doc(respCol(state.roomId), d.id), { answers:{}, alive:true }, { merge:true })));
  alert("초기화 완료");
});

// ---------- 탭 이벤트 ----------
els.tabs.forEach(t=>{
  t.addEventListener("click", ()=> setActiveTab(t.dataset.tab));
});

// ---------- 기타 버튼 ----------
els.btnConnect?.addEventListener("click", connect);
els.btnSignOut?.addEventListener("click", signOut);
els.btnStart?.addEventListener("click", startQuiz);
els.btnPrev?.addEventListener("click", ()=>step(-1));
els.btnNext?.addEventListener("click", ()=>step(+1));
els.btnEnd?.addEventListener("click", endQuiz);
els.btnCopyLink?.addEventListener("click", async ()=>{
  if(!els.studentLink?.value) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="복사", 1200);
});
els.btnOpenStu?.addEventListener("click", ()=> window.open(els.studentLink?.value || "#", "_blank"));

// 학생 참가
els.sJoinBtn?.addEventListener("click", join);

// ---------- 부트 ----------
function saveLocal(){ localStorage.setItem("quiz.live", JSON.stringify({ roomId:state.roomId, mode:state.mode, me:state.me })); }
function loadLocal(){
  try{
    const d = JSON.parse(localStorage.getItem("quiz.live")||"{}");
    state.roomId = d.roomId || "";
    state.mode   = d.mode   || "admin";
    state.me     = d.me     || { id:null, name:"" };
    if(state.roomId && els.roomId) els.roomId.value = state.roomId;
  }catch{}
}

function autoReconnect(){
  // URL 파라미터 → 학생 모드
  const url=new URL(location.href);
  const role=url.searchParams.get("role");
  const rid =url.searchParams.get("room");
  if(role==='student'){ setMode('student'); }
  else                { setMode('admin');   }

  loadLocal();

  if(rid){ state.roomId=rid; els.roomId && (els.roomId.value=rid); }
  if(state.roomId){
    connect();           // 세션 자동 연결
  }else{
    els.roomStatus && (els.roomStatus.textContent="세션: - · 오프라인");
  }

  // 학생 모드면 상단 관리자 UI 숨김은 setMode가 처리
}

autoReconnect();

// 전역 공유(디버깅용)
window.__app = { db, state };
