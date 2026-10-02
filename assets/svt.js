/* LT5461 — sentence verification task (typicality), as a self-contained module.

   SentenceVerification.mount(container, options) builds the whole task inside
   `container`: instructions, 8 practice trials with feedback, 112 scored
   trials without feedback, then the results and the debrief. It adds nothing
   outside the container and sets no global styles; its CSS (svt.css) is scoped
   to .svt and otherwise reuses the page's own classes (lab.css).

   options
     stimuli              { scored, practice }; default window.SVT_STIMULI
     onComplete(result)   called once per finished run (see finish())
     renderActions(el, result)  lets the page add controls beside "Start over"
     onReset()            called when the student starts over
     introNote            HTML shown under the instructions
     eyebrow              the small line above the instructions' title
     timing               override T below (testing only)
     seed                 fixes the trial order (testing only)
   Returns { reset(), unmount(), debug() }. The container also receives a
   bubbling 'svt:complete' event whose detail is the result.

   Each trial: fixation 500 ms → sentence until the first response or 5,000 ms
   → blank 650 ms. F = False, J = True, or the on-screen buttons. The first
   response locks the trial at once: buttons disabled, timing stopped, one
   record saved. Key repeats, extra clicks and any press while no sentence is
   on screen are ignored until the next sentence appears. RT = the response
   event's time − performance.now() in the frame that shows the sentence. */
