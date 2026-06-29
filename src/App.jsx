import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Home, Calendar, Check, Plus, Trash2, Briefcase, Utensils, HeartPulse,
  RefreshCw, ChevronLeft, ChevronRight, User, X, Flame, TrendingUp,
  Stethoscope, Lightbulb, ArrowRight, Pencil, LogOut, Heart
} from "lucide-react";

const SEED_PEOPLE = {
  rafa: { name: "Rafaela", color: "#4F46A8", role: "PM · Turbi" },
  lucas: { name: "Lucas", color: "#0E7C61", role: "Eng. de dados · Pitzi" },
  both: { name: "Juntos", color: "#B06A2C", role: "Os dois" },
};

function softOf(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const mix = (c) => Math.round(c + (255 - c) * 0.88);
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

const PERSON_COLORS = ["#4F46A8", "#0E7C61", "#B06A2C", "#C04574", "#185FA5", "#7A4DB0", "#2E7D54"];

const DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const DAY_FULL = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

const CATEGORIES = {
  casa: { label: "Casa", icon: Home, color: "#4F46A8", soft: "#EEEDFB" },
  saude: { label: "Saúde", icon: HeartPulse, color: "#C04574", soft: "#FBEAF1" },
  vida: { label: "Vida", icon: Utensils, color: "#B06A2C", soft: "#FAF0E4" },
};

// Recurring task templates (the "rules" of the routine)
const SEED_TEMPLATES = [
  { id: "t1", title: "Lavar a louça", cat: "casa", who: "lucas", days: [0, 2, 4] },
  { id: "t2", title: "Arrumar a cama", cat: "casa", who: "rafa", days: [0, 1, 2, 3, 4] },
  { id: "t3", title: "Tirar o lixo", cat: "casa", who: "lucas", days: [1, 4] },
  { id: "t4", title: "Cozinhar o jantar", cat: "vida", who: "both", days: [2], flexible: true },
  { id: "t5", title: "Preparar marmitas da semana", cat: "vida", who: "both", days: [6] },
  { id: "t6", title: "Compras da semana", cat: "vida", who: "both", days: [5] },
  { id: "t7", title: "Caminhada juntos", cat: "saude", who: "both", days: [1, 3] },
  { id: "t8", title: "Faxina leve", cat: "casa", who: "rafa", days: [3] },
];

const todayIdx = () => {
  const js = new Date().getDay();
  return js === 0 ? 6 : js - 1;
};

// Monday-anchored week id, e.g. "2026-06-08"
function mondayOf(offset) {
  const d = new Date();
  const js = d.getDay();
  const diff = js === 0 ? -6 : 1 - js;
  d.setDate(d.getDate() + diff + offset * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}
function weekId(offset) {
  const m = mondayOf(offset);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-${String(m.getDate()).padStart(2, "0")}`;
}
function weekLabel(offset) {
  const m = mondayOf(offset);
  const s = new Date(m); const e = new Date(m); e.setDate(e.getDate() + 6);
  const fmt = (x) => `${x.getDate()}/${x.getMonth() + 1}`;
  const rel = offset === 0 ? "Esta semana" : offset === 1 ? "Próxima" : offset === -1 ? "Semana passada" : null;
  return { range: `${fmt(s)} – ${fmt(e)}`, rel };
}

import { supabase } from "./supabaseClient";

// One household row holds everything. We load it once, subscribe to
// realtime changes (so the other person's edits appear live), and
// write back debounced. The shape mirrors the original three blobs:
// { templates, weeks, people }.
const EMPTY = { templates: SEED_TEMPLATES, weeks: {}, people: SEED_PEOPLE };

function useHousehold(code) {
  const [data, setData] = useState(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const saveTimer = useRef(null);
  const skipNextRealtime = useRef(false);

  useEffect(() => {
    if (!code) return;
    let active = true;
    setLoaded(false);
    (async () => {
      try {
        const { data: row, error: selErr } = await supabase
          .from("households").select("*").eq("code", code).maybeSingle();
        if (selErr) throw selErr;
        if (!active) return;
        if (!row) {
          // first time this code is used — create it seeded
          const { error: insErr } = await supabase.from("households").insert({
            code, templates: SEED_TEMPLATES, weeks: {}, people: SEED_PEOPLE,
          });
          if (insErr) throw insErr;
          setData(EMPTY);
        } else {
          setData({
            templates: row.templates?.length ? row.templates : SEED_TEMPLATES,
            weeks: row.weeks || {},
            people: row.people && Object.keys(row.people).length ? row.people : SEED_PEOPLE,
          });
        }
        setLoaded(true);
      } catch (e) {
        if (active) { setError(e.message || String(e)); setLoaded(true); }
      }
    })();

    const channel = supabase
      .channel(`household:${code}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "households", filter: `code=eq.${code}` },
        (payload) => {
          if (skipNextRealtime.current) { skipNextRealtime.current = false; return; }
          const r = payload.new;
          setData({
            templates: r.templates || SEED_TEMPLATES,
            weeks: r.weeks || {},
            people: r.people && Object.keys(r.people).length ? r.people : SEED_PEOPLE,
          });
        })
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, [code]);

  const persist = useCallback((next) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      skipNextRealtime.current = true;
      const { error: upErr } = await supabase.from("households")
        .update({ templates: next.templates, weeks: next.weeks, people: next.people })
        .eq("code", code);
      if (upErr) setError(upErr.message);
    }, 500);
  }, [code]);

  // setters that match the original (value or updater fn)
  const makeSetter = (field) => (next) =>
    setData((prev) => {
      const resolved = typeof next === "function" ? next(prev[field]) : next;
      const merged = { ...prev, [field]: resolved };
      persist(merged);
      return merged;
    });

  return {
    templates: data.templates, setTemplates: makeSetter("templates"),
    weeks: data.weeks, setWeeks: makeSetter("weeks"),
    peopleRaw: data.people, setPeopleRaw: makeSetter("people"),
    loaded, error,
  };
}

