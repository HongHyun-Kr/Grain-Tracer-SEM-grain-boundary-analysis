(() => {
'use strict';
const $ = id => document.getElementById(id);
const $$ = s => [...document.querySelectorAll(s)];
const tick = () => new Promise(r => setTimeout(r, 0));
const C = { gb: '#ffb000', s: ['#2a78d6', '#e0601f', '#1a9f70', '#c98500', '#d55181', '#2f7d2f', '#6a5acd', '#c83c3b'] };
const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

// ---------------- state ----------------
const S = {
  name: '', W0: 0, H0: 0, gray: null, base: null, nmpx: 1.98, sample: false, gt: null, tk: null,
  roi: null, p: { mode: 'line', pol: 'dark', f: 2, sigma: 2.4, L: 30, hi: 0.5, lo: 0.18, h: 4, merge: 0.15, minSeg: 160 },
  minEcd: 80, edge: true, cmap: 'turbo', destripe: true, xmax: null, ymax: null, brush: 5, bins: 20, hmode: 'n', view: 'overlay', tool: 'pan',
  edits: [], c: {}, res: null, dirty: true, cmode: 'bar', scaleLine: null, mergeA: null, node: 'image', wtab: 'graphics', lastMs: 0,
  label: '', cmpOn: true, ci: 0, scaleInfo: '', barlen: 2,
};
const T = { s: 1, ox: 0, oy: 0 };

// ---------------- multi-image project ----------------
// Each opened image is a document; the active one is mirrored into S (plus the overlay buffers and view transform).
const PER = ['name', 'label', 'W0', 'H0', 'gray', 'base', 'nmpx', 'sample', 'gt', 'tk', 'roi', 'p', 'edits', 'c', 'res', 'dirty', 'lastMs', 'scaleLine', 'mergeA', 'cmpOn', 'ci', 'scaleInfo', 'barlen'];
const docs = []; let cur = -1;
function snap() { const d = {}; PER.forEach(k => d[k] = S[k]); d.ov = { ovB, ovG, ovR, ovS, colors }; d.T = { ...T }; return d; }
function saveDoc() { if (cur >= 0 && docs[cur]) Object.assign(docs[cur], snap()); }
function blankDoc() { Object.assign(S, { name: '', label: '', W0: 0, H0: 0, gray: null, base: null, sample: false, gt: null, tk: null, roi: null, edits: [], c: {}, res: null, dirty: true, lastMs: 0, scaleLine: null, mergeA: null, cmpOn: true, ci: 0, scaleInfo: '' }); ovB = ovG = ovR = ovS = colors = null; }
function nextColor() { const used = new Set(docs.map(d => d.ci)); for (let i = 0; i < 8; i++) if (!used.has(i)) return i; return docs.length % 8; }
function activate(i) {
  if (i === cur && S.gray) return;
  if (running) return toast('Cannot switch images while processing.', 1);
  saveDoc(); cur = i; const d = docs[i];
  PER.forEach(k => S[k] = d[k]); ({ ovB, ovG, ovR, ovS, colors } = d.ov); Object.assign(T, d.T);
  $('empty').hidden = true; $('nmpx').value = S.nmpx.toFixed(3); $('barlen').value = $('rbBar').value = (+S.barlen || 2).toFixed(2);
  $('scaleinfo').textContent = S.scaleInfo; $('applyLineBtn').disabled = !S.scaleLine; $('ttl').textContent = `${S.name} — Grain Tracer`;
  syncDetectUI(); syncImageUI(); syncRoiUI(); renderEdits(); renderImgProps();
  if (S.dirty) markDirty(); else clearDirty();
  if (S.c.lab) stats(); else { renderKpis(); $('gt').hidden = true; $('cbar').hidden = true; render(); updateDatabar(); drawHist(); }
  resize(); renderTree(); renderCmp();
  setStatus(S.res ? `${S.name} — ${S.res.sm.n} grains` : `${S.name} — press Process`);
}
function removeImage(i) {
  if (running) return toast('Cannot close images while processing.', 1);
  saveDoc(); const d = docs.splice(i, 1)[0]; log(`Closed ${d.name}`);
  if (!docs.length) { cur = -1; blankDoc(); $('empty').hidden = false; $('ttl').textContent = 'Untitled — Grain Tracer'; $('cbar').hidden = true; $('scaleinfo').textContent = '';
    renderKpis(); renderImgProps(); renderEdits(); syncImageUI(); render(); updateDatabar(); drawHist(); renderTree(); renderCmp(); selectNode('image'); setStatus('Ready'); return; }
  const target = i < cur ? cur - 1 : Math.min(cur, docs.length - 1); cur = -1; activate(Math.max(0, target));
}
function syncImageUI() { $('imgName').value = S.label || ''; $('cmpOn').checked = !!S.cmpOn; $('imgName').disabled = $('cmpOn').disabled = !S.gray; }
const setScaleInfo = t => { S.scaleInfo = t; $('scaleinfo').textContent = t; };
// defaults in nm (tuned at 1.98 nm/px, Hitachi x25k), converted to px for the loaded image
const DEF = { mode: 'line', pol: 'dark', sigma_nm: 4.75, L_nm: 60, hi: 0.5, lo: 0.18, h_nm: 8, merge: 0.15, minSeg_nm2: 627 };
const autoF = () => { const f = Math.round(4 / S.nmpx); return Math.max(1, Math.min(4, f, S.W0 * S.H0 > 6e6 ? 4 : 2)); };
const r1 = v => Math.round(v * 10) / 10;
const fmtP = { sigma: v => v.toFixed(1) + ' px', L: v => v ? v + ' px' : 'off', hi: v => v.toFixed(2), lo: v => v.toFixed(2), h: v => v.toFixed(1) + ' px', merge: v => v ? v.toFixed(2) : 'off' };
function applyAuto(keepMode) { const k = S.nmpx, mode = keepMode ? S.p.mode : DEF.mode;
  if (mode === 'contrast') {
    const f = Math.max(1, Math.min(4, Math.round(S.W0 / 900))), u = S.W0 / 873;
    Object.assign(S.p, { mode, pol: 'bright', hi: 0.4, lo: 0.15, merge: 0.12, sigma: Math.min(8, r1(2.5 * u / 0.2) * 0.2), L: Math.min(80, 2 * Math.round(15 * u / 2)), h: Math.min(20, Math.round(4 * u * 2) / 2), minSeg: 40 * u * u, f });
  } else {
    Object.assign(S.p, { mode, pol: DEF.pol, hi: DEF.hi, lo: DEF.lo, merge: DEF.merge,
      sigma: Math.max(1, r1(DEF.sigma_nm / k / 0.2) * 0.2), L: Math.min(80, 2 * Math.round(DEF.L_nm / k / 2)), h: Math.max(0.5, Math.round(DEF.h_nm / k * 2) / 2), minSeg: DEF.minSeg_nm2 / (k * k) });
    S.p.f = autoF(); }
  syncDetectUI(); }
function syncDetectUI() {
  $('mode').value = $('rbMode').value = S.p.mode; $('destripeRow').hidden = S.p.mode !== 'contrast'; $('pol').value = S.p.pol; $('fres').value = S.p.f;
  Object.keys(fmtP).forEach(id => { $(id).value = S.p[id]; $(id + 'O').textContent = fmtP[id](S.p[id]); }); }
function markDirty() { S.dirty = true; renderTree(); if (S.res) setStatus('Parameters changed — Process to update'); $('rbProc').querySelector('span').innerHTML = 'Process<span class="dirty-dot"></span>'; }
function clearDirty() { S.dirty = false; $('rbProc').querySelector('span').textContent = 'Process'; }

// ---------------- messages / status ----------------
const now = () => new Date().toTimeString().slice(0, 8);
function log(msg, warn) { const d = document.createElement('div'); d.innerHTML = `<span class="t">${now()}</span>`; const s = document.createElement('span'); s.textContent = msg; if (warn) s.className = 'w'; d.appendChild(s); $('log').appendChild(d); $('log').parentNode.scrollTop = 1e9; }
let stT = null;
function setStatus(t, busy) { const e = $('status'); e.textContent = t; e.className = 'msg' + (busy ? ' busy' : ''); }
function toast(m, warn) { log(m, warn); setStatus(m); clearTimeout(stT); stT = setTimeout(() => setStatus(S.res ? `Ready — ${S.res.sm.n} grains · ${S.lastMs.toFixed(2)} s` : 'Ready'), 4000); }
const STAGES = ['Boundary signal', 'Line filter', 'Segmentation', 'Statistics'];
function progress(i, done) { const p = $('prog'); if (!p.children.length) p.innerHTML = STAGES.map(s => `<div class="pr"><span>${s}</span><div class="bar"><i></i></div><span>–</span></div>`).join('');
  [...p.children].forEach((r, k) => { const v = k < i || (k === i && done) ? 100 : 0; r.querySelector('i').style.width = v + '%'; r.lastElementChild.textContent = k < i || (k === i && done) ? 'Done' : k === i ? 'Running' : '–'; }); }

// ---------------- tree ----------------
const NODES = () => {
  saveDoc();
  const imgs = docs.map((d, i) => ({ id: 'doc', idx: i, icon: 'i-file', label: d.label || d.name, active: i === cur, badge: d.res ? `${d.res.sm.n} grains` : 'not processed', dirty: d.dirty && !!d.res,
    kids: i === cur ? [
      { id: 'image', icon: 'i-ruler', label: 'Scale', badge: S.nmpx.toFixed(3) + ' nm/px' },
      { id: 'roi', icon: 'i-roi', label: 'ROI' },
      { id: 'detect', icon: 'i-detect', label: 'Grain Boundary Detection', badge: S.p.mode === 'contrast' ? 'Contrast' : 'Line', dirty: S.dirty },
      { id: 'edits', icon: 'i-edit', label: 'Manual Edits', badge: S.edits.length ? String(S.edits.length) : '', off: !S.edits.length },
    ] : null }));
  const nCmp = docs.filter(d => d.cmpOn && d.res).length;
  return [
    { id: 'images', icon: 'i-open', label: 'Images', badge: docs.length ? String(docs.length) : '', off: !docs.length, kids: imgs.length ? imgs : [{ id: 'image', icon: 'i-file', label: 'No image', off: true }] },
    { id: 'stats', icon: 'i-results', label: 'Results', off: !S.res, kids: [
      { id: 'stats', icon: 'i-table', label: 'Grain Statistics', badge: S.res ? S.res.sm.n + ' grains' : '' },
      { id: 'hist', icon: 'i-hist', label: 'ECD Distribution' },
      { id: 'map', icon: 'i-size', label: 'Size Map' },
      { id: 'cmp', icon: 'i-compare', label: 'Compare', badge: nCmp ? String(nCmp) : '' },
      { id: 'export', icon: 'i-export', label: 'Export' },
    ] },
  ];
};
const TITLES = { image: 'Image', roi: 'Region of Interest', detect: 'Grain Boundary Detection', edits: 'Manual Edits', stats: 'Grain Statistics', hist: 'ECD Distribution', map: 'Size Map', cmp: 'Compare', export: 'Export' };
function renderTree() {
  const li = (n, depth, top) => {
    const sel = !top && n.id !== 'doc' && S.node === n.id;
    return `<li><div class="tn${n.off ? ' off' : ''}${n.active ? ' act' : ''}" data-node="${n.id}"${n.idx !== undefined ? ` data-idx="${n.idx}"` : ''}${top ? ' data-top="1"' : ''} style="padding-left:${6 + depth * 16}px" aria-selected="${sel}">
      <span class="tw">${n.kids ? '<svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 2l3 3 3-3" fill="none" stroke="#666" stroke-width="1.3"/></svg>' : n.id === 'doc' ? '<svg width="8" height="8" viewBox="0 0 8 8"><path d="M2 1l3 3-3 3" fill="none" stroke="#666" stroke-width="1.3"/></svg>' : ''}</span>
      <svg class="i"><use href="#${n.icon}"/></svg><span class="tl">${esc(n.label)}${n.dirty ? '<span class="dirty-dot" title="Needs Process"></span>' : ''}</span>${n.badge ? `<span class="tb">${esc(n.badge)}</span>` : ''}${n.id === 'doc' ? `<button class="xbtn tx" data-close="${n.idx}" title="Close image">✕</button>` : ''}</div>
      ${n.kids ? `<ul>${n.kids.map(k => li(k, depth + 1)).join('')}</ul>` : ''}</li>`; };
  $('tree').innerHTML = NODES().map(n => li(n, 0, true)).join('');
}
$('tree').addEventListener('click', e => {
  const x = e.target.closest('[data-close]'); if (x) { e.stopPropagation(); removeImage(+x.dataset.close); return; }
  const t = e.target.closest('.tn'); if (!t) return;
  if (t.dataset.node === 'doc') { activate(+t.dataset.idx); selectNode('image'); return; }
  if (t.dataset.top && t.dataset.node === 'images') { if (!docs.length) $('file').click(); return; }
  selectNode(t.dataset.node);
});
function selectNode(id) {
  S.node = id; $$('.sform').forEach(f => f.hidden = f.dataset.node !== id); $('setSub').textContent = TITLES[id] || id; renderTree();
  if (id === 'hist') setWtab('hist'); else if (id === 'cmp') setWtab('cmp');
  else if (id === 'map') { setWtab('graphics'); setView('size'); }
  else if (['image', 'roi', 'detect', 'edits'].includes(id)) setWtab('graphics');
  if (id === 'roi') syncRoiUI(); if (id === 'edits') renderEdits();
}
$$('[data-node]').forEach(b => { if (b.classList.contains('sbtn')) b.onclick = () => selectNode(b.dataset.node); });

// ---------------- ribbon / window tabs ----------------
$$('.rtab').forEach(b => b.onclick = () => { $$('.rtab').forEach(x => x.setAttribute('aria-selected', x === b)); $$('.rpage').forEach(p => p.hidden = p.dataset.r !== b.dataset.r); });
function setWtab(t) { S.wtab = t; $$('[data-wtab]').forEach(b => { if (b.classList.contains('wtab')) b.setAttribute('aria-selected', b.dataset.wtab === t); });
  $('stage').hidden = t !== 'graphics'; $('histWrap').hidden = t !== 'hist'; $('cdfWrap').hidden = t !== 'cmp'; $('gtool').style.visibility = t === 'graphics' ? 'visible' : 'hidden';
  if (t === 'graphics') { resize(); } else if (t === 'hist') drawHist(); else drawCdf(); }
$$('[data-wtab]').forEach(b => b.addEventListener('click', () => setWtab(b.dataset.wtab)));
$$('[data-mtab]').forEach(b => b.onclick = () => { $$('[data-mtab]').forEach(x => x.setAttribute('aria-selected', x === b)); $('log').hidden = b.dataset.mtab !== 'msg'; $('prog').hidden = b.dataset.mtab !== 'prog'; $('tblWrap').hidden = b.dataset.mtab !== 'tbl'; if (b.dataset.mtab === 'tbl') renderTable(); });

// splitters
$$('.split').forEach(sp => sp.addEventListener('pointerdown', e => { e.preventDefault(); sp.setPointerCapture(e.pointerId);
  const key = sp.dataset.split, root = key === 'bh' ? $('work').querySelector('.right') : $('work'), st = getComputedStyle(root), start = parseFloat(st.getPropertyValue('--' + key)) || { tw: 250, sw: 330, bh: 170 }[key], x0 = e.clientX, y0 = e.clientY;
  const mv = ev => { let v = key === 'bh' ? start - (ev.clientY - y0) : start + (ev.clientX - x0); v = Math.max(key === 'bh' ? 80 : 180, Math.min(key === 'bh' ? 500 : 560, v)); root.style.setProperty('--' + key, v + 'px'); };
  const up = () => { sp.removeEventListener('pointermove', mv); sp.removeEventListener('pointerup', up); resize(); drawHist(); drawCdf(); };
  sp.addEventListener('pointermove', mv); sp.addEventListener('pointerup', up); }));

// ---------------- image loading ----------------
function setImage(gray, W, H, name, nmpx, sample, gt) {
  saveDoc(); S.p = { ...S.p }; S.label = name.replace(/\.[^.]+$/, ''); S.cmpOn = true; S.ci = nextColor(); S.lastMs = 0; S.barlen = parseFloat($('barlen').value) || 2;
  S.gray = gray; S.W0 = W; S.H0 = H; S.name = name; S.sample = !!sample; S.gt = gt || null;
  S.edits = []; S.c = {}; S.res = null; ovB = ovG = ovR = ovS = null; S.scaleLine = null; S.mergeA = null; $('applyLineBtn').disabled = true;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d'), id = cx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) { const v = gray[i]; id.data[4 * i] = id.data[4 * i + 1] = id.data[4 * i + 2] = v; id.data[4 * i + 3] = 255; }
  cx.putImageData(id, 0, 0); S.base = cv; $('empty').hidden = true; $('cbar').hidden = true;
  const tk = detectTicks(false); S.tk = tk;
  S.roi = autoRoi();
  if (nmpx) S.nmpx = nmpx; else if (tk) S.nmpx = tk.nmpx;
  $('nmpx').value = S.nmpx.toFixed(3); applyAuto(true); S.xmax = S.ymax = null; $('xmax').value = $('ymax').value = '';
  setScaleInfo(nmpx ? 'Pixel size taken from Hitachi .txt.' :
    tk ? `Detected ${tk.n} ticks · spacing ${tk.sp.toFixed(1)} px → ${S.nmpx.toFixed(3)} nm/px (10-division bar)` : 'No scale ticks found. Enter the pixel size or draw a Scale Line.');
  docs.push(snap()); cur = docs.length - 1;
  syncImageUI(); $('ttl').textContent = `${name} — Grain Tracer`;
  log(`Opened ${name} (${W}×${H} px)`); log(nmpx ? `Scale: PixelSize ${nmpx} nm (.txt)` : tk ? `Scale: ${tk.n} ticks, spacing ${tk.sp.toFixed(1)} px → ${S.nmpx.toFixed(3)} nm/px` : 'Scale: no ticks found.', !nmpx && !tk);
  $('prog').innerHTML = '';
  fit(); saveDoc(); markDirty(); setStatus('Image loaded — press Process'); renderKpis(); renderImgProps(); syncRoiUI(); renderEdits(); updateDatabar(); selectNode('image'); drawHist(); renderCmp();
}
function autoRoi() { const tk = S.tk; return { x0: 0, y0: 0, x1: S.W0, y1: tk ? Math.max(10, tk.yTop - 8) : S.H0 }; }

async function loadFiles(files) {
  files = [...files]; if (!files.length) return;
  if (running) return toast('Cannot add images while processing.', 1);
  const stemOf = n => n.replace(/\.[^.]+$/, '').toLowerCase();
  const txts = files.filter(f => /\.txt$/i.test(f.name)), imgs = files.filter(f => !/\.txt$/i.test(f.name));
  const pix = {};
  for (const t of txts) { const m = (await t.text()).match(/PixelSize\s*=\s*([\d.]+)/i); if (m) pix[stemOf(t.name)] = parseFloat(m[1]); }
  if (!imgs.length) { const v = Object.values(pix)[0]; if (v && S.gray) { S.nmpx = v; $('nmpx').value = v.toFixed(3); setScaleInfo('Pixel size taken from Hitachi .txt.'); stats(); renderImgProps(); renderTree(); } else toast('This .txt file has no PixelSize entry.', 1); return; }
  for (const img of imgs) {
    setStatus('Reading ' + img.name + '…', true); await tick();
    try {
      const buf = await img.arrayBuffer(); let W, H, rgba;
      if (/\.tiff?$/i.test(img.name)) {
        if (typeof UTIF === 'undefined') throw new Error('TIFF decoder failed to load.');
        const ifds = UTIF.decode(buf); UTIF.decodeImage(buf, ifds[0]); rgba = UTIF.toRGBA8(ifds[0]); W = ifds[0].width; H = ifds[0].height;
      } else {
        const bmp = await createImageBitmap(new Blob([buf]));
        W = bmp.width; H = bmp.height; const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        const cx = cv.getContext('2d'); cx.drawImage(bmp, 0, 0); rgba = cx.getImageData(0, 0, W, H).data;
      }
      const g = new Uint8ClampedArray(W * H);
      for (let i = 0; i < W * H; i++) g[i] = Math.round(0.299 * rgba[4 * i] + 0.587 * rgba[4 * i + 1] + 0.114 * rgba[4 * i + 2]);
      const nm = pix[stemOf(img.name)] || (imgs.length === 1 && txts.length === 1 ? Object.values(pix)[0] : null);
      setImage(g, W, H, img.name, nm || null, false);
    } catch (e) { toast(`${img.name}: ${e.message || 'Could not read the image.'}`, 1); }
  }
  if (imgs.length > 1) log(`${imgs.length} images added — use Process All to run them together.`);
}
// native shell hook (macOS app: Finder "Open With" / dock drop)
window.__gtOpen = list => loadFiles(list.map(({ name, b64 }) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new File([u], name); }));
const NATIVE = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.save);

