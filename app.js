/* ================================
   app.js — 최종 완성본 (복붙 교체용)
   - 로드 타이밍 보강: ready(init)
   - 안전 바인딩: null-safe 처리
   - 레거시 id 호환: alias/pick 헬퍼
   - 주관식 제출/내결과보기 확실 동작
==================================*/

// ===== 유틸 =====
const $ = (id) => document.getElementById(id);
const CE = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };

// 이미 로드되었으면 즉시, 아니면 load 후 실행
function ready(fn) { if (document.readyState === "complete") fn(); else window.addEventListener("load", fn, { once:true }); }
// 여러 후보 id 중 먼저 존재하는 요소를 반환
function pick(...ids){ for(const id of ids){ const el=document.getElementById(id); if(el) return el; } return null; }
// 안전 addEventListener
function on(el, type, handler){ if(el) el.addEventListener(type, handler); }

// ===== DOM 캐시 =====
let els = {};

// ===== 전역 상태 =====
let ROOM = null;
let MODE = "admin";
let roomUnsub = null;
let participantUnsub = null;
let editQuestions = [];
let questionTimer = null;

// ===== URL 파라미터로 모드/룸 결정 =====
const U = new URL(location.href);
if ((U.searchParams.get("role") || "").toLowerCase() === "student" && U.searchParams.get("room")) {
  MODE = "student";
  ROOM = U.searchParams.get("room").trim();
}

const getStudentId = () => {
  let id = localStorage.getItem(`quiz_student_id_${ROOM}`);
  if (!id) { id = (crypto?.randomUUID?.() || Math.random().toString(36).slice(2)); localStorage.setItem(`quiz_student_id_${ROOM}`, id); }
  return id;
};

// ===== 공통 =====
function setTab(activeTabId) {
  if (els.tabs && els.panels) {
    els.tabs.forEach(tab => tab.classList.toggle('active', tab.id === activeTabId));
    els.panels.forEach(panel => panel.classList.toggle('hide', panel.id !== `panel${activeTabId.slice(3)}`));
  }
  if (participantUnsub) { participantUnsub(); participantUnsub = null; }

  if (activeTabId === 'tabOpt') {
    listenForParticipants();
    els.qrCard && els.qrCard.classList.remove('hide');
  } else {
    els.participantCard && els.participantCard.classList.add('hide');
    els.qrCard && els.qrCard.classList.add('hide');
  }

  if (activeTabId === 'tabRes') refreshResults();
}

