/***********************
 * Firebase (window.db 는 index.html에서 주입)
 ***********************/
import {
  doc, setDoc, getDoc, onSnapshot, updateDoc,
  collection, getDocs, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/***********************
 * DOM helpers & state
 ***********************/
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));
const pad = (n)=>String(n).padStart(2,'0');

let MODE   = "admin";           // 'admin' | 'student'
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;

const els = {
  // 헤더/탭
  roomId : $("#roomId"),
  btnConnect: $("#btnConnect"),
  btnSignOut: $("#btnSignOut"),
  roomStatus: $("#roomStatus"),
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"),
  tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),

  // 패널
  pBuild: $("#panelBuild"), pOptions: $("#panelOptions"),
  pPresent: $("#panelPresent"), pResults: $("#panelResults"),
  studentPanel: $("#studentPanel"),

  // 빌더
  quizTitle: $("#quizTitle"),
  questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"),
  btnLoadSample: $("#btnLoadSample"),
  btnSaveQuiz: $("#btnSaveQuiz"),
  builder: $("#builder"),
  fileUploadTxt: $("#fileUploadTxt"),
  btnUploadTxt: $("#btnUploadTxt"),
  btnDownloadTemplate: $("#btnDownloadTemplate"),

  // 옵션
  policyDevice: $("#policyDevice"),
  policyName: $("#policyName"),
  chkAccept: $("#chkAccept"),
  chkReveal: $("#chkReveal"),
  chkBright: $("#chkBright"),
  timerSec: $("#timerSec"),
  btnSaveOptions: $("#btnSaveOptions"),
  btnResetOptions: $("#btnResetOptions"),

  // 학생 접속
  qrCanvas: $("#qrCanvas"),
  studentLink: $("#studentLink"),
  btnCopyLink: $("#btnCopyLink"),
  btnOpenStudent: $("#btnOpenStudent"),

  // 프레젠테이션
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  leftSec: $("#leftSec"),
  presentWait: $("#presentWait"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pImg: $("#pImg"), pOpts: $("#pOpts"),

  // 결과
  btnExportCSV: $("#btnExportCSV"), btnResetAll: $("#btnResetAll"),
  resultsTable: $("#resultsTable"),

  // 학생 화면
  studentTopInfo: $("#studentTopInfo"),
  dlgJoin: $("#dlgJoin"), studentName: $("#studentName"),
  btnJoin: $("#btnJoin"), btnJoinCancel: $("#btnJoinCancel"),
  studentQuiz: $("#studentQuiz"), badgeType: $("#badgeType"),
  sQText: $("#sQText"), sQImg: $("#sQImg"),
  mcqBox: $("#mcqBox"), shortBox: $("#shortBox"),
  shortInput: $("#shortInput"), btnShortSend: $("#btnShortSend"),
  studentHint: $("#studentHint"),
};

/***********************
 * Firestore refs
 ***********************/
const roomRef = (id)=>doc(db,"rooms",id);
const respCol = (id)=>collection(db,"rooms",id,"responses");

/***********************
 * Mode / boot
 ***********************/
function setMode(m){
  MODE=m;
  if(m==='student'){
    document.body.classList.remove('mode-admin');
    document.body.classList.add('mode-student');
    els.studentPanel?.classList.remove('hide');
    // 관리자 UI 전부 숨김
    $$(".admin-only").forEach(n=>n.classList.add('hide'));
  }else{
    document.body.classList.remove('mode-student');
    document.body.classList.add('mode-admin');
    els.studentPanel?.classList.add('hide');
    $$(".admin-only").forEach(n=>n.classList.remove('hide'));
    // 첫 화면: 문항 탭
    openTab('build');
  }
}
function openTab(name){
  const map = { build:els.pBuild, options:els.pOptions, present:els.pPresent, results:els.pResults };
  [els.pBuild,els.pOptions,els.pPresent,els.pResults].forEach(p=>p?.classList.add('hide'));
  map[name]?.classList.remove('hide');
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove('active'));
  ({build:els.tabBuild,options:els.tabOptions,present:els.tabPresent,results:els.tabResults}[name])?.classList.add('active');
}

/***********************
 * Connect / listen
 ***********************/
