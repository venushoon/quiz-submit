// app.js  (type="module")
import {
  doc, setDoc, getDoc, onSnapshot, updateDoc, collection, getDocs,
  runTransaction, serverTimestamp, deleteDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* ---------- 헬퍼/상태 ---------- */
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));
const pad = n=>String(n).padStart(2,"0");

let MODE   = "admin";            // 'admin' | 'student'
let roomId = "";
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;

const els = {
  // 공용
  studentRoot: $("#studentRoot"),
  // 관리자
  roomId: $("#roomId"), btnConnect: $("#btnConnect"), btnSignOut: $("#btnSignOut"),
  roomStatus: $("#roomStatus"),
  tabBuild: $("#tabBuild"), tabOptions: $("#tabOptions"), tabPresent: $("#tabPresent"), tabResults: $("#tabResults"),
  panelBuild: $("#panelBuild"), panelOptions: $("#panelOptions"), panelPresent: $("#panelPresent"), panelResults: $("#panelResults"),
  quizTitle: $("#quizTitle"), questionCount: $("#questionCount"), btnBuildForm: $("#btnBuildForm"),
  btnLoadSample: $("#btnLoadSample"), btnSaveQuiz: $("#btnSaveQuiz"), builder: $("#builder"),
  fileUploadTxt: $("#fileUploadTxt"), btnUploadTxt: $("#btnUploadTxt"), btnDownloadTemplate: $("#btnDownloadTemplate"),

  btnSaveOptions: $("#btnSaveOptions"), chkAccept: $("#chkAccept"), chkReveal: $("#chkReveal"),
  chkBright: $("#chkBright"), timerSec: $("#timerSec"), btnResetAll: $("#btnResetAll"),
  qrCanvas: $("#qrCanvas"), studentLink: $("#studentLink"), btnCopyLink: $("#btnCopyLink"), btnOpenStudent: $("#btnOpenStudent"),

  btnStart: $("#btnStart"), btnPrev: $("#btnPrev"), btnNext: $("#btnNext"), btnEnd: $("#btnEnd"),
  pTitle: $("#pTitle"), pQ: $("#pQ"), pOpts: $("#pOpts"), pImg: $("#pImg"),
  statJoin: $("#statJoin"), statSubmit: $("#statSubmit"), statCorrect: $("#statCorrect"), statWrong: $("#statWrong"),
  leftTime: $("#leftTime"), pBoard: $("#pBoard"),

  btnExportCSV: $("#btnExportCSV"), btnAllReset: $("#btnAllReset"),
  resultsTable: $("#resultsTable"), rankScore: $("#rankScore"), rankName: $("#rankName"),

  // 학생
  studentJoin: $("#studentJoin"), studentName: $("#studentName"), btnJoin: $("#btnJoin"),
  studentQuiz: $("#studentQuiz"), sQText: $("#sQText"), sImg: $("#sImg"), sProgress: $("#sProgress"),
  mcqBox: $("#mcqBox"), shortBox: $("#shortBox"), shortInput: $("#shortInput"), btnShortSend: $("#btnShortSend"),
  btnSubmit: $("#btnSubmit"), badgeType: $("#badgeType"), sHint: $("#sHint"), myResult: $("#myResult"),

  // 헤더 admin-only 일괄 토글을 위해
  adminBars: $$(".admin-only, header.topbar")
};

/* ---------- 로컬 저장/복구 ---------- */
function saveLocal(){ localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me })); }
function loadLocal(){
  try {
    const d=JSON.parse(localStorage.getItem("quiz.live")||"{}");
    roomId=d.roomId||""; MODE=d.MODE||"admin"; me=d.me||{id:null,name:""};
    if(els.roomId) els.roomId.value=roomId;
  }catch{}
}

/* ---------- Firestore 레퍼런스 ---------- */
const roomRef = id => doc(window.db,"rooms",id);
const respCol = id => collection(window.db,"rooms",id,"responses");

/* ---------- 룸 초기 보장 ---------- */
async function ensureRoom(id){
  const snap=await getDoc(roomRef(id));
  if(!snap.exists()){
    await setDoc(roomRef(id), {
      title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false,
      policy:"device", bright:false, timer:30, createdAt: serverTimestamp(), questions:[]
    });
  }
}

