/*************************************************
 * app.js — 최종 완성본 (compat Firebase + QR + 학생흐름)
 *************************************************/

/* ---------- 안전 가드: firebase 로딩 확인 ---------- */
(function ensureFirebase() {
  if (!window.firebase || !firebase.apps) {
    console.error("[firebase] not loaded. Ensure compat scripts are included in index.html");
  }
})();

/* ---------- Firebase 초기화 ---------- */
const firebaseConfig = {
  apiKey: "AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo",
  authDomain: "live-quiz-a14d1.firebaseapp.com",
  projectId: "live-quiz-a14d1",
};
if (firebase.apps.length === 0) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

/* ---------- 유틸 ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const pad = (n) => String(n).padStart(2, "0");
const on = (el, ev, fn) => el && el.addEventListener(ev, fn);
const has = (id) => !!$(id);

/* ---------- 상태 ---------- */
let MODE = "admin";                     // 'admin' | 'student'
let roomId = "";
let me = { id: null, name: "" };
let unsubRoom = null, unsubResp = null;
let timerHandle = null;

const els = {
  // 상단
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnLogout: $("#btnLogout"), roomStatus: $("#roomStatus"),
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),

  // 패널
  pBuild: $("#panelBuild"), pOptions: $("#panelOptions"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),
  studentPanel: $("#studentPanel"),

  // 문항 탭
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"), btnBuildForm: $("#btnBuildForm"),
  btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"), builder: $("#builder"),
  btnUpload: $("#btnUpload"), btnDownloadSample: $("#btnDownloadSample"),

  // 옵션 탭
  chkDeviceOnce: $("#chkDeviceOnce"), chkNameOnce: $("#chkNameOnce"),
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright: $("#chkBright"),
  timerSec: $("#timerSec"), btnOptSave: $("#btnOptSave"), btnResetAll: $("#btnResetAll"),
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

  // 프레젠테이션
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  progress: $("#progress"), leftSec: $("#leftSec"), pTitle: $("#pTitle"), pQ: $("#pQ"), pOpts: $("#pOpts"), pImg: $("#pImg"),

  // 결과
  btnExportCSV: $("#btnExportCSV"), btnLeaderboard: $("#btnLeaderboard"), resultsTable: $("#resultsTable"),

  // 학생
  sState: $("#sState"), studentName: $("#studentName"), btnJoin: $("#btnJoin"),
  sQArea: $("#sQArea"), sQText: $("#sQText"), sQImg: $("#sQImg"),
  mcqBox: $("#mcqBox"), shortBox: $("#shortBox"), shortInput: $("#shortInput"), btnShortSend: $("#btnShortSend"),
  myResult: $("#myResult"),
};

/* ---------- 로컬 저장 ---------- */
function saveLocal() { localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me })); }
function loadLocal() {
  try {
    const d = JSON.parse(localStorage.getItem("quiz.live") || "{}");
    roomId = d.roomId || ""; MODE = d.MODE || "admin"; me = d.me || { id: null, name: "" };
    if (roomId && els.roomId) els.roomId.value = roomId;
  } catch {}
}

/* ---------- Firestore ref ---------- */
const roomRef = (id) => db.collection("rooms").doc(id);
const respCol = (id) => roomRef(id).collection("responses");

/* ---------- 초기 룸 생성 ---------- */
async function ensureRoom(id) {
  const snap = await roomRef(id).get();
  if (!snap.exists) {
    await roomRef(id).set({
      title: "새 세션",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      mode: "idle",                // 'idle' | 'active' | 'ended'
      currentIndex: -1,
      accept: false,
      reveal: false,
      bright: false,
      policy: "device",           // 'device' | 'name'
      timerSec: 30,
      questions: [],
    });
  }
}

/* ---------- 룸/응답 리스너 ---------- */
function listenRoom(id) {
  if (unsubRoom) unsubRoom();
  unsubRoom = roomRef(id).onSnapshot((snap) => {
    if (!snap.exists) return;
    const r = snap.data(); window.__room = r;
    renderAll(r);
  });
}
function listenResponses(id) {
  if (unsubResp) unsubResp();
  unsubResp = respCol(id).onSnapshot((qs) => {
    const arr = []; qs.forEach((d) => arr.push({ id: d.id, ...d.data() }));
    window.__responses = arr;
    renderResponses(arr);
  });
}

