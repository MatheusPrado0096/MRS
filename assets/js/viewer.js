/* Visualizador de PDF — zoom por pinça, arrastar, duplo toque, roda do mouse e teclado.
 * Renderiza apenas a região visível (mais margem), então fica nítido em qualquer ampliação
 * sem estourar a memória do celular. Durante o gesto usa transformação CSS (60 fps). */
import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';
import { fmtKm } from './km.js?v=202610231908';

const BASE = new URL('../vendor/pdfjs/', import.meta.url).href;
pdfjs.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.mjs';

const $ = (id) => document.getElementById(id);
const el = {
  root: $('viewer'), stage: $('vStage'), a: $('vCanvasA'), b: $('vCanvasB'),
  title: $('vTitle'), sub: $('vSub'), loading: $('vLoading'), loadingText: $('vLoadingText'),
  progress: $('vProgress'), hint: $('vHint'), badge: $('vZoomBadge'), dock: $('vDock'),
  prev: $('vPrev'), next: $('vNext'), pageNow: $('vPageNow'), pageTotal: $('vPageTotal'), pageBtn: $('vPageBtn'),
  zoomPct: $('vZoomPct'), fitIcon: $('vFitIcon'), loc: $('vLoc'), dl: $('vDownload'), dlMenu: $('vDlMenu'),
  pinsLayer: $('vPins'), kmChip: $('vKmChip'), kmText: $('vKmText'),
  pages: $('vPages'), pagesGrid: $('vPagesGrid'),
};

const DOCK_RESERVE = () => (innerWidth <= 720 ? 78 : 86); // espaço ocupado pela barra flutuante
const EDGE = 8;
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = (t) => 1 - Math.pow(1 - t, 3);

let pdf = null, loadingTask = null, curPath = '', pageNum = 1, rot = 0;
let pw = 1, ph = 1;                 // tamanho da página (unidades PDF) já com rotação
let V = { z: 1, x: 0, y: 0 };       // visão atual: z = px CSS por unidade PDF; x,y = canto da página no palco
let R = null;                       // parâmetros da última renderização exibida
let front = el.a, back = el.b;
let fitMode = 'contain', autoFit = true, freeze = false;
let renderGen = 0, renderTask = null, renderTimer = 0, tween = 0, momentum = 0, resizeObs = null;
let night = false, opened = false, onCloseCb = null, hintTimer = 0, badgeTimer = 0, thumbToken = 0;
let curPage = null, colorDoc = false;   // colorDoc: material de estudo (mantém as cores originais)
let pins = [];                      // alfinetes de KM: { page, x, y (fração da página), km, approx }

/* ---------------- cores: desenho monocromático (preto no claro, branco no escuro) ---------------- */
// Cada pixel vira o menor dos canais RGB (vermelho, ciano, amarelo… viram "tinta" preta). No escuro, inverte.
function mono(ctx, w, h, invert) {
  const img = ctx.getImageData(0, 0, w, h), px = new Uint32Array(img.data.buffer);
  for (let i = 0; i < px.length; i++) {
    const p = px[i], a = p >>> 24; if (!a) continue;
    const r = p & 255, g = (p >>> 8) & 255, b = (p >>> 16) & 255;
    let m = r < g ? r : g; if (b < m) m = b; if (invert) m = 255 - m;
    px[i] = (a << 24) | (m << 16) | (m << 8) | m;
  }
  ctx.putImageData(img, 0, 0);
}

/* ---------------- geometria ---------------- */
const size = () => ({ W: el.stage.clientWidth, H: el.stage.clientHeight });
function zFit(mode) {
  const { W, H } = size(), res = DOCK_RESERVE();
  const zw = (W - EDGE * 2) / pw;
  return mode === 'width' ? zw : Math.min(zw, (H - res - EDGE) / ph);
}
const zMin = () => Math.min(zFit('contain'), zFit('width')) * 0.5;
const zMax = () => Math.max(zFit('width') * 24, 10);

