// app.js (module)
// window.db 는 index.html(헤더)에서 초기화되어 주입됩니다.
import {
  doc, setDoc, getDoc, onSnapshot, updateDoc, runTransaction,
  collection, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));

/* ---------- 엘리먼트 ---------- */
const els = {
  // 헤더/탭(관리자)
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnSignOut: $("#btnSignOut"),
  roomStatus: $("#roomStatus"), liveDot: $("#liveDot"),
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  pBuild: $("#panelBuild"), pOptions: $("#panelOptions"), pPresent: $("#panelPresent"), pResults: $("#panelResults"),
  adminOnly: $$(".admin-only"),

  // 빌더
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"),
  btnBuildForm: $("#btnBuildForm"), btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"),
  builder: $("#builder"), fileUploadTxt: $("#fileUploadTxt"), btnUploadTxt: $("#btnUploadTxt"), btnDownloadTemplate: $("#btnDownloadTemplate"),

  // 옵션 + 학생접속
  policyDevice: $("#policyDevice"), policyName: $("#policyName"),
  chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"), chkBright: $("#chkBright"),
  timerSec: $("#timerSec"), btnSaveOptions: $("#btnSaveOptions"),
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),
  studentAccess: $("#studentAccess"),

  // 프레젠테이션
  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEndAll: $("#btnEndAll"),
  leftSec: $("#leftSec"), presentWait: $("#presentWait"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pImg: $("#pImg"), pOpts: $("#pOpts"),
  statJoin: $("#statJoin"), statSubmit: $("#statSubmit"), statCorrect: $("#statCorrect"), statWrong: $("#statWrong"),

  // 결과
  btnExportCSV: $("#btnExportCSV"), btnResetAll: $("#btnResetAll"), resultsTable: $("#resultsTable"),

  // 학생
  studentPanel: $("#studentPanel"),
  studentJoin: $("#studentJoin"), studentWait: $("#studentWait"), studentQuiz: $("#studentQuiz"), studentDone: $("#studentDone"),
  studentTopInfo: $("#studentTopInfo"), studentName: $("#studentName"), btnJoin: $("#btnJoin"),
  badgeType: $("#badgeType"), sQText: $("#sQText"), sImg: $("#sImg"),
  sOptions: $("#sOptions"), sSubjective: $("#sSubjective"), sInput: $("#sInput"), sSubmit: $("#sSubmit"),
  btnMyResult: $("#btnMyResult"), myResult: $("#myResult"),
};

/* ---------- 상태 ---------- */
let MODE   = "admin"; // 'admin' | 'student'
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;

/* ---------- URL 파라미터로 학생 모드 바로 열기 ---------- */
(function fromURL(){
  const url=new URL(location.href);
  const role=url.searchParams.get("role");
  const rid =url.searchParams.get("room");
  if(role==='student'){ MODE="student"; }
  if(rid){ roomId=rid; if(els.roomId) els.roomId.value=rid; }
})();

/* ---------- 가드: 학생 모드면 상단 탭/세션 숨김 ---------- */
function applyModeUI(){
  const isAdmin = (MODE==='admin');
  els.adminOnly.forEach(el=> el.classList.toggle("hide", !isAdmin));
  els.studentPanel.classList.toggle("hide", isAdmin);
  // 옵션 탭에서만 학생 접속 박스 노출
  els.studentAccess?.classList.toggle("hide", MODE!=='admin' || !els.pOptions || els.pOptions.classList.contains("hide"));
}

/* ---------- Firestore 레퍼런스 ---------- */
const rRef = id => doc(window.db, "rooms", id);
const aCol = id => collection(window.db, "rooms", id, "responses");

