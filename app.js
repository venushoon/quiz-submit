/* app.js — Live Quiz final (module) */

// Firestore(modular) 함수만 가져온다. (app 초기화는 index.html에서 window.db로 이미 되어 있음)
import {
  collection, doc, getDoc, setDoc, updateDoc, onSnapshot, getDocs,
  runTransaction, serverTimestamp, deleteDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* ---------------------------
   DOM 헬퍼 & 상태
----------------------------*/
const $  = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];
const pad = n => String(n).padStart(2, "0");

let MODE   = "admin";           // "admin" | "student"
let roomId = "";                // 세션 코드
let me     = { id:null, name:"" };
let unsubRoom=null, unsubResp=null;
let timerHandle=null;

// index.html에 이미 있는 요소 id를 그대로 사용 (파일 구조 유지)
const els = {
  // 헤더(관리자 전용)
  roomId:      $("#roomId"),
  btnConnect:  $("#btnConnect"),
  btnSignOut:  $("#btnSignOut"),
  roomStatus:  $("#roomStatus"),
  tabBuild:    $("#tabBuild"),
  tabOptions:  $("#tabOptions"),
  tabPresent:  $("#tabPresent"),
  tabResults:  $("#tabResults"),

  // 패널
  pBuild:      $("#panelBuild"),
  pOptions:    $("#panelOptions"),
  pPresent:    $("#panelPresent"),
  pResults:    $("#panelResults"),

  // 문항 빌더
  quizTitle:   $("#quizTitle"),
  questionCount: $("#questionCount"),
  btnBuildForm:   $("#btnBuildForm"),
  btnLoadSample:  $("#btnLoadSample"),
  btnSaveQuiz:    $("#btnSaveQuiz"),
  btnUploadTxt:   $("#btnUploadTxt"),
  fileUploadTxt:  $("#fileUploadTxt"),
  btnDownloadTemplate: $("#btnDownloadTemplate"),
  builder:     $("#builder"),

  // 옵션/진행
  policyDevice:   $("#policyDevice"),
  policyName:     $("#policyName"),
  chkAccept:      $("#chkAccept"),
  chkReveal:      $("#chkReveal"),
  chkBright:      $("#chkBright"),
  timerSec:       $("#timerSec"),
  btnOptSave:     $("#btnOptSave"),
  btnResetAll:    $("#btnResetAll"),

  // 프레젠테이션
  btnStart:   $("#btnStart"),
  btnPrev:    $("#btnPrev"),
  btnNext:    $("#btnNext"),
  btnEnd:     $("#btnEnd"),
  pTitle:     $("#pTitle"),
  pQ:         $("#pQ"),
  pImgWrap:   $("#pImgWrap"),
  pImg:       $("#pImg"),
  pOpts:      $("#pOpts"),
  leftSec:    $("#leftSec"),
  counters:   {
    join:  $("#cJoin"),
    send:  $("#cSend"),
    ok:    $("#cOk"),
    no:    $("#cNo"),
  },

  // 학생 접속(옵션 패널 오른쪽)
  qrCanvas:     $("#qrCanvas"),
  studentLink:  $("#studentLink"),
  btnCopyLink:  $("#btnCopyLink"),
  btnOpenStd:   $("#btnOpenStudent"),

  // 결과
  resultsTable: $("#resultsTable"),
  btnCSV:       $("#btnExportCSV"),

  // 학생 전용 UI
  sModal:       $("#sModal"),
  sName:        $("#studentName"),
  sBtnJoin:     $("#btnJoin"),
  sBadgeType:   $("#badgeType"),
  sQText:       $("#sQText"),
  sImgWrap:     $("#sImgWrap"),
  sImg:         $("#sImg"),
  sMcq:         $("#mcqBox"),
  sShortWrap:   $("#shortBox"),
  sShort:       $("#shortInput"),
  sShortSend:   $("#btnShortSend"),
  sNotice:      $("#sNotice"),
};

