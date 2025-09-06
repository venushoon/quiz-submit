
import React, { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { ref, onValue, set, update, runTransaction } from "firebase/database";
import type { DataSnapshot } from "firebase/database";
import { db, ensureAuth, auth } from "./firebase";

/** ===== Types ===== */
type Visibility = "always" | "hidden" | "deadline";
type LockMode = "device" | "name";

type Submission = {
  id: string;         // server key
  by: string;         // key (uid or normalized name)
  name?: string|null; // display name if not anonymous
  text: string;       // problem text
  answer?: string|null;
  at: number;
};

type QuizDoc = {
  title: string;
  desc: string;
  anonymous: boolean;
  visibilityMode: Visibility;
  deadlineAt: number|null;
  expectedCount: number; // expected submissions for auto close
  manualClosed: boolean;
  lockMode: LockMode;
  submissions: Record<string, Submission>;
  createdAt: number;
  updatedAt: number;
};

/** ===== Utils ===== */
const DEFAULT_DESC = "주제에 맞는 퀴즈 문제를 제출하세요. (예: 과학 상식 퀴즈)";
const LS_PID_KEY = "quiz_submit_last_pid";

const uuid = () => (window.crypto as any)?.randomUUID?.() || `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const getView = (): "admin" | "student" => (location.hash === "#student" ? "student" : "admin");
const quizPath = (pid: string) => `quizzes/${pid}`;
const getPidFromURL = () => { try { return new URL(location.href).searchParams.get("pid") || ""; } catch { return ""; } };
const normalizeName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

const defaultDoc = (): QuizDoc => ({
  title: "우리 반 퀴즈 문제 제출",
  desc: DEFAULT_DESC,
  anonymous: false,
  visibilityMode: "always",
  deadlineAt: null,
  expectedCount: 0,
  manualClosed: false,
  lockMode: "device",
  submissions: {},
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

/** ===== App ===== */
export default function App() {
  const [viewMode, setViewMode] = useState<"admin" | "student">(getView());
  useEffect(() => { const f = () => setViewMode(getView()); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);

  const [isBooting, setIsBooting] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [pid, setPid] = useState<string>("");

  // state
  const [title, setTitle] = useState("우리 반 퀴즈 문제 제출");
  const [desc, setDesc] = useState(DEFAULT_DESC);
  const [anonymous, setAnonymous] = useState(false);
  const [visibilityMode, setVisibilityMode] = useState<Visibility>("always");
  const [deadlineAt, setDeadlineAt] = useState<number|null>(null);
  const [expectedText, setExpectedText] = useState("0");
  const [expectedCount, setExpectedCount] = useState(0);
  const [manualClosed, setManualClosed] = useState(false);
  const [lockMode, setLockMode] = useState<LockMode>("device");
  const [submissions, setSubmissions] = useState<Record<string, Submission>>({});

  const [saveHint, setSaveHint] = useState("");
  const [linkVersion, setLinkVersion] = useState(0);
  const [showLink, setShowLink] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const votedCount = Object.keys(submissions).length;
  const autoClosed = expectedCount > 0 && votedCount >= expectedCount;
  const isClosed = manualClosed || autoClosed;

  const now = Date.now();
  const baseVisible = useMemo(() => {
    if (visibilityMode === "always") return true;
    if (visibilityMode === "hidden") return false;
    if (!deadlineAt) return false;
    return now >= deadlineAt;
  }, [visibilityMode, deadlineAt, now]);

  // 관리자에선 숨김이어도 확인 가능
  const isVisibleAdmin = visibilityMode === "hidden" ? true : baseVisible;
  const isVisibleStudent = baseVisible;

  // boot & subscribe
  useEffect(() => {
    let unsub: any;
    (async () => {
      try {
        await ensureAuth();
        let p = getPidFromURL() || localStorage.getItem(LS_PID_KEY) || "";
        if (!p) {
          p = Math.random().toString(36).slice(2, 8);
          await set(ref(db, quizPath(p)), defaultDoc());
        }
        setPid(p);
        localStorage.setItem(LS_PID_KEY, p);
        const u = new URL(location.href); u.searchParams.set("pid", p); history.replaceState({}, "", u.toString());

        unsub = onValue(ref(db, quizPath(p)), (snap: DataSnapshot) => {
          const d = snap.val() as QuizDoc | null;
          if (!d) return;
          setTitle(d.title ?? "우리 반 퀴즈 문제 제출");
          setDesc(d.desc ?? DEFAULT_DESC);
          setAnonymous(!!d.anonymous);
          setVisibilityMode((d.visibilityMode as Visibility) ?? "always");
          setDeadlineAt(d.deadlineAt ?? null);
          const n = Number(d.expectedCount ?? 0); setExpectedCount(isNaN(n) ? 0 : n); setExpectedText(String(isNaN(n) ? 0 : n));
          setManualClosed(!!d.manualClosed);
          setLockMode((d.lockMode as LockMode) ?? "device");
          setSubmissions(d.submissions || {});
          setIsBooting(false);
        }, (err) => { console.error(err); setIsBooting(false); });
      } catch (e) {
        console.error(e);
        setIsBooting(false);
      }
    })();
    return () => { if (unsub) unsub(); };
  }, []);

  // helpers
  const studentLink = useMemo(() => {
    const u = new URL(location.href);
    if (pid) u.searchParams.set("pid", pid);
    u.hash = "#student";
    u.searchParams.set("v", String(linkVersion));
    return u.toString();
  }, [pid, linkVersion]);

  const patch = async (fields: Partial<QuizDoc>) => {
    if (!pid) return;
    await update(ref(db, quizPath(pid)), { ...fields, updatedAt: Date.now() });
  };

  const saveJSON = () => {
    const payload = JSON.stringify({ title, desc, anonymous, visibilityMode, deadlineAt, expectedCount, manualClosed, lockMode, submissions }, null, 2);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    download(`quiz-submit-${stamp}.json`, payload, "application/json");
    setSaveHint("JSON으로 저장했어요.");
  };

  const saveCSV = () => {
    const head = "name,key,at,text,answer\n";
    const rows = Object.entries(submissions).map(([k, s]) =>
      `${escapeCSV(s.name || "")},${escapeCSV(k)},${new Date(s.at).toLocaleString()},${escapeCSV(s.text)},${escapeCSV(s.answer || "")}`
    ).join("\n");
    const csv = head + rows;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    download(`quiz-submit-${stamp}.csv`, csv, "text/csv");
    setSaveHint("CSV로 저장했어요.");
  };

  const download = (filename: string, text: string, mime = "application/json") => {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };
  const escapeCSV = (s: string) => {
    if (s == null) return "";
    const needs = /[",\n]/.test(s); const out = String(s).replace(/"/g, '""');
    return needs ? `"${out}"` : out;
  };

  const loadFromFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(String(ev.target?.result || "{}"));
        await patch({
          title: data.title ?? title,
          desc: data.desc ?? desc,
          anonymous: !!data.anonymous,
          visibilityMode: (data.visibilityMode as Visibility) ?? "always",
          deadlineAt: data.deadlineAt ?? null,
          expectedCount: Number(data.expectedCount ?? 0),
          manualClosed: !!data.manualClosed,
          lockMode: (data.lockMode as LockMode) ?? "device",
          submissions: data.submissions ?? {},
        });
        setLinkVersion(v => v + 1);
        setSaveHint("JSON에서 불러왔어요.");
      } catch { alert("JSON 형식 오류"); }
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  };

  const resetAll = async () => {
    if (!confirm("모든 제출 데이터와 설정을 기본값으로 초기화할까요?")) return;
    await set(ref(db, quizPath(pid)), defaultDoc());
    setLinkVersion(v => v + 1);
  };

  const closeNow = async () => { await patch({ manualClosed: true }); };
  const reopen = async () => { await patch({ manualClosed: false }); };

  const copyLink = () => navigator.clipboard.writeText(studentLink).then(() => setSaveHint("학생용 링크를 복사했어요."));

  // Admin layout
  const fileRefLocal = fileRef;

  if (isBooting) return <div className="min-h-screen grid place-items-center text-gray-500">초기화 중…</div>;

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50 text-gray-900">
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-sky-600 text-white grid place-items-center font-bold shadow">Q</div>
            <div>
              {viewMode === "admin" ? (
                <input
                  className="text-xl md:text-2xl font-semibold bg-transparent border-b border-transparent focus:border-sky-400 outline-none px-1 rounded"
                  value={title}
                  onChange={e => { setTitle(e.target.value); void patch({ title: e.target.value }); }}
                  aria-label="제목"
                />
              ) : (
                <div className="text-xl md:text-2xl font-semibold">{title}</div>
              )}
              <div className="text-xs text-gray-500">QR 제출 / 결과 공개 제어 / 실시간 동기화</div>
            </div>
          </div>

          {viewMode === "admin" ? (
            <div className="flex items-center gap-2">
              <button onClick={saveJSON} className="px-3 py-2 rounded-xl bg-sky-600 text-white hover:bg-sky-700 shadow">JSON 저장</button>
              <button onClick={saveCSV} className="px-3 py-2 rounded-xl bg-white border hover:bg-gray-50 shadow">CSV 저장</button>
              <button onClick={() => fileRefLocal.current?.click()} className="px-3 py-2 rounded-xl bg-white border hover:bg-gray-50 shadow">불러오기</button>
              <input ref={fileRefLocal} type="file" accept="application/json" className="hidden" onChange={loadFromFile} />
            </div>
          ) : (
            <div className="text-xs text-gray-500">학생 화면</div>
          )}
        </div>

        {viewMode === "admin" && (
          <div className="border-t bg-gradient-to-r from-sky-50 to-indigo-50">
            <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-3 text-sm">
              <span className="px-2 py-1 rounded-full bg-white border text-gray-700">제출 {votedCount}{expectedCount>0?`/${expectedCount}`:''}</span>
              {isClosed ? (
                <span className="px-2 py-1 rounded-full bg-rose-100 text-rose-700 border">마감됨</span>
              ) : (
                <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 border">진행중</span>
              )}
              <div className="flex-1 h-2 bg-white/60 rounded-full overflow-hidden">
                <div className="h-full bg-sky-500" style={{ width: `${Math.min(100, expectedCount? (votedCount/expectedCount)*100 : 0)}%` }} />
              </div>
            </div>
          </div>
        )}
      </header>

      {viewMode === "admin" ? (
        <AdminView
          {...{
            desc, setDesc: (v: string)=>{ setDesc(v); void patch({ desc: v }); },
            anonymous, setAnonymous: (b: boolean)=>{ setAnonymous(b); void patch({ anonymous: b }); },
            visibilityMode, setVisibilityMode: (m: Visibility)=>{ setVisibilityMode(m); void patch({ visibilityMode: m }); },
            deadlineAt, setDeadlineAt: (t: number|null)=>{ setDeadlineAt(t); void patch({ deadlineAt: t }); },
            expectedText, setExpectedText: (raw: string)=>{
              setExpectedText(raw);
              const num = raw.replace(/\D/g, "");
              const safe = num===""?0:parseInt(num,10);
              setExpectedCount(safe);
              void patch({ expectedCount: safe });
            },
            manualClosed, closeNow, reopen,
            lockMode, setLockMode: (m: LockMode)=>{ setLockMode(m); void patch({ lockMode: m }); },
            resetAll,
            submissions,
            removeSubmission: async (key: string)=>{
              if (!confirm("이 제출을 삭제할까요?")) return;
              await runTransaction(ref(db, quizPath(pid)), (d: any)=>{
                if (!d) return d;
                const next = { ...(d.submissions||{}) };
                delete next[key];
                return { ...d, submissions: next, updatedAt: Date.now() };
              });
            },
            approveSubmission: async (key: string)=>{
              // placeholder: 여기선 승인여부 필드는 없지만, 확장 가능
              alert("승인 기능은 확장 포인트입니다. (필요 시 상태 필드를 추가하세요)");
            },
            studentLink, showLink, setShowLink, copyLink,
            saveHint,
          }}
        />
      ) : (
        <StudentView
          {...{
            desc, anonymous, isClosed,
            visibilityMode, deadlineAt, isVisible: isVisibleStudent,
            lockMode,
            pid,
          }}
        />
      )}

      <footer className="max-w-6xl mx-auto px-4 pb-10 text-xs text-gray-400">
        방 ID: <span className="font-mono">{pid}</span> · Made for classroom
      </footer>
    </div>
  );
}

/** ===== Admin View ===== */
function AdminView(props: any){
  const {
    desc, setDesc,
    anonymous, setAnonymous,
    visibilityMode, setVisibilityMode, deadlineAt, setDeadlineAt,
    expectedText, setExpectedText,
    manualClosed, closeNow, reopen,
    lockMode, setLockMode,
    resetAll,
    submissions, removeSubmission, approveSubmission,
    studentLink, showLink, setShowLink, copyLink,
    saveHint,
  } = props;

  const entries = Object.entries(submissions||{}).sort((a:any,b:any)=> (b[1].at - a[1].at));

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 grid lg:grid-cols-5 gap-6">
      {/* 왼쪽 설정 */}
      <section className="lg:col-span-2 space-y-6">
        <div className="bg-white rounded-2xl shadow p-4">
          <label className="text-sm text-gray-500">설명</label>
          <textarea
            value={desc}
            onChange={(e)=>setDesc(e.target.value)}
            onFocus={()=>{ if(desc===DEFAULT_DESC) setDesc(""); }}
            className="w-full mt-2 p-3 border rounded-xl outline-none focus:ring-2 focus:ring-sky-300"
            rows={3}
            placeholder={DEFAULT_DESC}
          />

          <div className="mt-4 grid grid-cols-1 gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-500">익명 제출</label>
                <input type="checkbox" className="scale-110" checked={anonymous} onChange={e=>setAnonymous(e.target.checked)} />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">결과 공개</span>
                <select value={visibilityMode} onChange={e=>setVisibilityMode(e.target.value)} className="border rounded-lg px-2 py-1">
                  <option value="always">항상 공개</option>
                  <option value="hidden">항상 숨김(학생만)</option>
                  <option value="deadline">마감 후 공개</option>
                </select>
                {visibilityMode==="deadline" && (
                  <input type="datetime-local" className="border rounded-lg px-2 py-1"
                    value={deadlineAt? new Date(deadlineAt).toISOString().slice(0,16):""}
                    onChange={e=> setDeadlineAt(e.target.value? new Date(e.target.value).getTime(): null)}
                  />
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">중복 방지</span>
              <select value={lockMode} onChange={e=>setLockMode(e.target.value)} className="border rounded-lg px-2 py-1">
                <option value="device">기기당 1회</option>
                <option value="name">실명당 1회</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">제출 인원</span>
                <input type="text" inputMode="numeric" pattern="[0-9]*" className="w-24 border rounded-lg px-2 py-1"
                  value={expectedText} onChange={e=>setExpectedText(e.target.value)} placeholder="예: 25" />
                <span className="text-xs text-gray-500">0=자동마감 없음</span>
              </div>
              <div className="flex items-center gap-2">
                {!manualClosed ? (
                  <button onClick={closeNow} className="px-2 py-1 text-xs rounded-md bg-rose-600 text-white hover:bg-rose-700 shadow">마감</button>
                ) : (
                  <button onClick={reopen} className="px-2 py-1 text-xs rounded-md bg-emerald-600 text-white hover:bg-emerald-700 shadow">재개</button>
                )}
              </div>
            </div>

            <div className="text-sm text-gray-500">{saveHint}</div>
          </div>
        </div>

        {/* 학생 링크 & QR */}
        <div className="bg-white rounded-2xl shadow p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">학생용 화면 링크</h2>
            <div className="flex items-center gap-2">
              <button onClick={()=>setShowLink((v:boolean)=>!v)} className="px-3 py-1.5 text-sm rounded-lg bg-white border hover:bg-gray-50">{showLink ? "숨기기" : "주소 보기"}</button>
              <a href="#student" className="px-3 py-1.5 text-sm rounded-lg bg-sky-600 text-white hover:bg-sky-700">바로 열기</a>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
            <div className="flex items-center justify-center p-3 bg-gray-50 rounded-xl border">
              <QRCode value={studentLink} size={160} />
            </div>
            <div className="text-sm text-gray-600 leading-relaxed">
              {!showLink ? (
                <p className="text-xs text-gray-500">주소는 숨김 상태입니다. <span className="font-medium">[주소 보기]</span>로 확인하거나 복사하세요.</p>
              ) : (
                <div className="space-y-2">
                  <input value={studentLink} readOnly className="w-full text-xs border rounded-lg px-2 py-1 break-all" onFocus={(e)=>e.currentTarget.select()} />
                  <div className="flex gap-2">
                    <button onClick={copyLink} className="px-2 py-1 text-xs rounded-md bg-white border hover:bg-gray-50">복사</button>
                    <button onClick={()=>setShowLink(false)} className="px-2 py-1 text-xs rounded-md bg-white border hover:bg-gray-50">숨기기</button>
                  </div>
                </div>
              )}
              <p className="mt-2 text-xs text-gray-500">같은 방(pid)으로 접속한 모든 기기의 제출이 실시간으로 모입니다.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 오른쪽: 제출 목록 */}
      <section className="lg:col-span-3 space-y-6">
        <div className="bg-white rounded-2xl shadow p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">제출 현황</h2>
            <div className="text-sm text-gray-500">총 {entries.length}건</div>
          </div>
          <div className="mt-3">
            {entries.length === 0 ? (
              <p className="text-sm text-gray-500">아직 제출이 없습니다.</p>
            ) : (
              <ul className="divide-y">
                {entries.map(([key, s]) => (
                  <li key={key} className="py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm text-gray-500">{new Date(s.at).toLocaleString()} · {s.name || s.by}</div>
                      <div className="font-medium mt-0.5 break-words">{s.text}</div>
                      {s.answer ? <div className="text-sm text-gray-600 mt-1">정답: {s.answer}</div> : null}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={()=>approveSubmission(key)} className="px-2 py-1 text-xs rounded-md bg-white border hover:bg-gray-50">승인</button>
                      <button onClick={()=>removeSubmission(key)} className="px-2 py-1 text-xs rounded-md bg-white border hover:bg-gray-50">삭제</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="bg-sky-50 rounded-2xl border border-sky-100 p-4">
          <h3 className="font-semibold">진행 팁</h3>
          <ul className="list-disc pl-5 text-sm mt-2 space-y-1">
            <li>결과 공개를 <b>항상 숨김</b>으로 두면 학생 화면에서 목록이 보이지 않습니다(관리자에선 보임).</li>
            <li>제출 인원을 설정하면 해당 인원 도달 시 자동 마감됩니다.</li>
            <li>중복 방지 정책: <b>{lockMode === "device" ? "기기당 1회" : "실명당 1회"}</b>.</li>
          </ul>
        </div>
      </section>
    </main>
  );
}

/** ===== Student View ===== */
function StudentView(props: any){
  const { desc, anonymous, isClosed, visibilityMode, deadlineAt, isVisible, lockMode, pid } = props;

  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [working, setWorking] = useState(false);

  const getKey = () => {
    if (lockMode === "name" && !anonymous) {
      const n = normalizeName(name||"");
      return n || "anonymous";
    }
    const uid = auth.currentUser?.uid;
    if (uid) return uid;
    const keyName = `quiz_submit_device_${pid||"temp"}`;
    let key = localStorage.getItem(keyName) || "";
    if (!key) { key = uuid(); localStorage.setItem(keyName, key); }
    return key;
  };

  const submit = async () => {
    if (isClosed) { alert("마감되어 제출할 수 없습니다."); return; }
    if ((!anonymous && !name.trim()) || !text.trim()) { alert("이름과 문제 내용을 확인하세요."); return; }
    try {
      setWorking(true);
      await ensureAuth();
      const key = getKey();
      const now = Date.now();

      const res = await runTransaction(ref(db, quizPath(pid)), (d: any)=>{
        if (!d) return d;
        const subs = d.submissions || {};
        if (subs[key]) return d; // 중복 차단
        subs[key] = {
          id: key, by: key,
          name: anonymous ? null : (name.trim() || null),
          text: text.trim(),
          answer: answer.trim() ? answer.trim() : null,
          at: now,
        };
        return { ...d, submissions: subs, updatedAt: now };
      });

      if ((res as any)?.committed) {
        setSubmitted(true);
        setName(""); setText(""); setAnswer("");
      } else {
        alert("이미 제출했습니다.");
      }
    } catch (e) {
      console.error(e);
      alert("제출 중 오류가 발생했습니다.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="text-sm text-gray-500">안내</div>
        <div className="mt-1 whitespace-pre-wrap">{desc}</div>
      </div>

      <div className="bg-white rounded-2xl shadow p-4">
        {isClosed && (
          <div className="mb-3 p-3 rounded-xl bg-rose-50 text-rose-700 text-sm border border-rose-100">
            마감되어 더 이상 제출할 수 없습니다.
          </div>
        )}

        {!anonymous && (
          <div className="mb-3">
            <label className="text-sm text-gray-500">이름/번호</label>
            <input className="mt-1 w-full border rounded-lg px-3 py-2" value={name} onChange={e=>setName(e.target.value)} placeholder="이름 또는 번호" disabled={isClosed||working} />
          </div>
        )}

        <div className="mb-3">
          <label className="text-sm text-gray-500">내가 만든 퀴즈 문제</label>
          <textarea className="mt-1 w-full border rounded-lg px-3 py-2" rows={4} value={text} onChange={e=>setText(e.target.value)} placeholder="예) 물은 섭씨 몇 도에서 끓을까요?" disabled={isClosed||working}></textarea>
        </div>

        <div className="mb-3">
          <label className="text-sm text-gray-500">정답(선택)</label>
          <input className="mt-1 w-full border rounded-lg px-3 py-2" value={answer} onChange={e=>setAnswer(e.target.value)} placeholder="예) 100도" disabled={isClosed||working} />
        </div>

        <div className="flex items-center justify-between">
          <a href="#admin" className="text-xs text-gray-400 underline">관리자 화면</a>
          <button onClick={submit} className="px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed" disabled={isClosed||working}>
            제출
          </button>
        </div>

        {submitted && <div className="mt-3 text-sm text-emerald-700">제출되었습니다. 감사합니다!</div>}
      </div>

      <Results visibilityMode={visibilityMode} deadlineAt={deadlineAt} isVisible={isVisible} submissions={submissionsFromPropsHack()} />
    </main>
  );

  // NOTE: 학생뷰에서도 최신 목록 프리뷰를 보여주고 싶으면 별도 구독을 둘 수 있지만,
  // 여기서는 관리자 공개 정책에 따르는 단순 표시 컴포넌트만 둡니다.
  function submissionsFromPropsHack(): Record<string, Submission> {
    // 학생 화면에서는 별도 목록을 실시간으로 받지 않으므로 빈 객체 리턴.
    // 결과 섹션은 공개 여부 메시지 용도로만 사용.
    return {};
  }
}

/** ===== Results (student-facing preview message only) ===== */
function Results({ visibilityMode, deadlineAt, isVisible, submissions } : {visibilityMode: Visibility, deadlineAt: number|null, isVisible: boolean, submissions: Record<string, Submission>}){
  return (
    <div className="bg-white rounded-2xl shadow p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">결과</h2>
      </div>
      <div className="mt-2">
        {isVisible ? (
          <div className="text-sm text-gray-500">관리자 화면에서 결과를 확인하세요.</div>
        ) : (
          <div className="text-gray-400">
            {visibilityMode === "deadline" && deadlineAt ? (
              <div className="text-center">
                <div>결과는 발표 전 비공개입니다.</div>
                <div className="text-xs mt-1">공개 예정: {new Date(deadlineAt).toLocaleString()}</div>
              </div>
            ) : (
              <div className="text-center">결과 비공개 상태입니다.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
