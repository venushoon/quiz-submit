/***********************
 * Firestore (from window.__fb)
 ***********************/
const FB = window.__fb || {};
const { db, doc, setDoc, getDoc, onSnapshot, updateDoc,
        collection, getDocs, runTransaction, serverTimestamp } = FB;

/***********************
 * Helpers & State
 ***********************/
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));
const pad = (n)=>String(n).padStart(2,'0');

let MODE   = "admin";           // 'admin' | 'student'
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;

const els = {
  // 헤더/탭
  liveDot: $("#liveDot"), roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnSignOut: $("#btnSignOut"), roomStatus: $("#roomStatus"),
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"), pOptions: $("#panelOptions"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),
  // 빌더
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"), btnBuildForm: $("#btnBuildForm"),
  btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"), builder: $("#builder"),
  fileUploadTxt: $("#fileUploadTxt"), btnUploadTxt: $("#btnUploadTxt"), btnDownloadTemplate: $("#btnDownloadTemplate"),
  // 옵션
  chkDeviceOnce: $("#chkDeviceOnce"), chkNameOnce: $("#chkNameOnce"), chkBright: $("#chkBright"),
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"),
  timerSec: $("#timerSec"), btnOptSave: $("#btnOptSave"), btnResetAll: $("#btnResetAll"),
  // QR
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),
  // 프레젠테이션
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  nowQuestion: $("#nowQuestion"), presentTitle: $("#presentTitle"), presentOpts: $("#presentOpts"), pImg: $("#pImg"), pTimer: $("#pTimer"),
  chipJoin: $("#chipJoin"), chipSubmit: $("#chipSubmit"), chipCorrect: $("#chipCorrect"), chipWrong: $("#chipWrong"),
  // 결과
  btnExportCSV: $("#btnExportCSV"), btnResetAll2: $("#btnResetAll2"), resultsTable: $("#resultsTable"), leaderboard: $("#leaderboard"),
  // 학생
  studentAccess: $("#studentAccess"), joinModal: $("#joinModal"), joinName: $("#joinName"), btnJoinGo: $("#btnJoinGo"),
  sWrap: $("#sWrap"), sState: $("#sState"), sTimer: $("#sTimer"),
  sQTitle: $("#sQTitle"), sQImg: $("#sQImg"), sOptBox: $("#sOptBox"),
  sShortWrap: $("#sShortWrap"), sShortInput: $("#sShortInput"), sShortSend: $("#sShortSend"),
  sSubmit: $("#sSubmit"), sEnd: $("#sEnd"), btnMyResult: $("#btnMyResult"), sMyResult: $("#sMyResult"),
};

// 존재하지 않는 노드 경고(실행은 계속)
Object.keys(els).forEach(k=>{ if(!els[k]) console.warn("[warn] element missing:", k); });

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
 * Firestore refs & utils
 ***********************/
const roomRef = (id)=>doc(db,"rooms",id);
const respCol = (id)=>collection(db,"rooms",id,"responses");

async function ensureRoom(id){
  if(!id) return;
  const snap=await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false,
      options:{ policy:"device", bright:false, timerSec:30 },
      createdAt: serverTimestamp(), questions:[]
    });
  }
}

function qUrl(rid){
  const url=new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", rid);
  return url.toString();
}

function drawQR(link){
  const QR = window.QRCode; // cdn 스크립트
  if(QR && els.qrCanvas){
    try{ QR.toCanvas(els.qrCanvas, link, { width:140 }, (err)=>{ if(err) console.warn(err); }); }
    catch(e){ console.warn("QR draw failed", e); }
  }
}

/***********************
 * Mode & Connect
 ***********************/
function setMode(m){
  MODE=m;
  const adminOnly = $$(".admin-only");
  if(m==="student"){ adminOnly.forEach(n=>n.classList.add("hide")); }
  else            { adminOnly.forEach(n=>n.classList.remove("hide")); }
  // 패널 기본: 관리자는 문항, 학생은 학생 섹션
  if(m==="admin"){ showTab("build"); els.studentAccess?.classList.add("hide"); }
  else           { els.studentAccess?.classList.remove("hide"); }
  els.roomStatus && (els.roomStatus.textContent = roomId ? `세션: ${roomId} · 온라인` :
    (m==='admin'?'세션에 접속해 주세요.':''));
}

