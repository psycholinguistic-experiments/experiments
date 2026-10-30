/* LT5461 — emotion task results (window.EMOTION).

   Each student's arrangement gives 1,081 distances (every pair of the 47
   words), measured in pixels as they left the box and divided by the box's
   diagonal (0–1). The paper's checks decide who is analysed: the two 灾难
   within 10% of the diagonal of each other, at least 100 s arranging, and an
   arranging time within 3 SD of the class mean.

   The class's emotion space is the mean of these distances over the analysed
   students (as the paper's per-language "aggregate matrix"). It is compared,
   by Spearman correlation over the 1,081 pairs, with the mean matrix of each of
   the paper's 15 languages (assets/data/emotion-paper.json, from its OSF data),
   with a Mantel test (999 permutations of the words) against the Chinese
   speakers. Across the 14 other languages, the class's similarity is related
   to the difference in long-term orientation from China and to geographic
   distance (Pearson r, as the paper's Fig. 3), next to the same relation for
   the paper's own Chinese speakers.

   Students: each one's Spearman r with the rest of the analysed class (leave
   one out) and with the paper's Chinese speakers; the paper's 50 Chinese
   speakers' own leave-one-out values are the benchmark. Words: for each word,
   the Spearman r between its 46 distances in the class and in the paper's
   Chinese speakers (low = placed differently).

   Maps: classical MDS of the mean matrix; the class map is rotated, reflected
   and scaled (Procrustes) onto the paper's Chinese map, so arrows show where
   each word moved. Valence: Warriner et al. (2013), English labels (< 5
   negative), as the paper's Fig. 5. */
