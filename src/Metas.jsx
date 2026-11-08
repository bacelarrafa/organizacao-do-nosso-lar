import React, { useState, useEffect } from "react";
import {
  Target, Plus, X, Check, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Pencil, Trash2, BookOpen, CalendarDays, ListChecks, MoreHorizontal, ArrowUp, ArrowDown,
  Sparkles, AlertCircle, TrendingUp, Trophy, PenLine, Grid3x3, Quote, CircleDot
} from "lucide-react";

/* =========================================================
   Aba "Metas" (metas pessoais da Rafaela).
   Organizado por ano: metas[ano] = { intro, goals: [...] }.
   Cada meta tem um tipo:
     simples   algo para concluir: etapas + registro de avanços
     contador  uma quantidade no ano (ex: livros, com data de conclusão)
     mensal    um hábito todo mês (ex: 2 a 3 sessões, 1 receita), por datas ou texto
     lista     experiências: o que já fiz e o que quero fazer
   A tela calcula a "saúde" de cada meta (concluída, no ritmo, pede atenção)
   e monta a lista "Agora em <mês>" com as próximas ações de um toque.
   Estado persiste no Supabase via props (campo metas).
   ========================================================= */

const C = {
  bg: "#F3F5F9", surface: "#FFFFFF", line: "#E2E7F0", line2: "#D3DAE6",
  ink: "#18233F", sub: "#5A6580", faint: "#8E97AD", accent: "#2348A6", accentSoft: "#E3EAFB",
};
const GREEN = { color: "#1F8A5B", soft: "#E2F3EA" };
const AMBER = { color: "#B8670C", soft: "#FCEFD9" };
const PINK = { color: "#C7416E", soft: "#FAE6EE" };
const SUN = { color: "#F2B23A", soft: "#FDF1D8" };

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MONTHS_FULL = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const TYPES = {
  simples: { label: "Algo para concluir", hint: "Ex: tirar a certificação. Divida em etapas e registre cada avanço.", icon: Target },
  contador: { label: "Uma quantidade no ano", hint: "Ex: ler 12 livros. Mostra se você está no ritmo.", icon: BookOpen },
  mensal: { label: "Um hábito todo mês", hint: "Ex: 2 a 3 sessões de terapia, 1 receita nova por mês.", icon: CalendarDays },
  lista: { label: "Uma lista de experiências", hint: "Ex: shows, viagens, primeiras vezes.", icon: ListChecks },
};
const HEALTH = {
  atencao: { label: "Para retomar", plural: "para retomar", color: AMBER.color, soft: AMBER.soft, icon: AlertCircle },
  ritmo: { label: "No ritmo", plural: "no ritmo", color: C.accent, soft: C.accentSoft, icon: TrendingUp },
  feito: { label: "Concluída", plural: "concluídas", color: GREEN.color, soft: GREEN.soft, icon: Trophy },
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const TODAY = iso(new Date());
const CUR_YEAR = new Date().getFullYear();
const CUR_MONTH = new Date().getMonth() + 1; // 1..12
const ddmm = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : "");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const lastDay = (y, m) => new Date(y, m, 0).getDate();
const daysSince = (s) => Math.round((new Date(TODAY + "T00:00:00") - new Date(s + "T00:00:00")) / 86400000);
const sinceText = (s) => { const n = daysSince(s); return n <= 0 ? "hoje" : n === 1 ? "ontem" : `há ${n} dias`; };
function yearFrac(year) {
  if (year < CUR_YEAR) return 1;
  if (year > CUR_YEAR) return 0;
  const start = new Date(year, 0, 1), end = new Date(year + 1, 0, 1);
  return (new Date() - start) / (end - start);
}
const daysLeftInYear = () => Math.max(1, Math.round((new Date(CUR_YEAR + 1, 0, 1) - new Date(TODAY + "T00:00:00")) / 86400000));
const monthFrac = () => new Date().getDate() / lastDay(CUR_YEAR, CUR_MONTH);

