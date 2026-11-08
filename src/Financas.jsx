import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Wallet, CreditCard, PiggyBank, Plus, X, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Check, Trash2, Pencil, Users, LogOut, Layers, TrendingUp, Copy, Send, FileUp, AlertTriangle
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { pagesFromPdf } from "./faturas/pdfText";
import { parseFatura } from "./faturas/parsers";
import { planImport, applyPlan, guessCard, guessSubs } from "./faturas/importar";

/* =========================================================
   Módulo Finanças.
   Fica numa tabela própria ("finances"), protegida por login,
   porque aqui tem salário, contas e cobranças de terceiros.
   Tudo é calculado por mês de competência (o mês em que a
   fatura ou a conta é paga). Compras parceladas se replicam
   sozinhas nos meses seguintes.
   ========================================================= */

const C = {
  bg: "#F3F5F9", surface: "#FFFFFF", line: "#E2E7F0", line2: "#D3DAE6",
  ink: "#18233F", sub: "#5A6580", faint: "#8E97AD", accent: "#2348A6",
  good: "#0E7C61", goodSoft: "#E7F2EC", bad: "#C04574", badSoft: "#FBEAF1", sunSoft: "#FDF1D8", sun: "#B9821C",
};
const CAT_COLORS = ["#2348A6", "#C7416E", "#1F8C83", "#C27412", "#7A4DB0", "#2E7D54", "#185FA5", "#B06A2C", "#8A5A22", "#5A6580", "#A63D40", "#3E7CB1"];

const DEFAULT_CATEGORIES = [
  ["moradia", "Moradia"], ["contas", "Contas da casa"], ["mercado", "Mercado"], ["delivery", "Delivery"],
  ["restaurantes", "Restaurantes"], ["carro", "Carro"], ["transporte", "Transporte"], ["saude", "Saúde"],
  ["estudo", "Estudo e hobby"], ["eletros", "Casa e eletros"], ["lazer", "Lazer e viagens"], ["compras", "Compras pessoais"],
  ["impostos", "Impostos e taxas"], ["familia", "Família"], ["pets", "Pets"], ["outros", "Outros"],
].map(([id, name], i) => ({ id, name, color: CAT_COLORS[i % CAT_COLORS.length] }));

const EMPTY_DATA = {
  v: 1, categories: DEFAULT_CATEGORIES, cards: [], recurring: [], installments: [], txs: [], months: {},
  savings: { balance: null, updatedAt: null, history: [] },
};
function normalize(d) {
  const x = { ...EMPTY_DATA, ...(d || {}) };
  if (!x.categories || !x.categories.length) x.categories = DEFAULT_CATEGORIES;
  x.savings = { ...EMPTY_DATA.savings, ...(x.savings || {}) };
  return x;
}