/* ---------- 세션 ---------- */
async function ensureRoom(id){
  const snap=await getDoc(rRef(id));
  if(!snap.exists()){
    await setDoc(rRef(id), {
      title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false, bright:false,
      timer:30, policy:"device", createdAt:serverTimestamp(), questions:[]
    });
  }
}
async function connect(){
  const id=(els.roomId?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId=id; await ensureRoom(roomId);
  listenRoom(); listenResponses();
  els.roomId.disabled=true; els.btnConnect.classList.add("hide"); els.btnSignOut.classList.remove("hide");
  els.roomStatus.textContent=`세션: ${roomId} · 온라인`;
  buildStudentLink(); // 링크/QR 사전 세팅
  applyModeUI();
}
function signOut(){
  roomId=""; els.roomId.disabled=false;
  els.btnSignOut.classList.add("hide"); els.btnConnect.classList.remove("hide");
  els.roomStatus.textContent="세션: - · 오프라인";
  if(unsubRoom) unsubRoom(); if(unsubResp) unsubResp();
}

/* ---------- 리스너 ---------- */
function listenRoom(){
  if(unsubRoom) unsubRoom();
  unsubRoom=onSnapshot(rRef(roomId),(snap)=>{
    if(!snap.exists()) return;
    const r=snap.data(); window.__room=r;
    renderAdmin(r); renderStudent(r);
  });
}
function listenResponses(){
  if(unsubResp) unsubResp();
  unsubResp=onSnapshot(aCol(roomId),(qs)=>{
    const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    renderResponses(arr);
  });
}

/* ---------- 빌더 ---------- */
function buildCard(no,q={}){
  const wrap=document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="radio"><input type="radio" name="type-${no}" value="mcq" ${q.type==='short'?'':'checked'}> 객관식</label>
      <label class="radio"><input type="radio" name="type-${no}" value="short" ${q.type==='short'?'checked':''}> 주관식</label>
      <input type="file" accept="image/*" class="qimg-input right" />
    </div>
    <input class="qtext input" placeholder="문항" value="${q.text||''}">
    <div class="row wrap">
      ${(q.options||['','','','']).map((v,i)=>`<input class="opt input" placeholder="보기${i+1}" value="${v}">`).join('')}
    </div>
    <div class="row wrap">
      <label>정답 번호</label><input class="ans input sm" type="number" min="1" max="10" value="${(q.answerIndex??0)+1}">
      <input class="anstxt input" placeholder="(주관식일 때) 정답 텍스트" value="${q.answerText||''}">
      <img class="qthumb ${q.img?'':'hide'}" src="${q.img||''}" alt="">
    </div>
  `;
  const file=wrap.querySelector(".qimg-input");
  const thumb=wrap.querySelector(".qthumb");
  file.addEventListener("change",e=>{
    const f=e.target.files[0]; if(!f) return;
    const rd=new FileReader();
    rd.onload=()=>{ thumb.src=rd.result; thumb.classList.remove("hide"); wrap.dataset.img=rd.result; };
    rd.readAsDataURL(f);
  });
  return wrap;
}
function collectQuiz(){
  const cards=$$("#builder .qcard");
  const questions=cards.map((c,i)=>{
    const type = c.querySelector(`input[name="type-${i+1}"]:checked`).value;
    const text = c.querySelector(".qtext").value.trim();
    const img  = c.dataset.img || (c.querySelector(".qthumb")?.src || "");
    if(!text) return null;
    if(type==='mcq'){
      const opts=$$(".opt",c).map(x=>x.value.trim()).filter(Boolean);
      const ans = Math.max(0, Math.min(opts.length-1, (parseInt(c.querySelector(".ans").value,10)||1)-1));
      return { type, text, img:img||null, options:opts, answerIndex:ans };
    }else{
      return { type, text, img:img||null, answerText: c.querySelector(".anstxt").value.trim() };
    }
  }).filter(Boolean);
  return { title: els.quizTitle.value||"퀴즈", questions };
}

/* ---------- 옵션·QR ---------- */
function buildStudentLink(){
  if(!roomId) return;
  const url=new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room",roomId);
  if(els.studentLink){ els.studentLink.value=url.toString(); }
  if(window.QRCode && els.qrCanvas){
    try{ window.QRCode.toCanvas(els.qrCanvas, url.toString(), { width:140 }); }catch(e){}
  }
}

/* ---------- 프레젠테이션 ---------- */
async function startQuiz(){
  await updateDoc(rRef(roomId), { mode:"active", currentIndex:0, accept:true });
}
async function step(delta){
  await runTransaction(window.db, async (tx)=>{
    const snap=await tx.get(rRef(roomId)); if(!snap.exists()) return;
    const r=snap.data(); const n=(r.currentIndex??-1)+delta; const max=(r.questions?.length||0)-1;
    if(n>max){ // 종료 자동 이동
      tx.update(rRef(roomId), { mode:"ended", accept:false });
      return;
    }
    tx.update(rRef(roomId), { currentIndex: Math.max(0,n), accept:true });
  });
}
async function finishAll(){
  await updateDoc(rRef(roomId), { mode:"ended", accept:false });
}

/* ---------- 렌더(관리자/학생/응답) ---------- */
function renderAdmin(r){
  // 탭에서 옵션에 있을 때만 학생 접속 보이기
  els.studentAccess?.classList.toggle("hide", els.pOptions.classList.contains("hide"));

  // 프레젠테이션
  els.presentWait.classList.toggle("hide", !(r.mode!=='active' || r.currentIndex<0));
  if(r.mode==='active' && r.currentIndex>=0){
    const q=r.questions?.[r.currentIndex];
    els.pTitle.textContent=r.title||roomId;
    els.pQ.textContent=q?.text||"-";
    // 이미지: 있을 때만 표시
    if(q?.img){ els.pImg.src=q.img; els.pImg.classList.remove("hide"); }
    else{ els.pImg.classList.add("hide"); els.pImg.removeAttribute("src"); }
    els.pOpts.innerHTML="";
    if(q?.type==='mcq'){
      (q.options||[]).forEach((t,i)=>{
        const d=document.createElement("div"); d.className="popt"; d.textContent=`${i+1}. ${t}`; els.pOpts.appendChild(d);
      });
    }
  }else{
    els.pQ.textContent="-"; els.pOpts.innerHTML="";
    els.pImg.classList.add("hide"); els.pImg.removeAttribute("src");
  }
  // 상태 텍스트
  els.roomStatus.textContent = `세션: ${roomId||"-"} · ${roomId?"온라인":"오프라인"}`;
}
function renderStudent(r){
  if(MODE!=='student') return;
  els.studentTopInfo.textContent = `세션: ${roomId||"-"} · ${roomId?"온라인":"오프라인"}`;

  // 아직 참가 전이면 join만
  if(!me.id){ els.studentJoin.classList.remove("hide"); els.studentWait.classList.add("hide"); els.studentQuiz.classList.add("hide"); return; }

  // 참가 후 기본은 대기
  els.studentJoin.classList.add("hide");
  if(r.mode!=='active' || r.currentIndex<0){
    els.studentWait.classList.remove("hide");
    els.studentQuiz.classList.add("hide");
    return;
  }

  // 문제 표시
  const idx=r.currentIndex; const q=r.questions?.[idx];
  els.studentWait.classList.add("hide"); els.studentQuiz.classList.remove("hide");
  els.badgeType.textContent = q?.type==='mcq'?'객관식':'주관식';
  els.sQText.textContent = q?.text||"-";

  // 이미지
  if(q?.img){ els.sImg.src=q.img; els.sImg.classList.remove("hide"); }
  else{ els.sImg.classList.add("hide"); els.sImg.removeAttribute("src"); }

  els.sOptions.innerHTML="";
  if(q?.type==='mcq'){
    els.sSubjective.classList.add("hide");
    (q.options||[]).forEach((opt,i)=>{
      const b=document.createElement("button");
      b.className="optbtn"; b.textContent=`${i+1}. ${opt}`;
      b.onclick=()=>{ $$(".optbtn",els.sOptions).forEach(x=>x.classList.remove("active")); b.classList.add("active"); b.dataset.sel=i; };
      els.sOptions.appendChild(b);
    });
  }else{
    els.sSubjective.classList.remove("hide");
    els.sOptions.innerHTML="";
  }
  // 제출 버튼 활성/비활성
  els.sSubmit.disabled = !r.accept;
}
function renderResponses(list){
  // 통계(프레젠테이션)
  const r=window.__room||{}; const idx=r.currentIndex;
  let join=list.length, submit=0, correct=0, wrong=0;
  list.forEach(s=>{
    const a=s.answers?.[idx];
    if(a){ submit++; if(a.correct) correct++; else wrong++; }
  });
  els.statJoin.textContent=`참가 ${join}`;
  els.statSubmit.textContent=`제출 ${submit}`;
  els.statCorrect.textContent=`정답 ${correct}`;
  els.statWrong.textContent=`오답 ${wrong}`;

  // 결과 테이블(관리자)
  const tbl=document.createElement("table");
  const head=document.createElement("thead");
  const htr=document.createElement("tr");
  ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{
    const th=document.createElement("th"); th.textContent=h; htr.appendChild(th);
  });
  head.appendChild(htr); tbl.appendChild(head);
  const body=document.createElement("tbody");
  list.forEach(s=>{
    let score=0; const tr=document.createElement("tr");
    const tn=document.createElement("td"); tn.textContent=s.name||s.id; tr.appendChild(tn);
    (r.questions||[]).forEach((q,i)=>{
      const a=s.answers?.[i]; const td=document.createElement("td");
      if(a){ if(a.correct) score++; td.textContent = q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value||'-'); }
      else { td.textContent='-'; }
      tr.appendChild(td);
    });
    const ts=document.createElement("td"); ts.textContent=String(score); tr.appendChild(ts);
    body.appendChild(tr);
  });
  tbl.appendChild(body);
  els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
}

/* ---------- 학생 join/submit ---------- */
function deviceId(){ let v=localStorage.getItem("quiz.device"); if(!v){ v=Math.random().toString(36).slice(2,10); localStorage.setItem("quiz.device",v);} return v; }
async function join(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name=(els.studentName.value||"").trim(); if(!name) return alert("이름을 입력하세요.");
  me={ id: deviceId(), name };
  await setDoc(doc(aCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{} }, { merge:true });
  els.studentJoin.classList.add("hide");
  els.studentWait.classList.remove("hide");
}
async function submit(){
  const r=window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q || !me.id) return;

  let value=null, correct=null;
  if(q.type==='mcq'){
    const sel=els.sOptions.querySelector(".optbtn.active");
    if(!sel) return alert("보기를 선택하세요.");
    value=Number(sel.dataset.sel); correct=(value===(q.answerIndex??-999));
  }else{
    const txt=(els.sInput.value||"").trim(); if(!txt) return alert("정답을 입력하세요.");
    value=txt; const norm=s=>String(s).trim().toLowerCase(); if(q.answerText) correct=(norm(txt)===norm(q.answerText));
  }
  await setDoc(doc(aCol(roomId), me.id), { [`answers.${idx}`]: { value, correct:(correct===true), revealed:r.reveal||false }, name:me.name }, { merge:true });
  alert("제출되었습니다!");
}

/* ---------- 초기화/CSV ---------- */
async function resetAll(){
  if(!roomId) return; if(!confirm("모든 문항/옵션/응답을 초기화합니다. 계속할까요?")) return;
  await setDoc(rRef(roomId), { title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false, bright:false, timer:30, policy:"device", questions:[] }, { merge:true });
  const snap=await getDocs(aCol(roomId));
  const tasks=[]; snap.forEach(d=> tasks.push(setDoc(doc(aCol(roomId), d.id), { answers:{} }, { merge:true })));
  await Promise.all(tasks); alert("초기화 완료");
}
async function exportCSV(){
  const r=(await getDoc(rRef(roomId))).data();
  const snap=await getDocs(aCol(roomId));
  const rows=[]; rows.push(["userId","name",...(r.questions||[]).map((_,i)=>`Q${i+1}`),"score"].join(","));
  snap.forEach(d=>{
    const s=d.data(); let score=0;
    const an=(r.questions||[]).map((q,i)=>{ const a=s.answers?.[i]; if(a?.correct) score++; return q.type==='mcq' ? (typeof a?.value==='number'? a.value+1 : "") : (a?.value??""); });
    rows.push([d.id, `"${(s.name||"").replace(/"/g,'""')}"`, ...an, score].join(","));
  });
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([rows.join("\n")],{type:"text/csv"}));
  a.download=`${r.title||roomId}-results.csv`; a.click(); URL.revokeObjectURL(a.href);
}

