// Leitura de arquivo OFX de cartão (ex.: Nubank, "Exportar fatura").
// Compras viram valores positivos; estornos e créditos, negativos. Pagamentos da fatura ficam de fora.
export function parseOfx(text) {
  const tag = (blk, t) => { const m = blk.match(new RegExp(`<${t}>([^<\\r\\n]*)`)); return m ? m[1].trim() : ""; };
  const org = tag(text, "ORG");
  const toIso = (s) => (s && s.length >= 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);
  const start = toIso(tag(text, "DTSTART")), end = toIso(tag(text, "DTEND"));
  const lines = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  blocks.forEach((b) => {
    const amt = Number(tag(b, "TRNAMT").replace(",", "."));
    let desc = tag(b, "MEMO") || tag(b, "NAME");
    if (!Number.isFinite(amt) || !desc) return;
    if (/^pagamento (recebido|da fatura|em )/i.test(desc)) return;
    let parcel = 1, parcels = 1;
    const p = desc.match(/^(.*?)\s*-\s*Parcela (\d+)\/(\d+)$/i);
    if (p) { desc = p[1]; parcel = +p[2]; parcels = +p[3]; }
    desc = desc.replace(/ - NuPay$/i, " (NuPay)");
    lines.push({ date: toIso(tag(b, "DTPOSTED")), desc: desc.trim(), amount: Math.round(-amt * 100) / 100, parcel, parcels, key: "principal", holder: null, bankCat: null });
  });
  const bankName = /nu pagamentos|nubank/i.test(org) ? "Nubank" : org || "Cartão";
  return { bank: "ofx", bankName, start, end, cards: [{ key: "principal", holder: null }], lines, warnings: lines.length ? [] : ["Não encontrei lançamentos neste arquivo."] };
}
