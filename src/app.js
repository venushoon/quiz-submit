// Firebase v9 (CDN ESM)
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, runTransaction,
  collection, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// === Firebase 설정 (요청하신 값) ===
const firebaseConfig = {
  apiKey: "AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo",
  authDomain: "live-quiz-a14d1.firebaseapp.com",
  projectId: "live-quiz-a14d1"
};
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ===== DOM helpers =====
const qs =(s,el=document)=>el.querySelector(s);
const qsa=(s,el=document)=>Array.from(el.querySelectorAll(s));

// ===== DOM refs =====
const liveState=qs('#liveState');
const btnConnect=qs('#btnConnect');
const roomIdInput=qs('#roomIdInput');
const btnTeacherMode=qs('#btnTeacherMode');
const btnStudentMode=qs('#btnStudentMode');
const statusText=qs('#statusText');

const joinCard=qs('#joinCard');
const studentQuiz=qs('#studentQuiz');
const studentName=qs('#studentName');
const btnJoin=qs('#btnJoin');
const questionText=qs('#questionText');
const progressText=qs('#progressText');
const optionsContainer=qs('#optionsContainer');
const subjectiveBox=qs('#subjectiveBox');
const subjectiveInput=qs('#subjectiveInput');
const btnSubmitSubjective=qs('#btnSubmitSubjective');
const quizTypeBadge=qs('#quizTypeBadge');
const answerState=qs('#answerState');

const teacherPanel=qs('#teacherPanel');
const tabs=qsa('.tab'); const tabBuild=qs('#tab-build'); const tabControl=qs('#tab-control'); const tabResults=qs('#tab-results');

const roomInfo=qs('#roomInfo');
const quizTitle=qs('#quizTitle'); const questionCount=qs('#questionCount');
const btnBuildForm=qs('#btnBuildForm'); const btnLoadSample=qs('#btnLoadSample'); const builder=qs('#builder'); const btnSaveQuiz=qs('#btnSaveQuiz');

const btnStart=qs('#btnStart'); const btnStop=qs('#btnStop'); const btnPrev=qs('#btnPrev'); const btnNext=qs('#btnNext');
const toggleAccept=qs('#toggleAccept'); const toggleReveal=qs('#toggleReveal'); const toggleBell=qs('#toggleBell');
const ctlQuestion=qs('#ctlQuestion'); const chips=qs('#chips'); const shortGrader=qs('#shortGrader'); const shortAnswers=qs('#shortAnswers');

const timerSec=qs('#timerSec'); const btnTimerStart=qs('#btnTimerStart'); const btnTimerStop=qs('#btnTimerStop'); const leftTime=qs('#leftTime');

const qrDom=qs('#qr'); const studentLink=qs('#studentLink'); const btnCopy=qs('#btnCopy'); const btnOpenStudent=qs('#btnOpenStudent');

const btnExportCSV=qs('#btnExportCSV'); const btnResetRoom=qs('#btnResetRoom'); const resultsContainer=qs('#resultsContainer');
const btnLoadJSON=qs('#btnLoadJSON'); const btnSaveJSON=qs('#btnSaveJSON');

// ===== 상태 =====
let MODE='student', roomId='', me={ id:null, name:'' }, unsubRoom=null, unsubResponses=null, roomKey=null;
let timer=null, timerEnd=0;
const myDeviceKey = (()=>{ const k=localStorage.getItem('quiz_device_key')||crypto.randomUUID(); localStorage.setItem('quiz_device_key',k); return k; })();

// ===== 탭 =====
tabs.forEach(t=>t.addEventListener('click',()=>{
  tabs.forEach(x=>x.classList.remove('active')); t.classList.add('active');
  [tabBuild,tabControl,tabResults].forEach(p=>p.classList.add('hidden'));
  const name=t.dataset.tab; qs('#tab-'+name).classList.remove('hidden');
}));

