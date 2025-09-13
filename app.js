/***********************
 * Firebase (CDN v9)
 ***********************/
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc,
  collection, getDocs, runTransaction, serverTimestamp, deleteDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/** ← 본인 프로젝트로 교체 가능 */
const firebaseConfig = {
  apiKey: "AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo",
  authDomain: "live-quiz-a14d1.firebaseapp.com",
  projectId: "live-quiz-a14d1",
};
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

/***********************
 * Helpers & State
 ***********************/
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));
const pad = n => String(n).padStart(2,'0');
const safe = id => document.getElementById(id);

let MODE   = "admin";             // 'admin' | 'student'
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;

const els = {
  // 공통 / 상단
  roomInput: safe("roomInput"),
  btnConnect: safe("btnConnect"),
  btnLogout: safe("btnLogout"),
  liveBadge: safe("liveBadge"),
  tabBuild: safe("tabBuild"),
  tabOption: safe("tabOption"),
  tabPresent: safe("tabPresent"),
  tabResult: safe("tabResult"),

  // 패널
  panelBuild: safe("panelBuild"),
  panelOption: safe("panelOption"),
  panelPresent: safe("panelPresent"),
  panelResult: safe("panelResult"),

  // 빌더(문항)
  quizTitle: safe("quizTitle"),
  questionCount: safe("questionCount"),
  btnBlank: safe("btnBlank"),
  btnSample: safe("btnSample"),
  btnSaveQuiz: safe("btnSaveQuiz"),
  builder: safe("builder"),

  // 옵션
  policyDeviceOnce: safe("policyDeviceOnce"),
  policyNameOnce: safe("policyNameOnce"),
  brightMode: safe("brightMode"),
  timerSec: safe("timerSec"),
  btnSaveOption: safe("btnSaveOption"),
  studentAccess: safe("studentAccess"),
  studentLink: safe("studentLink"),
  btnCopyLink: safe("btnCopyLink"),
  btnOpenStudent: safe("btnOpenStudent"),
  qrCanvas: safe("qrCanvas"),

  // 프레젠테이션
  pTitle: safe("pTitle"),
  pQ: safe("pQ"),
  pOpts: safe("pOpts"),
  pImg: safe("pImg"),
  btnStart: safe("btnStart"),
  btnPrev: safe("btnPrev"),
  btnNext: safe("btnNext"),
  btnEnd: safe("btnEnd"),
  infoCounters: safe("infoCounters"),

  // 결과
  leaderboardWrap: safe("leaderboardWrap"),
  resultsTable: safe("resultsTable"),
  btnExportCSV: safe("btnExportCSV"),
  btnHardReset: safe("btnHardReset"),

  // 학생 화면
  sTop: safe("sTop"),               // 상단 표시줄(세션/온라인/이름)
  sJoinModal: safe("sJoinModal"),   // 이름 입력 모달
  sNameInput: safe("sNameInput"),
  sBtnJoin: safe("sBtnJoin"),
  sStandby: safe("sStandby"),       // 대기 안내 박스
  sWrap: safe("sWrap"),             // 문제 래퍼
  sQTitle: safe("sQTitle"),
  sQImg: safe("sQImg"),
  sOptBox: safe("sOptBox"),
  sShortWrap: safe("sShortWrap"),
  sShortInput: safe("sShortInput"),
  btnShortSend: safe("btnShortSend"),
  sDone: safe("sDone"),             // 종료 안내
  sMyResult: safe("sMyResult"),     // 개인 결과
};

function log(...args){ console.log("[app]", ...args); }

/***********************
 * Local cache
 ***********************/
function saveLocal() {
  localStorage.setItem("quiz.live.ctx", JSON.stringify({ roomId, MODE, me }));
}
function loadLocal() {
  try {
    const d=JSON.parse(localStorage.getItem("quiz.live.ctx")||"{}");
    roomId=d.roomId||"";
    MODE=d.MODE||"admin";
    me=d.me||{id:null,name:""};
    if(els.roomInput && roomId) els.roomInput.value=roomId;
  }catch{}
}

