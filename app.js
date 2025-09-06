/* ===============================
   Firebase 초기화
================================= */
const firebaseConfig = {
  apiKey: "AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo",
  authDomain: "live-quiz-a14d1.firebaseapp.com",
  projectId: "live-quiz-a14d1",
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

/* ===============================
   전역 상태 & 유틸
================================= */
const qs = (s, el = document) => el.querySelector(s);
const qsa = (s, el = document) => Array.from(el.querySelectorAll(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let MODE = "teacher"; // 'teacher' | 'student'
let roomId = "";
let roomUnsub = null;
let respUnsub = null;
let roomCache = null;
let responsesCache = [];
let timer = { id: null, until: 0 };

const deviceId = (() => {
  let t = localStorage.getItem("device_id");
  if (!t) {
    t = crypto.randomUUID?.() || "dev-" + Math.random().toString(36).slice(2);
    localStorage.setItem("device_id", t);
  }
  return t;
})();

const el = {
  // 공통
  statusText: qs("#statusText"),
  roomIdInput: qs("#roomIdInput"),
  btnConnect: qs("#btnConnect"),
  btnTeacherMode: qs("#btnTeacherMode"),
  btnStudentMode: qs("#btnStudentMode"),
  studentPanel: qs("#studentPanel"),
  teacherPanel: qs("#teacherPanel"),
  tabs: qsa(".tab"),
  tabBuild: qs("#tab-build"),
  tabControl: qs("#tab-control"),
  tabResults: qs("#tab-results"),

  // 빌더
  quizTitle: qs("#quizTitle"),
  questionCount: qs("#questionCount"),
  btnBuildForm: qs("#btnBuildForm"),
  btnLoadSample: qs("#btnLoadSample"),
  btnSaveQuiz: qs("#btnSaveQuiz"),
  builder: qs("#builder"),
  btnExportRoomJSON: qs("#btnExportRoomJSON"),
  loadRoomJSON: qs("#loadRoomJSON"),

  // 진행
  toggleAccept: qs("#toggleAccept"),
  toggleGoldenbell: qs("#toggleGoldenbell"),
  submitPolicy: qs("#submitPolicy"),
  btnStart: qs("#btnStart"),
  btnPrev: qs("#btnPrev"),
  btnNext: qs("#btnNext"),
  btnStop: qs("#btnStop"),
  ctlQuestion: qs("#ctlQuestion"),
  chips: qs("#chips"),
  shortGrader: qs("#shortGrader"),
  shortAnswers: qs("#shortAnswers"),
  timerSec: qs("#timerSec"),
  btnTimerStart: qs("#btnTimerStart"),
  btnTimerStop: qs("#btnTimerStop"),
  leftTime: qs("#leftTime"),
  btnOpenPresent: qs("#btnOpenPresent"),

  // 결과
  btnExportCSV: qs("#btnExportCSV"),
  btnResetAll: qs("#btnResetAll"),
  resultsContainer: qs("#resultsContainer"),

  // 학생 화면
  studentName: qs("#studentName"),
  btnJoin: qs("#btnJoin"),
  joinedHint: qs("#joinedHint"),
  progressText: qs("#progressText"),
  questionText: qs("#questionText"),
  quizTypeBadge: qs("#quizTypeBadge"),
  optionsContainer: qs("#optionsContainer"),
  subjectiveBox: qs("#subjectiveBox"),
  subjectiveInput: qs("#subjectiveInput"),
  btnSubmitSubjective: qs("#btnSubmitSubjective"),
  answerState: qs("#answerState"),

  // QR/링크
  qrBox: qs("#qrBox"),
  studentLinkInput: qs("#studentLinkInput"),
  btnCopy: qs("#btnCopy"),
};

/* ===============================
   모드/탭 전환
================================= */
function setMode(m) {
  MODE = m;
  el.teacherPanel.classList.toggle("hidden", m !== "teacher");
  el.studentPanel.classList.toggle("hidden", m !== "student");
  el.statusText.textContent =
    m === "teacher"
      ? "관리자 모드: 세션을 연결해 주세요."
      : "학생 모드: 세션 접속 후 참가하세요.";
}
el.btnTeacherMode.addEventListener("click", () => setMode("teacher"));
el.btnStudentMode.addEventListener("click", () => setMode("student"));

// 탭
el.tabs.forEach((t) =>
  t.addEventListener("click", () => {
    el.tabs.forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    const name = t.dataset.tab;
    [el.tabBuild, el.tabControl, el.tabResults].forEach((p) =>
      p.classList.add("hidden")
    );
    if (name === "build") el.tabBuild.classList.remove("hidden");
    if (name === "control") el.tabControl.classList.remove("hidden");
    if (name === "results") el.tabResults.classList.remove("hidden");
  })
);

/* ===============================
   연결/리스너/링크·QR
================================= */
el.btnConnect.addEventListener("click", async () => {
  const id = (el.roomIdInput.value || "").trim();
  if (!id) return alert("세션 코드를 입력하세요.");
  roomId = id;
  await ensureRoomExists(roomId);
  listenRoom(roomId);
  listenResponses(roomId);
  refreshStudentLink();
});

async function ensureRoomExists(id) {
  const ref = db.collection("rooms").doc(id);
  const s = await ref.get();
  if (!s.exists) {
    await ref.set({
      title: "새 세션",
      mode: "idle", // idle | active | ended
      currentIndex: -1,
      accept: false,
      goldenbell: false,
      policy: "device",
      questions: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }
}

function listenRoom(id) {
  if (roomUnsub) roomUnsub();
  roomUnsub = db
    .collection("rooms")
    .doc(id)
    .onSnapshot((snap) => {
      if (!snap.exists) return;
      roomCache = snap.data();
      renderRoom(roomCache);
    });
}
function listenResponses(id) {
  if (respUnsub) respUnsub();
  respUnsub = db
    .collection("rooms")
    .doc(id)
    .collection("responses")
    .onSnapshot((snap) => {
      const arr = [];
      snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
      responsesCache = arr;
      renderResponses(arr);
      renderResults(arr);
    });
}

function studentURL() {
  const url = new URL(location.href);
  url.searchParams.set("room", roomId);
  url.searchParams.set("student", "1");
  return url.toString();
}
function presentURL() {
  const url = new URL(location.href);
  url.searchParams.set("room", roomId);
  url.searchParams.set("present", "1");
  url.searchParams.delete("student");
  return url.toString();
}
async function refreshStudentLink() {
  const url = studentURL();
  el.studentLinkInput.value = url;
  el.qrBox.innerHTML = "";
  const canvas = document.createElement("canvas");
  el.qrBox.appendChild(canvas);
  await window.QRCode.toCanvas(canvas, url);
}
el.btnCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(el.studentLinkInput.value);
    el.btnCopy.textContent = "복사됨!";
    await sleep(800);
  } finally {
    el.btnCopy.textContent = "링크 복사";
  }
});
el.btnOpenPresent.addEventListener("click", () => {
  if (!roomId) return alert("먼저 세션에 접속하세요.");
  window.open(presentURL(), "_blank", "noopener,noreferrer");
});

/* ===============================
   빌더(문항)
================================= */
el.btnBuildForm.addEventListener("click", () => {
  const n = clamp(parseInt(el.questionCount.value || "3", 10), 1, 20);
  el.builder.innerHTML = "";
  for (let i = 0; i < n; i++) el.builder.appendChild(buildQuestionRow(i + 1));
});
el.btnLoadSample.addEventListener("click", () => {
  el.quizTitle.value = "샘플 퀴즈";
  el.questionCount.value = 3;
  el.builder.innerHTML = "";
  const samples = [
    { type: "mcq", text: "태양계에서 가장 큰 행성은?", options: ["지구", "목성", "화성", "금성"], answerIndex: 1 },
    { type: "short", text: "물의 끓는점(°C)은?", answerText: "100" },
    { type: "mcq", text: "바다의 소금기는 어디서 올까요?", options: ["소금산", "강물의 광물질", "하늘", "바람"], answerIndex: 1 },
  ];
  samples.forEach((q, i) => el.builder.appendChild(buildQuestionRow(i + 1, q)));
});
el.btnSaveQuiz.addEventListener("click", async () => {
  if (!roomId) return alert("세션을 먼저 연결하세요.");
  const payload = collectQuizFromBuilder();
  if (payload.questions.length === 0) return alert("문항을 추가하세요.");
  await db.collection("rooms").doc(roomId).set({
    title: payload.title,
    questions: payload.questions,
  }, { merge: true });
  alert("퀴즈 저장 완료.");
});

// JSON 저장/불러오기(방 정의 전체)
el.btnExportRoomJSON.addEventListener("click", async () => {
  if (!roomId) return;
  const snap = await db.collection("rooms").doc(roomId).get();
  const data = snap.data();
  download("room.json", JSON.stringify(data, null, 2), "application/json");
});
el.loadRoomJSON.addEventListener("change", async (e) => {
  if (!roomId) return;
  const f = e.target.files?.[0];
  if (!f) return;
  const text = await f.text();
  const data = JSON.parse(text);
  // questions/title/policy/goldenbell 등 병합
  await db.collection("rooms").doc(roomId).set(data, { merge: true });
  alert("JSON을 불러와 저장했습니다.");
  e.target.value = "";
});

function buildQuestionRow(no, q = null) {
  const wrap = document.createElement("div");
  wrap.className = "panel";
  wrap.innerHTML = `
    <div class="row" style="gap:12px;flex-wrap:wrap">
      <span class="badge">${no}번</span>
      <label class="row" style="gap:6px">
        <input type="radio" name="type-${no}" value="mcq" ${q?.type === "short" ? "" : "checked"} /> 객관식
      </label>
      <label class="row" style="gap:6px">
        <input type="radio" name="type-${no}" value="short" ${q?.type === "short" ? "checked" : ""} /> 주관식
      </label>
      <input class="q-text" data-no="${no}" placeholder="문항 내용" value="${escapeHtml(q?.text || "")}" style="flex:1" />
    </div>
    <div class="mcq ${q?.type === "short" ? "hidden" : ""}">
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px">
        ${(q?.options || ["", "", "", ""])
          .map(
            (v, i) =>
              `<input class="opt" data-no="${no}" data-idx="${i}" placeholder="보기 ${i + 1}" value="${escapeHtml(v)}" style="width:220px" />`
          )
          .join("")}
      </div>
      <div class="row" style="margin-top:8px;gap:8px">
        <span class="badge">정답 번호</span>
        <input class="ansIndex" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex ?? 0) + 1}" style="width:100px" />
      </div>
    </div>
    <div class="short ${q?.type === "short" ? "" : "hidden"}" style="margin-top:8px">
      <input class="ansText" data-no="${no}" placeholder="정답(선택, 자동채점용)" value="${escapeHtml(q?.answerText || "")}" style="width:300px" />
    </div>
  `;
  const radios = qsa(`input[name="type-${no}"]`, wrap);
  const mcq = qs(".mcq", wrap);
  const short = qs(".short", wrap);
  radios.forEach((r) =>
    r.addEventListener("change", () => {
      const isShort = radios.find((x) => x.checked)?.value === "short";
      mcq.classList.toggle("hidden", isShort);
      short.classList.toggle("hidden", !isShort);
    })
  );
  return wrap;
}

function collectQuizFromBuilder() {
  const title = el.quizTitle.value || "퀴즈";
  const cards = qsa("#builder > .panel");
  const questions = cards
    .map((card, idx) => {
      const no = idx + 1;
      const type = card.querySelector(`input[name="type-${no}"]:checked`).value;
      const text = card.querySelector(".q-text").value.trim();
      if (!text) return null;
      if (type === "mcq") {
        const opts = qsa(".opt", card).map((x) => x.value.trim()).filter(Boolean);
        const ansIndex = clamp(parseInt(card.querySelector(".ansIndex").value, 10) - 1, 0, Math.max(0, opts.length - 1));
        return { type: "mcq", text, options: opts, answerIndex: ansIndex };
      } else {
        const answerText = card.querySelector(".ansText").value.trim();
        return { type: "short", text, answerText };
      }
    })
    .filter(Boolean);
  return { title, questions };
}

/* ===============================
   진행/제출/타이머
================================= */
el.toggleAccept.addEventListener("change", () => updateRoom({ accept: el.toggleAccept.checked }));
el.toggleGoldenbell.addEventListener("change", () => updateRoom({ goldenbell: el.toggleGoldenbell.checked }));
el.submitPolicy.addEventListener("change", () => updateRoom({ policy: el.submitPolicy.value }));

el.btnStart.addEventListener("click", () => updateRoom({ mode: "active", currentIndex: 0, accept: true }));
el.btnStop.addEventListener("click", () => updateRoom({ mode: "ended", accept: false }));
el.btnPrev.addEventListener("click", () => stepIndex(-1));
el.btnNext.addEventListener("click", () => stepIndex(1));

el.btnTimerStart.addEventListener("click", () => {
  if (!roomCache) return;
  const sec = Math.max(0, parseInt(el.timerSec.value || "0", 10));
  const until = Date.now() + sec * 1000;
  updateRoom({ timerUntil: until, accept: true });
});
el.btnTimerStop.addEventListener("click", () => updateRoom({ timerUntil: 0 }));

async function updateRoom(patch) {
  if (!roomId) return;
  await db.collection("rooms").doc(roomId).set(patch, { merge: true });
}
async function stepIndex(delta) {
  const ref = db.collection("rooms").doc(roomId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const r = snap.data();
    const next = clamp((r.currentIndex ?? -1) + delta, 0, Math.max(0, (r.questions?.length || 1) - 1));
    tx.set(ref, { currentIndex: next, accept: true, timerUntil: 0 }, { merge: true });
  });
}

/* ===============================
   학생 참가/제출
================================= */
let me = { id: null, name: "" };
el.btnJoin.addEventListener("click", async () => {
  if (!roomId) return alert("먼저 세션에 접속하세요.");
  const name = (el.studentName.value || "").trim();
  if (!name) return alert("이름을 입력하세요.");
  me = { id: deviceId, name };
  await db.collection("rooms").doc(roomId).collection("responses").doc(me.id).set({
    name,
    status: "alive",
    joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  el.joinedHint.textContent = `${name} 님, 참가 완료!`;
  alert("참가 완료!");
});

el.btnSubmitSubjective.addEventListener("click", () => {
  const v = (el.subjectiveInput.value || "").trim();
  if (!v) return alert("답을 입력하세요.");
  submitAnswer(v);
});

el.optionsContainer.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-opt]");
  if (!btn) return;
  // 객관식도 제출 버튼 방식으로 통일: 클릭 → 선택 표시 → 확인창
  const idx = parseInt(btn.dataset.opt, 10);
  qsa("#optionsContainer .option").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  if (confirm("이 보기로 제출하시겠어요?")) submitAnswer(idx);
});

