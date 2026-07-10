import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabaseClient";

// ---------- design tokens ----------
const T = {
  paper: "#F7F7F4",
  ink: "#15171C",
  muted: "#5F626A",
  faint: "#6B6E76",
  line: "#E3E3DC",
  card: "#FFFFFF",
  accent: "#2437D6", // ultramarine
  accentSoft: "#EDEFFC",
  danger: "#C4372B",
  dangerSoft: "#FBEEEC",
  ok: "#1E7F4F",
  okSoft: "#EAF5EF",
  amber: "#9A6B00",
  amberSoft: "#FBF3E0",
};
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace';

const STATUSES = ["Prospect", "Preparing", "Submitted", "Interview", "Accepted", "Declined"];
const STATUS_STYLE = {
  Prospect:  { fg: T.muted,  bg: "#F0F0EB" },
  Preparing: { fg: T.accent, bg: T.accentSoft },
  Submitted: { fg: T.amber,  bg: T.amberSoft },
  Interview: { fg: "#7A2FA0", bg: "#F5ECFA" },
  Accepted:  { fg: T.ok,     bg: T.okSoft },
  Declined:  { fg: T.danger, bg: T.dangerSoft },
};

const ROW_ID = "main";
const POLL_MS = 25000;

// ---------- helpers ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T23:59:59");
  if (isNaN(d)) return null;
  return Math.ceil((d - new Date()) / 86400000);
}
function fmtDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T12:00:00");
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
function countdownLabel(days) {
  if (days === null) return "";
  if (days < 0) return `D+${Math.abs(days)}`;
  if (days === 0) return "TODAY";
  return `D−${days}`;
}
function countdownColor(days, status) {
  if (days === null) return T.faint;
  if (status === "Accepted" || status === "Declined") return T.faint;
  if (days < 0) return T.faint;
  if (days <= 7) return T.danger;
  if (days <= 21) return T.amber;
  return T.ink;
}