/* ---------- 모드 & 탭 ---------- */
function setMode(m) {
  MODE = m;
  // 관리자 탭 표시/숨김
  [els.pBuild, els.pOptions, els.pPresent, els.pResults].forEach((p) => p && p.classList.add("hide"));
  if (m === "admin") {
    els.studentPanel && els.studentPanel.classList.add("hide");
    els.pBuild && els.pBuild.classList.remove("hide");
    // 탭 버튼은 항상 보이기(요청사항)
  } else {
    // 학생은 패널만 보이기
    els.studentPanel && els.studentPanel.classList.remove("hide");
    [els.tabBuild, els.tabOptions, els.tabPresent, els.tabResults].forEach((b) => b && (b.style.display = "none"));
  }
  // 상태 표시
  els.roomStatus && (els.roomStatus.textContent = roomId ? `세션: ${roomId} · 온라인` : `세션: - · 오프라인`);
  saveLocal();
}
function showPanel(which) {
  if (MODE !== "admin") return;
  [els.pBuild, els.pOptions, els.pPresent, els.pResults].forEach((p) => p && p.classList.add("hide"));
  which && which.classList.remove("hide");
}

/* ---------- 접속/로그아웃 ---------- */
async function connect() {
  const id = (els.roomId.value || "").trim();
  if (!id) return alert("세션 코드를 입력하세요.");
  roomId = id;
  els.roomId.disabled = true;
  els.btnConnect.classList.add("hide");
  els.btnLogout.classList.remove("hide");
  els.roomStatus.textContent = `세션: ${roomId} · 온라인`;

  await ensureRoom(roomId);
  listenRoom(roomId);
  listenResponses(roomId);
  buildStudentLink();
  saveLocal();
}
function logout() {
  roomId = "";
  els.roomId.value = "";
  els.roomId.disabled = false;
  els.btnConnect.classList.remove("hide");
  els.btnLogout.classList.add("hide");
  els.roomStatus.textContent = `세션: - · 오프라인`;
  if (unsubRoom) unsubRoom();
  if (unsubResp) unsubResp();
  saveLocal();
}