/***********************
 * Firestore
 ***********************/
const roomRef = id => doc(db,"rooms",id);
const respCol = id => collection(db,"rooms",id,"responses");

async function ensureRoom(id){
  const snap=await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션",
      mode:"idle",          // idle | active | ended
      currentIndex:-1,
      accept:false,
      reveal:false,
      policy:{ deviceOnce:true, nameOnce:false },
      bright:false,
      tSec: 0,
      questions: [],
      createdAt: serverTimestamp(),
    });
  }
}

function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom = onSnapshot(roomRef(id),(snap)=>{
    if(!snap.exists()) return;
    const r = snap.data();
    window.__room = r;
    renderRoom(r);
  });
}
function listenResponses(id){
  if(unsubResp) unsubResp();
  unsubResp = onSnapshot(respCol(id),(qs)=>{
    const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    renderResponses(arr);
  });
}

/***********************
 * Mode & Tabs
 ***********************/
function setMode(m){
  MODE = m;
  // 학생 모드에서 관리자 UI 숨김
  const hideAdmin = (m === "student");
  document.querySelectorAll(".admin-only").forEach(el=> el.classList.toggle("hide", hideAdmin));
  // 학생 탑바 보이기/숨기기
  els.sTop && els.sTop.classList.toggle("hide", m!=="student");
  saveLocal();
}
function showPanel(which){
  const map = {
    build: els.panelBuild,
    option: els.panelOption,
    present: els.panelPresent,
    result: els.panelResult
  };
  Object.values(map).forEach(p => p && p.classList.add("hide"));
  map[which] && map[which].classList.remove("hide");

  // 탭 활성 상태
  [[els.tabBuild,"build"],[els.tabOption,"option"],[els.tabPresent,"present"],[els.tabResult,"result"]]
    .forEach(([btn,key])=> btn && btn.classList.toggle("active", which===key));
}

/***********************
 * Connect / Logout
 ***********************/
async function connect(){
  const id = (els.roomInput?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId = id;
  await ensureRoom(roomId);
  listenRoom(roomId);
  listenResponses(roomId);
  // UI: 잠금
  if(els.roomInput){ els.roomInput.disabled = true; els.roomInput.classList.add("locked"); }
  els.btnConnect && (els.btnConnect.classList.add("hide"));
  els.btnLogout && (els.btnLogout.classList.remove("hide"));
  els.liveBadge && (els.liveBadge.textContent="● Live", els.liveBadge.classList.add("live"));
  buildStudentLink();
  saveLocal();
}
function logout(){
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  unsubRoom=unsubResp=null;
  roomId="";
  if(els.roomInput){ els.roomInput.disabled = false; els.roomInput.classList.remove("locked"); els.roomInput.value=""; }
  els.btnConnect && els.btnConnect.classList.remove("hide");
  els.btnLogout && els.btnLogout.classList.add("hide");
  els.liveBadge && (els.liveBadge.textContent="Live", els.liveBadge.classList.remove("live"));
  // 학생 쪽 초기화는 그대로 두고, 관리자 패널은 문항 탭 보여주기
  showPanel("build");
  saveLocal();
}

/***********************
 * Builder (문항)
 ***********************/
function qCard(no,q){
  const wrap=document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML = `
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'}><span>객관식</span></label>
      <label class="switch"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''}><span>주관식</span></label>
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항: 입력란" value="${q?.text||''}">
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap four">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기${i+1}: 입력란" value="${v}">`).join('')}
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
  const radios = $$(`input[name="type-${no}"]`, wrap);
  const mcq = $(".mcq", wrap);
  const short = $(".short", wrap);
  radios.forEach(r=> r.addEventListener("change", ()=>{
    const isShort = radios.find(x=>x.checked)?.value==='short';
    mcq.classList.toggle("hide", isShort);
    short.classList.toggle("hide", !isShort);
  }));
  return wrap;
}
function collectBuilder(){
  const cards = $$("#builder .qcard", document);
  const list = cards.map((c,idx)=>{
    const no = idx+1;
    const type = c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text = c.querySelector(".qtext").value.trim();
    if(!text) return null;
    if(type==='mcq'){
      const opts = $$(".opt", c).map(x=>x.value.trim()).filter(Boolean);
      const ans  = Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans };
    } else {
      return { type:'short', text, answerText: c.querySelector(".ansText").value.trim() };
    }
  }).filter(Boolean);
  return { title: (els.quizTitle?.value||"퀴즈"), questions:list };
}
function buildBlank(){
  const n = Math.max(1, Math.min(20, parseInt(els.questionCount?.value,10)||4));
  if(!els.builder) return;
  els.builder.innerHTML="";
  for(let i=0;i<n;i++) els.builder.appendChild(qCard(i+1));
}
function buildSample(){
  const S=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
    {type:'mcq', text:'태양계 중심별은?', options:['베텔기우스','태양','시리우스','폴라리스'], answerIndex:1},
    {type:'mcq', text:'다음 중 포유류는?', options:['상어','고래','문어','잉어'], answerIndex:1},
  ];
  if(!els.builder) return;
  els.builder.innerHTML="";
  S.forEach((q,i)=> els.builder.appendChild(qCard(i+1,q)));
  if(els.quizTitle) els.quizTitle.value="샘플 퀴즈";
  if(els.questionCount) els.questionCount.value=S.length;
}
async function saveQuiz(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const payload=collectBuilder();
  if(!payload.questions.length) return alert("문항을 추가하세요.");
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("문항 저장 완료!");
}

