/* app.js  —  ES Module */

/* ---------- Firestore helpers (모듈별 개별 import 없이 window.db로 동작) ---------- */
import {
  doc, setDoc, getDoc, updateDoc, onSnapshot, runTransaction,
  collection, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* ---------- Shortcuts ---------- */
const $  = (s, el=document)=>el.querySelector(s);
const $$ = (s, el=document)=>Array.from(el.querySelectorAll(s));
const pad = n=>String(n).padStart(2,'0');

/* ---------- DOM refs (관리자 공통) ---------- */
const els = {
  // 헤더
  roomId:      $("#roomId"),
  btnConnect:  $("#btnConnect"),
  btnSignOut:  $("#btnSignOut"),
  roomStatus:  $("#roomStatus"),
  // 탭
  tabBuild:    $("#tabBuild"),
  tabOptions:  $("#tabOptions"),
  tabPresent:  $("#tabPresent"),
  tabResults:  $("#tabResults"),
  // 패널
  pBuild:      $("#panelBuild"),
  pOptions:    $("#panelOptions"),
  pPresent:    $("#panelPresent"),
  pResults:    $("#panelResults"),
};

/* ---------- 전역 상태 ---------- */
let MODE   = "admin";         // 'admin' | 'student'
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;

/* ---------- 학생 전용 UI(필요 시 동적 생성) ---------- */
function ensureStudentShell() {
  if ($("#studentAccess")) return;
  const wrap = document.createElement("div");
  wrap.id = "studentAccess";
  wrap.innerHTML = `
    <div id="joinModal" class="card" style="max-width:640px;margin:20px auto">
      <h3 style="margin:0 0 8px">이름(번호)을 입력하세요</h3>
      <div class="row">
        <input id="joinName" class="input grow" placeholder="이름 또는 번호" />
        <button id="btnJoinGo" class="btn primary">참가</button>
      </div>
    </div>

    <div id="sWait" class="card hide" style="max-width:640px;margin:20px auto">
      <strong class="muted">참가 완료!</strong>
      <div style="margin-top:8px">교사가 시작 버튼을 누르면 1번 문항이 표시됩니다.</div>
      <div id="sState" class="muted" style="margin-top:4px">대기 중…</div>
    </div>

    <div id="sQuiz" class="card hide" style="max-width:900px;margin:20px auto">
      <div class="row between align-center" style="margin-bottom:8px">
        <div id="sQTitle" style="font-weight:700"></div>
        <div id="sTimer" class="muted"></div>
      </div>
      <img id="sQImg" class="hide" style="max-width:100%;border-radius:12px;margin:8px 0"/>
      <div id="sOptBox" class="row wrap"></div>
      <div id="sShortWrap" class="row hide" style="margin-top:8px">
        <input id="sShort" class="input grow" placeholder="정답 입력" />
      </div>
      <div class="row" style="margin-top:10px">
        <button id="sSubmit" class="btn success">제출</button>
      </div>
    </div>

    <div id="sEnded" class="card hide" style="max-width:640px;margin:20px auto;text-align:center">
      <h3>퀴즈가 종료되었습니다!</h3>
      <button id="btnMyResult" class="btn">내 결과 보기</button>
    </div>
  `;
  document.body.appendChild(wrap);
}

/* ---------- 모드 전환(보여줄 것/숨길 것) ---------- */
function setMode(m){
  MODE = m;

  // 관리자 전용(헤더·탭 등) 표시/숨김
  $$(".admin-only").forEach(el=>{
    if (m==="admin") el.classList.remove("hide");
    else el.classList.add("hide");
  });

  // 패널 가시성: 첫 진입(관리자)은 "문항"만 보이도록 강제
  if (m==="admin") {
    showPanel("build");        // 첫 화면: 문항 패널만
  } else {
    // 학생은 모든 관리자 패널 숨김
    ["build","options","present","results"].forEach(key=>{
      const map = {build:els.pBuild, options:els.pOptions, present:els.pPresent, results:els.pResults};
      map[key]?.classList.add("hide");
    });
    ensureStudentShell();
  }

  // 헤더 상태 텍스트
  if (els.roomStatus){
    els.roomStatus.textContent = roomId ? `세션: ${roomId} · 온라인` : `세션: - · 오프라인`;
  }
}

/* ---------- 패널 토글 ---------- */
function showPanel(which){
  const map = {build:els.pBuild, options:els.pOptions, present:els.pPresent, results:els.pResults};
  Object.values(map).forEach(p=>p?.classList.add("hide"));
  map[which]?.classList.remove("hide");

  // 탭 하이라이트
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
  ({build:els.tabBuild, options:els.tabOptions, present:els.tabPresent, results:els.tabResults}[which])?.classList.add("active");
}

/* ---------- Firestore refs ---------- */
const rRef  = id => doc(window.db, "rooms", id);
const rsCol = id => collection(window.db, "rooms", id, "responses");

/* ---------- 연결 / 재연결 ---------- */
async function ensureRoom(id){
  const snap = await getDoc(rRef(id));
  if (!snap.exists()){
    await setDoc(rRef(id), {
      title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false,
      createdAt: serverTimestamp(), questions:[]
    });
  }
}

async function connect(){
  const id = (els.roomId?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId = id;
  await ensureRoom(roomId);

  listenRoom(roomId);

  // UI 잠금/언락
  if (els.roomId) { els.roomId.disabled = true; }
  els.btnConnect?.classList.add("hide");
  els.btnSignOut?.classList.remove("hide");
  if (els.roomStatus) els.roomStatus.textContent = `세션: ${roomId} · 온라인`;
  localStorage.setItem("quiz.live", JSON.stringify({roomId, MODE}));
}

function signOut(){
  if (els.roomId) { els.roomId.disabled = false; }
  els.btnSignOut?.classList.add("hide");
  els.btnConnect?.classList.remove("hide");
  if (els.roomStatus) els.roomStatus.textContent = `세션: - · 오프라인`;
  if (unsubRoom){unsubRoom();unsubRoom=null;}
  roomId="";
  localStorage.removeItem("quiz.live");
}

/* ---------- 실시간 룸/응답 리스너 ---------- */
function listenRoom(id){
  if (unsubRoom) unsubRoom();
  unsubRoom = onSnapshot(rRef(id), (snap)=>{
    if(!snap.exists()) return;
    const r = snap.data();
    window.__room = r;
    renderAdmin(r);
    renderStudent(r);
  });
}

/* ---------- 관리자 화면 렌더(필요 최소) ---------- */
function renderAdmin(r){
  if (MODE!=="admin") return;

  // 프레젠테이션: 시작 전 안내문구
  const textEl = $("#pQ");
  if (textEl){
    if (r.mode!=="active" || (r.currentIndex??-1) < 0){
      textEl.textContent = "시작 버튼을 누르면 문항이 제시됩니다.";
    } else {
      const q = r.questions?.[r.currentIndex];
      textEl.textContent = q?.text || "-";
      const img = $("#pImg");
      if (img){
        if (q?.imageUrl) { img.src=q.imageUrl; img.classList.remove("hide"); }
        else { img.classList.add("hide"); img.removeAttribute("src"); }
      }
    }
  }
}

/* ---------- 학생 화면 렌더 ---------- */
function renderStudent(r){
  if (MODE!=="student") return;
  ensureStudentShell();

  const joinModal = $("#joinModal");
  const sWait     = $("#sWait");
  const sQuiz     = $("#sQuiz");
  const sEnded    = $("#sEnded");
  const sQTitle   = $("#sQTitle");
  const sQImg     = $("#sQImg");
  const sOptBox   = $("#sOptBox");
  const sShortWrap= $("#sShortWrap");
  const sTimer    = $("#sTimer");

  // 아직 참가 안 했으면 참가 모달 유지
  const joined = !!(me?.id && me?.name);
  joinModal?.classList.toggle("hide", joined);

  // 종료면 안내
  if (r.mode==="ended"){
    sWait?.classList.add("hide");
    sQuiz?.classList.add("hide");
    sEnded?.classList.remove("hide");
    return;
  }

  // 시작 전 = 대기
  if (r.mode!=="active" || (r.currentIndex??-1) < 0){
    sEnded?.classList.add("hide");
    sQuiz?.classList.add("hide");
    if (joined) sWait?.classList.remove("hide");
    return;
  }

  // 진행 중
  sEnded?.classList.add("hide");
  sWait?.classList.add("hide");
  sQuiz?.classList.remove("hide");

  const q = r.questions?.[r.currentIndex];
  if (!q){ sQTitle.textContent="-"; return; }

  // 타이머 표시는 간단 표기(선택)
  sTimer.textContent = r.accept ? "" : "제출 마감";

  sQTitle.textContent = q.text || "-";
  if (q.imageUrl){ sQImg.src=q.imageUrl; sQImg.classList.remove("hide"); }
  else { sQImg.classList.add("hide"); sQImg.removeAttribute("src"); }

  // 보기/주관식
  sOptBox.innerHTML="";
  sShortWrap.classList.add("hide");
  if (q.type==="mcq"){
    (q.options||[]).forEach((t,i)=>{
      const b=document.createElement("button");
      b.className="btn";
      b.textContent=`${i+1}. ${t}`;
      b.onclick=()=>{ sOptBox.dataset.sel = i; };
      sOptBox.appendChild(b);
    });
  }else{
    sShortWrap.classList.remove("hide");
  }
}

/* ---------- 학생 참가/제출 ---------- */
async function join(){
  if (!roomId) return alert("세션 연결 후 참가할 수 있습니다.");
  const nm = $("#joinName")?.value?.trim();
  if (!nm) return alert("이름(번호)을 입력하세요.");
  me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name:nm };
  localStorage.setItem("quiz.device", me.id);

  await setDoc(doc(rsCol(roomId), me.id), {
    name: nm, joinedAt: serverTimestamp(), answers:{}, alive:true
  }, { merge:true });

  $("#joinModal")?.classList.add("hide");
  $("#sWait")?.classList.remove("hide");
}

async function submit(){
  if (MODE!=="student") return;
  const r = window.__room; if(!r) return;
  if (!r.accept) return alert("지금은 제출할 수 없습니다.");

  const idx = r.currentIndex; const q = r.questions?.[idx];
  if (!q) return;

  const ref  = doc(rsCol(roomId), me.id);
  const snap = await getDoc(ref);
  const prev = snap.exists()? (snap.data().answers || {}) : {};
  if (prev[idx] != null) return alert("이미 제출했습니다.");

  let val=null;
  if (q.type==="mcq"){
    const sel = parseInt($("#sOptBox")?.dataset?.sel,10);
    if (Number.isNaN(sel)) return alert("보기를 선택해 주세요.");
    val = sel;
  }else{
    const txt = $("#sShort")?.value?.trim();
    if (!txt) return alert("정답을 입력해 주세요.");
    val = txt;
  }
  await setDoc(ref, { [`answers.${idx}`]: { value:val } }, { merge:true });
  alert("제출 완료!");
}

/* ---------- 관리자: 시작/이전/다음/종료(필요 최소) ---------- */
async function startQuiz(){ await updateDoc(rRef(roomId), { mode:"active", currentIndex:0, accept:true }); }
async function step(delta){
  await runTransaction(window.db, async (tx)=>{
    const snap = await tx.get(rRef(roomId));
    const r = snap.data(); const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if (next>=total){ // 종료
      tx.update(rRef(roomId), { mode:"ended", accept:false });
      return;
    }
    next=Math.max(0,next);
    tx.update(rRef(roomId), { currentIndex:next, accept:true });
  });
}
async function finishAll(){ await updateDoc(rRef(roomId), { mode:"ended", accept:false }); }

/* ---------- 이벤트 바인딩 ---------- */
// 헤더
els.btnConnect?.addEventListener("click", connect);
els.btnSignOut?.addEventListener("click", signOut);

// 탭
els.tabBuild?.addEventListener("click",   ()=> showPanel("build"));
els.tabOptions?.addEventListener("click", ()=> showPanel("options"));
els.tabPresent?.addEventListener("click", ()=> showPanel("present"));
els.tabResults?.addEventListener("click", ()=> showPanel("results"));

// 프레젠테이션 제어 버튼(이미 index.html 쪽에 버튼이 있다면 id만 맞춰서 연결)
$("#btnStart")?.addEventListener("click", startQuiz);
$("#btnPrev") ?.addEventListener("click", ()=>step(-1));
$("#btnNext") ?.addEventListener("click", ()=>step(+1));
$("#btnEndAll")?.addEventListener("click", finishAll);

// 학생
document.addEventListener("click",(e)=>{
  if (e.target?.id==="btnJoinGo") join();
  if (e.target?.id==="sSubmit")  submit();
  if (e.target?.id==="btnMyResult"){ alert("개인 결과 표시는 기존 결과 로직에 연결하세요."); }
});

/* ---------- 부팅(모드/세션 자동 복원 + URL 파라미터) ---------- */
function autoReconnect(){
  const url = new URL(location.href);
  const role = url.searchParams.get("role");       // student | admin
  const rid  = url.searchParams.get("room");       // 세션 코드
  if (role==="student") MODE="student";

  const saved = JSON.parse(localStorage.getItem("quiz.live")||"{}");
  roomId = rid || saved.roomId || "";

  setMode(MODE);

  if (MODE==="student"){
    ensureStudentShell();
    if (roomId) listenRoom(roomId);                // 학생은 청취만
  } else {
    if (roomId) { if (els.roomId) els.roomId.value=roomId; connect(); }
  }
}
autoReconnect();
