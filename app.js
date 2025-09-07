// app.js (module)
import { initializeApp, getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc,
         collection, getDocs, runTransaction, serverTimestamp } from './fb-proxy.js';

// fb-proxy.js 없이 바로 쓰는 경우 (index.html에서 window.__fb 주입)
const FB = window.__fb || { initializeApp, getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc, collection, getDocs, runTransaction, serverTimestamp };

/* =========================
   Firebase 초기화
========================= */
const firebaseConfig = {
  apiKey: "AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo",
  authDomain: "live-quiz-a14d1.firebaseapp.com",
  projectId: "live-quiz-a14d1",
};
const app = FB.initializeApp(firebaseConfig);
const db  = FB.getFirestore(app);

/* =========================
   Dom Helper
========================= */
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));
const pad = n=>String(n).padStart(2,'0');

/* =========================
   공통 상태
========================= */
let MODE = 'admin';           // 'admin' | 'student'
let roomId = '';
let me = { id:null, name:'' };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;  // 프레젠테이션 표시용
let sTimerHandle=null; // 학생 표시용

/* =========================
   엘리먼트 수집
========================= */
const els = {
  // 상단
  liveDot: $("#liveDot"), sLiveDot:$("#sLiveDot"),
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnSessionOut:$("#btnSessionOut"), roomStatus:$("#roomStatus"),
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),

  // 문항
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
  btnBlank: $("#btnBlank"), btnSample: $("#btnSample"), btnSaveQuiz: $("#btnSaveQuiz"), builder: $("#builder"),

  // 옵션
  panelBuild: $("#panelBuild"), panelOptions: $("#panelOptions"), panelPresent:$("#panelPresent"), panelResults:$("#panelResults"),

  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright:$("#chkBright"),
  policyDevice: $("#policyDevice"), policyRealname: $("#policyRealname"),
  timerSec: $("#timerSec"), btnSaveOptions: $("#btnSaveOptions"),

  qr: $("#qrCanvas"), studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

  // 프레젠테이션
  pTitle: $("#pTitle"), pWait:$("#pWait"), pQbox:$("#pQbox"), pQ:$("#pQ"), pOpts:$("#pOpts"),
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll:$("#btnEndAll"),
  pJoin: $("#pJoin"), pSubmit: $("#pSubmit"), pCorrect: $("#pCorrect"), pWrong: $("#pWrong"), pTimer:$("#pTimer"),

  // 결과
  resultsTable: $("#resultsTable"), btnExportCSV: $("#btnExportCSV"), btnResetAll:$("#btnResetAll"),
  leaderBoard: $("#leaderBoard"),

  // 학생
  studentBar: $("#studentBar"), studentMain: $("#studentMain"),
  sRoomText: $("#sRoomText"), studentName: $("#studentName"), btnJoin: $("#btnJoin"),
  sTitle: $("#sTitle"), sBadge: $("#sBadge"), sTimer:$("#sTimer"),
  sQText: $("#sQText"), mcqBox: $("#mcqBox"), shortBox: $("#shortBox"), shortInput: $("#shortInput"), btnShortSend: $("#btnShortSend"),
  sNote: $("#sNote"), sEnded:$("#sEnded"), btnShowMyResult:$("#btnShowMyResult"), sMyResult:$("#sMyResult"),
};

/* =========================
   로컬 저장 / 로드
========================= */
function saveLocal(){ localStorage.setItem('quiz.live', JSON.stringify({ roomId, MODE, me }));}
function loadLocal(){
  try{
    const d = JSON.parse(localStorage.getItem('quiz.live')||'{}');
    roomId = d.roomId||''; MODE = d.MODE||'admin'; me = d.me||{id:null,name:''};
    if(roomId) els.roomId.value = roomId;
  }catch{}
}

/* =========================
   Firestore refs
========================= */
const roomRef = id => FB.doc(db,'rooms',id);
const respCol = id => FB.collection(db,'rooms',id,'responses');