function buildStudentLink(room) {
  if (!els.studentLink || !els.qrImg) return;
  const studentUrl = `${location.origin}${location.pathname}?role=student&room=${encodeURIComponent(room)}`;
  els.studentLink.value = studentUrl;
  els.qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(studentUrl)}`;
}

function defaultRoom(){
  return {
    title:"새 퀴즈", questions:[], currentIndex:-1, mode:"idle", accept:true, revealed:-1,
    counters:{join:0, submit:0, correct:0, wrong:0},
    createdAt: window.FS.serverTimestamp(),
    policy:{ once:"device", openResult:false, timer:30, bright:false }
  };
}

// ===== 관리자 플로우 =====
async function connect(){
  const room = els.sessionInput?.value?.trim();
  if(!room){ alert("세션 코드를 입력하세요."); return; }
  ROOM = room;

  const docRef = window.FS.doc("rooms", ROOM);
  const doc = await window.FS.getDoc(docRef);
  if(!doc.exists) await window.FS.setDoc(docRef, defaultRoom());

  els.sessionInput && (els.sessionInput.disabled = true);
  if(els.btnConnection){ els.btnConnection.textContent='세션아웃'; els.btnConnection.classList.add('danger'); els.btnConnection.onclick = disconnect; }
  els.sessionStatus && (els.sessionStatus.textContent = `세션: ${ROOM} · 온라인`);

  buildStudentLink(ROOM);
  setTab('tabQ');

  if(roomUnsub) roomUnsub();
  roomUnsub = window.FS.onSnapshot(docRef, snap => { if(snap.exists) renderRoom(snap.data()); });
}

function disconnect(){
  roomUnsub && roomUnsub(); participantUnsub && participantUnsub();
  roomUnsub = null; participantUnsub = null; ROOM = null;

  els.sessionInput && (els.sessionInput.disabled = false);
  if(els.btnConnection){ els.btnConnection.textContent='접속'; els.btnConnection.classList.remove('danger'); els.btnConnection.onclick = connect; }
  els.sessionStatus && (els.sessionStatus.textContent = `세션: - · 오프라인`);
  els.studentLink && (els.studentLink.value = "");
  els.qrImg && (els.qrImg.src = "");
  els.qList && (els.qList.innerHTML = "");
  els.quizTitle && (els.quizTitle.value = "");
}

function addQuestionUI(){
  const type = els.qType?.value;
  const text = els.qText?.value?.trim();
  if(!text){ alert("문항을 입력하세요."); return; }

  let q = { type, text };
  if(type === "mcq"){
    const opts = [els.opt1?.value, els.opt2?.value, els.opt3?.value, els.opt4?.value].map(s => (s||"").trim());
    const ans = parseInt(els.qAnswer?.value,10) - 1;
    if(opts.some(v=>!v)){ alert("객관식 보기 1~4를 모두 입력하세요."); return; }
    if(!Number.isInteger(ans) || ans<0 || ans>3){ alert("정답 번호(1~4)를 입력하세요."); return; }
    q.options = opts; q.answer = ans;
  }else{
    const ansT = (els.qAnswer?.value||"").trim();
    if(!ansT){ alert("주관식 정답 텍스트를 입력하세요."); return; }
    q.answerText = ansT;
  }

  const file = els.qImg?.files?.[0];
  const pushQ = (newQ)=>{
    editQuestions.push(newQ);
    renderQuestionList();
    els.qText && (els.qText.value=""); els.qAnswer && (els.qAnswer.value="");
    ["opt1","opt2","opt3","opt4"].forEach(k=> els[k] && (els[k].value=""));
    els.qImg && (els.qImg.value="");
  };

  if(file){
    const reader = new FileReader();
    reader.onload = ()=>{ q.image = reader.result; pushQ(q); };
    reader.readAsDataURL(file);
  }else pushQ(q);
}

async function saveQuestions(){
  if(!ROOM){ alert("먼저 세션에 접속하세요."); return; }
  if(editQuestions.length===0){ alert("추가된 문항이 없습니다."); return; }
  const docRef = window.FS.doc("rooms", ROOM);
  const doc = await window.FS.getDoc(docRef);
  const currentQuestions = doc.exists ? (doc.data().questions||[]) : [];
  const newQuestions = [...currentQuestions, ...editQuestions];
  const title = els.quizTitle?.value || doc.data()?.title || "퀴즈";
  await window.FS.setDoc(docRef, { questions:newQuestions, title }, { merge:true });
  editQuestions = [];
  alert("문항 저장 완료");
}

async function deleteQuestion(indexToDelete){
  if(!ROOM) return;
  const docRef = window.FS.doc("rooms", ROOM);
  const doc = await window.FS.getDoc(docRef);
  if(!doc.exists) return;
  const questions = doc.data().questions || [];
  const questionText = (questions[indexToDelete]?.text||"").slice(0,20);
  if(!confirm(`'${questionText}...' 문항을 삭제하시겠습니까?`)) return;
  questions.splice(indexToDelete,1);
  await window.FS.updateDoc(docRef, { questions });
}

async function resetQuestions(){
  if(!ROOM){ alert("먼저 세션에 접속하세요."); return; }
  if(!confirm("현재 퀴즈의 모든 문항을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) return;
  await window.FS.updateDoc(window.FS.doc("rooms", ROOM), { questions:[] });
  editQuestions = [];
}

function makeBlank(){
  els.quizTitle && (els.quizTitle.value="");
  els.qText && (els.qText.value="");
  els.qAnswer && (els.qAnswer.value="");
  ["opt1","opt2","opt3","opt4"].forEach(k=> els[k] && (els[k].value=""));
  els.qImg && (els.qImg.value="");
  editQuestions = [];
  renderQuestionList();
}

function loadSample(){
  if(editQuestions.length>0 && !confirm("작성 중인 문항이 있습니다. 초기화하고 샘플을 불러올까요?")) return;
  makeBlank();
  editQuestions = [
    { type:"mcq", text:"가장 큰 행성은?", options:["지구","목성","화성","금성"], answer:1 },
    { type:"mcq", text:"태양에서 세 번째 행성?", options:["수성","화성","지구","금성"], answer:2 },
    { type:"short", text:"지구의 위성 이름은?", answerText:"달" }
  ];
  renderQuestionList();
  els.quizTitle && (els.quizTitle.value = "샘플 퀴즈");
}

async function saveOptions(){
  if(!ROOM){ alert("먼저 세션에 접속하세요."); return; }
  const policy = {
    once: els.onceName?.checked ? "name" : "device",
    openResult: !!els.openResult?.checked,
    timer: Math.max(0, parseInt(els.timerSec?.value,10) || 0),
    bright: !!els.brightMode?.checked
  };
  await window.FS.setDoc(window.FS.doc("rooms", ROOM), { policy }, { merge:true });
  buildStudentLink(ROOM);
  alert("옵션 저장 완료");
}

async function resetAll(){
  if(!ROOM){ alert("먼저 세션에 접속하세요."); return; }
  if(!confirm("이 세션의 모든 문항, 결과, 옵션을 초기화할까요? 이 작업은 되돌릴 수 없습니다.")) return;
  await window.FS.setDoc(window.FS.doc("rooms", ROOM), defaultRoom());
  alert("초기화 완료");
}

async function controlQuiz(action){
  if(!ROOM){ alert("먼저 세션에 접속하세요."); return; }
  const docRef = window.FS.doc("rooms", ROOM);

  if(action==='start'){
    const doc = await window.FS.getDoc(docRef);
    if(!doc.exists || !doc.data().questions || doc.data().questions.length===0){
      alert("퀴즈에 문항이 없습니다. 문항을 추가한 후 시작해주세요.");
      return;
    }
    await window.FS.updateDoc(docRef, { mode:"active", currentIndex:0, accept:true, revealed:-1 });
  }else if(action==='end'){
    await window.FS.updateDoc(docRef, { mode:"ended", accept:false });
    setTab('tabRes');
  }else{
    const doc = await window.FS.getDoc(docRef);
    if(!doc.exists) return;
    const data = doc.data();
    const max = (data.questions?.length||0) - 1;
    const cur = data.currentIndex ?? -1;

    if(action==='next'){
      if(cur < max) await window.FS.updateDoc(docRef, { currentIndex:cur+1, accept:true, revealed:-1 });
      else await controlQuiz('end');
    }else if(action==='prev'){
      await window.FS.updateDoc(docRef, { currentIndex:Math.max(0, cur-1), accept:true, revealed:-1 });
    }else if(action==='reveal'){
      await window.FS.updateDoc(docRef, { revealed:cur, accept:false });
    }
  }
}

function exportCSV(){
  if(!ROOM){ alert("먼저 세션에 접속하세요."); return; }
  if(!els.resBody) return;
  let csv = "\uFEFF순위,이름,점수\n";
  els.resBody.querySelectorAll("tr").forEach(row=>{
    const rank = `"${row.cells[0].textContent.trim()}"`;
    const name = `"${row.cells[1].textContent.trim().replace(/"/g,'""')}"`;
    const score = `"${row.cells[row.cells.length-1].textContent.trim()}"`;
    csv += `${rank},${name},${score}\n`;
  });
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const a = CE("a"); a.href=URL.createObjectURL(blob); a.download=`quiz_result_${ROOM}.csv`; a.click();
}

