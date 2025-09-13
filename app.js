// app.js — 브라우저용(ESM 아님). window.db / window.FS / QRCode 전제.
// DOMContentLoaded 이후 안전 초기화 + 모든 id 존재여부 가드

(function () {
  // ---- 단축 ----
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  // ---- 엘리먼트 수집 (없으면 null 그대로 둠) ----
  const els = {
    liveDot: $("#liveDot"),
    roomId: $("#roomId"),
    btnConnect: $("#btnConnect"),
    btnSignOut: $("#btnSignOut"),
    roomStatus: $("#roomStatus"),
    tabBuild: $("#tabBuild"),
    tabOptions: $("#tabOptions"),
    tabPresent: $("#tabPresent"),
    tabResults: $("#tabResults"),

    pBuild: $("#panelBuild"),
    pOptions: $("#panelOptions"),
    pPresent: $("#panelPresent"),
    pResults: $("#panelResults"),
    studentAccess: $("#studentAccess"),

    // 빌더
    quizTitle: $("#quizTitle"),
    questionCount: $("#questionCount"),
    btnBuildForm: $("#btnBuildForm"),
    btnLoadSample: $("#btnLoadSample"),
    btnSaveQuiz: $("#btnSaveQuiz"),
    btnUploadTxt: $("#btnUploadTxt"),
    fileUploadTxt: $("#fileUploadTxt"),
    btnDownloadTemplate: $("#btnDownloadTemplate"),
    builder: $("#builder"),

    // 옵션/QR
    polDevice: $("#polDevice"),
    polName: $("#polName"),
    chkAccept: $("#chkAccept"),
    chkReveal: $("#chkReveal"),
    chkBright: $("#chkBright"),
    timerSec: $("#timerSec"),
    btnOptSave: $("#btnOptSave"),
    btnResetAll: $("#btnResetAll"),
    qrCanvas: $("#qrCanvas"),
    studentLink: $("#studentLink"),
    btnCopyLink: $("#btnCopyLink"),
    btnOpenStudent: $("#btnOpenStudent"),

    // 프레젠테이션
    btnStart: $("#btnStart"),
    btnPrev: $("#btnPrev"),
    btnNext: $("#btnNext"),
    btnEndAll: $("#btnEndAll"),
    leftSec: $("#leftSec"),
    nowQuestion: $("#nowQuestion"),
    pTitle: $("#pTitle"),
    pQ: $("#pQ"),
    pImg: $("#pImg"),
    pOpts: $("#pOpts"),
    chipJoin: $("#chipJoin"),
    chipSubmit: $("#chipSubmit"),
    chipCorrect: $("#chipCorrect"),
    chipWrong: $("#chipWrong"),

    // 결과
    resultsTable: $("#resultsTable"),
    btnExportCSV: $("#btnExportCSV"),
    btnFullBoard: $("#btnFullBoard"),

    // 학생
    joinModal: $("#joinModal"),
    sState: $("#sState"),
    joinName: $("#joinName"),
    btnJoinGo: $("#btnJoinGo"),
    sWrap: $("#sWrap"),
    sQTitle: $("#sQTitle"),
    sQImg: $("#sQImg"),
    sOptBox: $("#sOptBox"),
    sShortWrap: $("#sShortWrap"),
    sShortInput: $("#sShortInput"),
    btnShortSend: $("#btnShortSend"),
    sDone: $("#sDone"),
    btnShowMy: $("#btnShowMy"),
    myResult: $("#myResult"),
  };

  // ---- 상태 ----
  let MODE = "admin";         // 'admin' | 'student'
  let roomId = "";
  let me = { id: null, name: "" };
  let unsubRoom = null, unsubResp = null, timerHandle = null;

  // ---- Firestore 헬퍼 (compat 전역) ----
  function FS() {
    if (!window.db || !window.FS) throw new Error("[firebase] not loaded. Ensure compat scripts are included in index.html");
    return window.FS;
  }
  const pad = (n) => String(n).padStart(2, "0");
  const roomRef = (id) => FS().doc(`rooms/${id}`);
  const respCol = (id) => FS().collection(`rooms/${id}/responses`);

  // ---- 로컬 스토리지 ----
  function saveLocal() { localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me })); }
  function loadLocal() {
    try {
      const d = JSON.parse(localStorage.getItem("quiz.live") || "{}");
      roomId = d.roomId || ""; MODE = d.MODE || "admin"; me = d.me || { id: null, name: "" };
      if (roomId && els.roomId) els.roomId.value = roomId;
    } catch { }
  }

  // ---- UI 토글 ----
  function showTab(name) {
    const map = { build: els.pBuild, options: els.pOptions, present: els.pPresent, results: els.pResults };
    Object.values(map).forEach(p => p && p.classList.add("hide"));
    map[name] && map[name].classList.remove("hide");
    [els.tabBuild, els.tabOptions, els.tabPresent, els.tabResults].forEach(t => t && t.classList.remove("active"));
    ({ build: els.tabBuild, options: els.tabOptions, present: els.tabPresent, results: els.tabResults }[name])?.classList.add("active");
  }
  function setMode(m) {
    MODE = m;
    $$(".admin-only").forEach(n => n.classList.toggle("hide", m !== "admin"));
    if (els.studentAccess) els.studentAccess.classList.toggle("hide", m !== "student");
    if (m === "admin") showTab("build");
  }
  function heartbeatOnline(on) { if (els.liveDot) els.liveDot.style.background = on ? "#f43" : "#555"; }

  // ---- Firestore 리스너 ----
  function listenRoom(id) {
    if (unsubRoom) unsubRoom();
    unsubRoom = FS().onSnapshot(roomRef(id), snap => {
      if (!snap.exists) return;
      const r = snap.data();
      window.__room = r;
      renderRoom(r);
    });
  }
  function listenResponses(id) {
    if (unsubResp) unsubResp();
    unsubResp = FS().onSnapshot(respCol(id), qs => {
      const arr = []; qs.forEach(d => arr.push({ id: d.id, ...d.data() }));
      window.__resp = arr;
      renderResponses(arr);
    });
  }

  // ---- 접속/세션 ----
  async function ensureRoom(id) {
    const s = await FS().getDoc(roomRef(id));
    if (!s.exists) {
      await FS().setDoc(roomRef(id), {
        title: "새 세션",
        mode: "idle",
        currentIndex: -1,
        accept: false,
        reveal: false,
        policy: "device",
        timer: 30,
        bright: false,
        createdAt: FS().serverTimestamp(),
        questions: []
      });
    }
  }
  async function connect() {
    const id = (els.roomId?.value || "").trim();
    if (!id) return alert("세션 코드를 입력하세요.");
    roomId = id;
    await ensureRoom(roomId);
    listenRoom(roomId);
    listenResponses(roomId);
    if (els.roomStatus) els.roomStatus.textContent = `세션: ${roomId} · 온라인`;
    if (els.btnConnect) els.btnConnect.disabled = true;
    if (els.roomId) els.roomId.disabled = true;
    els.btnSignOut?.classList.remove("hide");
    heartbeatOnline(true);
    buildStudentLink();
    saveLocal();
  }
  function signOut() {
    unsubRoom && unsubRoom(); unsubResp && unsubResp();
    roomId = ""; if (els.roomId) els.roomId.value = ""; if (els.roomId) els.roomId.disabled = false;
    if (els.btnConnect) els.btnConnect.disabled = false;
    els.btnSignOut?.classList.add("hide");
    if (els.roomStatus) els.roomStatus.textContent = "세션: - · 오프라인";
    heartbeatOnline(false);
    showTab("build");
    saveLocal();
  }
  function autoReconnect() {
    loadLocal();
    setMode(MODE || "admin");
    const url = new URL(location.href);
    const role = url.searchParams.get("role");
    const rm = url.searchParams.get("room");
    if (role === "student" && rm) {
      MODE = "student"; roomId = rm; setMode("student"); connect();
    } else if (roomId) { connect(); }
  }

  // ---- 빌더 ----
  function qCard(no, q) {
    const wrap = document.createElement("div");
    wrap.className = "qcard";
    wrap.innerHTML = `
      <div class="row wrap">
        <span class="badge">${no}번</span>
        <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${q?.type === 'short' ? '' : 'checked'}> 객관식</label>
        <label class="switch"><input type="radio" name="type-${no}" value="short" ${q?.type === 'short' ? 'checked' : ''}> 주관식</label>
      </div>
      <div class="row wrap mt">
        <input class="input grow qtext" placeholder="문항 내용" value="${q?.text || ''}">
        <input class="input sm qimg" type="file" accept="image/*">
      </div>
      <div class="mcq ${q?.type === 'short' ? 'hide' : ''} mt">
        <div class="row wrap">
          ${(q?.options || ['', '', '', '']).map((v, i) => `<input class="input grow opt" data-idx="${i}" placeholder="보기 ${i + 1}" value="${v}">`).join('')}
        </div>
        <div class="row mt">
          <span class="muted">정답 번호</span>
          <input class="input sm ansIndex" type="number" min="1" max="10" value="${(q?.answerIndex ?? 0) + 1}">
        </div>
      </div>
      <div class="short ${q?.type === 'short' ? '' : 'hide'} mt">
        <input class="input grow ansText" placeholder="정답(선택)" value="${q?.answerText || ''}">
      </div>
    `;
    const radios = $$(`input[name="type-${no}"]`, wrap);
    const mcq = $(".mcq", wrap), short = $(".short", wrap);
    radios.forEach(r => r.addEventListener("change", () => {
      const isShort = radios.find(x => x.checked).value === 'short';
      mcq.classList.toggle("hide", isShort);
      short.classList.toggle("hide", !isShort);
    }));
    return wrap;
  }
  function gatherBuilder() {
    const cards = $$("#builder>.qcard");
    const list = cards.map(c => {
      const type = c.querySelector("input[type=radio]:checked").value;
      const text = c.querySelector(".qtext").value.trim();
      const imgF = c.querySelector(".qimg").files?.[0] || null;
      if (!text) return null;
      const payload = { type, text };
      if (imgF) payload.image = URL.createObjectURL(imgF); // 데모 미리보기
      if (type === 'mcq') {
        const opts = $$(".opt", c).map(i => i.value.trim());
        const ans = Math.max(0, Math.min(opts.length - 1, (parseInt(c.querySelector(".ansIndex").value, 10) || 1) - 1));
        payload.options = opts; payload.answerIndex = ans;
      } else {
        payload.answerText = c.querySelector(".ansText").value.trim();
      }
      return payload;
    }).filter(Boolean);
    return { title: els.quizTitle?.value || "퀴즈", questions: list };
  }

  // ---- 옵션/QR ----
  function buildStudentLink() {
    if (!roomId || !els.studentLink) return;
    const url = new URL(location.href);
    url.searchParams.set("role", "student");
    url.searchParams.set("room", roomId);
    els.studentLink.value = url.toString();
    if (window.QRCode && els.qrCanvas) {
      try { window.QRCode.toCanvas(els.qrCanvas, url.toString(), { width: 140 }); } catch (e) { console.warn(e); }
    }
  }

  // ---- 진행 제어/타이머 ----
  async function startQuiz() {
    await FS().updateDoc(roomRef(roomId), { mode: "active", currentIndex: 0, accept: true });
  }
  async function step(delta) {
    await FS().runTransaction(window.db, async (tx) => {
      const snap = await tx.get(roomRef(roomId)); const r = snap.data(); const total = r.questions?.length || 0;
      let next = (r.currentIndex ?? -1) + delta;
      if (next >= total) { tx.update(roomRef(roomId), { mode: "ended", accept: false }); return; }
      next = Math.max(0, next);
      tx.update(roomRef(roomId), { currentIndex: next, accept: true });
    });
  }
  async function finishAll() { await FS().updateDoc(roomRef(roomId), { mode: "ended", accept: false }); }

  function startTimer(sec) {
    stopTimer();
    const end = Date.now() + sec * 1000;
    timerHandle = setInterval(() => {
      const remain = Math.max(0, Math.floor((end - Date.now()) / 1000));
      els.leftSec && (els.leftSec.textContent = `${pad(Math.floor(remain / 60))}:${pad(remain % 60)}`);
      if (remain <= 0) { stopTimer(); FS().updateDoc(roomRef(roomId), { accept: false }); setTimeout(() => step(+1), 400); }
    }, 250);
  }
  function stopTimer() { if (timerHandle) { clearInterval(timerHandle); timerHandle = null; } els.leftSec && (els.leftSec.textContent = "00:00"); }

  // ---- 학생 참가/제출 ----
  async function join() {
    if (!roomId) return alert("세션에 먼저 접속하세요.");
    const name = (els.joinName?.value || "").trim(); if (!name) return alert("이름을 입력하세요.");
    me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2, 10), name };
    localStorage.setItem("quiz.device", me.id);
    await FS().setDoc(respCol(roomId).doc(me.id), { name, joinedAt: FS().serverTimestamp(), answers: {}, alive: true }, { merge: true });
    els.joinModal?.classList.add("hide");
    els.sWrap?.classList.remove("hide");
    els.sState && (els.sState.textContent = "참가 완료! 제출 버튼을 눌러주세요.");
    saveLocal();
  }
  async function submit(value) {
    const r = window.__room; if (!r?.accept) return alert("지금은 제출할 수 없습니다.");
    const idx = r.currentIndex; const q = r.questions?.[idx]; if (!q) return;
    const ref = respCol(roomId).doc(me.id);
    const snap = await FS().getDoc(ref); const prev = snap.exists ? (snap.data().answers || {}) : {};
    if (prev[idx] != null) return alert("이미 제출했습니다.");
    let correct = null;
    if (q.type === 'mcq' && typeof value === 'number') correct = (value === (q.answerIndex ?? -999));
    if (q.type === 'short' && typeof value === 'string') {
      const norm = s => String(s).trim().toLowerCase();
      if (q.answerText) correct = (norm(value) === norm(q.answerText));
    }
    await FS().setDoc(ref, { name: me.name, [`answers.${idx}`]: { value, correct: (correct === true) } }, { merge: true });
  }

  // ---- 렌더링 ----
  function renderRoom(r) {
    // 옵션 표시
    els.chkAccept && (els.chkAccept.checked = !!r.accept);
    els.chkReveal && (els.chkReveal.checked = !!r.reveal);
    els.chkBright && (els.chkBright.checked = !!r.bright);
    els.timerSec && (els.timerSec.value = r.timer || 30);
    els.quizTitle && (els.quizTitle.value = r.title || "퀴즈");

    // 카운터
    const idx = r.currentIndex; const total = r.questions?.length || 0;
    els.nowQuestion && (els.nowQuestion.textContent = (idx >= 0 ? `Q${idx + 1}/${total}` : "Q0/0"));

    // 프레젠테이션
    els.pTitle && (els.pTitle.textContent = r.title || roomId);
    if (els.pImg) { els.pImg.classList.add("hide"); els.pImg.src = ""; }
    if (!els.pQ || !els.pOpts) return;

    if (idx == null || idx < 0 || r.mode !== "active") {
      els.pQ.textContent = "시작 버튼을 누르면 문항이 제시됩니다.";
      els.pOpts.innerHTML = "";
    } else {
      const q = r.questions[idx];
      els.pQ.textContent = q.text;
      if (q.image && els.pImg) { els.pImg.src = q.image; els.pImg.classList.remove("hide"); }
      els.pOpts.innerHTML = "";
      if (q.type === 'mcq') {
        q.options.forEach((t, i) => {
          const d = document.createElement("div");
          d.className = "popt";
          d.textContent = `${i + 1}. ${t}`;
          els.pOpts.appendChild(d);
        });
      } else {
        const d = document.createElement("div");
        d.className = "popt";
        d.textContent = "주관식 문제입니다.";
        els.pOpts.appendChild(d);
      }
    }

    // 학생 화면
    if (MODE === "student") {
      if (r.mode === 'ended') {
        els.sWrap?.classList.add("hide");
        els.sDone?.classList.remove("hide");
        return;
      }
      if (r.mode !== 'active' || idx < 0) {
        els.sWrap?.classList.add("hide");
        els.joinModal?.classList.remove("hide");
        els.sState && (els.sState.textContent = "참가 완료! 교사가 시작하면 1번 문항이 표시됩니다.");
        return;
      }
      const q = r.questions[idx];
      els.joinModal?.classList.add("hide");
      els.sWrap?.classList.remove("hide");
      els.sQTitle && (els.sQTitle.textContent = q.text);
      if (els.sQImg) { els.sQImg.classList.add("hide"); els.sQImg.src = ""; if (q.image) { els.sQImg.src = q.image; els.sQImg.classList.remove("hide"); } }
      if (els.sOptBox) els.sOptBox.innerHTML = "";

      if (q.type === 'mcq') {
        q.options.forEach((opt, i) => {
          const b = document.createElement("button");
          b.className = "btn popt"; b.textContent = `${i + 1}. ${opt}`; b.disabled = !r.accept;
          b.onclick = () => submit(i);
          els.sOptBox.appendChild(b);
        });
        els.sShortWrap?.classList.add("hide");
      } else {
        els.sShortWrap?.classList.remove("hide");
        if (els.btnShortSend) {
          els.btnShortSend.disabled = !r.accept;
          els.btnShortSend.onclick = () => submit(els.sShortInput?.value || "");
        }
      }
    }
  }

  function renderResponses(list) {
    const r = window.__room || {}; const idx = r.currentIndex;
    let joined = list.length, submitted = 0, correct = 0, wrong = 0;
    list.forEach(s => {
      const a = s.answers?.[idx];
      if (a) { submitted++; if (a.correct === true) correct++; if (a.correct === false) wrong++; }
    });
    els.chipJoin && (els.chipJoin.textContent = joined);
    els.chipSubmit && (els.chipSubmit.textContent = submitted);
    els.chipCorrect && (els.chipCorrect.textContent = correct);
    els.chipWrong && (els.chipWrong.textContent = wrong);

    if (!els.resultsTable) return;
    const tbl = document.createElement("table");
    const thead = document.createElement("thead"), tr = document.createElement("tr");
    const qs = (r.questions || []);
    ["이름", ...qs.map((_, i) => `Q${i + 1}`), "점수"].forEach(h => { const th = document.createElement("th"); th.textContent = h; tr.appendChild(th); });
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb = document.createElement("tbody");
    list.forEach(s => {
      let score = 0; const tr = document.createElement("tr");
      const tdn = document.createElement("td"); tdn.textContent = s.name || s.id; tr.appendChild(tdn);
      qs.forEach((q, i) => {
        const a = s.answers?.[i]; const td = document.createElement("td");
        td.textContent = a ? (q.type === 'mcq' ? (typeof a.value === 'number' ? a.value + 1 : '-') : (a.value ?? '-')) : '-';
        if (a?.correct) score++; tr.appendChild(td);
      });
      const tds = document.createElement("td"); tds.textContent = String(score); tr.appendChild(tds);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.resultsTable.innerHTML = ""; els.resultsTable.appendChild(tbl);
  }

  // ---- 이벤트 바인딩 ----
  function bindAdmin() {
    els.btnConnect && els.btnConnect.addEventListener("click", connect);
    els.btnSignOut && els.btnSignOut.addEventListener("click", signOut);
    els.tabBuild && els.tabBuild.addEventListener("click", () => showTab("build"));
    els.tabOptions && els.tabOptions.addEventListener("click", () => showTab("options"));
    els.tabPresent && els.tabPresent.addEventListener("click", () => showTab("present"));
    els.tabResults && els.tabResults.addEventListener("click", () => showTab("results"));

    // 빌더
    els.btnBuildForm && els.btnBuildForm.addEventListener("click", () => {
      const n = Math.max(1, Math.min(50, parseInt(els.questionCount?.value, 10) || 3));
      if (!els.builder) return; els.builder.innerHTML = ""; for (let i = 0; i < n; i++) els.builder.appendChild(qCard(i + 1));
    });
    els.btnLoadSample && els.btnLoadSample.addEventListener("click", () => {
      const S = [
        { type: 'mcq', text: '가장 큰 행성은?', options: ['지구', '목성', '화성', '금성'], answerIndex: 1 },
        { type: 'short', text: '물의 끓는점(°C)?', answerText: '100' },
        { type: 'mcq', text: '태양계 별명?', options: ['Milky', 'Solar', 'Sunset', 'Lunar'], answerIndex: 1 },
      ];
      if (!els.builder) return; els.builder.innerHTML = ""; S.forEach((q, i) => els.builder.appendChild(qCard(i + 1, q)));
      if (els.quizTitle) els.quizTitle.value = "샘플 퀴즈"; if (els.questionCount) els.questionCount.value = S.length;
    });
    els.btnSaveQuiz && els.btnSaveQuiz.addEventListener("click", async () => {
      if (!roomId) return alert("세션 접속 후 저장하세요.");
      const payload = gatherBuilder();
      await FS().setDoc(roomRef(roomId), { title: payload.title, questions: payload.questions }, { merge: true });
      alert("저장 완료!");
    });
    els.btnUploadTxt && els.btnUploadTxt.addEventListener("click", () => els.fileUploadTxt?.click());
    els.fileUploadTxt && els.fileUploadTxt.addEventListener("change", async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      const txt = await f.text();
      const lines = txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const qs = lines.map(line => {
        const parts = line.split(",").map(s => s.trim());
        if (parts[1] === "주관식") { return { type: "short", text: parts[0], answerText: parts[2] || "" }; }
        const [text, o1, o2, o3, o4, ans] = parts;
        return { type: "mcq", text, options: [o1, o2, o3, o4], answerIndex: Math.max(0, (parseInt(ans, 10) || 1) - 1) };
      });
      if (!els.builder) return; els.builder.innerHTML = ""; qs.forEach((q, i) => els.builder.appendChild(qCard(i + 1, q)));
      if (!els.quizTitle?.value) els.quizTitle.value = "업로드 퀴즈";
    });
    els.btnDownloadTemplate && els.btnDownloadTemplate.addEventListener("click", () => {
      const sample = "가장 큰 행성?,지구,목성,화성,금성,2\n기체의 표준 상태에서 1몰의 부피는?,주관식,22.4L";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([sample], { type: "text/plain" }));
      a.download = "quiz-template.txt"; a.click(); URL.revokeObjectURL(a.href);
    });

    // 옵션
    els.btnOptSave && els.btnOptSave.addEventListener("click", async () => {
      if (!roomId) return alert("세션 접속 후 저장하세요.");
      await FS().setDoc(roomRef(roomId), {
        accept: !!els.chkAccept?.checked,
        reveal: !!els.chkReveal?.checked,
        bright: !!els.chkBright?.checked,
        policy: els.polName?.checked ? "name" : "device",
        timer: parseInt(els.timerSec?.value, 10) || 30
      }, { merge: true });
      buildStudentLink();
      alert("저장했습니다.");
    });
    els.btnResetAll && els.btnResetAll.addEventListener("click", async () => {
      if (!roomId || !confirm("문항/옵션/결과를 모두 초기화할까요?")) return;
      await FS().setDoc(roomRef(roomId), {
        title: "새 세션", questions: [], mode: "idle", currentIndex: -1, accept: false, reveal: false, timer: 30
      }, { merge: false });
      // 응답 컬렉션 초기화는 Firestore 보안상 일괄 삭제 API가 없어 콘솔에서 필요 시 정리
      alert("초기화했습니다.");
    });
    els.btnCopyLink && els.btnCopyLink.addEventListener("click", async () => {
      if (!els.studentLink?.value) return;
      try { await navigator.clipboard.writeText(els.studentLink.value); alert("복사됨"); } catch { }
    });
    els.btnOpenStudent && els.btnOpenStudent.addEventListener("click", () => {
      if (!els.studentLink?.value) return; window.open(els.studentLink.value, "_blank");
    });

    // 프레젠테이션
    els.btnStart && els.btnStart.addEventListener("click", () => startQuiz());
    els.btnPrev && els.btnPrev.addEventListener("click", () => step(-1));
    els.btnNext && els.btnNext.addEventListener("click", () => step(+1));
    els.btnEndAll && els.btnEndAll.addEventListener("click", () => finishAll());
  }

  function bindStudent() {
    els.btnJoinGo && els.btnJoinGo.addEventListener("click", join);
    els.btnShortSend && els.btnShortSend.addEventListener("click", () => submit(els.sShortInput?.value || ""));
    els.btnShowMy && els.btnShowMy.addEventListener("click", () => {
      const meId = me.id || localStorage.getItem("quiz.device");
      const my = (window.__resp || []).find(r => r.id === meId);
      if (!my) { els.myResult && (els.myResult.textContent = "제출 내역이 없습니다."); return; }
      const r = window.__room || {};
      const qs = r.questions || [];
      let score = 0;
      const rows = qs.map((q, i) => {
        const a = my.answers?.[i]; if (a?.correct) score++;
        const val = a ? (q.type === 'mcq' ? (typeof a.value === 'number' ? a.value + 1 : '-') : (a.value ?? '-')) : '-';
        return `<div class="row"><span class="badge">Q${i + 1}</span> <span>${val}</span>${a?.correct ? ' ✅' : ''}</div>`;
      }).join("");
      els.myResult && (els.myResult.innerHTML = `<div class="mt">점수: ${score}/${qs.length}</div>${rows}`);
    });
  }

  // ---- 초기 구동 ----
  function init() {
    // URL 모드 판단
    const url = new URL(location.href);
    const role = url.searchParams.get("role");
    const rm = url.searchParams.get("room");
    if (role === "student") setMode("student"); else setMode("admin");

    bindAdmin(); bindStudent(); autoReconnect();

    // 안전하게 “기본 메시지”만 초기 표기 (존재하는 경우에만)
    els.pQ && (els.pQ.textContent = "시작 버튼을 누르면 문항이 제시됩니다.");
    els.pOpts && (els.pOpts.innerHTML = "");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
