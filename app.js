/* ========= 실시간 퀴즈 – 자동 재접속/작은 톤/타이머/프레젠테이션 ========= */

const el = bind({
  roomIdInput:'roomIdInput', btnConnect:'btnConnect',
  btnTeacherMode:'btnTeacherMode', btnStudentMode:'btnStudentMode', statusText:'statusText',
  teacherPanel:'teacherPanel', joinCard:'joinCard',
  tabs:'.tab', tabBuild:'tab-build', tabControl:'tab-control', tabResults:'tab-results', tabPresent:'tab-present',
  quizTitle:'quizTitle', questionCount:'questionCount', btnBuildForm:'btnBuildForm', btnLoadSample:'btnLoadSample',
  policySelect:'policySelect', goldenBellToggle:'goldenBellToggle', builder:'builder',
  btnSaveQuiz:'btnSaveQuiz', btnExportJSON:'btnExportJSON', btnImportJSON:'btnImportJSON', fileImport:'fileImport',
  qrBox:'qrBox', studentLinkInput:'studentLinkInput', btnCopy:'btnCopy', btnOpenStudent:'btnOpenStudent',
  btnStart:'btnStart', btnPrev:'btnPrev', btnNext:'btnNext', toggleAccept:'toggleAccept', toggleReveal:'toggleReveal',
  timerSec:'timerSec', btnTimerStart:'btnTimerStart', btnTimerStop:'btnTimerStop', autoNextToggle:'autoNextToggle',
  remainTime:'remainTime',
  ctlTitle:'ctlTitle', ctlIdx:'ctlIdx', ctlJoin:'ctlJoin', ctlQuestion:'ctlQuestion',
  shortGrader:'shortGrader', shortAnswers:'shortAnswers', chips:'chips', policyText:'policyText',
  btnExportCSV:'btnExportCSV', btnResetAll:'btnResetAll', resultsHead:'resultsHead', resultsBody:'resultsBody',
  pptTitle:'pptTitle', pptSub:'pptSub', pptQuestion:'pptQuestion', pptOptions:'pptOptions',
  pptSubmit:'pptSubmit', pptOk:'pptOk', pptBad:'pptBad', pptOut:'pptOut',
  studentName:'studentName', btnJoin:'btnJoin', quizTypeBadge:'quizTypeBadge', questionText:'questionText',
  progressText:'progressText', optionsContainer:'optionsContainer', subjectiveBox:'subjectiveBox',
  subjectiveInput:'subjectiveInput', btnSubmitSubjective:'btnSubmitSubjective', btnSubmitMCQ:'btnSubmitMCQ',
  answerState:'answerState', sRemain:'sRemain',
});