function toggleFullscreen(){
  if(!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}
document.addEventListener('fullscreenchange', ()=>{
  if(!els.btnFullscreen) return;
  els.btnFullscreen.textContent = document.fullscreenElement ? "화면 복귀" : "전체 화면";
});

// ===== 학생 플로우 =====
async function joinStudent(){
  const name = els.joinName?.value?.trim();
  if(!name){ alert("이름을 입력하세요."); return; }
  const sid = getStudentId();

  const roomRef = window.FS.doc("rooms", ROOM);
  const respRef = window.FS.doc("rooms", ROOM, "responses", sid);

  await window.db.runTransaction(async (tx)=>{
    const respDoc = await tx.get(respRef);
    if(!respDoc.exists){
      tx.set(respRef, { name, joinedAt: window.FS.serverTimestamp(), deviceId:sid, answers:{}, score:0 });
      tx.update(roomRef, { 'counters.join': window.FS.increment(1) });
    }
  });

  els.joinDialog?.close?.();
}

async function submitStudent(answerPayload){
  const sid = getStudentId();
  const roomRef = window.FS.doc("rooms", ROOM);
  const respRef = window.FS.doc("rooms", ROOM, "responses", sid);

  try{
    await window.db.runTransaction(async (tx)=>{
      const roomDoc = await tx.get(roomRef);
      const respDoc = await tx.get(respRef);
      if(!roomDoc.exists || !respDoc.exists) throw "세션 또는 참가자 정보가 없습니다.";

      const r = roomDoc.data();
      const qIdx = r.currentIndex;
      if(qIdx<0 || !r.accept) return;

      const q = r.questions[qIdx];
      const student = respDoc.data();
      if(student.answers?.[qIdx] !== undefined) return;

      const ok = q.type === "mcq"
        ? (answerPayload === q.answer)
        : (String(answerPayload||"").trim().toLowerCase() === String(q.answerText||"").trim().toLowerCase());

      const newAnswers = { ...student.answers, [qIdx]: answerPayload };
      const newScore = (student.score||0) + (ok?1:0);

      tx.update(respRef, { answers:newAnswers, score:newScore });

      const counter = { 'counters.submit': window.FS.increment(1) };
      counter[ ok ? 'counters.correct':'counters.wrong' ] = window.FS.increment(1);
      tx.update(roomRef, counter);

      setTimeout(()=> alert(r.policy?.openResult ? (ok ? "정답입니다! ✅" : "오답입니다. ❌") : "제출 완료!"), 0);
    });
  }catch(e){ console.error("제출 트랜잭션 실패:", e); }
}

// ===== 렌더링 =====
function renderRoom(r){
  els.body?.classList?.toggle('bright-mode', !!r.policy?.bright);
  els.pTitle && (els.pTitle.textContent = r.title || "");
  els.sTitle && (els.sTitle.textContent = r.title || "");
  els.chipJoin && (els.chipJoin.textContent = r.counters?.join || 0);
  els.chipSubmit && (els.chipSubmit.textContent = r.counters?.submit || 0);
  els.chipCorrect && (els.chipCorrect.textContent = r.counters?.correct || 0);
  els.chipWrong && (els.chipWrong.textContent = r.counters?.wrong || 0);

  const total = r.questions?.length || 0;
  const cur = r.currentIndex ?? -1;
  els.qCounter && (els.qCounter.textContent = `Q${Math.max(0,cur+1)}/${total}`);

  if(MODE==='admin'){
    els.quizTitle && (els.quizTitle.value = r.title || "");
    els.openResult && (els.openResult.checked = !!r.policy?.openResult);
    els.brightMode && (els.brightMode.checked = !!r.policy?.bright);
    els.timerSec && (els.timerSec.value = r.policy?.timer || 30);
    if(r.policy?.once==='name') els.onceName && (els.onceName.checked = true);
    else els.onceDevice && (els.onceDevice.checked = true);
    renderQuestionList(r.questions);
  }

  const q = r.questions?.[cur];
  updateTimer(r);

  // 관리자 화면
  if(MODE==='admin'){
    if(!els.presHint || !els.pWrap) return;
    if(r.mode==='ended'){
      els.presHint.textContent="퀴즈가 종료되었습니다.";
      els.presHint.classList.remove("hide"); els.pWrap.classList.add("hide");
    }else if(r.mode!=='active' || !q){
      els.presHint.textContent="시작 버튼을 누르면 문항이 제시됩니다.";
      els.presHint.classList.remove("hide"); els.pWrap.classList.add("hide");
    }else{
      els.presHint.classList.add("hide"); els.pWrap.classList.remove("hide");
      els.pQText && (els.pQText.textContent = q.text || "");
      if(els.pQImg){ els.pQImg.src = q.image || ""; els.pQImg.classList.toggle("hide", !q.image); }
      if(els.pOpts){
        els.pOpts.innerHTML="";
        if(q.type==="mcq"){
          q.options.forEach((opt,i)=>{
            const b = CE("div","popt"); b.textContent=`${i+1}. ${opt}`;
            if(r.revealed===cur && i===q.answer) b.classList.add("correct");
            else if(r.revealed===cur) b.classList.add("incorrect");
            els.pOpts.appendChild(b);
          });
        }else{
          const b = CE("div","popt");
          if(r.revealed===cur){ b.textContent=`정답: ${q.answerText||""}`; b.classList.add("correct"); }
          else b.textContent="[주관식 문항]";
          els.pOpts.appendChild(b);
        }
      }
    }
  }

  // 학생 화면
  if(MODE==='student'){
    if(!els.joinDialog?.open) els.sWrap && els.sWrap.classList.remove("hide");

    if(r.mode==='ended'){
      els.sQBox && els.sQBox.classList.add("hide");
      els.sState && (els.sState.textContent = "");
      els.sDone && els.sDone.classList.remove("hide");
      (els.btnMyResult || $('btnMyResult') || $('sMyResult'))?.addEventListener('click', refreshMyResult);
      refreshMyResult();
    }else if(r.mode!=='active' || !q){
      els.sState && (els.sState.textContent="교사가 시작버튼을 누르면 퀴즈가 시작됩니다. 준비되었나요?");
      els.sQBox && els.sQBox.classList.add("hide");
    }else if(!r.accept){
      els.sState && (els.sState.textContent = r.revealed===cur ? "정답이 공개되었습니다." : "제출이 마감되었습니다. 다음 문항을 기다려주세요.");
      els.sQBox && els.sQBox.classList.add("hide");
    }else{
      els.sState && (els.sState.textContent="");
      els.sQBox && els.sQBox.classList.remove("hide");
      els.sQTitle && (els.sQTitle.textContent = `Q${cur+1}. ${q.text||""}`);
      if(els.sQImg){ els.sQImg.src = q.image || ""; els.sQImg.classList.toggle("hide", !q.image); }
      els.sOptBox && (els.sOptBox.innerHTML="");
      els.sShortWrap && els.sShortWrap.classList.add("hide");
      els.sSubmitBox && (els.sSubmitBox.innerHTML="");

      if(q.type==="mcq"){
        let chosen = null;
        q.options.forEach((opt,i)=>{
          const btn = CE("button","sopt"); btn.textContent = `${i+1}. ${opt}`;
          if(r.revealed===cur && i===q.answer) btn.classList.add("correct");
          else if(r.revealed===cur) btn.classList.add("incorrect");
          btn.onclick = ()=>{
            if(r.revealed===cur || !r.accept) return;
            chosen = i;
            document.querySelectorAll('#sOptBox .sopt').forEach(c=>c.classList.remove("active"));
            btn.classList.add("active");
            renderSubmitButton(chosen);
          };
          els.sOptBox && els.sOptBox.appendChild(btn);
        });
      }else{
        els.sShortWrap && els.sShortWrap.classList.remove("hide");
        const shortBtn = (els.btnShortSend || $('btnShortSend') || $('sShortSend'));
        if(shortBtn){
          shortBtn.onclick = ()=>{
            const val = (els.sShort?.value||"").trim();
            if(!val){ alert("정답을 입력하세요."); return; }
            submitStudent(val);
            shortBtn.disabled = true;
          };
        }
      }
    }
  }
}

function renderQuestionList(questions=[]){
  if(!els.qList) return;
  els.qList.innerHTML="";
  const all = [...editQuestions.slice().reverse(), ...(questions||[])];
  els.qList.style.display = all.length>0 ? 'block' : 'none';
  all.forEach((q,idx)=>{
    const item = CE("div","item");
    const isUnsaved = idx < editQuestions.length;
    const savedIdx = idx - editQuestions.length;

    item.innerHTML = `<span class="item-text">${q.type==='mcq'?'[객관식]':'[주관식]'} ${q.text}</span>`;
    if(isUnsaved) item.innerHTML += `<span class="chip" style="margin-left:auto;font-size:.8em;padding:2px 6px;">저장 안됨</span>`;
    const del = CE("button","delete-btn"); del.textContent="×";
    del.onclick = (e)=>{
      e.stopPropagation();
      if(isUnsaved){ const origin = editQuestions.length-1-idx; editQuestions.splice(origin,1); renderQuestionList(questions); }
      else deleteQuestion(savedIdx);
    };
    item.appendChild(del);
    els.qList.appendChild(item);
  });
}

function renderSubmitButton(chosen){
  if(!els.sSubmitBox) return;
  els.sSubmitBox.innerHTML="";
  const s = CE("button","btn green"); s.textContent="제출";
  s.onclick = ()=>{ if(chosen===null) alert("보기를 선택하세요"); else { submitStudent(chosen); s.disabled = true; } };
  els.sSubmitBox.appendChild(s);
}

function updateTimer(roomData){
  clearInterval(questionTimer);
  const timeLimit = roomData.policy?.timer || 30;
  if(roomData.mode==='active' && roomData.accept){
    let remain = timeLimit;
    els.liveTimer && (els.liveTimer.textContent = `${String(Math.floor(remain/60)).padStart(2,'0')}:${String(remain%60).padStart(2,'0')}`);
    questionTimer = setInterval(async ()=>{
      remain--;
      els.liveTimer && (els.liveTimer.textContent = `${String(Math.floor(remain/60)).padStart(2,'0')}:${String(remain%60).padStart(2,'0')}`);
      if(remain<=0){
        clearInterval(questionTimer);
        if(MODE==='admin') await window.FS.updateDoc(window.FS.doc("rooms", ROOM), { accept:false });
      }
    },1000);
  }else{
    els.liveTimer && (els.liveTimer.textContent = `00:00`);
  }
}

async function refreshResults(){
  if(!ROOM || !els.resHead || !els.resBody) return;
  const roomSnap = await window.FS.getDoc(window.FS.doc("rooms", ROOM));
  if(!roomSnap.exists) return;

  const doc = roomSnap.data();
  const total = doc.questions?.length || 0;
  els.resHead.innerHTML = `<tr><th>순위</th><th>이름</th>${Array.from({length:total},(_,i)=>`<th>Q${i+1}</th>`).join("")}<th>점수</th></tr>`;

  const respSnap = await window.FS.getDocs(window.FS.doc("rooms", ROOM, "responses"));
  const rows = []; respSnap.forEach(d => rows.push(d.data()));
  rows.sort((a,b)=>(b.score||0)-(a.score||0));

  els.resBody.innerHTML = rows.map((v,i)=>{
    const rank=i+1, icon = rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':rank;
    let cells = `<td class="rank-icon">${icon}</td><td>${v.name||"(무명)"}</td>`;
    for(let k=0;k<total;k++){
      const ans = v.answers?.[k]; let out = "-";
      if(ans!==undefined){
        const q = doc.questions[k];
        if(!q) out='?';
        else {
          const ok = q.type==="mcq" ? (ans===q.answer)
            : (String(ans||"").trim().toLowerCase()===String(q.answerText||"").trim().toLowerCase());
          out = ok ? "✔️" : "❌";
        }
      }
      cells += `<td>${out}</td>`;
    }
    cells += `<td>${v.score||0}</td>`;
    return `<tr class="rank-${rank>3?'etc':rank}">${cells}</tr>`;
  }).join("");
}

async function refreshMyResult(){
  els.myResult && els.myResult.classList.remove('hide');
  const sid = getStudentId();
  const respSnap = await window.FS.getDoc(window.FS.doc("rooms", ROOM, "responses", sid));
  if(!respSnap.exists){ els.myResult && (els.myResult.innerHTML="제출 기록이 없습니다."); return; }

  const roomSnap = await window.FS.getDoc(window.FS.doc("rooms", ROOM));
  const doc = roomSnap.data();
  const total = doc.questions?.length || 0;
  const v = respSnap.data();

  let html = `<p>이름: <b>${v.name||""}</b> · 점수: <b>${v.score||0} / ${total}</b></p>
    <table class="table"><thead><tr><th>문항</th><th>제출</th><th>정답</th><th>결과</th></tr></thead><tbody>`;
  for(let i=0;i<total;i++){
    const q = doc.questions[i]; if(!q) continue;
    const ans = v.answers?.[i];
    let ok=false, give="-";
    if(ans!==undefined){
      if(q.type==="mcq"){ ok = ans===q.answer; give = q.options[ans]||"-"; }
      else { ok = String(ans||"").trim().toLowerCase()===String(q.answerText||"").trim().toLowerCase(); give = String(ans); }
    }
    const correct = q.type==="mcq" ? q.options[q.answer] : q.answerText;
    html += `<tr><td>Q${i+1}</td><td>${give}</td><td>${correct}</td><td>${ans!==undefined?(ok?'O':'X'):'-'}</td></tr>`;
  }
  html += `</tbody></table>`;
  els.myResult && (els.myResult.innerHTML = html);
}

function listenForParticipants(){
  if(!ROOM || !els.participantCard) return;
  els.participantCard.classList.remove('hide');
  const responsesRef = window.FS.doc("rooms", ROOM, "responses");
  participantUnsub = window.FS.onSnapshot(responsesRef, snap=>{
    const names = []; snap.forEach(d=>{ const v=d.data(); if(v?.name) names.push(v.name); });
    els.participantCount && (els.participantCount.textContent = names.length);
    els.participantList && (els.participantList.innerHTML = names.map(n=>`<li>${n}</li>`).join(''));
  });
}

// ===== DOM 캐시 (레거시 id 호환) =====
function cacheDOMElements(){
  const alias = {
    body: [],
    // 세션/탭
    sessionInput:['sessionInput','roomInput','sessInput'],
    btnConnection:['btnConnection','connectBtn','btnConnect'],
    sessionStatus:['sessionStatus','statusText'],
    tabQ:['tabQ'], tabOpt:['tabOpt'], tabPres:['tabPres'], tabRes:['tabRes'],
    // 문항 편집
    quizTitle:['quizTitle','titleInput'],
    btnBlank:['btnBlank','makeBlankBtn'],
    btnSample:['btnSample','loadSampleBtn'],
    btnSaveQ:['btnSaveQ','saveQuestionsBtn'],
    btnResetQ:['btnResetQ','resetQuestionsBtn'],
    qText:['qText','question','questionText'],
    qType:['qType','questionType'],
    qAnswer:['qAnswer','answer','answerText'],
    qImg:['qImg','qImage','questionImage'],
    mcqBox:['mcqBox','mcqRow'],
    opt1:['opt1','choice1'], opt2:['opt2','choice2'], opt3:['opt3','choice3'], opt4:['opt4','choice4'],
    btnAddQ:['btnAddQ','addQuestionBtn'],
    qList:['qList','questionList'],
    // 옵션
    onceDevice:['onceDevice','onceDeviceRadio'],
    onceName:['onceName','onceNameRadio'],
    openResult:['openResult','cbOpenResult'],
    brightMode:['brightMode','cbBrightMode'],
    timerSec:['timerSec','timer','secTimer'],
    btnOptSave:['btnOptSave','saveOptionsBtn'],
    // 학생 접속/QR
    qrCard:['qrCard','cardQR'], qrImg:['qrImg','qrImage'],
    studentLink:['studentLink','studentUrl'],
    btnCopy:['btnCopy','btnCopyLink'],
    btnOpen:['btnOpen','btnOpenLink'],
    btnToggleLink:['btnToggleLink','toggleLinkBtn','btnShowLink'],
    studentLinkContainer:['studentLinkContainer','studentLinkRow'],
    // 참가자
    participantCard:['participantCard','cardParticipants'],
    participantCount:['participantCount','countParticipants'],
    participantList:['participantList','listParticipants'],
    // 프레젠테이션 컨트롤
    btnStart:['btnStart','startBtn'],
    btnPrev:['btnPrev','prevBtn'],
    btnNext:['btnNext','nextBtn'],
    btnEnd:['btnEnd','endBtn','finishBtn'],
    btnReveal:['btnReveal','revealBtn','showAnswerBtn'],
    btnFullscreen:['btnFullscreen','fullScreenBtn'],
    chipJoin:['chipJoin'], chipSubmit:['chipSubmit'], chipCorrect:['chipCorrect'], chipWrong:['chipWrong'],
    qCounter:['qCounter'], liveTimer:['liveTimer','timerDisplay'],
    // 프레젠테이션 뷰
    pTitle:['pTitle','presTitle'],
    presHint:['presHint','presentationHint'],
    pWrap:['pWrap','presentationWrap'],
    pQText:['pQText','pQuestion'],
    pQImg:['pQImg','pImage'],
    pOpts:['pOpts','pOptions'],
    // 결과
    btnExport:['btnExport','exportBtn'],
    btnResetAll:['btnResetAll','resetAllBtn'],
    resHead:['resHead','resultHead'],
    resBody:['resBody','resultBody'],
    // 학생 패널
    studentPanel:['studentPanel'],
    joinDialog:['joinDialog','dlgJoin'],
    joinName:['joinName','inputJoinName'],
    btnJoin:['btnJoin','joinBtn'],
    sWrap:['sWrap','studentWrap'],
    sTitle:['sTitle','studentTitle'],
    sState:['sState','studentState'],
    // 학생 진행
    sQBox:['sQBox','studentQBox'],
    sQTitle:['sQTitle','studentQTitle'],
    sQImg:['sQImg','studentQImg'],
    sOptBox:['sOptBox','studentOptBox'],
    sShortWrap:['sShortWrap','studentShortWrap'],
    sShort:['sShort','studentShort'],
    btnShortSend:['btnShortSend','sShortSend'], // 주관식 제출
    sSubmitBox:['sSubmitBox','studentSubmitBox'],
    // 학생 종료/결과
    sDone:['sDone','studentDone'],
    myResult:['myResult','myResultBox'],
    btnMyResult:['btnMyResult','sMyResult','btnResult'] // 결과 버튼
  };

  els.body = document.body;
  Object.entries(alias).forEach(([key, ids])=>{
    if(key==='body') return;
    els[key] = pick(...ids);
  });
  els.tabs = document.querySelectorAll('.tabs .tab, .tab') || [];
  els.panels = document.querySelectorAll('.panel.admin-only, section.panel.admin-only') || [];
}

// ===== 초기화 =====
function init(){
  cacheDOMElements();

  if(!window.firebase || !window.db){ alert("Firebase 라이브러리 로딩에 실패했습니다."); return; }

  if(MODE==='admin'){
    document.querySelectorAll('.admin-only').forEach(el=> el.style.display='flex');
    els.studentPanel && (els.studentPanel.style.display='none');

    els.tabs.forEach(tab=> on(tab,'click',()=> setTab(tab.id)));
    els.btnConnection && (els.btnConnection.onclick = connect);
    els.btnBlank && (els.btnBlank.onclick = makeBlank);
    els.btnSample && (els.btnSample.onclick = loadSample);
    els.btnAddQ && (els.btnAddQ.onclick = addQuestionUI);
    els.btnSaveQ && (els.btnSaveQ.onclick = saveQuestions);
    els.btnResetQ && (els.btnResetQ.onclick = resetQuestions);
    els.btnOptSave && (els.btnOptSave.onclick = saveOptions);
    els.btnCopy && (els.btnCopy.onclick = ()=> navigator.clipboard.writeText(els.studentLink?.value||""));
    els.btnOpen && (els.btnOpen.onclick = ()=> { if(els.studentLink?.value) window.open(els.studentLink.value,"_blank"); });
    els.btnStart && (els.btnStart.onclick = ()=> controlQuiz('start'));
    els.btnPrev && (els.btnPrev.onclick = ()=> controlQuiz('prev'));
    els.btnNext && (els.btnNext.onclick = ()=> controlQuiz('next'));
    els.btnEnd && (els.btnEnd.onclick = ()=> controlQuiz('end'));
    els.btnReveal && (els.btnReveal.onclick = ()=> controlQuiz('reveal'));
    els.btnExport && (els.btnExport.onclick = exportCSV);
    els.btnResetAll && (els.btnResetAll.onclick = resetAll);
    els.btnToggleLink && (els.btnToggleLink.onclick = ()=>{
      const hidden = els.studentLinkContainer?.classList?.toggle('hide');
      els.btnToggleLink.textContent = hidden ? '주소 보기' : '주소 숨기기';
    });
    els.btnFullscreen && (els.btnFullscreen.onclick = toggleFullscreen);

    setTab('tabQ');

  }else{ // student
    document.querySelectorAll('.admin-only').forEach(el=> el.style.display='none');
    els.studentPanel && (els.studentPanel.style.display='block');
    els.btnJoin && (els.btnJoin.onclick = joinStudent);

    if(ROOM){
      const docRef = window.FS.doc("rooms", ROOM);
      window.FS.getDoc(docRef).then(snap=>{
        if(!snap.exists){ document.body.innerHTML = "<h1>세션이 존재하지 않거나 삭제되었습니다.</h1>"; return; }
        if(snap.data().mode==='ended'){
          els.sWrap && els.sWrap.classList.add('hide');
          els.sDone && els.sDone.classList.remove('hide');
          refreshMyResult();
          (els.btnMyResult || $('btnMyResult') || $('sMyResult'))?.addEventListener('click', refreshMyResult);
        }else{
          els.joinDialog?.showModal?.();
        }
        roomUnsub = window.FS.onSnapshot(docRef, d=>{ if(d.exists) renderRoom(d.data()); });
      });
    }else{
      document.body.innerHTML = "<h1>잘못된 접근입니다.</h1>";
    }
  }
}

// === 실행 ===
ready(init);
