/***********************
 * Firebase (v9 modules)
 ***********************/
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc,
  collection, getDocs, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* 본인 프로젝트로 교체 가능(이미 사용 중인 값 유지) */
const firebaseConfig = {
  apiKey: "AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo",
  authDomain: "live-quiz-a14d1.firebaseapp.com",
  projectId: "live-quiz-a14d1",
};
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

/***********************
 * Shorthands & State
 ***********************/
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));
const pad = (n)=>String(n).padStart(2,'0');

let MODE   = "admin";       // 'admin' | 'student'
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;

const els = {
  // 공통/상단
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions")||$("#tabControl"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"), pOptions: $("#panelOptions")||$("#panelControl"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnLogout: $("#btnLogout"), roomStatus: $("#roomStatus"),
  // 문항 빌더
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"),
  builder: $("#builder"),
  // 옵션
  chkDevicePolicy: $("#chkDevicePolicy"),  // 기기당 1회
  chkNamePolicy: $("#chkNamePolicy"),      // 실명당 1회
  chkBright: $("#chkBrightMode"),          // 프레젠테이션 밝은 모드
  timerSec: $("#timerSec"),                // 타이머(초) 입력
  btnSaveOptions: $("#btnSaveOptions"),
  // 학생 접속 (옵션 탭 전용 표시)
  studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"), qrCanvas: $("#qrCanvas"),
  // 프레젠테이션
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pOpts: $("#pOpts"), pFooter: $("#pFooter"),
  // 진행/현황
  progress: $("#progress"), nowQuestion: $("#nowQuestion"),
  chips: $("#chips"), shortAnswers: $("#shortAnswers"),
  // 결과
  resultsTable: $("#resultsTable"), btnExportCSV: $("#btnExportCSV"),
  // 초기화/백업
  btnResetAll: $("#btnResetAll"), btnSaveJSON: $("#btnSaveJSON"), fileLoad: $("#fileLoad"),
  // 학생 패널
  studentPanel: $("#studentPanel"), studentName: $("#studentName"), btnJoin: $("#btnJoin"),
  mcqBox: $("#mcqBox"), shortBox: $("#shortBox"), shortInput: $("#shortInput"), btnShortSend: $("#btnShortSend"),
  badgeType: $("#badgeType"), sQText: $("#sQText"),
  // 안내/가이드
  guideAdmin: $("#guideAdmin"), guideStudent: $("#guideStudent"),
  // 학생 대기 오버레이(팝업)
  waitOverlay: $("#waitOverlay"), waitText: $("#waitText"),
};

/* 안전 경고(누락된 엘리먼트 로깅) */
Object.entries(els).forEach(([k,v])=>{ if(!v) console.warn("[warn] missing element:", k); });

/***********************
 * Local cache
 ***********************/
function saveLocal(){ localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me })); }
function loadLocal(){
  try{
    const d=JSON.parse(localStorage.getItem("quiz.live")||"{}");
    roomId=d.roomId||""; MODE=d.MODE||"admin"; me=d.me||{id:null,name:""};
    if(els.roomId && roomId) els.roomId.value=roomId;
  }catch{}
}

/***********************
 * Firestore refs
 ***********************/
const roomRef = (id)=>doc(db,"rooms",id);
const respCol = (id)=>collection(db,"rooms",id,"responses");

async function ensureRoom(id){
  const snap=await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false,
      policy:{ deviceOnce:true, nameOnce:false },
      options:{ bright:false, timerSec:0 },
      createdAt: serverTimestamp(), questions:[]
    });
  }
}

/***********************
 * Mode & Tabs
 ***********************/
function setMode(m){
  MODE=m;
  // 학생은 관리자 UI 숨기기
  const adminWrap = $("#adminWrap");
  if(adminWrap) adminWrap.style.display = (m==="admin") ? "" : "none";

  // 학생 가이드/관리자 가이드 토글
  if(els.guideAdmin)   els.guideAdmin.classList.toggle("hide", m!=="admin");
  if(els.guideStudent) els.guideStudent.classList.toggle("hide", m!=="student");

  // 학생 패널 표시
  if(els.studentPanel) els.studentPanel.classList.toggle("hide", m!=="student");

  // 탭 표시(학생은 프레젠테이션만 봄)
  if(MODE==="admin"){
    showTab(els.tabBuild || els.tabOptions || els.tabPresent); // 기본 문항 탭
  } else {
    showTab(null); // 관리자 탭 감춤
  }

  // 상태 텍스트
  if(els.roomStatus){
    if(!roomId){
      els.roomStatus.textContent = (m==='admin'?'세션에 접속해 주세요.':'학생: 세션 접속 후 참가');
    }else{
      els.roomStatus.textContent = `세션: ${roomId} · 온라인`;
    }
  }
}

