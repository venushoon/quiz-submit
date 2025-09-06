/* =========================
   Firebase (필수: config 교체)
   ========================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc,
  collection, getDocs, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// 🔧 본인의 Firebase 설정으로 교체
const firebaseConfig = {
  apiKey: "AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo",
  authDomain: "live-quiz-a14d1.firebaseapp.com",
  projectId: "live-quiz-a14d1",
};
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

/* =========================
   헬퍼
   ========================= */
const $ = (sel, el=document)=>el.querySelector(sel);
const $$ = (sel, el=document)=>Array.from(el.querySelectorAll(sel));
const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));
const pad = (n)=>String(n).padStart(2,'0');

/* =========================
   상태
   ========================= */
let MODE = "admin"; // 'admin' | 'student'
let roomId = "";
let me    = { id:null, name:"" };
let unsubRoom = null, unsubResp = null;
let leftTimer = null;

const els = {
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), roomStatus: $("#roomStatus"),
  btnAdmin: $("#btnAdmin"), btnStudent: $("#btnStudent"),
  tabBuild: $("#tabBuild"), tabControl: $("#tabControl"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"), pControl: $("#panelControl"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"), btnBuildForm: $("#btnBuildForm"),
  btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"), builder: $("#builder"),
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), chkAccept: $("#chkAccept"),
  chkReveal: $("#chkReveal"), timerSec: $("#timerSec"), btnTimerGo: $("#btnTimerGo"), btnTimerStop: $("#btnTimerStop"),
  leftSec: $("#leftSec"), btnEndAll: $("#btnEndAll"),
  nowQuestion: $("#nowQuestion"), progress: $("#progress"),
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),
  chips: $("#chips"), shortAnswers: $("#shortAnswers"),
  btnExportCSV: $("#btnExportCSV"), resultsTable: $("#resultsTable"), btnResetAll: $("#btnResetAll"),
  btnSaveJSON: $("#btnSaveJSON"), fileLoad: $("#fileLoad"),
  studentPanel: $("#studentPanel"), studentName: $("#studentName"), btnJoin: $("#btnJoin"),
  badgeType: $("#badgeType"), sQText: $("#sQText"), mcqBox: $("#mcqBox"),
  shortBox: $("#shortBox"), shortInput: $("#shortInput"), btnShortSend: $("#btnShortSend"),
  guideAdmin: $("#guideAdmin"), guideStudent: $("#guideStudent"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pOpts: $("#pOpts"),
};

function setMode(m){
  MODE = m;
  // 가이드/패널 표시 제어
  els.guideAdmin.classList.toggle("hide", m!=="admin");
  els.guideStudent.classList.toggle("hide", m!=="student");

  els.pBuild.classList.toggle("hide", m!=="admin");
  els.pControl.classList.toggle("hide", m!=="admin");
  els.pResults.classList.toggle("hide", m!=="admin");
  els.pPresent.classList.toggle("hide", false);     // 발표는 관리용 탭에서 사용
  els.studentPanel.classList.toggle("hide", m!=="student");

  // 상단 상태 문구 업데이트
  els.roomStatus.textContent = (roomId ? `세션: ${roomId} · 온라인` : (m==='admin'?'관리자 모드: 세션에 접속해 주세요.':'학생 모드: 세션 접속 후 참가하세요.'));

  // 탭 초기 강조 (진행 탭 기본)
  [els.tabBuild,els.tabControl,els.tabPresent,els.tabResults].forEach(b=>b.classList.remove("active"));
  (m==='admin'?els.tabControl:els.tabPresent).classList.add("active");
}

function saveLocal(){
  localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me }));
}
function loadLocal(){
  try{
    const d = JSON.parse(localStorage.getItem("quiz.live")||"{}");
    roomId = d.roomId||""; MODE = d.MODE||"admin"; me = d.me||{id:null,name:""};
    if(roomId) els.roomId.value = roomId;
  }catch{}
}

/* =========================
   Firestore helpers
   ========================= */
