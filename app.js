/***********************
 * Firebase helpers (window.db는 index.html에서 주입)
 ***********************/
import {
  doc, setDoc, getDoc, onSnapshot, updateDoc,
  collection, getDocs, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/***********************
 * QS & State
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
  // 헤더/세션
  liveDot: $("#liveDot"),
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnSignOut: $("#btnSignOut"), roomStatus: $("#roomStatus"),
  // 탭
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"), pOptions: $("#panelOptions"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),
  // 문항
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"),
  builder: $("#builder"), fileUploadTxt: $("#fileUploadTxt"), btnUploadTxt: $("#btnUploadTxt"), btnDownloadTemplate: $("#btnDownloadTemplate"),
  // 옵션
  policyDevice: $("#policyDevice"), policyName: $("#policyName"),
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright: $("#chkBright"),
  timerSec: $("#timerSec"), btnSaveOptions: $("#btnSaveOptions"),
  studentAccess: $("#studentAccess"), qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"),
  btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),
  // 프레젠테이션
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  leftSec: $("#leftSec"),
  presentWait: $("#presentWait"), pTitle: $("#pTitle"), pQ: $("#pQ"), pImg: $("#pImg"), pOpts: $("#pOpts"),
  statJoin: $("#statJoin"), statSubmit: $("#statSubmit"), statCorrect: $("#statCorrect"), statWrong: $("#statWrong"),
  // 결과
  btnExportCSV: $("#btnExportCSV"), btnResetAll: $("#btnResetAll"), resultsTable: $("#resultsTable"),
  // 학생
  studentPanel: $("#studentPanel"), studentTopInfo: $("#studentTopInfo"),
  studentJoin: $("#studentJoin"), studentName: $("#studentName"), btnJoin: $("#btnJoin"),
  studentQuiz: $("#studentQuiz"), sImg: $("#sImg"), sQText: $("#sQText"), badgeType: $("#badgeType"),
  mcqBox: $("#mcqBox"), btnSubmitMCQ: $("#btnSubmitMCQ"),
  shortBox: $("#shortBox"), shortInput: $("#shortInput"), btnShortSend: $("#btnShortSend"),
  studentDone: $("#studentDone"), studentResult: $("#studentResult"), studentResultBody: $("#studentResultBody"),
  studentTimer: $("#studentTimer"),
};

/***********************
 * Local cache
 ***********************/
function saveLocal(){ localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me })); }
function loadLocal(){
  try{
    const d=JSON.parse(localStorage.getItem("quiz.live")||"{}");
    roomId=d.roomId||""; MODE=d.MODE||"admin"; me=d.me||{id:null,name:""};
    if(roomId && els.roomId) els.roomId.value=roomId;
  }catch{}
}

/***********************
 * Firestore refs
 ***********************/
const roomRef = (id)=>doc(window.db,"rooms",id);
const respCol = (id)=>collection(window.db,"rooms",id,"responses");

async function ensureRoom(id){
  const snap=await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false,
      policy:"device", bright:false, timer:30,
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
    window.__responses=arr; renderResponses(arr);
  });
}

/***********************
 * Mode & Tabs
 ***********************/
function setMode(m){
  MODE=m;
  // 학생 모드: 상단 탭/세션 박스는 CSS로 숨김 (markup 자체는 admin-only)
  const isAdmin = (m==='admin');
  document.querySelectorAll('.admin-only').forEach(el=> el.classList.toggle('hide', !isAdmin));
  // 패널: 기본은 문항
  showPanel(isAdmin ? 'build' : null);
  saveLocal();
}
function showPanel(name){
  const map = {build:els.pBuild, options:els.pOptions, present:els.pPresent, results:els.pResults};
  Object.values(map).forEach(p=>p && p.classList.add('hide'));
  if(name && map[name]) map[name].classList.remove('hide');
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(t=> t?.classList.remove('active'));
  if(name==='build')   els.tabBuild?.classList.add('active');
  if(name==='options') els.tabOptions?.classList.add('active');
  if(name==='present') els.tabPresent?.classList.add('active');
  if(name==='results') els.tabResults?.classList.add('active');

  // 학생 접속 박스는 옵션 탭에서만 노출
  if(els.studentAccess) els.studentAccess.setAttribute('aria-hidden', name!=='options' ? 'true':'false');
}

/***********************
 * Connect / Lock
 ***********************/