async function submitAnswer(value) {
  if (!roomId || !me.id) return alert("먼저 참가하세요.");
  const room = roomCache;
  if (!room?.accept) return alert("현재 제출이 허용되지 않습니다.");

  const idx = room.currentIndex;
  const q = room.questions?.[idx];
  if (!q) return;

  // 정책 검사
  if (room.policy === "device") {
    const key = `submitted_${roomId}_${idx}_${me.id}`;
    if (localStorage.getItem(key)) return alert("이미 제출했습니다.");
    localStorage.setItem(key, "1");
  } else if (room.policy === "name") {
    const ref = db.collection("rooms").doc(roomId).collection("responses");
    const snap = await ref.where("name", "==", me.name).get();
    if (!snap.empty) {
      const d = snap.docs[0].data();
      if (d.answers?.[idx]) return alert("이미 제출했습니다.");
    }
  }

  // 채점
  let correct = null;
  if (q.type === "mcq" && typeof value === "number") {
    correct = value === q.answerIndex;
  } else if (q.type === "short" && typeof value === "string") {
    correct =
      q.answerText?.trim()?.toLowerCase?.() === value.trim().toLowerCase();
  }

  const patch = {
    name: me.name,
    [`answers.${idx}`]: { value, correct: correct === true, revealed: q.type === "mcq" },
  };
  if (room.goldenbell && correct === false) patch.status = "out";

  await db.collection("rooms").doc(roomId).collection("responses").doc(me.id).set(patch, { merge: true });

  // 학생 feedback
  if (q.type === "mcq") {
    el.answerState.textContent = "제출 완료!";
  } else {
    el.answerState.textContent = `제출: ${value}`;
  }
}

