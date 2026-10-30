/* LT5461 — emotion task: a spatial arrangement of 47 Chinese emotion words
   (after Chaouch-Orozco, Li & Li, 2026, who used Q-SpAM; Koch et al., 2022).
   All 49 names (the 47 words + 灾难 twice) start in the middle of the box in a
   random order; the student drags each one (or taps it, then the spot) so that
   words closer in meaning sit closer together, and must move every name.
   Progress is kept on the device after every move, so a reload resumes.
   The page is in Chinese; students see only “submitted” at the end. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const C = window.EMOTION_CORE, ITEMS = C.ITEMS, N = C.N;
  const KEY = 'emotion-progress';

  const T = {
    title: '情绪词任务',
    intro: ['这是一个匿名课堂活动，不计分。', '请独立完成，不要与同学讨论。大约需要 8 分钟。请使用电脑（笔记本或台式机），在手机上很难完成。'],
    l1: { q: '中文（任何汉语变体，例如普通话、粤语）是否是你的第一语言或母语之一？', o: [['yes', '是'], ['no', '否']] },
    next: '继续', missing: '请回答这个问题。',
    resume: '你上次的排列还没有完成。', resumeBtn: '继续上次的排列', restart: '重新开始',
    howTitle: '按意思排列词语',
    how: ['下一页的方框中间有 49 个与情绪有关的词。',
      '请把这些词拖到方框里的任何位置，用距离表示意思上的相似程度：意思越相近的词放得越近，意思越不同的词放得越远。请利用整个方框，并移动每一个词。'],
    howTap: '你也可以先点击一个词，再点击它要放的位置。选中一个词后，也可以用方向键移动它。',
    startArrange: '开始排列',
    bar: '越近 = 意思越相近', moved: (n, t) => `已移动 ${n}/${t}`, done: '完成',
    arena: '排列区域。选中一个词后，可用方向键移动它，或点击一个空白位置把它放到那里。',
    notMoved: '，还没有移动',
    confirm: '你对这个排列满意吗？', yes: '是的，提交', back: '继续调整',
    doneTitle: '已提交',
    doneText: '请不要与其他同学讨论题目，直到老师宣布活动结束。',
    saved: '你的回答已保存在本设备上，下次打开任何一个任务时会自动发送。'
  };

  const saved = LAB.store.get(KEY, null);
  const state = { pid: LAB.pid(), session: LAB.session(), startedAt: new Date().toISOString(), input: '', resumed: 0 };

  function show(id) {
    $$('.screen').forEach(s => { s.hidden = s.id !== id; });
    window.scrollTo(0, 0);
    const h = document.querySelector('#' + id + ' h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
  const button = (id, label, attrs) => `<button class="btn" type="button" id="${id}"${attrs || ''}>${label} <span class="arrow" aria-hidden="true">→</span></button>`;
  const radios = (name, opts) => `<div class="choices cols-2">` +
    opts.map(([v, l]) => `<label class="choice"><input type="radio" name="${name}" value="${v}"><span>${l}</span></label>`).join('') + '</div>';

  /* ---------- intro ---------- */
  // a saved arrangement from this class (same session) can be continued
  const canResume = saved && saved.session === state.session && saved.pid === state.pid && Array.isArray(saved.pos) && saved.pos.length === N;
  $('#s-intro').innerHTML = `<div class="column">
      <h1>${T.title}</h1>
      ${T.intro.map((p, i) => `<p class="${i ? '' : 'lead'}">${p}</p>`).join('')}
      ${canResume ? `<div class="resume"><p><strong>${T.resume}</strong></p><div class="actions">${button('btn-resume', T.resumeBtn)}<button class="btn btn-quiet" type="button" id="btn-restart">${T.restart}</button></div></div>` : ''}
      <form id="form-bg" novalidate${canResume ? ' hidden' : ''}>
        <fieldset><legend>${T.l1.q}</legend>${radios('l1', T.l1.o)}</fieldset>
        <p class="form-error" id="bg-error" role="alert"></p>
        <div class="actions"><button class="btn" type="submit">${T.next} <span class="arrow" aria-hidden="true">→</span></button></div>
      </form></div>`;
  $('#form-bg').addEventListener('change', () => { $('#bg-error').textContent = ''; $$('#form-bg fieldset').forEach(f => f.classList.remove('missing')); });
  $('#form-bg').addEventListener('submit', e => {
    e.preventDefault();
    const l1 = new FormData(e.target).get('l1');
    if (!l1) { $('#bg-error').textContent = T.missing; $('#form-bg fieldset').classList.add('missing'); return; }
    state.l1 = l1;
    howTo();
  });
  if (canResume) {
    $('#btn-resume').addEventListener('click', () => { Object.assign(state, { l1: saved.l1, startedAt: saved.startedAt, input: saved.input || '', resumed: 1 }); arrange(saved); });
    $('#btn-restart').addEventListener('click', () => { LAB.store.set(KEY, null); $('.resume').remove(); $('#form-bg').hidden = false; $('#form-bg input').focus(); });
  }

  /* ---------- instructions, then the box on a screen of its own ---------- */
  function howTo() {
    $('#s-part').innerHTML = `<div class="column"><h1>${T.howTitle}</h1>
        ${T.how.map((p, i) => `<p class="${i ? '' : 'lead'}">${p}</p>`).join('')}
        <p class="muted">${T.howTap}</p>
        <div class="actions">${button('btn-arrange', T.startArrange)}</div></div>`;
    show('s-part');
    $('#btn-arrange').addEventListener('click', () => arrange(null), { once: true });
  }

  function arrange(prev) {
    $('#s-arrange').innerHTML = `<div class="arrange-wrap">
        <div class="arrange-bar"><h1 class="arrange-h">${T.bar}</h1><span id="moved-count" aria-live="polite"></span>${button('btn-arranged', T.done, ' disabled')}</div>
        <div class="arena" id="arena" role="application" aria-label="${T.arena}"></div>
        <div class="confirm" id="confirm" hidden>
          <p><strong>${T.confirm}</strong></p>
          <div class="actions">${button('btn-confirm', T.yes)}<button class="btn btn-quiet" type="button" id="btn-back">${T.back}</button></div>
        </div></div>`;
    show('s-arrange');
    const arena = $('#arena');
    const fit = () => {
      const top = arena.getBoundingClientRect().top + window.scrollY;
      arena.style.height = Math.round(Math.max(360, Math.min(820, window.innerHeight - top - 16))) + 'px';
    };
    fit();
    const W0 = arena.clientWidth, H0 = arena.clientHeight;

    // where things start: a saved arrangement, or all 49 in a 7 × 7 block in the middle, in a random order
    const order = prev ? prev.order : LAB.shuffle(ITEMS.map((_, i) => i));
    const pos = prev ? prev.pos.map(p => ({ x: p.x, y: p.y })) : new Array(N);
    if (!prev) {
      const cw = Math.min(76, (W0 - 24) / 7), rh = Math.min(44, (H0 - 24) / 7);
      order.forEach((idx, k) => {
        const c = k % 7, r = Math.floor(k / 7);
        pos[idx] = { x: (W0 / 2 + (c - 3) * cw) / W0, y: (H0 / 2 + (r - 3) * rh) / H0 };
      });
    }
    const moved = new Set(prev ? prev.moved : []), moves = prev ? prev.moves.slice() : new Array(N).fill(0);
    const t = { before: prev ? prev.elapsedMs : 0, t0: performance.now(), first: prev ? prev.firstMs : null, last: prev ? prev.lastMs : null, n: prev ? prev.n : 0 };
    const now = () => t.before + performance.now() - t.t0;
    const keep = () => LAB.store.set(KEY, { pid: state.pid, session: state.session, startedAt: state.startedAt, l1: state.l1, input: state.input,
      order, pos, moved: [...moved], moves, elapsedMs: now(), firstMs: t.first, lastMs: t.last, n: t.n });
    keep();
    let selected = null, drag = null, z = 1;

    const els = order.map(idx => {
      const it = ITEMS[idx], el = document.createElement('button');
      el.type = 'button'; el.className = 'emo-word' + (moved.has(idx) ? '' : ' unmoved'); el.textContent = it.zh; el.dataset.idx = idx; el.lang = 'zh-Hans';
      el.style.zIndex = moved.has(idx) ? ++z : 5000;   // names not yet moved stay on top, so a moved one never hides them
      el.setAttribute('aria-label', it.zh + (moved.has(idx) ? '' : T.notMoved));
      arena.appendChild(el);
      return el;
    });
    const paint = el => { const p = pos[el.dataset.idx]; el.style.left = (p.x * 100) + '%'; el.style.top = (p.y * 100) + '%'; };
    els.forEach(paint);
    const count = () => {
      $('#moved-count').textContent = T.moved(moved.size, N);
      $('#btn-arranged').disabled = moved.size < N;
    };
    count();

    // the inside of the box (the names are placed within its border), in page pixels
    const inner = () => { const r = arena.getBoundingClientRect(); return { left: r.left + arena.clientLeft, top: r.top + arena.clientTop, width: arena.clientWidth, height: arena.clientHeight }; };
    // place a name with its centre at (cx, cy) in page pixels, kept inside the box
    const placeAt = (el, cx, cy) => {
      const r = inner(), w = el.offsetWidth, h = el.offsetHeight;
      const x = Math.min(r.width - w / 2 - 2, Math.max(w / 2 + 2, cx - r.left)), y = Math.min(r.height - h / 2 - 2, Math.max(h / 2 + 2, cy - r.top));
      pos[el.dataset.idx] = { x: x / r.width, y: y / r.height };
      el.style.zIndex = drag && drag.el === el ? 9000 : (moved.has(Number(el.dataset.idx)) ? ++z : 5000);
      paint(el);
    };
    const markMoved = el => {
      const idx = Number(el.dataset.idx), ms = Math.round(now());
      t.n++; moves[idx]++;
      if (t.first === null) t.first = ms;
      t.last = ms;
      if (!moved.has(idx)) { moved.add(idx); el.classList.remove('unmoved'); el.setAttribute('aria-label', ITEMS[idx].zh); el.style.zIndex = ++z; count(); }
      keep();
    };
    const select = el => {
      if (selected) selected.classList.remove('selected');
      selected = selected === el ? null : el;
      if (selected) selected.classList.add('selected');
    };

    els.forEach(el => {
      el.addEventListener('pointerdown', e => {
        if (!state.input) state.input = e.pointerType || 'mouse';
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const r = el.getBoundingClientRect();
        drag = { el, dx: e.clientX - (r.left + r.width / 2), dy: e.clientY - (r.top + r.height / 2), x0: e.clientX, y0: e.clientY, moved: false };
        el.focus({ preventScroll: true });
      });
      el.addEventListener('pointermove', e => {
        if (!drag || drag.el !== el) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
        drag.moved = true;
        el.classList.add('dragging');
        placeAt(el, e.clientX - drag.dx, e.clientY - drag.dy);
      });
      const end = () => {
        if (!drag || drag.el !== el) return;
        el.classList.remove('dragging');
        if (drag.moved) { markMoved(el); el.style.zIndex = ++z; if (selected) select(selected); } else select(el);
        drag = null;
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      // keyboard: arrow keys move the focused name (Shift: further)
      el.addEventListener('keydown', e => {
        const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (!d) return;
        e.preventDefault();
        if (!state.input) state.input = 'keyboard';
        const b = el.getBoundingClientRect(), step = e.shiftKey ? 40 : 10;
        placeAt(el, b.left + b.width / 2 + d[0] * step, b.top + b.height / 2 + d[1] * step);
        markMoved(el);
      });
    });
    // tap or click an empty spot: the selected name goes there
    arena.addEventListener('pointerdown', e => {
      if (e.target !== arena || !selected) return;
      if (!state.input) state.input = e.pointerType || 'mouse';
      const el = selected;
      placeAt(el, e.clientX, e.clientY);
      markMoved(el);
      select(el);
      el.focus({ preventScroll: true });
    });
    window.addEventListener('resize', fit);

    $('#btn-arranged').addEventListener('click', () => {
      if (selected) select(selected);
      $('#confirm').hidden = false;
      $('#confirm').scrollIntoView({ block: 'nearest' });
      $('#btn-confirm').focus();
    });
    $('#btn-back').addEventListener('click', () => { $('#confirm').hidden = true; $('#btn-arranged').focus(); });
    $('#btn-confirm').addEventListener('click', () => {
      const r = inner();
      window.removeEventListener('resize', fit);
      submit({ w: r.width, h: r.height, pos, moves, ms: Math.round(now()), first: t.first, last: t.last, n: t.n });
    }, { once: true });
  }

  /* ---------- submit: one summary row (everything the results page needs) + one row per name ---------- */
  async function submit(A) {
    const [p1, p2] = C.pack(A.pos), dist = C.distances(C.unpack(p1, p2), A.w, A.h);
    const summary = {
      exp: 'emotion', pid: state.pid, session: state.session, l1: state.l1 || '',
      started_at: state.startedAt, submitted_at: new Date().toISOString(),
      arena_w: A.w, arena_h: A.h, input: state.input || 'mouse', resumed: state.resumed,
      n_moves: A.n, first_move_ms: A.first, last_move_ms: A.last, arrange_ms: A.ms,
      items: C.VERSION, p1, p2,
      check_dist: LAB.round(dist.check, 4), check_ok: dist.check <= C.CHECK_MAX ? 1 : 0, include: 1
    };
    const trials = ITEMS.map((it, k) => ({ pid: state.pid, session: state.session, item: k + 1, word: it.key, zh: it.zh,
      x: LAB.round(A.pos[k].x, 4), y: LAB.round(A.pos[k].y, 4), moves: A.moves[k] }));
    LAB.store.set(KEY, null);
    LAB.markDone('emotion');
    $('#s-done').innerHTML = `<div class="column"><h1>${T.doneTitle}</h1><p class="lead">${T.doneText}</p><p class="small muted" id="done-status"></p></div>`;
    show('s-done');
    const st = await LAB.submit({ v: 1, exp: 'emotion', pid: state.pid, session: state.session, submissionId: LAB.uid(), summary, trials });
    if (st.pending) $('#done-status').textContent = T.saved;
    document.addEventListener('lab:sent', () => { $('#done-status').textContent = ''; });
  }

  show('s-intro');
  LAB.flush();
})();
