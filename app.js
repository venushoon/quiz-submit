/* app.js  —— ES Module (Firebase v9 modular) */

// ── 1) Firebase v9 모듈 임포트
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, runTransaction,
  collection, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ── 2) Firebase 설정 (요청하신 프로젝트)
const firebaseConfig = {
  apiKey: "AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo",
  authDomain: "live-quiz-a14d1.firebaseapp.com",
  projectId: "live-quiz-a14d1",
};

// ── 3) 앱/DB 준비 (전역에 안 내보냄)
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ── 4) DOM 유틸
const $  = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));
const pad = (n) => String(n).padStart(2, "0");

// ── 5) 상태
let MODE   = "admin"; // admin | student
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;

// ── 6) 요소 캐시 (HTML 구조에 있는 id만 사용)
const els = {
  // 상단/세션
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), roomStatus: $("#roomStatus"),
  btnLogout: $("#btnLogout"),
  // 탭/패널
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"), pOptions: $("#panelOptions"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),
  // 빌더
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"), builder: $("#builder"),
  // 옵션/QR
  studentAccess: $("#studentAccess"), qrCanvas: $("#qrCanvas"),
  studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),
  // 프레젠테이션
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  leftSec: $("#leftSec"), presentWait: $("#presentWait"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pImg: $("#pImg"), pOpts: $("#pOpts"),
  statJoin: $("#statJoin"), statSubmit: $("#statSubmit"), statCorrect: $("#statCorrect"), statWrong: $("#statWrong"),
  // 결과
  btnExportCSV: $("#btnExportCSV"), btnResetAll: $("#btnResetAll"), resultsTable: $("#resultsTable"),
  // 학생 패널
  studentPanel: $("#studentPanel"), studentTopInfo: $("#studentTopInfo"),
  dlgJoin: $("#dlgJoin"), studentName: $("#studentName"), btnJoin: $("#btnJoin"), btnJoinCancel: $("#btnJoinCancel"),
  sQText: $("#sQText"), sQImg: $("#sQImg"), mcqBox: $("#mcqBox"),
  shortBox: $("#shortBox"), shortInput: $("#shortInput"), btnShortSend: $("#btnShortSend"), studentHint: $("#studentHint"),
};

// 없으면 경고만 찍고 진행(페이지 변형 대비)
Object.keys(els).forEach(k => { if(!els[k]) console.warn("[warn] element missing:", k); });

// ── 7) 로컬 저장
function saveLocal(){ localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me })); }
function loadLocal(){
  try{
    const d=JSON.parse(localStorage.getItem("quiz.live")||"{}");
    roomId=d.roomId||""; MODE=d.MODE||"admin"; me=d.me||{id:null,name:""};
    if(roomId && els.roomId) els.roomId.value=roomId;
  }catch{}
}

// ── 8) Firestore ref
const roomRef = (id)=>doc(db,"rooms",id);
const respCol = (id)=>collection(db,"rooms",id,"responses");

// ── 9) 방 보장
async function ensureRoom(id){
  const snap=await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션", mode:"idle", currentIndex:-1,
      accept:false, reveal:false, style:{ bright:false }, timerSec:30,
      createdAt: serverTimestamp(), questions:[]
    });
  }
}

// ── 10) 리스너
function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom=onSnapshot(roomRef(id),(snap)=>{
    if(!snap.exists()) return;
    const r=snap.data(); window.__room=r; renderRoom(r);
  });
}
function listenResponses(id){
  if(unsubResp) unsubResp();
  unsubResp=onSnapshot(respCol(id),(qs)=>{
    const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    renderResponses(arr);
  });
}

// ── 11) 모드
function setMode(m){
  MODE=m;
  // 관리자 패널 토글
  els.pBuild?.classList.toggle("hide", m!=="admin");
  els.pOptions?.classList.toggle("hide", m!=="admin");
  els.pResults?.classList.toggle("hide", m!=="admin");
  els.pPresent?.classList.add("hide");
  // 학생 패널
  els.studentPanel?.classList.toggle("hide", m!=="student");
  // 상태 텍스트
  if(els.roomStatus) els.roomStatus.textContent = roomId ? `세션: ${roomId} · 온라인` : "세션: - · 오프라인";
  if(els.studentTopInfo) els.studentTopInfo.textContent = roomId ? `세션: ${roomId} · 온라인` : "세션: - · 오프라인";
}

