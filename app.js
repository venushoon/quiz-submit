/***********************
 * Firebase (compat)
 * - index.html에서 firebase-app-compat.js, firebase-firestore-compat.js가
 *   로드된 상태여야 합니다.
 ***********************/
(function(){
  if (!window.firebase || !firebase.apps) {
    console.error("[firebase] not loaded. Ensure compat scripts are included in index.html");
  }
})();

// ※ 사용 중인 프로젝트 설정이 이미 index.html에 있다면 그대로 사용됩니다.
//   여기서는 존재 시 그대로, 없으면 데모앱으로 초기화하도록 처리합니다.
(function ensureFirebaseApp(){
  try {
    if (firebase.apps.length === 0) {
      const cfg = window.FBCONFIG || {
        apiKey: "AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo",
        authDomain: "live-quiz-a14d1.firebaseapp.com",
        projectId: "live-quiz-a14d1",
      };
      firebase.initializeApp(cfg);
    }
  } catch(e){ console.warn(e); }
})();
const db = firebase.firestore();

/***********************
 * Helpers & State
 ***********************/
const $  = (s)=>document.querySelector(s);
const $$ = (s)=>Array.from(document.querySelectorAll(s));

function bindOnce(el, ev, fn){ if(!el) return; el.removeEventListener(ev, fn); el.addEventListener(ev, fn, {once:false}); }
function pad(n){ return String(n).padStart(2,'0'); }

// 기본 상태
let MODE   = "admin";             // 'admin' | 'student'
let roomId = "";
let me     = { id: null, name: "" };

let unsubRoom = null;
let unsubResp = null;
let timerHandle = null;

// 엘리먼트 캐시
const els = {
  // 상단/세션
  roomId: $("#roomId"),
  btnConnect: $("#btnConnect"),
  btnLogout: $("#btnLogout"),
  roomStatus: $("#roomStatus"),

  // 탭 버튼
  tabBuild: $("#tabBuild"),
  tabControl: $("#tabControl"),
  tabPresent: $("#tabPresent"),
  tabResults: $("#tabResults"),

  // 패널
  pBuild: $("#panelBuild"),
  pControl: $("#panelControl"),
  pPresent: $("#panelPresent"),
  pResults: $("#panelResults"),

  // 빌더
  quizTitle: $("#quizTitle"),
  questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"),
  btnLoadSample: $("#btnLoadSample"),
  btnSaveQuiz: $("#btnSaveQuiz"),
  builder: $("#builder"),

  // 옵션/진행
  chkAccept: $("#chkAccept"),
  chkReveal: $("#chkReveal"),
  chkDeviceOnce: $("#chkDeviceOnce"),
  chkNameOnce: $("#chkNameOnce"),
  chkBright: $("#chkBright"),

  timerSec: $("#timerSec"),
  btnTimerGo: $("#btnTimerGo"),
  btnTimerStop: $("#btnTimerStop"),
  leftSec: $("#leftSec"),

  btnStart: $("#btnStart"),
  btnPrev: $("#btnPrev"),
  btnNext: $("#btnNext"),
  btnEndAll: $("#btnEndAll"),

  // 프레젠테이션
  nowQuestion: $("#nowQuestion"),
  progress: $("#progress"),
  pTitle: $("#pTitle"),
  pQ: $("#pQ"),
  pImg: $("#pImg"),
  pOpts: $("#pOpts"),

  // 학생 접속 (옵션 탭)
  qrCanvas: $("#qrCanvas"),
  studentLink: $("#studentLink"),
  btnCopyLink: $("#btnCopyLink"),
  btnOpenStudent: $("#btnOpenStudent"),

  // 결과/현황
  chips: $("#chips"),
  shortAnswers: $("#shortAnswers"),
  resultsTable: $("#resultsTable"),
  btnExportCSV: $("#btnExportCSV"),
  btnResetAll: $("#btnResetAll"),

  // JSON 백업/복원
  btnSaveJSON: $("#btnSaveJSON"),
  fileLoad: $("#fileLoad"),

  // 학생 영역
  studentPanel: $("#studentPanel"),
  studentName: $("#studentName"),
  btnJoin: $("#btnJoin"),
  badgeType: $("#badgeType"),
  sQText: $("#sQText"),
  mcqBox: $("#mcqBox"),
  shortBox: $("#shortBox"),
  shortInput: $("#shortInput"),
  btnShortSend: $("#btnShortSend"),

  // 학생 대기 안내
  waitBox: $("#waitBox"),
};