// Identifica o lar de vocês dois. Como o app é só de vocês, não precisa
// digitar código nenhum: os dois abrem o link e veem os mesmos dados.
// Se quiserem, troquem por algo só de vocês (ex: "lar-bacellar-2024").
const HOUSEHOLD_CODE = "lar-rafa-lucas";

export default function App() {
  return <Routine />;
}

function Routine() {
  const code = HOUSEHOLD_CODE;
  const [tab, setTab] = useState("hoje");
  const [offset, setOffset] = useState(0);
  useEffect(() => { if (tab === "hoje" && offset !== 0) setOffset(0); }, [tab, offset]);
  const wid = weekId(offset);
  const ti = todayIdx();

  const { templates, setTemplates, weeks, setWeeks, peopleRaw, setPeopleRaw, loaded, error } = useHousehold(code);

  const PEOPLE = useMemo(() => {
    const out = {};
    for (const k of Object.keys(peopleRaw)) out[k] = { ...peopleRaw[k], soft: softOf(peopleRaw[k].color) };
    return out;
  }, [peopleRaw]);

  const week = weeks[wid] || { done: {}, presence: {}, skip: {}, move: {}, meals: {}, appts: [], wins: "" };


  const patchWeek = useCallback((patch) => {
    setWeeks((prev) => {
      const cur = prev[wid] || { done: {}, presence: {}, skip: {}, move: {}, meals: {}, appts: [], wins: "" };
      return { ...prev, [wid]: { ...cur, ...patch } };
    });
  }, [wid, setWeeks]);

  // Effective day for a task this week (move overrides shift it)
  const effectiveDays = useCallback((t) => {
    const moved = week.move[t.id];
    if (moved && moved.length) return moved;
    return t.days;
  }, [week]);

  const isDone = (t, d) => !!week.done[`${t.id}:${d}`];
  const isSkipped = (t, d) => !!week.skip[`${t.id}:${d}`];

  const toggleDone = (t, d) => {
    const k = `${t.id}:${d}`;
    patchWeek({ done: { ...week.done, [k]: !week.done[k] } });
  };

  const togglePresence = (person, d) => {
    const cur = week.presence[person] || [];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d];
    patchWeek({ presence: { ...week.presence, [person]: next } });
  };

  // ---- Presence-aware suggestions ----
  // If a flexible "juntos" task lands on a day where someone is at the office,
  // suggest moving it to the nearest day both are home.
  const suggestions = useMemo(() => {
    const out = [];
    const rafaOut = week.presence.rafa || [];
    const lucasOut = week.presence.lucas || [];
    const bothHome = (d) => !rafaOut.includes(d) && !lucasOut.includes(d);
    templates.forEach((t) => {
      if (!t.flexible) return;
      const days = effectiveDays(t);
      days.forEach((d) => {
        const needsBoth = t.who === "both";
        const clash = needsBoth ? (rafaOut.includes(d) || lucasOut.includes(d)) : false;
        if (!clash) return;
        const whoOut = [];
        if (rafaOut.includes(d)) whoOut.push("rafa");
        if (lucasOut.includes(d)) whoOut.push("lucas");
        // find nearest earlier home day, else nearest later
        let best = null;
        for (let delta = 1; delta <= 6; delta++) {
          const earlier = d - delta;
          if (earlier >= 0 && bothHome(earlier) && !days.includes(earlier)) { best = earlier; break; }
          const later = d + delta;
          if (later <= 6 && bothHome(later) && !days.includes(later)) { best = later; break; }
        }
        out.push({ task: t, from: d, to: best, whoOut });
      });
    });
    return out;
  }, [templates, week, effectiveDays]);

  const applyMove = (taskId, from, to) => {
    const t = templates.find((x) => x.id === taskId);
    const base = effectiveDays(t);
    const filtered = base.filter((d) => d !== from);
    const next = to === null ? filtered : Array.from(new Set([...filtered, to])).sort((a, b) => a - b);
    patchWeek({ move: { ...week.move, [taskId]: next } });
  };

  // ---- Stats ----
  const stats = useMemo(() => {
    let total = 0, done = 0;
    templates.forEach((t) => {
      effectiveDays(t).forEach((d) => {
        if (isSkipped(t, d)) return;
        total++;
        if (isDone(t, d)) done++;
      });
    });
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  }, [templates, week, effectiveDays]);

  // streak across weeks (consecutive past weeks with >=70% done)
  const streak = useMemo(() => {
    let s = 0;
    for (let o = -1; o >= -52; o--) {
      const w = weeks[weekId(o)];
      if (!w) break;
      let tot = 0, dn = 0;
      templates.forEach((t) => t.days.forEach((d) => { tot++; if (w.done?.[`${t.id}:${d}`]) dn++; }));
      if (tot && dn / tot >= 0.7) s++; else break;
    }
    return s;
  }, [weeks, templates]);

  const todayTasks = useMemo(
    () => templates.filter((t) => effectiveDays(t).includes(ti) && !isSkipped(t, ti)),
    [templates, ti, effectiveDays, week]
  );

  if (error) {
    return (
      <div style={{ maxWidth: 480, margin: "40px auto", fontFamily: "Inter, system-ui, sans-serif", textAlign: "center", color: "#26251F", background: "#FBEAF1", border: "1px solid #F2D2DF", borderRadius: 14, padding: "24px 22px" }}>
        <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>Não consegui conectar ao banco</div>
        <div style={{ fontSize: 13, color: "#8A2E4E", lineHeight: 1.5, marginBottom: 14 }}>{error}</div>
        <div style={{ fontSize: 12.5, color: "#6E6D66" }}>Verifique se as chaves do Supabase no arquivo <code>.env</code> estão corretas e se o schema SQL foi aplicado.</div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 360, color: "#9b9a94", fontFamily: "Inter, system-ui, sans-serif" }}>
        <RefreshCw size={16} style={{ marginRight: 8, animation: "spin 1s linear infinite" }} /> Carregando a rotina…
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  const C = {
    bg: "#FBFBFA", surface: "#FFFFFF", line: "#ECEBE7", line2: "#E0DFD9",
    ink: "#26251F", sub: "#6E6D66", faint: "#9B9A94", accent: "#4F46A8",
  };

  const TABS = [
    { id: "hoje", label: "Hoje", icon: Check },
    { id: "semana", label: "Semana", icon: Calendar },
    { id: "presencial", label: "Presencial", icon: Briefcase },
    { id: "saude", label: "Saúde & vida", icon: HeartPulse },
    { id: "historico", label: "Histórico", icon: TrendingUp },
    { id: "rotina", label: "Rotina", icon: Home },
  ];

  const card = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14 };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", fontFamily: "Inter, system-ui, sans-serif", color: C.ink, background: C.bg, padding: "20px 18px", borderRadius: 18 }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
        .rot-tab:hover{background:#F3F2EF}
        .rot-row:hover{border-color:${C.line2}}
        .rot-btn:hover{background:#F3F2EF}
        input,textarea{font-family:inherit}
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <div style={{ width: 38, height: 38, borderRadius: 11, background: C.ink, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Home size={18} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 500, letterSpacing: -0.2 }}>Organização do nosso lar</div>
            <div style={{ fontSize: 12.5, color: C.sub }}>{PEOPLE.rafa.name} & {PEOPLE.lucas.name}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {streak > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#FAF0E4", color: "#B06A2C", padding: "6px 11px", borderRadius: 10, fontSize: 12.5, fontWeight: 500 }}>
              <Flame size={14} /> {streak} {streak === 1 ? "semana" : "semanas"} firme
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 3, marginBottom: 18, background: "#F3F2EF", padding: 4, borderRadius: 12, overflowX: "auto" }}>
        {TABS.map((t) => {
          const Ic = t.icon; const on = tab === t.id;
          return (
            <button key={t.id} className="rot-tab" onClick={() => setTab(t.id)}
              style={{ flex: "1 0 auto", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 10px", borderRadius: 9, border: "none", cursor: "pointer", whiteSpace: "nowrap",
                background: on ? C.surface : "transparent", color: on ? C.ink : C.sub, fontWeight: on ? 500 : 400, fontSize: 13,
                boxShadow: on ? "0 1px 3px rgba(0,0,0,0.07)" : "none" }}>
              <Ic size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Week navigator (shared by several tabs) */}
      {["semana", "presencial", "saude"].includes(tab) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <button className="rot-btn" onClick={() => setOffset(offset - 1)} style={{ ...iconBtn }}><ChevronLeft size={18} /></button>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{weekLabel(offset).rel || weekLabel(offset).range}</div>
            <div style={{ fontSize: 12, color: C.faint }}>{weekLabel(offset).range}</div>
          </div>
          <button className="rot-btn" onClick={() => setOffset(offset + 1)} style={{ ...iconBtn }}><ChevronRight size={18} /></button>
        </div>
      )}

      {/* ---------- HOJE ---------- */}
      {tab === "hoje" && (
        <div style={{ animation: "fade .25s ease" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 500 }}>{DAY_FULL[ti]}</div>
            <div style={{ fontSize: 12.5, color: C.sub }}>{todayTasks.filter((t) => isDone(t, ti)).length} de {todayTasks.length} feitas</div>
          </div>

          {/* presence-aware nudge */}
          {suggestions.filter((s) => s.from === ti || effectiveDays(s.task).includes(ti)).length === 0 && suggestions.length > 0 && (
            <div style={{ ...card, padding: "12px 14px", marginBottom: 14, background: "#FFF9EE", borderColor: "#F0E2C4", display: "flex", gap: 10 }}>
              <Lightbulb size={17} color="#B06A2C" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 13, color: "#7A4E18", lineHeight: 1.5 }}>
                Há ajustes sugeridos para esta semana por causa dos dias presenciais. Veja na aba <b style={{ fontWeight: 500 }}>Presencial</b>.
              </div>
            </div>
          )}

          {(() => {
            const order = ["rafa", "lucas", "both"];
            const dayAppts = (week.appts || []).filter((a) => a.day === ti);
            const groups = order.map((pk) => ({
              pk,
              tasks: todayTasks.filter((t) => t.who === pk),
              appts: dayAppts.filter((a) => a.who === pk),
            })).filter((g) => g.tasks.length || g.appts.length);
            if (groups.length === 0) {
              return <div style={{ textAlign: "center", padding: "40px 0", color: C.faint, fontSize: 13.5 }}>Nada para hoje. Respira e aproveita.</div>;
            }
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {groups.map((g) => {
                  const p = PEOPLE[g.pk]; const doneCount = g.tasks.filter((t) => isDone(t, ti)).length;
                  return (
                    <div key={g.pk}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 99, background: p.color }} />
                        <div style={{ fontSize: 13, fontWeight: 500, color: p.color }}>{p.name}</div>
                        {g.tasks.length > 0 && <div style={{ fontSize: 11.5, color: C.faint }}>{doneCount}/{g.tasks.length}</div>}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {g.tasks.map((t) => {
                          const done = isDone(t, ti); const cat = CATEGORIES[t.cat]; const Ic = cat.icon;
                          return (
                            <div key={t.id} className="rot-row" onClick={() => toggleDone(t, ti)}
                              style={{ ...card, display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", cursor: "pointer", opacity: done ? 0.55 : 1, transition: "opacity .15s, border-color .15s" }}>
                              <div style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${done ? cat.color : "#D6D5CF"}`, background: done ? cat.color : "transparent" }}>
                                {done && <Check size={13} color="#fff" />}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14.5, textDecoration: done ? "line-through" : "none" }}>{t.title}</div>
                                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                                  <Tag soft={cat.soft} color={cat.color}><Ic size={11} /> {cat.label}</Tag>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {g.appts.map((a, ai) => (
                          <div key={"a" + ai} style={{ ...card, display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", background: "#FBEAF1", borderColor: "#F2D2DF" }}>
                            <Stethoscope size={17} color="#C04574" style={{ flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 14.5 }}>{a.title}</div>
                              <div style={{ fontSize: 11.5, color: "#8A2E4E", marginTop: 2 }}>{a.when || "compromisso"}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* ---------- SEMANA ---------- */}
      {tab === "semana" && (
        <div style={{ animation: "fade .25s ease" }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <Metric label="Concluídas" value={`${stats.done}/${stats.total}`} />
            <Metric label="Progresso" value={`${stats.pct}%`} />
          </div>
          <div style={{ height: 6, background: "#ECEBE7", borderRadius: 99, overflow: "hidden", marginBottom: 18 }}>
            <div style={{ height: "100%", width: `${stats.pct}%`, background: C.accent, borderRadius: 99, transition: "width .3s" }} />
          </div>

          <div style={{ overflowX: "auto", margin: "0 -4px", padding: "0 4px" }}>
            <table style={{ width: "100%", minWidth: 600, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", fontSize: 11.5, fontWeight: 500, color: C.faint, padding: "0 8px 8px 0", width: 170 }}>Tarefa</th>
                  {DAYS.map((d, i) => (
                    <th key={d} style={{ textAlign: "center", fontSize: 11.5, fontWeight: 500, padding: "0 2px 8px", color: i === ti && offset === 0 ? C.accent : C.faint }}>{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {["rafa", "lucas", "both"].map((pk) => {
                  const items = templates.filter((t) => t.who === pk);
                  if (!items.length) return null;
                  const pp = PEOPLE[pk];
                  return (
                    <React.Fragment key={pk}>
                      <tr>
                        <td colSpan={8} style={{ padding: "14px 0 5px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 500, color: pp.color }}>
                            <span style={{ width: 8, height: 8, borderRadius: 99, background: pp.color }} /> {pp.name}
                          </span>
                        </td>
                      </tr>
                      {items.map((t) => {
                        const cat = CATEGORIES[t.cat]; const days = effectiveDays(t);
                        const moved = !!week.move[t.id];
                        return (
                          <tr key={t.id} style={{ borderTop: `1px solid ${C.line}` }}>
                            <td style={{ padding: "9px 8px 9px 0" }}>
                              <div style={{ fontSize: 12.5, lineHeight: 1.3, paddingLeft: 14 }}>
                                {t.title}
                                {moved && <span style={{ fontSize: 10, color: "#B06A2C" }}> · ajustada</span>}
                              </div>
                            </td>
                            {DAYS.map((d, i) => {
                              const sched = days.includes(i); const done = isDone(t, i);
                              return (
                                <td key={d} style={{ textAlign: "center", padding: "9px 2px" }}>
                                  {sched ? (
                                    <button onClick={() => toggleDone(t, i)} style={{ width: 22, height: 22, margin: "0 auto", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", border: `2px solid ${done ? cat.color : "#D6D5CF"}`, background: done ? cat.color : "transparent" }}>
                                      {done && <Check size={12} color="#fff" />}
                                    </button>
                                  ) : <span style={{ color: "#E0DFD9" }}>·</span>}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Compromissos da semana (eventos por pessoa) */}
          {(week.appts || []).some((a) => a.day != null) && (
            <div style={{ marginTop: 18 }}>
              <SectionTitle icon={Stethoscope} color="#C04574">Compromissos da semana</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(week.appts || []).filter((a) => a.day != null).slice().sort((a, b) => a.day - b.day).map((a, idx) => {
                  const pp = PEOPLE[a.who] || {};
                  return (
                    <div key={idx} style={{ ...card, padding: "11px 13px", display: "flex", alignItems: "center", gap: 11 }}>
                      <div style={{ width: 40, textAlign: "center", fontSize: 12, fontWeight: 500, color: C.sub }}>{DAYS[a.day]}</div>
                      <Stethoscope size={15} color="#C04574" style={{ flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5 }}>{a.title}</div>
                        <div style={{ fontSize: 11.5, color: C.faint }}>{a.when ? a.when + " · " : ""}<span style={{ color: pp.color }}>{pp.name || ""}</span></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- PRESENCIAL ---------- */}
      {tab === "presencial" && (
        <div style={{ animation: "fade .25s ease" }}>
          <p style={{ fontSize: 13.5, color: C.sub, lineHeight: 1.55, margin: "0 0 16px" }}>
            Marque os dias que cada um vai ao escritório <b style={{ fontWeight: 500 }}>nesta semana</b>. Quando um dia presencial bater com uma tarefa que depende dos dois, o sistema sugere mover.
          </p>

          {["rafa", "lucas"].map((person) => {
            const p = PEOPLE[person];
            return (
              <div key={person} style={{ ...card, padding: "14px 16px", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 9, background: p.soft, display: "flex", alignItems: "center", justifyContent: "center" }}><User size={14} color={p.color} /></div>
                  <div><div style={{ fontSize: 13.5, fontWeight: 500 }}>{p.name}</div><div style={{ fontSize: 11.5, color: C.faint }}>{p.role}</div></div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {DAYS.map((d, i) => {
                    const on = (week.presence[person] || []).includes(i);
                    return (
                      <button key={d} onClick={() => togglePresence(person, i)} style={{ flex: 1, padding: "8px 0", borderRadius: 9, fontSize: 12, cursor: "pointer", border: `1px solid ${on ? p.color : C.line}`, background: on ? p.color : C.surface, color: on ? "#fff" : C.sub, fontWeight: on ? 500 : 400 }}>{d}</button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Both-home strip */}
          <div style={{ ...card, padding: "14px 16px", marginBottom: 16, background: "#FAF0E4", borderColor: "#F0E2C4" }}>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: "#B06A2C", marginBottom: 10 }}>Dias com os dois em casa</div>
            <div style={{ display: "flex", gap: 6 }}>
              {DAYS.map((d, i) => {
                const home = !(week.presence.rafa || []).includes(i) && !(week.presence.lucas || []).includes(i);
                return <div key={d} style={{ flex: 1, textAlign: "center", padding: "7px 0", borderRadius: 8, fontSize: 12, background: home ? "#B06A2C" : "transparent", color: home ? "#fff" : "#D3BC9C", fontWeight: home ? 500 : 400 }}>{d}</div>;
              })}
            </div>
            <div style={{ fontSize: 11.5, color: "#8A5A22", marginTop: 9, lineHeight: 1.5 }}>Os melhores dias para cozinhar juntos, tarefas em dupla ou só descansar.</div>
          </div>

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}><Lightbulb size={15} color="#B06A2C" /> Ajustes sugeridos</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {suggestions.map((s, idx) => {
                  const rafaOut = week.presence.rafa || [];
                  const lucasOut = week.presence.lucas || [];
                  const bothHome = (d) => !rafaOut.includes(d) && !lucasOut.includes(d);
                  return (
                    <div key={idx} style={{ ...card, padding: "12px 14px" }}>
                      <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>
                        <b style={{ fontWeight: 500 }}>{s.task.title}</b> está marcada para <b style={{ fontWeight: 500 }}>{DAY_FULL[s.from]}</b>, mas{" "}
                        <b style={{ fontWeight: 500 }}>{(s.whoOut || []).map((k) => PEOPLE[k]?.name).filter(Boolean).join(" e ") || "alguém"}</b>{" "}
                        {(s.whoOut || []).length > 1 ? "estarão" : "estará"} no escritório.
                        {s.to !== null ? <> A sugestão é <b style={{ fontWeight: 500, color: "#B06A2C" }}>{DAY_FULL[s.to]}</b>, mas você escolhe:</> : <> Escolha para qual dia mover:</>}
                      </div>
                      <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 7 }}>Mover para qual dia?</div>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
                        {DAYS.map((d, i) => {
                          const isFrom = i === s.from;
                          const rec = bothHome(i) && !isFrom;
                          return (
                            <button key={d} disabled={isFrom} onClick={() => applyMove(s.task.id, s.from, i)}
                              title={isFrom ? "dia atual" : rec ? "os dois em casa" : "alguém no escritório"}
                              style={{ flex: "1 0 auto", minWidth: 40, padding: "8px 0", borderRadius: 9, fontSize: 12,
                                cursor: isFrom ? "default" : "pointer", opacity: isFrom ? 0.55 : 1,
                                border: `1px solid ${rec ? "#B06A2C" : C.line}`,
                                background: isFrom ? "#F3F2EF" : rec ? "#FAF0E4" : C.surface,
                                color: isFrom ? C.faint : rec ? "#B06A2C" : C.sub,
                                fontWeight: rec ? 500 : 400 }}>{d}</button>
                          );
                        })}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: C.faint }}>
                          <span style={{ width: 9, height: 9, borderRadius: 3, background: "#FAF0E4", border: "1px solid #B06A2C" }} /> os dois em casa
                        </span>
                        <button className="rot-btn" onClick={() => applyMove(s.task.id, s.from, null)} style={{ marginLeft: "auto", padding: "7px 12px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.surface, cursor: "pointer", fontSize: 12.5, color: C.sub }}>
                          Pular esta semana
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {suggestions.length === 0 && (week.presence.rafa?.length || week.presence.lucas?.length) ? (
            <div style={{ textAlign: "center", padding: "20px 0", color: C.faint, fontSize: 13 }}>Tudo encaixado — nenhuma tarefa em dupla conflita com os dias presenciais.</div>
          ) : null}
        </div>
      )}

      {/* ---------- SAÚDE & VIDA ---------- */}
      {tab === "saude" && (
        <div style={{ animation: "fade .25s ease" }}>
          <div style={{ ...card, padding: "13px 15px", marginBottom: 16, background: "#FBEAF1", borderColor: "#F2D2DF", display: "flex", gap: 10 }}>
            <HeartPulse size={17} color="#C04574" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12.5, color: "#8A2E4E", lineHeight: 1.5 }}>
              Este é um espaço para <b style={{ fontWeight: 500 }}>organizar</b> a rotina de saúde — refeições, consultas, vitórias. Metas de dieta, calorias ou exercício devem ser definidas com seu médico ou nutricionista, e aí você registra aqui o que foi orientado.
            </div>
          </div>

          {/* Meal plan */}
          <SectionTitle icon={Utensils} color="#B06A2C">Plano de refeições da semana</SectionTitle>
          <div style={{ ...card, padding: "6px 4px", marginBottom: 18 }}>
            {DAYS.map((d, i) => (
              <div key={d} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
                <div style={{ width: 38, fontSize: 12.5, color: i === ti && offset === 0 ? C.accent : C.sub, fontWeight: i === ti && offset === 0 ? 500 : 400 }}>{d}</div>
                <input value={week.meals[i] || ""} placeholder="o que vamos comer?"
                  onChange={(e) => patchWeek({ meals: { ...week.meals, [i]: e.target.value } })}
                  style={{ flex: 1, border: "none", background: "transparent", fontSize: 13.5, color: C.ink, outline: "none", padding: "4px 0" }} />
              </div>
            ))}
          </div>

          {/* Appointments */}
          <SectionTitle icon={Stethoscope} color="#C04574">Consultas e profissionais</SectionTitle>
          <p style={{ fontSize: 12, color: C.faint, lineHeight: 1.5, margin: "-4px 0 10px" }}>
            Cadastre uma consulta (nutricionista, cardiologista…) e, se escolher um dia, ela vira um <b style={{ fontWeight: 500 }}>evento da pessoa</b> na visão Hoje e Semana.
          </p>
          <div style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {(week.appts || []).map((a, idx) => (
              <div key={idx} style={{ ...card, padding: "11px 13px", display: "flex", alignItems: "center", gap: 10 }}>
                <Stethoscope size={15} color="#C04574" style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5 }}>{a.title}</div>
                  <div style={{ fontSize: 11.5, color: C.faint }}>{[a.day != null ? DAY_FULL[a.day] : null, a.when || null, a.who ? (PEOPLE[a.who]?.name || a.who) : null].filter(Boolean).join(" · ")}</div>
                </div>
                <button className="rot-btn" onClick={() => patchWeek({ appts: week.appts.filter((_, j) => j !== idx) })} style={{ ...iconBtn, width: 30, height: 30 }}><Trash2 size={14} color={C.faint} /></button>
              </div>
            ))}
          </div>
          <ApptAdder onAdd={(a) => patchWeek({ appts: [...(week.appts || []), a] })} C={C} PEOPLE={PEOPLE} />

          {/* Wins */}
          <div style={{ marginTop: 20 }}>
            <SectionTitle icon={TrendingUp} color="#0E7C61">Vitórias da semana</SectionTitle>
            <textarea value={week.wins || ""} placeholder="o que deu certo? como vocês se sentiram?"
              onChange={(e) => patchWeek({ wins: e.target.value })}
              style={{ width: "100%", minHeight: 70, ...card, padding: "12px 14px", fontSize: 13.5, color: C.ink, outline: "none", resize: "vertical", boxSizing: "border-box", lineHeight: 1.5 }} />
          </div>
        </div>
      )}

      {/* ---------- HISTÓRICO ---------- */}
      {tab === "historico" && (
        <div style={{ animation: "fade .25s ease" }}>
          <p style={{ fontSize: 13.5, color: C.sub, lineHeight: 1.55, margin: "0 0 16px" }}>Como as últimas semanas foram. Use para enxergar padrões — por exemplo, semanas com muitos dias presenciais costumam render menos em casa.</p>
          <HistoryView weeks={weeks} templates={templates} C={C} />
        </div>
      )}

      {/* ---------- ROTINA (manage templates) ---------- */}
      {tab === "rotina" && (
        <ManageTemplates templates={templates} setTemplates={setTemplates} C={C} ti={ti} PEOPLE={PEOPLE} peopleRaw={peopleRaw} setPeopleRaw={setPeopleRaw} />
      )}

      <div style={{ marginTop: 22, paddingTop: 14, borderTop: `1px solid ${C.line}`, textAlign: "center" }}>
        <div style={{ fontSize: 11.5, color: C.faint }}>Tudo salvo e sincronizado entre vocês dois. Cada semana vira histórico automaticamente.</div>
      </div>
    </div>
  );
}

const iconBtn = { width: 34, height: 34, borderRadius: 9, border: "1px solid #ECEBE7", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };

function Tag({ soft, color, children }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, padding: "2px 7px", borderRadius: 6, background: soft, color }}>{children}</span>;
}

function Metric({ label, value, small }) {
  return (
    <div style={{ flex: 1, background: "#F3F2EF", borderRadius: 11, padding: "11px 13px" }}>
      <div style={{ fontSize: 11.5, color: "#6E6D66", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: small ? 14 : 21, fontWeight: 500, color: "#26251F" }}>{value}</div>
    </div>
  );
}

function SectionTitle({ icon: Ic, color, children }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, fontSize: 13, fontWeight: 500, color }}><Ic size={15} /> {children}</div>;
}

function ApptAdder({ onAdd, C, PEOPLE }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [who, setWho] = useState("rafa");
  const [day, setDay] = useState(null);
  if (!open) return (
    <button className="rot-btn" onClick={() => setOpen(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 13px", borderRadius: 10, border: `1px solid ${C.line}`, background: C.surface, cursor: "pointer", fontSize: 13, color: C.sub, marginBottom: 4 }}>
      <Plus size={15} /> Adicionar consulta
    </button>
  );
  const reset = () => { setTitle(""); setWhen(""); setDay(null); setOpen(false); };
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, marginBottom: 4 }}>
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex: nutricionista, cardiologista"
        style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5, outline: "none", marginBottom: 8 }} />
      <input value={when} onChange={(e) => setWhen(e.target.value)} placeholder="horário? ex: 15h (opcional)"
        style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5, outline: "none", marginBottom: 12 }} />

      <Label C={C}>De quem é?</Label>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {Object.entries(PEOPLE).map(([k, p]) => (
          <button key={k} onClick={() => setWho(k)} style={{ flex: 1, padding: "7px 0", borderRadius: 9, fontSize: 12, cursor: "pointer", border: `1px solid ${who === k ? p.color : C.line}`, background: who === k ? p.soft : C.surface, color: who === k ? p.color : C.sub, fontWeight: who === k ? 500 : 400 }}>{p.name}</button>
        ))}
      </div>

      <Label C={C}>Em que dia? (vira evento na semana)</Label>
      <div style={{ display: "flex", gap: 5, marginBottom: 6, flexWrap: "wrap" }}>
        {DAYS.map((d, i) => (
          <button key={d} onClick={() => setDay(i)} style={{ flex: "1 0 auto", minWidth: 38, padding: "7px 0", borderRadius: 9, fontSize: 12, cursor: "pointer", border: `1px solid ${day === i ? C.accent : C.line}`, background: day === i ? "#EEEDFB" : C.surface, color: day === i ? C.accent : C.sub, fontWeight: day === i ? 500 : 400 }}>{d}</button>
        ))}
      </div>
      <button onClick={() => setDay(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11.5, color: day === null ? C.accent : C.faint, padding: "2px 0", marginBottom: 12 }}>
        {day === null ? "✓ " : ""}sem dia fixo
      </button>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => { if (title.trim()) { onAdd({ title: title.trim(), when, who, day }); reset(); } }}
          style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: "none", background: "#26251F", color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>Salvar</button>
        <button onClick={reset} style={{ padding: "9px 16px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.surface, color: C.sub, fontSize: 13, cursor: "pointer" }}>Cancelar</button>
      </div>
    </div>
  );
}

function HistoryView({ weeks, templates, C }) {
  const rows = useMemo(() => {
    const out = [];
    for (let o = -1; o >= -12; o--) {
      const id = weekId(o);
      const w = weeks[id];
      if (!w) continue;
      let tot = 0, dn = 0;
      const by = { rafa: 0, lucas: 0, both: 0 };
      templates.forEach((t) => t.days.forEach((d) => {
        tot++;
        if (w.done?.[`${t.id}:${d}`]) { dn++; by[t.who]++; }
      }));
      const presDays = (w.presence?.rafa?.length || 0) + (w.presence?.lucas?.length || 0);
      out.push({ id, label: weekLabel(o).range, pct: tot ? Math.round((dn / tot) * 100) : 0, dn, tot, presDays, wins: w.wins });
    }
    return out;
  }, [weeks, templates]);

  if (rows.length === 0) {
    return <div style={{ textAlign: "center", padding: "40px 0", color: C.faint, fontSize: 13.5 }}>O histórico aparece aqui assim que vocês fecharem a primeira semana.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((r) => (
        <div key={r.id} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "13px 15px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
            <div style={{ fontSize: 13.5, fontWeight: 500 }}>{r.label}</div>
            <div style={{ fontSize: 12.5, color: r.pct >= 70 ? "#0E7C61" : r.pct >= 40 ? "#B06A2C" : "#C04574", fontWeight: 500 }}>{r.pct}%</div>
          </div>
          <div style={{ height: 5, background: "#ECEBE7", borderRadius: 99, overflow: "hidden", marginBottom: 8 }}>
            <div style={{ height: "100%", width: `${r.pct}%`, background: r.pct >= 70 ? "#0E7C61" : r.pct >= 40 ? "#B06A2C" : "#C04574", borderRadius: 99 }} />
          </div>
          <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: C.faint }}>
            <span>{r.dn}/{r.tot} tarefas</span>
            <span>· {r.presDays} dias presenciais</span>
          </div>
          {r.wins && <div style={{ fontSize: 12.5, color: C.sub, marginTop: 8, lineHeight: 1.5, fontStyle: "italic" }}>"{r.wins}"</div>}
        </div>
      ))}
    </div>
  );
}

function ManageTemplates({ templates, setTemplates, C, ti, PEOPLE, peopleRaw, setPeopleRaw }) {
  const blank = { title: "", cat: "casa", who: "both", days: [ti], flexible: false };
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(blank);

  const openNew = () => { setEditingId(null); setDraft(blank); setAdding(true); };
  const openEdit = (t) => { setEditingId(t.id); setDraft({ title: t.title, cat: t.cat, who: t.who, days: [...t.days], flexible: !!t.flexible }); setAdding(true); };
  const closeForm = () => { setAdding(false); setEditingId(null); setDraft(blank); };

  const save = () => {
    if (!draft.title.trim() || draft.days.length === 0) return;
    if (editingId) {
      setTemplates(templates.map((t) => t.id === editingId ? { ...t, ...draft, title: draft.title.trim() } : t));
    } else {
      setTemplates([...templates, { ...draft, id: "u" + Date.now(), title: draft.title.trim() }]);
    }
    closeForm();
  };
  const remove = (id) => { setTemplates(templates.filter((t) => t.id !== id)); if (editingId === id) closeForm(); };

  return (
    <div style={{ animation: "fade .25s ease" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500 }}>Tarefas recorrentes</div>
          <div style={{ fontSize: 12, color: C.faint, marginTop: 1 }}>A base que se repete toda semana</div>
        </div>
        <button onClick={() => (adding && !editingId ? closeForm() : openNew())} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 13px", borderRadius: 10, border: "none", background: (adding && !editingId) ? "#F3F2EF" : "#26251F", color: (adding && !editingId) ? C.sub : "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
          {(adding && !editingId) ? <X size={15} /> : <Plus size={15} />} {(adding && !editingId) ? "Fechar" : "Nova"}
        </button>
      </div>

      {adding && (
        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 15, margin: "14px 0", animation: "fade .2s ease" }}>
          <div style={{ fontSize: 12.5, color: C.faint, marginBottom: 10 }}>{editingId ? "Editando tarefa" : "Nova tarefa"}</div>
          <input autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="O que precisa ser feito?"
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, outline: "none", marginBottom: 13 }} />

          <Label C={C}>Categoria</Label>
          <div style={{ display: "flex", gap: 6, marginBottom: 13, flexWrap: "wrap" }}>
            {Object.entries(CATEGORIES).map(([k, c]) => {
              const Ic = c.icon; const on = draft.cat === k;
              return <button key={k} onClick={() => setDraft({ ...draft, cat: k })} style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 9, fontSize: 12.5, cursor: "pointer", border: `1px solid ${on ? c.color : C.line}`, background: on ? c.soft : C.surface, color: on ? c.color : C.sub, fontWeight: on ? 500 : 400 }}><Ic size={12} /> {c.label}</button>;
            })}
          </div>

          <Label C={C}>Responsável</Label>
          <div style={{ display: "flex", gap: 6, marginBottom: 13 }}>
            {Object.entries(PEOPLE).map(([k, p]) => {
              const on = draft.who === k;
              return <button key={k} onClick={() => setDraft({ ...draft, who: k })} style={{ flex: 1, padding: "8px 0", borderRadius: 9, fontSize: 12.5, cursor: "pointer", border: `1px solid ${on ? p.color : C.line}`, background: on ? p.soft : C.surface, color: on ? p.color : C.sub, fontWeight: on ? 500 : 400 }}>{p.name}</button>;
            })}
          </div>

          <Label C={C}>Quais dias?</Label>
          <div style={{ display: "flex", gap: 5, marginBottom: 13 }}>
            {DAYS.map((d, i) => {
              const on = draft.days.includes(i);
              return <button key={d} onClick={() => setDraft({ ...draft, days: on ? draft.days.filter((x) => x !== i) : [...draft.days, i] })} style={{ flex: 1, padding: "8px 0", borderRadius: 9, fontSize: 12, cursor: "pointer", border: `1px solid ${on ? C.accent : C.line}`, background: on ? C.accent : C.surface, color: on ? "#fff" : C.sub }}>{d}</button>;
            })}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, cursor: "pointer", fontSize: 12.5, color: C.sub }}>
            <button onClick={() => setDraft({ ...draft, flexible: !draft.flexible })} style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${draft.flexible ? C.accent : "#D6D5CF"}`, background: draft.flexible ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}>
              {draft.flexible && <Check size={12} color="#fff" />}
            </button>
            Flexível — pode mudar de dia conforme os dias presenciais
          </label>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={save} style={{ flex: 1, padding: "11px 0", borderRadius: 9, border: "none", background: "#26251F", color: "#fff", fontSize: 13.5, fontWeight: 500, cursor: "pointer", opacity: draft.title.trim() && draft.days.length ? 1 : 0.4 }}>{editingId ? "Salvar alterações" : "Adicionar à rotina"}</button>
            {editingId && <button onClick={closeForm} style={{ padding: "11px 16px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.surface, color: C.sub, fontSize: 13.5, cursor: "pointer" }}>Cancelar</button>}
          </div>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        {Object.entries(CATEGORIES).map(([ck, cat]) => {
          const group = templates.filter((t) => t.cat === ck);
          if (!group.length) return null;
          const Ic = cat.icon;
          return (
            <div key={ck} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}><Ic size={13} color={cat.color} /><span style={{ fontSize: 12, fontWeight: 500, color: cat.color }}>{cat.label}</span></div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {group.map((t) => {
                  const p = PEOPLE[t.who]; const isEd = editingId === t.id;
                  return (
                    <div key={t.id} className="rot-row" onClick={() => openEdit(t)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", background: C.surface, border: `1px solid ${isEd ? C.accent : C.line}`, borderRadius: 11, cursor: "pointer" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, display: "flex", alignItems: "center", gap: 6 }}>{t.title}{t.flexible && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 5, background: softOf(PEOPLE.both.color), color: PEOPLE.both.color }}>flexível</span>}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4 }}>
                          <Tag soft={p.soft} color={p.color}>{p.name}</Tag>
                          <span style={{ fontSize: 11.5, color: C.faint }}>{t.days.map((d) => DAYS[d]).join(", ")}</span>
                        </div>
                      </div>
                      <button className="rot-btn" onClick={(e) => { e.stopPropagation(); openEdit(t); }} style={{ ...iconBtn, width: 32, height: 32, border: "none" }} aria-label="Editar"><Pencil size={14} color="#9B9A94" /></button>
                      <button className="rot-btn" onClick={(e) => { e.stopPropagation(); remove(t.id); }} style={{ ...iconBtn, width: 32, height: 32, border: "none" }} aria-label="Apagar"><Trash2 size={15} color="#C9C8C2" /></button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <PeopleEditor peopleRaw={peopleRaw} setPeopleRaw={setPeopleRaw} C={C} />
    </div>
  );
}

function PeopleEditor({ peopleRaw, setPeopleRaw, C }) {
  const update = (key, field, value) => setPeopleRaw({ ...peopleRaw, [key]: { ...peopleRaw[key], [field]: value } });
  const order = ["rafa", "lucas", "both"];
  const heading = { rafa: "Pessoa 1", lucas: "Pessoa 2", both: "Tarefas em dupla" };
  return (
    <div style={{ marginTop: 26, paddingTop: 18, borderTop: `1px solid ${C.line}` }}>
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 2 }}>Pessoas</div>
      <div style={{ fontSize: 12, color: C.faint, marginBottom: 14 }}>Edite os nomes e a cor de cada um</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {order.map((key) => {
          const p = peopleRaw[key];
          return (
            <div key={key} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 13 }}>
              <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 8 }}>{heading[key]}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: softOf(p.color), display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <User size={15} color={p.color} />
                </div>
                <input value={p.name} onChange={(e) => update(key, "name", e.target.value)} placeholder="nome"
                  style={{ flex: 1, boxSizing: "border-box", padding: "9px 11px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5, outline: "none" }} />
              </div>
              {key !== "both" && (
                <input value={p.role || ""} onChange={(e) => update(key, "role", e.target.value)} placeholder="papel (ex: PM · Turbi) — opcional"
                  style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 12.5, outline: "none", marginBottom: 10, color: C.sub }} />
              )}
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {PERSON_COLORS.map((c) => (
                  <button key={c} onClick={() => update(key, "color", c)} aria-label={`cor ${c}`}
                    style={{ width: 26, height: 26, borderRadius: 8, background: c, cursor: "pointer", border: p.color === c ? `2px solid ${C.ink}` : "2px solid transparent", padding: 0 }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Label({ children, C }) {
  return <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 7 }}>{children}</div>;
}

