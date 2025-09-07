/***********************
 * Firebase (window.db 는 index.html 에서 주입됨)
 ***********************/
import {
  doc, setDoc, getDoc, onSnapshot, updateDoc,
  collection, getDocs, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/***********************
 * Helpers & State
 ***********************/
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));
const pad = (n)=>String(n).padStart(2,'0');

let MODE   = "admin";           // 'admin' | 'student'
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;

// 요소 모음
const els = {
  // 상단/탭(관리자 전용)
  adminTopbar: $("#adminTopbar"),
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnSignOut: $("#btnSignOut"),
  liveDot: $("#liveDot"), roomStatus: $("#roomStatus"),
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"), pOptions: $("#panelOptions"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),

  // 문항
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"),
  builder: $("#builder"), fileUploadTxt: $("#fileUploadTxt"), btnUploadTxt: $("#btnUploadTxt"), btnDownloadTemplate: $("#btnDownloadTemplate"),

  // 옵션
  policyDevice: $("#policyDevice"), policyName: $("#policyName"),
  chkBright: $("#chkBright"), chkReveal: $("#chkReveal"),
  timerSec: $("#timerSec"), btnSaveOptions: $("#btnSaveOptions"),
  studentAccess: $("#studentAccess"), qrCanvas: $("#qrCanvas"),
  studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

  // 프레젠테이션
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  leftSec: $("#leftSec"),
  presentWait: $("#presentWait"), pTitle: $("#pTitle"), pQ: $("#pQ"), pImg: $("#pImg"), pOpts: $("#pOpts"),
  statJoin: $("#statJoin"), statSubmit: $("#statSubmit"), statCorrect: $("#statCorrect"), statWrong: $("#statWrong"),

  // 결과
  btnExportCSV: $("#btnExportCSV"), btnResetAll: $("#btnResetAll"), resultsTable: $("#resultsTable"),

  // 학생 화면
  studentPanel: $("#studentPanel"), studentTopInfo: $("#studentTopInfo"),
  studentJoin: $("#studentJoin"), studentName: $("#studentName"), btnJoin: $("#btnJoin"),
  studentQuiz: $("#studentQuiz"), sImgWrap: $("#sImgWrap"), sImg: $("#sImg"),
  badgeType: $("#badgeType"), sQText: $("#sQText"),
  mcqBox: $("#mcqBox"), shortBox: $("#shortBox"), shortInput: $("#shortInput"),
  btnShortSend: $("#btnShortSend"), btnMCQSend: $("#btnMCQSend"),
  progress: $("#progress"), sTimer: $("#sTimer"),
  submitInfo: $("#submitInfo"),
  studentResult: $("#studentResult"), myResultTable: $("#myResultTable"),
};

// 로컬 캐시
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
const roomRef = (id)=>doc(db,"rooms",id);
const respCol = (id)=>collection(db,"rooms",id,"responses");

/***********************
 * Room/Responses listen
 ***********************/
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
    renderResponses(arr);
  });
}

/***********************
 * 모드/탭/접속
 ***********************/
