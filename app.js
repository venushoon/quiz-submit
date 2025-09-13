(()=>{ 'use strict';
/* ---------- 안전한 헬퍼(전역 충돌 방지) ---------- */
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));

/* ---------- Firebase 준비 확인 ---------- */
function ensureFirebase(){
  if(!window.db || !window.FS){
    throw new Error('[firebase] not loaded. Ensure compat scripts + init block are included before app.js');
  }
}
ensureFirebase();
const { doc, collection, setDoc, getDoc, onSnapshot, updateDoc, runTransaction, serverTimestamp } = window.FS;

/* ---------- 엘리먼트 ---------- */
const els = {
  // 헤더/탭
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnSignOut: $("#btnSignOut"), roomStatus: $("#roomStatus"),
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  // 패널
  pBuild: $("#panelBuild"), pOptions: $("#panelOptions"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),
  // 옵션/접속
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),
  btnOptSave: $("#btnOptSave"), chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright: $("#chkBright"),
  // 빌더
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"), btnBuildForm: $("#btnBuildForm"),
  btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"), builder: $("#builder"),
  btnUploadTxt: $("#btnUploadTxt"), fileUploadTxt: $("#fileUploadTxt"), btnDownloadTemplate: $("#btnDownloadTemplate"),
  // 프레젠테이션
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  leftSec: $("#leftSec"), nowQuestion: $("#nowQuestion"), pTitle: $("#pTitle"), pQ: $("#pQ"), pImg: $("#pImg"), pOpts: $("#pOpts"),
  chipJoin: $("#chipJoin"), chipSubmit: $("#chipSubmit"), chipCorrect: $("#chipCorrect"), chipWrong: $("#chipWrong"),
  // 결과
  resultsTable: $("#resultsTable"),
  // 학생
  studentAccess: $("#studentAccess"), joinModal: $("#joinModal"), joinName: $("#joinName"), btnJoinGo: $("#btnJoinGo"),
  sWrap: $("#sWrap"), sState: $("#sState"), sQTitle: $("#sQTitle"), sQImg: $("#sQImg"),
  sOptBox: $("#sOptBox"), sShortWrap: $("#sShortWrap"), sShortInput: $("#sShortInput"), btnShortSend: $("#btnShortSend"),
  sDone: $("#sDone"), btnShowMy: $("#btnShowMy"), myResult: $("#myResult")
};

/* ---------- 상태 ---------- */
let MODE = 'admin';  // admin|student
let roomId = '';
let me = { id:null, name:'' };
let unsubRoom=null, unsubResp=null, timerHandle=null;

/* ---------- 유틸 ---------- */
const pad = n=>String(n).padStart(2,'0');
const roomRef = id => doc("rooms", id);
const respCol = id => collection(window.db, `rooms/${id}/responses`);
function saveLocal(){ localStorage.setItem('quiz.live', JSON.stringify({roomId,MODE,me})); }
function loadLocal(){
  try{ const d=JSON.parse(localStorage.getItem('quiz.live')||'{}');
       roomId=d.roomId||''; MODE=d.MODE||MODE; me=d.me||me; if(roomId) els.roomId.value=roomId;
  }catch{}
}

/* ---------- 모드/탭 ---------- */
function showTab(name){
  const map={build:els.pBuild, options:els.pOptions, present:els.pPresent, results:els.pResults};
  Object.values(map).forEach(p=>p?.classList.add('hide'));
  map[name]?.classList.remove('hide');

  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(t=>t?.classList.remove('active'));
  ({build:els.tabBuild,options:els.tabOptions,present:els.tabPresent,results:els.tabResults}[name])?.classList.add('active');
}
function setMode(m){
  MODE=m;
  // 관리자 전용 UI
  $$('.admin-only').forEach(n=>n.classList.toggle('hide', m!=='admin'));
  // 학생 루트
  els.studentAccess?.classList.toggle('hide', m!=='student');
  if(m==='admin') showTab('build');
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
    window.__resp=arr; renderResponses(arr);
  });
}

