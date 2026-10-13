/* LT5461 — fluency task, in Chinese: two semantic fluency blocks of 120 s
   each (animals; fruits and vegetables), typed one word at a time, in an
   order chosen by a coin flip every time the task is opened (?first=animals
   or ?first=fruitveg in the address forces it). Then two subscales of the
   Five-Dimensional Curiosity Scale (Kashdan et al., 2018), in a Chinese
   translation: joyous exploration (joy1–5) and deprivation sensitivity
   (depriv1–5), in the published order, 1–7. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const SECONDS = 120;

  const T = {
    title: '词语任务',
    intro: ['这是一个匿名课堂活动，不计分。',
      '任务共三部分：两个各 2 分钟的词语任务，然后是一份简短的问卷。请用中文输入法打字。请独立完成，不要与同学讨论，也不要查阅任何资料。'],
    l1: { q: '中文（任何汉语变体，例如普通话、粤语）是否是你的第一语言或母语之一？', o: [['yes', '是'], ['no', '否']] },
    next: '继续', start: '开始', add: '添加', submit: '提交', missing: '请回答所有问题。',
    part: ['第一部分', '第二部分'],
    cats: {
      animals: { name: '动物', task: '请在 2 分钟内，用中文写出尽可能多的<strong>动物</strong>名称。任何动物都可以。' },
      fruitveg: { name: '水果和蔬菜', task: '请在 2 分钟内，用中文写出尽可能多的<strong>水果和蔬菜</strong>名称。水果和蔬菜都可以。' }
    },
    how: '每写一个词，按回车键（或点“添加”）。不要重复。点“开始”后开始计时。',
    placeholder: '输入一个词',
    count: n => `${n} 个`,
    timeUp: '时间到。',
    listLabel: '你写的词',
    scaleTitle: '第三部分',
    scaleIntro: '以下是人们常用来描述自己的一些陈述。请使用下面的量表，表明这些陈述在多大程度上准确地描述了你。答案没有对错之分。',
    scale: ['完全不符合我', '几乎不符合我', '有点符合我', '中立', '大体符合我', '大部分符合我', '完全符合我'],
    // Kashdan et al. (2018), Appendix A; joyous exploration, then deprivation sensitivity
    items: [
      ['joy1', '我把具有挑战性的情境视为成长和学习的机会。'],
      ['joy2', '我总是在寻找能挑战我对自己和对世界看法的经历。'],
      ['joy3', '我会主动寻找那些很可能需要我深入思考某件事的情境。'],
      ['joy4', '我喜欢学习自己不熟悉的主题。'],
      ['joy5', '我觉得获取新信息令人着迷。'],
      ['depriv1', '思考难解的概念性问题的解决办法，可能会让我夜里睡不着觉。'],
      ['depriv2', '我可以在一个问题上花好几个小时，因为不知道答案我就无法安心。'],
      ['depriv3', '如果想不出一个问题的解决办法，我会感到沮丧，于是更加努力地去解决它。'],
      ['depriv4', '对于我认为必须解决的问题，我会坚持不懈地努力。'],
      ['depriv5', '没有掌握我需要的全部信息会让我感到沮丧。']
    ],
    doneTitle: '已提交',
    done: '请不要与其他同学讨论题目，直到老师宣布活动结束。',
    saved: '你的回答已保存在本设备上，下次打开任何一个任务时会自动发送。'
  };

  /* ---------- order ----------
     A fresh coin flip every time the task is opened without ?first= in the
     address; the result goes into the address (and history.state), so a
     reload keeps the same order. */
  const q = new URLSearchParams(location.search);
  let first = q.get('first');
  const prev = history.state && history.state.fluencyAssigned;
  let assigned = prev || 'url';
  if (first !== 'animals' && first !== 'fruitveg') { first = Math.random() < 0.5 ? 'animals' : 'fruitveg'; assigned = 'random'; q.set('first', first); }
  history.replaceState({ fluencyAssigned: assigned }, '', location.pathname + '?' + q + location.hash);
  const ORDER = first === 'animals' ? ['animals', 'fruitveg'] : ['fruitveg', 'animals'];
  const SHORT = { animals: 'an', fruitveg: 'fv' };

  const state = { pid: LAB.pid(), session: LAB.session(), startedAt: new Date().toISOString(), blocks: {} };

  function show(id) {
    $$('.screen').forEach(s => { s.hidden = s.id !== id; });
    window.scrollTo(0, 0);
    const h = document.querySelector('#' + id + ' h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
  const radios = (name, opts) => `<div class="choices${opts.length === 2 ? ' cols-2' : ''}">` +
    opts.map(([v, l]) => `<label class="choice"><input type="radio" name="${name}" value="${v}"><span>${l}</span></label>`).join('') + '</div>';
  // Every point's label is part of its accessible name; the end labels show under the buttons.
  const scaleRadios = name => `<div class="choices cols-7">` +
    T.scale.map((l, i) => `<label class="choice"><input type="radio" name="${name}" value="${i + 1}" aria-label="${i + 1}，${l}"><span>${i + 1}</span></label>`).join('') +
    `</div><div class="scale-ends" aria-hidden="true"><span>${T.scale[0]}</span><span>${T.scale[6]}</span></div>`;
  const flagMissing = (form, names) => {
    let firstGap = null;
    names.forEach(nm => {
      const fs = form.querySelector(`input[name="${nm}"]`).closest('fieldset'), gap = !form.querySelector(`input[name="${nm}"]:checked`);
      fs.classList.toggle('missing', gap);
      if (gap && !firstGap) firstGap = form.querySelector(`input[name="${nm}"]`);
    });
    if (firstGap) { firstGap.closest('fieldset').scrollIntoView({ block: 'center' }); firstGap.focus({ preventScroll: true }); }
    return !!firstGap;
  };
  const button = (label, type) => `<div class="actions"><button class="btn" type="${type || 'submit'}">${label} <span class="arrow" aria-hidden="true">→</span></button></div>`;

  /* ---------- intro + first language ---------- */
  $('#s-intro').innerHTML = `<div class="column">
      <h1>${T.title}</h1>
      ${T.intro.map((p, i) => `<p class="${i ? '' : 'lead'}">${p}</p>`).join('')}
      <form id="form-bg" novalidate>
        <fieldset><legend>${T.l1.q}</legend>${radios('l1', T.l1.o)}</fieldset>
        <p class="form-error" id="bg-error" role="alert"></p>
        ${button(T.next)}
      </form></div>`;
  $('#form-bg').addEventListener('change', () => { $('#bg-error').textContent = ''; $$('#form-bg fieldset').forEach(f => f.classList.remove('missing')); });
  $('#form-bg').addEventListener('submit', e => {
    e.preventDefault();
    const l1 = new FormData(e.target).get('l1');
    if (!l1) { $('#bg-error').textContent = T.missing; flagMissing(e.target, ['l1']); return; }
    state.l1 = l1;
    blockIntro(0);
  });

  /* ---------- the two fluency blocks ---------- */
  function blockIntro(k) {
    const cat = ORDER[k], C = T.cats[cat];
    $('#s-part').innerHTML = `<div class="column">
        <p class="part-label">${T.part[k]}</p>
        <h1>${C.name}</h1>
        <p class="lead">${C.task}</p>
        <p>${T.how}</p>
        ${button(T.start, 'button')}</div>`;
    show('s-part');
    $('#s-part .btn').addEventListener('click', () => block(k), { once: true });
  }

  // Several words typed together (separated by punctuation or spaces) become separate answers.
  const SPLIT = /[\s,，、;；。.．·・/／|｜]+/;
  const clean = s => s.normalize('NFKC').replace(/[\u0000-\u001f]/g, '').replace(/^[=+\-@'"“”‘’]+/, '').trim().slice(0, 20);

  function block(k) {
    const cat = ORDER[k], C = T.cats[cat];
    $('#s-flu').innerHTML = `<div class="column flu">
        <div class="flu-bar">
          <h1 class="flu-cat"><span class="visually-hidden">${T.part[k]}：</span>${C.name}</h1>
          <span class="flu-count" id="flu-count">${T.count(0)}</span>
          <span class="flu-timer" id="flu-timer" role="timer" aria-live="off">2:00</span>
        </div>
        <div class="flu-track" aria-hidden="true"><span id="flu-fill"></span></div>
        <form class="flu-form" id="flu-form" novalidate autocomplete="off">
          <label class="visually-hidden" for="flu-input">${C.name}</label>
          <input class="flu-input" id="flu-input" type="text" lang="zh-Hans" placeholder="${T.placeholder}" maxlength="60"
            autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="enter">
          <button class="btn" type="submit">${T.add}</button>
        </form>
        <p class="flu-msg" id="flu-msg" role="status"></p>
        <ol class="flu-list" id="flu-list" aria-label="${T.listLabel}"></ol>
        <div class="flu-next" id="flu-next" hidden>${button(T.next, 'button')}</div>
      </div>`;
    show('s-flu');
    const input = $('#flu-input'), list = $('#flu-list');
    const B = state.blocks[cat] = { pos: k + 1, words: [], times: [], hiddenMs: 0, pastes: 0 };
    let t0 = performance.now(), over = false, hidAt = document.hidden ? t0 : null, timer = 0;
    input.focus();
    const elapsed = () => performance.now() - t0;
    const add = raw => {
      const t = Math.min(elapsed(), SECONDS * 1000);
      raw.split(SPLIT).map(clean).filter(Boolean).forEach(w => {
        const seen = B.words.includes(w);
        B.words.push(w); B.times.push(t);
        const li = document.createElement('li');
        li.textContent = w; if (seen) li.className = 'repeat';
        list.appendChild(li);
      });
      $('#flu-count').textContent = T.count(B.words.length);
      list.scrollTop = list.scrollHeight;
    };
    const tick = () => {
      const left = Math.max(0, SECONDS * 1000 - elapsed()), s = Math.ceil(left / 1000);
      $('#flu-timer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      $('#flu-timer').classList.toggle('low', s <= 10);
      $('#flu-fill').style.transform = `scaleX(${left / (SECONDS * 1000)})`;
      if (!left) end();
    };
    // Enter that only confirms a Chinese input-method candidate must not add the word yet.
    let composing = false;
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; });
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (e.isComposing || composing || e.keyCode === 229) return;
      submit();
    });
    input.addEventListener('paste', e => { e.preventDefault(); B.pastes++; });
    $('#flu-form').addEventListener('submit', e => { e.preventDefault(); submit(); input.focus(); });
    function submit() {
      if (over) return;
      if (elapsed() >= SECONDS * 1000) { end(); return; }
      if (input.value.trim()) add(input.value);
      input.value = '';
    }
    const onVis = () => {
      if (document.hidden) hidAt = performance.now();
      else if (hidAt !== null) { B.hiddenMs += performance.now() - hidAt; hidAt = null; tick(); }
    };
    document.addEventListener('visibilitychange', onVis);
    function end() {
      if (over) return;
      over = true; clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
      if (hidAt !== null) B.hiddenMs += performance.now() - hidAt;
      // a word still in the box when time runs out counts, timed at the end
      if (input.value.trim() && !composing) add(input.value);
      input.value = ''; input.disabled = true; $('#flu-form .btn').disabled = true;
      $('#flu-timer').textContent = '0:00';
      $('#flu-msg').textContent = T.timeUp;
      $('#flu-next').hidden = false;
      $('#flu-next .btn').focus();
      $('#flu-next .btn').addEventListener('click', () => (k === 0 ? blockIntro(1) : scaleScreen()), { once: true });
    }
    timer = setInterval(tick, 200);
    tick();
  }

  /* ---------- the two curiosity subscales ---------- */
  function scaleScreen() {
    $('#s-scale').innerHTML = `<div class="column">
        <p class="part-label">${T.scaleTitle}</p>
        <h1 class="visually-hidden">${T.scaleTitle}</h1>
        <p class="lead">${T.scaleIntro}</p>
        <ol class="scale-key">${T.scale.map((l, i) => `<li><b>${i + 1}</b>${l}</li>`).join('')}</ol>
        <form id="form-scale" novalidate>
          ${T.items.map(([key, text], i) => `<fieldset class="item"><legend><span class="item-n">${i + 1}.</span>${text}</legend>${scaleRadios(key)}</fieldset>`).join('')}
          <p class="form-error" id="scale-error" role="alert"></p>
          ${button(T.submit)}
        </form></div>`;
    show('s-scale');
    $('#form-scale').addEventListener('change', e => {
      const fs = e.target.closest('fieldset'); if (fs) fs.classList.remove('missing');
      if (!$$('#form-scale .missing').length) $('#scale-error').textContent = '';
    });
    $('#form-scale').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target), keys = T.items.map(x => x[0]);
      if (keys.some(k => !f.get(k))) { $('#scale-error').textContent = T.missing; flagMissing(e.target, keys); return; }
      const ans = Object.fromEntries(keys.map(k => [k, Number(f.get(k))]));
      const summary = summarise(ans);
      LAB.markDone('fluency');
      $('#s-done').innerHTML = `<div class="column"><h1>${T.doneTitle}</h1><p class="lead">${T.done}</p><p class="small muted" id="done-status"></p></div>`;
      show('s-done');
      const st = await LAB.submit({ v: 1, exp: 'fluency', pid: state.pid, session: state.session, submissionId: LAB.uid(), summary, trials: trials() });
      if (st.pending) $('#done-status').textContent = T.saved;
      document.addEventListener('lab:sent', () => { $('#done-status').textContent = ''; });
    });
  }

  /* ---------- data ----------
     The store keeps strings of at most 200 characters, so each block's words
     ('|'-separated, in the order typed) and their times (seconds from the
     start of the block) are split over four fields each; *_cut counts any
     answers that did not fit (none expected). */
  const NF = 4;
  function pack(vals) {
    const out = new Array(NF).fill('');
    let k = 0, n = 0;
    for (const v of vals) {
      const s = (out[k] ? '|' : '') + v;
      if (out[k].length + s.length > 200) { if (++k >= NF) break; out[k] = String(v); } else out[k] += s;
      n++;
    }
    return { out, n };
  }
  function summarise(ans) {
    const sum = keys => keys.reduce((s, k) => s + ans[k], 0);
    const f = {
      exp: 'fluency', pid: state.pid, session: state.session,
      started_at: state.startedAt, submitted_at: new Date().toISOString(),
      first, order_assigned: assigned, l1_chinese: state.l1,
      include: state.l1 === 'yes' ? 1 : 0, exclude_reason: state.l1 === 'yes' ? '' : 'Chinese not a first language'
    };
    ORDER.forEach(cat => {
      const B = state.blocks[cat], c = SHORT[cat];
      const w = pack(B.words), t = pack(B.times.map(x => (x / 1000).toFixed(1)));
      const n = Math.min(w.n, t.n), w2 = pack(B.words.slice(0, n)), t2 = pack(B.times.slice(0, n).map(x => (x / 1000).toFixed(1)));
      f[c + '_pos'] = B.pos; f[c + '_n'] = B.words.length; f[c + '_cut'] = B.words.length - n;
      w2.out.forEach((s, i) => { f[`${c}_w${i + 1}`] = s; });
      t2.out.forEach((s, i) => { f[`${c}_t${i + 1}`] = s; });
      f[c + '_hidden_ms'] = Math.round(B.hiddenMs); f[c + '_pastes'] = B.pastes;
    });
    Object.assign(f, ans);
    // as in the class's earlier analysis: the 4-item subscales without joy2 and depriv5 (5DCR), and the full 5-item sums
    f.je = sum(['joy1', 'joy3', 'joy4', 'joy5']); f.ds = sum(['depriv1', 'depriv2', 'depriv3', 'depriv4']);
    f.je5 = sum(['joy1', 'joy2', 'joy3', 'joy4', 'joy5']); f.ds5 = sum(['depriv1', 'depriv2', 'depriv3', 'depriv4', 'depriv5']);
    return f;
  }
  const trials = () => ORDER.flatMap(cat => {
    const B = state.blocks[cat];
    return B.words.map((w, i) => ({ category: cat, block: B.pos, position: i + 1, response: w, t_ms: Math.round(B.times[i]), repeat: B.words.indexOf(w) < i ? 1 : 0 }));
  });

  show('s-intro');
  LAB.flush();
})();
