/* app.js — 레이아웃은 유지, 기능만 보완 */
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));

/** Firebase */
const { initializeApp, getFirestore, collection, doc, setDoc, getDoc, getDocs, onSnapshot, updateDoc, runTransaction, serverTimestamp } = window._fb;

const firebaseConfig = {
  apiKey: "AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo",
  authDomain: "live-quiz-a14d1.firebaseapp.com",
  projectId: "live-quiz-a14d1",
};
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

/** 상태 */
let MODE='admin', roomId='', unsubRoom=null, unsubResp=null, timerHandle=null;
let policy='device', me={ id:null, name:'' }, roomCache=null, respCache=[];

/** 엘리먼트 */
const A={
  adminRoot: $("#adminRoot"), adminHeader: $("#adminHeader"),
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnLogout: $("#btnLogout"),
  roomStatus: $("#roomStatus"), liveDot: $("#liveDot"),

  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  panelBuild: $("#panelBuild"), panelOptions: $("#panelOptions"), panelPresent: $("#panelPresent"), panelResults: $("#panelResults"),

  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"), builder: $("#builder"),

  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright: $("#chkBright"),
  timerSec: $("#timerSec"), btnSaveOptions: $("#btnSaveOptions"),

  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  leftSec: $("#leftSec"), pTitle: $("#pTitle"), pQ: $("#pQ"), pImg: $("#pImg"), pOpts: $("#pOpts"), presentWait: $("#presentWait"),

  statJoin: $("#statJoin"), statSubmit: $("#statSubmit"), statCorrect: $("#statCorrect"), statWrong: $("#statWrong"),

  btnExportCSV: $("#btnExportCSV"), btnResetAll: $("#btnResetAll"), resultsTable: $("#resultsTable"),

  // 학생
  studentPanel: $("#studentPanel"), studentTopInfo: $("#studentTopInfo"),
  studentJoin: $("#studentJoin"), studentName: $("#studentName"), btnJoin: $("#btnJoin"),
  studentQuiz: $("#studentQuiz"), badgeType: $("#badgeType"), sQText: $("#sQText"),
  sImg: $("#sImg"), mcqBox: $("#mcqBox"), btnSubmitMCQ: $("#btnSubmitMCQ"),
  shortBox: $("#shortBox"), shortInput: $("#shortInput"), btnShortSend: $("#btnShortSend"),
  studentDone: $("#studentDone"), studentResult: $("#studentResult"), studentResultBody: $("#studentResultBody"),
  studentTimer: $("#studentTimer"), studentHint: $("#studentHint"),
};

/** 공용 ref */
const roomRef = (id)=>doc(db,"rooms",id);
const respCol = (id)=>collection(db,"rooms",id,"responses");

/** 로컬 상태 */
function saveLocal(){ localStorage.setItem("quiz.live", JSON.stringify({ roomId, policy, bright: !!A.chkBright?.checked })); }
function loadLocal(){
  try{
    const d=JSON.parse(localStorage.getItem("quiz.live")||"{}");
    roomId=d.roomId||""; policy=d.policy||"device";
    if(A.chkBright) A.chkBright.checked = !!d.bright;
    if(roomId && A.roomId) A.roomId.value=roomId;
  }catch{}
}

/** 모드/탭 토글 */
function setMode(m){
  MODE=m;
  const isAdmin = (m==='admin');
  // 관리자 UI만 표시
  $$('.admin-only').forEach(x=>x.classList.toggle('hide', !isAdmin));
  [A.panelBuild,A.panelOptions,A.panelPresent,A.panelResults].forEach(p=>p?.classList.toggle('hide', !isAdmin));
  A.studentPanel?.classList.toggle('hide', isAdmin);

  // 상단 상태
  A.roomStatus && (A.roomStatus.textContent = roomId?`세션: ${roomId} · 온라인`:'세션: - · 오프라인');
  if(A.liveDot) A.liveDot.style.background = roomId ? '#f33' : '#555';
}

/** 학생 링크/QR */
function buildStudentLink(alsoQR=false){
  if(!A.studentLink) return;
  if(!roomId){ A.studentLink.value=""; return; }
  const url=new URL(location.href);
  url.searchParams.set("mode","student");
  url.searchParams.set("room", roomId);
  A.studentLink.value = url.toString();
  if(alsoQR && window.QRCode && A.qrCanvas){
    QRCode.toCanvas(A.qrCanvas, A.studentLink.value, { width: 120 }, (err)=>{ if(err) console.warn(err); });
  }
}

