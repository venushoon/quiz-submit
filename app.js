/* ==========================================================
   app.js (최종본) — 디자인/레이아웃은 건드리지 않고 로직만 보강
   ========================================================== */

(function () {
  // 0) 유틸
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const ROLE = document.documentElement.getAttribute('data-role') || 'admin';
  const ROOM = (document.documentElement.getAttribute('data-room') || '').trim();

  // 공용 DOM (있는 경우에만 쓰도록 안전 체크)
  const qrCanvas = $('#qrCanvas');
  const linkInput = $('#studentLink');
  const btnOpenStudent = $('#btnOpenStudent');

  const presHint = $('#presHint');          // "시작 버튼을 누르면…" 안내
  const choiceWrap = $('#choiceWrap');      // 객관식 보기 컨테이너(학생)
  const shortAnswer = $('#shortAnswer');    // 주관식 입력(학생)
  const btnSubmit = $('#btnSubmit');        // 제출 버튼(학생)
  const studentNotice = $('#studentNotice');// 대기 안내(학생)
  const endedWrap = $('#endedWrap');        // 종료 후 블럭(학생)
  const btnMyResult = $('#btnMyResult');    // 내 결과 보기 버튼(학생)

  // Firestore 단축 (index.html에서 compat 초기화 완료 가정)
  const FS = window.FS;
  const db = window.db;

  // 방 참조 도우미
  const roomRef = (roomId) => FS.doc('rooms', roomId);

  // 1) QR/링크 생성 (옵션-저장 시 호출)
  async function buildStudentLink(roomId) {
    const url = `${location.origin}${location.pathname}?role=student&room=${encodeURIComponent(roomId)}`;
    if (linkInput) linkInput.value = url;

    // QRCode 라이브러리 로드 확인
    if (!window.QRCode || !QRCode.toCanvas) {
      console.warn('[QR] 라이브러리 미로딩. 스크립트 순서 확인');
      return;
    }
    if (qrCanvas) {
      try {
        await QRCode.toCanvas(qrCanvas, url, { margin: 1, scale: 4, color: { light: '#0b1220', dark: '#ffffff' } });
      } catch (e) {
        console.warn('[QR] 생성 실패', e);
      }
    }
  }

  // 2) 관리자: 옵션 저장 → QR/링크 갱신 (옵션 저장 버튼 id=btnOptSave 라고 가정)
  const btnOptSave = $('#btnOptSave') || $$('.admin-only button').find(b=>b.textContent?.includes('저장'));
  if (ROLE === 'admin' && btnOptSave) {
    btnOptSave.addEventListener('click', async () => {
      const roomId = getRoomId();
      if (!roomId) return;
      await buildStudentLink(roomId);
    });
  }

  // 3) 관리자: “열기” 버튼 → 학생창
  if (ROLE === 'admin' && btnOpenStudent) {
    btnOpenStudent.addEventListener('click', () => {
      if (!linkInput?.value) return;
      window.open(linkInput.value, '_blank');
    });
  }

  // 4) 방/세션 id
  function getRoomId() {
    // 상단 세션 코드 input이 있다면 사용 (id=roomInput 가정)
    const topInput = $('#roomInput');
    const byAttr = ROOM;
    return (topInput?.value || byAttr || '').trim();
  }

  // 5) 프레젠테이션: 시작/다음/이전/종료 — 버튼 id 가정
  const btnStart = $('#btnStart');
  const btnNext = $('#btnNext');
  const btnPrev = $('#btnPrev');
  const btnEnd  = $('#btnEnd');

  if (ROLE === 'admin') {
    btnStart?.addEventListener('click', () => adminStart());
    btnNext?.addEventListener('click', () => stepQuestion(+1));
    btnPrev?.addEventListener('click', () => stepQuestion(-1));
    btnEnd ?.addEventListener('click', () => adminEnd());
  }

  async function adminStart() {
    const roomId = getRoomId();
    if (!roomId) return;
    await FS.setDoc(roomRef(roomId), { mode: 'active', currentIndex: 0, updatedAt: FS.serverTimestamp() }, { merge: true });
    if (presHint) presHint.style.display = 'none';
  }
  async function stepQuestion(delta) {
    const roomId = getRoomId();
    if (!roomId) return;
    const snap = await FS.getDoc(roomRef(roomId));
    const cur = snap.exists ? (snap.data().currentIndex ?? 0) : 0;
    await FS.updateDoc(roomRef(roomId), { currentIndex: Math.max(0, cur + delta) });
  }
  async function adminEnd() {
    const roomId = getRoomId();
    if (!roomId) return;
    await FS.setDoc(roomRef(roomId), { mode: 'ended', updatedAt: FS.serverTimestamp() }, { merge: true });
    if (presHint) presHint.style.display = ''; // 다시 보이도록(다음 세션 대비)
  }

  // 6) 학생: 실시간 룸 상태 반영(대기 → Q1 노출 → 종료)
  if (ROLE === 'student') {
    const roomId = getRoomId();
    if (!roomId) {
      // 학생 URL에 room 누락 시: 안내
      studentNotice && (studentNotice.textContent = '세션 코드가 없습니다. QR/링크로 다시 접속하세요.');
    } else {
      // 룸 상태 구독
      FS.onSnapshot(roomRef(roomId), (doc) => {
        if (!doc.exists) return;
        const data = doc.data() || {};
        const mode = data.mode || 'idle';
        const idx  = Number.isInteger(data.currentIndex) ? data.currentIndex : 0;

        if (mode === 'active') {
          // 문제 출력
          studentNotice && (studentNotice.style.display = 'none');
          endedWrap && (endedWrap.style.display = 'none');
          renderStudentQuestion(roomId, idx, data);
        } else if (mode === 'ended') {
          // 종료 안내 + 내 결과 보기만
          choiceWrap && (choiceWrap.innerHTML = '');
          shortAnswer && (shortAnswer.value = '');
          endedWrap && (endedWrap.style.display = 'block');
        } else {
          // 대기
          studentNotice && (studentNotice.style.display = 'block');
          endedWrap && (endedWrap.style.display = 'none');
          choiceWrap && (choiceWrap.innerHTML = '');
        }
      });
    }
  }

  // 7) 학생: 문항 렌더링(객관식/주관식) — 문항 데이터는 rooms/{room}/questions 배열/맵을 쓴다고 가정
  function renderStudentQuestion(roomId, index /*, roomData*/) {
    // 문항/보기는 화면의 관리자 입력 → Firestore 반영 구조일 텐데,
    // 여기서는 간단히 관리자 화면에서 뿌려주는 “현재 문항 표시 텍스트/보기”를
    // rooms/{room}/currentQuestion 에 저장한다고 가정합니다.
    FS.getDoc(roomRef(roomId)).then(snap => {
      const d = snap.data() || {};
      const q = d.currentQuestion || {};      // { type:'choice'|'short', text, options:[], answer }
      const type = q.type || 'choice';

      // 텍스트/보기 출력(디자인 유지)
      if (choiceWrap) choiceWrap.innerHTML = '';
      shortAnswer && (shortAnswer.value = '');

      if (type === 'choice') {
        (q.options || []).forEach((opt, i) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = `${i + 1}. ${opt}`;
          b.addEventListener('click', () => {
            choiceWrap.dataset.sel = String(i + 1); // 1~4 선택값 저장
            highlightChoice();
          });
          choiceWrap?.appendChild(b);
        });
        shortAnswer?.setAttribute('hidden', 'hidden'); // 주관식 숨김
      } else {
        // 주관식
        shortAnswer?.removeAttribute('hidden');
      }
    });
  }

  function highlightChoice() {
    const sel = choiceWrap?.dataset.sel;
    $$('#choiceWrap button').forEach(btn => {
      btn.style.outline = '';
      if (sel && btn.textContent?.startsWith(sel + '.')) {
        btn.style.outline = '2px solid #22c55e';
      }
    });
  }

  // 8) 학생 제출
  btnSubmit?.addEventListener('click', async () => {
    const roomId = getRoomId();
    if (!roomId) return;

    // 내 이름(ID) 확보(이미 어딘가에서 입력받아 rooms/{room}/responses/{user} 로 사용)
    const userId = getOrAskUserName();
    const respRef = FS.doc('rooms', roomId, 'responses', userId);

    // 중복 제출 방지(간단히 todaySubmitted 플래그 사용 예)
    const prev = await FS.getDoc(respRef);
    const had = prev.exists && prev.data().submitted?.[DateStamp()];
    if (had) return; // 이미 제출

    // 선택/주관식 값 읽기
    const sel = choiceWrap?.dataset.sel;
    const sa  = shortAnswer?.value?.trim();
    const payload = {
      user: userId,
      at: FS.serverTimestamp(),
      submitted: { ...(prev.data()?.submitted || {}), [DateStamp()]: true }
    };

    if (sel) payload.choice = Number(sel);
    if (sa)  payload.short = sa;

    await FS.setDoc(respRef, payload, { merge: true });
  });

  // 9) 학생: 내 결과 보기 — O/X 표시
  btnMyResult?.addEventListener('click', async () => {
    const roomId = getRoomId();
    if (!roomId) return;
    const user = getOrAskUserName();
    const my = await FS.getDoc(FS.doc('rooms', roomId, 'responses', user));
    const data = my.data() || {};

    // 결과 표시는 기존 “내 결과 표” 레이아웃에 매핑해 주세요.
    // 여기에선 간단히 alert로 O/X 예시만.
    // 실제로는 rooms/{room}/answerKey 에 각 문항의 정답을 저장해 두고 비교하세요.
    alert('제출: ' + (data.choice ?? data.short ?? '-') + '\n정답: O/X 표시는 결과 탭 테이블에 반영됩니다.');
  });

  // 10) 유틸: 사용자명 보관(간단 로컬스토리지)
  function getOrAskUserName() {
    let u = localStorage.getItem('quizUser');
    if (!u) {
      u = prompt('이름 또는 번호를 입력하세요!') || '';
      u = u.trim();
      localStorage.setItem('quizUser', u || 'user');
    }
    return u;
  }
  const DateStamp = () => new Date().toISOString().slice(0, 10);

  // 11) 초기 상태: 관리자 프레젠테이션 안내문 보이기
  if (ROLE === 'admin' && presHint) presHint.style.display = '';

  // 12) 초기: 관리자라면 QR/링크 즉시 준비
  if (ROLE === 'admin') {
    const rid = getRoomId();
    if (rid) buildStudentLink(rid);
  }
})();
