// --- compat 준비 점검(최상단에 추가) ---
if (!window.firebase || !window.db || !window.FS) {
  throw new Error("[firebase] not loaded. Ensure compat scripts and window.db/FS are set before app.js");
}

// Firestore API 단축 (compat)
const { doc, collection, setDoc, getDoc, getDocs,
        onSnapshot, updateDoc, runTransaction, serverTimestamp } = window.FS;

// QRCode 안전 가드 (없어도 앱이 죽지 않게)
function safeQRCode(canvasEl, text, opts = { width: 140 }) {
  if (!window.QRCode || !canvasEl) return;
  try { window.QRCode.toCanvas(canvasEl, text, opts); } catch(e) { console.warn(e); }
}

function initialRoute() {
  const sp = new URLSearchParams(location.search);
  const role = (sp.get("role") || "").toLowerCase();
  const urlRoom = (sp.get("room") || "").trim();

  if (role === "student") {
    // 학생 진입: 관리자 UI 모두 숨김, 이름 입력 → 대기
    setMode("student");                 // .admin-only 숨김, 학생 패널 노출
    if (urlRoom) {
      roomId = urlRoom;
      listenRoom(roomId);
      listenResponses(roomId);
    }
    // 학생은 첫 화면에 이름 입력 모달만
    els.joinModal.classList.remove("hide");
    els.sWrap.classList.add("hide");
  } else {
    // 기본은 관리자
    setMode("admin");                   // 문항 탭으로
    if (roomId) {                       // 로컬 저장값 있으면 자동 복구
      connect();
    } else {
      showTab("build");                 // 첫 화면은 문항 탭
    }
  }
}

function buildStudentLink() {
  if (!roomId || !els.studentLink) return;
  const url = new URL(location.href);
  url.searchParams.set("role", "student");
  url.searchParams.set("room", roomId);
  const s = url.toString();
  els.studentLink.value = s;

  // 여기만 써도 돼
  safeQRCode(els.qrCanvas, s, { width: 140 });
}

async function startQuiz(){
  if (!roomId) return alert("세션에 먼저 접속하세요.");
  await updateDoc(doc(window.db, "rooms", roomId), {
    mode: "active", currentIndex: 0, accept: true
  });
}

document.addEventListener("DOMContentLoaded", () => {
  // 로컬 복구
  try {
    const saved = JSON.parse(localStorage.getItem("quiz.live") || "{}");
    if (saved.roomId) {
      roomId = saved.roomId; els.roomId.value = roomId;
    }
  } catch {}

  // 기본 심장박동 오프라인
  heartbeatOnline(false);

  // URL → 라우팅
  initialRoute();
});

/* ========= quiz-submit / app.js (drop-in) =========
   - 기본 시작: 관리자 모드
   - 학생 링크: ?role=student&room=xxx
   - Firebase compat 순서로 로드 필수 (index.html에 이미 추가)
====================================================*/

/* 유틸 */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* Firebase 준비 확인 */
function ensureFirebase(){
  if(!(window.firebase && firebase.firestore)) {
    throw new Error("[firebase] not loaded. Ensure compat scripts are included in index.html");
  }
}
ensureFirebase();

/* Firestore */
const db = firebase.firestore();
let unsubRoom=null, unsubResp=null, timerHandle=null;

/* 상태 */
let MODE='admin';        // 'admin' | 'student'
let roomId='';
let me={ id:null, name:'' };
let sSelectedIdx=null;