function clampView(v) {
  const { W, H } = size(), res = DOCK_RESERVE(), cw = pw * v.z, ch = ph * v.z;
  const areaH = H - res;
  v.x = cw <= W - EDGE * 2 ? (W - cw) / 2 : clampN(v.x, W - cw - EDGE, EDGE);
  v.y = ch <= areaH - EDGE * 2 ? (areaH - ch) / 2 : clampN(v.y, areaH - ch - EDGE, EDGE);
  return v;
}
function fitView(mode = fitMode, animate = false) {
  fitMode = mode;
  const z = zFit(mode), { W } = size();
  const t = clampView({ z, x: (W - pw * z) / 2, y: EDGE });
  autoFit = true;
  updateFitIcon();
  animate ? animateTo(t) : (V = t, apply(), scheduleRender(0));
}
function updateFitIcon() {
  el.fitIcon.setAttribute('href', fitMode === 'contain' ? '#i-fitw' : '#i-fitp');
  el.fitIcon.closest('button').title = fitMode === 'contain' ? 'Ajustar à largura ( 0 )' : 'Ajustar à página ( 0 )';
}

/* ---------------- transformação / renderização ---------------- */
function apply() {
  updateUi(); updatePins();
  if (!R || freeze) return;
  const s = V.z / R.z;
  front.style.transform = `translate3d(${V.x + (-R.m - R.x) * s}px,${V.y + (-R.m - R.y) * s}px,0) scale(${s})`;
}
function updateUi() {
  const pct = Math.round((V.z / zFit('contain')) * 100);
  el.zoomPct.textContent = pct + '%';
  el.badge.textContent = pct + '%';
}
function showBadge() {
  el.badge.classList.add('show');
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => el.badge.classList.remove('show'), 900);
}
function scheduleRender(delay = 90) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderNow, delay);
}
async function renderNow() {
  if (!pdf || !curPage) return;
  const gen = ++renderGen;
  try { renderTask?.cancel(); } catch {}
  const { W, H } = size();
  if (!W || !H) return;
  const m = Math.round(Math.min(Math.max(W, H) * 0.22, 320));
  const cssW = W + 2 * m, cssH = H + 2 * m;
  let dpr = Math.min(window.devicePixelRatio || 1, 3);
  dpr = Math.max(1, Math.min(dpr, Math.sqrt(14e6 / (cssW * cssH))));
  const target = { z: V.z, x: V.x, y: V.y, m };
  const c = back, ctx = c.getContext('2d');
  c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
  c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
  const viewport = curPage.getViewport({
    scale: target.z * dpr, rotation: (curPage.rotate + rot) % 360,
    offsetX: (target.x + m) * dpr, offsetY: (target.y + m) * dpr,
  });
  try {
    renderTask = curPage.render({ canvasContext: ctx, canvas: c, viewport, background: 'rgba(0,0,0,0)' });
    await renderTask.promise;
  } catch (e) {
    if (e?.name === 'RenderingCancelledException') return;
    console.warn('Falha ao renderizar', e); return;
  }
  if (gen !== renderGen) return;
  if (!colorDoc) mono(ctx, c.width, c.height, night);
  // fundo da página (branco no claro, preto no escuro) e sombra, desenhados atrás do conteúdo
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';   // tudo abaixo é pintado ATRÁS do conteúdo do PDF
  const rx = (target.x + m) * dpr, ry = (target.y + m) * dpr, rw = pw * target.z * dpr, rh = ph * target.z * dpr;
  const dark = night && !colorDoc;   // colorDoc no escuro: o CSS inverte o canvas (fundo branco aqui)
  ctx.fillStyle = dark ? '#000' : '#fff'; ctx.fillRect(rx, ry, rw, rh);
  if (!dark) { // sombra: o retângulo fica fora do canvas e só a sombra aparece, atrás do papel
    ctx.shadowColor = 'rgba(0,20,40,.38)'; ctx.shadowBlur = 26 * dpr; ctx.shadowOffsetY = 8 * dpr; ctx.shadowOffsetX = -20000;
    ctx.fillStyle = '#000'; ctx.fillRect(rx + 20000, ry, rw, rh);
  }
  ctx.restore();
  R = target; freeze = false;
  back.style.transform = 'none';
  [front, back] = [back, front];
  front.classList.add('front'); back.classList.remove('front');
  apply();
  el.loading.classList.add('off');
  if (!gesture.active && !tween && !momentum && (Math.abs(V.z - R.z) > 1e-6 || Math.abs(V.x - R.x) > 0.5 || Math.abs(V.y - R.y) > 0.5)) scheduleRender(40);
}

