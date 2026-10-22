/* Busca por KM: converte "364+520" em metros e acha o pátio (e o ponto na planta) pelos rótulos lidos de cada planta. */

const MAX_SEG = 1500;   // metros: só interpola entre marcos vizinhos próximos
let DB = {};   // { PÁTIO: { planta, pages: [{ page, marks: [{km, x, y}] }] } }  (x,y = fração da página)
export const setKmData = (d) => { DB = d || {}; };
export const hasKmData = () => Object.keys(DB).length > 0;

export const fmtKm = (m) => `${Math.floor(m / 1000)}+${String(Math.round(m % 1000)).padStart(3, '0')}`;

/** Interpreta o texto digitado. Retorna { m, label } (ponto exato) ou { lo, hi, label } (km inteiro) ou null. */
export function parseKm(text) {
  let t = String(text || '').toLowerCase().replace(/km\.?/g, ' ').replace(/[\s_]+/g, ' ').trim();
  if (!t) return null;
  let m;
  if ((m = t.match(/^(\d{2,3}) ?\+ ?(\d{1,3})$/))) return exact(+m[1] * 1000 + +m[2]);               // 364+520
  if ((m = t.match(/^(\d{3})(\d{3})$/))) return exact(+m[1] * 1000 + +m[2]);                              // 364520
  if ((m = t.match(/^(\d{2,3})[.,](\d{3})$/))) return exact(+m[1] * 1000 + +m[2]);                       // 364,520 (metros)
  if ((m = t.match(/^(\d{2,3})[.,](\d{1,2})$/))) return exact(Math.round(parseFloat(m[1] + '.' + m[2]) * 1000)); // 364,5 (km decimal)
  if ((m = t.match(/^(\d{2,3}) (\d{3})$/))) return exact(+m[1] * 1000 + +m[2]);                           // 364 520
  if ((m = t.match(/^(\d{3})$/))) return { lo: +m[1] * 1000, hi: +m[1] * 1000 + 999, label: `km ${m[1]}` }; // 364 (todo o km)
  return null;
}
const exact = (m) => ({ m, label: 'km ' + fmtKm(m) });

export const rangeOf = (id) => DB[id] && range(DB[id]);
const range = (y) => {
  const all = y.pages.flatMap((p) => p.marks.map((k) => k.km));
  return { min: Math.min(...all), max: Math.max(...all) };
};

/** Posições na planta: interpola entre rótulos vizinhos (na ordem em que aparecem da esquerda p/ direita). */
function locate(y, km) {
  const hits = [];
  for (const pg of y.pages) {
    const ms = [...pg.marks].sort((a, b) => a.x - b.x);
    for (let i = 0; i < ms.length - 1; i++) {
      const a = ms[i], b = ms[i + 1];
      if (a.km === b.km || Math.abs(a.km - b.km) > MAX_SEG) continue;   // marcos muito distantes: o trecho entre eles não é o pátio
      const lo = Math.min(a.km, b.km), hi = Math.max(a.km, b.km);
      if (km < lo || km > hi) continue;
      const k = (km - a.km) / (b.km - a.km);
      hits.push({ page: pg.page, x: a.x + (b.x - a.x) * k, y: (a.y + b.y) / 2, between: [a.km, b.km], span: [a.x, b.x] });
    }
    const eq = ms.find((m) => m.km === km);               // exatamente sobre um rótulo
    if (eq && !hits.some((h) => h.page === pg.page && Math.abs(h.x - eq.x) < 0.004)) hits.unshift({ page: pg.page, x: eq.x, y: eq.y, between: [km, km] });
  }
  // remove pontos repetidos
  return hits.filter((h, i) => hits.findIndex((o) => o.page === h.page && Math.abs(o.x - h.x) < 0.004) === i);
}

/**
 * Procura um KM. Retorna { exact: [{id, planta, range, hits}], near: [{id, planta, dist, mark, page}] }
 *  - exact: pátios cujos rótulos "cercam" o KM (com ponto na planta);
 *  - between: se nenhum trecho desenhado cobrir o KM, os dois marcos mais próximos dele (um antes, outro depois),
 *    em qualquer pátio: { lower, upper } com { id, page, mark, dist }.
 */
export function searchKm(q, { nearMax = 5000 } = {}) {
  const res = { exact: [], between: null };
  if (q.lo !== undefined) {   // km inteiro: lista os pátios que têm rótulos nessa faixa
    for (const [id, y] of Object.entries(DB)) {
      const r = range(y);
      if (r.max >= q.lo && r.min <= q.hi) res.exact.push({ id, planta: y.planta, range: r, hits: [] });
    }
    return res;
  }
  for (const [id, y] of Object.entries(DB)) {
    const hits = locate(y, q.m);
    if (hits.length) res.exact.push({ id, planta: y.planta, range: range(y), hits });
  }
  if (!res.exact.length) {
    const n = neighbors(q.m), far = 30000;    // marcos a mais de 30 km não servem de referência
    if (n.lower && n.lower.dist > far) n.lower = null;
    if (n.upper && n.upper.dist > far) n.upper = null;
    res.between = n.lower || n.upper ? n : null;
  }
  return res;
}

/** Marco mais próximo abaixo e acima do KM (entre todos os pátios, ou só em `only`). */
export function neighbors(km, only) {
  let lower = null, upper = null;
  for (const [id, y] of Object.entries(DB)) {
    if (only && id !== only) continue;
    for (const pg of y.pages) for (const m of pg.marks) {
      const d = m.km - km;
      if (d <= 0 && (!lower || m.km > lower.mark.km)) lower = { id, page: pg.page, mark: m, dist: -d };
      if (d >= 0 && (!upper || m.km < upper.mark.km)) upper = { id, page: pg.page, mark: m, dist: d };
    }
  }
  return { lower, upper };
}

/** Pontos para o visualizador: alfinete no ponto estimado + faixa do trecho; ou, sem trecho desenhado, os dois marcos vizinhos. */
export function pinsFor(id, km) {
  const y = DB[id]; if (!y) return [];
  const hits = locate(y, km);
  if (hits.length) {
    return hits.map((h) => ({ page: h.page, x: h.x, y: h.y, km, q: km, span: h.span, chip: `km ${fmtKm(km)} • entre ${fmtKm(Math.min(...h.between))} e ${fmtKm(Math.max(...h.between))}` }));
  }
  const { lower, upper } = neighbors(km, id);
  const out = [];
  for (const n of [lower, upper]) if (n) out.push({ page: n.page, x: n.mark.x, y: n.mark.y, km: n.mark.km, q: km, mark: true });
  if (lower && upper && lower.page === upper.page && upper.mark.km - lower.mark.km <= MAX_SEG) {
    out.forEach((p) => { p.span = [lower.mark.x, upper.mark.x]; });
  }
  if (out.length) out[0].chip = `km ${fmtKm(km)} • entre ${lower ? fmtKm(lower.mark.km) : '—'} e ${upper ? fmtKm(upper.mark.km) : '—'}`;
  return out;
}
export const plantaOf = (id) => DB[id]?.planta;