/** 접속/해제 */
async function connect(){
  const id=(A.roomId?.value||"").trim();
  if(!id) return alert("세션 코드를 입력하세요.");
  roomId=id;
  const s=await getDoc(roomRef(roomId));
  if(!s.exists()){
    await setDoc(roomRef(roomId),{
      title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false, bright:false,
      policy:"device", timerSec:30, createdAt:serverTimestamp(), questions:[]
    });
  }
  listenRoom(roomId); listenResponses(roomId);
  // 잠금: 입력 비활성화
  A.roomId.disabled = true;
  A.btnConnect.disabled = true;
  A.btnLogout.disabled = false;
  buildStudentLink(true);
  setMode('admin');
  saveLocal();
}
function logout(){
  // 잠금 해제
  A.roomId.disabled = false;
  A.btnConnect.disabled = false;
  A.btnLogout.disabled = true;
  roomId=""; saveLocal();
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  setMode('admin');
}

/** 리스너 */
function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom=onSnapshot(roomRef(id),(snap)=>{
    if(!snap.exists()) return;
    roomCache=snap.data();
    renderRoom(roomCache);
  });
}
function listenResponses(id){
  if(unsubResp) unsubResp();
  unsubResp=onSnapshot(respCol(id),(qs)=>{
    const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    respCache = arr;
    renderResponses(arr);
  });
}

/** 문항 카드 */
function qCard(no, q={}){
  const wrap=document.createElement("div"); wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="radio"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'}> 객관식</label>
      <label class="radio"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''}> 주관식</label>
    </div>
    <input class="input q-text" placeholder="문항" value="${q?.text||''}">
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="input opt" placeholder="보기${i+1}" value="${v}">`).join('')}
      </div>
      <div class="row gap"><span class="muted">정답 번호</span><input class="input xs ansIndex" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}"></div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <input class="input ansText" placeholder="정답(자동 채점용, 선택)" value="${q?.answerText||''}">
    </div>`;
  const radios=$$(`input[name="type-${no}"]`,wrap);
  const mcq = $(".mcq",wrap), short=$(".short",wrap);
  radios.forEach(r=>r.addEventListener("change",()=>{
    const isShort = radios.find(x=>x.checked)?.value==='short';
    mcq.classList.toggle("hide", isShort);
    short.classList.toggle("hide", !isShort);
  }));
  return wrap;
}
function collectQuiz(){
  const cards=$$("#builder .qcard");
  const list=cards.map((c)=>{
    const type=c.querySelector('input[type="radio"]:checked').value;
    const text=c.querySelector('.q-text').value.trim(); if(!text) return null;
    if(type==='mcq'){
      const opts=$$(".opt",c).map(x=>x.value.trim()).filter(Boolean);
      const ans = Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector('.ansIndex').value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans };
    } else {
      return { type:'short', text, answerText:c.querySelector('.ansText').value.trim() };
    }
  }).filter(Boolean);
  return { title: A.quizTitle?.value||"퀴즈", questions:list };
}

/** 프레젠테이션/흐름 */
async function startQuiz(){ if(!roomId) return; await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true }); }
async function step(delta){
  await runTransaction(db, async (tx)=>{
    const s=await tx.get(roomRef(roomId));
    const r=s.data(); const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){ // 종료 -> 결과 탭으로
      tx.update(roomRef(roomId), { currentIndex: Math.max(0,total-1), mode:"ended", accept:false });
      activateTab(A.tabResults);
      return;
    }
    next=Math.max(0,next);
    tx.update(roomRef(roomId), { currentIndex: next, accept:true });
  });
}
async function finishAll(){ if(!roomId) return; await updateDoc(roomRef(roomId), { mode:"ended", accept:false }); activateTab(A.tabResults); }

