/* LT5461 — animal task: a spatial arrangement of twenty mammals, then thirty
   similarity-based inferences (after Douven et al., 2023).
     Part 1  the names start in two columns of ten (random order); the student
             drags each one (or taps a name, then the spot) so that more similar
             animals sit closer together, and must move every name.
     Part 2  a practice question (elephants → bears), then 30 ordered pairs
             drawn at random from the 380: "Suppose A have property K7. Then how
             strongly does it follow that B have property K7?", a 0–100% slider
             that starts at 50%, a new letter–digit property each time.
   Positions are stored as fractions of the box, with the box's size in
   pixels, so distances can be taken as the student saw them. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const ITEMS = window.ANIMAL_ITEMS;
  const N_TRIALS = 30;

  const state = { pid: LAB.pid(), session: LAB.session(), startedAt: new Date().toISOString(), actions: 0, input: '' };

  function show(id) {
    $$('.screen').forEach(s => { s.hidden = s.id !== id; });
    window.scrollTo(0, 0);
    const h = document.querySelector('#' + id + ' h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
  const button = (id, label, attrs) => `<button class="btn" type="button" id="${id}"${attrs || ''}>${label} <span class="arrow" aria-hidden="true">→</span></button>`;

  /* ---------- intro ---------- */
  $('#s-intro').innerHTML = `<div class="column">
      <h1>Animal task</h1>
      <p class="lead">This is an anonymous class activity and is not graded.</p>
      <p>It has two parts. Please complete it individually and do not discuss it with other students.</p>
      <div class="actions">${button('btn-start', 'Start')}</div></div>`;
  $('#btn-start').addEventListener('click', arrangeIntro);

  /* ---------- part 1: the arrangement ---------- */
  // The instructions get their own screen, so the box can have all of the next one.
  function arrangeIntro() {
    $('#s-part').innerHTML = `<div class="column"><p class="eyebrow">Part 1 of 2</p><h1>Arrange the animals</h1>
        <p class="lead">On the next screen you will see the names of twenty animals in a box.</p>
        <p>Drag the names to any place in the box so that the layout shows how similar the animals are: put more similar animals closer together and more dissimilar animals further apart. Use the whole box, and move every name.</p>
        <p class="muted">You can also tap or click a name, then tap or click where it should go.</p>
        <div class="actions">${button('btn-arrange', 'Start arranging')}</div></div>`;
    show('s-part');
    $('#btn-arrange').addEventListener('click', arrange, { once: true });
  }
  function arrange() {
    $('#s-arrange').innerHTML = `<div class="arrange-wrap">
        <div class="arrange-bar"><h1 class="arrange-h">Closer = more similar</h1><span id="moved-count" aria-live="polite"></span>${button('btn-arranged', 'Done', ' disabled')}</div>
        <div class="arena" id="arena" role="application" aria-label="Arrangement box. Select a name, then move it with the arrow keys, or tap a spot to place it."></div>
        <div class="confirm" id="confirm" hidden>
          <p><strong>Are you satisfied with this arrangement?</strong></p>
          <div class="actions">${button('btn-confirm', 'Yes, continue')}<button class="btn btn-quiet" type="button" id="btn-back">Keep arranging</button></div>
        </div></div>`;
    show('s-arrange');
    const arena = $('#arena'), t0 = performance.now();
    const order = LAB.shuffle(ITEMS.map((_, i) => i));
    const narrowCols = () => arena.clientWidth < 560;
    const pos = {}, moved = new Set();
    let selected = null, drag = null;

    // the box fills the screen below the instructions (never shorter than 320 px)
    const fit = () => {
      const top = arena.getBoundingClientRect().top + window.scrollY;
      arena.style.height = Math.round(Math.max(320, Math.min(760, window.innerHeight - top - 16))) + 'px';
    };
    fit();
    const els = order.map((idx, k) => {
      const it = ITEMS[idx], el = document.createElement('button');
      el.type = 'button'; el.className = 'animal unmoved'; el.textContent = it.name; el.dataset.idx = idx;
      el.style.zIndex = 5000;   // names not yet moved stay on top, so a moved one can never hide them
      el.setAttribute('aria-label', it.name + ', not moved yet');
      const col = k < 10 ? 0 : 1, row = k % 10;
      pos[idx] = { x: narrowCols() ? (col ? 0.7 : 0.3) : (col ? 0.58 : 0.42), y: 0.1 + row * 0.8 / 9 };
      arena.appendChild(el);
      return el;
    });
    const paint = el => { const p = pos[el.dataset.idx]; el.style.left = (p.x * 100) + '%'; el.style.top = (p.y * 100) + '%'; };
    els.forEach(paint);
    let z = 1;
    const count = () => {
      $('#moved-count').textContent = `${moved.size}/${ITEMS.length} moved`;
      $('#btn-arranged').disabled = moved.size < ITEMS.length;
    };
    count();

    // place a name with its centre at (cx, cy) in page pixels, kept inside the box
    const placeAt = (el, cx, cy) => {
      const r = arena.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
      const x = Math.min(r.width - w / 2 - 2, Math.max(w / 2 + 2, cx - r.left)), y = Math.min(r.height - h / 2 - 2, Math.max(h / 2 + 2, cy - r.top));
      pos[el.dataset.idx] = { x: x / r.width, y: y / r.height };
      el.style.zIndex = drag && drag.el === el ? 9000 : (moved.has(el.dataset.idx) ? ++z : 5000);
      paint(el);
    };
    const markMoved = el => {
      state.actions++;
      if (!moved.has(el.dataset.idx)) { moved.add(el.dataset.idx); el.classList.remove('unmoved'); el.setAttribute('aria-label', ITEMS[el.dataset.idx].name); el.style.zIndex = ++z; count(); }
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
        const r = arena.getBoundingClientRect(), b = el.getBoundingClientRect(), step = e.shiftKey ? 40 : 10;
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
    const onResize = () => { fit(); };
    window.addEventListener('resize', onResize);

    $('#btn-arranged').addEventListener('click', () => {
      if (selected) select(selected);
      $('#confirm').hidden = false;
      $('#confirm').scrollIntoView({ block: 'nearest' });
      $('#btn-confirm').focus();
    });
    $('#btn-back').addEventListener('click', () => { $('#confirm').hidden = true; $('#btn-arranged').focus(); });
    $('#btn-confirm').addEventListener('click', () => {
      const r = arena.getBoundingClientRect();
      state.arena = { w: Math.round(r.width), h: Math.round(r.height) };
      state.pos = pos;
      state.arrangeMs = performance.now() - t0;
      window.removeEventListener('resize', onResize);
      infer();
    });
  }

  /* ---------- part 2: inferences ---------- */
  const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // no I or O, which read as digits
  function properties(n) {
    const out = new Set();
    while (out.size < n) out.add(LETTERS[Math.floor(Math.random() * LETTERS.length)] + (1 + Math.floor(Math.random() * 9)));
    return [...out];
  }
  const sliderHTML = `<div class="slider">
      <input type="range" id="slider" min="0" max="100" step="1" value="50" aria-describedby="slider-ends" aria-valuetext="50%">
      <output id="slider-out" for="slider">50%</output>
      <div class="scale-ends" id="slider-ends"><span>Does not follow at all</span><span>Follows very strongly</span></div>
    </div>`;
  const question = (a, b, p) => `Suppose ${a} have property ${p}. Then how strongly does it follow that ${b} have property ${p}?`;

  // one question on screen; resolves with the slider's value once the student has moved it and pressed Next
  function ask(html, label) {
    $('#s-infer').innerHTML = `<div class="column">${html}${sliderHTML}
        <p class="small muted" id="slider-hint">Move the slider to answer.</p>
        <div class="actions">${button('btn-next', label, ' disabled')}</div></div>`;
    show('s-infer');
    const s = $('#slider'), out = $('#slider-out'), t0 = performance.now();
    $('#item-q').focus({ preventScroll: true });
    return new Promise(res => {
      const touched = () => { $('#btn-next').disabled = false; $('#slider-hint').hidden = true; };
      s.addEventListener('input', () => { out.textContent = s.value + '%'; s.setAttribute('aria-valuetext', s.value + '%'); touched(); });
      s.addEventListener('pointerdown', touched);
      $('#btn-next').addEventListener('click', () => res({ v: Number(s.value), rt: performance.now() - t0 }), { once: true });
    });
  }

  async function infer() {
    const eleph = ITEMS.findIndex(it => it.key === 'elephant'), bear = ITEMS.findIndex(it => it.key === 'bear');
    const practice = await ask(`<p class="eyebrow">Part 2: Inferences · practice</p><h1 class="visually-hidden">Part 2</h1>
        <p class="item-q" id="item-q" tabindex="-1">${question('elephants', 'bears', 'Q2')}</p>
        <p class="infer-help">Please rate the statement by moving the slider to the left or the right. By “follow” we mean that the context as described invites this conclusion. For example, if you think that the assumption that elephants have property Q2 definitely invites the conclusion that bears have that property too, then move the slider to the right. You are encouraged to consider the full range of the scale, including low, intermediate, and high levels, such as 37%, 58%, and 82%, respectively.</p>`, 'Next');
    state.practice = practice.v;
    // 30 ordered pairs from the 380, never the practice pair
    const pairs = [];
    ITEMS.forEach((_, i) => ITEMS.forEach((__, j) => { if (i !== j && !(i === eleph && j === bear)) pairs.push([i, j]); }));
    const chosen = LAB.shuffle(pairs).slice(0, N_TRIALS), props = properties(N_TRIALS), t0 = performance.now();
    state.trials = [];
    for (let k = 0; k < chosen.length; k++) {
      const [i, j] = chosen[k];
      const r = await ask(`<p class="eyebrow">Part 2: Inferences · ${k + 1} / ${N_TRIALS}</p><h1 class="visually-hidden">Question ${k + 1}</h1>
          <p class="item-q" id="item-q" tabindex="-1">${question(ITEMS[i].plural, ITEMS[j].plural, props[k])}</p>`, k + 1 < N_TRIALS ? 'Next' : 'Continue');
      state.trials.push({ trial: k + 1, i, j, premise: ITEMS[i].key, conclusion: ITEMS[j].key, property: props[k], response: r.v, rt: LAB.round(r.rt, 0) });
    }
    state.inferMs = performance.now() - t0;
    finalScreen();
  }

  /* ---------- final questions ---------- */
  function finalScreen() {
    $('#s-final').innerHTML = `<div class="column"><h1>Final questions</h1>
      <form id="form-final" novalidate>
        <div id="prof"></div>
        <p class="form-error" id="final-error" role="alert"></p>
        <div class="actions"><button class="btn" type="submit">Submit <span class="arrow" aria-hidden="true">→</span></button></div>
      </form></div>`;
    const prof = LAB.proficiency($('#prof'), 'en');
    show('s-final');
    $('#form-final').addEventListener('change', () => { $('#final-error').textContent = ''; });
    $('#form-final').addEventListener('submit', async e => {
      e.preventDefault();
      const ratings = prof.read();
      if (!ratings) { $('#final-error').textContent = prof.missingText; return; }
      const summary = summarise(prof.fields(ratings));
      LAB.markDone('animals');
      $('#s-done').innerHTML = `<div class="column"><h1>Submitted</h1><p class="lead">Please do not discuss the questions with other students until the instructor ends the activity.</p><p class="small muted" id="done-status"></p></div>`;
      show('s-done');
      const st = await LAB.submit({
        v: 1, exp: 'animals', pid: state.pid, session: state.session, submissionId: LAB.uid(), summary,
        trials: state.trials.map(t => ({ pid: state.pid, session: state.session, trial: t.trial, premise: t.premise, conclusion: t.conclusion, property: t.property, response: t.response, rt: t.rt }))
      });
      if (st.pending) $('#done-status').textContent = 'Your answers are saved on this device and will be sent the next time you open any of the tasks.';
      document.addEventListener('lab:sent', () => { $('#done-status').textContent = ''; });
    });
  }

  /* One row per student (the results page reads only these): each animal's
     position as a share of the box (x_cat, y_cat …) with the box's size, and
     the 30 inferences as "premise>conclusion:response" item indices (see
     animal-items.js), fifteen per field. */
  function summarise(prof) {
    const out = {
      exp: 'animals', pid: state.pid, session: state.session,
      started_at: state.startedAt, submitted_at: new Date().toISOString(),
      arena_w: state.arena.w, arena_h: state.arena.h, input: state.input || 'mouse', n_actions: state.actions,
      arrange_ms: LAB.round(state.arrangeMs, 0), infer_ms: LAB.round(state.inferMs, 0), practice: state.practice,
      inf_a: state.trials.slice(0, 15).map(t => `${t.i}>${t.j}:${t.response}`).join('|'),
      inf_b: state.trials.slice(15).map(t => `${t.i}>${t.j}:${t.response}`).join('|'),
      include: 1
    };
    ITEMS.forEach((it, idx) => { out['x_' + it.key] = LAB.round(state.pos[idx].x, 4); out['y_' + it.key] = LAB.round(state.pos[idx].y, 4); });
    return Object.assign(out, prof);
  }

  show('s-intro');
  LAB.flush();
})();
