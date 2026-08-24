import React, { useState } from "react";
import {
  Briefcase, Flame, TrendingUp, Calendar, Plus, Minus, Check, X,
  Lightbulb, ChevronDown, ChevronUp, MoreHorizontal
} from "lucide-react";

/* =========================================================
   Aba "Recolocação" — busca de emprego do casal.
   Processo = linha do tempo livre. Enviar currículo cria o
   processo; você registra a fase em que está quando ela
   acontece. Fase com data futura = agendada.
   Estado persiste no Supabase via props (bloco jobsearch).
   ========================================================= */

const C = {
  bg: "#FBFBFA", surface: "#FFFFFF", line: "#ECEBE7", line2: "#E0DFD9",
  ink: "#26251F", sub: "#6E6D66", faint: "#9B9A94", accent: "#4F46A8",
};
const PEOPLE = {
  rafa: { name: "Rafaela", color: "#4F46A8" },
  lucas: { name: "Lucas", color: "#0E7C61" },
};
const JUNTOS = "#B06A2C";
const VAGAS = { color: "#185FA5", soft: "#E9F0F8" };
const CHIPS = ["Triagem RH", "Entrevista RH", "Entrevista técnica", "Case", "Fit cultural", "Dinâmica", "Proposta", "Feedback"];
const OUTCOMES = {
  aceito: { label: "aceito 🎉", soft: "#E7F2EC", color: "#0E7C61" },
  recusado: { label: "não seguiu", soft: "#FBEAF1", color: "#C04574" },
  sem_retorno: { label: "sem retorno", soft: "#F3F2EF", color: C.faint },
  desisti: { label: "desisti", soft: "#F3F2EF", color: C.sub },
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const TODAY = iso(new Date());
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const fmtDate = (s) => new Date(s + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
const relDay = (s) => {
  if (s === TODAY) return "hoje";
  if (s === daysAgo(-1)) return "amanhã";
  const diff = Math.round((new Date(s + "T00:00:00") - new Date(TODAY + "T00:00:00")) / 86400000);
  if (diff > 1) return `em ${diff} dias`;
  if (diff === -1) return "ontem";
  return `há ${-diff} dias`;
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ev = (label, date) => ({ id: uid(), label, date });

const card = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14 };
const Tag = ({ soft, color, children }) => <span style={{ background: soft, color, fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 7, whiteSpace: "nowrap" }}>{children}</span>;
const Dot = ({ color, s = 8 }) => <span style={{ width: s, height: s, borderRadius: "50%", background: color, flexShrink: 0, display: "inline-block" }} />;
const SectionTitle = ({ icon: Icon, color, children, right }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "26px 2px 12px" }}>
    <Icon size={16} color={color} />
    <span style={{ fontSize: 14.5, fontWeight: 500, color: C.ink }}>{children}</span>
    {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
  </div>
);

export default function Recolocacao({ jobsearch = {}, setJobsearch }) {
  const goals = jobsearch.goals || { rafa: 2, lucas: 2 };
  const procs = jobsearch.procs || [];
  const wins = jobsearch.wins || [];

  const setGoals = (u) => setJobsearch((js) => ({ ...js, goals: typeof u === "function" ? u(js.goals || { rafa: 2, lucas: 2 }) : u }));
  const setProcs = (u) => setJobsearch((js) => ({ ...js, procs: typeof u === "function" ? u(js.procs || []) : u }));
  const setWins = (u) => setJobsearch((js) => ({ ...js, wins: typeof u === "function" ? u(js.wins || []) : u }));

  const [flash, setFlash] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [na, setNa] = useState({ person: "rafa", company: "", role: "" });
  const [expandId, setExpandId] = useState(null);
  const [editEv, setEditEv] = useState(null);
  const [menuId, setMenuId] = useState(null);
  const [phaseFor, setPhaseFor] = useState(null);
  const [draft, setDraft] = useState({ label: "", date: TODAY });
  const [showClosed, setShowClosed] = useState(false);
  const [metaEdit, setMetaEdit] = useState(false);

  const combinedGoal = goals.rafa + goals.lucas;
  const countDay = (p, day = TODAY) => procs.filter((x) => x.person === p && x.createdAt === day).length;
  const countWeek = (p) => procs.filter((x) => x.person === p && x.createdAt >= daysAgo(6)).length;

  const streak = (() => {
    const by = {}; procs.forEach((x) => { by[x.createdAt] = (by[x.createdAt] || 0) + 1; });
    let s = 0; const d = new Date();
    if ((by[iso(d)] || 0) < combinedGoal) d.setDate(d.getDate() - 1);
    while ((by[iso(d)] || 0) >= combinedGoal) { s++; d.setDate(d.getDate() - 1); }
    return s;
  })();

  const bothMet = countDay("rafa") >= goals.rafa && countDay("lucas") >= goals.lucas;
  const say = (t) => { setFlash(t); setTimeout(() => setFlash(null), 2200); };
  const upd = (id, fn) => setProcs((l) => l.map((x) => (x.id === id ? fn(x) : x)));

  const active = procs.filter((x) => !x.closed).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const closed = procs.filter((x) => x.closed);
  const agenda = procs.filter((x) => !x.closed)
    .flatMap((x) => x.events.filter((e) => e.date >= TODAY && e.label !== "Currículo enviado").map((e) => ({ ...e, company: x.company, person: x.person })))
    .sort((a, b) => a.date.localeCompare(b.date));

  const phasesOf = (x) => [...x.events].sort((a, b) => a.date.localeCompare(b.date));
  const currentOf = (x) => { const past = phasesOf(x).filter((e) => e.date <= TODAY); return past[past.length - 1] || phasesOf(x)[0]; };
  const nextOf = (x) => phasesOf(x).find((e) => e.date > TODAY) || null;

  const createProc = () => {
    if (!na.company.trim()) return;
    const before = countDay(na.person);
    setProcs((l) => [...l, { id: uid(), person: na.person, company: na.company.trim(), role: na.role.trim() || "Vaga", createdAt: TODAY, events: [ev("Currículo enviado", TODAY)], closed: false, outcome: null }]);
    if (before + 1 === goals[na.person]) {
      const other = na.person === "rafa" ? "lucas" : "rafa";
      if (countDay(other) >= goals[other]) { say("Meta dupla registrada hoje 🎉"); setWins((w) => [{ id: uid(), text: "Meta dupla registrada — os dois no ritmo", date: TODAY }, ...w]); }
      else say(`${PEOPLE[na.person].name} bateu a meta de hoje 🎉`);
    } else say(`Processo na ${na.company.trim()} criado`);
    setNa({ person: na.person, company: "", role: "" }); setAddOpen(false);
  };
  const removeToday = (p) => {
    const mine = procs.filter((x) => x.person === p && x.createdAt === TODAY);
    if (!mine.length) return;
    setProcs((l) => l.filter((x) => x.id !== mine[mine.length - 1].id));
  };

  const openPhase = (id) => { setPhaseFor(id); setExpandId(id); setDraft({ label: "", date: TODAY }); };
  const savePhase = (id) => {
    if (!draft.label.trim()) return;
    upd(id, (x) => ({ ...x, events: [...x.events, ev(draft.label.trim(), draft.date)] }));
    if (draft.label.trim().toLowerCase().includes("proposta")) { say("Proposta 🏆"); setWins((w) => [{ id: uid(), text: "Proposta registrada", date: TODAY }, ...w]); }
    setPhaseFor(null); setDraft({ label: "", date: TODAY });
  };
  const renameEvent = (id, eid, label) => upd(id, (x) => ({ ...x, events: x.events.map((e) => (e.id === eid ? { ...e, label } : e)) }));
  const dateEvent = (id, eid, date) => upd(id, (x) => ({ ...x, events: x.events.map((e) => (e.id === eid ? { ...e, date: date || TODAY } : e)) }));
  const removeEvent = (id, eid) => { upd(id, (x) => ({ ...x, events: x.events.filter((e) => e.id !== eid) })); setEditEv(null); };
  const closeProc = (id, outcome) => { upd(id, (x) => ({ ...x, closed: true, outcome })); setMenuId(null); };
  const reopen = (id) => upd(id, (x) => ({ ...x, closed: false, outcome: null }));

  const btn = { border: `1px solid ${C.line}`, background: C.surface, color: C.sub, fontSize: 12.5, fontWeight: 500, padding: "7px 12px", borderRadius: 9, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "inherit" };
  const dark = { border: "none", background: C.ink, color: "#FBFBFA", fontSize: 12.5, fontWeight: 500, padding: "8px 13px", borderRadius: 9, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "inherit" };
  const input = { border: `1px solid ${C.line}`, background: "#FCFCFB", borderRadius: 9, padding: "9px 11px", fontSize: 13.5, fontFamily: "inherit", color: C.ink, width: "100%", outline: "none", boxSizing: "border-box" };
  const iconbtn = { border: "none", background: "transparent", cursor: "pointer", color: C.faint, padding: 4, borderRadius: 8, display: "grid", placeItems: "center" };

  const PhaseRow = (x, e, { last }) => {
    const future = e.date > TODAY; const editing = editEv === e.id;
    return (
      <div key={e.id} style={{ display: "flex", gap: 11, position: "relative", paddingBottom: last ? 0 : 13 }}>
        {!last && <span style={{ position: "absolute", left: 5, top: 15, bottom: 0, width: 2, background: C.line }} />}
        <span style={{ width: 12, height: 12, borderRadius: "50%", marginTop: 3, flexShrink: 0, border: future ? `2px dashed ${PEOPLE[x.person].color}` : "none", background: future ? "transparent" : PEOPLE[x.person].color, boxSizing: "border-box" }} />
        {editing ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <input value={e.label} onChange={(v) => renameEvent(x.id, e.id, v.target.value)} style={{ ...input, padding: "6px 10px", fontSize: 13 }} autoFocus />
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="date" value={e.date} onChange={(v) => dateEvent(x.id, e.id, v.target.value)} style={{ ...input, width: 140, padding: "6px 8px", fontSize: 12 }} />
              <button onClick={() => removeEvent(x.id, e.id)} style={{ ...btn, padding: "6px 9px", fontSize: 11.5, color: "#C04574" }}><X size={12} /> apagar</button>
              <button onClick={() => setEditEv(null)} style={{ ...dark, padding: "6px 12px", marginLeft: "auto" }}>ok</button>
            </div>
          </div>
        ) : (
          <div onClick={() => setEditEv(e.id)} className="rec-tap" style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, cursor: "pointer", borderRadius: 6, padding: "1px 4px", margin: "-1px -4px" }}>
            <span style={{ fontSize: 13.5, fontWeight: last && !future ? 500 : 400, color: future ? C.sub : C.ink }}>{e.label}{future && <span style={{ fontSize: 11, color: PEOPLE[x.person].color, marginLeft: 6 }}>· agendado</span>}</span>
            <span style={{ fontSize: 11.5, color: C.faint, whiteSpace: "nowrap" }}>{relDay(e.date)}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ animation: "fade .25s ease", fontFamily: "Inter, system-ui, sans-serif", maxWidth: 560, margin: "0 auto" }}>
      <style>{`.rec-h:hover{background:#F3F2EF} .rec-tap:hover{background:#F7F6F3} .rec-scope input:focus{border-color:${VAGAS.color}}`}</style>
      <div className="rec-scope">

      {flash && <div style={{ position: "sticky", top: 6, zIndex: 20, width: "max-content", maxWidth: "94%", margin: "0 auto 10px", background: C.ink, color: "#FBFBFA", padding: "9px 15px", borderRadius: 999, fontSize: 13, fontWeight: 500, boxShadow: "0 6px 18px rgba(38,37,31,.22)" }}>{flash}</div>}

      {/* streak */}
      <div style={{ ...card, background: bothMet ? "#FAF0E4" : C.surface, borderColor: bothMet ? "#F0E2C4" : C.line, padding: "14px 16px", display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, background: "#FAF0E4", display: "grid", placeItems: "center", flexShrink: 0 }}><Flame size={22} color={JUNTOS} /></div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}><span style={{ fontSize: 30, fontWeight: 600, color: JUNTOS, lineHeight: 1 }}>{streak}</span><span style={{ fontSize: 13, color: C.sub }}>{streak === 1 ? "dia em movimento" : "dias em movimento"} · juntos</span></div>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 4 }}>{bothMet ? "Os dois registraram a meta hoje 💛" : `Faltam ${Math.max(0, combinedGoal - (countDay("rafa") + countDay("lucas")))} pra fechar o dia juntos.`}</div>
        </div>
      </div>

      {/* enviados hoje */}
      <SectionTitle icon={TrendingUp} color={VAGAS.color}>Enviados hoje</SectionTitle>
      <div style={{ ...card, padding: "6px 15px 13px" }}>
        {["rafa", "lucas"].map((p, ix) => {
          const v = countDay(p); const g = goals[p]; const done = v >= g; const extra = Math.max(0, v - g);
          return (
            <div key={p} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", borderBottom: ix === 0 ? `1px solid ${C.line}` : "none" }}>
              <Dot color={PEOPLE[p].color} />
              <span style={{ fontSize: 14, fontWeight: 500, minWidth: 66 }}>{PEOPLE[p].name}</span>
              <div style={{ display: "flex", gap: 5, flex: 1, alignItems: "center", flexWrap: "wrap" }}>
                {metaEdit && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#F3F2EF", borderRadius: 999, padding: "1px 5px" }}>
                  <button onClick={() => setGoals((s) => ({ ...s, [p]: Math.max(1, s[p] - 1) }))} style={{ ...iconbtn, background: "#fff", width: 17, height: 17, borderRadius: "50%" }}><Minus size={10} /></button>
                  <b style={{ fontSize: 12 }}>{g}</b>
                  <button onClick={() => setGoals((s) => ({ ...s, [p]: s[p] + 1 }))} style={{ ...iconbtn, background: "#fff", width: 17, height: 17, borderRadius: "50%" }}><Plus size={10} /></button>
                </span>}
                {!metaEdit && Array.from({ length: g }).map((_, i) => {
                  const fill = i < v;
                  return <div key={i} onClick={() => (fill ? removeToday(p) : (setNa((s) => ({ ...s, person: p })), setAddOpen(true)))} className="rec-h" style={{ width: 24, height: 24, borderRadius: 7, cursor: "pointer", display: "grid", placeItems: "center", border: `2px solid ${fill ? PEOPLE[p].color : "#D6D5CF"}`, background: fill ? PEOPLE[p].color : "transparent" }}>{fill && <Check size={13} color="#fff" />}</div>;
                })}
                {!metaEdit && extra > 0 && <Tag soft={VAGAS.soft} color={VAGAS.color}>+{extra}</Tag>}
                {!metaEdit && done && <Tag soft="#E7F2EC" color="#0E7C61">meta</Tag>}
              </div>
              <button onClick={() => { setNa((s) => ({ ...s, person: p })); setAddOpen(true); }} style={{ border: "none", background: PEOPLE[p].color, color: "#fff", fontSize: 12.5, fontWeight: 500, padding: "7px 12px", borderRadius: 9, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "inherit", whiteSpace: "nowrap" }}><Plus size={13} /> enviei</button>
            </div>
          );
        })}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11, fontSize: 11.5, color: C.faint }}>
          <span>meta {goals.rafa === goals.lucas ? `${goals.rafa}/dia por pessoa` : `${goals.rafa} e ${goals.lucas}/dia`}</span>
          <button onClick={() => setMetaEdit(!metaEdit)} style={{ ...iconbtn, fontSize: 11.5, color: VAGAS.color, fontFamily: "inherit", padding: "2px 4px" }}>{metaEdit ? "pronto" : "ajustar"}</button>
          <span style={{ marginLeft: "auto" }}>{countWeek("rafa") + countWeek("lucas")} nos últimos 7 dias</span>
        </div>
      </div>

      {addOpen && (
        <div style={{ ...card, padding: "14px 15px", marginTop: 10, display: "flex", flexDirection: "column", gap: 10, borderStyle: "dashed", borderColor: VAGAS.color }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Registrar envio de currículo</div>
          <div style={{ display: "flex", gap: 8 }}>
            {["rafa", "lucas"].map((p) => <button key={p} onClick={() => setNa((s) => ({ ...s, person: p }))} style={{ flex: 1, ...btn, justifyContent: "center", borderColor: na.person === p ? PEOPLE[p].color : C.line, color: na.person === p ? C.ink : C.sub, boxShadow: na.person === p ? `inset 0 0 0 1px ${PEOPLE[p].color}` : "none" }}><Dot color={PEOPLE[p].color} />{PEOPLE[p].name}</button>)}
          </div>
          <input style={input} placeholder="Empresa" value={na.company} onChange={(e) => setNa((s) => ({ ...s, company: e.target.value }))} autoFocus />
          <input style={input} placeholder="Vaga (ex: PM Pleno)" value={na.role} onChange={(e) => setNa((s) => ({ ...s, role: e.target.value }))} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setAddOpen(false)} style={{ ...btn, flex: 1, justifyContent: "center" }}>cancelar</button>
            <button onClick={createProc} style={{ ...dark, flex: 2, justifyContent: "center", padding: "9px" }}>criar processo</button>
          </div>
        </div>
      )}

      {agenda.length > 0 && <>
        <SectionTitle icon={Calendar} color="#C04574">Próximos passos</SectionTitle>
        {agenda.map((a, idx) => (
          <div key={a.id} style={{ ...card, padding: "12px 15px", marginBottom: 9, display: "flex", alignItems: "center", gap: 14, boxShadow: idx === 0 ? `inset 3px 0 0 ${PEOPLE[a.person].color}` : "none" }}>
            <div style={{ textAlign: "center", minWidth: 60, paddingRight: 12, borderRight: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: PEOPLE[a.person].color }}>{relDay(a.date)}</div>
              <div style={{ fontSize: 11, color: C.faint, marginTop: 3 }}>{fmtDate(a.date)}</div>
            </div>
            <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 500 }}>{a.label}</div><div style={{ fontSize: 12, color: C.sub, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}><Dot color={PEOPLE[a.person].color} />{a.company}</div></div>
          </div>
        ))}
      </>}

      <SectionTitle icon={Briefcase} color={VAGAS.color} right={<button onClick={() => setAddOpen(true)} style={{ ...btn, padding: "5px 10px", fontSize: 12 }}><Plus size={13} /> novo</button>}>Em andamento</SectionTitle>
      {active.length === 0 && <div style={{ ...card, padding: "20px", textAlign: "center", color: C.faint, fontSize: 13, borderStyle: "dashed" }}>Nenhum processo ainda. Toque em "enviei" quando mandar um currículo — o processo nasce aqui.</div>}
      {active.map((x) => {
        const expanded = expandId === x.id; const adding = phaseFor === x.id; const menu = menuId === x.id;
        const phases = phasesOf(x); const cur = currentOf(x); const nxt = nextOf(x);
        const shown = expanded ? phases : [cur, ...(nxt && nxt.id !== cur.id ? [nxt] : [])];
        const hiddenCount = phases.length - shown.length;
        return (
          <div key={x.id} style={{ ...card, padding: "13px 15px", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div><div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 14.5, fontWeight: 500 }}><Dot color={PEOPLE[x.person].color} />{x.company}</div><div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>{x.role} · {PEOPLE[x.person].name}</div></div>
              <button onClick={() => setMenuId(menu ? null : x.id)} style={iconbtn} className="rec-h"><MoreHorizontal size={18} /></button>
            </div>
            {menu && (
              <div style={{ marginTop: 10, padding: "10px 12px", background: "#F7F6F3", borderRadius: 10 }}>
                <div style={{ fontSize: 11.5, color: C.sub, marginBottom: 8 }}>Encerrar processo como:</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {Object.keys(OUTCOMES).map((o) => <button key={o} onClick={() => closeProc(x.id, o)} style={{ ...btn, background: "#fff", padding: "5px 10px", fontSize: 11.5, color: OUTCOMES[o].color }}>{OUTCOMES[o].label}</button>)}
                </div>
              </div>
            )}
            <div style={{ marginTop: 13, paddingLeft: 4 }}>
              {shown.map((e, i) => PhaseRow(x, e, { last: i === shown.length - 1 }))}
            </div>
            {hiddenCount > 0 && !expanded && (
              <button onClick={() => setExpandId(x.id)} style={{ ...iconbtn, marginTop: 8, marginLeft: 4, fontSize: 12, color: C.sub, fontFamily: "inherit", display: "inline-flex", gap: 4, alignItems: "center" }}><ChevronDown size={13} /> ver todas as fases ({phases.length})</button>
            )}
            {expanded && phases.length > 2 && (
              <button onClick={() => { setExpandId(null); setEditEv(null); }} style={{ ...iconbtn, marginTop: 8, marginLeft: 4, fontSize: 12, color: C.sub, fontFamily: "inherit", display: "inline-flex", gap: 4, alignItems: "center" }}><ChevronUp size={13} /> recolher</button>
            )}
            {adding ? (
              <div style={{ marginTop: 12, padding: "12px", background: "#F7F6F3", borderRadius: 10, display: "flex", flexDirection: "column", gap: 9 }}>
                <input value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} placeholder="Em que fase você está?" style={{ ...input, padding: "8px 11px" }} autoFocus />
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {CHIPS.map((c) => <button key={c} onClick={() => setDraft((d) => ({ ...d, label: c }))} style={{ ...btn, background: "#fff", padding: "4px 9px", fontSize: 11.5, borderRadius: 999 }}>{c}</button>)}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: C.sub }}>quando:</span>
                  <input type="date" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} style={{ ...input, width: 150, padding: "7px 9px", fontSize: 12.5 }} />
                  <span style={{ fontSize: 11, color: C.faint }}>futuro = agendado</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setPhaseFor(null)} style={{ ...btn, flex: 1, justifyContent: "center" }}>cancelar</button>
                  <button onClick={() => savePhase(x.id)} style={{ ...dark, flex: 2, justifyContent: "center", padding: "8px" }}>registrar</button>
                </div>
              </div>
            ) : (
              <button onClick={() => openPhase(x.id)} style={{ ...btn, width: "100%", justifyContent: "center", marginTop: 12, borderStyle: "dashed", color: VAGAS.color, borderColor: "#CFDCEA" }}><Plus size={14} /> registrar fase</button>
            )}
          </div>
        );
      })}

      {closed.length > 0 && (
        <>
          <button onClick={() => setShowClosed(!showClosed)} style={{ ...btn, width: "100%", justifyContent: "space-between", marginTop: 14, background: "transparent", border: "none", color: C.faint }}>
            <span>{closed.length} encerrados</span>{showClosed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          {showClosed && closed.map((x) => (
            <div key={x.id} style={{ ...card, padding: "10px 14px", marginBottom: 7, display: "flex", alignItems: "center", gap: 10, opacity: 0.85 }}>
              <Dot color={PEOPLE[x.person].color} s={7} />
              <span style={{ fontSize: 13, flex: 1 }}>{x.company} <span style={{ color: C.faint }}>· {PEOPLE[x.person].name}</span></span>
              <Tag soft={OUTCOMES[x.outcome].soft} color={OUTCOMES[x.outcome].color}>{OUTCOMES[x.outcome].label}</Tag>
              <button onClick={() => reopen(x.id)} className="rec-h" style={{ ...iconbtn, fontSize: 11, fontFamily: "inherit", padding: "2px 6px" }}>reabrir</button>
            </div>
          ))}
        </>
      )}

      {wins.length > 0 && <>
        <SectionTitle icon={TrendingUp} color="#0E7C61">Vitórias da semana</SectionTitle>
        <div style={{ ...card, padding: "6px 15px" }}>
          {wins.slice(0, 5).map((w, i, arr) => (
            <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 0", borderBottom: i < arr.length - 1 ? `1px solid ${C.line}` : "none" }}>
              <span style={{ width: 30, height: 30, borderRadius: 9, background: "#FAF0E4", display: "grid", placeItems: "center", flexShrink: 0 }}><Flame size={14} color={JUNTOS} /></span>
              <span style={{ flex: 1, fontSize: 13.5, lineHeight: 1.35 }}>{w.text}</span>
              <span style={{ fontSize: 11, color: C.faint, whiteSpace: "nowrap" }}>{w.date === TODAY ? "hoje" : fmtDate(w.date)}</span>
            </div>
          ))}
        </div>
      </>}
      </div>
    </div>
  );
}