async function connect(){
  const id=(els.roomId?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId=id;
  await ensureRoom(roomId);
  listenRoom(roomId);
  listenResponses(roomId);
  els.roomStatus && (els.roomStatus.textContent=`세션: ${roomId} · 온라인`);
  els.btnConnect?.classList.add("hide");
  els.btnSignOut?.classList.remove("hide");
  els.roomId?.setAttribute("disabled","disabled");
  // 링크/QR
  const link=qUrl(roomId);
  if(els.studentLink) els.studentLink.value=link;
  drawQR(link);
  saveLocal();
}

function signOut(){
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  unsubRoom=null; unsubResp=null;
  roomId=""; saveLocal();
  els.roomStatus && (els.roomStatus.textContent="세션: - · 오프라인");
  els.btnConnect?.classList.remove("hide");
  els.btnSignOut?.classList.add("hide");
  els.roomId?.removeAttribute("disabled");
  if(els.studentLink) els.studentLink.value="";
  if(els.qrCanvas) els.qrCanvas.getContext?.("2d")?.clearRect(0,0,els.qrCanvas.width,els.qrCanvas.height);
}

/***********************
 * Builder
 ***********************/
function cardRow(no,q){
  const wrap=document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="row gap"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'} /> 객관식</label>
      <label class="row gap"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''} /> 주관식</label>
      <input class="input grow qtext" data-no="${no}" placeholder="문항 내용" value="${q?.text||''}" />
      <input class="input" data-no="${no}" type="file" accept="image/*" />
    </div>
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="input opt" data-no="${no}" data-idx="${i}" placeholder="보기 ${i+1}" value="${v}">`).join('')}
      </div>
      <div class="row gap mt">
        <span class="muted">정답 번호</span>
        <input class="input sm ansIndex" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
      </div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <input class="input ansText" data-no="${no}" placeholder="정답(자동채점용/선택)" value="${q?.answerText||''}">
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
    const type=c.querySelector(`input[name="type-${no}"]:checked`)?.value||"mcq";
    const text=c.querySelector(".qtext")?.value.trim()||"";
    if(!text) return null;
    const imageFile = c.querySelector('input[type="file"]')?.files?.[0]||null;
    let image=null;
    if(imageFile) image=URL.createObjectURL(imageFile); // 간단히 blob URL(배포 시 스토리지 연동 고려)
    if(type==='mcq'){
      const opts=$$(".opt",c).map(i=>i.value.trim()).filter(Boolean);
      const ans = Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans, image };
    } else {
      return { type:'short', text, answerText:c.querySelector(".ansText").value.trim(), image };
    }
  }).filter(Boolean);
  return { title: els.quizTitle?.value||"퀴즈", questions:list };
}

/***********************
 * Flow + Timer(자동 다음)
 ***********************/
async function startQuiz(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true });
}
async function step(delta){
  if(!roomId) return;
  await runTransaction(db, async (tx)=>{
    const snap=await tx.get(roomRef(roomId));
    const r=snap.data(); const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){ // 종료
      tx.update(roomRef(roomId), { currentIndex: total-1, mode:"ended", accept:false });
      return;
    }
    next=Math.max(0,next);
    tx.update(roomRef(roomId), { currentIndex: next, accept:true });
  });
}
async function finishAll(){ if(roomId && confirm("퀴즈를 종료할까요?")) await updateDoc(roomRef(roomId), { mode:"ended", accept:false }); }

function startTimer(sec, forStudent=false){
  stopTimer();
  const end = Date.now()+sec*1000;
  timerHandle=setInterval(()=>{
    const remain=Math.max(0, Math.floor((end-Date.now())/1000));
    const t = `${pad(Math.floor(remain/60))}:${pad(remain%60)}`;
    if(forStudent) els.sTimer && (els.sTimer.textContent=t); else els.pTimer && (els.pTimer.textContent=t);
    if(remain<=0) stopTimer();
  }, 250);
}
function stopTimer(){
  if(timerHandle){ clearInterval(timerHandle); timerHandle=null; }
  if(els.pTimer) els.pTimer.textContent="00:00";
  if(els.sTimer) els.sTimer.textContent="00:00";
}

/***********************
 * Submit / Grade
 ***********************/
async function join(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name=(els.joinName?.value||"").trim(); if(!name) return alert("이름을 입력하세요.");
  me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem("quiz.device", me.id);
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{}, alive:true }, { merge:true });
  els.joinModal?.classList.add("hide");
  els.sWrap?.classList.remove("hide");
  els.sState && (els.sState.textContent="참가 완료! 제출 버튼을 눌러주세요.");
  saveLocal();
}
async function submit(value){
  const r=window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
  const ref=doc(respCol(roomId), me.id);
  const snap=await getDoc(ref); const prev=snap.exists()? (snap.data().answers||{}) : {};
  // 정책: 중복 제출 방지
  if(prev[idx]!=null) return alert("이미 제출했습니다.");
  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true), revealed:r.reveal||false } }, { merge:true });
  alert("제출 완료!");
}

/***********************
 * Render
 ***********************/
function renderRoom(r){
  window.__room=r;
  const total=r.questions?.length||0; const idx=r.currentIndex;
  if(els.presentTitle) els.presentTitle.textContent = r.title||roomId||"-";
  if(els.chkAccept) els.chkAccept.checked=!!r.accept;
  if(els.chkReveal) els.chkReveal.checked=!!r.reveal;

  // 프레젠테이션
  if(els.presentOpts){
    els.presentOpts.innerHTML="";
    if(idx>=0 && r.questions[idx]){
      const q=r.questions[idx];
      els.nowQuestion && (els.nowQuestion.textContent=q.text);
      if(els.pImg){
        if(q.image) { els.pImg.src=q.image; els.pImg.classList.remove("hide"); }
        else        { els.pImg.src=""; els.pImg.classList.add("hide"); }
      }
      if(q.type==='mcq'){
        q.options.forEach((t,i)=>{ const b=document.createElement("button"); b.className="optbtn"; b.textContent=`${i+1}. ${t}`; els.presentOpts.appendChild(b); });
      }
    } else {
      els.nowQuestion && (els.nowQuestion.textContent="시작 버튼을 누르면 문항이 제시됩니다.");
      els.pImg && els.pImg.classList.add("hide");
    }
  }

  // 학생 화면
  if(MODE==='student'){
    if(r.mode!=='active' || idx<0){
      els.sState && (els.sState.textContent="대기 중입니다. 곧 시작합니다!");
      els.sQTitle && (els.sQTitle.textContent="-");
      els.sQImg && els.sQImg.classList.add("hide");
      els.sOptBox && (els.sOptBox.innerHTML="");
      els.sShortWrap && els.sShortWrap.classList.add("hide");
      els.sSubmit && els.sSubmit.classList.add("hide");
      if(r.mode==="ended"){
        els.sEnd?.classList.remove("hide");
      }
      return;
    }
    const q=r.questions[idx];
    els.sEnd?.classList.add("hide");
    els.sState && (els.sState.textContent = q.type==='mcq'?'객관식':'주관식');
    els.sQTitle && (els.sQTitle.textContent=q.text);
    if(els.sQImg){
      if(q.image){ els.sQImg.src=q.image; els.sQImg.classList.remove("hide"); }
      else       { els.sQImg.src=""; els.sQImg.classList.add("hide"); }
    }
    if(q.type==='mcq'){
      els.sOptBox && (els.sOptBox.innerHTML="");
      q.options.forEach((opt,i)=>{
        const b=document.createElement("button");
        b.className="optbtn"; b.textContent=`${i+1}. ${opt}`;
        b.addEventListener("click",()=>{ els.sSubmit.dataset.sel=i; });
        els.sOptBox.appendChild(b);
      });
      els.sShortWrap && els.sShortWrap.classList.add("hide");
      els.sSubmit && (els.sSubmit.classList.remove("hide"), els.sSubmit.onclick=()=>submit(Number(els.sSubmit.dataset.sel)));
    }else{
      els.sOptBox && (els.sOptBox.innerHTML="");
      els.sShortWrap && els.sShortWrap.classList.remove("hide");
      els.sSubmit && els.sSubmit.classList.add("hide");
    }
    // 타이머 시작(옵션 기반)
    const sec = Number(r.options?.timerSec||0);
    if(sec>0) startTimer(sec, true); else stopTimer();
  }

  // 리더보드/칩은 응답 렌더에서
}

function renderResponses(list){
  if(els.chipJoin)    els.chipJoin.textContent   = String(list.length);
  const r=window.__room||{}; const idx=r.currentIndex;

  // 칩
  let sub=0, ok=0, no=0;
  list.forEach(s=>{
    const a=s.answers?.[idx];
    if(a){ sub++; if(a.correct) ok++; else no++; }
  });
  els.chipSubmit && (els.chipSubmit.textContent=String(sub));
  els.chipCorrect && (els.chipCorrect.textContent=String(ok));
  els.chipWrong && (els.chipWrong.textContent=String(no));

  // 리더보드
  if(els.leaderboard){
    const score = list.map(s=>{
      let sc=0; (r.questions||[]).forEach((_,i)=>{ if(s.answers?.[i]?.correct) sc++; });
      return { name:s.name||s.id, score:sc };
    }).sort((a,b)=>b.score-a.score);
    els.leaderboard.innerHTML = score.map((x,i)=>`${i+1}. ${x.name} — ${x.score}`).join("<br>") || "-";
  }

  // 결과 테이블(관리자)
  if(els.resultsTable){
    const tbl=document.createElement("table"); tbl.style.width="100%";
    const thead=document.createElement("thead"), tr=document.createElement("tr");
    ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; th.style.textAlign="left"; th.style.padding="6px"; tr.appendChild(th); });
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb=document.createElement("tbody");
    list.forEach(s=>{
      let score=0; const tr=document.createElement("tr");
      const tdn=document.createElement("td"); tdn.textContent=s.name||s.id; tdn.style.padding="6px"; tr.appendChild(tdn);
      (r.questions||[]).forEach((q,i)=>{
        const a=s.answers?.[i]; const td=document.createElement("td"); td.style.padding="6px";
        td.textContent = a? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value??'-')) : '-';
        if(a?.correct) score++; tr.appendChild(td);
      });
      const tds=document.createElement("td"); tds.textContent=String(score); tds.style.padding="6px"; tr.appendChild(tds);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
  }
}

/***********************
 * Listeners
 ***********************/
function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom=onSnapshot(roomRef(id),(snap)=>{
    if(!snap.exists()) return;
    renderRoom(snap.data());
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
 * Events
 ***********************/
els.btnConnect?.addEventListener("click", connect);
els.btnSignOut?.addEventListener("click", signOut);

[els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(btn=>{
  btn?.addEventListener("click", ()=> showTab(btn.dataset.tab));
});
function showTab(name){
  const map={ build:els.pBuild, options:els.pOptions, present:els.pPresent, results:els.pResults };
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
  ({build:els.tabBuild,options:els.tabOptions,present:els.tabPresent,results:els.tabResults}[name])?.classList.add("active");
  Object.keys(map).forEach(k=>map[k]?.classList.toggle("hide", k!==name));
}

els.btnBuildForm?.addEventListener("click", ()=>{
  const n=Math.max(1,Math.min(50, parseInt(els.questionCount?.value,10)||3));
  if(els.builder){ els.builder.innerHTML=""; for(let i=0;i<n;i++) els.builder.appendChild(cardRow(i+1)); }
});
els.btnLoadSample?.addEventListener("click", ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
    {type:'mcq', text:'태양계 별명은?', options:['Milky','Solar','Sunset','Lunar'], answerIndex:1},
  ];
  if(els.builder){ els.builder.innerHTML=""; S.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q))); }
  if(els.quizTitle) els.quizTitle.value="샘플 퀴즈";
  if(els.questionCount) els.questionCount.value=S.length;
});
els.btnSaveQuiz?.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const payload=collectBuilder(); if(!payload.questions.length) return alert("문항을 추가하세요.");
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("저장 완료!");
});

// 업로드/양식
els.btnUploadTxt?.addEventListener("click", ()=> els.fileUploadTxt?.click());
els.fileUploadTxt?.addEventListener("change", async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const text=await f.text();
  const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const qs=[];
  for(const ln of lines){
    const parts=ln.split(",").map(s=>s.trim());
    if(parts.length>=6){ // 객관식
      qs.push({type:"mcq", text:parts[0], options:parts.slice(1,5), answerIndex:Math.max(0,Math.min(3, Number(parts[5])-1))});
    }else if(parts.length>=3 && parts[1]==="주관식"){
      qs.push({type:"short", text:parts[0], answerText:parts[2]});
    }
  }
  if(els.builder){ els.builder.innerHTML=""; qs.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q))); }
});
els.btnDownloadTemplate?.addEventListener("click", ()=>{
  const sample = [
    "가장 큰 행성?,지구,목성,화성,금성,2",
    "물의 끓는점은?,주관식,100"
  ].join("\n");
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([sample],{type:"text/plain"}));
  a.download="quiz-template.txt"; a.click(); URL.revokeObjectURL(a.href);
});

// 옵션 저장/초기화
els.btnOptSave?.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const policy = els.chkNameOnce?.checked ? "name" : "device";
  const bright = !!els.chkBright?.checked;
  const timer  = Math.max(0, Math.min(600, parseInt(els.timerSec?.value,10)||0));
  await setDoc(roomRef(roomId), { options:{ policy, bright, timerSec:timer } }, { merge:true });
  // 제출 허용/공개 체크도 반영
  await setDoc(roomRef(roomId), { accept: !!els.chkAccept?.checked, reveal: !!els.chkReveal?.checked }, { merge:true });
  // 링크/QR 갱신
  const link=qUrl(roomId); els.studentLink && (els.studentLink.value=link); drawQR(link);
  alert("옵션 저장 완료!");
});
async function resetAll(){
  if(!roomId) return;
  if(!confirm("문항, 옵션, 응답을 포함해 전체 초기화합니다.")) return;
  await setDoc(roomRef(roomId), {
    title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false,
    options:{ policy:"device", bright:false, timerSec:30 }, questions:[]
  }, { merge:true });
  // 응답 초기화
  const snap=await getDocs(respCol(roomId));
  const tasks=[]; snap.forEach(d=> tasks.push(setDoc(doc(respCol(roomId), d.id), { answers:{}, alive:true }, { merge:true })));
  await Promise.all(tasks);
  alert("초기화 완료");
}
els.btnResetAll?.addEventListener("click", resetAll);
els.btnResetAll2?.addEventListener("click", resetAll);

// 프레젠테이션 조작
els.btnStart?.addEventListener("click", startQuiz);
els.btnPrev?.addEventListener("click", ()=>step(-1));
els.btnNext?.addEventListener("click", ()=>step(+1));
els.btnEndAll?.addEventListener("click", finishAll);

// QR 링크
els.btnCopyLink?.addEventListener("click", async ()=>{ if(!els.studentLink?.value) return; await navigator.clipboard.writeText(els.studentLink.value); alert("복사됨"); });
els.btnOpenStudent?.addEventListener("click", ()=> window.open(els.studentLink?.value||"#","_blank"));

// 학생
els.btnJoinGo?.addEventListener("click", join);
els.sShortSend?.addEventListener("click", ()=> submit((els.sShortInput?.value||"").trim()));

/***********************
 * Boot
 ***********************/
function autoReconnect(){
  loadLocal();
  const url = new URL(location.href);
  const role=url.searchParams.get("role"); const rid=url.searchParams.get("room");
  if(role==='student') MODE="student";
  if(rid){ roomId=rid; if(els.roomId) els.roomId.value=rid; }
  setMode(MODE);
  if(roomId) connect();
}
autoReconnect();