/** 타이머(옵션 저장 시 값 사용, 자동-다음) */
function startTimer(sec){
  stopTimer();
  const end = Date.now()+sec*1000;
  timerHandle=setInterval(async ()=>{
    const remain=Math.max(0, Math.floor((end-Date.now())/1000));
    A.leftSec.textContent = `${String(Math.floor(remain/60)).padStart(2,'0')}:${String(remain%60).padStart(2,'0')}`;
    if(remain<=0){
      stopTimer();
      await updateDoc(roomRef(roomId), { accept:false });
      setTimeout(()=> step(+1), 400);
    }
  }, 250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } A.leftSec.textContent="00:00"; }

/** 렌더 */
function renderRoom(r){
  // 관리자 상태
  if(MODE==='admin'){
    A.presentWait.classList.toggle('hide', !(r.mode!=='active' || (r.currentIndex??-1)<0));
    A.pTitle.textContent = r.title || roomId;
    A.pQ.textContent = (r.currentIndex>=0 && r.questions?.[r.currentIndex])? r.questions[r.currentIndex].text : "-";
    A.pOpts.innerHTML="";
    const q=r.questions?.[r.currentIndex];
    if(q && q.type==='mcq'){
      q.options.forEach((t,i)=>{
        const b=document.createElement("div");
        b.className="opt"; b.textContent=`${i+1}. ${t}`;
        A.pOpts.appendChild(b);
      });
    }
    // 통계
    const idx=r.currentIndex;
    const joined = respCache.length;
    const submitted = respCache.filter(s=> s.answers && s.answers[idx]!=null).length;
    const correct = respCache.filter(s=> s.answers && s.answers[idx]?.correct===true).length;
    const wrong   = Math.max(0, submitted - correct);
    A.statJoin.textContent   = `참가 ${joined}`;
    A.statSubmit.textContent = `제출 ${submitted}`;
    A.statCorrect.textContent= `정답 ${correct}`;
    A.statWrong.textContent  = `오답 ${wrong}`;
  }

  // 학생 상단 정보
  A.studentTopInfo.textContent = roomId?`세션: ${roomId} · 온라인`:'세션: - · 오프라인';

  // 학생 흐름
  renderStudent();
}
function renderStudent(){
  if(MODE!=='student') return;
  const r=roomCache||{};
  const idx=r.currentIndex;
  const q = (idx>=0)? r.questions?.[idx] : null;

  // 모드별 카드 표시
  const waiting = !(r.mode==='active' && idx>=0);
  A.studentJoin.classList.toggle('hide', !!me.id);
  A.studentQuiz.classList.toggle('hide', !me.id || waiting);
  A.studentDone.classList.toggle('hide', !(r.mode==='ended'));

  if(waiting && me.id){
    A.sQText.textContent="제출 버튼을 눌러주세요.";
    A.badgeType.textContent="대기";
    A.mcqBox.innerHTML="";
    A.shortBox.classList.add("hide");
    A.btnSubmitMCQ.classList.add("hide");
    return;
  }
  if(r.mode==='ended' && me.id){
    A.studentResult.textContent="내 결과";
    buildStudentResult(r);
    return;
  }
  if(!q) return;

  // 문항 렌더
  A.badgeType.textContent = q.type==='mcq'?'객관식':'주관식';
  A.sQText.textContent = q.text||"-";

  // 이미지
  if(q.img){
    A.sImg.src = q.img; A.sImg.classList.remove("hide");
  } else {
    A.sImg.classList.add("hide");
  }

  if(q.type==='mcq'){
    A.mcqBox.innerHTML="";
    q.options.forEach((opt,i)=>{
      const b=document.createElement("div");
      b.className="opt"; b.textContent=`${i+1}. ${opt}`;
      b.onclick=()=>{ A.btnSubmitMCQ.dataset.idx=i; $$(".opt",A.mcqBox).forEach(x=>x.classList.remove("sel")); b.classList.add("sel"); A.btnSubmitMCQ.classList.remove("hide"); };
      A.mcqBox.appendChild(b);
    });
    A.shortBox.classList.add("hide");
  }else{
    A.mcqBox.innerHTML="";
    A.shortBox.classList.remove("hide");
    A.btnSubmitMCQ.classList.add("hide");
  }
}

/** 결과표 */
function renderResponses(list){
  if(MODE!=='admin') return;
  const r=roomCache||{};
  const tbl=document.createElement("table");
  const thead=document.createElement("thead"), tr=document.createElement("tr");
  ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; tr.appendChild(th); });
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
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  A.resultsTable.innerHTML=""; A.resultsTable.appendChild(tbl);
}

