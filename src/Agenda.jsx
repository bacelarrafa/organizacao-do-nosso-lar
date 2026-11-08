import React, { useState, useEffect, useMemo } from "react";
import { CalendarDays, Plus, Target, Check, X, Clock, ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react";

/* =========================================================
   Aba "Agenda": eventos pessoais (aula, show, consulta, viagem).
   Um evento pode estar ligado a uma meta. Quando você marca que
   ele aconteceu, ele conta na meta sozinho:
     quantidade no ano  vira um item concluído (ex: 1 curso)
     hábito mensal      vira um registro no mês
     lista              marca o item da lista (ou cria um)
     algo para concluir vira um avanço registrado
   Desmarcar desfaz. Estado no Supabase (coluna agenda).
   ========================================================= */

const C = {
  surface: "#FFFFFF", line: "#E2E7F0", line2: "#D3DAE6", ink: "#18233F", sub: "#5A6580", faint: "#8E97AD",
  accent: "#2348A6", accentSoft: "#E3EAFB", good: "#1F8A5B", goodSoft: "#E2F3EA", bad: "#C04574", badSoft: "#FBEAF1", sun: "#B8670C", sunSoft: "#FCEFD9",
};
const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => iso(new Date());
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ddmm = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const dowOf = (s) => DOW[new Date(s + "T00:00:00").getDay()];
const relDay = (s) => {
  const n = Math.round((new Date(s + "T00:00:00") - new Date(today() + "T00:00:00")) / 86400000);
  if (n === 0) return "hoje"; if (n === 1) return "amanhã"; if (n === -1) return "ontem";
  if (n > 1 && n < 7) return `em ${n} dias`;
  return null;
};

const card = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14 };
const btn = { border: `1px solid ${C.line}`, background: C.surface, color: C.sub, fontSize: 12.5, fontWeight: 500, padding: "7px 12px", borderRadius: 9, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "inherit" };
const dark = { ...btn, border: "none", background: C.ink, color: "#F3F5F9" };
const input = { border: `1px solid ${C.line}`, background: "#F7F9FC", borderRadius: 9, padding: "9px 11px", fontSize: 13.5, fontFamily: "inherit", color: C.ink, width: "100%", outline: "none", boxSizing: "border-box" };
const Field = ({ label, children, style }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 0, ...style }}>
    <span style={{ fontSize: 11.5, color: C.faint }}>{label}</span>{children}
  </label>
);

// ---------- ligação com as metas ----------
export const goalsOf = (metas, year) => (metas?.[year]?.goals || []);
export const findGoal = (metas, ref) => (ref ? goalsOf(metas, ref.year).find((g) => g.id === ref.goalId) || null : null);

// Aplica (add=true) ou desfaz (add=false) um evento concluído na meta ligada. Função pura.
export function applyToMeta(metas, ev, add) {
  const ref = ev.meta; if (!ref) return metas;
  const yd = metas?.[ref.year]; if (!yd) return metas;
  const tag = `ev-${ev.id}`;
  const date = ev.date;
  const m = Number(date.slice(5, 7));
  const goals = yd.goals.map((g) => {
    if (g.id !== ref.goalId) return g;
    if (g.type === "contador") {
      const items = (g.items || []).filter((i) => i.id !== tag);
      return { ...g, items: add ? [...items, { id: tag, title: ev.title, sub: "", startedAt: date, doneAt: date }] : items };
    }
    if (g.type === "lista") {
      if (ref.itemId) return { ...g, items: (g.items || []).map((i) => (i.id === ref.itemId ? { ...i, done: add, doneAt: add ? date : null } : i)) };
      const items = (g.items || []).filter((i) => i.id !== tag);
      return { ...g, items: add ? [...items, { id: tag, title: ev.title, done: true, doneAt: date }] : items };
    }
    if (g.type === "mensal") {
      const cur = { ...(g.months?.[m] || {}) };
      if (g.mode === "texto") {
        const parts = (cur.text || "").split("; ").filter((p) => p && p !== ev.title);
        cur.text = (add ? [...parts, ev.title] : parts).join("; ");
      } else {
        const dates = [...(cur.dates || [])];
        if (add) dates.push(date); else { const i = dates.indexOf(date); if (i >= 0) dates.splice(i, 1); }
        cur.dates = dates.sort();
      }
      return { ...g, months: { ...(g.months || {}), [m]: cur } };
    }
    // simples: vira um avanço
    const log = (g.log || []).filter((l) => l.id !== tag);
    return { ...g, log: add ? [...log, { id: tag, date, text: ev.title }] : log };
  });
  return { ...metas, [ref.year]: { ...yd, goals } };
}