const roomRef = (id)=>doc(db, "rooms", id);
const respCol = (id)=>collection(db, "rooms", id, "responses");

async function ensureRoom(id){
  const snap = await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), {
      title: "새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false,
      timerEnd:null, createdAt: serverTimestamp(), questions:[]
    }, { merge:true });
  }
}

function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom = onSnapshot(roomRef(id), (snap)=>{
    if(!snap.exists()) return;
    const r = snap.data();
    window.__room = r;          // 프레젠테이션/학생/관리 공용 렌더에 사용
    renderRoom(r);
  });
}
function listenResponses(id){
  if(unsubResp) unsubResp();
  unsubResp = onSnapshot(respCol(id), (qs)=>{
    const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    renderResponses(arr);
  });
}

/* =========================
   연결/재연결
   ========================= */
async function connect(){
  const id = (els.roomId.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId = id;
  await ensureRoom(roomId);
  listenRoom(roomId);
  listenResponses(roomId);
  buildStudentLink();
  els.roomStatus.textContent = `세션: ${roomId} · 온라인`;
  saveLocal();
}

function autoReconnect(){
  loadLocal();
  setMode(MODE);
  if(roomId){
    connect();     // 자동 재접속
  }
}

/* =========================
   UI: 빌더
   ========================= */
function cardRow(no, q){
  const wrap = document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="switch">
        <input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'} />
        <span>객관식</span>
      </label>
      <label class="switch">
        <input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''} />
        <span>주관식</span>
      </label>
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항 내용" value="${q?.text||''}">
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`
          <input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기 ${i+1}" value="${v}">
        `).join('')}
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
  const divMcq = $(".mcq", wrap), divShort=$(".short", wrap);
  radios.forEach(r=>r.addEventListener("change",()=>{
    const isShort = radios.find(x=>x.checked)?.value==='short';
    divMcq.classList.toggle("hide", isShort);
    divShort.classList.toggle("hide", !isShort);
  }));
  return wrap;
}

function collectBuilder(){
  const cards = $$("#builder>.qcard");
  const list = cards.map((c,idx)=>{
    const no = idx+1;
    const type = c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text = c.querySelector(".qtext").value.trim();
    if(!text) return null;
    if(type==='mcq'){
      const opts = $$(".opt", c).map(i=>i.value.trim()).filter(Boolean);
      const ans  = Math.max(0, Math.min(opts.length-1, (parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex: ans };
    }else{
      return { type:'short', text, answerText: c.querySelector(".ansText").value.trim() };
    }
  }).filter(Boolean);
  return { title: els.quizTitle.value||"퀴즈", questions: list };
}

/* =========================
   진행 흐름 + 종료
   ========================= */
async function startQuiz(){ await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true }); }
async function step(delta){
  await runTransaction(db, async (tx)=>{
    const snap = await tx.get(roomRef(roomId));
    const r = snap.data(); const total=(r.questions?.length||0);
    let next = (r.currentIndex??-1)+delta;
    if(next>=total){ // 끝났다면 종료 처리
      tx.update(roomRef(roomId), { currentIndex: total-1, mode:"ended", accept:false });
      alert("모든 문항을 마쳤습니다. 결과 탭에서 저장/채점하세요.");
      return;
    }
    next = Math.max(0, next);
    tx.update(roomRef(roomId), { currentIndex: next, accept:true });
  });
}
async function finishAll(){
  if(!confirm("퀴즈를 종료할까요?")) return;
  await updateDoc(roomRef(roomId), { mode:"ended", accept:false });
}

/* =========================
   제출/채점/골든벨
   ========================= */
async function join(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name = (els.studentName.value||"").trim();
  if(!name) return alert("이름을 입력하세요.");
  me = { id: localStorage.getItem("quiz.device") || makeKey(), name };
  localStorage.setItem("quiz.device", me.id);
  await setDoc(doc(respCol(roomId), me.id), {
    name, joinedAt: serverTimestamp(), answers:{}, alive:true
  }, { merge:true });
  alert("참가 완료!");
  saveLocal();
}

