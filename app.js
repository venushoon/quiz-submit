// ---------- 공통 유틸 ----------
const $  = (s, el=document)=>el.querySelector(s);
const $$ = (s, el=document)=>Array.from(el.querySelectorAll(s));
const pad = n=>String(n).padStart(2,'0');

// ---------- 전역 상태 ----------
let MODE = 'admin';            // 'admin' | 'student'
let roomId = '';
let me = { id:null, name:'' };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;

const els = {
  // header/admin
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnSignOut: $("#btnSignOut"),
  roomStatus: $("#roomStatus"), liveDot: $("#liveDot"),
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"), pOptions: $("#panelOptions"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),

  // builder
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"),
  builder: $("#builder"), fileUploadTxt: $("#fileUploadTxt"), btnUploadTxt: $("#btnUploadTxt"), btnDownloadTemplate: $("#btnDownloadTemplate"),

  // options
  policyDevice: $("#policyDevice"), policyName: $("#policyName"),
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright: $("#chkBright"),
  timerSec: $("#timerSec"), btnSaveOptions: $("#btnSaveOptions"),
  studentAccess: $("#studentAccess"), qrCanvas: $("#qrCanvas"),
  studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

  // present
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  leftSec: $("#leftSec"), board: $("#board"), presentWait: $("#presentWait"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pImg: $("#pImg"), pOpts: $("#pOpts"),
  statJoin: $("#statJoin"), statSubmit: $("#statSubmit"), statCorrect: $("#statCorrect"), statWrong: $("#statWrong"),

  // results
  btnExportCSV: $("#btnExportCSV"), btnResetAll: $("#btnResetAll"), resultsTable: $("#resultsTable"),

  // student
  studentPanel: $("#studentPanel"), studentTopInfo: $("#studentTopInfo"),
  dlgJoin: $("#dlgJoin"), dlgForm: $("#dlgForm"), studentName: $("#studentName"), btnJoin: $("#btnJoin"),
  studentQuiz: $("#studentQuiz"), badgeType: $("#badgeType"), sQText: $("#sQText"), sQImg: $("#sQImg"),
  mcqBox: $("#mcqBox"), shortBox: $("#shortBox"), shortInput: $("#shortInput"), btnShortSend: $("#btnShortSend"),
  studentTimer: $("#studentTimer"),
  studentResult: $("#studentResult"), mySummary: $("#mySummary"), myTable: $("#myTable"),
};

// ---------- 로컬 저장 ----------
function saveLocal(){ localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me })); }
function loadLocal(){
  try{
    const d = JSON.parse(localStorage.getItem("quiz.live")||"{}");
    roomId = d.roomId || ""; MODE = d.MODE || 'admin'; me = d.me || {id:null,name:''};
    if(els.roomId) els.roomId.value = roomId;
  }catch{}
}

// ---------- Firestore refs ----------
const db = window.db;  // Firebase는 index.html에서 선행 로드됨
const roomRef = id => firebaseDoc('rooms', id);
const respCol = id => firebaseCol('rooms', id, 'responses');

// 안전 헬퍼: collection/doc 인자 보장
function firebaseCol(...segments){
  const { collection } = window.firebaseFirestore ?? awaitImports();
  return collection(db, ...segments);
}
function firebaseDoc(...segments){
  const { doc } = window.firebaseFirestore ?? awaitImports();
  return doc(db, ...segments);
}
async function awaitImports(){
  // 지연 로드용(일반적으로 필요 없음)
  const mod = await import("https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js");
  window.firebaseFirestore = mod; return mod;
}

// ---------- 기본 동작 ----------
function setMode(m){
  MODE=m; document.body.classList.toggle('student', m==='student');
  // 학생은 관리자 뷰 전부 숨김 (admin-only는 CSS로 처리)
  if(m==='admin'){
    // 탭 기본: 문항
    activateTab(els.tabBuild);
  }else{
    // 학생: 학생 패널만
    showStudentJoin();
  }
  saveLocal();
}

