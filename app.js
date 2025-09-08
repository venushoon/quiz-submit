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

// 엘리먼트
const els = {
  // 상단/탭
  liveDot: $("#liveDot"),
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnSignOut: $("#btnSignOut"), roomStatus: $("#roomStatus"),
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"), pOptions: $("#panelOptions"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),

  // 문항
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"), btnBuildForm: $("#btnBuildForm"),
  btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"), builder: $("#builder"),
  fileUploadTxt: $("#fileUploadTxt"), btnUploadTxt: $("#btnUploadTxt"), btnDownloadTemplate: $("#btnDownloadTemplate"),

  // 옵션
  policyDevice: $("#policyDevice"), policyName: $("#policyName"),
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright: $("#chkBright"),
  timerSec: $("#timerSec"), btnSaveOptions: $("#btnSaveOptions"),
  studentAccess: $("#studentAccess"), qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"),
  btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

  // 프레젠테이션
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  leftSec: $("#leftSec"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pImg: $("#pImg"), pOpts: $("#pOpts"), presentWait: $("#presentWait"),
  statJoin: $("#statJoin"), statSubmit: $("#statSubmit"), statCorrect: $("#statCorrect"), statWrong: $("#statWrong"),

  // 결과
  btnExportCSV: $("#btnExportCSV"), btnResetAll: $("#btnResetAll"), resultsTable: $("#resultsTable"),

  // 학생
  studentPanel: $("#studentPanel"), studentTopInfo: $("#studentTopInfo"),
  joinDialog: $("#joinDialog"), studentName: $("#studentName"), btnJoin: $("#btnJoin"),
  studentWait: $("#studentWait"), studentQuiz: $("#studentQuiz"),
  badgeType: $("#badgeType"), sQText: $("#sQText"), sQImg: $("#sQImg"),
  mcqBox: $("#mcqBox"), shortBox: $("#shortBox"), shortInput: $("#shortInput"),
  btnShortSend: $("#btnShortSend"), btnSubmitMCQ: $("#btnSubmitMCQ"),
};

// 안전 가드
Object.keys(els).forEach(k=>{ if(!els[k]) console.warn("[missing]", k); });

/***********************
 * Local cache
 ***********************/
function saveLocal(){
  localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me }));
}
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
const roomRef = (id)=>firebaseDoc("rooms", id);
const respCol = (id)=>firebaseCol("rooms", id, "responses");

// 래퍼(전역 window.db 사용)
function firebaseDoc(...path){
  const { doc } = window.firebase__lazy || {};
  return doc(window.db, ...path);
}
function firebaseCol(...path){
  const { collection } = window.firebase__lazy || {};
  return collection(window.db, ...path);
}
// 동적 import(최초 1회)
async function ensureFb(){
  if(window.firebase__lazy) return window.firebase__lazy;
  const m = await import("https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js");
  window.firebase__lazy = m;
  return m;
}

/***********************
 * Room ensure / listen
 ***********************/
async function ensureRoom(id){
  await ensureFb();
  const { getDoc, setDoc, serverTimestamp } = window.firebase__lazy;
  const snap=await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false,
      policy:"device", bright:false, tsec:30, createdAt: serverTimestamp(), questions:[]
    });
  }
}

