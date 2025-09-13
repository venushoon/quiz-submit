// ===== 유틸 =====
const $ = (id) => document.getElementById(id);
const qs = (sel, root=document) => root.querySelector(sel);
const CE = (tag, cls) => { const el = document.createElement(tag); if(cls) el.className = cls; return el; };
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

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
  quizTitle: $("quizTitle"), quizCount: $("quizCount"),
  btnBlank: $("btnBlank"), btnSample: $("btnSample"), btnSaveQ: $("btnSaveQ"),
  btnUpload: $("btnUpload"), btnTemplate: $("btnTemplate"),
  qText: $("qText"), qType: $("qType"), qAnswer: $("qAnswer"), qImg: $("qImg"),
  mcqBox: $("mcqBox"), opt1: $("opt1"), opt2: $("opt2"), opt3: $("opt3"), opt4: $("opt4"),
  btnAddQ: $("btnAddQ"), qList: $("qList"),
  // 옵션
  onceDevice: $("onceDevice"), onceName: $("onceName"),
  allowSubmit: $("allowSubmit"), openResult: $("openResult"), brightMode: $("brightMode"),
  timerSec: $("timerSec"), btnOptSave: $("btnOptSave"), btnOptReset: $("btnOptReset"), timerLabel: $("timerLabel"),
  qrCanvas: $("qrCanvas"), studentLink: $("studentLink"), btnCopy: $("btnCopy"), btnOpen: $("btnOpen"),
  // 프레젠테이션
  btnStart: $("btnStart"), btnPrev: $("btnPrev"), btnNext: $("btnNext"), btnEnd: $("btnEnd"),
  chipJoin: $("chipJoin"), chipSubmit: $("chipSubmit"), chipCorrect: $("chipCorrect"), chipWrong: $("chipWrong"),
  qCounter: $("qCounter"), liveTimer: $("liveTimer"),
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
let MODE = "admin"; // 기본은 관리자
let roomUnsub = null;
let respUnsub = null;
let TIMER = { remain: 0, handle: null };

// 파서
const U = new URL(location.href);
const paramRole = (U.searchParams.get("role")||"").toLowerCase();
const paramRoom = U.searchParams.get("room");

// [수정] 학생/관리자 초기 모드 결정 로직 단순화
if (paramRole === "student" && paramRoom) {
  MODE = "student";
  ROOM = paramRoom.trim();
} else {
  MODE = "admin";
}

// Firestore 레퍼런스
const roomRef = (room) => FS.doc("rooms", room);
const respRef = (room, id) => FS.doc("rooms", room, "responses", id);

// 로컬 식별자(기기)
const deviceId = (() => {
  const k = "quiz_device_id";
  let v = localStorage.getItem(k);
  if(!v){ v = crypto.randomUUID(); localStorage.setItem(k, v); }
  return v;
})();

// 탭 전환
function setTab(t){
  [els.tabQ, els.tabOpt, els.tabPres, els.tabRes].forEach(b=>b.classList.remove("active"));
  [els.panelQ, els.panelOpt, els.panelPres, els.panelRes].forEach(p=>p.classList.add("hide"));
  if(t==="q"){ els.tabQ.classList.add("active"); els.panelQ.classList.remove("hide"); }
  if(t==="opt"){ els.tabOpt.classList.add("active"); els.panelOpt.classList.remove("hide"); }
  if(t==="pres"){ els.tabPres.classList.add("active"); els.panelPres.classList.remove("hide"); }
  if(t==="res"){ els.tabRes.classList.add("active"); els.panelRes.classList.remove("hide"); }
}

// 기본 룸 문서
function defaultRoom(){
  return {
    title: els.quizTitle?.value || "샘플 퀴즈",
    questions: [
      { type:"mcq", text:"가장 큰 행성은?", options:["지구","목성","화성","금성"], answer:1 },
      { type:"mcq", text:"태양에서 세 번째 행성?", options:["수성","화성","지구","금성"], answer:2 },
      { type:"short", text:"지구의 위성 이름은?", answerText:"달" }
    ],
    currentIndex: -1, // 시작 전
    mode: "idle",     // idle/active/ended
    accept: true,
    counters: { join:0, submit:0, correct:0, wrong:0 },
    createdAt: FS.serverTimestamp(),
    bright: false,
    policy: { once:"device", openResult:false, timer: 30 }
  };
}