/* ---------- 접속 ---------- */
async function ensureRoom(id){
  const s=await getDoc(roomRef(id));
  if(!s.exists()){
    await setDoc(roomRef(id), {
      title:'새 세션', mode:'idle', currentIndex:-1, accept:false, reveal:false,
      timer:30, bright:false, createdAt:serverTimestamp(), questions:[]
    });
  }
}
async function connect(){
  ensureFirebase();
  const id=(els.roomId.value||'').trim();
  if(!id) return alert('세션 코드를 입력하세요.');
  roomId=id; await ensureRoom(roomId);
  listenRoom(roomId); listenResponses(roomId);
  els.roomStatus.textContent=`세션: ${roomId} · 온라인`;
  els.btnConnect.disabled=true; els.roomId.disabled=true; els.btnSignOut?.classList.remove('hide');
  buildStudentLink(); saveLocal();
}
function signOut(){
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  roomId=''; els.roomId.disabled=false; els.roomId.value='';
  els.btnConnect.disabled=false; els.btnSignOut?.classList.add('hide');
  els.roomStatus.textContent='세션: - · 오프라인'; showTab('build'); saveLocal();
}
function autoReconnect(){
  const params=new URL(location.href).searchParams;
  const qRole=params.get('role');
  if(qRole==='student'){ MODE='student'; roomId=params.get('room')||''; if(roomId) els.roomId.value=roomId; }
  else { MODE='admin'; }
  setMode(MODE); loadLocal();
  if(MODE==='admin' && roomId) connect();
}

/* ---------- 빌더 ---------- */
function qCard(no,q){
  const wrap=document.createElement('div'); wrap.className='qcard';
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${(q?.type==='short')?'':'checked'}> 객관식</label>
      <label class="switch"><input type="radio" name="type-${no}" value="short" ${(q?.type==='short')?'checked':''}> 주관식</label>
    </div>
    <div class="row wrap mt">
      <input class="input grow qtext" placeholder="문항 내용" value="${q?.text||''}">
      <input class="input sm qimg" type="file" accept="image/*">
    </div>
    <div class="mcq ${(q?.type==='short')?'hide':''} mt">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="input grow opt" data-idx="${i}" placeholder="보기 ${i+1}" value="${v}">`).join('')}
      </div>
      <div class="row mt">
        <span class="muted">정답 번호</span>
        <input class="input sm ansIndex" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
      </div>
    </div>
    <div class="short ${(q?.type==='short')?'':'hide'} mt">
      <input class="input grow ansText" placeholder="정답(선택)" value="${q?.answerText||''}">
    </div>`;
  const radios=$$(`input[name="type-${no}"]`,wrap), mcq=$('.mcq',wrap), short=$('.short',wrap);
  radios.forEach(r=>r.addEventListener('change',()=>{
    const isShort=radios.find(x=>x.checked).value==='short';
    mcq.classList.toggle('hide', isShort); short.classList.toggle('hide', !isShort);
  }));
  return wrap;
}
function gatherBuilder(){
  const cards=$$('#builder>.qcard');
  return {
    title: els.quizTitle.value||'퀴즈',
    questions: cards.map(c=>{
      const type=c.querySelector('input[type=radio]:checked').value;
      const text=c.querySelector('.qtext').value.trim();
      const imgF=c.querySelector('.qimg').files?.[0]||null;
      if(!text) return null;
      const payload={ type, text };
      if(imgF) payload.image=URL.createObjectURL(imgF);
      if(type==='mcq'){
        const opts=$$('.opt',c).map(i=>i.value.trim());
        const ans=Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector('.ansIndex').value,10)||1)-1));
        payload.options=opts; payload.answerIndex=ans;
      }else{
        payload.answerText=c.querySelector('.ansText').value.trim();
      }
      return payload;
    }).filter(Boolean)
  };
}
els.btnBuildForm?.addEventListener('click', ()=>{
  const n=Math.max(1,Math.min(50,parseInt(els.questionCount.value,10)||3));
  els.builder.innerHTML=''; for(let i=0;i<n;i++) els.builder.appendChild(qCard(i+1));
});
els.btnLoadSample?.addEventListener('click', ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
    {type:'mcq', text:'태양계 별명?', options:['Milky','Solar','Sunset','Lunar'], answerIndex:1},
  ];
  els.builder.innerHTML=''; S.forEach((q,i)=>els.builder.appendChild(qCard(i+1,q)));
  els.quizTitle.value='샘플 퀴즈'; els.questionCount.value=String(S.length);
});
els.btnSaveQuiz?.addEventListener('click', async ()=>{
  if(!roomId) return alert('세션 접속 후 저장하세요.');
  const payload=gatherBuilder();
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert('저장 완료!');
});

