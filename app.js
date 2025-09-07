/******************************
 * Firebase (v9 modular)
 ******************************/
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc,
  collection, getDocs, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* ▶ 프로젝트에 맞게 교체 */
const firebaseConfig = {
  apiKey: "AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo",
  authDomain: "live-quiz-a14d1.firebaseapp.com",
  projectId: "live-quiz-a14d1",
};
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

/******************************
 * Short helpers & State
 ******************************/
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));
const pad = (n)=>String(n).padStart(2,'0');

let MODE   = "admin";     // 'admin' | 'student'
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;
let mcqSelected = null;

/******************************
 * Elements (id 매핑)
 ******************************/
const els = {
  // 상단/세션
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnLogout: $("#btnLogout"),
  roomStatus: $("#roomStatus"), liveDot: $("#liveDot"),

  // 탭 버튼
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"),
  tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),

  // 패널
  panelBuild: $("#panelBuild"), panelOptions: $("#panelOptions"),
  panelPresent: $("#panelPresent"), panelResults: $("#panelResults"),

  // 문항 빌더
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
  btnBuildEmpty: $("#btnBuildEmpty"), btnBuildSample: $("#btnBuildSample"), btnSaveQuiz: $("#btnSaveQuiz"),
  btnUpload: $("#btnUpload"), fileUpload: $("#fileUpload"),
  btnSampleForm: $("#btnSampleForm"),
  builder: $("#builder"),

  // 옵션
  optDeviceOnce: $("#optDeviceOnce"), optNameOnce: $("#optNameOnce"),
  optAccept: $("#optAccept"), optReveal: $("#optReveal"),
  optBright: $("#optBright"),
  timerSec: $("#timerSec"), btnSaveOptions: $("#btnSaveOptions"),

  // 학생접속(옵션 패널 오른쪽 영역)
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"),
  btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

  // 프레젠테이션
  presentWait: $("#presentWait"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pOpts: $("#pOpts"), pImg: $("#pImg"),
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEnd: $("#btnEnd"),
  statJoin: $("#statJoin"), statSubmit: $("#statSubmit"), statCorrect: $("#statCorrect"), statWrong: $("#statWrong"),

  // 학생 화면(한 페이지 내 분기)
  studentTopInfo: $("#studentTopInfo"),
  studentJoinBox: $("#studentJoinBox"),
  studentName: $("#studentName"), btnJoin: $("#btnJoin"),
  studentQuiz: $("#studentQuiz"), studentResult: $("#studentResult"), studentResultBody: $("#studentResultBody"),
  badgeType: $("#badgeType"), sQText: $("#sQText"),
  sImg: $("#sImg"),
  mcqBox: $("#mcqBox"), btnSubmitMCQ: $("#btnSubmitMCQ"),
  shortBox: $("#shortBox"), shortInput: $("#shortInput"), btnShortSend: $("#btnShortSend"),

  // 결과
  resultsTable: $("#resultsTable"),
  btnExportCSV: $("#btnExportCSV"), btnResetAll: $("#btnResetAll"),

  // 가이드/레이블
  buildGuide: $("#buildGuide"),
};

/******************************
 * Local cache
 ******************************/
function saveLocal(){
  localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me }));
}
function loadLocal(){
  try{
    const d = JSON.parse(localStorage.getItem("quiz.live")||"{}");
    roomId = d.roomId || "";
    MODE   = d.MODE   || "admin";
    me     = d.me     || { id:null, name:"" };
    els.roomId && (els.roomId.value = roomId);
  }catch{}
}

/******************************
 * Firestore refs
 ******************************/
const roomRef = (id)=>doc(db,"rooms",id);
const respCol = (id)=>collection(db,"rooms",id,"responses");

async function ensureRoom(id){
  const snap = await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션",
      mode:"idle", currentIndex:-1,
      accept:false, reveal:false,
      deviceOnce:true, nameOnce:false,
      bright:false,
      createdAt: serverTimestamp(),
      questions:[]
    });
  }
}

/******************************
 * Mode + 탭/패널 토글
 ******************************/
function showPanel(which){
  els.panelBuild?.classList.toggle("hide", which!=="build");
  els.panelOptions?.classList.toggle("hide", which!=="options");
  els.panelPresent?.classList.toggle("hide", which!=="present");
  els.panelResults?.classList.toggle("hide", which!=="results");

  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
  const map={build:els.tabBuild, options:els.tabOptions, present:els.tabPresent, results:els.tabResults};
  map[which]?.classList.add("active");
}