// 옵션 저장 시 학생 링크/QR 갱신
function buildStudentLink(room){
  const url = `${location.origin}${location.pathname}?role=student&room=${encodeURIComponent(room)}`;
  els.studentLink.value = url;
  try{
    const canvas = els.qrCanvas;
    // QRCode 라이브러리 사용
    QRCode.toCanvas(canvas, url, { width: 220, margin: 1, color: { dark: '#0f1620', light: '#ffffff' } });
  }catch(e){ console.warn("[QR] 생성 실패", e); }
}

// ====== 관리자 플로우 ======
async function ensureRoom(){
  const room = (ROOM || els.sessionInput.value.trim());
  if(!room){ alert("세션 코드를 입력하세요."); return null; }
  ROOM = room;
  const doc = await FS.getDoc(roomRef(room));
  if(!doc.exists){
    await FS.setDoc(roomRef(room), defaultRoom());
  }
  return room;
}

async function connect(){
  const room = await ensureRoom();
  if(!room) return;
  // 세션 잠금: 입력 비활성 & 세션 상태
  els.sessionInput.value = room;
  els.sessionInput.disabled = true;
  els.btnConnect.disabled = true;
  els.sessionStatus.textContent = `세션: ${room} · 온라인`;
  els.btnDisconnect.disabled = false;

  // 구독
  if(roomUnsub) roomUnsub();
  roomUnsub = FS.onSnapshot(roomRef(room), snap => {
    if(snap.exists) renderRoom(snap.data());
  });
  
  // 접속 시 바로 QR코드 생성
  buildStudentLink(room);

  // 탭은 문항으로
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
  // 학생 링크/QR 초기화
  els.studentLink.value = "";
  const c = els.qrCanvas.getContext("2d"); 
  if (c) {
    c.clearRect(0,0,els.qrCanvas.width, els.qrCanvas.height);
  }
}

// 문항 추가(메모리 저장 → 저장 버튼으로 Firestore 반영)
let editQuestions = [];
function addQuestionUI(){
  const type = els.qType.value;
  const text = els.qText.value.trim();
  if(!text){ alert("문항을 입력하세요."); return; }

  let q = { type, text };
  if(type === "mcq"){
    const opts = [els.opt1.value, els.opt2.value, els.opt3.value, els.opt4.value].map(s=>s.trim());
    const ans = parseInt(els.qAnswer.value,10)-1;
    if(opts.some(v=>!v)){ alert("객관식 보기 1~4를 모두 입력하세요."); return; }
    if(!(ans>=0 && ans<4)){ alert("정답 번호(1~4)를 입력하세요."); return; }
    q.options = opts; q.answer = ans;
  }else{
    const ansT = els.qAnswer.value.trim();
    if(!ansT){ alert("주관식 정답 텍스트를 입력하세요."); return; }
    q.answerText = ansT;
  }
  // 이미지(선택)
  const file = els.qImg.files[0];
  if(file){
    const reader = new FileReader();
    reader.onload = () => { q.image = reader.result; pushQ(q); };
    reader.readAsDataURL(file);
  }else{
    pushQ(q);
  }
}
function pushQ(q){
  editQuestions.push(q);
  const it = CE("div","item");
  it.textContent = (q.type==="mcq" ? "[객관식] " : "[주관식] ") + q.text;
  els.qList.prepend(it);
  // 입력창 비우기
  els.qText.value = ""; els.qAnswer.value=""; ["opt1","opt2","opt3","opt4"].forEach(k=>els[k].value=""); els.qImg.value="";
}

async function saveQuestions(){
  const room = await ensureRoom(); if(!room) return;
  let doc = (await FS.getDoc(roomRef(room))).data();
  if(!doc) doc = defaultRoom();
  if(editQuestions.length>0){
    doc.questions = doc.questions.concat(editQuestions);
    editQuestions = [];
    els.qList.innerHTML = "";
  }
  doc.title = els.quizTitle.value || doc.title;
  await FS.setDoc(roomRef(room), doc, { merge:true });
  alert("문항 저장 완료");
}

