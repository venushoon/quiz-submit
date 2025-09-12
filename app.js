/* -------------------------------------------
 * app.js (최종)
 * ------------------------------------------*/

const $  = (s) => document.querySelector(s);
const qs = (s, r=document) => r.querySelector(s);
const qsa= (s, r=document) => Array.from(r.querySelectorAll(s));

const url  = new URL(location.href);
const ROLE = url.searchParams.get('role') || 'admin';   // 'admin' | 'student'
const ROOM = url.searchParams.get('room') || '';
let   USER = url.searchParams.get('user') || '';

/* 학생 UI 숨김(디자인 보존) */
if (ROLE === 'student') document.documentElement.classList.add('student');

/* ---------- Firebase 초기화 ---------- */
if (!window.firebase || !firebase.firestore) {
  console.error('[firebase] not loaded. Ensure compat scripts are included in index.html');
}

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_AUTH_DOMAIN",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_BUCKET",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
};

let db = null;
try {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
} catch (e) {
  console.error('[firebase init error]', e);
}

const roomRef = (roomId) => {
  if (!roomId) throw new Error('room id empty');
  return db.collection('rooms').doc(roomId);
};
const respCol = (roomId) => roomRef(roomId).collection('responses');

const state = {
  room: null,
  roomUnsub: null,
  respUnsub: null,
  allowSubmit: true,
};

/* ---------- 초기 진입 ---------- */
document.addEventListener('DOMContentLoaded', init);

function withParam(patch) {
  const u = new URL(location.href);
  Object.entries(patch).forEach(([k,v])=>{
    if (v==='' || v==null) u.searchParams.delete(k);
    else u.searchParams.set(k,v);
  });
  return u.toString();
}

async function init(){
  const inp = $('#sessionInput');
  const bIn = $('#btnConnect');
  const bOut= $('#btnLogout');

  if (bIn){
    bIn.onclick = ()=>{
      const room = (inp?.value||'').trim();
      if (!room) return alert('세션 코드를 입력하세요');
      location.href = withParam({ room, role: ROLE });
    };
  }
  if (bOut){
    bOut.onclick = ()=>{
      state.roomUnsub && state.roomUnsub();
      state.respUnsub && state.respUnsub();
      location.href = withParam({ room:'' });
    };
  }

  if (ROLE === 'admin') await bootAdmin();
  else await bootStudent();
}

/* ---------- 문항 (샘플) ---------- */
function getQuestionsFromForm(){
  // 실제에선 폼에서 읽어오면 됨. 여기서는 샘플 3문항 고정
  return [
    { title:'샘플 퀴즈', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answer:2, image:'' },
    { title:'샘플 퀴즈', text:'대한민국의 수도는?', options:['부산','인천','서울','대전'], answer:3, image:'' },
    { title:'샘플 퀴즈', text:'태양은 어떤 천체?', options:['행성','위성','혜성','항성'], answer:4, image:'' },
  ];
}

/* ---------- 관리자 ---------- */
async function bootAdmin(){
  const roomId = ROOM || ($('#sessionInput')?.value || '').trim();
  if (!roomId) return;

  // 방 생성(대기)
  await roomRef(roomId).set({
    mode:'idle', currentIndex:-1, accept:true, updatedAt: Date.now()
  }, { merge:true });

  wireAdminButtons(roomId);

  state.roomUnsub = roomRef(roomId).onSnapshot(snap=>{
    state.room = snap.data() || null;
    renderAdmin(roomId, state.room);
  }, console.error);

  // 옵션 스위치
  const chkAllow = $('#chkAllow');
  chkAllow && (chkAllow.onchange = (e)=> state.allowSubmit = !!e.target.checked);
}

function wireAdminButtons(roomId){
  const bS = $('#btnStart');
  const bP = $('#btnPrev');
  const bN = $('#btnNext');
  const bE = $('#btnEnd');

  bS && (bS.onclick = async()=>{
    await roomRef(roomId).set({ mode:'active', currentIndex:0, updatedAt:Date.now() }, { merge:true });
  });
  bP && (bP.onclick = async()=>{
    const i = Math.max(0, (state.room?.currentIndex ?? 0)-1);
    await roomRef(roomId).set({ currentIndex:i, updatedAt:Date.now() }, { merge:true });
  });
  bN && (bN.onclick = async()=>{
    const i = (state.room?.currentIndex ?? -1)+1;
    await roomRef(roomId).set({ currentIndex:i, updatedAt:Date.now() }, { merge:true });
  });
  bE && (bE.onclick = async()=>{
    await roomRef(roomId).set({ mode:'ended', updatedAt:Date.now() }, { merge:true });
  });
}

