/* app.js (ES Module) — Firestore 완전 동작 */

// ======= Firebase 초기화 =======
// ※ 아래 구성은 질문에서 주신 값을 사용합니다. (추가 필드는 없어도 Firestore 동작합니다)
const firebaseConfig = {
  apiKey: "AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo",
  authDomain: "live-quiz-a14d1.firebaseapp.com",
  projectId: "live-quiz-a14d1",
};

// 전역 firebase compat SDK는 index.html에서 로드됨
const app = firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ======= DOM =======
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

const statusText = $('#statusText');
const btnConnect = $('#btnConnect');
const roomIdInput = $('#roomIdInput');
const btnTeacherMode = $('#btnTeacherMode');
const btnStudentMode = $('#btnStudentMode');

const tabs = $$('.tab');
const teacherPanel = $('#teacherPanel');
const studentPanel = $('#studentPanel');
const tabBuild = $('#tab-build');
const tabControl = $('#tab-control');
const tabResults = $('#tab-results');

const quizTitle = $('#quizTitle');
const questionCount = $('#questionCount');
const btnBuildForm = $('#btnBuildForm');
const btnLoadSample = $('#btnLoadSample');
const builder = $('#builder');
const btnSaveQuiz = $('#btnSaveQuiz');

const btnStart = $('#btnStart');
const btnStop = $('#btnStop');
const btnPrev = $('#btnPrev');
const btnNext = $('#btnNext');
const toggleAccept = $('#toggleAccept');
const ctlQuestion = $('#ctlQuestion');
const chipOk = $('#chipOk');
const chipNo = $('#chipNo');
const chipWait = $('#chipWait');
const shortGrader = $('#shortGrader');
const shortAnswers = $('#shortAnswers');
const chips = $('#chips');

const resultsContainer = $('#resultsContainer');
const btnExportCSV = $('#btnExportCSV');
const btnResetAll = $('#btnResetAll');

const studentQuizOptions = $('#optionsContainer');
const questionText = $('#questionText');
const progressText = $('#progressText');
const quizTypeBadge = $('#quizTypeBadge');
const subjectiveBox = $('#subjectiveBox');
const subjectiveInput = $('#subjectiveInput');
const btnSubmitSubjective = $('#btnSubmitSubjective');
const studentName = $('#studentName');
const btnJoin = $('#btnJoin');
const answerState = $('#answerState');

const qrBox = $('#qrBox');
const studentLinkInput = $('#studentLinkInput');
const btnCopy = $('#btnCopy');
const btnOpenStudent = $('#btnOpenStudent');

// ======= State =======
let MODE = 'teacher'; // 초기 관리자
let roomId = '';
let me = { id: null, name: '' };
let unsubRoom = null;
let unsubResps = null;
let currentRoom = null; // 최신 room snapshot cache
let qr; // QR instance

// ======= Tabs =======
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(x => x.classList.remove('active'));
    tab.classList.add('active');
    const name = tab.dataset.tab;
    [tabBuild, tabControl, tabResults].forEach(p => p.classList.add('hidden'));
    if (name === 'build') tabBuild.classList.remove('hidden');
    if (name === 'control') tabControl.classList.remove('hidden');
    if (name === 'results') tabResults.classList.remove('hidden');
  });
});

// ======= Mode =======
btnTeacherMode.addEventListener('click', () => setMode('teacher'));
btnStudentMode.addEventListener('click', () => setMode('student'));

function setMode(m) {
  MODE = m;
  teacherPanel.classList.toggle('hidden', m !== 'teacher');
  studentPanel.classList.toggle('hidden', m !== 'student');
  statusText.textContent =
    m === 'teacher' ? '관리자 모드: 세션을 연결해 주세요.' : '학생 모드: 세션 접속 후 참가하세요.';
}

// URL 쿼리로 학생 자동모드 진입 지원 (?student=1&room=XXX)
(function bootFromQuery(){
  const u = new URL(location.href);
  const asStudent = u.searchParams.get('student') === '1';
  const rid = u.searchParams.get('room') || '';
  if (asStudent) setMode('student');
  if (rid) {
    roomIdInput.value = rid;
    connectRoom();
  }
})();

// ======= Connect =======
btnConnect.addEventListener('click', connectRoom);

