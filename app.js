/* ==========================================================
   app.js — 최종본 (학생: 이름→참가→대기, 교사: 시작→즉시 Q1)
   - Firebase compat( window.FS / window.db ) 사용 전제
   ========================================================== */
(function () {
  // ---------- Firebase compat bridge ----------
  if (!window.FS || !window.db) {
    console.error("[firebase] not loaded – include compat scripts in index.html");
    return;
  }
  const {
    doc, collection, setDoc, getDoc, getDocs,
    onSnapshot, updateDoc, serverTimestamp
  } = window.FS;

  // ---------- Helpers ----------
  const $  = (s, el=document) => el.querySelector(s);
  const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));
  const pad = (n)=>String(n).padStart(2,'0');
  const warn = (k,v)=>{ if(!v) console.warn("[warn] missing element:", k); };

  // ---------- Elements ----------
  const els = {
    // 상단/탭
    roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnSignOut: $("#btnSignOut"), roomStatus: $("#roomStatus"),
    tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
    pBuild: $("#panelBuild"), pOptions: $("#panelOptions"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),

    // 빌더
    quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
    btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"), builder: $("#builder"),

    // 옵션
    polDevice: $("#polDevice"), polName: $("#polName"),
    chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright: $("#chkBright"),
    timerSec: $("#timerSec"), btnOptSave: $("#btnOptSave"), btnResetAll: $("#btnResetAll"),
    qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

    // 프레젠테이션
    btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
    nowQuestion: $("#nowQuestion"), leftSec: $("#leftSec"),
    pTitle: $("#pTitle"), pQ: $("#pQ"), pImg: $("#pImg"), pOpts: $("#pOpts"),
    chipJoin: $("#chipJoin"), chipSubmit: $("#chipSubmit"), chipCorrect: $("#chipCorrect"), chipWrong: $("#chipWrong"),

    // 결과
    resultsTable: $("#resultsTable"), btnExportCSV: $("#btnExportCSV"), btnFullBoard: $("#btnFullBoard"),

    // 학생
    studentAccess: $("#studentAccess"),
    joinModal: $("#joinModal"), joinName: $("#joinName"), btnJoinGo: $("#btnJoinGo"),
    sState: $("#sState"), sWrap: $("#sWrap"), sQTitle: $("#sQTitle"), sQImg: $("#sQImg"),
    sOptBox: $("#sOptBox"), sShortWrap: $("#sShortWrap"), sShortInput: $("#sShortInput"), btnShortSend: $("#btnShortSend"),
    sDone: $("#sDone"), btnShowMy: $("#btnShowMy"), myResult: $("#myResult"),
  };
  Object.entries(els).forEach(([k,v]) => warn(k,v));

  // ---------- State ----------
  let MODE = "admin";             // 'admin' | 'student'
  let roomId = "";
  let hasJoined = false;          // 학생용 강제 게이트 (로컬스토리지 무시)
  let me = { id:null, name:"" };
  let unsubRoom=null, unsubResp=null;
  let timerHandle=null;
  let cachedRoom=null;

  // ---------- FS refs ----------
  const roomRef = (id)=>doc(window.db,"rooms",id);
  const respCol = (id)=>collection(window.db,"rooms",id,"responses");

  // ---------- Tabs / Mode ----------
  function showTab(name){
    [els.pBuild,els.pOptions,els.pPresent,els.pResults].forEach(p=>p?.classList.add("hide"));
    ({build:els.pBuild,options:els.pOptions,present:els.pPresent,results:els.pResults}[name])?.classList.remove("hide");
    [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(t=>t?.classList.remove("active"));
    ({build:els.tabBuild,options:els.tabOptions,present:els.tabPresent,results:els.tabResults}[name])?.classList.add("active");
  }
  function setMode(m){
    MODE=m;
    if(m==="admin"){
      $$(".admin-only").forEach(n=>n.classList.remove("hide"));
      els.studentAccess?.classList.add("hide");
      showTab("build");
    }else{
      $$(".admin-only").forEach(n=>n.classList.add("hide"));
      els.studentAccess?.classList.remove("hide");

      // 학생은 무조건 이름 입력부터
      hasJoined = false;
      els.joinModal?.classList.remove("hide");
      els.sWrap?.classList.add("hide");
      els.sDone?.classList.add("hide");
      els.sState && (els.sState.textContent="이름을 입력하고 참가를 눌러 주세요.");
    }
  }

  // ---------- FS sync ----------
  async function ensureRoom(id){
    const snap=await getDoc(roomRef(id));
    if(!snap.exists()){
      await setDoc(roomRef(id),{
        title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false, bright:false,
        questions:[], createdAt:serverTimestamp(),
      });
    }
  }
  function listenRoom(id){
    if(unsubRoom) unsubRoom();
    unsubRoom=onSnapshot(roomRef(id),(snap)=>{
      if(!snap.exists()) return;
      cachedRoom=snap.data();
      renderRoom(cachedRoom);
    });
  }
  function listenResponses(id){
    if(unsubResp) unsubResp();
    unsubResp=onSnapshot(respCol(id),(qs)=>{
      const arr=[]; qs.forEach(d=>arr.push({id:d.id,...d.data()}));
      renderResponses(arr);
    });
  }

  // ---------- Connect / Out ----------
  async function connect(){
    const v=els.roomId?.value?.trim();
    if(!v) return alert("세션 코드를 입력하세요.");
    roomId=v;
    await ensureRoom(roomId);
    listenRoom(roomId);
    listenResponses(roomId);

    els.btnConnect && (els.btnConnect.disabled=true);
    els.roomId && (els.roomId.disabled=true);
    els.btnSignOut?.classList.remove("hide");
    els.roomStatus && (els.roomStatus.textContent=`세션: ${roomId} · 온라인`);
    buildStudentLink();
  }
  function signOut(){
    roomId="";
    els.roomId && (els.roomId.value="", els.roomId.disabled=false);
    els.btnConnect && (els.btnConnect.disabled=false);
    els.btnSignOut?.classList.add("hide");
    els.roomStatus && (els.roomStatus.textContent="세션: - · 오프라인");
    showTab("build");
  }

  // ---------- Student link / QR ----------
  function buildStudentLink(){
    if(!els.studentLink) return;
    const url=new URL(location.href);
    url.searchParams.set("role","student");
    url.searchParams.set("room", roomId);
    els.studentLink.value=url.toString();

    const QR=window.QRCode;
    if(QR && els.qrCanvas){
      try{ QR.toCanvas(els.qrCanvas, els.studentLink.value, {width:168}); }catch(e){ console.warn(e); }
    }
  }

  // ---------- Builder ----------
  function cardRow(no,q){
    const w=document.createElement("div");
    w.className="qcard";
    w.innerHTML=`
      <div class="row wrap">
        <span class="badge">${no}번</span>
        <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'}><span>객관식</span></label>
        <label class="switch"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''}><span>주관식</span></label>
      </div>
      <input class="qtext input" data-no="${no}" placeholder="문항 내용" value="${q?.text||''}">
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
        <input class="ansText input" data-no="${no}" placeholder="정답(선택)" value="${q?.answerText||''}">
      </div>`;
    const radios=$$(`input[name="type-${no}"]`,w);
    const mcq=$(".mcq",w), short=$(".short",w);
    radios.forEach(r=>r.addEventListener("change",()=>{
      const isShort=radios.find(x=>x.checked)?.value==='short';
      mcq.classList.toggle("hide",isShort);
      short.classList.toggle("hide",!isShort);
    }));
    return w;
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
        const ans=Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
        return {type:'mcq', text, options:opts, answerIndex:ans};
      }
      return {type:'short', text, answerText:c.querySelector(".ansText").value.trim()};
    }).filter(Boolean);
    return { title: els.quizTitle?.value||"퀴즈", questions:list };
  }
  function buildForm(){
    const n=Math.max(1,Math.min(20,parseInt(els.questionCount?.value||"3",10)));
    if(!els.builder) return; els.builder.innerHTML="";
    for(let i=0;i<n;i++) els.builder.appendChild(cardRow(i+1));
  }
  function loadSample(){
    const S=[
      {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
      {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
      {type:'mcq', text:'태양계 별명?', options:['Milky','Solar','Sunset','Lunar'], answerIndex:1},
    ];
    if(!els.builder) return; els.builder.innerHTML="";
    S.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q)));
    els.quizTitle && (els.quizTitle.value="샘플 퀴즈");
    els.questionCount && (els.questionCount.value=S.length);
  }
  async function saveQuiz(){
    if(!roomId) return alert("세션 접속 후 저장하세요.");
    const payload=collectBuilder(); if(!payload.questions.length) return alert("문항을 추가하세요.");
    await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
    alert("저장 완료!");
  }

  // ---------- 진행 / 타이머 ----------
  async function startQuiz(){
    if(!roomId) return;
    const snap=await getDoc(roomRef(roomId));
    const r=snap.data(); const total=(r.questions?.length||0);
    if(total===0){ alert("문항이 없습니다."); return; }
    await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true });
    // 즉시 프레젠테이션에 Q1 보이게
    showTab("present");
    cachedRoom = {...r, mode:"active", currentIndex:0, accept:true};
    renderRoom(cachedRoom);
  }
  async function step(delta){
    if(!roomId || !cachedRoom) return;
    const total=(cachedRoom.questions?.length||0);
    let next=(cachedRoom.currentIndex??-1)+delta;
    if(next>=total){ await updateDoc(roomRef(roomId),{mode:"ended",accept:false,currentIndex:total-1}); return; }
    next=Math.max(0,next);
    await updateDoc(roomRef(roomId), { currentIndex:next, accept:true, mode:"active" });
    showTab("present");
  }
  async function finishAll(){ if(!roomId) return; await updateDoc(roomRef(roomId), { mode:"ended", accept:false }); showTab("results"); }

  function startTimer(sec){
    stopTimer();
    const end=Date.now()+sec*1000;
    timerHandle=setInterval(async ()=>{
      const remain=Math.max(0,Math.floor((end-Date.now())/1000));
      els.leftSec && (els.leftSec.textContent=`${pad(Math.floor(remain/60))}:${pad(remain%60)}`);
      if(remain<=0){ stopTimer(); await updateDoc(roomRef(roomId),{accept:false}); setTimeout(()=>step(+1),350); }
    },250);
  }
  function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } els.leftSec && (els.leftSec.textContent="00:00"); }

  // ---------- 학생 참가 / 제출 ----------
  async function join(){
    if(!roomId) return alert("세션에 먼저 접속하세요.");
    const name=els.joinName?.value?.trim(); if(!name) return alert("이름을 입력하세요.");
    hasJoined = true; // 메모리 플래그로 '참가 완료' 확정
    me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
    localStorage.setItem("quiz.device", me.id);

    await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{}, alive:true }, { merge:true });

    // 참가 직후엔 무조건 '대기'
    els.joinModal?.classList.add("hide");
    els.sWrap?.classList.add("hide");
    els.sDone?.classList.add("hide");
    els.sState && (els.sState.textContent="참가 완료! 시작을 기다려 주세요.");
  }

  async function submit(value){
    const r=cachedRoom; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
    const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
    const ref=doc(respCol(roomId), me.id || "guest");
    const snap=await getDoc(ref); const prev=snap.exists()?(snap.data().answers||{}):{};
    if(prev[idx]!=null) return alert("이미 제출했습니다.");

    let correct=null;
    if(q.type==='mcq' && typeof value==='number') correct=(value===(q.answerIndex??-1));
    if(q.type==='short' && typeof value==='string'){
      const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
    }
    await setDoc(ref, { name: me.name||"익명", [`answers.${idx}`]: { value, correct:(correct===true) } }, { merge:true });
    els.sWrap?.classList.add("hide"); els.sDone?.classList.remove("hide");
  }

  // ---------- Render ----------
  function renderRoom(r){
    cachedRoom=r;
    const idx=r.currentIndex; const total=r.questions?.length||0;

    // 공통 UI
    els.nowQuestion && (els.nowQuestion.textContent = (idx>=0)?`Q${idx+1}/${total}`:"-");
    if(els.chkBright) document.documentElement.classList.toggle("bright", !!r.bright);

    // ADMIN PRESENT
    if(MODE==='admin'){
      els.pTitle && (els.pTitle.textContent=r.title||roomId);
      if(els.pQ && els.pOpts){
        if(r.mode!=='active' || idx<0){
          els.pQ.textContent="시작 버튼을 누르면 문항이 제시됩니다.";
          els.pOpts.innerHTML=""; els.pImg?.classList.add("hide");
        }else{
          const q=r.questions[idx];
          els.pQ.textContent=q?.text||"-";
          els.pOpts.innerHTML="";
          if(q?.image){ els.pImg && (els.pImg.src=q.image, els.pImg.classList.remove("hide")); } else els.pImg?.classList.add("hide");
          if(q?.type==='mcq'){ q.options.forEach((t,i)=>{ const d=document.createElement("div"); d.className="popt"; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d); }); }
        }
      }
    }

    // STUDENT — 이름→참가→대기 강제
    if(MODE==='student'){
      if(!hasJoined){
        els.joinModal?.classList.remove("hide");
        els.sWrap?.classList.add("hide");
        els.sDone?.classList.add("hide");
        els.sState && (els.sState.textContent="이름을 입력하고 참가를 눌러 주세요.");
        return;
      }

      if(r.mode==='ended'){
        els.joinModal?.classList.add("hide");
        els.sWrap?.classList.add("hide");
        els.sDone?.classList.remove("hide");
        return;
      }

      if(r.mode!=='active' || idx<0){
        els.joinModal?.classList.add("hide");
        els.sWrap?.classList.add("hide");
        els.sDone?.classList.add("hide");
        els.sState && (els.sState.textContent="참가 완료! 시작을 기다려 주세요.");
        return;
      }

      const q=r.questions[idx]; if(!q) return;
      els.joinModal?.classList.add("hide");
      els.sDone?.classList.add("hide");
      els.sWrap?.classList.remove("hide");

      els.sQTitle && (els.sQTitle.textContent=q.text||"-");
      if(els.sQImg) (q.image ? (els.sQImg.src=q.image, els.sQImg.classList.remove("hide")) : els.sQImg.classList.add("hide"));

      if(els.sOptBox){
        els.sOptBox.innerHTML="";
        if(q.type==='mcq'){
          q.options.forEach((opt,i)=>{
            const b=document.createElement("button");
            b.className="btn ghost"; b.textContent=`${i+1}. ${opt}`; b.disabled=!r.accept;
            b.addEventListener("click",()=>submit(i));
            els.sOptBox.appendChild(b);
          });
          els.sShortWrap?.classList.add("hide");
        }else{
          els.sShortWrap?.classList.remove("hide");
          els.btnShortSend && (els.btnShortSend.disabled=!r.accept);
        }
      }
    }
  }

  function renderResponses(list){
    if(MODE!=='admin') return;
    const r=cachedRoom||{}; const idx=r.currentIndex;
    let join=list.length, submit=0, correct=0, wrong=0;
    list.forEach(s=>{ const a=s.answers?.[idx]; if(a){ submit++; if(a.correct) correct++; else wrong++; }});
    els.chipJoin && (els.chipJoin.textContent=join);
    els.chipSubmit && (els.chipSubmit.textContent=submit);
    els.chipCorrect && (els.chipCorrect.textContent=correct);
    els.chipWrong && (els.chipWrong.textContent=wrong);

    if(!els.resultsTable) return;
    const tbl=document.createElement("table");
    const thead=document.createElement("thead"), tr=document.createElement("tr");
    const qCount=(r.questions||[]).length;
    ["이름",...Array.from({length:qCount},(_,i)=>`Q${i+1}`),"점수"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; tr.appendChild(th); });
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb=document.createElement("tbody");
    list.forEach(s=>{
      let score=0; const tr=document.createElement("tr");
      const tdn=document.createElement("td"); tdn.textContent=s.name||s.id; tr.appendChild(tdn);
      (r.questions||[]).forEach((q,i)=>{ const a=s.answers?.[i]; const td=document.createElement("td");
        td.textContent=a?(q.type==='mcq'?(typeof a.value==='number'?(a.value+1):"-"):(a.value??"-")):"-";
        if(a?.correct) score++; tr.appendChild(td);
      });
      const tds=document.createElement("td"); tds.textContent=String(score); tr.appendChild(tds);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb); els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
  }

  // ---------- Options / Export / Reset ----------
  async function saveOptions(){
    if(!roomId) return alert("세션 접속 후 저장하세요.");
    const payload={
      accept:!!els.chkAccept?.checked, reveal:!!els.chkReveal?.checked, bright:!!els.chkBright?.checked,
      timerSec:parseInt(els.timerSec?.value||"0",10)||0,
      policy:{ deviceOnce:!!els.polDevice?.checked, nameOnce:!!els.polName?.checked }
    };
    await setDoc(roomRef(roomId), payload, { merge:true });
    buildStudentLink(); alert("저장 완료!");
  }
  async function resetAll(){
    if(!roomId) return;
    if(!confirm("문항/옵션/결과를 모두 초기화합니다. 계속할까요?")) return;
    await setDoc(roomRef(roomId), { mode:"idle", currentIndex:-1, accept:false, reveal:false, bright:false }, { merge:true });
    const snap=await getDocs(respCol(roomId)); const tasks=[];
    snap.forEach(d=>tasks.push(setDoc(doc(respCol(roomId), d.id), { answers:{}, alive:true }, { merge:true })));
    await Promise.all(tasks); alert("전체 초기화 완료");
  }
  async function exportCSV(){
    if(!roomId) return;
    const r=(await getDoc(roomRef(roomId))).data();
    const snap=await getDocs(respCol(roomId)); const rows=[];
    rows.push(["userId","name",...(r.questions||[]).map((_,i)=>`Q${i+1}`),"score"].join(","));
    snap.forEach(d=>{
      const s=d.data(); let score=0;
      const answers=(r.questions||[]).map((q,i)=>{ const a=s.answers?.[i]; if(a?.correct) score++; return q.type==='mcq'?(typeof a?.value==='number'? a.value+1 : ""):(a?.value??""); });
      rows.push([d.id, `"${(s.name||"").replace(/"/g,'""')}"`, ...answers, score].join(","));
    });
    const blob=new Blob([rows.join("\n")],{type:"text/csv"}); const a=document.createElement("a");
    a.href=URL.createObjectURL(blob); a.download=`${r.title||roomId}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  // ---------- Events ----------
  els.btnConnect?.addEventListener("click", connect);
  els.btnSignOut?.addEventListener("click", signOut);

  els.tabBuild?.addEventListener("click", ()=>showTab("build"));
  els.tabOptions?.addEventListener("click", ()=>showTab("options"));
  els.tabPresent?.addEventListener("click", ()=>showTab("present"));
  els.tabResults?.addEventListener("click", ()=>showTab("results"));

  els.btnBuildForm?.addEventListener("click", buildForm);
  els.btnLoadSample?.addEventListener("click", loadSample);
  els.btnSaveQuiz?.addEventListener("click", saveQuiz);

  els.btnOptSave?.addEventListener("click", saveOptions);
  els.btnResetAll?.addEventListener("click", resetAll);

  els.btnCopyLink?.addEventListener("click", async ()=>{
    if(!els.studentLink?.value) return;
    await navigator.clipboard.writeText(els.studentLink.value);
    const b=els.btnCopyLink, t=b.textContent; b.textContent="복사됨"; setTimeout(()=>b.textContent=t,1000);
  });
  els.btnOpenStudent?.addEventListener("click", ()=>window.open(els.studentLink?.value||"#","_blank"));

  els.btnStart?.addEventListener("click", startQuiz);
  els.btnPrev?.addEventListener("click", ()=>step(-1));
  els.btnNext?.addEventListener("click", ()=>step(+1));
  els.btnEndAll?.addEventListener("click", finishAll);

  els.btnJoinGo?.addEventListener("click", join);
  els.btnShortSend?.addEventListener("click", ()=>submit((els.sShortInput?.value||"").trim()));

  // ---------- Boot (?role=student&room=RID) ----------
  (function boot(){
    // 기본은 관리자 ‘문항’ 탭
    setMode("admin"); showTab("build");

    const url=new URL(location.href);
    const role=url.searchParams.get("role");
    const rid=url.searchParams.get("room");

    if(role==='student'){
      setMode("student"); // 학생은 무조건 이름 모달부터
    }
    if(rid){ els.roomId && (els.roomId.value=rid); connect(); }
  })();
})();