/* ---------- 문항 카드 ---------- */
function cardRow(no, q) {
  const wrap = document.createElement("div");
  wrap.className = "qcard";
  wrap.innerHTML = `
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${q?.type === "short" ? "" : "checked"} /><span>객관식</span></label>
      <label class="switch"><input type="radio" name="type-${no}" value="short" ${q?.type === "short" ? "checked" : ""} /><span>주관식</span></label>
      <label class="imgbtn"><input type="file" accept="image/*" class="imgUpload" data-no="${no}"><span>이미지</span></label>
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항 내용" value="${q?.text || ""}" />
    <div class="mcq ${q?.type === "short" ? "hide" : ""}">
      <div class="row wrap">
        ${(q?.options || ["", "", "", ""])
          .map((v, i) => `<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기 ${i + 1}" value="${v}">`)
          .join("")}
      </div>
      <div class="row">
        <span class="hint">정답 번호</span>
        <input class="ansIndex input xs" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex ?? 0) + 1}">
      </div>
    </div>
    <div class="short ${q?.type === "short" ? "" : "hide"}">
      <input class="ansText input" data-no="${no}" placeholder="정답(선택, 자동채점용)" value="${q?.answerText || ""}">
    </div>
  `;
  const radios = $$(`input[name="type-${no}"]`, wrap);
  const mcq = $(".mcq", wrap), short = $(".short", wrap);
  radios.forEach((r) => r.addEventListener("change", () => {
    const isShort = radios.find((x) => x.checked)?.value === "short";
    mcq.classList.toggle("hide", isShort);
    short.classList.toggle("hide", !isShort);
  }));
  // 이미지 프리뷰 저장용 (dataURL을 questions[].image로 저장)
  const imgInput = $(".imgUpload", wrap);
  imgInput?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { imgInput.dataset.dataurl = reader.result; };
    reader.readAsDataURL(f);
  });
  return wrap;
}
function collectBuilder() {
  const cards = $$(".qcard", els.builder);
  const list = cards.map((c, idx) => {
    const no = idx + 1;
    const type = c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text = c.querySelector(".qtext").value.trim();
    if (!text) return null;
    const imgInput = c.querySelector(".imgUpload");
    const image = imgInput?.dataset?.dataurl || null;
    if (type === "mcq") {
      const opts = $$(".opt", c).map((i) => i.value.trim()).filter(Boolean);
      const ans = Math.max(0, Math.min(opts.length - 1, (parseInt(c.querySelector(".ansIndex").value, 10) || 1) - 1));
      return { type: "mcq", text, options: opts, answerIndex: ans, image };
    }
    return { type: "short", text, answerText: c.querySelector(".ansText").value.trim(), image };
  }).filter(Boolean);
  return { title: els.quizTitle.value || "퀴즈", questions: list };
}

/* ---------- 옵션 저장/초기화 ---------- */
async function saveOptions() {
  if (!roomId) return alert("세션에 먼저 접속하세요.");
  await roomRef(roomId).set({
    accept: !!els.chkAccept.checked,
    reveal: !!els.chkReveal.checked,
    bright: !!els.chkBright.checked,
    timerSec: Math.max(5, Math.min(600, parseInt(els.timerSec.value || "30", 10))),
    policy: els.chkNameOnce?.checked ? "name" : "device",
  }, { merge: true });
  buildStudentLink(); // 저장 시 즉시 QR/링크 갱신
  alert("옵션 저장 완료");
}
async function resetAll() {
  if (!roomId) return;
  if (!confirm("문항/설정/결과를 모두 초기화합니다. 진행할까요?")) return;
  // 룸 리셋
  await roomRef(roomId).set({
    mode: "idle", currentIndex: -1, accept: false, reveal: false, bright: false,
    timerSec: 30, policy: "device", title: "새 세션", questions: [],
  }, { merge: true });
  // 응답 리셋
  const snap = await respCol(roomId).get();
  const batch = db.batch();
  snap.forEach((d) => batch.set(respCol(roomId).doc(d.id), { answers: {}, alive: true }, { merge: true }));
  await batch.commit();
  // UI 초기화
  els.builder.innerHTML = "";
  els.quizTitle.value = "";
  els.questionCount.value = 3;
  renderAll(window.__room || {});
  alert("초기화 완료");
}

/* ---------- 프레젠테이션: 진행/타이머 ---------- */
function renderPresent(r) {
  const total = r.questions?.length || 0;
  const idx = r.currentIndex ?? -1;
  els.progress.textContent = `${Math.max(0, idx + 1)}/${total}`;
  els.pTitle.textContent = r.title || roomId || "";
  els.pOpts.innerHTML = "";
  els.pImg.innerHTML = "";
  els.pQ.textContent = "시작 버튼을 누르면 문항이 제시됩니다.";

  if (idx >= 0 && r.questions[idx]) {
    const q = r.questions[idx];
    els.pQ.textContent = q.text;
    if (q.image) {
      const im = document.createElement("img"); im.src = q.image; im.style.maxWidth = "440px";
      els.pImg.appendChild(im);
    }
    if (q.type === "mcq") {
      q.options.forEach((t, i) => {
        const d = document.createElement("div"); d.className = "popt"; d.textContent = `${i + 1}. ${t}`;
        els.pOpts.appendChild(d);
      });
    }
  }
}
function startTimer(sec) {
  stopTimer();
  const end = Date.now() + sec * 1000;
  timerHandle = setInterval(async () => {
    const remain = Math.max(0, Math.floor((end - Date.now()) / 1000));
    els.leftSec.textContent = `${pad(Math.floor(remain / 60))}:${pad(remain % 60)}`;
    if (remain <= 0) {
      stopTimer();
      await roomRef(roomId).set({ accept: false }, { merge: true }); // 제출 마감
      // 자동 다음
      setTimeout(() => step(+1), 400);
    }
  }, 250);
}
function stopTimer() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
  els.leftSec.textContent = "00:00";
}
async function startQuiz() {
  const r = (await roomRef(roomId).get()).data();
  if (!r?.questions?.length) return alert("문항이 없습니다.");
  await roomRef(roomId).set({ mode: "active", currentIndex: 0, accept: true }, { merge: true });
  if (r.timerSec) startTimer(r.timerSec);
}
async function step(delta) {
  const snap = await roomRef(roomId).get(); const r = snap.data();
  const total = r.questions?.length || 0;
  let next = (r.currentIndex ?? -1) + delta;
  if (next >= total) { // 종료
    await roomRef(roomId).set({ mode: "ended", accept: false }, { merge: true });
    showPanel(els.pResults);
    return;
  }
  next = Math.max(0, next);
  await roomRef(roomId).set({ currentIndex: next, accept: true }, { merge: true });
  if (r.timerSec) startTimer(r.timerSec);
}
async function finishAll() {
  if (!confirm("퀴즈를 종료할까요?")) return;
  await roomRef(roomId).set({ mode: "ended", accept: false }, { merge: true });
  showPanel(els.pResults);
}

/* ---------- 결과 ---------- */
function renderResults(r, list) {
  if (!els.resultsTable) return;
  const tbl = document.createElement("table");
  const thead = document.createElement("thead"), tr = document.createElement("tr");
  ["이름", ...(r.questions || []).map((_, i) => `Q${i + 1}`), "점수"].forEach((h) => {
    const th = document.createElement("th"); th.textContent = h; tr.appendChild(th);
  });
  thead.appendChild(tr); tbl.appendChild(thead);
  const tb = document.createElement("tbody");

  (list || []).forEach((s) => {
    let score = 0; const row = document.createElement("tr");
    const n = document.createElement("td"); n.textContent = s.name || s.id; row.appendChild(n);
    (r.questions || []).forEach((q, i) => {
      const a = s.answers?.[i]; const td = document.createElement("td");
      if (!a) td.textContent = "-";
      else {
        td.textContent = q.type === "mcq" ? (typeof a.value === "number" ? a.value + 1 : "-") : (a.value ?? "-");
        if (a.correct) score++;
      }
      row.appendChild(td);
    });
    const sc = document.createElement("td"); sc.textContent = String(score); row.appendChild(sc);
    tb.appendChild(row);
  });
  tbl.appendChild(tb);
  els.resultsTable.innerHTML = ""; els.resultsTable.appendChild(tbl);
}

/* ---------- 렌더 ---------- */
function renderAll(r) {
  // 밝은 모드
  document.body.classList.toggle("bright", !!r.bright);

  // 프레젠테이션 반영
  renderPresent(r);

  // 학생 화면 반영
  if (MODE === "student") renderStudent(r);
}
function renderResponses(list) {
  if (MODE === "admin") {
    renderResults(window.__room || {}, list);
  }
}

/* ---------- 학생 흐름 ---------- */
function ensureMeId() {
  let id = localStorage.getItem("quiz.device");
  if (!id) { id = Math.random().toString(36).slice(2, 10); localStorage.setItem("quiz.device", id); }
  me.id = id;
}
async function join() {
  if (!roomId) return alert("세션에 먼저 접속하세요.");
  const name = (els.studentName.value || "").trim();
  if (!name) return alert("이름/번호를 입력하세요.");
  ensureMeId();
  me.name = name;
  await respCol(roomId).doc(me.id).set({ name, joinedAt: firebase.firestore.FieldValue.serverTimestamp(), answers: {}, alive: true }, { merge: true });
  els.sState.textContent = "참가 완료! 제출 버튼을 눌러주세요.";
  els.sQArea.classList.remove("hide");
  saveLocal();
}
async function submit(value) {
  const r = window.__room; if (!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx = r.currentIndex; const q = r.questions?.[idx]; if (!q) return;
  const ref = respCol(roomId).doc(me.id);
  const snap = await ref.get(); const prev = snap.exists ? (snap.data().answers || {}) : {};
  // 정책: 1회 제출
  if (prev[idx] != null) return alert("이미 제출했습니다.");

  let correct = null;
  if (q.type === "mcq" && typeof value === "number") correct = (value === (q.answerIndex ?? -999));
  if (q.type === "short" && typeof value === "string") {
    const norm = (s) => String(s).trim().toLowerCase(); if (q.answerText) correct = (norm(value) === norm(q.answerText));
  }
  await ref.set({ name: me.name, [`answers.${idx}`]: { value, correct: correct === true, revealed: !!r.reveal } }, { merge: true });
  alert("제출 완료!");
}
function renderStudent(r) {
  // 기본 상태
  if (!roomId) {
    els.sState.textContent = "세션 접속 필요";
    els.sQArea.classList.add("hide");
    return;
  }
  const idx = r.currentIndex ?? -1; const mode = r.mode;
  if (mode !== "active" || idx < 0) {
    els.sState.textContent = "참가 완료! 제출 버튼을 눌러주세요. 교사가 시작하면 1번 문항이 표시됩니다.";
    els.sQArea.classList.add("hide");
    return;
  }
  els.sState.textContent = "";
  els.sQArea.classList.remove("hide");
  const q = r.questions[idx];
  els.sQText.textContent = q.text;
  els.sQImg.innerHTML = ""; if (q.image) { const im = document.createElement("img"); im.src = q.image; im.style.maxWidth = "360px"; els.sQImg.appendChild(im); }

  if (q.type === "mcq") {
    els.mcqBox.innerHTML = "";
    q.options.forEach((t, i) => {
      const b = document.createElement("button"); b.className = "optbtn"; b.textContent = `${i + 1}. ${t}`; b.disabled = !r.accept;
      b.addEventListener("click", () => submit(i));
      els.mcqBox.appendChild(b);
    });
    els.shortBox.classList.add("hide");
  } else {
    els.mcqBox.innerHTML = "";
    els.shortBox.classList.remove("hide");
    els.btnShortSend.disabled = !r.accept;
  }

  if (mode === "ended") {
    els.sState.textContent = "퀴즈가 종료되었습니다!";
    els.sQArea.classList.add("hide");
    els.myResult.classList.remove("hide");
  } else els.myResult.classList.add("hide");
}

/* ---------- 학생 링크/QR ---------- */
function buildStudentLink() {
  if (!els.studentLink) return;
  const url = new URL(location.href);
  url.searchParams.set("role", "student");
  url.searchParams.set("room", roomId);
  els.studentLink.value = url.toString();
  if (window.QRCode && els.qrCanvas) {
    try { QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width: 160 }); } catch (e) { console.warn(e); }
  }
}

/* ---------- CSV ---------- */
async function exportCSV() {
  const r = (await roomRef(roomId).get()).data();
  const snap = await respCol(roomId).get();
  const rows = [];
  rows.push(["userId", "name", ...(r.questions || []).map((_, i) => `Q${i + 1}`), "score"].join(","));
  snap.forEach((d) => {
    const s = d.data(); let score = 0;
    const answers = (r.questions || []).map((q, i) => {
      const a = s.answers?.[i];
      if (a?.correct) score++;
      return q.type === "mcq" ? (typeof a?.value === "number" ? a.value + 1 : "") : (a?.value ?? "");
    });
    rows.push([d.id, `"${(s.name || "").replace(/"/g, '""')}"`, ...answers, score].join(","));
  });
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${r.title || roomId}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
}