/* ---------------- alfinetes de KM ---------------- */
const PIN_SVG = '<svg viewBox="0 0 24 34" width="34" height="48" aria-hidden="true"><path d="M12 33S2 20.5 2 12a10 10 0 0 1 20 0c0 8.500-10 21-10 21z" fill="#ff3b1d" stroke="#fff" stroke-width="2"/><circle cx="12" cy="12" r="4.200" fill="#fff"/></svg>';
function toRot(fx, fy) {            // fração na página original -> fração na página girada pelo usuário
  switch (rot) { case 90: return [1 - fy, fx]; case 180: return [1 - fx, 1 - fy]; case 270: return [fy, 1 - fx]; default: return [fx, fy]; }
}
function renderPins() {
  el.pinsLayer.replaceChildren();
  const mine = pins.filter((p) => p.page === pageNum);
  mine.forEach((p) => {
    const w = document.createElement('div'); w.className = 'pin-wrap';
    w.innerHTML = `<i class="pin-band"></i><i class="pin-line"></i><div class="pin${p.mark ? ' mark' : ''}"><i class="pulse"></i>${PIN_SVG}<span class="pin-lbl">km ${fmtKm(p.km)}</span></div>`;
    el.pinsLayer.appendChild(w); p._el = w;
  });
  el.kmChip.hidden = !pins.length;
  if (pins.length) el.kmText.textContent = pins[0].chip || ('km ' + fmtKm(pins[0].q || pins[0].km));
  updatePins();
}
function updatePins() {
  if (!pins.length) return;
  for (const p of pins) {
    if (!p._el || p.page !== pageNum) continue;
    const [fx, fy] = toRot(p.x, p.y), px = V.x + fx * pw * V.z, py = V.y + fy * ph * V.z;
    p._el.style.transform = `translate3d(${px}px,${V.y}px,0)`;
    const [band, line, pin] = p._el.children;
    line.style.height = ph * V.z + 'px';
    pin.style.transform = `translate3d(0,${py - V.y}px,0)`;
    if (p.span) {   // faixa do trecho entre os dois marcos
      const xs = p.span.map((sx) => toRot(sx, p.y)[0] * pw * V.z + V.x).sort((m, n) => m - n);
      band.style.cssText = `display:block;left:${xs[0] - px}px;width:${xs[1] - xs[0]}px;height:${ph * V.z}px`;
    } else band.style.display = 'none';
  }
}
function focusPin(p, animate = true) {
  const [fx0, fy] = toRot(p.x, p.y), { W, H } = size();
  const same = pins.filter((q) => q.page === p.page);
  let fx = fx0, z = Math.min(zMax(), Math.max(zFit('contain') * 2.4, zFit('width') * 1.3));
  if (same.length > 1) {          // dois marcos vizinhos: enquadra os dois
    const xs = same.map((q) => toRot(q.x, q.y)[0]), lo = Math.min(...xs), hi = Math.max(...xs);
    fx = (lo + hi) / 2;
    z = Math.max(zMin(), Math.min(z, ((W - 120) / ((hi - lo) * pw || 1)), zMax()));
  }
  // os rótulos de KM ficam na base do desenho: centraliza um pouco acima, onde estão os trilhos, mantendo o alfinete à vista
  const cy = Math.max(0.15, fy - 0.26);
  const t = clampView({ z, x: W / 2 - fx * pw * z, y: (H - DOCK_RESERVE()) / 2 - cy * ph * z });
  autoFit = false;
  animate ? animateTo(t, 700) : (V = t, apply(), scheduleRender(0));
}
export function setPins(list, { focus = true } = {}) {
  pins = (list || []).map((p) => ({ ...p }));
  if (!pins.length) { renderPins(); emitState(); return; }
  const first = pins[0];
  const go = first.page === pageNum ? Promise.resolve() : gotoPage(first.page);
  go.then(() => { renderPins(); if (focus) focusPin(first); emitState(); });
}
el.kmClear = $('vKmClear');
el.kmClear.onclick = () => { pins = []; renderPins(); emitState(); fitView('contain', true); };
el.kmChip.addEventListener('click', (e) => { if (e.target.closest('#vKmClear')) return; if (pins[0] && pins[0].page === pageNum) focusPin(pins[0]); });

