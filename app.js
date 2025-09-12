// ==========================
// Firebase 준비 확인
// ==========================
if (!window.firebase || !window.db) {
  console.error("[firebase] not loaded. index.html에서 firebase compat 스크립트와 초기화 확인 필요.");
}

// ==========================
// 글로벌 상태
// ==========================
let role = new URLSearchParams(window.location.search).get("role") || "admin";
let room = new URLSearchParams(window.location.search).get("room") || null;
let currentUser = null;
let unsubscribe = null;

// ==========================
// 요소 선택자
// ==========================
const $ = (id) => document.getElementById(id);

// 관리자 전용
const roomInput = $("roomInput");
const connectBtn = $("connectBtn");
const disconnectBtn = $("disconnectBtn");
const sessionState = $("sessionState");

const btnStart = $("btnStart");
const btnPrev = $("btnPrev");
const btnNext = $("btnNext");
const btnEnd = $("btnEnd");
const presentationView = $("presentationView");
const waitMessage = $("waitMessage");

const resultTable = $("resultTable");

// 학생 전용
const joinModal = $("joinModal");
const studentNameInput = $("studentName");
const btnJoin = $("btnJoin");
const studentWait = $("studentWait");
const studentQuiz = $("studentQuiz");
const sQTitle = $("sQTitle");
const sQImg = $("sQImg");
const sOptBox = $("sOptBox");
const sShortAnswer = $("sShortAnswer");
const sSubmit = $("sSubmit");
const studentResult = $("studentResult");
const btnMyResult = $("btnMyResult");

// ==========================
// Firestore Ref 함수
// ==========================
const roomRef = (roomId) => window.db.collection("rooms").doc(roomId);
const responsesCol = (roomId) => roomRef(roomId).collection("responses");

// ==========================
// UI 헬퍼
// ==========================
function showAdminUI() {
  document.querySelectorAll(".admin-only").forEach(el => el.classList.remove("hidden"));
  document.querySelectorAll(".student-only").forEach(el => el.classList.add("hidden"));
}

function showStudentUI() {
  document.querySelectorAll(".student-only").forEach(el => el.classList.remove("hidden"));
  document.querySelectorAll(".admin-only").forEach(el => el.classList.add("hidden"));
}

function clearPresentation() {
  presentationView.innerHTML = `<p id="waitMessage">시작 버튼을 누르면 문항이 제시됩니다.</p>`;
}

// ==========================
// 관리자 모드
// ==========================
async function connectRoom() {
  const roomId = roomInput.value.trim();
  if (!roomId) return alert("세션 코드를 입력하세요.");
  room = roomId;

  await roomRef(room).set({
    mode: "waiting",
    currentIndex: -1,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  sessionState.textContent = `세션: ${room} · 온라인`;
  listenRoom();
}

async function disconnectRoom() {
  if (unsubscribe) unsubscribe();
  room = null;
  sessionState.textContent = "세션: - · 오프라인";
  clearPresentation();
}

async function startQuiz() {
  if (!room) return;
  await roomRef(room).update({ mode: "active", currentIndex: 0 });
}

async function nextQuestion() {
  if (!room) return;
  const snap = await roomRef(room).get();
  const data = snap.data();
  if (!data) return;
  const newIndex = (data.currentIndex ?? -1) + 1;
  await roomRef(room).update({ currentIndex: newIndex });
}

async function endQuiz() {
  if (!room) return;
  await roomRef(room).update({ mode: "ended" });
}

// ==========================
// 학생 모드
// ==========================
function joinAsStudent() {
  const name = studentNameInput.value.trim();
  if (!name) return alert("이름을 입력하세요!");
  currentUser = name;

  joinModal.classList.add("hidden");
  studentWait.classList.remove("hidden");

  listenRoom();
}

async function submitAnswer(ans) {
  if (!room || !currentUser) return;
  await responsesCol(room).doc(currentUser).set({
    answers: firebase.firestore.FieldValue.arrayUnion(ans)
  }, { merge: true });

  alert("제출 완료!");
}

// ==========================
// Firestore 리스너
// ==========================
function listenRoom() {
  if (!room) return;
  if (unsubscribe) unsubscribe();

  unsubscribe = roomRef(room).onSnapshot((snap) => {
    const data = snap.data();
    if (!data) return;

    // 관리자 UI 반영
    if (role === "admin") {
      if (data.mode === "waiting") {
        clearPresentation();
      } else if (data.mode === "active") {
        presentationView.innerHTML = `<h2>Q${data.currentIndex + 1} 문항 표시</h2>`;
      } else if (data.mode === "ended") {
        presentationView.innerHTML = `<p>퀴즈가 종료되었습니다.</p>`;
      }
    }

    // 학생 UI 반영
    if (role === "student") {
      if (data.mode === "waiting") {
        studentWait.classList.remove("hidden");
        studentQuiz.classList.add("hidden");
        studentResult.classList.add("hidden");
      } else if (data.mode === "active") {
        studentWait.classList.add("hidden");
        studentQuiz.classList.remove("hidden");
        studentResult.classList.add("hidden");

        sQTitle.textContent = `Q${data.currentIndex + 1} 문항이 표시됩니다.`;
        sSubmit.classList.remove("hidden");
      } else if (data.mode === "ended") {
        studentQuiz.classList.add("hidden");
        studentResult.classList.remove("hidden");
      }
    }
  });
}

// ==========================
// 이벤트 바인딩
// ==========================
if (connectBtn) connectBtn.addEventListener("click", connectRoom);
if (disconnectBtn) disconnectBtn.addEventListener("click", disconnectRoom);
if (btnStart) btnStart.addEventListener("click", startQuiz);
if (btnNext) btnNext.addEventListener("click", nextQuestion);
if (btnEnd) btnEnd.addEventListener("click", endQuiz);

if (btnJoin) btnJoin.addEventListener("click", joinAsStudent);
if (sSubmit) sSubmit.addEventListener("click", () => {
  const ans = sShortAnswer.value || "객관식 선택";
  submitAnswer(ans);
});

// ==========================
// 초기 로딩
// ==========================
window.addEventListener("DOMContentLoaded", () => {
  if (role === "admin") {
    showAdminUI();
  } else {
    showStudentUI();
  }
  if (room) listenRoom();
});