// UI 안전 경고(없는 id는 로그만)
Object.entries(els).forEach(([k,v])=>{ if(!v) console.warn("[warn] missing element:", k); });

/***********************
 * Local cache
 ***********************/
function saveLocal(){
  localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me }));
}
function loadLocal(){
  try{
    const d = JSON.parse(localStorage.getItem("quiz.live") || "{}");
    roomId = d.roomId || "";
    MODE   = d.MODE   || "admin";
    me     = d.me     || {id:null, name:""};
    if (roomId && els.roomId) els.roomId.value = roomId;
  }catch{}
}

/***********************
 * Firestore refs
 ***********************/
const roomRef = (id)=> db.collection("rooms").doc(id);
const respCol = (id)=> db.collection("rooms").doc(id).collection("responses");

async function ensureRoom(id){
  const snap = await roomRef(id).get();
  if (!snap.exists){
    await roomRef(id).set({
      title: "새 세션",
      mode: "idle",
      currentIndex: -1,
      accept: false,
      reveal: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      questions: []
    }, { merge: true });
  }
}

function listenRoom(id){
  if (unsubRoom) unsubRoom();
  unsubRoom = roomRef(id).onSnapshot((snap)=>{
    if (!snap.exists) return;
    const r = snap.data();
    window.__room = r;
    renderRoom(r);       // 자동 결과 탭 전환은 제거함 (요청사항)
  });
}
function listenResponses(id){
  if (unsubResp) unsubResp();
  unsubResp = respCol(id).onSnapshot((qs)=>{
    const arr = [];
    qs.forEach(d=>arr.push({id:d.id, ...d.data()}));
    // 결과 표는 결과 탭에서만 그림
    renderResponses(arr);
  });
}

/***********************
 * Tabs / Mode / Clear
 ***********************/
function clearLiveUI(){
  if (els.resultsTable) els.resultsTable.innerHTML = "";
  if (els.chips) els.chips.innerHTML = "";
  if (els.shortAnswers) els.shortAnswers.innerHTML = "";
}

function showTab(tbtn){
  [els.tabBuild, els.tabControl, els.tabPresent, els.tabResults].forEach(b=>b?.classList.remove("active"));

  tbtn?.classList.add("active");

  const isResults = (tbtn === els.tabResults);

  if (els.pBuild)    els.pBuild.classList.toggle("hide", tbtn !== els.tabBuild   || MODE!=="admin");
  if (els.pControl)  els.pControl.classList.toggle("hide", tbtn !== els.tabControl || MODE!=="admin");
  if (els.pPresent)  els.pPresent.classList.toggle("hide", tbtn !== els.tabPresent ? true : false);
  if (els.pResults)  els.pResults.classList.toggle("hide", tbtn !== els.tabResults || MODE!=="admin");

  // 결과 탭이 아닌 경우에는 결과 표/칩/주관식 목록을 비운다.
  if (!isResults) clearLiveUI();

  saveLocal();
}

function setMode(m){
  MODE = m;

  // 관리자/학생 가이드/패널 노출
  if (els.pBuild)    els.pBuild.classList.toggle("hide", m!=="admin");
  if (els.pControl)  els.pControl.classList.toggle("hide", m!=="admin");
  if (els.pResults)  els.pResults.classList.toggle("hide", m!=="admin");
  if (els.pPresent)  els.pPresent.classList.toggle("hide", false); // 프레젠테이션은 항상 볼 수 있게

  if (els.studentPanel) els.studentPanel.classList.toggle("hide", m!=="student");

  if (els.roomStatus) {
    els.roomStatus.textContent = roomId
      ? `세션: ${roomId} · 온라인`
      : (m==='admin' ? '관리자 모드: 세션에 접속해 주세요.' : '학생 모드: 세션 접속 후 참가하세요.');
  }

  // 관리자 모드로 전환 시 기본 탭은 '문항'
  if (m === "admin" && els.tabBuild) showTab(els.tabBuild);

  saveLocal();
}