// 관리자 전용 영역(class="admin-only")/학생 노출 제어
function setMode(m){
  MODE = m;
  $$(".admin-only").forEach(n => n.classList.toggle("hide", m!=="admin"));
  // 기본 패널 노출
  if(m==="admin"){
    showTab("build");
  }else{
    // 학생: 모든 관리자 패널 숨김 + 학생 안내 영역만
    els.pBuild?.classList.add("hide");
    els.pOptions?.classList.add("hide");
    els.pPresent?.classList.add("hide");
    els.pResults?.classList.add("hide");
  }
  // 세션 상태 텍스트
  if(els.roomStatus){
    els.roomStatus.textContent = roomId ? `세션: ${roomId} · 온라인` : `세션: - · 오프라인`;
  }
}

// 탭 전환(관리자)
function showTab(name){
  const map = {
    build:   els.pBuild,
    options: els.pOptions,
    present: els.pPresent,
    results: els.pResults
  };
  [els.tabBuild,els.tabOptions,els.tabPresent,els.tabResults].forEach(b=>b?.classList.remove("active"));
  ({build:els.tabBuild, options:els.tabOptions, present:els.tabPresent, results:els.tabResults}[name])?.classList.add("active");
  Object.values(map).forEach(p=>p?.classList.add("hide"));
  map[name]?.classList.remove("hide");
}

/* ---------------------------
   Firestore ref
----------------------------*/
const roomRef = id => doc(collection(window.db, "rooms"), id);
const respCol = id => collection(roomRef(id), "responses");

/* ---------------------------
   세션 & 자동복원
----------------------------*/
function saveLocal(){
  localStorage.setItem("quiz.live", JSON.stringify({ roomId, MODE, me }));
}
function loadLocal(){
  try{
    const d = JSON.parse(localStorage.getItem("quiz.live")||"{}");
    roomId = d.roomId || "";
    MODE   = d.MODE   || "admin";
    me     = d.me     || {id:null, name:""};
    if(els.roomId && roomId) els.roomId.value = roomId;
  }catch{}
}
async function connectRoom(){
  const id = (els.roomId?.value||"").trim();
  if(!id) return alert("세션 코드를 입력하세요.");
  roomId = id;

  // 방이 없으면 생성(최초)
  const snap = await getDoc(roomRef(roomId));
  if(!snap.exists()){
    await setDoc(roomRef(roomId), {
      title: "새 세션",
      mode:  "idle",        // idle | active | ended
      currentIndex: -1,
      accept: false,
      reveal: false,
      policy: { device:true, name:false },
      bright: false,
      timerSec: 30,
      createdAt: serverTimestamp(),
      questions: []
    });
  }
  // 세션 입력 잠금/버튼 표기
  els.roomId?.setAttribute("disabled","disabled");
  els.btnConnect?.classList.add("hide");
  els.btnSignOut?.classList.remove("hide");
  // 실시간 구독
  listenRoom(roomId);
  listenResponses(roomId);
  // 링크/QR 갱신
  refreshStudentLink();
  saveLocal();
  if(els.roomStatus) els.roomStatus.textContent = `세션: ${roomId} · 온라인`;
}
async function signOutRoom(){
  // 구독 해제
  unsubRoom?.(); unsubRoom=null;
  unsubResp?.(); unsubResp=null;
  // UI 초기화(세션 입력 unlock)
  els.roomId?.removeAttribute("disabled");
  els.btnConnect?.classList.remove("hide");
  els.btnSignOut?.classList.add("hide");
  roomId = "";
  saveLocal();
  if(els.roomStatus) els.roomStatus.textContent = `세션: - · 오프라인`;
}

// 앱 시작 시 자동 복원
function autoReconnect(){
  loadLocal();
  // URL 파라미터 모드 우선
  const url  = new URL(location.href);
  const role = url.searchParams.get("role");
  const rid  = url.searchParams.get("room");
  if(role==="student") MODE = "student";
  setMode(MODE);

  if(rid) { roomId = rid; }
  if(MODE==="admin"){
    if(roomId) connectRoom();
  }else{
    // 학생 모드: 세션 파라미터 필수
    if(roomId) {
      // 학생 이름 팝업
      showStudentNameModal();
      listenRoom(roomId);
      listenResponses(roomId);
    }else{
      // 세션이 없으면 관리자에게 문의 안내
      showStudentNotice("세션 링크(또는 QR)로 접속해 주세요.");
    }
  }
}

