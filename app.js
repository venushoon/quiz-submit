import {
  doc, setDoc, getDoc, onSnapshot, updateDoc, runTransaction,
  collection, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* ------------------------------------------------
   엘리먼트 & 상태
------------------------------------------------ */
const $  = (s, el=document)=>el.querySelector(s);
const $$ = (s, el=document)=>Array.from(el.querySelectorAll(s));

const els = {
  // header & tabs
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnSignOut: $("#btnSignOut"),
  roomStatus: $("#roomStatus"), liveDot: $("#liveDot"),
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"), pOptions: $("#panelOptions"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),

  // builder
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"),
  fileUploadTxt: $("#fileUploadTxt"), btnUploadTxt: $("#btnUploadTxt"), btnDownloadTemplate: $("#btnDownloadTemplate"),
  builder: $("#builder"),

  // options
  policyDevice: $("#policyDevice"), policyName: $("#policyName"),
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright: $("#chkBright"),
  timerSec: $("#timerSec"), btnSaveOptions: $("#btnSaveOptions"),
  studentAccess: $("#studentAccess"), qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"),
  btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

  // present
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pOpts: $("#pOpts"), pWait: $("#pWait"), pImg: $("#pImg"),
  statLine: $("#statLine"), leftSec: $("#leftSec"),

  // results
  btnExportCSV: $("#btnExportCSV"), btnResetAll: $("#btnResetAll"), resultsTable: $("#resultsTable"),

  // student
  studentPanel: $("#studentPanel"), studentName: $("#studentName"), btnJoin: $("#btnJoin"),
  studentMeta: $("#studentMeta"), studentWait: $("#studentWait"),
  studentQA: $("#studentQA"), badgeType: $("#badgeType"), sQText: $("#sQText"), sQImg: $("#sQImg"),
  mcqBox: $("#mcqBox"), shortBox: $("#shortBox"), shortInput: $("#shortInput"),
  btnShortSend: $("#btnShortSend"), btnSubmit: $("#btnSubmit"),
  studentEnded: $("#studentEnded"), btnMyResult: $("#btnMyResult"), studentMyTable: $("#studentMyTable")
};

let MODE = "admin"; // 'admin' | 'student'
let roomId = "";
let me = { id:null, name:"" };
let unsubRoom=null, unsubResp=null, timerHandle=null;

/* ------------------------------------------------
   공통
------------------------------------------------ */
const roomRef = id => doc(db, "rooms", id);
const respCol = id => collection(db, "rooms", id, "responses");
const pad  = n => String(n).padStart(2, "0");

function saveLocal(){ localStorage.setItem("quiz.live", JSON.stringify({roomId, MODE, me})); }
function loadLocal(){
  try{
    const d=JSON.parse(localStorage.getItem("quiz.live")||"{}");
    roomId=d.roomId||""; MODE=d.MODE||"admin"; me=d.me||{id:null,name:""};
  }catch{}
}

/* ------------------------------------------------
   방 생성/리스너
------------------------------------------------ */
async function ensureRoom(id){
  const snap=await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션", mode:"idle", currentIndex:-1,
      accept:false, reveal:false, bright:false, timerSec:30, policy:"device",
      createdAt: serverTimestamp(), questions:[]
    });
  }
}
function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom = onSnapshot(roomRef(id), snap=>{
    if(!snap.exists()) return;
    const r=snap.data(); window.__room=r;
    renderRoom(r);
  });
}
function listenResponses(id){
  if(unsubResp) unsubResp();
  unsubResp = onSnapshot(respCol(id), qs=>{
    const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    renderResponses(arr);
  });
}

/* ------------------------------------------------
   모드/탭
------------------------------------------------ */
function setMode(m){
  MODE=m;
  document.body.setAttribute("data-role", m);

  // 학생 모드는 관리자 헤더/탭을 전부 숨기고 학생 패널만 사용
  const isStu = m==="student";
  els.studentPanel.classList.toggle("hide", !isStu);
  [els.pBuild, els.pOptions, els.pPresent, els.pResults].forEach(p=>p?.classList.toggle("hide", isStu));
}
function activateTab(btn){
  [els.tabBuild, els.tabOptions, els.tabPresent, els.tabResults].forEach(b=>b?.classList.remove("active"));
  btn?.classList.add("active");
  const id = btn?.dataset.tab;
  els.pBuild.classList.toggle("hide", id!=="build");
  els.pOptions.classList.toggle("hide", id!=="options");
  els.pPresent.classList.toggle("hide", id!=="present");
  els.pResults.classList.toggle("hide", id!=="results");
  // 학생 접속은 옵션 탭에서만 노출
  els.studentAccess?.setAttribute("aria-hidden", id==="options" ? "false":"true");
}