/***********************
 * Connect / Logout
 ***********************/
async function connect(){
  const id = (els.roomId?.value || "").trim();
  if (!id) { alert("세션 코드를 입력하세요."); return; }

  roomId = id;
  await ensureRoom(roomId);

  listenRoom(roomId);
  listenResponses(roomId);
  buildStudentLink();

  if (els.roomStatus) els.roomStatus.textContent = `세션: ${roomId} · 온라인`;

  // 관리자 첫 진입은 항상 '문항' 탭 + 이전 결과 UI 정리
  if (MODE === "admin" && els.tabBuild) showTab(els.tabBuild);
  clearLiveUI();

  saveLocal();
}

function logout(){
  try{ if (unsubRoom) unsubRoom(); }catch{}
  try{ if (unsubResp) unsubResp(); }catch{}
  unsubRoom = unsubResp = null;
  window.__room = null;

  clearLiveUI();

  roomId = "";
  if (els.roomId) els.roomId.value = "";
  if (els.roomStatus) els.roomStatus.textContent = "세션: - · 오프라인";
  saveLocal();
}

/***********************
 * Builder
 ***********************/
function cardRow(no, q){
  const wrap = document.createElement("div");
  wrap.className = "qcard";
  wrap.innerHTML = `
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'} /><span>객관식</span></label>
      <label class="switch"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''} /><span>주관식</span></label>
    </div>
    <div class="row gap">
      <button class="btn ghost imgPick" data-no="${no}">이미지</button>
      <span class="hint xs">이미지 선택(선택)</span>
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항 내용" value="${q?.text||''}" />
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기 ${i+1}" value="${v}">`).join('')}
      </div>
      <div class="row">
        <span class="hint">정답 번호</span>
        <input class="ansIndex input xs" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
      </div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <input class="ansText input" data-no="${no}" placeholder="정답(선택, 자동채점용)" value="${q?.answerText||''}">
    </div>
  `;

  const radios = wrap.querySelectorAll(`input[name="type-${no}"]`);
  const mcq = wrap.querySelector(".mcq");
  const short = wrap.querySelector(".short");
  radios.forEach(r=>r.addEventListener("change",()=>{
    const isShort = Array.from(radios).find(x=>x.checked)?.value === 'short';
    mcq.classList.toggle("hide", isShort);
    short.classList.toggle("hide", !isShort);
  }));

  // 이미지 버튼(데이터 URL을 questions[no-1].img 로 저장)
  wrap.querySelector(".imgPick").addEventListener("click", async ()=>{
    const f = document.createElement("input");
    f.type="file"; f.accept="image/*";
    f.onchange = async (e)=>{
      const file = e.target.files?.[0]; if(!file) return;
      const reader = new FileReader();
      reader.onload = ()=>{
        wrap.dataset.img = reader.result; // 일단 카드에 저장 → collectBuilder에서 취합
        alert("이미지 선택 완료");
      };
      reader.readAsDataURL(file);
    };
    f.click();
  });

  return wrap;
}

function collectBuilder(){
  const cards = $$("#builder>.qcard");
  const list = cards.map((c,idx)=>{
    const no = idx+1;
    const radios = c.querySelectorAll(`input[name="type-${no}"]`);
    const type = Array.from(radios).find(x=>x.checked)?.value || 'mcq';
    const text = c.querySelector(".qtext").value.trim();
    const img  = c.dataset.img || "";

    if (!text) return null;

    if (type === 'mcq'){
      const opts = Array.from(c.querySelectorAll(".opt")).map(i=>i.value.trim()).filter(Boolean);
      const ans  = Math.max(0, Math.min(opts.length-1, (parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans, img };
    } else {
      return { type:'short', text, answerText:c.querySelector(".ansText").value.trim(), img };
    }
  }).filter(Boolean);

  return {
    title: els.quizTitle?.value || "퀴즈",
    questions: list
  };
}

/***********************
 * Flow + Timer
 ***********************/
async function startQuiz(){
  if (!roomId) return;
  await roomRef(roomId).set({ mode:"active", currentIndex:0, accept:true }, { merge:true });
}
async function step(delta){
  if (!roomId) return;
  await db.runTransaction(async (tx)=>{
    const snap = await tx.get(roomRef(roomId));
    if (!snap.exists) return;
    const r = snap.data();
    const total = (r.questions?.length||0);
    let next = (r.currentIndex ?? -1) + delta;

    if (next >= total){
      tx.update(roomRef(roomId), { currentIndex: total-1, mode:"ended", accept:false });
      return;
    }
    next = Math.max(0, next);
    tx.update(roomRef(roomId), { currentIndex: next, accept:true });
  });
}
async function finishAll(){
  if (!roomId) return;
  if (!confirm("퀴즈를 종료할까요?")) return;
  await roomRef(roomId).set({ mode:"ended", accept:false }, { merge:true });
}

function startTimer(sec){
  stopTimer();
  const end = Date.now() + sec*1000;
  timerHandle = setInterval(async ()=>{
    const remain = Math.max(0, Math.floor((end - Date.now())/1000));
    if (els.leftSec) els.leftSec.textContent = `${pad(Math.floor(remain/60))}:${pad(remain%60)}`;
    if (remain <= 0){
      stopTimer();
      if (roomId) await roomRef(roomId).set({ accept:false }, { merge:true });
      setTimeout(()=> step(+1), 400);
    }
  }, 250);
}
function stopTimer(){
  if (timerHandle){ clearInterval(timerHandle); timerHandle = null; }
  if (els.leftSec) els.leftSec.textContent = "00:00";
}

/***********************
 * Link / QR
 ***********************/
function buildStudentLink(){
  if (!els.studentLink) return;
  const url = new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", roomId);
  els.studentLink.value = url.toString();

  // QR (있을 때만)
  const QR = window.QRCode || window.qrcode; // (라이브러리별 네임스페이스 케어)
  if (QR && els.qrCanvas){
    try{
      // qrcodejs v1은 new QRCode(element, text) 형식 → 캔버스만 쓰고 싶어 toCanvas도 시도
      if (QR.toCanvas){
        QR.toCanvas(els.qrCanvas, els.studentLink.value, { width: 160 }, (err)=>{ if(err) console.warn(err); });
      } else {
        // 기존 QRCode 클래스를 사용하는 경우
        els.qrCanvas.innerHTML = "";
        new QR(els.qrCanvas, els.studentLink.value);
      }
    }catch(e){ console.warn("QR draw failed", e); }
  }
}

/***********************
 * Student Join / Submit
 ***********************/
async function join(){
  if (!roomId) return alert("세션에 먼저 접속하세요.");
  const name = (els.studentName?.value || "").trim();
  if (!name) return alert("이름(번호)을 입력하세요.");

  me = {
    id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10),
    name
  };
  localStorage.setItem("quiz.device", me.id);

  await respCol(roomId).doc(me.id).set({
    name,
    joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
    answers:{},
    alive:true
  }, { merge:true });

  if (els.waitBox) els.waitBox.textContent = "참가 완료! 제출 버튼을 눌러주세요.";
  alert("참가 완료!");
  saveLocal();
}

async function submit(value){
  const r = window.__room;
  if (!r?.accept) return alert("지금은 제출할 수 없습니다.");

  const idx = r.currentIndex;
  const q = r.questions?.[idx];
  if (!q) return;

  const ref = respCol(roomId).doc(me.id);
  const snap = await ref.get();
  const prev = snap.exists ? (snap.data().answers||{}) : {};
  if (prev[idx] != null) return alert("이미 제출했습니다.");

  let correct = null;
  if (q.type==='mcq' && typeof value==='number'){
    correct = (value === (q.answerIndex ?? -999));
  }
  if (q.type==='short' && typeof value==='string'){
    const norm = s => String(s).trim().toLowerCase();
    if (q.answerText) correct = (norm(value) === norm(q.answerText));
  }

  await ref.set({
    name: me.name,
    [`answers.${idx}`]: { value, correct:(correct===true), revealed:(r.reveal||false) }
  }, { merge:true });

  alert("제출되었습니다.");
}

async function grade(uid, qIndex, ok){
  await respCol(roomId).doc(uid).set({
    [`answers.${qIndex}.correct`]: !!ok,
    [`answers.${qIndex}.revealed`]: true
  }, { merge:true });
}

/***********************
 * Render
 ***********************/
function renderRoom(r){
  // 상단 진행 정보
  const total = (r.questions?.length||0);
  const idx   = r.currentIndex ?? -1;

  if (els.progress)    els.progress.textContent = `${Math.max(0, idx+1)}/${total}`;
  if (els.chkAccept)   els.chkAccept.checked = !!r.accept;
  if (els.chkReveal)   els.chkReveal.checked = !!r.reveal;
  if (els.nowQuestion) els.nowQuestion.textContent = (idx>=0 && r.questions[idx]) ? r.questions[idx].text : "-";

  // 프레젠테이션
  if (els.pTitle) els.pTitle.textContent = r.title || roomId || "실시간 퀴즈";
  if (els.pQ && els.pOpts){
    els.pOpts.innerHTML = "";
    if (idx>=0 && r.questions[idx]){
      const q = r.questions[idx];
      els.pQ.textContent = q.text;
      // 이미지는 있을 때만 노출
      if (els.pImg){
        if (q.img) { els.pImg.src = q.img; els.pImg.classList.remove("hide"); }
        else { els.pImg.src=""; els.pImg.classList.add("hide"); }
      }
      if (q.type === 'mcq'){
        q.options.forEach((t,i)=>{
          const d = document.createElement("div");
          d.className = "popt";
          d.textContent = `${i+1}. ${t}`;
          els.pOpts.appendChild(d);
        });
      }
    } else {
      els.pQ.textContent = "시작 버튼을 누르면 문항이 제시됩니다.";
      if (els.pImg){ els.pImg.src=""; els.pImg.classList.add("hide"); }
    }
  }

  // 학생 화면
  if (MODE === "student"){
    if (r.mode!=='active' || idx<0){
      if (els.badgeType) els.badgeType.textContent = "대기";
      if (els.sQText) els.sQText.textContent = "대기 중입니다…";
      if (els.mcqBox) els.mcqBox.innerHTML = "";
      if (els.shortBox) els.shortBox.classList.add("hide");
      return;
    }
    const q = r.questions[idx];
    if (els.badgeType) els.badgeType.textContent = (q.type==='mcq'?'객관식':'주관식');
    if (els.sQText) els.sQText.textContent = q.text;

    // 객관식
    if (q.type === 'mcq'){
      if (els.mcqBox){
        els.mcqBox.innerHTML = "";
        q.options.forEach((opt,i)=>{
          const b = document.createElement("button");
          b.className = "optbtn";
          b.textContent = `${i+1}. ${opt}`;
          b.disabled = !r.accept;
          b.addEventListener("click", ()=> submit(i));
          els.mcqBox.appendChild(b);
        });
      }
      if (els.shortBox) els.shortBox.classList.add("hide");
    } else {
      if (els.mcqBox) els.mcqBox.innerHTML = "";
      if (els.shortBox){
        els.shortBox.classList.remove("hide");
        if (els.btnShortSend) els.btnShortSend.disabled = !r.accept;
      }
    }
  }
}

function renderResponses(list){
  if (MODE !== "admin") return;
  // 결과 탭이 열렸을 때만 결과 표를 그림
  if (!(els.pResults && !els.pResults.classList.contains("hide"))) return;

  const r   = window.__room || {};
  const idx = r.currentIndex;
  const q   = r.questions?.[idx];

  // 칩(참가/제출/정답/오답)
  if (els.chips){
    els.chips.innerHTML = "";
    list.forEach(s=>{
      const a = s.answers?.[idx];
      const chip = document.createElement("div");
      chip.className = "chip " + (a ? (a.correct ? "ok":"no") : "wait");
      chip.textContent = s.name || s.id;
      els.chips.appendChild(chip);
    });
  }

  // 주관식 채점
  if (els.shortAnswers){
    els.shortAnswers.innerHTML = "";
    if (q && q.type==='short'){
      list.forEach(s=>{
        const a = s.answers?.[idx];
        if (!a || typeof a.value!=='string') return;
        const row = document.createElement("div");
        row.className = "row between";
        row.innerHTML = `<span>${s.name}: ${a.value}</span>`;
        const box = document.createElement("div");
        const ok = document.createElement("button");
        ok.className = "btn ghost"; ok.textContent = "정답";
        const no = document.createElement("button");
        no.className = "btn ghost"; no.textContent  = "오답";
        ok.onclick = ()=> grade(s.id, idx, true);
        no.onclick = ()=> grade(s.id, idx, false);
        box.append(ok,no);
        row.append(box);
        els.shortAnswers.appendChild(row);
      });
    }
  }

  // 결과 표
  if (els.resultsTable){
    const tbl = document.createElement("table");
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{
      const th = document.createElement("th"); th.textContent = h; tr.appendChild(th);
    });
    thead.appendChild(tr); tbl.appendChild(thead);

    const tb = document.createElement("tbody");
    list.forEach(s=>{
      let score = 0;
      const tr = document.createElement("tr");
      const tdn = document.createElement("td"); tdn.textContent = s.name||s.id; tr.appendChild(tdn);
      (r.questions||[]).forEach((q,i)=>{
        const a = s.answers?.[i];
        const td = document.createElement("td");
        td.textContent = a ? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : "-") : (a.value??"-")) : "-";
        if (a?.correct) score++;
        tr.appendChild(td);
      });
      const tds = document.createElement("td"); tds.textContent = String(score); tr.appendChild(tds);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.resultsTable.innerHTML = "";
    els.resultsTable.appendChild(tbl);
  }
}

/***********************
 * Export / Reset / JSON
 ***********************/
async function exportCSV(){
  const r = (await roomRef(roomId).get()).data();
  const snap = await respCol(roomId).get();
  const rows = [];
  rows.push(["userId","name",...(r.questions||[]).map((_,i)=>`Q${i+1}`),"score"].join(","));
  snap.forEach(d=>{
    const s = d.data();
    let score = 0;
    const answers = (r.questions||[]).map((q,i)=>{
      const a = s.answers?.[i];
      if (a?.correct) score++;
      return q.type==='mcq' ? (typeof a?.value==='number'? a.value+1 : "") : (a?.value??"");
    });
    rows.push([d.id, `"${(s.name||"").replace(/"/g,'""')}"`, ...answers, score].join(","));
  });

  const blob = new Blob([rows.join("\n")],{type:"text/csv"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${r.title||roomId}-results.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function resetAll(){
  if (!confirm("모든 응답/점수를 초기화할까요?")) return;
  await roomRef(roomId).set({ mode:"idle", currentIndex:-1, accept:false, reveal:false }, { merge:true });
  const snap = await respCol(roomId).get();
  const tasks = [];
  snap.forEach(d=> tasks.push(respCol(roomId).doc(d.id).set({ answers:{}, alive:true }, { merge:true })));
  await Promise.all(tasks);
  clearLiveUI();
  alert("초기화 완료");
}

async function saveJSON(){
  const r = (await roomRef(roomId).get()).data();
  const res = await respCol(roomId).get();
  const obj = { roomId, room:r, responses: res.docs.map(d=>({ id:d.id, ...d.data() })) };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:"application/json"}));
  a.download = `${roomId}-backup.json`; a.click(); URL.revokeObjectURL(a.href);
}
async function loadJSON(e){
  const f = e.target.files?.[0]; if(!f) return;
  const data = JSON.parse(await f.text());
  if (data.room) await roomRef(roomId).set(data.room, { merge:true });
  if (Array.isArray(data.responses)){
    await Promise.all(data.responses.map(x=> respCol(roomId).doc(x.id).set(x, { merge:true })));
  }
  alert("불러오기 완료");
  e.target.value = "";
}