/***********************
 * Options
 ***********************/
async function saveOption(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const policy = {
    deviceOnce: !!els.policyDeviceOnce?.checked,
    nameOnce: !!els.policyNameOnce?.checked
  };
  const bright = !!els.brightMode?.checked;
  const tSec = Math.max(0, parseInt(els.timerSec?.value,10)||0);
  await setDoc(roomRef(roomId), { policy, bright, tSec }, { merge:true });
  buildStudentLink(true);
  alert("옵션 저장 완료!");
}
function buildStudentLink(drawQR=false){
  if(!els.studentLink) return;
  const url=new URL(location.href);
  url.searchParams.set("role","student");
  if(roomId) url.searchParams.set("room", roomId);
  els.studentLink.value = url.toString();
  if(drawQR && window.QRCode && els.qrCanvas){
    try{
      QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width: 160 }, (err)=>{ if(err) console.warn(err); });
    }catch(e){ console.warn("QR draw failed", e); }
  }
}

/***********************
 * Presentation (관리자)
 ***********************/
async function startQuiz(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const r = (await getDoc(roomRef(roomId))).data();
  if(!r?.questions?.length) return alert("문항이 없습니다.");
  await setDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true }, { merge:true });
}
async function step(delta){
  await runTransaction(db, async tx=>{
    const ref=roomRef(roomId);
    const snap=await tx.get(ref); const r=snap.data();
    const total = (r.questions?.length||0);
    let next = (r.currentIndex ?? -1) + delta;
    if(next>=total){ // 종료
      tx.update(ref, { mode:"ended", accept:false });
      return;
    }
    next=Math.max(0,next);
    tx.update(ref, { currentIndex: next, accept:true });
  });
}
async function endQuiz(){
  if(!roomId) return;
  await setDoc(roomRef(roomId), { mode:"ended", accept:false }, { merge:true });
}

/***********************
 * Render (공통)
 ***********************/
