// app.js  (ES 모듈)
// 1) Firebase는 index.html에서 1회만 초기화되어 window.db 제공
// 2) 여기서는 Firestore 함수만 import해서 window.db를 사용

import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, collection, getDocs,
  runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* ---------- 유틸 & 상태 ---------- */
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));
const pad = n=>String(n).padStart(2,'0');

let MODE   = "admin";         // 'admin' | 'student'
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;

const els = {
  // 상단/탭
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnSignOut: $("#btnSignOut"),
  roomStatus: $("#roomStatus"),
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"), pOptions: $("#panelOptions"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),

  // 빌더
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"),
  btnUploadTxt: $("#btnUploadTxt"), btnDownloadTemplate: $("#btnDownloadTemplate"), fileUploadTxt: $("#fileUploadTxt"),
  builder: $("#builder"),

  // 옵션
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright: $("#chkBright"),
  timerSec: $("#timerSec"), btnSaveOptions: $("#btnSaveOptions"),
  btnResetAll: $("#btnResetAll"), btnResetAllTop: $("#btnResetAllTop"),
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

  // 프레젠테이션
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  pTitle: $("#pTitle"), pNotice: $("#pNotice"), pQ: $("#pQ"), pImg: $("#pImg"), pOpts: $("#pOpts"),
  sJoin: $("#sJoin"), sSubmit: $("#sSubmit"), sOk: $("#sOk"), sNo: $("#sNo"),
  leftSec: $("#leftSec"), leftSecLarge: $("#leftSecLarge"),

  // 결과
  btnExportCSV: $("#btnExportCSV"), resultsTable: $("#resultsTable"),

  // 학생
  studentAccess: $("#studentAccess"),
  joinModal: $("#joinModal"), joinName: $("#joinName"), btnJoinGo: $("#btnJoinGo"), sState: $("#sState"),
  sQTitle: $("#sQTitle"), sQImg: $("#sQImg"), sOptBox: $("#sOptBox"),
  sShortWrap: $("#sShortWrap"), shortInput: $("#shortInput"), btnShortSend: $("#btnShortSend"),
};

/* ---------- Firestore refs ---------- */
const roomRef = id=>doc(window.db,"rooms",id);
const respCol = id=>collection(window.db,"rooms",id,"responses");

/* ---------- 공통 렌더 도우미 ---------- */
function setMode(m){
  MODE=m;
  const isAdmin = (m==="admin");
  // 관리자 UI 토글
  $$(".admin-only").forEach(n=>n.classList.toggle("hide", !isAdmin));
  // 패널 기본 가시성
  els.pBuild?.classList.toggle("hide", !isAdmin);
  els.pOptions?.classList.toggle("hide", !isAdmin);
  els.pResults?.classList.toggle("hide", !isAdmin);
  els.pPresent?.classList.toggle("hide", false); // 프레젠테이션은 공용 표시

  // 학생 컨테이너
  els.studentAccess?.classList.toggle("hide", isAdmin);

  // 탭 활성
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
  (isAdmin?els.tabBuild:els.tabPresent)?.classList.add("active");

  // 상단 상태 문구
  if(els.roomStatus){
    els.roomStatus.textContent = roomId ? `세션: ${roomId} · 온라인` : `세션: - · 오프라인`;
  }
}

function buildStudentLink(){
  if(!els.studentLink) return;
  const url=new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", roomId||"");
  els.studentLink.value=url.toString();

  if(window.QRCode && els.qrCanvas){
    try{ window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:120 }); }catch(e){}
  }
}

/* ---------- 세션 연결 ---------- */
async function ensureRoom(id){
  const snap=await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false,
      createdAt: serverTimestamp(), questions:[]
    });
  }
}

async function connect(){
  const id=(els.roomId?.value||"").trim();
  if(!id) return alert("세션 코드를 입력하세요.");
  roomId=id;
  els.roomId.disabled=true; els.btnConnect.classList.add("hide"); els.btnSignOut.classList.remove("hide");
  await ensureRoom(roomId);
  subscribeRoom(roomId);
  subscribeResponses(roomId);
  buildStudentLink();
  setMode(MODE);
}
function signOut(){
  roomId=""; els.roomId.disabled=false; els.btnConnect.classList.remove("hide"); els.btnSignOut.classList.add("hide");
  els.roomStatus.textContent="세션: - · 오프라인";
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
}