/* 요소 맵(디자인 파일의 id를 그대로 사용) */
const els = {
  // 상단/세션
  roomId:        $('#roomId'),
  btnConnect:    $('#btnConnect'),
  btnSignOut:    $('#btnSignOut'),
  roomStatus:    $('#roomStatus'),
  liveDot:       $('#liveDot'),
  // 탭(관리자)
  tabBuild:      $('#tabBuild'),
  tabOptions:    $('#tabOptions'),
  tabPresent:    $('#tabPresent'),
  tabResults:    $('#tabResults'),
  panelBuild:    $('#panelBuild'),
  panelOptions:  $('#panelOptions'),
  panelPresent:  $('#panelPresent'),
  panelResults:  $('#panelResults'),
  // 옵션-학생 접속
  studentAccess: $('#studentAccess'),
  qrCanvas:      $('#qrCanvas'),
  studentLink:   $('#studentLink'),
  btnCopyLink:   $('#btnCopyLink'),
  btnOpenStudent:$('#btnOpenStudent'),
  // 프레젠테이션
  btnStart:      $('#btnStart'),
  btnPrev:       $('#btnPrev'),
  btnNext:       $('#btnNext'),
  btnEndAll:     $('#btnEndAll'),
  leftSec:       $('#leftSec'),
  pTitle:        $('#pTitle'),
  pQ:           $('#pQ'),
  pImg:         $('#pImg'),
  pOpts:        $('#pOpts'),
  presentWait:  $('#presentWait'),
  // 집계 칩
  statJoin:     $('#statJoin'),
  statSubmit:   $('#statSubmit'),
  statCorrect:  $('#statCorrect'),
  statWrong:    $('#statWrong'),
  // 결과
  btnExportCSV: $('#btnExportCSV'),
  btnResetAll:  $('#btnResetAll'),
  resultsTable: $('#resultsTable'),
  // 학생 전용
  studentPanel: $('#studentPanel'),
  studentTopInfo: $('#studentTopInfo'),
  studentJoin:  $('#studentJoin'),
  studentName:  $('#studentName'),
  btnJoin:      $('#btnJoin'),
  studentQuiz:  $('#studentQuiz'),
  sQTitle:      $('#sQTitle'),
  sQText:       $('#sQText'),
  mcqBox:       $('#mcqBox'),
  btnSubmitMCQ: $('#btnSubmitMCQ'),
  shortBox:     $('#shortBox'),
  shortInput:   $('#shortInput'),
  btnShortSend: $('#btnShortSend'),
  studentDone:  $('#studentDone'),
  studentResult:    $('#studentResult'),
  studentResultBody:$('#studentResultBody'),
  studentTimer: $('#studentTimer'),
  sImg:         $('#sImg')
};

/* ---------- Firestore refs/helpers ---------- */
const roomRef = id => firebase.firestore().doc(db, 'rooms/'+id) || db.doc('rooms/'+id); // 호환
const respCol = id => db.collection('rooms/'+id+'/responses');

async function ensureRoom(id){
  const snap = await db.doc('rooms/'+id).get();
  if(!snap.exists){
    await db.doc('rooms/'+id).set({
      title:'새 세션',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      mode:'idle',            // idle | active | ended
      currentIndex:-1,
      accept:false,
      reveal:false,
      bright:false,
      policy:'device',
      timerSec:30,
      questions:[]
    });
  }
}
function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom = db.doc('rooms/'+id).onSnapshot(snap=>{
    if(!snap.exists) return;
    const r = snap.data();
    window.__room = r;
    renderRoom(r);
  });
}
function listenResponses(id){
  if(unsubResp) unsubResp();
  unsubResp = db.collection('rooms/'+id+'/responses').onSnapshot(qs=>{
    const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    renderResponses(arr);
  });
}

/* ---------- 모드/탭 제어 ---------- */
function setMode(m){
  MODE=m;
  const isAdmin = (m==='admin');
  $$('.admin-only').forEach(x=>x.classList.toggle('hide', !isAdmin));          // 관리자 UI 토글   [oai_citation:2‡app(디자인).css](file-service://file-Sf7FCSTC9vY7r1o2bU3t34)
  [els.panelBuild,els.panelOptions,els.panelPresent,els.panelResults].forEach(x=>x?.classList.toggle('hide', !isAdmin)); // 관리자 패널 숨김   [oai_citation:3‡app (1).js](file-service://file-GjJRyRELLk1vGBXzMaEJyu)
  els.studentPanel?.classList.toggle('hide', isAdmin);                         // 학생 패널 반전      [oai_citation:4‡app (1).js](file-service://file-GjJRyRELLk1vGBXzMaEJyu)
  els.studentAccess?.classList.add('hide');                                    // 학생접속 박스 기본 숨김 (옵션 탭에서만)  [oai_citation:5‡app (4).js](file-service://file-97WZcKsxmHAwFbQgmDweH9)
  els.studentTopInfo && (els.studentTopInfo.textContent = roomId?`세션: ${roomId} · 온라인`:'세션: - · 오프라인');
}
function switchTab(btn){
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove('active'));
  btn?.classList.add('active');
  const name = btn?.dataset.tab;
  [els.panelBuild,els.panelOptions,els.panelPresent,els.panelResults].forEach(p=>p?.classList.add('hide'));
  if(name==='build')   els.panelBuild?.classList.remove('hide');
  if(name==='options') els.panelOptions?.classList.remove('hide');
  if(name==='present') els.panelPresent?.classList.remove('hide');
  if(name==='results') els.panelResults?.classList.remove('hide');
  els.studentAccess && (els.studentAccess.style.display = name==='options' ? '' : 'none');  // 옵션 탭에서만 표시  [oai_citation:6‡app (4).js](file-service://file-97WZcKsxmHAwFbQgmDweH9)
}