/* ---------------- animação ---------------- */
function animateTo(t, ms = 260, after) {
  cancelAnimationFrame(tween); cancelAnimationFrame(momentum); momentum = 0;
  const s = { ...V }, t0 = performance.now();
  const step = (now) => {
    const k = ease(Math.min(1, (now - t0) / ms));
    V = { z: s.z + (t.z - s.z) * k, x: s.x + (t.x - s.x) * k, y: s.y + (t.y - s.y) * k };
    apply();
    if (k < 1) tween = requestAnimationFrame(step);
    else { tween = 0; scheduleRender(0); after?.(); }
  };
  tween = requestAnimationFrame(step);
  showBadge();
}
function zoomAt(newZ, cx, cy, animate = true) {
  const z = clampN(newZ, zMin(), zMax()), k = z / V.z;
  const t = clampView({ z, x: cx - (cx - V.x) * k, y: cy - (cy - V.y) * k });
  autoFit = false;
  if (animate) animateTo(t, 240); else { V = t; apply(); scheduleRender(); showBadge(); }
}
const center = () => { const { W, H } = size(); return { x: W / 2, y: (H - DOCK_RESERVE()) / 2 }; };
const zoomBy = (f) => { const c = center(); zoomAt(V.z * f, c.x, c.y); };

/* ---------------- gestos ---------------- */
const pointers = new Map();
const gesture = { active: false, mode: '', sx: 0, sy: 0, vx: 0, vy: 0, d0: 1, z0: 1, u0x: 0, u0y: 0, moved: false, t0: 0, samples: [], startX: 0, startY: 0 };
let lastTap = { t: 0, x: 0, y: 0 };

function stagePoint(e) { const r = el.stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function beginPan(p) {
  Object.assign(gesture, { active: true, mode: 'pan', sx: p.x, sy: p.y, vx: V.x, vy: V.y, samples: [{ x: p.x, y: p.y, t: performance.now() }] });
}
function beginPinch() {
  const [a, b] = [...pointers.values()];
  const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  Object.assign(gesture, { active: true, mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: V.z, u0x: (c.x - V.x) / V.z, u0y: (c.y - V.y) / V.z });
}
el.stage.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  hideHint();
  cancelAnimationFrame(tween); tween = 0; cancelAnimationFrame(momentum); momentum = 0;
  el.stage.setPointerCapture(e.pointerId);
  const p = stagePoint(e); pointers.set(e.pointerId, p);
  if (pointers.size === 1) { gesture.moved = false; gesture.t0 = performance.now(); gesture.startX = p.x; gesture.startY = p.y; beginPan(p); el.stage.classList.add('dragging'); }
  else if (pointers.size === 2) { gesture.moved = true; beginPinch(); }
});
el.stage.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  const p = stagePoint(e); pointers.set(e.pointerId, p);
  if (!gesture.active) return;
  if (gesture.mode === 'pinch' && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const z = clampN(gesture.z0 * (d / gesture.d0), zMin() * 0.9, zMax());
    V = clampView({ z, x: c.x - gesture.u0x * z, y: c.y - gesture.u0y * z });
    autoFit = false; apply(); showBadge();
  } else if (gesture.mode === 'pan') {
    const dx = p.x - gesture.sx, dy = p.y - gesture.sy;
    if (!gesture.moved && Math.hypot(p.x - gesture.startX, p.y - gesture.startY) > 6) gesture.moved = true;
    if (gesture.moved) {
      V = clampView({ z: V.z, x: gesture.vx + dx, y: gesture.vy + dy });
      autoFit = false;
      apply();
      const now = performance.now(); gesture.samples.push({ x: p.x, y: p.y, t: now });
      while (gesture.samples.length > 1 && now - gesture.samples[0].t > 90) gesture.samples.shift();
    }
  }
});
function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  const p = pointers.get(e.pointerId); pointers.delete(e.pointerId);
  try { el.stage.releasePointerCapture(e.pointerId); } catch {}
  if (pointers.size === 1) { beginPan([...pointers.values()][0]); return; }
  if (pointers.size > 0) return;
  el.stage.classList.remove('dragging');
  const wasPan = gesture.mode === 'pan', now = performance.now();
  gesture.active = false;
  if (e.type === 'pointercancel') { scheduleRender(0); return; }
  const tap = wasPan && !gesture.moved && now - gesture.t0 < 350;
  if (tap) {
    if (now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 34) { lastTap.t = 0; doubleTap(p); return; }
    lastTap = { t: now, x: p.x, y: p.y }; return;
  }
  if (wasPan && gesture.moved) {
    const s = gesture.samples, a = s[0], b = s[s.length - 1], dt = Math.max(1, b.t - a.t);
    const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
    const { W } = size(), fitsX = pw * V.z <= W - EDGE * 2;
    const totalDx = p.x - gesture.startX, totalDy = p.y - gesture.startY;
    // deslizar horizontalmente com a página inteira à vista troca de página
    if (fitsX && pdf?.numPages > 1 && Math.abs(totalDx) > 70 && Math.abs(totalDx) > Math.abs(totalDy) * 1.6 && now - b.t < 120) {
      gotoPage(pageNum + (totalDx < 0 ? 1 : -1)); return;
    }
    if (Math.hypot(vx, vy) > 0.25 && now - b.t < 80) startMomentum(vx, vy);
    else scheduleRender(60);
  } else scheduleRender(60);
}
el.stage.addEventListener('pointerup', endPointer);
el.stage.addEventListener('pointercancel', endPointer);

