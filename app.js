// ===== 유틸 =====
const $ = (id) => document.getElementById(id);
const CE = (tag, cls) => { const el = document.createElement(tag); if(cls) el.className = cls; return el; };

// ===== DOM 엘리먼트 캐시 =====
const els = {
  sessionInput: $("sessionInput"), btnConnect: $("btnConnect"), btnDisconnect: $("btnDisconnect"), sessionStatus: $("sessionStatus"),
  tabs: document.querySelectorAll('.tabs .tab'), panels: document.querySelectorAll('.panel.admin-only'),
  tabQ: $("tabQ"), tabOpt: $("tabOpt"), tabPres: $("tabPres"), tabRes: $("tabRes"),
  panelQ: $("panelQ"), panelOpt: $("panelOpt"), panelPres: $("panelPres"), panelRes: $("panelRes"),
  quizTitle: $("quizTitle"), btnBlank: $("btnBlank"), btnSample: $("btnSample"), btnSaveQ: $("btnSaveQ"),
  qText: $("qText"), qType: $("qType"), qAnswer: $("qAnswer"), qImg: $("qImg"),
  mcqBox: $("mcqBox"), opt1: $("opt1"), opt2: $("opt2"), opt3: $("opt3"), opt4: $("opt4"),
  btnAddQ: $("btnAddQ"), qList: $("qList"),
  onceDevice: $("onceDevice"), onceName: $("onceName"),
  allowSubmit: $("allowSubmit"), openResult: $("openResult"),
  timerSec: $("timerSec"), btnOptSave: $("btnOptSave"), btnOptReset: $("btnOptReset"),
  qrCard: $("qrCard"), qrImg: $("qrImg"), studentLink: $("studentLink"), btnCopy: $("btnCopy"), btnOpen: $("btnOpen"),
  btnStart: $("btnStart"), btnPrev: $("btnPrev"), btnNext: $("btnNext"), btnEnd: $("btnEnd"),
  chipJoin: $("chipJoin"), chipSubmit: $("chipSubmit"), chipCorrect: $("chipCorrect"), chipWrong: $("chipWrong"),
  qCounter: $("qCounter"),
  pTitle: $("pTitle"), presHint: $("presHint"), pWrap: $("pWrap"), pQText: $("pQText"), pQImg: $("pQImg"), pOpts: $("pOpts"),
  btnExport: $("btnExport"), btnResetAll: $("btnResetAll"), resHead: $("resHead"), resBody: $("resBody"),
  studentPanel: $("studentPanel"),
  joinDialog: $("joinDialog"), joinName: $("joinName"), btnJoin: $("btnJoin"),
  sWrap: $("sWrap"), sTitle: $("sTitle"), sState: $("sState"), sQBox: $("sQBox"),
  sQTitle: $("sQTitle"), sQImg: $("sQImg"), sOptBox: $("sOptBox"),
  sShortWrap: $("sShortWrap"), sShort: $("sShort"), btnShortSend: $("btnShortSend"),
  sSubmitBox: $("sSubmitBox"),
  sDone: $("sDone"), btnMyResult: $("btnMyResult"), myResult: $("myResult")
};

// ===== 전역 상태 =====
let ROOM = null;
let MODE = "admin";
let roomUnsub = null;
let editQuestions = [];

const U = new URL(location.href);
if ((U.searchParams.get("role")||"").toLowerCase() === "student" && U.searchParams.get("room")) {
  MODE = "student";
  ROOM = U.searchParams.get("room").trim();
}

const getStudentId = () => {
  let id = localStorage.getItem("quiz_student_id");
  if(!id){ id = crypto.randomUUID(); localStorage.setItem("quiz_student_id", id); }
  return id;
};

// ===== 공통 함수 =====
function setTab(activeTabId) {
  els.tabs.forEach(tab => tab.classList.toggle('active', tab.id === activeTabId));
  els.panels.forEach(panel => panel.classList.toggle('hide', panel.id !== `panel${activeTabId.slice(3)}`));
  // [요청 1] 옵션 탭에서만 QR 카드 보이기
  els.qrCard.classList.toggle('hide', activeTabId !== 'tabOpt');
}

