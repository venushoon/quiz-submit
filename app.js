/* app.js — non-module (no import/await). Firestore db is on window.db */

/* ---------- tiny helpers ---------- */
const $  = (s, el=document)=>el.querySelector(s);
const $$ = (s, el=document)=>Array.from(el.querySelectorAll(s));
const pad = n=>String(n).padStart(2,'0');
const qs  = new URLSearchParams(location.search);
const isStudentURL = (qs.get('role')==='student');

/* ---------- Firestore refs ---------- */
const { doc, setDoc, getDoc, updateDoc, onSnapshot, collection, getDocs, runTransaction, serverTimestamp } =
  firebase.firestore ? {} : {}; // dummy when not loaded (guard)

/* 하지만 window.db는 index.html 모듈 스크립트에서 생성됨 */
let db;
document.addEventListener('readystatechange', () => { db = window.db; });

const roomRef = id => firebase.firestore ? doc(db, 'rooms', id) : null;
const respCol = id => firebase.firestore ? collection(db, 'rooms', id, 'responses') : null;

/* ---------- state ---------- */
let MODE   = isStudentURL ? 'student' : 'admin';
let roomId = '';
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;
let currentRoom=null;

/* ---------- cache ---------- */
function saveLocal(){ localStorage.setItem('quiz.live', JSON.stringify({ roomId, MODE, me })); }
function loadLocal(){
  try{
    const d=JSON.parse(localStorage.getItem('quiz.live')||'{}');
    roomId=d.roomId||''; MODE = isStudentURL ? 'student' : (d.MODE||'admin'); me=d.me||{id:null,name:''};
    if($('#roomId')) $('#roomId').value = roomId;
  }catch{}
}

/* ---------- UI wiring (elements may be absent on student) ---------- */
const els = {
  // header/admin
  roomId: $('#roomId'), btnConnect: $('#btnConnect'), btnSignOut: $('#btnSignOut'),
  roomStatus: $('#roomStatus'),
  tabBuild: $('#tabBuild'), tabOptions: $('#tabOptions'), tabPresent: $('#tabPresent'), tabResults: $('#tabResults'),
  pBuild: $('#panelBuild'), pOptions: $('#panelOptions'), pPresent: $('#panelPresent'), pResults: $('#panelResults'),
  // builder
  quizTitle: $('#quizTitle'), questionCount: $('#questionCount'), btnBuildForm: $('#btnBuildForm'),
  btnLoadSample: $('#btnLoadSample'), btnSaveQuiz: $('#btnSaveQuiz'), builder: $('#builder'),
  fileUploadTxt: $('#fileUploadTxt'), btnUploadTxt: $('#btnUploadTxt'), btnDownloadTemplate: $('#btnDownloadTemplate'),
  // options
  limitDevice: $('#limitDevice'), limitName: $('#limitName'), chkAccept: $('#chkAccept'), chkReveal: $('#chkReveal'),
  chkLight: $('#chkLight'), timerSec: $('#timerSec'), btnSaveOptions: $('#btnSaveOptions'), btnResetAll: $('#btnResetAll'),
  qrCanvas: $('#qrCanvas'), studentLink: $('#studentLink'), btnCopyLink: $('#btnCopyLink'), btnOpenStudent: $('#btnOpenStudent'),
  // present(admin)
  btnStart: $('#btnStart'), btnPrev: $('#btnPrev'), btnNext: $('#btnNext'), btnEndAll: $('#btnEndAll'),
  leftSec: $('#leftSec'), pTitle: $('#pTitle'), pQ: $('#pQ'), pOpts: $('#pOpts'), pImgWrap: $('#pImgWrap'), pImg: $('#pImg'),
  cSubmit: $('#cSubmit'), cCorrect: $('#cCorrect'), cWrong: $('#cWrong'), cWait: $('#cWait'),
  // results
  btnExportCSV: $('#btnExportCSV'), resultsTable: $('#resultsTable'),
  // student
  studentAccess: $('#studentAccess'), joinModal: $('#joinModal'), joinName: $('#joinName'), btnJoinGo: $('#btnJoinGo'),
  sRoom: $('#sRoom'), sState: $('#sState'), sQTitle: $('#sQTitle'),
  sImgWrap: $('#sImgWrap'), sQImg: $('#sQImg'), sOptBox: $('#sOptBox'),
  sShortWrap: $('#sShortWrap'), shortInput: $('#shortInput'), btnShortSend: $('#btnShortSend'),
  btnSubmit: $('#btnSubmit'), sTimer: $('#sTimer'), sEndWrap: $('#sEndWrap'), btnSeeMyResult: $('#btnSeeMyResult'),
  studentResult: $('#studentResult'), myResultBox: $('#myResultBox'),
};

