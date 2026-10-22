/* Gera uma cópia do PDF com as mesmas correções de cor do visualizador:
 *   'light' = linhas pretas no fundo branco   |   'dark' = linhas brancas no fundo preto
 * Todas as cores do desenho viram "tinta" (menor valor entre R, G e B). Os PDFs das plantas só usam cores simples
 * (operadores rg/RG/g/G/k/K), então o resultado continua vetorial, com o mesmo tamanho e qualidade do original. */

let libPromise = null;
function loadLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  return (libPromise ||= new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/pdf-lib.min.js', import.meta.url).href;
    s.onload = () => ok(window.PDFLib); s.onerror = () => fail(new Error('Não foi possível carregar o gerador de PDF.'));
    document.head.appendChild(s);
  }));
}

const NUM = '(-?(?:\\d+\\.?\\d*|\\.\\d+))';
const RE = new RegExp(
  `${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+([kK])(?=[\\s\\r\\n]|$)` +    // c m y k  k|K
  `|${NUM}\\s+${NUM}\\s+${NUM}\\s+(rg|RG)(?=[\\s\\r\\n]|$)` +           // r g b  rg|RG
  `|${NUM}\\s+([gG])(?=[\\s\\r\\n]|$)`, 'g');                           // gray   g|G
const fmt = (v) => (Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000).toString();

export function recolor(text, dark) {
  return text.replace(RE, (...a) => {
    let op, v;
    if (a[5]) { const [c, m, y, k] = [+a[1], +a[2], +a[3], +a[4]]; op = a[5]; v = Math.min((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)); op = op === 'k' ? 'g' : 'G'; }
    else if (a[9]) { v = Math.min(+a[6], +a[7], +a[8]); op = a[9] === 'rg' ? 'g' : 'G'; }
    else { v = +a[10]; op = a[11]; }
    if (dark) v = 1 - v;
    return `${fmt(v)} ${op}`;
  });
}

const toStr = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return s; };
const toBytes = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };

/** @returns {Promise<Uint8Array>} */
export async function exportPdf(url, mode, onProgress = () => {}) {
  const lib = await loadLib();
  const { PDFDocument, PDFName, PDFArray, PDFRawStream, decodePDFRawStream } = lib;
  const dark = mode === 'dark';
  const buf = await (await fetch(url)).arrayBuffer();
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
  const ctx = doc.context, pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    onProgress(i / pages.length);
    await new Promise((r) => setTimeout(r, 0));          // deixa a interface respirar
    const node = pages[i].node, c = node.Contents();
    const refs = c instanceof PDFArray ? c.asArray() : c ? [node.get(PDFName.of('Contents'))] : [];
    const parts = refs.map((r) => ctx.lookup(r)).filter((s) => s instanceof PDFRawStream).map((s) => toStr(decodePDFRawStream(s).decode()));
    let body = recolor(parts.join('\n'), dark);
    if (dark) body = '1 g 1 G\n' + body;                // cor padrão (preto) dos traços sem cor explícita vira branco
    const out = [];
    if (dark) {                                          // fundo preto cobrindo a página inteira
      const mb = pages[i].getMediaBox();
      out.push(ctx.register(ctx.flateStream(toBytes(`q 0 g ${mb.x - 5} ${mb.y - 5} ${mb.width + 10} ${mb.height + 10} re f Q\n`))));
    }
    out.push(ctx.register(ctx.flateStream(toBytes(body))));
    node.set(PDFName.of('Contents'), ctx.obj(out));
  }
  onProgress(1);
  return doc.save({ useObjectStreams: true });
}

export async function downloadPdf(url, mode, filename, onProgress) {
  const bytes = await exportPdf(url, mode, onProgress);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
