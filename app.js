/* app.js — Live Quiz controller (admin + student)
   - No ESM import: uses window.db prepared in index.html
   - Safe DOM handling for missing elements
*/

(async () => {
  // -------- Firebase (from window.db) + dynamic import for helpers --------
  const db = window.db; // set in index.html <script type="module"> … window.db = getFirestore(app) …
  if (!db) {
    console.error('Firestore(db) not found. Check index.html header script.');
    return;
  }
  const {
    doc, setDoc, getDoc, updateDoc, onSnapshot,
    collection, getDocs, runTransaction, serverTimestamp
  } = await import("https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js");

  // -------------------- utils & dom helpers --------------------
  const $  = (s, el=document) => el.querySelector(s);
  const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));
  const pad = (n)=>String(n).padStart(2,'0');

  // Log missing elements once
  function must(id){ const el = $(id); if(!el) console.warn('[warn] element missing:', id.slice(1)); return el; }

  // -------------------- state --------------------
  let MODE   = "admin";                 // 'admin' | 'student'
  let roomId = "";
  let me     = { id:null, name:"" };
  let unsubRoom=null, unsubResp=null;
  let timerHandle=null;

  // -------------------- elements (existence is optional) --------------------
  const els = {
    // header/admin
    liveDot: $("#liveDot"),
    roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnSignOut: $("#btnSignOut"), roomStatus: $("#roomStatus"),
    tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
    pBuild: $("#panelBuild"), pOptions: $("#panelOptions"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),

    // builder
    quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
    btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"),
    builder: $("#builder"), fileUploadTxt: $("#fileUploadTxt"), btnUploadTxt: $("#btnUploadTxt"), btnDownloadTemplate: $("#btnDownloadTemplate"),

    // options / student access (옵션 탭에만 노출)
    policyDevice: $("#policyDevice"), policyName: $("#policyName"),
    chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright: $("#chkBright"),
    timerSec: $("#timerSec"), btnSaveOptions: $("#btnSaveOptions"), btnResetAll: $("#btnResetAll"),
    studentAccess: $("#studentAccess"), qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"),
    btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

    // present
    btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
    nJoin: $("#nJoin"), nSubmit: $("#nSubmit"), nCorrect: $("#nCorrect"), nWrong: $("#nWrong"), leftSec: $("#leftSec"),
    pTitle: $("#pTitle"), pQ: $("#pQ"), pImg: $("#pImg"), pOpts: $("#pOpts"),

    // results
    btnExportCSV: $("#btnExportCSV"), btnResetAll2: $("#btnResetAll2"), resultsTable: $("#resultsTable"),

    // student ui (student panel ids)
    studentPanel: $("#studentPanel"), studentTop: $("#studentTop"),
    joinModal: $("#joinModal"), joinName: $("#joinName"), btnJoinGo: $("#btnJoinGo"),
    studentWait: $("#studentWait"), sRoom: $("#sRoom"),
    sQuestionCard: $("#sQuestionCard"), badgeType: $("#badgeType"), sQText: $("#sQText"), sImg: $("#sImg"),
    mcqBox: $("#mcqBox"), shortBox: $("#shortBox"), shortInput: $("#shortInput"), btnShortSend: $("#btnShortSend"),
    studentResult: $("#studentResult"),
  };

  // Warn once per missing el (use must('#id') if you need a hard ref)
  Object.entries(els).forEach(([k,v]) => { if(!v) console.warn('[warn] element missing:', k); });

  // -------------------- firestore refs --------------------
  const roomRef = (id)=>doc(db,"rooms",id);
  const respCol = (id)=>collection(db,"rooms",id,"responses");

  async function ensureRoom(id){
    const snap=await getDoc(roomRef(id));
    if(!snap.exists()){
      await setDoc(roomRef(id), {
        title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false, bright:false,
        timer:30, questions:[], createdAt: serverTimestamp()
      });
    }
  }

  // -------------------- mode toggle --------------------
  function setAdminVisible(on){ $$(".admin-only").forEach(n=>n.classList.toggle('hide', !on)); }

  function setMode(m){
    MODE=m;
    if(m==='student'){
      document.body.classList.add('mode-student');
      document.body.classList.remove('mode-admin');
      setAdminVisible(false);                           // 관리자 UI 전체 숨김
      els.studentPanel?.classList.remove('hide');       // 학생 패널만 표출
    }else{
      document.body.classList.add('mode-admin');
      document.body.classList.remove('mode-student');
      setAdminVisible(true);
      els.studentPanel?.classList.add('hide');
      openTab('build');                                 // 기본 탭
    }
  }

  function openTab(name){
    const map = { build:els.pBuild, options:els.pOptions, present:els.pPresent, results:els.pResults };
    [els.pBuild,els.pOptions,els.pPresent,els.pResults].forEach(p=>p?.classList.add('hide'));
    map[name]?.classList.remove('hide');
    [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove('active'));
    ({build:els.tabBuild,options:els.tabOptions,present:els.tabPresent,results:els.tabResults}[name])?.classList.add('active');
  }

  // -------------------- connect / listen --------------------
  async function connect(){
    const id=(els.roomId?.value||"").trim();
    if(!id){ alert("세션 코드를 입력하세요."); return; }
    roomId=id;

    // 잠금
    if(els.roomId){ els.roomId.disabled=true; }
    els.btnConnect?.classList.add('hide');
    els.btnSignOut?.classList.remove('hide');

    await ensureRoom(roomId);
    listen();
    buildStudentLink(); // 옵션 탭 QR/링크 갱신
    els.roomStatus && (els.roomStatus.textContent=`세션: ${roomId} · 온라인`);
  }
  function signOut(){
    try{ unsubRoom&&unsubRoom(); unsubResp&&unsubResp(); }catch{}
    roomId=""; els.roomId && (els.roomId.disabled=false);
    els.btnConnect?.classList.remove('hide');
    els.btnSignOut?.classList.add('hide');
    els.roomStatus && (els.roomStatus.textContent=`세션: - · 오프라인`);
  }
  function listen(){
    if(unsubRoom) unsubRoom();
    unsubRoom=onSnapshot(roomRef(roomId),(snap)=>{
      if(!snap.exists()) return;
      const r=snap.data(); window.__room=r; renderRoom(r);
    });
    if(unsubResp) unsubResp();
    unsubResp=onSnapshot(respCol(roomId),(qs)=>{
      const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() })); renderResponses(arr);
    });
  }

  // -------------------- builder helpers --------------------
  function cardRow(no,q){
    const wrap=document.createElement("div");
    wrap.className="qcard";
    wrap.innerHTML=`
      <div class="row wrap">
        <span class="badge">${no}번</span>
        <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'} /><span>객관식</span></label>
        <label class="switch"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''} /><span>주관식</span></label>
        <label class="btn ghost sm right"><input type="file" accept="image/*" data-img="${no}" class="hide">이미지</label>
      </div>
      <input class="qtext input" data-no="${no}" placeholder="문항 내용" value="${q?.text||''}" />
      <div class="mcq ${q?.type==='short'?'hide':''}">
        <div class="row wrap">
          ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기 ${i+1}" value="${v}">`).join('')}
        </div>
        <div class="row">
          <span class="hint">정답 번호</span>
          <input class="ansIndex input xs" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
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
    // 이미지 저장(데이터URL)
    const imgInput=$('input[type="file"][data-img]',wrap);
    imgInput?.addEventListener('change', async (e)=>{
      const f=e.target.files?.[0]; if(!f) return;
      const url=await new Promise(res=>{ const rd=new FileReader(); rd.onload=()=>res(rd.result); rd.readAsDataURL(f); });
      wrap.dataset.img=url;
    });
    return wrap;
  }
  function collectBuilder(){
    const cards=$$("#builder>.qcard");
    const list=cards.map((c,idx)=>{
      const no=idx+1;
      const type=c.querySelector(`input[name="type-${no}"]:checked`).value;
      const text=c.querySelector(".qtext").value.trim();
      const image=c.dataset.img||"";
      if(!text) return null;
      if(type==='mcq'){
        const opts=$$(".opt",c).map(i=>i.value.trim()).filter(Boolean);
        const ans = Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
        return { type:'mcq', text, options:opts, answerIndex:ans, image };
      } else {
        return { type:'short', text, answerText:c.querySelector(".ansText").value.trim(), image };
      }
    }).filter(Boolean);
    return { title: els.quizTitle?.value||"퀴즈", questions:list };
  }

  // -------------------- flow + timer --------------------
  async function startQuiz(){ await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true }); }
  async function step(delta){
    await runTransaction(db, async (tx)=>{
      const snap=await tx.get(roomRef(roomId));
      const r=snap.data(); const total=(r.questions?.length||0);
      let next=(r.currentIndex??-1)+delta;
      if(next>=total){ tx.update(roomRef(roomId), { currentIndex: total-1, mode:"ended", accept:false }); return; }
      next=Math.max(0,next);
      tx.update(roomRef(roomId), { currentIndex: next, accept:true });
    });
  }
  async function finishAll(){ if(confirm("퀴즈를 종료할까요?")) await updateDoc(roomRef(roomId), { mode:"ended", accept:false }); }

  function startTimer(sec){
    stopTimer();
    const end = Date.now()+sec*1000;
    timerHandle=setInterval(async ()=>{
      const remain=Math.max(0, Math.floor((end-Date.now())/1000));
      els.leftSec && (els.leftSec.textContent = `${pad(Math.floor(remain/60))}:${pad(remain%60)}`);
      if(remain<=0){
        stopTimer();
        await updateDoc(roomRef(roomId), { accept:false });
        setTimeout(()=> step(+1), 500);
      }
    }, 250);
  }
  function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } els.leftSec && (els.leftSec.textContent="00:00"); }

  // -------------------- submit / grade --------------------
  async function join(){
    if(!roomId) return alert("세션에 먼저 접속하세요.");
    const name=(els.joinName?.value||"").trim(); if(!name) return alert("이름을 입력하세요.");
    me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
    localStorage.setItem("quiz.device", me.id);
    await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{}, alive:true }, { merge:true });
    // 대기 화면
    els.joinModal?.classList.add('hide');
    els.studentWait && (els.studentWait.textContent='참가 완료! 제출 버튼을 눌러주세요. 교사가 시작하면 1번 문항이 표시됩니다.');
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

  // -------------------- render --------------------
  function renderRoom(r){
    const total=r.questions?.length||0; const idx=r.currentIndex;
    els.nJoin && (els.nJoin.textContent = String(r.nJoin||0));
    els.nSubmit && (els.nSubmit.textContent = String(r.nSubmit||0));
    els.nCorrect && (els.nCorrect.textContent = String(r.nCorrect||0));
    els.nWrong && (els.nWrong.textContent = String(r.nWrong||0));

    // Present: 안내 문구/이미지
    els.pTitle && (els.pTitle.textContent = r.title||roomId||"");
    if(els.pQ && els.pOpts){
      els.pOpts.innerHTML="";
      if(r.mode!=='active' || idx<0){
        els.pQ.textContent="시작 버튼을 누르면 문항이 제시됩니다.";
        els.pImg?.classList.add('hide');
      }else{
        const q=r.questions[idx];
        els.pQ.textContent=q.text;
        if(q.image){ els.pImg?.setAttribute('src', q.image); els.pImg?.classList.remove('hide'); }
        else{ els.pImg?.classList.add('hide'); }
        if(q.type==='mcq'){ q.options.forEach((t,i)=>{ const d=document.createElement("div"); d.className="popt"; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d); }); }
      }
    }

    // 학생 화면
    if(MODE==='student'){
      if(r.mode!=='active' || idx<0){
        els.studentWait && (els.studentWait.textContent='제출 버튼을 눌러주세요. 교사가 시작하면 1번 문항이 표시됩니다.');
        els.sQuestionCard?.classList.add('hide');
        return;
      }
      const q=r.questions[idx];
      els.studentWait && (els.studentWait.textContent='');
      els.sQuestionCard?.classList.remove('hide');
      els.badgeType && (els.badgeType.textContent = q.type==='mcq'?'객관식':'주관식');
      els.sQText && (els.sQText.textContent=q.text);
      if(q.image){ els.sImg?.setAttribute('src', q.image); els.sImg?.classList.remove('hide'); }
      else{ els.sImg?.classList.add('hide'); }

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
        els.shortBox && els.shortBox.classList.add("hide");
      } else {
        els.mcqBox && (els.mcqBox.innerHTML="");
        if(els.shortBox) { els.shortBox.classList.remove("hide"); els.btnShortSend && (els.btnShortSend.disabled=!r.accept); }
      }
    }
  }

  function renderResponses(list){
    // 관리자 표만 그림 (학생은 개인 결과 별도)
    if(MODE!=='admin' || !els.resultsTable) return;
    const r=window.__room||{}; const idx=r.currentIndex;

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

  // -------------------- QR / student link --------------------
  function buildStudentLink(){
    if(!els.studentLink) return;
    const url=new URL(location.href);
    url.searchParams.set("role","student");
    url.searchParams.set("room", roomId);
    els.studentLink.value=url.toString();
    const QR = window.QRCode;
    if(QR && els.qrCanvas){
      try{ QR.toCanvas(els.qrCanvas, els.studentLink.value, { width:160 }, ()=>{}); }catch(e){ console.warn("QR draw failed", e); }
    }
  }

  // -------------------- events --------------------
  els.btnConnect?.addEventListener("click", connect);
  els.btnSignOut?.addEventListener("click", signOut);

  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(btn=>{
    btn?.addEventListener("click", ()=>{
      const name={tabBuild:'build',tabOptions:'options',tabPresent:'present',tabResults:'results'}[btn.id];
      openTab(name);
    });
  });

  els.btnBuildForm?.addEventListener("click", ()=>{
    const n=Math.max(1,Math.min(20, parseInt(els.questionCount?.value,10)||3));
    if(els.builder){ els.builder.innerHTML=""; for(let i=0;i<n;i++) els.builder.appendChild(cardRow(i+1)); }
  });
  els.btnLoadSample?.addEventListener("click", ()=>{
    const S=[
      {type:'mcq', text:'가장 큰 행성?', options:['지구','목성','화성','금성'], answerIndex:1},
      {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
      {type:'mcq', text:'태양계 별명?', options:['Milky','Solar','Sunset','Lunar'], answerIndex:1},
    ];
    if(els.builder){ els.builder.innerHTML=""; S.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q))); }
    if(els.quizTitle) els.quizTitle.value="샘플 퀴즈";
    if(els.questionCount) els.questionCount.value=S.length;
  });
  els.btnSaveQuiz?.addEventListener("click", async ()=>{
    const payload=collectBuilder(); if(!payload.questions.length) return alert("문항을 추가하세요.");
    await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
    alert("저장 완료!");
  });

  els.btnStart?.addEventListener("click", startQuiz);
  els.btnPrev?.addEventListener("click", ()=>step(-1));
  els.btnNext?.addEventListener("click", ()=>step(+1));
  els.btnEndAll?.addEventListener("click", finishAll);

  els.btnSaveOptions?.addEventListener("click", async ()=>{
    const opt={
      accept: !!els.chkAccept?.checked,
      reveal: !!els.chkReveal?.checked,
      bright: !!els.chkBright?.checked,
      timer:  Math.max(5,Math.min(600, parseInt(els.timerSec?.value,10)||30))
    };
    await setDoc(roomRef(roomId), opt, { merge:true });
    buildStudentLink(); // QR/링크 즉시 갱신
  });

  els.btnCopyLink?.addEventListener("click", async ()=>{
    if(!els.studentLink) return;
    await navigator.clipboard.writeText(els.studentLink.value);
    els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="복사", 1200);
  });
  els.btnOpenStudent?.addEventListener("click", ()=> window.open(els.studentLink?.value||"#","_blank"));

  // 학생 이벤트
  els.btnJoinGo?.addEventListener("click", join);
  els.btnShortSend?.addEventListener("click", ()=> submit((els.shortInput?.value||"").trim()));

  // -------------------- boot --------------------
  function autoReconnect(){
    // 기본 모드 결정: URL ?role=student
    const url=new URL(location.href);
    const role=url.searchParams.get('role');
    const rid =url.searchParams.get('room');
    if(role==='student'){ setMode('student'); roomId=rid||""; els.sRoom && (els.sRoom.textContent=roomId||'-'); }
    else{ setMode('admin'); }

    // 관리자는 room 자동 접속 복구(있을 때)
    if(MODE==='admin' && !roomId && els.roomId?.value){ roomId = els.roomId.value.trim(); }
    if(MODE==='admin' && roomId){ connect(); }

    // 학생은 이름 입력 모달 먼저(상단 메뉴는 이미 숨김)
    if(MODE==='student'){
      els.joinModal?.classList.remove('hide');
      if(roomId){ listen(); }
    }
  }

  autoReconnect();
})();
