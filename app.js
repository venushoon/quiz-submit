/* app.js — 안정화판 */
// ===== 유틸 =====
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

// 전역 대기 헬퍼(특정 전역이 생길 때까지 대기)
function waitForGlobal(name, {tries=40, interval=100}={}) {
  return new Promise((resolve, reject)=>{
    let n=0;
    const t=setInterval(()=>{
      if (window[name]) { clearInterval(t); resolve(window[name]); }
      else if(++n>=tries){ clearInterval(t); reject(new Error(`${name} not loaded`)); }
    }, interval);
  });
}

// Firebase 준비 확인
async function ensureFirebaseReady() {
  if (!window.firebase) throw new Error('[firebase] not loaded. Ensure compat scripts are included in index.html');
  if (!firebase.apps.length) {
    // 👉 필요한 실제 설정으로 바꾸세요
    const cfg = {
      apiKey:      "AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo",
      authDomain:  "live-quiz-a14d1.firebaseapp.com",
      projectId:   "live-quiz-a14d1",
    };
    firebase.initializeApp(cfg);
  }
  return firebase.firestore();
}

// ===== 상태 =====
let db, roomId = '', unsubRoom = null, unsubResp = null;
let MODE = 'admin';                 // 기본은 관리자 시작
let ME = { name: '', submitted:false, answer:null };

// ===== DOM 바인딩(핵심 id만) =====
const els = {
  // 공통 / 헤더
  roomInput:    $('#roomId'),
  btnConnect:   $('#btnConnect'),
  roomStatus:   $('#roomStatus'),
  liveDot:      $('#liveDot'),
  // 탭/패널
  panelBuild:   $('#panelBuild'),
  panelOptions: $('#panelOptions'),
  panelPresent: $('#panelPresent'),
  panelResults: $('#panelResults'),

  // 옵션 → 학생 접속
  studentAccess: $('#studentAccess'),
  qrCanvas:     $('#qrCanvas'),
  studentLink:  $('#studentLink'),
  btnCopyLink:  $('#btnCopyLink'),
  btnOpenStd:   $('#btnOpenStudent'),

  // 프레젠테이션
  btnStart:     $('#btnStart'),
  btnPrev:      $('#btnPrev'),
  btnNext:      $('#btnNext'),
  btnEndAll:    $('#btnEndAll'),
  presentWait:  $('#presentWait'),
  pTitle:       $('#pTitle'),
  pQ:           $('#pQ'),
  pImg:         $('#pImg'),
  pOpts:        $('#pOpts'),
  leftSec:      $('#leftSec'),

  // 통계 칩
  statJoin:     $('#statJoin'),
  statSubmit:   $('#statSubmit'),
  statCorrect:  $('#statCorrect'),
  statWrong:    $('#statWrong'),

  // 학생 화면
  sRoot:        $('#studentRoot'),
  aRoot:        $('#adminRoot'),
  sName:        $('#sName'),
  sBtnJoin:     $('#sBtnJoin'),
  sQTitle:      $('#sQTitle'),
  sQText:       $('#sQText'),
  sMcqBox:      $('#sMcqBox'),
  sMcq:         $('#sMcq'),
  sMcqSubmit:   $('#sMcqSubmit'),
  sShort:       $('#sShort'),
  sShortInput:  $('#sShortInput'),
  sShortSend:   $('#sShortSend'),
  sResult:      $('#sResult'),
  sHint:        $('#sHint'),
};

// ===== 모드 전환 =====
function setMode(m){
  MODE = m;
  const isAdmin = (m==='admin');
  // 헤더/탭/패널 토글(디자인 CSS의 .admin-only를 그대로 사용)
  $$('.admin-only').forEach(x=>x.classList.toggle('hide', !isAdmin)); //  [oai_citation:2‡app(디자인).css](file-service://file-Sf7FCSTC9vY7r1o2bU3t34)
  els.aRoot?.classList.toggle('hide', !isAdmin);
  els.sRoot?.classList.toggle('hide',  isAdmin);
}

// ===== QR/링크 빌드 =====
async function buildStudentLink() {
  await waitForGlobal('QRCode');            // QRCode 로딩 대기
  const base = location.origin + location.pathname;
  const url  = `${base}?role=student&room=${encodeURIComponent(roomId)}`;
  if (els.studentLink) els.studentLink.value = url;
  if (els.qrCanvas) {
    const canvas = els.qrCanvas;
    const size = 220;
    canvas.width = size; canvas.height = size;
    await QRCode.toCanvas(canvas, url, { width:size, margin:1 });
  }
}