/* ------------------------------------------------
   접속/자동복구
------------------------------------------------ */
async function connect(){
  const id=(els.roomId?.value||"").trim();
  if(!id) return alert("세션 코드를 입력하세요.");
  roomId=id; await ensureRoom(roomId);
  listenRoom(roomId); listenResponses(roomId);
  els.roomStatus.textContent=`세션: ${roomId} · 온라인`;
  els.btnConnect.classList.add("hide");
  els.btnSignOut.classList.remove("hide");
  els.roomId.disabled = true;
  saveLocal();
}
function signOut(){
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  els.roomStatus.textContent="세션: - · 오프라인";
  els.btnConnect.classList.remove("hide");
  els.btnSignOut.classList.add("hide");
  els.roomId.disabled=false; roomId=""; saveLocal();
}
function autoReconnect(){
  loadLocal();
  if(roomId){ els.roomId.value=roomId; connect(); }
  setMode(MODE);
}

/* ------------------------------------------------
   문항 빌더
------------------------------------------------ */
function cardRow(no, q){
  const wrap=document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="radio"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'} /> 객관식</label>
      <label class="radio"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''} /> 주관식</label>
      <input type="file" accept="image/*" class="input" id="img-${no}">
      ${q?.img?`<img class="qthumb" src="${q.img}">`:''}
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항" value="${q?.text||''}" />
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기${i+1}" value="${v}">`).join('')}
      </div>
      <div class="row"><span class="muted">정답 번호</span><input class="ansIndex input sm" data-no="${no}" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}"></div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <input class="ansText input" data-no="${no}" placeholder="정답 텍스트" value="${q?.answerText||''}">
    </div>
  `;
  const radios=$$(`input[name="type-${no}"]`,wrap);
  const mcq=$(".mcq",wrap), short=$(".short",wrap);
  radios.forEach(r=>r.addEventListener("change",()=>{
    const isShort = radios.find(x=>x.checked)?.value==='short';
    mcq.classList.toggle("hide", isShort);
    short.classList.toggle("hide", !isShort);
  }));
  return wrap;
}
function collectBuilder(){
  const cards=$$("#builder>.qcard");
  return cards.map((c,idx)=>{
    const no=idx+1;
    const type=c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text=c.querySelector(".qtext").value.trim();
    // 이미지 파일 -> dataURL 저장
    const fileEl = c.querySelector(`#img-${no}`);
    let img = fileEl && fileEl.files && fileEl.files[0] ? (fileEl._dataURL||"") : "";
    if(!img && c.querySelector(".qthumb")) img = c.querySelector(".qthumb").src || "";

    if(!text) return null;
    if(type==='mcq'){
      const opts=$$(".opt",c).map(i=>i.value.trim()).filter(Boolean);
      const ans = Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans, img };
    } else {
      return { type:'short', text, answerText:c.querySelector(".ansText").value.trim(), img };
    }
  }).filter(Boolean);
}

/* ------------------------------------------------
   프레젠테이션 & 진행
------------------------------------------------ */
async function startQuiz(){
  await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true });
}
async function step(delta){
  await runTransaction(db, async tx=>{
    const snap=await tx.get(roomRef(roomId)); const r=snap.data();
    const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){ // 자동 종료 → 결과 탭으로
      tx.update(roomRef(roomId), { mode:"ended", currentIndex: total-1, accept:false });
      activateTab(els.tabResults);
      return;
    }
    next=Math.max(0,next);
    tx.update(roomRef(roomId), { currentIndex: next, accept:true });
  });
}
async function finishAll(){
  if(confirm("퀴즈를 종료할까요?")){
    await updateDoc(roomRef(roomId), { mode:"ended", accept:false });
  }
}
function startTimer(sec){
  stopTimer();
  const end = Date.now()+sec*1000;
  timerHandle=setInterval(async ()=>{
    const remain=Math.max(0, Math.floor((end-Date.now())/1000));
    els.leftSec.textContent = `${pad(Math.floor(remain/60))}:${pad(remain%60)}`;
    if(remain<=0){
      stopTimer();
      await updateDoc(roomRef(roomId), { accept:false });
      setTimeout(()=> step(+1), 400);
    }
  }, 250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } els.leftSec.textContent="00:00"; }

