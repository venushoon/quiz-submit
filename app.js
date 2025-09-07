import {
  collection, doc, setDoc, getDoc, getDocs, onSnapshot,
  updateDoc, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const $  = (s, el=document)=>el.querySelector(s);
const $$ = (s, el=document)=>Array.from(el.querySelectorAll(s));
const pad = n=>String(n).padStart(2,'0');

let MODE='admin', roomId='', me={id:null,name:''};
let unsubRoom=null, unsubResp=null, timerHandle=null, mcqSelected=null;

const els={
  roomId:$('#roomId'),btnConnect:$('#btnConnect'),btnSignOut:$('#btnSignOut'),
  roomStatus:$('#roomStatus'),liveDot:$('#liveDot'),
  tabBuild:$('#tabBuild'),tabOptions:$('#tabOptions'),tabPresent:$('#tabPresent'),tabResults:$('#tabResults'),
  panelBuild:$('#panelBuild'),panelOptions:$('#panelOptions'),panelPresent:$('#panelPresent'),panelResults:$('#panelResults'),
  quizTitle:$('#quizTitle'),questionCount:$('#questionCount'),
  btnBuildForm:$('#btnBuildForm'),btnLoadSample:$('#btnLoadSample'),btnSaveQuiz:$('#btnSaveQuiz'),builder:$('#builder'),
  fileUploadTxt:$('#fileUploadTxt'),btnUploadTxt:$('#btnUploadTxt'),btnDownloadTemplate:$('#btnDownloadTemplate'),
  chkAccept:$('#chkAccept'),chkReveal:$('#chkReveal'),chkBright:$('#chkBright'),timerSec:$('#timerSec'),btnSaveOptions:$('#btnSaveOptions'),
  studentAccess:$('#studentAccess'),qrCanvas:$('#qrCanvas'),studentLink:$('#studentLink'),btnCopyLink:$('#btnCopyLink'),btnOpenStudent:$('#btnOpenStudent'),
  btnStart:$('#btnStart'),btnPrev:$('#btnPrev'),btnNext:$('#btnNext'),btnEndAll:$('#btnEndAll'),
  leftSec:$('#leftSec'),pTitle:$('#pTitle'),pQ:$('#pQ'),pImg:$('#pImg'),pOpts:$('#pOpts'),presentWait:$('#presentWait'),
  statJoin:$('#statJoin'),statSubmit:$('#statSubmit'),statCorrect:$('#statCorrect'),statWrong:$('#statWrong'),
  btnExportCSV:$('#btnExportCSV'),btnResetAll:$('#btnResetAll'),resultsTable:$('#resultsTable'),
  studentPanel:$('#studentPanel'),studentTopInfo:$('#studentTopInfo'),
  studentJoin:$('#studentJoin'),studentName:$('#studentName'),btnJoin:$('#btnJoin'),
  studentQuiz:$('#studentQuiz'),badgeType:$('#badgeType'),sQText:$('#sQText'),
  mcqBox:$('#mcqBox'),btnSubmitMCQ:$('#btnSubmitMCQ'),
  shortBox:$('#shortBox'),shortInput:$('#shortInput'),btnShortSend:$('#btnShortSend'),
  studentDone:$('#studentDone'),studentResult:$('#studentResult'),studentResultBody:$('#studentResultBody'),
  studentTimer:$('#studentTimer'), sImg:$('#sImg'),
};

const roomRef=id=>doc(db,'rooms',id);
const respCol=id=>collection(db,'rooms',id,'responses');

async function ensureRoom(id){
  const snap=await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id),{
      title:'새 세션', mode:'idle', currentIndex:-1, accept:false, reveal:false, bright:false,
      policy:'device', timerSec:30, createdAt:serverTimestamp(), questions:[]
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
    const arr=[]; qs.forEach(d=>arr.push({id:d.id,...d.data()})); renderResponses(arr);
  });
}