// Hitachi-style dotted scale: equally spaced short white ticks in the bottom band
function detectTicks(verbose) {
  const W = S.W0, H = S.H0, g = S.gray; if (!g) return null;
  const y0 = Math.floor(H * 0.75), minRun = Math.max(5, Math.round(H / 250)), maxH = Math.max(12, H / 50);
  const runs = [];
  for (let x = 0; x < W; x++) { let st = -1;
    for (let y = y0; y <= H; y++) { const on = y < H && g[y * W + x] >= 240;
      if (on && st < 0) st = y; else if (!on && st >= 0) { const L = y - st; if (L >= minRun && L <= maxH) runs.push([x, st, L]); st = -1; } } }
  const cand = [];
  for (const [x, y, L] of runs) { const k = cand.find(c => x - c.b <= 1 && x > c.b - 1 && Math.abs(c.ys[0] - y) <= 2);
    if (k) { k.b = x; k.ys.push(y); k.hs.push(L); } else cand.push({ a: x, b: x, ys: [y], hs: [L] }); }
  const med = a => a.slice().sort((p, q) => p - q)[a.length >> 1];
  const c = cand.filter(k => k.b - k.a <= Math.max(8, W / 300)).map(k => ({ x: (k.a + k.b) / 2, y: med(k.ys), h: med(k.hs) }));
  let best = null;
  for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) {
    const sp = c[j].x - c[i].x; if (sp < W / 100 || sp > W / 8) continue;
    const same = (p, q) => Math.abs(p.y - q.y) <= 3 && Math.abs(p.h - q.h) <= 3;
    if (!same(c[i], c[j])) continue;
    const chain = [c[i], c[j]]; let last = c[j];
    for (let k = j + 1; k < c.length; k++) { if (!same(c[k], c[i])) continue; const d = c[k].x - last.x, m = Math.round(d / sp);
      if (m >= 1 && m <= 3 && Math.abs(d - m * sp) <= 2.5) { chain.push(c[k]); last = c[k]; } else if (d > 3 * sp + 3) break; }
    const cover = Math.round((last.x - c[i].x) / sp); if (chain.length >= 4 && cover >= 6 && (!best || chain.length > best.chain.length)) best = { chain, sp };
  }
  if (!best) { if (verbose) toast('No scale ticks found. Use Scale Line to mark the bar length.', 1); return null; }
  const ch = best.chain, span = ch[ch.length - 1].x - ch[0].x, k = Math.round(span / best.sp), sp = span / k;
  const len = parseFloat($('barlen').value) || 2;
  return { n: ch.length, sp, nmpx: (len * 1000 / 10) / sp, yTop: Math.min(...ch.map(t => t.y)) };
}