function setMode(m){
  MODE=m;
  const isAdmin = (m==='admin');
  // 상단바는 관리자 전용, 학생모드에서는 숨김
  els.adminTopbar?.classList.toggle("hide", !isAdmin);

  // 기본 패널: 관리자=문항, 학생=학생패널
  showPanel(isAdmin ? "build" : "student");

  // 학생 상단 정보
  updateStudentTop("세션: - · 오프라인");
  saveLocal();
}
function showPanel(name){
  // 패널
  els.pBuild?.classList.toggle("hide", name!=="build");
  els.pOptions?.classList.toggle("hide", name!=="options");
  els.pPresent?.classList.toggle("hide", name!=="present");
  els.pResults?.classList.toggle("hide", name!=="results");
  els.studentPanel?.classList.toggle("hide", name!=="student");

  // 탭 활성
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
  if(name==="build")   els.tabBuild?.classList.add("active");
  if(name==="options") els.tabOptions?.classList.add("active");
  if(name==="present") els.tabPresent?.classList.add("active");
  if(name==="results") els.tabResults?.classList.add("active");
}
function bindTabs(){
  els.tabBuild?.addEventListener("click", ()=>showPanel("build"));
  els.tabOptions?.addEventListener("click", ()=>showPanel("options"));
  els.tabPresent?.addEventListener("click", ()=>showPanel("present"));
  els.tabResults?.addEventListener("click", ()=>showPanel("results"));
}
async function connect(){
  const id=(els.roomId?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId=id; await ensureRoom(roomId);
  listenRoom(roomId); listenResponses(roomId);
  // 잠금
  els.roomId.disabled=true;
  els.btnConnect.classList.add("hide");
  els.btnSignOut.classList.remove("hide");
  setOnline(true);
  buildStudentLink(); // 첫 갱신
  saveLocal();
}
function signOut(){
  if(!roomId){ return; }
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  roomId=""; saveLocal();
  els.roomId.disabled=false;
  els.btnConnect.classList.remove("hide");
  els.btnSignOut.classList.add("hide");
  setOnline(false);
  updateStudentTop("세션: - · 오프라인");
}
function setOnline(flag){
  els.liveDot && (els.liveDot.style.background = flag? "#f43" : "#314");
  els.roomStatus && (els.roomStatus.textContent = flag? `세션: ${roomId} · 온라인` : "세션: - · 오프라인");
}

/***********************
 * Builder (문항)
 ***********************/
function cardRow(no,q){
  const wrap=document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="radio"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'} /> 객관식</label>
      <label class="radio"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''} /> 주관식</label>
      <button class="btn ghost right" data-img="${no}">이미지</button>
      <input type="file" accept="image/*" class="hide" id="img-file-${no}" />
      <img id="img-thumb-${no}" class="qthumb hide" alt="thumb" />
    </div>
    <input class="qtext input" data-no="${no}" placeholder="문항: 입력란" value="${q?.text||''}" />
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        ${[0,1,2,3].map(i=>`<input class="opt input" data-no="${no}" data-idx="${i}" placeholder="보기${i+1}: 입력란" value="${q?.options?.[i]||''}" />`).join('')}
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

  // 이미지 업로드(썸네일 미리보기, base64 보관)
  const btnImg = wrap.querySelector(`[data-img="${no}"]`);
  const fileEl = wrap.querySelector(`#img-file-${no}`);
  const thumb  = wrap.querySelector(`#img-thumb-${no}`);
  btnImg?.addEventListener("click", ()=> fileEl.click());
  fileEl?.addEventListener("change", async (e)=>{
    const f=e.target.files?.[0]; if(!f) return;
    const b64=await fToBase64(f);
    thumb.src=b64; thumb.classList.remove("hide");
    // 썸네일 데이터 저장을 위해 data-url 속성으로 보관
    thumb.setAttribute("data-url", b64);
  });

  return wrap;
}
function fToBase64(file){
  return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); });
}
function collectBuilder(){
  const cards=$$("#builder>.qcard");
  const list=cards.map((c,idx)=>{
    const no=idx+1;
    const type=c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text=c.querySelector(".qtext").value.trim();
    if(!text) return null;
    // 이미지
    const thumb = c.querySelector(`#img-thumb-${no}`);
    const imgUrl = thumb?.getAttribute("data-url") || null;
    if(type==='mcq'){
      const opts=$$(".opt",c).map(i=>i.value.trim()).filter(Boolean);
      const ans = Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      return { type:'mcq', text, options:opts, answerIndex:ans, image: imgUrl };
    } else {
      return { type:'short', text, answerText:c.querySelector(".ansText").value.trim(), image: imgUrl };
    }
  }).filter(Boolean);
  return { title: els.quizTitle?.value||"퀴즈", questions:list };
}

/***********************
 * 옵션 저장/QR
 ***********************/
