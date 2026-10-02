/* LT5461 — association task (FAST): the charts on the results page.
   Plain SVG, drawn from numbers the dashboard passes in. Chinese is always
   blue and English always orange (results.html: --lang-zh, --lang-en), and
   every line is also labelled by name, so colour is never the only cue.
   Every mark carries a <title> for hover, and every chart has a table twin on
   the page. Each chart is laid out at the width its box has, so its text
   stays at full size on a phone; the dashboard redraws them when the window
   resizes. Exposes window.FAST_CHARTS. */
(function () {
  'use strict';
  const C = {};
  const svg = LAB.svg, text = LAB.text;
  const NAME = { zh: 'Chinese', en: 'English' };
  const p2 = v => isFinite(v) ? (v < 0 ? '−' : '') + Math.abs(v).toFixed(2).replace(/^0/, '') : '–';
  const title = (el, s) => { const t = svg('title', {}, el); t.textContent = s; return el; };
  // The width to lay out at: the host's own, kept within [min, max].
  const widthOf = (host, def, min, max) => Math.max(min, Math.min(max, Math.round(host.getBoundingClientRect().width) || def));
  // max-width: a chart narrower than its box is not scaled up (and its text with it).
  const root = (host, W, H, label) => { host.textContent = ''; return svg('svg', { class: 'chart fc', viewBox: `0 0 ${W} ${H}`, style: `max-width:${W}px`, role: 'img', 'aria-label': label }, host); };

  /* Language names at the right end of two lines. ends: [{lang, x, y}];
     labels closer than gap are pushed apart about their midpoint and kept
     within [lo, hi]. */
  function endLabels(s, ends, gap, lo, hi) {
    const L = ends.filter(e => isFinite(e.y)).sort((a, b) => a.y - b.y).map(e => Object.assign({ ly: e.y }, e));
    if (L.length === 2 && L[1].ly - L[0].ly < gap) {
      const mid = (L[0].ly + L[1].ly) / 2;
      L[0].ly = mid - gap / 2; L[1].ly = mid + gap / 2;
    }
    if (L.length === 2) {
      if (L[0].ly < lo) { L[1].ly += lo - L[0].ly; L[0].ly = lo; }
      if (L[1].ly > hi) { L[0].ly -= L[1].ly - hi; L[1].ly = hi; }
    }
    // a short dash in the line's colour, then the name in ink
    L.forEach(e => {
      svg('line', { x1: e.x, x2: e.x + 10, y1: e.ly, y2: e.ly, class: 'label-dash s-' + e.lang }, s);
      text(s, e.x + 14, e.ly + 5, NAME[e.lang], { class: 'series-label halo' });
    });
  }

  /* ---------- 1. a two-state transition diagram for one language ----------
     Arrow width grows with the probability; self-loops are "staying". Laid
     out from the left edge, so the diagram lines up with its heading. */
  C.stateDiagram = function (host, m, lang) {
    const R = 40, sep = 200, cy = 118, N = { x: R + 3, y: cy }, P = { x: R + 3 + sep, y: cy };
    const W = P.x + R + 3, H = 192;
    const STATE = { N: 'negative', P: 'positive' };
    const pr = (a, b) => m.probs[a][b], ct = (a, b) => `${m.counts[a][b].toLocaleString('en-US')} of ${m.rowN[a].toLocaleString('en-US')}`;
    const s = root(host, W, H, `${NAME[lang]} transitions: a negative answer stays negative ${p2(pr('N', 'N'))} and turns positive ${p2(pr('N', 'P'))}; ` +
      `a positive answer stays positive ${p2(pr('P', 'P'))} and turns negative ${p2(pr('P', 'N'))}.`);
    const defs = svg('defs', {}, s);
    const width = p => 1.5 + 9 * p;
    let k = 0;
    const arrow = (d, p, from, to, labelAt) => {
      if (!isFinite(p)) return;
      const w = width(p), id = `ah-${lang}-${k++}`, size = 7 + w;
      const mk = svg('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: size, markerHeight: size, markerUnits: 'userSpaceOnUse', orient: 'auto' }, defs);
      svg('path', { d: 'M0 0L10 5L0 10z', class: 'f-' + lang }, mk);
      const g = svg('g', { class: 'arrow' }, s);
      title(g, `${STATE[from]} → ${STATE[to]}: ${p2(p)} (${ct(from, to)} transitions)`);
      svg('path', { d, fill: 'none', class: 's-' + lang, 'stroke-width': w, 'stroke-linecap': 'round', 'marker-end': `url(#${id})` }, g);
      svg('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 22 }, g);   // a hit area wider than the mark
      const at = labelAt(w);
      text(g, at[0], at[1], p2(p), { 'text-anchor': 'middle', class: 'arrow-value' });
    };
    // staying: loops above each node, the value inside the loop
    const loop = c => `M${c.x - 15} ${c.y - R + 1} C${c.x - 76} ${c.y - R - 86} ${c.x + 76} ${c.y - R - 86} ${c.x + 15} ${c.y - R + 1}`;
    arrow(loop(N), pr('N', 'N'), 'N', 'N', () => [N.x, cy - R - 22]);
    arrow(loop(P), pr('P', 'P'), 'P', 'P', () => [P.x, cy - R - 22]);
    // switching: arcs between the nodes, each value clear of its arc's stroke
    const a = 0.55, dx = R * Math.cos(a), dy = R * Math.sin(a), mid = (N.x + P.x) / 2, bow = 62, apex = (dy + bow) / 2;
    arrow(`M${N.x + dx} ${cy - dy} Q${mid} ${cy - bow} ${P.x - dx} ${cy - dy}`, pr('N', 'P'), 'N', 'P', w => [mid, cy - apex - w / 2 - 6]);
    arrow(`M${P.x - dx} ${cy + dy} Q${mid} ${cy + bow} ${N.x + dx} ${cy + dy}`, pr('P', 'N'), 'P', 'N', w => [mid, cy + apex + w / 2 + 17]);
    [[N, 'Negative'], [P, 'Positive']].forEach(([c, label]) => {
      svg('circle', { cx: c.x, cy: c.y, r: R, class: 'state-node s-' + lang }, s);
      text(s, c.x, c.y + 5, label, { 'text-anchor': 'middle', class: 'label-strong' });
    });
    return s;
  };

  /* ---------- 2. a dumbbell: Chinese vs English per row, with 95% CIs ----------
     Each language has its own rail: Chinese above the dots with its value
     above, English below with its value below. The first row names them.
     Wide: row labels in a column on the left. Narrow: each label above its row. */
  C.dumbbell = function (host, rows, o) {
    o = Object.assign({ fmt: p2 }, o);
    const W = widthOf(host, 640, 300, 720), narrow = W < 540;
    const rowH = narrow ? 118 : 92, left = narrow ? 14 : 200, right = narrow ? 24 : 48, top = 6, bottom = 52;
    const H = top + rows.length * rowH + bottom;
    const all = rows.flatMap(r => ['zh', 'en'].flatMap(l => [r[l].lo, r[l].hi, r[l].p])).filter(isFinite);
    const lo = Math.max(0, Math.min(0.5, Math.floor(Math.min(...all) * 10) / 10)), hi = Math.min(1, Math.max(lo + 0.2, Math.ceil(Math.max(...all) * 10) / 10));
    const X = v => left + (v - lo) / (hi - lo) * (W - left - right);
    const s = root(host, W, H, o.label || 'Chinese and English, with 95% confidence intervals');
    for (let v = lo; v <= hi + 1e-9; v += 0.1) {
      svg('line', { class: Math.abs(v - 0.5) < 1e-9 ? 'chance' : 'grid', x1: X(v), x2: X(v), y1: top, y2: H - bottom + 6 }, s);
      text(s, X(v), H - bottom + 24, p2(+v.toFixed(2)), { 'text-anchor': 'middle' });
    }
    rows.forEach((r, i) => {
      const rowTop = top + i * rowH, y = rowTop + (narrow ? 64 : rowH / 2);
      if (narrow) text(s, 0, rowTop + 16, r.label + (r.sub ? ', ' + r.sub : ''), { class: 'label-strong halo' });
      else {
        text(s, 0, y - 3, r.label, { class: 'label-strong' });
        if (r.sub) text(s, 0, y + 16, r.sub, {});
      }
      const zh = r.zh, en = r.en;
      if (isFinite(zh.p) && isFinite(en.p)) svg('line', { x1: X(zh.p), x2: X(en.p), y1: y, y2: y, class: 'dumbbell-bar' }, s);
      [['zh', zh, -1], ['en', en, 1]].forEach(([l, d, side]) => {
        if (!isFinite(d.p)) return;
        const g = svg('g', {}, s);
        title(g, `${NAME[l]}: ${o.fmt(d.p)}` + (isFinite(d.lo) ? ` (95% CI ${o.fmt(d.lo)} to ${o.fmt(d.hi)})` : ''));
        const rail = y + side * 12;
        if (isFinite(d.lo)) {
          svg('line', { x1: X(d.lo), x2: X(d.hi), y1: rail, y2: rail, class: 'ci-line s-' + l }, g);
          [d.lo, d.hi].forEach(v => svg('line', { x1: X(v), x2: X(v), y1: rail - 4, y2: rail + 4, class: 'ci-line s-' + l }, g));
        }
        svg('circle', { cx: X(d.p), cy: y, r: 7, class: 'dot-lang f-' + l }, g);
        svg('circle', { cx: X(d.p), cy: y, r: 13, fill: 'transparent' }, g);
        // the value on its own side of the dots; the first row also names the language
        const t = svg('text', { x: X(d.p), y: side < 0 ? rail - 9 : rail + 21, 'text-anchor': 'middle', class: 'value-label halo' }, s);
        if (i === 0) { const n = svg('tspan', { class: 'value-name' }, t); n.textContent = NAME[l] + ' '; }
        const v = svg('tspan', {}, t); v.textContent = o.fmt(d.p);
      });
    });
    if (o.xLabel) text(s, (left + W - right) / 2, H - 5, o.xLabel, { 'text-anchor': 'middle', class: 'label-strong' });
    return s;
  };

  /* ---------- 3. one small chart per measure: seed category × language ---------- */
  C.seedPanel = function (host, o) {
    const W = widthOf(host, 320, 280, 440), H = 248, left = 46, right = 66, top = 14, bottom = 50;
    const cats = ['negative', 'neutral', 'positive'];
    const [lo, hi] = o.domain;
    const X = i => left + (i + 0.5) / 3 * (W - left - right), Y = v => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom);
    const s = root(host, W, H, o.label);
    const step = o.step || (hi - lo) / 4;
    for (let v = lo; v <= hi + 1e-9; v += step) {
      svg('line', { class: o.ref !== undefined && Math.abs(v - o.ref) < 1e-9 ? 'chance' : 'grid', x1: left, x2: W - right, y1: Y(v), y2: Y(v) }, s);
      text(s, left - 8, Y(v) + 5, o.tick(v), { 'text-anchor': 'end' });
    }
    cats.forEach((c, i) => text(s, X(i), H - bottom + 21, c.charAt(0).toUpperCase() + c.slice(1), { 'text-anchor': 'middle' }));
    text(s, (left + W - right) / 2, H - 5, 'Seed valence', { 'text-anchor': 'middle', class: 'label-strong' });
    // Chinese a little left of each category, English a little right, so CIs never coincide
    const ends = [];
    [['zh', -7], ['en', 7]].forEach(([l, off]) => {
      const v = o.values[l], ci = o.ci && o.ci[l];
      const pts = v.map((y, i) => isFinite(y) ? [X(i) + off, Y(Math.max(lo, Math.min(hi, y)))] : null);
      if (ci) ci.forEach((c, i) => { if (c && isFinite(c[0])) svg('line', { x1: X(i) + off, x2: X(i) + off, y1: Y(Math.min(hi, c[1])), y2: Y(Math.max(lo, c[0])), class: 'ci-line s-' + l }, s); });
      const d = pts.filter(Boolean).map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      if (d) svg('path', { d, class: 'series-line s-' + l }, s);
      pts.forEach((p, i) => {
        if (!p) return;
        const g = svg('g', {}, s);
        title(g, `${NAME[l]}, ${cats[i]} seeds: ${o.fmt(v[i])}` + (ci && ci[i] && isFinite(ci[i][0]) ? ` (95% CI ${o.fmt(ci[i][0])} to ${o.fmt(ci[i][1])})` : ''));
        svg('circle', { cx: p[0], cy: p[1], r: 5, class: 'dot-lang f-' + l }, g);
        svg('circle', { cx: p[0], cy: p[1], r: 12, fill: 'transparent' }, g);
      });
      const last = pts.filter(Boolean).pop();
      if (last) ends.push({ lang: l, x: X(2) + 7 + 12, y: last[1] });
    });
    endLabels(s, ends, 17, top + 6, H - bottom - 4);
    return s;
  };

  /* ---------- 4. trajectories: mean valence by position, a 95% CI band per language ---------- */
  C.trajectory = function (host, S, n, domain, label) {
    const W = widthOf(host, 320, 280, 440), H = 248, left = 30, right = 78, top = 12, bottom = 50;
    const [lo, hi] = domain;
    const X = k => left + (k + 0.5) / n * (W - left - right), Y = v => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom);
    const s = root(host, W, H, label);
    for (let v = lo; v <= hi; v++) {
      svg('line', { class: v === 5 ? 'chance' : 'grid', x1: left, x2: W - right, y1: Y(v), y2: Y(v) }, s);
      text(s, left - 8, Y(v) + 5, String(v), { 'text-anchor': 'end' });
    }
    for (let k = 0; k < n; k++) text(s, X(k), H - bottom + 21, String(k + 1), { 'text-anchor': 'middle' });
    text(s, (left + W - right) / 2, H - 5, 'Answer position', { 'text-anchor': 'middle', class: 'label-strong' });
    const ends = [];
    ['zh', 'en'].forEach(l => {
      const pts = S[l].map((d, k) => ({ k, d })).filter(o => isFinite(o.d.m));
      const band = pts.filter(o => isFinite(o.d.ci[0]));
      if (band.length > 1) {
        const up = band.map(o => `${X(o.k).toFixed(1)} ${Y(Math.min(hi, o.d.ci[1])).toFixed(1)}`);
        const dn = band.slice().reverse().map(o => `${X(o.k).toFixed(1)} ${Y(Math.max(lo, o.d.ci[0])).toFixed(1)}`);
        svg('path', { d: 'M' + up.concat(dn).join('L') + 'Z', class: 'band f-' + l }, s);
      }
      if (pts.length) svg('path', { d: pts.map((o, i) => (i ? 'L' : 'M') + X(o.k).toFixed(1) + ' ' + Y(o.d.m).toFixed(1)).join(' '), class: 'series-line s-' + l }, s);
      pts.forEach(o => {
        const g = svg('g', {}, s);
        title(g, `${NAME[l]}, answer ${o.k + 1}: ${o.d.m.toFixed(2)}` + (isFinite(o.d.ci[0]) ? ` (95% CI ${o.d.ci[0].toFixed(2)} to ${o.d.ci[1].toFixed(2)})` : '') + `, ${o.d.n} students`);
        svg('circle', { cx: X(o.k), cy: Y(o.d.m), r: 4, class: 'dot-lang f-' + l }, g);
        svg('circle', { cx: X(o.k), cy: Y(o.d.m), r: 10, fill: 'transparent' }, g);
      });
      const last = pts[pts.length - 1];
      if (last) ends.push({ lang: l, x: X(last.k) + 10, y: Y(last.d.m) });
    });
    endLabels(s, ends, 17, top + 6, H - bottom - 4);
    return s;
  };

  /* A half swarm: each dot takes the offset nearest its column (0, then d,
     2d, … in direction dir) that keeps it at least d away from every dot
     already placed, so tied values sit side by side instead of on top of
     each other. Offsets are squeezed to fit within room. */
  function swarm(ys, d, dir, room) {
    const placed = [], off = new Array(ys.length).fill(0);
    ys.map((y, i) => [y, i]).filter(p => isFinite(p[0])).sort((a, b) => a[0] - b[0]).forEach(([y, i]) => {
      for (let k = 0; ; k++) {
        const x = dir * k * d;
        if (placed.every(p => (p.x - x) ** 2 + (p.y - y) ** 2 >= d * d - 1e-6)) { off[i] = x; placed.push({ x, y }); break; }
      }
    });
    const most = Math.max(0, ...off.map(Math.abs));
    return most > room ? off.map(x => x * room / most) : off;
  }

  /* ---------- 5. paired dots: each student in both languages, joined ----------
     Chinese swarms to the left of its column, English to the right; the class
     means with 95% CIs sit just outside each swarm. */
  C.paired = function (host, pairs, o) {
    const W = widthOf(host, 560, 300, 600);
    const H = 310, top = 30, bottom = 38, left = 54, right = 16, r = 4.5;
    const vals = pairs.flatMap(p => [p.zh, p.en]).filter(isFinite);
    const hi = o.max || Math.max(o.minMax || 0, Math.ceil((Math.max(0, ...vals) + 1e-9) / o.step) * o.step);
    const Y = v => top + (1 - v / hi) * (H - top - bottom);
    const pw = W - left - right, XZ = left + pw * 0.43, XE = left + pw * 0.57;
    const edgeZ = left + 20, edgeE = W - right - 20;
    const s = root(host, W, H, o.label);
    for (let v = 0; v <= hi + 1e-9; v += o.step) {
      svg('line', { class: 'grid', x1: left, x2: W - right, y1: Y(v), y2: Y(v) }, s);
      text(s, left - 8, Y(v) + 5, o.tick(v), { 'text-anchor': 'end' });
    }
    const both = pairs.map(p => isFinite(p.zh) && isFinite(p.en));
    const off = {
      zh: swarm(pairs.map((p, i) => both[i] ? Y(p.zh) : NaN), 2 * r + 1, -1, XZ - edgeZ - 24),
      en: swarm(pairs.map((p, i) => both[i] ? Y(p.en) : NaN), 2 * r + 1, 1, edgeE - XE - 24)
    };
    // the means sit just outside each swarm (at most at the plot's edge)
    const MZ = Math.max(edgeZ, XZ - Math.max(0, ...off.zh.map(Math.abs)) - 32), ME = Math.min(edgeE, XE + Math.max(0, ...off.en.map(Math.abs)) + 32);
    const X = { zh: i => XZ + off.zh[i], en: i => XE + off.en[i] };
    pairs.forEach((p, i) => { if (both[i]) svg('line', { x1: X.zh(i), x2: X.en(i), y1: Y(p.zh), y2: Y(p.en), class: 'pair-line' }, s); });
    pairs.forEach((p, i) => ['zh', 'en'].forEach(l => {
      if (!both[i]) return;
      const g = svg('g', {}, s);
      title(g, `A student, ${NAME[l]}: ${o.fmt(p[l])}`);
      svg('circle', { cx: X[l](i), cy: Y(p[l]), r, class: 'dot-lang f-' + l }, g);
    }));
    [['zh', MZ, XZ, 'end'], ['en', ME, XE, 'start']].forEach(([l, x, col, anchor]) => {
      text(s, col + (l === 'zh' ? 4 : -4), H - bottom + 24, NAME[l], { 'text-anchor': anchor, class: 'label-strong' });
      const m = o.mean[l];
      if (!isFinite(m.m)) return;
      const g = svg('g', {}, s);
      title(g, `${NAME[l]} mean: ${o.fmt(m.m)} (95% CI ${o.fmt(m.ci[0])} to ${o.fmt(m.ci[1])})`);
      const yTop = Y(Math.min(hi, isFinite(m.ci[1]) ? m.ci[1] : m.m));
      if (isFinite(m.ci[0])) svg('line', { x1: x, x2: x, y1: yTop, y2: Y(Math.max(0, m.ci[0])), class: 'ci-line s-' + l }, g);
      svg('line', { x1: x - 9, x2: x + 9, y1: Y(m.m), y2: Y(m.m), class: 'mean-mark s-' + l }, g);
      text(s, x, yTop - 9, o.fmt(m.m), { 'text-anchor': 'middle', class: 'mean-label halo' });
    });
    return s;
  };

  /* ---------- 6. a forest plot (estimates with 95% CIs) in labelled groups ----------
     groups: [{label, rows: [{label, b, lo, hi, p}]}]. Wide: row labels in a
     column on the left. Narrow: each label above its line. Options: xLabel,
     label, minLim (the smallest half-range, default 0.25), fmt (values). */
  C.forest = function (host, groups, o) {
    const W = widthOf(host, 700, 300, 740), narrow = W < 600;
    const rowH = narrow ? 50 : 34, headH = 30, gap = 18, left = narrow ? 14 : 320, right = 64, top = 4, bottom = 48;
    const rows = groups.flatMap(g => g.rows);
    const H = top + groups.length * headH + (groups.length - 1) * gap + rows.length * rowH + bottom;
    const fmt = o.fmt || (v => (v < 0 ? '−' : '+') + Math.abs(v).toFixed(2));
    const m = Math.max(o.minLim || 0.25, ...rows.flatMap(r => [Math.abs(r.lo), Math.abs(r.hi)]).filter(isFinite));
    const step = [0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5].find(st => Math.ceil(m / st - 1e-9) <= 4) || 5, lim = Math.ceil(m / step - 1e-9) * step;
    const tick = v => Math.abs(v) < 1e-9 ? '0' : (v > 0 ? '+' : '−') + (step < 0.1 ? Math.abs(v).toFixed(step < 0.01 ? 3 : 2).replace(/^0/, '') : String(Math.abs(+v.toFixed(2))));
    const X = v => left + (v + lim) / (2 * lim) * (W - left - right);
    const s = root(host, W, H, o.label);
    const tickEvery = narrow && lim / step >= 4 ? 2 : 1;
    for (let j = 0, v = -lim; v <= lim + 1e-9; j++, v += step) {
      svg('line', { class: Math.abs(v) < 1e-9 ? 'zero' : 'grid', x1: X(v), x2: X(v), y1: top + headH - 6, y2: H - bottom + 6 }, s);
      if (j % tickEvery === 0) text(s, X(v), H - bottom + 24, tick(v), { 'text-anchor': 'middle' });
    }
    text(s, X(0), H - 5, o.xLabel, { 'text-anchor': 'middle', class: 'label-strong' });
    let y0 = top;
    groups.forEach((grp, gi) => {
      if (gi) { svg('line', { class: 'divider', x1: 0, x2: W, y1: y0 + gap / 2, y2: y0 + gap / 2 }, s); y0 += gap; }
      text(s, 0, y0 + 20, grp.label, { class: 'group-label halo' });
      y0 += headH;
      grp.rows.forEach(r => {
        const y = y0 + (narrow ? 34 : rowH / 2);
        const sig = isFinite(r.p) && r.p < 0.05;
        text(s, 0, narrow ? y - 15 : y + 5, r.label, { class: (sig ? 'label-strong' : 'row-label') + (narrow ? ' halo' : '') });
        const g = svg('g', {}, s);
        title(g, `${r.label}: ${fmt(r.b)} (95% CI ${fmt(r.lo)} to ${fmt(r.hi)})` + (isFinite(r.p) ? `, p ${r.p < 0.001 ? '< .001' : '= ' + r.p.toFixed(3).replace(/^0/, '')}` : ''));
        svg('line', { x1: X(Math.max(-lim, r.lo)), x2: X(Math.min(lim, r.hi)), y1: y, y2: y, class: 'forest-ci' + (sig ? ' sig' : '') }, g);
        svg('circle', { cx: X(r.b), cy: y, r: 5.5, class: 'forest-dot' + (sig ? ' sig' : '') }, g);
        svg('rect', { x: X(Math.max(-lim, r.lo)) - 6, y: y - 12, width: Math.max(12, X(Math.min(lim, r.hi)) - X(Math.max(-lim, r.lo)) + 12), height: 24, fill: 'transparent' }, g);
        text(s, W - 2, y + 5, fmt(r.b), { 'text-anchor': 'end', class: sig ? 'value-label strong' : 'value-label' });
        y0 += rowH;
      });
    });
    return s;
  };

  /* ---------- 7. each student's Chinese and English value against their English rating ----------
     o: {points: [{x, zh, en}], fit: {zh, en} (LAB.ols results or null), xDomain: [x0, 10],
     yDomain: [lo, hi], xLabel, label}.
     A student's two dots share one x (ties spread a little, the same way for
     both); each language has its least-squares line with a 95% band, drawn
     over the ratings students actually gave, and named at its end. */
  C.profScatter = function (host, o) {
    const W = widthOf(host, 420, 280, 520), H = 290, left = 40, right = 86, top = 12, bottom = 52, r = 4.5;
    const [x0d, x1d] = o.xDomain || [0, 10], [lo0, hi] = o.yDomain || [0, 1];
    // whole steps from the top down, so the top and bottom gridlines both carry a label
    const yStep = hi - lo0 > 0.6 ? 0.2 : 0.1, lo = Math.max(0, hi - Math.ceil((hi - lo0) / yStep - 1e-9) * yStep);
    const X = v => left + (v - x0d) / (x1d - x0d) * (W - left - right), Y = v => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom);
    const clampY = v => Math.max(lo, Math.min(hi, v));
    const s = root(host, W, H, o.label);
    for (let v = lo; v <= hi + 1e-9; v += yStep) {
      svg('line', { class: 'grid', x1: left, x2: W - right, y1: Y(v), y2: Y(v) }, s);
      text(s, left - 8, Y(v) + 5, v < 1e-9 ? '0' : v > 1 - 1e-9 ? '1' : p2(v), { 'text-anchor': 'end' });
    }
    const every = (W - left - right) / (x1d - x0d) < 26 ? 2 : 1;
    for (let v = x1d; v >= x0d; v -= every) text(s, X(v), H - bottom + 21, String(v), { 'text-anchor': 'middle' });
    text(s, (left + W - right) / 2, H - 5, o.xLabel, { 'text-anchor': 'middle', class: 'label-strong' });
    // ties on the rating: spread across ±0.3 of a rating point, in order of arrival
    const seen = {}, unit = X(1) - X(0);
    const pts = o.points.map(q => { const k = q.x, i = (seen[k] = (seen[k] || 0) + 1) - 1; return Object.assign({ i }, q); });
    const count = {}; pts.forEach(q => { count[q.x] = (count[q.x] || 0) + 1; });
    const jx = q => count[q.x] > 1 ? (q.i / (count[q.x] - 1) - 0.5) * Math.min(0.6 * unit, (count[q.x] - 1) * (r + 1)) : 0;
    // dots first, the fitted lines over them
    pts.forEach(q => ['zh', 'en'].forEach(l => {
      const g = svg('g', {}, s);
      title(g, `A student with English ${q.x}: ${NAME[l]} ${p2(q[l])}`);
      svg('circle', { cx: X(q.x) + jx(q), cy: Y(clampY(q[l])), r, class: 'dot-lang soft f-' + l }, g);
    }));
    const ends = [];
    ['zh', 'en'].forEach(l => {
      const f = o.fit && o.fit[l];
      if (!f) return;
      const xs = o.points.map(q => q.x), x0 = Math.min(...xs), x1 = Math.max(...xs);
      const n = 24, up = [], dn = [];
      for (let j = 0; j <= n; j++) { const x = x0 + (x1 - x0) * j / n, yv = f.at(x), h = f.band(x); up.push(`${X(x).toFixed(1)} ${Y(clampY(yv + h)).toFixed(1)}`); dn.unshift(`${X(x).toFixed(1)} ${Y(clampY(yv - h)).toFixed(1)}`); }
      svg('path', { d: 'M' + up.concat(dn).join('L') + 'Z', class: 'band f-' + l }, s);
      const g = svg('g', {}, s);
      title(g, `${NAME[l]}: ${f.b < 0 ? '−' : '+'}${Math.abs(f.b).toFixed(3).replace(/^0/, '')} per rating point`);
      svg('line', { x1: X(x0), x2: X(x1), y1: Y(clampY(f.at(x0))), y2: Y(clampY(f.at(x1))), class: 'series-line fit-line s-' + l }, g);
      ends.push({ lang: l, x: X(x1) + 10, y: Y(clampY(f.at(x1))) });
    });
    endLabels(s, ends, 17, top + 6, H - bottom - 4);
    return s;
  };

  window.FAST_CHARTS = C;
})();
