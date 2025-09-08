/* app.js — import/await 없이 동작하는 버전 */

// --- helpers ---------------------------------------------------------------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const pad = n => String(n).padStart(2, '0');

// 상태
let MODE = 'admin';         // 'admin' | 'student'
let roomId = '';
let me = { id: null, name: '' };
let unsubRoom = null, unsubResp = null;
let timerHandle = null;

// DOM 캐시(존재 안 하면 null 허용)
const els = {
  // 헤더(관리자 전용)
  roomId:        $('#roomId'),
  btnConnect:    $('#btnConnect'),
  btnSignOut:    $('#btnSignOut'),
  roomStatus:    $('#roomStatus'),
  tabBuild:      $('#tabBuild'),
  tabOptions:    $('#tabOptions'),
  tabPresent:    $('#tabPresent'),
  tabResults:    $('#tabResults'),
  panels:        {
    build:   $('#panelBuild'),
    options: $('#panelOptions'),
    present: $('#panelPresent'),
    results: $('#panelResults'),
  },

  // 문항 빌더
  quizTitle:       $('#quizTitle'),
  questionCount:   $('#questionCount'),
  btnBuildForm:    $('#btnBuildForm'),
  btnLoadSample:   $('#btnLoadSample'),
  btnSaveQuiz:     $('#btnSaveQuiz'),
  builder:         $('#builder'),
  fileUploadTxt:   $('#fileUploadTxt'),
  btnUploadTxt:    $('#btnUploadTxt'),
  btnDownloadTemplate: $('#btnDownloadTemplate'),

  // 옵션
  policyDevice: $('#policyDevice'),
  policyName:   $('#policyName'),
  chkAccept:    $('#chkAccept'),
  chkReveal:    $('#chkReveal'),
  chkBright:    $('#chkBright'),
  timerSec:     $('#timerSec'),
  btnOptSave:   $('#btnOptSave'),
  btnResetAll:  $('#btnResetAll'),

  // QR/링크
  qrCanvas:     $('#qrCanvas'),
  studentLink:  $('#studentLink'),
  btnCopyLink:  $('#btnCopyLink'),
  btnOpenStudent: $('#btnOpenStudent'),

  // 진행/프레젠테이션
  btnStart:     $('#btnStart'),
  btnPrev:      $('#btnPrev'),
  btnNext:      $('#btnNext'),
  btnEndAll:    $('#btnEndAll'),
  pTitle:       $('#pTitle'),
  pQ:           $('#pQ'),
  pImg:         $('#pImg'),
  pOpts:        $('#pOpts'),
  pLegend:      $('#pLegend'),
  leftSec:      $('#leftSec'),

  // 관리 화면 실시간 칩/주관식 표/결과
  chips:        $('#chips'),
  shortAnswers: $('#shortAnswers'),
  resultsTable: $('#resultsTable'),
  btnExportCSV: $('#btnExportCSV'),

  // 학생 패널(학생 링크에서만 보임)
  studentWrap:  $('#studentWrap'),
  studentName:  $('#studentName'),
  btnJoin:      $('#btnJoin'),
  waitBadge:    $('#waitBadge'),
  sQText:       $('#sQText'),
  sImg:         $('#sImg'),
  mcqBox:       $('#mcqBox'),
  shortBox:     $('#shortBox'),
  shortInput:   $('#shortInput'),
  btnShortSend: $('#btnShortSend'),
};

// 안전 가드: 없는 엘리먼트는 경고만
Object.entries(els).forEach(([k,v])=>{
  if (v === null) console.warn('[warn] missing element:', k);
});

// --- Firestore refs --------------------------------------------------------
const { doc, setDoc, getDoc, updateDoc, onSnapshot, runTransaction, collection, getDocs, serverTimestamp, deleteDoc } =
  window.firebaseFirestore ?? (()=>{
    // index.html의 <script type="module">에서 window.db만 노출하므로
    // 여기선 firestore 네임스페이스가 없어요. 필요한 함수는 db.__proto__에 없음.
    // 대신 window.db만 쓰고, 컬렉션/도큐먼트 참조는 아래 헬퍼로 만듭니다.
    return {};
  })();

// db는 index.html에서 전역으로 만들어 둠
const db = window.db;

// Firestore 경로 헬퍼
const roomRef = id => window.firebase?.firestore ? null : firebaseDoc('rooms', id);
function firebaseDoc(col, id){
  // v9 모듈 API를 직접 import하지 않으므로, window.db의 내부 API를 간단히 래핑
  // -> 실제 문서 참조/읽기/쓰기 동작은 아래 fetch/merge 계열 함수가 담당
  return { __col: col, __id: id };
}
function respCol(id){ return { __col: `rooms/${id}/responses` }; }

