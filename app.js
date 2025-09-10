// Firestore 참조
const db = firebase.firestore();

// 세션 상태
let sessionId = null;
let isTeacher = true;   // 기본 관리자 모드
let currentIndex = -1;

// UI 요소
const app = document.getElementById("app");

// 초기 화면 (관리자 모드 기준)
function renderInitialUI() {
  app.innerHTML = `
    <header>
      <h1>실시간 퀴즈</h1>
      <input id="sessionInput" placeholder="세션 코드 입력" />
      <button id="btnConnect">접속</button>
      <button id="btnLogout">세션아웃</button>
    </header>
    <main>
      <nav>
        <button id="tabQ">① 문항</button>
        <button id="tabO">② 옵션</button>
        <button id="tabP">③ 프레젠테이션</button>
        <button id="tabR">④ 결과</button>
      </nav>
      <section id="content">
        <p>세션 접속 필요</p>
      </section>
    </main>
  `;

  document.getElementById("btnConnect").onclick = connectSession;
  document.getElementById("btnLogout").onclick = logoutSession;
}

function connectSession() {
  const input = document.getElementById("sessionInput").value.trim();
  if (!input) return alert("세션 코드를 입력하세요.");
  sessionId = input;

  // Firestore 세션 보장
  db.collection("rooms").doc(sessionId).set(
    { created: Date.now(), mode: "waiting" },
    { merge: true }
  );

  renderTeacherUI();
}

function logoutSession() {
  sessionId = null;
  renderInitialUI();
}

// 교사용 화면
function renderTeacherUI() {
  app.innerHTML = `
    <header>
      <h1>실시간 퀴즈 (세션: ${sessionId})</h1>
      <button id="btnLogout">세션아웃</button>
    </header>
    <nav>
      <button id="tabQ">① 문항</button>
      <button id="tabO">② 옵션</button>
      <button id="tabP">③ 프레젠테이션</button>
      <button id="tabR">④ 결과</button>
    </nav>
    <main id="content">
      <p>시작 버튼을 누르면 문항이 보입니다.</p>
      <button id="btnStart">시작</button>
    </main>
  `;

  document.getElementById("btnLogout").onclick = logoutSession;
  document.getElementById("btnStart").onclick = startQuiz;
}

// 퀴즈 시작
function startQuiz() {
  if (!sessionId) return;
  currentIndex = 0;

  db.collection("rooms").doc(sessionId).update({
    mode: "started",
    currentIndex
  });

  renderQuestion(currentIndex);
}

function renderQuestion(index) {
  app.querySelector("#content").innerHTML = `
    <h2>샘플 퀴즈</h2>
    <p>가장 큰 행성은?</p>
    <div class="options">
      <button>1. 지구</button>
      <button>2. 목성</button>
      <button>3. 화성</button>
      <button>4. 금성</button>
    </div>
  `;
}

// 학생 화면
function renderStudentUI() {
  app.innerHTML = `
    <main>
      <h2>세션 접속 필요</h2>
      <input id="studentName" placeholder="이름 또는 번호를 입력하세요!" />
      <button id="btnJoin">참가</button>
      <div id="studentContent"></div>
    </main>
  `;

  document.getElementById("btnJoin").onclick = joinAsStudent;
}

function joinAsStudent() {
  const name = document.getElementById("studentName").value.trim();
  if (!name) return alert("이름을 입력하세요.");

  // 참가자 Firestore 기록
  db.collection("rooms").doc(sessionId).collection("responses").doc(name).set({
    joined: Date.now(),
    answers: []
  });

  document.getElementById("studentContent").innerHTML = `
    <p>참가 완료! 교사가 시작하면 문제 풀이가 시작됩니다.</p>
  `;

  // 실시간 구독
  db.collection("rooms").doc(sessionId).onSnapshot((doc) => {
    const data = doc.data();
    if (data && data.mode === "started") {
      renderStudentQuestion();
    }
  });
}

function renderStudentQuestion() {
  document.getElementById("studentContent").innerHTML = `
    <h2>문제 1</h2>
    <p>가장 큰 행성은?</p>
    <button>1. 지구</button>
    <button>2. 목성</button>
    <button>3. 화성</button>
    <button>4. 금성</button>
  `;
}

// 앱 초기화
renderInitialUI();
