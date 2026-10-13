/* LT5461 — fluency task results.
   Answers: each block's words as typed (split, trimmed; several words typed
   together were already separate answers). Per student and category:
   entries, different entries (repeats removed), and different entries found
   in SUBTLEX-CH (Cai & Brysbaert, 2010; assets/data/subtlex-ch-wf.txt), the
   default count.
   Curiosity: the sum of each subscale, either all five items (5DC; je5, ds5,
   5–35) or the four the 5DCR keeps (without joy2 and depriv5; je, ds, 4–28,
   as in the class's earlier Curiosity Scale Analysis Rmd); high when above the
   class median, so four profiles (high/low deprivation × high/low joy).
   Exposes window.FLUENCY. */
(function () {
  'use strict';
  const num = v => (v === '' || v === null || v === undefined) ? NaN : Number(v);
  const CATS = [['an', 'animals', 'Animals'], ['fv', 'fruitveg', 'Fruits & vegetables']];
  const ITEMS = ['joy1', 'joy2', 'joy3', 'joy4', 'joy5', 'depriv1', 'depriv2', 'depriv3', 'depriv4', 'depriv5'];
  const MINUS = '−';

  /* ---------- SUBTLEX-CH, loaded once when the tab is first drawn ---------- */
  let lex = null, lexP = null;
  function loadLex() {
    if (!lexP) lexP = fetch('assets/data/subtlex-ch-wf.txt').then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }).then(t => {
      const m = new Map();
      t.split('\n').forEach(l => { if (!l || l[0] === '#') return; const i = l.indexOf('\t'); if (i > 0) m.set(l.slice(0, i), Number(l.slice(i + 1))); });
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
      C.valid = lex ? uniq.filter(w => lex.has(w)) : null;
      C.nAll = uniq.length; C.nLex = C.valid ? C.valid.length : NaN;
      C.logw = C.valid && C.valid.length ? LAB.mean(C.valid.map(w => Math.log10(lex.get(w)))) : NaN;
    });
  }

  /* rows: first run per student (chosen by the dashboard). mode 'lex' | 'all'; scale 'full' (5 items) | 'short' (4 items). */
  function analyse(rows, mode, scale) {
    const all = rows.map(parse);
    const S = all.filter(s => s.include);
    S.forEach(score);
    const short = scale === 'short';
    S.forEach(s => { s.J = short ? s.je : s.je5; s.D = short ? s.ds : s.ds5; });
    const useLex = mode !== 'all' && !!lex;
    const count = (s, c) => useLex ? s.cats[c].nLex : s.cats[c].nAll;
    S.forEach(s => { s.n = { an: count(s, 'an'), fv: count(s, 'fv') }; s.n.both = (s.n.an + s.n.fv) / 2; });
    // curiosity profiles: above the median = high (as the Rmd)
    const scored = S.filter(s => isFinite(s.J) && isFinite(s.D));
    const medJ = LAB.median(scored.map(s => s.J)), medD = LAB.median(scored.map(s => s.D));
    scored.forEach(s => { s.hiJ = s.J > medJ; s.hiD = s.D > medD; s.profile = `${s.hiD ? 'hiD' : 'loD'}-${s.hiJ ? 'hiJ' : 'loJ'}`; });
    // correlations of each count with each subscale: r from least squares (its t-test), CI by Fisher z
    const corr = (key, sub) => {
      const P = scored.filter(s => isFinite(s.n[key]));
      const f = LAB.ols(P.map(s => s[sub]), P.map(s => s.n[key]));
      if (!f || !isFinite(f.r)) return { n: P.length, r: NaN, p: NaN, t: NaN, df: NaN, ci: [NaN, NaN], fit: f, pts: P.map(s => ({ x: s[sub], y: s.n[key] })) };
      const z = Math.atanh(Math.max(-0.9999, Math.min(0.9999, f.r))), se = 1 / Math.sqrt(P.length - 3);
      return { n: P.length, r: f.r, p: f.p, t: f.t, df: f.df, diff: f.r, ci: P.length > 3 ? [Math.tanh(z - 1.96 * se), Math.tanh(z + 1.96 * se)] : [NaN, NaN], fit: f, pts: P.map(s => ({ x: s[sub], y: s.n[key] })) };
    };
    const R = {};
    ['an', 'fv', 'both'].forEach(k => { R[k] = { je: corr(k, 'J'), ds: corr(k, 'D') }; });
    // order: each category's count when it came first vs second
    const order = {};
    CATS.forEach(([c]) => { order[c] = LAB.welch(S.filter(s => s.cats[c].pos === 2).map(s => s.n[c]), S.filter(s => s.cats[c].pos === 1).map(s => s.n[c])); });
    // the class's answers: how many students gave each, and those not in SUBTLEX-CH
    const answers = {};
    CATS.forEach(([c]) => {
      const m = new Map();
      S.forEach(s => s.cats[c].uniq.forEach(w => m.set(w, (m.get(w) || 0) + 1)));
      const list = [...m.entries()].map(([w, n]) => ({ w, n, inLex: lex ? lex.has(w) : null })).sort((a, b) => b.n - a.n || a.w.localeCompare(b.w, 'zh'));
      answers[c] = list;
    });
    const lo = short ? 4 : 5, hi = short ? 28 : 35;
    return { all, S, n: S.length, excluded: all.length - S.length, scored, medJ, medD, R, order, answers, useLex, lexReady: !!lex,
      scale: short ? 'short' : 'full', lo, hi, step: short ? 4 : 5, range: `${lo}–${hi}` };
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
      `<ol class="fl-top">${top.map(a => `<li${a.inLex === false ? ' class="nolex"' : ''}><span class="w" lang="zh-Hans">${a.w}</span>` +
        `<span class="bar"><i style="width:${(a.n / n * 100).toFixed(1)}%"></i></span><span class="v">${Math.round(a.n / n * 100)}%</span></li>`).join('')}</ol>`;
  }

  /* ---------- downloads ---------- */
  function answerRows(res) {
    return res.all.flatMap(s => CATS.flatMap(([c, cat]) => {
      const C = s.cats[c], seen = new Set();
      return C.words.map((w, i) => { const k = norm(w), rep = seen.has(k) ? 1 : 0; seen.add(k);
        return { pid: s.pid, include: s.include ? 1 : 0, category: cat, block: C.pos, position: i + 1, response: w, t_s: C.times[i],
          repeat: rep, in_subtlex: lex ? (lex.has(k) ? 1 : 0) : 'NA', subtlex_count: lex && lex.has(k) ? lex.get(k) : 'NA',
          je5: s.je5, ds5: s.ds5, je: s.je, ds: s.ds, profile: s.profile || 'NA', profile_from: res.scale === 'short' ? '4 items' : '5 items' }; });
    }));
  }
  function studentRows(res) {
    return res.all.map(s => {
      const o = { pid: s.pid, include: s.include ? 1 : 0, l1_chinese: s.row.l1_chinese, first: s.first };
      CATS.forEach(([c]) => {
        const C = s.cats[c];
        Object.assign(o, { [c + '_block']: C.pos, [c + '_entries']: C.words.length, [c + '_different']: C.nAll ?? 'NA', [c + '_in_subtlex']: isFinite(C.nLex) ? C.nLex : 'NA',
          [c + '_repeats']: C.repeats ?? 'NA', [c + '_mean_log10_count']: isFinite(C.logw) ? LAB.round(C.logw, 3) : 'NA', [c + '_hidden_ms']: C.hiddenMs, [c + '_pastes']: C.pastes });
      });
      Object.assign(o, { je5: s.je5, ds5: s.ds5, je: s.je, ds: s.ds, profile: s.profile || 'NA', profile_from: res.scale === 'short' ? '4 items' : '5 items' });
      ITEMS.forEach(k => { o[k] = s[k]; });
      return o;
    });
  }
  // Binary student × answer matrix for SemNeT (rows: students; 1 = gave that answer), as textcleaner's output.
  function matrixRows(res, c) {
    const words = res.answers[c].filter(a => !res.useLex || a.inLex).map(a => a.w);
    return res.S.map(s => {
      const have = new Set(s.cats[c].uniq);
      const o = { pid: s.pid, je5: s.je5, ds5: s.ds5, je: s.je, ds: s.ds, profile: s.profile || 'NA', profile_from: res.scale === 'short' ? '4 items' : '5 items' };
      words.forEach(w => { o[w] = have.has(w) ? 1 : 0; });
      return o;
    });
  }

  const fmtR = v => isFinite(v) ? (v <= -0.005 ? MINUS : '') + Math.abs(v).toFixed(2).replace(/^0/, '') : '–';
  window.FLUENCY = { CATS, loadLex, analyse, profileMap, topAnswers, answerRows, studentRows, matrixRows, fmtR, lexReady: () => !!lex };
})();