function renderAdmin(roomId, room){
  $('#statusLabel') && ($('#statusLabel').textContent =
    `세션: ${ROOM||roomId} · ${room?.mode||'idle'} · Q${(room?.currentIndex??-1)+1}`);

  const title = $('#pTitle'), stem = $('#pStem'), img = $('#pImg');
  const opts = qsa('.pOption');
  if (!title || !stem || !img || !opts.length) return;

  const idx  = room?.currentIndex ?? -1;
  const mode = room?.mode || 'idle';

  if (mode!=='active' || idx<0){
    title.textContent = '시작 버튼을 누르면 문항이 제시됩니다.';
    stem.textContent='';
    img.style.display='none';
    opts.forEach(b=>{ b.textContent=''; b.disabled=true; });
    $('#badgeIndex') && ($('#badgeIndex').textContent='Q0/0');
    return;
  }

  const qs = getQuestionsFromForm();
  const q  = qs[idx];
  if (!q){
    roomRef(roomId).set({ mode:'ended', updatedAt:Date.now() }, { merge:true });
    return;
  }
  title.textContent = q.title || '퀴즈';
  stem.textContent  = q.text || '';
  if (q.image){ img.src=q.image; img.style.display=''; } else img.style.display='none';
  q.options?.forEach((t,i)=>{ if(opts[i]){ opts[i].textContent = `${i+1}. ${t}`; opts[i].disabled=true; } });
  $('#badgeIndex') && ($('#badgeIndex').textContent=`Q${idx+1}/${qs.length}`);
}

/* ---------- 학생 ---------- */
async function bootStudent(){
  const roomId = ROOM;
  if (!roomId) return; // 세션 파라미터 없으면 입력만 보여짐

  const joinModal = $('#joinModal'), joinName = $('#joinName'), btnJoin = $('#btnJoin');
  const showJoin = ()=> joinModal && (joinModal.style.display='');
  const hideJoin = ()=> joinModal && (joinModal.style.display='none');

  const doJoin = async ()=>{
    USER = (joinName?.value || '').trim();
    if (!USER) return alert('이름(번호)을 입력하세요.');
    await respCol(roomId).doc(USER).set({ name: USER }, { merge:true });
    hideJoin();
  };

  if (!USER) { showJoin(); btnJoin && (btnJoin.onclick=doJoin); }

  state.roomUnsub = roomRef(roomId).onSnapshot(snap=>{
    state.room = snap.data() || null;
    renderStudent(roomId, state.room);
  }, console.error);
}

function renderStudent(roomId, room){
  const sWait = $('#sWait'), sWrap = $('#sQWrap'), sEnded = $('#sEnded');
  const sTitle= $('#sTitle'), sStem = $('#sStem'), sImg = $('#sImg');
  const sOpts = qsa('.sOption'), sAnswer = $('#sAnswer'), sSubmit = $('#sSubmit');

  if (!sWrap || !sSubmit) return;

  const mode = room?.mode || 'idle';
  const idx  = room?.currentIndex ?? -1;

  if (mode==='ended'){
    sWrap.style.display='none'; sWait.style.display='none'; sEnded.style.display='';
    return;
  }
  if (mode!=='active' || idx<0){
    sWrap.style.display='none'; sEnded.style.display='none'; sWait.style.display='';
    sWait.textContent='참가 완료! 교사가 시작하면 1번 문항이 표시됩니다.';
    return;
  }

  sWait.style.display='none'; sEnded.style.display='none'; sWrap.style.display='';

  const qs = getQuestionsFromForm();
  const q  = qs[idx];
  if (!q) return;

  sTitle.textContent = q.title || '퀴즈';
  sStem.textContent  = q.text || '';
  if (q.image){ sImg.src=q.image; sImg.style.display=''; } else sImg.style.display='none';

  const isMCQ = Array.isArray(q.options) && q.options.length>0;
  if (isMCQ){
    let picked = null;
    sAnswer.style.display='none';
    sOpts.forEach((b,i)=>{
      b.style.display=''; b.classList.remove('active');
      b.textContent = `${i+1}. ${q.options[i] || ''}`;
      b.onclick = ()=>{ picked=i+1; sOpts.forEach(x=>x.classList.remove('active')); b.classList.add('active'); };
    });
    sSubmit.onclick = async ()=>{
      if (!state.allowSubmit) return alert('제출이 허용되지 않습니다.');
      if (!picked) return alert('보기를 선택하세요.');
      await saveAnswer(roomId, USER, idx, picked, q.answer);
      toast('제출되었습니다.');
    };
  } else {
    sOpts.forEach(b=>b.style.display='none');
    sAnswer.style.display=''; sAnswer.value='';
    sSubmit.onclick = async ()=>{
      const v = (sAnswer.value||'').trim();
      if (!v) return alert('정답을 입력하세요.');
      await saveAnswer(roomId, USER, idx, v, q.answer);
      toast('제출되었습니다.');
    };
  }
}

async function saveAnswer(roomId, user, qIndex, value, right){
  if (!roomId || !user) return;
  const ok = (''+value) === (''+right);
  await respCol(roomId).doc(user).set({
    name: user,
    answers: firebase.firestore.FieldValue.arrayUnion({
      i:qIndex, v:value, ok, ts: Date.now()
    })
  }, { merge:true });
}

function toast(msg){
  let el = $('#toast');
  if (!el){ el=document.createElement('div'); el.id='toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.style.cssText = 'position:fixed;left:50%;bottom:40px;transform:translateX(-50%);padding:10px 14px;background:#2d6cdf;color:#fff;border-radius:10px;z-index:9999';
  setTimeout(()=> el.remove(), 1200);
}