// ---------- utilidades ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = (n) => String(n).padStart(2, "0");
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ymNow = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const ymAdd = (ym, n) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const ymDiff = (a, b) => { const [ay, am] = a.split("-").map(Number); const [by, bm] = b.split("-").map(Number); return (by - ay) * 12 + (bm - am); };
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MES_LONGO = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const ymLabel = (ym) => { const [y, m] = ym.split("-").map(Number); return `${MES[m - 1]}/${y}`; };
const ymLong = (ym) => { const [y, m] = ym.split("-").map(Number); return `${MES_LONGO[m - 1]} de ${y}`; };
const ddmm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const brl = (v) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
// Aceita "1.234,56", "1234,56", "1234.56" e "R$ 50"
function parseMoney(s) {
  if (typeof s === "number") return s;
  let t = String(s || "").replace(/[^\d,.-]/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
const toInput = (v) => (v == null ? "" : String(v).replace(".", ","));
const sum = (arr, f = (x) => x.amount) => arr.reduce((n, x) => n + (Number(f(x)) || 0), 0);

// ---------- regras de cálculo ----------
// Valor de uma linha fixa num mês: ajuste daquele mês > versão vigente. null = não existe naquele mês.
function recAmount(rec, ym, mo) {
  const vs = [...(rec.versions || [])].sort((a, b) => a.from.localeCompare(b.from));
  if (!vs.length || ym < vs[0].from) return null;
  if (rec.until && ym > rec.until) return null;
  if (mo?.values?.[rec.id] != null) return mo.values[rec.id];
  let a = vs[0].amount;
  for (const v of vs) if (v.from <= ym) a = v.amount;
  return a;
}
// Ocorrência de uma compra no cartão numa fatura (parcelas se replicam)
function txOcc(t, ym) {
  const i = ymDiff(t.month, ym);
  const k = t.parcel || 1, n = t.parcels || 1;
  if (t.anticipated) return i === 0 ? { ...t, curParcel: k, replicated: false } : null; // parcelas adiantadas não se repetem
  if (i < 0 || k + i > n) return null;
  return { ...t, curParcel: k + i, replicated: i > 0 };
}
const txEnd = (t) => (t.anticipated ? t.month : ymAdd(t.month, (t.parcels || 1) - (t.parcel || 1)));
function instOcc(it, ym) {
  const i = ymDiff(it.first, ym);
  if (i < 0 || i >= it.total) return null;
  return i + 1;
}
const subOf = (card, subId) => (card?.subs || []).find((s) => s.id === subId) || null;

// Tudo que é de terceiros num mês: lançamentos de cartões adicionais de outra pessoa,
// cartões emprestados e divisões/recebimentos lançados à mão.
function cobrancasOf(data, ym) {
  const mo = data.months[ym] || {};
  const items = [];
  data.cards.forEach((c) => {
    if (c.mode === "so_fatura") {
      const v = mo.invoices?.[c.id];
      if (c.usedBy && v > 0) items.push({ key: `card:${c.id}`, who: c.usedBy, desc: `Fatura ${c.name}`, amount: v, origin: c.name });
      return;
    }
    data.txs.forEach((t) => {
      if (t.cardId !== c.id) return;
      const o = txOcc(t, ym); if (!o) return;
      const s = subOf(c, t.sub);
      if (s?.who) items.push({ key: `tx:${t.id}`, who: s.who, desc: t.desc, date: t.date, amount: t.amount, origin: `${c.name}${s.label ? ` (${s.label})` : ""}`, parcel: (t.parcels || 1) > 1 ? `${o.curParcel}/${t.parcels}` : null });
    });
  });
  (mo.receivables || []).forEach((r) => {
    const t = r.txId ? data.txs.find((x) => x.id === r.txId) : null;
    items.push({ key: `rcv:${r.id}`, rcvId: r.id, who: r.who || "Sem nome", desc: r.desc, amount: r.amount, txId: r.txId, origin: t ? "divisão de compra" : "lançado à mão" });
  });
  return items.map((it) => ({ ...it, received: !!mo.received?.[it.key] }));
}

function computeMonth(data, ym) {
  const mo = data.months[ym] || {};
  const entradas = [], despesas = [], poupanca = [], cards = [];
  data.recurring.forEach((r) => {
    const a = recAmount(r, ym, mo); if (a == null) return;
    const line = { id: r.id, src: "rec", rec: r, name: r.name, cat: r.cat, amount: a, tag: mo.values?.[r.id] != null ? "fixa, ajustada neste mês" : "fixa", paid: !!mo.paid?.[r.id] };
    (r.kind === "entrada" ? entradas : r.kind === "poupanca" ? poupanca : despesas).push(line);
  });
  (mo.extras || []).forEach((e) => {
    const line = { id: e.id, src: "extra", extra: e, name: e.name, cat: e.cat, amount: e.amount, tag: "só este mês", paid: !!mo.paid?.[e.id] };
    (e.kind === "entrada" ? entradas : e.kind === "poupanca" ? poupanca : despesas).push(line);
  });
  data.installments.forEach((it) => {
    const k = instOcc(it, ym); if (!k) return;
    despesas.push({ id: it.id, src: "inst", inst: it, name: it.name, cat: it.cat, amount: it.amount, tag: `parcela ${k}/${it.total}`, paid: !!mo.paid?.[it.id] });
  });
  data.cards.forEach((c) => {
    let total = 0, occs = [], filled = true;
    if (c.mode === "so_fatura") { const v = mo.invoices?.[c.id]; filled = v != null; total = v || 0; }
    else { occs = data.txs.filter((t) => t.cardId === c.id).map((t) => txOcc(t, ym)).filter(Boolean); total = sum(occs); }
    if (c.archived && !total) return;
    cards.push({ card: c, total, occs, filled, paid: !!mo.paid?.[`card:${c.id}`] });
  });
  const cob = cobrancasOf(data, ym);
  const tEntradas = sum(entradas), tCob = sum(cob), tDesp = sum(despesas), tCards = sum(cards, (x) => x.total), tPoup = sum(poupanca);
  return {
    entradas, despesas, poupanca, cards, cob,
    totals: { entradas: tEntradas + tCob, salariosEtc: tEntradas, cobrancas: tCob, despesas: tDesp, cartoes: tCards, guardar: tPoup, saidas: tDesp + tCards, sobra: tEntradas + tCob - tDesp - tCards - tPoup },
  };
}

// Quanto foi gasto em cada categoria no mês (só o que é do casal: tira a parte de terceiros)
function spendByCat(data, ym) {
  const m = computeMonth(data, ym);
  const mo = data.months[ym] || {};
  const out = {}; const lines = {};
  const add = (cat, amount, label) => {
    const k = cat || "_sem";
    out[k] = (out[k] || 0) + amount;
    (lines[k] = lines[k] || []).push({ label, amount });
  };
  m.despesas.forEach((d) => add(d.cat, d.amount, d.name));
  m.cards.forEach(({ card, total, occs }) => {
    if (card.mode === "so_fatura") { if (!card.usedBy && total) add(card.cat, total, `Fatura ${card.name}`); return; }
    occs.forEach((t) => {
      if (subOf(card, t.sub)?.who) return;
      const split = sum((mo.receivables || []).filter((r) => r.txId === t.id));
      const own = t.amount - split;
      if (own) add(t.cat, own, t.desc);
    });
  });
  return { byCat: out, lines };
}

// ---------- dados (Supabase) ----------
function useFinances(code, enabled) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const saveTimer = useRef(null);
  const skip = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    (async () => {
      const { data: row, error: e } = await supabase.from("finances").select("data").eq("code", code).maybeSingle();
      if (!active) return;
      if (e) { setError(e.message); return; }
      if (!row) {
        const { error: ie } = await supabase.from("finances").insert({ code, data: EMPTY_DATA });
        if (ie) { setError(ie.message); return; }
        setData(normalize(EMPTY_DATA));
      } else setData(normalize(row.data));
    })();
    const ch = supabase.channel(`finances:${code}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "finances", filter: `code=eq.${code}` }, (p) => {
        if (skip.current) { skip.current = false; return; }
        setData(normalize(p.new.data));
      }).subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, [code, enabled]);
  const persist = (next) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      skip.current = true;
      const { error: e } = await supabase.from("finances").update({ data: next }).eq("code", code);
      if (e) setError(e.message);
    }, 500);
  };
  const update = (fn) => setData((prev) => { const next = fn(prev); persist(next); return next; });
  return { data, update, error };
}

// ---------- estilos ----------
const card = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14 };
const btn = { border: `1px solid ${C.line}`, background: C.surface, color: C.sub, fontSize: 12.5, fontWeight: 500, padding: "7px 12px", borderRadius: 9, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "inherit" };
const dark = { ...btn, border: "none", background: C.ink, color: "#F3F5F9" };
const input = { border: `1px solid ${C.line}`, background: "#F7F9FC", borderRadius: 9, padding: "9px 11px", fontSize: 13.5, fontFamily: "inherit", color: C.ink, width: "100%", outline: "none", boxSizing: "border-box" };
const iconbtn = { border: "none", background: "transparent", cursor: "pointer", color: C.faint, padding: 4, borderRadius: 8, display: "grid", placeItems: "center" };
const Dot = ({ color, s = 8 }) => <span style={{ width: s, height: s, borderRadius: "50%", background: color, flexShrink: 0, display: "inline-block" }} />;
const Pill = ({ children, color = C.sub, soft = "#EBEFF6" }) => <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 6, background: soft, color, whiteSpace: "nowrap" }}>{children}</span>;
const Title = ({ icon: Ic, color = C.ink, children, right }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "24px 2px 10px" }}>
    {Ic && <Ic size={16} color={color} />}
    <span className="lar-display" style={{ fontSize: 15.5, fontWeight: 600, color: C.ink }}>{children}</span>
    {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
  </div>
);
const Field = ({ label, children, style }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 0, ...style }}>
    <span style={{ fontSize: 11.5, color: C.faint }}>{label}</span>{children}
  </label>
);
function Seg({ value, onChange, options }) {
  return (
    <div style={{ display: "flex", gap: 3, background: "#EBEFF6", padding: 3, borderRadius: 10 }}>
      {options.map(([k, l]) => {
        const on = value === k;
        return <button key={k} type="button" onClick={() => onChange(k)} style={{ flex: 1, padding: "7px 6px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: on ? 600 : 400, background: on ? C.surface : "transparent", color: on ? C.ink : C.sub, boxShadow: on ? "0 1px 3px rgba(0,0,0,.07)" : "none" }}>{l}</button>;
      })}
    </div>
  );
}
function CatSelect({ cats, value, onChange, allowEmpty = true, style }) {
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)} style={{ ...input, padding: "8px 9px", ...style }}>
      {allowEmpty && <option value="">Sem categoria</option>}
      {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}
function MonthNav({ ym, setYm }) {
  const now = ymNow();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
      <button onClick={() => setYm(ymAdd(ym, -1))} style={{ ...btn, padding: 8 }} aria-label="Mês anterior"><ChevronLeft size={18} /></button>
      <div style={{ textAlign: "center" }}>
        <div className="lar-display" style={{ fontSize: 18, fontWeight: 600 }}>{ymLong(ym).replace(/^./, (c) => c.toUpperCase())}</div>
        {ym !== now ? <button onClick={() => setYm(now)} style={{ ...iconbtn, display: "inline", fontSize: 12, color: C.accent, fontFamily: "inherit" }}>voltar para o mês atual</button> : <div style={{ fontSize: 12, color: C.faint }}>mês atual</div>}
      </div>
      <button onClick={() => setYm(ymAdd(ym, 1))} style={{ ...btn, padding: 8 }} aria-label="Próximo mês"><ChevronRight size={18} /></button>
    </div>
  );
}

// ================= componente principal =================
// O login agora é do app inteiro (Login.jsx). Aqui só chega quem já entrou.
export default function Financas({ code, view, onGo, email }) {
  return <FinancasApp code={code} view={view} onGo={onGo} email={email} />;
}

function FinancasApp({ code, view, onGo, email }) {
  const { data, update, error } = useFinances(code, true);
  const [ym, setYm] = useState(ymNow());
  const [flash, setFlash] = useState(null);
  const say = (t) => { setFlash(t); setTimeout(() => setFlash(null), 2200); };
  if (error) return <div style={{ ...card, padding: 18, background: C.badSoft, borderColor: "#F2D2DF", fontSize: 13, color: "#8A2E4E", lineHeight: 1.5 }}>Não consegui abrir as finanças: {error}. Confira se o SQL da tabela finances foi rodado no Supabase.</div>;
  if (!data) return <div style={{ textAlign: "center", color: C.faint, fontSize: 13, padding: 40 }}>Carregando as finanças…</div>;

  // helpers de edição do mês
  const patchMonth = (m, fn) => update((d) => ({ ...d, months: { ...d.months, [m]: fn({ values: {}, paid: {}, extras: [], invoices: {}, receivables: [], received: {}, ...(d.months[m] || {}) }) } }));
  const cats = data.categories;
  const catOf = (id) => cats.find((c) => c.id === id) || { name: "Sem categoria", color: C.faint };
  const people = Array.from(new Set([
    ...data.cards.flatMap((c) => [c.usedBy, ...(c.subs || []).map((s) => s.who)]),
    ...Object.values(data.months).flatMap((m) => (m.receivables || []).map((r) => r.who)),
  ].filter(Boolean)));
  const ctx = { data, update, ym, setYm, patchMonth, cats, catOf, say, people, onGo, email };

  return (
    <div style={{ animation: "fade .25s ease" }}>
      {flash && <div role="status" style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: "calc(env(safe-area-inset-bottom, 0px) + 100px)", zIndex: 30, background: C.ink, color: "#F3F5F9", padding: "9px 15px", borderRadius: 999, fontSize: 13, fontWeight: 500 }}>{flash}</div>}
      <datalist id="fin-people">{people.map((p) => <option key={p} value={p} />)}</datalist>
      {view !== "fin-cadastros" && <MonthNav ym={ym} setYm={setYm} />}
      {view === "fin-mes" && <MesView {...ctx} />}
      {view === "fin-painel" && <PainelView {...ctx} />}
      {view === "fin-cartoes" && <CartoesView {...ctx} />}
      {view === "fin-parcelas" && <ParcelasView {...ctx} />}
      {view === "fin-cobrancas" && <CobrancasView {...ctx} />}
      {view === "fin-cadastros" && <CadastrosView {...ctx} />}
    </div>
  );
}

// ================= Mês (controle de caixa) =================
function MesView({ data, update, ym, patchMonth, cats, catOf, say, onGo }) {
  const m = useMemo(() => computeMonth(data, ym), [data, ym]);
  const [edit, setEdit] = useState(null);
  const [adding, setAdding] = useState(null); // entrada | despesa | poupanca
  const togglePaid = (id) => patchMonth(ym, (mo) => ({ ...mo, paid: { ...mo.paid, [id]: !mo.paid[id] } }));

  const groups = {};
  m.despesas.forEach((d) => { (groups[d.cat || "_sem"] = groups[d.cat || "_sem"] || []).push(d); });
  const groupKeys = Object.keys(groups).sort((a, b) => sum(groups[b]) - sum(groups[a]));
  const cobRecebido = sum(m.cob.filter((c) => c.received));

  const Line = (l, { kind }) => (
    <div key={l.id}>
      <div className="rot-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
        {kind !== "entrada" && (
          <button onClick={() => togglePaid(l.id)} aria-label={l.paid ? "Desmarcar" : "Marcar como pago"} style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, cursor: "pointer", display: "grid", placeItems: "center", border: `2px solid ${l.paid ? C.good : "#C9D1DF"}`, background: l.paid ? C.good : "transparent" }}>{l.paid && <Check size={12} color="#fff" />}</button>
        )}
        <div onClick={() => setEdit(edit === l.id ? null : l.id)} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
          <div style={{ fontSize: 13.5, color: l.paid ? C.sub : C.ink }}>{l.name}</div>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2 }}>{l.tag}</div>
        </div>
        <div onClick={() => setEdit(edit === l.id ? null : l.id)} style={{ fontSize: 13.5, fontWeight: 500, cursor: "pointer", color: kind === "entrada" ? C.good : C.ink, whiteSpace: "nowrap" }}>{brl(l.amount)}</div>
      </div>
      {edit === l.id && <LineEditor line={l} ym={ym} update={update} patchMonth={patchMonth} cats={cats} kind={kind} onClose={() => setEdit(null)} say={say} />}
    </div>
  );

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
        {[["Entradas", m.totals.entradas, C.good], ["Saídas", m.totals.saidas, C.ink], ["Guardar", m.totals.guardar, C.accent], ["Sobra do mês", m.totals.sobra, m.totals.sobra < 0 ? C.bad : C.good]].map(([l, v, col]) => (
          <div key={l} style={{ background: "#EBEFF6", borderRadius: 11, padding: "11px 13px" }}>
            <div style={{ fontSize: 11.5, color: C.sub }}>{l}</div>
            <div className="lar-display" style={{ fontSize: 19, fontWeight: 600, color: col, marginTop: 2 }}>{brl(v)}</div>
          </div>
        ))}
      </div>

      <Title icon={TrendingUp} color={C.good} right={<button onClick={() => setAdding(adding === "entrada" ? null : "entrada")} style={{ ...btn, padding: "5px 10px", fontSize: 12 }}><Plus size={13} /> entrada</button>}>Entradas</Title>
      {adding === "entrada" && <AddForm kind="entrada" ym={ym} update={update} patchMonth={patchMonth} cats={cats} onDone={() => setAdding(null)} say={say} />}
      <div style={{ ...card, padding: "0 15px" }}>
        {m.entradas.map((l) => Line(l, { kind: "entrada" }))}
        <div onClick={() => onGo && onGo("fin-cobrancas")} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", cursor: "pointer" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5 }}>Recebimentos de terceiros</div>
            <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2 }}>{m.cob.length ? `${brl(cobRecebido)} já recebido, ver cobranças` : "nada a receber neste mês"}</div>
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 500, color: C.good }}>{brl(m.totals.cobrancas)}</div>
        </div>
        {m.entradas.length === 0 && <div style={{ fontSize: 12.5, color: C.faint, padding: "0 0 12px" }}>Cadastre os salários como entrada fixa. Se o valor mudar num mês, ajuste só aquele mês.</div>}
      </div>

      <Title icon={Wallet} color={C.bad} right={<button onClick={() => setAdding(adding === "despesa" ? null : "despesa")} style={{ ...btn, padding: "5px 10px", fontSize: 12 }}><Plus size={13} /> despesa</button>}>Despesas</Title>
      {adding === "despesa" && <AddForm kind="despesa" ym={ym} update={update} patchMonth={patchMonth} cats={cats} onDone={() => setAdding(null)} say={say} />}
      {groupKeys.length === 0 && <div style={{ ...card, padding: 16, fontSize: 12.5, color: C.faint, borderStyle: "dashed" }}>Nenhuma despesa neste mês. Contas da casa entram como fixas; parcela do carro ou de boleto entra como parcelada.</div>}
      {groupKeys.map((k) => (
        <div key={k} style={{ ...card, padding: "4px 15px 0", marginBottom: 9 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 0 3px" }}>
            <Dot color={catOf(k).color} /><span style={{ fontSize: 12.5, fontWeight: 600, color: C.sub }}>{catOf(k).name}</span>
            <span style={{ marginLeft: "auto", fontSize: 12.5, color: C.sub }}>{brl(sum(groups[k]))}</span>
          </div>
          {groups[k].map((l) => Line(l, { kind: "despesa" }))}
        </div>
      ))}

      <Title icon={CreditCard} color={C.accent} right={<button onClick={() => onGo && onGo("fin-cartoes")} style={{ ...btn, padding: "5px 10px", fontSize: 12 }}>lançamentos</button>}>Faturas dos cartões</Title>
      <div style={{ ...card, padding: "0 15px" }}>
        {m.cards.length === 0 && <div style={{ fontSize: 12.5, color: C.faint, padding: "14px 0" }}>Cadastre os cartões na aba Cadastros.</div>}
        {m.cards.map(({ card: c, total, occs, filled, paid }) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
            <button onClick={() => togglePaid(`card:${c.id}`)} aria-label="Fatura paga" style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, cursor: "pointer", display: "grid", placeItems: "center", border: `2px solid ${paid ? C.good : "#C9D1DF"}`, background: paid ? C.good : "transparent" }}>{paid && <Check size={12} color="#fff" />}</button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5 }}>{c.name}</div>
              <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2 }}>{c.mode === "so_fatura" ? (c.usedBy ? `só o valor da fatura, cobrado de ${c.usedBy}` : "só o valor da fatura") : `${occs.length} lançamentos`}</div>
            </div>
            {c.mode === "so_fatura" ? (
              <MoneyInput value={filled ? total : null} placeholder="valor" onSave={(v) => patchMonth(ym, (mo) => { const inv = { ...mo.invoices }; if (v == null) delete inv[c.id]; else inv[c.id] = v; return { ...mo, invoices: inv }; })} />
            ) : <div style={{ fontSize: 13.5, fontWeight: 500 }}>{brl(total)}</div>}
          </div>
        ))}
        {m.cards.length > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 12.5, color: C.sub }}><span>Total das faturas</span><b style={{ fontWeight: 600, color: C.ink }}>{brl(m.totals.cartoes)}</b></div>}
      </div>

      <Title icon={PiggyBank} color={C.accent} right={<button onClick={() => setAdding(adding === "poupanca" ? null : "poupanca")} style={{ ...btn, padding: "5px 10px", fontSize: 12 }}><Plus size={13} /> guardar</button>}>Guardar no mês</Title>
      {adding === "poupanca" && <AddForm kind="poupanca" ym={ym} update={update} patchMonth={patchMonth} cats={cats} onDone={() => setAdding(null)} say={say} />}
      <div style={{ ...card, padding: "0 15px" }}>
        {m.poupanca.map((l) => Line(l, { kind: "poupanca" }))}
        {m.poupanca.length === 0 && <div style={{ fontSize: 12.5, color: C.faint, padding: "14px 0" }}>Defina quanto vocês querem guardar por mês. Marque quando a transferência for feita.</div>}
      </div>

      <div style={{ ...card, marginTop: 18, padding: "14px 15px", display: "flex", justifyContent: "space-between", alignItems: "baseline", background: m.totals.sobra < 0 ? C.badSoft : C.goodSoft, borderColor: "transparent" }}>
        <span style={{ fontSize: 13.5, color: C.sub }}>Sobra de {ymLabel(ym)} depois de guardar</span>
        <span className="lar-display" style={{ fontSize: 20, fontWeight: 600, color: m.totals.sobra < 0 ? C.bad : C.good }}>{brl(m.totals.sobra)}</span>
      </div>
    </div>
  );
}

function MoneyInput({ value, onSave, placeholder }) {
  const [v, setV] = useState(toInput(value));
  useEffect(() => { setV(toInput(value)); }, [value]);
  return (
    <input inputMode="decimal" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)}
      onBlur={() => { const n = parseMoney(v); if (n !== value) onSave(n); }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      style={{ ...input, width: 110, textAlign: "right", padding: "7px 9px" }} />
  );
}

// Novo item: entrada, despesa ou guardar. Só este mês, todo mês (fixa) ou parcelada.
function AddForm({ kind, ym, update, patchMonth, cats, onDone, say }) {
  const [name, setName] = useState("");
  const [val, setVal] = useState("");
  const [cat, setCat] = useState(kind === "despesa" ? "" : null);
  const [freq, setFreq] = useState(kind === "poupanca" ? "fixa" : kind === "entrada" ? "fixa" : "unica");
  const [total, setTotal] = useState("12");
  const [cur, setCur] = useState("1");
  const save = () => {
    const amount = parseMoney(val);
    if (!name.trim() || amount == null) return;
    if (freq === "unica") patchMonth(ym, (mo) => ({ ...mo, extras: [...mo.extras, { id: uid(), kind, name: name.trim(), cat, amount }] }));
    else if (freq === "fixa") update((d) => ({ ...d, recurring: [...d.recurring, { id: uid(), kind, name: name.trim(), cat, versions: [{ from: ym, amount }] }] }));
    else {
      const n = Math.max(1, parseInt(total) || 1), k = Math.min(n, Math.max(1, parseInt(cur) || 1));
      update((d) => ({ ...d, installments: [...d.installments, { id: uid(), name: name.trim(), cat, amount, total: n, first: ymAdd(ym, -(k - 1)) }] }));
    }
    say(`${name.trim()} adicionado`); onDone();
  };
  const label = { entrada: "Nova entrada", despesa: "Nova despesa", poupanca: "Quanto guardar" }[kind];
  return (
    <div style={{ ...card, padding: 14, marginBottom: 10, display: "flex", flexDirection: "column", gap: 10, borderStyle: "dashed", borderColor: C.accent }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
      <div style={{ display: "flex", gap: 8 }}>
        <Field label="Nome" style={{ flex: 2 }}><input style={input} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "entrada" ? "Salário" : kind === "poupanca" ? "Reserva na XP" : "Conta de luz"} /></Field>
        <Field label={freq === "parcelada" ? "Valor da parcela" : "Valor"}><input style={input} inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} placeholder="0,00" /></Field>
      </div>
      {kind === "despesa" && <Field label="Categoria"><CatSelect cats={cats} value={cat} onChange={setCat} /></Field>}
      <Seg value={freq} onChange={setFreq} options={kind === "despesa" ? [["unica", "Só este mês"], ["fixa", "Todo mês"], ["parcelada", "Parcelada"]] : [["unica", "Só este mês"], ["fixa", "Todo mês"]]} />
      {freq === "parcelada" && (
        <div style={{ display: "flex", gap: 8 }}>
          <Field label="Esta é a parcela"><input style={input} inputMode="numeric" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
          <Field label="De quantas"><input style={input} inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} /></Field>
        </div>
      )}
      {freq === "parcelada" && <div style={{ fontSize: 11.5, color: C.faint }}>Paga fora do cartão (boleto, débito, pix). Aparece nos próximos meses até a última parcela.</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onDone} style={{ ...btn, flex: 1, justifyContent: "center" }}>cancelar</button>
        <button onClick={save} style={{ ...dark, flex: 2, justifyContent: "center" }}>adicionar</button>
      </div>
    </div>
  );
}

function LineEditor({ line, ym, update, patchMonth, cats, kind, onClose, say }) {
  const [val, setVal] = useState(toInput(line.amount));
  const [name, setName] = useState(line.name);
  const [cat, setCat] = useState(line.cat || "");
  const amount = parseMoney(val);
  const box = { margin: "4px 0 10px", padding: 12, background: "#F5F7FB", borderRadius: 10, display: "flex", flexDirection: "column", gap: 9 };
  const head = (
    <div style={{ display: "flex", gap: 8 }}>
      <Field label="Nome" style={{ flex: 2 }}><input style={input} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Valor"><input style={input} inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} /></Field>
    </div>
  );
  const catField = kind === "despesa" && <Field label="Categoria"><CatSelect cats={cats} value={cat} onChange={setCat} /></Field>;

  if (line.src === "rec") {
    const r = line.rec;
    const setMeta = (d) => ({ ...d, recurring: d.recurring.map((x) => (x.id === r.id ? { ...x, name: name.trim() || x.name, cat: cat || x.cat || null } : x)) });
    const onlyThis = () => { if (amount == null) return; update((d) => { const d2 = setMeta(d); const mo = { values: {}, ...(d2.months[ym] || {}) }; return { ...d2, months: { ...d2.months, [ym]: { ...mo, values: { ...mo.values, [r.id]: amount } } } }; }); say(`Ajustado só em ${ymLabel(ym)}`); onClose(); };
    const fromNow = () => { if (amount == null) return; update((d) => {
      const d2 = setMeta(d);
      const mo = { ...(d2.months[ym] || {}) }; if (mo.values) { mo.values = { ...mo.values }; delete mo.values[r.id]; }
      return { ...d2, months: { ...d2.months, [ym]: mo }, recurring: d2.recurring.map((x) => (x.id === r.id ? { ...x, versions: [...x.versions.filter((v) => v.from !== ym), { from: ym, amount }].sort((a, b) => a.from.localeCompare(b.from)) } : x)) };
    }); say(`Novo valor a partir de ${ymLabel(ym)}`); onClose(); };
    const end = () => { update((d) => {
      const first = [...r.versions].sort((a, b) => a.from.localeCompare(b.from))[0].from;
      if (ym <= first) return { ...d, recurring: d.recurring.filter((x) => x.id !== r.id) };
      return { ...d, recurring: d.recurring.map((x) => (x.id === r.id ? { ...x, until: ymAdd(ym, -1) } : x)) };
    }); say(`Encerrado a partir de ${ymLabel(ym)}`); onClose(); };
    return (
      <div style={box}>
        {head}{catField}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={onlyThis} style={{ ...btn, background: "#fff" }}>só em {ymLabel(ym)}</button>
          <button onClick={fromNow} style={dark}>de {ymLabel(ym)} em diante</button>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={end} style={{ ...btn, background: "#fff", fontSize: 11.5, color: C.bad }}><X size={12} /> encerrar a partir de {ymLabel(ym)}</button>
          <button onClick={onClose} style={{ ...iconbtn, marginLeft: "auto", fontSize: 12, fontFamily: "inherit" }}>fechar</button>
        </div>
      </div>
    );
  }
  if (line.src === "extra") {
    const save = () => { if (amount == null) return; patchMonth(ym, (mo) => ({ ...mo, extras: mo.extras.map((e) => (e.id === line.id ? { ...e, name: name.trim() || e.name, amount, cat: cat || e.cat } : e)) })); onClose(); };
    const del = () => { patchMonth(ym, (mo) => ({ ...mo, extras: mo.extras.filter((e) => e.id !== line.id) })); onClose(); };
    return (
      <div style={box}>{head}{catField}
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={del} style={{ ...btn, background: "#fff", color: C.bad }}><Trash2 size={13} /> apagar</button>
          <button onClick={save} style={{ ...dark, marginLeft: "auto" }}>salvar</button>
        </div>
      </div>
    );
  }
  // parcelado fora do cartão
  const it = line.inst;
  const save = () => { if (amount == null) return; update((d) => ({ ...d, installments: d.installments.map((x) => (x.id === it.id ? { ...x, name: name.trim() || x.name, amount, cat: cat || x.cat } : x)) })); onClose(); };
  const del = () => { if (!window.confirm(`Apagar "${it.name}" de todos os meses?`)) return; update((d) => ({ ...d, installments: d.installments.filter((x) => x.id !== it.id) })); onClose(); };
  return (
    <div style={box}>{head}{catField}
      <div style={{ fontSize: 11.5, color: C.faint }}>Alterar aqui vale para todas as parcelas. Termina em {ymLabel(ymAdd(it.first, it.total - 1))}.</div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={del} style={{ ...btn, background: "#fff", color: C.bad }}><Trash2 size={13} /> apagar parcelamento</button>
        <button onClick={save} style={{ ...dark, marginLeft: "auto" }}>salvar</button>
      </div>
    </div>
  );
}

// ================= Painel =================
function PainelView({ data, ym, catOf, onGo }) {
  const m = useMemo(() => computeMonth(data, ym), [data, ym]);
  const { byCat, lines } = useMemo(() => spendByCat(data, ym), [data, ym]);
  const prev = useMemo(() => spendByCat(data, ymAdd(ym, -1)).byCat, [data, ym]);
  const [open, setOpen] = useState(null);
  const keys = Object.keys(byCat).filter((k) => byCat[k] > 0).sort((a, b) => byCat[b] - byCat[a]);
  const totalCat = sum(keys, (k) => byCat[k]);
  const max = Math.max(1, ...keys.map((k) => byCat[k]));
  const hist = useMemo(() => Array.from({ length: 6 }, (_, i) => { const y = ymAdd(ym, i - 5); const t = computeMonth(data, y).totals; return { ym: y, ent: t.entradas, sai: t.saidas, sobra: t.sobra }; }), [data, ym]);
  const hmax = Math.max(1, ...hist.flatMap((h) => [h.ent, h.sai]));
  const futuro = useMemo(() => Array.from({ length: 6 }, (_, i) => {
    const y = ymAdd(ym, i + 1);
    const inst = sum(data.installments.filter((it) => instOcc(it, y)));
    const cards = sum(data.txs.filter((t) => (t.parcels || 1) > 1 && !t.anticipated && txOcc(t, y)));
    return { ym: y, v: inst + cards };
  }), [data, ym]);
  const fmax = Math.max(1, ...futuro.map((f) => f.v));
  const sem = byCat._sem || 0;

  return (
    <div>
      <div style={{ ...card, padding: "16px 16px 14px" }}>
        <div style={{ fontSize: 12.5, color: C.sub }}>Gasto do casal em {ymLabel(ym)}</div>
        <div className="lar-display" style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.5, marginTop: 2 }}>{brl(totalCat)}</div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8, fontSize: 12.5, color: C.sub }}>
          <span>Entradas <b style={{ color: C.good, fontWeight: 600 }}>{brl(m.totals.entradas)}</b></span>
          <span>Sobra <b style={{ color: m.totals.sobra < 0 ? C.bad : C.good, fontWeight: 600 }}>{brl(m.totals.sobra)}</b></span>
          {data.savings.balance != null && <span>Na XP <b style={{ color: C.accent, fontWeight: 600 }}>{brl(data.savings.balance)}</b></span>}
        </div>
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8, lineHeight: 1.45 }}>Não entra aqui o que é de terceiros (adicionais de outras pessoas, cartões emprestados e a parte dividida das compras).</div>
      </div>

      <Title>Por categoria</Title>
      {sem > 0 && <button onClick={() => onGo && onGo("fin-cartoes")} style={{ ...btn, width: "100%", justifyContent: "space-between", marginBottom: 9, background: C.sunSoft, borderColor: "#F0E2C4", color: "#7A5B1E" }}><span>{brl(sem)} sem categoria</span><span>categorizar</span></button>}
      <div style={{ ...card, padding: "6px 15px" }}>
        {keys.length === 0 && <div style={{ fontSize: 12.5, color: C.faint, padding: "12px 0" }}>Sem gastos registrados neste mês.</div>}
        {keys.map((k, i) => {
          const c = k === "_sem" ? { name: "Sem categoria", color: C.faint } : catOf(k);
          const v = byCat[k], p = prev[k] || 0, delta = p ? Math.round(((v - p) / p) * 100) : null;
          return (
            <div key={k} style={{ borderBottom: i < keys.length - 1 ? `1px solid ${C.line}` : "none" }}>
              <div onClick={() => setOpen(open === k ? null : k)} style={{ padding: "10px 0", cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <Dot color={c.color} /><span style={{ fontSize: 13.5, flex: 1 }}>{c.name}</span>
                  {delta != null && Math.abs(delta) >= 5 && <span style={{ fontSize: 11, color: delta > 0 ? C.bad : C.good }}>{delta > 0 ? "+" : ""}{delta}% vs {MES[Number(ymAdd(ym, -1).slice(5)) - 1]}</span>}
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{brl(v)}</span>
                </div>
                <div style={{ height: 6, background: "#EBEFF6", borderRadius: 99, marginTop: 7, overflow: "hidden" }}><div style={{ width: `${(v / max) * 100}%`, height: "100%", background: c.color, borderRadius: 99 }} /></div>
              </div>
              {open === k && (
                <div style={{ padding: "0 0 10px 16px" }}>
                  {[...lines[k]].sort((a, b) => b.amount - a.amount).map((l, j) => <div key={j} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: C.sub, padding: "3px 0" }}><span>{l.label}</span><span>{brl(l.amount)}</span></div>)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Title>Últimos 6 meses</Title>
      <div style={{ ...card, padding: "16px 15px 12px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 130 }}>
          {hist.map((h) => (
            <div key={h.ym} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 104 }}>
                <div title={`Entradas ${brl(h.ent)}`} style={{ width: 11, height: `${(h.ent / hmax) * 100}%`, background: C.good, borderRadius: 4, minHeight: 2 }} />
                <div title={`Saídas ${brl(h.sai)}`} style={{ width: 11, height: `${(h.sai / hmax) * 100}%`, background: h.ym === ym ? C.ink : "#B9C2D3", borderRadius: 4, minHeight: 2 }} />
              </div>
              <span style={{ fontSize: 11, color: h.ym === ym ? C.ink : C.faint, fontWeight: h.ym === ym ? 600 : 400 }}>{MES[Number(h.ym.slice(5)) - 1]}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: C.sub, marginTop: 8 }}><span><Dot color={C.good} s={7} /> entradas</span><span><Dot color={C.ink} s={7} /> saídas</span></div>
      </div>

      <Title icon={Layers}>Parcelas já comprometidas</Title>
      <div style={{ ...card, padding: "6px 15px" }}>
        {futuro.map((f, i) => (
          <div key={f.ym} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: i < 5 ? `1px solid ${C.line}` : "none" }}>
            <span style={{ fontSize: 12.5, color: C.sub, width: 62 }}>{ymLabel(f.ym)}</span>
            <div style={{ flex: 1, height: 6, background: "#EBEFF6", borderRadius: 99, overflow: "hidden" }}><div style={{ width: `${(f.v / fmax) * 100}%`, height: "100%", background: C.accent }} /></div>
            <span style={{ fontSize: 12.5, fontWeight: 500, width: 92, textAlign: "right" }}>{brl(f.v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ================= Cartões (lançamentos) =================
function CartoesView({ data, update, ym, setYm, patchMonth, cats, catOf, say, people }) {
  const detailed = data.cards.filter((c) => c.mode !== "so_fatura" && !c.archived);
  const [cardId, setCardId] = useState(detailed[0]?.id || null);
  const [filter, setFilter] = useState("todos"); // todos | sem | sub id
  const [form, setForm] = useState(null); // null | "new" | tx
  const [splitFor, setSplitFor] = useState(null);
  useEffect(() => { if (!detailed.find((c) => c.id === cardId)) setCardId(detailed[0]?.id || null); }, [data.cards]);
  const c = detailed.find((x) => x.id === cardId);
  const importBox = <ImportarFaturas data={data} update={update} people={people} say={say} onDone={(cid, m) => { setCardId(cid); setYm(m); setFilter("todos"); }} />;
  if (!detailed.length) return <div>{importBox}<div style={{ ...card, padding: 18, fontSize: 13, color: C.sub, lineHeight: 1.5, borderStyle: "dashed" }}>Nenhum cartão com lançamentos detalhados. Importe uma fatura acima ou cadastre os cartões na aba Cadastros. Cartões que você só informa o valor da fatura ficam direto na aba Mês.</div></div>;

  const mo = data.months[ym] || {};
  const occs = data.txs.filter((t) => t.cardId === cardId).map((t) => txOcc(t, ym)).filter(Boolean)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const shown = occs.filter((t) => filter === "todos" || (filter === "sem" ? !t.cat && !subOf(c, t.sub)?.who : t.sub === filter));
  const semCount = occs.filter((t) => !t.cat && !subOf(c, t.sub)?.who).length;
  const splitOf = (t) => (mo.receivables || []).filter((r) => r.txId === t.id);

  const setTx = (id, patch) => update((d) => ({ ...d, txs: d.txs.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  const delTx = (t) => {
    const msg = (t.parcels || 1) > 1 ? `Apagar a compra "${t.desc}" e todas as parcelas dela?` : `Apagar "${t.desc}"?`;
    if (!window.confirm(msg)) return;
    update((d) => ({ ...d, txs: d.txs.filter((x) => x.id !== t.id) }));
  };

  return (
    <div>
      {importBox}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 12 }}>
        {detailed.map((x) => {
          const on = x.id === cardId;
          const tot = sum(data.txs.filter((t) => t.cardId === x.id).map((t) => txOcc(t, ym)).filter(Boolean));
          return <button key={x.id} onClick={() => { setCardId(x.id); setFilter("todos"); setForm(null); }} style={{ flex: "0 0 auto", padding: "8px 13px", borderRadius: 12, cursor: "pointer", border: `1px solid ${on ? C.ink : C.line}`, background: on ? C.ink : C.surface, color: on ? "#fff" : C.sub, fontFamily: "inherit", textAlign: "left" }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{x.name}</div><div style={{ fontSize: 11.5, opacity: 0.8 }}>{brl(tot)}</div>
          </button>;
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: C.sub }}>Fatura de {ymLabel(ym)}: <b style={{ color: C.ink, fontWeight: 600 }}>{brl(sum(occs))}</b></div>
        <button onClick={() => setForm(form === "new" ? null : "new")} style={{ ...dark, marginLeft: "auto", padding: "7px 12px" }}><Plus size={14} /> lançamento</button>
      </div>
      {form === "new" && <TxForm card={c} cats={cats} ym={ym} onCancel={() => setForm(null)} onSave={(t) => { update((d) => ({ ...d, txs: [...d.txs, { id: uid(), cardId: c.id, month: ym, ...t }] })); say("Lançamento adicionado"); setForm(null); }} />}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {[["todos", "Todos"], ...(semCount ? [["sem", `Sem categoria (${semCount})`]] : []), ...(c.subs || []).map((s) => [s.id, s.who ? `${s.label || "adicional"} de ${s.who}` : (s.label || "titular")])].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} style={{ ...btn, padding: "5px 10px", fontSize: 12, borderRadius: 99, background: filter === k ? C.ink : C.surface, color: filter === k ? "#fff" : C.sub, borderColor: filter === k ? C.ink : C.line }}>{l}</button>
        ))}
      </div>

      {shown.length === 0 && <div style={{ ...card, padding: 16, fontSize: 12.5, color: C.faint, borderStyle: "dashed" }}>Nada por aqui nesta fatura.</div>}
      {shown.map((t) => {
        const s = subOf(c, t.sub); const third = s?.who; const splits = splitOf(t);
        if (form && form.id === t.id) return <TxForm key={t.id} card={c} cats={cats} ym={ym} initial={t} onCancel={() => setForm(null)} onSave={(p) => { setTx(t.id, p); setForm(null); }} />;
        return (
          <div key={t.id} style={{ ...card, padding: "11px 13px", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{t.desc}</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 4, alignItems: "center" }}>
                  {t.date && <span style={{ fontSize: 11.5, color: C.faint }}>{ddmm(t.date)}</span>}
                  {(t.parcels || 1) > 1 && <Pill>parcela {t.curParcel}/{t.parcels}{t.replicated ? `, lançada em ${ymLabel(t.month)}` : ""}</Pill>}
                  {s && <Pill color={third ? C.sun : C.sub} soft={third ? C.sunSoft : "#EBEFF6"}>{third ? `de ${s.who}${s.label ? `, ${s.label}` : ""}` : s.label || "titular"}</Pill>}
                  {splits.map((r) => <Pill key={r.id} color={C.good} soft={C.goodSoft}>{brl(r.amount)} a receber de {r.who}</Pill>)}
                </div>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap" }}>{brl(t.amount)}</div>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 9, alignItems: "center" }}>
              {third ? <span style={{ flex: 1, fontSize: 11.5, color: C.faint }}>Vai para as cobranças de {s.who}.</span>
                : <CatSelect cats={cats} value={t.cat} onChange={(v) => setTx(t.id, { cat: v || null })} style={{ flex: 1, fontSize: 12.5, padding: "6px 8px", background: t.cat ? "#F7F9FC" : C.sunSoft }} />}
              {!third && <button onClick={() => setSplitFor(splitFor === t.id ? null : t.id)} title="Dividir com alguém" style={{ ...btn, padding: "6px 9px" }}><Users size={14} /></button>}
              <button onClick={() => setForm(t)} title="Editar" style={{ ...btn, padding: "6px 9px" }}><Pencil size={13} /></button>
              <button onClick={() => delTx(t)} title="Apagar" style={{ ...btn, padding: "6px 9px", color: C.bad }}><Trash2 size={13} /></button>
            </div>
            {splitFor === t.id && <SplitForm tx={t} people={people} splits={splits} onClose={() => setSplitFor(null)}
              onAdd={(r) => { patchMonth(ym, (m2) => ({ ...m2, receivables: [...m2.receivables, { id: uid(), txId: t.id, ...r }] })); say(`Cobrança de ${r.who} criada`); }}
              onDel={(id) => patchMonth(ym, (m2) => ({ ...m2, receivables: m2.receivables.filter((x) => x.id !== id) }))} />}
          </div>
        );
      })}
    </div>
  );
}

function TxForm({ card: c, cats, initial, onSave, onCancel }) {
  const [desc, setDesc] = useState(initial?.desc || "");
  const [val, setVal] = useState(toInput(initial?.amount));
  const [date, setDate] = useState(initial?.date || isoToday());
  const [k, setK] = useState(String(initial?.parcel || 1));
  const [n, setN] = useState(String(initial?.parcels || 1));
  const [cat, setCat] = useState(initial?.cat || "");
  const [sub, setSub] = useState(initial?.sub || (c.subs || [])[0]?.id || "");
  const subWho = subOf(c, sub)?.who;
  const save = () => {
    const amount = parseMoney(val); if (!desc.trim() || amount == null) return;
    const parcels = Math.max(1, parseInt(n) || 1);
    onSave({ desc: desc.trim(), amount, date, parcel: Math.min(parcels, Math.max(1, parseInt(k) || 1)), parcels, cat: cat || null, sub: sub || null });
  };
  return (
    <div style={{ ...card, padding: 14, marginBottom: 10, display: "flex", flexDirection: "column", gap: 10, borderStyle: "dashed", borderColor: C.accent }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{initial ? "Editar lançamento" : `Lançamento no ${c.name}`}</div>
      <Field label="Descrição"><input style={input} autoFocus value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="iFood, Pão de Açúcar…" /></Field>
      <div style={{ display: "flex", gap: 8 }}>
        <Field label="Valor da parcela"><input style={input} inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} placeholder="0,00" /></Field>
        <Field label="Data da compra"><input style={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <Field label="Parcela"><input style={input} inputMode="numeric" value={k} onChange={(e) => setK(e.target.value)} /></Field>
        <Field label="De"><input style={input} inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} /></Field>
        <div style={{ flex: 2, fontSize: 11.5, color: C.faint, paddingBottom: 9 }}>Use 1 de 1 para compra à vista. Parcelada se replica nas próximas faturas.</div>
      </div>
      {(c.subs || []).length > 0 && (
        <Field label="Cartão usado">
          <select value={sub} onChange={(e) => setSub(e.target.value)} style={{ ...input, padding: "8px 9px" }}>
            {(c.subs || []).map((s) => <option key={s.id} value={s.id}>{s.label || "sem final"}{s.who ? `, de ${s.who}` : ", nosso"}</option>)}
          </select>
        </Field>
      )}
      {!subWho && <Field label="Categoria"><CatSelect cats={cats} value={cat} onChange={setCat} /></Field>}
      {subWho && <div style={{ fontSize: 12, color: C.sun }}>Este lançamento vai inteiro para as cobranças de {subWho}.</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onCancel} style={{ ...btn, flex: 1, justifyContent: "center" }}>cancelar</button>
        <button onClick={save} style={{ ...dark, flex: 2, justifyContent: "center" }}>salvar</button>
      </div>
    </div>
  );
}

function SplitForm({ tx, people, splits, onAdd, onDel, onClose }) {
  const [who, setWho] = useState("");
  const [val, setVal] = useState("");
  const add = () => { const a = parseMoney(val); if (!who.trim() || a == null) return; onAdd({ who: who.trim(), amount: a, desc: tx.desc }); setWho(""); setVal(""); };
  return (
    <div style={{ marginTop: 10, padding: 12, background: "#F5F7FB", borderRadius: 10, display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ fontSize: 12.5, color: C.sub }}>Quanto cada pessoa te deve desta compra. Vira cobrança e sai do gasto da categoria.</div>
      {splits.map((r) => <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}><span style={{ flex: 1 }}>{r.who}</span><span>{brl(r.amount)}</span><button onClick={() => onDel(r.id)} style={iconbtn}><X size={14} /></button></div>)}
      <div style={{ display: "flex", gap: 8 }}>
        <input style={{ ...input, flex: 2 }} list="fin-people" placeholder="Quem" value={who} onChange={(e) => setWho(e.target.value)} />
        <input style={{ ...input, flex: 1 }} inputMode="decimal" placeholder="Valor" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onClose} style={{ ...btn, flex: 1, justifyContent: "center", background: "#fff" }}>fechar</button>
        <button onClick={add} style={{ ...dark, flex: 2, justifyContent: "center" }}>adicionar cobrança</button>
      </div>
    </div>
  );
}


// ================= Importar faturas em PDF =================
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import("pdfjs-dist/legacy/build/pdf.mjs"),
      import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
    ]).then(([pdfjs, worker]) => { pdfjs.GlobalWorkerOptions.workerSrc = worker.default; return pdfjs; });
  }
  return pdfjsPromise;
}

function ImportarFaturas({ data, update, people, say, onDone }) {
  const [items, setItems] = useState([]); // { id, name, file, status: lendo|senha|erro|pronto, parsed, error }
  const inputRef = useRef(null);
  const read = async (it, password) => {
    setItems((l) => l.map((x) => (x.id === it.id ? { ...x, status: "lendo", error: null } : x)));
    try {
      const pdfjs = await loadPdfjs();
      const bytes = new Uint8Array(await it.file.arrayBuffer());
      const pages = await pagesFromPdf(pdfjs, bytes, password);
      const parsed = parseFatura(pages);
      setItems((l) => l.map((x) => (x.id === it.id ? { ...x, status: parsed.bank ? "pronto" : "erro", parsed, error: parsed.bank ? null : parsed.warnings[0] } : x)));
    } catch (e) {
      const needs = e?.name === "PasswordException";
      setItems((l) => l.map((x) => (x.id === it.id ? { ...x, status: needs ? "senha" : "erro", error: needs ? (password ? "Senha incorreta. Tente de novo." : null) : "Não consegui abrir este PDF." } : x)));
    }
  };
  const pick = (files) => {
    const list = [...files].filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)).map((f) => ({ id: uid(), name: f.name, file: f, status: "lendo" }));
    setItems((l) => [...l, ...list]);
    list.forEach((it) => read(it));
  };
  const drop = (id) => setItems((l) => l.filter((x) => x.id !== id));
  return (
    <div style={{ marginBottom: 14 }}>
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple style={{ display: "none" }} onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
      <button onClick={() => inputRef.current?.click()} style={{ ...btn, width: "100%", justifyContent: "center", padding: "11px 12px", borderStyle: "dashed", color: C.accent, borderColor: "#BFCCEA" }}>
        <FileUp size={15} /> Importar fatura em PDF
      </button>
      <div style={{ fontSize: 11.5, color: C.faint, margin: "6px 2px 0" }}>Itaú, Nubank, Santander e Mercado Pago. O PDF é lido no seu aparelho; só os lançamentos são salvos.</div>
      {items.map((it) => (
        <div key={it.id} style={{ marginTop: 10 }}>
          {it.status === "lendo" && <div style={{ ...card, padding: 14, fontSize: 13, color: C.sub }}>Lendo {it.name}…</div>}
          {it.status === "erro" && <div style={{ ...card, padding: 14, fontSize: 13, color: C.bad, display: "flex", gap: 8, alignItems: "center" }}><span style={{ flex: 1 }}>{it.name}: {it.error}</span><button onClick={() => drop(it.id)} style={iconbtn}><X size={15} /></button></div>}
          {it.status === "senha" && <PdfPassword name={it.name} error={it.error} onTry={(pw) => read(it, pw)} onCancel={() => drop(it.id)} />}
          {it.status === "pronto" && <RevisarFatura key={it.id} name={it.name} parsed={it.parsed} data={data} people={people}
            onCancel={() => drop(it.id)}
            onImport={({ cardId, newCard, month, plan }) => {
              update((d) => applyPlan(newCard ? { ...d, cards: [...d.cards, newCard] } : d, cardId, plan));
              say(`${plan.count} lançamentos importados`);
              drop(it.id);
              onDone && onDone(cardId, month);
            }} />}
        </div>
      ))}
    </div>
  );
}

function PdfPassword({ name, error, onTry, onCancel }) {
  const [pw, setPw] = useState("");
  return (
    <div style={{ ...card, padding: 14, display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ fontSize: 13 }}>{name} tem senha. Costuma ser parte do CPF; confira no e-mail do banco.</div>
      <input style={input} type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onTry(pw)} placeholder="Senha do PDF" />
      {error && <div style={{ fontSize: 12, color: C.bad }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onCancel} style={{ ...btn, flex: 1, justifyContent: "center" }}>cancelar</button>
        <button onClick={() => onTry(pw)} style={{ ...dark, flex: 2, justifyContent: "center" }}>abrir</button>
      </div>
    </div>
  );
}

function RevisarFatura({ name, parsed, data, people, onImport, onCancel }) {
  const dueYm = parsed.due ? parsed.due.slice(0, 7) : ymNow();
  const [month, setMonth] = useState(dueYm);
  const [cardId, setCardId] = useState(guessCard(data, parsed) || "__novo");
  const [newName, setNewName] = useState(`${parsed.bankName}${parsed.cards[0] && /^\d{4}$/.test(parsed.cards[0].key) ? ` final ${parsed.cards[0].key}` : ""}`);
  const [subs, setSubs] = useState(() => guessSubs(data, parsed, cardId === "__novo" ? null : cardId, people));
  const [showLines, setShowLines] = useState(false);
  useEffect(() => { setSubs(guessSubs(data, parsed, cardId === "__novo" ? null : cardId, people)); }, [cardId]);
  const realCardId = cardId === "__novo" ? "__novo" : cardId;
  const plan = useMemo(() => planImport(data, parsed, { cardId: realCardId, month, subs }), [data, parsed, realCardId, month, subs]);
  const detailed = data.cards.filter((c) => c.mode !== "so_fatura" && !c.archived);
  const okTotal = parsed.total != null && Math.abs(parsed.sum - parsed.total) <= 0.05;
  const catName = (id) => data.categories.find((c) => c.id === id)?.name || "sem categoria";
  const byKey = (k) => parsed.lines.filter((l) => l.key === k);
  const go = () => {
    if (cardId === "__novo") {
      if (!newName.trim()) return;
      const id = uid();
      const newCard = { id, name: newName.trim(), mode: "detalhado", subs: [], usedBy: "", cat: null, archived: false };
      onImport({ cardId: id, newCard, month, plan: planImport({ ...data, cards: [...data.cards, newCard] }, parsed, { cardId: id, month, subs }) });
    } else onImport({ cardId, month, plan });
  };
  return (
    <div style={{ ...card, padding: 14, display: "flex", flexDirection: "column", gap: 11, borderColor: C.accent }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="lar-display" style={{ fontSize: 15.5, fontWeight: 600 }}>{parsed.bankName}, vence {parsed.due ? ddmm(parsed.due) : "?"}</div>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
        </div>
        <button onClick={onCancel} style={iconbtn} aria-label="Descartar"><X size={16} /></button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", borderRadius: 10, background: okTotal ? C.goodSoft : C.sunSoft, fontSize: 12.5, color: okTotal ? C.good : "#7A5B1E" }}>
        {okTotal ? <Check size={15} /> : <AlertTriangle size={15} />}
        <span>{okTotal ? `Li ${parsed.lines.length} lançamentos e a soma bate com o total da fatura (${brl(parsed.total)}).` : (parsed.warnings[0] || `Soma lida ${brl(parsed.sum)}.`)}</span>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Field label="Mês da fatura"><input type="month" style={input} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></Field>
        <Field label="Cartão no app" style={{ flex: 1.4 }}>
          <select value={cardId} onChange={(e) => setCardId(e.target.value)} style={{ ...input, padding: "8px 9px" }}>
            {detailed.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="__novo">Criar cartão novo</option>
          </select>
        </Field>
      </div>
      {cardId === "__novo" && <Field label="Nome do cartão novo"><input style={input} value={newName} onChange={(e) => setNewName(e.target.value)} /></Field>}

      <div>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Cartões nesta fatura</div>
        <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 8, lineHeight: 1.45 }}>Confira pelo final, não pelo nome impresso. Preencha "de quem" só nos adicionais de outra pessoa: os lançamentos vão para as cobranças dela.</div>
        {parsed.cards.map((pc) => {
          const s = subs[pc.key] || { label: pc.key, who: "" };
          const ls = byKey(pc.key);
          return (
            <div key={pc.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: `1px solid ${C.line}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{s.label}</div>
                <div style={{ fontSize: 11, color: C.faint }}>{[pc.holder, `${ls.length} lançamentos`, brl(sum(ls))].filter(Boolean).join(", ")}</div>
              </div>
              <input list="fin-people" value={s.who} placeholder="nosso" onChange={(e) => setSubs((m) => ({ ...m, [pc.key]: { ...s, who: e.target.value } }))}
                style={{ ...input, width: 118, padding: "7px 9px", fontSize: 12.5, background: s.who ? C.sunSoft : "#F7F9FC" }} />
            </div>
          );
        })}
      </div>

      <div style={{ background: "#F5F7FB", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, color: C.sub, lineHeight: 1.6 }}>
        <div><b style={{ color: C.ink, fontWeight: 600 }}>{plan.count}</b> lançamentos novos em {ymLabel(month)}{plan.skipped ? `, ${plan.skipped} já estavam no app e serão ignorados` : ""}.</div>
        {plan.thirdCount > 0 && <div>{plan.thirdCount} vão para cobranças de terceiros.</div>}
        {plan.uncategorized > 0 && <div>{plan.uncategorized} ficam sem categoria para você revisar.</div>}
        {Object.keys(plan.updates).length > 0 && <div>{Object.keys(plan.updates).length} parcelas já lançadas em meses seguintes foram reconhecidas.</div>}
        {month !== dueYm && <div style={{ color: "#7A5B1E" }}>Atenção: o vencimento é em {ymLabel(dueYm)}.</div>}
      </div>

      <button onClick={() => setShowLines(!showLines)} style={{ ...iconbtn, display: "inline-flex", gap: 4, alignSelf: "flex-start", fontSize: 12, color: C.sub, fontFamily: "inherit" }}>{showLines ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {showLines ? "esconder" : "ver"} lançamentos</button>
      {showLines && (
        <div style={{ maxHeight: 280, overflowY: "auto", borderTop: `1px solid ${C.line}` }}>
          {plan.add.map((t) => {
            const owner = data.cards.find((c) => c.id === cardId);
            const who = [...(owner?.subs || []), ...plan.newSubs].find((x) => x.id === t.sub)?.who;
            return (
              <div key={t.id} style={{ display: "flex", gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.line}`, fontSize: 12 }}>
                <span style={{ color: C.faint, width: 38 }}>{ddmm(t.date)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>{t.desc}{(t.parcels || 1) > 1 ? ` (${t.parcel}/${t.parcels})` : ""}<span style={{ color: who ? C.sun : C.faint }}> {who ? `de ${who}` : t.cat ? catName(t.cat) : "sem categoria"}</span></span>
                <span style={{ whiteSpace: "nowrap" }}>{brl(t.amount)}</span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onCancel} style={{ ...btn, flex: 1, justifyContent: "center" }}>descartar</button>
        <button onClick={go} disabled={!plan.count && cardId !== "__novo"} style={{ ...dark, flex: 2, justifyContent: "center", opacity: plan.count ? 1 : 0.5 }}>importar {plan.count} lançamentos</button>
      </div>
    </div>
  );
}

// ================= Parcelas =================
function ParcelasView({ data, ym, catOf }) {
  const [showDone, setShowDone] = useState(false);
  const rows = [
    ...data.installments.map((it) => ({ id: it.id, name: it.name, where: "fora do cartão", amount: it.amount, total: it.total, start: it.first, end: ymAdd(it.first, it.total - 1), cat: it.cat })),
    ...data.txs.filter((t) => (t.parcels || 1) > 1 && !t.anticipated).map((t) => {
      const c = data.cards.find((x) => x.id === t.cardId); const s = subOf(c, t.sub);
      return { id: t.id, name: t.desc, where: c?.name || "cartão", who: s?.who, amount: t.amount, total: t.parcels, start: ymAdd(t.month, -((t.parcel || 1) - 1)), end: txEnd(t), cat: t.cat };
    }),
  ].map((r) => {
    const cur = ymDiff(r.start, ym) + 1;
    const active = cur >= 1 && cur <= r.total, future = cur < 1;
    const remaining = active ? r.total - cur + 1 : future ? r.total : 0; // inclui a parcela deste mês
    return { ...r, cur, active, future, left: remaining * r.amount };
  });
  const active = rows.filter((r) => r.active || r.future).sort((a, b) => a.end.localeCompare(b.end));
  const done = rows.filter((r) => !r.active && !r.future);
  const mensal = sum(rows.filter((r) => r.active && !r.who));
  const saldo = sum(rows.filter((r) => !r.who), (r) => r.left);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div style={{ background: "#EBEFF6", borderRadius: 11, padding: "11px 13px" }}><div style={{ fontSize: 11.5, color: C.sub }}>Parcelas em {ymLabel(ym)}</div><div className="lar-display" style={{ fontSize: 19, fontWeight: 600 }}>{brl(mensal)}</div></div>
        <div style={{ background: "#EBEFF6", borderRadius: 11, padding: "11px 13px" }}><div style={{ fontSize: 11.5, color: C.sub }}>Ainda a pagar (com este mês)</div><div className="lar-display" style={{ fontSize: 19, fontWeight: 600 }}>{brl(saldo)}</div></div>
      </div>
      <div style={{ fontSize: 11.5, color: C.faint, margin: "8px 2px 0" }}>Os totais não incluem parcelas de adicionais de terceiros.</div>
      <Title icon={Layers}>Em andamento</Title>
      {active.length === 0 && <div style={{ ...card, padding: 16, fontSize: 12.5, color: C.faint, borderStyle: "dashed" }}>Nenhum parcelamento ativo neste mês.</div>}
      {active.map((r) => (
        <div key={r.id} style={{ ...card, padding: "12px 14px", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 500, flex: 1 }}>{r.name}</span>
            <span style={{ fontSize: 13.5, fontWeight: 500 }}>{brl(r.amount)}/mês</span>
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 5, alignItems: "center" }}>
            <Pill>{r.where}</Pill>
            {r.who && <Pill color={C.sun} soft={C.sunSoft}>de {r.who}</Pill>}
            {r.cat && <span style={{ fontSize: 11.5, color: C.faint, display: "inline-flex", alignItems: "center", gap: 4 }}><Dot color={catOf(r.cat).color} s={6} />{catOf(r.cat).name}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 9 }}>
            <div style={{ flex: 1, height: 6, background: "#EBEFF6", borderRadius: 99, overflow: "hidden" }}><div style={{ width: `${(Math.max(0, r.cur) / r.total) * 100}%`, height: "100%", background: C.accent }} /></div>
            <span style={{ fontSize: 11.5, color: C.sub, whiteSpace: "nowrap" }}>{r.future ? `começa em ${ymLabel(r.start)}` : `${r.cur}/${r.total}, termina em ${ymLabel(r.end)}`}</span>
          </div>
        </div>
      ))}
      {done.length > 0 && <>
        <button onClick={() => setShowDone(!showDone)} style={{ ...btn, width: "100%", justifyContent: "space-between", marginTop: 10, background: "transparent", border: "none", color: C.faint }}><span>{done.length} quitados</span>{showDone ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
        {showDone && done.map((r) => <div key={r.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: C.faint, padding: "6px 4px" }}><span>{r.name}</span><span>terminou em {ymLabel(r.end)}</span></div>)}
      </>}
    </div>
  );
}

// ================= Cobranças (receber de terceiros) =================
function CobrancasView({ data, ym, patchMonth, say, people }) {
  const items = useMemo(() => cobrancasOf(data, ym), [data, ym]);
  const [adding, setAdding] = useState(false);
  const [who, setWho] = useState(""); const [desc, setDesc] = useState(""); const [val, setVal] = useState("");
  const byWho = {};
  items.forEach((it) => { (byWho[it.who] = byWho[it.who] || []).push(it); });
  const names = Object.keys(byWho).sort((a, b) => sum(byWho[b]) - sum(byWho[a]));
  // pendências de meses anteriores (até 12 meses)
  const older = useMemo(() => {
    const out = {};
    for (let i = 1; i <= 12; i++) {
      const y = ymAdd(ym, -i);
      cobrancasOf(data, y).filter((x) => !x.received).forEach((x) => { out[x.who] = out[x.who] || { amount: 0, months: new Set() }; out[x.who].amount += x.amount; out[x.who].months.add(y); });
    }
    return out;
  }, [data, ym]);

  const toggle = (key) => patchMonth(ym, (mo) => ({ ...mo, received: { ...mo.received, [key]: !mo.received[key] } }));
  const allReceived = (name, val2) => patchMonth(ym, (mo) => { const r = { ...mo.received }; byWho[name].forEach((it) => { r[it.key] = val2; }); return { ...mo, received: r }; });
  const message = (name) => {
    const list = byWho[name];
    const lines = list.map((it) => `- ${it.date ? ddmm(it.date) + " " : ""}${it.desc}${it.parcel ? ` (parcela ${it.parcel})` : ""}: ${brl(it.amount)}`);
    return `Oi, ${name}! Seguem os valores de ${ymLabel(ym)}:\n${lines.join("\n")}\nTotal: ${brl(sum(list))}`;
  };
  const copy = async (name) => { try { await navigator.clipboard.writeText(message(name)); say("Mensagem copiada"); } catch (e) { say("Não deu para copiar neste navegador"); } };
  const addManual = () => {
    const a = parseMoney(val); if (!who.trim() || !desc.trim() || a == null) return;
    patchMonth(ym, (mo) => ({ ...mo, receivables: [...mo.receivables, { id: uid(), who: who.trim(), desc: desc.trim(), amount: a }] }));
    setWho(""); setDesc(""); setVal(""); setAdding(false); say("Cobrança adicionada");
  };
  const delManual = (id) => patchMonth(ym, (mo) => ({ ...mo, receivables: mo.receivables.filter((r) => r.id !== id) }));

  return (
    <div>
      <div style={{ ...card, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5, color: C.sub }}>A receber em {ymLabel(ym)}</div>
          <div className="lar-display" style={{ fontSize: 24, fontWeight: 600 }}>{brl(sum(items))}</div>
          <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>{brl(sum(items.filter((i) => i.received)))} já recebido</div>
        </div>
        <button onClick={() => setAdding(!adding)} style={dark}><Plus size={14} /> cobrança</button>
      </div>
      {adding && (
        <div style={{ ...card, padding: 14, marginTop: 10, display: "flex", flexDirection: "column", gap: 10, borderStyle: "dashed", borderColor: C.accent }}>
          <div style={{ fontSize: 12.5, color: C.sub }}>Algo que alguém te deve e não está ligado a um lançamento específico. Para dividir uma compra do cartão, use o botão de pessoas no lançamento.</div>
          <div style={{ display: "flex", gap: 8 }}>
            <Field label="Quem"><input style={input} list="fin-people" value={who} onChange={(e) => setWho(e.target.value)} autoFocus /></Field>
            <Field label="Valor"><input style={input} inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} placeholder="0,00" /></Field>
          </div>
          <Field label="Do que é"><input style={input} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ingresso do show" /></Field>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setAdding(false)} style={{ ...btn, flex: 1, justifyContent: "center" }}>cancelar</button>
            <button onClick={addManual} style={{ ...dark, flex: 2, justifyContent: "center" }}>adicionar</button>
          </div>
        </div>
      )}

      {names.length === 0 && <div style={{ ...card, padding: 16, marginTop: 14, fontSize: 12.5, color: C.faint, borderStyle: "dashed", lineHeight: 1.5 }}>Nada a cobrar neste mês. Entram aqui sozinhos os lançamentos de cartões adicionais de outra pessoa, os cartões emprestados e as compras que você dividiu.</div>}
      {names.map((name) => {
        const list = byWho[name]; const tot = sum(list); const got = sum(list.filter((i) => i.received)); const done = got >= tot && tot > 0;
        return (
          <div key={name} style={{ ...card, padding: "13px 15px", marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span className="lar-display" style={{ fontSize: 16, fontWeight: 600, flex: 1 }}>{name}</span>
              <span style={{ fontSize: 15, fontWeight: 600, color: done ? C.good : C.ink }}>{brl(tot)}</span>
            </div>
            <div style={{ fontSize: 11.5, color: done ? C.good : C.faint, marginTop: 2 }}>{done ? "tudo recebido" : got ? `${brl(got)} recebido, falta ${brl(tot - got)}` : "nada recebido ainda"}</div>
            <div style={{ marginTop: 8 }}>
              {list.map((it) => (
                <div key={it.key} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 0", borderTop: `1px solid ${C.line}` }}>
                  <button onClick={() => toggle(it.key)} aria-label="Recebido" style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, cursor: "pointer", display: "grid", placeItems: "center", border: `2px solid ${it.received ? C.good : "#C9D1DF"}`, background: it.received ? C.good : "transparent" }}>{it.received && <Check size={11} color="#fff" />}</button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: it.received ? C.faint : C.ink }}>{it.desc}{it.parcel ? ` (${it.parcel})` : ""}</div>
                    <div style={{ fontSize: 11, color: C.faint }}>{[it.date && ddmm(it.date), it.origin].filter(Boolean).join(", ")}</div>
                  </div>
                  <span style={{ fontSize: 13, whiteSpace: "nowrap" }}>{brl(it.amount)}</span>
                  {it.rcvId && !it.txId && <button onClick={() => delManual(it.rcvId)} style={iconbtn} aria-label="Apagar"><X size={13} /></button>}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              <button onClick={() => copy(name)} style={btn}><Copy size={13} /> copiar mensagem</button>
              <a href={`https://wa.me/?text=${encodeURIComponent(message(name))}`} target="_blank" rel="noreferrer" style={{ ...btn, textDecoration: "none" }}><Send size={13} /> WhatsApp</a>
              <button onClick={() => allReceived(name, !done)} style={{ ...btn, marginLeft: "auto", color: done ? C.sub : C.good }}>{done ? "desmarcar" : "recebi tudo"}</button>
            </div>
          </div>
        );
      })}

      {Object.keys(older).length > 0 && <>
        <Title>Pendentes de meses anteriores</Title>
        <div style={{ ...card, padding: "4px 15px" }}>
          {Object.entries(older).map(([name, o], i, arr) => (
            <div key={name} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "10px 0", borderBottom: i < arr.length - 1 ? `1px solid ${C.line}` : "none" }}>
              <span style={{ fontSize: 13.5, flex: 1 }}>{name}</span>
              <span style={{ fontSize: 11.5, color: C.faint }}>{[...o.months].sort().map(ymLabel).join(", ")}</span>
              <span style={{ fontSize: 13.5, fontWeight: 500, color: C.bad }}>{brl(o.amount)}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: C.faint, margin: "6px 2px" }}>Volte o mês no topo para marcar como recebido.</div>
      </>}
    </div>
  );
}

// ================= Cadastros =================
function CadastrosView({ data, update, say, email }) {
  const [editCard, setEditCard] = useState(null); // id | "new"
  const [newCat, setNewCat] = useState("");
  const [bal, setBal] = useState(toInput(data.savings.balance));
  useEffect(() => { setBal(toInput(data.savings.balance)); }, [data.savings.balance]);
  const saveBalance = () => {
    const v = parseMoney(bal); if (v == null || v === data.savings.balance) return;
    const today = isoToday();
    update((d) => ({ ...d, savings: { balance: v, updatedAt: today, history: [{ date: today, balance: v }, ...(d.savings.history || []).filter((h) => h.date !== today)].slice(0, 24) } }));
    say("Saldo atualizado");
  };
  const usedCat = (id) => data.txs.some((t) => t.cat === id) || data.recurring.some((r) => r.cat === id) || data.installments.some((i) => i.cat === id) || Object.values(data.months).some((m) => (m.extras || []).some((e) => e.cat === id)) || data.cards.some((c) => c.cat === id);
  const addCat = () => { const n = newCat.trim(); if (!n) return; update((d) => ({ ...d, categories: [...d.categories, { id: uid(), name: n, color: CAT_COLORS[d.categories.length % CAT_COLORS.length] }] })); setNewCat(""); };
  const renameCat = (id, name) => update((d) => ({ ...d, categories: d.categories.map((c) => (c.id === id ? { ...c, name } : c)) }));
  const recolor = (id) => update((d) => ({ ...d, categories: d.categories.map((c) => (c.id === id ? { ...c, color: CAT_COLORS[(CAT_COLORS.indexOf(c.color) + 1) % CAT_COLORS.length] } : c)) }));
  const delCat = (id) => {
    if (usedCat(id) && !window.confirm("Essa categoria está em uso. Os itens dela ficam sem categoria. Apagar mesmo assim?")) return;
    const strip = (x) => (x.cat === id ? { ...x, cat: null } : x);
    update((d) => ({ ...d, categories: d.categories.filter((c) => c.id !== id), txs: d.txs.map(strip), recurring: d.recurring.map(strip), installments: d.installments.map(strip), cards: d.cards.map(strip),
      months: Object.fromEntries(Object.entries(d.months).map(([k, m]) => [k, { ...m, extras: (m.extras || []).map(strip) }])) }));
  };

  return (
    <div>
      <Title icon={PiggyBank} color={C.accent}>Reserva na XP</Title>
      <div style={{ ...card, padding: "14px 15px" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <Field label="Saldo atual"><input style={input} inputMode="decimal" value={bal} onChange={(e) => setBal(e.target.value)} onBlur={saveBalance} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} placeholder="0,00" /></Field>
        </div>
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 7 }}>{data.savings.updatedAt ? `Atualizado em ${ddmm(data.savings.updatedAt)}/${data.savings.updatedAt.slice(0, 4)}` : "Ainda não informado"}</div>
        {(data.savings.history || []).length > 1 && (
          <div style={{ marginTop: 10 }}>
            {data.savings.history.slice(1, 5).map((h) => <div key={h.date} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.faint, padding: "2px 0" }}><span>{ddmm(h.date)}/{h.date.slice(0, 4)}</span><span>{brl(h.balance)}</span></div>)}
          </div>
        )}
      </div>

      <Title icon={CreditCard} color={C.accent} right={<button onClick={() => setEditCard(editCard === "new" ? null : "new")} style={{ ...btn, padding: "5px 10px", fontSize: 12 }}><Plus size={13} /> cartão</button>}>Cartões</Title>
      {editCard === "new" && <CardForm onCancel={() => setEditCard(null)} cats={data.categories} onSave={(c) => { update((d) => ({ ...d, cards: [...d.cards, { id: uid(), ...c }] })); setEditCard(null); say("Cartão adicionado"); }} />}
      {data.cards.length === 0 && editCard !== "new" && <div style={{ ...card, padding: 16, fontSize: 12.5, color: C.faint, borderStyle: "dashed" }}>Nenhum cartão ainda.</div>}
      {data.cards.map((c) => editCard === c.id
        ? <CardForm key={c.id} initial={c} cats={data.categories} onCancel={() => setEditCard(null)} onSave={(p) => { update((d) => ({ ...d, cards: d.cards.map((x) => (x.id === c.id ? { ...x, ...p } : x)) })); setEditCard(null); }}
            onArchive={() => { update((d) => ({ ...d, cards: d.cards.map((x) => (x.id === c.id ? { ...x, archived: !x.archived } : x)) })); setEditCard(null); }} />
        : (
          <div key={c.id} onClick={() => setEditCard(c.id)} style={{ ...card, padding: "11px 14px", marginBottom: 8, cursor: "pointer", opacity: c.archived ? 0.6 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CreditCard size={15} color={C.sub} /><span style={{ fontSize: 13.5, fontWeight: 500, flex: 1 }}>{c.name}</span>
              {c.archived && <Pill>arquivado</Pill>}
              <Pencil size={13} color={C.faint} />
            </div>
            <div style={{ fontSize: 11.5, color: C.faint, marginTop: 4 }}>
              {c.mode === "so_fatura" ? `Só o valor da fatura${c.usedBy ? `, cobrado de ${c.usedBy}` : ""}` : `Lançamentos detalhados${(c.subs || []).length ? `, ${c.subs.map((s) => `${s.label || "sem final"}${s.who ? ` (${s.who})` : ""}`).join(", ")}` : ""}`}
            </div>
          </div>
        ))}

      <Title>Categorias</Title>
      <div style={{ ...card, padding: "6px 15px" }}>
        {data.categories.map((c) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 0", borderBottom: `1px solid ${C.line}` }}>
            <button onClick={() => recolor(c.id)} title="Trocar cor" style={{ width: 16, height: 16, borderRadius: 5, background: c.color, border: "none", cursor: "pointer", flexShrink: 0 }} />
            <input value={c.name} onChange={(e) => renameCat(c.id, e.target.value)} style={{ ...input, background: "transparent", border: "1px solid transparent", padding: "5px 6px" }} />
            <button onClick={() => delCat(c.id)} style={iconbtn} aria-label={`Apagar ${c.name}`}><Trash2 size={14} /></button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, padding: "10px 0" }}>
          <input style={input} placeholder="Nova categoria" value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCat()} />
          <button onClick={addCat} style={dark}>adicionar</button>
        </div>
      </div>

      <div style={{ marginTop: 22, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 12, color: C.faint }}>
        <span>Conectado como {email}</span>
        <button onClick={() => supabase.auth.signOut()} style={{ ...iconbtn, display: "inline-flex", gap: 4, fontSize: 12, fontFamily: "inherit", color: C.sub }}><LogOut size={13} /> sair</button>
      </div>
    </div>
  );
}