/* =========================
   기본 함수
========================= */
async function ensureRoom(id){
  const snap=await FB.getDoc(roomRef(id));
  if(!snap.exists()){
    await FB.setDoc(roomRef(id), {
      title:'새 세션', mode:'idle', currentIndex:-1, accept:false, reveal:false,
      createdAt: FB.serverTimestamp(), policy:'device', bright:false, timer:30,
      questions:[]
    });
  }
}
function setLive(on){ [els.liveDot, els.sLiveDot].forEach(d=> d?.classList.toggle('on', !!on)); }

/* =========================
   연결/세션
========================= */
async function connect(){
  const id=(els.roomId.value||'').trim();
  if(!id) return alert('클래스(세션) 코드를 입력하세요.');
  roomId=id;
  els.roomId.readOnly=true;
  els.btnConnect.classList.add('hide');
  els.btnSessionOut.classList.remove('hide');
  els.roomStatus.textContent=`세션: ${roomId} · 온라인`; setLive(true);
  await ensureRoom(roomId);
  listenRoom(roomId);
  listenResponses(roomId);
  buildStudentLink(); // 옵션 탭에서 QR 표시용
  saveLocal();
}
function sessionOut(){
  els.roomId.readOnly=false;
  els.btnConnect.classList.remove('hide');
  els.btnSessionOut.classList.add('hide');
  els.roomStatus.textContent='세션 아웃'; setLive(false);
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  unsubRoom=null; unsubResp=null;
}

/* =========================
   구독
========================= */
function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom = FB.onSnapshot(roomRef(id), snap=>{
    if(!snap.exists()) return;
    const r=snap.data(); window.__room=r;
    renderRoom(r);
  });
}
function listenResponses(id){
  if(unsubResp) unsubResp();
  unsubResp = FB.onSnapshot(respCol(id), s=>{
    const arr=[]; s.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    renderResponses(arr);
  });
}

/* =========================
   탭 스위치(관리자)
========================= */
function switchTab(which){
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove('active'));
  which.classList.add('active');
  els.panelBuild.classList.toggle('hide', which!==els.tabBuild);
  els.panelOptions.classList.toggle('hide', which!==els.tabOptions);
  els.panelPresent.classList.toggle('hide', which!==els.tabPresent);
  els.panelResults.classList.toggle('hide', which!==els.tabResults);
}

/* =========================
   빌더 UI (문항/보기 라벨)
========================= */
function qCard(no,q){
  const wrap=document.createElement('div');
  wrap.className='qcard';
  wrap.innerHTML = `
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="radio"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'} /> <span>객관식</span></label>
      <label class="radio"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''} /> <span>주관식</span></label>
    </div>

    <div class="row wrap">
      <span class="hint">문항:</span>
      <input class="qtext input xl" placeholder="문항 내용" value="${q?.text||''}" />
    </div>

    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        <span class="hint">보기1:</span><input class="opt input" data-idx="0" value="${q?.options?.[0]||''}" />
      </div>
      <div class="row wrap">
        <span class="hint">보기2:</span><input class="opt input" data-idx="1" value="${q?.options?.[1]||''}" />
      </div>
      <div class="row wrap">
        <span class="hint">보기3:</span><input class="opt input" data-idx="2" value="${q?.options?.[2]||''}" />
      </div>
      <div class="row wrap">
        <span class="hint">보기4:</span><input class="opt input" data-idx="3" value="${q?.options?.[3]||''}" />
      </div>
      <div class="row wrap">
        <span class="hint">정답 번호</span><input class="ansIndex input xs" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}" />
      </div>
    </div>

    <div class="short ${q?.type==='short'?'':'hide'}">
      <div class="row wrap">
        <span class="hint">정답(선택)</span><input class="ansText input" value="${q?.answerText||''}" />
      </div>
    </div>
  `;
  const radios = $$(`input[name="type-${no}"]`, wrap);
  const mcq = $(".mcq", wrap), short=$(".short", wrap);
  radios.forEach(r=> r.addEventListener('change', ()=>{
    const isShort = radios.find(x=>x.checked)?.value==='short';
    mcq.classList.toggle('hide', isShort);
    short.classList.toggle('hide', !isShort);
  }));
  return wrap;
}
function collectQuiz(){
  const title = (els.quizTitle.value||'퀴즈').trim();
  const cards = $$("#builder>.qcard");
  const questions = cards.map((c,idx)=>{
    const type = c.querySelector(`input[name="type-${idx+1}"]:checked`).value;
    const text = c.querySelector('.qtext').value.trim();
    if(!text) return null;
    if(type==='mcq'){
      const opts = $$('.opt',c).map(o=>o.value.trim()).filter(Boolean);
      const ans = Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector('.ansIndex').value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans };
    } else {
      return { type:'short', text, answerText: c.querySelector('.ansText').value.trim() };
    }
  }).filter(Boolean);
  return { title, questions };
}

