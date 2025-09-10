/* =========================
   app.js (복붙용 안정 최종본)
   - firebase-compat (전역 firebase)
   - URL ?mode=student 이면 학생모드, 아니면 관리자모드
   - 필수 HTML IDs:
     roomId, btnConnect, roomStatus,
     btnStart, btnPrev, btnNext, btnEndAll,
     presentQ, presentOpts, studentView
   ========================= */
(function () {
  // ---------- 작은 유틸 ----------
  const $id = (id) => document.getElementById(id);
  const $qs = (sel, root=document) => root.querySelector(sel);
  const text = (id, v) => { const n=$id(id); if(n) n.textContent = v; };
  const html = (id, v) => { const n=$id(id); if(n) n.innerHTML = v; };

  // ---------- Firebase 준비 확인 ----------
  if (!window.firebase) {
    console.error("[firebase] not loaded. include compat scripts in <head>.");
    return;
  }

  // ---------- Firebase 초기화 ----------
  try {
    const cfg = {
      apiKey: "AIzaSyCClNc95ykYCudmLHTPgpewZ60bZ8zukbo",
      authDomain: "live-quiz-a14d1.firebaseapp.com",
      projectId: "live-quiz-a14d1",
    };
    if (!firebase.apps.length) firebase.initializeApp(cfg);
  } catch (e) {
    console.error("firebase.initializeApp failed:", e);
    return;
  }
  const db = firebase.firestore();

  // ---------- 모드/상태 ----------
  const MODE = (new URLSearchParams(location.search).get("mode")||"").toLowerCase()==="student" ? "student" : "admin";
  let roomId = "";                        // 현재 세션 코드
  let ROOM = null;                        // 최신 rooms/{roomId} 데이터
  let unsubRoom = null, unsubResp = null; // 실시간 구독
  let me = { id:null, name:"" };          // 학생용 디바이스/이름

  // ---------- Firestore refs ----------
  const roomRef = (id) => db.collection("rooms").doc(id);
  const respCol = (id) => roomRef(id).collection("responses");

  // ---------- 방 존재 보장 ----------
  async function ensureRoom(id) {
    const snap = await roomRef(id).get();
    if (!snap.exists) {
      await roomRef(id).set({
        title: "새 세션",
        mode: "idle",          // idle | active | ended
        currentIndex: -1,      // -1: 시작 전
        accept: false,         // 제출 허용
        questions: [],         // [{type:'mcq'|'short', text, options?, answerIndex?, answerText?, imageUrl?}]
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge:true });
    }
  }

  // ---------- 실시간 구독 ----------
  function listenRoom(id){
    if (unsubRoom) unsubRoom();
    unsubRoom = roomRef(id).onSnapshot(snap=>{
      if (!snap.exists) return;
      ROOM = snap.data();
      renderRoom(ROOM);
    });
  }
  function listenResponses(id){
    if (unsubResp) unsubResp();
    unsubResp = respCol(id).onSnapshot(qs=>{
      // 필요 시 결과/리더보드 구현 지점
      const list=[]; qs.forEach(d=>list.push({id:d.id,...d.data()}));
      // renderResponses(list); // 확장용 훅
    });
  }

  // ---------- 연결 ----------
  async function connect(){
    const input = $id("roomId");
    if (!input) { alert("roomId 입력창이 없습니다."); return; }
    const id = (input.value||"").trim();
    if (!id) { alert("세션 코드를 입력하세요."); return; }

    roomId = id;
    try {
      await ensureRoom(roomId);
      listenRoom(roomId);
      listenResponses(roomId);
      text("roomStatus", `세션: ${roomId} · 온라인`);
    } catch(e){
      console.error("connect failed:", e);
      alert("세션 접속 실패");
    }
  }

  // ---------- 진행 제어(관리자) ----------
  async function startQuiz(){
    if (!roomId) return alert("세션 먼저 연결하세요.");
    // 문항 없음 → 종료 처리
    const snap = await roomRef(roomId).get();
    const r = snap.data()||{};
    const total = (r.questions?.length||0);
    if (total<=0){
      await roomRef(roomId).set({ mode:"ended", currentIndex:-1, accept:false }, { merge:true });
      return;
    }
    await roomRef(roomId).set({ mode:"active", currentIndex:0, accept:true }, { merge:true });
  }
  async function prevQ(){
    if (!roomId) return;
    await db.runTransaction(async tx=>{
      const s = await tx.get(roomRef(roomId)); const r=s.data()||{};
      const total=(r.questions?.length||0); if (total<=0) { tx.update(roomRef(roomId), { mode:"ended", accept:false }); return; }
      let next = Math.max(0, (r.currentIndex??0)-1);
      tx.update(roomRef(roomId), { mode:"active", currentIndex:next, accept:true });
    });
  }
  async function nextQ(){
    if (!roomId) return;
    await db.runTransaction(async tx=>{
      const s = await tx.get(roomRef(roomId)); const r=s.data()||{};
      const total=(r.questions?.length||0);
      if (total<=0){ tx.update(roomRef(roomId), { mode:"ended", accept:false }); return; }
      let next = (r.currentIndex??-1)+1;
      if (next>=total){
        tx.update(roomRef(roomId), { mode:"ended", accept:false });
      }else{
        tx.update(roomRef(roomId), { mode:"active", currentIndex:next, accept:true });
      }
    });
  }
  async function endAll(){
    if (!roomId) return;
    await roomRef(roomId).set({ mode:"ended", accept:false }, { merge:true });
  }

  // ---------- 학생 참가/제출 ----------
  async function joinStudent(name){
    if (!roomId) return alert("세션 먼저 연결하세요.");
    const nm=(name||"").trim(); if(!nm) return alert("이름/번호를 입력하세요.");

    me.id = localStorage.getItem("quiz.device") || Math.random().toString(36).slice(2,10);
    localStorage.setItem("quiz.device", me.id);
    me.name = nm;

    await respCol(roomId).doc(me.id).set({
      name:nm, joinedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge:true });

    const box = $id("studentView");
    if (box) box.textContent = "참가 완료! 시작을 기다려 주세요.";
  }

  async function submitMC(i){
    if (!roomId || !ROOM) return;
    if (ROOM.mode!=="active" || !ROOM.accept) return alert("지금은 제출할 수 없습니다.");
    const idx = ROOM.currentIndex;
    const q = ROOM.questions?.[idx]; if(!q) return;
    const ref = respCol(roomId).doc(me.id);
    const snap = await ref.get();
    const prev = snap.exists ? (snap.data().answers||{}) : {};
    if (prev[idx]!=null) return alert("이미 제출했습니다.");

    const correct = (i === (q.answerIndex ?? -999));
    await ref.set({ name: me.name, answers: { ...prev, [idx]: { value:i, correct } } }, { merge:true });
    alert("제출되었습니다.");
  }
  async function submitShort(txt){
    if (!roomId || !ROOM) return;
    if (ROOM.mode!=="active" || !ROOM.accept) return alert("지금은 제출할 수 없습니다.");
    const idx = ROOM.currentIndex;
    const q = ROOM.questions?.[idx]; if(!q) return;
    const ref = respCol(roomId).doc(me.id);
    const snap = await ref.get();
    const prev = snap.exists ? (snap.data().answers||{}) : {};
    if (prev[idx]!=null) return alert("이미 제출했습니다.");
    const norm=s=>String(s||"").trim().toLowerCase();
    const correct = norm(txt)===norm(q.answerText||"");
    await ref.set({ name: me.name, answers: { ...prev, [idx]: { value:txt, correct } } }, { merge:true });
    alert("제출되었습니다.");
  }

  // ---------- 렌더 ----------
  function renderRoom(r){
    ROOM = r;

    // 관리자 프레젠테이션
    if (MODE==="admin"){
      if ($id("presentQ") && $id("presentOpts")){
        if (r.mode==="idle"){
          text("presentQ","시작 버튼을 누르면 문항이 제시됩니다.");
          html("presentOpts","");
        } else if (r.mode==="active" && r.currentIndex>=0){
          const q = r.questions?.[r.currentIndex];
          text("presentQ", q?.text || "-");
          if (q?.type==="mcq"){
            html("presentOpts", (q.options||[]).map((t,i)=>`<div class="opt-line">${i+1}. ${t}</div>`).join(""));
          } else {
            html("presentOpts", "");
          }
        } else if (r.mode==="ended"){
          text("presentQ","퀴즈가 종료되었습니다.");
          html("presentOpts","");
        }
      }
    }

    // 학생 화면
    if (MODE==="student"){
      const box = $id("studentView"); if(!box) return;

      // 아직 이름 미등록 → 참가 폼
      if (!me.id || !me.name){
        box.innerHTML = `
          <div class="join-wrap">
            <input id="joinName" class="input" placeholder="이름 또는 번호를 입력하세요!" />
            <button id="btnJoinGo" class="btn">참가</button>
          </div>
          <div class="hint">참가 후 교사가 시작하면 1번 문항이 표시됩니다.</div>
        `;
        $id("btnJoinGo")?.addEventListener("click", ()=>{
          const nm = $id("joinName")?.value || "";
          joinStudent(nm);
        });
        return;
      }

      // 이름 등록 후 상태별 UI
      if (r.mode!=="active" || r.currentIndex<0){
        box.textContent = "대기 중입니다… 교사가 시작하면 1번 문항이 표시됩니다.";
        return;
      }

      const q = r.questions?.[r.currentIndex]; if (!q){ box.textContent="문항을 불러오는 중…"; return; }
      if (q.type==="mcq"){
        box.innerHTML = `
          <div class="q-title">${q.text||"-"}</div>
          <div class="mc-list">
            ${(q.options||[]).map((t,i)=>`<button class="mc-opt" data-i="${i}">${i+1}. ${t}</button>`).join("")}
          </div>`;
        box.querySelectorAll(".mc-opt").forEach(btn=>{
          btn.addEventListener("click", ()=>{
            const i = Number(btn.getAttribute("data-i"));
            submitMC(i);
          });
        });
      } else {
        box.innerHTML = `
          <div class="q-title">${q.text||"-"}</div>
          <div class="short-wrap">
            <input id="shortAns" class="input" placeholder="정답을 입력하세요" />
            <button id="btnShortSubmit" class="btn">제출</button>
          </div>`;
        $id("btnShortSubmit")?.addEventListener("click", ()=>{
          const v = $id("shortAns")?.value || "";
          submitShort(v);
        });
      }
    }
  }

  // ---------- 이벤트 ----------
  $id("btnConnect")?.addEventListener("click", connect);
  $id("btnStart")  ?.addEventListener("click", startQuiz);
  $id("btnPrev")   ?.addEventListener("click", prevQ);
  $id("btnNext")   ?.addEventListener("click", nextQ);
  $id("btnEndAll") ?.addEventListener("click", endAll);

  // ---------- 초기 부팅 ----------
  window.addEventListener("load", ()=>{
    // 관리자 첫 진입 문구
    if (MODE==="admin" && $id("presentQ") && $id("presentOpts")){
      text("presentQ","시작 버튼을 누르면 문항이 제시됩니다.");
      html("presentOpts","");
    }
    // 학생 링크면 참가 폼부터
    if (MODE==="student" && $id("studentView")){
      $id("studentView").innerHTML = `
        <div class="join-wrap">
          <input id="joinName" class="input" placeholder="이름 또는 번호를 입력하세요!" />
          <button id="btnJoinGo" class="btn">참가</button>
        </div>
        <div class="hint">참가 후 교사가 시작하면 1번 문항이 표시됩니다.</div>
      `;
      $id("btnJoinGo")?.addEventListener("click", ()=>{
        const nm = $id("joinName")?.value || "";
        joinStudent(nm);
      });
    }
  });
})();