// ---------- componente ----------
export default function Agenda({ agenda = {}, setAgenda, metas = {}, setMetas, PEOPLE, prefill, clearPrefill }) {
  const events = agenda.events || [];
  const [form, setForm] = useState(null); // null | { ...evento }
  const [showHist, setShowHist] = useState(false);
  const [toast, setToast] = useState(null);
  const [who, setWho] = useState("todos");
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { if (prefill) { setForm(blank(prefill)); clearPrefill && clearPrefill(); } }, [prefill]);

  const T = today();
  const blank = (p = {}) => ({ id: null, title: "", date: p.date || T, time: "", who: "rafa", note: "", meta: p.meta || null });
  const setEvents = (fn) => setAgenda((a) => ({ ...(a || {}), events: fn((a && a.events) || []) }));
  const pick = (e) => who === "todos" || e.who === who || e.who === "both";
  const goalName = (ref) => findGoal(metas, ref)?.title;

  const save = (f) => {
    if (!f.title.trim() || !f.date) return;
    const ev = { ...f, title: f.title.trim(), id: f.id || uid() };
    const old = events.find((e) => e.id === ev.id);
    if (old && old.status === "feito") {
      // evento já concluído: reaplica na meta com os dados novos
      setMetas((ms) => applyToMeta(applyToMeta(ms, old, false), { ...ev, status: "feito" }, true));
    }
    setEvents((l) => (old ? l.map((e) => (e.id === ev.id ? { ...e, ...ev } : e)) : [...l, { ...ev, status: null }]));
    setForm(null);
    setToast(old ? "Evento atualizado" : `${ev.title} na agenda${ev.meta ? ", ligado à meta" : ""}`);
  };
  const remove = (ev) => {
    if (!window.confirm(`Apagar "${ev.title}"?`)) return;
    if (ev.status === "feito" && ev.meta) setMetas((ms) => applyToMeta(ms, ev, false));
    setEvents((l) => l.filter((e) => e.id !== ev.id));
    setForm(null);
  };
  const mark = (ev, status) => {
    const next = ev.status === status ? null : status;
    if (ev.meta && ev.status === "feito" && next !== "feito") setMetas((ms) => applyToMeta(ms, ev, false));
    if (ev.meta && next === "feito") setMetas((ms) => applyToMeta(ms, ev, true));
    setEvents((l) => l.map((e) => (e.id === ev.id ? { ...e, status: next } : e)));
    if (next === "feito") setToast(ev.meta && goalName(ev.meta) ? `Contou na meta ${goalName(ev.meta)}` : "Marcado como feito");
  };

  const sorted = [...events].filter(pick).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  const pending = sorted.filter((e) => !e.status && e.date < T);
  const upcoming = sorted.filter((e) => !e.status && e.date >= T);
  const history = sorted.filter((e) => e.status).reverse();
  const byMonth = {};
  upcoming.forEach((e) => { const k = e.date.slice(0, 7); (byMonth[k] = byMonth[k] || []).push(e); });

  const Row = (ev, { confirm } = {}) => {
    const p = PEOPLE[ev.who] || PEOPLE.both || { name: "", color: C.faint };
    const g = goalName(ev.meta);
    const rel = relDay(ev.date);
    return (
      <div key={ev.id} style={{ ...card, padding: "12px 14px", marginBottom: 8, opacity: ev.status === "cancelado" ? 0.6 : 1 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ width: 44, textAlign: "center", flexShrink: 0, paddingTop: 1 }}>
            <div className="lar-display" style={{ fontSize: 19, fontWeight: 600, lineHeight: 1, color: rel === "hoje" ? C.accent : C.ink }}>{ev.date.slice(8, 10)}</div>
            <div style={{ fontSize: 11, color: C.faint, marginTop: 3 }}>{dowOf(ev.date)}</div>
          </div>
          <div onClick={() => setForm({ ...ev })} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
            <div style={{ fontSize: 14, fontWeight: 500, textDecoration: ev.status === "cancelado" ? "line-through" : "none" }}>{ev.title}</div>
            <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginTop: 4, fontSize: 11.5, color: C.faint, alignItems: "center" }}>
              {rel && !ev.status && <span style={{ color: rel === "hoje" ? C.accent : C.sub, fontWeight: 500 }}>{rel}</span>}
              {ev.time && <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Clock size={11} />{ev.time}</span>}
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: 99, background: p.color }} />{p.name}</span>
              {g && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: ev.status === "feito" ? C.good : C.accent }}><Target size={11} />{g}</span>}
              {ev.status === "feito" && <span style={{ color: C.good }}>aconteceu</span>}
              {ev.status === "cancelado" && <span>não rolou</span>}
            </div>
            {ev.note && <div style={{ fontSize: 12, color: C.sub, marginTop: 5, lineHeight: 1.4 }}>{ev.note}</div>}
          </div>
        </div>
        {(confirm || ev.status) && (
          <div style={{ display: "flex", gap: 6, marginTop: 10, justifyContent: "flex-end" }}>
            <button onClick={() => mark(ev, "feito")} style={{ ...btn, padding: "5px 10px", fontSize: 12, background: ev.status === "feito" ? C.good : C.surface, color: ev.status === "feito" ? "#fff" : C.good, borderColor: ev.status === "feito" ? C.good : C.line }}><Check size={13} /> aconteceu</button>
            <button onClick={() => mark(ev, "cancelado")} style={{ ...btn, padding: "5px 10px", fontSize: 12, background: ev.status === "cancelado" ? C.sub : C.surface, color: ev.status === "cancelado" ? "#fff" : C.sub }}><X size={13} /> não rolou</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ animation: "fade .25s ease" }}>
      {toast && <div role="status" style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: "calc(env(safe-area-inset-bottom, 0px) + 100px)", zIndex: 30, background: C.ink, color: "#F3F5F9", padding: "9px 15px", borderRadius: 999, fontSize: 13, fontWeight: 500 }}>{toast}</div>}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 3, background: "#EBEFF6", padding: 3, borderRadius: 10, flex: 1 }}>
          {[["todos", "Todos"], ["rafa", PEOPLE.rafa?.name], ["lucas", PEOPLE.lucas?.name]].map(([k, l]) => (
            <button key={k} onClick={() => setWho(k)} style={{ flex: 1, padding: "7px 6px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: who === k ? 600 : 400, background: who === k ? C.surface : "transparent", color: who === k ? C.ink : C.sub }}>{l}</button>
          ))}
        </div>
        <button onClick={() => setForm(form && !form.id ? null : blank())} style={dark}><Plus size={14} /> evento</button>
      </div>

      {form && <EventForm f={form} setF={setForm} metas={metas} PEOPLE={PEOPLE} onSave={save} onCancel={() => setForm(null)} onDelete={form.id ? () => remove(form) : null} />}

      {pending.length > 0 && <>
        <div className="lar-display" style={{ fontSize: 15.5, fontWeight: 600, margin: "18px 2px 10px" }}>Aconteceu?</div>
        {pending.map((e) => Row(e, { confirm: true }))}
      </>}

      <div className="lar-display" style={{ fontSize: 15.5, fontWeight: 600, margin: "18px 2px 10px" }}>Próximos</div>
      {upcoming.length === 0 && <div style={{ ...card, padding: 18, fontSize: 13, color: C.faint, borderStyle: "dashed", lineHeight: 1.5 }}>Nada marcado. Adicione aulas, shows, consultas e viagens. Se for parte de uma meta, ligue o evento a ela: quando acontecer, conta na meta.</div>}
      {Object.keys(byMonth).sort().map((k) => (
        <div key={k}>
          <div style={{ fontSize: 12, color: C.faint, margin: "12px 2px 7px", fontWeight: 500 }}>{MES[Number(k.slice(5)) - 1]}{k.slice(0, 4) !== T.slice(0, 4) ? ` de ${k.slice(0, 4)}` : ""}</div>
          {byMonth[k].map((e) => Row(e, { confirm: e.date === T }))}
        </div>
      ))}

      {history.length > 0 && <>
        <button onClick={() => setShowHist(!showHist)} style={{ ...btn, width: "100%", justifyContent: "space-between", marginTop: 14, background: "transparent", border: "none", color: C.faint }}>
          <span>{history.length} já passaram</span>{showHist ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        {showHist && history.slice(0, 30).map((e) => Row(e))}
      </>}
    </div>
  );
}

function EventForm({ f, setF, metas, PEOPLE, onSave, onCancel, onDelete }) {
  const year = Number((f.date || today()).slice(0, 4));
  const goals = goalsOf(metas, year);
  const goal = f.meta && f.meta.year === year ? goals.find((g) => g.id === f.meta.goalId) : null;
  const listItems = goal?.type === "lista" ? (goal.items || []).filter((i) => !i.done || i.id === f.meta?.itemId) : [];
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const TYPE_HINT = { contador: "Quando acontecer, conta como mais um na meta.", mensal: "Quando acontecer, vira um registro no mês.", lista: "Quando acontecer, marca o item da lista.", simples: "Quando acontecer, vira um avanço registrado." };
  return (
    <div style={{ ...card, padding: 14, marginBottom: 12, display: "flex", flexDirection: "column", gap: 10, borderStyle: "dashed", borderColor: C.accent }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{f.id ? "Editar evento" : "Novo evento"}</div>
      <Field label="O que é"><input style={input} autoFocus value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="Aula de lámen" /></Field>
      <div style={{ display: "flex", gap: 8 }}>
        <Field label="Data"><input style={input} type="date" value={f.date} onChange={(e) => set({ date: e.target.value, meta: f.meta && Number(e.target.value.slice(0, 4)) !== f.meta.year ? null : f.meta })} /></Field>
        <Field label="Hora (opcional)"><input style={input} type="time" value={f.time || ""} onChange={(e) => set({ time: e.target.value })} /></Field>
      </div>
      <Field label="De quem">
        <div style={{ display: "flex", gap: 6 }}>
          {["rafa", "lucas", "both"].map((k) => {
            const p = PEOPLE[k] || {}; const on = f.who === k;
            return <button key={k} type="button" onClick={() => set({ who: k })} style={{ ...btn, flex: 1, justifyContent: "center", borderColor: on ? p.color : C.line, color: on ? C.ink : C.sub, boxShadow: on ? `inset 0 0 0 1px ${p.color}` : "none" }}><span style={{ width: 8, height: 8, borderRadius: 99, background: p.color }} />{p.name}</button>;
          })}
        </div>
      </Field>
      <Field label={`Faz parte de uma meta de ${year}?`}>
        <select style={{ ...input, padding: "8px 9px" }} value={goal ? goal.id : ""} onChange={(e) => set({ meta: e.target.value ? { year, goalId: e.target.value } : null })}>
          <option value="">Não, é só um evento</option>
          {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
        </select>
      </Field>
      {goal && listItems.length > 0 && (
        <Field label="Qual item da lista">
          <select style={{ ...input, padding: "8px 9px" }} value={f.meta.itemId || ""} onChange={(e) => set({ meta: { ...f.meta, itemId: e.target.value || undefined } })}>
            <option value="">Um item novo, com o nome do evento</option>
            {listItems.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
          </select>
        </Field>
      )}
      {goal && <div style={{ fontSize: 11.5, color: C.accent }}>{TYPE_HINT[goal.type] || TYPE_HINT.simples}</div>}
      {goals.length === 0 && <div style={{ fontSize: 11.5, color: C.faint }}>Ainda não há metas cadastradas para {year}.</div>}
      <Field label="Observação (opcional)"><input style={input} value={f.note || ""} onChange={(e) => set({ note: e.target.value })} placeholder="Local, o que levar…" /></Field>
      <div style={{ display: "flex", gap: 8 }}>
        {onDelete && <button onClick={onDelete} style={{ ...btn, color: C.bad }}><Trash2 size={13} /></button>}
        <button onClick={onCancel} style={{ ...btn, flex: 1, justifyContent: "center" }}>cancelar</button>
        <button onClick={() => onSave(f)} style={{ ...dark, flex: 2, justifyContent: "center" }}>salvar</button>
      </div>
    </div>
  );
}

// Eventos de um dia (para a aba Hoje) e eventos ligados a uma meta (para a aba Metas)
export const eventsOn = (agenda, date) => (agenda?.events || []).filter((e) => e.date === date && e.status !== "cancelado");
export const eventsOfGoal = (agenda, year, goalId) => (agenda?.events || []).filter((e) => e.meta && e.meta.year === year && e.meta.goalId === goalId).sort((a, b) => a.date.localeCompare(b.date));