function startMomentum(vx, vy) {
  let last = performance.now();
  const step = (now) => {
    const dt = Math.min(32, now - last); last = now;
    const f = Math.pow(0.94, dt / 16.7); vx *= f; vy *= f;
    const nx = V.x + vx * dt, ny = V.y + vy * dt;
    const c = clampView({ z: V.z, x: nx, y: ny });
    if (Math.abs(c.x - nx) > 0.5) vx = 0; if (Math.abs(c.y - ny) > 0.5) vy = 0;
    V = c; apply();
    if (Math.hypot(vx, vy) > 0.03) momentum = requestAnimationFrame(step);
    else { momentum = 0; scheduleRender(30); }
  };
  momentum = requestAnimationFrame(step);
}
function doubleTap(p) {
  const fit = zFit('contain');
  if (V.z > fit * 1.35) fitView('contain', true);
  else zoomAt(Math.max(fit * 2.6, zFit('width') * 1.4), p.x, p.y);
}
el.stage.addEventListener('wheel', (e) => {
  e.preventDefault(); hideHint();
  const p = stagePoint(e);
  if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) { V = clampView({ ...V, x: V.x - e.deltaX }); autoFit = false; apply(); scheduleRender(); return; }
  const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? 400 : 1;
  const k = Math.exp(-(e.deltaY * unit) * (e.ctrlKey ? 0.012 : 0.0016));
  zoomAt(V.z * k, p.x, p.y, false);
}, { passive: false });
// impede o zoom nativo do Safari/iOS no palco
['gesturestart', 'gesturechange', 'gestureend'].forEach((n) => el.stage.addEventListener(n, (e) => e.preventDefault()));

/* ---------------- páginas ---------------- */
async function loadPage(n) {
  curPage = await pdf.getPage(n);
  const vp = curPage.getViewport({ scale: 1, rotation: (curPage.rotate + rot) % 360 });
  pw = vp.width; ph = vp.height;
  el.pageNow.textContent = n; el.pageTotal.textContent = pdf.numPages;
  el.prev.disabled = n <= 1; el.next.disabled = n >= pdf.numPages;
  el.pageBtn.disabled = pdf.numPages <= 1;
  [...el.pagesGrid.children].forEach((c, i) => c.classList.toggle('cur', i + 1 === n));
  renderPins();
}
async function gotoPage(n, { keepFit = true } = {}) {
  if (!pdf || n < 1 || n > pdf.numPages) return;
  pageNum = n; freeze = true;
  await loadPage(n);
  fitView(keepFit ? fitMode : 'contain');
  emitState();
}
function rotate() {
  rot = (rot + 90) % 360;
  loadPage(pageNum).then(() => { freeze = true; fitView(fitMode); });
}

