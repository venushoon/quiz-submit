/***********************
 * Firebase (from index.html)
 ***********************/
import {
  doc, setDoc, getDoc, onSnapshot, updateDoc, collection, getDocs,
  runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const { initializeApp, getFirestore } = window.__fb;

// 프로젝트 설정(필요시 교체)
const firebaseConfig = {
  apiKey: "AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo",
  authDomain: "live-quiz-a14d1.firebaseapp.com",
  projectId: "live-quiz-a14d1",
};
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

/***********************
 * Helpers / State
 ***********************/
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));
const pad = n=>String(n).padStart(2,"0");

let MODE="admin";     // 'admin' | 'student'
let roomId="";
let me = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timer=null, timerEnd=0;

// UI refs
const els = {
  roomId:$("#roomId"), btnConnect:$("#btnConnect"), roomStatus:$("#roomStatus"),
  btnAdmin:$("#btnAdmin"), btnStudent:$("#btnStudent"),
  adminTabs:$("#adminTabs"),
  tabBuild:$("#tabBuild"), tabOptions:$("#tabOptions"), tabPresent:$("#tabPresent"), tabResults:$("#tabResults"),
  panelBuild:$("#panelBuild"), panelOptions:$("#panelOptions"), panelPresent:$("#panelPresent"), panelResults:$("#panelResults"),

  // build
  quizTitle:$("#quizTitle"), questionCount:$("#questionCount"),
  btnBuildForm:$("#btnBuildForm"), btnLoadSample:$("#btnLoadSample"), btnSaveQuiz:$("#btnSaveQuiz"),
  builder:$("#builder"),

  // options
  qrCanvas:$("#qrCanvas"), studentLink:$("#studentLink"), btnCopyLink:$("#btnCopyLink"), btnOpenStudent:$("#btnOpenStudent"),
  chkPolicyDevice:$("#chkPolicyDevice"), chkPolicyName:$("#chkPolicyName"), chkAutoNext:$("#chkAutoNext"),
  chkAccept:$("#chkAccept"), chkReveal:$("#chkReveal"),
  timerSec:$("#timerSec"), btnTimerGo:$("#btnTimerGo"), btnTimerStop:$("#btnTimerStop"), leftSec:$("#leftSec"),

  // present
  pTitle:$("#pTitle"), pQ:$("#pQ"), pOpts:$("#pOpts"), pTimer:$("#pTimer"),
  btnStart:$("#btnStart"), btnPrev:$("#btnPrev"), btnNext:$("#btnNext"), btnEndAll:$("#btnEndAll"),

  // results
  btnExportCSV:$("#btnExportCSV"), btnResetAll:$("#btnResetAll"), resultsTable:$("#resultsTable"),

  // student
  studentPanel:$("#studentPanel"), studentName:$("#studentName"), btnJoin:$("#btnJoin"),
  sTitle:$("#sTitle"), sQText:$("#sQText"), sTimer:$("#sTimer"),
  sMcqBox:$("#sMcqBox"), sShortBox:$("#sShortBox"), shortInput:$("#shortInput"), btnShortSend:$("#btnShortSend"),
  btnSubmitChoice:$("#btnSubmitChoice"), submitHint:$("#submitHint"),
};

// 안전 경고
Object.entries(els).forEach(([k,v])=>{ if(!v) console.warn("missing element:", k); });

/***********************
 * Local
 ***********************/
function saveLocal(){
  localStorage.setItem("quiz.live", JSON.stringify({ MODE, roomId, me }));
}
function loadLocal(){
  try{
    const d=JSON.parse(localStorage.getItem("quiz.live")||"{}");
    MODE=d.MODE||"admin"; roomId=d.roomId||""; me=d.me||{id:null,name:""};
    if(roomId && els.roomId) els.roomId.value=roomId;
  }catch{}
}

/***********************
 * Firestore helpers
 ***********************/
const roomRef = id=>doc(db,"rooms",id);
const respCol = id=>collection(db,"rooms",id,"responses");