function makeBlank(){
  els.qText.value=""; els.qAnswer.value="";
  ["opt1","opt2","opt3","opt4"].forEach(k=>els[k].value="");
  els.qImg.value="";
  editQuestions=[]; els.qList.innerHTML="";
}
function loadSample(){
  editQuestions=[
    { type:"mcq", text:"가장 큰 행성은?", options:["지구","목성","화성","금성"], answer:1 },
    { type:"mcq", text:"태양에서 세 번째 행성?", options:["수성","화성","지구","금성"], answer:2 },
    { type:"short", text:"지구의 위성 이름은?", answerText:"달" }
  ];
  els.qList.innerHTML = "";
  editQuestions.forEach(q=>{
    const it = CE("div","item");
    it.textContent = (q.type==="mcq" ? "[객관식] " : "[주관식] ") + q.text;
    els.qList.prepend(it);
  });
}

// 옵션 저장
async function saveOptions(){
  const room = await ensureRoom(); if(!room) return;
  const policy = {
    once: els.onceName.checked ? "name" : "device",
    openResult: els.openResult.checked,
    timer: Math.max(0, parseInt(els.timerSec.value,10) || 0)
  };
  const bright = !!els.brightMode.checked;
  const accept = !!els.allowSubmit.checked;
  await FS.setDoc(roomRef(room), { policy, bright, accept }, { merge:true });
  buildStudentLink(room);
  alert("옵션 저장 완료 / QR 갱신");
}

// 초기화(문항/결과/진행 상태)
async function resetAll(){
  const room = await ensureRoom(); if(!room) return;
  if(!confirm("전체 초기화(문항, 진행상태, 결과)를 수행할까요?")) return;
  await FS.setDoc(roomRef(room), defaultRoom());
  // responses 삭제(간단: 필드만 초기화)
  alert("초기화 완료");
}

// 프레젠테이션 제어
async function startQuiz(){
  const room = await ensureRoom(); if(!room) return;
  await FS.setDoc(roomRef(room), { mode:"active", currentIndex: 0, accept:true }, { merge:true });
}
async function goPrev(){
  const room = await ensureRoom(); if(!room) return;
  const snap = await FS.getDoc(roomRef(room)); if(!snap.exists) return;
  const cur = snap.data().currentIndex ?? -1;
  await FS.updateDoc(roomRef(room), { currentIndex: Math.max(0, cur-1) });
}
async function goNext(){
  const room = await ensureRoom(); if(!room) return;
  const snap = await FS.getDoc(roomRef(room)); if(!snap.exists) return;
  const doc = snap.data();
  const max = (doc.questions?.length||0)-1;
  const cur = doc.currentIndex ?? -1;
  if(cur < max) await FS.updateDoc(roomRef(room), { currentIndex: cur+1 });
  else await endQuiz();
}
async function endQuiz(){
  const room = await ensureRoom(); if(!room) return;
  await FS.setDoc(roomRef(room), { mode:"ended", accept:false }, { merge:true });
}