function activateTab(btn){
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove('active'));
  btn?.classList.add('active');
  const id=btn?.dataset.tab;
  els.pBuild?.classList.toggle('hide', id!=='build');
  els.pOptions?.classList.toggle('hide', id!=='options');
  els.pPresent?.classList.toggle('hide', id!=='present');
  els.pResults?.classList.toggle('hide', id!=='results');
}

// ---------- 접속/세션 ----------
async function ensureRoom(id){
  const { getDoc, setDoc, serverTimestamp } = window.firebaseFirestore ?? awaitImports();
  const snap=await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), { title:'새 세션', mode:'idle', currentIndex:-1, accept:false, reveal:false, bright:false, timer:30, createdAt: serverTimestamp(), questions:[] });
  }
}
async function connectRoom(){
  const id=(els.roomId?.value||'').trim();
  if(!id){ alert('세션 코드를 입력하세요'); return; }
  roomId=id; await ensureRoom(roomId);
  listenRoom(roomId); listenResponses(roomId);
  els.roomStatus.textContent = `세션: ${roomId} · 온라인`;
  els.roomId.disabled = true; els.btnConnect.classList.add('hide'); els.btnSignOut.classList.remove('hide');
  buildStudentLink(); saveLocal();
}
async function signOutRoom(){
  if(!roomId) return;
  if(unsubRoom){unsubRoom();unsubRoom=null}
  if(unsubResp){unsubResp();unsubResp=null}
  roomId=''; els.roomId.disabled=false; els.btnConnect.classList.remove('hide'); els.btnSignOut.classList.add('hide');
  els.roomStatus.textContent = '세션: - · 오프라인';
  els.studentLink.value=''; const ctx=els.qrCanvas?.getContext('2d'); if(ctx){ ctx.clearRect(0,0,els.qrCanvas.width,els.qrCanvas.height); }
  saveLocal();
}

// ---------- 실시간 업데이트 ----------
function listenRoom(id){
  const { onSnapshot } = window.firebaseFirestore ?? {};
  if(unsubRoom) unsubRoom();
  unsubRoom = onSnapshot(roomRef(id),(snap)=>{
    if(!snap.exists()) return;
    const r=snap.data(); window.__room=r;
    renderRoom(r);
  });
}
function listenResponses(id){
  const { onSnapshot } = window.firebaseFirestore ?? {};
  if(unsubResp) unsubResp();
  unsubResp = onSnapshot(respCol(id),(qs)=>{
    const list=[]; qs.forEach(d=>list.push({ id:d.id, ...d.data() }));
    renderResponses(list);
  });
}