async function ensureRoom(id){
  const s=await getDoc(roomRef(id));
  if(!s.exists()){
    await setDoc(roomRef(id), { title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false, autoNext:false,
      policy:"device", createdAt:serverTimestamp(), questions:[] });
  }
}
function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom = onSnapshot(roomRef(id), snap=>{
    if(!snap.exists()) return;
    const r = snap.data();
    window.__room = r;
    renderRoom(r);
    buildStudentLink();  // 링크/QR 갱신
  });
}
function listenResponses(id){
  if(unsubResp) unsubResp();
  unsubResp = onSnapshot(respCol(id), qs=>{
    const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    renderResults(arr);
    renderStudentMark(arr);
  });
}

/***********************
 * Mode / Tabs
 ***********************/
function setMode(m){
  MODE=m;
  // 관리자만 탭 노출
  els.adminTabs?.classList.toggle("hide", m!=="admin");
  // 학생 화면
  els.studentPanel?.classList.toggle("hide", m!=="student");

  // 첫 진입 탭
  if(m==="admin"){
    activateTab(els.tabPresent); // 프레젠테이션을 기본
  }
  els.roomStatus.textContent = roomId ? `세션: ${roomId} · 온라인` :
    (m==="admin" ? "관리자 모드: 세션에 접속해 주세요." : "학생 모드: 세션 접속 후 참가하세요.");
}
function activateTab(btn){
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
  btn?.classList.add("active");
  els.panelBuild?.classList.toggle("hide", btn!==els.tabBuild);
  els.panelOptions?.classList.toggle("hide", btn!==els.tabOptions);
  els.panelPresent?.classList.toggle("hide", btn!==els.tabPresent);
  els.panelResults?.classList.toggle("hide", btn!==els.tabResults);
}

/***********************
 * Connect / Auto
 ***********************/
async function connect(){
  const id=(els.roomId?.value||"").trim();
  if(!id) return alert("세션 코드를 입력하세요.");
  roomId=id; saveLocal();
  await ensureRoom(roomId);
  listenRoom(roomId);
  listenResponses(roomId);
  els.roomStatus.textContent=`세션: ${roomId} · 온라인`;
}
function autoReconnect(){
  loadLocal();
  setMode(MODE);
  if(roomId) connect();
}

/***********************
 * Builder
 ***********************/