/* =========================
   옵션 저장 + QR
========================= */
async function saveOptions(){
  if(!roomId) return alert('세션에 먼저 접속하세요.');
  const policy = els.policyRealname.checked ? 'realname' : 'device';
  const accept = !!els.chkAccept.checked;
  const reveal = !!els.chkReveal.checked;
  const bright = !!els.chkBright.checked;
  const timer = Math.max(5, Math.min(600, parseInt(els.timerSec.value,10)||30));
  await FB.updateDoc(roomRef(roomId), { policy, accept, reveal, bright, timer }, { merge:true });
  buildStudentLink(); // 저장 직후 QR/링크 갱신
  alert('옵션을 저장했어요.');
}
function buildStudentLink(){
  if(!els.studentLink) return;
  const url=new URL(location.href);
  url.searchParams.set('role','student');
  url.searchParams.set('room', roomId||'');
  els.studentLink.value=url.toString();
  if(window.QRCode && els.qr){
    window.QRCode.toCanvas(els.qr, els.studentLink.value, { width: 180, margin:1 }, ()=>{});
  }
}

/* =========================
   프레젠테이션: 시작/다음/종료/타이머
========================= */
async function startQuiz(){
  const r=(await FB.getDoc(roomRef(roomId))).data();
  if(!r.questions?.length) return alert('저장된 문항이 없습니다.');
  await FB.updateDoc(roomRef(roomId), { mode:'active', currentIndex:0, accept:true }, { merge:true });
}
async function step(delta){
  await FB.runTransaction(db, async (tx)=>{
    const snap=await tx.get(roomRef(roomId));
    const r=snap.data(); const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){
      // 마지막을 지나가면 종료 → 결과 탭으로
      tx.update(roomRef(roomId), { currentIndex: total-1, mode:'ended', accept:false });
      return;
    }
    next=Math.max(0,next);
    tx.update(roomRef(roomId), { currentIndex: next, accept:true });
  });
}
async function finishAll(){
  await FB.updateDoc(roomRef(roomId), { mode:'ended', accept:false }, { merge:true });
}

/* =========================
   제출/채점/정책
========================= */
async function join(){
  if(!roomId) return alert('세션이 설정되지 않았습니다.');
  const name=(els.studentName.value||'').trim();
  if(!name) return alert('이름 혹은 번호를 입력하세요!');
  me = { id: localStorage.getItem('quiz.device') || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem('quiz.device', me.id);
  await FB.setDoc(FB.doc(respCol(roomId), me.id), { name, joinedAt:FB.serverTimestamp(), answers:{}, alive:true }, { merge:true });
  alert('참가 완료! 시작을 기다려 주세요.');
  saveLocal();
}
async function submit(value){
  const r=window.__room; if(!r?.accept) return alert('지금은 제출할 수 없습니다.');
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
  const policy = r.policy||'device';
  // 정책: device(기기당1회), realname(실명당1회: 같은 이름이면 막기)
  if(policy==='realname'){
    const all=await FB.getDocs(respCol(roomId));
    let dup=false;
    all.forEach(d=>{
      const s=d.data();
      if(s.name===me.name && s.answers?.[idx]!=null && d.id!==me.id) dup=true;
    });
    if(dup) return alert('이미 동일 이름으로 제출된 답이 있습니다.');
  }

  const ref=FB.doc(respCol(roomId), me.id);
  const snap=await FB.getDoc(ref);
  const prev=snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert('이미 제출했습니다.');

  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase();
    if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await FB.setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true) } }, { merge:true });
  els.sNote.textContent = '제출 완료! 다음 문제를 기다려 주세요.';
}

