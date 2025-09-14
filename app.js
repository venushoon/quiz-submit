// ===== 유틸 =====
const $ = (id) => document.getElementById(id);
const CE = (tag, cls) => { const el = document.createElement(tag); if(cls) el.className = cls; return el; };

// ===== DOM 엘리먼트 캐시 (초기화 함수에서 채워짐) =====
let els = {};

// ===== 전역 상태 =====
let ROOM = null;
let MODE = "admin";
let roomUnsub = null;
let participantUnsub = null;
let editQuestions = [];
let questionTimer = null;

// ===== 초기 설정 =====
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
  
  if (participantUnsub) { participantUnsub(); participantUnsub = null; }

  if (activeTabId === 'tabOpt') {
    listenForParticipants();
    els.qrCard.classList.remove('hide');
  } else {
    els.participantCard.classList.add('hide');
    els.qrCard.classList.add('hide');
  }

  if (activeTabId === 'tabRes') {
    refreshResults();
  }
}

function buildStudentLink(room) {
  const studentUrl = `${location.origin}${location.pathname}?role=student&room=${encodeURIComponent(room)}`;
  els.studentLink.value = studentUrl;
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(studentUrl)}`;
  els.qrImg.src = qrApiUrl;
}

function defaultRoom(){
  return {
    title: "새 퀴즈", questions: [], currentIndex: -1, mode: "idle", accept: true, revealed: -1,
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
    els.btnConnection.onclick = disconnect;
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
    if(participantUnsub) participantUnsub();
    roomUnsub = null; participantUnsub = null; ROOM = null;
    
    els.sessionInput.disabled = false;
    els.btnConnection.textContent = '접속';
    els.btnConnection.classList.remove('danger');
    els.btnConnection.onclick = connect;
    els.sessionStatus.textContent = `세션: - · 오프라인`;
    els.studentLink.value = "";
    els.qrImg.src = "";
    els.qList.innerHTML = "";
    els.quizTitle.value = "";
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
        renderQuestionList();
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
    if (editQuestions.length === 0) { alert("추가된 문항이 없습니다."); return; }
    const docRef = window.FS.doc("rooms", ROOM);
    const doc = await window.FS.getDoc(docRef);
    const currentQuestions = doc.exists ? doc.data().questions || [] : [];
    
    const newQuestions = [...currentQuestions, ...editQuestions];
    const title = els.quizTitle.value || doc.data()?.title || "퀴즈";

    await window.FS.setDoc(docRef, { questions: newQuestions, title }, { merge: true });
    editQuestions = [];
    alert("문항 저장 완료");
}

async function deleteQuestion(indexToDelete) {
    if (!ROOM) return;
    
    const docRef = window.FS.doc("rooms", ROOM);
    const doc = await window.FS.getDoc(docRef);
    if (doc.exists) {
        const questions = doc.data().questions || [];
        const questionText = questions[indexToDelete]?.text.slice(0, 20);
        if (!confirm(`'${questionText}...' 문항을 삭제하시겠습니까?`)) return;
        questions.splice(indexToDelete, 1);
        await window.FS.updateDoc(docRef, { questions: questions });
    }
}

async function resetQuestions() {
    if (!ROOM) { alert("먼저 세션에 접속하세요."); return; }
    if (!confirm("현재 퀴즈의 모든 문항을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) return;
    
    await window.FS.updateDoc(window.FS.doc("rooms", ROOM), { questions: [] });
    editQuestions = [];
}

function makeBlank() {
    els.quizTitle.value = "";
    els.qText.value = ""; els.qAnswer.value = "";
    ["opt1", "opt2", "opt3", "opt4"].forEach(k => els[k].value = "");
    els.qImg.value = "";
    editQuestions = []; 
    renderQuestionList();
}

function loadSample() {
    if (editQuestions.length > 0 && !confirm("작성 중인 문항이 있습니다. 초기화하고 샘플을 불러올까요?")) return;
    makeBlank();
    editQuestions = [
        { type:"mcq", text:"가장 큰 행성은?", options:["지구","목성","화성","금성"], answer:1 },
        { type:"mcq", text:"태양에서 세 번째 행성?", options:["수성","화성","지구","금성"], answer:2 },
        { type:"short", text:"지구의 위성 이름은?", answerText:"달" }
    ];
    renderQuestionList();
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
    await window.FS.setDoc(window.FS.doc("rooms", ROOM), { policy }, { merge:true });
    buildStudentLink(ROOM);
    alert("옵션 저장 완료");
}

async function resetAll() {
    if (!ROOM) { alert("먼저 세션에 접속하세요."); return; }
    if(!confirm("이 세션의 모든 문항, 결과, 옵션을 초기화할까요? 이 작업은 되돌릴 수 없습니다.")) return;
    await window.FS.setDoc(window.FS.doc("rooms", ROOM), defaultRoom());
    alert("초기화 완료");
}

async function controlQuiz(action) {
    if (!ROOM) { alert("먼저 세션에 접속하세요."); return; }
    const docRef = window.FS.doc("rooms", ROOM);

    if (action === 'start') {
        const doc = await window.FS.getDoc(docRef);
        if (!doc.exists || !doc.data().questions || doc.data().questions.length === 0) {
            alert("퀴즈에 문항이 없습니다. 문항을 추가한 후 시작해주세요.");
            return;
        }
        await window.FS.updateDoc(docRef, { mode: "active", currentIndex: 0, accept: true, revealed: -1 });
    } else if (action === 'end') {
        await window.FS.updateDoc(docRef, { mode: "ended", accept: false });
        setTab('tabRes');
    } else {
        const doc = await window.FS.getDoc(docRef);
        if (!doc.exists) return;
        const data = doc.data();
        const max = (data.questions?.length || 0) - 1;
        let cur = data.currentIndex ?? -1;
        
        if (action === 'next') {
            if (cur < max) await window.FS.updateDoc(docRef, { currentIndex: cur + 1, accept: true, revealed: -1 });
            else await controlQuiz('end');
        } else if (action === 'prev') {
            await window.FS.updateDoc(docRef, { currentIndex: Math.max(0, cur - 1), accept: true, revealed: -1 });
        } else if (action === 'reveal') {
            await window.FS.updateDoc(docRef, { revealed: cur, accept: false });
        }
    }
}

function exportCSV() {
    if (!ROOM) { alert("먼저 세션에 접속하세요."); return; }
    let csvContent = "\uFEFF"; 
    csvContent += "순위,이름,점수\n";
    
    const rows = els.resBody.querySelectorAll("tr");
    rows.forEach(row => {
        const rank = `"${row.cells[0].textContent.trim()}"`;
        const name = `"${row.cells[1].textContent.trim().replace(/"/g, '""')}"`;
        const score = `"${row.cells[row.cells.length - 1].textContent.trim()}"`;
        csvContent += `${rank},${name},${score}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = CE("a");
    link.href = URL.createObjectURL(blob);
    link.download = `quiz_result_${ROOM}.csv`;
    link.click();
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else if (document.exitFullscreen) {
        document.exitFullscreen();
    }
}
document.addEventListener('fullscreenchange', () => {
    const isFullscreen = !!document.fullscreenElement;
    if (els.btnFullscreen) {
      els.btnFullscreen.textContent = isFullscreen ? "화면 복귀" : "전체 화면";
    }
});

// ===== 학생 플로우 =====
async function joinStudent() {
    const name = els.joinName.value.trim();
    if(!name) { alert("이름을 입력하세요."); return; }
    const sid = getStudentId();

    const roomRef = window.FS.doc("rooms", ROOM);
    const respRef = window.FS.doc("rooms", ROOM, "responses", sid);

    await window.db.runTransaction(async (transaction) => {
        const respDoc = await transaction.get(respRef);
        if (!respDoc.exists) {
            transaction.set(respRef, { name, joinedAt: window.FS.serverTimestamp(), deviceId: sid, answers: {}, score: 0 });
            transaction.update(roomRef, { 'counters.join': window.FS.increment(1) });
        }
    });
    
    els.joinDialog.close();
}

async function submitStudent(answerPayload) {
    const sid = getStudentId();
    const roomRef = window.FS.doc("rooms", ROOM);
    const respRef = window.FS.doc("rooms", ROOM, "responses", sid);

    try {
        await window.db.runTransaction(async (transaction) => {
            const roomDoc = await transaction.get(roomRef);
            const respDoc = await transaction.get(respRef);
            if (!roomDoc.exists || !respDoc.exists) { throw "세션 또는 참가자 정보가 없습니다."; }

            const r = roomDoc.data();
            const qIdx = r.currentIndex;
            if (qIdx < 0 || !r.accept) { return; }

            const q = r.questions[qIdx];
            const studentData = respDoc.data();
            if (studentData.answers?.[qIdx] !== undefined) { return; }

            let isCorrect = false;
            if (q.type === "mcq") { isCorrect = (answerPayload === q.answer); }
            else { isCorrect = String(answerPayload || "").trim().toLowerCase() === String(q.answerText || "").trim().toLowerCase(); }
            
            const newAnswers = { ...studentData.answers, [qIdx]: answerPayload };
            const newScore = (studentData.score || 0) + (isCorrect ? 1 : 0);
            
            transaction.update(respRef, { answers: newAnswers, score: newScore });

            const counterUpdate = { 'counters.submit': window.FS.increment(1) };
            counterUpdate[isCorrect ? 'counters.correct' : 'counters.wrong'] = window.FS.increment(1);
            transaction.update(roomRef, counterUpdate);
            
            if (r.policy?.openResult) {
                setTimeout(() => alert(isCorrect ? "정답입니다! ✅" : "오답입니다. ❌"), 0);
            } else {
                setTimeout(() => alert("제출 완료!"), 0);
            }
        });
    } catch (error) {
        console.error("제출 트랜잭션 실패:", error);
    }
}


// ===== 렌더링 및 UI 업데이트 =====
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
      els.openResult.checked = r.policy?.openResult;
      els.brightMode.checked = r.policy?.bright;
      els.timerSec.value = r.policy?.timer || 30;
      if (r.policy?.once === 'name') els.onceName.checked = true; else els.onceDevice.checked = true;
      renderQuestionList(r.questions);
    }

    const q = r.questions?.[cur];
    updateTimer(r);
    
    if (MODE === 'admin') {
        if (r.mode === 'ended') {
            els.presHint.textContent = "퀴즈가 종료되었습니다.";
            els.presHint.classList.remove("hide");
            els.pWrap.classList.add("hide");
        } else if (r.mode !== 'active' || !q) {
            els.presHint.textContent = "시작 버튼을 누르면 문항이 제시됩니다.";
            els.presHint.classList.remove("hide");
            els.pWrap.classList.add("hide");
        } else {
            els.presHint.classList.add("hide");
            els.pWrap.classList.remove("hide");
            els.pQText.textContent = q.text || "";
            els.pQImg.src = q.image || "";
            els.pQImg.classList.toggle("hide", !q.image);
            els.pOpts.innerHTML = "";
            if (q.type === "mcq") {
                q.options.forEach((opt,i) => {
                    const b = CE("div","popt");
                    b.textContent = `${i+1}. ${opt}`;
                    if (r.revealed === cur && i === q.answer) b.classList.add('correct');
                    else if (r.revealed === cur) b.classList.add('incorrect');
                    els.pOpts.appendChild(b);
                });
            } else {
                const b = CE("div","popt");
                if (r.revealed === cur) {
                    b.textContent = `정답: ${q.answerText||""}`;
                    b.classList.add('correct');
                } else {
                    b.textContent = `[주관식 문항]`;
                }
                els.pOpts.appendChild(b);
            }
        }
    }

    if (MODE === 'student') {
        if (!els.joinDialog.open) els.sWrap.classList.remove('hide');

        if (r.mode === 'ended') {
            els.sQBox.classList.add("hide");
            els.sState.textContent = "";
            els.sDone.classList.remove("hide");
            els.btnMyResult.onclick = refreshMyResult; // 이벤트 바인딩
            refreshMyResult();
        } else if (r.mode !== 'active' || !q) {
            els.sState.textContent = "교사가 시작버튼을 누르면 퀴즈가 시작됩니다. 준비되었나요?";
            els.sQBox.classList.add("hide");
        } else if (!r.accept) {
            els.sState.textContent = r.revealed === cur ? "정답이 공개되었습니다." : "제출이 마감되었습니다. 다음 문항을 기다려주세요.";
            els.sQBox.classList.add("hide");
        } else {
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
                    if (r.revealed === cur && i === q.answer) btn.classList.add('correct');
                    else if (r.revealed === cur) btn.classList.add('incorrect');
                    
                    btn.onclick = () => {
                        if (r.revealed === cur || !r.accept) return;
                        chosen = i;
                        document.querySelectorAll('#sOptBox .sopt').forEach(c => c.classList.remove("active"));
                        btn.classList.add("active");
                        renderSubmitButton(chosen);
                    };
                    els.sOptBox.appendChild(btn);
                });
            } else {
                els.sShortWrap.classList.remove("hide");
                els.sShortSend.onclick = () => submitStudent(els.sShort.value);
            }
        }
    }
}

function renderQuestionList(questions = []) {
    els.qList.innerHTML = "";
    const allQuestions = [...editQuestions.slice().reverse(), ...questions];
    els.qList.style.display = allQuestions.length > 0 ? 'block' : 'none';
    
    allQuestions.forEach((q, index) => {
        const item = CE("div", "item");
        const isUnsaved = index < editQuestions.length;
        const savedQuestionIndex = index - editQuestions.length;

        item.innerHTML = `<span class="item-text">${q.type === 'mcq' ? '[객관식]' : '[주관식]'} ${q.text}</span>`;
        if (isUnsaved) {
            item.innerHTML += `<span class="chip" style="margin-left:auto; font-size: 0.8em; padding: 2px 6px;">저장 안됨</span>`;
        }
        const deleteBtn = CE("button", "delete-btn");
        deleteBtn.textContent = "×";
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            if (isUnsaved) {
                const originalIndex = editQuestions.length - 1 - index;
                editQuestions.splice(originalIndex, 1);
                renderQuestionList(questions);
            } else { 
                deleteQuestion(savedQuestionIndex);
            }
        };
        item.appendChild(deleteBtn);
        els.qList.appendChild(item);
    });
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

function updateTimer(roomData) {
    clearInterval(questionTimer);
    const timeLimit = roomData.policy?.timer || 30;
    
    if (roomData.mode === 'active' && roomData.accept) {
        let remaining = timeLimit;
        els.liveTimer.textContent = `${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;
        questionTimer = setInterval(async () => {
            remaining--;
            els.liveTimer.textContent = `${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;
            if (remaining <= 0) {
                clearInterval(questionTimer);
                if (MODE === 'admin') {
                   await window.FS.updateDoc(window.FS.doc("rooms", ROOM), { accept: false });
                }
            }
        }, 1000);
    } else {
        els.liveTimer.textContent = `00:00`;
    }
}

async function refreshResults() {
    if(!ROOM) return;
    const roomSnap = await window.FS.getDoc(window.FS.doc("rooms", ROOM));
    if(!roomSnap.exists) return;

    const doc = roomSnap.data();
    const total = doc.questions?.length || 0;
    
    els.resHead.innerHTML = `<tr><th>순위</th><th>이름</th>${Array.from({length: total}, (_, i) => `<th>Q${i+1}</th>`).join("")}<th>점수</th></tr>`;

    const respSnap = await window.FS.getDocs(window.FS.doc("rooms", ROOM, "responses"));
    const rows = [];
    respSnap.forEach(d => rows.push(d.data()));
    
    rows.sort((a,b) => (b.score || 0) - (a.score || 0));

    els.resBody.innerHTML = rows.map((v, index) => {
        const rank = index + 1;
        let rankIcon = rank;
        if (rank === 1) rankIcon = '🥇';
        if (rank === 2) rankIcon = '🥈';
        if (rank === 3) rankIcon = '🥉';
        
        let cells = `<td class="rank-icon">${rankIcon}</td><td>${v.name || "(무명)"}</td>`;
        for(let i=0; i < total; i++){
            const ans = v.answers?.[i];
            let result = "-";
            if (ans !== undefined) {
                const q = doc.questions[i];
                if (!q) { result = '?'; }
                else {
                    let isCorrect = q.type === "mcq" ? (ans === q.answer) : (String(ans||"").trim().toLowerCase() === String(q.answerText||"").trim().toLowerCase());
                    result = isCorrect ? "✔️" : "❌";
                }
            }
            cells += `<td>${result}</td>`;
        }
        cells += `<td>${v.score || 0}</td>`;
        return `<tr class="rank-${rank > 3 ? 'etc' : rank}">${cells}</tr>`;
    }).join("");
}

async function refreshMyResult() {
    els.myResult.classList.remove('hide');
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
        if (!q) continue;
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
}

function listenForParticipants() {
    if (!ROOM) return;
    els.participantCard.classList.remove('hide');
    const responsesRef = window.FS.doc("rooms", ROOM, "responses");
    participantUnsub = window.FS.onSnapshot(responsesRef, (snapshot) => {
        const names = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data && data.name) names.push(data.name);
        });
        els.participantCount.textContent = names.length;
        els.participantList.innerHTML = names.map(name => `<li>${name}</li>`).join('');
    });
}

// ===== 초기화 및 이벤트 바인딩 =====
function cacheDOMElements() {
    const elementIds = [
        'body', 'sessionInput', 'btnConnection', 'sessionStatus', 'tabQ', 'tabOpt', 'tabPres', 'tabRes',
        'panelQ', 'panelOpt', 'panelPres', 'panelRes', 'quizTitle', 'btnBlank', 'btnSample', 'btnSaveQ',
        'btnResetQ', 'qText', 'qType', 'qAnswer', 'qImg', 'mcqBox', 'opt1', 'opt2', 'opt3', 'opt4',
        'btnAddQ', 'qList', 'onceDevice', 'onceName', 'openResult', 'brightMode', 'timerSec',
        'btnOptSave', 'qrCard', 'qrImg', 'studentLink', 'btnCopy', 'btnOpen', 'btnToggleLink',
        'studentLinkContainer', 'participantCard', 'participantCount', 'participantList', 'btnStart',
        'btnPrev', 'btnNext', 'btnEnd', 'btnReveal', 'btnFullscreen', 'chipJoin', 'chipSubmit',
        'chipCorrect', 'chipWrong', 'qCounter', 'liveTimer', 'pTitle', 'presHint', 'pWrap', 'pQText',
        'pQImg', 'pOpts', 'btnExport', 'btnResetAll', 'resHead', 'resBody', 'studentPanel',
        'joinDialog', 'joinName', 'btnJoin', 'sWrap', 'sTitle', 'sState', 'sQBox', 'sQTitle',
        'sQImg', 'sOptBox', 'sShortWrap', 'sShort', 'btnShortSend', 'sSubmitBox', 'sDone', 'myResult'
    ];
    elementIds.forEach(id => {
        if (id === 'body') { els.body = document.body; } 
        else { els[id] = $(id); }
    });
    els.tabs = document.querySelectorAll('.tabs .tab');
    els.panels = document.querySelectorAll('.panel.admin-only');
}


function init() {
    cacheDOMElements();

    if (!window.firebase || !window.db) {
        alert("Firebase 라이브러리 로딩에 실패했습니다."); return;
    }
    
    if (MODE === 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'flex');
        els.studentPanel.style.display = 'none';
        els.tabs.forEach(tab => tab.addEventListener('click', () => setTab(tab.id)));
        els.btnConnection.onclick = connect;
        els.btnBlank.onclick = makeBlank;
        els.btnSample.onclick = loadSample;
        els.btnAddQ.onclick = addQuestionUI;
        els.btnSaveQ.onclick = saveQuestions;
        els.btnResetQ.onclick = resetQuestions;
        els.btnOptSave.onclick = saveOptions;
        els.btnCopy.onclick = () => navigator.clipboard.writeText(els.studentLink.value);
        els.btnOpen.onclick = () => { if(els.studentLink.value) window.open(els.studentLink.value, "_blank"); };
        els.btnStart.onclick = () => controlQuiz('start');
        els.btnPrev.onclick = () => controlQuiz('prev');
        els.btnNext.onclick = () => controlQuiz('next');
        els.btnEnd.onclick = () => controlQuiz('end');
        els.btnReveal.onclick = () => controlQuiz('reveal');
        els.btnExport.onclick = exportCSV;
        els.btnResetAll.onclick = resetAll;
        els.btnToggleLink.onclick = () => {
            const isHidden = els.studentLinkContainer.classList.toggle('hide');
            els.btnToggleLink.textContent = isHidden ? '주소 보기' : '주소 숨기기';
        };
        els.btnFullscreen.onclick = toggleFullscreen;
        setTab('tabQ');
    } else {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
        els.studentPanel.style.display = 'block';
        
        els.btnJoin.onclick = joinStudent;
        
        if (ROOM) {
            const docRef = window.FS.doc("rooms", ROOM);
            window.FS.getDoc(docRef).then(snap => {
                if (snap.exists) {
                    if (snap.data().mode === 'ended') {
                        els.sWrap.classList.add('hide');
                        els.sDone.classList.remove('hide');
                        refreshMyResult();
                        els.btnMyResult.onclick = refreshMyResult;
                    } else {
                        els.joinDialog.showModal();
                    }
                    roomUnsub = window.FS.onSnapshot(docRef, docSnap => {
                        if (docSnap.exists) renderRoom(docSnap.data());
                    });
                } else {
                    document.body.innerHTML = "<h1>세션이 존재하지 않거나 삭제되었습니다.</h1>";
                }
            });
        } else {
            document.body.innerHTML = "<h1>잘못된 접근입니다.</h1>";
        }
    }
}

window.addEventListener("load", init);