/* safe guard: student 페이지에서 admin 요소가 없어도 에러 없이 진행 */
function safe(el, fn){ if(el) fn(); }

/* ---------- mode / tabs ---------- */
function setMode(m){
  MODE=m;
  // 관리자 전용 숨김
  $$('.admin-only').forEach(n=> n.classList.toggle('hide', MODE!=='admin'));
  // 학생 패널 표시
  if(els.studentAccess) els.studentAccess.classList.toggle('hide', MODE!=='student');
  // 기본 탭: 관리자면 문항, 학생이면 studentAccess
  if(MODE==='admin'){
    showTab('build');
  }else{
    // 학생: 참여 모달 즉시 노출 (이름 입력 → 참가 → 대기)
    if(els.joinModal && typeof els.joinModal.showModal==='function'){
      els.joinModal.showModal();
      if(els.joinName) els.joinName.focus();
    }
  }
}
function showTab(name){
  const tabMap = {build:els.pBuild, options:els.pOptions, present:els.pPresent, results:els.pResults};
  Object.entries(tabMap).forEach(([k,sec])=>{
    if(!sec) return;
    sec.classList.toggle('hide', k!==name);
  });
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b&&b.classList.remove('active'));
  const btn = {build:els.tabBuild, options:els.tabOptions, present:els.tabPresent, results:els.tabResults}[name];
  if(btn) btn.classList.add('active');
}

/* ---------- room connect ---------- */
async function ensureRoom(id){
  const ref = roomRef(id); if(!ref) return;
  const snap = await getDoc(ref);
  if(!snap.exists()){
    await setDoc(ref, { title:'새 세션', mode:'idle', currentIndex:-1, accept:false, reveal:false, createdAt:serverTimestamp(), questions:[] });
  }
}
async function connect(){
  const id = (els.roomId?.value||'').trim();
  if(!id) return alert('세션 코드를 입력하세요.');
  roomId=id; await ensureRoom(id);
  listenRoom(id); listenResponses(id);
  // UI 잠금
  if(els.roomId){ els.roomId.disabled = true; }
  if(els.btnConnect){ els.btnConnect.classList.add('hide'); }
  if(els.btnSignOut){ els.btnSignOut.classList.remove('hide'); }
  if(els.roomStatus) els.roomStatus.textContent = `세션: ${roomId} · 온라인`;
  buildStudentLink(); // 옵션 탭의 QR/링크
  saveLocal();
}
function signOut(){
  // 언바인드
  if(unsubRoom) unsubRoom(); unsubRoom=null;
  if(unsubResp) unsubResp(); unsubResp=null;
  // UI 해제
  if(els.roomId){ els.roomId.disabled = false; }
  if(els.btnConnect){ els.btnConnect.classList.remove('hide'); }
  if(els.btnSignOut){ els.btnSignOut.classList.add('hide'); }
  if(els.roomStatus) els.roomStatus.textContent = `세션: - · 오프라인`;
  roomId = '';
  saveLocal();
}

/* ---------- listen ---------- */
function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom = onSnapshot(roomRef(id), snap=>{
    if(!snap.exists()) return;
    currentRoom = snap.data();
    renderRoom(currentRoom);
  });
}
function listenResponses(id){
  if(unsubResp) unsubResp();
  unsubResp = onSnapshot(respCol(id), q=>{
    const arr=[]; q.forEach(d=>arr.push({id:d.id, ...d.data()}));
    renderResponses(arr);
  });
}

