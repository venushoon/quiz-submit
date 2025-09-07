/***********************
 * Firebase
 ***********************/
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc,
  collection, getDocs, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ▶ 프로젝트 설정값 (요청하신 값)
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
const pad = (n)=>String(n).padStart(2,'0');

let MODE   = "admin";              // 'admin' | 'student'
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;
let selectedMCQ = null;            // 학생 객관식 선택값(제출 버튼용)

const els = {
  liveDot: $("#liveDot"),
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), roomStatus: $("#roomStatus"), connBadge: $("#connBadge"),
  btnAdmin: $("#btnAdmin"), btnStudent: $("#btnStudent"), btnLogout: $("#btnLogout"),
  tabBuild: $("#tabBuild"), tabControl: $("#tabControl"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"), pControl: $("#panelControl"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"), btnBuildForm: $("#btnBuildForm"),
  btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"), builder: $("#builder"),
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"),
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"),
  chkAutoNext: $("#chkAutoNext"), chkProjector: $("#chkProjector"), btnSaveOptions: $("#btnSaveOptions"),
  timerSec: $("#timerSec"), btnTimerGo: $("#btnTimerGo"), btnTimerStop: $("#btnTimerStop"), leftSec: $("#leftSec"),
  btnEndAll: $("#btnEndAll"),
  nowQuestion: $("#nowQuestion"), progress: $("#progress"),
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),
  shareCard: $("#shareCard"),
  chips: $("#chips"), shortAnswers: $("#shortAnswers"),
  btnExportCSV: $("#btnExportCSV"), resultsTable: $("#resultsTable"),
  btnLeaderboardFull: $("#btnLeaderboardFull"),
  btnResetAll: $("#btnResetAll"), btnSaveJSON: $("#btnSaveJSON"), fileLoad: $("#fileLoad"),
  studentPanel: $("#studentPanel"), studentName: $("#studentName"), btnJoin: $("#btnJoin"),
  badgeType: $("#badgeType"), sQText: $("#sQText"), mcqBox: $("#mcqBox"),
  mcqSubmitWrap: $("#mcqSubmitWrap"), btnMCQSubmit: $("#btnMCQSubmit"),
  shortBox: $("#shortBox"), shortInput: $("#shortInput"), btnShortSend: $("#btnShortSend"),
  guideAdmin: $("#guideAdmin"), guideStudent: $("#guideStudent"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pOpts: $("#pOpts"),
  sHeaderSession: $("#sHeaderSession"), sHeaderOnline: $("#sHeaderOnline"), sHeaderName: $("#sHeaderName"),
  statJoined: $("#statJoined"), statSubmitted: $("#statSubmitted"), statCorrect: $("#statCorrect"), statWrong: $("#statWrong"),
};

/***********************
 * Local storage
 ***********************/
function saveLocal(){ localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me })); }
function loadLocal(){
  try{
    const d=JSON.parse(localStorage.getItem("quiz.live")||"{}");
    roomId=d.roomId||""; MODE=d.MODE||"admin";
    // 이름 자동 고정 문제 방지: role=student 링크로 진입시 me.name 초기화
    me = d.me || { id:null, name:"" };
    if(roomId) els.roomId.value=roomId;
  }catch{}
}

/***********************
 * Firestore refs
 ***********************/
const roomRef = (id)=>doc(db,"rooms",id);
const respCol = (id)=>collection(db,"rooms",id,"responses");

/***********************
 * Room lifecycle
 ***********************/