// ---------- tiny primitives ----------
let _idSeq = 0;
const useFieldId = (label) => {
  const ref = useRef(null);
  if (ref.current === null) ref.current = `f-${(label || "field").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${++_idSeq}`;
  return ref.current;
};
function Label({ children, htmlFor }) {
  return (
    <label htmlFor={htmlFor} style={{ display: "block", fontFamily: SANS, fontSize: 10.5, fontWeight: 700,
      letterSpacing: "0.12em", textTransform: "uppercase", color: T.muted, marginBottom: 5 }}>
      {children}
    </label>
  );
}
function Field({ label, flexGrow, minWidth, mono, ...props }) {
  const id = useFieldId(label);
  return (
    <div style={{ flex: flexGrow ? 1 : undefined, minWidth: minWidth || 0 }}>
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        aria-label={label}
        {...props}
        style={{
          width: "100%", boxSizing: "border-box", fontFamily: mono ? MONO : SANS,
          fontSize: 14, color: T.ink, background: T.card, border: `1px solid ${T.line}`,
          borderRadius: 6, padding: "9px 10px",
        }}
        onFocus={(e) => (e.target.style.borderColor = T.accent)}
        onBlur={(e) => (e.target.style.borderColor = T.line)}
      />
    </div>
  );
}
function Btn({ children, kind = "ghost", small, onClick, disabled, title, ariaLabel }) {
  const base = {
    fontFamily: SANS, fontWeight: 600, cursor: disabled ? "default" : "pointer",
    fontSize: small ? 12 : 13, borderRadius: 6, padding: small ? "6px 10px" : "9px 14px",
    border: `1px solid ${T.line}`, background: T.card, color: T.ink,
    opacity: disabled ? 0.5 : 1, transition: "background 120ms",
  };
  if (kind === "primary") { base.background = T.accent; base.color = "#fff"; base.border = `1px solid ${T.accent}`; }
  if (kind === "danger") { base.color = T.danger; }
  return (
    <button type="button" title={title} aria-label={ariaLabel || title} onClick={onClick}
      disabled={disabled} aria-disabled={disabled || undefined} style={base}>
      {children}
    </button>
  );
}
function Pill({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.Prospect;
  return (
    <span style={{ fontFamily: SANS, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
      textTransform: "uppercase", color: s.fg, background: s.bg, borderRadius: 999,
      padding: "3px 9px", whiteSpace: "nowrap" }}>
      {status}
    </span>
  );
}
function Empty({ title, body }) {
  return (
    <div style={{ padding: "56px 24px", textAlign: "center", border: `1px dashed ${T.line}`, borderRadius: 10 }}>
      <div style={{ fontFamily: SANS, fontSize: 16, fontWeight: 700, color: T.ink, marginBottom: 6 }}>{title}</div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: T.muted, maxWidth: 420, margin: "0 auto", lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}

// ---------- main app ----------
function StudioApp() {
  const [data, setData] = useState({ residencies: [], contacts: [], events: [], updatedAt: 0 });
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState("idle"); // idle | saving | error
  const [lastSync, setLastSync] = useState(null);
  const [tab, setTab] = useState("home");
  const [pendingAdd, setPendingAdd] = useState(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  const load = useCallback(async (silent) => {
    try {
      const { data: row, error } = await supabase
        .from("studio").select("data").eq("id", ROW_ID).maybeSingle();
      if (error) throw error;
      if (row && row.data) {
        const remote = row.data;
        if (!silent || (remote.updatedAt || 0) > (dataRef.current.updatedAt || 0)) {
          setData({ residencies: [], contacts: [], events: [], ...remote });
        }
      }
      setLastSync(new Date());
      setSyncState("idle");
    } catch (e) {
      if (!silent) { setLastSync(new Date()); setSyncState("error"); }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
    const id = setInterval(() => load(true), POLL_MS);
    // live sync: apply changes the moment your partner saves
    const channel = supabase
      .channel("studio-main")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "studio", filter: `id=eq.${ROW_ID}` },
        (payload) => {
          const remote = payload.new && payload.new.data;
          if (remote && (remote.updatedAt || 0) > (dataRef.current.updatedAt || 0)) {
            setData({ residencies: [], contacts: [], events: [], ...remote });
            setLastSync(new Date());
          }
        }
      )
      .subscribe();
    return () => { clearInterval(id); supabase.removeChannel(channel); };
  }, [load]);

  const save = useCallback(async (mutate) => {
    const next = { ...mutate(dataRef.current), updatedAt: Date.now() };
    setData(next);
    setSyncState("saving");
    try {
      const { error } = await supabase
        .from("studio")
        .upsert({ id: ROW_ID, data: next, updated_at: new Date().toISOString() })
        .select();
      if (error) throw error;
      setSyncState("idle");
      setLastSync(new Date());
    } catch (e) {
      setSyncState("error");
    }
  }, []);

  // residency ops
  const addResidency = (r) => save((d) => ({ ...d, residencies: [...d.residencies, { id: uid(), notes: "", ...r }] }));
  const updateResidency = (id, patch) =>
    save((d) => ({ ...d, residencies: d.residencies.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const removeResidency = (id) => save((d) => ({ ...d, residencies: d.residencies.filter((r) => r.id !== id) }));

  // contact ops
  const addContact = (c) => save((d) => ({ ...d, contacts: [...d.contacts, { id: uid(), ...c }] }));
  const updateContact = (id, patch) =>
    save((d) => ({ ...d, contacts: d.contacts.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const removeContact = (id) => save((d) => ({ ...d, contacts: d.contacts.filter((c) => c.id !== id) }));

  // manual calendar event ops
  const addEvent = (e) => save((d) => ({ ...d, events: [...(d.events || []), { id: uid(), ...e }] }));
  const updateEvent = (id, patch) =>
    save((d) => ({ ...d, events: (d.events || []).map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  const removeEvent = (id) => save((d) => ({ ...d, events: (d.events || []).filter((e) => e.id !== id) }));

  // deadline events derived from active pipeline residencies (kept in sync automatically)
  const deadlineEvents = data.residencies
    .filter((r) => r.deadline && r.status !== "Accepted" && r.status !== "Declined")
    .map((r) => ({ id: "res-" + r.id, residencyId: r.id, title: r.name, date: r.deadline,
      kind: "deadline", status: r.status, url: r.url }));

  const active = data.residencies.filter((r) => r.status !== "Accepted" && r.status !== "Declined");
  const nextUp = active
    .filter((r) => daysUntil(r.deadline) !== null && daysUntil(r.deadline) >= 0)
    .sort((a, b) => daysUntil(a.deadline) - daysUntil(b.deadline))[0];

  // navigate to a tool, optionally auto-opening its add form
  const goto = (t, opts = {}) => { setTab(t); if (opts.add) setPendingAdd({ target: t, nonce: Date.now() }); };
  const addNonce = (t) => (pendingAdd && pendingAdd.target === t ? pendingAdd.nonce : null);

  return (
    <div style={{ minHeight: "100vh", background: T.paper, color: T.ink, fontFamily: SANS }}>
      <style>{`
        :focus-visible { outline: 2px solid ${T.accent} !important; outline-offset: 2px !important; border-radius: 4px; }
        button:focus:not(:focus-visible), a:focus:not(:focus-visible) { outline: none; }
        a { color: ${T.accent}; }
        @media (prefers-reduced-motion: reduce) {
          * { transition: none !important; animation: none !important; }
        }
        .rd-skip { position: absolute; left: -9999px; top: 0; background: ${T.ink}; color: #fff;
          padding: 8px 14px; border-radius: 6px; z-index: 10; font-family: ${SANS}; font-size: 13px; }
        .rd-skip:focus { left: 12px; top: 12px; }
      `}</style>
      <a href="#rd-main" className="rd-skip">Skip to content</a>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "36px 20px 80px" }}>
        {/* masthead */}
        <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between",
          borderBottom: `2px solid ${T.ink}`, paddingBottom: 14, marginBottom: 10, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, margin: 0 }}>
              Residency Desk
            </h1>
            <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, marginTop: 7 }}>
              shared studio management · home / applications / calendar / contacts
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <SyncBadge state={syncState} lastSync={lastSync} onRefresh={() => load(false)} />
            <button type="button" onClick={() => supabase.auth.signOut()} aria-label="Sign out"
              style={{ fontFamily: MONO, fontSize: 11, color: T.muted, background: T.card,
                border: `1px solid ${T.line}`, borderRadius: 999, padding: "6px 12px", cursor: "pointer" }}>
              sign out
            </button>
          </div>
        </header>

        {/* tabs */}
        <nav aria-label="Sections" style={{ display: "flex", gap: 4, borderBottom: `1px solid ${T.line}`, marginBottom: 24 }} role="tablist">
          {[
            ["home", "Home"],
            ["pipeline", `Pipeline · ${data.residencies.length}`],
            ["calendar", "Calendar"],
            ["contacts", `Contacts · ${data.contacts.length}`],
          ].map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              role="tab" aria-selected={tab === key} id={`tab-${key}`} aria-controls="rd-main"
              style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, padding: "10px 14px",
                background: "none", border: "none", cursor: "pointer",
                color: tab === key ? T.ink : T.muted,
                borderBottom: tab === key ? `2px solid ${T.accent}` : "2px solid transparent",
                marginBottom: -1 }}>
              {label}
            </button>
          ))}
        </nav>

        <main id="rd-main" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1} style={{ outline: "none" }}>
        {loading ? (
          <div style={{ fontFamily: MONO, fontSize: 12, color: T.muted, padding: 40, textAlign: "center" }}
            role="status" aria-live="polite">
            loading shared data…
          </div>
        ) : tab === "home" ? (
          <Home residencies={data.residencies} events={data.events || []} deadlineEvents={deadlineEvents}
            goto={goto} />
        ) : tab === "pipeline" ? (
          <Pipeline residencies={data.residencies} nextUp={nextUp} autoAddNonce={addNonce("pipeline")}
            onAdd={addResidency} onUpdate={updateResidency} onRemove={removeResidency} />
        ) : tab === "calendar" ? (
          <Calendar events={data.events || []} deadlineEvents={deadlineEvents} autoAddNonce={addNonce("calendar")}
            onAdd={addEvent} onUpdate={updateEvent} onRemove={removeEvent} onGoto={() => setTab("pipeline")} />
        ) : (
          <Contacts contacts={data.contacts} residencies={data.residencies} autoAddNonce={addNonce("contacts")}
            onAdd={addContact} onUpdate={updateContact} onRemove={removeContact} />
        )}
        </main>
      </div>
    </div>
  );
}