/* ------------------------------------------------
   제출/채점
------------------------------------------------ */
async function join(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name=(els.studentName?.value||"").trim(); if(!name) return alert("이름을 입력하세요.");
  me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem("quiz.device", me.id);
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt: serverTimestamp(), answers:{}, alive:true }, { merge:true });
  els.studentMeta.textContent=`세션: ${roomId}`;
  els.studentWait.classList.remove("hide");  // 대기 안내
  saveLocal();
}
async function submit(value){
  const r=window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
  const ref=doc(respCol(roomId), me.id);
  const snap=await getDoc(ref); const prev=snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert("이미 제출했습니다.");   // 중복 제출 방지
  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true) } }, { merge:true });
  alert("제출 완료!");
}
async function grade(uid, qIndex, ok){
  await setDoc(doc(respCol(roomId), uid), { [`answers.${qIndex}.correct`]: !!ok }, { merge:true });
}

/* ------------------------------------------------
   렌더링
------------------------------------------------ */
function renderRoom(r){
  // 옵션 반영
  document.body.classList.toggle("bright", !!r.bright);
  els.chkAccept && (els.chkAccept.checked=!!r.accept);
  els.chkReveal && (els.chkReveal.checked=!!r.reveal);
  els.timerSec && (els.timerSec.value = r.timerSec ?? 30);

  // 프레젠테이션
  const total=r.questions?.length||0; const idx=r.currentIndex;
  els.pTitle.textContent = r.title || roomId || "-";

  // 이미지 없으면 숨김
  if(idx>=0 && r.questions[idx] && r.questions[idx].img){
    els.pImg.src = r.questions[idx].img; els.pImg.classList.remove("hide");
  }else{
    els.pImg.classList.add("hide"); els.pImg.removeAttribute("src");
  }

  if(idx<0 || r.mode!=="active"){
    els.pQ.textContent="시작 버튼을 누르면 문항이 제시됩니다.";
    els.pOpts.innerHTML="";
  }else{
    const q=r.questions[idx]; els.pQ.textContent=q.text;
    els.pOpts.innerHTML="";
    if(q.type==='mcq'){
      q.options.forEach((t,i)=>{
        const d=document.createElement("div");
        d.className="popt"; d.textContent=`${i+1}. ${t}`;
        els.pOpts.appendChild(d);
      });
    }else{
      // 주관식은 옵션 없음
    }
  }

  // 학생 화면
  if(MODE==='student'){
    els.studentMeta.textContent = `세션: ${roomId}`;
    if(r.mode==='ended'){
      els.studentQA.classList.add("hide");
      els.studentEnded.classList.remove("hide");
      return;
    }
    if(r.mode!=='active' || idx<0){
      // 대기 모드 유지
      els.studentWait.classList.remove("hide");
      els.studentQA.classList.add("hide");
      return;
    }
    const q=r.questions[idx];
    els.studentWait.classList.add("hide");
    els.studentQA.classList.remove("hide");
    els.badgeType.textContent = q.type==='mcq'?'객관식':'주관식';
    els.sQText.textContent = q.text;

    // 학생 이미지 표시 (없으면 숨김)
    if(q.img){ els.sQImg.src=q.img; els.sQImg.classList.remove("hide"); }
    else{ els.sQImg.classList.add("hide"); els.sQImg.removeAttribute("src"); }

    // 보기 버튼 재생성
    els.mcqBox.innerHTML="";
    if(q.type==='mcq'){
      els.shortBox.classList.add("hide");
      els.btnSubmit.classList.remove("hide");
      q.options.forEach((opt,i)=>{
        const b=document.createElement("button");
        b.className="btn popt"; b.textContent=`${i+1}. ${opt}`;
        b.addEventListener("click", ()=>{ els.btnSubmit.dataset.answer=i; });
        els.mcqBox.appendChild(b);
      });
    }else{
      els.mcqBox.innerHTML="";
      els.shortBox.classList.remove("hide");
      els.btnSubmit.classList.add("hide");
      els.btnShortSend.disabled = !r.accept;
    }
  }
}
function renderResponses(list){
  // 상태칩/통계
  const r=window.__room||{}; const idx=r.currentIndex; const q=r.questions?.[idx];
  const stat = { join:list.length, sub:0, ok:0, no:0 };
  list.forEach(s=>{
    const a=s.answers?.[idx];
    if(a){ stat.sub++; if(a.correct===true) stat.ok++; else stat.no++; }
  });
  els.statLine.textContent = `참가 ${stat.join} · 제출 ${stat.sub} · 정답 ${stat.ok} · 오답 ${stat.no}`;

  // 관리자 결과표
  if(MODE==='admin' && els.resultsTable){
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
        td.textContent = a? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : "-") : (a.value??"-")) : "-";
        if(a?.correct) score++; tr.appendChild(td);
      });
      const tds=document.createElement("td"); tds.textContent=String(score); tr.appendChild(tds);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
  }
}