async function connect(){
  const id=(els.roomId?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId=id; await ensureRoom(roomId);
  listenRoom(roomId); listenResponses(roomId);
  updateLockUI(true);
  buildStudentLink(); // 초기 1회 생성(옵션 저장 시에도 갱신)
  if(els.roomStatus) els.roomStatus.textContent=`세션: ${roomId} · 온라인`;
  if(els.liveDot) els.liveDot.style.background = '#f33';
  saveLocal();
}
function signOut(){
  updateLockUI(false);
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  roomId=""; if(els.roomId) els.roomId.value="";
  if(els.roomStatus) els.roomStatus.textContent=`세션: - · 오프라인`;
  if(els.liveDot) els.liveDot.style.background = '#444';
  // 학생 화면도 안전하게 대기로
  renderStudentWait();
  saveLocal();
}
function updateLockUI(locked){
  if(!els.roomId || !els.btnConnect || !els.btnSignOut) return;
  els.roomId.disabled = !!locked;
  els.btnConnect.classList.toggle('hide', !!locked);
  els.btnSignOut.classList.toggle('hide', !locked);
}

/***********************
 * Builder
 ***********************/
function cardRow(no,q){
  const wrap=document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="radio"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'} /> 객관식</label>
      <label class="radio"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''} /> 주관식</label>
      <label class="btn ghost right"><input type="file" accept="image/*" data-role="img" data-no="${no}" style="display:none" /> 이미지</label>
      ${q?.img ? `<img src="${q.img}" class="qthumb" alt="thumb">` : ``}
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항" value="${q?.text||''}" />
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기${i+1}" value="${v}">`).join('')}
      </div>
      <div class="row">
        <span class="muted">정답 번호</span>
        <input class="ansIndex input sm" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
      </div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <input class="ansText input" data-no="${no}" placeholder="정답(선택, 자동채점용)" value="${q?.answerText||''}">
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
  const imgInput=$('input[data-role="img"]',wrap);
  imgInput?.addEventListener('change', async (e)=>{
    const file=e.target.files?.[0]; if(!file) return;
    const url=URL.createObjectURL(file);
    const prev=wrap.querySelector('.qthumb'); if(prev) prev.remove();
    const img=document.createElement('img'); img.src=url; img.className='qthumb'; img.alt='thumb';
    imgInput.closest('.row')?.appendChild(img);
    imgInput.dataset.src = url; // 저장 시 함께 수집
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
    const imgIn=c.querySelector('input[data-role="img"]');
    const imgSrc=imgIn?.dataset?.src || (c.querySelector('.qthumb')?.src||'');
    if(type==='mcq'){
      const opts=$$(".opt",c).map(i=>i.value.trim()).filter(Boolean);
      const ans = Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans, img:imgSrc };
    } else {
      return { type:'short', text, answerText:c.querySelector(".ansText").value.trim(), img:imgSrc };
    }
  }).filter(Boolean);
  return { title: els.quizTitle?.value||"퀴즈", questions:list };
}

/***********************
 * Flow + Timer
 ***********************/
