/* LT5461 — colour task analysis, shared by the task page (the student's own
   results) and the results page (the class).

   For each student: a colour's stable label is its normalised name when both
   namings agree (otherwise it is uncertain). A discrimination trial is
   within-category when the reference and the other colour have the same
   stable label, between-category when both are stable but different, and
   ambiguous otherwise (left out of the comparison, kept in the data).
   RT measures: correct responses, not timed out, at least 200 ms. The
   category advantage = median RT (same label) − median RT (different labels);
   it is computed only with at least 8 such trials in each condition.
   Class: the mean and median advantage over students with enough data;
   pooled RTs = the mean of those students' condition medians. Exploratory
   model (results page only): log RT ~ between + separation + trial + (1 |
   student) + (1 | pair), REML with Satterthwaite df (FAST_ANALYSIS.lmm).
   Exposes window.COLOUR. */
(function () {
  'use strict';
  const K = window.COLOUR_CORE, STIM = K.STIM;
  const MIN_VALID = 8, MIN_RT = 200, CLEAR = 30;
  const mean = a => { const v = a.filter(isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };
  const median = a => { const v = a.filter(isFinite).sort((x, y) => x - y); if (!v.length) return NaN; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const enc36 = v => (isFinite(v) ? Math.round(Math.max(0, v)).toString(36) : '');
  const dec36 = s => (s === '' || s === undefined ? NaN : parseInt(s, 36));
  const clean = s => String(s || '').replace(/[|:;\n\r]/g, ' ').trim().slice(0, 16);

  /* ---------- storage: the packed summary fields ----------
     nm1–nm4: naming, in order: colour index (0–13, base 36) : pass : text : RT (base 36)
     pr: practice, d1–d4: main trials, in order: trial id (M01–M60 / P1–P8) : match side L/R : response 1/2/0 : RT (base 36) : k(eyboard)/m(ouse) */
  function pack(vals, n) {
    const out = new Array(n).fill(''); let k = 0;
    for (const v of vals) { const s = (out[k] ? '|' : '') + v; if (out[k].length + s.length > 200) { if (++k >= n) break; out[k] = v; } else out[k] += s; }
    return out;
  }
  const join = (r, base, n) => Array.from({ length: n }, (_, i) => String(r[base + (i + 1)] ?? '')).filter(Boolean).join('|');
  function packFields(P) {
    const f = {};
    pack(P.naming.map(t => `${t.i.toString(36)}:${t.pass}:${clean(t.raw)}:${enc36(t.rt)}`), 4).forEach((s, i) => { f['nm' + (i + 1)] = s; });
    f.pr = pack(P.practice.map(t => `${t.tid}:${t.match}:${t.resp || 0}:${enc36(t.rt)}:${t.mod || ''}`), 1)[0];
    pack(P.main.map(t => `${t.tid.slice(1)}:${t.match}:${t.resp || 0}:${enc36(t.rt)}:${t.mod || ''}`), 4).forEach((s, i) => { f['d' + (i + 1)] = s; });
    return f;
  }
  const BY_TID = new Map(K.MAIN.map(t => [t.tid, t]).concat(K.PRACTICE.map(t => [t.tid, t])));
  function trialFrom(code, k) {
    const [id, match, resp, rt, mod] = code.split(':'), tid = /^P/.test(id) ? id : 'M' + id.padStart(2, '0'), T = BY_TID.get(tid);
    if (!T) return null;
    return Object.assign({}, T, { trial: k + 1, match, resp: resp === '0' ? null : resp, rt: dec36(rt), mod: mod || '' });
  }
  function parseRow(r) {
    const nm = join(r, 'nm', 4), d = join(r, 'd', 4), pr = String(r.pr || '');
    return {
      pid: String(r.pid), source: 'server', simulated: String(r.simulated) === '1', startedAt: r.started_at, submittedAt: r.submitted_at,
      meta: { mandarin: r.mandarin || '', script: r.script || '', vision: r.colour_vision || '', input: r.input || '', durationMs: Number(r.duration_ms) },
      naming: nm ? nm.split('|').map((c, k) => { const [i, pass, raw, rt] = c.split(':'); return { trial: k + 1, i: parseInt(i, 36), pass: Number(pass), raw: raw || '', rt: dec36(rt) }; }) : [],
      practice: pr ? pr.split('|').map(trialFrom).filter(Boolean) : [],
      main: d ? d.split('|').map(trialFrom).filter(Boolean) : []
    };
  }

  /* ---------- one student ---------- */
  function analyse(P) {
    const lab = STIM.map((s, i) => {
      const n = P.naming.filter(t => t.i === i), a = n.find(t => t.pass === 1), b = n.find(t => t.pass === 2);
      const na = a ? K.normalise(a.raw) : '', nb = b ? K.normalise(b.raw) : '';
      const stable = na && na === nb ? na : null;
      return { i, id: s.id, hex: s.hex, raw: [a ? a.raw : '', b ? b.raw : ''], norm: [na, nb], stable, group: stable ? K.group(stable) : 'uncertain' };
    });
    const trials = P.main.map(t => {
      const A = lab[t.ref].stable, B = lab[t.dist].stable;
      const cat = A && B ? (A === B ? 'within' : 'between') : 'ambiguous';
      const correct = t.resp !== null && ((t.resp === '1') === (t.match === 'L'));
      const timeout = t.resp === null;
      return Object.assign({}, t, { cat, correct, timeout, valid: correct && !timeout && t.rt >= MIN_RT, labels: [A || '', B || ''] });
    });
    const cond = c => { const T = trials.filter(t => t.cat === c), V = T.filter(t => t.valid);
      return { n: T.length, correct: T.filter(t => t.correct).length, timeouts: T.filter(t => t.timeout).length, fast: T.filter(t => t.correct && !t.timeout && t.rt < MIN_RT).length,
        valid: V.length, median: median(V.map(t => t.rt)), acc: T.length ? T.filter(t => t.correct).length / T.length : NaN,
        bySteps: { 2: T.filter(t => t.steps === 2).length, 3: T.filter(t => t.steps === 3).length } }; };
    const W = cond('within'), B = cond('between'), A = cond('ambiguous');
    const enough = W.valid >= MIN_VALID && B.valid >= MIN_VALID;
    const adv = enough ? W.median - B.median : NaN;
    const consistency = lab.filter(l => l.norm[0] && l.norm[0] === l.norm[1]).length / STIM.length;
    const cats = new Set(lab.filter(l => l.stable).map(l => l.stable));
    const boundaries = lab.slice(0, -1).map((l, i) => (l.stable && lab[i + 1].stable ? (l.stable !== lab[i + 1].stable ? 'change' : 'same') : 'unknown'));
    return Object.assign(P, { lab, trials, within: W, between: B, ambiguous: A, enough, adv, consistency, nCats: cats.size, boundaries,
      accuracy: trials.length ? trials.filter(t => t.correct).length / trials.length : NaN, complete: P.naming.length === 28 && P.main.length === 60,
      verdict: !enough ? 'insufficient' : adv >= CLEAR ? 'positive' : adv <= -CLEAR ? 'negative' : 'small' });
  }

  /* ---------- the class ---------- */
  function classStats(parts, starts) {
    parts.forEach(analyse);
    const ok = parts.filter(p => p.enough), adv = ok.map(p => p.adv);
    const startPids = new Set((starts || []).map(r => String(r.pid))); parts.filter(p => p.source !== 'demo').forEach(p => startPids.add(p.pid));
    const pool = c => ({ rt: mean(ok.map(p => p[c].median)), medOfMed: median(ok.map(p => p[c].median)), correct: parts.reduce((s, p) => s + p[c].correct, 0), n: parts.reduce((s, p) => s + p[c].n, 0), valid: ok.reduce((s, p) => s + p[c].valid, 0) });
    const naming = STIM.map((s, i) => { const g = { 青: 0, 蓝: 0, 绿: 0, other: 0, uncertain: 0 }; parts.forEach(p => { g[p.lab[i].group === 'none' ? 'uncertain' : p.lab[i].group]++; }); return g; });
    const gaps = STIM.slice(0, -1).map((_, i) => { const known = parts.filter(p => p.boundaries[i] !== 'unknown'); return { change: known.filter(p => p.boundaries[i] === 'change').length, known: known.length }; });
    const qingUsers = parts.filter(p => p.naming.some(t => K.normalise(t.raw) === '青')).length, qingAny = parts.filter(p => p.naming.some(t => K.normalise(t.raw).includes('青'))).length;
    const qingByColour = STIM.map((s, i) => parts.reduce((n, p) => n + p.naming.filter(t => t.i === i && K.normalise(t.raw) === '青').length, 0));
    const allMain = parts.flatMap(p => p.trials);
    return { parts, ok, started: startPids.size, completed: parts.filter(p => p.complete).length, enough: ok.length,
      accuracy: allMain.length ? allMain.filter(t => t.correct).length / allMain.length : NaN,
      advMean: mean(adv), advMedian: median(adv), positive: adv.filter(v => v > 0).length, within: pool('within'), between: pool('between'),
      bins: [['≤ 0', v => v <= 0], ['0–20', v => v > 0 && v <= 20], ['20–40', v => v > 20 && v <= 40], ['40–60', v => v > 40 && v <= 60], ['> 60', v => v > 60]].map(([lab, f]) => ({ lab, who: ok.filter(p => f(p.adv)) })),
      naming, gaps, qingUsers, qingAny, qingByColour, consistencyMean: mean(parts.map(p => p.consistency)), consistencyMedian: median(parts.map(p => p.consistency)) };
  }
  function model(C) {
    const A = window.FAST_ANALYSIS;
    if (!A || !A.lmm) return { ok: false, reason: 'the model code is not loaded' };
    const obs = C.parts.flatMap(p => p.trials.filter(t => t.valid && t.cat !== 'ambiguous').map(t => ({ pid: p.pid, pair: t.pair, between: t.cat === 'between' ? 0.5 : -0.5, steps: t.steps === 3 ? 0.5 : -0.5, trial: (t.trial - 30.5) / 60, y: Math.log(t.rt) })));
    const nB = obs.filter(o => o.between > 0).length, nW = obs.length - nB, nP = new Set(obs.map(o => o.pid)).size;
    if (nP < 6 || nB < 30 || nW < 30) return { ok: false, reason: `too little data (${nP} students, ${nW} same-label and ${nB} different-label trials; the model needs at least 6 students and 30 of each)` };
    const D = A.design(obs, [['(Intercept)', () => 1], ['Different labels (vs same)', o => o.between], ['Three steps (vs two)', o => o.steps], ['Trial (per 60 trials)', o => o.trial]], o => o.y, [['Pair', o => o.pair], ['Student', o => o.pid]]);
    const f = A.lmm(D);
    if (!f || !f.ok) return { ok: false, reason: 'the model did not converge' };
    const coef = ['Different labels (vs same)', 'Three steps (vs two)', 'Trial (per 60 trials)'].map(n => Object.assign({ name: n }, f.coefOf(n)));
    return { ok: true, n: obs.length, nP, nPairs: f.nLevels[0], coef, sd: f.sd, sigma: f.sigma, converged: f.converged };
  }

  /* ---------- simulated class (demo only; never stored) ---------- */
  function simulate(n, seed) {
    let s = seed || 7; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
    const parts = [];
    for (let k = 0; k < n; k++) {
      const edge = 6.5 + gauss() * 1.6, qing = r() < 0.35, qw = 1 + Math.floor(r() * 3), odd = r() < 0.15, shaky = 0.08 + r() * 0.25;
      const name = i => { const d = i - edge;
        if (qing && Math.abs(d) < qw / 2 + 0.5) return r() < 0.8 ? '青' : '青色';
        if (odd && Math.abs(d) < 1.5) return r() < 0.5 ? '蓝绿色' : '湖蓝';
        if (Math.abs(d) < 1.2 && r() < shaky) return d < 0 ? '蓝' : '绿';
        return d < 0 ? (r() < 0.7 ? '绿' : '绿色') : (r() < 0.7 ? '蓝' : '蓝色'); };
      const order = K.namingOrder(r), naming = order.map((o, t) => ({ trial: t + 1, i: o.i, pass: o.pass, raw: name(o.i), rt: Math.round(2500 + r() * 4000) }));
      const base = 560 * Math.exp(gauss() * 0.15), effect = 25 + gauss() * 45, stableAt = i => { const a = naming.find(x => x.i === i && x.pass === 1), b = naming.find(x => x.i === i && x.pass === 2); const na = K.normalise(a.raw); return na === K.normalise(b.raw) ? na : null; };
      const main = K.withSides(K.MAIN, r).map((t, j) => { const A = stableAt(t.ref), B = stableAt(t.dist), between = A && B && A !== B;
        const acc = t.steps === 2 ? 0.93 : 0.97, correct = r() < acc, timeout = r() < 0.01;
        const rt = timeout ? NaN : Math.round(Math.max(220, base * Math.exp(gauss() * 0.2) * (t.steps === 2 ? 1.07 : 1) * (1 - 0.0015 * j) - (between ? effect : 0)));
        return Object.assign({}, t, { trial: j + 1, resp: timeout ? null : (correct === (t.match === 'L') ? '1' : '2'), rt, mod: 'k' }); });
      const practice = K.withSides(K.PRACTICE, r).map((t, j) => Object.assign({}, t, { trial: j + 1, resp: t.match === 'L' ? '1' : '2', rt: 700, mod: 'k' }));
      parts.push({ pid: `SIM-${String(k + 1).padStart(2, '0')}`, source: 'demo', simulated: true, meta: { mandarin: k % 9 ? 'first' : 'additional', script: 'simplified', vision: '', input: 'keyboard', durationMs: 480000 + r() * 120000 }, naming, practice, main });
    }
    return parts;
  }

  /* ---------- charts (shared by both pages) ---------- */
  const NS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v)); if (parent) parent.appendChild(e); return e; };
  const txt = (parent, x, y, s, attrs) => { const t = svg('text', Object.assign({ x, y }, attrs || {}), parent); t.textContent = s; return t; };
  const title = (el, s) => { svg('title', {}, el).textContent = s; return el; };
  const GROUP_LABEL = { 青: '青', 蓝: '蓝', 绿: '绿', other: 'Other', uncertain: '?' };

  // Section 1: the 14 patches with this student's labels; lines between patches where the stable label changes.
  function continuum(P) {
    const cell = l => {
      const show = l.stable ? (K.BASIC.has(l.stable) ? l.stable : l.stable) : '?';
      const tip = l.stable ? `${l.id}: “${l.raw[0]}” both times` : `${l.id}: “${l.raw[0] || '—'}”, then “${l.raw[1] || '—'}”`;
      return `<li class="cl-cell" title="${esc(tip)}"><span class="cl-sw" style="background:${l.hex}"></span><span class="cl-lab ${l.stable ? 'g-' + (K.BASIC.has(l.stable) ? l.stable : 'other') : 'g-uncertain'}" lang="zh-Hans">${esc(show)}</span></li>`;
    };
    const marks = P.boundaries.map((b, i) => `<li class="cl-gap ${b}" aria-hidden="true" title="${b === 'change' ? 'Your label changes here' : b === 'same' ? '' : 'Uncertain'}"></li>`);
    return `<ol class="cl-row" aria-label="Your names for the 14 colours, from green to blue">${P.lab.map((l, i) => cell(l) + (i < marks.length ? marks[i] : '')).join('')}</ol>` +
      `<p class="cl-legend"><span><i class="cl-mark change"></i>your label changes</span><span><b class="g-uncertain">?</b> you named it differently the two times</span><span class="muted">Hover or tap a colour to see what you typed.</span></p>`;
  }

  // Section 2: two horizontal bars, median RT with the same label (grey) and with different labels (teal).
  function rtBars(host, W_, B_, o) {
    host.textContent = '';
    const w = Math.max(280, Math.min(620, Math.round(host.getBoundingClientRect().width) || (document.documentElement.clientWidth - 90) || 620)), left = w < 420 ? 112 : 150, right = 72, rowH = 46, top = 8, H = top + rowH * 2 + 34;
    const s = svg('svg', { class: 'chart fc cl-bars', viewBox: `0 0 ${w} ${H}`, style: `max-width:${w}px`, role: 'img', 'aria-label': `Median reaction time: same label ${isFinite(W_) ? Math.round(W_) : 'not available'} ms, different labels ${isFinite(B_) ? Math.round(B_) : 'not available'} ms` }, host);
    const mx = Math.max(800, ...[W_, B_].filter(isFinite)) * 1.05, X = v => left + v / mx * (w - left - right);
    const step = mx > 1500 ? 500 : w < 360 ? 400 : 200;
    for (let v = 0; v <= mx; v += step) { svg('line', { class: 'grid', x1: X(v), x2: X(v), y1: top, y2: top + rowH * 2 }, s); txt(s, X(v), H - 14, String(v), { 'text-anchor': 'middle' }); }
    txt(s, (left + w - right) / 2, H - 0, 'Median reaction time (ms)', { 'text-anchor': 'middle', class: 'axis-title' });
    [[o && o.labels ? o.labels[0] : 'Same label', W_, 'cl-same'], [o && o.labels ? o.labels[1] : 'Different labels', B_, 'cl-diff']].forEach(([lab, v, cls], j) => {
      const y = top + j * rowH + 8;
      txt(s, 0, y + 19, lab, { class: 'label-strong' });
      if (!isFinite(v)) { txt(s, left + 6, y + 19, 'not enough trials', { class: 'muted-text' }); return; }
      title(svg('rect', { x: left, y, width: Math.max(1, X(v) - left), height: 28, rx: 3, class: cls }, s), `${lab}: ${Math.round(v)} ms`);
      txt(s, X(v) + 8, y + 19, `${Math.round(v)} ms`, { class: 'value-label' });
    });
  }

  /* The student's results, as on the task page (instructor: the same layout, opened from the class table). */
  function personal(P, o) {
    o = o || {};
    const W = P.within, B = P.between, pc = v => (isFinite(v) ? Math.round(v * 100) + '%' : '–');
    const advTxt = P.enough ? `${P.adv > 0 ? '+' : P.adv < 0 ? '−' : '±'}${Math.abs(Math.round(P.adv))} ms` : '—';
    const words = {
      positive: 'You responded faster when the two colours received different names. This is consistent with the possibility that your colour categories facilitated discrimination.',
      small: 'Your reaction times were similar across the two conditions. We did not observe a clear category advantage in your responses.',
      negative: 'You responded more slowly when the two colours received different names. Your results do not show the predicted categorical advantage.',
      insufficient: `There were not enough usable trials to compare the two conditions reliably: the comparison needs at least ${MIN_VALID} correct responses in each, and you had ${W.valid} with the same label and ${B.valid} with different labels.` +
        (B.n < MIN_VALID ? ' You gave most neighbouring colours the same name, so few pairs had different labels.' : '') +
        (P.ambiguous.n > 20 ? ` ${P.ambiguous.n} of the 60 pairs involved a colour you named differently the two times; those pairs cannot be classified.` : '')
    };
    return `<section class="cl-panel"><h2>Your colour categories</h2>${continuum(P)}
        <p class="cl-small">You used ${P.nCats} stable name${P.nCats === 1 ? '' : 's'} and gave the same name both times to ${Math.round(P.consistency * 14)} of the 14 colours.</p></section>
      <section class="cl-panel"><h2>How quickly did you respond?</h2>
        <div class="cl-rt"><div class="cl-rt-chart" data-rt></div>
          <div class="cl-adv${P.enough ? '' : ' none'}"><span class="cl-adv-label">Category advantage</span><span class="cl-adv-value">${P.enough ? advTxt : 'Insufficient data'}</span>
            <span class="cl-adv-note">${P.enough ? 'same-label median − different-label median; positive = faster when the labels differed' : 'for a reliable comparison'}</span></div></div>
        <div class="table-wrap cl-table-wrap"><table class="data cl-table"><thead><tr><th scope="col"></th><th class="num" scope="col">Same label</th><th class="num" scope="col">Different labels</th><th class="num" scope="col">Un&shy;classified</th></tr></thead><tbody>
          <tr><th scope="row">Trials</th><td class="num">${W.n}</td><td class="num">${B.n}</td><td class="num">${P.ambiguous.n}</td></tr>
          <tr><th scope="row">Accuracy</th><td class="num">${pc(W.acc)}</td><td class="num">${pc(B.acc)}</td><td class="num">${pc(P.ambiguous.acc)}</td></tr>
          <tr><th scope="row">Correct trials used for RT</th><td class="num">${W.valid}</td><td class="num">${B.valid}</td><td class="num">–</td></tr>
          <tr><th scope="row">Two / three steps apart</th><td class="num">${W.bySteps[2]} / ${W.bySteps[3]}</td><td class="num">${B.bySteps[2]} / ${B.bySteps[3]}</td><td class="num">${P.ambiguous.bySteps[2]} / ${P.ambiguous.bySteps[3]}</td></tr>
        </tbody></table></div>
        <p class="cl-small">Overall accuracy ${pc(P.accuracy)} on ${P.trials.length} of 60 trials. Only correct responses between ${MIN_RT} ms and the 3-second limit count for the reaction times; timeouts and errors are left out.${W.n && B.n && Math.abs(W.bySteps[3] / W.n - B.bySteps[3] / B.n) > 0.2 ? ' Note that your two conditions contain different shares of the easier three-step pairs, which alone can change the reaction times.' : ''}</p></section>
      <section class="cl-panel"><h2>What do your results suggest?</h2><p>${words[P.verdict]}</p>
        ${P.verdict === 'positive' || P.verdict === 'negative' ? `<p class="cl-small">“Clear” here means a difference of at least ${CLEAR} ms either way. A single person’s ${W.valid + B.valid} trials are not enough to tell a real difference from chance.</p>` : ''}</section>`;
  }
  function mountPersonal(host, P, o) {
    host.innerHTML = personal(P, o) + (o && o.extra ? o.extra : '');
    const c = host.querySelector('[data-rt]'); if (c) rtBars(c, P.within.median, P.between.median);
  }

  /* ---------- class charts ---------- */
  const widthOf = (host, max) => Math.max(300, Math.min(max, Math.round(host.getBoundingClientRect().width) || max));
  // Students per advantage bin; each bar's tooltip lists the students and their exact values.
  function advHist(host, C) {
    host.textContent = '';
    if (!C.ok.length) { host.innerHTML = '<p class="empty">No student has enough usable trials yet.</p>'; return; }
    const W = widthOf(host, 760), H = 260, left = 40, right = 16, top = 16, bottom = 48;
    const s = svg('svg', { class: 'chart fc co', viewBox: `0 0 ${W} ${H}`, style: `max-width:${W}px`, role: 'img', 'aria-label': 'Students by category advantage: ' + C.bins.map(b => `${b.lab} ms: ${b.who.length}`).join(', ') }, host);
    const mx = Math.max(1, ...C.bins.map(b => b.who.length)), bw = (W - left - right) / C.bins.length, Y = v => top + (1 - v / mx) * (H - top - bottom);
    for (let v = 0; v <= mx; v += Math.max(1, Math.ceil(mx / 5))) { svg('line', { class: 'grid', x1: left, x2: W - right, y1: Y(v), y2: Y(v) }, s); txt(s, left - 8, Y(v) + 4, String(v), { 'text-anchor': 'end' }); }
    C.bins.forEach((b, i) => { const x = left + i * bw + 6, g = svg('g', {}, s);
      title(g, `${b.lab} ms: ${b.who.length} student${b.who.length === 1 ? '' : 's'}` + (b.who.length ? ' — ' + b.who.map(p => `${p.label} ${p.adv > 0 ? '+' : ''}${Math.round(p.adv)}`).join(', ') : ''));
      svg('rect', { x, y: Y(b.who.length), width: bw - 12, height: Math.max(0, Y(0) - Y(b.who.length)), rx: 3, class: i === 0 ? 'co-bar0' : 'co-bar' }, g);
      txt(g, x + (bw - 12) / 2, Y(b.who.length) - 6, String(b.who.length), { 'text-anchor': 'middle', class: 'value-label' });
      txt(s, x + (bw - 12) / 2, H - bottom + 18, b.lab + ' ms', { 'text-anchor': 'middle' }); });
    txt(s, (left + W - right) / 2, H - 6, W < 480 ? 'Category advantage (ms)' : 'Category advantage (same-label − different-label median)', { 'text-anchor': 'middle', class: 'axis-title' });
  }
  // For each colour: its patch and a stacked bar of the students' names (stable 青/蓝/绿/other, or uncertain).
  const GROUPS = [['青', 'g-qing', '青'], ['蓝', 'g-lan', '蓝'], ['绿', 'g-lv', '绿'], ['other', 'g-other', 'Other'], ['uncertain', 'g-unc', 'Uncertain']];
  function namesChart(host, C) {
    host.textContent = '';
    const n = C.parts.length; if (!n) { host.innerHTML = '<p class="empty">No runs yet for this class.</p>'; return; }
    const W = widthOf(host, 1000), left = 40, right = 8, top = 8, sw = 22, H = 300, bar = H - top - sw - 50;
    const s = svg('svg', { class: 'chart fc co', viewBox: `0 0 ${W} ${H}`, style: `max-width:${W}px`, role: 'img', 'aria-label': 'Names given to each colour, as shares of students' }, host);
    const cw = (W - left - right) / STIM.length, Y = v => top + sw + 8 + (1 - v) * bar;
    [0, 0.25, 0.5, 0.75, 1].forEach(v => { svg('line', { class: 'grid', x1: left, x2: W - right, y1: Y(v), y2: Y(v) }, s); txt(s, left - 6, Y(v) + 4, Math.round(v * 100) + '%', { 'text-anchor': 'end', class: 'scale-note' }); });
    STIM.forEach((c, i) => {
      const x = left + i * cw + 2, w = cw - 4, d = C.naming[i]; let acc = 0;
      svg('rect', { x, y: top, width: w, height: sw, rx: 3, fill: c.hex }, s);
      GROUPS.forEach(([k, cls, lab]) => { const v = d[k] / n; if (!v) return; const g = svg('g', {}, s);
        title(g, `${c.id}: ${lab} ${d[k]} of ${n} (${Math.round(v * 100)}%)`);
        svg('rect', { x, y: Y(acc + v), width: w, height: Y(acc) - Y(acc + v), class: cls }, g); acc += v; });
      txt(s, x + w / 2, H - 30, c.id.slice(1), { 'text-anchor': 'middle', class: 'scale-note' });
    });
    txt(s, (left + W - right) / 2, H - 8, 'Colour (C01 green → C14 blue)', { 'text-anchor': 'middle', class: 'axis-title' });
    host.insertAdjacentHTML('beforeend', `<p class="co-key">${GROUPS.map(([, cls, lab]) => `<span><i class="${cls}"></i>${lab}</span>`).join('')}</p>`);
  }
  // Share of students whose names change between each pair of neighbouring colours.
  function gapsChart(host, C) {
    host.textContent = '';
    if (!C.parts.length) return;
    const W = widthOf(host, 1000), left = 40, right = 8, top = 10, H = 170, bottom = 34;
    const s = svg('svg', { class: 'chart fc co', viewBox: `0 0 ${W} ${H}`, style: `max-width:${W}px`, role: 'img', 'aria-label': 'Where students’ names change between neighbouring colours' }, host);
    const cw = (W - left - right) / STIM.length, Y = v => top + (1 - v) * (H - top - bottom);
    [0, 0.5, 1].forEach(v => { svg('line', { class: 'grid', x1: left, x2: W - right, y1: Y(v), y2: Y(v) }, s); txt(s, left - 6, Y(v) + 4, Math.round(v * 100) + '%', { 'text-anchor': 'end', class: 'scale-note' }); });
    C.gaps.forEach((g, i) => { const v = g.known ? g.change / g.known : 0, cx = left + (i + 1) * cw, el = svg('g', {}, s);
      title(el, `Between ${STIM[i].id} and ${STIM[i + 1].id}: ${g.change} of ${g.known} students with a stable name for both change name here`);
      svg('rect', { x: cx - cw * 0.3, y: Y(v), width: cw * 0.6, height: Y(0) - Y(v), rx: 2, class: 'co-bar' }, el);
      if (v > 0) txt(el, cx, Y(v) - 4, Math.round(v * 100) + '%', { 'text-anchor': 'middle', class: 'scale-note' });
      txt(s, cx, H - bottom + 16, `${i + 1}|${i + 2}`, { 'text-anchor': 'middle', class: 'scale-note' }); });
  }

  /* ---------- exports ---------- */
  const NA = v => (v === null || v === undefined || v === '' || (typeof v === 'number' && !isFinite(v)) ? 'NA' : v);
  const namingRows = parts => parts.flatMap(p => p.naming.map(t => ({ participant: p.label, pid: p.pid, source: p.source, trial: t.trial, colour_id: STIM[t.i].id, colour_hex: STIM[t.i].hex, colour_oklch: STIM[t.i].oklch,
    presentation: t.pass, response_raw: t.raw, response_normalised: NA(K.normalise(t.raw)), response_group: K.group(K.normalise(t.raw)), rt_ms: NA(Math.round(t.rt)),
    stable_label: NA(p.lab ? p.lab[t.i].stable : ''), consistent: p.lab ? (p.lab[t.i].stable ? 1 : 0) : 'NA' })));
  const discRows = parts => parts.flatMap(p => (p.trials || p.main).map(t => ({ participant: p.label, pid: p.pid, source: p.source, trial: t.trial, trial_id: t.tid, pair_id: t.pair,
    reference_id: STIM[t.ref].id, reference_hex: STIM[t.ref].hex, distractor_id: STIM[t.dist].id, distractor_hex: STIM[t.dist].hex, steps: t.steps, ciede2000: t.de,
    match_side: t.match === 'L' ? 'left' : 'right', response: t.resp === '1' ? 'left' : t.resp === '2' ? 'right' : 'timeout', correct: t.correct ? 1 : 0, rt_ms: NA(Math.round(t.rt)), modality: t.mod === 'm' ? 'mouse' : t.mod === 'k' ? 'keyboard' : 'NA',
    reference_label: NA(t.labels && t.labels[0]), distractor_label: NA(t.labels && t.labels[1]), category: t.cat || 'NA', used_for_rt: t.valid && t.cat !== 'ambiguous' ? 1 : 0 })));
  const summaryRows = parts => parts.map(p => ({ participant: p.label, pid: p.pid, source: p.source, complete: p.complete ? 1 : 0, mandarin: NA(p.meta.mandarin), script: NA(p.meta.script), colour_vision: NA(p.meta.vision),
    duration_s: NA(isFinite(p.meta.durationMs) ? Math.round(p.meta.durationMs / 1000) : NaN), naming_consistency: NA(LAB.round(p.consistency, 3)), stable_categories: p.nCats,
    labels: p.lab.map(l => l.stable || '?').join(' '), accuracy: NA(LAB.round(p.accuracy, 3)),
    within_trials: p.within.n, within_valid: p.within.valid, within_median_rt: NA(Math.round(p.within.median)), within_accuracy: NA(LAB.round(p.within.acc, 3)),
    between_trials: p.between.n, between_valid: p.between.valid, between_median_rt: NA(Math.round(p.between.median)), between_accuracy: NA(LAB.round(p.between.acc, 3)),
    ambiguous_trials: p.ambiguous.n, enough_data: p.enough ? 1 : 0, category_advantage_ms: NA(Math.round(p.adv)) }));
  const CODEBOOK = `Colour task (LT5461) - codebook

Stimuli: 14 colours C01-C14, OKLCH L 0.70, C 0.10, hue 160-264 deg in 8-deg steps (green to blue), fixed for everyone; hex values in the files.
Naming (28 trials): each colour twice in two shuffled passes.
  presentation 1/2; response_raw as typed; response_normalised: spaces and punctuation removed, 藍→蓝, 綠→绿, final 色/的/颜色 removed;
  response_group: 青, 蓝, 绿, other (any other word, kept separately, e.g. 蓝绿), none.
  stable_label: the normalised name when both presentations agree, NA otherwise (uncertain).
Discrimination (60 trials, same comparisons for everyone): pairs 2 steps apart (30) and 3 steps apart (30); ciede2000 = colour difference of the pair.
  match_side: where the square identical to the reference was; response left/right/timeout (3,000 ms limit); rt_ms from the stimuli's onset.
  category: within (same stable label), between (different stable labels), ambiguous (a colour without a stable label) - for that participant.
  used_for_rt: 1 = correct, not a timeout, rt >= 200 ms, and within or between.
Participant summary: within/between_median_rt from used trials; enough_data = at least 8 used trials in each;
  category_advantage_ms = within median - between median (positive: faster when the labels differed), NA without enough data.
Missing values are NA, never 0.`;

  window.COLOUR = { MIN_VALID, MIN_RT, CLEAR, GROUPS, advHist, namesChart, gapsChart, pack, packFields, parseRow, analyse, classStats, model, simulate, continuum, rtBars, personal, mountPersonal, namingRows, discRows, summaryRows, CODEBOOK, mean, median, esc, enc36 };
})();
