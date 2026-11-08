// =========================================================
// Leitura de faturas em PDF: Itaú, Nubank, Santander e Mercado Pago.
// Entra: páginas com itens de texto posicionados (pdfText.js).
// Sai: { bank, bankName, due, total, cards, lines, warnings }
//   lines: { date, desc, amount, parcel, parcels, key, holder, bankCat }
//   key: identificador do cartão dentro da fatura (final de 4 dígitos ou nome do portador)
// Só lê compras, estornos, tarifas e encargos. Pagamentos da fatura anterior ficam de fora.
// Dados pessoais do cabeçalho (CPF, endereço) nunca são guardados.
// =========================================================

const MONEY = /-?[\d.]+,\d{2}/;
export const money = (s) => {
  const neg = /^[-−]/.test(s.trim());
  const n = Number(s.replace(/[^\d,]/g, "").replace(",", "."));
  return Math.round((neg ? -n : n) * 100) / 100;
};
const MESES = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 };
const pad = (n) => String(n).padStart(2, "0");

// Ano da compra: a fatura só traz dia/mês. Se a data cairia depois do vencimento, é do ano anterior.
function isoFrom(dd, mm, due) {
  const [y] = due.split("-").map(Number);
  let iso = `${y}-${pad(mm)}-${pad(dd)}`;
  if (iso > due) iso = `${y - 1}-${pad(mm)}-${pad(dd)}`;
  return iso;
}

// Agrupa itens em linhas (mesma altura) e junta o texto da esquerda para a direita.
export function toLines(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    let row = rows.find((r) => Math.abs(r.y - it.y) <= 2.5);
    if (!row) { row = { y: it.y, items: [] }; rows.push(row); }
    row.items.push(it);
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => {
    r.items.sort((a, b) => a.x - b.x);
    let s = "", end = null;
    for (const it of r.items) { if (end !== null && it.x - end > 1) s += " "; s += it.s; end = it.x + it.w; }
    return s.replace(/\s+/g, " ").trim();
  }).filter(Boolean);
}
// Linhas por página; em layouts de duas colunas, lê a coluna da esquerda inteira e depois a da direita.
function pageLines(page, splitRatio) {
  if (!splitRatio) return toLines(page.items);
  const cut = page.width * splitRatio;
  return [...toLines(page.items.filter((i) => i.x < cut)), ...toLines(page.items.filter((i) => i.x >= cut))];
}
const fullText = (pages) => pages.map((p) => toLines(p.items).join("\n")).join("\n");

export function detectBank(pages) {
  const t = fullText(pages).toLowerCase();
  if (t.includes("santander")) return "santander";
  if (t.includes("nubank") || t.includes("nu pagamentos")) return "nubank";
  if (t.includes("mercado pago")) return "mercadopago";
  if (t.includes("itaú") || t.includes("itau unibanco") || t.includes("itaucard")) return "itau";
  return null;
}

// ---------------- Itaú ----------------
function parseItau(pages) {
  const text = fullText(pages);
  const warnings = [];
  const dueM = text.match(/Vencimento:\s*(\d{2})\/(\d{2})\/(\d{4})/);
  const due = dueM ? `${dueM[3]}-${dueM[2]}-${dueM[1]}` : null;
  const totM = text.match(/Total desta fatura\s+([\d.]+,\d{2})/);
  const encM = text.match(/Encargos \(Financiamento \+ morat[óo]rio\)\s+([\d.]+,\d{2})/);
  const finalM = text.match(/Cart[ãa]o\s+\d{4}\.X{4}\.X{4}\.(\d{4})/);
  const mainFinal = finalM ? finalM[1] : null;
  const lines = [], cards = [];
  let on = false, holder = null, last = null;
  const addCard = (key, h) => { if (!cards.find((c) => c.key === key)) cards.push({ key, holder: h }); };
  for (const page of pages) {
    for (const l of pageLines(page, 0.57)) {
      if (/^Lançamentos: (compras e saques|produtos e serviços)/.test(l)) { on = true; continue; }
      if (/^(Pagamentos efetuados|Compras parceladas - próximas faturas|Limites de crédito)/.test(l)) { on = false; continue; }
      if (!on) continue;
      if (/^[A-ZÀ-Ú][A-ZÀ-Ú .]+$/.test(l) && !/^DATA/.test(l)) { holder = l.trim(); continue; }
      const m = l.match(/^(\d{2})\/(\d{2}) (.+?) (-?[\d.]+,\d{2})$/);
      if (m) {
        let desc = m[3], parcel = 1, parcels = 1;
        const p = desc.match(/^(.*\S) (\d{2})\/(\d{2})$/);
        if (p) { desc = p[1]; parcel = +p[2]; parcels = +p[3]; }
        const key = (!holder || cards.length === 0 || cards[0].holder === holder) && mainFinal ? mainFinal : holder || "titular";
        addCard(key, holder);
        last = { date: due ? isoFrom(+m[1], +m[2], due) : null, desc: desc.trim(), amount: money(m[4]), parcel, parcels, key, holder, bankCat: null };
        lines.push(last);
        continue;
      }
      // segunda linha do lançamento: categoria do Itaú + cidade
      const c = l.match(/^(outros|restaurante|supermercado|saúde|eletronicos|vestuário|vestuario|viagens|turismo|educação|educacao|serviços|servicos|veículos|veiculos|hobby|diversão|diversao|lazer)\b/i);
      if (c && last && !last.bankCat) last.bankCat = c[1].toLowerCase();
    }
  }
  const enc = encM ? money(encM[1]) : 0;
  if (enc) lines.push({ date: due, desc: "Encargos da fatura (juros, multa e IOF)", amount: enc, parcel: 1, parcels: 1, key: mainFinal || cards[0]?.key || "titular", holder: cards[0]?.holder || null, bankCat: "encargos" });
  if (!lines.length) warnings.push("Não encontrei lançamentos nesta fatura do Itaú.");
  return { bank: "itau", bankName: "Itaú", due, total: totM ? money(totM[1]) : null, cards, lines, warnings };
}

