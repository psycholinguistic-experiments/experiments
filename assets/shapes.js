/* LT5461 — sound–shape matching (bouba/kiki), 3 × 2 design.
   Consonants: sonorants m n l / voiced stops b d g / voiceless stops p t k
   Vowels:     back rounded u o / front unrounded i e
   Six CVCV pseudowords per cell, both consonants from the same class; none is
   an English word (checked against SUBTLEX-UK). Each trial pairs one word with
   a freshly generated shape pair, an irregular smooth blob and an irregular
   star, scaled to the same area and drawn in the same colour, so curvature is
   the difference that matters. Which side the round shape appears on is
   balanced within each cell. */
(function () {
  'use strict';

  const WORDS = {
    son: { front: ['meni', 'neli', 'lemi', 'nimi', 'lini', 'limi'], back: ['molu', 'nomu', 'lonu', 'lumo', 'muno', 'nulo'] },
    vcd: { front: ['gebi', 'degi', 'bedi', 'gidi', 'gibi', 'dibi'], back: ['bodu', 'gobu', 'dogu', 'bugo', 'dubo', 'gudo'] },
    vcl: { front: ['keti', 'peki', 'tepi', 'kipi', 'piki', 'kiti'], back: ['poku', 'topu', 'toku', 'kuto', 'tuko', 'puko'] }
  };
  const CONS = ['son', 'vcd', 'vcl'], VOW = ['back', 'front'];

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const state = { pid: LAB.pid(), session: LAB.session(), data: [], input: 'pointer' };

  /* ---------- shapes ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
  const area = pts => Math.abs(pts.reduce((s, p, i) => {
    const q = pts[(i + 1) % pts.length];
    return s + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2;

  // Closed Catmull-Rom spline through pts, as cubic Béziers + a dense sampling.
  function smooth(pts) {
    const n = pts.length, segs = [], samples = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      segs.push([p1, c1, c2, p2]);
      for (let k = 0; k < 16; k++) {
        const t = k / 16, u = 1 - t;
        samples.push([
          u * u * u * p1[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p2[0],
          u * u * u * p1[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p2[1]
        ]);
      }
    }
    return { segs, samples };
  }

  const f = v => v.toFixed(3);
  function makePair(seed) {
    const R = mulberry32(seed);
    // Spiky: an irregular star with 5–8 points and straight edges.
    const n = 5 + Math.floor(R() * 4);
    const step = 2 * Math.PI / n, rot = R() * 2 * Math.PI;
    const spiky = [];
    for (let i = 0; i < n; i++) {
      const a = rot + i * step + (R() - 0.5) * step * 0.3;
      spiky.push(polar(0.85 + R() * 0.15, a), polar(0.44 + R() * 0.1, a + step / 2));
    }
    // Round: an irregular amoeba, a smooth radius built from a few low
    // harmonics (the classic "bouba"/"maluma" figure).
    const harm = [2, 3, 4, 5].map(k => ({ k, a: (k < 4 ? 0.06 : 0.02) + R() * 0.07, p: R() * 2 * Math.PI }));
    const round = [];
    for (let j = 0; j < 72; j++) {
      const th = j / 72 * 2 * Math.PI;
      const r = 1 + harm.reduce((s, h) => s + h.a * Math.cos(h.k * th + h.p), 0);
      round.push(polar(Math.max(0.6, r), th));
    }
    const sm = smooth(round);
    // Equalise area, then shrink both together if either would leave the box.
    const target = 1.5;
    let ks = Math.sqrt(target / area(spiky)), kr = Math.sqrt(target / area(sm.samples));
    const maxR = Math.max(
      ks * Math.max(...spiky.map(p => Math.hypot(p[0], p[1]))),
      kr * Math.max(...sm.samples.map(p => Math.hypot(p[0], p[1]))));
    if (maxR > 1.15) { ks *= 1.15 / maxR; kr *= 1.15 / maxR; }
    const S = p => f(p[0] * ks) + ' ' + f(p[1] * ks), Rr = p => f(p[0] * kr) + ' ' + f(p[1] * kr);
    const dSpiky = 'M' + spiky.map(S).join('L') + 'Z';
    const dRound = 'M' + Rr(sm.segs[0][0]) + sm.segs.map(s => 'C' + Rr(s[1]) + ' ' + Rr(s[2]) + ' ' + Rr(s[3])).join('') + 'Z';
    return { dSpiky, dRound, lobes: n };
  }
  const svgFor = d => `<svg viewBox="-1.25 -1.25 2.5 2.5" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;

  /* ---------- trials ---------- */
  function build() {
    const trials = [];
    CONS.forEach(c => VOW.forEach(v => {
      const sides = LAB.shuffle(['left', 'left', 'left', 'right', 'right', 'right']);
      WORDS[c][v].forEach((w, i) => trials.push({ word: w, cons: c, vowel: v, roundSide: sides[i] }));
    }));
    LAB.shuffle(trials);
    const base = Math.floor(Math.random() * 1e9);
    trials.forEach((t, i) => { t.seed = base + i * 7919; });
    return trials;
  }

  const btns = $$('.shape-btn');
  let pending = null;
  function choose(side, ts, via) {
    if (!pending) return;
    const p = pending; pending = null;
    p.resolve({ side, rt: ts - p.t0, via });
  }
  btns.forEach(b => {
    // pointerdown gives the moment of the press; click with detail 0 is a
    // keyboard activation (Enter/Space on a focused shape).
    b.addEventListener('pointerdown', e => { if (e.button === 0) choose(b.dataset.side, e.timeStamp, 'pointer'); });
    b.addEventListener('click', e => { if (e.detail === 0) choose(b.dataset.side, e.timeStamp, 'key'); });
  });
  window.addEventListener('keydown', e => {
    if ($('#s-task').hidden || e.repeat || !pending) return;
    const k = e.key.toLowerCase();
    if (k === 'f' || e.key === 'ArrowLeft') { e.preventDefault(); choose('left', e.timeStamp, 'key'); }
    if (k === 'j' || e.key === 'ArrowRight') { e.preventDefault(); choose('right', e.timeStamp, 'key'); }
  });

  async function run() {
    const trials = build();
    const wordEl = $('#t-word'), countEl = $('#t-count'), stageEl = $('#t-stage');
    const fill = $('.progress-track i'), track = $('.progress-track');
    const setProgress = done => { fill.style.width = (done / trials.length * 100) + '%'; track.setAttribute('aria-valuenow', done); };
    for (let i = 0; i < trials.length; i++) {
      const t = trials[i];
      const pair = makePair(t.seed);
      const left = t.roundSide === 'left' ? pair.dRound : pair.dSpiky;
      const right = t.roundSide === 'left' ? pair.dSpiky : pair.dRound;
      btns[0].innerHTML = svgFor(left);
      btns[1].innerHTML = svgFor(right);
      wordEl.textContent = t.word;
      countEl.textContent = `${i + 1} / ${trials.length}`;
      setProgress(i);
      btns.forEach(b => b.classList.remove('picked'));
      const t0 = await LAB.frame();
      stageEl.classList.remove('blank');
      const r = await new Promise(resolve => { pending = { t0, resolve }; });
      btns.find(b => b.dataset.side === r.side).classList.add('picked');
      setProgress(i + 1);
      state.data.push({
        trial: i + 1, word: t.word, consonants: t.cons, vowels: t.vowel,
        round_side: t.roundSide, chosen_side: r.side,
        chose_round: r.side === t.roundSide ? 1 : 0,
        rt: LAB.round(r.rt, 1), via: r.via, lobes: pair.lobes, seed: t.seed
      });
      await LAB.wait(260);
      stageEl.classList.add('blank');
      await LAB.wait(240);
    }
    finish();
  }

  /* ---------- summary + results ---------- */
  function cellMeans(rows) {
    const out = {};
    CONS.forEach(c => VOW.forEach(v => {
      const r = rows.filter(d => d.consonants === c && d.vowels === v);
      out[c + '_' + v] = r.length ? r.filter(d => d.chose_round).length / r.length : NaN;
    }));
    CONS.forEach(c => { out[c] = LAB.mean([out[c + '_back'], out[c + '_front']]); });
    VOW.forEach(v => { out[v] = LAB.mean(CONS.map(c => out[c + '_' + v])); });
    return out;
  }

  function finish() {
    const m = cellMeans(state.data);
    const s = {
      exp: 'bouba', pid: state.pid, session: state.session,
      submitted_at: new Date().toISOString(),
      n_trials: state.data.length,
      median_rt: LAB.round(LAB.median(state.data.map(d => d.rt)), 0),
      include: 1, exclude_reason: ''
    };
    Object.keys(m).forEach(k => { s['round_' + k] = LAB.round(m[k], 3); });
    // Someone who always clicks the same side has not done the task.
    const sameSide = Math.max(...['left', 'right'].map(x => state.data.filter(d => d.chosen_side === x).length));
    if (sameSide >= 33) { s.include = 0; s.exclude_reason = 'chose the same side on nearly every trial'; }
    state.summary = s;
    LAB.markDone('bouba');
    renderResults(s);
    $$('.screen').forEach(el => { el.hidden = el.id !== 's-results'; });
    window.scrollTo(0, 0);
    $('#results-title').focus({ preventScroll: true });
    LAB.submit({ v: 1, exp: 'bouba', pid: state.pid, session: state.session, submissionId: LAB.uid(), summary: s,
      trials: state.data.map(d => Object.assign({ pid: state.pid, session: state.session }, d)) })
      .then(reportUpload);
    loadClass();
  }

  const seriesOf = o => ({
    a: CONS.map(c => LAB.num(o['round_' + c + '_back'])),
    b: CONS.map(c => LAB.num(o['round_' + c + '_front']))
  });

  function renderResults(s) {
    $('#r-code').textContent = state.pid;
    const p = v => Math.round(v * 100);
    $('#r-stats').innerHTML = `
      <div class="stat key"><span class="stat-label">Words with m n l</span>
        <span class="stat-value">${p(s.round_son)}<small>%</small></span><span class="stat-note">matched to the round shape</span></div>
      <div class="stat"><span class="stat-label">Words with p t k</span>
        <span class="stat-value">${p(s.round_vcl)}<small>%</small></span><span class="stat-note">matched to the round shape</span></div>
      <div class="stat"><span class="stat-label">Vowels u o</span>
        <span class="stat-value">${p(s.round_back)}<small>%</small></span><span class="stat-note">matched to the round shape</span></div>
      <div class="stat"><span class="stat-label">Vowels i e</span>
        <span class="stat-value">${p(s.round_front)}<small>%</small></span><span class="stat-note">matched to the round shape</span></div>`;
    $('#r-sentence').innerHTML = `You chose the round shape for ${p(s.round_son)}% of words with m, n and l, ${p(s.round_vcd)}% of words with b, d and g, and ${p(s.round_vcl)}% of words with p, t and k.`;
    LAB.interactionPlot($('#r-you'), seriesOf(s), { ariaLabel: 'Your round-shape choices by consonant class and vowel' });
    if (s.exclude_reason) { const ex = $('#r-excluded'); ex.hidden = false; ex.textContent = `Your run is saved but not counted in the class average (${s.exclude_reason}).`; }
    $('#btn-csv').onclick = () => LAB.download(`lt5461-shapes-${state.pid}.csv`, LAB.toCSV(state.data.map(d => Object.assign({ pid: state.pid }, d))));
  }

  function reportUpload(st) {
    const el = $('#r-upload');
    if (st.offline) el.textContent = 'Your results are saved on this device. If your instructor asks for them, use “Download my data” below.';
    else if (st.pending) el.textContent = 'Could not reach the class server yet; your results are saved on this device and will be sent the next time you open any of the tasks.';
    else el.textContent = 'Your results were added to the class data anonymously.';
  }

  async function loadClass() {
    const host = $('#r-class'), status = $('#r-class-status');
    const dot = status.querySelector('.live-dot'), label = status.querySelector('.label');
    if (!LAB.connected()) {
      // Offline: show only your own chart, under a plain heading.
      $('#r-class-fig').hidden = true;
      status.hidden = true;
      $('#r-class-h').textContent = 'Your pattern';
      $('#r-ci-note').hidden = true;
      return;
    }
    label.textContent = 'Loading the class…';
    try {
      const json = await LAB.fetchClass('bouba', state.session);
      const rows = json.rows.filter(r => r.pid !== state.pid).concat([state.summary]).filter(r => String(r.include) === '1');
      const ser = { a: [], b: [], aCI: [], bCI: [] };
      CONS.forEach(c => {
        const a = rows.map(r => LAB.num(r['round_' + c + '_back'])).filter(isFinite);
        const b = rows.map(r => LAB.num(r['round_' + c + '_front'])).filter(isFinite);
        ser.a.push(LAB.mean(a)); ser.b.push(LAB.mean(b));
        ser.aCI.push(LAB.ci95(a)); ser.bCI.push(LAB.ci95(b));
      });
      dot.classList.remove('off');
      label.textContent = `Class: ${rows.length} ${rows.length === 1 ? 'person' : 'people'} so far · updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      LAB.interactionPlot(host, ser, { ariaLabel: `Class round-shape choices, ${rows.length} people` });
    } catch (e) {
      dot.classList.add('off');
      label.textContent = 'Could not load the class results. Try again in a moment.';
    }
  }
  $('#btn-refresh').addEventListener('click', loadClass);

  $('#btn-start').addEventListener('click', () => {
    $$('.screen').forEach(el => { el.hidden = el.id !== 's-task'; });
    window.scrollTo(0, 0);
    run();
  });

  LAB.flush();
})();
