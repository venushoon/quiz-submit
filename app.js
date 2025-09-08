/* app.js — non-module 환경에서도 동작하도록 Firestore 함수는 동적 import 사용 */
(() => {
  const $  = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  // ----- 전역 상태 -----
  let MODE = "admin";         // 'admin' | 'student'
  let roomId = "";
  let me = { id: null, name: "" };
  let unsubRoom = null, unsubResp = null;
  let timerTick = null;

  // index.html에서 window.db를 만들어 둡니다(여기서 다시 init하지 않음).
  // <script type="module"> ... window.db = getFirestore(app) ... </script>   [oai_citation:3‡index (1).html](file-service://file-7L6cdB5CgUu4juiRT7CYTT)
  const getDB = () => {
    if (!window.db) {
      console.error("Firestore(db)가 초기화되지 않았습니다. index.html 상단 스크립트를 확인하세요.");
    }
    return window.db;
  };

  // Firestore helper들: 동적 import (모듈/비모듈 모두 안전)
  let FS = null;
  async function useFS() {
    if (!FS) {
      FS = await import("https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js");
    }
    return FS;
  }

  // ----- 엘리먼트 캐시 -----
  const els = {
    // topbar
    roomId: $("#roomId"),
    btnConnect: $("#btnConnect"),
    btnSignOut: $("#btnSignOut"),
    roomStatus: $("#roomStatus"),
    tabs: {
      build:   $("#tabBuild"),
      options: $("#tabOptions"),
      present: $("#tabPresent"),
      results: $("#tabResults"),
    },
    // panels
    pBuild:   $("#panelBuild"),
    pOptions: $("#panelOptions"),
    pPresent: $("#panelPresent"),
    pResults: $("#panelResults"),

    // build
    quizTitle: $("#quizTitle"),
    questionCount: $("#questionCount"),
    btnBuildForm: $("#btnBuildForm"),
    btnLoadSample: $("#btnLoadSample"),
    btnSaveQuiz: $("#btnSaveQuiz"),
    builder: $("#builder"),
    fileUploadTxt: $("#fileUploadTxt"),
    btnUploadTxt: $("#btnUploadTxt"),
    btnDownloadTemplate: $("#btnDownloadTemplate"),

    // options
    policyDevice: $("#policyDevice"),
    policyName:   $("#policyName"),
    chkAccept:    $("#chkAccept"),
    chkReveal:    $("#chkReveal"),
    bright:       $("#brightMode"),
    timerSec:     $("#timerSec"),
    btnOptionsSave: $("#btnOptionsSave"),
    btnResetAll:    $("#btnResetAll"),

    // QR
    qrCanvas: $("#qrCanvas"),
    studentLink: $("#studentLink"),
    btnCopyLink: $("#btnCopyLink"),
    btnOpenStudent: $("#btnOpenStudent"),

    // present (관리자)
    btnStart: $("#btnStart"),
    btnPrev:  $("#btnPrev"),
    btnNext:  $("#btnNext"),
    btnEnd:   $("#btnEnd"),
    statJoin:  $("#statJoin"),
    statSubmit:$("#statSubmit"),
    statOk:    $("#statOk"),
    statNo:    $("#statNo"),
    presentTitle: $("#presentTitle"),
    presentQ:     $("#presentQ"),
    presentImg:   $("#presentImg"),
    presentOpts:  $("#presentOpts"),
    presentTimer: $("#presentTimer"),
    presentNotice:$("#presentNotice"),

    // results
    leaderboard: $("#leaderboard"),
    btnExportCSV: $("#btnExportCSV"),

    // student 전용
    sWrap:         $("#studentWrap"),
    sDialog:       $("#studentDialog"),
    sNameInput:    $("#studentName"),
    sJoinBtn:      $("#btnJoin"),
    sState:        $("#studentState"),
    sQTitle:       $("#sQTitle"),
    sQText:        $("#sQText"),
    sQImg:         $("#sQImg"),
    sOptBox:       $("#sOptBox"),
    sShortWrap:    $("#sShortWrap"),
    sShortInput:   $("#sShortInput"),
    sShortSend:    $("#sShortSend"),
    sTimer:        $("#sTimer"),
    sResultWrap:   $("#sResultWrap"),
    sResultTbody:  $("#sResultTbody"),
    sResultBack:   $("#sResultBack"),
  };

  // 안전 가드: null 엘리먼트가 있어도 죽지 않도록.
  Object.keys(els).forEach(k => {
    const v = els[k];
    if (!v && k !== "tabs") console.warn("[warn] element missing:", k);
  });

  // ----- 유틸 -----
  const pad = n => String(n).padStart(2, "0");
  const urlWith = (params) => {
    const url = new URL(location.href);
    Object.entries(params).forEach(([k, v]) => {
      if (v == null) url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    });
    return url.toString();
  };
  const saveLocal = () => localStorage.setItem("quiz.live", JSON.stringify({ roomId, me, MODE }));
  const loadLocal = () => {
    try {
      const d = JSON.parse(localStorage.getItem("quiz.live") || "{}");
      roomId = d.roomId || "";
      me = d.me || { id: null, name: "" };
      MODE = d.MODE || "admin";
      if (els.roomId && roomId) els.roomId.value = roomId;
    } catch {}
  };

  // ----- Firestore refs -----
  const roomRef = async (id) => {
    const { doc } = await useFS();
    return doc(getDB(), "rooms", id);
  };
  const respCol = async (id) => {
    const { collection } = await useFS();
    return collection(getDB(), "rooms", id, "responses");
  };

  // ----- 모드 전환 -----
  function setMode(m) {
    MODE = m;
    // 관리자 전용 UI 숨김/표시
    $$(".admin-only").forEach(el => el.classList.toggle("hide", m !== "admin"));
    // 패널 기본: 관리자면 문항 탭, 학생이면 학생 뷰
    if (m === "admin") {
      showTab("build");
    } else {
      // 학생: 상단 관리자 탭/세션 입력 가림 + 학생 전용 래퍼만 표시
      if (els.sWrap) els.sWrap.classList.remove("hide");
      showTab(null); // 모두 숨김
    }
    saveLocal();
  }

  function showTab(which) {
    const table = { build: els.pBuild, options: els.pOptions, present: els.pPresent, results: els.pResults };
    Object.values(table).forEach(p => p && p.classList.add("hide"));
    Object.keys(els.tabs).forEach(k => els.tabs[k] && els.tabs[k].classList.remove("active"));
    if (which && table[which]) {
      table[which].classList.remove("hide");
      els.tabs[which]?.classList.add("active");
    }
  }

  // ----- 접속 / 세션아웃 / 자동복구 -----
  async function ensureRoom(id) {
    const { getDoc, setDoc, serverTimestamp } = await useFS();
    const ref = await roomRef(id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        title: "새 퀴즈",
        createdAt: serverTimestamp(),
        mode: "idle",
        currentIndex: -1,
        accept: false,
        reveal: false,
        policy: { deviceOnce: true, nameOnce: false },
        bright: false,
        timerSec: 30,
        questions: []
      });
    }
  }

  async function connectRoom() {
    const id = (els.roomId?.value || "").trim();
    if (!id) return alert("세션 코드를 입력하세요.");
    roomId = id;
    els.roomId.disabled = true;
    els.btnConnect?.classList.add("hide");
    els.btnSignOut?.classList.remove("hide");
    els.roomStatus && (els.roomStatus.textContent = `세션: ${roomId} · 온라인`);
    saveLocal();

    await ensureRoom(roomId);
    listenRoom();
    listenResponses();
    refreshStudentLink(); // 접속 직후 링크/QR 생성
  }

  async function signOutRoom() {
    // 단순 UI 리셋
    roomId = "";
    els.roomId.disabled = false;
    els.btnSignOut?.classList.add("hide");
    els.btnConnect?.classList.remove("hide");
    els.roomStatus && (els.roomStatus.textContent = `세션: - · 오프라인`);
    if (unsubRoom) unsubRoom();
    if (unsubResp) unsubResp();
    saveLocal();
  }

  function autoReconnect() {
    loadLocal();
    const url = new URL(location.href);
    const role = url.searchParams.get("role");
    const rid  = url.searchParams.get("room");
    if (role === "student") setMode("student"); else setMode(MODE);

    if (rid) { roomId = rid; if (els.roomId) els.roomId.value = rid; }
    if (roomId) connectRoom();
    else {
      // 학생 링크로 처음 들어온 경우: 이름 팝업 띄워 대기 화면
      if (MODE === "student") {
        showStudentJoinDialog();
        renderStudentWaiting();
      }
    }
  }

  // ----- 실시간 구독 -----
  async function listenRoom() {
    const { onSnapshot } = await useFS();
    if (unsubRoom) unsubRoom();
    const ref = await roomRef(roomId);
    unsubRoom = onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      const r = snap.data();
      window.__room = r;
      renderRoom(r);
    });
  }

  async function listenResponses() {
    const { onSnapshot, query, orderBy } = await useFS();
    if (unsubResp) unsubResp();
    const col = await respCol(roomId);
    unsubResp = onSnapshot(query(col, orderBy("joinedAt", "asc")), (qs) => {
      const list = [];
      qs.forEach(d => list.push({ id: d.id, ...d.data() }));
      window.__responses = list;
      renderResponses(list);
    });
  }

  // ----- UI: 룸/옵션/프레젠테이션/학생/결과 렌더 -----
  function renderRoom(r) {
    // 프레젠테이션 알림/타이틀
    if (els.presentTitle) els.presentTitle.textContent = r.title || roomId;

    // 옵션 체크박스/타이머 표시 동기화(관리자)
    if (MODE === "admin") {
      if (els.chkAccept) els.chkAccept.checked = !!r.accept;
      if (els.chkReveal) els.chkReveal.checked = !!r.reveal;
      if (els.bright)    els.bright.checked    = !!r.bright;
      if (els.timerSec && r.timerSec) els.timerSec.value = r.timerSec;
    }

    // 프레젠테이션(관리자) 안내
    if (MODE === "admin" && els.presentNotice) {
      if (r.mode !== "active" || r.currentIndex < 0) {
        els.presentNotice.textContent = "시작 버튼을 누르면 문항이 제시됩니다.";
        els.presentQ && (els.presentQ.textContent = "-");
        els.presentOpts && (els.presentOpts.innerHTML = "");
        if (els.presentImg) { els.presentImg.src = ""; els.presentImg.classList.add("hide"); }
      } else {
        els.presentNotice.textContent = "";
        renderPresentQuestion(r);
      }
    }

    // 학생 화면
    if (MODE === "student") {
      if (r.mode !== "active" || r.currentIndex < 0) {
        renderStudentWaiting();
      } else {
        renderStudentQuestion(r);
      }
    }

    // 통계 타일
    renderStats();

    // 링크/QR은 세션이 확정되면 노출·갱신
    refreshStudentLink();
  }

  function renderPresentQuestion(r) {
    const idx = r.currentIndex;
    const q = r.questions?.[idx];
    if (!q) return;

    els.presentQ && (els.presentQ.textContent = q.text || "-");

    // 이미지: 없으면 숨김
    if (els.presentImg) {
      if (q.image) { els.presentImg.src = q.image; els.presentImg.classList.remove("hide"); }
      else { els.presentImg.src = ""; els.presentImg.classList.add("hide"); }
    }

    if (els.presentOpts) {
      els.presentOpts.innerHTML = "";
      if (q.type === "mcq") {
        q.options.forEach((t, i) => {
          const d = document.createElement("div");
          d.className = "popt";
          d.textContent = `${i + 1}. ${t}`;
          els.presentOpts.appendChild(d);
        });
      }
    }
  }

  function renderStats() {
    if (!window.__responses || !window.__room) return;
    const r = window.__room;
    const idx = r.currentIndex;
    let join = 0, submit = 0, ok = 0, no = 0;
    window.__responses.forEach(s => {
      join++;
      const a = s.answers?.[idx];
      if (a) {
        submit++;
        if (a.correct) ok++;
        else no++;
      }
    });
    if (els.statJoin)   els.statJoin.textContent   = join;
    if (els.statSubmit) els.statSubmit.textContent = submit;
    if (els.statOk)     els.statOk.textContent     = ok;
    if (els.statNo)     els.statNo.textContent     = no;
  }

  function renderResponses(list) {
    // 리더보드(관리자)
    if (!els.leaderboard || !window.__room) return;
    const r = window.__room;
    const tb = els.leaderboard.tBodies[0];
    tb.innerHTML = "";
    const rows = list.map(s => {
      let score = 0;
      (r.questions || []).forEach((q, i) => { if (s.answers?.[i]?.correct) score++; });
      return { name: s.name || s.id, score };
    }).sort((a, b) => b.score - a.score);
    rows.forEach((row, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${i + 1}</td><td>${row.name}</td><td>${row.score}</td>`;
      tb.appendChild(tr);
    });
  }

  function renderStudentWaiting() {
    if (!els.sWrap) return;
    els.sState && (els.sState.textContent = "참가 완료! 제출 버튼을 눌러주세요. 교사가 시작하면 1번 문항이 표시됩니다.");
    toggleStudentQuestion(false);
  }

  function renderStudentQuestion(r) {
    const idx = r.currentIndex;
    const q = r.questions?.[idx];
    if (!q) return renderStudentWaiting();

    // 상단 상태
    els.sQTitle && (els.sQTitle.textContent = r.title || "");
    els.sQText  && (els.sQText.textContent  = q.text || "");

    // 이미지
    if (els.sQImg) {
      if (q.image) { els.sQImg.src = q.image; els.sQImg.classList.remove("hide"); }
      else { els.sQImg.src = ""; els.sQImg.classList.add("hide"); }
    }

    // 객관식 / 주관식
    if (q.type === "mcq") {
      els.sShortWrap?.classList.add("hide");
      if (els.sOptBox) {
        els.sOptBox.innerHTML = "";
        q.options.forEach((t, i) => {
          const b = document.createElement("button");
          b.className = "optbtn";
          b.textContent = `${i + 1}. ${t}`;
          b.disabled = !r.accept;
          b.onclick = () => submitAnswer(i);
          els.sOptBox.appendChild(b);
        });
      }
    } else {
      if (els.sOptBox) els.sOptBox.innerHTML = "";
      els.sShortWrap?.classList.remove("hide");
      if (els.sShortSend) els.sShortSend.disabled = !r.accept;
    }
    toggleStudentQuestion(true);
  }

  function toggleStudentQuestion(show) {
    if (!els.sWrap) return;
    // 래이아웃을 유지하되, 문항 블록 보이기/감추기
    const qArea = $("#studentQA");
    if (qArea) qArea.classList.toggle("hide", !show);
  }

  // ----- 링크/QR -----
  function refreshStudentLink() {
    if (!roomId || !els.studentLink) return;
    const link = urlWith({ role: "student", room: roomId });
    els.studentLink.value = link;

    const QR = window.QRCode;
    if (QR && els.qrCanvas) {
      try {
        QR.toCanvas(els.qrCanvas, link, { width: 140 }, (err) => err && console.warn(err));
      } catch (e) { console.warn("QR draw failed", e); }
    }
  }

  // ----- 빌더: 카드 생성/수집 -----
  function qCard(no, q = {}) {
    const wrap = document.createElement("div");
    wrap.className = "qcard";
    wrap.innerHTML = `
      <div class="row wrap">
        <span class="badge">${no}번</span>
        <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${q.type==='short'?'':'checked'} /><span>객관식</span></label>
        <label class="switch"><input type="radio" name="type-${no}" value="short" ${q.type==='short'?'checked':''} /><span>주관식</span></label>
        <label class="btn ghost right"><input type="file" class="hide imgInp" accept="image/*" />이미지</label>
      </div>
      <input class="qtext input" data-no="${no}" placeholder="문항 내용" value="${q.text||''}">
      <div class="mcq ${q.type==='short'?'hide':''}">
        <div class="row wrap">
          ${(q.options || ['','','','']).map((v,i)=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기 ${i+1}" value="${v}">`).join('')}
        </div>
        <div class="row"><span class="hint">정답 번호</span><input class="ansIndex input sm" data-no="${no}" type="number" min="1" max="10" value="${(q.answerIndex??0)+1}"></div>
      </div>
      <div class="short ${q.type==='short'?'':'hide'}">
        <input class="ansText input" data-no="${no}" placeholder="정답(선택, 자동채점용)" value="${q.answerText||''}">
      </div>
    `;
    // 타입 토글
    const radios = $$(`input[name="type-${no}"]`, wrap);
    const mcq = $(".mcq", wrap), short = $(".short", wrap);
    radios.forEach(r => r.addEventListener("change", () => {
      const isShort = radios.find(x => x.checked)?.value === "short";
      mcq.classList.toggle("hide", isShort);
      short.classList.toggle("hide", !isShort);
    }));
    // 이미지 업로드(데이터 URL 저장)
    const imgInp = $(".imgInp", wrap);
    imgInp.addEventListener("change", e => {
      const f = e.target.files?.[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { wrap.dataset.image = rd.result; };
      rd.readAsDataURL(f);
    });
    return wrap;
  }

  function collectBuilder() {
    if (!els.builder) return { title: "퀴즈", questions: [] };
    const cards = $$(".qcard", els.builder);
    const list = cards.map((c, i) => {
      const no = i + 1;
      const type = c.querySelector(`input[name="type-${no}"]:checked`).value;
      const text = c.querySelector(".qtext").value.trim();
      const image = c.dataset.image || null;
      if (!text) return null;
      if (type === "mcq") {
        const opts = $$(".opt", c).map(i => i.value.trim()).filter(Boolean);
        const ans = Math.max(0, Math.min(opts.length - 1, (parseInt(c.querySelector(".ansIndex").value, 10) || 1) - 1));
        return { type: "mcq", text, options: opts, answerIndex: ans, image };
      } else {
        return { type: "short", text, answerText: c.querySelector(".ansText").value.trim(), image };
      }
    }).filter(Boolean);
    return { title: els.quizTitle?.value || "퀴즈", questions: list };
  }

  // ----- 제출/채점 -----
  async function joinStudent() {
    const name = (els.sNameInput?.value || "").trim();
    if (!name) return alert("이름(번호)을 입력하세요.");
    const dev = localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2, 10);
    localStorage.setItem("quiz.device", dev);
    me = { id: dev, name };
    saveLocal();

    const { setDoc, serverTimestamp, doc } = await useFS();
    const col = await respCol(roomId);
    await setDoc(doc(col, me.id), { name, joinedAt: serverTimestamp(), answers: {}, alive: true }, { merge: true });

    hideStudentJoinDialog();
    renderStudentWaiting();
  }

  async function submitAnswer(value) {
    const r = window.__room; if (!r?.accept) return alert("지금은 제출할 수 없습니다.");
    const idx = r.currentIndex; const q = r.questions?.[idx]; if (!q) return;
    const { getDoc, setDoc, doc } = await useFS();
    const col = await respCol(roomId);
    const ref = doc(col, me.id);
    const snap = await getDoc(ref);
    const prev = snap.exists() ? (snap.data().answers || {}) : {};
    if (prev[idx] != null) return alert("이미 제출했습니다.");

    let correct = null;
    if (q.type === "mcq" && typeof value === "number") correct = (value === (q.answerIndex ?? -1));
    if (q.type === "short" && typeof value === "string") {
      const norm = s => String(s).trim().toLowerCase();
      if (q.answerText) correct = (norm(value) === norm(q.answerText));
    }
    await setDoc(ref, { name: me.name, [`answers.${idx}`]: { value, correct: (correct === true), revealed: !!r.reveal } }, { merge: true });
    alert("제출 완료!");
  }

  // ----- 관리자 액션 -----
  async function saveOptions() {
    const { updateDoc } = await useFS();
    const ref = await roomRef(roomId);
    const policy = { deviceOnce: !!els.policyDevice?.checked, nameOnce: !!els.policyName?.checked };
    const bright = !!els.bright?.checked;
    const timerSec = Math.max(5, Math.min(600, parseInt(els.timerSec?.value, 10) || 30));
    await updateDoc(ref, { policy, bright, timerSec });
    refreshStudentLink();
    alert("저장했습니다.");
  }

  async function startQuiz() {
    const { updateDoc } = await useFS();
    const ref = await roomRef(roomId);
    await updateDoc(ref, { mode: "active", currentIndex: 0, accept: true });
  }
  async function step(delta) {
    const { runTransaction } = await useFS();
    const db = getDB(); const ref = await roomRef(roomId);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref); const r = snap.data();
      const total = r.questions?.length || 0;
      let next = (r.currentIndex ?? -1) + delta;
      if (next >= total) {
        tx.update(ref, { currentIndex: total - 1, mode: "ended", accept: false });
      } else {
        next = Math.max(0, next);
        tx.update(ref, { currentIndex: next, accept: true });
      }
    });
  }
  async function endQuiz() {
    const { updateDoc } = await useFS();
    const ref = await roomRef(roomId);
    await updateDoc(ref, { mode: "ended", accept: false });
  }

  // 완전 초기화
  async function resetAll() {
    if (!confirm("모든 문항/옵션/응답을 초기화할까요?")) return;
    const { setDoc, getDocs, doc } = await useFS();
    await setDoc(await roomRef(roomId), {
      mode: "idle", currentIndex: -1, accept: false, reveal: false,
      policy: { deviceOnce: true, nameOnce: false }, bright: false, timerSec: 30,
      questions: []
    }, { merge: true });

    const col = await respCol(roomId);
    const snap = await getDocs(col);
    const tasks = [];
    snap.forEach(d => tasks.push(setDoc(doc(col, d.id), { answers: {}, alive: true }, { merge: true })));
    await Promise.all(tasks);
    if (els.builder) els.builder.innerHTML = "";
    alert("초기화 완료");
  }

  // CSV 내보내기(관리자)
  async function exportCSV() {
    const { getDoc, getDocs } = await useFS();
    const r = (await getDoc(await roomRef(roomId))).data();
    const rs = await getDocs(await respCol(roomId));
    const rows = [];
    rows.push(["userId", "name", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "score"].join(","));
    rs.forEach(d => {
      const s = d.data(); let score = 0;
      const answers = (r.questions||[]).map((q,i)=> {
        const a = s.answers?.[i];
        if (a?.correct) score++;
        return q.type === "mcq" ? (typeof a?.value === "number" ? a.value+1 : "") : (a?.value ?? "");
      });
      rows.push([d.id, `"${(s.name||"").replace(/"/g,'""')}"`, ...answers, score].join(","));
    });
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${r.title||roomId}-results.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ----- 학생 팝업 -----
  function showStudentJoinDialog() {
    if (els.sDialog) els.sDialog.showModal?.();
  }
  function hideStudentJoinDialog() {
    if (els.sDialog) els.sDialog.close?.();
  }

  // ----- 타이머(표시만) -----
  function startTimerDisplay(sec) {
    stopTimerDisplay();
    const end = Date.now() + sec * 1000;
    timerTick = setInterval(() => {
      const remain = Math.max(0, Math.floor((end - Date.now()) / 1000));
      const mm = pad(Math.floor(remain/60)), ss = pad(remain % 60);
      if (els.presentTimer) els.presentTimer.textContent = `${mm}:${ss}`;
      if (els.sTimer) els.sTimer.textContent = `${mm}:${ss}`;
      if (remain <= 0) stopTimerDisplay();
    }, 200);
  }
  function stopTimerDisplay() {
    if (timerTick) clearInterval(timerTick), timerTick = null;
    if (els.presentTimer) els.presentTimer.textContent = "00:00";
    if (els.sTimer) els.sTimer.textContent = "00:00";
  }

  // ----- 이벤트 바인딩 -----
  els.btnConnect?.addEventListener("click", connectRoom);
  els.btnSignOut?.addEventListener("click", signOutRoom);

  els.tabs.build?.addEventListener("click", () => showTab("build"));
  els.tabs.options?.addEventListener("click", () => showTab("options"));
  els.tabs.present?.addEventListener("click", () => showTab("present"));
  els.tabs.results?.addEventListener("click", () => showTab("results"));

  // 빌더
  els.btnBuildForm?.addEventListener("click", () => {
    const n = Math.max(1, Math.min(50, parseInt(els.questionCount?.value, 10) || 3));
    if (els.builder) { els.builder.innerHTML = ""; for (let i=0;i<n;i++) els.builder.appendChild(qCard(i+1)); }
  });
  els.btnLoadSample?.addEventListener("click", () => {
    const S = [
      {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
      {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
      {type:'mcq', text:'태양계 별명?', options:['Milky','Solar','Sunset','Lunar'], answerIndex:1}
    ];
    if (els.builder) { els.builder.innerHTML = ""; S.forEach((q,i)=>els.builder.appendChild(qCard(i+1,q))); }
    if (els.quizTitle) els.quizTitle.value = "샘플 퀴즈";
    if (els.questionCount) els.questionCount.value = S.length;
  });
  els.btnSaveQuiz?.addEventListener("click", async () => {
    if (!roomId) return alert("세션에 먼저 접속하세요.");
    const payload = collectBuilder();
    const { setDoc } = await useFS();
    await setDoc(await roomRef(roomId), { title: payload.title, questions: payload.questions }, { merge: true });
    alert("저장 완료!");
  });

  // txt/csv 업로드(간단 파서)
  els.btnUploadTxt?.addEventListener("click", () => els.fileUploadTxt?.click());
  els.fileUploadTxt?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const txt = await f.text();
    const lines = txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const qs = [];
    lines.forEach((line, i) => {
      const parts = line.split(",").map(s => s.trim());
      if (parts.length >= 3 && parts[1] === "주관식") {
        const [text, , answerText] = parts;
        qs.push({ type:"short", text, answerText });
      } else if (parts.length >= 6) {
        const [text, a,b,c,d, ans] = parts;
        qs.push({ type:"mcq", text, options:[a,b,c,d].filter(Boolean), answerIndex: Math.max(0, (parseInt(ans,10)||1)-1) });
      }
    });
    if (els.builder) {
      els.builder.innerHTML = "";
      qs.forEach((q,i)=>els.builder.appendChild(qCard(i+1,q)));
      els.questionCount && (els.questionCount.value = qs.length);
    }
    alert(`총 ${qs.length}문항을 불러왔습니다.`);
    e.target.value = "";
  });
  els.btnDownloadTemplate?.addEventListener("click", () => {
    const sample = [
      "가장 큰 행성은?,지구,목성,화성,금성,2",
      "수도의 영문 철자는?,주관식,Seoul"
    ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([sample],{type:"text/plain"}));
    a.download = "quiz-template.txt";
    a.click(); URL.revokeObjectURL(a.href);
  });

  // 옵션/QR
  els.btnOptionsSave?.addEventListener("click", saveOptions);
  els.btnResetAll?.addEventListener("click", resetAll);
  els.btnCopyLink?.addEventListener("click", async () => {
    if (!els.studentLink?.value) return;
    await navigator.clipboard.writeText(els.studentLink.value);
    els.btnCopyLink.textContent = "복사됨"; setTimeout(()=> els.btnCopyLink.textContent="복사", 1200);
  });
  els.btnOpenStudent?.addEventListener("click", () => {
    if (els.studentLink?.value) window.open(els.studentLink.value, "_blank");
  });

  // 프레젠테이션(관리자)
  els.btnStart?.addEventListener("click", startQuiz);
  els.btnPrev?.addEventListener("click", () => step(-1));
  els.btnNext?.addEventListener("click", () => step(+1));
  els.btnEnd?.addEventListener("click", endQuiz);

  // 결과
  els.btnExportCSV?.addEventListener("click", exportCSV);

  // 학생
  els.sJoinBtn?.addEventListener("click", joinStudent);
  els.sShortSend?.addEventListener("click", () => submitAnswer((els.sShortInput?.value||"").trim()));
  els.sResultBack?.addEventListener("click", () => { els.sResultWrap?.classList.add("hide"); renderStudentWaiting(); });

  // 부팅
  autoReconnect();
})();