// ===== 모드 전환 =====
function setMode(m){
  MODE=m;
  teacherPanel.classList.toggle('hidden', m!=='teacher');
  joinCard.classList.toggle('hidden', m!=='student');
  studentQuiz.classList.toggle('hidden', m!=='student');
  qs('#help-teacher').classList.toggle('hidden', m!=='teacher');
  qs('#help-student').classList.toggle('hidden', m!=='student');
  statusText.textContent = (m==='teacher') ? '관리자 모드: 세션을 연결해 주세요.' : '학생 모드: 세션 접속 후 참가하세요.';
}
btnTeacherMode.onclick=()=>setMode('teacher');
btnStudentMode.onclick=()=>setMode('student');

// ===== 접속 =====
btnConnect.onclick=async ()=>{
  roomId=(roomIdInput.value||'').trim();
  if(!roomId){ alert('세션 코드를 입력하세요'); return; }
  await ensureRoomExists(roomId);
  listenRoom(roomId); listenResponses(roomId);
  refreshStudentLink();
};

// ===== 학생 참가 =====
btnJoin.onclick=async ()=>{
  if(MODE!=='student'){ alert('학생 모드에서만 참가합니다.'); return; }
  if(!roomId){ alert('먼저 세션에 접속하세요'); return; }
  const name=(studentName.value||'').trim(); if(!name){ alert('이름을 입력하세요'); return; }
  me={ id: myDeviceKey, name };
  await setDoc(doc(db,'rooms',roomId,'responses',me.id),{
    name, joinedAt: serverTimestamp(), answers:{}, status:'alive'
  },{merge:true});
  alert(`${name} 님, 참가 완료!`);
  statusText.textContent=`${name} 님, 참가 완료`;
};

// ===== 빌드(폼/샘플/저장) =====
btnBuildForm.onclick=()=>{
  const n=clamp(parseInt(questionCount.value||'3',10),1,20);
  builder.innerHTML=''; for(let i=0;i<n;i++) builder.appendChild(buildQuestionRow(i+1));
};
btnLoadSample.onclick=()=>{
  quizTitle.value='샘플 퀴즈'; questionCount.value=3; builder.innerHTML='';
  const s=[
    {type:'mcq', text:'태양계에서 가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)은?', answerText:'100'},
    {type:'mcq', text:'바다의 소금기는 어디서 올까요?', options:['소금산','강물의 광물질','하늘','바람'], answerIndex:1}
  ];
  s.forEach((q,i)=>builder.appendChild(buildQuestionRow(i+1,q)));
};
btnSaveQuiz.onclick=async ()=>{
  if(!roomId){ alert('세션을 먼저 연결하세요.'); return; }
  const payload=collectQuizFromBuilder();
  if(payload.questions.length===0){ alert('문항을 추가하세요.'); return; }
  const rRef=doc(db,'rooms',roomId);
  const snap=await getDoc(rRef); roomKey = (snap.exists() && snap.data().roomKey) || crypto.randomUUID();
  await setDoc(rRef,{
    title: payload.title, mode:'idle', currentIndex:-1, accept:false, reveal:false, bell:false,
    createdAt: serverTimestamp(), questions: payload.questions, roomKey
  },{merge:true});
  alert('퀴즈 저장 완료! 진행 탭에서 시작하세요.');
  refreshStudentLink();
};

// ===== 진행 제어 =====
btnStart.onclick = ()=> updateRoom({ mode:'active', currentIndex:0, accept:true });
btnStop.onclick  = ()=> updateRoom({ mode:'ended',  accept:false });
btnPrev.onclick  = ()=> stepIndex(-1);
btnNext.onclick  = ()=> stepIndex(1);
toggleAccept.onchange = ()=> updateRoom({ accept: !!toggleAccept.checked });
toggleReveal.onchange = ()=> updateRoom({ reveal: !!toggleReveal.checked });
toggleBell.onchange   = ()=> updateRoom({ bell: !!toggleBell.checked });