// ---------- Builder ----------
function buildCard(no,q={}){
  const wrap=document.createElement('div'); wrap.className='qcard';
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="radio"><input type="radio" name="type-${no}" value="mcq" ${q.type==='short'?'':'checked'} /> 객관식</label>
      <label class="radio"><input type="radio" name="type-${no}" value="short" ${q.type==='short'?'checked':''} /> 주관식</label>
      <label class="radio right"><input type="checkbox" class="imgToggle" data-no="${no}" ${q.img?'checked':''}/> 이미지</label>
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항 내용" value="${q.text||''}"/>

    <div class="mcq ${q.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q.options||['','','','']).map((v,i)=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기 ${i+1}" value="${v}">`).join('')}
      </div>
      <div class="row"><span class="muted">정답 번호</span><input class="ansIndex input sm" data-no="${no}" type="number" min="1" max="10" value="${(q.answerIndex??0)+1}"></div>
    </div>

    <div class="short ${q.type==='short'?'':'hide'}">
      <input class="ansText input" data-no="${no}" placeholder="정답(선택, 자동채점용)" value="${q.answerText||''}">
    </div>

    <div class="row mt ${q.img?'':'hide'}" id="imgRow-${no}">
      <input type="file" accept="image/*" class="imgFile" data-no="${no}"/>
      <img class="qthumb ${q.img?'':'hide'}" id="thumb-${no}" src="${q.img||''}"/>
    </div>
  `;
  // 타입 전환
  const radios = $$(`input[name="type-${no}"]`, wrap);
  const mcq = $(".mcq", wrap), short = $(".short", wrap);
  radios.forEach(r=>r.addEventListener('change', ()=>{
    const isShort = radios.find(x=>x.checked)?.value==='short';
    mcq.classList.toggle('hide', isShort);
    short.classList.toggle('hide', !isShort);
  }));
  // 이미지 토글/미리보기
  $(".imgToggle", wrap).addEventListener('change', (e)=>{
    const on=e.target.checked; $(`#imgRow-${no}`,wrap).classList.toggle('hide', !on);
  });
  $(".imgFile", wrap).addEventListener('change', (e)=>{
    const f=e.target.files?.[0]; if(!f) return;
    const url=URL.createObjectURL(f); $(`#thumb-${no}`,wrap).src=url; $(`#thumb-${no}`,wrap).classList.remove('hide');
  });
  return wrap;
}
function collectQuiz(){
  const cards = $$("#builder .qcard");
  const list = cards.map((card,idx)=>{
    const no=idx+1;
    const type = card.querySelector(`input[name="type-${no}"]:checked`).value;
    const text = card.querySelector('.qtext').value.trim();
    let img = card.querySelector(`#thumb-${no}`)?.src || '';
    if(!text) return null;
    if(type==='mcq'){
      const opts = $$('.opt',card).map(i=>i.value.trim()).filter(Boolean);
      const ans  = Math.max(0,Math.min(opts.length-1,(parseInt(card.querySelector('.ansIndex').value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans, img: img.startsWith('blob:')? img : (img||'') };
    }else{
      const answerText = card.querySelector('.ansText').value.trim();
      return { type:'short', text, answerText, img: img.startsWith('blob:')? img : (img||'') };
    }
  }).filter(Boolean);
  return { title:(els.quizTitle.value||'퀴즈'), questions:list };
}

// ---------- 옵션/링크/QR ----------
function buildStudentLink(){
  if(!roomId) return;
  const url = new URL(location.href);
  url.searchParams.set('role','student');
  url.searchParams.set('room', roomId);
  els.studentLink.value = url.toString();
  if(window.QRCode && els.qrCanvas){
    window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:128, margin:1 }, (err)=>{ if(err) console.warn(err); });
  }
}

// ---------- 프레젠테이션/타이머 ----------
function startTimer(sec){
  stopTimer();
  const end=Date.now()+sec*1000;
  timerHandle=setInterval(async ()=>{
    const remain=Math.max(0,Math.floor((end-Date.now())/1000));
    const mm=pad(Math.floor(remain/60)), ss=pad(remain%60);
    els.leftSec.textContent = `${mm}:${ss}`;
    els.studentTimer.textContent = (MODE==='student')? `${mm}:${ss}` : '';
    if(remain<=0){
      stopTimer();
      const { updateDoc } = window.firebaseFirestore ?? {};
      if(roomId) await updateDoc(roomRef(roomId), { accept:false });
      setTimeout(()=> step(+1), 400);
    }
  },250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } els.leftSec.textContent='00:00'; els.studentTimer.textContent=''; }

// ---------- 제출/채점 ----------
async function join(){
  if(MODE!=='student') return;
  const { setDoc, serverTimestamp } = window.firebaseFirestore ?? {};
  const name=(els.studentName.value||'').trim(); if(!name) return alert('이름을 입력하세요');
  me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem("quiz.device", me.id);
  await setDoc(firebaseDoc('rooms',roomId,'responses',me.id), { name, joinedAt: serverTimestamp(), answers:{}, alive:true }, { merge:true });
  // 대기 모드 유지 (관리자가 시작할 때까지)
  if(els.dlgJoin?.open) els.dlgJoin.close();
  saveLocal(); renderRoom(window.__room || {});
}
async function submitAnswer(value){
  const { getDoc, setDoc } = window.firebaseFirestore ?? {};
  const r=window.__room||{}; if(!r.accept) return alert('지금은 제출할 수 없습니다.');
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
  const ref=firebaseDoc('rooms',roomId,'responses',me.id);
  const snap=await getDoc(ref); const prev=snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert('이미 제출했습니다.');
  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true), revealed:r.reveal||false } }, { merge:true });
}