function listenRoom(id){
  const { onSnapshot } = window.firebase__lazy;
  if(unsubRoom) unsubRoom();
  unsubRoom=onSnapshot(roomRef(id),(snap)=>{
    if(!snap.exists()) return;
    const r=snap.data();
    window.__room=r;
    renderRoom(r);
  });
}
function listenResponses(id){
  const { onSnapshot } = window.firebase__lazy;
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
  // 관리자 UI 노출
  $$(".admin-only").forEach(el=> el.classList.toggle("hide", m!=="admin"));
  // 패널 표시
  showPanel(m==="admin" ? "build" : null);
  // 학생 패널
  els.studentPanel?.classList.toggle("hide", m!=="student");
  updateTopline();
}
function updateTopline(){
  const online = !!roomId;
  els.liveDot && (els.liveDot.style.background = online? "#ff3344" : "#555");
  els.roomStatus && (els.roomStatus.textContent = roomId ? `세션: ${roomId} · 온라인` : `세션: - · 오프라인`);
  // 세션 입력/버튼 잠금
  if(els.roomId) els.roomId.disabled = !!roomId; // 접속 시 잠금
  els.btnConnect?.classList.toggle("hide", !!roomId);
  els.btnSignOut?.classList.toggle("hide", !roomId);
}
function showPanel(name){
  // 관리자 탭만 의미 있음
  if(MODE!=="admin") return;
  const map = { build:els.pBuild, options:els.pOptions, present:els.pPresent, results:els.pResults };
  Object.values(map).forEach(p=>p?.classList.add("hide"));
  if(name && map[name]) map[name].classList.remove("hide");
  // 탭 활성화 표시
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
  if(name==="build") els.tabBuild?.classList.add("active");
  if(name==="options") els.tabOptions?.classList.add("active");
  if(name==="present") els.tabPresent?.classList.add("active");
  if(name==="results") els.tabResults?.classList.add("active");
}
async function connect(){
  await ensureFb();
  const { updateDoc, getDoc } = window.firebase__lazy;
  const id=(els.roomId?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId=id;
  await ensureRoom(roomId);
  listenRoom(roomId); listenResponses(roomId);
  updateTopline();
  // URL 학생 링크 미리 구성
  buildStudentLink();
  // 서버의 정책값 로컬 반영(옵션탭 열 때 기준 동기)
  const r=(await getDoc(roomRef(roomId))).data();
  applyOptionsToUI(r);
  saveLocal();
}
function signOut(){
  roomId="";
  updateTopline();
  saveLocal();
}
function applyOptionsToUI(r){
  if(!r) return;
  if(els.policyDevice) els.policyDevice.checked = (r.policy!=="name");
  if(els.policyName)   els.policyName.checked   = (r.policy==="name");
  if(els.chkAccept)    els.chkAccept.checked    = !!r.accept;
  if(els.chkReveal)    els.chkReveal.checked    = !!r.reveal;
  if(els.chkBright)    els.chkBright.checked    = !!r.bright;
  if(els.timerSec)     els.timerSec.value       = r.tsec ?? 30;
}

/***********************
 * Builder (문항)
 ***********************/
function cardRow(no,q){
  const wrap=document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap gap">
      <span class="badge">${no}번</span>
      <label class="radio"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'} /> 객관식</label>
      <label class="radio"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''} /> 주관식</label>
      <input class="qtext input grow" data-no="${no}" placeholder="문항" value="${q?.text||''}" />
      <label class="btn ghost">
        이미지
        <input type="file" accept="image/*" data-role="img" data-no="${no}" class="hide" />
      </label>
      <img data-role="thumb" class="qthumb hide" alt="미리보기" />
    </div>
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap gap">
        ${[0,1,2,3].map(i=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기${i+1}" value="${(q?.options?.[i]||'')}" />`).join('')}
      </div>
      <div class="row wrap gap mt">
        <span class="muted">정답 번호</span>
        <input class="ansIndex input sm" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex ?? 0)+1}">
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
  // 이미지 업로드 미리보기 저장
  const fileInput = $('[data-role="img"]', wrap);
  const thumb     = $('[data-role="thumb"]', wrap);
  fileInput?.addEventListener("change", async (e)=>{
    const f = e.target.files?.[0]; if(!f) return;
    const url = await readAsDataURL(f);
    thumb.src = url; thumb.classList.remove("hide");
    // data-url 임시 보관
    fileInput.dataset.url = url;
  });
  return wrap;
}
function collectBuilder(){
  const cards=$$("#builder>.qcard");
  const list=cards.map((c,idx)=>{
    const no=idx+1;
    const type=c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text=c.querySelector(".qtext").value.trim();
    const imgURL = $('[data-role="img"]', c)?.dataset?.url || ""; // base64 데이터 URL(간편 배포용)
    if(!text) return null;
    if(type==='mcq'){
      const opts=$$(".opt",c).map(i=>i.value.trim());
      const ans = Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans, img: imgURL || null };
    } else {
      const answerText = c.querySelector(".ansText").value.trim();
      return { type:'short', text, answerText, img: imgURL || null };
    }
  }).filter(Boolean);
  return { title: els.quizTitle?.value||"퀴즈", questions:list };
}
function readAsDataURL(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); }); }