// ===== 타이머 =====
btnTimerStart.onclick = ()=>{
  const sec=clamp(parseInt(timerSec.value||'30',10),1,600);
  timerEnd=Date.now()+sec*1000;
  if(timer) clearInterval(timer);
  timer=setInterval(()=>{
    const left=Math.max(0, Math.floor((timerEnd-Date.now())/1000));
    leftTime.textContent = formatMMSS(left);
    if(left<=0){ clearInterval(timer); timer=null; }
  },200);
};
btnTimerStop.onclick = ()=>{ if(timer) clearInterval(timer); timer=null; leftTime.textContent='00:00'; };

// ===== 학생 제출 =====
optionsContainer.addEventListener('click',e=>{
  const btn=e.target.closest('.option'); if(!btn) return;
  submitAnswer(parseInt(btn.dataset.opt,10));
});
btnSubmitSubjective.onclick=()=>{
  const v=(subjectiveInput.value||'').trim(); if(!v){alert('답을 입력하세요');return;}
  submitAnswer(v);
};

// ===== 결과/초기화/CSV/JSON =====
btnExportCSV.onclick=exportCSV;
btnResetRoom.onclick=async ()=>{
  if(!roomId) return; if(!confirm('모든 응답/상태를 초기화할까요?')) return;
  const rs=await getDocs(collection(db,'rooms',roomId,'responses'));
  for (const d of rs.docs){ await setDoc(d.ref,{answers:{},status:'alive'},{merge:true}); }
  await updateRoom({ mode:'idle', currentIndex:-1, accept:false, reveal:false });
  alert('초기화 완료');
};
btnSaveJSON.onclick=async ()=>{
  if(!roomId) return;
  const r=await getDoc(doc(db,'rooms',roomId));
  downloadFile(`quiz-${roomId}.json`, JSON.stringify(r.data()||{},null,2),'application/json');
};
btnLoadJSON.onclick=()=>{
  const inp=document.createElement('input'); inp.type='file'; inp.accept='application/json';
  inp.onchange=async (e)=>{
    const f=e.target.files?.[0]; if(!f) return;
    const txt=await f.text(); const data=JSON.parse(txt);
    if(!roomId){ alert('세션에 먼저 접속하세요.'); return; }
    await setDoc(doc(db,'rooms',roomId), data, {merge:true});
    alert('불러오기 완료'); refreshStudentLink();
  };
  inp.click();
};

// ===== 링크/QR =====
btnCopy.onclick  = ()=>{ navigator.clipboard.writeText(studentLink.value||''); };
btnOpenStudent.onclick = ()=>{ window.open(studentLink.value||'#','_blank'); };

// ===== Firestore helpers =====
async function ensureRoomExists(id){
  const ref=doc(db,'rooms',id); const s=await getDoc(ref);
  if(!s.exists()){
    roomKey = crypto.randomUUID();
    await setDoc(ref,{ title:'새 세션', mode:'idle', currentIndex:-1, accept:false, reveal:false, bell:false, roomKey, questions:[] });
  } else {
    roomKey = s.data().roomKey || null;
  }
}
function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom = onSnapshot(doc(db,'rooms',id),(snap)=>{
    if(!snap.exists()) return;
    const r=snap.data();
    window.__lastRoom = r;
    renderRoom(r);
  });
}
function listenResponses(id){
  if(unsubResponses) unsubResponses();
  unsubResponses = onSnapshot(collection(db,'rooms',id,'responses'),(snap)=>{
    const arr=[]; snap.forEach(d=>arr.push({id:d.id,...d.data()}));
    renderResponses(arr);
  });
}
async function updateRoom(patch){
  if(!roomId) return;
  await setDoc(doc(db,'rooms',roomId), patch, {merge:true});
}
async function stepIndex(delta){
  const ref=doc(db,'rooms',roomId);
  await runTransaction(db, async (tx)=>{
    const s=await tx.get(ref); const r=s.data(); const max=(r.questions?.length||0)-1;
    const next = clamp((r.currentIndex??-1)+delta, 0, Math.max(0,max));
    tx.set(ref,{ currentIndex: next, accept:true },{merge:true});
  });
}

