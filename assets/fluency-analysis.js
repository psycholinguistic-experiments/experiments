/* LT5461 — fluency task results.
   Answers: each block's words as typed (split, trimmed; several words typed
   together were already separate answers). Per student and category:
   entries, different entries (repeats removed), and the valid ones: by
   default, in SUBTLEX-CH (Cai & Brysbaert, 2010; assets/data/subtlex-ch-wf.txt)
   and on the category list for that block (assets/data/category-animals.txt,
   category-fruitveg.txt; rules in materials/fluency/categories/RULES.md);
   or only in SUBTLEX-CH; or every different entry.
   Curiosity: the sum of each subscale, either all five items (5DC; je5, ds5,
   5–35) or the four the 5DCR keeps (without joy2 and depriv5; je, ds, 4–28,
   as in the class's earlier Curiosity Scale Analysis Rmd); high when above the
   class median, so four profiles (high/low deprivation × high/low joy).
   Per student and category: total responses (their different valid words)
   and unique responses (valid words no other student in the class gave).
   Groups (the whole class and the four profiles): mean total and unique
   responses, the number of different words, and a semantic network built as
   SemNeT does (semnet.js): words given by at least 2 of the group's students,
   equated across the four profiles, cosine similarity, TMFG; unweighted CC,
   ASPL and Q (Louvain, seed 1; also its range over seeds 1–100).
   Exposes window.FLUENCY. */