/* ---------- 접속/해제 ---------- */
async function connect(){
  const id=(els.roomId?.value||'').trim();
  if(!id) return alert('세션 코드를 입력하세요.');
  roomId=id;
  await ensureRoom(roomId);
  listenRoom(roomId);
  listenResponses(roomId);

  // 상단 상태
  els.roomId.disabled=true;
  els.btnConnect?.classList.add('hide');
  els.btnSignOut?.classList.remove('hide');
  els.roomStatus&&(els.roomStatus.textContent=`세션: ${roomId} · 온라인`);
  els.liveDot&&(els.liveDot.style.background='#ef4444');

  buildStudentLink();
}
function signOut(){
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  unsubRoom=unsubResp=null; roomId='';
  els.roomId && (els.roomId.disabled=false);
  els.btnSignOut?.classList.add('hide');
  els.btnConnect?.classList.remove('hide');
  els.roomStatus&&(els.roomStatus.textContent='세션: - · 오프라인');
  els.liveDot&&(els.liveDot.style.background='#555');
}

/* ---------- 옵션: 학생 링크/QR ---------- */
function buildStudentLink(){
  const base = location.origin+location.pathname;
  const url  = `${base}?role=student&room=${encodeURIComponent(roomId)}`;
  if(els.studentLink) els.studentLink.value = url;
  if(els.qrCanvas) { els.qrCanvas.innerHTML=''; QRCode.toCanvas(els.qrCanvas, url, {width:140}); }
}

/* ---------- 프레젠테이션(교사) 흐름 ---------- */
async function startQuiz(){
  sSelectedIdx=null;
  await db.doc('rooms/'+roomId).update({ mode:'active', currentIndex:0, accept:true });  // 시작→Q1 즉시    [oai_citation:7‡app.js](file-service://file-FbRFNvwdeUwZ18GGncKg5S)
}
async function step(delta){
  sSelectedIdx=null;
  await db.runTransaction(async tx=>{
    const ref=db.doc('rooms/'+roomId);
    const snap=await tx.get(ref); const r=snap.data();
    const total=(r.questions?.length||0); let next=(r.currentIndex??-1)+delta;
    if(next>=total){ tx.update(ref, { currentIndex: total-1, mode:'ended', accept:false }); activateTab(els.tabResults); return; } // 끝→결과   [oai_citation:8‡app.js](file-service://file-FbRFNvwdeUwZ18GGncKg5S)
    next=Math.max(0,next); tx.update(ref, { currentIndex: next, accept:true });
  });
}
async function finishAll(){
  if(confirm('퀴즈를 종료하고 결과 화면으로 이동할까요?')){
    await db.doc('rooms/'+roomId).update({ mode:'ended', accept:false });
    activateTab(els.tabResults);
  }
}

/* ---------- 렌더러(관리자/학생 공용) ---------- */
function safeText(t){ return (typeof t==='string') ? t : ''; }