/* ------------------------------------------------
   링크/QR
------------------------------------------------ */
function buildStudentLink(){
  if(!roomId) return;
  const url=new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", roomId);
  els.studentLink.value=url.toString();

  if(window.QRCode && els.qrCanvas){
    try{
      window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:136 }, (err)=>{ if(err) console.warn(err); });
    }catch(e){ console.warn("QR draw failed", e); }
  }
}

/* ------------------------------------------------
   결과/초기화/내 결과
------------------------------------------------ */
async function exportCSV(){
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
}
async function resetAll(){
  if(!confirm("문항/설정/결과를 모두 초기화합니다. 계속할까요?")) return;
  // 방 값 원상복구 + 응답 초기화
  await setDoc(roomRef(roomId), {
    title:"새 세션", mode:"idle", currentIndex:-1,
    accept:false, reveal:false, bright:false, timerSec:30, policy:"device",
    questions:[]
  }, { merge:true });
  const snap=await getDocs(respCol(roomId));
  await Promise.all(snap.docs.map(d=> setDoc(doc(respCol(roomId), d.id), { answers:{}, alive:true }, { merge:true })));
  alert("초기화 완료");
}
async function showMyResult(){
  const r=(await getDoc(roomRef(roomId))).data();
  const meRef = await getDoc(doc(respCol(roomId), me.id));
  const s = meRef.exists()? meRef.data() : { answers:{} };
  const tbl=document.createElement("table");
  const thead=document.createElement("thead"), tr=document.createElement("tr");
  ["문항","제출","정답"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; tr.appendChild(th); });
  thead.appendChild(tr); tbl.appendChild(thead);
  const tb=document.createElement("tbody");
  (r.questions||[]).forEach((q,i)=>{
    const a=s.answers?.[i];
    const tr=document.createElement("tr");
    const t1=document.createElement("td"); t1.textContent=String(i+1); tr.appendChild(t1);
    const t2=document.createElement("td"); t2.textContent=a ? (q.type==='mcq'?(typeof a.value==='number'?a.value+1:"-"):(a.value??"-")) : "-"; tr.appendChild(t2);
    const t3=document.createElement("td"); t3.textContent=a ? (a.correct?'O':'X') : "-"; tr.appendChild(t3);
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  els.studentMyTable.innerHTML=""; els.studentMyTable.appendChild(tbl);
  els.studentMyTable.classList.remove("hide");
}

/* ------------------------------------------------
   이벤트
------------------------------------------------ */
els.btnConnect?.addEventListener("click", connect);
els.btnSignOut?.addEventListener("click", signOut);

[els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=> b?.addEventListener("click", ()=>activateTab(b)));

els.btnBuildForm?.addEventListener("click", ()=>{
  const n=Math.max(1,Math.min(50, parseInt(els.questionCount.value,10)||3));
  els.builder.innerHTML=""; for(let i=0;i<n;i++) els.builder.appendChild(cardRow(i+1));
});
els.btnLoadSample?.addEventListener("click", ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
    {type:'mcq', text:'우리 은하의 이름은?', options:['Milky Way','Solar Way','Sunset','Lunar'], answerIndex:0},
  ];
  els.builder.innerHTML=""; S.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q)));
  els.quizTitle.value="샘플 퀴즈"; els.questionCount.value=S.length;
});
els.btnSaveQuiz?.addEventListener("click", async ()=>{
  const list=collectBuilder(); if(!list.length) return alert("문항을 추가하세요.");
  await setDoc(roomRef(roomId), { title: els.quizTitle.value||"퀴즈", questions:list }, { merge:true });
  alert("저장 완료!");
});
els.btnUploadTxt?.addEventListener("click", ()=> els.fileUploadTxt.click());
els.fileUploadTxt?.addEventListener("change", async e=>{
  const f=e.target.files?.[0]; if(!f) return;
  const txt=await f.text();
  const rows=txt.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const parsed=rows.map(line=>{
    const cols=line.split(",").map(s=>s.trim());
    // 문항, 보기1~4, 정답번호  or  문항, 주관식, 정답텍스트
    if(cols[1]==="주관식") return { type:'short', text:cols[0], answerText:cols[2]||"" };
    return { type:'mcq', text:cols[0], options:cols.slice(1,5), answerIndex: Math.max(0, (parseInt(cols[5],10)||1)-1) };
  });
  els.builder.innerHTML=""; parsed.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q)));
  els.questionCount.value=parsed.length;
  e.target.value="";
});
els.btnDownloadTemplate?.addEventListener("click", ()=>{
  const s = "문항,보기1,보기2,보기3,보기4,정답번호\n가장 큰 행성?,지구,목성,화성,금성,2\n문항,주관식,정답텍스트\n물의 끓는점?,주관식,100\n";
  const blob=new Blob([s],{type:"text/csv"}); const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download="quiz-template.csv"; a.click(); URL.revokeObjectURL(a.href);
});