async function ensureRoom(id){
  const snap=await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션",
      mode:"idle",
      currentIndex:-1,
      accept:false,
      reveal:false,
      autoNext:false,
      projector:false,
      policy:"device", // 'device'|'realname'
      createdAt: serverTimestamp(),
      questions:[]
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
 * Mode / Connect / Logout
 ***********************/
function setMode(m){
  MODE=m;
  // 탭: 학생 모드에서는 문항/옵션/결과는 숨기고 프레젠테이션도 숨김
  const admin = m==="admin";
  els.pBuild.classList.toggle("hide", !admin);
  els.pControl.classList.toggle("hide", !admin);
  els.pResults.classList.toggle("hide", !admin);
  els.pPresent.classList.toggle("hide", false); // 프레젠테이션은 관리자 기본 노출
  els.studentPanel.classList.toggle("hide", admin);

  // 가이드
  els.guideAdmin.classList.toggle("hide", !admin);
  els.guideStudent.classList.toggle("hide", admin);

  // 상단 상태
  els.roomStatus.textContent = roomId ? `세션: ${roomId} · 온라인` :
    (admin ? "관리자 모드: 세션에 접속해 주세요." : "학생 모드: 세션 접속 후 참가하세요.");
  els.connBadge.textContent = roomId ? "온라인" : "오프라인";
  els.connBadge.className = `badge ${roomId?'':'gray'}`;
  els.liveDot.style.opacity = roomId ? '1' : '0.3';

  // 기본 탭: 문항만들기 활성화
  [els.tabBuild,els.tabControl,els.tabPresent,els.tabResults].forEach(b=>b.classList.remove("active"));
  if(admin){ els.tabBuild.classList.add("active"); showPanel("build"); }
  else { showPanel(null); } // 학생은 패널 숨김 유지
}
function showPanel(which){
  els.pBuild.classList.toggle("hide", which!=="build");
  els.pControl.classList.toggle("hide", which!=="control");
  els.pPresent.classList.toggle("hide", which!=="present");
  els.pResults.classList.toggle("hide", which!=="results");
}
async function connect(){
  const id=(els.roomId.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId=id; await ensureRoom(roomId);
  listenRoom(roomId); listenResponses(roomId);
  buildStudentLink(false); // 아직 옵션 저장 전이면 QR 숨김
  els.roomStatus.textContent=`세션: ${roomId} · 온라인`;
  els.connBadge.textContent="온라인"; els.connBadge.className="badge";
  els.liveDot.style.opacity='1';
  saveLocal();
}
function logout(){
  // 연결 해제(세션만 해제, 데이터는 유지)
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  unsubRoom=unsubResp=null; roomId=""; els.roomId.value="";
  els.roomStatus.textContent="관리자 모드: 세션에 접속해 주세요.";
  els.connBadge.textContent="오프라인"; els.connBadge.className="badge gray";
  els.liveDot.style.opacity='0.3';
  els.shareCard.classList.add("hide");
  saveLocal();
}

/***********************
 * Builder (문항)
 ***********************/
function cardRow(no,q){
  const wrap=document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">Q${no}</span>
      <label class="check"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'} /> 객관식</label>
      <label class="check"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''} /> 주관식</label>
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항 내용" value="${q?.text||''}" />
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기 ${i+1}" value="${v}">`).join('')}
      </div>
      <div class="row">
        <span class="muted">정답 번호</span>
        <input class="ansIndex input xs mono" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
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
 * Options save (정책/밝기/자동다음/표시)
 ***********************/
async function saveOptions(){
  if(!roomId) return alert("세션 먼저 연결하세요.");
  const policy = (document.querySelector('input[name="policy"]:checked')?.value)||"device";
  await setDoc(roomRef(roomId), {
    policy,
    autoNext: !!els.chkAutoNext.checked,
    projector: !!els.chkProjector.checked,
    reveal: !!els.chkReveal.checked,
    accept: !!els.chkAccept.checked
  }, { merge:true });

  // 옵션 저장 후 학생용 링크/QR 표시
  buildStudentLink(true);
  alert("옵션 저장 완료!");
}

/***********************
 * Flow + Timer(자동다음)
 ***********************/
async function startQuiz(){ 
  await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true }); 
}
async function step(delta){
  await runTransaction(db, async (tx)=>{
    const ref=roomRef(roomId);
    const snap=await tx.get(ref);
    const r=snap.data(); const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){ // 종료 → 결과 탭으로 유도
      tx.update(ref, { currentIndex: total-1, mode:"ended", accept:false });
      showPanel("results"); [els.tabBuild,els.tabControl,els.tabPresent,els.tabResults].forEach(b=>b.classList.remove("active"));
      els.tabResults.classList.add("active");
      return;
    }
    next=Math.max(0,next);
    tx.update(ref, { currentIndex: next, accept:true });
  });
}
async function finishAll(){ if(confirm("퀴즈를 종료할까요?")){ await updateDoc(roomRef(roomId), { mode:"ended", accept:false }); showPanel("results"); els.tabResults.classList.add("active"); } }

