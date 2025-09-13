// ===== 유틸 =====
const $ = (id) => document.getElementById(id);
const qs = (sel, root=document) => root.querySelector(sel);
const CE = (tag, cls) => { const el = document.createElement(tag); if(cls) el.className = cls; return el; };

// DOM 엘리먼트 캐시
const els = {
  // 상단/탭
  sessionInput: $("sessionInput"),
  btnConnect: $("btnConnect"),
  btnDisconnect: $("btnDisconnect"),
  sessionStatus: $("sessionStatus"),
  tabQ: $("tabQ"), tabOpt: $("tabOpt"), tabPres: $("tabPres"), tabRes: $("tabRes"),
  panelQ: $("panelQ"), panelOpt: $("panelOpt"), panelPres: $("panelPres"), panelRes: $("panelRes"),
  // 문항 편집
  quizTitle: $("quizTitle"),
  btnBlank: $("btnBlank"), btnSample: $("btnSample"), btnSaveQ: $("btnSaveQ"),
  qText: $("qText"), qType: $("qType"), qAnswer: $("qAnswer"), qImg: $("qImg"),
  mcqBox: $("mcqBox"), opt1: $("opt1"), opt2: $("opt2"), opt3: $("opt3"), opt4: $("opt4"),
  btnAddQ: $("btnAddQ"), qList: $("qList"),
  // 옵션
  onceDevice: $("onceDevice"), onceName: $("onceName"),
  allowSubmit: $("allowSubmit"), openResult: $("openResult"),
  timerSec: $("timerSec"), btnOptSave: $("btnOptSave"), btnOptReset: $("btnOptReset"),
  qrImg: $("qrImg"), // [수정] qrCanvas -> qrImg
  studentLink: $("studentLink"), btnCopy: $("btnCopy"), btnOpen: $("btnOpen"),
  // 프레젠테이션
  btnStart: $("btnStart"), btnPrev: $("btnPrev"), btnNext: $("btnNext"), btnEnd: $("btnEnd"),
  chipJoin: $("chipJoin"), chipSubmit: $("chipSubmit"), chipCorrect: $("chipCorrect"), chipWrong: $("chipWrong"),
  qCounter: $("qCounter"),
  pTitle: $("pTitle"), presHint: $("presHint"), pWrap: $("pWrap"), pQText: $("pQText"), pQImg: $("pQImg"), pOpts: $("pOpts"),
  // 결과
  btnExport: $("btnExport"), btnResetAll: $("btnResetAll"), resHead: $("resHead"), resBody: $("resBody"),
  // 학생
  studentPanel: $("studentPanel"), joinModal: $("joinModal"), joinName: $("joinName"), btnJoin: $("btnJoin"),
  sWrap: $("sWrap"), sTitle: $("sTitle"), sState: $("sState"), sQBox: $("sQBox"),
  sQTitle: $("sQTitle"), sQImg: $("sQImg"), sOptBox: $("sOptBox"),
  sShortWrap: $("sShortWrap"), sShort: $("sShort"), btnShortSend: $("btnShortSend"),
  sDone: $("sDone"), btnMyResult: $("btnMyResult"), myResult: $("myResult")
};

// ... (이하 코드는 이전 버전과 거의 동일하지만, buildStudentLink 함수가 변경되었습니다) ...
// 전역 상태
let ROOM = null;
let MODE = "admin";
let roomUnsub = null;
let editQuestions = [];

const U = new URL(location.href);
const paramRole = (U.searchParams.get("role")||"").toLowerCase();
const paramRoom = U.searchParams.get("room");

if (paramRole === "student" && paramRoom) {
  MODE = "student";
  ROOM = paramRoom.trim();
}

const roomRef = (room) => window.db.collection("rooms").doc(room);
const respRef = (room, id) => roomRef(room).collection("responses").doc(id);

const deviceId = (() => {
  const k = "quiz_device_id";
  let v = localStorage.getItem(k);
  if(!v){ v = crypto.randomUUID(); localStorage.setItem(k, v); }
  return v;
})();