async function startQuiz(){
  if(!roomId) return alert('세션이 없습니다.');
  await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true });
}
async function step(delta){
  await runTransaction(window.db, async (tx)=>{
    const ref=roomRef(roomId);
    const snap=await tx.get(ref);
    const r=snap.data(); const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){ // 끝 -> 결과 탭으로
      tx.update(ref, { currentIndex: Math.max(0,total-1), mode:"ended", accept:false });
      // 결과 탭 노출은 렌더 쪽에서 처리
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

function startTimer(sec){
  stopTimer();
  const end = Date.now()+sec*1000;
  timerHandle=setInterval(async ()=>{
    const remain=Math.max(0, Math.floor((end-Date.now())/1000));
    els.leftSec && (els.leftSec.textContent = `${pad(Math.floor(remain/60))}:${pad(remain%60)}`);
    els.studentTimer && (els.studentTimer.textContent = els.leftSec?.textContent || "");
    if(remain<=0){
      stopTimer();
      await updateDoc(roomRef(roomId), { accept:false });
      setTimeout(()=> step(+1), 500);
    }
  }, 250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } if(els.leftSec) els.leftSec.textContent="00:00"; if(els.studentTimer) els.studentTimer.textContent=""; }

/***********************
 * Submit / Grade
 ***********************/
async function join(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name=(els.studentName?.value||"").trim(); if(!name) return alert("이름 또는 번호를 입력하세요!");
  me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem("quiz.device", me.id);
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{}, alive:true }, { merge:true });
  // 참가 후 대기 문구
  els.studentJoin?.classList.add('hide');
  els.studentQuiz?.classList.remove('hide');
  els.sQText && (els.sQText.textContent = "제출 버튼을 눌러주세요."); // 요구 반영
  saveLocal();
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
  // 학생 측 피드백
  els.studentDone?.classList.remove('hide');
  setTimeout(()=> els.studentDone?.classList.add('hide'), 1200);
}

/***********************
 * Render
 ***********************/
function renderRoom(r){
  const total=r.questions?.length||0; const idx=r.currentIndex;

  // 세션 상태
  if(els.roomStatus) els.roomStatus.textContent = roomId ? `세션: ${roomId} · 온라인` : `세션: - · 오프라인`;

  // 옵션 반영 → 밝은 모드면 보드 테마 밝게 (간단 처리: 배경 유지, 콘텐츠 강조)
  if(els.pPresent) els.pPresent.classList.toggle('bright', !!r.bright);

  // 프레젠테이션
  if(els.presentWait) els.presentWait.classList.toggle('hide', !(r.mode!=='active' || idx<0));
  if(els.pTitle) els.pTitle.textContent = r.title||roomId||'-';
  if(idx>=0 && r.questions[idx]){
    const q=r.questions[idx];
    if(els.pQ)   els.pQ.textContent=q.text||'-';
    if(els.pImg){
      if(q.img){ els.pImg.src=q.img; els.pImg.classList.remove('hide'); }
      else { els.pImg.classList.add('hide'); els.pImg.removeAttribute('src'); }
    }
    if(els.pOpts){
      els.pOpts.innerHTML="";
      if(q.type==='mcq'){
        q.options.forEach((t,i)=>{
          const d=document.createElement("div"); d.className="popt"; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d);
        });
      }
    }
  } else {
    if(els.pQ) els.pQ.textContent='-';
    if(els.pOpts) els.pOpts.innerHTML='';
    if(els.pImg){ els.pImg.classList.add('hide'); els.pImg.removeAttribute('src'); }
  }

  // 학생 화면
  if(MODE==='student'){
    els.studentTopInfo && (els.studentTopInfo.textContent = roomId ? `세션: ${roomId} · 온라인 · ${me?.name||'-'}` : '세션: - · 오프라인');
    if(r.mode!=='active' || idx<0){
      renderStudentWait();
      return;
    }
    const q=r.questions[idx];
    els.badgeType && (els.badgeType.textContent = q.type==='mcq'?'객관식':'주관식');
    els.sQText && (els.sQText.textContent=q.text);
    if(els.sImg){
      if(q.img){ els.sImg.src=q.img; els.sImg.classList.remove('hide'); }
      else { els.sImg.classList.add('hide'); els.sImg.removeAttribute('src'); }
    }
    // 객관식: 보기 + 제출 버튼
    if(q.type==='mcq'){
      if(els.mcqBox){
        els.mcqBox.innerHTML="";
        q.options.forEach((opt,i)=>{
          const b=document.createElement("button");
          b.className="optbtn"; b.textContent=`${i+1}. ${opt}`;
          b.addEventListener("click", ()=>{
            // 선택 표시
            $$(".optbtn", els.mcqBox).forEach(x=>x.classList.remove('active'));
            b.classList.add('active');
            els.btnSubmitMCQ?.classList.remove('hide');
            els.btnSubmitMCQ.onclick = ()=> submit(i);
          });
          els.mcqBox.appendChild(b);
        });
      }
      els.shortBox?.classList.add("hide");
    } else {
      els.mcqBox && (els.mcqBox.innerHTML="");
      els.shortBox?.classList.remove("hide");
      if(els.btnShortSend){
        els.btnShortSend.disabled = !r.accept;
        els.btnShortSend.onclick = ()=> submit((els.shortInput?.value||"").trim());
      }
      els.btnSubmitMCQ?.classList.add('hide');
    }
  }

  // 종료 → 결과 탭 자동 전환(관리자)
  if(MODE==='admin' && r.mode==='ended'){
    showPanel('results');
    buildResults(window.__responses||[]);
  }
}
function renderStudentWait(){
  els.studentJoin?.classList.toggle('hide', !!me?.id);
  els.studentQuiz?.classList.toggle('hide', false);
  if(!me?.id){
    // 이름 입력 안내
    els.studentQuiz?.classList.add('hide');
    els.studentJoin?.classList.remove('hide');
  } else {
    els.sQText && (els.sQText.textContent="제출 버튼을 눌러주세요."); // 요구사항
    els.mcqBox && (els.mcqBox.innerHTML="");
    els.shortBox?.classList.add('hide');
    els.btnSubmitMCQ?.classList.add('hide');
  }
}
function renderResponses(list){
  const r=window.__room||{}; const idx=r.currentIndex; const q=r.questions?.[idx];

  // 통계 (프레젠테이션 하단)
  const joined=list.length;
  let submitted=0, correct=0, wrong=0;
  list.forEach(s=>{
    const a=s.answers?.[idx];
    if(a){ submitted++; if(a.correct) correct++; else wrong++; }
  });
  if(els.statJoin) els.statJoin.textContent=`참가 ${joined}`;
  if(els.statSubmit) els.statSubmit.textContent=`제출 ${submitted}`;
  if(els.statCorrect) els.statCorrect.textContent=`정답 ${correct}`;
  if(els.statWrong) els.statWrong.textContent=`오답 ${wrong}`;

  // 결과표(리더보드)
  if(els.resultsTable){
    const tbl=document.createElement("table");
    const thead=document.createElement("thead"), tr=document.createElement("tr");
    ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; tr.appendChild(th); });
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb=document.createElement("tbody");

    // 점수 계산 & 정렬
    const withScore=list.map(s=>{
      let score=0;
      (r.questions||[]).forEach((q,i)=>{ if(s.answers?.[i]?.correct) score++; });
      return { ...s, __score:score };
    }).sort((a,b)=> b.__score - a.__score);

    withScore.forEach(s=>{
      const tr=document.createElement("tr");
      const tdn=document.createElement("td"); tdn.textContent=s.name||s.id; tr.appendChild(tdn);
      (r.questions||[]).forEach((q,i)=>{
        const a=s.answers?.[i]; const td=document.createElement("td");
        if(a){
          if(q.type==='mcq') td.textContent = (typeof a.value==='number'? String(a.value+1) : "-");
          else td.textContent = a.value ?? "-";
          if(a.revealed){ td.style.opacity = 1; td.style.fontWeight = a.correct? '700' : '400'; td.style.color = a.correct? '#16a34a' : '#ef4444'; }
        }else td.textContent='-';
        tr.appendChild(td);
      });
      const tds=document.createElement("td"); tds.textContent=String(s.__score); tr.appendChild(tds);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
  }

  // 학생 개인 결과(종료 시)
  if(MODE==='student' && window.__room?.mode==='ended'){
    const mine=list.find(x=>x.id===me.id);
    if(mine){
      els.studentQuiz?.classList.add('hide');
      els.studentResult?.classList.remove('hide');
      const box=els.studentResultBody; if(box){
        box.innerHTML="";
        const ul=document.createElement('ul');
        (window.__room.questions||[]).forEach((q,i)=>{
          const a=mine.answers?.[i]; const li=document.createElement('li');
          li.textContent = `Q${i+1}: ` + (a ? (q.type==='mcq'?(typeof a.value==='number' ? `선택 ${a.value+1}`:'-') : (a.value||'-')) : '-')
                           + (a?.correct ? ' ✅' : (a ? ' ❌' : ''));
          ul.appendChild(li);
        });
        box.appendChild(ul);
      }
    }
  }
}

