/* =========================
   실시간 퀴즈 – 안정 최종본
   - QR: qrcode 실패 시 이미지 API 폴백
   - Firestore ↔ localStorage 폴백
   - 제출 정책(기기당/실명당 1회), 골든벨(탈락)
   - 프레젠테이션/결과표/CSV, JSON 저장·불러오기
   ========================= */

const el = {
  // 공통
  roomIdInput: $("#roomIdInput"),
  btnConnect: $("#btnConnect"),
  btnTeacherMode: $("#btnTeacherMode"),
  btnStudentMode: $("#btnStudentMode"),
  statusText: $("#statusText"),
  // 가이드
  guideTeacher: $("#guide-teacher"),
  guideStudent: $("#guide-student"),
  // 탭
  teacherPanel: $("#teacherPanel"),
  joinCard: $("#joinCard"),
  tabs: $$(".tab"),
  tabBuild: $("#tab-build"),
  tabControl: $("#tab-control"),
  tabResults: $("#tab-results"),
  tabPresent: $("#tab-present"),
  // 빌더
  quizTitle: $("#quizTitle"),
  questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"),
  btnLoadSample: $("#btnLoadSample"),
  policySelect: $("#policySelect"),
  goldenBellToggle: $("#goldenBellToggle"),
  builder: $("#builder"),
  btnSaveQuiz: $("#btnSaveQuiz"),
  btnExportJSON: $("#btnExportJSON"),
  btnImportJSON: $("#btnImportJSON"),
  fileImport: $("#fileImport"),
  // 링크/QR
  qrBox: $("#qrBox"),
  studentLinkInput: $("#studentLinkInput"),
  btnCopy: $("#btnCopy"),
  btnOpenStudent: $("#btnOpenStudent"),
  // 진행
  btnStart: $("#btnStart"),
  btnPrev: $("#btnPrev"),
  btnNext: $("#btnNext"),
  toggleAccept: $("#toggleAccept"),
  toggleReveal: $("#toggleReveal"),
  ctlTitle: $("#ctlTitle"),
  ctlIdx: $("#ctlIdx"),
  ctlJoin: $("#ctlJoin"),
  ctlQuestion: $("#ctlQuestion"),
  shortGrader: $("#shortGrader"),
  shortAnswers: $("#shortAnswers"),
  chips: $("#chips"),
  policyText: $("#policyText"),
  // 결과
  btnExportCSV: $("#btnExportCSV"),
  btnResetAll: $("#btnResetAll"),
  resultsHead: $("#resultsHead"),
  resultsBody: $("#resultsBody"),
  // 프레젠테이션
  pptTitle: $("#pptTitle"),
  pptSub: $("#pptSub"),
  pptQuestion: $("#pptQuestion"),
  pptOptions: $("#pptOptions"),
  pptSubmit: $("#pptSubmit"),
  pptOk: $("#pptOk"),
  pptBad: $("#pptBad"),
  pptOut: $("#pptOut"),
  // 학생
  studentName: $("#studentName"),
  btnJoin: $("#btnJoin"),
  quizTypeBadge: $("#quizTypeBadge"),
  questionText: $("#questionText"),
  progressText: $("#progressText"),
  optionsContainer: $("#optionsContainer"),
  subjectiveBox: $("#subjectiveBox"),
  subjectiveInput: $("#subjectiveInput"),
  btnSubmitSubjective: $("#btnSubmitSubjective"),
  btnSubmitMCQ: $("#btnSubmitMCQ"),
  answerState: $("#answerState"),
};

let MODE = "teacher"; // 'teacher' | 'student'
let roomId = "";
let me = { id: null, name: "" };
let policy = "device"; // device | name
let goldenBell = false;

let db = null; // Firestore 핸들
let FS = null; // Firestore namespace

const KEYS = {
  LS_ROOM: (id) => `quiz:${id}`,
  DEVICE_TOKEN: "quiz_device_token",
};

