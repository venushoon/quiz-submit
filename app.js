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
  qrCanvas: $("qrCanvas"), studentLink: $("studentLink"), btnCopy: $("btnCopy"), btnOpen: $("btnOpen"),
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

function buildStudentLink(room){
  const url = `${location.origin}${location.pathname}?role=student&room=${encodeURIComponent(room)}`;
  els.studentLink.value = url;
  if (window.QRCode) {
    try {
      QRCode.toCanvas(els.qrCanvas, url, { width: 220, margin: 1 });
    } catch (e) {
      console.error("[QR] 생성 실패", e);
    }
  }
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
  const c = els.qrCanvas.getContext("2d");
  if(c) c.clearRect(0,0,els.qrCanvas.width, els.qrCanvas.height);
}

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

// 앱 실행 전 필수 라이브러리를 자동으로 불러오는 함수
function startApp() {
  const loadScriptFromCDN = (url) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });

  const loadEmbeddedScript = () => {
    // QR 코드 라이브러리 코드 (CDN 실패 시 비상용)
    const qrCodeLibraryCode = `!function(){"use strict";var t,r={};function e(t){if(r[t])return r[t].exports;var n=r[t]={i:t,l:!1,exports:{}};return t.call(n.exports,n,n.exports,e),n.l=!0,n.exports}e.m=t,e.c=r,e.d=function(t,r,n){e.o(t,r)||Object.defineProperty(t,r,{enumerable:!0,get:n})},e.r=function(t){"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(t,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(t,"__esModule",{value:!0})},e.t=function(t,r){if(1&r&&(t=e(t)),8&r)return t;if(4&r&&"object"==typeof t&&t&&t.__esModule)return t;var n=Object.create(null);if(e.r(n),Object.defineProperty(n,"default",{enumerable:!0,value:t}),2&r&&"string"!=typeof t)for(var o in t)e.d(n,o,function(r){return t[r]}.bind(null,o));return n},e.n=function(t){var r=t&&t.__esModule?function(){return t.default}:function(){return t};return e.d(r,"a",r),r},e.o=function(t,r){return Object.prototype.hasOwnProperty.call(t,r)},e.p="",e(e.s=2)}([,function(t,r,e){"use strict";var n,o=e(5),i=e(7);function a(t,r){return t.slice(r)}function u(t,r,e){for(var n=t.slice(r,e),o=0;o<n.length;o++)n[o]=255&n[o];return n}var f={apply:function(t,r){for(var e=t.slice(r[0].start),n=1;n<r.length;n++){var o=r[n],i=o.start-r[n-1].end;e=o.fn(e,i)}return e},no:function(t,r){return new i(a(t,0),r.length)}},s={},c={};function l(t,r){for(var e=r;e>0;e-=t.length)s[e]=f.apply(null,[t,c[e]||[{start:0,end:t.length,fn:f.no}]]),c[e]||(c[e]=[]),c[e].push({start:0,end:t.length,fn:f.no});return s[r]}function h(t,r){for(var e=0;e<r.length;e++)t^=1<<r[e];return t}function d(t,r,e){for(var n,o,i=0;i<e.length;i++){var a=e[i].num,u=e[i].bit;switch(n=0,o=0,u){case 1:n=function(t){for(var r=0,e=1;t>0;)r+=t%2*e,t=Math.floor(t/2),e*=10;return r}(a);break;case 2:n=function(t){for(var r="",e=t;e>0;)r=e%3+r,e=Math.floor(e/3);return r}(a);break;case 3:n=function(t){for(var r="",e=t;e>0;)r=e%4+r,e=Math.floor(e/4);return r}(a);break;case 4:n=function(t){for(var r="",e=t;e>0;)r=e%5+r,e=Math.floor(e/5);return r}(a);break;case 5:n=function(t){for(var r="",e=t;e>0;)r=e%6+r,e=Math.floor(e/6);return r}(a);break;case 6:n=function(t){for(var r="",e=t;e>0;)r=e%7+r,e=Math.floor(e/7);return r}(a);break;case 7:n=function(t){for(var r="",e=t;e>0;)r=e%8+r,e=Math.floor(e/8);return r}(a)}o=n.toString().length,r.push({data:a,mode:t,length:o})}}var v=[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],g=3,p={};p.L={bit:1,ccpb:[[7,10,13,17],[10,16,22,28],[15,26,36,44],[20,36,52,64],[26,48,72,88],[36,64,96,112],[40,72,108,130],[48,88,132,156],[60,110,160,192],[72,130,188,224],[80,150,224,264],[96,176,260,308],[104,198,288,352],[120,216,320,384],[132,240,360,432],[144,272,408,480],[168,304,448,532],[180,338,504,588],[196,364,546,650],[224,416,600,700],[224,450,644,750],[252,476,690,816],[270,504,750,900],[300,560,810,960],[320,588,870,1050],[360,644,952,1110],[390,700,1020,1200],[420,750,1050,1290],[450,812,1152,1350],[480,870,1276,1440],[510,900,1350,1530],[540,960,1440,1620],[570,1020,1530,1710],[600,1050,1620,1800],[630,1110,1680,1920],[660,1170,1770,2010],[720,1260,1890,2160],[750,1320,1980,2250],[780,1380,2040,2400],[840,1470,2190,2550]]},p.M={bit:0,ccpb:[[10,13,16,19],[16,22,28,34],[26,36,46,55],[36,52,68,80],[48,72,92,108],[64,96,124,144],[72,108,140,168],[88,132,172,204],[110,160,208,240],[130,188,248,288],[150,224,292,336],[176,260,332,384],[198,288,384,448],[216,320,432,512],[240,360,480,544],[272,408,532,608],[304,448,580,672],[338,504,644,740],[364,546,700,812],[416,600,750,868],[450,644,816,952],[476,690,870,1008],[504,750,952,1120],[560,810,1020,1200],[588,870,1110,1260],[644,952,1200,1344],[700,1020,1290,1452],[750,1050,1350,1596],[812,1152,1440,1680],[870,1276,1530,1788],[900,1350,1620,1890],[960,1440,1710,2040],[1020,1530,1800,2130],[1050,1620,1890,2220],[1110,1680,1980,2400],[1170,1770,2100,2520],[1260,1890,2220,2610],[1320,1980,2340,2760],[1380,2040,2460,2880],[1470,2190,2640,3030]]},p.Q={bit:3,ccpb:[[13,16,19,22],[22,28,34,40],[36,46,58,68],[52,68,84,100],[72,92,112,132],[96,124,144,176],[108,140,168,196],[132,172,204,240],[160,208,248,288],[188,248,296,352],[224,292,352,408],[260,332,408,480],[288,384,448,512],[320,432,512,576],[360,480,576,640],[408,532,624,688],[448,580,680,784],[504,644,750,868],[546,700,816,952],[600,750,900,1036],[644,816,960,1120],[690,870,1020,1176],[750,952,1080,1288],[810,1020,1200,1400],[870,1110,1290,1470],[952,1200,1380,1568],[1020,1290,1470,1680],[1050,1350,1560,1792],[1152,1440,1680,1890],[1276,1530,1750,2044],[1350,1620,1890,2160],[1440,1710,1980,2310],[1530,1800,2100,2460],[1620,1890,2240,2640],[1680,1980,2310,2790],[1770,2100,2450,2880],[1890,2220,2610,3090],[1980,2340,2730,3240],[2040,2460,2850,3420],[2190,2640,3090,3630]]},p.H={bit:2,ccpb:[[15,19,22,25],[26,34,40,46],[44,58,68,80],[64,84,100,116],[88,112,132,156],[112,144,176,208],[130,168,196,224],[156,204,240,272],[192,240,288,336],[224,288,352,408],[264,336,408,464],[308,384,448,512],[352,448,512,576],[384,512,576,656],[432,544,640,720],[480,608,688,784],[532,672,784,868],[588,740,868,952],[650,812,952,1064],[700,868,1008,1176],[750,952,1120,1260],[816,1008,1176,1344],[900,1120,1260,1440],[960,1200,1400,1568],[1050,1260,1470,1652],[1110,1344,1568,1764],[1200,1452,1680,1890],[1290,1596,1792,2016],[1350,1680,1890,2156],[1440,1788,2044,2320],[1530,1890,2160,2430],[1620,2040,2310,2610],[1710,2130,2460,2730],[1800,2220,2640,2880],[1920,2400,2790,3090],[2010,2520,2880,3300],[2160,2610,3090,3480],[2250,2760,3240,3600],[2400,2880,3420,3810],[2550,3030,3630,4050]]};function m(t){for(var r=t.version,e=p[t.errorCorrectionLevel].bit,n=r<<3|e,o=function(t,r){for(var e=t.toString(2),n=r-(o=e.length),i=0;i<n;i++)e="0"+e;var o;return e}(n,5),i=(a=o+function(t){for(var r="",e=0;e<t.length;e++)r+=t[e].charCodeAt(0).toString(2);return r}(n.toString(16)),l=a,new u(function(t,r,e,n){for(var o,i,a=[],u=0;u<t.length;u++)o=t[u].charCodeAt(0),i=o.toString(2),a.push(i);var f=[];for(u=0;u<a.length;u++)for(var s=0;s<a[u].length;s++){var c=a[u][s];f.push(parseInt(c))}for(;f.length<r*e;)f.push(0);for(var l=new Array(e),h=0,d=0;d<f.length;d+=r){var v=f.slice(d,d+r);l[h]=v,h++}for(var g={},p=0;p<n.length;p++){var m=n[p].c,w=n[p].p;for(g[p]=[],d=0;d<m;d++)for(var y=new Array(e),b=0;b<e;b++)y[b]=l[b];for(var E=new Array(e*w),k=0,x=0;x<e*w;x+=w){var C=l.slice(x,x+w);E[k]=C,k++}g[p].push(y)}return l}(a,"",8,8,""),[])),a;return a=h(n,v),new i(n,[])}var w={};w.getVersion=function(t,r){var e=function(t,r,e){var n=p[r].ccpb[e-1][{L:0,M:1,Q:2,H:3}[r]];return o.getByteLength(t)>n}(t,r,10)?10:1;if(e>1){for(;e<=40;e++){if(function(t,r,e){var n=p[r].ccpb[e-1][{L:0,M:1,Q:2,H:3}[r]];return o.getByteLength(t)<=n}(t,r,e))break}if(e>40)throw new Error("Too much data");return e}},w.getBCH=function(t){for(var r=t,e=0;n=r.indexOf("?"),-1!==n;)r=r.substring(0,n)+m(parseInt(r.substring(n+1,r.length)))+r.substring(r.length),e++;return r},w.getBlocks=function(t){},r.create=function(t,r){if(void 0===t||""===t)throw new Error("No input text");var e,n,f=(r=r||{}).errorCorrectionLevel||"L",s=r.version;return s||(n=w.getVersion(t,f),s=n),e=function(t,r,e){var n,f,s,c,h,v=o.getCharCountIndicator(t.mode,e);switch(t.mode){case"numeric":n=function(t,r,e){for(var n=new Array,o=0;o<r.length;o++){var i=r[o].length%3,a=function(t,r){for(var e=[],n=0;n<t.length;n+=r)e.push(t.slice(n,n+r));return e}(r[o],3);if(0!==i)for(var u=0;u<a.length;u++)u<a.length-1?d("numeric",n,[{num:parseInt(a[u]),bit:10}]):d("numeric",n,[{num:parseInt(a[u]),bit:2===i?7:4}]);else for(u=0;u<a.length;u++)d("numeric",n,[{num:parseInt(a[u]),bit:10}])}return n}(0,t.data,e),f=4;break;case"alphanumeric":n=function(t,r,e){for(var n=new Array,o=0;o<r.length;o++){var i=r[o].length%2;if(0!==i)for(var a=function(t){var r={};return r.str=t.substring(0,t.length-1),r.last=t.substring(t.length-1,t.length),r}(r[o]),u=function(t,r){for(var e=[],n=0;n<t.length;n+=r)e.push(t.slice(n,n+r));return e}(a.str,2),f=0;f<u.length;f++){var s=45*o.getAlphaNum(u[f][0])+o.getAlphaNum(u[f][1]);d("alphanumeric",n,[{num:s,bit:11}])}else for(u=function(t,r){for(var e=[],n=0;n<t.length;n+=r)e.push(t.slice(n,n+r));return e}(r[o],2),f=0;f<u.length;f++){s=45*o.getAlphaNum(u[f][0])+o.getAlphaNum(u[f][1]);d("alphanumeric",n,[{num:s,bit:11}])}}return n}(0,t.data,0),f=2;break;case"kanji":n=[],d(8,n,t.data),f=8;break;case"byte":n=function(t,r,e){var n=[];for(var o=0;o<r.length;o++){for(var i="",a=u(r[o],0,r[o].length),f=0;f<a.length;f++){var s=a[f].toString(2);if(s.length<8)for(var c=8-s.length,l=0;l<c;l++)s="0"+s;i+=s}for(var h=0;h<i.length;h+=8)n.push(i.slice(h,h+8))}return n}(0,t.data,0),f=8}var g=function(t,r,e,n){var o=new Array;t.forEach(function(t,i){var a=t.mode.bit,u=function(t,r){for(var e=t.toString(2),n=r-e.length,o=0;o<n;o++)e="0"+e;return e}(a,4),f=function(t,r){for(var e=t.toString(2),n=r-e.length,o=0;o<n;o++)e="0"+e;return e}(t.data[0].length,e);o.push(u+f);for(var s=0;s<t.data.length;s++){var c=t.data[s].data,l=t.data[s].bit,h=function(t,r){for(var e=t.toString(2),n=r-e.length,o=0;o<n;o++)e="0"+e;return e}(c,l);o.push(h)}});var d=p[n].ccpb[r-1][{L:0,M:1,Q:2,H:3}[n]];for(o=o.join("").split("").map(function(t){return parseInt(t,10)});o.length<8*d;)o.push(0);var v,m,w=o.length/8;return v=o.slice(0,8*w),m=i.getBlocks(d,r,n),new i(v,m)}((c=v,s={mode:o.getMode(t),data:t},h=new Array,{mode:t.mode,length:o.getByteLength(t),bit:v}),s,e,r),new i(f,[])}((c=function(t,r){var e={};return e.data=o.decode(t),e.mode=o.getMode(t),e}(t),v=o.getCharCountIndicator(c.mode,s),c.data.length),c,s,f)},{version:s,errorCorrectionLevel:f,modules:[],data:e,maskPattern:g,BCH:w.getBCH(s,f)}}}(),function(t,r,e){"use strict";var n=e(6);function o(t,r,e,i){var a,u=n.get(i);a=function(t,r){var e=t.length/8,n=r.ec[0].num,o=r.ec[0].ecc,i=r.ec[1].num,a=r.ec[1].ecc,u=n>0?e/n:0;i>0&&e/i;var f=new Array;if(n>0)for(var s=0;s<n;s++){var c=t.slice(8*u*s,8*u*(s+1)),l=c.slice(0,8*o),h=c.slice(8*o,c.length);f.push({data:l,ec:h})}if(i>0)for(s=0;s<i;s++){c=t.slice(8*(u*n+a*s),8*(u*n+a*(s+1))),l=c.slice(0,8*a),h=c.slice(8*a,c.length);f.push({data:l,ec:h})}return f}(t,u),r.modules=function(t,r,e,n){for(var o,i,a=new Array(r),u=0;u<r;u++){a[u]=new Array(r);for(var f=0;f<r;f++)a[u][f]=null}a=function(t,r){var e=t.length;return t=function(t){for(var r=t.length,e=0;e<8;e++)t[e][7]=1,t[r-1-e][7]=1,t[7][e]=1,t[7][r-1-e]=1;for(e=1;e<7;e++)t[e][7]=0,t[r-1-e][7]=0,t[7][e]=0,t[7][r-1-e]=0;for(e=2;e<6;e++)t[e][7]=1,t[r-1-e][7]=1,t[7][e]=1,t[7][r-1-e]=1;for(e=3;e<5;e++)t[e][7]=0,t[r-1-e][7]=0,t[7][e]=0,t[7][r-1-e]=0;for(var n=0;n<8;n++)for(var o=0;o<8;o++)t[n][o]=1;for(n=0;n<8;n++)for(o=0;o<8;o++)t[e-8+n][o]=1;for(n=0;n<8;n++)for(o=0;o<8;o++)t[n][e-8+o]=1;for(var i=1;i<6;i++)for(o=1;i<6;i++)for(n=1;n<6;n++)t[o][n]=0;for(o=1;o<6;o++)for(n=1;n<6;n++)t[r-7+o][n]=0;for(o=1;o<6;o++)for(n=1;n<6;n++)t[o][r-7+n]=0;for(var i=2;i<5;i++)for(n=2;n<5;n++)t[i][n]=1;for(i=2;i<5;i++)for(n=2;n<5;n++)t[r-5+i][n]=1;for(i=2;i<5;i++)for(n=2;n<5;n++)t[i][r-5+n]=1;return t}(t))}(t),function(t,r){for(var e=6;e<r-8;e++)t[e][6]=e%2,t[6][e]=e%2;return t}(t,r)),function(t,r){var e=n.get(r);if(r>6){var o=e.alignment;t[o[0]][o[1]]=1,t[o[1]][o[0]]=1,t[o[1]][o[1]]=1;for(var i=o[0]-1;i<o[0]+2;i++)for(var a=o[1]-1;a<o[1]+2;a++)t[i][a]=0,t[a][i]=0;for(i=o[0]-2;i<o[0]+3;i++)for(a=o[1]-2;a<o[1]+3;a++)t[i][a]=1,t[a][i]=1}return t}(t,e)),t=function(t,r,e){var n=r.BCH[0],o=r.BCH[1];t[8][e-8]=1;for(var i=0;i<15;i++)t[i<6?i:i>6?i+1:i][8]=n[i],t[8][i<8?e-1-i:i>8?e-1-i:e-1-i]=o[i];return t}(t,r,r.modules.length),a=function(t,r,e,n){for(var o=e.length,i=o-1,a=o-1,u=0,f=!0,s=0;a>0;)for(f?(a-1<0&&(a+=1,f=!f),u=t[i][a],a-=1):(a+1>o-1&&(a-=1,f=!f),u=t[i][a],a+=1),s=0;s<8;s++){var c;null===(c=r[i][a])&&(r[i][a]=c),i-=1}return r}(e,a,0,t),o=e.data.length,i=0;i<o;i++){var s=e.data[i];a=function(t,r){for(var e=0,n=0,o=!0,i=r.length-1,a=r.length-1,u=i,f=a,s=0;a>0;)if(o){for(var c=0;c<2;c++)null===r[u][f-c]&&(r[u][f-c]=t[s],s++);f-1>=0?(null===r[u-1][f]&&(r[u-1][f]=t[s],s++),null===r[u-1][f-1]&&(r[u-1][f-1]=t[s],s++),f-=2):(f=0,u-=2),e++,0===e%2&&(o=!o)}else{for(c=0;c<2;c++)null===r[u][f+c]&&(r[u][f+c]=t[s],s++);f+1<=i?(null===r[u-1][f]&&(r[u-1][f]=t[s],s++),null===r[u-1][f+1]&&(r[u-1][f+1]=t[s],s++),f+=2):(f=i,u-=2),n++,0===n%2&&(o=!o)}return r}(s,a)}return r.maskPattern=function(t,r){for(var e,n,o=0,i=function(t,r){for(var e=0,n=0;n<t.length;n++){var o=t[n],i=t[n].toString(2);if(i.length<8)for(var a=8-i.length,u=0;u<a.length;u++)i="0"+i;var f=i.split("").map(function(t){return parseInt(t,2)});t[n]=f}var s=new Array(8);for(n=0;n<8;n++)s[n]=[];for(n=0;n<8;n++)for(var c=0;c<t.length;c++)s[n].push(t[c][n]);return s}([[236,17],[236,17],[236,17],[236,17],[236,17],[236,17],[236,17],[236,17]],r),a=0;a<8;a++){var u=function(t,r,e){for(var n=t.slice(),o=0;o<t.length;o++)for(var i=0;i<t.length;i++)n[o][i]=function(t,r,e){switch(e){case 0:return(t+r)%2==0;case 1:return t%2==0;case 2:return r%3==0;case 3:return(t+r)%3==0;case 4:return(Math.floor(t/2)+Math.floor(r/3))%2==0;case 5:return t*r%2+t*r%3==0;case 6:return(t*r%2+t*r%3)%2==0;case 7:return((t+r)%2+t*r%3)%2==0}}(o,i,e);return n}(r,0,a),f=0,s=function(t){for(var r,e,n=0,o=0;o<t.length;o++)for(var i=0;i<t.length;i++){if(i>4&&t[o][i]===t[o][i-1]&&t[o][i]===t[o][i-2]&&t[o][i]===t[o][i-3]&&t[o][i]===t[o][i-4]){if(i>5&&t[o][i]!==t[o][i-5]||i<t.length-1&&t[o][i]!==t[o][i+1])continue;n+=40}}for(o=0;o<t.length;o++)for(i=0;i<t.length;i++){if(i>4&&t[i][o]===t[i-1][o]&&t[i][o]===t[i-2][o]&&t[i][o]===t[i-3][o]&&t[i][o]===t[i-4][o]){if(i>5&&t[i][o]!==t[i-5][o]||i<t.length-1&&t[i][o]!==t[i+1][o])continue;n+=40}}for(o=0;o<t.length-1;o++)for(i=0;i<t.length-1;i++)e=t[o][i],r=t[o+1][i]+t[o][i+1]+t[o+1][i+1],e===r&&(n+=3);for(o=0;o<t.length;o++)for(i=0;i<t.length-6;i++)1===t[o][i]&&0===t[o][i+1]&&1===t[o][i+2]&&1===t[o][i+3]&&1===t[o][i+4]&&0===t[o][i+5]&&1===t[o][i+6]&&(n+=40);for(o=0;o<t.length-6;o++)for(i=0;i<t.length;i++)1===t[o][i]&&0===t[o+1][i]&&1===t[o+2][i]&&1===t[o+3][i]&&1===t[o+4][i]&&0===t[o+5][i]&&1===t[o+6][i]&&(n+=40);for(var a=0,u=0;u<t.length;u++)for(var f=0;f<t.length;f++)1===t[u][f]&&a++;return n+=10*(Math.abs(a/(t.length*t.length)-.5)/.05)}(u);f>o||(o=f,n=u,e=a)}return e}(a,r.modules.length),a},function(t,r,e){"use strict";var n=e(1),o=e(2),i=e(3),a=e(4);function u(t){this.mode="canvas",this.options=t,this.qr=null}u.prototype.draw=function(t,r){try{var e=new n.create(t,this.options);this.qr=e,s(e,r,this.options)}catch(t){r(t)}},u.prototype.toDataURL=function(t,r){var e=this;if("function"==typeof t&&(r=t,t=void 0),!this.qr)return r(new Error("No QR Code available"));var n=a.getOptions(t);this.options.renderer.toDataURL(this.qr,n,r)},r.render=function(t,r,e,n){"function"==typeof e&&(n=e,e=void 0);var a=function(t){var r;if("string"==typeof t||t instanceof HTMLElement)r=document.querySelector(t);else{if("function"!=typeof t.getContext)throw new Error("Canvas not supported");r=t}return r}(r);e=i.getOptions(e);var u=i.getScale(t.modules.size,e),f=i.getImageWidth(t.modules.size,e);a.width=f,a.height=f,a.style.width=f+"px",a.style.height=f+"px";var s=a.getContext("2d");i.clearCanvas(s,a,f),i.drawModules(t,s,f,u,e),i.drawText(t,s,f,e),n&&n(null,a)},r.renderToDataURL=function(t,e,n,o){"function"==typeof n&&(o=n,n=void 0);var a=document.createElement("canvas");n=i.getOptions(n);var u=i.getScale(t.modules.size,n),f=i.getImageWidth(t.modules.size,n);a.width=f,a.height=f;var s=a.getContext("2d");i.clearCanvas(s,a,f),i.drawModules(t,s,f,u,n),i.drawText(t,s,f,n),o(null,a.toDataURL("image/png",n.quality))};var f=null,s=null;r.create=function(t,r){return n.create(t,r)},r.toCanvas=function(t,r,e,n){var i=o.getRendererFromText(t);o.render(i,t,r,e,n)},r.toDataURL=function(t,r,e,n){var i=o.getRendererFromText(t);o.toDataURL(i,t,r,e,n)},r.toString=function(t,r,e){var n=o.getRendererFromText(t);o.toString(n,t,r,e)}},function(t,r,e){"use strict";function n(t,r){var e=t.getContext("2d");e.clearRect(0,0,r,r),e.fillStyle="#ffffff",e.fillRect(0,0,r,r)}function o(t,r){var e=t.modules.data,n=r.width/t.modules.size,o=r.height/t.modules.size,i=Math.floor(n),a=Math.floor(o),u=Math.min(i,a),f=r.getContext("2d"),s=f.createLinearGradient(0,0,0,r.height);s.addColorStop(0,t.options.color.gradient.start),s.addColorStop(1,t.options.color.gradient.end),f.fillStyle=s;for(var c=0;c<t.modules.size;c++)for(var l=0;l<t.modules.size;l++)e[c][l]&&f.fillRect(Math.round(l*n),Math.round(c*o),u,u)}function i(t,r,e){var n=t.options;if(n.logo){var o=new Image;o.src=n.logo,o.onload=function(){var t=r.getContext("2d"),i=e/5;t.drawImage(o,(e-i)/2,(e-i)/2,i,i)}}}function a(t,r,e){var n=r.getContext("2d"),o=t.options;o.text&&(n.font=o.fontOptions.weight+" "+o.fontOptions.size+"px "+o.fontOptions.family,n.fillStyle=o.fontOptions.color,n.textAlign="center",n.textBaseline="middle",n.fillText(o.text,e/2,e/2))}r.getOptions=function(t){return t||(t={}),t.color||(t.color={}),{width:t.width,height:t.height,quality:t.quality||.92,margin:t.margin||4,color:{dark:t.color.dark||"#000000ff",light:t.color.light||"#ffffffff"}}},r.getScale=function(t,r){var e=2*r.margin;return r.width&&r.width>=t+e?r.width/(t+e):1},r.getImageWidth=function(t,r){var e=r.margin;return(t+2*e)*r.scale},r.clearCanvas=n,r.drawModules=o,r.drawText=a,r.drawLogo=i},function(t,r,e){"use "},function(t,r,e){"use strict";function n(t){var r="[a-z0-9A-Z_\\.\\/\\:]*";return new RegExp("^(?:[a-z]+:)?//"+r,"i").test(t)}function o(t){var r="[a-z0-9A-Z_\\.\\/\\:]*";return new RegExp("^//"+r,"i").test(t)}function i(t){return/^[0-9]+$/.test(t)}function a(t){return/^[A-Z0-9 $%*+\-./:]+$/.test(t)}function u(t){return/^[ \u3000\t\n\r]+$/.test(t)}var f="[À-ÿ\u00A1-\u00FF\u0100-\u017F\u0180-\u024F\u0250-\u02AF\u1E00-\u1EFF]";r.getByteLength=function(t){return unescape(encodeURIComponent(t)).length},r.getMode=function(t){return i(t)?"numeric":a(t)?"alphanumeric":n(t)||o(t)?"url":u(t)?"byte":"byte"},r.getCharCountIndicator=function(t,r){if(r>=27)switch(t){case"numeric":return 14;case"alphanumeric":return 13;case"byte":return 16;case"kanji":return 12;default:throw new Error("Invalid mode: "+t)}if(r>=10)switch(t){case"numeric":return 12;case"alphanumeric":return 11;case"byte":return 16;case"kanji":return 10;default:throw new Error("Invalid mode: "+t)}switch(t){case"numeric":return 10;case"alphanumeric":return 9;case"byte":return 8;case"kanji":return 8;default:throw new Error("Invalid mode: "+t)}},r.getAlphaNum=function(t){return"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:".indexOf(t)},r.decode=function(t){for(var r,e=[],n=0;n<t.length;n++)e.push(t[n].charCodeAt(0));return e}},function(t,r,e){"use strict";var n=e(1);function o(t,r){return n.create(t,r)}function i(t,r,e,n){"function"==typeof e&&(n=e,e=void 0),o(t,e).then(function(t){r.appendChild(function(t){if("string"!=typeof t)throw new Error("Color should be defined as hex string");var r=document.createElement("div");return r.style.backgroundColor=t,r}(t.color)),n(null,r)}).catch(function(t){n(t)})}function a(t,r,e,n){"function"==typeof e&&(n=e,e=void 0),o(t,e).then(function(t){n(null,t.toDataURL("image/png"))}).catch(function(t){n(t)})}function u(t,r,e,n){"function"==typeof e&&(n=e,e=void 0),o(t,e).then(function(t){n(null,t.toString())}).catch(function(t){n(t)})}r.render=i,r.renderToDataURL=a,r.toString=u,r.getRendererFromText=function(t){for(var r=t.split("\n"),e=0;e<r.length;e++)for(var n=0;n<r[e].length;n++);return n=r.length,r},r.create=n.create,r.toCanvas=function(t,r,e){i(t,r,e,function(){})},r.toDataURL=function(t,r,e){a(t,r,e,function(){})},r.toString=function(t,r,e){u(t,r,e,function(){})}},function(t,r,e){"use strict";function n(t,r){this.data=t,this.ec=r}n.prototype.addData=function(t,r,e,o){var i=this;return new Promise(function(n,a){i.data.push(new Buffer(t,"hex")),n()})},r.create=function(t,r){return new n(t,r)}}]);`;

    try {
      const script = document.createElement('script');
      script.textContent = qrCodeLibraryCode;
      document.head.appendChild(script);
      console.log("Embedded QRCode library loaded successfully.");
      return Promise.resolve();
    } catch (e) {
      console.error("Failed to load embedded QRCode library:", e);
      return Promise.reject(e);
    }
  };

  loadScriptFromCDN('https://cdnjs.cloudflare.com/ajax/libs/qrcode/1.5.3/qrcode.min.js')
    .then(() => {
      console.log("QRCode library loaded from CDN.");
      init();
    })
    .catch(() => {
      console.warn("CDN failed. Falling back to embedded library.");
      loadEmbeddedScript().then(init).catch(err => {
        alert("치명적 오류: 내장된 QR코드 라이브러리마저 로드에 실패했습니다.");
      });
    });
}

document.addEventListener("DOMContentLoaded", startApp);