function SyncBadge({ state, lastSync, onRefresh }) {
  const dot = state === "error" ? T.danger : state === "saving" ? T.amber : T.ok;
  const text = state === "error" ? "sync failed — retry"
    : state === "saving" ? "saving…"
    : lastSync ? `synced ${lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "connecting…";
  return (
    <button type="button" onClick={onRefresh} title="Refresh shared data"
      aria-label={`Sync status: ${text}. Activate to refresh shared data.`}
      style={{ display: "flex", alignItems: "center", gap: 7, background: T.card,
        border: `1px solid ${T.line}`, borderRadius: 999, padding: "6px 12px", cursor: "pointer" }}>
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: dot, display: "inline-block" }} />
      <span role="status" aria-live="polite" style={{ fontFamily: MONO, fontSize: 11, color: T.muted }}>{text}</span>
      <span aria-hidden="true" style={{ fontFamily: SANS, fontSize: 11, fontWeight: 700, color: T.accent }}>↻</span>
    </button>
  );
}

// ---------- home ----------
function Home({ residencies, events, deadlineEvents, goto }) {
  const today = new Date();
  const active = residencies.filter((r) => r.status !== "Accepted" && r.status !== "Declined");

  // upcoming deadlines (active, dated, not past), soonest first
  const upcoming = active
    .filter((r) => { const d = daysUntil(r.deadline); return d !== null && d >= 0; })
    .sort((a, b) => daysUntil(a.deadline) - daysUntil(b.deadline));
  const hero = upcoming[0];
  const heroDays = hero ? daysUntil(hero.deadline) : null;
  const runnersUp = upcoming.slice(1, 4);

  // this week: deadlines + manual events within the next 7 days
  const weekItems = [];
  for (const e of deadlineEvents) { const d = daysUntil(e.date); if (d !== null && d >= 0 && d <= 7) weekItems.push({ ...e }); }
  for (const e of events) { const d = daysUntil(e.date); if (d !== null && d >= 0 && d <= 7) weekItems.push({ ...e, kind: "manual" }); }
  weekItems.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === "deadline" ? -1 : 1;
    return (a.time || "").localeCompare(b.time || "");
  });

  // pipeline health: counts by status
  const counts = {};
  for (const r of residencies) counts[r.status] = (counts[r.status] || 0) + 1;
  const needsAttention = active.filter((r) => {
    const d = daysUntil(r.deadline);
    return (r.status === "Prospect" || r.status === "Preparing") && d !== null && d >= 0 && d <= 14;
  });

  const catColor = (e) => (e.kind === "deadline" ? countdownColor(daysUntil(e.date), "") : (EVENT_CATS[e.category] || T.accent));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* 1 — next urgent deadline */}
      <section aria-label="Next deadline">
        {hero ? (
          <button type="button" onClick={() => goto("pipeline")}
            aria-label={`Next deadline: ${hero.name}, ${countdownLabel(heroDays)}. Open in pipeline.`}
            style={{ width: "100%", textAlign: "left", cursor: "pointer", border: "none", borderRadius: 12,
              background: T.ink, color: "#fff", padding: "22px 24px",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase",
                color: "#A9ADB8", marginBottom: 6 }}>Next deadline</div>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{hero.name}</div>
              <div style={{ fontFamily: MONO, fontSize: 12.5, color: "#A9ADB8", marginTop: 6 }}>
                {fmtDate(hero.deadline)}{hero.location ? ` · ${hero.location}` : ""} · {hero.status}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: MONO, fontSize: 44, fontWeight: 700, lineHeight: 1,
                color: heroDays <= 7 ? "#FF8A7A" : heroDays <= 21 ? "#F2C14E" : "#fff" }}>
                {countdownLabel(heroDays)}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 10.5, color: "#A9ADB8", marginTop: 6 }}>open in pipeline →</div>
            </div>
          </button>
        ) : (
          <div style={{ borderRadius: 12, background: T.ink, color: "#fff", padding: "22px 24px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase",
              color: "#A9ADB8", marginBottom: 6 }}>Next deadline</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Nothing due yet</div>
            <div style={{ fontFamily: MONO, fontSize: 12, color: "#A9ADB8", marginTop: 6 }}>
              Add a residency with a deadline and it'll surface here.
            </div>
          </div>
        )}

        {runnersUp.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 8,
            background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, overflow: "hidden" }}>
            {runnersUp.map((r) => {
              const d = daysUntil(r.deadline);
              return (
                <button key={r.id} type="button" onClick={() => goto("pipeline")}
                  aria-label={`${r.name}, ${countdownLabel(d)}, ${fmtDate(r.deadline)}. Open in pipeline.`}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", cursor: "pointer",
                    background: "none", border: "none", borderTop: `1px solid ${T.paper}`, textAlign: "left", width: "100%" }}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: countdownColor(d, ""), flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap",
                    overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
                  <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: countdownColor(d, "") }}>{countdownLabel(d)}</span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: T.faint, whiteSpace: "nowrap" }}>{fmtDate(r.deadline)}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* 2 — this week */}
      <section aria-label="This week">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
          <Label>This week</Label>
          <button type="button" onClick={() => goto("calendar")}
            style={{ fontFamily: MONO, fontSize: 11, color: T.accent, background: "none", border: "none", cursor: "pointer" }}>
            full calendar →
          </button>
        </div>
        {weekItems.length === 0 ? (
          <div style={{ fontFamily: SANS, fontSize: 13, color: T.muted, background: T.card,
            border: `1px solid ${T.line}`, borderRadius: 10, padding: "16px 16px" }}>
            Nothing in the next seven days.
          </div>
        ) : (
          <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, overflow: "hidden" }}>
            {weekItems.map((e, i) => {
              const d = daysUntil(e.date);
              const rel = d === 0 ? "Today" : d === 1 ? "Tomorrow" : new Date(e.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" });
              return (
                <button key={(e.id || "") + i} type="button" onClick={() => goto(e.kind === "deadline" ? "pipeline" : "calendar")}
                  aria-label={`${rel}: ${e.title}${e.kind === "deadline" ? ", deadline" : e.time ? ", " + e.time : ""}`}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", cursor: "pointer",
                    background: "none", border: "none", borderTop: i === 0 ? "none" : `1px solid ${T.paper}`,
                    textAlign: "left", width: "100%" }}>
                  <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: e.kind === "deadline" ? 2 : 999,
                    background: catColor(e), flexShrink: 0 }} />
                  <span style={{ width: 78, flexShrink: 0, fontFamily: MONO, fontSize: 11, color: d === 0 ? T.danger : T.muted, fontWeight: d === 0 ? 700 : 400 }}>
                    {rel}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap",
                    overflow: "hidden", textOverflow: "ellipsis" }}>{e.title}</span>
                  {e.kind === "deadline"
                    ? <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: "#fff", background: catColor(e), borderRadius: 999, padding: "2px 7px" }}>{countdownLabel(d)}</span>
                    : e.time ? <span style={{ fontFamily: MONO, fontSize: 11, color: T.muted }}>{e.time}</span> : null}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* 3 — quick actions */}
      <section aria-label="Quick actions">
        <Label>Quick add</Label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn kind="primary" onClick={() => goto("pipeline", { add: true })}>+ Residency</Btn>
          <Btn onClick={() => goto("calendar", { add: true })}>+ Event</Btn>
          <Btn onClick={() => goto("contacts", { add: true })}>+ Contact</Btn>
        </div>
      </section>

      {/* 4 — pipeline health */}
      <section aria-label="Pipeline health">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
          <Label>Pipeline health</Label>
          <button type="button" onClick={() => goto("pipeline")}
            style={{ fontFamily: MONO, fontSize: 11, color: T.accent, background: "none", border: "none", cursor: "pointer" }}>
            open pipeline →
          </button>
        </div>
        {residencies.length === 0 ? (
          <div style={{ fontFamily: SANS, fontSize: 13, color: T.muted, background: T.card,
            border: `1px solid ${T.line}`, borderRadius: 10, padding: "16px 16px" }}>
            No applications yet — add your first from Quick add above.
          </div>
        ) : (
          <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: 16 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {STATUSES.map((s) => {
                const n = counts[s] || 0;
                const st = STATUS_STYLE[s];
                return (
                  <div key={s} style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 11px",
                    borderRadius: 999, background: n ? st.bg : "#F4F4EF", opacity: n ? 1 : 0.55 }}>
                    <span style={{ fontFamily: SANS, fontSize: 17, fontWeight: 800, color: n ? st.fg : T.faint }}>{n}</span>
                    <span style={{ fontFamily: SANS, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
                      textTransform: "uppercase", color: n ? st.fg : T.faint }}>{s}</span>
                  </div>
                );
              })}
            </div>
            {needsAttention.length > 0 && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.paper}` }}>
                <div style={{ fontFamily: SANS, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
                  textTransform: "uppercase", color: T.danger, marginBottom: 8 }}>
                  Needs attention · deadline within 2 weeks, not yet submitted
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {needsAttention.sort((a, b) => daysUntil(a.deadline) - daysUntil(b.deadline)).map((r) => {
                    const d = daysUntil(r.deadline);
                    return (
                      <button key={r.id} type="button" onClick={() => goto("pipeline")}
                        aria-label={`${r.name}, ${r.status}, ${countdownLabel(d)}. Open in pipeline.`}
                        style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none",
                          cursor: "pointer", textAlign: "left", width: "100%", padding: 0 }}>
                        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: countdownColor(d, ""), flexShrink: 0 }} />
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
                          overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
                        <span style={{ fontFamily: MONO, fontSize: 11, color: T.muted }}>{r.status}</span>
                        <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 700, color: countdownColor(d, "") }}>{countdownLabel(d)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- pipeline ----------
function Pipeline({ residencies, nextUp, onAdd, onUpdate, onRemove, autoAddNonce }) {
  const [adding, setAdding] = useState(false);
  useEffect(() => { if (autoAddNonce) setAdding(true); }, [autoAddNonce]);
  const [openId, setOpenId] = useState(null);

  const sorted = [...residencies].sort((a, b) => {
    const closedA = a.status === "Accepted" || a.status === "Declined";
    const closedB = b.status === "Accepted" || b.status === "Declined";
    if (closedA !== closedB) return closedA ? 1 : -1;
    const da = daysUntil(a.deadline), db = daysUntil(b.deadline);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });

  const nextDays = nextUp ? daysUntil(nextUp.deadline) : null;

  return (
    <div>
      {/* next deadline ribbon — the thing you check every morning */}
      {nextUp && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
          background: T.ink, color: "#fff", borderRadius: 10, padding: "16px 20px", marginBottom: 24, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase",
              color: "#A9ADB8", marginBottom: 4 }}>Next deadline</div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{nextUp.name}</div>
            <div style={{ fontFamily: MONO, fontSize: 12, color: "#A9ADB8", marginTop: 3 }}>
              {fmtDate(nextUp.deadline)}{nextUp.location ? ` · ${nextUp.location}` : ""}
            </div>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 34, fontWeight: 700,
            color: nextDays <= 7 ? "#FF8A7A" : "#fff" }}>
            {countdownLabel(nextDays)}
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <Label>Applications, soonest deadline first</Label>
        <Btn kind="primary" small onClick={() => setAdding((v) => !v)}>{adding ? "Close" : "+ Add residency"}</Btn>
      </div>

      {adding && <ResidencyForm onSubmit={(r) => { onAdd(r); setAdding(false); }} />}

      {sorted.length === 0 && !adding ? (
        <Empty title="No applications yet"
          body="Add the residencies you're applying to. Everything here is shared — your co-founder sees the same list." />
      ) : (
        <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, overflow: "hidden" }}>
          {sorted.map((r, i) => (
            <ResidencyRow key={r.id} r={r} last={i === sorted.length - 1}
              open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)}
              onUpdate={onUpdate} onRemove={onRemove} />
          ))}
        </div>
      )}
    </div>
  );
}

