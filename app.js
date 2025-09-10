// app.js (compat 버전 / import 없음)

/* ------------------ helpers & state ------------------ */
const $  = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const pad = n => String(n).padStart(2, '0');

let MODE = 'admin';               // 'admin' | 'student'
let roomId = '';
let me = { id: null, name: '' };
let unsubRoom = null, unsubResp = null;
let timerHandle = null;

const els = {
  // header
  roomId: $('#roomId'), btnConnect: $('#btnConnect'), btnLogout: $('#btnLogout'), roomStatus: $('#roomStatus'),
  // tabs
  tabBuild: $('#tabBuild'), tabOptions: $('#tabOptions'), tabPresent: $('#tabPresent'), tabResults: $('#tabResults'),
  // panels
  pBuild: $('#panelBuild'), pOptions: $('#panelOptions'), pPresent: $('#panelPresent'), pResults: $('#panelResults'),
  // builder
  quizTitle: $('#quizTitle'), questionCount: $('#questionCount'), btnBuildForm: $('#btnBuildForm'),
  btnLoadSample: $('#btnLoadSample'), btnSaveQuiz: $('#btnSaveQuiz'), builder: $('#builder'),
  btnUploadTxt: $('#btnUploadTxt'), btnDownloadTemplate: $('#btnDownloadTemplate'), fileLoad: $('#fileLoad'),
  // options
  chkDeviceOnce: $('#chkDeviceOnce'), chkNameOnce: $('#chkNameOnce'),
  chkAccept: $('#chkAccept'), chkReveal: $('#chkReveal'), chkBright: $('#chkBright'),
  timerSec: $('#timerSec'), btnTimerGo: $('#btnTimerGo'), btnTimerStop: $('#btnTimerStop'), leftSec: $('#leftSec'),
  btnOptSave: $('#btnOptSave'), btnInitAll: $('#btnInitAll'),
  // student access
  qrCanvas: $('#qrCanvas'), studentLink: $('#studentLink'), btnCopyLink: $('#btnCopyLink'), btnOpenStudent: $('#btnOpenStudent'),
  // present
  btnStart: $('#btnStart'), btnPrev: $('#btnPrev'), btnNext: $('#btnNext'), btnEndAll: $('#btnEndAll'),
  chipJoin: $('#chipJoin b'), chipSubmit: $('#chipSubmit b'), chipCorrect: $('#chipCorrect b'), chipWrong: $('#chipWrong b'),
  progress: $('#progress'), clock: $('#clock'), pTitle: $('#pTitle'), pQ: $('#pQ'), pImgWrap: $('#pImgWrap'), pImg: $('#pImg'), pOpts: $('#pOpts'),
  chips: $('#chips'), shortAnswers: $('#shortAnswers'),
  // results
  btnExportCSV: $('#btnExportCSV'), btnLeaderboardFull: $('#btnLeaderboardFull'), btnResetAll: $('#btnResetAll'), resultsTable: $('#resultsTable'),
  // student panel
  studentPanel: $('#studentPanel'), sState: $('#sState'), joinModal: $('#joinModal'),
  studentName: $('#studentName'), btnJoin: $('#btnJoin'),
  sWrap: $('#sWrap'), badgeType: $('#badgeType'), sQTitle: $('#sQTitle'), sQImgWrap: $('#sQImgWrap'), sQImg: $('#sQImg'),
  sQText: $('#sQText'), mcqBox: $('#mcqBox'), shortBox: $('#shortBox'), shortInput: $('#shortInput'), btnShortSend: $('#btnShortSend'),
  btnSubmitMcq: $('#btnSubmitMcq'), sDone: $('#sDone'), btnMyResult: $('#btnMyResult')
};

Object.keys(els).forEach(k => { if (!els[k]) console.warn('[warn] missing element:', k); });

/* ------------------ firestore refs ------------------ */
const roomRef = id => firebase.firestore().doc(`rooms/${id}`);
const respCol = id => firebase.firestore().collection(`rooms/${id}/responses`);

/* ------------------ local cache ------------------ */
function saveLocal() {
  localStorage.setItem('quiz.live', JSON.stringify({ MODE, roomId, me }));
}
function loadLocal() {
  try {
    const d = JSON.parse(localStorage.getItem('quiz.live') || '{}');
    MODE = d.MODE || 'admin';
    roomId = d.roomId || '';
    me = d.me || { id: null, name: '' };
    if (roomId && els.roomId) els.roomId.value = roomId;
  } catch {}
}