/* =========================
   렌더: 룸/응답
========================= */
function renderRoom(r){
  // 상단 상태/밝은 모드
  document.body.classList.toggle('bright', !!r.bright);
  els.pTitle.textContent = r.title||roomId||'-';
  els.sTitle.textContent = r.title||'-';
  els.sRoomText.textContent = `세션: ${roomId||'-'}`;

  // 옵션 값 반영(토글/라디오/타이머) - 관리자
  if(MODE==='admin'){
    els.chkAccept.checked = !!r.accept;
    els.chkReveal.checked = !!r.reveal;
    els.chkBright.checked = !!r.bright;
    (r.policy==='realname' ? els.policyRealname : els.policyDevice).checked = true;
    els.timerSec.value = r.timer||30;

    // 프레젠테이션 영역
    const idx=r.currentIndex; const total=r.questions?.length||0;
    if(r.mode!=='active' || idx<0){
      els.pQbox.classList.add('hide'); els.pWait.classList.remove('hide');
    } else {
      els.pWait.classList.add('hide'); els.pQbox.classList.remove('hide');
      const q=r.questions[idx]; els.pQ.textContent=q.text;
      els.pOpts.innerHTML='';
      if(q.type==='mcq'){
        q.options.forEach((t,i)=>{
          const d=document.createElement('div'); d.className='popt'; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d);
        });
      } else {
        const d=document.createElement('div'); d.className='popt'; d.textContent='주관식 문제입니다.'; els.pOpts.appendChild(d);
      }
    }

    // 자동 종료 시 안내
    if(r.mode==='ended'){
      els.pQbox.classList.add('hide'); els.pWait.classList.remove('hide');
      els.pWait.textContent='퀴즈가 종료되었습니다. 결과 탭에서 확인하세요.';
      switchTab(els.tabResults);
    }

    // 관리자 타이머 표시
    clearInterval(timerHandle);
    timerHandle = setInterval(()=>{
      const sec=r.timer||30; // 옵션값 표시용 카운터(시작 기준 단순 표시)
      const txt=`${pad(Math.floor(sec/60))}:${pad(sec%60)}`;
      els.pTimer.textContent=txt;
    },1000);
  }

  // 학생 화면
  if(MODE==='student'){
    if(r.mode!=='active' || (r.currentIndex??-1)<0){
      els.sBadge.textContent='대기';
      els.sQText.textContent='대기 중입니다…';
      els.mcqBox.innerHTML=''; els.shortBox.classList.add('hide');
    } else {
      const q=r.questions[r.currentIndex];
      els.sBadge.textContent = q.type==='mcq'?'객관식':'주관식';
      els.sQText.textContent = q.text;

      if(q.type==='mcq'){
        els.mcqBox.innerHTML='';
        q.options.forEach((opt,i)=>{
          const b=document.createElement('button');
          b.className='optbtn'; b.textContent=`${i+1}. ${opt}`; b.disabled=!r.accept;
          b.onclick=()=> submit(i);
          els.mcqBox.appendChild(b);
        });
        els.shortBox.classList.add('hide');
      }else{
        els.mcqBox.innerHTML='';
        els.shortBox.classList.remove('hide');
        els.btnShortSend.disabled=!r.accept;
      }
      // 학생 타이머 간단 표시(옵션값 기반)
      clearInterval(sTimerHandle);
      let sec=r.timer||30; els.sTimer.textContent=`${pad(Math.floor(sec/60))}:${pad(sec%60)}`;
      sTimerHandle=setInterval(()=>{
        sec=Math.max(0,sec-1);
        els.sTimer.textContent=`${pad(Math.floor(sec/60))}:${pad(sec%60)}`;
      },1000);
    }

    if(r.mode==='ended'){
      els.sEnded.classList.remove('hide');
    }
  }
}
function renderResponses(list){
  // 프레젠테이션 상단 카운트/리더보드
  const r=window.__room||{};
  const idx=r.currentIndex;
  const submitted=list.filter(s=> s.answers?.[idx]!=null);
  const correct=submitted.filter(s=> s.answers[idx].correct);
  const wrong=submitted.filter(s=> !s.answers[idx].correct);
  els.pJoin.textContent=String(list.length||0);
  els.pSubmit.textContent=String(submitted.length||0);
  els.pCorrect.textContent=String(correct.length||0);
  els.pWrong.textContent=String(wrong.length||0);

  // 결과표(관리자) + 리더보드
  if(MODE==='admin'){
    const tbl=document.createElement('table');
    const thead=document.createElement('thead'); const trh=document.createElement('tr');
    ['이름', ...(r.questions||[]).map((_,i)=>`Q${i+1}`), '점수'].forEach(h=>{
      const th=document.createElement('th'); th.textContent=h; trh.appendChild(th);
    });
    thead.appendChild(trh); tbl.appendChild(thead);
    const tb=document.createElement('tbody');
    const rows=list.map(s=>{
      let score=0; const tr=document.createElement('tr');
      const tdN=document.createElement('td'); tdN.textContent=s.name||s.id; tr.appendChild(tdN);
      (r.questions||[]).forEach((q,i)=>{
        const a=s.answers?.[i]; const td=document.createElement('td');
        td.textContent = a ? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value??'-')) : '-';
        if(a?.correct) score++; tr.appendChild(td);
      });
      const tdS=document.createElement('td'); tdS.textContent=String(score); tr.appendChild(tdS);
      tb.appendChild(tr);
      return { id:s.id, name:s.name, score };
    });
    tbl.appendChild(tb);
    els.resultsTable.innerHTML=''; els.resultsTable.appendChild(tbl);

    // 리더보드(점수순)
    rows.sort((a,b)=>b.score-a.score);
    const ul=document.createElement('ol');
    rows.forEach(rw=>{
      const li=document.createElement('li'); li.textContent=`${rw.name} · ${rw.score}`;
      ul.appendChild(li);
    });
    els.leaderBoard.innerHTML=''; els.leaderBoard.appendChild(ul);
  }
}