// ===== 유틸 =====
function $(sel, el = document) { return el.querySelector(sel); }
function $$(sel, el = document) { return Array.from(el.querySelectorAll(sel)); }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function id() { return Math.random().toString(36).slice(2, 10); }
function esc(s = "") { return String(s).replace(/[&<>\"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[m])); }
function csvEsc(v) { if (v == null) return ""; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function toast(msg) { alert(msg); }

// ===== 환경/저장소: Firestore ↔ localStorage 폴백 =====
const ENV = {
  online: false,
  useFS: false,
  subs: [],
  onRoom: null,
  onResponses: null,
};

(async function initFirestore() {
  try {
    // 프로젝트 키: 사용자 제공 값 (공개 키라 안전)
    const firebaseConfig = {
      apiKey: "AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo",
      authDomain: "live-quiz-a14d1.firebaseapp.com",
      projectId: "live-quiz-a14d1",
    };
    if (window.firebase?.initializeApp) {
      const app = firebase.initializeApp(firebaseConfig);
      db = firebase.firestore(app);
      FS = firebase.firestore;
      ENV.online = true;
      ENV.useFS = true;
    }
  } catch {
    // 무시 → 로컬로 폴백
  }
})();

// 로컬 스토리지 구조
function lsRead(id) {
  const raw = localStorage.getItem(KEYS.LS_ROOM(id));
  return raw ? JSON.parse(raw) : null;
}
function lsWrite(id, data) {
  localStorage.setItem(KEYS.LS_ROOM(id), JSON.stringify(data));
}
function ensureRoomLocal(id) {
  const cur = lsRead(id);
  if (cur) return cur;
  const room = {
    title: "새 세션",
    policy: "device",
    goldenBell: false,
    mode: "idle",
    accept: false,
    reveal: false,
    currentIndex: -1,
    questions: [],
    responses: {}, // userId -> {name, alive, answers:{ idx:{value,correct,revealed} } }
  };
  lsWrite(id, room);
  return room;
}

// Firestore read/write helper (없으면 로컬)
async function fsGetRoom(id) {
  if (!ENV.useFS) return ensureRoomLocal(id);
  try {
    const snap = await db.collection("rooms").doc(id).get();
    if (!snap.exists) return null;
    return snap.data();
  } catch {
    ENV.useFS = false;
    return ensureRoomLocal(id);
  }
}
async function fsSetRoom(id, patch) {
  if (!ENV.useFS) {
    const cur = ensureRoomLocal(id);
    const next = { ...cur, ...patch };
    lsWrite(id, next);
    return;
  }
  try { await db.collection("rooms").doc(id).set(patch, { merge: true }); }
  catch { ENV.useFS = false; fsSetRoom(id, patch); }
}
async function fsGetResponses(id) {
  if (!ENV.useFS) {
    const cur = ensureRoomLocal(id);
    return Object.entries(cur.responses || {}).map(([uid, v]) => ({ id: uid, ...v }));
  }
  try {
    const ss = await db.collection("rooms").doc(id).collection("responses").get();
    const arr = [];
    ss.forEach(d => arr.push({ id: d.id, ...d.data() }));
    return arr;
  } catch {
    ENV.useFS = false;
    return fsGetResponses(id);
  }
}
async function fsSetResponse(id, uid, patch) {
  if (!ENV.useFS) {
    const cur = ensureRoomLocal(id);
    const user = cur.responses[uid] || { name: "", alive: true, answers: {} };
    cur.responses[uid] = deepMerge(user, patch);
    lsWrite(id, cur);
    return;
  }
  try { await db.collection("rooms").doc(id).collection("responses").doc(uid).set(patch, { merge: true }); }
  catch { ENV.useFS = false; fsSetResponse(id, uid, patch); }
}
function deepMerge(a, b) {
  const out = { ...a };
  for (const k in b) {
    if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) out[k] = deepMerge(a[k] || {}, b[k]);
    else out[k] = b[k];
  }
  return out;
}

// 실시간 구독(로컬은 polling)
function unsubscribeAll() { ENV.subs.forEach(u => u()); ENV.subs = []; }
function listenRoom(id, handler) {
  ENV.onRoom = handler;
  if (!ENV.useFS) {
    const tick = async () => {
      const r = await fsGetRoom(id);
      handler(r);
    };
    tick();
    const h = setInterval(tick, 1000);
    ENV.subs.push(() => clearInterval(h));
    return;
  }
  const u = db.collection("rooms").doc(id).onSnapshot(s => s.exists && handler(s.data()));
  ENV.subs.push(u);
}
function listenResponses(id, handler) {
  ENV.onResponses = handler;
  if (!ENV.useFS) {
    const tick = async () => handler(await fsGetResponses(id));
    tick();
    const h = setInterval(tick, 1000);
    ENV.subs.push(() => clearInterval(h));
    return;
  }
  const u = db.collection("rooms").doc(id).collection("responses").onSnapshot(s => {
    const arr = []; s.forEach(d => arr.push({ id: d.id, ...d.data() })); handler(arr);
  });
  ENV.subs.push(u);
}

// ===== 모드/연결 =====
setMode("teacher");
el.btnTeacherMode.addEventListener("click", () => setMode("teacher"));
el.btnStudentMode.addEventListener("click", () => setMode("student"));

function setMode(m) {
  MODE = m;
  el.teacherPanel.classList.toggle("hidden", m !== "teacher");
  el.joinCard.classList.toggle("hidden", m !== "student");
  el.guideTeacher.classList.toggle("hidden", m !== "teacher");
  el.guideStudent.classList.toggle("hidden", m !== "student");
  el.statusText.textContent = m === "teacher" ? "관리자 모드: 세션을 연결해 주세요." : "학생 모드: 세션 접속 후 참가하세요.";
}

el.btnConnect.addEventListener("click", async () => {
  const id = el.roomIdInput.value.trim();
  if (!id) return toast("세션 코드를 입력하세요.");
  roomId = id;
  // 방 보장
  const r = await fsGetRoom(roomId);
  if (!r) await fsSetRoom(roomId, ensureRoomLocal(roomId));
  // 정책/토글 반영
  policy = r?.policy || "device";
  goldenBell = !!r?.goldenBell;
  el.policyText.textContent = `정책: ${policy === "device" ? "기기당 1회" : "실명당 1회"} · 골든벨: ${goldenBell ? "ON" : "OFF"}`;
  // 구독
  unsubscribeAll();
  listenRoom(roomId, renderRoom);
  listenResponses(roomId, renderResponses);
  // 링크/QR
  await refreshStudentLink();
  el.statusText.textContent = `세션: ${roomId} · ${ENV.useFS ? "온라인" : "오프라인"} 모드`;
});

// ===== 링크/QR =====
function studentURL() {
  const url = new URL(location.href);
  url.searchParams.set("room", roomId);
  url.searchParams.set("student", "1");
  return url.toString();
}
async function refreshStudentLink() {
  if (!roomId) return;
  const url = studentURL();
  el.studentLinkInput.value = url;
  el.btnOpenStudent.href = url;
  await drawQR(url);
}
async function drawQR(text) {
  el.qrBox.innerHTML = "";
  // 1) canvas 시도
  try {
    if (window.QRCode?.toCanvas) {
      const canvas = document.createElement("canvas");
      el.qrBox.appendChild(canvas);
      await new Promise((res, rej) => window.QRCode.toCanvas(canvas, text, (err) => err ? rej(err) : res()));
      return;
    }
  } catch {}
  // 2) 폴백 이미지
  const img = new Image();
  img.alt = "QR";
  img.width = 220; img.height = 220;
  img.src = "https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=" + encodeURIComponent(text);
  el.qrBox.appendChild(img);
}
el.btnCopy.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(el.studentLinkInput.value || ""); toast("링크 복사 완료!"); }
  catch { toast("복사 실패"); }
});

