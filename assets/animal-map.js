/* LT5461 — animal task results.
   Distances: for each student, the distance between two names as they left
   them in the box (in pixels: positions × box size), divided by that
   student's mean distance over all 190 pairs, so screens of any size compare.
   The class map (as Douven et al.'s aggregate mammal space): the mean of these
   distance matrices, placed in two dimensions by classical (Torgerson)
   multidimensional scaling and scaled to lie within −1 to 1.
   Inference and distance:
     - per student, the Pearson correlation between the 30 answers (0–100%) and
       the distance between the two animals, in their own arrangement and in
       the class's computed without them (leave one out); class tests on the
       Fisher-z correlations (one-sample t against 0; paired t own vs class),
       shown transformed back to r;
     - the decay curve: inference strength = a · e^(−b · distance), fitted by
       least squares, (1) to each ordered pair's mean answer against its
       distance on the class map (as the paper's Figure 9) and (2) to every
       answer against the distance in the student's own arrangement.
   Exposes window.ANIMAL_MAP. */
(function () {
  'use strict';
  const ITEMS = window.ANIMAL_ITEMS, K = ITEMS.length;
  const num = v => (v === '' || v === null || v === undefined) ? NaN : Number(v);
  const INF = /^(\d+)>(\d+):(\d+(?:\.\d+)?)$/;
  const MINUS = '−';
  const f2 = v => isFinite(v) ? (v < -0.005 ? MINUS : '') + Math.abs(v).toFixed(2) : '–';
  const r2 = v => isFinite(v) ? (v <= -0.005 ? MINUS : '') + Math.abs(v).toFixed(2).replace(/^0/, '') : '–';

  /* One stored row → {pid, row, D (K×K, mean 1), inf: [{i, j, v}]}, or null if incomplete. */
  function parse(r) {
    const W = num(r.arena_w), H = num(r.arena_h);
    const P = ITEMS.map(it => [num(r['x_' + it.key]) * W, num(r['y_' + it.key]) * H]);
    if (!(W > 0 && H > 0) || P.some(p => !isFinite(p[0]) || !isFinite(p[1]))) return null;
    const D = P.map(a => P.map(b => Math.hypot(a[0] - b[0], a[1] - b[1])));
    let s = 0; for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) s += D[i][j];
    const m = s / (K * (K - 1) / 2);
    if (!(m > 0)) return null;
    const inf = (String(r.inf_a || '') + '|' + String(r.inf_b || '')).split('|').map(x => INF.exec(x.trim())).filter(Boolean)
      .map(x => ({ i: Number(x[1]), j: Number(x[2]), v: Number(x[3]) })).filter(t => t.i < K && t.j < K && t.i !== t.j);
    return { pid: r.pid, row: r, D: D.map(row => row.map(d => d / m)), inf };
  }

  function pearson(x, y) {
    const n = x.length; if (n < 3) return NaN;
    const mx = LAB.mean(x), my = LAB.mean(y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let k = 0; k < n; k++) { sxy += (x[k] - mx) * (y[k] - my); sxx += (x[k] - mx) ** 2; syy += (y[k] - my) ** 2; }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
  }

  function jacobi(S) {
    const n = S.length, a = S.map(r => r.slice()), v = S.map((_, i) => S.map((__, j) => (i === j ? 1 : 0)));
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
      if (off < 1e-24) break;
      for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
        const apq = a[p][q]; if (Math.abs(apq) < 1e-300) continue;
        const th = (a[q][q] - a[p][p]) / (2 * apq), t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
        for (let k = 0; k < n; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
        for (let k = 0; k < n; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y; }
      }
    }
    return a.map((r, i) => ({ value: r[i], vector: v.map(row => row[i]) })).sort((x, y) => y.value - x.value);
  }

  /* Classical MDS into two dimensions: B = −½ J D² J, coordinates = the top
     two eigenvectors × √eigenvalue, then scaled so the largest coordinate is
     0.9 (the map sits inside −1 to 1). share: the part of the positive
     eigenvalues the two dimensions keep. The signs are fixed so the map does
     not mirror between drawings: the elephant right of the mouse, the cat
     above the cow. */
  function mds(D) {
    const n = D.length, D2 = D.map(r => r.map(d => d * d));
    const rm = D2.map(r => LAB.mean(r)), gm = LAB.mean(rm);
    const B = D2.map((r, i) => r.map((d, j) => -0.5 * (d - rm[i] - rm[j] + gm)));
    const e = jacobi(B), tot = e.filter(x => x.value > 1e-12).reduce((s, x) => s + x.value, 0);
    let c = [0, 1].map(k => e[k] && e[k].value > 1e-12 ? e[k].vector.map(v => v * Math.sqrt(e[k].value)) : new Array(n).fill(0));
    const idx = key => ITEMS.findIndex(it => it.key === key);
    if (c[0][idx('elephant')] < c[0][idx('mouse')]) c[0] = c[0].map(v => -v);
    if (c[1][idx('cat')] < c[1][idx('cow')]) c[1] = c[1].map(v => -v);   // y up: the cat above the cow
    const big = Math.max(1e-12, ...c[0].map(Math.abs), ...c[1].map(Math.abs)), k = 0.9 / big;
    const xy = ITEMS.map((_, i) => [c[0][i] * k, c[1][i] * k]);
    return { xy, share: tot > 0 ? ((e[0] ? Math.max(0, e[0].value) : 0) + (e[1] ? Math.max(0, e[1].value) : 0)) / tot : NaN };
  }

  /* y = a · e^(−b x) by least squares: for a given b the best a is
     Σ y e^(−bx) / Σ e^(−2bx), so only b is searched (golden section over
     0–20, after a coarse scan). R² against the mean; the straight line's R²
     for comparison. */
  function fitExp(xs, ys) {
    const n = xs.length;
    if (n < 3) return null;
    const sse = b => { let sy = 0, s2 = 0; for (let k = 0; k < n; k++) { const e = Math.exp(-b * xs[k]); sy += ys[k] * e; s2 += e * e; } const a = sy / s2; let s = 0; for (let k = 0; k < n; k++) { const d = ys[k] - a * Math.exp(-b * xs[k]); s += d * d; } return { a, s }; };
    let best = 0, bs = Infinity;
    for (let b = 0; b <= 20 + 1e-9; b += 0.05) { const s = sse(b).s; if (s < bs) { bs = s; best = b; } }
    let lo = Math.max(0, best - 0.05), hi = best + 0.05;
    for (let k = 0; k < 80; k++) { const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618; if (sse(m1).s < sse(m2).s) hi = m2; else lo = m1; }
    const b = (lo + hi) / 2, { a, s } = sse(b), my = LAB.mean(ys);
    const sst = ys.reduce((t, y) => t + (y - my) * (y - my), 0), lin = LAB.ols(xs, ys);
    return { a, b, n, r2: sst > 0 ? 1 - s / sst : NaN, r2Lin: lin && isFinite(lin.r) ? lin.r * lin.r : NaN, at: x => a * Math.exp(-b * x) };
  }

  // rows: the class's stored rows (each student's first run only, chosen by the dashboard)
  function analyse(rows) {
    const S = rows.map(parse).filter(Boolean), n = S.length;
    const out = { n, students: S, map: null, own: [], cls: [], skipped: 0, pairs: [], points: [] };
    if (!n) return out;
    const sum = ITEMS.map(() => new Array(K).fill(0));
    S.forEach(s => s.D.forEach((r, i) => r.forEach((d, j) => { sum[i][j] += d; })));
    out.mean = sum.map(r => r.map(d => d / n));
    if (n >= 2) out.map = mds(out.mean);
    S.forEach(s => {
      const loo = n >= 2 ? sum.map((r, i) => r.map((d, j) => (d - s.D[i][j]) / (n - 1))) : null;
      const v = s.inf.map(t => t.v), own = pearson(s.inf.map(t => s.D[t.i][t.j]), v), cls = loo ? pearson(s.inf.map(t => loo[t.i][t.j]), v) : NaN;
      s.rOwn = own; s.rCls = cls;
      if (isFinite(own)) out.own.push(own);
      if (isFinite(cls)) out.cls.push(cls);
      if (!isFinite(own)) out.skipped++;
    });
    const z = r => Math.atanh(Math.max(-0.9999, Math.min(0.9999, r)));
    const back = T => T && Object.assign({}, T, { r: Math.tanh(T.m), rci: T.ci.map(Math.tanh) });
    out.testOwn = back(LAB.ttest(out.own.map(z), 0));
    out.testCls = back(LAB.ttest(out.cls.map(z), 0));
    const both = S.filter(s => isFinite(s.rOwn) && isFinite(s.rCls));
    out.testDiff = LAB.ttest(both.map(s => z(s.rOwn) - z(s.rCls)), 0);
    out.nPairs = both.length;
    // every answer against the student's own distance
    out.points = S.flatMap(s => s.inf.map(t => ({ x: s.D[t.i][t.j], y: t.v })));
    out.fitOwn = fitExp(out.points.map(p => p.x), out.points.map(p => p.y));
    // each ordered pair's mean answer against its distance on the class map
    if (out.map) {
      const acc = new Map();
      S.forEach(s => s.inf.forEach(t => { const k = t.i + '>' + t.j; const a = acc.get(k) || { i: t.i, j: t.j, vs: [] }; a.vs.push(t.v); acc.set(k, a); }));
      const xy = out.map.xy;
      out.pairs = [...acc.values()].map(a => ({ i: a.i, j: a.j, n: a.vs.length, x: Math.hypot(xy[a.i][0] - xy[a.j][0], xy[a.i][1] - xy[a.j][1]), y: LAB.mean(a.vs) }));
      out.fitClass = fitExp(out.pairs.map(p => p.x), out.pairs.map(p => p.y));
    }
    return out;
  }

  /* ---------- charts (laid out at the box's width; the site's chart text sizes) ---------- */
  const widthOf = (host, max) => Math.max(300, Math.min(max, Math.round(host.getBoundingClientRect().width) || max));
  const root = (host, W, H, label) => { host.textContent = ''; return LAB.svg('svg', { class: 'chart fc', viewBox: `0 0 ${W} ${H}`, style: `max-width:${W}px`, role: 'img', 'aria-label': label }, host); };
  const title = (el, s) => { LAB.svg('title', {}, el).textContent = s; return el; };
  let ctx;
  const measure = (text, font) => { ctx = ctx || document.createElement('canvas').getContext('2d'); ctx.font = font; return ctx.measureText(text).width; };

  // Labels: each tries spots around its dot and keeps the one that overlaps least with other labels and dots, inside the frame.
  function placeLabels(items, box) {
    const ANG = Array.from({ length: 12 }, (_, i) => i * Math.PI / 6), GAPS = [3, 10, 20, 34];
    const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const cands = it => GAPS.flatMap(g => ANG.map(a => {
      const ux = Math.cos(a), uy = -Math.sin(a), d = it.r + g;
      return { x: it.x + ux * (d + it.w / 2) - it.w / 2, y: it.y + uy * (d + it.h / 2) - it.h / 2, g, pref: Math.abs(a) < 1e-9 ? 0 : Math.abs(a - Math.PI) < 1e-9 ? 3 : 2 };
    }));
    const cost = (it, c) => {
      let s = c.g * 1.2 + c.pref * 3;
      const r = { x: c.x - 2, y: c.y - 1, w: it.w + 4, h: it.h + 2 };
      items.forEach(o => {
        if (o !== it && o.pos) s += overlap(r, { x: o.pos.x, y: o.pos.y, w: o.w, h: o.h }) * 30;
        const nx = Math.max(c.x, Math.min(o.x, c.x + it.w)), ny = Math.max(c.y, Math.min(o.y, c.y + it.h));
        const gap = Math.hypot(o.x - nx, o.y - ny) - o.r;
        if (o !== it && gap < 2) s += 3000;
        if (o !== it && gap < Math.hypot(it.x - nx, it.y - ny) - it.r + 4) s += 60;   // nearer another dot than its own: it would seem to name that one
        if (o === it && gap < 1) s += 400;
      });
      s += (Math.max(0, box.x0 - r.x) + Math.max(0, r.x + r.w - box.x1) + Math.max(0, box.y0 - r.y) + Math.max(0, r.y + r.h - box.y1)) * 500;
      return s;
    };
    items.forEach(it => { it.c = cands(it); it.pos = null; });
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      items.forEach(it => { let best = it.pos, bc = it.pos ? cost(it, it.pos) : Infinity; it.c.forEach(c => { const k = cost(it, c); if (k < bc - 1e-6) { bc = k; best = c; } }); if (best !== it.pos) { it.pos = best; changed = true; } });
      if (!changed) break;
    }
  }

  /* The class map, as the paper's Figure 7: a square from −1 to 1 on both axes
     with a grid every 0.5, so distances on screen are true to the map. */
  function draw(host, res) {
    const Wb = widthOf(host, 760), narrow = Wb < 520;
    const left = narrow ? 36 : 46, right = 12, top = 12, bottom = 34, side = Math.min(Wb - left - right, narrow ? 420 : 560);
    const W = left + side + right, H = top + side + bottom;
    const s = root(host, W, H, `Class map of the twenty animals from ${res.n} arrangements`);
    const X = v => left + (v + 1) / 2 * side, Y = v => top + (1 - (v + 1) / 2) * side;
    [-1, -0.5, 0, 0.5, 1].forEach(v => {
      LAB.svg('line', { class: 'grid', x1: X(v), x2: X(v), y1: Y(1), y2: Y(-1), 'stroke-dasharray': '2 4' }, s);
      LAB.svg('line', { class: 'grid', x1: X(-1), x2: X(1), y1: Y(v), y2: Y(v), 'stroke-dasharray': '2 4' }, s);
      LAB.text(s, X(v), Y(-1) + 20, v === 0 ? '0.0' : (v < 0 ? MINUS : '') + Math.abs(v).toFixed(1), { 'text-anchor': 'middle', class: 'scale-note' });
      LAB.text(s, X(-1) - 7, Y(v) + 4, v === 0 ? '0.0' : (v < 0 ? MINUS : '') + Math.abs(v).toFixed(1), { 'text-anchor': 'end', class: 'scale-note' });
    });
    LAB.svg('rect', { x: X(-1), y: Y(1), width: side, height: side, fill: 'none', class: 'axis-light' }, s);
    const fs = narrow ? 13 : 14.5, font = `650 ${fs}px 'Open Sans', 'Open Sans Fallback', Arial, sans-serif`;
    const items = ITEMS.map((it, i) => ({ name: it.name, x: X(res.map.xy[i][0]), y: Y(res.map.xy[i][1]), r: 3.5, w: measure(it.name, font), h: fs + 2 }));
    placeLabels(items, { x0: X(-1) + 2, y0: Y(1) + 2, x1: X(1) - 2, y1: Y(-1) - 2 });
    items.forEach(it => {
      const g = LAB.svg('g', {}, s); title(g, it.name);
      LAB.svg('circle', { cx: it.x, cy: it.y, r: it.r, class: 'series-a' }, g);
      LAB.text(g, it.pos.x, it.pos.y + it.h - 4, it.name, { class: 'label-strong halo', style: `font-size:${fs}px` });
    });
    return s;
  }

  /* Inference strength against distance, with the exponential curve (as the
     paper's Figure 9). o: {points: [{x, y, n?}], fit, xLabel, xMax, dotTitle, label} */
  function decay(host, o) {
    const W = widthOf(host, 620), narrow = W < 460, H = narrow ? 300 : 340, left = narrow ? 44 : 58, right = 14, top = 12, bottom = 50;
    const s = root(host, W, H, o.label);
    const xMax = o.xMax, X = v => left + v / xMax * (W - left - right), Y = v => top + (1 - v / 100) * (H - top - bottom);
    const xStep = xMax > 2 ? 0.5 : xMax > 1 ? 0.25 : 0.1;
    for (let v = 0; v <= 100; v += 20) { LAB.svg('line', { class: 'grid', x1: left, x2: W - right, y1: Y(v), y2: Y(v) }, s); LAB.text(s, left - 8, Y(v) + 5, String(v), { 'text-anchor': 'end' }); }
    for (let v = 0; v <= xMax + 1e-9; v += xStep) LAB.text(s, X(v), H - bottom + 20, String(+v.toFixed(2)), { 'text-anchor': 'middle' });
    LAB.svg('line', { class: 'axis-light', x1: left, x2: W - right, y1: Y(0), y2: Y(0) }, s);
    LAB.text(s, (left + W - right) / 2, H - 6, o.xLabel, { 'text-anchor': 'middle', class: 'axis-title' });
    if (!narrow) LAB.text(s, 15, (top + H - bottom) / 2, 'Inference strength (%)', { 'text-anchor': 'middle', class: 'axis-title', transform: `rotate(-90 15 ${(top + H - bottom) / 2})` });
    const dots = LAB.svg('g', {}, s);
    o.points.forEach(p => {
      if (!(p.x <= xMax)) return;
      const c = LAB.svg('circle', { cx: X(p.x), cy: Y(p.y), r: o.r || 2.6, class: 'dot-diff' }, dots);
      if (o.dotTitle) title(c, o.dotTitle(p));
    });
    if (o.fit) {
      const d = []; for (let k = 0; k <= 80; k++) { const x = xMax * k / 80, y = o.fit.at(x); if (y <= 100 && y >= 0) d.push(`${d.length ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(y).toFixed(1)}`); }
      const g = LAB.svg('g', {}, s); title(g, `Exponential fit: ${o.fit.a.toFixed(1)} · e^(−${o.fit.b.toFixed(2)} · distance), R² = ${o.fit.r2.toFixed(2)}`);
      LAB.svg('path', { d: d.join(' '), class: 'fit-neutral', fill: 'none' }, g);
    }
    return s;
  }

  /* Each student's own correlation against an English rating, with the
     least-squares line and its 95% band. o: {points: [{x, y}], fit, xLabel, label} */
  function profScatter(host, o) {
    const W = widthOf(host, 620), narrow = W < 460, H = 300, left = narrow ? 44 : 58, right = 14, top = 12, bottom = 50;
    const s = root(host, W, H, o.label);
    const X = v => left + (v - 1) / 6 * (W - left - right), Y = v => top + (1 - (v + 1) / 2) * (H - top - bottom);
    [-1, -0.5, 0, 0.5, 1].forEach(v => { LAB.svg('line', { class: Math.abs(v) < 1e-9 ? 'zero-ref' : 'grid', x1: left, x2: W - right, y1: Y(v), y2: Y(v) }, s); LAB.text(s, left - 8, Y(v) + 5, v === 0 ? '0' : r2(v), { 'text-anchor': 'end' }); });
    for (let v = 1; v <= 7; v++) LAB.text(s, X(v), H - bottom + 20, String(v), { 'text-anchor': 'middle' });
    LAB.text(s, (left + W - right) / 2, H - 6, o.xLabel, { 'text-anchor': 'middle', class: 'axis-title' });
    if (!narrow) LAB.text(s, 15, (top + H - bottom) / 2, 'Student’s correlation (r)', { 'text-anchor': 'middle', class: 'axis-title', transform: `rotate(-90 15 ${(top + H - bottom) / 2})` });
    const f = o.fit, xs = o.points.map(p => p.x);
    if (f) {
      const x0 = Math.min(...xs), x1 = Math.max(...xs), up = [], dn = [];
      for (let k = 0; k <= 30; k++) { const x = x0 + (x1 - x0) * k / 30, y = f.at(x), h = f.band(x); up.push(`${X(x).toFixed(1)} ${Y(Math.min(1, y + h)).toFixed(1)}`); dn.unshift(`${X(x).toFixed(1)} ${Y(Math.max(-1, y - h)).toFixed(1)}`); }
      LAB.svg('path', { d: 'M' + up.concat(dn).join('L') + 'Z', class: 'band-neutral' }, s);
    }
    o.points.forEach(p => { const c = LAB.svg('circle', { cx: X(p.x), cy: Y(p.y), r: 4.5, class: 'dot-diff' }, s); title(c, `A student rating their English ${+p.x.toFixed(2)}: r = ${r2(p.y)}`); });
    if (f) { const x0 = Math.min(...xs), x1 = Math.max(...xs), g = LAB.svg('g', {}, s); title(g, `Fitted line: ${r2(f.b)} per rating point`); LAB.svg('line', { x1: X(x0), x2: X(x1), y1: Y(f.at(x0)), y2: Y(f.at(x1)), class: 'fit-neutral' }, g); }
    return s;
  }

  /* The slope for every English rating, with its 95% CI (change in the
     student's correlation per rating point). rows: [{label, b, lo, hi, p, note}] */
  function slopes(host, rows, label) {
    const W = widthOf(host, 760), narrow = W < 520, rowH = narrow ? 48 : 34, left = narrow ? 12 : 140, right = 60, top = 6, bottom = 46;
    const H = top + rows.length * rowH + bottom;
    const m = Math.max(0.1, ...rows.flatMap(r => [Math.abs(r.lo), Math.abs(r.hi)]).filter(isFinite));
    const step = m > 0.4 ? 0.2 : m > 0.2 ? 0.1 : 0.05, lim = Math.ceil(m / step - 1e-9) * step;
    const X = v => left + (v + lim) / (2 * lim) * (W - left - right);
    const s = root(host, W, H, label);
    for (let v = -lim; v <= lim + 1e-9; v += step) {
      LAB.svg('line', { class: Math.abs(v) < 1e-9 ? 'zero' : 'grid', x1: X(v), x2: X(v), y1: top, y2: H - bottom + 6 }, s);
      LAB.text(s, X(v), H - bottom + 22, Math.abs(v) < 1e-9 ? '0' : (v > 0 ? '+' : MINUS) + Math.abs(v).toFixed(2).replace(/^0/, ''), { 'text-anchor': 'middle' });
    }
    LAB.text(s, (left + W - right) / 2, H - 4, narrow ? 'Change in r per rating point' : 'Change in the student’s correlation per rating point', { 'text-anchor': 'middle', class: 'label-strong' });
    rows.forEach((r, i) => {
      const y = top + i * rowH + (narrow ? 32 : rowH / 2), sig = isFinite(r.p) && r.p < 0.05;
      LAB.text(s, 0, narrow ? y - 14 : y + 5, r.label, { class: (sig ? 'label-strong' : 'row-label') + (narrow ? ' halo' : '') });
      if (!isFinite(r.b)) { LAB.text(s, X(0), y + 5, r.note || 'not enough data', { 'text-anchor': 'middle', class: 'row-label halo' }); return; }
      const g = LAB.svg('g', {}, s);
      title(g, `${r.label}: ${r2(r.b)} per rating point (95% CI ${r2(r.lo)} to ${r2(r.hi)})` + (isFinite(r.p) ? `, p ${r.p < 0.001 ? '< .001' : '= ' + r.p.toFixed(3).replace(/^0/, '')}` : ''));
      LAB.svg('line', { x1: X(Math.max(-lim, r.lo)), x2: X(Math.min(lim, r.hi)), y1: y, y2: y, class: 'forest-ci' + (sig ? ' sig' : '') }, g);
      LAB.svg('circle', { cx: X(r.b), cy: y, r: 5.5, class: 'forest-dot' + (sig ? ' sig' : '') }, g);
      LAB.text(s, W - 2, y + 5, (r.b >= 0.005 ? '+' : '') + r2(r.b), { 'text-anchor': 'end', class: sig ? 'value-label strong' : 'value-label' });
    });
    return s;
  }

  window.ANIMAL_MAP = { parse, analyse, draw, decay, profScatter, slopes, mds, fitExp, f2, r2 };
})();