/* ---------------- abrir / fechar ---------------- */
let meta = {};
export const setMeta = (m) => { meta = m || {}; };
export const isOpen = () => opened;
export const onClose = (fn) => { onCloseCb = fn; };
let stateCb = null;
export const onState = (fn) => { stateCb = fn; };
function emitState() { stateCb?.({ path: curPath, page: pageNum, km: pins[0] ? (pins[0].q || pins[0].km) : 0 }); }

function setProgress(f) {
  el.progress.classList.remove('done');
  el.progress.firstElementChild.style.width = Math.round(clampN(f, 0, 1) * 100) + '%';
}
function showError(msg) {
  el.loading.classList.remove('off'); el.loading.classList.add('err');
  el.loadingText.innerHTML = `<b>${msg}</b><br><small>Verifique se o arquivo foi enviado para a pasta <code>docs/</code> do repositório.</small>`;
  el.progress.classList.add('done');
}

export async function open({ path, title, sub = '', link = '', page = 1, pins: initPins = [] }) {
  if (opened && path === curPath) { if (initPins.length) setPins(initPins); else if (page !== pageNum) gotoPage(page); return; }
  opened = true; curPath = path; pins = (initPins || []).map((p) => ({ ...p })); el.pinsLayer.replaceChildren(); el.kmChip.hidden = true;
  closeDlMenu();
  colorDoc = !!meta[path]?.color; el.root.classList.toggle('v-color', colorDoc);
  document.body.classList.add('lock');
  el.root.classList.remove('closing'); el.root.hidden = false;
  el.title.textContent = title; el.sub.textContent = sub;
  el.loc.hidden = !link; if (link) el.loc.href = link;
  loadNight();
  el.loading.classList.remove('off', 'err'); el.loadingText.textContent = 'Carregando documento…';
  el.root.classList.remove('v-ready');
  front.classList.remove('front'); back.classList.remove('front'); R = null; freeze = true; rot = 0;
  setProgress(0.02); el.pagesGrid.innerHTML = ''; thumbToken++;
  el.pages.hidden = true; pointers.clear(); gesture.active = false;
  el.stage.focus({ preventScroll: true });
  observeResize();
  try {
    loadingTask?.destroy?.();
    const expected = (meta[path]?.kb || 0) * 1024;
    loadingTask = pdfjs.getDocument({
      url: encodeURI(path), cMapUrl: BASE + 'cmaps/', cMapPacked: true,
      standardFontDataUrl: BASE + 'standard_fonts/', wasmUrl: BASE + 'wasm/', iccUrl: BASE + 'iccs/',
    });
    loadingTask.onProgress = ({ loaded, total }) => setProgress((loaded || 0) / (total || expected || loaded * 3 || 1) * 0.9);
    const thisTask = loadingTask;
    const doc = await thisTask.promise;
    if (curPath !== path || !opened) { doc.destroy(); return; }
    pdf = doc;
  } catch (err) {
    if (curPath === path && opened) showError('Não foi possível abrir este PDF.');
    return;
  }
  setProgress(1); setTimeout(() => el.progress.classList.add('done'), 250);
  buildPagesGrid();
  pageNum = clampN(pins[0]?.page || page, 1, pdf.numPages);
  await loadPage(pageNum);
  fitView('contain'); emitState();
  if (pins.length) setTimeout(() => focusPin(pins[0]), 350); else maybeHint();
}

export function close(silent = false) {
  if (!opened) return;
  opened = false; thumbToken++;
  clearTimeout(renderTimer); try { renderTask?.cancel(); } catch {} renderGen++;
  cancelAnimationFrame(tween); cancelAnimationFrame(momentum); tween = momentum = 0;
  if (document.fullscreenElement) document.exitFullscreen?.();
  el.root.classList.add('closing');
  document.body.classList.remove('lock');
  setTimeout(() => {
    if (opened) return;
    el.root.hidden = true; el.root.classList.remove('closing');
    loadingTask?.destroy?.(); loadingTask = null; pdf = null; curPage = null; curPath = '';
    front.classList.remove('front'); back.classList.remove('front'); R = null;
  }, 280);
  if (!silent) onCloseCb?.();
}