/* 모드/탭 */
function setMode(m){
  MODE=m;
  const isAdmin = (m==='admin');
  // 헤더의 admin-only 전부 토글
  $$('.admin-only').forEach(x=>x.classList.toggle('hide', !isAdmin));
  // 패널/학생 패널 토글
  [els.panelBuild,els.panelOptions,els.panelPresent,els.panelResults].forEach(x=>x?.classList.toggle('hide', !isAdmin));
  els.studentPanel?.classList.toggle('hide', isAdmin);
  els.studentTopInfo&&(els.studentTopInfo.textContent = roomId?`세션: ${roomId} · 온라인`:'세션: - · 오프라인');
  els.liveDot&&(els.liveDot.style.background = roomId?'#ef4444':'#555');
  // 옵션 탭 전용 학생접속 박스는 기본 숨김
  els.studentAccess?.classList.add('hide');
}
function setActiveTab(btn){
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove('active'));
  btn?.classList.add('active');
  els.panelBuild?.classList.toggle('hide', btn!==els.tabBuild);
  els.panelOptions?.classList.toggle('hide', btn!==els.tabOptions);
  els.panelPresent?.classList.toggle('hide', btn!==els.tabPresent);
  els.panelResults?.classList.toggle('hide', btn!==els.tabResults);
  els.studentAccess?.classList.toggle('hide', btn!==els.tabOptions);
}

/* 접속 */
async function connect(){
  const id=(els.roomId?.value||'').trim(); if(!id) return alert('세션 코드를 입력하세요.');
  roomId=id; await ensureRoom(roomId); listenRoom(roomId); listenResponses(roomId);
  els.roomId.disabled=true; els.btnConnect.classList.add('hide'); els.btnSignOut.classList.remove('hide');
  els.roomStatus&&(els.roomStatus.textContent=`세션: ${roomId} · 온라인`); els.liveDot&&(els.liveDot.style.background='#ef4444');
  saveLocal(); buildStudentLink();
}
function signOut(){
  roomId=''; if(unsubRoom)unsubRoom(); if(unsubResp)unsubResp();
  els.roomId.disabled=false; els.btnConnect.classList.remove('hide'); els.btnSignOut.classList.add('hide');
  els.roomStatus&&(els.roomStatus.textContent='세션: - · 오프라인'); els.liveDot&&(els.liveDot.style.background='#555');
  els.studentLink&&(els.studentLink.value=''); const c=els.qrCanvas?.getContext('2d'); c?.clearRect(0,0,els.qrCanvas.width,els.qrCanvas.height);
  saveLocal();
}
function saveLocal(){ localStorage.setItem('quiz.live', JSON.stringify({roomId,MODE,me})); }
function loadLocal(){ try{ const d=JSON.parse(localStorage.getItem('quiz.live')||'{}'); roomId=d.roomId||''; MODE=d.MODE||'admin'; me=d.me||{id:null,name:''}; if(roomId&&els.roomId) els.roomId.value=roomId; }catch{} }

/* 문항 카드 */
function cardRow(no,q){
  const wrap=document.createElement('div');
  wrap.className='qcard';
  wrap.dataset.image = q?.image || '';
  wrap.innerHTML=`
    <div class="row wrap gap">
      <span class="badge">${no}번 문항</span>
      <label class="radio"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'} /> 객관식</label>
      <label class="radio"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''} /> 주관식</label>
      <!-- 이미지 업로드 -->
      <input type="file" accept="image/*" class="hide" id="img-${no}" />
      <button class="btn ghost" data-act="img" data-no="${no}">이미지</button>
      <img class="qthumb ${q?.image?'':'hide'}" id="thumb-${no}" src="${q?.image||''}" alt="thumb" />
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항" value="${q?.text||''}" />
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap gap">
        ${(q?.options||['','','','']).map((v,i)=>`
           <div class="row">
             <label class="badge">보기${i+1}</label>
             <input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기${i+1}" value="${v||''}" />
           </div>`).join('')}
      </div>
      <div class="row wrap gap">
        <label class="badge">정답 번호</label>
        <input class="ansIndex input sm" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
      </div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <div class="row wrap gap">
        <label class="badge">정답 텍스트</label>
        <input class="ansText input" data-no="${no}" placeholder="정답(자동채점용)" value="${q?.answerText||''}">
      </div>
    </div>
  `;

  // 타입 토글
  const radios=$$(`input[name="type-${no}"]`,wrap);
  const mcq=$('.mcq',wrap), short=$('.short',wrap);
  radios.forEach(r=>r.addEventListener('change',()=>{
    const isShort=radios.find(x=>x.checked)?.value==='short';
    mcq.classList.toggle('hide',isShort); short.classList.toggle('hide',!isShort);
  }));

  // 이미지 업로드 핸들러
  const btnImg = $('[data-act="img"]',wrap);
  const input  = $(`#img-${no}`,wrap);
  const thumb  = $(`#thumb-${no}`,wrap);
  btnImg.addEventListener('click', ()=> input.click());
  input.addEventListener('change', async (e)=>{
    const f=e.target.files?.[0]; if(!f) return;
    const reader=new FileReader();
    reader.onload=()=>{
      wrap.dataset.image = reader.result; // dataURL
      thumb.src = reader.result; thumb.classList.remove('hide');
    };
    reader.readAsDataURL(f);
  });

  return wrap;
}
function collectBuilder(){
  const cards=$$('#builder>.qcard');
  const list=cards.map((c,idx)=>{
    const no=idx+1; const type=c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text=c.querySelector('.qtext').value.trim(); const image=c.dataset.image||'';
    if(!text) return null;
    if(type==='mcq'){
      const opts=$$('.opt',c).map(i=>i.value.trim()).filter(Boolean);
      const ans=Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector('.ansIndex').value,10)||1)-1));
      return {type:'mcq',text,image,options:opts,answerIndex:ans};
    } else {
      return {type:'short',text,image,answerText:c.querySelector('.ansText').value.trim()};
    }
  }).filter(Boolean);
  return {title:els.quizTitle.value||'퀴즈',questions:list};
}