(function () {
  'use strict';
  const C = window.EMOTION_CORE, K = C.K, PAIRS = C.PAIRS, NP = PAIRS.length, WORDS = C.WORDS;
  const MIN_MS = 100000, Z_MAX = 3, NPERM = 999;
  const MINUS = '−';
  const num = v => (v === '' || v === null || v === undefined) ? NaN : Number(v);
  const r2 = v => isFinite(v) ? (v <= -0.005 ? MINUS : '') + Math.abs(v).toFixed(2).replace(/^0/, '') : '–';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // pair index of words i and j
  const PIDX = (() => { const m = []; for (let i = 0; i < K; i++) m.push(new Array(K).fill(-1)); PAIRS.forEach(([i, j], k) => { m[i][j] = k; m[j][i] = k; }); return m; })();

  /* ---------- the paper's data ---------- */
  let paperP = null;
  function loadPaper() {
    return paperP || (paperP = fetch('assets/data/emotion-paper.json?v=1').then(r => { if (!r.ok) throw new Error('paper data ' + r.status); return r.json(); }).then(prep).catch(e => { paperP = null; throw e; }));
  }
  function prep(P) {
    P.chinese = P.languages.find(l => l.key === 'chinese');
    P.neg = P.words.map(w => w.valence < 5);
    P.map = mds(P.chinese.mean);
    orient(P.map.xy);
    return P;
  }

  /* ---------- statistics ---------- */
  function ranks(v) {
    const idx = Array.from(v, (x, i) => i).sort((a, b) => v[a] - v[b]), r = new Float64Array(v.length);
    for (let s = 0; s < idx.length;) {
      let e = s; while (e + 1 < idx.length && v[idx[e + 1]] === v[idx[s]]) e++;
      const avg = (s + e) / 2 + 1; for (let k = s; k <= e; k++) r[idx[k]] = avg;
      s = e + 1;
    }
    return r;
  }
  function pearson(x, y) {
    const n = x.length; if (n < 3) return NaN;
    let mx = 0, my = 0; for (let k = 0; k < n; k++) { mx += x[k]; my += y[k]; } mx /= n; my /= n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let k = 0; k < n; k++) { const a = x[k] - mx, b = y[k] - my; sxy += a * b; sxx += a * a; syy += b * b; }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
  }
  const spearman = (x, y) => pearson(ranks(x), ranks(y));
  // Pearson r with its t-test and a Fisher-z 95% CI
  function corTest(x, y) {
    const n = x.length, r = pearson(x, y);
    if (!isFinite(r) || n < 4) return { n, r, p: NaN, ci: [NaN, NaN] };
    const t = r * Math.sqrt((n - 2) / Math.max(1e-15, 1 - r * r)), z = Math.atanh(Math.max(-0.999999, Math.min(0.999999, r))), h = 1.959964 / Math.sqrt(n - 3);
    return { n, r, t, df: n - 2, p: LAB.pT(t, n - 2), ci: [Math.tanh(z - h), Math.tanh(z + h)] };
  }
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  /* Mantel test (Spearman): the words of one matrix are shuffled 999 times;
     p = (1 + permutations at least as large) / 1000, one-sided as in vegan. */
  function mantel(x, y, seed) {
    const rx = ranks(x), ry = ranks(y), n = NP;
    let mx = 0, my = 0; for (let k = 0; k < n; k++) { mx += rx[k]; my += ry[k]; } mx /= n; my /= n;
    let sxx = 0, syy = 0; for (let k = 0; k < n; k++) { sxx += (rx[k] - mx) ** 2; syy += (ry[k] - my) ** 2; }
    const cx = Float64Array.from(rx, v => v - mx), cyM = PIDX.map(row => row.map(k => (k < 0 ? 0 : ry[k] - my)));
    const stat = perm => { let s = 0; for (let k = 0; k < n; k++) { const [i, j] = PAIRS[k]; s += cx[k] * cyM[perm[i]][perm[j]]; } return s / Math.sqrt(sxx * syy); };
    const id = Array.from({ length: K }, (_, i) => i), r = stat(id), R = rng(seed || 20260226);
    let ge = 0;
    for (let b = 0; b < NPERM; b++) {
      const p = id.slice(); for (let i = K - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
      if (stat(p) >= r - 1e-12) ge++;
    }
    return { r, p: (ge + 1) / (NPERM + 1) };
  }

  /* ---------- maps ---------- */
  function jacobi(S) {
    const n = S.length, a = S.map(r => r.slice()), v = S.map((_, i) => S.map((__, j) => (i === j ? 1 : 0)));
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
      if (off < 1e-22) break;
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
  // classical (Torgerson) MDS of a pair vector → 47 [x, y], largest coordinate 0.9; share = the two dimensions' part of the positive eigenvalues
  function mds(v) {
    const D2 = PIDX.map((row, i) => row.map(k => (k < 0 ? 0 : v[k] * v[k])));
    const rm = D2.map(r => r.reduce((s, x) => s + x, 0) / K), gm = rm.reduce((s, x) => s + x, 0) / K;
    const B = D2.map((r, i) => r.map((d, j) => -0.5 * (d - rm[i] - rm[j] + gm)));
    const e = jacobi(B), tot = e.filter(x => x.value > 1e-12).reduce((s, x) => s + x.value, 0);
    const c = [0, 1].map(k => e[k] && e[k].value > 1e-12 ? e[k].vector.map(x => x * Math.sqrt(e[k].value)) : new Array(K).fill(0));
    const big = Math.max(1e-12, ...c[0].map(Math.abs), ...c[1].map(Math.abs));
    return { xy: WORDS.map((_, i) => [c[0][i] * 0.9 / big, c[1][i] * 0.9 / big]), share: tot > 0 ? (Math.max(0, e[0].value) + Math.max(0, e[1] ? e[1].value : 0)) / tot : NaN };
  }
  // the paper's map: 快乐 (happiness) to the right of 忧伤 (sadness), 兴奋 (excitement) above 平静 (serenity)
  const W_ = key => WORDS.findIndex(w => w.key === key);
  function orient(xy) {
    if (xy[W_('happiness')][0] < xy[W_('sadness')][0]) xy.forEach(p => { p[0] = -p[0]; });
    if (xy[W_('excitement')][1] < xy[W_('serenity')][1]) xy.forEach(p => { p[1] = -p[1]; });
  }
  // rotate, reflect and scale X onto Y (least squares); returns the moved X
  function procrustes(X, Y) {
    const n = X.length, cX = [0, 1].map(d => X.reduce((s, p) => s + p[d], 0) / n), cY = [0, 1].map(d => Y.reduce((s, p) => s + p[d], 0) / n);
    let best = null;
    [1, -1].forEach(f => {
      const x = X.map(p => [p[0] - cX[0], (p[1] - cX[1]) * f]), y = Y.map(p => [p[0] - cY[0], p[1] - cY[1]]);
      let A = 0, B = 0, xx = 0; for (let k = 0; k < n; k++) { A += x[k][0] * y[k][0] + x[k][1] * y[k][1]; B += x[k][0] * y[k][1] - x[k][1] * y[k][0]; xx += x[k][0] ** 2 + x[k][1] ** 2; }
      const th = Math.atan2(B, A), s = xx > 0 ? Math.hypot(A, B) / xx : 0, fit = Math.hypot(A, B);
      if (!best || fit > best.fit) best = { fit, out: x.map(([a, b]) => [s * (a * Math.cos(th) - b * Math.sin(th)) + cY[0], s * (a * Math.sin(th) + b * Math.cos(th)) + cY[1]]) };
    });
    return best.out;
  }

  /* ---------- one stored row → a student ---------- */
  function parseRow(r) {
    const pos = C.unpack(r.p1, r.p2), W = num(r.arena_w), H = num(r.arena_h);
    if (!pos || !(W > 0 && H > 0)) return null;
    const d = C.distances(pos, W, H);
    return { pid: String(r.pid), row: r, pos, W, H, d: d.pairs, check: d.check, checkOk: d.check <= C.CHECK_MAX,
      ms: num(r.arrange_ms), moves: num(r.n_moves), first: num(r.first_move_ms), last: num(r.last_move_ms),
      l1: r.l1 || '', input: r.input || '', resumed: String(r.resumed) === '1', simulated: String(r.simulated) === '1', submitted: r.submitted_at, session: r.session };
  }

  /* ---------- the class ---------- */
  function analyse(parts, P, o) {
    const apply = !(o && o.apply === false);
    const times = parts.map(p => p.ms).filter(isFinite), mT = LAB.mean(times), sT = LAB.sd(times);
    parts.forEach(p => {
      p.fast = !(p.ms >= MIN_MS);
      p.z = times.length >= 3 && sT > 0 && isFinite(p.ms) ? (p.ms - mT) / sT : NaN;
      p.outlier = Math.abs(p.z) > Z_MAX;
      p.passes = p.checkOk && !p.fast && !p.outlier;
      p.used = apply ? p.passes : true;
    });
    const U = parts.filter(p => p.used), n = U.length;
    const out = { parts, used: U, n, apply, checks: { cat: parts.filter(p => !p.checkOk).length, fast: parts.filter(p => p.fast).length, outlier: parts.filter(p => p.outlier).length } };
    parts.forEach(p => { p.rPaper = spearman(p.d, P.chinese.mean); p.rClass = NaN; });
    if (!n) return out;
    const sum = new Float64Array(NP); U.forEach(p => { for (let k = 0; k < NP; k++) sum[k] += p.d[k]; });
    const mean = out.mean = Float64Array.from(sum, v => v / n);
    parts.forEach(p => {
      const m = p.used ? n - 1 : n; if (m < 1) return;
      const ref = Float64Array.from(sum, (v, k) => (p.used ? v - p.d[k] : v) / m);
      p.rClass = spearman(p.d, ref);
    });
    out.rClass = U.map(p => p.rClass).filter(isFinite);
    out.rPaper = U.map(p => p.rPaper).filter(isFinite);
    const ch = P.chinese.hofstede.orientation;
    out.langs = P.languages.map(L => ({ key: L.key, label: L.label, n: L.n, r: spearman(mean, L.mean), rPaper: L.key === 'chinese' ? NaN : spearman(P.chinese.mean, L.mean),
      lto: L.hofstede.orientation, dLto: Math.abs(L.hofstede.orientation - ch), geo: L.geo_km_from_china })).sort((a, b) => b.r - a.r);
    out.langs.forEach((l, i) => { l.rank = i + 1; });
    out.chinese = out.langs.find(l => l.key === 'chinese');
    out.mantel = n >= 1 ? mantel(mean, P.chinese.mean) : null;
    const O = out.langs.filter(l => l.key !== 'chinese');
    out.rel = {
      lto: corTest(O.map(l => l.dLto), O.map(l => l.r)), ltoPaper: corTest(O.map(l => l.dLto), O.map(l => l.rPaper)),
      geo: corTest(O.map(l => l.geo / 1000), O.map(l => l.r)), geoPaper: corTest(O.map(l => l.geo / 1000), O.map(l => l.rPaper))
    };
    const M = mds(mean);
    out.map = { xy: procrustes(M.xy, P.map.xy), share: M.share };
    out.words = WORDS.map((w, i) => {
      const ks = PIDX[i].filter(k => k >= 0);
      return { i, key: w.key, zh: w.zh, valence: P.words[i].valence, neg: P.neg[i], r: spearman(ks.map(k => mean[k]), ks.map(k => P.chinese.mean[k])),
        shift: Math.hypot(out.map.xy[i][0] - P.map.xy[i][0], out.map.xy[i][1] - P.map.xy[i][1]) };
    }).sort((a, b) => a.r - b.r);
    const neg = out.words.filter(w => w.neg).map(w => w.r), pos = out.words.filter(w => !w.neg).map(w => w.r);
    out.valence = { neg: LAB.mean(neg), pos: LAB.mean(pos), nNeg: neg.length, nPos: pos.length };
    return out;
  }

  /* ---------- simulated class (demo only; never stored) ----------
     Each simulated student starts from the paper's Chinese map, turned and
     flipped at random (people orient their arrangements differently), with
     their own noise on every word; a few are careless (灾难 apart, or very fast). */
  function simulate(n, seed, P) {
    const R = rng(seed || 7), g = () => Math.sqrt(-2 * Math.log(R() + 1e-12)) * Math.cos(2 * Math.PI * R());
    const boxes = [[1246, 651], [1398, 780], [1150, 600], [1310, 690]], base = P.map.xy, despair = W_('despair'), rows = [];
    for (let s = 0; s < n; s++) {
      const [Wb, Hb] = boxes[Math.floor(R() * boxes.length)], th = R() * 2 * Math.PI, flip = R() < 0.5 ? -1 : 1, noise = 0.24 + R() * 0.24;
      const careless = R() < 0.07, rushed = !careless && R() < 0.05;
      const pts = base.map(([x, y]) => { const a = x, b = y * flip; return [a * Math.cos(th) - b * Math.sin(th) + g() * noise, a * Math.sin(th) + b * Math.cos(th) + g() * noise]; });
      const at = careless ? null : pts[despair];
      pts.push(careless ? [R() * 2 - 1, R() * 2 - 1] : [at[0] + 0.05 + g() * 0.02, at[1] + 0.06 + g() * 0.02]);
      pts.push(careless ? [R() * 2 - 1, R() * 2 - 1] : [at[0] - 0.04 + g() * 0.02, at[1] + 0.09 + g() * 0.02]);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const pos = pts.map(([x, y]) => ({ x: 0.05 + 0.9 * (x - x0) / (x1 - x0), y: 0.06 + 0.88 * (y - y0) / (y1 - y0) }));
      const [p1, p2] = C.pack(pos), ms = Math.round(rushed ? 60000 + R() * 30000 : Math.exp(Math.log(420000) + g() * 0.35));
      rows.push({ exp: 'emotion', pid: `SIM-${String(s + 1).padStart(2, '0')}`, session: 'demo', l1: s % 12 ? 'yes' : 'no', arena_w: Wb, arena_h: Hb, input: 'mouse', resumed: 0,
        n_moves: 49 + Math.floor(R() * 60), first_move_ms: 2000 + Math.round(R() * 6000), last_move_ms: ms - Math.round(R() * 4000), arrange_ms: ms,
        items: C.VERSION, p1, p2, include: 1, simulated: 1, submitted_at: new Date(Date.UTC(2026, 9, 30, 2, 0, s * 9)).toISOString() });
    }
    return rows;
  }

  /* ---------- charts ---------- */
  const widthOf = (host, max) => Math.max(300, Math.min(max, Math.round(host.getBoundingClientRect().width) || max));
  const svgRoot = (host, W, H, label) => { host.textContent = ''; return LAB.svg('svg', { class: 'chart fc em', viewBox: `0 0 ${W} ${H}`, style: `max-width:${W}px`, role: 'img', 'aria-label': label }, host); };
  const el = (tag, attrs, parent) => LAB.svg(tag, attrs, parent);
  const txt = (parent, x, y, s, attrs) => { const t = el('text', Object.assign({ x, y }, attrs || {}), parent); t.textContent = s; return t; };
  const tip = (node, s) => { el('title', {}, node).textContent = s; return node; };
  let ctx = null;
  const measure = (s, px, weight) => { ctx = ctx || document.createElement('canvas').getContext('2d'); ctx.font = `${weight || 600} ${px}px 'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC','Open Sans',sans-serif`; return ctx.measureText(s).width; };

  /* Labels beside points without overlapping each other or the points:
     each label tries eight spots around its point, nearest first, and takes
     the first free one (or the least crowded). pts: [{x, y, text, px}] */
  function placeLabels(pts, box) {
    const placed = [], gap = 4, r = 6;
    const hits = (b, list) => list.reduce((s, q) => s + Math.max(0, Math.min(b.x1, q.x1) - Math.max(b.x0, q.x0)) * Math.max(0, Math.min(b.y1, q.y1) - Math.max(b.y0, q.y0)), 0);
    const dots = pts.map(p => ({ x0: p.x - r, x1: p.x + r, y0: p.y - r, y1: p.y + r }));
    const order = pts.map((p, i) => i).sort((a, b) => pts[a].y - pts[b].y || pts[a].x - pts[b].x);
    const out = new Array(pts.length);
    order.forEach(i => {
      const p = pts[i], w = measure(p.text, p.px), h = p.px * 1.15;
      const cands = [[r + gap, -h / 2], [-r - gap - w, -h / 2], [-w / 2, -r - gap - h], [-w / 2, r + gap], [r + gap * 0.5, -h - r * 0.4], [r + gap * 0.5, r * 0.4], [-r - gap * 0.5 - w, -h - r * 0.4], [-r - gap * 0.5 - w, r * 0.4]];
      let best = null;
      cands.forEach(([dx, dy], k) => {
        const b = { x0: p.x + dx, x1: p.x + dx + w, y0: p.y + dy, y1: p.y + dy + h };
        const out_ = Math.max(0, box.x0 - b.x0) + Math.max(0, b.x1 - box.x1) + Math.max(0, box.y0 - b.y0) + Math.max(0, b.y1 - box.y1);
        const cost = hits(b, placed) * 4 + hits(b, dots) + out_ * 200 + k * 0.5;
        if (!best || cost < best.cost) best = { cost, b };
      });
      placed.push(best.b); out[i] = best.b;
    });
    return out;
  }

  // the class map (o.arrows: from where the paper's Chinese speakers put each word)
  function mapChart(host, A, P, o) {
    o = o || {};
    const W = widthOf(host, 940), pad = 18, turn = W < 600;
    // narrow screens: a quarter turn, so the long side runs down the page (distances are unchanged)
    const T = turn ? p => [p[1], -p[0]] : p => p, cls = A.map.xy.map(T), pap = P.map.xy.map(T);
    const all = cls.concat(o.arrows ? pap : []);
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const xr = Math.max(1e-9, Math.max(...xs) - Math.min(...xs)), yr = Math.max(1e-9, Math.max(...ys) - Math.min(...ys));
    const H = Math.round(Math.min(turn ? 760 : 640, Math.max(300, yr / xr * (W - 2 * pad - 70) + 2 * pad + 28)));
    const s = 1 / Math.max(xr / (W - 2 * pad - 70), yr / (H - 2 * pad - 28));
    const X = x => W / 2 + (x - cx) * s, Y = y => H / 2 - (y - cy) * s;   // equal scales
    const svg = svgRoot(host, W, H, `Map of the 47 emotion words from the class's arrangements (${A.n} student${A.n === 1 ? '' : 's'}); closer words were placed closer together.`);
    el('rect', { x: 0.5, y: 0.5, width: W - 1, height: H - 1, class: 'em-frame' }, svg);
    if (o.arrows) WORDS.forEach((w, i) => {
      const a = pap[i], b = cls[i];
      el('line', { x1: X(a[0]), y1: Y(a[1]), x2: X(b[0]), y2: Y(b[1]), class: 'em-arrow' }, svg);
      tip(el('circle', { cx: X(a[0]), cy: Y(a[1]), r: 3, class: 'em-paper' }, svg), `${w.zh} ${w.key}: where the paper's Chinese speakers put it`);
    });
    const pts = WORDS.map((w, i) => ({ x: X(cls[i][0]), y: Y(cls[i][1]), text: w.zh, px: turn ? 13 : 14 }));
    const lab = placeLabels(pts, { x0: 4, x1: W - 4, y0: 4, y1: H - 4 });
    WORDS.forEach((w, i) => {
      const g = el('g', { class: 'em-pt' }, svg);
      tip(g, `${w.zh} ${w.key} · valence ${P.words[i].valence.toFixed(1)} (${P.neg[i] ? 'negative' : 'positive'})`);
      el('circle', { cx: pts[i].x, cy: pts[i].y, r: 10, class: 'hit' }, g);
      el('circle', { cx: pts[i].x, cy: pts[i].y, r: 4.5, class: P.neg[i] ? 'em-neg' : 'em-pos' }, g);
      txt(g, lab[i].x0, lab[i].y1 - 3, w.zh, { class: 'em-label', lang: 'zh-Hans' });
    });
  }

  // a student's own arrangement, as they left the box
  function personMap(host, p, P) {
    const W = widthOf(host, 940), H = Math.round(W * p.H / p.W);
    const svg = svgRoot(host, W, H, `This student's arrangement of the 49 words, as they left the box.`);
    el('rect', { x: 0.5, y: 0.5, width: W - 1, height: H - 1, class: 'em-frame' }, svg);
    const X = k => p.pos[k].x * W, Y = k => p.pos[k].y * H;
    el('line', { x1: X(47), y1: Y(47), x2: X(48), y2: Y(48), class: 'em-check' + (p.checkOk ? '' : ' bad') }, svg);
    C.ITEMS.forEach((it, k) => {
      const g = el('g', {}, svg), neg = k < K ? P.neg[k] : null;
      tip(g, k < K ? `${it.zh} ${it.key}` : `${it.zh} (attention check: the two copies should be together)`);
      txt(g, X(k), Y(k) + 5, it.zh, { class: 'em-word ' + (neg === null ? 'em-chk' : neg ? 'em-neg-t' : 'em-pos-t'), 'text-anchor': 'middle', lang: 'zh-Hans' });
    });
  }

  // the class (and the paper's Chinese speakers) against each of the 15 languages
  function langChart(host, A) {
    const L = A.langs, W = widthOf(host, 760), narrow = W < 520, rowH = 26, top = narrow ? 46 : 30, left = narrow ? 84 : Math.min(176, W * 0.34), right = 46, H = top + rowH * L.length + 30;
    const lo = Math.min(0.5, ...L.map(l => l.r).filter(isFinite), ...L.map(l => l.rPaper).filter(isFinite)) - 0.02, hi = 1;
    const X = v => left + (v - lo) / (hi - lo) * (W - left - right);
    const svg = svgRoot(host, W, H, 'Spearman correlation between the class and each language of the paper, highest first: ' + L.map(l => `${l.label} ${r2(l.r)}`).join(', '));
    for (let v = Math.ceil(lo * 10) / 10; v <= 1.0001; v += narrow ? 0.2 : 0.1) { el('line', { class: 'grid', x1: X(v), x2: X(v), y1: top - 6, y2: H - 26 }, svg); txt(svg, X(v), H - 10, r2(v), { 'text-anchor': 'middle' }); }
    txt(svg, narrow ? 0 : left, 14, '● Our class', { class: 'label-strong' });
    txt(svg, narrow ? 0 : left + 96, narrow ? 32 : 14, '○ The paper’s Chinese speakers', { class: 'em-legend-b' });
    L.forEach((l, i) => {
      const y = top + i * rowH + rowH / 2, g = el('g', {}, svg);
      tip(g, `${l.label} (${l.n} speakers): our class ${r2(l.r)}${isFinite(l.rPaper) ? `; the paper's Chinese speakers ${r2(l.rPaper)}` : ''}`);
      el('rect', { x: 0, y: y - rowH / 2, width: W, height: rowH, class: 'hit' }, g);
      txt(g, left - 10, y + 4, l.label + (l.key === 'chinese' && !narrow ? ' (same language)' : ''), { 'text-anchor': 'end', class: l.key === 'chinese' ? 'label-strong' : '' });
      if (isFinite(l.rPaper)) { el('line', { x1: X(l.rPaper), x2: X(l.r), y1: y, y2: y, class: 'em-link' }, g); el('circle', { cx: X(l.rPaper), cy: y, r: 4.5, class: 'em-paper-dot' }, g); }
      el('circle', { cx: X(l.r), cy: y, r: 5, class: 'em-class-dot' }, g);
      txt(g, W - right + 10, y + 4, r2(l.r), { class: 'value-label' });
    });
    txt(svg, narrow ? W / 2 : left + (W - left - right) / 2, H - 0, narrow ? 'Spearman ρ with each language' : 'Spearman correlation with the language’s mean arrangement', { 'text-anchor': 'middle', class: 'axis-title' });
  }

  // similarity against cultural distance, across the 14 other languages: one panel per measure
  function relChart(host, A, which) {
    const L = A.langs.filter(l => l.key !== 'chinese'), W = widthOf(host, 470), H = Math.round(Math.min(330, W * 0.72)), left = 44, right = 14, top = 14, bottom = 42;
    const xv = l => which === 'lto' ? l.dLto : l.geo / 1000, xt = which === 'lto' ? 'Difference in long-term orientation from China' : 'Distance from China (1,000 km)';
    const xsAll = L.map(xv), ysAll = L.map(l => l.r).concat(L.map(l => l.rPaper)).filter(isFinite);
    const x0 = 0, x1 = Math.max(...xsAll) * 1.06, y0 = Math.floor(Math.min(...ysAll) * 20) / 20 - 0.02, y1 = Math.min(1, Math.ceil(Math.max(...ysAll) * 20) / 20 + 0.02);
    const X = v => left + (v - x0) / (x1 - x0) * (W - left - right), Y = v => top + (1 - (v - y0) / (y1 - y0)) * (H - top - bottom);
    const svg = svgRoot(host, W, H, `Similarity to each language against ${which === 'lto' ? 'the difference in long-term orientation' : 'geographic distance'}`);
    for (let v = Math.ceil(y0 * 20) / 20; v <= y1 + 1e-9; v += 0.05) { el('line', { class: 'grid', x1: left, x2: W - right, y1: Y(v), y2: Y(v) }, svg); txt(svg, left - 6, Y(v) + 4, r2(v), { 'text-anchor': 'end' }); }
    const step = which === 'lto' ? 10 : 2;
    for (let v = 0; v <= x1; v += step) txt(svg, X(v), H - bottom + 16, String(v), { 'text-anchor': 'middle' });
    txt(svg, left + (W - left - right) / 2, H - 6, xt, { 'text-anchor': 'middle', class: 'axis-title' });
    const line = (ys, cls) => { const fit = LAB.ols(L.map(xv), ys); if (!fit || !isFinite(fit.b)) return; el('line', { x1: X(x0), x2: X(x1), y1: Y(fit.a + fit.b * x0), y2: Y(fit.a + fit.b * x1), class: cls }, svg); };
    line(L.map(l => l.rPaper), 'line-b'); line(L.map(l => l.r), 'line-a');
    L.forEach(l => {
      const g = el('g', {}, svg);
      tip(g, `${l.label}: ${which === 'lto' ? `LTO ${l.lto} (China 77), difference ${l.dLto}` : `${Math.round(l.geo).toLocaleString('en')} km from China`}; our class ${r2(l.r)}, the paper's Chinese speakers ${r2(l.rPaper)}`);
      el('circle', { cx: X(xv(l)), cy: Y(l.rPaper), r: 4, class: 'em-paper-dot' }, g);
      el('circle', { cx: X(xv(l)), cy: Y(l.r), r: 4.5, class: 'em-class-dot' }, g);
    });
    const lab = placeLabels(L.map(l => ({ x: X(xv(l)), y: Y(l.r), text: l.label, px: 11 })), { x0: left, x1: W - right, y0: top, y1: H - bottom });
    L.forEach((l, i) => txt(svg, lab[i].x0, lab[i].y1 - 2, l.label, { class: 'em-small' }));
  }

  // agreement: the paper's Chinese speakers with each other; students with the class; students with the paper
  function agreeChart(host, A, P) {
    const W = widthOf(host, 760), narrow = W < 560;
    const rowsD = [[narrow ? 'Paper’s speakers vs each other' : 'The paper’s Chinese speakers, each vs the other 49', P.chinese_loo, 'em-paper-dot'], [narrow ? 'Students vs the class' : 'Students, each vs the rest of the class', A.rClass || [], 'em-class-dot'], [narrow ? 'Students vs the paper' : 'Students, each vs the paper’s Chinese speakers', A.rPaper || [], 'em-class-dot']];
    const rowH = 58, top = 8, left = 12, right = 12, H = top + rowH * rowsD.length + 34;
    const all = rowsD.flatMap(r => r[1]), lo = Math.min(0, Math.floor(Math.min(...all, 0.2) * 10) / 10), hi = 1;
    const X = v => left + (v - lo) / (hi - lo) * (W - left - right);
    const svg = svgRoot(host, W, H, 'Agreement between arrangements (Spearman r): ' + rowsD.map(r => `${r[0]}: median ${r2(LAB.median(r[1]))}`).join('; '));
    for (let v = Math.ceil(lo * 5 - 1e-9) / 5; v <= hi + 1e-9; v += 0.2) { el('line', { class: 'grid', x1: X(v), x2: X(v), y1: top, y2: H - 30 }, svg); txt(svg, X(v), H - 14, r2(v), { 'text-anchor': 'middle' }); }
    txt(svg, left + (W - left - right) / 2, H, narrow ? 'Spearman ρ, 1,081 word pairs' : 'Spearman correlation over the 1,081 word pairs', { 'text-anchor': 'middle', class: 'axis-title' });
    rowsD.forEach(([label, vals, cls], i) => {
      const y = top + i * rowH, md = LAB.median(vals);
      txt(svg, left, y + 14, `${label} · ${vals.length ? 'median ' + r2(md) : 'none yet'}`, { class: 'label-strong' });
      vals.forEach((v, k) => { const jy = y + 34 + ((k * 7) % 11) - 5; tip(el('circle', { cx: X(v), cy: jy, r: 3.5, class: cls }, svg), r2(v)); });
      if (vals.length) el('line', { x1: X(md), x2: X(md), y1: y + 22, y2: y + 46, class: 'mean' }, svg);
    });
  }

  // all 47 words, least like the paper's Chinese speakers first
  function wordsChart(host, A) {
    const Wd = A.words, W = widthOf(host, 620), rowH = 17, top = 8, left = 132, right = 44, H = top + rowH * Wd.length + 34;
    const lo = Math.min(0, Math.floor(Math.min(...Wd.map(w => w.r).filter(isFinite)) * 10) / 10), X = v => left + (v - lo) / (1 - lo) * (W - left - right);
    const svg = svgRoot(host, W, H, 'For each word, the correlation between its distances in the class and among the paper’s Chinese speakers, lowest first.');
    for (let v = Math.ceil(lo * 5 - 1e-9) / 5; v <= 1 + 1e-9; v += 0.2) { el('line', { class: 'grid', x1: X(v), x2: X(v), y1: top, y2: H - 30 }, svg); txt(svg, X(v), H - 14, r2(v), { 'text-anchor': 'middle' }); }
    txt(svg, W < 520 ? W / 2 : left + (W - left - right) / 2, H, W < 520 ? 'r, class vs the paper' : 'Correlation of the word’s 46 distances: class vs the paper', { 'text-anchor': 'middle', class: 'axis-title' });
    Wd.forEach((w, k) => {
      const y = top + k * rowH + rowH / 2, g = el('g', {}, svg);
      tip(g, `${w.zh} ${w.key}: r = ${r2(w.r)} · valence ${w.valence.toFixed(1)}`);
      el('rect', { x: 0, y: y - rowH / 2, width: W, height: rowH, class: 'hit' }, g);
      txt(g, left - 10, y + 4, `${w.zh} ${w.key}`, { 'text-anchor': 'end', class: 'em-small' });
      el('line', { x1: X(Math.max(lo, 0)), x2: X(w.r), y1: y, y2: y, class: 'em-link' }, g);
      el('circle', { cx: X(w.r), cy: y, r: 4, class: w.neg ? 'em-neg' : 'em-pos' }, g);
      txt(g, W - right + 8, y + 4, r2(w.r), { class: 'em-small' });
    });
  }

  /* ---------- downloads ---------- */
  const NA = v => (v === '' || v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) ? 'NA' : v;
  // the paper's long format (emotion_data.csv on OSF): one row per student and word pair, word1 < word2 alphabetically
  function distRows(parts) {
    const pairs = PAIRS.map(([i, j], k) => { const a = WORDS[i], b = WORDS[j]; return a.key < b.key ? [a, b, k] : [b, a, k]; });
    return parts.flatMap(p => pairs.map(([a, b, k]) => ({
      word1: a.key, word2: b.key, word_pair: `${a.key}-${b.key}`, distance: +p.d[k].toFixed(6), ppn: p.label, native: p.l1 === 'yes' ? 'chinese' : p.l1 === 'no' ? 'other' : 'NA',
      away: 'NA', raised: 'NA', gender: 'NA', age: 'NA', education: 'NA', num_lang: 'NA', lang: 'NA',
      first_click: NA(isFinite(p.first) ? p.first / 1000 : NaN), last_click: NA(isFinite(p.last) ? p.last / 1000 : NaN), click_count: NA(p.moves), duration: NA(isFinite(p.ms) ? p.ms / 1000 : NaN),
      word1_zh: a.zh, word2_zh: b.zh, pid: p.pid, session: NA(p.session), passes_checks: p.passes ? 1 : 0, analysed: p.used ? 1 : 0, simulated: p.simulated ? 1 : 0 })));
  }
  const posRows = parts => parts.flatMap(p => C.ITEMS.map((it, k) => ({ participant: p.label, pid: p.pid, item: k + 1, word: it.key, zh: it.zh, x_share: +p.pos[k].x.toFixed(4), y_share: +p.pos[k].y.toFixed(4),
    x_px: Math.round(p.pos[k].x * p.W), y_px: Math.round(p.pos[k].y * p.H), box_w: p.W, box_h: p.H })));
  const studentRows = parts => parts.map(p => ({ participant: p.label, pid: p.pid, chinese_first_language: NA(p.l1), input: NA(p.input), box_w: p.W, box_h: p.H,
    arrange_s: NA(isFinite(p.ms) ? Math.round(p.ms / 100) / 10 : NaN), moves: NA(p.moves), catastrophe_distance: +p.check.toFixed(4), catastrophe_together: p.checkOk ? 1 : 0,
    under_100s: p.fast ? 1 : 0, time_z: NA(isFinite(p.z) ? +p.z.toFixed(2) : NaN), passes_checks: p.passes ? 1 : 0, analysed: p.used ? 1 : 0,
    r_with_class: NA(isFinite(p.rClass) ? +p.rClass.toFixed(4) : NaN), r_with_paper_chinese: NA(isFinite(p.rPaper) ? +p.rPaper.toFixed(4) : NaN), resumed: p.resumed ? 1 : 0, simulated: p.simulated ? 1 : 0 }));
  function matrixRows(A) {
    return WORDS.map((w, i) => { const o = { word: w.key, zh: w.zh }; WORDS.forEach((v, j) => { o[v.key] = i === j ? 0 : +A.mean[PIDX[i][j]].toFixed(5); }); return o; });
  }
  const CODEBOOK = `Emotion task (LT5461) - codebook

Task: 47 Chinese emotion words (Chaouch-Orozco, Li & Li, 2026, Appendix A) plus 灾难 ("catastrophe") twice, arranged in a box so that words closer in meaning sit closer together. Every word must be moved.
Distances: between the centres of two words as left in the box, in pixels, divided by the box's diagonal (0-1). 1,081 pairs of the 47 words.
Checks (the paper's): catastrophe_distance = distance between the two 灾难 (together if <= ${C.CHECK_MAX}); under_100s = arranged in less than 100 s; time_z = arranging time as a z-score in the class (|z| > 3 = outlier). passes_checks = together, not under 100 s, not an outlier. analysed = used in the class results.
Distances file: the columns of the paper's OSF file emotion_data.csv (word1 < word2 alphabetically, distance, ppn, native, ..., first_click, last_click, click_count, duration in seconds; columns the class did not collect are NA), then word1_zh, word2_zh, pid, session, passes_checks, analysed, simulated. native: chinese if the student answered that Chinese is a first language, other if not.
Positions file: each of the 49 names (items 48 and 49 are the two 灾难) as a share of the box (x_share from the left, y_share from the top) and in pixels.
Students file: r_with_class = Spearman r between the student's 1,081 distances and the mean of the other analysed students; r_with_paper_chinese = the same with the mean of the paper's 50 Chinese speakers.
Class matrix: the mean distance of each pair over the analysed students (47 x 47).
Missing values are NA, never 0.`;

  window.EMOTION = { MIN_MS, Z_MAX, loadPaper, parseRow, analyse, simulate, spearman, pearson, ranks, mantel, mds, procrustes, corTest,
    mapChart, personMap, langChart, relChart, agreeChart, wordsChart, distRows, posRows, studentRows, matrixRows, CODEBOOK, r2, esc };
})();
