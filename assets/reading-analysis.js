/* LT5461 — reading task results (causal connectives).
   Each student: one stored row (exp reading) with every trial packed into
   t01–t30 (see reading.js); starts come from exp reading_start. Students
   from earlier CSV/JSON files can be imported into this browser (not saved).

   Measures, on critical trials (by connective condition):
     recognition RT — probe RT, correct responses only (by default);
     early / final second-clause reading time — the mean word time over the
     second clause's first three / last three words;
     comprehension accuracy — the questioned critical trials.
   Condition means are means of participant means; the difference is the mean
   within-participant difference (because − none) with a t-based 95% CI over
   participants; error bars in the charts are Cousineau–Morey within-participant
   95% CIs. Model-based (on request): by-participant and by-item paired t-tests
   and a linear mixed model of log RT with the condition (because +½, none −½)
   and crossed random intercepts for participants and items (REML, Satterthwaite
   df: FAST_ANALYSIS.lmm, checked against lme4/lmerTest).
   Exposes window.READ_RESULTS. */
(function () {
  'use strict';
  const R = window.READING;
  const num = v => (v === '' || v === null || v === undefined || v === 'NA') ? NaN : Number(v);
  const mean = a => { const v = a.filter(isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };
  const median = a => { const v = a.filter(isFinite).sort((x, y) => x - y); if (!v.length) return NaN; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
  const sd = a => { const v = a.filter(isFinite); if (v.length < 2) return NaN; const m = mean(v); return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)); };
  const COND = [[1, 'because', 'With “because”'], [0, 'none', 'No connective']];
  const MEAS = [
    { key: 'rec', name: 'Recognition RT', unit: 'ms', what: 'probe response time, correct responses' },
    { key: 'early', name: 'Early second clause', unit: 'ms', what: 'mean reading time of its first three words' },
    { key: 'final', name: 'Final second clause', unit: 'ms', what: 'mean reading time of its last three words' },
    { key: 'comp', name: 'Comprehension accuracy', unit: '%', what: 'questioned critical trials' }
  ];
  const DEFAULTS = { correctOnly: true, probeMin: 200, probeMax: 5000, wordTrim: true, wordMin: 100, wordMax: 3000, focus: true, incomplete: true, lowComp: true, compMin: 60 };
  const NONE = { correctOnly: false, probeMin: 0, probeMax: Infinity, wordTrim: false, wordMin: 0, wordMax: Infinity, focus: false, incomplete: false, lowComp: false, compMin: 0 };

  /* ---------- the stored rows ---------- */
  function parseRow(r, byId) {
    const trials = [];
    for (let k = 1; k <= 30; k++) {
      const v = r['t' + String(k).padStart(2, '0')];
      if (v === undefined || v === null || v === '') continue;
      const f = String(v).split(';'), id = f[0], conn = Number(f[1]) === 1 ? 1 : 0, it = byId.get(id);
      const [s1, s2] = String(f[9] || '').split('/');
      const rt1 = R.dec36(s1), rt2 = R.dec36(s2);
      const ws = it ? R.words(it, conn) : [rt1.map(() => '?'), rt2.map(() => '?')];
      trials.push({ pos: k, id, type: it ? it.type : typeOf(id), conn, probe: it ? it.probe : '', present: it ? it.present : null,
        probeResp: f[2] === 'T', probeRT: num(f[3]), probeCorrect: f[4] === '1', ask: f[5] !== '-' && f[5] !== undefined,
        qResp: f[5] === 'Y', qRT: num(f[6]), qCorrect: f[7] === '1' ? true : f[7] === '0' ? false : null, focus: num(f[8]) || 0, rt1, rt2, w1: ws[0], w2: ws[1] });
    }
    return { pid: String(r.pid), list: r.list, assigned: r.list_assigned, startedAt: r.started_at, submittedAt: r.submitted_at, durationMs: num(r.duration_ms),
      input: r.input, events: r.events || '', source: 'server', simulated: String(r.simulated) === '1', trials, complete: trials.length === 30 };
  }
  const typeOf = id => /^P/i.test(id) ? 'practice' : /^C/i.test(id) ? 'critical' : 'filler';

  /* ---------- importing earlier files (the class's original HTML, or this page's downloads) ---------- */
  const pick = (row, names) => { for (const n of names) if (row[n] !== undefined && row[n] !== '') return row[n]; return ''; };
  const yes = v => /^(true|1|t|y|yes)$/i.test(String(v).trim());
  const known = v => String(v).trim() !== '';
  function readFile(f) { return new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(r.error); r.readAsText(f); }); }
  /* files: FileList. Returns {parts, messages}: every problem is reported; nothing is dropped silently. */
  async function importFiles(files, items, existing) {
    const byId = new Map(items.map(it => [it.id, it])), msgs = [], trialRows = [], wordRows = [], meta = new Map();
    for (const f of files) {
      let text; try { text = await readFile(f); } catch (e) { msgs.push(`${f.name}: could not be read.`); continue; }
      if (/\.json$/i.test(f.name) || /^\s*[{[]/.test(text)) {
        let j; try { j = JSON.parse(text); } catch (e) { msgs.push(`${f.name}: not valid JSON.`); continue; }
        const list = Array.isArray(j) ? j : j.participants ? j.participants : [j];
        list.forEach(p => {
          const id = String(p.participant_id || p.pid || '');
          if (!id) { msgs.push(`${f.name}: a record without participant_id was skipped.`); return; }
          meta.set(id, { list: p.list, durationMs: p.session_duration_sec !== undefined ? num(p.session_duration_sec) * 1000 : num(p.duration_ms), file: f.name });
          (p.trial_rows || p.trials || []).forEach(t => trialRows.push(Object.assign({ participant_id: id, __file: f.name }, t)));
          (p.word_rows || p.words || []).forEach(w => wordRows.push(Object.assign({ participant_id: id, __file: f.name }, w)));
        });
        continue;
      }
      const { head, rows } = R.parseCSV(text);
      const has = n => head.includes(n);
      const pidCol = has('participant_id') || has('pid');
      if (!pidCol) { msgs.push(`${f.name}: no participant_id (or pid) column; not imported.`); continue; }
      if ((has('rt_ms') && (has('word_index'))) ) rows.forEach((r, i) => wordRows.push(Object.assign({ __file: f.name, __row: i + 2 }, r)));
      else if (has('probe_rt_ms') && (has('trial_number') || has('position'))) rows.forEach((r, i) => trialRows.push(Object.assign({ __file: f.name, __row: i + 2 }, r)));
      else msgs.push(`${f.name}: neither a trial-level file (probe_rt_ms, trial_number) nor a word-level file (word_index, rt_ms); not imported.`);
    }
    // trials, by participant and position; duplicates reported and the first kept
    const parts = new Map(), seen = new Set(); let dup = 0, bad = 0;
    trialRows.forEach(r => {
      const id = String(pick(r, ['participant_id', 'pid'])).trim(), pos = num(pick(r, ['trial_number', 'position', 'trial_position'])), item = String(pick(r, ['item_id'])).trim();
      if (!id || !isFinite(pos) || !item) { bad++; msgs.push(`${r.__file}${r.__row ? ' row ' + r.__row : ''}: missing participant, trial number or item; row not used.`); return; }
      const key = id + '|' + pos;
      if (seen.has(key)) { dup++; return; }
      seen.add(key);
      const it = byId.get(item), conn = yes(pick(r, ['connective'])) ? 1 : 0;
      const qr = pick(r, ['question_response']), asked = known(qr) || yes(pick(r, ['question_asked']));
      const t = { pos, id: item, type: pick(r, ['type']) || (it ? it.type : typeOf(item)), conn, probe: pick(r, ['probe_word', 'probe']) || (it ? it.probe : ''),
        present: it ? it.present : yes(pick(r, ['probe_present'])), probeResp: /^(t|true|1)$/i.test(String(pick(r, ['probe_response'])).trim()), probeRT: num(pick(r, ['probe_rt_ms'])),
        ask: asked, qResp: /^(y|yes|true|1)$/i.test(String(qr).trim()), qRT: num(pick(r, ['comprehension_rt_ms', 'question_rt_ms'])),
        focus: num(pick(r, ['focus_losses'])) || 0, rt1: [], rt2: [], w1: [], w2: [] };
      t.probeCorrect = known(pick(r, ['probe_correct'])) ? yes(pick(r, ['probe_correct'])) : t.probeResp === t.present;
      const qc = pick(r, ['comprehension_correct', 'question_correct']);
      t.qCorrect = asked ? (known(qc) ? yes(qc) : (it ? t.qResp === it.answer : null)) : null;
      if (!isFinite(t.probeRT)) msgs.push(`${id} trial ${pos}: probe_rt_ms is not a number (kept as missing).`);
      if (!parts.has(id)) parts.set(id, { pid: id, list: pick(r, ['list']) || (meta.get(id) || {}).list || '', source: 'imported', file: r.__file, trials: [], events: '' });
      parts.get(id).trials.push(t);
    });
    // words, into each trial's clause arrays (word_index from 1)
    const wseen = new Set(); let wdup = 0, wOrphan = 0;
    wordRows.forEach(w => {
      const id = String(pick(w, ['participant_id', 'pid'])).trim(), pos = num(pick(w, ['trial_number', 'position'])), idx = num(pick(w, ['word_index']));
      const part = String(pick(w, ['part', 'clause'])).trim(), clause = /^(line2|2)$/.test(part) ? 2 : /^(line1|1)$/.test(part) ? 1 : 0;
      const P = parts.get(id), t = P && P.trials.find(x => x.pos === pos);
      if (!t || !clause || !isFinite(idx)) { wOrphan++; return; }
      const key = `${id}|${pos}|${clause}|${idx}`;
      if (wseen.has(key)) { wdup++; return; }
      wseen.add(key);
      (clause === 1 ? t.rt1 : t.rt2)[idx - 1] = num(pick(w, ['rt_ms'])); (clause === 1 ? t.w1 : t.w2)[idx - 1] = String(pick(w, ['word']));
    });
    const out = [];
    parts.forEach(P => {
      P.trials.sort((a, b) => a.pos - b.pos);
      P.trials.forEach(t => { if (!t.w1.length || !t.w2.length) { const it = byId.get(t.id); if (it) { const [a, b] = R.words(it, t.conn); if (!t.w1.length) t.w1 = a; if (!t.w2.length) t.w2 = b; } } });
      const m = meta.get(P.pid) || {}; P.durationMs = m.durationMs; P.complete = P.trials.length === 30;
      if (existing.has(P.pid)) { msgs.push(`${P.pid}: already in the class data; the imported copy was not added.`); return; }
      if (!P.trials.some(t => t.rt2.some(isFinite))) msgs.push(`${P.pid}: no word-level times (only the trial file?); reading-time measures will be missing for this student.`);
      if (!P.complete) msgs.push(`${P.pid}: ${P.trials.length} of 30 trials (incomplete).`);
      out.push(P);
    });
    if (dup) msgs.push(`${dup} duplicate trial row${dup > 1 ? 's' : ''} (same student and trial number) found; the first copy of each was kept.`);
    if (wdup) msgs.push(`${wdup} duplicate word row${wdup > 1 ? 's' : ''}; the first copy kept.`);
    if (wOrphan) msgs.push(`${wOrphan} word row${wOrphan > 1 ? 's' : ''} without a matching trial (or without clause / word index) were not used.`);
    return { parts: out, messages: msgs };
  }

  /* ---------- analysis ---------- */
  function paired(pairs) {   // pairs: [[because, none]] per participant → because − none
    const d = pairs.map(([a, b]) => a - b), n = d.length, m = mean(d), s = sd(d);
    if (n < 2 || !(s > 0)) return { n, d: m, ci: [NaN, NaN], t: NaN, df: n - 1, p: NaN };
    const se = s / Math.sqrt(n), t = m / se, q = LAB.t975(n - 1);
    return { n, d: m, diff: m, ci: [m - q * se, m + q * se], t, df: n - 1, p: LAB.pT(t, n - 1) };
  }
  // Cousineau–Morey within-participant 95% CI half-width per condition (J = 2 conditions).
  function cm(pairs) {
    const n = pairs.length; if (n < 2) return [NaN, NaN];
    const grand = mean(pairs.flat()), norm = pairs.map(([a, b]) => { const pm = (a + b) / 2; return [a - pm + grand, b - pm + grand]; });
    const q = LAB.t975(n - 1);
    return [0, 1].map(j => q * sd(norm.map(r => r[j])) / Math.sqrt(n) * Math.SQRT2);
  }

  function analyse(all, starts, F) {
    F = Object.assign({}, DEFAULTS, F || {});
    const parts = all.slice().sort((a, b) => (a.source === b.source ? 0 : a.source === 'server' ? -1 : 1) || String(a.submittedAt || '').localeCompare(String(b.submittedAt || '')));
    let si = 0, ii = 0; parts.forEach(p => { p.label = p.source === 'server' ? 'P' + String(++si).padStart(2, '0') : 'I' + String(++ii).padStart(2, '0'); });
    const counts = { partIncomplete: 0, partLowComp: 0, trialsFocus: 0, recIncorrect: 0, recFast: 0, recSlow: 0, wordsTrimmed: 0, wordsTotal: 0, critTrials: 0, recValid: 0 };
    parts.forEach(p => {
      const main = p.trials.filter(t => t.type !== 'practice');
      p.recAcc = mean(main.map(t => (t.probeCorrect ? 1 : 0)));
      p.compAcc = mean(main.filter(t => t.ask && t.qCorrect !== null).map(t => (t.qCorrect ? 1 : 0)));
      p.focus = p.trials.reduce((s, t) => s + (t.focus || 0), 0);
      p.why = F.incomplete && !p.complete ? 'incomplete' : F.lowComp && isFinite(p.compAcc) && p.compAcc * 100 < F.compMin ? 'low comprehension' : '';
      if (p.why === 'incomplete') counts.partIncomplete++; else if (p.why) counts.partLowComp++;
      p.trials.forEach(t => {
        const reg = R.regions(t.rt2.length);
        const keepW = v => isFinite(v) && (!F.wordTrim || (v >= F.wordMin && v <= F.wordMax));
        t.trimmed = t.rt1.concat(t.rt2).filter(v => isFinite(v) && !keepW(v)).length;
        const regMean = idx => mean(idx.map(i => t.rt2[i]).filter(keepW));
        t.earlyRaw = regMean(reg.early); t.finalRaw = regMean(reg.final);
        t.wordMean = mean(t.rt1.concat(t.rt2).filter(keepW));
        t.why = '';
        if (t.type !== 'critical') return;
        if (p.why) { t.why = 'student excluded'; return; }
        counts.critTrials++;
        counts.wordsTotal += t.rt1.concat(t.rt2).filter(isFinite).length; counts.wordsTrimmed += t.trimmed;
        if (F.focus && t.focus > 0) { t.why = 'left the page'; counts.trialsFocus++; return; }
        if (F.correctOnly && !t.probeCorrect) { t.why = 'incorrect probe'; counts.recIncorrect++; }
        else if (isFinite(t.probeRT) && t.probeRT < F.probeMin) { t.why = 'probe too fast'; counts.recFast++; }
        else if (isFinite(t.probeRT) && t.probeRT > F.probeMax) { t.why = 'probe too slow'; counts.recSlow++; }
        else if (isFinite(t.probeRT)) counts.recValid++;
      });
    });
    const inc = parts.filter(p => !p.why);
    // values per trial for each measure (NaN = not contributing)
    const val = (t, k) => {
      if (t.type !== 'critical' || t.why === 'student excluded' || t.why === 'left the page') return NaN;
      if (k === 'rec') return t.why ? NaN : t.probeRT;
      if (k === 'early') return t.earlyRaw;
      if (k === 'final') return t.finalRaw;
      if (k === 'comp') return t.ask && t.qCorrect !== null ? (t.qCorrect ? 100 : 0) : NaN;
      return NaN;
    };
    inc.forEach(p => { p.m = {}; MEAS.forEach(M => { p.m[M.key] = {}; COND.forEach(([c, ck]) => {
      const v = p.trials.filter(t => t.conn === c).map(t => val(t, M.key)).filter(isFinite);
      p.m[M.key][ck] = { mean: mean(v), median: median(v), n: v.length };
    }); }); });
    const meas = MEAS.map(M => {
      const byCond = {};
      COND.forEach(([c, ck]) => { const P = inc.filter(p => p.m[M.key][ck].n); byCond[ck] = { mean: mean(P.map(p => p.m[M.key][ck].mean)), median: median(P.map(p => p.m[M.key][ck].median)), nP: P.length, nT: P.reduce((s, p) => s + p.m[M.key][ck].n, 0) }; });
      const both = inc.filter(p => p.m[M.key].because.n && p.m[M.key].none.n), pairs = both.map(p => [p.m[M.key].because.mean, p.m[M.key].none.mean]);
      return Object.assign({}, M, { byCond, diff: paired(pairs), cm: cm(pairs), pairs, who: both, nT: byCond.because.nT + byCond.none.nT });
    });
    // items (by-item comparison and the mixed models)
    const obs = k => inc.flatMap(p => p.trials.map(t => ({ pid: p.pid, id: t.id, conn: t.conn, y: val(t, k), pos: t.pos })).filter(o => isFinite(o.y)));
    // trial position: mean word time per critical trial position, by condition (participant means)
    const positions = {};
    COND.forEach(([c, ck]) => { positions[ck] = []; for (let k = 3; k <= 30; k++) { const v = inc.map(p => { const t = p.trials.find(x => x.pos === k && x.type === 'critical' && x.conn === c && !(F.focus && x.focus > 0)); return t ? t.wordMean : NaN; }).filter(isFinite); if (v.length) positions[ck].push({ pos: k, y: mean(v), n: v.length }); } });
    // overview
    const startPids = new Set((starts || []).map(r => String(r.pid)));
    parts.filter(p => p.source === 'server').forEach(p => startPids.add(p.pid));
    const listsOf = arr => ({ A: arr.filter(x => x === 'A').length, B: arr.filter(x => x === 'B').length });
    const startLists = new Map(); (starts || []).forEach(r => startLists.set(String(r.pid), r.list));
    const done = parts.filter(p => p.complete);
    const dur = done.map(p => p.durationMs).filter(isFinite);
    const allMain = parts.flatMap(p => p.trials.filter(t => t.type !== 'practice'));
    return { F, parts, inc, meas, obs, positions, counts,
      overview: { started: startPids.size, startedLists: listsOf([...startLists.values()]), completed: done.length, lists: listsOf(done.map(p => p.list)),
        durMean: mean(dur), durMedian: median(dur), recAcc: mean(allMain.map(t => (t.probeCorrect ? 1 : 0))), compAcc: mean(allMain.filter(t => t.ask && t.qCorrect !== null).map(t => (t.qCorrect ? 1 : 0))),
        imported: parts.filter(p => p.source === 'imported').length, simulated: parts.filter(p => p.simulated).length } };
  }

  /* ---------- model-based analysis ---------- */
  function byItem(res, k) {   // item means per condition (over participants), paired over items
    const o = res.obs(k), items = new Map();
    o.forEach(x => { const m = items.get(x.id) || { 1: [], 0: [] }; m[x.conn].push(x.y); items.set(x.id, m); });
    const pairs = [...items.values()].filter(m => m[1].length && m[0].length).map(m => [mean(m[1]), mean(m[0])]);
    return paired(pairs);
  }
  function lmm(res, k) {
    const A = window.FAST_ANALYSIS;
    if (!A || !A.lmm) return { ok: false, reason: 'the model code is not loaded' };
    const o = res.obs(k).filter(x => x.y > 0);
    if (o.length < 20) return { ok: false, reason: 'fewer than 20 observations' };
    const D = A.design(o, [['(Intercept)', () => 1], ['Connective (because − none)', x => (x.conn ? 0.5 : -0.5)]], x => Math.log(x.y), [['Item', x => x.id], ['Student', x => x.pid]]);
    const f = A.lmm(D);
    if (!f || !f.ok) return { ok: false, reason: f && f.reason === 'few' ? 'too few students or items' : 'the model did not converge' };
    const c = f.coefOf('Connective (because − none)');
    return { ok: true, n: o.length, nP: f.nLevels[1], nI: f.nLevels[0], b: c.b, se: c.se, df: c.df, t: c.stat, p: c.p, ci: c.ci, ratio: Math.exp(c.b), ratioCI: c.ci.map(Math.exp), sd: f.sd, sigma: f.sigma, converged: f.converged };
  }

  /* ---------- charts ---------- */
  const widthOf = (host, max) => Math.max(300, Math.min(max, Math.round(host.getBoundingClientRect().width) || max));
  const title = (el, s) => { LAB.svg('title', {}, el).textContent = s; return el; };
  const svgRoot = (host, W, H, label) => { host.textContent = ''; return LAB.svg('svg', { class: 'chart fc rd', viewBox: `0 0 ${W} ${H}`, style: `max-width:${W}px`, role: 'img', 'aria-label': label }, host); };
  const nice = (lo, hi, n) => { const span = Math.max(1e-9, hi - lo), raw = span / (n || 5), mag = 10 ** Math.floor(Math.log10(raw)), st = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= raw); return { lo: Math.floor(lo / st) * st, hi: Math.ceil(hi / st) * st, st }; };
  const CC = { because: 'c-bec', none: 'c-non' };
  function yAxis(s, Y, ax, left, right, fmt) { for (let v = ax.lo; v <= ax.hi + 1e-9; v += ax.st) { LAB.svg('line', { class: 'grid', x1: left, x2: right, y1: Y(v), y2: Y(v) }, s); LAB.text(s, left - 8, Y(v) + 4, fmt ? fmt(v) : String(+v.toFixed(2)), { 'text-anchor': 'end' }); } }

  /* 1. A measure by condition: each participant's two means (light lines), the
     condition means with within-participant 95% CIs (dark). */
  function pairPlot(host, M) {
    const W = widthOf(host, 560), H = 340, left = 62, right = 24, top = 18, bottom = 46;
    const s = svgRoot(host, W, H, `${M.name} by condition: with because ${Math.round(M.byCond.because.mean)}, no connective ${Math.round(M.byCond.none.mean)} ${M.unit}`);
    const vals = M.pairs.flat().concat([M.byCond.because.mean, M.byCond.none.mean]).filter(isFinite);
    if (!vals.length) { host.innerHTML = '<p class="empty">No data yet.</p>'; return; }
    const ax = nice(Math.min(...vals) * 0.95, Math.max(...vals) * 1.05, 5), Y = v => top + (1 - (v - ax.lo) / (ax.hi - ax.lo)) * (H - top - bottom);
    const X = [left + (W - left - right) * 0.28, left + (W - left - right) * 0.72];
    yAxis(s, Y, ax, left, W - right);
    LAB.text(s, 16, (top + H - bottom) / 2, `${M.name} (${M.unit})`, { 'text-anchor': 'middle', class: 'axis-title', transform: `rotate(-90 16 ${(top + H - bottom) / 2})` });
    const short = W < 460;
    COND.forEach(([, ck, nm], j) => LAB.text(s, X[j], H - bottom + 24, short ? (j ? 'No connective' : '“because”') : nm, { 'text-anchor': 'middle', class: 'label-strong' }));
    M.pairs.forEach(([a, b], i) => { const g = LAB.svg('g', { class: 'rd-pair' }, s); title(g, `${M.who[i].label}: ${Math.round(a)} with because, ${Math.round(b)} without (${M.unit})`);
      LAB.svg('line', { x1: X[0], x2: X[1], y1: Y(a), y2: Y(b) }, g); LAB.svg('circle', { cx: X[0], cy: Y(a), r: 3 }, g); LAB.svg('circle', { cx: X[1], cy: Y(b), r: 3 }, g); });
    COND.forEach(([, ck], j) => {
      const m = M.byCond[ck].mean, h = M.cm[j], g = LAB.svg('g', {}, s);
      if (!isFinite(m)) return;
      title(g, `${COND[j][2]}: mean ${Math.round(m)} ${M.unit}${isFinite(h) ? `, within-participant 95% CI ±${Math.round(h)}` : ''}, ${M.byCond[ck].nP} students`);
      if (isFinite(h)) LAB.svg('line', { x1: X[j], x2: X[j], y1: Y(m - h), y2: Y(m + h), class: 'rd-ci ' + CC[ck] }, g);
      LAB.svg('rect', { x: X[j] - 16, y: Y(m) - 2, width: 32, height: 4, class: 'rd-mean ' + CC[ck] }, g);
      LAB.text(g, X[j] + (j ? 22 : -22), Y(m) + 5, String(Math.round(m)), { 'text-anchor': j ? 'start' : 'end', class: 'value-label' });
    });
  }

  /* 2. Early vs final second-clause reading time, by condition (means, within-participant CIs). */
  function regionPlot(host, res) {
    const E = res.meas.find(m => m.key === 'early'), Fm = res.meas.find(m => m.key === 'final');
    const W = widthOf(host, 560), narrow = W < 460, H = 340, left = 62, right = narrow ? 104 : 120, top = 18, bottom = 46;
    const pts = [E, Fm].flatMap(m => COND.map(([, ck], j) => [m.byCond[ck].mean - (m.cm[j] || 0), m.byCond[ck].mean + (m.cm[j] || 0)]).flat()).filter(isFinite);
    if (!pts.length) { host.innerHTML = '<p class="empty">No data yet.</p>'; return; }
    const s = svgRoot(host, W, H, `Second-clause reading time, early and final words, by condition`);
    const ax = nice(Math.min(...pts) * 0.95, Math.max(...pts) * 1.05, 5), Y = v => top + (1 - (v - ax.lo) / (ax.hi - ax.lo)) * (H - top - bottom);
    const X = [left + (W - left - right) * 0.22, left + (W - left - right) * 0.78];
    yAxis(s, Y, ax, left, W - right);
    LAB.text(s, 16, (top + H - bottom) / 2, 'Reading time per word (ms)', { 'text-anchor': 'middle', class: 'axis-title', transform: `rotate(-90 16 ${(top + H - bottom) / 2})` });
    (narrow ? ['First 3 words', 'Last 3'] : ['First three words', 'Last three words']).forEach((nm, i) => LAB.text(s, X[i], H - bottom + 24, nm, { 'text-anchor': 'middle', class: 'label-strong' }));
    COND.forEach(([, ck, nm], j) => {
      const off = j ? 7 : -7, y = [E, Fm].map(m => m.byCond[ck].mean);
      if (!y.every(isFinite)) return;
      LAB.svg('line', { x1: X[0] + off, x2: X[1] + off, y1: Y(y[0]), y2: Y(y[1]), class: 'rd-line ' + CC[ck] }, s);
      [E, Fm].forEach((m, i) => { const h = m.cm[j], g = LAB.svg('g', {}, s); title(g, `${nm}, ${i ? 'last' : 'first'} three words: ${Math.round(y[i])} ms${isFinite(h) ? ` ±${Math.round(h)}` : ''}`);
        if (isFinite(h)) LAB.svg('line', { x1: X[i] + off, x2: X[i] + off, y1: Y(y[i] - h), y2: Y(y[i] + h), class: 'rd-ci ' + CC[ck] }, g);
        LAB.svg('circle', { cx: X[i] + off, cy: Y(y[i]), r: 5.5, class: 'rd-dot ' + CC[ck] }, g); });
      LAB.text(s, X[1] + 18, Y(y[1]) + 4, narrow ? (j ? 'none' : 'because') : nm, { class: 'label-strong rd-key ' + CC[ck] });
    });
  }

  /* 3. Each participant's effect (no connective − because) on one measure, sorted; above 0: faster with "because". */
  function effectStrip(host, M) {
    const d = M.pairs.map(([a, b], i) => ({ v: b - a, who: M.who[i].label })).sort((x, y) => x.v - y.v);
    if (!d.length) { host.innerHTML = '<p class="empty">No students with both conditions yet.</p>'; return; }
    const W = widthOf(host, 1000), H = 260, left = 62, right = 16, top = 26, bottom = 30;
    const s = svgRoot(host, W, H, `Each student's difference in ${M.name.toLowerCase()} (no connective minus because), sorted`);
    const ext = Math.max(50, ...d.map(x => Math.abs(x.v))), ax = nice(-ext, ext, 6), Y = v => top + (1 - (v - ax.lo) / (ax.hi - ax.lo)) * (H - top - bottom);
    yAxis(s, Y, ax, left, W - right, v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v));
    LAB.svg('line', { class: 'zero', x1: left, x2: W - right, y1: Y(0), y2: Y(0) }, s);
    LAB.text(s, left + 4, top - 10, 'Faster with “because”', { class: 'rd-note' });
    LAB.text(s, left + 4, H - 8, 'Slower with “because”', { class: 'rd-note' });
    const bw = Math.min(26, (W - left - right) / d.length);
    d.forEach((x, i) => { const cx = left + (i + 0.5) * (W - left - right) / d.length, g = LAB.svg('g', {}, s);
      title(g, `${x.who}: ${x.v > 0 ? 'faster' : 'slower'} with “because” by ${Math.abs(Math.round(x.v))} ms`);
      LAB.svg('line', { x1: cx, x2: cx, y1: Y(0), y2: Y(x.v), class: 'rd-stem' }, g);
      LAB.svg('circle', { cx, cy: Y(x.v), r: Math.max(2.5, Math.min(5, bw / 3)), class: x.v >= 0 ? 'rd-dot c-bec' : 'rd-dot c-non' }, g); });
    LAB.text(s, 16, (top + H - bottom) / 2, 'Difference (ms)', { 'text-anchor': 'middle', class: 'axis-title', transform: `rotate(-90 16 ${(top + H - bottom) / 2})` });
  }

  /* 4. The distribution of recognition RTs (valid trials), one row per condition. */
  function histogram(host, res) {
    const o = res.obs('rec'); if (!o.length) { host.innerHTML = '<p class="empty">No data yet.</p>'; return; }
    const W = widthOf(host, 1000), rowH = 110, left = 120, right = 16, top = 8, bottom = 40, H = top + 2 * rowH + bottom;
    const s = svgRoot(host, W, H, `Distribution of recognition RTs by condition, ${o.length} trials`);
    const hi0 = Math.max(...o.map(x => x.y)), lo0 = Math.min(...o.map(x => x.y)), bw = hi0 - lo0 > 3000 ? 200 : 100, lo = Math.floor(lo0 / bw) * bw, hi = Math.ceil((hi0 + 1) / bw) * bw;
    const nb = Math.max(1, Math.round((hi - lo) / bw)), X = v => left + (v - lo) / (hi - lo) * (W - left - right);
    const bins = COND.map(([c]) => { const b = new Array(nb).fill(0); o.filter(x => x.conn === c).forEach(x => { b[Math.min(nb - 1, Math.floor((x.y - lo) / bw))]++; }); return b; });
    const mx = Math.max(1, ...bins.flat());
    COND.forEach(([c, ck, nm], j) => {
      const base = top + (j + 1) * rowH - 6, n = o.filter(x => x.conn === c).length;
      LAB.text(s, 0, base - rowH / 2 + 4, nm, { class: 'label-strong' }); LAB.text(s, 0, base - rowH / 2 + 22, `${n} trials`, {});
      bins[j].forEach((v, i) => { if (!v) return; const h = v / mx * (rowH - 18), g = LAB.svg('g', {}, s); title(g, `${nm}: ${v} trial${v > 1 ? 's' : ''} at ${lo + i * bw}–${lo + (i + 1) * bw} ms`);
        LAB.svg('rect', { x: X(lo + i * bw) + 1, y: base - h, width: Math.max(1, X(lo + bw) - X(lo) - 2), height: h, class: 'rd-bar ' + CC[ck] }, g); });
      LAB.svg('line', { class: 'axis-light', x1: left, x2: W - right, y1: base, y2: base }, s);
      const md = median(o.filter(x => x.conn === c).map(x => x.y));
      if (isFinite(md)) { LAB.svg('line', { x1: X(md), x2: X(md), y1: base - rowH + 14, y2: base, class: 'rd-med' }, s); LAB.text(s, X(md) + 4, base - rowH + 24, `median ${Math.round(md)}`, { class: 'rd-note' }); }
    });
    const ax = nice(lo, hi, W < 600 ? 4 : 8);
    for (let v = ax.lo; v <= hi; v += ax.st) if (v >= lo) LAB.text(s, X(v), H - bottom + 18, String(v), { 'text-anchor': 'middle' });
    LAB.text(s, (left + W - right) / 2, H - 4, 'Recognition RT (ms)', { 'text-anchor': 'middle', class: 'axis-title' });
  }

  /* 5. Mean word reading time across trial position (critical trials), by condition. */
  function positionPlot(host, res) {
    const P = res.positions, all = P.because.concat(P.none);
    if (!all.length) { host.innerHTML = '<p class="empty">No data yet.</p>'; return; }
    const W = widthOf(host, 1000), narrow = W < 560, H = 300, left = 62, right = narrow ? 70 : 120, top = 16, bottom = 44;
    const s = svgRoot(host, W, H, 'Mean word reading time by trial position, critical trials by condition');
    const ax = nice(Math.min(...all.map(x => x.y)) * 0.9, Math.max(...all.map(x => x.y)) * 1.1, 5), Y = v => top + (1 - (v - ax.lo) / (ax.hi - ax.lo)) * (H - top - bottom);
    const X = k => left + (k - 3) / 27 * (W - left - right);
    yAxis(s, Y, ax, left, W - right);
    for (let k = 3; k <= 30; k += narrow ? 9 : 3) LAB.text(s, X(k), H - bottom + 18, String(k), { 'text-anchor': 'middle' });
    LAB.text(s, (left + W - right) / 2, H - 4, narrow ? 'Trial position' : 'Trial position (3 = first passage after practice)', { 'text-anchor': 'middle', class: 'axis-title' });
    LAB.text(s, 16, (top + H - bottom) / 2, 'Mean word time (ms)', { 'text-anchor': 'middle', class: 'axis-title', transform: `rotate(-90 16 ${(top + H - bottom) / 2})` });
    const ends = [];
    COND.forEach(([, ck, nm]) => {
      const v = P[ck]; if (!v.length) return;
      LAB.svg('path', { d: v.map((x, i) => `${i ? 'L' : 'M'}${X(x.pos).toFixed(1)} ${Y(x.y).toFixed(1)}`).join(' '), class: 'rd-line thin ' + CC[ck], fill: 'none' }, s);
      v.forEach(x => { const g = LAB.svg('g', {}, s); title(g, `${nm}, position ${x.pos}: ${Math.round(x.y)} ms (${x.n} student${x.n > 1 ? 's' : ''})`); LAB.svg('circle', { cx: X(x.pos), cy: Y(x.y), r: 3.5, class: 'rd-dot ' + CC[ck] }, g); });
      ends.push({ y: Y(v[v.length - 1].y) + 4, nm, ck });
    });
    // the two end labels kept at least a line apart
    ends.sort((a, b) => a.y - b.y);
    if (ends.length === 2 && ends[1].y - ends[0].y < 16) { const mid = (ends[0].y + ends[1].y) / 2; ends[0].y = mid - 8; ends[1].y = mid + 8; }
    ends.forEach(e => LAB.text(s, W - right + 8, e.y, narrow ? (e.ck === 'because' ? 'because' : 'none') : e.nm, { class: 'label-strong rd-key ' + CC[e.ck] }));
  }

  // One student's trials: each word tinted by its reading time (darker = slower), with the time on hover.
  function participantDetail(P) {
    const all = P.trials.flatMap(t => t.rt1.concat(t.rt2)).filter(isFinite), hi = Math.max(400, median(all) * 2.5);
    const esc = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const chips = (ws, rts) => ws.map((w, i) => { const v = rts[i], a = isFinite(v) ? Math.min(1, v / hi) : 0;
      return `<span class="rd-w" style="--a:${(0.08 + 0.62 * a).toFixed(2)}" title="${esc(w)}: ${isFinite(v) ? Math.round(v) + ' ms' : 'no time'}">${esc(w)}</span>`; }).join(' ');
    return `<table class="data rd-trials"><thead><tr><th scope="col">#</th><th scope="col">Item</th><th scope="col">Condition</th><th scope="col">Passage (darker = slower)</th><th class="num" scope="col">Probe</th><th class="num" scope="col">RT</th><th scope="col">Question</th><th class="num" scope="col">Left page</th></tr></thead><tbody>` +
      P.trials.map(t => `<tr${t.why && t.why !== 'student excluded' ? ' class="rd-out"' : ''}><td>${t.pos}</td><td>${t.id}</td><td>${t.type === 'critical' ? (t.conn ? 'because' : 'none') : t.type}</td>` +
        `<td class="rd-pass">${chips(t.w1, t.rt1)}<br>${chips(t.w2, t.rt2)}</td><td class="num">${t.probe ? esc(t.probe) : ''} ${t.probeResp ? 'T' : 'F'} ${t.probeCorrect ? '✓' : '✗'}</td><td class="num">${isFinite(t.probeRT) ? Math.round(t.probeRT) : '–'}</td>` +
        `<td>${t.ask ? (t.qResp ? 'Y' : 'N') + ' ' + (t.qCorrect ? '✓' : '✗') : ''}</td><td class="num">${t.focus || ''}</td></tr>`).join('') + '</tbody></table>';
  }

  /* ---------- downloads ---------- */
  const NA = v => (v === null || v === undefined || (typeof v === 'number' && !isFinite(v)) ? 'NA' : v);
  function trialRows(res) {
    return res.parts.flatMap(p => p.trials.map(t => ({ source: p.source, participant: p.label, pid: p.pid, list: NA(p.list), position: t.pos, item_id: t.id, type: t.type,
      connective: t.type === 'critical' ? (t.conn ? 'because' : 'none') : 'none', probe: t.probe, probe_present: t.present === null ? 'NA' : t.present ? 1 : 0,
      probe_response: t.probeResp ? 'T' : 'F', probe_correct: t.probeCorrect ? 1 : 0, probe_rt_ms: NA(Math.round(t.probeRT)),
      question_asked: t.ask ? 1 : 0, question_response: t.ask ? (t.qResp ? 'Y' : 'N') : 'NA', question_correct: t.ask && t.qCorrect !== null ? (t.qCorrect ? 1 : 0) : 'NA', question_rt_ms: t.ask ? NA(Math.round(t.qRT)) : 'NA',
      early_rt_ms: NA(t.earlyRaw === undefined ? NaN : Math.round(t.earlyRaw)), final_rt_ms: NA(t.finalRaw === undefined ? NaN : Math.round(t.finalRaw)),
      focus_losses: t.focus, excluded: t.why ? 1 : 0, excluded_reason: t.why || (p.why ? 'student excluded' : '') })));
  }
  function wordRows(res) {
    return res.parts.flatMap(p => p.trials.flatMap(t => [[1, t.w1, t.rt1], [2, t.w2, t.rt2]].flatMap(([cl, ws, rts]) => {
      const reg = R.regions(ws.length);
      return ws.map((w, i) => ({ source: p.source, participant: p.label, pid: p.pid, list: NA(p.list), position: t.pos, item_id: t.id, type: t.type,
        connective: t.type === 'critical' ? (t.conn ? 'because' : 'none') : 'none', clause: cl, word_index: i + 1, word: w, rt_ms: NA(Math.round(rts[i])),
        region: cl === 1 ? 'clause1' : reg.early.includes(i) ? 'early' : reg.final.includes(i) ? 'final' : 'middle', focus_losses: t.focus }));
    })));
  }
  function participantRows(res) {
    return res.parts.map(p => { const o = { participant: p.label, pid: p.pid, source: p.source, list: NA(p.list), complete: p.complete ? 1 : 0, excluded_reason: p.why || '',
      duration_s: NA(isFinite(p.durationMs) ? Math.round(p.durationMs / 1000) : NaN), critical_trials: p.trials.filter(t => t.type === 'critical').length,
      recognition_accuracy: NA(LAB.round(p.recAcc, 3)), comprehension_accuracy: NA(LAB.round(p.compAcc, 3)), interruptions: p.focus };
      MEAS.forEach(M => COND.forEach(([, ck]) => { o[`${M.key}_${ck}`] = p.m ? NA(LAB.round(p.m[M.key][ck].mean, M.key === 'comp' ? 1 : 0)) : 'NA'; }));
      return o; });
  }
  function conditionRows(res) {
    return res.meas.flatMap(M => COND.map(([, ck]) => ({ measure: M.key, condition: ck, mean: NA(LAB.round(M.byCond[ck].mean, 1)), median: NA(LAB.round(M.byCond[ck].median, 1)),
      students: M.byCond[ck].nP, trials: M.byCond[ck].nT, difference_because_minus_none: NA(LAB.round(M.diff.d, 1)), ci_low: NA(LAB.round(M.diff.ci[0], 1)), ci_high: NA(LAB.round(M.diff.ci[1], 1)), students_paired: M.diff.n })));
  }
  function json(res, session) {
    return JSON.stringify({ exported_at: new Date().toISOString(), class: session, filters: res.F, overview: res.overview, exclusions: res.counts,
      participants: res.parts.map(p => ({ participant: p.label, pid: p.pid, source: p.source, list: p.list, complete: p.complete, excluded_reason: p.why || null, duration_ms: isFinite(p.durationMs) ? p.durationMs : null,
        trials: p.trials.map(t => ({ position: t.pos, item_id: t.id, type: t.type, connective: t.conn, probe_response: t.probeResp, probe_correct: t.probeCorrect, probe_rt_ms: isFinite(t.probeRT) ? t.probeRT : null,
          question_asked: t.ask, question_response: t.ask ? t.qResp : null, question_correct: t.qCorrect, question_rt_ms: isFinite(t.qRT) ? t.qRT : null, focus_losses: t.focus,
          words1: t.w1, rts1: t.rt1.map(v => (isFinite(v) ? v : null)), words2: t.w2, rts2: t.rt2.map(v => (isFinite(v) ? v : null)), excluded_reason: t.why || null })) })) }, null, 1);
  }

  window.READ_RESULTS = { COND, MEAS, DEFAULTS, NONE, parseRow, importFiles, analyse, byItem, lmm, pairPlot, regionPlot, effectStrip, histogram, positionPlot, participantDetail,
    trialRows, wordRows, participantRows, conditionRows, json, mean, median };
})();