/* ---------- 이벤트 바인딩 ---------- */
// 상단
on(els.btnConnect, "click", connect);
on(els.btnLogout, "click", logout);

// 탭
on(els.tabBuild, "click", () => showPanel(els.pBuild));
on(els.tabOptions, "click", () => showPanel(els.pOptions));
on(els.tabPresent, "click", () => showPanel(els.pPresent));
on(els.tabResults, "click", () => showPanel(els.pResults));

// 문항 탭
on(els.btnBuildForm, "click", () => {
  const n = Math.max(1, Math.min(20, parseInt(els.questionCount.value || "3", 10)));
  els.builder.innerHTML = ""; for (let i = 0; i < n; i++) els.builder.appendChild(cardRow(i + 1));
});
on(els.btnLoadSample, "click", () => {
  const S = [
    { type: "mcq", text: "가장 큰 행성은?", options: ["지구", "목성", "화성", "금성"], answerIndex: 1 },
    { type: "short", text: "물의 끓는점(°C)?", answerText: "100" },
    { type: "mcq", text: "태양계 별명?", options: ["Milky", "Solar", "Sunset", "Lunar"], answerIndex: 1 },
  ];
  els.builder.innerHTML = ""; S.forEach((q, i) => els.builder.appendChild(cardRow(i + 1, q)));
  els.quizTitle.value = "샘플 퀴즈";
  els.questionCount.value = S.length;
});
on(els.btnSaveQuiz, "click", async () => {
  if (!roomId) return alert("세션에 먼저 접속하세요.");
  const payload = collectBuilder(); if (!payload.questions.length) return alert("문항을 추가하세요.");
  await roomRef(roomId).set({ title: payload.title, questions: payload.questions }, { merge: true });
  alert("저장 완료!");
});

