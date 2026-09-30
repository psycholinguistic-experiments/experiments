/* LT5461 — association task: a typed, bilingual adaptation of the Free
   Association Semantic Task (FAST; Andrews-Hanna et al., 2022).

   Within subjects: ten chains in Chinese and ten in English. Each chain starts
   from a seed; every answer becomes the cue for the next one, and the seed is
   no longer shown once the first answer is in. Every student gets the same 20
   seeds (assets/fast-stimuli.js): ten Chinese words and ten different English
   words, matched on the norms. Only the language order is counterbalanced:

     group 1  Chinese → English        group 2  English → Chinese

   The group is random each time the task is opened (?group=1 or 2 forces one).
   Progress is saved on the device after every answer, so a reload resumes.
   The students are from Mainland China, so all Chinese is simplified. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const STIM = window.FAST_STIMULI;
  const PER_SEED = STIM.responsesPerSeed;
  const PRACTICE_N = 3;
  const MAX_LEN = 30;
  const GROUPS = { 1: ['zh', 'en'], 2: ['en', 'zh'] };
  const SKILLS = ['overall', 'listening', 'speaking', 'reading', 'writing'];

  /* ---------- words on screen ----------
     The students are from Mainland China: all Chinese is simplified. The
     example chain uses everyday objects that are neutral in both norms
     (valence 4.9–5.5), unlike the emotional seeds, so it shows the procedure
     without priming the materials. */
  const EN = {
    htmlLang: 'en', langName: 'English',
    part: n => `Part ${n} of 2`, title: 'English',
    lead: 'You will see a word. Type the first word that comes into your mind.',
    steps: [
      'Read the word on the screen.',
      'Type the first word it makes you think of (a short phrase is fine too). Press <kbd>Enter</kbd>.',
      'Your word becomes the next word on the screen. Now think of a word for <strong>your</strong> word, and so on.',
      `After ${PER_SEED} words, a new starting word appears.`
    ],
    exampleLead: 'Example, starting from <strong>table</strong>:',
    example: ['table', 'glass', 'bottle', 'box', 'paper'],
    exampleNote: '“paper” comes from “box”, not from “table”.',
    rules: 'Answer in English only. Answer quickly. There are no right or wrong answers. Type on the keyboard; do not use voice input.',
    practice: 'Short practice', practiceDone: `Practice over. Now 10 starting words, ${PER_SEED} answers each.`,
    ready: 'Ready?', start: 'Start',
    seedTag: 'New starting word', progress: (i, n) => `Starting word ${i} of ${n}`, practiceTag: 'Practice',
    inputLabel: 'Your word', next: 'Next',
    empty: 'Type a word first.', wrong: 'Please answer in English.'
  };
  const ZH = {
    htmlLang: 'zh-Hans', langName: '中文',
    part: n => `第 ${n} 部分（共 2 部分）`, title: '中文',
    lead: '屏幕上会出现一个词。请输入你最先想到的词。',
    steps: [
      '看屏幕上的词。',
      '输入它让你最先想到的一个词（短语也可以），然后按 <kbd>Enter</kbd> 键。',
      '你输入的词会变成屏幕上的下一个词。再为<strong>你自己的</strong>这个词想一个词，依此类推。',
      `写完 ${PER_SEED} 个词后，会出现一个新的起始词。`
    ],
    exampleLead: '例如，从<strong>桌子</strong>开始：',
    example: ['桌子', '玻璃', '瓶子', '盒子', '纸张'],
    exampleNote: '“纸张”是从“盒子”想到的，而不是从“桌子”想到的。',
    rules: '只用中文回答。请尽快回答。答案没有对错之分。请用键盘输入，不要用语音输入。',
    practice: '简短练习', practiceDone: `练习结束。现在开始：共 10 个起始词，每个起始词写 ${PER_SEED} 个词。`,
    ready: '准备好了吗？', start: '开始',
    seedTag: '新的起始词', progress: (i, n) => `起始词 ${i} / ${n}`, practiceTag: '练习',
    inputLabel: '你的词', next: '下一个',
    empty: '请先输入一个词。', wrong: '请用中文回答。'
  };

  /* ---------- state, saved after every answer ---------- */
  const KEY = 'fast-progress';
  let S = null;

  function save() { LAB.store.set(KEY, S); }

  function fresh() {
    // Group: ?group=1–4 forces one; otherwise random, written into the address
    // (and history.state) so a reload keeps it.
    let g = Number(LAB.params.get('group'));
    let assigned = history.state && history.state.fastAssigned === 'random' ? 'random' : 'url';
    if (!GROUPS[g]) {
      g = 1 + Math.floor(Math.random() * 2);
      assigned = 'random';
      const q = new URLSearchParams(location.search);
      q.set('group', g);
      history.replaceState({ fastAssigned: 'random' }, '', location.pathname + '?' + q + location.hash);
    }
    return {
      v: 1, pid: LAB.pid(), session: LAB.session(), startedAt: new Date().toISOString(),
      group: g, assigned, stimVersion: STIM.version,
      blocks: GROUPS[g].map(lang => ({ lang, order: seedOrder(STIM.sets[lang]) })),
      bg: null, prof: null,
      block: 0, phase: 'intro',         // intro | practice | ready | main | done
      chain: 0, pos: 0, cue: null,      // position within the current chain
      trials: [], resumed: 0
    };
  }

  /* Random seed order within a block, never three seeds of the same valence
     category in a row. */
  function seedOrder(list) {
    for (let tries = 0; tries < 1000; tries++) {
      const o = LAB.shuffle(list.map(s => s.id));
      const cat = id => list.find(s => s.id === id).category;
      if (o.every((id, i) => i < 2 || !(cat(id) === cat(o[i - 1]) && cat(id) === cat(o[i - 2])))) return o;
    }
    return list.map(s => s.id);
  }

  const seedById = id => STIM.sets.zh.concat(STIM.sets.en).find(s => s.id === id);
  const textFor = lang => lang === 'en' ? EN : ZH;
  const seedWord = seed => seed.word;
  const practiceWord = lang => lang === 'en' ? STIM.practice.en : STIM.practice.zh.word;

  function show(id) {
    $$('.screen').forEach(s => { s.hidden = s.id !== id; });
    window.scrollTo(0, 0);
    const h = document.querySelector('#' + id + ' h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  function setLang(lang) {
    const t = lang ? textFor(lang) : { htmlLang: 'en' };
    document.documentElement.lang = t.htmlLang;
  }

  /* ---------- 1. intro, background, proficiency (English) ---------- */
  const radios = (name, opts, cols, unit) => `<div class="choices${cols ? ' ' + cols : ''}">` +
    opts.map(([v, l]) => `<label class="choice"><input type="radio" name="${name}" value="${v}"${unit ? ` aria-label="${l}${unit}"` : ''}><span>${l}</span></label>`).join('') + '</div>';

  function intro() {
    setLang(null);
    $('#s-intro').innerHTML = `<div class="column">
        <h1>Association task</h1>
        <p class="lead">An anonymous class activity. It takes about 30 minutes: first a few questions about your languages, then the task in Chinese and in English.</p>
        <div class="actions"><button class="btn" type="button" id="btn-intro">Start <span class="arrow" aria-hidden="true">→</span></button></div>
      </div>`;
    show('s-intro');
    $('#btn-intro').addEventListener('click', background, { once: true });
  }

  function background() {
    const pct = Array.from({ length: 11 }, (_, i) => [String(i * 10), String(i * 10)]);
    $('#s-bg').innerHTML = `<div class="column">
        <p class="eyebrow">About you</p>
        <h1>Your languages</h1>
        <form id="form-bg" novalidate>
          <fieldset><legend>What is your first language?</legend>${radios('l1', [['chinese', 'Chinese <span lang="zh-Hans">中文</span>'], ['english', 'English'], ['other', 'Another language']], 'cols-2')}</fieldset>
          <fieldset><legend id="eng-age-q">At what age did you start learning English?</legend>
            <div class="num-field"><input class="text-input" id="eng-age" name="eng_age" type="number" inputmode="numeric" min="0" max="80" step="1" autocomplete="off" aria-labelledby="eng-age-q eng-age-unit"><span id="eng-age-unit">years old</span></div></fieldset>
          <fieldset><legend>On a typical day, how much of your language use is in English?</legend>
            ${radios('en_use', pct, 'cols-11', '%')}
            <div class="scale-ends" aria-hidden="true"><span>0% = none</span><span>100% = all</span></div></fieldset>
          <p class="form-error" id="bg-error" role="alert"></p>
          <div class="actions"><button class="btn" type="submit">Continue <span class="arrow" aria-hidden="true">→</span></button></div>
        </form></div>`;
    show('s-bg');
    const form = $('#form-bg');
    form.addEventListener('change', () => { $('#bg-error').textContent = ''; });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const f = new FormData(form);
      const age = f.get('eng_age');
      const order = ['l1', 'eng_age', 'en_use'];
      const gap = order.find(k => k === 'eng_age' ? age === '' : !f.get(k));
      if (gap) {
        $('#bg-error').textContent = 'Please answer every question.';
        form.querySelector(gap === 'eng_age' ? '#eng-age' : `input[name="${gap}"]`).focus();
        return;
      }
      const a = Number(age);
      if (!(a >= 0 && a <= 80) || !Number.isInteger(a)) { $('#bg-error').textContent = 'Please give the age in whole years.'; $('#eng-age').focus(); return; }
      S.bg = { l1: f.get('l1'), eng_age: a, en_use: Number(f.get('en_use')) };
      save();
      proficiency();
    });
  }

  function proficiency() {
    const row = (lang, skill) => `<div class="prof-row" role="radiogroup" aria-label="${lang === 'zh' ? 'Chinese' : 'English'} ${skill}, 0 no knowledge to 10 native-like">` +
      `<span class="prof-skill">${skill.charAt(0).toUpperCase() + skill.slice(1)}</span><div class="choices cols-11">` +
      Array.from({ length: 11 }, (_, n) => `<label class="choice"><input type="radio" name="${lang}_${skill}" value="${n}" aria-label="${n}"><span>${n}</span></label>`).join('') +
      '</div></div>';
    const group = (lang, name) => `<fieldset class="prof prof-11"><legend>${name}</legend>` +
      `<div class="prof-ends" aria-hidden="true"><span>0 = no knowledge</span><span>10 = native-like</span></div>` +
      SKILLS.map(s => row(lang, s)).join('') + '</fieldset>';
    $('#s-prof').innerHTML = `<div class="column">
        <p class="eyebrow">About you</p>
        <h1>How well do you know each language?</h1>
        <form id="form-prof" novalidate>
          ${group('zh', 'Chinese')}
          ${group('en', 'English')}
          <p class="form-error" id="prof-error" role="alert"></p>
          <div class="actions"><button class="btn" type="submit">Continue <span class="arrow" aria-hidden="true">→</span></button></div>
        </form></div>`;
    show('s-prof');
    const form = $('#form-prof');
    form.addEventListener('change', () => { $('#prof-error').textContent = ''; });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const out = {};
      for (const lang of ['zh', 'en']) for (const s of SKILLS) {
        const r = form.querySelector(`input[name="${lang}_${s}"]:checked`);
        if (!r) { $('#prof-error').textContent = 'Please rate every skill in both languages.'; form.querySelector(`input[name="${lang}_${s}"]`).focus(); return; }
        out[`prof_${lang}_${s}`] = Number(r.value);
      }
      S.prof = out;
      S.phase = 'block-intro';
      save();
      blockIntro();
    });
  }

  /* ---------- 2. the two blocks ---------- */
  function blockIntro() {
    const B = S.blocks[S.block], t = textFor(B.lang);
    setLang(B.lang);
    $('#s-block').innerHTML = `<div class="column">
        <p class="eyebrow">${t.part(S.block + 1)}</p>
        <h1>${t.title}</h1>
        <p class="lead">${t.lead}</p>
        <ol class="steps">${t.steps.map(x => `<li><span>${x}</span></li>`).join('')}</ol>
        <figure class="assoc-example" lang="${t.htmlLang}">
          <figcaption>${t.exampleLead}</figcaption>
          <ol class="chain">${t.example.map((w, i) => `<li${i === 0 ? ' class="start"' : ''}><span>${w}</span></li>`).join('')}</ol>
          <p class="small">${t.exampleNote}</p>
        </figure>
        <p>${t.rules}</p>
        <div class="actions"><button class="btn" type="button" id="btn-practice">${t.practice} <span class="arrow" aria-hidden="true">→</span></button></div>
      </div>`;
    show('s-block');
    $('#btn-practice').addEventListener('click', () => { S.phase = 'practice'; S.pos = 0; S.cue = null; save(); runPractice(); }, { once: true });
  }

  async function runPractice() {
    const B = S.blocks[S.block];
    let cue = practiceWord(B.lang);
    for (let k = 1; k <= PRACTICE_N; k++) {
      const r = await ask({ lang: B.lang, cue, first: k === 1, pos: k, of: PRACTICE_N, practice: true });
      record({ practice: 1, chain: 0, seed: 'practice', category: '', position: k, cue }, r);
      cue = r.response;
    }
    S.phase = 'ready'; save();
    ready();
  }

  function ready() {
    const B = S.blocks[S.block], t = textFor(B.lang);
    setLang(B.lang);
    $('#s-block').innerHTML = `<div class="column">
        <p class="eyebrow">${t.part(S.block + 1)}</p>
        <h1>${t.ready}</h1>
        <p class="lead">${t.practiceDone}</p>
        <div class="actions"><button class="btn" type="button" id="btn-start">${t.start} <span class="arrow" aria-hidden="true">→</span></button></div>
      </div>`;
    show('s-block');
    $('#btn-start').addEventListener('click', () => { S.phase = 'main'; S.chain = 0; S.pos = 0; S.cue = null; save(); runBlock(); }, { once: true });
  }

  async function runBlock() {
    const B = S.blocks[S.block];
    for (; S.chain < B.order.length; S.chain++, S.pos = 0, S.cue = null) {
      const seed = seedById(B.order[S.chain]);
      const seedText = seedWord(seed);
      if (!S.cue) S.cue = seedText;
      for (; S.pos < PER_SEED; ) {
        const k = S.pos + 1;
        const r = await ask({ lang: B.lang, cue: S.cue, first: k === 1, pos: k, of: PER_SEED, chainNo: S.chain + 1, chains: B.order.length });
        record({ practice: 0, chain: S.chain + 1, seed: seed.id, category: seed.category, position: k, cue: S.cue }, r);
        S.pos = k;
        S.cue = r.response;
        save();
      }
    }
    if (S.block === 0) {
      S.block = 1; S.phase = 'block-intro'; S.chain = 0; S.pos = 0; S.cue = null; save();
      blockIntro();
    } else {
      S.phase = 'done'; save();
      finish();
    }
  }

  function record(meta, r) {
    const B = S.blocks[S.block];
    S.trials.push(Object.assign({ block: S.block + 1, lang: B.lang }, meta, {
      response: r.response, rt_onset: r.rtOnset, rt_submit: r.rtSubmit,
      hidden: r.hidden ? 1 : 0, rejected: r.rejected, resumed: r.resumed ? 1 : 0
    }));
    save();
  }

  /* One cue, one typed answer. The screen is built once per language and
     only its words change between answers, so the field keeps focus (and a
     phone keeps its keyboard and input method) for the whole block. Enter
     submits, except while an input method is still composing Chinese. */
  let resumedNext = false, ui = null, cur = null;
  function buildItem(lang) {
    setLang(lang);   // also after a resume, which skips the block intro
    const t = textFor(lang);
    $('#s-item').innerHTML = `<div class="assoc-wrap">
        <div class="progress progress-inline">
          <div class="progress-meta"><span id="assoc-where"></span><span>${t.langName}</span></div>
          <div class="progress-track" id="assoc-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div>
        </div>
        <div class="assoc-cue-area">
          <p class="assoc-tag" id="assoc-tag"></p>
          <p class="assoc-cue" lang="${t.htmlLang}" id="assoc-cue"></p>
          <ol class="assoc-steps" id="assoc-steps" aria-hidden="true"></ol>
        </div>
        <p class="visually-hidden" id="assoc-status" role="status" aria-atomic="true"></p>
        <form class="assoc-form" id="assoc-form" novalidate autocomplete="off">
          <label class="visually-hidden" for="assoc-input">${t.inputLabel}</label>
          <input class="assoc-input" id="assoc-input" type="text" lang="${t.htmlLang}" maxlength="${MAX_LEN}"
                 autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="next"
                 aria-describedby="assoc-tag assoc-cue assoc-error">
          <button class="btn" type="submit">${t.next} <span class="arrow" aria-hidden="true">→</span></button>
          <p class="form-error assoc-error" id="assoc-error" role="alert"></p>
        </form>
      </div>`;
    const input = $('#assoc-input'), form = $('#assoc-form'), err = $('#assoc-error');
    let composing = false, compEnd = -Infinity;
    const markOnset = () => { if (cur && cur.onset === null) cur.onset = performance.now() - cur.shown; };
    input.addEventListener('compositionstart', () => { composing = true; markOnset(); });
    input.addEventListener('compositionend', () => { composing = false; compEnd = performance.now(); });
    input.addEventListener('input', () => { markOnset(); err.textContent = ''; });
    // A held Enter repeats: never let the repeat land on the next, empty field.
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && e.repeat) e.preventDefault(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && cur) cur.hidden = true; });
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!cur || cur.done) return;
      // Safari sends the Enter that confirms a Chinese composition just after
      // compositionend. Only the Chinese block needs the guard; elsewhere an
      // Android keyboard's commit-and-Enter must go through.
      if (composing || (lang === 'zh' && performance.now() - compEnd < 60)) return;
      const v = clean(input.value);
      if (!v) { err.textContent = t.empty; input.focus(); return; }
      if (!rightScript(v, lang)) { cur.rejected++; err.textContent = t.wrong; input.focus(); return; }
      cur.done = true;
      const c = cur;
      c.resolve({ response: v, rtOnset: c.onset === null ? '' : Math.round(c.onset), rtSubmit: Math.round(performance.now() - c.shown),
        hidden: c.hidden, rejected: c.rejected, resumed: c.resumed });
    });
    ui = { lang, input, err };
  }

  function ask(o) {
    const t = textFor(o.lang);
    if (!ui || ui.lang !== o.lang || !document.body.contains(ui.input)) buildItem(o.lang);
    const done = o.practice ? (o.pos - 1) / o.of : ((o.chainNo - 1) * PER_SEED + o.pos - 1) / (o.chains * PER_SEED);
    const where = o.practice ? t.practiceTag : t.progress(o.chainNo, o.chains);
    $('#assoc-where').textContent = where;
    const track = $('#assoc-track');
    track.setAttribute('aria-label', where);
    track.setAttribute('aria-valuenow', Math.round(done * 100));
    track.firstElementChild.style.width = (done * 100) + '%';
    $('#assoc-tag').textContent = o.first ? t.seedTag : '';
    // The field keeps focus for the whole block, so its description is read
    // only once: announce each new starting word instead.
    const [stop, colon] = o.lang === 'en' ? ['. ', ': '] : ['。', '：'];
    $('#assoc-status').textContent = o.first ? `${where}${stop}${t.seedTag}${colon}${o.cue}` : '';
    const cue = $('#assoc-cue');
    cue.textContent = o.cue;
    cue.classList.toggle('long', [...o.cue].length > 12);
    $('#assoc-steps').innerHTML = Array.from({ length: o.of }, (_, i) => `<li class="${i + 1 < o.pos ? 'done' : i + 1 === o.pos ? 'now' : ''}"></li>`).join('');
    ui.input.value = '';
    ui.err.textContent = '';
    if ($('#s-item').hidden) $$('.screen').forEach(s => { s.hidden = s.id !== 's-item'; });
    if (document.activeElement !== ui.input) ui.input.focus({ preventScroll: true });
    const resumed = resumedNext;
    resumedNext = false;
    return new Promise(resolve => {
      cur = { shown: performance.now(), onset: null, rejected: 0, hidden: document.hidden, resumed, done: false, resolve };
    });
  }

  const HAN = /\p{Script=Han}/u, LATIN = /[A-Za-z]/;
  function rightScript(v, lang) { return lang === 'zh' ? HAN.test(v) : LATIN.test(v) && !HAN.test(v); }
  // One line, no separator characters (the chains are stored as a|b|c), 30 characters at most.
  // NFKC turns full-width Latin typed in a Chinese input mode (ｇｌａｓｓ) into glass.
  function clean(v) { return v.normalize('NFKC').replace(/[|\s]+/g, ' ').trim().slice(0, MAX_LEN); }

  /* ---------- 3. submit ---------- */
  async function finish() {
    setLang(null);
    const summary = summarise();
    LAB.markDone('fast');
    $('#s-done').innerHTML = `<div class="column"><h1>Submitted</h1><p class="lead">Thank you. Please wait until everyone has finished.</p><p class="small muted" id="done-status"></p></div>`;
    show('s-done');
    // The outbox keeps the run until the server confirms it, so the task counts
    // as submitted from here; a repeat of the same submission id is ignored.
    S.submissionId = S.submissionId || LAB.uid();
    S.submitted = true; save();
    const st = await LAB.submit({
      v: 1, exp: 'fast', pid: S.pid, session: S.session, submissionId: S.submissionId, summary,
      trials: S.trials.map(d => Object.assign({ pid: S.pid, session: S.session }, d))
    });
    if (st.pending) $('#done-status').textContent = 'Your answers are saved on this device and will be sent the next time you open any of the tasks.';
    document.addEventListener('lab:sent', () => { $('#done-status').textContent = ''; });
  }

  /* One row per student. Each chain is stored as two text fields (answers 1–5
     and 6–10), because the data script keeps at most 200 characters per field. */
  function summarise() {
    const main = S.trials.filter(d => !d.practice);
    const med = (lang, k) => { const v = main.filter(d => d.lang === lang).map(d => Number(d[k])).filter(isFinite); return LAB.round(LAB.median(v), 0); };
    const out = Object.assign({
      exp: 'fast', started_at: S.startedAt, submitted_at: new Date().toISOString(),
      group: S.group, assigned: S.assigned, order: S.blocks.map(b => b.lang).join('-'),
      stim_version: S.stimVersion
    }, S.bg, S.prof, {
      rt_median_zh: med('zh', 'rt_submit'), rt_median_en: med('en', 'rt_submit'),
      onset_median_zh: med('zh', 'rt_onset'), onset_median_en: med('en', 'rt_onset'),
      hidden_n: main.filter(d => d.hidden).length, rejected_n: main.reduce((s, d) => s + d.rejected, 0), resumed: S.resumed
    });
    S.blocks.forEach(B => B.order.forEach(id => {
      const r = main.filter(d => d.seed === id).sort((a, b) => a.position - b.position).map(d => d.response);
      out[`c_${id}_a`] = [B.lang].concat(r.slice(0, 5)).join('|');
      out[`c_${id}_b`] = r.slice(5).join('|');
    }));
    return out;
  }

  /* ---------- start or resume ---------- */
  function resumePrompt(saved) {
    $('#s-intro').innerHTML = `<div class="column">
        <h1>Association task</h1>
        <p class="lead">You have already started this task on this device.</p>
        <div class="actions">
          <button class="btn" type="button" id="btn-resume">Continue where you left off <span class="arrow" aria-hidden="true">→</span></button>
          <button class="btn-quiet" type="button" id="btn-restart">Start again</button>
        </div>
        <p class="small muted" id="restart-note" role="status"></p></div>`;
    show('s-intro');
    $('#btn-resume').addEventListener('click', () => { S = saved; S.resumed = (S.resumed || 0) + 1; resumedNext = true; save(); resume(); }, { once: true });
    // Starting again erases the saved answers, so it takes a second tap.
    const restart = $('#btn-restart');
    restart.addEventListener('click', () => {
      if (restart.dataset.armed) { S = fresh(); save(); intro(); return; }
      restart.dataset.armed = '1';
      restart.textContent = 'Erase my answers and start again';
      $('#restart-note').textContent = 'Starting again erases the answers saved so far. Select the button again to confirm.';
    });
  }

  function resume() {
    if (!S.bg) return background();
    if (!S.prof) return proficiency();
    if (S.phase === 'block-intro') return blockIntro();
    if (S.phase === 'practice') { S.trials = S.trials.filter(d => !(d.practice && d.block === S.block + 1)); return runPractice(); }
    if (S.phase === 'ready') return ready();
    if (S.phase === 'main') return runBlock();
    if (S.phase === 'done') return finish();
    intro();
  }

  const saved = LAB.store.get(KEY, null);
  if (saved && saved.v === 1 && saved.session === LAB.session() && !saved.submitted && saved.stimVersion === STIM.version && saved.bg) resumePrompt(saved);
  else { S = fresh(); save(); intro(); }
  LAB.flush();
})();