// ── 12) 접속/세션아웃
async function connect(){
  const id=(els.roomId?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId=id; await ensureRoom(roomId);
  listenRoom(roomId); listenResponses(roomId);
  buildStudentLink();
  els.roomId && (els.roomId.disabled=true);
  els.btnConnect && (els.btnConnect.textContent="세션아웃");
  els.btnConnect && (els.btnConnect.onclick = signOut);
  if(els.roomStatus) els.roomStatus.textContent=`세션: ${roomId} · 온라인`;
  saveLocal();
}
function signOut(){
  els.roomId && (els.roomId.disabled=false);
  els.btnConnect && (els.btnConnect.textContent="접속");
  els.btnConnect && (els.btnConnect.onclick = connect);
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  roomId=""; if(els.roomStatus) els.roomStatus.textContent="세션: - · 오프라인";
  buildStudentLink(); // 링크 초기화
  saveLocal();
}

// ── 13) 자동 복구 & URL 모드
function autoReconnect(){
  loadLocal();
  // URL: ?role=student&room=class1
  const url=new URL(location.href);
  const role=url.searchParams.get("role"); const rid=url.searchParams.get("room");
  if(role==='student') MODE='student';
  setMode(MODE);
  if(rid){ roomId=rid; if(els.roomId) els.roomId.value=roomId; }
  if(roomId && MODE==='admin'){ connect(); }
  if(MODE==='student' && !roomId){ buildStudentLink(); } // 학생 링크 정보만 표시
}

// ── 14) 빌더 UI
function cardRow(no,q){
  const wrap=document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap gap">
      <span class="badge">${no}번</span>
      <label><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'} /> 객관식</label>
      <label><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''} /> 주관식</label>
      <button class="btn ghost sm" data-img="1">이미지</button>
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항" value="${q?.text||''}">
    <img class="qimg ${q?.imgUrl?'':'hide'}" data-no="${no}" src="${q?.imgUrl||''}" alt="">
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap gap">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기${i+1}" value="${v}">`).join('')}
      </div>
      <div class="row gap">
        <span class="muted">정답번호</span>
        <input class="ansIndex input xs" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
      </div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <input class="ansText input" data-no="${no}" placeholder="정답(선택)" value="${q?.answerText||''}">
    </div>
  `;
  // 타입 토글
  const radios=$$(`input[name="type-${no}"]`,wrap);
  const mcq=$(".mcq",wrap), short=$(".short",wrap);
  radios.forEach(r=>r.addEventListener("change",()=>{
    const isShort = radios.find(x=>x.checked)?.value==='short';
    mcq.classList.toggle("hide", isShort);
    short.classList.toggle("hide", !isShort);
  }));
  // 이미지 업로드
  const imgBtn = $("button[data-img]",wrap);
  const imgTag = $(".qimg",wrap);
  imgBtn.addEventListener("click", ()=>{
    const inp=document.createElement("input"); inp.type="file"; inp.accept="image/*";
    inp.onchange=async ()=>{
      const f=inp.files?.[0]; if(!f) return;
      const url = URL.createObjectURL(f);
      imgTag.src=url; imgTag.classList.remove("hide");
      imgTag.dataset.local="1"; // 저장 시 dataURL로 묶지 않고, 지금은 미리보기 전용
    };
    inp.click();
  });
  return wrap;
}

function collectBuilder(){
  const cards=$$("#builder>.qcard");
  const list=cards.map((c,idx)=>{
    const no=idx+1;
    const type=c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text=c.querySelector(".qtext").value.trim();
    if(!text) return null;
    const img = c.querySelector(".qimg"); const imgUrl = (img && !img.classList.contains("hide")) ? img.src : "";
    if(type==='mcq'){
      const opts=$$(".opt",c).map(i=>i.value.trim()).filter(Boolean);
      const ans = Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans, imgUrl };
    } else {
      return { type:'short', text, answerText:c.querySelector(".ansText").value.trim(), imgUrl };
    }
  }).filter(Boolean);
  return { title: els.quizTitle?.value||"퀴즈", questions:list };
}

// ── 15) 진행 / 타이머
async function startQuiz(){ await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true }); }
async function step(delta){
  await runTransaction(db, async (tx)=>{
    const snap=await tx.get(roomRef(roomId));
    const r=snap.data(); const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){ // 종료
      tx.update(roomRef(roomId), { currentIndex: total-1, mode:"ended", accept:false });
      return;
    }
    next=Math.max(0,next);
    tx.update(roomRef(roomId), { currentIndex: next, accept:true });
  });
}
async function finishAll(){ await updateDoc(roomRef(roomId), { mode:"ended", accept:false }); }