function startTimer(sec){
  stopTimer();
  const end = Date.now()+sec*1000;
  timerHandle=setInterval(async ()=>{
    const remain=Math.max(0, Math.floor((end-Date.now())/1000));
    els.leftSec.textContent = `${pad(Math.floor(remain/60))}:${pad(remain%60)}`;
    if(remain<=0){
      stopTimer();
      await updateDoc(roomRef(roomId), { accept:false });
      const r=window.__room;
      if(r?.autoNext){ setTimeout(()=> step(+1), 600); }
    }
  }, 250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } els.leftSec.textContent="00:00"; }

/***********************
 * Student join / Submit
 ***********************/
async function join(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name=(els.studentName.value||"").trim(); if(!name) return alert("이름을 입력하세요.");

  // 정책에 따른 키
  const policy = window.__room?.policy || "device";
  const key = (policy==="realname") ? name : (localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10));
  if(policy==="device") localStorage.setItem("quiz.device", key);

  me = { id:key, name };
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{}, alive:true }, { merge:true });
  alert("참가 완료! 문제를 기다려 주세요.");
  els.sHeaderName.textContent = `· ${name}`;
  saveLocal();
}
async function submit(value){
  const r=window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
  if(!me.id) return alert("먼저 참가하세요.");

  const ref=doc(respCol(roomId), me.id);
  const snap=await getDoc(ref); const prev=snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert("이미 제출했습니다.");

  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true), revealed:r.reveal||false } }, { merge:true });

  // 제출 반응
  if(MODE==='student'){
    if(q.type==='mcq'){ alert("제출되었습니다!"); }
    else { els.shortInput.value=""; alert("제출되었습니다!"); }
  }
}

/***********************
 * Render
 ***********************/
function renderRoom(r){
  const total=r.questions?.length||0; const idx=r.currentIndex;
  els.progress.textContent = `${Math.max(0,idx+1)}/${total}`;
  els.nowQuestion.textContent = (idx>=0 && r.questions[idx])? r.questions[idx].text : "-";
  // 프레젠테이션 밝기 모드
  els.pPresent.querySelector(".present").classList.toggle("bright", !!r.projector);

  // 프레젠테이션 본문
  els.pTitle.textContent = r.title||roomId||"퀴즈";
  els.pOpts.innerHTML="";
  if(idx>=0 && r.questions[idx]){
    const q=r.questions[idx]; $("#pQ").textContent=q.text;
    if(q.type==='mcq'){
      q.options.forEach((t,i)=>{ const d=document.createElement("div"); d.className="popt"; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d); });
    } else {
      $("#pQ").textContent = q.text + " (주관식)";
    }
  } else { $("#pQ").textContent="대기 중…"; }

  // 통계(제출/정답/오답)는 responses 스냅샷에서 업데이트

  // 학생 화면 상단 헤더
  els.sHeaderSession.textContent = `세션 ${roomId||'-'}`;
  els.sHeaderOnline.textContent = roomId ? "온라인" : "오프라인";
  els.sHeaderOnline.className = `badge ${roomId?'':'gray'}`;
  els.sHeaderName.textContent = me.name ? `· ${me.name}` : "";

  // 학생 화면 문제 표시
  if(MODE==='student'){
    if(r.mode!=='active' || idx<0){
      els.badgeType.textContent="대기"; els.sQText.textContent="대기 중입니다…";
      els.mcqBox.innerHTML=""; els.shortBox.classList.add("hide"); els.mcqSubmitWrap.classList.add("hide");
      selectedMCQ = null;
      return;
    }
    const q=r.questions[idx];
    els.badgeType.textContent = q.type==='mcq'?'객관식':'주관식';
    els.sQText.textContent=q.text;

    if(q.type==='mcq'){
      els.mcqBox.innerHTML="";
      q.options.forEach((opt,i)=>{
        const b=document.createElement("button");
        b.className="optbtn"; b.textContent=`${i+1}. ${opt}`; b.disabled=!r.accept;
        b.addEventListener("click", ()=>{
          selectedMCQ=i;
          // 시각적 선택 표시
          $$(".optbtn", els.mcqBox).forEach(x=>x.classList.remove("selected"));
          b.classList.add("selected");
        });
        els.mcqBox.appendChild(b);
      });
      els.mcqSubmitWrap.classList.remove("hide");
      $("#btnMCQSubmit").disabled = !r.accept;
    } else {
      els.mcqBox.innerHTML="";
      els.mcqSubmitWrap.classList.add("hide");
      els.shortBox.classList.remove("hide");
      els.btnShortSend.disabled = !r.accept;
    }
  }
}
function renderResponses(list){
  // 통계
  const r=window.__room||{}; const idx=r.currentIndex; const q=r.questions?.[idx];
  let joined=list.length, submitted=0, correct=0, wrong=0;
  list.forEach(s=>{
    const a=s.answers?.[idx];
    if(a){ submitted++; if(a.correct) correct++; else wrong++; }
  });
  els.statJoined.textContent=joined;
  els.statSubmitted.textContent=submitted;
  els.statCorrect.textContent=correct;
  els.statWrong.textContent=wrong;

  // 결과표(리더보드: 점수순 정렬)
  if(els.resultsTable){
    const scores=list.map(s=>{
      let score=0; (r.questions||[]).forEach((q,i)=>{ if(s.answers?.[i]?.correct) score++; });
      return { id:s.id, name:s.name||s.id, score, alive: s.alive!==false };
    }).sort((a,b)=>b.score-a.score);

    const tbl=document.createElement("table");
    const thead=document.createElement("thead"), tr=document.createElement("tr");
    ["순위","이름","점수","상태"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; tr.appendChild(th); });
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb=document.createElement("tbody");
    scores.forEach((s,rank)=>{
      const tr=document.createElement("tr");
      tr.innerHTML = `<td>${rank+1}</td><td>${s.name}</td><td>${s.score}</td><td>${s.alive?'alive':'out'}</td>`;
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
  }
}

/***********************
 * Link / QR
 ***********************/
function buildStudentLink(show){
  const url=new URL(location.href);
  url.searchParams.set("role","student");
  if(roomId) url.searchParams.set("room", roomId);
  els.studentLink.value=url.toString();

  if(show){ // 옵션을 저장해야 QR 보임
    els.shareCard.classList.remove("hide");
    if(window.QRCode && els.qrCanvas){
      window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:192 }, (err)=>{ if(err) console.warn(err); });
    }
  }else{
    els.shareCard.classList.add("hide");
  }
}