/* 업로드/양식 */
els.btnUploadTxt?.addEventListener('click',()=>els.fileUploadTxt?.click());
els.fileUploadTxt?.addEventListener('change',async e=>{
  const f=e.target.files?.[0]; if(!f) return;
  const txt=await f.text(); const lines=txt.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const parsed=[];
  for(const line of lines){
    const cols=line.split(',').map(s=>s.trim());
    if(cols.length===3 && /주관식/i.test(cols[1])) parsed.push({type:'short',text:cols[0],image:'',answerText:cols[2]});
    else if(cols.length>=6){
      const text=cols[0], options=cols.slice(1,cols.length-1).filter(Boolean);
      const ans=Math.max(0,Math.min(options.length-1,(parseInt(cols.at(-1),10)||1)-1));
      parsed.push({type:'mcq',text,image:'',options,answerIndex:ans});
    }
  }
  if(!parsed.length){ alert('가져올 문제가 없습니다.'); e.target.value=''; return; }
  els.builder.innerHTML=''; parsed.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q)));
  els.quizTitle.value='업로드 퀴즈'; els.questionCount.value=parsed.length; e.target.value='';
});
els.btnDownloadTemplate?.addEventListener('click',()=>{
  const rows=[
    '문항,보기1,보기2,보기3,보기4,정답번호',
    '가장 큰 행성?,지구,목성,화성,금성,2',
    '물의 끓는점(°C)은?,주관식,100'
  ];
  const blob=new Blob([rows.join('\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='quiz-template.csv'; a.click(); URL.revokeObjectURL(a.href);
});

/* 진행/타이머 */
async function startQuiz(){ await updateDoc(roomRef(roomId),{mode:'active',currentIndex:0,accept:true}); }
async function step(delta){
  await runTransaction(db,async tx=>{
    const snap=await tx.get(roomRef(roomId)); const r=snap.data(); const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){ tx.update(roomRef(roomId),{currentIndex:total-1,mode:'ended',accept:false}); return; }
    next=Math.max(0,next); tx.update(roomRef(roomId),{currentIndex:next,accept:true});
  });
}
async function finishAll(){ if(confirm('퀴즈를 종료할까요?')) await updateDoc(roomRef(roomId),{mode:'ended',accept:false}); }
function startTimer(sec){
  stopTimer();
  const end=Date.now()+sec*1000;
  timerHandle=setInterval(()=>{
    const remain=Math.max(0,Math.floor((end-Date.now())/1000));
    els.leftSec&&(els.leftSec.textContent=`${pad(Math.floor(remain/60))}:${pad(remain%60)}`);
    els.studentTimer&&(els.studentTimer.textContent=remain>0?`남은 시간 ${remain}s`:'' );
    if(remain<=0){ stopTimer(); updateDoc(roomRef(roomId),{accept:false}).catch(()=>{}); setTimeout(()=>step(+1),400); }
  },250);
}
function stopTimer(){ if(timerHandle){clearInterval(timerHandle); timerHandle=null; els.leftSec&&(els.leftSec.textContent='00:00'); els.studentTimer&&(els.studentTimer.textContent=''); } }

/* 제출/채점 */
async function join(){
  if(!roomId) return alert('세션에 먼저 접속하세요.');
  const name=(els.studentName?.value||'').trim(); if(!name) return alert('이름 또는 번호를 입력하세요!');
  me={ id:localStorage.getItem('quiz.device')||Math.random().toString(36).slice(2,10), name };
  localStorage.setItem('quiz.device',me.id);
  await setDoc(doc(respCol(roomId),me.id),{name,joinedAt:serverTimestamp(),answers:{},alive:true},{merge:true});
  els.studentJoin?.classList.add('hide'); els.studentQuiz?.classList.remove('hide');
  els.sQText&&(els.sQText.textContent='제출 버튼을 눌러주세요'); saveLocal();
}
async function submit(value){
  const r=window.__room; if(!r?.accept) return alert('지금은 제출할 수 없습니다.');
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
  const ref=doc(respCol(roomId),me.id); const snap=await getDoc(ref);
  const prev=snap.exists()?(snap.data().answers||{}):{}; if(prev[idx]!=null) return alert('이미 제출했습니다.');
  let correct=null;
  if(q.type==='mcq'&&typeof value==='number') correct=(value===(q.answerIndex??-999));
  if(q.type==='short'&&typeof value==='string'){ const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText)); }
  await setDoc(ref,{name:me.name,[`answers.${idx}`]:{value,correct:(correct===true),revealed:r.reveal||false}},{merge:true});
  els.studentDone?.classList.remove('hide');
}
async function grade(uid,idx,ok){ await setDoc(doc(respCol(roomId),uid),{[`answers.${idx}.correct`]:!!ok,[`answers.${idx}.revealed`]:true},{merge:true}); }

