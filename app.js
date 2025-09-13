(()=>{ 'use strict';

/* ---------- shorthand (지역 스코프: 전역 충돌 X) ---------- */
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));

/* ---------- Firebase 래퍼 확보(없으면 초기화 오류 안내) ---------- */
function FS(){
  if(!window.FS || !window.db) throw new Error("[firebase] not loaded. Ensure compat scripts are included in index.html");
  return window.FS;
}
const pad = n=>String(n).padStart(2,'0');

/* ---------- 요소 모음 (id는 기존 디자인과 동일) ---------- */
const els = {
  // header / tabs
  liveDot: $("#liveDot"),
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnSignOut: $("#btnSignOut"), roomStatus: $("#roomStatus"),
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"), pOptions: $("#panelOptions"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),

  // build
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"),
  btnUploadTxt: $("#btnUploadTxt"), fileUploadTxt: $("#fileUploadTxt"), btnDownloadTemplate: $("#btnDownloadTemplate"),
  builder: $("#builder"),

  // options
  polDevice: $("#polDevice"), polName: $("#polName"),
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright: $("#chkBright"),
  timerSec: $("#timerSec"), btnOptSave: $("#btnOptSave"), btnResetAll: $("#btnResetAll"),
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

  // present
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  nowQuestion: $("#nowQuestion"), leftSec: $("#leftSec"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pImg: $("#pImg"), pOpts: $("#pOpts"),
  chipJoin: $("#chipJoin"), chipSubmit: $("#chipSubmit"), chipCorrect: $("#chipCorrect"), chipWrong: $("#chipWrong"),

  // results
  resultsTable: $("#resultsTable"), btnExportCSV: $("#btnExportCSV"), btnFullBoard: $("#btnFullBoard"),

  // student
  studentAccess: $("#studentAccess"), joinModal: $("#joinModal"),
  joinName: $("#joinName"), btnJoinGo: $("#btnJoinGo"),
  sState: $("#sState"), sWrap: $("#sWrap"),
  sQTitle: $("#sQTitle"), sQImg: $("#sQImg"), sOptBox: $("#sOptBox"),
  sShortWrap: $("#sShortWrap"), sShortInput: $("#sShortInput"), btnShortSend: $("#btnShortSend"),
  sDone: $("#sDone"), btnShowMy: $("#btnShowMy"), myResult: $("#myResult")
};

/* ---------- 상태 ---------- */
let MODE   = 'admin';      // 'admin' | 'student'
let roomId = '';
let me     = { id:null, name:'' };

let timerHandle=null, unsubRoom=null, unsubResp=null;

/* ---------- util ---------- */
const {doc,collection,setDoc,getDoc,getDocs,onSnapshot,updateDoc,runTransaction,serverTimestamp} = FS();
const roomRef=(id)=>doc(window.db,"rooms",id);
const respCol=(id)=>collection(window.db,"rooms",id,"responses");

function heartbeat(on){ if(els.liveDot) els.liveDot.style.background = on ? "#f43" : "#555"; }
function saveLocal(){ localStorage.setItem("quiz.live", JSON.stringify({roomId,MODE,me})); }
function loadLocal(){
  try{
    const d = JSON.parse(localStorage.getItem("quiz.live")||"{}");
    roomId = d.roomId||''; MODE = d.MODE||'admin'; me = d.me||{id:null,name:''};
    if(els.roomId && roomId) els.roomId.value=roomId;
  }catch{}
}

/* ---------- 모드 / 탭 ---------- */
function setMode(m){
  MODE = m;
  // 관리자·학생 UI 토글 (디자인 클래스 그대로)
  $$(".admin-only").forEach(n=>n.classList.toggle("hide", m!=='admin'));
  if(els.studentAccess) els.studentAccess.classList.toggle("hide", m!=='student');
  if(m==='admin') showTab('build');
}
function showTab(key){
  const map={build:els.pBuild, options:els.pOptions, present:els.pPresent, results:els.pResults};
  Object.values(map).forEach(p=>p?.classList.add('hide'));
  map[key]?.classList.remove('hide');
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove('active'));
  ({build:els.tabBuild, options:els.tabOptions, present:els.tabPresent, results:els.tabResults}[key])?.classList.add('active');
}

