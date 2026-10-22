/* LT5461 — colour task: "Do colour names shape perception?"
   Task 1: name 14 colours (each twice, typed, any words). Task 2: 8 practice
   + 60 colour-matching trials (2AFC): which bottom square is identical to the
   top one; keys 1/2 or a click; fixation 400 ms, colours until response (3 s
   at most), 350 ms between trials; RT from the frame the colours appeared.
   Then the student's own results and the debriefing. Progress is kept on the
   device after every trial, so a reload can continue; the data are sent
   before the results are drawn. ?test sends to the test class; ?test&demo
   adds a button that fills the rest with simulated answers (marked simulated). */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const K = window.COLOUR_CORE, A = window.COLOUR, STIM = K.STIM;
  const now = () => performance.now();
  const esc = A.esc;
  const DEMO = !!LAB.isTest && LAB.params.has('demo');
  const KEY = 'colour-progress', MINE = 'colour-mine';

  const S = { pid: LAB.pid(), session: LAB.session(), phase: 'intro', simulated: false };

  function show(id) {
    $$('.screen').forEach(s => { s.hidden = s.id !== id; });
    window.scrollTo(0, 0);
    const h = document.querySelector('#' + id + ' h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
  const radios = (name, opts) => `<div class="choices${opts.length > 3 ? ' cols-2' : ''}">` + opts.map(([v, l]) => `<label class="choice"><input type="radio" name="${name}" value="${v}"><span>${l}</span></label>`).join('') + '</div>';
  const save = () => { const P = Object.assign({}, S); delete P.cur; LAB.store.set(KEY, P); };
  const demoBtn = () => DEMO ? `<button class="btn-quiet cl-demo-skip" type="button" data-action="simulate">Demo: fill the rest with simulated answers</button>` : '';

  /* ---------- welcome ---------- */
  function intro() {
    const prev = LAB.store.get(KEY, null), mine = LAB.store.get(MINE, null);
    const resume = prev && prev.session === S.session && prev.phase !== 'intro' && prev.phase !== 'done' ? prev : null;
    $('#s-intro').innerHTML = `<div class="column">
        ${DEMO ? '<p class="cl-demo">Demo mode: this run goes to the test class, not your real class.</p>' : ''}
        <h1>Do colour names shape perception?</h1>
        <p class="cl-sub">LT5461 — Cognition and Language Differences · about 8–10 minutes</p>
        <p class="lead">You will complete two short tasks involving colours. In the first task, you will name different colours. In the second, you will identify matching colours as quickly and accurately as possible. Please complete both tasks individually, without discussing your responses with classmates.</p>
        <p class="cl-note">Please use a laptop or desktop computer, with the screen at full brightness and no colour filter or night mode. Colours and reaction times can vary between devices.</p>
        ${resume ? `<div class="cl-resume"><p><strong>You have an unfinished run on this device.</strong></p><div class="actions"><button class="btn" type="button" data-action="resume">Continue where you left off <span class="arrow" aria-hidden="true">→</span></button><button class="btn-quiet" type="button" data-action="restart">Start again</button></div></div>` : ''}
        ${mine && mine.session === S.session && !resume ? `<p class="cl-note"><button class="btn-quiet" type="button" data-action="mine">See your results from this class again</button></p>` : ''}
        <form id="form-bg" novalidate>
          <fieldset><legend>Mandarin is …</legend>${radios('mandarin', [['first', 'my first language'], ['dominant', 'my dominant language, but not my first'], ['additional', 'an additional language'], ['none', 'not a language I speak']])}</fieldset>
          <fieldset><legend>Which Chinese characters do you normally use?</legend>${radios('script', [['simplified', 'Simplified'], ['traditional', 'Traditional'], ['both', 'Both'], ['neither', 'Neither']])}</fieldset>
          <fieldset><legend>Do you have any difficulty seeing colours? <span class="cl-optional">(optional)</span></legend>${radios('vision', [['no', 'No'], ['yes', 'Yes'], ['unsure', 'Not sure']])}</fieldset>
          <p class="cl-consent">Taking part is voluntary. Your responses are anonymous: they are stored with a random code, never your name or student number, and are used for a classroom demonstration. You may stop at any time.</p>
          <p class="form-error" id="bg-error" role="alert"></p>
          <div class="actions"><button class="btn" type="submit">I agree — start <span class="arrow" aria-hidden="true">→</span></button></div>
        </form></div>`;
    show('s-intro');
    $('#form-bg').addEventListener('submit', e => {
      e.preventDefault();
      const f = new FormData(e.target);
      if (!f.get('mandarin') || !f.get('script')) { $('#bg-error').textContent = 'Please answer the first two questions.'; return; }
      Object.assign(S, { meta: { mandarin: f.get('mandarin'), script: f.get('script'), vision: f.get('vision') || '' }, startedAt: new Date().toISOString(), t0wall: Date.now(), resumed: 0,
        order: K.namingOrder(), practiceList: K.withSides(K.PRACTICE), mainList: K.withSides(K.MAIN), naming: [], practice: [], main: [], input: [] });
      LAB.submit({ v: 1, exp: 'colour_start', pid: S.pid, session: S.session, submissionId: LAB.uid(), summary: { exp: 'colour_start', started_at: S.startedAt, mandarin: S.meta.mandarin }, trials: [] });
      S.phase = 'naming-intro'; save(); namingIntro();
    });
  }

  /* ---------- task 1: naming ---------- */
  function namingIntro() {
    $('#s-task').innerHTML = `<div class="column"><p class="cl-step">Task 1 of 2</p><h1>Naming colours</h1>
        <p class="lead">You will see 28 colours, one at a time.</p>
        <p>What would you naturally call this colour in Mandarin? Please enter the first colour name that comes to mind, then press Enter.</p>
        <div class="actions"><button class="btn" type="button" data-action="naming">Start <span class="arrow" aria-hidden="true">→</span></button></div></div>`;
    show('s-task');
  }
  function naming() {
    const k = S.naming.length;
    if (k >= 28) { S.phase = 'disc-intro'; save(); discIntro(); return; }
    S.phase = 'naming';
    const it = S.order[k], st = STIM[it.i];
    $('#s-task').innerHTML = `<div class="column cl-trial">
        <div class="cl-top"><span>Naming ${k + 1} of 28</span><span class="cl-track" aria-hidden="true"><span style="transform:scaleX(${k / 28})"></span></span></div>
        <div class="cl-stage cl-naming"><span class="cl-patch" style="background:${st.hex}" role="img" aria-label="Colour patch"></span></div>
        <form class="cl-name" id="form-name" novalidate autocomplete="off">
          <label for="cl-input">What would you naturally call this colour in Mandarin?</label>
          <div class="cl-name-row"><input id="cl-input" type="text" lang="zh" maxlength="20" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="next"><button class="btn" type="submit">Next</button></div>
          <p class="form-error" id="name-error" role="alert"></p>
        </form>${demoBtn()}</div>`;
    show('s-task');
    const inp = $('#cl-input'), t0 = now(); let first = null, composing = false;
    inp.focus();
    inp.addEventListener('input', () => { if (first === null) first = now() - t0; });
    inp.addEventListener('compositionstart', () => { composing = true; if (first === null) first = now() - t0; });
    inp.addEventListener('compositionend', () => { composing = false; });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (!(e.isComposing || composing || e.keyCode === 229)) submit(); } });
    $('#form-name').addEventListener('submit', e => { e.preventDefault(); submit(); });
    function submit() {
      const v = inp.value.trim();
      if (!v) { $('#name-error').textContent = 'Please type a colour name.'; inp.focus(); return; }
      S.naming.push({ trial: k + 1, i: it.i, pass: it.pass, raw: v.slice(0, 20), rt: Math.round(now() - t0), firstKey: first === null ? null : Math.round(first), at: Date.now() - S.t0wall });
      save(); naming();
    }
  }

  /* ---------- task 2: matching ---------- */
  function discIntro() {
    $('#s-task').innerHTML = `<div class="column"><p class="cl-step">Task 2 of 2</p><h1>Matching colours</h1>
        <p class="lead">Which of the two bottom squares is identical to the top square? Press <kbd>1</kbd> for the left square or <kbd>2</kbd> for the right square. Respond as quickly and accurately as possible.</p>
        <p>You can also click the square. First 8 practice trials, with feedback.</p>
        <div class="actions"><button class="btn" type="button" data-action="practice">Start the practice <span class="arrow" aria-hidden="true">→</span></button></div></div>`;
    show('s-task');
  }
  const stage = () => `<div class="column cl-trial"><div class="cl-top"><span id="cl-prog"></span><span class="cl-track" aria-hidden="true"><span id="cl-bar"></span></span></div>
      <div class="cl-stage cl-disc" id="cl-stage"><span class="cl-fix" id="cl-fix" hidden>+</span>
        <div class="cl-sq cl-ref" id="cl-ref" hidden></div>
        <div class="cl-pair" id="cl-pair" hidden><button type="button" class="cl-sq cl-opt" data-resp="1" aria-label="Left square (1)"></button><button type="button" class="cl-sq cl-opt" data-resp="2" aria-label="Right square (2)"></button></div>
        <div class="cl-keys" id="cl-keys" hidden><span>1</span><span>2</span></div>
        <p class="cl-fb" id="cl-fb" role="status"></p></div>${demoBtn()}</div>`;
  function block(kind) {
    S.phase = kind; save();
    $('#s-task').innerHTML = stage(); show('s-task');
    next();
  }
  function next() {
    const kind = S.phase, list = kind === 'practice' ? S.practiceList : S.mainList, done = kind === 'practice' ? S.practice : S.main;
    const k = done.length;
    if (k >= list.length) {
      if (kind === 'practice') { S.phase = 'main-intro'; save(); mainIntro(); } else finish();
      return;
    }
    $('#cl-prog').textContent = kind === 'practice' ? `Practice ${k + 1} of 8` : `Trial ${k + 1} of 60`;
    $('#cl-bar').style.transform = `scaleX(${k / list.length})`;
    const t = list[k], [L, R] = t.match === 'L' ? [t.ref, t.dist] : [t.dist, t.ref];
    $('#cl-ref').style.background = STIM[t.ref].hex;
    const opts = $$('#cl-pair .cl-opt'); opts[0].style.background = STIM[L].hex; opts[1].style.background = STIM[R].hex;
    ['#cl-ref', '#cl-pair', '#cl-keys'].forEach(id => { $(id).hidden = true; });
    $('#cl-fb').textContent = ''; $('#cl-fix').hidden = false;
    S.cur = { t, k, onset: null, shownAt: null, done: false, token: (S.cur ? S.cur.token : 0) + 1 };
    const token = S.cur.token;
    setTimeout(() => {
      if (!S.cur || S.cur.token !== token) return;
      $('#cl-fix').hidden = true; ['#cl-ref', '#cl-pair', '#cl-keys'].forEach(id => { $(id).hidden = false; });
      S.cur.shownAt = now(); S.cur.at = Date.now() - S.t0wall;
      const mark = () => { if (S.cur && S.cur.token === token && S.cur.onset === null) S.cur.onset = now(); };
      requestAnimationFrame(mark); setTimeout(mark, 100);
      S.cur.timer = setTimeout(() => respond(null, 'timeout'), 3000);
    }, 400);
  }
  function respond(resp, mod) {
    const C = S.cur;
    if (!C || C.done || C.shownAt === null) return;
    C.done = true; clearTimeout(C.timer);
    // whole milliseconds, as stored, so the student's page and the class dashboard compute from the same numbers
    const on = C.onset !== null ? C.onset : C.shownAt, rt = resp ? Math.round(Math.max(0, now() - on)) : NaN;
    if (mod === 'k' || mod === 'm') S.input.push(mod);
    const kind = S.phase, rec = { tid: C.t.tid, trial: C.k + 1, match: C.t.match, resp, rt, mod: resp ? mod : '', at: C.at };
    (kind === 'practice' ? S.practice : S.main).push(rec);
    save();
    ['#cl-ref', '#cl-pair', '#cl-keys'].forEach(id => { $(id).hidden = true; });
    if (kind === 'practice') {
      const ok = resp && (resp === '1') === (C.t.match === 'L');
      $('#cl-fb').textContent = !resp ? 'Too slow — try to answer within 3 seconds.' : ok ? 'Correct' : `Not quite: the ${C.t.match === 'L' ? 'left' : 'right'} square was the match.`;
      $('#cl-fb').className = 'cl-fb ' + (ok ? 'ok' : 'no');
      setTimeout(() => { $('#cl-fb').textContent = ''; setTimeout(next, 350); }, 900);
    } else setTimeout(next, 350);
  }
  function mainIntro() {
    $('#s-task').innerHTML = `<div class="column"><h1>Practice finished</h1><p class="lead">Now 60 trials, without feedback. Respond as quickly and accurately as possible.</p>
        <div class="actions"><button class="btn" type="button" data-action="main">Start <span class="arrow" aria-hidden="true">→</span></button></div></div>`;
    show('s-task');
  }

  /* ---------- demo: the rest with simulated answers (marked simulated) ---------- */
  function simulateRest() {
    if (S.cur) { clearTimeout(S.cur.timer); S.cur.done = true; }
    const r = Math.random, names = i => (i < 6 ? '绿' : i < 8 ? '青' : '蓝');
    while (S.naming.length < 28) { const it = S.order[S.naming.length]; S.naming.push({ trial: S.naming.length + 1, i: it.i, pass: it.pass, raw: names(it.i), rt: 3000, firstKey: 800, at: 0 }); }
    [['practice', S.practiceList, S.practice], ['main', S.mainList, S.main]].forEach(([, list, done]) => {
      while (done.length < list.length) { const t = list[done.length], ok = r() < 0.95; done.push({ tid: t.tid, trial: done.length + 1, match: t.match, resp: ok === (t.match === 'L') ? '1' : '2', rt: Math.round(450 + r() * 400), mod: 'k', at: 0 }); }
    });
    S.simulated = true; finish();
  }

  /* ---------- the end: send, then show the results ---------- */
  function participant() {
    const byTid = new Map(K.MAIN.concat(K.PRACTICE).map(t => [t.tid, t]));
    const full = (recs) => recs.map(x => Object.assign({}, byTid.get(x.tid), x));
    return { pid: S.pid, source: 'self', meta: Object.assign({}, S.meta, { durationMs: Date.now() - S.t0wall, input: [...new Set(S.input)].join('+') }),
      naming: S.naming.slice(), practice: full(S.practice), main: full(S.main) };
  }
  function finish() {
    S.phase = 'done';
    const P = A.analyse(participant()), sid = LAB.uid();
    const row = Object.assign({ exp: 'colour', mandarin: S.meta.mandarin, script: S.meta.script, colour_vision: S.meta.vision, started_at: S.startedAt, submitted_at: new Date().toISOString(),
      duration_ms: P.meta.durationMs, input: P.meta.input || 'none', resumed: S.resumed, stimuli: 'oklch-0.70-0.10-h160-264-v1' }, A.packFields(P), {
      labels: P.lab.map(l => l.stable || '?').join(' ').slice(0, 200), consistency: LAB.round(P.consistency, 3), n_categories: P.nCats, accuracy: LAB.round(P.accuracy, 3),
      within_n: P.within.n, within_valid: P.within.valid, within_rt: isFinite(P.within.median) ? Math.round(P.within.median) : '',
      between_n: P.between.n, between_valid: P.between.valid, between_rt: isFinite(P.between.median) ? Math.round(P.between.median) : '',
      ambiguous_n: P.ambiguous.n, enough: P.enough ? 1 : 0, advantage: P.enough ? Math.round(P.adv) : '', include: 1 });
    if (S.simulated) row.simulated = 1;
    const trials = P.naming.map(t => ({ phase: 'naming', trial: t.trial, colour_id: STIM[t.i].id, colour_hex: STIM[t.i].hex, presentation: t.pass, response_raw: t.raw, response_normalised: K.normalise(t.raw), rt_ms: Math.round(t.rt), first_key_ms: isFinite(t.firstKey) ? Math.round(t.firstKey) : '', t_ms: t.at }))
      .concat(P.practice.map(t => ({ phase: 'practice', trial: t.trial, trial_id: t.tid, pair_id: t.pair, reference_id: STIM[t.ref].id, distractor_id: STIM[t.dist].id, steps: t.steps, ciede2000: t.de, match_side: t.match, response: t.resp || 'timeout', rt_ms: isFinite(t.rt) ? Math.round(t.rt) : '', modality: t.mod, t_ms: t.at })))
      .concat(P.trials.map(t => ({ phase: 'main', trial: t.trial, trial_id: t.tid, pair_id: t.pair, reference_id: STIM[t.ref].id, reference_hex: STIM[t.ref].hex, distractor_id: STIM[t.dist].id, distractor_hex: STIM[t.dist].hex,
        steps: t.steps, ciede2000: t.de, match_side: t.match, response: t.resp || 'timeout', correct: t.correct ? 1 : 0, rt_ms: isFinite(t.rt) ? Math.round(t.rt) : '', modality: t.mod, t_ms: t.at, category: t.cat })));
    LAB.markDone('colour');
    LAB.store.set(MINE, { session: S.session, row: Object.assign({ pid: S.pid }, row) });
    LAB.store.set(KEY, null);
    const status = st => { const el = $('#cl-save'); if (!el) return; el.textContent = st; };
    document.addEventListener('lab:sent', ev => { if (ev.detail && ev.detail.submissionId === sid) status('Your responses were saved.'); });
    LAB.submit({ v: 1, exp: 'colour', pid: S.pid, session: S.session, submissionId: sid, summary: row, trials }).then(st => {
      if (!LAB.connected()) status('This page is not connected to the class data store, so nothing was sent. Please tell your instructor.');
      else if (st.pending) status('Not saved yet: your responses are kept on this device and will be sent automatically. Please keep this page open for a minute.');
    });
    try { results(P); } catch (e) { $('#s-done').innerHTML = '<div class="column"><h1>Thank you</h1><p class="lead">Your responses are being saved. Your results could not be shown on this device.</p><p id="cl-save" role="status"></p></div>'; show('s-done'); }
  }
  function results(P) {
    $('#s-done').innerHTML = `<div class="column cl-results">
        ${S.simulated ? '<p class="cl-demo">Demo: part of this run was filled with simulated answers.</p>' : ''}
        <h1>Do colour names shape perception?</h1><p class="cl-sub">Your results and what they mean</p>
        <p class="cl-save" id="cl-save" role="status">Saving your responses…</p>
        <div id="cl-mine"></div>
        ${DEBRIEF}
        <div class="actions"><button class="btn-quiet" type="button" data-action="csv">Download your data (CSV)</button></div></div>`;
    show('s-done');
    A.mountPersonal($('#cl-mine'), P);   // after show(), so the chart measures its real width
    S.last = P;
  }
  const DEBRIEF = `<section class="cl-panel cl-debrief"><h2>About this experiment</h2>
      <h3>Why did we conduct this experiment?</h3>
      <p>Languages divide the colour spectrum into categories, but those categories are not necessarily identical across speakers. We wanted to investigate whether the colour names you use are related to how quickly you distinguish different shades.</p>
      <h3>What is special about 青?</h3>
      <p>Consider the following Mandarin expressions:</p>
      <ul lang="zh-Hans"><li><b>青天</b> — blue sky</li><li><b>青菜</b> — green vegetables</li><li><b>青色</b> — what colour comes to mind?</li><li><b>蓝色</b> and <b>绿色</b> — when would you prefer these terms?</li></ul>
      <p>The interpretation of 青 depends partly on linguistic context and conventional usage. Different Mandarin speakers may also use colour terms differently.</p>
      <h3>What would a categorical advantage mean?</h3>
      <p>If colour pairs receiving different labels are discriminated faster than physically comparable pairs receiving the same label, the results would be consistent with an association between linguistic categorization and perceptual decision-making.</p>
      <h3>Does this prove that language changes vision?</h3>
      <p>No. Colour discrimination also depends on perceptual distance, attention, task demands, and other factors. Moreover, naming the colours before discrimination may have activated linguistic categories. The experiment cannot establish that lexical categories caused changes in visual perception.</p>
      <p class="cl-final">When two people see exactly the same colours but name them differently, do they also process those colours differently?</p>
      <p>Compare and discuss your results with classmates once everyone has finished.</p></section>`;

  /* ---------- controls ---------- */
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-action], [data-resp]');
    if (!b) return;
    if (b.dataset.resp) { if (S.phase === 'practice' || S.phase === 'main') respond(b.dataset.resp, 'm'); return; }
    const a = b.dataset.action;
    if (a === 'naming') naming();
    else if (a === 'practice') block('practice');
    else if (a === 'main') block('main');
    else if (a === 'simulate') simulateRest();
    else if (a === 'resume') { Object.assign(S, LAB.store.get(KEY, {}), { resumed: 1, cur: null }); S.t0wall = S.t0wall || Date.now(); ({ 'naming-intro': namingIntro, naming, 'disc-intro': discIntro, practice: () => block('practice'), 'main-intro': mainIntro, main: () => block('main') }[S.phase] || namingIntro)(); }
    else if (a === 'restart') { LAB.store.set(KEY, null); intro(); }
    else if (a === 'mine') { const m = LAB.store.get(MINE, null); if (m) { const P = A.analyse(A.parseRow(m.row)); S.simulated = String(m.row.simulated) === '1'; results(P); $('#cl-save').textContent = ''; } }
    else if (a === 'csv' && S.last) {
      const P = S.last; P.label = 'you';
      const rows = A.namingRows([P]).map(r => Object.assign({ task: 'naming' }, r)).concat(A.discRows([P]).map(r => Object.assign({ task: 'matching' }, r)));
      LAB.download(`colour-task-my-data.csv`, LAB.toCSV(rows));
    }
  });
  window.addEventListener('keydown', e => {
    if ((S.phase !== 'practice' && S.phase !== 'main') || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key === '1' || e.code === 'Numpad1' ? '1' : e.key === '2' || e.code === 'Numpad2' ? '2' : null;
    if (k) { e.preventDefault(); respond(k, 'k'); }
  });

  intro();
  LAB.flush();
})();