const card = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16 };
const input = { boxSizing: "border-box", padding: "9px 11px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 13.5, color: C.ink, background: C.surface, outline: "none", fontFamily: "inherit" };
const ghostBtn = { background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12.5, color: C.sub, fontFamily: "inherit" };
const iconBtn = { width: 30, height: 30, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const primaryBtn = { padding: "8px 14px", borderRadius: 10, border: "none", background: C.accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 5 };
const softBtn = { padding: "8px 13px", borderRadius: 10, border: `1px solid ${C.line}`, background: C.surface, color: C.ink, fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 5 };
const display = { fontFamily: "var(--font-display)" };

const Tag = ({ soft, color, children }) => <span style={{ background: soft, color, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 7, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}>{children}</span>;
const Label = ({ children }) => <div style={{ fontSize: 12, color: C.faint, marginBottom: 7, fontWeight: 500 }}>{children}</div>;

function CheckBox({ on, color = GREEN.color, onClick, size = 22 }) {
  return (
    <button onClick={onClick} aria-pressed={on} style={{ width: size, height: size, borderRadius: 7, flexShrink: 0, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${on ? color : "#C9D1DF"}`, background: on ? color : C.surface, animation: on ? "lar-pop .32s ease" : "none" }}>
      {on && <Check size={13} color="#fff" strokeWidth={3} />}
    </button>
  );
}

// "Lendo agora": itens de uma meta de quantidade que já começaram e não terminaram
const isBookGoal = (g) => /livr|\bler\b|leitur/i.test(g.title || "");
const nowWord = (g) => (isBookGoal(g) ? "Lendo agora" : "Em andamento");
const startWord = (g) => (isBookGoal(g) ? "Começar a ler" : "Começar um");
const inProgress = (g) => (g.items || []).filter((i) => i.startedAt && !i.doneAt);

// ---------- regras de progresso ----------

function monthCount(g, m) {
  const mo = g.months?.[m];
  if (!mo) return 0;
  return g.mode === "texto" ? (mo.text && mo.text.trim() ? 1 : 0) : (mo.dates || []).length;
}
// ok | abaixo | andamento (mês atual ainda não bateu) | pausa | futuro
function monthState(g, year, m) {
  const mo = g.months?.[m] || {};
  if (mo.pause) return "pausa";
  const n = monthCount(g, m);
  const min = g.min || 1;
  if (year > CUR_YEAR || (year === CUR_YEAR && m > CUR_MONTH)) return n >= min ? "ok" : "futuro";
  if (n >= min) return "ok";
  if (year === CUR_YEAR && m === CUR_MONTH) return "andamento";
  return "abaixo";
}
const MONTH_COLORS = {
  ok: { bg: GREEN.color, fg: "#fff" },
  abaixo: { bg: PINK.soft, fg: PINK.color },
  andamento: { bg: AMBER.soft, fg: AMBER.color },
  pausa: { bg: "#EBEFF6", fg: C.faint },
  futuro: { bg: "transparent", fg: "#C3CBDA" },
};


function monthsSummary(g, year) {
  let ok = 0, eligible = 0;
  for (let m = 1; m <= 12; m++) {
    const s = monthState(g, year, m);
    const notFuture = year < CUR_YEAR || (year === CUR_YEAR && m <= CUR_MONTH);
    if (s === "ok" && notFuture) { ok++; eligible++; } else if (s === "abaixo") eligible++;
  }
  return { ok, eligible };
}

// Data do avanço mais recente de uma meta (qualquer coisa com data)
function lastActivity(g) {
  const ds = [];
  if (g.doneAt) ds.push(g.doneAt);
  (g.items || []).forEach((i) => i.doneAt && ds.push(i.doneAt));
  (g.steps || []).forEach((s) => s.doneAt && ds.push(s.doneAt));
  (g.log || []).forEach((l) => l.date && ds.push(l.date));
  Object.values(g.months || {}).forEach((mo) => (mo.dates || []).forEach((d) => ds.push(d)));
  return ds.length ? ds.sort().pop() : null;
}

// Saúde da meta: { state: feito | ritmo | atencao, main, sub, pct, expectedPct }
function health(g, year) {
  if (g.type === "contador") {
    const n = (g.items || []).filter((i) => i.doneAt).length;
    const target = g.target || 1;
    const pct = Math.min(100, Math.round((n / target) * 100));
    const expectedPct = Math.round(yearFrac(year) * 100);
    const reading = inProgress(g);
    const now = reading.length ? `${nowWord(g)}: ${reading.map((i) => i.title).join(", ")}` : null;
    if (n >= target) return { state: "feito", main: `${n} de ${target}. Meta do ano batida!`, sub: now, pct, expectedPct };
    if (year > CUR_YEAR) return { state: "ritmo", main: `${n} de ${target}`, sub: "O ano ainda não começou.", pct, expectedPct };
    const expected = Math.floor(target * yearFrac(year));
    const behind = expected - n;
    let sub = null;
    if (year === CUR_YEAR) {
      const rem = target - n; const every = Math.max(1, Math.floor(daysLeftInYear() / rem));
      sub = `Faltam ${rem}. Um a cada ${every} ${every === 1 ? "dia" : "dias"} fecha a meta.`;
    }
    if (now) sub = sub ? `${now}. ${sub}` : now;
    return behind > 0
      ? { state: "atencao", main: `${n} de ${target}, ${behind} atrás do ritmo`, sub, pct, expectedPct }
      : { state: "ritmo", main: `${n} de ${target}, no ritmo`, sub, pct, expectedPct };
  }

  if (g.type === "mensal") {
    const { ok, eligible } = monthsSummary(g, year);
    const hist = eligible ? `${ok} de ${eligible} ${eligible === 1 ? "mês" : "meses"} na meta` : null;
    if (year !== CUR_YEAR) {
      return { state: year < CUR_YEAR && eligible && ok === eligible ? "feito" : "ritmo", main: hist || "Sem registros" };
    }
    // Todos os meses que faltam (inclusive o atual) estão em pausa: o hábito já fechou o ano
    let restPaused = true;
    for (let m = CUR_MONTH; m <= 12; m++) if (!g.months?.[m]?.pause) restPaused = false;
    if (restPaused && eligible) {
      return { state: "feito", main: `Ano fechado: ${ok} de ${eligible} meses na meta`, sub: "Os meses que faltam estão em pausa." };
    }
    const mo = g.months?.[CUR_MONTH] || {};
    const n = monthCount(g, CUR_MONTH);
    const min = g.min || 1;
    const M = MONTHS_FULL[CUR_MONTH - 1].replace(/^./, (c) => c.toUpperCase());
    const goalTxt = g.max && g.max > min ? `meta ${min} a ${g.max}` : `meta ${min}`;
    if (mo.pause) return { state: "ritmo", main: `${M} em pausa${mo.note ? `: ${mo.note}` : ""}`, sub: hist };
    if (n >= min) return { state: "ritmo", main: g.mode === "texto" ? `${M} registrado` : `${M}: ${n}, meta do mês batida`, sub: hist };
    const prevBelow = CUR_MONTH > 1 && monthState(g, year, CUR_MONTH - 1) === "abaixo";
    const att = prevBelow || monthFrac() > 0.6;
    return { state: att ? "atencao" : "ritmo", main: g.mode === "texto" ? `${M} ainda sem registro` : `${M}: ${n} até agora (${goalTxt})`, sub: hist };
  }

  if (g.type === "simples") {
    if (g.status === "feito") return { state: "feito", main: g.doneAt ? `Concluída em ${ddmm(g.doneAt)}` : "Concluída" };
    const steps = g.steps || [];
    const next = steps.find((s) => !s.done);
    const sd = steps.filter((s) => s.done).length;
    const last = lastActivity(g);
    const stale = !last || daysSince(last) > 30;
    const lastTxt = last ? `Último avanço ${sinceText(last)}` : "Comece registrando um avanço";
    if (steps.length) {
      return {
        state: stale ? "atencao" : "ritmo",
        main: `${sd} de ${steps.length} etapas`,
        sub: next ? `Próxima: ${next.text}` : "Todas as etapas feitas. Já dá para concluir?",
        pct: Math.round((sd / steps.length) * 100),
      };
    }
    return { state: stale ? "atencao" : "ritmo", main: lastTxt, sub: (g.log || []).length ? `${g.log.length} ${g.log.length === 1 ? "avanço registrado" : "avanços registrados"}` : null };
  }

  // lista
  const items = g.items || [];
  const d = items.filter((i) => i.done).length;
  const next = items.find((i) => !i.done);
  return {
    state: d > 0 ? "ritmo" : "atencao",
    main: `${d} ${d === 1 ? "experiência vivida" : "experiências vividas"}`,
    sub: next ? `Na lista: ${next.text}` : "Adicione o que você quer viver.",
  };
}

// Próxima ação de um toque para a lista "Agora em <mês>"
function actionFor(g, year, h) {
  if (year !== CUR_YEAR || h.state === "feito") return null;
  const att = h.state === "atencao";
  if (g.type === "mensal") {
    const mo = g.months?.[CUR_MONTH] || {};
    if (mo.pause || monthCount(g, CUR_MONTH) >= (g.min || 1)) return null;
    return { kind: "mensal", prio: att ? 0 : 0.5 };
  }
  if (g.type === "contador") return { kind: "contador", prio: att ? 0 : 3 };
  if (g.type === "simples") {
    const next = (g.steps || []).find((s) => !s.done);
    if (next) return { kind: "step", step: next, prio: att ? 1 : 3 };
    return att ? { kind: "log", prio: 1 } : null;
  }
  const next = (g.items || []).find((i) => !i.done);
  return next ? { kind: "lista", item: next, prio: 5 } : null;
}

// Copia a estrutura das metas para um ano novo, zerando o progresso
function blankCopy(g) {
  const base = { id: uid(), title: g.title, type: g.type };
  if (g.type === "simples") return { ...base, status: "afazer", note: "", steps: [], log: [] };
  if (g.type === "contador") return { ...base, target: g.target || 12, items: [] };
  if (g.type === "mensal") return { ...base, min: g.min || 1, max: g.max || null, mode: g.mode || "datas", months: {} };
  return { ...base, items: [] };
}

export default function Metas({ metas = {}, setMetas, owner = { name: "Rafaela", color: C.accent }, eventsFor = () => [], onSchedule = null }) {
  const [year, setYear] = useState(CUR_YEAR);
  const [openId, setOpenId] = useState(null);
  const [view, setView] = useState("metas"); // metas | ano
  const [filter, setFilter] = useState(null); // null | feito | ritmo | atencao
  const [adding, setAdding] = useState(false);
  const [editIntro, setEditIntro] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [moreActions, setMoreActions] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);

  const yd = metas[year];
  const goals = yd?.goals || [];
  const prev = metas[year - 1];

  const updateYear = (fn) => setMetas((m) => ({ ...m, [year]: fn(m?.[year] || { intro: "", goals: [] }) }));
  const updateGoal = (id, fn) => updateYear((y) => ({ ...y, goals: y.goals.map((g) => (g.id === id ? fn(g) : g)) }));
  const removeGoal = (id) => { updateYear((y) => ({ ...y, goals: y.goals.filter((g) => g.id !== id) })); setOpenId(null); };
  const moveGoal = (id, dir) => updateYear((y) => {
    const arr = [...y.goals]; const i = arr.findIndex((g) => g.id === id); const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return y;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return { ...y, goals: arr };
  });
  const addGoal = (g) => { updateYear((y) => ({ ...y, goals: [...y.goals, g] })); setAdding(false); setOpenId(g.id); setFilter(null); };
  const changeYear = (d) => { setYear(year + d); setOpenId(null); setFilter(null); setView("metas"); };

  const rows = goals.map((g) => { const h = health(g, year); return { g, h, a: actionFor(g, year, h) }; });
  const counts = { feito: 0, ritmo: 0, atencao: 0 };
  rows.forEach((r) => counts[r.h.state]++);
  const actions = rows.filter((r) => r.a).sort((x, y) => x.a.prio - y.a.prio);
  const shownActions = moreActions ? actions : actions.slice(0, 4);

  return (
    <div style={{ animation: "fade .25s ease" }}>
      {/* Ano */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button className="rot-btn" onClick={() => changeYear(-1)} aria-label="Ano anterior" style={{ ...iconBtn, width: 36, height: 36, border: `1px solid ${C.line}`, background: C.surface, borderRadius: 11 }}><ChevronLeft size={18} /></button>
        <div style={{ textAlign: "center" }}>
          <div style={{ ...display, fontSize: 22, fontWeight: 600, letterSpacing: -0.4 }}>Metas de {year}</div>
          <div style={{ fontSize: 12.5, color: C.sub, marginTop: 1 }}>{owner.name}</div>
        </div>
        <button className="rot-btn" onClick={() => changeYear(1)} aria-label="Próximo ano" style={{ ...iconBtn, width: 36, height: 36, border: `1px solid ${C.line}`, background: C.surface, borderRadius: 11 }}><ChevronRight size={18} /></button>
      </div>

      {/* Ano vazio */}
      {!yd && !adding && (
        <div style={{ ...card, padding: "26px 20px", textAlign: "center" }}>
          <Sparkles size={26} color={SUN.color} />
          <div style={{ ...display, fontSize: 18, fontWeight: 600, marginTop: 8 }}>{year} ainda está em branco</div>
          <div style={{ fontSize: 13.5, color: C.sub, margin: "6px 0 16px" }}>Defina o que você quer viver e conquistar neste ano.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 320, margin: "0 auto" }}>
            {prev?.goals?.length > 0 && (
              <button onClick={() => setMetas((m) => ({ ...m, [year]: { intro: "", goals: prev.goals.map(blankCopy) } }))} style={{ ...primaryBtn, justifyContent: "center", padding: "11px 0" }}>
                Repetir as metas de {year - 1}
              </button>
            )}
            <button onClick={() => { setMetas((m) => ({ ...m, [year]: { intro: "", goals: [] } })); setAdding(true); }} style={{ ...softBtn, justifyContent: "center", padding: "11px 0" }}>
              Começar do zero
            </button>
          </div>
        </div>
      )}

      {yd && view === "ano" && goals.length > 0 && (
        <YearView rows={rows} year={year} onBack={() => setView("metas")} openGoal={(id) => { setView("metas"); setFilter(null); setOpenId(id); }} />
      )}

      {yd && view === "metas" && (
        <>
          {/* Resumo do ano */}
          {goals.length > 0 && (
            <div style={{ ...card, padding: "16px 16px 14px", marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 7 }}>
                <span style={{ fontSize: 13, color: C.sub }}>
                  {year === CUR_YEAR ? `Faltam ${daysLeftInYear()} dias para o fim do ano` : year < CUR_YEAR ? `${year} encerrado` : `${year} ainda não começou`}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{Math.round(yearFrac(year) * 100)}% do ano</span>
              </div>
              <div style={{ height: 6, background: "#EBEFF6", borderRadius: 99, overflow: "hidden", marginBottom: 14 }}>
                <div style={{ height: "100%", width: `${Math.round(yearFrac(year) * 100)}%`, background: `repeating-linear-gradient(90deg, ${C.accent} 0 calc(100%/12 - 2px), transparent calc(100%/12 - 2px) calc(100%/12))`, borderRadius: 99, transition: "width .5s" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {["feito", "ritmo", "atencao"].map((k) => {
                  const H = HEALTH[k]; const Ic = H.icon; const on = filter === k; const n = counts[k];
                  return (
                    <button key={k} className="lar-chip" onClick={() => setFilter(on ? null : k)} aria-pressed={on}
                      style={{ textAlign: "left", padding: "10px 11px", borderRadius: 13, cursor: "pointer", fontFamily: "inherit",
                        border: `1.5px solid ${on ? H.color : "transparent"}`, background: H.soft, color: H.color, opacity: n === 0 && !on ? 0.55 : 1 }}>
                      <Ic size={15} />
                      <div style={{ ...display, fontSize: 24, fontWeight: 700, lineHeight: 1.1, marginTop: 4 }}>{n}</div>
                      <div style={{ fontSize: 11.5, fontWeight: 600 }}>{n === 1 ? H.label.toLowerCase() : H.plural}</div>
                    </button>
                  );
                })}
              </div>
              <button onClick={() => setView("ano")} style={{ ...ghostBtn, display: "flex", alignItems: "center", gap: 6, marginTop: 12, color: C.accent, fontWeight: 600 }}>
                <Grid3x3 size={14} /> Ver o ano mês a mês
              </button>
            </div>
          )}

          {/* Agora em <mês> */}
          {year === CUR_YEAR && goals.length > 0 && !filter && (
            <div style={{ marginBottom: 22 }}>
              <div style={{ ...display, fontSize: 18, fontWeight: 600, letterSpacing: -0.3 }}>Agora em {MONTHS_FULL[CUR_MONTH - 1]}</div>
              <div style={{ fontSize: 12.5, color: C.sub, margin: "2px 0 10px" }}>Um toque para registrar e manter suas metas andando.</div>
              {actions.length === 0 ? (
                <div style={{ ...card, padding: "16px", fontSize: 13.5, color: C.sub, display: "flex", gap: 10, alignItems: "center" }}>
                  <Sparkles size={17} color={SUN.color} /> Tudo em dia por aqui.
                </div>
              ) : (
                <div style={{ ...card, overflow: "hidden" }}>
                  {shownActions.map((r, i) => (
                    <ActionItem key={r.g.id} r={r} first={i === 0} update={(fn) => updateGoal(r.g.id, fn)} toast={setToast} />
                  ))}
                  {actions.length > 4 && (
                    <button onClick={() => setMoreActions(!moreActions)} style={{ ...ghostBtn, width: "100%", padding: "11px 0", borderTop: `1px solid ${C.line}`, color: C.accent, fontWeight: 600 }}>
                      {moreActions ? "Mostrar menos" : `Mostrar mais ${actions.length - 4}`}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Recado do ano */}
          <div style={{ ...card, padding: "13px 15px", marginBottom: 20, display: "flex", gap: 11, alignItems: "flex-start" }}>
            <Quote size={16} color={SUN.color} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              {editIntro ? (
                <>
                  <textarea autoFocus value={yd.intro || ""} onChange={(e) => updateYear((y) => ({ ...y, intro: e.target.value }))}
                    placeholder="Um recado para você mesma sobre este ano"
                    style={{ ...input, width: "100%", minHeight: 120, resize: "vertical", lineHeight: 1.55 }} />
                  <button onClick={() => setEditIntro(false)} style={{ ...ghostBtn, color: C.accent, fontWeight: 600, marginTop: 8 }}>Pronto</button>
                </>
              ) : yd.intro ? (
                <>
                  <div style={{ fontSize: 13.5, lineHeight: 1.55, color: C.ink, whiteSpace: "pre-wrap", ...(introOpen ? {} : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }) }}>{yd.intro}</div>
                  <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
                    <button onClick={() => setIntroOpen(!introOpen)} style={{ ...ghostBtn, color: C.accent, fontWeight: 600 }}>{introOpen ? "Mostrar menos" : "Ler o recado"}</button>
                    {introOpen && <button onClick={() => setEditIntro(true)} style={ghostBtn}>Editar</button>}
                  </div>
                </>
              ) : (
                <button onClick={() => setEditIntro(true)} style={{ ...ghostBtn, color: C.sub, textAlign: "left" }}>Escreva um recado para você mesma sobre {year}.</button>
              )}
            </div>
          </div>

          {/* Metas agrupadas pela saúde */}
          {["atencao", "ritmo", "feito"].filter((k) => !filter || filter === k).map((k) => {
            const list = rows.filter((r) => r.h.state === k);
            if (!list.length) return null;
            const H = HEALTH[k];
            return (
              <div key={k} style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 99, background: H.color }} />
                  <span style={{ ...display, fontSize: 15.5, fontWeight: 600, color: H.color }}>{k === "feito" ? "Conquistas" : H.label}</span>
                  <span style={{ fontSize: 12.5, color: C.faint }}>{list.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {list.map(({ g, h }) => {
                    const idx = goals.findIndex((x) => x.id === g.id);
                    return (
                      <GoalRow key={g.id} g={g} h={h} year={year} open={openId === g.id}
                        events={eventsFor(year, g.id)} onSchedule={onSchedule ? () => onSchedule(year, g.id) : null}
                        onToggle={() => setOpenId(openId === g.id ? null : g.id)}
                        update={(fn) => updateGoal(g.id, fn)} toast={setToast}
                        remove={() => removeGoal(g.id)}
                        moveUp={idx > 0 ? () => moveGoal(g.id, -1) : null}
                        moveDown={idx < goals.length - 1 ? () => moveGoal(g.id, 1) : null} />
                    );
                  })}
                </div>
              </div>
            );
          })}
          {filter && <button onClick={() => setFilter(null)} style={{ ...ghostBtn, color: C.accent, fontWeight: 600, marginBottom: 12 }}>Mostrar todas as metas</button>}

          {adding ? <NewGoal onAdd={addGoal} onCancel={() => setAdding(false)} /> : (
            <button className="rot-btn" onClick={() => setAdding(true)}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", padding: "13px 14px", borderRadius: 14, border: `1.5px dashed ${C.line2}`, background: C.surface, cursor: "pointer", fontSize: 13.5, fontWeight: 600, color: C.sub, marginTop: 4, fontFamily: "inherit" }}>
              <Plus size={16} /> Nova meta
            </button>
          )}
        </>
      )}
      {!yd && adding && <NewGoal onAdd={addGoal} onCancel={() => setAdding(false)} />}

      {toast && (
        <div role="status" style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: "calc(env(safe-area-inset-bottom, 0px) + 100px)", zIndex: 30,
          background: C.ink, color: "#fff", padding: "11px 16px", borderRadius: 14, fontSize: 13.5, fontWeight: 500, boxShadow: "0 10px 30px rgba(24,35,63,.25)",
          display: "flex", alignItems: "center", gap: 9, maxWidth: "calc(100% - 40px)", animation: "lar-rise .25s ease" }}>
          <Sparkles size={16} color={SUN.color} /> {toast}
        </div>
      )}
    </div>
  );
}

// ---------- uma ação rápida da lista "Agora" ----------
function ActionItem({ r, first, update, toast }) {
  const { g, h, a } = r;
  const T = TYPES[g.type]; const Ic = T.icon; const H = HEALTH[h.state];
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [otherDate, setOtherDate] = useState(false);
  const M = MONTHS_FULL[CUR_MONTH - 1];

  const addMonthDate = (d) => {
    const n = monthCount(g, CUR_MONTH) + 1;
    update((x) => {
      const cur = x.months?.[CUR_MONTH] || {};
      return { ...x, months: { ...(x.months || {}), [CUR_MONTH]: { ...cur, dates: Array.from(new Set([...(cur.dates || []), d])).sort() } } };
    });
    toast(n >= (g.min || 1) ? `Meta de ${M} batida em "${g.title}"!` : `Registrado. ${n} em ${M}.`);
  };
  const saveMonthText = () => {
    if (!text.trim()) return;
    update((x) => ({ ...x, months: { ...(x.months || {}), [CUR_MONTH]: { ...(x.months?.[CUR_MONTH] || {}), text: text.trim() } } }));
    toast(`Registrado em ${M}!`); setText(""); setOpen(false);
  };
  const finishItem = (id) => {
    const n = (g.items || []).filter((i) => i.doneAt).length + 1;
    update((x) => ({ ...x, items: x.items.map((i) => i.id === id ? { ...i, doneAt: TODAY } : i) }));
    toast(n >= (g.target || 1) ? "Meta do ano batida!" : `Boa! ${n} de ${g.target}.`); setOpen(false);
  };
  const addAndFinish = () => {
    if (!text.trim()) return;
    const n = (g.items || []).filter((i) => i.doneAt).length + 1;
    update((x) => ({ ...x, items: [...(x.items || []), { id: uid(), title: text.trim(), sub: "", doneAt: TODAY }] }));
    toast(n >= (g.target || 1) ? "Meta do ano batida!" : `Boa! ${n} de ${g.target}.`); setText(""); setOpen(false);
  };
  const doStep = () => {
    const left = (g.steps || []).filter((s) => !s.done).length - 1;
    update((x) => ({ ...x, steps: x.steps.map((s) => s.id === a.step.id ? { ...s, done: true, doneAt: TODAY } : s) }));
    toast(left === 0 ? "Todas as etapas feitas!" : "Etapa concluída.");
  };
  const saveLog = () => {
    if (!text.trim()) return;
    update((x) => ({ ...x, log: [...(x.log || []), { id: uid(), date: TODAY, text: text.trim() }] }));
    toast("Avanço registrado."); setText(""); setOpen(false);
  };
  const doLista = () => {
    update((x) => ({ ...x, items: x.items.map((i) => i.id === a.item.id ? { ...i, done: true, doneAt: TODAY } : i) }));
    toast("Mais uma experiência vivida!");
  };

  let main, btn = null, body = null;
  if (a.kind === "mensal") {
    main = h.main;
    if (g.mode === "texto") {
      btn = <button onClick={() => setOpen(!open)} style={primaryBtn}><PenLine size={14} /> Registrar</button>;
      body = open && (
        <div style={{ display: "flex", gap: 6 }}>
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveMonthText()} placeholder={`O que foi em ${M}?`} style={{ ...input, flex: 1, minWidth: 0 }} />
          <button onClick={saveMonthText} style={{ ...primaryBtn, opacity: text.trim() ? 1 : 0.4 }}>Salvar</button>
        </div>
      );
    } else {
      btn = <button onClick={() => addMonthDate(TODAY)} style={primaryBtn}><Plus size={14} /> Hoje</button>;
      body = (
        <div>
          {otherDate ? (
            <input type="date" autoFocus min={`${CUR_YEAR}-${String(CUR_MONTH).padStart(2, "0")}-01`} max={TODAY}
              onChange={(e) => { if (e.target.value) { addMonthDate(e.target.value); setOtherDate(false); } }} onBlur={() => setOtherDate(false)} style={{ ...input, padding: "6px 9px", fontSize: 13 }} />
          ) : (
            <button onClick={() => setOtherDate(true)} style={{ ...ghostBtn, fontSize: 12 }}>Foi em outro dia</button>
          )}
        </div>
      );
    }
  } else if (a.kind === "contador") {
    const reading = inProgress(g);
    const pending = (g.items || []).filter((i) => !i.doneAt && !i.startedAt);
    const startItem = (id) => {
      const it = g.items.find((i) => i.id === id);
      update((x) => ({ ...x, items: x.items.map((i) => i.id === id ? { ...i, startedAt: TODAY } : i) }));
      toast(isBookGoal(g) ? `Boa leitura: ${it.title}!` : `Começou: ${it.title}.`); setOpen(false);
    };
    const addAndStart = () => {
      if (!text.trim()) return;
      update((x) => ({ ...x, items: [...(x.items || []), { id: uid(), title: text.trim(), sub: "", startedAt: TODAY, doneAt: null }] }));
      toast(isBookGoal(g) ? `Boa leitura: ${text.trim()}!` : `Começou: ${text.trim()}.`); setText(""); setOpen(false);
    };
    if (reading.length) {
      main = <>{nowWord(g)}: <b style={{ fontWeight: 600 }}>{reading.map((i) => i.title).join(", ")}</b></>;
      btn = reading.length === 1
        ? <button onClick={() => finishItem(reading[0].id)} style={primaryBtn}><Check size={14} /> Terminei</button>
        : <button onClick={() => setOpen(open === "fim" ? false : "fim")} style={primaryBtn}><Check size={14} /> Terminei</button>;
    } else {
      main = <>{h.main}. {isBookGoal(g) ? "O que você está lendo?" : "Qual é o próximo?"}</>;
      btn = <button onClick={() => setOpen(open === "ini" ? false : "ini")} style={primaryBtn}><BookOpen size={14} /> {startWord(g)}</button>;
    }
    body = (
      <div>
        {open === "fim" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {reading.map((i) => <button key={i.id} className="lar-chip" onClick={() => finishItem(i.id)} style={{ ...softBtn, padding: "6px 11px", fontSize: 12.5, borderRadius: 99 }}>{i.title}</button>)}
          </div>
        )}
        {open === "ini" && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {pending.map((i) => <button key={i.id} className="lar-chip" onClick={() => startItem(i.id)} style={{ ...softBtn, padding: "6px 11px", fontSize: 12.5, borderRadius: 99 }}>{i.title}</button>)}
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addAndStart()} placeholder={isBookGoal(g) ? "Outro livro (digite o título)" : "Outro (digite o nome)"} style={{ ...input, flex: 1, minWidth: 0 }} />
              <button onClick={addAndStart} style={{ ...primaryBtn, opacity: text.trim() ? 1 : 0.4 }}>Salvar</button>
            </div>
          </>
        )}
        {open === "outro" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {pending.map((i) => <button key={i.id} className="lar-chip" onClick={() => finishItem(i.id)} style={{ ...softBtn, padding: "6px 11px", fontSize: 12.5, borderRadius: 99 }}>{i.title}</button>)}
          </div>
        )}
        {open !== "outro" && pending.length > 0 && (
          <button onClick={() => setOpen("outro")} style={{ ...ghostBtn, fontSize: 12 }}>{reading.length ? "Terminei outro" : "Já terminei um"}</button>
        )}
      </div>
    );
  } else if (a.kind === "step") {
    main = <>Próxima etapa: <b style={{ fontWeight: 600 }}>{a.step.text}</b></>;
    btn = <CheckBox on={false} color={C.accent} onClick={doStep} size={26} />;
  } else if (a.kind === "log") {
    main = h.main;
    btn = <button onClick={() => setOpen(!open)} style={softBtn}><PenLine size={14} /> Registrar avanço</button>;
    body = open && (
      <div style={{ display: "flex", gap: 6 }}>
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveLog()} placeholder="O que você fez? Pode ser pequeno." style={{ ...input, flex: 1, minWidth: 0 }} />
        <button onClick={saveLog} style={{ ...primaryBtn, opacity: text.trim() ? 1 : 0.4 }}>Salvar</button>
      </div>
    );
  } else {
    main = <>Da lista: <b style={{ fontWeight: 600 }}>{a.item.text}</b></>;
    btn = <button onClick={doLista} style={softBtn}><Check size={14} /> Fiz</button>;
  }

  return (
    <div style={{ padding: "13px 14px", borderTop: first ? "none" : `1px solid ${C.line}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: H.soft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Ic size={16} color={H.color} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: C.faint, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.title}</div>
          <div style={{ fontSize: 13.5, color: h.state === "atencao" ? AMBER.color : C.ink, lineHeight: 1.35, marginTop: 1 }}>{main}</div>
        </div>
        {btn}
      </div>
      {body && <div style={{ marginTop: 10, marginLeft: 45 }}>{body}</div>}
    </div>
  );
}

// ---------- cartão de uma meta ----------
function GoalRow({ g, h, year, open, onToggle, update, toast, remove, moveUp, moveDown, events = [], onSchedule }) {
  const nextEv = events.find((e) => !e.status && e.date >= TODAY);
  const T = TYPES[g.type] || TYPES.simples; const Ic = T.icon; const H = HEALTH[h.state];
  const [renaming, setRenaming] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const steps = g.steps || [];

  return (
    <div className="rot-row" style={{ ...card, overflow: "hidden", borderColor: open ? C.line2 : C.line }}>
      <div onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onToggle()} aria-expanded={open}
        style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 14px", cursor: "pointer" }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: H.soft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {h.state === "feito" ? <Trophy size={18} color={H.color} /> : <Ic size={18} color={H.color} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.3 }}>{g.title}</div>
          <div style={{ fontSize: 13, color: h.state === "atencao" ? AMBER.color : h.state === "feito" ? GREEN.color : C.sub, marginTop: 3, fontWeight: 500 }}>{h.main}</div>
          {h.sub && <div style={{ fontSize: 12, color: C.faint, marginTop: 2, lineHeight: 1.4 }}>{h.sub}</div>}
          {nextEv && <div style={{ fontSize: 12, color: C.accent, marginTop: 4, display: "flex", alignItems: "center", gap: 5 }}><CalendarDays size={12} /> {nextEv.title}, {ddmm(nextEv.date)}</div>}

          {g.type === "contador" && (
            <div style={{ position: "relative", height: 8, background: "#EBEFF6", borderRadius: 99, marginTop: 9 }}>
              <div style={{ position: "absolute", inset: 0, width: `${h.pct}%`, background: H.color, borderRadius: 99, transition: "width .5s" }} />
              {h.state !== "feito" && year === CUR_YEAR && (
                <div title="Onde você deveria estar hoje" style={{ position: "absolute", top: -3, left: `calc(${h.expectedPct}% - 1px)`, width: 2, height: 14, background: C.ink, borderRadius: 2, opacity: 0.55 }} />
              )}
            </div>
          )}
          {g.type === "mensal" && (
            <div style={{ display: "flex", gap: 3, marginTop: 9 }}>
              {MONTHS.map((mn, i) => {
                const s = monthState(g, year, i + 1); const col = MONTH_COLORS[s];
                const cur = year === CUR_YEAR && i + 1 === CUR_MONTH;
                return <div key={mn} title={`${mn}: ${monthCount(g, i + 1)}`} style={{ flex: 1, height: 8, borderRadius: 3, background: s === "futuro" ? "#EBEFF6" : col.bg, outline: cur ? `1.5px solid ${C.ink}` : "none", outlineOffset: 1 }} />;
              })}
            </div>
          )}
          {g.type === "simples" && steps.length > 0 && h.state !== "feito" && (
            <div style={{ display: "flex", gap: 3, marginTop: 9 }}>
              {steps.map((s) => <div key={s.id} style={{ flex: 1, height: 6, borderRadius: 3, background: s.done ? H.color : "#EBEFF6" }} />)}
            </div>
          )}
        </div>
        {open ? <ChevronUp size={18} color={C.faint} style={{ marginTop: 10 }} /> : <ChevronDown size={18} color={C.faint} style={{ marginTop: 10 }} />}
      </div>

      {open && (
        <div style={{ borderTop: `1px solid ${C.line}`, background: "#F7F9FC", padding: "14px 14px 12px", cursor: "default" }}>
          {g.type === "simples" && <SimplesDetail g={g} update={update} toast={toast} />}
          {g.type === "contador" && <ContadorDetail g={g} update={update} />}
          {g.type === "mensal" && <MensalDetail g={g} year={year} update={update} />}
          {g.type === "lista" && <ListaDetail g={g} update={update} />}

          {(events.length > 0 || onSchedule) && (
            <div style={{ marginTop: 14 }}>
              <Label>Na agenda</Label>
              {events.map((e) => (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 13 }}>
                  <span style={{ width: 42, color: C.faint, fontSize: 12 }}>{ddmm(e.date)}</span>
                  <span style={{ flex: 1, color: e.status === "cancelado" ? C.faint : C.ink, textDecoration: e.status === "cancelado" ? "line-through" : "none" }}>{e.title}</span>
                  {e.status === "feito" && <Tag soft={GREEN.soft} color={GREEN.color}><Check size={11} /> contou</Tag>}
                  {!e.status && e.date < TODAY && <Tag soft={AMBER.soft} color={AMBER.color}>confirmar na agenda</Tag>}
                </div>
              ))}
              {events.length === 0 && <div style={{ fontSize: 12.5, color: C.faint, marginBottom: 4 }}>Agende aulas, sessões ou experiências desta meta. Quando acontecerem, contam aqui sozinhas.</div>}
              {onSchedule && <button onClick={onSchedule} style={{ ...softBtn, marginTop: 6, padding: "6px 11px", fontSize: 12.5 }}><Plus size={13} /> Agendar</button>}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16, paddingTop: 11, borderTop: `1px solid ${C.line}`, flexWrap: "wrap" }}>
            {renaming ? (
              <div style={{ display: "flex", gap: 6, flex: 1, minWidth: 200 }}>
                <input autoFocus value={g.title} onChange={(e) => update((x) => ({ ...x, title: e.target.value }))} style={{ ...input, flex: 1, minWidth: 0 }} />
                <button onClick={() => setRenaming(false)} style={{ ...ghostBtn, color: C.accent, fontWeight: 600 }}>Pronto</button>
              </div>
            ) : (
              <button onClick={() => setRenaming(true)} style={{ ...ghostBtn, display: "flex", alignItems: "center", gap: 5 }}><Pencil size={13} /> Renomear</button>
            )}
            {moveUp && <button onClick={moveUp} title="Subir na ordem" aria-label="Subir na ordem" style={{ ...ghostBtn, display: "flex", alignItems: "center" }}><ArrowUp size={15} /></button>}
            {moveDown && <button onClick={moveDown} title="Descer na ordem" aria-label="Descer na ordem" style={{ ...ghostBtn, display: "flex", alignItems: "center" }}><ArrowDown size={15} /></button>}
            <div style={{ marginLeft: "auto" }}>
              {confirmDel ? (
                <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <span style={{ fontSize: 12.5, color: C.sub }}>Apagar esta meta?</span>
                  <button onClick={remove} style={{ ...ghostBtn, color: PINK.color, fontWeight: 600 }}>Apagar</button>
                  <button onClick={() => setConfirmDel(false)} style={ghostBtn}>Cancelar</button>
                </span>
              ) : (
                <button onClick={() => setConfirmDel(true)} style={{ ...ghostBtn, display: "flex", alignItems: "center", gap: 5, color: C.faint }}><Trash2 size={13} /> Apagar</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SimplesDetail({ g, update, toast }) {
  const steps = g.steps || [];
  const log = [...(g.log || [])].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const feito = g.status === "feito";
  return (
    <>
      {feito ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16, padding: "11px 12px", borderRadius: 12, background: GREEN.soft }}>
          <Trophy size={17} color={GREEN.color} />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: GREEN.color }}>Concluída em</span>
          <input type="date" value={g.doneAt || ""} onChange={(e) => update((x) => ({ ...x, doneAt: e.target.value || null }))} style={{ ...input, padding: "5px 8px", fontSize: 13 }} />
          <button onClick={() => update((x) => ({ ...x, status: "andamento", doneAt: null }))} style={{ ...ghostBtn, marginLeft: "auto" }}>Reabrir</button>
        </div>
      ) : (
        <button onClick={() => { update((x) => ({ ...x, status: "feito", doneAt: x.doneAt || TODAY })); toast("Meta concluída! Mais uma conquista."); }}
          style={{ ...primaryBtn, background: GREEN.color, width: "100%", justifyContent: "center", padding: "11px 0", marginBottom: 16 }}>
          <Trophy size={15} /> Marcar como concluída
        </button>
      )}

      <Label>Etapas</Label>
      {steps.length === 0 && <div style={{ fontSize: 12.5, color: C.faint, marginBottom: 2 }}>Quebre a meta em passos pequenos. O próximo passo aparece em "Agora".</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {steps.map((s) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <CheckBox on={s.done} onClick={() => update((x) => ({ ...x, steps: x.steps.map((y) => y.id === s.id ? { ...y, done: !y.done, doneAt: !y.done ? TODAY : null } : y) }))} />
            <div style={{ flex: 1, fontSize: 13.5, color: s.done ? C.faint : C.ink, textDecoration: s.done ? "line-through" : "none" }}>{s.text}</div>
            {s.done && s.doneAt && <span style={{ fontSize: 11.5, color: C.faint }}>{ddmm(s.doneAt)}</span>}
            <button onClick={() => update((x) => ({ ...x, steps: x.steps.filter((y) => y.id !== s.id) }))} style={iconBtn} aria-label="Remover etapa"><X size={14} color={C.faint} /></button>
          </div>
        ))}
      </div>
      <AddLine placeholder="Adicionar etapa" onAdd={(t) => update((x) => ({ ...x, steps: [...(x.steps || []), { id: uid(), text: t, done: false }] }))} />

      <div style={{ marginTop: 18 }}>
        <Label>Avanços</Label>
        <AddLine placeholder="O que você fez? (fica com a data de hoje)" onAdd={(t) => { update((x) => ({ ...x, log: [...(x.log || []), { id: uid(), date: TODAY, text: t }] })); toast("Avanço registrado."); }} />
        <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
          {log.map((l) => (
            <div key={l.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "6px 0" }}>
              <span style={{ fontSize: 11.5, color: C.accent, fontWeight: 600, width: 38, flexShrink: 0 }}>{ddmm(l.date)}</span>
              <span style={{ flex: 1, fontSize: 13.5, lineHeight: 1.45 }}>{l.text}</span>
              <button onClick={() => update((x) => ({ ...x, log: x.log.filter((y) => y.id !== l.id) }))} style={{ ...iconBtn, width: 24, height: 24 }} aria-label="Remover avanço"><X size={13} color={C.faint} /></button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <Label>Anotações</Label>
        <textarea value={g.note || ""} onChange={(e) => update((x) => ({ ...x, note: e.target.value }))} placeholder="Ideias, links, o que te motiva nesta meta"
          style={{ ...input, width: "100%", minHeight: 64, resize: "vertical", lineHeight: 1.5 }} />
      </div>
    </>
  );
}

// ---------- visão anual: todas as metas, mês a mês ----------
function YearView({ rows, year, onBack, openGoal }) {
  const isCur = (m) => year === CUR_YEAR && m === CUR_MONTH;
  return (
    <div>
      <button onClick={onBack} style={{ ...ghostBtn, display: "flex", alignItems: "center", gap: 5, color: C.accent, fontWeight: 600, marginBottom: 12 }}><ChevronLeft size={15} /> Voltar para as metas</button>
      <div style={{ ...card, padding: "14px 14px 8px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 3, marginBottom: 8 }}>
          {MONTHS.map((mn, i) => (
            <div key={mn} style={{ textAlign: "center", fontSize: 10.5, fontWeight: isCur(i + 1) ? 700 : 500, color: isCur(i + 1) ? C.accent : C.faint }}>{mn.slice(0, 1)}</div>
          ))}
        </div>
        {rows.map(({ g, h }, gi) => {
          const H = HEALTH[h.state];
          return (
            <div key={g.id} style={{ padding: "9px 0", borderTop: gi ? `1px solid ${C.line}` : "none" }}>
              <div onClick={() => openGoal(g.id)} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6, cursor: "pointer" }}>
                <span style={{ width: 7, height: 7, borderRadius: 99, background: H.color, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}>{g.title}</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 3 }}>
                {MONTHS.map((mn, i) => {
                  const c = yearCell(g, year, i + 1);
                  return (
                    <div key={mn} title={mn} style={{ height: 22, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 600, background: c.bg === "transparent" ? "#F2F5F9" : c.bg, color: c.fg, outline: isCur(i + 1) ? `1.5px solid ${C.ink}` : "none", outlineOffset: -1 }}>
                      {c.text}
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 11.5, color: H.color, marginTop: 5, fontWeight: 500 }}>{h.main}</div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: C.faint, lineHeight: 1.55, marginTop: 10 }}>
        Hábitos mensais mostram quantas vezes no mês: verde quando bate a meta, rosa quando ficou abaixo, p quando é pausa. Livros e experiências mostram quantos foram concluídos no mês. Metas concluídas e etapas ganham ✓ no mês em que aconteceram.
      </div>
    </div>
  );
}


const monthOf = (d, year) => (d && Number(d.slice(0, 4)) === year ? Number(d.slice(5, 7)) : null);

function yearCell(g, year, m) {
  // devolve { text, bg, fg } da célula da meta g no mês m
  if (g.type === "mensal") {
    const s = monthState(g, year, m); const col = MONTH_COLORS[s]; const n = monthCount(g, m);
    const text = s === "pausa" ? "p" : g.mode === "texto" ? (n ? "✓" : "") : (n || (s === "futuro" ? "" : "0"));
    return { text, bg: col.bg, fg: col.fg, border: s === "futuro" };
  }
  let n = 0;
  if (g.type === "contador") n = (g.items || []).filter((i) => monthOf(i.doneAt, year) === m).length;
  if (g.type === "lista") n = (g.items || []).filter((i) => i.done && monthOf(i.doneAt, year) === m).length;
  if (g.type === "simples") {
    n = monthOf(g.doneAt, year) === m ? 1 : 0;
    if (n) return { text: "✓", bg: GREEN.color, fg: "#fff" };
    n = (g.steps || []).filter((st) => st.done && monthOf(st.doneAt, year) === m).length
      + (g.log || []).filter((l) => monthOf(l.date, year) === m).length;
  }
  return n ? { text: String(n), bg: "#E3EAFB", fg: C.accent } : { text: "", bg: "transparent", fg: C.faint };
}

function AddLine({ placeholder, onAdd, second }) {
  const [v, setV] = useState("");
  const [v2, setV2] = useState("");
  const go = () => { if (!v.trim()) return; onAdd(v.trim(), v2.trim()); setV(""); setV2(""); };
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
      <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} placeholder={placeholder} style={{ ...input, flex: 2, minWidth: 0 }} />
      {second && <input value={v2} onChange={(e) => setV2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} placeholder={second} style={{ ...input, flex: 1, minWidth: 0 }} />}
      <button onClick={go} style={{ ...iconBtn, width: 36, height: 36, border: `1px solid ${C.line}`, background: C.surface, opacity: v.trim() ? 1 : 0.4 }}><Plus size={15} color={C.sub} /></button>
    </div>
  );
}


function ContadorDetail({ g, update }) {
  const items = g.items || [];
  const setItem = (id, patch) => update((x) => ({ ...x, items: x.items.map((y) => y.id === id ? { ...y, ...patch } : y) }));
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 12.5, color: C.sub }}>Meta no ano:</span>
        <input type="number" min={1} value={g.target || ""} onChange={(e) => update((x) => ({ ...x, target: Math.max(1, Number(e.target.value) || 1) }))} style={{ ...input, width: 70 }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((it, i) => (
          <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 0", borderTop: i ? `1px solid ${C.line}` : "none" }}>
            <span style={{ width: 18, fontSize: 11.5, color: C.faint, textAlign: "right", flexShrink: 0 }}>{i + 1}</span>
            <CheckBox on={!!it.doneAt} onClick={() => setItem(it.id, { doneAt: it.doneAt ? null : TODAY })} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, color: it.doneAt ? C.sub : C.ink }}>{it.title}</div>
              {it.sub && <div style={{ fontSize: 11.5, color: C.faint }}>{it.sub}</div>}
              {!it.doneAt && (it.startedAt ? (
                <button onClick={() => setItem(it.id, { startedAt: null })} title="Tocar para desmarcar"
                  style={{ ...ghostBtn, marginTop: 4, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: C.accent, background: C.accentSoft, padding: "2px 8px", borderRadius: 7 }}>
                  <BookOpen size={11} /> {nowWord(g).toLowerCase()} desde {ddmm(it.startedAt)}
                </button>
              ) : (
                <button onClick={() => setItem(it.id, { startedAt: TODAY })} style={{ ...ghostBtn, marginTop: 3, fontSize: 11.5, color: C.faint }}>{isBookGoal(g) ? "Estou lendo" : "Comecei"}</button>
              ))}
            </div>
            {it.doneAt && (
              <input type="date" value={it.doneAt} onChange={(e) => setItem(it.id, { doneAt: e.target.value || null })}
                title="Concluído em" style={{ ...input, padding: "4px 6px", fontSize: 11.5, width: 128, color: C.sub }} />
            )}
            <button onClick={() => update((x) => ({ ...x, items: x.items.filter((y) => y.id !== it.id) }))} style={iconBtn} title="Remover"><X size={13} color={C.faint} /></button>
          </div>
        ))}
      </div>
      <AddLine placeholder="Adicionar (ex: título do livro)" second="autor (opcional)"
        onAdd={(t, s) => update((x) => ({ ...x, items: [...(x.items || []), { id: uid(), title: t, sub: s || "", doneAt: null }] }))} />
    </>
  );
}

