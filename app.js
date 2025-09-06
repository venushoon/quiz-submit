/***********************
 * Firebase (ESM)
 ***********************/
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc,
  collection, getDocs, runTransaction, serverTimestamp, query, where
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* ※ 본인 프로젝트 값으로 교체 가능 */
const firebaseConfig = {
  apiKey: "AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo",
  authDomain: "live-quiz-a14d1.firebaseapp.com",
  projectId: "live-quiz-a14d1",
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);

/***********************
 * Helpers & State
 ***********************/
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));
const pad = (n)=>String(n).padStart(2,'0');

let MODE   = "teacher";           // 'teacher' | 'student'
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;
let autoNextOn=false;

const els = {
  // 상단/탭
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), roomStatus: $("#roomStatus"),
  btnAdmin: $("#btnAdmin"), btnStudent: $("#btnStudent"),
  tabBuild: $("#tabBuild"), tabControl: $("#tabControl"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  panelBuild: $("#panelBuild"), panelControl: $("#panelControl"), panelPresent: $("#panelPresent"), panelResults: $("#panelResults"),
  statusText: $("#statusText"),

  // 빌더
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"), btnBuildForm: $("#btnBuildForm"),
  btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"), builder: $("#builder"),

  // 진행
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  chkAccept: $("#chkAccept"), policySelect: $("#policySelect"),
  timerSec: $("#timerSec"), btnTimerGo: $("#btnTimerGo"), btnTimerStop: $("#btnTimerStop"), leftSec: $("#leftSec"),
  nowQuestion: $("#nowQuestion"), progress: $("#progress"),
  autoNextToggle: $("#autoNextToggle"),

  // 링크/QR
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"),
  btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

  // 제출 현황/주관식 채점
  chips: $("#chips"), shortAnswers: $("#shortAnswers"),

  // 결과
  btnExportCSV: $("#btnExportCSV"), resultsTable: $("#resultsTable"),
  btnResetAll: $("#btnResetAll"), btnSaveJSON: $("#btnSaveJSON"), fileLoad: $("#fileLoad"),

  // 학생
  studentPanel: $("#studentPanel"), studentName: $("#studentName"), btnJoin: $("#btnJoin"),
  badgeType: $("#badgeType"), sQText: $("#sQText"), mcqBox: $("#mcqBox"),
  shortBox: $("#shortBox"), shortInput: $("#shortInput"), btnShortSend: $("#btnShortSend"),
  studentProgress: $("#studentProgress"),

  // 프레젠
  pTitle: $("#pTitle"), pQ: $("#pQ"), pOpts: $("#pOpts"),

  // 가이드
  guideAdmin: $("#guideAdmin"), guideStudent: $("#guideStudent"),
};

/***********************
 * Local cache
 ***********************/
const LS = {
  ROOM: "quiz.room",
  ROLE: "quiz.role",
  DEV:  "quiz.device",
  POLICY: "quiz.policy"
};
function saveLocal(){ localStorage.setItem(LS.ROOM, roomId||""); localStorage.setItem(LS.ROLE, MODE); }
function loadLocal(){
  const rid = localStorage.getItem(LS.ROOM)||"";
  const role= localStorage.getItem(LS.ROLE)||"teacher";
  roomId = rid; MODE = role;
  if(els.roomId) els.roomId.value = roomId;
}

/***********************
 * Refs (roomId 가드)
 ***********************/
const roomRef = (id)=> doc(db,"rooms",id);
const respCol = (id)=> collection(db,"rooms",id,"responses");
function insistRoom(){
  if(!roomId) throw new Error("roomId가 없습니다. 먼저 접속하세요.");
}

/***********************
 * Connect & Mode
 ***********************/