function setMode(m){
  MODE = m;
  // 학생은 상단 탭 감춤 (학생화면은 문제/제출만)
  const hideTabs = (m === "student");
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.toggle("hide", hideTabs));

  // 첫 진입: 관리자면 문항 탭부터, 학생이면 참가 박스 보이기
  if (m === "admin") {
    showPanel("build");
  } else {
    els.studentJoinBox?.classList.remove("hide");
    els.studentQuiz?.classList.add("hide");
    els.studentResult?.classList.add("hide");
  }
  // 상단 메시지
  els.roomStatus && (els.roomStatus.textContent = roomId
    ? `세션: ${roomId} · 온라인`
    : (m==='admin' ? '세션 코드 입력 후 접속하세요.' : '세션 접속 후 참가하세요.'));
}

/******************************
 * Connect / Logout / listen
 ******************************/
async function connect(){
  const id = (els.roomId?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId = id;

  // 세션 잠금: 입력창 회색/disabled
  if (els.roomId) {
    els.roomId.disabled = true;
    els.roomId.classList.add("disabled");
  }
  els.btnConnect?.classList.add("hide");
  els.btnLogout?.classList.remove("hide");

  await ensureRoom(roomId);
  listenRoom(roomId);
  listenResponses(roomId);
  buildStudentLink(); // 현재 세션으로 링크/QR
  els.liveDot?.classList.add("on");
  els.roomStatus && (els.roomStatus.textContent = `세션: ${roomId} · 온라인`);
  saveLocal();
}
function logout(){
  if(unsubRoom) unsubRoom();
  if(unsubResp) unsubResp();
  roomId = "";
  if (els.roomId) {
    els.roomId.disabled = false;
    els.roomId.classList.remove("disabled");
    els.roomId.value = "";
  }
  els.liveDot?.classList.remove("on");
  els.btnConnect?.classList.remove("hide");
  els.btnLogout?.classList.add("hide");
  els.studentLink && (els.studentLink.value = "");
  if (els.qrCanvas) els.qrCanvas.getContext("2d").clearRect(0,0,els.qrCanvas.width,els.qrCanvas.height);
  els.roomStatus && (els.roomStatus.textContent = MODE==='admin' ? '세션 코드 입력 후 접속하세요.' : '세션 접속 후 참가하세요.');
  saveLocal();
}
function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom = onSnapshot(roomRef(id),(snap)=>{
    if(!snap.exists()) return;
    const r = snap.data();
    window.__room = r;
    renderRoom(r);
  });
}
function listenResponses(id){
  if(unsubResp) unsubResp();
  unsubResp = onSnapshot(respCol(id),(qs)=>{
    const arr=[];
    qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    renderResponses(arr);
  });
}

/******************************
 * Builder (문항 생성/저장)
 ******************************/
function buildCard(no, q={}){
  const wrap = document.createElement("div");
  wrap.className = "qcard";
  wrap.innerHTML = `
    <div class="row gap">
      <span class="badge">Q${no}</span>
      <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'}><span>객관식</span></label>
      <label class="switch"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''}><span>주관식</span></label>
      <label class="imgbtn"><input type="file" accept="image/*" class="imgInput" data-no="${no}"><span>이미지</span></label>
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항" value="${q?.text||''}">
    <img class="qimg ${q?.image?'':'hide'}" data-no="${no}" src="${q?.image||''}">
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap four">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기${i+1}" value="${v}">`).join('')}
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
  // type 토글
  const radios = $$(`input[name="type-${no}"]`, wrap);
  const mcq = $(".mcq", wrap), short = $(".short", wrap);
  radios.forEach(r=> r.addEventListener("change", ()=>{
    const isShort = radios.find(x=>x.checked)?.value==='short';
    mcq.classList.toggle("hide", isShort);
    short.classList.toggle("hide", !isShort);
  }));
  // 이미지 업로드 미리보기
  const imgInput = $(".imgInput", wrap);
  const imgTag   = $(".qimg", wrap);
  imgInput.addEventListener("change", (e)=>{
    const f = e.target.files?.[0]; if(!f) return;
    const reader = new FileReader();
    reader.onload = ()=>{ imgTag.src = reader.result; imgTag.classList.remove("hide"); };
    reader.readAsDataURL(f);
  });
  return wrap;
}
function collectBuilder(){
  const title = els.quizTitle?.value || "퀴즈";
  const cards = $$("#builder > .qcard");
  const questions = cards.map((card,idx)=>{
    const no = idx+1;
    const type = card.querySelector(`input[name="type-${no}"]:checked`).value;
    const text = card.querySelector(".qtext").value.trim();
    const image = card.querySelector(".qimg")?.src || "";
    if(!text) return null;
    if(type==='mcq'){
      const opts = $$(".opt", card).map(x=>x.value.trim()).filter(Boolean);
      const ans  = Math.max(0, Math.min(opts.length-1, (parseInt(card.querySelector(".ansIndex").value,10)||1)-1));
      return { type:'mcq', text, image, options:opts, answerIndex:ans };
    } else {
      const ansText = card.querySelector(".ansText").value.trim();
      return { type:'short', text, image, answerText:ansText };
    }
  }).filter(Boolean);
  return { title, questions };
}