async function connectRoom() {
  const id = (roomIdInput.value || '').trim();
  if (!id) return alert('세션 코드를 입력하세요');
  roomId = id;
  statusText.textContent = `세션: ${roomId}`;
  refreshStudentLink();

  await ensureRoomExists(roomId);
  listenRoom(roomId);
  listenResponses(roomId);
}

async function ensureRoomExists(id) {
  const ref = db.collection('rooms').doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      title: '새 세션',
      mode: 'idle',
      currentIndex: -1,
      accept: false,
      questions: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
}

function listenRoom(id) {
  if (unsubRoom) unsubRoom();
  unsubRoom = db.collection('rooms').doc(id).onSnapshot(snap => {
    if (!snap.exists) return;
    currentRoom = snap.data();
    renderRoom(currentRoom);
  });
}

function listenResponses(id) {
  if (unsubResps) unsubResps();
  unsubResps = db.collection('rooms').doc(id).collection('responses')
    .onSnapshot(snap => {
      const arr = [];
      snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
      renderResponses(arr);
    });
}

// ======= Builder =======
btnBuildForm.addEventListener('click', () => {
  const n = clamp(parseInt(questionCount.value || '3', 10), 1, 20);
  builder.innerHTML = '';
  for (let i = 0; i < n; i++) builder.appendChild(buildQuestionRow(i + 1));
});

btnLoadSample.addEventListener('click', () => {
  quizTitle.value = '샘플 퀴즈';
  questionCount.value = 3;
  builder.innerHTML = '';
  const samples = [
    { type: 'mcq', text: '태양계에서 가장 큰 행성은?', options: ['지구', '목성', '화성', '금성'], answerIndex: 1 },
    { type: 'short', text: '물의 끓는점(°C)은?', answerText: '100' },
    { type: 'mcq', text: '광합성에 필요한 것은?', options: ['빛', '소리', '열', '달빛'], answerIndex: 0 }
  ];
  samples.forEach((q, i) => builder.appendChild(buildQuestionRow(i + 1, q)));
});

btnSaveQuiz.addEventListener('click', async () => {
  if (!roomId) return alert('세션을 먼저 연결하세요.');
  const payload = collectQuiz();
  if (!payload.questions.length) return alert('문항이 없습니다.');
  await db.collection('rooms').doc(roomId).set({
    title: payload.title,
    questions: payload.questions
  }, { merge: true });
  alert('저장 완료! 진행 탭에서 시작하세요.');
});

// ======= Control =======
btnStart.addEventListener('click', async () => {
  if (!roomId) return;
  await updateRoom({ mode: 'active', currentIndex: 0, accept: true });
});
btnStop.addEventListener('click', async () => {
  if (!roomId) return;
  await updateRoom({ mode: 'ended', accept: false });
});
btnPrev.addEventListener('click', () => stepIndex(-1));
btnNext.addEventListener('click', () => stepIndex(1));
toggleAccept.addEventListener('change', () => updateRoom({ accept: !!toggleAccept.checked }));

async function updateRoom(patch) {
  await db.collection('rooms').doc(roomId).set(patch, { merge: true });
}

async function stepIndex(delta) {
  const ref = db.collection('rooms').doc(roomId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const r = snap.data();
    const max = (r.questions?.length || 0) - 1;
    let n = (r.currentIndex ?? -1) + delta;
    n = clamp(n, 0, Math.max(0, max));
    tx.set(ref, { currentIndex: n, accept: true }, { merge: true });
  });
}

// ======= Results / CSV / Reset =======
btnExportCSV.addEventListener('click', exportCSV);
btnResetAll.addEventListener('click', resetAll);

async function exportCSV() {
  if (!roomId) return;
  const ref = db.collection('rooms').doc(roomId);
  const [roomSnap, resSnap] = await Promise.all([ref.get(), ref.collection('responses').get()]);
  const room = roomSnap.data();
  const rows = [];
  const header = ['userId', 'name', ...(room.questions || []).map((_, i) => `Q${i + 1}`), 'score', 'status'];
  rows.push(header.join(','));
  resSnap.forEach(d => {
    const data = d.data();
    let score = 0;
    const answers = (room.questions || []).map((q, i) => {
      const a = data.answers?.[i];
      if (a?.correct) score++;
      return escapeCsv(a?.value ?? '');
    });
    rows.push([d.id, escapeCsv(data.name || ''), ...answers, score, data.status || 'alive'].join(','));
  });
  downloadFile(`${room.title || roomId}-results.csv`, rows.join('\n'));
}