function setTab(t){
  [els.tabQ, els.tabOpt, els.tabPres, els.tabRes].forEach(b=>b.classList.remove("active"));
  [els.panelQ, els.panelOpt, els.panelPres, els.panelRes].forEach(p=>p.classList.add("hide"));
  if(t==="q"){ els.tabQ.classList.add("active"); els.panelQ.classList.remove("hide"); }
  if(t==="opt"){ els.tabOpt.classList.add("active"); els.panelOpt.classList.remove("hide"); }
  if(t==="pres"){ els.tabPres.classList.add("active"); els.panelPres.classList.remove("hide"); }
  if(t==="res"){ els.tabRes.classList.add("active"); els.panelRes.classList.remove("hide"); }
}

function defaultRoom(){
  return {
    title: "샘플 퀴즈",
    questions: [
      { type:"mcq", text:"가장 큰 행성은?", options:["지구","목성","화성","금성"], answer:1 },
      { type:"mcq", text:"태양에서 세 번째 행성?", options:["수성","화성","지구","금성"], answer:2 },
      { type:"short", text:"지구의 위성 이름은?", answerText:"달" }
    ],
    currentIndex: -1,
    mode: "idle",
    accept: true,
    counters: { join:0, submit:0, correct:0, wrong:0 },
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    policy: { once:"device", openResult:false, timer: 30 }
  };
}

