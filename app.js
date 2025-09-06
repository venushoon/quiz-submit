/* app.js — 최종본 (교사용/학생용 공용 스크립트)
   - 세션 자동 재연결/복원
   - 제출 정책: device(기기당 1회) | name(실명당 1회)
   - 자동-다음(타이머) + 프레젠테이션/결과 반영
   - 전체 초기화(세션/빈폼/응답 전부 삭제)
   - QR 링크 동기화
*/

(() => {
  // -----------------------------
  // 유틸 & 안전한 DOM 헬퍼
  // -----------------------------
  const $ = (id) => document.getElementById(id) || null;
  const text = (el, s) => { if (el) el.textContent = s; };
  const show = (el, on = true) => { if (el) el.classList.toggle('hidden', !on); };
  const val = (el) => (el ? (el.value ?? '').trim() : '');
  const setVal = (el, v) => { if (el) el.value = v; };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const rand = () => Math.random().toString(36).slice(2, 10);

  // localStorage 키
  const LS = {
    room: 'quiz_room_id',
    role: 'quiz_role',       // 'teacher' | 'student'
    device: 'quiz_device_id',
    name: 'quiz_name',
  };

  // -----------------------------
  // Firebase 초기화
  // -----------------------------
  // window.firebaseConfig 가 있으면 그걸 사용. 없으면 예시값(사용자 제공) 사용
  const fallbackConfig = {
    apiKey: "AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo",
    authDomain: "live-quiz-a14d1.firebaseapp.com",
    projectId: "live-quiz-a14d1",
  };

  const config = window.firebaseConfig || fallbackConfig;

  // Firebase v9 modular import (전역 firebase가 이미 로드된 상태 가정)
  const app = firebase.initializeApp(config);
  const db = firebase.firestore();
  const Field = firebase.firestore.FieldValue;

  // -----------------------------
  // 상태
  // -----------------------------
  let state = {
    roomId: localStorage.getItem(LS.room) || '',
    role: localStorage.getItem(LS.role) || 'teacher', // 기본 관리자
    me: {
      deviceId: localStorage.getItem(LS.device) || '',
      name: localStorage.getItem(LS.name) || '',
      idKey: '', // 정책에 따른 제출 식별자(deviceId 또는 name)
    },
    roomSnapUnsub: null,
    respUnsub: null,
    lastRoom: null,   // 최신 rooms/{roomId} snapshot data
    timer: {
      remain: 0,
      handle: null,
      running: false,
    },
  };

  if (!state.me.deviceId) {
    state.me.deviceId = `dev_${rand()}`;
    localStorage.setItem(LS.device, state.me.deviceId);
  }

  // -----------------------------
  // DOM 레퍼런스 (있을 경우만)
  // -----------------------------
  const refs = {
    // 상단 공통
    roomInput: $('roomInput'),
    btnConnect: $('btnConnect'),
    statusText: $('statusText'),
    badgeLive: $('badgeLive'),
    badgeOnline: $('badgeOnline'),

    // 모드 전환
    btnTeacher: $('btnTeacher'),
    btnStudent: $('btnStudent'),

    // 안내 가이드
    guideTeacher: $('guideTeacher'),
    guideStudent: $('guideStudent'),

    // 탭
    tabBuildBtn: $('tabBuildBtn'),
    tabControlBtn: $('tabControlBtn'),
    tabPresentBtn: $('tabPresentBtn'),
    tabResultsBtn: $('tabResultsBtn'),
    tabBuild: $('tabBuild'),
    tabControl: $('tabControl'),
    tabPresent: $('tabPresent'),
    tabResults: $('tabResults'),

    // 빌더
    quizTitle: $('quizTitle'),
    questionCount: $('questionCount'),
    btnNewBlank: $('btnNewBlank'),
    btnLoadSample: $('btnLoadSample'),
    btnSaveQuiz: $('btnSaveQuiz'),
    builder: $('builder'),

    // 컨트롤
    btnStart: $('btnStart'),
    btnPrev: $('btnPrev'),
    btnNext: $('btnNext'),
    btnStop: $('btnStop'),
    acceptToggle: $('acceptToggle'),
    policySelect: $('policySelect'),       // 'device' | 'name'
    autoNextToggle: $('autoNextToggle'),   // 자동 다음
    timerSeconds: $('timerSeconds'),
    btnTimerStart: $('btnTimerStart'),
    btnTimerStop: $('btnTimerStop'),
    remainText: $('remainText'),
    nowLabel: $('nowLabel'),

    // QR & 링크
    qrCanvas: $('qrCanvas'),
    studentUrl: $('studentUrl'),
    btnCopyLink: $('btnCopyLink'),
    btnOpenStudent: $('btnOpenStudent'),

    // 학생 영역
    studentName: $('studentName'),
    btnJoin: $('btnJoin'),
    studentQuestion: $('studentQuestion'),
    studentTypeBadge: $('studentTypeBadge'),
    studentProgress: $('studentProgress'),
    studentOptions: $('studentOptions'),
    studentShortWrap: $('studentShortWrap'),
    studentShortInput: $('studentShortInput'),
    btnStudentSubmit: $('btnStudentSubmit'),
    studentState: $('studentState'),

    // 프레젠테이션
    presentTitle: $('presentTitle'),
    presentQuestion: $('presentQuestion'),
    presentLegendOk: $('presentLegendOk'),
    presentLegendNo: $('presentLegendNo'),
    presentLegendNone: $('presentLegendNone'),
    presentChoices: $('presentChoices'),

    // 결과 / 내보내기 / 초기화
    btnExportCSV: $('btnExportCSV'),
    btnResetAll: $('btnResetAll'),
    resultsTable: $('resultsTable'),
  };

  // -----------------------------
  // 세션-UI 유틸
  // -----------------------------
  function setRole(role) {
    state.role = role; // 'teacher' | 'student'
    localStorage.setItem(LS.role, role);

    // 가이드 표시
    show(refs.guideTeacher, role === 'teacher');
    show(refs.guideStudent, role === 'student');

    // 초기 안내 문구
    text(refs.statusText,
      role === 'teacher'
        ? (state.roomId ? `세션: ${state.roomId} · 온라인` : '관리자 모드: 세션에 접속해 주세요.')
        : (state.roomId ? `세션: ${state.roomId} · 온라인` : '학생 모드: 세션에 접속해 주세요.')
    );
  }

  function setTabs(name) {
    const sections = [
      ['tabBuild', refs.tabBuild],
      ['tabControl', refs.tabControl],
      ['tabPresent', refs.tabPresent],
      ['tabResults', refs.tabResults]
    ];
    sections.forEach(([key, el]) => show(el, key === name));
  }

  function currentRoomRef() {
    if (!state.roomId) return null;
    return db.collection('rooms').doc(state.roomId);
  }

  function responsesColRef() {
    const ref = currentRoomRef();
    if (!ref) return null;
    return ref.collection('responses');
  }

  function ensureIdKey(policy) {
    if (policy === 'name') {
      const nm = val(refs.studentName) || state.me.name;
      if (!nm) return '';
      state.me.name = nm;
      localStorage.setItem(LS.name, nm);
      state.me.idKey = `name:${nm}`;
      return state.me.idKey;
    }
    // device(기본)
    state.me.idKey = `dev:${state.me.deviceId}`;
    return state.me.idKey;
  }

  function studentUrlOf(roomId) {
    const base = location.origin + location.pathname;
    // 학생용 모드 쿼리 파라미터
    return `${base}?role=student&room=${encodeURIComponent(roomId)}`;
  }

  function refreshQR() {
    if (!refs.qrCanvas || !state.roomId) return;
    const url = studentUrlOf(state.roomId);
    if (refs.studentUrl) refs.studentUrl.value = url;
    // qrcode.min.js가 로드된 경우에만
    if (window.QRCode) {
      try {
        const canvas = refs.qrCanvas;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        QRCode.toCanvas(canvas, url, { width: canvas.width || 180 }, (err) => {
          if (err) console.warn('QR render error:', err);
        });
      } catch (e) {
        console.warn('QR draw error:', e);
      }
    }
  }

  function setOnlineBadge(online) {
    show(refs.badgeOnline, !!online);
  }

  // -----------------------------
  // 방 생성/접속/리스너
  // -----------------------------
  async function connectRoom() {
    const inputId = val(refs.roomInput) || state.roomId;
    if (!inputId) {
      alert('세션 코드를 입력하세요.');
      return;
    }
    state.roomId = inputId;
    localStorage.setItem(LS.room, state.roomId);

    // rooms/{roomId} 보장
    const rRef = currentRoomRef();
    const snap = await rRef.get();
    if (!snap.exists) {
      await rRef.set({
        title: '새 세션',
        mode: 'idle',          // idle | active | ended
        currentIndex: -1,
        accept: false,
        policy: 'device',      // device | name
        autoNext: false,
        createdAt: Field.serverTimestamp(),
        questions: [],
      });
    }

    // 리스너 정리 후 재구독
    if (state.roomSnapUnsub) state.roomSnapUnsub();
    if (state.respUnsub) state.respUnsub();

    state.roomSnapUnsub = rRef.onSnapshot((doc) => {
      if (!doc.exists) return;
      const room = doc.data();
      state.lastRoom = room;
      setOnlineBadge(true);
      text(refs.statusText, `세션: ${state.roomId} · ${room.mode}`);
      applyRoomToUI(room);
      refreshQR(); // 학생 URL/QR 동기화
    }, (err) => {
      console.warn('room snapshot error:', err);
      setOnlineBadge(false);
    });

    state.respUnsub = responsesColRef().onSnapshot((querySnap) => {
      const arr = [];
      querySnap.forEach(d => arr.push({ id: d.id, ...d.data() }));
      applyResponsesToUI(arr);
    }, (err) => console.warn('responses snapshot error:', err));

    // URL 파라미터 정리(역할 유지)
    const url = new URL(location.href);
    url.searchParams.set('room', state.roomId);
    url.searchParams.set('role', state.role);
    history.replaceState(null, '', url.toString());

    refreshQR();
  }

  function applyRoomToUI(room) {
    // 관리자/학생 공통 표현
    text(refs.nowLabel, room.currentIndex >= 0 ? String(room.currentIndex + 1) : '-');

    if (refs.policySelect) refs.policySelect.value = room.policy || 'device';
    if (refs.autoNextToggle) refs.autoNextToggle.checked = !!room.autoNext;
    if (refs.acceptToggle) refs.acceptToggle.checked = !!room.accept;

    // 빌더 반영(제목)
    if (refs.quizTitle) setVal(refs.quizTitle, room.title || '');

    // 관리자 화면들
    if (state.role === 'teacher') {
      renderBuilderPreview(room);
      renderControlPreview(room);
      renderPresentation(room);
    }

    // 학생 화면
    if (state.role === 'student') {
      renderStudentView(room);
    }

    // 결과(표) 갱신
    renderResultsTable();
  }

  function applyResponsesToUI(list) {
    // 프레젠테이션/결과 갱신 등에 사용
    renderPresentation(state.lastRoom, list);
    renderResultsTable(list);
  }

  // -----------------------------
  // 빌더
  // -----------------------------
  function builderCard(no, q = null) {
    // q: {type, text, options, answerIndex, answerText}
    const wrap = document.createElement('div');
    wrap.className = 'card';
    wrap.innerHTML = `
      <div class="row wrap">
        <div class="badge sm mr-2">${no}번</div>
        <label class="switch mr-4">
          <input type="radio" name="type-${no}" value="mcq" ${q?.type === 'short' ? '' : 'checked'}>
          <span>객관식</span>
        </label>
        <label class="switch">
          <input type="radio" name="type-${no}" value="short" ${q?.type === 'short' ? 'checked' : ''}>
          <span>주관식</span>
        </label>
      </div>
      <div class="row wrap mt-2">
        <input class="q-text" data-no="${no}" placeholder="문항 내용" value="${escapeHtml(q?.text || '')}" style="flex:1" />
      </div>
      <div class="mcq mt-2 ${q?.type === 'short' ? 'hidden' : ''}">
        <div class="row wrap gap-2">
          ${(q?.options || ['', '', '', '']).map((v, i) => `
            <input class="opt" data-no="${no}" data-idx="${i}" placeholder="보기 ${i + 1}" value="${escapeHtml(v)}" style="width:220px" />
          `).join('')}
        </div>
        <div class="row wrap mt-2">
          <label>정답 번호</label>
          <input class="ansIndex" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex ?? 0) + 1}" style="width:100px" />
        </div>
      </div>
      <div class="short mt-2 ${q?.type === 'short' ? '' : 'hidden'}">
        <input class="ansText" data-no="${no}" placeholder="정답(자동채점용, 선택)" value="${escapeHtml(q?.answerText || '')}" style="width:280px" />
      </div>
    `;
    // 토글
    const radios = wrap.querySelectorAll(`input[name="type-${no}"]`);
    const mcqBox = wrap.querySelector('.mcq');
    const shortBox = wrap.querySelector('.short');
    radios.forEach(r => r.addEventListener('change', () => {
      const isShort = [...radios].find(x => x.checked)?.value === 'short';
      mcqBox.classList.toggle('hidden', isShort);
      shortBox.classList.toggle('hidden', !isShort);
    }));
    return wrap;
  }

  function renderBuilderPreview(room) {
    if (!refs.builder) return;
    // 이미 카드가 있으면 유지(편집 중 유실 방지)
    if (refs.builder.childElementCount === 0 && room.questions?.length) {
      refs.builder.innerHTML = '';
      room.questions.forEach((q, i) => refs.builder.appendChild(builderCard(i + 1, q)));
    }
  }

  function collectQuizFromBuilder() {
    const cards = refs.builder ? [...refs.builder.querySelectorAll('.card')] : [];
    const questions = cards.map((card, idx) => {
      const no = idx + 1;
      const type = card.querySelector(`input[name="type-${no}"]:checked`)?.value || 'mcq';
      const text = card.querySelector('.q-text')?.value.trim() || '';
      if (!text) return null;

      if (type === 'mcq') {
        const opts = [...card.querySelectorAll('.opt')].map(x => x.value.trim()).filter(Boolean);
        const idxVal = parseInt(card.querySelector('.ansIndex')?.value, 10) - 1;
        const answerIndex = clamp(isNaN(idxVal) ? 0 : idxVal, 0, Math.max(0, opts.length - 1));
        return { type: 'mcq', text, options: opts, answerIndex };
      } else {
        const answerText = card.querySelector('.ansText')?.value.trim() || '';
        return { type: 'short', text, answerText };
      }
    }).filter(Boolean);

    return {
      title: val(refs.quizTitle) || '퀴즈',
      questions,
    };
  }

  async function saveQuiz() {
    const payload = collectQuizFromBuilder();
    if (!payload.questions.length) {
      alert('문항을 하나 이상 추가하세요.');
      return;
    }
    const rRef = currentRoomRef();
    await rRef.set({
      title: payload.title,
      questions: payload.questions,
    }, { merge: true });

    alert('저장 완료!');
  }

  function loadSample() {
    if (!refs.builder) return;
    refs.builder.innerHTML = '';
    const samples = [
      { type: 'mcq', text: '가장 큰 행성?', options: ['지구', '목성', '화성', '금성'], answerIndex: 1 },
      { type: 'short', text: '물의 끓는점(°C)?', answerText: '100' },
      { type: 'mcq', text: '바다의 소금기는 어디서?', options: ['소금산', '강물의 광물질', '하늘', '바람'], answerIndex: 1 },
    ];
    samples.forEach((q, i) => refs.builder.appendChild(builderCard(i + 1, q)));
    setVal(refs.quizTitle, '샘플 퀴즈');
  }

  function newBlank(n = 3) {
    if (!refs.builder) return;
    refs.builder.innerHTML = '';
    for (let i = 0; i < n; i++) refs.builder.appendChild(builderCard(i + 1, null));
    setVal(refs.quizTitle, '새 퀴즈');
  }

  // -----------------------------
  // 컨트롤(시작/이동/정지/타이머)
  // -----------------------------
  async function updateRoom(patch) {
    const ref = currentRoomRef();
    if (!ref) return;
    await ref.set(patch, { merge: true });
  }

  async function startQuiz() {
    const room = state.lastRoom || {};
    if (!room.questions || room.questions.length === 0) {
      alert('먼저 문항을 저장하세요.');
      return;
    }
    await updateRoom({ mode: 'active', currentIndex: 0, accept: true });
  }

  async function stopQuiz() {
    await updateRoom({ mode: 'ended', accept: false });
    stopTimer();
  }

  async function step(delta) {
    const ref = currentRoomRef();
    if (!ref) return;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const r = snap.data();
      const max = (r.questions?.length || 0) - 1;
      const cur = clamp((r.currentIndex ?? -1) + delta, 0, Math.max(0, max));
      tx.set(ref, { currentIndex: cur, accept: true }, { merge: true });

      // 자동 다음 처리: 이전 문제를 자동 공개/채점/탈락 반영
      if (r.autoNext && r.currentIndex >= 0 && r.currentIndex <= max) {
        await revealAndScore(r.currentIndex, snap.ref);
      }
    });
  }

  async function revealAndScore(qIndex, roomRef) {
    const r = state.lastRoom || (await roomRef.get()).data();
    const q = r?.questions?.[qIndex];
    if (!q) return;

    const respRef = roomRef.collection('responses');
    const qs = await respRef.get();
    const batch = db.batch();

    qs.forEach((doc) => {
      const d = doc.data();
      const a = d.answers?.[qIndex];
      if (!a) return;

      let correct = !!a.correct;
      if (q.type === 'mcq' && typeof a.value === 'number') {
        correct = a.value === (q.answerIndex ?? -1);
      } else if (q.type === 'short' && typeof a.value === 'string') {
        const n = (s) => String(s).trim().toLowerCase();
        correct = q.answerText ? (n(a.value) === n(q.answerText)) : !!a.correct;
      }
      const newStatus = correct ? (d.status || 'alive') : 'out';

      batch.set(doc.ref, {
        [`answers.${qIndex}.correct`]: correct,
        [`answers.${qIndex}.revealed`]: true,
        status: newStatus,
      }, { merge: true });
    });

    await batch.commit();
  }

  // 타이머
  function startTimer(sec) {
    stopTimer();
    state.timer.remain = Math.max(0, parseInt(sec || '0', 10) || 0);
    if (refs.remainText) refs.remainText.textContent = formatRemain(state.timer.remain);
    state.timer.running = true;
    state.timer.handle = setInterval(async () => {
      state.timer.remain -= 1;
      if (refs.remainText) refs.remainText.textContent = formatRemain(state.timer.remain);
      if (state.timer.remain <= 0) {
        stopTimer();
        // 제출 닫고 자동-다음이면 공개/채점 후 다음으로
        const r = state.lastRoom || {};
        await updateRoom({ accept: false });
        if (r.autoNext && r.currentIndex >= 0) {
          await revealAndScore(r.currentIndex, currentRoomRef());
          await step(+1);
        }
      }
    }, 1000);
  }
  function stopTimer() {
    state.timer.running = false;
    if (state.timer.handle) clearInterval(state.timer.handle);
    state.timer.handle = null;
    if (refs.remainText) refs.remainText.textContent = formatRemain(0);
  }
  function formatRemain(s) {
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  // -----------------------------
  // 학생 화면
  // -----------------------------
  function renderStudentView(room) {
    if (!refs.studentQuestion) return;
    const idx = room.currentIndex;
    const q = room.questions?.[idx];

    text(refs.studentQuestion, q ? q.text : '대기 중입니다…');
    text(refs.studentTypeBadge, q ? (q.type === 'mcq' ? '객관식' : '주관식') : '대기');
    text(refs.studentProgress, q ? `${idx + 1} / ${room.questions.length}` : `0 / 0`);
    text(refs.studentState, '');

    if (!q || room.mode !== 'active') {
      if (refs.studentOptions) refs.studentOptions.innerHTML = '';
      show(refs.studentShortWrap, false);
      show(refs.studentOptions, false);
      show(refs.btnStudentSubmit, false);
      return;
    }

    if (q.type === 'mcq') {
      show(refs.studentShortWrap, false);
      show(refs.btnStudentSubmit, false);
      show(refs.studentOptions, true);
      refs.studentOptions.innerHTML = '';
      (q.options || []).forEach((o, i) => {
        const b = document.createElement('button');
        b.className = 'chip lg';
        b.textContent = `${i + 1}. ${o}`;
        b.disabled = !room.accept;
        b.addEventListener('click', () => submitAnswer(i));
        refs.studentOptions.appendChild(b);
      });
    } else { // short
      show(refs.studentOptions, false);
      show(refs.studentShortWrap, true);
      show(refs.btnStudentSubmit, true);
      refs.btnStudentSubmit.disabled = !room.accept;
      setVal(refs.studentShortInput, '');
    }
  }

  async function joinStudent() {
    if (!state.roomId) {
      alert('먼저 세션에 접속하세요.');
      return;
    }
    const room = state.lastRoom || {};
    const policy = room.policy || 'device';
    const key = ensureIdKey(policy);
    if (!key) {
      alert('이름을 입력하세요.');
      return;
    }
    const col = responsesColRef();
    await col.doc(key).set({
      name: state.me.name || '(무명)',
      joinedAt: Field.serverTimestamp(),
      status: 'alive',
      answers: {},
    }, { merge: true });
    alert(`${state.me.name || '학생'} 참가 완료!`);
  }

  async function submitAnswer(value) {
    const room = state.lastRoom || {};
    if (!room.accept) { alert('제출이 허용되지 않습니다.'); return; }
    const idx = room.currentIndex;
    if (idx == null || idx < 0) return;

    const policy = room.policy || 'device';
    const key = ensureIdKey(policy);
    if (!key) { alert('이름을 입력하세요.'); return; }

    // 1회 제출 제한(정책에 따라 동일 키)
    const respRef = responsesColRef().doc(key);
    const snap = await respRef.get();
    const curAnswers = snap.exists ? (snap.data().answers || {}) : {};
    if (curAnswers[idx] && curAnswers[idx].locked) {
      alert('이미 제출되었습니다.');
      return;
    }

    let correct = null;
    const q = room.questions?.[idx];
    if (q) {
      if (q.type === 'mcq' && typeof value === 'number') {
        correct = (value === (q.answerIndex ?? -999));
      } else if (q.type === 'short' && typeof value === 'string') {
        const n = s => String(s).trim().toLowerCase();
        correct = q.answerText ? n(value) === n(q.answerText) : null;
      }
    }

    const payload = {
      name: state.me.name || '(무명)',
      [`answers.${idx}`]: {
        value,
        correct: correct === true,
        revealed: (q?.type === 'mcq'), // 객관식은 바로 공개(색표시용), 주관식은 채점 후 반영
        ts: Field.serverTimestamp(),
        locked: true, // 1회 제출 고정
      }
    };
    await respRef.set(payload, { merge: true });
    text(refs.studentState, '제출 완료!');
  }

  // -----------------------------
  // 프레젠테이션 / 결과
  // -----------------------------
  function renderPresentation(room = state.lastRoom, respList = null) {
    if (!refs.presentQuestion) return;
    if (!room) return;

    const idx = room.currentIndex;
    const q = room.questions?.[idx];
    text(refs.presentTitle, room.title || '퀴즈');
    text(refs.presentQuestion, q ? q.text : '대기 중입니다…');

    // 보기
    if (refs.presentChoices) {
      refs.presentChoices.innerHTML = '';
      if (q?.type === 'mcq') {
        (q.options || []).forEach((o, i) => {
          const chip = document.createElement('div');
          chip.className = 'chip lg';
          chip.textContent = `${i + 1}. ${o}`;
          refs.presentChoices.appendChild(chip);
        });
      }
    }

    // 범례 카운트
    if (!respList) return;
    const total = respList.length;
    const ok = respList.filter(s => s.answers?.[idx]?.correct).length;
    const submitted = respList.filter(s => s.answers?.[idx]).length;
    const wrong = submitted - ok;
    const none = total - submitted;

    text(refs.presentLegendOk, String(ok));
    text(refs.presentLegendNo, String(wrong));
    text(refs.presentLegendNone, String(none));
  }

  function renderResultsTable(respList = null) {
    if (!refs.resultsTable || !state.lastRoom) return;
    const room = state.lastRoom;
    const qn = (room.questions || []).length;
    // resp
    if (!respList) return;

    const thead = refs.resultsTable.querySelector('thead');
    const tbody = refs.resultsTable.querySelector('tbody');
    if (thead) {
      thead.innerHTML = '';
      const tr = document.createElement('tr');
      ['이름', ...Array.from({ length: qn }).map((_, i) => `Q${i + 1}`), '점수', '상태'].forEach(h => {
        const th = document.createElement('th'); th.textContent = h; tr.appendChild(th);
      });
      thead.appendChild(tr);
    }
    if (tbody) {
      tbody.innerHTML = '';
      respList.forEach(s => {
        let score = 0;
        const tr = document.createElement('tr');
        const tdName = document.createElement('td'); tdName.textContent = s.name || s.id; tr.appendChild(tdName);
        for (let i = 0; i < qn; i++) {
          const a = s.answers?.[i];
          const td = document.createElement('td');
          if (a) {
            if (a.correct) score++;
            td.textContent = (typeof a.value === 'number') ? String(a.value + 1) : (a.value || '-');
            td.className = a.correct ? 'ok' : 'no';
          } else {
            td.textContent = '-';
          }
          tr.appendChild(td);
        }
        const tdScore = document.createElement('td'); tdScore.textContent = String(score); tr.appendChild(tdScore);
        const tdStatus = document.createElement('td'); tdStatus.textContent = s.status || 'alive'; tr.appendChild(tdStatus);
        tbody.appendChild(tr);
      });
    }
  }

  async function exportCSV() {
    if (!state.roomId) return;
    const roomSnap = await currentRoomRef().get();
    const room = roomSnap.data();
    const resSnap = await responsesColRef().get();
    const header = ['userId', 'name', ...(room.questions || []).map((_, i) => `Q${i + 1}`), 'score', 'status'];
    const rows = [header.join(',')];
    resSnap.forEach(doc => {
      const d = doc.data();
      let score = 0;
      const arr = (room.questions || []).map((q, i) => {
        const a = d.answers?.[i];
        if (a?.correct) score++;
        return a ? (typeof a.value === 'number' ? a.value + 1 : a.value) : '';
      });
      rows.push([doc.id, escapeCsv(d.name || ''), ...arr.map(escapeCsv), score, d.status || ''].join(','));
    });

    downloadFile(`${room.title || state.roomId}-results.csv`, rows.join('\n'), 'text/csv');
  }

  async function resetAll() {
    if (!state.roomId) { alert('세션 없음'); return; }
    if (!confirm('정말 전체 초기화(세션/문항/응답 전부 삭제) 하시겠어요?')) return;

    const rRef = currentRoomRef();
    // responses 전체 삭제
    const resSnap = await responsesColRef().get();
    const batch = db.batch();
    resSnap.forEach(d => batch.delete(d.ref));
    await batch.commit();

    // rooms 기본값
    await rRef.set({
      title: '새 세션',
      mode: 'idle',
      currentIndex: -1,
      accept: false,
      policy: 'device',
      autoNext: false,
      questions: [],
      createdAt: Field.serverTimestamp(),
    });

    // 빌더 UI 비우기
    if (refs.builder) refs.builder.innerHTML = '';
    if (refs.quizTitle) setVal(refs.quizTitle, '새 퀴즈');
    stopTimer();
    alert('초기화 완료!');
  }

  // -----------------------------
  // 파일 저장/불러오기 (JSON)
  // -----------------------------
  async function downloadRoomJson() {
    const snap = await currentRoomRef().get();
    const data = snap.data();
    downloadFile(`room-${state.roomId}.json`, JSON.stringify(data, null, 2));
  }

  async function loadRoomJson(file) {
    if (!file) return;
    const txt = await file.text();
    try {
      const data = JSON.parse(txt);
      await currentRoomRef().set(data, { merge: false });
      alert('불러오기 완료(방 전체 갱신).');
    } catch (e) {
      alert('JSON 형식 오류');
    }
  }

  // -----------------------------
  // 잡다 유틸
  // -----------------------------
  function escapeHtml(s = '') {
    return s.replace(/[&<>\"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
  function escapeCsv(v) {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function downloadFile(name, content, mime = 'application/octet-stream') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // -----------------------------
  // 이벤트 바인딩
  // -----------------------------
  refs.btnConnect && refs.btnConnect.addEventListener('click', connectRoom);

  refs.btnTeacher && refs.btnTeacher.addEventListener('click', () => setRole('teacher'));
  refs.btnStudent && refs.btnStudent.addEventListener('click', () => setRole('student'));

  refs.tabBuildBtn && refs.tabBuildBtn.addEventListener('click', () => setTabs('tabBuild'));
  refs.tabControlBtn && refs.tabControlBtn.addEventListener('click', () => setTabs('tabControl'));
  refs.tabPresentBtn && refs.tabPresentBtn.addEventListener('click', () => setTabs('tabPresent'));
  refs.tabResultsBtn && refs.tabResultsBtn.addEventListener('click', () => setTabs('tabResults'));

  refs.btnLoadSample && refs.btnLoadSample.addEventListener('click', loadSample);
  refs.btnNewBlank && refs.btnNewBlank.addEventListener('click', () => newBlank(parseInt(val(refs.questionCount) || '3', 10)));
  refs.btnSaveQuiz && refs.btnSaveQuiz.addEventListener('click', saveQuiz);

  refs.btnStart && refs.btnStart.addEventListener('click', startQuiz);
  refs.btnStop && refs.btnStop.addEventListener('click', stopQuiz);
  refs.btnPrev && refs.btnPrev.addEventListener('click', () => step(-1));
  refs.btnNext && refs.btnNext.addEventListener('click', () => step(+1));
  refs.acceptToggle && refs.acceptToggle.addEventListener('change', () => updateRoom({ accept: !!refs.acceptToggle.checked }));
  refs.policySelect && refs.policySelect.addEventListener('change', () => updateRoom({ policy: refs.policySelect.value || 'device' }));
  refs.autoNextToggle && refs.autoNextToggle.addEventListener('change', () => updateRoom({ autoNext: !!refs.autoNextToggle.checked }));

  refs.btnTimerStart && refs.btnTimerStart.addEventListener('click', () => startTimer(val(refs.timerSeconds)));
  refs.btnTimerStop && refs.btnTimerStop.addEventListener('click', stopTimer);

  refs.btnJoin && refs.btnJoin.addEventListener('click', joinStudent);
  refs.btnStudentSubmit && refs.btnStudentSubmit.addEventListener('click', () => submitAnswer(val(refs.studentShortInput)));

  refs.btnCopyLink && refs.btnCopyLink.addEventListener('click', async () => {
    const u = refs.studentUrl?.value || '';
    if (!u) return;
    await navigator.clipboard.writeText(u);
    alert('링크 복사 완료!');
  });
  refs.btnOpenStudent && refs.btnOpenStudent.addEventListener('click', () => {
    const u = refs.studentUrl?.value || '';
    if (u) window.open(u, '_blank');
  });

  refs.btnExportCSV && refs.btnExportCSV.addEventListener('click', exportCSV);
  refs.btnResetAll && refs.btnResetAll.addEventListener('click', resetAll);

  // 파일 불러오기 input(optional): <input type="file" id="roomJsonFile">
  const fileInput = $('roomJsonFile');
  fileInput && fileInput.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    loadRoomJson(f);
    e.target.value = '';
  });

  // -----------------------------
  // 초기 복원(세션 자동 연결)
  // -----------------------------
  (async function bootstrap() {
    // URL 파라미터로 role/room 주어지면 우선
    const url = new URL(location.href);
    const roomQ = url.searchParams.get('room');
    const roleQ = url.searchParams.get('role');
    if (roleQ === 'teacher' || roleQ === 'student') {
      setRole(roleQ);
    } else {
      setRole(state.role);
    }
    if (roomQ) {
      state.roomId = roomQ;
      localStorage.setItem(LS.room, state.roomId);
    }
    if (refs.roomInput) setVal(refs.roomInput, state.roomId);

    // 자동 접속
    if (state.roomId) {
      await connectRoom();
    } else {
      setOnlineBadge(false);
    }

    // 초기 탭
    if (state.role === 'teacher') setTabs('tabBuild'); else setTabs('tabPresent');

    // QR 초기
    refreshQR();
  })();

})();