async function resetAll() {
  if (!roomId) return;
  if (!confirm('모든 응답과 진행 상태를 초기화할까요?')) return;
  const ref = db.collection('rooms').doc(roomId);
  // responses 삭제
  const res = await ref.collection('responses').get();
  const batch = db.batch();
  res.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  // room 진행 상태 초기화(문항은 유지)
  await ref.set({ mode: 'idle', currentIndex: -1, accept: false }, { merge: true });
  alert('초기화 완료');
}

// ======= Student =======
btnJoin.addEventListener('click', async () => {
  if (MODE !== 'student') return alert('학생 모드에서 참가하세요.');
  const name = (studentName.value || '').trim();
  if (!name) return alert('이름(또는 번호)을 입력하세요.');
  if (!roomId) return alert('먼저 세션에 접속하세요');

  me = ensureDeviceIdentity(name); // 기기 토큰 + 이름 저장
  await db.collection('rooms').doc(roomId).collection('responses').doc(me.id).set({
    name: me.name,
    status: 'alive',
    joinedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  alert(`${me.name} 님, 참가 완료!`);
});

studentQuizOptions.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-opt]');
  if (!btn) return;
  const idx = Number(btn.dataset.opt);
  submitAnswer(idx);
});

btnSubmitSubjective.addEventListener('click', () => {
  const val = (subjectiveInput.value || '').trim();
  if (!val) return alert('답을 입력하세요.');
  submitAnswer(val);
});

async function submitAnswer(value) {
  if (!me.id) return alert('먼저 참가하세요.');
  if (!currentRoom || currentRoom.mode !== 'active') return alert('아직 진행 중이 아닙니다.');
  if (!currentRoom.accept) return alert('현재 제출이 허용되지 않습니다.');

  const idx = currentRoom.currentIndex;
  const q = currentRoom.questions?.[idx];
  if (!q) return;

  // 자동채점
  let correct = null;
  if (q.type === 'mcq' && typeof value === 'number') {
    correct = (value === (q.answerIndex ?? -999));
  } else if (q.type === 'short' && typeof value === 'string') {
    const norm = s => String(s).trim().toLowerCase();
    if (q.answerText) correct = (norm(value) === norm(q.answerText));
  }

  await db.collection('rooms').doc(roomId).collection('responses').doc(me.id)
    .set({
      name: me.name,
      [`answers.${idx}`]: { value, correct: correct === true, revealed: (q.type === 'mcq') }
    }, { merge: true });

  answerState.textContent = '제출 완료!';
}

// ======= Render =======
function renderRoom(r) {
  statusText.textContent = `세션: ${roomId} · 상태: ${r.mode}`;
  // 관리
  if (MODE === 'teacher') {
    toggleAccept.checked = !!r.accept;
    const q = r.questions?.[r.currentIndex];
    ctlQuestion.textContent = q ? `${r.currentIndex + 1}. ${q.text}` : '-';
    shortGrader.classList.toggle('hidden', !(q && q.type === 'short'));
  }
  // 학생
  if (MODE === 'student') {
    const idx = r.currentIndex;
    const q = r.questions?.[idx];
    if (r.mode !== 'active' || !q) {
      questionText.textContent = '대기 중입니다…';
      quizTypeBadge.textContent = '대기';
      progressText.textContent = '0 / 0';
      studentQuizOptions.innerHTML = '';
      subjectiveBox.classList.add('hidden');
      return;
    }
    const total = r.questions.length;
    progressText.textContent = `${idx + 1} / ${total}`;
    questionText.textContent = q.text;
    quizTypeBadge.textContent = q.type === 'mcq' ? '객관식' : '주관식';

    if (q.type === 'mcq') {
      subjectiveBox.classList.add('hidden');
      studentQuizOptions.innerHTML = '';
      (q.options || []).forEach((opt, i) => {
        const b = document.createElement('button');
        b.className = 'option';
        b.textContent = opt;
        b.dataset.opt = String(i);
        b.disabled = !r.accept;
        studentQuizOptions.appendChild(b);
      });
    } else {
      studentQuizOptions.innerHTML = '';
      subjectiveBox.classList.remove('hidden');
      subjectiveInput.value = '';
      btnSubmitSubjective.disabled = !r.accept;
    }
  }
}