/* ---------- 모드/탭 ---------- */
function setMode(m){
  MODE=m;
  const adminVisible = (m==="admin");
  els.adminBars.forEach(el=> el.classList.toggle("hide", !adminVisible));
  els.studentRoot.classList.toggle("hide", adminVisible);
  if(adminVisible){
    showTab("build");
  } else {
    // 학생 첫 진입: 참가 UI만 보이기
    els.studentJoin.classList.remove("hide");
    els.studentQuiz.classList.add("hide");
  }
  saveLocal();
}
function showTab(name){
  const map = { build:els.panelBuild, options:els.panelOptions, present:els.panelPresent, results:els.panelResults };
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b.classList.remove("active"));
  ({build:els.tabBuild, options:els.tabOptions, present:els.tabPresent, results:els.tabResults}[name]).classList.add("active");
  Object.values(map).forEach(p=>p.classList.add("hide"));
  map[name].classList.remove("hide");
}

/* ---------- 접속/리스닝 ---------- */
async function connect(){
  const id=(els.roomId?.value||"").trim();
  if(!id){ alert("세션 코드를 입력하세요."); return; }
  roomId=id;
  await ensureRoom(roomId);
  listenRoom(roomId);
  listenResponses(roomId);
  buildStudentLink();
  els.roomStatus.textContent=`세션: ${roomId} · 온라인`;
  els.roomId.disabled = true;
  els.btnConnect.classList.add("hide");
  els.btnSignOut.classList.remove("hide");
  saveLocal();
}
function signOut(){
  // 단순 UI 리셋(세션 유지할지 여부는 선택이지만, 요청하신 흐름에 맞춰 입력창 해제)
  if(timerHandle){ clearInterval(timerHandle); timerHandle=null; }
  if(unsubRoom) unsubRoom();
  if(unsubResp) unsubResp();
  roomId=""; els.roomId.disabled=false; els.roomId.value="";
  els.btnConnect.classList.remove("hide"); els.btnSignOut.classList.add("hide");
  els.roomStatus.textContent="세션: - · 오프라인";
  // 화면 탭 초기(문항)
  showTab("build");
  // QR/링크 클리어
  els.studentLink.value=""; if(els.qrCanvas) { const ctx=els.qrCanvas.getContext("2d"); ctx.clearRect(0,0,els.qrCanvas.width,els.qrCanvas.height); }
  saveLocal();
}

function listenRoom(id){
  if(unsubRoom) unsubRoom();
  unsubRoom = onSnapshot(roomRef(id),(snap)=>{
    if(!snap.exists()) return;
    const r=snap.data(); window.__room = r;
    renderRoom(r);
  });
}
function listenResponses(id){
  if(unsubResp) unsubResp();
  unsubResp = onSnapshot(respCol(id),(qs)=>{
    const arr=[]; qs.forEach(d=>arr.push({ id:d.id, ...d.data() }));
    renderResponses(arr);
  });
}

/* ---------- 빌더 ---------- */
function qCard(no,q){
  const wrap=document.createElement("div"); wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="radio"><input type="radio" name="type-${no}" value="mcq" ${q?.type==='short'?'':'checked'}> 객관식</label>
      <label class="radio"><input type="radio" name="type-${no}" value="short" ${q?.type==='short'?'checked':''}> 주관식</label>
      <input type="file" accept="image/*" class="input" id="img-${no}"/>
    </div>
    <input class="qtext input" placeholder="문항" value="${q?.text||''}"/>
    <div class="mcq ${q?.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q?.options||['','','','']).map((v,i)=>`<input class="opt input" placeholder="보기${i+1}" value="${v||''}">`).join('')}
      </div>
      <div class="row"><label class="muted">정답 번호</label><input class="ans input sm" type="number" value="${(q?.answerIndex??0)+1}"></div>
    </div>
    <div class="short ${q?.type==='short'?'':'hide'}">
      <input class="ansText input" placeholder="정답(자동채점)" value="${q?.answerText||''}"/>
    </div>
  `;
  const radios = $$(`input[name="type-${no}"]`,wrap);
  const mcq = $(".mcq",wrap), sh = $(".short",wrap);
  radios.forEach(r=> r.addEventListener("change",()=>{
    const isShort = radios.find(x=>x.checked)?.value==='short';
    mcq.classList.toggle("hide", isShort);
    sh.classList.toggle("hide", !isShort);
  }));
  return wrap;
}
function collectFromBuilder(){
  const cards = $$("#builder .qcard");
  const list = cards.map((card,i)=>{
    const no=i+1;
    const type = card.querySelector(`input[name="type-${no}"]:checked`).value;
    const text = card.querySelector(".qtext").value.trim();
    if(!text) return null;
    const imgInput = card.querySelector(`#img-${no}`);
    let imgData = null;
    if(imgInput?.files?.[0]){
      // 이미지 Base64로 저장(데모/학급용; 운영은 스토리지 권장)
      const f = imgInput.files[0];
      imgData = { name:f.name, mime:f.type, data:null, _file:f };
    }
    if(type==="mcq"){
      const opts=$$(".opt",card).map(x=>x.value.trim()).filter(Boolean);
      const ans = Math.max(0,Math.min(opts.length-1,(parseInt(card.querySelector(".ans").value,10)||1)-1));
      return { type:"mcq", text, options:opts, answerIndex:ans, image: imgData };
    }
    return { type:"short", text, answerText:card.querySelector(".ansText").value.trim(), image: imgData };
  }).filter(Boolean);
  return { title: (els.quizTitle.value||"퀴즈"), questions:list };
}

