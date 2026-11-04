import React, { useState } from "react";
import {
  Target, Plus, X, Check, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Pencil, Trash2, BookOpen, CalendarDays, ListChecks, MoreHorizontal, ArrowUp, ArrowDown
} from "lucide-react";

/* =========================================================
   Aba "Metas" (metas pessoais da Rafaela).
   Organizado por ano: metas[ano] = { intro, goals: [...] }.
   Cada meta tem um tipo:
     simples   feito / em andamento / a fazer, com nota e etapas
     contador  "X no ano" com itens (ex: livros, com data de conclusão)
     mensal    meta por mês (ex: 2 a 3 sessões, 1 receita), registrando datas ou texto
     lista     itens feitos e itens que ainda quero fazer
   Estado persiste no Supabase via props (campo metas).
   ========================================================= */

const C = {
  bg: "#F3F5F9", surface: "#FFFFFF", line: "#E2E7F0", line2: "#D3DAE6",
  ink: "#18233F", sub: "#5A6580", faint: "#8E97AD", accent: "#2348A6",
};
const GREEN = { color: "#0E7C61", soft: "#E7F2EC" };
const AMBER = { color: "#B06A2C", soft: "#FAF0E4" };
const PINK = { color: "#C04574", soft: "#FBEAF1" };

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const TYPES = {
  simples: { label: "Meta simples", hint: "Feito ou não, com etapas se quiser", icon: Target },
  contador: { label: "Quantidade no ano", hint: "Ex: ler 12 livros", icon: BookOpen },
  mensal: { label: "Todo mês", hint: "Ex: 2 a 3 sessões por mês, 1 receita nova por mês", icon: CalendarDays },
  lista: { label: "Feito e quero fazer", hint: "Ex: aproveitar mais a vida", icon: ListChecks },
};
const STATUS = {
  afazer: { label: "a fazer", soft: "#EBEFF6", color: C.faint },
  andamento: { label: "em andamento", ...AMBER },
  feito: { label: "feito", ...GREEN },
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const TODAY = iso(new Date());
const CUR_YEAR = new Date().getFullYear();
const CUR_MONTH = new Date().getMonth() + 1; // 1..12
const ddmm = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : "");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const lastDay = (y, m) => new Date(y, m, 0).getDate();

const card = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14 };
const input = { boxSizing: "border-box", padding: "8px 10px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13, color: C.ink, background: C.surface, outline: "none", fontFamily: "inherit" };
const ghostBtn = { background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, color: C.sub, fontFamily: "inherit" };
const iconBtn = { width: 28, height: 28, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };

const Tag = ({ soft, color, children }) => <span style={{ background: soft, color, fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 7, whiteSpace: "nowrap" }}>{children}</span>;
const Label = ({ children }) => <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 7 }}>{children}</div>;