function renderRoom(r){
  // 관리자: 대기/활성/종료 상태에 맞춰 프레젠테이션 UI 토글
  if(MODE==='admin'){
    if(r.mode==='active' && (r.currentIndex??-1) >= 0){
      els.presentWait?.classList.add('hide');
      els.pTitle && (els.pTitle.textContent = safeText(r.title||''));
      const q = (r.questions||[])[r.currentIndex] || {};
      els.pQ && (els.pQ.textContent = safeText(q.text));                           // text가 없을 때도 안전  (오류 해결)
      // 이미지(첨부 없으면 숨김)
      if(els.pImg){
        if(q.imgUrl) { els.pImg.src=q.imgUrl; els.pImg.classList.remove('hide'); }
        else          els.pImg.classList.add('hide');
      }
      // 객관식/주관식 렌더
      if(els.pOpts){
        els.pOpts.innerHTML='';
        if(q.type==='mcq'){
          (q.options||[]).forEach((opt, i)=>{
            const btn=document.createElement('button');
            btn.className='btn';
            btn.textContent=`${i+1}. ${opt}`;
            els.pOpts.appendChild(btn);
          });
        }
      }
    } else {
      // 아직 시작 전 → 대기 문구
      els.presentWait?.classList.remove('hide');
      if(els.pImg) els.pImg.classList.add('hide');
      if(els.pOpts) els.pOpts.innerHTML='';
    }
    // 집계 칩
    els.statJoin   && (els.statJoin.textContent   = String(r.joinCount||0));
    els.statSubmit && (els.statSubmit.textContent = String(r.submitCount||0));
    els.statCorrect&& (els.statCorrect.textContent= String(r.correctCount||0));
    els.statWrong  && (els.statWrong.textContent  = String(r.wrongCount||0));
  }

  // 학생: 모드에 따라 대기/문항/종료
  if(MODE==='student'){
    // 상단 관리자 UI를 전부 숨김 (.admin-only)
    $$('.admin-only').forEach(x=>x.classList.add('hide'));                          // 강제 숨김   [oai_citation:9‡app(디자인).css](file-service://file-Sf7FCSTC9vY7r1o2bU3t34)

    if(r.mode==='ended'){
      // 종료 후 “내 결과 보기”
      $('#studentDone')?.classList.remove('hide');
      $('#studentQuiz')?.classList.add('hide');
      $('#studentJoin')?.classList.add('hide');
      return;
    }

    // 아직 참가(이름 입력) 전
    if(!me.id){
      $('#studentJoin')?.classList.remove('hide');
      $('#studentQuiz')?.classList.add('hide');
      $('#studentDone')?.classList.add('hide');
      return;
    }

    // 참가 후: 교사가 시작할 때까지 대기 → 시작되면 Q1
    const qIdx = r.currentIndex??-1;
    if(r.mode!=='active' || qIdx<0){
      $('#studentQuiz')?.classList.add('hide');
      $('#studentDone')?.classList.add('hide');
      $('#studentJoin')?.classList.add('hide');
      $('#sQTitle') && ($('#sQTitle').textContent='대기 중…');
      $('#sQText')  && ($('#sQText').textContent='교사가 시작하면 1번 문항이 표시됩니다.');
      return;
    }

    // 활성: 문항 표시
    const q = (r.questions||[])[qIdx] || {};
    $('#studentJoin')?.classList.add('hide');
    $('#studentDone')?.classList.add('hide');
    $('#studentQuiz')?.classList.remove('hide');

    $('#sQTitle') && ($('#sQTitle').textContent = safeText(r.title||''));
    $('#sQText')  && ($('#sQText').textContent  = safeText(q.text||''));

    // 이미지(있을 때만)
    if(els.sImg){
      if(q.imgUrl){ els.sImg.src=q.imgUrl; els.sImg.classList.remove('hide'); }
      else         els.sImg.classList.add('hide');
    }

    // 보기/주관식 전환
    if(q.type==='mcq'){
      $('#mcqBox')?.classList.remove('hide');
      $('#shortBox')?.classList.add('hide');
      const box = $('#mcqBox .opts');
      if(box){
        box.innerHTML='';
        (q.options||[]).forEach((op,i)=>{
          const b=document.createElement('button');
          b.className='btn'; b.dataset.idx=String(i);
          b.textContent=`${i+1}. ${op}`;
          b.onclick=()=>{ sSelectedIdx=i; };
          box.appendChild(b);
        });
      }
    }else{
      $('#mcqBox')?.classList.add('hide');
      $('#shortBox')?.classList.remove('hide');
    }
  }
}