// ---------------- synthetic sample (known ground truth) ----------------
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function makeSample() {
  const W = 2048, H = 1536, nmpx = 2.48, R = rng(20251113), cell = 150;
  const seeds = [];
  for (let gy = -1; gy <= Math.ceil(H / cell); gy++) for (let gx = -1; gx <= Math.ceil(W / cell); gx++) {
    if (R() < 0.18) continue;
    const n = R() < 0.3 ? 2 : 1;
    for (let k = 0; k < n; k++) seeds.push([(gx + 0.5 + (R() - 0.5) * 0.9) * cell, (gy + 0.5 + (R() - 0.5) * 0.9) * cell]);
  }
  const gw = Math.ceil(W / cell) + 3, gh = Math.ceil(H / cell) + 3, buckets = Array.from({ length: gw * gh }, () => []);
  seeds.forEach((s, i) => { const bx = Math.floor(s[0] / cell) + 1, by = Math.floor(s[1] / cell) + 1; if (bx >= 0 && by >= 0 && bx < gw && by < gh) buckets[by * gw + bx].push(i); });
  const waves = Array.from({ length: 4 }, () => [R() * 0.02 + 0.006, R() * 0.02 + 0.006, R() * 6.28, 7 + R() * 7]);
  const warp = (x, y, o) => { let d = 0; for (const [a, b, ph, A] of waves) d += A * Math.sin(a * x + b * y + ph + o); return d; };
  const lab = new Int32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const wx = x + warp(x, y, 0), wy = y + warp(y, x, 1.7), bx = Math.floor(wx / cell) + 1, by = Math.floor(wy / cell) + 1;
    let bd = 1e18, bi = 0;
    for (let j = by - 2; j <= by + 2; j++) for (let i = bx - 2; i <= bx + 2; i++) { if (i < 0 || j < 0 || i >= gw || j >= gh) continue;
      for (const k of buckets[j * gw + i]) { const dx = seeds[k][0] - wx, dy = seeds[k][1] - wy, d = dx * dx + dy * dy; if (d < bd) { bd = d; bi = k + 1; } } }
    lab[y * W + x] = bi;
  }
  const bnd = new Uint8Array(W * H);
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) { const p = y * W + x; if (lab[p] !== lab[p + 1] || lab[p] !== lab[p + W]) bnd[p] = 1; }
  const D = GB.edt(bnd, W, H);
  const off = new Float32Array(seeds.length + 1), glow = new Float32Array(seeds.length + 1);
  for (let i = 0; i <= seeds.length; i++) { off[i] = (R() - 0.5) * 10; glow[i] = R() < 0.5 ? R() * 50 : R() * 12; }
  const img = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x, d = D[p], l = lab[p];
    const st = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(x * 0.011 + Math.sin(y * 0.007) * 3));
    img[p] = 96 + off[l] + 4 * Math.sin(2 * Math.PI * x / 140) - 62 * st * Math.exp(-d * d / (2 * 1.25 * 1.25)) + (d > 1.6 ? glow[l] * Math.exp(-(d - 1.6) / 4) : 0); }
  for (let k = 0; k < 420; k++) { const cx = R() * W, cy = R() * H, s = 4 + R() * 5, A = 25 + R() * 40, r = Math.ceil(3 * s);
    for (let y = Math.max(0, cy - r | 0); y < Math.min(H, cy + r); y++) for (let x = Math.max(0, cx - r | 0); x < Math.min(W, cx + r); x++) img[y * W + x] += A * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * s * s)); }
  for (let k = 0; k < 45; k++) { const cx = R() * W, cy = R() * H, th = R() * Math.PI, len = 25 + R() * 55;
    for (let t = -len / 2; t <= len / 2; t += 0.5) { const x = Math.round(cx + t * Math.cos(th)), y = Math.round(cy + t * Math.sin(th)); if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue; img[y * W + x] -= 18; img[y * W + x + 1] -= 9; } }
  const g = new Uint8ClampedArray(W * H);
  for (let i = 0; i < W * H; i += 2) { const u = R() || 1e-9, v = R(), m = Math.sqrt(-2 * Math.log(u)); g[i] = img[i] + 21 * m * Math.cos(6.2832 * v); if (i + 1 < W * H) g[i + 1] = img[i + 1] + 21 * m * Math.sin(6.2832 * v); }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const cx = cv.getContext('2d'), id = cx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) { id.data[4 * i] = id.data[4 * i + 1] = id.data[4 * i + 2] = g[i]; id.data[4 * i + 3] = 255; }
  cx.putImageData(id, 0, 0);
  const sp = 200 / nmpx, x0 = Math.round(W * 0.535), ty = H - 95;
  cx.fillStyle = '#fff';
  for (let k = 0; k <= 10; k++) cx.fillRect(Math.round(x0 + k * sp) - 1, ty, 3, 14);
  cx.font = '600 50px Arial, sans-serif'; cx.textBaseline = 'top';
  cx.fillText('10.0kV 6.0mm x25.0k SE(U)', 55, H - 70); cx.fillText('2.00um', Math.round(x0 + 10 * sp) - 210, H - 70);
  const d2 = cx.getImageData(0, 0, W, H).data; const out = new Uint8ClampedArray(W * H);
  for (let i = 0; i < W * H; i++) out[i] = d2[4 * i];
  const yb = ty - 8, px = nmpx / 1000;
  let max = 0; for (let i = 0; i < lab.length; i++) if (lab[i] > max) max = lab[i];
  const gtG = GB.grains(lab, max, W, H, px, { x0: 0, y0: 0, x1: W, y1: yb });
  return { g: out, W, H, nmpx, gt: gtG };
}

// ---------------- pipeline ----------------
let running = false, pending = null;
async function run(from) {
  if (!S.gray) return toast('Open an image first.', 1);
  if (running) { pending = pending === 'A' || from === 'A' ? 'A' : 'B'; return; }
  running = true; const t0 = performance.now();
  try {
    const p = S.p, f = p.f, c = S.c;
    const keyA = [f, p.mode, S.destripe, p.pol, p.sigma, p.L].join('|');
    if (from === 'A' || c.keyA !== keyA) {
      setStatus('Computing boundary signal…', true); progress(0); await tick();
      const ds = GB.downsample(S.gray, S.W0, S.H0, f); c.img = ds.img; c.w = ds.W; c.h = ds.H;
      const sg = p.sigma / f; let R;
      if (p.mode === 'contrast') {
        const w = c.w, h = c.h, im = Float32Array.from(c.img);
        if (S.destripe) { // remove horizontal scan-line offsets (row mean minus its local vertical trend)
          const rm = new Float32Array(h); for (let y = 0; y < h; y++) { let a = 0; for (let x = 0; x < w; x++) a += im[y * w + x]; rm[y] = a / w; }
          for (let y = 0; y < h; y++) { let a = 0, n = 0; for (let k = -12; k <= 12; k++) { const yy = y + k; if (yy < 0 || yy >= h) continue; a += rm[yy]; n++; } const d = rm[y] - a / n; for (let x = 0; x < w; x++) im[y * w + x] -= d; } }
        const G = GB.gauss(im, w, h, sg), E = new Float32Array(w * h);
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const q = y * w + x;
          const gx = (G[q - w + 1] + 2 * G[q + 1] + G[q + w + 1]) - (G[q - w - 1] + 2 * G[q - 1] + G[q + w - 1]);
          const gy = (G[q + w - 1] + 2 * G[q + w] + G[q + w + 1]) - (G[q - w - 1] + 2 * G[q - w] + G[q - w + 1]);
          E[q] = Math.hypot(gx, gy); }
        R = GB.normalize(E, null, 0.995);
        const V = GB.normalize(GB.valley(im, w, h, [sg * 0.6, sg], p.pol, Math.max(0.6, sg * 0.6)), null, 0.995);
        for (let i = 0; i < R.length; i++) R[i] = Math.max(R[i], 0.7 * V[i]);
      } else R = GB.valley(c.img, c.w, c.h, [sg, sg * 1.67], p.pol, Math.max(0.6, sg));
      progress(1); setStatus('Line filter…', true); await tick();
      const Lw = Math.round(p.L / f); if (Lw >= 3) R = GB.lineFilter(R, c.w, c.h, Lw | 1, 12);
      c.R = R; c.keyA = keyA;
    }
    progress(2); setStatus('Segmentation…', true); await tick();
    const w = c.w, h = c.h, N = w * h;
    const rr = { x0: Math.max(0, Math.floor(S.roi.x0 / f)), y0: Math.max(0, Math.floor(S.roi.y0 / f)), x1: Math.min(w, Math.ceil(S.roi.x1 / f)), y1: Math.min(h, Math.ceil(S.roi.y1 / f)) };
    const roi = new Uint8Array(N); for (let y = rr.y0; y < rr.y1; y++) roi.fill(1, y * w + rr.x0, y * w + rr.x1);
    const Rn = GB.normalize(c.R, roi, 0.995);
    const forced = new Int8Array(N);
    for (const e of S.edits) if (e.t === 'draw' || e.t === 'erase') rasterStroke(e, f, w, h, forced, e.t === 'draw' ? 1 : -1);
    for (let i = 0; i < N; i++) { if (forced[i] > 0) Rn[i] = 1; else if (forced[i] < 0) Rn[i] = 0; }
    const B = GB.removeSmall(GB.hysteresis(Rn, w, h, p.lo, p.hi, roi), w, h, Math.max(4, Math.round(p.minSeg / (f * f))));
    for (let i = 0; i < N; i++) if (forced[i] > 0 && roi[i]) B[i] = 1;
    const D = GB.edt(B, w, h);
    const kk = 1.98 / S.nmpx, cu = S.W0 / 873; const m = GB.markers(D, w, h, p.h / f, p.mode === 'contrast' ? Math.max(1.5, 4 * cu / f) : Math.max(1.5, 3 * kk / f), roi);
    const lab = m.lab; let next = m.n + 1; const protect = new Set();
    for (const e of S.edits) if (e.t === 'seed') { const x = Math.round(e.x / f), y = Math.round(e.y / f), r = 2;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h || !roi[yy * w + xx] || dx * dx + dy * dy > r * r) continue; lab[yy * w + xx] = next; }
      protect.add(next); next++; }
    const dcap = p.mode === 'contrast' ? Math.max(4, 20 * cu / f) : Math.max(4, 30 * kk / f), relief = new Float32Array(N);
    for (let i = 0; i < N; i++) relief[i] = Math.min(1, 0.5 * Rn[i] + 0.5 * (1 - Math.min(D[i], dcap) / dcap));
    GB.watershed(relief, lab, w, h, roi);
    GB.mergeWeak(lab, GB.maxFilter(Rn, w, h), w, h, p.merge, protect);
    for (const e of S.edits) if (e.t === 'merge') {
      const a = lab[Math.round(e.a[1] / f) * w + Math.round(e.a[0] / f)], b = lab[Math.round(e.b[1] / f) * w + Math.round(e.b[0] / f)];
      if (a && b && a !== b) for (let i = 0; i < N; i++) if (lab[i] === b) lab[i] = a;
    }
    const n = GB.relabel(lab, N);
    c.Rn = Rn; c.lab = lab; c.n = n; c.rr = rr;
    progress(3); await tick();
    buildOverlay(); clearDirty(); stats(); progress(3, true);
    S.lastMs = (performance.now() - t0) / 1000;
    setStatus(`Ready — ${S.res.sm.n} grains · ${S.lastMs.toFixed(2)} s`);
    log(`${S.name}: processed in ${S.lastMs.toFixed(2)} s — ${S.res.sm.n} grains included (${S.res.all.length} segmented), mean ECD ${(S.res.sm.mean * 1000).toFixed(0)} nm`);
    saveDoc(); renderTree(); renderCmp();
  } catch (e) { console.error(e); setStatus('Error'); toast('Processing failed: ' + e.message, 1); }
  running = false;
  if (pending) { const q = pending; pending = null; run(q); }
}
function rasterStroke(e, f, w, h, out, v) {
  const r = Math.max(0.6, e.r / f), pts = e.pts.map(q => [q[0] / f, q[1] / f]);
  const dot = (cx, cy) => { for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue; if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) out[y * w + x] = v; } };
  if (pts.length === 1) dot(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) { const [ax, ay] = pts[i - 1], [bx, by] = pts[i], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 0.5));
    for (let k = 0; k <= n; k++) dot(ax + (bx - ax) * k / n, ay + (by - ay) * k / n); }
}