/***********************
 * Events
 ***********************/
els.btnAdmin.addEventListener("click", ()=>{ setMode("admin"); saveLocal(); });
els.btnStudent.addEventListener("click", ()=>{ setMode("student"); saveLocal(); });
els.btnLogout.addEventListener("click", logout);

[els.tabBuild,els.tabControl,els.tabPresent,els.tabResults].forEach(btn=>{
  btn.addEventListener("click", ()=>{
    [els.tabBuild,els.tabControl,els.tabPresent,els.tabResults].forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    if(btn===els.tabBuild) showPanel("build");
    if(btn===els.tabControl) showPanel("control");
    if(btn===els.tabPresent) showPanel("present");
    if(btn===els.tabResults) showPanel("results");
  });
});

// 연결/공유
els.btnConnect.addEventListener("click", connect);
els.btnCopyLink.addEventListener("click", async ()=>{
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="링크 복사", 1200);
});
els.btnOpenStudent.addEventListener("click", ()=> window.open(els.studentLink.value||"#","_blank"));

// 문항
els.btnBuildForm.addEventListener("click", ()=>{
  const n=Math.max(1,Math.min(20, parseInt(els.questionCount.value,10)||3));
  els.builder.innerHTML=""; for(let i=0;i<n;i++) els.builder.appendChild(cardRow(i+1));
});
els.btnLoadSample.addEventListener("click", ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
    {type:'mcq', text:'태양계의 별 이름은?', options:['Milky','Solar','Lunar','Galaxy'], answerIndex:1},
  ];
  els.builder.innerHTML=""; S.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q)));
  els.quizTitle.value="샘플 퀴즈"; els.questionCount.value=S.length;
});
els.btnSaveQuiz.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션 먼저 연결하세요.");
  const payload=collectBuilder(); if(!payload.questions.length) return alert("문항을 추가하세요.");
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("문항 저장 완료!");
});

// 옵션 저장
els.btnSaveOptions.addEventListener("click", saveOptions);

// 진행 컨트롤
els.btnStart.addEventListener("click", startQuiz);
els.btnPrev.addEventListener("click", ()=>step(-1));
els.btnNext.addEventListener("click", ()=>step(+1));
els.btnEndAll.addEventListener("click", finishAll);