/** 학생 제출 */
async function join(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name=(A.studentName?.value||"").trim(); if(!name) return alert("이름을 입력하세요.");
  // 디바이스 고유키
  me = { id: localStorage.getItem(`did.${roomId}`) || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem(`did.${roomId}`, me.id);
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{} }, { merge:true });
  A.studentHint.textContent="참가 완료! 시작을 기다려 주세요.";
  renderStudent();
}
async function submitMCQ(){
  const idx=parseInt(A.btnSubmitMCQ.dataset.idx,10);
  if(Number.isNaN(idx)) return alert("보기를 선택하세요.");
  return submit(idx);
}
async function submit(value){
  const r=roomCache; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const qIdx=r.currentIndex; const q=r.questions?.[qIdx]; if(!q) return;
  const ref=doc(respCol(roomId), me.id);
  const snap=await getDoc(ref); const prev=snap.exists()? (snap.data().answers||{}) : {};
  if(prev[qIdx]!=null) { A.studentHint.textContent="이미 제출했습니다."; return; }
  if(policy==='realname'){
    const same = respCache.find(x=> x.name && x.name===me.name && x.answers?.[qIdx]!=null);
    if(same){ A.studentHint.textContent="(실명 1회) 이미 제출된 이름입니다."; return; }
  }
  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${qIdx}`]: { value, correct:(correct===true), revealed: !!r.reveal } }, { merge:true });
  A.studentHint.textContent="제출 완료!";
}

/** 결과(학생 개인) */
async function buildStudentResult(r){
  const ref=doc(respCol(roomId), me.id);
  const s=await getDoc(ref); const data=s.exists()? s.data():{};
  const answers=data.answers||{};
  const rows=[];
  let score=0;
  (r.questions||[]).forEach((q,i)=>{
    const a=answers[i];
    if(a?.correct) score++;
    rows.push(`<tr><td>${i+1}</td><td>${a? (q.type==='mcq'?(typeof a.value==='number'? a.value+1 : '-'):(a.value??'-')):'-'}</td><td>${a?(a.correct?'O':'X'):'-'}</td></tr>`);
  });
  A.studentResultBody.innerHTML = `<table><thead><tr><th>문항</th><th>제출</th><th>정답</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  A.studentResult.textContent = `이름: ${data.name||'-'} · 점수: ${score}`;
}

/** 이벤트 */
A.btnConnect?.addEventListener("click", connect);
A.btnLogout?.addEventListener("click", logout);

A.tabBuild?.addEventListener("click", ()=>activateTab(A.tabBuild));
A.tabOptions?.addEventListener("click", ()=>activateTab(A.tabOptions));
A.tabPresent?.addEventListener("click", ()=>activateTab(A.tabPresent));
A.tabResults?.addEventListener("click", ()=>activateTab(A.tabResults));

A.btnBuildForm?.addEventListener("click", ()=>{
  const n=Math.max(1,Math.min(20, parseInt(A.questionCount?.value,10)||3));
  if(A.builder){ A.builder.innerHTML=""; for(let i=0;i<n;i++) A.builder.appendChild(qCard(i+1)); }
});
A.btnLoadSample?.addEventListener("click", ()=>{
  const SAMP=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)은?', answerText:'100'},
    {type:'mcq', text:'대한민국 수도?', options:['부산','인천','서울','대전'], answerIndex:2},
  ];
  if(A.builder){ A.builder.innerHTML=""; SAMP.forEach((q,i)=>A.builder.appendChild(qCard(i+1,q))); }
  A.quizTitle.value="샘플 퀴즈"; A.questionCount.value=SAMP.length;
});
A.btnSaveQuiz?.addEventListener("click", async ()=>{
  if(!roomId) return alert("먼저 세션에 접속하세요.");
  const payload=collectQuiz(); if(!payload.questions.length) return alert("문항을 추가하세요.");
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("문항 저장 완료!");
});

