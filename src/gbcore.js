// GrainBoundary core: valley/ridge detection -> line filter -> hysteresis -> EDT -> h-maxima markers -> seeded watershed -> merge -> stats
const GB = (() => {
  function downsample(src, W, H, f) {
    if (f === 1) return { img: Float32Array.from(src), W, H };
    const w = Math.floor(W / f), h = Math.floor(H / f), out = new Float32Array(w * h), n = f * f;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let j = 0; j < f; j++) { const r = (y * f + j) * W + x * f; for (let i = 0; i < f; i++) s += src[r + i]; }
      out[y * w + x] = s / n;
    }
    return { img: out, W: w, H: h };
  }

  function gauss(img, W, H, s) {
    if (s <= 0) return Float32Array.from(img);
    const r = Math.ceil(3 * s), k = new Float32Array(2 * r + 1); let ks = 0;
    for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * s * s)); ks += k[i + r]; }
    for (let i = 0; i < k.length; i++) k[i] /= ks;
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) { const o = y * W;
      for (let x = 0; x < W; x++) { let a = 0;
        if (x >= r && x < W - r) for (let i = -r; i <= r; i++) a += k[i + r] * img[o + x + i];
        else for (let i = -r; i <= r; i++) { let xx = x + i; xx = xx < 0 ? -xx : xx >= W ? 2 * W - xx - 2 : xx; a += k[i + r] * img[o + xx]; }
        tmp[o + x] = a; } }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0;
      if (y >= r && y < H - r) for (let i = -r; i <= r; i++) a += k[i + r] * tmp[(y + i) * W + x];
      else for (let i = -r; i <= r; i++) { let yy = y + i; yy = yy < 0 ? -yy : yy >= H ? 2 * H - yy - 2 : yy; a += k[i + r] * tmp[yy * W + x]; }
      out[y * W + x] = a; }
    return out;
  }

  // Valley detector: Hessian gives the line normal; both sides along the normal must be brighter (dark line) or darker (bright line)
  // than the centre. Rejects one-sided edges such as rims of bright particles.
  function valley(img, W, H, scales, polarity, sSmooth) {
    const S = gauss(img, W, H, sSmooth), R = new Float32Array(W * H);
    const bil = (x, y) => { if (x < 0) x = 0; if (y < 0) y = 0; if (x > W - 1.001) x = W - 1.001; if (y > H - 1.001) y = H - 1.001;
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, p = y0 * W + x0;
      return (S[p] * (1 - fx) + S[p + 1] * fx) * (1 - fy) + (S[p + W] * (1 - fx) + S[p + W + 1] * fx) * fy; };
    const pols = polarity === 'both' ? ['dark', 'bright'] : [polarity];
    for (const s of scales) {
      const G = gauss(img, W, H, s), d = 2 * s;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const p = y * W + x, c = G[p];
        const xx = G[p - 1] - 2 * c + G[p + 1], yy = G[p - W] - 2 * c + G[p + W];
        const xy = (G[p - W - 1] + G[p + W + 1] - G[p - W + 1] - G[p + W - 1]) / 4;
        const m = (xx + yy) / 2, dd = Math.sqrt((xx - yy) * (xx - yy) / 4 + xy * xy);
        for (const pl of pols) {
          const lam = pl === 'dark' ? m + dd : m - dd;
          if (pl === 'dark' ? lam <= 0 : lam >= 0) continue;
          let ex = xy, ey = lam - xx; if (Math.abs(ex) + Math.abs(ey) < 1e-9) { ex = lam - yy; ey = xy; }
          if (Math.abs(ex) + Math.abs(ey) < 1e-9) { ex = 1; ey = 0; }
          const nn = Math.hypot(ex, ey); ex /= nn; ey /= nn;
          const a = bil(x + ex * d, y + ey * d), b = bil(x - ex * d, y - ey * d), c0 = S[p];
          const v = pl === 'dark' ? Math.min(a, b) - c0 : c0 - Math.max(a, b);
          if (v > R[p]) R[p] = v;
        }
      }
    }
    return R;
  }

  // Oriented line-mean filter: max over nAng orientations of the mean along a segment of length L
  function lineFilter(R, W, H, L, nAng) {
    const out = new Float32Array(W * H), half = Math.floor(L / 2);
    for (let a = 0; a < nAng; a++) {
      const th = Math.PI * a / nAng, ux = Math.cos(th), uy = Math.sin(th);
      const dxs = [], dys = []; for (let t = -half; t <= half; t++) { dxs.push(Math.round(t * ux)); dys.push(Math.round(t * uy)); }
      const n = dxs.length, offs = new Int32Array(n); for (let k = 0; k < n; k++) offs[k] = dys[k] * W + dxs[k];
      for (let y = 0; y < H; y++) { const inY = y >= half && y < H - half;
        for (let x = 0; x < W; x++) { const p = y * W + x; let s = 0, c = 0;
          if (inY && x >= half && x < W - half) { for (let k = 0; k < n; k++) s += R[p + offs[k]]; c = n; }
          else for (let k = 0; k < n; k++) { const xx = x + dxs[k], yy = y + dys[k]; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; s += R[yy * W + xx]; c++; }
          const v = s / c; if (v > out[p]) out[p] = v; } }
    }
    return out;
  }

  // robust normalisation: median -> 0, percentile pct -> 1
  function normalize(R, mask, pct) {
    const vals = []; const step = Math.max(1, Math.floor(R.length / 200000));
    for (let i = 0; i < R.length; i += step) if (!mask || mask[i]) vals.push(R[i]);
    vals.sort((a, b) => a - b);
    const lo = vals[Math.floor((vals.length - 1) * 0.5)] || 0, hi = vals[Math.floor((vals.length - 1) * pct)] || 1, sc = hi - lo || 1;
    const out = new Float32Array(R.length);
    for (let i = 0; i < R.length; i++) out[i] = Math.min(Math.max((R[i] - lo) / sc, 0), 1);
    return out;
  }

  function hysteresis(Rn, W, H, lo, hi, roi) {
    const B = new Uint8Array(W * H), st = new Int32Array(W * H); let sp = 0;
    for (let i = 0; i < B.length; i++) if (Rn[i] > hi && (!roi || roi[i])) { B[i] = 1; st[sp++] = i; }
    while (sp) { const p = st[--sp], x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; const q = yy * W + xx;
          if (!B[q] && Rn[q] > lo && (!roi || roi[q])) { B[q] = 1; st[sp++] = q; } } } }
    return B;
  }

  function cc(bin, W, H) {
    const lab = new Int32Array(W * H), stack = new Int32Array(W * H), sizes = [0]; let n = 0;
    for (let p0 = 0; p0 < W * H; p0++) {
      if (!bin[p0] || lab[p0]) continue; n++; let sp = 0, cnt = 0; stack[sp++] = p0; lab[p0] = n;
      while (sp) { const p = stack[--sp]; cnt++; const x = p % W, y = (p / W) | 0;
        for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; const q = yy * W + xx;
            if (bin[q] && !lab[q]) { lab[q] = n; stack[sp++] = q; } } } }
      sizes.push(cnt);
    }
    return { lab, n, sizes };
  }

  function removeSmall(B, W, H, minSize) {
    const c = cc(B, W, H);
    for (let i = 0; i < B.length; i++) if (B[i] && c.sizes[c.lab[i]] < minSize) B[i] = 0;
    return B;
  }

  // exact Euclidean distance to nearest feature pixel (Felzenszwalb & Huttenlocher)
  function edt(bin, W, H) {
    const INF = 1e20, M = Math.max(W, H), f = new Float64Array(M), d = new Float64Array(M),
      v = new Int32Array(M), z = new Float64Array(M + 1), D = new Float64Array(W * H);
    const pass = (n) => { let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
      for (let q = 1; q < n; q++) {
        let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
        k++; v[k] = q; z[k] = s; z[k + 1] = INF; }
      k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; } };
    for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) f[y] = bin[y * W + x] ? 0 : INF; pass(H); for (let y = 0; y < H; y++) D[y * W + x] = d[y]; }
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) f[x] = D[y * W + x]; pass(W); for (let x = 0; x < W; x++) out[y * W + x] = Math.sqrt(Math.min(d[x], 1e12)); }
    return out;
  }

  // morphological reconstruction by dilation (Vincent hybrid algorithm)
  function reconstruct(J, I, W, H) {
    const N = W * H;
    for (let i = 0; i < N; i++) if (J[i] > I[i]) J[i] = I[i];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x; let m = J[p];
      if (x > 0 && J[p - 1] > m) m = J[p - 1];
      if (y > 0) { const q = p - W; if (J[q] > m) m = J[q]; if (x > 0 && J[q - 1] > m) m = J[q - 1]; if (x < W - 1 && J[q + 1] > m) m = J[q + 1]; }
      J[p] = Math.min(m, I[p]); }
    const Q = new Int32Array(N); let qh = 0, qt = 0, qn = 0; const inq = new Uint8Array(N);
    const enq = p => { if (!inq[p]) { Q[qt] = p; qt = (qt + 1) % N; qn++; inq[p] = 1; } };
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const p = y * W + x; let m = J[p];
      if (x < W - 1 && J[p + 1] > m) m = J[p + 1];
      if (y < H - 1) { const q = p + W; if (J[q] > m) m = J[q]; if (x < W - 1 && J[q + 1] > m) m = J[q + 1]; if (x > 0 && J[q - 1] > m) m = J[q - 1]; }
      J[p] = Math.min(m, I[p]);
      const jp = J[p];
      if ((x < W - 1 && J[p + 1] < jp && J[p + 1] < I[p + 1]) ||
        (y < H - 1 && ((J[p + W] < jp && J[p + W] < I[p + W]) || (x < W - 1 && J[p + W + 1] < jp && J[p + W + 1] < I[p + W + 1]) || (x > 0 && J[p + W - 1] < jp && J[p + W - 1] < I[p + W - 1])))) enq(p); }
    while (qn) { const p = Q[qh]; qh = (qh + 1) % N; qn--; inq[p] = 0; const x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W || (!dx && !dy)) continue; const q = yy * W + xx;
          if (J[q] < J[p] && I[q] !== J[q]) { J[q] = Math.min(J[p], I[q]); enq(q); } } } }
    return J;
  }

  // grain seeds = h-maxima of the distance map (one seed per grain interior, robust to small gaps in the boundary)
  function markers(D, W, H, h, minD, roi) {
    const J = new Float32Array(D.length); for (let i = 0; i < D.length; i++) J[i] = D[i] - h;
    reconstruct(J, D, W, H);
    const m = new Uint8Array(D.length);
    for (let i = 0; i < D.length; i++) if (D[i] - J[i] >= h - 1e-3 && D[i] >= minD && (!roi || roi[i])) m[i] = 1;
    return cc(m, W, H);
  }

  // seeded watershed: priority flood on a quantized relief
  function watershed(relief, lab, W, H, roi, L = 1024) {
    const N = W * H, q = new Uint16Array(N);
    for (let i = 0; i < N; i++) q[i] = Math.min(L - 1, Math.max(0, (relief[i] * (L - 1)) | 0));
    const head = new Int32Array(L).fill(-1), tail = new Int32Array(L).fill(-1), next = new Int32Array(N);
    const push = (p, lv) => { next[p] = -1; if (tail[lv] < 0) head[lv] = p; else next[tail[lv]] = p; tail[lv] = p; };
    const inq = new Uint8Array(N);
    for (let p = 0; p < N; p++) if (lab[p]) { push(p, q[p]); inq[p] = 1; }
    let lv = 0;
    while (lv < L) {
      const p = head[lv]; if (p < 0) { lv++; continue; }
      head[lv] = next[p]; if (head[lv] < 0) tail[lv] = -1;
      const x = p % W, y = (p / W) | 0, l = lab[p];
      for (let k = 0; k < 4; k++) {
        const r = k === 0 ? (x > 0 ? p - 1 : -1) : k === 1 ? (x < W - 1 ? p + 1 : -1) : k === 2 ? (y > 0 ? p - W : -1) : (y < H - 1 ? p + W : -1);
        if (r < 0 || lab[r] || inq[r] || (roi && !roi[r])) continue;
        lab[r] = l; inq[r] = 1; push(r, Math.max(q[r], lv));
      }
    }
    return lab;
  }

  function maxFilter(A, W, H) { const o = new Float32Array(A.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let m = 0;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; const v = A[yy * W + xx]; if (v > m) m = v; } }
      o[y * W + x] = m; } return o; }

  // merge neighbouring grains whose shared boundary has mean strength < thr
  function mergeWeak(lab, Rd, W, H, thr, protect) {
    if (thr <= 0) return 0;
    const pairs = new Map(), K = 1048576;
    const add = (a, b, v) => { if (a === b || !a || !b) return; const k = a < b ? a * K + b : b * K + a; const e = pairs.get(k); if (e) { e[0] += v; e[1]++; } else pairs.set(k, [v, 1]); };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x, l = lab[p];
      if (x < W - 1) add(l, lab[p + 1], Math.max(Rd[p], Rd[p + 1]));
      if (y < H - 1) add(l, lab[p + W], Math.max(Rd[p], Rd[p + W])); }
    let max = 0; for (let i = 0; i < lab.length; i++) if (lab[i] > max) max = lab[i];
    const par = new Int32Array(max + 1); for (let i = 0; i <= max; i++) par[i] = i;
    const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    const list = [...pairs.entries()].map(([k, e]) => [Math.floor(k / K), k % K, e[0] / e[1]]).sort((a, b) => a[2] - b[2]);
    let merged = 0;
    for (const [a, b, m] of list) { if (m >= thr) break; if (protect && (protect.has(a) || protect.has(b))) continue; const ra = find(a), rb = find(b); if (ra !== rb) { par[rb] = ra; merged++; } }
    for (let i = 0; i < lab.length; i++) if (lab[i]) lab[i] = find(lab[i]);
    return merged;
  }

  function relabel(lab, N) {
    let max = 0; for (let i = 0; i < N; i++) if (lab[i] > max) max = lab[i];
    const map = new Int32Array(max + 1); let n = 0;
    for (let i = 0; i < N; i++) { const l = lab[i]; if (l && !map[l]) map[l] = ++n; }
    for (let i = 0; i < N; i++) lab[i] = lab[i] ? map[lab[i]] : 0;
    return n;
  }

  // per-grain geometry. px = µm per working pixel; rect in working px
  function grains(lab, n, W, H, px, rect) {
    const A = new Float64Array(n + 1), sx = new Float64Array(n + 1), sy = new Float64Array(n + 1),
      sxx = new Float64Array(n + 1), syy = new Float64Array(n + 1), sxy = new Float64Array(n + 1), edge = new Uint8Array(n + 1);
    for (let y = rect.y0; y < rect.y1; y++) for (let x = rect.x0; x < rect.x1; x++) { const l = lab[y * W + x]; if (!l) continue;
      A[l]++; sx[l] += x; sy[l] += y; sxx[l] += x * x; syy[l] += y * y; sxy[l] += x * y;
      if (x === rect.x0 || y === rect.y0 || x === rect.x1 - 1 || y === rect.y1 - 1) edge[l] = 1; }
    const out = [];
    for (let l = 1; l <= n; l++) { const a = A[l]; if (!a) continue;
      const cx = sx[l] / a, cy = sy[l] / a, cxx = sxx[l] / a - cx * cx + 1 / 12, cyy = syy[l] / a - cy * cy + 1 / 12, cxy = sxy[l] / a - cx * cy;
      const m = (cxx + cyy) / 2, d = Math.sqrt((cxx - cyy) ** 2 / 4 + cxy * cxy), l1 = m + d, l2 = Math.max(m - d, 1e-9);
      const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy) * 180 / Math.PI;
      const area = a * px * px;
      out.push({ id: l, areaPx: a, area, ecd: 2 * Math.sqrt(area / Math.PI), major: 4 * Math.sqrt(l1) * px, minor: 4 * Math.sqrt(l2) * px,
        ar: Math.sqrt(l1 / l2), angle: -ang, cx, cy, edge: !!edge[l] }); }
    return out;
  }

  // mean linear intercept along horizontal (x) and vertical (y) test lines
  function intercept(lab, W, H, rect, px, spacing) {
    let lenX = 0, cutX = 0, lenY = 0, cutY = 0;
    for (let y = rect.y0; y < rect.y1; y += spacing) { let prev = 0;
      for (let x = rect.x0; x < rect.x1; x++) { const l = lab[y * W + x]; if (!l) continue; if (prev && l !== prev) cutX++; prev = l; lenX++; } }
    for (let x = rect.x0; x < rect.x1; x += spacing) { let prev = 0;
      for (let y = rect.y0; y < rect.y1; y++) { const l = lab[y * W + x]; if (!l) continue; if (prev && l !== prev) cutY++; prev = l; lenY++; } }
    return { Lx: cutX ? lenX * px / cutX : NaN, Ly: cutY ? lenY * px / cutY : NaN, nx: cutX, ny: cutY };
  }

  return { downsample, gauss, valley, lineFilter, normalize, hysteresis, cc, removeSmall, edt, reconstruct, markers, watershed, maxFilter, mergeWeak, relabel, grains, intercept };
})();
if (typeof module !== 'undefined') module.exports = GB;
