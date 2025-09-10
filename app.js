/* =========================================================
 * Live Quiz - app.js (compat 버전, 전체 복붙)
 * ---------------------------------------------------------
 * 요구사항 요약
 *  - 프레젠테이션: 처음엔 "시작 버튼을 누르면…" 안내 → 시작 클릭 즉시 Q1 노출
 *  - 학생 링크/QR: 이름 입력 → 참가(대기) → 교사 시작 시 Q1 노출
 *  - 학생 제출이 종료를 유발하지 않음 (종료는 교사 step/종료로만)
 *  - 엘리먼트가 없어도 앱이 죽지 않도록 안전 가드
 * ========================================================= */

/* ---------- Firebase compat 로드 확인 ---------- */
(function ensureFirebase(){
  if(!(window.firebase && firebase.apps)){
    console.error("[firebase] not loaded. Ensure compat scripts are included in index.html");
  }
})();

/* ---------- Firestore 핸들 ---------- */
const app = firebase.apps.length ? firebase.app() : firebase.initializeApp({
  // 이미 index.html에서 초기화했다면 이 블록은 무시됩니다.
  // 필요 시 project 설정을 여기에 둬도 됩니다.
});
const db = firebase.firestore();

/* ---------- 유틸: 안전한 DOM 참조 & 도우미 ---------- */
const $id = (id) => document.getElementById(id) || null;
const setText = (el, txt) => { if(el) el.textContent = txt ?? ""; };
const show = (el, flag) => { if(el){ el.classList.toggle("hide", !flag); } };
const html = (el, h) => { if(el){ el.innerHTML = h ?? ""; } };
const pad2 = (n) => String(n).padStart(2,"0");

/* ---------- 전역 상태 ---------- */
let MODE   = "admin";          // 'admin' | 'student'
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom = null, unsubResp = null;

/* ---------- 엘리먼트 바인딩(없어도 동작) ---------- */
// 상단/세션
const UI = {
  roomId: $id("roomId"),
  btnConnect: $id("btnConnect"),
  roomStatus: $id("roomStatus"),
  btnLogout: $id("btnLogout"),   // 세션아웃(있다면)

  // 탭
  tabBuild: $id("tabBuild"),
  tabOpt: $id("tabOpt"),
  tabPresent: $id("tabPresent"),
  tabResult: $id("tabResult"),

  // 패널
  pBuild: $id("panelBuild"),
  pOpt: $id("panelOpt"),
  pPresent: $id("panelPresent"),
  pResults: $id("panelResults"),

  // 프레젠테이션(관리자)
  pTitle: $id("pTitle") || $id("presentTitle"),
  pQ: $id("pQ") || $id("presentQ"),
  pOpts: $id("pOpts") || $id("presentOpts"),
  pNote: $id("presentNote") || $id("presentWait"),
  btnStart: $id("btnStart") || $id("startBtn"),
  btnPrev: $id("btnPrev") || $id("prevBtn"),
  btnNext: $id("btnNext") || $id("nextBtn"),
  btnEnd: $id("btnEndAll") || $id("btnEnd") || $id("endBtn"),
  qStat: $id("qStat") || $id("progress") || $id("counterQ"),

  // 학생
  sPanel: $id("studentPanel") || $id("studentWrap"),
  sName: $id("studentName") || $id("joinName"),
  btnJoin: $id("btnJoin") || $id("btnJoinGo"),
  sState: $id("sState") || $id("studentState"),
  sMcqBox: $id("mcqBox") || $id("studentMCQ"),
  sShortBox: $id("shortBox") || $id("studentShort"),
  sShortInput: $id("shortInput") || $id("sShortInput"),
  btnShortSend: $id("btnShortSend") || $id("btnStudentSend"),

  // 결과(관리자/학생 공용 일부)
  resultsTable: $id("resultsTable"),
  btnMyResult: $id("btnMyResult"),

  // 학생 링크/QR (옵션 탭 등에 있을 수 있음)
  qrCanvas: $id("qrCanvas"),
  studentLink: $id("studentLink"),
  btnCopyLink: $id("btnCopyLink"),
  btnOpenStudent: $id("btnOpenStudent"),
};