// 제출 허용/정답 공개 토글은 옵션 저장으로 반영되므로 즉시 DB 반영은 하지 않음
els.btnTimerGo.addEventListener("click", ()=> startTimer(Math.max(5,Math.min(600, parseInt(els.timerSec.value,10)||30))));
els.btnTimerStop.addEventListener("click", stopTimer);

// 데이터
els.btnExportCSV.addEventListener("click", async ()=>{
  const r=(await getDoc(roomRef(roomId))).data();
  const snap=await getDocs(respCol(roomId));
  const rows=[]; rows.push(["rank","userId","name",...(r.questions||[]).map((_,i)=>`Q${i+1}`),"score"].join(","));
  // 점수 계산 후 정렬
  const records=[];
  snap.forEach(d=>{
    const s=d.data();
    let score=0; const answers=(r.questions||[]).map((q,i)=>{ const a=s.answers?.[i]; if(a?.correct) score++; return q.type==='mcq' ? (typeof a?.value==='number'? a.value+1 : "") : (a?.value??""); });
    records.push({ id:d.id, name:s.name||d.id, answers, score });
  });
  records.sort((a,b)=>b.score-a.score);
  records.forEach((rec,idx)=> rows.push([idx+1, rec.id, `"${rec.name.replace(/"/g,'""')}"`, ...rec.answers, rec.score].join(",")));
  const blob=new Blob([rows.join("\n")],{type:"text/csv"}); const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=`${(r.title||roomId)}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
});
els.btnResetAll.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션 먼저 연결하세요.");
  if(!confirm("세션의 모든 데이터(응답/점수/상태)를 초기화합니다. 계속할까요?")) return;
  await setDoc(roomRef(roomId), {
    mode:"idle", currentIndex:-1, accept:false, reveal:false
  }, { merge:true });
  const snap=await getDocs(respCol(roomId)); const tasks=[];
  snap.forEach(d=> tasks.push(setDoc(doc(respCol(roomId), d.id), { answers:{}, alive:true }, { merge:true })));
  await Promise.all(tasks);
  alert("초기화 완료 (세션/문항은 유지, 응답/점수만 초기화)");
});
els.btnSaveJSON.addEventListener("click", async ()=>{
  const r=(await getDoc(roomRef(roomId))).data();
  const res=await getDocs(respCol(roomId));
  const obj={ roomId, room:r, responses: res.docs.map(d=>({ id:d.id, ...d.data() })) };
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:"application/json"}));
  a.download=`${roomId}-backup.json`; a.click(); URL.revokeObjectURL(a.href);
});
els.fileLoad.addEventListener("change", async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const data=JSON.parse(await f.text());
  if(data.room) await setDoc(roomRef(roomId), data.room, { merge:true });
  if(Array.isArray(data.responses)) await Promise.all(data.responses.map(x=> setDoc(doc(respCol(roomId), x.id), x, { merge:true })));
  alert("불러오기 완료"); e.target.value="";
});

// 학생 이벤트
els.btnJoin.addEventListener("click", join);
els.btnShortSend.addEventListener("click", ()=> submit((els.shortInput.value||"").trim()));
els.btnMCQSubmit.addEventListener("click", ()=>{
  if(selectedMCQ==null) return alert("보기를 선택하세요.");
  submit(selectedMCQ);
});

// 리더보드 전체화면
els.btnLeaderboardFull.addEventListener("click", ()=>{
  // 간단: 결과 테이블만 보이도록 새 창
  window.open(location.href + "#results-full", "_blank");
});

/***********************
 * Boot
 ***********************/
function autoReconnect(){
  loadLocal();
  setMode(MODE);      // ▶ 기본 탭을 문항만들기로 맞춤
  if(roomId) connect();
}
autoReconnect();

// URL 진입: ?role=student&room=xxx
(function fromURL(){
  const url=new URL(location.href);
  const role=url.searchParams.get("role");
  const rid =url.searchParams.get("room");
  if(role==='student'){
    setMode("student");
    // 학생 링크로 열린 경우 이전 이름 자동 사용 방지
    me = { id:null, name:"" }; saveLocal();
  }
  if(rid){ els.roomId.value=rid; connect(); }
})();
