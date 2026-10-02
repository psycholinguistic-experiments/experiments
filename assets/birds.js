/* LT5461 — bird task: rate how typical each of 12 pictures is, 1–5.
   Materials and scale: assets/bird-items.js (from the Google Forms version).
   One picture per screen, in a new random order for each run. All twelve
   pictures start loading while the intro is read; a picture that has not
   arrived yet cannot be rated (the screen waits for it). Answers: click / tap
   a number, or press 1–5. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const ITEMS = window.BIRD_ITEMS, N = ITEMS.scale.n;
  const state = { pid: LAB.pid(), session: LAB.session(), data: [], startedAt: new Date().toISOString(), hidden: false };

  // A trial interrupted by leaving the tab is flagged (its time is not a rating time).
  document.addEventListener('visibilitychange', () => { if (document.hidden) state.hidden = true; });

  function show(id) {
    $$('.screen').forEach(s => { s.hidden = s.id !== id; });
    window.scrollTo(0, 0);
    const h = document.querySelector('#' + id + ' h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  /* ---------- pictures ---------- */
  // Shown at most 25rem tall and 40rem wide (see .bird-photo in lab.css).
  const REM = 17;
  function picture(b, first) {
    const shown = Math.round(Math.min(40 * REM, 25 * REM * b.w / b.h));
    const sizes = `(max-width: ${shown + 48}px) calc(100vw - 3rem), ${shown}px`;
    const set = ext => b.widths.map(w => `assets/img/birds/${b.img}-${w}.${ext} ${w}w`).join(', ');
    return `<picture>` +
      `<source type="image/avif" srcset="${set('avif')}" sizes="${sizes}">` +
      `<source type="image/webp" srcset="${set('webp')}" sizes="${sizes}">` +
      `<img src="assets/img/birds/${b.img}-${b.widths[0]}.jpg" srcset="${set('jpg')}" sizes="${sizes}" ` +
      `width="${b.w}" height="${b.h}" alt="Photo: ${b.name}" decoding="async"${first ? ' fetchpriority="high"' : ''}>` +
      `</picture>`;
  }

  const order = LAB.shuffle(ITEMS.birds.slice());
  const [lo, hi] = [ITEMS.scale.lo, ITEMS.scale.hi].map(s => s.replace(/^([^:]+):/, '<strong>$1</strong>:'));
  $('#b-photos').innerHTML = order.map((b, i) => `<div class="bird-photo" data-key="${b.key}" hidden>${picture(b, i === 0)}</div>`).join('');
  $('#b-scale').innerHTML = Array.from({ length: N }, (_, i) =>
    `<button class="resp-btn" type="button" data-v="${i + 1}">${i + 1}</button>`).join('');
  $('#b-lo').innerHTML = lo;
  $('#b-hi').innerHTML = hi;

  /* ---------- one picture ---------- */
  // Nobody rates a picture they have not seen. settle() resolves 'ok' once
  // the picture is there, 'error' if it failed (also before its turn), and
  // 'slow' if it has not arrived within ms, so the task never waits for good.
  const shown = img => img.complete && img.naturalWidth > 0;
  function settle(img, ms, fresh) {
    // After a refetch, wait for the new request's own event: some engines may
    // still report the old, broken one as complete.
    if (!fresh && img.complete) return Promise.resolve(shown(img) ? 'ok' : 'error');
    return new Promise(res => {
      const done = how => {
        clearTimeout(timer);
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
        res(how);
      };
      const onLoad = () => done('ok'), onError = () => done('error');
      const timer = setTimeout(() => done(shown(img) ? 'ok' : 'slow'), ms);
      img.addEventListener('load', onLoad);
      img.addEventListener('error', onError);
    });
  }
  // A second try at a picture that failed: the same files, fetched afresh.
  // (Only after an error: a slow download is left to finish.)
  function refetch(photo) {
    const bust = set => set.replace(/\.(avif|webp|jpg)(?=[\s,]|$)/g, `.$1?retry=${Date.now()}`);
    photo.querySelectorAll('source').forEach(src => { src.srcset = bust(src.getAttribute('srcset')); });
    const img = photo.querySelector('img');
    img.srcset = bust(img.getAttribute('srcset'));
    img.src = bust(img.getAttribute('src'));
  }

  async function ask(b, idx) {
    $('#b-count').textContent = `${idx + 1} / ${order.length}`;
    const bar = $('#s-item .progress-track');
    bar.setAttribute('aria-valuenow', idx);
    bar.querySelector('i').style.width = (idx / order.length * 100) + '%';
    $('#b-name').textContent = b.name;
    const photo = $(`#b-photos .bird-photo[data-key="${b.key}"]`);
    $$('#b-photos .bird-photo').forEach(p => { p.hidden = p !== photo; });
    const btns = $$('#b-scale .resp-btn');
    btns.forEach(x => { x.classList.remove('picked'); x.disabled = true; });
    $$('.screen').forEach(s => { s.hidden = s.id !== 's-item'; });
    window.scrollTo(0, 0);
    // Focus the name, never a number: a ring on "1" would look pre-selected.
    $('#b-name').focus({ preventScroll: true });
    const img = photo.querySelector('img');
    let ok = shown(img);
    if (!ok) {
      photo.classList.add('loading');
      const slow = setTimeout(() => photo.classList.add('slow'), 300);
      let how = await settle(img, 60000);
      if (how === 'error') { refetch(photo); how = await settle(img, 30000, true); }
      ok = how === 'ok';
      clearTimeout(slow);
      photo.classList.remove('loading', 'slow');
    }
    // Still no picture: the trial is skipped and flagged; the rating stays
    // empty (Bird plot.Rmd gives a missing rating the bird's mean).
    if (!ok) return { v: '', rt: NaN, hidden: document.hidden, failed: true };
    btns.forEach(x => { x.disabled = false; });
    state.hidden = document.hidden;
    const t0 = performance.now();
    return new Promise(res => {
      let done = false;
      const choose = btn => {
        // A double click or tap must not also rate the next picture.
        if (done || performance.now() - t0 < 250) return;
        done = true;
        window.removeEventListener('keydown', onKey);
        $('#b-scale').removeEventListener('click', onClick);
        const rt = performance.now() - t0;
        btn.classList.add('picked');
        setTimeout(() => res({ v: Number(btn.dataset.v), rt, hidden: state.hidden }), 180);
      };
      const onClick = e => {
        const btn = e.target.closest('.resp-btn');
        if (!btn) return;
        choose(btn);
        // An ignored tap must not leave a number focused (it would look chosen).
        if (!done) $('#b-name').focus({ preventScroll: true });
      };
      const onKey = e => {
        if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
        const btn = /^[1-9]$/.test(e.key) && Number(e.key) <= N ? $(`#b-scale .resp-btn[data-v="${e.key}"]`) : null;
        if (btn) choose(btn);
      };
      $('#b-scale').addEventListener('click', onClick);
      window.addEventListener('keydown', onKey);
    });
  }

  async function run() {
    for (let i = 0; i < order.length; i++) {
      const b = order[i];
      const r = await ask(b, i);
      state.data.push({ position: i + 1, bird: b.key, rating: r.v, rt: LAB.round(r.rt, 0), hidden: r.hidden ? 1 : 0, img_failed: r.failed ? 1 : 0 });
    }
    finalScreen();
  }

  /* ---------- English self-ratings, then submit ---------- */
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
      LAB.markDone('birds');
      show('s-done');
      const st = await LAB.submit({
        v: 1, exp: 'birds', pid: state.pid, session: state.session, submissionId: LAB.uid(),
        summary: summarise(prof.fields(ratings)),
        trials: state.data.map(d => Object.assign({ pid: state.pid, session: state.session }, d))
      });
      if (st.pending) $('#done-status').textContent = 'Your answers are saved on this device and will be sent the next time you open any of the tasks.';
      document.addEventListener('lab:sent', () => { $('#done-status').textContent = ''; });
    });
  }

  // One row per person: a rating column per bird, as in the form's export.
  function summarise(prof) {
    const out = {
      exp: 'birds', pid: state.pid, session: state.session,
      started_at: state.startedAt, submitted_at: new Date().toISOString()
    };
    state.data.forEach(d => { if (d.rating !== '') out[d.bird] = d.rating; });
    out.median_rt = LAB.round(LAB.median(state.data.map(d => d.rt).filter(v => v !== '')), 0);
    out.hidden_trials = state.data.filter(d => d.hidden).length;
    out.img_failed = state.data.filter(d => d.img_failed).length;
    return Object.assign(out, prof);
  }

  $('#btn-start').addEventListener('click', run);
  show('s-intro');
  LAB.flush();
})();