async function connect(){
  const id=(els.roomId?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId=id;

  // 세션 잠금
  els.roomId.disabled=true;
  els.btnConnect.classList.add('hide');
  els.btnSignOut.classList.remove('hide');

  // 방 보장
  const snap=await getDoc(roomRef(roomId));
  if(!snap.exists()){
    await setDoc(roomRef(roomId), { title:'새 세션', mode:'idle', currentIndex:-1, accept:false, reveal:false, bright:false, timer:30, questions:[], createdAt: serverTimestamp() });
  }
  listen();
  buildStudentLink(); // 현재 roomId로 링크/QR 세팅
  els.roomStatus && (els.roomStatus.textContent=`세션: ${roomId} · 온라인`);
}
function signOut(){
  try{
    if(unsubRoom) unsubRoom();
    if(unsubResp) unsubResp();
  }catch{}
  roomId="";
  els.roomId.disabled=false;
  els.btnConnect.classList.remove('hide');
  els.btnSignOut.classList.add('hide');
  els.roomStatus && (els.roomStatus.textContent=`세션: - · 오프라인`);
}
function listen(){
  if(unsubRoom) unsubRoom();
  unsubRoom=onSnapshot(roomRef(roomId),(snap)=>{
    if(!snap.exists()) return;
    const r=snap.data(); window.__room=r;
    renderRoom(r);
  });
  if(unsubResp) unsubResp();
  unsubResp=onSnapshot(respCol(roomId),(qs)=>{
    const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    renderResponses(arr);
  });
}

/***********************
 * Builder
 ***********************/
function buildCard(no,q){
  const wrap=document.createElement('div');
  wrap.className='qcard';
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="radio"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'}> 객관식</label>
      <label class="radio"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''}> 주관식</label>
      <input type="file" class="input" id="img-${no}" accept="image/*" />
    </div>
    <input class="qtext input" placeholder="문항 내용" value="${q?.text||''}">
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" placeholder="보기 ${i+1}" value="${v}">`).join('')}
      </div>
      <div class="row wrap"><span class="muted">정답 번호</span><input class="ansIndex input sm" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}"></div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <input class="ansText input" placeholder="정답(자동채점용, 선택)" value="${q?.answerText||''}">
    </div>
  `;
  const radios=$$(`input[name="type-${no}"]`,wrap);
  const mcq=$(".mcq",wrap), short=$(".short",wrap);
  radios.forEach(r=>r.addEventListener('change',()=>{
    const isShort = radios.find(x=>x.checked)?.value==='short';
    mcq.classList.toggle('hide', isShort);
    short.classList.toggle('hide', !isShort);
  }));
  return wrap;
}
function collectBuilder(){
  const cards=$$("#builder .qcard");
  const list=cards.map((card)=>{
    const type=card.querySelector('input[type=radio]:checked').value;
    const text=card.querySelector('.qtext').value.trim();
    const imgFile=card.querySelector('input[type=file]').files?.[0]||null;
    let imgData=null;
    if(imgFile) imgData=URL.createObjectURL(imgFile); // (간편 미리보기/세션 유지 시 임시 URL)
    if(!text) return null;
    if(type==='mcq'){
      const opts=$$(".opt",card).map(x=>x.value.trim()).filter(Boolean);
      const ans=Math.max(0,Math.min(opts.length-1,(parseInt(card.querySelector('.ansIndex').value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans, image: imgData };
    }else{
      return { type:'short', text, answerText:card.querySelector('.ansText').value.trim(), image: imgData };
    }
  }).filter(Boolean);
  return { title: els.quizTitle?.value||'퀴즈', questions:list };
}

/***********************
 * Options / QR
 ***********************/
function buildStudentLink(){
  if(!roomId || !els.studentLink) return;
  const url=new URL(location.href);
  url.searchParams.set('role','student');
  url.searchParams.set('room', roomId);
  els.studentLink.value = url.toString();
  if(window.QRCode && els.qrCanvas){
    try{
      window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:128 }, ()=>{});
    }catch(e){}
  }
}

/***********************
 * Present + Timer
 ***********************/
async function startQuiz(){ await updateDoc(roomRef(roomId), { mode:'active', currentIndex:0, accept:true }); }
async function step(delta){
  await runTransaction(db, async (tx)=>{
    const snap=await tx.get(roomRef(roomId));
    const r=snap.data(); const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){ // 종료
      tx.update(roomRef(roomId), { currentIndex: total-1, mode:'ended', accept:false });
      openTab('results');
      return;
    }
    next=Math.max(0,next);
    tx.update(roomRef(roomId), { currentIndex: next, accept:true });
  });
}
async function finishAll(){
  if(confirm("퀴즈를 종료할까요?")){
    await updateDoc(roomRef(roomId), { mode:'ended', accept:false });
    openTab('results');
  }
}
function startTimer(sec){
  if(!els.leftSec) return;
  stopTimer();
  const end=Date.now()+sec*1000;
  timerHandle=setInterval(()=> {
    const remain=Math.max(0,Math.floor((end-Date.now())/1000));
    els.leftSec.textContent = `${pad(Math.floor(remain/60))}:${pad(remain%60)}`;
    if(remain<=0) stopTimer();
  },250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } els.leftSec && (els.leftSec.textContent="00:00"); }

/***********************
 * Submit / Grade (학생)
 ***********************/
async function join(){
  if(!roomId) return alert("세션이 없습니다.");
  const name=(els.studentName?.value||"").trim();
  if(!name) return alert("이름/번호를 입력하세요.");
  me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem("quiz.device", me.id);
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{}, alive:true }, { merge:true });
  els.dlgJoin.close();
  els.studentHint.innerHTML = `참가 완료! <b>제출 버튼</b>을 눌러주세요. 교사가 시작하면 1번 문항이 표시됩니다.`;
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

/***********************
 * Render
 ***********************/
function renderRoom(r){
  // 공통 상태
  if(els.roomStatus && MODE==='admin'){
    els.roomStatus.textContent = `세션: ${roomId||'-'} · ${roomId?'온라인':'오프라인'}`;
  }
  if(MODE==='admin'){
    // 옵션 반영
    els.chkAccept && (els.chkAccept.checked=!!r.accept);
    els.chkReveal && (els.chkReveal.checked=!!r.reveal);
    els.chkBright && (els.chkBright.checked=!!r.bright);
  }

  // 프레젠테이션
  if(els.pTitle && els.pQ && els.pOpts){
    const idx=r.currentIndex, q=r.questions?.[idx];
    // 시작 전 / 종료 상태 안내
    if(r.mode!=='active' || !q){
      els.presentWait?.classList.remove('hide');
      els.pTitle.textContent = r.title||roomId||'-';
      els.pQ.textContent     = '-';
      els.pOpts.innerHTML    = '';
      els.pImg?.classList.add('hide');
    }else{
      els.presentWait?.classList.add('hide');
      els.pTitle.textContent = r.title||roomId||'-';
      els.pQ.textContent     = q.text||'-';
      // 이미지가 있을 때만 노출
      if(q.image){ els.pImg.src=q.image; els.pImg.classList.remove('hide'); }
      else{ els.pImg.classList.add('hide'); }
      els.pOpts.innerHTML='';
      if(q.type==='mcq'){
        q.options.forEach((t,i)=>{ const d=document.createElement('div'); d.className='popt'; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d); });
      }
    }
  }

  // 학생 화면
  if(MODE==='student'){
    const idx=r.currentIndex, q=r.questions?.[idx];
    els.studentTopInfo && (els.studentTopInfo.textContent = `세션: ${roomId||'-'} · ${roomId?'온라인':'오프라인'}`);
    if(r.mode!=='active' || !q){
      els.badgeType.textContent='대기';
      els.sQText.textContent='대기 중입니다…';
      els.sQImg.classList.add('hide');
      els.mcqBox.innerHTML='';
      els.shortBox.classList.add('hide');
      return;
    }
    els.badgeType.textContent = q.type==='mcq'?'객관식':'주관식';
    els.sQText.textContent = q.text||'-';
    if(q.image){ els.sQImg.src=q.image; els.sQImg.classList.remove('hide'); } else { els.sQImg.classList.add('hide'); }
    if(q.type==='mcq'){
      els.mcqBox.innerHTML='';
      q.options.forEach((opt,i)=>{
        const b=document.createElement('button');
        b.className='optbtn'; b.textContent=`${i+1}. ${opt}`; b.disabled=!r.accept;
        b.addEventListener('click',()=>$$('.optbtn',els.mcqBox).forEach(btn=>btn.classList.toggle('active',btn===b)));
        els.mcqBox.appendChild(b);
      });
      // 별도 제출 버튼
      if(!$('.s-submit', els.studentQuiz)){
        const sb=document.createElement('div'); sb.className='s-submit';
        const btn=document.createElement('button'); btn.className='btn success'; btn.textContent='제출';
        btn.onclick=()=>{
          const act=[...$$('.optbtn',els.mcqBox)].findIndex(x=>x.classList.contains('active'));
          if(act<0) return alert('보기를 선택하세요');
          submit(act);
        };
        sb.appendChild(btn); els.studentQuiz.appendChild(sb);
      }
      els.shortBox.classList.add('hide');
    }else{
      els.mcqBox.innerHTML='';
      els.shortBox.classList.remove('hide');
      els.btnShortSend.disabled=!r.accept;
    }
  }

  // 결과표(관리자)
  if(MODE==='admin' && els.resultsTable){
    const qList=r.questions||[];
    const tbl=document.createElement('table');
    const thead=document.createElement('thead'), tr=document.createElement('tr');
    ["이름", ...qList.map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{ const th=document.createElement('th'); th.textContent=h; tr.appendChild(th); });
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb=document.createElement('tbody');
    (window.__responsesCache||[]).forEach(s=>{
      let score=0; const tr=document.createElement('tr');
      const tdn=document.createElement('td'); tdn.textContent=s.name||s.id; tr.appendChild(tdn);
      qList.forEach((q,i)=>{
        const a=s.answers?.[i]; const td=document.createElement('td');
        td.textContent = a? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value??'-')) : '-';
        if(a?.correct) score++; tr.appendChild(td);
      });
      const tds=document.createElement('td'); tds.textContent=String(score); tr.appendChild(tds);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.resultsTable.innerHTML=''; els.resultsTable.appendChild(tbl);
  }
}
function renderResponses(list){
  window.__responsesCache = list;
  if(MODE==='admin') renderRoom(window.__room||{});
}

/***********************
 * Events
 ***********************/
els.btnConnect?.addEventListener('click', connect);
els.btnSignOut?.addEventListener('click', signOut);

[els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(btn=>{
  btn?.addEventListener('click',()=> openTab(btn.dataset.tab));
});

els.btnBuildForm?.addEventListener('click', ()=>{
  const n=Math.max(1,Math.min(20, parseInt(els.questionCount?.value,10)||3));
  els.builder.innerHTML=''; for(let i=0;i<n;i++) els.builder.appendChild(buildCard(i+1));
});
els.btnLoadSample?.addEventListener('click', ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)은?', answerText:'100'},
    {type:'mcq', text:'해당 별칭은?', options:['Milky','Solar','Sunset','Lunar'], answerIndex:1}
  ];
  els.builder.innerHTML=''; S.forEach((q,i)=>els.builder.appendChild(buildCard(i+1,q)));
  els.quizTitle.value='샘플 퀴즈'; els.questionCount.value=S.length;
});
els.btnSaveQuiz?.addEventListener('click', async ()=>{
  if(!roomId) return alert('세션 먼저 접속');
  const payload=collectBuilder(); if(!payload.questions.length) return alert('문항 없음');
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert('저장 완료');
});

els.btnSaveOptions?.addEventListener('click', async ()=>{
  if(!roomId) return alert('세션 먼저 접속');
  await setDoc(roomRef(roomId), {
    accept: !!els.chkAccept.checked,
    reveal: !!els.chkReveal.checked,
    bright: !!els.chkBright.checked,
    timer: Math.max(5,Math.min(600, parseInt(els.timerSec.value,10)||30))
  }, { merge:true });
  buildStudentLink(); // 즉시 QR/링크 갱신
  alert('저장 완료');
});
els.btnResetOptions?.addEventListener('click', async ()=>{
  if(!roomId) return;
  await setDoc(roomRef(roomId), { accept:false, reveal:false, bright:false, timer:30 }, { merge:true });
  els.chkAccept.checked=false; els.chkReveal.checked=false; els.chkBright.checked=false; els.timerSec.value=30;
  buildStudentLink();
});

els.btnCopyLink?.addEventListener('click', async ()=>{
  if(!els.studentLink?.value) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent='복사됨'; setTimeout(()=> els.btnCopyLink.textContent='복사', 1000);
});
els.btnOpenStudent?.addEventListener('click', ()=> window.open(els.studentLink?.value||'#','_blank'));

els.btnStart?.addEventListener('click', startQuiz);
els.btnPrev?.addEventListener('click', ()=>step(-1));
els.btnNext?.addEventListener('click', ()=>step(+1));
els.btnEndAll?.addEventListener('click', finishAll);

els.btnExportCSV?.addEventListener('click', async ()=>{
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
els.btnResetAll?.addEventListener('click', async ()=>{
  if(!roomId) return;
  if(!confirm("모든 응답/점수를 초기화할까요?")) return;
  await setDoc(roomRef(roomId), { mode:'idle', currentIndex:-1, accept:false, reveal:false }, { merge:true });
  const snap=await getDocs(respCol(roomId)); const tasks=[];
  snap.forEach(d=> tasks.push(setDoc(doc(respCol(roomId), d.id), { answers:{}, alive:true }, { merge:true })));
  await Promise.all(tasks);
  alert("초기화 완료");
});

// 학생 참가/제출
els.btnJoin?.addEventListener('click', join);
els.btnJoinCancel?.addEventListener('click', ()=> els.dlgJoin.close());
els.btnShortSend?.addEventListener('click', ()=> submit((els.shortInput?.value||"").trim()));

/***********************
 * URL 진입 처리
 ***********************/
(function boot(){
  const url=new URL(location.href);
  const role=url.searchParams.get('role');
  const rid =url.searchParams.get('room');

  if(role==='student'){
    setMode('student');
    if(rid){ roomId=rid; els.studentTopInfo.textContent=`세션: ${roomId} · 온라인`; listen(); }
    // 참가 팝업 자동 오픈
    try{ els.dlgJoin.showModal(); }catch{ els.dlgJoin.classList.remove('hide'); }
  }else{
    setMode('admin'); // 첫 화면은 문항
    if(rid){ els.roomId.value=rid; connect(); }
  }
})();
