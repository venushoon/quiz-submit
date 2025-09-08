// app.js  — Live Quiz (admin + student) controller
// 필요한 전제: index.html이 Firebase v9 모듈로 window.db 를 노출, QRCode 라이브러리 로드됨.

// -------------------------------
// Firestore helpers (v9 modular)
// -------------------------------
import {
  doc, setDoc, getDoc, updateDoc, onSnapshot,
  collection, getDocs, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const db = window.db;

// --------------------------------
// DOM shortcuts & global state
// --------------------------------
const $  = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

const els = {
  // topbar
  roomId:        $("#roomId"),
  btnConnect:    $("#btnConnect"),
  btnSignOut:    $("#btnSignOut"),
  roomStatus:    $("#roomStatus"),
  liveDot:       $("#liveDot"),
  // tabs (admin 전용)
  tabBuild:      $("#tabBuild"),
  tabOptions:    $("#tabOptions"),
  tabPresent:    $("#tabPresent"),
  tabResults:    $("#tabResults"),
  // panels
  pBuild:        $("#panelBuild"),
  pOptions:      $("#panelOptions"),
  pPresent:      $("#panelPresent"),
  pResults:      $("#panelResults"),
  // builder
  quizTitle:     $("#quizTitle"),
  questionCount: $("#questionCount"),
  btnBuildForm:  $("#btnBuildForm"),
  btnLoadSample: $("#btnLoadSample"),
  btnSaveQuiz:   $("#btnSaveQuiz"),
  builder:       $("#builder"),
  fileUploadTxt: $("#fileUploadTxt"),
  btnUploadTxt:  $("#btnUploadTxt"),
  btnDownloadTemplate: $("#btnDownloadTemplate"),
  // options
  policyDevice:  $("#policyDevice"),
  policyName:    $("#policyName"),
  chkAccept:     $("#chkAccept"),
  chkReveal:     $("#chkReveal"),
  chkBright:     $("#chkBright"),
  timerSec:      $("#timerSec"),
  btnSaveOptions:$("#btnSaveOptions"),
  // student access (옵션 탭에서만 노출)
  studentAccess: $("#studentAccess"),
  qrCanvas:      $("#qrCanvas"),
  studentLink:   $("#studentLink"),
  btnCopyLink:   $("#btnCopyLink"),
  btnOpenStudent:$("#btnOpenStudent"),
  // present
  pTitle:        $("#pTitle"),
  pQ:            $("#pQ"),
  pOpts:         $("#pOpts"),
  pImg:          $("#pImg"),
  btnStart:      $("#btnStart"),
  btnPrev:       $("#btnPrev"),
  btnNext:       $("#btnNext"),
  btnEndAll:     $("#btnEndAll"),
  leftSec:       $("#leftSec"),
  legendJoin:    $("#legendJoin"),
  legendSubmit:  $("#legendSubmit"),
  legendOk:      $("#legendOk"),
  legendNo:      $("#legendNo"),
  // results
  resultsTable:  $("#resultsTable"),
  btnExportCSV:  $("#btnExportCSV"),
  btnResetAll:   $("#btnResetAll"),
  // student modal / ui
  joinModal:     $("#joinModal"),
  joinName:      $("#joinName"),
  btnJoinGo:     $("#btnJoinGo"),
  studentUI:     $("#studentUI"),
  sBadge:        $("#sBadge"),
  sTitle:        $("#sTitle"),
  sQuestion:     $("#sQuestion"),
  sImg:          $("#sImg"),
  sOptions:      $("#sOptions"),
  sShort:        $("#sShort"),
  sShortSend:    $("#sShortSend"),
  sWait:         $("#sWait"),
};

let MODE = "admin";          // 'admin' | 'student'
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom = null, unsubResp = null;
let timerHandle = null;

// --------------------------------
// utilities
// --------------------------------
const pad = n => String(n).padStart(2, "0");
const nowSec = () => Math.floor(Date.now()/1000);
const toast = (msg)=>{ try{ if(window.Toastify) Toastify({text:msg, duration:1500}).showToast(); else console.log(msg);}catch{} };

const deviceId = (() => {
  let id = localStorage.getItem("quiz.device");
  if(!id){ id = Math.random().toString(36).slice(2,10); localStorage.setItem("quiz.device", id); }
  return id;
})();

function saveLocal(){ localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me })); }
function loadLocal(){
  try{
    const d = JSON.parse(localStorage.getItem("quiz.live")||"{}");
    if(d.roomId) roomId = d.roomId;
    if(d.me) me = d.me;
  }catch{}
}