function CardForm({ initial, cats, onSave, onCancel, onArchive }) {
  const [name, setName] = useState(initial?.name || "");
  const [mode, setMode] = useState(initial?.mode || "detalhado");
  const [usedBy, setUsedBy] = useState(initial?.usedBy || "");
  const [cat, setCat] = useState(initial?.cat || "");
  const [subs, setSubs] = useState(initial?.subs || []);
  const save = () => { if (!name.trim()) return; onSave({ name: name.trim(), mode, usedBy: mode === "so_fatura" ? usedBy.trim() : "", cat: mode === "so_fatura" ? cat || null : null, subs: mode === "detalhado" ? subs.map((s) => ({ ...s, label: s.label.trim(), who: s.who.trim() })) : [] }); };
  const setSub = (id, patch) => setSubs((l) => l.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  return (
    <div style={{ ...card, padding: 14, marginBottom: 10, display: "flex", flexDirection: "column", gap: 10, borderStyle: "dashed", borderColor: C.accent }}>
      <Field label="Nome do cartão"><input style={input} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nubank Rafa" /></Field>
      <Seg value={mode} onChange={setMode} options={[["detalhado", "Lançamentos detalhados"], ["so_fatura", "Só o valor da fatura"]]} />
      {mode === "so_fatura" && <>
        <div style={{ fontSize: 11.5, color: C.faint }}>Para cartão emprestado: você só informa o total da fatura todo mês, sem lançamentos.</div>
        <div style={{ display: "flex", gap: 8 }}>
          <Field label="Quem usa (vira cobrança)"><input style={input} list="fin-people" value={usedBy} onChange={(e) => setUsedBy(e.target.value)} placeholder="vazio se for de vocês" /></Field>
          {!usedBy.trim() && <Field label="Categoria"><CatSelect cats={cats} value={cat} onChange={setCat} /></Field>}
        </div>
      </>}
      {mode === "detalhado" && <>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 2 }}>Cartões dentro desta fatura</div>
        <div style={{ fontSize: 11.5, color: C.faint, lineHeight: 1.45 }}>Separe pelo final do cartão, não pelo nome impresso na fatura. Se o adicional é de outra pessoa, preencha de quem é: tudo dele vira cobrança e não entra nos gastos de vocês.</div>
        {subs.map((s) => (
          <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input style={{ ...input, flex: 1 }} value={s.label} onChange={(e) => setSub(s.id, { label: e.target.value })} placeholder="final 1234" />
            <input style={{ ...input, flex: 1 }} list="fin-people" value={s.who} onChange={(e) => setSub(s.id, { who: e.target.value })} placeholder="de quem (vazio = nosso)" />
            <button onClick={() => setSubs((l) => l.filter((x) => x.id !== s.id))} style={iconbtn} aria-label="Remover"><X size={14} /></button>
          </div>
        ))}
        <button onClick={() => setSubs((l) => [...l, { id: uid(), label: "", who: "" }])} style={{ ...btn, alignSelf: "flex-start", padding: "5px 10px", fontSize: 12 }}><Plus size={13} /> cartão final ou adicional</button>
      </>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {onArchive && <button onClick={onArchive} style={{ ...btn, color: C.sub }}>{initial?.archived ? "desarquivar" : "arquivar"}</button>}
        <button onClick={onCancel} style={{ ...btn, marginLeft: "auto" }}>cancelar</button>
        <button onClick={save} style={dark}>salvar</button>
      </div>
    </div>
  );
}

// exportado para testes
export { computeMonth, cobrancasOf, spendByCat, recAmount, txOcc, parseMoney, normalize, RevisarFatura };