(function () {
  'use strict';
  const num = v => (v === '' || v === null || v === undefined) ? NaN : Number(v);
  const CATS = [['an', 'animals', 'Animals'], ['fv', 'fruitveg', 'Fruits & vegetables']];
  const ITEMS = ['joy1', 'joy2', 'joy3', 'joy4', 'joy5', 'depriv1', 'depriv2', 'depriv3', 'depriv4', 'depriv5'];
  const MINUS = '−';

  /* ---------- SUBTLEX-CH, loaded once when the tab is first drawn ---------- */
  let lex = null, lexP = null;
  const cat = {};
  const get = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
  function loadLex() {
    if (!lexP) lexP = Promise.all([get('assets/data/subtlex-ch-wf.txt?v=1'), get('assets/data/category-animals.txt?v=1'), get('assets/data/category-fruitveg.txt?v=1')]).then(([t, a, f]) => {
      const m = new Map();
      t.split('\n').forEach(l => { if (!l || l[0] === '#') return; const i = l.indexOf('\t'); if (i > 0) m.set(l.slice(0, i), Number(l.slice(i + 1))); });
      const list = x => new Set(x.split('\n').map(l => l.trim()).filter(l => l && l[0] !== '#'));
      cat.an = list(a); cat.fv = list(f);
      lex = m; return m;
    });
    return lexP;
  }
  const norm = w => String(w).normalize('NFKC').replace(/\s+/g, '').toLowerCase();

  /* One stored row → {pid, row, include, je, ds, ..., cats: {an: {pos, words, times}, fv: …}} */
  function parse(r) {
    const s = { pid: r.pid, row: r, include: String(r.include) === '1', first: r.first, cats: {} };
    ['je', 'ds', 'je5', 'ds5'].concat(ITEMS).forEach(k => { s[k] = num(r[k]); });
    CATS.forEach(([c]) => {
      const join = p => [1, 2, 3, 4].map(i => String(r[`${c}_${p}${i}`] ?? '')).filter(Boolean).join('|');
      const words = join('w') ? join('w').split('|') : [], times = join('t') ? join('t').split('|').map(Number) : [];
      s.cats[c] = { pos: num(r[c + '_pos']), words, times, hiddenMs: num(r[c + '_hidden_ms']) || 0, pastes: num(r[c + '_pastes']) || 0 };
    });
    return s;
  }

  // Per category: entries, different entries, those in SUBTLEX-CH, mean log10 SUBTLEX count of the latter.
  function score(s) {
    CATS.forEach(([c]) => {
      const C = s.cats[c], seen = new Set(), uniq = [];
      C.words.forEach(w => { const k = norm(w); if (k && !seen.has(k)) { seen.add(k); uniq.push(k); } });
      C.uniq = uniq; C.entries = C.words.length; C.repeats = C.words.length - uniq.length;
      C.inLex = lex ? uniq.filter(w => lex.has(w)) : null;
      C.valid = lex ? C.inLex.filter(w => cat[c].has(w)) : null;           // in SUBTLEX-CH and on the block's category list
      C.nAll = uniq.length; C.nLex = C.inLex ? C.inLex.length : NaN; C.nValid = C.valid ? C.valid.length : NaN;
      C.logw = C.valid && C.valid.length ? LAB.mean(C.valid.map(w => Math.log10(lex.get(w)))) : NaN;
    });
  }

  const PROFILES = [['hiD-hiJ', 'High D · high J'], ['hiD-loJ', 'High D · low J'], ['loD-hiJ', 'Low D · high J'], ['loD-loJ', 'Low D · low J']];
  const cp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);          // code-point order, as R's sort(method = "radix")

  // Correlation by least squares (its t-test), CI by Fisher z.
  function corr(P, fx, fy) {
    const xs = P.map(fx), ys = P.map(fy), f = LAB.ols(xs, ys), pts = xs.map((x, i) => ({ x, y: ys[i] }));
    if (!f || !isFinite(f.r)) return { n: P.length, r: NaN, p: NaN, t: NaN, df: NaN, ci: [NaN, NaN], fit: f, pts };
    const z = Math.atanh(Math.max(-0.9999, Math.min(0.9999, f.r))), se = 1 / Math.sqrt(P.length - 3);
    return { n: P.length, r: f.r, p: f.p, t: f.t, df: f.df, diff: f.r, ci: P.length > 3 ? [Math.tanh(z - 1.96 * se), Math.tanh(z + 1.96 * se)] : [NaN, NaN], fit: f, pts };
  }
  /* y = b0 + b1·x1 + b2·x2 by least squares: each slope adjusted for the other,
     with its t-test and 95% CI; R² and the overall F test (F(2, df) has the
     closed-form tail (1 + 2F/df)^(−df/2)). */
  function reg2(y, x1, x2) {
    const n = y.length, df = n - 3;
    if (df < 1) return null;
    const X = y.map((_, i) => [1, x1[i], x2[i]]), XtX = [0, 1, 2].map(a => [0, 1, 2].map(b => X.reduce((s, r) => s + r[a] * r[b], 0))), Xty = [0, 1, 2].map(a => X.reduce((s, r, i) => s + r[a] * y[i], 0));
    const [[a, b, c], [d, e, f], [g, h, k]] = XtX, det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
    if (!(Math.abs(det) > 1e-9)) return null;
    const inv = [[e * k - f * h, c * h - b * k, b * f - c * e], [f * g - d * k, a * k - c * g, c * d - a * f], [d * h - e * g, b * g - a * h, a * e - b * d]].map(r => r.map(v => v / det));
    const B = inv.map(r => r[0] * Xty[0] + r[1] * Xty[1] + r[2] * Xty[2]);
    const my = LAB.mean(y), sse = y.reduce((s, v, i) => s + (v - (B[0] + B[1] * x1[i] + B[2] * x2[i])) ** 2, 0), sst = y.reduce((s, v) => s + (v - my) ** 2, 0);
    const s2 = sse / df, tc = LAB.t975(df);
    const coef = [1, 2].map(j => { const se = Math.sqrt(s2 * inv[j][j]), t = se > 0 ? B[j] / se : NaN; return { b: B[j], se, t, df, p: LAB.pT(t, df), diff: B[j], ci: [B[j] - tc * se, B[j] + tc * se] }; });
    const r2 = sst > 0 ? 1 - sse / sst : NaN, F = sse > 0 ? ((sst - sse) / 2) / s2 : NaN;
    return { n, df, J: coef[0], D: coef[1], r2, F, pF: isFinite(F) ? Math.pow(1 + 2 * F / df, -df / 2) : NaN };
  }

  /* rows: first run per student (chosen by the dashboard). mode 'valid' (SUBTLEX-CH + category list) | 'lex' (SUBTLEX-CH) | 'all';
     scale 'full' (5 items) | 'short' (4 items). */
  function analyse(rows, mode, scale) {
    const all = rows.map(parse);
    const S = all.filter(s => s.include);
    S.forEach(score);
    const short = scale === 'short', useLex = mode !== 'all' && !!lex;
    mode = !useLex ? 'all' : mode === 'lex' ? 'lex' : 'valid';
    S.forEach(s => { s.J = short ? s.je : s.je5; s.D = short ? s.ds : s.ds5; s.C = s.J + s.D; });
    // the words that count: different entries, only those in SUBTLEX-CH unless every entry counts
    S.forEach(s => CATS.forEach(([c]) => { const C = s.cats[c]; C.set = mode === 'valid' ? C.valid : mode === 'lex' ? C.inLex : C.uniq; }));
    // how many students gave each word; a student's unique responses are those nobody else gave
    const given = {};
    CATS.forEach(([c]) => { const m = new Map(); S.forEach(s => s.cats[c].set.forEach(w => m.set(w, (m.get(w) || 0) + 1))); given[c] = m; });
    S.forEach(s => {
      s.n = {}; s.u = {};
      CATS.forEach(([c]) => { const C = s.cats[c]; C.only = C.set.filter(w => given[c].get(w) === 1); s.n[c] = C.set.length; s.u[c] = C.only.length; });
      s.n.both = (s.n.an + s.n.fv) / 2; s.u.both = (s.u.an + s.u.fv) / 2;
    });
    // curiosity profiles: above the median = high (as the Rmd)
    const scored = S.filter(s => isFinite(s.J) && isFinite(s.D));
    const medJ = LAB.median(scored.map(s => s.J)), medD = LAB.median(scored.map(s => s.D));
    scored.forEach(s => { s.hiJ = s.J > medJ; s.hiD = s.D > medD; s.profile = `${s.hiD ? 'hiD' : 'loD'}-${s.hiJ ? 'hiJ' : 'loJ'}`; });
    // individual analyses: total and unique responses against J, D, J + D, and J and D together
    const R = { total: {}, unique: {} };
    [['total', 'n'], ['unique', 'u']].forEach(([m, f]) => ['an', 'fv', 'both'].forEach(k => {
      const P = scored.filter(s => isFinite(s[f][k]));
      R[m][k] = { J: corr(P, s => s.J, s => s[f][k]), D: corr(P, s => s.D, s => s[f][k]), C: corr(P, s => s.C, s => s[f][k]),
        model: reg2(P.map(s => s[f][k]), P.map(s => s.J), P.map(s => s.D)) };
    }));
    // groups: the whole class and the four profiles
    const groups = [{ key: 'class', name: 'Whole class', S: scored }].concat(PROFILES.map(([p, name]) => ({ key: p, name, S: scored.filter(s => s.profile === p) })));
    groups.forEach(g => { g.cat = {}; CATS.forEach(([c]) => {
      const types = new Set(); g.S.forEach(s => s.cats[c].set.forEach(w => types.add(w)));
      g.cat[c] = { total: g.S.map(s => s.n[c]), unique: g.S.map(s => s.u[c]), types: types.size };
    }); });
    // order: each category's total when it came first vs second
    const order = {};
    CATS.forEach(([c]) => { order[c] = LAB.welch(S.filter(s => s.cats[c].pos === 2).map(s => s.n[c]), S.filter(s => s.cats[c].pos === 1).map(s => s.n[c])); });
    // the class's answers: how many students gave each, and those not in SUBTLEX-CH
    const answers = {};
    CATS.forEach(([c]) => {
      const m = new Map();
      S.forEach(s => s.cats[c].uniq.forEach(w => m.set(w, (m.get(w) || 0) + 1)));
      answers[c] = [...m.entries()].map(([w, n]) => ({ w, n, inLex: lex ? lex.has(w) : null, inCat: lex ? cat[c].has(w) : null, other: lex ? cat[c === 'an' ? 'fv' : 'an'].has(w) : null,
        counts: mode === 'all' || (lex && lex.has(w) && (mode === 'lex' || cat[c].has(w))) })).sort((a, b) => b.n - a.n || a.w.localeCompare(b.w, 'zh'));
    });
    const lo = short ? 4 : 5, hi = short ? 28 : 35;
    return { all, S, n: S.length, excluded: all.length - S.length, scored, medJ, medD, R, groups, order, answers, useLex, lexReady: !!lex,
      scale: short ? 'short' : 'full', lo, hi, step: short ? 4 : 5, range: `${lo}–${hi}`, mode };
  }

  /* ---------- semantic networks ---------- */
  const SN = window.SEMNET, netCache = new Map();
  // students × the words they gave (code-point order, so R's columns can match)
  function matrix(Sg, c, words) {
    words = words || [...new Set(Sg.flatMap(s => s.cats[c].set))].sort(cp);
    return { rows: Sg.map(s => s.pid), cols: words, X: Sg.map(s => { const h = new Set(s.cats[c].set); return words.map(w => (h.has(w) ? 1 : 0)); }) };
  }
  function qRange(A) { let lo = Infinity, hi = -Infinity; for (let sd = 1; sd <= 100; sd++) { const q = SN.louvain(A, sd).modularity; if (q < lo) lo = q; if (q > hi) hi = q; } return [lo, hi]; }
  function build(M, n) {
    const net = SN.network(M, 1);
    net.students = n;
    if (net.A) { net.qRange = qRange(net.A); net.prev = M.cols.map((_, j) => M.X.reduce((s, r) => s + r[j], 0) / Math.max(1, M.X.length)); }
    return net;
  }
  /* For one category: the class network (its own words) and the four profile
     networks (equated words), with layouts: the class's own; one shared by the
     four profiles, from the TMFG network of every student's answers on the
     equated words. Cached, since redrawing is frequent. */
  function networks(res, c) {
    const key = [c, res.mode, res.scale, res.scored.map(s => `${s.pid}:${s.profile}:${s.cats[c].set.join(',')}`).join(';')].join('|');
    if (netCache.has(key)) return netCache.get(key);
    const out = { c, classNet: null, profiles: [], shared: [], why: '' };
    const sc = res.scored;
    if (sc.length >= 2) {
      const fin = SN.finalize(matrix(sc, c), 2);
      out.classNet = build(fin, sc.length);
      out.classNet.layout = out.classNet.A ? SN.layout(out.classNet.A, 1) : null;
    } else out.classNetWhy = 'needs at least 2 students';
    const G = res.groups.slice(1);
    if (G.some(g => g.S.length < 2)) out.why = `every profile needs at least 2 students (now ${G.map(g => g.S.length).join(', ')})`;
    else {
      const fins = G.map(g => SN.finalize(matrix(g.S, c), 2));
      out.finalized = fins.map(f => f.cols.length);
      const eq = SN.equate(fins);
      out.shared = eq[0].cols;
      if (out.shared.length < 4) out.why = `the four profiles share ${out.shared.length} word${out.shared.length === 1 ? '' : 's'} given by at least 2 students each; a network needs at least 4`;
      else {
        out.profiles = eq.map((M, i) => Object.assign(build(M, G[i].S.length), { key: G[i].key, name: G[i].name }));
        const ref = SN.network(matrix(sc, c, out.shared), 1);
        out.layout = SN.layout(ref.A, 1);
      }
    }
    netCache.set(key, out);
    if (netCache.size > 24) netCache.delete(netCache.keys().next().value);
    return out;
  }

  /* ---------- charts ---------- */
  const widthOf = (host, max) => Math.max(300, Math.min(max, Math.round(host.getBoundingClientRect().width) || max));
  const title = (el, s) => { LAB.svg('title', {}, el).textContent = s; return el; };

  /* The two subscales against each other (as the Rmd's plot): deprivation
     sensitivity across, joyous exploration up, the class medians as lines and
     the four profiles' counts in the corners. Students with the same two
     scores share one dot, sized by their number. */
  function profileMap(host, res) {
    const W = widthOf(host, 620), narrow = W < 460, H = Math.round(Math.min(W, 520) * 0.86), left = narrow ? 40 : 54, right = 14, top = 14, bottom = 50;
    host.textContent = '';
    const s = LAB.svg('svg', { class: 'chart fc', viewBox: `0 0 ${W} ${H}`, style: `max-width:${W}px`, role: 'img',
      'aria-label': `Joyous exploration against deprivation sensitivity for ${res.scored.length} students, with the class medians (${res.medD} and ${res.medJ})` }, host);
    const lo = res.lo, hi = res.hi, X = v => left + (v - lo) / (hi - lo) * (W - left - right), Y = v => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom);
    for (let v = lo; v <= hi; v += res.step) {
      LAB.svg('line', { class: 'grid', x1: X(v), x2: X(v), y1: Y(hi), y2: Y(lo) }, s);
      LAB.svg('line', { class: 'grid', x1: X(lo), x2: X(hi), y1: Y(v), y2: Y(v) }, s);
      LAB.text(s, X(v), H - bottom + 20, String(v), { 'text-anchor': 'middle' });
      LAB.text(s, left - 8, Y(v) + 5, String(v), { 'text-anchor': 'end' });
    }
    LAB.text(s, (left + W - right) / 2, H - 6, `Deprivation sensitivity (${res.range})`, { 'text-anchor': 'middle', class: 'axis-title' });
    if (!narrow) LAB.text(s, 14, (top + H - bottom) / 2, `Joyous exploration (${res.range})`, { 'text-anchor': 'middle', class: 'axis-title', transform: `rotate(-90 14 ${(top + H - bottom) / 2})` });
    if (isFinite(res.medD)) {
      LAB.svg('line', { class: 'zero-ref', x1: X(res.medD), x2: X(res.medD), y1: Y(hi), y2: Y(lo) }, s);
      LAB.svg('line', { class: 'zero-ref', x1: X(lo), x2: X(hi), y1: Y(res.medJ), y2: Y(res.medJ) }, s);
      const cnt = p => res.scored.filter(x => x.profile === p).length;
      [['hiD-hiJ', 'High D · high J', 'end', 0], ['loD-hiJ', 'Low D · high J', 'start', 0], ['hiD-loJ', 'High D · low J', 'end', 1], ['loD-loJ', 'Low D · low J', 'start', 1]].forEach(([p, lab, anchor, low]) => {
        const x = anchor === 'end' ? X(hi) - 6 : X(lo) + 6, y = low ? Y(lo) - 8 : Y(hi) + 17;
        LAB.text(s, x, y, `${lab}: ${cnt(p)}`, { 'text-anchor': anchor, class: 'label-strong halo' });
      });
    }
    const groups = new Map();
    res.scored.forEach(p => { const k = p.D + ',' + p.J; groups.set(k, (groups.get(k) || 0) + 1); });
    groups.forEach((n, k) => {
      const [d, j] = k.split(',').map(Number);
      const c = LAB.svg('circle', { cx: X(d), cy: Y(j), r: 3.5 + 2.2 * Math.sqrt(n - 1), class: 'series-a', 'fill-opacity': 0.75 }, s);
      title(c, `${n} student${n > 1 ? 's' : ''}: deprivation sensitivity ${d}, joyous exploration ${j}`);
    });
    return s;
  }

  // The most frequent answers as bars (share of students), with entries not in SUBTLEX-CH marked.
  function topAnswers(host, list, n, k) {
    const top = list.slice(0, k);
    host.innerHTML = !top.length ? '<p class="empty">No answers yet.</p>' :
      `<ol class="fl-top">${top.map(a => `<li${a.counts ? '' : ' class="nolex"'}><span class="w" lang="zh-Hans">${a.w}</span>` +
        `<span class="bar"><i style="width:${(a.n / n * 100).toFixed(1)}%"></i></span><span class="v">${Math.round(a.n / n * 100)}%</span></li>`).join('')}</ol>`;
  }

  /* One network. pos: [[x, y]] in −1..1 for each node (shared by panels
     that share words). Edge width and darkness follow the cosine weight on a
     scale shared by the panels drawn together (o.wRange); node size follows
     the share of the group's students who gave the word (0–100%, one scale
     for every panel). Labels: each tries spots around its node and keeps the
     one that overlaps least. */
  let ctx2;
  const textW = (t, px) => { ctx2 = ctx2 || document.createElement('canvas').getContext('2d'); ctx2.font = `600 ${px}px 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif`; return ctx2.measureText(t).width; };
  function netPanel(host, net, pos, o) {
    const W = widthOf(host, o.max || 640), fs = W < 420 ? 11 : 12.5, padX = 16 + fs * 2.6, padY = 14 + fs;
    // o.upright: a layout wider than tall is turned a quarter (a layout's orientation means nothing), for narrow screens
    if (o.upright) { const ex = v => Math.max(...pos.map(p => p[v])) - Math.min(...pos.map(p => p[v])); if (ex(0) > ex(1) * 1.1) pos = pos.map(p => [p[1], -p[0]]); }
    // one scale for both axes, fitted to the layout's extent; the height follows (at most o.ratio × width)
    const xs = pos.map(p => p[0]), ys = pos.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    let k = (W - 2 * padX) / Math.max(1e-9, x1 - x0);
    const maxH = W * (o.ratio || 0.8);
    if ((y1 - y0) * k + 2 * padY > maxH) k = (maxH - 2 * padY) / Math.max(1e-9, y1 - y0);
    const H = Math.round((y1 - y0) * k + 2 * padY), offX = (W - (x1 - x0) * k) / 2;
    host.textContent = '';
    const s = LAB.svg('svg', { class: 'chart fl-net', viewBox: `0 0 ${W} ${H}`, style: `max-width:${W}px`, role: 'img', 'aria-label': o.label }, host);
    const X = v => offX + (v - x0) * k, Y = v => padY + (y1 - v) * k;
    const n = net.A.length, words = net.M.cols, [w0, w1] = o.wRange;
    const scaleW = w => (w1 > w0 ? (w - w0) / (w1 - w0) : 0.5);
    const E = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (net.A[i][j] !== 0) E.push([i, j, net.A[i][j]]);
    E.sort((a, b) => a[2] - b[2]);                        // strongest drawn last, on top
    const ge = LAB.svg('g', { class: 'edges' }, s);
    E.forEach(([i, j, w]) => { const t = scaleW(w);
      const l = LAB.svg('line', { x1: X(pos[i][0]), y1: Y(pos[i][1]), x2: X(pos[j][0]), y2: Y(pos[j][1]), 'stroke-width': (0.6 + 2.6 * t).toFixed(2), 'stroke-opacity': (0.22 + 0.6 * t).toFixed(2) }, ge);
      title(l, `${words[i]} – ${words[j]}: cosine ${w.toFixed(2)}`); });
    const rs = Math.max(0.6, Math.min(1, W / 620));
    const items = words.map((w, i) => ({ i, w, x: X(pos[i][0]), y: Y(pos[i][1]), r: (2.5 + 7 * Math.sqrt(net.prev[i])) * rs, deg: net.degree[i], tw: textW(w, fs), h: fs + 2 }));
    // o.labelTop: on a small screen only the most connected words get a label (every word keeps its hover/tap title)
    const labelled = new Set(items.slice().sort((a, b) => b.deg - a.deg || a.i - b.i).slice(0, o.labelTop || Infinity).map(it => it.i));
    // labels: most connected first
    const placed = [], box = { x0: 2, y0: 2, x1: W - 2, y1: H - 2 };
    const ov = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    items.slice().sort((a, b) => b.deg - a.deg || a.i - b.i).filter(it => labelled.has(it.i)).forEach(it => {
      let best = null, bc = Infinity;
      [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1]].forEach(([dx, dy], k) => [2, 7].forEach(g => {
        const x = dx > 0 ? it.x + it.r + g : dx < 0 ? it.x - it.r - g - it.tw : it.x - it.tw / 2;
        const y = dy < 0 ? it.y - it.r - g - it.h : dy > 0 ? it.y + it.r + g : it.y - it.h / 2;
        const r = { x, y, w: it.tw, h: it.h };
        let c = k * 0.6 + g * 0.4;
        placed.forEach(p => { c += ov(r, p) * 6; });
        items.forEach(q => { const nx = Math.max(r.x, Math.min(q.x, r.x + r.w)), ny = Math.max(r.y, Math.min(q.y, r.y + r.h)); if (Math.hypot(q.x - nx, q.y - ny) < q.r + 1) c += q === it ? 400 : 120; });
        c += (Math.max(0, box.x0 - r.x) + Math.max(0, r.x + r.w - box.x1) + Math.max(0, box.y0 - r.y) + Math.max(0, r.y + r.h - box.y1)) * 80;
        if (c < bc) { bc = c; best = r; }
      }));
      it.lab = best; placed.push(best);
    });
    const gn = LAB.svg('g', {}, s);
    items.forEach(it => {
      const g = LAB.svg('g', {}, gn);
      title(g, `${it.w}: ${Math.round(net.prev[it.i] * 100)}% of the group's students; ${it.deg} links`);
      LAB.svg('circle', { cx: it.x, cy: it.y, r: it.r.toFixed(2), class: 'fl-node' }, g);
      if (it.lab) LAB.text(g, it.lab.x, it.lab.y + it.h - 3, it.w, { class: 'fl-lab halo', style: `font-size:${fs}px` });
    });
    return s;
  }

  // CC, ASPL and Q for the four profiles: one small dot plot per measure (descriptive; no intervals).
  function metricPlot(host, nets) {
    host.textContent = '';
    const W = widthOf(host, 1000), narrow = W < 640, cols = narrow ? 1 : 3, pw = W / cols, ph = 168;
    const H = Math.ceil(3 / cols) * ph;
    const s = LAB.svg('svg', { class: 'chart fc', viewBox: `0 0 ${W} ${H}`, style: `max-width:${W}px`, role: 'img',
      'aria-label': 'CC, ASPL and Q of the four profile networks: ' + nets.map(n => `${n.name}: CC ${n.cc.toFixed(3)}, ASPL ${n.aspl.toFixed(3)}, Q ${n.q.toFixed(3)}`).join('; ') }, host);
    const short = { 'hiD-hiJ': 'HD·HJ', 'hiD-loJ': 'HD·LJ', 'loD-hiJ': 'LD·HJ', 'loD-loJ': 'LD·LJ' };
    [['cc', 'CC (clustering)'], ['aspl', 'ASPL (path length)'], ['q', 'Q (modularity)']].forEach(([k, name], m) => {
      const ox = (m % cols) * pw, oy = Math.floor(m / cols) * ph, left = ox + 52, right = ox + pw - 16, top = oy + 28, bottom = oy + ph - 30;
      const v = nets.map(n => n[k]), lo0 = Math.min(...v), hi0 = Math.max(...v), padv = Math.max((hi0 - lo0) * 0.25, Math.abs(hi0) * 0.02, 0.005);
      const lo = lo0 - padv, hi = hi0 + padv, Y = x => bottom - (x - lo) / (hi - lo) * (bottom - top), X = i => left + (i + 0.5) * (right - left) / nets.length;
      LAB.text(s, ox + 8, oy + 16, name, { class: 'label-strong' });
      LAB.svg('line', { class: 'axis-light', x1: left, x2: right, y1: bottom + 4, y2: bottom + 4 }, s);
      nets.forEach((n, i) => {
        const g = LAB.svg('g', {}, s); title(g, `${n.name}: ${name} ${n[k].toFixed(4)}`);
        LAB.svg('circle', { cx: X(i), cy: Y(n[k]), r: 5.5, class: 'series-a' }, g);
        LAB.text(g, X(i) + 9, Y(n[k]) + 4, n[k].toFixed(3).replace(/^0/, ''), { class: 'value-label' });
        LAB.text(s, X(i), bottom + 18, short[n.key], { 'text-anchor': 'middle' });
      });
    });
    return s;
  }

  /* ---------- downloads ---------- */
  function answerRows(res) {
    return res.all.flatMap(s => CATS.flatMap(([c, cat]) => {
      const C = s.cats[c], seen = new Set();
      return C.words.map((w, i) => { const k = norm(w), rep = seen.has(k) ? 1 : 0; seen.add(k);
        return { pid: s.pid, include: s.include ? 1 : 0, category: cat, block: C.pos, position: i + 1, response: w, t_s: C.times[i],
          repeat: rep, in_subtlex: lex ? (lex.has(k) ? 1 : 0) : 'NA', subtlex_count: lex && lex.has(k) ? lex.get(k) : 'NA', in_category_list: lex ? (cat[c].has(k) ? 1 : 0) : 'NA',
          counts: C.set ? (C.set.includes(k) ? 1 : 0) : 'NA', unique_in_class: C.only ? (C.only.includes(k) && !rep ? 1 : 0) : 'NA',
          je5: s.je5, ds5: s.ds5, je: s.je, ds: s.ds, profile: s.profile || 'NA', profile_from: res.scale === 'short' ? '4 items' : '5 items' }; });
    }));
  }
  function studentRows(res) {
    return res.all.map(s => {
      const o = { pid: s.pid, include: s.include ? 1 : 0, l1_chinese: s.row.l1_chinese, first: s.first };
      CATS.forEach(([c]) => {
        const C = s.cats[c];
        Object.assign(o, { [c + '_block']: C.pos, [c + '_entries']: C.words.length, [c + '_different']: C.nAll ?? 'NA', [c + '_in_subtlex']: isFinite(C.nLex) ? C.nLex : 'NA', [c + '_valid']: isFinite(C.nValid) ? C.nValid : 'NA',
          [c + '_total']: s.n ? s.n[c] : 'NA', [c + '_unique']: s.u ? s.u[c] : 'NA',
          [c + '_repeats']: C.repeats ?? 'NA', [c + '_mean_log10_count']: isFinite(C.logw) ? LAB.round(C.logw, 3) : 'NA', [c + '_hidden_ms']: C.hiddenMs, [c + '_pastes']: C.pastes });
      });
      Object.assign(o, { je5: s.je5, ds5: s.ds5, je: s.je, ds: s.ds, profile: s.profile || 'NA', profile_from: res.scale === 'short' ? '4 items' : '5 items', counted_as: COUNTED[res.mode] });
      ITEMS.forEach(k => { o[k] = s[k]; });
      return o;
    });
  }
  // Binary student × answer matrix for SemNeT (rows: students; 1 = gave that answer), as textcleaner's output.
  function matrixRows(res, c) {
    const words = [...new Set(res.S.flatMap(s => s.cats[c].set))].sort(cp);
    return res.S.map(s => {
      const have = new Set(s.cats[c].set);
      const o = { pid: s.pid, je5: s.je5, ds5: s.ds5, je: s.je, ds: s.ds, profile: s.profile || 'NA', profile_from: res.scale === 'short' ? '4 items' : '5 items' };
      words.forEach(w => { o[w] = have.has(w) ? 1 : 0; });
      return o;
    });
  }

  // Every network of both categories: one row per network (measures), node, or edge.
  function netTables(res) {
    const meas = [], nodes = [], edges = [];
    CATS.forEach(([c, cat]) => {
      const N = networks(res, c);
      const list = [['class', 'Whole class', N.classNet, 'not equated']].concat(N.profiles.map(p => [p.key, p.name, p, `equated across the four profiles (${N.shared.length} words)`]));
      list.forEach(([key, name, net, words]) => {
        if (!net || !net.A) return;
        meas.push({ category: cat, network: key, group: name, students: net.students, nodes: net.nodes, edges: net.edges, cc: LAB.round(net.cc, 4), aspl: LAB.round(net.aspl, 4), q_seed1: LAB.round(net.q, 4),
          q_min_seeds_1_100: LAB.round(net.qRange[0], 4), q_max_seeds_1_100: LAB.round(net.qRange[1], 4), communities_seed1: net.communities, words, counted_as: COUNTED[res.mode], profile_from: res.scale === 'short' ? '4 items' : '5 items' });
        net.M.cols.forEach((w, i) => nodes.push({ category: cat, network: key, node: w, students_giving: Math.round(net.prev[i] * net.students), share: LAB.round(net.prev[i], 4), degree: net.degree[i], community_seed1: net.membership[i] }));
        for (let i = 0; i < net.A.length; i++) for (let j = i + 1; j < net.A.length; j++) if (net.A[i][j] !== 0) edges.push({ category: cat, network: key, from: net.M.cols[i], to: net.M.cols[j], cosine: LAB.round(net.A[i][j], 6) });
      });
    });
    return { meas, nodes, edges };
  }

  const COUNTED = { valid: 'in SUBTLEX-CH and on the category list', lex: 'in SUBTLEX-CH', all: 'every different entry' };
  const fmtR = v => isFinite(v) ? (v <= -0.005 ? MINUS : '') + Math.abs(v).toFixed(2).replace(/^0/, '') : '–';
  window.FLUENCY = { CATS, PROFILES, loadLex, analyse, networks, netPanel, metricPlot, profileMap, topAnswers, answerRows, studentRows, matrixRows, netTables, fmtR, lexReady: () => !!lex };
})();