// --------------------------------
// Firestore refs
// --------------------------------
const roomRef = (id)=> doc(db,"rooms",id);
const respCol = (id)=> collection(db,"rooms",id,"responses");

// --------------------------------
// session / mode
// --------------------------------
function setAdminUI(on){
  document.querySelectorAll(".admin-only").forEach(el=>{
    if(on) el.classList.remove("hide");
    else   el.classList.add("hide");
  });
}
function setMode(m){
  MODE = m;
  setAdminUI(m==="admin");
  if(m==="student"){
    // 학생은 탭/관리자 영역 숨김
    [els.pBuild,els.pOptions,els.pResults].forEach(p=>p?.classList.add("hide"));
    els.pPresent?.classList.remove("hide"); // 학생은 프레젠테이션 화면만 참고
  }
  saveLocal();
}

async function ensureRoom(id){
  const snap = await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션",
      createdAt:serverTimestamp(),
      mode:"idle",           // idle | active | ended
      currentIndex:-1,
      accept:false,
      reveal:false,
      bright:false,
      policy:"device",       // 'device' | 'name'
      timerSec:30,
      questions:[]
    });
  }
}
function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom = onSnapshot(roomRef(id), snap=>{
    if(!snap.exists()) return;
    const r = snap.data();
    window.__room = r;
    renderRoom(r);
  });
}
function listenResponses(id){
  if(unsubResp) unsubResp();
  unsubResp = onSnapshot(respCol(id), qs=>{
    const arr=[]; qs.forEach(d=>arr.push({id:d.id, ...d.data()}));
    renderResponses(arr);
  });
}

// --------------------------------
// connect / signout / tabs
// --------------------------------
async function connect(){
  const id = (els.roomId?.value||"").trim();
  if(!id) return alert("세션 코드를 입력하세요.");
  roomId = id;
  await ensureRoom(roomId);
  listenRoom(roomId);
  listenResponses(roomId);
  // 잠금
  if(els.roomId){ els.roomId.disabled = true; }
  els.btnConnect?.classList.add("hide");
  els.btnSignOut?.classList.remove("hide");
  els.roomStatus && (els.roomStatus.textContent = `세션: ${roomId} · 온라인`);
  els.liveDot && (els.liveDot.style.background = "#22c55e");
  saveLocal();
  // 옵션 탭 QR 갱신
  refreshStudentLink();
}
function signOut(){
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  unsubRoom = unsubResp = null;
  roomId = "";
  els.roomId && (els.roomId.disabled = false, els.roomId.value="");
  els.btnSignOut?.classList.add("hide");
  els.btnConnect?.classList.remove("hide");
  els.roomStatus && (els.roomStatus.textContent = "세션: - · 오프라인");
  els.liveDot && (els.liveDot.style.background = "#f43");
  saveLocal();
}

function switchTab(btn){
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
  btn?.classList.add("active");
  const name = btn?.dataset.tab;
  [els.pBuild,els.pOptions,els.pPresent,els.pResults].forEach(p=>p?.classList.add("hide"));
  if(name==="build")   els.pBuild?.classList.remove("hide");
  if(name==="options") els.pOptions?.classList.remove("hide");
  if(name==="present") els.pPresent?.classList.remove("hide");
  if(name==="results") els.pResults?.classList.remove("hide");
  // 학생 접속 카드(옵션 탭 전용) 표시/숨김
  if(els.studentAccess) els.studentAccess.style.display = (name==="options" ? "" : "none");
}

