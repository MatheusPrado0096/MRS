/* Portal de Pátios • MRS — interface */
import * as Viewer from './viewer.js?v=202610231833';
import * as Km from './km.js?v=202610231833';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

/* ---------------- dados ---------------- */
let META = {};
try { const r = await fetch('data/meta.json?v=202610231833', { cache: 'no-cache' }); if (r.ok) META = await r.json(); } catch {}
Viewer.setMeta(META);
try { const r = await fetch('data/kms.json?v=202610231833', { cache: 'no-cache' }); if (r.ok) Km.setKmData(await r.json()); } catch {}
let ESTUDOS = [];
try { const r = await fetch('data/estudos.json?v=202610221254', { cache: 'no-cache' }); if (r.ok) ESTUDOS = await r.json(); } catch {}
const hasMeta = Object.keys(META).length > 0;
const avail = (p) => !!p && (hasMeta ? !!META[p] : true);

const RAW = Array.isArray(window.PATIOS) ? window.PATIOS : [];
const yards = RAW.map((p) => ({
  ...p, plantaOk: avail(p.planta), thumb: META[p.planta]?.thumb, pages: META[p.planta]?.pages,
}));
const items = yards.flatMap((p) => (p.itens || []).map((i) => {
  const type = p.categoria === 'CX' ? 'CX' : /pn/i.test(i.tipo) ? 'PN' : 'Abrigo';
  return {
    ...i, type, pid: p.id, pnome: p.nome, plabel: p.label, ok: avail(i.pdf), thumb: META[i.pdf]?.thumb, pages: META[i.pdf]?.pages,
    badge: i.codigo === i.nome ? p.id : i.codigo,
  };
}));
const byPath = new Map();
yards.forEach((p) => byPath.set(p.planta, { title: `${p.id} • Planta geral`, sub: p.nome, link: '' }));
items.forEach((i) => byPath.set(i.pdf, { title: `${i.nome} • ${i.codigo === i.nome ? i.pid : i.codigo}`, sub: `${i.pid} • ${i.pnome}`, link: i.link }));
ESTUDOS.forEach((c) => c.docs.forEach((d) => { d.ok = avail(d.pdf); d.thumb = META[d.pdf]?.thumb; d.pages = META[d.pdf]?.pages; d.kb = META[d.pdf]?.kb; byPath.set(d.pdf, { title: d.titulo, sub: `Estudos • ${c.nome}`, link: '' }); }));
// pdf compartilhado por vários itens: o primeiro vence o título, o restante só adiciona o link
const itemByCode = new Map(items.map((i) => [i.codigo, i]));

/* ---------------- favoritos ---------------- */
let favs = new Set(JSON.parse(store.get('mrs-favs', '[]') || '[]'));
const saveFavs = () => store.set('mrs-favs', JSON.stringify([...favs]));

/* ---------------- tema ---------------- */
const root = document.documentElement;
function applyTheme(t, persist) {
  root.dataset.theme = t;
  $('#themeIcon').setAttribute('href', t === 'dark' ? '#i-sun' : '#i-moon');
  $('meta[name=theme-color]').setAttribute('content', t === 'dark' ? '#031221' : '#00335e');
  if (persist) store.set('mrs-theme', t);
}
applyTheme(root.dataset.theme || 'light');
$('#themeBtn').onclick = () => { applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true); };

/* ---------------- toast ---------------- */
let toastT = 0;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400);
}
Viewer.setToast(toast);