// ---------------- statistics ----------------
const quant = (a, q) => { if (!a.length) return NaN; const i = (a.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo); };
function summarize(list) {
  const e = list.map(g => g.ecd).sort((a, b) => a - b), n = e.length;
  if (!n) return { n: 0, sorted: [] };
  const mean = e.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(e.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  const At = list.reduce((a, g) => a + g.area, 0), aw = list.reduce((a, g) => a + g.ecd * g.area, 0) / At;
  return { n, mean, sd, d10: quant(e, .1), d50: quant(e, .5), d90: quant(e, .9), aw, ar: list.reduce((a, g) => a + g.ar, 0) / n, sorted: e };
}
function computeRes(d) {
  const c = d.c, px = d.nmpx * d.p.f / 1000;
  const all = GB.grains(c.lab, c.n, c.w, c.h, px, c.rr);
  const minE = S.minEcd / 1000;
  all.forEach(g => g.inc = (!S.edge || !g.edge) && g.ecd >= minE);
  const inc = all.filter(g => g.inc), sm = summarize(inc), it = GB.intercept(c.lab, c.w, c.h, c.rr, px, Math.max(2, Math.round(8 / d.p.f)));
  return { all, inc, sm, it, px, byId: new Map(all.map(g => [g.id, g])) };
}
function allStats() { docs.forEach((d, i) => { if (i !== cur && d.c && d.c.lab) d.res = computeRes(d); }); stats(); renderCmp(); }
function stats() {
  const c = S.c; if (!c.lab) return;
  const minE = S.minEcd / 1000;
  S.res = computeRes(S); const sm = S.res.sm; saveDoc();
  const defRoi = S.roi && (() => { const r = autoRoi(); return r.x0 === S.roi.x0 && r.y0 === S.roi.y0 && r.x1 === S.roi.x1 && r.y1 === S.roi.y1; })();
  if (S.gt && S.sample && !defRoi) { $('gt').hidden = false; $('gt').textContent = 'Ground truth applies to the default ROI only, so it is not compared after the ROI changes.'; }
  else if (S.gt && S.sample) {
    const gi = S.gt.filter(g => (!S.edge || !g.edge) && g.ecd >= minE), gs = summarize(gi);
    $('gt').hidden = false;
    $('gt').innerHTML = `<b>Ground truth</b> (synthetic sample)<br>N ${gs.n} · mean ECD ${(gs.mean * 1000).toFixed(0)} nm · D50 ${(gs.d50 * 1000).toFixed(0)} nm<br>Mean ECD error: <b>${sm.n ? ((sm.mean / gs.mean - 1) * 100).toFixed(1) : '–'} %</b>`;
  } else $('gt').hidden = true;
  $('cbar').hidden = S.view !== 'size';
  renderKpis(); drawOverlayColors(); render(); updateDatabar(); renderTree(); if (S.wtab === 'hist') drawHist(); if (!$('tblWrap').hidden) renderTable();
}
const nm = v => isFinite(v) ? (v * 1000).toFixed(0) : '–';
function renderKpis() {
  const rows = !S.res ? [['Grains included', '–'], ['Mean ECD', '–'], ['Standard deviation', '–'], ['D10 / D50 / D90', '–'], ['Area-weighted ECD', '–'], ['Mean aspect ratio', '–'], ['Mean intercept Lx / Ly', '–'], ['Lx / Ly', '–']] : (() => {
    const { sm, it, all } = S.res;
    return [['Grains included', `${sm.n} / ${all.length}`], ['Mean ECD', `${nm(sm.mean)} nm`], ['Standard deviation', `${nm(sm.sd)} nm`], ['D10 / D50 / D90', `${nm(sm.d10)} / ${nm(sm.d50)} / ${nm(sm.d90)} nm`],
      ['Area-weighted ECD', `${nm(sm.aw)} nm`], ['Mean aspect ratio', isFinite(sm.ar) ? sm.ar.toFixed(2) : '–'], ['Mean intercept Lx / Ly', `${nm(it.Lx)} / ${nm(it.Ly)} nm`], ['Lx / Ly', isFinite(it.Lx / it.Ly) ? (it.Lx / it.Ly).toFixed(3) : '–']]; })();
  $('kpis').innerHTML = rows.map(([k, v]) => `<tr><th>${k}</th><td class="n">${v}</td></tr>`).join('');
}
function renderImgProps() {
  const rows = S.gray ? [['File', S.name], ['Size', `${S.W0} × ${S.H0} px`], ['Pixel size', `${S.nmpx.toFixed(3)} nm`], ['Field of view', `${(S.W0 * S.nmpx / 1000).toFixed(2)} × ${(S.H0 * S.nmpx / 1000).toFixed(2)} µm`], ['Scale source', S.tk ? `${S.tk.n} ticks (auto)` : 'manual']] : [['File', '–']];
  $('imgProps').innerHTML = rows.map(([k, v]) => `<tr><th>${k}</th><td class="n">${esc(String(v))}</td></tr>`).join('');
  $('rbPx').textContent = S.gray ? `${S.nmpx.toFixed(3)} nm/px` : '– nm/px'; $('rbBar').value = $('barlen').value;
}
function renderTable() {
  if (!S.res) { $('dtab').innerHTML = '<tr><td style="text-align:left;border:0;padding:8px 10px;color:#888">Grains are listed here after Process.</td></tr>'; return; }
  const f = S.p.f;
  $('dtab').innerHTML = `<tr><th>ID</th><th>ECD (nm)</th><th>Area (µm²)</th><th>Major (nm)</th><th>Minor (nm)</th><th>AR</th><th>Angle (°)</th><th>x (px)</th><th>y (px)</th><th>Edge</th><th>Included</th></tr>` +
    S.res.all.map(g => `<tr${g.inc ? '' : ' class="ex"'}><td>${g.id}</td><td>${(g.ecd * 1000).toFixed(1)}</td><td>${g.area.toFixed(5)}</td><td>${(g.major * 1000).toFixed(1)}</td><td>${(g.minor * 1000).toFixed(1)}</td><td>${g.ar.toFixed(2)}</td><td>${g.angle.toFixed(1)}</td><td>${(g.cx * f).toFixed(0)}</td><td>${(g.cy * f).toFixed(0)}</td><td>${g.edge ? 'yes' : ''}</td><td>${g.inc ? 'yes' : 'no'}</td></tr>`).join('');
}

// ---------------- overlay buffers ----------------
let ovB = null, ovG = null, ovR = null, ovS = null, colors = null;
function buildOverlay() {
  const c = S.c, w = c.w, h = c.h, lab = c.lab;
  const mk = () => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; };
  ovB = mk(); ovR = mk(); ovG = mk();
  const gbc = hex(C.gb), b = ovB.getContext('2d').createImageData(w, h), r = ovR.getContext('2d').createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = y * w + x, l = lab[p];
    const isB = l && ((x < w - 1 && lab[p + 1] !== l && lab[p + 1]) || (y < h - 1 && lab[p + w] !== l && lab[p + w]));
    if (isB) { b.data[4 * p] = gbc[0]; b.data[4 * p + 1] = gbc[1]; b.data[4 * p + 2] = gbc[2]; b.data[4 * p + 3] = 255; }
    const v = c.Rn[p] * 255; r.data[4 * p] = r.data[4 * p + 1] = r.data[4 * p + 2] = v; r.data[4 * p + 3] = 255; }
  ovB.getContext('2d').putImageData(b, 0, 0); ovR.getContext('2d').putImageData(r, 0, 0);
  const R = rng(7); colors = new Uint8Array((c.n + 1) * 3);
  for (let i = 1; i <= c.n; i++) { const hh = R() * 360, s = 0.55 + R() * 0.35, l = 0.45 + R() * 0.2; const [rr, gg, bb] = hsl(hh, s, l); colors.set([rr, gg, bb], i * 3); }
}
const CMAPS = {
  turbo: t => [0.13572138 + t * (4.61539260 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943)))),
               0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604)))),
               0.10667330 + t * (12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973))))],
  jet: t => [1.5 - Math.abs(4 * t - 3), 1.5 - Math.abs(4 * t - 2), 1.5 - Math.abs(4 * t - 1)],
  plasma: t => { const K = [[0.0587, 0.0233, 0.5433], [2.1765, 0.2384, 0.7540], [-2.6895, -7.4559, 3.1108], [6.1303, 42.3462, -28.5189], [-11.1074, -82.6663, 60.1398], [10.0231, 71.4136, -54.0722], [-3.6587, -22.9315, 18.1919]];
    return [0, 1, 2].map(k => { let v = K[6][k]; for (let i = 5; i >= 0; i--) v = v * t + K[i][k]; return v; }); },
  viridis: t => { const K = [[0.2777, 0.0054, 0.3341], [0.1051, 1.4046, 1.3846], [-0.3309, 0.2148, 0.0951], [-4.6342, -5.7991, -19.3324], [6.2283, 14.1799, 56.6906], [4.7764, -13.7451, -65.3530], [-5.4355, 4.6459, 26.3124]];
    return [0, 1, 2].map(k => { let v = K[6][k]; for (let i = 5; i >= 0; i--) v = v * t + K[i][k]; return v; }); },
};
function cmap(t) { t = Math.min(1, Math.max(0, t)); return (CMAPS[S.cmap] || CMAPS.turbo)(t).map(v => Math.round(Math.min(1, Math.max(0, v)) * 255)); }
// colour range: D2–D98 of included grains (10 nm steps); x-axis maximum caps the top when set
function sizeRange() { if (!S.res || S.res.sm.n < 2) return [0, 1]; const e = S.res.sm.sorted;
  let lo = Math.floor(quant(e, 0.02) * 100) / 100, hi = Math.ceil(quant(e, 0.98) * 100) / 100; if (S.xmax) hi = Math.min(hi, S.xmax); if (hi - lo < 0.01) hi = lo + 0.01; return [lo, hi]; }
function drawSizeMap() {
  if (!S.res || !S.c.lab) return; const c = S.c, w = c.w, h = c.h, lab = c.lab, [lo, hi] = sizeRange();
  if (!ovS || ovS.width !== w || ovS.height !== h) { ovS = document.createElement('canvas'); ovS.width = w; ovS.height = h; }
  const col = new Uint8Array((c.n + 1) * 4);
  S.res.all.forEach(g => { if (g.inc) { const [r, gg, b] = cmap((g.ecd - lo) / (hi - lo)); col.set([r, gg, b, 255], g.id * 4); } else col.set([150, 150, 150, 255], g.id * 4); });
  const im = ovS.getContext('2d').createImageData(w, h);
  for (let p = 0; p < w * h; p++) { const l = lab[p]; if (!l) continue; const q = 4 * l; im.data[4 * p] = col[q]; im.data[4 * p + 1] = col[q + 1]; im.data[4 * p + 2] = col[q + 2]; im.data[4 * p + 3] = 255; }
  ovS.getContext('2d').putImageData(im, 0, 0);
  // vertical legend (high value on top)
  const cb = $('cbarC'), cx = cb.getContext('2d'); for (let y = 0; y < cb.height; y++) { const [r, gg, b] = cmap(1 - y / (cb.height - 1)); cx.fillStyle = `rgb(${r},${gg},${b})`; cx.fillRect(0, y, 1, 1); }
  const st = niceStep((hi - lo) * 1000, 5), t0 = Math.ceil(lo * 1000 / st) * st; let html = '';
  for (let v = t0; v <= hi * 1000 + 1e-6; v += st) html += `<span class="tk" style="top:${(1 - (v / 1000 - lo) / (hi - lo)) * 100}%">${Math.round(v)}</span>`;
  $('cbl').innerHTML = html;
  $('rangeInfo').textContent = `Color range: ${Math.round(lo * 1000)}–${Math.round(hi * 1000)} nm (D2–D98 of included grains${S.xmax ? ', capped by x-axis maximum' : ''}). Gray grains are excluded from statistics.`;
}
function drawOverlayColors() { drawSizeMap();
  if (!ovG || !S.res) return; const c = S.c, w = c.w, h = c.h, lab = c.lab, inc = new Uint8Array(c.n + 1);
  S.res.all.forEach(g => inc[g.id] = g.inc ? 1 : 0);
  const im = ovG.getContext('2d').createImageData(w, h);
  for (let p = 0; p < w * h; p++) { const l = lab[p]; if (!l) continue;
    if (inc[l]) { im.data[4 * p] = colors[3 * l]; im.data[4 * p + 1] = colors[3 * l + 1]; im.data[4 * p + 2] = colors[3 * l + 2]; im.data[4 * p + 3] = 255; }
    else { im.data[4 * p] = im.data[4 * p + 1] = im.data[4 * p + 2] = 150; im.data[4 * p + 3] = 255; } }
  ovG.getContext('2d').putImageData(im, 0, 0);
}
const hex = s => { s = s.replace('#', ''); return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16)); };
function hsl(h, s, l) { const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return [f(0) * 255, f(8) * 255, f(4) * 255]; }

