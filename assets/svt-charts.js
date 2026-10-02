/* LT5461 — sentence task (typicality): the English-proficiency charts on the
   results page. Plain SVG drawn from numbers the dashboard passes in, in the
   style of fast-charts.js: laid out at the width of their box (so the text
   stays full size on any screen; the dashboard redraws on resize), every mark
   has a <title>, and every chart has a table twin on the page.
   The upper English group is always ink with filled dots and a solid line,
   the lower group mint-deep with open dots and a dashed line, and both lines
   are named at their ends, so colour is never the only cue. Exposes window.SVT_CHARTS. */
(function () {
  'use strict';
  const C = {};
  const svg = LAB.svg, text = LAB.text;
  const title = (el, s) => { const t = svg('title', {}, el); t.textContent = s; return el; };
  const widthOf = (host, def, min, max) => Math.max(min, Math.min(max, Math.round(host.getBoundingClientRect().width) || def));
  const root = (host, W, H, label) => { host.textContent = ''; return svg('svg', { class: 'chart fc', viewBox: `0 0 ${W} ${H}`, style: `max-width:${W}px`, role: 'img', 'aria-label': label }, host); };
  const ms = v => (v < 0 ? '−' : '') + Math.abs(Math.round(v));
  const sms = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(Math.round(v));
  // A step of 1, 2 or 5 × 10^k giving at most `n` intervals over `span`.
  const niceStep = (span, n) => { const raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag; };
  const domainOf = (vals, n, withZero) => {
    let lo = Math.min(...vals, withZero ? 0 : Infinity), hi = Math.max(...vals, withZero ? 0 : -Infinity);
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-9) { lo -= 50; hi += 50; }
    const st = niceStep(hi - lo, n);
    return { lo: Math.floor(lo / st - 1e-9) * st, hi: Math.ceil(hi / st + 1e-9) * st, step: st };
  };
  // Students who gave the same rating: spread a little either side, the same way in every series.
  function spread(points, X, r) {
    const count = {}, seen = {}, unit = X(1) - X(0);
    points.forEach(p => { count[p.x] = (count[p.x] || 0) + 1; });
    return points.map(p => {
      const i = (seen[p.x] = (seen[p.x] || 0) + 1) - 1, n = count[p.x];
      return n > 1 ? (i / (n - 1) - 0.5) * Math.min(0.5 * unit, (n - 1) * (r + 1.5)) : 0;
    });
  }
  function band(s, f, xs, X, Y, cls) {
    const x0 = Math.min(...xs), x1 = Math.max(...xs), n = 24, up = [], dn = [];
    for (let j = 0; j <= n; j++) {
      const x = x0 + (x1 - x0) * j / n, y = f.at(x), h = f.band(x);
      up.push(`${X(x).toFixed(1)} ${Y(y + h).toFixed(1)}`); dn.unshift(`${X(x).toFixed(1)} ${Y(y - h).toFixed(1)}`);
    }
    svg('path', { d: 'M' + up.concat(dn).join('L') + 'Z', class: cls }, s);
  }
  function xAxis(s, X, H, bottom, xLabel, W, left, right) {
    for (let v = 1; v <= 7; v++) text(s, X(v), H - bottom + 21, String(v), { 'text-anchor': 'middle' });
    text(s, (left + W - right) / 2, H - 5, xLabel, { 'text-anchor': 'middle', class: 'label-strong' });
  }
  function yAxis(s, d, Y, left, W, right, fmt, zeroCls) {
    for (let v = d.lo; v <= d.hi + 1e-9; v += d.step) {
      svg('line', { class: zeroCls && Math.abs(v) < 1e-9 ? 'zero' : 'grid', x1: left, x2: W - right, y1: Y(v), y2: Y(v) }, s);
      text(s, left - 8, Y(v) + 5, fmt(v), { 'text-anchor': 'end' });
    }
  }
  const clipOf = (Y, d) => v => Math.max(d.lo, Math.min(d.hi, v));

  /* 1. The classic interaction plot: mean of the students' medians for high-
     and low-typicality statements, one line per English group (the lower and
     upper half on the chosen rating), with 95% CIs. Lines that are not
     parallel show the typicality effect differing between the groups.
     o: {groups: [{key: 'lower'|'upper', name, sub, n, hi: [ms], lo: [ms]}], label} */
  C.groups = function (host, o) {
    const W = widthOf(host, 520, 290, 640), narrow = W < 420, H = 320, left = 58, right = narrow ? 118 : 150, top = 16, bottom = narrow ? 60 : 46;
    const G = o.groups.filter(g => g.n > 0).map(g => Object.assign({
      m: { hi: LAB.mean(g.hi), lo: LAB.mean(g.lo) }, ci: { hi: LAB.ci95(g.hi), lo: LAB.ci95(g.lo) }
    }, g));
    const vals = G.flatMap(g => ['hi', 'lo'].flatMap(k => [g.m[k], g.ci[k][0], g.ci[k][1]])).filter(isFinite);
    const d = domainOf(vals, 4, false);
    const xs = { hi: left + (W - left - right) * (narrow ? 0.2 : 0.22), lo: left + (W - left - right) * (narrow ? 0.8 : 0.78) };
    const Y = v => top + (1 - (v - d.lo) / (d.hi - d.lo)) * (H - top - bottom);
    const s = root(host, W, H, o.label);
    yAxis(s, d, Y, left, W, right, v => String(Math.round(v)));
    text(s, 0, 0, 'Mean of medians (ms)', { transform: `translate(14 ${((top + H - bottom) / 2).toFixed(1)}) rotate(-90)`, 'text-anchor': 'middle', class: 'axis-title' });
    // on a phone the two category names go on two lines each, so they never meet
    [['hi', 'High'], ['lo', 'Low']].forEach(([k, w]) => {
      if (narrow) { text(s, xs[k], H - bottom + 22, w, { 'text-anchor': 'middle', class: 'label-strong' }); text(s, xs[k], H - bottom + 40, 'typicality', { 'text-anchor': 'middle', class: 'label-strong' }); }
      else text(s, xs[k], H - bottom + 22, w + ' typicality', { 'text-anchor': 'middle', class: 'label-strong' });
    });
    const off = { upper: -7, lower: 7 }, ends = [];
    G.forEach(g => {
      const cls = g.key === 'upper' ? 'svt-hi' : 'svt-lo', dx = G.length > 1 ? off[g.key] : 0;
      svg('line', { x1: xs.hi + dx, x2: xs.lo + dx, y1: Y(g.m.hi), y2: Y(g.m.lo), class: 'svt-line ' + cls }, s);
      ['hi', 'lo'].forEach(k => {
        const x = xs[k] + dx, c = g.ci[k], gg = svg('g', {}, s);
        title(gg, `${g.name} (${g.sub}): ${k === 'hi' ? 'high' : 'low'} typicality ${ms(g.m[k])} ms` + (isFinite(c[0]) ? `, 95% CI ${ms(c[0])}–${ms(c[1])}` : ''));
        if (isFinite(c[0])) svg('line', { x1: x, x2: x, y1: Y(Math.min(d.hi, c[1])), y2: Y(Math.max(d.lo, c[0])), class: 'svt-whisker ' + cls }, gg);
        svg('circle', { cx: x, cy: Y(g.m[k]), r: 5.5, class: 'svt-dot ' + cls + ' svt-mean' }, gg);
      });
      ends.push({ g, cls, y: Y(g.m.lo), x: xs.lo + dx + 14 });
    });
    ends.sort((a, b) => a.y - b.y);
    if (ends.length === 2 && ends[1].y - ends[0].y < 38) { const m = (ends[0].y + ends[1].y) / 2; ends[0].y = m - 19; ends[1].y = m + 19; }
    ends.forEach(e => {
      text(s, e.x, e.y - 1, e.g.name, { class: 'series-label halo' });
      text(s, e.x, e.y + 15, narrow ? `${e.g.sub.replace('rated ', '')} · n ${e.g.n}` : `${e.g.sub}, n = ${e.g.n}`, { class: 'row-label halo' });
    });
    return s;
  };

  /* 2. Each student's typicality effect (low − high) against their English
     rating, with the least-squares line and its 95% band. The slope is the
     proficiency × typicality interaction. o: {points: [{x, eff}], fit, xLabel, label} */
  C.effect = function (host, o) {
    const W = widthOf(host, 520, 290, 640), H = 320, left = 58, right = 24, top = 14, bottom = 52, r = 4.5;
    const d = domainOf(o.points.map(p => p.eff), 5, true);
    const X = v => left + (v - 1) / 6 * (W - left - right), Y = v => top + (1 - (v - d.lo) / (d.hi - d.lo)) * (H - top - bottom);
    const cy = clipOf(Y, d);
    const s = root(host, W, H, o.label);
    yAxis(s, d, Y, left, W, right, v => Math.abs(v) < 1e-9 ? '0' : sms(v), true);
    text(s, 0, 0, 'Low − high (ms)', { transform: `translate(14 ${((top + H - bottom) / 2).toFixed(1)}) rotate(-90)`, 'text-anchor': 'middle', class: 'axis-title' });
    xAxis(s, X, H, bottom, o.xLabel, W, left, right);
    const xs = o.points.map(p => p.x);
    if (o.fit) band(s, o.fit, xs, X, v => Y(cy(v)), 'ci');
    const jx = spread(o.points, X, r);
    o.points.forEach((p, i) => {
      const g = svg('g', {}, s);
      title(g, `A student rating their English ${+p.x.toFixed(2)}: typicality effect ${sms(p.eff)} ms`);
      svg('circle', { cx: X(p.x) + jx[i], cy: Y(cy(p.eff)), r, class: 'dot' }, g);
    });
    if (o.fit) {
      const x0 = Math.min(...xs), x1 = Math.max(...xs), g = svg('g', {}, s);
      title(g, `Fitted line: ${sms(o.fit.b)} ms per rating point`);
      svg('line', { x1: X(x0), x2: X(x1), y1: Y(cy(o.fit.at(x0))), y2: Y(cy(o.fit.at(x1))), class: 'mean' }, g);
    }
    return s;
  };

  /* 3. The interaction for every rating: the change in the typicality effect
     per rating point, with its 95% CI. rows: [{label, b, lo, hi, p}] */
  C.slopes = function (host, rows, o) {
    const W = widthOf(host, 700, 290, 760), narrow = W < 520;
    const rowH = narrow ? 50 : 36, left = narrow ? 14 : 150, right = 74, top = 6, bottom = 50;
    const H = top + rows.length * rowH + bottom;
    const m = Math.max(10, ...rows.flatMap(r => [Math.abs(r.lo), Math.abs(r.hi)]).filter(isFinite));
    const step = niceStep(m, 3), lim = Math.ceil(m / step - 1e-9) * step;
    const X = v => left + (v + lim) / (2 * lim) * (W - left - right);
    const s = root(host, W, H, o.label);
    for (let v = -lim; v <= lim + 1e-9; v += step) {
      svg('line', { class: Math.abs(v) < 1e-9 ? 'zero' : 'grid', x1: X(v), x2: X(v), y1: top, y2: H - bottom + 6 }, s);
      text(s, X(v), H - bottom + 24, Math.abs(v) < 1e-9 ? '0' : sms(v), { 'text-anchor': 'middle' });
    }
    text(s, (left + W - right) / 2, H - 5, narrow ? (o.xLabelShort || o.xLabel) : o.xLabel, { 'text-anchor': 'middle', class: 'label-strong' });
    rows.forEach((r, i) => {
      const y = top + i * rowH + (narrow ? 34 : rowH / 2);
      const sig = isFinite(r.p) && r.p < 0.05;
      text(s, 0, narrow ? y - 15 : y + 5, r.label, { class: (sig ? 'label-strong' : 'row-label') + (narrow ? ' halo' : '') });
      if (!isFinite(r.b)) { text(s, X(0), y + 5, 'too few students', { 'text-anchor': 'middle', class: 'row-label' }); return; }
      const g = svg('g', {}, s);
      title(g, `${r.label}: ${sms(r.b)} ms per rating point (95% CI ${sms(r.lo)} to ${sms(r.hi)})` + (isFinite(r.p) ? `, p ${r.p < 0.001 ? '< .001' : '= ' + r.p.toFixed(3).replace(/^0/, '')}` : ''));
      svg('line', { x1: X(Math.max(-lim, r.lo)), x2: X(Math.min(lim, r.hi)), y1: y, y2: y, class: 'forest-ci' + (sig ? ' sig' : '') }, g);
      svg('circle', { cx: X(r.b), cy: y, r: 5.5, class: 'forest-dot' + (sig ? ' sig' : '') }, g);
      svg('rect', { x: X(Math.max(-lim, r.lo)) - 6, y: y - 12, width: Math.max(12, X(Math.min(lim, r.hi)) - X(Math.max(-lim, r.lo)) + 12), height: 24, fill: 'transparent' }, g);
      text(s, W - 2, y + 5, sms(r.b) + ' ms', { 'text-anchor': 'end', class: sig ? 'value-label strong' : 'value-label' });
    });
    return s;
  };

  window.SVT_CHARTS = C;
})();