/* ---------------- miniaturas das páginas ---------------- */
function buildPagesGrid() {
  const frag = document.createDocumentFragment(), token = ++thumbToken, doc = pdf;
  const items = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const b = document.createElement('button');
    b.className = 'pg' + (i === pageNum ? ' cur' : ''); b.type = 'button'; b.setAttribute('aria-label', 'Página ' + i);
    b.innerHTML = `<canvas width="10" height="7"></canvas><span>${i}</span>`;
    b.onclick = () => { closePages(); gotoPage(i); };
    frag.appendChild(b); items.push(b);
  }
  el.pagesGrid.replaceChildren(frag);
  el.pageBtn.disabled = doc.numPages <= 1;
  el.pagesGrid._lazy = async () => {
    for (let i = 0; i < items.length; i++) {
      if (token !== thumbToken) return;
      const cv = items[i].firstChild; if (cv.dataset.done) continue;
      try {
        const pg = await doc.getPage(i + 1), v0 = pg.getViewport({ scale: 1 });
        const sc = (220 * Math.min(devicePixelRatio || 1, 2)) / v0.width, vp = pg.getViewport({ scale: sc });
        cv.width = vp.width; cv.height = vp.height;
        const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        await pg.render({ canvasContext: ctx, canvas: cv, viewport: vp }).promise; if (!colorDoc) mono(ctx, cv.width, cv.height, false); cv.dataset.done = 1;
      } catch { return; }
    }
  };
}
function openPages() { if (!pdf || pdf.numPages < 2) return; el.pages.hidden = false; el.pagesGrid._lazy?.(); el.pagesGrid.children[pageNum - 1]?.scrollIntoView({ block: 'center' }); }
function closePages() { el.pages.hidden = true; }

/* ---------------- tema do documento / extras ---------------- */
function loadNight() {
  let v = null; try { v = localStorage.getItem('mrs-doc-night'); } catch {}
  night = v === null ? document.documentElement.dataset.theme === 'dark' : v === '1';
  el.root.classList.toggle('night', night); syncNightIcon();
}
function syncNightIcon() { el.root.querySelector('#vNight use').setAttribute('href', night ? '#i-sun' : '#i-moon'); }
function toggleNight() {
  night = !night; try { localStorage.setItem('mrs-doc-night', night ? '1' : '0'); } catch {}
  el.root.classList.toggle('night', night); syncNightIcon(); scheduleRender(0);
}
function maybeHint() {
  let seen = false; try { seen = localStorage.getItem('mrs-hint') === '1'; } catch {}
  if (seen) return;
  const touch = matchMedia('(pointer:coarse)').matches;
  el.hint.querySelector('b').textContent = touch ? 'Use dois dedos para ampliar' : 'Role o mouse para ampliar';
  el.hint.querySelector('small').textContent = touch ? 'Arraste para mover • toque duas vezes para dar zoom' : 'Arraste para mover • clique duas vezes para dar zoom';
  el.hint.classList.add('show');
  hintTimer = setTimeout(hideHint, 4200);
}
function hideHint() {
  if (!el.hint.classList.contains('show')) return;
  el.hint.classList.remove('show'); clearTimeout(hintTimer);
  try { localStorage.setItem('mrs-hint', '1'); } catch {}
}
function observeResize() {
  if (resizeObs) return;
  let w = 0, h = 0;
  resizeObs = new ResizeObserver(() => {
    if (!opened || !curPage) return;
    const { W, H } = size(); if (W === w && H === h) return; w = W; h = H;
    if (autoFit) fitView(fitMode); else { V = clampView(V); apply(); scheduleRender(120); }
  });
  resizeObs.observe(el.stage);
}
async function share() {
  const url = location.href, title = el.title.textContent;
  try { if (navigator.share) { await navigator.share({ title, url }); return; } } catch (e) { if (e?.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); toast('Link copiado'); } catch { toast('Não foi possível copiar o link'); }
}
let toastFn = null; export const setToast = (fn) => { toastFn = fn; }; const toast = (m) => toastFn?.(m);