/* =========================
   이벤트 바인딩
========================= */
els.btnConnect.addEventListener('click', connect);
els.btnSessionOut.addEventListener('click', sessionOut);

[els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(btn=>{
  btn?.addEventListener('click', ()=> switchTab(btn));
});

els.btnBlank.addEventListener('click', ()=>{
  const n=Math.max(1,Math.min(20, parseInt(els.questionCount.value,10)||3));
  els.builder.innerHTML='';
  for(let i=0;i<n;i++) els.builder.appendChild(qCard(i+1));
});
els.btnSample.addEventListener('click', ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)은?', answerText:'100'},
    {type:'mcq', text:'지구의 위성은?', options:['포보스','데이모스','달','가니메데'], answerIndex:2},
  ];
  els.builder.innerHTML='';
  S.forEach((q,i)=> els.builder.appendChild(qCard(i+1,q)));
  els.quizTitle.value='샘플 퀴즈';
  els.questionCount.value=S.length;
});
els.btnSaveQuiz.addEventListener('click', async ()=>{
  if(!roomId) return alert('세션에 먼저 접속하세요.');
  const payload=collectQuiz();
  if(!payload.questions.length) return alert('문항을 추가하세요.');
  await FB.setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert('문항을 저장했습니다.');
});

els.btnSaveOptions.addEventListener('click', saveOptions);
els.btnCopyLink.addEventListener('click', async ()=>{
  await navigator.clipboard.writeText(els.studentLink.value||'');
  els.btnCopyLink.textContent='복사됨'; setTimeout(()=> els.btnCopyLink.textContent='복사', 900);
});
els.btnOpenStudent.addEventListener('click', ()=> window.open(els.studentLink.value||'#','_blank'));