/* ---------- Firestore 연결 ---------- */
async function ensureRoom(id){
  const s=await getDoc(roomRef(id));
  if(!s.exists()){
    await setDoc(roomRef(id), {
      title:"샘플 퀴즈",
      policy:"device", accept:false, reveal:false, bright:false,
      timer:30, mode:"idle", currentIndex:-1,
      questions:[], createdAt:serverTimestamp()
    });
  }
}
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
    const arr=[]; qs.forEach(d=>arr.push({id:d.id,...d.data()}));
    window.__resp=arr; renderResponses(arr);
  });
}

/* ---------- 접속/세션아웃/복구 ---------- */
async function connect(){
  try{
    const id=(els.roomId?.value||'').trim();
    if(!id) return alert('세션 코드를 입력하세요.');
    roomId=id;
    await ensureRoom(id);
    listenRoom(id); listenResponses(id);
    els.roomStatus.textContent=`세션: ${id} · 온라인`;
    els.btnConnect.disabled=true; els.roomId.disabled=true; els.btnSignOut.classList.remove('hide');
    buildStudentLink(); heartbeat(true); saveLocal();
  }catch(e){ console.error(e); alert('접속 중 오류: '+e.message); }
}
function signOut(){
  try{
    if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
    roomId=''; els.roomId.disabled=false; els.roomId.value='';
    els.btnConnect.disabled=false; els.btnSignOut.classList.add('hide');
    els.roomStatus.textContent='세션: - · 오프라인'; heartbeat(false);
    showTab('build'); saveLocal();
  }catch(e){ console.error(e); }
}
function autoReconnect(){
  loadLocal();
  // URL 파라미터 우선: ?role=student&room=xxx
  const p=new URLSearchParams(location.search);
  const role=p.get('role'); const rid=p.get('room');
  if(role==='student'){ MODE='student'; roomId=rid||roomId; }
  setMode(MODE);
  if(MODE==='admin'){
    if(roomId) connect();
  }else{
    if(!roomId){ // 학생이 room 미지정일 때: 입력창만
      showStudentWaiting();
    }else{
      listenRoom(roomId); listenResponses(roomId); showStudentWaiting();
    }
  }
}

/* ---------- 빌더 ---------- */
function qCard(no,q){
  const w=document.createElement('div'); w.className='qcard';
  w.innerHTML = `
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'}> 객관식</label>
      <label class="switch"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''}> 주관식</label>
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
    </div>
  `;
  const radios = $$(`input[name="type-${no}"]`,w);
  const mcq=$(".mcq",w), short=$(".short",w);
  radios.forEach(r=>r.addEventListener('change',()=>{
    const isShort = radios.find(x=>x.checked).value==='short';
    mcq.classList.toggle('hide', isShort);
    short.classList.toggle('hide', !isShort);
  }));
  return w;
}
function rebuildEmpty(){
  els.builder.innerHTML='';
  const n = Math.max(1, parseInt(els.questionCount.value,10)||1);
  for(let i=0;i<n;i++) els.builder.appendChild(qCard(i+1));
}
function loadSample(){
  els.quizTitle.value='샘플 퀴즈';
  const sample=[
    { type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1 },
    { type:'short', text:'우리나라의 수도는?', answerText:'서울' },
    { type:'mcq', text:'태양은 무엇인가?', options:['행성','항성','위성','혜성'], answerIndex:1 },
  ];
  els.builder.innerHTML=''; sample.forEach((q,i)=>els.builder.appendChild(qCard(i+1,q)));
}
function gatherBuilder(){
  const cards=$$("#builder>.qcard");
  const list=cards.map((c)=>{
    const type = c.querySelector("input[type=radio]:checked").value;
    const text = c.querySelector(".qtext").value.trim();
    const img  = c.querySelector(".qimg").files?.[0];
    if(!text) return null;
    const payload={ type, text };
    if(img) payload.image = URL.createObjectURL(img);
    if(type==='mcq'){
      const opts = $$(".opt",c).map(i=>i.value.trim());
      const ans  = Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      payload.options=opts; payload.answerIndex=ans;
    }else{
      payload.answerText = c.querySelector(".ansText").value.trim();
    }
    return payload;
  }).filter(Boolean);
  return { title: els.quizTitle.value||'퀴즈', questions:list };
}
async function saveQuiz(){
  const data=gatherBuilder();
  await updateDoc(roomRef(roomId), { title:data.title, questions:data.questions });
  alert('저장되었습니다.');
}