function ResidencyForm({ onSubmit, initial }) {
  const [f, setF] = useState(initial || { name: "", organization: "", location: "", deadline: "", url: "", status: "Prospect" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <Field label="Residency name" value={f.name} onChange={set("name")} placeholder="e.g. Fabrica" flexGrow minWidth={200} />
        <Field label="Organisation" value={f.organization} onChange={set("organization")} placeholder="Host / institution" flexGrow minWidth={160} />
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <Field label="Location" value={f.location} onChange={set("location")} placeholder="City, country" flexGrow minWidth={140} />
        <Field label="Deadline" type="date" value={f.deadline} onChange={set("deadline")} mono minWidth={150} />
        <div style={{ minWidth: 140 }}>
          <Label>Status</Label>
          <select value={f.status} onChange={set("status")} aria-label="Status"
            style={{ width: "100%", fontFamily: SANS, fontSize: 14, padding: "9px 10px",
              border: `1px solid ${T.line}`, borderRadius: 6, background: T.card, color: T.ink }}>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <Field label="Link" value={f.url} onChange={set("url")} placeholder="https://…" mono />
      </div>
      <Btn kind="primary" onClick={() => f.name.trim() && onSubmit(f)} disabled={!f.name.trim()}>Add to pipeline</Btn>
    </div>
  );
}

function ResidencyRow({ r, last, open, onToggle, onUpdate, onRemove }) {
  const days = daysUntil(r.deadline);
  const closed = r.status === "Accepted" || r.status === "Declined";
  return (
    <div style={{ borderBottom: last ? "none" : `1px solid ${T.line}`, opacity: closed ? 0.55 : 1 }}>
      <div onClick={onToggle} role="button" tabIndex={0} aria-expanded={open}
        aria-label={`${r.name}, status ${r.status}. ${open ? "Collapse" : "Expand"} details.`}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px", cursor: "pointer" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {r.name}
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11.5, color: T.muted, marginTop: 2,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {[r.organization, r.location].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        <Pill status={r.status} />
        <div style={{ width: 118, textAlign: "right" }}>
          <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: countdownColor(days, r.status) }}>
            {countdownLabel(days) || "no date"}
          </div>
          <div style={{ fontFamily: MONO, fontSize: 10.5, color: T.faint }}>{fmtDate(r.deadline)}</div>
        </div>
      </div>

      {open && (
        <div style={{ padding: "4px 16px 16px", background: "#FBFBF9" }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12, paddingTop: 10 }}>
            <div style={{ minWidth: 150 }}>
              <Label>Status</Label>
              <select value={r.status} onChange={(e) => onUpdate(r.id, { status: e.target.value })} aria-label="Status"
                style={{ width: "100%", fontFamily: SANS, fontSize: 13, padding: "8px 10px",
                  border: `1px solid ${T.line}`, borderRadius: 6, background: T.card, color: T.ink }}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <Field label="Deadline" type="date" value={r.deadline || ""} mono minWidth={150}
              onChange={(e) => onUpdate(r.id, { deadline: e.target.value })} />
            <Field label="Owner" value={r.owner || ""} placeholder="Who's driving this?" minWidth={150}
              onChange={(e) => onUpdate(r.id, { owner: e.target.value })} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <Label>Notes — materials needed, fees, portfolio angle…</Label>
            <textarea value={r.notes || ""} aria-label="Notes" onChange={(e) => onUpdate(r.id, { notes: e.target.value })}
              rows={3}
              style={{ width: "100%", boxSizing: "border-box", fontFamily: SANS, fontSize: 13.5, lineHeight: 1.5,
                color: T.ink, background: T.card, border: `1px solid ${T.line}`, borderRadius: 6,
                padding: "9px 10px", resize: "vertical", outline: "none" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            {r.url ? (
              <a href={r.url} target="_blank" rel="noreferrer" aria-label={`Open official page for ${r.name} in a new tab`}
                style={{ fontFamily: MONO, fontSize: 12, color: T.accent, textDecoration: "none" }}>
                {r.url.replace(/^https?:\/\//, "").slice(0, 48)} ↗
              </a>
            ) : <span />}
            <Btn kind="danger" small onClick={() => onRemove(r.id)}>Remove</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- calendar ----------
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const EVENT_CATS = { General: T.accent, Meeting: T.ok, Reminder: "#7A2FA0", Travel: T.amber };
const CAT_LIST = Object.keys(EVENT_CATS);

const pad2 = (n) => String(n).padStart(2, "0");
const toYMD = (dt) => `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
const todayYMD = () => toYMD(new Date());

function buildGrid(year, month) {
  const first = new Date(year, month, 1);
  const startDow = (first.getDay() + 6) % 7; // Monday = 0
  const start = new Date(year, month, 1 - startDow);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const dt = new Date(start);
    dt.setDate(start.getDate() + i);
    cells.push({ date: toYMD(dt), day: dt.getDate(), out: dt.getMonth() !== month });
  }
  // trim a fully-trailing 6th week to match Apple's compact months
  if (cells.slice(35).every((c) => c.out)) return cells.slice(0, 35);
  return cells;
}

function longDate(ymd) {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function Calendar({ events, deadlineEvents, onAdd, onUpdate, onRemove, onGoto, autoAddNonce }) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selected, setSelected] = useState(todayYMD());
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState(null);
  useEffect(() => { if (autoAddNonce) { setAdding(true); setEditId(null); } }, [autoAddNonce]);

  const grid = buildGrid(cursor.y, cursor.m);
  const today = todayYMD();

  // map date -> events (deadlines first, then manual sorted by time)
  const byDate = {};
  for (const e of deadlineEvents) (byDate[e.date] = byDate[e.date] || []).push(e);
  for (const e of events) (byDate[e.date] = byDate[e.date] || []).push({ ...e, kind: "manual" });
  for (const k of Object.keys(byDate)) {
    byDate[k].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "deadline" ? -1 : 1;
      return (a.time || "").localeCompare(b.time || "");
    });
  }

  const selectedEvents = byDate[selected] || [];
  const monthLabel = `${MONTH_NAMES[cursor.m]} ${cursor.y}`;
  const step = (delta) => {
    const m = cursor.m + delta;
    setCursor({ y: cursor.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 });
  };
  const goToday = () => { setCursor({ y: now.getFullYear(), m: now.getMonth() }); setSelected(today); };

  const eventColor = (e) => {
    if (e.kind === "deadline") { const d = daysUntil(e.date); return countdownColor(d, ""); }
    return EVENT_CATS[e.category] || T.accent;
  };

  // heat treatment for a day that has a deadline: escalates by soonest urgency
  const heatFor = (days) => {
    if (days === null || days === undefined) return null;
    if (days <= 7) return { bg: T.dangerSoft, edge: T.danger };
    if (days <= 21) return { bg: T.amberSoft, edge: T.amber };
    return { bg: T.accentSoft, edge: T.accent };
  };
  const cellHeat = (evs) => {
    const dls = evs.filter((e) => e.kind === "deadline").map((e) => daysUntil(e.date)).filter((d) => d !== null);
    if (!dls.length) return null;
    return heatFor(Math.min(...dls));
  };

  return (
    <div>
      {/* header: month nav + today + add */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <button type="button" onClick={() => step(-1)} aria-label="Previous month"
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: T.accent, padding: "2px 8px", lineHeight: 1 }}>‹</button>
          <button type="button" onClick={() => step(1)} aria-label="Next month"
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: T.accent, padding: "2px 8px", lineHeight: 1 }}>›</button>
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", margin: 0 }} aria-live="polite">{monthLabel}</h2>
        <span style={{ flex: 1 }} />
        <Btn small onClick={goToday}>Today</Btn>
        <Btn small kind="primary" onClick={() => { setAdding(true); setEditId(null); }}>+ Add event</Btn>
      </div>

      {/* weekday header */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
        {WEEKDAYS.map((w) => (
          <div key={w} style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em",
            textTransform: "uppercase", color: T.muted, textAlign: "center", padding: "4px 0" }}>{w}</div>
        ))}
      </div>

      {/* month grid */}
      <div role="grid" aria-label={monthLabel}
        style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 20 }}>
        {grid.map((c) => {
          const evs = byDate[c.date] || [];
          const isToday = c.date === today;
          const isSel = c.date === selected;
          const heat = cellHeat(evs);
          const bg = isSel ? T.accentSoft : heat ? heat.bg : T.card;
          const edge = isSel ? T.accent : heat ? heat.edge : T.line;
          return (
            <button key={c.date} type="button" role="gridcell" onClick={() => setSelected(c.date)}
              aria-label={`${longDate(c.date)}${evs.length ? `, ${evs.length} event${evs.length > 1 ? "s" : ""}` : ""}${heat ? ", has a deadline" : ""}`}
              aria-pressed={isSel}
              style={{ minHeight: 78, textAlign: "left", cursor: "pointer", padding: 5,
                background: bg,
                border: `${heat && !isSel ? 2 : 1}px solid ${edge}`, borderRadius: 8,
                opacity: c.out ? 0.4 : 1, display: "flex", flexDirection: "column", gap: 3, overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <span style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 700,
                  width: 22, height: 22, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center",
                  background: isToday ? T.danger : "transparent", color: isToday ? "#fff" : T.ink }}>
                  {c.day}
                </span>
              </div>
              {evs.slice(0, 3).map((e, i) => (
                e.kind === "deadline" ? (
                  <div key={i} style={{ display: "flex", alignItems: "center", background: eventColor(e),
                    borderRadius: 4, padding: "1px 4px", minWidth: 0 }}>
                    <span style={{ fontFamily: SANS, fontSize: 10, fontWeight: 700, color: "#fff",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.title}</span>
                  </div>
                ) : (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                    <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, background: eventColor(e), flexShrink: 0 }} />
                    <span style={{ fontFamily: SANS, fontSize: 10.5, color: T.ink, whiteSpace: "nowrap",
                      overflow: "hidden", textOverflow: "ellipsis" }}>
                      {e.title}
                    </span>
                  </div>
                )
              ))}
              {evs.length > 3 && (
                <span style={{ fontFamily: MONO, fontSize: 9.5, color: T.muted }}>+{evs.length - 3} more</span>
              )}
            </button>
          );
        })}
      </div>

      {/* selected-day agenda */}
      <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{longDate(selected)}</h3>
          <Btn small onClick={() => { setAdding(true); setEditId(null); }}>+ Add on this day</Btn>
        </div>

        {adding && (
          <EventForm defaultDate={selected} onCancel={() => setAdding(false)}
            onSave={(e) => { onAdd(e); setAdding(false); setSelected(e.date); if (e.date) setCursor({ y: +e.date.slice(0,4), m: +e.date.slice(5,7) - 1 }); }} />
        )}

        {selectedEvents.length === 0 && !adding ? (
          <div style={{ fontFamily: SANS, fontSize: 13, color: T.muted, padding: "8px 0" }}>
            Nothing scheduled. Application deadlines from your pipeline show up here automatically.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {selectedEvents.map((e) => (
              editId === e.id && e.kind === "manual" ? (
                <EventForm key={e.id} defaultDate={selected} initial={e} onCancel={() => setEditId(null)}
                  onSave={(patch) => { onUpdate(e.id, patch); setEditId(null); }} />
              ) : (
                <div key={e.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 0",
                  borderTop: `1px solid ${T.paper}` }}>
                  <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: e.kind === "deadline" ? 2 : 999,
                    background: eventColor(e), marginTop: 4, flexShrink: 0 }} />
                  <div style={{ width: 62, flexShrink: 0, paddingTop: 1 }}>
                    {e.kind === "deadline" ? (
                      <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: "#fff",
                        background: eventColor(e), borderRadius: 999, padding: "2px 7px", whiteSpace: "nowrap" }}>
                        {countdownLabel(daysUntil(e.date)) || "due"}
                      </span>
                    ) : (
                      <span style={{ fontFamily: MONO, fontSize: 11, color: T.muted }}>{e.time || "All-day"}</span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{e.title}</div>
                    {e.kind === "deadline" ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
                        <Pill status={e.status} />
                        <button type="button" onClick={onGoto}
                          style={{ fontFamily: MONO, fontSize: 11, color: T.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                          open in pipeline →
                        </button>
                      </div>
                    ) : (
                      <>
                        {e.note && <div style={{ fontSize: 12.5, color: T.muted, marginTop: 2, lineHeight: 1.5 }}>{e.note}</div>}
                        <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                          <button type="button" onClick={() => { setEditId(e.id); setAdding(false); }}
                            style={{ fontFamily: MONO, fontSize: 11, color: T.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}>edit</button>
                          <button type="button" onClick={() => onRemove(e.id)}
                            style={{ fontFamily: MONO, fontSize: 11, color: T.danger, background: "none", border: "none", cursor: "pointer", padding: 0 }}>remove</button>
                        </div>
                      </>
                    )}
                  </div>
                  {e.kind === "deadline" && (
                    <span aria-label="from pipeline" title="Auto-added from pipeline"
                      style={{ fontSize: 12, color: eventColor(e), whiteSpace: "nowrap" }}>⚑</span>
                  )}
                </div>
              )
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 12, fontFamily: MONO, fontSize: 10.5, color: T.muted }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: T.danger }} /> deadline (from pipeline)
        </span>
        {CAT_LIST.map((c) => (
          <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: EVENT_CATS[c] }} /> {c.toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  );
}

function EventForm({ defaultDate, initial, onSave, onCancel }) {
  const [f, setF] = useState(initial || { title: "", date: defaultDate, time: "", category: "General", note: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const selStyle = { width: "100%", fontFamily: SANS, fontSize: 14, padding: "9px 10px",
    border: `1px solid ${T.line}`, borderRadius: 6, background: T.card, color: T.ink };
  return (
    <div style={{ background: "#FBFBF9", border: `1px solid ${T.line}`, borderRadius: 8, padding: 14, marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <Field label="Title" value={f.title} onChange={set("title")} placeholder="e.g. Portfolio review call" flexGrow minWidth={200} />
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <Field label="Date" type="date" value={f.date} onChange={set("date")} mono minWidth={150} />
        <Field label="Time (optional)" type="time" value={f.time} onChange={set("time")} mono minWidth={130} />
        <div style={{ minWidth: 140 }}>
          <Label htmlFor="ev-cat">Category</Label>
          <select id="ev-cat" aria-label="Category" value={f.category} onChange={set("category")} style={selStyle}>
            {CAT_LIST.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <Field label="Note (optional)" value={f.note} onChange={set("note")} placeholder="Details, location, link…" flexGrow />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="primary" small disabled={!f.title.trim() || !f.date}
          onClick={() => f.title.trim() && f.date && onSave({ title: f.title.trim(), date: f.date, time: f.time, category: f.category, note: f.note })}>
          {initial ? "Save changes" : "Add event"}
        </Btn>
        <Btn small onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

// ---------- contacts ----------
function Contacts({ contacts, residencies, onAdd, onUpdate, onRemove, autoAddNonce }) {
  const [adding, setAdding] = useState(false);
  useEffect(() => { if (autoAddNonce) setAdding(true); }, [autoAddNonce]);
  const [openId, setOpenId] = useState(null);
  const [f, setF] = useState({ name: "", role: "", organization: "", email: "", relatedTo: "", notes: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const sorted = [...contacts].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <Label>People — curators, coordinators, references, alumni</Label>
        <Btn kind="primary" small onClick={() => setAdding((v) => !v)}>{adding ? "Close" : "+ Add contact"}</Btn>
      </div>

      {adding && (
        <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <Field label="Name" value={f.name} onChange={set("name")} flexGrow minWidth={180} />
            <Field label="Role" value={f.role} onChange={set("role")} placeholder="e.g. Programme curator" flexGrow minWidth={160} />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <Field label="Organisation" value={f.organization} onChange={set("organization")} flexGrow minWidth={160} />
            <Field label="Email" value={f.email} onChange={set("email")} mono flexGrow minWidth={180} />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <Label>Related residency</Label>
              <select value={f.relatedTo} onChange={set("relatedTo")} aria-label="Related residency"
                style={{ width: "100%", fontFamily: SANS, fontSize: 14, padding: "9px 10px",
                  border: `1px solid ${T.line}`, borderRadius: 6, background: T.card, color: T.ink }}>
                <option value="">—</option>
                {residencies.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
              </select>
            </div>
            <Field label="Notes" value={f.notes} onChange={set("notes")} placeholder="How you know them, last contact…" flexGrow minWidth={220} />
          </div>
          <Btn kind="primary" disabled={!f.name.trim()}
            onClick={() => { onAdd(f); setF({ name: "", role: "", organization: "", email: "", relatedTo: "", notes: "" }); setAdding(false); }}>
            Add contact
          </Btn>
        </div>
      )}

      {sorted.length === 0 && !adding ? (
        <Empty title="No contacts yet"
          body="Keep everyone connected to your applications in one shared place — coordinators, references, past residents who'll answer questions." />
      ) : (
        <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, overflow: "hidden" }}>
          {sorted.map((c, i) => (
            <div key={c.id} style={{ borderBottom: i === sorted.length - 1 ? "none" : `1px solid ${T.line}` }}>
              <div onClick={() => setOpenId(openId === c.id ? null : c.id)}
                role="button" tabIndex={0} aria-expanded={openId === c.id}
                aria-label={`${c.name}${c.role ? ", " + c.role : ""}. ${openId === c.id ? "Collapse" : "Expand"} details.`}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenId(openId === c.id ? null : c.id); } }}
                style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px", cursor: "pointer" }}>
                <div aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 999, background: T.accentSoft, color: T.accent,
                  display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
                  {(c.name || "?").trim().slice(0, 1).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>{c.name}</div>
                  <div style={{ fontFamily: MONO, fontSize: 11.5, color: T.muted, marginTop: 2,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {[c.role, c.organization].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                {c.relatedTo && (
                  <span style={{ fontFamily: SANS, fontSize: 11, fontWeight: 700, color: T.accent,
                    background: T.accentSoft, borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>
                    {c.relatedTo}
                  </span>
                )}
              </div>
              {openId === c.id && (
                <div style={{ padding: "4px 16px 16px", background: "#FBFBF9" }}>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12, paddingTop: 10 }}>
                    <Field label="Email" value={c.email || ""} mono flexGrow minWidth={200}
                      onChange={(e) => onUpdate(c.id, { email: e.target.value })} />
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <Label>Related residency</Label>
                      <select value={c.relatedTo || ""} onChange={(e) => onUpdate(c.id, { relatedTo: e.target.value })} aria-label="Related residency"
                        style={{ width: "100%", fontFamily: SANS, fontSize: 13, padding: "8px 10px",
                          border: `1px solid ${T.line}`, borderRadius: 6, background: T.card, color: T.ink }}>
                        <option value="">—</option>
                        {residencies.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <Label>Notes</Label>
                    <textarea value={c.notes || ""} aria-label="Notes" rows={2}
                      onChange={(e) => onUpdate(c.id, { notes: e.target.value })}
                      style={{ width: "100%", boxSizing: "border-box", fontFamily: SANS, fontSize: 13.5, lineHeight: 1.5,
                        color: T.ink, background: T.card, border: `1px solid ${T.line}`, borderRadius: 6,
                        padding: "9px 10px", resize: "vertical", outline: "none" }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <Btn kind="danger" small onClick={() => onRemove(c.id)}>Remove</Btn>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- auth gate ----------
function CenterNote({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: T.paper, display: "flex", alignItems: "center",
      justifyContent: "center", fontFamily: MONO, fontSize: 13, color: T.muted }}>
      {children}
    </div>
  );
}

function Login() {
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const submit = async () => {
    if (!email.trim() || !pw || busy) return;
    setBusy(true); setMsg(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password: pw });
        if (error) throw error;
        setMsg("Account created. If email confirmation is on, confirm via your inbox, then sign in.");
        setMode("signin");
      }
    } catch (e) {
      setMsg(e.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: T.paper, color: T.ink, fontFamily: SANS,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 4 }}>Studio Desk</div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, marginBottom: 22 }}>
          shared studio management · sign in to continue
        </div>
        <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              mono placeholder="you@studio.com" />
            <Field label="Password" type="password" value={pw} onChange={(e) => setPw(e.target.value)}
              mono placeholder="••••••••"
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
            <Btn kind="primary" onClick={submit} disabled={busy || !email.trim() || !pw}>
              {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
            </Btn>
          </div>
          {msg && (
            <div role="alert" style={{ fontFamily: SANS, fontSize: 12.5, color: T.danger,
              background: T.dangerSoft, borderRadius: 8, padding: "9px 11px", marginTop: 12, lineHeight: 1.5 }}>
              {msg}
            </div>
          )}
          <button type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMsg(null); }}
            style={{ fontFamily: MONO, fontSize: 11, color: T.accent, background: "none", border: "none",
              cursor: "pointer", marginTop: 14, padding: 0 }}>
            {mode === "signin" ? "Need an account? Create one" : "Have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <CenterNote>Loading…</CenterNote>;
  if (!session) return <Login />;
  return <StudioApp />;
}