A.btnSaveOptions?.addEventListener("click", async ()=>{
  if(!roomId) return alert("먼저 세션에 접속하세요.");
  // 정책/옵션 저장
  const pol = document.querySelector('input[name="policy"]:checked')?.value||'device';
  policy = pol;
  const bright = !!A.chkBright?.checked;
  const timer  = Math.max(5, Math.min(600, parseInt(A.timerSec?.value,10)||30));
  await setDoc(roomRef(roomId), { policy:pol, bright, timerSec:timer, accept: !!A.chkAccept.checked, reveal: !!A.chkReveal.checked }, { merge:true });
  // 링크/QR 즉시 갱신
  buildStudentLink(true);
  saveLocal();
});

A.btnOpenStudent?.addEventListener("click", ()=>{
  // 링크 입력칸이 비어있어도 roomId로 바로 생성해서 오픈
  if(!A.studentLink.value) buildStudentLink(true);
  const url = A.studentLink.value || "#";
  window.open(url,"_blank");
});
A.btnCopyLink?.addEventListener("click", ()=>{
  if(!A.studentLink.value) buildStudentLink();
  navigator.clipboard.writeText(A.studentLink.value||"");
});

A.btnStart?.addEventListener("click", startQuiz);
A.btnPrev ?.addEventListener("click", ()=>step(-1));
A.btnNext ?.addEventListener("click", ()=>step(+1));
A.btnEndAll?.addEventListener("click", finishAll);

A.btnExportCSV?.addEventListener("click", exportCSV);
A.btnResetAll ?.addEventListener("click", resetAll);

A.btnJoin?.addEventListener("click", join);
A.btnSubmitMCQ?.addEventListener("click", submitMCQ);
A.btnShortSend?.addEventListener("click", ()=> submit((A.shortInput?.value||"").trim()));

/** CSV 내보내기 */
async function exportCSV(){
  if(!roomId) return;
  const r=(await getDoc(roomRef(roomId))).data();
  const res=await getDocs(respCol(roomId));
  const rows=[]; rows.push(["userId","name",...(r.questions||[]).map((_,i)=>`Q${i+1}`),"score"].join(","));
  res.forEach(d=>{
    const s=d.data(); let score=0;
    const ans=(r.questions||[]).map((q,i)=>{ const a=s.answers?.[i]; if(a?.correct) score++; return q.type==='mcq' ? (typeof a?.value==='number'? a.value+1 : "") : (a?.value??""); });
    rows.push([d.id, `"${(s.name||"").replace(/"/g,'""')}"`, ...ans, score].join(","));
  });
  const blob=new Blob([rows.join("\n")],{type:"text/csv"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`${(r.title||roomId)}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
}

/** 전체 초기화(문항/옵션/응답 초기 상태) */
async function resetAll(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  if(!confirm("문항/옵션/응답을 모두 초기화합니다. 계속할까요?")) return;
  // 룸 초기 상태
  await setDoc(roomRef(roomId), {
    title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false, bright:false,
    policy:"device", timerSec:30, questions:[]
  }, { merge:true });
  // 응답 비우기
  const snap=await getDocs(respCol(roomId));
  await Promise.all(snap.docs.map(d=> setDoc(doc(respCol(roomId), d.id), { answers:{}, alive:true }, { merge:true })));
  // UI 정리
  A.builder.innerHTML=""; A.quizTitle.value=""; A.questionCount.value=3;
  A.chkAccept.checked=false; A.chkReveal.checked=false; A.chkBright.checked=false; A.timerSec.value=30;
  A.resultsTable.innerHTML="";
  alert("초기화 완료");
}

/** 탭 활성화 */
function activateTab(btn){
  [A.tabBuild,A.tabOptions,A.tabPresent,A.tabResults].forEach(b=>b?.classList.remove("active"));
  btn?.classList.add("active");
  const show = (btn===A.tabBuild)?"panelBuild" : (btn===A.tabOptions)?"panelOptions" : (btn===A.tabPresent)?"panelPresent" : "panelResults";
  [A.panelBuild,A.panelOptions,A.panelPresent,A.panelResults].forEach(p=>p?.classList.add("hide"));
  $("#"+show)?.classList.remove("hide");
}

/** 부팅 */
(function boot(){
  loadLocal();
  setMode('admin');              // 항상 관리자 UI로 시작
  if(roomId){ connect(); }       // 저장된 세션이 있으면 자동 접속
})();
