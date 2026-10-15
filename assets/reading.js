/* LT5461 — reading task: self-paced reading of two-clause passages with or
   without "because" (after Millis & Just, 1994), then a word-recognition probe
   and, on some passages, a yes/no comprehension question.

   Timing: each word's reading time runs from the frame on which it appeared
   (requestAnimationFrame, with a timer backstop for hidden windows) to the
   key press that replaced it (performance.now() in the key handler), so the
   time belongs to the word that was on screen. A held key's auto-repeat is ignored, and the
   space bar must be released before it counts again.

   List (A/B): at the start the page reads how many students of this class
   have started each list (exp reading_start) and takes the smaller one (a coin
   flip on a tie or if the class list cannot be read); ?list=A|B forces it, and
   a reload keeps the student's list. Data: one row per student (exp reading)
   with every trial packed into t01–t30; one row per trial in reading_trials. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const R = window.READING;
  const now = () => performance.now();
  const stamp = () => now();   // read in the handler: the page does nothing else while it waits for a key
  const mask = w => w.replace(/[\p{L}\p{N}]/gu, '–');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const state = { pid: LAB.pid(), session: LAB.session(), startedAt: null, t0: 0, list: null, assigned: null, seq: [], k: 0, trials: [], events: [], input: new Set(), phase: 'intro' };

  function show(id) {
    $$('.screen').forEach(s => { s.hidden = s.id !== id; });
    window.scrollTo(0, 0);
    const h = document.querySelector('#' + id + ' h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
  const btn = (label, action, primary) => `<button class="btn${primary ? '' : ' btn-secondary'}" type="button" data-action="${action}">${label}</button>`;

  /* ---------- intro ---------- */
  $('#s-intro').innerHTML = `<div class="column">
      <h1>Reading task</h1>
      <p class="lead">This is an anonymous class activity and is not graded.</p>
      <p>You will read short passages one word at a time. Press the <kbd>space bar</kbd> to see the next word; the word before it disappears again. Read at your normal pace.</p>
      <p>After each passage a single word appears. Press <kbd>T</kbd> if that exact word was in the passage, <kbd>F</kbd> if it was not. After some passages there is also a yes/no question: press <kbd>Y</kbd> or <kbd>N</kbd>.</p>
      <p>It takes about 8 minutes and begins with two practice passages. Please use a computer with a keyboard, and stay on this page until the end.</p>
      <p class="small muted">Your reading times and answers are stored with a random code, not your name or student number, and are used only for teaching and class discussion.</p>
      <div class="actions">${btn('Start practice <span class="arrow" aria-hidden="true">→</span>', 'begin', true)}</div>
      <p class="small muted" id="intro-status" role="status"></p>
    </div>`;

  /* ---------- the list ---------- */
  async function chooseList() {
    const forced = (LAB.params.get('list') || '').toUpperCase();
    if (forced === 'A' || forced === 'B') return [forced, 'url'];
    const saved = (LAB.store.get('reading-list', {}) || {})[state.session];
    if (saved) return [saved, 'kept'];
    try {
      const res = await Promise.race([LAB.fetchClass('reading_start', state.session), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 5000))]);
      const lists = new Map();
      (res.rows || []).forEach(r => { if (r.list === 'A' || r.list === 'B') lists.set(r.pid, r.list); });
      if (lists.has(state.pid)) return [lists.get(state.pid), 'kept'];
      const a = [...lists.values()].filter(l => l === 'A').length, b = lists.size - a;
      if (a !== b) return [a < b ? 'A' : 'B', 'balanced'];
    } catch (e) { /* fall through to a coin flip */ }
    return [Math.random() < 0.5 ? 'A' : 'B', 'random'];
  }

  async function begin() {
    const b = $('#s-intro [data-action=begin]');
    b.disabled = true; $('#intro-status').textContent = 'Preparing…';
    let items;
    try { items = await R.loadItems(); }
    catch (e) { b.disabled = false; $('#intro-status').textContent = 'The passages could not be loaded. Check the connection and try again.'; return; }
    [state.list, state.assigned] = await chooseList();
    const saved = LAB.store.get('reading-list', {}) || {}; saved[state.session] = state.list; LAB.store.set('reading-list', saved);
    state.seq = R.sequence(items, state.list);
    state.startedAt = new Date().toISOString(); state.t0 = now();
    if (state.assigned !== 'kept') LAB.submit({ v: 1, exp: 'reading_start', pid: state.pid, session: state.session, submissionId: LAB.uid(),
      summary: { exp: 'reading_start', list: state.list, list_assigned: state.assigned, started_at: state.startedAt }, trials: [] });
    ready();
  }

  /* ---------- one trial ---------- */
  const progress = () => {
    const k = state.k, n = state.seq.length;
    $('#r-progress').textContent = k < 2 ? `Practice ${k + 1} of 2` : `Passage ${k - 1} of ${n - 2}`;
    $('#r-bar').style.transform = `scaleX(${k / n})`;
  };
  function ready() {
    state.phase = 'ready';
    const it = state.seq[state.k];
    state.cur = { item: it, focus: 0, hiddenMs: 0, start: now() };
    $('#s-trial').innerHTML = `<div class="column rt">
        <div class="rt-top"><span id="r-progress"></span><span class="rt-track" aria-hidden="true"><span id="r-bar"></span></span></div>
        <div class="rt-stage" id="r-stage"><p class="rt-ready">Press the <kbd>space bar</kbd> to start the passage.</p></div>
        <div class="rt-tap">${btn('Start', 'space', false)}</div>
      </div>`;
    show('s-trial'); progress();
  }

  function beginReading() {
    const C = state.cur, it = C.item;
    [C.w1, C.w2] = R.words(it, it.connective);
    C.rt1 = new Array(C.w1.length).fill(NaN); C.rt2 = new Array(C.w2.length).fill(NaN);
    C.line = 1; C.vis = -1; C.onset = null;
    const row = (ws, n) => `<p class="rt-line" id="r-line${n}" aria-hidden="true">${ws.map((w, i) => `<span data-i="${i}">${esc(mask(w))}</span>`).join(' ')}</p>`;
    $('#r-stage').innerHTML = row(C.w1, 1) + `<div id="r-l2"></div><p class="visually-hidden" id="r-live" aria-live="polite"></p>`;
    $('.rt-tap').innerHTML = btn('Next word', 'space', false);
    state.phase = 'reading';
    $('#r-stage').classList.add('reading');
  }
  // Show the next word (or the second clause's empty line); time the word that was on screen.
  function advance(e) {
    const C = state.cur, t = stamp(e);
    const ws = C.line === 1 ? C.w1 : C.w2, rts = C.line === 1 ? C.rt1 : C.rt2;
    if (C.vis >= 0) {
      const on = C.onset !== null ? C.onset : C.shownAt;
      rts[C.vis] = Math.max(0, t - on);
      const sp = document.querySelector(`#r-line${C.line} span[data-i="${C.vis}"]`); if (sp) { sp.textContent = mask(ws[C.vis]); sp.classList.remove('on'); }
    }
    if (C.vis + 1 < ws.length) {
      C.vis++;
      const sp = document.querySelector(`#r-line${C.line} span[data-i="${C.vis}"]`);
      sp.textContent = ws[C.vis]; sp.classList.add('on');
      $('#r-live').textContent = ws[C.vis];
      onsetNextFrame(C);
      return;
    }
    if (C.line === 1) {   // the second clause appears, masked; the next press shows its first word
      C.line = 2; C.vis = -1; C.onset = null;
      $('#r-l2').outerHTML = `<p class="rt-line rt-line2" id="r-line2" aria-hidden="true">${C.w2.map((w, i) => `<span data-i="${i}">${esc(mask(w))}</span>`).join(' ')}</p>`;
      return;
    }
    probe();
  }
  function onsetNextFrame(C) {
    C.onset = null; C.shownAt = now();
    const token = C.token = (C.token || 0) + 1;     // a late callback must not stamp the next word
    const mark = t => { if (C.onset === null && C.token === token) C.onset = t; };
    requestAnimationFrame(() => mark(now()));
    setTimeout(() => mark(now()), 100);          // hidden windows stall rAF
  }

  function probe() {
    const C = state.cur;
    state.phase = 'probe';
    $('#r-stage').classList.remove('reading');
    $('#r-stage').innerHTML = `<p class="rt-q">Did this word appear in the passage?</p><p class="rt-probe" id="r-probe">${esc(C.item.probe)}</p><p class="rt-keys"><kbd>T</kbd> it did &nbsp;·&nbsp; <kbd>F</kbd> it did not</p>`;
    $('.rt-tap').innerHTML = btn('T · it did', 'T', false) + btn('F · it did not', 'F', false);
    onsetNextFrame(C);
  }
  function answerProbe(yes, e) {
    const C = state.cur, t = stamp(e);
    C.probeRT = Math.max(0, t - (C.onset !== null ? C.onset : C.shownAt)); C.probeResp = yes;
    if (C.item.ask) question(); else finish();
  }
  function question() {
    const C = state.cur;
    state.phase = 'question';
    $('#r-stage').innerHTML = `<p class="rt-question">${esc(C.item.q)}</p><p class="rt-keys"><kbd>Y</kbd> yes &nbsp;·&nbsp; <kbd>N</kbd> no</p>`;
    $('.rt-tap').innerHTML = btn('Y · yes', 'Y', false) + btn('N · no', 'N', false);
    onsetNextFrame(C);
  }
  function answerQuestion(yes, e) {
    const C = state.cur, t = stamp(e);
    C.qRT = Math.max(0, t - (C.onset !== null ? C.onset : C.shownAt)); C.qResp = yes;
    finish();
  }
  function finish() {
    const C = state.cur, it = C.item;
    state.trials.push({ pos: state.k + 1, id: it.id, type: it.type, connective: it.connective, probe: it.probe, present: it.present,
      probeResp: C.probeResp, probeRT: C.probeRT, probeCorrect: C.probeResp === it.present,
      ask: it.ask, qResp: it.ask ? C.qResp : null, qRT: it.ask ? C.qRT : null, qCorrect: it.ask ? C.qResp === it.answer : null,
      w1: C.w1, w2: C.w2, rt1: C.rt1, rt2: C.rt2, focus: C.focus, hiddenMs: Math.round(C.hiddenMs), ms: Math.round(now() - C.start) });
    state.k++;
    if (state.k === 2) { practiceDone(); return; }
    if (state.k < state.seq.length) ready(); else done();
  }
  function practiceDone() {
    state.phase = 'between';
    $('#r-stage').innerHTML = `<h1 class="rt-h">Practice finished</h1><p>Now the task begins: ${state.seq.length - 2} passages. Read at your normal pace.</p><p class="rt-ready">Press the <kbd>space bar</kbd> to continue.</p>`;
    $('.rt-tap').innerHTML = btn('Continue', 'space', false);
    $('#r-bar').style.transform = `scaleX(${2 / state.seq.length})`;
  }

  /* ---------- keys, taps, focus ---------- */
  let spaceHeld = false;
  function act(action, e) {
    const p = state.phase;
    if (action === 'space') {
      if (p === 'ready') beginReading();
      else if (p === 'reading') advance(e);
      else if (p === 'between') ready();
    } else if (p === 'probe' && (action === 'T' || action === 'F')) answerProbe(action === 'T', e);
    else if (p === 'question' && (action === 'Y' || action === 'N')) answerQuestion(action === 'Y', e);
  }
  window.addEventListener('keydown', e => {
    if (state.phase === 'intro' || state.phase === 'done') return;
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      if (e.repeat || spaceHeld) return;
      spaceHeld = true; state.input.add('keyboard'); act('space', e);
      return;
    }
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = (e.key || '').toUpperCase();
    if (['T', 'F', 'Y', 'N'].includes(k)) { e.preventDefault(); state.input.add('keyboard'); act(k, e); }
  });
  window.addEventListener('keyup', e => { if (e.code === 'Space' || e.key === ' ') spaceHeld = false; });
  window.addEventListener('blur', () => { spaceHeld = false; });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    if (a === 'begin') { begin(); return; }
    state.input.add(e.pointerType === 'touch' || (e.detail && 'ontouchstart' in window) ? 'touch' : 'pointer');
    act(a, e);
    if (b.isConnected) b.blur();
  });
  // Leaving the page during a passage, the probe or a question counts against that trial.
  let hidAt = null;
  document.addEventListener('visibilitychange', () => {
    const live = ['reading', 'probe', 'question'].includes(state.phase);
    if (document.hidden) {
      hidAt = now();
      if (live && state.cur) { state.cur.focus++; state.events.push({ pos: state.k + 1, phase: state.phase, at: Math.round(now() - state.t0) }); }
    } else if (hidAt !== null) {
      if (state.cur && live) state.cur.hiddenMs += now() - hidAt;
      hidAt = null; spaceHeld = false;
    }
  });

  /* ---------- the end ---------- */
  function done() {
    state.phase = 'done';
    const summary = summarise();
    LAB.markDone('reading');
    $('#s-done').innerHTML = `<div class="column"><h1>Thank you</h1><p class="lead" id="done-msg">Saving your responses…</p></div>`;
    show('s-done');
    const say = s => { $('#done-msg').textContent = s; };
    document.addEventListener('lab:sent', ev => { if (ev.detail && ev.detail.submissionId === summary.sid) say('Your responses were saved. You can close this page.'); });
    LAB.submit({ v: 1, exp: 'reading', pid: state.pid, session: state.session, submissionId: summary.sid, summary: summary.row, trials: trialRows() }).then(st => {
      if (!LAB.connected()) say('This page is not connected to the class data store, so nothing was sent. Please tell your instructor.');
      else if (st.pending) say('Not saved yet: your responses are kept on this device and will be sent automatically. Please keep this page open for a minute, or open any task again later.');
    });
  }
  const mean = a => { const v = a.filter(isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };
  const r0 = v => (isFinite(v) ? Math.round(v) : '');
  function summarise() {
    const T = state.trials, crit = T.filter(t => t.type === 'critical'), main = T.filter(t => t.type !== 'practice');
    const cond = c => crit.filter(t => t.connective === c);
    const reg = (t, k) => { const g = R.regions(t.rt2.length)[k]; return mean(g.map(i => t.rt2[i])); };
    const row = {
      exp: 'reading', list: state.list, list_assigned: state.assigned, started_at: state.startedAt, submitted_at: new Date().toISOString(),
      duration_ms: Math.round(now() - state.t0), n_trials: T.length, input: [...state.input].sort().join('+') || 'none',
      focus_total: T.reduce((s, t) => s + t.focus, 0), hidden_ms: T.reduce((s, t) => s + t.hiddenMs, 0),
      rec_acc: LAB.round(mean(main.map(t => (t.probeCorrect ? 1 : 0))), 3), comp_acc: LAB.round(mean(main.filter(t => t.ask).map(t => (t.qCorrect ? 1 : 0))), 3),
      rec_rt_because: r0(mean(cond(1).filter(t => t.probeCorrect).map(t => t.probeRT))), rec_rt_none: r0(mean(cond(0).filter(t => t.probeCorrect).map(t => t.probeRT))),
      early_because: r0(mean(cond(1).map(t => reg(t, 'early')))), early_none: r0(mean(cond(0).map(t => reg(t, 'early')))),
      final_because: r0(mean(cond(1).map(t => reg(t, 'final')))), final_none: r0(mean(cond(0).map(t => reg(t, 'final')))),
      events: state.events.map(v => `${v.pos}:${v.phase}:${v.at}`).join(',').slice(0, 200), include: 1
    };
    // t01–t30: item;because(1/0);probe T/F;probe ms;probe correct;question Y/N/-;question ms;question correct;focus losses;clause-1 word ms/clause-2 word ms (base 36)
    T.forEach(t => {
      row['t' + String(t.pos).padStart(2, '0')] = [t.id, t.connective, t.probeResp ? 'T' : 'F', Math.round(t.probeRT), t.probeCorrect ? 1 : 0,
        t.ask ? (t.qResp ? 'Y' : 'N') : '-', t.ask ? Math.round(t.qRT) : '', t.ask ? (t.qCorrect ? 1 : 0) : '', t.focus, R.enc36(t.rt1) + '/' + R.enc36(t.rt2)].join(';');
    });
    return { row, sid: LAB.uid() };
  }
  const trialRows = () => state.trials.map(t => ({
    position: t.pos, item_id: t.id, type: t.type, list: state.list, connective: t.connective, probe: t.probe, probe_present: t.present ? 1 : 0,
    probe_response: t.probeResp ? 'T' : 'F', probe_correct: t.probeCorrect ? 1 : 0, probe_rt_ms: Math.round(t.probeRT),
    question_asked: t.ask ? 1 : 0, question_response: t.ask ? (t.qResp ? 'Y' : 'N') : '', question_correct: t.ask ? (t.qCorrect ? 1 : 0) : '', question_rt_ms: t.ask ? Math.round(t.qRT) : '',
    words1: t.w1.join('|'), rts1: t.rt1.map(v => Math.round(v)).join('|'), words2: t.w2.join('|'), rts2: t.rt2.map(v => Math.round(v)).join('|'),
    focus_losses: t.focus, hidden_ms: t.hiddenMs, trial_ms: t.ms
  }));

  show('s-intro');
  LAB.flush();
})();