/* 렌더 */
function renderRoom(r){
  // 옵션 탭에서만 학생접속 보이기
  const activeBtn = $('.tab.active');
  els.studentAccess?.classList.toggle('hide', activeBtn!==els.tabOptions);

  document.body.classList.toggle('bright', !!r.bright);

  const total=r.questions?.length||0, idx=r.currentIndex;
  els.presentWait?.classList.toggle('hide', !(r.mode!=='active'||idx<0));
  els.pTitle&&(els.pTitle.textContent=r.title||roomId);

  if(idx>=0 && r.questions[idx]){
    const q=r.questions[idx];
    els.pQ.textContent=q.text;
    if(q.image){ els.pImg.src=q.image; els.pImg.classList.remove('hide'); } else { els.pImg.classList.add('hide'); }
    els.pOpts.innerHTML='';
    if(q.type==='mcq'){ q.options.forEach((t,i)=>{ const d=document.createElement('div'); d.className='popt'; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d); }); }
    else { els.pOpts.innerHTML='<div class="muted">주관식 문제입니다.</div>'; }
  } else {
    els.pQ.textContent='-'; els.pOpts.innerHTML=''; els.pImg.classList.add('hide');
  }

  // 학생 화면
  if(MODE==='student'){
    els.studentTopInfo&&(els.studentTopInfo.textContent=roomId?`세션: ${roomId} · 온라인`:`세션: - · 오프라인`);
    const q=r.questions?.[idx];
    if(r.mode!=='active'||!q){ els.badgeType&&(els.badgeType.textContent='대기'); els.sQText&&(els.sQText.textContent='대기 중입니다…'); els.mcqBox&&(els.mcqBox.innerHTML=''); els.shortBox?.classList.add('hide'); els.btnSubmitMCQ?.classList.add('hide'); els.sImg?.classList.add('hide'); return; }

    els.badgeType&&(els.badgeType.textContent=q.type==='mcq'?'객관식':'주관식');
    els.sQText&&(els.sQText.textContent=q.text);
    if(q.image){ els.sImg.src=q.image; els.sImg.classList.remove('hide'); } else { els.sImg.classList.add('hide'); }

    if(q.type==='mcq'){
      els.mcqBox.innerHTML=''; mcqSelected=null;
      q.options.forEach((opt,i)=>{
        const b=document.createElement('button'); b.className='optbtn'; b.textContent=`${i+1}. ${opt}`; b.disabled=!r.accept;
        b.addEventListener('click',()=>{mcqSelected=i; $$('.optbtn',els.mcqBox).forEach(x=>x.classList.remove('active')); b.classList.add('active');});
        els.mcqBox.appendChild(b);
      });
      els.btnSubmitMCQ.classList.remove('hide'); els.btnSubmitMCQ.disabled=!r.accept; els.shortBox.classList.add('hide');
    } else {
      els.mcqBox.innerHTML=''; els.btnSubmitMCQ.classList.add('hide'); els.shortBox.classList.remove('hide'); els.btnShortSend.disabled=!r.accept;
    }
  }
}

