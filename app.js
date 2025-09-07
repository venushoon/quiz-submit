/***********************
 * Firebase & Firestore
 ***********************/
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc,
  collection, getDocs, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo",
  authDomain: "live-quiz-a14d1.firebaseapp.com",
  projectId: "live-quiz-a14d1",
};
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

/***********************
 * Utils & State
 ***********************/
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));

let roomId = "";
let me = { id:null, name:"" };
let unsubRoom = null, unsubResp = null;

const A = {
  liveDot: $("#liveDot"), roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnLogout: $("#btnLogout"),
  roomStatus: $("#roomStatus"),
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"), pOptions: $("#panelOptions"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"), builder: $("#builder"),
  fileQuestions: $("#fileQuestions"), btnUploadQuestions: $("#btnUploadQuestions"), btnDownloadTemplate: $("#btnDownloadTemplate"),
  policyDevice: $("#policyDevice"), policyName: $("#policyName"),
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright: $("#chkBright"),
  timerSec: $("#timerSec"), btnSaveOptions: $("#btnSaveOptions"),
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pOpts: $("#pOpts"),
  statJoin: $("#statJoin"), statSubmit: $("#statSubmit"), statOk: $("#statOk"), statNo: $("#statNo"),
  btnExportCSV: $("#btnExportCSV"), btnResetAll: $("#btnResetAll"), resultsTable: $("#resultsTable"),
  studentRoot: $("#studentRoot"), adminRoot: $("#adminRoot"),
  studentJoinBox: $("#studentJoinBox"), studentQuizBox: $("#studentQuizBox"), studentResultBox: $("#studentResultBox"),
  studentName: $("#studentName"), btnJoin: $("#btnJoin"), studentResult: $("#studentResult"),
  badgeType: $("#badgeType"), sQText: $("#sQText"), mcqBox: $("#mcqBox"), shortBox: $("#shortBox"),
  shortInput: $("#shortInput"), btnShortSend: $("#btnShortSend"), btnSubmitMCQ: $("#btnSubmitMCQ"),
  stuSession: $("#stuSession"), stuOnline: $("#stuOnline"), stuName: $("#stuName"),
};

function setOnline(ok){
  if(A.liveDot) A.liveDot.style.background = ok? "#ff4d4d" : "#7c8795";
  if(A.roomStatus) A.roomStatus.textContent = ok? `세션: ${roomId} · 온라인` : `세션 아웃`;
}

/***********************
 * Firestore refs
 ***********************/
const roomRef = id=>doc(db,"rooms",id);
const respCol = id=>collection(db,"rooms",id,"responses");

async function ensureRoom(id){
  const snap = await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션", createdAt: serverTimestamp(),
      mode:"idle", currentIndex:-1, accept:false, reveal:false,
      policy:"device", bright:false, timer:30, questions:[]
    });
  }
}

/***********************
 * Session connect/logout
 ***********************/