// --------------------------------
// builder
// --------------------------------
function qCard(no, q){
  const wrap = document.createElement("div");
  wrap.className = "qcard";
  wrap.innerHTML = `
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="radio"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'}> 객관식</label>
      <label class="radio"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''}> 주관식</label>
      <label class="btn ghost right"><input type="file" class="qimg-input hide" accept="image/*"> <span>이미지</span></label>
      <img class="qthumb ${q?.img?'':'hide'}" src="${q?.img||''}" alt="">
    </div>
    <input class="qtext input" placeholder="문항" value="${q?.text||''}">
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" data-idx="${i}" placeholder="보기${i+1}" value="${v}">`).join('')}
      </div>
      <div class="row"><span class="muted">정답 번호</span><input class="ansIndex input sm" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}"></div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <div class="row"><input class="ansText input grow" placeholder="정답 텍스트(선택)" value="${q?.answerText||''}"></div>
    </div>
  `;
  // type toggle
  const radios = $$(`input[name="type-${no}"]`, wrap);
  const mcq = $(".mcq", wrap), short = $(".short", wrap);
  radios.forEach(r=> r.addEventListener("change", ()=>{
    const isShort = radios.find(x=>x.checked)?.value==='short';
    mcq.classList.toggle("hide", isShort);
    short.classList.toggle("hide", !isShort);
  }));
  // image upload
  const file = $(".qimg-input", wrap), img = $(".qthumb", wrap);
  file.addEventListener("change", async (e)=>{
    const f = e.target.files?.[0]; if(!f) return;
    const reader = new FileReader();
    reader.onload = ()=>{ img.src = reader.result; img.classList.remove("hide"); };
    reader.readAsDataURL(f);
  });
  return wrap;
}
function buildBlank(){
  const n = Math.max(1, Math.min(50, parseInt(els.questionCount.value||"3",10)));
  els.builder.innerHTML = "";
  for(let i=0;i<n;i++) els.builder.appendChild(qCard(i+1));
}
function buildSample(){
  els.quizTitle.value = "샘플 퀴즈";
  const S = [
    {type:"mcq", text:"가장 큰 행성은?", options:["지구","목성","화성","금성"], answerIndex:1},
    {type:"short", text:"물의 끓는점(°C)?", answerText:"100"},
    {type:"mcq", text:"태양의 색은?", options:["노랑","파랑","초록","보라"], answerIndex:0},
  ];
  els.builder.innerHTML = ""; S.forEach((q,i)=> els.builder.appendChild(qCard(i+1,q)));
}
function collectBuilder(){
  const cards = $$("#builder .qcard");
  const questions = cards.map((card,idx)=>{
    const no = idx+1;
    const type = card.querySelector(`input[name="type-${no}"]:checked`).value;
    const text = card.querySelector(".qtext").value.trim();
    const thumb = card.querySelector(".qthumb");
    const img = (!thumb.classList.contains("hide") && thumb.src) ? thumb.src : "";
    if(!text) return null;
    if(type==="mcq"){
      const opts = $$(".opt", card).map(x=>x.value.trim()).filter(Boolean);
      const ans  = Math.max(0, Math.min(opts.length-1, (parseInt(card.querySelector(".ansIndex").value,10)||1)-1));
      return { type:"mcq", text, options:opts, answerIndex:ans, img };
    }else{
      const ansText = card.querySelector(".ansText").value.trim();
      return { type:"short", text, answerText:ansText, img };
    }
  }).filter(Boolean);
  return { title: (els.quizTitle.value||"퀴즈"), questions };
}

// txt/csv 업로드 & 템플릿
els.btnUploadTxt?.addEventListener("click", ()=> els.fileUploadTxt.click());
els.fileUploadTxt?.addEventListener("change", async (e)=>{
  const f = e.target.files?.[0]; if(!f) return;
  const txt = await f.text();
  const lines = txt.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const qs = [];
  lines.forEach(line=>{
    const arr = line.split(",").map(s=>s.trim());
    if(arr.length>=3){
      if(arr[1]==="주관식"){
        qs.push({type:"short", text:arr[0], answerText:arr[2]||""});
      }else{
        const last = parseInt(arr[arr.length-1],10);
        const opts = arr.slice(1, arr.length-1);
        if(opts.length>=2) qs.push({type:"mcq", text:arr[0], options:opts, answerIndex:Math.max(0,Math.min(opts.length-1,(isNaN(last)?1:last)-1))});
      }
    }
  });
  els.quizTitle.value = els.quizTitle.value || "수동 업로드";
  els.builder.innerHTML=""; qs.forEach((q,i)=> els.builder.appendChild(qCard(i+1,q)));
  toast(`불러온 문항: ${qs.length}개`);
});
els.btnDownloadTemplate?.addEventListener("click", ()=>{
  const example = [
    "가장 큰 행성은?,지구,목성,화성,금성,2",
    "물의 끓는점(°C)은?,주관식,100"
  ].join("\n");
  const a=document.createElement("a");
  a.href = URL.createObjectURL(new Blob([example],{type:"text/plain"}));
  a.download = "quiz-template.txt"; a.click(); URL.revokeObjectURL(a.href);
});

// 저장
els.btnSaveQuiz?.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const payload = collectBuilder();
  if(!payload.questions.length) return alert("문항을 추가하세요.");
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  toast("문항 저장 완료");
});

// --------------------------------
// options & student link / QR
// --------------------------------
els.btnSaveOptions?.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  await setDoc(roomRef(roomId), {
    policy: els.policyName.checked ? "name" : "device",
    accept: !!els.chkAccept.checked,
    reveal: !!els.chkReveal.checked,
    bright: !!els.chkBright.checked,
    timerSec: Math.max(5, Math.min(600, parseInt(els.timerSec.value||"30",10)))
  }, { merge:true });
  refreshStudentLink();
  toast("옵션 저장 완료");
});

function refreshStudentLink(){
  if(!els.studentLink) return;
  const url = new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", roomId || "");
  els.studentLink.value = url.toString();
  // QR (로드되어 있을 때만)
  if(window.QRCode && els.qrCanvas){
    try{
      QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:120, margin:1 }, (err)=> err && console.warn(err));
    }catch(e){ console.warn(e); }
  }
}
els.btnCopyLink?.addEventListener("click", async ()=>{
  if(!els.studentLink?.value) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  toast("복사됨");
});
els.btnOpenStudent?.addEventListener("click", ()=>{
  if(els.studentLink?.value) window.open(els.studentLink.value,"_blank");
});

// --------------------------------
// flow (present + timer)
// --------------------------------
async function startQuiz(){
  if(!roomId) return;
  await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true });
}
async function step(delta){
  if(!roomId) return;
  await runTransaction(db, async (tx)=>{
    const snap = await tx.get(roomRef(roomId));
    const r = snap.data(); const total = (r.questions?.length||0);
    let next = (r.currentIndex??-1) + delta;
    if(next >= total){ // 종료로 이동
      tx.update(roomRef(roomId), { mode:"ended", accept:false, currentIndex: total-1 });
      return;
    }
    next = Math.max(0, next);
    tx.update(roomRef(roomId), { currentIndex: next, accept:true });
  });
}
async function endAll(){
  if(!roomId) return;
  await updateDoc(roomRef(roomId), { mode:"ended", accept:false });
}

function startTimer(sec){
  stopTimer();
  const end = nowSec()+sec;
  timerHandle = setInterval(()=> {
    const remain = Math.max(0, end-nowSec());
    els.leftSec && (els.leftSec.textContent = `${pad(Math.floor(remain/60))}:${pad(remain%60)}`);
    if(remain<=0){
      stopTimer();
      // 제출 차단 후 0.5초 뒤 다음 문항
      updateDoc(roomRef(roomId), { accept:false }).then(()=> setTimeout(()=>step(+1), 500));
    }
  }, 250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } if(els.leftSec) els.leftSec.textContent="00:00"; }

// --------------------------------
// student join / submit / grade
// --------------------------------
async function openJoinModalIfNeeded(r){
  // 학생 전용: 이름 미등록시 팝업
  if(MODE!=="student" || !els.joinModal) return;
  const hasName = !!(me && me.name);
  if(!hasName){
    els.joinModal.showModal?.();
    els.joinName?.focus();
    return;
  }
  // 이름이 있고, r.mode==='idle' 이면 대기 문구
  if(r.mode!=="active"){
    els.sWait?.classList.remove("hide");
    els.studentUI?.classList.add("hide");
  }
}
async function join(){
  const name = (els.joinName?.value||"").trim();
  if(!name) return alert("이름(번호)을 입력하세요.");
  me = { id: deviceId, name };
  saveLocal();
  if(roomId){
    await setDoc(doc(respCol(roomId), me.id), { name, joinedAt: serverTimestamp(), answers:{}, alive:true }, { merge:true });
  }
  els.joinModal?.close();
  // 대기 문구 표시
  els.sWait?.classList.remove("hide");
  els.studentUI?.classList.add("hide");
}

async function submitAnswer(value){
  const r = window.__room; if(!r) return;
  if(!r.accept) return alert("지금은 제출할 수 없습니다.");
  const idx = r.currentIndex; const q = r.questions?.[idx]; if(!q) return;
  const ref = doc(respCol(roomId), me.id);
  const snap = await getDoc(ref);
  const prev = snap.exists()? (snap.data().answers||{}) : {};
  // 재제출 방지(정책: 기기/실명 1회)
  if(prev[idx]!=null) return alert("이미 제출했습니다.");

  let correct = null;
  if(q.type==='mcq' && typeof value==='number'){
    correct = (value === (q.answerIndex??-999));
  }else if(q.type==='short' && typeof value==='string'){
    const norm = s=> String(s).trim().toLowerCase();
    if(q.answerText) correct = (norm(value)===norm(q.answerText));
  }
  await setDoc(ref, {
    name: me.name,
    [`answers.${idx}`]: { value, correct:(correct===true), revealed: r.reveal||false }
  }, { merge:true });

  toast("제출 완료");
}

// --------------------------------
// render (admin + student)
// --------------------------------
function renderRoom(r){
  // topbar
  if(els.roomStatus) els.roomStatus.textContent = roomId ? `세션: ${roomId} · 온라인` : "세션: - · 오프라인";

  // 옵션 스위치 반영
  if(MODE==="admin"){
    if(els.chkAccept) els.chkAccept.checked = !!r.accept;
    if(els.chkReveal) els.chkReveal.checked = !!r.reveal;
    if(els.chkBright) els.chkBright.checked = !!r.bright;
    if(els.timerSec)  els.timerSec.value = r.timerSec||30;
  }

  // present panel
  const idx = r.currentIndex ?? -1;
  const q   = r.questions?.[idx];

  if(els.pTitle) els.pTitle.textContent = r.title || roomId || "실시간 퀴즈";

  if(r.mode!=="active" || !q){
    // 시작 전 안내
    if(els.pQ){
      els.pQ.innerHTML = `<div class="wait">시작 버튼을 누르면 문항이 제시됩니다.</div>`;
      if(els.pImg) els.pImg.classList.add("hide");
      if(els.pOpts) els.pOpts.innerHTML = "";
    }
    // 학생 대기화면
    if(MODE==="student"){
      els.sWait?.classList.remove("hide");
      els.studentUI?.classList.add("hide");
      openJoinModalIfNeeded(r);
    }
  }else{
    // 질문/보기/이미지
    if(els.pQ) els.pQ.textContent = q.text||"-";
    if(els.pImg){
      if(q.img){ els.pImg.src = q.img; els.pImg.classList.remove("hide"); }
      else els.pImg.classList.add("hide");
    }
    if(els.pOpts){
      els.pOpts.innerHTML = "";
      if(q.type==="mcq"){
        q.options.forEach((t,i)=>{
          const d=document.createElement("div"); d.className="popt"; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d);
        });
        els.pOpts.classList.add("grid-4");
      }else{
        els.pOpts.classList.remove("grid-4");
      }
    }
    // 학생 문제 영역
    if(MODE==="student"){
      els.sWait?.classList.add("hide");
      els.studentUI?.classList.remove("hide");
      if(els.sBadge) els.sBadge.textContent = q.type==='mcq' ? "객관식":"주관식";
      if(els.sTitle) els.sTitle.textContent = r.title||"";
      if(els.sQuestion) els.sQuestion.textContent = q.text||"";
      if(els.sImg){
        if(q.img){ els.sImg.src=q.img; els.sImg.classList.remove("hide"); } else els.sImg.classList.add("hide");
      }
      if(q.type==='mcq'){
        els.sShort?.classList.add("hide");
        els.sOptions.innerHTML="";
        q.options.forEach((opt,i)=>{
          const b=document.createElement("button");
          b.className="btn opt";
          b.textContent = `${i+1}. ${opt}`;
          b.disabled = !r.accept;
          b.addEventListener("click", ()=> submitAnswer(i));
          els.sOptions.appendChild(b);
        });
      }else{
        els.sOptions.innerHTML="";
        els.sShort?.classList.remove("hide");
        els.sShortSend?.onclick = ()=> {
          const v = ($("#sShortInput")?.value||"").trim();
          if(!v) return alert("답을 입력하세요.");
          submitAnswer(v);
          $("#sShortInput").value="";
        };
      }
    }
    // 타이머(관리자 밝은모드 안내만) — 자동다음은 start 시 별도 호출
  }

  // 결과 패널 (admin)
  if(MODE==="admin") buildResultsTable(r);

  // 프레젠테이션 컨트롤
  if(MODE==="admin"){
    // 자동 타이머 — 문항 바뀔 때마다 새로
    stopTimer();
    if(r.mode==="active" && r.timerSec) startTimer(r.timerSec);
  }

  // 종료 처리 — 학생 안내
  if(r.mode==="ended" && MODE==="student"){
    els.sWait?.classList.remove("hide");
    if(els.sWait) els.sWait.innerHTML = `퀴즈가 종료되었습니다! <button id="btnMyResult" class="btn" style="margin-left:8px">내 결과 보기</button>`;
    els.studentUI?.classList.add("hide");
    $("#btnMyResult")?.addEventListener("click", showMyResult);
  }
}

function buildResultsTable(r){
  if(!els.resultsTable) return;
  els.resultsTable.innerHTML="";
  const tbl=document.createElement("table");
  const thead=document.createElement("thead"), tr=document.createElement("tr");
  ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; tr.appendChild(th); });
  thead.appendChild(tr); tbl.appendChild(thead);

  const tbody=document.createElement("tbody");
  (window.__responses||[]).forEach(s=>{
    let score=0; const tr=document.createElement("tr");
    const n=document.createElement("td"); n.textContent=s.name||s.id; tr.appendChild(n);
    (r.questions||[]).forEach((q,i)=>{
      const a=s.answers?.[i]; const td=document.createElement("td");
      if(a){
        if(a.correct) score++;
        td.textContent = q.type==='mcq' ? (typeof a.value==='number' ? a.value+1 : "-") : (a.value||"-");
      }else td.textContent="-";
      tr.appendChild(td);
    });
    const sTd=document.createElement("td"); sTd.textContent=String(score); tr.appendChild(sTd);
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  els.resultsTable.appendChild(tbl);
}
function renderResponses(arr){
  window.__responses = arr;
  if(MODE==="admin" && window.__room) buildResultsTable(window.__room);
}

async function showMyResult(){
  if(!roomId || !me?.id) return;
  const r = (await getDoc(roomRef(roomId))).data();
  const my = (await getDoc(doc(respCol(roomId), me.id))).data();
  const wrap = document.createElement("div");
  wrap.className="card";
  const rows = (r.questions||[]).map((q,i)=>{
    const a = my?.answers?.[i];
    const mark = a ? (a.correct ? "○" : "×") : "-";
    const val  = q.type==='mcq' ? (typeof a?.value==='number' ? (a.value+1) : "-") : (a?.value||"-");
    return `<tr><td>${i+1}</td><td>${val}</td><td>${mark}</td></tr>`;
  }).join("");
  wrap.innerHTML = `
    <h3>내 결과</h3>
    <p class="muted">이름: ${my?.name||""}</p>
    <table><thead><tr><th>문항</th><th>제출</th><th>정답</th></tr></thead><tbody>${rows}</tbody></table>
  `;
  els.pPresent?.prepend(wrap);
  setTimeout(()=> wrap.scrollIntoView({behavior:"smooth"}), 0);
}

// --------------------------------
// export / reset
// --------------------------------
els.btnExportCSV?.addEventListener("click", async ()=>{
  if(!roomId) return;
  const r = (await getDoc(roomRef(roomId))).data();
  const snap = await getDocs(respCol(roomId));
  const rows=[]; rows.push(["userId","name",...(r.questions||[]).map((_,i)=>`Q${i+1}`),"score"].join(","));
  snap.forEach(d=>{
    const s=d.data(); let score=0;
    const answers=(r.questions||[]).map((q,i)=>{ const a=s.answers?.[i]; if(a?.correct) score++; return q.type==='mcq'? (typeof a?.value==='number'? a.value+1 : "") : (a?.value??""); });
    rows.push([d.id, `"${(s.name||"").replace(/"/g,'""')}"`, ...answers, score].join(","));
  });
  const a=document.createElement("a");
  a.href = URL.createObjectURL(new Blob([rows.join("\n")],{type:"text/csv"}));
  a.download = `${r.title||roomId}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
});

els.btnResetAll?.addEventListener("click", async ()=>{
  if(!roomId) return;
  if(!confirm("문항/옵션/결과를 모두 초기화할까요?")) return;
  // room 기본 초기화
  await setDoc(roomRef(roomId), {
    title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false, bright:false, policy:"device", timerSec:30, questions:[]
  }, { merge:true });
  // responses 초기화
  const snap = await getDocs(respCol(roomId));
  await Promise.all(snap.docs.map(d=> setDoc(doc(respCol(roomId), d.id), { answers:{}, alive:true }, { merge:true })));
  toast("완전 초기화 완료");
});

// --------------------------------
// events (topbar & tabs & build)
// --------------------------------
els.btnConnect?.addEventListener("click", connect);
els.btnSignOut?.addEventListener("click", signOut);

[els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(btn=>{
  btn?.addEventListener("click", ()=> switchTab(btn));
});

els.btnBuildForm?.addEventListener("click", buildBlank);
els.btnLoadSample?.addEventListener("click", buildSample);

// present buttons
els.btnStart?.addEventListener("click", startQuiz);
els.btnPrev?.addEventListener("click", ()=> step(-1));
els.btnNext?.addEventListener("click", ()=> step(+1));
els.btnEndAll?.addEventListener("click", endAll);

// join modal
els.btnJoinGo?.addEventListener("click", join);
els.joinName?.addEventListener("keydown", (e)=>{ if(e.key==="Enter") join(); });

// --------------------------------
// boot
// --------------------------------
(function boot(){
  // URL role 우선
  const url = new URL(location.href);
  const role = url.searchParams.get("role");
  const rid  = url.searchParams.get("room");
  loadLocal();

  if(role==="student"){ setMode("student"); }
  else setMode("admin");

  if(rid){ roomId = rid; if(els.roomId) els.roomId.value = rid; }

  // 최초 UI
  if(MODE==="admin"){
    switchTab(els.tabBuild);
    els.studentAccess && (els.studentAccess.style.display="none");
  }else{
    // 학생: 관리자 UI 숨김
    document.querySelectorAll(".admin-only").forEach(el=> el.classList.add("hide"));
  }

  // 자동 재접속
  if(roomId){
    if(els.roomId){ els.roomId.value=roomId; els.roomId.disabled=true; }
    els.btnConnect?.classList.add("hide");
    els.btnSignOut?.classList.remove("hide");
    connect();
  }

  // 첫 빌더 생성(빈폼 3개)
  if(MODE==="admin" && els.builder?.children.length===0){
    buildBlank();
  }
})();
