/* =========================================================================
   Live Quiz – app.js (non-module)
   - 버튼 무반응/세션아웃 초기화/학생 링크·QR 갱신/대기→시작 흐름/중복제출 방지
   - 기존 레이아웃/디자인 유지(상단 탭/패널 구조 그대로 사용)
   ========================================================================== */

(() => {
  // ---- 안전 가드: Firestore 전역 확인 -------------------------------------
  if (!window.FS || !window.FS.db) {
    console.error("[init] Firestore 전역(FS) 미로딩 - index.html 모듈 스크립트 확인");
    return;
  }
  const {
    db, doc, collection, getDoc, setDoc, updateDoc,
    onSnapshot, runTransaction, getDocs, serverTimestamp, deleteDoc
  } = window.FS;

  // ---- 헬퍼 ---------------------------------------------------------------
  const $  = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const pad = n => String(n).padStart(2, "0");

  const els = {
    // 헤더(관리자 전용 영역은 class="admin-only"로 묶여있음)
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

    // 빌더
    quizTitle: $("#quizTitle"),
    questionCount: $("#questionCount"),
    btnBuildForm: $("#btnBuildForm"),
    btnLoadSample: $("#btnLoadSample"),
    btnSaveQuiz: $("#btnSaveQuiz"),
    builder: $("#builder"),
    buildGuide: $("#buildGuide"),

    // 옵션(학생접속)
    chkDeviceOnce: $("#optDeviceOnce"),
    chkNameOnce: $("#optNameOnce"),
    chkAccept: $("#chkAccept"),
    chkReveal: $("#chkReveal"),
    chkBright: $("#optBright"),
    timerSec: $("#timerSec"),
    btnOptSave: $("#btnOptSave"),
    qrCanvas: $("#qrCanvas"),
    studentLink: $("#studentLink"),
    btnCopyLink: $("#btnCopyLink"),
    btnOpenStudent: $("#btnOpenStudent"),

    // 프레젠테이션/진행
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
    btnExportCSV: $("#btnExportCSV"),
    btnResetAll: $("#btnResetAll"),
    resultsTable: $("#resultsTable"),
    leaderboard: $("#leaderboard"),

    // 학생 전용 컨테이너(링크로 열렸을 때 동적 생성)
    // 필요 DOM은 app.js가 동적으로 생성/삽입하므로 추가 마크업 필요 없음
  };

  // 없어도 앱은 동작하도록 경고만 출력
  Object.entries(els).forEach(([k, v]) => { if (!v) console.warn("[warn] element missing:", k); });

  // ---- 상태 ---------------------------------------------------------------
  let MODE   = "admin";           // 'admin' | 'student'
  let roomId = "";
  let me     = { id: null, name: "" };
  let unsubRoom = null, unsubResp = null;
  let timerHandle = null;
  let cacheResponses = []; // 결과/칩 계산용

  // ---- 공통: Firestore 경로 -----------------------------------------------
  const roomRef = id => doc(db, "rooms", id);
  const respCol = id => collection(db, "rooms", id, "responses");

  // ---- 세션/로컬 ----------------------------------------------------------
  function saveLocal() { localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me })); }
  function loadLocal() {
    try {
      const d = JSON.parse(localStorage.getItem("quiz.live") || "{}");
      roomId = d.roomId || "";
      MODE   = d.MODE   || "admin";
      me     = d.me     || { id: null, name: "" };
    } catch {}
  }

  // ---- UI 토글 ------------------------------------------------------------
  function setMode(m) {
    MODE = m;
    saveLocal();

    // admin-only 표시/비표시
    $$(".admin-only").forEach(e => e.classList.toggle("hide", m !== "admin"));

    // 패널 표시 기본값
    if (m === "admin") {
      showTab("build");
      if (els.roomStatus) els.roomStatus.textContent = roomId ? `세션: ${roomId} · 온라인` : "세션: - · 오프라인";
    } else {
      // 학생 모드: 관리자 UI 전부 숨김, 학생 전용 화면 생성
      hideAllPanels();
      buildStudentShell();  // 학생용 프레임 동적 생성
    }
  }

  function hideAllPanels() {
    [els.pBuild, els.pOptions, els.pPresent, els.pResults].forEach(p => p && p.classList.add("hide"));
    [els.tabBuild, els.tabOptions, els.tabPresent, els.tabResults].forEach(t => t && t.classList.remove("active"));
  }

  function showTab(kind) {
    hideAllPanels();
    const tabMap = {
      build:   [els.tabBuild,   els.pBuild],
      options: [els.tabOptions, els.pOptions],
      present: [els.tabPresent, els.pPresent],
      results: [els.tabResults, els.pResults]
    };
    const pair = tabMap[kind];
    if (!pair) return;
    pair[0] && pair[0].classList.add("active");
    pair[1] && pair[1].classList.remove("hide");
  }

  // ---- 연결/해제 ----------------------------------------------------------
  async function ensureRoom(id) {
    const snap = await getDoc(roomRef(id));
    if (!snap.exists()) {
      await setDoc(roomRef(id), {
        title: "새 세션",
        questions: [],
        mode: "idle",          // idle | active | ended
        currentIndex: -1,
        accept: false,
        reveal: false,
        options: { deviceOnce: true, nameOnce: false, bright: false, timerSec: 30 },
        createdAt: serverTimestamp()
      });
    }
  }

  async function connect() {
    const id = (els.roomId?.value || "").trim();
    if (!id) return alert("세션 코드를 입력하세요.");
    roomId = id;

    await ensureRoom(roomId);

    // 입력 잠금 & 세션아웃 버튼
    if (els.roomId) { els.roomId.disabled = true; els.roomId.classList.add("locked"); }
    els.btnSignOut && els.btnSignOut.classList.remove("hide");

    listenRoom(roomId);
    listenResponses(roomId);
    buildStudentLink();            // 링크/QR 갱신

    els.roomStatus && (els.roomStatus.textContent = `세션: ${roomId} · 온라인`);
    saveLocal();
  }

  function signOut() {
    // 구독 해제
    if (unsubRoom) unsubRoom();
    if (unsubResp) unsubResp();
    unsubRoom = unsubResp = null;

    // UI 초기화
    if (els.roomId) { els.roomId.disabled = false; els.roomId.classList.remove("locked"); }
    els.btnSignOut && els.btnSignOut.classList.add("hide");
    els.roomStatus && (els.roomStatus.textContent = "세션: - · 오프라인");

    // 상태 초기화
    roomId = "";
    cacheResponses = [];
    stopTimer();
    saveLocal();

    // 완전 초기화(문항/옵션/결과 UI는 그대로 비움) — 필요 시 저장 데이터도 삭제하려면 아래 주석 해제
    // deleteRoomAll();
  }

  async function deleteRoomAll() {
    if (!roomId) return;
    const snap = await getDocs(respCol(roomId));
    const tasks = [];
    snap.forEach(d => tasks.push(deleteDoc(doc(respCol(roomId), d.id))));
    await Promise.all(tasks);
    await setDoc(roomRef(roomId), {
      title: "새 세션", questions: [], mode: "idle", currentIndex: -1, accept: false, reveal: false
    }, { merge: true });
  }

  // ---- 실시간 구독 --------------------------------------------------------
  function listenRoom(id) {
    if (unsubRoom) unsubRoom();
    unsubRoom = onSnapshot(roomRef(id), (snap) => {
      if (!snap.exists()) return;
      const r = snap.data();
      window.__room = r;
      renderRoom(r);
    });
  }
  function listenResponses(id) {
    if (unsubResp) unsubResp();
    unsubResp = onSnapshot(respCol(id), (qs) => {
      const list = [];
      qs.forEach(d => list.push({ id: d.id, ...d.data() }));
      cacheResponses = list;
      renderResponses(list);
    });
  }

  // ---- 빌더 ---------------------------------------------------------------
  function cardRow(no, q) {
    const wrap = document.createElement("div");
    wrap.className = "qcard";
    wrap.innerHTML = `
      <div class="row wrap">
        <span class="badge">${no}번</span>
        <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${q?.type === "short" ? "" : "checked"} /><span>객관식</span></label>
        <label class="switch"><input type="radio" name="type-${no}" value="short" ${q?.type === "short" ? "checked" : ""} /><span>주관식</span></label>
        <label class="btn ghost right"><input type="file" class="qimg" accept="image/*" hidden>이미지</label>
      </div>
      <input class="qtext input" data-no="${no}" placeholder="문항" value="${q?.text || ""}" />
      <div class="mcq ${q?.type === "short" ? "hide" : ""}">
        <div class="row wrap">
          ${(q?.options || ["", "", "", ""]).map((v, i) => `
            <input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기${i + 1}" value="${v}">
          `).join("")}
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
    radios.forEach(r => r.addEventListener("change", () => {
      const isShort = radios.find(x => x.checked)?.value === "short";
      mcq.classList.toggle("hide", isShort);
      short.classList.toggle("hide", !isShort);
    }));
    // 이미지 선택 저장
    $(".qimg", wrap)?.addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if (!f) { wrap.dataset.img = ""; return; }
      const reader = new FileReader();
      reader.onload = () => { wrap.dataset.img = reader.result; }; // dataURL 저장
      reader.readAsDataURL(f);
    });
    return wrap;
  }

  function collectBuilder() {
    const cards = $$("#builder>.qcard");
    const list = cards.map((c, idx) => {
      const no = idx + 1;
      const type = c.querySelector(`input[name="type-${no}"]:checked`).value;
      const text = c.querySelector(".qtext").value.trim();
      const img  = c.dataset.img || "";
      if (!text) return null;

      if (type === "mcq") {
        const opts = $$(".opt", c).map(i => i.value.trim()).filter(Boolean);
        const ans  = Math.max(0, Math.min(opts.length - 1, (parseInt(c.querySelector(".ansIndex").value, 10) || 1) - 1));
        return { type: "mcq", text, options: opts, answerIndex: ans, image: img };
      } else {
        return { type: "short", text, answerText: c.querySelector(".ansText").value.trim(), image: img };
      }
    }).filter(Boolean);
    return { title: els.quizTitle?.value || "퀴즈", questions: list };
  }

  // ---- 옵션 저장 & QR ------------------------------------------------------
  async function saveOptions() {
    if (!roomId) return alert("세션 접속 후 저장하세요.");
    const options = {
      deviceOnce: !!els.chkDeviceOnce?.checked,
      nameOnce:   !!els.chkNameOnce?.checked,
      bright:     !!els.chkBright?.checked,
      timerSec:   Math.max(5, Math.min(600, parseInt(els.timerSec?.value, 10) || 30))
    };
    await setDoc(roomRef(roomId), {
      options, accept: !!els.chkAccept?.checked, reveal: !!els.chkReveal?.checked
    }, { merge: true });

    buildStudentLink(true); // 저장 직후 즉시 링크/QR 갱신
    alert("저장 완료!");
  }

  function buildStudentLink(force = false) {
    if (!els.studentLink) return;
    const url = new URL(location.href);
    url.searchParams.set("role", "student");
    url.searchParams.set("room", roomId || (els.roomId?.value || "").trim());
    els.studentLink.value = url.toString();

    if (force && window.QRCode && els.qrCanvas) {
      // QR 크기는 요구사항에 맞춰 살짝 더 작게(140px 안쪽)
      QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width: 140 }, (err) => {
        if (err) console.warn("[QR] draw failed", err);
      });
    }
  }

  // ---- 진행 & 타이머 -------------------------------------------------------
  async function startQuiz() {
    if (!roomId) return alert("세션부터 접속하세요.");
    await updateDoc(roomRef(roomId), { mode: "active", currentIndex: 0, accept: true });
  }
  async function step(delta) {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef(roomId));
      const r = snap.data(); const total = (r.questions?.length || 0);
      let next = (r.currentIndex ?? -1) + delta;

      if (next >= total) {
        // 끝이면 자동 종료 → 결과 탭으로
        tx.update(roomRef(roomId), { mode: "ended", accept: false, currentIndex: total - 1 });
        showTab("results");
        return;
      }
      next = Math.max(0, next);
      tx.update(roomRef(roomId), { currentIndex: next, accept: true });
    });
  }
  async function finishAll() { if (confirm("퀴즈를 종료할까요?")) await updateDoc(roomRef(roomId), { mode: "ended", accept: false }); }

  function startTimer(sec) {
    stopTimer();
    const end = Date.now() + sec * 1000;
    timerHandle = setInterval(async () => {
      const remain = Math.max(0, Math.floor((end - Date.now()) / 1000));
      els.leftSec && (els.leftSec.textContent = `${pad(Math.floor(remain / 60))}:${pad(remain % 60)}`);
      if (remain <= 0) {
        stopTimer();
        await updateDoc(roomRef(roomId), { accept: false });
        setTimeout(() => step(+1), 500);
      }
    }, 250);
  }
  function stopTimer() { if (timerHandle) { clearInterval(timerHandle); timerHandle = null; } els.leftSec && (els.leftSec.textContent = "00:00"); }

  // ---- 학생 화면(동적) -----------------------------------------------------
  function buildStudentShell() {
    if ($("#sWrap")) return; // 이미 있음
    const wrap = document.createElement("div");
    wrap.id = "sWrap";
    wrap.className = "panel";
    wrap.innerHTML = `
      <div id="sDialog" class="card hint"></div>
      <div id="sCard" class="card">
        <div class="row between"><strong id="sTitle">-</strong><span class="muted" id="sState">대기</span></div>
        <div id="sQTitle" class="mt"></div>
        <img id="sQImg" class="hide" style="max-width:100%;border-radius:12px;margin:8px 0;" alt="">
        <div id="sOptBox" class="mt"></div>
        <div id="sShortWrap" class="row mt hide">
          <input id="sShort" class="input grow" placeholder="정답 입력">
          <button id="sShortBtn" class="btn success">제출</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    // 참가 모달
    const dlg = $("#sDialog");
    dlg.innerHTML = `
      <div class="row wrap">
        <input id="joinName" class="input grow" placeholder="이름 혹은 번호를 입력하세요!" />
        <button id="btnJoinGo" class="btn primary">참가</button>
      </div>
      <p class="muted mt">참가가 완료되면 "제출 버튼을 눌러주세요." 안내가 보이고, 교사가 시작하면 1번 문항이 표시됩니다.</p>
    `;

    $("#btnJoinGo")?.addEventListener("click", join);
  }

  async function join() {
    const name = ($("#joinName")?.value || "").trim();
    if (!name) return alert("이름을 입력하세요.");
    me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2, 10), name };
    localStorage.setItem("quiz.device", me.id);
    saveLocal();
    if (!roomId) return alert("세션 코드가 없습니다. 학생 링크를 통해 접속하세요.");

    await setDoc(doc(respCol(roomId), me.id), { name, joinedAt: serverTimestamp(), answers: {}, alive: true }, { merge: true });
    // 대기 안내
    const sState = $("#sState"), sQTitle = $("#sQTitle"), sOptBox = $("#sOptBox"), sShortWrap = $("#sShortWrap"), img = $("#sQImg");
    $("#sDialog") && ($("#sDialog").innerHTML = `<strong>참가 완료!</strong> 제출 버튼을 눌러주세요. 교사가 시작하면 1번 문항이 표시됩니다.`);
    sState && (sState.textContent = "대기");
    sQTitle && (sQTitle.textContent = "대기 중…");
    sOptBox && (sOptBox.innerHTML = "");
    sShortWrap && sShortWrap.classList.add("hide");
    img && img.classList.add("hide");
  }

  async function submitAnswer(value) {
    const r = window.__room; if (!r?.accept) return alert("지금은 제출할 수 없습니다.");
    const idx = r.currentIndex; const q = r.questions?.[idx]; if (!q) return;

    const ref = doc(respCol(roomId), me.id);
    const snap = await getDoc(ref);
    const prev = snap.exists() ? (snap.data().answers || {}) : {};
    if (prev[idx] != null) return alert("이미 제출했습니다."); // 중복 제출 방지

    let correct = null;
    if (q.type === "mcq" && typeof value === "number") correct = (value === (q.answerIndex ?? -1));
    if (q.type === "short" && typeof value === "string") {
      const norm = s => String(s).trim().toLowerCase();
      if (q.answerText) correct = (norm(value) === norm(q.answerText));
    }
    await setDoc(ref, { name: me.name, [`answers.${idx}`]: { value, correct: (correct === true), revealed: !!r.reveal } }, { merge: true });
  }

  // ---- 렌더링 --------------------------------------------------------------
  function renderRoom(r) {
    // 옵션 반영(밝은 모드)
    document.body.classList.toggle("bright", !!r.options?.bright);

    // 진행/타이머
    const sec = Math.max(5, parseInt(r.options?.timerSec || 0, 10) || 0);
    if (timerHandle == null && sec && r.accept) startTimer(sec);

    // 프레젠테이션
    if (els.pTitle) els.pTitle.textContent = r.title || roomId;
    if (els.nowQuestion) els.nowQuestion.textContent = (r.currentIndex >= 0 && r.questions?.[r.currentIndex]) ? r.questions[r.currentIndex].text : "-";

    if (els.pQ && els.pOpts) {
      els.pOpts.innerHTML = "";
      if (r.mode !== "active" || r.currentIndex < 0 || !r.questions?.[r.currentIndex]) {
        els.pQ.textContent = "시작 버튼을 누르면 문항이 제시됩니다.";
        els.pImg && els.pImg.classList.add("hide");  // 이미지 없는 경우 깨짐 방지
      } else {
        const q = r.questions[r.currentIndex];
        els.pQ.textContent = q.text;
        if (els.pImg) {
          if (q.image) { els.pImg.src = q.image; els.pImg.classList.remove("hide"); }
          else { els.pImg.classList.add("hide"); }
        }
        if (q.type === "mcq") {
          q.options.forEach((t, i) => {
            const d = document.createElement("div"); d.className = "popt"; d.textContent = `${i + 1}. ${t}`; els.pOpts.appendChild(d);
          });
        }
      }
    }

    // 학생 화면
    if (MODE === "student") {
      $("#sTitle") && ($("#sTitle").textContent = r.title || roomId);
      if (r.mode !== "active" || r.currentIndex < 0 || !r.questions?.[r.currentIndex]) {
        $("#sState") && ($("#sState").textContent = "대기");
        $("#sQTitle") && ($("#sQTitle").textContent = "시작을 기다리는 중…");
        $("#sOptBox") && ($("#sOptBox").innerHTML = "");
        $("#sShortWrap") && $("#sShortWrap").classList.add("hide");
        $("#sQImg") && $("#sQImg").classList.add("hide");
      } else {
        const q = r.questions[r.currentIndex];
        $("#sState") && ($("#sState").textContent = r.accept ? "제출 가능" : "대기");
        $("#sQTitle") && ($("#sQTitle").textContent = q.text);

        const img = $("#sQImg");
        if (img) {
          if (q.image) { img.src = q.image; img.classList.remove("hide"); }
          else { img.classList.add("hide"); }
        }

        const box = $("#sOptBox");
        if (box) {
          box.innerHTML = "";
          if (q.type === "mcq") {
            $("#sShortWrap") && $("#sShortWrap").classList.add("hide");
            q.options.forEach((opt, i) => {
              const b = document.createElement("button");
              b.className = "btn";
              b.textContent = `${i + 1}. ${opt}`;
              b.disabled = !r.accept;
              b.onclick = () => submitAnswer(i);
              box.appendChild(b);
            });
            // 하단 제출 버튼 중복 방지: 없음(보기 선택이 제출)
          } else {
            $("#sShortWrap") && $("#sShortWrap").classList.remove("hide");
            $("#sShortBtn") && ($("#sShortBtn").disabled = !r.accept);
            $("#sShortBtn")?.addEventListener("click", () => {
              const v = ($("#sShort")?.value || "").trim();
              submitAnswer(v);
            }, { once: true }); // 동일 문항 중복 제출 방지
          }
        }
      }

      // 종료 안내
      if (r.mode === "ended") {
        const dlg = $("#sDialog");
        if (dlg) {
          dlg.innerHTML = `<strong>퀴즈가 종료되었습니다!</strong> <button id="btnMyResult" class="btn">내 결과 보기</button>`;
          $("#btnMyResult")?.addEventListener("click", () => showMyResult());
        }
      }
    }
  }

  function renderResponses(list) {
    // 칩(프레젠테이션 하단) — 존재하면 갱신
    if (els.chipJoin)   els.chipJoin.textContent   = list.length;
    if (els.chipSubmit || els.chipCorrect || els.chipWrong) {
      const r = window.__room || {}; const idx = r.currentIndex;
      let s = 0, ok = 0, no = 0;
      list.forEach(u => {
        const a = u.answers?.[idx];
        if (!a) return;
        s++;
        if (a.correct) ok++; else no++;
      });
      els.chipSubmit && (els.chipSubmit.textContent = s);
      els.chipCorrect && (els.chipCorrect.textContent = ok);
      els.chipWrong && (els.chipWrong.textContent = no);
    }

    // 결과표(관리자)
    if (els.resultsTable) {
      const r = window.__room || {};
      const tbl = document.createElement("table");
      const thead = document.createElement("thead"), tr = document.createElement("tr");
      ["이름", ...(r.questions || []).map((_, i) => `Q${i + 1}`), "점수"].forEach(h => {
        const th = document.createElement("th"); th.textContent = h; tr.appendChild(th);
      });
      thead.appendChild(tr); tbl.appendChild(thead);

      const tb = document.createElement("tbody");
      list.forEach(s => {
        let score = 0;
        const tr = document.createElement("tr");
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
      els.resultsTable.innerHTML = ""; els.resultsTable.appendChild(tbl);
    }

    // 리더보드(점수순)
    if (els.leaderboard) {
      const r = window.__room || {};
      const ranked = list.map(s => {
        let score = 0;
        (r.questions || []).forEach((q, i) => { if (s.answers?.[i]?.correct) score++; });
        return { name: s.name || s.id, score };
      }).sort((a, b) => b.score - a.score);

      els.leaderboard.innerHTML = ranked.map((u, i) => `<div class="row between"><span>${i + 1}. ${u.name}</span><strong>${u.score}</strong></div>`).join("");
    }
  }

  async function showMyResult() {
    const r = window.__room || {};
    const snap = await getDoc(doc(respCol(roomId), me.id));
    const s = snap.exists() ? snap.data() : { answers: {} };
    let score = 0;
    const rows = (r.questions || []).map((q, i) => {
      const a = s.answers?.[i]; if (a?.correct) score++;
      return `<tr><td>${i + 1}</td><td>${a ? (q.type === "mcq" ? (typeof a.value === "number" ? a.value + 1 : "-") : (a.value ?? "-")) : "-"}</td><td>${a?.correct ? "O" : "×"}</td></tr>`;
    }).join("");
    alert(`내 점수: ${score}\n\n${rows.replace(/<[^>]+>/g, " ")}`);
  }

  // ---- 이벤트 바인딩 -------------------------------------------------------
  els.btnConnect?.addEventListener("click", connect);
  els.btnSignOut?.addEventListener("click", signOut);

  els.tabBuild?.addEventListener("click", () => showTab("build"));
  els.tabOptions?.addEventListener("click", () => showTab("options"));
  els.tabPresent?.addEventListener("click", () => showTab("present"));
  els.tabResults?.addEventListener("click", () => showTab("results"));

  els.btnBuildForm?.addEventListener("click", () => {
    const n = Math.max(1, Math.min(50, parseInt(els.questionCount?.value, 10) || 3));
    if (els.builder) { els.builder.innerHTML = ""; for (let i = 0; i < n; i++) els.builder.appendChild(cardRow(i + 1)); }
  });
  els.btnLoadSample?.addEventListener("click", () => {
    const S = [
      { type: "mcq", text: "가장 큰 행성은?", options: ["지구", "목성", "화성", "금성"], answerIndex: 1 },
      { type: "short", text: "물의 끓는점(°C)?", answerText: "100" },
      { type: "mcq", text: "태양계 별명?", options: ["Milky", "Solar", "Sunset", "Lunar"], answerIndex: 1 }
    ];
    if (els.builder) { els.builder.innerHTML = ""; S.forEach((q, i) => els.builder.appendChild(cardRow(i + 1, q))); }
    if (els.quizTitle) els.quizTitle.value = "샘플 퀴즈";
    if (els.questionCount) els.questionCount.value = S.length;
  });
  els.btnSaveQuiz?.addEventListener("click", async () => {
    if (!roomId) return alert("세션 접속 후 저장하세요.");
    const payload = collectBuilder();
    await setDoc(roomRef(roomId), { title: payload.title, questions: payload.questions }, { merge: true });
    alert("저장 완료!");
  });

  els.btnOptSave?.addEventListener("click", saveOptions);
  els.btnCopyLink?.addEventListener("click", async () => {
    if (!els.studentLink) return;
    await navigator.clipboard.writeText(els.studentLink.value);
    els.btnCopyLink.textContent = "복사됨"; setTimeout(() => els.btnCopyLink.textContent = "복사", 1000);
  });
  els.btnOpenStudent?.addEventListener("click", () => window.open(els.studentLink?.value || "#", "_blank"));

  els.btnStart?.addEventListener("click", startQuiz);
  els.btnPrev?.addEventListener("click", () => step(-1));
  els.btnNext?.addEventListener("click", () => step(+1));
  els.btnEndAll?.addEventListener("click", finishAll);

  els.btnExportCSV?.addEventListener("click", async () => {
    if (!roomId) return;
    const r = (await getDoc(roomRef(roomId))).data();
    const snap = await getDocs(respCol(roomId));
    const rows = [];
    rows.push(["userId", "name", ...(r.questions || []).map((_, i) => `Q${i + 1}`), "score"].join(","));
    snap.forEach(d => {
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
  });

  els.btnResetAll?.addEventListener("click", async () => {
    if (!roomId) return;
    if (!confirm("문항/설정/결과를 모두 초기화하고 처음 상태로 되돌릴까요?")) return;
    await deleteRoomAll();
    alert("초기화 완료(세션은 유지됩니다).");
  });

  // ---- 부팅 ---------------------------------------------------------------
  function autoReconnect() {
    loadLocal();
    // URL 파라미터 우선: ?role=student&room=class1
    const url = new URL(location.href);
    const role = url.searchParams.get("role");
    const rid  = url.searchParams.get("room");
    if (role === "student") MODE = "student";
    if (rid) { roomId = rid; els.roomId && (els.roomId.value = rid); }

    setMode(MODE);
    if (roomId && MODE === "admin") connect();
    if (roomId && MODE === "student") { listenRoom(roomId); listenResponses(roomId); buildStudentShell(); }
    buildStudentLink(true);
  }

  autoReconnect();
})();