// ---------- 렌더 ----------
function renderRoom(r){
  // 공통
  if(els.liveDot) els.liveDot.style.opacity = roomId ? 1 : .3;

  // 관리자
  if(MODE==='admin'){
    els.presentWait.classList.toggle('hide', !(r.mode!=='active' || (r.currentIndex??-1)<0));
    els.pTitle.textContent = r.title || roomId || '-';
    if(r.mode==='active' && (r.currentIndex??-1)>=0){
      const q=r.questions[r.currentIndex];
      els.pQ.textContent = q.text;
      // 이미지(있을 때만)
      if(q.img){ els.pImg.src=q.img; els.pImg.classList.remove('hide'); } else { els.pImg.classList.add('hide'); }
      els.pOpts.innerHTML='';
      if(q.type==='mcq'){
        q.options.forEach((t,i)=>{ const d=document.createElement('div'); d.className='popt'; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d); });
      }else{
        const d=document.createElement('div'); d.className='popt'; d.textContent='주관식'; els.pOpts.appendChild(d);
      }
    }else{
      els.pQ.textContent='-'; els.pImg.classList.add('hide'); els.pOpts.innerHTML='';
    }
  }

  // 학생
  if(MODE==='student'){
    els.studentTopInfo.textContent = roomId ? `세션: ${roomId} · 온라인` : '세션: - · 오프라인';

    // 시작 전: 항상 대기화면
    const idx=r.currentIndex??-1;
    if(r.mode!=='active' || idx<0){
      els.badgeType.textContent='대기';
      els.sQText.textContent='제출 버튼을 눌러주세요.'; // 안내
      els.sQImg.classList.add('hide'); els.mcqBox.innerHTML=''; els.shortBox.classList.add('hide');
      return;
    }

    // 시작 후 문항 표시
    const q=r.questions[idx];
    els.badgeType.textContent = q.type==='mcq'?'객관식':'주관식';
    els.sQText.textContent = q.text;
    if(q.img){ els.sQImg.src=q.img; els.sQImg.classList.remove('hide'); } else { els.sQImg.classList.add('hide'); }

    if(q.type==='mcq'){
      els.mcqBox.innerHTML=''; els.shortBox.classList.add('hide');
      (q.options||[]).forEach((opt,i)=>{
        const b=document.createElement('button'); b.className='optbtn'; b.textContent=`${i+1}. ${opt}`; b.disabled=!r.accept;
        b.addEventListener('click',()=>submitAnswer(i)); els.mcqBox.appendChild(b);
      });
    }else{
      els.mcqBox.innerHTML=''; els.shortBox.classList.remove('hide'); els.btnShortSend.disabled=!r.accept;
    }
  }

  // 통계
  (els.chkBright?.checked || r.bright) ? document.body.classList.add('bright') : document.body.classList.remove('bright');
}