/* ---------- 로컬 저장 ---------- */
function saveLocal(){ try{
  localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me }));
} catch(_){} }
function loadLocal(){ try{
  const d = JSON.parse(localStorage.getItem("quiz.live")||"{}");
  roomId = d.roomId || "";
  MODE = d.MODE || MODE;
  me = d.me || me;
  if(UI.roomId && roomId) UI.roomId.value = roomId;
} catch(_){} }

/* ---------- Firestore ref ---------- */
function roomRef(id){ return db.collection("rooms").doc(String(id||"").trim()); }
function respCol(id){ return db.collection("rooms").doc(String(id||"").trim()).collection("responses"); }

/* ---------- 방 보정/생성 ---------- */
async function ensureRoom(id){
  if(!id) return;
  const ref = roomRef(id);
  const snap = await ref.get();
  if(!snap.exists){
    await ref.set({
      title: "새 세션",
      mode: "idle",           // idle | active | ended
      currentIndex: -1,       // 대기(-1)에서 시작
      accept: false,
      reveal: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      questions: []
    });
  }else{
    // 잘못 저장된 값 보정
    const r = snap.data() || {};
    if(typeof r.currentIndex !== "number"){
      await ref.set({ currentIndex:-1, mode:"idle", accept:false }, { merge:true });
    }
  }
}

/* ---------- 실시간 리스너 ---------- */
function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom = roomRef(id).onSnapshot(snap=>{
    if(!snap.exists) return;
    const r = snap.data() || {};
    window.__room = r;
    renderRoom(r);
  });
}
function listenResponses(id){
  if(unsubResp) unsubResp();
  unsubResp = respCol(id).onSnapshot(qs=>{
    const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    renderResponses(arr);
  });
}

/* ---------- 링크/QR ---------- */
function buildStudentLink(){
  if(!UI.studentLink) return;
  const url = new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", roomId || (UI.roomId?.value||"").trim());
  UI.studentLink.value = url.toString();

  if(window.QRCode && UI.qrCanvas){
    try{
      QRCode.toCanvas(UI.qrCanvas, UI.studentLink.value, { width: 160 }, ()=>{});
    }catch(e){ console.warn("QR draw failed", e); }
  }
}

/* ---------- 모드 & 접속 ---------- */
function setMode(m){
  MODE = m === "student" ? "student" : "admin";

  // 탭/패널 보이기 (학생은 프레젠테이션/결과만 볼 수 있게)
  show(UI.pBuild, MODE==="admin");
  show(UI.pOpt, MODE==="admin");
  show(UI.pResults, MODE==="admin");
  show(UI.pPresent, true);

  // 학생은 상단 관리자 탭 숨김 (있다면)
  show(UI.tabBuild, MODE==="admin");
  show(UI.tabOpt, MODE==="admin");
  show(UI.tabResult, MODE==="admin");

  // 학생: 이름/참가 UI는 보이고, 보기/입력은 교사가 시작할 때
  if(MODE==="student"){
    show(UI.sPanel, true);
  }

  if(UI.roomStatus){
    if(!roomId) UI.roomStatus.textContent = MODE==="admin"
      ? "세션에 접속해 주세요." : "학생 모드: 세션 접속 후 참가하세요.";
    else UI.roomStatus.textContent = `세션: ${roomId} · 온라인`;
  }
}
async function connect(){
  const id = (UI.roomId?.value||"").trim();
  if(!id) return alert("세션 코드를 입력하세요.");
  roomId = id;
  await ensureRoom(roomId);
  listenRoom(roomId);
  listenResponses(roomId);
  buildStudentLink();
  if(UI.roomStatus) UI.roomStatus.textContent = `세션: ${roomId} · 온라인`;
  saveLocal();
}
function logoutSession(){
  if(!roomId) return;
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  roomId = "";
  if(UI.roomId){ UI.roomId.value=""; UI.roomId.disabled=false; }
  if(UI.roomStatus) UI.roomStatus.textContent = "세션 아웃됨";
  saveLocal();
}