/* ---------- 구독 ---------- */
function subscribeRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom = onSnapshot(roomRef(id),(snap)=>{
    if(!snap.exists()) return;
    const r=snap.data(); window.__room=r;
    renderRoom(r);
  });
}
function subscribeResponses(id){
  if(unsubResp) unsubResp();
  unsubResp = onSnapshot(respCol(id),(qs)=>{
    const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    renderResponses(arr);
  });
}

/* ---------- 빌더(간단 샘플) ---------- */
function cardRow(no,q){
  const wrap=document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'} /><span>객관식</span></label>
      <label class="switch"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''} /><span>주관식</span></label>
      <label class="switch"><input type="file" accept="image/*" class="imgUp" data-no="${no}" /><span>이미지</span></label>
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항" value="${q?.text||''}" />
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기${i+1}" value="${v}">`).join('')}
      </div>
      <div class="row">
        <span class="hint">정답 번호</span>
        <input class="ansIndex input sm" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
      </div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <input class="ansText input" data-no="${no}" placeholder="정답(선택)" value="${q?.answerText||''}">
    </div>
  `;
  const radios=$$(`input[name="type-${no}"]`,wrap);
  const mcq=$(".mcq",wrap), short=$(".short",wrap);
  radios.forEach(r=>r.addEventListener("change",()=>{
    const isShort = radios.find(x=>x.checked)?.value==='short';
    mcq.classList.toggle("hide", isShort);
    short.classList.toggle("hide", !isShort);
  }));
  return wrap;
}
function collectBuilder(){
  const cards=$$("#builder>.qcard");
  const list=cards.map((c,idx)=>{
    const no=idx+1;
    const type=c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text=c.querySelector(".qtext").value.trim();
    const imgFile=c.querySelector(".imgUp")?.files?.[0]||null;
    const img = imgFile ? URL.createObjectURL(imgFile) : (c.dataset.img||"");
    if(!text) return null;
    if(type==='mcq'){
      const opts=$$(".opt",c).map(i=>i.value.trim()).filter(Boolean);
      const ans = Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans, image:img };
    } else {
      return { type:'short', text, answerText:c.querySelector(".ansText").value.trim(), image:img };
    }
  }).filter(Boolean);
  return { title: els.quizTitle?.value||"퀴즈", questions:list };
}

/* ---------- 진행/타이머 ---------- */
async function startQuiz(){ await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true }); }
async function step(delta){
  await runTransaction(window.db, async (tx)=>{
    const snap=await tx.get(roomRef(roomId));
    const r=snap.data(); const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){ // 마지막 → 종료 & 결과로
      tx.update(roomRef(roomId), { currentIndex: total-1, mode:"ended", accept:false });
      return;
    }
    next=Math.max(0,next);
    tx.update(roomRef(roomId), { currentIndex: next, accept:true });
  });
}
async function finishAll(){ if(confirm("퀴즈를 종료할까요?")) await updateDoc(roomRef(roomId), { mode:"ended", accept:false }); }

function startTimer(sec){
  stopTimer();
  const end = Date.now()+sec*1000;
  timerHandle=setInterval(()=>{
    const remain=Math.max(0, Math.floor((end-Date.now())/1000));
    const mm=pad(Math.floor(remain/60)), ss=pad(remain%60);
    if(els.leftSec) els.leftSec.textContent=`${mm}:${ss}`;
    if(els.leftSecLarge) els.leftSecLarge.textContent=`${mm}:${ss}`;
    if(remain<=0) { stopTimer(); updateDoc(roomRef(roomId), { accept:false }); setTimeout(()=>step(+1),500); }
  },250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } if(els.leftSec) els.leftSec.textContent="00:00"; if(els.leftSecLarge) els.leftSecLarge.textContent="00:00"; }

/* ---------- 제출/채점 ---------- */
async function join(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name=(els.joinName?.value||"").trim(); if(!name) return alert("이름/번호를 입력하세요.");
  me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem("quiz.device", me.id);
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{}, alive:true }, { merge:true });
  alert("참가 완료! 제출 버튼을 눌러주세요.");
}
async function submit(value){
  const r=window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
  const ref=doc(respCol(roomId), me.id);
  const snap=await getDoc(ref); const prev=snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert("이미 제출했습니다.");
  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true), revealed:r.reveal||false } }, { merge:true });
}

/* ---------- 렌더 ---------- */
function renderRoom(r){
  // 프레젠테이션
  if(els.pTitle) els.pTitle.textContent = r.title||roomId||"-";
  const idx=r.currentIndex, total=r.questions?.length||0;

  // 안내 문구/이미지 표시 제어
  if(idx==null || idx<0 || r.mode!=="active"){
    els.pNotice?.classList.remove("hide");
    els.pQ && (els.pQ.textContent="-");
    els.pImg?.classList.add("hide");
    els.pOpts && (els.pOpts.innerHTML="");
  } else {
    els.pNotice?.classList.add("hide");
    const q=r.questions[idx];
    els.pQ && (els.pQ.textContent=q.text||"-");
    if(q.image){ els.pImg?.classList.remove("hide"); els.pImg.src=q.image; }
    else { els.pImg?.classList.add("hide"); els.pImg.removeAttribute("src"); }

    // 관리자용 보기 표시(학생 제출과 무관)
    if(els.pOpts){
      els.pOpts.innerHTML="";
      if(q.type==='mcq'){
        q.options.forEach((t,i)=>{ const d=document.createElement("div"); d.className="badge"; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d); });
      }
    }
  }

  // 학생 화면
  if(MODE==='student'){
    if(r.mode!=='active' || idx<0){
      // 대기 상태
      els.sQTitle && (els.sQTitle.textContent="대기 중입니다… 제출 버튼을 눌러주세요.");
      els.sQImg?.classList.add("hide"); els.sQImg.removeAttribute("src");
      els.sOptBox && (els.sOptBox.innerHTML="");
      els.sShortWrap?.classList.add("hide");
      return;
    }
    const q=r.questions[idx];
    els.sQTitle && (els.sQTitle.textContent=q.text||"-");
    if(q.image){ els.sQImg?.classList.remove("hide"); els.sQImg.src=q.image; } else { els.sQImg?.classList.add("hide"); els.sQImg.removeAttribute("src"); }

    if(q.type==='mcq'){
      els.sOptBox.innerHTML="";
      q.options.forEach((opt,i)=>{
        const b=document.createElement("button");
        b.className="btn"; b.textContent=`${i+1}. ${opt}`;
        b.onclick=()=>submit(i);
        els.sOptBox.appendChild(b);
      });
      els.sShortWrap?.classList.add("hide");
    } else {
      els.sOptBox.innerHTML="";
      els.sShortWrap?.classList.remove("hide");
    }
  }
}

function renderResponses(list){
  if(MODE!=='admin') return;
  const r=window.__room||{}; const idx=r.currentIndex; const q=r.questions?.[idx];

  // 프레젠테이션 하단 카운터
  if(els.sJoin) els.sJoin.textContent = list.length;
  let submit=0, ok=0, no=0;
  list.forEach(s=>{
    const a=s.answers?.[idx];
    if(a){ submit++; if(a.correct) ok++; else no++; }
  });
  if(els.sSubmit) els.sSubmit.textContent=submit;
  if(els.sOk) els.sOk.textContent=ok;
  if(els.sNo) els.sNo.textContent=no;

  // 결과표
  if(els.resultsTable){
    const tbl=document.createElement("table");
    const thead=document.createElement("thead"), tr=document.createElement("tr");
    ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; tr.appendChild(th); });
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb=document.createElement("tbody");
    list.forEach(s=>{
      let score=0; const tr=document.createElement("tr");
      const tdn=document.createElement("td"); tdn.textContent=s.name||s.id; tr.appendChild(tdn);
      (r.questions||[]).forEach((q,i)=>{
        const a=s.answers?.[i]; const td=document.createElement("td");
        td.textContent = a? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : "-") : (a.value??"-")) : '-';
        if(a?.correct) score++; tr.appendChild(td);
      });
      const tds=document.createElement("td"); tds.textContent=String(score); tr.appendChild(tds);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
  }
}

/* ---------- 이벤트 ---------- */
// 모드 전환
$("#tabBuild")?.addEventListener("click", ()=>{ setMode("admin"); els.pBuild.classList.remove("hide"); els.pOptions.classList.add("hide"); els.pPresent.classList.add("hide"); els.pResults.classList.add("hide"); });
$("#tabOptions")?.addEventListener("click", ()=>{ setMode("admin"); els.pBuild.classList.add("hide"); els.pOptions.classList.remove("hide"); els.pPresent.classList.add("hide"); els.pResults.classList.add("hide"); });
$("#tabPresent")?.addEventListener("click", ()=>{ setMode("admin"); els.pBuild.classList.add("hide"); els.pOptions.classList.add("hide"); els.pPresent.classList.remove("hide"); els.pResults.classList.add("hide"); });
$("#tabResults")?.addEventListener("click", ()=>{ setMode("admin"); els.pBuild.classList.add("hide"); els.pOptions.classList.add("hide"); els.pPresent.classList.add("hide"); els.pResults.classList.remove("hide"); });

els.btnConnect?.addEventListener("click", connect);
els.btnSignOut?.addEventListener("click", signOut);

// 옵션 저장 → 링크/QR 즉시 갱신
els.btnSaveOptions?.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션 먼저 접속하세요.");
  await updateDoc(roomRef(roomId), {
    accept: !!els.chkAccept.checked,
    reveal: !!els.chkReveal.checked,
    bright: !!els.chkBright.checked,
    timer:  Math.max(5,Math.min(600, parseInt(els.timerSec?.value,10)||30))
  }, { merge:true });
  buildStudentLink();
  alert("저장 완료!");
});

// 초기화(문항, 설정, 결과 전체 삭제 → 처음 상태)
async function fullReset(){
  if(!roomId) return alert("세션 먼저 접속하세요.");
  if(!confirm("문항/옵션/결과를 모두 삭제하고 초기화할까요?")) return;
  await setDoc(roomRef(roomId), { title:"새 세션", questions:[], mode:"idle", currentIndex:-1, accept:false, reveal:false, bright:false, timer:30 }, { merge:false });
  const snap=await getDocs(respCol(roomId));
  await Promise.all(snap.docs.map(d=>setDoc(doc(respCol(roomId), d.id), {}, { merge:false })));
  alert("초기화 완료");
}
els.btnResetAll?.addEventListener("click", fullReset);
els.btnResetAllTop?.addEventListener("click", fullReset);

// 프레젠테이션 제어
els.btnStart?.addEventListener("click", startQuiz);
els.btnPrev?.addEventListener("click", ()=>step(-1));
els.btnNext?.addEventListener("click", ()=>step(+1));
els.btnEndAll?.addEventListener("click", finishAll);

// 학생 참가/제출
els.btnJoinGo?.addEventListener("click", join);
els.btnShortSend?.addEventListener("click", ()=> submit((els.shortInput?.value||"").trim()));

// 링크/QR
els.btnCopyLink?.addEventListener("click", async ()=>{
  if(!els.studentLink?.value) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="복사", 1000);
});
els.btnOpenStudent?.addEventListener("click", ()=> window.open(els.studentLink?.value||"#","_blank"));

/* ---------- 부트 ---------- */
(function boot(){
  // URL 파라미터로 모드/세션 진입 지원 (?role=student&room=class1)
  const url=new URL(location.href);
  const role=url.searchParams.get("role"); const rid=url.searchParams.get("room");
  if(role==='student'){ MODE='student'; setMode('student'); els.tabBuild?.classList.add("hide"); els.tabOptions?.classList.add("hide"); els.tabResults?.classList.add("hide"); }
  else { MODE='admin'; setMode('admin'); }

  if(rid){ if(els.roomId) els.roomId.value=rid; connect(); }
})();