/* ---------------------------
   실시간 구독 & 렌더
----------------------------*/
function listenRoom(id){
  unsubRoom?.();
  unsubRoom = onSnapshot(roomRef(id), (snap)=>{
    if(!snap.exists()) return;
    const r = snap.data();
    window.__room = r;         // 디버그용
    renderRoom(r);
  });
}
function listenResponses(id){
  unsubResp?.();
  unsubResp = onSnapshot(respCol(id), (qs)=>{
    const list = [];
    qs.forEach(d => list.push({ id:d.id, ...d.data() }));
    renderResponses(list);
  });
}

function renderRoom(r){
  // 프레젠테이션 상단 제목/대기문구
  if(els.pTitle) els.pTitle.textContent = r.title || roomId || "-";
  const idx = r.currentIndex ?? -1;
  const total = r.questions?.length || 0;

  // 밝은 모드
  document.body.classList.toggle("bright", !!r.bright);

  // 관리자: 진행 탭(프레젠테이션) 화면
  if(MODE==="admin"){
    // 대기 문구
    if(els.pQ && els.pOpts){
      if(r.mode!=="active" || idx<0){
        els.pQ.textContent = "시작 버튼을 누르면 문항이 제시됩니다.";
        els.pOpts.innerHTML = "";
        els.pImgWrap?.classList.add("hide");
      }else{
        const q = r.questions[idx];
        els.pQ.textContent = q.text || "-";
        els.pOpts.innerHTML = "";
        if(q.type==="mcq"){
          q.options.forEach((t,i)=>{
            const d = document.createElement("div");
            d.className="popt";
            d.textContent = `${i+1}. ${t}`;
            els.pOpts.appendChild(d);
          });
        }
        // 이미지(있을 때만 표시)
        if(q.image){
          els.pImg.src = q.image;
          els.pImgWrap?.classList.remove("hide");
        }else{
          els.pImgWrap?.classList.add("hide");
        }
      }
    }
  }

  // 학생: 대기/문항 표시
  if(MODE==="student"){
    // 진행 상태별 표시
    if(r.mode==="ended"){
      // 종료 안내
      showStudentNotice("퀴즈가 종료되었습니다!");
      // 결과 보기 버튼 표시(본인 결과)
      renderMyResult(r);
      return;
    }
    if(r.mode!=="active" || idx<0){
      showStudentNotice("참가 완료! 제출 버튼을 눌러주세요. 교사가 시작하면 1번 문항이 표시됩니다.");
      clearStudentQuestion();
      return;
    }
    // 현재 문항
    const q = r.questions[idx];
    els.sNotice?.classList.add("hide");
    // 유형 뱃지
    els.sBadgeType.textContent = (q.type==="mcq"?"객관식":"주관식");
    els.sQText.textContent = q.text || "-";
    // 이미지 표시 여부
    if(q.image){
      els.sImg.src = q.image;
      els.sImgWrap.classList.remove("hide");
    }else{
      els.sImgWrap.classList.add("hide");
    }
    // 제출 가능 여부
    const canSend = !!r.accept;
    // 보기/주관식 구성
    if(q.type==="mcq"){
      els.sMcq.innerHTML="";
      els.sShortWrap.classList.add("hide");
      q.options.forEach((opt,i)=>{
        const b = document.createElement("button");
        b.className = "optbtn";
        b.textContent = `${i+1}. ${opt}`;
        b.disabled = !canSend;
        b.addEventListener("click", ()=> selectAndArmSubmit(i));
        els.sMcq.appendChild(b);
      });
    }else{
      els.sMcq.innerHTML="";
      els.sShortWrap.classList.remove("hide");
      els.sShort.value="";
      els.sShort.disabled = !canSend;
      els.sShortSend.disabled = !canSend;
    }
  }

  // 타이머 잔여
  if(els.leftSec){
    // 타이머는 startTimer에서만 숫자를 갱신하고, 여기서는 모드 전환 시 00:00 초기화만 처리
    if(r.mode!=="active") els.leftSec.textContent = "00:00";
  }

  // 카운터
  updateCounters();
}

