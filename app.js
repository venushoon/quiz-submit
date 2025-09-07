/***********************
 * Firebase
 ***********************/
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc,
  collection, getDocs, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

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

let MODE   = "admin";
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;

const els = {
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), roomStatus: $("#roomStatus"),
  btnAdmin: $("#btnAdmin"), btnStudent: $("#btnStudent"),
  tabBuild: $("#tabBuild"), tabControl: $("#tabControl"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"), pControl: $("#panelControl"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),

  // builder
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"), btnBuildForm: $("#btnBuildForm"),
  btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"), builder: $("#builder"),

  // control
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"),
  timerSec: $("#timerSec"), btnTimerGo: $("#btnTimerGo"), btnTimerStop: $("#btnTimerStop"),
  btnEndAll: $("#btnEndAll"),
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

  // present
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pOpts: $("#pOpts"),
  pWait: $("#pWait"), pCard: $("#pCard"),
  progress: $("#progress"), leftSec2: $("#leftSec2"),
  chips: $("#chips"),
  statJoined: $("#statJoined"), statSubmitted: $("#statSubmitted"),
  statCorrect: $("#statCorrect"), statWrong: $("#statWrong"),

  // results
  btnExportCSV: $("#btnExportCSV"), resultsTable: $("#resultsTable"),

  // student
  studentPanel: $("#studentPanel"), studentName: $("#studentName"), btnJoin: $("#btnJoin"),
  studentTopInfo: $("#studentTopInfo"),
  badgeType: $("#badgeType"), sQText: $("#sQText"), mcqBox: $("#mcqBox"),
  shortBox: $("#shortBox"), shortInput: $("#shortInput"), btnShortSend: $("#btnShortSend"),

  // timer mirror
  leftSec: $("#leftSec"),
};

/***********************
 * Local cache
 ***********************/
function saveLocal(){ localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me })); }
function loadLocal(){
  try{
    const d=JSON.parse(localStorage.getItem("quiz.live")||"{}");
    roomId=d.roomId||""; MODE=d.MODE||"admin"; me=d.me||{id:null,name:""};
    if(roomId && els.roomId) els.roomId.value=roomId;
  }catch{}
}

/***********************
 * Firestore refs
 ***********************/
const roomRef = id => doc(db,"rooms",id);
const respCol = id => collection(db,"rooms",id,"responses");

async function ensureRoom(id){
  const snap=await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false,
      createdAt: serverTimestamp(), questions:[]
    });
  }
}

function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom=onSnapshot(roomRef(id),(snap)=>{
    if(!snap.exists()) return;
    const r=snap.data(); window.__room=r; renderRoom(r);
  });
}
function listenResponses(id){
  if(unsubResp) unsubResp();
  unsubResp=onSnapshot(respCol(id),(qs)=>{
    const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    renderResponses(arr);
  });
}

/***********************
 * Mode & Connect
 ***********************/