/* ===============================
   렌더링(방/응답/결과/타이머)
================================= */
function renderRoom(r) {
  // 공통 표시
  el.toggleAccept.checked = !!r.accept;
  el.toggleGoldenbell.checked = !!r.goldenbell;
  el.submitPolicy.value = r.policy || "device";

  // 타이머
  setupTimer(r.timerUntil || 0);

  // 관리자
  if (MODE === "teacher") {
    const idx = r.currentIndex;
    const q = r.questions?.[idx];
    el.ctlQuestion.textContent = q ? `${idx + 1}. ${q.text}` : "-";
    el.shortGrader.classList.toggle("hidden", !(q && q.type === "short"));
    if (q && q.type === "short") buildShortAnswerList();
  }

  // 학생
  if (MODE === "student") {
    const idx = r.currentIndex;
    const q = r.questions?.[idx];
    if (r.mode !== "active" || !q) {
      el.progressText.textContent = "0 / 0";
      el.questionText.textContent = "대기 중입니다…";
      el.quizTypeBadge.textContent = "대기";
      el.optionsContainer.innerHTML = "";
      el.subjectiveBox.classList.add("hidden");
      return;
    }
    const total = r.questions.length;
    el.progressText.textContent = `${idx + 1} / ${total}`;
    el.questionText.textContent = q.text;
    el.quizTypeBadge.textContent = q.type === "mcq" ? "객관식" : "주관식";
    el.answerState.textContent = "";

    if (q.type === "mcq") {
      el.subjectiveBox.classList.add("hidden");
      el.optionsContainer.innerHTML = q.options
        .map((opt, i) => `<button class="option" data-opt="${i}">${escapeHtml(opt)}</button>`)
        .join("");
    } else {
      el.optionsContainer.innerHTML = "";
      el.subjectiveBox.classList.remove("hidden");
      el.subjectiveInput.value = "";
      el.btnSubmitSubjective.disabled = !r.accept;
    }
  }
}

