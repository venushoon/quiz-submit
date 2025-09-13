// ===== 유틸 =====
const $ = (id) => document.getElementById(id);
const CE = (tag, cls) => { const el = document.createElement(tag); if(cls) el.className = cls; return el; };

// ===== DOM 엘리먼트 캐시 =====
const els = {
  body: document.body,
  sessionInput: $("sessionInput"), btnConnection: $("btnConnection"), sessionStatus: $("sessionStatus"),
  tabs: document.querySelectorAll('.tabs .tab'), panels: document.querySelectorAll('.panel.admin-only'),
  tabQ: $("tabQ"), tabOpt: $("tabOpt"), tabPres: $("tabPres"), tabRes: $("tabRes"),
  panelQ: $("panelQ"), panelOpt: $("panelOpt"), panelPres: $("panelPres"), panelRes: $("panelRes"),
  quizTitle: $("quizTitle"), btnBlank: $("btnBlank"), btnSample: $("btnSample"), btnSaveQ: $("btnSaveQ"), btnUpload: $("btnUpload"), btnTemplate: $("btnTemplate"),
  qText: $("qText"), qType: $("qType"), qAnswer: $("qAnswer"), qImg: $("qImg"),
  mcqBox: $("mcqBox"), opt1: $("opt1"), opt2: $("opt2"), opt3: $("opt3"), opt4: $("opt4"),
  btnAddQ: $("btnAddQ"), qList: $("qList"),
  onceDevice: $("onceDevice"), onceName: $("onceName"),
  allowSubmit: $("allowSubmit"), openResult: $("openResult"), brightMode: $("brightMode"),
  timerSec: $("timerSec"), btnOptSave: $("btnOptSave"),
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
  let id = localStorage.getItem(`quiz_student_id_${ROOM}`);
  if(!id){ id = crypto.randomUUID(); localStorage.setItem(`quiz_student_id_${ROOM}`, id); }
  return id;
};

// ===== 공통 함수 =====
function setTab(activeTabId) {
  els.tabs.forEach(tab => tab.classList.toggle('active', tab.id === activeTabId));
  els.panels.forEach(panel => panel.classList.toggle('hide', panel.id !== `panel${activeTabId.slice(3)}`));
  els.qrCard.classList.toggle('hide', activeTabId !== 'tabOpt');
}

