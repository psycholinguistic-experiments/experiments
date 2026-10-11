/* LT5461 — report task: crime framed as a beast or as a virus (after
   Thibodeau & Boroditsky, 2011), in Chinese or in English. 2 × 2 between
   subjects: each opening of the task flips a coin for the frame and another
   for the language (?frame=beast|virus and ?lang=zh|en in the address force
   them). One paragraph, one choice: punishment or reform. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  // The paragraph is the same in both frames except for the metaphor word (bold, as in the class's earlier version).
  const T = {
    zh: {
      htmlLang: 'zh-Hans',
      title: '报告任务', skip: '跳到主要内容',
      intro: ['这是一个匿名课堂活动，不计分。',
        '请独立完成，不要与同学讨论，也不要使用翻译工具、词典或其他语言辅助。请直接使用本页面所显示的语言作答。没有“正确”答案，请根据你的第一反应选择。'],
      l1: { q: '中文（任何汉语变体，例如普通话、粤语）是否是你的第一语言或母语之一？', o: [['yes', '是'], ['no', '否']] },
      next: '继续', submit: '提交', missing: '请回答所有问题。',
      read: '请阅读以下这段摘自一份近期报告的文字：',
      report: {
        beast: '犯罪是一头肆虐马尼拉的<strong>野兽</strong>。',
        virus: '犯罪是一种肆虐马尼拉的<strong>病毒</strong>。',
        rest: '五年前，马尼拉状况良好，没有明显的弱点。不幸的是，在过去五年里，这座城市的防御系统逐渐减弱，城市已屈服于犯罪。如今，每年发生的犯罪事件超过55,000起，并且每年增加超过10,000起。人们担心，如果这座城市不能尽快恢复元气，可能会开始出现更严重的问题。'
      },
      q: '你认为马尼拉需要怎么做来减少犯罪？',
      o: [['punishment', '惩罚'], ['reform', '改革']],
      finalTitle: '最后几个问题',
      difficulty: { q: '你觉得本页面所使用的语言理解起来有多困难？', ends: ['一点也不难', '非常难'] },
      aid: { q: '完成本任务时，你是否使用了翻译工具、词典或其他语言辅助？', o: [['yes', '是'], ['no', '否']] },
      doneTitle: '已提交',
      done: '请不要与其他同学讨论题目，直到老师宣布活动结束。',
      saved: '你的回答已保存在本设备上，下次打开任何一个任务时会自动发送。'
    },
    en: {
      htmlLang: 'en',
      title: 'Report task', skip: 'Skip to content',
      intro: ['This is an anonymous class activity and is not graded.',
        'Please complete it individually. Do not discuss the questions and do not use translation tools, dictionaries, or other language aids. Answer directly in the language shown. There are no “correct” answers; use your first reaction.'],
      l1: { q: 'Is Chinese (any variety, such as Mandarin or Cantonese) one of your first/native languages?', o: [['yes', 'Yes'], ['no', 'No']] },
      next: 'Continue', submit: 'Submit', missing: 'Please answer every question.',
      read: 'Read this paragraph from a recent report:',
      report: {
        beast: 'Crime is a <strong>beast</strong> ravaging the city of Manila. ',
        virus: 'Crime is a <strong>virus</strong> ravaging the city of Manila. ',
        rest: 'Five years ago Manila was in good shape, with no obvious vulnerabilities. Unfortunately, in the past five years the city’s defense systems have weakened, and the city has succumbed to crime. Today, there are more than 55,000 criminal incidents a year - up by more than 10,000 per year. There is a worry that if the city does not regain its strength soon, even more serious problems may start to develop.'
      },
      q: 'In your opinion what does Manila need to do to reduce crime?',
      o: [['punishment', 'Punishment'], ['reform', 'Reform']],
      finalTitle: 'Final questions',
      difficulty: { q: 'How difficult was the language of this page to understand?', ends: ['Not difficult at all', 'Extremely difficult'] },
      aid: { q: 'Did you use a translation tool, dictionary, or any other language aid while completing this task?', o: [['yes', 'Yes'], ['no', 'No']] },
      doneTitle: 'Submitted',
      done: 'Please do not discuss the questions with other students until the instructor ends the activity.',
      saved: 'Your answers are saved on this device and will be sent the next time you open any of the tasks.'
    }
  };

  /* ---------- assignment ----------
     A fresh coin flip for each factor every time the task is opened without
     it in the address. The result goes into the address (and history.state),
     so a reload keeps the same version. */
  const q = new URLSearchParams(location.search);
  let lang = q.get('lang'), frame = q.get('frame');
  const prev = history.state && history.state.reportAssigned || {};
  const assigned = { lang: prev.lang || 'url', frame: prev.frame || 'url' };
  if (lang !== 'zh' && lang !== 'en') { lang = Math.random() < 0.5 ? 'zh' : 'en'; assigned.lang = 'random'; q.set('lang', lang); }
  if (frame !== 'beast' && frame !== 'virus') { frame = Math.random() < 0.5 ? 'beast' : 'virus'; assigned.frame = 'random'; q.set('frame', frame); }
  history.replaceState({ reportAssigned: assigned }, '', location.pathname + '?' + q + location.hash);

  const t = T[lang];
  document.documentElement.lang = t.htmlLang;
  document.title = t.title + ' · LT5461';
  $('.masthead-meta').textContent = t.title;
  $('.skip-link').textContent = t.skip;

  const state = { pid: LAB.pid(), session: LAB.session(), startedAt: new Date().toISOString() };

  function show(id) {
    $$('.screen').forEach(s => { s.hidden = s.id !== id; });
    window.scrollTo(0, 0);
    const h = document.querySelector('#' + id + ' h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
  const radios = (name, opts) => `<div class="choices${opts.length === 2 ? ' cols-2' : ''}">` +
    opts.map(([v, l]) => `<label class="choice"><input type="radio" name="${name}" value="${v}"><span>${l}</span></label>`).join('') + '</div>';
  // The end labels are part of the accessible names of 1 and n (the visible ones are decorative).
  const scaleRadios = (name, n, ends) => `<div class="choices cols-${n}">` +
    Array.from({ length: n }, (_, i) => `<label class="choice"><input type="radio" name="${name}" value="${i + 1}" aria-label="${i + 1}${i === 0 ? ', ' + ends[0] : i === n - 1 ? ', ' + ends[1] : ''}"><span>${i + 1}</span></label>`).join('') +
    `</div><div class="scale-ends" aria-hidden="true"><span>${ends[0]}</span><span>${ends[1]}</span></div>`;
  // Mark the first unanswered question, bring it into view and focus its first option.
  const flagMissing = (form, names) => {
    let first = null;
    names.forEach(nm => {
      const fs = form.querySelector(`input[name="${nm}"]`).closest('fieldset'), gap = !form.querySelector(`input[name="${nm}"]:checked`);
      fs.classList.toggle('missing', gap);
      if (gap && !first) first = form.querySelector(`input[name="${nm}"]`);
    });
    if (first) { first.closest('fieldset').scrollIntoView({ block: 'center' }); first.focus({ preventScroll: true }); }
    return !!first;
  };
  const button = label => `<div class="actions"><button class="btn" type="submit">${label} <span class="arrow" aria-hidden="true">→</span></button></div>`;

  /* ---------- intro + first language ---------- */
  $('#s-intro').innerHTML = `<div class="column">
      <h1>${t.title}</h1>
      ${t.intro.map((p, i) => `<p class="${i ? '' : 'lead'}">${p}</p>`).join('')}
      <form id="form-bg" novalidate>
        <fieldset><legend>${t.l1.q}</legend>${radios('l1', t.l1.o)}</fieldset>
        <p class="form-error" id="bg-error" role="alert"></p>
        ${button(t.next)}
      </form></div>`;
  $('#form-bg').addEventListener('change', () => { $('#bg-error').textContent = ''; $$('#form-bg fieldset').forEach(f => f.classList.remove('missing')); });
  $('#form-bg').addEventListener('submit', e => {
    e.preventDefault();
    const l1 = new FormData(e.target).get('l1');
    if (!l1) { $('#bg-error').textContent = t.missing; flagMissing(e.target, ['l1']); return; }
    state.l1 = l1;
    reportScreen();
  });

  /* ---------- the report and the question ---------- */
  function reportScreen() {
    $('#s-report').innerHTML = `<div class="column">
        <h1 class="visually-hidden">${t.title}</h1>
        <p class="report-lead">${t.read}</p>
        <blockquote class="report-text">${t.report[frame]}${t.report.rest}</blockquote>
        <form id="form-report" novalidate>
          <fieldset><legend>${t.q}</legend>${radios('choice', t.o)}</fieldset>
          <p class="form-error" id="report-error" role="alert"></p>
          ${button(t.next)}
        </form></div>`;
    show('s-report');
    const t0 = performance.now();
    $('#form-report').addEventListener('change', () => { $('#report-error').textContent = ''; $$('#form-report fieldset').forEach(f => f.classList.remove('missing')); });
    $('#form-report').addEventListener('submit', e => {
      e.preventDefault();
      const choice = new FormData(e.target).get('choice');
      if (!choice) { $('#report-error').textContent = t.missing; flagMissing(e.target, ['choice']); return; }
      state.choice = choice;
      state.readMs = performance.now() - t0;
      finalScreen();
    });
  }

  /* ---------- final questions ---------- */
  function finalScreen() {
    $('#s-final').innerHTML = `<div class="column"><h1>${t.finalTitle}</h1>
      <form id="form-final" novalidate>
        <fieldset><legend>${t.difficulty.q}</legend>${scaleRadios('difficulty', 7, t.difficulty.ends)}</fieldset>
        <fieldset><legend>${t.aid.q}</legend>${radios('aid', t.aid.o)}</fieldset>
        <div id="prof"></div>
        <p class="form-error" id="final-error" role="alert"></p>
        ${button(t.submit)}
      </form></div>`;
    const prof = LAB.proficiency($('#prof'), lang);
    show('s-final');
    // a fixed answer clears its own mark; the message goes once nothing is missing
    $('#form-final').addEventListener('change', e => {
      const fs = e.target.closest('fieldset, .prof-row'); if (fs && fs.classList.contains('prof-row') ? !!fs.querySelector('input:checked') : fs) fs.classList.remove('missing');
      if (!$$('#form-final .missing').length) $('#final-error').textContent = '';
    });
    $('#form-final').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      $$('#prof .prof-row').forEach(r => r.classList.toggle('missing', !r.querySelector('input:checked')));
      if (!f.get('difficulty') || !f.get('aid')) { $('#final-error').textContent = t.missing; flagMissing(e.target, ['difficulty', 'aid']); return; }
      const ratings = prof.read();
      if (!ratings) { $('#final-error').textContent = t.missing; const r = $('#prof .prof-row.missing'); if (r) r.scrollIntoView({ block: 'center' }); return; }
      const summary = summarise(Number(f.get('difficulty')), f.get('aid'), prof.fields(ratings));
      LAB.markDone('report');
      $('#s-done').innerHTML = `<div class="column"><h1>${t.doneTitle}</h1><p class="lead">${t.done}</p><p class="small muted" id="done-status"></p></div>`;
      show('s-done');
      const st = await LAB.submit({ v: 1, exp: 'report', pid: state.pid, session: state.session, submissionId: LAB.uid(), summary, trials: [] });
      if (st.pending) $('#done-status').textContent = t.saved;
      document.addEventListener('lab:sent', () => { $('#done-status').textContent = ''; });
    });
  }

  function summarise(difficulty, aid, prof) {
    const reasons = [];
    if (state.l1 !== 'yes') reasons.push('Chinese not a first language');
    if (aid === 'yes') reasons.push('used a language aid');
    return Object.assign({
      exp: 'report', pid: state.pid, session: state.session,
      started_at: state.startedAt, submitted_at: new Date().toISOString(),
      frame, lang, frame_assigned: assigned.frame, lang_assigned: assigned.lang, l1_chinese: state.l1,
      choice: state.choice, punish: state.choice === 'punishment' ? 1 : 0,
      // time from the report appearing to the answer being confirmed
      read_ms: LAB.round(state.readMs, 0),
      difficulty, translation_aid: aid,
      include: reasons.length ? 0 : 1, exclude_reason: reasons.join('; ')
    }, prof);
  }

  show('s-intro');
  LAB.flush();
})();