function buildStudentLink(){
  if(!els.studentLink) return;
  const url=new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", roomId);
  els.studentLink.value=url.toString();
  // QR
  if(window.QRCode && els.qrCanvas){
    try{ window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:120 }, (err)=>{ if(err) console.warn(err); }); }
    catch(e){ console.warn("QR draw failed", e); }
  }
}
async function saveOptions(){
  const policy = els.policyName?.checked ? "name" : "device";
  const bright = !!els.chkBright?.checked;
  const reveal = !!els.chkReveal?.checked;
  const timer  = Math.max(5, Math.min(600, parseInt(els.timerSec?.value,10)||30));
  await setDoc(roomRef(roomId), { policy, bright, reveal, timer }, { merge:true });
  // 옵션 저장 시 학생 접속 갱신
  buildStudentLink();
  alert("옵션이 저장되었습니다. (QR/링크 갱신)");
}

/***********************
 * 진행/타이머/플로우
 ***********************/
async function startQuiz(){
  await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true });
  startTimerFromRoom();
}
async function step(delta){
  await runTransaction(db, async (tx)=>{
    const snap=await tx.get(roomRef(roomId));
    const r=snap.data(); const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){
      // 자동 종료 → 결과 탭
      tx.update(roomRef(roomId), { currentIndex: Math.max(0,total-1), mode:"ended", accept:false });
      return;
    }
    next=Math.max(0,next);
    tx.update(roomRef(roomId), { currentIndex: next, accept:true });
  });
  startTimerFromRoom();
}
async function finishAll(){
  if(!confirm("퀴즈를 종료할까요?")) return;
  await updateDoc(roomRef(roomId), { mode:"ended", accept:false });
}
function startTimerFromRoom(){
  stopTimer();
  const r=window.__room; if(!r) return;
  const sec = Math.max(5, r.timer||30);
  const end = Date.now()+sec*1000;
  timerHandle=setInterval(async ()=>{
    const remain=Math.max(0, Math.floor((end-Date.now())/1000));
    setTimerTexts(remain);
    if(remain<=0){
      stopTimer();
      await updateDoc(roomRef(roomId), { accept:false });
      setTimeout(()=> step(+1), 500);
    }
  }, 250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } setTimerTexts(0); }
function setTimerTexts(sec){
  const mm=pad(Math.floor(sec/60)), ss=pad(sec%60);
  els.leftSec && (els.leftSec.textContent = `${mm}:${ss}`);
  els.sTimer  && (els.sTimer.textContent  = `${mm}:${ss}`);
}

/***********************
 * 제출/채점/결과
 ***********************/
async function join(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name=(els.studentName?.value||"").trim(); if(!name) return alert("이름 혹은 번호를 입력하세요!");
  me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem("quiz.device", me.id);
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{}, alive:true }, { merge:true });
  alert("참가 완료! 제출 버튼을 눌러주세요.");
  // 참가 후 대기 화면
  els.studentJoin?.classList.add("hide");
  els.studentQuiz?.classList.remove("hide");
  updateStudentTop(`세션: ${roomId} · 온라인 · ${name}`);
  saveLocal();
}
let selectedMCQ = null; // 객관식 선택값 저장 → 제출 버튼 눌러 확정
function onSelectMCQ(idx, buttons){
  selectedMCQ = idx;
  buttons.forEach((b,i)=> b.classList.toggle("active", i===idx));
}
async function submitValue(value){
  if(!me.id){ alert("먼저 참가하세요."); return; }
  const r=window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;

  // 정책 중복 방지
  const ref=doc(respCol(roomId), me.id);
  const snap=await getDoc(ref); const prev=snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert("이미 제출했습니다.");

  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true), revealed:r.reveal||false } }, { merge:true });
  els.submitInfo && (els.submitInfo.textContent = "제출 완료!");
}
async function grade(uid, qIndex, ok){
  await setDoc(doc(respCol(roomId), uid), { [`answers.${qIndex}.correct`]: !!ok, [`answers.${qIndex}.revealed`]: true }, { merge:true });
}

/***********************
 * 렌더링
 ***********************/