/***********************
 * Options 저장 & 학생접속
 ***********************/
async function saveOptions(){
  await ensureFb();
  const { updateDoc } = window.firebase__lazy;
  if(!roomId) return alert("세션 먼저 접속하세요.");
  const policy = els.policyName?.checked ? "name" : "device";
  const tsec   = Math.max(5, Math.min(600, parseInt(els.timerSec?.value,10)||30));
  await updateDoc(roomRef(roomId), {
    policy, accept: !!els.chkAccept?.checked, reveal: !!els.chkReveal?.checked,
    bright: !!els.chkBright?.checked, tsec
  });
  // QR/링크 즉시 갱신
  buildStudentLink();
  alert("저장 완료! (학생 접속 QR/링크 갱신)");
}
function buildStudentLink(){
  if(!roomId || !els.studentLink) return;
  const url=new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", roomId);
  els.studentLink.value=url.toString();
  // QR
  if(window.QRCode && els.qrCanvas){
    try{
      QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:120 }, (err)=>{ if(err) console.warn(err); });
    }catch(e){ console.warn("QR draw failed", e); }
  }
}

/***********************
 * Flow + Timer(자동 다음 & 종료 시 결과로)
 ***********************/
async function startQuiz(){
  await ensureFb();
  const { updateDoc } = window.firebase__lazy;
  if(!roomId) return;
  await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true });
}
async function step(delta){
  await ensureFb();
  const { runTransaction } = window.firebase__lazy;
  await runTransaction(window.db, async (tx)=>{
    const { getDoc, updateDoc } = window.firebase__lazy;
    const snap=await tx.get(roomRef(roomId));
    const r=snap.data(); const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){
      tx.update(roomRef(roomId), { currentIndex: total-1, mode:"ended", accept:false });
      // 자동 종료 후 결과 탭으로 전환(관리자)
      setTimeout(()=> showPanel("results"), 100);
      return;
    }
    next=Math.max(0,next);
    tx.update(roomRef(roomId), { currentIndex: next, accept:true });
  });
}
async function finishAll(){
  await ensureFb();
  const { updateDoc } = window.firebase__lazy;
  if(!roomId) return;
  await updateDoc(roomRef(roomId), { mode:"ended", accept:false });
  showPanel("results");
}

function startTimer(sec){
  stopTimer();
  const end = Date.now()+sec*1000;
  timerHandle=setInterval(()=>{
    const remain=Math.max(0, Math.floor((end-Date.now())/1000));
    els.leftSec && (els.leftSec.textContent = `${pad(Math.floor(remain/60))}:${pad(remain%60)}`);
    if(remain<=0){ stopTimer(); step(+1); }
  }, 250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } els.leftSec && (els.leftSec.textContent="00:00"); }

/***********************
 * Submit / Grade
 ***********************/
async function join(){
  await ensureFb();
  const { setDoc, serverTimestamp } = window.firebase__lazy;
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name=(els.studentName?.value||"").trim(); if(!name) return alert("이름(번호)을 입력하세요.");
  me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem("quiz.device", me.id);
  await setDoc(firebaseDoc("rooms", roomId, "responses", me.id),
    { name, joinedAt:serverTimestamp(), answers:{}, alive:true }, { merge:true });
  // 참가 후 대기 모드로
  els.joinDialog?.close();
  els.studentWait?.classList.remove("hide");
  els.studentQuiz?.classList.add("hide");
  updateStudentTop();
  saveLocal();
}
function updateStudentTop(){
  if(els.studentTopInfo) els.studentTopInfo.textContent = roomId ?
    `세션: ${roomId} · 온라인 · ${me.name||"-"}` : `세션: - · 오프라인`;
}