function CheckBox({ on, color = GREEN.color, onClick, size = 20 }) {
  return (
    <button onClick={onClick} style={{ width: size, height: size, borderRadius: 6, flexShrink: 0, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${on ? color : "#C9D1DF"}`, background: on ? color : "transparent" }}>
      {on && <Check size={12} color="#fff" />}
    </button>
  );
}

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

function progressOf(g, year) {
  if (g.type === "simples") {
    const st = g.status || "afazer";
    const steps = g.steps || [];
    const sd = steps.filter((s) => s.done).length;
    return { state: st, label: steps.length ? `${sd} de ${steps.length} etapas` : null };
  }
  if (g.type === "contador") {
    const n = (g.items || []).filter((i) => i.doneAt).length;
    const target = g.target || 1;
    return { state: n >= target ? "feito" : n > 0 ? "andamento" : "afazer", label: `${n} de ${target}`, pct: Math.min(100, Math.round((n / target) * 100)) };
  }
  if (g.type === "mensal") {
    let ok = 0, eligible = 0, any = false;
    for (let m = 1; m <= 12; m++) {
      const s = monthState(g, year, m);
      if (monthCount(g, m) > 0) any = true;
      const notFuture = year < CUR_YEAR || (year === CUR_YEAR && m <= CUR_MONTH);
      if (s === "ok" && notFuture) { ok++; eligible++; }
      else if (s === "abaixo") eligible++;
    }
    return { state: any ? "andamento" : "afazer", label: eligible ? `${ok} de ${eligible} meses na meta` : "começa este mês" };
  }
  // lista
  const items = g.items || [];
  const d = items.filter((i) => i.done).length;
  return { state: d > 0 ? "andamento" : "afazer", label: `${d} feitos, ${items.length - d} na lista` };
}

// Copia a estrutura das metas para um ano novo, zerando o progresso
function blankCopy(g) {
  const base = { id: uid(), title: g.title, type: g.type };
  if (g.type === "simples") return { ...base, status: "afazer", note: "", steps: [] };
  if (g.type === "contador") return { ...base, target: g.target || 12, items: [] };
  if (g.type === "mensal") return { ...base, min: g.min || 1, max: g.max || null, mode: g.mode || "datas", months: {} };
  return { ...base, items: [] };
}

export default function Metas({ metas = {}, setMetas, owner = { name: "Rafaela", color: C.accent } }) {
  const [year, setYear] = useState(CUR_YEAR);
  const [openId, setOpenId] = useState(null);
  const [editIntro, setEditIntro] = useState(false);
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState("metas"); // "metas" | "ano"


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
  const addGoal = (g) => { updateYear((y) => ({ ...y, goals: [...y.goals, g] })); setAdding(false); setOpenId(g.id); };

  const counts = { feito: 0, andamento: 0, afazer: 0 };
  goals.forEach((g) => { counts[progressOf(g, year).state]++; });

  return (
    <div style={{ animation: "fade .25s ease" }}>
      {/* Ano */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <button className="rot-btn" onClick={() => { setYear(year - 1); setOpenId(null); }} style={{ ...iconBtn, width: 34, height: 34, border: `1px solid ${C.line}`, background: C.surface }}><ChevronLeft size={18} /></button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.3, fontFamily: "var(--font-display)" }}>Metas de {year}</div>
          <div style={{ fontSize: 12, color: owner.color }}>{owner.name}</div>
        </div>
        <button className="rot-btn" onClick={() => { setYear(year + 1); setOpenId(null); }} style={{ ...iconBtn, width: 34, height: 34, border: `1px solid ${C.line}`, background: C.surface }}><ChevronRight size={18} /></button>
      </div>

      {/* Ano vazio */}
      {!yd && !adding && (
        <div style={{ ...card, padding: "22px 18px", textAlign: "center" }}>
          <div style={{ fontSize: 13.5, color: C.sub, marginBottom: 14 }}>Nenhuma meta em {year} ainda.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 320, margin: "0 auto" }}>
            {prev?.goals?.length > 0 && (
              <button onClick={() => setMetas((m) => ({ ...m, [year]: { intro: "", goals: prev.goals.map(blankCopy) } }))}
                style={{ padding: "10px 0", borderRadius: 10, border: "none", background: C.ink, color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
                Começar com as mesmas metas de {year - 1}
              </button>
            )}
            <button onClick={() => { setMetas((m) => ({ ...m, [year]: { intro: "", goals: [] } })); setAdding(true); }}
              style={{ padding: "10px 0", borderRadius: 10, border: `1px solid ${C.line}`, background: C.surface, color: C.sub, fontSize: 13, cursor: "pointer" }}>
              Começar do zero
            </button>
          </div>
        </div>
      )}

      {yd && (
        <>
          {/* Texto de abertura do ano */}
          <div style={{ ...card, padding: "13px 15px", marginBottom: 14, background: "#EEF3FF", borderColor: "#D9E3FA" }}>
            {editIntro ? (
              <>
                <textarea autoFocus value={yd.intro || ""} onChange={(e) => updateYear((y) => ({ ...y, intro: e.target.value }))}
                  placeholder="Um recado para você mesma sobre este ano"
                  style={{ ...input, width: "100%", minHeight: 110, resize: "vertical", lineHeight: 1.55, fontSize: 13.5 }} />
                <button onClick={() => setEditIntro(false)} style={{ ...ghostBtn, color: C.accent, marginTop: 8 }}>Pronto</button>
              </>
            ) : (
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ flex: 1, fontSize: 13.5, lineHeight: 1.6, color: yd.intro ? "#1E3570" : C.faint, whiteSpace: "pre-wrap" }}>
                  {yd.intro || "Escreva um recado para você mesma sobre este ano."}
                </div>
                <button onClick={() => setEditIntro(true)} title="Editar" style={iconBtn}><Pencil size={14} color={C.faint} /></button>
              </div>
            )}
          </div>

          {goals.length > 0 && (
            <div style={{ display: "flex", gap: 3, marginBottom: 14, background: "#EBEFF6", padding: 3, borderRadius: 10 }}>
              {[["metas", "Metas"], ["ano", "Ano mês a mês"]].map(([k, l]) => {
                const on = view === k;
                return <button key={k} onClick={() => setView(k)} style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12.5, fontFamily: "inherit", background: on ? C.surface : "transparent", color: on ? C.ink : C.sub, fontWeight: on ? 500 : 400, boxShadow: on ? "0 1px 3px rgba(0,0,0,0.07)" : "none" }}>{l}</button>;
              })}
            </div>
          )}

          {view === "ano" && goals.length > 0 && <YearView goals={goals} year={year} counts={counts} openGoal={(id) => { setView("metas"); setOpenId(id); }} />}

          {view === "metas" && <>
          {/* Resumo */}
          {goals.length > 0 && (
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {[["feito", "Concluídas"], ["andamento", "Em andamento"], ["afazer", "A fazer"]].map(([k, lbl]) => (
                <div key={k} style={{ flex: 1, background: "#EBEFF6", borderRadius: 11, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11.5, color: C.sub, marginBottom: 2 }}>{lbl}</div>
                  <div style={{ fontSize: 20, fontWeight: 500, color: k === "feito" ? GREEN.color : C.ink }}>{counts[k]}</div>
                </div>
              ))}
            </div>
          )}

          {/* Metas */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {goals.map((g, idx) => (
              <GoalCard key={g.id} g={g} year={year} open={openId === g.id}
                onToggle={() => setOpenId(openId === g.id ? null : g.id)}
                update={(fn) => updateGoal(g.id, fn)}
                remove={() => removeGoal(g.id)}
                moveUp={idx > 0 ? () => moveGoal(g.id, -1) : null}
                moveDown={idx < goals.length - 1 ? () => moveGoal(g.id, 1) : null} />
            ))}
          </div>

          {adding ? <NewGoal onAdd={addGoal} onCancel={() => setAdding(false)} /> : (
            <button className="rot-btn" onClick={() => setAdding(true)}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", padding: "11px 14px", borderRadius: 12, border: `1px dashed ${C.line2}`, background: C.surface, cursor: "pointer", fontSize: 13, color: C.sub, marginTop: 12 }}>
              <Plus size={15} /> Nova meta
            </button>
          )}
          </>}
        </>
      )}
      {!yd && adding && <NewGoal onAdd={addGoal} onCancel={() => setAdding(false)} />}
    </div>
  );
}

// ---------- visão anual: todas as metas, mês a mês ----------
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
    n = (g.steps || []).filter((st) => st.done && monthOf(st.doneAt, year) === m).length;
  }
  return n ? { text: String(n), bg: "#E3EAFB", fg: C.accent } : { text: "", bg: "transparent", fg: C.faint };
}
function yearTotal(g, year) {
  const pr = progressOf(g, year);
  if (g.type === "contador") return { text: pr.label, color: pr.state === "feito" ? GREEN.color : C.ink };
  if (g.type === "mensal") {
    const m = pr.label.match(/^(\d+) de (\d+)/);
    return { text: m ? `${m[1]}/${m[2]}` : "", color: m && m[1] === m[2] ? GREEN.color : C.ink };
  }
  if (g.type === "lista") return { text: String((g.items || []).filter((i) => i.done).length), color: C.ink };
  return { text: STATUS[g.status || "afazer"].label, color: STATUS[g.status || "afazer"].color };
}

function YearView({ goals, year, counts, openGoal }) {
  // quanto do ano já passou
  const start = new Date(year, 0, 1), end = new Date(year + 1, 0, 1), now = new Date();
  const yearPct = now < start ? 0 : now >= end ? 100 : Math.round(((now - start) / (end - start)) * 100);
  const goalsPct = goals.length ? Math.round((counts.feito / goals.length) * 100) : 0;
  const isCur = (m) => year === CUR_YEAR && m === CUR_MONTH;

  return (
    <div>
      <div style={{ ...card, padding: "13px 15px", marginBottom: 14 }}>
        {[["Ano que já passou", yearPct, C.faint], ["Metas concluídas", goalsPct, GREEN.color]].map(([l, v, col]) => (
          <div key={l} style={{ marginBottom: l === "Ano que já passou" ? 11 : 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 5 }}>
              <span style={{ color: C.sub }}>{l}</span>
              <span style={{ fontWeight: 500 }}>{l === "Metas concluídas" ? `${counts.feito} de ${goals.length}` : `${v}%`}</span>
            </div>
            <div style={{ height: 6, background: "#E2E7F0", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${v}%`, background: col, borderRadius: 99 }} />
            </div>
          </div>
        ))}
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 9 }}>{counts.andamento} em andamento, {counts.afazer} a fazer.</div>
      </div>

      <div style={{ ...card, padding: "12px 14px" }}>
        {/* cabeçalho dos meses, alinhado com as faixas */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 3, marginBottom: 8 }}>
          {MONTHS.map((mn, i) => (
            <div key={mn} style={{ textAlign: "center", fontSize: 10.5, fontWeight: isCur(i + 1) ? 600 : 400, color: isCur(i + 1) ? C.accent : C.faint }}>{mn.slice(0, 1)}</div>
          ))}
        </div>
        {goals.map((g, gi) => {
          const tot = yearTotal(g, year);
          return (
            <div key={g.id} style={{ padding: "8px 0", borderTop: gi ? `1px solid ${C.line}` : "none" }}>
              <div onClick={() => openGoal(g.id)} style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, cursor: "pointer" }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.3 }}>{g.title}</div>
                <div style={{ fontSize: 11.5, fontWeight: 500, color: tot.color, whiteSpace: "nowrap" }}>{tot.text}</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 3 }}>
                {MONTHS.map((mn, i) => {
                  const c = yearCell(g, year, i + 1);
                  return (
                    <div key={mn} title={mn} style={{ height: 20, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 500, background: c.bg === "transparent" ? "#EEF2F8" : c.bg, color: c.fg, outline: isCur(i + 1) ? `1px solid ${C.accent}` : "none", outlineOffset: -1 }}>
                      {c.text}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11.5, color: C.faint, lineHeight: 1.55, marginTop: 10 }}>
        Metas mensais mostram quantas vezes no mês (verde quando bate a meta, rosa quando ficou abaixo, p é pausa). Livros e a lista mostram quantos foram concluídos no mês. Metas simples ganham ✓ no mês em que foram concluídas. Toque no nome para abrir a meta.
      </div>
    </div>
  );
}

