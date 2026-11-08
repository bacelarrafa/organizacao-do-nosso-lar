// =========================================================
// Transforma uma fatura lida (parsers.js) em lançamentos do módulo Finanças.
// Cuida de três coisas:
//  1. Categoria sugerida: primeiro o que vocês já usaram para a mesma descrição,
//     depois regras por palavra-chave, depois a categoria que o banco informa.
//  2. Cartões dentro da fatura (finais e adicionais) viram "subs" do cartão.
//  3. Nada duplica: reimportar a mesma fatura não repete lançamentos, e uma
//     compra parcelada que já veio de outro mês não vira uma compra nova.
// =========================================================

const pad = (n) => String(n).padStart(2, "0");
const ymAdd = (ym, n) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const ymDiff = (a, b) => { const [ay, am] = a.split("-").map(Number); const [by, bm] = b.split("-").map(Number); return (by - ay) * 12 + (bm - am); };
const occurs = (t, ym) => {
  const i = ymDiff(t.month, ym);
  if (t.anticipated) return i === 0;
  return i >= 0 && (t.parcel || 1) + i <= (t.parcels || 1);
};
const norm = (s) => (s || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
// Palavras que querem dizer "é do casal", nunca nome de pessoa
const OURS = /^(nosso|nossa|nós|nos|casal|eu|meu|minha|de nosso|da gente)$/i;
export const cleanWho = (w) => { const s = (w || "").trim(); return OURS.test(s) ? "" : s; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// A ordem importa: a primeira regra que bate decide.
const RULES = [
  [/MERCADOLIVRE|MERCADO LIVRE|MERCADO\*MERCADO|MELIMAIS/, "compras"],
  [/IFD\*|IFOOD|KEETA|KEE\*|99FOOD|RAPPI|AIQFOME|ZE DELIVERY/, "delivery"],
  [/99 ?RIDE|\*99\b|UBER|CABIFY|SPTRANS|BILHETE UNICO|METRO SP|CPTM/, "transporte"],
  [/POSTO|SHELL|IPIRANGA|PETROBRAS|ESTAPAR|ESTACIONA|SEM PARAR|CONECTCAR|VELOE|ZONA AZUL/, "carro"],
  [/SUPERMERC|MINIMERC|MERCADINHO|MERCATO|ATACAD|ASSAI|CARREFOUR|PAO DE ACUCAR|SONDA|SATO SUPER|ZAFFARI|HORTIFRUTI|OXXO|TAKARA|MERCADO VIOLETA|DIA BRASIL/, "mercado"],
  [/DROGA|FARMA|PANVEL|RAIA|PACHECO|DENTIST|CLINICA|LABORAT|HOSPITAL|PAGUEMENO/, "saude"],
  [/PET ?LOVE|PETZ|COBASI|VETERIN/, "pets"],
  [/NETFLIX|SPOTIFY|AMAZON ?PRIME|PRIME CANAIS|AMAZONPRIMEBR|GOOGLE ONE|YOUTUBE|DISNEY|HBO|GLOBOPLAY|APPLE\.COM|^TIM\*|VIVO|CLARO|LAVANDERIA/, "contas"],
  [/RESTAUR|LANCH|PIZZ|GRILL|DOCERIA|PASTELARIA|PADARIA|CAFE|BURGER|GRINDHOUSE|MADERO|KRISPY|DELI\b|ARCOS DOURADOS|BOMBONIERE/, "restaurantes"],
  [/INGRESSO|EVENTIM|SYMPLA|T4F|UHUU|CINEMA|CINEMARK|PLAYLAND|RI HAPPY/, "lazer"],
  [/ANUIDADE|ENCARGOS|JUROS|IOF|TARIFA/, "impostos"],
  [/SHEIN|SHOPEE|AMAZON|RENNER|RIACHUELO|HERING|ZARA|MAGALU|PERNAMBUCANAS|TIKTOK SHOP|LOJAS|MALWEE|WEPINK|GRANADO|LOCCITANE|NUUVEM/, "compras"],
  [/ELECTROLUX|LE CREUSET|TANOARIA|CASA PAI|JUNTACOZINHA|TOK ?STOK|LEROY|ETNA/, "eletros"],
];
const BANK_CATS = { supermercado: "mercado", restaurante: "restaurantes", "saúde": "saude", veiculos: "carro", "veículos": "carro", encargos: "impostos" };

export function suggestCategory(desc, bankCat, data) {
  const has = (id) => data.categories.some((c) => c.id === id);
  const d = norm(desc);
  // 1. o que vocês já escolheram para essa mesma descrição (o mais recente)
  const learned = [...data.txs].reverse().find((t) => t.cat && norm(t.desc) === d);
  if (learned && has(learned.cat)) return learned.cat;
  // 2. palavras-chave
  for (const [re, cat] of RULES) if (re.test(d) && has(cat)) return cat;
  // 3. categoria do banco
  const b = BANK_CATS[bankCat];
  return b && has(b) ? b : null;
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);
const firstWord = (s) => (s || "").trim().split(/\s+/)[0] || "";

// Cartão cadastrado mais provável para esta fatura
export function guessCard(data, parsed) {
  const strip = (s) => norm(s).replace(/[^A-Z0-9 ]/g, "");
  const cards = data.cards.filter((c) => c.mode !== "so_fatura" && !c.archived);
  const keys = [...parsed.cards.map((c) => c.key), parsed.cardFinal].filter((k) => k && /^\d{4}$/.test(k));
  if (parsed.cardFinal) { const byName = cards.find((c) => c.name.includes(parsed.cardFinal)); if (byName) return byName.id; }
  const byFinal = cards.find((c) => (c.subs || []).some((s) => keys.some((k) => (s.label || "").includes(k))));
  if (byFinal) return byFinal.id;
  const byBank = cards.find((c) => strip(c.name).includes(strip(parsed.bankName).split(" ")[0]));
  return byBank ? byBank.id : null;
}

// Para cada cartão dentro da fatura: qual sub usar e de quem é (vazio = de vocês)
export function guessSubs(data, parsed, cardId, people = [], ourNames = []) {
  const card = data.cards.find((c) => c.id === cardId);
  const ours = ourNames.map((n) => norm(firstWord(n)));
  // titular: alguém do casal, se aparecer; senão, o primeiro portador da fatura
  const titular = (parsed.cards.map((c) => norm(firstWord(c.holder))).find((w) => ours.includes(w))) || norm(firstWord(parsed.cards[0]?.holder));
  const out = {};
  parsed.cards.forEach((pc) => {
    if (pc.key === "principal") { out[pc.key] = { subId: null, none: true, label: "sem final", who: "" }; return; }
    const existing = (card?.subs || []).find((s) => (s.label || "").includes(pc.key));
    if (existing) { out[pc.key] = { subId: existing.id, label: existing.label, who: cleanWho(existing.who) }; return; }
    const fw = norm(firstWord(pc.holder));
    let who = "";
    if (pc.holder && titular && fw && fw !== titular && !ours.includes(fw)) {
      who = people.find((p) => norm(p).startsWith(fw)) || cap(fw);
    }
    out[pc.key] = { subId: null, label: /^\d{4}$/.test(pc.key) ? `final ${pc.key}` : pc.key, who };
  });
  return out;
}

// Mês da fatura (o do vencimento) em que uma compra cai, pelo dia de fechamento e de vencimento do cartão.
export function faturaMonthOf(card, dateIso) {
  if (!dateIso) return null;
  const fech = Number(card?.fechamento) || 0, venc = Number(card?.vencimento) || 0;
  const [y, m, d] = dateIso.split("-").map(Number);
  let ym = `${y}-${pad(m)}`;
  if (!fech) return ym;
  if (d > fech) ym = ymAdd(ym, 1);          // passou do fechamento: vai para o próximo ciclo
  if (venc && venc <= fech) ym = ymAdd(ym, 1); // vence no mês seguinte ao fechamento (ex.: Itaú fecha 30, vence 7)
  return ym;
}

const near = (a, b, days) => {
  if (!a || !b) return true;
  return Math.abs((new Date(a + "T00:00:00") - new Date(b + "T00:00:00")) / 86400000) <= days;
};
const cents = (v) => Math.round(v * 100);
// Duas descrições "parecidas" (prints e fatura escrevem diferente): basta uma palavra relevante em comum
const words = (s) => norm(s).replace(/[^A-Z0-9 ]/g, " ").split(" ").filter((w) => w.length >= 4);
const similar = (a, b) => { const wa = new Set(words(a)); return words(b).some((w) => wa.has(w) || [...wa].some((x) => x.startsWith(w) || w.startsWith(x))); };

// Monta o que vai ser gravado. Não altera "data".
//   mode "fatura": PDF de fechamento. Concilia as prévias do mês e vira a versão oficial.
//   mode "previa": prints ou OFX no meio do mês. Entra marcado como prévia.
export function planImport(data, parsed, { cardId, month, subs, mode = "fatura" }) {
  const card = data.cards.find((c) => c.id === cardId);
  const newSubs = [];
  const subIdOf = {};
  Object.entries(subs || {}).forEach(([key, s]) => {
    if (s.subId) { subIdOf[key] = s.subId; return; }
    if (s.none) { subIdOf[key] = null; return; } // prints e OFX sem final: não cria cartão interno
    const id = uid();
    subIdOf[key] = id;
    newSubs.push({ id, label: s.label, who: cleanWho(s.who) });
  });
  const whoOfKey = (key) => cleanWho(subs?.[key]?.who);

  const pool = data.txs.filter((t) => t.cardId === cardId).map((t) => ({ ...t })); // cópia para simular
  const updates = {};
  const add = [];
  let skipped = 0, reconciled = 0;
  const used = new Set(); // prévias já casadas nesta importação

  // contagem de avulsos já existentes neste mês (para permitir lançamentos iguais legítimos, ex.: 5x lavanderia no mesmo dia)
  const oneKey = (sub, date, desc, amount, parcel, parcels) => `${sub}|${date}|${norm(desc)}|${cents(amount)}|${parcel}|${parcels}`;
  const existingCount = {};
  pool.forEach((t) => {
    if (t.month !== month || t.prev) return;
    if ((t.parcels || 1) > 1 && !t.anticipated) return;
    const k = oneKey(t.sub || "", t.date, t.desc, t.amount, t.parcel || 1, t.parcels || 1);
    existingCount[k] = (existingCount[k] || 0) + 1;
  });

  // Parcela de compra antiga que já está no app e cai neste mês (vale para prints e OFX, que trazem a data de outro jeito)
  const coveredParcel = (l, sub) => {
    if (!(l.parcels > 1) || l.anticipated) return null;
    const tol = Math.max(0.1, Math.abs(l.amount) * 0.02);
    return [...pool, ...add].find((t) => !used.has(t.id) && (t.parcels || 1) === l.parcels && !t.anticipated && Math.abs(t.amount - l.amount) <= tol
      && (sub == null || t.sub == null || t.sub === sub) && occurs(t, month) && (t.parcel || 1) + ymDiff(t.month, month) === l.parcel
      && (similar(t.desc, l.desc) || t.date === l.date));
  };

  parsed.lines.forEach((l) => {
    const sub = subIdOf[l.key] ?? null;
    const third = !!whoOfKey(l.key);
    const base = { cardId, sub, date: l.date, desc: l.desc, amount: l.amount, parcel: l.parcel, parcels: l.parcels, cat: third ? null : suggestCategory(l.desc, l.bankCat, data) };

    // ---- prévia (prints / OFX)
    if (mode === "previa") {
      if (coveredParcel(l, sub)) { skipped++; return; }
      // a mesma compra já veio num print anterior, ou a fatura já foi importada
      const dup = pool.find((t) => !used.has(t.id) && t.month === month && cents(t.amount) === cents(l.amount)
        && (t.parcel || 1) === l.parcel && (t.parcels || 1) === l.parcels && near(t.date, l.date, t.prev ? 0 : 4)
        && (t.prev ? norm(t.desc) === norm(l.desc) : true));
      if (dup) { used.add(dup.id); skipped++; return; }
      add.push({ id: uid(), month, ...base, prev: true, ...(l.anticipated ? { anticipated: true } : {}) });
      return;
    }

    // ---- fatura (PDF): primeiro tenta casar com uma prévia do mês
    const pv = pool.find((t) => t.prev && !used.has(t.id) && t.month === month && cents(t.amount) === cents(l.amount)
      && ((l.parcels > 1 && (t.parcels || 1) === l.parcels && (t.parcel || 1) === l.parcel) || near(t.date, l.date, 4)));
    if (pv) {
      used.add(pv.id); reconciled++;
      updates[pv.id] = { desc: l.desc, date: l.date, parcel: l.parcel, parcels: l.parcels, sub: sub ?? pv.sub ?? null, prev: false,
        anticipated: l.anticipated ? true : undefined, cat: pv.cat || base.cat };
      return;
    }
    if (l.parcels > 1 && !l.anticipated) {
      const start = ymAdd(month, -(l.parcel - 1));
      const tol = Math.max(0.1, Math.abs(l.amount) * 0.02);
      const e = [...pool, ...add].find((t) => !t.prev && (sub == null || t.sub == null || t.sub === sub) && t.parcels === l.parcels && !t.anticipated && t.date === l.date
        && norm(t.desc) === norm(l.desc) && Math.abs(t.amount - l.amount) <= tol && ymAdd(t.month, -((t.parcel || 1) - 1)) === start);
      if (e) {
        if (!occurs(e, month) && e.month > month) { // já existia a partir de um mês seguinte: puxa o início para este mês
          e.month = month; e.parcel = l.parcel;
          if (e.id) updates[e.id] = { ...(updates[e.id] || {}), month, parcel: l.parcel };
        }
        skipped++; return;
      }
      add.push({ id: uid(), month, ...base });
      return;
    }
    const k = oneKey(sub || "", l.date, l.desc, l.amount, l.parcel, l.parcels);
    if (existingCount[k] > 0) { existingCount[k]--; skipped++; return; }
    add.push({ id: uid(), month, ...base, ...(l.anticipated ? { anticipated: true } : {}) });
  });

  // prévias do mês que não apareceram na fatura oficial
  const leftover = mode === "fatura" ? pool.filter((t) => t.prev && t.month === month && !used.has(t.id)) : [];
  const third = add.filter((t) => { const s = [...(card?.subs || []), ...newSubs].find((x) => x.id === t.sub); return s && s.who; });
  return {
    newSubs, add, updates, skipped, reconciled, leftover, removeIds: [],
    count: add.length, thirdCount: third.length,
    uncategorized: add.filter((t) => !t.cat && !third.includes(t)).length,
  };
}

// Aplica o plano nos dados (função pura: devolve os dados novos)
export function applyPlan(data, cardId, plan) {
  const rm = new Set(plan.removeIds || []);
  return {
    ...data,
    cards: data.cards.map((c) => (c.id === cardId ? { ...c, subs: [...(c.subs || []), ...plan.newSubs] } : c)),
    txs: [...data.txs.filter((t) => !rm.has(t.id)).map((t) => {
      const u = plan.updates[t.id]; if (!u) return t;
      const n = { ...t, ...u };
      Object.keys(n).forEach((k) => n[k] === undefined && delete n[k]);
      return n;
    }), ...plan.add],
  };
}