/******************************
 * Options 저장 & 링크/QR
 ******************************/
async function saveOptions(){
  if(!roomId) return alert("세션을 먼저 연결하세요.");
  const patch = {
    deviceOnce: !!els.optDeviceOnce?.checked,
    nameOnce:   !!els.optNameOnce?.checked,
    accept:     !!els.optAccept?.checked,
    reveal:     !!els.optReveal?.checked,
    bright:     !!els.optBright?.checked,
    timerSec:   Math.max(0, parseInt(els.timerSec?.value,10)||0),
  };
  await setDoc(roomRef(roomId), patch, { merge:true });
  buildStudentLink(); // 저장과 동시에 QR/링크 갱신
  alert("옵션이 저장되었습니다.");
}
function buildStudentLink(){
  if(!roomId || !els.studentLink) return;
  const url = new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", roomId);
  els.studentLink.value = url.toString();

  // QR (옵션탭에서만 노출)
  const QR = window.QRCode;
  if (QR && els.qrCanvas) {
    try {
      QR.toCanvas(els.qrCanvas, els.studentLink.value, { width: 160 }, err => { if(err) console.warn(err); });
    } catch(e) { console.warn("QR draw failed", e); }
  }
}

/******************************
 * 진행/타이머
 ******************************/
async function startQuiz(){
  if(!roomId) return alert("세션 먼저 연결");
  await updateDoc(roomRef(roomId), { mode:'active', currentIndex:0, accept:true });
}
async function step(delta){
  await runTransaction(db, async (tx)=>{
    const ref = roomRef(roomId);
    const snap= await tx.get(ref);
    const r   = snap.data();
    const total = (r.questions?.length||0);
    if(total<=0) return;
    let next = (r.currentIndex ?? -1) + delta;
    if(next>=total){ // 자동 종료 → 결과 탭에서 보도록
      tx.update(ref, { currentIndex: total-1, mode:'ended', accept:false });
      showPanel("results");
      return;
    }
    next = Math.max(0, next);
    tx.update(ref, { currentIndex: next, accept:true });
  });
}
async function finishAll(){
  if(!roomId) return;
  await updateDoc(roomRef(roomId), { mode:"ended", accept:false });
  showPanel("results");
}

/******************************
 * 참가/제출
 ******************************/
async function join(){
  if(!roomId) return alert("세션 먼저 접속");
  const name =(els.studentName?.value||"").trim();
  if(!name) return alert("이름 혹은 번호를 입력하세요!");
  // device id 고정(기기당 1회 정책)
  me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem("quiz.device", me.id);

  await setDoc(doc(respCol(roomId), me.id), {
    name, joinedAt:serverTimestamp(), answers:{}, alive:true
  }, { merge:true });

  // 참가 후 대기화면 유지
  els.studentJoinBox?.classList.add("hide");
  els.studentQuiz?.classList.remove("hide");
  els.studentResult?.classList.add("hide");
  alert("참가 완료! 시작을 기다려 주세요.");
  saveLocal();
}
async function submit(value){
  const r=window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
  const ref=doc(respCol(roomId), me.id);

  // 이전 제출 확인
  const snap= await getDoc(ref);
  const prev= snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert("이미 제출했습니다.");

  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){
    correct = (value === (q.answerIndex ?? -999));
  } else if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase();
    if(q.answerText) correct = (norm(value)===norm(q.answerText));
  }
  await setDoc(ref, {
    name: me.name,
    [`answers.${idx}`]: { value, correct:(correct===true), revealed:r.reveal||false }
  }, { merge:true });

  alert("제출 완료!");
}