function renderRoom(r){
  const total=r.questions?.length||0; const idx=r.currentIndex??-1;

  // 프레젠테이션 대기문구/표시
  if(els.presentWait) els.presentWait.classList.toggle("hide", !(r.mode!=='active' || idx<0));
  els.pTitle && (els.pTitle.textContent = r.title||roomId);
  if(idx>=0 && r.questions[idx]){
    const q=r.questions[idx];
    els.pQ && (els.pQ.textContent = q.text);
    // 이미지
    if(q.image){
      els.pImg?.classList.remove("hide"); els.pImg.src=q.image;
    }else{
      els.pImg?.classList.add("hide");
    }
    // 보기
    if(els.pOpts){
      els.pOpts.innerHTML="";
      if(q.type==='mcq'){
        q.options.forEach((t,i)=>{ const d=document.createElement("div"); d.className="popt"; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d); });
      }
    }
  }else{
    els.pQ && (els.pQ.textContent = "-");
    els.pImg?.classList.add("hide");
    els.pOpts && (els.pOpts.innerHTML="");
  }

  // 학생화면
  if(MODE==='student'){
    if(r.mode!=='active' || idx<0){
      // 대기
      els.badgeType && (els.badgeType.textContent="대기");
      els.sQText && (els.sQText.textContent="대기 중입니다…");
      els.mcqBox && (els.mcqBox.innerHTML="");
      els.shortBox && els.shortBox.classList.add("hide");
      els.sImgWrap && els.sImgWrap.classList.add("hide");
      els.progress && (els.progress.textContent = `0/0`);
      // 대기 안내 유지
      return;
    }
    const q=r.questions[idx];
    els.badgeType && (els.badgeType.textContent = q.type==='mcq'?'객관식':'주관식');
    els.sQText && (els.sQText.textContent=q.text);
    els.progress && (els.progress.textContent = `${idx+1}/${total}`);

    // 이미지
    if(q.image){
      els.sImgWrap?.classList.remove("hide");
      els.sImg && (els.sImg.src = q.image);
    }else{
      els.sImgWrap?.classList.add("hide");
    }

    // 객관식
    if(q.type==='mcq'){
      selectedMCQ = null;
      if(els.mcqBox){
        els.mcqBox.innerHTML="";
        const btns=[];
        q.options.forEach((opt,i)=>{
          const b=document.createElement("button");
          b.className="optbtn"; b.textContent=`${i+1}. ${opt}`;
          b.addEventListener("click", ()=> onSelectMCQ(i, btns));
          els.mcqBox.appendChild(b); btns.push(b);
        });
      }
      els.shortBox && els.shortBox.classList.add("hide");
      els.btnMCQSend?.classList.remove("hide");
      els.btnMCQSend.disabled = !r.accept;
      els.btnShortSend && (els.btnShortSend.disabled = true);
    } else {
      els.mcqBox && (els.mcqBox.innerHTML="");
      els.shortBox && els.shortBox.classList.remove("hide");
      els.btnMCQSend?.classList.add("hide");
      els.btnShortSend && (els.btnShortSend.disabled = !r.accept);
    }
    els.submitInfo && (els.submitInfo.textContent = "제출 버튼을 눌러주세요.");
  }
}
function renderResponses(list){
  // 통계(프레젠테이션 하단)
  const r=window.__room||{}; const idx=r.currentIndex??-1; const q=r.questions?.[idx];
  const join = list.length;
  let submit=0, correct=0, wrong=0;
  list.forEach(s=>{
    const a=s.answers?.[idx];
    if(a){ submit++; if(a.correct) correct++; else wrong++; }
  });
  els.statJoin && (els.statJoin.textContent = `참가 ${join}`);
  els.statSubmit && (els.statSubmit.textContent = `제출 ${submit}`);
  els.statCorrect && (els.statCorrect.textContent = `정답 ${correct}`);
  els.statWrong && (els.statWrong.textContent = `오답 ${wrong}`);

  // 결과표(관리자)
  if(els.resultsTable){
    const tbl=document.createElement("table");
    const thead=document.createElement("thead"), tr=document.createElement("tr");
    ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; tr.appendChild(th); });
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb=document.createElement("tbody");

    // 점수순 정렬
    const scored = list.map(s=>{
      let score=0;
      (r.questions||[]).forEach((q,i)=>{ if(s.answers?.[i]?.correct) score++; });
      return { s, score };
    }).sort((a,b)=> b.score - a.score);

    scored.forEach(({s,score})=>{
      const tr=document.createElement("tr");
      const tdn=document.createElement("td"); tdn.textContent=s.name||s.id; tr.appendChild(tdn);
      (r.questions||[]).forEach((q,i)=>{
        const a=s.answers?.[i]; const td=document.createElement("td");
        if(a){
          // O/X 표기
          td.textContent = a.correct ? "O" : "X";
        } else td.textContent='-';
        tr.appendChild(td);
      });
      const tds=document.createElement("td"); tds.textContent=String(score); tr.appendChild(tds);
      tb.appendChild(tr);
    });

    tbl.appendChild(tb);
    els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
  }

  // 내 결과(학생)
  if(MODE==='student' && els.myResultTable && window.__room?.mode==='ended'){
    const meData = list.find(x=>x.id===me.id);
    const r=window.__room, qList=r.questions||[];
    const tbl=document.createElement("table");
    const thead=document.createElement("thead"), tr=document.createElement("tr");
    ["문항","결과"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; tr.appendChild(th); });
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb=document.createElement("tbody");
    qList.forEach((q,i)=>{
      const a=meData?.answers?.[i]; const tr=document.createElement("tr");
      const tdq=document.createElement("td"); tdq.textContent=`Q${i+1}`; tr.appendChild(tdq);
      const tdr=document.createElement("td"); tdr.textContent = a ? (a.correct ? "O" : "X") : "-"; tr.appendChild(tdr);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.myResultTable.innerHTML=""; els.myResultTable.appendChild(tbl);

    els.studentQuiz?.classList.add("hide");
    els.studentResult?.classList.remove("hide");
  }
}