function buildStudentLink(room) {
  const studentUrl = `${location.origin}${location.pathname}?role=student&room=${encodeURIComponent(room)}`;
  els.studentLink.value = studentUrl;
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(studentUrl)}`;
  els.qrImg.src = qrApiUrl;
}

function defaultRoom(){
  return {
    title: "새 퀴즈", questions: [], currentIndex: -1, mode: "idle", accept: true,
    counters: { join:0, submit:0, correct:0, wrong:0 },
    createdAt: window.FS.serverTimestamp(),
    policy: { once:"device", openResult:false, timer: 30, bright: false }
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
    els.btnConnection.textContent = '세션아웃';
    els.btnConnection.classList.add('danger');
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
    els.btnConnection.textContent = '접속';
    els.btnConnection.classList.remove('danger');
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
        timer: Math.max(0, parseInt(els.timerSec.value,10) || 0),
        bright: els.brightMode.checked
    };
    const accept = !!els.allowSubmit.checked;
    await window.FS.setDoc(window.FS.doc("rooms", ROOM), { policy, accept }, { merge:true });
    buildStudentLink(ROOM);
    alert("옵션 저장 완료");
}

async function resetAll() {
    if (!ROOM) { alert("먼저 세션에 접속하세요."); return; }
    if(!confirm("이 세션의 모든 문항, 결과, 옵션을 초기화할까요?")) return;
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

function exportCSV() {
    if (!ROOM) { alert("먼저 세션에 접속하세요."); return; }
    let csvContent = "\uFEFF"; // BOM for Excel
    csvContent += "이름,점수\n";
    
    const rows = els.resBody.querySelectorAll("tr");
    rows.forEach(row => {
        const name = `"${row.cells[0].textContent.trim().replace(/"/g, '""')}"`;
        const score = `"${row.cells[row.cells.length - 1].textContent.trim()}"`;
        csvContent += `${name},${score}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = CE("a");
    link.href = URL.createObjectURL(blob);
    link.download = `quiz_result_${ROOM}.csv`;
    link.click();
}

// ===== 학생 플로우 =====
async function joinStudent() {
    const name = els.joinName.value.trim();
    if(!name) { alert("이름을 입력하세요."); return; }
    
    const sid = getStudentId();
    const docRef = window.FS.doc("rooms", ROOM);
    await window.FS.setDoc(window.FS.doc(docRef, "responses", sid), {
        name, joinedAt: window.FS.serverTimestamp(), deviceId: getStudentId(), answers:{}, score:0 
    });
    await window.FS.updateDoc(docRef, { 'counters.join': window.FS.increment(1) });

    els.joinDialog.close();
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
    els.body.classList.toggle('bright-mode', r.policy?.bright || false);
    els.pTitle.textContent = r.title || ""; els.sTitle.textContent = r.title || "";
    els.chipJoin.textContent = r.counters?.join || 0;
    els.chipSubmit.textContent = r.counters?.submit || 0;
    els.chipCorrect.textContent = r.counters?.correct || 0;
    els.chipWrong.textContent = r.counters?.wrong || 0;
    
    const total = r.questions?.length || 0;
    const cur = r.currentIndex ?? -1;
    els.qCounter.textContent = `Q${Math.max(0, cur + 1)}/${total}`;
    if(MODE === 'admin') {
      els.quizTitle.value = r.title || "";
      els.allowSubmit.checked = r.accept;
      els.openResult.checked = r.policy?.openResult;
      els.brightMode.checked = r.policy?.bright;
      els.timerSec.value = r.policy?.timer || 30;
      if (r.policy?.once === 'name') els.onceName.checked = true; else els.onceDevice.checked = true;
    }

    if (MODE === 'admin') {
        if (r.mode === 'ended') {
            els.presHint.textContent = "퀴즈가 종료되었습니다.";
            els.presHint.classList.remove("hide");
            els.pWrap.classList.add("hide");
        } else if (r.mode !== 'active' || cur < 0) {
            els.presHint.textContent = "시작 버튼을 누르면 문항이 제시됩니다.";
            els.presHint.classList.remove("hide");
            els.pWrap.classList.add("hide");
        } else {
            els.presHint.classList.add("hide");
            els.pWrap.classList.remove("hide");
            const q = r.questions[cur];
            els.pQText.textContent = q.text || "";
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
                const b = CE("div","popt"); b.textContent = `정답: ${q.answerText||""}`;
                b.style.borderColor = "var(--green)";
                els.pOpts.appendChild(b);
            }
        }
    }

    if (MODE === 'student') {
        if (r.mode === 'ended') {
            els.sWrap.classList.add("hide");
            els.sDone.classList.remove("hide");
            els.btnMyResult.classList.toggle('hide', !r.policy?.openResult);
        } else if (r.mode !== 'active' || cur < 0) {
            els.sWrap.classList.remove("hide");
            els.sState.textContent = "참가 완료! 퀴즈가 시작되기를 기다려주세요.";
            els.sQBox.classList.add("hide");
        } else if (!r.accept) {
            els.sWrap.classList.remove("hide");
            els.sState.textContent = "제출이 마감되었습니다. 다음 문항을 기다려주세요.";
            els.sQBox.classList.add("hide");
        } else {
            const q = r.questions[cur];
            els.sWrap.classList.remove("hide");
            els.sState.textContent = "";
            els.sQBox.classList.remove("hide");
            els.sQTitle.textContent = `Q${cur+1}. ${q.text || ""}`;
            els.sQImg.src = q.image || "";
            els.sQImg.classList.toggle("hide", !q.image);
            els.sOptBox.innerHTML="";
            els.sShortWrap.classList.add("hide");
            els.sSubmitBox.innerHTML = "";

            if (q.type === "mcq") {
                let chosen = null;
                q.options.forEach((opt,i) => {
                    const btn = CE("button","sopt"); btn.textContent = `${i+1}. ${opt}`;
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
}

function renderSubmitButton(chosen) {
    els.sSubmitBox.innerHTML = "";
    const submitBtn = CE("button","btn green");
    submitBtn.textContent="제출";
    submitBtn.onclick = () => {
        if (chosen === null) alert("보기를 선택하세요");
        else {
            submitStudent(chosen);
            submitBtn.disabled = true;
        }
    };
    els.sSubmitBox.appendChild(submitBtn);
}

async function refreshResults() {
    if(!ROOM) return;
    const roomSnap = await window.FS.getDoc(window.FS.doc("rooms", ROOM));
    if(!roomSnap.exists) return;

    const doc = roomSnap.data();
    const total = doc.questions?.length || 0;
    
    els.resHead.innerHTML = `<tr><th>이름</th>${Array.from({length: total}, (_, i) => `<th>Q${i+1}</th>`).join("")}<th>점수</th></tr>`;

    const respSnap = await window.FS.getDocs(window.FS.doc("rooms", ROOM, "responses"));
    const rows = [];
    respSnap.forEach(d => {
        const v = d.data();
        let rowHtml = `<td>${v.name || "(무명)"}</td>`;
        for(let i=0; i < total; i++){
            const q = doc.questions[i];
            const ans = v.answers?.[i];
            let result = "-";
            if (ans !== undefined) {
                let isCorrect = q.type === "mcq" ? (ans === q.answer) : (String(ans||"").trim().toLowerCase() === String(q.answerText||"").trim().toLowerCase());
                result = isCorrect ? "○" : "×";
            }
            rowHtml += `<td>${result}</td>`;
        }
        rowHtml += `<td>${v.score || 0}</td>`;
        rows.push({ score: v.score || 0, html: rowHtml });
    });
    
    rows.sort((a,b) => b.score - a.score);
    els.resBody.innerHTML = rows.map(r => `<tr>${r.html}</tr>`).join("");
}

async function refreshMyResult() {
    const sid = getStudentId();
    const respSnap = await window.FS.getDoc(window.FS.doc("rooms", ROOM, "responses", sid));
    if(!respSnap.exists){ els.myResult.innerHTML = "제출 기록이 없습니다."; return; }

    const roomSnap = await window.FS.getDoc(window.FS.doc("rooms", ROOM));
    const doc = roomSnap.data();
    const total = doc.questions?.length || 0;
    const v = respSnap.data();
    
    let resultHtml = `<p>이름: <b>${v.name||""}</b> · 점수: <b>${v.score||0} / ${total}</b></p>
      <table class="table"><thead><tr><th>문항</th><th>제출</th><th>정답</th><th>결과</th></tr></thead><tbody>`;
    
    for(let i=0; i<total; i++){
        const q = doc.questions[i];
        const ans = v.answers?.[i];
        let isCorrect = false;
        let submittedAnsStr = "-";
        if (ans !== undefined) {
            if (q.type === "mcq") {
                isCorrect = ans === q.answer;
                submittedAnsStr = q.options[ans] || "-";
            } else {
                isCorrect = String(ans||"").trim().toLowerCase() === String(q.answerText||"").trim().toLowerCase();
                submittedAnsStr = String(ans);
            }
        }
        const correctAnsStr = q.type === "mcq" ? q.options[q.answer] : q.answerText;
        resultHtml += `<tr><td>Q${i+1}</td><td>${submittedAnsStr}</td><td>${correctAnsStr}</td><td>${ans !== undefined ? (isCorrect ? 'O' : 'X') : '-'}</td></tr>`;
    }

    resultHtml += `</tbody></table>`;
    els.myResult.innerHTML = resultHtml;
    els.myResult.classList.remove("hide");
}

// ===== 초기화 및 이벤트 바인딩 =====
function bindAdminEvents() {
    els.tabs.forEach(tab => tab.addEventListener('click', () => setTab(tab.id)));
    els.btnConnection.onclick = connect;
    els.btnBlank.onclick = makeBlank;
    els.btnSample.onclick = loadSample;
    els.btnAddQ.onclick = addQuestionUI;
    els.btnSaveQ.onclick = saveQuestions;
    els.btnOptSave.onclick = saveOptions;
    els.btnCopy.onclick = () => navigator.clipboard.writeText(els.studentLink.value);
    els.btnOpen.onclick = () => { if(els.studentLink.value) window.open(els.studentLink.value, "_blank"); };
    els.btnStart.onclick = () => controlQuiz('start');
    els.btnPrev.onclick = () => controlQuiz('prev');
    els.btnNext.onclick = () => controlQuiz('next');
    els.btnEnd.onclick = () => controlQuiz('end');
    els.btnExport.onclick = exportCSV;
    els.btnResetAll.onclick = resetAll;
    els.btnTemplate.onclick = () => {
        const csv = "\uFEFF문항,타입,정답,보기1,보기2,보기3,보기4\n예시객관식,mcq,2,보기1,정답,보기3,보기4\n예시주관식,short,정답텍스트";
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = CE('a');
        link.href = URL.createObjectURL(blob);
        link.download = "quiz_template.csv";
        link.click();
    };
    els.btnUpload.onclick = () => alert("문항 업로드 기능은 준비 중입니다.");
}

function bindStudentEvents() {
    els.btnJoin.onclick = joinStudent;
    els.btnMyResult.onclick = refreshMyResult;
    els.btnShortSend.onclick = () => submitStudent(els.sShort.value);
}

function init() {
    if (!window.firebase || !window.db) {
        alert("Firebase 라이브러리 로딩에 실패했습니다."); return;
    }
    
    if (MODE === 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
        els.studentPanel.style.display = 'none';
        bindAdminEvents();
        setTab('tabQ');
    } else {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
        els.studentPanel.style.display = 'block';
        bindStudentEvents();
        if (ROOM) {
            els.joinDialog.showModal();
            const docRef = window.FS.doc("rooms", ROOM);
            roomUnsub = window.FS.onSnapshot(docRef, snap => {
                if(snap.exists) {
                    renderRoom(snap.data());
                } else {
                    els.joinDialog.close();
                    document.body.innerHTML = "<h1>세션이 존재하지 않거나 삭제되었습니다.</h1>";
                }
            });
        } else {
            document.body.innerHTML = "<h1>잘못된 접근입니다.</h1>";
        }
    }
}

document.addEventListener("DOMContentLoaded", init);