function GoalCard({ g, year, open, onToggle, update, remove, moveUp, moveDown }) {
  const T = TYPES[g.type] || TYPES.simples; const Ic = T.icon;
  const pr = progressOf(g, year);
  const st = STATUS[pr.state];
  const [renaming, setRenaming] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  return (
    <div style={{ ...card, overflow: "hidden", borderColor: open ? C.line2 : C.line }}>
      <div onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", cursor: "pointer" }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: st.soft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {pr.state === "feito" ? <Check size={15} color={st.color} /> : <Ic size={15} color={pr.state === "afazer" ? C.faint : st.color} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, lineHeight: 1.35 }}>{g.title}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4, flexWrap: "wrap" }}>
            {g.type === "simples" && <Tag soft={st.soft} color={st.color}>{st.label}</Tag>}
            {pr.label && <span style={{ fontSize: 11.5, color: C.faint }}>{pr.label}</span>}
          </div>
          {g.type === "contador" && (
            <div style={{ height: 4, background: "#E2E7F0", borderRadius: 99, overflow: "hidden", marginTop: 7 }}>
              <div style={{ height: "100%", width: `${pr.pct}%`, background: pr.state === "feito" ? GREEN.color : C.accent, borderRadius: 99 }} />
            </div>
          )}
          {g.type === "mensal" && (
            <div style={{ display: "flex", gap: 3, marginTop: 7 }}>
              {MONTHS.map((mn, i) => {
                const s = monthState(g, year, i + 1); const col = MONTH_COLORS[s];
                return <div key={mn} title={`${mn}: ${monthCount(g, i + 1)}`} style={{ flex: 1, height: 6, borderRadius: 3, background: col.bg, border: s === "futuro" ? `1px solid ${C.line}` : "none" }} />;
              })}
            </div>
          )}
        </div>
        {open ? <ChevronUp size={16} color={C.faint} /> : <ChevronDown size={16} color={C.faint} />}
      </div>

      {open && (
        <div style={{ borderTop: `1px solid ${C.line}`, background: "#F7F9FC", padding: "14px 14px 12px" }}>
          {g.type === "simples" && <SimplesDetail g={g} update={update} />}
          {g.type === "contador" && <ContadorDetail g={g} update={update} />}
          {g.type === "mensal" && <MensalDetail g={g} year={year} update={update} />}
          {g.type === "lista" && <ListaDetail g={g} update={update} />}

          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14, paddingTop: 11, borderTop: `1px solid ${C.line}`, flexWrap: "wrap" }}>
            {renaming ? (
              <div style={{ display: "flex", gap: 6, flex: 1, minWidth: 200 }}>
                <input autoFocus value={g.title} onChange={(e) => update((x) => ({ ...x, title: e.target.value }))} style={{ ...input, flex: 1, minWidth: 0 }} />
                <button onClick={() => setRenaming(false)} style={{ ...ghostBtn, color: C.accent }}>Pronto</button>
              </div>
            ) : (
              <button onClick={() => setRenaming(true)} style={{ ...ghostBtn, display: "flex", alignItems: "center", gap: 5 }}><Pencil size={12} /> Renomear</button>
            )}
            {moveUp && <button onClick={moveUp} title="Subir" style={{ ...ghostBtn, display: "flex", alignItems: "center" }}><ArrowUp size={14} /></button>}
            {moveDown && <button onClick={moveDown} title="Descer" style={{ ...ghostBtn, display: "flex", alignItems: "center" }}><ArrowDown size={14} /></button>}
            <div style={{ marginLeft: "auto" }}>
              {confirmDel ? (
                <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: C.sub }}>Apagar esta meta?</span>
                  <button onClick={remove} style={{ ...ghostBtn, color: PINK.color, fontWeight: 500 }}>Apagar</button>
                  <button onClick={() => setConfirmDel(false)} style={ghostBtn}>Cancelar</button>
                </span>
              ) : (
                <button onClick={() => setConfirmDel(true)} style={{ ...ghostBtn, display: "flex", alignItems: "center", gap: 5, color: C.faint }}><Trash2 size={12} /> Apagar</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
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

function SimplesDetail({ g, update }) {
  const steps = g.steps || [];
  return (
    <>
      <Label>Status</Label>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {Object.entries(STATUS).map(([k, s]) => {
          const on = (g.status || "afazer") === k;
          return <button key={k} onClick={() => update((x) => ({ ...x, status: k, doneAt: k === "feito" ? (x.doneAt || TODAY) : null }))} style={{ flex: 1, padding: "7px 0", borderRadius: 9, fontSize: 12, cursor: "pointer", border: `1px solid ${on ? s.color : C.line}`, background: on ? s.soft : C.surface, color: on ? s.color : C.sub, fontWeight: on ? 500 : 400 }}>{s.label}</button>;
        })}
      </div>

      {g.status === "feito" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "-4px 0 14px" }}>
          <span style={{ fontSize: 12.5, color: C.sub }}>Concluída em</span>
          <input type="date" value={g.doneAt || ""} onChange={(e) => update((x) => ({ ...x, doneAt: e.target.value || null }))} style={{ ...input, padding: "5px 8px", fontSize: 12.5 }} />
          {!g.doneAt && <span style={{ fontSize: 11.5, color: C.faint }}>sem data, não aparece no mês a mês</span>}
        </div>
      )}

      <Label>Etapas</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {steps.map((s) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <CheckBox on={s.done} onClick={() => update((x) => ({ ...x, steps: x.steps.map((y) => y.id === s.id ? { ...y, done: !y.done, doneAt: !y.done ? TODAY : null } : y) }))} />
            <div style={{ flex: 1, fontSize: 13.5, color: s.done ? C.faint : C.ink, textDecoration: s.done ? "line-through" : "none" }}>{s.text}</div>
            <button onClick={() => update((x) => ({ ...x, steps: x.steps.filter((y) => y.id !== s.id) }))} style={iconBtn} title="Remover"><X size={13} color={C.faint} /></button>
          </div>
        ))}
      </div>
      <AddLine placeholder="Adicionar etapa" onAdd={(t) => update((x) => ({ ...x, steps: [...(x.steps || []), { id: uid(), text: t, done: false }] }))} />

      <div style={{ marginTop: 14 }}>
        <Label>Anotações</Label>
        <textarea value={g.note || ""} onChange={(e) => update((x) => ({ ...x, note: e.target.value }))} placeholder="Como está indo, próximos passos"
          style={{ ...input, width: "100%", minHeight: 64, resize: "vertical", lineHeight: 1.5 }} />
      </div>
    </>
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
    if (type === "simples") onAdd({ ...base, status: "afazer", note: "", steps: [] });
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