async function submit(value){
  const r = window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx = r.currentIndex; const q = r.questions?.[idx]; if(!q) return;

  // 정책: 기본은 "기기당 1회", 실명당 1회는 name을 키로 별도 구현 가능(필요시)
  const ref = doc(respCol(roomId), me.id);
  const snap = await getDoc(ref);
  const prev = snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert("이미 제출했습니다.");

  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct = (value === (q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase();
    if(q.answerText) correct = (norm(value)===norm(q.answerText));
  }

  await setDoc(ref, {
    name: me.name,
    [`answers.${idx}`]: { value, correct: (correct===true), revealed: r.reveal || false }
  }, { merge:true });
}

async function grade(userId, qIndex, isOk){
  await setDoc(doc(respCol(roomId), userId), {
    [`answers.${qIndex}.correct`]: !!isOk,
    [`answers.${qIndex}.revealed`]: true
  }, { merge:true });
}

/* =========================
   타이머
   ========================= */
function startTimer(sec){
  stopTimer();
  const end = Date.now()+sec*1000;
  leftTimer = setInterval(()=>{
    const remain = Math.max(0, Math.floor((end-Date.now())/1000));
    els.leftSec.textContent = `${pad(Math.floor(remain/60))}:${pad(remain%60)}`;
    if(remain<=0){ stopTimer(); updateDoc(roomRef(roomId), { accept:false }); }
  }, 250);
}
function stopTimer(){
  if(leftTimer){ clearInterval(leftTimer); leftTimer=null; }
  els.leftSec.textContent="00:00";
}

/* =========================
   렌더링 (관리자/학생/발표 공용)
   ========================= */
function renderRoom(r){
  // 진행/상태
  const total = r.questions?.length||0;
  const idx = r.currentIndex;
  els.progress.textContent = `${Math.max(0, idx+1)}/${total}`;
  els.chkAccept.checked = !!r.accept;
  els.chkReveal.checked = !!r.reveal;
  els.nowQuestion.textContent = (idx>=0 && r.questions[idx])? r.questions[idx].text : "-";

  // 프레젠테이션
  els.pTitle.textContent = (r.title||roomId);
  $("#pOpts").innerHTML="";
  if(idx>=0 && r.questions[idx]){
    const q = r.questions[idx];
    els.pQ.textContent = q.text;
    if(q.type==='mcq'){
      q.options.forEach((t,i)=>{
        const b=document.createElement("div");
        b.className="popt"; b.textContent=`${i+1}. ${t}`;
        els.pOpts.appendChild(b);
      });
    }
  } else {
    els.pQ.textContent = "대기 중…";
  }

  // 학생 화면
  if(MODE==='student'){
    if(r.mode!=='active' || idx<0){ // 대기
      els.badgeType.textContent="대기";
      els.sQText.textContent="대기 중입니다…";
      els.mcqBox.innerHTML=""; els.shortBox.classList.add("hide");
      return;
    }
    const q = r.questions[idx];
    els.badgeType.textContent = (q.type==='mcq'?'객관식':'주관식');
    els.sQText.textContent = q.text;

    if(q.type==='mcq'){
      els.mcqBox.innerHTML="";
      els.shortBox.classList.add("hide");
      q.options.forEach((opt,i)=>{
        const btn=document.createElement("button");
        btn.className="optbtn"; btn.textContent=`${i+1}. ${opt}`;
        btn.disabled = !r.accept;
        btn.addEventListener("click", ()=>submit(i));
        els.mcqBox.appendChild(btn);
      });
    } else {
      els.mcqBox.innerHTML="";
      els.shortBox.classList.remove("hide");
      els.btnShortSend.disabled = !r.accept;
    }
  }
}

function renderResponses(list){
  if(MODE!=='admin') return;
  const r = window.__room||{}; const idx=r.currentIndex; const q=r.questions?.[idx];

  // 칩(제출 현황)
  els.chips.innerHTML="";
  list.forEach(s=>{
    const a = s.answers?.[idx];
    const chip=document.createElement("div");
    chip.className="chip " + (a? (a.correct?'ok':'no') : 'wait');
    chip.textContent = s.name||s.id;
    els.chips.appendChild(chip);
  });

  // 주관식 채점 목록
  els.shortAnswers.innerHTML="";
  if(q && q.type==='short'){
    list.forEach(s=>{
      const a=s.answers?.[idx]; if(!a || typeof a.value!=='string') return;
      const row=document.createElement("div"); row.className="row between";
      row.innerHTML=`<span>${s.name}: ${a.value}</span>`;
      const box=document.createElement("div");
      const ok=document.createElement("button"); ok.className="btn ghost"; ok.textContent="정답";
      const no=document.createElement("button"); no.className="btn ghost"; no.textContent="오답";
      ok.onclick=()=>grade(s.id, idx, true);
      no.onclick=()=>grade(s.id, idx, false);
      box.append(ok,no); row.append(box);
      els.shortAnswers.appendChild(row);
    });
  }

  // 결과 테이블
  const tbl=document.createElement("table");
  const thead=document.createElement("thead");
  const tr=document.createElement("tr");
  ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수","상태"].forEach(h=>{
    const th=document.createElement("th"); th.textContent=h; tr.appendChild(th);
  });
  thead.appendChild(tr); tbl.appendChild(thead);
  const tb=document.createElement("tbody");
  list.forEach(s=>{
    let score=0;
    const tr=document.createElement("tr");
    const tdN=document.createElement("td"); tdN.textContent=s.name||s.id; tr.appendChild(tdN);
    (r.questions||[]).forEach((q,i)=>{
      const a=s.answers?.[i];
      const td=document.createElement("td");
      td.textContent = a? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value??'-')) : '-';
      if(a?.correct) score++;
      tr.appendChild(td);
    });
    const tdS=document.createElement("td"); tdS.textContent=String(score); tr.appendChild(tdS);
    const tdL=document.createElement("td"); tdL.textContent= s.alive===false? "out":"alive"; tr.appendChild(tdL);
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
}