/* ---------- 교사 제어: 시작/이동/종료 ---------- */
async function startQuiz(){
  if(!roomId) return;
  const ref = roomRef(roomId);
  await db.runTransaction(async tx=>{
    const snap = await tx.get(ref);
    const r = snap.data() || {};
    const total = (r.questions?.length || 0);
    if(total<=0) return; // 문항 없음
    // 대기에서 → Q1
    tx.update(ref, { mode:"active", currentIndex:0, accept:true, reveal:false });
  });
}
async function step(delta){
  if(!roomId) return;
  const ref = roomRef(roomId);
  await db.runTransaction(async tx=>{
    const snap = await tx.get(ref);
    const r = snap.data() || {};
    const total = (r.questions?.length || 0);
    let idx = (typeof r.currentIndex==="number" ? r.currentIndex : -1) + delta;

    if(idx >= total){
      // 마지막을 넘어가면 종료
      tx.update(ref, { mode:"ended", currentIndex: total-1, accept:false });
      return;
    }
    if(idx < 0) idx = 0;

    tx.update(ref, { currentIndex: idx, mode:"active", accept:true });
  });
}
async function finishAll(){
  if(!roomId) return;
  await roomRef(roomId).set({ mode:"ended", accept:false }, { merge:true });
}

/* ---------- 학생 참가/제출 ---------- */
async function join(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name = (UI.sName?.value||"").trim();
  if(!name) return alert("이름(번호)을 입력하세요.");
  const id = localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10);
  localStorage.setItem("quiz.device", id);
  me = { id, name };

  await respCol(roomId).doc(id).set({
    name,
    joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
    answers:{},
    alive:true
  }, { merge:true });

  setText(UI.sState, "참가 완료! 교사가 시작하면 문항이 표시됩니다.");
  saveLocal();
}
async function submit(value){
  const r = window.__room;
  if(!r || !r.accept) return alert("지금은 제출할 수 없습니다.");
  const idx = r.currentIndex;
  const q = r.questions?.[idx];
  if(idx==null || idx<0 || !q) return;

  const ref = respCol(roomId).doc(me.id);
  const snap = await ref.get();
  const prev = snap.exists ? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert("이미 제출했습니다.");

  let correct = null;
  if(q.type==='mcq' && typeof value==='number'){
    correct = (value===(q.answerIndex??-999));
  }else if(q.type==='short' && typeof value==='string'){
    const norm = s => String(s).trim().toLowerCase();
    if(q.answerText) correct = (norm(value)===norm(q.answerText));
  }

  await ref.set({
    name: me.name,
    [`answers.${idx}`]: { value, correct:(correct===true), revealed: !!r.reveal }
  }, { merge:true });
}

/* ---------- 렌더: 방 & 응답 ---------- */
function renderRoom(r){
  const total = r.questions?.length || 0;
  const idx = (typeof r.currentIndex==="number" ? r.currentIndex : -1);

  // 상단 카운터
  setText(UI.qStat, `Q${(r.mode==="active" && idx>=0)? idx+1 : 0}/${total}`);

  // ─ 관리자 프레젠테이션 ─
  setText(UI.pTitle, r.title || roomId || "퀴즈");

  if(r.mode!=="active" || idx<0){
    // 대기/종료 화면
    show(UI.pNote, true);
    setText(UI.pNote, (r.mode==="ended") ? "퀴즈가 종료되었습니다." : "시작 버튼을 누르면 문항이 제시됩니다.");
    setText(UI.pQ, "");
    html(UI.pOpts, "");
  }else{
    // 진행 중 문항
    show(UI.pNote, false);
    const q = r.questions[idx];
    setText(UI.pQ, q?.text || "");
    if(UI.pOpts){
      html(UI.pOpts,"");
      if(q?.type==="mcq"){
        (q.options||[]).forEach((t,i)=>{
          const d=document.createElement("div");
          d.className="popt";
          d.textContent = `${i+1}. ${t}`;
          UI.pOpts.appendChild(d);
        });
      }
    }
  }

  // ─ 학생 화면 ─
  if(MODE==="student"){
    if(r.mode!=="active" || idx<0){
      setText(UI.sState, "참가 완료! 교사가 시작하면 Q1이 표시됩니다.");
      if(UI.sMcqBox) html(UI.sMcqBox,"");
      if(UI.sShortBox) UI.sShortBox.classList.add("hide");
      return;
    }
    const q = r.questions[idx];
    setText(UI.sState, (q.type==='mcq'?"객관식":"주관식") + " • 제출 가능");

    if(q.type==='mcq'){
      if(UI.sMcqBox){
        html(UI.sMcqBox,"");
        (q.options||[]).forEach((t,i)=>{
          const b=document.createElement("button");
          b.className="optbtn";
          b.textContent = `${i+1}. ${t}`;
          b.disabled = !r.accept;
          b.addEventListener("click", ()=> submit(i));
          UI.sMcqBox.appendChild(b);
        });
      }
      if(UI.sShortBox) UI.sShortBox.classList.add("hide");
    }else{
      if(UI.sMcqBox) html(UI.sMcqBox,"");
      if(UI.sShortBox){
        UI.sShortBox.classList.remove("hide");
        if(UI.btnShortSend){
          UI.btnShortSend.disabled = !r.accept;
          UI.btnShortSend.onclick = ()=> submit((UI.sShortInput?.value||"").trim());
        }
      }
    }

    if(r.mode==="ended"){
      setText(UI.sState, "퀴즈가 종료되었습니다.");
      if(UI.sMcqBox) html(UI.sMcqBox,"");
      if(UI.sShortBox) UI.sShortBox.classList.add("hide");
    }
  }
}

