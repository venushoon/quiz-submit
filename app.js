// app.js — 전역 Firestore API(window.FS) 사용
const { doc, collection, setDoc, getDoc, getDocs,
        onSnapshot, updateDoc, runTransaction, serverTimestamp } = window.FS;

/* ---------- DOM helpers ---------- */
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));

const els = {
  // 헤더/탭
  liveDot: $("#liveDot"),
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnSignOut: $("#btnSignOut"), roomStatus: $("#roomStatus"),
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),

  // 패널
  pBuild: $("#panelBuild"), pOptions: $("#panelOptions"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),
  studentAccess: $("#studentAccess"),

  // 문항 빌더
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"),
  builder: $("#builder"), btnUploadTxt: $("#btnUploadTxt"), fileUploadTxt: $("#fileUploadTxt"),
  btnDownloadTemplate: $("#btnDownloadTemplate"),

  // 옵션
  polDevice: $("#polDevice"), polName: $("#polName"),
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright: $("#chkBright"),
  timerSec: $("#timerSec"), btnOptSave: $("#btnOptSave"), btnResetAll: $("#btnResetAll"),
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

  // 프레젠테이션
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  leftSec: $("#leftSec"), nowQuestion: $("#nowQuestion"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pImg: $("#pImg"), pOpts: $("#pOpts"),
  chipJoin: $("#chipJoin"), chipSubmit: $("#chipSubmit"), chipCorrect: $("#chipCorrect"), chipWrong: $("#chipWrong"),

  // 결과
  resultsTable: $("#resultsTable"), btnExportCSV: $("#btnExportCSV"), btnFullBoard: $("#btnFullBoard"),

  // 학생
  joinModal: $("#joinModal"), sState: $("#sState"), joinName: $("#joinName"), btnJoinGo: $("#btnJoinGo"),
  sWrap: $("#sWrap"), sQTitle: $("#sQTitle"), sQImg: $("#sQImg"), sOptBox: $("#sOptBox"),
  sShortWrap: $("#sShortWrap"), sShortInput: $("#sShortInput"), btnShortSend: $("#btnShortSend"),
  sDone: $("#sDone"), btnShowMy: $("#btnShowMy"), myResult: $("#myResult"),
};

/* ---------- 상태 ---------- */
let MODE   = "admin"; // 'admin' | 'student'
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null, timerHandle=null;

/* ---------- 유틸 ---------- */
const roomRef = (id)=>doc(window.db,"rooms",id);
const respCol = (id)=>collection(window.db,"rooms",id,"responses");
const pad = n=>String(n).padStart(2,"0");
function heartbeat(on){ els.liveDot.style.background = on ? "#f43" : "#555"; }
function saveLocal(){ localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me })); }
function loadLocal(){
  try{ const d=JSON.parse(localStorage.getItem("quiz.live")||"{}");
       roomId=d.roomId||""; MODE=d.MODE||"admin"; me=d.me||{id:null,name:""}; if(roomId) els.roomId.value=roomId; }catch{}
}

/* ---------- 탭/모드 ---------- */
function showTab(name){
  const map = { build:els.pBuild, options:els.pOptions, present:els.pPresent, results:els.pResults };
  Object.values(map).forEach(p=>p.classList.add("hide"));
  map[name]?.classList.remove("hide");
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(t=>t.classList.remove("active"));
  ({build:els.tabBuild, options:els.tabOptions, present:els.tabPresent, results:els.tabResults}[name])?.classList.add("active");
}
function setMode(m){
  MODE=m;
  $$(".admin-only").forEach(n=>n.classList.toggle("hide", m!=="admin"));
  els.studentAccess.classList.toggle("hide", m!=="student");
  if(m==="admin") showTab("build");
}

/* ---------- Firestore 리스너 ---------- */
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
    window.__resp=arr;
    renderResponses(arr);
  });
}

/* ---------- 접속/복구 ---------- */
async function ensureRoom(id){
  const s=await getDoc(roomRef(id));
  if(!s.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션", questions:[], mode:"idle", currentIndex:-1,
      accept:false, reveal:false, bright:false, policy:"device",
      timer:30, createdAt:serverTimestamp()
    });
  }
}
async function connect(){
  const id=(els.roomId.value||"").trim();
  if(!id) return alert("세션 코드를 입력하세요.");
  roomId=id; await ensureRoom(roomId);
  listenRoom(roomId); listenResponses(roomId);
  els.roomStatus.textContent=`세션: ${roomId} · 온라인`;
  els.btnConnect.disabled=true; els.roomId.disabled=true; els.btnSignOut.classList.remove("hide");
  buildStudentLink(); saveLocal(); heartbeat(true);
}
function signOut(){
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  roomId=""; els.roomId.value=""; els.roomId.disabled=false;
  els.btnConnect.disabled=false; els.btnSignOut.classList.add("hide");
  els.roomStatus.textContent="세션: - · 오프라인"; heartbeat(false);
  showTab("build"); saveLocal();
}
function autoReconnect(){
  loadLocal(); setMode(MODE||"admin");
  if(roomId) connect(); else heartbeat(false);
}