/* ---------- 옵션/QR ---------- */
function buildStudentLink(){
  if(!roomId) return;
  const url = new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room",roomId);
  els.studentLink.value = url.toString();
  if(window.QRCode && els.qrCanvas){
    window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:140 }, err=>{ if(err) console.warn(err); });
  }
}

/* ---------- 타이머 ---------- */
function startTimer(sec){
  stopTimer();
  const end = Date.now()+sec*1000;
  timerHandle = setInterval(async ()=>{
    const remain = Math.max(0,Math.floor((end-Date.now())/1000));
    els.leftTime.textContent = `${pad(Math.floor(remain/60))}:${pad(remain%60)}`;
    if(remain<=0){
      stopTimer();
      await updateDoc(roomRef(roomId), { accept:false });
      setTimeout(()=> step(+1), 500);
    }
  },250);
}
function stopTimer(){ if(timerHandle){ clearInterval(timerHandle); timerHandle=null; } els.leftTime.textContent="00:00"; }

/* ---------- 제어 ---------- */
async function startQuiz(){
  await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true });
}
async function step(delta){
  await runTransaction(window.db, async(tx)=>{
    const snap=await tx.get(roomRef(roomId)); const r=snap.data();
    const total=(r.questions?.length||0);
    let next=(r.currentIndex??-1)+delta;
    if(next>=total){
      tx.update(roomRef(roomId), { mode:"ended", accept:false });
      return;
    }
    next=Math.max(0,next);
    tx.update(roomRef(roomId), { currentIndex:next, accept:true });
  });
}
async function endQuiz(){
  await updateDoc(roomRef(roomId), { mode:"ended", accept:false });
}

/* ---------- 제출/채점 ---------- */
async function join(){
  if(!roomId) return alert("세션에 먼저 접속하세요.");
  const name=(els.studentName.value||"").trim();
  if(!name) return alert("이름/번호를 입력하세요.");
  me = { id: localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10), name };
  localStorage.setItem("quiz.device", me.id);
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt:serverTimestamp(), answers:{}, alive:true }, { merge:true });
  els.studentJoin.classList.add("hide");
  els.studentQuiz.classList.remove("hide");
  els.sHint.textContent="참가 완료! 제출 버튼을 눌러주세요. 교사가 시작하면 1번 문항이 표시됩니다.";
  saveLocal();
}

async function submitAnswer(value){
  const r=window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx=r.currentIndex; const q=r.questions?.[idx]; if(!q) return;
  const ref=doc(respCol(roomId), me.id);
  const snap=await getDoc(ref); const prev=snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert("이미 제출했습니다.");  // 중복제출 방지
  let correct=null;
  if(q.type==='mcq' && typeof value==='number'){ correct=(value===(q.answerIndex??-999)); }
  if(q.type==='short' && typeof value==='string'){
    const norm=s=>String(s).trim().toLowerCase();
    if(q.answerText) correct=(norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name:me.name, [`answers.${idx}`]: { value, correct:(correct===true), revealed:r.reveal||false } }, { merge:true });
}