/***********************
 * Events
 ***********************/
bindOnce(els.btnConnect, "click", connect);
bindOnce(els.btnLogout,  "click", logout);

[els.tabBuild,els.tabControl,els.tabPresent,els.tabResults].forEach(btn=>{
  bindOnce(btn, "click", ()=> showTab(btn));
});

bindOnce(els.btnBuildForm,"click", ()=>{
  const n = Math.max(1, Math.min(20, parseInt(els.questionCount?.value,10)||3));
  if (els.builder){
    els.builder.innerHTML = "";
    for(let i=0;i<n;i++) els.builder.appendChild(cardRow(i+1));
  }
});
bindOnce(els.btnLoadSample,"click", ()=>{
  const S = [
    {type:'mcq', text:'가장 큰 행성?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
    {type:'mcq', text:'태양계 별명?', options:['Milky','Solar','Sunset','Lunar'], answerIndex:1},
  ];
  if (els.builder){
    els.builder.innerHTML = "";
    S.forEach((q,i)=> els.builder.appendChild(cardRow(i+1,q)));
  }
  if (els.quizTitle) els.quizTitle.value = "샘플 퀴즈";
  if (els.questionCount) els.questionCount.value = S.length;
});
bindOnce(els.btnSaveQuiz,"click", async ()=>{
  if (!roomId) return alert("세션부터 접속하세요.");
  const payload = collectBuilder();
  if (!payload.questions.length) return alert("문항을 추가하세요.");
  await roomRef(roomId).set({ title:payload.title, questions:payload.questions }, { merge:true });
  alert("저장 완료!");
});

bindOnce(els.btnStart, "click", startQuiz);
bindOnce(els.btnPrev,  "click", ()=> step(-1));
bindOnce(els.btnNext,  "click", ()=> step(+1));
bindOnce(els.btnEndAll,"click", finishAll);

bindOnce(els.chkAccept, "change", ()=> roomRef(roomId).set({ accept: !!els.chkAccept.checked },{merge:true}));
bindOnce(els.chkReveal, "change", ()=> roomRef(roomId).set({ reveal: !!els.chkReveal.checked },{merge:true}));

bindOnce(els.btnTimerGo,  "click", ()=> startTimer(Math.max(5, Math.min(600, parseInt(els.timerSec?.value,10)||30))));
bindOnce(els.btnTimerStop,"click", stopTimer);

bindOnce(els.btnCopyLink,"click", async ()=>{
  if (!els.studentLink) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent = "복사됨"; setTimeout(()=> els.btnCopyLink.textContent = "복사", 1200);
});
bindOnce(els.btnOpenStudent,"click", ()=> window.open(els.studentLink?.value||"#","_blank"));

bindOnce(els.btnExportCSV,"click", exportCSV);
bindOnce(els.btnResetAll, "click", resetAll);
bindOnce(els.btnSaveJSON, "click", saveJSON);
bindOnce(els.fileLoad,   "change", loadJSON);

bindOnce(els.btnJoin, "click", join);
bindOnce(els.btnShortSend, "click", ()=> submit((els.shortInput?.value||"").trim()));

/***********************
 * Boot
 ***********************/
(function boot(){
  loadLocal();

  const url  = new URL(location.href);
  const role = url.searchParams.get("role");
  const rid  = url.searchParams.get("room");

  // 쿼리에 student가 명시된 경우만 학생, 그 외는 항상 관리자부터 시작
  MODE = (role === 'student') ? 'student' : 'admin';
  setMode(MODE);

  // 자동 세션 접속
  if (rid){ if (els.roomId) els.roomId.value = rid; connect(); }
  else if (roomId){ connect(); }
  else {
    // 세션 미입력이면 관리자 첫 화면은 문항 탭 + 결과 UI 클리어
    if (MODE === 'admin' && els.tabBuild) showTab(els.tabBuild);
    clearLiveUI();
  }

  // 학생 첫 화면 안내
  if (MODE === 'student' && els.waitBox){
    els.waitBox.textContent = "이름(번호)을 입력 후 참가를 누르세요.";
  }
})();