// [수정] QR코드 생성 함수를 API 방식으로 변경
function buildStudentLink(room){
  const studentUrl = `${location.origin}${location.pathname}?role=student&room=${encodeURIComponent(room)}`;
  els.studentLink.value = studentUrl;
  
  // QR 코드 API URL 생성
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(studentUrl)}`;
  
  // img 태그의 src 속성에 API URL 설정
  els.qrImg.src = qrApiUrl;
}

async function ensureRoom(){
  const room = (ROOM || els.sessionInput.value.trim());
  if(!room){ alert("세션 코드를 입력하세요."); return null; }
  ROOM = room;
  const doc = await roomRef(room).get();
  if(!doc.exists){
    await roomRef(room).set(defaultRoom());
  }
  return room;
}

async function connect(){
  const room = await ensureRoom();
  if(!room) return;
  els.sessionInput.value = room;
  els.sessionInput.disabled = true;
  els.btnConnect.disabled = true;
  els.sessionStatus.textContent = `세션: ${room} · 온라인`;
  els.btnDisconnect.disabled = false;

  if(roomUnsub) roomUnsub();
  roomUnsub = roomRef(room).onSnapshot(snap => {
    if(snap.exists) renderRoom(snap.data());
  });
  
  buildStudentLink(room);
  setTab("q");
}

function disconnect(){
  if(roomUnsub) roomUnsub();
  roomUnsub = null;
  ROOM = null;
  els.sessionInput.disabled = false;
  els.btnConnect.disabled = false;
  els.btnDisconnect.disabled = true;
  els.sessionStatus.textContent = `세션: - · 오프라인`;
  els.studentLink.value = "";
  els.qrImg.src = ""; // 이미지 소스 초기화
}

// 이하 모든 코드는 이전과 동일하게 작동합니다.
// (생략)

// ===== 초기화 =====
function init(){
  if(!window.firebase || !window.db){
    alert("Firebase 라이브러리를 로드하는데 실패했습니다. 인터넷 연결이나 설정을 확인해주세요.");
    return;
  }

  if(MODE === 'admin'){
    document.querySelectorAll(".admin-only").forEach(e => e.classList.remove('hide'));
    els.studentPanel.classList.add('hide');
    setTab("q");
    els.btnDisconnect.disabled = true;
    bindAdminEvents();
  } else {
    document.querySelectorAll(".admin-only").forEach(e => e.classList.add('hide'));
    els.studentPanel.classList.remove('hide');
    els.joinModal.classList.remove("hide");
    els.sWrap.classList.add("hide");
    bindStudentEvents();

    if(ROOM){
      if(roomUnsub) roomUnsub();
      roomUnsub = roomRef(ROOM).onSnapshot(snap => { if(snap.exists) renderRoom(snap.data()); });
    }
  }
}

// 모든 외부 스크립트가 로드된 후 앱 초기화 실행
window.addEventListener("load", init);


// --- 나머지 함수들 (변경 없음) ---

function addQuestionUI(){
  const type = els.qType.value;
  const text = els.qText.value.trim();
  if(!text){ alert("문항을 입력하세요."); return; }

  let q = { type, text };
  if(type === "mcq"){
    const opts = [els.opt1.value, els.opt2.value, els.opt3.value, els.opt4.value].map(s=>s.trim());
    const ans = parseInt(els.qAnswer.value,10)-1;
    if(opts.some(v=>!v)){ alert("객관식 보기 1~4를 모두 입력하세요."); return; }
    if(!Number.isInteger(ans) || ans < 0 || ans > 3){ alert("정답 번호(1~4)를 입력하세요."); return; }
    q.options = opts; q.answer = ans;
  }else{
    const ansT = els.qAnswer.value.trim();
    if(!ansT){ alert("주관식 정답 텍스트를 입력하세요."); return; }
    q.answerText = ansT;
  }
  
  const file = els.qImg.files[0];
  const pushQ = (newQ) => {
    editQuestions.push(newQ);
    const it = CE("div","item");
    it.textContent = (newQ.type==="mcq" ? "[객관식] " : "[주관식] ") + newQ.text;
    els.qList.prepend(it);
    els.qText.value = ""; els.qAnswer.value=""; ["opt1","opt2","opt3","opt4"].forEach(k=>els[k].value=""); els.qImg.value="";
  };

  if(file){
    const reader = new FileReader();
    reader.onload = () => { q.image = reader.result; pushQ(q); };
    reader.readAsDataURL(file);
  }else{
    pushQ(q);
  }
}

async function saveQuestions(){
  const room = await ensureRoom(); if(!room) return;
  const docRef = roomRef(room);
  const doc = await docRef.get();
  const currentQuestions = doc.exists ? doc.data().questions || [] : [];
  
  const newQuestions = [...editQuestions.reverse(), ...currentQuestions];
  const title = els.quizTitle.value || doc.data()?.title || "퀴즈";

  await docRef.set({ questions: newQuestions, title }, { merge: true });
  editQuestions = [];
  els.qList.innerHTML = "";
  alert("문항 저장 완료");
}

function makeBlank(){
  els.quizTitle.value = "";
  els.qText.value=""; els.qAnswer.value="";
  ["opt1","opt2","opt3","opt4"].forEach(k=>els[k].value="");
  els.qImg.value="";
  editQuestions=[]; els.qList.innerHTML="";
}

function loadSample(){
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

async function saveOptions(){
  const room = await ensureRoom(); if(!room) return;
  const policy = {
    once: els.onceName.checked ? "name" : "device",
    openResult: els.openResult.checked,
    timer: Math.max(0, parseInt(els.timerSec.value,10) || 0)
  };
  const accept = !!els.allowSubmit.checked;
  await roomRef(room).set({ policy, accept }, { merge:true });
  buildStudentLink(room);
  alert("옵션 저장 완료 / QR 갱신");
}

async function resetAll(){
  const room = await ensureRoom(); if(!room) return;
  if(!confirm("이 세션의 모든 문항, 진행상태, 제출 결과를 초기화할까요?")) return;
  await roomRef(room).set(defaultRoom());
  alert("초기화 완료");
}

async function controlQuiz(action) {
  const room = await ensureRoom(); if(!room) return;
  const docRef = roomRef(room);

  if (action === 'start') {
    await docRef.update({ mode: "active", currentIndex: 0, accept: true });
  } else if (action === 'end') {
    await docRef.update({ mode: "ended", accept: false });
  } else {
    const doc = await docRef.get();
    if (!doc.exists) return;
    const data = doc.data();
    const max = (data.questions?.length || 0) - 1;
    let cur = data.currentIndex ?? -1;
    
    if (action === 'next') {
      if (cur < max) await docRef.update({ currentIndex: cur + 1 });
      else await controlQuiz('end');
    } else if (action === 'prev') {
      await docRef.update({ currentIndex: Math.max(0, cur - 1) });
    }
  }
}

function exportCSV(){
  const rows = [["이름", "점수"]];
  els.resBody.querySelectorAll("tr").forEach(tr => {
    const name = tr.cells[0].textContent.trim();
    const score = tr.cells[tr.cells.length - 1].textContent.trim();
    rows.push([name, score]);
  });
  const csv = rows.map(r => r.map(v => `"${(v || "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const a = CE("a");
  a.href = URL.createObjectURL(blob);
  a.download = `quiz_result_${ROOM}.csv`;
  a.click();
}

const getStudentId = () => localStorage.getItem("quiz_student_id") || (() => {
  const id = crypto.randomUUID();
  localStorage.setItem("quiz_student_id", id);
  return id;
})();