/* ---------------- download (original / claro / escuro) ---------------- */
function closeDlMenu() { el.dlMenu.hidden = true; el.dl.setAttribute('aria-expanded', 'false'); }
el.dl.onclick = (e) => {
  e.stopPropagation();
  const show = el.dlMenu.hidden; el.dlMenu.hidden = !show; el.dl.setAttribute('aria-expanded', String(show));
  el.dlMenu.querySelectorAll('button').forEach((b) => b.classList.toggle('rec', b.dataset.mode === (night ? 'dark' : 'light')));
};
document.addEventListener('click', (e) => { if (!el.dlMenu.hidden && !e.target.closest('#vDlMenu')) closeDlMenu(); });
el.dlMenu.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-mode]'); if (!b) return;
  closeDlMenu();
  const mode = b.dataset.mode, name = curPath.split('/').pop(), base = name.replace(/\.pdf$/i, '');
  if (mode === 'original') {
    const a = document.createElement('a'); a.href = encodeURI(curPath); a.download = name; document.body.appendChild(a); a.click(); a.remove(); return;
  }
  const label = mode === 'dark' ? 'escuro' : 'claro';
  toast(`Preparando PDF ${label}…`); el.dl.classList.add('busy');
  try {
    const { downloadPdf } = await import('./pdfexport.js?v=202610231908');
    await downloadPdf(encodeURI(curPath), mode, `${base}-${label}.pdf`, (f) => { if (f > 0 && f < 1) setProgress(f); });
    el.progress.classList.add('done'); toast(`PDF ${label} baixado`);
  } catch (err) { console.warn(err); toast('Não foi possível gerar o PDF. Baixando o original.'); const a = document.createElement('a'); a.href = encodeURI(curPath); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  finally { el.dl.classList.remove('busy'); }
});

/* ---------------- botões e teclado ---------------- */
$('vClose').onclick = () => close();
$('vPrev').onclick = () => gotoPage(pageNum - 1);
$('vNext').onclick = () => gotoPage(pageNum + 1);
$('vZoomIn').onclick = () => zoomBy(1.6);
$('vZoomOut').onclick = () => zoomBy(1 / 1.6);
$('vZoomPct').onclick = () => fitView('contain', true);
$('vFit').onclick = () => fitView(fitMode === 'contain' ? 'width' : 'contain', true);
$('vRotate').onclick = rotate;
$('vNight').onclick = toggleNight;
$('vShare').onclick = share;
$('vFull').onclick = () => { document.fullscreenElement ? document.exitFullscreen() : el.root.requestFullscreen?.().catch(() => {}); };
$('vPageBtn').onclick = openPages;
$('vPagesClose').onclick = closePages;
el.pages.addEventListener('click', (e) => { if (e.target === el.pages) closePages(); });

document.addEventListener('keydown', (e) => {
  if (!opened || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key, pan = (dx, dy) => { V = clampView({ ...V, x: V.x + dx, y: V.y + dy }); autoFit = false; apply(); scheduleRender(120); };
  const fitsX = pw * V.z <= size().W - EDGE * 2;
  if (k === 'Escape') { if (!el.dlMenu.hidden) closeDlMenu(); else if (!el.pages.hidden) closePages(); else close(); }
  else if (k === '+' || k === '=') zoomBy(1.4);
  else if (k === '-' || k === '_') zoomBy(1 / 1.4);
  else if (k === '0') fitView(fitMode === 'contain' && autoFit ? 'width' : 'contain', true);
  else if (k === 'ArrowLeft') fitsX ? gotoPage(pageNum - 1) : pan(80, 0);
  else if (k === 'ArrowRight') fitsX ? gotoPage(pageNum + 1) : pan(-80, 0);
  else if (k === 'ArrowUp') pan(0, 80);
  else if (k === 'ArrowDown') pan(0, -80);
  else if (k === 'PageUp') gotoPage(pageNum - 1);
  else if (k === 'PageDown') gotoPage(pageNum + 1);
  else if (k === 'Home') gotoPage(1);
  else if (k === 'End') gotoPage(pdf?.numPages || 1);
  else if (k === 'r' || k === 'R') rotate();
  else if (k === 'n' || k === 'N') toggleNight();
  else if (k === 'f' || k === 'F') $('vFull').click();
  else return;
  e.preventDefault();
});