function renderRoom(r){
  const idx = r.currentIndex ?? -1;
  const total = r.questions?.length || 0;

  // Live 표시
  els.liveBadge && els.liveBadge.classList.toggle("live", !!roomId);

  // 프레젠테이션(관리자)
  if(els.pTitle) els.pTitle.textContent = r.title || (roomId||"퀴즈");
  if(els.pQ && els.pOpts){
    if(r.mode==="idle" || idx<0){
      els.pQ.textContent = "시작 버튼을 누르면 문항이 제시됩니다.";
      els.pOpts.innerHTML="";
      els.pImg && els.pImg.classList.add("hide");
    } else if(r.mode==="ended"){
      els.pQ.textContent = "퀴즈가 종료되었습니다. 결과 탭에서 확인하세요.";
      els.pOpts.innerHTML="";
      els.pImg && els.pImg.classList.add("hide");
      // 자동 이동은 탭 UX를 해치므로 안내만
    } else {
      const q=r.questions[idx];
      els.pQ.textContent=q.text;
      els.pOpts.innerHTML="";
      if(q.type==='mcq'){
        (q.options||[]).forEach((opt,i)=>{
          const d=document.createElement("div");
          d.className="popt"; d.textContent=`${i+1}. ${opt}`;
          els.pOpts.appendChild(d);
        });
      }
      if(q.imageUrl){
        els.pImg.src=q.imageUrl; els.pImg.classList.remove("hide");
      }else{
        els.pImg && els.pImg.classList.add("hide");
      }
    }
  }

  // 학생 화면
  if(MODE==="student"){
    // 상단 상태줄
    if(els.sTop){ els.sTop.querySelector(".s-room")?.classList.toggle("on", !!roomId); }

    if(r.mode==="idle" || idx<0){
      // 관리자가 아직 시작 X → 대기
      els.sStandby && els.sStandby.classList.remove("hide");
      els.sWrap && els.sWrap.classList.add("hide");
      els.sDone && els.sDone.classList.add("hide");
    } else if(r.mode==="ended"){
      els.sStandby && els.sStandby.classList.add("hide");
      els.sWrap && els.sWrap.classList.add("hide");
      els.sDone && els.sDone.classList.remove("hide");
      // 개인 결과 계산
      renderMyResult(r);
    } else {
      const q = r.questions[idx];
      // 문제 노출
      els.sStandby && els.sStandby.classList.add("hide");
      if(els.sQTitle) els.sQTitle.textContent = q.text;
      if(els.sQImg){
        if(q.imageUrl){ els.sQImg.src=q.imageUrl; els.sQImg.classList.remove("hide"); }
        else els.sQImg.classList.add("hide");
      }
      if(q.type==='mcq'){
        if(els.sOptBox){
          els.sOptBox.innerHTML="";
          (q.options||[]).forEach((opt,i)=>{
            const b=document.createElement("button");
            b.className="btn opt"; b.textContent=`${i+1}. ${opt}`;
            b.onclick = ()=> submit(i);
            els.sOptBox.appendChild(b);
          });
        }
        els.sShortWrap && els.sShortWrap.classList.add("hide");
      }else{
        els.sOptBox && (els.sOptBox.innerHTML="");
        els.sShortWrap && els.sShortWrap.classList.remove("hide");
      }
      els.sWrap && els.sWrap.classList.remove("hide");
      els.sDone && els.sDone.classList.add("hide");
    }
  }

  // 하단 정보(참가/제출/정답/오답 카운터) — teacher only
  if(els.infoCounters){
    (async ()=>{
      if(!roomId){ els.infoCounters.textContent=""; return; }
      const snap=await getDocs(respCol(roomId));
      let join=0, submit=0, ok=0, no=0;
      snap.forEach(d=>{
        const s=d.data(); join++;
        const a=s.answers?.[idx];
        if(a!=null){ submit++; if(a.correct) ok++; else no++; }
      });
      els.infoCounters.innerHTML = `
        <span class="dot blue"></span>참가 ${join}
        <span class="dot yellow"></span>제출 ${submit}
        <span class="dot green"></span>정답 ${ok}
        <span class="dot red"></span>오답 ${no}
      `;
    })();
  }
}
function renderResponses(list){
  // 결과표(관리자)
  if(els.resultsTable && window.__room){
    const r=window.__room;
    const tbl=document.createElement("table");
    const thead=document.createElement("thead");
    const tr=document.createElement("tr");
    ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{
      const th=document.createElement("th"); th.textContent=h; tr.appendChild(th);
    });
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb=document.createElement("tbody");
    list.forEach(s=>{
      let score=0;
      const tr=document.createElement("tr");
      const tdName=document.createElement("td"); tdName.textContent=s.name||s.id; tr.appendChild(tdName);
      (r.questions||[]).forEach((q,i)=>{
        const a=s.answers?.[i];
        const td=document.createElement("td");
        td.textContent = a ? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value??'-')) : '-';
        if(a?.correct) score++;
        tr.appendChild(td);
      });
      const tdScore=document.createElement("td"); tdScore.textContent=String(score); tr.appendChild(tdScore);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
  }

  // 리더보드(간단 정렬) — 관리자
  if(els.leaderboardWrap && window.__room){
    const r=window.__room;
    const rows = list.map(s=>{
      let score=0;
      (r.questions||[]).forEach((q,i)=>{ if(s.answers?.[i]?.correct) score++; });
      return { name: s.name||s.id, score };
    }).sort((a,b)=>b.score-a.score);
    const ul=document.createElement("ul");
    rows.forEach((x,i)=>{
      const li=document.createElement("li");
      li.textContent = `${i+1}. ${x.name} (${x.score})`;
      ul.appendChild(li);
    });
    els.leaderboardWrap.innerHTML=""; els.leaderboardWrap.appendChild(ul);
  }
}