// ---------------- Nubank ----------------
function parseNubank(pages) {
  const text = fullText(pages);
  const warnings = [];
  const dueM = text.match(/Data de vencimento:\s*(\d{2}) ([A-Z]{3}) (\d{4})/);
  const due = dueM ? `${dueM[3]}-${pad(MESES[dueM[2]])}-${dueM[1]}` : null;
  const totM = text.match(/^Total a pagar R\$ ([\d.]+,\d{2})$/m);
  const lines = [], cards = [];
  let on = false, holder = null;
  for (const page of pages) {
    for (const l of pageLines(page, null)) {
      if (/^TRANSAÇÕES/.test(l)) { on = true; continue; }
      if (!on) continue;
      if (/^Pagamentos\b/.test(l)) { holder = null; continue; }
      const h = l.match(/^([A-ZÀ-Úa-zà-ú][A-Za-zÀ-ú .]+) R\$ [\d.]+,\d{2}$/);
      if (h && !/^\d/.test(l)) { holder = h[1].trim(); continue; }
      const m = l.match(/^(\d{2}) (JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ) (.+?) ([-−]?R\$ ?[\d.]+,\d{2})$/);
      if (!m) continue;
      let desc = m[3];
      if (/^Pagamento em\b/i.test(desc)) continue;
      let key = "NuPay";
      const f = desc.match(/^\S*\s*•+\s*(\d{4})\s+(.*)$/);
      if (f) { key = f[1]; desc = f[2]; }
      let parcel = 1, parcels = 1;
      const p = desc.match(/^(.*?) - Parcela (\d+)\/(\d+)$/);
      if (p) { desc = p[1]; parcel = +p[2]; parcels = +p[3]; }
      desc = desc.replace(/ - NuPay$/, " (NuPay)");
      if (!cards.find((c) => c.key === key)) cards.push({ key, holder });
      lines.push({ date: due ? isoFrom(+m[1], MESES[m[2]], due) : null, desc: desc.trim(), amount: money(m[4]), parcel, parcels, key, holder, bankCat: null });
    }
  }
  if (!lines.length) warnings.push("Não encontrei lançamentos nesta fatura do Nubank.");
  return { bank: "nubank", bankName: "Nubank", due, total: totM ? money(totM[1]) : null, cards, lines, warnings };
}

// ---------------- Santander ----------------
function parseSantander(pages) {
  const text = fullText(pages);
  const warnings = [];
  const dueM = text.match(/Vencimento\s+(\d{2})\/(\d{2})\/(\d{4})/) || text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const due = dueM ? `${dueM[3]}-${dueM[2]}-${dueM[1]}` : null;
  const totM = text.match(/\(=\) Saldo Desta Fatura\s+([\d.]+,\d{2})/) || text.match(/Total a Pagar\s+R\$\s*([\d.]+,\d{2})/);
  const lines = [], cards = [];
  let on = false, key = null, holder = null;
  for (const page of pages) {
    for (const l of pageLines(page, 0.46)) {
      if (/^Detalhamento da Fatura/.test(l)) { on = true; continue; }
      if (/^Resumo da Fatura/.test(l)) { on = false; continue; }
      if (!on) continue;
      const h = l.match(/^@?\s*([A-ZÀ-Ú][A-ZÀ-Ú .]+?)\s*-\s*\d{4}\s+X{4}\s+X{4}\s+(\d{4})$/);
      if (h) { holder = h[1].trim(); key = h[2]; if (!cards.find((c) => c.key === key)) cards.push({ key, holder }); continue; }
      if (!key) continue;
      // [ícone] dd/mm descrição [pp/nn] valor [US$]
      const m = l.match(/^(?:\S{1,2} )?(\d{2})\/(\d{2}) (.+?) (?:(\d{2})\/(\d{2}) )?(-?[\d.]+,\d{2})(?: -?[\d.]+,\d{2})?$/);
      if (!m) continue;
      const desc = m[3].trim();
      if (/^PAGAMENTO DE FATURA/i.test(desc)) continue;
      lines.push({ date: due ? isoFrom(+m[1], +m[2], due) : null, desc, amount: money(m[6]), parcel: m[4] ? +m[4] : 1, parcels: m[5] ? +m[5] : 1, key, holder, bankCat: null });
    }
  }
  if (!lines.length) warnings.push("Não encontrei lançamentos nesta fatura do Santander.");
  return { bank: "santander", bankName: "Santander", due, total: totM ? money(totM[1]) : null, cards, lines, warnings };
}