let mcqSelected = null;
function handleMCQSelect(idx){
  mcqSelected = idx;
  $$(".optbtn", els.mcqBox).forEach((b,i)=> b.classList.toggle("active", i===idx));
  // 객관식도 제출 버튼으로 제출
  els.btnSubmitMCQ?.classList.remove("hide");
}

async function submit(value){
  await ensureFb();
  const { getDoc, setDoc } = window.firebase__lazy;
  const r=window.__room; if(!r) return;
  if(!r.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;

  // 정책 체크: 기기당1회/실명당1회 → 이미 제출했으면 차단
  const ref = firebaseDoc("rooms", roomId, "responses", me.id);
  const snap=await getDoc(ref);
  const prev=snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert("이미 제출했습니다.");

  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true), revealed:r.reveal||false } }, { merge:true });

  // 제출 후 안내
  alert("제출되었습니다.");
  // 제출 버튼 숨김
  els.btnSubmitMCQ?.classList.add("hide");
}

/***********************
 * Render
 ***********************/
function renderRoom(r){
  const total=r.questions?.length||0; const idx=r.currentIndex ?? -1;

  // 프레젠테이션 보드
  els.pTitle && (els.pTitle.textContent = r.title || roomId || "-");
  const active = (r.mode==='active' && idx>=0 && r.questions[idx]);
  els.presentWait?.classList.toggle("hide", !!active);

  if(active){
    const q=r.questions[idx];
    els.pQ && (els.pQ.textContent = q.text||"-");
    if(els.pOpts){ els.pOpts.innerHTML="";
      if(q.type==='mcq' && Array.isArray(q.options)){
        q.options.forEach((t,i)=>{
          const d=document.createElement("div");
          d.className="popt"; d.textContent=`${i+1}. ${t}`;
          els.pOpts.appendChild(d);
        });
      }
    }
    // 이미지 있으면만 표시
    if(els.pImg){
      if(q.img){ els.pImg.src = q.img; els.pImg.classList.remove("hide"); }
      else { els.pImg.classList.add("hide"); els.pImg.removeAttribute("src"); }
    }
    // 타이머 구동(옵션에서 지정)
    if(r.tsec && !timerHandle) startTimer(r.tsec);
  } else {
    els.pQ && (els.pQ.textContent = "-");
    if(els.pOpts) els.pOpts.innerHTML="";
    if(els.pImg){ els.pImg.classList.add("hide"); els.pImg.removeAttribute("src"); }
    stopTimer();
  }

  // 학생 화면
  if(MODE==='student'){
    updateStudentTop();
    if(r.mode!=='active' || idx<0){
      // 대기
      els.studentWait?.classList.remove("hide");
      els.studentQuiz?.classList.add("hide");
      return;
    }
    const q=r.questions[idx];
    els.studentWait?.classList.add("hide");
    els.studentQuiz?.classList.remove("hide");

    els.badgeType && (els.badgeType.textContent = q.type==='mcq'?'객관식':'주관식');
    els.sQText && (els.sQText.textContent=q.text||"-");
    if(els.sQImg){
      if(q.img){ els.sQImg.src=q.img; els.sQImg.classList.remove("hide"); }
      else { els.sQImg.classList.add("hide"); els.sQImg.removeAttribute("src"); }
    }

    // MCQ
    if(q.type==='mcq'){
      if(els.mcqBox){
        els.mcqBox.innerHTML=""; mcqSelected=null;
        q.options.forEach((opt,i)=>{
          const b=document.createElement("button");
          b.className="optbtn"; b.textContent=`${i+1}. ${opt}`; b.disabled=!r.accept;
          b.addEventListener("click", ()=>handleMCQSelect(i));
          els.mcqBox.appendChild(b);
        });
      }
      els.shortBox?.classList.add("hide");
      els.btnSubmitMCQ?.classList.toggle("hide", true); // 선택 전 감춤
    } else {
      els.mcqBox && (els.mcqBox.innerHTML="");
      els.shortBox?.classList.remove("hide");
      els.btnShortSend && (els.btnShortSend.disabled=!r.accept);
    }
  }
}