// ---------------- graphics viewer ----------------
const view = $('view'), stage = $('stage');
const ctx = view.getContext('2d');
function resize() { const r = stage.getBoundingClientRect(); if (!r.width) return; const d = devicePixelRatio || 1; view.width = Math.round(r.width * d); view.height = Math.round(r.height * d); render(); }
function fit() { if (!S.W0) return; const r = stage.getBoundingClientRect(); if (!r.width) return; T.s = Math.min(r.width / S.W0, r.height / S.H0) * 0.96; T.ox = (r.width - S.W0 * T.s) / 2; T.oy = (r.height - S.H0 * T.s) / 2; render(); }
function zoom(k) { const r = stage.getBoundingClientRect(), sx = r.width / 2, sy = r.height / 2, ns = Math.min(16, Math.max(0.05, T.s * k)); T.ox = sx - (sx - T.ox) * ns / T.s; T.oy = sy - (sy - T.oy) * ns / T.s; T.s = ns; render(); }
const toImg = (sx, sy) => [(sx - T.ox) / T.s, (sy - T.oy) / T.s];
let live = null;
function render() {
  const d = devicePixelRatio || 1; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, view.width, view.height);
  if (!S.base) return;
  ctx.setTransform(d * T.s, 0, 0, d * T.s, d * T.ox, d * T.oy);
  ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 8 / T.s; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S.W0, S.H0); ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
  ctx.imageSmoothingEnabled = T.s < 1;
  const f = S.p.f, v = S.view;
  if (v === 'ridge' && ovR) { ctx.imageSmoothingEnabled = false; ctx.drawImage(ovR, 0, 0, ovR.width * f, ovR.height * f); }
  else ctx.drawImage(S.base, 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (v === 'size' && ovS) { ctx.globalAlpha = 0.68; ctx.drawImage(ovS, 0, 0, ovS.width * f, ovS.height * f); ctx.globalAlpha = 1; }
  if (v === 'grains' && ovG) { ctx.globalAlpha = 0.5; ctx.drawImage(ovG, 0, 0, ovG.width * f, ovG.height * f); ctx.globalAlpha = 1; }
  if (v !== 'image' && ovB) ctx.drawImage(ovB, 0, 0, ovB.width * f, ovB.height * f);
  const lw = 1 / T.s;
  if (S.roi) { const r = S.roi; ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(0, r.y1, S.W0, S.H0 - r.y1); ctx.fillRect(0, 0, S.W0, r.y0); ctx.fillRect(0, r.y0, r.x0, r.y1 - r.y0); ctx.fillRect(r.x1, r.y0, S.W0 - r.x1, r.y1 - r.y0);
    ctx.strokeStyle = '#1f63b5'; ctx.lineWidth = 1.5 * lw; ctx.setLineDash([6 * lw, 4 * lw]); ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0); ctx.setLineDash([]);
    if (S.tool === 'roi') { const hs = 8 * lw; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1f63b5'; ctx.lineWidth = 1.5 * lw;
      for (const [hx, hy] of [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1], [(r.x0 + r.x1) / 2, r.y0], [(r.x0 + r.x1) / 2, r.y1], [r.x0, (r.y0 + r.y1) / 2], [r.x1, (r.y0 + r.y1) / 2]]) { ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs); ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs); } } }
  if (live) drawEdit(live, lw);
  if (S.scaleLine) { const [a, b] = S.scaleLine; ctx.strokeStyle = '#c0398f'; ctx.lineWidth = 2 * lw; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  if (S.mergeA) { const g = grainAt(S.mergeA[0], S.mergeA[1]); if (g) { ctx.strokeStyle = '#c0398f'; ctx.lineWidth = 2 * lw; ctx.beginPath(); ctx.arc(g.cx * f, g.cy * f, Math.max(3 * lw, g.ecd / 2 / (S.nmpx / 1000)), 0, 6.283); ctx.stroke(); } }
}
function drawEdit(e, lw) {
  ctx.strokeStyle = e.t === 'draw' ? 'rgba(192,57,143,.85)' : 'rgba(31,99,181,.55)'; ctx.lineWidth = Math.max(e.r * 2, 1.5 * lw); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); e.pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); if (e.pts.length === 1) ctx.lineTo(e.pts[0][0] + 0.1, e.pts[0][1]); ctx.stroke();
}
function grainAt(x, y) { const c = S.c; if (!c.lab || !S.res) return null; const f = S.p.f, X = Math.floor(x / f), Y = Math.floor(y / f); if (X < 0 || Y < 0 || X >= c.w || Y >= c.h) return null; return S.res.byId.get(c.lab[Y * c.w + X]) || null; }

const hints = { pan: 'Pan — drag to move, wheel to zoom', roi: 'ROI — drag corners or edges to resize, drag elsewhere for a new region', scale: 'Scale line — drag along the scale bar (snaps to horizontal/vertical, Alt for free angle)', draw: 'Draw GB — drag along a missed boundary', erase: 'Erase GB — drag over a false boundary', seed: 'Split — click inside an under-segmented grain', merge: 'Merge — click two neighbouring grains' };
function roiHit(x, y) { const r = S.roi; if (!r) return ''; const t = 9 / T.s; let v = '', h = '';
  const inX = x > r.x0 - t && x < r.x1 + t, inY = y > r.y0 - t && y < r.y1 + t;
  if (inX && Math.abs(y - r.y0) < t) v = 'n'; else if (inX && Math.abs(y - r.y1) < t) v = 's';
  if (inY && Math.abs(x - r.x0) < t) h = 'w'; else if (inY && Math.abs(x - r.x1) < t) h = 'e';
  return v + h; }
const roiCursor = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };
function setTool(t) { S.tool = t; S.mergeA = null; $$('[data-tool]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === t)); setStatus(hints[t]); stage.style.cursor = t === 'pan' ? 'grab' : 'crosshair'; if (S.wtab !== 'graphics') setWtab('graphics'); render(); }
function setView(v) { S.view = v; $('cbar').hidden = v !== 'size' || !S.res; $$('[data-view]').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === v)); if (S.wtab !== 'graphics') setWtab('graphics'); render(); }

let drag = null, spaceDown = false;
stage.addEventListener('pointerdown', ev => {
  if (!S.base) return;
  if (!S.res && ['draw', 'erase', 'seed', 'merge'].includes(S.tool) && !spaceDown && ev.button !== 1) { toast('Run Process first.', 1); return; }
  stage.setPointerCapture(ev.pointerId);
  const r = stage.getBoundingClientRect(), sx = ev.clientX - r.left, sy = ev.clientY - r.top, [x, y] = toImg(sx, sy);
  const tool = (spaceDown || ev.button === 1) ? 'pan' : S.tool;
  drag = { tool, sx, sy, x, y, ox: T.ox, oy: T.oy };
  if (tool === 'pan') stage.style.cursor = 'grabbing';
  if (tool === 'draw' || tool === 'erase') live = { t: tool, r: S.brush, pts: [[x, y]] };
  if (tool === 'roi') { live = null; drag.edge = roiHit(x, y); drag.r0 = { ...S.roi }; }
  if (tool === 'seed') { addEdit({ t: 'seed', x, y }); drag = null; }
  if (tool === 'merge') { const g = grainAt(x, y); if (!g) { drag = null; return; }
    if (!S.mergeA) { S.mergeA = [x, y]; setStatus('Merge — click the neighbouring grain (Esc to cancel)'); render(); } else { const a = S.mergeA; S.mergeA = null; addEdit({ t: 'merge', a, b: [x, y] }); }
    drag = null; }
});
stage.addEventListener('pointermove', ev => {
  const r = stage.getBoundingClientRect(), sx = ev.clientX - r.left, sy = ev.clientY - r.top, [x, y] = toImg(sx, sy);
  if (drag) {
    if (drag.tool === 'pan') { T.ox = drag.ox + sx - drag.sx; T.oy = drag.oy + sy - drag.sy; render(); }
    else if (live && (drag.tool === 'draw' || drag.tool === 'erase')) { const l = live.pts[live.pts.length - 1]; if (Math.hypot(x - l[0], y - l[1]) > 1 / T.s) { live.pts.push([x, y]); render(); } }
    else if (drag.tool === 'roi' && drag.edge) { const q = { ...drag.r0 }, cx = Math.max(0, Math.min(S.W0, x)), cy = Math.max(0, Math.min(S.H0, y)), m = 20;
      if (drag.edge.includes('n')) q.y0 = Math.min(cy, q.y1 - m); if (drag.edge.includes('s')) q.y1 = Math.max(cy, q.y0 + m);
      if (drag.edge.includes('w')) q.x0 = Math.min(cx, q.x1 - m); if (drag.edge.includes('e')) q.x1 = Math.max(cx, q.x0 + m);
      S.roi = { x0: Math.round(q.x0), y0: Math.round(q.y0), x1: Math.round(q.x1), y1: Math.round(q.y1) }; drag.moved = true; render(); syncRoiUI(); updateDatabar(); }
    else if (drag.tool === 'roi') { drag.cur = [x, y]; render(); const d = devicePixelRatio || 1; ctx.setTransform(d * T.s, 0, 0, d * T.s, d * T.ox, d * T.oy); ctx.strokeStyle = '#1f63b5'; ctx.lineWidth = 1.5 / T.s; ctx.setLineDash([6 / T.s, 4 / T.s]); ctx.strokeRect(drag.x, drag.y, x - drag.x, y - drag.y); ctx.setLineDash([]); }
    else if (drag.tool === 'scale') { let ex = x, ey = y; if (!ev.altKey) { if (Math.abs(x - drag.x) >= Math.abs(y - drag.y)) ey = drag.y; else ex = drag.x; }
      S.scaleLine = [[drag.x, drag.y], [ex, ey]]; render(); }
    $('tip').hidden = true; return;
  }
  if (S.tool === 'roi' && S.base) stage.style.cursor = roiCursor[roiHit(x, y)] || 'crosshair';
  const g = grainAt(x, y), tip = $('tip');
  if (g && S.view !== 'image') { tip.hidden = false;
    tip.innerHTML = `Grain ${g.id}${g.inc ? '' : ' (excluded)'}<br>ECD: ${(g.ecd * 1000).toFixed(0)} nm<br>Area: ${g.area.toFixed(4)} µm²<br>Aspect ratio: ${g.ar.toFixed(2)}, ${g.angle.toFixed(0)}°`;
    tip.style.left = Math.min(sx + 14, r.width - tip.offsetWidth - 6) + 'px'; tip.style.top = Math.min(sy + 14, r.height - tip.offsetHeight - 6) + 'px'; }
  else tip.hidden = true;
});
stage.addEventListener('pointerleave', () => { $('tip').hidden = true; });
stage.addEventListener('pointerup', () => {
  if (!drag) return; const d = drag; drag = null; if (S.tool === 'pan') stage.style.cursor = 'grab';
  if (live && (d.tool === 'draw' || d.tool === 'erase')) { const e = live; live = null; addEdit(e); }
  else if (d.tool === 'roi' && d.edge) { if (d.moved) { markDirty(); log(`ROI: ${roiText()}`); } render(); }
  else if (d.tool === 'roi' && d.cur) { const x0 = Math.max(0, Math.min(d.x, d.cur[0])), x1 = Math.min(S.W0, Math.max(d.x, d.cur[0])), y0 = Math.max(0, Math.min(d.y, d.cur[1])), y1 = Math.min(S.H0, Math.max(d.y, d.cur[1]));
    if (x1 - x0 > 20 && y1 - y0 > 20) { S.roi = { x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x1), y1: Math.round(y1) }; markDirty(); syncRoiUI(); updateDatabar(); log(`ROI: ${roiText()}`); } render(); }
  else if (d.tool === 'scale' && S.scaleLine) { const [a, b] = S.scaleLine, L = Math.hypot(b[0] - a[0], b[1] - a[1]); $('applyLineBtn').disabled = L < 5; setScaleInfo(`Scale line ${L.toFixed(1)} px. Check the scale bar value and click Apply Line.`); selectNode('image'); }
});
stage.addEventListener('wheel', ev => { if (!S.base) return; ev.preventDefault(); const r = stage.getBoundingClientRect(), sx = ev.clientX - r.left, sy = ev.clientY - r.top;
  const k = Math.exp(-ev.deltaY * 0.0015), ns = Math.min(16, Math.max(0.05, T.s * k)); T.ox = sx - (sx - T.ox) * ns / T.s; T.oy = sy - (sy - T.oy) * ns / T.s; T.s = ns; render(); }, { passive: false });
