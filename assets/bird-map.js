/* LT5461 — bird task results: the semantic space of "Bird plot.Rmd", computed
   and drawn in the browser. Step by step, R → here:

     summarise(mean, sd, na.rm = TRUE)        → analyse(): mean and SD per bird
     NA → the bird's mean                     → analyse(): same imputation
     prcomp(scale. = TRUE)$rotation[, 1:2]    → pca(): eigenvectors of the birds'
                                                correlation matrix (Jacobi), sorted
     geom_circle(r = std_dev * 0.04)          → grey halo, radius proportional to the
                                                SD: an SD of 1 = 4% of the panel's
                                                width (7% on a phone), since PC1
                                                units no longer suit (see below)
     size, fill = mean_prototypicality        → dot area and colour, #e6f7ff → #005a9e
                                                (interpolated in Lab, as ggplot does)
     geom_text_repel(min.segment.length = 0)  → placeLabels(): labels kept clear of
                                                each other and of the dots, with
                                                leader lines
     coord_fixed(ratio = 0.5)                 → a wide frame in which each axis is
                                                scaled to its own data. The ratio was there to
                                                widen the plot; but PC1 often spans
                                                little (everyone rating all birds a
                                                bit higher or lower loads them all
                                                alike), and any fixed ratio then
                                                squeezes the birds into a column.

   prcomp would stop on a bird everyone rated the same (zero variance); here
   such a bird is left off the map and named underneath. A component's sign is
   arbitrary in PCA. On its first drawing for a class the map turns PC1 so
   that the more typical birds lie to the right (positive loadings, when PC1
   shows no clear trend with typicality), and puts PC2's largest loading on
   top; after that each component keeps the sign it had on the previous
   drawing (remembered per class by the dashboard, across reloads), so the map
   never mirrors as runs arrive. Checked against R: dev/check_birds.R. */