(function () {
  'use strict';

  const T = { fixation: 500, timeout: 5000, iti: 650, feedback: 900, minRT: 250, resume: 600 };
  const RULES = { maxSameAnswer: 3, maxSameCategory: 2, minAccuracy: 0.8, minValid: 12 };

  const DEBRIEF = 'This task tests the typicality effect. Prototype theory proposes that category members differ in how representative they are. Both highly typical and less typical examples can be correct category members, but highly typical members are usually verified more quickly. The key comparison is therefore the time needed to verify true high-typicality versus true low-typicality statements. Your own result may or may not show the predicted effect; single-participant reaction times are noisy, and the pattern is more reliable across many trials and people.';
  const NOT_INTERPRETED = 'Your reaction-time pattern is not interpreted because there were too few reliable responses. In this task, accuracy matters as well as speed.';

  /* ---------- randomness ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function freshSeed() {
    const u = new Uint32Array(1);
    (window.crypto || window.msCrypto).getRandomValues(u);
    return u[0];
  }

  /* ---------- trial order ----------
     Built one trial at a time, each drawn at random from the items that keep
     every rule; a dead end restarts the draw. Rules: at most 3 trials in a row
     with the same correct answer (so also at most 3 targets or 3 fillers in a
     row), at most 2 in a row from the same category, and, when balancing, the
     first half holds exactly half of the high targets, half of the low
     targets and half of the fillers. */
  const kindOf = it => it.trialType === 'target' && it.typicality ? it.typicality : it.trialType;
  function trailing(seq, key, value) {
    let n = 0;
    for (let i = seq.length - 1; i >= 0 && seq[i][key] === value; i--) n++;
    return n;
  }
  function buildOrder(items, rand, balanceHalves) {
    const half = Math.floor(items.length / 2);
    let quota = null;
    if (balanceHalves) {
      quota = {};
      items.forEach(it => { quota[kindOf(it)] = (quota[kindOf(it)] || 0) + 1; });
      for (const k in quota) quota[k] = Math.floor(quota[k] / 2);
    }
    for (let attempt = 0; attempt < 5000; attempt++) {
      const pool = items.slice(), seq = [], used = {};
      while (pool.length) {
        const q = quota && seq.length < half ? quota : null;
        const ok = [];
        for (let i = 0; i < pool.length; i++) {
          const it = pool[i];
          if (trailing(seq, 'correctAnswer', it.correctAnswer) >= RULES.maxSameAnswer) continue;
          if (trailing(seq, 'semanticCategory', it.semanticCategory) >= RULES.maxSameCategory) continue;
          if (q && (used[kindOf(it)] || 0) >= q[kindOf(it)]) continue;
          ok.push(i);
        }
        if (!ok.length) break;
        const it = pool.splice(ok[Math.floor(rand() * ok.length)], 1)[0];
        if (seq.length < half) used[kindOf(it)] = (used[kindOf(it)] || 0) + 1;
        seq.push(it);
      }
      if (seq.length === items.length) return seq;
    }
    throw new Error('SentenceVerification: no order satisfies the rules');
  }
  /* Every rule the order breaks (an empty list means it is valid). */
  function checkOrder(seq, balanceHalves) {
    const bad = [], half = Math.floor(seq.length / 2), ids = new Set(), nouns = new Set();
    seq.forEach((it, i) => {
      if (ids.has(it.id)) bad.push('repeated item ' + it.id);
      if (nouns.has(it.noun)) bad.push('repeated noun ' + it.noun);
      ids.add(it.id); nouns.add(it.noun);
      if (trailing(seq.slice(0, i + 1), 'correctAnswer', it.correctAnswer) > RULES.maxSameAnswer) bad.push('answer run at ' + (i + 1));
      if (trailing(seq.slice(0, i + 1), 'semanticCategory', it.semanticCategory) > RULES.maxSameCategory) bad.push('category run at ' + (i + 1));
    });
    if (balanceHalves) {
      const count = (part, k) => part.filter(it => kindOf(it) === k).length;
      ['high', 'low', 'filler'].forEach(k => {
        const a = count(seq.slice(0, half), k), b = count(seq.slice(half), k);
        if (Math.abs(a - b) > 1) bad.push(`${k}: ${a} in the first half, ${b} in the second`);
      });
    }
    return bad;
  }

  /* ---------- analysis ---------- */
  function median(a) {
    if (!a.length) return NaN;
    const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  /* Scored trials only. RT: correct target trials, 250 ms ≤ RT < 5,000 ms,
     focus kept, sentence shown on time; medians per typicality level. Fillers
     count towards accuracy only. */
  function summarise(records) {
    const scored = records.filter(r => !r.practice);
    const targets = scored.filter(r => r.trialType === 'target');
    const fillers = scored.filter(r => r.trialType === 'filler');
    const share = rows => rows.length ? rows.filter(r => r.correct).length / rows.length : NaN;
    const rts = level => targets.filter(r => r.includedInRT && r.typicality === level).map(r => r.rtMs);
    const hi = rts('high'), lo = rts('low');
    const accuracy = share(scored);
    const reasons = [];
    if (!(accuracy >= RULES.minAccuracy)) reasons.push('accuracy below 80%');
    if (hi.length < RULES.minValid || lo.length < RULES.minValid) reasons.push('fewer than 12 valid trials in a typicality condition');
    const highMedian = median(hi), lowMedian = median(lo);
    return {
      accuracy,
      nCorrect: scored.filter(r => r.correct).length,
      nScored: scored.length,
      accuracyTargets: share(targets),
      accuracyFillers: share(fillers),
      highTypicalityMedianRt: highMedian,
      lowTypicalityMedianRt: lowMedian,
      typicalityEffectRt: lowMedian - highMedian,   // positive = the predicted direction
      nValidHigh: hi.length,
      nValidLow: lo.length,
      nTargets: targets.length,
      nTimeouts: scored.filter(r => r.timedOut).length,
      nFocusLost: scored.filter(r => r.focusLost).length,
      interpretable: reasons.length === 0,
      notInterpretedBecause: reasons
    };
  }

  /* ---------- markup ---------- */
  const TEMPLATE = `
    <section class="svt-screen page" data-screen="intro" aria-labelledby="svt-intro-h">
      <div class="column">
        <p class="eyebrow svt-eyebrow">In-class experiment · about 5 minutes</p>
        <h1 id="svt-intro-h" tabindex="-1">True or false?</h1>
        <p class="lead">You will see a series of short statements. Decide whether each statement is true or false as quickly and accurately as you can. Press <kbd>F</kbd> for False and <kbd>J</kbd> for True. You can also use the buttons on screen. You will complete a few practice trials first.</p>
        <div class="svt-note"></div>
        <div class="actions">
          <button class="btn" type="button" data-act="practice">Start practice <span class="arrow" aria-hidden="true">→</span></button>
        </div>
      </div>
    </section>

    <section class="svt-screen" data-screen="task" aria-labelledby="svt-task-h" tabindex="-1" hidden>
      <h1 class="visually-hidden" id="svt-task-h">True or false?</h1>
      <div class="svt-task">
        <div class="progress progress-inline">
          <div class="progress-meta"><span class="progress-label"></span><span class="progress-count"></span></div>
          <div class="progress-track" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
        </div>
        <div class="svt-stage">
          <span class="svt-fix" aria-hidden="true">+</span>
          <p class="svt-sentence" aria-live="polite"></p>
          <div class="svt-pause" hidden>
            <p class="svt-pause-title">Paused</p>
            <p class="muted">The task stopped while this window was in the background.</p>
            <button class="btn" type="button" data-act="resume">Continue</button>
          </div>
        </div>
        <p class="svt-feedback" role="status"></p>
        <div class="svt-resp">
          <button class="svt-btn" type="button" data-resp="false" tabindex="-1" aria-keyshortcuts="F" disabled><span>False</span><kbd aria-hidden="true">F</kbd></button>
          <button class="svt-btn" type="button" data-resp="true" tabindex="-1" aria-keyshortcuts="J" disabled><span>True</span><kbd aria-hidden="true">J</kbd></button>
        </div>
      </div>
    </section>

    <section class="svt-screen page" data-screen="transition" aria-labelledby="svt-trans-h" hidden>
      <div class="column svt-transition">
        <h1 id="svt-trans-h" tabindex="-1">Practice complete.</h1>
        <p class="lead">The main task will now begin. Respond as quickly as you can without sacrificing accuracy.</p>
        <div class="actions">
          <button class="btn" type="button" data-act="main">Begin <span class="arrow" aria-hidden="true">→</span></button>
          <span class="key-hint svt-keys-only">or press Space</span>
        </div>
      </div>
    </section>

    <section class="svt-screen page" data-screen="results" aria-labelledby="svt-results-h" hidden>
      <p class="eyebrow">Sentence task · results</p>
      <h1 id="svt-results-h" tabindex="-1">Your results</h1>
      <div class="stats svt-stats"></div>
      <figure class="svt-bars" hidden>
        <div class="svt-bar-rows"></div>
        <figcaption>Median response time, correct answers to true statements only.</figcaption>
      </figure>
      <p class="note warn svt-quality" hidden></p>
      <div class="column">
        <h2>What the task tests</h2>
        <p class="svt-debrief"></p>
        <p class="svt-yours" hidden></p>
      </div>
      <div class="actions svt-actions"></div>
    </section>`;

  /* ---------- the component ---------- */
  function mount(container, options) {
    options = options || {};
    const STIM = options.stimuli || window.SVT_STIMULI;
    if (!STIM || !STIM.scored || !STIM.practice) throw new Error('SentenceVerification: no stimuli');
    const nouns = new Set(STIM.scored.map(s => s.noun));
    if (nouns.size !== STIM.scored.length) throw new Error('SentenceVerification: a noun appears twice in the scored trials');
    const TM = Object.assign({}, T, options.timing || {});

    const root = document.createElement('div');
    root.className = 'svt';
    root.innerHTML = TEMPLATE;
    container.appendChild(root);
    const $ = s => root.querySelector(s);
    const screens = Array.from(root.querySelectorAll('.svt-screen'));
    const el = {
      task: $('[data-screen="task"]'), fix: $('.svt-fix'), sentence: $('.svt-sentence'),
      feedback: $('.svt-feedback'), pause: $('.svt-pause'), resume: $('[data-act="resume"]'),
      btns: Array.from(root.querySelectorAll('.svt-btn')),
      progLabel: $('.progress-label'), progCount: $('.progress-count'),
      progTrack: $('.progress-track'), progFill: $('.progress-track i')
    };
    if (options.introNote) $('.svt-note').innerHTML = options.introNote;
    if (options.eyebrow) $('.svt-eyebrow').textContent = options.eyebrow;
    $('.svt-debrief').textContent = DEBRIEF;

    /* Everything time-based goes through these, so a reset or unmount can
       cancel it all; a cancelled wait simply never resolves, and the run that
       was waiting on it ends there. */
    const timers = new Set(), frames = new Set();
    const later = (fn, ms) => {
      const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
      timers.add(id);
      return id;
    };
    const cancel = id => { clearTimeout(id); timers.delete(id); };
    const wait = ms => new Promise(res => later(res, ms));
    // The frame that will show the next change. A hidden window gets no
    // frames, so a timer stands in after 100 ms and the trial is flagged.
    const nextFrame = () => new Promise(res => {
      let done = false;
      const f = requestAnimationFrame(() => { frames.delete(f); if (!done) { done = true; cancel(b); res(false); } });
      frames.add(f);
      const b = later(() => { if (!done) { done = true; cancelAnimationFrame(f); frames.delete(f); res(true); } }, 100);
    });
    function clearAll() {
      timers.forEach(clearTimeout); timers.clear();
      frames.forEach(cancelAnimationFrame); frames.clear();
    }

    let runs = 0;
    let S = null;
    function newRun() {
      clearAll();
      runs += 1;
      const seed = options.seed !== undefined ? (options.seed + runs - 1) >>> 0 : freshSeed();
      const rand = mulberry32(seed);
      const order = buildOrder(STIM.scored, rand, true);
      const practice = buildOrder(STIM.practice, rand, false);
      S = {
        gen: (S ? S.gen : 0) + 1, run: runs, seed, order, practice,
        phase: 'intro', records: [], armed: null, locked: true,
        keysDown: new Set(), interrupted: false, current: null, resume: null,
        startedAt: null, result: null
      };
    }

    function show(name, focus) {
      screens.forEach(s => { s.hidden = s.dataset.screen !== name; });
      if (root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: 'start' });
      const target = focus || (name === 'task' ? el.task : $(`[data-screen="${name}"] h1`));
      if (target) target.focus({ preventScroll: true });
    }

    /* ---------- stage ---------- */
    function setButtons(on, picked) {
      el.btns.forEach(b => {
        b.disabled = !on;
        b.classList.toggle('is-picked', b.dataset.resp === picked);
      });
    }
    function setProgress(phase, done, total) {
      el.progLabel.textContent = phase === 'practice' ? 'Practice' : 'Main task';
      el.progCount.textContent = `${Math.min(done + 1, total)} / ${total}`;
      el.progFill.style.width = (done / total * 100) + '%';
      el.progTrack.setAttribute('aria-valuenow', Math.round(done / total * 100));
    }
    function feedback(text, kind) {
      el.feedback.textContent = text;
      el.feedback.className = 'svt-feedback' + (kind ? ' is-' + kind : '');
    }

    /* ---------- responses ---------- */
    function respond(value, ts, via) {
      const a = S && S.armed;
      if (!a || S.locked) return;
      const now = performance.now();
      // Event times share performance.now()'s clock in current browsers; if
      // one does not, use the time the handler runs.
      const t = typeof ts === 'number' && ts > 0 && ts <= now + 1 ? ts : now;
      if (t < a.tOn) return;   // pressed before the sentence was on screen
      S.armed = null;
      S.locked = true;
      cancel(a.timer);
      setButtons(false, value);
      a.resolve({ value, t, via });
    }

    const ctrl = new AbortController();
    const on = (target, type, fn, opts) => target.addEventListener(type, fn, Object.assign({ signal: ctrl.signal }, opts || {}));
    const running = () => S && (S.phase === 'practice' || S.phase === 'main');

    function keyAnswer(e) {
      const k = (e.key || '').toLowerCase();
      if (k === 'f') return 'false';
      if (k === 'j') return 'true';
      // A Chinese input method can report the letter as 'Process'; the key's
      // position still tells which one it was.
      if (e.code === 'KeyF') return 'false';
      if (e.code === 'KeyJ') return 'true';
      return null;
    }
    on(window, 'keydown', e => {
      if (!running() || e.ctrlKey || e.metaKey || e.altKey) return;
      const answer = keyAnswer(e);
      if (!answer) return;
      e.preventDefault();   // no find-as-you-type
      const id = e.code || answer;
      const held = S.keysDown.has(id);
      S.keysDown.add(id);
      if (e.repeat || held) return;   // a key held down answers once at most
      respond(answer, e.timeStamp, 'key');
    });
    // Space starts the main task, wherever the focus is.
    on(window, 'keydown', e => {
      if (S && S.phase === 'transition' && (e.code === 'Space' || e.key === ' ') && !e.repeat) { e.preventDefault(); startMain(); }
    });
    on(window, 'keyup', e => { if (S) { S.keysDown.delete(e.code || keyAnswer(e)); S.keysDown.delete(keyAnswer(e)); } });
    el.btns.forEach(b => {
      on(b, 'pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        respond(b.dataset.resp, e.timeStamp, e.pointerType === 'touch' ? 'touch' : 'pointer');
      });
      // A click with no pointer behind it: a screen reader, voice control or
      // switch access activating the button. (Mouse and touch clicks were
      // already answered on pointerdown, and the lock ignores repeats.)
      on(b, 'click', e => { if (e.detail === 0) respond(b.dataset.resp, e.timeStamp, 'click'); });
    });
    // Enter held on a focused button would click it again on every repeat.
    on(window, 'keydown', e => { if (running() && e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault(); }, { capture: true });

    /* Leaving the window: the trial under way is invalid for RT, and the next
       one waits until the student is back and presses Continue. */
    function lostFocus() {
      if (!running()) return;
      S.keysDown.clear();
      S.interrupted = true;
      if (S.current) S.current.focusLost = true;
    }
    on(window, 'blur', lostFocus);
    on(document, 'visibilitychange', () => { if (document.hidden) lostFocus(); });
    on(el.resume, 'click', () => {
      if (document.hidden || !S.resume) return;
      const r = S.resume; S.resume = null; r();
    });

    async function pauseIfAway(g) {
      if (!S.interrupted && !document.hidden) return true;
      el.fix.classList.remove('is-on');
      el.pause.hidden = false;
      el.resume.focus({ preventScroll: true });
      await new Promise(res => { S.resume = res; });
      if (g !== S.gen) return false;
      el.pause.hidden = true;
      S.interrupted = false;
      el.task.focus({ preventScroll: true });
      await wait(TM.resume);
      return g === S.gen;
    }

    /* ---------- one trial ---------- */
    async function runTrial(stim, index, phase, g) {
      const cur = { focusLost: document.hidden };
      S.current = cur;
      setButtons(false);
      el.sentence.classList.remove('is-on');
      el.fix.classList.add('is-on');
      await wait(TM.fixation);
      const late = await nextFrame();
      if (g !== S.gen) return null;
      el.fix.classList.remove('is-on');
      el.sentence.textContent = stim.sentence;
      el.sentence.classList.add('is-on');
      const tOn = performance.now();
      const r = await new Promise(resolve => {
        const a = { tOn, resolve };
        a.timer = later(() => {
          if (S.armed !== a) return;
          S.armed = null; S.locked = true;
          setButtons(false);
          resolve({ value: null, t: null, via: null });
        }, TM.timeout);
        S.armed = a;
        S.locked = false;   // the lock opens only now, with the sentence on screen
        setButtons(true);
      });
      if (g !== S.gen) return null;
      el.sentence.classList.remove('is-on');
      S.current = null;
      const rt = r.t === null ? null : Math.round(r.t - tOn);
      // A press that reached the page after 5,000 ms (a throttled timer) is a time-out too.
      const timedOut = rt === null || rt >= TM.timeout;
      const correct = !timedOut && r.value === stim.correctAnswer;
      return {
        stimulusId: stim.id,
        trialIndex: index + 1,
        response: timedOut ? null : r.value,
        correct,
        rtMs: timedOut ? null : rt,
        timedOut,
        focusLost: cur.focusLost,
        includedInRT: phase === 'main' && stim.trialType === 'target' && correct && !cur.focusLost && !late &&
          rt >= TM.minRT && rt < TM.timeout,
        // context, for the data file
        practice: phase === 'practice',
        sentence: stim.sentence,
        trialType: stim.trialType,
        semanticCategory: stim.semanticCategory,
        typicality: stim.typicality,
        correctAnswer: stim.correctAnswer,
        lateOnset: late,
        via: timedOut ? null : r.via
      };
    }

    async function runBlock(list, phase, g) {
      for (let i = 0; i < list.length; i++) {
        if (!await pauseIfAway(g)) return false;
        setProgress(phase, i, list.length);
        const rec = await runTrial(list[i], i, phase, g);
        if (!rec) return false;
        S.records.push(rec);
        el.progFill.style.width = ((i + 1) / list.length * 100) + '%';
        if (phase === 'practice') {
          feedback(rec.timedOut ? 'Too slow' : rec.correct ? 'Correct' : 'Incorrect', rec.correct ? 'good' : 'bad');
          await wait(TM.feedback);
          if (g !== S.gen) return false;
          feedback('');
        }
        setButtons(false);
        await wait(TM.iti);   // blank screen
        if (g !== S.gen) return false;
      }
      return true;
    }

    async function startPractice() {
      if (!S || S.phase !== 'intro') return;
      const g = S.gen;
      S.phase = 'practice';
      S.startedAt = new Date().toISOString();
      feedback('');
      el.pause.hidden = true;
      setProgress('practice', 0, S.practice.length);
      show('task');
      await wait(TM.resume);
      if (g !== S.gen) return;
      if (!await runBlock(S.practice, 'practice', g)) return;
      S.phase = 'transition';
      show('transition', $('[data-act="main"]'));
    }

    async function startMain() {
      if (!S || S.phase !== 'transition') return;
      const g = S.gen;
      S.phase = 'main';
      S.interrupted = false;
      setProgress('main', 0, S.order.length);
      show('task');
      await wait(TM.resume);
      if (g !== S.gen) return;
      if (!await runBlock(S.order, 'main', g)) return;
      finish();
    }

    /* ---------- results ---------- */
    function finish() {
      S.phase = 'results';
      setButtons(false);
      const sum = summarise(S.records);
      const result = Object.assign(sum, {
        run: S.run,
        seed: S.seed,
        stimulusVersion: STIM.version || '',
        startedAt: S.startedAt,
        finishedAt: new Date().toISOString(),
        order: S.order.map(s => s.id),
        trials: S.records.slice()
      });
      S.result = result;
      renderResults(result);
      show('results');
      if (typeof options.onComplete === 'function') {
        try { options.onComplete(result); } catch (e) { console.error(e); }
      }
      container.dispatchEvent(new CustomEvent('svt:complete', { bubbles: true, detail: result }));
    }

    function renderResults(r) {
      const ms = v => Math.round(v);
      const hi = ms(r.highTypicalityMedianRt), lo = ms(r.lowTypicalityMedianRt);
      const diff = lo - hi;   // from the rounded medians, so the numbers on screen add up
      const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v);
      const tile = (label, value, unit, note, key) =>
        `<div class="stat${key ? ' key' : ''}"><span class="stat-label">${label}</span>` +
        `<span class="stat-value">${value}${unit ? `<small>${unit}</small>` : ''}</span>` +
        `<span class="stat-note">${note}</span></div>`;
      // Never show "80%" for a run that missed the 80% criterion.
      const pct = Math.min(Math.round(r.accuracy * 100), r.accuracy < RULES.minAccuracy ? Math.ceil(RULES.minAccuracy * 100) - 1 : 100);
      const acc = tile('Overall accuracy', pct, '%',
        `${r.nCorrect} of ${r.nScored} correct${r.nTimeouts ? ` · ${r.nTimeouts} too slow` : ''}`);
      const valid = tile('Valid target trials', r.nValidHigh + r.nValidLow, '',
        `of ${r.nTargets} · ${r.nValidHigh} high, ${r.nValidLow} low`);
      const quality = $('.svt-quality'), bars = $('.svt-bars'), yours = $('.svt-yours');
      if (r.interpretable) {
        $('.svt-stats').classList.remove('is-pair');
        $('.svt-stats').innerHTML =
          tile('High typicality', hi, 'ms', `median of ${r.nValidHigh} true statements`) +
          tile('Low typicality', lo, 'ms', `median of ${r.nValidLow} true statements`) +
          tile('Difference', signed(diff), 'ms', 'low − high typicality', true) + acc + valid;
        const max = Math.max(hi, lo);
        $('.svt-bar-rows').innerHTML = [['High typicality', hi], ['Low typicality', lo]].map(([label, v]) =>
          `<div class="svt-bar-row"><span class="svt-bar-label">${label}</span>` +
          `<span class="svt-bar-track" aria-hidden="true"><span class="svt-bar-fill" style="--w:${(v / max * 100).toFixed(2)}%"></span></span>` +
          `<span class="svt-bar-value">${v} ms</span></div>`).join('');
        bars.hidden = false;
        quality.hidden = true;
        yours.textContent = diff > 0 ? `In your data, high-typicality items were verified ${diff} ms faster.`
          : diff < 0 ? `In your data, the difference was ${-diff} ms in the opposite direction. Individual results can vary.`
            : 'In your data, high- and low-typicality items were verified equally fast.';
        yours.hidden = false;
      } else {
        $('.svt-stats').innerHTML = acc + valid;
        $('.svt-stats').classList.add('is-pair');
        bars.hidden = true;
        quality.textContent = NOT_INTERPRETED;
        quality.hidden = false;
        yours.hidden = true;
      }
      const actions = $('.svt-actions');
      actions.textContent = '';
      if (typeof options.renderActions === 'function') {
        try { options.renderActions(actions, r); } catch (e) { console.error(e); }
      }
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'btn-quiet';
      again.dataset.act = 'restart';
      again.textContent = 'Start over';
      actions.appendChild(again);
    }

    /* ---------- controls ---------- */
    on(root, 'click', e => {
      const b = e.target.closest('[data-act]');
      if (!b || !root.contains(b)) return;
      if (b.dataset.act === 'practice') startPractice();
      else if (b.dataset.act === 'main') startMain();
      else if (b.dataset.act === 'restart') {
        if (!window.confirm('Start the task again from the beginning? These results will be cleared from the page.')) return;
        reset();
        if (typeof options.onReset === 'function') options.onReset();
      }
    });

    function reset() {
      newRun();
      setButtons(false);
      el.fix.classList.remove('is-on');
      el.sentence.classList.remove('is-on');
      el.sentence.textContent = '';
      el.pause.hidden = true;
      feedback('');
      $('.svt-stats').innerHTML = '';
      $('.svt-actions').textContent = '';
      show('intro');
    }

    function unmount() {
      clearAll();
      ctrl.abort();
      if (S) { S.gen += 1; S.armed = null; S.locked = true; S.phase = 'unmounted'; }
      root.remove();
    }

    newRun();
    screens.forEach(s => { s.hidden = s.dataset.screen !== 'intro'; });

    return {
      reset, unmount,
      debug: () => ({
        phase: S.phase, locked: S.locked, armed: !!S.armed, run: S.run, seed: S.seed,
        records: S.records.length, timers: timers.size, frames: frames.size,
        order: S.order.map(s => s.id), practice: S.practice.map(s => s.id),
        sentenceVisible: el.sentence.classList.contains('is-on'),
        result: S.result
      })
    };
  }

  window.SentenceVerification = { mount, buildOrder, checkOrder, summarise, median, mulberry32, TIMING: T, RULES };
})();