// Firestore 액션: 모듈을 직접 import하지 않았으므로 Web SDK REST를 쓰지 않고
// index.html의 모듈 스크립트가 노출해 둔 전역 유틸을 활용하는 대신,
// 여기서는 **onSnapshot 등 실시간**은 window.db로만 처리해야 합니다.
// → 간단화를 위해 아래는 필수 동작만 window.db 모듈 API로 호출합니다.
importShim();

// 모듈 없이도 쓸 수 있게 v9 API를 얇게 주입
function importShim(){
  // 이미 모듈 스크립트에서 로드된 전역(ESM) 객체를 안전하게 꺼내기 어렵기 때문에
  // window.db에서 필요한 함수만 동적으로 import해 래핑
  // (실제 v9 API 네임은 tree-shake되어 전역에 없음 → 기본적인 subset만 구현)
  // → 간략화를 위해 필요한 곳에서만 직접 호출(예: getDoc, setDoc 등).
}

// --- localStorage ----------------------------------------------------------
function saveLocal(){
  localStorage.setItem('quiz.live', JSON.stringify({ MODE, roomId, me }));
}
function loadLocal(){
  try{
    const d = JSON.parse(localStorage.getItem('quiz.live')||'{}');
    MODE   = d.MODE   || 'admin';
    roomId = d.roomId || '';
    me     = d.me     || { id:null, name:'' };
    if (els.roomId) els.roomId.value = roomId;
  }catch{}
}

// --- UI 모드 전환 ----------------------------------------------------------
function setMode(m){
  MODE = m;
  // 관리자 전용 헤더/탭 토글
  $$('.admin-only').forEach(el => el.classList.toggle('hide', m !== 'admin'));
  // 패널 표시
  Object.entries(els.panels).forEach(([name, el])=>{
    if (!el) return;
    el.classList.toggle('hide', m === 'student' && name !== 'present'); // 학생은 프레젠테이션처럼 보이기만
  });
  // 학생 전용 래퍼 표시
  if (els.studentWrap) els.studentWrap.classList.toggle('hide', m !== 'student');

  // 상태 텍스트
  if (els.roomStatus) {
    els.roomStatus.textContent = roomId ? `세션: ${roomId} · 온라인` :
      (m === 'admin' ? '세션: - · 오프라인' : '학생: 세션 연결 필요');
  }
}

// --- 세션 연결/해제 --------------------------------------------------------
async function ensureRoom(id){
  const ref = firebase.firestore().doc(window.db, 'rooms', id);
  const snap = await firebase.firestore().getDoc(ref);
  if (!snap.exists()){
    await firebase.firestore().setDoc(ref, {
      title: '새 세션',
      mode: 'idle',       // idle | active | ended
      currentIndex: -1,
      accept: false,
      reveal: false,
      policy: { deviceOnce:true, nameOnce:false },
      timer: 0,
      createdAt: firebase.firestore.serverTimestamp(),
      questions: []
    });
  }
}
async function connect(){
  const id = (els.roomId?.value || '').trim();
  if (!id) return alert('세션 코드를 입력하세요.');
  roomId = id;
  await ensureRoom(roomId);
  listenRoom(roomId);
  listenResponses(roomId);
  buildStudentLink();
  if (els.roomStatus) els.roomStatus.textContent = `세션: ${roomId} · 온라인`;
  if (els.btnConnect && els.btnSignOut && els.roomId){
    els.btnConnect.classList.add('hide');
    els.btnSignOut.classList.remove('hide');
    els.roomId.disabled = true;
  }
  saveLocal();
}
function signOut(){
  if (unsubRoom) unsubRoom(); if (unsubResp) unsubResp();
  unsubRoom = unsubResp = null;
  roomId = '';
  if (els.roomId){ els.roomId.disabled = false; els.roomId.value = ''; }
  if (els.btnConnect && els.btnSignOut){ els.btnConnect.classList.remove('hide'); els.btnSignOut.classList.add('hide'); }
  if (els.roomStatus) els.roomStatus.textContent = '세션: - · 오프라인';
  saveLocal();
}