/******************************
 * Render (교체 완료 버전)
 ******************************/
function renderRoom(r){
  const total = r.questions?.length || 0;
  const idx   = r.currentIndex ?? -1;

  // 프레젠테이션 대기문구
  const shouldShowWait = (r.mode !== 'active') || (idx < 0);
  els.presentWait?.classList.toggle('hide', !shouldShowWait);

  // 타이틀
  els.pTitle && (els.pTitle.textContent = r.title || roomId);

  // 문제/보기/이미지
  if (!shouldShowWait && r.questions?.[idx]) {
    const q = r.questions[idx];
    els.pQ.textContent = q.text;
    if (q.image) { els.pImg.src = q.image; els.pImg.classList.remove('hide'); }
    else { els.pImg.classList.add('hide'); }
    els.pOpts.innerHTML = '';
    if (q.type === 'mcq') {
      q.options.forEach((t, i) => {
        const d = document.createElement('div');
        d.className = 'popt';
        d.textContent = `${i + 1}. ${t}`;
        els.pOpts.appendChild(d);
      });
    } else {
      els.pOpts.innerHTML = '<div class="muted">주관식 문제입니다.</div>';
    }
  } else {
    els.pQ.textContent   = '-';
    els.pOpts.innerHTML  = '';
    els.pImg?.classList.add('hide');
  }

  // 학생 화면
  if (MODE === 'student') {
    els.studentTopInfo && (els.studentTopInfo.textContent =
      roomId ? `세션: ${roomId} · 온라인` : '세션: - · 오프라인');

    if (shouldShowWait) {
      els.badgeType && (els.badgeType.textContent = '대기');
      els.sQText && (els.sQText.textContent = '대기 중입니다…');
      els.mcqBox && (els.mcqBox.innerHTML = '');
      els.shortBox?.classList.add('hide');
      els.btnSubmitMCQ?.classList.add('hide');
      els.sImg?.classList.add('hide');
      return;
    }

    const q = r.questions[idx];
    els.badgeType && (els.badgeType.textContent = q.type === 'mcq' ? '객관식' : '주관식');
    els.sQText && (els.sQText.textContent = q.text);
    if (q.image) { els.sImg.src = q.image; els.sImg.classList.remove('hide'); }
    else { els.sImg.classList.add('hide'); }

    if (q.type === 'mcq') {
      els.mcqBox.innerHTML = ''; mcqSelected = null;
      q.options.forEach((opt, i) => {
        const b = document.createElement('button');
        b.className = 'optbtn';
        b.textContent = `${i + 1}. ${opt}`;
        b.disabled = !r.accept;
        b.addEventListener('click', () => {
          mcqSelected = i;
          $$('.optbtn', els.mcqBox).forEach(x => x.classList.remove('active'));
          b.classList.add('active');
        });
        els.mcqBox.appendChild(b);
      });
      els.btnSubmitMCQ.classList.remove('hide');
      els.btnSubmitMCQ.disabled = !r.accept;
      els.shortBox.classList.add('hide');
    } else {
      els.mcqBox.innerHTML = '';
      els.btnSubmitMCQ.classList.add('hide');
      els.shortBox.classList.remove('hide');
      els.btnShortSend.disabled = !r.accept;
    }
  }
}

