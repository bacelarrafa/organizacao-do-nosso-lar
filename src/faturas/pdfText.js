// Extrai o texto de um PDF como itens posicionados por página.
// Recebe o módulo do pdf.js já carregado (no navegador ou no Node).
export async function pagesFromPdf(pdfjs, bytes, password) {
  const task = pdfjs.getDocument({ data: bytes, password: password || undefined, isEvalSupported: false });
  const doc = await task.promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items
      .filter((it) => typeof it.str === "string" && it.str.trim() !== "")
      .map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || it.height || 8 }));
    pages.push({ width: vp.width, height: vp.height, items });
  }
  try { await task.destroy(); } catch (e) { /* ok */ }
  return pages;
}