function renderResponses(list){
  if(MODE!=='admin') return;
  const r=window.__room||{}; const idx=r.currentIndex??-1; const q=r.questions?.[idx];
  // 프레젠테이션 하단 카운터
  let join=list.length, submit=0, correct=0, wrong=0;
  list.forEach(s=>{
    const a=s.answers?.[idx];
    if(a){ submit++; if(a.correct) correct++; else wrong++; }
  });
  els.statJoin.textContent = `참가 ${join}`;
  els.statSubmit.textContent = `제출 ${submit}`;
  els.statCorrect.textContent = `정답 ${correct}`;
  els.statWrong.textContent = `오답 ${wrong}`;

  // 결과표(관리자)
  const table=document.createElement('table');
  const thead=document.createElement('thead'); const trh=document.createElement('tr');
  ['이름', ...(r.questions||[]).map((_,i)=>`Q${i+1}`), '점수'].forEach(h=>{const th=document.createElement('th');th.textContent=h;trh.appendChild(th);});
  thead.appendChild(trh); table.appendChild(thead);
  const tb=document.createElement('tbody');
  list.forEach(s=>{
    let score=0; const tr=document.createElement('tr');
    const tdN=document.createElement('td'); tdN.textContent=s.name||s.id; tr.appendChild(tdN);
    (r.questions||[]).forEach((qq,i)=>{
      const a=s.answers?.[i]; const td=document.createElement('td');
      td.textContent = a? (qq.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value??'-')) : '-';
      if(a?.correct) score++; tr.appendChild(td);
    });
    const tdS=document.createElement('td'); tdS.textContent=String(score); tr.appendChild(tdS);
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  els.resultsTable.innerHTML=''; els.resultsTable.appendChild(table);
}

// ---------- 진행 제어 ----------
async function startQuiz(){
  const { updateDoc } = window.firebaseFirestore ?? {};
  if(!roomId) return alert('세션 먼저 연결하세요.');
  await updateDoc(roomRef(roomId), { mode:'active', currentIndex:0, accept:true });
  const r=window.__room||{}; const sec=parseInt(els.timerSec.value,10)||r.timer||30; startTimer(sec);
}
async function step(delta){
  const { runTransaction } = window.firebaseFirestore ?? awaitImports();
  await runTransaction(db, async (tx)=>{
    const snap = await tx.get(roomRef(roomId)); const r=snap.data(); const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){ // 자동 종료 → 결과 탭으로
      tx.update(roomRef(roomId), { currentIndex: Math.max(0,total-1), mode:'ended', accept:false });
      activateTab(els.tabResults); return;
    }
    next=Math.max(0,next);
    tx.update(roomRef(roomId), { currentIndex: next, accept:true });
  });
}
async function endQuiz(){
  const { updateDoc } = window.firebaseFirestore ?? {};
  if(!roomId) return;
  await updateDoc(roomRef(roomId), { mode:'ended', accept:false });
  activateTab(els.tabResults);
}