/***********************
 * 이벤트 바인딩
 ***********************/
function updateStudentTop(txt){ els.studentTopInfo && (els.studentTopInfo.textContent = txt); }

function bindEvents(){
  // 접속/세션아웃
  els.btnConnect?.addEventListener("click", connect);
  els.btnSignOut?.addEventListener("click", signOut);

  // 탭
  bindTabs();

  // 문항 빌더
  els.btnBuildForm?.addEventListener("click", ()=>{
    const n=Math.max(1,Math.min(50, parseInt(els.questionCount?.value,10)||3));
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
    if(!roomId) return alert("세션에 먼저 접속하세요.");
    const payload=collectBuilder(); if(!payload.questions.length) return alert("문항을 추가하세요.");
    await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
    alert("저장 완료!");
  });

  // 업로드/양식
  els.btnUploadTxt?.addEventListener("click", ()=> els.fileUploadTxt?.click());
  els.fileUploadTxt?.addEventListener("change", async (e)=>{
    const f=e.target.files?.[0]; if(!f) return;
    const txt=await f.text();
    const lines=txt.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const qs=[]; 
    for(const line of lines){
      const parts=line.split(",").map(s=>s.trim());
      if(parts.length>=6){
        const [text,o1,o2,o3,o4,ans] = parts;
        qs.push({ type:'mcq', text, options:[o1,o2,o3,o4], answerIndex: Math.max(0,Math.min(3,(parseInt(ans,10)||1)-1)) });
      }else if(parts.length>=3 && parts[1]==='주관식'){
        qs.push({ type:'short', text:parts[0], answerText: parts.slice(2).join(",") });
      }
    }
    if(els.builder){ els.builder.innerHTML=""; qs.forEach((q,i)=>els.builder.appendChild(cardRow(i+1,q))); }
    if(els.quizTitle) els.quizTitle.value="업로드 퀴즈";
    if(els.questionCount) els.questionCount.value=qs.length;
    e.target.value="";
  });
  els.btnDownloadTemplate?.addEventListener("click", ()=>{
    const sample = [
      "가장 큰 행성?,지구,목성,화성,금성,2",
      "물의 끓는점(°C)은?,주관식,100",
    ].join("\n");
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([sample],{type:"text/plain"}));
    a.download="quiz_template.txt"; a.click(); URL.revokeObjectURL(a.href);
  });

  // 옵션 저장/QR
  els.btnSaveOptions?.addEventListener("click", saveOptions);
  els.btnCopyLink?.addEventListener("click", async ()=>{
    if(!els.studentLink?.value) return;
    await navigator.clipboard.writeText(els.studentLink.value);
    els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="복사", 1000);
  });
  els.btnOpenStudent?.addEventListener("click", ()=> window.open(els.studentLink?.value||"#","_blank"));

  // 진행 버튼
  els.btnStart?.addEventListener("click", startQuiz);
  els.btnPrev?.addEventListener("click", ()=>step(-1));
  els.btnNext?.addEventListener("click", ()=>step(+1));
  els.btnEndAll?.addEventListener("click", finishAll);

  // 결과/초기화
  els.btnExportCSV?.addEventListener("click", async ()=>{
    if(!roomId) return;
    const r=(await getDoc(roomRef(roomId))).data();
    const snap=await getDocs(respCol(roomId));
    const rows=[]; rows.push(["userId","name",...(r.questions||[]).map((_,i)=>`Q${i+1}`),"score"].join(","));
    snap.forEach(d=>{
      const s=d.data(); let score=0;
      const answers=(r.questions||[]).map((q,i)=>{ const a=s.answers?.[i]; if(a?.correct) score++; return a? (a.correct?"O":"X") : ""; });
      rows.push([d.id, `"${(s.name||"").replace(/"/g,'""')}"`, ...answers, score].join(","));
    });
    const blob=new Blob([rows.join("\n")],{type:"text/csv"}); const a=document.createElement("a");
    a.href=URL.createObjectURL(blob); a.download=`${r.title||roomId}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
  });
  els.btnResetAll?.addEventListener("click", async ()=>{
    if(!roomId) return alert("세션에 먼저 접속하세요.");
    if(!confirm("모든 응답/점수를 초기화할까요?")) return;
    await setDoc(roomRef(roomId), { mode:"idle", currentIndex:-1, accept:false, reveal:false }, { merge:true });
    const snap=await getDocs(respCol(roomId)); const tasks=[];
    snap.forEach(d=> tasks.push(setDoc(doc(respCol(roomId), d.id), { answers:{}, alive:true }, { merge:true })));
    await Promise.all(tasks); alert("초기화 완료");
  });

  // 학생: 참가/제출
  els.btnJoin?.addEventListener("click", join);
  els.btnShortSend?.addEventListener("click", ()=> submitValue((els.shortInput?.value||"").trim()));
  els.btnMCQSend?.addEventListener("click", ()=>{
    if(selectedMCQ==null) return alert("보기를 먼저 선택하세요.");
    submitValue(selectedMCQ);
  });
}

/***********************
 * 부팅
 ***********************/
function autoReconnect(){
  loadLocal();
  // URL 파라미터(?role=student&room=xxx)
  const url=new URL(location.href);
  const role=url.searchParams.get("role"); const rid=url.searchParams.get("room");
  if(role==='student'){ MODE='student'; } else { MODE='admin'; }
  setMode(MODE);

  if(rid){
    // 학생 링크로 열렸을 때: 즉시 접속 + 학생 흐름
    roomId=rid; saveLocal();
    if(els.roomId) els.roomId.value=roomId;
    connect().then(()=>{
      if(MODE==='student'){
        showPanel("student");
        els.studentJoin?.classList.remove("hide");
        els.studentQuiz?.classList.add("hide");
        els.studentResult?.classList.add("hide");
      }
    });
  }else{
    // 관리자 기본: 세션 아웃 상태로 시작(입력 가능), 학생 패널은 감춤
    setOnline(false);
    showPanel("build");
  }
}

/***********************
 * 유틸
 ***********************/
function updateStudentTopByRoom(){ if(roomId) updateStudentTop(`세션: ${roomId} · 온라인`); }

/***********************
 * 시작
 ***********************/
bindEvents();
autoReconnect();