function bind(map){const o={};for(const k in map){const v=map[k];o[k]=v.startsWith('.')?Array.from(document.querySelectorAll(v)):document.getElementById(v);}return o;}
const $=(s,e=document)=>e.querySelector(s), $$=(s,e=document)=>Array.from(e.querySelectorAll(s));
const id=()=>Math.random().toString(36).slice(2,10), clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const esc=s=>String(s??'').replace(/[&<>\"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[m]));
const csvEsc=v=>v==null?'':(/[",\n]/.test(String(v))?`"${String(v).replace(/"/g,'""')}"`:String(v));
const toast=alert;

let MODE='teacher', roomId='', me={id:null,name:''}, policy='device', goldenBell=false;
let db=null, FS=null, connected=false;

const ENV={useFS:false, subs:[]};
const KEYS={ LAST_ROOM:'quiz:last_room', LAST_MODE:'quiz:last_mode', DEVICE_TOKEN:'quiz:device_token', LS_ROOM:id=>`quiz:${id}` };

// Firebase 연결(있으면 사용)
(async function(){
  try{
    const conf={ apiKey:"AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo", authDomain:"live-quiz-a14d1.firebaseapp.com", projectId:"live-quiz-a14d1" };
    if(window.firebase?.initializeApp){ const app=firebase.initializeApp(conf); db=firebase.firestore(app); FS=firebase.firestore; ENV.useFS=true; }
  }catch{}
})();

/* ---------- Local Model (폴백) ---------- */
function lsRead(id){const r=localStorage.getItem(KEYS.LS_ROOM(id));return r?JSON.parse(r):null;}
function lsWrite(id,d){localStorage.setItem(KEYS.LS_ROOM(id),JSON.stringify(d));}
function ensureRoomLocal(id){
  const cur=lsRead(id); if(cur) return cur;
  const room={title:"새 세션",policy:"device",goldenBell:false,mode:"idle",accept:false,reveal:false,currentIndex:-1,timerEndAt:null,autoNext:false,questions:[],responses:{}};
  lsWrite(id,room); return room;
}
async function fsGetRoom(id){ if(!ENV.useFS) return ensureRoomLocal(id); try{const s=await db.collection('rooms').doc(id).get();return s.exists?s.data():null;}catch{ENV.useFS=false;return ensureRoomLocal(id);} }
async function fsSetRoom(id,patch){ if(!ENV.useFS){const c=ensureRoomLocal(id);lsWrite(id,{...c,...patch});return;} try{await db.collection('rooms').doc(id).set(patch,{merge:true});}catch{ENV.useFS=false;return fsSetRoom(id,patch);} }
async function fsGetResponses(id){ if(!ENV.useFS){const c=ensureRoomLocal(id);return Object.entries(c.responses||{}).map(([i,v])=>({id:i,...v}));}
  try{const ss=await db.collection('rooms').doc(id).collection('responses').get();const a=[];ss.forEach(d=>a.push({id:d.id,...d.data()}));return a;}catch{ENV.useFS=false;return fsGetResponses(id);} }
async function fsSetResponse(id,uid,patch){ if(!ENV.useFS){const c=ensureRoomLocal(id);const u=c.responses[uid]||{name:'',alive:true,answers:{}};c.responses[uid]=merge(u,patch);lsWrite(id,c);return;}
  try{await db.collection('rooms').doc(id).collection('responses').doc(uid).set(patch,{merge:true});}catch{ENV.useFS=false;return fsSetResponse(id,uid,patch);} }
function merge(a,b){const o={...a};for(const k in b){if(b[k]&&typeof b[k]==='object'&&!Array.isArray(b[k]))o[k]=merge(a[k]||{},b[k]);else o[k]=b[k];}return o;}
function unsubAll(){ENV.subs.forEach(fn=>fn());ENV.subs=[];}
function listenRoom(id,cb){
  if(!ENV.useFS){const t=setInterval(async()=>cb(await fsGetRoom(id)),700);ENV.subs.push(()=>clearInterval(t));cb(ensureRoomLocal(id));return;}
  const u=db.collection('rooms').doc(id).onSnapshot(s=>s.exists&&cb(s.data()));ENV.subs.push(u);
}
function listenResponses(id,cb){
  if(!ENV.useFS){const t=setInterval(async()=>cb(await fsGetResponses(id)),700);ENV.subs.push(()=>clearInterval(t));cb([]);return;}
  const u=db.collection('rooms').doc(id).collection('responses').onSnapshot(s=>{const a=[];s.forEach(d=>a.push({id:d.id,...d.data()}));cb(a);});ENV.subs.push(u);
}

/* ---------- 모드/상태 표시 ---------- */
el.btnTeacherMode.addEventListener('click',()=>setMode('teacher'));
el.btnStudentMode.addEventListener('click',()=>setMode('student'));

function setMode(m){
  MODE=m;
  el.teacherPanel.classList.toggle('hidden', m!=='teacher');
  el.joinCard.classList.toggle('hidden', m!=='student');
  localStorage.setItem(KEYS.LAST_MODE,m);
  writeStatus(); // 연결여부 반영한 문구
}
function writeStatus(){
  if(roomId) el.statusText.textContent=`세션: ${roomId} · ${ENV.useFS?'온라인':'오프라인'} · 모드: ${MODE==='teacher'?'관리자':'학생'}`;
  else el.statusText.textContent= MODE==='teacher' ? '관리자 모드: 세션을 연결해 주세요.' : '학생 모드: 세션 접속 후 참가하세요.';
}

/* ---------- 연결 ---------- */
el.btnConnect.addEventListener('click', connectRoom);

async function connectRoom(){
  const id=el.roomIdInput.value.trim(); if(!id) return toast('세션 코드를 입력하세요.');
  roomId=id; localStorage.setItem(KEYS.LAST_ROOM,roomId);
  const r=await fsGetRoom(roomId); if(!r) await fsSetRoom(roomId, ensureRoomLocal(roomId));
  policy=r?.policy||'device'; goldenBell=!!r?.goldenBell; connected=true;
  el.policyText.textContent=`정책: ${policy==='device'?'기기당 1회':'실명당 1회'} · 골든벨: ${goldenBell?'ON':'OFF'}`;
  unsubAll(); listenRoom(roomId, renderRoom); listenResponses(roomId, renderResponses);
  await refreshStudentLink(); writeStatus();
}
function studentURL(){ const u=new URL(location.href); u.searchParams.set('room',roomId); u.searchParams.set('student','1'); return u.toString(); }
async function refreshStudentLink(){ if(!roomId) return; const url=studentURL(); el.studentLinkInput.value=url; el.btnOpenStudent.href=url; await drawQR(url); }
async function drawQR(text){
  el.qrBox.innerHTML='';
  try{
    if(window.QRCode?.toCanvas){
      const canvas=document.createElement('canvas'); el.qrBox.appendChild(canvas);
      await new Promise((res,rej)=>QRCode.toCanvas(canvas,text,(e)=>e?rej(e):res()));
      return;
    }
  }catch{}
  const img=new Image(); img.alt='QR'; img.width=180; img.height=180;
  img.src='https://api.qrserver.com/v1/create-qr-code/?size=180x180&data='+encodeURIComponent(text);
  el.qrBox.appendChild(img);
}
el.btnCopy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(el.studentLinkInput.value||'');toast('복사 완료');}catch{toast('복사 실패');}});

/* ---------- 빌더 ---------- */
el.btnBuildForm.addEventListener('click',()=>{const n=clamp(parseInt(el.questionCount.value||'3',10),1,20);el.builder.innerHTML='';for(let i=0;i<n;i++)el.builder.appendChild(row(i+1));});
el.btnLoadSample.addEventListener('click',()=>{
  const samples=[
    {type:'mcq',text:'태양계에서 가장 큰 행성은?',options:['지구','목성','화성','금성'],answerIndex:1},
    {type:'short',text:'물의 끓는점(°C)은?',answerText:'100'},
    {type:'mcq',text:'바다의 소금기는 어디서 올까요?',options:['소금산','강물의 광물질','하늘','바람'],answerIndex:1},
  ]; el.quizTitle.value='샘플 퀴즈'; el.questionCount.value=samples.length; el.builder.innerHTML=''; samples.forEach((q,i)=>el.builder.appendChild(row(i+1,q)));
});
el.btnSaveQuiz.addEventListener('click', async ()=>{
  if(!roomId) return toast('세션부터 접속하세요.');
  const payload=collect(); if(payload.questions.length===0) return toast('문항이 없습니다.');
  policy=el.policySelect.value; goldenBell=!!el.goldenBellToggle.checked;
  await fsSetRoom(roomId,{ title:payload.title, policy, goldenBell, mode:'idle', accept:false, reveal:false, currentIndex:-1, timerEndAt:null, autoNext:!!el.autoNextToggle?.checked, questions:payload.questions });
  el.policyText.textContent=`정책: ${policy==='device'?'기기당 1회':'실명당 1회'} · 골든벨: ${goldenBell?'ON':'OFF'}`;
  toast('저장 완료');
});
el.btnExportJSON.addEventListener('click',async()=>{if(!roomId) return; const r=await fsGetRoom(roomId); const blob=new Blob([JSON.stringify(r,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`${r.title||roomId}.json`; a.click(); URL.revokeObjectURL(a.href);});
el.btnImportJSON.addEventListener('change',()=>{}); // 방지
el.btnImportJSON.addEventListener('click',()=>el.fileImport.click());
el.fileImport.addEventListener('change', async e=>{
  const f=e.target.files?.[0]; if(!f) return; try{const data=JSON.parse(await f.text()); if(!roomId){roomId=prompt('세션 코드 입력')||''; if(!roomId) return;}
    await fsSetRoom(roomId,data); toast('불러오기 완료'); }catch{toast('JSON 형식 오류');} e.target.value='';
});

function row(no,q){
  const w=document.createElement('div'); w.className='card';
  w.innerHTML=`
    <div class="row" style="flex-wrap:wrap">
      <span class="tag">${no}번</span>
      <label class="small">유형</label>
      <label class="row" style="gap:6px"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'}> 객관식</label>
      <label class="row" style="gap:6px"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''}> 주관식</label>
    </div>
    <div class="row" style="margin-top:6px">
      <input class="q-text" data-no="${no}" placeholder="문항 내용" value="${esc(q?.text||'')}" style="flex:1" />
    </div>
    <div class="mcq ${q?.type==='short'?'hidden':''}" data-no="${no}">
      <div class="row" style="flex-wrap:wrap;margin-top:6px;gap:8px">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt" data-idx="${i}" placeholder="보기 ${i+1}" value="${esc(v)}" style="width:200px" />`).join('')}
      </div>
      <div class="row" style="margin-top:6px">
        <label class="small">정답 번호</label>
        <input class="ansIndex" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}" style="width:80px" />
      </div>
    </div>
    <div class="short ${q?.type==='short'?'':'hidden'}" data-no="${no}">
      <div class="row" style="margin-top:6px">
        <input class="ansText" placeholder="정답(선택, 자동채점용)" value="${esc(q?.answerText||'')}" style="width:300px" />
      </div>
    </div>`;
  const radios=$$(`input[name="type-${no}"]`,w), mcq=$('.mcq',w), short=$('.short',w);
  radios.forEach(r=>r.addEventListener('change',()=>{const isShort=radios.find(x=>x.checked)?.value==='short';mcq.classList.toggle('hidden',isShort);short.classList.toggle('hidden',!isShort);}));
  return w;
}
function collect(){
  const title=el.quizTitle.value||'퀴즈'; const cards=$$('#builder > .card');
  const questions=cards.map((card,idx)=>{
    const no=idx+1; const type=card.querySelector(`input[name="type-${no}"]:checked`).value;
    const text=card.querySelector('.q-text').value.trim(); if(!text) return null;
    if(type==='mcq'){const opts=$$('.opt',card).map(x=>x.value.trim()).filter(Boolean); const ans=clamp(parseInt($('.ansIndex',card).value,10)-1,0,Math.max(0,opts.length-1)); return {type:'mcq',text,options:opts,answerIndex:ans};}
    const answerText=$('.ansText',card).value.trim(); return {type:'short',text,answerText};
  }).filter(Boolean);
  return {title,questions};
}

/* ---------- 진행/타이머 ---------- */
el.btnStart.addEventListener('click',()=>updateRoom({mode:'active',currentIndex:0,accept:true,reveal:false,timerEndAt:null}));
el.btnPrev.addEventListener('click',()=>stepIndex(-1));
el.btnNext.addEventListener('click',()=>stepIndex(1));
el.toggleAccept.addEventListener('change',()=>updateRoom({accept:!!el.toggleAccept.checked}));
el.toggleReveal.addEventListener('change',()=>updateRoom({reveal:!!el.toggleReveal.checked}));
el.autoNextToggle.addEventListener('change',()=>updateRoom({autoNext:!!el.autoNextToggle.checked}));
el.btnTimerStart.addEventListener('click',async()=>{const sec=clamp(parseInt(el.timerSec.value||'30',10),5,600);await updateRoom({timerEndAt:Date.now()+sec*1000,accept:true,reveal:false});});
el.btnTimerStop.addEventListener('click',()=>updateRoom({timerEndAt:null}));

async function updateRoom(p){if(!roomId) return;await fsSetRoom(roomId,p);}
async function stepIndex(d){const r=await fsGetRoom(roomId);const next=clamp((r.currentIndex??-1)+d,0,Math.max(0,(r.questions?.length||1)-1));await updateRoom({currentIndex:next,accept:true,reveal:false,timerEndAt:null});}

/* ---------- 렌더링 ---------- */
let ticker=null; function clearTicker(){if(ticker) clearInterval(ticker); ticker=null;}

async function renderRoom(r){
  window.__room=r; writeStatus();

  el.ctlTitle.textContent=r.title||'-'; el.ctlIdx.textContent=r.currentIndex>=0?`${r.currentIndex+1}/${r.questions?.length||0}`:'-';
  el.toggleAccept.checked=!!r.accept; el.toggleReveal.checked=!!r.reveal; el.autoNextToggle.checked=!!r.autoNext;

  clearTicker();
  const tick=()=>{const left=Math.max(0,(r.timerEndAt||0)-Date.now());const mm=String(Math.floor(left/60000)).padStart(2,'0');const ss=String(Math.floor((left%60000)/1000)).padStart(2,'0'); el.remainTime.textContent=`${mm}:${ss}`; el.sRemain.textContent=`${mm}:${ss}`;
    if(MODE==='teacher'&&r.timerEndAt&&left<=0){clearTicker();updateRoom({accept:false,reveal:true,timerEndAt:null}); if(r.autoNext) setTimeout(()=>stepIndex(1),800);}
  }; tick(); ticker=setInterval(tick,250);

  if(MODE==='teacher'){
    const q=r.questions?.[r.currentIndex];
    el.ctlQuestion.innerHTML=q?`<div class="muted">${q.type==='mcq'?'객관식':'주관식'}</div><div style="font-size:15px;margin-top:4px">${esc(q.text)}</div>`:'대기';
    el.shortGrader.classList.toggle('hidden',!(q&&q.type==='short'));
    updatePresentation(r);
  }

  if(MODE==='student'){
    const idx=r.currentIndex; const q=r.questions?.[idx];
    if(r.mode!=='active'||!q){ el.quizTypeBadge.textContent='대기'; el.questionText.textContent='대기 중입니다…'; el.progressText.textContent='0 / 0'; el.optionsContainer.innerHTML=''; el.subjectiveBox.classList.add('hidden'); el.btnSubmitMCQ.classList.add('hidden'); return; }
    el.progressText.textContent=`${idx+1} / ${r.questions.length}`; el.quizTypeBadge.textContent=q.type==='mcq'?'객관식':'주관식'; el.questionText.textContent=q.text;
    if(q.type==='mcq'){ renderMCQ(q,r.accept,r.reveal); el.subjectiveBox.classList.add('hidden'); el.btnSubmitMCQ.classList.remove('hidden'); }
    else{ el.optionsContainer.innerHTML=''; el.subjectiveBox.classList.remove('hidden'); el.btnSubmitMCQ.classList.add('hidden'); el.btnSubmitSubjective.disabled=!r.accept; el.answerState.textContent=''; }
  }
  buildResultsHead(r);
}

function renderMCQ(q,accepting,revealed){
  el.optionsContainer.innerHTML=''; const local=window.__myAnswer||{};
  q.options.forEach((opt,i)=>{const b=document.createElement('button'); b.className='option'; b.textContent=opt; b.dataset.opt=String(i);
    if(local.idx===i) b.classList.add('selected');
    if(revealed){if(local.idx===i) b.classList.add(local.correct?'correct':'wrong'); if(i===q.answerIndex) b.classList.add('correct');}
    b.onclick=()=>{window.__myAnswer={idx:i}; $$('.option',el.optionsContainer).forEach(x=>x.classList.remove('selected')); b.classList.add('selected');};
    el.optionsContainer.appendChild(b);
  }); el.btnSubmitMCQ.disabled=!accepting;
}

function updatePresentation(r){
  const q=r.questions?.[r.currentIndex]; el.pptTitle.textContent=r.title||'-';
  el.pptSub.textContent=r.currentIndex>=0?`문항 ${r.currentIndex+1}/${r.questions?.length||0}`:'-';
  if(!q){ el.pptQuestion.textContent='대기 중…'; el.pptOptions.innerHTML=''; return; }
  el.pptQuestion.textContent=q.text; el.pptOptions.innerHTML='';
  if(q.type==='mcq'){ q.options.forEach((t,i)=>{const d=document.createElement('div'); d.className='option'; d.textContent=`${i+1}. ${t}`; el.pptOptions.appendChild(d);}); }
  else{ const d=document.createElement('div'); d.className='muted'; d.textContent='주관식 문항입니다.'; el.pptOptions.appendChild(d); }
}

async function renderResponses(arr){
  el.ctlJoin.textContent=String(arr.length);
  const r=window.__room; if(!r) return;
  el.chips.innerHTML=''; let submit=0,ok=0,bad=0,out=0;
  arr.forEach(s=>{const a=s.answers?.[r.currentIndex]; const tag=document.createElement('div'); tag.className='chip'; tag.textContent=s.name||s.id;
    if(s.alive===false){tag.classList.add('bad');out++;} if(a){submit++; if(a.correct) ok++; else bad++;} el.chips.appendChild(tag); });
  el.pptSubmit.textContent=submit; el.pptOk.textContent=ok; el.pptBad.textContent=bad; el.pptOut.textContent=out;

  const q=r.questions?.[r.currentIndex];
  if(MODE==='teacher' && q && q.type==='short'){
    el.shortAnswers.innerHTML=''; arr.forEach(s=>{const a=s.answers?.[r.currentIndex]; if(!a||typeof a.value!=='string') return;
      const row=document.createElement('div'); row.className='row'; const left=document.createElement('div'); left.textContent=`${s.name}: ${a.value}`;
      const right=document.createElement('div');
      const okBtn=btn('정답','btn ghost',()=>gradeAnswer(s.id,r.currentIndex,true));
      const noBtn=btn('오답','btn ghost',()=>gradeAnswer(s.id,r.currentIndex,false));
      right.appendChild(okBtn); right.appendChild(noBtn); row.appendChild(left); row.appendChild(right); el.shortAnswers.appendChild(row);
    });
  }
  buildResultsBody(r,arr);
}
const btn=(t,c,fn)=>{const b=document.createElement('button'); b.className=c; b.textContent=t; b.onclick=fn; return b;};

/* ---------- 학생 참가/제출 ---------- */
el.btnJoin.addEventListener('click',async()=>{
  if(MODE!=='student') return; if(!roomId) return toast('세션에 먼저 접속하세요.');
  const name=el.studentName.value.trim(); if(!name) return toast('이름을 입력하세요.');
  const uid=(policy==='device')?deviceToken():name; me={id:uid,name};
  await fsSetResponse(roomId,uid,{name,joinedAt:Date.now(),alive:true}); toast(`${name} 님, 참가 완료!`);
});
function deviceToken(){let t=localStorage.getItem(KEYS.DEVICE_TOKEN);if(!t){t=id();localStorage.setItem(KEYS.DEVICE_TOKEN,t);}return t;}

el.btnSubmitSubjective.addEventListener('click',async()=>{const r=window.__room; if(!r||!r.accept) return toast('지금은 제출할 수 없습니다.');
  const val=el.subjectiveInput.value.trim(); if(!val) return toast('정답을 입력하세요.'); await submitAnswer(val);
});
el.btnSubmitMCQ.addEventListener('click',async()=>{const r=window.__room; if(!r||!r.accept) return toast('지금은 제출할 수 없습니다.');
  const chosen=window.__myAnswer?.idx; if(typeof chosen!=='number') return toast('보기 하나를 선택하세요.'); await submitAnswer(chosen);
});

async function submitAnswer(value){
  if(!me.id) return toast('먼저 참가하세요.');
  const r=await fsGetRoom(roomId); const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
  const mine=(await fsGetResponses(roomId)).find(x=>x.id===me.id); if(mine?.answers?.[idx]) return toast('이미 제출했습니다.');
  let correct=false; if(q.type==='mcq'&&typeof value==='number') correct=value===q.answerIndex;
  if(q.type==='short'&&typeof value==='string'){const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=norm(value)===norm(q.answerText);}
  await fsSetResponse(roomId,me.id,{name:me.name,answers:{[idx]:{value,correct,revealed:q.type==='mcq'}}});
  if(r.goldenBell && !correct) await fsSetResponse(roomId,me.id,{alive:false});
  if(q.type==='short') el.answerState.textContent=`제출: ${value}`; else el.answerState.textContent=correct?'정답!':'제출 완료';
}
async function gradeAnswer(uid,i,ok){await fsSetResponse(roomId,uid,{answers:{[i]:{correct:!!ok,revealed:true}}}); if(window.__room?.goldenBell&&!ok) await fsSetResponse(roomId,uid,{alive:false});}

/* ---------- 결과표/CSV ---------- */
function buildResultsHead(r){const n=r.questions?.length||0; el.resultsHead.innerHTML=''; ['이름',...Array.from({length:n},(_,i)=>`Q${i+1}`),'점수','상태'].forEach(t=>{const th=document.createElement('th'); th.textContent=t; el.resultsHead.appendChild(th);});}
function buildResultsBody(r,arr){
  el.resultsBody.innerHTML=''; const n=r.questions?.length||0;
  arr.forEach(s=>{const tr=document.createElement('tr'); const tdN=document.createElement('td'); tdN.textContent=s.name||s.id; tr.appendChild(tdN);
    let score=0; for(let i=0;i<n;i++){const td=document.createElement('td'); const a=s.answers?.[i];
      if(a){if(a.correct) score++; const q=r.questions[i]; td.textContent=q.type==='mcq'?(typeof a.value==='number'?String(a.value+1):'-'):(a.value||'-');} else td.textContent='-';
      tr.appendChild(td);} const tdS=document.createElement('td'); tdS.textContent=String(score); tr.appendChild(tdS);
    const tdA=document.createElement('td'); tdA.textContent=s.alive===false?'out':'alive'; tr.appendChild(tdA); el.resultsBody.appendChild(tr);});
}
el.btnExportCSV.addEventListener('click',async()=>{if(!roomId) return;const r=await fsGetRoom(roomId),arr=await fsGetResponses(roomId);
  const head=['userId','name',...r.questions.map((_,i)=>`Q${i+1}`),'score','alive'].join(',');
  const rows=[head]; arr.forEach(s=>{let score=0; const ans=r.questions.map((q,i)=>{const a=s.answers?.[i]; if(a?.correct) score++; return q.type==='mcq'?(typeof a?.value==='number'?String(a.value+1):''):(a?.value??'');});
    rows.push([csvEsc(s.id),csvEsc(s.name),...ans.map(csvEsc),score,s.alive===false?'out':'alive'].join(','));});
  const blob=new Blob([rows.join('\n')],{type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`${r.title||roomId}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
});
el.btnResetAll.addEventListener('click',async()=>{if(!roomId) return;if(!confirm('모든 응답과 진행 상태를 초기화할까요?')) return;
  await fsSetRoom(roomId,{mode:'idle',accept:false,reveal:false,currentIndex:-1,timerEndAt:null,responses:ENV.useFS?undefined:{}});
  if(ENV.useFS){const arr=await fsGetResponses(roomId);for(const x of arr) await fsSetResponse(roomId,x.id,{answers:{},alive:true});}
  toast('초기화 완료');
});

/* ---------- 탭 ---------- */
el.tabs.forEach(t=>t.addEventListener('click',()=>{
  el.tabs.forEach(x=>x.classList.remove('pri')); t.classList.add('pri');
  [el.tabBuild,el.tabControl,el.tabResults,el.tabPresent].forEach(p=>p.classList.add('hidden'));
  const n=t.dataset.tab; if(n==='build') el.tabBuild.classList.remove('hidden'); if(n==='control') el.tabControl.classList.remove('hidden');
  if(n==='results') el.tabResults.classList.remove('hidden'); if(n==='present') el.tabPresent.classList.remove('hidden');
}));

/* ---------- 자동 재접속 ---------- */
window.addEventListener('DOMContentLoaded',async()=>{
  const url=new URL(location.href); const pRoom=url.searchParams.get('room'); const isStudent=url.searchParams.get('student')==='1';
  const lastRoom=localStorage.getItem(KEYS.LAST_ROOM); const lastMode=localStorage.getItem(KEYS.LAST_MODE)||'teacher';
  setMode(isStudent?'student':lastMode);
  const target=pRoom||lastRoom; if(target){ el.roomIdInput.value=target; await connectRoom(); }
  if(isStudent) setMode('student');
});
