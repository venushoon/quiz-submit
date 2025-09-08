import {
  doc, setDoc, getDoc, updateDoc, onSnapshot, runTransaction,
  collection, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* ---------- 유틸 & 상태 ---------- */
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));
const pad = n => String(n).padStart(2,'0');

let MODE   = "admin";   // 'admin' | 'student'
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;

/* ---------- 엘리먼트 ---------- */
const els = {
  liveDot: $("#liveDot"),

  // 헤더(관리자 전용)
  adminSession: $("#adminSession"),
  adminTabs: $("#adminTabs"),
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnSignOut: $("#btnSignOut"),
  roomStatus: $("#roomStatus"),

  // 탭 & 패널
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"), pOptions: $("#panelOptions"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),

  // 문항 빌더
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"), btnBuildForm: $("#btnBuildForm"),
  btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"), builder: $("#builder"),
  fileUploadTxt: $("#fileUploadTxt"), btnUploadTxt: $("#btnUploadTxt"), btnDownloadTemplate: $("#btnDownloadTemplate"),

  // 옵션
  policyDevice: $("#policyDevice"), policyName: $("#policyName"),
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright: $("#chkBright"),
  timerSec: $("#timerSec"), btnSaveOptions: $("#btnSaveOptions"), btnHardReset: $("#btnHardReset"),

  // 학생 접속
  studentAccess: $("#studentAccess"),
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"),
  btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

  // 프레젠테이션
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  leftSec: $("#leftSec"),
  presentWait: $("#presentWait"), pTitle: $("#pTitle"), pQ: $("#pQ"), pImg: $("#pImg"), pOpts: $("#pOpts"),
  statJoin: $("#statJoin"), statSubmit: $("#statSubmit"), statCorrect: $("#statCorrect"), statWrong: $("#statWrong"),

  // 결과
  btnExportCSV: $("#btnExportCSV"), btnResetAll: $("#btnResetAll"), resultsTable: $("#resultsTable"),

  // 학생
  studentPanel: $("#studentPanel"),
  studentTopInfo: $("#studentTopInfo"),
  joinDialog: $("#joinDialog"), studentName: $("#studentName"), btnJoin: $("#btnJoin"),
  studentWait: $("#studentWait"), studentQuiz: $("#studentQuiz"),
  badgeType: $("#badgeType"), sProgress: $("#sProgress"), sQText: $("#sQText"), sImg: $("#sImg"),
  mcqBox: $("#mcqBox"), shortBox: $("#shortBox"), shortInput: $("#shortInput"),
  btnShortSend: $("#btnShortSend"), btnSubmitMCQ: $("#btnSubmitMCQ"),
};

/* ---------- 보관 ---------- */
function saveLocal(){ localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me })); }
function loadLocal(){
  try{
    const d=JSON.parse(localStorage.getItem("quiz.live")||"{}");
    roomId=d.roomId||""; MODE=d.MODE||"admin"; me=d.me||{id:null,name:""};
    if(roomId && els.roomId) els.roomId.value=roomId;
  }catch{}
}

/* ---------- Firestore refs ---------- */
const roomRef = id => doc(window.db,"rooms",id);
const respCol = id => collection(window.db,"rooms",id,"responses");

/* ---------- 세션 ---------- */
async function ensureRoom(id){
  const snap=await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false, bright:false,
      createdAt: serverTimestamp(), policy:"device", timerSec:30, questions:[]
    });
  }
}
function setLive(on){ els.liveDot.style.background = on ? "#f43" : "#555"; }

async function connect(){
  const id=(els.roomId?.value||"").trim();
  if(!id) return alert("세션 코드를 입력하세요.");
  roomId=id;
  await ensureRoom(roomId);
  els.roomId.disabled = true;
  els.btnConnect.classList.add("hide");
  els.btnSignOut.classList.remove("hide");
  setLive(true);
  listenRoom(roomId);
  listenResponses(roomId);
  updateStatus(`세션: ${roomId} · 온라인`);
  buildStudentLink(); // 옵션 저장 전에도 1차 표시
  saveLocal();
}
function updateStatus(t){ if(els.roomStatus) els.roomStatus.textContent=t; }
function signOut(){
  roomId=""; saveLocal();
  [unsubRoom,unsubResp].forEach(u=>u&&u());
  els.roomId.disabled = false;
  els.btnConnect.classList.remove("hide");
  els.btnSignOut.classList.add("hide");
  updateStatus("세션: - · 오프라인");
  setLive(false);
}