async function renderMyResult(r){
  if(!els.sMyResult || !roomId || !me.id) return;
  const snap = await getDoc(doc(respCol(roomId), me.id));
  if(!snap.exists()){ els.sMyResult.textContent="제출 기록이 없습니다."; return; }
  const d = snap.data();
  let score=0;
  const lines = (r.questions||[]).map((q,i)=>{
    const a=d.answers?.[i];
    if(a?.correct) score++;
    const mark = a ? (a.correct?'O':'X') : '-';
    const val  = a ? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value||'')) : '';
    return `Q${i+1}: ${mark} ${val}`;
  });
  els.sMyResult.innerHTML = `<strong>점수: ${score}/${(r.questions||[]).length}</strong><br>${lines.join("<br>")}`;
}

/***********************
 * Student actions
 ***********************/
function deviceId(){
  let id=localStorage.getItem("quiz.device");
  if(!id){ id=Math.random().toString(36).slice(2,10); localStorage.setItem("quiz.device", id); }
  return id;
}
function openJoinModal(){
  if(!els.sJoinModal) return;
  els.sJoinModal.classList.remove("hide");
  els.sNameInput && (els.sNameInput.value="");
}
function closeJoinModal(){
  els.sJoinModal && els.sJoinModal.classList.add("hide");
}
async function join(){
  if(!roomId) return alert("세션이 없습니다.");
  const name = (els.sNameInput?.value||"").trim();
  if(!name) return alert("이름(번호)을 입력하세요.");
  me = { id: deviceId(), name };
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt: serverTimestamp(), answers:{} }, { merge:true });
  // 상단 이름 표시
  if(els.sTop){ const el=els.sTop.querySelector(".s-name"); if(el) el.textContent=name; }
  closeJoinModal();
  // 대기 화면으로
  els.sStandby && els.sStandby.classList.remove("hide");
  els.sWrap && els.sWrap.classList.add("hide");
  els.sDone && els.sDone.classList.add("hide");
  alert("참가 완료! 시작을 기다려 주세요.");
  saveLocal();
}
async function submit(value){
  const r=window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
  const ref=doc(respCol(roomId), me.id);
  // 중복 제출 방지(정책 적용: deviceOnce | nameOnce 단일 저장)
  const snap=await getDoc(ref);
  const prev=snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert("이미 제출했습니다.");
  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase();
    if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true), revealed:r.reveal||false } }, { merge:true });
  alert("제출되었습니다!");
}

/***********************
 * Export / Reset
 ***********************/