/* ---------- 이벤트 ---------- */
// 탭
[$("#tabBuild"),$("#tabOptions"),$("#tabPresent"),$("#tabResults")].forEach(btn=>{
  btn?.addEventListener("click", ()=>{
    [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    const name=btn.dataset.tab;
    els.pBuild.classList.toggle("hide", name!=="build");
    els.pOptions.classList.toggle("hide", name!=="options");
    els.pPresent.classList.toggle("hide", name!=="present");
    els.pResults.classList.toggle("hide", name!=="results");
    applyModeUI(); // 옵션 탭에서만 학생 접속 박스 노출
  });
});

// 세션
els.btnConnect?.addEventListener("click", connect);
els.btnSignOut?.addEventListener("click", signOut);

// 빌더
els.btnBuildForm?.addEventListener("click", ()=>{
  const n=Math.max(1,Math.min(50,parseInt(els.questionCount.value,10)||3));
  els.builder.innerHTML=""; for(let i=0;i<n;i++) els.builder.appendChild(buildCard(i+1));
});
els.btnLoadSample?.addEventListener("click", ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
    {type:'mcq', text:'태양계 별명은?', options:['솔라','밀키','루나','스타'], answerIndex:1},
  ];
  els.builder.innerHTML=""; S.forEach((q,i)=>els.builder.appendChild(buildCard(i+1,q)));
  els.quizTitle.value="샘플 퀴즈"; els.questionCount.value=S.length;
});
els.btnSaveQuiz?.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const payload=collectQuiz(); if(!payload.questions.length) return alert("문항을 추가하세요.");
  await setDoc(rRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("저장 완료");
});
els.btnUploadTxt?.addEventListener("click", ()=> els.fileUploadTxt.click());
els.fileUploadTxt?.addEventListener("change", async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const text=await f.text();
  const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const qs=lines.map((ln,i)=>{
    const parts=ln.split(",").map(s=>s.trim());
    if(parts[1]==='주관식') return { type:'short', text:parts[0], answerText:parts[2]||"" };
    return { type:'mcq', text:parts[0], options:parts.slice(1,5), answerIndex:Math.max(0,Math.min(3,(parseInt(parts[5]||"1",10)-1))) };
  });
  els.builder.innerHTML=""; qs.forEach((q,i)=>els.builder.appendChild(buildCard(i+1,q)));
  alert("업로드 완료");
});
els.btnDownloadTemplate?.addEventListener("click", ()=>{
  const demo=`가장 큰 행성?,지구,목성,화성,금성,2
수도는?,주관식,서울`;
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([demo],{type:"text/plain"}));
  a.download="quiz_template.txt"; a.click(); URL.revokeObjectURL(a.href);
});