// ===== Firestore 헬퍼 =====
const roomRef = id => db.collection('rooms').doc(id);
const respCol = id => roomRef(id).collection('responses');

// ===== 방 보장 + 리스너 =====
async function ensureRoom(id){
  const snap = await roomRef(id).get();
  if(!snap.exists){
    await roomRef(id).set({
      title:'새 세션',
      mode:'idle',              // idle → active → ended
      currentIndex:-1,
      accept:false, reveal:false, bright:false,
      timerSec:30,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      questions: []            // 저장 버튼으로 채워질 배열
    }, {merge:true});
  }
}
function listenRoom(id){
  unsubRoom && unsubRoom();
  unsubRoom = roomRef(id).onSnapshot(s=>{
    if(!s.exists) return;
    const r = s.data();
    renderRoom(r);
  });
}
function listenResponses(id){
  unsubResp && unsubResp();
  unsubResp = respCol(id).onSnapshot(qs=>{
    const arr=[]; qs.forEach(d=>arr.push({id:d.id, ...d.data()}));
    renderResponses(arr);
  });
}

// ===== 렌더링(요약판: DOM id 유지) =====
function renderRoom(r){
  // 모드별 안내
  if(MODE==='admin'){
    // 프레젠테이션 대기 문구 / 문항 표시
    const waiting = (r.mode!=='active' || r.currentIndex<0);
    els.presentWait?.classList.toggle('hide', !waiting);
    // 문항 표시
    if (!waiting) {
      const q = r.questions[r.currentIndex] || {};
      els.pTitle && (els.pTitle.textContent = r.title || '퀴즈');
      els.pQ     && (els.pQ.textContent     = q.text || '');
      if (els.pImg) {
        els.pImg.classList.toggle('hide', !q.image);
        if (q.image) els.pImg.src = q.image;
      }
      // 보기
      if (els.pOpts) {
        els.pOpts.innerHTML = '';
        (q.options||[]).forEach((t,i)=>{
          const b = document.createElement('button');
          b.className='btn ghost';
          b.textContent = `${i+1}. ${t}`;
          els.pOpts.appendChild(b);
        });
      }
    }
  } else {
    // 학생 측
    const waiting = (r.mode!=='active' || r.currentIndex<0);
    // 대기 메시지
    if (waiting){
      els.sQTitle.textContent = '대기 중…';
      els.sQText.textContent  = '참가 완료! 교사가 시작하면 1번 문항이 표시됩니다.';
      els.sMcqBox.classList.add('hide');
      els.sShort.classList.add('hide');
      return;
    }
    const q = r.questions[r.currentIndex] || {};
    els.sQTitle.textContent = `Q${r.currentIndex+1}`;
    els.sQText.textContent  = q.text || '';
    // 유형 분기
    if (q.type==='mcq'){
      els.sShort.classList.add('hide');
      els.sMcqBox.classList.remove('hide');
      // 보기 새로 그림 + 제출 버튼 제어
      els.sMcq.innerHTML='';
      (q.options||[]).forEach((t,i)=>{
        const li=document.createElement('button');
        li.className='btn ghost';
        li.textContent = `${i+1}. ${t}`;
        li.onclick=()=>{ ME.answer=i; els.sMcqSubmit.disabled=false; };
        els.sMcq.appendChild(li);
      });
      els.sMcqSubmit.disabled = (ME.answer==null);
    }else{
      els.sMcqBox.classList.add('hide');
      els.sShort.classList.remove('hide');
      els.sShortInput.value='';
    }
  }
}

function renderResponses(list){
  // 통계칩 간단 반영
  const joins   = list.filter(x=>x.type==='join').length;
  const submits = list.filter(x=>x.type==='submit').length;
  const correct = list.filter(x=>x.result==='correct').length;
  const wrong   = list.filter(x=>x.result==='wrong').length;
  if (els.statJoin)    els.statJoin.textContent    = joins;
  if (els.statSubmit)  els.statSubmit.textContent  = submits;
  if (els.statCorrect) els.statCorrect.textContent = correct;
  if (els.statWrong)   els.statWrong.textContent   = wrong;
}

// ===== 동작 =====
async function connect(){
  try{
    db = await ensureFirebaseReady();
    roomId = (els.roomInput?.value||'').trim();
    if(!roomId) return;
    await ensureRoom(roomId);
    setMode('admin');                                 // 연결하면 관리자 유지
    els.roomStatus && (els.roomStatus.textContent = `세션: ${roomId} · 온라인`);
    els.liveDot    && (els.liveDot.style.background = '#22c55e');
    listenRoom(roomId);
    listenResponses(roomId);
    await buildStudentLink();
  }catch(e){
    console.error(e);
    alert(e.message);
  }
}

