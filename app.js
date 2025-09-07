/***********************
 * Firestore imports (window.db는 index.html에서 초기화)
 ***********************/
import {
  doc, setDoc, getDoc, onSnapshot, updateDoc,
  collection, getDocs, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/***********************
 * Helpers & State
 ***********************/
const $  = (s, el=document)=>el.querySelector(s);
const $$ = (s, el=document)=>Array.from(el.querySelectorAll(s));
const pad = (n)=>String(n).padStart(2,'0');

let MODE   = "admin";   // 'admin' | 'student'
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let selectedMCQ = null;

const els = {
  // 상단(관리자)
  liveDot: $("#liveDot"),
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnSignOut: $("#btnSignOut"), roomStatus: $("#roomStatus"),
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"), pOptions: $("#panelOptions"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),

  // 문항
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"),
  fileUploadTxt: $("#fileUploadTxt"), btnUploadTxt: $("#btnUploadTxt"), btnDownloadTemplate: $("#btnDownloadTemplate"),
  builder: $("#builder"),

  // 옵션
  policyDevice: $("#policyDevice"), policyName: $("#policyName"),
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright: $("#chkBright"),
  timerSec: $("#timerSec"), btnSaveOptions: $("#btnSaveOptions"),
  studentAccess: $("#studentAccess"),
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"),
  btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

  // 프레젠테이션
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  leftSec: $("#leftSec"), presentWait: $("#presentWait"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pImg: $("#pImg"), pOpts: $("#pOpts"),
  statJoin: $("#statJoin"), statSubmit: $("#statSubmit"), statCorrect: $("#statCorrect"), statWrong: $("#statWrong"),

  // 결과
  btnExportCSV: $("#btnExportCSV"), btnResetAll: $("#btnResetAll"), resultsTable: $("#resultsTable"),

  // 학생
  studentPanel: $("#studentPanel"),
  studentTopInfo: $("#studentTopInfo"),
  studentJoin: $("#studentJoin"), studentName: $("#studentName"), btnJoin: $("#btnJoin"),
  studentQuiz: $("#studentQuiz"), badgeType: $("#badgeType"),
  sImg: $("#sImg"), sQText: $("#sQText"), mcqBox: $("#mcqBox"), btnSubmitMCQ: $("#btnSubmitMCQ"),
  shortBox: $("#shortBox"), shortInput: $("#shortInput"), btnShortSend: $("#btnShortSend"),
  studentTimer: $("#studentTimer"), studentDone: $("#studentDone"),
  studentResult: $("#studentResult"), studentResultBody: $("#studentResultBody"),
};

// 안전 가드: 누락된 요소 콘솔 경고
Object.entries(els).forEach(([k,v])=>{ if(!v) console.warn("[warn] missing:", k); });

/***********************
 * Local cache
 ***********************/
function saveLocal(){ localStorage.setItem("quiz.live", JSON.stringify({ MODE, roomId, me })); }
function loadLocal(){
  try{
    const d=JSON.parse(localStorage.getItem("quiz.live")||"{}");
    MODE=d.MODE||"admin"; roomId=d.roomId||""; me=d.me||{id:null,name:""};
    if(els.roomId && roomId) els.roomId.value=roomId;
  }catch{}
}

/***********************
 * Firestore refs
 ***********************/
const roomRef = (id)=>doc(window.db,"rooms",id);
const respCol = (id)=>collection(window.db,"rooms",id,"responses");

async function ensureRoom(id){
  if(!id) return;
  const snap=await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션", mode:"idle", currentIndex:-1,
      accept:false, reveal:false, policy:"device", bright:false, timerSec:30,
      createdAt: serverTimestamp(), questions:[]
    });
  }
}

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

/***********************
 * UI 모드/탭
 ***********************/
