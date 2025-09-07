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
  projectId:  "live-quiz-a14d1",
};
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

/***********************
 * Helpers & State
 ***********************/
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));
const pad = n=>String(n).padStart(2,'0');

let MODE   = "admin";       // 'admin' | 'student'
let roomId = "";            // 접속 전: 빈 값(세션아웃 상태)
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let mcqPick=null;           // 학생 MCQ 선택
let timerHandle=null;

const els = {
  // header & tabs
  adminTop: $("#adminTop"),
  liveDot: $("#liveDot"),
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnSignOut: $("#btnSignOut"),
  roomStatus: $("#roomStatus"),
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),

  // panels
  panelBuild: $("#panelBuild"), panelOptions: $("#panelOptions"),
  panelPresent: $("#panelPresent"), panelResults: $("#panelResults"),

  // builder
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"),
  builder: $("#builder"), fileUploadTxt: $("#fileUploadTxt"), btnUploadTxt: $("#btnUploadTxt"),
  btnDownloadTemplate: $("#btnDownloadTemplate"),

  // options
  policyDevice: $("#policyDevice"), policyName: $("#policyName"),
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright: $("#chkBright"),
  timerSec: $("#timerSec"), btnSaveOptions: $("#btnSaveOptions"),
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

  // present
  presentWait: $("#presentWait"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pImg: $("#pImg"), pOpts: $("#pOpts"),
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  leftSec: $("#leftSec"),
  statJoin: $("#statJoin"), statSubmit: $("#statSubmit"), statCorrect: $("#statCorrect"), statWrong: $("#statWrong"),

  // results
  btnExportCSV: $("#btnExportCSV"), btnResetAll: $("#btnResetAll"), resultsTable: $("#resultsTable"),

  // student
  studentPanel: $("#studentPanel"), studentTopInfo: $("#studentTopInfo"),
  studentJoin: $("#studentJoin"), studentName: $("#studentName"), btnJoin: $("#btnJoin"),
  studentQuiz: $("#studentQuiz"), sImg: $("#sImg"), sQText: $("#sQText"),
  badgeType: $("#badgeType"), mcqBox: $("#mcqBox"), btnSubmitMCQ: $("#btnSubmitMCQ"),
  shortBox: $("#shortBox"), shortInput: $("#shortInput"), btnShortSend: $("#btnShortSend"),
  studentTimer: $("#studentTimer"), studentDone: $("#studentDone"),
  studentResult: $("#studentResult"), studentResultBody: $("#studentResultBody"),
};

/***********************
 * Local helpers
 ***********************/
function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }
function csvEsc(v){ if(v==null) return ""; const s=String(v); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; }

/***********************
 * Firestore refs
 ***********************/
const roomRef = id => doc(db, "rooms", id);
const respCol = id => collection(db, "rooms", id, "responses");

/***********************
 * Mode switching
 ***********************/
function setMode(m){
  MODE = m;
  // 관리자 상단은 관리자 모드에서만 표시
  els.adminTop.classList.toggle("hide", m!=="admin");
  // 학생 패널은 학생 모드에서만 표시
  els.studentPanel.classList.toggle("hide", m!=="student");
}

/***********************
 * Session connect / logout
 ***********************/