/* ------------------ ensure / listen ------------------ */
async function ensureRoom(id) {
  const snap = await roomRef(id).get();
  if (!snap.exists) {
    await roomRef(id).set({
      title: '새 세션',
      mode: 'idle',          // <- 시작 전 안내 상태
      currentIndex: -1,      // <- -1이면 프레젠테이션 안내만 보임
      accept: false,
      reveal: false,
      policy: 'device',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      questions: []
    });
  }
}

function listenRoom(id) {
  if (unsubRoom) unsubRoom();
  unsubRoom = roomRef(id).onSnapshot((snap) => {
    if (!snap.exists) return;
    const r = snap.data();
    window.__room = r;
    renderRoom(r);
  });
}

function listenResponses(id) {
  if (unsubResp) unsubResp();
  unsubResp = respCol(id).onSnapshot((qs) => {
    const arr = [];
    qs.forEach((d) => arr.push({ id: d.id, ...d.data() }));
    renderResponses(arr);
  });
}

/* ------------------ mode & connect ------------------ */
function setMode(m) {
  MODE = m;

  // 탭 표시
  [els.tabBuild, els.tabOptions, els.tabPresent, els.tabResults].forEach(b => b?.classList.remove('active'));
  // 패널 표시
  els.pBuild?.classList.toggle('hide', MODE !== 'admin');
  els.pOptions?.classList.toggle('hide', MODE !== 'admin');
  els.pPresent?.classList.toggle('hide', false);
  els.pResults?.classList.toggle('hide', MODE !== 'admin');

  // 학생 전용 패널
  els.studentPanel?.classList.toggle('hide', MODE !== 'student');

  // 안내 문구
  if (els.roomStatus) {
    els.roomStatus.textContent = roomId
      ? `세션: ${roomId} · 온라인`
      : (MODE === 'admin' ? '관리자 모드: 세션에 접속해 주세요.' : '학생 모드: 세션 접속 후 참가하세요.');
  }
}

async function connect() {
  const id = (els.roomId?.value || '').trim();
  if (!id) return alert('세션 코드를 입력하세요.');
  roomId = id;

  // 입력 잠금 / 세션아웃 버튼 활성
  if (els.roomId) els.roomId.disabled = true;

  await ensureRoom(roomId);
  listenRoom(roomId);
  listenResponses(roomId);
  buildStudentLink();

  if (els.roomStatus) els.roomStatus.textContent = `세션: ${roomId} · 온라인`;
  saveLocal();
}

function logout() {
  // 언바인드
  if (unsubRoom) unsubRoom(), unsubRoom = null;
  if (unsubResp) unsubResp(), unsubResp = null;

  // 상태 초기화(입력창 활성)
  if (els.roomId) els.roomId.disabled = false;
  if (els.roomStatus) els.roomStatus.textContent = '세션: - · 오프라인';

  saveLocal();
}