function setMode(m){
  MODE=m;
  els.pBuild?.classList.toggle("hide", m!=="admin");
  els.pControl?.classList.toggle("hide", m!=="admin");
  els.pResults?.classList.toggle("hide", m!=="admin");
  els.pPresent?.classList.toggle("hide", false);
  els.studentPanel?.classList.toggle("hide", m!=="student");
  els.roomStatus && (els.roomStatus.textContent = roomId ? `세션: ${roomId} · 온라인` :
    (m==='admin'?'관리자 모드: 세션에 접속해 주세요.':'학생 모드: 세션 접속 후 참가하세요.'));
  [els.tabBuild,els.tabControl,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
  (m==='admin'?els.tabControl:els.tabPresent)?.classList.add("active");
}

async function connect(){
  const id=(els.roomId?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId=id; await ensureRoom(roomId);
  listenRoom(roomId); listenResponses(roomId);
  buildStudentLink();
  els.roomStatus && (els.roomStatus.textContent=`세션: ${roomId} · 온라인`);
  saveLocal();
}
function autoReconnect(){ loadLocal(); setMode(MODE); if(roomId) connect(); }

/***********************
 * Builder
 ***********************/
function cardRow(no,q){
  const wrap=document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'} /><span>객관식</span></label>
      <label class="switch"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''} /><span>주관식</span></label>
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항 내용" value="${q?.text||''}" />
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기 ${i+1}" value="${v}">`).join('')}
      </div>
      <div class="row">
        <span class="muted">정답 번호</span>
        <input class="ansIndex input xs" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
      </div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <input class="ansText input" data-no="${no}" placeholder="정답(선택, 자동채점용)" value="${q?.answerText||''}">
    </div>
  `;
  const radios=$$(`input[name="type-${no}"]`,wrap);
  const mcq=$(".mcq",wrap), short=$(".short",wrap);
  radios.forEach(r=>r.addEventListener("change",()=>{
    const isShort = radios.find(x=>x.checked)?.value==='short';
    mcq.classList.toggle("hide", isShort);
    short.classList.toggle("hide", !isShort);
  }));
  return wrap;
}
function collectBuilder(){
  const cards=$$("#builder>.qcard");
  const list=cards.map((c,idx)=>{
    const no=idx+1;
    const type=c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text=c.querySelector(".qtext").value.trim();
    if(!text) return null;
    if(type==='mcq'){
      const opts=$$(".opt",c).map(i=>i.value.trim()).filter(Boolean);
      const ans = Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans };
    } else {
      return { type:'short', text, answerText:c.querySelector(".ansText").value.trim() };
    }
  }).filter(Boolean);
  return { title: els.quizTitle?.value||"퀴즈", questions:list };
}

/***********************
 * Flow + Timer
 ***********************/
async function startQuiz(){
  if(!roomId) return;
  await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true });
}
async function step(delta){
  await runTransaction(db, async (tx)=>{
    const ref=roomRef(roomId);
    const snap=await tx.get(ref);
    const r=snap.data(); const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){ tx.update(ref, { currentIndex: total-1, mode:"ended", accept:false }); return; }
    next=Math.max(0,next);
    tx.update(ref, { currentIndex: next, accept:true });
  });
}
async function finishAll(){ if(confirm("퀴즈를 종료할까요?")) await updateDoc(roomRef(roomId), { mode:"ended", accept:false }); }

function startTimer(sec){
  stopTimer();
  const end = Date.now()+sec*1000;
  timerHandle=setInterval(async ()=>{
    const remain=Math.max(0, Math.floor((end-Date.now())/1000));
    const mm=pad(Math.floor(remain/60)), ss=pad(remain%60);
    if(els.leftSec)  els.leftSec.textContent  = `${mm}:${ss}`;
    if(els.leftSec2) els.leftSec2.textContent = `${mm}:${ss}`;
    if(remain<=0){
      stopTimer();
      await updateDoc(roomRef(roomId), { accept:false });
      setTimeout(()=> step(+1), 400);
    }
  }, 250);
}
function stopTimer(){
  if(timerHandle){ clearInterval(timerHandle); timerHandle=null; }
  if(els.leftSec)  els.leftSec.textContent="00:00";
  if(els.leftSec2) els.leftSec2.textContent="00:00";
}

/***********************
 * Submit / Grade
 ***********************/
async function join(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name=(els.studentName?.value||"").trim(); if(!name) return alert("이름을 입력하세요.");
  me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem("quiz.device", me.id);
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{}, alive:true }, { merge:true });
  alert("참가 완료!"); saveLocal();
  if(els.studentTopInfo) els.studentTopInfo.textContent = `세션: ${roomId} · 온라인 · ${name}`;
}
async function submit(value){
  const r=window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
  const ref=doc(respCol(roomId), me.id);
  const snap=await getDoc(ref); const prev=snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert("이미 제출했습니다.");
  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true), revealed:r.reveal||false } }, { merge:true });
}
async function grade(uid, qIndex, ok){
  await setDoc(doc(respCol(roomId), uid), { [`answers.${qIndex}.correct`]: !!ok, [`answers.${qIndex}.revealed`]: true }, { merge:true });
}

/***********************
 * Render
 ***********************/
function renderRoom(r){
  const total=r.questions?.length||0; const idx=r.currentIndex ?? -1;
  els.pTitle && (els.pTitle.textContent = r.title||roomId);
  els.progress && (els.progress.textContent = `${Math.max(0,idx+1)}/${total}`);
  if(els.chkAccept) els.chkAccept.checked=!!r.accept;
  if(els.chkReveal) els.chkReveal.checked=!!r.reveal;

  // 프레젠테이션: 대기/표시 전환
  if(r.mode!=='active' || idx<0){
    els.pWait?.classList.remove("hide");
    els.pCard?.classList.add("hide");
    els.pQ && (els.pQ.textContent = "문항이 여기에 표시됩니다.");
    els.pOpts && (els.pOpts.innerHTML = "");
  }else{
    els.pWait?.classList.add("hide");
    els.pCard?.classList.remove("hide");
    const q=r.questions[idx];
    els.pQ && (els.pQ.textContent=q.text);
    if(els.pOpts){
      els.pOpts.innerHTML="";
      if(q.type==='mcq'){
        q.options.forEach((t,i)=>{ const d=document.createElement("div"); d.className="popt"; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d); });
      }
    }
  }

  // 학생 화면
  if(MODE==='student'){
    if(r.mode!=='active' || idx<0){
      els.badgeType && (els.badgeType.textContent="대기");
      els.sQText && (els.sQText.textContent="대기 중입니다…");
      els.mcqBox && (els.mcqBox.innerHTML=""); els.shortBox && els.shortBox.classList.add("hide");
      return;
    }
    const q=r.questions[idx];
    els.badgeType && (els.badgeType.textContent = q.type==='mcq'?'객관식':'주관식');
    els.sQText && (els.sQText.textContent=q.text);

    if(q.type==='mcq'){
      if(els.mcqBox){
        els.mcqBox.innerHTML="";
        q.options.forEach((opt,i)=>{
          const b=document.createElement("button");
          b.className="btn"; b.textContent=`${i+1}. ${opt}`; b.disabled=!r.accept;
          b.addEventListener("click", ()=>submit(i));
          els.mcqBox.appendChild(b);
        });
      }
      els.shortBox && els.shortBox.classList.add("hide");
    } else {
      els.mcqBox && (els.mcqBox.innerHTML="");
      if(els.shortBox){ els.shortBox.classList.remove("hide"); els.btnShortSend && (els.btnShortSend.disabled=!r.accept); }
    }
  }
}

function renderResponses(list){
  // 통계(현재 문항 기준)
  const r=window.__room||{}; const idx=r.currentIndex ?? -1;
  const joined = list.length;
  const submitted = idx>=0 ? list.filter(s => s.answers?.[idx]!=null).length : 0;
  const correct = idx>=0 ? list.filter(s => s.answers?.[idx]?.correct===true).length : 0;
  const wrong = Math.max(0, submitted - correct);

  if(els.statJoined)    els.statJoined.textContent    = joined;
  if(els.statSubmitted) els.statSubmitted.textContent = submitted;
  if(els.statCorrect)   els.statCorrect.textContent   = correct;
  if(els.statWrong)     els.statWrong.textContent     = wrong;

  // 칩
  if(els.chips){
    els.chips.innerHTML="";
    list.forEach(s=>{
      const a=s.answers?.[idx]; const chip=document.createElement("div");
      chip.className="chip " + (a? (a.correct?'ok':'no') : 'wait');
      chip.textContent=s.name||s.id; els.chips.appendChild(chip);
    });
  }

  // 결과표
  if(MODE==='admin' && els.resultsTable){
    const tbl=document.createElement("table");
    const thead=document.createElement("thead"), tr=document.createElement("tr");
    ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수","상태"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; tr.appendChild(th); });
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb=document.createElement("tbody");
    list.forEach(s=>{
      let score=0; const tr=document.createElement("tr");
      const tdn=document.createElement("td"); tdn.textContent=s.name||s.id; tr.appendChild(tdn);
      (r.questions||[]).forEach((q,i)=>{
        const a=s.answers?.[i]; const td=document.createElement("td");
        td.textContent = a? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value??'-')) : '-';
        if(a?.correct) score++; tr.appendChild(td);
      });
      const tds=document.createElement("td"); tds.textContent=String(score); tr.appendChild(tds);
      const tdl=document.createElement("td"); tdl.textContent= s.alive===false? "out":"alive"; tr.appendChild(tdl);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
  }
}

/***********************
 * Link / QR
 ***********************/
function buildStudentLink(){
  if(!els.studentLink) return;
  const url=new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", roomId);
  els.studentLink.value=url.toString();
  if(window.QRCode && els.qrCanvas){
    try{ window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:192 }); }catch(e){}
  }
}

/***********************
 * Events
 ***********************/
els.btnAdmin?.addEventListener("click", ()=>{ setMode("admin"); saveLocal(); });
els.btnStudent?.addEventListener("click", ()=>{ setMode("student"); saveLocal(); });
els.btnConnect?.addEventListener("click", connect);

[els.tabBuild,els.tabControl,els.tabPresent,els.tabResults].forEach(btn=>{
  btn?.addEventListener("click", ()=>{
    [els.tabBuild,els.tabControl,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
    btn.classList.add("active");
    els.pBuild?.classList.toggle("hide", btn!==els.tabBuild || MODE!=="admin");
    els.pControl?.classList.toggle("hide", btn!==els.tabControl || MODE!=="admin");
    els.pPresent?.classList.toggle("hide", btn!==els.tabPresent ? true:false);
    els.pResults?.classList.toggle("hide", btn!==els.tabResults || MODE!=="admin");
  });
});

els.btnBuildForm?.addEventListener("click", ()=>{
  const n=Math.max(1,Math.min(20, parseInt(els.questionCount?.value,10)||3));
  if(els.builder){ els.builder.innerHTML=""; for(let i=0;i<n;i++) els.builder.appendChild(cardRow(i+1)); }
});
els.btnLoadSample?.addEventListener("click", ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
    {type:'mcq', text:'바다의 소금기는 어디서 올까요?', options:['소금산','강물의 광물질','하늘','바람'], answerIndex:1},
  ];
  if(els.builder){ els.builder.innerHTML=""; S.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q))); }
  if(els.quizTitle) els.quizTitle.value="샘플 퀴즈";
  if(els.questionCount) els.questionCount.value=S.length;
});
els.btnSaveQuiz?.addEventListener("click", async ()=>{
  const payload=collectBuilder(); if(!payload.questions.length) return alert("문항을 추가하세요.");
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("저장 완료!");
  buildStudentLink();
});

els.btnStart?.addEventListener("click", startQuiz);
els.btnPrev?.addEventListener("click", ()=>step(-1));
els.btnNext?.addEventListener("click", ()=>step(+1));
els.btnEndAll?.addEventListener("click", finishAll);

els.chkAccept?.addEventListener("change", ()=> updateDoc(roomRef(roomId), { accept: !!els.chkAccept.checked }));
els.chkReveal?.addEventListener("change", ()=> updateDoc(roomRef(roomId), { reveal: !!els.chkReveal.checked }));

els.btnTimerGo?.addEventListener("click", ()=> startTimer(Math.max(5,Math.min(600, parseInt(els.timerSec?.value,10)||30))));
els.btnTimerStop?.addEventListener("click", stopTimer);

els.btnCopyLink?.addEventListener("click", async ()=>{
  if(!els.studentLink) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="링크 복사", 1200);
});
els.btnOpenStudent?.addEventListener("click", ()=> window.open(els.studentLink?.value||"#","_blank"));

els.btnExportCSV?.addEventListener("click", async ()=>{
  const r=(await getDoc(roomRef(roomId))).data();
  const snap=await getDocs(respCol(roomId));
  const rows=[]; rows.push(["userId","name",...(r.questions||[]).map((_,i)=>`Q${i+1}`),"score"].join(","));
  snap.forEach(d=>{
    const s=d.data(); let score=0;
    const answers=(r.questions||[]).map((q,i)=>{ const a=s.answers?.[i]; if(a?.correct) score++; return q.type==='mcq' ? (typeof a?.value==='number'? a.value+1 : "") : (a?.value??""); });
    rows.push([d.id, `"${(s.name||"").replace(/"/g,'""')}"`, ...answers, score].join(","));
  });
  const blob=new Blob([rows.join("\n")],{type:"text/csv"}); const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=`${r.title||roomId}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
});

els.btnResetAll?.addEventListener("click", async ()=>{
  if(!confirm("모든 응답/점수를 초기화할까요?")) return;
  await setDoc(roomRef(roomId), { mode:"idle", currentIndex:-1, accept:false, reveal:false }, { merge:true });
  const snap=await getDocs(respCol(roomId)); const tasks=[];
  snap.forEach(d=> tasks.push(setDoc(doc(respCol(roomId), d.id), { answers:{}, alive:true }, { merge:true })));
  await Promise.all(tasks); alert("초기화 완료");
});

els.btnJoin?.addEventListener("click", join);
els.btnShortSend?.addEventListener("click", ()=> submit((els.shortInput?.value||"").trim()));

/***********************
 * Boot
 ***********************/
autoReconnect();

// URL로 바로 학생 모드 열기: ?role=student&room=class1
(function fromURL(){
  const url=new URL(location.href);
  const role=url.searchParams.get("role"); const rid=url.searchParams.get("room");
  if(role==='student') setMode("student");
  if(rid){ els.roomId && (els.roomId.value=rid); connect(); }
})();