function renderResponses(arr) {
  // 진행 패널의 칩 및 주관식 채점 리스트, 결과표
  if (MODE === 'teacher' && currentRoom) {
    const idx = currentRoom.currentIndex;
    const q = currentRoom.questions?.[idx];

    // chips (참가자 리스트: 정답/오답/대기 색)
    chips.innerHTML = '';
    let ok = 0, no = 0, wait = 0;
    arr.forEach(s => {
      const a = s.answers?.[idx];
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.textContent = s.name || s.id;
      if (a) {
        if (a.correct) { chip.style.background='#0c2a16'; ok++; }
        else { chip.style.background='#2a0c11'; no++; }
      } else {
        chip.style.opacity = .6; wait++;
      }
      chips.appendChild(chip);
    });
    chipOk.textContent = ok; chipNo.textContent = no; chipWait.textContent = wait;

    // 주관식 채점 리스트
    if (q && q.type === 'short') {
      shortGrader.classList.remove('hidden');
      shortAnswers.innerHTML = '';
      arr.forEach(s => {
        const a = s.answers?.[idx];
        if (!a || typeof a.value !== 'string') return;
        const row = document.createElement('div');
        row.className = 'row';
        const left = document.createElement('div');
        left.textContent = `${s.name || s.id}: ${a.value}`;
        const right = document.createElement('div');
        const okBtn = document.createElement('button'); okBtn.className='btn ghost'; okBtn.textContent='정답';
        const noBtn = document.createElement('button'); noBtn.className='btn ghost'; noBtn.textContent='오답';
        okBtn.addEventListener('click', ()=> gradeAnswer(s.id, idx, true));
        noBtn.addEventListener('click', ()=> gradeAnswer(s.id, idx, false));
        right.appendChild(okBtn); right.appendChild(noBtn);
        row.appendChild(left); row.appendChild(right);
        shortAnswers.appendChild(row);
      });
    } else {
      shortGrader.classList.add('hidden');
    }

    // 결과 표
    buildResultsTable(arr);
  }

  // 학생 자신의 선택 표시
  if (MODE === 'student' && me.id && currentRoom) {
    const idx = currentRoom.currentIndex;
    const mine = arr.find(x => x.id === me.id);
    if (!mine) return;
    const ans = mine.answers?.[idx];
    $$('.option').forEach((el, i) => {
      el.classList.remove('selected','correct','wrong');
      if (ans && typeof ans.value === 'number') {
        if (i === ans.value) el.classList.add('selected');
        if (ans.revealed) {
          if (ans.correct && i === ans.value) el.classList.add('correct');
          if (!ans.correct && i === ans.value) el.classList.add('wrong');
        }
      }
    });
    if (ans && typeof ans.value === 'string') {
      answerState.textContent = ans.revealed ? (ans.correct ? '정답!' : '오답') : `제출: ${ans.value}`;
    }
  }
}

async function gradeAnswer(userId, qIndex, correct) {
  await db.collection('rooms').doc(roomId).collection('responses').doc(userId)
    .set({ [`answers.${qIndex}.correct`]: !!correct, [`answers.${qIndex}.revealed`]: true }, { merge: true });
}