/* ---------- 렌더: 관리자 ---------- */
function renderRoom(r){
  // 옵션 값 반영
  if(els.chkAccept) els.chkAccept.checked = !!r.accept;
  if(els.chkReveal) els.chkReveal.checked = !!r.reveal;
  if(els.chkBright) els.chkBright.checked = !!r.bright;
  if(els.timerSec)  els.timerSec.value   = r.timer??30;

  // 프레젠테이션
  els.pTitle.textContent = r.title || roomId || "-";
  const idx=r.currentIndex; const q=r.questions?.[idx];
  if(r.mode!=='active' || idx<0 || !q){
    els.pQ.textContent = "시작 버튼을 누르면 문항이 제시됩니다.";
    els.pOpts.innerHTML = "";
    els.pImg.classList.add("hide");
  }else{
    els.pQ.textContent = q.text;
    els.pOpts.innerHTML="";
    if(q.image?.data){ // data는 저장 로드 시 채워짐 (업로드 때는 아래에서 setDoc 전 변환)
      els.pImg.src = q.image.data; els.pImg.classList.remove("hide");
    } else els.pImg.classList.add("hide");

    if(q.type==='mcq'){
      (q.options||[]).forEach((t,i)=>{
        const b=document.createElement("div");
        b.className="optbtn"; b.textContent=`${i+1}. ${t}`;
        els.pOpts.appendChild(b);
      });
    }
  }

  // 학생 화면도 같이 그리기
  renderStudent(r);
}
function renderResponses(list){
  // 통계
  const r=window.__room||{}; const idx=r.currentIndex; const q=r.questions?.[idx];
  const join = list.length;
  let submit=0, correct=0, wrong=0;
  list.forEach(s=>{
    const a=s.answers?.[idx];
    if(a){ submit++; if(a.correct) correct++; else wrong++; }
  });
  els.statJoin.textContent=join; els.statSubmit.textContent=submit;
  els.statCorrect.textContent=correct; els.statWrong.textContent=wrong;

  // 결과 테이블
  if(els.resultsTable){
    const tbl=document.createElement("table");
    const thead=document.createElement("thead");
    const htr=document.createElement("tr");
    ["이름", ...(r.questions||[]).map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{
      const th=document.createElement("th"); th.textContent=h; htr.appendChild(th);
    });
    thead.appendChild(htr); tbl.appendChild(thead);
    const tbody=document.createElement("tbody");
    const sorted = list.slice().sort((a,b)=>{
      if(els.rankName?.checked) return (a.name||"").localeCompare(b.name||"");
      // 점수순
      const scoreA=(r.questions||[]).reduce((acc,_,i)=>acc + (a.answers?.[i]?.correct?1:0),0);
      const scoreB=(r.questions||[]).reduce((acc,_,i)=>acc + (b.answers?.[i]?.correct?1:0),0);
      return scoreB-scoreA;
    });
    sorted.forEach(s=>{
      let score=0; const tr=document.createElement("tr");
      const tdn=document.createElement("td"); tdn.textContent=s.name||s.id; tr.appendChild(tdn);
      (r.questions||[]).forEach((q,i)=>{
        const a=s.answers?.[i]; const td=document.createElement("td");
        td.textContent = a? (q.type==='mcq' ? (typeof a.value==='number'? a.value+1 : '-') : (a.value??'-')) : '-';
        if(a?.correct) score++;
        tr.appendChild(td);
      });
      const tds=document.createElement("td"); tds.textContent=String(score); tr.appendChild(tds);
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
  }
}

/* ---------- 렌더: 학생 ---------- */
function renderStudent(r){
  if(MODE!=='student') return;
  // 대기/종료 처리
  if(r.mode==='ended'){
    els.sQText.textContent="퀴즈가 종료되었습니다!";
    els.mcqBox.innerHTML=""; els.shortBox.classList.add("hide");
    els.btnSubmit.classList.add("hide");
    // 내 결과
    showMyResult(r);
    return;
  }

  const idx=r.currentIndex; const q=r.questions?.[idx];
  if(r.mode!=='active' || idx<0 || !q){
    els.badgeType.textContent="대기";
    els.sQText.textContent="참가 완료! 제출 버튼을 눌러주세요. 교사가 시작하면 1번 문항이 표시됩니다.";
    els.mcqBox.innerHTML=""; els.shortBox.classList.add("hide");
    els.btnSubmit.classList.remove("hide");
    els.sProgress.textContent="0/0";
    els.sImg.classList.add("hide");
    return;
  }

  // 진행 중
  const total=r.questions.length;
  els.sProgress.textContent = `${idx+1}/${total}`;
  els.sQText.textContent = q.text;
  if(q.image?.data){ els.sImg.src = q.image.data; els.sImg.classList.remove("hide"); } else els.sImg.classList.add("hide");

  if(q.type==='mcq'){
    els.badgeType.textContent="객관식";
    els.mcqBox.innerHTML="";
    (q.options||[]).forEach((opt,i)=>{
      const b=document.createElement("button");
      b.className="optbtn"; b.textContent=`${i+1}. ${opt}`;
      b.addEventListener("click", ()=>{
        $$("#mcqBox .optbtn").forEach(x=>x.classList.remove("selected"));
        b.classList.add("selected");
      });
      els.mcqBox.appendChild(b);
    });
    els.shortBox.classList.add("hide");
    els.btnSubmit.onclick = ()=>{
      const pick = $$("#mcqBox .optbtn").findIndex(x=>x.classList.contains("selected"));
      if(pick<0) return alert("보기를 선택하세요.");
      submitAnswer(pick);
    };
    els.btnSubmit.classList.remove("hide");
  } else {
    els.badgeType.textContent="주관식";
    els.mcqBox.innerHTML="";
    els.shortBox.classList.remove("hide");
    els.btnShortSend.onclick = ()=>{
      const txt=(els.shortInput.value||"").trim(); if(!txt) return alert("정답을 입력하세요.");
      submitAnswer(txt);
      els.shortInput.value="";
    };
    els.btnSubmit.classList.add("hide");
  }
}
function showMyResult(r){
  const ref = doc(respCol(roomId), me.id);
  getDoc(ref).then(snap=>{
    if(!snap.exists()) return;
    const d=snap.data(); let score=0;
    const rows=(r.questions||[]).map((q,i)=>{
      const a=d.answers?.[i]; if(a?.correct) score++;
      return `<tr><td>${i+1}</td><td>${a? (q.type==='mcq'?(typeof a.value==='number'? a.value+1:'-') : (a.value??'-')) : '-'}</td><td>${a?(a.correct?'○':'×'):'-'}</td></tr>`;
    }).join("");
    els.myResult.innerHTML = `
      <h3>내 결과</h3>
      <p>이름: <b>${d.name}</b> · 점수: <b>${score}</b></p>
      <table><thead><tr><th>문항</th><th>제출</th><th>정답</th></tr></thead><tbody>${rows}</tbody></table>
    `;
    els.myResult.classList.remove("hide");
  });
}

/* ---------- 이벤트 바인딩 ---------- */
// 모드 전환(초기 부팅에서 URL 파라미터 우선)
function bootByURL(){
  const url=new URL(location.href);
  const role=url.searchParams.get("role");
  const rid =url.searchParams.get("room");
  if(role==='student'){ setMode("student"); }
  else setMode("admin"); // 기본 관리자
  if(rid){ roomId=rid; connect(); }
}
function autoReconnect(){
  loadLocal();
  const url=new URL(location.href);
  if(url.searchParams.get("role")==='student'){ setMode("student"); }
  else setMode(MODE||"admin");
  if(roomId){ connect(); }
}

els.btnConnect?.addEventListener("click", connect);
els.btnSignOut?.addEventListener("click", signOut);
els.tabBuild?.addEventListener("click", ()=>showTab("build"));
els.tabOptions?.addEventListener("click",()=>showTab("options"));
els.tabPresent?.addEventListener("click",()=>showTab("present"));
els.tabResults?.addEventListener("click",()=>showTab("results"));

els.btnBuildForm?.addEventListener("click", ()=>{
  const n=Math.max(1,Math.min(50,parseInt(els.questionCount.value,10)||3));
  els.builder.innerHTML=""; for(let i=0;i<n;i++) els.builder.appendChild(qCard(i+1));
});
els.btnLoadSample?.addEventListener("click", ()=>{
  const S=[
    {type:'mcq', text:'가장 큰 행성은?', options:['지구','목성','화성','금성'], answerIndex:1},
    {type:'short', text:'물의 끓는점(°C)?', answerText:'100'},
    {type:'mcq', text:'태양의 영어 이름은?', options:['Sun','Moon','Star','Mars'], answerIndex:0},
  ];
  els.builder.innerHTML=""; S.forEach((q,i)=>els.builder.appendChild(qCard(i+1,q)));
  els.quizTitle.value="샘플 퀴즈"; els.questionCount.value=String(S.length);
});
els.btnSaveQuiz?.addEventListener("click", async ()=>{
  if(!roomId){ alert("먼저 세션에 접속하세요."); return; }
  const payload=collectFromBuilder();
  if(!payload.questions.length) return alert("문항을 추가하세요.");
  // 이미지 Base64 변환(있을 때만)
  for(const q of payload.questions){
    if(q.image && q.image._file){
      q.image.data = await q.image._file.arrayBuffer().then(buf=>{
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        return `data:${q.image.mime};base64,${b64}`;
      });
      delete q.image._file;
    }
  }
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("저장 완료!");
});

els.btnUploadTxt?.addEventListener("click", ()=> els.fileUploadTxt.click());
els.fileUploadTxt?.addEventListener("change", async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const txt=await f.text();
  const rows=txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  els.builder.innerHTML="";
  let no=0;
  for(const line of rows){
    const parts=line.split(",").map(s=>s.trim());
    if(parts.length>=6){ // 객관식
      const [text,o1,o2,o3,o4,ans]=parts;
      els.builder.appendChild(qCard(++no,{type:"mcq",text,options:[o1,o2,o3,o4],answerIndex:Math.max(0,Math.min(3,parseInt(ans,10)-1))}));
    }else if(parts.length>=3 && parts[1]==="주관식"){
      const [text,_tag,answerText]=parts;
      els.builder.appendChild(qCard(++no,{type:"short",text,answerText}));
    }
  }
  els.questionCount.value=String(no||3);
  e.target.value="";
});
els.btnDownloadTemplate?.addEventListener("click", ()=>{
  const sample=`가장 큰 행성?,지구,목성,화성,금성,2
수도의 이름은?,주관식,서울`;
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([sample],{type:"text/plain"}));
  a.download="quiz-template.txt"; a.click(); URL.revokeObjectURL(a.href);
});