function renderResponses(list){
  const r   = window.__room || {};
  const idx = r.currentIndex ?? -1;

  // 프레젠테이션 통계표시 (점 구분: 파랑/노랑/초록/빨강 표시를 위한 카운트)
  const join = list.length;
  let submitted = 0, correct = 0, wrong = 0;
  list.forEach(s => {
    const a = s.answers?.[idx];
    if (a != null) {
      submitted++;
      a.correct ? correct++ : wrong++;
    }
  });
  els.statJoin   && (els.statJoin.textContent   = `참가 ${join}`);
  els.statSubmit && (els.statSubmit.textContent = `제출 ${submitted}`);
  els.statCorrect&& (els.statCorrect.textContent= `정답 ${correct}`);
  els.statWrong  && (els.statWrong.textContent  = `오답 ${wrong}`);

  // 관리자 결과표(점수순 정렬)
  if (els.resultsTable) {
    const tbl = document.createElement('table');
    const thead=document.createElement('thead'), tr=document.createElement('tr');
    ['이름', ...(r.questions||[]).map((_,i)=>`Q${i+1}`), '점수'].forEach(h=>{
      const th=document.createElement('th'); th.textContent=h; tr.appendChild(th);
    });
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb=document.createElement('tbody');

    const scored = list.map(s=>{
      let score=0; (r.questions||[]).forEach((q,i)=>{ if(s.answers?.[i]?.correct) score++; });
      return { s, score };
    }).sort((a,b)=> b.score - a.score || (a.s.name||'').localeCompare(b.s.name||''));

    scored.forEach(({s,score})=>{
      const tr=document.createElement('tr');
      const tdn=document.createElement('td'); tdn.textContent=s.name||s.id; tr.appendChild(tdn);
      (r.questions||[]).forEach((q,i)=>{
        const a=s.answers?.[i]; const td=document.createElement('td');
        td.textContent = a==null ? '-' : (q.type==='mcq'
          ? (typeof a.value==='number' ? a.value+1 : '-')
          : (a.value ?? '-'));
        tr.appendChild(td);
      });
      const tds=document.createElement('td'); tds.textContent=String(score); tr.appendChild(tds);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.resultsTable.innerHTML=''; els.resultsTable.appendChild(tbl);
  }

  // 학생 결과: 세션 종료 + 내 응답이 1개 이상일 때만 결과표 노출
  if (MODE === 'student' && r.mode === 'ended' && me.id) {
    const mine = list.find(x => x.id === me.id);
    const hasAnyAnswer = !!mine && Object.values(mine.answers || {}).length > 0;
    if (!hasAnyAnswer) { els.studentResult?.classList.add('hide'); return; }

    const rows = (r.questions||[]).map((q,i)=>{
      const a = mine.answers?.[i];
      const sub  = a==null ? '-' : (q.type==='mcq'
        ? (typeof a.value==='number' ? a.value+1 : '-')
        : (a.value ?? '-'));
      const mark = a?.correct ? 'O' : 'X';
      return `<tr><td>${i+1}</td><td>${sub}</td><td>${mark}</td></tr>`;
    }).join('');
    els.studentResultBody.innerHTML =
      `<div class="table-wrap"><table><thead><tr><th>문항</th><th>제출</th><th>정답</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    els.studentQuiz?.classList.add('hide');
    els.studentResult?.classList.remove('hide');
  } else if (MODE === 'student' && r.mode !== 'ended') {
    els.studentResult?.classList.add('hide');
  }
}

/******************************
 * Export / 초기화
 ******************************/
els.btnExportCSV?.addEventListener("click", async ()=>{
  if(!roomId) return;
  const r=(await getDoc(roomRef(roomId))).data();
  const snap=await getDocs(respCol(roomId));
  const rows=[]; rows.push(["userId","name",...(r.questions||[]).map((_,i)=>`Q${i+1}`),"score"].join(","));
  snap.forEach(d=>{
    const s=d.data(); let score=0;
    const answers=(r.questions||[]).map((q,i)=>{ const a=s.answers?.[i]; if(a?.correct) score++; return q.type==='mcq' ? (typeof a?.value==='number'? a.value+1 : "") : (a?.value??""); });
    rows.push([d.id, `"${(s.name||"").replace(/"/g,'""')}"`, ...answers, score].join(","));
  });
  const blob=new Blob([rows.join("\n")],{type:"text/csv"}); const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=`${r.title||roomId}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
});
els.btnResetAll?.addEventListener("click", async ()=>{
  if(!roomId) return;
  if(!confirm("모든 응답/점수를 초기화할까요?")) return;
  await setDoc(roomRef(roomId), { mode:"idle", currentIndex:-1, accept:false, reveal:false }, { merge:true });
  const snap=await getDocs(respCol(roomId)); const tasks=[];
  snap.forEach(d=> tasks.push(setDoc(doc(respCol(roomId), d.id), { answers:{}, alive:true }, { merge:true })));
  await Promise.all(tasks); alert("초기화 완료");
});

/******************************
 * Events
 ******************************/
// 세션
els.btnConnect?.addEventListener("click", connect);
els.btnLogout?.addEventListener("click", logout);

// 탭
els.tabBuild?.addEventListener("click", ()=> showPanel("build"));
els.tabOptions?.addEventListener("click", ()=> showPanel("options"));
els.tabPresent?.addEventListener("click", ()=> showPanel("present"));
els.tabResults?.addEventListener("click", ()=> showPanel("results"));

// 빌더
els.btnBuildEmpty?.addEventListener("click", ()=>{
  const n = Math.max(1, Math.min(20, parseInt(els.questionCount?.value,10)||3));
  els.builder.innerHTML=""; for(let i=0;i<n;i++) els.builder.appendChild(buildCard(i+1));
});
els.btnBuildSample?.addEventListener("click", ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
    {type:'mcq', text:'다음 중 포유류는?', options:['상어','고래','문어','가재'], answerIndex:1}
  ];
  els.quizTitle.value = "샘플 퀴즈";
  els.questionCount.value = S.length;
  els.builder.innerHTML=""; S.forEach((q,i)=>els.builder.appendChild(buildCard(i+1,q)));
});
els.btnSaveQuiz?.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션 먼저 연결");
  const payload=collectBuilder();
  if(payload.questions.length===0) return alert("문항을 추가하세요.");
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("문항 저장 완료");
});
// 수동 업로드(TXT/CSV 간단 파서)
els.btnUpload?.addEventListener("click", ()=> els.fileUpload?.click());
els.fileUpload?.addEventListener("change", async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const txt = await f.text();
  const lines = txt.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const qs=[];
  lines.forEach(line=>{
    // 객관식: 문제,보기1,보기2,보기3,보기4,정답번호
    // 주관식: 문제,주관식,정답텍스트
    const parts = line.split(",").map(s=>s.trim());
    if(parts.length>=6){
      qs.push({ type:'mcq', text:parts[0], options:parts.slice(1,5), answerIndex: Math.max(0,Math.min(3, (parseInt(parts[5],10)||1)-1)) });
    }else if(parts.length===3 && parts[1]==='주관식'){
      qs.push({ type:'short', text:parts[0], answerText:parts[2] });
    }
  });
  els.quizTitle.value = els.quizTitle.value || "업로드 퀴즈";
  els.questionCount.value = qs.length;
  els.builder.innerHTML=""; qs.forEach((q,i)=>els.builder.appendChild(buildCard(i+1,q)));
  alert(`업로드 완료: ${qs.length}문항`);
});
els.btnSampleForm?.addEventListener("click", ()=>{
  const sample=`가장 큰 행성은?,지구,목성,화성,금성,2