async function joinStudent(){
  const name = els.joinName.value.trim();
  if(!name){ alert("이름을 입력하세요"); return; }
  if(!ROOM){ alert("세션 코드가 없습니다."); return; }
  
  const sid = getStudentId();
  await respRef(ROOM, sid).set({ name, joinedAt: firebase.firestore.FieldValue.serverTimestamp(), deviceId, answers:{}, score:0 });
  await roomRef(ROOM).update({ 'counters.join': firebase.firestore.FieldValue.increment(1) });

  els.joinModal.classList.add("hide");
  els.sWrap.classList.remove("hide");
}

async function submitStudent(answerPayload){
  const sid = getStudentId();
  const roomSnap = await roomRef(ROOM).get();
  if(!roomSnap.exists) return;
  
  const doc = roomSnap.data();
  const qIdx = doc.currentIndex;
  if(qIdx < 0 || !doc.accept) { alert("제출 시간이 아닙니다."); return; }

  const q = doc.questions[qIdx];
  const respRef = roomRef(ROOM).collection("responses").doc(sid);
  const respSnap = await respRef.get();
  const data = respSnap.data() || { answers: {} };

  if(data.answers[qIdx] !== undefined){ alert("이미 제출했습니다."); return; }

  let isCorrect = false;
  if(q.type === "mcq"){
    isCorrect = (answerPayload === q.answer);
  } else {
    isCorrect = String(answerPayload || "").trim().toLowerCase() === String(q.answerText || "").trim().toLowerCase();
  }
  
  const updateData = { [`answers.${qIdx}`]: answerPayload };
  if (isCorrect) {
    updateData.score = firebase.firestore.FieldValue.increment(1);
  }
  await respRef.set(updateData, { merge: true });
  
  const counterUpdate = { 'counters.submit': firebase.firestore.FieldValue.increment(1) };
  counterUpdate[isCorrect ? 'counters.correct' : 'counters.wrong'] = firebase.firestore.FieldValue.increment(1);
  await roomRef(ROOM).update(counterUpdate);

  alert(isCorrect ? "정답입니다!" : "제출 완료!");
}