(function () {
  'use strict';
  const BIRDS = window.BIRD_ITEMS.birds;
  const MIN_N = 3;            // two components need at least three runs
  const HALO = 0.04, HALO_NARROW = 0.07;   // halo radius per SD point, as a share of the panel's width
  const LOW = '#e6f7ff', HIGH = '#005a9e';

  /* ---------- analysis ---------- */
  const val = v => (v === '' || v === null || v === undefined) ? NaN : Number(v);

  // Eigen-decomposition of a symmetric matrix by cyclic Jacobi rotations.
  function jacobi(S) {
    const n = S.length, a = S.map(r => r.slice());
    const v = S.map((_, i) => S.map((__, j) => (i === j ? 1 : 0)));
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
      if (off < 1e-24) break;
      for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
        const apq = a[p][q];
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * apq);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
        for (let k = 0; k < n; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
        for (let k = 0; k < n; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y; }
      }
    }
    return a.map((r, i) => ({ value: r[i], vector: v.map(row => row[i]) })).sort((x, y) => y.value - x.value);
  }

  /* prcomp(X, scale. = TRUE): centre and scale each column (sample SD), then
     the rotation is the eigenvectors of the correlation matrix and the
     variances are its eigenvalues. */
  function pca(X) {
    const n = X.length, p = X[0].length;
    const m = [], s = [];
    for (let j = 0; j < p; j++) {
      const col = X.map(r => r[j]);
      m.push(LAB.mean(col)); s.push(LAB.sd(col));
    }
    const Z = X.map(r => r.map((x, j) => (x - m[j]) / s[j]));
    const R = [];
    for (let i = 0; i < p; i++) {
      R.push([]);
      for (let j = 0; j < p; j++) {
        let acc = 0;
        for (let k = 0; k < n; k++) acc += Z[k][i] * Z[k][j];
        R[i].push(acc / (n - 1));
      }
    }
    const eig = jacobi(R);
    const total = eig.reduce((a, e) => a + Math.max(0, e.value), 0);
    return eig.map(e => ({ vector: e.vector, variance: Math.max(0, e.value), share: Math.max(0, e.value) / total }));
  }

  function corr(a, b) {
    const ma = LAB.mean(a), mb = LAB.mean(b);
    let sab = 0, saa = 0, sbb = 0;
    a.forEach((x, i) => { sab += (x - ma) * (b[i] - mb); saa += (x - ma) * (x - ma); sbb += (b[i] - mb) * (b[i] - mb); });
    return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
  }

  /* rows: one per run, with a rating column per bird (key). prev: the last
     drawing's loadings, {key: [pc1, pc2]}, to keep the orientation. */
  function analyse(rows, prev) {
    const X = rows.map(r => BIRDS.map(b => val(r[b.key])))
      .filter(r => r.some(isFinite));                    // a run with no ratings carries nothing
    const birds = BIRDS.map((b, j) => {
      const col = X.map(r => r[j]).filter(isFinite);
      return { key: b.key, name: b.name, n: col.length, mean: LAB.mean(col), sd: LAB.sd(col), pc1: NaN, pc2: NaN, why: '' };
    });
    const out = { n: X.length, birds, shares: [NaN, NaN], placed: [], off: [] };
    if (X.length < MIN_N) return out;

    // Missing ratings take the bird's mean, as in the Rmd; then only birds
    // whose ratings vary can be scaled.
    const Xi = X.map(r => r.map((v, j) => (isFinite(v) ? v : birds[j].mean)));
    const use = birds.map((b, j) => {
      const sd = LAB.sd(Xi.map(r => r[j]));
      if (!b.n) b.why = 'no ratings';
      else if (!(sd > 1e-12)) b.why = 'everyone gave the same rating';
      return !b.why;
    });
    const cols = birds.map((_, j) => j).filter(j => use[j]);
    out.off = birds.filter(b => b.why);
    if (cols.length < 2) return out;

    const comps = pca(Xi.map(r => cols.map(j => r[j])));
    const placed = cols.map(j => birds[j]);
    let v1 = comps[0].vector, v2 = comps[1] ? comps[1].vector : cols.map(() => 0);
    // Orientation: as on the previous drawing when there is one; otherwise
    // typical birds to the right on PC1 (positive loadings if r < .2), PC2's
    // largest loading on top.
    const dot = (a, b) => a.reduce((acc, x, i) => acc + x * b[i], 0);
    const keep = (v, k) => {
      const pairs = placed.map((b, i) => (prev && prev[b.key] ? [v[i], prev[b.key][k]] : null)).filter(Boolean);
      return pairs.length >= 2 ? Math.sign(pairs.reduce((acc, [a, c]) => acc + a * c, 0)) : 0;
    };
    const r = corr(v1, placed.map(b => b.mean));
    const s1 = keep(v1, 0) || (Math.abs(r) >= 0.2 ? Math.sign(r) : Math.sign(v1.reduce((a, x) => a + x, 0))) || 1;
    const big = v2.reduce((k, x, i) => (Math.abs(x) > Math.abs(v2[k]) + 1e-12 ? i : k), 0);
    const s2 = keep(v2, 1) || Math.sign(v2[big]) || 1;
    if (s1 < 0) v1 = v1.map(x => -x);
    if (s2 < 0) v2 = v2.map(x => -x);
    placed.forEach((b, i) => { b.pc1 = v1[i] + 0; b.pc2 = v2[i] + 0; });
    out.placed = placed;
    out.shares = [comps[0].share, comps[1] ? comps[1].share : 0];
    return out;
  }

  /* ---------- colour: ggplot's scale_fill_gradient interpolates in Lab ---------- */
  const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const gam = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  const WHITE = [0.95047, 1, 1.08883];
  function toLab(h) {
    const [r, g, b] = hex2rgb(h).map(lin);
    const xyz = [0.4124 * r + 0.3576 * g + 0.1805 * b, 0.2126 * r + 0.7152 * g + 0.0722 * b, 0.0193 * r + 0.1192 * g + 0.9505 * b];
    const f = xyz.map((v, i) => { const t = v / WHITE[i]; return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116; });
    return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
  }
  function fromLab([L, A, B]) {
    const fy = (L + 16) / 116, fx = fy + A / 500, fz = fy - B / 200;
    const inv = t => (t * t * t > 216 / 24389 ? t * t * t : (116 * t - 16) / (24389 / 27));
    const [x, y, z] = [inv(fx) * WHITE[0], inv(fy) * WHITE[1], inv(fz) * WHITE[2]];
    const rgb = [3.2406 * x - 1.5372 * y - 0.4986 * z, -0.9689 * x + 1.8758 * y + 0.0415 * z, 0.0557 * x - 0.204 * y + 1.057 * z];
    return '#' + rgb.map(c => Math.round(Math.min(1, Math.max(0, gam(c))) * 255).toString(16).padStart(2, '0')).join('');
  }
  const LAB_LO = toLab(LOW), LAB_HI = toLab(HIGH);
  const fillAt = t => fromLab(LAB_LO.map((v, i) => v + (LAB_HI[i] - v) * t));

  /* ---------- chart ---------- */
  const MINUS = '−';
  const fmt2 = v => (isFinite(v) ? (v < -0.005 ? MINUS : '') + Math.abs(v).toFixed(2) : '–');
  const pct = v => (isFinite(v) ? Math.round(v * 100) + '%' : '–');
  function niceTicks(lo, hi, target) {
    const raw = (hi - lo) / target, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.abs(v) < step / 1e6 ? 0 : v);
    return { ticks: out, dec: Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) };
  }
  let ctx;
  function measure(text, font) {
    ctx = ctx || document.createElement('canvas').getContext('2d');
    ctx.font = font;
    return ctx.measureText(text).width;
  }

  /* geom_text_repel, simplified and deterministic (so labels do not jump about
     between redraws): every label tries 80 spots around its dot and keeps the
     cheapest, judged on overlap with other labels and dots, staying inside
     the panel, sitting nearer its own dot than any other, and distance;
     repeated until nothing improves. */
  function placeLabels(items, box) {
    const ANG = Array.from({ length: 16 }, (_, i) => i * Math.PI / 8);
    const GAPS = [4, 14, 28, 46, 70];
    const cand = it => {
      const out = [];
      GAPS.forEach(g => ANG.forEach(a => {
        const ux = Math.cos(a), uy = -Math.sin(a), d = it.r + g;
        const cx = it.x + ux * d + ux * it.w / 2, cy = it.y + uy * d + uy * it.h / 2;
        // Right of the dot reads best; then above, below, left.
        const pref = (Math.abs(a) < 1e-9 ? 0 : Math.abs(a - Math.PI) < 1e-9 ? 4 : 2) + (uy > 0 ? 1 : 0);
        out.push({ x: cx - it.w / 2, y: cy - it.h / 2, g, pref });
      }));
      return out;
    };
    const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const cost = (it, c, all) => {
      const r = { x: c.x - 3, y: c.y - 2, w: it.w + 6, h: it.h + 4 };
      let s = c.g * 1.5 + c.pref * 3;
      // gap from a dot's edge to the label (unpadded)
      const gap = o => Math.hypot(o.x - Math.max(c.x, Math.min(o.x, c.x + it.w)), o.y - Math.max(c.y, Math.min(o.y, c.y + it.h))) - o.r;
      const own = gap(it);
      if (own < 1) s += (1 - own) * 400;
      all.forEach(o => {
        if (o === it) return;
        if (o.pos) s += overlap(r, { x: o.pos.x, y: o.pos.y, w: o.w, h: o.h }) * 30;
        const g = gap(o);
        if (g < 2) s += 4000 + (2 - g) * 120;            // a dot under the label: only if nothing else fits
        if (g < own + 6) s += (own + 6 - g) * 25;        // the label would seem to name this dot
      });
      const outX = Math.max(0, box.x0 - r.x) + Math.max(0, r.x + r.w - box.x1);
      const outY = Math.max(0, box.y0 - r.y) + Math.max(0, r.y + r.h - box.y1);
      return s + (outX + outY) * 500;
    };
    items.forEach(it => { it.cands = cand(it); it.pos = null; });
    // Crowded dots choose first.
    const crowd = it => items.reduce((a, o) => a + (o !== it && Math.hypot(o.x - it.x, o.y - it.y) < 120 ? 1 : 0), 0);
    const order = items.slice().sort((a, b) => crowd(b) - crowd(a) || a.x - b.x);
    for (let pass = 0; pass < 10; pass++) {
      let moved = false;
      order.forEach(it => {
        let best = it.pos, bestC = it.pos ? cost(it, it.pos, items) : Infinity;
        it.cands.forEach(c => { const k = cost(it, c, items); if (k < bestC - 1e-6) { bestC = k; best = c; } });
        if (best !== it.pos) { it.pos = best; moved = true; }
      });
      if (!moved) break;
    }
    items.forEach(it => { delete it.cands; });
  }

  // Leader line from the dot's edge to the nearest point of its label: when
  // the label has moved off, or another dot is nearer to it (force).
  function leader(it, lx, ly, force) {
    const nx = Math.max(lx - 2, Math.min(it.x, lx + it.w + 2)), ny = Math.max(ly - 1, Math.min(it.y, ly + it.h + 1));
    const d = Math.hypot(nx - it.x, ny - it.y);
    if (d < it.r + (force ? 3 : 9)) return null;
    const ux = (nx - it.x) / d, uy = (ny - it.y) / d;
    return [it.x + ux * (it.r + 1.5), it.y + uy * (it.r + 1.5), nx - ux * 2, ny - uy * 2];
  }

  /* host: an empty element; res: analyse() output; prev: the geometry the last
     draw returned (the dots then glide to their new places). */
  function draw(host, res, opts) {
    opts = opts || {};
    const W = Math.max(300, Math.round(opts.width || host.clientWidth || 960));
    const narrow = W < 640;
    const fs = narrow ? 12.5 : 14, font = `700 ${fs}px 'Open Sans', 'Open Sans Fallback', Arial, sans-serif`;
    const left = narrow ? 44 : 58, right = 6, top = 6, bottom = narrow ? 46 : 52;
    const Wi = W - left - right;
    const P = res.placed;

    // Sizes from the data's range, as ggplot's scales do: area for size.
    const means = P.map(b => b.mean), mLo = Math.min(...means), mHi = Math.max(...means);
    const tOf = m => (mHi > mLo ? (m - mLo) / (mHi - mLo) : 0.5);
    const rMin = narrow ? 5 : 6, rMax = narrow ? 14 : 19;
    const rOf = m => rMin + (rMax - rMin) * Math.sqrt(tOf(m));

    // A wide frame; each axis spans its own data, with room for dots and labels.
    const Hi = narrow ? Math.round(Wi * 1.05) : Math.round(Math.min(640, Math.max(380, Wi * 0.5)));
    const xs = P.map(b => b.pc1), ys = P.map(b => b.pc2);
    const xLo = Math.min(...xs), xHi = Math.max(...xs), yLo = Math.min(...ys), yHi = Math.max(...ys);
    // Steady axes on the projector: each spans at least 0.25 loading units, and
    // on a live update it only grows, unless the data now fill less than 60%
    // of it; so a new run moves the birds, not the whole frame.
    const old = opts.prev && opts.prev._dom;
    const dom = (lo, hi, o) => {
      const c = (lo + hi) / 2, h = Math.max(hi - lo, 0.25) / 2, fresh = [c - h, c + h];
      if (!o || fresh[1] - fresh[0] < 0.6 * (o[1] - o[0])) return fresh;
      return [Math.min(o[0], lo), Math.max(o[1], hi)];
    };
    const dx = dom(xLo, xHi, old && old.x), dy = dom(yLo, yHi, old && old.y);
    const padX = narrow ? 34 : 70, padY = narrow ? 30 : 42;
    const kx = (Wi - 2 * padX) / (dx[1] - dx[0]), ky = (Hi - 2 * padY) / (dy[1] - dy[0]);
    const X = v => left + padX + (v - dx[0]) * kx, Y = v => top + Hi - padY - (v - dy[0]) * ky;
    const H = Math.round(top + Hi + bottom);
    const haloOf = b => (isFinite(b.sd) ? b.sd : 0) * (narrow ? HALO_NARROW : HALO) * Wi;

    const items = P.map(b => ({
      b, x: X(b.pc1), y: Y(b.pc2), r: rOf(b.mean), halo: haloOf(b),
      fill: fillAt(tOf(b.mean)), w: measure(b.name, font) + 2, h: fs * 1.3
    }));
    placeLabels(items, { x0: left + 2, x1: left + Wi - 2, y0: top + 2, y1: top + Hi - 2 });

    host.textContent = '';
    const svg = LAB.svg('svg', {
      class: 'chart bird-map', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img',
      'aria-label': opts.ariaLabel || 'Map of the birds on the first two principal components'
    }, host);

    // Axes: ggplot theme_minimal with axis lines, no grid.
    const xt = niceTicks((left - X(0)) / kx, (left + Wi - X(0)) / kx, narrow ? 4 : 8);
    const yt = niceTicks((Y(0) - (top + Hi)) / ky, (Y(0) - top) / ky, narrow ? 5 : 5);
    const tick = (v, d) => (v < 0 ? MINUS : '') + Math.abs(v).toFixed(d);
    const g = LAB.svg('g', { class: 'axis' }, svg);
    LAB.svg('line', { class: 'axis-line', x1: left, x2: left + Wi, y1: top + Hi, y2: top + Hi }, g);
    LAB.svg('line', { class: 'axis-line', x1: left, x2: left, y1: top, y2: top + Hi }, g);
    xt.ticks.forEach(v => LAB.text(g, X(v), top + Hi + 17, tick(v, xt.dec), { 'text-anchor': 'middle' }));
    yt.ticks.forEach(v => LAB.text(g, left - 8, Y(v) + 4, tick(v, yt.dec), { 'text-anchor': 'end' }));
    LAB.text(g, left + Wi / 2, H - 8, `Principal component 1 · ${pct(res.shares[0])} of variance`, { 'text-anchor': 'middle', class: 'axis-title' });
    LAB.text(g, 0, 0, `Principal component 2 · ${pct(res.shares[1])} of variance`, { 'text-anchor': 'middle', class: 'axis-title', transform: `translate(${narrow ? 11 : 14} ${top + Hi / 2}) rotate(-90)` });

    // Layers: halos, leader lines, dots, labels (labels on top, as in ggrepel).
    const clipId = 'bird-clip-' + Math.random().toString(36).slice(2, 8);
    LAB.svg('rect', { x: left + 0.5, y: top, width: Wi, height: Hi - 0.5 }, LAB.svg('clipPath', { id: clipId }, LAB.svg('defs', {}, svg)));
    const L = { halo: LAB.svg('g', { 'clip-path': `url(#${clipId})` }, svg), seg: LAB.svg('g', {}, svg), dot: LAB.svg('g', {}, svg), lab: LAB.svg('g', {}, svg) };
    const anim = !opts.still && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const prev = opts.prev || null;
    items.forEach((it, i) => {
      const b = it.b;
      it.el = {
        halo: LAB.svg('circle', { class: 'bird-halo' }, L.halo),
        seg: LAB.svg('line', { class: 'bird-seg' }, L.seg),
        dot: LAB.svg('circle', { class: 'bird-dot', fill: it.fill }, L.dot),
        lab: LAB.text(L.lab, 0, 0, b.name, { class: 'bird-label' })
      };
      it.el.lab.style.fontSize = fs + 'px';
      // Is another dot nearer to this label than its own?
      const gap = o => Math.hypot(o.x - Math.max(it.pos.x, Math.min(o.x, it.pos.x + it.w)), o.y - Math.max(it.pos.y, Math.min(o.y, it.pos.y + it.h))) - o.r;
      it.force = items.some(o => o !== it && gap(o) < gap(it) + 4);
      const tip = LAB.svg('title', {}, it.el.dot);
      tip.textContent = `${b.name}: mean ${b.mean.toFixed(2)}, SD ${fmt2(b.sd)}, PC1 ${fmt2(b.pc1)}, PC2 ${fmt2(b.pc2)}`;
      if (anim && !prev) [it.el.halo, it.el.dot, it.el.lab, it.el.seg].forEach(e => { e.classList.add('enter'); e.style.setProperty('--i', i); });
    });

    // Larger dots first, so a small one is never hidden under a large one.
    items.slice().sort((a, c) => c.r - a.r).forEach(it => L.dot.appendChild(it.el.dot));

    const geom = { _dom: { x: dx, y: dy } };
    items.forEach(it => { geom[it.b.key] = { x: it.x, y: it.y, r: it.r, halo: it.halo, lx: it.pos.x, ly: it.pos.y }; });
    const set = t => {
      const e = t < 1 ? 1 - Math.pow(1 - t, 3) : 1;      // ease-out
      items.forEach(it => {
        const to = geom[it.b.key], from = (prev && prev[it.b.key]) || to;
        const lerp = k => from[k] + (to[k] - from[k]) * e;
        const p = { x: lerp('x'), y: lerp('y'), r: lerp('r'), w: it.w, h: it.h }, lx = lerp('lx'), ly = lerp('ly');
        it.el.halo.setAttribute('cx', p.x.toFixed(1)); it.el.halo.setAttribute('cy', p.y.toFixed(1)); it.el.halo.setAttribute('r', Math.max(0, lerp('halo')).toFixed(1));
        it.el.dot.setAttribute('cx', p.x.toFixed(1)); it.el.dot.setAttribute('cy', p.y.toFixed(1)); it.el.dot.setAttribute('r', p.r.toFixed(1));
        it.el.lab.setAttribute('x', (lx + 1).toFixed(1)); it.el.lab.setAttribute('y', (ly + it.h * 0.77).toFixed(1));
        const s = leader(p, lx, ly, it.force);
        it.el.seg.style.display = s ? '' : 'none';
        if (s) { it.el.seg.setAttribute('x1', s[0].toFixed(1)); it.el.seg.setAttribute('y1', s[1].toFixed(1)); it.el.seg.setAttribute('x2', s[2].toFixed(1)); it.el.seg.setAttribute('y2', s[3].toFixed(1)); }
      });
    };
    // Glide from the last positions; a timer finishes the move even when
    // animation frames stop (a hidden window).
    if (anim && prev) {
      const t0 = performance.now(), DUR = 700;
      let done = false;
      const finish = () => { if (!done) { done = true; set(1); } };
      const step = now => { if (done) return; const t = Math.min(1, (now - t0) / DUR); set(t); if (t < 1) requestAnimationFrame(step); else done = true; };
      set(0);
      requestAnimationFrame(step);
      setTimeout(finish, DUR + 250);
    } else set(1);
    return geom;
  }

  /* One row per run with the Google Forms export's columns, so Bird plot.Rmd
     runs on it unchanged (read it into responses1). */
  function formRows(rows) {
    return rows.map(r => {
      const o = { Timestamp: r.submitted_at || '' };
      BIRDS.forEach(b => { const v = val(r[b.key]); o[b.name] = isFinite(v) ? v : ''; });
      return o;
    });
  }

  window.BIRD_MAP = { analyse, draw, formRows, fillAt, MIN_N, fmt2, pct, _pca: pca };
})();