function renderResponses(arr) {
  if (MODE !== "teacher") return;
  el.chips.innerHTML = "";
  arr.forEach((x) => {
    const chip = document.createElement("div");
    chip.className = "chip" + (x.status === "out" ? " out" : "");
    chip.textContent = x.name || x.id;
    el.chips.appendChild(chip);
  });
}

function renderResults(arr) {
  if (MODE !== "teacher") return;
  const r = roomCache;
  const qsList = r?.questions || [];
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const htr = document.createElement("tr");
  ["이름", ...qsList.map((_, i) => `Q${i + 1}`), "점수", "상태"].forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  arr.forEach((s) => {
    let score = 0;
    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.textContent = s.name || s.id;
    tr.appendChild(tdName);

    qsList.forEach((q, i) => {
      const td = document.createElement("td");
      const a = s.answers?.[i];
      if (a) {
        if (a.correct) score++;
        td.textContent = q.type === "mcq" ? (typeof a.value === "number" ? `${a.value + 1}` : "-") : a.value ?? "-";
      } else td.textContent = "-";
      tr.appendChild(td);
    });

    const tdScore = document.createElement("td");
    tdScore.textContent = String(score);
    const tdState = document.createElement("td");
    tdState.textContent = s.status || "alive";
    if (s.status === "out") tdState.style.color = "#ff8080";
    tr.appendChild(tdScore);
    tr.appendChild(tdState);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  el.resultsContainer.innerHTML = "";
  el.resultsContainer.appendChild(table);
}

function buildShortAnswerList() {
  const r = roomCache;
  if (!r) return;
  const idx = r.currentIndex;
  const arr = responsesCache || [];
  el.shortAnswers.innerHTML = "";
  arr.forEach((s) => {
    const a = s.answers?.[idx];
    if (!a || typeof a.value !== "string") return;
    const row = document.createElement("div");
    row.className = "row";
    row.style.justifyContent = "space-between";
    const left = document.createElement("div");
    left.textContent = `${s.name}: ${a.value}`;
    const right = document.createElement("div");
    const ok = document.createElement("button");
    ok.className = "btn ghost";
    ok.textContent = "정답";
    ok.onclick = () => gradeAnswer(s.id, idx, true);
    const no = document.createElement("button");
    no.className = "btn ghost";
    no.textContent = "오답";
    no.onclick = () => gradeAnswer(s.id, idx, false);
    right.appendChild(ok);
    right.appendChild(no);
    row.appendChild(left);
    row.appendChild(right);
    el.shortAnswers.appendChild(row);
  });
}
async function gradeAnswer(uid, qIndex, correct) {
  const ref = db.collection("rooms").doc(roomId).collection("responses").doc(uid);
  const patch = { [`answers.${qIndex}.correct`]: !!correct, [`answers.${qIndex}.revealed`]: true };
  if (roomCache?.goldenbell && !correct) patch.status = "out";
  await ref.set(patch, { merge: true });
}

function setupTimer(until) {
  if (timer.id) {
    clearInterval(timer.id);
    timer.id = null;
  }
  if (!until) {
    el.leftTime.textContent = "00:00";
    return;
  }
  function tick() {
    const left = Math.max(0, Math.floor((until - Date.now()) / 1000));
    const mm = String(Math.floor(left / 60)).padStart(2, "0");
    const ss = String(left % 60).padStart(2, "0");
    el.leftTime.textContent = `${mm}:${ss}`;
    if (left <= 0) {
      clearInterval(timer.id);
      timer.id = null;
      updateRoom({ accept: false, timerUntil: 0 });
    }
  }
  tick();
  timer.id = setInterval(tick, 250);
}

/* ===============================
   결과/CSV & 전체 초기화
================================= */
el.btnExportCSV.addEventListener("click", async () => {
  if (!roomId) return;
  const rs = await db.collection("rooms").doc(roomId).get();
  const r = rs.data();
  const qs = r.questions || [];
  const snap = await db.collection("rooms").doc(roomId).collection("responses").get();
  const rows = [];
  rows.push(["userId", "name", ...qs.map((_, i) => `Q${i + 1}`), "score", "status"].join(","));
  snap.forEach((doc) => {
    const d = doc.data();
    let score = 0;
    const answers = qs.map((q, i) => {
      const a = d.answers?.[i];
      if (a?.correct) score++;
      return a ? (q.type === "mcq" ? (typeof a.value === "number" ? a.value + 1 : "") : escapeCsv(a.value ?? "")) : "";
    });
    rows.push([doc.id, escapeCsv(d.name || ""), ...answers, score, d.status || "alive"].join(","));
  });
  download(`${(r.title || roomId)}-results.csv`, rows.join("\n"), "text/csv");
});

el.btnResetAll.addEventListener("click", async () => {
  if (!roomId) return;
  if (!confirm("모든 응답 및 진행 상태를 초기화할까요?")) return;
  const col = db.collection("rooms").doc(roomId).collection("responses");
  const snap = await col.get();
  const batch = db.batch();
  snap.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  await db.collection("rooms").doc(roomId).set({ mode: "idle", currentIndex: -1, accept: false, timerUntil: 0 }, { merge: true });
  alert("초기화 완료!");
});

/* ===============================
   프레젠테이션 모드 (별도 URL)
   ?present=1&room=XXXX
================================= */
(function maybePresent() {
  const url = new URL(location.href);
  if (url.searchParams.get("present") !== "1") return;
  document.body.innerHTML = `
    <div style="min-height:100vh;background:#091018;color:#e8f0ff;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;padding:20px">
      <div id="pTitle" style="opacity:.7"></div>
      <div id="pProgress" style="font-size:16px;opacity:.9"></div>
      <div id="pQuestion" style="max-width:960px;font-size:38px;text-align:center"></div>
      <div id="pOptions" style="max-width:960px;width:100%;"></div>
      <div style="position:fixed;right:16px;top:12px;background:#0b1220;border:1px solid #1e2937;padding:8px 12px;border-radius:12px">남은시간 <span id="pLeft">00:00</span></div>
    </div>`;
  const rid = url.searchParams.get("room");
  if (!rid) return;
  roomId = rid;
  listenRoom(rid);
  listenResponses(rid);
  setMode("teacher"); // 렌더만 재활용

  // 프리젠 전용 렌더 오버라이드
  renderRoom = function (r) {
    setupTimer(r.timerUntil || 0);
    const idx = r.currentIndex;
    const q = r.questions?.[idx];
    qs("#pTitle").textContent = r.title || rid;
    qs("#pProgress").textContent = r.mode === "active" && q ? `${idx + 1} / ${r.questions.length}` : "대기 중";
    qs("#pQuestion").textContent = r.mode === "active" && q ? q.text : "대기 중입니다…";
    const box = qs("#pOptions");
    box.innerHTML = "";
    if (r.mode === "active" && q && q.type === "mcq") {
      q.options.forEach((opt, i) => {
        const b = document.createElement("div");
        b.textContent = `${i + 1}. ${opt}`;
        b.style.cssText =
          "font-size:22px;padding:10px 14px;margin:8px 0;background:#0b1220;border:1px solid #1e2937;border-radius:12px";
        box.appendChild(b);
      });
    }
  };
})();

/* ===============================
   헬퍼
================================= */
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function escapeHtml(s = "") {
  return s.replace(/[&<>\"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
function escapeCsv(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function download(name, text, mime) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime || "text/plain" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ===============================
   초기 모드 & 쿼리 파라미터
================================= */
(function initFromURL() {
  const url = new URL(location.href);
  const rid = url.searchParams.get("room");
  const isStudent = url.searchParams.get("student") === "1";
  if (rid) {
    el.roomIdInput.value = rid;
    el.btnConnect.click();
  }
  setMode(isStudent ? "student" : "teacher");
})();