function renderRoom(r){
  els.pTitle.textContent = r.title || "퀴즈";
  els.sTitle.textContent = r.title || "퀴즈";
  els.chipJoin.textContent = r.counters?.join || 0;
  els.chipSubmit.textContent = r.counters?.submit || 0;
  els.chipCorrect.textContent = r.counters?.correct || 0;
  els.chipWrong.textContent = r.counters?.wrong || 0;
  
  const total = r.questions?.length || 0;
  const cur = r.currentIndex ?? -1;
  els.qCounter.textContent = `Q${Math.max(0, cur + 1)}/${total}`;
  if(MODE === 'admin') els.quizTitle.value = r.title || "";

  if (MODE === 'admin') {
    if(r.mode !== 'active' || cur < 0){
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
      if(q.type === "mcq"){
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
    if(r.mode === 'ended'){
      els.sWrap.classList.add("hide");
      els.sDone.classList.remove("hide");
      return;
    }
    if(r.mode !== 'active' || cur < 0 || !r.accept){
      els.joinModal.classList.add("hide");
      els.sWrap.classList.remove("hide");
      els.sState.textContent = r.accept ? "참가 완료! 퀴즈 시작을 기다려주세요." : "제출이 마감되었습니다.";
      els.sQBox.classList.add("hide");
      return;
    }
    
    const q = r.questions[cur];
    els.sState.classList.add("hide");
    els.sQBox.classList.remove("hide");
    els.sQTitle.textContent = `Q${cur+1}. ${q.text || ""}`;
    els.sQImg.src = q.image || "";
    els.sQImg.classList.toggle("hide", !q.image);
    els.sOptBox.innerHTML="";
    els.sShortWrap.classList.add("hide");

    if(q.type === "mcq"){
      let chosen = null;
      q.options.forEach((opt,i) => {
        const btn = CE("button","sopt");
        btn.textContent = `${i+1}. ${opt}`;
        btn.onclick = () => {
          chosen = i;
          [...els.sOptBox.children].forEach(c => c.classList.remove("active"));
          btn.classList.add("active");
        };
        els.sOptBox.appendChild(btn);
      });
      const submitBtn = CE("button","btn green");
      submitBtn.textContent="제출";
      submitBtn.style.gridColumn = "1 / -1";
      submitBtn.onclick = () => { if(chosen === null) alert("보기를 선택하세요"); else submitStudent(chosen); };
      els.sOptBox.appendChild(submitBtn);
    } else {
      els.sShort.value = "";
      els.sShortWrap.classList.remove("hide");
    }
  }
}

async function refreshResults(){
  if(!ROOM) return;
  const roomSnap = await roomRef(ROOM).get();
  if(!roomSnap.exists) return;

  const doc = roomSnap.data();
  const total = doc.questions?.length || 0;
  
  els.resHead.innerHTML = `<tr><th>이름</th>${Array.from({length: total}, (_, i) => `<th>Q${i+1}</th>`).join("")}<th>점수</th></tr>`;

  const respSnap = await roomRef(ROOM).collection("responses").get();
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

async function refreshMyResult(){
  const sid = getStudentId();
  const respSnap = await respRef(ROOM, sid).get();
  if(!respSnap.exists){ els.myResult.textContent = "제출 기록이 없습니다."; return; }

  const roomSnap = await roomRef(ROOM).get();
  const doc = roomSnap.data();
  const total = doc.questions?.length || 0;
  const v = respSnap.data();
  
  let resultHtml = `<p>이름: <b>${v.name||""}</b> · 점수: <b>${v.score||0} / ${total}</b></p>
    <table class="table">
      <thead><tr><th>문항</th><th>제출</th><th>정답</th><th>결과</th></tr></thead>
      <tbody>`;
  
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
    resultHtml += `<tr>
      <td>Q${i+1}</td>
      <td>${submittedAnsStr}</td>
      <td>${correctAnsStr}</td>
      <td>${ans !== undefined ? (isCorrect ? 'O' : 'X') : '-'}</td>
    </tr>`;
  }

  resultHtml += `</tbody></table>`;
  els.myResult.innerHTML = resultHtml;
  els.myResult.classList.remove("hide");
}

function bindAdminEvents(){
  els.tabQ.onclick = () => setTab("q");
  els.tabOpt.onclick = () => setTab("opt");
  els.tabPres.onclick = () => setTab("pres");
  els.tabRes.onclick = () => { setTab("res"); refreshResults(); };
  els.btnConnect.onclick = connect;
  els.btnDisconnect.onclick = disconnect;
  els.btnBlank.onclick = makeBlank;
  els.btnSample.onclick = loadSample;
  els.btnAddQ.onclick = addQuestionUI;
  els.btnSaveQ.onclick = saveQuestions;
  els.btnOptSave.onclick = saveOptions;
  els.btnOptReset.onclick = resetAll;
  els.btnCopy.onclick = () => navigator.clipboard.writeText(els.studentLink.value);
  els.btnOpen.onclick = () => { const u=els.studentLink.value; if(u) window.open(u,"_blank"); };
  els.btnStart.onclick = () => controlQuiz('start');
  els.btnPrev.onclick = () => controlQuiz('prev');
  els.btnNext.onclick = () => controlQuiz('next');
  els.btnEnd.onclick = () => controlQuiz('end');
  els.btnExport.onclick = exportCSV;
  els.btnResetAll.onclick = resetAll;
}

function bindStudentEvents(){
  els.btnJoin.onclick = joinStudent;
  els.btnMyResult.onclick = refreshMyResult;
  els.btnShortSend.onclick = () => submitStudent(els.sShort.value);
}

function init(){
  if(!window.firebase || !window.db){
    alert("Firebase 라이브러리를 로드하는데 실패했습니다. 인터넷 연결이나 설정을 확인해주세요.");
    return;
  }

  if(MODE === 'admin'){
    document.querySelectorAll(".admin-only").forEach(e => e.classList.remove('hide'));
    els.studentPanel.classList.add('hide');
    setTab("q");
    els.btnDisconnect.disabled = true;
    bindAdminEvents();
  } else {
    document.querySelectorAll(".admin-only").forEach(e => e.classList.add('hide'));
    els.studentPanel.classList.remove('hide');
    els.joinModal.classList.remove("hide");
    els.sWrap.classList.add("hide");
    bindStudentEvents();

    if(ROOM){
      if(roomUnsub) roomUnsub();
      roomUnsub = roomRef(ROOM).onSnapshot(snap => { if(snap.exists) renderRoom(snap.data()); });
    }
  }
}

// 모든 리소스(이미지 등)가 로드된 후 앱 초기화
window.addEventListener("load", init);
