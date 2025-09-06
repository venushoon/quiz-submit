/* app.js (ES Module) */

// ===== DOM =====
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

// ===== State =====
let MODE = 'teacher'; // 초기 화면: 관리자
let roomId = '';
let me = { id: null, name: '' };

// ===== Tab logic =====
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

// ===== Mode switch =====
btnTeacherMode.addEventListener('click', () => setMode('teacher'));
btnStudentMode.addEventListener('click', () => setMode('student'));

function setMode(m) {
  MODE = m;
  teacherPanel.classList.toggle('hidden', m !== 'teacher');
  studentPanel.classList.toggle('hidden', m !== 'student');
  statusText.textContent =
    m === 'teacher' ? '관리자 모드: 세션을 연결해 주세요.' : '학생 모드: 세션 접속 후 참가하세요.';
}

// ===== Connect (세션) =====
btnConnect.addEventListener('click', async () => {
  const id = (roomIdInput.value || '').trim();
  if (!id) return alert('세션 코드를 입력하세요');
  roomId = id;
  statusText.textContent = `세션: ${roomId}`;
  refreshStudentLink(); // QR/링크 갱신
  // TODO: Firestore에 ensureRoomExists(roomId) / listeners 연결
});

// ===== Builder =====
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
  // TODO: Firestore rooms/{roomId}에 저장
  alert('저장 완료! 진행 탭에서 시작하세요.');
});

// ===== Control =====
btnStart.addEventListener('click', () => {
  // TODO: Firestore room: {mode:'active', currentIndex:0, accept:true}
  toggleAccept.checked = true;
  ctlQuestion.textContent = '(시작됨) 첫 문제를 표시합니다.';
});
btnStop.addEventListener('click', () => {
  // TODO: Firestore room: {mode:'ended', accept:false}
  toggleAccept.checked = false;
});
btnPrev.addEventListener('click', () => {
  // TODO: currentIndex - 1
});
btnNext.addEventListener('click', () => {
  // TODO: currentIndex + 1
});
toggleAccept.addEventListener('change', () => {
  // TODO: Firestore accept 반영
});

// ===== Results =====
btnExportCSV.addEventListener('click', () => {
  // TODO: Firestore에서 room/questions + responses 읽어 CSV 생성
  alert('CSV 내보내기 (TODO)');
});
btnResetAll.addEventListener('click', () => {
  // TODO: Firestore 전체 초기화
  alert('전체 초기화 (TODO)');
});

// ===== Student =====
btnJoin.addEventListener('click', () => {
  if (MODE !== 'student') return alert('학생 모드에서 참가하세요.');
  const name = (studentName.value || '').trim();
  if (!name) return alert('이름(또는 번호)을 입력하세요.');
  me = { id: randomId(), name };
  alert(`${name} 님, 참가 완료!`);
  // TODO: Firestore responses/{me.id} 등록
});

studentQuizOptions.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-opt]');
  if (!btn) return;
  const idx = Number(btn.dataset.opt);
  submitAnswer(idx); // 객관식
});

btnSubmitSubjective.addEventListener('click', () => {
  const val = (subjectiveInput.value || '').trim();
  if (!val) return alert('답을 입력하세요.');
  submitAnswer(val); // 주관식
});

// ===== QR & 링크 =====
let qr; // QRCode 인스턴스 재사용
function refreshStudentLink() {
  const url = new URL(location.href);
  // 학생 모드는 ?student=1 쿼리로 구분 (예시)
  url.searchParams.set('room', roomId);
  url.searchParams.set('student', '1');
  const link = url.toString();

  studentLinkInput.value = link;

  // QR 갱신
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

// ===== Helpers =====
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

  // 타입 토글
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

function submitAnswer(value) {
  if (!me.id) return alert('먼저 참가하세요.');
  // TODO: Firestore responses/{me.id} 에 현재 문항 index로 value 저장
  answerState.textContent = '제출 완료!';
}

function escapeHtml(s = '') {
  return s.replace(/[&<>\"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

// 초기 모드: 관리자
setMode('teacher');