/***********************
 * Link / QR
 ***********************/
function buildStudentLink(){
  if(!roomId || !els.studentLink) return;
  const url=new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", roomId);
  els.studentLink.value=url.toString();

  const QR = window.QRCode;
  if(QR && els.qrCanvas){
    try{
      QR.toCanvas(els.qrCanvas, els.studentLink.value, { width:120, margin:1 }, (err)=>{ if(err) console.warn(err); });
    }catch(e){ console.warn("QR draw failed", e); }
  }
}

/***********************
 * Events
 ***********************/
els.btnConnect?.addEventListener("click", connect);
els.btnSignOut?.addEventListener("click", signOut);

els.tabBuild?.addEventListener("click", ()=> showPanel('build'));
els.tabOptions?.addEventListener("click", ()=> showPanel('options'));
els.tabPresent?.addEventListener("click", ()=> showPanel('present'));
els.tabResults?.addEventListener("click", ()=> showPanel('results'));

els.btnBuildForm?.addEventListener("click", ()=>{
  const n=Math.max(1,Math.min(50, parseInt(els.questionCount?.value,10)||3));
  if(els.builder){ els.builder.innerHTML=""; for(let i=0;i<n;i++) els.builder.appendChild(cardRow(i+1)); }
});
els.btnLoadSample?.addEventListener("click", ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)은?', answerText:'100'},
    {type:'mcq', text:'바다 소금기는 어디서?', options:['소금산','강물의 광물질','하늘','바람'], answerIndex:1},
  ];
  if(els.builder){ els.builder.innerHTML=""; S.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q))); }
  if(els.quizTitle) els.quizTitle.value="샘플 퀴즈";
  if(els.questionCount) els.questionCount.value=S.length;
});
els.btnUploadTxt?.addEventListener("click", ()=> els.fileUploadTxt?.click());
els.fileUploadTxt?.addEventListener("change", async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const text=await f.text();
  const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const qs=[];
  for(const ln of lines){
    const parts=ln.split(',').map(x=>x.trim());
    if(parts.length>=6){ // 객관식
      const [qt,o1,o2,o3,o4,ans]=parts;
      qs.push({ type:'mcq', text:qt, options:[o1,o2,o3,o4].filter(Boolean), answerIndex:Math.max(0,Math.min(3, (parseInt(ans,10)||1)-1)) });
    } else if(parts.length>=3 && parts[1]==='주관식'){
      qs.push({ type:'short', text:parts[0], answerText:parts.slice(2).join(',') });
    }
  }
  if(els.builder){ els.builder.innerHTML=""; qs.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q))); }
  if(els.quizTitle && !els.quizTitle.value) els.quizTitle.value="업로드 퀴즈";
});
els.btnDownloadTemplate?.addEventListener("click", ()=>{
  const sample=`가장 큰 행성?,지구,목성,화성,금성,2
물의 끓는점(°C)은?,주관식,100`;
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([sample],{type:"text/plain"}));
  a.download="quiz_template.txt"; a.click(); URL.revokeObjectURL(a.href);
});
els.btnSaveQuiz?.addEventListener("click", async ()=>{
  if(!roomId) return alert('세션이 없습니다.');
  const payload=collectBuilder(); if(!payload.questions.length) return alert("문항을 추가하세요.");
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("저장 완료!");
});