function renderResponses(list){
  if(MODE!=="admin") return;
  const r=window.__room||{}; const idx=r.currentIndex ?? -1; const q=r.questions?.[idx];
  // 통계
  const join = list.length;
  const subm = list.filter(s => s.answers && s.answers[idx]!=null).length;
  const corr = list.filter(s => s.answers && s.answers[idx]?.correct===true).length;
  const wron = Math.max(0, subm - corr);
  els.statJoin && (els.statJoin.textContent = `참가 ${join}`);
  els.statSubmit && (els.statSubmit.textContent = `제출 ${subm}`);
  els.statCorrect && (els.statCorrect.textContent = `정답 ${corr}`);
  els.statWrong && (els.statWrong.textContent = `오답 ${wron}`);

  // 결과표
  if(els.resultsTable){
    const tbl=document.createElement("table");
    const thead=document.createElement("thead"), tr=document.createElement("tr");
    ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; tr.appendChild(th); });
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb=document.createElement("tbody");
    // 점수순 정렬
    const calcScore = s => (r.questions||[]).reduce((acc,_,i)=> acc + (s.answers?.[i]?.correct?1:0), 0);
    const sorted = list.slice().sort((a,b)=> calcScore(b)-calcScore(a));
    sorted.forEach(s=>{
      let score=0; const tr=document.createElement("tr");
      const tdn=document.createElement("td"); tdn.textContent=s.name||s.id; tr.appendChild(tdn);
      (r.questions||[]).forEach((q,i)=>{
        const a=s.answers?.[i]; const td=document.createElement("td");
        td.textContent = a? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value??'-')) : '-';
        if(a?.correct) score++; tr.appendChild(td);
      });
      const tds=document.createElement("td"); tds.textContent=String(score); tr.appendChild(tds);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
  }
}

/***********************
 * Events
 ***********************/