// ---------- CSV/초기화 ----------
els.btnExportCSV?.addEventListener('click', async ()=>{
  const { getDoc, getDocs } = window.firebaseFirestore ?? {};
  const r=(await getDoc(roomRef(roomId))).data();
  const snap=await getDocs(respCol(roomId));
  const rows=[]; rows.push(['userId','name',...(r.questions||[]).map((_,i)=>`Q${i+1}`),'score'].join(','));
  snap.forEach(d=>{
    const s=d.data(); let score=0;
    const answers=(r.questions||[]).map((q,i)=>{const a=s.answers?.[i]; if(a?.correct) score++; return q.type==='mcq'?(typeof a?.value==='number'? a.value+1:''):(a?.value??'');});
    rows.push([d.id, `"${(s.name||'').replace(/"/g,'""')}"`, ...answers, score].join(','));
  });
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([rows.join('\n')],{type:'text/csv'}));
  a.download=`${r.title||roomId}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
});
els.btnResetAll?.addEventListener('click', async ()=>{
  if(!confirm('모든 응답/점수/상태를 초기화할까요?')) return;
  const { getDocs, setDoc, updateDoc } = window.firebaseFirestore ?? {};
  await updateDoc(roomRef(roomId), { mode:'idle', currentIndex:-1, accept:false, reveal:false });
  const snap=await getDocs(respCol(roomId)); const works=[];
  snap.forEach(d=> works.push(setDoc(firebaseDoc('rooms',roomId,'responses',d.id), { answers:{}, alive:true }, { merge:true })));
  await Promise.all(works); alert('초기화 완료');
});

// ---------- 옵션 저장 ----------
els.btnSaveOptions?.addEventListener('click', async ()=>{
  const { updateDoc } = window.firebaseFirestore ?? {};
  if(!roomId) return alert('세션 먼저 연결하세요.');
  await updateDoc(roomRef(roomId), {
    policy: els.policyName.checked ? 'name' : 'device',
    accept: !!els.chkAccept.checked, reveal: !!els.chkReveal.checked,
    bright: !!els.chkBright.checked, timer: parseInt(els.timerSec.value,10)||30
  });
  buildStudentLink(); // 저장 즉시 링크/QR 갱신
});

// ---------- 이벤트 바인딩 ----------
els.btnConnect?.addEventListener('click', connectRoom);
els.btnSignOut?.addEventListener('click', signOutRoom);

[els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(btn=>{
  btn?.addEventListener('click', ()=> activateTab(btn));
});

els.btnBuildForm?.addEventListener('click', ()=>{
  const n=Math.max(1,Math.min(20, parseInt(els.questionCount.value,10)||3));
  els.builder.innerHTML=''; for(let i=0;i<n;i++) els.builder.appendChild(buildCard(i+1));
});
els.btnLoadSample?.addEventListener('click', ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)은?', answerText:'100'},
    {type:'mcq', text:'태양계 별명은?', options:['Milky','Solar','Sunset','Lunar'], answerIndex:1},
  ];
  els.builder.innerHTML=''; S.forEach((q,i)=>els.builder.appendChild(buildCard(i+1,q)));
  els.quizTitle.value='샘플 퀴즈'; els.questionCount.value=String(S.length);
});
els.btnSaveQuiz?.addEventListener('click', async ()=>{
  const { setDoc } = window.firebaseFirestore ?? {};
  if(!roomId) return alert('세션 먼저 연결하세요.');
  const payload=collectQuiz(); if(!payload.questions.length) return alert('문항을 추가하세요.');
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert('저장 완료!');
});

// 수동 업로드/양식
els.btnUploadTxt?.addEventListener('click', ()=> els.fileUploadTxt.click());
els.fileUploadTxt?.addEventListener('change', async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const text=await f.text();
  const rows=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const qs=rows.map(l=>{
    const parts=l.split(',').map(s=>s.trim());
    if(parts.length===6) return {type:'mcq',text:parts[0],options:parts.slice(1,5),answerIndex:Math.max(0,Math.min(3,(parseInt(parts[5],10)||1)-1))};
    if(parts.length===3 && parts[1]==='주관식') return {type:'short',text:parts[0],answerText:parts[2]};
    return null;
  }).filter(Boolean);
  els.builder.innerHTML=''; qs.forEach((q,i)=>els.builder.appendChild(buildCard(i+1,q)));
  els.questionCount.value=String(qs.length);
});
els.btnDownloadTemplate?.addEventListener('click', ()=>{
  const sample = `가장 큰 행성?,지구,목성,화성,금성,2\n물의 끓는점?,주관식,100`;
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([sample],{type:'text/plain'}));
  a.download='quiz-template.txt'; a.click(); URL.revokeObjectURL(a.href);
});

// 프레젠테이션 제어
els.btnStart?.addEventListener('click', startQuiz);
els.btnPrev?.addEventListener('click', ()=>step(-1));
els.btnNext?.addEventListener('click', ()=>step(+1));
els.btnEndAll?.addEventListener('click', endQuiz);

// 학생 제출
els.btnShortSend?.addEventListener('click', ()=> submitAnswer((els.shortInput.value||'').trim()));

// 링크/QR
els.btnCopyLink?.addEventListener('click', async ()=>{
  if(!els.studentLink.value) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent='복사됨'; setTimeout(()=> els.btnCopyLink.textContent='복사', 1200);
});
els.btnOpenStudent?.addEventListener('click', ()=> window.open(els.studentLink.value||'#','_blank'));

// ---------- 학생 조인/대기 ----------
function showStudentJoin(){
  if(!els.dlgJoin.open) els.dlgJoin.showModal();
}
els.btnJoin?.addEventListener('click', (e)=>{ e.preventDefault(); join(); });

// ---------- 부트스트랩 ----------
(function boot(){
  loadLocal();

  // URL 파라미터: 학생 모드 진입
  const url=new URL(location.href); const role=url.searchParams.get('role'); const rid=url.searchParams.get('room');
  if(role==='student'){ document.body.classList.add('student'); setMode('student'); }
  else { setMode('admin'); }

  if(rid){ roomId=rid; if(els.roomId) els.roomId.value=roomId; connectRoom(); }

  // 첫 화면: 관리자라면 문항 탭부터
  if(MODE==='admin') activateTab(els.tabBuild);
})();