els.btnSaveOptions?.addEventListener("click", async ()=>{
  if(!roomId) return alert('세션이 없습니다.');
  const policy = els.policyName?.checked ? 'name' : 'device';
  const timer  = Math.max(5, Math.min(600, parseInt(els.timerSec?.value,10)||30));
  await setDoc(roomRef(roomId), {
    policy, accept: !!els.chkAccept?.checked, reveal: !!els.chkReveal?.checked, bright: !!els.chkBright?.checked, timer
  }, { merge:true });
  buildStudentLink(); // 저장 후 즉시 QR/링크 갱신
  alert("옵션 저장 완료!");
});

els.btnStart?.addEventListener("click", async ()=>{
  await startQuiz();
  const r=(await getDoc(roomRef(roomId))).data(); startTimer(r?.timer||30);
});
els.btnPrev?.addEventListener("click", ()=> step(-1));
els.btnNext?.addEventListener("click", ()=> step(+1));
els.btnEndAll?.addEventListener("click", finishAll);

els.btnExportCSV?.addEventListener("click", async ()=>{
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
  if(!roomId) return; if(!confirm("모든 응답/점수를 초기화할까요?")) return;
  await setDoc(roomRef(roomId), { mode:"idle", currentIndex:-1, accept:false, reveal:false }, { merge:true });
  const snap=await getDocs(respCol(roomId)); const tasks=[];
  snap.forEach(d=> tasks.push(setDoc(doc(respCol(roomId), d.id), { answers:{}, alive:true }, { merge:true })));
  await Promise.all(tasks); alert("초기화 완료");
});

// 학생
els.btnJoin?.addEventListener("click", join);
els.btnShortSend?.addEventListener("click", ()=> submit((els.shortInput?.value||"").trim()));
els.btnCopyLink?.addEventListener("click", async ()=>{
  if(!els.studentLink) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="복사", 1200);
});
els.btnOpenStudent?.addEventListener("click", ()=> window.open(els.studentLink?.value||"#","_blank"));

/***********************
 * Boot & URL role
 ***********************/
(function boot(){
  loadLocal();
  // 기본은 관리자 모드 / 세션 아웃 상태
  setMode(MODE || 'admin');
  updateLockUI(false);

  // URL 파라미터로 학생 모드 진입: ?role=student&room=class1
  const url=new URL(location.href);
  const role=url.searchParams.get("role"); const rid=url.searchParams.get("room");
  if(role==='student'){
    MODE='student'; setMode('student');
    // 상단 탭/세션은 admin-only라 자동 숨김, 학생 패널만 보이도록
    document.querySelectorAll('.admin-only').forEach(el=>el.classList.add('hide'));
    // 학생 화면 강제 표출
    els.studentPanel?.classList.remove('hide');
    ['build','options','present','results'].forEach(n=> showPanel(null));
    if(rid){ roomId=rid; connect(); }
  }
})();