/* ---------------- cards ---------------- */
const hl = (text, terms) => {
  let out = esc(text);
  if (!terms?.length) return out;
  const n = norm(text); // índices equivalentes (normalização preserva tamanho na maioria dos casos)
  if (n.length !== String(text).length) return out;
  const ranges = [];
  terms.forEach((t) => { let i = -1; while ((i = n.indexOf(t, i + 1)) !== -1) ranges.push([i, i + t.length]); });
  if (!ranges.length) return out;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  ranges.forEach((r) => { const l = merged[merged.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else merged.push([...r]); });
  let res = '', pos = 0; const src = String(text);
  merged.forEach(([a, b]) => { res += esc(src.slice(pos, a)) + '<mark>' + esc(src.slice(a, b)) + '</mark>'; pos = b; });
  return res + esc(src.slice(pos));
};
function thumbHtml(url, ok, label, act, data) {
  const inner = url
    ? `<img src="${esc(url)}" alt="" loading="lazy" decoding="async">`
    : `<div class="empty-in"><svg class="ic"><use href="#i-file"/></svg><span>${esc(label)}</span></div>`;
  return `<button class="thumb${url ? '' : ' no-doc'}" type="button" ${ok ? `data-act="${act}" ${data}` : 'disabled'} aria-label="${ok ? 'Abrir documento' : 'Documento indisponível'}">${inner}`;
}
function yardCard(p, terms) {
  const n = p.itens?.length || 0;
  return `<article class="card yard">
    ${thumbHtml(p.thumb, p.plantaOk, 'Planta ainda não enviada', 'plant', `data-p="${esc(p.id)}"`)}<span class="badge">${hl(p.id, terms)}</span>${p.pages ? `<span class="pages">${p.pages} ${p.pages > 1 ? 'páginas' : 'página'}</span>` : ''}</button>
    <div class="card-body">
      <span class="tag">${esc(p.label)}</span>
      <h3>${hl(p.nome, terms)}</h3>
      <p>${n} ${n === 1 ? 'item' : 'itens'} cadastrado${n === 1 ? '' : 's'}</p>
      <div class="actions">
        <button class="btn primary" data-act="plant" data-p="${esc(p.id)}" ${p.plantaOk ? '' : 'disabled'}><svg class="ic"><use href="#i-map"/></svg>${p.plantaOk ? 'Abrir planta' : 'Planta em breve'}</button>
        <button class="btn" data-act="list" data-p="${esc(p.id)}">Ver ${esc(p.label)}</button>
      </div>
    </div></article>`;
}
function itemCard(i, terms) {
  const fav = favs.has(i.codigo);
  return `<article class="card">
    ${thumbHtml(i.thumb, i.ok, 'PDF ainda não enviado', 'pdf', `data-code="${esc(i.codigo)}"`)}<span class="badge">${hl(i.badge, terms)}</span>${i.pages ? `<span class="pages">${i.pages} ${i.pages > 1 ? 'páginas' : 'página'}</span>` : ''}</button>
    <button class="fav" data-act="fav" data-code="${esc(i.codigo)}" aria-pressed="${fav}" aria-label="${fav ? 'Remover dos favoritos' : 'Favoritar'}"><svg class="ic"><use href="#i-star"/></svg></button>
    <div class="card-body">
      <span class="tag">${esc(i.type)}</span>
      <h3>${hl(i.nome, terms)}</h3>
      <p>${hl(i.pid + ' • ' + i.pnome, terms)}${i.km ? ' • km ' + esc(i.km) : ''}</p>
      <div class="actions">
        <button class="btn primary" data-act="pdf" data-code="${esc(i.codigo)}" ${i.ok ? '' : 'disabled'}><svg class="ic"><use href="#i-file"/></svg>${i.ok ? 'Abrir PDF' : 'PDF em breve'}</button>
        ${i.link ? `<a class="btn" href="${esc(i.link)}" target="_blank" rel="noopener noreferrer" aria-label="Abrir localização no mapa"><svg class="ic"><use href="#i-pin"/></svg>Local</a>` : `<button class="btn" disabled><svg class="ic"><use href="#i-pin"/></svg>Local</button>`}
      </div>
    </div></article>`;
}
const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => {
  es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { rootMargin: '0px 0px -40px 0px', threshold: 0.05 }) : null;
function mount(container, html) {
  container.innerHTML = html;
  $$('.card', container).forEach((c, idx) => {
    c.style.transitionDelay = Math.min(idx % 9, 8) * 55 + 'ms';
    io ? io.observe(c) : c.classList.add('in');
    const img = $('img', c);
    if (img) { const ok = () => img.classList.add('ok'); img.complete ? ok() : (img.onload = ok, img.onerror = () => img.remove()); }
  });
  // remove o atraso depois da entrada para o hover ficar instantâneo
  setTimeout(() => $$('.card', container).forEach((c) => (c.style.transitionDelay = '')), 1400);
}
function kmCard(r, q, kind) {
  const p = yards.find((x) => x.id === r.id); if (!p) return '';
  const nome = p.nome === p.id ? p.id : `${p.id} • ${p.nome}`;
  const range = `${Km.fmtKm(r.range.min)} → ${Km.fmtKm(r.range.max)}`;
  let chips = '', act = '';
  if (q.lo !== undefined) {
    chips = `<span class="ok">Faixa lida na planta</span><span>${range}</span>`;
    act = `<button class="btn primary" data-act="plant" data-p="${esc(p.id)}" ${p.plantaOk ? '' : 'disabled'}><svg class="ic"><use href="#i-map"/></svg>Abrir planta</button>`;
  } else {
    const h = r.hits?.[0];
    chips = kind === 'exact'
      ? `<span class="ok">✓ Neste pátio</span><span>página ${h.page}</span>${h.between[0] !== h.between[1] ? `<span>entre ${Km.fmtKm(Math.min(...h.between))} e ${Km.fmtKm(Math.max(...h.between))}</span>` : '<span>sobre um marco da planta</span>'}${r.hits.length > 1 ? `<span class="warn">${r.hits.length} pontos possíveis</span>` : ''}`
      : `<span class="warn">Trecho entre ${r.lower ? Km.fmtKm(r.lower.mark.km) : '—'} e ${r.upper ? Km.fmtKm(r.upper.mark.km) : '—'}</span>${r.lower ? `<span>${q.m - r.lower.mark.km} m depois de ${Km.fmtKm(r.lower.mark.km)}</span>` : ''}${r.upper ? `<span>${r.upper.mark.km - q.m} m antes de ${Km.fmtKm(r.upper.mark.km)}</span>` : ''}`;
    act = `<button class="btn primary" data-act="km-open" data-p="${esc(p.id)}" data-km="${q.m}" ${p.plantaOk ? '' : 'disabled'}><svg class="ic"><use href="#i-pin"/></svg>${kind === 'exact' ? 'Ver na planta' : 'Ver trecho na planta'}</button>`;
  }
  return `<article class="card km">
    ${thumbHtml(p.thumb, p.plantaOk, 'Planta ainda não enviada', q.lo !== undefined ? 'plant' : 'km-open', `data-p="${esc(p.id)}" data-km="${q.m || ''}"`)}<span class="badge">${esc(p.id)}</span>${p.pages ? `<span class="pages">${p.pages} pág.</span>` : ''}</button>
    <div class="card-body">
      <span class="tag">${q.label}</span>
      <h3>${esc(nome)}</h3>
      <div class="kminfo">${chips}</div>
      <p style="margin-top:6px">Marcos lidos: ${range}</p>
      <div class="actions">${act}<button class="btn" data-act="list" data-p="${esc(p.id)}">${esc(p.label)}</button></div>
    </div></article>`;
}
function kmBlock(q) {
  const r = Km.searchKm(q);
  let tr = [];
  if (!r.exact.length && r.between) {   // trecho entre os dois marcos mais próximos (pode estar em pátios diferentes)
    const { lower, upper } = r.between, ids = [...new Set([lower?.id, upper?.id].filter(Boolean))];
    tr = ids.map((id) => ({ id, range: Km.rangeOf(id), lower: lower?.id === id ? lower : null, upper: upper?.id === id ? upper : null }));
  }
  const list = r.exact.length ? r.exact.map((x) => kmCard(x, q, 'exact')) : tr.map((x) => kmCard(x, q, 'between'));
  let head;
  if (r.exact.length) head = `<b>${q.label}</b><small>${q.lo !== undefined ? `${r.exact.length} pátio(s) com marcos nesta faixa` : r.exact.length === 1 ? 'Encontrado em 1 pátio — toque em "Ver na planta" para ver o alfinete' : `Encontrado em ${r.exact.length} pátios`}</small>`;
  else if (tr.length) head = `<b>${q.label}</b><small>KM exato não encontrado. Ele fica no trecho entre ${r.between.lower ? Km.fmtKm(r.between.lower.mark.km) : '—'} e ${r.between.upper ? Km.fmtKm(r.between.upper.mark.km) : '—'}.</small>`;
  else head = `<b>${q.label}</b><small>Nenhum pátio com marcos perto deste KM nas plantas cadastradas.</small>`;
  return { html: `<div class="kmbox"><svg class="ic"><use href="#i-pin"/></svg><div>${head}</div></div>` + list.join(''), count: list.length };
}
const emptyBox = (t, s) => `<div class="empty"><b>${esc(t)}</b>${esc(s)}</div>`;

/* ---------------- estatísticas ---------------- */
function renderStats() {
  const docs = (hasMeta ? Object.keys(META).length : yards.length + items.length);
  const data = [[yards.length, 'Pátios'], [items.length, 'Equipamentos'], [docs, 'PDFs']];
  $('#stats').innerHTML = data.map(([n, l]) => `<div class="stat"><dd data-n="${n}">0</dd><dt>${l}</dt></div>`).join('');
  $$('#stats dd').forEach((d) => {
    const n = +d.dataset.n, t0 = performance.now(), dur = 1100;
    const step = (now) => { const k = Math.min(1, (now - t0) / dur); d.textContent = Math.round(n * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

/* ---------------- estado + renderização ---------------- */
const S = { tab: 'patios', yard: '', fav: false, q: '', type: '', cat: '' };

function renderYards() {
  $('#yardCount').textContent = yards.length + ' pátios';
  mount($('#yardCards'), yards.length ? yards.map((p) => yardCard(p)).join('') : emptyBox('Nenhum pátio cadastrado', 'Edite o arquivo data.js para adicionar pátios.'));
}
function renderEquip() {
  const chips = [`<button class="chip" aria-pressed="${!S.yard && !S.fav}" data-act="chip-yard" data-p="">Todos<small>${items.length}</small></button>`,
    `<button class="chip" aria-pressed="${S.fav}" data-act="chip-fav">★ Favoritos<small>${favs.size}</small></button>`,
    ...yards.map((p) => `<button class="chip" aria-pressed="${S.yard === p.id && !S.fav}" data-act="chip-yard" data-p="${esc(p.id)}">${esc(p.id)}<small>${p.itens?.length || 0}</small></button>`)].join('');
  $('#yardChips').innerHTML = chips;
  const y = yards.find((p) => p.id === S.yard);
  $('#equipTitle').textContent = S.fav ? 'Favoritos' : y ? `${y.id} • ${y.nome}` : 'Abrigos, PN e CX';
  const r = items.filter((i) => (S.fav ? favs.has(i.codigo) : !S.yard || i.pid === S.yard));
  $('#equipCount').textContent = r.length + (r.length === 1 ? ' item' : ' itens');
  mount($('#equipCards'), r.length ? r.map((i) => itemCard(i)).join('') : emptyBox(S.fav ? 'Nenhum favorito ainda' : 'Nada por aqui', S.fav ? 'Toque na estrela de um item para guardá-lo aqui.' : 'Este pátio não tem itens cadastrados.'));
  $('#yardChips .chip[aria-pressed=true]')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}
function renderSearch() {
  const terms = norm(S.q).split(/\s+/).filter(Boolean);
  const types = ['', 'Abrigo', 'PN', 'CX'];
  $('#typeChips').innerHTML = types.map((t) => `<button class="chip" aria-pressed="${S.type === t}" data-act="chip-type" data-t="${t}">${t || 'Todos'}</button>`).join('');
  $('#clearBtn').hidden = !S.q;
  const hit = (txt) => terms.every((t) => txt.includes(t));
  const kq = Km.hasKmData() ? Km.parseKm(S.q) : null;
  const kb = kq ? kmBlock(kq) : null;
  const ri = items.filter((i) => (!S.type || i.type === S.type) && hit(norm(`${i.tipo} ${i.type} ${i.nome} ${i.codigo} ${i.pid} ${i.pnome} ${i.plabel}`)));
  const ry = S.type ? [] : (terms.length ? yards.filter((p) => hit(norm(`${p.id} ${p.nome} ${p.label}`))) : []);
  const total = ri.length + ry.length + (kb ? kb.count : 0);
  $('#resultCount').textContent = total + (total === 1 ? ' resultado' : ' resultados');
  let html = kb && (kb.count || q6(S.q)) ? kb.html : '';
  if (ry.length) html += `<h3 class="sub-head">Pátios</h3>` + ry.map((p) => yardCard(p, terms)).join('');
  if (ri.length) html += (ry.length ? `<h3 class="sub-head">Equipamentos</h3>` : '') + ri.map((i) => itemCard(i, terms)).join('');
  mount($('#results'), html || emptyBox('Nenhum resultado', 'Tente outro código, nome de pátio, tipo ou KM (ex.: 364+520).'));
}

const q6 = (t) => /\+|\d{6}|[.,]/.test(t);   // forma inequívoca de KM: mostra o aviso mesmo sem resultado

/* ---------------- estudos ---------------- */
const fmtSize = (kb) => (kb >= 1024 ? (kb / 1024).toFixed(1).replace('.', ',') + ' MB' : (kb || 0) + ' KB');
function studyCard(d, c) {
  return `<article class="card study">
    ${thumbHtml(d.thumb, d.ok, 'Em breve', 'study', `data-pdf="${esc(d.pdf)}"`)}<span class="pages">${d.pages ? d.pages + (d.pages > 1 ? ' páginas' : ' página') : ''}</span></button>
    <div class="card-body">
      <span class="tag">${esc(c.nome)}</span>
      <h3>${esc(d.titulo)}</h3>
      <p>${esc(d.desc)}</p>
      <div class="actions"><button class="btn primary" data-act="study" data-pdf="${esc(d.pdf)}" ${d.ok ? '' : 'disabled'}><svg class="ic"><use href="#i-file"/></svg>${d.ok ? 'Abrir' : 'Em breve'}</button><span class="muted sz">${d.kb ? fmtSize(d.kb) : ''}</span></div>
    </div></article>`;
}
function renderEstudos() {
  if (!ESTUDOS.some((c) => c.id === S.cat)) S.cat = '';
  const total = ESTUDOS.reduce((n, c) => n + c.docs.length, 0);
  $('#estChips').innerHTML = [`<button class="chip" aria-pressed="${!S.cat}" data-act="chip-cat" data-c="">Todos<small>${total}</small></button>`,
    ...ESTUDOS.map((c) => `<button class="chip" aria-pressed="${S.cat === c.id}" data-act="chip-cat" data-c="${c.id}"><svg class="ic"><use href="#${c.icon}"/></svg>${esc(c.nome)}<small>${c.docs.length}</small></button>`)].join('');
  const list = ESTUDOS.filter((c) => !S.cat || c.id === S.cat);
  $('#estCount').textContent = `${list.reduce((n, c) => n + c.docs.length, 0)} documentos`;
  mount($('#estList'), list.length ? list.map((c) => `<section class="est-group" id="est-${c.id}">
      <div class="est-head"><span class="est-ic"><svg class="ic"><use href="#${c.icon}"/></svg></span><div><h3>${esc(c.nome)}</h3><p>${esc(c.desc)}</p></div></div>
      <div class="grid">${c.docs.map((d) => studyCard(d, c)).join('')}</div></section>`).join('') : emptyBox('Nenhum material ainda', 'Os documentos de estudo aparecerão aqui.'));
  $('#estChips .chip[aria-pressed=true]')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}

/* ---------------- abas ---------------- */
const tabsEl = $('#tabs'), ind = $('.tab-ind');
function moveInd() {
  const t = $('.tab[aria-selected=true]', tabsEl) || $('.tab', tabsEl);
  ind.style.width = t.offsetWidth + 'px'; ind.style.transform = `translateX(${t.offsetLeft}px)`;
}
function showTab(id, instant) {
  S.tab = id;
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', t.dataset.tab === id));
  $$('.panel').forEach((p) => { const on = p.id === id; if (on && p.hidden) { p.hidden = false; } else if (!on) p.hidden = true; });
  if (id === 'equipamentos') renderEquip();
  if (id === 'pesquisa') renderSearch();
  if (id === 'estudos') renderEstudos();
  moveInd();
  if (!instant) window.scrollTo({ top: 0, behavior: 'smooth' });
}
addEventListener('resize', moveInd);
document.fonts?.ready.then(moveInd);

/* ---------------- roteamento por hash ---------------- */
// #patios | #equipamentos/FSJ | #pesquisa  (+ ?ver=docs/x.pdf&p=2 quando o visualizador está aberto)
function parseHash() {
  const raw = decodeURIComponent(location.hash.slice(1)), [path, qs = ''] = raw.split('?');
  const [tab, arg = ''] = path.split('/'), params = new URLSearchParams(qs);
  return { tab: ['patios', 'equipamentos', 'pesquisa', 'estudos'].includes(tab) ? tab : 'patios', arg, ver: params.get('ver'), p: +params.get('p') || 1, km: +params.get('km') || 0 };
}
const baseHash = (tab = S.tab) => '#' + tab + (tab === 'equipamentos' && S.yard ? '/' + S.yard : tab === 'estudos' && S.cat ? '/' + S.cat : '');
let viewerPushed = false;
function route(first) {
  const h = parseHash();
  if (h.tab === 'equipamentos') { S.yard = yards.some((p) => p.id === h.arg) ? h.arg : ''; S.fav = false; }
  if (h.tab === 'estudos') S.cat = ESTUDOS.some((c) => c.id === h.arg) ? h.arg : '';
  if (h.tab !== S.tab || first) showTab(h.tab, true);
  else if (h.tab === 'equipamentos') renderEquip();
  else if (h.tab === 'estudos') renderEstudos();
  if (h.ver && byPath.has(h.ver) && avail(h.ver)) {
    const m = byPath.get(h.ver);
    const yd = yards.find((y) => y.planta === h.ver);
    const pins = h.km && yd ? Km.pinsFor(yd.id, h.km) : [];
    Viewer.open({ path: h.ver, title: m.title, sub: m.sub, link: m.link, page: h.p, pins });
  } else if (Viewer.isOpen()) Viewer.close(true);
}
addEventListener('hashchange', () => route(false));
Viewer.onClose(() => {
  if (viewerPushed) { viewerPushed = false; history.back(); }
  else { history.replaceState(null, '', baseHash()); route(false); }
});
Viewer.onState(({ path, page, km }) => {
  if (!parseHash().ver) return;
  history.replaceState(null, '', `${baseHash()}?ver=${encodeURIComponent(path)}${page > 1 ? '&p=' + page : ''}${km ? '&km=' + km : ''}`);
});
function openDoc(path, code, km) {
  if (!path || !avail(path)) return toast('Este PDF ainda não foi enviado.');
  viewerPushed = true;
  const it = code && itemByCode.get(code);
  const m = byPath.get(path) || {};
  if (it) { m.link = it.link; byPath.set(path, { ...m, title: `${it.nome} • ${it.badge}`, sub: `${it.pid} • ${it.pnome}`, link: it.link }); }
  location.hash = `${baseHash()}?ver=${encodeURIComponent(path)}${km ? '&km=' + km : ''}`;
}

/* ---------------- eventos ---------------- */
$$('.tab[data-tab]').forEach((t) => (t.onclick = () => {
  const id = t.dataset.tab; if (id === S.tab) return window.scrollTo({ top: 0, behavior: 'smooth' });
  location.hash = '#' + id + (id === 'equipamentos' && S.yard ? '/' + S.yard : id === 'estudos' && S.cat ? '/' + S.cat : '');
}));
$('#kmForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#kmQuick').value.trim(); if (!v) return $('#kmQuick').focus();
  S.q = v; S.type = ''; $('#search').value = v;
  if (S.tab === 'pesquisa') renderSearch(); else location.hash = '#pesquisa';
  window.scrollTo({ top: 0 });
});
$('#goSearch').onclick = () => { location.hash = '#pesquisa'; setTimeout(() => $('#search').focus(), 60); };
$('.brand').addEventListener('click', (e) => { if (S.tab === 'patios') { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); } });

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'plant') { const p = yards.find((x) => x.id === b.dataset.p); p && openDoc(p.planta); }
  else if (act === 'km-open') { const p = yards.find((x) => x.id === b.dataset.p); p && openDoc(p.planta, null, +b.dataset.km || 0); }
  else if (act === 'pdf') { const i = itemByCode.get(b.dataset.code); i && openDoc(i.pdf, i.codigo); }
  else if (act === 'study') openDoc(b.dataset.pdf);
  else if (act === 'chip-cat') { S.cat = b.dataset.c; history.replaceState(null, '', baseHash('estudos')); renderEstudos(); }
  else if (act === 'list') { location.hash = '#equipamentos/' + b.dataset.p; window.scrollTo({ top: 0 }); }
  else if (act === 'chip-yard') { S.yard = b.dataset.p; S.fav = false; history.replaceState(null, '', baseHash('equipamentos')); renderEquip(); }
  else if (act === 'chip-fav') { S.fav = !S.fav; if (S.fav) S.yard = ''; renderEquip(); }
  else if (act === 'chip-type') { S.type = b.dataset.t; renderSearch(); }
  else if (act === 'fav') {
    const c = b.dataset.code, on = !favs.has(c); on ? favs.add(c) : favs.delete(c); saveFavs();
    b.setAttribute('aria-pressed', on); b.setAttribute('aria-label', on ? 'Remover dos favoritos' : 'Favoritar');
    $$(`.fav[data-code="${CSS.escape(c)}"]`).forEach((x) => x.setAttribute('aria-pressed', on));
    const fc = $('[data-act=chip-fav] small'); if (fc) fc.textContent = favs.size;
    toast(on ? 'Adicionado aos favoritos' : 'Removido dos favoritos');
    if (S.fav && !on && S.tab === 'equipamentos') renderEquip();
  }
});
// efeito "ripple" nos botões
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.btn:not([disabled])'); if (!b) return;
  const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height), d = document.createElement('span');
  d.className = 'rip'; d.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
  b.appendChild(d); setTimeout(() => d.remove(), 650);
});

let st = 0;
$('#search').addEventListener('input', (e) => { S.q = e.target.value; clearTimeout(st); st = setTimeout(renderSearch, 90); });
$('#clearBtn').onclick = () => { S.q = ''; S.type = ''; $('#search').value = ''; renderSearch(); $('#search').focus(); };
document.addEventListener('keydown', (e) => {
  if (Viewer.isOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
  const typing = /input|textarea|select/i.test(e.target.tagName);
  if (e.key === '/' && !typing) { e.preventDefault(); $('#goSearch').click(); }
  if (e.key === 'Escape' && typing) e.target.blur();
});

/* ---------------- início ---------------- */
renderStats();
renderYards();
route(true);
if (S.tab !== 'patios') { /* stats só animam na primeira aba */ }
