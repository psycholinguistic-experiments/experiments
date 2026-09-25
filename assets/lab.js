/* LT5461 lab — shared helpers: anonymous code, class session, data upload with
   an offline outbox, frame-locked timing, small stats, and SVG charts.
   No dependencies. Exposes window.LAB. */
(function () {
  'use strict';

  const LAB = {};
  const NS = 'lt5461:';

  /* ---------- storage (never throws) ---------- */
  LAB.store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(NS + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch (e) { /* private mode */ }
    }
  };

  /* ---------- identity: one anonymous code per device ---------- */
  const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O, 1/I/L
  function randomCode(n) {
    const bytes = new Uint32Array(n);
    crypto.getRandomValues(bytes);
    let s = '';
    for (let i = 0; i < n; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
    return s;
  }
  LAB.pid = function () {
    let pid = LAB.store.get('pid', null);
    if (!pid) {
      // Starts with a letter so a spreadsheet never reads the code as a number.
      let c = randomCode(6);
      while (!/^[A-Z]/.test(c)) c = randomCode(6);
      pid = c.slice(0, 3) + '-' + c.slice(3);
      LAB.store.set('pid', pid);
    }
    return pid;
  };
  LAB.uid = function () { return randomCode(12); };
  LAB.markDone = function (exp) {
    const done = LAB.store.get('done', {});
    done[exp] = true;
    LAB.store.set('done', done);
  };

  /* ---------- class session: the Hong Kong calendar date ----------
     Everything submitted on one day forms one class. Adding ?test to a task
     URL files the run under "test-<date>" so rehearsals never mix in. */
  LAB.hkDate = function (d) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(d || new Date());
  };
  LAB.params = new URLSearchParams(location.search);
  LAB.isTest = LAB.params.has('test');
  LAB.session = function () {
    return (LAB.isTest ? 'test-' : '') + LAB.hkDate();
  };

  /* ---------- endpoint ---------- */
  const isLocal = ['localhost', '127.0.0.1', ''].includes(location.hostname);
  LAB.endpoint = function () {
    // A URL override is honoured only on a local dev server, so nobody can
    // craft a public link that sends students' data elsewhere.
    if (isLocal && LAB.params.get('endpoint')) return LAB.params.get('endpoint');
    const cfg = window.LT5461_CONFIG || {};
    return (cfg.endpoint || '').trim();
  };
  LAB.connected = function () { return /^https?:\/\//.test(LAB.endpoint()); };

  /* ---------- upload with outbox ----------
     Payloads wait in localStorage until the server confirms them, so a
     dropped Wi-Fi connection never loses a run. Content-Type text/plain keeps
     the request "simple" (no CORS preflight), which Apps Script requires. */
  /* Google's web-app endpoint occasionally answers with an error page instead
     of JSON (about 1 request in 8 when several arrive together). Retry with
     short pauses; posts are safe to repeat because the script ignores a
     submission id it has already stored. Each attempt also has a time limit:
     a request Google never answers would otherwise hang the page. */
  async function fetchJSON(url, init, tries, limitMs) {
    let last;
    for (let i = 0; i < tries; i++) {
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctrl && setTimeout(() => ctrl.abort(), limitMs || 25000);
      try {
        const res = await fetch(url, ctrl ? Object.assign({}, init, { signal: ctrl.signal }) : init);
        const text = await res.text();
        try { return JSON.parse(text); } catch (e) { throw new Error('HTTP ' + res.status); }
      } catch (e) {
        last = e;
        if (i < tries - 1) await LAB.wait([800, 2000, 4000][i] || 4000);
      } finally {
        clearTimeout(timer);
      }
    }
    throw last;
  }
  let retryTimer = null;

  LAB.submit = async function (payload) {
    const box = LAB.store.get('outbox', []);
    box.push(payload);
    LAB.store.set('outbox', box);
    return LAB.flush();
  };

  LAB.flush = async function () {
    if (!LAB.connected()) return { sent: 0, pending: LAB.store.get('outbox', []).length, offline: true };
    let box = LAB.store.get('outbox', []);
    let sent = 0;
    for (const payload of box.slice()) {
      try {
        const json = await fetchJSON(LAB.endpoint(), {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
          redirect: 'follow'
        }, 4, 30000);
        if (!json.ok) throw new Error(json.error || 'rejected');
        box = LAB.store.get('outbox', []).filter(p => p.submissionId !== payload.submissionId);
        LAB.store.set('outbox', box);
        sent++;
        document.dispatchEvent(new CustomEvent('lab:sent', { detail: { submissionId: payload.submissionId } }));
      } catch (e) {
        break; // try again later
      }
    }
    const pending = LAB.store.get('outbox', []).length;
    // While the page stays open, keep trying every 20 s.
    clearTimeout(retryTimer);
    if (pending) retryTimer = setTimeout(LAB.flush, 20000);
    return { sent, pending, offline: false };
  };

  LAB.fetchClass = async function (exp, session) {
    if (!LAB.connected()) return { ok: false, offline: true, rows: [] };
    const url = new URL(LAB.endpoint());
    url.searchParams.set('action', 'summary');
    url.searchParams.set('exp', exp);
    url.searchParams.set('session', session);
    url.searchParams.set('_', Date.now());
    const json = await fetchJSON(url.toString(), { redirect: 'follow' }, 3);
    if (!json.ok) throw new Error(json.error || 'server error');
    return json;
  };

  LAB.fetchSessions = async function () {
    if (!LAB.connected()) return [];
    const url = new URL(LAB.endpoint());
    url.searchParams.set('action', 'sessions');
    url.searchParams.set('_', Date.now());
    const json = await fetchJSON(url.toString(), { redirect: 'follow' }, 3);
    return json.ok ? json.sessions : [];
  };

  /* ---------- timing ---------- */
  LAB.frame = () => new Promise(r => requestAnimationFrame(r));

  /* Median inter-frame interval over n frames. Stimuli are then timed in whole
     frames of the display actually in use (60 Hz, 120 Hz ProMotion, 144 Hz...). */
  LAB.measureFrame = async function (n) {
    n = n || 40;
    let t0 = await LAB.frame();
    const d = [];
    for (let i = 0; i < n; i++) {
      const t = await LAB.frame();
      d.push(t - t0);
      t0 = t;
    }
    return LAB.median(d);
  };

  LAB.wait = ms => new Promise(r => setTimeout(r, ms));

  /* ---------- small stats ---------- */
  LAB.mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
  LAB.median = a => {
    if (!a.length) return NaN;
    const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  LAB.sd = a => {
    if (a.length < 2) return NaN;
    const m = LAB.mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
  };
  const T975 = [0, 12.71, 4.30, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23, 2.20, 2.18, 2.16, 2.14, 2.13,
    2.12, 2.11, 2.10, 2.09, 2.09, 2.08, 2.07, 2.07, 2.06, 2.06, 2.06, 2.05, 2.05, 2.05, 2.04];
  LAB.t975 = df => df < 1 ? NaN : df < T975.length ? T975[Math.round(df)] || T975[T975.length - 1] : 1.96 + 2.4 / df;
  LAB.ci95 = a => {
    const n = a.length;
    if (n < 2) return [NaN, NaN];
    const h = LAB.t975(n - 1) * LAB.sd(a) / Math.sqrt(n), m = LAB.mean(a);
    return [m - h, m + h];
  };
  /* Difference b − a between two independent groups, with a Welch 95% CI. */
  LAB.diffCI = (a, b) => {
    if (a.length < 2 || b.length < 2) return { d: LAB.mean(b) - LAB.mean(a), ci: [NaN, NaN] };
    const va = Math.pow(LAB.sd(a), 2) / a.length, vb = Math.pow(LAB.sd(b), 2) / b.length;
    const se = Math.sqrt(va + vb);
    const df = Math.pow(va + vb, 2) / (va * va / (a.length - 1) + vb * vb / (b.length - 1));
    const d = LAB.mean(b) - LAB.mean(a), h = LAB.t975(df) * se;
    return { d, ci: [d - h, d + h] };
  };

  LAB.shuffle = function (a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  LAB.num = v => (v === '' || v === null || v === undefined) ? NaN : Number(v);
  LAB.round = (v, d) => {
    if (!isFinite(v)) return '';
    const p = Math.pow(10, d || 0);
    return Math.round(v * p) / p;
  };
  LAB.signed = v => { const r = Math.round(v); return (r > 0 ? '+' : r < 0 ? '−' : '±') + Math.abs(r); };
  LAB.pct = v => isFinite(v) ? Math.round(v * 100) + '%' : '–';

  /* ---------- CSV ---------- */
  LAB.toCSV = function (rows) {
    if (!rows.length) return '';
    const cols = [];
    rows.forEach(r => Object.keys(r).forEach(k => { if (!cols.includes(k)) cols.push(k); }));
    const esc = v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '﻿' + [cols.join(',')].concat(rows.map(r => cols.map(c => esc(r[c])).join(','))).join('\n');
  };
  LAB.download = function (filename, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  /* ---------- SVG ---------- */
  const SVGNS = 'http://www.w3.org/2000/svg';
  LAB.svg = function (tag, attrs, parent) {
    const el = document.createElementNS(SVGNS, tag);
    for (const k in attrs || {}) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  };
  LAB.text = function (parent, x, y, str, attrs) {
    const t = LAB.svg('text', Object.assign({ x, y }, attrs || {}), parent);
    t.textContent = str;
    return t;
  };

  function niceStep(span, target) {
    const raw = span / target, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / mag;
    return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
  }

  /* Beeswarm strip plot, one row per group, on a shared x axis.
     groups: [{label, values:[{v, you, excluded}]}]
     Each row shows every participant as a dot, the class mean as a bar and the
     95% CI of that mean as a mint band; "you" is highlighted and labelled. */
  LAB.stripPlot = function (host, groups, opts) {
    opts = Object.assign({ unit: 'ms', xLabel: '', zeroLabel: '', width: 760, r: 6 }, opts || {});
    host.textContent = '';
    const all = groups.flatMap(g => g.values.map(d => d.v)).filter(isFinite);
    const signed = opts.signed !== false;
    const fmt = opts.fmt || (v => signed ? LAB.signed(v) : String(Math.round(v)));
    let lo = Math.min(signed ? 0 : Infinity, ...all), hi = Math.max(signed ? 0 : -Infinity, ...all);
    if (opts.domain) { lo = Math.min(lo, opts.domain[0]); hi = Math.max(hi, opts.domain[1]); }
    if (opts.fixed) { lo = opts.domain[0]; hi = opts.domain[1]; }
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    const step = niceStep(hi - lo || 100, 6);
    if (!opts.fixed) { lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step; }
    const labelW = groups.length > 1 || groups[0].label ? 128 : 0;
    const W = opts.width, left = labelW + 12, right = 18;
    const x = v => left + (v - lo) / (hi - lo) * (W - left - right);
    const r = opts.r, d = r * 2 + 1.5;

    // lay out each row's swarm first to know its height
    const rows = groups.map(g => {
      const pts = g.values.filter(p => isFinite(p.v)).map(p => Object.assign({ x: x(p.v) }, p))
        .sort((a, b) => a.x - b.x);
      const placed = [];
      pts.forEach(p => {
        let k = 0, y = 0;
        for (; ; k++) {
          y = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * d;
          if (!placed.some(q => Math.abs(q.x - p.x) < d && Math.abs(q.y - y) < d)) break;
        }
        p.y = y; placed.push(p);
      });
      const ext = placed.length ? Math.max(...placed.map(p => Math.abs(p.y))) : 0;
      return { g, placed, half: Math.max(ext + r + 26, 44) };
    });

    const axisH = 44, gap = 18;
    const H = rows.reduce((s, row) => s + row.half * 2 + gap, 8) + axisH;
    const svg = LAB.svg('svg', {
      class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img',
      'aria-label': opts.ariaLabel || 'Strip plot'
    }, host);

    // grid + zero
    const top = 8, bottom = H - axisH;
    for (let v = lo; v <= hi + 1e-9; v += step) {
      LAB.svg('line', { class: v === 0 && signed ? 'zero' : 'grid', x1: x(v), x2: x(v), y1: top, y2: bottom }, svg);
      const tick = +v.toFixed(6);
      LAB.text(svg, x(v), bottom + 17, opts.tickFmt ? opts.tickFmt(tick) : signed ? (tick > 0 ? '+' : tick < 0 ? '−' : '') + Math.abs(tick) : String(tick), { 'text-anchor': 'middle' });
    }
    if (opts.xLabel) LAB.text(svg, (left + W - right) / 2, H - 6, opts.xLabel, { 'text-anchor': 'middle', class: 'label-strong' });
    if (opts.zeroLabel) LAB.text(svg, x(0) - 6, top + 12, opts.zeroLabel, { 'text-anchor': 'end' });

    let yCursor = top;
    let idx = 0;
    rows.forEach(row => {
      const cy = yCursor + row.half;
      if (row.g.label) {
        LAB.text(svg, 0, cy - 4, row.g.label, { class: 'label-strong' });
        if (row.g.sub) LAB.text(svg, 0, cy + 13, row.g.sub, {});
      }
      const vals = row.g.values.filter(p => isFinite(p.v) && !p.excluded).map(p => p.v);
      if (vals.length >= 2) {
        const [a, b] = LAB.ci95(vals);
        LAB.svg('rect', { class: 'ci', x: x(a), y: cy - row.half + 6, width: Math.max(2, x(b) - x(a)), height: row.half * 2 - 12 }, svg);
      }
      if (vals.length) {
        const m = LAB.mean(vals);
        LAB.svg('line', { class: 'mean', x1: x(m), x2: x(m), y1: cy - row.half + 4, y2: cy + row.half - 4 }, svg);
        const lx = x(m), anchor = lx > W - 120 ? 'end' : 'start';
        LAB.text(svg, lx + (anchor === 'end' ? -7 : 7), cy - row.half + 15, 'mean ' + fmt(m) + (opts.unit ? ' ' + opts.unit : ''), { class: 'mean-label', 'text-anchor': anchor });
      }
      const you = row.placed.filter(p => p.you);
      row.placed.filter(p => !p.you).forEach(p => {
        const c = LAB.svg('circle', { class: 'dot' + (p.excluded ? ' excluded' : ''), cx: p.x, cy: cy + p.y, r }, svg);
        c.style.setProperty('--i', idx++);
      });
      you.forEach(p => {
        const c = LAB.svg('circle', { class: 'you', cx: p.x, cy: cy + p.y, r: r + 1.5 }, svg);
        c.style.setProperty('--i', idx + 6);
        LAB.text(svg, p.x, cy + p.y + r + 16, 'you', { class: 'you-label', 'text-anchor': 'middle' });
      });
      yCursor += row.half * 2 + gap;
    });
    return svg;
  };

  /* Interaction plot for the sound-symbolism task: x = consonant class,
     two series (back rounded vs front vowels), y = % rounded-shape choices.
     series: {a:[3 values 0..1], b:[...], aCI:[[lo,hi]...], bCI} */
  LAB.interactionPlot = function (host, s, opts) {
    opts = Object.assign({ width: 420, height: 300, title: '' }, opts || {});
    host.textContent = '';
    const W = opts.width, H = opts.height, left = 46, right = 16, top = 16, bottom = 58;
    const svg = LAB.svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.ariaLabel || '' }, host);
    const y = v => top + (1 - v) * (H - top - bottom);
    const cats = opts.cats || [['m n l', 'sonorants'], ['b d g', 'voiced stops'], ['p t k', 'voiceless stops']];
    const x = i => left + (i + 0.5) * (W - left - right) / cats.length;
    [0, 0.25, 0.5, 0.75, 1].forEach(v => {
      LAB.svg('line', { class: v === 0.5 ? 'chance' : 'grid', x1: left, x2: W - right, y1: y(v), y2: y(v) }, svg);
      LAB.text(svg, left - 8, y(v) + 4, Math.round(v * 100) + '%', { 'text-anchor': 'end' });
    });
    LAB.text(svg, W - right, y(0.5) - 6, 'chance', { 'text-anchor': 'end' });
    cats.forEach((c, i) => {
      LAB.text(svg, x(i), H - bottom + 20, c[0], { 'text-anchor': 'middle', class: 'label-strong' });
      LAB.text(svg, x(i), H - bottom + 37, c[1], { 'text-anchor': 'middle' });
    });
    const series = [['a', s.a, s.aCI], ['b', s.b, s.bCI]];
    series.forEach(([k, vals, ci], si) => {
      const off = (si ? 1 : -1) * 5;
      const pts = vals.map((v, i) => isFinite(v) ? [x(i) + off, y(v)] : null);
      const dPath = pts.filter(Boolean).map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ');
      if (dPath) LAB.svg('path', { class: 'line-' + k, d: dPath }, svg);
      if (ci) ci.forEach((c, i) => {
        if (c && isFinite(c[0])) LAB.svg('line', { class: 'whisker series-' + k, x1: x(i) + off, x2: x(i) + off, y1: y(Math.min(1, c[1])), y2: y(Math.max(0, c[0])) }, svg);
      });
      pts.forEach(p => { if (p) LAB.svg('circle', { class: 'series-' + k, cx: p[0], cy: p[1], r: 5, 'stroke-width': 2 }, svg); });
    });
    return svg;
  };

  /* ---------- simple regression ---------- */
  /* Ordinary least squares y = a + b·x, with the slope's 95% CI and a helper
     for the 95% CI of the fitted line at any x. */
  LAB.ols = function (xs, ys) {
    const n = xs.length;
    if (n < 3) return null;
    const mx = LAB.mean(xs), my = LAB.mean(ys);
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      sxx += (xs[i] - mx) * (xs[i] - mx); sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) * (ys[i] - my);
    }
    if (sxx === 0) return null;
    const b = sxy / sxx, a = my - b * mx, df = n - 2;
    const sse = Math.max(0, syy - b * sxy), s = Math.sqrt(sse / df);
    const seB = s / Math.sqrt(sxx), t = LAB.t975(df);
    return {
      n, a, b, df, seB, mx, sxx,
      r: syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN,
      ciB: [b - t * seB, b + t * seB],
      at: x => a + b * x,
      band: x => t * s * Math.sqrt(1 / n + (x - mx) * (x - mx) / sxx)
    };
  };

  /* Scatter plot with an optional fitted line (+ 95% band) and a dashed
     horizontal reference line (e.g. the other group's mean). */
  LAB.scatterPlot = function (host, o) {
    o = Object.assign({ width: 380, height: 280, r: 4.5 }, o);
    host.textContent = '';
    const W = o.width, H = o.height, left = 50, right = 14, top = 14, bottom = 46;
    const [x0, x1] = o.xDomain, [y0, y1] = o.yDomain;
    const X = v => left + (v - x0) / (x1 - x0) * (W - left - right);
    const Y = v => top + (1 - (v - y0) / (y1 - y0)) * (H - top - bottom);
    const svg = LAB.svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.ariaLabel || '' }, host);
    const yStep = o.yStep || niceStep(y1 - y0, 4);
    for (let v = y0; v <= y1 + 1e-9; v += yStep) {
      LAB.svg('line', { class: 'grid', x1: left, x2: W - right, y1: Y(v), y2: Y(v) }, svg);
      LAB.text(svg, left - 8, Y(v) + 4, o.yFmt ? o.yFmt(v) : String(+v.toFixed(2)), { 'text-anchor': 'end' });
    }
    for (let v = x0; v <= x1 + 1e-9; v += (o.xStep || 1)) {
      LAB.svg('line', { class: 'grid', x1: X(v), x2: X(v), y1: top, y2: H - bottom }, svg);
      LAB.text(svg, X(v), H - bottom + 17, String(v), { 'text-anchor': 'middle' });
    }
    if (o.xLabel) LAB.text(svg, (left + W - right) / 2, H - 6, o.xLabel, { 'text-anchor': 'middle', class: 'label-strong' });
    if (o.ref && isFinite(o.ref.value)) {
      LAB.svg('line', { class: 'chance', x1: left, x2: W - right, y1: Y(o.ref.value), y2: Y(o.ref.value) }, svg);
    }
    const f = o.fit;
    if (f) {
      const xs = o.points.map(p => p.x), lo = Math.min(...xs), hi = Math.max(...xs);
      if (hi > lo) {
        const steps = 24, up = [], dn = [];
        for (let i = 0; i <= steps; i++) {
          const x = lo + (hi - lo) * i / steps, yv = f.at(x), h = f.band(x);
          up.push([X(x), Y(Math.min(y1, yv + h))]); dn.unshift([X(x), Y(Math.max(y0, yv - h))]);
        }
        LAB.svg('path', { class: 'ci', d: 'M' + up.concat(dn).map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L') + 'Z' }, svg);
        LAB.svg('line', { class: 'mean', x1: X(lo), x2: X(hi), y1: Y(Math.max(y0, Math.min(y1, f.at(lo)))), y2: Y(Math.max(y0, Math.min(y1, f.at(hi)))) }, svg);
      }
    }
    o.points.forEach((p, i) => {
      const c = LAB.svg('circle', { class: 'dot', cx: X(p.x), cy: Y(p.y), r: o.r }, svg);
      c.style.setProperty('--i', i);
    });
    // Reference label last, so nothing covers it; above the line unless that
    // would leave the plot.
    if (o.ref && isFinite(o.ref.value)) {
      const yr = Y(o.ref.value), above = yr - 6 > top + 10;
      LAB.text(svg, left + 6, above ? yr - 6 : yr + 14, o.ref.label, { class: 'ref-label' });
    }
    return svg;
  };

  /* ---------- self-rated English proficiency, 1–7 per skill ---------- */
  LAB.PROF_SKILLS = ['reading', 'listening', 'writing', 'speaking', 'overall'];
  const PROF_TEXT = {
    en: {
      q: 'How would you rate your English?', lo: 'very limited', hi: 'native-like', to: 'to',
      skills: { reading: 'Reading', listening: 'Listening', writing: 'Writing', speaking: 'Speaking', overall: 'Overall' },
      missing: 'Please rate all five.'
    },
    zh: {
      q: '请评价你的英语水平。', lo: '非常有限', hi: '接近母语', to: '至',
      skills: { reading: '阅读', listening: '听力', writing: '写作', speaking: '口语', overall: '总体' },
      missing: '请完成全部五项评分。'
    }
  };
  LAB.proficiency = function (host, lang) {
    const t = PROF_TEXT[lang] || PROF_TEXT.en;
    const saved = LAB.store.get('proficiency', {}) || {};
    const scale = v => [1, 2, 3, 4, 5, 6, 7].map(n =>
      `<label class="choice"><input type="radio" name="eng_${v}" value="${n}"${String(saved[v]) === String(n) ? ' checked' : ''} aria-label="${t.skills[v]} ${n}"><span>${n}</span></label>`).join('');
    host.innerHTML =
      `<fieldset class="prof"><legend>${t.q}</legend>` +
      `<div class="prof-ends" aria-hidden="true"><span>1 = ${t.lo}</span><span>7 = ${t.hi}</span></div>` +
      LAB.PROF_SKILLS.map(v =>
        `<div class="prof-row" role="radiogroup" aria-label="${t.skills[v]}, 1 ${t.lo} ${t.to} 7 ${t.hi}">` +
        `<span class="prof-skill">${t.skills[v]}</span><div class="choices cols-7">${scale(v)}</div></div>`).join('') +
      `</fieldset>`;
    return {
      missingText: t.missing,
      /* Returns the five ratings, or null (and focuses the first gap) if any is missing. */
      read() {
        const out = {};
        for (const v of LAB.PROF_SKILLS) {
          const r = host.querySelector(`input[name="eng_${v}"]:checked`);
          if (!r) { host.querySelector(`input[name="eng_${v}"]`).focus(); return null; }
          out[v] = Number(r.value);
        }
        LAB.store.set('proficiency', out);
        return out;
      },
      /* Flat fields for the data: eng_reading … eng_overall, eng_mean. */
      fields(vals) {
        const f = {};
        LAB.PROF_SKILLS.forEach(v => { f['eng_' + v] = vals[v]; });
        f.eng_mean = LAB.round(LAB.mean(LAB.PROF_SKILLS.map(v => vals[v])), 2);
        return f;
      }
    };
  };

  window.LAB = LAB;
})();