function renderResponses(list){
  const r=window.__room||{}; const idx=r.currentIndex;
  const join=list.length; let submitted=0,correct=0,wrong=0;
  list.forEach(s=>{ const a=s.answers?.[idx]; if(a!=null){submitted++; if(a.correct)correct++; else wrong++;} });
  els.statJoin&&(els.statJoin.textContent=`참가 ${join}`); els.statSubmit&&(els.statSubmit.textContent=`제출 ${submitted}`); els.statCorrect&&(els.statCorrect.textContent=`정답 ${correct}`); els.statWrong&&(els.statWrong.textContent=`오답 ${wrong}`);

  // 관리자 결과표(점수순)
  if(els.resultsTable){
    const tbl=document.createElement('table');
    const thead=document.createElement('thead'), tr=document.createElement('tr');
    ['이름',...(r.questions||[]).map((_,i)=>`Q${i+1}`),'점수'].forEach(h=>{const th=document.createElement('th'); th.textContent=h; tr.appendChild(th);});
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb=document.createElement('tbody');
    const scored=list.map(s=>{let score=0;(r.questions||[]).forEach((q,i)=>{ if(s.answers?.[i]?.correct) score++; }); return {s,score};})
                     .sort((a,b)=>b.score-a.score||(a.s.name||'').localeCompare(b.s.name||'')); // 순위
    scored.forEach(({s,score})=>{
      const tr=document.createElement('tr'); const tdn=document.createElement('td'); tdn.textContent=s.name||s.id; tr.appendChild(tdn);
      (r.questions||[]).forEach((q,i)=>{ const a=s.answers?.[i]; const td=document.createElement('td'); td.textContent=a==null?'-':(q.type==='mcq'?(typeof a.value==='number'?a.value+1:'-'):(a.value??'-')); tr.appendChild(td); });
      const tds=document.createElement('td'); tds.textContent=String(score); tr.appendChild(tds); tb.appendChild(tr);
    });
    tbl.appendChild(tb); els.resultsTable.innerHTML=''; els.resultsTable.appendChild(tbl);
  }

  // 학생 개인 결과(종료 시)
  if(MODE==='student' && r.mode==='ended' && me.id){
    const mine=list.find(x=>x.id===me.id); if(!mine) return;
    const rows=(r.questions||[]).map((q,i)=>{ const a=mine.answers?.[i]; const sub=a==null?'-':(q.type==='mcq'?(typeof a.value==='number'?a.value+1:'-'):(a.value??'-')); const mark=a?.correct?'O':'X'; return `<tr><td>${i+1}</td><td>${sub}</td><td>${mark}</td></tr>`;}).join('');
    els.studentResultBody.innerHTML=`<div class="table-wrap"><table><thead><tr><th>문항</th><th>제출</th><th>정답</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    els.studentQuiz?.classList.add('hide'); els.studentResult?.classList.remove('hide');
  }
}

/* 링크/QR */
function buildStudentLink(){
  if(!els.studentLink) return; if(!roomId){ els.studentLink.value=''; return; }
  const url=new URL(location.href); url.searchParams.set('role','student'); url.searchParams.set('room',roomId);
  els.studentLink.value=url.toString();
  if(window.QRCode && els.qrCanvas){ try{ window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, {width:140, margin:1}); }catch(e){ console.warn(e);} }
}

/* 이벤트 */
[els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(btn=>{
  btn?.addEventListener('click',()=>{ setActiveTab(btn); if(btn===els.tabPresent && window.__room) startTimer(window.__room.timerSec||30); });
});
els.btnConnect?.addEventListener('click',connect);
els.btnSignOut?.addEventListener('click',signOut);

els.btnBuildForm?.addEventListener('click',()=>{ const n=Math.max(1,Math.min(50,parseInt(els.questionCount.value,10)||3)); els.builder.innerHTML=''; for(let i=0;i<n;i++) els.builder.appendChild(cardRow(i+1)); });
els.btnLoadSample?.addEventListener('click',()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성은?', image:'', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short',text:'물의 끓는점(°C)은?', image:'', answerText:'100'},
    {type:'mcq', text:'태양계 별명은?',   image:'', options:['Milky','Solar','Sunset','Lunar'], answerIndex:1},
  ];
  els.builder.innerHTML=''; S.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q)));
  els.quizTitle.value='샘플 퀴즈'; els.questionCount.value=S.length;
});
els.btnSaveQuiz?.addEventListener('click', async ()=>{
  if(!roomId) return alert('세션에 먼저 접속하세요.');
  const payload=collectBuilder(); if(!payload.questions.length) return alert('문항을 추가하세요.');
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert('저장 완료!');
});

els.btnSaveOptions?.addEventListener('click', async ()=>{
  if(!roomId) return alert('세션에 먼저 접속하세요.');
  const policy=$('#policyName')?.checked?'name':'device';
  const bright=!!els.chkBright?.checked; const accept=!!els.chkAccept?.checked; const reveal=!!els.chkReveal?.checked;
  const tsec=Math.max(5,Math.min(600, parseInt(els.timerSec.value,10)||30));
  await setDoc(roomRef(roomId), { policy, bright, accept, reveal, timerSec:tsec }, { merge:true });
  buildStudentLink(); alert('옵션 저장 완료!');
});

els.btnStart?.addEventListener('click', startQuiz);
els.btnPrev ?.addEventListener('click', ()=>step(-1));
els.btnNext ?.addEventListener('click', ()=>step(+1));
els.btnEndAll?.addEventListener('click', finishAll);

els.btnExportCSV?.addEventListener('click', async ()=>{
  const r=(await getDoc(roomRef(roomId))).data(); const snap=await getDocs(respCol(roomId));
  const rows=[]; rows.push(['userId','name',...(r.questions||[]).map((_,i)=>`Q${i+1}`),'score'].join(','));
  snap.forEach(d=>{
    const s=d.data(); let score=0;
    const answers=(r.questions||[]).map((q,i)=>{ const a=s.answers?.[i]; if(a?.correct) score++; return q.type==='mcq'?(typeof a?.value==='number'?a.value+1:''):(a?.value??''); });
    rows.push([d.id,`"${(s.name||'').replace(/"/g,'""')}"`,...answers,score].join(','));
  });
  const blob=new Blob([rows.join('\n')],{type:'text/csv'}); const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=`${r.title||roomId}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
});
els.btnResetAll?.addEventListener('click', async ()=>{
  if(!confirm('모든 응답/점수를 초기화할까요?')) return;
  await setDoc(roomRef(roomId), { mode:'idle', currentIndex:-1, accept:false, reveal:false }, { merge:true });
  const snap=await getDocs(respCol(roomId)); const ts=[];
  snap.forEach(d=> ts.push(setDoc(doc(respCol(roomId), d.id), { answers:{}, alive:true }, { merge:true })));
  await Promise.all(ts); alert('초기화 완료');
});

els.btnJoin     ?.addEventListener('click', join);
els.btnShortSend?.addEventListener('click', ()=> submit((els.shortInput?.value||'').trim()));
els.btnSubmitMCQ?.addEventListener('click', ()=>{ if(mcqSelected==null) return alert('보기를 선택하세요.'); submit(mcqSelected); });

els.btnCopyLink   ?.addEventListener('click', async ()=>{ if(!els.studentLink?.value) return; await navigator.clipboard.writeText(els.studentLink.value); els.btnCopyLink.textContent='복사됨'; setTimeout(()=>els.btnCopyLink.textContent='복사',1200); });
els.btnOpenStudent?.addEventListener('click', ()=> window.open(els.studentLink?.value||'#','_blank'));

/* 부팅 */
function autoReconnect(){ loadLocal(); setMode(MODE); setActiveTab(els.tabBuild); if(roomId) connect(); }
autoReconnect();
(function fromURL(){
  const url=new URL(location.href);
  const role=url.searchParams.get('role'); const rid=url.searchParams.get('room');
  if(role==='student'){ MODE='student'; setMode('student'); } // 헤더 숨김 고정
  if(rid){ els.roomId&&(els.roomId.value=rid); connect(); }
})();