function renderResponses(list){
  // 관리자 칩/결과표 업데이트
  if(MODE==="admin"){
    // 결과 표
    if(els.resultsTable){
      const r=window.__room||{}; const questions=r.questions||[];
      const tbl=document.createElement("table");
      const thead=document.createElement("thead");
      const htr=document.createElement("tr");
      ["이름", ...questions.map((_,i)=>`Q${i+1}`), "점수"].forEach(h=>{
        const th=document.createElement("th"); th.textContent=h; htr.appendChild(th);
      });
      thead.appendChild(htr); tbl.appendChild(thead);
      const tb=document.createElement("tbody");
      list.forEach(s=>{
        const tr=document.createElement("tr");
        const nameTd=document.createElement("td"); nameTd.textContent=s.name||s.id; tr.appendChild(nameTd);
        let score=0;
        questions.forEach((q,i)=>{
          const a=s.answers?.[i];
          const td=document.createElement("td");
          if(q.type==="mcq"){
            td.textContent = (typeof a?.value==="number")? (a.value+1) : "-";
          }else{
            td.textContent = (typeof a?.value==="string")? a.value : "-";
          }
          if(a?.correct) score++;
          tr.appendChild(td);
        });
        const st=document.createElement("td"); st.textContent=String(score); tr.appendChild(st);
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      els.resultsTable.innerHTML=""; els.resultsTable.appendChild(tbl);
    }
    updateCounters(list);
  }
}

/* ---------------------------
   카운터/QR/링크
----------------------------*/
function updateCounters(list){
  if(!els.counters?.join) return;
  const r=window.__room||{}; const idx=r.currentIndex??-1;
  const arr = list || (window.__lastList||[]);
  if(!list) return; // onSnapshot(resp)에서만 카운트 갱신
  window.__lastList = arr;

  let join=arr.length, send=0, ok=0, no=0;
  arr.forEach(s=>{
    const a=s.answers?.[idx];
    if(a) send++;
    if(a?.revealed){
      if(a.correct) ok++; else no++;
    }
  });
  els.counters.join.textContent = join;
  els.counters.send.textContent = send;
  els.counters.ok.textContent   = ok;
  els.counters.no.textContent   = no;
}

function refreshStudentLink(){
  if(!roomId || !els.studentLink) return;
  const url = new URL(location.href);
  url.searchParams.set("role","student");
  url.searchParams.set("room", roomId);
  els.studentLink.value = url.toString();
  // QR (있을 때만)
  if(window.QRCode && els.qrCanvas){
    try{
      window.QRCode.toCanvas(els.qrCanvas, els.studentLink.value, { width:132 }, (err)=>{ if(err) console.warn(err) });
    }catch(e){ console.warn(e); }
  }
}

/* ---------------------------
   빌더: 카드 생성/수집/샘플
----------------------------*/
function cardRow(no, q={}){
  const wrap=document.createElement("div");
  wrap.className="qcard";
  wrap.innerHTML=`
    <div class="row wrap">
      <span class="badge">${no}번</span>
      <label class="switch"><input type="radio" name="type-${no}" value="mcq" ${q.type==='short'?'':'checked'}><span>객관식</span></label>
      <label class="switch"><input type="radio" name="type-${no}" value="short" ${q.type==='short'?'checked':''}><span>주관식</span></label>
      <label class="switch right"><input type="file" accept="image/*" class="imgInput" data-no="${no}"><span>이미지</span></label>
    </div>
    <input class="qtext input" placeholder="문항 내용" value="${q.text||''}">
    <div class="mcq ${q.type==='short'?'hide':''}">
      <div class="row wrap">
        ${(q.options||['','','','']).map((v,i)=>`<input class="opt input" data-idx="${i}" placeholder="보기 ${i+1}" value="${v||''}">`).join('')}
      </div>
      <div class="row"><span class="hint">정답 번호</span><input class="ansIndex input sm" type="number" min="1" max="10" value="${(q.answerIndex??0)+1}"></div>
    </div>
    <div class="short ${q.type==='short'?'':'hide'}">
      <input class="ansText input" placeholder="정답(선택, 자동채점용)" value="${q.answerText||''}">
    </div>
  `;
  // 유형 토글
  const radios = $$(`input[name="type-${no}"]`, wrap);
  const mcq   = $(".mcq",wrap);
  const short = $(".short",wrap);
  radios.forEach(r=>r.addEventListener("change",()=>{
    const isShort = radios.find(x=>x.checked)?.value==='short';
    mcq.classList.toggle("hide", isShort);
    short.classList.toggle("hide", !isShort);
  }));
  return wrap;
}

function collectBuilder(){
  const cards = $$(".qcard", els.builder);
  const list  = cards.map((c, idx)=>{
    const no = idx+1;
    const type = c.querySelector(`input[name="type-${no}"]:checked`).value;
    const text = c.querySelector(".qtext").value.trim();
    if(!text) return null;
    // 이미지(선택)
    const imgEl = c.querySelector(".imgInput");
    const image = imgEl?.dataset?.dataurl || "";
    if(type==="mcq"){
      const opts = $$(".opt",c).map(i=>i.value.trim()).filter(Boolean);
      const ans  = Math.max(0, Math.min(opts.length-1, (parseInt(c.querySelector(".ansIndex").value,10)||1)-1));
      return { type:"mcq", text, options:opts, answerIndex:ans, image };
    }else{
      return { type:"short", text, answerText:c.querySelector(".ansText").value.trim(), image };
    }
  }).filter(Boolean);
  return { title: (els.quizTitle?.value||"퀴즈"), questions:list };
}

/* ---------------------------
   진행/타이머/제출/채점
----------------------------*/
async function startQuiz(){
  await updateDoc(roomRef(roomId), { mode:"active", currentIndex:0, accept:true });
  // 프레젠테이션 탭 자동 전환
  showTab("present");
}
async function step(delta){
  await runTransaction(window.db, async (tx)=>{
    const snap = await tx.get(roomRef(roomId));
    const r = snap.data(); const total=(r.questions?.length||0);
    let next = (r.currentIndex??-1)+delta;
    if(next >= total){
      // 자동 종료 → 결과 탭으로
      tx.update(roomRef(roomId), { mode:"ended", accept:false, currentIndex: total-1 });
      return;
    }
    next = Math.max(0, next);
    tx.update(roomRef(roomId), { currentIndex:next, accept:true });
  });
}
async function endQuiz(){
  if(!confirm("퀴즈를 종료할까요?")) return;
  await updateDoc(roomRef(roomId), { mode:"ended", accept:false });
  showTab("results");
}

function startTimer(sec){
  stopTimer();
  const end = Date.now()+sec*1000;
  timerHandle = setInterval(()=> {
    const left = Math.max(0, Math.floor((end-Date.now())/1000));
    if(els.leftSec){
      els.leftSec.textContent = `${pad(Math.floor(left/60))}:${pad(left%60)}`;
    }
    if(left<=0){
      stopTimer();
      updateDoc(roomRef(roomId), { accept:false });
      setTimeout(()=> step(+1), 600);
    }
  }, 200);
}
function stopTimer(){
  if(timerHandle){ clearInterval(timerHandle); timerHandle=null; }
  if(els.leftSec) els.leftSec.textContent="00:00";
}

// 학생 제출
async function selectAndArmSubmit(i){
  // 제출 버튼 중복/미반영 방지: 보기 클릭 → 확인창
  const ok = confirm(`"${i+1}번"으로 제출할까요? 제출 후 수정할 수 없습니다.`);
  if(!ok) return;
  await submitAnswer(i);
}
async function submitAnswer(value){
  const r = window.__room; if(!r?.accept) return alert("지금은 제출할 수 없습니다.");
  const idx = r.currentIndex; const q = r.questions?.[idx]; if(!q) return;

  // 학생 식별자(기기) 확보
  if(!me.id){
    me.id = localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10);
    localStorage.setItem("quiz.device", me.id);
  }
  const ref = doc(respCol(roomId), me.id);
  const snap = await getDoc(ref); const prev = snap.exists()? (snap.data().answers||{}) : {};
  if(prev[idx]!=null) return alert("이미 제출했습니다.");

  let correct=null;
  if(q.type==="mcq" && typeof value==="number"){
    correct = (value===(q.answerIndex??-999));
  }
  if(q.type==="short" && typeof value==="string"){
    const norm = s => String(s).trim().toLowerCase();
    if(q.answerText) correct = (norm(value)===norm(q.answerText));
  }
  await setDoc(ref, { name: me.name, [`answers.${idx}`]: { value, correct:(correct===true), revealed: !!r.reveal } }, { merge:true });
  alert("제출되었습니다.");
}
async function grade(uid, qIndex, ok){
  await setDoc(doc(respCol(roomId), uid), {
    [`answers.${qIndex}.correct`]: !!ok,
    [`answers.${qIndex}.revealed`]: true
  }, { merge:true });
}

/* ---------------------------
   학생 전용: 이름 팝업/대기/결과
----------------------------*/
function showStudentNameModal(){
  if(!els.sModal) return;
  els.sModal.classList.remove("hide");
  els.sName.value="";
  els.sName.focus();
}
function hideStudentNameModal(){
  els.sModal?.classList.add("hide");
}
function showStudentNotice(msg){
  if(!els.sNotice) return;
  els.sNotice.textContent = msg;
  els.sNotice.classList.remove("hide");
}
function clearStudentQuestion(){
  els.sQText.textContent="-";
  els.sImgWrap?.classList.add("hide");
  els.sMcq.innerHTML="";
  els.sShortWrap.classList.add("hide");
}
async function joinStudent(){
  const name = (els.sName?.value||"").trim();
  if(!name) return alert("이름(또는 번호)을 입력하세요.");
  me.name = name;
  // 디바이스 id 보장
  me.id = localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10);
  localStorage.setItem("quiz.device", me.id);
  await setDoc(doc(respCol(roomId), me.id), { name, joinedAt: serverTimestamp() }, { merge:true });
  hideStudentNameModal();
  showStudentNotice("참가 완료! 제출 버튼을 눌러주세요. 교사가 시작하면 1번 문항이 표시됩니다.");
  saveLocal();
}
function renderMyResult(r){
  // 학생 개인 결과를 간략히 안내(테이블은 관리자 결과 탭)
  els.sMcq.innerHTML="";
  els.sShortWrap.classList.add("hide");
  const box = document.createElement("div");
  box.style.marginTop="12px";
  const idxs = (r.questions||[]).map((_,i)=>i);
  const list = (window.__lastList||[]).filter(s=>s.id===me.id);
  const mine = list[0];
  let score=0;
  const rows = idxs.map(i=>{
    const q=r.questions[i]; const a=mine?.answers?.[i];
    if(a?.correct) score++;
    const col = a? (q.type==="mcq" ? (typeof a.value==="number"?(a.value+1):"-") : (a.value??"-")) : "-";
    const mark = a? (a.correct?"○":"×") : "-";
    return `<tr><td>${i+1}</td><td style="text-align:center">${col}</td><td style="text-align:center">${mark}</td></tr>`;
  }).join("");
  box.innerHTML = `
    <div class="card">
      <h3>내 결과</h3>
      <p>이름: <b>${me.name||"-"}</b> · 점수: <b>${score}</b></p>
      <table class="mini">
        <thead><tr><th>문항</th><th>제출</th><th>정답</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
  els.sMcq.appendChild(box);
}

/* ---------------------------
   옵션 저장/초기화
----------------------------*/
async function saveOptions(){
  const policy = {
    device: !!els.policyDevice?.checked,
    name:   !!els.policyName?.checked
  };
  const bright = !!els.chkBright?.checked;
  const reveal = !!els.chkReveal?.checked;
  const accept = !!els.chkAccept?.checked;
  const timer  = Math.max(5, Math.min(600, parseInt(els.timerSec?.value,10)||30));
  await setDoc(roomRef(roomId), { policy, bright, reveal, accept, timerSec:timer }, { merge:true });
  refreshStudentLink(); // 저장 직후 QR/링크 갱신
  alert("옵션이 저장되었습니다.");
}

async function resetAll(){
  if(!confirm("문항/설정/결과를 모두 삭제하여 처음 상태로 되돌릴까요?")) return;
  await setDoc(roomRef(roomId), {
    title:"새 세션", mode:"idle", currentIndex:-1, accept:false, reveal:false,
    policy:{device:true,name:false}, bright:false, timerSec:30, questions:[]
  }, { merge:false });
  // 응답 전부 삭제
  const snap = await getDocs(respCol(roomId));
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
  alert("초기화 완료");
}

/* ---------------------------
   이벤트 바인딩
----------------------------*/
// 헤더
els.btnConnect?.addEventListener("click", connectRoom);
els.btnSignOut?.addEventListener("click", signOutRoom);

// 탭
els.tabBuild?.addEventListener("click", ()=>showTab("build"));
els.tabOptions?.addEventListener("click", ()=>showTab("options"));
els.tabPresent?.addEventListener("click", ()=>showTab("present"));
els.tabResults?.addEventListener("click", ()=>showTab("results"));

// 빌더
els.btnBuildForm?.addEventListener("click", ()=>{
  const n = Math.max(1, Math.min(50, parseInt(els.questionCount?.value,10)||3));
  els.builder.innerHTML="";
  for(let i=0;i<n;i++) els.builder.appendChild(cardRow(i+1));
});
els.btnLoadSample?.addEventListener("click", ()=>{
  const S=[
    {type:"mcq",  text:"가장 큰 행성은?", options:["지구","목성","화성","금성"], answerIndex:1},
    {type:"short",text:"물의 끓는점(°C)?", answerText:"100"},
    {type:"mcq",  text:"태양계를 영어로?", options:["Milky","Solar","Sunset","Lunar"], answerIndex:1},
  ];
  els.builder.innerHTML="";
  S.forEach((q,i)=> els.builder.appendChild(cardRow(i+1,q)));
  els.quizTitle.value="샘플 퀴즈";
  els.questionCount.value=String(S.length);
});
els.btnSaveQuiz?.addEventListener("click", async ()=>{
  if(!roomId) return alert("먼저 세션에 접속하세요.");
  const payload = collectBuilder();
  if(!payload.questions.length) return alert("문항을 작성하세요.");
  await setDoc(roomRef(roomId), { title:payload.title, questions:payload.questions }, { merge:true });
  alert("저장 완료");
});
els.btnUploadTxt?.addEventListener("click", ()=> els.fileUploadTxt?.click());
els.fileUploadTxt?.addEventListener("change", async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const text = await f.text();
  const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const qs=[];
  lines.forEach(line=>{
    const parts = line.split(",").map(s=>s.trim());
    if(parts.length>=3 && parts[1]==="주관식"){
      qs.push({ type:"short", text:parts[0], answerText:parts[2]||"" });
    }else if(parts.length>=6){
      const [t,o1,o2,o3,o4,ans] = parts;
      qs.push({ type:"mcq", text:t, options:[o1,o2,o3,o4], answerIndex:Math.max(0,Math.min(3,(parseInt(ans,10)||1)-1)) });
    }
  });
  els.builder.innerHTML="";
  qs.forEach((q,i)=> els.builder.appendChild(cardRow(i+1,q)));
  els.quizTitle.value = els.quizTitle.value || "TXT 업로드";
  els.questionCount.value = String(qs.length);
});
els.btnDownloadTemplate?.addEventListener("click", ()=>{
  const sample = [
    "가장 큰 행성은?,지구,목성,화성,금성,2",
    "물의 끓는점(°C)?,주관식,100"
  ].join("\n");
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([sample],{type:"text/plain"}));
  a.download="quiz-sample.txt"; a.click(); URL.revokeObjectURL(a.href);
});

// 옵션
els.btnOptSave?.addEventListener("click", saveOptions);
els.btnResetAll?.addEventListener("click", resetAll);

// 프레젠테이션 진행
els.btnStart?.addEventListener("click", ()=>{
  if(!roomId) return alert("세션에 접속하세요.");
  startQuiz();
  const r=window.__room||{};
  const sec = Math.max(5, Math.min(600, r.timerSec||30));
  startTimer(sec);
});
els.btnPrev?.addEventListener("click", ()=> step(-1));
els.btnNext?.addEventListener("click", ()=> step(+1));
els.btnEnd ?.addEventListener("click", endQuiz);

// 학생용 링크 & QR
els.btnCopyLink?.addEventListener("click", async ()=>{
  if(!els.studentLink?.value) return;
  await navigator.clipboard.writeText(els.studentLink.value);
  els.btnCopyLink.textContent="복사됨"; setTimeout(()=> els.btnCopyLink.textContent="복사", 1200);
});
els.btnOpenStd?.addEventListener("click", ()=> window.open(els.studentLink?.value||"#","_blank"));

// 학생 제출
els.sShortSend?.addEventListener("click", ()=>{
  const v=(els.sShort?.value||"").trim(); if(!v) return;
  submitAnswer(v);
});
els.sBtnJoin?.addEventListener("click", joinStudent);

/* ---------------------------
   부팅
----------------------------*/
autoReconnect();