function startTimer(sec){
  stopTimer();
  const end = Date.now()+sec*1000;
  timerHandle=setInterval(async ()=>{
    const remain=Math.max(0, Math.floor((end-Date.now())/1000));
    els.leftSec && (els.leftSec.textContent = `${pad(Math.floor(remain/60))}:${pad(remain%60)}`);
    if(remain<=0){
      stopTimer();
      await updateDoc(roomRef(roomId), { accept:false });
      setTimeout(()=> step(+1), 400);
    }
  }, 250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } els.leftSec && (els.leftSec.textContent="00:00"); }

// ── 16) 학생 참여 & 제출
async function join(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name=(els.studentName?.value||"").trim();
  if(!name) return alert("이름을 입력하세요.");
  const id = localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10);
  localStorage.setItem("quiz.device", id);
  me = { id, name };
  await setDoc(doc(respCol(roomId), id), { name, joinedAt:serverTimestamp(), answers:{}, alive:true }, { merge:true });
  if(els.dlgJoin?.open) els.dlgJoin.close();
  alert("참가 완료! 제출 버튼을 눌러주세요.");
  saveLocal();
}

async function submit(value){
  const r=window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
  const ref=doc(respCol(roomId), me.id);
  const snap=await getDoc(ref); const prev=snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert("이미 제출했습니다."); // 중복방지
  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase();
    if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true), revealed:r.reveal||false } }, { merge:true });
}

// ── 17) 렌더링
function renderRoom(r){
  // 프레젠테이션(관리자)
  const total=r.questions?.length||0; const idx=r.currentIndex;
  els.presentWait && els.presentWait.classList.toggle("hide", r.mode==="active" && idx>=0);
  if(els.pTitle) els.pTitle.textContent = r.title||roomId||"-";
  if(els.pQ){
    if(idx>=0 && r.questions[idx]) els.pQ.textContent=r.questions[idx].text;
    else els.pQ.textContent="대기 중…";
  }
  if(els.pImg){
    const has = (idx>=0 && r.questions[idx]?.imgUrl);
    els.pImg.classList.toggle("hide", !has);
    if(has) els.pImg.src = r.questions[idx].imgUrl;
  }
  if(els.pOpts){
    els.pOpts.innerHTML="";
    if(idx>=0 && r.questions[idx]?.type==='mcq'){
      r.questions[idx].options.forEach((t,i)=>{
        const d=document.createElement("div"); d.className="popt"; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d);
      });
    }
  }
  // 통계
  // (실제 카운트는 renderResponses에서 누적해 반영)

  // 학생 패널
  if(MODE==='student'){
    if(r.mode!=='active' || idx<0){
      els.sQImg?.classList.add("hide");
      if(els.sQText) els.sQText.textContent="대기 중입니다…";
      if(els.mcqBox) els.mcqBox.innerHTML="";
      els.shortBox?.classList.add("hide");
      return;
    }
    const q=r.questions[idx];
    if(els.sQText) els.sQText.textContent=q.text;
    // 이미지
    if(els.sQImg){
      const has=!!q.imgUrl; els.sQImg.classList.toggle("hide", !has);
      if(has) els.sQImg.src=q.imgUrl;
    }
    if(q.type==='mcq'){
      if(els.mcqBox){
        els.mcqBox.innerHTML="";
        q.options.forEach((opt,i)=>{
          const b=document.createElement("button");
          b.className="optbtn"; b.textContent=`${i+1}. ${opt}`; b.disabled=!r.accept;
          b.onclick=()=> submit(i);
          els.mcqBox.appendChild(b);
        });
      }
      els.shortBox?.classList.add("hide");
    }else{
      if(els.mcqBox) els.mcqBox.innerHTML="";
      els.shortBox?.classList.remove("hide");
      els.btnShortSend && (els.btnShortSend.disabled=!r.accept);
      els.btnShortSend && (els.btnShortSend.onclick = ()=> submit((els.shortInput?.value||"").trim()));
    }
  }
}

function renderResponses(list){
  if(MODE!=='admin') return;
  const r=window.__room||{}; const idx=r.currentIndex; const q=r.questions?.[idx];

  // 참가/제출/정답/오답 카운트
  let join=0, submit=0, ok=0, no=0;
  list.forEach(s=>{
    join++;
    const a=s.answers?.[idx];
    if(a){ submit++; if(a.correct) ok++; else no++; }
  });
  els.statJoin && (els.statJoin.textContent = `참가 ${join}`);
  els.statSubmit && (els.statSubmit.textContent = `제출 ${submit}`);
  els.statCorrect && (els.statCorrect.textContent = `정답 ${ok}`);
  els.statWrong && (els.statWrong.textContent = `오답 ${no}`);

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
        td.textContent = a? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value??'-')) : '-';
        if(a?.correct) score++; tr.appendChild(td);
      });
      const tds=document.createElement("td"); tds.textContent=String(score); tr.appendChild(tds);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
  }
}