/* ---------- builder ---------- */
function cardRow(no,q){
  const wrap=document.createElement('div');
  wrap.className='qcard';
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="row gap"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'}> 객관식</label>
      <label class="row gap"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''}> 주관식</label>
      <label class="row gap right"><input type="file" accept="image/*" class="img-${no}"> 이미지</label>
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항 내용" value="${q?.text||''}">
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기 ${i+1}" value="${v}">`).join('')}
      </div>
      <div class="row"><span class="badge">정답 번호</span>
        <input class="ansIndex input sm" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
      </div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <input class="ansText input" data-no="${no}" placeholder="정답(선택)" value="${q?.answerText||''}">
    </div>
  `;
  // type 토글
  const radios = $$(`input[name="type-${no}"]`, wrap);
  const mcq=$('.mcq',wrap), short=$('.short',wrap);
  radios.forEach(r=>r.addEventListener('change',()=>{
    const isShort = radios.find(x=>x.checked)?.value==='short';
    mcq.classList.toggle('hide', isShort);
    short.classList.toggle('hide', !isShort);
  }));
  // 이미지 파일 → dataURL 보관
  const imgInput = $(`.img-${no}`, wrap);
  imgInput.addEventListener('change', async e=>{
    const f=e.target.files?.[0]; if(!f) return;
    const b64=await fToDataURL(f);
    wrap.dataset.img=b64; // 저장 시 읽음
  });
  return wrap;
}
function fToDataURL(file){ return new Promise(r=>{ const fr=new FileReader(); fr.onload=()=>r(fr.result); fr.readAsDataURL(file); }); }
function collectBuilder(){
  const cards=$$('#builder>.qcard');
  const list=cards.map((c,idx)=>{
    const no=idx+1;
    const type=c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text=c.querySelector('.qtext').value.trim();
    const image=c.dataset.img||'';
    if(!text) return null;
    if(type==='mcq'){
      const opts=$$('.opt',c).map(i=>i.value.trim()).filter(Boolean);
      const ans = Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector('.ansIndex').value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans, image };
    } else {
      return { type:'short', text, answerText:c.querySelector('.ansText').value.trim(), image };
    }
  }).filter(Boolean);
  return { title: els.quizTitle?.value||'퀴즈', questions:list };
}

/* ---------- options / link & QR ---------- */
function buildStudentLink(){
  if(!roomId || !els.studentLink) return;
  const url = new URL(location.href);
  url.searchParams.set('role','student');
  url.searchParams.set('room', roomId);
  els.studentLink.value = url.toString();
  // QR
  if(window.QRCode && els.qrCanvas){
    QRCode.toCanvas(els.qrCanvas, els.studentLink.value, {width:120}, ()=>{});
  }
}

/* ---------- timer ---------- */
function startTimer(sec){
  stopTimer();
  const end = Date.now()+sec*1000;
  timerHandle=setInterval(()=>{
    const remain=Math.max(0,Math.floor((end-Date.now())/1000));
    const mm=pad(Math.floor(remain/60)), ss=pad(remain%60);
    if(els.leftSec) els.leftSec.textContent = `${mm}:${ss}`;
    if(els.sTimer)  els.sTimer.textContent  = `${mm}:${ss}`;
    if(remain<=0){ stopTimer(); updateDoc(roomRef(roomId), { accept:false }).catch(()=>{}); step(+1); }
  },250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } if(els.leftSec) els.leftSec.textContent='00:00'; if(els.sTimer) els.sTimer.textContent='00:00'; }

/* ---------- present flow ---------- */
async function startQuiz(){ await updateDoc(roomRef(roomId), { mode:'active', currentIndex:0, accept:true }); }
async function step(delta){
  await runTransaction(db, async tx=>{
    const snap=await tx.get(roomRef(roomId)); const r=snap.data(); const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){ tx.update(roomRef(roomId), { currentIndex: total-1, mode:'ended', accept:false }); return; }
    next=Math.max(0,next);
    tx.update(roomRef(roomId), { currentIndex: next, accept:true });
  });
}
async function finishAll(){
  if(!confirm('퀴즈를 종료할까요?')) return;
  await updateDoc(roomRef(roomId), { mode:'ended', accept:false });
}

/* ---------- submit / grade ---------- */
async function join(){
  if(!roomId) return alert('세션에 먼저 접속하세요.');
  const name=(els.joinName?.value||'').trim(); if(!name) return alert('이름을 입력하세요.');
  me = { id: localStorage.getItem('quiz.device') || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem('quiz.device', me.id);
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{}, alive:true }, { merge:true });
  if(els.joinModal?.close) els.joinModal.close();
  if(els.sState) els.sState.textContent='대기';
  saveLocal();
}
async function submit(value){
  const r=currentRoom; if(!r?.accept) return alert('지금은 제출할 수 없습니다.');
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
  const ref=doc(respCol(roomId), me.id);
  const snap=await getDoc(ref); const prev=snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert('이미 제출했습니다.');
  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true), revealed:r.reveal||false } }, { merge:true });
  alert('제출되었습니다.');
}

/* ---------- render ---------- */
function renderRoom(r){
  // 공통
  if(els.roomStatus && roomId) els.roomStatus.textContent=`세션: ${roomId} · 온라인`;
  // 프레젠테이션
  if(MODE==='admin' && els.pQ){
    const idx=r.currentIndex, total=r.questions?.length||0;
    els.pTitle.textContent = r.title||roomId;
    els.pOpts.innerHTML='';
    if(r.mode!=='active' || idx<0){ els.pQ.textContent='시작 버튼을 누르면 문항이 제시됩니다.'; els.pImgWrap?.classList.add('hide'); }
    else{
      const q=r.questions[idx];
      els.pQ.textContent=q.text;
      if(q.image){ els.pImg.src=q.image; els.pImgWrap.classList.remove('hide'); } else { els.pImgWrap.classList.add('hide'); }
      if(q.type==='mcq'){ q.options.forEach((t,i)=>{ const d=document.createElement('div'); d.className='popt'; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d); }); }
      else { const d=document.createElement('div'); d.className='muted'; d.textContent='주관식 문제'; els.pOpts.appendChild(d); }
    }
  }
  // 학생
  if(MODE==='student'){
    if(els.sRoom) els.sRoom.textContent = roomId||'-';
    if(r.mode!=='active' || (r.currentIndex??-1)<0){
      if(els.sQTitle) els.sQTitle.textContent='참가 완료! 제출 버튼을 눌러주세요. 교사가 시작하면 1번 문항이 표시됩니다.';
      els.sOptBox && (els.sOptBox.innerHTML='');
      els.sShortWrap?.classList.add('hide'); els.btnSubmit?.classList.add('hide');
      return;
    }
    const q=r.questions[r.currentIndex];
    els.sQTitle.textContent = q.text;
    if(q.image){ els.sQImg.src=q.image; els.sImgWrap.classList.remove('hide'); } else { els.sImgWrap.classList.add('hide'); }
    if(q.type==='mcq'){
      els.sOptBox.classList.remove('hide');
      els.sOptBox.innerHTML='';
      q.options.forEach((opt,i)=>{
        const b=document.createElement('button'); b.className='optbtn'; b.textContent=`${i+1}. ${opt}`;
        b.addEventListener('click',()=>{ els.btnSubmit.dataset.choice=i; });
        els.sOptBox.appendChild(b);
      });
      els.sShortWrap.classList.add('hide');
      els.btnSubmit.classList.remove('hide');
      els.btnSubmit.onclick=()=> submit(parseInt(els.btnSubmit.dataset.choice,10));
    }else{
      els.sOptBox.classList.add('hide');
      els.sShortWrap.classList.remove('hide');
      els.btnSubmit.classList.add('hide');
      els.btnShortSend.onclick=()=> submit((els.shortInput?.value||'').trim());
    }
    // 제출 허용 여부
    const can=r.accept===true;
    $$('.optbtn',els.sOptBox).forEach(b=>b.disabled=!can);
    if(els.btnShortSend) els.btnShortSend.disabled=!can;
    if(els.btnSubmit)    els.btnSubmit.disabled=!can;
  }
}

/* 결과/칩 등 */
function renderResponses(list){
  if(MODE!=='admin') return;
  const r=currentRoom||{}; const idx=r.currentIndex; const q=r.questions?.[idx];

  // 통계
  let submit=0, ok=0, no=0;
  list.forEach(s=>{ const a=s.answers?.[idx]; if(a){ submit++; if(a.correct) ok++; else no++; }});
  if(els.cSubmit) els.cSubmit.textContent=submit;
  if(els.cCorrect) els.cCorrect.textContent=ok;
  if(els.cWrong) els.cWrong.textContent=no;
  if(els.cWait) els.cWait.textContent=Math.max(0, list.length - submit);

  // 결과표
  if(els.resultsTable){
    const tbl=document.createElement('table');
    const thead=document.createElement('thead'), tr=document.createElement('tr');
    ['이름', ...(r.questions||[]).map((_,i)=>`Q${i+1}`), '점수'].forEach(h=>{ const th=document.createElement('th'); th.textContent=h; tr.appendChild(th); });
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb=document.createElement('tbody');
    list.forEach(s=>{
      let score=0; const tr=document.createElement('tr');
      const tdn=document.createElement('td'); tdn.textContent=s.name||s.id; tr.appendChild(tdn);
      (r.questions||[]).forEach((q,i)=>{
        const a=s.answers?.[i]; const td=document.createElement('td');
        td.textContent = a? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value??'-')) : '-';
        if(a?.correct) score++; tr.appendChild(td);
      });
      const tds=document.createElement('td'); tds.textContent=String(score); tr.appendChild(tds);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.resultsTable.innerHTML=''; els.resultsTable.appendChild(tbl);
  }
}

/* ---------- events ---------- */
// admin mode events only when element exists
safe(els.btnConnect, ()=> els.btnConnect.addEventListener('click', connect));
safe(els.btnSignOut, ()=> els.btnSignOut.addEventListener('click', signOut));
[ ['tabBuild','build'],['tabOptions','options'],['tabPresent','present'],['tabResults','results'] ].forEach(([id,name])=>{
  const b = els[id]; if(b) b.addEventListener('click', ()=> showTab(name));
});

safe(els.btnBuildForm, ()=> els.btnBuildForm.addEventListener('click', ()=>{
  const n=Math.max(1,Math.min(20, parseInt(els.questionCount?.value,10)||3));
  if(els.builder){ els.builder.innerHTML=''; for(let i=0;i<n;i++) els.builder.appendChild(cardRow(i+1)); }
}));
safe(els.btnLoadSample, ()=> els.btnLoadSample.addEventListener('click', ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
    {type:'mcq', text:'태양계 별명?', options:['Milky','Solar','Sunset','Lunar'], answerIndex:1},
  ];
  if(els.builder){ els.builder.innerHTML=''; S.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q))); }
  if(els.quizTitle) els.quizTitle.value='샘플 퀴즈';
  if(els.questionCount) els.questionCount.value=S.length;
}));
safe(els.btnSaveQuiz, ()=> els.btnSaveQuiz.addEventListener('click', async ()=>{
  if(!roomId) return alert('세션에 먼저 접속하세요.');
  const payload=collectBuilder(); if(!payload.questions.length) return alert('문항을 추가하세요.');
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert('저장 완료!');
}));

safe(els.btnUploadTxt, ()=> els.btnUploadTxt.addEventListener('click', ()=> els.fileUploadTxt?.click()));
safe(els.fileUploadTxt, ()=> els.fileUploadTxt.addEventListener('change', async e=>{
  const f=e.target.files?.[0]; if(!f) return;
  const text=await f.text();
  const rows=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const qs=rows.map(line=>{
    const arr=line.split(',').map(s=>s.trim());
    if(arr[1]==='주관식'){ return {type:'short', text:arr[0], answerText:arr[2]||''}; }
    return {type:'mcq', text:arr[0], options:arr.slice(1,5), answerIndex:Math.max(0,(parseInt(arr[5],10)||1)-1)};
  });
  if(els.builder){ els.builder.innerHTML=''; qs.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q))); }
  if(els.questionCount) els.questionCount.value = qs.length;
}));
safe(els.btnDownloadTemplate, ()=> els.btnDownloadTemplate.addEventListener('click', ()=>{
  const sample = [
    '가장 큰 행성?,지구,목성,화성,금성,2',
    '물의 끓는점(°C)?,주관식,100'
  ].join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([sample],{type:'text/plain'})); a.download='quiz-template.txt'; a.click();
  URL.revokeObjectURL(a.href);
}));

safe(els.btnSaveOptions, ()=> els.btnSaveOptions.addEventListener('click', async ()=>{
  if(!roomId) return alert('세션에 먼저 접속하세요.');
  const data={
    limit: els.limitName?.checked ? 'name' : 'device',
    accept: !!els.chkAccept?.checked,
    reveal: !!els.chkReveal?.checked,
    light:  !!els.chkLight?.checked,
    timer:  Math.max(5,Math.min(600, parseInt(els.timerSec?.value,10)||30))
  };
  await setDoc(roomRef(roomId), data, { merge:true });
  buildStudentLink();
  alert('옵션이 저장되었습니다.');
}));

safe(els.btnResetAll, ()=> els.btnResetAll.addEventListener('click', async ()=>{
  if(!roomId) return alert('세션에 먼저 접속하세요.');
  if(!confirm('문항/옵션/응답 전체를 초기화합니다. 계속할까요?')) return;
  await setDoc(roomRef(roomId), { title:'새 세션', mode:'idle', currentIndex:-1, accept:false, reveal:false, light:false, questions:[] }, { merge:true });
  const snap=await getDocs(respCol(roomId));
  await Promise.all(snap.docs.map(d=> setDoc(doc(respCol(roomId), d.id), { answers:{}, alive:true }, { merge:true })));
  alert('초기화 완료');
}));

safe(els.btnCopyLink,  ()=> els.btnCopyLink.addEventListener('click', async ()=>{ await navigator.clipboard.writeText(els.studentLink.value||''); els.btnCopyLink.textContent='복사됨'; setTimeout(()=>els.btnCopyLink.textContent='복사',1200); }));
safe(els.btnOpenStudent, ()=> els.btnOpenStudent.addEventListener('click', ()=> window.open(els.studentLink?.value||'#','_blank')));

safe(els.btnStart, ()=> els.btnStart.addEventListener('click', startQuiz));
safe(els.btnPrev,  ()=> els.btnPrev.addEventListener('click', ()=> step(-1)));
safe(els.btnNext,  ()=> els.btnNext.addEventListener('click', ()=> step(+1)));
safe(els.btnEndAll,()=> els.btnEndAll.addEventListener('click', finishAll));

/* student events */
safe(els.btnJoinGo,   ()=> els.btnJoinGo.addEventListener('click', join));
safe(els.btnShortSend,()=> els.btnShortSend.addEventListener('click', ()=> submit((els.shortInput?.value||'').trim())));
safe(els.btnSeeMyResult, ()=> els.btnSeeMyResult.addEventListener('click', ()=>{
  // 간단 개인 결과표 렌더
  if(!els.myResultBox) return;
  els.studentResult.classList.remove('hide');
  (async ()=>{
    const r=(await getDoc(roomRef(roomId))).data();
    const meDoc = await getDoc(doc(respCol(roomId), me.id));
    const data  = meDoc.exists()? meDoc.data():{};
    let score=0;
    const rows=(r.questions||[]).map((q,i)=>{
      const a=data.answers?.[i];
      const ok=a?.correct===true; if(ok) score++;
      return `<tr><td>${i+1}</td><td>${a? (q.type==='mcq'?(a.value+1):a.value):'-'}</td><td>${ok?'O':'X'}</td></tr>`;
    }).join('');
    els.myResultBox.innerHTML = `
      <div class="muted">이름: ${data.name||'-'} · 점수: ${score}</div>
      <table><thead><tr><th>문항</th><th>제출</th><th>정답</th></tr></thead><tbody>${rows}</tbody></table>`;
  })();
}));

/* ---------- boot ---------- */
function autoReconnect(){
  loadLocal();
  setMode(MODE);
  // URL로 학생 접속시 ?room=xxx
  const rid = qs.get('room');
  if(rid){ roomId=rid; if($('#roomId')) $('#roomId').value=roomId; }
  if(roomId) connect();
}
document.addEventListener('DOMContentLoaded', autoReconnect);