function showTab(tabBtn){
  // 전체 패널 숨기고 버튼 active 초기화
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
  [els.pBuild,els.pOptions,els.pPresent,els.pResults].forEach(p=>p?.classList.add("hide"));

  if(!tabBtn){ // 학생모드일 때: 관리자 패널 전부 숨김
    return;
  }
  tabBtn.classList.add("active");
  if(tabBtn===els.tabBuild && els.pBuild) els.pBuild.classList.remove("hide");
  if(tabBtn===els.tabOptions && els.pOptions) els.pOptions.classList.remove("hide");
  if(tabBtn===els.tabPresent && els.pPresent) els.pPresent.classList.remove("hide");
  if(tabBtn===els.tabResults && els.pResults) els.pResults.classList.remove("hide");
}

/***********************
 * Connect / Logout
 ***********************/
async function connect(){
  const id=(els.roomId?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId=id; await ensureRoom(roomId);

  // 입력 잠금
  if(els.roomId){ els.roomId.disabled=true; els.roomId.classList.add("locked"); }
  if(els.btnConnect){ els.btnConnect.classList.add("hide"); }
  if(els.btnLogout){ els.btnLogout.classList.remove("hide"); }

  listenRoom(roomId);
  listenResponses(roomId);
  buildStudentLink();
  if(els.roomStatus) els.roomStatus.textContent=`세션: ${roomId} · 온라인`;
  saveLocal();

  // 관리자 첫 화면은 문항 탭
  if(MODE==="admin" && els.tabBuild) showTab(els.tabBuild);
}

function logout(){
  // 해제
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  unsubRoom=null; unsubResp=null;

  if(els.roomId){ els.roomId.disabled=false; els.roomId.classList.remove("locked"); }
  if(els.btnConnect){ els.btnConnect.classList.remove("hide"); }
  if(els.btnLogout){ els.btnLogout.classList.add("hide"); }
  if(els.roomStatus) els.roomStatus.textContent=`세션 오프라인`;

  // 링크/QR 지우기
  if(els.studentLink) els.studentLink.value="";
  if(els.qrCanvas && window.QRCode){ els.qrCanvas.getContext?.("2d")?.clearRect(0,0,els.qrCanvas.width,els.qrCanvas.height); }

  roomId="";
  saveLocal();
}

/***********************
 * Listeners
 ***********************/
function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom=onSnapshot(roomRef(id),(snap)=>{
    if(!snap.exists()) return;
    const r=snap.data();
    window.__room=r;
    renderRoom(r);
  });
}
function listenResponses(id){
  if(unsubResp) unsubResp();
  unsubResp=onSnapshot(respCol(id),(qs)=>{
    const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    renderResponses(arr);
  });
}

/***********************
 * Builder (문항)
 ***********************/
