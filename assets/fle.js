/* LT5461 — foreign-language effect battery (between-subjects: Chinese vs English).
   Materials adapted from the LT5461 Google Forms version:
     Part 1  8 favourable 50/50 gambles (accept / reject)        -> loss aversion
     Part 2  4 sunk-cost scenarios, 1–7 likelihood to continue    -> sunk-cost bias
     Part 3  8 situations, 1–9 "how would you feel"               -> superstition
             (3 bad-luck, 3 good-luck, 2 neutral controls)
   Each student is randomly assigned one language for the whole task
   (?lang=zh or ?lang=en in the address forces one). Item order is randomised
   within each part. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const GAMBLES = [[100, 50], [100, 60], [100, 70], [100, 80], [120, 70], [120, 90], [150, 100], [150, 120]];

  const T = {
    zh: {
      htmlLang: 'zh-Hans',
      title: '判断任务',
      intro: ['这是一个匿名课堂活动，不计分。',
        '请独立完成，不要与同学讨论，也不要使用翻译工具、词典或其他语言辅助。请直接使用本问卷所显示的语言作答。没有“正确”答案，请根据你的第一反应选择。'],
      l1: { q: '中文（任何汉语变体，例如普通话、粤语）是否是你的第一语言或母语之一？', o: [['yes', '是'], ['no', '否']] },
      variety: { q: '你最熟悉的汉语变体是？', o: [['mandarin', '普通话'], ['cantonese', '粤语'], ['other', '其他汉语变体'], ['na', '不适用']] },
      next: '继续', start: '开始', submit: '提交', missing: '请回答所有问题。',
      parts: [
        { title: '第一部分：选择', help: '以下每一题都相互独立。假设结果由一枚公平硬币决定。请直接选择“接受”或“拒绝”。' },
        { title: '第二部分：日常决定', help: '请根据你实际最可能怎么做来回答。' },
        { title: '第三部分：情境反应', help: '想象下面的情境发生在你身上。请评价你在这种情况下的感觉。' }
      ],
      gamble: (w, l) => `正面：你赢得 HK$${w}；反面：你损失 HK$${l}。你接受这个赌局吗？`,
      accept: '接受', reject: '拒绝',
      sunk: [
        ['movie', '你花了180港元买电影票。看了30分钟后，你发现自己很不喜欢这部电影，而且更想离开。票不能退款。你有多大可能会留下来把电影看完？'],
        ['course', '你预先支付了600港元参加一个共4节的周末课程。上完前2节后，你已经确定课程对你没有帮助。剩下2节不能退款，而且还需要6个小时。你有多大可能会继续参加剩下的课程？'],
        ['presentation', '你已经花了8个小时用一种方法准备演示。随后你发现另一种方法，只需要2个小时，而且明显会做得更好。之前的8个小时无法挽回。你有多大可能继续使用原来的方法？'],
        ['meal', '你花了250港元买了一份套餐。吃了几口后你已经很饱，也不再享受这顿饭，而且不能把剩下的食物带走。你有多大可能因为已经付了钱而继续吃？']
      ],
      sunkEnds: ['肯定不会继续', '肯定会继续'],
      react: [
        ['room404', 'bad', '入住酒店时，你被分配到404号房。'],
        ['chopsticks_upright', 'bad', '吃饭时，你不小心把筷子直立插在一碗米饭里。'],
        ['mirror', 'bad', '准备出门时，你不小心打破了一面镜子。'],
        ['phone888', 'good', '你在两个其他方面完全相同的手机号码中做选择，其中一个号码以888结尾。'],
        ['clover', 'good', '在一个重要日子的早上，你在路边发现了一片四叶草。'],
        ['charm', 'good', '在一件重要事情之前，你随身带着一个家人送给你的护身符。'],
        ['room527', 'neutral', '入住酒店时，你被分配到527号房。'],
        ['chopsticks_rice', 'neutral', '吃饭时，你用筷子夹起一口米饭。']
      ],
      reactSuffix: '你会感觉如何？',
      reactEnds: ['非常不好', '非常好'],
      finalTitle: '最后几个问题',
      difficulty: { q: '你觉得本问卷所使用的语言理解起来有多困难？', ends: ['一点也不难', '非常难'] },
      aid: { q: '完成本问卷时，你是否使用了翻译工具、词典或其他语言辅助？', o: [['yes', '是'], ['no', '否']] },
      doneTitle: '已提交',
      done: '请不要与其他同学讨论题目，直到老师宣布活动结束。',
      saved: '你的回答已保存在本设备上，下次打开任何一个任务时会自动发送。'
    },
    en: {
      htmlLang: 'en',
      title: 'Judgement task',
      intro: ['This is an anonymous class activity and is not graded.',
        'Please complete it individually. Do not discuss the questions and do not use translation tools, dictionaries, or other language aids. Answer directly in the language shown. There are no “correct” answers; use your first reaction.'],
      l1: { q: 'Is Chinese (any variety, such as Mandarin or Cantonese) one of your first/native languages?', o: [['yes', 'Yes'], ['no', 'No']] },
      variety: { q: 'Which Chinese variety are you most comfortable with?', o: [['mandarin', 'Mandarin'], ['cantonese', 'Cantonese'], ['other', 'Another Chinese variety'], ['na', 'Not applicable']] },
      next: 'Continue', start: 'Start', submit: 'Submit', missing: 'Please answer every question.',
      parts: [
        { title: 'Part 1: Choices', help: 'Treat every choice independently. Imagine that the outcome is determined by a fair coin. Choose “Accept” or “Reject” using your first reaction.' },
        { title: 'Part 2: Everyday decisions', help: 'Answer according to what you would actually be most likely to do.' },
        { title: 'Part 3: Reactions', help: 'Imagine that each situation happens to you. Rate how you would feel in that situation.' }
      ],
      gamble: (w, l) => `Heads: you win HK$${w}; tails: you lose HK$${l}. Would you accept this gamble?`,
      accept: 'Accept', reject: 'Reject',
      sunk: [
        ['movie', 'You paid HK$180 for a movie ticket. After 30 minutes, you realise that you strongly dislike the film and would rather leave. The ticket is non-refundable. How likely are you to stay until the end?'],
        ['course', 'You paid HK$600 in advance for a four-session weekend course. After two sessions, you are convinced that the course is not useful to you. The remaining two sessions cannot be refunded and would take another six hours. How likely are you to attend the remaining sessions?'],
        ['presentation', 'You have already spent eight hours preparing a presentation using one approach. You then discover a different approach that would take two hours and would clearly produce a better presentation. The eight hours already spent cannot be recovered. How likely are you to continue with the original approach?'],
        ['meal', 'You paid HK$250 for a set meal. After a few bites, you are already full and no longer enjoying the food, and you cannot take the leftovers away. How likely are you to keep eating because you have already paid for it?']
      ],
      sunkEnds: ['Definitely would not continue', 'Definitely would continue'],
      react: [
        ['room404', 'bad', 'When checking into a hotel, you are assigned room 404.'],
        ['chopsticks_upright', 'bad', 'During a meal, you accidentally leave your chopsticks standing upright in a bowl of rice.'],
        ['mirror', 'bad', 'While getting ready to go out, you accidentally break a mirror.'],
        ['phone888', 'good', 'You are choosing between two otherwise identical phone numbers, and one of them ends in 888.'],
        ['clover', 'good', 'On the morning of an important day, you find a four-leaf clover by the roadside.'],
        ['charm', 'good', 'Before an important event, you carry a small protective charm that a family member gave you.'],
        ['room527', 'neutral', 'When checking into a hotel, you are assigned room 527.'],
        ['chopsticks_rice', 'neutral', 'During a meal, you use your chopsticks to pick up some rice.']
      ],
      reactSuffix: 'How would you feel?',
      reactEnds: ['Very bad', 'Very good'],
      finalTitle: 'Final questions',
      difficulty: { q: 'How difficult was the language of this questionnaire to understand?', ends: ['Not difficult at all', 'Extremely difficult'] },
      aid: { q: 'Did you use a translation tool, dictionary, or any other language aid while completing this questionnaire?', o: [['yes', 'Yes'], ['no', 'No']] },
      doneTitle: 'Submitted',
      done: 'Please do not discuss the questions with other students until the instructor ends the activity.',
      saved: 'Your answers are saved on this device and will be sent the next time you open any of the tasks.'
    }
  };

  /* ---------- language assignment ---------- */
  let lang = LAB.params.get('lang'), assigned = 'url';
  if (lang !== 'zh' && lang !== 'en') {
    lang = LAB.store.get('fle-lang', null);
    assigned = 'random';
    if (lang !== 'zh' && lang !== 'en') { lang = Math.random() < 0.5 ? 'zh' : 'en'; LAB.store.set('fle-lang', lang); }
  }
  const t = T[lang];
  document.documentElement.lang = t.htmlLang;
  document.title = t.title + ' · LT5461';
  $('.masthead-meta').textContent = t.title;

  const state = { pid: LAB.pid(), session: LAB.session(), data: [], startedAt: new Date().toISOString() };

  function show(id) {
    $$('.screen').forEach(s => { s.hidden = s.id !== id; });
    window.scrollTo(0, 0);
    const h = document.querySelector('#' + id + ' h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  const radios = (name, opts) => `<div class="choices${opts.length === 2 ? ' cols-2' : ''}">` +
    opts.map(([v, l]) => `<label class="choice"><input type="radio" name="${name}" value="${v}"><span>${l}</span></label>`).join('') + '</div>';
  const scaleRadios = (name, n, ends) => `<div class="choices cols-${n}">` +
    Array.from({ length: n }, (_, i) => `<label class="choice"><input type="radio" name="${name}" value="${i + 1}" aria-label="${i + 1}"><span>${i + 1}</span></label>`).join('') +
    `</div><div class="scale-ends" aria-hidden="true"><span>${ends[0]}</span><span>${ends[1]}</span></div>`;

  /* ---------- intro + background ---------- */
  $('#s-intro').innerHTML = `<div class="column">
      <h1>${t.title}</h1>
      ${t.intro.map((p, i) => `<p class="${i ? '' : 'lead'}">${p}</p>`).join('')}
      <form id="form-bg" novalidate>
        <fieldset><legend>${t.l1.q}</legend>${radios('l1', t.l1.o)}</fieldset>
        <fieldset><legend>${t.variety.q}</legend>${radios('variety', t.variety.o)}</fieldset>
        <p class="form-error" id="bg-error" role="alert"></p>
        <div class="actions"><button class="btn" type="submit">${t.next} <span class="arrow" aria-hidden="true">→</span></button></div>
      </form></div>`;
  $('#form-bg').addEventListener('change', () => { $('#bg-error').textContent = ''; });
  $('#form-bg').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (!f.get('l1') || !f.get('variety')) { $('#bg-error').textContent = t.missing; return; }
    state.l1 = f.get('l1'); state.variety = f.get('variety');
    run();
  });

  /* ---------- items ---------- */
  function buildParts() {
    return [
      LAB.shuffle(GAMBLES.map(([w, l]) => ({ part: 1, item: `win${w}_lose${l}`, win: w, loss: l, text: t.gamble(w, l), kind: 'choice' }))),
      LAB.shuffle(t.sunk.map(([id, text]) => ({ part: 2, item: id, text, kind: 'scale', n: 7, ends: t.sunkEnds }))),
      LAB.shuffle(t.react.map(([id, cond, text]) => ({ part: 3, item: id, cond, text: text + (lang === 'zh' ? '' : ' ') + t.reactSuffix, kind: 'scale', n: 9, ends: t.reactEnds })))
    ];
  }

  function partIntro(i) {
    const p = t.parts[i];
    $('#s-part').innerHTML = `<div class="column"><p class="eyebrow">${i + 1} / 3</p><h1>${p.title}</h1><p class="lead">${p.help}</p>
      <div class="actions"><button class="btn" type="button" id="btn-part">${t.start} <span class="arrow" aria-hidden="true">→</span></button></div></div>`;
    show('s-part');
    return new Promise(res => $('#btn-part').addEventListener('click', res, { once: true }));
  }

  function askItem(it, idx, total) {
    const host = $('#s-item');
    const resp = it.kind === 'choice'
      ? `<div class="resp-pair"><button class="resp-btn" type="button" data-v="accept">${t.accept}</button><button class="resp-btn" type="button" data-v="reject">${t.reject}</button></div>`
      : `<div class="resp-scale" style="--n:${it.n}">${Array.from({ length: it.n }, (_, i) => `<button class="resp-btn" type="button" data-v="${i + 1}">${i + 1}</button>`).join('')}</div>
         <div class="scale-ends" aria-hidden="true"><span>${it.ends[0]}</span><span>${it.ends[1]}</span></div>`;
    host.innerHTML = `<div class="item-wrap">
        <div class="progress progress-inline">
          <div class="progress-meta"><span>${t.parts[it.part - 1].title}</span><span>${idx + 1} / ${total}</span></div>
          <div class="progress-track" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${idx}"><i style="width:${idx / total * 100}%"></i></div>
        </div>
        <p class="item-text" id="item-text" tabindex="-1">${it.text}</p>
        <div class="resp" role="group" aria-labelledby="item-text">${resp}</div>
      </div>`;
    $$('.screen').forEach(s => { s.hidden = s.id !== 's-item'; });
    window.scrollTo(0, 0);
    const t0 = performance.now();
    return new Promise(res => {
      let done = false;
      const choose = (v, btn) => {
        if (done) return; done = true;
        const rt = performance.now() - t0;
        if (btn) btn.classList.add('picked');
        setTimeout(() => res({ v, rt }), 180);
      };
      host.querySelectorAll('.resp-btn').forEach(b => b.addEventListener('click', () => choose(b.dataset.v, b)));
      const onKey = e => {
        if (done || $('#s-item').hidden) return;
        const b = it.kind === 'scale' && /^[1-9]$/.test(e.key) && Number(e.key) <= it.n ? host.querySelector(`.resp-btn[data-v="${e.key}"]`) : null;
        if (b) { window.removeEventListener('keydown', onKey); choose(b.dataset.v, b); }
      };
      window.addEventListener('keydown', onKey);
      // Focus the question, never an answer: a ring on "Accept" or "1" would look pre-selected.
      $('#item-text').focus({ preventScroll: true });
    });
  }

  async function run() {
    const parts = buildParts();
    for (let p = 0; p < parts.length; p++) {
      await partIntro(p);
      for (let i = 0; i < parts[p].length; i++) {
        const it = parts[p][i];
        const r = await askItem(it, i, parts[p].length);
        state.data.push({
          part: it.part, item: it.item, cond: it.cond || '', win: it.win || '', loss: it.loss || '',
          position: i + 1, response: it.kind === 'choice' ? r.v : Number(r.v), rt: LAB.round(r.rt, 0)
        });
      }
    }
    finalScreen();
  }

  /* ---------- final questions ---------- */
  function finalScreen() {
    $('#s-final').innerHTML = `<div class="column"><h1>${t.finalTitle}</h1>
      <form id="form-final" novalidate>
        <fieldset><legend>${t.difficulty.q}</legend>${scaleRadios('difficulty', 7, t.difficulty.ends)}</fieldset>
        <fieldset><legend>${t.aid.q}</legend>${radios('aid', t.aid.o)}</fieldset>
        <div id="prof"></div>
        <p class="form-error" id="final-error" role="alert"></p>
        <div class="actions"><button class="btn" type="submit">${t.submit} <span class="arrow" aria-hidden="true">→</span></button></div>
      </form></div>`;
    const prof = LAB.proficiency($('#prof'), lang);
    show('s-final');
    $('#form-final').addEventListener('change', () => { $('#final-error').textContent = ''; });
    $('#form-final').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      if (!f.get('difficulty') || !f.get('aid')) { $('#final-error').textContent = t.missing; return; }
      const ratings = prof.read();
      if (!ratings) { $('#final-error').textContent = t.missing; return; }
      const summary = summarise(Number(f.get('difficulty')), f.get('aid'), prof.fields(ratings));
      LAB.markDone('fle');
      $('#s-done').innerHTML = `<div class="column"><h1>${t.doneTitle}</h1><p class="lead">${t.done}</p><p class="small muted" id="done-status"></p></div>`;
      show('s-done');
      const st = await LAB.submit({
        v: 1, exp: 'fle', pid: state.pid, session: state.session, submissionId: LAB.uid(), summary,
        trials: state.data.map(d => Object.assign({ pid: state.pid, session: state.session, lang }, d))
      });
      if (st.pending) $('#done-status').textContent = t.saved;
      document.addEventListener('lab:sent', () => { $('#done-status').textContent = ''; });
    });
  }

  function summarise(difficulty, aid, prof) {
    const part = n => state.data.filter(d => d.part === n);
    const react = c => part(3).filter(d => d.cond === c).map(d => d.response);
    const bad = LAB.mean(react('bad')), good = LAB.mean(react('good'));
    const reasons = [];
    if (state.l1 !== 'yes') reasons.push('Chinese not a first language');
    if (aid === 'yes') reasons.push('used a language aid');
    return Object.assign({
      exp: 'fle', pid: state.pid, session: state.session,
      started_at: state.startedAt, submitted_at: new Date().toISOString(),
      lang, assigned, l1_chinese: state.l1, variety: state.variety,
      // loss aversion: share of the 8 favourable gambles accepted
      gamble_accept: LAB.round(part(1).filter(d => d.response === 'accept').length / part(1).length, 3),
      // sunk cost: mean likelihood of continuing, 1–7
      sunk_mean: LAB.round(LAB.mean(part(2).map(d => d.response)), 3),
      // superstition: mean feeling (1–9) per item type; intensity = (good − bad) / 2
      sup_bad: LAB.round(bad, 3), sup_good: LAB.round(good, 3),
      sup_neutral: LAB.round(LAB.mean(react('neutral')), 3),
      sup_intensity: LAB.round((good - bad) / 2, 3),
      difficulty, translation_aid: aid,
      median_rt: LAB.round(LAB.median(state.data.map(d => d.rt)), 0),
      include: reasons.length ? 0 : 1, exclude_reason: reasons.join('; ')
    }, prof);
  }

  show('s-intro');
  LAB.flush();
})();