function setAdminUI(on){
  // 관리자 영역 표시/학생 숨김
  document.querySelector("header.topbar")?.classList.toggle("admin-only", !on);
  document.querySelector("header.topbar")?.classList.toggle("hide", !on);
  if(els.studentPanel) els.studentPanel.classList.toggle("hide", on);
}
function switchTab(which){
  const map={ build:els.pBuild, options:els.pOptions, present:els.pPresent, results:els.pResults };
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
  els.tabBuild?.classList.toggle("active", which==='build');
  els.tabOptions?.classList.toggle("active", which==='options');
  els.tabPresent?.classList.toggle("active", which==='present');
  els.tabResults?.classList.toggle("active", which==='results');
  Object.values(map).forEach(p=>p?.classList.add("hide"));
  map[which]?.classList.remove("hide");

  // 옵션 탭에서만 학생 접속(링크/QR) 카드 표시
  const showAccess = (which==='options');
  els.studentAccess?.setAttribute('aria-hidden', showAccess? 'false':'true');
  els.studentAccess?.classList.toggle('hide', !showAccess);
  if(showAccess) buildStudentLink(true);
}

/***********************
 * 접속/세션아웃 (잠금)
 ***********************/
async function connect(){
  const id=(els.roomId?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId=id; await ensureRoom(roomId);
  listenRoom(roomId); listenResponses(roomId);
  if(els.liveDot) els.liveDot.style.background='#ef4444';
  if(els.roomStatus) els.roomStatus.textContent=`세션: ${roomId} · 온라인`;
  // 잠금
  els.roomId.disabled=true;
  els.btnConnect.classList.add('hide');
  els.btnSignOut.classList.remove('hide');
  buildStudentLink(true);
  saveLocal();
}
function signOutSession(){
  // 해제
  els.roomId.disabled=false;
  els.btnConnect.classList.remove('hide');
  els.btnSignOut.classList.add('hide');
  if(els.roomStatus) els.roomStatus.textContent=`세션: - · 오프라인`;
  if(els.liveDot) els.liveDot.style.background='#444';
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  window.__room=null; roomId=""; saveLocal();
}

/***********************
 * 빌더 (문항/이미지/업로드)
 ***********************/
function cardRow(no,q){
  const wrap=document.createElement('div');
  wrap.className='qcard';
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'}> 객관식</label>
      <label class="switch"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''}> 주관식</label>
      <button class="img-btn right" type="button">이미지</button>
      <input type="file" class="img-file hide" accept="image/*">
      <img class="qthumb ${q?.image?'':'hide'}" src="${q?.image||''}" alt="미리보기">
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항: 내용을 입력하세요" value="${q?.text||''}" />
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`
          <input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기${i+1}: 입력란" value="${v}">
        `).join('')}
      </div>
      <div class="row wrap">
        <span class="muted">정답 번호</span>
        <input class="ansIndex input sm" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
      </div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <input class="ansText input" data-no="${no}" placeholder="정답(선택, 자동채점용)" value="${q?.answerText||''}">
    </div>
  `;
  const radios=$$(`input[name="type-${no}"]`,wrap);
  const mcq=$('.mcq',wrap), short=$('.short',wrap);
  radios.forEach(r=> r.addEventListener('change', ()=>{
    const isShort = radios.find(x=>x.checked)?.value==='short';
    mcq.classList.toggle('hide', isShort);
    short.classList.toggle('hide', !isShort);
  }));
  // 이미지 버튼
  const btnImg=$('.img-btn',wrap), file=$('.img-file',wrap), thumb=$('.qthumb',wrap);
  btnImg?.addEventListener('click', ()=> file?.click());
  file?.addEventListener('change', async (e)=>{
    const f=e.target.files?.[0]; if(!f) return;
    const url=await fileToDataURL(f);
    thumb.src=url; thumb.classList.remove('hide');
    wrap.dataset.image=url;
  });
  return wrap;
}
function collectBuilder(){
  const cards=$$('#builder>.qcard');
  const qs=cards.map((c,idx)=>{
    const no=idx+1;
    const type=c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text=c.querySelector('.qtext').value.trim();
    const image=c.dataset.image || c.querySelector('.qthumb')?.getAttribute('src') || '';
    if(!text) return null;
    if(type==='mcq'){
      const opts=$$('.opt',c).map(x=>x.value.trim()).filter(Boolean);
      const ans=Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector('.ansIndex').value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans, image };
    } else {
      const answerText=c.querySelector('.ansText').value.trim();
      return { type:'short', text, answerText, image };
    }
  }).filter(Boolean);
  return { title: els.quizTitle?.value||"퀴즈", questions: qs };
}
function parseTxtCSV(text){
  // 매우 단순 파서: 줄별 CSV (쉼표 기준)
  return text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(line=>line.split(','));
}
const fileToDataURL = (file)=> new Promise(res=>{
  const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(file);
});

/***********************
 * 옵션 저장 + 링크/QR
 ***********************/
async function saveOptions(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const policy = els.policyName?.checked ? 'name' : 'device';
  const bright = !!els.chkBright?.checked;
  const timer  = Math.max(5, Math.min(600, parseInt(els.timerSec?.value,10)||30));
  await setDoc(roomRef(roomId), {
    policy, bright, timerSec:timer,
    accept: !!els.chkAccept?.checked, reveal: !!els.chkReveal?.checked
  }, { merge:true });
  buildStudentLink(true); // 저장 직후 갱신
  alert("옵션을 저장했습니다.");
}
function buildStudentLink(forceShow=false){
  if(!roomId || !els.studentLink) return;
  const url=new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", roomId);
  els.studentLink.value=url.toString();

  // 옵션 탭에서만 노출
  const isOptionsVisible = !els.pOptions?.classList.contains('hide');
  els.studentAccess?.setAttribute('aria-hidden', isOptionsVisible? 'false':'true');
  els.studentAccess?.classList.toggle('hide', !isOptionsVisible && !forceShow);

  if(window.QRCode && els.qrCanvas){
    try{ window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:120 }); }catch(e){ console.warn(e); }
  }
}

/***********************
 * 진행 제어
 ***********************/
async function startQuiz(){
  if(!roomId) return alert("세션 먼저 접속!");
  await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true });
}
async function step(delta){
  await runTransaction(window.db, async (tx)=>{
    const ref=roomRef(roomId);
    const snap=await tx.get(ref); const r=snap.data();
    const total=(r.questions?.length||0);
    let n=(r.currentIndex ?? -1) + delta;
    if(n>=total){
      tx.update(ref,{ mode:"ended", accept:false, currentIndex: Math.max(0,total-1) });
      return;
    }
    n=Math.max(0,n);
    tx.update(ref,{ currentIndex:n, accept:true });
  });
}
async function endAll(){
  if(!roomId) return;
  await updateDoc(roomRef(roomId), { mode:"ended", accept:false });
}

/***********************
 * 제출/참가
 ***********************/
async function join(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name=(els.studentName?.value||"").trim();
  if(!name) return alert("이름(번호)을 입력하세요!");
  me={ id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem("quiz.device", me.id);
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{} }, { merge:true });
  // 대기 화면
  els.studentJoin?.classList.add('hide');
  els.studentQuiz?.classList.remove('hide');
  if(els.sQText) els.sQText.textContent="제출 버튼을 눌러주세요.";
  renderStudentTop(); saveLocal();
}
function renderStudentTop(){
  if(els.studentTopInfo) els.studentTopInfo.textContent=`세션: ${roomId||'-'} · ${roomId?'온라인':'오프라인'} · ${me?.name||''}`;
}
async function submitMCQ(){
  const r=window.__room; if(!r?.accept) return alert("현재 제출 시간이 아닙니다.");
  if(selectedMCQ==null) return alert("보기를 선택하세요.");
  await submitAnswer(selectedMCQ);
}
async function submitShort(){
  const r=window.__room; if(!r?.accept) return alert("현재 제출 시간이 아닙니다.");
  const val=(els.shortInput?.value||"").trim(); if(!val) return alert("정답을 입력하세요.");
  await submitAnswer(val);
}
async function submitAnswer(value){
  const r=window.__room; if(!r) return;
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;

  // 정책에 따른 중복 방지(기본: 기기 id)
  const uid = (r.policy==='name' ? (me.name||me.id) : me.id);
  const ref = doc(respCol(roomId), uid);
  const snap=await getDoc(ref); const prev=snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert("이미 제출했습니다.");

  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]:{ value, correct:(correct===true) } }, { merge:true });

  // UX 토스트
  els.studentDone?.classList.remove('hide');
  setTimeout(()=> els.studentDone?.classList.add('hide'), 1000);
}

/***********************
 * 렌더링
 ***********************/
function renderRoom(r){
  // 상단 상태
  if(els.roomStatus) els.roomStatus.textContent=`세션: ${roomId||'-'} · ${roomId?'온라인':'오프라인'}`;
  if(els.liveDot) els.liveDot.style.background = roomId ? '#ef4444' : '#444';

  // 옵션 값 폼에 반영
  if(els.policyDevice && els.policyName){ els.policyDevice.checked=(r.policy!=='name'); els.policyName.checked=(r.policy==='name'); }
  if(els.chkBright) els.chkBright.checked=!!r.bright;
  if(els.timerSec) els.timerSec.value = r.timerSec ?? 30;
  if(els.chkAccept) els.chkAccept.checked=!!r.accept;
  if(els.chkReveal) els.chkReveal.checked=!!r.reveal;

  // 프레젠테이션 대기/문항
  const idx=r.currentIndex, total=r.questions?.length||0;
  const hasQ = (r.mode==='active' && idx>=0 && r.questions[idx]);
  els.presentWait?.classList.toggle('hide', !!hasQ);
  if(els.pTitle) els.pTitle.textContent = r.title || roomId || '-';
  if(hasQ){
    const q=r.questions[idx];
    if(els.pQ) els.pQ.textContent=q.text;
    if(els.pImg){ if(q.image){ els.pImg.src=q.image; els.pImg.classList.remove('hide'); } else { els.pImg.classList.add('hide'); } }
    if(els.pOpts){
      els.pOpts.innerHTML="";
      if(q.type==='mcq'){
        q.options.forEach((t,i)=>{ const d=document.createElement('div'); d.className='popt'; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d); });
      }
    }
  }else{
    if(els.pQ) els.pQ.textContent='-';
    els.pOpts && (els.pOpts.innerHTML="");
    els.pImg && els.pImg.classList.add('hide');
  }
  // 마지막 문제 다음 -> 결과 탭 자동 이동
  if(r.mode==='ended'){ switchTab('results'); }

  // 학생 화면
  if(MODE==='student'){
    if(!r || r.mode!=='active' || idx<0 || !r.questions[idx]){
      els.badgeType && (els.badgeType.textContent="대기");
      els.sQText && (els.sQText.textContent="제출 버튼을 눌러주세요.");
      els.mcqBox && (els.mcqBox.innerHTML="");
      els.shortBox && els.shortBox.classList.add('hide');
      els.studentTimer && (els.studentTimer.textContent = "");
    }else{
      const q=r.questions[idx];
      els.badgeType && (els.badgeType.textContent = q.type==='mcq'?'객관식':'주관식');
      els.sQText && (els.sQText.textContent = q.text);
      if(els.sImg){ if(q.image){ els.sImg.src=q.image; els.sImg.classList.remove('hide'); } else { els.sImg.classList.add('hide'); } }

      if(q.type==='mcq'){
        selectedMCQ=null;
        els.mcqBox.innerHTML="";
        q.options.forEach((opt,i)=>{
          const b=document.createElement('button');
          b.className='optbtn'; b.textContent=`${i+1}. ${opt}`; b.disabled=!r.accept;
          b.addEventListener('click', ()=>{
            selectedMCQ=i;
            $$('.optbtn', els.mcqBox).forEach(x=>x.classList.remove('active'));
            b.classList.add('active');
          });
          els.mcqBox.appendChild(b);
        });
        els.shortBox.classList.add('hide');
        els.btnSubmitMCQ.disabled = !r.accept;
      }else{
        els.mcqBox.innerHTML="";
        els.shortBox.classList.remove('hide');
        els.btnShortSend.disabled = !r.accept;
      }
      // 타이머 표시(옵션)
      els.studentTimer && (els.studentTimer.textContent = r.timerSec ? `남은 시간: ${r.timerSec}s` : "");
    }
  }
}

function renderResponses(list){
  const r=window.__room||{}; const idx=r.currentIndex; const q=r.questions?.[idx];

  // 통계(프레젠테이션 하단)
  if(els.statJoin && els.statSubmit && els.statCorrect && els.statWrong){
    const joined = list.length;
    let submitted=0, correct=0, wrong=0;
    list.forEach(s=>{
      const a=s.answers?.[idx];
      if(a){ submitted++; if(a.correct) correct++; else wrong++; }
    });
    els.statJoin.textContent = `참가 ${joined}`;
    els.statSubmit.textContent= `제출 ${submitted}`;
    els.statCorrect.textContent=`정답 ${correct}`;
    els.statWrong.textContent  =`오답 ${wrong}`;
  }

  // 결과표(관리자)
  if(els.resultsTable){
    const tbl=document.createElement('table');
    const thead=document.createElement('thead'), tr=document.createElement('tr');
    ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{ const th=document.createElement('th'); th.textContent=h; tr.appendChild(th); });
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb=document.createElement('tbody');

    // 점수 계산 후 정렬(리더보드)
    const rows=list.map(s=>{
      let score=0; const cols=[];
      (r.questions||[]).forEach((q,i)=>{
        const a=s.answers?.[i]; let cell='-';
        if(a){
          if(q.type==='mcq'){ cell = (typeof a.value==='number')? (a.value+1) : '-'; }
          else { cell = (a.value ?? '-'); }
          if(a.correct) score++;
        }
        cols.push(cell);
      });
      return { name:s.name||s.id, score, cols };
    }).sort((a,b)=>b.score-a.score || a.name.localeCompare(b.name));

    rows.forEach(row=>{
      const tr=document.createElement('tr');
      const tdN=document.createElement('td'); tdN.textContent=row.name; tr.appendChild(tdN);
      row.cols.forEach(c=>{ const td=document.createElement('td'); td.textContent=c; tr.appendChild(td); });
      const tdS=document.createElement('td'); tdS.textContent=String(row.score); tr.appendChild(tdS);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
  }

  // 학생 개인 결과(종료 시)
  if(MODE==='student' && window.__room?.mode==='ended'){
    const mine=list.find(s=> (s.id===me.id) || (s.name===me.name));
    if(mine){
      els.studentQuiz?.classList.add('hide');
      els.studentResult?.classList.remove('hide');
      const r=window.__room; let score=0;
      const html = (r.questions||[]).map((q,i)=>{
        const a=mine.answers?.[i];
        const mark = a ? (a.correct ? 'O' : 'X') : '-';
        if(a?.correct) score++;
        const val = a ? (q.type==='mcq' ? (typeof a.value==='number'? (a.value+1) : '-') : (a.value||'-')) : '-';
        return `<tr><td>Q${i+1}</td><td>${val}</td><td>${mark}</td></tr>`;
      }).join('');
      els.studentResultBody.innerHTML = `
        <p><strong>${me.name}</strong>님의 총점: <strong>${score}</strong></p>
        <table class="table"><thead><tr><th>문항</th><th>내 답</th><th>정오</th></tr></thead>
        <tbody>${html}</tbody></table>`;
    }
  }
}

/***********************
 * CSV/초기화
 ***********************/
els.btnExportCSV?.addEventListener("click", async ()=>{
  const r=(await getDoc(roomRef(roomId))).data();
  const snap=await getDocs(respCol(roomId));
  const header=['userId','name',...(r.questions||[]).map((_,i)=>`Q${i+1}`),'score'];
  const rows=[header.join(',')];
  snap.forEach(d=>{
    const s=d.data(); let score=0;
    const answers=(r.questions||[]).map((q,i)=>{ const a=s.answers?.[i]; if(a?.correct) score++; return q.type==='mcq' ? (typeof a?.value==='number'? a.value+1 : "") : (a?.value??""); });
    rows.push([d.id, `"${(s.name||"").replace(/"/g,'""')}"`, ...answers, score].join(','));
  });
  const blob=new Blob([rows.join("\n")],{type:"text/csv"});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`${r.title||roomId}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
});
els.btnResetAll?.addEventListener("click", async ()=>{
  if(!roomId) return; if(!confirm("모든 응답/점수를 초기화할까요?")) return;
  await setDoc(roomRef(roomId), { mode:"idle", currentIndex:-1, accept:false }, { merge:true });
  const snap=await getDocs(respCol(roomId));
  const tasks=[]; snap.forEach(d=> tasks.push(setDoc(doc(respCol(roomId), d.id), { answers:{} }, { merge:true })));
  await Promise.all(tasks); alert("초기화 완료");
});

/***********************
 * 이벤트 바인딩
 ***********************/
els.btnConnect?.addEventListener("click", connect);
els.btnSignOut?.addEventListener("click", signOutSession);

// 탭
els.tabBuild?.addEventListener("click", ()=>switchTab('build'));
els.tabOptions?.addEventListener("click", ()=>switchTab('options'));
els.tabPresent?.addEventListener("click", ()=>switchTab('present'));
els.tabResults?.addEventListener("click", ()=>switchTab('results'));

// 문항 생성/샘플/저장
els.btnBuildForm?.addEventListener("click", ()=>{
  const n=Math.max(1,Math.min(50, parseInt(els.questionCount?.value,10)||3));
  els.builder.innerHTML=""; for(let i=0;i<n;i++) els.builder.appendChild(cardRow(i+1));
});
els.btnLoadSample?.addEventListener("click", ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
    {type:'mcq', text:'오로라가 잘 보이는 곳은?', options:['적도','중위도','극지방','사막'], answerIndex:2},
  ];
  els.builder.innerHTML=""; S.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q)));
  els.quizTitle.value="샘플 퀴즈"; els.questionCount.value=S.length;
});
els.btnSaveQuiz?.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const payload=collectBuilder(); if(!payload.questions.length) return alert("문항을 추가하세요.");
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("저장 완료");
});

// TXT/CSV 업로드 & 샘플양식
els.btnUploadTxt?.addEventListener("click", ()=> els.fileUploadTxt?.click());
els.fileUploadTxt?.addEventListener("change", async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const rows=parseTxtCSV(await f.text()); const qs=[];
  rows.forEach(cols=>{
    if(cols.length>=6){ // 객관식
      const [text,o1,o2,o3,o4,ans]=cols;
      qs.push({ type:'mcq', text, options:[o1,o2,o3,o4].filter(Boolean), answerIndex: Math.max(0,Math.min(3,(parseInt(ans,10)||1)-1)) });
    }else if(cols.length>=3 && cols[1]==='주관식'){
      const [text,_s,ansText]=cols;
      qs.push({ type:'short', text, answerText: ansText||'' });
    }
  });
  if(!qs.length) return alert("유효한 항목이 없습니다.");
  els.builder.innerHTML=""; qs.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q)));
  els.questionCount.value=qs.length;
  e.target.value="";
});
els.btnDownloadTemplate?.addEventListener("click", ()=>{
  const sample = [
    "가장 큰 행성?,지구,목성,화성,금성,2",
    "물의 끓는점(°C)?,주관식,100"
  ].join("\n");
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([sample],{type:"text/plain"}));
  a.download="quiz-template.txt"; a.click(); URL.revokeObjectURL(a.href);
});

// 옵션 저장 & 학생 접속
els.btnSaveOptions?.addEventListener("click", saveOptions);
els.btnCopyLink?.addEventListener("click", async ()=>{
  if(!els.studentLink?.value) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="복사", 1200);
});
els.btnOpenStudent?.addEventListener("click", ()=> window.open(els.studentLink?.value || "#", "_blank"));

// 진행
els.btnStart?.addEventListener("click", startQuiz);
els.btnPrev ?.addEventListener("click", ()=>step(-1));
els.btnNext ?.addEventListener("click", ()=>step(+1));
els.btnEndAll?.addEventListener("click", endAll);

// 학생
els.btnJoin      ?.addEventListener("click", join);
els.btnSubmitMCQ ?.addEventListener("click", submitMCQ);
els.btnShortSend ?.addEventListener("click", submitShort);

/***********************
 * 부트스트랩: 기본은 관리자 모드, 쿼리로 학생 진입
 ***********************/
(function boot(){
  loadLocal();
  const url=new URL(location.href);
  const role=url.searchParams.get("role"); const rid=url.searchParams.get("room");
  if(role==='student'){
    MODE='student'; if(rid) roomId=rid;
    setAdminUI(false); // 상단 메뉴 숨김
    // 학생 흐름: 이름 입력 → 참가 → 대기 → 교사 시작 시 표시
    els.studentPanel?.classList.remove('hide');
    els.studentJoin?.classList.remove('hide');
    els.studentQuiz?.classList.add('hide');
    els.studentResult?.classList.add('hide');
    if(roomId) connect().catch(()=>{});
  }else{
    MODE='admin';
    setAdminUI(true);        // 상단 메뉴 항상 보임
    switchTab('build');      // 첫 진입은 문항 탭
    if(roomId) connect().catch(()=>{});
  }
})();