/* ---------- 옵션/QR ---------- */
function buildStudentLink(){
  if(!roomId) return;
  const url=new URL(location.href);
  url.searchParams.set('role','student');
  url.searchParams.set('room', roomId);
  els.studentLink.value=url.toString();
  if(window.QRCode && els.qrCanvas){
    try{ window.QRCode.toCanvas(els.qrCanvas, url.toString(), { width:140 }); }catch(e){ console.warn(e); }
  }
}
async function saveOptions(){
  await updateDoc(roomRef(roomId), {
    policy: els.polName?.checked ? 'name' : 'device',
    accept: !!els.chkAccept?.checked,
    reveal: !!els.chkReveal?.checked,
    bright: !!els.chkBright?.checked,
    timer: parseInt(els.timerSec?.value,10) || 30
  });
  buildStudentLink();
  alert('옵션이 저장되고 링크/QR이 갱신되었습니다.');
}
async function resetAll(){
  if(!confirm('문항/결과/옵션을 초기화합니다. 진행할까요?')) return;
  await updateDoc(roomRef(roomId), {
    title:'새 세션', questions:[], mode:'idle', currentIndex:-1,
    accept:false, reveal:false, bright:false
  });
  alert('초기화되었습니다.');
}

/* ---------- 진행/타이머 ---------- */
async function startQuiz(){ await updateDoc(roomRef(roomId), { mode:'active', currentIndex:0, accept:true }); }
async function step(delta){
  await runTransaction(window.db, async (tx)=>{
    const snap=await tx.get(roomRef(roomId)); const r=snap.data();
    const total=(r.questions?.length||0); let next=(r.currentIndex??-1)+delta;
    if(next>=total){ tx.update(roomRef(roomId), { mode:'ended', accept:false }); return; }
    next=Math.max(0,next); tx.update(roomRef(roomId), { currentIndex:next, accept:true });
  });
}
async function endAll(){ await updateDoc(roomRef(roomId), { mode:'ended', accept:false }); }

function startTimer(sec){
  stopTimer();
  const end=Date.now()+sec*1000;
  timerHandle=setInterval(()=>{
    const t=Math.max(0,Math.floor((end-Date.now())/1000));
    els.leftSec.textContent=`${pad(Math.floor(t/60))}:${pad(t%60)}`;
    if(t<=0){ stopTimer(); updateDoc(roomRef(roomId), { accept:false }); setTimeout(()=>step(+1),400); }
  }, 250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } els.leftSec.textContent="00:00"; }

/* ---------- 학생 ---------- */
function showStudentWaiting(){
  if(els.joinModal) els.joinModal.classList.remove('hide');
  if(els.sWrap) els.sWrap.classList.add('hide');
  if(els.sDone) els.sDone.classList.add('hide');
}
async function join(){
  if(!roomId) return alert('세션 코드가 없습니다.');
  const name=(els.joinName?.value||'').trim(); if(!name) return alert('이름을 입력하세요.');
  me = { id: localStorage.getItem('quiz.device') || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem('quiz.device', me.id);
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{}, alive:true }, { merge:true });
  els.joinModal.classList.add('hide'); els.sWrap.classList.remove('hide');
  els.sState.textContent = '참가 완료! 제출 버튼을 눌러주세요.';
  saveLocal();
}
async function submit(value){
  const r=window.__room; if(!r?.accept) return alert('지금은 제출할 수 없습니다.');
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
  const ref=doc(respCol(roomId), me.id); const snap=await getDoc(ref);
  const prev = snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert('이미 제출했습니다.');
  let correct=null;
  if(q.type==='mcq' && typeof value==='number') correct=(value===(q.answerIndex??-999));
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase();
    if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true) } }, { merge:true });
}