// 결과 CSV
function exportCSV(){
  const rows = [["이름","점수"]];
  els.resBody.querySelectorAll("tr").forEach(tr=>{
    const name = tr.children[0].textContent.trim();
    const score = tr.children[tr.children.length - 1].textContent.trim();
    rows.push([name, score]);
  });
  const csv = rows.map(r=>r.map(v=>`"${(v||"").replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv],{type:"text/csv;charset=utf-8"});
  const a = CE("a"); a.href = URL.createObjectURL(blob); a.download="result.csv"; a.click();
}

// ====== 학생 플로우 ======
const STUD_KEY = "quiz_student_id";
function getStudentId(){
  let id = localStorage.getItem(STUD_KEY);
  if(!id){ id = crypto.randomUUID(); localStorage.setItem(STUD_KEY, id); }
  return id;
}
async function joinStudent(){
  const name = els.joinName.value.trim();
  if(!name){ alert("이름을 입력하세요"); return; }
  if(!ROOM){ alert("세션 코드가 없습니다."); return; }
  const sid = getStudentId();
  await FS.setDoc(respRef(ROOM, sid), {
    name, joinedAt: FS.serverTimestamp(), deviceId, answers:{}, score:0, submitted:false
  }, { merge:true });
  els.joinModal.classList.add("hide");
  els.sWrap.classList.remove("hide");
  els.sState.textContent = "참가 완료! 교사가 시작하면 1번 문항이 표시됩니다.";
}

// 학생 제출
async function submitStudent(answerPayload){
  const sid = getStudentId();
  const snap = await FS.getDoc(roomRef(ROOM)); if(!snap.exists) return;
  const doc = snap.data();
  const qIdx = doc.currentIndex;
  if(!(qIdx>=0)) return;
  const q = doc.questions[qIdx];
  const respSnap = await FS.getDoc(respRef(ROOM, sid));
  let data = respSnap.exists ? respSnap.data() : { name:"", answers:{}, score:0 };
  if(data.answers && data.answers[qIdx] !== undefined){
    alert("이미 제출했습니다."); return;
  }
  let correct = false;
  if(q.type==="mcq"){
    correct = (answerPayload === q.answer);
  }else{
    const a = String(answerPayload||"").trim();
    const t = String(q.answerText||"").trim();
    correct = a.length>0 && t.length>0 && (a === t);
  }
  data.answers[qIdx] = answerPayload;
  if(correct) data.score = (data.score||0)+1;

  await FS.setDoc(respRef(ROOM, sid), data, { merge:true });
  // 카운터(간단 증가: 정확한 병합보다 transaction이 안전하나 간략화)
  const c = doc.counters || { join:0, submit:0, correct:0, wrong:0 };
  c.submit++; if(correct) c.correct++; else c.wrong++;
  await FS.setDoc(roomRef(ROOM), { counters:c }, { merge:true });

  alert(correct ? "정답!" : "제출 완료");
}

// ====== 렌더링 ======
function renderRoom(r){
  // 공통
  els.pTitle.textContent = r.title || "퀴즈";
  els.sTitle.textContent = r.title || "퀴즈";
  els.chipJoin.textContent = String(r.counters?.join||0);
  els.chipSubmit.textContent = String(r.counters?.submit||0);
  els.chipCorrect.textContent = String(r.counters?.correct||0);
  els.chipWrong.textContent = String(r.counters?.wrong||0);
  const total = r.questions?.length || 0;
  const cur = r.currentIndex ?? -1;
  els.qCounter.textContent = `Q${Math.max(0,cur+1)}/${total}`;

  // 관리자 프레젠테이션
  if(MODE==='admin'){
    if(r.mode!=='active' || cur<0){
      els.presHint.classList.remove("hide");
      els.pWrap.classList.add("hide");
    }else{
      els.presHint.classList.add("hide");
      els.pWrap.classList.remove("hide");
      const q = r.questions[cur];
      els.pQText.textContent = q.text || "";
      els.pQImg.classList.add("hide"); els.pQImg.src="";
      if(q.image){ els.pQImg.src=q.image; els.pQImg.classList.remove("hide"); }
      els.pOpts.innerHTML="";
      if(q.type==="mcq"){
        q.options.forEach((opt,i)=>{
          const b = CE("div","popt"); b.textContent=`${i+1}. ${opt}`;
          els.pOpts.appendChild(b);
        });
      }else{
        const b = CE("div","popt"); b.textContent=`[주관식] 정답: ${q.answerText||""}`;
        els.pOpts.appendChild(b);
      }
    }
    // 결과 테이블(간단 업데이트)
    if(els.panelRes && !els.panelRes.classList.contains("hide")) refreshResults();
  }

  // 학생
  if(MODE==='student'){
    if(r.mode==='ended'){
      els.sWrap.classList.add("hide");
      els.sDone.classList.remove("hide");
      return;
    }
    if(r.mode!=='active' || cur<0){
      // 대기상태
      els.joinModal.classList.add("hide");
      els.sWrap.classList.remove("hide");
      els.sState.textContent = "참가 완료! 교사가 시작하면 1번 문항이 표시됩니다.";
      els.sQBox.classList.add("hide");
      return;
    }
    // 문제 표시
    const q = r.questions[cur];
    els.sState.classList.add("hide");
    els.sQBox.classList.remove("hide");
    els.sQTitle.textContent = `Q${cur+1}. ${q.text || ""}`;
    els.sQImg.classList.add("hide"); els.sQImg.src="";
    if(q.image){ els.sQImg.src=q.image; els.sQImg.classList.remove("hide"); }
    els.sOptBox.innerHTML="";
    if(q.type==="mcq"){
      // 보기 + 제출 버튼
      let chosen = null;
      q.options.forEach((opt,i)=>{
        const btn = CE("button","sopt"); btn.textContent = `${i+1}. ${opt}`;
        btn.onclick = ()=>{ chosen = i; [...els.sO