// 시작/다음/이전/종료
async function startQuiz(){
  await roomRef(roomId).set({ mode:'active', currentIndex:0 }, {merge:true});
}
async function nextQ(){
  const snap = await roomRef(roomId).get();
  if(!snap.exists) return;
  const r=snap.data();
  const ni = Math.min((r.currentIndex||0)+1, (r.questions?.length||1)-1);
  await roomRef(roomId).set({ currentIndex:ni }, {merge:true});
}
async function prevQ(){
  const snap = await roomRef(roomId).get();
  if(!snap.exists) return;
  const r=snap.data();
  const pi = Math.max((r.currentIndex||0)-1, 0);
  await roomRef(roomId).set({ currentIndex:pi }, {merge:true});
}
async function endAll(){
  await roomRef(roomId).set({ mode:'ended' }, {merge:true});
}

// 학생 참가/제출
async function studentJoin(){
  ME.name = (els.sName?.value||'').trim();
  if(!ME.name){ alert('이름(번호)을 입력하세요.'); return; }
  await respCol(roomId).add({ type:'join', name:ME.name, ts:firebase.firestore.FieldValue.serverTimestamp() });
  els.sHint.textContent = '참가 완료! 교사가 시작하면 1번 문항이 표시됩니다.';
}
async function submitMCQ(){
  if (ME.submitted) return;
  const snap = await roomRef(roomId).get();
  if(!snap.exists) return;
  const r=snap.data(); const q=r.questions[r.currentIndex]||{};
  const isCorrect = (ME.answer===q.answer);
  await respCol(roomId).add({
    type:'submit', name:ME.name, q:r.currentIndex, ans:ME.answer,
    result: isCorrect?'correct':'wrong',
    ts: firebase.firestore.FieldValue.serverTimestamp()
  });
  ME.submitted = true;
  els.sHint.textContent = isCorrect?'정답!':'오답 ㅠ';
}
async function submitShort(){
  if (ME.submitted) return;
  const val = (els.sShortInput?.value||'').trim();
  if(!val) return;
  const snap = await roomRef(roomId).get();
  if(!snap.exists) return;
  const r=snap.data(); const q=r.questions[r.currentIndex]||{};
  const isCorrect = (val === String(q.answer||'').trim());
  await respCol(roomId).add({
    type:'submit', name:ME.name, q:r.currentIndex, ans:val,
    result: isCorrect?'correct':'wrong',
    ts: firebase.firestore.FieldValue.serverTimestamp()
  });
  ME.submitted = true;
  els.sHint.textContent = isCorrect?'정답!':'오답 ㅠ';
}

// 이벤트 바인딩
function bindEvents(){
  els.btnConnect?.addEventListener('click', connect);
  els.btnStart?.addEventListener('click', startQuiz);
  els.btnNext ?.addEventListener('click', nextQ);
  els.btnPrev ?.addEventListener('click', prevQ);
  els.btnEndAll?.addEventListener('click', endAll);

  els.sBtnJoin   ?.addEventListener('click', studentJoin);
  els.sMcqSubmit ?.addEventListener('click', submitMCQ);
  els.sShortSend ?.addEventListener('click', submitShort);

  els.btnCopyLink?.addEventListener('click', ()=>{
    if (!els.studentLink) return;
    els.studentLink.select(); document.execCommand('copy');
  });
  els.btnOpenStd?.addEventListener('click', ()=>{
    if (!els.studentLink) return;
    window.open(els.studentLink.value, '_blank');
  });
}

// 초기 진입(교사 기본, 학생 전용 링크는 role=student)
async function init(){
  bindEvents();
  // role 파라미터 검사
  const params = new URLSearchParams(location.search);
  const role  = params.get('role');
  if (role==='student'){
    setMode('student');                           // 학생 전용
    roomId = params.get('room')||'';
    if (!roomId){
      els.sQText.textContent = '잘못된 링크입니다. QR을 다시 확인하세요.';
      return;
    }
    db = await ensureFirebaseReady();
    listenRoom(roomId);
    listenResponses(roomId);
    els.sHint.textContent = '이름을 입력하고 참가를 눌러 주세요.';
    return;
  }
  // 교사 기본
  setMode('admin');                               // 관리자 기본 시작
  els.roomStatus && (els.roomStatus.textContent = '오프라인');
}

document.addEventListener('DOMContentLoaded', init);