/* ---------- 렌더 ---------- */
function renderRoom(r){
  // 옵션 반영
  if(els.chkAccept) els.chkAccept.checked=!!r.accept;
  if(els.chkReveal) els.chkReveal.checked=!!r.reveal;
  if(els.chkBright) els.chkBright.checked=!!r.bright;
  if(els.timerSec) els.timerSec.value=r.timer||30;
  if(els.quizTitle) els.quizTitle.value=r.title||'퀴즈';

  // 프레젠테이션
  const idx=r.currentIndex, total=r.questions?.length||0;
  if(els.nowQuestion) els.nowQuestion.textContent = (idx>=0 && r.mode==='active') ? `Q${idx+1}/${total}` : 'Q0/0';
  if(els.pTitle) els.pTitle.textContent = r.title||roomId;

  if(r.mode!=='active' || idx==null || idx<0){
    if(els.pQ) els.pQ.textContent='시작 버튼을 누르면 문항이 제시됩니다.';
    if(els.pImg){ els.pImg.src=''; els.pImg.classList.add('hide'); }
    if(els.pOpts) els.pOpts.innerHTML='';
  }else{
    const q=r.questions[idx];
    if(els.pQ) els.pQ.textContent=q.text||'-';
    if(els.pImg){
      if(q.image){ els.pImg.src=q.image; els.pImg.classList.remove('hide'); }
      else { els.pImg.src=''; els.pImg.classList.add('hide'); }
    }
    if(els.pOpts){
      els.pOpts.innerHTML='';
      if(q.type==='mcq'){
        q.options.forEach((t,i)=>{ const d=document.createElement('div'); d.className='popt'; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d); });
      }else{
        const d=document.createElement('div'); d.className='popt'; d.textContent='주관식 문제입니다.'; els.pOpts.appendChild(d);
      }
    }
  }

  // 학생 쪽
  if(MODE==='student'){
    if(r.mode==='ended'){ els.sWrap.classList.add('hide'); els.sDone.classList.remove('hide'); return; }
    if(r.mode!=='active' || idx<0){ showStudentWaiting(); return; }

    const q=r.questions[idx];
    els.joinModal.classList.add('hide'); els.sWrap.classList.remove('hide');
    els.sQTitle.textContent=q.text||'-';
    if(q.image){ els.sQImg.src=q.image; els.sQImg.classList.remove('hide'); } else { els.sQImg.src=''; els.sQImg.classList.add('hide'); }
    els.sOptBox.innerHTML='';
    if(q.type==='mcq'){
      q.options.forEach((opt,i)=>{
        const b=document.createElement('button'); b.className='btn popt'; b.textContent=`${i+1}. ${opt}`; b.disabled=!r.accept;
        b.onclick=()=>submit(i); els.sOptBox.appendChild(b);
      });
      els.sShortWrap.classList.add('hide');
    }else{
      els.sShortWrap.classList.remove('hide'); els.btnShortSend.disabled=!r.accept;
    }
  }
}
function renderResponses(list){
  const r=window.__room||{}; const idx=r.currentIndex;
  let joined=list.length, submitted=0, correct=0, wrong=0;
  list.forEach(s=>{
    const a=s.answers?.[idx];
    if(a){ submitted++; if(a.correct===true) correct++; if(a.correct===false) wrong++; }
  });
  if(els.chipJoin) els.chipJoin.textContent=joined;
  if(els.chipSubmit) els.chipSubmit.textContent=submitted;
  if(els.chipCorrect) els.chipCorrect.textContent=correct;
  if(els.chipWrong) els.chipWrong.textContent=wrong;

  // 결과표
  if(!els.resultsTable) return;
  const tbl=document.createElement('table');
  const thead=document.createElement('thead'), tr=document.createElement('tr');
  const qs=(r.questions||[]);
  ["이름", ...qs.map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{ const th=document.createElement('th'); th.textContent=h; tr.appendChild(th); });
  thead.appendChild(tr); tbl.appendChild(thead);
  const tb=document.createElement('tbody');
  list.forEach(s=>{
    let score=0; const tr=document.createElement('tr');
    const tdn=document.createElement('td'); tdn.textContent=s.name||s.id; tr.appendChild(tdn);
    qs.forEach((q,i)=>{
      const a=s.answers?.[i]; const td=document.createElement('td');
      td.textContent = a? (q.type==='mcq'? (typeof a.value==='number'? a.value+1 : '-') : (a.value??'-')) : '-';
      if(a?.correct) score++; tr.appendChild(td);
    });
    const tds=document.createElement('td'); tds.textContent=String(score); tr.appendChild(tds);
    tb.appendChild(tr);
  });
  tbl.appendChild(tb); els.resultsTable.innerHTML=''; els.resultsTable.appendChild(tbl);
}