function setMode(m){
  MODE=m;
  // 가이드/패널 역할별 노출
  els.guideAdmin?.classList.toggle("hidden", m!=="teacher");
  els.guideStudent?.classList.toggle("hidden", m!=="student");

  const show = (p, on) => p?.classList.toggle("hidden", !on);
  show(els.panelBuild,   m==="teacher" && els.tabBuild.classList.contains("active"));
  show(els.panelControl, m==="teacher" && els.tabControl.classList.contains("active"));
  show(els.panelResults, m==="teacher" && els.tabResults.classList.contains("active"));
  show(els.panelPresent, els.tabPresent.classList.contains("active")); // 공통
  els.studentPanel?.classList.toggle("hidden", m!=="student");

  els.statusText && (els.statusText.textContent =
    roomId ? `세션: ${roomId} · 온라인` :
    (m==="teacher" ? "관리자 모드: 세션에 접속해 주세요." : "학생 모드: 세션 접속 후 참가하세요.")
  );

  saveLocal();
}
async function connect(){
  const id=(els.roomId?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId=id; saveLocal();

  // 방 생성 보장
  const snap = await getDoc(roomRef(roomId));
  if(!snap.exists()){
    await setDoc(roomRef(roomId), {
      title:"새 세션", mode:"idle", currentIndex:-1, accept:false,
      policy: els.policySelect?.value || "device-1",
      createdAt: serverTimestamp(), questions:[]
    });
  }else{
    // 기존 정책 로드
    const r = snap.data();
    if(els.policySelect && r?.policy) els.policySelect.value = r.policy;
  }

  // 리스너
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  unsubRoom = onSnapshot(roomRef(roomId), (s)=> s.exists() && renderRoom(s.data()));
  unsubResp = onSnapshot(respCol(roomId), (qs)=>{
    const arr=[]; qs.forEach(d=>arr.push({id:d.id,...d.data()})); renderResponses(arr);
  });

  els.roomStatus && (els.roomStatus.textContent=`세션: ${roomId} · 온라인`);
  buildStudentLink();
}

/***********************
 * Tabs
 ***********************/
function activateTab(btn){
  [els.tabBuild,els.tabControl,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
  btn.classList.add("active");
  setMode(MODE); // 노출 갱신
}

/***********************
 * Builder
 ***********************/
function card(no,q){
  const wrap=document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'} /><span>객관식</span></label>
      <label class="switch"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''} /><span>주관식</span></label>
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항 내용" value="${q?.text||''}" />
    <div class="mcq ${q?.type==='short'?'hidden':''}">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기 ${i+1}" value="${v}">`).join('')}
      </div>
      <div class="row gap-sm">
        <span class="hint">정답 번호</span>
        <input class="ansIndex input xs" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
      </div>
    </div>
    <div class="short ${q?.type==='short'?'':'hidden'}">
      <input class="ansText input" data-no="${no}" placeholder="정답(선택, 자동채점용)" value="${q?.answerText||''}">
    </div>
  `;
  const radios=$$(`input[name="type-${no}"]`,wrap);
  const mcq=$(".mcq",wrap), short=$(".short",wrap);
  radios.forEach(r=>r.addEventListener("change",()=>{
    const isShort = radios.find(x=>x.checked)?.value==='short';
    mcq.classList.toggle("hidden", isShort);
    short.classList.toggle("hidden", !isShort);
  }));
  return wrap;
}
function collectBuilder(){
  const cards=$$("#builder>.qcard");
  const list=cards.map((c,idx)=>{
    const no=idx+1;
    const type=c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text=c.querySelector(".qtext").value.trim();
    if(!text) return null;
    if(type==='mcq'){
      const opts=$$(".opt",c).map(i=>i.value.trim()).filter(Boolean);
      const ans = Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans };
    } else {
      return { type:'short', text, answerText:c.querySelector(".ansText").value.trim() };
    }
  }).filter(Boolean);
  return { title: els.quizTitle?.value||"퀴즈", questions:list };
}

/***********************
 * 진행/타이머/자동다음
 ***********************/
async function startQuiz(){
  insistRoom();
  await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true });
}
async function step(delta){
  insistRoom();
  await runTransaction(db, async (tx)=>{
    const ref=roomRef(roomId); const snap=await tx.get(ref); const r=snap.data();
    const total=(r.questions?.length||0); let next=(r.currentIndex??-1)+delta;
    if(next>=total){ // 종료
      tx.update(ref,{ currentIndex: total-1, mode:"ended", accept:false });
      return;
    }
    next=Math.max(0,next);
    tx.update(ref,{ currentIndex: next, accept:true });
  });
}
async function finishAll(){ insistRoom(); if(confirm("퀴즈를 종료할까요?")) await updateDoc(roomRef(roomId), { mode:"ended", accept:false }); }

function startTimer(sec){
  stopTimer();
  const end = Date.now()+sec*1000;
  timerHandle=setInterval(async ()=>{
    const remain=Math.max(0, Math.floor((end-Date.now())/1000));
    els.leftSec && (els.leftSec.textContent = `${pad(Math.floor(remain/60))}:${pad(remain%60)}`);
    if(remain<=0){
      stopTimer();
      await updateDoc(roomRef(roomId), { accept:false });
      if(autoNextOn) setTimeout(()=> step(+1), 400);
    }
  }, 250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } els.leftSec && (els.leftSec.textContent="00:00"); }

/***********************
 * 제출 정책 + 제출/채점
 ***********************/
function deviceId(){
  let id=localStorage.getItem(LS.DEV);
  if(!id){ id=Math.random().toString(36).slice(2,10); localStorage.setItem(LS.DEV,id); }
  return id;
}
async function join(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name=(els.studentName?.value||"").trim(); if(!name) return alert("이름을 입력하세요.");
  me = { id: deviceId(), name };
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{}, alive:true }, { merge:true });
  alert("참가 완료!");
}
async function submit(value){
  const rs=await getDoc(roomRef(roomId)); const r=rs.data();
  if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;

  const policy = r.policy || els.policySelect?.value || "device-1";
  // 실명 1회: 동일 이름이 이미 이번 문항을 제출했는지 검사
  if(policy==="name-1"){
    const qSnap = await getDocs(query(respCol(roomId), where("name","==", me.name||"")));
    for(const d of qSnap.docs){
      const a = (d.data().answers||{})[idx];
      if(a!=null){ alert("이 문항은 실명당 1회 제출만 허용됩니다."); return; }
    }
  }

  const ref=doc(respCol(roomId), me.id);
  const snap=await getDoc(ref); const prev=snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert("이미 제출했습니다.");

  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }

  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true), revealed:false } }, { merge:true });
}

/***********************
 * Render
 ***********************/
function renderRoom(r){
  window.__room=r;

  // 정책/자동다음 동기화
  if(els.policySelect) els.policySelect.value = r.policy || "device-1";
  autoNextOn = !!(els.autoNextToggle?.checked);

  const total=r.questions?.length||0; const idx=r.currentIndex;
  els.progress && (els.progress.textContent = `${Math.max(0,idx+1)}/${total}`);
  els.nowQuestion && (els.nowQuestion.textContent = (idx>=0 && r.questions[idx])? r.questions[idx].text : "-");

  // 프레젠
  els.pTitle && (els.pTitle.textContent = r.title||roomId);
  if(els.pQ && els.pOpts){
    els.pOpts.innerHTML="";
    if(idx>=0 && r.questions[idx]){
      const q=r.questions[idx]; els.pQ.textContent=q.text;
      if(q.type==='mcq'){ q.options.forEach((t,i)=>{ const d=document.createElement("div"); d.className="popt"; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d); }); }
      else els.pOpts.innerHTML=`<div class="popt">주관식</div>`;
    } else els.pQ.textContent="대기 중…";
  }

  // 학생 화면
  if(MODE==='student'){
    if(els.studentProgress) els.studentProgress.textContent = `${Math.max(0,idx+1)}/${total}`;
    if(r.mode!=='active' || idx<0){
      els.badgeType && (els.badgeType.textContent="대기");
      els.sQText && (els.sQText.textContent="대기 중입니다…");
      els.mcqBox && (els.mcqBox.innerHTML=""); els.shortBox && els.shortBox.classList.add("hidden");
      return;
    }
    const q=r.questions[idx];
    els.badgeType && (els.badgeType.textContent = q.type==='mcq'?'객관식':'주관식');
    els.sQText && (els.sQText.textContent=q.text);

    if(q.type==='mcq'){
      if(els.mcqBox){
        els.mcqBox.innerHTML="";
        q.options.forEach((opt,i)=>{
          const b=document.createElement("button");
          b.className="optbtn"; b.textContent=`${i+1}. ${opt}`; b.disabled=!r.accept;
          b.addEventListener("click", ()=>submit(i));
          els.mcqBox.appendChild(b);
        });
      }
      els.shortBox && els.shortBox.classList.add("hidden");
    } else {
      els.mcqBox && (els.mcqBox.innerHTML="");
      if(els.shortBox) { els.shortBox.classList.remove("hidden"); els.btnShortSend && (els.btnShortSend.disabled=!r.accept); }
    }
  }
}

function renderResponses(list){
  if(MODE!=='teacher') return;
  const r=window.__room||{}; const idx=r.currentIndex; const q=r.questions?.[idx];

  // 칩(정답/오답/대기)
  if(els.chips){
    els.chips.innerHTML="";
    list.forEach(s=>{
      const a=s.answers?.[idx]; const chip=document.createElement("div");
      chip.className="chip " + (a? (a.correct?'ok':'no') : 'wait');
      chip.textContent=s.name||s.id; els.chips.appendChild(chip);
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
        ok.onclick=()=> setDoc(doc(respCol(roomId), s.id), { [`answers.${idx}.correct`]: true,  [`answers.${idx}.revealed`]: true }, { merge:true });
        no.onclick=()=> setDoc(doc(respCol(roomId), s.id), { [`answers.${idx}.correct`]: false, [`answers.${idx}.revealed`]: true }, { merge:true });
        box.append(ok,no); row.append(box); els.shortAnswers.appendChild(row);
      });
    }
  }

  // 결과표
  if(els.resultsTable){
    const tbl=document.createElement("table");
    const thead=document.createElement("thead"), tr=document.createElement("tr");
    ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수","상태"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; tr.appendChild(th); });
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb=document.createElement("tbody");
    list.forEach(s=>{
      let score=0; const tr=document.createElement("tr");
      const tdn=document.createElement("td"); tdn.textContent=s.name||s.id; tr.appendChild(tdn);
      (r.questions||[]).forEach((q,i)=>{
        const a=s.answers?.[i]; const td=document.createElement("td");
        td.textContent = a? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value??'-')) : '-';
        if(a?.correct) score++; tr.appendChild(td);
      });
      const tds=document.createElement("td"); tds.textContent=String(score); tr.appendChild(tds);
      const tdl=document.createElement("td"); tdl.textContent= s.alive===false? "out":"alive"; tr.appendChild(tdl);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
  }
}

/***********************
 * Link/QR
 ***********************/
function buildStudentLink(){
  if(!els.studentLink) return;
  const url=new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", roomId);
  els.studentLink.value=url.toString();
  if(window.QRCode && els.qrCanvas){
    try{ window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:200 }); }
    catch(e){ console.warn("QR draw fail", e); }
  }
}

/***********************
 * Events
 ***********************/
els.btnAdmin?.addEventListener("click", ()=> setMode("teacher"));
els.btnStudent?.addEventListener("click", ()=> setMode("student"));
els.btnConnect?.addEventListener("click", connect);

[els.tabBuild,els.tabControl,els.tabPresent,els.tabResults].forEach(btn=>{
  btn?.addEventListener("click", ()=> activateTab(btn));
});

els.btnBuildForm?.addEventListener("click", ()=>{
  const n=Math.max(1,Math.min(20, parseInt(els.questionCount?.value,10)||3));
  if(els.builder){ els.builder.innerHTML=""; for(let i=0;i<n;i++) els.builder.appendChild(card(i+1)); }
});
els.btnLoadSample?.addEventListener("click", ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)은?', answerText:'100'},
    {type:'mcq', text:'바다의 소금기는 어디서?', options:['소금산','강물 광물질','하늘','바람'], answerIndex:1},
  ];
  if(els.builder){ els.builder.innerHTML=""; S.forEach((q,i)=>els.builder.appendChild(card(i+1,q))); }
  if(els.quizTitle) els.quizTitle.value="샘플 퀴즈";
  if(els.questionCount) els.questionCount.value=S.length;
});
els.btnSaveQuiz?.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const payload=collectBuilder(); if(!payload.questions.length) return alert("문항을 추가하세요.");
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("저장 완료!");
});

// 진행
els.btnStart?.addEventListener("click", startQuiz);
els.btnPrev?.addEventListener("click", ()=>step(-1));
els.btnNext?.addEventListener("click", ()=>step(+1));
els.btnEndAll?.addEventListener("click", finishAll);
els.chkAccept?.addEventListener("change", ()=> roomId && updateDoc(roomRef(roomId), { accept: !!els.chkAccept.checked }));
els.policySelect?.addEventListener("change", ()=> roomId && updateDoc(roomRef(roomId), { policy: els.policySelect.value }));
els.autoNextToggle?.addEventListener("change", ()=>{ autoNextOn = !!els.autoNextToggle.checked; });

els.btnTimerGo?.addEventListener("click", ()=> startTimer(Math.max(5,Math.min(600, parseInt(els.timerSec?.value,10)||30))));
els.btnTimerStop?.addEventListener("click", stopTimer);

// 링크/QR
els.btnCopyLink?.addEventListener("click", async ()=>{
  if(!els.studentLink) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="링크 복사", 1200);
});
els.btnOpenStudent?.addEventListener("click", ()=> window.open(els.studentLink?.value||"#","_blank"));

// 결과
els.btnExportCSV?.addEventListener("click", async ()=>{
  if(!roomId) return;
  const r=(await getDoc(roomRef(roomId))).data();
  const snap=await getDocs(respCol(roomId));
  const rows=[];
  rows.push(["userId","name",...(r.questions||[]).map((_,i)=>`Q${i+1}`),"score"].join(","));
  snap.forEach(d=>{
    const s=d.data(); let score=0;
    const answers=(r.questions||[]).map((q,i)=>{ const a=s.answers?.[i]; if(a?.correct) score++; return q.type==='mcq' ? (typeof a?.value==='number'? a.value+1 : "") : (a?.value??""); });
    rows.push([d.id, `"${(s.name||"").replace(/"/g,'""')}"`, ...answers, score].join(","));
  });
  const blob=new Blob([rows.join("\n")],{type:"text/csv"}); const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=`${(r.title||roomId)}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
});
els.btnResetAll?.addEventListener("click", async ()=>{
  if(!roomId) return;
  if(!confirm("세션/응답/상태를 모두 초기화합니다. 계속할까요?")) return;
  await setDoc(roomRef(roomId), { mode:"idle", currentIndex:-1, accept:false }, { merge:true });
  const snap=await getDocs(respCol(roomId));
  const tasks=[]; snap.forEach(d=> tasks.push(setDoc(doc(respCol(roomId), d.id), { answers:{}, alive:true }, { merge:true })));
  await Promise.all(tasks);
  // 빈 폼도 원하면 builder 리셋
  els.builder && (els.builder.innerHTML="");
  alert("전체 초기화 완료");
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
  if(!roomId) return;
  const f=e.target.files?.[0]; if(!f) return;
  const data=JSON.parse(await f.text());
  if(data.room) await setDoc(roomRef(roomId), data.room, { merge:true });
  if(Array.isArray(data.responses)) await Promise.all(data.responses.map(x=> setDoc(doc(respCol(roomId), x.id), x, { merge:true })));
  alert("불러오기 완료"); e.target.value="";
});

// 학생
els.btnJoin?.addEventListener("click", join);
els.btnShortSend?.addEventListener("click", ()=> submit((els.shortInput?.value||"").trim()));

/***********************
 * Boot: 자동 재접속 + URL 파라미터
 ***********************/
(function boot(){
  // 로컬 복구
  loadLocal();
  setMode(MODE);
  if(roomId) connect();

  // URL로 바로 학생 모드 열기: ?role=student&room=class1
  const url=new URL(location.href);
  const role=url.searchParams.get("role"); const rid=url.searchParams.get("room");
  if(role==='student'){ setMode("student"); }
  if(rid){ els.roomId && (els.roomId.value=rid); roomId=rid; connect(); }
})();