/* ---------- 문항 빌더 ---------- */
function qCard(no,q){
  const wrap=document.createElement("div"); wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'}> 객관식</label>
      <label style="margin-left:8px"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''}> 주관식</label>
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
    </div>`;
  const radios=$$(`input[name="type-${no}"]`,wrap);
  const mcq=$(".mcq",wrap), short=$(".short",wrap);
  radios.forEach(r=>r.addEventListener("change",()=>{
    const shortOn=radios.find(x=>x.checked).value==='short';
    mcq.classList.toggle("hide", shortOn); short.classList.toggle("hide", !shortOn);
  }));
  return wrap;
}
function gatherBuilder(){
  const cards=$$("#builder>.qcard");
  const list=cards.map(c=>{
    const type=c.querySelector("input[type=radio]:checked").value;
    const text=c.querySelector(".qtext").value.trim();
    const img=c.querySelector(".qimg").files?.[0]||null;
    if(!text) return null;
    let payload={ type, text };
    if(img) payload.image=URL.createObjectURL(img);
    if(type==='mcq'){
      const opts=$$(".opt",c).map(i=>i.value.trim());
      const ans=Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      payload.options=opts; payload.answerIndex=ans;
    }else{
      payload.answerText=c.querySelector(".ansText").value.trim();
    }
    return payload;
  }).filter(Boolean);
  return { title: els.quizTitle.value||"퀴즈", questions:list };
}

/* ---------- 옵션/QR ---------- */
function buildStudentLink(){
  if(!roomId) return;
  const url=new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", roomId);
  els.studentLink.value=url.toString();
  if(window.QRCode && els.qrCanvas){
    window.QRCode.toCanvas(els.qrCanvas, url.toString(), { width:140 });
  }
}

/* ---------- 진행 & 타이머 ---------- */
async function startQuiz(){ await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true }); }
async function step(delta){
  await runTransaction(window.db, async (tx)=>{
    const snap=await tx.get(roomRef(roomId)); const r=snap.data(); const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){ tx.update(roomRef(roomId), { mode:"ended", accept:false }); return; }
    next=Math.max(0,next); tx.update(roomRef(roomId), { currentIndex:next, accept:true });
  });
}
async function finishAll(){ await updateDoc(roomRef(roomId), { mode:"ended", accept:false }); }

function startTimer(sec){
  stopTimer(); const end=Date.now()+sec*1000;
  timerHandle=setInterval(()=>{
    const left=Math.max(0,Math.floor((end-Date.now())/1000));
    els.leftSec.textContent=`${pad(Math.floor(left/60))}:${pad(left%60)}`;
    if(left<=0){ stopTimer(); updateDoc(roomRef(roomId), { accept:false }); setTimeout(()=>step(+1),400); }
  },250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } els.leftSec.textContent="00:00"; }

/* ---------- 학생 참가/제출 ---------- */
async function join(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name=(els.joinName.value||"").trim(); if(!name) return alert("이름을 입력하세요.");
  me={ id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem("quiz.device", me.id);
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{}, alive:true }, { merge:true });
  els.joinModal.classList.add("hide"); els.sWrap.classList.remove("hide");
  els.sState.textContent="참가 완료! 제출 버튼을 눌러주세요.";
  saveLocal();
}
async function submit(value){
  const r=window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
  const ref=doc(respCol(roomId), me.id);
  const snap=await getDoc(ref); const prev=snap.exists()?(snap.data().answers||{}):{};
  if(prev[idx]!=null) return alert("이미 제출했습니다.");
  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true) } }, { merge:true });
}

/* ---------- 렌더 ---------- */
function renderRoom(r){
  // 옵션 동기
  els.chkAccept.checked=!!r.accept; els.chkReveal.checked=!!r.reveal; els.chkBright.checked=!!r.bright;
  els.timerSec.value=r.timer||30; els.quizTitle.value=r.title||"퀴즈";

  // Q 진행 라벨
  const idx=r.currentIndex; const total=r.questions?.length||0;
  els.nowQuestion.textContent=(idx>=0)?`Q${idx+1}/${total}`:"-";

  // 프레젠테이션
  els.pTitle.textContent=r.title||roomId;
  els.pImg.classList.add("hide"); els.pImg.src="";
  if(r.mode!=="active" || idx<0){
    els.pQ.textContent="시작 버튼을 누르면 문항이 제시됩니다.";
    els.pOpts.innerHTML="";
  }else{
    const q=r.questions[idx];
    els.pQ.textContent=q.text;
    if(q.image){ els.pImg.src=q.image; els.pImg.classList.remove("hide"); }
    els.pOpts.innerHTML="";
    if(q.type==='mcq'){
      q.options.forEach((op,i)=>{ const d=document.createElement("div"); d.className="popt"; d.textContent=`${i+1}. ${op}`; els.pOpts.appendChild(d); });
    }else{
      const d=document.createElement("div"); d.className="popt"; d.textContent="주관식 문제입니다."; els.pOpts.appendChild(d);
    }
  }

  // 학생 화면
  if(MODE==='student'){
    if(r.mode==='ended'){ els.sWrap.classList.add("hide"); els.sDone.classList.remove("hide"); return; }
    if(r.mode!=="active" || idx<0){
      els.sWrap.classList.add("hide");
      els.joinModal.classList.remove("hide");
      els.sState.textContent="참가 완료! 제출 버튼을 눌러주세요. 교사가 시작하면 1번 문항이 표시됩니다.";
      return;
    }
    const q=r.questions[idx];
    els.joinModal.classList.add("hide"); els.sWrap.classList.remove("hide");
    els.sQTitle.textContent=q.text; els.sQImg.classList.add("hide"); els.sQImg.src="";
    if(q.image){ els.sQImg.src=q.image; els.sQImg.classList.remove("hide"); }
    els.sOptBox.innerHTML="";
    if(q.type==='mcq'){
      q.options.forEach((op,i)=>{ const b=document.createElement("button"); b.className="btn popt"; b.textContent=`${i+1}. ${op}`;
        b.disabled=!r.accept; b.onclick=()=>submit(i); els.sOptBox.appendChild(b); });
      els.sShortWrap.classList.add("hide");
    }else{
      els.sOptBox.innerHTML="";
      els.sShortWrap.classList.remove("hide"); els.btnShortSend.disabled=!r.accept;
    }
  }
}
function renderResponses(list){
  const r=window.__room||{}; const idx=r.currentIndex;
  let joined=list.length, submitted=0, correct=0, wrong=0;
  list.forEach(s=>{ const a=s.answers?.[idx]; if(a){ submitted++; if(a.correct===true) correct++; if(a.correct===false) wrong++; }});
  els.chipJoin.textContent=joined; els.chipSubmit.textContent=submitted;
  els.chipCorrect.textContent=correct; els.chipWrong.textContent=wrong;

  // 결과 테이블
  const qs=(r.questions||[]);
  const tbl=document.createElement("table");
  const thead=document.createElement("thead"); const tr=document.createElement("tr");
  ["이름", ...qs.map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; tr.appendChild(th); });
  thead.appendChild(tr); tbl.appendChild(thead);
  const tb=document.createElement("tbody");
  list.forEach(s=>{
    let score=0; const tr=document.createElement("tr");
    const tdn=document.createElement("td"); tdn.textContent=s.name||s.id; tr.appendChild(tdn);
    qs.forEach((q,i)=>{ const a=s.answers?.[i]; const td=document.createElement("td");
      td.textContent = a? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value??'-')) : '-';
      if(a?.correct) score++; tr.appendChild(td); });
    const tds=document.createElement("td"); tds.textContent=String(score); tr.appendChild(tds);
    tb.appendChild(tr);
  });
  tbl.appendChild(tb); els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
}

/* ---------- 이벤트 ---------- */
els.btnConnect.addEventListener("click", connect);
els.btnSignOut.addEventListener("click", signOut);
[["tabBuild","build"],["tabOptions","options"],["tabPresent","present"],["tabResults","results"]]
  .forEach(([id,tab])=> els[id].addEventListener("click",()=>showTab(tab)));

// 빌더
els.btnBuildForm.addEventListener("click", ()=>{
  const n=Math.max(1,Math.min(50,parseInt(els.questionCount.value,10)||3));
  els.builder.innerHTML=""; for(let i=0;i<n;i++) els.builder.appendChild(qCard(i+1));
});
els.btnLoadSample.addEventListener("click", ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
    {type:'mcq', text:'태양계 별명?', options:['Milky','Solar','Sunset','Lunar'], answerIndex:1},
  ];
  els.builder.innerHTML=""; S.forEach((q,i)=>els.builder.appendChild(qCard(i+1,q)));
  els.quizTitle.value="샘플 퀴즈"; els.questionCount.value=S.length;
});
els.btnSaveQuiz.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션 접속 후 저장하세요.");
  const payload=gatherBuilder();
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("저장 완료!");
});

// 업로드/양식
els.btnUploadTxt.addEventListener("click", ()=> els.fileUploadTxt.click());
els.fileUploadTxt.addEventListener("change", async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const txt=await f.text(); const lines=txt.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const qs=lines.map(line=>{
    const p=line.split(",").map(s=>s.trim());
    if(p[1]==="주관식") return { type:"short", text:p[0], answerText:p[2]||"" };
    const [t,o1,o2,o3,o4,ans]=p; return { type:"mcq", text:t, options:[o1,o2,o3,o4], answerIndex:Math.max(0,(parseInt(ans,10)||1)-1) };
  });
  els.builder.innerHTML=""; qs.forEach((q,i)=>els.builder.appendChild(qCard(i+1,q)));
  els.quizTitle.value = els.quizTitle.value||"업로드 퀴즈";
});
els.btnDownloadTemplate.addEventListener("click", ()=>{
  const sample="가장 큰 행성?,지구,목성,화성,금성,2\n기체의 표준 상태에서 1몰의 부피는?,주관식,22.4L";
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([sample],{type:"text/plain"})); a.download="quiz-template.txt"; a.click(); URL.revokeObjectURL(a.href);
});

// 옵션/초기화
els.btnOptSave.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션 접속 후 저장하세요.");
  await setDoc(roomRef(roomId), {
    policy: els.polName.checked? "name":"device",
    accept: !!els.chkAccept.checked, reveal: !!els.chkReveal.checked, bright: !!els.chkBright.checked,
    timer: Math.max(5,Math.min(600,parseInt(els.timerSec.value,10)||30))
  }, { merge:true });
  buildStudentLink(); alert("저장 완료! (QR/링크 갱신)");
});
els.btnResetAll.addEventListener("click", async ()=>{
  if(!roomId) return; if(!confirm("문항/설정/결과를 모두 초기화합니다. 계속할까요?")) return;
  await setDoc(roomRef(roomId), { mode:"idle", currentIndex:-1, accept:false, reveal:false, questions:[], title:"새 세션" }, { merge:true });
  const snap=await getDocs(respCol(roomId)); const tasks=[];
  snap.forEach(d=> tasks.push(setDoc(doc(respCol(roomId), d.id), { answers:{}, alive:true }, { merge:true })));
  await Promise.all(tasks); alert("초기화 완료");
});

// 프레젠테이션/타이머
els.btnStart.addEventListener("click", startQuiz);
els.btnPrev.addEventListener("click", ()=>step(-1));
els.btnNext.addEventListener("click", ()=>step(+1));
els.btnEndAll.addEventListener("click", finishAll);
els.chkAccept.addEventListener("change", ()=> roomId && updateDoc(roomRef(roomId), { accept: !!els.chkAccept.checked }));
els.chkReveal.addEventListener("change", ()=> roomId && updateDoc(roomRef(roomId), { reveal: !!els.chkReveal.checked }));

// 학생 링크
els.btnCopyLink.addEventListener("click", async ()=>{
  if(!els.studentLink.value) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=>els.btnCopyLink.textContent="복사",1200);
});
els.btnOpenStudent.addEventListener("click", ()=> els.studentLink.value && window.open(els.studentLink.value,"_blank"));

// 학생 액션
els.btnJoinGo.addEventListener("click", join);
els.btnShortSend.addEventListener("click", ()=> submit((els.sShortInput.value||"").trim()));
els.btnShowMy.addEventListener("click", async ()=>{
  const r=(await getDoc(roomRef(roomId))).data();
  const meRef=await getDoc(doc(respCol(roomId), me.id)); if(!meRef.exists()) return;
  const s=meRef.data(); const qs=r.questions||[];
  const box=document.createElement("table");
  const th=document.createElement("tr"); ["문항","제출","정답"].forEach(h=>{ const x=document.createElement("th"); x.textContent=h; th.appendChild(x); });
  const thead=document.createElement("thead"); thead.appendChild(th); box.appendChild(thead);
  const tb=document.createElement("tbody");
  qs.forEach((q,i)=>{ const tr=document.createElement("tr");
    const a=s.answers?.[i];
    const td1=document.createElement("td"); td1.textContent=String(i+1); tr.appendChild(td1);
    const td2=document.createElement("td"); td2.textContent=a?(q.type==='mcq'?(typeof a.value==='number'? a.value+1:'-'):(a.value??'-')):'-'; tr.appendChild(td2);
    const td3=document.createElement("td"); td3.textContent=a?(a.correct?'O':'X'):'×'; tr.appendChild(td3);
    tb.appendChild(tr);
  });
  box.appendChild(tb); els.myResult.innerHTML=""; els.myResult.appendChild(box);
});

/* ---------- 부팅 ---------- */
(function boot(){
  const url=new URL(location.href);
  const role=url.searchParams.get("role"); const rid=url.searchParams.get("room");
  if(role==='student') setMode("student"); else setMode("admin");
  if(rid){ els.roomId.value=rid; connect(); } else { heartbeat(false); }
})();