/* ---------- 옵션/링크 & QR ---------- */
function buildStudentLink(){
  if(!roomId) return;
  const url=new URL(location.href);
  url.searchParams.set('role','student');
  url.searchParams.set('room',roomId);
  els.studentLink && (els.studentLink.value=url.toString());
  if(window.QRCode && els.qrCanvas){
    try{ window.QRCode.toCanvas(els.qrCanvas, url.toString(), { width:140 }); }catch(e){}
  }
}
els.btnCopyLink?.addEventListener('click', ()=>{ els.studentLink?.select(); document.execCommand('copy'); });
els.btnOpenStudent?.addEventListener('click', ()=>{ if(els.studentLink?.value) window.open(els.studentLink.value,'_blank'); });

/* ---------- 진행/타이머 ---------- */
async function startQuiz(){ await updateDoc(roomRef(roomId), { mode:'active', currentIndex:0, accept:true }); }
async function step(delta){
  await runTransaction(window.db, async (tx)=>{
    const snap=await tx.get(roomRef(roomId));
    const r=snap.data(); const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){ tx.update(roomRef(roomId), { mode:'ended', accept:false }); return; }
    next=Math.max(0,next); tx.update(roomRef(roomId), { currentIndex:next, accept:true });
  });
}
async function finishAll(){ await updateDoc(roomRef(roomId), { mode:'ended', accept:false }); }
function startTimer(sec){
  stopTimer(); const end=Date.now()+sec*1000;
  timerHandle=setInterval(()=>{
    const remain=Math.max(0,Math.floor((end-Date.now())/1000));
    els.leftSec && (els.leftSec.textContent=`${pad(Math.floor(remain/60))}:${pad(remain%60)}`);
    if(remain<=0){ stopTimer(); updateDoc(roomRef(roomId),{accept:false}); setTimeout(()=>step(+1),300); }
  },250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } els.leftSec && (els.leftSec.textContent='00:00'); }
els.btnStart?.addEventListener('click', startQuiz);
els.btnPrev?.addEventListener('click', ()=>step(-1));
els.btnNext?.addEventListener('click', ()=>step(+1));
els.btnEndAll?.addEventListener('click', finishAll);

/* ---------- 제출/채점 ---------- */
async function join(){
  if(!roomId) return alert('세션에 먼저 접속하세요.');
  const name=(els.joinName.value||'').trim(); if(!name) return alert('이름을 입력하세요.');
  me = { id: localStorage.getItem('quiz.device') || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem('quiz.device', me.id);
  await setDoc(doc('rooms',roomId,'responses',me.id), { name, joinedAt:serverTimestamp(), answers:{}, alive:true }, { merge:true });
  els.joinModal?.classList.add('hide'); els.sWrap?.classList.remove('hide');
  els.sState && (els.sState.textContent='참가 완료! 제출 버튼을 눌러주세요.');
  saveLocal();
}
async function submit(value){
  const r=window.__room; if(!r?.accept) return alert('지금은 제출할 수 없습니다.');
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
  const ref=doc('rooms',roomId,'responses',me.id);
  const snap=await getDoc(ref); const prev=snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert('이미 제출했습니다.');
  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true) } }, { merge:true });
}
els.btnJoinGo?.addEventListener('click', join);
els.btnShortSend?.addEventListener('click', ()=> submit(els.sShortInput.value||'') );