// ===== Render =====
function renderRoom(r){
  liveState.textContent = (r.mode==='active'?'진행중':(r.mode==='ended'?'마감':'대기'));
  if(MODE==='teacher'){
    roomInfo.textContent = `세션: ${roomId} · 상태: ${liveState.textContent}`;
    toggleAccept.checked=!!r.accept; toggleReveal.checked=!!r.reveal; toggleBell.checked=!!r.bell;
    const q=r.questions?.[r.currentIndex]; ctlQuestion.textContent=q?`${r.currentIndex+1}. ${q.text}`:'-';
    shortGrader.classList.toggle('hidden', !(q && q.type==='short'));
    if(q && q.type==='short') buildShortAnswerList(r);
  }
  if(MODE==='student'){
    const idx=r.currentIndex; const q=r.questions?.[idx];
    if(r.mode!=='active'||!q){
      studentQuiz.classList.remove('hidden');
      questionText.textContent='대기 중입니다…'; optionsContainer.innerHTML=''; subjectiveBox.classList.add('hidden');
      progressText.textContent='0 / 0'; quizTypeBadge.textContent='대기'; answerState.textContent='';
      return;
    }
    progressText.textContent=`${idx+1} / ${r.questions.length}`;
    questionText.textContent=q.text; quizTypeBadge.textContent=q.type==='mcq'?'객관식':'주관식'; answerState.textContent='';
    if(q.type==='mcq'){
      optionsContainer.innerHTML=''; subjectiveBox.classList.add('hidden');
      (q.options||[]).forEach((opt,i)=>{
        const b=document.createElement('button'); b.className='option'; b.textContent=opt; b.dataset.opt=String(i); b.disabled=!r.accept;
        optionsContainer.appendChild(b);
      });
    }else{
      optionsContainer.innerHTML=''; subjectiveBox.classList.remove('hidden'); subjectiveInput.value=''; btnSubmitSubjective.disabled=!r.accept;
    }
  }
}

function renderResponses(arr){
  if(MODE==='teacher'){
    chips.innerHTML=''; const room=window.__lastRoom||{};
    arr.forEach(s=>{
      const a=s.answers?.[room.currentIndex]; const chip=document.createElement('div');
      chip.className='chip '+(a? (a.correct?'ok': (room.reveal?'no':'')) : '');
      chip.textContent=s.name||s.id; chips.appendChild(chip);
    });
    buildShortAnswerListCached(arr);
    buildResults(arr);
  }
  if(MODE==='student'&&me.id){
    const mine=arr.find(x=>x.id===me.id); if(!mine) return;
    const idx=(window.__lastRoom||{}).currentIndex; const ans=mine.answers?.[idx];
    qsa('.option').forEach((el,i)=>{
      el.classList.remove('selected','correct','wrong');
      if(ans && typeof ans.value==='number'){
        if(i===ans.value) el.classList.add('selected');
        if((window.__lastRoom||{}).reveal){
          if(ans.correct && i===ans.value) el.classList.add('correct');
          if(!ans.correct && i===ans.value) el.classList.add('wrong');
        }
      }
    });
    if(ans && typeof ans.value==='string'){
      answerState.textContent = (window.__lastRoom||{}).reveal ? (ans.correct?'정답!':'오답') : `제출: ${ans.value}`;
    }
  }
}