/* =========================
   링크/QR
   ========================= */
function buildStudentLink(){
  const url = new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", roomId);
  els.studentLink.value = url.toString();
  // QR 그리기
  if(window.QRCode){
    window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:192 }, (err)=>{ if(err) console.warn(err); });
  }
}

/* =========================
   유틸
   ========================= */
function makeKey(){ return Math.random().toString(36).slice(2,10); }

/* =========================
   이벤트
   ========================= */
els.btnAdmin.onclick = ()=>{ setMode("admin"); saveLocal(); };
els.btnStudent.onclick = ()=>{ setMode("student"); saveLocal(); };

els.btnConnect.onclick = connect;

[els.tabBuild, els.tabControl, els.tabPresent, els.tabResults].forEach(btn=>{
  btn.addEventListener("click", ()=>{
    [els.tabBuild,els.tabControl,els.tabPresent,els.tabResults].forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    els.pBuild.classList.toggle("hide", btn!==els.tabBuild || MODE!=='admin');
    els.pControl.classList.toggle("hide", btn!==els.tabControl || MODE!=='admin');
    els.pPresent.classList.toggle("hide", btn!==els.tabPresent ? true:false);
    els.pResults.classList.toggle("hide", btn!==els.tabResults || MODE!=='admin');
  });
});

els.btnBuildForm.onclick = ()=>{
  const n = Math.max(1, Math.min(20, parseInt(els.questionCount.value,10)||3));
  els.builder.innerHTML="";
  for(let i=0;i<n;i++) els.builder.appendChild(cardRow(i+1));
};
els.btnLoadSample.onclick = ()=>{
  const S = [
    {type:'mcq', text:'가장 큰 행성?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
    {type:'mcq', text:'태양계 별명?', options:['Milky','Solar','Sunset','Lunar'], answerIndex:1},
  ];
  els.builder.innerHTML=""; S.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q)));
  els.quizTitle.value = "샘플 퀴즈";
  els.questionCount.value = S.length;
};
els.btnSaveQuiz.onclick = async ()=>{
  const payload = collectBuilder();
  if(payload.questions.length===0) return alert("문항을 추가하세요.");
  await setDoc(roomRef(roomId), { title: payload.title, questions: payload.questions }, { merge:true });
  alert("저장 완료!");
};