els.btnExportCSV && els.btnExportCSV.addEventListener("click", async ()=>{
  if(!roomId) return;
  const r=(await getDoc(roomRef(roomId))).data();
  const snap=await getDocs(respCol(roomId));
  const rows=[]; rows.push(["userId","name",...(r.questions||[]).map((_,i)=>`Q${i+1}`),"score"].join(","));
  snap.forEach(d=>{
    const s=d.data(); let score=0;
    const answers=(r.questions||[]).map((q,i)=>{ const a=s.answers?.[i]; if(a?.correct) score++; return q.type==='mcq' ? (typeof a?.value==='number'? a.value+1 : "") : (a?.value??""); });
    rows.push([d.id, `"${(s.name||"").replace(/"/g,'""')}"`, ...answers, score].join(","));
  });
  const blob=new Blob([rows.join("\n")],{type:"text/csv"}); const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=`${(r.title||roomId)}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
});

els.btnHardReset && els.btnHardReset.addEventListener("click", async ()=>{
  if(!roomId) return;
  if(!confirm("⚠ 모든 문항/설정/응답을 초기화합니다. 진행할까요?")) return;
  // responses 삭제
  const snap=await getDocs(respCol(roomId));
  await Promise.all(snap.docs.map(d=> deleteDoc(d.ref)));
  // room 초기화
  await setDoc(roomRef(roomId), {
    title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false,
    policy:{ deviceOnce:true, nameOnce:false }, bright:false, tSec:0, questions:[]
  });
  alert("초기화 완료!");
});

/***********************
 * Events
 ***********************/
els.btnConnect && els.btnConnect.addEventListener("click", connect);
els.btnLogout && els.btnLogout.addEventListener("click", logout);

els.tabBuild && els.tabBuild.addEventListener("click", ()=> showPanel("build"));
els.tabOption && els.tabOption.addEventListener("click", ()=> showPanel("option"));
els.tabPresent && els.tabPresent.addEventListener("click", ()=> showPanel("present"));
els.tabResult && els.tabResult.addEventListener("click", ()=> showPanel("result"));

els.btnBlank && els.btnBlank.addEventListener("click", buildBlank);
els.btnSample && els.btnSample.addEventListener("click", buildSample);
els.btnSaveQuiz && els.btnSaveQuiz.addEventListener("click", saveQuiz);

els.btnSaveOption && els.btnSaveOption.addEventListener("click", saveOption);
els.btnCopyLink && els.btnCopyLink.addEventListener("click", async ()=>{
  if(!els.studentLink) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="복사",1000);
});
els.btnOpenStudent && els.btnOpenStudent.addEventListener("click", ()=>{
  if(els.studentLink?.value) window.open(els.studentLink.value,"_blank");
});

els.btnStart && els.btnStart.addEventListener("click", startQuiz);
els.btnPrev && els.btnPrev.addEventListener("click", ()=> step(-1));
els.btnNext && els.btnNext.addEventListener("click", ()=> step(+1));
els.btnEnd && els.btnEnd.addEventListener("click", endQuiz);

els.sBtnJoin && els.sBtnJoin.addEventListener("click", join);
els.btnShortSend && els.btnShortSend.addEventListener("click", ()=>{
  const val=(els.sShortInput?.value||"").trim(); if(val) submit(val);
});

/***********************
 * Boot
 ***********************/
function autoReconnect(){
  loadLocal();
  // URL 파라미터
  const url=new URL(location.href);
  const role=url.searchParams.get("role");
  const rid=url.searchParams.get("room");
  if(role==="student") setMode("student"); else setMode("admin");
  if(rid){ roomId=rid; els.roomInput && (els.roomInput.value=rid); }
  // 세션 자동 접속
  if(roomId) connect();

  // 학생 진입이면 이름 모달 먼저
  if(MODE==="student"){
    // 처음 진입 시 상단 관리자 UI 숨김은 setMode에서 끝.
    openJoinModal();
    showPanel("present"); // 학생에겐 탭 개념 없음, 문제 영역만 보이도록
  }else{
    // 관리자 첫 화면: 문항 탭
    showPanel("build");
  }
}
autoReconnect();