async function ensureRoom(id){
  const snap=await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), { title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false, bright:false, timerSec:30, policy:"device" });
  }
}
async function connect(){
  const id=(els.roomId.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId=id; await ensureRoom(roomId);
  listenRoom(roomId); listenResponses(roomId);
  els.roomId.disabled = true;
  els.btnConnect.classList.add("hide");
  els.btnSignOut.classList.remove("hide");
  els.liveDot.classList.add("on");
  els.roomStatus.textContent = `세션: ${roomId} · 온라인`;
  // 옵션 탭에서 QR 갱신을 위해 즉시 생성(한 번)
  buildStudentLink();
}
function logout(){
  roomId=""; if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  els.roomId.disabled=false; els.roomId.value="";
  els.btnConnect.classList.remove("hide");
  els.btnSignOut.classList.add("hide");
  els.liveDot.classList.remove("on");
  els.roomStatus.textContent="세션: - · 오프라인";
}

/***********************
 * Listeners
 ***********************/
function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom = onSnapshot(roomRef(id),(snap)=>{
    if(!snap.exists()) return;
    const r=snap.data(); window.__room=r;
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
 * Builder (이미지 포함)
 ***********************/
function buildCard(no,q={}){
  const wrap=document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap gap">
      <span class="badge">${no}번</span>
      <label class="radio"><input type="radio" name="type-${no}" value="mcq" ${q.type==='short'?'':'checked'}> 객관식</label>
      <label class="radio"><input type="radio" name="type-${no}" value="short" ${q.type==='short'?'checked':''}> 주관식</label>
      <label class="imgbtn">
        <span>🖼️</span><strong>이미지</strong>
        <input type="file" accept="image/*" />
      </label>
      <img class="qthumb ${q.imageData?'':'hide'}" src="${q.imageData||''}" alt="thumb"/>
    </div>
    <input class="qtext input" placeholder="문항" value="${q.text||''}" />
    <div class="mcq ${q.type==='short'?'hide':''}">
      <div class="grid-4">
        ${(q.options||['','','','']).map((v,i)=>`<input class="opt input" data-idx="${i}" placeholder="보기${i+1}" value="${v||''}">`).join('')}
      </div>
      <div class="row wrap gap mt">
        <span class="muted">정답 번호</span>
        <input class="ansIndex input sm" type="number" min="1" max="10" value="${(q.answerIndex??0)+1}">
      </div>
    </div>
    <div class="short ${q.type==='short'?'':'hide'}">
      <input class="ansText input" placeholder="정답(선택)" value="${q.answerText||''}">
    </div>
  `;
  // 타입 토글
  const radios=$$(`input[name="type-${no}"]`,wrap);
  const mcq = wrap.querySelector(".mcq");
  const short = wrap.querySelector(".short");
  radios.forEach(r=>r.addEventListener("change",()=>{
    const isShort = radios.find(x=>x.checked)?.value==='short';
    mcq.classList.toggle("hide", isShort);
    short.classList.toggle("hide", !isShort);
  }));
  // 이미지 업로드
  const file=wrap.querySelector('input[type="file"]');
  const thumb=wrap.querySelector('.qthumb');
  file.addEventListener("change", async (e)=>{
    const f=e.target.files?.[0]; if(!f) return;
    const reader=new FileReader();
    reader.onload=()=>{ thumb.src=reader.result; thumb.classList.remove('hide'); wrap.dataset.imageData=reader.result; };
    reader.readAsDataURL(f);
  });
  if(q.imageData) wrap.dataset.imageData = q.imageData;
  return wrap;
}
function buildForm(n=3){
  els.builder.innerHTML=""; for(let i=0;i<n;i++) els.builder.appendChild(buildCard(i+1));
}
function loadSample(){
  const S=[
    {type:'mcq', text:'가장 큰 행성?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
    {type:'mcq', text:'태양의 별종류는?', options:['백색왜성','주계열성','중성자별','블랙홀'], answerIndex:1}
  ];
  els.builder.innerHTML=""; S.forEach((q,i)=> els.builder.appendChild(buildCard(i+1,q)));
}
function collectQuiz(){
  const cards=$$("#builder>.qcard");
  const list=cards.map((card,idx)=>{
    const no=idx+1;
    const type=card.querySelector(`input[name="type-${no}"]:checked`).value;
    const text=card.querySelector(".qtext").value.trim();
    const imageData=card.dataset.imageData||"";
    if(!text) return null;
    if(type==='mcq'){
      const opts=$$(".opt",card).map(x=>x.value.trim()).filter(Boolean);
      const ans=clamp((parseInt(card.querySelector(".ansIndex").value,10)||1)-1,0,Math.max(0,opts.length-1));
      return { type:'mcq', text, options:opts, answerIndex:ans, imageData };
    }else{
      const answerText=card.querySelector(".ansText").value.trim();
      return { type:'short', text, answerText, imageData };
    }
  }).filter(Boolean);
  return { title: els.quizTitle.value||"퀴즈", questions:list };
}

/***********************
 * Options / Link / QR
 ***********************/
function buildStudentLink(){
  if(!roomId) return;
  const url=new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", roomId);
  els.studentLink.value = url.toString();
  // QR
  if(window.QRCode && els.qrCanvas){
    try{ window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:128 }, ()=>{}); }
    catch(e){ console.warn("QR 실패", e); }
  }
}

/***********************
 * Present & Timer
 ***********************/
function startTimer(sec){
  stopTimer();
  if(!sec || sec<=0) return;
  const end=Date.now()+sec*1000;
  timerHandle=setInterval(async ()=>{
    const remain=Math.max(0, Math.floor((end-Date.now())/1000));
    els.leftSec.textContent = `${pad(Math.floor(remain/60))}:${pad(remain%60)}`;
    els.studentTimer.textContent = els.leftSec.textContent;
    if(remain<=0){
      stopTimer();
      await updateDoc(roomRef(roomId), { accept:false });
      // 자동 다음
      step(+1);
    }
  }, 250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } els.leftSec.textContent="00:00"; els.studentTimer.textContent=""; }

/***********************
 * Actions
 ***********************/
async function saveQuiz(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const payload=collectQuiz();
  if(!payload.questions.length) return alert("문항을 추가하세요.");
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("저장 완료!");
}
async function saveOptions(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const policy = els.policyName.checked ? "name" : "device";
  const bright = !!els.chkBright.checked;
  const accept = !!els.chkAccept.checked;
  const reveal = !!els.chkReveal.checked;
  const timerSec = clamp(parseInt(els.timerSec.value,10)||30, 5, 600);
  await setDoc(roomRef(roomId), { policy, bright, accept, reveal, timerSec }, { merge:true });
  // 저장 즉시 학생 링크/QR 갱신
  buildStudentLink();
  // 밝은 프레젠테이션 모드 적용
  document.body.classList.toggle("bright", bright);
  alert("옵션 저장 완료!");
}
async function startQuiz(){
  if(!roomId) return;
  await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true });
  // 타이머 자동 시작(설정값 사용)
  const r=(await getDoc(roomRef(roomId))).data(); startTimer(r?.timerSec||0);
}
async function step(delta){
  if(!roomId) return;
  await runTransaction(db, async (tx)=>{
    const ref=roomRef(roomId);
    const snap=await tx.get(ref); const r=snap.data();
    const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){
      // 종료 & 결과 탭 이동
      tx.update(ref, { mode:"ended", accept:false, currentIndex: total-1 });
      setTimeout(()=> activateTab("results"), 100);
      return;
    }
    next=clamp(next,0,Math.max(0,total-1));
    tx.update(ref, { currentIndex: next, accept:true });
  });
  // 새 문제로 넘어가면 타이머 재시작
  const r=(await getDoc(roomRef(roomId))).data(); startTimer(r?.timerSec||0);
}
async function endAll(){
  if(!roomId) return;
  await updateDoc(roomRef(roomId), { mode:"ended", accept:false });
  stopTimer(); activateTab("results");
}
async function resetAll(){
  if(!roomId) return;
  if(!confirm("모든 응답/점수를 초기화할까요?")) return;
  await setDoc(roomRef(roomId), { mode:"idle", currentIndex:-1, accept:false, reveal:false }, { merge:true });
  const snap=await getDocs(respCol(roomId)); const tasks=[];
  snap.forEach(d=> tasks.push(setDoc(doc(respCol(roomId), d.id), { answers:{}, alive:true }, { merge:true })));
  await Promise.all(tasks);
  alert("초기화 완료");
}

/***********************
 * Student: join/submit
 ***********************/
async function join(){
  if(!roomId) return alert("세션이 준비되지 않았습니다.");
  const name=(els.studentName.value||"").trim(); if(!name) return alert("이름 또는 번호를 입력하세요!");
  me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem("quiz.device", me.id);
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt: serverTimestamp(), answers:{}, alive:true }, { merge:true });
  els.studentJoin.classList.add("hide");
  els.studentQuiz.classList.remove("hide");
  els.sQText.textContent="제출 버튼을 눌러주세요.";
}
async function submitMCQ(){
  const r=window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=r.currentIndex; if(idx==null || idx<0) return;
  if(mcqPick==null) return alert("보기를 선택하세요.");
  const q=r.questions?.[idx]; if(!q) return;
  let correct = (mcqPick === (q.answerIndex??-999));
  await setDoc(doc(respCol(roomId), me.id), { [`answers.${idx}`]: { value: mcqPick, correct, revealed:r.reveal||false } }, { merge:true });
  els.studentDone.classList.remove("hide");
  setTimeout(()=> els.studentDone.classList.add("hide"), 1200);
}
async function submitShort(){
  const r=window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=r.currentIndex; if(idx==null || idx<0) return;
  const q=r.questions?.[idx]; if(!q) return;
  const v=(els.shortInput.value||"").trim(); if(!v) return;
  let correct=null;
  if(q.answerText){ const norm=s=>String(s).trim().toLowerCase(); correct = (norm(v)===norm(q.answerText)); }
  await setDoc(doc(respCol(roomId), me.id), { [`answers.${idx}`]: { value: v, correct:(correct===true), revealed:r.reveal||false } }, { merge:true });
  els.studentDone.classList.remove("hide");
  setTimeout(()=> els.studentDone.classList.add("hide"), 1200);
}

/***********************
 * Render
 ***********************/
function renderRoom(r){
  // 공통 상태
  els.roomStatus.textContent = roomId ? `세션: ${roomId} · 온라인` : `세션: - · 오프라인`;
  els.liveDot.classList.toggle("on", !!roomId);

  // 밝은 모드
  document.body.classList.toggle("bright", !!r.bright);

  // 프레젠테이션
  const idx=r.currentIndex??-1;
  const q=r.questions?.[idx];
  els.presentWait.classList.toggle("hide", !(r.mode!=='active' || idx<0));
  els.pTitle.textContent = r.title || roomId || "-";
  if(r.mode==='active' && idx>=0 && q){
    els.pQ.textContent = q.text;
    // 이미지
    if(q.imageData){ els.pImg.src=q.imageData; els.pImg.classList.remove("hide"); }
    else { els.pImg.classList.add("hide"); }
    // 옵션
    els.pOpts.innerHTML="";
    if(q.type==='mcq'){
      (q.options||[]).forEach((t,i)=>{
        const d=document.createElement("div");
        d.className="popt"; d.textContent=`${i+1}. ${t}`;
        els.pOpts.appendChild(d);
      });
    }else{
      const d=document.createElement("div");
      d.className="popt"; d.textContent="주관식 문제입니다.";
      els.pOpts.appendChild(d);
    }
  }else{
    els.pQ.textContent = "-";
    els.pImg.classList.add("hide");
    els.pOpts.innerHTML="";
  }

  // 학생 화면
  if(MODE==='student'){
    els.studentTopInfo.textContent = roomId ? `세션: ${roomId} · 온라인 · ${me.name? ('참가자: '+me.name):'미참가'}` : `세션: - · 오프라인`;
    if(r.mode!=='active' || idx<0){
      els.badgeType.textContent="대기";
      els.sQText.textContent="대기 중입니다…";
      els.mcqBox.innerHTML=""; els.sImg.classList.add("hide");
      els.btnSubmitMCQ.classList.add("hide"); els.shortBox.classList.add("hide");
      return;
    }
    // 문제 표시
    els.badgeType.textContent = (q.type==='mcq')?'객관식':'주관식';
    els.sQText.textContent = q.text;
    if(q.imageData){ els.sImg.src=q.imageData; els.sImg.classList.remove("hide"); } else { els.sImg.classList.add("hide"); }

    if(q.type==='mcq'){
      mcqPick=null;
      els.mcqBox.innerHTML="";
      (q.options||[]).forEach((opt,i)=>{
        const b=document.createElement("button");
        b.className="optbtn"; b.textContent=`${i+1}. ${opt}`;
        b.disabled=!r.accept;
        b.addEventListener("click", ()=>{
          mcqPick=i;
          $$("button.optbtn", els.mcqBox).forEach(x=>x.classList.remove("active"));
          b.classList.add("active");
          els.btnSubmitMCQ.classList.remove("hide");
        });
        els.mcqBox.appendChild(b);
      });
      els.btnSubmitMCQ.disabled=!r.accept;
      els.shortBox.classList.add("hide");
    }else{
      els.mcqBox.innerHTML="";
      els.btnSubmitMCQ.classList.add("hide");
      els.shortBox.classList.remove("hide");
      els.btnShortSend.disabled=!r.accept;
    }
  }
}
function renderResponses(list){
  const r=window.__room||{}; const idx=r.currentIndex??-1; const q=r.questions?.[idx];

  // 통계(프레젠테이션 하단)
  const join = list.length;
  let submit=0, corr=0, wrong=0;
  list.forEach(s=>{
    const a=s.answers?.[idx];
    if(a!=null){ submit++; if(a.correct) corr++; else wrong++; }
  });
  els.statJoin.textContent   = `참가 ${join}`;
  els.statSubmit.textContent = `제출 ${submit}`;
  els.statCorrect.textContent= `정답 ${corr}`;
  els.statWrong.textContent  = `오답 ${wrong}`;

  // 결과표(관리자)
  if(els.resultsTable){
    const tbl=document.createElement("table");
    const thead=document.createElement("thead");
    const htr=document.createElement("tr");
    ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{
      const th=document.createElement("th"); th.textContent=h; htr.appendChild(th);
    });
    thead.appendChild(htr); tbl.appendChild(thead);
    const tbody=document.createElement("tbody");
    list.forEach(s=>{
      let score=0;
      const tr=document.createElement("tr");
      const tdN=document.createElement("td"); tdN.textContent=s.name||s.id; tr.appendChild(tdN);
      (r.questions||[]).forEach((qq,i)=>{
        const td=document.createElement("td");
        const a=s.answers?.[i];
        if(a){
          if(a.correct) score++;
          td.textContent = qq.type==='mcq' ? (typeof a.value==='number' ? (a.correct?'O':'X') : '-') : (a.value||'-');
        }else td.textContent='-';
        tr.appendChild(td);
      });
      const tdS=document.createElement("td"); tdS.textContent=String(score); tr.appendChild(tdS);
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
  }
}

/***********************
 * Tabs
 ***********************/
function activateTab(name){
  const map = { build:els.panelBuild, options:els.panelOptions, present:els.panelPresent, results:els.panelResults };
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b.classList.remove("active"));
  [els.panelBuild,els.panelOptions,els.panelPresent,els.panelResults].forEach(p=>p.classList.add("hide"));
  if(name==="build"){ els.tabBuild.classList.add("active"); els.panelBuild.classList.remove("hide"); }
  if(name==="options"){ els.tabOptions.classList.add("active"); els.panelOptions.classList.remove("hide"); }
  if(name==="present"){ els.tabPresent.classList.add("active"); els.panelPresent.classList.remove("hide"); }
  if(name==="results"){ els.tabResults.classList.add("active"); els.panelResults.classList.remove("hide"); }
}

/***********************
 * Events
 ***********************/
els.btnConnect.addEventListener("click", connect);
els.btnSignOut.addEventListener("click", logout);

[els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(btn=>{
  btn.addEventListener("click", ()=> activateTab(btn.dataset.tab));
});

els.btnBuildForm.addEventListener("click", ()=> buildForm(parseInt(els.questionCount.value,10)||3));
els.btnLoadSample.addEventListener("click", loadSample);
els.btnSaveQuiz.addEventListener("click", saveQuiz);

// 업로드/양식
els.btnUploadTxt.addEventListener("click", ()=> els.fileUploadTxt.click());
els.fileUploadTxt.addEventListener("change", async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const text=await f.text();
  const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const list=[];
  for(const line of lines){
    const cols=line.split(",").map(s=>s.trim());
    if(cols.length>=6){
      const [t,o1,o2,o3,o4,ans] = cols;
      list.push({ type:'mcq', text:t, options:[o1,o2,o3,o4], answerIndex: Math.max(0, Math.min(3, (parseInt(ans,10)||1)-1)) });
    }else if(cols.length>=3 && cols[1]==='주관식'){
      list.push({ type:'short', text:cols[0], answerText: cols.slice(2).join(",") });
    }
  }
  els.builder.innerHTML=""; list.forEach((q,i)=> els.builder.appendChild(buildCard(i+1,q)));
  alert("업로드 완료");
  e.target.value="";
});
els.btnDownloadTemplate.addEventListener("click", ()=>{
  const sample = [
    "가장 큰 행성?,지구,목성,화성,금성,2",
    "물의 끓는점(°C)?,주관식,100"
  ].join("\n");
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([sample],{type:"text/plain"}));
  a.download="quiz_template.txt"; a.click(); URL.revokeObjectURL(a.href);
});

els.btnSaveOptions.addEventListener("click", saveOptions);

els.btnStart.addEventListener("click", startQuiz);
els.btnPrev.addEventListener("click", ()=> step(-1));
els.btnNext.addEventListener("click", ()=> step(+1));
els.btnEndAll.addEventListener("click", endAll);

els.btnExportCSV.addEventListener("click", async ()=>{
  if(!roomId) return;
  const r=(await getDoc(roomRef(roomId))).data();
  const snap=await getDocs(respCol(roomId));
  const rows=[]; rows.push(["userId","name",...(r.questions||[]).map((_,i)=>`Q${i+1}`),"score"].join(","));
  snap.forEach(d=>{
    const s=d.data(); let score=0;
    const ans=(r.questions||[]).map((q,i)=>{ const a=s.answers?.[i]; if(a?.correct) score++; return q.type==='mcq' ? (a? (a.correct?'O':'X') : "") : (a?.value??""); });
    rows.push([d.id, `"${(s.name||"").replace(/"/g,'""')}"`, ...ans, score].join(","));
  });
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([rows.join("\n")],{type:"text/csv"}));
  a.download=`${r.title||roomId}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
});
els.btnResetAll.addEventListener("click", resetAll);

// 학생
els.btnJoin.addEventListener("click", join);
els.btnSubmitMCQ.addEventListener("click", submitMCQ);
els.btnShortSend.addEventListener("click", submitShort);

// 링크/QR
els.btnCopyLink.addEventListener("click", async ()=>{
  await navigator.clipboard.writeText(els.studentLink.value||"");
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="복사", 1000);
});
els.btnOpenStudent.addEventListener("click", ()=> window.open(els.studentLink.value||"#","_blank"));

/***********************
 * Boot
 ***********************/
(function boot(){
  // 기본: 관리자 모드 + 세션아웃 상태(학생 패널 숨김)
  setMode("admin");
  // URL로 학생 모드 진입: ?role=student&room=classA
  const url=new URL(location.href);
  const role=url.searchParams.get("role");
  const rid =url.searchParams.get("room");
  if(role==='student'){
    setMode("student");
    if(rid){ roomId=rid; listenRoom(roomId); listenResponses(roomId); }
    els.studentTopInfo.textContent = roomId ? `세션: ${roomId} · 온라인` : `세션: - · 오프라인`;
  }
})();