els.btnStart.onclick = startQuiz;
els.btnPrev.onclick  = ()=>step(-1);
els.btnNext.onclick  = ()=>step(+1);
els.btnEndAll.onclick= finishAll;

els.chkAccept.onchange = ()=> updateDoc(roomRef(roomId), { accept: !!els.chkAccept.checked });
els.chkReveal.onchange = ()=> updateDoc(roomRef(roomId), { reveal: !!els.chkReveal.checked });

els.btnTimerGo.onclick   = ()=> startTimer(Math.max(5, Math.min(600, parseInt(els.timerSec.value,10)||30)));
els.btnTimerStop.onclick = stopTimer;

els.btnCopyLink.onclick = async ()=>{
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=>els.btnCopyLink.textContent="링크 복사", 1200);
};
els.btnOpenStudent.onclick = ()=>window.open(els.studentLink.value, "_blank");

els.btnExportCSV.onclick = async ()=>{
  const r = (await getDoc(roomRef(roomId))).data();
  const snap = await getDocs(respCol(roomId));
  const rows = [];
  rows.push(["userId","name",...(r.questions||[]).map((_,i)=>`Q${i+1}`),"score"].join(","));
  snap.forEach(d=>{
    const s=d.data(); let score=0;
    const answers=(r.questions||[]).map((q,i)=>{
      const a=s.answers?.[i]; if(a?.correct) score++;
      return q.type==='mcq' ? (typeof a?.value==='number'? a.value+1 : "") : (a?.value??"");
    });
    rows.push([d.id, `"${(s.name||"").replace(/"/g,'""')}"`, ...answers, score].join(","));
  });
  const blob = new Blob([rows.join("\n")], {type:"text/csv"}); const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=`${r.title||roomId}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
};
els.btnResetAll.onclick = async ()=>{
  if(!confirm("모든 응답/점수를 초기화할까요?")) return;
  await setDoc(roomRef(roomId), { mode:"idle", currentIndex:-1, accept:false, reveal:false }, { merge:true });
  const snap = await getDocs(respCol(roomId));
  const batch = [];
  snap.forEach(d=> batch.push(setDoc(doc(respCol(roomId), d.id), { answers:{}, alive:true }, { merge:true })));
  await Promise.all(batch);
  alert("초기화 완료");
};
els.btnSaveJSON.onclick = async ()=>{
  const r = (await getDoc(roomRef(roomId))).data();
  const res = await getDocs(respCol(roomId));
  const obj = { roomId, room:r, responses: res.docs.map(d=>({ id:d.id, ...d.data() })) };
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:"application/json"}));
  a.download=`${roomId}-backup.json`; a.click(); URL.revokeObjectURL(a.href);
};
els.fileLoad.onchange = async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const text=await f.text(); const data=JSON.parse(text);
  if(data.room) await setDoc(roomRef(roomId), data.room, { merge:true });
  if(Array.isArray(data.responses)){
    await Promise.all(data.responses.map(x=> setDoc(doc(respCol(roomId), x.id), x, { merge:true })));
  }
  alert("불러오기 완료");
  e.target.value="";
};

els.btnJoin.onclick = join;
els.btnShortSend.onclick = ()=> submit((els.shortInput.value||"").trim());

/* =========================
   시작
   ========================= */
autoReconnect();

// URL 파라미터로 학생모드 바로 열기 (예: ?role=student&room=class1)
(function bootstrapFromURL(){
  const url=new URL(location.href); const role=url.searchParams.get("role"); const rid=url.searchParams.get("room");
  if(role==='student'){ setMode("student"); }
  if(rid){ els.roomId.value=rid; connect(); }
})();
