(() => {
  // ---------- 안전 헬퍼 ----------
  const $  = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
  const pad = n => String(n).padStart(2,'0');

  // Firebase 래퍼 보장
  if (!window.FS || !window.db) {
    console.error("[firebase] not loaded. Ensure compat scripts are included in index.html");
    return;
  }

  const {
    doc, collection, setDoc, getDoc, getDocs,
    onSnapshot, updateDoc, runTransaction, serverTimestamp
  } = window.FS;

  // ---------- 엘리먼트 캐시 (여러분의 ID 기준) ----------
  const els = {
    // 헤더/세션
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

    // 빌더
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
    studentAccess: $("#studentAccess"),
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

  // ---------- 상태 ----------
  let MODE = "admin"; // admin | student
  let roomId = "";
  let me = { id: null, name: "" };
  let unsubRoom = null, unsubResp = null, timerHandle = null;

  // ---------- 레퍼런스 ----------
  const roomRef = id => doc(window.db, "rooms", id);
  const respCol = id => collection(window.db, "rooms", id, "responses");

  // ---------- 유틸 ----------
  function saveLocal(){
    localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me }));
  }
  function loadLocal(){
    try{
      const d = JSON.parse(localStorage.getItem("quiz.live") || "{}");
      roomId = d.roomId || ""; MODE = d.MODE || MODE; me = d.me || me;
      if (roomId && els.roomId) els.roomId.value = roomId;
    }catch{}
  }
  function heartbeatOnline(on){ if(els.liveDot) els.liveDot.style.background = on ? "#f43" : "#555"; }

  // ---------- 탭/UI ----------
  function showTab(key){
    const map = {build:els.pBuild, options:els.pOptions, present:els.pPresent, results:els.pResults};
    Object.values(map).forEach(p => p && p.classList.add("hide"));
    map[key] && map[key].classList.remove("hide");

    [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(t=>t&&t.classList.remove("active"));
    ({build:els.tabBuild,options:els.tabOptions,present:els.tabPresent,results:els.tabResults}[key]||{}).classList?.add("active");
  }

  function setMode(m){
    MODE = m;
    // 관리자 전용 숨김
    $$(".admin-only").forEach(n => n.classList.toggle("hide", m !== "admin"));
    // 학생 루트
    if (els.studentAccess) els.studentAccess.classList.toggle("hide", m !== "student");
    if (m === "admin") showTab("build");
    saveLocal();
  }

  // ---------- Firestore 리스너 ----------
  function listenRoom(id){
    if (unsubRoom) unsubRoom();
    unsubRoom = onSnapshot(roomRef(id), snap => {
      if (!snap.exists()) return;
      const r = snap.data(); window.__room = r;
      renderRoom(r);
    });
  }
  function listenResponses(id){
    if (unsubResp) unsubResp();
    unsubResp = onSnapshot(respCol(id), qs => {
      const arr = []; qs.forEach(d => arr.push({ id:d.id, ...d.data() }));
      window.__resp = arr;
      renderResponses(arr);
    });
  }

  // ---------- 접속 ----------
  async function ensureRoom(id){
    const s = await getDoc(roomRef(id));
    if (!s.exists()){
      await setDoc(roomRef(id), {
        title: "새 세션", mode: "idle", currentIndex: -1, accept: false, reveal: false,
        policy: "device", timer: 30, bright: false, createdAt: serverTimestamp(), questions:[]
      });
    }
  }
  async function connect(){
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
    buildStudentLink();
    heartbeatOnline(true);
    saveLocal();
  }
  function signOut(){
    if (unsubRoom) unsubRoom();
    if (unsubResp) unsubResp();
    roomId = "";
    if (els.roomId){ els.roomId.value = ""; els.roomId.disabled = false; }
    if (els.btnConnect) els.btnConnect.disabled = false;
    if (els.btnSignOut) els.btnSignOut.classList.add("hide");
    if (els.roomStatus) els.roomStatus.textContent = "세션: - · 오프라인";
    heartbeatOnline(false);
    showTab("build");
    saveLocal();
  }
  function autoReconnect(){
    loadLocal();
    // URL role 우선
    const sp = new URLSearchParams(location.search);
    const role = sp.get("role");
    if (role === "student") MODE = "student";
    setMode(MODE);

    // student URL이면 room 파라미터로 세션 고정
    const rid = sp.get("room");
    if (rid) { roomId = rid; if (els.roomId) els.roomId.value = rid; }

    if (MODE === "admin" && roomId) connect();
    if (MODE === "student" && roomId) {
      // 학생은 실시간 상태만 구독
      listenRoom(roomId);
      listenResponses(roomId);
      joinGate(); // 이름 입력/대기 표시
    }
  }

  // ---------- 빌더 ----------
  function qCard(no, q){
    const wrap = document.createElement("div");
    wrap.className = "qcard";
    wrap.innerHTML = `
      <div class="row wrap">
        <span class="badge">${no}번</span>
        <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'}> 객관식</label>
        <label class="switch"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''}> 주관식</label>
      </div>
      <div class="row wrap mt">
        <input class="input grow qtext" placeholder="문항 내용" value="${q?.text||''}">
        <input class="input sm qimg" type="file" accept="image/*">
      </div>
      <div class="mcq ${q?.type==='short'?'hide':''} mt">
        <div class="row wrap">
          ${(q?.options||['','','','']).map((v,i)=>`<input class="input grow opt" data-idx="${i}" placeholder="보기 ${i+1}" value="${v}">`).join('')}
        </div>
        <div class="row mt">
          <span class="muted">정답 번호</span>
          <input class="input sm ansIndex" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
        </div>
      </div>
      <div class="short ${q?.type==='short'?'':'hide'} mt">
        <input class="input grow ansText" placeholder="정답(선택)" value="${q?.answerText||''}">
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
  function gatherBuilder(){
    const cards = $$("#builder>.qcard");
    const list = cards.map(c => {
      const type = c.querySelector("input[type=radio]:checked").value;
      const text = c.querySelector(".qtext").value.trim();
      const imgF = c.querySelector(".qimg").files?.[0] || null;
      if (!text) return null;
      let payload = { type, text };
      if (imgF) payload.image = URL.createObjectURL(imgF);
      if (type === 'mcq'){
        const opts = $$(".opt", c).map(i => i.value.trim());
        const ans  = Math.max(0, Math.min(opts.length-1, (parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
        payload.options = opts; payload.answerIndex = ans;
      }else{
        payload.answerText = c.querySelector(".ansText").value.trim();
      }
      return payload;
    }).filter(Boolean);
    return { title: els.quizTitle?.value || "퀴즈", questions: list };
  }

  // ---------- 옵션/QR ----------
  function buildStudentLink(){
    if (!roomId || !els.studentLink) return;
    const url = new URL(location.href);
    url.searchParams.set("role","student");
    url.searchParams.set("room", roomId);
    els.studentLink.value = url.toString();
    if (window.QRCode && els.qrCanvas){
      try { window.QRCode.toCanvas(els.qrCanvas, url.toString(), { width: 140 }); } catch(e){ console.warn(e); }
    }
  }

  // ---------- 진행 & 타이머 ----------
  async function startQuiz(){ await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true }); }
  async function step(delta){
    await runTransaction(window.db, async (tx)=>{
      const snap = await tx.get(roomRef(roomId));
      const r = snap.data(); const total = (r.questions?.length||0);
      let next = (r.currentIndex ?? -1) + delta;
      if (next >= total){
        tx.update(roomRef(roomId), { mode:"ended", accept:false });
        return;
      }
      next = Math.max(0, next);
      tx.update(roomRef(roomId), { currentIndex: next, accept:true });
    });
  }
  async function finishAll(){ await updateDoc(roomRef(roomId), { mode:"ended", accept:false }); }

  function startTimer(sec){
    stopTimer();
    const end = Date.now() + sec*1000;
    timerHandle = setInterval(()=>{
      const remain = Math.max(0, Math.floor((end - Date.now())/1000));
      if (els.leftSec) els.leftSec.textContent = `${pad(Math.floor(remain/60))}:${pad(remain%60)}`;
      if (remain <= 0){ stopTimer(); updateDoc(roomRef(roomId), { accept:false }); setTimeout(()=>step(+1), 400); }
    }, 250);
  }
  function stopTimer(){
    if (timerHandle){ clearInterval(timerHandle); timerHandle = null; }
    if (els.leftSec) els.leftSec.textContent = "00:00";
  }

  // ---------- 학생: 참여/제출 ----------
  function joinGate(){
    if (!els.joinModal || !els.sWrap) return;
    els.joinModal.classList.remove("hide");
    els.sWrap.classList.add("hide");
    if (els.sState) els.sState.textContent = "참가 완료! 제출 버튼을 눌러주세요. 교사가 시작하면 1번 문항이 표시됩니다.";
  }
  async function join(){
    if (!roomId) return alert("세션에 먼저 접속하세요.");
    const name = (els.joinName?.value || "").trim();
    if (!name) return alert("이름을 입력하세요.");
    me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
    localStorage.setItem("quiz.device", me.id);
    await setDoc(doc(respCol(roomId), me.id), {
      name, joinedAt: serverTimestamp(), answers:{}, alive:true
    }, { merge:true });
    els.joinModal?.classList.add("hide");
    els.sWrap?.classList.remove("hide");
    if (els.sState) els.sState.textContent = "참가 완료! 제출 버튼을 눌러주세요.";
    saveLocal();
  }
  async function submit(value){
    const r = window.__room; if (!r?.accept) return alert("지금은 제출할 수 없습니다.");
    const idx = r.currentIndex; const q = r.questions?.[idx]; if (!q) return;
    const ref = doc(respCol(roomId), me.id);
    const snap = await getDoc(ref); const prev = snap.exists() ? (snap.data().answers||{}) : {};
    if (prev[idx] != null) return alert("이미 제출했습니다.");
    let correct = null;
    if (q.type === 'mcq' && typeof value === 'number') correct = (value === (q.answerIndex ?? -999));
    if (q.type === 'short' && typeof value === 'string'){
      const norm = s => String(s).trim().toLowerCase();
      if (q.answerText) correct = (norm(value) === norm(q.answerText));
    }
    await setDoc(ref, { name: me.name, [`answers.${idx}`]: { value, correct:(correct===true) } }, { merge:true });
  }

  // ---------- 렌더 ----------
  function renderRoom(r){
    // 옵션/라벨
    if (els.chkAccept) els.chkAccept.checked = !!r.accept;
    if (els.chkReveal) els.chkReveal.checked = !!r.reveal;
    if (els.chkBright) els.chkBright.checked = !!r.bright;
    if (els.timerSec) els.timerSec.value = r.timer || 30;
    if (els.quizTitle) els.quizTitle.value = r.title || "퀴즈";

    const idx = r.currentIndex; const total = r.questions?.length || 0;
    if (els.nowQuestion) els.nowQuestion.textContent = (idx>=0) ? `Q${idx+1}/${total}` : "-";

    // 프레젠테이션
    if (els.pTitle) els.pTitle.textContent = r.title || roomId;
    if (els.pImg){ els.pImg.classList.add("hide"); els.pImg.src = ""; }
    if (idx==null || idx<0 || r.mode!=="active"){
      if (els.pQ) els.pQ.textContent = "시작 버튼을 누르면 문항이 제시됩니다.";
      if (els.pOpts) els.pOpts.innerHTML = "";
    }else{
      const q = r.questions[idx];
      if (els.pQ) els.pQ.textContent = q.text;
      if (q.image && els.pImg){ els.pImg.src = q.image; els.pImg.classList.remove("hide"); }
      if (els.pOpts){
        els.pOpts.innerHTML = "";
        if (q.type === 'mcq'){
          q.options.forEach((t,i) => {
            const d = document.createElement("div");
            d.className = "popt"; d.textContent = `${i+1}. ${t}`;
            els.pOpts.appendChild(d);
          });
        } else {
          const d = document.createElement("div");
          d.className = "popt"; d.textContent = "주관식 문제입니다.";
          els.pOpts.appendChild(d);
        }
      }
    }

    // 학생 화면
    if (MODE === "student"){
      if (r.mode === "ended"){
        els.sWrap?.classList.add("hide"); els.sDone?.classList.remove("hide"); return;
      }
      if (r.mode !== "active" || idx < 0){
        joinGate(); return;
      }
      const q = r.questions[idx];
      els.joinModal?.classList.add("hide"); els.sWrap?.classList.remove("hide");
      if (els.sQTitle) els.sQTitle.textContent = q.text;
      if (els.sQImg){ els.sQImg.classList.add("hide"); els.sQImg.src=""; if (q.image){ els.sQImg.src=q.image; els.sQImg.classList.remove("hide"); } }
      if (els.sOptBox){
        els.sOptBox.innerHTML = "";
        if (q.type === 'mcq'){
          q.options.forEach((opt,i)=>{
            const b = document.createElement("button");
            b.className = "btn popt"; b.textContent = `${i+1}. ${opt}`; b.disabled = !r.accept;
            b.onclick = () => submit(i);
            els.sOptBox.appendChild(b);
          });
          els.sShortWrap?.classList.add("hide");
        }else{
          els.sShortWrap?.classList.remove("hide");
          if (els.btnShortSend) els.btnShortSend.disabled = !r.accept;
        }
      }
    }
  }

  function renderResponses(list){
    const r = window.__room || {}; const idx = r.currentIndex;
    let joined = list.length, submitted = 0, correct = 0, wrong = 0;
    list.forEach(s => {
      const a = s.answers?.[idx];
      if (a){ submitted++; if (a.correct===true) correct++; if (a.correct===false) wrong++; }
    });
    if (els.chipJoin) els.chipJoin.textContent = joined;
    if (els.chipSubmit) els.chipSubmit.textContent = submitted;
    if (els.chipCorrect) els.chipCorrect.textContent = correct;
    if (els.chipWrong) els.chipWrong.textContent = wrong;

    // 결과표
    const tbl = document.createElement("table");
    const thead = document.createElement("thead"), tr = document.createElement("tr");
    const qs = (r.questions||[]);
    ["이름", ...qs.map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{
      const th=document.createElement("th"); th.textContent=h; tr.appendChild(th);
    });
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb=document.createElement("tbody");
    list.forEach(s=>{
      let score=0; const tr=document.createElement("tr");
      const tdn=document.createElement("td"); tdn.textContent=s.name||s.id; tr.appendChild(tdn);
      qs.forEach((q,i)=>{
        const a=s.answers?.[i]; const td=document.createElement("td");
        td.textContent = a ? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value??'-')) : '-';
        if(a?.correct) score++; tr.appendChild(td);
      });
      const tds=document.createElement("td"); tds.textContent=String(score); tr.appendChild(tds);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    if (els.resultsTable) els.resultsTable.innerHTML = "", els.resultsTable.appendChild(tbl);
  }

  // ---------- 이벤트 바인딩 ----------
  function bind(){
    // 탭
    els.tabBuild?.addEventListener("click", ()=>showTab("build"));
    els.tabOptions?.addEventListener("click", ()=>showTab("options"));
    els.tabPresent?.addEventListener("click", ()=>showTab("present"));
    els.tabResults?.addEventListener("click", ()=>showTab("results"));

    // 세션
    els.btnConnect?.addEventListener("click", connect);
    els.btnSignOut?.addEventListener("click", signOut);

    // 빌더
    els.btnBuildForm?.addEventListener("click", ()=>{
      const n = Math.max(1, parseInt(els.questionCount?.value||"1",10));
      els.builder.innerHTML = "";
      for(let i=0;i<n;i++) els.builder.appendChild(qCard(i+1));
    });
    els.btnLoadSample?.addEventListener("click", ()=>{
      const data = {
        title: "샘플 퀴즈",
        questions: [
          { type:"mcq", text:"가장 큰 행성은?", options:["지구","목성","화성","금성"], answerIndex:1 },
          { type:"short", text:"대한민국의 수도는?", answerText:"서울" }
        ]
      };
      els.quizTitle.value = data.title;
      els.builder.innerHTML = "";
      data.questions.forEach((q,i)=> els.builder.appendChild(qCard(i+1,q)));
    });
    els.btnSaveQuiz?.addEventListener("click", async ()=>{
      if (!roomId) return alert("세션부터 접속하세요.");
      const payload = gatherBuilder();
      await updateDoc(roomRef(roomId), { title: payload.title, questions: payload.questions });
      alert("저장 완료");
    });

    // 옵션 저장/초기화
    els.btnOptSave?.addEventListener("click", async ()=>{
      if (!roomId) return alert("세션부터 접속하세요.");
      const policy = els.polDevice?.checked ? "device" : "name";
      const bright = !!els.chkBright?.checked;
      const reveal = !!els.chkReveal?.checked;
      const accept = !!els.chkAccept?.checked;
      const timer  = Math.max(0, parseInt(els.timerSec?.value||"30",10));
      await updateDoc(roomRef(roomId), { policy, bright, reveal, accept, timer });
      buildStudentLink(); // 저장 후 QR/링크 갱신
      alert("옵션 저장 완료");
    });
    els.btnResetAll?.addEventListener("click", async ()=>{
      if (!roomId) return;
      if (!confirm("모든 문항/결과/설정을 초기화할까요?")) return;
      await setDoc(roomRef(roomId), {
        title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false,
        policy:"device", timer:30, bright:false, createdAt:serverTimestamp(), questions:[]
      });
      alert("초기화 완료");
    });

    // 학생 링크
    els.btnCopyLink?.addEventListener("click", ()=>{
      if (!els.studentLink?.value) return;
      navigator.clipboard.writeText(els.studentLink.value); alert("복사됨");
    });
    els.btnOpenStudent?.addEventListener("click", ()=>{
      if (!els.studentLink?.value) return;
      window.open(els.studentLink.value, "_blank");
    });

    // 프레젠테이션
    els.btnStart?.addEventListener("click", startQuiz);
    els.btnPrev?.addEventListener("click", ()=>step(-1));
    els.btnNext?.addEventListener("click", ()=>step(+1));
    els.btnEndAll?.addEventListener("click", finishAll);

    // 학생
    els.btnJoinGo?.addEventListener("click", join);
    els.btnShortSend?.addEventListener("click", ()=>{
      const v = (els.sShortInput?.value||"").trim();
      if (!v) return alert("답을 입력하세요.");
      submit(v);
    });
    els.btnShowMy?.addEventListener("click", ()=>{
      // 단순 개인 결과 보기
      const r = window.__room||{}, list = window.__resp||[];
      const mine = list.find(x=>x.id===me.id);
      if (!mine) return alert("기록이 없습니다.");
      const rows = (r.questions||[]).map((q,i)=>{
        const a = mine.answers?.[i];
        const val = a ? (q.type==='mcq' ? a.value+1 : (a.value??'-')) : '-';
        const ok  = a?.correct ? "O" : (a ? "X" : "-");
        return `Q${i+1}: ${val} (${ok})`;
      });
      els.myResult.textContent = rows.join("\n");
    });
  }

  // ---------- 초기화 ----------
  function init(){
    bind();
    autoReconnect(); // URL/LocalStorage 보고 모드/세션 결정
    // 기본은 **관리자 모드**로 시작
    if (!new URLSearchParams(location.search).get("role")) setMode("admin");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