// ===== 빌더 =====
el.btnBuildForm.addEventListener("click", () => {
  const n = clamp(parseInt(el.questionCount.value || "3", 10), 1, 20);
  el.builder.innerHTML = "";
  for (let i = 0; i < n; i++) el.builder.appendChild(buildQuestionRow(i + 1));
});
el.btnLoadSample.addEventListener("click", () => {
  const samples = [
    { type: "mcq", text: "태양계에서 가장 큰 행성은?", options: ["지구", "목성", "화성", "금성"], answerIndex: 1 },
    { type: "short", text: "물의 끓는점(°C)은?", answerText: "100" },
    { type: "mcq", text: "바다의 소금기는 어디서 올까요?", options: ["소금산", "강물의 광물질", "하늘", "바람"], answerIndex: 1 },
  ];
  el.quizTitle.value = "샘플 퀴즈";
  el.questionCount.value = samples.length;
  el.builder.innerHTML = "";
  samples.forEach((q, i) => el.builder.appendChild(buildQuestionRow(i + 1, q)));
});
el.btnSaveQuiz.addEventListener("click", async () => {
  if (!roomId) return toast("세션부터 접속하세요.");
  const payload = collectQuizFromBuilder();
  if (payload.questions.length === 0) return toast("문항이 없습니다.");
  policy = el.policySelect.value;
  goldenBell = !!el.goldenBellToggle.checked;
  await fsSetRoom(roomId, {
    title: payload.title,
    policy, goldenBell,
    mode: "idle", accept: false, reveal: false,
    currentIndex: -1,
    questions: payload.questions,
  });
  el.policyText.textContent = `정책: ${policy === "device" ? "기기당 1회" : "실명당 1회"} · 골든벨: ${goldenBell ? "ON" : "OFF"}`;
  toast("퀴즈 저장 완료!");
});
el.btnExportJSON.addEventListener("click", async () => {
  if (!roomId) return;
  const room = await fsGetRoom(roomId);
  const blob = new Blob([JSON.stringify(room, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${room.title || roomId}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
el.btnImportJSON.addEventListener("click", () => el.fileImport.click());
el.fileImport.addEventListener("change", async (e) => {
  const f = e.target.files?.[0]; if (!f) return;
  const text = await f.text();
  try {
    const data = JSON.parse(text);
    if (!roomId) roomId = prompt("세션 코드가 없습니다. 적용할 세션 코드를 입력하세요") || "";
    if (!roomId) return;
    await fsSetRoom(roomId, data);
    toast("불러오기 완료");
  } catch { toast("JSON 형식 오류"); }
  e.target.value = "";
});

function buildQuestionRow(no, q) {
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.innerHTML = `
    <div class="row" style="flex-wrap:wrap">
      <span class="tag">${no}번</span>
      <label class="small">유형</label>
      <label class="row" style="gap:6px"><input type="radio" name="type-${no}" value="mcq" ${q?.type === "short" ? "" : "checked"}> 객관식</label>
      <label class="row" style="gap:6px"><input type="radio" name="type-${no}" value="short" ${q?.type === "short" ? "checked" : ""}> 주관식</label>
    </div>
    <div class="row" style="margin-top:6px">
      <input class="q-text" data-no="${no}" placeholder="문항 내용" value="${esc(q?.text || "")}" style="flex:1" />
    </div>
    <div class="mcq ${q?.type === "short" ? "hidden" : ""}" data-no="${no}">
      <div class="row" style="flex-wrap:wrap;margin-top:6px;gap:8px">
        ${(q?.options || ["", "", "", ""]).map((v, i) => `<input class="opt" data-idx="${i}" placeholder="보기 ${i + 1}" value="${esc(v)}" style="width:220px" />`).join("")}
      </div>
      <div class="row" style="margin-top:6px">
        <label class="small">정답 번호</label>
        <input class="ansIndex" type="number" min="1" max="10" value="${(q?.answerIndex ?? 0) + 1}" style="width:90px" />
      </div>
    </div>
    <div class="short ${q?.type === "short" ? "" : "hidden"}" data-no="${no}">
      <div class="row" style="margin-top:6px">
        <input class="ansText" placeholder="정답(선택, 자동채점용)" value="${esc(q?.answerText || "")}" style="width:320px" />
      </div>
    </div>`;
  const radios = $$(`input[name="type-${no}"]`, wrap);
  const mcq = $(".mcq", wrap);
  const short = $(".short", wrap);
  radios.forEach(r => r.addEventListener("change", () => {
    const isShort = radios.find(x => x.checked)?.value === "short";
    mcq.classList.toggle("hidden", isShort);
    short.classList.toggle("hidden", !isShort);
  }));
  return wrap;
}
function collectQuizFromBuilder() {
  const title = el.quizTitle.value || "퀴즈";
  const cards = $$("#builder > .card");
  const questions = cards.map((card, idx) => {
    const no = idx + 1;
    const type = card.querySelector(`input[name="type-${no}"]:checked`).value;
    const text = card.querySelector(".q-text").value.trim();
    if (!text) return null;
    if (type === "mcq") {
      const opts = $$(".opt", card).map(x => x.value.trim()).filter(Boolean);
      const ansIndex = clamp(parseInt($(".ansIndex", card).value, 10) - 1, 0, Math.max(0, opts.length - 1));
      return { type: "mcq", text, options: opts, answerIndex: ansIndex };
    } else {
      const answerText = $(".ansText", card).value.trim();
      return { type: "short", text, answerText };
    }
  }).filter(Boolean);
  return { title, questions };
}

// ===== 진행 제어 =====
el.btnStart.addEventListener("click", () => updateRoom({ mode: "active", currentIndex: 0, accept: true }));
el.btnPrev.addEventListener("click", () => stepIndex(-1));
el.btnNext.addEventListener("click", () => stepIndex(1));
el.toggleAccept.addEventListener("change", () => updateRoom({ accept: !!el.toggleAccept.checked }));
el.toggleReveal.addEventListener("change", () => updateRoom({ reveal: !!el.toggleReveal.checked }));

async function updateRoom(patch) {
  if (!roomId) return;
  await fsSetRoom(roomId, patch);
}
async function stepIndex(delta) {
  const r = await fsGetRoom(roomId);
  const next = clamp((r.currentIndex ?? -1) + delta, 0, Math.max(0, (r.questions?.length || 1) - 1));
  await updateRoom({ currentIndex: next, accept: true, reveal: false });
}

// ===== 렌더링(관리자/학생/프레젠테이션/결과) =====
async function renderRoom(r) {
  window.__room = r; // 프레젠테이션 등에서 재사용
  // 공통 헤더
  el.ctlTitle.textContent = r.title || "-";
  el.ctlIdx.textContent = r.currentIndex >= 0 ? `${r.currentIndex + 1}/${r.questions?.length || 0}` : "-";
  el.toggleAccept.checked = !!r.accept;
  el.toggleReveal.checked = !!r.reveal;

  // 관리자 - 진행/채점/프레젠테이션
  if (MODE === "teacher") {
    const q = r.questions?.[r.currentIndex];
    el.ctlQuestion.innerHTML = q ? `<div class="muted">${q.type === "mcq" ? "객관식" : "주관식"}</div><div style="font-size:18px;margin-top:6px">${esc(q.text)}</div>` : "대기";
    el.shortGrader.classList.toggle("hidden", !(q && q.type === "short"));
    // 프레젠테이션
    updatePresentation(r);
  }

  // 학생
  if (MODE === "student") {
    const idx = r.currentIndex;
    const q = r.questions?.[idx];
    if (r.mode !== "active" || !q) {
      el.quizTypeBadge.textContent = "대기";
      el.questionText.textContent = "대기 중입니다…";
      el.progressText.textContent = "0 / 0";
      el.optionsContainer.innerHTML = "";
      el.subjectiveBox.classList.add("hidden");
      el.btnSubmitMCQ.classList.add("hidden");
      return;
    }
    el.progressText.textContent = `${idx + 1} / ${r.questions.length}`;
    el.quizTypeBadge.textContent = q.type === "mcq" ? "객관식" : "주관식";
    el.questionText.textContent = q.text;

    if (q.type === "mcq") {
      el.subjectiveBox.classList.add("hidden");
      el.btnSubmitMCQ.classList.remove("hidden");
      renderMCQOptions(q, r.accept, r.reveal);
    } else {
      el.optionsContainer.innerHTML = "";
      el.subjectiveBox.classList.remove("hidden");
      el.btnSubmitMCQ.classList.add("hidden");
      el.btnSubmitSubjective.disabled = !r.accept;
      el.answerState.textContent = "";
    }
  }

  // 결과표 헤더
  buildResultsHead(r);
}

function renderMCQOptions(q, accepting, revealed) {
  el.optionsContainer.innerHTML = "";
  const local = window.__myAnswer || {};
  q.options.forEach((opt, i) => {
    const b = document.createElement("button");
    b.className = "option";
    b.textContent = opt;
    b.dataset.opt = String(i);
    if (local.idx === i) b.classList.add("selected");
    if (revealed) {
      if (local.idx === i) b.classList.add(local.correct ? "correct" : "wrong");
      if (i === q.answerIndex) b.classList.add("correct");
    }
    b.onclick = () => {
      window.__myAnswer = { idx: i };
      $$(".option", el.optionsContainer).forEach(x => x.classList.remove("selected"));
      b.classList.add("selected");
    };
    el.optionsContainer.appendChild(b);
  });
  el.btnSubmitMCQ.disabled = !accepting;
}

function updatePresentation(r) {
  const q = r.questions?.[r.currentIndex];
  el.pptTitle.textContent = r.title || "-";
  el.pptSub.textContent = r.currentIndex >= 0 ? `문항 ${r.currentIndex + 1} / ${r.questions?.length || 0}` : "-";
  if (!q) {
    el.pptQuestion.textContent = "대기 중…";
    el.pptOptions.innerHTML = "";
    return;
  }
  el.pptQuestion.textContent = q.text;
  el.pptOptions.innerHTML = "";
  if (q.type === "mcq") {
    q.options.forEach((t, i) => {
      const d = document.createElement("div");
      d.className = "option";
      d.textContent = `${i + 1}. ${t}`;
      el.pptOptions.appendChild(d);
    });
  } else {
    const d = document.createElement("div");
    d.className = "muted";
    d.textContent = "주관식 문항입니다.";
    el.pptOptions.appendChild(d);
  }
}

async function renderResponses(arr) {
  el.ctlJoin.textContent = String(arr.length);
  const r = window.__room;
  if (!r) return;

  // 진행 칩(정답/오답/탈락)
  el.chips.innerHTML = "";
  let submit = 0, ok = 0, bad = 0, out = 0;
  arr.forEach(s => {
    const a = s.answers?.[r.currentIndex];
    const tag = document.createElement("div");
    tag.className = "chip";
    let cls = "";
    if (s.alive === false) { cls = "bad"; out++; }
    if (a) { submit++; if (a.correct) ok++; else bad++; }
    tag.textContent = s.name || s.id;
    el.chips.appendChild(tag);
  });
  el.pptSubmit.textContent = submit;
  el.pptOk.textContent = ok;
  el.pptBad.textContent = bad;
  el.pptOut.textContent = out;

  // 주관식 채점 리스트
  const q = r.questions?.[r.currentIndex];
  if (MODE === "teacher" && q && q.type === "short") {
    el.shortAnswers.innerHTML = "";
    arr.forEach(s => {
      const a = s.answers?.[r.currentIndex];
      if (!a || typeof a.value !== "string") return;
      const row = document.createElement("div");
      row.className = "row";
      const left = document.createElement("div");
      left.textContent = `${s.name}: ${a.value}`;
      const right = document.createElement("div");
      const okBtn = makeBtn("정답", "btn ghost", () => gradeAnswer(s.id, r.currentIndex, true));
      const badBtn = makeBtn("오답", "btn ghost", () => gradeAnswer(s.id, r.currentIndex, false));
      right.appendChild(okBtn); right.appendChild(badBtn);
      row.appendChild(left); row.appendChild(right);
      el.shortAnswers.appendChild(row);
    });
  }

  // 결과 표
  buildResultsBody(r, arr);
}
function makeBtn(text, cls, fn) { const b = document.createElement("button"); b.className = cls; b.textContent = text; b.onclick = fn; return b; }

// ===== 학생 참가/제출 =====
el.btnJoin.addEventListener("click", async () => {
  if (MODE !== "student") return;
  if (!roomId) return toast("세션에 먼저 접속하세요.");
  const name = el.studentName.value.trim();
  if (!name) return toast("이름을 입력하세요.");

  const token = getDeviceToken();
  const uid = policy === "device" ? token : name;
  me = { id: uid, name };
  await fsSetResponse(roomId, uid, { name, joinedAt: Date.now(), alive: true });

  toast(`${name} 님, 참가 완료!`);
});

function getDeviceToken() {
  let t = localStorage.getItem(KEYS.DEVICE_TOKEN);
  if (!t) { t = id(); localStorage.setItem(KEYS.DEVICE_TOKEN, t); }
  return t;
}

el.btnSubmitSubjective.addEventListener("click", async () => {
  const r = window.__room; if (!r) return;
  if (!r.accept) return toast("현재 제출이 허용되지 않습니다.");
  const val = el.subjectiveInput.value.trim();
  if (!val) return toast("정답을 입력하세요.");
  await submitAnswer(val);
});
el.btnSubmitMCQ.addEventListener("click", async () => {
  const r = window.__room; if (!r) return;
  if (!r.accept) return toast("현재 제출이 허용되지 않습니다.");
  const chosen = window.__myAnswer?.idx;
  if (typeof chosen !== "number") return toast("보기 하나를 선택하세요.");
  await submitAnswer(chosen);
});

async function submitAnswer(value) {
  if (!me.id) return toast("먼저 참가하세요.");
  const r = await fsGetRoom(roomId);
  const idx = r.currentIndex;
  const q = r.questions?.[idx];
  if (!q) return;

  // 중복 제출 방지
  const mine = (await fsGetResponses(roomId)).find(x => x.id === me.id);
  const old = mine?.answers?.[idx];
  if (old) return toast("이미 제출했습니다.");

  let correct = false;
  if (q.type === "mcq" && typeof value === "number") correct = value === q.answerIndex;
  if (q.type === "short" && typeof value === "string") {
    const norm = (s) => String(s).trim().toLowerCase();
    if (q.answerText) correct = norm(value) === norm(q.answerText);
  }

  // 저장
  await fsSetResponse(roomId, me.id, {
    name: me.name,
    answers: { [idx]: { value, correct, revealed: q.type === "mcq" } },
  });

  // 골든벨: 오답 탈락
  if (r.goldenBell && !correct) await fsSetResponse(roomId, me.id, { alive: false });

  if (q.type === "short") el.answerState.textContent = `제출: ${value}`;
  else el.answerState.textContent = correct ? "정답!" : "제출 완료";
}

// 주관식 채점
async function gradeAnswer(uid, qIndex, correct) {
  await fsSetResponse(roomId, uid, { answers: { [qIndex]: { correct: !!correct, revealed: true } } });
  if (window.__room?.goldenBell && !correct) await fsSetResponse(roomId, uid, { alive: false });
}

// ===== 결과표 & CSV =====
function buildResultsHead(r) {
  const qLen = r.questions?.length || 0;
  el.resultsHead.innerHTML = "";
  const cells = ["이름", ...Array.from({ length: qLen }, (_, i) => `Q${i + 1}`), "점수", "상태"];
  cells.forEach(t => {
    const th = document.createElement("th"); th.textContent = t; el.resultsHead.appendChild(th);
  });
}
function buildResultsBody(r, arr) {
  el.resultsBody.innerHTML = "";
  const qLen = r.questions?.length || 0;
  arr.forEach(s => {
    const tr = document.createElement("tr");
    const tdName = document.createElement("td"); tdName.textContent = s.name || s.id; tr.appendChild(tdName);
    let score = 0;
    for (let i = 0; i < qLen; i++) {
      const td = document.createElement("td");
      const a = s.answers?.[i];
      if (!a) td.textContent = "-";
      else {
        if (a.correct) score++;
        const q = r.questions[i];
        td.textContent = q.type === "mcq" ? (typeof a.value === "number" ? String(a.value + 1) : "-") : (a.value || "-");
      }
      tr.appendChild(td);
    }
    const tdScore = document.createElement("td"); tdScore.textContent = String(score); tr.appendChild(tdScore);
    const tdAlive = document.createElement("td"); tdAlive.textContent = s.alive === false ? "out" : "alive"; tr.appendChild(tdAlive);
    el.resultsBody.appendChild(tr);
  });
}
el.btnExportCSV.addEventListener("click", async () => {
  if (!roomId) return;
  const r = await fsGetRoom(roomId);
  const arr = await fsGetResponses(roomId);
  const head = ["userId", "name", ...r.questions.map((_, i) => `Q${i + 1}`), "score", "alive"].join(",");
  const rows = [head];
  arr.forEach(s => {
    let score = 0; const ans = r.questions.map((q, i) => {
      const a = s.answers?.[i]; if (a?.correct) score++;
      return q.type === "mcq" ? (typeof a?.value === "number" ? String(a.value + 1) : "") : (a?.value ?? "");
    });
    rows.push([csvEsc(s.id), csvEsc(s.name), ...ans.map(csvEsc), score, s.alive === false ? "out" : "alive"].join(","));
  });
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `${r.title || roomId}-results.csv`; a.click();
  URL.revokeObjectURL(a.href);
});
el.btnResetAll.addEventListener("click", async () => {
  if (!roomId) return;
  if (!confirm("모든 응답과 진행 상태를 초기화할까요?")) return;
  const r = await fsGetRoom(roomId);
  await fsSetRoom(roomId, {
    mode: "idle", accept: false, reveal: false, currentIndex: -1,
    responses: ENV.useFS ? undefined : {}, // 로컬이라면 응답도 같이 제거
  });
  if (ENV.useFS) {
    const arr = await fsGetResponses(roomId);
    for (const x of arr) await fsSetResponse(roomId, x.id, { answers: {}, alive: true });
  }
  toast("초기화 완료");
});

// ===== 탭 전환 =====
el.tabs.forEach(t => t.addEventListener("click", () => {
  el.tabs.forEach(x => x.classList.remove("pri")); t.classList.add("pri");
  [el.tabBuild, el.tabControl, el.tabResults, el.tabPresent].forEach(p => p.classList.add("hidden"));
  const name = t.dataset.tab;
  if (name === "build") el.tabBuild.classList.remove("hidden");
  if (name === "control") el.tabControl.classList.remove("hidden");
  if (name === "results") el.tabResults.classList.remove("hidden");
  if (name === "present") el.tabPresent.classList.remove("hidden");
}));

/* ======= 초기 URL 파라미터로 학생 모드 진입 지원 ======= */
window.addEventListener("DOMContentLoaded", async () => {
  const url = new URL(location.href);
  const paramRoom = url.searchParams.get("room");
  const isStudent = url.searchParams.get("student") === "1";

  if (paramRoom) {
    el.roomIdInput.value = paramRoom;
    await el.btnConnect.click();
  }
  if (isStudent) {
    setMode("student");
    el.statusText.textContent = "학생 모드: 세션 접속 후 참가하세요.";
  }
});