function MensalDetail({ g, year, update }) {
  const [addFor, setAddFor] = useState(null);   // mês com o campo de data aberto
  const [moreFor, setMoreFor] = useState(null); // mês com pausa/nota aberto
  const setMonth = (m, fn) => update((x) => {
    const cur = x.months?.[m] || {};
    return { ...x, months: { ...(x.months || {}), [m]: fn(cur) } };
  });
  const minMax = g.max && g.max > (g.min || 1) ? `${g.min || 1} a ${g.max}` : `${g.min || 1}`;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: C.sub }}>Por mês: mínimo</span>
        <input type="number" min={1} value={g.min || 1} onChange={(e) => update((x) => ({ ...x, min: Math.max(1, Number(e.target.value) || 1) }))} style={{ ...input, width: 56 }} />
        <span style={{ fontSize: 12.5, color: C.sub }}>máximo</span>
        <input type="number" min={1} value={g.max || ""} placeholder="-" onChange={(e) => update((x) => ({ ...x, max: e.target.value ? Number(e.target.value) : null }))} style={{ ...input, width: 56 }} />
      </div>
      <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 12 }}>
        Meta: {minMax} por mês. {g.mode === "texto" ? "Conta quando o mês tem algo escrito." : "Registre a data de cada vez."}
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {MONTHS.map((mn, i) => {
          const m = i + 1; const mo = g.months?.[m] || {};
          const s = monthState(g, year, m); const col = MONTH_COLORS[s];
          const n = monthCount(g, m);
          const isCur = year === CUR_YEAR && m === CUR_MONTH;
          return (
            <div key={mn} style={{ padding: "8px 0", borderTop: i ? `1px solid ${C.line}` : "none", opacity: s === "futuro" && !n ? 0.6 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <div style={{ width: 34, fontSize: 12.5, fontWeight: isCur ? 500 : 400, color: isCur ? C.accent : C.sub, flexShrink: 0 }}>{mn}</div>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
                  {g.mode === "texto" ? (
                    <input value={mo.text || ""} onChange={(e) => setMonth(m, (c) => ({ ...c, text: e.target.value }))}
                      placeholder={mo.pause ? "pausa" : "o que foi?"}
                      style={{ ...input, width: "100%", border: "none", background: "transparent", padding: "3px 0", fontSize: 13 }} />
                  ) : (
                    <>
                      {(mo.dates || []).map((d) => (
                        <span key={d} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, padding: "3px 4px 3px 8px", borderRadius: 7, background: C.surface, border: `1px solid ${C.line}`, color: C.ink }}>
                          {ddmm(d)}
                          <button onClick={() => setMonth(m, (c) => ({ ...c, dates: (c.dates || []).filter((x) => x !== d) }))} style={{ ...ghostBtn, lineHeight: 0, padding: 2 }} title="Remover"><X size={11} color={C.faint} /></button>
                        </span>
                      ))}
                      {addFor === m ? (
                        <input type="date" autoFocus
                          min={`${year}-${String(m).padStart(2, "0")}-01`} max={`${year}-${String(m).padStart(2, "0")}-${lastDay(year, m)}`}
                          onChange={(e) => {
                            const d = e.target.value; if (!d) return;
                            setMonth(m, (c) => ({ ...c, dates: Array.from(new Set([...(c.dates || []), d])).sort() }));
                            setAddFor(null);
                          }}
                          onBlur={() => setAddFor(null)}
                          style={{ ...input, padding: "3px 6px", fontSize: 12, width: 130 }} />
                      ) : (
                        <button onClick={() => setAddFor(m)} title="Adicionar data" style={{ ...ghostBtn, display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5, color: C.faint, padding: "3px 6px", border: `1px dashed ${C.line2}`, borderRadius: 7 }}><Plus size={11} /> data</button>
                      )}
                    </>
                  )}
                </div>
                <span title={s} style={{ minWidth: 26, textAlign: "center", fontSize: 11, fontWeight: 500, padding: "2px 6px", borderRadius: 6, background: col.bg, color: col.fg, border: s === "futuro" ? `1px solid ${C.line}` : "none", flexShrink: 0 }}>
                  {s === "pausa" ? "pausa" : g.mode === "texto" ? (n ? "✓" : "") || "\u00a0" : n}
                </span>
                <button onClick={() => setMoreFor(moreFor === m ? null : m)} title="Pausa e anotação" style={iconBtn}><MoreHorizontal size={14} color={C.faint} /></button>
              </div>
              {mo.note && moreFor !== m && <div style={{ fontSize: 11.5, color: C.faint, marginLeft: 43, marginTop: 3 }}>{mo.note}</div>}
              {moreFor === m && (
                <div style={{ marginLeft: 43, marginTop: 7, display: "flex", flexDirection: "column", gap: 7 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.sub, cursor: "pointer" }}>
                    <CheckBox size={18} color={C.faint} on={!!mo.pause} onClick={() => setMonth(m, (c) => ({ ...c, pause: !c.pause }))} />
                    Pausa neste mês (não conta como abaixo da meta)
                  </label>
                  <input value={mo.note || ""} onChange={(e) => setMonth(m, (c) => ({ ...c, note: e.target.value }))} placeholder="Anotação do mês (ex: férias)" style={{ ...input, width: "100%" }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
        {[["ok", "na meta"], ["andamento", "mês atual"], ["abaixo", "abaixo"], ["pausa", "pausa"]].map(([k, l]) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: C.faint }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: MONTH_COLORS[k].bg }} /> {l}
          </span>
        ))}
      </div>
    </>
  );
}

function ListaDetail({ g, update }) {
  const items = g.items || [];
  const toggle = (id) => update((x) => ({ ...x, items: x.items.map((y) => y.id === id ? { ...y, done: !y.done, doneAt: !y.done ? TODAY : null } : y) }));
  const setDate = (id, d) => update((x) => ({ ...x, items: x.items.map((y) => y.id === id ? { ...y, doneAt: d || null } : y) }));
  const del = (id) => update((x) => ({ ...x, items: x.items.filter((y) => y.id !== id) }));
  const group = (done) => items.filter((i) => !!i.done === done);
  const Row = (it) => (
    <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 0" }}>
      <CheckBox on={!!it.done} onClick={() => toggle(it.id)} />
      <div style={{ flex: 1, fontSize: 13.5, color: C.ink, lineHeight: 1.4 }}>{it.text}</div>
      {it.done && (
        <input type="date" value={it.doneAt || ""} onChange={(e) => setDate(it.id, e.target.value)} title="Quando"
          style={{ ...input, padding: "4px 6px", fontSize: 11.5, width: 128, color: it.doneAt ? C.sub : C.faint }} />
      )}
      <button onClick={() => del(it.id)} style={iconBtn} title="Remover"><X size={13} color={C.faint} /></button>
    </div>
  );
  return (
    <>
      <Label>Quero fazer</Label>
      {group(false).length ? group(false).map(Row) : <div style={{ fontSize: 12.5, color: C.faint, padding: "2px 0 4px" }}>Nada pendente.</div>}
      <AddLine placeholder="Algo que quero fazer" onAdd={(t) => update((x) => ({ ...x, items: [...(x.items || []), { id: uid(), text: t, done: false }] }))} />
      <div style={{ marginTop: 16 }}>
        <Label>Já fiz</Label>
        {group(true).length ? group(true).map(Row) : <div style={{ fontSize: 12.5, color: C.faint }}>Marque um item acima quando acontecer.</div>}
      </div>
    </>
  );
}


function NewGoal({ onAdd, onCancel }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("simples");
  const [target, setTarget] = useState(12);
  const [min, setMin] = useState(1);
  const [max, setMax] = useState("");
  const [mode, setMode] = useState("datas");
  const ok = title.trim();
  const create = () => {
    if (!ok) return;
    const base = { id: uid(), title: title.trim(), type };
    if (type === "simples") onAdd({ ...base, status: "afazer", note: "", steps: [], log: [] });
    else if (type === "contador") onAdd({ ...base, target: Math.max(1, Number(target) || 1), items: [] });
    else if (type === "mensal") onAdd({ ...base, min: Math.max(1, Number(min) || 1), max: max ? Number(max) : null, mode, months: {} });
    else onAdd({ ...base, items: [] });
  };
  return (
    <div style={{ ...card, padding: 15, marginTop: 12 }}>
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Qual é a meta?"
        style={{ ...input, width: "100%", fontSize: 14, padding: "10px 12px", marginBottom: 13 }} />
      <Label>Como acompanhar?</Label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 13 }}>
        {Object.entries(TYPES).map(([k, t]) => {
          const on = type === k; const Ic = t.icon;
          return (
            <button key={k} onClick={() => setType(k)} style={{ textAlign: "left", padding: "9px 10px", borderRadius: 10, cursor: "pointer", border: `1px solid ${on ? C.accent : C.line}`, background: on ? "#E3EAFB" : C.surface, fontFamily: "inherit" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 500, color: on ? C.accent : C.ink }}><Ic size={13} /> {t.label}</div>
              <div style={{ fontSize: 11, color: C.faint, marginTop: 3, lineHeight: 1.35 }}>{t.hint}</div>
            </button>
          );
        })}
      </div>

      {type === "contador" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 13 }}>
          <span style={{ fontSize: 12.5, color: C.sub }}>Quantos no ano?</span>
          <input type="number" min={1} value={target} onChange={(e) => setTarget(e.target.value)} style={{ ...input, width: 70 }} />
        </div>
      )}
      {type === "mensal" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: C.sub }}>Por mês: mínimo</span>
            <input type="number" min={1} value={min} onChange={(e) => setMin(e.target.value)} style={{ ...input, width: 56 }} />
            <span style={{ fontSize: 12.5, color: C.sub }}>máximo (opcional)</span>
            <input type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} style={{ ...input, width: 56 }} />
          </div>
          <Label>Registrar como</Label>
          <div style={{ display: "flex", gap: 6, marginBottom: 13 }}>
            {[["datas", "Datas (ex: sessões)"], ["texto", "Texto (ex: qual receita)"]].map(([k, l]) => {
              const on = mode === k;
              return <button key={k} onClick={() => setMode(k)} style={{ flex: 1, padding: "7px 0", borderRadius: 9, fontSize: 12, cursor: "pointer", border: `1px solid ${on ? C.accent : C.line}`, background: on ? "#E3EAFB" : C.surface, color: on ? C.accent : C.sub, fontWeight: on ? 500 : 400 }}>{l}</button>;
            })}
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={create} style={{ flex: 1, padding: "10px 0", borderRadius: 9, border: "none", background: C.ink, color: "#fff", fontSize: 13, fontWeight: 500, cursor: ok ? "pointer" : "default", opacity: ok ? 1 : 0.4 }}>Criar meta</button>
        <button onClick={onCancel} style={{ padding: "10px 16px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.surface, color: C.sub, fontSize: 13, cursor: "pointer" }}>Cancelar</button>
      </div>
    </div>
  );
}