function renderResponses(list){
  // 관리자 결과 테이블
  if(MODE!=="admin" || !UI.resultsTable) return;
  const r = window.__room || {};
  const qs = r.questions || [];

  const tbl = document.createElement("table");
  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  ["이름", ...qs.map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{
    const th=document.createElement("th"); th.textContent=h; trh.appendChild(th);
  });
  thead.appendChild(trh); tbl.appendChild(thead);

  const tb = document.createElement("tbody");
  list.forEach(s=>{
    let score=0; const tr=document.createElement("tr");
    const tdName=document.createElement("td"); tdName.textContent=s.name||s.id; tr.appendChild(tdName);
    qs.forEach((q,i)=>{
      const a=s.answers?.[i]; const td=document.createElement("td");
      if(a){
        if(q.type==='mcq'){
          td.textContent = (typeof a.value==='number') ? a.value+1 : "-";
        }else{
          td.textContent = a.value ?? "-";
        }
        if(a.correct) score++;
      }else td.textContent="-";
      tr.appendChild(td);
    });
    const tdScore=document.createElement("td"); tdScore.textContent = String(score); tr.appendChild(tdScore);
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  html(UI.resultsTable,"");
  UI.resultsTable.appendChild(tbl);
}

/* ---------- 이벤트 바인딩 ---------- */
UI.btnConnect && UI.btnConnect.addEventListener("click", ()=>{
  // 세션 입력 잠금(있다면)
  if(UI.roomId) UI.roomId.disabled = true;
  connect();
});
UI.btnLogout && UI.btnLogout.addEventListener("click", ()=>{
  logoutSession();
});

UI.btnStart && UI.btnStart.addEventListener("click", startQuiz);
UI.btnPrev  && UI.btnPrev.addEventListener("click", ()=>step(-1));
UI.btnNext  && UI.btnNext.addEventListener("click", ()=>step(+1));
UI.btnEnd   && UI.btnEnd.addEventListener("click", finishAll);

UI.btnJoin  && UI.btnJoin.addEventListener("click", join);
UI.btnShortSend && (UI.btnShortSend.onclick = ()=> submit((UI.sShortInput?.value||"").trim()));

UI.btnCopyLink && UI.btnCopyLink.addEventListener("click", async ()=>{
  if(UI.studentLink?.value){
    try{ await navigator.clipboard.writeText(UI.studentLink.value); }catch(_){}
  }
});
UI.btnOpenStudent && UI.btnOpenStudent.addEventListener("click", ()=>{
  if(UI.studentLink?.value) window.open(UI.studentLink.value, "_blank");
});

/* ---------- 부팅 로직 ---------- */
function autoReconnect(){
  loadLocal();

  // URL로 모드/세션 지정: ?role=student&room=class1
  const url = new URL(location.href);
  const role = url.searchParams.get("role");
  const rid  = url.searchParams.get("room");
  if(role==='student') MODE="student";
  setMode(MODE);

  if(rid){
    roomId = rid;
    if(UI.roomId){ UI.roomId.value = rid; UI.roomId.disabled = (MODE==="admin"); }
    connect();
  }else{
    // 저장된 세션 자동 접속
    if(roomId) connect();
  }
}
autoReconnect();