/* ---------- 렌더링 ---------- */
function renderRoom(r){
  // 프레젠테이션: 기본 대기문구
  els.pTitle && (els.pTitle.textContent=r.title||roomId||'퀴즈');
  els.nowQuestion && (els.nowQuestion.textContent = (r.currentIndex>=0 && r.mode==='active')
    ? `Q${r.currentIndex+1}/${r.questions?.length||0}` : '-');
  if(!els.pQ) return;

  // 이미지 기본 숨김
  if(els.pImg){ els.pImg.src=''; els.pImg.classList.add('hide'); }

  if(r.mode!=='active' || (r.currentIndex??-1)<0){
    els.pQ.textContent='시작 버튼을 누르면 문항이 제시됩니다.'; // ✅ 요구사항
    els.pOpts.innerHTML='';
  }else{
    const q=r.questions?.[r.currentIndex]; if(!q){ els.pQ.textContent=''; els.pOpts.innerHTML=''; return; }
    els.pQ.textContent=q.text||'';
    if(q.image && els.pImg){ els.pImg.src=q.image; els.pImg.classList.remove('hide'); }
    els.pOpts.innerHTML='';
    if(q.type==='mcq'){
      q.options.forEach((t,i)=>{ const d=document.createElement('div'); d.className='popt'; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d); });
    }else{
      const d=document.createElement('div'); d.className='popt'; d.textContent='주관식 문제입니다.'; els.pOpts.appendChild(d);
    }
  }

  // 학생 화면
  if(MODE==='student'){
    if(r.mode==='ended'){ els.sWrap?.classList.add('hide'); els.sDone?.classList.remove('hide'); return; }
    if(r.mode!=='active' || (r.currentIndex??-1)<0){
      els.sWrap?.classList.add('hide'); els.joinModal?.classList.remove('hide');
      els.sState && (els.sState.textContent='참가 완료! 제출 버튼을 눌러주세요. 교사가 시작하면 1번 문항이 표시됩니다.');
      return;
    }
    const q=r.questions?.[r.currentIndex]; if(!q) return;
    els.joinModal?.classList.add('hide'); els.sWrap?.classList.remove('hide');
    els.sQTitle && (els.sQTitle.textContent=q.text||'');
    if(els.sQImg){ els.sQImg.src=''; els.sQImg.classList.add('hide'); if(q.image){ els.sQImg.src=q.image; els.sQImg.classList.remove('hide'); } }
    els.sOptBox && (els.sOptBox.innerHTML='');
    if(q.type==='mcq'){
      q.options.forEach((opt,i)=>{ const b=document.createElement('button'); b.className='btn popt'; b.textContent=`${i+1}. ${opt}`; b.disabled=!r.accept; b.onclick=()=>submit(i); els.sOptBox.appendChild(b); });
      els.sShortWrap?.classList.add('hide');
    }else{
      els.sShortWrap?.classList.remove('hide'); els.btnShortSend && (els.btnShortSend.disabled=!r.accept);
    }
  }
}
function renderResponses(list){
  const r=window.__room||{}; const idx=r.currentIndex;
  let joined=list.length, submitted=0, correct=0, wrong=0;
  list.forEach(s=>{ const a=s.answers?.[idx]; if(a){ submitted++; if(a.correct===true) correct++; if(a.correct===false) wrong++; }});
  if(els.chipJoin) els.chipJoin.textContent=joined;
  if(els.chipSubmit) els.chipSubmit.textContent=submitted;
  if(els.chipCorrect) els.chipCorrect.textContent=correct;
  if(els.chipWrong) els.chipWrong.textContent=wrong;

  // 결과표
  if(!els.resultsTable) return;
  const tbl=document.createElement('table');
  const thead=document.createElement('thead'), tr=document.createElement('tr');
  const qs=(r.questions||[]);
  ['이름', ...qs.map((_,i)=>`Q${i+1}`), '점수'].forEach(h=>{ const th=document.createElement('th'); th.textContent=h; tr.appendChild(th); });
  thead.appendChild(tr); tbl.appendChild(thead);
  const tb=document.createElement('tbody');
  list.forEach(s=>{
    let score=0; const tr=document.createElement('tr');
    const tdn=document.createElement('td'); tdn.textContent=s.name||s.id; tr.appendChild(tdn);
    qs.forEach((q,i)=>{ const a=s.answers?.[i]; const td=document.createElement('td');
      td.textContent = a? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value??'-')) : '-';
      if(a?.correct) score++; tr.appendChild(td);
    });
    const tds=document.createElement('td'); tds.textContent=String(score); tr.appendChild(tds);
    tb.appendChild(tr);
  });
  tbl.appendChild(tb); els.resultsTable.innerHTML=''; els.resultsTable.appendChild(tbl);
}

/* ---------- 이벤트 바인딩 ---------- */
els.btnConnect?.addEventListener('click', connect);
els.btnSignOut?.addEventListener('click', signOut);
[['tabBuild','build'],['tabOptions','options'],['tabPresent','present'],['tabResults','results']]
.forEach(([id,tab])=> els[id]?.addEventListener('click', ()=>showTab(tab)) );

/* ---------- 시작 ---------- */
document.addEventListener('DOMContentLoaded', autoReconnect);
})(); 