function buildShortAnswerList(room){
  window.__lastRoom=room;
  getDocs(collection(db,'rooms',roomId,'responses')).then(s=>{
    const arr=[]; s.forEach(d=>arr.push({id:d.id,...d.data()}));
    buildShortAnswerListCached(arr);
  });
}
function buildShortAnswerListCached(arr){
  if(MODE!=='teacher') return; const room=window.__lastRoom||{}; const q=room.questions?.[room.currentIndex]; if(!q||q.type!=='short') return;
  shortAnswers.innerHTML='';
  arr.forEach(s=>{
    const a=s.answers?.[room.currentIndex]; if(!a||typeof a.value!=='string') return;
    const row=document.createElement('div'); row.className='row'; row.style.justifyContent='space-between';
    const left=document.createElement('div'); left.textContent=`${s.name}: ${a.value}`;
    const right=document.createElement('div');
    const ok=document.createElement('button'); ok.className='btn ghost sm'; ok.textContent='정답';
    const no=document.createElement('button'); no.className='btn ghost sm'; no.textContent='오답';
    ok.onclick=()=>gradeAnswer(s.id, room.currentIndex,true);
    no.onclick=()=>gradeAnswer(s.id, room.currentIndex,false);
    right.append(ok,no); row.append(left,right); shortAnswers.appendChild(row);
  });
}

async function gradeAnswer(uid, qIndex, correct){
  await setDoc(doc(db,'rooms',roomId,'responses',uid),{
    [`answers.${qIndex}.correct`]: !!correct, [`answers.${qIndex}.revealed`]: true
  },{merge:true});
}

// 제출(기기당 1회/문항)
async function submitAnswer(value){
  if(!me.id){ alert('먼저 참가하세요'); return; }
  const rRef=doc(db,'rooms',roomId); const rSnap=await getDoc(rRef); const r=rSnap.data()||{};
  if(!r.accept){ alert('현재 제출이 허용되지 않습니다.'); return; }
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;

  const myRef=doc(db,'rooms',roomId,'responses',me.id); const mySnap=await getDoc(myRef);
  const already = mySnap.exists() && mySnap.data().answers && (mySnap.data().answers[idx]!=null);
  if(already){ alert('이미 제출했습니다.'); return; }

  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  else if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }

  await setDoc(myRef,{
    name: me.name, roomKey: r.roomKey || null,
    [`answers.${idx}`]: { value, correct: (correct===true), revealed: (q.type==='mcq') }
  },{merge:true});
}

