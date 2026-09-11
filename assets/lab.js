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
        const res = await fetch(LAB.endpoint(), {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
          redirect: 'follow'
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'rejected');
        box = LAB.store.get('outbox', []).filter(p => p.submissionId !== payload.submissionId);
        LAB.store.set('outbox', box);
        sent++;
      } catch (e) {
        break; // try again later
      }
    }
    return { sent, pending: LAB.store.get('outbox', []).length, offline: false };
  };

  LAB.fetchClass = async function (exp, session) {
    if (!LAB.connected()) return { ok: false, offline: true, rows: [] };
    const url = new URL(LAB.endpoint());
    url.searchParams.set('action', 'summary');
    url.searchParams.set('exp', exp);
    url.searchParams.set('session', session);
    url.searchParams.set('_', Date.now());
    const res = await fetch(url.toString(), { redirect: 'follow' });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'server error');
    return json;
  };

  LAB.fetchSessions = async function () {
    if (!LAB.connected()) return [];
    const url = new URL(LAB.endpoint());
    url.searchParams.set('action', 'sessions');
    url.searchParams.set('_', Date.now());
    const res = await fetch(url.toString(), { redirect: 'follow' });
    const json = await res.json();
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
  LAB.ci95 = a => {
    const n = a.length;
    if (n < 2) return [NaN, NaN];
    const t = n - 1 < T975.length ? T975[n - 1] : 1.96 + 2.4 / (n - 1);
    const h = t * LAB.sd(a) / Math.sqrt(n), m = LAB.mean(a);
    return [m - h, m + h];
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
    let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
    if (opts.domain) { lo = Math.min(lo, opts.domain[0]); hi = Math.max(hi, opts.domain[1]); }
    const step = niceStep(hi - lo || 100, 6);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
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
      LAB.svg('line', { class: v === 0 ? 'zero' : 'grid', x1: x(v), x2: x(v), y1: top, y2: bottom }, svg);
      LAB.text(svg, x(v), bottom + 17, (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v), { 'text-anchor': 'middle' });
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
        LAB.text(svg, lx + (anchor === 'end' ? -7 : 7), cy - row.half + 15, 'mean ' + LAB.signed(m) + ' ' + opts.unit, { class: 'mean-label', 'text-anchor': anchor });
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

  window.LAB = LAB;
})();