async function connect(){
  const id = (A.roomId?.value||roomId||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId = id;
  await ensureRoom(roomId);
  listenRoom(); listenResponses();
  setOnline(true);
  buildStudentLink(true);
  activateTab(A.tabBuild);

  // 잠금
  A.roomId.disabled = true;
  A.btnConnect.classList.add("hide");
  A.btnLogout.classList.remove("hide");
}
function logout(){
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
  roomId = "";
  setOnline(false);
  A.roomId.disabled = false;
  A.btnConnect.classList.remove("hide");
  A.btnLogout.classList.add("hide");
  A.roomStatus.textContent = "세션 아웃";
  location.replace(location.pathname);
}

/***********************
 * Live listen
 ***********************/
function listenRoom(){
  if(unsubRoom) unsubRoom();
  unsubRoom = onSnapshot(roomRef(roomId),(snap)=>{
    if(!snap.exists()) return;
    const r = snap.data(); window.__room = r;
    renderRoom(r);

    // 자동: 종료되면 관리자 결과 탭으로
    if(!S_MODE && r.mode==="ended"){ activateTab(A.tabResults); }
  });
}
function listenResponses(){
  if(unsubResp) unsubResp();
  unsubResp = onSnapshot(respCol(roomId),(qs)=>{
    const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    window.__res = arr;
    renderResponses(arr);
  });
}

/***********************
 * Tabs
 ***********************/
function activateTab(btn){
  [A.tabBuild,A.tabOptions,A.tabPresent,A.tabResults].forEach(b=>b?.classList.remove("active"));
  btn?.classList.add("active");
  A.pBuild.classList.toggle("hide", btn!==A.tabBuild);
  A.pOptions.classList.toggle("hide", btn!==A.tabOptions);
  A.pPresent.classList.toggle("hide", btn!==A.tabPresent);
  A.pResults.classList.toggle("hide", btn!==A.tabResults);
}

/***********************
 * Builder (중앙 정렬)
 ***********************/
function qCard(no,q){
  const wrap=document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row center-row">
      <span class="badge">${no}번</span>
      <label class="radio"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'} /> 객관식</label>
      <label class="radio"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''} /> 주관식</label>
    </div>
    <input class="input qtext center-input" placeholder="문항" value="${q?.text||''}" />
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap g8 center-row">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="input opt center-input" data-idx="${i}" placeholder="보기 ${i+1}" value="${v}">`).join('')}
      </div>
      <div class="row g8 center-row">
        <span class="hint">정답 번호</span>
        <input class="input xs ansIndex" type="number" min="1" max="10" value="${(q?.answerIndex??0)+1}">
      </div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <input class="input ansText center-input" placeholder="정답(선택)" value="${q?.answerText||''}" />
    </div>`;
  const radios = $$(`input[name="type-${no}"]`,wrap);
  const mcq = $(".mcq",wrap), short=$(".short",wrap);
  radios.forEach(r=>r.addEventListener("change",()=>{
    const isShort = radios.find(x=>x.checked)?.value==='short';
    mcq.classList.toggle("hide", isShort);
    short.classList.toggle("hide", !isShort);
  }));
  return wrap;
}
function collectBuild(){
  const cards = $$("#builder>.qcard");
  const qs = cards.map((c,idx)=>{
    const type = c.querySelector(`input[name="type-${idx+1}"]:checked`).value;
    const text = c.querySelector(".qtext").value.trim();
    if(!text) return null;
    if(type==='mcq'){
      const opts = $$(".opt",c).map(x=>x.value.trim()).filter(Boolean);
      const ans = Math.max(0,Math.min(opts.length-1,(parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      return { type:"mcq", text, options:opts, answerIndex:ans };
    } else {
      return { type:"short", text, answerText: c.querySelector(".ansText").value.trim() };
    }
  }).filter(Boolean);
  return { title:(A.quizTitle.value||"퀴즈"), questions:qs };
}

/* 업로드/양식 */
function downloadTemplate(){
  const txt = [
    "type,text,options,answer",
    'mcq,"가장 큰 행성은?","지구|목성|화성|금성",2',
    'short,"물의 끓는점(°C)?","",100'
  ].join("\n");
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([txt],{type:"text/csv"}));
  a.download="quiz-template.csv"; a.click(); URL.revokeObjectURL(a.href);
}
async function handleUpload(file){
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines.shift(); // type,text,options,answer
  const qs=[];
  lines.forEach(line=>{
    const cols = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(s=>s.replace(/^"|"$/g,"").trim());
    const [type,text,options,answer] = cols;
    if(type==="mcq"){
      const opts=(options||"").split("|").map(s=>s.trim()).filter(Boolean);
      const ans=Math.max(1,parseInt(answer||"1",10))-1;
      if(text && opts.length) qs.push({type:"mcq",text,options:opts,answerIndex:ans});
    }else if(type==="short"){
      qs.push({type:"short",text,answerText:answer||""});
    }
  });
  if(!qs.length){ alert("유효한 문항이 없습니다."); return; }
  A.builder.innerHTML=""; qs.forEach((q,i)=>A.builder.appendChild(qCard(i+1,q)));
  A.quizTitle.value = A.quizTitle.value || "업로드 퀴즈";
  A.questionCount.value = qs.length;
}

/***********************
 * Options save + QR
 ***********************/
async function saveOptions(){
  if(!roomId) return alert("세션 먼저 연결");
  const policy = A.policyName.checked ? "name" : "device";
  const bright = !!A.chkBright.checked;
  const timer  = Math.max(5,Math.min(600, parseInt(A.timerSec.value,10)||30));
  await setDoc(roomRef(roomId), {
    policy, bright, timer,
    accept: !!A.chkAccept.checked,
    reveal: !!A.chkReveal.checked
  }, {merge:true});
  buildStudentLink(true);
  alert("저장 완료");
}
function buildStudentLink(drawQR=false){
  if(!A.studentLink) return;
  const url = new URL(location.href);
  url.searchParams.set("role","student");
  if(roomId) url.searchParams.set("room", roomId);
  A.studentLink.value = url.toString();
  if(drawQR && window.QRCode && A.qrCanvas){
    try{ QRCode.toCanvas(A.qrCanvas, A.studentLink.value, {width:220}, ()=>{}); }catch(e){ console.warn(e); }
  }
}

/***********************
 * Render
 ***********************/
function renderRoom(r){
  // 옵션/상단 동기화
  A.roomStatus.textContent = `세션: ${roomId} · 온라인`;
  if(!A.quizTitle.value) A.quizTitle.value = r.title || "";
  A.chkAccept.checked = !!r.accept;
  A.chkReveal.checked = !!r.reveal;
  A.chkBright.checked = !!r.bright;
  A.timerSec.value  = r.timer || 30;
  A.policyName.checked = r.policy==="name";
  A.policyDevice.checked = r.policy!=="name";

  // 프레젠테이션: 시작 전 안내문구 우선
  A.pTitle.textContent = r.title || roomId || "-";
  A.pQ.textContent = "시작 버튼을 누르면 문항이 보입니다.";
  A.pOpts.innerHTML = "";

  const idx = r.currentIndex;
  const hasQ = (r.questions && idx>=0 && r.questions[idx]);
  if(r.mode==="active" && hasQ){
    const q = r.questions[idx];
    A.pQ.textContent = q.text;
    if(q.type==="mcq"){
      q.options.forEach((t,i)=>{
        const d=document.createElement("div"); d.className="popt"; d.textContent=`${i+1}. ${t}`;
        A.pOpts.appendChild(d);
      });
    }
  }

  // 학생 화면
  if(S_MODE){
    A.stuSession.textContent = roomId? `세션 ${roomId}`:"";
    A.stuOnline.textContent  = roomId? " · 온라인": "";

    if(r.mode==="ended"){
      A.studentQuizBox.classList.add("hide");
      A.studentResultBox.classList.remove("hide");
      renderStudentResult(r);
      return;
    }

    if(r.mode!=="active" || !hasQ){
      A.badgeType.textContent = "대기";
      A.sQText.textContent = "제출 버튼을 눌러주세요.";
      A.mcqBox.innerHTML = ""; A.shortBox.classList.add("hide");
      A.btnSubmitMCQ.classList.add("hide");
    } else {
      const q=r.questions[idx];
      A.badgeType.textContent = q.type==='mcq'?'객관식':'주관식';
      A.sQText.textContent = q.text;
      if(q.type==='mcq'){
        A.mcqBox.innerHTML = "";
        q.options.forEach((opt,i)=>{
          const b=document.createElement("button");
          b.className="optbtn"; b.textContent=`${i+1}. ${opt}`;
          b.addEventListener("click", ()=>{
            $$(".optbtn",A.mcqBox).forEach(x=>x.classList.remove("selected"));
            b.classList.add("selected");
          });
          A.mcqBox.appendChild(b);
        });
        A.btnSubmitMCQ.classList.remove("hide");
        A.shortBox.classList.add("hide");
      } else {
        A.mcqBox.innerHTML = "";
        A.shortBox.classList.remove("hide");
        A.btnSubmitMCQ.classList.add("hide");
      }
    }
  }

  updateStats();
}
function renderResponses(list){
  updateStats();
  renderResultsTable(list);
}
function updateStats(){
  const r=window.__room||{}; const idx=r.currentIndex;
  const list=window.__res||[];
  const joined = list.length;
  const submitted = list.filter(s=>s.answers && s.answers[idx]!=null).length;
  const ok = list.filter(s=>s.answers && s.answers[idx]?.correct).length;
  const no = Math.max(0, submitted - ok);
  A.statJoin.textContent   = joined;
  A.statSubmit.textContent = submitted;
  A.statOk.textContent     = ok;
  A.statNo.textContent     = no;
}

/***********************
 * Controls (자동 종료/결과 이동 강화)
 ***********************/
async function startQuiz(){
  const snap=await getDoc(roomRef(roomId)); const r=snap.data();
  const total=(r.questions?.length||0);
  if(total===0){ alert("문항이 없습니다. 먼저 문항을 저장해 주세요."); return; }
  await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true });
}
async function step(delta){
  await runTransaction(db, async tx=>{
    const snap=await tx.get(roomRef(roomId)); const r=snap.data();
    const total=(r.questions?.length||0);
    if(total===0){ tx.update(roomRef(roomId), { mode:"idle", currentIndex:-1, accept:false }); return; }
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){ // 자동 종료
      tx.update(roomRef(roomId), { mode:"ended", accept:false });
      return;
    }
    next=Math.max(0,next);
    tx.update(roomRef(roomId), { currentIndex:next, accept:true });
  });
  const after=(await getDoc(roomRef(roomId))).data();
  if(after.mode==="ended"){ activateTab(A.tabResults); }
}
async function finishAll(){
  await updateDoc(roomRef(roomId), { mode:"ended", accept:false });
  activateTab(A.tabResults);
}

/***********************
 * Student join/submit
 ***********************/
async function join(){
  if(!roomId){ alert("세션이 유효하지 않습니다."); return; }
  const name=(A.studentName.value||"").trim();
  if(!name) return alert("이름 혹은 번호를 입력하세요!");
  me.id = localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10);
  me.name = name;
  localStorage.setItem("quiz.device", me.id);
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{}, alive:true }, { merge:true });
  A.studentJoinBox.classList.add("hide");
  A.studentQuizBox.classList.remove("hide");
  A.stuName.textContent = ` · ${name}`;
  alert("참가 완료! 제출 버튼을 눌러주세요.");
}
async function submitMCQ(){
  const r=window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
  const sel = $(".optbtn.selected", A.mcqBox);
  if(!sel) return alert("보기를 선택하세요.");
  const value = Array.from(A.mcqBox.children).indexOf(sel);
  const correct = (value === (q.answerIndex??-999));
  await setDoc(doc(respCol(roomId), me.id), { name:me.name, [`answers.${idx}`]:{value,correct,revealed:r.reveal||false} }, {merge:true});
  alert("제출되었습니다.");
}
async function submitShort(){
  const r=window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
  const value=(A.shortInput.value||"").trim(); if(!value) return alert("답을 입력하세요.");
  let correct=null;
  if(q.answerText){ const norm=s=>String(s).trim().toLowerCase(); correct = (norm(value)===norm(q.answerText)); }
  await setDoc(doc(respCol(roomId), me.id), { name:me.name, [`answers.${idx}`]:{value,correct,revealed:r.reveal||false} }, {merge:true});
  alert("제출되었습니다.");
}

/***********************
 * Student result
 ***********************/
async function renderStudentResult(room){
  if(!me.id){ A.studentResult.innerHTML="<p class='muted'>참가 기록이 없습니다.</p>"; return; }
  const my=(await getDoc(doc(respCol(roomId), me.id))).data()||{};
  const qs=room.questions||[];
  let score=0;
  const rows = qs.map((q,i)=>{
    const a=my.answers?.[i];
    const s = a ? (q.type==='mcq' ? ((typeof a.value==='number')? (a.value+1) : '-') : (a.value||'-')) : '-';
    const ok = a?.correct===true;
    if(ok) score++;
    return `<tr><td>${i+1}</td><td>${s}</td><td>${ok?'○':'×'}</td></tr>`;
  }).join("");
  A.studentResult.innerHTML = `
    <div class="card">
      <p>이름: <b>${my.name||''}</b> · 점수: <b>${score}</b></p>
      <table><thead><tr><th>문항</th><th>제출</th><th>정답</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`;
}

/***********************
 * Results & CSV (동기화/정렬)
 ***********************/
function renderResultsTable(list){
  const r=window.__room||{}; const qs=r.questions||[];
  if(!A.resultsTable) return;
  const tbl=document.createElement("table");
  const thead=document.createElement("thead"); const tr=document.createElement("tr");
  ["이름",...qs.map((_,i)=>`Q${i+1}`),"점수"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; tr.appendChild(th); });
  thead.appendChild(tr); tbl.appendChild(thead);
  const tb=document.createElement("tbody");
  const rows=list.map(s=>{
    let score=0; const tr=document.createElement("tr");
    const tdN=document.createElement("td"); tdN.textContent=s.name||s.id; tr.appendChild(tdN);
    qs.forEach((q,i)=>{ const a=s.answers?.[i]; const td=document.createElement("td");
      if(a){ if(a.correct) score++; td.textContent = q.type==='mcq' ? (typeof a.value==='number'? a.value+1:"-") : (a.value||"-"); }
      else td.textContent="-";
      tr.appendChild(td);
    });
    const tdS=document.createElement("td"); tdS.textContent=String(score); tr.appendChild(tdS);
    return {tr,score};
  });
  rows.sort((a,b)=>b.score-a.score).forEach(rw=>tb.appendChild(rw.tr)); // 리더보드 정렬
  tbl.appendChild(tb);
  A.resultsTable.innerHTML=""; A.resultsTable.appendChild(tbl);
}
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

/***********************
 * Events
 ***********************/
A.btnConnect?.addEventListener("click", connect);
A.btnLogout?.addEventListener("click", logout);
[A.tabBuild,A.tabOptions,A.tabPresent,A.tabResults].forEach(b=>b?.addEventListener("click", ()=>activateTab(b)));

A.btnBuildForm?.addEventListener("click", ()=>{
  const n=Math.max(1,Math.min(20, parseInt(A.questionCount.value,10)||3));
  A.builder.innerHTML=""; for(let i=0;i<n;i++) A.builder.appendChild(qCard(i+1));
});
A.btnLoadSample?.addEventListener("click", ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
    {type:'mcq', text:'다음 중 위성은?', options:['달','태양','금성','목성'], answerIndex:0},
  ];
  A.builder.innerHTML=""; S.forEach((q,i)=>A.builder.appendChild(qCard(i+1,q)));
  A.quizTitle.value="샘플 퀴즈"; A.questionCount.value=S.length;
});
A.btnSaveQuiz?.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션 먼저 연결");
  const payload=collectBuild(); if(!payload.questions.length) return alert("문항을 추가하세요.");
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, {merge:true});
  alert("저장 완료");
});

A.btnUploadQuestions?.addEventListener("click", ()=> A.fileQuestions?.click());
A.fileQuestions?.addEventListener("change", e=>{
  const f=e.target.files?.[0]; if(!f) return;
  handleUpload(f).catch(console.error).finally(()=>{ e.target.value=""; });
});
A.btnDownloadTemplate?.addEventListener("click", downloadTemplate);

A.btnSaveOptions?.addEventListener("click", saveOptions);
A.btnCopyLink?.addEventListener("click", async ()=>{
  if(!A.studentLink?.value) return;
  await navigator.clipboard.writeText(A.studentLink.value);
  A.btnCopyLink.textContent="복사됨"; setTimeout(()=>A.btnCopyLink.textContent="복사",1000);
});
A.btnOpenStudent?.addEventListener("click", ()=> window.open(A.studentLink?.value||"#","_blank"));

A.btnStart?.addEventListener("click", startQuiz);
A.btnPrev?.addEventListener("click", ()=>step(-1));
A.btnNext?.addEventListener("click", ()=>step(+1));
A.btnEndAll?.addEventListener("click", finishAll);

A.btnExportCSV?.addEventListener("click", exportCSV);
A.btnResetAll?.addEventListener("click", async ()=>{
  if(!roomId) return; if(!confirm("모든 응답을 초기화할까요?")) return;
  await setDoc(roomRef(roomId), { mode:"idle", currentIndex:-1, accept:false, reveal:false }, {merge:true});
  const snap=await getDocs(respCol(roomId)); const jobs=[];
  snap.forEach(d=>jobs.push(setDoc(doc(respCol(roomId),d.id), {answers:{}, alive:true},{merge:true})));
  await Promise.all(jobs); alert("초기화 완료");
});

A.btnJoin?.addEventListener("click", join);
A.btnSubmitMCQ?.addEventListener("click", submitMCQ);
A.btnShortSend?.addEventListener("click", submitShort);

/***********************
 * Boot (admin / student)
 ***********************/
const url=new URL(location.href);
const S_MODE = url.searchParams.get("role")==="student";
const U_ROOM = url.searchParams.get("room")||"";

(function boot(){
  if(S_MODE){
    $("#adminTopbar")?.classList.add("hide");
    $("#adminRoot")?.classList.add("hide");
    $("#studentRoot")?.classList.remove("hide");
    if(U_ROOM){ roomId=U_ROOM; connect(); }
    $("#studentName")?.setAttribute("placeholder","이름 혹은 번호를 입력하세요!");
  }else{
    setOnline(false);
    activateTab(A.tabBuild);
  }
})();