/* ------------------ builder ------------------ */
function cardRow(no, q) {
  const wrap = document.createElement('div');
  wrap.className = 'qcard';
  wrap.innerHTML = `
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'} /><span>객관식</span></label>
      <label class="switch"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''} /><span>주관식</span></label>
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항 내용" value="${q?.text||''}" />
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기 ${i+1}" value="${v||''}">`).join('')}
      </div>
      <div class="row">
        <span class="hint">정답 번호</span>
        <input class="ansIndex input xs" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
      </div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <input class="ansText input" data-no="${no}" placeholder="정답(선택, 자동채점용)" value="${q?.answerText||''}">
    </div>
  `;
  const radios = $$(`input[name="type-${no}"]`, wrap);
  const mcq = $('.mcq', wrap), short = $('.short', wrap);
  radios.forEach(r=>r.addEventListener('change',()=>{
    const isShort = radios.find(x=>x.checked)?.value === 'short';
    mcq.classList.toggle('hide', isShort);
    short.classList.toggle('hide', !isShort);
  }));
  return wrap;
}

function collectBuilder() {
  const cards = $$('#builder>.qcard');
  const list = cards.map((c, idx) => {
    const no = idx + 1;
    const type = c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text = c.querySelector('.qtext').value.trim();
    if (!text) return null;
    if (type === 'mcq') {
      const opts = $$('.opt', c).map(i => i.value.trim()).filter(Boolean);
      const ans = Math.max(0, Math.min(opts.length - 1, (parseInt(c.querySelector('.ansIndex').value, 10) || 1) - 1));
      return { type: 'mcq', text, options: opts, answerIndex: ans };
    } else {
      return { type: 'short', text, answerText: c.querySelector('.ansText').value.trim() };
    }
  }).filter(Boolean);
  return { title: els.quizTitle?.value || '퀴즈', questions: list };
}

/* ------------------ flow + timer ------------------ */
async function startQuiz() {
  if (!roomId) return;
  await roomRef(roomId).update({ mode: 'active', currentIndex: 0, accept: true }); // Q1 즉시 노출
}
async function step(delta) {
  if (!roomId) return;
  await firebase.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(roomRef(roomId));
    const r = snap.data(); const total = (r.questions?.length || 0);
    let next = (r.currentIndex ?? -1) + delta;
    if (next >= total) { // 끝 → 종료
      tx.update(roomRef(roomId), { currentIndex: total - 1, mode: 'ended', accept: false });
      return;
    }
    next = Math.max(0, next);
    tx.update(roomRef(roomId), { currentIndex: next, accept: true });
  });
}
async function finishAll() {
  if (!roomId) return;
  if (confirm('퀴즈를 종료할까요?')) await roomRef(roomId).update({ mode: 'ended', accept: false });
}

function startTimer(sec) {
  stopTimer();
  const end = Date.now() + sec * 1000;
  timerHandle = setInterval(async () => {
    const remain = Math.max(0, Math.floor((end - Date.now()) / 1000));
    els.leftSec && (els.leftSec.textContent = `${pad(Math.floor(remain / 60))}:${pad(remain % 60)}`);
    if (remain <= 0) {
      stopTimer();
      await roomRef(roomId).update({ accept: false });
      setTimeout(() => step(+1), 300);
    }
  }, 250);
}
function stopTimer() {
  if (timerHandle) clearInterval(timerHandle), timerHandle = null;
  els.leftSec && (els.leftSec.textContent = '00:00');
}

/* ------------------ submit / grade ------------------ */
async function join() {
  if (!roomId) return alert('세션에 먼저 접속하세요.');
  const name = (els.studentName?.value || '').trim();
  if (!name) return alert('이름을 입력하세요.');
  me = { id: localStorage.getItem('quiz.device') || Math.random().toString(36).slice(2, 10), name };
  localStorage.setItem('quiz.device', me.id);
  await respCol(roomId).doc(me.id).set({ name, joinedAt: firebase.firestore.FieldValue.serverTimestamp(), answers: {}, alive: true }, { merge: true });

  // 참가 후 대기 UI
  els.joinModal?.classList.add('hide');
  els.sWrap?.classList.remove('hide');
  els.sState && (els.sState.textContent = '참가 완료! 제출 버튼을 눌러주세요. 교사가 시작하면 1번 문항이 표시됩니다.');
  saveLocal();
}
async function submit(value) {
  const r = window.__room; if (!r?.accept) return alert('지금은 제출할 수 없습니다.');
  const idx = r.currentIndex; const q = r.questions?.[idx]; if (!q) return;
  const ref = respCol(roomId).doc(me.id);
  const snap = await ref.get(); const prev = snap.exists ? (snap.data().answers || {}) : {};
  if (prev[idx] != null) return alert('이미 제출했습니다.');

  let correct = null;
  if (q.type === 'mcq' && typeof value === 'number') correct = (value === (q.answerIndex ?? -999));
  if (q.type === 'short' && typeof value === 'string') {
    const norm = s => String(s).trim().toLowerCase();
    if (q.answerText) correct = (norm(value) === norm(q.answerText));
  }
  await ref.set({ name: me.name, [`answers.${idx}`]: { value, correct: (correct === true), revealed: r.reveal || false } }, { merge: true });

  // 학생 쪽 제출 버튼 비활성
  els.btnSubmitMcq?.setAttribute('disabled', 'disabled');
  els.btnShortSend?.setAttribute('disabled', 'disabled');
}
async function grade(uid, qIndex, ok) {
  await respCol(roomId).doc(uid).set({ [`answers.${qIndex}.correct`]: !!ok, [`answers.${qIndex}.revealed`]: true }, { merge: true });
}

/* ------------------ render ------------------ */
function renderRoom(r) {
  const total = r.questions?.length || 0;
  const idx = r.currentIndex;

  // 진행 지표
  els.progress && (els.progress.textContent = `Q${Math.max(0, idx + 1)}/${total}`);
  els.chipJoin && (els.chipJoin.textContent = r.joinCount || 0); // (옵션) 서버에서 세면 사용
  els.chipSubmit && (els.chipSubmit.textContent = r.submitCount || 0);

  // 옵션 상태
  if (els.chkAccept) els.chkAccept.checked = !!r.accept;
  if (els.chkReveal) els.chkReveal.checked = !!r.reveal;

  // 프레젠테이션(교사)
  if (els.pTitle && els.pQ && els.pOpts) {
    els.pOpts.innerHTML = '';
    if (r.mode === 'idle' || idx < 0 || !r.questions?.[idx]) {
      els.pTitle.textContent = r.title || roomId || '-';
      els.pQ.textContent = '시작 버튼을 누르면 문항이 제시됩니다.';
      els.pQ.classList.add('muted');
      els.pImgWrap?.classList.add('hide');
    } else {
      const q = r.questions[idx];
      els.pTitle.textContent = r.title || roomId || '-';
      els.pQ.textContent = q.text || '-';
      els.pQ.classList.remove('muted');

      // 이미지
      if (q.image) {
        els.pImgWrap?.classList.remove('hide');
        els.pImg && (els.pImg.src = q.image);
      } else {
        els.pImgWrap?.classList.add('hide');
      }

      if (q.type === 'mcq') {
        q.options.forEach((t, i) => {
          const d = document.createElement('div');
          d.className = 'popt';
          d.textContent = `${i + 1}. ${t}`;
          els.pOpts.appendChild(d);
        });
      }
    }
  }

  // 학생 화면
  if (MODE === 'student') {
    if (r.mode !== 'active' || idx < 0 || !r.questions?.[idx]) {
      // 대기
      els.sState && (els.sState.textContent = '대기 중입니다… 교사가 시작하면 문항이 표시됩니다.');
      els.mcqBox && (els.mcqBox.innerHTML = '');
      els.shortBox && els.shortBox.classList.add('hide');
      return;
    }
    const q = r.questions[idx];
    els.badgeType && (els.badgeType.textContent = q.type === 'mcq' ? '객관식' : '주관식');
    els.sQTitle && (els.sQTitle.textContent = r.title || roomId || '-');
    els.sQText && (els.sQText.textContent = q.text || '-');

    // 이미지
    if (q.image) {
      els.sQImgWrap?.classList.remove('hide');
      els.sQImg && (els.sQImg.src = q.image);
    } else {
      els.sQImgWrap?.classList.add('hide');
    }

    if (q.type === 'mcq') {
      if (els.mcqBox) {
        els.mcqBox.innerHTML = '';
        q.options.forEach((opt, i) => {
          const b = document.createElement('button');
          b.className = 'optbtn';
          b.textContent = `${i + 1}. ${opt}`;
          b.addEventListener('click', () => {
            // 선택 표시
            $$('.optbtn', els.mcqBox).forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            els.btnSubmitMcq?.classList.remove('hide');
            els.btnSubmitMcq.onclick = () => submit(i);
          });
          els.mcqBox.appendChild(b);
        });
      }
      els.shortBox && els.shortBox.classList.add('hide');
    } else {
      els.mcqBox && (els.mcqBox.innerHTML = '');
      els.shortBox && els.shortBox.classList.remove('hide');
      els.btnShortSend && (els.btnShortSend.onclick = () => submit((els.shortInput?.value || '').trim()));
    }
  }

  // 결과 탭 테이블(관리자)
  if (els.resultsTable && MODE === 'admin') {
    const tbl = document.createElement('table');
    const thead = document.createElement('thead'), tr = document.createElement('tr');
    ['이름', ...(r.questions || []).map((_, i) => `Q${i + 1}`), '점수'].forEach(h => {
      const th = document.createElement('th'); th.textContent = h; tr.appendChild(th);
    });
    thead.appendChild(tr); tbl.appendChild(thead);

    const tb = document.createElement('tbody');
    // responses는 renderResponses에서 채운 chip 기준으로만 보므로 여기선 tb만 초기화
    tbl.appendChild(tb);
    els.resultsTable.innerHTML = ''; els.resultsTable.appendChild(tbl);
  }

  // 종료 시 학생 안내
  if (MODE === 'student') {
    if (r.mode === 'ended') {
      els.sWrap?.classList.add('hide');
      els.sDone?.classList.remove('hide');
    } else {
      els.sDone?.classList.add('hide');
    }
  }
}

function renderResponses(list) {
  if (MODE !== 'admin') return;
  const r = window.__room || {}; const idx = r.currentIndex; const q = r.questions?.[idx];

  // 칩
  if (els.chips) {
    els.chips.innerHTML = '';
    list.forEach(s => {
      const a = s.answers?.[idx];
      const chip = document.createElement('div');
      chip.className = 'chip ' + (a ? (a.correct ? 'ok' : 'no') : 'wait');
      chip.textContent = s.name || s.id;
      els.chips.appendChild(chip);
    });
  }

  // 주관식 채점
  if (els.shortAnswers) {
    els.shortAnswers.innerHTML = '';
    if (q && q.type === 'short') {
      list.forEach(s => {
        const a = s.answers?.[idx]; if (!a || typeof a.value !== 'string') return;
        const row = document.createElement('div'); row.className = 'row between';
        row.innerHTML = `<span>${s.name}: ${a.value}</span>`;
        const box = document.createElement('div');
        const ok = document.createElement('button'); ok.className = 'btn ghost'; ok.textContent = '정답';
        const no = document.createElement('button'); no.className = 'btn ghost'; no.textContent = '오답';
        ok.onclick = () => grade(s.id, idx, true); no.onclick = () => grade(s.id, idx, false);
        box.append(ok, no); row.append(box); els.shortAnswers.appendChild(row);
      });
    }
  }

  // 결과표(점수 채우기)
  if (els.resultsTable) {
    const tbl = els.resultsTable.querySelector('table'); if (!tbl) return;
    const tb = tbl.querySelector('tbody'); if (!tb) return; tb.innerHTML = '';
    list.forEach(s => {
      let score = 0; const tr = document.createElement('tr');
      const tdn = document.createElement('td'); tdn.textContent = s.name || s.id; tr.appendChild(tdn);
      (r.questions || []).forEach((q, i) => {
        const a = s.answers?.[i]; const td = document.createElement('td');
        td.textContent = a ? (q.type === 'mcq' ? (typeof a.value === 'number' ? a.value + 1 : '-') : (a.value ?? '-')) : '-';
        if (a?.correct) score++; tr.appendChild(td);
      });
      const tds = document.createElement('td'); tds.textContent = String(score); tr.appendChild(tds);
      tb.appendChild(tr);
    });
  }
}

/* ------------------ link / QR ------------------ */
function buildStudentLink() {
  if (!els.studentLink) return;
  const url = new URL(location.href);
  url.searchParams.set('role', 'student');
  url.searchParams.set('room', roomId || '');
  els.studentLink.value = url.toString();

  // QR 그리기
  if (window.QRCode && els.qrCanvas) {
    try {
      QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width: 168 }, (err) => { if (err) console.warn(err); });
    } catch (e) { console.warn('QR draw failed', e); }
  }
}

/* ------------------ events ------------------ */
els.btnConnect?.addEventListener('click', connect);
els.btnLogout?.addEventListener('click', logout);

[els.tabBuild, els.tabOptions, els.tabPresent, els.tabResults].forEach(btn => {
  btn?.addEventListener('click', () => {
    [els.tabBuild, els.tabOptions, els.tabPresent, els.tabResults].forEach(b => b?.classList.remove('active'));
    btn.classList.add('active');
    els.pBuild?.classList.toggle('hide', btn !== els.tabBuild || MODE !== 'admin');
    els.pOptions?.classList.toggle('hide', btn !== els.tabOptions || MODE !== 'admin');
    els.pPresent?.classList.toggle('hide', btn !== els.tabPresent ? true : false);
    els.pResults?.classList.toggle('hide', btn !== els.tabResults || MODE !== 'admin');
  });
});

els.btnBuildForm?.addEventListener('click', () => {
  const n = Math.max(1, Math.min(20, parseInt(els.questionCount?.value, 10) || 3));
  if (els.builder) { els.builder.innerHTML = ''; for (let i = 0; i < n; i++) els.builder.appendChild(cardRow(i + 1)); }
});
els.btnLoadSample?.addEventListener('click', () => {
  const S = [
    { type: 'mcq', text: '가장 큰 행성은?', options: ['지구', '목성', '화성', '금성'], answerIndex: 1 },
    { type: 'short', text: '물의 끓는점(°C)?', answerText: '100' },
    { type: 'mcq', text: '태양계 별명?', options: ['Milky', 'Solar', 'Sunset', 'Lunar'], answerIndex: 1 },
  ];
  if (els.builder) { els.builder.innerHTML = ''; S.forEach((q, i) => els.builder.appendChild(cardRow(i + 1, q))); }
  if (els.quizTitle) els.quizTitle.value = '샘플 퀴즈';
  if (els.questionCount) els.questionCount.value = S.length;
});
els.btnSaveQuiz?.addEventListener('click', async () => {
  const payload = collectBuilder(); if (!payload.questions.length) return alert('문항을 추가하세요.');
  await roomRef(roomId).set({ title: payload.title, questions: payload.questions }, { merge: true });
  alert('저장 완료!');
});

// 옵션
els.chkAccept?.addEventListener('change', () => roomRef(roomId).update({ accept: !!els.chkAccept.checked }));
els.chkReveal?.addEventListener('change', () => roomRef(roomId).update({ reveal: !!els.chkReveal.checked }));
els.btnOptSave?.addEventListener('click', () => { buildStudentLink(); alert('저장되었습니다. QR/링크가 갱신되었습니다.'); });

els.btnTimerGo?.addEventListener('click', () => startTimer(Math.max(5, Math.min(600, parseInt(els.timerSec?.value, 10) || 30))));
els.btnTimerStop?.addEventListener('click', stopTimer);

els.btnCopyLink?.addEventListener('click', async () => {
  if (!els.studentLink) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent = '복사됨'; setTimeout(() => els.btnCopyLink.textContent = '복사', 1200);
});
els.btnOpenStudent?.addEventListener('click', () => window.open(els.studentLink?.value || '#', '_blank'));

els.btnStart?.addEventListener('click', startQuiz);
els.btnPrev?.addEventListener('click', () => step(-1));
els.btnNext?.addEventListener('click', () => step(+1));
els.btnEndAll?.addEventListener('click', finishAll);

els.btnExportCSV?.addEventListener('click', async () => {
  const r = (await roomRef(roomId).get()).data();
  const snap = await respCol(roomId).get();
  const rows = []; rows.push(['userId', 'name', ...(r.questions || []).map((_, i) => `Q${i + 1}`), 'score'].join(','));
  snap.forEach(d => {
    const s = d.data(); let score = 0;
    const answers = (r.questions || []).map((q, i) => { const a = s.answers?.[i]; if (a?.correct) score++; return q.type === 'mcq' ? (typeof a?.value === 'number' ? a.value + 1 : '') : (a?.value ?? ''); });
    rows.push([d.id, `"${(s.name || '').replace(/"/g, '""')}"`, ...answers, score].join(','));
  });
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' }); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${r.title || roomId}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
});
els.btnResetAll?.addEventListener('click', async () => {
  if (!confirm('모든 응답/점수를 초기화할까요?')) return;
  await roomRef(roomId).set({ mode: 'idle', currentIndex: -1, accept: false, reveal: false }, { merge: true });
  const snap = await respCol(roomId).get(); const tasks = [];
  snap.forEach(d => tasks.push(respCol(roomId).doc(d.id).set({ answers: {}, alive: true }, { merge: true })));
  await Promise.all(tasks); alert('초기화 완료');
});

// 학생
els.btnJoin?.addEventListener('click', join);
els.btnShortSend?.addEventListener('click', () => submit((els.shortInput?.value || '').trim()));

/* ------------------ boot ------------------ */
function autoReconnect() {
  loadLocal();

  // URL로 학생 모드 열기: ?role=student&room=class1
  const url = new URL(location.href);
  const role = url.searchParams.get('role'); const rid = url.searchParams.get('room');

  if (role === 'student') {
    MODE = 'student';
    els.pBuild?.classList.add('hide'); els.pOptions?.classList.add('hide'); els.pResults?.classList.add('hide');
    els.studentPanel?.classList.remove('hide');
  } else {
    MODE = 'admin';
  }

  setMode(MODE);

  if (rid) { if (els.roomId) els.roomId.value = rid; connect(); }
}
autoReconnect();
