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
      text(s, e.x + 14, e.ly + 5, e.text || NAME[e.lang], { class: 'series-label halo' });
    });
  }

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
    const show = tickEvery(n, (W - left - right) / n);
    for (let k = 0; k < n; k++) if (show(k)) text(s, X(k), H - bottom + 21, String(k + 1), { 'text-anchor': 'middle' });
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
    endLabels(s, ends, 19, top + 6, H - bottom - 4);
    return s;
  };

  /* A half swarm: each dot takes the offset nearest its column (0, then d,
     2d, … in direction dir) that keeps it at least d away from every dot
     already placed, so tied values sit side by side instead of on top of
     each other. Offsets are squeezed to fit within room. */
  /* Which of n evenly spaced tick labels to show when they are px apart:
     every k-th, with k as small as gives at least 26px between labels and,
     where possible, dividing n − 1 so the last tick is labelled too. */
  function tickEvery(n, px) {
    let k = 1;
    while (k < n - 1 && k * px < 26) k++;
    const even = [k, k + 1, k + 2].find(j => j < n && (n - 1) % j === 0);
    return i => i % (even || k) === 0;
  }

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
    const W = widthOf(host, 560, 300, 680);
    const H = 310, top = 30, bottom = 38, left = 54, right = 16, r = 4.5;
    const vals = pairs.flatMap(p => [p.zh, p.en]).filter(isFinite);
    const hi = o.max || Math.max(o.minMax || 0, Math.ceil((Math.max(0, ...vals) + 1e-9) / o.step) * o.step);
    const Y = v => top + (1 - v / hi) * (H - top - bottom);
    const pw = W - left - right, XZ = left + pw * 0.43, XE = left + pw * 0.57;
    const edgeZ = left + 20, edgeE = W - right - 20;
    const s = root(host, W, H, o.label);
    const ticks = o.ticks ? o.ticks.filter(v => v <= hi + 1e-9) : Array.from({ length: Math.floor(hi / o.step + 1e-9) + 1 }, (_, i) => i * o.step);
    ticks.forEach(v => {
      svg('line', { class: 'grid', x1: left, x2: W - right, y1: Y(v), y2: Y(v) }, s);
      text(s, left - 8, Y(v) + 5, o.tick(v), { 'text-anchor': 'end' });
    });
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

  /* ---------- 5b. back-to-back counts: how many students at each value ----------
     For discrete values with many ties, where a swarm would pile fifty
     students onto one dot. rows: [{label, zh, en}], lowest value first; drawn
     with the highest at the top. Chinese bars run left from the value labels,
     English bars run right; each bar carries its count. */
  C.mirror = function (host, rows, o) {
    const W = widthOf(host, 560, 280, 640);
    const rowH = 30, bar = 18, top = 34, bottom = 6, mid = 82;
    const H = top + rows.length * rowH + bottom, cx = W / 2;
    const max = Math.max(1, ...rows.flatMap(r => [r.zh, r.en]));
    const room = cx - mid / 2 - 34, L = n => n / max * room;
    const s = root(host, W, H, o.label);
    text(s, cx - mid / 2, 18, NAME.zh, { 'text-anchor': 'end', class: 'label-strong' });
    text(s, cx + mid / 2, 18, NAME.en, { 'text-anchor': 'start', class: 'label-strong' });
    text(s, cx, 18, o.head || '', { 'text-anchor': 'middle', class: 'row-label' });
    rows.slice().reverse().forEach((r, k) => {
      const y0 = top + k * rowH, yc = y0 + rowH / 2;
      if (k) svg('line', { class: 'grid', x1: 0, x2: W, y1: y0, y2: y0 }, s);
      text(s, cx, yc + 5, r.label, { 'text-anchor': 'middle', class: 'row-label' });
      [['zh', -1], ['en', 1]].forEach(([l, dir]) => {
        const n = r[l], x0 = cx + dir * mid / 2, g = svg('g', {}, s);
        title(g, `${NAME[l]}: ${n} student${n === 1 ? '' : 's'} at ${r.label}`);
        svg('rect', { x: dir < 0 ? 0 : x0, y: y0, width: dir < 0 ? x0 : W - x0, height: rowH, class: 'hit' }, g);
        if (n > 0) svg('rect', { x: dir < 0 ? x0 - L(n) : x0, y: yc - bar / 2, width: Math.max(2, L(n)), height: bar, rx: 3, class: 'bar-lang f-' + l }, g);
        text(g, x0 + dir * (L(n) + 6), yc + 5, String(n), { 'text-anchor': dir < 0 ? 'end' : 'start', class: n ? 'count' : 'count none' });
      });
    });
    return s;
  };

  /* ---------- 6. a forest plot (estimates with 95% CIs) in labelled groups ----------
     groups: [{label, rows: [{label, b, lo, hi, p}]}]. Wide: row labels in a
     column on the left. Narrow: each label above its line. Options: xLabel,
     label, minLim (the smallest half-range, default 0.25), fmt (values), left
     (label column, default 320), narrowAt (default 600). A group with an empty
     label is drawn without one. */
  C.forest = function (host, groups, o) {
    const W = widthOf(host, 700, 280, 740), narrow = W < (o.narrowAt === undefined ? 600 : o.narrowAt);
    const rowH = narrow ? 50 : 34, gap = 18, left = narrow ? 14 : (o.left || 320), right = 64, top = 4, bottom = 48;
    const headH = g => g.label ? 30 : 8;
    const rows = groups.flatMap(g => g.rows);
    const H = top + groups.reduce((t, g) => t + headH(g), 0) + (groups.length - 1) * gap + rows.length * rowH + bottom;
    const fmt = o.fmt || (v => (v < 0 ? '−' : '+') + Math.abs(v).toFixed(2));
    const m = Math.max(o.minLim || 0.25, ...rows.flatMap(r => [Math.abs(r.lo), Math.abs(r.hi)]).filter(isFinite));
    const step = [0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5].find(st => Math.ceil(m / st - 1e-9) <= 4) || 5, lim = Math.ceil(m / step - 1e-9) * step;
    const tick = v => Math.abs(v) < 1e-9 ? '0' : (v > 0 ? '+' : '−') + (step < 0.1 ? Math.abs(v).toFixed(step < 0.01 ? 3 : 2).replace(/^0/, '') : String(Math.abs(+v.toFixed(2))));
    const X = v => left + (v + lim) / (2 * lim) * (W - left - right);
    const s = root(host, W, H, o.label);
    // label every tick that has room (about 44px each), always including 0
    const pxPer = (W - left - right) / (2 * lim / step), every = pxPer >= 44 ? 1 : pxPer >= 22 ? 2 : 4;
    for (let v = -lim; v <= lim + 1e-9; v += step) {
      svg('line', { class: Math.abs(v) < 1e-9 ? 'zero' : 'grid', x1: X(v), x2: X(v), y1: top + headH(groups[0]) - 6, y2: H - bottom + 6 }, s);
      if (Math.round(v / step) % every === 0) text(s, X(v), H - bottom + 24, tick(v), { 'text-anchor': 'middle' });
    }
    text(s, X(0), H - 5, o.xLabel, { 'text-anchor': 'middle', class: 'label-strong' });
    let y0 = top;
    groups.forEach((grp, gi) => {
      if (gi) { svg('line', { class: 'divider', x1: 0, x2: W, y1: y0 + gap / 2, y2: y0 + gap / 2 }, s); y0 += gap; }
      if (grp.label) text(s, 0, y0 + 20, grp.label, { class: 'group-label halo' });
      y0 += headH(grp);
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

  // Shared frame for the model charts: y gridlines with labels, a y-axis title.
  function yFrame(s, o, W, H, left, right, top, bottom, Y, lo, hi, step) {
    for (let v = lo; v <= hi + 1e-9; v += step) {
      svg('line', { class: o.yRef !== undefined && Math.abs(v - o.yRef) < 1e-9 ? 'chance' : 'grid', x1: left, x2: W - right, y1: Y(v), y2: Y(v) }, s);
      text(s, left - 8, Y(v) + 5, (o.yFmt || p2)(v), { 'text-anchor': 'end' });
    }
    if (o.yLabel) text(s, 0, 0, o.yLabel, { transform: `translate(15 ${((top + H - bottom) / 2).toFixed(1)}) rotate(-90)`, 'text-anchor': 'middle', class: 'axis-title' });
  }
  const niceDomain = (vals, step, floor, ceil) => {
    const v = vals.filter(isFinite);
    let lo = Math.max(floor, Math.floor((v.length ? Math.min(...v) : floor) / step - 1e-9) * step), hi = Math.min(ceil, Math.ceil((v.length ? Math.max(...v) : ceil) / step + 1e-9) * step);
    if (hi - lo < 2 * step) { lo = Math.max(floor, lo - step); hi = Math.min(ceil, hi + step); }
    return [lo, hi];
  };

  /* ---------- 8. the interaction: P(next positive) after a negative and after a positive answer ----------
     o: {next: {zh: {N: {est, lo, hi}, P}, en}, label}. One line per language;
     the steeper the line, the stronger the carry-over. */
  C.interaction = function (host, o) {
    // narrow: no rotated axis title (the heading above names the axis), so the plot gets the width
    const W = widthOf(host, 420, 280, 460), narrow = W < 400, H = 290, left = narrow ? 44 : 62, right = 108, top = 14, bottom = 56;
    const vals = ['zh', 'en'].flatMap(l => ['N', 'P'].flatMap(k => [o.next[l][k].lo, o.next[l][k].hi]));
    const [lo, hi] = niceDomain(vals, 0.1, 0, 1);
    // room for the left-hand values (about 50px) between the axis and the first dots
    const pw = W - left - right, x0 = Math.max(0.22 * pw, 50), x1 = Math.max(0.78 * pw, x0 + 60);
    const X = i => left + (i === 0 ? x0 : x1), Y = v => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom);
    const s = root(host, W, H, o.label);
    yFrame(s, { yFmt: v => v < 1e-9 ? '0' : v > 1 - 1e-9 ? '1' : p2(v), yLabel: narrow ? '' : 'Probability the next is positive' }, W, H, left, right, top, bottom, Y, lo, hi, 0.1);
    ['Negative', 'Positive'].forEach((t, i) => text(s, X(i), H - bottom + 22, t, { 'text-anchor': 'middle' }));
    text(s, (left + W - right) / 2, H - 5, 'Previous answer', { 'text-anchor': 'middle', class: 'label-strong' });
    const ends = [];
    [['zh', -6], ['en', 6]].forEach(([l, off]) => {
      const a = o.next[l].N, b = o.next[l].P;
      svg('line', { x1: X(0) + off, x2: X(1) + off, y1: Y(a.est), y2: Y(b.est), class: 'series-line s-' + l }, s);
      [[0, a, 'after a negative answer'], [1, b, 'after a positive answer']].forEach(([i, d, what]) => {
        const g = svg('g', {}, s);
        title(g, `${NAME[l]}, ${what}: ${p2(d.est)} (95% CI ${p2(d.lo)} to ${p2(d.hi)})`);
        svg('line', { x1: X(i) + off, x2: X(i) + off, y1: Y(Math.min(hi, d.hi)), y2: Y(Math.max(lo, d.lo)), class: 'ci-line s-' + l }, g);
        svg('circle', { cx: X(i) + off, cy: Y(d.est), r: 6, class: 'dot-lang f-' + l }, g);
        svg('circle', { cx: X(i) + off, cy: Y(d.est), r: 13, fill: 'transparent' }, g);
      });
      ends.push({ lang: l, x: X(1) + 16, y: Y(b.est), text: `${NAME[l]} ${p2(b.est)}` });
    });
    // the left-hand values, beside their dots (lower one below the other)
    const L = ['zh', 'en'].map(l => ({ l, y: Y(o.next[l].N.est), v: o.next[l].N.est })).sort((a, b) => a.y - b.y);
    if (L[1].y - L[0].y < 17) { const m = (L[0].y + L[1].y) / 2; L[0].y = m - 8.5; L[1].y = m + 8.5; }
    L.forEach(e => text(s, X(0) - 16, e.y + 5, p2(e.v), { 'text-anchor': 'end', class: 'value-label halo' }));
    endLabels(s, ends, 19, top + 6, H - bottom - 4);
    return s;
  };

  /* ---------- 9. model lines with 95% bands, and observed means ----------
     o: {series: {zh: {line: [{x, y, lo, hi}], dots: [{x, y, lo, hi, n}]}, en},
     xDomain, xTicks, xLabel, xFmt, yStep, yFmt, yRef, yLabel, yFloor, yCeil, dotTitle, lineTitle, label}. */
  C.lines = function (host, o) {
    const W = widthOf(host, 420, 280, 680), H = 300, left = 62, right = 86, top = 14, bottom = 56;
    const [x0, x1] = o.xDomain;
    const all = ['zh', 'en'].flatMap(l => (o.series[l].line || []).flatMap(d => [d.lo, d.hi]).concat((o.series[l].dots || []).flatMap(d => [d.y, d.lo, d.hi])));
    const [lo, hi] = o.yDomain || niceDomain(all, o.yStep, o.yFloor === undefined ? -Infinity : o.yFloor, o.yCeil === undefined ? Infinity : o.yCeil);
    const pad = 10, X = v => left + pad + (v - x0) / (x1 - x0) * (W - left - right - 2 * pad), Y = v => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom);
    const cl = v => Math.max(lo, Math.min(hi, v));
    const s = root(host, W, H, o.label);
    yFrame(s, o, W, H, left, right, top, bottom, Y, lo, hi, o.yStep);
    const xt = o.xTicks || [], show = xt.length > 1 ? tickEvery(xt.length, X(xt[1]) - X(xt[0])) : () => true;
    xt.forEach((v, i) => { if (show(i)) text(s, X(v), H - bottom + 22, (o.xFmt || String)(v), { 'text-anchor': 'middle' }); });
    text(s, (left + W - right) / 2, H - 5, o.xLabel, { 'text-anchor': 'middle', class: 'label-strong' });
    const ends = [];
    [['zh', -4], ['en', 4]].forEach(([l, off]) => {
      const S = o.series[l], line = (S.line || []).filter(d => isFinite(d.y));
      if (line.length > 1) {
        const up = line.map(d => `${X(d.x).toFixed(1)} ${Y(cl(d.hi)).toFixed(1)}`), dn = line.slice().reverse().map(d => `${X(d.x).toFixed(1)} ${Y(cl(d.lo)).toFixed(1)}`);
        if (line.every(d => isFinite(d.lo))) svg('path', { d: 'M' + up.concat(dn).join('L') + 'Z', class: 'band f-' + l }, s);
        const g = svg('g', {}, s);
        if (o.lineTitle) title(g, o.lineTitle(l));
        svg('path', { d: line.map((d, i) => (i ? 'L' : 'M') + X(d.x).toFixed(1) + ' ' + Y(cl(d.y)).toFixed(1)).join(' '), class: 'series-line fit-line s-' + l }, g);
        const last = line[line.length - 1];
        ends.push({ lang: l, x: X(last.x) + 12, y: Y(cl(last.y)) });
      }
      // observed values: full dots, or faint ones under a dominant model line (o.faint)
      (S.dots || []).filter(d => isFinite(d.y)).forEach(d => {
        const g = svg('g', {}, s);
        if (o.dotTitle) title(g, o.dotTitle(l, d));
        if (isFinite(d.lo) && !o.faint) svg('line', { x1: X(d.x) + off, x2: X(d.x) + off, y1: Y(cl(d.hi)), y2: Y(cl(d.lo)), class: 'ci-line soft s-' + l }, g);
        svg('circle', { cx: X(d.x) + off, cy: Y(cl(d.y)), r: 4, class: 'dot-lang f-' + l + (o.faint ? ' faint' : '') }, g);
        svg('circle', { cx: X(d.x) + off, cy: Y(cl(d.y)), r: 10, fill: 'transparent' }, g);
      });
    });
    endLabels(s, ends, 19, top + 6, H - bottom - 4);
    return s;
  };

  /* ---------- 10. a moderation scatter: English − Chinese difference against a rating ----------
     o: {points: [{x, y}], fit (LAB.ols or null), xDomain, yDomain, yStep, yFmt, xLabel, yLabel, label}.
     Faint dots, one fitted line with its 95% band, and a reference line at 0
     (no language difference). */
  C.diffScatter = function (host, o) {
    const W = widthOf(host, 420, 280, 600), H = 290, left = 62, right = 24, top = 14, bottom = 56;
    const [x0, x1] = o.xDomain, [lo, hi] = o.yDomain;
    const pad = 10, X = v => left + pad + (v - x0) / (x1 - x0) * (W - left - right - 2 * pad), Y = v => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom);
    const cl = v => Math.max(lo, Math.min(hi, v));
    const s = root(host, W, H, o.label);
    for (let v = lo; v <= hi + 1e-9; v += o.yStep) {
      svg('line', { class: Math.abs(v) < 1e-9 ? 'zero-ref' : 'grid', x1: left, x2: W - right, y1: Y(v), y2: Y(v) }, s);
      text(s, left - 8, Y(v) + 5, o.yFmt(v), { 'text-anchor': 'end' });
    }
    if (lo < 0 && hi > 0) svg('line', { class: 'zero-ref', x1: left, x2: W - right, y1: Y(0), y2: Y(0) }, s);
    if (o.yLabel) text(s, 0, 0, o.yLabel, { transform: `translate(15 ${((top + H - bottom) / 2).toFixed(1)}) rotate(-90)`, 'text-anchor': 'middle', class: 'axis-title' });
    const every = (W - left - right) / (x1 - x0) < 26 ? 2 : 1;
    for (let v = x1; v >= x0; v -= every) text(s, X(v), H - bottom + 22, String(v), { 'text-anchor': 'middle' });
    text(s, (left + W - right) / 2, H - 5, o.xLabel, { 'text-anchor': 'middle', class: 'label-strong' });
    // ties on the rating spread a little, so each student stays visible
    const seen = {};
    o.points.forEach(q => {
      const i = seen[q.x] = (seen[q.x] || 0) + 1;
      const g = svg('g', {}, s);
      title(g, `A student with English ${q.x}: English − Chinese ${(o.vFmt || o.yFmt)(q.y)}`);
      svg('circle', { cx: X(q.x) + ((i % 7) - 3) * 2.2, cy: Y(cl(q.y)), r: 4, class: 'dot-diff' }, g);
    });
    // a model's curve: [{x, est, lo, hi}], drawn with its 95% band
    const cv = (o.curve || []).filter(c => isFinite(c.est));
    if (cv.length > 1) {
      if (cv.every(c => isFinite(c.lo) && isFinite(c.hi))) svg('path', { d: 'M' + cv.map(c => `${X(c.x).toFixed(1)} ${Y(cl(c.hi)).toFixed(1)}`).concat(cv.slice().reverse().map(c => `${X(c.x).toFixed(1)} ${Y(cl(c.lo)).toFixed(1)}`)).join('L') + 'Z', class: 'band-neutral' }, s);
      const g = svg('g', {}, s);
      if (o.curveTitle) title(g, [cv[0], cv[cv.length - 1]].map(o.curveTitle).join('; '));
      svg('path', { d: cv.map((c, i) => (i ? 'L' : 'M') + X(c.x).toFixed(1) + ' ' + Y(cl(c.est)).toFixed(1)).join(' '), class: 'fit-neutral', fill: 'none' }, g);
    }
    const f = o.fit;
    if (f) {
      const xs = o.points.map(q => q.x), a = Math.min(...xs), b = Math.max(...xs), up = [], dn = [];
      for (let j = 0; j <= 24; j++) { const x = a + (b - a) * j / 24, yv = f.at(x), h = f.band(x); up.push(`${X(x).toFixed(1)} ${Y(cl(yv + h)).toFixed(1)}`); dn.unshift(`${X(x).toFixed(1)} ${Y(cl(yv - h)).toFixed(1)}`); }
      svg('path', { d: 'M' + up.concat(dn).join('L') + 'Z', class: 'band-neutral' }, s);
      const g = svg('g', {}, s);
      title(g, `Fitted line: ${(o.vFmt || o.yFmt)(f.b)} per rating point`);
      svg('line', { x1: X(a), x2: X(b), y1: Y(cl(f.at(a))), y2: Y(cl(f.at(b))), class: 'fit-neutral' }, g);
    }
    return s;
  };

  /* ---------- 11. one estimate with its 95% CI, on its own scale around 0 ----------
     For the compact secondary results: o: {est, lo, hi, fmt, label}. */
  C.estimate = function (host, o) {
    const W = widthOf(host, 260, 180, 320), H = 34, pad = 12;
    const m = Math.max(Math.abs(o.lo), Math.abs(o.hi), Math.abs(o.est), 1e-9) * 1.15;
    const X = v => pad + (v + m) / (2 * m) * (W - 2 * pad);
    const s = root(host, W, H, o.label);
    svg('line', { class: 'axis-light', x1: pad, x2: W - pad, y1: H / 2, y2: H / 2 }, s);
    svg('line', { class: 'zero', x1: X(0), x2: X(0), y1: 5, y2: H - 5 }, s);
    text(s, X(0) - 4, H - 3, '0', { 'text-anchor': 'end', class: 'scale-note' });
    if (isFinite(o.lo)) svg('line', { class: 'forest-ci sig', x1: X(o.lo), x2: X(o.hi), y1: H / 2, y2: H / 2 }, s);
    svg('circle', { class: 'forest-dot sig', cx: X(o.est), cy: H / 2, r: 5.5 }, s);
    return s;
  };

  window.FAST_CHARTS = C;
})();