// ── 18) QR/링크
function buildStudentLink(){
  if(!els.studentLink) return;
  const url=new URL(location.href);
  url.searchParams.set("role","student");
  if(roomId) url.searchParams.set("room", roomId); else url.searchParams.delete("room");
  els.studentLink.value=url.toString();
  // QR
  if(window.QRCode && els.qrCanvas){
    try{
      QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:132 }, (err)=>{ if(err) console.warn(err); });
    }catch(e){ /* 무시 */ }
  }
}

// ── 19) 이벤트 바인딩
els.btnConnect?.addEventListener("click", connect);
els.btnLogout?.addEventListener("click", signOut);

[els.tabBuild, els.tabOptions, els.tabPresent, els.tabResults].forEach(btn=>{
  btn?.addEventListener("click", ()=>{
    [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
    btn.classList.add("active");
    els.pBuild?.classList.toggle("hide", btn!==els.tabBuild);
    els.pOptions?.classList.toggle("hide", btn!==els.tabOptions);
    els.pPresent?.classList.toggle("hide", btn!==els.tabPresent ? true:false);
    els.pResults?.classList.toggle("hide", btn!==els.tabResults);
  });
});

// 빌더 버튼
els.btnBuildForm?.addEventListener("click", ()=>{
  const n=Math.max(1,Math.min(20, parseInt(els.questionCount?.value,10)||3));
  if(els.builder){ els.builder.innerHTML=""; for(let i=0;i<n;i++) els.builder.appendChild(cardRow(i+1)); }
});
els.btnLoadSample?.addEventListener("click", ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
    {type:'mcq', text:'태양계 별명?', options:['Milky','Solar','Sunset','Lunar'], answerIndex:1},
  ];
  if(els.builder){ els.builder.innerHTML=""; S.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q))); }
  if(els.quizTitle) els.quizTitle.value="샘플 퀴즈";
  if(els.questionCount) els.questionCount.value=S.length;
});
els.btnSaveQuiz?.addEventListener("click", async ()=>{
  if(!roomId){ alert("세션 접속 후 저장하세요."); return; }
  const payload=collectBuilder(); if(!payload.questions.length) return alert("문항을 추가하세요.");
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("저장 완료! (옵션 탭에서 링크/QR 확인)");
});

// 진행 버튼
els.btnStart?.addEventListener("click", startQuiz);
els.btnPrev?.addEventListener("click", ()=>step(-1));
els.btnNext?.addEventListener("click", ()=>step(+1));
els.btnEndAll?.addEventListener("click", finishAll);

// QR
els.btnCopyLink?.addEventListener("click", async ()=>{
  if(!els.studentLink) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="복사", 1200);
});
els.btnOpenStudent?.addEventListener("click", ()=> window.open(els.studentLink?.value||"#","_blank"));

// 결과/초기화
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
  a.href=URL.createObjectURL(blob); a.download=`${(r.title||roomId)}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
});
els.btnResetAll?.addEventListener("click", async ()=>{
  if(!roomId) return;
  if(!confirm("모든 문항/응답/설정을 초기화할까요?")) return;
  await setDoc(roomRef(roomId), { title:"새 세션", questions:[], mode:"idle", currentIndex:-1, accept:false, reveal:false }, { merge:true });
  const snap=await getDocs(respCol(roomId)); const tasks=[];
  snap.forEach(d=> tasks.push(setDoc(doc(respCol(roomId), d.id), { answers:{}, alive:true }, { merge:true })));
  await Promise.all(tasks);
  alert("초기화 완료");
});

// 학생 참가 팝업
els.btnJoin?.addEventListener("click", join);
els.btnJoinCancel?.addEventListener("click", ()=> els.dlgJoin?.close());

// ── 20) 부팅
(function init(){
  // URL role에 따라 학생 화면만 쓰는 경우, 관리자 UI 숨김
  const url=new URL(location.href);
  if(url.searchParams.get("role")==="student"){
    setMode("student");
    // 처음엔 참가 팝업만 띄우고 대기상태
    els.dlgJoin?.showModal?.();
  }else{
    setMode("admin");
  }
  autoReconnect();
  buildStudentLink();
})();