function qCard(no, q){
  const wrap=document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row gap">
      <span class="hint">#${no}</span>
      <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'}><span>객관식</span></label>
      <label class="switch"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''}><span>주관식</span></label>
    </div>
    <input class="qtext input" placeholder="문항 내용" value="${q?.text||''}">
    <div class="mcqs ${q?.type==='short'?'hide':''}">
      <div class="grid">${(q?.options||['','','','']).map((v,i)=>`<input class="input opt" data-idx="${i}" placeholder="보기 ${i+1}" value="${v||''}">`).join("")}</div>
      <div class="row gap mt">
        <span class="hint">정답 번호</span>
        <input class="input xs ans" type="number" min="1" value="${(q?.answerIndex??0)+1}">
      </div>
    </div>
    <div class="shorts ${q?.type==='short'?'':'hide'}">
      <input class="input anst" placeholder="정답(선택, 자동채점용)" value="${q?.answerText||''}">
    </div>
  `;
  const radios = $$(`input[name="type-${no}"]`, wrap);
  const mcqs = $(".mcqs",wrap); const shorts = $(".shorts",wrap);
  radios.forEach(r=>r.addEventListener("change", ()=>{
    const isShort = radios.find(x=>x.checked)?.value==='short';
    mcqs.classList.toggle("hide", isShort);
    shorts.classList.toggle("hide", !isShort);
  }));
  return wrap;
}
function collectBuild(){
  const list = $$("#builder .qcard").map((card)=>{
    const type = card.querySelector('input[type="radio"]:checked').value;
    const text = card.querySelector(".qtext").value.trim();
    if(!text) return null;
    if(type==='mcq'){
      const opts = $$(".opt",card).map(i=>i.value.trim()).filter(Boolean);
      const ans  = Math.max(0, Math.min(opts.length-1, (parseInt(card.querySelector(".ans").value,10)||1)-1));
      return { type, text, options:opts, answerIndex:ans };
    }else{
      return { type, text, answerText: card.querySelector(".anst").value.trim() };
    }
  }).filter(Boolean);
  return { title: els.quizTitle.value||"퀴즈", questions:list };
}

/***********************
 * Present / Flow / Timer
 ***********************/
async function startQuiz(){ await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true }); }
async function step(delta){
  await runTransaction(db, async (tx)=>{
    const ref=roomRef(roomId); const snap=await tx.get(ref); const r=snap.data();
    const total=(r.questions?.length||0); if(total===0) return;
    let next=(r.currentIndex ?? -1)+delta;
    if(next>=total){ tx.update(ref, { currentIndex: total-1, mode:"ended", accept:false }); return; }
    next=Math.max(0,next);
    tx.update(ref, { currentIndex: next, accept:true });
  });
}
async function endAll(){ if(confirm("퀴즈 종료?")) await updateDoc(roomRef(roomId), { mode:"ended", accept:false }); }

function startTimer(sec){
  stopTimer();
  timerEnd = Date.now()+sec*1000;
  timer = setInterval(async ()=>{
    const remain = Math.max(0, Math.floor((timerEnd-Date.now())/1000));
    const mm=pad(Math.floor(remain/60)), ss=pad(remain%60);
    els.leftSec.textContent = `${mm}:${ss}`;
    els.pTimer.textContent  = `${mm}:${ss}`;
    els.sTimer.textContent  = `${mm}:${ss}`;
    if(remain<=0){
      stopTimer();
      await updateDoc(roomRef(roomId), { accept:false });
      const r=window.__room;
      if(r?.autoNext) setTimeout(()=> step(1), 400);
    }
  }, 250);
}
function stopTimer(){
  if(timer){ clearInterval(timer); timer=null; }
  ["leftSec","pTimer","sTimer"].forEach(id=>{ const el=els[id]; if(el) el.textContent="00:00"; });
}

/***********************
 * Student: join / submit
 ***********************/
async function join(){
  if(!roomId) return alert("세션 먼저 접속");
  const name=(els.studentName.value||"").trim(); if(!name) return alert("이름");
  me.id = localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10);
  me.name = name;
  localStorage.setItem("quiz.device", me.id);
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{} }, { merge:true });
  alert("참가 완료!");
  saveLocal();
}

// 학생 제출(객관/주관 공통)
let selectedChoice = null; // 객관식 선택값(번호)
async function submit(valueOverride){
  const r=window.__room; if(!r?.accept) return alert("제출 허용 아님");
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;

  // 정책(기기/실명 1회)
  const policy=r.policy||"device";
  const myId = policy==="device" ? me.id : (me.name || me.id);

  const myRef = doc(respCol(roomId), myId);
  const snap = await getDoc(myRef);
  const prev = snap.exists()? (snap.data().answers || {}) : {};
  if(prev[idx]!=null) return alert("이미 제출했습니다.");

  let value = valueOverride;
  if(q.type==='mcq'){
    if(value==null) value = selectedChoice; // 제출 버튼
    if(typeof value!=="number") return alert("보기 선택 후 제출");
  }else{
    if(value==null) value = (els.shortInput.value||"").trim();
    if(!value) return alert("답 입력");
  }

  let correct=null;
  if(q.type==='mcq') correct = (value === (q.answerIndex??-999));
  if(q.type==='short' && q.answerText){
    const norm=s=>String(s).trim().toLowerCase();
    correct = (norm(value)===norm(q.answerText));
  }

  await setDoc(myRef, {
    name: me.name,
    answers: { ...prev, [idx]: { value, correct: !!correct } }
  }, { merge:true });

  // 제출 후 초기화
  if(q.type==='mcq'){ selectedChoice=null; highlightChoice(); }
  if(q.type==='short'){ els.shortInput.value=""; }
  alert("제출 완료");
}

/***********************
 * Render
 ***********************/
function renderRoom(r){
  // 옵션 반영
  els.chkAccept.checked = !!r.accept;
  els.chkReveal.checked = !!r.reveal;
  els.chkAutoNext.checked = !!r.autoNext;
  (r.policy==="name" ? els.chkPolicyName : els.chkPolicyDevice).checked = true;

  // 프레젠테이션 화면
  els.pTitle.textContent = r.title || roomId;
  const idx=r.currentIndex, total=r.questions?.length||0;
  if(r.mode!=="active" || idx<0 || !r.questions?.[idx]){
    els.pQ.textContent="대기 중입니다…";
    els.pOpts.innerHTML="";
  }else{
    const q=r.questions[idx];
    els.pQ.textContent=q.text;
    els.pOpts.innerHTML="";
    if(q.type==='mcq'){
      q.options.forEach((t,i)=>{
        const d=document.createElement("div");
        d.className="popt"; d.textContent=`${i+1}. ${t}`;
        els.pOpts.appendChild(d);
      });
    }
  }

  // 학생 화면 (문제 + 제출만)
  if(MODE==='student'){
    els.sTitle.textContent = r.title || roomId;

    if(r.mode!=="active" || idx<0 || !r.questions?.[idx]){
      els.sQText.textContent = "대기 중입니다…";
      els.sMcqBox.innerHTML=""; els.sShortBox.classList.add("hide");
      els.btnSubmitChoice.disabled = true;
      return;
    }

    const q=r.questions[idx];
    els.sQText.textContent = q.text;

    if(q.type==='mcq'){
      els.sShortBox.classList.add("hide");
      els.sMcqBox.innerHTML="";
      q.options.forEach((opt,i)=>{
        const b=document.createElement("button");
        b.className="btn"; b.textContent=`${i+1}. ${opt}`;
        b.addEventListener("click", ()=>{ selectedChoice=i; highlightChoice(); });
        els.sMcqBox.appendChild(b);
      });
      els.btnSubmitChoice.disabled = !r.accept;
    }else{
      els.sMcqBox.innerHTML="";
      els.sShortBox.classList.remove("hide");
      els.btnSubmitChoice.disabled = true; // 주관식은 아래 별도 버튼 사용
      els.btnShortSend.disabled = !r.accept;
    }
  }
}

function highlightChoice(){
  const btns = $$("#sMcqBox .btn");
  btns.forEach((b,idx)=>{
    b.style.outline = (idx===selectedChoice) ? `2px solid var(--primary)` : "none";
  });
}

function renderResults(list){
  if(MODE!=="admin" || !els.resultsTable) return;
  const r=window.__room || {};
  const qs = r.questions || [];

  // 점수 계산 + 정렬
  const rows = list.map(s=>{
    let score=0;
    const cells = qs.map((q,i)=>{
      const a=s.answers?.[i];
      if(a?.correct) score++;
      return a ? (q.type==='mcq' ? (typeof a.value==='number' ? a.value+1 : '-') : (a.value ?? '-')) : '-';
    });
    return { id:s.id, name:s.name||s.id, cells, score };
  }).sort((a,b)=> b.score - a.score);

  // 테이블 렌더
  const thead = `<thead><tr><th>이름</th>${qs.map((_,i)=>`<th>Q${i+1}</th>`).join("")}<th>점수</th></tr></thead>`;
  const tbody = rows.map(rw=>`<tr><td>${rw.name}</td>${rw.cells.map(c=>`<td>${c}</td>`).join("")}<td>${rw.score}</td></tr>`).join("");
  els.resultsTable.innerHTML = `<table>${thead}<tbody>${tbody}</tbody></table>`;
}

function renderStudentMark(list){
  if(MODE!=="student") return;
  // 추가 포맷팅 필요 시 여기서 학생 본인 상태 UI를 다듬을 수 있습니다.
}

/***********************
 * Link / QR
 ***********************/
function buildStudentLink(){
  if(!roomId || !els.studentLink) return;
  const url = new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", roomId);
  els.studentLink.value = url.toString();

  if(window.QRCode && els.qrCanvas){
    try{
      window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:192 });
    }catch(e){ console.warn("QR draw failed", e); }
  }
}

/***********************
 * Events
 ***********************/
els.btnAdmin?.addEventListener("click", ()=>{ setMode("admin"); saveLocal(); });
els.btnStudent?.addEventListener("click", ()=>{ setMode("student"); saveLocal(); });
els.btnConnect?.addEventListener("click", connect);

[els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>{
  b?.addEventListener("click", ()=> activateTab(b));
});

// Build
els.btnBuildForm?.addEventListener("click", ()=>{
  const n=Math.max(1,Math.min(20, parseInt(els.questionCount.value,10)||3));
  els.builder.innerHTML=""; for(let i=0;i<n;i++) els.builder.appendChild(qCard(i+1));
});
els.btnLoadSample?.addEventListener("click", ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
    {type:'mcq', text:'우리 은하 이름은?', options:['솔라','밀키웨이','루나','태양계'], answerIndex:1},
  ];
  els.builder.innerHTML=""; S.forEach((q,i)=> els.builder.appendChild(qCard(i+1,q)));
  els.quizTitle.value="샘플 퀴즈";
  els.questionCount.value=S.length;
});
els.btnSaveQuiz?.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션 접속 먼저");
  const payload = collectBuild(); if(!payload.questions.length) return alert("문항 없음");
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("저장 완료");
});

// Options
els.btnCopyLink?.addEventListener("click", async ()=>{
  if(!els.studentLink.value) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=>els.btnCopyLink.textContent="복사",1200);
});
els.btnOpenStudent?.addEventListener("click", ()=> window.open(els.studentLink.value || "#","_blank"));

els.chkAccept?.addEventListener("change", ()=> updateDoc(roomRef(roomId), { accept: !!els.chkAccept.checked }));
els.chkReveal?.addEventListener("change", ()=> updateDoc(roomRef(roomId), { reveal: !!els.chkReveal.checked }));
els.chkAutoNext?.addEventListener("change", ()=> updateDoc(roomRef(roomId), { autoNext: !!els.chkAutoNext.checked }));
els.chkPolicyDevice?.addEventListener("change", ()=> updateDoc(roomRef(roomId), { policy:"device" }));
els.chkPolicyName?.addEventListener("change", ()=> updateDoc(roomRef(roomId), { policy:"name" }));

els.btnTimerGo?.addEventListener("click", ()=> startTimer(Math.max(5,Math.min(600, parseInt(els.timerSec.value,10)||30))));
els.btnTimerStop?.addEventListener("click", stopTimer);

// Present flow
els.btnStart?.addEventListener("click", startQuiz);
els.btnPrev?.addEventListener("click", ()=>step(-1));
els.btnNext?.addEventListener("click", ()=>step(1));
els.btnEndAll?.addEventListener("click", endAll);

// Results
els.btnExportCSV?.addEventListener("click", async ()=>{
  if(!roomId) return;
  const r=(await getDoc(roomRef(roomId))).data()||{};
  const snap=await getDocs(respCol(roomId));
  const rows=[];
  rows.push(["userId","name",...(r.questions||[]).map((_,i)=>`Q${i+1}`),"score"].join(","));
  snap.forEach(d=>{
    const s=d.data(); let score=0;
    const answers=(r.questions||[]).map((q,i)=>{
      const a=s.answers?.[i]; if(a?.correct) score++;
      return q.type==='mcq' ? (typeof a?.value==='number' ? a.value+1 : "") : (a?.value ?? "");
    });
    rows.push([d.id, `"${(s.name||"").replace(/"/g,'""')}"`, ...answers, score].join(","));
  });
  const blob=new Blob([rows.join("\n")],{type:"text/csv"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=`${r.title||roomId}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
});
els.btnResetAll?.addEventListener("click", async ()=>{
  if(!roomId) return;
  if(!confirm("세션/응답/상태를 초기화합니다. 진행할까요?")) return;
  await setDoc(roomRef(roomId), { mode:"idle", currentIndex:-1, accept:false, reveal:false }, { merge:true });
  const snap=await getDocs(respCol(roomId));
  const tasks=[]; snap.forEach(d=> tasks.push(setDoc(doc(respCol(roomId), d.id), { answers:{} }, { merge:true })));
  await Promise.all(tasks);
  alert("초기화 완료");
});

// Student
els.btnJoin?.addEventListener("click", join);
els.btnShortSend?.addEventListener("click", ()=> submit());
els.btnSubmitChoice?.addEventListener("click", ()=> submit());

// Boot
autoReconnect();

// URL 진입 ?role=student&room=class1
(function(){
  const u=new URL(location.href);
  const role=u.searchParams.get("role"); const rid=u.searchParams.get("room");
  if(role==="student"){ setMode("student"); }
  if(rid){ els.roomId.value=rid; connect(); }
})();