/* ---------- 모드 ---------- */
function setMode(m){
  MODE=m;
  const adminEls=[els.adminSession, els.adminTabs];
  adminEls.forEach(e=> e?.classList.toggle("hide", m!=="admin")); // 학생 모드면 헤더/탭 숨김
  [els.pBuild,els.pOptions,els.pPresent,els.pResults].forEach(p=>p?.classList.toggle("hide", m!=="admin"));
  els.studentPanel?.classList.toggle("hide", m!=="student");
  saveLocal();
}

/* ---------- 탭 ---------- */
function activate(tabBtn){
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
  tabBtn.classList.add("active");
  const id = tabBtn.id;
  els.pBuild.classList.toggle("hide", id!=="tabBuild");
  els.pOptions.classList.toggle("hide", id!=="tabOptions");
  els.pPresent.classList.toggle("hide", id!=="tabPresent");
  els.pResults.classList.toggle("hide", id!=="tabResults");
}

/* ---------- 빌더 ---------- */
function qCard(no,q){
  const wrap=document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap gap">
      <span class="badge">${no}번</span>
      <label><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'}> 객관식</label>
      <label><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''}> 주관식</label>
      <button class="btn ghost" data-img="${no}">이미지</button>
      <input type="file" accept="image/*" data-file="${no}" class="hide">
      <img data-thumb="${no}" class="qthumb hide" alt="thumb">
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항 내용" value="${q?.text||''}">
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기 ${i+1}" value="${v}">`).join('')}
      </div>
      <div class="row"><span class="muted">정답 번호</span><input class="ansIndex input sm" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}"></div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <input class="ansText input" data-no="${no}" placeholder="정답(선택, 자동채점용)" value="${q?.answerText||''}">
    </div>
  `;
  // 타입 전환
  const radios = $$(`input[name="type-${no}"]`, wrap);
  const mcq = $(".mcq", wrap), sh = $(".short", wrap);
  radios.forEach(r=> r.addEventListener("change", ()=>{
    const s = radios.find(x=>x.checked)?.value==='short';
    mcq.classList.toggle("hide", s);
    sh.classList.toggle("hide", !s);
  }));

  // 이미지 업로드
  const btnImg = $(`[data-img="${no}"]`, wrap);
  const file   = $(`[data-file="${no}"]`, wrap);
  const thumb  = $(`[data-thumb="${no}"]`, wrap);
  btnImg.addEventListener("click", ()=> file.click());
  file.addEventListener("change", ()=>{
    const f=file.files?.[0]; if(!f) return;
    const reader=new FileReader();
    reader.onload=()=>{ thumb.src=reader.result; thumb.classList.remove("hide"); wrap.dataset.image=reader.result; };
    reader.readAsDataURL(f);
  });

  return wrap;
}
function collectBuilder(){
  const cards = $$("#builder .qcard");
  const list = cards.map((c,idx)=>{
    const no=idx+1;
    const type=c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text=c.querySelector(".qtext").value.trim();
    const image=c.dataset.image||"";
    if(!text) return null;
    if(type==='mcq'){
      const opts=$$(".opt",c).map(x=>x.value.trim()).filter(Boolean);
      const ans = Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans, image };
    } else {
      const answerText=c.querySelector(".ansText").value.trim();
      return { type:'short', text, answerText, image };
    }
  }).filter(Boolean);
  return { title: els.quizTitle?.value||"퀴즈", questions:list };
}

/* ---------- 옵션/링크/QR ---------- */
function buildStudentLink(){
  if(!els.studentLink || !roomId) return;
  const url = new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", roomId);
  els.studentLink.value = url.toString();

  if(window.QRCode && els.qrCanvas){
    try{
      window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:132, margin:1 }, (err)=>{ if(err) console.warn(err); });
    }catch(e){ console.warn(e); }
  }
}

/* ---------- 실시간 리스너 ---------- */
function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom = onSnapshot(roomRef(id), snap=>{
    if(!snap.exists()) return;
    const r=snap.data(); window.__room=r;

    // 프레젠테이션 표시
    renderPresent(r);

    // 학생 표시
    if(MODE==='student') renderStudent(r);
  });
}
function listenResponses(id){
  if(unsubResp) unsubResp();
  unsubResp = onSnapshot(respCol(id), qs=>{
    const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    renderResults(arr);
    renderStats(arr);
  });
}

/* ---------- 프레젠테이션 렌더 ---------- */
function renderPresent(r){
  // 대기 안내
  const showWait = !(r.mode==='active' && (r.currentIndex??-1)>=0);
  els.presentWait.classList.toggle("hide", !showWait);

  const idx=r.currentIndex, total=r.questions?.length||0;
  if(r.bright) document.body.style.background="#111827"; // 밝은 모드 흉내
  els.pTitle.textContent = r.title || roomId || "-";
  els.pOpts.innerHTML="";

  if(!showWait && r.questions[idx]){
    const q=r.questions[idx];
    els.pQ.textContent=q.text||"-";

    // 이미지: 없으면 숨기고 src 제거(깨짐 방지)
    if(q.image){
      els.pImg.src=q.image;
      els.pImg.classList.remove("hide");
    }else{
      els.pImg.removeAttribute("src");
      els.pImg.classList.add("hide");
    }

    if(q.type==='mcq'){
      q.options.forEach((t,i)=>{
        const d=document.createElement("div"); d.className="popt"; d.textContent=`${i+1}. ${t}`;
        els.pOpts.appendChild(d);
      });
    }else{
      const d=document.createElement("div"); d.className="popt"; d.textContent="주관식 문항";
      els.pOpts.appendChild(d);
    }
  }else{
    els.pQ.textContent="-";
    els.pImg.removeAttribute("src");
    els.pImg.classList.add("hide");
  }
}

/* ---------- 학생 렌더 ---------- */
function renderStudent(r){
  els.studentTopInfo.textContent = `세션: ${roomId||"-"} · ${r.mode==='active'?"온라인":"대기"}`;
  const idx=r.currentIndex, total=r.questions?.length||0;

  // 시작 전/유효 인덱스 전까진 '대기'
  if(!(r.mode==='active' && (idx??-1)>=0)){
    els.studentWait.classList.remove("hide");
    els.studentQuiz.classList.add("hide");
    return;
  }

  // 문항 표시
  const q=r.questions[idx];
  els.studentWait.classList.add("hide");
  els.studentQuiz.classList.remove("hide");

  els.sProgress.textContent = `${idx+1} / ${total}`;
  els.sQText.textContent = q.text || "-";
  els.badgeType.textContent = q.type==='mcq' ? "객관식" : "주관식";

  if(q.image){
    els.sImg.src=q.image;
    els.sImg.classList.remove("hide");
  }else{
    els.sImg.removeAttribute("src");
    els.sImg.classList.add("hide");
  }

  if(q.type==='mcq'){
    els.shortBox.classList.add("hide");
    els.btnSubmitMCQ.classList.remove("hide");
    els.mcqBox.innerHTML="";
    q.options.forEach((opt,i)=>{
      const b=document.createElement("button");
      b.className="optbtn"; b.textContent=`${i+1}. ${opt}`;
      b.addEventListener("click", ()=> selectMCQ(i));
      els.mcqBox.appendChild(b);
    });
    updateMCQButtons(); // 선택 반영
  }else{
    els.mcqBox.innerHTML="";
    els.btnSubmitMCQ.classList.add("hide");
    els.shortBox.classList.remove("hide");
  }
}

/* ---------- 통계 & 결과 ---------- */
function renderStats(list){
  if(!window.__room) return;
  const idx=window.__room.currentIndex;
  let join=0, submit=0, correct=0, wrong=0;
  list.forEach(s=>{
    join++;
    const a=s.answers?.[idx];
    if(a) submit++;
    if(a?.revealed){ if(a.correct) correct++; else wrong++; }
  });
  els.statJoin.textContent = `참가 ${join}`;
  els.statSubmit.textContent = `제출 ${submit}`;
  els.statCorrect.textContent = `정답 ${correct}`;
  els.statWrong.textContent = `오답 ${wrong}`;
}

function renderResults(list){
  if(MODE!=='admin') return;
  const r=window.__room||{}; const qList=r.questions||[];

  // 결과표
  const tbl=document.createElement("table");
  const thead=document.createElement("thead");
  const htr=document.createElement("tr");
  ["이름", ...qList.map((_,i)=>`Q${i+1}`), "점수"].forEach(t=>{ const th=document.createElement("th"); th.textContent=t; htr.appendChild(th); });
  thead.appendChild(htr); tbl.appendChild(thead);

  const tbody=document.createElement("tbody");
  list.forEach(s=>{
    let score=0;
    const tr=document.createElement("tr");
    const tdName=document.createElement("td"); tdName.textContent=s.name||s.id; tr.appendChild(tdName);
    qList.forEach((q,i)=>{
      const a=s.answers?.[i]; const td=document.createElement("td");
      if(q.type==='mcq'){
        td.textContent = a ? (typeof a.value==='number' ? a.value+1 : '-') : '-';
      }else{
        td.textContent = a ? (a.value ?? '-') : '-';
      }
      if(a?.correct) score++;
      tr.appendChild(td);
    });
    const tdScore=document.createElement("td"); tdScore.textContent=String(score); tr.appendChild(tdScore);
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
}

/* ---------- 제출(학생) ---------- */
let selectedIdx = null;
function selectMCQ(i){ selectedIdx = i; updateMCQButtons(); }
function updateMCQButtons(){
  $$(".optbtn", els.mcqBox).forEach((b,idx)=>{
    b.classList.toggle("active", idx===selectedIdx);
  });
}

async function join(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name=(els.studentName?.value||"").trim();
  if(!name) return alert("이름/번호를 입력하세요.");
  me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem("quiz.device", me.id);
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{} }, { merge:true });
  els.joinDialog.close();
  els.studentWait.classList.remove("hide"); // 대기 모드 유지
  saveLocal();
}

async function submit(value){
  const r=window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;

  const ref=doc(respCol(roomId), me.id);
  const snap=await getDoc(ref); const prev=snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert("이미 제출했습니다.");

  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){
    correct = (value === (q.answerIndex ?? -999));
  } else if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase();
    if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true), revealed:r.reveal||false } }, { merge:true });
  alert("제출 완료!");
}

/* ---------- 진행 & 타이머 ---------- */
async function startQuiz(){ await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true }); }
async function step(delta){
  await runTransaction(window.db, async tx=>{
    const snap=await tx.get(roomRef(roomId)); const r=snap.data();
    const total=r.questions?.length||0; let next=(r.currentIndex??-1)+delta;
    if(next>=total){ // 종료 -> 결과 화면 안내
      tx.update(roomRef(roomId), { currentIndex: total-1, mode:"ended", accept:false });
      activate(els.tabResults);
      return;
    }
    next=Math.max(0,next);
    tx.update(roomRef(roomId), { currentIndex: next, accept:true });
  });
}
async function finishAll(){ if(confirm("퀴즈를 종료할까요?")) await updateDoc(roomRef(roomId), { mode:"ended", accept:false }); }

function startTimer(sec){
  stopTimer();
  const end=Date.now()+sec*1000;
  timerHandle=setInterval(async ()=>{
    const remain=Math.max(0, Math.floor((end-Date.now())/1000));
    els.leftSec.textContent = `${pad(Math.floor(remain/60))}:${pad(remain%60)}`;
    if(remain<=0){
      stopTimer();
      await updateDoc(roomRef(roomId), { accept:false });
      setTimeout(()=> step(+1), 500);
    }
  },250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } els.leftSec.textContent="00:00"; }

/* ---------- 이벤트 ---------- */
els.btnConnect?.addEventListener("click", connect);
els.btnSignOut?.addEventListener("click", signOut);

[els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>{
  b?.addEventListener("click", ()=> activate(b));
});

els.btnBuildForm?.addEventListener("click", ()=>{
  const n=Math.max(1,Math.min(50,parseInt(els.questionCount.value,10)||3));
  els.builder.innerHTML=""; for(let i=0;i<n;i++) els.builder.appendChild(qCard(i+1));
});
els.btnLoadSample?.addEventListener("click", ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)은?', answerText:'100'},
    {type:'mcq', text:'태양계 별명?', options:['Milky','Solar','Sunset','Lunar'], answerIndex:1},
  ];
  els.builder.innerHTML=""; S.forEach((q,i)=>els.builder.appendChild(qCard(i+1,q)));
  els.quizTitle.value="샘플 퀴즈"; els.questionCount.value=S.length;
});
els.btnSaveQuiz?.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션 먼저 접속하세요.");
  const payload=collectBuilder(); if(!payload.questions.length) return alert("문항을 추가하세요.");
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("저장 완료!");
});

els.btnUploadTxt?.addEventListener("click", ()=> els.fileUploadTxt.click());
els.fileUploadTxt?.addEventListener("change", async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const text=await f.text();
  const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const qs=[];
  for(const ln of lines){
    const parts=ln.split(",").map(s=>s.trim());
    if(parts.length>=3 && parts[1]==="주관식"){
      qs.push({type:"short", text:parts[0], answerText:parts[2]||""});
    }else if(parts.length>=6){
      qs.push({type:"mcq", text:parts[0], options:parts.slice(1,5), answerIndex:Math.max(0,Math.min(3,(parseInt(parts[5],10)||1)-1))});
    }
  }
  els.builder.innerHTML=""; qs.forEach((q,i)=>els.builder.appendChild(qCard(i+1,q)));
  els.quizTitle.value="업로드 퀴즈"; els.questionCount.value=qs.length;
});
els.btnDownloadTemplate?.addEventListener("click", ()=>{
  const sample = [
    "가장 큰 행성?,지구,목성,화성,금성,2",
    "물의 끓는점?,주관식,100"
  ].join("\n");
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([sample],{type:"text/plain"}));
  a.download="quiz_template.txt"; a.click(); URL.revokeObjectURL(a.href);
});

els.btnSaveOptions?.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션 먼저 접속하세요.");
  const policy = els.policyName.checked ? "name" : "device";
  const timer  = Math.max(5,Math.min(600, parseInt(els.timerSec.value,10)||30));
  await setDoc(roomRef(roomId), {
    policy, accept: !!els.chkAccept.checked, reveal: !!els.chkReveal.checked, bright: !!els.chkBright.checked, timerSec: timer
  }, { merge:true });
  buildStudentLink(); // 즉시 갱신
  alert("옵션 저장 완료");
});
els.btnHardReset?.addEventListener("click", async ()=>{
  if(!roomId) return;
  if(!confirm("세션 전체 초기화(문항/옵션/결과)를 진행할까요?")) return;
  await setDoc(roomRef(roomId), {
    title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false, bright:false,
    policy:"device", timerSec:30, questions:[]
  }, { merge:true });
  const snap=await getDocs(respCol(roomId)); const tasks=[];
  snap.forEach(d=> tasks.push(setDoc(doc(respCol(roomId), d.id), { answers:{} }, { merge:true })));
  await Promise.all(tasks);
  alert("초기화 완료");
});

els.btnStart?.addEventListener("click", async ()=>{
  const r=(await getDoc(roomRef(roomId))).data(); const total=r.questions?.length||0;
  if(total<=0) return alert("문항이 없습니다. 먼저 저장하세요.");
  startQuiz(); startTimer(r.timerSec||30);
});
els.btnPrev?.addEventListener("click", ()=> step(-1));
els.btnNext?.addEventListener("click", ()=> step(+1));
els.btnEndAll?.addEventListener("click", finishAll);

els.btnCopyLink?.addEventListener("click", async ()=>{
  if(!els.studentLink.value) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  alert("링크 복사 완료");
});
els.btnOpenStudent?.addEventListener("click", ()=> window.open(els.studentLink.value,"_blank"));

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
  a.href=URL.createObjectURL(blob); a.download=`${(r.title||roomId||"results")}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
});
els.btnResetAll?.addEventListener("click", async ()=>{
  if(!roomId) return; if(!confirm("응답/점수만 초기화할까요?")) return;
  const snap=await getDocs(respCol(roomId)); const tasks=[];
  snap.forEach(d=> tasks.push(setDoc(doc(respCol(roomId), d.id), { answers:{} }, { merge:true })));
  await Promise.all(tasks); alert("초기화 완료");
});

els.btnJoin?.addEventListener("click", (e)=>{ e.preventDefault(); join(); });
els.btnShortSend?.addEventListener("click", ()=> submit((els.shortInput?.value||"").trim()));
els.btnSubmitMCQ?.addEventListener("click", ()=> {
  if(selectedIdx==null) return alert("보기를 선택하세요.");
  submit(selectedIdx);
});

/* ---------- 부팅 ---------- */
function fromURL(){
  const url=new URL(location.href);
  const role=url.searchParams.get("role");
  const rid =url.searchParams.get("room");
  if(role==='student') setMode("student"); else setMode("admin");

  if(rid){
    roomId=rid;
    if(els.roomId) els.roomId.value=rid;
    // 학생 모드: 헤더/탭 비노출 유지
    listenRoom(roomId); listenResponses(roomId);
    if(MODE==='student'){
      // 참가 팝업 띄우기
      els.joinDialog.showModal();
      updateStatus("");
    }else{
      connect();
    }
  }else{
    // 저장된 최근 세션 복구
    loadLocal();
    setMode(MODE);
    if(roomId) connect();
  }
}
fromURL();