// 옵션
els.btnSaveOptions?.addEventListener("click", async ()=>{
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const policy = els.policyName.checked ? "name" : "device";
  const timer  = Math.max(5,Math.min(600, parseInt(els.timerSec.value,10)||30));
  await updateDoc(rRef(roomId), {
    policy, timer, accept: els.chkAccept.checked, reveal: els.chkReveal.checked, bright: els.chkBright.checked
  });
  buildStudentLink(); // 저장 후 즉시 갱신
  alert("옵션 저장");
});
els.btnCopyLink?.addEventListener("click", async ()=>{
  await navigator.clipboard.writeText(els.studentLink.value||"");
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="복사", 1200);
});
els.btnOpenStudent?.addEventListener("click", ()=>{
  if(!els.studentLink.value) buildStudentLink();
  window.open(els.studentLink.value,"_blank");
});

// 프레젠테이션
els.btnStart?.addEventListener("click", startQuiz);
els.btnPrev?.addEventListener("click", ()=> step(-1));
els.btnNext?.addEventListener("click", ()=> step(+1));
els.btnEndAll?.addEventListener("click", finishAll);

// 학생
els.btnJoin?.addEventListener("click", join);
els.sSubmit?.addEventListener("click", submit);
els.btnMyResult?.addEventListener("click", async ()=>{
  const r=(await getDoc(rRef(roomId))).data();
  const snap=await getDoc(doc(aCol(roomId), me.id));
  const s=snap.exists()? snap.data() : {};
  const table=document.createElement("table");
  const head=document.createElement("thead");
  head.innerHTML="<tr><th>문항</th><th>제출</th><th>정답</th></tr>"; table.appendChild(head);
  const body=document.createElement("tbody");
  (r.questions||[]).forEach((q,i)=>{
    const a=s.answers?.[i]; const tr=document.createElement("tr");
    tr.innerHTML = `<td>${i+1}</td><td>${a? (q.type==='mcq'?(typeof a.value==='number'? a.value+1:'-'):(a.value||'-')):'-'}</td><td>${a?(a.correct?'○':'×'):'×'}</td>`;
    body.appendChild(tr);
  });
  table.appendChild(body); els.myResult.innerHTML=""; els.myResult.appendChild(table);
});

// 결과/초기화
els.btnExportCSV?.addEventListener("click", exportCSV);
els.btnResetAll?.addEventListener("click", resetAll);

/* ---------- 초기 진입 모드 적용 ---------- */
(function boot(){
  // 학생 모드로 열린 경우: 상단 탭 완전 숨김
  if(MODE==='student'){
    els.adminOnly.forEach(el=> el.classList.add("hide"));
    els.studentPanel.classList.remove("hide");
  }
  applyModeUI();
})();
