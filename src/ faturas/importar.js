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
  const keys = parsed.cards.map((c) => c.key);
  const byFinal = cards.find((c) => (c.subs || []).some((s) => keys.some((k) => (s.label || "").includes(k))));
  if (byFinal) return byFinal.id;
  const byBank = cards.find((c) => strip(c.name).includes(strip(parsed.bankName).split(" ")[0]));
  return byBank ? byBank.id : null;
}

// Para cada cartão dentro da fatura: qual sub usar e de quem é (vazio = de vocês)
export function guessSubs(data, parsed, cardId, people = []) {
  const card = data.cards.find((c) => c.id === cardId);
  const titular = firstWord(parsed.cards[0]?.holder).toUpperCase();
  const out = {};
  parsed.cards.forEach((pc) => {
    const existing = (card?.subs || []).find((s) => (s.label || "").includes(pc.key));
    if (existing) { out[pc.key] = { subId: existing.id, label: existing.label, who: existing.who || "" }; return; }
    const fw = firstWord(pc.holder).toUpperCase();
    let who = "";
    if (pc.holder && titular && fw && fw !== titular) {
      who = people.find((p) => norm(p).startsWith(fw)) || cap(fw);
    }
    out[pc.key] = { subId: null, label: /^\d{4}$/.test(pc.key) ? `final ${pc.key}` : pc.key, who };
  });
  return out;
}

// Monta o que vai ser gravado. Não altera "data".
export function planImport(data, parsed, { cardId, month, subs }) {
  const card = data.cards.find((c) => c.id === cardId);
  const newSubs = [];
  const subIdOf = {};
  Object.entries(subs).forEach(([key, s]) => {
    if (s.subId) { subIdOf[key] = s.subId; return; }
    const id = uid();
    subIdOf[key] = id;
    newSubs.push({ id, label: s.label, who: s.who || "" });
  });
  const whoOfKey = (key) => (subs[key]?.who || "").trim();

  const pool = data.txs.filter((t) => t.cardId === cardId).map((t) => ({ ...t })); // cópia para simular
  const updates = {};
  const add = [];
  let skipped = 0;
  // contagem de avulsos já existentes neste mês (para permitir lançamentos iguais legítimos, ex.: 5x lavanderia no mesmo dia)
  const oneKey = (sub, date, desc, amount, parcel, parcels) => `${sub}|${date}|${norm(desc)}|${Math.round(amount * 100)}|${parcel}|${parcels}`;
  const existingCount = {};
  pool.forEach((t) => {
    if (t.month !== month) return;
    if ((t.parcels || 1) > 1 && !t.anticipated) return;
    const k = oneKey(t.sub || "", t.date, t.desc, t.amount, t.parcel || 1, t.parcels || 1);
    existingCount[k] = (existingCount[k] || 0) + 1;
  });

  parsed.lines.forEach((l) => {
    const sub = subIdOf[l.key] || null;
    const third = !!whoOfKey(l.key);
    const base = { cardId, sub, date: l.date, desc: l.desc, amount: l.amount, parcel: l.parcel, parcels: l.parcels, cat: third ? null : suggestCategory(l.desc, l.bankCat, data) };
    if (l.parcels > 1 && !l.anticipated) {
      const start = ymAdd(month, -(l.parcel - 1));
      const tol = Math.max(0.1, Math.abs(l.amount) * 0.02);
      const e = [...pool, ...add].find((t) => (t.sub || null) === sub && t.parcels === l.parcels && !t.anticipated && t.date === l.date
        && norm(t.desc) === norm(l.desc) && Math.abs(t.amount - l.amount) <= tol && ymAdd(t.month, -((t.parcel || 1) - 1)) === start);
      if (e) {
        if (occurs(e, month)) { skipped++; return; }
        if (e.month > month) { // já existia a partir de um mês seguinte: puxa o início para este mês
          e.month = month; e.parcel = l.parcel;
          if (e.id) updates[e.id] = { month, parcel: l.parcel };
          skipped++; return;
        }
        skipped++; return;
      }
      const t = { id: uid(), month, ...base };
      add.push(t);
      return;
    }
    const k = oneKey(sub || "", l.date, l.desc, l.amount, l.parcel, l.parcels);
    if (existingCount[k] > 0) { existingCount[k]--; skipped++; return; }
    add.push({ id: uid(), month, ...base, ...(l.anticipated ? { anticipated: true } : {}) });
  });

  const third = add.filter((t) => { const s = [...(card?.subs || []), ...newSubs].find((x) => x.id === t.sub); return s && s.who; });
  return {
    newSubs, add, updates, skipped,
    count: add.length, thirdCount: third.length,
    uncategorized: add.filter((t) => !t.cat && !third.includes(t)).length,
  };
}

// Aplica o plano nos dados (função pura: devolve os dados novos)
export function applyPlan(data, cardId, plan) {
  return {
    ...data,
    cards: data.cards.map((c) => (c.id === cardId ? { ...c, subs: [...(c.subs || []), ...plan.newSubs] } : c)),
    txs: [...data.txs.map((t) => (plan.updates[t.id] ? { ...t, ...plan.updates[t.id] } : t)), ...plan.add],
  };
}