['dragenter', 'dragover'].forEach(t => stage.addEventListener(t, e => { e.preventDefault(); $('drop').hidden = false; }));
['dragleave', 'drop'].forEach(t => stage.addEventListener(t, e => { e.preventDefault(); if (t === 'dragleave' && stage.contains(e.relatedTarget)) return; $('drop').hidden = true; }));
stage.addEventListener('drop', e => loadFiles(e.dataTransfer.files));
const roiText = () => `${S.roi.x0}, ${S.roi.y0} – ${S.roi.x1}, ${S.roi.y1} px`;

// edits
const EDIT_NAMES = { draw: 'Draw GB', erase: 'Erase GB', seed: 'Split', merge: 'Merge' };
function addEdit(e) { S.edits.push(e); log(`${EDIT_NAMES[e.t]} #${S.edits.length}`); renderEdits(); renderTree(); run('B'); }
function renderEdits() { const el = $('elist');
  el.innerHTML = S.edits.length ? S.edits.map((e, i) => { const p = e.pts ? e.pts[0] : e.a || [e.x, e.y]; return `<div><span>${i + 1}. ${EDIT_NAMES[e.t]} <span style="color:#888">(${Math.round(p[0])}, ${Math.round(p[1])})</span></span><button class="xbtn" data-i="${i}" title="Delete">✕</button></div>`; }).join('') : '<div><span style="color:#888">No edits</span></div>';
  el.querySelectorAll('.xbtn').forEach(b => b.onclick = () => { S.edits.splice(+b.dataset.i, 1); renderEdits(); renderTree(); run('B'); });
}
$('clearEdits').onclick = () => { if (!S.edits.length) return; S.edits = []; log('All manual edits cleared'); renderEdits(); renderTree(); run('B'); };
function undo() { if (!S.edits.length) return; const e = S.edits.pop(); log(`Undo ${EDIT_NAMES[e.t]}`); renderEdits(); renderTree(); run('B'); }

// ROI fields
function syncRoiUI() { if (!S.roi) return; $('roiX0').value = S.roi.x0; $('roiY0').value = S.roi.y0; $('roiX1').value = S.roi.x1; $('roiY1').value = S.roi.y1; }
['roiX0', 'roiY0', 'roiX1', 'roiY1'].forEach(id => $(id).onchange = () => { if (!S.roi) return;
  const x0 = Math.max(0, +$('roiX0').value || 0), y0 = Math.max(0, +$('roiY0').value || 0), x1 = Math.min(S.W0, +$('roiX1').value || S.W0), y1 = Math.min(S.H0, +$('roiY1').value || S.H0);
  if (x1 - x0 > 20 && y1 - y0 > 20) { S.roi = { x0, y0, x1, y1 }; markDirty(); render(); updateDatabar(); } syncRoiUI(); });
$('roiReset').onclick = () => { if (!S.gray) return; S.roi = autoRoi(); syncRoiUI(); markDirty(); render(); updateDatabar(); log(`ROI reset: ${roiText()}`); };

// keyboard
addEventListener('keydown', e => {
  if (e.target.matches('input,select,textarea')) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && k === 'z') { e.preventDefault(); undo(); return; }
  if (mod && k === 'o') { if (!NATIVE) { e.preventDefault(); $('file').click(); } return; }
  if (mod) return;
  if (e.key === ' ') { spaceDown = true; return; }
  const m = { v: 'pan', r: 'roi', s: 'scale', b: 'draw', e: 'erase', a: 'seed', m: 'merge' }[k];
  if (m) setTool(m); if (k === 'f') fit();
  if (e.key === 'Escape') { S.mergeA = null; render(); setStatus(hints[S.tool]); }
});
addEventListener('keyup', e => { if (e.key === ' ') spaceDown = false; });

// ---------------- controls ----------------
const bindRange = (id, get, set, fmt, dirty) => { const el = $(id), o = $(id + 'O'); el.value = get(); o.textContent = fmt(get());
  el.oninput = () => { set(+el.value); o.textContent = fmt(+el.value); if (!dirty) stats(); };
  el.onchange = () => { if (dirty) markDirty(); }; };
Object.keys(fmtP).forEach(id => bindRange(id, () => S.p[id], v => S.p[id] = v, fmtP[id], true));
bindRange('brush', () => S.brush, v => { S.brush = v; $('rbBrush').value = v; }, v => v + ' px', true);
$('brush').onchange = null;
bindRange('minA', () => S.minEcd, v => S.minEcd = v, v => v + ' nm', true);
$('minA').onchange = null; $('minA').oninput = () => { S.minEcd = +$('minA').value; $('minAO').textContent = S.minEcd + ' nm'; allStats(); };
bindRange('bins', () => S.bins, v => { S.bins = v; drawHist(); drawCdf(); }, v => String(v), true);
$('bins').onchange = null; $('bins').oninput = () => { S.bins = +$('bins').value; $('binsO').textContent = S.bins; drawHist(); drawCdf(); };
$('rbBrush').value = S.brush; $('rbBrush').onchange = () => { S.brush = Math.max(1, Math.min(30, +$('rbBrush').value || 5)); $('brush').value = S.brush; $('brushO').textContent = S.brush + ' px'; };
$('pol').onchange = () => { S.p.pol = $('pol').value; markDirty(); };
function setMode(v) { S.p.mode = v; applyAuto(true); markDirty(); log(`Boundary type: ${v === 'contrast' ? 'Contrast' : 'Line'} (default parameters applied)`); }
$('mode').onchange = () => setMode($('mode').value);
$('rbMode').onchange = () => setMode($('rbMode').value);
$('cmapSel').onchange = () => { S.cmap = $('cmapSel').value; drawSizeMap(); render(); drawHist(); };
$('destripe').onchange = () => { S.destripe = $('destripe').checked; markDirty(); };
$('fres').onchange = () => { S.p.f = +$('fres').value; markDirty(); };
$('xmax').onchange = () => { const v = parseFloat($('xmax').value); S.xmax = v > 0 ? v / 1000 : null; drawHist(); drawCdf(); drawSizeMap(); render(); };
$('ymax').onchange = () => { const v = parseFloat($('ymax').value); S.ymax = v > 0 ? v : null; drawHist(); };
$('hmode').onchange = () => { S.hmode = $('hmode').value; drawHist(); drawCdf(); };
$('cmode').onchange = () => { S.cmode = $('cmode').value; drawCdf(); };
$('autoG').onclick = () => { S.minEcd = 80; S.edge = true; S.xmax = S.ymax = null; $('xmax').value = $('ymax').value = ''; $('edge').checked = true;
  $('minA').value = 80; $('minAO').textContent = '80 nm';
  allStats(); // Freedman–Diaconis bins from the included set
  if (S.res && S.res.sm.n > 3) { const e = S.res.sm.sorted, iqr = quant(e, .75) - quant(e, .25), bw = 2 * iqr / Math.cbrt(e.length), xr = quant(S.res.all.map(g => g.ecd).sort((a, b) => a - b), .995) * 1.05;
    S.bins = Math.max(6, Math.min(40, Math.round(xr / (bw || xr / 15)))); $('bins').value = S.bins; $('binsO').textContent = S.bins; }
  drawHist(); drawCdf(); log(`Distribution: automatic range, ${S.bins} bins (Freedman–Diaconis)`); };
$('edge').onchange = () => { S.edge = $('edge').checked; allStats(); };
function setBar(len) { $('barlen').value = $('rbBar').value = len; if (len > 0) S.barlen = len; if (!(len > 0) || !S.tk) return;
  S.nmpx = len * 100 / S.tk.sp; $('nmpx').value = S.nmpx.toFixed(3); setScaleInfo(`Tick spacing ${S.tk.sp.toFixed(1)} px × 10 = ${len} µm → ${S.nmpx.toFixed(3)} nm/px`); log(`Scale bar ${len} µm → ${S.nmpx.toFixed(3)} nm/px`); stats(); renderImgProps(); updateDatabar(); renderTree(); }
$('barlen').onchange = () => setBar(parseFloat($('barlen').value));
$('rbBar').onchange = () => setBar(parseFloat($('rbBar').value));
$('nmpx').onchange = () => { const v = parseFloat($('nmpx').value); if (v > 0) { S.nmpx = v; setScaleInfo('Pixel size entered manually.'); log(`Pixel size set to ${v} nm`); stats(); renderImgProps(); renderTree(); } };
function detectAction() { if (!S.gray) return toast('Open an image first.', 1); const tk = detectTicks(true); S.tk = tk; if (tk) { S.nmpx = tk.nmpx; $('nmpx').value = tk.nmpx.toFixed(3); setScaleInfo(`Detected ${tk.n} ticks · spacing ${tk.sp.toFixed(1)} px → ${tk.nmpx.toFixed(3)} nm/px (10-division bar)`); log(`Scale: ${tk.n} ticks → ${tk.nmpx.toFixed(3)} nm/px`); stats(); renderImgProps(); renderTree(); } selectNode('image'); }
$('applyLineBtn').onclick = () => { if (!S.scaleLine) return; const [a, b] = S.scaleLine, L = Math.hypot(b[0] - a[0], b[1] - a[1]), len = parseFloat($('barlen').value);
  if (!(len > 0)) return toast('Enter the scale bar value.', 1); S.nmpx = len * 1000 / L; S.tk = null; $('nmpx').value = S.nmpx.toFixed(3);
  S.barlen = len; setScaleInfo(`Scale line ${L.toFixed(1)} px = ${len} µm → ${S.nmpx.toFixed(3)} nm/px`); log(`Scale line ${L.toFixed(1)} px = ${len} µm → ${S.nmpx.toFixed(3)} nm/px`); S.scaleLine = null; $('applyLineBtn').disabled = true; stats(); renderImgProps(); render(); renderTree(); };
$('imgName').onchange = () => { if (!S.gray) return; S.label = $('imgName').value.trim() || S.name.replace(/\.[^.]+$/, ''); $('imgName').value = S.label; saveDoc(); renderTree(); renderCmp(); };
$('cmpOn').onchange = () => { if (!S.gray) return; S.cmpOn = $('cmpOn').checked; saveDoc(); renderTree(); renderCmp(); };
$('file').onchange = e => { loadFiles(e.target.files); e.target.value = ''; };
async function loadSample() { setStatus('Generating synthetic sample…', true); await tick(); const s = makeSample(); setImage(s.g, s.W, s.H, 'synthetic_x25k.png', null, true, s.gt); run('A'); }

async function processAll() {
  if (!docs.length) return toast('Open an image first.', 1);
  if (running) return;
  saveDoc();
  const todo = docs.map((d, i) => i).filter(i => !docs[i].res || docs[i].dirty);
  if (!todo.length) return toast('All images are already processed.');
  const keep = cur; log(`Process All: ${todo.length} image(s)`);
  for (const i of todo) { activate(i); await run('A'); }
  activate(keep); log('Process All finished'); selectNode('cmp');
}
function applyToAll() {
  if (!S.gray || docs.length < 2) return toast('No other images to apply settings to.', 1);
  saveDoc(); const src = S.p, k0 = S.nmpx;
  docs.forEach((d, i) => { if (i === cur) return; const r = k0 / d.nmpx; // carry parameters over in nm, re-expressed in each image's pixels
    d.p = { ...src, sigma: Math.min(8, Math.max(1, Math.round(src.sigma * r * 5) / 5)), L: Math.min(80, 2 * Math.round(src.L * r / 2)), h: Math.min(20, Math.max(0.5, Math.round(src.h * r * 2) / 2)), minSeg: src.minSeg * r * r,
      f: src.mode === 'contrast' ? Math.max(1, Math.min(4, Math.round(d.W0 / 900))) : Math.max(1, Math.min(4, Math.round(4 / d.nmpx), d.W0 * d.H0 > 6e6 ? 4 : 2)) };
    d.dirty = true; });
  log(`Applied detection settings of ${S.label} to ${docs.length - 1} other image(s) (converted in nm). Run Process All to update.`); renderTree();
}
const ACTIONS = {
  open: () => $('file').click(), sample: loadSample, ticks: detectAction, process: () => run('A'), processAll, applyAll: applyToAll, close: () => { if (cur >= 0) removeImage(cur); },
  auto: () => { if (!S.gray) return toast('Open an image first.', 1); applyAuto(true); markDirty(); log(`Auto parameters for ${S.nmpx.toFixed(2)} nm/px`); },
  undo, fit, zin: () => zoom(1.25), zout: () => zoom(0.8), addcmp: addCompare,
  exGrains, exSum, exPng, exPlot, exCmp,
};
$$('[data-act]').forEach(b => b.addEventListener('click', () => ACTIONS[b.dataset.act] && ACTIONS[b.dataset.act]()));
$$('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
$$('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

function updateDatabar() {
  if (!S.W0) { $('databar').innerHTML = ''; return; }
  const r = S.roi;
  $('databar').innerHTML = `<b>${S.W0} × ${S.H0}</b> px &nbsp;|&nbsp; <b>${S.nmpx.toFixed(3)}</b> nm/px &nbsp;|&nbsp; ROI <b>${((r.x1 - r.x0) * S.nmpx / 1000).toFixed(2)} × ${((r.y1 - r.y0) * S.nmpx / 1000).toFixed(2)}</b> µm &nbsp;|&nbsp; Edits <b>${S.edits.length}</b> &nbsp;|&nbsp; Zoom <b>${Math.round(T.s * 100)}</b>%`;
}

// ---------------- plots (CAE-style 1D plot frame) ----------------
const niceStep = (span, n) => { const raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; };
function plotCanvas(cv, scale) { const r = cv.parentNode.getBoundingClientRect(), d = (devicePixelRatio || 1) * (scale || 1), w = Math.max(320, r.width), h = Math.max(220, r.height);
  cv.width = Math.round(w * d); cv.height = Math.round(h * d); const c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0); c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); return { c, w, h }; }
