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
      hits.push({ page: pg.page, x: a.x + (b.x - a.x) * k, y: (a.y + b.y) / 2, between: [a.km, b.km] });
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
 *  - near:  se ninguém cercar, os pátios com o rótulo mais próximo.
 */
export function searchKm(q, { nearMax = 5000 } = {}) {
  const res = { exact: [], near: [] };
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
    for (const [id, y] of Object.entries(DB)) {
      let best = null;
      for (const pg of y.pages) for (const m of pg.marks) {
        const d = Math.abs(m.km - q.m);
        if (!best || d < best.dist) best = { dist: d, mark: m, page: pg.page };
      }
      if (best && best.dist <= nearMax) res.near.push({ id, planta: y.planta, range: range(y), ...best });
    }
    res.near.sort((a, b) => a.dist - b.dist);
    res.near = res.near.slice(0, 3);
  }
  return res;
}

/** Pontos (alfinetes) para o visualizador, a partir de um pátio e um KM. */
export function pinsFor(id, km) {
  const y = DB[id]; if (!y) return [];
  const hits = locate(y, km);
  if (hits.length) return hits.map((h) => ({ ...h, km }));
  // fora dos rótulos: encosta no rótulo mais próximo
  let best = null;
  for (const pg of y.pages) for (const m of pg.marks) {
    const d = Math.abs(m.km - km); if (!best || d < best.d) best = { d, page: pg.page, x: m.x, y: m.y };
  }
  return best ? [{ page: best.page, x: best.x, y: best.y, km, approx: true }] : [];
}
export const plantaOf = (id) => DB[id]?.planta;