/* ---------- 학생 제출 ---------- */
function getMeId(){
  if(me.id) return me.id;
  me.id = (crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
  return me.id;
}
async function sJoin(){
  const name=(els.studentName?.value||'').trim();
  if(!name) return alert('이름(또는 번호)을 입력하세요.');
  me.name=name; getMeId();
  await db.doc(`rooms/${roomId}/responses/${me.id}`).set({
    name, joinedAt: firebase.firestore.FieldValue.serverTimestamp(), status:'joined'
  }, { merge:true });
}
async function submitMCQ(){
  if(sSelectedIdx==null) return alert('보기 하나를 선택하세요.');
  await db.doc(`rooms/${roomId}/responses/${getMeId()}`).set({
    lastSubmitAt: firebase.firestore.FieldValue.serverTimestamp(),
    answerIdx: sSelectedIdx, type:'mcq'
  }, { merge:true });
}
async function submitShort(){
  const text=(els.shortInput?.value||'').trim();
  if(!text) return alert('정답을 입력하세요.');
  await db.doc(`rooms/${roomId}/responses/${getMeId()}`).set({
    lastSubmitAt: firebase.firestore.FieldValue.serverTimestamp(),
    answerText: text, type:'short'
  }, { merge:true });
}

/* ---------- 결과/집계(표시는 기존 테이블 렌더 함수를 사용) ---------- */
function renderResponses(list){
  // 필요 시 집계 카운터 업데이트
  els.statJoin   && (els.statJoin.textContent   = String(list.filter(x=>x.status==='joined').length));
  els.statSubmit && (els.statSubmit.textContent = String(list.filter(x=>x.lastSubmitAt).length));
  // 정/오답 계산은 서버 채점 로직/스키마에 맞춰 기존 함수 사용
}

/* ---------- 탭/버튼 이벤트 바인딩 ---------- */
function bindEvents(){
  // 접속/해제
  els.btnConnect && (els.btnConnect.onclick = connect);
  els.btnSignOut && (els.btnSignOut.onclick = signOut);

  // 탭
  els.tabBuild   && (els.tabBuild.onclick   = ()=>switchTab(els.tabBuild));
  els.tabOptions && (els.tabOptions.onclick = ()=>switchTab(els.tabOptions));
  els.tabPresent && (els.tabPresent.onclick = ()=>switchTab(els.tabPresent));
  els.tabResults && (els.tabResults.onclick = ()=>switchTab(els.tabResults));

  // 프레젠테이션
  els.btnStart   && (els.btnStart.onclick   = startQuiz);
  els.btnPrev    && (els.btnPrev.onclick    = ()=>step(-1));
  els.btnNext    && (els.btnNext.onclick    = ()=>step(+1));
  els.btnEndAll  && (els.btnEndAll.onclick  = finishAll);

  // 학생
  els.btnJoin        && (els.btnJoin.onclick        = sJoin);
  els.btnSubmitMCQ   && (els.btnSubmitMCQ.onclick   = submitMCQ);
  els.btnShortSend   && (els.btnShortSend.onclick   = submitShort);

  // 옵션-학생 링크
  els.btnCopyLink && (els.btnCopyLink.onclick = ()=>{
    if(!els.studentLink) return;
    els.studentLink.select(); document.execCommand('copy');
  });
  els.btnOpenStudent && (els.btnOpenStudent.onclick = ()=>{
    if(!els.studentLink) return;
    window.open(els.studentLink.value, '_blank');
  });
}

/* ---------- 초기 진입: 관리자 기본 / 학생 파라미터 ---------- */
function init(){
  bindEvents();

  const params = new URLSearchParams(location.search);
  const role = params.get('role');
  const fromUrlRoom = params.get('room');

  // 기본은 관리자
  if(role==='student'){
    MODE='student';
    roomId = fromUrlRoom||'';
    setMode('student');                      // 학생 UI만 보여주기   [oai_citation:10‡app (1).js](file-service://file-GjJRyRELLk1vGBXzMaEJyu)
    if(roomId){ listenRoom(roomId); listenResponses(roomId); }
    // 이름 입력 먼저 → 참가 → 대기 → 교사 시작 시 Q1
    $('#studentJoin')?.classList.remove('hide');
    return;
  }

  // 관리자 기본 화면
  setMode('admin');
  if(els.tabBuild) switchTab(els.tabBuild);  // 처음엔 문항 탭
}
document.addEventListener('DOMContentLoaded', init);