// [요청 6] QR/링크 생성 (API 방식)
function buildStudentLink(room) {
  const studentUrl = `${location.origin}${location.pathname}?role=student&room=${encodeURIComponent(room)}`;
  els.studentLink.value = studentUrl;
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(studentUrl)}`;
  els.qrImg.src = qrApiUrl;
}

function defaultRoom(){
  return {
    title: "새 퀴즈",
    questions: [],
    currentIndex: -1, mode: "idle", accept: true,
    counters: { join:0, submit:0, correct:0, wrong:0 },
    createdAt: window.FS.serverTimestamp(),
    policy: { once:"device", openResult:false, timer: 30 }
  };
}

// ===== 관리자 플로우 =====
async function connect() {
    const room = els.sessionInput.value.trim();
    if(!room) { alert("세션 코드를 입력하세요."); return; }
    ROOM = room;

    const docRef = window.FS.doc("rooms", ROOM);
    const doc = await window.FS.getDoc(docRef);
    if (!doc.exists) {
        await window.FS.setDoc(docRef, defaultRoom());
    }

    els.sessionInput.disabled = true;
    els.btnConnect.disabled = true;
    els.btnDisconnect.disabled = false;
    els.sessionStatus.textContent = `세션: ${ROOM} · 온라인`;

    buildStudentLink(ROOM);
    setTab('tabQ');

    if(roomUnsub) roomUnsub();
    roomUnsub = window.FS.onSnapshot(docRef, snap => {
        if(snap.exists) renderRoom(snap.data());
    });
}

function disconnect() {
    if(roomUnsub) roomUnsub();
    roomUnsub = null; ROOM = null;
    els.sessionInput.disabled = false;
    els.btnConnect.disabled = false;
    els.btnDisconnect.disabled = true;
    els.sessionStatus.textContent = `세션: - · 오프라인`;
    els.studentLink.value = "";
    els.qrImg.src = "";
}

function addQuestionUI() {
    const type = els.qType.value;
    const text = els.qText.value.trim();
    if(!text) { alert("문항을 입력하세요."); return; }

    let q = { type, text };
    if (type === "mcq") {
        const opts = [els.opt1.value, els.opt2.value, els.opt3.value, els.opt4.value].map(s => s.trim());
        const ans = parseInt(els.qAnswer.value, 10) - 1;
        if (opts.some(v => !v)) { alert("객관식 보기 1~4를 모두 입력하세요."); return; }
        if (!Number.isInteger(ans) || ans < 0 || ans > 3) { alert("정답 번호(1~4)를 입력하세요."); return; }
        q.options = opts; q.answer = ans;
    } else {
        const ansT = els.qAnswer.value.trim();
        if (!ansT) { alert("주관식 정답 텍스트를 입력하세요."); return; }
        q.answerText = ansT;
    }

    const file = els.qImg.files[0];
    const pushQ = (newQ) => {
        editQuestions.push(newQ);
        const it = CE("div", "item");
        it.textContent = (newQ.type === "mcq" ? "[객관식] " : "[주관식] ") + newQ.text;
        els.qList.prepend(it);
        els.qText.value = ""; els.qAnswer.value = ""; ["opt1", "opt2", "opt3", "opt4"].forEach(k => els[k].value = ""); els.qImg.value = "";
    };

    if (file) {
        const reader = new FileReader();
        reader.onload = () => { q.image = reader.result; pushQ(q); };
        reader.readAsDataURL(file);
    } else {
        pushQ(q);
    }
}

async function saveQuestions() {
    if (!ROOM) { alert("먼저 세션에 접속하세요."); return; }
    const docRef = window.FS.doc("rooms", ROOM);
    const doc = await window.FS.getDoc(docRef);
    const currentQuestions = doc.exists ? doc.data().questions || [] : [];
    
    const newQuestions = [...editQuestions.reverse(), ...currentQuestions];
    const title = els.quizTitle.value || doc.data()?.title || "퀴즈";

    await window.FS.setDoc(docRef, { questions: newQuestions, title }, { merge: true });
    editQuestions = [];
    els.qList.innerHTML = "";
    alert("문항 저장 완료");
}

function makeBlank() {
    els.quizTitle.value = "";
    els.qText.value = ""; els.qAnswer.value = "";
    ["opt1", "opt2", "opt3", "opt4"].forEach(k => els[k].value = "");
    els.qImg.value = "";
    editQuestions = []; els.qList.innerHTML = "";
}

function loadSample() {
    makeBlank();
    const sampleQuestions = [
        { type:"mcq", text:"가장 큰 행성은?", options:["지구","목성","화성","금성"], answer:1 },
        { type:"mcq", text:"태양에서 세 번째 행성?", options:["수성","화성","지구","금성"], answer:2 },
        { type:"short", text:"지구의 위성 이름은?", answerText:"달" }
    ];
    sampleQuestions.forEach(q => {
        editQuestions.push(q);
        const it = CE("div","item");
        it.textContent = (q.type==="mcq" ? "[객관식] " : "[주관식] ") + q.text;
        els.qList.appendChild(it);
    });
    els.quizTitle.value = "샘플 퀴즈";
}

async function saveOptions() {
    if (!ROOM) { alert("먼저 세션에 접속하세요."); return; }
    const policy = {
        once: els.onceName.checked ? "name" : "device",
        openResult: els.openResult.checked,
        timer: Math.max(0, parseInt(els.timerSec.value,10) || 0)
    };
    const accept = !!els.allowSubmit.checked;
    await window.FS.setDoc(window.FS.doc("rooms", ROOM), { policy, accept }, { merge:true });
    buildStudentLink(ROOM);
    alert("옵션 저장 완료");
}

async function resetAll() {
    if (!ROOM) { alert("먼저 세션에 접속하세요."); return; }
    if(!confirm("이 세션의 모든 문항, 진행상태, 제출 결과를 초기화할까요?")) return;
    await window.FS.setDoc(window.FS.doc("rooms", ROOM), defaultRoom());
    alert("초기화 완료");
}

async function controlQuiz(action) {
    if (!ROOM) { alert("먼저 세션에 접속하세요."); return; }
    const docRef = window.FS.doc("rooms", ROOM);

    if (action === 'start') {
        await window.FS.updateDoc(docRef, { mode: "active", currentIndex: 0, accept: true });
    } else if (action === 'end') {
        await window.FS.updateDoc(docRef, { mode: "ended", accept: false });
    } else {
        const doc = await window.FS.getDoc(docRef);
        if (!doc.exists) return;
        const data = doc.data();
        const max = (data.questions?.length || 0) - 1;
        let cur = data.currentIndex ?? -1;
        
        if (action === 'next') {
            if (cur < max) await window.FS.updateDoc(docRef, { currentIndex: cur + 1 });
            else await controlQuiz('end');
        } else if (action === 'prev') {
            await window.FS.updateDoc(docRef, { currentIndex: Math.max(0, cur - 1) });
        }
    }
}

// ===== 학생 플로우 =====
async function joinStudent() {
    const name = els.joinName.value.trim();
    if(!name) { alert("이름을 입력하세요."); return; }
    
    const sid = getStudentId();
    const docRef = window.FS.doc("rooms", ROOM);
    await window.FS.setDoc(window.FS.doc(docRef, "responses", sid), {
        name, joinedAt: window.FS.serverTimestamp(), deviceId, answers:{}, score:0 
    });
    await window.FS.updateDoc(docRef, { 'counters.join': window.FS.increment(1) });

    els.joinDialog.close();
    els.sWrap.classList.remove("hide");
}

async function submitStudent(answerPayload) {
    const sid = getStudentId();
    const roomRef = window.FS.doc("rooms", ROOM);
    const roomSnap = await window.FS.getDoc(roomRef);
    if(!roomSnap.exists) return;
    
    const doc = roomSnap.data();
    const qIdx = doc.currentIndex;
    if(qIdx < 0 || !doc.accept) { alert("제출 시간이 아닙니다."); return; }

    const q = doc.questions[qIdx];
    const respRef = window.FS.doc(roomRef, "responses", sid);
    const respSnap = await window.FS.getDoc(respRef);
    const data = respSnap.data() || { answers: {} };

    if(data.answers[qIdx] !== undefined) { alert("이미 제출했습니다."); return; }

    let isCorrect = false;
    if (q.type === "mcq") {
        isCorrect = (answerPayload === q.answer);
    } else {
        isCorrect = String(answerPayload || "").trim().toLowerCase() === String(q.answerText || "").trim().toLowerCase();
    }
    
    const updateData = { [`answers.${qIdx}`]: answerPayload };
    if (isCorrect) {
        updateData.score = window.FS.increment(1);
    }
    await window.FS.setDoc(respRef, updateData, { merge: true });
    
    const counterUpdate = { 'counters.submit': window.FS.increment(1) };
    counterUpdate[isCorrect ? 'counters.correct' : 'counters.wrong'] = window.FS.increment(1);
    await window.FS.updateDoc(roomRef, counterUpdate);

    alert(isCorrect ? "정답입니다!" : "제출 완료!");
}

// ===== 렌더링 =====
function renderRoom(r) {
    els.pTitle.textContent = r.title || ""; els.sTitle.textContent = r.title || "";
    els.chipJoin.textContent = r.counters?.join || 0;
    els.chipSubmit.textContent = r.counters?.submit || 0;
    els.chipCorrect.textContent = r.counters?.correct || 0;
    els.chipWrong.textContent = r.counters?.wrong || 0;
    
    const total = r.questions?.length || 0;
    const cur = r.currentIndex ?? -1;
    els.qCounter.textContent = `Q${Math.max(0, cur + 1)}/${total}`;
    if(MODE === 'admin') els.quizTitle.value = r.title || "";

    if (MODE === 'admin') {
        if (r.mode !== 'active' || cur < 0) {
            els.presHint.classList.remove("hide");
            els.pWrap.classList.add("hide");
        } else {
            els.presHint.classList.add("hide");
            els.pWrap.classList.remove("hide");
            const q = r.questions[cur];
            els.pQText.textContent = q.text || "";
            // [요청 5] 이미지 깨짐 방지
            els.pQImg.src = q.image || "";
            els.pQImg.classList.toggle("hide", !q.image);
            els.pOpts.innerHTML = "";
            if (q.type === "mcq") {
                q.options.forEach((opt,i) => {
                    const b = CE("div","popt");
                    b.textContent = `${i+1}. ${opt}`;
                    if (i === q.answer) b.style.borderColor = "var(--green)";
                    els.pOpts.appendChild(b);
                });
            } else {
                const b = CE("div","popt");
                b.textContent = `정답: ${q.answerText||""}`;
                b.style.borderColor = "var(--green)";
                els.pOpts.appendChild(b);
            }
        }
    }

    if (MODE === 'student') {
        // [요청 4] 퀴즈 종료 처리
        if (r.mode === 'ended') {
            els.sWrap.classList.add("hide");
            els.sDone.classList.remove("hide");
            return;
        }
        // [요청 2] 퀴즈 대기 상태 처리
        if (r.mode !== 'active' || cur < 0 || !r.accept) {
            els.sWrap.classList.remove("hide");
            els.sState.textContent = r.accept ? "참가 완료! 퀴즈 시작을 기다려주세요." : "제출이 마감되었습니다.";
            els.sQBox.classList.add("hide");
            return;
        }
        
        const q = r.questions[cur];
        els.sWrap.classList.remove("hide");
        els.sState.textContent = "";
        els.sQBox.classList.remove("hide");
        els.sQTitle.textContent = `Q${cur+1}. ${q.text || ""}`;
        // [요청 5] 이미지 깨짐 방지
        els.sQImg.src = q.image || "";
        els.sQImg.classList.toggle("hide", !q.image);
        els.sOptBox.innerHTML="";
        els.sShortWrap.classList.add("hide");
        els.sSubmitBox.innerHTML = "";

        if (q.type === "mcq") {
            let chosen = null;
            q.options.forEach((opt,i) => {
                const btn = CE("button","sopt");
                btn.textContent = `${i+1}. ${opt}`;
                btn.onclick = () => {
                    chosen = i;
                    document.querySelectorAll('#sOptBox .sopt').forEach(c => c.classList.remove("active"));
                    btn.classList.add("active");
                    renderSubmitButton(chosen);
                };
                els.sOptBox.appendChild(btn);
            });
        } else {
            els.sShortWrap.classList.remove("hide");
        }
    }
}

// [요청 3] 제출 버튼 생성 로직 개선
function renderSubmitButton(chosen) {
    els.sSubmitBox.innerHTML = ""; // 기존 버튼 삭제
    const submitBtn = CE("button","btn green");
    submitBtn.textContent="제출";
    submitBtn.onclick = () => {
        if (chosen === null) alert("보기를 선택하세요");
        else {
            submitStudent(chosen);
            submitBtn.disabled = true; // 한번만 제출
        }
    };
    els.sSubmitBox.appendChild(submitBtn);
}

// ... (나머지 헬퍼 함수들은 여기에 위치합니다)

// ===== 초기화 및 이벤트 바인딩 =====
function bindAdminEvents() {
    els.tabs.forEach(tab => tab.addEventListener('click', () => setTab(tab.id)));
    els.btnConnect.onclick = connect;
    els.btnDisconnect.onclick = disconnect;
    els.btnBlank.onclick = makeBlank;
    els.btnSample.onclick = loadSample;
    els.btnAddQ.onclick = addQuestionUI;
    els.btnSaveQ.onclick = saveQuestions;
    els.btnOptSave.onclick = saveOptions;
    els.btnOptReset.onclick = resetAll;
    els.btnCopy.onclick = () => navigator.clipboard.writeText(els.studentLink.value);
    els.btnOpen.onclick = () => { if(els.studentLink.value) window.open(els.studentLink.value, "_blank"); };
    els.btnStart.onclick = () => controlQuiz('start');
    els.btnPrev.onclick = () => controlQuiz('prev');
    els.btnNext.onclick = () => controlQuiz('next');
    els.btnEnd.onclick = () => controlQuiz('end');
    els.btnExport.onclick = exportCSV;
}

function bindStudentEvents() {
    els.btnJoin.onclick = joinStudent;
    els.btnMyResult.onclick = refreshMyResult;
    els.btnShortSend.onclick = () => submitStudent(els.sShort.value);
}

function init() {
    if (!window.firebase || !window.db) {
        alert("Firebase 라이브러리 로딩에 실패했습니다. 인터넷 연결을 확인해주세요.");
        return;
    }
    // [요청 1] 관리자/학생 UI 분리
    if (MODE === 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
        els.studentPanel.style.display = 'none';
        bindAdminEvents();
        setTab('tabQ');
        els.btnDisconnect.disabled = true;
    } else {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
        els.studentPanel.style.display = 'block';
        bindStudentEvents();
        if (ROOM) {
            els.joinDialog.showModal(); // [요청 2] dialog 팝업으로 변경
            const docRef = window.FS.doc("rooms", ROOM);
            roomUnsub = window.FS.onSnapshot(docRef, snap => {
                if(snap.exists) renderRoom(snap.data());
            });
        }
    }
}

document.addEventListener("DOMContentLoaded", init);
