/***********************
 * Live Quiz — app.js (Final)
 * - Admin: 기본 진입, 탭 동작, 문항/옵션/프레젠테이션/결과
 * - Student: 링크(QR) → 이름 팝업 → 대기 → 시작 시 1번 문항 노출
 * - 종료 시: 학생 “퀴즈가 종료되었습니다!” + [내 결과 보기]
 * - 초기화(reset): 문항/옵션/응답 전체 초기 상태
 * - Imports 불필요(자동 동적 로더). index.html의 window.db 사용.
 ***********************/

(() => {
  /* ---------- Helpers ---------- */
  const $  = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const pad = (n) => String(n).padStart(2, "0");

  const els = {
    // 상단 (admin 전용)
    roomId: $("#roomId"),
    btnConnect: $("#btnConnect"),
    btnSignOut: $("#btnSignOut"),
    roomStatus: $("#roomStatus"),
    tabBuild: $("#tabBuild"),
    tabOptions: $("#tabOptions"),
    tabPresent: $("#tabPresent"),
    tabResults: $("#tabResults"),

    // 패널
    pBuild: $("#panelBuild"),
    pOptions: $("#panelOptions"),
    pPresent: $("#panelPresent"),
    pResults: $("#panelResults"),

    // 문항 빌더
    quizTitle: $("#quizTitle"),
    questionCount: $("#questionCount"),
    btnBuildForm: $("#btnBuildForm"),
    btnLoadSample: $("#btnLoadSample"),
    btnSaveQuiz: $("#btnSaveQuiz"),
    builder: $("#builder"),
    fileUploadTxt: $("#fileUploadTxt"),
    btnUploadTxt: $("#btnUploadTxt"),
    btnDownloadTemplate: $("#btnDownloadTemplate"),

    // 옵션
    chkDeviceOnce: $("#chkDeviceOnce"),
    chkNameOnce: $("#chkNameOnce"),
    chkAccept: $("#chkAccept"),
    chkReveal: $("#chkReveal"),
    chkBright: $("#chkBright"),
    timerSec: $("#timerSec"),
    btnOptSave: $("#btnOptSave"),
    btnOptReset: $("#btnOptReset"),

    // 학생 접속
    qrCanvas: $("#qrCanvas"),
    studentLink: $("#studentLink"),
    btnCopyLink: $("#btnCopyLink"),
    btnOpenStudent: $("#btnOpenStudent"),

    // 프레젠테이션
    nowQuestion: $("#nowQuestion"),
    pTitle: $("#pTitle"),
    pQ: $("#pQ"),
    pImg: $("#pImg"),
    pOpts: $("#pOpts"),
    btnStart: $("#btnStart"),
    btnPrev: $("#btnPrev"),
    btnNext: $("#btnNext"),
    btnEndAll: $("#btnEndAll"),
    chipJoin: $("#chipJoin"),
    chipSubmit: $("#chipSubmit"),
    chipCorrect: $("#chipCorrect"),
    chipWrong: $("#chipWrong"),
    leftSec: $("#leftSec"),

    // 결과
    leaderboard: $("#leaderboard"),
    btnExportCSV: $("#btnExportCSV"),
    btnResetAll: $("#btnResetAll"),

    // 학생 전용 UI(최상단에 별도 섹션으로 가정)
    studentAccess: $("#studentAccess"),      // 학생 영역 래퍼
    joinModal: $("#joinModal"),              // 이름/번호 입력 카드
    joinName: $("#joinName"),
    btnJoinGo: $("#btnJoinGo"),
    sState: $("#sState"),                    // “대기 중…” / “제출 버튼을 눌러주세요”
    sQTitle: $("#sQTitle"),
    sQImg: $("#sQImg"),
    sOptBox: $("#sOptBox"),
    sShortWrap: $("#sShortWrap"),
    sShortInput: $("#sShortInput"),
    sShortSend: $("#sShortSend"),
    sDoneWrap: $("#sDoneWrap"),              // 종료 안내 + 내 결과 보기 버튼
    sMyTable: $("#sMyTable"),
    sMyBtn: $("#sMyBtn"),
  };

  // 누락된 엘리먼트 경고(동작에는 영향 없음)
  Object.entries(els).forEach(([k, v]) => { if (!v) console.warn("[warn] element missing:", k); });

  /* ---------- Global state ---------- */
  let MODE = "admin";               // 'admin' | 'student'
  let roomId = "";
  let me = { id: null, name: "" };
  let unsubRoom = null, unsubResp = null;
  let timerHandle = null;
  let F = null;                     // Firestore helpers (doc, collection, …)

  // 로컬 유지
  function saveLocal() {
    localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me }));
  }
  function loadLocal() {
    try {
      const d = JSON.parse(localStorage.getItem("quiz.live") || "{}");
      roomId = d.roomId || "";
      MODE = d.MODE || "admin";
      me = d.me || { id: null, name: "" };
      if (els.roomId && roomId) els.roomId.value = roomId;
    } catch {}
  }

  /* ---------- Firebase utils (no import) ---------- */
  async function ensureFirestoreHelpers() {
    if (F) return F;
    if (!window.db) {
      console.error("window.db가 없습니다. index.html의 Firebase 초기화 스니펫을 확인하세요.");
      throw new Error("No Firestore");
    }
    // 동적 로더: 모듈을 임포트해서 바운딩(일반 스크립트에서도 동작)
    const m = await import("https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js");
    F = {
      doc: m.doc,
      setDoc: m.setDoc,
      getDoc: m.getDoc,
      onSnapshot: m.onSnapshot,
      updateDoc: m.updateDoc,
      collection: m.collection,
      getDocs: m.getDocs,
      runTransaction: m.runTransaction,
      serverTimestamp: m.serverTimestamp,
    };
    return F;
  }

  const roomRef = (id) => F.doc(window.db, "rooms", id);
  const respCol = (id) => F.collection(window.db, "rooms", id, "responses");

  /* ---------- MODE / NAV ---------- */
  function setMode(m) {
    MODE = m;
    saveLocal();

    // admin UI 보이기/숨기기
    $$(".admin-only").forEach((el) => el.classList.toggle("hide", m !== "admin"));

    // 패널 가시성
    if (m === "admin") {
      showPanel("build");
      if (els.roomStatus) els.roomStatus.textContent = roomId ? `세션: ${roomId} · 온라인` : "세션: - · 오프라인";
    } else {
      // 학생: 관리자 UI 전체 비가시화
      [els.pBuild, els.pOptions, els.pPresent, els.pResults].forEach((p) => p && p.classList.add("hide"));
      // 학생 전용 래퍼 보이기
      els.studentAccess && els.studentAccess.classList.remove("hide");
    }
  }

  function showPanel(which) {
    const map = {
      build: els.pBuild,
      options: els.pOptions,
      present: els.pPresent,
      results: els.pResults,
    };
    Object.values(map).forEach((p) => p && p.classList.add("hide"));
    map[which] && map[which].classList.remove("hide");

    // 탭 active
    [els.tabBuild, els.tabOptions, els.tabPresent, els.tabResults].forEach((t) => t && t.classList.remove("active"));
    ({
      build: els.tabBuild, options: els.tabOptions, present: els.tabPresent, results: els.tabResults,
    }[which] || null)?.classList.add("active");
  }

  /* ---------- Connect / Listen ---------- */
  async function ensureRoom(id) {
    await ensureFirestoreHelpers();
    const snap = await F.getDoc(roomRef(id));
    if (!snap.exists()) {
      await F.setDoc(roomRef(id), {
        title: "새 세션", mode: "idle", currentIndex: -1,
        accept: false, reveal: false,
        deviceOnce: true, nameOnce: false, bright: false,
        timer: 30,
        createdAt: F.serverTimestamp(),
        questions: []
      });
    }
  }

  function listenRoom(id) {
    if (unsubRoom) unsubRoom();
    unsubRoom = F.onSnapshot(roomRef(id), (snap) => {
      if (!snap.exists()) return;
      const r = snap.data();
      window.__room = r;
      renderRoom(r);
    });
  }

  function listenResponses(id) {
    if (unsubResp) unsubResp();
    unsubResp = F.onSnapshot(respCol(id), (qs) => {
      const arr = [];
      qs.forEach((d) => arr.push({ id: d.id, ...d.data() }));
      renderResponses(arr);
    });
  }

  async function connect() {
    const id = (els.roomId?.value || "").trim();
    if (!id) return alert("세션 코드를 입력하세요.");
    await ensureRoom(id);
    roomId = id;
    listenRoom(roomId);
    listenResponses(roomId);
    buildStudentLink();           // QR/링크 즉시 갱신
    if (els.roomStatus) els.roomStatus.textContent = `세션: ${roomId} · 온라인`;
    els.btnConnect?.classList.add("hide");
    els.btnSignOut?.classList.remove("hide");
    els.roomId && (els.roomId.disabled = true);
    saveLocal();
  }

  function signOut() {
    if (unsubRoom) unsubRoom();
    if (unsubResp) unsubResp();
    unsubRoom = unsubResp = null;

    roomId = "";
    if (els.roomId) { els.roomId.value = ""; els.roomId.disabled = false; }
    els.btnSignOut?.classList.add("hide");
    els.btnConnect?.classList.remove("hide");
    if (els.roomStatus) els.roomStatus.textContent = "세션: - · 오프라인";
    // 화면 초기화(패널은 유지, 데이터만 clear)
    renderRoom({ title: "", questions: [], mode: "idle", currentIndex: -1, accept: false, reveal: false });
    renderResponses([]);
    buildStudentLink();
    saveLocal();
  }

  function autoReconnect() {
    loadLocal();
    // 기본 진입은 관리자
    setMode(MODE || "admin");
    if (roomId) connect();
  }

  /* ---------- Builder ---------- */
  function qCard(no, q) {
    const wrap = document.createElement("div");
    wrap.className = "qcard";
    wrap.innerHTML = `
      <div class="row wrap gap">
        <span class="badge">${no}번</span>
        <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${q?.type === "short" ? "" : "checked"} /><span>객관식</span></label>
        <label class="switch"><input type="radio" name="type-${no}" value="short" ${q?.type === "short" ? "checked" : ""} /><span>주관식</span></label>
        <label class="btn ghost right"><input type="file" accept="image/*" class="hide qimg" data-no="${no}">이미지</label>
      </div>
      <input class="qtext input" data-no="${no}" placeholder="문항 내용" value="${q?.text || ""}" />
      <div class="mcq ${q?.type === "short" ? "hide" : ""}">
        <div class="row wrap">
          ${(q?.options || ["", "", "", ""])
            .map((v, i) => `<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기 ${i + 1}" value="${v}">`)
            .join("")}
        </div>
        <div class="row gap">
          <span class="hint">정답 번호</span>
          <input class="ansIndex input sm" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex ?? 0) + 1}">
        </div>
      </div>
      <div class="short ${q?.type === "short" ? "" : "hide"}">
        <input class="ansText input" data-no="${no}" placeholder="정답(선택, 자동채점용)" value="${q?.answerText || ""}">
      </div>
    `;
    // 객/주 토글
    const radios = $$(`input[name="type-${no}"]`, wrap);
    const mcq = $(".mcq", wrap), short = $(".short", wrap);
    radios.forEach(r => r.addEventListener("change", () => {
      const isShort = radios.find(x => x.checked)?.value === "short";
      mcq.classList.toggle("hide", isShort);
      short.classList.toggle("hide", !isShort);
    }));
    // 이미지 파일 저장(데이터URL)
    const qimg = $(".qimg", wrap);
    qimg?.addEventListener("change", async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      const url = await fileToDataURL(f);
      wrap.dataset.img = url; // 수집 시 포함
    });
    if (q?.img) wrap.dataset.img = q.img;
    return wrap;
  }

  function fileToDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  function collectBuilder() {
    const cards = $$("#builder .qcard");
    const list = cards.map((c, idx) => {
      const no = idx + 1;
      const type = c.querySelector(`input[name="type-${no}"]:checked`).value;
      const text = c.querySelector(".qtext")?.value?.trim() || "";
      const img = c.dataset.img || "";
      if (!text) return null;
      if (type === "mcq") {
        const opts = $$(".opt", c).map(i => i.value.trim()).filter(Boolean);
        const ans = Math.max(0, Math.min(opts.length - 1, (parseInt(c.querySelector(".ansIndex")?.value, 10) || 1) - 1));
        return { type: "mcq", text, options: opts, answerIndex: ans, img };
      } else {
        const aText = c.querySelector(".ansText")?.value?.trim() || "";
        return { type: "short", text, answerText: aText, img };
      }
    }).filter(Boolean);
    return { title: els.quizTitle?.value || "퀴즈", questions: list };
  }

  /* ---------- Flow / Timer ---------- */
  async function startQuiz() {
    await ensureFirestoreHelpers();
    await F.updateDoc(roomRef(roomId), { mode: "active", currentIndex: 0, accept: true });
  }
  async function step(delta) {
    await ensureFirestoreHelpers();
    await F.runTransaction(window.db, async (tx) => {
      const snap = await tx.get(roomRef(roomId));
      const r = snap.data(); const total = (r.questions?.length || 0);
      let next = (r.currentIndex ?? -1) + delta;
      if (next >= total) {
        // 마지막 이후: 종료 → 결과 패널 자동 전환
        tx.update(roomRef(roomId), { mode: "ended", accept: false });
        return;
      }
      next = Math.max(0, next);
      tx.update(roomRef(roomId), { currentIndex: next, accept: true });
    });
  }
  async function finishAll() {
    if (!confirm("퀴즈를 종료할까요?")) return;
    await ensureFirestoreHelpers();
    await F.updateDoc(roomRef(roomId), { mode: "ended", accept: false });
  }

  function startTimer(sec) {
    stopTimer();
    const end = Date.now() + sec * 1000;
    timerHandle = setInterval(async () => {
      const remain = Math.max(0, Math.floor((end - Date.now()) / 1000));
      els.leftSec && (els.leftSec.textContent = `${pad(Math.floor(remain / 60))}:${pad(remain % 60)}`);
      if (remain <= 0) {
        stopTimer();
        await ensureFirestoreHelpers();
        await F.updateDoc(roomRef(roomId), { accept: false });
        setTimeout(() => step(+1), 400);
      }
    }, 250);
  }
  function stopTimer() {
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = null;
    els.leftSec && (els.leftSec.textContent = "00:00");
  }

  /* ---------- Submit / Grade ---------- */
  async function join() {
    await ensureFirestoreHelpers();
    if (!roomId) return alert("세션에 먼저 접속하세요.");
    const name = (els.joinName?.value || "").trim();
    if (!name) return alert("이름(번호)을 입력하세요.");
    me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2, 10), name };
    localStorage.setItem("quiz.device", me.id);
    await F.setDoc(F.doc(respCol(roomId), me.id), {
      name, joinedAt: F.serverTimestamp(), answers: {}, alive: true
    }, { merge: true });
    els.joinModal && els.joinModal.classList.add("hide");
    els.sState && (els.sState.textContent = "참가 완료! 제출 버튼을 눌러주세요.");
    saveLocal();
  }

  async function submit(value) {
    await ensureFirestoreHelpers();
    const r = window.__room; if (!r?.accept) return alert("지금은 제출할 수 없습니다.");
    const idx = r.currentIndex; const q = r.questions?.[idx]; if (!q) return;
    const ref = F.doc(respCol(roomId), me.id);
    const snap = await F.getDoc(ref); const prev = snap.exists() ? (snap.data().answers || {}) : {};
    if (prev[idx] != null) return alert("이미 제출했습니다.");
    let correct = null;
    if (q.type === "mcq" && typeof value === "number") correct = (value === (q.answerIndex ?? -1));
    if (q.type === "short" && typeof value === "string") {
      const norm = (s) => String(s).trim().toLowerCase();
      if (q.answerText) correct = (norm(value) === norm(q.answerText));
    }
    await F.setDoc(ref, {
      name: me.name,
      [`answers.${idx}`]: { value, correct: (correct === true), revealed: r.reveal || false }
    }, { merge: true });
    els.sState && (els.sState.textContent = "제출 완료!");
  }

  async function grade(uid, qIndex, ok) {
    await ensureFirestoreHelpers();
    await F.setDoc(F.doc(respCol(roomId), uid), {
      [`answers.${qIndex}.correct`]: !!ok,
      [`answers.${qIndex}.revealed`]: true
    }, { merge: true });
  }

  /* ---------- Render (Admin & Student) ---------- */
  function renderRoom(r) {
    // 공통
    if (els.chkAccept) els.chkAccept.checked = !!r.accept;
    if (els.chkReveal) els.chkReveal.checked = !!r.reveal;

    // Admin 프레젠테이션
    if (els.pTitle) els.pTitle.textContent = r.title || roomId || "실시간 퀴즈";
    if (els.nowQuestion) els.nowQuestion.textContent =
      (r.currentIndex >= 0 && r.questions?.[r.currentIndex]) ? r.questions[r.currentIndex].text : "-";

    if (els.pQ && els.pOpts) {
      els.pOpts.innerHTML = "";
      if (r.mode !== "active" || r.currentIndex < 0 || !r.questions?.[r.currentIndex]) {
        els.pQ.textContent = "시작 버튼을 누르면 문항이 제시됩니다.";
        if (els.pImg) els.pImg.classList.add("hide");
      } else {
        const q = r.questions[r.currentIndex];
        els.pQ.textContent = q.text;
        // 이미지 유무
        if (els.pImg) {
          if (q.img) { els.pImg.src = q.img; els.pImg.classList.remove("hide"); }
          else els.pImg.classList.add("hide");
        }
        // 객관식 보기
        if (q.type === "mcq") {
          q.options.forEach((t, i) => {
            const d = document.createElement("div");
            d.className = "popt";
            d.textContent = `${i + 1}. ${t}`;
            els.pOpts.appendChild(d);
          });
        }
      }
    }

    // “종료 → 결과로 이동” (Admin)
    if (MODE === "admin" && r.mode === "ended") {
      showPanel("results");
    }

    // 학생 화면
    if (MODE === "student") {
      // 학생 첫 진입: 대기 카드 보이기
      if (r.mode !== "active" || r.currentIndex < 0) {
        els.joinModal && els.joinModal.classList.add("hide"); // 이미 참가한 상태라면 입력은 숨김
        els.sDoneWrap && els.sDoneWrap.classList.toggle("hide", r.mode !== "ended");
        if (r.mode === "ended") {
          // 종료 안내 + 내 결과 보기만 보이게
          els.sState && (els.sState.textContent = "퀴즈가 종료되었습니다!");
          showStudentQuestion(null);
        } else {
          els.sState && (els.sState.textContent = "대기 중입니다…");
          showStudentQuestion(null);
        }
        return;
      }
      // 진행 문항
      const q = r.questions[r.currentIndex];
      els.sState && (els.sState.textContent = "제출 버튼을 눌러주세요.");
      showStudentQuestion(q, r.accept);
    }
  }

  function showStudentQuestion(q, canSubmit = false) {
    // q === null → 문제 숨김
    if (!q) {
      if (els.sQTitle) els.sQTitle.textContent = "";
      if (els.sQImg) els.sQImg.classList.add("hide");
      if (els.sOptBox) els.sOptBox.innerHTML = "";
      els.sShortWrap && els.sShortWrap.classList.add("hide");
      return;
    }
    if (els.sQTitle) els.sQTitle.textContent = q.text;
    if (els.sQImg) {
      if (q.img) { els.sQImg.src = q.img; els.sQImg.classList.remove("hide"); }
      else els.sQImg.classList.add("hide");
    }
    if (q.type === "mcq") {
      if (els.sOptBox) {
        els.sOptBox.innerHTML = "";
        q.options.forEach((t, i) => {
          const b = document.createElement("button");
          b.className = "optbtn";
          b.textContent = `${i + 1}. ${t}`;
          b.disabled = !canSubmit;
          b.addEventListener("click", () => submit(i));
          els.sOptBox.appendChild(b);
        });
      }
      els.sShortWrap && els.sShortWrap.classList.add("hide");
    } else {
      els.sOptBox && (els.sOptBox.innerHTML = "");
      if (els.sShortWrap) {
        els.sShortWrap.classList.remove("hide");
        els.sShortInput && (els.sShortInput.disabled = !canSubmit);
        els.sShortSend && (els.sShortSend.disabled = !canSubmit);
      }
    }
  }

  function renderResponses(list) {
    const r = window.__room || {};
    const idx = r.currentIndex; const q = r.questions?.[idx];

    // 칩 통계(프레젠테이션 하단)
    const joinCnt = list.length;
    const submits = list.filter(s => s.answers && s.answers[idx] != null);
    const ok = submits.filter(s => s.answers[idx]?.correct).length;
    const no = submits.length - ok;

    if (els.chipJoin) els.chipJoin.textContent = joinCnt;
    if (els.chipSubmit) els.chipSubmit.textContent = submits.length;
    if (els.chipCorrect) els.chipCorrect.textContent = ok;
    if (els.chipWrong) els.chipWrong.textContent = no;

    // 결과 테이블 (admin)
    if (els.leaderboard) {
      const tbl = document.createElement("table");
      const thead = document.createElement("thead");
      const tr = document.createElement("tr");
      ["이름", ...(r.questions || []).map((_, i) => `Q${i + 1}`), "점수"].forEach(h => {
        const th = document.createElement("th"); th.textContent = h; tr.appendChild(th);
      });
      thead.appendChild(tr); tbl.appendChild(thead);

      const tb = document.createElement("tbody");
      list.forEach(s => {
        let score = 0; const tr = document.createElement("tr");
        const tdn = document.createElement("td"); tdn.textContent = s.name || s.id; tr.appendChild(tdn);
        (r.questions || []).forEach((q, i) => {
          const a = s.answers?.[i]; const td = document.createElement("td");
          td.textContent = a ? (q.type === "mcq" ? (typeof a.value === "number" ? a.value + 1 : "-") : (a.value ?? "-")) : "-";
          if (a?.correct) score++;
          tr.appendChild(td);
        });
        const tds = document.createElement("td"); tds.textContent = String(score); tr.appendChild(tds);
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      els.leaderboard.innerHTML = "";
      els.leaderboard.appendChild(tbl);
    }

    // 학생 개인 결과(종료 후 sMyTable)
    if (MODE === "student" && els.sMyTable) {
      if (r.mode !== "ended") return;
      const meSnap = list.find(x => x.id === me.id);
      if (!meSnap) return;
      const t = document.createElement("table");
      const thead = document.createElement("thead");
      const tr = document.createElement("tr");
      ["문항", "제출", "정답"].forEach(h => { const th = document.createElement("th"); th.textContent = h; tr.appendChild(th); });
      thead.appendChild(tr); t.appendChild(thead);
      const tb = document.createElement("tbody");
      (r.questions || []).forEach((q, i) => {
        const a = meSnap.answers?.[i];
        const tr = document.createElement("tr");
        const td1 = document.createElement("td"); td1.textContent = String(i + 1);
        const td2 = document.createElement("td"); td2.textContent = a ? (q.type === "mcq" ? (a.value + 1) : (a.value || "")) : "-";
        const td3 = document.createElement("td"); td3.textContent = a ? (a.correct ? "O" : "X") : "×";
        tr.append(td1, td2, td3); tb.appendChild(tr);
      });
      t.appendChild(tb);
      els.sMyTable.innerHTML = "";
      els.sMyTable.appendChild(t);
    }
  }

  /* ---------- Student Link & QR ---------- */
  function buildStudentLink() {
    if (!els.studentLink) return;
    const url = new URL(location.href);
    url.searchParams.set("role", "student");
    if (roomId) url.searchParams.set("room", roomId);
    els.studentLink.value = url.toString();

    if (window.QRCode && els.qrCanvas) {
      try {
        window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width: 144 }, (err) => { if (err) console.warn(err); });
      } catch (e) { console.warn("QR draw failed", e); }
    }
  }

  /* ---------- CSV / Reset / Save/Load ---------- */
  els.btnExportCSV?.addEventListener("click", async () => {
    await ensureFirestoreHelpers();
    const r = (await F.getDoc(roomRef(roomId))).data();
    const snap = await F.getDocs(respCol(roomId));
    const rows = [];
    rows.push(["userId", "name", ...(r.questions || []).map((_, i) => `Q${i + 1}`), "score"].join(","));
    snap.forEach(d => {
      const s = d.data(); let score = 0;
      const answers = (r.questions || []).map((q, i) => {
        const a = s.answers?.[i]; if (a?.correct) score++;
        return q.type === "mcq" ? (typeof a?.value === "number" ? a.value + 1 : "") : (a?.value ?? "");
      });
      rows.push([d.id, `"${(s.name || "").replace(/"/g, '""')}"`, ...answers, score].join(","));
    });
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${roomId || "quiz"}-results.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  els.btnResetAll?.addEventListener("click", async () => {
    if (!confirm("문항/옵션/응답을 모두 초기화하고 처음 상태로 되돌립니다. 계속할까요?")) return;
    await ensureFirestoreHelpers();
    // 룸의 기본 필드 리셋
    await F.setDoc(roomRef(roomId), {
      title: "새 세션", mode: "idle", currentIndex: -1,
      accept: false, reveal: false,
      deviceOnce: true, nameOnce: false, bright: false,
      timer: 30, questions: []
    }, { merge: true });
    // 응답 초기화
    const snap = await F.getDocs(respCol(roomId));
    await Promise.all(snap.docs.map(d => F.setDoc(F.doc(respCol(roomId), d.id), { answers: {}, alive: true }, { merge: true })));
    alert("초기화 완료");
  });

  // 빌더 버튼
  els.btnBuildForm?.addEventListener("click", () => {
    const n = Math.max(1, Math.min(50, parseInt(els.questionCount?.value, 10) || 3));
    if (els.builder) { els.builder.innerHTML = ""; for (let i = 0; i < n; i++) els.builder.appendChild(qCard(i + 1)); }
  });
  els.btnLoadSample?.addEventListener("click", () => {
    const S = [
      { type: "mcq", text: "가장 큰 행성은?", options: ["지구", "목성", "화성", "금성"], answerIndex: 1 },
      { type: "short", text: "물의 끓는점(°C)?", answerText: "100" },
      { type: "mcq", text: "태양계 별명?", options: ["Milky", "Solar", "Sunset", "Lunar"], answerIndex: 1 },
    ];
    if (els.builder) { els.builder.innerHTML = ""; S.forEach((q, i) => els.builder.appendChild(qCard(i + 1, q))); }
    if (els.quizTitle) els.quizTitle.value = "샘플 퀴즈";
    if (els.questionCount) els.questionCount.value = S.length;
  });

  els.btnSaveQuiz?.addEventListener("click", async () => {
    await ensureFirestoreHelpers();
    const payload = collectBuilder();
    if (!payload.questions.length) return alert("문항을 추가하세요.");
    await F.setDoc(roomRef(roomId), { title: payload.title, questions: payload.questions }, { merge: true });
    alert("저장 완료!");
  });

  // txt/csv 업로드/양식
  els.btnUploadTxt?.addEventListener("click", () => els.fileUploadTxt?.click());
  els.fileUploadTxt?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const text = await f.text();
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const qs = lines.map(line => {
      const cells = line.split(",").map(s => s.trim());
      if (cells.length === 6) {
        const [t, a, b, c, d, ans] = cells;
        return { type: "mcq", text: t, options: [a, b, c, d], answerIndex: Math.max(0, Math.min(3, (parseInt(ans, 10) || 1) - 1)) };
      }
      if (cells.length === 3 && cells[1] === "주관식") {
        return { type: "short", text: cells[0], answerText: cells[2] };
      }
      return null;
    }).filter(Boolean);
    if (!qs.length) return alert("형식이 올바르지 않습니다.");
    if (els.builder) { els.builder.innerHTML = ""; qs.forEach((q, i) => els.builder.appendChild(qCard(i + 1, q))); }
    if (els.quizTitle && !els.quizTitle.value) els.quizTitle.value = "업로드 퀴즈";
    if (els.questionCount) els.questionCount.value = qs.length;
  });
  els.btnDownloadTemplate?.addEventListener("click", () => {
    const sample = [
      "가장 큰 행성은?,지구,목성,화성,금성,2",
      "물의 끓는점은?,주관식,100"
    ].join("\n");
    const blob = new Blob([sample], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "quiz-template.txt"; a.click();
    URL.revokeObjectURL(a.href);
  });

  // 옵션 저장/초기화
  els.btnOptSave?.addEventListener("click", async () => {
    await ensureFirestoreHelpers();
    const payload = {
      deviceOnce: !!els.chkDeviceOnce?.checked,
      nameOnce: !!els.chkNameOnce?.checked,
      bright: !!els.chkBright?.checked,
      accept: !!els.chkAccept?.checked,
      reveal: !!els.chkReveal?.checked,
      timer: Math.max(5, Math.min(600, parseInt(els.timerSec?.value, 10) || 30)),
    };
    await F.setDoc(roomRef(roomId), payload, { merge: true });
    buildStudentLink(); // QR/링크 갱신
    alert("옵션 저장됨");
  });
  els.btnOptReset?.addEventListener("click", async () => {
    await ensureFirestoreHelpers();
    await F.setDoc(roomRef(roomId), {
      deviceOnce: true, nameOnce: false, bright: false,
      accept: false, reveal: false, timer: 30
    }, { merge: true });
    alert("옵션 기본값으로 복구");
  });

  // 탭
  els.tabBuild?.addEventListener("click", () => showPanel("build"));
  els.tabOptions?.addEventListener("click", () => showPanel("options"));
  els.tabPresent?.addEventListener("click", () => showPanel("present"));
  els.tabResults?.addEventListener("click", () => showPanel("results"));

  // 프레젠테이션 제어
  els.btnStart?.addEventListener("click", startQuiz);
  els.btnPrev?.addEventListener("click", () => step(-1));
  els.btnNext?.addEventListener("click", () => step(+1));
  els.btnEndAll?.addEventListener("click", finishAll);

  // 옵션 직접 토글
  els.chkAccept?.addEventListener("change", async () => {
    await ensureFirestoreHelpers();
    await F.updateDoc(roomRef(roomId), { accept: !!els.chkAccept.checked });
  });
  els.chkReveal?.addEventListener("change", async () => {
    await ensureFirestoreHelpers();
    await F.updateDoc(roomRef(roomId), { reveal: !!els.chkReveal.checked });
  });

  // 학생용 링크
  els.btnCopyLink?.addEventListener("click", async () => {
    if (!els.studentLink) return;
    await navigator.clipboard.writeText(els.studentLink.value);
    els.btnCopyLink.textContent = "복사됨"; setTimeout(() => els.btnCopyLink.textContent = "복사", 1200);
  });
  els.btnOpenStudent?.addEventListener("click", () => window.open(els.studentLink?.value || "#", "_blank"));

  // 학생 제출
  els.btnJoinGo?.addEventListener("click", join);
  els.sShortSend?.addEventListener("click", () => submit((els.sShortInput?.value || "").trim()));

  // 상단 접속/아웃
  els.btnConnect?.addEventListener("click", connect);
  els.btnSignOut?.addEventListener("click", signOut);

  /* ---------- Boot ---------- */
  // URL 파라미터: ?role=student&room=class1
  (function fromURL() {
    const url = new URL(location.href);
    const role = url.searchParams.get("role");
    const rid = url.searchParams.get("room");
    if (role === "student") {
      MODE = "student";
    }
    if (rid) {
      roomId = rid;
      els.roomId && (els.roomId.value = rid);
    }
  })();

  setMode(MODE);   // 기본은 admin
  autoReconnect();
  // 학생 진입이면 학생 카드 우선 노출
  if (MODE === "student") {
    els.studentAccess && els.studentAccess.classList.remove("hide");
    if (!me?.name) els.joinModal && els.joinModal.classList.remove("hide");
  }

})();