els.btnSaveOptions?.addEventListener("click", async ()=>{
  const policy = els.policyName.checked ? "name" : "device";
  const bright = !!els.chkBright.checked;
  await setDoc(roomRef(roomId), {
    accept: !!els.chkAccept.checked, reveal: !!els.chkReveal.checked,
    timerSec: Math.max(5, Math.min(600, parseInt(els.timerSec.value,10)||30)),
    policy, bright
  }, { merge:true });
  buildStudentLink(); // 저장 시 링크/QR 즉시 갱신
  alert("옵션 저장 완료");
});
els.btnCopyLink?.addEventListener("click", async ()=>{
  if(!els.studentLink.value) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="복사", 1000);
});
els.btnOpenStudent?.addEventListener("click", ()=> window.open(els.studentLink.value||"#","_blank"));

els.btnStart?.addEventListener("click", ()=> startQuiz());
els.btnPrev ?.addEventListener("click", ()=> step(-1));
els.btnNext ?.addEventListener("click", ()=> step(+1));
els.btnEndAll?.addEventListener("click", finishAll);

els.btnExportCSV?.addEventListener("click", exportCSV);
els.btnResetAll ?.addEventListener("click", resetAll);

// 학생
els.btnJoin     ?.addEventListener("click", join);
els.btnShortSend?.addEventListener("click", ()=> submit((els.shortInput?.value||"").trim()));
els.btnSubmit   ?.addEventListener("click", ()=>{
  const v = Number(els.btnSubmit.dataset.answer);
  if(Number.isFinite(v)) submit(v); else alert("보기를 먼저 선택하세요.");
});
els.btnMyResult ?.addEventListener("click", showMyResult);

/* ------------------------------------------------
   부팅 & URL 파라미터
------------------------------------------------ */
autoReconnect();

// 이미지 파일 선택시 미리 dataURL 보관
document.addEventListener("change", e=>{
  const t=e.target;
  if(t && t.type==="file" && t.accept?.includes("image")){
    const f=t.files?.[0]; if(!f) return;
    const fr=new FileReader();
    fr.onload=()=>{ t._dataURL = String(fr.result||""); };
    fr.readAsDataURL(f);
  }
});

// URL로 바로 학생 모드 열기: ?role=student&room=class1
(function fromURL(){
  const url=new URL(location.href);
  const role=url.searchParams.get("role"); const rid=url.searchParams.get("room");
  if(role==='student'){ MODE="student"; setMode("student"); }
  if(rid){ roomId=rid; connect(); }
})();