// 옵션
on(els.btnOptSave, "click", saveOptions);
on(els.btnResetAll, "click", resetAll);
on(els.btnCopyLink, "click", async () => {
  await navigator.clipboard.writeText(els.studentLink.value || "");
  els.btnCopyLink.textContent = "복사됨"; setTimeout(() => els.btnCopyLink.textContent = "복사", 1200);
});
on(els.btnOpenStudent, "click", () => window.open(els.studentLink.value || "#", "_blank"));

// 프레젠테이션
on(els.btnStart, "click", () => startQuiz());
on(els.btnPrev, "click", () => step(-1));
on(els.btnNext, "click", () => step(+1));
on(els.btnEndAll, "click", () => finishAll());

// 결과
on(els.btnExportCSV, "click", () => exportCSV());

// 학생
on(els.btnJoin, "click", join);
on(els.btnShortSend, "click", () => submit((els.shortInput.value || "").trim()));

/* ---------- 부팅 ---------- */
function autoReconnect() {
  loadLocal();
  const url = new URL(location.href);
  const role = url.searchParams.get("role"); const rid = url.searchParams.get("room");

  if (role === "student") MODE = "student"; else MODE = "admin";
  setMode(MODE);

  if (MODE === "student") {
    // 학생: 관리자 UI 숨김은 setMode에서 처리됨
    if (rid) { roomId = rid; connect(); }
    els.sState.textContent = "세션 접속 필요";
  } else {
    // 관리자: 문항 탭이 기본
    showPanel(els.pBuild);
    if (roomId) connect();
  }
}
autoReconnect();