function frame(c, w, h, o) { // o: {xmax, ymax, title, xlab, ylab}
  const L = 70, R = 28, Tp = 46, B = 52, pw = w - L - R, ph = h - Tp - B;
  const X = v => L + v / o.xmax * pw, Y = v => Tp + ph - v / o.ymax * ph, xs = niceStep(o.xmax, 6), ys = niceStep(o.ymax, 5);
  c.font = `13px ${FONT}`; c.fillStyle = '#000'; c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(o.title, L + pw / 2, 14);
  c.font = `11.5px ${FONT}`; c.strokeStyle = '#d9d9d9'; c.lineWidth = 1;
  for (let v = 0; v <= o.ymax + 1e-9; v += ys) { const y = Math.round(Y(v)) + .5; c.beginPath(); c.moveTo(L, y); c.lineTo(L + pw, y); c.stroke(); }
  for (let v = 0; v <= o.xmax + 1e-9; v += xs) { const x = Math.round(X(v)) + .5; c.beginPath(); c.moveTo(x, Tp); c.lineTo(x, Tp + ph); c.stroke(); }
  c.fillStyle = '#000'; c.strokeStyle = '#000';
  c.textAlign = 'right'; c.textBaseline = 'middle';
  for (let v = 0; v <= o.ymax + 1e-9; v += ys) { const y = Math.round(Y(v)) + .5; c.beginPath(); c.moveTo(L - 4, y); c.lineTo(L, y); c.stroke(); c.fillText(+v.toFixed(6) + '', L - 7, y); }
  c.textAlign = 'center'; c.textBaseline = 'top';
  for (let v = 0; v <= o.xmax + 1e-9; v += xs) { const x = Math.round(X(v)) + .5; c.beginPath(); c.moveTo(x, Tp + ph); c.lineTo(x, Tp + ph + 4); c.stroke(); c.fillText(String(Math.round(v * 1000)), x, Tp + ph + 7); }
  c.font = `12px ${FONT}`; c.fillText(o.xlab, L + pw / 2, Tp + ph + 28);
  c.save(); c.translate(18, Tp + ph / 2); c.rotate(-Math.PI / 2); c.textBaseline = 'middle'; c.fillText(o.ylab, 0, 0); c.restore();
  return { L, R, Tp, ph, pw, X, Y, box: () => { c.strokeStyle = '#000'; c.lineWidth = 1; c.strokeRect(L + .5, Tp + .5, pw, ph); } };
}
function legend(c, f, items) { // CAE-style legend box at top-right inside plot
  c.font = `11.5px ${FONT}`; const lw = Math.max(...items.map(i => c.measureText(i.label).width)) + 44, lh = 18, x = f.L + f.pw - lw - 8, y = f.Tp + 8;
  c.fillStyle = 'rgba(255,255,255,.94)'; c.fillRect(x, y, lw, items.length * lh + 8); c.strokeStyle = '#999'; c.strokeRect(x + .5, y + .5, lw, items.length * lh + 8);
  items.forEach((it, i) => { const yy = y + 4 + i * lh + lh / 2; c.strokeStyle = it.color; c.fillStyle = it.color; c.lineWidth = it.dash ? 1.5 : 2;
    if (it.box) c.fillRect(x + 8, yy - 5, 22, 10); else { c.setLineDash(it.dash || []); c.beginPath(); c.moveTo(x + 8, yy); c.lineTo(x + 30, yy); c.stroke(); c.setLineDash([]); }
    c.fillStyle = '#000'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(it.label, x + 36, yy); });
}
function binVals(list, nb, bw) {
  const cnt = new Array(nb).fill(0), ar = new Array(nb).fill(0); let At = 0;
  list.forEach(([e, a]) => { const i = Math.min(nb - 1, Math.floor(e / bw)); cnt[i]++; ar[i] += a; At += a; });
  return { cnt, val: cnt.map((n, i) => list.length ? 100 * (S.hmode === 'n' ? n / list.length : ar[i] / At) : 0) };
}
let histGeo = null;
function drawHist(scale) {
  const cv = $('hist'); if (cv.parentNode.hidden && !scale) return; const { c, w, h } = plotCanvas(cv, scale); histGeo = null;
  const ylab = S.hmode === 'n' ? 'Number fraction (%)' : 'Area fraction (%)', title = `ECD distribution${S.name ? ' — ' + S.name : ''}`;
  if (!S.res) { const f = frame(c, w, h, { xmax: 1, ymax: 20, title, xlab: 'ECD (nm)', ylab }); f.box(); c.fillStyle = '#888'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `12px ${FONT}`; c.fillText('Shown after Process', f.L + f.pw / 2, f.Tp + f.ph / 2); return; }
  const allE = S.res.all.map(g => g.ecd).sort((a, b) => a - b), xmax0 = Math.max(0.1, quant(allE, 0.995) * 1.05);
  const xs = niceStep(xmax0, 6), xmax = S.xmax || Math.ceil(xmax0 / xs) * xs, nb = S.bins, bw = xmax / nb;
  const inc = S.res.inc, sm = S.res.sm, { cnt, val } = binVals(inc.map(g => [g.ecd, g.area]), nb, bw);
  const ymax0 = Math.max(5, ...val) * 1.08, ys = niceStep(ymax0, 5), ymax = S.ymax || Math.ceil(ymax0 / ys) * ys;
  const f = frame(c, w, h, { xmax, ymax, title, xlab: 'ECD (nm)', ylab }), base = f.Tp + f.ph;
  const mE = S.minEcd / 1000; if (mE > 0) { const xe = f.X(Math.min(mE, xmax)); c.fillStyle = 'rgba(0,0,0,.06)'; c.fillRect(f.L, f.Tp, xe - f.L, f.ph); }
  const sz = S.view === 'size', [clo, chi] = sizeRange();
  for (let i = 0; i < nb; i++) { if (!val[i]) continue; const x0 = f.X(i * bw), x1 = f.X((i + 1) * bw), y = Math.max(f.Tp, f.Y(val[i]));
    c.fillStyle = sz ? `rgb(${cmap(((i + 0.5) * bw - clo) / (chi - clo)).join(',')})` : '#4f81bd'; c.fillRect(x0, y, x1 - x0, base - y);
    c.strokeStyle = sz ? 'rgba(0,0,0,.45)' : '#2f5b8f'; c.lineWidth = 1; c.strokeRect(Math.round(x0) + .5, Math.round(y) + .5, Math.round(x1 - x0), Math.round(base - y)); }
  const items = [{ label: S.hmode === 'n' ? 'Number fraction' : 'Area fraction', color: sz ? '#888' : '#4f81bd', box: true }];
  if (sm.n) { const mx = f.X(Math.min(sm.mean, xmax)); c.strokeStyle = '#c00000'; c.lineWidth = 1.5; c.setLineDash([6, 4]); c.beginPath(); c.moveTo(mx, f.Tp); c.lineTo(mx, base); c.stroke(); c.setLineDash([]);
    items.push({ label: `Mean ECD = ${nm(sm.mean)} nm`, color: '#c00000', dash: [6, 4] }, { label: `D50 = ${nm(sm.d50)} nm, N = ${sm.n}`, color: 'transparent' }); }
  f.box(); legend(c, f, items);
  histGeo = { bw, nb, val, cnt, L: f.L, pw: f.pw, xmax };
}
$('hist').addEventListener('pointermove', e => { const g = histGeo, tip = $('ctip'); if (!g) return; const r = e.target.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const i = Math.floor((x - g.L) / g.pw * g.xmax / g.bw); if (i < 0 || i >= g.nb) { tip.hidden = true; return; }
  tip.hidden = false; tip.innerHTML = `ECD: ${(i * g.bw * 1000).toFixed(0)}–${((i + 1) * g.bw * 1000).toFixed(0)} nm<br>${S.hmode === 'n' ? 'Number' : 'Area'} fraction: ${g.val[i].toFixed(1)} %<br>Count: ${g.cnt[i]}`;
  tip.style.left = Math.min(x + 14, r.width - tip.offsetWidth - 4) + 'px'; tip.style.top = Math.min(y + 14, r.height - tip.offsetHeight - 4) + 'px'; });
$('hist').addEventListener('pointerleave', () => $('ctip').hidden = true);

