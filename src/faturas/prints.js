// Prints de lançamentos: reduz a imagem no aparelho, manda para a função "ler-print"
// (Gemini, no Supabase) e junta o resultado no mesmo formato das faturas em PDF.
import { supabase } from "../supabaseClient";
import { markAnticipated } from "./parsers";

// Reduz para no máximo 1000 px de largura em JPEG: lê bem e manda menos dados.
export function shrinkImage(file, maxW = 1000) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ mime: "image/jpeg", data: c.toDataURL("image/jpeg", 0.82).split(",")[1] });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Não consegui abrir a imagem.")); };
    img.src = url;
  });
}

const num = (v) => { const n = typeof v === "number" ? v : Number(String(v || "").replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
const isoOk = (s) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

// Junta o que o Gemini leu de cada print. Prints que se sobrepõem não duplicam:
// cada lançamento conta o máximo de vezes que apareceu num mesmo print.
export function mergeResults(results) {
  const bankVotes = {};
  let cardFinal = null;
  const maxCount = {};
  const sample = {};
  results.forEach((r) => {
    if (r?.banco) bankVotes[r.banco] = (bankVotes[r.banco] || 0) + 1;
    if (/^\d{4}$/.test(String(r?.final_cartao || ""))) cardFinal = String(r.final_cartao);
    const count = {};
    (r?.lancamentos || []).forEach((x) => {
      const amount = num(x.valor);
      const desc = String(x.descricao || "").replace(/\s+/g, " ").trim();
      if (amount == null || !desc) return;
      const line = {
        date: isoOk(x.data), desc, amount,
        parcel: Math.max(1, parseInt(x.parcela) || 1), parcels: Math.max(1, parseInt(x.parcelas) || 1),
        key: /^\d{4}$/.test(String(x.final || "")) ? String(x.final) : "principal",
        holder: x.portador || null, bankCat: null,
      };
      if (line.parcel > line.parcels) line.parcels = line.parcel;
      const k = `${line.key}|${line.date}|${desc.toUpperCase()}|${Math.round(amount * 100)}|${line.parcel}|${line.parcels}`;
      count[k] = (count[k] || 0) + 1;
      sample[k] = line;
    });
    Object.entries(count).forEach(([k, n]) => { maxCount[k] = Math.max(maxCount[k] || 0, n); });
  });
  const lines = [];
  Object.entries(maxCount).forEach(([k, n]) => { for (let i = 0; i < n; i++) lines.push({ ...sample[k] }); });
  lines.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  markAnticipated(lines);
  const cards = [];
  lines.forEach((l) => { if (!cards.find((c) => c.key === l.key)) cards.push({ key: l.key, holder: l.holder }); });
  const bankName = Object.entries(bankVotes).sort((a, b) => b[1] - a[1])[0]?.[0] || "Prints";
  const undated = lines.filter((l) => !l.date).length;
  return {
    bank: "print", bankName: bankName === "outro" ? "Prints" : bankName, cardFinal, cards, lines,
    warnings: [...(lines.length ? [] : ["Não encontrei lançamentos nos prints."]), ...(undated ? [`${undated} lançamentos sem data visível no print.`] : [])],
  };
}

export async function readPrints(files) {
  const images = [];
  for (const f of files) images.push(await shrinkImage(f));
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ler-print`;
  // corpo como texto simples: o navegador não faz a checagem prévia (CORS)
  const r = await fetch(url, { method: "POST", body: JSON.stringify({ token, images }) });
  let out = null;
  try { out = await r.json(); } catch (e) { /* resposta vazia */ }
  if (!r.ok) throw new Error(out?.error || `A leitura falhou (${r.status}). Confira se a função ler-print foi publicada.`);
  return mergeResults(out.results || []);
}