function wireTabs(){
  els.tabBuild?.addEventListener("click", ()=> showPanel("build"));
  els.tabOptions?.addEventListener("click",()=> showPanel("options"));
  els.tabPresent?.addEventListener("click",()=> showPanel("present"));
  els.tabResults?.addEventListener("click",()=> showPanel("results"));
}
function wireActions(){
  els.btnConnect?.addEventListener("click", connect);
  els.btnSignOut?.addEventListener("click", signOut);

  // 문항 만들기
  els.btnBuildForm?.addEventListener("click", ()=>{
    const n=Math.max(1,Math.min(50, parseInt(els.questionCount?.value,10)||3));
    if(els.builder){ els.builder.innerHTML=""; for(let i=0;i<n;i++) els.builder.appendChild(cardRow(i+1)); }
  });
  els.btnLoadSample?.addEventListener("click", ()=>{
    const S=[
      {type:'mcq', text:'가장 큰 행성?', options:['지구','목성','화성','금성'], answerIndex:1, img:null},
      {type:'short', text:'물의 끓는점(°C)?', answerText:'100', img:null},
      {type:'mcq', text:'태양계 별명?', options:['Milky','Solar','Sunset','Lunar'], answerIndex:1, img:null},
    ];
    if(els.builder){ els.builder.innerHTML=""; S.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q))); }
    if(els.quizTitle) els.quizTitle.value="샘플 퀴즈";
    if(els.questionCount) els.questionCount.value=S.length;
  });
  els.btnSaveQuiz?.addEventListener("click", async ()=>{
    await ensureFb();
    const { setDoc } = window.firebase__lazy;
    const payload=collectBuilder(); if(!payload.questions.length) return alert("문항을 추가하세요.");
    if(!roomId) return alert("세션 먼저 접속하세요.");
    await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
    alert("저장 완료!");
  });

  // 텍스트/CSV 업로드 & 샘플양식
  els.btnUploadTxt?.addEventListener("click", ()=> els.fileUploadTxt?.click());
  els.fileUploadTxt?.addEventListener("change", async (e)=>{
    const f=e.target.files?.[0]; if(!f) return;
    const text = await f.text();
    const lines = text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const list=[];
    for(const ln of lines){
      const cols = ln.split(",").map(s=>s.trim());
      if(cols.length>=6 && cols[5].match(/^\d+$/)){
        list.push({ type:"mcq", text:cols[0], options:cols.slice(1,5), answerIndex: (parseInt(cols[5],10)-1), img:null });
      }else if(cols.length>=3 && cols[1]==="주관식"){
        list.push({ type:"short", text:cols[0], answerText:cols[2], img:null });
      }
    }
    if(els.builder){ els.builder.innerHTML=""; list.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q))); }
    alert(`불러오기 완료 (${list.length}문항)`);
    e.target.value="";
  });
  els.btnDownloadTemplate?.addEventListener("click", ()=>{
    const sample = [
      "가장 큰 행성?,지구,목성,화성,금성,2",
      "물의 끓는점은?,주관식,100",
    ].join("\n");
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([sample],{type:"text/plain"}));
    a.download="quiz_template.csv"; a.click(); URL.revokeObjectURL(a.href);
  });

  // 옵션 저장
  els.btnSaveOptions?.addEventListener("click", saveOptions);

  // 프레젠테이션
  els.btnStart?.addEventListener("click", startQuiz);
  els.btnPrev?.addEventListener("click", ()=>step(-1));
  els.btnNext?.addEventListener("click", ()=>step(+1));
  els.btnEndAll?.addEventListener("click", finishAll);

  // 결과
  els.btnExportCSV?.addEventListener("click", exportCSV);
  els.btnResetAll?.addEventListener("click", resetAll);

  // 학생
  els.btnJoin?.addEventListener("click", (e)=>{ e.preventDefault(); join(); });
  els.btnShortSend?.addEventListener("click", ()=> submit((els.shortInput?.value||"").trim()));
  els.btnSubmitMCQ?.addEventListener("click", ()=> {
    if(mcqSelected==null) return alert("보기를 먼저 선택하세요.");
    submit(mcqSelected);
  });
}

async function exportCSV(){
  await ensureFb();
  if(!roomId) return;
  const { getDoc, getDocs } = window.firebase__lazy;
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
}

async function resetAll(){
  await ensureFb();
  if(!roomId) return;
  const { setDoc, getDocs } = window.firebase__lazy;
  await setDoc(roomRef(roomId), { mode:"idle", currentIndex:-1, accept:false, reveal:false }, { merge:true });
  const snap=await getDocs(respCol(roomId)); const tasks=[];
  snap.forEach(d=> tasks.push(
    setDoc(firebaseDoc("rooms", roomId, "responses", d.id), { answers:{}, alive:true }, { merge:true })
  ));
  await Promise.all(tasks);
  alert("초기화 완료");
}

/***********************
 * Boot & URL 라우팅
 ***********************/
function autoReconnect(){
  loadLocal();
  // URL 파라미터 우선
  const url=new URL(location.href);
  const role=url.searchParams.get("role"); const rid=url.searchParams.get("room");
  if(role==='student') MODE='student'; else MODE='admin';
  if(rid) roomId=rid;

  setMode(MODE);
  updateTopline();

  // 학생 모드 초기 진입 시 참가 다이얼로그
  if(MODE==='student'){
    els.studentPanel?.classList.remove("hide");
    updateStudentTop();
    // 이름/번호 입력 유도
    if(typeof els.joinDialog?.showModal === "function") els.joinDialog.showModal();
  }

  // 관리자라면 첫 화면은 문항 탭
  if(MODE==='admin') showPanel("build");

  if(roomId) connect(); // 세션 자동 연결
}

wireTabs();
wireActions();
autoReconnect();