// ---------------- Mercado Pago ----------------
function parseMercadoPago(pages) {
  const text = fullText(pages);
  const warnings = [];
  const dueM = text.match(/Vencimento:\s*(\d{2})\/(\d{2})\/(\d{4})/) || text.match(/(\d{2})\/(\d{2})\/(\d{4}) R\$/);
  const due = dueM ? `${dueM[3]}-${dueM[2]}-${dueM[1]}` : null;
  const totM = toLines(pages[0].items).map((l) => l.match(/^Total R\$ ([\d.]+,\d{2})$/)).find(Boolean);
  const lines = [], cards = [];
  let section = null, key = null;
  for (const page of pages) {
    for (const l of pageLines(page, null)) {
      if (/^Movimentações na fatura/.test(l)) { section = "mov"; continue; }
      const c = l.match(/^Cartão \S+ \[\**(\d{4})\]/);
      if (c) { section = "card"; key = c[1]; if (!cards.find((x) => x.key === key)) cards.push({ key, holder: null }); continue; }
      if (/^Total R\$/.test(l)) { section = null; continue; }
      if (!section) continue;
      const m = l.match(/^(\d{2})\/(\d{2}) (.+?)(?: Parcela (\d+) de (\d+))? R\$ ([\d.]+,\d{2})$/);
      if (!m) continue;
      let desc = m[3].trim(), amount = money(m[6]);
      if (section === "mov") {
        if (/^Pagamento da fatura/i.test(desc)) continue;
        amount = -amount; // reembolsos e créditos aparecem sem sinal
      }
      lines.push({ date: due ? isoFrom(+m[1], +m[2], due) : null, desc, amount, parcel: m[4] ? +m[4] : 1, parcels: m[5] ? +m[5] : 1, key: section === "mov" ? null : key, holder: null, bankCat: null });
    }
  }
  // créditos lidos antes do cartão ficam no cartão principal
  const main = cards[0]?.key || "principal";
  lines.forEach((x) => { if (!x.key) x.key = main; });
  if (!cards.length) cards.push({ key: main, holder: null });
  if (!lines.length) warnings.push("Não encontrei lançamentos nesta fatura do Mercado Pago.");
  return { bank: "mercadopago", bankName: "Mercado Pago", due, total: totM ? money(totM[1]) : null, cards, lines, warnings };
}

const PARSERS = { itau: parseItau, nubank: parseNubank, santander: parseSantander, mercadopago: parseMercadoPago };

// Parcelas adiantadas: a mesma compra aparece com várias parcelas na mesma fatura (ex.: 01/04 a 04/04).
// Essas não se repetem nos próximos meses.
export function markAnticipated(lines) {
  const groups = {};
  lines.forEach((x) => { if (x.parcels > 1) { const g = `${x.key}|${x.date}|${x.desc}|${x.parcels}`; (groups[g] = groups[g] || new Set()).add(x.parcel); } });
  lines.forEach((x) => { if (x.parcels > 1 && groups[`${x.key}|${x.date}|${x.desc}|${x.parcels}`].size > 1) x.anticipated = true; });
  return lines;
}

export function parseFatura(pages) {
  const bank = detectBank(pages);
  if (!bank) return { bank: null, bankName: null, due: null, total: null, cards: [], lines: [], warnings: ["Não reconheci o banco desta fatura. Por enquanto leio Itaú, Nubank, Santander e Mercado Pago."] };
  const r = PARSERS[bank](pages);
  markAnticipated(r.lines);
  const sum = Math.round(r.lines.reduce((n, x) => n + x.amount, 0) * 100) / 100;
  r.sum = sum;
  if (r.total != null && Math.abs(sum - r.total) > 0.05) r.warnings.push(`A soma dos lançamentos lidos (${sum.toFixed(2).replace(".", ",")}) não bate com o total da fatura (${r.total.toFixed(2).replace(".", ",")}). Confira antes de importar.`);
  return r;
}