물의 끓는점은 몇 °C?,주관식,100`;
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([sample],{type:"text/plain"}));
  a.download="quiz-sample.txt"; a.click(); URL.revokeObjectURL(a.href);
});

// 옵션 저장/복사/열기
els.btnSaveOptions?.addEventListener("click", saveOptions);
els.btnCopyLink?.addEventListener("click", async ()=>{
  if(!els.studentLink?.value) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="복사", 1200);
});
els.btnOpenStudent?.addEventListener("click", ()=> window.open(els.studentLink?.value||"#","_blank"));

// 프레젠테이션 진행
els.btnStart?.addEventListener("click", startQuiz);
els.btnPrev?.addEventListener("click", ()=> step(-1));
els.btnNext?.addEventListener("click", ()=> step(+1));
els.btnEnd?.addEventListener("click", finishAll);

// 학생: 참가/제출
els.btnJoin?.addEventListener("click", join);
els.btnSubmitMCQ?.addEventListener("click", ()=>{
  if(mcqSelected==null) return alert("보기를 선택하세요.");
  submit(mcqSelected);
});
els.btnShortSend?.addEventListener("click", ()=>{
  const v=(els.shortInput?.value||"").trim(); if(!v) return alert("답을 입력하세요.");
  submit(v);
});

/******************************
 * Boot
 ******************************/
function autoReconnect(){
  loadLocal();
  setMode(MODE);
  if(roomId) connect();
}
autoReconnect();

// URL로 바로 학생 모드 열기: ?role=student&room=class1
(function fromURL(){
  const url=new URL(location.href);
  const role=url.searchParams.get("role");
  const rid =url.searchParams.get("room");
  if(role==='student'){ MODE='student'; setMode('student'); }
  if(rid){ els.roomId && (els.roomId.value=rid); connect(); }
})();