function buildResults(arr){
  if(MODE!=='teacher') return; const room=window.__lastRoom||{}; const qsList=room.questions||[];
  const table=document.createElement('table'); table.className='table';
  const thead=document.createElement('thead'); const htr=document.createElement('tr');
  ['이름', ...qsList.map((_,i)=>`Q${i+1}`), '점수','상태'].forEach(h=>{ const th=document.createElement('th'); th.textContent=h; htr.appendChild(th); }); thead.appendChild(htr); table.appendChild(thead);
  const tbody=document.createElement('tbody');
  arr.forEach(s=>{
    const tr=document.createElement('tr'); const tdName=document.createElement('td'); tdName.textContent=s.name||s.id; tr.appendChild(tdName);
    let score=0;
    qsList.forEach((q,i)=>{ const td=document.createElement('td'); const a=s.answers?.[i];
      if(a){ if(a.correct) score++; td.textContent = q.type==='mcq' ? (typeof a.value==='number'?String(a.value+1):'-') : (a.value||'-'); } else td.textContent='-';
      tr.appendChild(td);
    });
    const tdScore=document.createElement('td'); tdScore.textContent=String(score); tr.appendChild(tdScore);
    const tdStat=document.createElement('td'); tdStat.textContent=s.status||'-'; tr.appendChild(tdStat);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  resultsContainer.innerHTML=''; resultsContainer.appendChild(table);
}

// ===== QR/링크 =====
function refreshStudentLink(){
  const url=new URL(location.href);
  url.searchParams.set('mode','student'); url.searchParams.set('room',roomId);
  const link=url.toString();
  studentLink.value=link;
  qrDom.innerHTML='';
  // window.QRCode (from qrcodejs) 는 index.html에서 먼저 로드됨
  new QRCode(qrDom,{text:link,width:200,height:200,correctLevel:QRCode.CorrectLevel.M});
}

// ===== 유틸/폼 =====
function buildQuestionRow(no,q){
  const w=document.createElement('div'); w.className='card';
  w.innerHTML=`
    <div class="row wrap">
      <div style="min-width:80px"><span class="badge">${no}번</span></div>
      <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${(q?.type==='short')?'':'checked'}> 객관식</label>
      <label class="switch"><input type="radio" name="type-${no}" value="short" ${(q?.type==='short')?'checked':''}> 주관식</label>
    </div>
    <div class="row" style="margin-top:6px"><input class="q-text" data-no="${no}" placeholder="문항 내용" value="${esc(q?.text||'')}" style="flex:1"></div>
    <div class="mcq ${(q?.type==='short')?'hidden':''}" style="margin-top:8px">
      <div class="grid" style="grid-template-columns:repeat(2,1fr);gap:8px">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt" data-no="${no}" data-idx="${i}" placeholder="보기 ${i+1}" value="${esc(v)}">`).join('')}
      </div>
      <div class="row" style="margin-top:6px;gap:6px">
        <label>정답 번호</label>
        <input class="ansIndex" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}" style="width:90px">
      </div>
    </div>
    <div class="short ${(q?.type==='short')?'':'hidden'}" style="margin-top:8px">
      <input class="ansText" data-no="${no}" placeholder="정답(자동채점용, 선택)" value="${esc(q?.answerText||'')}" style="width:300px">
    </div>
  `;
  const radios=qsa(`input[name="type-${no}"]`,w); const mcq=qs('.mcq',w); const sh=qs('.short',w);
  radios.forEach(r=>r.onchange=()=>{ const isSh=radios.find(x=>x.checked)?.value==='short'; mcq.classList.toggle('hidden',isSh); sh.classList.toggle('hidden',!isSh); });
  return w;
}
function collectQuizFromBuilder(){
  const title=quizTitle.value||'퀴즈'; const cards=qsa('#builder>.card');
  const questions=cards.map((c,idx)=>{
    const no=idx+1; const type=c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text=c.querySelector('.q-text').value.trim(); if(!text) return null;
    if(type==='mcq'){ const opts=qsa('.opt',c).map(x=>x.value.trim()).filter(Boolean);
      const ans=clamp(parseInt(c.querySelector('.ansIndex').value,10)-1,0,Math.max(0,opts.length-1));
      return {type:'mcq', text, options:opts, answerIndex:ans};
    } else {
      const at=c.querySelector('.ansText').value.trim(); return {type:'short', text, answerText:at};
    }
  }).filter(Boolean);
  return { title, questions };
}

// ===== CSV / download =====
async function exportCSV(){
  if(!roomId) return;
  const r=(await getDoc(doc(db,'rooms',roomId))).data(); const res=await getDocs(collection(db,'rooms',roomId,'responses'));
  const rows=[]; rows.push(['userId','name',...(r.questions||[]).map((_,i)=>`Q${i+1}`),'score','status'].join(','));
  res.forEach(d=>{
    const v=d.data(); let score=0;
    const ans=(r.questions||[]).map((q,i)=>{ const a=v.answers?.[i]; if(a?.correct) score++; return csv(a?.value??''); });
    rows.push([d.id, csv(v.name), ...ans, score, v.status||''].join(','));
  });
  downloadFile(`${(r.title||roomId)}-results.csv`, rows.join('\n'));
}
function downloadFile(name,content,type='text/csv'){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href); }

// ===== helpers =====
function clamp(n,min,max){ return Math.max(min,Math.min(max,n)); }
function esc(s=''){ return s.replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&gt;","\"":"&quot;","'":"&#39;"}[m])); }
function csv(v){ const s=String(v??''); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }
function formatMMSS(sec){ const m=String(Math.floor(sec/60)).padStart(2,'0'); const s=String(sec%60).padStart(2,'0'); return `${m}:${s}`; }

// ===== URL 파라미터로 학생 모드 진입 지원 =====
(function bootByURL(){
  const p=new URLSearchParams(location.search);
  const m=p.get('mode'); const r=p.get('room');
  if(r){ roomIdInput.value=r; btnConnect.click(); }
  if(m==='student') setMode('student');
})();

// 초기 모드
setMode('student');