/* ---------- 링크/QR ---------- */
function copyLink(){ if(!els.studentLink?.value) return; navigator.clipboard.writeText(els.studentLink.value); }
function openStudent(){ if(!els.studentLink?.value) return; window.open(els.studentLink.value,'_blank','noopener'); }

/* ---------- 이벤트 바인딩 ---------- */
function bindAdmin(){
  els.tabBuild?.addEventListener('click', ()=>showTab('build'));
  els.tabOptions?.addEventListener('click', ()=>showTab('options'));
  els.tabPresent?.addEventListener('click', ()=>showTab('present'));
  els.tabResults?.addEventListener('click', ()=>showTab('results'));

  els.btnConnect?.addEventListener('click', connect);
  els.btnSignOut?.addEventListener('click', signOut);

  els.btnBuildForm?.addEventListener('click', rebuildEmpty);
  els.btnLoadSample?.addEventListener('click', loadSample);
  els.btnSaveQuiz?.addEventListener('click', saveQuiz);

  els.btnUploadTxt?.addEventListener('click', ()=>els.fileUploadTxt?.click());
  els.btnDownloadTemplate?.addEventListener('click', ()=>{
    const csv="문항,보기1,보기2,보기3,보기4,정답번호\n가장 큰 행성은?,지구,목성,화성,금성,2\n";
    const a=document.createElement('a'); a.href='data:text/plain;charset=utf-8,'+encodeURIComponent(csv); a.download='quiz_sample.csv'; a.click();
  });

  els.btnOptSave?.addEventListener('click', saveOptions);
  els.btnResetAll?.addEventListener('click', resetAll);
  els.btnCopyLink?.addEventListener('click', copyLink);
  els.btnOpenStudent?.addEventListener('click', openStudent);

  els.btnStart?.addEventListener('click', ()=>startQuiz());
  els.btnPrev ?.addEventListener('click', ()=>step(-1));
  els.btnNext ?.addEventListener('click', ()=>step(+1));
  els.btnEndAll?.addEventListener('click', ()=>endAll());
}
function bindStudent(){
  els.btnJoinGo   ?.addEventListener('click', join);
  els.btnShortSend?.addEventListener('click', ()=>submit(els.sShortInput.value));
  els.btnShowMy   ?.addEventListener('click', ()=>{
    const r=window.__room||{}, meId=localStorage.getItem('quiz.device');
    const mine=(window.__resp||[]).find(s=>s.id===meId);
    if(!mine){ els.myResult.textContent='제출 내역이 없습니다.'; return; }
    let score=0;
    const lines=(r.questions||[]).map((q,i)=>{
      const a=mine.answers?.[i];
      if(a?.correct) score++;
      return `Q${i+1}: ${a? (q.type==='mcq'?(a.value+1):a.value) : '-'}`;
    });
    els.myResult.textContent=`점수: ${score} / ${r.questions?.length||0}\n`+lines.join('\n');
  });
}

/* ---------- init ---------- */
function init(){
  // 첫 진입 모드 결정: URL role 파라미터, 없으면 관리자
  const p=new URLSearchParams(location.search); const role=p.get('role');
  setMode(role==='student' ? 'student' : 'admin');

  if(MODE==='admin') bindAdmin(); else bindStudent();
  autoReconnect();

  // 처음엔 문항 탭
  if(MODE==='admin') showTab('build');
}

document.addEventListener('DOMContentLoaded', init);
})();