function buildResultsTable(arr) {
  const room = currentRoom;
  if (!room) return;
  const qs = room.questions || [];
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  ['이름', ...qs.map((_, i) => `Q${i + 1}`), '점수', '상태'].forEach(h => {
    const th = document.createElement('th'); th.textContent = h; htr.appendChild(th);
  });
  thead.appendChild(htr); table.appendChild(thead);
  const tbody = document.createElement('tbody');

  arr.forEach(s => {
    let score = 0;
    const tr = document.createElement('tr');
    const tdName = document.createElement('td'); tdName.textContent = s.name || s.id; tr.appendChild(tdName);
    qs.forEach((q, i) => {
      const td = document.createElement('td');
      const a = s.answers?.[i];
      if (a) {
        if (a.correct) score++;
        td.textContent = q.type === 'mcq'
          ? (typeof a.value === 'number' ? String(a.value + 1) : '-')
          : (a.value || '-');
      } else td.textContent = '-';
      tr.appendChild(td);
    });
    const tdScore = document.createElement('td'); tdScore.textContent = String(score); tr.appendChild(tdScore);
    const tdState = document.createElement('td'); tdState.textContent = s.status || 'alive'; tr.appendChild(tdState);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  resultsContainer.innerHTML = '';
  resultsContainer.appendChild(table);
}

// ======= QR & 링크 =======
function refreshStudentLink() {
  const url = new URL(location.href);
  url.searchParams.set('room', roomId);
  url.searchParams.set('student', '1');
  const link = url.toString();

  studentLinkInput.value = link;
  qrBox.innerHTML = '';
  qr = new QRCode(qrBox, { text: link, width: 200, height: 200 });
}

btnCopy.addEventListener('click', async () => {
  const s = studentLinkInput.value;
  if (!s) return;
  try {
    await navigator.clipboard.writeText(s);
    alert('링크가 복사되었습니다!');
  } catch {
    studentLinkInput.select();
    document.execCommand('copy');
    alert('링크가 복사되었습니다!');
  }
});

btnOpenStudent.addEventListener('click', () => {
  const link = studentLinkInput.value;
  if (link) window.open(link, '_blank', 'noopener,noreferrer');
});

// ======= Helpers =======
function buildQuestionRow(no, q = { type: 'mcq', text: '', options: ['', '', '', ''], answerIndex: 0 }) {
  const wrap = document.createElement('div');
  wrap.className = 'panel';
  wrap.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <span class="badge">${no}번 문항</span>
      <div class="row">
        <label class="row" style="gap:6px">
          <input type="radio" name="type-${no}" value="mcq" ${q.type === 'short' ? '' : 'checked'} /> 객관식
        </label>
        <label class="row" style="gap:6px">
          <input type="radio" name="type-${no}" value="short" ${q.type === 'short' ? 'checked' : ''} /> 주관식
        </label>
      </div>
    </div>

    <div class="row" style="margin-top:8px">
      <input class="q-text" data-no="${no}" placeholder="문항 내용" value="${escapeHtml(q.text)}" />
    </div>

    <div class="mcq ${q.type === 'short' ? 'hidden' : ''}" style="margin-top:8px">
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:8px">
        ${(q.options || ['', '', '', '']).map(
          (v, i) =>
            `<input class="opt" data-no="${no}" data-idx="${i}" placeholder="보기 ${i + 1}" value="${escapeHtml(v)}" />`
        ).join('')}
      </div>
      <div class="row" style="margin-top:8px">
        <label class="muted">정답 번호</label>
        <input class="ansIndex" data-no="${no}" type="number" min="1" max="10" value="${(q.answerIndex ?? 0) + 1}" style="max-width:100px" />
      </div>
    </div>

    <div class="short ${q.type === 'short' ? '' : 'hidden'}" style="margin-top:8px">
      <input class="ansText" data-no="${no}" placeholder="정답(선택, 자동채점용)" value="${escapeHtml(q.answerText || '')}" />
    </div>
  `;

  const radios = $$(`input[name="type-${no}"]`, wrap);
  const mcq = $('.mcq', wrap);
  const short = $('.short', wrap);
  radios.forEach(r =>
    r.addEventListener('change', () => {
      const isShort = radios.find(x => x.checked)?.value === 'short';
      mcq.classList.toggle('hidden', isShort);
      short.classList.toggle('hidden', !isShort);
    })
  );
  return wrap;
}

function collectQuiz() {
  const title = quizTitle.value || '퀴즈';
  const cards = $$('#builder > .panel');
  const questions = cards
    .map((card, idx) => {
      const no = idx + 1;
      const type = card.querySelector(`input[name="type-${no}"]:checked`).value;
      const text = card.querySelector('.q-text').value.trim();
      if (!text) return null;
      if (type === 'mcq') {
        const opts = $$('.opt', card).map(x => x.value.trim()).filter(Boolean);
        const ansIndex = clamp(parseInt(card.querySelector('.ansIndex').value, 10) - 1, 0, Math.max(0, opts.length - 1));
        return { type: 'mcq', text, options: opts, answerIndex: ansIndex };
      } else {
        const answerText = card.querySelector('.ansText').value.trim();
        return { type: 'short', text, answerText };
      }
    })
    .filter(Boolean);
  return { title, questions };
}

function ensureDeviceIdentity(name) {
  // 기기 토큰 고정 + 사용자 이름
  let token = localStorage.getItem('quiz_device_token');
  if (!token) { token = Math.random().toString(36).slice(2, 10); localStorage.setItem('quiz_device_token', token); }
  return { id: token, name };
}

function escapeHtml(s = '') {
  return s.replace(/[&<>\"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function escapeCsv(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadFile(filename, content) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/csv' }));
  a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}

// 초기 모드: 관리자
setMode('teacher');