els.btnStart.addEventListener('click', startQuiz);
els.btnPrev.addEventListener('click', ()=>step(-1));
els.btnNext.addEventListener('click', ()=>step(+1));
els.btnEndAll.addEventListener('click', finishAll);

els.btnExportCSV.addEventListener('click', async ()=>{
  const r=(await FB.getDoc(roomRef(roomId))).data();
  const snap=await FB.getDocs(respCol(roomId));
  const rows=[]; rows.push(['name', ...(r.questions||[]).map((_,i)=>`Q${i+1}`), 'score'].join(','));
  snap.forEach(d=>{
    const s=d.data(); let score=0;
    const line=(r.questions||[]).map((q,i)=>{ const a=s.answers?.[i]; if(a?.correct) score++; return q.type==='mcq' ? (typeof a?.value==='number'? a.value+1 : '') : (a?.value??'');});
    rows.push([`"${(s.name||'').replace(/"/g,'""')}"`, ...line, score].join(','));
  });
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([rows.join('\n')],{type:'text/csv'}));
  a.download=`${r.title||roomId}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
});
els.btnResetAll.addEventListener('click', async ()=>{
  if(!confirm('모든 응답/점수를 초기화할까요?')) return;
  await FB.setDoc(roomRef(roomId), { mode:'idle', currentIndex:-1, accept:false, reveal:false }, { merge:true });
  const snap=await FB.getDocs(respCol(roomId)); const jobs=[];
  snap.forEach(d=> jobs.push(FB.setDoc(FB.doc(respCol(roomId), d.id), { answers:{}, alive:true }, { merge:true })));
  await Promise.all(jobs);
  alert('초기화 완료');
});

// 학생
els.btnJoin.addEventListener('click', join);
els.btnShortSend.addEventListener('click', ()=> submit((els.shortInput.value||'').trim()));
els.btnShowMyResult.addEventListener('click', async ()=>{
  const r=(await FB.getDoc(roomRef(roomId))).data();
  const snap=await FB.getDoc(FB.doc(respCol(roomId), me.id));
  const s=snap.exists()? snap.data() : {};
  const box=els.sMyResult; box.classList.remove('hide'); box.innerHTML='';
  const tbl=document.createElement('table');
  const th=document.createElement('thead'); const tr=document.createElement('tr');
  ['문항','제출','정답'].forEach(h=>{const thx=document.createElement('th'); thx.textContent=h; tr.appendChild(thx);});
  th.appendChild(tr); tbl.appendChild(th);
  const tb=document.createElement('tbody');
  (r.questions||[]).forEach((q,i)=>{
    const a=s.answers?.[i]; const tr=document.createElement('tr');
    const td1=document.createElement('td'); td1.textContent=String(i+1); tr.appendChild(td1);
    const td2=document.createElement('td'); td2.textContent = a ? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value??'-')) : '-'; tr.appendChild(td2);
    const td3=document.createElement('td'); td3.textContent = a ? (a.correct?'O':'X') : '×'; tr.appendChild(td3);
    tb.appendChild(tr);
  });
  tbl.appendChild(tb); box.appendChild(tbl);
});

/* =========================
   초기 부팅
========================= */
function setMode(m){
  MODE=m;
  const isAdmin = m==='admin';
  document.querySelectorAll('.admin-only').forEach(e=> e.classList.toggle('hide', !isAdmin));
  document.querySelectorAll('.student-only').forEach(e=> e.classList.toggle('hide', isAdmin));
  els.roomStatus.textContent = roomId ? `세션: ${roomId} · 온라인` : '세션 아웃';
}
function autoRestore(){
  loadLocal();
  const url=new URL(location.href);
  const role=url.searchParams.get('role'); const rid=url.searchParams.get('room');
  if(role==='student') MODE='student';
  if(rid){ roomId=rid; els.roomId.value=rid; connect(); }
  else setMode(MODE);
}
autoRestore();

// 첫 화면은 문항 탭이 보이도록(관리자), 학생 링크/QR은 옵션 탭에서만 노출됨
switchTab(els.tabBuild);
