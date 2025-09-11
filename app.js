/* =========================
   Live Quiz – app.js (FINAL)
   * index.html / app.css 변경 없이 동작만 안정화
   * 학생 흐름: 이름 입력 → 참가(대기) → 교사 시작 시 Q1 노출
   * 교사 프레젠테이션: 시작 전 안내문구, 시작 즉시 Q1
   ========================= */

(function () {
  // --- 안전 가드 (Firebase & Firestore compat 전역 준비 확인)
  if (!window.firebase || !window.firebase.firestore) {
    console.error("[firebase] not loaded. Ensure compat scripts are included in index.html");
    return;
  }
  if (!window.db) {
    // index.html 어딘가에서 window.db = firebase.firestore(); 를 세팅했다고 가정
    try { window.db = firebase.firestore(); } catch (e) {}
  }
  if (!window.db) {
    console.error("[firebase] firestore not ready");
    return;
  }

  // --- Firestore alias (compat)
  const FS = {
    doc: (c, ...rest) => c.doc ? c.doc(...rest) : window.db.doc([c, ...rest].join("/")),
    collection: (db, ...rest) => db.collection(...rest),
    getDoc: async (ref) => ref.get(),
    setDoc: async (ref, data, opts) => opts?.merge ? ref.set(data, { merge: true }) : ref.set(data),
    updateDoc: async (ref, data) => ref.update(data),
    getDocs: async (q) => q.get(),
    onSnapshot: (ref, cb) => ref.onSnapshot(cb),
    runTransaction: (db, fn) => db.runTransaction(fn),
    serverTimestamp: () => firebase.firestore.FieldValue.serverTimestamp(),
  };
  window.FS = window.FS || FS; // 다른 코드에서 재사용할 수 있게

  // --- DOM 헬퍼
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  // --- 필요한 엘리먼트 캐시 (id는 기존 index.html의 것을 그대로 사용)
  const els = {
    // 상단
    liveDot: $("#liveDot"),
    roomId: $("#roomId"),
    btnConnect: $("#btnConnect"),
    btnSignOut: $("#btnSignOut"),
    roomStatus: $("#roomStatus"),

    // 탭
    tabBuild: $("#tabBuild"),
    tabOptions: $("#tabOptions"),
    tabPresent: $("#tabPresent"),
    tabResults: $("#tabResults"),

    // 패널
    pBuild: $("#panelBuild"),
    pOptions: $("#panelOptions"),
    pPresent: $("#panelPresent"),
    pResults: $("#panelResults"),

    // 학생 접속 박스(관리자 옵션 패널 오른쪽)
    studentAccess: $("#studentAccess"),
    qrCanvas: $("#qrCanvas"),
    studentLink: $("#studentLink"),
    btnCopyLink: $("#btnCopyLink"),
    btnOpenStudent: $("#btnOpenStudent"),

    // 빌더/저장
    quizTitle: $("#quizTitle"),
    questionCount: $("#questionCount"),
    btnBuildForm: $("#btnBuildForm"),
    btnLoadSample: $("#btnLoadSample"),
    btnSaveQuiz: $("#btnSaveQuiz"),
    builder: $("#builder"),
    btnUploadTxt: $("#btnUploadTxt"),
    fileUploadTxt: $("#fileUploadTxt"),
    btnDownloadTemplate: $("#btnDownloadTemplate"),

    // 옵션
    polDevice: $("#polDevice"),
    polName: $("#polName"),
    chkAccept: $("#chkAccept"),
    chkReveal: $("#chkReveal"),
    chkBright: $("#chkBright"),
    timerSec: $("#timerSec"),
    btnOptSave: $("#btnOptSave"),
    btnResetAll: $("#btnResetAll"),

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

    // 학생 뷰(팝업/문항영역/종료)
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

  // --- 상태
  let MODE = "admin";
  let roomId = "";
  let me = { id: null, name: "" };

  let unsubRoom = null;
  let unsubResp = null;

  // --- 유틸
  const pad = n => String(n).padStart(2, "0");

  function heartbeatOnline(on) {
    if (els.liveDot) els.liveDot.style.background = on ? "#ff3b30" : "#666";
  }

  // 로컬 상태
  function saveLocal() {
    localStorage.setItem("quiz.live", JSON.stringify({ MODE, roomId, me }));
  }
  function loadLocal() {
    try {
      const d = JSON.parse(localStorage.getItem("quiz.live") || "{}");
      MODE = d.MODE || "admin";
      roomId = d.roomId || "";
      me = d.me || { id: null, name: "" };
      if (roomId && els.roomId) els.roomId.value = roomId;
    } catch {}
  }

  // 모드/탭
  function setMode(m) {
    MODE = m;
    // 학생 모드: 관리자 UI 통째로 숨김
    $$(".admin-only").forEach(el => el.classList.toggle("hide", m !== "admin"));
    // 학생 접속(옵션 내부) 박스는 관리자에서만 보이게
    if (els.studentAccess) els.studentAccess.classList.toggle("hide", m !== "admin");
    if (m === "admin") showTab("build");
    saveLocal();
  }

  function showTab(name) {
    const map = { build: els.pBuild, options: els.pOptions, present: els.pPresent, results: els.pResults };
    Object.values(map).forEach(p => p && p.classList.add("hide"));
    const tgt = map[name];
    if (tgt) tgt.classList.remove("hide");

    [els.tabBuild, els.tabOptions, els.tabPresent, els.tabResults].forEach(t => t && t.classList.remove("active"));
    ({ build: els.tabBuild, options: els.tabOptions, present: els.tabPresent, results: els.tabResults }[name])?.classList.add("active");
  }

  // Firestore ref
  const roomRef = id => FS.doc(window.db, "rooms", id);
  const respCol = id => FS.collection(window.db, "rooms/" + id + "/responses");

  // 세션 보장
  async function ensureRoom(id) {
    const snap = await FS.getDoc(roomRef(id));
    if (!snap.exists) {
      await FS.setDoc(roomRef(id), {
        title: "새 세션",
        mode: "idle",          // idle | active | ended
        currentIndex: -1,      // -1이면 아직 시작 전
        accept: false,
        reveal: false,
        policy: "device",
        timer: 30,
        bright: false,
        questions: [],         // [{type:'mcq'|'short', text, options?, answerIndex?, answerText?, image?}]
        createdAt: FS.serverTimestamp(),
      });
    }
  }

  // 접속/해제
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
    if (els.btnSignOut) els.btnSignOut.classList.remove("hide");
    heartbeatOnline(true);
    buildStudentLink();
    saveLocal();
  }
  function signOut() {
    try { unsubRoom && unsubRoom(); unsubRoom = null; } catch {}
    try { unsubResp && unsubResp(); unsubResp = null; } catch {}
    roomId = "";
    if (els.roomId) { els.roomId.value = ""; els.roomId.disabled = false; }
    if (els.btnConnect) els.btnConnect.disabled = false;
    if (els.btnSignOut) els.btnSignOut.classList.add("hide");
    if (els.roomStatus) els.roomStatus.textContent = "세션: - · 오프라인";
    heartbeatOnline(false);
    showTab("build");
    saveLocal();
  }

  // 실시간
  function listenRoom(id) {
    try { unsubRoom && unsubRoom(); } catch {}
    unsubRoom = FS.onSnapshot(roomRef(id), snap => {
      if (!snap.exists()) return;
      const data = snap.data();
      window.__room = data;
      renderRoom(data);
    });
  }
  function listenResponses(id) {
    try { unsubResp && unsubResp(); } catch {}
    const col = respCol(id);
    unsubResp = FS.onSnapshot(col, qs => {
      const list = [];
      qs.forEach(d => list.push({ id: d.id, ...d.data() }));
      window.__resp = list;
      renderResponses(list);
    });
  }

  // 링크/QR
  function buildStudentLink() {
    if (!roomId || !els.studentLink) return;
    const url = `${location.origin}${location.pathname}?role=student&room=${encodeURIComponent(roomId)}`;
    els.studentLink.value = url;
    if (window.QRCode && els.qrCanvas) {
      els.qrCanvas.innerHTML = "";
      QRCode.toCanvas(els.qrCanvas, url, { width: 168 });
    }
  }

  // 퀴즈 제어 (교사)
  async function startQuiz() {
    if (!roomId) return;
    await FS.updateDoc(roomRef(roomId), { mode: "active", currentIndex: 0, accept: true });
  }
  async function step(delta) {
    if (!roomId) return;
    await FS.runTransaction(window.db, async (tx) => {
      const ref = roomRef(roomId);
      const snap = await tx.get(ref);
      const r = snap.data();
      const total = r.questions?.length || 0;
      let next = (r.currentIndex ?? -1) + delta;

      // 마지막을 넘으면 종료
      if (next >= total) {
        tx.update(ref, { mode: "ended", accept: false });
        return;
      }
      // 처음 이전은 0으로
      next = Math.max(0, next);
      tx.update(ref, { currentIndex: next, accept: true });
    });
  }
  async function finishAll() {
    if (!roomId) return;
    await FS.updateDoc(roomRef(roomId), { mode: "ended", accept: false });
  }

  // 학생 참가/제출
  async function join() {
    if (!roomId) return alert("세션이 없습니다. (관리자가 접속 후 링크를 열어주세요)");
    const name = (els.joinName?.value || "").trim();
    if (!name) return alert("이름(번호)을 입력하세요.");
    let id = localStorage.getItem("quiz.device");
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      localStorage.setItem("quiz.device", id);
    }
    me = { id, name };
    await FS.setDoc(FS.doc(respCol(roomId), id), {
      name,
      joinedAt: FS.serverTimestamp(),
      answers: {},
      alive: true
    }, { merge: true });

    // 화면 전환: 참가 완료 → 대기
    els.joinModal?.classList.add("hide");
    els.sWrap?.classList.remove("hide");
    if (els.sState) els.sState.textContent = "대기 중입니다. 교사가 시작을 누르면 1번 문항이 표시됩니다.";
    saveLocal();
  }

  async function submit(value) {
    const r = window.__room;
    if (!roomId || !r?.accept) return alert("지금은 제출할 수 없습니다.");

    const idx = r.currentIndex;
    const q = r.questions?.[idx];
    if (!q) return;

    const ref = FS.doc(respCol(roomId), me.id);
    const snap = await FS.getDoc(ref);
    const prev = snap.exists ? (snap.data().answers || {}) : {};
    if (prev[idx] != null) return alert("이미 제출했습니다.");

    // 정오답 채점
    let correct = null;
    if (q.type === "mcq" && typeof value === "number") {
      correct = (value === (q.answerIndex ?? -999));
    }
    if (q.type === "short" && typeof value === "string") {
      const norm = s => String(s).trim().toLowerCase();
      if (q.answerText) correct = (norm(value) === norm(q.answerText));
    }

    await FS.setDoc(ref, {
      name: me.name,
      [`answers.${idx}`]: { value, correct: (correct === true) }
    }, { merge: true });
  }

  // 렌더링 (안내 → 문항)
  function renderRoom(r) {
    const idx = (typeof r.currentIndex === "number" ? r.currentIndex : -1);
    const total = r.questions?.length || 0;

    // 상단 정보
    if (els.nowQuestion) els.nowQuestion.textContent = (idx >= 0 && r.mode === "active") ? `Q${idx + 1}/${total}` : "-";
    if (els.pTitle) els.pTitle.textContent = r.title || roomId || "퀴즈";
    if (els.pImg) { els.pImg.classList.add("hide"); els.pImg.src = ""; }
    if (els.pOpts) els.pOpts.innerHTML = "";

    // --- 프레젠테이션(교사 화면)
    if (els.pQ) {
      if (r.mode !== "active" || idx < 0) {
        els.pQ.textContent = "시작 버튼을 누르면 문항이 제시됩니다.";
      } else {
        const q = r.questions[idx] || {};
        els.pQ.textContent = q.text || "";
        if (q.image && els.pImg) {
          els.pImg.src = q.image;
          els.pImg.classList.remove("hide");
        }
        if (els.pOpts && q.type === "mcq" && Array.isArray(q.options)) {
          q.options.forEach((t, i) => {
            const item = document.createElement("div");
            item.className = "popt";
            item.textContent = `${i + 1}. ${t}`;
            els.pOpts.appendChild(item);
          });
        }
      }
    }

    // --- 학생 화면
    if (MODE === "student") {
      // 관리자 UI 숨김은 setMode에서 처리됨. 여기서는 학생 플로우만 제어
      if (r.mode === "ended") {
        // 종료 화면
        els.joinModal?.classList.add("hide");
        els.sWrap?.classList.add("hide");
        els.sDone?.classList.remove("hide");
        return;
      }

      if (!me?.id) {
        // 참가 전: 무조건 참가 팝업
        els.sWrap?.classList.add("hide");
        els.sDone?.classList.add("hide");
        els.joinModal?.classList.remove("hide");
        if (els.sState) els.sState.textContent = "이름 또는 번호를 입력하세요!";
        return;
      }

      // 참가 후
      if (r.mode !== "active" || idx < 0) {
        els.joinModal?.classList.add("hide");
        els.sWrap?.classList.remove("hide");
        els.sDone?.classList.add("hide");
        if (els.sState) els.sState.textContent = "대기 중입니다. 교사가 시작을 누르면 1번 문항이 표시됩니다.";
        // 문항 영역 비워놓기
        if (els.sQTitle) els.sQTitle.textContent = "";
        if (els.sQImg) { els.sQImg.classList.add("hide"); els.sQImg.src = ""; }
        if (els.sOptBox) els.sOptBox.innerHTML = "";
        els.sShortWrap?.classList.add("hide");
        return;
      }

      // 문항 제시
      const q = r.questions[idx] || {};
      els.joinModal?.classList.add("hide");
      els.sDone?.classList.add("hide");
      els.sWrap?.classList.remove("hide");

      if (els.sQTitle) els.sQTitle.textContent = q.text || "";
      if (els.sQImg) { els.sQImg.classList.add("hide"); els.sQImg.src = ""; }
      if (q.image && els.sQImg) {
        els.sQImg.src = q.image;
        els.sQImg.classList.remove("hide");
      }

      if (els.sOptBox) els.sOptBox.innerHTML = "";
      if (q.type === "mcq" && Array.isArray(q.options)) {
        els.sShortWrap?.classList.add("hide");
        q.options.forEach((opt, i) => {
          const b = document.createElement("button");
          b.className = "btn popt";
          b.textContent = `${i + 1}. ${opt}`;
          b.disabled = !r.accept;
          b.onclick = () => submit(i);
          els.sOptBox.appendChild(b);
        });
      } else if (q.type === "short") {
        els.sShortWrap?.classList.remove("hide");
        if (els.btnShortSend) els.btnShortSend.disabled = !r.accept;
      } else {
        // 정의되지 않은 형식: 안전하게 모두 숨김
        els.sShortWrap?.classList.add("hide");
      }
    }
  }

  function renderResponses(list) {
    // 상단 카운터
    const r = window.__room || {};
    const idx = (typeof r.currentIndex === "number") ? r.currentIndex : -1;

    let join = list.length, sub = 0, corr = 0, wrong = 0;
    list.forEach(s => {
      const a = idx >= 0 ? s.answers?.[idx] : null;
      if (a) {
        sub++;
        if (a.correct === true) corr++;
        if (a.correct === false) wrong++;
      }
    });
    if (els.chipJoin) els.chipJoin.textContent = join;
    if (els.chipSubmit) els.chipSubmit.textContent = sub;
    if (els.chipCorrect) els.chipCorrect.textContent = corr;
    if (els.chipWrong) els.chipWrong.textContent = wrong;

    // 결과 테이블
    if (!els.resultsTable) return;
    const qs = r.questions || [];

    const tbl = document.createElement("table");
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    ["이름", ...qs.map((_, i) => `Q${i + 1}`), "점수"].forEach(h => {
      const th = document.createElement("th");
      th.textContent = h;
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    tbl.appendChild(thead);

    const tb = document.createElement("tbody");
    list.forEach(s => {
      let score = 0;
      const tr = document.createElement("tr");
      const tdName = document.createElement("td");
      tdName.textContent = s.name || s.id;
      tr.appendChild(tdName);

      qs.forEach((q, i) => {
        const a = s.answers?.[i];
        const td = document.createElement("td");
        if (a) {
          td.textContent = (q.type === "mcq")
            ? (typeof a.value === "number" ? a.value + 1 : "-")
            : (a.value ?? "-");
          if (a.correct) score++;
        } else {
          td.textContent = "-";
        }
        tr.appendChild(td);
      });

      const tdScore = document.createElement("td");
      tdScore.textContent = String(score);
      tr.appendChild(tdScore);

      tb.appendChild(tr);
    });
    tbl.appendChild(tb);

    els.resultsTable.innerHTML = "";
    els.resultsTable.appendChild(tbl);
  }

  // 탭/버튼 바인딩
  els.btnConnect?.addEventListener("click", connect);
  els.btnSignOut?.addEventListener("click", signOut);

  els.tabBuild?.addEventListener("click", () => showTab("build"));
  els.tabOptions?.addEventListener("click", () => showTab("options"));
  els.tabPresent?.addEventListener("click", () => showTab("present"));
  els.tabResults?.addEventListener("click", () => showTab("results"));

  // 간단 샘플/빈폼/저장(레이아웃은 유지, 저장은 Firestore merge)
  els.btnLoadSample?.addEventListener("click", () => {
    const sample = [
      { type: "mcq", text: "가장 큰 행성은?", options: ["지구", "목성", "화성", "금성"], answerIndex: 1 },
      { type: "short", text: "물의 끓는점(°C)?", answerText: "100" }
    ];
    if (els.quizTitle) els.quizTitle.value = "샘플 퀴즈";
    if (els.questionCount) els.questionCount.value = sample.length;
    if (els.builder) {
      els.builder.innerHTML = "";
      // (실제 폼은 생략 – 디자인 유지)
      const info = document.createElement("div");
      info.className = "muted";
      info.textContent = "샘플이 메모리에 로드되었습니다. [저장]을 눌러 세션에 반영하세요.";
      els.builder.appendChild(info);
    }
    // 메모리에 보관
    window.__pendingQuestions = sample;
  });

  els.btnBuildForm?.addEventListener("click", () => {
    const n = Math.max(1, Math.min(50, parseInt(els.questionCount?.value || "3", 10)));
    if (els.builder) {
      els.builder.innerHTML = "";
      const info = document.createElement("div");
      info.className = "muted";
      info.textContent = `빈 폼 ${n}개가 메모리에 준비되었습니다. (간이 UI)`;
      els.builder.appendChild(info);
    }
    // 간단히 n개 MCQ 기본 템플릿 생성
    window.__pendingQuestions = Array.from({ length: n }).map((_, i) => ({
      type: "mcq",
      text: `문항 ${i + 1}`,
      options: ["보기1", "보기2", "보기3", "보기4"],
      answerIndex: 0
    }));
  });

  els.btnSaveQuiz?.addEventListener("click", async () => {
    if (!roomId) return alert("세션 접속 후 저장하세요.");
    const title = els.quizTitle?.value || "퀴즈";
    const qs = Array.isArray(window.__pendingQuestions) ? window.__pendingQuestions : (window.__room?.questions || []);
    await FS.setDoc(roomRef(roomId), { title, questions: qs }, { merge: true });
    alert("저장 완료! (옵션 패널의 QR/링크가 최신 세션으로 유지됩니다)");
  });

  els.btnOptSave?.addEventListener("click", async () => {
    if (!roomId) return alert("세션 접속 후 저장하세요.");
    await FS.setDoc(roomRef(roomId), {
      policy: els.polName?.checked ? "name" : "device",
      accept: !!els.chkAccept?.checked,
      reveal: !!els.chkReveal?.checked,
      bright: !!els.chkBright?.checked,
      timer: parseInt(els.timerSec?.value || "30", 10)
    }, { merge: true });
    buildStudentLink();
    alert("옵션 저장 완료 (QR/링크 갱신)");
  });

  els.btnResetAll?.addEventListener("click", async () => {
    if (!roomId) return;
    await FS.setDoc(roomRef(roomId), {
      mode: "idle",
      currentIndex: -1,
      accept: false,
      reveal: false,
      questions: [],
      title: "새 세션"
    }, { merge: true });
    alert("초기화 완료 (문항/옵션/진행상태 초기화)");
  });

  // 프레젠테이션 제어
  els.btnStart?.addEventListener("click", startQuiz);
  els.btnPrev?.addEventListener("click", () => step(-1));
  els.btnNext?.addEventListener("click", () => step(+1));
  els.btnEndAll?.addEventListener("click", finishAll);

  // 학생 링크
  els.btnCopyLink?.addEventListener("click", async () => {
    const u = els.studentLink?.value;
    if (!u) return;
    await navigator.clipboard.writeText(u);
  });
  els.btnOpenStudent?.addEventListener("click", () => {
    const u = els.studentLink?.value;
    if (u) window.open(u, "_blank");
  });

  // 학생 – 참가/제출
  els.btnJoinGo?.addEventListener("click", join);
  els.btnShortSend?.addEventListener("click", () => {
    const v = els.sShortInput?.value || "";
    submit(v.trim());
  });

  // 결과 – 내보내기(간단 CSV)
  els.btnExportCSV?.addEventListener("click", () => {
    const resp = window.__resp || [];
    const room = window.__room || {};
    const qs = room.questions || [];
    const header = ["name", ...qs.map((_, i) => `Q${i + 1}`), "score"];
    const rows = resp.map(s => {
      let score = 0;
      const ans = qs.map((q, i) => {
        const a = s.answers?.[i];
        if (!a) return "-";
        if (a.correct) score++;
        return (q.type === "mcq")
          ? (typeof a.value === "number" ? a.value + 1 : "-")
          : (a.value ?? "-");
      });
      return [s.name || s.id, ...ans, score];
    });
    const csv = [header, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `results_${roomId || "session"}.csv`; a.click();
    URL.revokeObjectURL(url);
  });

  // 부팅
  function autoReconnect() {
    loadLocal();
    const url = new URL(location.href);
    const role = url.searchParams.get("role");
    const rid = url.searchParams.get("room");

    if (role === "student") setMode("student"); else setMode(MODE || "admin");

    if (rid) {
      if (els.roomId) els.roomId.value = rid;
      connect();
    } else {
      heartbeatOnline(false);
    }
  }
  autoReconnect();
})();