els.btnSaveOptions?.addEventListener("click", async ()=>{
  if(!roomId){ alert("먼저 세션에 접속하세요."); return; }
  const policy = els.policyName?.checked ? "name" : "device";
  await setDoc(roomRef(roomId), {
    accept: !!els.chkAccept.checked, reveal:!!els.chkReveal.checked,
    bright: !!els.chkBright.checked, timer: Math.max(5,Math.min(600,parseInt(els.timerSec.value,10)||30)),
    policy
  }, { merge:true });
  buildStudentLink();
  alert("옵션 저장 완료!");
});
els.btnResetAll?.addEventListener("click", ()=>{
  els.chkAccept.checked=false; els.chkReveal.checked=false; els.chkBright.checked=false;
  els.timerSec.value=30;
  buildStudentLink();
});

els.btnCopyLink?.addEventListener("click", async ()=>{
  if(!els.studentLink.value) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="복사", 1200);
});
els.btnOpenStudent?.addEventListener("click", ()=> window.open(els.studentLink.value || "#","_blank"));

els.btnStart?.addEventListener("click", startQuiz);
els.btnPrev?.addEventListener("click", ()=> step(-1));
els.btnNext?.addEventListener("click", ()=> step(+1));
els.btnEnd?.addEventListener("click", endQuiz);

els.btnExportCSV?.addEventListener("click", async ()=>{
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
});

els.btnAllReset?.addEventListener("click", async ()=>{
  if(!roomId) return;
  if(!confirm("문항·옵션·응답을 포함해 완전히 초기화할까요?")) return;
  // responses 전체 삭제
  const rs = await getDocs(respCol(roomId));
  await Promise.all(rs.docs.map(d=> deleteDoc(doc(respCol(roomId), d.id))));
  // 룸 초기값으로 리셋
  await setDoc(roomRef(roomId), {
    title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false, bright:false, timer:30, policy:"device", questions:[]
  }, { merge:true });
  alert("전체 초기화 완료!");
});

/* 학생 */
els.btnJoin?.addEventListener("click", join);
els.btnShortSend?.addEventListener("click", ()=> {
  const txt=(els.shortInput.value||"").trim(); if(!txt) return alert("정답을 입력하세요.");
  submitAnswer(txt); els.shortInput.value="";
});

/* ---------- 부팅 ---------- */
(function init(){
  // URL 우선 -> 저장 복구
  if(new URL(location.href).searchParams.has("role")) bootByURL();
  else autoReconnect();
})();