function cardRow(no,q){
  const wrap=document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'} /><span>객관식</span></label>
      <label class="switch"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''} /><span>주관식</span></label>
      <label class="imguploader">
        <input type="file" accept="image/*" class="imgInput" data-no="${no}" />
        <span class="imgBtn">이미지</span>
      </label>
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항 내용" value="${q?.text||''}" />
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap four-cols">
        ${(q?.options||['','','','']).map((v,i)=>`
          <div class="optCell">
            <label>보기 ${i+1}</label>
            <input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기 ${i+1}" value="${v}">
          </div>`).join('')}
      </div>
      <div class="row">
        <span class="hint">정답 번호</span>
        <input class="ansIndex input xs" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
      </div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <input class="ansText input" data-no="${no}" placeholder="정답(선택, 자동채점용)" value="${q?.answerText||''}">
    </div>
    <input type="hidden" class="imgData" data-no="${no}" value="${q?.imageData||''}">
  `;
  const radios=$$(`input[name="type-${no}"]`,wrap);
  const mcq=$(".mcq",wrap), short=$(".short",wrap);
  radios.forEach(r=>r.addEventListener("change",()=>{
    const isShort = radios.find(x=>x.checked)?.value==='short';
    mcq.classList.toggle("hide", isShort);
    short.classList.toggle("hide", !isShort);
  }));
  // 이미지 업로드 -> Base64 저장
  const fileInput=$(".imgInput",wrap), imgData=$(".imgData",wrap);
  if(fileInput){
    fileInput.addEventListener("change", async (e)=>{
      const f=e.target.files?.[0]; if(!f) return;
      const reader=new FileReader();
      reader.onload=()=>{ imgData.value=String(reader.result||""); };
      reader.readAsDataURL(f);
    });
  }
  return wrap;
}

function collectBuilder(){
  const cards=$$("#builder>.qcard");
  const list=cards.map((c,idx)=>{
    const no=idx+1;
    const type=c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text=c.querySelector(".qtext").value.trim();
    const imageData=c.querySelector(".imgData")?.value||"";
    if(!text) return null;
    if(type==='mcq'){
      const opts=$$(".opt",c).map(i=>i.value.trim()).filter(Boolean);
      const ans = Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans, imageData };
    } else {
      return { type:'short', text, answerText:c.querySelector(".ansText").value.trim(), imageData };
    }
  }).filter(Boolean);
  return { title: els.quizTitle?.value||"퀴즈", questions:list };
}

/***********************
 * Options Save (탭 이동 금지!)
 ***********************/
async function saveOptions(){
  if(!roomId){ alert("세션 먼저 접속하세요."); return; }
  const policy={
    deviceOnce: !!els.chkDevicePolicy?.checked,
    nameOnce: !!els.chkNamePolicy?.checked,
  };
  const options={
    bright: !!els.chkBright?.checked,
    timerSec: Math.max(0, parseInt(els.timerSec?.value||"0",10)||0),
  };
  await setDoc(roomRef(roomId), { policy, options }, { merge:true });
  buildStudentLink();               // 저장 후 즉시 링크/QR 갱신
  alert("옵션 저장 완료!");
  // 여기서 탭 이동하지 않음(버그 원인 제거)
}

/***********************
 * Flow + Timer
 ***********************/
async function startQuiz(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true });
}
async function step(delta){
  if(!roomId) return;
  await runTransaction(db, async (tx)=>{
    const ref=roomRef(roomId);
    const snap=await tx.get(ref);
    const r=snap.data(); const total=(r.questions?.length||0);
    if(total<=0){ tx.update(ref,{ mode:"ended", accept:false }); return; }
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){
      // 끝: 종료로 전환
      tx.update(ref, { currentIndex: total-1, mode:"ended", accept:false });
      return;
    }
    next=Math.max(0,next);
    tx.update(ref, { currentIndex: next, accept:true });
  });
}
async function finishAll(){
  if(!roomId) return;
  await updateDoc(roomRef(roomId), { mode:"ended", accept:false });
}

/***********************
 * Submit / Grade
 ***********************/
function ensureDeviceId(){
  let id=localStorage.getItem("quiz.device");
  if(!id){ id=Math.random().toString(36).slice(2,10); localStorage.setItem("quiz.device", id); }
  return id;
}
async function join(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name=(els.studentName?.value||"").trim(); if(!name) return alert("이름/번호를 입력하세요.");
  me = { id: ensureDeviceId(), name };
  await setDoc(doc(respCol(roomId), me.id), {
    name, joinedAt: serverTimestamp(), alive:true
  }, { merge:true });
  saveLocal();
  // 참가 후에는 '대기' 오버레이 유지 → 교사가 시작하면 해제됨
  showWait("제출 버튼을 눌러주세요."); // 안내 문구 유지(요청사항)
}

async function submit(value){
  const r=window.__room; if(!r){ alert("세션 정보를 불러오는 중입니다."); return; }
  if(!r.accept){ alert("지금은 제출할 수 없습니다."); return; }
  if(!me.id){ alert("먼저 참가하세요."); return; }
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;

  // 제출 정책(중복 제출 방지)
  const ref=doc(respCol(roomId), me.id);
  const snap=await getDoc(ref);
  const prev=snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert("이미 제출했습니다.");

  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true), revealed:r.reveal||false } }, { merge:true });
  alert("제출되었습니다.");
}

async function grade(uid, qIndex, ok){
  if(!roomId) return;
  await setDoc(doc(respCol(roomId), uid), { [`answers.${qIndex}.correct`]: !!ok, [`answers.${qIndex}.revealed`]: true }, { merge:true });
}

/***********************
 * Rendering
 ***********************/
function renderRoom(r){
  const total=r.questions?.length||0; const idx=r.currentIndex??-1;

  // 관리자 탭 UI 상태
  if(MODE==="admin"){
    if(els.progress) els.progress.textContent = `${Math.max(0,idx+1)}/${total}`;
    if(els.nowQuestion) els.nowQuestion.textContent = (idx>=0 && r.questions[idx])? r.questions[idx].text : "-";
    // 프레젠테이션 콘텐츠
    if(els.pTitle) els.pTitle.textContent = r.title||roomId;
    if(els.pQ && els.pOpts){
      els.pOpts.innerHTML="";
      if(r.mode!=="active" || idx<0){
        // 시작 전 안내
        els.pQ.textContent = "시작 버튼을 누르면 문항이 제시됩니다.";
        if(els.pFooter) els.pFooter.innerHTML = buildLegendHTML();
      } else {
        const q=r.questions[idx];
        els.pQ.textContent = q.text;
        if(q.imageData){ // 이미지 있을 때만
          let old = $("#pQImage");
          if(!old){ old=document.createElement("img"); old.id="pQImage"; old.className="pQimg"; els.pQ.parentElement.appendChild(old); }
          old.src = q.imageData;
          old.style.display="block";
        } else {
          const old=$("#pQImage"); if(old) old.style.display="none";
        }
        if(q.type==='mcq'){
          q.options.forEach((t,i)=>{ const d=document.createElement("div"); d.className="popt"; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d); });
        }
        if(els.pFooter) els.pFooter.innerHTML = buildLegendHTML();
      }
    }
    // 종료 시 결과 탭 전환
    if(r.mode==="ended" && els.tabResults){ showTab(els.tabResults); }
  }

  // 학생 화면
  if(MODE==="student"){
    const atActive = (r.mode==="active" && idx>=0 && r.questions[idx]);
    // 시작 전/종료 시: 항상 대기 오버레이(또는 종료 안내)
    if(!atActive){
      if(r.mode==="ended"){
        showWait("퀴즈가 종료되었습니다! '내 결과 보기'를 눌러 확인하세요.");
      } else {
        showWait("제출 버튼을 눌러주세요.");
      }
      // 문제 영역 비움
      if(els.badgeType) els.badgeType.textContent="대기";
      if(els.sQText) els.sQText.textContent="대기 중입니다…";
      if(els.mcqBox) els.mcqBox.innerHTML="";
      if(els.shortBox) els.shortBox.classList.add("hide");
      return;
    }
    // 진행 중: 대기 오버레이 해제
    hideWait();

    const q=r.questions[idx];
    if(els.badgeType) els.badgeType.textContent = q.type==='mcq'?'객관식':'주관식';
    if(els.sQText) els.sQText.textContent=q.text;

    // 이미지(학생) — 있을 때만 렌더
    const sImg=$("#sQImage");
    if(q.imageData){
      if(sImg){ sImg.src=q.imageData; sImg.style.display="block"; }
    } else if(sImg){
      sImg.style.display="none";
    }

    if(q.type==='mcq'){
      if(els.mcqBox){
        els.mcqBox.innerHTML="";
        q.options.forEach((opt,i)=>{
          const b=document.createElement("button");
          b.className="optbtn"; b.textContent=`${i+1}. ${opt}`;
          b.addEventListener("click", ()=>{
            // 선택 후 '제출' 버튼으로 제출
            const oldSel = els.mcqBox.querySelector(".optbtn.selected");
            if(oldSel) oldSel.classList.remove("selected");
            b.classList.add("selected");
          });
          els.mcqBox.appendChild(b);
        });
        // 제출 버튼(하단)
        const submitBtn = document.createElement("button");
        submitBtn.className="btn primary block mt8";
        submitBtn.textContent="제출";
        submitBtn.addEventListener("click", ()=>{
          const sel = els.mcqBox.querySelector(".optbtn.selected");
          if(!sel) return alert("보기를 선택하세요.");
          const idxSel = Array.from(els.mcqBox.querySelectorAll(".optbtn")).indexOf(sel);
          submit(idxSel);
        });
        els.mcqBox.appendChild(submitBtn);
      }
      if(els.shortBox) els.shortBox.classList.add("hide");
    } else {
      if(els.mcqBox) els.mcqBox.innerHTML="";
      if(els.shortBox){
        els.shortBox.classList.remove("hide");
        if(els.btnShortSend){
          els.btnShortSend.onclick = ()=> submit((els.shortInput?.value||"").trim());
        }
      }
    }
  }
}

function buildLegendHTML(){
  // 파랑/노랑/초록/빨강 점으로 표시
  return `
    <div class="legend">
      <span class="dot blue"></span>참가
      <span class="dot yellow"></span>제출
      <span class="dot green"></span>정답
      <span class="dot red"></span>오답
    </div>
  `;
}

function renderResponses(list){
  if(MODE!=="admin") return;
  const r=window.__room||{}; const idx=r.currentIndex; const q=r.questions?.[idx];

  // 칩(진행 현황)
  if(els.chips){
    els.chips.innerHTML="";
    list.forEach(s=>{
      const a=s.answers?.[idx];
      const chip=document.createElement("div");
      let cls="wait";
      if(a){ cls = a.correct ? "ok" : "no"; }
      chip.className="chip "+cls;
      chip.textContent=s.name||s.id;
      els.chips.appendChild(chip);
    });
  }

  // 주관식 채점
  if(els.shortAnswers){
    els.shortAnswers.innerHTML="";
    if(q && q.type==='short'){
      list.forEach(s=>{
        const a=s.answers?.[idx]; if(!a || typeof a.value!=='string') return;
        const row=document.createElement("div"); row.className="row between";
        row.innerHTML=`<span>${s.name}: ${a.value}</span>`;
        const box=document.createElement("div");
        const ok=document.createElement("button"); ok.className="btn ghost"; ok.textContent="정답";
        const no=document.createElement("button"); no.className="btn ghost"; no.textContent="오답";
        ok.onclick=()=>grade(s.id, idx, true); no.onclick=()=>grade(s.id, idx, false);
        box.append(ok,no); row.append(box); els.shortAnswers.appendChild(row);
      });
    }
  }

  // 결과표 (관리자)
  if(els.resultsTable){
    const tbl=document.createElement("table");
    const thead=document.createElement("thead"), tr=document.createElement("tr");
    ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; tr.appendChild(th); });
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb=document.createElement("tbody");
    // 점수 계산 후 순위 정렬
    const rows = list.map(s=>{
      let score=0; const cols=[];
      (r.questions||[]).forEach((q,i)=>{
        const a=s.answers?.[i];
        const cell = a ? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value||'-')) : '-';
        if(a?.correct) score++;
        cols.push(cell);
      });
      return { name:s.name||s.id, cols, score };
    }).sort((a,b)=>b.score-a.score);

    rows.forEach(row=>{
      const tr=document.createElement("tr");
      const tdN=document.createElement("td"); tdN.textContent=row.name; tr.appendChild(tdN);
      row.cols.forEach(c=>{ const td=document.createElement("td"); td.textContent=c; tr.appendChild(td); });
      const tdS=document.createElement("td"); tdS.textContent=String(row.score); tr.appendChild(tdS);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
  }
}

/***********************
 * Wait Overlay (학생)
 ***********************/
function showWait(msg){
  if(els.waitText) els.waitText.textContent = msg||"대기 중입니다…";
  if(els.waitOverlay) els.waitOverlay.classList.remove("hide");
}
function hideWait(){
  if(els.waitOverlay) els.waitOverlay.classList.add("hide");
}

/***********************
 * Link / QR
 ***********************/
function buildStudentLink(){
  if(!roomId) return;
  if(els.studentLink){
    const url=new URL(location.href);
    url.searchParams.set("role","student");
    url.searchParams.set("room", roomId);
    els.studentLink.value = url.toString();
  }
  if(els.qrCanvas && window.QRCode && els.studentLink?.value){
    try{
      // 크기 약간 작게(요청)
      window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:160 }, (err)=>{ if(err) console.warn(err); });
    }catch(e){ console.warn("QR draw failed", e); }
  }
}

/***********************
 * Export / Import / Reset
 ***********************/
els.btnExportCSV?.addEventListener("click", async ()=>{
  if(!roomId) return;
  const r=(await getDoc(roomRef(roomId))).data()||{};
  const snap=await getDocs(respCol(roomId));
  const rows=[]; rows.push(["userId","name",...(r.questions||[]).map((_,i)=>`Q${i+1}`),"score"].join(","));
  snap.forEach(d=>{
    const s=d.data(); let score=0;
    const answers=(r.questions||[]).map((q,i)=>{ const a=s.answers?.[i]; if(a?.correct) score++; return q.type==='mcq' ? (typeof a?.value==='number'? a.value+1 : "") : (a?.value??""); });
    rows.push([d.id, `"${(s.name||"").replace(/"/g,'""')}"`, ...answers, score].join(","));
  });
  const blob=new Blob([rows.join("\n")],{type:"text/csv"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=`${r.title||roomId}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
});

els.btnSaveJSON?.addEventListener("click", async ()=>{
  if(!roomId) return;
  const r=(await getDoc(roomRef(roomId))).data();
  const res=await getDocs(respCol(roomId));
  const obj={ roomId, room:r, responses: res.docs.map(d=>({ id:d.id, ...d.data() })) };
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:"application/json"}));
  a.download=`${roomId}-backup.json`; a.click(); URL.revokeObjectURL(a.href);
});

els.fileLoad?.addEventListener("change", async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const data=JSON.parse(await f.text());
  if(data.room) await setDoc(roomRef(roomId), data.room, { merge:true });
  if(Array.isArray(data.responses)) await Promise.all(data.responses.map(x=> setDoc(doc(respCol(roomId), x.id), x, { merge:true })));
  alert("불러오기 완료"); e.target.value="";
});

els.btnResetAll?.addEventListener("click", async ()=>{
  if(!roomId) return;
  if(!confirm("문항/옵션/결과를 모두 초기화하고 처음 상태로 돌립니다. 진행할까요?")) return;
  // 룸 기본 상태로 리셋
  await setDoc(roomRef(roomId), {
    title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false,
    policy:{ deviceOnce:true, nameOnce:false },
    options:{ bright:false, timerSec:0 },
    questions:[]
  }, { merge:false });
  // 응답 초기화
  const snap=await getDocs(respCol(roomId));
  const tasks=[];
  snap.forEach(d=> tasks.push(setDoc(doc(respCol(roomId), d.id), { answers:{}, alive:true }, { merge:true })));
  await Promise.all(tasks);
  alert("완전 초기화 완료");
});

/***********************
 * Events
 ***********************/
els.btnConnect?.addEventListener("click", connect);
els.btnLogout?.addEventListener("click", logout);

// 탭 이동
els.tabBuild?.addEventListener("click", ()=> showTab(els.tabBuild));
els.tabOptions?.addEventListener("click", ()=> showTab(els.tabOptions));
els.tabPresent?.addEventListener("click", ()=> showTab(els.tabPresent));
els.tabResults?.addEventListener("click", ()=> showTab(els.tabResults));

// 문항 만들기
els.btnBuildForm?.addEventListener("click", ()=>{
  const n=Math.max(1,Math.min(20, parseInt(els.questionCount?.value,10)||3));
  if(els.builder){ els.builder.innerHTML=""; for(let i=0;i<n;i++) els.builder.appendChild(cardRow(i+1)); }
});
els.btnLoadSample?.addEventListener("click", ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
    {type:'mcq', text:'대한민국의 수도는?', options:['서울','부산','대전','대구'], answerIndex:0},
  ];
  if(els.builder){ els.builder.innerHTML=""; S.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q))); }
  if(els.quizTitle) els.quizTitle.value="샘플 퀴즈";
  if(els.questionCount) els.questionCount.value=S.length;
});
els.btnSaveQuiz?.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션 먼저 접속하세요.");
  const payload=collectBuilder();
  if(!payload.questions.length) return alert("문항을 추가하세요.");
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("문항 저장 완료!");
});

els.btnSaveOptions?.addEventListener("click", saveOptions);

// 프레젠테이션 제어
els.btnStart?.addEventListener("click", startQuiz);
els.btnPrev?.addEventListener("click", ()=>step(-1));
els.btnNext?.addEventListener("click", ()=>step(+1));
els.btnEndAll?.addEventListener("click", finishAll);

// 학생 접속/제출
els.btnJoin?.addEventListener("click", join);
els.btnShortSend?.addEventListener("click", ()=> submit((els.shortInput?.value||"").trim()));

// 링크/QR
els.btnCopyLink?.addEventListener("click", async ()=>{
  if(!els.studentLink?.value) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="복사", 1200);
});
els.btnOpenStudent?.addEventListener("click", ()=> window.open(els.studentLink?.value||"#","_blank"));

/***********************
 * Boot
 ***********************/
(function boot(){
  loadLocal();
  // 기본은 관리자 모드
  const url=new URL(location.href);
  const role=url.searchParams.get("role"); const rid=url.searchParams.get("room");

  if(role==='student'){ MODE='student'; }
  setMode(MODE);

  // 세션 자동 접속
  if(rid){ if(els.roomId) els.roomId.value=rid; connect(); }
  else if(roomId){ connect(); }

  // 학생 모드 초기: 항상 이름 팝업(대기)
  if(MODE==='student'){
    // 이미 me.id가 있더라도 시작 전엔 대기 문구 유지
    showWait("이름(번호)을 입력 후 참가를 누르세요.");
  }
})();
