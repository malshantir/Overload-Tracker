import { useState, useEffect, useRef, useCallback } from "react";

const SK_P = "ot-prog-v5";
const SK_S = "ot-sess-v5";
const SK_U = "ot-user-v5";
const SK_L = "ot-launched-v5";
const SK_ACCOUNT = "ot-account-v1";
const SK_SESSION = "ot-session-v1";
const SK_SETTINGS = "ot-settings-v1";
const SK_DUP = "ot-dup-pref-v1"; // "by_day" | "combined"
const SK_ACTIVE = "ot-active-v1";  // { sessId, elapsedSecs, startedAt }
const SK_REST  = "ot-rest-v1";    // default rest duration in seconds
const SK_EXNOTES = "ot-exnotes-v1"; // { exId: "user's note" }
const SK_EXNAMES = "ot-exnames-v1"; // { exId: "Exercise Name" } - persisted across programs

// ─── HELPERS ───
function uid() { return Math.random().toString(36).slice(2, 9); }
function todayISO() { return new Date().toISOString().split("T")[0]; }
function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function fmtMonthYear(y, m) { return new Date(y, m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }); }
function clamp(v, mn, mx) { return Math.min(mx, Math.max(mn, v)); }
function e1rmCalc(w, r) {
  if (!w || !r || parseFloat(r) < 1) return 0;
  return +(parseFloat(w) * (1 + parseFloat(r) / 30)).toFixed(1);
}
function parseSecs(str) {
  if (!str) return null;
  str = str.trim();
  if (/^\d+$/.test(str)) return clamp(parseInt(str), 10, 600);
  const m = str.match(/^(\d+):(\d{1,2})$/);
  if (m) return clamp(parseInt(m[1]) * 60 + parseInt(m[2]), 10, 600);
  return null;
}
function secsToStr(s) {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
function normalizeName(n) {
  return (n || "").toLowerCase().trim().replace(/s$/, "");
}
function calcElapsed(info) {
  if (!info) return 0;
  const base = info.elapsedSecs || 0;
  if (!info.startedAt) return base;
  return Math.floor(base + (Date.now() - info.startedAt) / 1000);
}
function fmtSessDur(secs) {
  if (!secs || secs < 0) return "0:00";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function findDuplicateExNames(program) {
  if (!program?.sessions) return [];
  const counts = {};
  for (const sess of program.sessions) {
    for (const ex of sess.exercises) {
      const key = normalizeName(ex.name);
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return Object.keys(counts).filter(k => counts[k] > 1);
}
function validateName(n) {
  if (!n || !n.trim()) return "Name required.";
  if (n.trim().length > 30) return "Max 30 characters.";
  if (!/^[A-Za-z0-9 \-_/().]+$/.test(n.trim())) return "Letters, numbers, spaces and - _ / ( ) . only.";
  return null;
}
function calcStatus(spark) {
  if (!spark || spark.length < 2) return "Maintaining";
  const d = (spark[spark.length - 1] - spark[0]) / spark[0] * 100;
  return d >= 2 ? "Progressing" : d <= -2 ? "Regressing" : "Maintaining";
}
function statusColor(s) { return s === "Progressing" ? "var(--green)" : s === "Regressing" ? "var(--red)" : "var(--amber)"; }
function statusPillClass(s) { return s === "Progressing" ? "pg-p" : s === "Regressing" ? "pr-p" : "pm-p"; }
function toTitleCase(str) {
  if (!str) return str;
  return str.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
function normalizeExerciseNames(prog) {
  if (!prog?.sessions) return prog;
  return {
    ...prog,
    sessions: prog.sessions.map(s => ({
      ...s,
      exercises: s.exercises.map(ex => ({ ...ex, name: toTitleCase(ex.name) })),
    })),
  };
}

function saveExerciseNames(program) {
  if (!program?.sessions) return;
  try {
    const exNames = JSON.parse(localStorage.getItem(SK_EXNAMES) || "{}");
    const progName = program.name || "Unnamed Program";
    for (const sess of program.sessions) {
      for (const ex of sess.exercises) {
        exNames[ex.id] = { name: ex.name, program: progName };
      }
    }
    localStorage.setItem(SK_EXNAMES, JSON.stringify(exNames));
  } catch {}
}

function getExerciseName(exId) {
  try {
    const exNames = JSON.parse(localStorage.getItem(SK_EXNAMES) || "{}");
    const entry = exNames[exId];
    if (!entry) return null;
    // Handle both old string format (backwards compatibility) and new object format
    return typeof entry === "string" ? entry : (entry.name || null);
  } catch {
    return null;
  }
}

function getExerciseProgram(exId) {
  try {
    const exNames = JSON.parse(localStorage.getItem(SK_EXNAMES) || "{}");
    const entry = exNames[exId];
    if (!entry || typeof entry === "string") return null;  // No program info in old format
    return entry.program || null;
  } catch {
    return null;
  }
}

function isValidExerciseName(name) {
  if (!name || typeof name !== "string") return false;
  if (name === "Exercise 0") return false;
  if (name.match(/^Exercise\s+[a-z0-9]+$/i)) return false;  // Filter "Exercise abc123" patterns
  return name.trim().length > 0;
}

// Cleans up orphaned session data where sessId no longer exists in program
function cleanupOrphanedSessions(program, sessions) {
  if (!program?.sessions) return sessions;
  const validSessIds = new Set(program.sessions.map(s => s.id));
  const cleaned = { ...sessions };
  for (const key of Object.keys(cleaned)) {
    const sessId = key.split("__")[0];
    if (!validSessIds.has(sessId)) {
      delete cleaned[key];
    }
  }
  return cleaned;
}

// Standardized count of all completed sessions across all training days (used by Home, Calendar, Progress)
function countAllCompletedSessions(program, sessions) {
  if (!program?.sessions) return 0;
  let count = 0;
  for (const s of program.sessions) {
    count += getSessionDates(sessions, s.id).size;
  }
  return count;
}

// Standardized count of completed sessions in a week (used by Home, Calendar, Progress)
function countCompletedThisWeek(program, sessions, mondayISO) {
  if (!program?.sessions) return 0;
  let count = 0;
  for (const s of program.sessions) {
    const dates = getSessionDates(sessions, s.id);
    for (const d of dates) {
      if (d >= mondayISO) count++;
    }
  }
  return count;
}

// Standardized streak calculation (used by Home, Calendar, Progress)
function calculateStreak(program, sessions) {
  if (!program?.sessions) return 0;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const allDates = new Set();
  for (const s of program.sessions) {
    const dates = getSessionDates(sessions, s.id);
    dates.forEach(d => allDates.add(d));
  }
  let streak = 0;
  const checkDay = new Date(now);
  if (!allDates.has(checkDay.toISOString().split("T")[0])) {
    checkDay.setDate(checkDay.getDate() - 1);
  }
  while (allDates.has(checkDay.toISOString().split("T")[0])) {
    streak++;
    checkDay.setDate(checkDay.getDate() - 1);
  }
  return streak;
}

// Returns every YYYY-MM-DD date a session was ever trained:
// includes {sessId}__{date} log keys AND {sessId}__done__{date} markers.
// This is the single source of truth used by Calendar, Log, and Home pages.
function getSessionDates(sessions, sessId) {
  const dates = new Set();
  const prefix = `${sessId}__`;
  for (const [k, v] of Object.entries(sessions)) {
    if (!k.startsWith(prefix)) continue;
    const suffix = k.slice(prefix.length);
    if (/^\d{4}-\d{2}-\d{2}$/.test(suffix)) {
      dates.add(suffix);                    // {sessId}__{date} log key
    } else if (suffix.startsWith("done__") && v === "1") {
      dates.add(suffix.slice(6));           // {sessId}__done__{date} completion marker
    }
  }
  return dates;
}
function getLastSessionDate(sessions, sessId) {
  const dates = getSessionDates(sessions, sessId);
  if (!dates.size) return null;
  return [...dates].sort().pop();
}

// ─── PRESCRIPTION LOGIC ───
function calcPrescription(ex, lastSets) {
  if (!ex || !lastSets) return null;
  const sets = Object.values(lastSets);
  if (!sets.length) return null;
  const reps = sets.map(s => parseInt(s.reps)).filter(r => !isNaN(r) && r > 0);
  if (!reps.length) return null;
  const topRep = ex.rep_max;
  if (reps.some(r => r >= topRep)) {
    return { tip: "Great work! Try adding weight this session.", variant: "green" };
  }
  return { tip: "Same weight — aim for more reps.", variant: "blue" };
}

// ─── CSS ───
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&family=Bebas+Neue&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#080808;--bg2:#0d0d0d;--bg3:#111;--bg4:#161616;--bg5:#1e1e1e;
  --c1:#e8e8e8;--c2:#aaa;--c3:#666;--c4:#3a3a3a;--c5:#252525;
  --green:#4ade80;--red:#f87171;--amber:#fbbf24;--blue:#60a5fa;--gold:#f59e0b;
  --bdr:#1e1e1e;--r:8px;--rsm:5px;
}
html,body,#root{width:100%;height:100%;overflow:hidden;background:var(--bg);color:var(--c1);font-family:'DM Mono',monospace}
input,select,textarea{font-size:16px !important}
input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none}
input[type=number]{-moz-appearance:textfield}
::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--c5);border-radius:2px}
.app{display:flex;flex-direction:column;width:100%;height:100vh;max-width:100%}@media(min-width:600px){.app{max-width:100%;margin:0}}
.nav{display:flex;border-top:1px solid #1e1e1e;background:#080808;flex-shrink:0;order:2;padding-bottom:env(safe-area-inset-bottom)}
.nb{flex:1;background:none;border:none;border-top:2px solid transparent;color:#aaaaaa;font-family:'DM Mono',monospace;font-size:7px;letter-spacing:.1em;padding:9px 2px 7px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;transition:all .2s;margin-top:-1px}
.nb.act{color:#ffffff;border-top-color:#ffffff}
.nb.act svg{transform:scale(1.1)}
.nb:hover:not(.act){color:#666666}
.pages{flex:1;overflow:hidden;position:relative;order:1}
.pg{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;opacity:0;pointer-events:none;transition:opacity .18s}
.pg.act{opacity:1;pointer-events:all}
.hdr{padding:18px 20px 0 52px;border-bottom:1px solid var(--bdr);position:sticky;top:0;background:rgba(8,8,8,.97);z-index:10}
.ham-btn{position:fixed;top:14px;left:14px;z-index:20;background:none;border:none;cursor:pointer;color:var(--c3);padding:6px;display:flex;align-items:center;justify-content:center;border-radius:var(--rsm);transition:color .15s;min-width:36px;min-height:36px}
.ham-btn:hover{color:var(--c1)}
.menu-ov{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:80;opacity:0;pointer-events:none;transition:opacity .25s}
.menu-ov.open{opacity:1;pointer-events:all}
.menu-panel{position:fixed;top:0;left:0;bottom:0;width:260px;background:var(--bg2);border-right:1px solid var(--bdr);z-index:81;transform:translateX(-100%);transition:transform .28s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;overflow:hidden}
.menu-panel.open{transform:translateX(0)}
.menu-brand{padding:52px 24px 20px;border-bottom:1px solid var(--bdr)}
.menu-brand-name{font-family:'Bebas Neue';font-size:22px;letter-spacing:.12em;color:#fff;line-height:1}
.menu-brand-sub{font-size:7px;color:var(--c4);letter-spacing:.25em;margin-top:4px}
.menu-items{flex:1;padding:8px 0;overflow-y:auto}
.menu-item{display:flex;align-items:center;gap:14px;padding:14px 24px;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.12em;color:var(--c2);cursor:pointer;border:none;background:none;width:100%;text-align:left;transition:color .15s,background .15s}
.menu-item:hover{color:var(--c1);background:rgba(255,255,255,.04)}
.menu-item svg{flex-shrink:0;opacity:.6}
.menu-item:hover svg{opacity:1}
.menu-footer{border-top:1px solid var(--bdr);padding:8px 0}
.menu-item.danger{color:var(--red)}
.menu-item.danger:hover{color:var(--red);background:rgba(248,113,113,.06)}
.menu-item.danger svg{opacity:.7}
.profile-screen{position:fixed;inset:0;background:var(--bg);z-index:82;display:flex;flex-direction:column;overflow:hidden}
.profile-top{padding:16px 20px 14px;border-bottom:1px solid var(--bdr);flex-shrink:0}
.profile-title{font-family:'Bebas Neue';font-size:30px;letter-spacing:.1em;color:#fff;margin-top:10px;line-height:1}
.profile-body{flex:1;overflow-y:auto;padding:16px 20px 60px}
.acc-card{background:var(--bg2);border:1px solid var(--bdr);border-radius:var(--r);margin-bottom:10px;overflow:hidden}
.acc-header{width:100%;background:none;border:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:16px 18px;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.14em;color:var(--c1);transition:background .15s;text-align:left}
.acc-header:hover{background:rgba(255,255,255,.04)}
.acc-chevron{transition:transform .22s;display:flex;color:var(--c4)}
.acc-chevron.open{transform:rotate(90deg)}
.acc-body{padding:4px 18px 16px;border-top:1px solid var(--bdr)}
.acc-row{display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.acc-row:last-child{border-bottom:none}
.acc-key{font-size:8px;color:var(--c4);letter-spacing:.16em}
.acc-val{font-size:11px;color:var(--c1)}
.acc-row-inner{flex:1;display:flex;justify-content:space-between;align-items:center}
.acc-edit-btn{background:none;border:none;cursor:pointer;color:var(--c5);padding:4px 2px;display:flex;align-items:center;transition:color .15s;flex-shrink:0;border-radius:3px}
.acc-edit-btn:hover{color:var(--c2)}
.acc-edit-wrap{padding:12px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.acc-edit-wrap:last-child{border-bottom:none}
.acc-edit-actions{display:flex;gap:6px;margin-top:10px;justify-content:flex-end}
.unit-toggle{display:flex;background:var(--bg3);border:1px solid var(--bdr);border-radius:var(--rsm);overflow:hidden;flex-shrink:0}
.unit-btn{background:none;border:none;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.08em;padding:0 13px;cursor:pointer;color:var(--c4);min-height:44px;transition:all .15s}
.unit-btn.act{background:var(--c1);color:var(--bg)}
.setup-header{padding:36px 20px 0;flex-shrink:0}
.setup-title{font-family:'Bebas Neue';font-size:32px;letter-spacing:.08em;color:#fff;line-height:1;margin-bottom:6px}
.setup-sub{font-size:10px;color:var(--c3);letter-spacing:.1em;margin-bottom:4px}
.setting-option{flex:1;background:none;border:1px solid var(--bdr);border-radius:var(--rsm);padding:13px 8px;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.1em;color:var(--c3);cursor:pointer;transition:all .18s;min-height:44px;text-align:center}
.setting-option:hover{border-color:var(--c3);color:var(--c2)}
.setting-option.sel{border-color:var(--c1);color:var(--c1);background:var(--bg3)}
.setting-hint{font-size:9px;color:var(--c4);margin-top:10px;letter-spacing:.06em;line-height:1.5}
.support-row{width:100%;background:var(--bg2);border:1px solid var(--bdr);border-radius:var(--r);padding:16px 18px;display:flex;justify-content:space-between;align-items:center;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.12em;color:var(--c1);cursor:pointer;transition:background .15s;margin-bottom:8px;text-align:left}
.support-row:hover{background:var(--bg3)}
.support-coming{text-align:center;padding:60px 20px;font-size:11px;color:var(--c4);letter-spacing:.1em}
.wm{font-family:'Bebas Neue';font-size:26px;letter-spacing:.08em;color:#fff;line-height:1}
.wm-sub{font-size:8px;color:var(--c4);letter-spacing:.2em;margin-top:1px}
.tabs-row{display:flex;overflow-x:auto;scrollbar-width:none;margin-top:12px;margin-bottom:-1px}
.tabs-row::-webkit-scrollbar{display:none}
.tb{background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.1em;padding:7px 13px;color:var(--c4);white-space:nowrap;transition:all .18s}
.tb.act{color:var(--c1);border-bottom-color:var(--c1)}
.tb:hover:not(.act){color:var(--c2)}
.card{background:var(--bg2);border-radius:var(--r);padding:16px;margin-bottom:8px;border:1px solid var(--bdr)}
.ex-card{background:var(--bg2);border-radius:var(--r);margin-bottom:10px;overflow:hidden;border:1px solid var(--bdr);transition:border-color .25s}
.ex-card.dragging{opacity:.45;border-style:dashed}
.ex-drag-handle{color:var(--c4);cursor:grab;padding:0 8px 0 0;display:flex;align-items:center;flex-shrink:0;touch-action:none}
.ex-drag-handle:hover{color:var(--c2)}
.ex-card.pr-glow{border-color:var(--gold)}
.ex-header{padding:14px 16px 10px;display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.ex-name{font-size:14px;color:var(--c1);font-weight:500;letter-spacing:.02em;line-height:1.3;margin-bottom:3px}
.ex-meta{font-size:10px;color:var(--c4);letter-spacing:.06em}
.ex-note{font-size:10px;color:var(--c3);font-style:italic;margin-top:2px}
.rx-bar{padding:8px 16px;background:rgba(96,165,250,.07);border-top:1px solid rgba(96,165,250,.12);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rx-lbl{font-size:9px;color:var(--blue);letter-spacing:.1em;flex-shrink:0}
.rx-val{font-size:10px;color:var(--c2);line-height:1.4}
.set-table{padding:0 16px 4px}
.col-lbl-row{display:grid;grid-template-columns:24px 1fr 1fr 80px 28px;gap:6px;margin-bottom:7px;padding:0 2px}
.col-lbl{font-size:8px;color:var(--c5);letter-spacing:.1em;text-align:center}
.set-row-grid{display:grid;grid-template-columns:24px 1fr 1fr 80px 28px;gap:6px;align-items:center;margin-bottom:8px;padding:2px}
.set-row-grid.pr-row{background:rgba(245,158,11,.06);border-radius:4px}
.set-num{font-size:11px;color:var(--c4);text-align:center}
.si{background:var(--bg3);border:1px solid var(--bdr);color:var(--c1);font-family:'DM Mono',monospace;font-size:16px;padding:10px 4px;text-align:center;border-radius:var(--rsm);outline:none;width:100%;transition:border-color .15s;min-height:44px}
.si:focus{border-color:var(--c3);background:var(--bg4)}
.si::placeholder{color:var(--c5);font-size:16px}
.last-cell{display:flex;flex-direction:column;align-items:flex-end;justify-content:center;gap:2px}
.last-val{font-size:10px;color:var(--c4);white-space:nowrap}
.arr-up{color:var(--green);font-size:9px}
.arr-dn{color:var(--red);font-size:9px}
.pr-badge{font-size:8px;color:var(--gold);letter-spacing:.06em;background:rgba(245,158,11,.14);padding:2px 6px;border-radius:3px}
.rir-row{padding:5px 16px 10px;display:flex;gap:5px;align-items:center;flex-wrap:wrap}
.rir-lbl{font-size:8px;color:var(--c4);letter-spacing:.1em;margin-right:2px;flex-shrink:0}
.rchip{background:var(--bg3);border:1px solid var(--bdr);border-radius:4px;padding:5px 9px;font-size:10px;color:var(--c4);cursor:pointer;font-family:'DM Mono',monospace;transition:all .15s;min-height:32px;min-width:34px;text-align:center}
.rchip:hover{border-color:var(--c3);color:var(--c2)}
.rchip.sel{border-color:var(--green);color:var(--green);background:rgba(74,222,128,.07)}
.rchip.skip.sel{border-color:var(--c3);color:var(--c3)}
.set-footer{padding:8px 16px 14px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--bdr)}
.ex-timer-chip{background:var(--bg3);border:1px solid var(--bdr);border-radius:20px;padding:5px 11px;font-size:9px;color:var(--c3);cursor:pointer;font-family:'DM Mono',monospace;letter-spacing:.08em;display:inline-flex;align-items:center;gap:5px;transition:all .15s;min-height:32px}
.ex-timer-chip:hover{border-color:var(--c3);color:var(--c1)}
.ex-timer-chip.running{border-color:var(--green);color:var(--green);background:rgba(74,222,128,.08)}
.ex-timer-bar{padding:7px 16px;background:rgba(74,222,128,.07);border-top:1px solid rgba(74,222,128,.14);display:flex;align-items:center;gap:10px}
.ex-timer-countdown{font-family:'Bebas Neue';font-size:18px;letter-spacing:.06em;color:var(--green);min-width:42px}
.ex-timer-track{flex:1;background:rgba(74,222,128,.12);border-radius:3px;height:4px}
.ex-timer-fill{height:100%;border-radius:3px;background:var(--green);transition:width 1s linear}
.ti{background:var(--bg3);border:1px solid var(--bdr);color:var(--c1);font-family:'DM Mono',monospace;font-size:16px;padding:10px 12px;border-radius:var(--rsm);outline:none;width:100%;transition:border-color .15s;min-height:44px}
.ti:focus{border-color:var(--c3)}
.ti::placeholder{color:var(--c4);font-size:16px}
.seli{background:var(--bg3);border:1px solid var(--bdr);color:var(--c1);font-family:'DM Mono',monospace;font-size:16px;padding:10px 12px;border-radius:var(--rsm);outline:none;width:100%;cursor:pointer;min-height:44px}
.bp{background:var(--c1);color:var(--bg);border:none;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.12em;font-weight:500;padding:12px 20px;cursor:pointer;border-radius:var(--rsm);transition:opacity .15s;white-space:nowrap;min-height:44px}
.bp:hover{opacity:.88}
.bp.ok{background:var(--green);color:#000}
.bp.amber-btn{background:var(--amber);color:#000}
.bg-btn{background:none;border:none;cursor:pointer;color:var(--c4);font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.08em;padding:4px 0;transition:color .15s;white-space:nowrap}
.bg-btn:hover{color:var(--c2)}
.bo{background:none;border:1px solid var(--bdr);color:var(--c3);font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.08em;padding:8px 14px;cursor:pointer;border-radius:var(--rsm);transition:all .15s;min-height:44px}
.bo:hover,.bo.sel{border-color:var(--c2);color:var(--c1)}
.ib{background:none;border:none;cursor:pointer;color:var(--c3);padding:6px;border-radius:var(--rsm);display:flex;align-items:center;justify-content:center;transition:color .15s;min-height:36px;min-width:36px;flex-shrink:0}
.ib:hover{color:var(--c1)}
.pill{display:inline-block;font-size:8px;letter-spacing:.1em;padding:3px 9px;border-radius:20px;font-weight:500}
.pg-p{background:rgba(74,222,128,.12);color:var(--green)}
.pr-p{background:rgba(248,113,113,.12);color:var(--red)}
.pm-p{background:rgba(251,191,36,.12);color:var(--amber)}
.bt{background:var(--bg5);border-radius:3px;height:5px;flex:1}
.bf{height:100%;border-radius:3px;transition:width .5s ease}
.kg{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}
.kpi{background:var(--bg2);border-radius:var(--r);padding:14px 16px;border:1px solid var(--bdr)}
.kv{font-size:22px;font-family:'Bebas Neue';letter-spacing:.06em;line-height:1}
.kl{font-size:8px;color:var(--c4);letter-spacing:.14em;margin-top:4px}
.fld{margin-bottom:16px}
.lbl{font-size:9px;color:var(--c3);letter-spacing:.14em;margin-bottom:6px;display:block}
.err{font-size:9px;color:var(--red);margin-top:5px;letter-spacing:.06em}
.helper{font-size:9px;color:var(--c4);margin-top:4px}
.drw-ov{position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:50;opacity:0;pointer-events:none;transition:opacity .25s}
.drw-ov.open{opacity:1;pointer-events:all}
.drw{position:fixed;bottom:0;left:50%;transform:translateX(-50%) translateY(100%);width:100%;max-width:100%;background:var(--bg2);border-top:1px solid var(--bdr);border-radius:16px 16px 0 0;padding:20px 22px 40px;z-index:51;transition:transform .28s cubic-bezier(.4,0,.2,1);max-height:92vh;overflow-y:auto}
.drw.open{transform:translateX(-50%) translateY(0)}
.drw-h{width:36px;height:3px;background:var(--c5);border-radius:2px;margin:0 auto 18px}
.drw-title{font-family:'Bebas Neue';font-size:20px;letter-spacing:.06em;color:#fff;margin-bottom:4px}
.drw-sub{font-size:9px;color:var(--c3);letter-spacing:.12em;margin-bottom:18px}
.modal-ov{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:60;display:flex;align-items:flex-end;justify-content:center}
.modal{background:var(--bg2);border-radius:16px 16px 0 0;padding:24px 22px 44px;width:100%;max-width:100%;max-height:90vh;overflow-y:auto;border-top:1px solid var(--bdr)}
.toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(8px);background:rgba(28,28,28,.97);border:1px solid var(--bdr);color:var(--c1);font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.12em;padding:9px 18px;border-radius:24px;opacity:0;transition:all .25s;pointer-events:none;white-space:nowrap;z-index:200}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.toast.tg{background:rgba(74,222,128,.14);border-color:var(--green);color:var(--green)}
.toast.tgold{background:rgba(245,158,11,.14);border-color:var(--gold);color:var(--gold)}
.date-pill{background:var(--bg3);border:1px solid var(--bdr);border-radius:20px;padding:6px 13px;font-size:9px;color:var(--c3);cursor:pointer;font-family:'DM Mono',monospace;letter-spacing:.1em;display:inline-flex;align-items:center;gap:6px;transition:all .15s;min-height:32px}
.date-pill:hover{border-color:var(--c3);color:var(--c1)}
.r-chip{flex:1;background:var(--bg3);border:1px solid var(--bdr);border-radius:var(--rsm);padding:12px 6px;text-align:center;cursor:pointer;transition:all .18s;min-height:64px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px}
.r-chip p{font-size:8px;color:var(--c4);letter-spacing:.06em}
.r-chip.rl{border-color:var(--red);background:rgba(248,113,113,.06)}
.r-chip.rm{border-color:var(--amber);background:rgba(251,191,36,.06)}
.r-chip.rh{border-color:var(--green);background:rgba(74,222,128,.06)}
.inline-edit{background:transparent;border:none;border-bottom:1px solid var(--c3);color:#fff;font-family:'Bebas Neue';font-size:17px;letter-spacing:.06em;outline:none;padding:2px 0;width:100%}
.ob{padding:22px 20px 100px}
.ob-step{font-size:8px;color:var(--c4);letter-spacing:.18em;margin-bottom:18px}
.ob-title{font-family:'Bebas Neue';font-size:26px;letter-spacing:.06em;color:#fff;margin-bottom:6px}
.ob-sub{font-size:11px;color:var(--c3);margin-bottom:22px;line-height:1.75}
.day-pick-btn{width:48px;height:48px;background:var(--bg2);border:1px solid var(--bdr);border-radius:var(--r);font-family:'DM Mono',monospace;font-size:18px;color:var(--c3);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .18s}
.day-pick-btn:hover{border-color:var(--c2);color:var(--c1)}
.day-pick-btn.sel{border-color:var(--c1);color:var(--c1);background:var(--bg3)}
.gc{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:18px}
.gcard{background:var(--bg2);border:1px solid var(--bdr);border-radius:var(--r);padding:16px 14px;cursor:pointer;transition:border-color .18s}
.gcard.sel{border-color:var(--c1)}
.gcard h3{font-size:10px;color:var(--c1);letter-spacing:.08em;margin-bottom:4px}
.gcard p{font-size:10px;color:var(--c4);line-height:1.5}
.dc{width:44px;height:44px;border-radius:50%;background:var(--bg2);border:1px solid var(--bdr);display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--c3);cursor:pointer;transition:all .18s;flex-shrink:0}
.dc.sel{background:var(--c1);color:var(--bg);border-color:var(--c1)}
.tmpl{background:var(--bg2);border:1px solid var(--bdr);border-radius:var(--r);padding:13px 15px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:border-color .18s;margin-bottom:6px}
.tmpl.sel{border-color:var(--c1)}
.tn{font-size:11px;color:var(--c1);letter-spacing:.04em}
.td{font-size:9px;color:var(--c4);margin-top:3px}
.sess-hdr{display:flex;justify-content:space-between;align-items:center;padding:14px 0 8px}
.ex-row-edit{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--bdr)}
.lock-badge{background:rgba(74,222,128,.1);color:var(--green);font-size:8px;letter-spacing:.1em;padding:3px 9px;border-radius:3px;display:inline-flex;align-items:center;gap:4px}
.draft-badge{background:rgba(251,191,36,.1);color:var(--amber);font-size:8px;letter-spacing:.1em;padding:3px 9px;border-radius:3px}
.prog-row{display:flex;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--bdr);cursor:pointer;transition:opacity .15s}
.prog-row:hover{opacity:.8}
.prog-name{font-size:13px;color:var(--c2);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
.cal-day{min-height:52px;display:flex;flex-direction:column;align-items:center;padding:5px 3px;border-radius:var(--rsm);cursor:pointer;transition:background .15s}
.cal-day:hover{background:var(--bg3)}
.day-num{font-size:11px;color:var(--c4);margin-bottom:4px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:50%}
.cal-day.today .day-num{background:var(--c1);color:var(--bg);font-weight:500}
.cal-dot{width:6px;height:6px;border-radius:50%;margin:1px 0}
.cal-label{font-size:7px;color:var(--green);letter-spacing:.03em;text-align:center;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3}
.intro-card{background:var(--bg2);border:1px solid var(--bdr);border-radius:var(--r);padding:18px;margin-bottom:10px}
.intro-card h3{font-size:11px;color:var(--c1);letter-spacing:.08em;margin-bottom:6px}
.intro-card p{font-size:11px;color:var(--c3);line-height:1.7}
.reorder-item{background:var(--bg2);border-radius:var(--r);padding:13px 15px;margin-bottom:5px;display:flex;align-items:center;gap:12px;cursor:grab;border:1px solid var(--bdr)}
.reorder-item:active{cursor:grabbing;background:var(--bg3)}
.merge-banner{background:rgba(96,165,250,.08);border:1px solid rgba(96,165,250,.2);border-radius:var(--rsm);padding:10px 14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}
.splash{position:fixed;inset:0;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:1000;opacity:1;transition:opacity .5s ease;pointer-events:all}
.splash.fade{opacity:0;pointer-events:none}
.splash-title{font-family:'Bebas Neue';font-size:52px;letter-spacing:.18em;color:#fff;line-height:1}
.splash-sub{font-size:8px;color:#444;letter-spacing:.35em;margin-top:10px}
.auth-screen{position:fixed;inset:0;background:var(--bg);display:flex;flex-direction:column;z-index:500;overflow:hidden}
.welcome-top{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 28px 0}
.welcome-logo{font-family:'Bebas Neue';font-size:56px;letter-spacing:.15em;color:#fff;line-height:1;text-align:center}
.welcome-logo span{color:var(--blue)}
.welcome-tagline{font-size:8px;color:var(--c4);letter-spacing:.32em;margin-top:14px}
.welcome-btns{padding:40px 28px 64px;display:flex;flex-direction:column;gap:12px;width:100%;box-sizing:border-box}
.btn-signup{background:var(--blue);color:#fff;border:none;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.15em;padding:15px 20px;cursor:pointer;border-radius:var(--rsm);width:100%;min-height:50px;transition:opacity .15s}
.btn-signup:hover{opacity:.85}
.btn-login-out{background:none;border:1px solid var(--c3);color:var(--c1);font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.15em;padding:15px 20px;cursor:pointer;border-radius:var(--rsm);width:100%;min-height:50px;transition:border-color .15s}
.btn-login-out:hover{border-color:var(--c1)}
.auth-top{padding:20px 20px 0;flex-shrink:0}
.auth-body{padding:28px 20px 40px;flex:1;overflow-y:auto}
.auth-title{font-family:'Bebas Neue';font-size:36px;letter-spacing:.1em;color:#fff;margin-top:10px;margin-bottom:4px}
.day-card{background:var(--bg2);border:1px solid var(--bdr);border-radius:var(--r);padding:16px 18px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;margin-bottom:8px;transition:background .15s}
.day-card:hover{background:var(--bg3)}
.day-card-name{font-size:14px;color:var(--c1);letter-spacing:.04em}
.day-card-count{font-size:9px;color:var(--c4);letter-spacing:.1em;margin-top:3px;text-align:left}
.back-btn{background:none;border:none;cursor:pointer;color:var(--c3);font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.12em;padding:6px 0;display:inline-flex;align-items:center;gap:4px;transition:color .15s;min-height:36px;flex-shrink:0}
.back-btn:hover{color:var(--c1)}
.inprog-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);flex-shrink:0;animation:pulse-dot 1.8s ease-in-out infinite}
@keyframes pulse-dot{0%,100%{opacity:1}50%{opacity:.35}}
.inprog-badge{font-size:8px;color:var(--green);letter-spacing:.12em;margin-top:4px}
.resume-banner{display:flex;justify-content:space-between;align-items:center;background:rgba(74,222,128,.07);border:1px solid rgba(74,222,128,.25);border-radius:var(--r);padding:14px 16px;margin-bottom:16px;cursor:pointer;transition:background .15s}
.resume-banner:hover{background:rgba(74,222,128,.12)}
.sess-timer-chip{display:inline-flex;align-items:center;gap:6px;background:var(--bg2);border:1px solid var(--bdr);border-radius:20px;padding:5px 12px;font-family:'DM Mono',monospace;font-size:10px;color:var(--c1);letter-spacing:.06em;min-width:60px}
.sess-timer-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse-dot 1.8s ease-in-out infinite;flex-shrink:0}
.complete-screen{position:fixed;inset:0;background:var(--bg);z-index:90;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 24px;text-align:center}
.cs-emoji{font-size:72px;line-height:1;margin-bottom:20px}
.cs-title{font-family:'Bebas Neue';font-size:52px;letter-spacing:.06em;color:var(--c1);margin-bottom:8px;line-height:1}
.cs-msg{font-size:10px;color:var(--c3);letter-spacing:.14em;margin-bottom:40px}
.cs-stats{display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%;max-width:340px;margin-bottom:16px}
.cs-stat{background:var(--bg2);border:1px solid var(--bdr);border-radius:var(--r);padding:18px 16px}
.cs-stat.full{grid-column:1/-1}
.cs-stat.gold{border-color:rgba(251,191,36,.4);background:rgba(251,191,36,.07)}
.cs-sv{font-family:'Bebas Neue';font-size:32px;letter-spacing:.06em;color:var(--c1);line-height:1}
.cs-sv.gold-text{color:var(--amber)}
.cs-sl{font-size:8px;color:var(--c4);letter-spacing:.14em;margin-top:4px}
`;


// ─── ICONS ───
function Ico({ size = 16, children }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}>
      {children}
    </svg>
  );
}
const Icons = {
  Bolt: ({ size = 17 }) => <Ico size={size}><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></Ico>,
  Layers: ({ size = 17 }) => <Ico size={size}><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></Ico>,
  Clipboard: ({ size = 17 }) => <Ico size={size}><rect x="5" y="2" width="14" height="20" rx="2" /><line x1="9" y1="7" x2="15" y2="7" /><line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="17" x2="13" y2="17" /></Ico>,
  TrendUp: ({ size = 17 }) => <Ico size={size}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></Ico>,
  Calendar: ({ size = 17 }) => <Ico size={size}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></Ico>,
  Timer: ({ size = 14 }) => <Ico size={size}><circle cx="12" cy="13" r="8" /><polyline points="12 9 12 13 14 15" /><line x1="9" y1="2" x2="15" y2="2" /></Ico>,
  Plus: ({ size = 15 }) => <Ico size={size}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Ico>,
  Minus: ({ size = 15 }) => <Ico size={size}><line x1="5" y1="12" x2="19" y2="12" /></Ico>,
  Edit: ({ size = 15 }) => <Ico size={size}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></Ico>,
  Info: ({ size = 15 }) => <Ico size={size}><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></Ico>,
  ChevLeft: ({ size = 16 }) => <Ico size={size}><polyline points="15 18 9 12 15 6" /></Ico>,
  ChevRight: ({ size = 16 }) => <Ico size={size}><polyline points="9 18 15 12 9 6" /></Ico>,
  Search: ({ size = 15 }) => <Ico size={size}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></Ico>,
  Drag: ({ size = 14 }) => <Ico size={size}><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></Ico>,
  Ham: ({ size = 18 }) => <Ico size={size}><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></Ico>,
  User: ({ size = 15 }) => <Ico size={size}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></Ico>,
  Settings: ({ size = 15 }) => <Ico size={size}><circle cx="12" cy="12" r="3" /><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42m12.72-12.72 1.42-1.42" /></Ico>,
  Lock: ({ size = 15 }) => <Ico size={size}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></Ico>,
  HelpCircle: ({ size = 15 }) => <Ico size={size}><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></Ico>,
  LogOut: ({ size = 15 }) => <Ico size={size}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></Ico>,
  Check: ({ size = 14 }) => <Ico size={size}><polyline points="20 6 9 17 4 12" /></Ico>,
  X: ({ size = 14 }) => <Ico size={size}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Ico>,
  Home: ({ size = 17 }) => <Ico size={size}><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></Ico>,
};

// ─── SPARKLINE ───
function Sparkline({ data, color = "#4ade80", w = 90, h = 36, dots = false }) {
  if (!data || data.length < 2) return <svg width={w} height={h} />;
  const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1;
  const pts = data.map((v, i) => ({
    x: +(i * (w - 6) / (data.length - 1) + 3).toFixed(1),
    y: +((1 - (v - mn) / rng) * (h - 6) + 3).toFixed(1),
  }));
  const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {dots && pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={color} opacity=".7" />)}
    </svg>
  );
}

// ─── PER-EXERCISE TIMER HOOK ───
function useExTimer() {
  const [timers, setTimers] = useState({});
  const refs = useRef({});

  function startTimer(exId, secs) {
    if (refs.current[exId]) clearInterval(refs.current[exId]);
    setTimers(p => ({ ...p, [exId]: { running: true, secs, total: secs } }));
    refs.current[exId] = setInterval(() => {
      setTimers(p => {
        const t = p[exId];
        if (!t || t.secs <= 1) {
          clearInterval(refs.current[exId]);
          return { ...p, [exId]: { ...t, running: false, secs: 0 } };
        }
        return { ...p, [exId]: { ...t, secs: t.secs - 1 } };
      });
    }, 1000);
  }

  function resetTimer(exId) {
    if (refs.current[exId]) clearInterval(refs.current[exId]);
    setTimers(p => {
      const t = p[exId];
      if (!t) return p;
      return { ...p, [exId]: { ...t, running: false, secs: t.total } };
    });
  }

  function stopTimer(exId) {
    if (refs.current[exId]) clearInterval(refs.current[exId]);
    setTimers(p => ({ ...p, [exId]: { ...(p[exId] || {}), running: false } }));
  }

  useEffect(() => {
    return () => { Object.values(refs.current).forEach(clearInterval); };
  }, []);

  return { timers, startTimer, resetTimer, stopTimer };
}

// ─── DRAWER ───
function Drawer({ open, onClose, children }) {
  return (
    <>
      <div className={`drw-ov${open ? " open" : ""}`} onClick={onClose} />
      <div className={`drw${open ? " open" : ""}`}>
        <div className="drw-h" />
        {children}
        <button className="bg-btn" style={{ marginTop: 16 }} onClick={onClose}>CLOSE ×</button>
      </div>
    </>
  );
}

// ─── TOAST ───
function Toast({ msg, show, variant }) {
  return <div className={`toast${variant ? " " + variant : ""}${show ? " show" : ""}`}>{msg}</div>;
}

// ─── INLINE NAME EDITOR ───
function InlineName({ value, onSave, siblings = [] }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [err, setErr] = useState("");
  const ref = useRef(null);
  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);
  function commit() {
    const e = validateName(draft);
    if (e) { setErr(e); return; }
    const t = draft.trim();
    if (siblings.includes(t)) { setErr("Name already used."); return; }
    onSave(t); setEditing(false); setErr("");
  }
  function cancel() { setDraft(value); setEditing(false); setErr(""); }
  if (editing) return (
    <div style={{ flex: 1 }}>
      <input ref={ref} className="inline-edit" value={draft} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
        onBlur={commit} maxLength={30} />
      {err && <div className="err">{err}</div>}
    </div>
  );
  return (
    <span style={{ fontFamily: "'Bebas Neue'", fontSize: 17, letterSpacing: ".06em", color: "#fff", cursor: "pointer" }}
      onClick={() => { setDraft(value); setEditing(true); }} title="Tap to rename">
      {value}
    </span>
  );
}

// ══════════════════════════════════════════════
// INTRO PAGE
// ══════════════════════════════════════════════
function IntroPage({ onStart }) {
  return (
    <div>
      <div style={{ padding: "44px 24px 32px", borderBottom: "1px solid var(--bdr)" }}>
        <div style={{ fontFamily: "'Bebas Neue'", fontSize: 46, letterSpacing: ".06em", color: "#fff", lineHeight: .88, marginBottom: 14 }}>OVERLOAD<br />TRACKER</div>
        <p style={{ fontSize: 15, color: "var(--c2)", lineHeight: 1.65, maxWidth: 280 }}>Plan smart. Progress faster. Log what matters.</p>
      </div>
      <div style={{ padding: "24px 20px 0", display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          { t: "BUILD YOUR SPLIT", b: "Customize days, exercises, and notes." },
          { t: "TRACK PROGRESSION", b: "See clear trends for each lift." },
          { t: "SAFE, TRANSPARENT RULES", b: "Understand every change and deload." },
        ].map(c => (
          <div key={c.t} className="intro-card"><h3>{c.t}</h3><p>{c.b}</p></div>
        ))}
      </div>
      <div style={{ padding: "28px 20px 60px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 14 }}>
        <button className="bp" style={{ fontSize: 11, padding: "13px 28px" }} onClick={onStart}>START YOUR PLAN →</button>
        <button className="bg-btn" style={{ fontSize: 10, color: "var(--c3)" }}>Preview a sample week</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// HOME PAGE
// ══════════════════════════════════════════════
function HomePage({ program, sessions, onStartSession }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "GOOD MORNING" : hour < 18 ? "GOOD AFTERNOON" : "GOOD EVENING";
  const todayStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase();

  const firstName = (() => {
    try {
      const n = (JSON.parse(localStorage.getItem(SK_U) || "{}").name || "").trim();
      return n ? n.split(" ")[0] : "";
    } catch { return ""; }
  })();

  const motivationalQuotes = [
    "The only way to do great work is to love what you do.",
    "Push yourself, because no one else is going to do it for you.",
    "Sometimes we're tested not to show our weaknesses, but to discover our strengths.",
    "Your body can stand almost anything. It's your mind that you need to convince.",
    "Success is not final, failure is not fatal: it is the courage to continue that counts.",
    "The pain you feel today will be the strength you feel tomorrow.",
    "Excellence is not a destination; it is a continuous journey that never ends.",
    "Do something today that your future self will thank you for.",
    "Believe you can and you're halfway there.",
    "Every rep, every set, every workout is an investment in yourself.",
    "Motivation is what gets you started. Habit is what keeps you going.",
    "You don't have to see the whole staircase, just take the first step.",
    "Strength doesn't come from what you can do. It comes from overcoming the things you once thought you couldn't.",
    "Dream bigger. Do bigger.",
    "The greatest wealth is health.",
  ];

  const getQuoteOfTheDay = () => {
    const today = new Date();
    const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 86400000);
    return motivationalQuotes[dayOfYear % motivationalQuotes.length];
  };

  const activeSessInfo = (() => {
    try { return JSON.parse(localStorage.getItem(SK_ACTIVE) || "null"); } catch { return null; }
  })();

  // Determine recommended session index
  let recommendedIdx = 0;
  let isResume = false;
  if (program?.sessions?.length) {
    if (activeSessInfo?.sessId) {
      const idx = program.sessions.findIndex(s => s.id === activeSessInfo.sessId);
      if (idx >= 0) { recommendedIdx = idx; isResume = true; }
    } else {
      let latestDate = "";
      let latestId = null;
      for (const s of program.sessions) {
        const last = getLastSessionDate(sessions, s.id);
        if (last && last > latestDate) { latestDate = last; latestId = s.id; }
      }
      if (latestId) {
        const lastIdx = program.sessions.findIndex(s => s.id === latestId);
        recommendedIdx = lastIdx >= 0 ? (lastIdx + 1) % program.sessions.length : 0;
      }
    }
  }
  const recommendedSess = program?.sessions?.[recommendedIdx];

  // Quick stats — standardized counting used across Home, Calendar, Progress
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dow = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
  const mondayISO = monday.toISOString().split("T")[0];

  const totalCompleted = countAllCompletedSessions(program, sessions);
  const sessionsThisWeek = countCompletedThisWeek(program, sessions, mondayISO);
  const streak = calculateStreak(program, sessions);

  // Get last completed session info
  let lastSessionInfo = null;
  if (program?.sessions?.length) {
    let latestDate = "";
    let latestSess = null;
    for (const s of program.sessions) {
      const last = getLastSessionDate(sessions, s.id);
      if (last && last > latestDate) {
        latestDate = last;
        latestSess = { sess: s, date: last };
      }
    }
    if (latestSess) {
      const logKey = `${latestSess.sess.id}__${latestSess.date}`;
      const log = sessions[logKey] || {};
      let setCount = 0;
      for (const exSets of Object.values(log)) {
        setCount += Object.keys(exSets).length;
      }
      lastSessionInfo = {
        name: latestSess.sess.name,
        date: latestSess.date,
        sets: setCount
      };
    }
  }

  if (!recommendedSess) {
    return (
      <div>
        <div className="hdr">
          <div style={{ paddingBottom: 14 }}>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 26, letterSpacing: ".05em", lineHeight: 1, color: "var(--c1)" }}>
              {greeting}{firstName ? `, ${firstName}` : ""} 💪
            </div>
            <div style={{ fontSize: 9, color: "var(--c3)", letterSpacing: ".12em", marginTop: 5 }}>{todayStr}</div>
          </div>
        </div>
        <div style={{ padding: "20px 16px 100px", textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "var(--c2)", lineHeight: 1.8, marginTop: 40 }}>
            Complete your program setup to get started.<br />
            <span style={{ fontSize: 11, color: "var(--c4)", marginTop: 8 }}>Go to the SPLIT tab to create your first training split.</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="hdr">
        <div style={{ paddingBottom: 14 }}>
          <div style={{ fontFamily: "'Bebas Neue'", fontSize: 26, letterSpacing: ".05em", lineHeight: 1, color: "var(--c1)" }}>
            {greeting}{firstName ? `, ${firstName}` : ""} 💪
          </div>
          <div style={{ fontSize: 9, color: "var(--c3)", letterSpacing: ".12em", marginTop: 5 }}>{todayStr}</div>
        </div>
      </div>
      <div style={{ padding: "20px 16px 100px" }}>
        <div style={{ fontSize: 9, color: "var(--c3)", letterSpacing: ".12em", marginBottom: 10 }}>TODAY'S FOCUS</div>
        <div className="card" style={{ marginBottom: 24, padding: "20px" }}>
          <div style={{ fontFamily: "'Bebas Neue'", fontSize: 32, letterSpacing: ".05em", color: "var(--c1)", lineHeight: 1, marginBottom: 6 }}>
            {recommendedSess.name.toUpperCase()}
          </div>
          <div style={{ fontSize: 9, color: "var(--c4)", letterSpacing: ".1em", marginBottom: 20 }}>
            {recommendedSess.exercises.length} EXERCISE{recommendedSess.exercises.length !== 1 ? "S" : ""}
          </div>
          <button className="bp" style={{ width: "100%", fontSize: 11, padding: "14px", letterSpacing: ".08em", background: "var(--bg3)", color: "#fff", border: "1px solid var(--bdr)" }}
            onClick={() => onStartSession(recommendedIdx)}>
            {isResume ? "RESUME SESSION →" : "START SESSION →"}
          </button>
        </div>
        <div style={{ fontSize: 9, color: "var(--c3)", letterSpacing: ".12em", marginBottom: 10 }}>QUICK STATS</div>
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { label: "TOTAL SESSIONS", value: totalCompleted || "—" },
            { label: "THIS WEEK", value: sessionsThisWeek || "—" },
            { label: "STREAK", value: streak > 0 ? `${streak}D` : "—" },
          ].map(({ label, value }) => (
            <div key={label} className="card" style={{ flex: 1, padding: "16px 8px", textAlign: "center" }}>
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 30, letterSpacing: ".04em", color: "var(--c1)", lineHeight: 1 }}>
                {value}
              </div>
              <div style={{ fontSize: 7, color: "var(--c4)", letterSpacing: ".09em", marginTop: 5, lineHeight: 1.4 }}>
                {label}
              </div>
            </div>
          ))}
        </div>

        {lastSessionInfo && (
          <>
            <div style={{ fontSize: 9, color: "var(--c3)", letterSpacing: ".12em", marginBottom: 10, marginTop: 24 }}>LAST SESSION</div>
            <div className="card" style={{ padding: "16px", marginBottom: 24 }}>
              <div style={{ fontSize: 13, color: "var(--c1)", letterSpacing: ".04em", lineHeight: 1.6 }}>
                {lastSessionInfo.name.toUpperCase()} · {fmtDate(lastSessionInfo.date).toUpperCase()} · {lastSessionInfo.sets} SET{lastSessionInfo.sets !== 1 ? "S" : ""}
              </div>
            </div>
          </>
        )}

        <div style={{ fontSize: 9, color: "var(--c3)", letterSpacing: ".12em", marginBottom: 10 }}>DAILY MOTIVATION</div>
        <div className="card" style={{ padding: "18px", textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "var(--c2)", lineHeight: 1.7, fontStyle: "italic", letterSpacing: ".02em" }}>
            "{getQuoteOfTheDay()}"
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// SPLIT PAGE
// ══════════════════════════════════════════════
function SplitPage({ program, setProgram, showToast, onDupPrefChange }) {
  // Read localStorage directly — never rely solely on the prop here, because useState
  // only evaluates its initializer once. If the prop arrives null on first render the
  // phase would lock to "onboard" even when data exists in storage.
  const [phase, setPhase] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SK_P) || "null");
      return saved?.sessions?.length > 0 ? "editor" : "onboard";
    } catch { return "onboard"; }
  });
  // Belt-and-suspenders: if the program prop later delivers sessions (e.g. after an
  // async state hydration), promote phase to "editor" so onboarding never shows over
  // existing data.
  useEffect(() => {
    if (program?.sessions?.length > 0 && phase === "onboard") setPhase("editor");
  }, [program]);
  const [step, setStep] = useState(0);
  const [progName, setProgName] = useState("");
  const [progNameErr, setProgNameErr] = useState("");
  const [days, setDays] = useState(4);
  const [dayNames, setDayNames] = useState(["Day 1", "Day 2", "Day 3", "Day 4"]);
  const [nameErrs, setNameErrs] = useState({});
  const [selectedDay, setSelectedDay] = useState(null);
  const [addDayOpen, setAddDayOpen] = useState(false);
  const [dupPromptOpen, setDupPromptOpen] = useState(false);
  const [newProgPromptOpen, setNewProgPromptOpen] = useState(false);
  const [dayAction, setDayAction] = useState(null); // null | { sessId, view: "menu"|"rename"|"delete" }
  const [renameDraft, setRenameDraft] = useState("");
  const [renameErr, setRenameErr] = useState("");
  const [dragSrcIdx, setDragSrcIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  function startNewProgram() {
    try { localStorage.removeItem(SK_P); } catch {}
    setNewProgPromptOpen(false);
    setPhase("onboard");
    setStep(0);
    setProgName("");
    setProgNameErr("");
    setDays(4);
    setDayNames(["Day 1", "Day 2", "Day 3", "Day 4"]);
    setNameErrs({});
    showToast("STARTING NEW PROGRAM");
  }

  function saveProgram(next) {
    setProgram(next);
    try { localStorage.setItem(SK_P, JSON.stringify(next)); } catch {}
    saveExerciseNames(next);
  }

  function handleDayCount(n) {
    setDays(n);
    setDayNames(prev => Array.from({ length: n }, (_, i) => prev[i] || `Day ${i + 1}`));
  }

  function buildProgram() {
    const e = {};
    dayNames.forEach((name, i) => {
      if (!name.trim()) { e[i] = "Required."; return; }
      if (dayNames.some((n, j) => j !== i && n.trim().toLowerCase() === name.trim().toLowerCase())) e[i] = "Duplicate name.";
    });
    if (Object.keys(e).length) { setNameErrs(e); return; }
    const units = (() => { try { return JSON.parse(localStorage.getItem(SK_U) || "{}").wUnit || "lb"; } catch { return "lb"; } })();
    const prog = {
      name: progName.trim(), units, version: 1, created_at: todayISO(),
      sessions: dayNames.map((name, i) => ({ id: uid(), name: name.trim(), order_index: i, exercises: [] })),
    };
    try { localStorage.removeItem(SK_DUP); } catch {}
    saveProgram(prog); setPhase("editor"); showToast("SPLIT CREATED · TAP A DAY TO ADD EXERCISES");
  }

  if (phase === "onboard") {
    if (step === 0) return (
      <div className="ob">
        <div className="ob-step">STEP 1 OF 3</div>
        <div className="ob-title">NAME YOUR PROGRAM</div>
        <div className="ob-sub">What would you like to call this program?</div>
        <div className="fld">
          <input
            className="ti"
            value={progName}
            onChange={e => { setProgName(e.target.value); setProgNameErr(""); }}
            placeholder="e.g. Push Pull Legs, My Bulk Program"
            autoFocus
          />
          {progNameErr && <div className="err">{progNameErr}</div>}
        </div>
        <button
          className="bp"
          style={{ width: "100%" }}
          onClick={() => {
            if (!progName.trim()) { setProgNameErr("Program name required."); return; }
            setStep(1);
          }}
        >
          NEXT →
        </button>
      </div>
    );

    if (step === 1) return (
      <div className="ob">
        <div className="ob-step">STEP 2 OF 3</div>
        <div className="ob-title">HOW MANY DAYS?</div>
        <div className="ob-sub">How many days per week do you want to train?</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 32 }}>
          {[1, 2, 3, 4, 5, 6, 7].map(n => (
            <button key={n} className={`day-pick-btn${days === n ? " sel" : ""}`} onClick={() => handleDayCount(n)}>{n}</button>
          ))}
        </div>
        <button className="bp" style={{ width: "100%" }} onClick={() => setStep(2)}>NEXT →</button>
      </div>
    );

    return (
      <div className="ob">
        <div className="ob-step">STEP 3 OF 3</div>
        <div className="ob-title">NAME YOUR DAYS</div>
        <div className="ob-sub">Give each training day a name.</div>
        {dayNames.map((name, i) => (
          <div key={i} className="fld">
            <label className="lbl">DAY {i + 1}</label>
            <input
              className="ti"
              value={name}
              onChange={e => { const n = [...dayNames]; n[i] = e.target.value; setDayNames(n); setNameErrs(p => ({ ...p, [i]: "" })); }}
              placeholder={`Day ${i + 1}`}
              maxLength={30}
            />
            {nameErrs[i] && <div className="err">{nameErrs[i]}</div>}
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="bo" style={{ flex: 1 }} onClick={() => setStep(0)}>← BACK</button>
          <button className="bp" style={{ flex: 2 }} onClick={buildProgram}>CREATE SPLIT →</button>
        </div>
      </div>
    );
  }

  function handleRenameDay() {
    const trimmed = renameDraft.trim();
    const err = validateName(trimmed);
    if (err) { setRenameErr(err); return; }
    if (program.sessions.some(s => s.id !== dayAction.sessId && s.name.toLowerCase() === trimmed.toLowerCase())) {
      setRenameErr("A day with that name already exists."); return;
    }
    const next = JSON.parse(JSON.stringify(program));
    next.sessions.find(s => s.id === dayAction.sessId).name = trimmed;
    saveProgram(next);
    setDayAction(null);
    showToast(`RENAMED TO "${trimmed.toUpperCase()}"`);
  }

  function handleDeleteDay() {
    const name = program.sessions.find(s => s.id === dayAction.sessId)?.name || "DAY";
    const next = JSON.parse(JSON.stringify(program));
    next.sessions = next.sessions.filter(s => s.id !== dayAction.sessId);
    saveProgram(next);
    setDayAction(null);
    showToast(`"${name.toUpperCase()}" DELETED`);
  }

  function handleDayBack() {
    const alreadySet = (() => { try { return !!localStorage.getItem(SK_DUP); } catch { return false; } })();
    const dups = findDuplicateExNames(program);
    setSelectedDay(null);
    if (dups.length > 0 && !alreadySet) {
      setDupPromptOpen(true);
    }
  }

  function handleDragStart(idx) {
    setDragSrcIdx(idx);
  }

  function handleDragOver(e, idx) {
    e.preventDefault();
    setDragOverIdx(idx);
  }

  function handleDragLeave() {
    setDragOverIdx(null);
  }

  function handleDrop(idx) {
    if (dragSrcIdx === null || dragSrcIdx === idx) {
      setDragSrcIdx(null);
      setDragOverIdx(null);
      return;
    }
    const next = JSON.parse(JSON.stringify(program));
    const [moving] = next.sessions.splice(dragSrcIdx, 1);
    next.sessions.splice(idx, 0, moving);
    next.sessions.forEach((s, i) => { s.order_index = i; });
    saveProgram(next);
    setDragSrcIdx(null);
    setDragOverIdx(null);
    showToast("DAY ORDER UPDATED");
  }

  // program is loaded async by the root App useEffect. If phase resolved to "editor"
  // from localStorage but the prop hasn't arrived yet, wait silently rather than
  // crashing on program.sessions.map()/find() below.
  if (!program) return null;

  if (selectedDay) {
    const sess = program.sessions.find(s => s.id === selectedDay);
    if (!sess) { setSelectedDay(null); return null; }
    return (
      <DayEditPage
        sess={sess}
        program={program}
        saveProgram={saveProgram}
        showToast={showToast}
        onBack={handleDayBack}
      />
    );
  }

  return (
    <div>
      <div className="hdr">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: 14 }}>
          <div>
            <div className="wm">MY PROGRAM</div>
            {program?.name && <div style={{ fontSize: 9, color: "var(--c4)", letterSpacing: ".08em", marginTop: 3 }}>{program.name}</div>}
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <button className="bg-btn" onClick={() => setNewProgPromptOpen(true)}>CREATE NEW PROGRAM</button>
            <button className="bg-btn" onClick={() => setAddDayOpen(true)}>+ ADD DAY</button>
          </div>
        </div>
      </div>
      <div style={{ padding: "16px 20px 90px" }}>
        {program.sessions.map((sess, idx) => (
          <div
            key={sess.id}
            className="day-card"
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragOver={e => handleDragOver(e, idx)}
            onDragLeave={handleDragLeave}
            onDrop={() => handleDrop(idx)}
            onClick={() => setSelectedDay(sess.id)}
            style={{
              opacity: dragSrcIdx === idx ? 0.5 : 1,
              backgroundColor: dragOverIdx === idx ? "var(--bg3)" : undefined,
              transition: "all 0.2s"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
              <div style={{ color: "var(--c4)", cursor: "grab", fontSize: 14, flexShrink: 0, userSelect: "none" }}>⠿</div>
              <div style={{ minWidth: 0 }}>
                <div className="day-card-name">{sess.name.toUpperCase()}</div>
                <div className="day-card-count">
                  {sess.exercises.length === 0 ? "NO EXERCISES" : `${sess.exercises.length} EXERCISE${sess.exercises.length === 1 ? "" : "S"}`}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <button className="ib" style={{ color: "var(--c3)" }} onClick={e => { e.stopPropagation(); setRenameDraft(sess.name); setRenameErr(""); setDayAction({ sessId: sess.id, view: "menu" }); }}>
                <Icons.Edit size={14} />
              </button>
              <Icons.ChevRight size={16} />
            </div>
          </div>
        ))}
      </div>
      <Drawer open={addDayOpen} onClose={() => setAddDayOpen(false)}>
        <AddDayDrawer existingNames={program.sessions.map(s => s.name)} onAdd={name => {
          const next = JSON.parse(JSON.stringify(program));
          next.sessions.push({ id: uid(), name, order_index: next.sessions.length, exercises: [] });
          saveProgram(next); setAddDayOpen(false); showToast(`"${name}" ADDED`);
        }} />
      </Drawer>
      <Drawer open={dupPromptOpen} onClose={() => { setDupPromptOpen(false); setSelectedDay(null); }}>
        <DupPrefDrawer onSelect={pref => {
          if (onDupPrefChange) onDupPrefChange(pref);
          else { try { localStorage.setItem(SK_DUP, pref); } catch {} }
          setDupPromptOpen(false);
          setSelectedDay(null);
        }} />
      </Drawer>
      <Drawer open={!!dayAction} onClose={() => setDayAction(null)}>
        {dayAction?.view === "menu" && (
          <div>
            <div style={{ fontSize: 11, color: "var(--c3)", letterSpacing: ".12em", marginBottom: 16 }}>
              {program.sessions.find(s => s.id === dayAction.sessId)?.name?.toUpperCase()}
            </div>
            <button className="bo" style={{ width: "100%", marginBottom: 10, textAlign: "left", padding: "14px 16px" }} onClick={() => setDayAction(d => ({ ...d, view: "rename" }))}>
              RENAME DAY
            </button>
            <button className="bo" style={{ width: "100%", textAlign: "left", padding: "14px 16px", color: "var(--red)", borderColor: "var(--red)" }} onClick={() => setDayAction(d => ({ ...d, view: "delete" }))}>
              DELETE DAY
            </button>
          </div>
        )}
        {dayAction?.view === "rename" && (
          <div>
            <div style={{ fontSize: 11, color: "var(--c3)", letterSpacing: ".12em", marginBottom: 16 }}>RENAME DAY</div>
            <div className="fld">
              <input className="ti" value={renameDraft} onChange={e => { setRenameDraft(e.target.value); setRenameErr(""); }} placeholder="Day name" maxLength={30} autoFocus />
              {renameErr && <div className="err">{renameErr}</div>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="bo" style={{ flex: 1 }} onClick={() => setDayAction(d => ({ ...d, view: "menu" }))}>← BACK</button>
              <button className="bp" style={{ flex: 2 }} onClick={handleRenameDay}>SAVE →</button>
            </div>
          </div>
        )}
        {dayAction?.view === "delete" && (
          <div>
            <div style={{ fontSize: 11, color: "var(--c3)", letterSpacing: ".12em", marginBottom: 12 }}>DELETE DAY</div>
            <div style={{ fontSize: 12, color: "var(--c2)", lineHeight: 1.6, marginBottom: 20 }}>
              This will delete this day and all its exercises. Are you sure?
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="bo" style={{ flex: 1 }} onClick={() => setDayAction(d => ({ ...d, view: "menu" }))}>← BACK</button>
              <button className="bp" style={{ flex: 2, background: "var(--red)", borderColor: "var(--red)" }} onClick={handleDeleteDay}>DELETE →</button>
            </div>
          </div>
        )}
      </Drawer>

      {newProgPromptOpen && (
        <>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 85 }} onClick={() => setNewProgPromptOpen(false)} />
          <div style={{ position: "fixed", inset: 0, zIndex: 86, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
            <div style={{ background: "var(--bg2)", borderRadius: "var(--r)", border: "1px solid var(--bdr)", maxWidth: 320, padding: "24px", textAlign: "center" }}>
              <div style={{ fontSize: 13, fontFamily: "'Bebas Neue'", letterSpacing: ".06em", color: "var(--c1)", marginBottom: 16 }}>
                CREATE NEW PROGRAM?
              </div>
              <div style={{ fontSize: 12, color: "var(--c2)", lineHeight: 1.7, marginBottom: 20 }}>
                Creating a new program will replace your current split. Your workout history will be kept. Are you sure?
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="bo" style={{ flex: 1 }} onClick={() => setNewProgPromptOpen(false)}>CANCEL</button>
                <button className="bp" style={{ flex: 1 }} onClick={startNewProgram}>CREATE NEW PROGRAM</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DayEditPage({ sess, program, saveProgram, showToast, onBack }) {
  const [drawer, setDrawer] = useState({ open: false, type: null, data: null });
  const allNames = program.sessions.map(s => s.name);
  const currentSess = program.sessions.find(s => s.id === sess.id) || sess;

  function saveEx(fields) {
    if (!fields.name?.trim()) return;
    const next = JSON.parse(JSON.stringify(program));
    const s = next.sessions.find(s => s.id === sess.id);
    if (s) s.exercises.push({ id: uid(), order_index: s.exercises.length, ...fields });
    saveProgram(next); setDrawer({ open: false }); showToast("EXERCISE ADDED");
  }

  function updateEx(exId, fields) {
    const next = JSON.parse(JSON.stringify(program));
    const s = next.sessions.find(s => s.id === sess.id);
    if (s) { const ex = s.exercises.find(e => e.id === exId); if (ex) Object.assign(ex, fields); }
    saveProgram(next); setDrawer({ open: false }); showToast("EXERCISE UPDATED ✓");
  }

  function removeEx(exId) {
    const next = JSON.parse(JSON.stringify(program));
    const s = next.sessions.find(s => s.id === sess.id);
    if (s) s.exercises = s.exercises.filter(e => e.id !== exId);
    saveProgram(next); setDrawer({ open: false }); showToast("EXERCISE REMOVED");
  }

  function removeSession() {
    const next = JSON.parse(JSON.stringify(program));
    next.sessions = next.sessions.filter(s => s.id !== sess.id).map((s, i) => ({ ...s, order_index: i }));
    saveProgram(next); onBack(); showToast("DAY REMOVED");
  }

  function renameSession(newName) {
    const next = JSON.parse(JSON.stringify(program));
    const s = next.sessions.find(s => s.id === sess.id);
    if (s) { s.previous_name = s.name; s.name = newName; s.renamed_at = todayISO(); }
    saveProgram(next);
  }

  return (
    <div>
      <div className="hdr">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <button className="back-btn" onClick={onBack}><Icons.ChevLeft size={13} />BACK</button>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {currentSess.exercises.length > 1 && (
              <button className="bg-btn" onClick={() => setDrawer({ open: true, type: "reorder" })}>REORDER</button>
            )}
            <button className="bp" style={{ fontSize: 9, padding: "8px 14px" }} onClick={onBack}>SAVE →</button>
          </div>
        </div>
        <div style={{ paddingBottom: 14 }}>
          <InlineName
            value={currentSess.name}
            onSave={renameSession}
            siblings={allNames.filter(n => n !== currentSess.name)}
          />
        </div>
      </div>
      <div style={{ padding: "12px 20px 90px" }}>
        <div className="card">
          {currentSess.exercises.length === 0
            ? <div style={{ fontSize: 11, color: "var(--c4)", textAlign: "center", padding: "10px 0", letterSpacing: ".1em" }}>NO EXERCISES YET</div>
            : currentSess.exercises.map(ex => (
              <div key={ex.id} className="ex-row-edit">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "var(--c2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex.name}</div>
                  <div style={{ fontSize: 9, color: "var(--c5)", marginTop: 2, letterSpacing: ".06em" }}>{ex.sets} sets · {ex.rep_min}–{ex.rep_max} reps</div>
                </div>
                <button className="ib" onClick={() => setDrawer({ open: true, type: "edit_ex", data: { ex } })}><Icons.Edit /></button>
              </div>
            ))}
        </div>
        <button className="bo" style={{ width: "100%", marginTop: 8 }} onClick={() => setDrawer({ open: true, type: "add_ex" })}>+ ADD EXERCISE</button>
      </div>
      <Drawer open={drawer.open} onClose={() => setDrawer({ open: false })}>
        {drawer.type === "add_ex" && (
          <div>
            <div className="drw-title">ADD EXERCISE</div>
            <ExForm initial={{}} onSave={saveEx} onRemove={null} program={program} />
          </div>
        )}
        {drawer.type === "edit_ex" && (
          <div>
            <div className="drw-title">EDIT EXERCISE</div>
            <ExForm initial={drawer.data.ex} onSave={f => updateEx(drawer.data.ex.id, f)} onRemove={() => removeEx(drawer.data.ex.id)} program={program} />
          </div>
        )}
        {drawer.type === "del_day" && (
          <div>
            <div className="drw-title">REMOVE DAY?</div>
            <div style={{ fontSize: 11, color: "var(--c3)", lineHeight: 1.8, marginBottom: 20 }}>
              Remove <span style={{ color: "var(--c1)" }}>{currentSess.name}</span> and all its exercises? This cannot be undone.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="bo" style={{ flex: 1 }} onClick={() => setDrawer({ open: false })}>CANCEL</button>
              <button className="bp" style={{ flex: 2, background: "var(--red)", color: "#000" }} onClick={removeSession}>REMOVE →</button>
            </div>
          </div>
        )}
        {drawer.type === "reorder" && (
          <ReorderDrawer sessId={currentSess.id} program={program} saveProgram={saveProgram} setDrawer={setDrawer} showToast={showToast} />
        )}
      </Drawer>
    </div>
  );
}

function AddDayDrawer({ existingNames, onAdd }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const suggestions = ["Abs", "Arms", "Cardio", "Mobility", "Shoulders", "Glutes", "Calves", "Chest", "Back", "Biceps", "Triceps"];
  const available = suggestions.filter(s => !existingNames.map(n => n.toLowerCase()).includes(s.toLowerCase()));

  function submit() {
    const e = validateName(name);
    if (e) { setErr(e); return; }
    const t = name.trim();
    if (existingNames.map(n => n.toLowerCase()).includes(t.toLowerCase())) { setErr("That name is already used in this split."); return; }
    onAdd(t);
  }

  return (
    <div>
      <div className="drw-title">ADD EXTRA DAY</div>
      <div className="drw-sub">ADD ANY EXTRA SESSION TO YOUR SPLIT</div>
      <div className="fld">
        <span className="lbl">DAY NAME</span>
        <input className="ti" placeholder='e.g. "Abs", "Arms", "Cardio"' value={name} onChange={e => { setName(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && submit()} maxLength={30} />
        {err && <div className="err">{err}</div>}
        <div className="helper">1–30 characters · letters, numbers, spaces, - _ / ( ) .</div>
      </div>
      {available.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 9, color: "var(--c4)", letterSpacing: ".12em", marginBottom: 8 }}>QUICK ADD</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {available.map(s => (
              <button key={s} className="bo" style={{ fontSize: 9, padding: "6px 12px" }} onClick={() => setName(s)}>{s}</button>
            ))}
          </div>
        </div>
      )}
      <button className="bp" style={{ width: "100%" }} onClick={submit}>ADD DAY →</button>
    </div>
  );
}

function DupPrefDrawer({ onSelect }) {
  const [pick, setPick] = useState(null);
  return (
    <div>
      <div className="drw-title">ONE LAST THING</div>
      <div className="drw-sub" style={{ marginBottom: 18 }}>WE NOTICED THE SAME EXERCISE ON MULTIPLE TRAINING DAYS. HOW WOULD YOU LIKE TO TRACK THEM?</div>
      <div className="gc">
        <div className={`gcard${pick === "by_day" ? " sel" : ""}`} onClick={() => setPick("by_day")}>
          <h3>BY DAY</h3>
          <p>Each day gets its own independent chart. e.g. "Bench Press (Push)" and "Bench Press (Upper)" as two separate entries.</p>
        </div>
        <div className={`gcard${pick === "combined" ? " sel" : ""}`} onClick={() => setPick("combined")}>
          <h3>COMBINED</h3>
          <p>All data for an exercise is merged into one chart regardless of which day it was performed.</p>
        </div>
      </div>
      {pick && (
        <button className="bp" style={{ width: "100%" }} onClick={() => onSelect(pick)}>SAVE PREFERENCE →</button>
      )}
    </div>
  );
}

function ExForm({ initial = {}, onSave, onRemove, program }) {
  const [name, setName] = useState(initial.name || "");
  const [sets, setSets] = useState(initial.sets || null);
  const [rMin, setRMin] = useState(initial.rep_min !== undefined ? String(initial.rep_min) : "");
  const [rMax, setRMax] = useState(initial.rep_max !== undefined ? String(initial.rep_max) : "");
  const [err, setErr] = useState("");

  function submit() {
    if (!name.trim()) { setErr("Exercise name required."); return; }
    if (!sets || sets < 1) { setErr("Sets required."); return; }
    const mn = parseInt(rMin), mx = parseInt(rMax);
    if (isNaN(mn) || isNaN(mx) || mn < 1 || mx > 30 || mn >= mx) { setErr("Rep range: 1–30, min < max."); return; }
    onSave({ name: toTitleCase(name.trim()), sets, rep_min: mn, rep_max: mx, progression: initial.progression || "double", notes: initial.notes || "", increment: program?.increment || 2.5, units: program?.units || "lb" });
  }

  return (
    <div>
      <div className="fld"><span className="lbl">EXERCISE NAME</span><input className="ti" placeholder="e.g. Barbell Bench Press" value={name} onChange={e => setName(e.target.value)} /></div>
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <span className="lbl">SETS</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44 }}>
            <button className="ib" onClick={() => setSets(s => s === null ? null : clamp(s - 1, 1, 8))}><Icons.Minus /></button>
            <span style={{ fontSize: 16, color: sets === null ? "var(--c4)" : "var(--c1)", minWidth: 24, textAlign: "center" }}>{sets === null ? "—" : sets}</span>
            <button className="ib" onClick={() => setSets(s => s === null ? 1 : clamp(s + 1, 1, 8))}><Icons.Plus /></button>
          </div>
        </div>
        <div style={{ flex: 2 }}>
          <span className="lbl">REP RANGE</span>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <input className="ti" type="number" placeholder="8" value={rMin} onChange={e => setRMin(e.target.value)} style={{ width: 64, textAlign: "center", padding: "10px 4px" }} />
            <span style={{ color: "var(--c4)", fontSize: 14 }}>–</span>
            <input className="ti" type="number" placeholder="12" value={rMax} onChange={e => setRMax(e.target.value)} style={{ width: 64, textAlign: "center", padding: "10px 4px" }} />
          </div>
        </div>
      </div>
      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        {onRemove && <button className="bo" style={{ flex: 1, color: "var(--red)", borderColor: "var(--red)" }} onClick={onRemove}>REMOVE</button>}
        <button className="bp" style={{ flex: 2 }} onClick={submit}>{initial.name ? "SAVE →" : "ADD →"}</button>
      </div>
    </div>
  );
}

function ReorderDrawer({ sessId, program, saveProgram, setDrawer, showToast }) {
  const sess = program.sessions.find(s => s.id === sessId);
  const [order, setOrder] = useState(sess ? [...sess.exercises] : []);
  const [drag, setDrag] = useState(null);
  return (
    <div>
      <div className="drw-title">REORDER EXERCISES</div>
      <div className="drw-sub">DRAG TO REORDER · WON'T AFFECT PROGRESS CHARTS</div>
      {order.map((ex, i) => (
        <div key={ex.id} className="reorder-item" draggable
          onDragStart={() => setDrag(i)} onDragOver={e => e.preventDefault()}
          onDrop={() => { if (drag === null || drag === i) return; const n = [...order]; const [mv] = n.splice(drag, 1); n.splice(i, 0, mv); setOrder(n); setDrag(null); }}>
          <Icons.Drag />
          <span style={{ fontSize: 12, color: "var(--c2)", flex: 1 }}>{ex.name}</span>
          <span style={{ fontSize: 9, color: "var(--c4)" }}>{ex.sets}×{ex.rep_min}–{ex.rep_max}</span>
        </div>
      ))}
      <button className="bp" style={{ width: "100%", marginTop: 14 }} onClick={() => {
        const next = JSON.parse(JSON.stringify(program));
        const s = next.sessions.find(s => s.id === sessId);
        if (s) s.exercises = order.map((e, i) => ({ ...e, order_index: i }));
        saveProgram(next); setDrawer({ open: false }); showToast("ORDER SAVED");
      }}>SAVE ORDER →</button>
    </div>
  );
}

// ══════════════════════════════════════════════
// LOG PAGE
// ══════════════════════════════════════════════
function LogPage({ program, setProgram, sessions, setSessions, showToast, pendingSessionIdx = null, onClearPending }) {
  // Delete SK_ACTIVE synchronously before any useState initializer runs.
  // If the stored sessId doesn't match any session in the current program
  // (different account, new split, or no split yet) wipe it immediately.
  try {
    const _active = localStorage.getItem(SK_ACTIVE);
    if (_active) {
      const _info = JSON.parse(_active);
      const _prog = program || JSON.parse(localStorage.getItem(SK_P) || "null");
      if (!_prog?.sessions?.some(s => s.id === _info?.sessId)) {
        localStorage.removeItem(SK_ACTIVE);
      }
    }
  } catch {}

  const [phase, setPhase] = useState("overview");
  const [activeSessIdx, setActiveSessIdx] = useState(0);
  const [histView, setHistView] = useState(null);
  const [selectedOverviewIdx, setSelectedOverviewIdx] = useState(null);
  const [drawer, setDrawer] = useState({ open: false, type: null, data: null });
  const [saved, setSaved] = useState(false);
  const [completionData, setCompletionData] = useState(null);
  const [exerciseOrder, setExerciseOrder] = useState([]);
  const [originalOrder, setOriginalOrder] = useState([]);
  const dragIdxRef = useRef(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [showSaveOrderPrompt, setShowSaveOrderPrompt] = useState(false);
  const [prFlash, setPrFlash] = useState({});
  const [exNotes, setExNotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SK_EXNOTES) || "{}"); } catch { return {}; }
  });
  const [exIdInEdit, setExIdInEdit] = useState(null);
  const [editNoteText, setEditNoteText] = useState("");
  const [sessionAddedExercises, setSessionAddedExercises] = useState([]);
  const [sessionRemovedExercises, setSessionRemovedExercises] = useState([]);
  const [originalSessionExercises, setOriginalSessionExercises] = useState(null);
  const [showChangeConfirm, setShowChangeConfirm] = useState(false);
  const [showRemoveExConfirm, setShowRemoveExConfirm] = useState(null);
  const { timers, startTimer, resetTimer } = useExTimer();
  const [restDuration, setRestDuration] = useState(() => {
    try { return parseInt(localStorage.getItem(SK_REST)) || 90; } catch { return 90; }
  });
  const [activeSessInfo, setActiveSessInfo] = useState(() => {
    try {
      const r = localStorage.getItem(SK_ACTIVE);
      if (!r) return null;
      const info = JSON.parse(r);
      // Validate sessId belongs to the current program before trusting it.
      // If SK_P is absent or doesn't contain this sessId (e.g. different account,
      // rebuilt split), clear SK_ACTIVE immediately so no stale banner ever appears.
      const prog = JSON.parse(localStorage.getItem(SK_P) || "null");
      if (!prog?.sessions?.some(s => s.id === info.sessId)) {
        localStorage.removeItem(SK_ACTIVE);
        return null;
      }
      // Verify there is actual logged data for this session.
      // Check if SK_S contains any logged sets (keys like {sessId}__{date}).
      const sess = JSON.parse(localStorage.getItem(SK_S) || "{}");
      const hasLoggedData = Object.keys(sess).some(k =>
        k.startsWith(`${info.sessId}__`) &&
        !k.includes("__date") &&
        !k.includes("__completed") &&
        !k.includes("__done__")
      );
      if (!hasLoggedData) {
        localStorage.removeItem(SK_ACTIVE);
        return null;
      }
      return info;
    } catch { return null; }
  });
  const [sessSecs, setSessSecs] = useState(() => {
    try {
      const r = localStorage.getItem(SK_ACTIVE);
      if (!r) return 0;
      const info = JSON.parse(r);
      const prog = JSON.parse(localStorage.getItem(SK_P) || "null");
      if (!prog?.sessions?.some(s => s.id === info.sessId)) return 0;
      return calcElapsed(info);
    } catch { return 0; }
  });

  useEffect(() => {
    if (phase !== "session" || !activeSessInfo?.startedAt) return;
    const id = setInterval(() => setSessSecs(calcElapsed(activeSessInfo)), 1000);
    return () => clearInterval(id);
  }, [phase, activeSessInfo]);

  useEffect(() => {
    if (pendingSessionIdx !== null && program?.sessions?.length) {
      beginSession(pendingSessionIdx);
      if (onClearPending) onClearPending();
    }
  }, [pendingSessionIdx]);

  // Validate active session against current program on every program change.
  // Clears stale activeSessInfo (from a previous account or deleted split) so the
  // Resume banner never appears for sessions that don't belong to the current program.
  useEffect(() => {
    if (!activeSessInfo) return;
    if (!program?.sessions?.some(s => s.id === activeSessInfo.sessId)) {
      saveActiveSessInfo(null);
    }
  }, [program]);

  // Initialise exerciseOrder when entering session phase (covers resume & pending-session start)
  // Also reset if switching between sessions to avoid stale exercise data
  useEffect(() => {
    if (phase === "session" && program?.sessions?.[activeSessIdx]) {
      const currentSessExercises = program.sessions[activeSessIdx].exercises;
      // Check if exerciseOrder matches current session's exercises
      const isStale = exerciseOrder.length > 0 &&
        (exerciseOrder.length !== currentSessExercises.length ||
         !exerciseOrder.every(ex => currentSessExercises.some(e => e.id === ex.id)));

      if (exerciseOrder.length === 0 || isStale) {
        const exs = [...currentSessExercises].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
        setExerciseOrder(exs);
        setOriginalOrder(exs.map(e => e.id));
      }
    }
  }, [phase, activeSessIdx, program]);

  if (!program?.sessions?.length) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: 32, fontFamily: "'Bebas Neue'", letterSpacing: ".06em", color: "var(--c4)", marginBottom: 12 }}>NO SPLIT YET</div>
        <div style={{ fontSize: 12, color: "var(--c4)", lineHeight: 1.8 }}>Build your split in the <strong style={{ color: "var(--c2)" }}>SPLIT</strong> tab first.</div>
      </div>
    );
  }

  if (completionData) {
    return (
      <div className="complete-screen">
        <div className="cs-emoji">💪</div>
        <div className="cs-title">SESSION COMPLETE</div>
        <div className="cs-msg">{completionData.msg}</div>
        <div className="cs-stats">
          <div className="cs-stat">
            <div className="cs-sv">{completionData.vol.toLocaleString()}</div>
            <div className="cs-sl">TOTAL VOLUME ({program.units || "KG"})</div>
          </div>
          <div className="cs-stat">
            <div className="cs-sv">{completionData.sets}</div>
            <div className="cs-sl">SETS COMPLETED</div>
          </div>
          <div className="cs-stat full">
            <div className="cs-sv">{fmtSessDur(completionData.duration)}</div>
            <div className="cs-sl">SESSION DURATION</div>
          </div>
          {completionData.prs > 0 && (
            <div className="cs-stat full gold">
              <div className="cs-sv gold-text">{completionData.prs} PR{completionData.prs > 1 ? "S" : ""} HIT 🏆</div>
              <div className="cs-sl">NEW PERSONAL RECORD{completionData.prs > 1 ? "S" : ""}</div>
            </div>
          )}
        </div>
        <button className="bp" style={{ width: "100%", maxWidth: 340, marginTop: 8 }} onClick={() => { setCompletionData(null); setSelectedOverviewIdx(null); setPhase("overview"); }}>← BACK TO LOG</button>
      </div>
    );
  }

  function saveActiveSessInfo(info) {
    setActiveSessInfo(info);
    try {
      if (info) localStorage.setItem(SK_ACTIVE, JSON.stringify(info));
      else localStorage.removeItem(SK_ACTIVE);
    } catch {}
  }

  function beginSession(idx) {
    const s = program.sessions[idx];
    const isResume = activeSessInfo?.sessId === s.id;
    const elapsedSecs = isResume ? (activeSessInfo.elapsedSecs || 0) : 0;
    const info = { sessId: s.id, elapsedSecs, startedAt: Date.now() };
    saveActiveSessInfo(info);
    setSessSecs(elapsedSecs);
    setActiveSessIdx(idx);
    if (!isResume) {
      const k = `${s.id}__${todayISO()}`;
      setSessions(p => {
        const next = { ...p, [`${s.id}__date`]: todayISO() };
        delete next[`${s.id}__completed`];
        if (!next[k]) next[k] = {};
        for (const ex of s.exercises) {
          if (!next[k][ex.id]) {
            next[k][ex.id] = {};
            for (let i = 0; i < (ex.sets || 0); i++) {
              next[k][ex.id][String(i)] = { weight: "", reps: "", rir: null };
            }
          }
        }
        return next;
      });
    } else if (!sessions[`${s.id}__date`]) {
      setSessions(p => ({ ...p, [`${s.id}__date`]: todayISO() }));
    }
    if (!isResume) {
      const exs = [...s.exercises].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
      setExerciseOrder(exs);
      setOriginalOrder(exs.map(e => e.id));
      setOriginalSessionExercises(JSON.parse(JSON.stringify(exs)));
      setSessionAddedExercises([]);
      setSessionRemovedExercises([]);
    }
    setDragIdx(null);
    dragIdxRef.current = null;
    setShowSaveOrderPrompt(false);
    setDrawer({ open: false });
    setPhase("session");
  }

  function pauseAndGoBack() {
    if (activeSessInfo?.startedAt) {
      const elapsed = calcElapsed(activeSessInfo);
      const info = { ...activeSessInfo, elapsedSecs: elapsed, startedAt: null };
      saveActiveSessInfo(info);
      setSessSecs(elapsed);
    }
    setHistView(null);
    setSelectedOverviewIdx(null);
    setPhase("overview");
  }

  function discardSession() {
    setSessions(p => {
      const next = { ...p };
      const date = next[`${sess?.id}__date`] || todayISO();
      delete next[`${sess.id}__${date}`];
      delete next[`${sess?.id}__date`];
      delete next[`${sess?.id}__completed`];
      try { localStorage.setItem(SK_S, JSON.stringify(next)); } catch {}
      return next;
    });
    saveActiveSessInfo(null);
    setDrawer({ open: false });
    setSelectedOverviewIdx(null);
    setExerciseOrder([]);
    setPhase("overview");
  }

  function saveExerciseOrderToSplit() {
    const next = JSON.parse(JSON.stringify(program));
    const s = next.sessions[activeSessIdx];
    if (s) s.exercises = exerciseOrder.map((ex, i) => ({ ...ex, order_index: i }));
    setProgram(next);
    try { localStorage.setItem(SK_P, JSON.stringify(next)); } catch {}
  }

  function completeSession(completionDate = sessDate) {
    const vol = calcVol();
    const sets = countLogged();
    const prs = countSessionPRs();
    const msg = MOTIV_MSGS[Math.floor(Math.random() * MOTIV_MSGS.length)];
    const duration = sessSecs;
    const completed = {
      ...sessions,
      [`${sess.id}__done__${completionDate}`]: "1",
    };
    delete completed[`${sess.id}__completed`];
    setSessions(completed);
    try { localStorage.setItem(SK_S, JSON.stringify(completed)); } catch {}
    saveActiveSessInfo(null);
    setShowSaveOrderPrompt(false);
    setExerciseOrder([]);
    setCompletionData({ vol, sets, prs, msg, duration });
  }

  function detectSessionChanges(checkDate = sessions[`${sess.id}__date`] || todayISO()) {
    if (!originalSessionExercises || !sess) return false;
    const k = `${sess.id}__${checkDate}`;
    const log = sessions[k] || {};
    for (const ex of originalSessionExercises) {
      const logSets = log[ex.id] || {};
      const currentSetCount = Object.keys(logSets).length;
      if (currentSetCount !== ex.sets) {
        return true;
      }
    }
    if (sessionAddedExercises.length > 0) {
      return true;
    }
    if (sessionRemovedExercises.length > 0) {
      return true;
    }
    return false;
  }

  function updateProgramWithChanges(completionDate = sessions[`${sess.id}__date`] || todayISO()) {
    if (!originalSessionExercises || !sess) return;
    const k = `${sess.id}__${completionDate}`;
    const log = sessions[k] || {};
    const next = JSON.parse(JSON.stringify(program));
    const sessIdx = next.sessions.findIndex(s => s.id === sess.id);
    if (sessIdx === -1) return;

    for (const ex of originalSessionExercises) {
      const logSets = log[ex.id] || {};
      const currentSetCount = Object.keys(logSets).length;
      const exIdx = next.sessions[sessIdx].exercises.findIndex(e => e.id === ex.id);
      if (exIdx !== -1 && currentSetCount !== ex.sets) {
        next.sessions[sessIdx].exercises[exIdx].sets = currentSetCount;
      }
    }

    for (const newEx of sessionAddedExercises) {
      next.sessions[sessIdx].exercises.push(newEx);
    }

    for (const removedExId of sessionRemovedExercises) {
      const exIdx = next.sessions[sessIdx].exercises.findIndex(e => e.id === removedExId);
      if (exIdx !== -1) {
        next.sessions[sessIdx].exercises.splice(exIdx, 1);
      }
    }

    setProgram(next);
    try { localStorage.setItem(SK_P, JSON.stringify(next)); } catch {}
    showToast("PROGRAM UPDATED ✓", "tg");
  }

  function handleCompleteButton() {
    const currentSessDate = sessions[`${sess.id}__date`] || todayISO();
    const orderChanged = exerciseOrder.length > 0 &&
      exerciseOrder.map(e => e.id).join(",") !== originalOrder.join(",");
    const hasChanges = detectSessionChanges(currentSessDate);
    if (hasChanges) {
      setShowChangeConfirm(true);
    } else if (orderChanged) {
      setShowSaveOrderPrompt(true);
    } else {
      completeSession(currentSessDate);
    }
  }

  function startEditNote(exId) {
    setExIdInEdit(exId);
    setEditNoteText(exNotes[exId] || "");
  }

  function saveNote(exId) {
    const updated = { ...exNotes };
    if (editNoteText.trim()) {
      updated[exId] = editNoteText.trim();
    } else {
      delete updated[exId];
    }
    setExNotes(updated);
    try { localStorage.setItem(SK_EXNOTES, JSON.stringify(updated)); } catch {}
    setExIdInEdit(null);
    setEditNoteText("");
  }

  function cancelEditNote() {
    setExIdInEdit(null);
    setEditNoteText("");
  }

// ─── OVERVIEW ───
  if (phase === "overview") {
    const activeIdx = activeSessInfo ? program.sessions.findIndex(s => s.id === activeSessInfo.sessId) : -1;
    const activeSessName = activeIdx >= 0 ? program.sessions[activeIdx].name : null;
    const hasSelection = selectedOverviewIdx !== null;
    return (
      <div>
        <div className="hdr">
          <div className="wm">LOG</div>
          <div className="wm-sub" style={{ marginBottom: 14 }}>YOUR TRAINING SPLIT</div>
        </div>
        <div style={{ padding: "16px 16px 100px" }}>
          {activeSessInfo && activeIdx >= 0 && (
            <div className="resume-banner" onClick={() => beginSession(activeIdx)}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="inprog-dot" />
                <div>
                  <div style={{ fontSize: 11, color: "var(--c1)", letterSpacing: ".06em" }}>{activeSessName?.toUpperCase() || "SESSION"}</div>
                  <div style={{ fontSize: 9, color: "var(--c3)", letterSpacing: ".1em", marginTop: 2 }}>
                    {fmtSessDur(calcElapsed(activeSessInfo))} ELAPSED · TAP TO RESUME
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 9, color: "var(--green)", letterSpacing: ".1em", fontFamily: "'DM Mono',monospace" }}>RESUME →</div>
            </div>
          )}
          <div style={{ fontSize: 9, color: "var(--c3)", letterSpacing: ".1em", marginBottom: 12 }}>
            SELECT A DAY TO BEGIN
          </div>
          {program.sessions.map((s, i) => {
            const isActive = activeSessInfo?.sessId === s.id;
            const isSelected = selectedOverviewIdx === i;
            const lastCompleted = getLastSessionDate(sessions, s.id);
            return (
              <div key={s.id} className="day-card"
                style={isSelected ? { borderColor: "var(--blue)", background: "var(--bg3)" } : undefined}
                onClick={() => setSelectedOverviewIdx(isSelected ? null : i)}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    {isActive && <span className="inprog-dot" />}
                    <div className="day-card-name">{s.name.toUpperCase()}</div>
                  </div>
                  <div style={{ fontSize: 9, color: "var(--c4)", letterSpacing: ".08em", marginTop: 4 }}>
                    {lastCompleted ? `LAST TRAINED: ${fmtDate(lastCompleted).toUpperCase()}` : "NOT YET TRAINED"}
                  </div>
                  <div className="day-card-count">
                    {s.exercises.length === 0 ? "NO EXERCISES" : `${s.exercises.length} EXERCISE${s.exercises.length === 1 ? "" : "S"}`}
                  </div>
                  {isActive && <div className="inprog-badge">IN PROGRESS</div>}
                </div>
              </div>
            );
          })}
          <button className="bp"
            style={{ width: "100%", marginTop: 16, ...(!hasSelection ? { opacity: 0.35, pointerEvents: "none" } : {}) }}
            onClick={() => { if (hasSelection) beginSession(selectedOverviewIdx); }}>
            START SESSION →
          </button>
        </div>
      </div>
    );
  }

  // ─── SESSION PHASE ───
  const sess = program.sessions[activeSessIdx];
  const sessDate = sessions[`${sess.id}__date`] || todayISO();

  function logKey(sessId, date) { return `${sessId}__${date}`; }
  function getLog() { return sessions[logKey(sess.id, sessDate)] || {}; }
  function getLastLog(exId) {
    const matches = [];
    for (const [k, log] of Object.entries(sessions)) {
      if (k.includes("__date") || k.includes("__completed") || !k.includes("__")) continue;
      const date = k.split("__")[1];
      if (date && date !== sessDate && log[exId]) matches.push({ date, sets: log[exId] });
    }
    return matches.sort((a, b) => b.date.localeCompare(a.date))[0] || null;
  }

  function getAllTimeMaxE1rm(exId) {
    let best = 0;
    for (const [k, log] of Object.entries(sessions)) {
      if (k.includes("__date") || k.includes("__completed") || !k.includes("__")) continue;
      if (log[exId]) {
        for (const s of Object.values(log[exId])) {
          if (s.weight && s.reps) best = Math.max(best, e1rmCalc(s.weight, s.reps));
        }
      }
    }
    return best;
  }

  function updateSet(exId, si, field, val) {
    setSessions(p => {
      const k = logKey(sess.id, sessDate);
      const next = JSON.parse(JSON.stringify(p));
      if (!next[k]) next[k] = {};
      if (!next[k][exId]) next[k][exId] = {};
      if (!next[k][exId][si]) next[k][exId][si] = { weight: "", reps: "", rir: null };
      next[k][exId][si][field] = val;
      const setData = next[k][exId][si];
      if (setData.weight && setData.reps) {
        startTimer("rest", restDuration);
      }
      if (field === "reps" && val && next[k][exId][si].weight) {
        const newE = e1rmCalc(next[k][exId][si].weight, val);
        const prevBest = getAllTimeMaxE1rm(exId);
        if (newE > prevBest && prevBest > 0) {
          setPrFlash(pr => ({ ...pr, [`${exId}_${si}`]: true }));
          setTimeout(() => setPrFlash(pr => ({ ...pr, [`${exId}_${si}`]: false })), 3000);
          showToast("🏆 NEW PR!", "tgold");
        }
      }
      return next;
    });
    setSaved(false);
  }

  function updateRir(exId, si, val) {
    setSessions(p => {
      const k = logKey(sess.id, sessDate);
      const next = JSON.parse(JSON.stringify(p));
      if (!next[k]) next[k] = {};
      if (!next[k][exId]) next[k][exId] = {};
      if (!next[k][exId][si]) next[k][exId][si] = { weight: "", reps: "", rir: null };
      next[k][exId][si].rir = val;
      return next;
    });
  }


  async function saveLog() {
    try { localStorage.setItem(SK_S, JSON.stringify(sessions)); } catch {}
    setSaved(true); showToast("SESSION SAVED ✓", "tg");
    setTimeout(() => setSaved(false), 2200);
  }

  function getProgArrow(exId, si) {
    const last = getLastLog(exId);
    if (!last) return null;
    const curr = getLog()?.[exId]?.[si];
    if (!curr?.weight || !curr?.reps) return null;
    const ls = last.sets?.[si];
    if (!ls?.weight) return null;
    const cw = parseFloat(curr.weight), lw = parseFloat(ls.weight), cr = parseFloat(curr.reps), lr = parseFloat(ls.reps);
    if (cw > lw || (cw === lw && cr > lr)) return <span className="arr-up">▲</span>;
    if (cw < lw || (cw === lw && cr < lr)) return <span className="arr-dn">▼</span>;
    return <span style={{ fontSize: 9, color: "var(--c4)" }}>=</span>;
  }

  function calcVol() {
    let v = 0;
    for (const sets of Object.values(getLog())) {
      for (const s of Object.values(sets)) {
        if (s.weight && s.reps) v += parseFloat(s.weight) * parseFloat(s.reps);
      }
    }
    return Math.round(v);
  }

  function countLogged() {
    let n = 0;
    for (const sets of Object.values(getLog())) n += Object.keys(sets).length;
    return n;
  }

  function countPlanned() { return sess.exercises.reduce((s, ex) => s + ex.sets, 0); }

  function countSessionPRs() {
    const log = getLog();
    let count = 0;
    for (const ex of sess.exercises) {
      const logSets = log[ex.id] || {};
      for (const s of Object.values(logSets)) {
        if (!s.weight || !s.reps) continue;
        const newE = e1rmCalc(s.weight, s.reps);
        let prevBest = 0;
        for (const [k, slog] of Object.entries(sessions)) {
          if (k.includes("__date") || k.includes("__completed") || !k.includes("__")) continue;
          const date = k.split("__")[1];
          if (date === sessDate) continue;
          if (slog[ex.id]) {
            for (const ps of Object.values(slog[ex.id])) {
              if (ps.weight && ps.reps) prevBest = Math.max(prevBest, e1rmCalc(ps.weight, ps.reps));
            }
          }
        }
        if (newE > prevBest && prevBest > 0) { count++; break; }
      }
    }
    return count;
  }

  const MOTIV_MSGS = [
    "KEEP SHOWING UP.",
    "PROGRESS IS PROGRESS.",
    "ONE SESSION CLOSER.",
    "THE WORK COMPOUNDS.",
    "CONSISTENCY BEATS INTENSITY.",
    "REST. RECOVER. REPEAT.",
    "YOU EARNED THIS.",
    "STRONGER EVERY TIME.",
  ];

  function getExHistory(exId) {
    const m = [];
    for (const [k, log] of Object.entries(sessions)) {
      if (k.includes("__date") || k.includes("__completed") || !k.includes("__")) continue;
      const date = k.split("__")[1];
      if (date && log[exId]) m.push({ date, sets: log[exId] });
    }
    return m.sort((a, b) => b.date.localeCompare(a.date));
  }

  if (histView) {
    const ex = sess.exercises.find(e => e.id === histView);
    const entries = getExHistory(histView);
    return (
      <div>
        <div className="hdr">
          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 14 }}>
            <button className="back-btn" onClick={() => setHistView(null)}><Icons.ChevLeft size={13} />BACK</button>
            <span style={{ fontSize: 9, color: "var(--c4)" }}>·</span>
            <span style={{ fontSize: 9, color: "var(--c3)", letterSpacing: ".08em", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex?.name?.toUpperCase()}</span>
          </div>
        </div>
        <div style={{ padding: "0 20px 90px" }}>
          {entries.length === 0
            ? <div style={{ textAlign: "center", padding: "50px 0", fontSize: 11, color: "var(--c4)" }}>No history yet.</div>
            : entries.map(({ date, sets }) => (
              <div className="card" key={date}>
                <div style={{ fontSize: 9, color: "var(--c3)", letterSpacing: ".12em", marginBottom: 12 }}>{fmtDate(date)}</div>
                {Object.entries(sets).map(([si, s]) => (
                  <div key={si} style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 9, color: "var(--c4)", width: 40 }}>SET {parseInt(si) + 1}</span>
                    <span style={{ fontSize: 13, color: "var(--c1)" }}>{s.weight || "—"} {program.units}</span>
                    <span style={{ fontSize: 10, color: "var(--c4)" }}>×</span>
                    <span style={{ fontSize: 13, color: "var(--c1)" }}>{s.reps || "—"} reps</span>
                    {s.rir != null && <span style={{ fontSize: 9, color: "var(--c3)", marginLeft: "auto" }}>RIR {s.rir}</span>}
                  </div>
                ))}
              </div>
            ))}
        </div>
      </div>
    );
  }

  const isCompleted = !!sessions[`${sess.id}__completed`];

  return (
    <div>
      <div className="hdr">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <button className="back-btn" onClick={pauseAndGoBack}><Icons.ChevLeft size={13} />BACK</button>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div className="sess-timer-chip">
              <span className="sess-timer-dot" />
              {fmtSessDur(sessSecs)}
            </div>
            <button className={`ex-timer-chip${timers["rest"]?.running ? " running" : ""}`} onClick={() => setDrawer({ open: true, type: "timer" })}>
              <Icons.Timer size={12} />
              {timers["rest"]?.running ? secsToStr(timers["rest"].secs) : "REST"}
            </button>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingBottom: 14 }}>
          <div>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 22, letterSpacing: ".06em", color: "var(--c1)", lineHeight: 1 }}>{sess.name.toUpperCase()}</div>
            {isCompleted && <span className="lock-badge" style={{ marginTop: 6, display: "inline-flex" }}>🔒 COMPLETED</span>}
          </div>
          <div className="date-pill" onClick={() => setDrawer({ open: true, type: "date" })}>
            <Icons.Calendar size={11} />{fmtDate(sessDate)}
          </div>
        </div>
      </div>

      <div style={{ padding: "0 16px 100px" }}>
        {(() => {
          const lastSessionDate = getLastSessionDate(sessions, sess.id);
          return (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 4px 8px" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <button className="bg-btn" style={{ fontSize: 9, color: "var(--red)" }} onClick={() => setDrawer({ open: true, type: "discard" })}>DISCARD</button>
              </div>
              <div style={{ fontSize: 8, color: "var(--c5)", letterSpacing: ".08em" }}>
                {lastSessionDate ? `LAST ${fmtDate(lastSessionDate).toUpperCase()}` : "—"}
              </div>
              <button className="bp ok" style={{ fontSize: 9, padding: "7px 14px" }} onClick={handleCompleteButton}>COMPLETE SESSION</button>
            </div>
          );
        })()}

        {(() => {
          const baseExercises = exerciseOrder.length === 0 ? sess.exercises : exerciseOrder;
          const allExercises = [...baseExercises, ...sessionAddedExercises];
          return allExercises.length === 0
            ? <div style={{ textAlign: "center", padding: "60px 0", fontSize: 11, color: "var(--c4)", lineHeight: 1.8 }}>No exercises in {sess.name}.<br /><span style={{ color: "var(--c3)" }}>Add them in the SPLIT tab or tap "+ ADD EXERCISE" below.</span></div>
            : (
              <>
              {allExercises.filter(ex => !sessionRemovedExercises.includes(ex.id)).map((ex, exIdx) => {
            const log = getLog();
            const logSets = log[ex.id] || {};
            const totalSets = Math.max(ex.sets, Object.keys(logSets).length);
            const last = getLastLog(ex.id);
            const rx = calcPrescription(ex, last?.sets);
            const hasAnyPR = Object.keys(logSets).some(si => prFlash[`${ex.id}_${si}`]);

            return (
              <div key={ex.id} className={`ex-card${hasAnyPR ? " pr-glow" : ""}${dragIdx === exIdx ? " dragging" : ""}`}
                draggable={exerciseOrder.length > 0}
                onDragStart={e => {
                  dragIdxRef.current = exIdx;
                  setDragIdx(exIdx);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={e => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDragLeave={() => {}}
                onDrop={e => {
                  e.preventDefault();
                  if (dragIdxRef.current === null || dragIdxRef.current === exIdx) return;
                  const newOrder = [...exerciseOrder];
                  const [moved] = newOrder.splice(dragIdxRef.current, 1);
                  newOrder.splice(exIdx, 0, moved);
                  setExerciseOrder(newOrder);
                }}
                onDragEnd={() => {
                  setDragIdx(null);
                  dragIdxRef.current = null;
                }}>
                {rx && (
                  <div className="rx-bar" style={{
                    borderTop: "none",
                    borderBottom: rx.variant === "green" ? "1px solid rgba(74,222,128,.14)" : "1px solid rgba(96,165,250,.12)",
                    background: rx.variant === "green" ? "rgba(74,222,128,.07)" : "rgba(96,165,250,.07)",
                  }}>
                    <div className="rx-lbl" style={rx.variant === "green" ? { color: "var(--green)" } : undefined}>
                      {rx.variant === "green" ? "PROGRESS ↑" : "COACH →"}
                    </div>
                    <div className="rx-val">{rx.tip}</div>
                  </div>
                )}
                <div className="ex-header">
                  {exerciseOrder.length > 0 && (
                    <div className="ex-drag-handle">
                      ⠿
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ex-name">{ex.name}</div>
                    <div className="ex-meta">{ex.sets} sets · {ex.rep_min}–{ex.rep_max} reps</div>
                    {exIdInEdit === ex.id ? (
                      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                        <input
                          type="text"
                          style={{
                            flex: 1,
                            padding: "6px 10px",
                            background: "var(--bg3)",
                            border: "1px solid var(--bdr)",
                            borderRadius: 4,
                            color: "var(--c1)",
                            fontFamily: "'DM Mono',monospace",
                            fontSize: 10
                          }}
                          placeholder="Add a note..."
                          value={editNoteText}
                          onChange={e => setEditNoteText(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && saveNote(ex.id)}
                          autoFocus
                        />
                        <button className="bp" style={{ fontSize: 8, padding: "4px 8px" }} onClick={() => saveNote(ex.id)}>SAVE</button>
                        <button className="bo" style={{ fontSize: 8, padding: "4px 8px" }} onClick={cancelEditNote}>×</button>
                      </div>
                    ) : exNotes[ex.id] ? (
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, fontSize: 10, color: "var(--c2)" }}>
                        <span>{exNotes[ex.id]}</span>
                        <button className="bg-btn" style={{ fontSize: 8, color: "var(--c4)", padding: "8px 10px", minHeight: "44px", minWidth: "44px", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => startEditNote(ex.id)}>✎</button>
                      </div>
                    ) : (
                      <button className="bg-btn" style={{ fontSize: 9, color: "var(--c4)", marginTop: 6, padding: "8px 12px", minHeight: "44px", minWidth: "44px", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => startEditNote(ex.id)}>+ Add note</button>
                    )}
                  </div>
                  <button className="bg-btn" onClick={() => setHistView(ex.id)} style={{ fontSize: 8, color: "var(--c3)", marginLeft: 8 }}>HISTORY</button>
                  <button className="bg-btn" onClick={() => setShowRemoveExConfirm(ex.id)} style={{ fontSize: 10, color: "var(--red)", marginLeft: 4, padding: "4px 6px", minWidth: "auto" }} title="Remove exercise from today's session">🗑</button>
                </div>

                <div className="set-table">
                  <div className="col-lbl-row">
                    <div className="col-lbl">#</div>
                    <div className="col-lbl">WT ({program.units || "lb"})</div>
                    <div className="col-lbl">REPS</div>
                    <div className="col-lbl" style={{ textAlign: "right", paddingRight: 2 }}>LAST</div>
                    <div />
                  </div>

                  {Object.keys(logSets).map((si, idx) => {
                    const d = logSets[si] || { weight: "", reps: "", rir: null };
                    const ls = last?.sets?.[si];
                    const isPR = prFlash[`${ex.id}_${si}`];
                    const hasData = d.weight || d.reps;
                    return (
                      <div key={si}>
                        <div className={`set-row-grid${isPR ? " pr-row" : ""}`}>
                          <div className="set-num">{idx + 1}</div>
                          <input className="si" type="number"
                            placeholder={ls?.weight ? String(ls.weight) : "—"}
                            value={d.weight}
                            onChange={e => updateSet(ex.id, si, "weight", e.target.value)}
                          />
                          <input className="si" type="number"
                            placeholder={ls?.reps ? String(ls.reps) : "—"}
                            value={d.reps}
                            onChange={e => updateSet(ex.id, si, "reps", e.target.value)}
                          />
                          <div className="last-cell">
                            {isPR && <span className="pr-badge">🏆 PR</span>}
                            {getProgArrow(ex.id, idx)}
                            {ls?.weight
                              ? <span className="last-val">{ls.weight}×{ls.reps}</span>
                              : <span style={{ fontSize: 9, color: "var(--c5)" }}>—</span>}
                          </div>
                        </div>
                        {hasData && (
                          <div className="rir-row">
                            <span className="rir-lbl">RIR</span>
                            {[0, 1, 2, 3, 4].map(n => (
                              <button key={n} className={`rchip${d.rir === n ? " sel" : ""}`}
                                onClick={() => updateRir(ex.id, si, d.rir === n ? null : n)}>{n}</button>
                            ))}
                            <button className={`rchip skip${d.rir === null ? " sel" : ""}`}
                              onClick={() => updateRir(ex.id, si, null)}>SKIP</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="set-footer">
                  <button
                    className="bg-btn"
                    style={{
                      fontSize: 9,
                      color: totalSets <= 1 ? "var(--c5)" : "var(--c3)",
                      cursor: totalSets <= 1 ? "default" : "pointer",
                      opacity: totalSets <= 1 ? 0.35 : 1
                    }}
                    onClick={() => {
                      if (totalSets <= 1) return;
                      const keys = Object.keys(logSets).map(k => parseInt(k)).sort((a, b) => a - b);
                      const lastKey = keys[keys.length - 1];
                      setSessions(p => {
                        const k = logKey(sess.id, sessDate);
                        const next = JSON.parse(JSON.stringify(p));
                        if (next[k]?.[ex.id]?.[String(lastKey)]) {
                          delete next[k][ex.id][String(lastKey)];
                        }
                        return next;
                      });
                    }}
                    disabled={totalSets <= 1}
                  >- SET</button>
                  <div />
                  <button
                    className="bg-btn"
                    style={{ fontSize: 9, color: "var(--c3)" }}
                    onClick={() => {
                      if (totalSets >= 8) { showToast("MAX 8 SETS"); return; }
                      const nextKey = Object.keys(logSets).length;
                      setSessions(p => {
                        const k = logKey(sess.id, sessDate);
                        const next = JSON.parse(JSON.stringify(p));
                        if (!next[k]) next[k] = {};
                        if (!next[k][ex.id]) next[k][ex.id] = {};
                        next[k][ex.id][String(nextKey)] = { weight: "", reps: "", rir: null };
                        return next;
                      });
                      showToast("SET ADDED");
                    }}
                  >+ SET</button>
                </div>
              </div>
            );
          })}
              <button className="bp" style={{ width: "100%", marginTop: 16, fontSize: 11, padding: "12px 16px" }} onClick={() => setDrawer({ open: true, type: "add_session_ex" })}>+ ADD EXERCISE</button>
              </>
            );
        })()}
      </div>

      <Drawer open={drawer.open} onClose={() => setDrawer({ open: false })}>
{drawer.type === "timer" && (
          <TimerDrawer
            exId="rest"
            currentDur={restDuration}
            onSet={(_, secs) => {
              setRestDuration(secs);
              try { localStorage.setItem(SK_REST, String(secs)); } catch {}
              setDrawer({ open: false });
            }}
            onStart={(_, secs) => {
              setRestDuration(secs);
              try { localStorage.setItem(SK_REST, String(secs)); } catch {}
              startTimer("rest", secs);
              showToast(`TIMER: ${secsToStr(secs)}`, "tg");
              setDrawer({ open: false });
            }}
            onReset={() => resetTimer("rest")}
            timerState={timers["rest"]}
          />
        )}

        {drawer.type === "discard" && (
          <div>
            <div className="drw-title">DISCARD WORKOUT?</div>
            <div style={{ fontSize: 12, color: "var(--c2)", lineHeight: 1.7, marginBottom: 24 }}>
              This will delete all logged sets for this session and cannot be undone. Are you sure?
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="bo" style={{ flex: 1 }} onClick={() => setDrawer({ open: false })}>CANCEL</button>
              <button className="bp" style={{ flex: 2, background: "var(--red)", borderColor: "var(--red)" }} onClick={discardSession}>DISCARD →</button>
            </div>
          </div>
        )}

{drawer.type === "add_session_ex" && (
          <ExForm
            initial={{}}
            onSave={(newEx) => {
              const exWithId = { ...newEx, id: `ex_${uid()}`, order_index: sessionAddedExercises.length };
              setSessionAddedExercises([...sessionAddedExercises, exWithId]);
              setSessions(p => {
                const k = logKey(sess.id, sessDate);
                const next = JSON.parse(JSON.stringify(p));
                if (!next[k]) next[k] = {};
                if (!next[k][exWithId.id]) {
                  next[k][exWithId.id] = {};
                  for (let i = 0; i < (exWithId.sets || 0); i++) {
                    next[k][exWithId.id][String(i)] = { weight: "", reps: "", rir: null };
                  }
                }
                return next;
              });
              setDrawer({ open: false });
              showToast("EXERCISE ADDED");
            }}
            program={program}
          />
        )}

{drawer.type === "date" && (
          <div>
            <div className="drw-title">TRAINING DATE</div>
            <div className="drw-sub">PICK THE DAY YOU TRAINED</div>
            <div className="fld">
              <span className="lbl">DATE</span>
              <input type="date" className="ti" defaultValue={sessDate} max={todayISO()}
                onChange={e => {
                  if (e.target.value > todayISO()) { showToast("DATE CAN'T BE IN THE FUTURE"); return; }
                  setSessions(p => {
                    const newDate = e.target.value;
                    const oldDate = p[`${sess.id}__date`] || todayISO();
                    const oldLogKey = `${sess.id}__${oldDate}`;
                    const newLogKey = `${sess.id}__${newDate}`;
                    const next = { ...p };

                    // Preserve any logged data from the old date
                    const oldLog = next[oldLogKey] || {};

                    // Delete old date's log entry completely
                    delete next[oldLogKey];

                    // Delete old date's completion marker completely
                    delete next[`${sess.id}__done__${oldDate}`];

                    // Update date pointer to new date
                    next[`${sess.id}__date`] = newDate;

                    // Create or preserve new date's log entry, migrating old data
                    if (!next[newLogKey]) {
                      next[newLogKey] = { ...oldLog };
                    }

                    // Initialize any missing exercise entries in the new date's log
                    const allExercises = [...sess.exercises, ...sessionAddedExercises];
                    for (const ex of allExercises) {
                      if (!next[newLogKey][ex.id]) {
                        next[newLogKey][ex.id] = {};
                        for (let i = 0; i < (ex.sets || 0); i++) {
                          next[newLogKey][ex.id][String(i)] = { weight: "", reps: "", rir: null };
                        }
                      }
                    }

                    return next;
                  });
                }} />
            </div>
            <button className="bp" style={{ width: "100%" }} onClick={() => { setDrawer({ open: false }); showToast("DATE UPDATED"); }}>DONE →</button>
          </div>
        )}
      </Drawer>

      {showChangeConfirm && (
        <>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 85 }} onClick={() => setShowChangeConfirm(false)} />
          <div style={{ position: "fixed", inset: 0, zIndex: 86, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
            <div style={{ background: "var(--bg2)", borderRadius: "var(--r)", border: "1px solid var(--bdr)", maxWidth: 320, padding: "24px", textAlign: "center" }}>
              <div style={{ fontSize: 13, fontFamily: "'Bebas Neue'", letterSpacing: ".06em", color: "var(--c1)", marginBottom: 16 }}>
                YOU MADE CHANGES TO YOUR EXERCISES
              </div>
              <div style={{ fontSize: 11, color: "var(--c3)", lineHeight: 1.6, marginBottom: 20 }}>
                Would you like to update these changes for future sessions?
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="bo" style={{ flex: 1, fontSize: 9 }} onClick={() => {
                  const currentSessDate = sessions[`${sess.id}__date`] || todayISO();
                  setShowChangeConfirm(false);
                  completeSession(currentSessDate);
                }}>NO, THIS SESSION ONLY</button>
                <button className="bp" style={{ flex: 1, fontSize: 9 }} onClick={() => {
                  const currentSessDate = sessions[`${sess.id}__date`] || todayISO();
                  setShowChangeConfirm(false);
                  updateProgramWithChanges(currentSessDate);
                  completeSession(currentSessDate);
                }}>YES, UPDATE →</button>
              </div>
            </div>
          </div>
        </>
      )}

      {showRemoveExConfirm && (
        <>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 85 }} onClick={() => setShowRemoveExConfirm(null)} />
          <div style={{ position: "fixed", inset: 0, zIndex: 86, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
            <div style={{ background: "var(--bg2)", borderRadius: "var(--r)", border: "1px solid var(--bdr)", maxWidth: 320, padding: "24px", textAlign: "center" }}>
              <div style={{ fontSize: 13, fontFamily: "'Bebas Neue'", letterSpacing: ".06em", color: "var(--c1)", marginBottom: 16 }}>
                REMOVE THIS EXERCISE?
              </div>
              <div style={{ fontSize: 11, color: "var(--c3)", lineHeight: 1.6, marginBottom: 20 }}>
                Remove this exercise from today's session?
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="bo" style={{ flex: 1, fontSize: 9 }} onClick={() => setShowRemoveExConfirm(null)}>CANCEL</button>
                <button className="bp" style={{ flex: 1, fontSize: 9, background: "var(--red)", borderColor: "var(--red)" }} onClick={() => {
                  setSessionRemovedExercises([...sessionRemovedExercises, showRemoveExConfirm]);
                  setShowRemoveExConfirm(null);
                  showToast("EXERCISE REMOVED");
                }}>REMOVE</button>
              </div>
            </div>
          </div>
        </>
      )}

      {showSaveOrderPrompt && (
        <>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 85 }} onClick={() => setShowSaveOrderPrompt(false)} />
          <div style={{ position: "fixed", inset: 0, zIndex: 86, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
            <div style={{ background: "var(--bg2)", borderRadius: "var(--r)", border: "1px solid var(--bdr)", maxWidth: 320, padding: "24px", textAlign: "center" }}>
              <div style={{ fontSize: 13, fontFamily: "'Bebas Neue'", letterSpacing: ".06em", color: "var(--c1)", marginBottom: 16 }}>
                YOU REORDERED YOUR EXERCISES
              </div>
              <div style={{ fontSize: 11, color: "var(--c3)", lineHeight: 1.6, marginBottom: 20 }}>
                Save this new order for future sessions?
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="bo" style={{ flex: 1, fontSize: 9 }} onClick={() => {
                  const currentSessDate = sessions[`${sess.id}__date`] || todayISO();
                  completeSession(currentSessDate);
                }}>THIS SESSION ONLY</button>
                <button className="bp" style={{ flex: 1, fontSize: 9 }} onClick={() => {
                  const currentSessDate = sessions[`${sess.id}__date`] || todayISO();
                  saveExerciseOrderToSplit();
                  completeSession(currentSessDate);
                }}>YES, SAVE ORDER →</button>
              </div>
            </div>
          </div>
        </>
      )}

    </div>
  );
}

function TimerDrawer({ exId, exName, currentDur, onStart, onSet, onReset, timerState }) {
  const [inputVal, setInputVal] = useState(secsToStr(currentDur || 90));
  const [inputErr, setInputErr] = useState("");
  const [customSecs, setCustomSecs] = useState(currentDur || 90);
  const presets = [[30, "30s"], [60, "1:00"], [90, "1:30"], [120, "2:00"], [150, "2:30"], [180, "3:00"], [240, "4:00"]];
  const running = timerState?.running;
  const secs = timerState?.secs || 0;
  const total = timerState?.total || 0;

  // Sync internal state with currentDur prop when drawer opens/props change
  useEffect(() => {
    const dur = currentDur || 90;
    setCustomSecs(dur);
    setInputVal(secsToStr(dur));
    setInputErr("");
  }, [currentDur]);

  function applyInput() {
    const s = parseSecs(inputVal);
    if (!s) { setInputErr("Enter 10s to 10:00."); return; }
    setInputErr(""); setCustomSecs(s); setInputVal(secsToStr(s));
  }

  return (
    <div>
      <div className="drw-title">REST TIMER</div>
      {exName && <div className="drw-sub">{exName.toUpperCase()}</div>}
      <div style={{ textAlign: "center", padding: "20px 0" }}>
        <div style={{ fontSize: 64, fontFamily: "'Bebas Neue'", letterSpacing: ".08em", color: running && secs > 0 ? "var(--green)" : secs === 0 && total > 0 ? "var(--amber)" : "var(--c1)", lineHeight: 1 }}>
          {secsToStr(running || total > 0 ? secs : customSecs)}
        </div>
        {total > 0 && (
          <div style={{ background: "rgba(74,222,128,.12)", borderRadius: 4, height: 5, width: "80%", margin: "14px auto 0" }}>
            <div style={{ height: "100%", borderRadius: 4, background: "var(--green)", width: `${Math.round(secs / total * 100)}%`, transition: "width 1s linear" }} />
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", marginBottom: 16 }}>
        {presets.map(([s, l]) => (
          <button key={s} className={`bo${customSecs === s ? " sel" : ""}`} style={{ padding: "6px 10px", fontSize: 9 }}
            onClick={() => { setCustomSecs(s); setInputVal(secsToStr(s)); }}>{l}</button>
        ))}
      </div>
      <div className="fld">
        <span className="lbl">CUSTOM (mm:ss or seconds)</span>
        <input className="ti" placeholder="e.g. 2:30 or 150" value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onBlur={applyInput}
          onKeyDown={e => e.key === "Enter" && applyInput()} />
        {inputErr && <div className="err">{inputErr}</div>}
        <div className="helper">Min 10s · Max 10:00</div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="bo" style={{ flex: 1 }} onClick={() => onSet(exId, customSecs)}>
          SET TIMER
        </button>
        <button className="bp" style={{ flex: 1 }} onClick={() => onStart(exId, customSecs)}>
          {running ? "RESTART" : "START"} TIMER
        </button>
        <button className="bo" style={{ flex: 1 }} onClick={() => onReset(exId)}>RESET</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// CALENDAR PAGE
// ══════════════════════════════════════════════
function CalendarPage({ program, sessions, setSessions }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [sheet, setSheet] = useState(null);
  const [editDateSess, setEditDateSess] = useState(null);
  const [editDateValue, setEditDateValue] = useState("");
  const [deleteSess, setDeleteSess] = useState(null);
  const days = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay();
  const todayIso = todayISO();
  const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  function calcSessionSets(sessId, iso) {
    const log = sessions[`${sessId}__${iso}`] || {};
    let setCount = 0;
    for (const exSets of Object.values(log)) {
      setCount += Object.keys(exSets).length;
    }
    return setCount;
  }

  function handleDeleteSession(sessId, iso) {
    const newSessions = { ...sessions };
    delete newSessions[`${sessId}__${iso}`];
    delete newSessions[`${sessId}__done__${iso}`];
    setSessions(newSessions);
    try { localStorage.setItem(SK_S, JSON.stringify(newSessions)); } catch {}
    setSheet(null);
    setDeleteSess(null);
  }

  function handleEditDate(sessId, oldIso, newIso) {
    if (newIso > todayIso) return;
    const newSessions = { ...sessions };
    const log = newSessions[`${sessId}__${oldIso}`];
    const done = newSessions[`${sessId}__done__${oldIso}`];
    if (log) {
      delete newSessions[`${sessId}__${oldIso}`];
      newSessions[`${sessId}__${newIso}`] = log;
    }
    if (done) {
      delete newSessions[`${sessId}__done__${oldIso}`];
      newSessions[`${sessId}__done__${newIso}`] = done;
    }
    setSessions(newSessions);
    try { localStorage.setItem(SK_S, JSON.stringify(newSessions)); } catch {}
    setEditDateSess(null);
    setSheet(null);
  }

  function getSessForDate(iso) {
    // Get all unique session IDs from logs (including historical sessions from previous programs)
    const allSessIds = new Set();
    for (const key of Object.keys(sessions)) {
      if (key.includes("__")) {
        const sessId = key.split("__")[0];
        if (/^\d{4}-\d{2}-\d{2}$/.test(key.split("__")[1])) {
          allSessIds.add(sessId);
        }
      }
    }

    // Build session list from current program + any historical sessions
    const sessForDate = [];

    // First add current program sessions
    if (program?.sessions) {
      for (const s of program.sessions) {
        if (getSessionDates(sessions, s.id).has(iso)) {
          sessForDate.push({
            sess: s,
            completed: sessions[`${s.id}__done__${iso}`] === "1" || sessions[`${s.id}__completed`] === iso,
          });
          allSessIds.delete(s.id);
        }
      }
    }

    // Then add any historical sessions not in current program
    for (const sessId of allSessIds) {
      if (getSessionDates(sessions, sessId).has(iso)) {
        sessForDate.push({
          sess: { id: sessId, name: "PREVIOUS" },  // Historical session placeholder
          completed: sessions[`${sessId}__done__${iso}`] === "1" || sessions[`${sessId}__completed`] === iso,
        });
      }
    }

    return sessForDate;
  }

  function prev() { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); }
  function next() { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); }

  return (
    <div>
      <div className="hdr">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 14 }}>
          <div className="wm">CALENDAR</div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button className="ib" onClick={prev}><Icons.ChevLeft /></button>
            <span style={{ fontSize: 10, color: "var(--c2)", letterSpacing: ".06em", minWidth: 110, textAlign: "center" }}>{fmtMonthYear(year, month)}</span>
            <button className="ib" onClick={next}><Icons.ChevRight /></button>
          </div>
        </div>
      </div>
      <div style={{ padding: "12px 14px 90px" }}>
        <div className="cal-grid" style={{ marginBottom: 6 }}>
          {DOW.map(d => <div key={d} style={{ textAlign: "center", fontSize: 9, color: "var(--c4)", padding: "4px 0", letterSpacing: ".06em" }}>{d}</div>)}
        </div>
        <div className="cal-grid">
          {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: days }).map((_, i) => {
            const day = i + 1;
            const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const shown = getSessForDate(iso);
            const isToday = iso === todayIso;
            return (
              <div key={day} className={`cal-day${isToday ? " today" : ""}${shown.length > 0 ? " has-session" : ""}`}
                onClick={() => shown.length > 0 && setSheet({ iso, sessions: shown })}>
                <div className="day-num">{day}</div>
                {shown.slice(0, 2).map((s, i) => (
                  <div key={i}>
                    <div className="cal-dot" style={{ background: "var(--green)" }} />
                    <div className="cal-label">{s.sess.name}</div>
                  </div>
                ))}
                {shown.length > 2 && <div style={{ fontSize: 7, color: "var(--c3)" }}>+{shown.length - 2}</div>}
              </div>
            );
          })}
        </div>
      </div>
      {sheet && (
        <>
          <div className="drw-ov open" onClick={() => setSheet(null)} />
          <div className="drw open">
            <div className="drw-h" />
            <div className="drw-title">{fmtDate(sheet.iso).toUpperCase()}</div>
            {sheet.sessions.map(({ sess }) => {
              const sets = calcSessionSets(sess.id, sheet.iso);
              return (
                <div className="card" key={sess.id} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 13, color: "var(--c1)" }}>{sess.name}</span>
                    <span className="pill pg-p">COMPLETED</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--c2)", letterSpacing: ".06em", marginBottom: 12, fontFamily: "'Bebas Neue'" }}>
                    {sets} SETS
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="bo" style={{ flex: 1, fontSize: 8 }} onClick={() => { setEditDateSess({ sessId: sess.id, iso: sheet.iso }); setEditDateValue(sheet.iso); }}>EDIT DATE</button>
                    <button className="bo" style={{ flex: 1, fontSize: 8, color: "var(--red)" }} onClick={() => setDeleteSess({ sessId: sess.id, iso: sheet.iso })}>DELETE</button>
                  </div>
                </div>
              );
            })}
            <button className="bg-btn" style={{ marginTop: 14 }} onClick={() => setSheet(null)}>CLOSE ×</button>
          </div>
        </>
      )}

      {editDateSess && (
        <Drawer open={true} onClose={() => setEditDateSess(null)}>
          <div>
            <div className="drw-title">EDIT DATE</div>
            <div className="drw-sub">CHANGE THIS SESSION'S DATE</div>
            <div className="fld">
              <span className="lbl">DATE</span>
              <input type="date" className="ti" value={editDateValue} max={todayIso}
                onChange={e => setEditDateValue(e.target.value)} />
            </div>
            <button className="bp" style={{ width: "100%", marginTop: 16 }} onClick={() => {
              if (editDateValue > todayIso) return;
              if (editDateValue === editDateSess.iso) {
                setEditDateSess(null);
                return;
              }
              handleEditDate(editDateSess.sessId, editDateSess.iso, editDateValue);
            }}>UPDATE DATE →</button>
          </div>
        </Drawer>
      )}

      {deleteSess && (
        <>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 85 }} onClick={() => setDeleteSess(null)} />
          <div style={{ position: "fixed", inset: 0, zIndex: 86, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
            <div style={{ background: "var(--bg2)", borderRadius: "var(--r)", border: "1px solid var(--bdr)", maxWidth: 320, padding: "24px", textAlign: "center" }}>
              <div style={{ fontSize: 13, fontFamily: "'Bebas Neue'", letterSpacing: ".06em", color: "var(--c1)", marginBottom: 16 }}>
                DELETE SESSION?
              </div>
              <div style={{ fontSize: 11, color: "var(--c3)", lineHeight: 1.6, marginBottom: 20 }}>
                Are you sure? This will permanently delete this session and all its data.
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="bo" style={{ flex: 1, fontSize: 9 }} onClick={() => setDeleteSess(null)}>CANCEL</button>
                <button className="bp" style={{ flex: 1, fontSize: 9, background: "var(--red)", borderColor: "var(--red)" }} onClick={() => handleDeleteSession(deleteSess.sessId, deleteSess.iso)}>DELETE →</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════
// PROGRESS PAGE
// ══════════════════════════════════════════════
function ProgressPage({ program, sessions, dupPref = "combined" }) {
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState(null);
  const [metric, setMetric] = useState("e1rm");
  const [range, setRange] = useState("8w");
  const [sessionFilter, setSessionFilter] = useState("all");

  if (!program?.sessions?.length) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: 30, fontFamily: "'Bebas Neue'", letterSpacing: ".06em", color: "var(--c4)", marginBottom: 12 }}>NO DATA YET</div>
        <div style={{ fontSize: 11, color: "var(--c4)", lineHeight: 1.8 }}>Log a session to see progress.</div>
      </div>
    );
  }

  function buildMergedData() {
    // dupPref comes from root App state — changes in Settings propagate here immediately
    const dupNormed = new Set(findDuplicateExNames(program));
    const currentProgName = program?.name || "Current Program";

    const nameGroups = {};

    // First, add exercises from current program
    for (const sess of program?.sessions || []) {
      for (const ex of sess.exercises) {
        const normed = normalizeName(ex.name);
        const isByDay = dupPref === "by_day" && dupNormed.has(normed);
        const key = isByDay ? ex.id : normed;
        if (!nameGroups[key]) {
          const displayName = isByDay ? `${ex.name} (${sess.name})` : ex.name;
          nameGroups[key] = { displayName, exIds: [], sessionsUsed: [], normed: key, programName: currentProgName, isCurrentProgram: true };
        }
        if (!nameGroups[key].exIds.includes(ex.id)) nameGroups[key].exIds.push(ex.id);
        if (!nameGroups[key].sessionsUsed.includes(sess.name)) nameGroups[key].sessionsUsed.push(sess.name);
        if (!isByDay && ex.name.length > nameGroups[key].displayName.length) nameGroups[key].displayName = ex.name;
      }
    }

    // Then, add exercises from historical sessions (not in current program)
    for (const [k, log] of Object.entries(sessions)) {
      if (k.includes("__date") || k.includes("__completed") || !k.includes("__")) continue;
      const sessId = k.split("__")[0];
      const sessObj = program?.sessions?.find(s => s.id === sessId);
      if (sessObj) continue;  // Skip if already in current program

      // This is a historical session, extract exercise data from logs
      for (const exId of Object.keys(log)) {
        const savedName = getExerciseName(exId);
        const savedProgram = getExerciseProgram(exId);

        // Only add if there's a valid saved name; skip phantom/invalid exercises
        if (!isValidExerciseName(savedName)) continue;

        if (!nameGroups[exId]) {
          nameGroups[exId] = { displayName: savedName, exIds: [exId], sessionsUsed: ["PREVIOUS"], normed: exId, programName: savedProgram, isCurrentProgram: false };
        }
        if (!nameGroups[exId].exIds.includes(exId)) nameGroups[exId].exIds.push(exId);
        if (!nameGroups[exId].sessionsUsed.includes("PREVIOUS")) nameGroups[exId].sessionsUsed.push("PREVIOUS");
      }
    }

    const result = {};
    for (const [key, group] of Object.entries(nameGroups)) {
      result[key] = { ...group, points: [] };
    }

    for (const [k, log] of Object.entries(sessions)) {
      if (k.includes("__date") || k.includes("__completed") || !k.includes("__")) continue;
      const date = k.split("__")[1];
      if (!date) continue;
      const sessId = k.split("__")[0];
      const sessObj = program.sessions.find(s => s.id === sessId);
      const sessName = sessObj?.name || "Unknown";

      for (const [exId, sets] of Object.entries(log)) {
        const group = Object.values(result).find(g => g.exIds.includes(exId));
        if (!group) continue;
        let bestE1rm = 0, topLoad = 0, bestReps = 0;
        let totalSets = 0;
        for (const s of Object.values(sets)) {
          if (s.weight && s.reps) {
            totalSets++;
            const e1rm = e1rmCalc(s.weight, s.reps);
            const w = parseFloat(s.weight);
            if (e1rm > bestE1rm) {
              bestE1rm = e1rm;
              topLoad = w;
              bestReps = parseInt(s.reps);
            } else if (w > topLoad) {
              topLoad = w;
              bestReps = parseInt(s.reps);
            }
          }
        }
        if (bestE1rm > 0) {
          group.points.push({ date, e1rm: bestE1rm, topLoad, bestReps, totalSets, sessName });
        }
      }
    }

    return Object.values(result).map(group => {
      group.points.sort((a, b) => a.date.localeCompare(b.date));
      const spark = group.points.map(p => p.e1rm);
      const status = calcStatus(spark);
      const delta = spark.length >= 2 ? +((spark[spark.length - 1] - spark[0]) / spark[0] * 100).toFixed(1) : 0;
      const lastDate = group.points.length > 0 ? group.points[group.points.length - 1].date : null;
      const multiSession = group.sessionsUsed.length > 1;
      return { ...group, spark, status, delta, lastDate, currentE1rm: spark[spark.length - 1] || 0, multiSession };
    });
  }

  const allGroups = buildMergedData();
  const filtered = allGroups
    .filter(g => g.displayName.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const hasAny = allGroups.some(g => g.points.length > 0);

  if (detail) {
    const group = allGroups.find(g => g.normed === detail);
    if (!group) { setDetail(null); return null; }

    const filteredPts = group.points.filter(p => {
      const sessOk = sessionFilter === "all" || p.sessName === sessionFilter;
      return sessOk;
    });

    const spark = filteredPts.map(p => p.e1rm);
    const status = calcStatus(spark);
    const delta = spark.length >= 2 ? +((spark[spark.length - 1] - spark[0]) / spark[0] * 100).toFixed(1) : 0;
    const sColor = statusColor(status);

    return (
      <div>
        <div className="hdr">
          <button className="back-btn" onClick={() => { setDetail(null); setSessionFilter("all"); }}><Icons.ChevLeft size={13} />BACK</button>
          <div style={{ fontFamily: "'Bebas Neue'", fontSize: 26, letterSpacing: ".06em", color: "var(--c1)", lineHeight: 1, marginTop: 12, marginBottom: 8 }}>{group.displayName.toUpperCase()}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", paddingBottom: 14 }}>
            <span className={`pill ${statusPillClass(status)}`}>{status.toUpperCase()}</span>
            <span style={{ fontSize: 11, color: sColor }}>{delta > 0 ? "+" : ""}{delta}%</span>
            {group.multiSession && (
              <span style={{ fontSize: 8, color: "var(--blue)", background: "rgba(96,165,250,.1)", padding: "2px 8px", borderRadius: 3, letterSpacing: ".06em" }}>
                COMBINED · {group.sessionsUsed.length} SESSIONS
              </span>
            )}
          </div>

          {group.multiSession && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 8, color: "var(--c4)", letterSpacing: ".12em", marginBottom: 8 }}>FILTER BY SESSION</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className={`bo${sessionFilter === "all" ? " sel" : ""}`} style={{ fontSize: 8, padding: "4px 10px" }} onClick={() => setSessionFilter("all")}>ALL SESSIONS COMBINED</button>
                {group.sessionsUsed.map(sn => (
                  <button key={sn} className={`bo${sessionFilter === sn ? " sel" : ""}`} style={{ fontSize: 8, padding: "4px 10px" }} onClick={() => setSessionFilter(sn)}>{sn}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: "0 20px 90px" }}>
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 8, color: "var(--c4)", letterSpacing: ".12em", marginBottom: 12 }}>
              PROGRESS TREND
              {sessionFilter !== "all" && <span style={{ color: "var(--blue)", marginLeft: 8 }}>· {sessionFilter}</span>}
            </div>
            {spark.length < 2
              ? <div style={{ fontSize: 10, color: "var(--c4)", textAlign: "center", padding: "20px 0" }}>Not enough data for this range.</div>
              : <>
                <Sparkline data={spark} color={sColor} w={300} h={70} dots={true} />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                  <span style={{ fontSize: 8, color: "var(--c5)" }}>{fmtDate(filteredPts[0]?.date)}</span>
                  <span style={{ fontSize: 8, color: "var(--c5)" }}>{fmtDate(filteredPts[filteredPts.length - 1]?.date)}</span>
                </div>
              </>}
          </div>

          <div style={{ fontSize: 9, color: "var(--c4)", letterSpacing: ".12em", marginBottom: 10 }}>SESSION LOG</div>
          {filteredPts.length === 0
            ? <div style={{ fontSize: 10, color: "var(--c4)", textAlign: "center", padding: "20px 0" }}>No history yet.</div>
            : filteredPts.slice().reverse().slice(0, 10).map((p, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--bdr)" }}>
                <span style={{ fontSize: 10, color: "var(--c3)", letterSpacing: ".06em" }}>{fmtDate(p.date)}</span>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--c2)" }}>
                    <span style={{ fontSize: 8, color: "var(--c4)", letterSpacing: ".05em" }}>BEST SET</span>
                    <span>{Math.round(p.topLoad)}{program.units || "lb"} × {p.bestReps} reps</span>
                  </div>
                  <span style={{ fontSize: 10, color: "var(--c3)" }}>{p.totalSets} sets</span>
                </div>
              </div>
            ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="hdr">
        <div style={{ marginBottom: 12 }}>
          <div className="wm">PROGRESS</div>
          <div className="wm-sub">EXERCISE TRENDS · LONG-TERM VIEW</div>
        </div>
        <div style={{ position: "relative", marginBottom: 12 }}>
          <div style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--c4)", pointerEvents: "none", display: "flex" }}>
            <Icons.Search />
          </div>
          <input className="ti" style={{ paddingLeft: 34 }} placeholder="Find an exercise…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div style={{ padding: "0 20px 90px" }}>
        {allGroups.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", fontSize: 11, color: "var(--c4)" }}>No exercises in your program yet. Add exercises to start tracking progress.</div>
        ) : (
          <>
            {hasAny && (
              <div className="kg" style={{ marginTop: 14 }}>
                <div className="kpi"><div className="kv">{countAllCompletedSessions(program, sessions)}</div><div className="kl">TOTAL SESSIONS</div></div>
                <div className="kpi"><div className="kv">{allGroups.length}</div><div className="kl">EXERCISES TRACKED</div></div>
              </div>
            )}

            <div style={{ fontSize: 9, color: "var(--c3)", letterSpacing: ".12em", marginBottom: 10, marginTop: hasAny ? 14 : 0 }}>
              {filtered.length} EXERCISE{filtered.length !== 1 ? "S" : ""}
            </div>

            {filtered.map(group => {
          const sc = statusColor(group.status);
          return (
            <div key={group.normed} className="prog-row" onClick={() => { setDetail(group.normed); setSessionFilter("all"); }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="prog-name">{group.displayName}</div>
                {!group.isCurrentProgram && group.programName && (
                  <div style={{ fontSize: 8, color: "var(--c4)", marginTop: 2, letterSpacing: ".05em" }}>From: {group.programName}</div>
                )}
                <div style={{ display: "flex", gap: 7, marginTop: 4, alignItems: "center", flexWrap: "wrap" }}>
                  {group.points.length > 0
                    ? <>
                      <span className={`pill ${statusPillClass(group.status)}`}>{group.status.toUpperCase()}</span>
                      <span style={{ fontSize: 8, color: "var(--c4)" }}>{group.lastDate ? fmtDate(group.lastDate) : "—"}</span>
                      {group.delta !== 0 && <span style={{ fontSize: 9, color: sc }}>{group.delta > 0 ? "+" : ""}{group.delta}%</span>}
                      {group.multiSession && <span style={{ fontSize: 7, color: "var(--blue)", letterSpacing: ".06em" }}>· {group.sessionsUsed.length} SESSIONS</span>}
                    </>
                    : <span style={{ fontSize: 9, color: "var(--c5)" }}>No data yet</span>}
                </div>
              </div>
              {group.spark.length >= 2
                ? <Sparkline data={group.spark} color={group.points.length > 0 ? sc : "#333"} w={90} h={36} />
                : <div style={{ width: 90, height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontSize: 9, color: "var(--c5)" }}>—</span></div>}
            </div>
          );
        })}
          </>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// USER SETUP FORM
// ══════════════════════════════════════════════
function UserSetupForm({ onSuccess, showToast }) {
  const [form, setForm] = useState({ name: "", age: "", weight: "", wUnit: "lb", heightFt: "", heightIn: "", height: "", hUnit: "ftin" });
  const [errs, setErrs] = useState({});
  const up = f => v => setForm(p => ({ ...p, [f]: v }));

  function submit() {
    const e = {};
    if (!form.name.trim()) e.name = "Name required.";
    const age = parseInt(form.age);
    if (!form.age || isNaN(age) || age < 13 || age > 90) e.age = "Enter age 13–90.";
    const w = parseFloat(form.weight);
    const wMin = form.wUnit === "lb" ? 30 : 14, wMax = form.wUnit === "lb" ? 500 : 227;
    if (!form.weight || isNaN(w) || w < wMin || w > wMax) e.weight = `Enter ${wMin}–${wMax} ${form.wUnit}.`;
    if (form.hUnit === "ftin") {
      const tot = (parseInt(form.heightFt) || 0) * 12 + (parseInt(form.heightIn) || 0);
      if (tot < 48 || tot > 90) e.height = "Enter 4'0\"–7'6\".";
    } else {
      const cm = parseInt(form.height);
      if (!form.height || isNaN(cm) || cm < 122 || cm > 230) e.height = "Enter 122–230 cm.";
    }
    if (Object.keys(e).length) { setErrs(e); return; }
    try {
      localStorage.setItem(SK_U, JSON.stringify(form));
      showToast("Profile saved!", "tg");
      onSuccess();
    } catch { setErrs({ general: "Something went wrong." }); }
  }

  return (
    <div className="auth-screen">
      <div className="setup-header">
        <div className="setup-title">TELL US ABOUT YOU</div>
        <div className="setup-sub">Helps personalise your experience</div>
      </div>
      <div className="auth-body">
        <div className="fld">
          <label className="lbl">NAME</label>
          <input className="ti" type="text" value={form.name} onChange={e => up("name")(e.target.value)} placeholder="Your name" />
          {errs.name && <div className="err">{errs.name}</div>}
        </div>
        <div className="fld">
          <label className="lbl">AGE</label>
          <input className="ti" type="number" value={form.age} onChange={e => up("age")(e.target.value)} placeholder="e.g. 25" />
          {errs.age && <div className="err">{errs.age}</div>}
        </div>
        <div className="fld">
          <label className="lbl">WEIGHT</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="ti" type="number" value={form.weight} onChange={e => up("weight")(e.target.value)} placeholder={form.wUnit === "lb" ? "e.g. 175" : "e.g. 80"} style={{ flex: 1 }} />
            <div className="unit-toggle">
              {["lb", "kg"].map(u => <button key={u} className={`unit-btn${form.wUnit === u ? " act" : ""}`} onClick={() => up("wUnit")(u)}>{u}</button>)}
            </div>
          </div>
          {errs.weight && <div className="err">{errs.weight}</div>}
        </div>
        <div className="fld">
          <label className="lbl">HEIGHT</label>
          <div style={{ display: "flex", gap: 8 }}>
            {form.hUnit === "ftin"
              ? <><input className="ti" type="number" value={form.heightFt} onChange={e => up("heightFt")(e.target.value)} placeholder="ft" style={{ flex: 1 }} /><input className="ti" type="number" value={form.heightIn} onChange={e => up("heightIn")(e.target.value)} placeholder="in" style={{ flex: 1 }} /></>
              : <input className="ti" type="number" value={form.height} onChange={e => up("height")(e.target.value)} placeholder="cm" style={{ flex: 1 }} />}
            <div className="unit-toggle">
              {[["ftin", "ft/in"], ["cm", "cm"]].map(([u, l]) => <button key={u} className={`unit-btn${form.hUnit === u ? " act" : ""}`} onClick={() => up("hUnit")(u)}>{l}</button>)}
            </div>
          </div>
          {errs.height && <div className="err">{errs.height}</div>}
        </div>
        {errs.general && <div className="err" style={{ marginBottom: 12 }}>{errs.general}</div>}
        <button className="bp" style={{ width: "100%", marginTop: 8 }} onClick={submit}>CONTINUE →</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// PROFILE PAGE
// ══════════════════════════════════════════════
function ProfilePage({ onBack }) {
  const [expanded, setExpanded] = useState({ personal: true, physical: true });
  const [data, setData] = useState(() => {
    try {
      const acc = JSON.parse(localStorage.getItem(SK_ACCOUNT) || "{}");
      const u = JSON.parse(localStorage.getItem(SK_U) || "{}");
      return { username: "", name: "", email: "", age: "", weight: "", wUnit: "lb", heightFt: "", heightIn: "", height: "", hUnit: "ftin", ...u, username: acc.username || "", email: acc.email || "" };
    } catch {
      return { username: "", name: "", email: "", age: "", weight: "", wUnit: "lb", heightFt: "", heightIn: "", height: "", hUnit: "ftin" };
    }
  });
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({});

  function toggle(key) { if (editing) return; setExpanded(p => ({ ...p, [key]: !p[key] })); }

  function startEdit(field) { setDraft({ ...data }); setEditing(field); }
  function cancelEdit() { setEditing(null); setDraft({}); }
  function saveEdit() {
    try {
      const saved = { ...draft };
      if (editing === "username") {
        const acc = JSON.parse(localStorage.getItem(SK_ACCOUNT) || "{}");
        localStorage.setItem(SK_ACCOUNT, JSON.stringify({ ...acc, username: saved.username }));
      }
      const u = { ...data };
      delete u.username;
      delete u.email;
      const filtered = Object.fromEntries(Object.entries(saved).filter(([k]) => k !== "username" && k !== "email"));
      localStorage.setItem(SK_U, JSON.stringify({ ...u, ...filtered }));
      setData({ ...data, ...saved });
      setEditing(null); setDraft({});
    } catch {}
  }
  const upDraft = f => v => setDraft(p => ({ ...p, [f]: v }));

  const fmtHeight = d => d.hUnit === "ftin"
    ? (d.heightFt ? `${d.heightFt}' ${d.heightIn || 0}"` : "—")
    : (d.height ? `${d.height} cm` : "—");

  function DisplayRow({ label, value, field }) {
    return (
      <div className="acc-row">
        <span className="acc-key">{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="acc-val">{value || "—"}</span>
          <button className="acc-edit-btn" onClick={() => startEdit(field)}><Icons.Edit size={12} /></button>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-screen">
      <div className="profile-top">
        <button className="back-btn" onClick={onBack}><Icons.ChevLeft size={13} />BACK</button>
        <div className="profile-title">PROFILE</div>
      </div>
      <div className="profile-body">
        <div className="acc-card">
          <button className="acc-header" onClick={() => toggle("personal")}>
            <span>PERSONAL DETAILS</span>
            <span className={`acc-chevron${expanded.personal ? " open" : ""}`}><Icons.ChevRight size={14} /></span>
          </button>
          {expanded.personal && (
            <div className="acc-body">
              {editing === "username" ? (
                <div className="acc-edit-wrap">
                  <label className="acc-key">USERNAME</label>
                  <input className="ti" style={{ marginTop: 6 }} value={draft.username} onChange={e => upDraft("username")(e.target.value)} placeholder="Your username" />
                  <div className="acc-edit-actions">
                    <button className="bo" style={{ fontSize: 8, padding: "5px 12px", minHeight: 32 }} onClick={cancelEdit}>CANCEL</button>
                    <button className="bp" style={{ fontSize: 8, padding: "5px 12px", minHeight: 32 }} onClick={saveEdit}>SAVE</button>
                  </div>
                </div>
              ) : <DisplayRow label="USERNAME" value={data.username} field="username" />}
              {editing === "name" ? (
                <div className="acc-edit-wrap">
                  <label className="acc-key">NAME</label>
                  <input className="ti" style={{ marginTop: 6 }} value={draft.name} onChange={e => upDraft("name")(e.target.value)} placeholder="Your name" />
                  <div className="acc-edit-actions">
                    <button className="bo" style={{ fontSize: 8, padding: "5px 12px", minHeight: 32 }} onClick={cancelEdit}>CANCEL</button>
                    <button className="bp" style={{ fontSize: 8, padding: "5px 12px", minHeight: 32 }} onClick={saveEdit}>SAVE</button>
                  </div>
                </div>
              ) : <DisplayRow label="NAME" value={data.name} field="name" />}
              <DisplayRow label="EMAIL" value={data.email} field={null} />
            </div>
          )}
        </div>
        <div className="acc-card">
          <button className="acc-header" onClick={() => toggle("physical")}>
            <span>PHYSICAL STATS</span>
            <span className={`acc-chevron${expanded.physical ? " open" : ""}`}><Icons.ChevRight size={14} /></span>
          </button>
          {expanded.physical && (
            <div className="acc-body">
              {editing === "age" ? (
                <div className="acc-edit-wrap">
                  <label className="acc-key">AGE</label>
                  <input className="ti" type="number" style={{ marginTop: 6 }} value={draft.age} onChange={e => upDraft("age")(e.target.value)} placeholder="e.g. 25" />
                  <div className="acc-edit-actions">
                    <button className="bo" style={{ fontSize: 8, padding: "5px 12px", minHeight: 32 }} onClick={cancelEdit}>CANCEL</button>
                    <button className="bp" style={{ fontSize: 8, padding: "5px 12px", minHeight: 32 }} onClick={saveEdit}>SAVE</button>
                  </div>
                </div>
              ) : <DisplayRow label="AGE" value={data.age} field="age" />}
              {editing === "weight" ? (
                <div className="acc-edit-wrap">
                  <label className="acc-key">WEIGHT</label>
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <input className="ti" type="number" value={draft.weight} onChange={e => upDraft("weight")(e.target.value)} style={{ flex: 1 }} />
                    <div className="unit-toggle">
                      {["lb", "kg"].map(u => <button key={u} className={`unit-btn${draft.wUnit === u ? " act" : ""}`} onClick={() => upDraft("wUnit")(u)}>{u}</button>)}
                    </div>
                  </div>
                  <div className="acc-edit-actions">
                    <button className="bo" style={{ fontSize: 8, padding: "5px 12px", minHeight: 32 }} onClick={cancelEdit}>CANCEL</button>
                    <button className="bp" style={{ fontSize: 8, padding: "5px 12px", minHeight: 32 }} onClick={saveEdit}>SAVE</button>
                  </div>
                </div>
              ) : <DisplayRow label="WEIGHT" value={data.weight ? `${data.weight} ${data.wUnit}` : ""} field="weight" />}
              {editing === "height" ? (
                <div className="acc-edit-wrap">
                  <label className="acc-key">HEIGHT</label>
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    {draft.hUnit === "ftin"
                      ? <><input className="ti" type="number" value={draft.heightFt} onChange={e => upDraft("heightFt")(e.target.value)} placeholder="ft" style={{ flex: 1 }} /><input className="ti" type="number" value={draft.heightIn} onChange={e => upDraft("heightIn")(e.target.value)} placeholder="in" style={{ flex: 1 }} /></>
                      : <input className="ti" type="number" value={draft.height} onChange={e => upDraft("height")(e.target.value)} placeholder="cm" style={{ flex: 1 }} />}
                    <div className="unit-toggle">
                      {[["ftin", "ft/in"], ["cm", "cm"]].map(([u, l]) => <button key={u} className={`unit-btn${draft.hUnit === u ? " act" : ""}`} onClick={() => upDraft("hUnit")(u)}>{l}</button>)}
                    </div>
                  </div>
                  <div className="acc-edit-actions">
                    <button className="bo" style={{ fontSize: 8, padding: "5px 12px", minHeight: 32 }} onClick={cancelEdit}>CANCEL</button>
                    <button className="bp" style={{ fontSize: 8, padding: "5px 12px", minHeight: 32 }} onClick={saveEdit}>SAVE</button>
                  </div>
                </div>
              ) : <DisplayRow label="HEIGHT" value={fmtHeight(data)} field="height" />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// SUPPORT PAGE
// ══════════════════════════════════════════════
function SupportPage({ onBack }) {
  const [view, setView] = useState("list");

  if (view === "contact") return (
    <div className="profile-screen">
      <div className="profile-top">
        <button className="back-btn" onClick={() => setView("list")}><Icons.ChevLeft size={13} />BACK</button>
        <div className="profile-title">CONTACT SUPPORT</div>
      </div>
      <div className="profile-body">
        <div style={{ textAlign: "center", padding: "40px 16px 32px" }}>
          <div style={{ fontSize: 32, marginBottom: 20 }}>✉️</div>
          <p style={{ fontSize: 13, color: "var(--c2)", lineHeight: 1.75, marginBottom: 8 }}>
            Have a question or issue?<br />Reach out at
          </p>
          <p style={{ fontSize: 13, color: "var(--c1)", letterSpacing: ".04em", marginBottom: 32 }}>
            malshantir11@gmail.com
          </p>
          <button className="bp" style={{ fontSize: 10, padding: "13px 28px" }}
            onClick={() => window.location.href = "mailto:malshantir11@gmail.com"}>
            OPEN EMAIL APP
          </button>
        </div>
      </div>
    </div>
  );

  if (view === "privacy") return (
    <div className="profile-screen">
      <div className="profile-top">
        <button className="back-btn" onClick={() => setView("list")}><Icons.ChevLeft size={13} />BACK</button>
        <div className="profile-title">PRIVACY POLICY</div>
      </div>
      <div className="profile-body">
        <div style={{ fontSize: 12, color: "var(--c2)", lineHeight: 1.8 }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: "var(--c1)", letterSpacing: ".08em", fontWeight: 500, marginBottom: 6 }}>ABOUT THIS APP</div>
            <p>This app is a personal student project built for portfolio and educational purposes, not a commercial product.</p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: "var(--c1)", letterSpacing: ".08em", fontWeight: 500, marginBottom: 6 }}>DATA STORAGE</div>
            <p>User data including account information, workout splits, and session logs is stored either locally on the user's device or securely in a managed database, depending on the current version of the app.</p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: "var(--c1)", letterSpacing: ".08em", fontWeight: 500, marginBottom: 6 }}>DATA USAGE</div>
            <p>No data is sold, shared, or made accessible to any third party. The developer does not use this data for any purpose outside of providing the app's core functionality.</p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: "var(--c1)", letterSpacing: ".08em", fontWeight: 500, marginBottom: 6 }}>AI-POWERED FEATURES</div>
            <p>An AI-powered progress analysis feature may be available that sends workout history to the Claude API (made by Anthropic) to generate personalized recommendations. This data is only used to generate that response and is not stored by the developer beyond what's necessary to provide the feature.</p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: "var(--c1)", letterSpacing: ".08em", fontWeight: 500, marginBottom: 6 }}>ACCOUNT DELETION</div>
            <p>Users can delete their account and all associated data at any time through Account settings.</p>
          </div>
        </div>
      </div>
    </div>
  );

  if (view === "terms") return (
    <div className="profile-screen">
      <div className="profile-top">
        <button className="back-btn" onClick={() => setView("list")}><Icons.ChevLeft size={13} />BACK</button>
        <div className="profile-title">TERMS OF SERVICE</div>
      </div>
      <div className="profile-body">
        <div style={{ fontSize: 12, color: "var(--c2)", lineHeight: 1.8 }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: "var(--c1)", letterSpacing: ".08em", fontWeight: 500, marginBottom: 6 }}>ABOUT THIS APP</div>
            <p>This app is a personal student project created for educational and portfolio purposes.</p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: "var(--c1)", letterSpacing: ".08em", fontWeight: 500, marginBottom: 6 }}>NO WARRANTIES</div>
            <p>It is provided as-is without any warranties or guarantees of accuracy, reliability, or availability.</p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: "var(--c1)", letterSpacing: ".08em", fontWeight: 500, marginBottom: 6 }}>INFORMATIONAL PURPOSES ONLY</div>
            <p>The app provides fitness tracking and training suggestions for informational purposes only and is not a substitute for professional medical or fitness advice. Users should consult a qualified professional before beginning any new exercise program.</p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: "var(--c1)", letterSpacing: ".08em", fontWeight: 500, marginBottom: 6 }}>DISCLAIMER OF LIABILITY</div>
            <p>The developer is not responsible for any injury, loss, or damage resulting from use of this app.</p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: "var(--c1)", letterSpacing: ".08em", fontWeight: 500, marginBottom: 6 }}>USE AT YOUR OWN RISK</div>
            <p>By using this app, users agree to use it at their own risk.</p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: "var(--c1)", letterSpacing: ".08em", fontWeight: 500, marginBottom: 6 }}>RIGHT TO MODIFY</div>
            <p>The developer reserves the right to modify or discontinue the app at any time without notice.</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="profile-screen">
      <div className="profile-top">
        <button className="back-btn" onClick={onBack}><Icons.ChevLeft size={13} />BACK</button>
        <div className="profile-title">SUPPORT</div>
      </div>
      <div className="profile-body">
        {[
          { label: "CONTACT SUPPORT", key: "contact" },
          { label: "PRIVACY POLICY",  key: "privacy" },
          { label: "TERMS OF SERVICE", key: "terms" },
        ].map(item => (
          <button key={item.key} className="support-row" onClick={() => setView(item.key)}>
            {item.label}
            <Icons.ChevRight size={14} />
          </button>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// ACCOUNT PAGE
// ══════════════════════════════════════════════
function AccountPage({ onBack, onDeleteAccount }) {
  const [expanded, setExpanded] = useState({ password: false, del: false });
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwErrs, setPwErrs] = useState({});
  const [pwOk, setPwOk] = useState(false);

  function toggle(key) {
    setExpanded(p => ({ ...p, [key]: !p[key] }));
    if (key === "password") { setPwErrs({}); setPwOk(false); }
  }

  function savePassword() {
    const e = {};
    try {
      const acc = JSON.parse(localStorage.getItem(SK_ACCOUNT) || "{}");
      if (acc.password !== pw.current) e.current = "Incorrect current password.";
    } catch { e.current = "Could not verify password."; }
    if (!pw.next || pw.next.length < 6) e.next = "Min 6 characters.";
    if (pw.next !== pw.confirm) e.confirm = "Passwords don't match.";
    if (Object.keys(e).length) { setPwErrs(e); return; }
    try {
      const acc = JSON.parse(localStorage.getItem(SK_ACCOUNT) || "{}");
      localStorage.setItem(SK_ACCOUNT, JSON.stringify({ ...acc, password: pw.next }));
      setPwOk(true); setPw({ current: "", next: "", confirm: "" }); setPwErrs({});
    } catch { setPwErrs({ general: "Something went wrong." }); }
  }

  return (
    <div className="profile-screen">
      <div className="profile-top">
        <button className="back-btn" onClick={onBack}><Icons.ChevLeft size={13} />BACK</button>
        <div className="profile-title">ACCOUNT</div>
      </div>
      <div className="profile-body">

        <div className="acc-card">
          <button className="acc-header" onClick={() => toggle("password")}>
            <span>CHANGE PASSWORD</span>
            <span className={`acc-chevron${expanded.password ? " open" : ""}`}><Icons.ChevRight size={14} /></span>
          </button>
          {expanded.password && (
            <div className="acc-body">
              {pwOk
                ? <div style={{ fontSize: 11, color: "var(--green)", padding: "6px 0" }}>Password updated successfully.</div>
                : <>
                    <div className="fld">
                      <label className="lbl">CURRENT PASSWORD</label>
                      <input className="ti" type="password" autoComplete="new-password" value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))} placeholder="Current password" />
                      {pwErrs.current && <div className="err">{pwErrs.current}</div>}
                    </div>
                    <div className="fld">
                      <label className="lbl">NEW PASSWORD</label>
                      <input className="ti" type="password" autoComplete="new-password" value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} placeholder="Min 6 characters" />
                      {pwErrs.next && <div className="err">{pwErrs.next}</div>}
                    </div>
                    <div className="fld">
                      <label className="lbl">CONFIRM NEW PASSWORD</label>
                      <input className="ti" type="password" autoComplete="new-password" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} placeholder="Repeat new password" />
                      {pwErrs.confirm && <div className="err">{pwErrs.confirm}</div>}
                    </div>
                    {pwErrs.general && <div className="err" style={{ marginBottom: 12 }}>{pwErrs.general}</div>}
                    <button className="bp" style={{ width: "100%", fontSize: 9, padding: "10px 0" }} onClick={savePassword}>UPDATE PASSWORD</button>
                  </>}
            </div>
          )}
        </div>

        <div className="acc-card" style={{ borderColor: expanded.del ? "rgba(248,113,113,.35)" : undefined }}>
          <button className="acc-header" onClick={() => toggle("del")}>
            <span style={{ color: "var(--red)" }}>DELETE ACCOUNT</span>
            <span className={`acc-chevron${expanded.del ? " open" : ""}`} style={{ color: "var(--red)" }}><Icons.ChevRight size={14} /></span>
          </button>
          {expanded.del && (
            <div className="acc-body">
              <div style={{ fontSize: 11, color: "var(--c2)", lineHeight: 1.75, marginBottom: 16 }}>
                This permanently deletes your account, training split, all logged sessions, and personal data.{" "}
                <span style={{ color: "var(--red)" }}>This cannot be undone.</span>
              </div>
              <button className="bp" style={{ width: "100%", fontSize: 9, padding: "10px 0", background: "var(--red)", color: "#000" }} onClick={onDeleteAccount}>
                YES, DELETE EVERYTHING
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// SETTINGS PAGE
// ══════════════════════════════════════════════
function SettingsPage({ onBack, settings, onSave, dupPref = "combined", onDupPrefChange }) {
  const [expanded, setExpanded] = useState({ units: false, tracking: false });

  function toggle(key) { setExpanded(p => ({ ...p, [key]: !p[key] })); }
  function select(field, value) { onSave({ ...settings, [field]: value }); }

  return (
    <div className="profile-screen">
      <div className="profile-top">
        <button className="back-btn" onClick={onBack}><Icons.ChevLeft size={13} />BACK</button>
        <div className="profile-title">SETTINGS</div>
      </div>
      <div className="profile-body">
        <div className="acc-card">
          <button className="acc-header" onClick={() => toggle("units")}>
            <span>UNITS</span>
            <span className={`acc-chevron${expanded.units ? " open" : ""}`}><Icons.ChevRight size={14} /></span>
          </button>
          {expanded.units && (
            <div className="acc-body">
              <div style={{ display: "flex", gap: 8, paddingTop: 8 }}>
                {["lb", "kg"].map(u => (
                  <button key={u} className={`setting-option${settings.units === u ? " sel" : ""}`} onClick={() => select("units", u)}>{u.toUpperCase()}</button>
                ))}
              </div>
              <div className="setting-hint">Default unit for new splits and weight entry throughout the app.</div>
            </div>
          )}
        </div>
        <div className="acc-card">
          <button className="acc-header" onClick={() => toggle("tracking")}>
            <span>EXERCISE TRACKING</span>
            <span className={`acc-chevron${expanded.tracking ? " open" : ""}`}><Icons.ChevRight size={14} /></span>
          </button>
          {expanded.tracking && (
            <div className="acc-body">
              <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8 }}>
                {[
                  ["by_day", "BY DAY", "Each day gets its own independent progress chart"],
                  ["combined", "COMBINED", "All sessions for the same exercise are merged into one chart"],
                ].map(([val, label, desc]) => (
                  <button key={val} className={`setting-option${dupPref === val ? " sel" : ""}`}
                    style={{ textAlign: "left", height: "auto", padding: "11px 14px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}
                    onClick={() => onDupPrefChange && onDupPrefChange(val)}>
                    <span>{label}</span>
                    <span style={{ fontSize: 8, color: dupPref === val ? "var(--c2)" : "var(--c4)", letterSpacing: ".06em" }}>{desc}</span>
                  </button>
                ))}
              </div>
              <div className="setting-hint">Controls how duplicate exercise names across training days appear on the Progress page.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// MENU PANEL
// ══════════════════════════════════════════════
function MenuPanel({ open, onClose, onLogOut, onProfile, onSettings, onAccount, onSupport }) {
  const items = [
    { label: "PROFILE", Icon: Icons.User, onClick: onProfile },
    { label: "SETTINGS", Icon: Icons.Settings, onClick: onSettings },
    { label: "ACCOUNT", Icon: Icons.Lock, onClick: onAccount },
    { label: "SUPPORT", Icon: Icons.HelpCircle, onClick: onSupport },
  ];
  return (
    <>
      <div className={`menu-ov${open ? " open" : ""}`} onClick={onClose} />
      <div className={`menu-panel${open ? " open" : ""}`}>
        <div className="menu-brand">
          <div className="menu-brand-name">OVERLOAD TRACKER</div>
          <div className="menu-brand-sub">TRAIN · LOG · PROGRESS</div>
        </div>
        <div className="menu-items">
          {items.map(({ label, Icon, onClick }) => (
            <button key={label} className="menu-item" onClick={onClick}>
              <Icon />{label}
            </button>
          ))}
        </div>
        <div className="menu-footer">
          <button className="menu-item danger" onClick={onLogOut}>
            <Icons.LogOut />LOG OUT
          </button>
        </div>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════
// AUTH SCREENS
// ══════════════════════════════════════════════
function WelcomeScreen({ onSignUp, onLogIn }) {
  return (
    <div className="auth-screen">
      <div className="welcome-top">
        <div className="welcome-logo">OVERLOAD<br /><span>TRACKER</span></div>
        <div className="welcome-tagline">TRAIN · LOG · PROGRESS</div>
      </div>
      <div className="welcome-btns">
        <button className="btn-signup" onClick={onSignUp}>SIGN UP</button>
        <button className="btn-login-out" onClick={onLogIn}>LOG IN</button>
      </div>
    </div>
  );
}

function SignUpForm({ onSuccess, onBack, showToast }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errs, setErrs] = useState({});

  function submit() {
    const e = {};
    if (!username || username.trim().length < 3) e.username = "Min 3 characters.";
    if (!email || !/\S+@\S+\.\S+/.test(email)) e.email = "Valid email required.";
    if (!password || password.length < 6) e.password = "Min 6 characters.";
    if (password !== confirm) e.confirm = "Passwords don't match.";
    if (Object.keys(e).length) { setErrs(e); return; }
    try {
      localStorage.removeItem(SK_ACTIVE); // clear active session first, before anything else
      const existing = localStorage.getItem(SK_ACCOUNT);
      if (existing && JSON.parse(existing).email === email.toLowerCase()) {
        setErrs({ email: "An account with this email already exists." }); return;
      }
      [SK_P, SK_S, SK_U, SK_L, SK_DUP, SK_ACTIVE].forEach(k => localStorage.removeItem(k));
      localStorage.setItem(SK_ACCOUNT, JSON.stringify({ username: username.trim(), email: email.toLowerCase(), password }));
      localStorage.setItem(SK_SESSION, "1");
      showToast("Account created!", "tg");
      onSuccess();
    } catch { setErrs({ general: "Something went wrong. Try again." }); }
  }

  return (
    <div className="auth-screen">
      <div className="auth-top">
        <button className="bg-btn" onClick={onBack}>← BACK</button>
        <div className="auth-title">SIGN UP</div>
      </div>
      <div className="auth-body">
        <div className="fld">
          <label className="lbl">USERNAME</label>
          <input className="ti" autoComplete="off" value={username} onChange={e => setUsername(e.target.value)} placeholder="Choose a username" />
          {errs.username && <div className="err">{errs.username}</div>}
        </div>
        <div className="fld">
          <label className="lbl">EMAIL</label>
          <input className="ti" type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
          {errs.email && <div className="err">{errs.email}</div>}
        </div>
        <div className="fld">
          <label className="lbl">PASSWORD</label>
          <input className="ti" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 6 characters" />
          {errs.password && <div className="err">{errs.password}</div>}
        </div>
        <div className="fld">
          <label className="lbl">CONFIRM PASSWORD</label>
          <input className="ti" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat password" />
          {errs.confirm && <div className="err">{errs.confirm}</div>}
        </div>
        {errs.general && <div className="err" style={{ marginBottom: 12 }}>{errs.general}</div>}
        <button className="bp" style={{ width: "100%" }} onClick={submit}>CREATE ACCOUNT</button>
      </div>
    </div>
  );
}

function LogInForm({ onSuccess, onBack, showToast }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errs, setErrs] = useState({});

  function submit() {
    const e = {};
    if (!email) e.email = "Email required.";
    if (!password) e.password = "Password required.";
    if (Object.keys(e).length) { setErrs(e); return; }
    try {
      const raw = localStorage.getItem(SK_ACCOUNT);
      if (!raw) { setErrs({ general: "No account found. Please sign up first." }); return; }
      const acc = JSON.parse(raw);
      if (acc.email !== email.toLowerCase() || acc.password !== password) {
        setErrs({ general: "Incorrect email or password." }); return;
      }
      localStorage.setItem(SK_SESSION, "1");
      showToast("Welcome back!", "tg");
      onSuccess();
    } catch { setErrs({ general: "Something went wrong. Try again." }); }
  }

  return (
    <div className="auth-screen">
      <div className="auth-top">
        <button className="bg-btn" onClick={onBack}>← BACK</button>
        <div className="auth-title">LOG IN</div>
      </div>
      <div className="auth-body">
        <div className="fld">
          <label className="lbl">EMAIL</label>
          <input className="ti" type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
          {errs.email && <div className="err">{errs.email}</div>}
        </div>
        <div className="fld">
          <label className="lbl">PASSWORD</label>
          <input className="ti" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" />
          {errs.password && <div className="err">{errs.password}</div>}
        </div>
        {errs.general && <div className="err" style={{ marginBottom: 12 }}>{errs.general}</div>}
        <button className="bp" style={{ width: "100%" }} onClick={submit}>LOG IN</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// ROOT
// ══════════════════════════════════════════════
export default function App() {
  const [page, setPage] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SK_P) || "null");
      if (saved?.sessions?.length > 0) return "home";
      return "intro";
    } catch { return "intro"; }
  });
  const [launched, setLaunched] = useState(false);
  const [program, setProgram] = useState(null);
  const [sessions, setSessions] = useState({});
  const [toast, setToast] = useState({ msg: "", show: false, variant: "" });
  const [splash, setSplash] = useState(true);
  const [splashFade, setSplashFade] = useState(false);
  const [authState, setAuthState] = useState(() => {
    try { return localStorage.getItem(SK_SESSION) ? "app" : "welcome"; } catch { return "welcome"; }
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState(null);
  const [settings, setSettings] = useState(() => {
    try { return { units: "lb", ...JSON.parse(localStorage.getItem(SK_SETTINGS) || "{}") }; } catch { return { units: "lb" }; }
  });
  const [dupPref, setDupPref] = useState(() => {
    try { return localStorage.getItem(SK_DUP) || "combined"; } catch { return "combined"; }
  });
  const [pendingSessionIdx, setPendingSessionIdx] = useState(null);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setSplashFade(true), 2000);
    const removeTimer = setTimeout(() => setSplash(false), 2500);
    return () => { clearTimeout(fadeTimer); clearTimeout(removeTimer); };
  }, []);

  useEffect(() => {
    try {
      const l = localStorage.getItem(SK_L);
      if (l === "1") setLaunched(true);
      const p = localStorage.getItem(SK_P);
      if (p) {
        const prog = normalizeExerciseNames(JSON.parse(p));
        setProgram(prog);
        saveExerciseNames(prog);
      }
      const s = localStorage.getItem(SK_S);
      if (s) setSessions(JSON.parse(s));
    } catch {}
  }, []);


  useEffect(() => {
    if (launched && program?.sessions?.length > 0 && page === "intro") setPage("home");
  }, [launched, program]);

  useEffect(() => {
    if (Object.keys(sessions).length > 0) {
      try { localStorage.setItem(SK_S, JSON.stringify(sessions)); } catch {}
    }
  }, [sessions]);

  const showToast = useCallback((msg, variant = "") => {
    setToast({ msg, show: true, variant });
    setTimeout(() => setToast(t => ({ ...t, show: false })), 2200);
  }, []);

  function handleStart() {
    try { localStorage.setItem(SK_L, "1"); } catch {}
    setLaunched(true); setPage("split");
  }

  function handleHomeStartSession(idx) {
    setPendingSessionIdx(idx);
    setPage("log");
  }

  function handleDupPrefChange(pref) {
    setDupPref(pref);
    try { localStorage.setItem(SK_DUP, pref); } catch {}
  }

  function handleLogOut() {
    // SK_U (profile data) is intentionally kept — login does not re-run UserSetupForm,
    // so clearing it would permanently erase name/age/weight/height with no way to restore.
    try { [SK_P, SK_S, SK_L, SK_DUP, SK_SESSION, SK_ACTIVE].forEach(k => localStorage.removeItem(k)); } catch {}
    setProgram(null);
    setSessions({});
    setDupPref("combined");
    setLaunched(false);
    setPage("intro");
    setMenuOpen(false);
    setMenuView(null);
    setAuthState("welcome");
  }

  function handleProfileOpen() {
    setMenuOpen(false);
    setMenuView("profile");
  }

  function handleProfileBack() {
    setMenuView(null);
    setMenuOpen(true);
  }

  function handleSettingsOpen() {
    setMenuOpen(false);
    setMenuView("settings");
  }

  function handleSettingsBack() {
    setMenuView(null);
    setMenuOpen(true);
  }

  function handleAccountOpen() {
    setMenuOpen(false);
    setMenuView("account");
  }

  function handleAccountBack() {
    setMenuView(null);
    setMenuOpen(true);
  }

  function handleSupportOpen() {
    setMenuOpen(false);
    setMenuView("support");
  }

  function handleSupportBack() {
    setMenuView(null);
    setMenuOpen(true);
  }

  function handleDeleteAccount() {
    try {
      [SK_P, SK_S, SK_U, SK_L, SK_ACCOUNT, SK_SESSION, SK_SETTINGS].forEach(k => localStorage.removeItem(k));
    } catch {}
    setMenuView(null);
    setMenuOpen(false);
    setAuthState("welcome");
  }

  function handleSaveSettings(next) {
    setSettings(next);
    try {
      localStorage.setItem(SK_SETTINGS, JSON.stringify(next));
      const u = JSON.parse(localStorage.getItem(SK_U) || "{}");
      localStorage.setItem(SK_U, JSON.stringify({ ...u, wUnit: next.units }));
    } catch {}
  }

  const nav = [
    { id: "home", label: "HOME", Icon: Icons.Home },
    { id: "split", label: "SPLIT", Icon: Icons.Layers },
    { id: "log", label: "LOG", Icon: Icons.Clipboard },
    { id: "calendar", label: "CAL", Icon: Icons.Calendar },
    { id: "progress", label: "PROGRESS", Icon: Icons.TrendUp },
  ];

  return (
    <>
      <style>{CSS}</style>
      {splash && (
        <div className={`splash${splashFade ? " fade" : ""}`}>
          <div className="splash-title">OVERLOAD TRACKER</div>
          <div className="splash-sub">TRAIN · LOG · PROGRESS</div>
        </div>
      )}
      {!splash && authState === "welcome" && (
        <WelcomeScreen onSignUp={() => setAuthState("signup")} onLogIn={() => setAuthState("login")} />
      )}
      {!splash && authState === "signup" && (
        <SignUpForm onSuccess={() => { setProgram(null); setSessions({}); setLaunched(false); setPage("intro"); setAuthState("setup"); }} onBack={() => setAuthState("welcome")} showToast={showToast} />
      )}
      {!splash && authState === "setup" && (
        <UserSetupForm onSuccess={() => setAuthState("app")} showToast={showToast} />
      )}
      {!splash && authState === "login" && (
        <LogInForm onSuccess={() => setAuthState("app")} onBack={() => setAuthState("welcome")} showToast={showToast} />
      )}
      {authState === "app" && <div className="app">
        <button className="ham-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
          <Icons.Ham />
        </button>
        <MenuPanel open={menuOpen} onClose={() => setMenuOpen(false)} onLogOut={handleLogOut} onProfile={handleProfileOpen} onSettings={handleSettingsOpen} onAccount={handleAccountOpen} onSupport={handleSupportOpen} />
        {menuView === "profile" && <ProfilePage onBack={handleProfileBack} />}
        {menuView === "settings" && <SettingsPage onBack={handleSettingsBack} settings={settings} onSave={handleSaveSettings} dupPref={dupPref} onDupPrefChange={handleDupPrefChange} />}
        {menuView === "account" && <AccountPage onBack={handleAccountBack} onDeleteAccount={handleDeleteAccount} />}
        {menuView === "support" && <SupportPage onBack={handleSupportBack} />}
        <div className="pages">
          <div className={`pg${page === "home" ? " act" : ""}`}><HomePage program={program} sessions={sessions} onStartSession={handleHomeStartSession} /></div>
          <div className={`pg${page === "intro" ? " act" : ""}`}><IntroPage onStart={handleStart} /></div>
          <div className={`pg${page === "split" ? " act" : ""}`}><SplitPage program={program} setProgram={setProgram} showToast={showToast} onDupPrefChange={handleDupPrefChange} /></div>
          <div className={`pg${page === "log" ? " act" : ""}`}><LogPage program={program} setProgram={setProgram} sessions={sessions} setSessions={setSessions} showToast={showToast} pendingSessionIdx={pendingSessionIdx} onClearPending={() => setPendingSessionIdx(null)} /></div>
          <div className={`pg${page === "calendar" ? " act" : ""}`}><CalendarPage program={program} sessions={sessions} setSessions={setSessions} /></div>
          <div className={`pg${page === "progress" ? " act" : ""}`}><ProgressPage program={program} sessions={sessions} dupPref={dupPref} /></div>
        </div>
        <nav className="nav">
          {nav.map(n => (
            <button key={n.id} className={`nb${page === n.id ? " act" : ""}`} onClick={() => setPage(n.id)}>
              <n.Icon />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
      </div>}
      <Toast msg={toast.msg} show={toast.show} variant={toast.variant} />
    </>
  );
}