// --- Firestore 실시간 ------------------------------------------------------
function listenRoom(id){
  if (unsubRoom) unsubRoom();
  const ref = firebase.firestore().doc(window.db, 'rooms', id);
  unsubRoom = firebase.firestore().onSnapshot(ref, snap=>{
    if (!snap.exists()) return;
    const r = snap.data(); window.__room = r;
    renderRoom(r);
  });
}
function listenResponses(id){
  if (unsubResp) unsubResp();
  const col = firebase.firestore().collection(window.db, 'rooms', id, 'responses');
  unsubResp = firebase.firestore().onSnapshot(col, qs=>{
    const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    renderResponses(arr);
  });
}

// --- 빌더(간략) ------------------------------------------------------------
function cardRow(no, q){
  const wrap = document.createElement('div');
  wrap.className = 'qcard';
  wrap.innerHTML = `
    <div class="row">
      <span class="badge">${no}번</span>
      <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'}><span>객관식</span></label>
      <label class="switch"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''}><span>주관식</span></label>
      <label class="row" style="margin-left:auto;">
        <input type="file" accept="image/*" class="input" data-role="img" data-no="${no}" style="width:210px">
      </label>
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항 내용" value="${q?.text||''}">
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기 ${i+1}" value="${v}">`).join('')}
      </div>
      <div class="row">
        <span class="muted">정답 번호</span>
        <input class="ansIndex input sm" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
      </div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <input class="ansText input" data-no="${no}" placeholder="정답(선택, 자동채점용)" value="${q?.answerText||''}">
    </div>
  `;
  const radios = $$(`input[name="type-${no}"]`, wrap);
  const mcq = $('.mcq', wrap), short = $('.short', wrap);
  radios.forEach(r=>r.addEventListener('change', ()=>{
    const isShort = radios.find(x=>x.checked)?.value === 'short';
    mcq.classList.toggle('hide', isShort);
    short.classList.toggle('hide', !isShort);
  }));
  return wrap;
}
function collectBuilder(){
  const cards = $$('#builder>.qcard');
  const list = cards.map((c,idx)=>{
    const no = idx+1;
    const type = c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text = c.querySelector('.qtext').value.trim();
    if (!text) return null;
    const imgFile = c.querySelector('[data-role="img"]')?.files?.[0] || null;
    const base64 = imgFile ? c.__imgB64 || null : null; // (간단화를 위해 runtime 변환은 생략)
    if (type==='mcq'){
      const opts = $$('.opt', c).map(i=>i.value.trim()).filter(Boolean);
      const ans  = Math.max(0, Math.min(opts.length-1, (parseInt(c.querySelector('.ansIndex').value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans, image:base64 };
    }else{
      return { type:'short', text, answerText:c.querySelector('.ansText').value.trim(), image:base64 };
    }
  }).filter(Boolean);
  return { title: els.quizTitle?.value || '퀴즈', questions:list };
}

// --- 옵션 저장/타이머/QR ---------------------------------------------------
async function saveOptions(){
  if (!roomId) return alert('세션에 먼저 접속하세요.');
  const ref = firebase.firestore().doc(window.db, 'rooms', roomId);
  const payload = {
    policy: {
      deviceOnce: !!els.policyDevice?.checked,
      nameOnce:   !!els.policyName?.checked,
    },
    accept: !!els.chkAccept?.checked,
    reveal: !!els.chkReveal?.checked,
    bright: !!els.chkBright?.checked,
    timer:  Math.max(0, parseInt(els.timerSec?.value,10)||0),
  };
  await firebase.firestore().updateDoc(ref, payload);
  buildStudentLink(); // 저장 후 링크/QR 갱신
  alert('저장 완료');
}
function buildStudentLink(){
  if (!els.studentLink) return;
  const url = new URL(location.href);
  url.searchParams.set('role','student');
  if (roomId) url.searchParams.set('room', roomId);
  els.studentLink.value = url.toString();

  if (window.QRCode && els.qrCanvas){
    try{ QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:120 }); }catch(e){ console.warn(e); }
  }
}
function startTimer(sec){
  stopTimer();
  if (!sec) return;
  const end = Date.now() + sec*1000;
  timerHandle = setInterval(()=>{
    const remain = Math.max(0, Math.floor((end - Date.now())/1000));
    if (els.leftSec) els.leftSec.textContent = `${pad(Math.floor(remain/60))}:${pad(remain%60)}`;
    if (remain<=0){ stopTimer(); autoCloseAndNext(); }
  }, 250);
}
function stopTimer(){ if (timerHandle){ clearInterval(timerHandle); timerHandle=null; } if (els.leftSec) els.leftSec.textContent = '00:00'; }
async function autoCloseAndNext(){
  const ref = firebase.firestore().doc(window.db, 'rooms', roomId);
  await firebase.firestore().updateDoc(ref, { accept:false });
  // 다음 문제
  step(+1);
}

// --- 진행(시작/이전/다음/종료) ---------------------------------------------
async function startQuiz(){
  const ref = firebase.firestore().doc(window.db, 'rooms', roomId);
  await firebase.firestore().updateDoc(ref, { mode:'active', currentIndex:0, accept:true });
}
async function step(delta){
  const ref = firebase.firestore().doc(window.db, 'rooms', roomId);
  await firebase.firestore().runTransaction(window.db, async tx=>{
    const snap = await firebase.firestore().getDoc(ref);
    const r = snap.data(); const total=(r.questions?.length||0);
    let next = (r.currentIndex??-1) + delta;
    if (next >= total){ // 마지막 다음 → 종료
      tx.update(ref, { mode:'ended', accept:false });
    }else{
      next = Math.max(0, next);
      tx.update(ref, { currentIndex: next, accept:true });
    }
  });
}
async function finishAll(){
  if (!confirm('퀴즈를 종료할까요?')) return;
  const ref = firebase.firestore().doc(window.db, 'rooms', roomId);
  await firebase.firestore().updateDoc(ref, { mode:'ended', accept:false });
}

// --- 학생 참가/제출 --------------------------------------------------------
async function join(){
  if (!roomId) return alert('세션에 먼저 접속하세요.');
  const name = (els.studentName?.value || '').trim();
  if (!name) return alert('이름(번호)을 입력하세요.');
  me = { id: localStorage.getItem('quiz.device') || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem('quiz.device', me.id);
  const ref = firebase.firestore().doc(window.db, 'rooms', roomId, 'responses', me.id);
  await firebase.firestore().setDoc(ref, { name, joinedAt: firebase.firestore.serverTimestamp(), answers:{}, alive:true }, { merge:true });
  alert('참가 완료! 제출 버튼을 눌러주세요.');
  saveLocal();
}
async function submit(value){
  const r = window.__room; if (!r?.accept) return alert('지금은 제출할 수 없습니다.');
  const idx = r.currentIndex; const q = r.questions?.[idx]; if (!q) return;
  const ref = firebase.firestore().doc(window.db, 'rooms', roomId, 'responses', me.id);
  const snap = await firebase.firestore().getDoc(ref);
  const prev = snap.exists()? (snap.data().answers||{}) : {};
  if (prev[idx]!=null) return alert('이미 제출했습니다.');
  let correct = null;
  if (q.type==='mcq' && typeof value==='number'){ correct = (value === (q.answerIndex??-999)); }
  if (q.type==='short' && typeof value==='string'){
    const norm = s => String(s).trim().toLowerCase();
    if (q.answerText) correct = (norm(value) === norm(q.answerText));
  }
  await firebase.firestore().setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true), revealed:r.reveal||false } }, { merge:true });
  alert('제출 완료!');
}
async function grade(uid, qIndex, ok){
  const ref = firebase.firestore().doc(window.db, 'rooms', roomId, 'responses', uid);
  await firebase.firestore().setDoc(ref, { [`answers.${qIndex}.correct`]: !!ok, [`answers.${qIndex}.revealed`]: true }, { merge:true });
}

// --- 렌더링 ---------------------------------------------------------------
function renderRoom(r){
  // 프레젠테이션 안내문 / 타이틀
  if (els.pTitle) els.pTitle.textContent = r.title || roomId || '퀴즈';
  if (els.pLegend){
    els.pLegend.innerHTML =
      `<span class="dot blue"></span>참가 <span class="dot yellow"></span>제출 <span class="dot green"></span>정답 <span class="dot red"></span>오답`;
  }

  // 진행 문구/이미지/보기
  const idx = r.currentIndex;
  if (els.pQ) els.pQ.textContent = (r.mode!=='active' || idx<0) ? '시작 버튼을 누르면 문항이 제시됩니다.' :
                                   (r.questions?.[idx]?.text || '-');

  if (els.pImg){
    const url = r.questions?.[idx]?.image || '';
    els.pImg.src = url || ''; // 이미지가 없으면 빈 src (깨짐 방지)
    els.pImg.classList.toggle('hide', !url);
  }

  if (els.pOpts){
    els.pOpts.innerHTML = '';
    if (r.mode==='active' && idx>=0){
      const q = r.questions[idx];
      if (q.type==='mcq'){
        q.options.forEach((t,i)=>{
          const d = document.createElement('div');
          d.className='popt';
          d.textContent = `${i+1}. ${t}`;
          els.pOpts.appendChild(d);
        });
      }
    }
  }

  // 타이머
  if (r.timer && r.accept) startTimer(r.timer); else stopTimer();

  // 학생 화면
  if (MODE==='student'){
    if (r.mode!=='active' || idx<0){
      if (els.waitBadge) els.waitBadge.textContent = '대기';
      if (els.sQText) els.sQText.textContent = '참가 완료! 제출 버튼을 눌러주세요. 교사가 시작하면 1번 문항이 표시됩니다.';
      if (els.mcqBox) els.mcqBox.innerHTML = '';
      if (els.shortBox) els.shortBox.classList.add('hide');
      return;
    }
    const q = r.questions[idx];
    if (els.waitBadge) els.waitBadge.textContent = (q.type==='mcq'?'객관식':'주관식');
    if (els.sQText) els.sQText.textContent = q.text;

    if (els.sImg){
      const url = q.image || '';
      els.sImg.src = url || '';
      els.sImg.classList.toggle('hide', !url);
    }

    if (q.type==='mcq'){
      if (els.mcqBox){
        els.mcqBox.innerHTML='';
        q.options.forEach((opt,i)=>{
          const b=document.createElement('button');
          b.className='optbtn';
          b.textContent=`${i+1}. ${opt}`;
          b.disabled = !r.accept;
          b.addEventListener('click', ()=> submit(i));
          els.mcqBox.appendChild(b);
        });
      }
      if (els.shortBox) els.shortBox.classList.add('hide');
    }else{
      if (els.mcqBox) els.mcqBox.innerHTML='';
      if (els.shortBox){
        els.shortBox.classList.remove('hide');
        if (els.btnShortSend) els.btnShortSend.disabled = !r.accept;
      }
    }
  }
}
function renderResponses(list){
  if (MODE!=='admin') return;
  const r = window.__room||{}; const idx=r.currentIndex; const q=r.questions?.[idx];

  if (els.chips){
    els.chips.innerHTML='';
    list.forEach(s=>{
      const a=s.answers?.[idx];
      const chip=document.createElement('div');
      chip.className='chip '+(a? (a.correct?'ok':'no'):'wait');
      chip.textContent=s.name||s.id;
      els.chips.appendChild(chip);
    });
  }

  if (els.shortAnswers){
    els.shortAnswers.innerHTML='';
    if (q && q.type==='short'){
      list.forEach(s=>{
        const a=s.answers?.[idx]; if(!a || typeof a.value!=='string') return;
        const row=document.createElement('div'); row.className='row between';
        row.innerHTML=`<span>${s.name}: ${a.value}</span>`;
        const ok=document.createElement('button'); ok.className='btn ghost'; ok.textContent='정답';
        const no=document.createElement('button'); no.className='btn ghost'; no.textContent='오답';
        ok.onclick=()=>grade(s.id, idx, true); no.onclick=()=>grade(s.id, idx, false);
        const box=document.createElement('div'); box.append(ok,no); row.append(box);
        els.shortAnswers.appendChild(row);
      });
    }
  }

  if (els.resultsTable){
    const tbl=document.createElement('table');
    const thead=document.createElement('thead'), tr=document.createElement('tr');
    ['이름', ...(r.questions||[]).map((_,i)=>`Q${i+1}`),'점수'].forEach(h=>{const th=document.createElement('th'); th.textContent=h; tr.appendChild(th);});
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb=document.createElement('tbody');
    // 점수순 정렬
    const sorted=[...list].sort((a,b)=>{
      const as=(r.questions||[]).reduce((acc,_,i)=>acc + (a.answers?.[i]?.correct?1:0),0);
      const bs=(r.questions||[]).reduce((acc,_,i)=>acc + (b.answers?.[i]?.correct?1:0),0);
      return bs-as;
    });
    sorted.forEach(s=>{
      let score=0; const tr=document.createElement('tr');
      const tdn=document.createElement('td'); tdn.textContent=s.name||s.id; tr.appendChild(tdn);
      (r.questions||[]).forEach((q,i)=>{
        const a=s.answers?.[i]; const td=document.createElement('td');
        td.textContent = a? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1:'-') : (a.value??'-')) : '-';
        if (a?.correct) score++; tr.appendChild(td);
      });
      const tds=document.createElement('td'); tds.textContent=String(score); tr.appendChild(tds);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.resultsTable.innerHTML=''; els.resultsTable.appendChild(tbl);
  }
}

// --- 초기화/백업 -----------------------------------------------------------
async function resetAll(){
  if (!roomId) return;
  if (!confirm('모든 문항/옵션/결과를 초기 상태로 되돌릴까요?')) return;
  const rRef = firebase.firestore().doc(window.db, 'rooms', roomId);
  await firebase.firestore().setDoc(rRef, {
    title:'새 세션', mode:'idle', currentIndex:-1, accept:false, reveal:false,
    policy:{ deviceOnce:true, nameOnce:false }, timer:0, questions:[]
  }, { merge:true });
  const col = firebase.firestore().collection(window.db, 'rooms', roomId, 'responses');
  const snap = await firebase.firestore().getDocs(col);
  await Promise.all(snap.docs.map(d=>firebase.firestore().deleteDoc(d.ref)));
  alert('초기화 완료');
}

// --- 이벤트 바인딩 ---------------------------------------------------------
function bind(){
  // 모드
  const role = new URL(location.href).searchParams.get('role');
  if (role==='student') setMode('student'); else setMode('admin');

  // 세션
  els.btnConnect   && els.btnConnect.addEventListener('click', connect);
  els.btnSignOut   && els.btnSignOut.addEventListener('click', signOut);

  // 탭
  [els.tabBuild, els.tabOptions, els.tabPresent, els.tabResults].forEach(btn=>{
    btn && btn.addEventListener('click', ()=>{
      const target = btn.dataset.tab;
      $$('.tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      Object.entries(els.panels).forEach(([name, el])=> el && el.classList.toggle('hide', name!==target));
    });
  });

  // 빌더
  els.btnBuildForm && els.btnBuildForm.addEventListener('click', ()=>{
    const n = Math.max(1, Math.min(50, parseInt(els.questionCount?.value,10)||3));
    if (els.builder){ els.builder.innerHTML=''; for(let i=0;i<n;i++) els.builder.appendChild(cardRow(i+1)); }
  });
  els.btnLoadSample && els.btnLoadSample.addEventListener('click', ()=>{
    const S=[
      {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
      {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
      {type:'mcq', text:'태양계 별명?', options:['Milky','Solar','Sunset','Lunar'], answerIndex:1},
    ];
    if (els.builder){ els.builder.innerHTML=''; S.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q))); }
    if (els.quizTitle) els.quizTitle.value='샘플 퀴즈';
    if (els.questionCount) els.questionCount.value=S.length;
  });
  els.btnSaveQuiz && els.btnSaveQuiz.addEventListener('click', async ()=>{
    if (!roomId) return alert('세션에 먼저 접속하세요.');
    const payload = collectBuilder();
    const ref = firebase.firestore().doc(window.db, 'rooms', roomId);
    await firebase.firestore().setDoc(ref, { title:payload.title, questions:payload.questions }, { merge:true });
    alert('저장 완료');
  });

  // 옵션
  els.btnOptSave && els.btnOptSave.addEventListener('click', saveOptions);
  els.btnResetAll && els.btnResetAll.addEventListener('click', resetAll);

  // QR
  els.btnCopyLink && els.btnCopyLink.addEventListener('click', async ()=>{
    await navigator.clipboard.writeText(els.studentLink?.value||'');
    els.btnCopyLink.textContent='복사됨'; setTimeout(()=> els.btnCopyLink.textContent='복사', 1200);
  });
  els.btnOpenStudent && els.btnOpenStudent.addEventListener('click', ()=> window.open(els.studentLink?.value||'#', '_blank'));

  // 진행
  els.btnStart && els.btnStart.addEventListener('click', startQuiz);
  els.btnPrev  && els.btnPrev.addEventListener('click', ()=>step(-1));
  els.btnNext  && els.btnNext.addEventListener('click', ()=>step(+1));
  els.btnEndAll&& els.btnEndAll.addEventListener('click', finishAll);

  // 학생
  els.btnJoin && els.btnJoin.addEventListener('click', join);
  els.btnShortSend && els.btnShortSend.addEventListener('click', ()=> submit((els.shortInput?.value||'').trim()));
}

// --- 부팅 ------------------------------------------------------------------
function autoReconnect(){
  loadLocal();
  setMode(new URL(location.href).searchParams.get('role')==='student' ? 'student' : MODE);
  if (roomId) connect();
}
document.addEventListener('DOMContentLoaded', ()=>{ bind(); autoReconnect(); });