// compare — built from the open images (checked = included), so every image stays editable
let CMP = [];
function refreshCmp() { saveDoc(); CMP = docs.filter(d => d.cmpOn && d.res && d.res.sm.n).map(d => ({ tag: d.label || d.name, ci: d.ci, sm: d.res.sm, it: d.res.it, nmpx: d.nmpx, file: d.name, g: d.res.inc.map(g => [g.ecd, g.area]) })); }
function addCompare() {
  if (!S.res || !S.res.sm.n) return toast('No results to compare. Run Process first.', 1);
  S.cmpOn = true; syncImageUI(); log(`"${S.label}" included in Compare`); renderCmp(); renderTree(); selectNode('cmp');
}
function renderCmp() {
  refreshCmp(); const t = $('cmpT');
  if (!docs.length) { t.innerHTML = `<tr><td class="note" style="white-space:normal;border:0">Open several images and process them to compare their distributions on the same axes.</td></tr>`; drawCdf(); return; }
  t.innerHTML = `<tr><th style="width:18px"></th><th style="width:auto">Image</th><th style="width:auto;text-align:right">N</th><th style="width:auto;text-align:right">Mean</th><th style="width:auto;text-align:right">Lx/Ly</th></tr>` + docs.map((d, i) =>
    `<tr><td><input type="checkbox" data-ci="${i}" ${d.cmpOn ? 'checked' : ''} ${d.res ? '' : 'disabled'}></td><td style="max-width:130px;overflow:hidden;text-overflow:ellipsis"><span class="chip" style="background:${C.s[d.ci]}"></span>${esc(d.label || d.name)}</td><td class="n">${d.res ? d.res.sm.n : '–'}</td><td class="n">${d.res ? nm(d.res.sm.mean) : '–'}</td><td class="n">${d.res ? (d.res.it.Lx / d.res.it.Ly).toFixed(2) : '–'}</td></tr>`).join('');
  t.querySelectorAll('[data-ci]').forEach(b => b.onchange = () => { const i = +b.dataset.ci; docs[i].cmpOn = b.checked; if (i === cur) { S.cmpOn = b.checked; syncImageUI(); } renderTree(); renderCmp(); });
  drawCdf();
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let cdfGeo = null;
function drawCdf(scale) {
  const cv = $('cdf'); if (cv.parentNode.hidden && !scale) return; refreshCmp(); const { c, w, h } = plotCanvas(cv, scale); cdfGeo = null;
  if (!CMP.length) { const f = frame(c, w, h, { xmax: 1, ymax: 100, title: 'Compare', xlab: 'ECD (nm)', ylab: 'Fraction (%)' }); f.box(); c.fillStyle = '#888'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `12px ${FONT}`; c.fillText('Open and process several images to compare them here', f.L + f.pw / 2, f.Tp + f.ph / 2); return; }
  const xmax0 = Math.max(...CMP.map(s => quant(s.sm.sorted, 0.99))) * 1.05, xs0 = niceStep(xmax0, 6), xmax = S.xmax || Math.ceil(xmax0 / xs0) * xs0;
  const items = CMP.map(s => ({ label: `${s.tag} (N = ${s.sm.n}, mean ${nm(s.sm.mean)} nm)`, color: C.s[s.ci], box: S.cmode === 'bar' }));
  if (S.cmode === 'bar') {
    const nb = Math.max(6, Math.min(S.bins, 16)), bw = xmax / nb, sets = CMP.map(s => binVals(s.g, nb, bw));
    const ymax0 = Math.max(5, ...sets.flatMap(v => v.val)) * 1.08, ys = niceStep(ymax0, 5), ymax = Math.ceil(ymax0 / ys) * ys;
    const f = frame(c, w, h, { xmax, ymax, title: 'ECD distribution — comparison', xlab: 'ECD (nm)', ylab: S.hmode === 'n' ? 'Number fraction (%)' : 'Area fraction (%)' }), base = f.Tp + f.ph, k = CMP.length;
    for (let i = 0; i < nb; i++) { const x0 = f.X(i * bw) + 2, x1 = f.X((i + 1) * bw) - 2, sw = (x1 - x0) / k;
      CMP.forEach((s, j) => { const y = Math.max(f.Tp, f.Y(sets[j].val[i])); if (base - y < .3) return; c.fillStyle = C.s[s.ci]; c.fillRect(x0 + j * sw, y, sw, base - y); c.strokeStyle = 'rgba(0,0,0,.35)'; c.strokeRect(Math.round(x0 + j * sw) + .5, Math.round(y) + .5, Math.round(sw), Math.round(base - y)); }); }
    f.box(); legend(c, f, items); cdfGeo = { mode: 'bar', L: f.L, pw: f.pw, xmax, nb, bw, sets }; return;
  }
  const f = frame(c, w, h, { xmax, ymax: 100, title: 'Cumulative ECD distribution', xlab: 'ECD (nm)', ylab: 'Cumulative number fraction (%)' });
  for (const s of CMP) { const e = s.sm.sorted, n = e.length; c.strokeStyle = C.s[s.ci]; c.lineWidth = 2; c.beginPath(); c.moveTo(f.X(0), f.Y(0));
    e.forEach((v, i) => { c.lineTo(f.X(Math.min(v, xmax)), f.Y(100 * i / n)); c.lineTo(f.X(Math.min(v, xmax)), f.Y(100 * (i + 1) / n)); }); c.lineTo(f.X(xmax), f.Y(100)); c.stroke(); }
  f.box(); legend(c, f, items); cdfGeo = { mode: 'cdf', L: f.L, pw: f.pw, xmax };
}
$('cdf').addEventListener('pointermove', e => { const g = cdfGeo, tip = $('dtip'); if (!g) return; const r = e.target.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, v = (x - g.L) / g.pw * g.xmax;
  if (v < 0 || v > g.xmax) { tip.hidden = true; return; } tip.hidden = false;
  if (g.mode === 'bar') { const i = Math.min(g.nb - 1, Math.floor(v / g.bw));
    tip.innerHTML = `ECD: ${(i * g.bw * 1000).toFixed(0)}–${((i + 1) * g.bw * 1000).toFixed(0)} nm<br>` + CMP.map((s, j) => `<span class="chip" style="background:${C.s[s.ci]}"></span>${esc(s.tag)}: ${g.sets[j].val[i].toFixed(1)} %`).join('<br>'); }
  else tip.innerHTML = `ECD ≤ ${(v * 1000).toFixed(0)} nm<br>` + CMP.map(s => { const e = s.sm.sorted; let k = 0; while (k < e.length && e[k] <= v) k++; return `<span class="chip" style="background:${C.s[s.ci]}"></span>${esc(s.tag)}: ${(100 * k / e.length).toFixed(0)} %`; }).join('<br>');
  tip.style.left = Math.max(0, Math.min(x + 14, r.width - tip.offsetWidth - 4)) + 'px'; tip.style.top = Math.min(y + 14, r.height - tip.offsetHeight - 4) + 'px'; });
$('cdf').addEventListener('pointerleave', () => $('dtip').hidden = true);

// ---------------- export ----------------
let dl = null; (async () => { try { if (window.claude && window.claude.use) dl = await window.claude.use('downloads'); } catch (e) { dl = null; } })();
async function save(filename, data) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/plain' });
  const mac = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.save;
  if (mac) { const b = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    mac.postMessage({ name: filename, data: btoa(s) }); log(`Export: ${filename}`); return; }
  if (dl) { try { await dl.save({ filename, data: blob }); log(`Saved ${filename}`); } catch (e) { if (e && e.code !== 'declined') toast('Save failed: ' + (e.message || e.code), 1); } return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); log(`Saved ${filename}`);
}
const stem = () => (S.name || 'sem').replace(/\.[^.]+$/, '');
const csv = rows => '﻿' + rows.map(r => r.map(v => typeof v === 'string' && /[,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(',')).join('\n');
const paramRows = () => [['file', S.name], ['pixel_nm', S.nmpx], ['working_scale', S.p.f], ['gb_type', S.p.mode], ['polarity', S.p.pol], ['line_sigma_px', S.p.sigma], ['line_filter_px', S.p.L], ['thr_high', S.p.hi], ['thr_low', S.p.lo], ['seed_h_px', S.p.h], ['merge_weak', S.p.merge], ['min_ecd_nm', S.minEcd], ['exclude_edge', S.edge], ['roi_px', `${S.roi.x0} ${S.roi.y0} ${S.roi.x1} ${S.roi.y1}`], ['manual_edits', S.edits.length]];
const need = () => { if (!S.res) { toast('Run Process first.', 1); return false; } return true; };
function exGrains() { if (!need()) return; const f = S.p.f;
  save(stem() + '_grains.csv', csv([['id', 'area_um2', 'ECD_um', 'major_um', 'minor_um', 'aspect_ratio', 'angle_deg', 'cx_px', 'cy_px', 'touches_roi_edge', 'included'],
    ...S.res.all.map(g => [g.id, g.area.toFixed(6), g.ecd.toFixed(5), g.major.toFixed(5), g.minor.toFixed(5), g.ar.toFixed(3), g.angle.toFixed(1), (g.cx * f).toFixed(1), (g.cy * f).toFixed(1), g.edge ? 1 : 0, g.inc ? 1 : 0])])); }
function exSum() { if (!need()) return; const { sm, it } = S.res;
  save(stem() + '_summary.csv', csv([['metric', 'value'], ['N_grains', sm.n], ['mean_ECD_um', sm.mean], ['sd_ECD_um', sm.sd], ['D10_um', sm.d10], ['D50_um', sm.d50], ['D90_um', sm.d90], ['area_weighted_ECD_um', sm.aw], ['mean_aspect_ratio', sm.ar], ['intercept_Lx_um', it.Lx], ['intercept_Ly_um', it.Ly], ['Lx_over_Ly', it.Lx / it.Ly], ...paramRows()])); }
function exCmp() { refreshCmp(); if (!CMP.length) return toast('The Compare list is empty.', 1);
  save('grain_compare.csv', csv([['tag', 'file', 'pixel_nm', 'N', 'mean_ECD_um', 'sd_um', 'D10_um', 'D50_um', 'D90_um', 'area_weighted_ECD_um', 'mean_AR', 'Lx_um', 'Ly_um'],
    ...CMP.map(s => [s.tag, s.file, s.nmpx, s.sm.n, s.sm.mean, s.sm.sd, s.sm.d10, s.sm.d50, s.sm.d90, s.sm.aw, s.sm.ar, s.it.Lx, s.it.Ly])])); }
function exPng() { if (!S.base) return toast('Open an image first.', 1); const cv = document.createElement('canvas'); cv.width = S.W0; cv.height = S.H0; const c = cv.getContext('2d'), f = S.p.f, v = S.view;
  if (v === 'ridge' && ovR) { c.imageSmoothingEnabled = false; c.drawImage(ovR, 0, 0, ovR.width * f, ovR.height * f); } else c.drawImage(S.base, 0, 0);
  c.imageSmoothingEnabled = false;
  if (v === 'grains' && ovG) { c.globalAlpha = .5; c.drawImage(ovG, 0, 0, ovG.width * f, ovG.height * f); c.globalAlpha = 1; }
  if (v === 'size' && ovS) { c.globalAlpha = .68; c.drawImage(ovS, 0, 0, ovS.width * f, ovS.height * f); c.globalAlpha = 1; }
  if (v !== 'image' && ovB) c.drawImage(ovB, 0, 0, ovB.width * f, ovB.height * f);
  if (v === 'size' && S.res) burnColorbar(c, S.W0);
  const sfx = { image: '_image', overlay: '_boundaries', grains: '_grains', size: `_size_map_${S.cmap}`, ridge: '_signal' }[v];
  cv.toBlob(b => save(stem() + sfx + '.png', b), 'image/png'); }
// vertical colour legend in the exported image (inside the ROI, top-right)
function burnColorbar(c, W) {
  const [lo, hi] = sizeRange(), u = W / 1000, bw = Math.round(18 * u), bh = Math.round(300 * u), pad = Math.round(12 * u), fs = Math.max(10, Math.round(15 * u));
  c.font = `${fs}px ${FONT}`; const st = niceStep((hi - lo) * 1000, 5), t0 = Math.ceil(lo * 1000 / st) * st; let tw = c.measureText('ECD (nm)').width;
  for (let v = t0; v <= hi * 1000 + 1e-6; v += st) tw = Math.max(tw, bw + pad * .8 + c.measureText(String(Math.round(v))).width);
  const boxW = tw + pad * 2, boxH = bh + fs + pad * 3, x0 = Math.min(W, S.roi.x1) - boxW - pad, y0 = S.roi.y0 + pad;
  c.fillStyle = 'rgba(255,255,255,.9)'; c.fillRect(x0, y0, boxW, boxH); c.strokeStyle = '#888'; c.lineWidth = Math.max(1, u); c.strokeRect(x0, y0, boxW, boxH);
  c.fillStyle = '#111'; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('ECD (nm)', x0 + pad, y0 + pad);
  const by = y0 + pad * 2 + fs, bx = x0 + pad;
  for (let i = 0; i < bh; i++) { const [r, g, b] = cmap(1 - i / (bh - 1)); c.fillStyle = `rgb(${r},${g},${b})`; c.fillRect(bx, by + i, bw, 1); }
  c.strokeStyle = '#333'; c.strokeRect(bx, by, bw, bh); c.fillStyle = '#111'; c.textBaseline = 'middle';
  for (let v = t0; v <= hi * 1000 + 1e-6; v += st) { const y = by + (1 - (v / 1000 - lo) / (hi - lo)) * bh; c.fillRect(bx + bw, Math.round(y), Math.round(5 * u), Math.max(1, Math.round(u))); c.fillText(String(Math.round(v)), bx + bw + pad * .8, y); }
}
function exPlot() { const t = S.wtab === 'cmp' ? 'cmp' : 'hist'; const host = t === 'cmp' ? $('cdfWrap') : $('histWrap');
  const real = t === 'cmp' ? $('cdf') : $('hist'), wasHidden = host.hidden; host.hidden = false;
  if (t === 'cmp') drawCdf(2); else drawHist(2);
  real.toBlob(b => { save(stem() + (t === 'cmp' ? '_compare.png' : '_ecd_distribution.png'), b); host.hidden = wasHidden; if (t === 'cmp') drawCdf(); else drawHist(); }, 'image/png'); }

// ---------------- init ----------------
new ResizeObserver(() => { resize(); updateDatabar(); }).observe(stage);
new ResizeObserver(() => drawHist()).observe($('histWrap'));
new ResizeObserver(() => drawCdf()).observe($('cdfWrap'));
stage.addEventListener('wheel', () => updateDatabar(), { passive: true });
$('rbBar').value = $('barlen').value;
syncDetectUI(); syncImageUI(); setTool('pan'); setView('overlay'); renderCmp(); renderKpis(); renderImgProps(); renderEdits(); selectNode('image'); setWtab('graphics');
log('Grain Tracer ready. Open an SEM image (⌘O) or load the synthetic sample.');
setStatus('Ready');
window.__S = S;
})();
