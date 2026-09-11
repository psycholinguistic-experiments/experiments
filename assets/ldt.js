/* LT5461 — lexical decision with Chinese primes and English targets.
   One engine for both tasks; the page sets window.LDT_CONFIG:
     exp          'masked' | 'visible'
     forward      { text, ms, cls }   ######## (masked) or + (visible)
     primeMs      60 (masked; Chaouch-Orozco et al., 2021) or 200 (visible; 2023)
     awareness    ask the post-task prime-awareness question (masked only)

   Timing: every display change happens inside a requestAnimationFrame callback,
   durations are counted in whole frames of the screen in use, and the actual
   forward-mask and prime durations are measured and stored on every trial.
   RT = keydown/pointerdown event timestamp − the frame the target was drawn in. */
(function () {
  'use strict';

  const C = window.LDT_CONFIG;
  const STIM = window.LT5461_STIMULI[C.exp];
  const PRACTICE = window.LT5461_STIMULI.practice;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const state = {
    pid: LAB.pid(),
    session: LAB.session(),
    script: null, hand: null, list: null,
    input: 'keyboard',
    frameMs: 1000 / 60,
    data: [],
    startedAt: null
  };

  const coarseOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  if (coarseOnly) { document.documentElement.classList.add('touch'); state.input = 'touch'; }

  /* ---------- screens ---------- */
  function show(id) {
    $$('.screen').forEach(s => { s.hidden = s.id !== id; });
    const h = document.querySelector('#' + id + ' h1, #' + id + ' h2');
    window.scrollTo(0, 0);
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  /* ---------- about-you form ---------- */
  const about = $('#form-about');
  const aboutErr = $('#about-error');
  const savedAbout = LAB.store.get('about', null);
  if (savedAbout) {
    ['script', 'hand'].forEach(k => {
      const r = about.querySelector(`input[name="${k}"][value="${savedAbout[k]}"]`);
      if (r) r.checked = true;
    });
  }
  about.addEventListener('change', () => { aboutErr.textContent = ''; });
  about.addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(about);
    const missing = ['script', 'hand'].filter(k => !f.get(k));
    if (missing.length) {
      aboutErr.textContent = 'Please answer both questions to continue.';
      about.querySelector(`input[name="${missing[0]}"]`).focus();
      return;
    }
    state.script = f.get('script');
    state.hand = f.get('hand');
    LAB.store.set('about', { script: state.script, hand: state.hand });
    renderKeys();
    show('s-keys');
  });
  $('#btn-back').addEventListener('click', () => show('s-intro'));

  /* ---------- response mapping ----------
     As in Chaouch-Orozco et al. (2023): right-handers press 0 for YES (a real
     word) and 1 for NO; the mapping is inverted for left-handers, so the
     dominant hand always answers YES. */
  let keyMap = {};
  function renderKeys() {
    const yesKey = state.hand === 'left' ? '1' : '0';
    const noKey = yesKey === '0' ? '1' : '0';
    keyMap = { [yesKey]: 'word', [noKey]: 'nonword' };
    const leftKey = '1', rightKey = '0';
    const label = k => keyMap[k] === 'word' ? 'Real English word' : 'Not a word';
    const touch = document.documentElement.classList.contains('touch');
    const cell = (k, side) => touch
      ? `<div><span><span class="side">${side} button</span><b>${label(k)}</b></span></div>`
      : `<div><kbd>${k}</kbd><span><span class="side">${side} hand</span><b>${label(k)}</b></span></div>`;
    $('#keymap').innerHTML = cell(leftKey, 'Left') + cell(rightKey, 'Right');
    if (touch) $('#keys-lead').textContent = 'You will answer with two buttons at the bottom of the screen. Tap as soon as you know. There is no time limit, but the faster the better.';
    const pads = $$('.pad');
    pads[0].dataset.resp = keyMap[leftKey];
    pads[0].textContent = label(leftKey);
    pads[1].dataset.resp = keyMap[rightKey];
    pads[1].textContent = label(rightKey);
  }

  /* ---------- trial lists ---------- */
  function primeOf(row) { return state.script === 'hant' ? row[2] : row[1]; }

  function buildMain() {
    let list = LAB.store.get('list:' + C.exp, null);
    if (list !== 0 && list !== 1) { list = Math.random() < 0.5 ? 0 : 1; LAB.store.set('list:' + C.exp, list); }
    state.list = list;
    const relSet = STIM.sets[list], ctlSet = STIM.sets[1 - list];
    const trials = [];
    relSet.forEach(r => trials.push({ cond: 'related', lex: 'word', target: r[0], prime: primeOf(r), gloss: r[0] }));
    ctlSet.forEach(r => {
      const donor = ctlSet.find(x => x[0] === r[3]);
      trials.push({ cond: 'control', lex: 'word', target: r[0], prime: primeOf(donor), gloss: donor[0] });
    });
    const primes = LAB.shuffle(STIM.nonwordPrimes.slice());
    STIM.nonwords.forEach((nw, i) => {
      const p = primes[i];
      trials.push({ cond: 'nonword', lex: 'nonword', target: nw, prime: state.script === 'hant' ? p[1] : p[0], gloss: '' });
    });
    // Shuffle with at most 4 consecutive trials of the same lexicality.
    for (let tries = 0; tries < 2000; tries++) {
      LAB.shuffle(trials);
      let run = 1, ok = true;
      for (let i = 1; i < trials.length && ok; i++) {
        run = trials[i].lex === trials[i - 1].lex ? run + 1 : 1;
        if (run > 4) ok = false;
      }
      if (ok) break;
    }
    return trials;
  }

  function buildPractice() {
    return LAB.shuffle(PRACTICE.map(p => ({
      cond: p.cond, lex: p.cond === 'nonword' ? 'nonword' : 'word', target: p.target,
      prime: state.script === 'hant' ? p.t : p.s, gloss: ''
    })));
  }

  /* ---------- stage ---------- */
  const stage = $('#stage');
  const L = { fwd: $('.l-fwd'), prime: $('.l-prime'), target: $('.l-target') };
  const msg = $('.stage-msg');
  const panel = $('#panel');
  const prog = {
    label: $('.progress-label'), count: $('.progress-count'),
    track: $('.progress-track'), fill: $('.progress-track i')
  };
  function setProgress(label, done, current, total) {
    prog.label.textContent = label;
    prog.count.textContent = current ? `${current} / ${total}` : '';
    prog.fill.style.width = (done / total * 100) + '%';
    prog.track.setAttribute('aria-valuenow', Math.round(done / total * 100));
  }
  L.fwd.textContent = C.forward.text;
  L.fwd.classList.add(C.forward.cls);

  function layer(on) {
    for (const k in L) L[k].classList.toggle('on', L[k] === on);
  }
  const frames = ms => Math.max(1, Math.round(ms / state.frameMs));

  let armed = null;        // pending response
  let cont = null;         // pending "continue"
  let hiddenFlag = false;
  document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenFlag = true; });

  function respond(resp, ts, via) {
    if (!armed) return;
    const a = armed; armed = null;
    a.resolve({ resp, rt: ts - a.tOn, via });
  }

  window.addEventListener('keydown', e => {
    if (stage.hidden) return;
    if (e.key === ' ' || e.code === 'Space' || e.key === 'Enter') {
      e.preventDefault();
      if (cont && !e.repeat) { const c = cont; cont = null; c(); }
      return;
    }
    if (e.repeat || !armed) return;
    const r = keyMap[e.key];
    if (r) { e.preventDefault(); respond(r, e.timeStamp, 'key'); }
  });
  $$('.pad').forEach(p => p.addEventListener('pointerdown', e => {
    e.preventDefault();
    respond(p.dataset.resp, e.timeStamp, 'touch');
  }));

  function waitContinue(html) {
    panel.innerHTML = html;
    panel.hidden = false;
    stage.classList.add('pointer');
    const btn = panel.querySelector('button');
    if (btn) btn.focus();
    return new Promise(res => {
      cont = () => { panel.hidden = true; stage.classList.remove('pointer'); res(); };
      if (btn) btn.addEventListener('click', () => { if (cont) { const c = cont; cont = null; c(); } }, { once: true });
    });
  }

  async function runTrial(t) {
    L.prime.textContent = t.prime;
    L.prime.lang = state.script === 'hant' ? 'zh-Hant' : 'zh-Hans';
    L.target.textContent = t.target;
    hiddenFlag = false;
    const fm = state.frameMs;
    const fF = frames(C.forward.ms), pF = frames(C.primeMs);

    let ts = await LAB.frame();
    layer(L.fwd);
    const fOn = ts;
    do { ts = await LAB.frame(); } while (ts - fOn < (fF - 0.5) * fm);
    layer(L.prime);
    const pOn = ts;
    do { ts = await LAB.frame(); } while (ts - pOn < (pF - 0.5) * fm);
    layer(L.target);
    const tOn = ts;

    const r = await new Promise(resolve => { armed = { tOn, resolve }; });
    await LAB.frame();
    layer(null);

    const correct = (r.resp === t.lex) ? 1 : 0;
    const primeMs = tOn - pOn;
    return {
      cond: t.cond, lex: t.lex, target: t.target, prime: t.prime, prime_gloss: t.gloss,
      response: r.resp, correct, rt: LAB.round(r.rt, 1), via: r.via,
      fwd_ms: LAB.round(pOn - fOn, 1), prime_ms: LAB.round(primeMs, 1), prime_frames: pF,
      timing_ok: Math.abs(primeMs - pF * fm) < fm * 0.6 ? 1 : 0,
      interrupted: hiddenFlag ? 1 : 0
    };
  }

  async function runBlock(trials, phase) {
    const label = phase === 'practice' ? 'Practice' : 'Main block';
    for (let i = 0; i < trials.length; i++) {
      setProgress(label, i, i + 1, trials.length);
      if (phase === 'main' && i === Math.floor(trials.length / 2)) {
        await waitContinue(
          `<div class="column"><h2 class="plain">Halfway there</h2>
           <p class="muted">Take a breath. Keep your fingers on the keys.</p>
           <div class="actions" style="justify-content:center"><button class="btn" type="button">Continue</button></div>
           <p class="key-hint">or press Space</p></div>`);
        await LAB.wait(600);
      }
      const row = await runTrial(trials[i]);
      row.phase = phase;
      row.trial = i + 1;
      state.data.push(row);
      if (phase === 'practice') {
        msg.className = 'stage-msg ' + (row.correct ? 'good' : 'bad');
        const want = trials[i].lex;
        const key = Object.keys(keyMap).find(k => keyMap[k] === want);
        const how = state.input === 'touch' ? `tap “${want === 'word' ? 'Real English word' : 'Not a word'}”` : `press ${key}`;
        msg.textContent = row.correct ? 'Correct'
          : want === 'word' ? `Not quite: ${trials[i].target} is a real English word (${how}).`
            : `Not quite: ${trials[i].target} is not an English word (${how}).`;
        await LAB.wait(row.correct ? 700 : 1600);
        msg.textContent = '';
      }
      setProgress(label, i + 1, i + 1, trials.length);
      await LAB.wait(500); // inter-trial interval, blank screen
    }
  }

  $('#btn-practice').addEventListener('click', async () => {
    state.startedAt = new Date().toISOString();
    // Full screen hides notifications and other tabs; harmless where unsupported.
    try { const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); if (p) p.catch(() => {}); } catch (e) { /* iOS */ }
    stage.hidden = false;
    document.body.style.overflow = 'hidden';
    panel.hidden = true;
    layer(null);
    setProgress('Practice', 0, 0, 8);
    state.frameMs = await LAB.measureFrame(45);
    await waitContinue(
      `<div class="column"><h2 class="plain">Practice: 8 trials</h2>
       <p class="muted">You'll get feedback after each answer. Be fast, but accurate.</p>
       <div class="actions" style="justify-content:center"><button class="btn" type="button">Start practice</button></div>
       <p class="key-hint">or press Space</p></div>`);
    await LAB.wait(800);
    await runBlock(buildPractice(), 'practice');

    const pr = state.data.filter(d => d.phase === 'practice');
    const pc = pr.filter(d => d.correct).length;
    state.frameMs = await LAB.measureFrame(30);
    setProgress('Main block', 0, 0, 80);
    await waitContinue(
      `<div class="column"><h2 class="plain">Practice done: ${pc} of ${pr.length} correct</h2>
       <p class="muted">Now the real thing: 80 trials, about four minutes, with no feedback and a short break halfway.</p>
       <div class="actions" style="justify-content:center"><button class="btn" type="button">Begin</button></div>
       <p class="key-hint">or press Space</p></div>`);
    await LAB.wait(800);
    await runBlock(buildMain(), 'main');

    stage.hidden = true;
    document.body.style.overflow = '';
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    show('s-after');
  });

  /* ---------- after the task ---------- */
  const after = $('#form-after');
  const savedEnglish = LAB.store.get('english', '');
  if (savedEnglish) {
    const r = after.querySelector(`input[name="english"][value="${savedEnglish}"]`);
    if (r) r.checked = true;
  }
  after.addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(after);
    state.awareness = f.get('aware') || '';
    state.english = f.get('english') || '';
    LAB.store.set('english', state.english);
    const summary = summarise();
    LAB.markDone(C.exp);
    renderResults(summary);
    show('s-results');
    const status = await LAB.submit({
      v: 1, exp: C.exp, pid: state.pid, session: state.session,
      submissionId: LAB.uid(), summary, trials: state.data.map(d => Object.assign({ pid: state.pid, session: state.session }, d))
    });
    reportUpload(status);
    loadClass(summary);
  });

  function summarise() {
    const main = state.data.filter(d => d.phase === 'main');
    const words = main.filter(d => d.lex === 'word');
    const nons = main.filter(d => d.lex === 'nonword');
    const valid = d => d.correct && d.rt >= 200 && d.rt <= 5000 && !d.interrupted && d.timing_ok;
    const rel = words.filter(d => d.cond === 'related' && valid(d)).map(d => d.rt);
    const ctl = words.filter(d => d.cond === 'control' && valid(d)).map(d => d.rt);
    const acc = main.filter(d => d.correct).length / main.length;
    const primeDur = main.map(d => d.prime_ms);
    const reasons = [];
    if (state.script === 'none') reasons.push('does not read Chinese');
    if (acc < 0.75) reasons.push('accuracy below 75%');
    if (rel.length < 8 || ctl.length < 8) reasons.push('too few usable trials');
    const s = {
      exp: C.exp, pid: state.pid, session: state.session,
      started_at: state.startedAt, submitted_at: new Date().toISOString(),
      list: state.list + 1, script: state.script, hand: state.hand, input: state.input,
      frame_hz: LAB.round(1000 / state.frameMs, 0),
      prime_ms_target: C.primeMs, prime_frames: frames(C.primeMs),
      prime_ms_median: LAB.round(LAB.median(primeDur), 1),
      timing_drops: main.filter(d => !d.timing_ok).length,
      acc: LAB.round(acc, 3),
      acc_words: LAB.round(words.filter(d => d.correct).length / words.length, 3),
      acc_nonwords: LAB.round(nons.filter(d => d.correct).length / nons.length, 3),
      rt_related: LAB.round(LAB.mean(rel), 1),
      rt_control: LAB.round(LAB.mean(ctl), 1),
      effect: LAB.round(LAB.mean(ctl) - LAB.mean(rel), 1),
      n_related: rel.length, n_control: ctl.length,
      awareness: state.awareness, english: state.english,
      include: reasons.length ? 0 : 1, exclude_reason: reasons.join('; ')
    };
    state.summary = s;
    return s;
  }

  /* ---------- results ---------- */
  function renderResults(s) {
    $('#r-code').textContent = state.pid;
    const eff = s.effect;
    $('#r-stats').innerHTML = `
      <div class="stat key"><span class="stat-label">Priming effect</span>
        <span class="stat-value">${isFinite(eff) ? LAB.signed(eff) : '–'}<small>ms</small></span>
        <span class="stat-note">unrelated − translation</span></div>
      <div class="stat"><span class="stat-label">After a translation</span>
        <span class="stat-value">${isFinite(s.rt_related) ? Math.round(s.rt_related) : '–'}<small>ms</small></span>
        <span class="stat-note">${s.n_related} words</span></div>
      <div class="stat"><span class="stat-label">After an unrelated word</span>
        <span class="stat-value">${isFinite(s.rt_control) ? Math.round(s.rt_control) : '–'}<small>ms</small></span>
        <span class="stat-note">${s.n_control} words</span></div>
      <div class="stat"><span class="stat-label">Accuracy</span>
        <span class="stat-value">${Math.round(s.acc * 100)}<small>%</small></span>
        <span class="stat-note">words ${Math.round(s.acc_words * 100)}% · non-words ${Math.round(s.acc_nonwords * 100)}%</span></div>`;
    let sentence;
    if (!isFinite(eff)) sentence = 'There were not enough correct answers to calculate your result.';
    else if (Math.round(eff) > 0) sentence = `You responded <strong>${Math.round(eff)} ms faster</strong> to English words after their translation than after an unrelated word.`;
    else if (Math.round(eff) < 0) sentence = `You responded <strong>${Math.round(-eff)} ms slower</strong> to English words after their translation than after an unrelated word.`;
    else sentence = 'You responded equally fast to English words after their translation and after an unrelated word.';
    $('#r-sentence').innerHTML = sentence;
    const timing = $('#r-timing');
    if (timing) {
      timing.textContent = `Your screen refreshes at ${s.frame_hz} Hz, so the Chinese word was shown for ${s.prime_frames} frames: ${Math.round(s.prime_ms_median)} ms on average.` +
        (s.timing_drops ? ` ${s.timing_drops} trial${s.timing_drops > 1 ? 's' : ''} ran long because the browser skipped a frame; those were left out.` : '');
    }
    const ex = $('#r-excluded');
    if (s.exclude_reason) {
      ex.hidden = false;
      ex.textContent = `Your run is saved but not counted in the class average (${s.exclude_reason}).`;
    }
    $('#btn-csv').onclick = () => LAB.download(`lt5461-${C.exp}-${state.pid}.csv`, LAB.toCSV(state.data.map(d => Object.assign({ pid: state.pid, exp: C.exp }, d))));
  }

  function reportUpload(st) {
    const el = $('#r-upload');
    if (st.offline) el.textContent = 'Your results are saved on this device. If your instructor asks for them, use “Download my data” below.';
    else if (st.pending) el.textContent = 'Could not reach the class server yet; your results are saved on this device and will be sent next time this page is opened.';
    else el.textContent = 'Your results were added to the class data anonymously.';
  }

  async function loadClass(summary) {
    const host = $('#r-class'), status = $('#r-class-status');
    const dot = status.querySelector('.live-dot'), label = status.querySelector('.label');
    if (!LAB.connected()) { $('#r-class-wrap').hidden = true; return; }
    label.textContent = 'Loading the class…';
    try {
      const json = await LAB.fetchClass(C.exp, state.session);
      const rows = json.rows.filter(r => r.pid !== state.pid);
      const vals = rows.map(r => ({ v: LAB.num(r.effect), excluded: String(r.include) !== '1' }));
      vals.push({ v: summary.effect, you: true, excluded: !summary.include });
      const incl = vals.filter(v => !v.excluded && isFinite(v.v));
      dot.classList.remove('off');
      label.textContent = `${vals.length} ${vals.length === 1 ? 'person' : 'people'} so far · updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      LAB.stripPlot(host, [{ label: '', values: vals }], {
        domain: [-40, 120],
        xLabel: 'Priming effect (ms): positive = faster after a translation',
        ariaLabel: `Class priming effects: ${incl.length} people, mean ${Math.round(LAB.mean(incl.map(v => v.v)))} ms`
      });
    } catch (e) {
      dot.classList.add('off');
      label.textContent = 'Could not load the class results. Try again in a moment.';
    }
  }
  $('#btn-refresh').addEventListener('click', () => state.summary && loadClass(state.summary));

  // Anything left in the outbox from an earlier offline run goes now.
  LAB.flush();
  show('s-intro');
})();
