/* LT5461 — live class dashboard (projector view). Reads anonymous per-person
   summaries from the Apps Script endpoint and redraws every 5 seconds. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const num = LAB.num;
  const EXPS = ['masked', 'visible', 'bouba', 'fle', 'fast', 'svt', 'birds'];
  // Sentence task: the English self-ratings, in the order the results page shows them.
  const SVT_SKILLS = [['eng_mean', 'Mean of five'], ['eng_overall', 'Overall'], ['eng_listening', 'Listening'], ['eng_speaking', 'Speaking'], ['eng_reading', 'Reading'], ['eng_writing', 'Writing']];
  const state = {
    session: LAB.params.get('session') || LAB.hkDate(),
    rows: { masked: [], visible: [], bouba: [], fle: [], fast: [], svt: [], birds: [] },
    timer: null,
    loadedOnce: false
  };
  let lastKey = '';

  const included = rows => rows.filter(r => String(r.include) === '1');
  const fmtMs = v => isFinite(v) ? Math.round(v) + ' ms' : '–';
  const fmtCI = a => isFinite(a[0]) ? `${LAB.signed(a[0])}\u00a0to\u00a0${LAB.signed(a[1])}` : '–';

  /* ---------- tabs ---------- */
  const tabs = [$('#tab-words'), $('#tab-shapes'), $('#tab-fle'), $('#tab-fast'), $('#tab-svt'), $('#tab-birds')];
  function selectTab(t) {
    tabs.forEach(x => {
      const on = x === t;
      x.setAttribute('aria-selected', on);
      x.tabIndex = on ? 0 : -1;
      $('#' + x.getAttribute('aria-controls')).hidden = !on;
    });
    LAB.store.set('dash-tab', t.id);
    render();
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectTab(t));
    t.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        n.focus(); selectTab(n);
      }
    });
  });

  /* ---------- controls ---------- */
  const hide = $('#hide'), live = $('#live'), sel = $('#session');
  // Charts are laid out at their box's width, which is 0 while hidden: redraw on reveal.
  hide.addEventListener('change', () => { document.body.classList.toggle('hidden-results', hide.checked); if (!hide.checked) { lastKey = ''; render(); } });
  // Revealing the bird map draws it afresh, so the birds arrive in view.
  hide.addEventListener('change', () => { if (!hide.checked && !$('#panel-birds').hidden) { birdState.geom = null; lastKey = ''; render(); } });
  live.addEventListener('change', schedule);
  sel.addEventListener('change', () => { state.session = sel.value; refresh(); });
  $('#csv').addEventListener('click', () => {
    const all = EXPS.flatMap(e => state.rows[e].map(r => Object.assign({ exp: e }, r)));
    LAB.download(`lt5461-class-${state.session}.csv`, LAB.toCSV(all));
  });

  function setStatus(text, on) {
    $('#status .label').textContent = text;
    $('#status .live-dot').classList.toggle('off', !on);
  }

  // The class menu shows today's class at once and fills in the other
  // classes when the list arrives; the results never wait for it.
  async function loadSessions() {
    if (!sel.options.length) renderSessions([]);
    let list;
    try { list = await LAB.fetchSessions(); } catch (e) { return; }
    renderSessions(list);
  }

  function renderSessions(list) {
    list = list.slice();
    const today = LAB.hkDate();
    if (!list.some(s => s.session === today)) list.push({ session: today, n: 0 });
    if (!/^\d{4}$/.test(state.session) && !list.some(s => s.session === state.session)) list.push({ session: state.session, n: 0 });
    list.sort((a, b) => b.session.localeCompare(a.session));
    // One entry per class (date), then one per year pooling that year's classes.
    const years = {};
    list.forEach(s => { if (/^\d{4}-/.test(s.session)) { const y = s.session.slice(0, 4); years[y] = (years[y] || 0) + s.n; } });
    const opt = (value, text) => `<option value="${value}"${value === state.session ? ' selected' : ''}>${text}</option>`;
    sel.innerHTML =
      `<optgroup label="Classes">${list.map(s => opt(s.session, `${s.session === today ? 'Today · ' : ''}${s.session}${s.n ? ` (${s.n})` : ''}`)).join('')}</optgroup>` +
      `<optgroup label="Whole year">${Object.keys(years).sort().reverse().map(y => opt(y, `All ${y} classes (${years[y]})`)).join('')}</optgroup>`;
  }

  async function refresh() {
    if (!LAB.connected()) {
      $('#not-connected').hidden = false;
      setStatus('Not connected', false);
      render();
      return;
    }
    // One refresh at a time: if Google is slow, the next tick waits.
    if (state.busy) return;
    state.busy = true;
    const session = state.session;
    // Each task is fetched on its own, so one failure (or a task the data
    // script does not know yet) never blanks the others.
    const res = await Promise.allSettled(EXPS.map(e => LAB.fetchClass(e, session))).finally(() => { state.busy = false; });
    if (session !== state.session) return refresh();   // class changed meanwhile
    const failed = [], unknown = [];
    EXPS.forEach((e, i) => {
      const r = res[i];
      if (r.status === 'fulfilled') state.rows[e] = r.value.rows || [];
      else if (/unknown experiment/.test(r.reason && r.reason.message)) { state.rows[e] = []; unknown.push(e); }
      else failed.push(e);
    });
    $('#f-not-ready').hidden = !unknown.includes('fle');
    if (failed.length === EXPS.length) {
      const why = res[0].reason;
      setStatus(`Could not reach the class data (${why && why.name === 'AbortError' ? 'no answer' : (why && why.message) || 'error'}). Retrying…`, false);
      return;
    }
    clearInterval(state.waitTimer);
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setStatus(`Live · updated ${time}` + (failed.length ? ' · some results could not be loaded, retrying' : ''), true);
    state.fetched = true;
    render();
    if (!state.loadedOnce) { state.loadedOnce = true; loadSessions(); }
  }

  // A table wrapper is a keyboard stop only when it actually scrolls.
  function syncScrollers() {
    document.querySelectorAll('.table-wrap').forEach(w => {
      w.classList.remove('scrolls');   // measure without the sticky column's own width cap
      const scrolls = w.offsetParent && w.scrollWidth > w.clientWidth + 1;
      w.classList.toggle('scrolls', !!scrolls);
      if (scrolls) { w.tabIndex = 0; w.setAttribute('role', 'region'); w.setAttribute('aria-label', w.dataset.label); }
      else { w.removeAttribute('tabindex'); w.removeAttribute('role'); w.removeAttribute('aria-label'); }
    });
  }
  window.addEventListener('resize', () => {
    clearTimeout(state.rs);
    state.rs = setTimeout(() => {
      // The association charts are laid out at their box's width: redraw them when it changes.
      const w = $('#panel-fast').hidden ? 0 : $('#panel-fast').clientWidth;
      if (w && w !== state.fastW) { state.fastW = w; lastKey = ''; render(); }
      const ws = $('#panel-svt').hidden ? 0 : $('#panel-svt').clientWidth;
      if (ws && ws !== state.svtW) { state.svtW = ws; lastKey = ''; render(); }
      const wb = $('#panel-birds').hidden ? 0 : $('#panel-birds').clientWidth;
      // A new width means new pixel positions: redraw in place, no glide.
      if (wb && wb !== birdState.w) { birdState.geom = null; birdState.still = true; lastKey = ''; render(); }
      syncScrollers();
    }, 150);
  });

  function schedule() {
    clearInterval(state.timer);
    if (live.checked) state.timer = setInterval(() => { if (!document.hidden) refresh(); }, 5000);
  }

  /* ---------- rendering ---------- */
  function render() {
    const m = state.rows.masked, v = state.rows.visible, b = state.rows.bouba, f = state.rows.fle, a = state.rows.fast, sv = state.rows.svt, bd = state.rows.birds;
    $('#n-words').textContent = m.length + v.length;
    $('#n-shapes').textContent = b.length;
    $('#n-fle').textContent = f.length;
    $('#veil-masked').textContent = m.length;
    $('#veil-visible').textContent = v.length;
    $('#veil-shapes').textContent = b.length;
    $('#veil-fle-zh').textContent = f.filter(r => r.lang === 'zh').length;
    $('#veil-fle-en').textContent = f.filter(r => r.lang === 'en').length;
    $('#n-fast').textContent = a.length;
    $('#veil-fast-zh').textContent = a.filter(r => r.order === 'zh-en').length;
    $('#veil-fast-en').textContent = a.filter(r => r.order === 'en-zh').length;
    $('#n-svt').textContent = sv.length;
    $('#veil-svt').textContent = sv.length;
    $('#n-birds').textContent = bd.length;
    $('#veil-birds').textContent = bd.length;
    // Redraw charts only when the data changed, so the dot animation does not
    // replay every five seconds.
    const key = JSON.stringify([state.session, m.length, v.length, b.length, m.map(r => r.pid + r.effect), v.map(r => r.pid + r.effect), b.map(r => r.pid), f.map(r => r.pid + r.lang), a.map(r => r.pid + r.session), sv.map(r => r.pid + r.run + r.effect), fastState.norms ? 1 : 0, bd.map(r => r.pid + r.submitted_at), state.fetched ? 1 : 0]) + tabs.find(t => t.getAttribute('aria-selected') === 'true').id;
    if (key === lastKey) return;
    lastKey = key;
    if (!$('#panel-words').hidden) renderWords(m, v);
    if (!$('#panel-shapes').hidden) renderShapes(b);
    if (!$('#panel-fle').hidden) renderFLE(f);
    if (!$('#panel-fast').hidden) renderFast(a);
    if (!$('#panel-svt').hidden) renderSvt(sv);
    if (!$('#panel-birds').hidden) renderBirds(bd);
    syncScrollers();
  }

  /* ---------- significance, shared ---------- */
  // Verdicts in words (the colour only repeats them). want: the predicted
  // sign of the difference (+1 / −1), or 0 when no difference is expected.
  const verdict = (r, want) => !r || !isFinite(r.p) ? 'na'
    : !LAB.isSig(r) ? 'Not significant'
    : want === 'same' ? 'Significant, though no difference was expected'
    : !want ? 'Significant'
    : Math.sign(r.diff) === want ? 'Significant, as predicted' : 'Significant, opposite to the prediction';
  const novar = r => r && r.reason === 'novar';
  // yes = significant (in the predicted direction, when there is one);
  // opp = significant the other way; no = not significant; na = cannot test.
  // want 'same' marks a check where no difference is expected, so a
  // significant result there is a warning, not a finding.
  const kind = (r, want) => !r || !isFinite(r.p) ? 'na' : !LAB.isSig(r) ? 'no' : want === 'same' ? 'opp' : (!want || Math.sign(r.diff) === want) ? 'yes' : 'opp';
  const DIR = { yes: 'as predicted', opp: 'opposite to the prediction' };
  const badge = (r, want) => {
    const k = kind(r, want);
    if (k === 'na') return `<span class="sig na">${novar(r) ? 'No variation to test' : 'Too few runs to test'}</span>`;
    const pill = `<span class="sig ${k}">${k === 'no' ? 'Not significant' : 'Significant'}</span>`;
    return want && k !== 'no' ? `${pill}<span class="dir">${want === 'same' ? 'no difference expected' : DIR[k]}</span>` : pill;
  };
  const resultCell = (r, want) => `<td class="result">${kind(r, want) === 'na' ? '–' : badge(r, want)}</td>`;
  const small = n => n > 0 && n < 10 ? ' (small sample)' : '';
  const smallTag = n => n > 0 && n < 10 ? ', small sample' : '';
  const dfTxt = df => Math.abs(df - Math.round(df)) < 1e-9 ? String(Math.round(df)) : df.toFixed(1);
  const tCell = r => `<td class="num sep">${r && isFinite(r.t) ? `${r.t < 0 ? '−' : ''}${Math.abs(r.t).toFixed(2)} (${dfTxt(r.df)})` : '–'}</td>`;
  const pCell = r => `<td class="num${LAB.isSig(r) ? ' p-sig' : ''}">${r ? LAB.fmtPval(r.p) : '–'}</td>`;
  const esCell = r => `<td class="num">${r && isFinite(r.es) ? (r.es < 0 ? '−' : '') + Math.abs(r.es).toFixed(2) : '–'}</td>`;
  const tHead = es => `<th class="num sep" scope="col"><i>t</i> (df)</th><th class="num" scope="col"><i>p</i></th>${es ? `<th class="num" scope="col">${es}</th>` : ''}<th class="result" scope="col">Result</th>`;
  const testLine = (r, want) => `${badge(r, want)}${r && isFinite(r.t) ? `<span>${LAB.fmtTest(r)}</span>` : ''}`;
  const inline = s => `<span class="stats-inline">(${s})</span>`;
  const bare = s => `<span class="stats-inline">${s}</span>`;
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const item = (r, html) => `<li>${html}</li>`;
  const lead = (name, r, want) => {
    const v = verdict(r, want);
    return `<strong>${name}: ${v === 'na' ? (novar(r) ? 'no variation to test' : 'not enough runs yet') : v.charAt(0).toLowerCase() + v.slice(1)}.</strong>`;
  };
  const SAME = 'Every run gave the same value.';

  /* ---------- judgement task: Chinese vs English ---------- */
  const signed1 = v => isFinite(v) ? (v >= 0.05 ? '+' : v <= -0.05 ? '−' : '') + Math.abs(v).toFixed(1) : '–';
  const f2 = v => isFinite(v) ? v.toFixed(2) : '–';
  const FLE = [
    { key: 'gamble_accept', label: 'Gambles accepted', short: 'Gambles accepted', tile: 'Gambles accepted', name: 'Gambles', scale: 100, unit: 'pts', want: 1,
      predicted: 'English higher', predText: 'more gambles accepted in English',
      say: x => `Students accepted ${Math.round(x.ma)}% of the favourable gambles in Chinese and ${Math.round(x.mb)}% in English`,
      fmt: v => isFinite(v) ? Math.round(v) + '%' : '–', dfmt: v => isFinite(v) ? signed1(v) + '\u00a0pts' : '–',
      plot: { host: '#f-gamble', domain: [0, 100], signed: false, xLabel: 'Share of the 8 favourable gambles accepted (%)' } },
    { key: 'sunk_mean', label: 'Sunk-cost continuation (1\u2060–\u20607)', short: 'Sunk-cost continuation', tile: 'Sunk cost', name: 'Sunk cost', scale: 1, want: -1,
      predicted: 'English lower', predText: 'less continuing in English',
      say: x => `Likelihood of continuing after a sunk cost, on a 1–7 scale, was ${f2(x.ma)} in Chinese and ${f2(x.mb)} in English`,
      fmt: f2, dfmt: v => isFinite(v) ? signed1(v) : '–',
      plot: { host: '#f-sunk', domain: [1, 7], signed: false, xLabel: 'Likelihood of continuing (1 = definitely not, 7 = definitely)' } },
    { key: 'sup_intensity', label: 'Superstition intensity (−4\u00a0to\u00a04)', short: 'Superstition intensity', tile: 'Superstition', name: 'Superstition', scale: 1, want: -1,
      predicted: 'English lower', predText: 'weaker in English',
      say: x => `Superstition intensity was ${f2(x.ma)} in Chinese and ${f2(x.mb)} in English`,
      fmt: f2, dfmt: v => isFinite(v) ? signed1(v) : '–',
      plot: { host: '#f-sup', domain: [-4, 4], signed: true, xLabel: 'Superstition intensity = (good-luck feeling − bad-luck feeling) / 2' } },
    { key: 'sup_bad', label: 'Feeling: bad-luck items (1\u2060–\u20609)', scale: 1, want: 1, predicted: 'English higher', fmt: f2, dfmt: v => isFinite(v) ? signed1(v) : '–' },
    { key: 'sup_good', label: 'Feeling: good-luck items (1\u2060–\u20609)', scale: 1, want: -1, predicted: 'English lower', fmt: f2, dfmt: v => isFinite(v) ? signed1(v) : '–' },
    { key: 'sup_neutral', label: 'Feeling: neutral controls (1\u2060–\u20609)', scale: 1, want: 'same', predicted: 'Similar', fmt: f2, dfmt: v => isFinite(v) ? signed1(v) : '–' },
    { key: 'difficulty', label: 'Language difficulty (1\u2060–\u20607)', scale: 1, want: 1, predicted: 'English higher', fmt: f2, dfmt: v => isFinite(v) ? signed1(v) : '–' },
    { key: 'eng_mean', label: 'English self-rating (1\u2060–\u20607)', scale: 1, want: 'same', predicted: 'Similar', fmt: f2, dfmt: v => isFinite(v) ? signed1(v) : '–' }
  ];

  /* Does the English group's score depend on English proficiency? Regress each
     measure on the chosen self-rating, per language; the interaction is the
     difference between the two slopes, tested with a Welch-type t. */
  function renderProficiency(zh, en, S) {
    const pk = $('#f-prof-key').value;
    const pairs = (rs, M) => rs.map(r => ({ x: num(r[pk]), y: num(r[M.key]) * M.scale })).filter(p => isFinite(p.x) && isFinite(p.y));
    const fitOf = pts => LAB.ols(pts.map(p => p.x), pts.map(p => p.y));
    const host = $('#f-scatter');
    host.innerHTML = '';
    const rowsOut = [];
    FLE.filter(M => M.plot).forEach((M, i) => {
      const pe = pairs(en, M), pz = pairs(zh, M);
      const fe = fitOf(pe), fz = fitOf(pz);
      const fig = document.createElement('figure');
      fig.className = 'figure';
      fig.innerHTML = `<h3>${M.short}</h3><div></div>`;
      host.appendChild(fig);
      const yd = M.plot.domain;
      LAB.scatterPlot(fig.querySelector('div'), {
        points: pe, fit: fe, xDomain: [1, 7], yDomain: yd,
        yStep: M.key === 'gamble_accept' ? 25 : M.key === 'sunk_mean' ? 1 : 2,
        yFmt: M.key === 'gamble_accept' ? v => v + '%' : v => (v > 0 && M.plot.signed ? '+' : '') + v,
        xLabel: 'English self-rating (1\u2060–\u20607)',
        ref: { value: S[i].ma, label: 'Chinese mean ' + M.fmt(S[i].ma) },
        ariaLabel: `${M.short} by English self-rating, English version, n = ${pe.length}` + (fe ? `, slope ${fe.b.toFixed(2)}` : '')
      });
      let inter = null;
      if (fe && fz) {
        const ve = fe.seB * fe.seB, vz = fz.seB * fz.seB, se = Math.sqrt(ve + vz), d = fe.b - fz.b;
        const df = Math.pow(ve + vz, 2) / (ve * ve / fe.df + vz * vz / fz.df), t = se > 0 ? d / se : NaN, h = LAB.t975(df) * se;
        inter = { diff: d, t, df, p: LAB.pT(t, df), ci: [d - h, d + h] };
      }
      const slopeTest = f => f ? { diff: f.b, t: f.t, df: f.df, p: f.p } : null;
      rowsOut.push({ M, fe, fz, te: slopeTest(fe), tz: slopeTest(fz), inter, ne: pe.length, nz: pz.length });
    });
    const sl = (M, v) => !isFinite(v) ? '–' : M.key === 'gamble_accept' ? LAB.signed(v) + ' pts' : (v >= 0.005 ? '+' : v <= -0.005 ? '−' : '') + Math.abs(v).toFixed(2);
    const ci = (M, a, b) => isFinite(a) ? `${sl(M, a)}\u00a0to\u00a0${sl(M, b)}` : '–';
    const ne = Math.max(0, ...rowsOut.map(o => o.ne)), nz = Math.max(0, ...rowsOut.map(o => o.nz));
    $('#f-inter').innerHTML =
      `<thead><tr><th scope="col">Measure</th><th class="num" scope="col">English slope (n = ${ne})</th><th class="num" scope="col">p</th>` +
      `<th class="num sep" scope="col">Chinese slope (n = ${nz})</th><th class="num" scope="col">p</th>` +
      `<th class="num sep" scope="col">Interaction</th><th class="num" scope="col">95% CI</th>${tHead('')}</tr></thead><tbody>` +
      rowsOut.map(o => `<tr><th scope="row">${o.M.short}</th>` +
        `<td class="num"><strong>${o.fe ? sl(o.M, o.fe.b) : '–'}</strong></td>${pCell(o.te)}` +
        `<td class="num sep">${o.fz ? sl(o.M, o.fz.b) : '–'}</td>${pCell(o.tz)}` +
        `<td class="num sep"><strong>${o.inter ? sl(o.M, o.inter.diff) : '–'}</strong></td><td class="num">${o.inter ? ci(o.M, o.inter.ci[0], o.inter.ci[1]) : '–'}</td>` +
        `${tCell(o.inter)}${pCell(o.inter)}${resultCell(o.inter, 0)}</tr>`).join('') +
      '</tbody>';
    return { rowsOut, sl, label: $('#f-prof-key').selectedOptions[0].textContent.toLowerCase() };
  }
  $('#f-prof-key').addEventListener('change', () => { lastKey = ''; render(); });

  function renderFLE(rows) {
    const inc = included(rows);
    const zh = inc.filter(r => r.lang === 'zh'), en = inc.filter(r => r.lang === 'en');
    const vals = (rs, k, sc) => rs.map(r => num(r[k]) * sc).filter(isFinite);
    const stat = M => {
      const a = vals(zh, M.key, M.scale), b = vals(en, M.key, M.scale);
      const w = LAB.welch(a, b);
      return { a, b, ma: LAB.mean(a), mb: LAB.mean(b), d: w.diff, ci: w.ci, w };
    };
    const S = FLE.map(stat);
    const ciText = (M, x) => isFinite(x.ci[0]) ? `95% CI ${M.dfmt(x.ci[0])}\u00a0to\u00a0${M.dfmt(x.ci[1])}` : '95% CI –';

    $('#f-stats').innerHTML =
      [0, 1, 2].map(i => {
        const M = FLE[i], x = S[i];
        const val = !isFinite(x.d) ? '–' : M.unit ? `${signed1(x.d)}<small>${M.unit}</small>` : M.dfmt(x.d);
        return `<div class="stat${kind(x.w, M.want) === 'yes' ? ' key' : ''}"><span class="stat-label">${M.tile}</span>` +
          `<span class="stat-value">${val}</span>` +
          `<span class="stat-note">English − Chinese (${M.fmt(x.mb)} vs ${M.fmt(x.ma)})\u00a0· ${ciText(M, x)}${small(Math.min(zh.length, en.length))}</span>` +
          `<span class="stat-test">${testLine(x.w, M.want)}</span></div>`;
      }).join('') +
      `<div class="stat"><span class="stat-label">Took part</span><span class="stat-value">${zh.length} · ${en.length}</span><span class="stat-note">Chinese · English (included)</span></div>`;
    const excl = rows.length - inc.length;
    $('#f-excluded').textContent = excl ? `${excl} run${excl > 1 ? 's' : ''} not counted (Chinese not a first language, or used a language aid).` : '';

    FLE.filter(M => M.plot).forEach((M, i) => {
      const host = $(M.plot.host), x = S[i];
      $(M.plot.host + '-test').innerHTML = rows.length
        ? `${badge(x.w, M.want)}<span>English − Chinese ${M.dfmt(x.d)}, ${ciText(M, x)}${isFinite(x.w.t) ? ` · ${LAB.fmtTest(x.w)}, ${LAB.fmtES(x.w)}` : ''}</span>` : '';
      if (!rows.length) { host.innerHTML = '<p class="empty">No runs yet for this class.</p>'; return; }
      const pts = lg => rows.filter(r => r.lang === lg).map(r => ({ v: num(r[M.key]) * M.scale, excluded: String(r.include) !== '1' }));
      LAB.stripPlot(host, [
        { label: 'Chinese', sub: `n = ${zh.length}`, values: pts('zh') },
        { label: 'English', sub: `n = ${en.length}`, values: pts('en') }
      ], {
        width: 1000, r: 6, domain: M.plot.domain, fixed: true, signed: M.plot.signed, unit: '',
        fmt: v => M.fmt(v), xLabel: M.plot.xLabel,
        ariaLabel: `${M.label}: Chinese ${M.fmt(x.ma)}, English ${M.fmt(x.mb)}`
      });
    });

    $('#f-table').innerHTML =
      `<thead><tr><th scope="col">Measure</th><th class="num" scope="col">Chinese</th><th class="num" scope="col">English</th>` +
      `<th class="num" scope="col">English\u00a0−<br>Chinese</th><th class="num" scope="col">95% CI</th>${tHead('<i>d</i>').replace('<th class="result" scope="col">Result</th>', '<th scope="col">Predicted</th><th class="result" scope="col">Result</th>')}</tr></thead><tbody>` +
      FLE.map((M, i) => { const x = S[i];
        return `<tr><th scope="row">${M.label}</th><td class="num">${M.fmt(x.ma)}</td><td class="num">${M.fmt(x.mb)}</td>` +
          `<td class="num"><strong>${M.dfmt(x.d)}</strong></td><td class="num">${isFinite(x.ci[0]) ? signed1(x.ci[0]) + '\u00a0to\u00a0' + signed1(x.ci[1]) : '–'}</td>` +
          `${tCell(x.w)}${pCell(x.w)}${esCell(x.w)}<td>${M.predicted}</td>${resultCell(x.w, M.want)}</tr>`;
      }).join('') + '</tbody>';

    const prof = renderProficiency(zh, en, S);

    const skills = [['reading', 'Reading'], ['listening', 'Listening'], ['writing', 'Writing'], ['speaking', 'Speaking'], ['overall', 'Overall']];
    $('#f-prof').innerHTML =
      `<thead><tr><th scope="col">Skill</th><th class="num" scope="col">Chinese</th><th class="num" scope="col">English</th><th class="num sep" scope="col">p</th></tr></thead><tbody>` +
      skills.map(([k, l]) => { const a = vals(zh, 'eng_' + k, 1), b = vals(en, 'eng_' + k, 1), w = LAB.welch(a, b);
        return `<tr><th scope="row">${l}</th><td class="num">${f2(LAB.mean(a))}</td><td class="num">${f2(LAB.mean(b))}</td>${pCell(w).replace('class="num', 'class="num sep')}</tr>`; }).join('') +
      '</tbody>';

    // Summary
    const items = [0, 1, 2].map(i => {
      const M = FLE[i], x = S[i];
      if (!isFinite(x.w.p)) return item(null, `${lead(M.name, x.w)} ${novar(x.w) ? SAME : `${zh.length} Chinese and ${en.length} English run${zh.length + en.length === 1 ? '' : 's'} so far; the test needs at least 2 in each.`}`);
      return item(x.w, `${lead(M.name, x.w, M.want)} ${M.say(x)} ${inline(`English − Chinese ${M.dfmt(x.d)}, ${LAB.fmtTest(x.w)}, ${LAB.fmtES(x.w)}${smallTag(Math.min(zh.length, en.length))}`)}. Predicted: ${M.predText}.`);
    });
    const dif = S[6], neu = S[5], eng = S[7], checks = [];
    const dStats = inline(`Chinese ${f2(dif.ma)}, English ${f2(dif.mb)} on 1–7, ${LAB.fmtP(dif.w.p)}`);
    if (isFinite(dif.w.p)) checks.push(LAB.isSig(dif.w) && dif.d > 0 ? `the English version was rated harder to understand, as expected ${dStats}`
      : LAB.isSig(dif.w) ? `the Chinese version was rated harder to understand ${dStats}`
      : `the English version was not rated significantly harder to understand ${dStats}`);
    if (isFinite(neu.w.p)) checks.push(LAB.isSig(neu.w) ? `the neutral items differed ${inline(LAB.fmtP(neu.w.p))}, so the groups may use the scale differently` : `the neutral items did not differ ${inline(LAB.fmtP(neu.w.p))}`);
    if (isFinite(eng.w.p)) checks.push(LAB.isSig(eng.w) ? `the groups differed in English self-rating ${inline(LAB.fmtP(eng.w.p))}` : `the two groups rated their English similarly ${inline(LAB.fmtP(eng.w.p))}`);
    if (checks.length) items.push(`<li><strong>Checks.</strong> ${cap(checks.join('; '))}.</li>`);
    const tested = prof.rowsOut.filter(o => o.inter && isFinite(o.inter.p));
    if (tested.length) {
      const sig = tested.filter(o => LAB.isSig(o.inter));
      items.push(sig.length
        ? `<li><strong>English proficiency: significant interaction for ${sig.map(o => o.M.name.toLowerCase()).join(' and ')}.</strong> ` +
          sig.map(o => `${o.M.name}: the score changed by ${prof.sl(o.M, o.fe.b)} per point of self-rated English in the English version and ${prof.sl(o.M, o.fz.b)} in the Chinese version ${inline(LAB.fmtTest(o.inter))}`).join('; ') + '.</li>'
        : `<li><strong>English proficiency: no significant interaction.</strong> The English–Chinese differences did not change significantly with self-rated English ${inline(`${prof.label}; smallest ${LAB.fmtP(Math.min(...tested.map(o => o.inter.p)))}`)}.</li>`);
    }
    $('#f-summary').innerHTML = items.join('');
  }

  /* ---------- association task (FAST): Chinese vs English, within students ----------
     Every answer is scored with the norms each time the page draws (analysis:
     fast-analysis.js; charts: fast-charts.js). Three questions, each with its
     descriptive charts first, then its model and tests:
       A  carry-over from one answer to the next (main test: language ×
          previous state; follow-ups after a negative and a positive answer;
          the same with valence as a number)
       B  the seed's pull, at the first answer and along the chain
       C  the chain over time: drift, repetition, response time
     then proficiency (exploratory), robustness checks (fitted on request),
     and every model and test. The models are fitted one after another once
     the descriptive charts are drawn, so the page stays responsive. */
  const FA = window.FAST_ANALYSIS, STIM = window.FAST_STIMULI, FC = window.FAST_CHARTS;
  const fastState = { norms: null, loading: null, error: '', fitKey: '', queued: '', fits: {}, parts: [], ctx: null, timer: null, robust: null, robustKey: '' };
  const STATE_NAME = { N: 'negative', U: 'neutral', P: 'positive' };
  const LANG_NAME = { zh: 'Chinese', en: 'English' };
  const CATS = ['negative', 'neutral', 'positive'];
  const LANGT = 'Language (English − Chinese)';
  // Probabilities in APA style (no leading zero); signed numbers with U+2212.
  const p2 = v => isFinite(v) ? (v < 0 ? '−' : '') + Math.abs(v).toFixed(2).replace(/^0/, '') : '–';
  const p3 = v => isFinite(v) ? (v < 0 ? '−' : '') + Math.abs(v).toFixed(3).replace(/^0/, '') : '–';
  const pr2 = v => isFinite(v) ? (v <= -0.005 ? '−' : v >= 0.005 ? '+' : '') + Math.abs(v).toFixed(2).replace(/^0/, '') : '–';
  const b2 = v => isFinite(v) ? (v <= -0.005 ? '−' : '') + Math.abs(v).toFixed(2) : '–';
  const s2 = v => isFinite(v) ? (v <= -0.005 ? '−' : v >= 0.005 ? '+' : '') + Math.abs(v).toFixed(2) : '–';
  const b3 = v => isFinite(v) ? (v <= -0.0005 ? '−' : v >= 0.0005 ? '+' : '') + Math.abs(v).toFixed(3) : '–';
  const pct0 = v => isFinite(v) ? Math.round(v * 100) + '%' : '–';
  const pct1 = v => isFinite(v) ? (v * 100).toFixed(1) + '%' : '–';
  const pts1 = v => isFinite(v) ? (v <= -0.0005 ? '−' : v >= 0.0005 ? '+' : '') + Math.abs(v * 100).toFixed(1) + ' pts' : '–';
  const sec1 = v => isFinite(v) ? v.toFixed(1) + ' s' : '–';
  // A difference shown next to two rounded values is computed from those
  // rounded values, so it always adds up on screen.
  const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
  const dfShow = df => df >= 100 || Math.abs(df - Math.round(df)) < 1e-9 ? String(Math.round(df)) : df.toFixed(1);
  // A paired t-test (LAB.ttest) as an estimate with its CI.
  const ttE = T => T && isFinite(T.t) ? { est: T.m, lo: T.ci[0], hi: T.ci[1], stat: T.t, df: T.df, p: T.p } : null;
  // One shape for every estimate: a model term or contrast ({b, ci, stat, df,
  // p}) or a marginal prediction ({est, lo, hi, z, p}).
  const U = r => !r ? null : 'est' in r ? Object.assign({ stat: r.z, df: null }, r) : { est: r.b, lo: r.ci[0], hi: r.ci[1], se: r.se, stat: r.stat, df: r.df, p: r.p };
  const asT = e => e ? { p: e.p, diff: e.est, t: e.stat } : null;
  const statOnly = e => !e || !isFinite(e.stat) ? '' : e.df ? `<i>t</i>(${dfShow(e.df)})\u00a0=\u00a0${b2(e.stat)}` : `<i>z</i>\u00a0=\u00a0${b2(e.stat)}`;
  const statTxt = e => !e || !isFinite(e.stat) ? '' : (e.df ? `<i>t</i>(${dfShow(e.df)}) = ${b2(e.stat)}` : `<i>z</i> = ${b2(e.stat)}`) + `, ${LAB.fmtP(e.p)}`;
  const fig = (host, heading, level) => {
    const f = document.createElement('figure');
    f.className = 'figure';
    const h = 'h' + (level || 3);
    f.innerHTML = `<${h}>${heading}</${h}><div></div>`;
    host.appendChild(f);
    return f.querySelector('div');
  };
  const cm = (f, name) => f && f.cm ? f.cm(name) : 0;
  /* The models are fitted in a Web Worker (assets/fast-worker.js), one for the
     main models and one for the robustness checks, so the page never freezes;
     where workers are unavailable they run here, one per tick. onFit(key, fit)
     gets each fit as it arrives, with its methods restored (revive). A new
     batch for the same worker cancels the old one. */
  const workers = {};
  function fitJobs(name, jobs, onFit) {
    if (workers[name]) { workers[name].terminate(); workers[name] = null; }
    const id = Math.random().toString(36).slice(2), done = new Set();
    const inline = rest => {
      const step = k => { if (k >= rest.length) return; setTimeout(() => { if (workers[name + ':id'] !== id) return; const j = rest[k]; onFit(j.key, FA.revive(FA.plain(FA.runJob(j)))); step(k + 1); }, 20); };
      step(0);
    };
    workers[name + ':id'] = id;
    let w = null;
    // The worker loads the same version of fast-analysis.js as the page: its URL carries that script's query.
    const av = (document.querySelector('script[src*="fast-analysis.js"]') || {}).src || '';
    try { w = typeof Worker !== 'undefined' ? new Worker('assets/fast-worker.js' + (av.includes('?') ? av.slice(av.indexOf('?')) : '')) : null; } catch (e) { w = null; }
    if (!w) { inline(jobs); return; }
    workers[name] = w;
    w.onmessage = e => {
      if (e.data.id !== id || workers[name + ':id'] !== id) return;
      done.add(e.data.key);
      onFit(e.data.key, FA.revive(e.data.fit));
      if (done.size === jobs.length) { w.terminate(); if (workers[name] === w) workers[name] = null; }
    };
    w.onerror = ev => {   // e.g. the worker could not load: finish the rest here
      if (ev && ev.preventDefault) ev.preventDefault();
      w.terminate(); if (workers[name] === w) workers[name] = null;
      inline(jobs.filter(j => !done.has(j.key)));
    };
    w.postMessage({ id, jobs });
  }
  const WHY = { few: 'Too few runs to test', separation: 'Not estimable yet', converge: 'Model did not converge', novar: 'No variation to test' };
  const whyNot = f => !f ? 'Fitting the model…' : f.ok ? '' : WHY[f.reason] || 'Not estimable yet';

  /* 95% CI for a pooled proportion by resampling students: per = [[k, n], …],
     one entry per student. 1,000 draws from a fixed seed, so the interval
     does not move between redraws. Needs 3 students. */
  function bootCI(per) {
    const S = per.filter(x => x[1] > 0);
    if (S.length < 3) return [NaN, NaN];
    let seed = 20261005;
    const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const est = [];
    for (let b = 0; b < 1000; b++) {
      let k = 0, n = 0;
      for (let i = 0; i < S.length; i++) { const x = S[(rnd() * S.length) | 0]; k += x[0]; n += x[1]; }
      est.push(k / n);
    }
    est.sort((a, b) => a - b);
    return [est[24], est[974]];
  }
  // Paired tests need 3 students; below that they are not run.
  const gate = T => T.n < 3 ? Object.assign({}, T, { t: NaN, p: NaN, reason: 'few' })
    : isFinite(T.es) && Math.abs(T.es) > 1e6 ? Object.assign({}, T, { t: NaN, p: NaN, reason: 'novar' }) : T;
  // Likewise, a 95% CI across students is drawn from 3 students.
  const ci3 = a => a.length >= 3 ? LAB.ci95(a) : [NaN, NaN];

  function ensureNorms() {
    if (fastState.norms || fastState.loading) return;
    fastState.loading = FA.loadNorms('')
      .then(n => { fastState.norms = n; fastState.error = ''; })
      .catch(e => { fastState.error = e.message || String(e); })
      .finally(() => { fastState.loading = null; lastKey = ''; render(); });
  }
  $('#a-prof-skill').addEventListener('change', () => { lastKey = ''; render(); });
  $('#a-csv-answers').addEventListener('click', () => LAB.download(`lt5461-association-answers-${state.session}.csv`, LAB.toCSV(FA.responseRows(fastState.parts))));
  $('#a-csv-transitions').addEventListener('click', () => LAB.download(`lt5461-association-transitions-${state.session}.csv`, LAB.toCSV(FA.transitionRows(fastState.parts))));
  $('#a-robust-more').addEventListener('toggle', () => { if ($('#a-robust-more').open) runRobust(); });

  function matrixTable(tr, lang, states) {
    const m = FA.matrix(tr.filter(t => t.lang === lang), states);
    const cell = (a, b) => {
      const p = m.probs[a][b];
      return isFinite(p) ? `<td style="--p:${p.toFixed(3)}"><b>${p2(p)}</b><i class="visually-hidden">, </i><span>${m.counts[a][b].toLocaleString('en-US')} of ${m.rowN[a].toLocaleString('en-US')}</span></td>`
        : `<td class="undef"><b>–</b><span>none from here</span></td>`;
    };
    return `<div><h4>${LANG_NAME[lang]} <span class="n">${m.n.toLocaleString('en-US')} transition${m.n === 1 ? '' : 's'}</span></h4>` +
      `<table class="matrix"><caption class="visually-hidden">${LANG_NAME[lang]}: probability of the next answer's state given the previous answer's state</caption>` +
      `<colgroup><col class="head">${states.map(() => '<col>').join('')}</colgroup>` +
      `<thead><tr><th scope="col"><span class="visually-hidden">Previous answer</span></th>${states.map(b => `<th scope="col">to ${STATE_NAME[b]}</th>`).join('')}</tr></thead><tbody>` +
      states.map(a => `<tr><th scope="row">from ${STATE_NAME[a]}</th>${states.map(b => cell(a, b)).join('')}</tr>`).join('') + '</tbody></table></div>';
  }

  // "×" never starts or ends a line in a name
  const keepX = name => name.replace(/ × /g, ' × ').replace(/ − /g, ' − ');
  // A per-student test line (paired t-test): name, verdict, statistics.
  const testItem = (name, r, stats, noFit) => `<li><span class="t-name">${keepX(name)}</span>` +
    (r && isFinite(r.p) ? `${badge(r, 0)}<span>${stats}</span>` : `<span class="sig na">${noFit || 'Too few runs to test'}</span>`) + '</li>';
  // A model test line, effect first: kind, name, estimate [95% CI], verdict, statistic.
  const modelLine = (kindTxt, name, r, fmt, unit, why) => {
    const e = U(r);
    return `<li>${kindTxt ? `<span class="t-kind">${kindTxt}</span>` : ''}<span class="t-name">${keepX(name)}</span>` +
      (e && isFinite(e.p) ? `<span class="t-est">${fmt(e.est)}${unit ? ' <small>' + unit + '</small>' : ''} <span class="t-ci">[${fmt(e.lo)}, ${fmt(e.hi)}]</span></span>${badge(asT(e), 0)}<span>${statTxt(e)}</span>`
        : `<span class="sig na">${why || 'Too few runs to test'}</span>`) + '</li>';
  };
  const noteLine = html => `<li class="t-note">${html}</li>`;

  function renderFast(rows) {
    const status = $('#a-status');
    if (!fastState.norms) {
      ensureNorms();
      status.hidden = false;
      status.textContent = fastState.error ? `The valence norms could not be loaded (${fastState.error}). Trying again at the next update.` : 'Loading the valence norms…';
      $('#a-body').hidden = true;
      if (fastState.error) fastState.error = '';
      return;
    }
    status.hidden = true;
    // Only runs made with the current seeds: an earlier set may share some
    // seed ids, and its runs would be read half-way.
    const other = rows.filter(r => r.stim_version !== STIM.version).length;
    rows = rows.filter(r => r.stim_version === STIM.version);
    const parts = FA.participants(rows, STIM, fastState.norms);
    fastState.parts = parts;
    const n = parts.length;
    if (!n) {
      $('#a-summary').innerHTML = item(null, '<strong>No runs yet for this class.</strong> Results appear here as students finish.' +
        (other ? ` (${other} run${other > 1 ? 's' : ''} used an earlier set of seed words and ${other > 1 ? 'are' : 'is'} not shown.)` : ''));
      $('#a-body').hidden = true;
      return;
    }
    $('#a-body').hidden = false;
    $('#a-body').classList.toggle('few', n < 3);

    const tr2 = FA.transitions(parts, FA.state2), tr3 = FA.transitions(parts, FA.state3), ans = FA.answers(parts);
    const P = { zh: FA.matrix(tr2.filter(t => t.lang === 'zh'), FA.STATES2), en: FA.matrix(tr2.filter(t => t.lang === 'en'), FA.STATES2) };

    // ---- A. the state diagrams (what happened, pooled) and the counts ----
    const states = $('#a-states');
    states.innerHTML = '';
    ['zh', 'en'].forEach(l => {
      const f = document.createElement('figure');
      f.className = 'figure';
      f.innerHTML = `<h3>${LANG_NAME[l]} <span class="n">${P[l].n.toLocaleString('en-US')} transitions</span></h3><div></div>`;
      states.appendChild(f);
      FC.stateDiagram(f.querySelector('div'), P[l], l);
    });
    $('#a-matrices').innerHTML = matrixTable(tr2, 'zh', FA.STATES2) + matrixTable(tr2, 'en', FA.STATES2);
    $('#a-matrices3').innerHTML = matrixTable(tr3, 'zh', FA.STATES3) + matrixTable(tr3, 'en', FA.STATES3);

    // ---- B. the seed panels and their numbers ----
    const reps = FA.repetitions(parts), mv = FA.meanValence(parts), per = FA.perParticipant(parts);
    const pooled = (cat, lang, key) => { const m = FA.matrix(tr2.filter(t => t.lang === lang && (cat === 'all' || t.category === cat)), FA.STATES2); return m.probs[key][key]; };
    const meanV = (cat, lang) => LAB.mean(mv.map(x => x[lang][cat]).filter(isFinite));
    const ciV = (cat, lang) => ci3(mv.map(x => x[lang][cat]).filter(isFinite));
    // per student: [stayed, transitions from the state], by language, seed category and state
    const cnt = {};
    tr2.forEach(t => { const k = [t.pid, t.lang, t.category, t.prev].join('|'), c = cnt[k] || (cnt[k] = [0, 0]); c[1]++; if (t.next === t.prev) c[0]++; });
    const ciP = (cat, lang, key) => bootCI(parts.map(x => cnt[[x.key, lang, cat, key].join('|')] || [0, 0]));
    const repRate = (cat, lang) => { const s = reps.reduce((a, x) => [a[0] + x[lang][cat][0], a[1] + x[lang][cat][1]], [0, 0]); return s[1] ? s[0] / s[1] : NaN; };
    const host = $('#a-seedpanels');
    host.innerHTML = '';
    const PCI = {};
    ['N', 'P'].forEach(k => { PCI[k] = { zh: CATS.map(c => ciP(c, 'zh', k)), en: CATS.map(c => ciP(c, 'en', k)) }; });
    const probs = ['N', 'P'].flatMap(k => ['zh', 'en'].flatMap(l => CATS.flatMap((c, i) => [pooled(c, l, k), ...PCI[k][l][i]]))).filter(isFinite);
    const pLo = Math.min(0.5, Math.floor(Math.min(...probs, 1) * 10) / 10), pHi = Math.max(0.8, Math.ceil(Math.max(...probs, 0) * 10) / 10);
    [['N', 'Staying negative, P(N→N)'], ['P', 'Staying positive, P(P→P)']].forEach(([k, heading]) => {
      FC.seedPanel(fig(host, heading), {
        domain: [pLo, pHi], step: 0.1, ref: 0.5, tick: p2, fmt: p2,
        values: { zh: CATS.map(c => pooled(c, 'zh', k)), en: CATS.map(c => pooled(c, 'en', k)) }, ci: PCI[k],
        label: `${heading} by seed valence: Chinese ${CATS.map(c => p2(pooled(c, 'zh', k))).join(', ')}; English ${CATS.map(c => p2(pooled(c, 'en', k))).join(', ')} (negative, neutral, positive seeds)`
      });
    });
    const vs = ['zh', 'en'].flatMap(l => CATS.flatMap(c => [meanV(c, l), ...ciV(c, l)])).filter(isFinite);
    const vLo = Math.floor(Math.min(4.5, ...vs) * 2) / 2, vHi = Math.ceil(Math.max(5.5, ...vs) * 2) / 2;
    FC.seedPanel(fig(host, 'Valence of the answers'), {
      domain: [vLo, vHi], step: 0.5, ref: 5, tick: v => v.toFixed(1), fmt: v => v.toFixed(2),
      values: { zh: CATS.map(c => meanV(c, 'zh')), en: CATS.map(c => meanV(c, 'en')) },
      ci: { zh: CATS.map(c => ciV(c, 'zh')), en: CATS.map(c => ciV(c, 'en')) },
      label: `Mean valence of the answers by seed valence: Chinese ${CATS.map(c => meanV(c, 'zh').toFixed(2)).join(', ')}; English ${CATS.map(c => meanV(c, 'en').toFixed(2)).join(', ')}`
    });
    const pair = (f, fmt) => `<td class="num sep">${fmt(f('zh'))}</td><td class="num">${fmt(f('en'))}</td>`;
    $('#a-bycat').innerHTML =
      `<thead><tr><th scope="col" rowspan="2">Seeds</th><th scope="colgroup" colspan="2" class="sep">Staying negative, P(N→N)</th><th scope="colgroup" colspan="2" class="sep">Staying positive, P(P→P)</th>` +
      `<th scope="colgroup" colspan="2" class="sep">Valence of the answers</th><th scope="colgroup" colspan="2" class="sep">Repeated answers</th></tr>` +
      `<tr>${'<th class="num sep" scope="col">Chinese</th><th class="num" scope="col">English</th>'.repeat(4)}</tr></thead><tbody>` +
      CATS.concat('all').map(cat => `<tr><th scope="row">${cat === 'all' ? '<strong>All seeds</strong>' : cap(cat)}</th>` +
        pair(l => pooled(cat, l, 'N'), p2) + pair(l => pooled(cat, l, 'P'), p2) + pair(l => meanV(cat, l), b2) + pair(l => repRate(cat, l), pct1) + '</tr>').join('') +
      '</tbody>';

    // ---- B. valence along the chain, by seed ----
    const nPos = STIM.responsesPerSeed, traj = FA.trajectories(parts, nPos);
    const stat = arr => ({ m: LAB.mean(arr), ci: ci3(arr), n: arr.length });
    const TS = {};
    CATS.forEach(c => { TS[c] = { zh: traj.zh[c].map(stat), en: traj.en[c].map(stat) }; });
    const tv = CATS.flatMap(c => ['zh', 'en'].flatMap(l => TS[c][l].flatMap(s => [s.m, s.ci[0], s.ci[1]]))).filter(isFinite);
    const tDom = [Math.max(1, Math.floor(Math.min(4, ...tv))), Math.min(9, Math.ceil(Math.max(6, ...tv)))];
    const th = $('#a-traj');
    th.innerHTML = '';
    CATS.forEach(c => {
      const ends = l => { const a = TS[c][l]; return `${LANG_NAME[l]} from ${b2(a[0] && a[0].m)} to ${b2(a[nPos - 1] && a[nPos - 1].m)}`; };
      FC.trajectory(fig(th, `${cap(c)} seeds`, 4), TS[c], nPos, tDom, `${cap(c)} seeds: mean valence by answer position, ${ends('zh')}, ${ends('en')}`);
    });
    const tcell = d => d && isFinite(d.m) ? `<td class="num">${d.m.toFixed(2)}${isFinite(d.ci[0]) ? `<span class="ci">${d.ci[0].toFixed(2)}–${d.ci[1].toFixed(2)}</span>` : ''}</td>` : '<td class="num">–</td>';
    $('#a-traj-table').innerHTML = `<thead><tr><th scope="col" rowspan="2">Answer</th>${CATS.map(c => `<th scope="colgroup" colspan="2" class="sep">${cap(c)} seeds</th>`).join('')}</tr>` +
      `<tr>${'<th class="num sep" scope="col">Chinese</th><th class="num" scope="col">English</th>'.repeat(3)}</tr></thead><tbody>` +
      Array.from({ length: nPos }, (_, k) => `<tr><th scope="row">${k + 1}</th>${CATS.map(c => tcell(TS[c].zh[k]).replace('<td class="num">', '<td class="num sep">') + tcell(TS[c].en[k])).join('')}</tr>`).join('') + '</tbody>';
    const tn = CATS.flatMap(c => ['zh', 'en'].flatMap(l => TS[c][l].map(d => d.n)));
    $('#a-traj-note').textContent = `Mean valence (1–9) of the answers at each position${n >= 3 ? ', with its 95% CI across students below' : ''}. Each mean is over ${Math.min(...tn)}${Math.max(...tn) > Math.min(...tn) ? '–' + Math.max(...tn) : ''} students with a scored answer there.`;

    // ---- C. repeated answers and response times, per student ----
    const rate = (x, lang) => x[lang].all[1] ? x[lang].all[0] / x[lang].all[1] : NaN;
    const rz = reps.map(x => rate(x, 'zh')), re = reps.map(x => rate(x, 'en'));
    const repeat = { zh: LAB.mean(rz.filter(isFinite)), en: LAB.mean(re.filter(isFinite)), test: gate(LAB.ttest(re.map((v, i) => v - rz[i]).filter(isFinite), 0)) };
    FC.paired($('#a-repeats'), rz.map((z, i) => ({ zh: z, en: re[i] })), {
      step: 0.02, minMax: 0.1, tick: v => Math.round(v * 100) + '%', fmt: pct1,
      mean: { zh: { m: repeat.zh, ci: ci3(rz.filter(isFinite)) }, en: { m: repeat.en, ci: ci3(re.filter(isFinite)) } },
      label: `Repeated answers per student: Chinese mean ${pct1(repeat.zh)}, English mean ${pct1(repeat.en)}`
    });
    const tz = rows.map(r => num(r.rt_median_zh) / 1000), te = rows.map(r => num(r.rt_median_en) / 1000);
    const okRT = tz.map((v, i) => isFinite(v) && isFinite(te[i]));
    const rt = { zh: LAB.mean(tz.filter((v, i) => okRT[i])), en: LAB.mean(te.filter((v, i) => okRT[i])), test: gate(LAB.ttest(te.map((v, i) => v - tz[i]).filter((v, i) => okRT[i]), 0)) };
    const rtMax = Math.max(4, ...tz.concat(te).filter(isFinite));
    FC.paired($('#a-rt'), tz.map((z, i) => ({ zh: z, en: te[i] })), {
      step: rtMax > 12 ? 4 : 2, minMax: 4, tick: v => v + ' s', fmt: sec1,
      mean: { zh: { m: rt.zh, ci: ci3(tz.filter((v, i) => okRT[i])) }, en: { m: rt.en, ci: ci3(te.filter((v, i) => okRT[i])) } },
      label: `Median time per answer per student: Chinese mean ${sec1(rt.zh)}, English mean ${sec1(rt.en)}`
    });

    // ---- per student: the seed's valence, by language (a simple check of B) ----
    // (positive − negative seeds) per student and language; only students with
    // both languages scored, so the two means and the test share one sample.
    const both = mv.map(x => ({ zh: x.zh.positive - x.zh.negative, en: x.en.positive - x.en.negative })).filter(d => isFinite(d.zh) && isFinite(d.en));
    const polarity = { zh: LAB.mean(both.map(d => d.zh)), en: LAB.mean(both.map(d => d.en)), test: gate(LAB.ttest(both.map(d => d.en - d.zh), 0)) };

    // ---- English proficiency (exploratory) ----
    // For each English self-rating (0–10) and each measure (staying negative,
    // staying positive, the mean valence of the answers): the least-squares
    // slope of the student's English − Chinese difference on the rating (the
    // test), and of each language on its own (the detail charts). The same
    // students enter all three fits, so the slopes add up. The overall rating
    // is the primary test; the four skills are follow-ups, judged on
    // Benjamini–Hochberg adjusted p-values across their twelve tests.
    const SKILL = { overall: 'Overall', listening: 'Listening', speaking: 'Speaking', reading: 'Reading', writing: 'Writing' };
    const MEAS = { NN: 'Staying negative', PP: 'Staying positive', V: 'Valence of the answers' };
    const valueOf = (i, k, lang) => k === 'V' ? mv[i][lang].all : per[i].lang[lang][k];
    const PROF = [];
    Object.keys(MEAS).forEach(k => Object.keys(SKILL).forEach(sk => {
      const pts = per.map((p, i) => ({ x: p.prof['en_' + sk], zh: valueOf(i, k, 'zh'), en: valueOf(i, k, 'en') })).filter(q => isFinite(q.x) && isFinite(q.zh) && isFinite(q.en));
      const xs = pts.map(q => q.x);
      const gap = LAB.ols(xs, pts.map(q => q.en - q.zh));
      PROF.push({ k, sk, pts, n: pts.length, gap, fit: { zh: LAB.ols(xs, pts.map(q => q.zh)), en: LAB.ols(xs, pts.map(q => q.en)) },
        test: gap && isFinite(gap.t) ? { diff: gap.b, t: gap.t, df: gap.df, p: gap.p } : null });
    }));
    const follow = PROF.filter(o => o.sk !== 'overall'), adj = FA.bh(follow.map(o => o.test ? o.test.p : NaN));
    follow.forEach((o, i) => { o.padj = adj[i]; });
    PROF.forEach(o => { o.judged = !o.test ? null : o.sk === 'overall' ? o.test : Object.assign({}, o.test, { p: o.padj }); });
    const rating = sk => per.map(p => p.prof['en_' + sk]).filter(isFinite);
    // All five ratings: one small forest per measure (each on its own scale)
    const allHost = $('#a-prof-all');
    allHost.innerHTML = '';
    Object.keys(MEAS).forEach(k => {
      const rowsF = PROF.filter(o => o.k === k && o.judged && isFinite(o.judged.p)).map(o => ({ label: o.sk === 'overall' ? 'Overall*' : SKILL[o.sk], b: o.gap.b, lo: o.gap.ciB[0], hi: o.gap.ciB[1], p: o.judged.p }));
      const hostF = fig(allHost, MEAS[k], 4);
      if (rowsF.length) FC.forest(hostF, [{ label: '', rows: rowsF }], { xLabel: k === 'V' ? 'Valence points per rating point' : 'Change per rating point', minLim: k === 'V' ? 0.1 : 0.02, fmt: b3, left: 96, narrowAt: 0,
        label: `${MEAS[k]}: for each English rating, the change in the English − Chinese difference per rating point, with 95% confidence intervals` });
      else hostF.innerHTML = `<p class="empty">${PROF.some(o => o.k === k && o.gap) ? 'No variation to test yet.' : 'Needs at least 3 students with both languages scored.'}</p>`;
    });
    // One rating in detail: each student's Chinese and English value against the rating
    const sk = (document.querySelector('#a-prof-skill input:checked') || {}).value || 'overall';
    const profHost = $('#a-prof');
    profHost.innerHTML = '';
    // Axes shared across the five ratings, so switching compares like with like:
    // x from just below the lowest rating anyone gave to 10; y around every value shown.
    const allR = Object.keys(SKILL).flatMap(rating);
    const xDomain = [Math.max(0, (allR.length ? Math.min(...allR) : 1) - 1), 10];
    const span = (ks, step, dLo, dHi, floor, ceil) => {
      const v = PROF.filter(o => ks.includes(o.k)).flatMap(o => o.pts.flatMap(q => [q.zh, q.en]));
      let lo = Math.max(floor, Math.floor((v.length ? Math.min(...v) : dLo) / step) * step), hi = Math.min(ceil, Math.ceil((v.length ? Math.max(...v) : dHi) / step) * step);
      if (hi - lo < 3 * step) { lo = Math.max(floor, lo - step); hi = Math.min(ceil, lo + 3 * step); }
      return [lo, hi];
    };
    const pDomain = span(['NN', 'PP'], 0.1, 0.4, 0.8, 0, 1), vDomain = span(['V'], 0.5, 4.5, 5.5, 1, 9);
    Object.keys(MEAS).forEach(k => {
      const o = PROF.find(q => q.k === k && q.sk === sk), V = k === 'V';
      FC.profScatter(fig(profHost, V ? MEAS[k] : `${MEAS[k]}, ${k === 'NN' ? 'P(N→N)' : 'P(P→P)'}`, 4), {
        points: o.pts, fit: o.fit, xDomain, xLabel: `English rating: ${SKILL[sk].toLowerCase()} (0–10)`,
        yDomain: V ? vDomain : pDomain, yStep: V ? 0.5 : undefined, yFmt: V ? (v => v.toFixed(1)) : undefined, vFmt: V ? (v => v.toFixed(2)) : undefined, yRef: V ? 5 : undefined,
        yLabel: V ? 'Mean valence of the answers (1–9)' : `Probability of staying ${k === 'NN' ? 'negative' : 'positive'}`,
        label: `${MEAS[k]} in Chinese and in English against the English ${sk} rating, ${o.n} students` +
          (o.gap ? `; the English − Chinese difference changes by ${b3(o.gap.b)} per rating point` : '')
      });
    });
    $('#a-prof-table').innerHTML = `<thead><tr><th scope="col">English rating</th><th class="num" scope="col">Mean (range)</th><th class="num" scope="col">n</th>` +
      `<th class="num sep" scope="col">Change per point</th><th class="num" scope="col">95% CI</th><th class="num sep" scope="col"><i>t</i> (df)</th><th class="num" scope="col"><i>p</i></th><th class="num" scope="col"><i>p</i> (BH)</th><th class="result" scope="col">Result</th></tr></thead>` +
      Object.keys(MEAS).map(k => `<tbody><tr class="group"><th scope="rowgroup" colspan="9"><span class="stick">${MEAS[k]}: English − Chinese${k === 'V' ? ' (valence points)' : ''}</span></th></tr>` +
        PROF.filter(o => o.k === k).map(o => { const rt = rating(o.sk);
          return `<tr><th scope="row">${SKILL[o.sk]}${o.sk === 'overall' ? ' <span class="muted">(primary)</span>' : ''}</th><td class="num">${rt.length ? LAB.mean(rt).toFixed(1) + ' <span class="muted">(' + Math.min(...rt) + '–' + Math.max(...rt) + ')</span>' : '–'}</td><td class="num">${o.n}</td>` +
            `<td class="num sep"><strong>${o.gap ? b3(o.gap.b) : '–'}</strong></td><td class="num">${o.gap ? b3(o.gap.ciB[0]) + ' to ' + b3(o.gap.ciB[1]) : '–'}</td>${tCell(o.test)}${pCell(o.test)}` +
            `<td class="num">${o.sk === 'overall' ? '<span class="muted">–</span>' : o.test ? LAB.fmtPval(o.padj) : '–'}</td>${resultCell(o.judged, 0)}</tr>`; }).join('') + '</tbody>').join('');

    // ---- data quality ----
    const cov = lang => {
      const L = per.map(p => p.lang[lang]).filter(q => q.answers);
      const sum = k => L.reduce((s, q) => s + q[k], 0);
      const share = (a, b) => L.map(q => q[b] ? q[a] / q[b] : NaN).filter(isFinite);
      return { n: L.length, scored: sum('scored') / sum('answers'), valid: sum('valid') / sum('possible'), validN: sum('valid'),
        sRange: share('scored', 'answers'), vRange: share('valid', 'possible') };
    };
    const C = { zh: cov('zh'), en: cov('en') };
    const range = a => a.length ? `${pct0(Math.min(...a))}–${pct0(Math.max(...a))} per student` : '';
    const meter = (l, label, v, note) => `<div class="meter"><span>${label}</span><span class="meter-track" role="img" aria-label="${label}: ${pct0(v)}"><span class="meter-fill ${l}" style="display:block;width:${Math.round(v * 100)}%"></span></span><span class="v">${pct0(v)}</span></div><div class="meter-note">${note}</div>`;
    $('#a-coverage').innerHTML = ['zh', 'en'].map(l => `<div><div class="meter-lang">${LANG_NAME[l]}</div>` +
      meter(l, 'Answers scored', C[l].scored, range(C[l].sRange)) +
      meter(l, 'Valid transitions', C[l].valid, `${C[l].validN.toLocaleString('en-US')} transitions · ${range(C[l].vRange)}`) + '</div>').join('');

    // ---- the models: fitted one after another, after everything above is drawn ----
    fastState.ctx = { other, n, P, C, polarity, repeat, rt, PROF, tr2, ans, parts, nPos };
    const fitKey = JSON.stringify([state.session, parts.map(x => x.key)]);
    const fresh = fitKey !== fastState.fitKey;
    if (fresh) { fastState.fitKey = fitKey; fastState.fits = {}; fastState.robust = null; fastState.robustKey = ''; }
    renderFastModels();
    if (!fresh) return;
    fitJobs('main', [{ key: 'A', model: 'A', tr: tr2 }, { key: 'C1', model: 'C1', tr: tr2 }, { key: 'B', model: 'B', ans }, { key: 'C', model: 'C', ans }], (key, f) => {
      if (fastState.fitKey !== fitKey) return;
      fastState.fits[key] = f;
      renderFastModels();
    });
    // New runs while the checks are open: they are fitted again, not closed.
    if ($('#a-robust-more').open) runRobust();
  }

  function renderFastModels() {
    const x = fastState.ctx;
    if (!x) return;
    const F = fastState.fits, fA = F.A, fC1 = F.C1, fB = F.B, fC = F.C;
    const okA = fA && fA.ok, okC1 = fC1 && fC1.ok, okB = fB && fB.ok, okC = fC && fC.ok;
    const co = okA ? fA.carry : null;
    const { C, polarity, repeat, rt, PROF, n, other, P, tr2, ans, parts, nPos } = x;
    const coefOf = (f, name) => f && f.ok ? f.coefOf(name) : null;
    const st = smallTag(n), smallNote = n < 10 ? ' · small sample' : '';
    const inter = coefOf(fA, 'Language × previous state');
    const emptyText = fA && fA.reason === 'separation' ? [...new Set(fA.empty.map(c => c.prev + c.next))].map(k => {
      const langs = fA.empty.filter(c => c.prev + c.next === k).map(c => c.lang);
      return `${langs.length === 2 ? 'in either language' : 'in ' + LANG_NAME[langs[0]]}, no ${STATE_NAME[k[0]]} answer was followed by a ${STATE_NAME[k[1]]} one`;
    }).join('; ') : '';
    const L5 = l => l === 'en' ? 0.5 : -0.5, sigOf = c => c && isFinite(c.p) && c.p < 0.05;

    // ---- model quantities used in several places ----
    const lpv = coefOf(fC1, 'Language × previous valence');
    const slope = l => okC1 ? fC1.contrast({ 'Previous valence (per point)': 1, 'Language × previous valence': L5(l) }) : null;
    const bSV = coefOf(fB, 'Language × seed valence'), lsp = coefOf(fB, 'Language × seed valence × position'), fade = coefOf(fB, 'Seed valence × position');
    // the seed's pull at answer k: position enters model B as log2(k)
    const pullAt = (l, k) => fB.contrast({ 'Seed valence (per point)': 1, 'Language × seed valence': L5(l), 'Seed valence × position': Math.log2(k), 'Language × seed valence × position': L5(l) * Math.log2(k) });
    const pull1 = l => okB ? pullAt(l, 1).b : NaN;
    const cLP = coefOf(fC, 'Language × position');
    const drift = l => okC ? fC.contrast({ 'Position (per step)': 1, 'Language × position': L5(l) }).b : NaN;

    // ---- tiles: one per question, the language difference and its test ----
    const pill = (r, why) => r && isFinite(r.p) ? badge(r, 0) : `<span class="sig na">${why}</span>`;
    const tile = (label, value, note, r, stat, why) => `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span>` +
      `<span class="stat-note">${note}${smallNote}</span><span class="stat-test">${pill(r, why)}${stat ? `<span>${stat}</span>` : ''}</span></div>`;
    $('#a-stats').innerHTML =
      tile('A · Carry-over', co ? pr2(co.did.est) : '–', co ? `English − Chinese, probability (${p3(co.carry.en.est)} vs ${p3(co.carry.zh.est)})` : 'English − Chinese, probability',
        asT(U(inter)), inter ? 'interaction ' + statOnly(U(inter)) : '', whyNot(fA)) +
      tile('B · Seed’s pull on answer 1', bSV ? s2(bSV.b) : '–', bSV ? `English − Chinese, model (${b3(pull1('en')).replace('+', '')} vs ${b3(pull1('zh')).replace('+', '')} per point)` : 'English − Chinese, per point of seed valence',
        asT(U(bSV)), bSV ? statOnly(U(bSV)) : '', whyNot(fB)) +
      tile('C · Drift per answer', cLP ? b3(cLP.b) : '–', cLP ? `English − Chinese (${b3(drift('en'))} vs ${b3(drift('zh'))} valence points)` : 'English − Chinese, valence points',
        asT(U(cLP)), cLP ? statOnly(U(cLP)) : '', whyNot(fC)) +
      `<div class="stat"><span class="stat-label">Took part</span><span class="stat-value">${n}</span><span class="stat-note">students · ${(P.zh.n + P.en.n).toLocaleString('en-US')} valid transitions</span></div>`;

    // ---- A: the interaction, its decomposition, and the continuous version ----
    const box = (id, html) => { $(id).innerHTML = `<p class="empty">${html}</p>`; };
    if (co) {
      FC.interaction($('#a-inter'), { next: co.next, label: `Probability that the next answer is positive: after a negative answer ${p2(co.next.zh.N.est)} in Chinese and ${p2(co.next.en.N.est)} in English; after a positive answer ${p2(co.next.zh.P.est)} and ${p2(co.next.en.P.est)}` });
      FC.forest($('#a-diffs'), [{ label: '', rows: [
        { label: 'After a negative answer', b: co.diff.N.est, lo: co.diff.N.lo, hi: co.diff.N.hi, p: co.diff.N.p },
        { label: 'After a positive answer', b: co.diff.P.est, lo: co.diff.P.lo, hi: co.diff.P.hi, p: co.diff.P.p },
        { label: 'Carry-over', b: co.did.est, lo: co.did.lo, hi: co.did.hi, p: co.did.p }] }],
        { xLabel: 'Probability, English − Chinese', minLim: 0.05, fmt: pr2, left: 186, narrowAt: 430, label: 'English − Chinese differences in the probability that the next answer is positive, with 95% confidence intervals' });
    } else { box('#a-inter', whyNot(fA) + (emptyText ? ': ' + emptyText + '.' : '.')); box('#a-diffs', whyNot(fA) + '.'); }
    $('#a-tests-a').innerHTML =
      modelLine('Main test', 'Language × previous state', inter, s2, 'log-odds', whyNot(fA)) +
      (co ? noteLine(`On the probability scale, carry-over was ${p3(co.carry.zh.est)} in Chinese and ${p3(co.carry.en.est)} in English, a difference of ${pr2(co.did.est)} [${pr2(co.did.lo)}, ${pr2(co.did.hi)}].`) : '') +
      modelLine('Follow-up', 'After a negative answer, English − Chinese', co && co.diff.N, pr2, 'probability', whyNot(fA)) +
      modelLine('Follow-up', 'After a positive answer, English − Chinese', co && co.diff.P, pr2, 'probability', whyNot(fA));
    if (okC1) {
      const lv = { '(Intercept)': 1, 'Seed valence (per point)': cm(fC1, 'Seed valence (per point)'), 'Position (per step)': cm(fC1, 'Position (per step)'), 'Block (second − first)': cm(fC1, 'Block (second − first)') };
      const pv = tr2.map(t => t.prevV), lo = Math.max(1, Math.floor(Math.min(...pv))), hi = Math.min(9, Math.ceil(Math.max(...pv)));
      const series = {};
      ['zh', 'en'].forEach(l => {
        const line = [];
        for (let v = lo; v <= hi + 1e-9; v += 0.25) { const c = fC1.contrast(Object.assign({ [LANGT]: L5(l), 'Previous valence (per point)': v - 5, 'Language × previous valence': L5(l) * (v - 5) }, lv)); line.push({ x: v, y: c.b, lo: c.ci[0], hi: c.ci[1] }); }
        const dots = [];
        for (let b = lo; b <= hi; b++) { const ys = tr2.filter(t => t.lang === l && Math.round(t.prevV) === b).map(t => t.nextV); if (ys.length >= 10) dots.push({ x: b, y: LAB.mean(ys), n: ys.length }); }
        series[l] = { line, dots };
      });
      FC.lines($('#a-c1'), { series, xDomain: [lo, hi], xTicks: Array.from({ length: hi - lo + 1 }, (_, k) => lo + k), xLabel: 'Previous answer’s valence (1–9)',
        yStep: 1, yFmt: v => String(Math.round(v)), yRef: 5, yFloor: 1, yCeil: 9, yLabel: 'Next answer’s valence',
        dotTitle: (l, d) => `${LANG_NAME[l]}: previous answers rated about ${d.x}, next answer ${d.y.toFixed(2)} on average (${d.n} transitions)`,
        lineTitle: l => `${LANG_NAME[l]}: ${b2(slope(l).b)} per point of the previous answer’s valence`,
        label: `Next answer’s valence against the previous answer’s valence: ${b2(slope('zh').b)} per point in Chinese, ${b2(slope('en').b)} in English` });
    } else box('#a-c1', whyNot(fC1) + '.');
    $('#a-tests-c1').innerHTML = modelLine('Main test, as a number', 'Language × previous valence', lpv, s2, 'per point', whyNot(fC1)) +
      (okC1 ? noteLine(`Each point of the previous answer’s valence moved the next answer by ${b2(slope('zh').b)} in Chinese and ${b2(slope('en').b)} in English.`) : '');

    // ---- B: the seed's pull by position ----
    if (okB) {
      const series = {};
      ['zh', 'en'].forEach(l => {
        const line = [];
        for (let k = 1; k <= nPos + 1e-9; k += 0.25) { const c = pullAt(l, k); line.push({ x: k, y: c.b, lo: c.ci[0], hi: c.ci[1] }); }
        const dots = [];
        for (let k = 1; k <= nPos; k++) { const a = ans.filter(q => q.scored && q.lang === l && q.position === k && isFinite(q.seedValence)); const f = LAB.ols(a.map(q => q.seedValence), a.map(q => q.valence)); if (f) dots.push({ x: k, y: f.b, n: a.length }); }
        series[l] = { line, dots };
      });
      FC.lines($('#a-bpull'), { series, xDomain: [1, nPos], xTicks: Array.from({ length: nPos }, (_, k) => k + 1), xLabel: 'Answer position',
        yStep: 0.1, yFmt: v => (Math.abs(v) < 1e-9 ? '0' : (v < 0 ? '−' : '') + Math.abs(v).toFixed(1)), yRef: 0, yLabel: 'Pull per point of seed valence',
        dotTitle: (l, d) => `${LANG_NAME[l]}, answer ${d.x}: ${b2(d.y)} per point, from the answers at that position alone (${d.n} answers)`,
        lineTitle: l => `${LANG_NAME[l]}: model estimate`,
        label: `The seed’s pull on each answer: at answer 1, ${b2(pullAt('zh', 1).b)} per point in Chinese and ${b2(pullAt('en', 1).b)} in English; at answer ${nPos}, ${b2(pullAt('zh', nPos).b)} and ${b2(pullAt('en', nPos).b)}` });
    } else box('#a-bpull', whyNot(fB) + '.');
    const bReading = () => {
      if (!okB || !bSV || !lsp) return '';
      const a = sigOf(bSV), d = sigOf(lsp);
      const big = bSV.b > 0 ? 'English' : 'Chinese', slower = lsp.b > 0 ? 'more slowly' : 'faster';
      const verdict = !a && !d ? 'No reliable language difference in the seed’s pull, either on the first answer or in how fast it faded.'
        : a && !d ? `The seed pulled the first answer harder in ${big}; no reliable language difference in how fast the pull faded.`
        : !a && d ? `No reliable language difference in the seed’s pull on the first answer, but it faded ${slower} in English.`
        : `The seed pulled the first answer harder in ${big}, and its pull faded ${slower} in English.`;
      return noteLine(`${verdict} At the first answer each point of seed valence moved the answer by ${b2(pullAt('zh', 1).b)} in Chinese and ${b2(pullAt('en', 1).b)} in English; across both, the pull changed by ${b3(fade.b)} each time the position doubled.`);
    };
    $('#a-tests-b').innerHTML = modelLine('Main test', 'Language × seed valence (answer 1)', bSV, s2, 'per point', whyNot(fB)) +
      modelLine('Main test', 'Language × seed valence × position', lsp, b3, 'per point, per doubling', whyNot(fB)) + bReading();

    // ---- C: drift along the chain ----
    if (okC) {
      const cv = { '(Intercept)': 1, 'Seed valence (per point)': cm(fC, 'Seed valence (per point)'), 'Block (second − first)': cm(fC, 'Block (second − first)') };
      const series = {};
      ['zh', 'en'].forEach(l => {
        const line = [];
        for (let k = 1; k <= nPos + 1e-9; k += 0.25) { const q = k - 5.5, q2 = q * q - 8.25; const c = fC.contrast(Object.assign({ [LANGT]: L5(l), 'Position (per step)': q, 'Position² (curve)': q2, 'Language × position': L5(l) * q, 'Language × position²': L5(l) * q2 }, cv)); line.push({ x: k, y: c.b, lo: c.ci[0], hi: c.ci[1] }); }
        const dots = [];
        for (let k = 0; k < nPos; k++) {
          const vals = parts.map(Pp => { const v = Pp.chains.filter(c => c.lang === l).map(c => c.answers[k] && c.answers[k].valence).filter(z => z !== null && z !== undefined); return v.length ? LAB.mean(v) : NaN; }).filter(isFinite);
          const ci = ci3(vals); dots.push({ x: k + 1, y: LAB.mean(vals), lo: ci[0], hi: ci[1], n: vals.length });
        }
        series[l] = { line, dots };
      });
      FC.lines($('#a-drift'), { series, xDomain: [1, nPos], xTicks: Array.from({ length: nPos }, (_, k) => k + 1), xLabel: 'Answer position',
        yStep: 0.5, yFmt: v => v.toFixed(1), yRef: 5, yFloor: 1, yCeil: 9, yLabel: 'Mean valence (1–9)',
        dotTitle: (l, d) => `${LANG_NAME[l]}, answer ${d.x}: ${d.y.toFixed(2)}` + (isFinite(d.lo) ? ` (95% CI ${d.lo.toFixed(2)} to ${d.hi.toFixed(2)})` : '') + `, ${d.n} students`,
        lineTitle: l => `${LANG_NAME[l]}: model curve`,
        label: `Mean valence by answer position: the model’s drift is ${b3(drift('zh'))} per answer in Chinese and ${b3(drift('en'))} in English` });
    } else box('#a-drift', whyNot(fC) + '.');
    $('#a-tests-c').innerHTML = modelLine('Main test', 'Language × position', cLP, b3, 'per answer', whyNot(fC)) +
      modelLine('Follow-up', 'Position (drift per answer, both languages)', coefOf(fC, 'Position (per step)'), b3, 'per answer', whyNot(fC)) +
      modelLine('Follow-up', 'Position² (curve)', coefOf(fC, 'Position² (curve)'), b3, '', whyNot(fC)) +
      modelLine('Follow-up', 'Language × position²', coefOf(fC, 'Language × position²'), b3, '', whyNot(fC));
    const ppts = v => isFinite(v) ? (v <= -0.0005 ? '−' : v >= 0.0005 ? '+' : '') + Math.abs(v * 100).toFixed(1) : '–';
    $('#a-tests-rep').innerHTML = modelLine('', 'Repeated answers, English − Chinese', ttE(repeat.test), ppts, 'pts', repeat.test.reason === 'novar' ? 'No variation to test' : '') +
      noteLine(`${pct1(repeat.zh)} of Chinese and ${pct1(repeat.en)} of English answers repeated an earlier word of the same chain.`);
    $('#a-tests-rt').innerHTML = modelLine('', 'Response time, English − Chinese', ttE(rt.test), s2, 'seconds', rt.test.reason === 'novar' ? 'No variation to test' : '') +
      noteLine(`The median time per answer was ${sec1(rt.zh)} in Chinese and ${sec1(rt.en)} in English.`);

    // ---- the models and all tests ----
    const fhost = $('#a-forest');
    if (okA) {
      const row = (label, c) => ({ label, b: c.b, lo: c.ci[0], hi: c.ci[1], p: c.p });
      FC.forest(fhost, [
        { label: 'Main test and simple effects', rows: [row('Language × previous state', inter),
          row('Language, after a negative answer', fA.contrast({ [LANGT]: 1, 'Language × previous state': -0.5 })),
          row('Language, after a positive answer', fA.contrast({ [LANGT]: 1, 'Language × previous state': 0.5 }))] },
        { label: 'Other terms', rows: fA.coef.filter(c => !['(Intercept)', 'Language × previous state'].includes(c.name)).map(c => row(c.name, c)) }
      ], { xLabel: 'Log-odds (95% CI)', label: 'Model A terms in log-odds with 95% confidence intervals' });
    } else fhost.innerHTML = `<p class="empty">${whyNot(fA)}${emptyText ? ': ' + emptyText : ''}.</p>`;
    const head = `<thead><tr><th scope="col">Question</th><th class="num" scope="col">Estimate</th><th class="num" scope="col">95% CI</th><th class="num sep" scope="col">Test</th><th class="num" scope="col"><i>p</i></th><th class="result" scope="col">Result</th></tr></thead>`;
    const grp = t => `<tr class="group"><th scope="rowgroup" colspan="6"><span class="stick">${t}</span></th></tr>`;
    const trow = (name, r, fmt, unit, why) => {
      const e = U(r);
      return `<tr><th scope="row">${name}</th>` + (e && isFinite(e.p)
        ? `<td class="num"><strong>${fmt(e.est)}</strong>${unit ? ' <small>' + unit + '</small>' : ''}</td><td class="num">${fmt(e.lo)} to ${fmt(e.hi)}</td><td class="num sep">${statOnly(e)}</td>${pCell(e)}${resultCell(asT(e), 0)}`
        : `<td class="num">–</td><td class="num">–</td><td class="num sep">–</td><td class="num">–</td><td class="result"><span class="sig na">${why || 'Too few runs to test'}</span></td>`) + '</tr>';
    };
    $('#a-tests').innerHTML = head + '<tbody>' +
      grp('A · Carry-over (model A: logistic)') +
      trow('Main test: language × previous state', inter, s2, 'log-odds', whyNot(fA)) +
      trow('Follow-up: after a negative answer, English − Chinese', co && co.diff.N, pr2, 'probability', whyNot(fA)) +
      trow('Follow-up: after a positive answer, English − Chinese', co && co.diff.P, pr2, 'probability', whyNot(fA)) +
      grp('A · With valence as a number (linear)') +
      trow('Main test: language × previous valence', lpv, s2, 'per point', whyNot(fC1)) +
      grp('B · The seed (model B: linear)') +
      trow('Main test: language × seed valence (answer 1)', bSV, s2, 'per point', whyNot(fB)) +
      trow('Main test: language × seed valence × position', lsp, b3, 'per doubling', whyNot(fB)) +
      trow('Seed valence × position (both languages)', fade, b3, 'per doubling', whyNot(fB)) +
      grp('C · Over the chain (model C: linear)') +
      trow('Main test: language × position', cLP, b3, 'per answer', whyNot(fC)) +
      trow('Follow-up: position (drift per answer, both languages)', coefOf(fC, 'Position (per step)'), b3, 'per answer', whyNot(fC)) +
      trow('Follow-up: position² (curve)', coefOf(fC, 'Position² (curve)'), b3, '', whyNot(fC)) +
      trow('Follow-up: language × position²', coefOf(fC, 'Language × position²'), b3, '', whyNot(fC)) +
      grp('Per student (paired t-tests)') +
      trow('Seed valence × language: positive − negative seeds', ttE(polarity.test), s2, 'points', '') +
      trow('Repeated answers', ttE(repeat.test), ppts, 'pts', '') +
      trow('Response time (median per answer)', ttE(rt.test), s2, 's', '') +
      '</tbody>';
    $('#a-tests-note').innerHTML = 'Every model has random intercepts for students, seeds and chains (a student’s ten answers to one seed). ' +
      'Model A: logistic regression on every valid two-state transition, next answer positive ~ language × previous state + seed valence + position + block (Laplace approximation, as lme4’s nAGQ = 0; Wald <i>z</i>). Its follow-ups are average marginal predictions over this class’s transitions, on the probability scale (delta-method CIs). ' +
      'The linear models are fitted by REML; their <i>t</i>-tests use Satterthwaite degrees of freedom (as lmerTest), so a term that varies only between seeds is tested with few degrees of freedom. ' +
      'Model B lets the seed’s pull change with log₂(position), so its “answer 1” terms describe the first answer and its position terms each doubling of the position (answers 1→2→4→8). ' +
      `Paired <i>t</i>-tests use one score per student and language (positive − negative seeds: ${b2(polarity.zh)} in Chinese, ${b2(polarity.en)} in English). Two-tailed, α = .05.` +
      (fA && fA.reason === 'separation' ? ` <strong>Model A cannot be estimated yet:</strong> ${emptyText}.` : '') +
      (okA && fA.dropped.length ? ` Not estimable with the runs so far, so left out: ${fA.dropped.map(d => d.toLowerCase()).join('; ')}.` : '');
    const MODELS = [
      ['Model A · next answer positive (logistic)', fA, 'next_positive ~ language * previous_state + seed_valence + position + block'],
      ['Model A, continuous · next answer’s valence (linear)', fC1, 'next_valence ~ language * previous_valence + seed_valence + position + block'],
      ['Model B · the seed’s pull (linear)', fB, 'valence ~ language * seed_valence * log2(position) + block'],
      ['Model C · over the chain (linear)', fC, 'valence ~ language * (position + position^2) + seed_valence + block']
    ];
    $('#a-models').innerHTML = MODELS.map(([ttl, f, formula]) => `<h4 class="model-h">${ttl}</h4><p class="small muted"><code>${formula} + (1 | student) + (1 | seed) + (1 | chain)</code></p>` +
      (!f || !f.ok ? `<p class="small">${whyNot(f)}.</p>` :
        `<div class="table-wrap" data-label="${ttl}"><table class="data"><thead><tr><th scope="col">Fixed effect</th><th class="num" scope="col"><i>b</i></th><th class="num" scope="col">SE</th><th class="num" scope="col">95% CI</th>` +
        `<th class="num sep" scope="col">${f.kind === 'lmm' ? '<i>t</i> (df)' : '<i>z</i>'}</th><th class="num" scope="col"><i>p</i></th></tr></thead><tbody>` +
        f.coef.map(c => `<tr><th scope="row">${c.name}</th><td class="num">${b3(c.b)}</td><td class="num">${c.se.toFixed(3)}</td><td class="num">${b3(c.ci[0])} to ${b3(c.ci[1])}</td>` +
          `<td class="num sep">${b2(c.stat)}${c.df ? ` (${dfShow(c.df)})` : ''}</td>${pCell(c)}</tr>`).join('') +
        `<tr class="group"><th scope="rowgroup" colspan="6"><span class="stick">Random intercepts (SD) · ${f.n.toLocaleString('en-US')} ${f === fA || f === fC1 ? 'transitions' : 'answers'}${f.kind === 'lmm' ? ` · residual SD ${f.sigma.toFixed(2)}` : ''}</span></th></tr>` +
        f.groupNames.map((g, i) => `<tr><th scope="row">${g}s (${f.nLevels[i]})</th><td class="num">${f.sd[i].toFixed(3)}</td><td colspan="4"></td></tr>`).join('') + '</tbody></table></div>')).join('');

    // ---- the summary: one line per question, always in the same order ----
    const items = [];
    const pend = f => `<span class="muted">${whyNot(f)}</span>`;
    const verdictA = !inter || !isFinite(inter.p) ? whyNot(fA).toLowerCase()
      : LAB.isSig(asT(U(inter))) ? `${inter.b < 0 ? 'weaker' : 'stronger'} in English` : 'no reliable language difference';
    items.push(`<li><strong>A · Carry-over: ${verdictA}.</strong> ` + (co
      ? `After a positive answer the next was positive with probability ${p3(co.next.zh.P.est)} in Chinese and ${p3(co.next.en.P.est)} in English; after a negative answer, ${p3(co.next.zh.N.est)} and ${p3(co.next.en.N.est)}. ` +
        `Carry-over, the difference, was ${p3(co.carry.zh.est)} in Chinese and ${p3(co.carry.en.est)} in English ${inline(`interaction ${statTxt(U(inter))}${st}`)}.`
      : emptyText ? `${cap(emptyText)}.` : pend(fA)) + '</li>');
    items.push(`<li><strong>A · With valence as a number: ${okC1 && lpv ? (LAB.isSig(asT(U(lpv))) ? `the next answer followed the previous one ${lpv.b < 0 ? 'less' : 'more'} closely in English` : 'no reliable language difference') : whyNot(fC1).toLowerCase()}.</strong> ` +
      (okC1 && lpv ? `Each point of the previous answer’s valence moved the next answer by ${b2(slope('zh').b)} in Chinese and ${b2(slope('en').b)} in English ${inline(statTxt(U(lpv)) + st)}.` : '') + '</li>');
    items.push(`<li><strong>B · The seed: ${okB && bSV && lsp ? (!sigOf(bSV) && !sigOf(lsp) ? 'no reliable language difference in its pull' : [sigOf(bSV) ? `a ${bSV.b < 0 ? 'smaller' : 'larger'} pull on the first answer in English` : '', sigOf(lsp) ? `a pull that faded ${lsp.b > 0 ? 'more slowly' : 'faster'} in English` : ''].filter(Boolean).join(', and ')) : whyNot(fB).toLowerCase()}.</strong> ` +
      (okB && bSV && lsp ? `At the first answer each point of seed valence moved the answer by ${b2(pull1('zh'))} in Chinese and ${b2(pull1('en'))} in English ${inline(statTxt(U(bSV)) + st)}; the language difference in fading was ${b3(lsp.b)} per doubling of position ${inline(statTxt(U(lsp)) + st)}.` : '') + '</li>');
    items.push(`<li><strong>C · Over the chain: ${okC && cLP ? (LAB.isSig(asT(U(cLP))) ? `valence drifted ${cLP.b > 0 ? 'more upwards' : 'more downwards'} in English` : 'no reliable language difference in drift') : whyNot(fC).toLowerCase()}.</strong> ` +
      (okC && cLP ? `Valence changed by ${b3(drift('zh'))} per answer in Chinese and ${b3(drift('en'))} in English ${inline(statTxt(U(cLP)) + st)}` + (sigOf(coefOf(fC, 'Position² (curve)')) ? '; the trajectory was curved, not straight.' : '.') : '') + '</li>');
    const RT = repeat.test, TT = rt.test;
    const ttVerdict = (T, more, less) => isFinite(T.p) ? (LAB.isSig(T) ? (T.m > 0 ? more : less) : 'no reliable language difference') : T.reason === 'novar' ? 'no variation to test' : 'not enough runs to test yet';
    items.push(`<li><strong>C · Repeated answers: ${ttVerdict(RT, 'more in English', 'fewer in English')}.</strong> ` +
      `${pct1(repeat.zh)} of Chinese and ${pct1(repeat.en)} of English answers repeated an earlier word of the same chain` + (isFinite(RT.t) ? ` ${inline(LAB.fmtTest(RT) + st)}` : '') + '.</li>');
    items.push(`<li><strong>C · Response time: ${ttVerdict(TT, 'slower in English', 'faster in English')}.</strong> ` +
      `The median time per answer was ${sec1(rt.zh)} in Chinese and ${sec1(rt.en)} in English` + (isFinite(TT.t) ? ` ${inline(LAB.fmtTest(TT) + st)}` : '') + '.</li>');
    const prim = PROF.filter(o => o.sk === 'overall' && o.test && isFinite(o.test.p)), fol = PROF.filter(o => o.sk !== 'overall' && o.judged && isFinite(o.judged.p));
    if (prim.length) {
      const MN = { NN: 'staying negative', PP: 'staying positive', V: 'valence' };
      const ps = prim.filter(o => LAB.isSig(o.test)), fs = fol.filter(o => LAB.isSig(o.judged));
      items.push(`<li><strong>English proficiency (exploratory): ${ps.length ? 'the overall rating mattered for ' + ps.map(o => MN[o.k]).join(' and ') : 'no significant slope for the overall rating'}.</strong> ` +
        prim.map(o => `${cap(MN[o.k])}: ${b3(o.gap.b)} per rating point ${inline(LAB.fmtTest(o.test) + st)}`).join('; ') + '. ' +
        (fs.length ? `Skill follow-ups significant after Benjamini–Hochberg adjustment: ${fs.map(o => `${MN[o.k]} with ${o.sk} (adjusted ${LAB.fmtP(o.padj)})`).join('; ')}.` : 'None of the twelve skill follow-ups survived Benjamini–Hochberg adjustment.') + '</li>');
    }
    const gap = Math.abs(C.zh.valid - C.en.valid);
    items.push(`<li><strong>Coverage.</strong> The norms scored ${pct0(C.zh.scored)} of Chinese and ${pct0(C.en.scored)} of English answers; ` +
      `${pct0(C.zh.valid)} and ${pct0(C.en.valid)} of possible transitions were valid.` +
      (gap >= 0.1 ? ` The ${C.zh.valid < C.en.valid ? 'Chinese' : 'English'} results rest on noticeably fewer transitions; see the robustness checks.` : '') +
      (other ? ` ${other} run${other > 1 ? 's' : ''} with an earlier set of seed words ${other > 1 ? 'are' : 'is'} not included.` : '') + '</li>');
    $('#a-summary').innerHTML = items.join('');
    if ($('#a-robust-more').open) renderRobust();
    syncScrollers();
  }

  /* ---------- robustness checks: fitted when their fold-out is opened ----------
     The key results again (1) without the chain random intercepts, (2) with
     only students the norms covered well (at least 70% of possible transitions
     valid in both languages, a cut-off fixed in advance) and (3) with Chinese
     valence put on the English scale by percentile instead of linear equating;
     plus a model of which answers go unscored. */
  const ROBUST_COLS = [['main', 'Main analysis'], ['nochain', 'No chain intercepts'], ['coverage', 'Good coverage only'], ['percentile', 'Percentile equating']];
  const ROBUST_ROWS = [
    ['A · Language × previous state', 'log-odds', 'A', v => v.A && v.A.ok ? v.A.coefOf('Language × previous state') : null, s2],
    ['A · After a negative answer, English − Chinese', 'probability', 'A', v => v.A && v.A.ok ? v.A.carry.diff.N : null, pr2],
    ['A · After a positive answer, English − Chinese', 'probability', 'A', v => v.A && v.A.ok ? v.A.carry.diff.P : null, pr2],
    ['A · Language × previous valence', 'per point', 'C1', v => v.C1 && v.C1.ok ? v.C1.coefOf('Language × previous valence') : null, s2],
    ['B · Language × seed valence (answer 1)', 'per point', 'B', v => v.B && v.B.ok ? v.B.coefOf('Language × seed valence') : null, s2],
    ['B · Language × seed valence × position', 'per doubling', 'B', v => v.B && v.B.ok ? v.B.coefOf('Language × seed valence × position') : null, b3]
  ];
  function runRobust() {
    const key = fastState.fitKey;
    if (!fastState.norms || !fastState.parts.length) return;
    if (fastState.robustKey === key) { renderRobust(); return; }
    fastState.robustKey = key;
    const R = fastState.robust = { variants: { nochain: {}, coverage: {}, percentile: {} }, miss: null, done: 0, total: 10 };
    const parts = fastState.parts, per = FA.perParticipant(parts);
    const good = parts.filter((P, i) => ['zh', 'en'].every(l => per[i].lang[l].possible > 0 && per[i].lang[l].valid / per[i].lang[l].possible >= 0.7));
    const pct = FA.relink(parts, FA.percentileLink(fastState.norms));
    const jobs = [];
    [['nochain', parts, false], ['coverage', good, true], ['percentile', pct, true]].forEach(([k, ps, chain]) => {
      R.variants[k].n = ps.length;
      const tr = FA.transitions(ps, FA.state2), an = FA.answers(ps);
      jobs.push({ key: k + ':A', model: 'A', tr, chain }, { key: k + ':C1', model: 'C1', tr, chain }, { key: k + ':B', model: 'B', ans: an, chain });
    });
    jobs.push({ key: 'miss', model: 'Miss', ans: FA.answers(parts) });
    R.total = jobs.length;
    renderRobust();
    fitJobs('robust', jobs, (key, f) => {
      if (fastState.robust !== R) return;
      if (key === 'miss') R.miss = f; else { const [k, m] = key.split(':'); R.variants[k][m] = f; }
      R.done++;
      renderRobust();
    });
  }
  function renderRobust() {
    const R = fastState.robust;
    if (!R) return;
    const st = $('#a-robust-status');
    const mainDone = ['A', 'C1', 'B'].every(k => fastState.fits[k]);
    // the status line keeps its place when done, so the table does not jump
    st.textContent = R.done < R.total ? `Fitting the checks… ${R.done} of ${R.total}` : mainDone ? `All ${R.total} checks fitted.` : 'Waiting for the main models…';
    st.classList.toggle('done', R.done >= R.total && mainDone);
    const V = { main: fastState.fits, nochain: R.variants.nochain, coverage: R.variants.coverage, percentile: R.variants.percentile };
    const total = fastState.parts.length, made = { nochain: 0, coverage: 0, percentile: 0 }, flips = { nochain: [], coverage: [], percentile: [] };
    const lower = t => t.charAt(0).toLowerCase() + t.slice(1);
    $('#a-robust').innerHTML = `<thead><tr><th scope="col">Result</th>${ROBUST_COLS.map(([k, t]) => `<th class="num${k === 'nochain' ? ' sep' : ''}" scope="col">${t}${k === 'coverage' && isFinite(R.variants.coverage.n) ? `<span class="th-sub">${R.variants.coverage.n} of ${total} students</span>` : ''}</th>`).join('')}</tr></thead><tbody>` +
      ROBUST_ROWS.map(([name, unit, model, get, fmt]) => {
        const main = U(get(V.main));
        return `<tr><th scope="row">${name} <small class="muted unit">(${unit})</small></th>` + ROBUST_COLS.map(([k, label]) => {
          const v = V[k], e = U(get(v)), fitted = !!v[model];
          const cls = `num${k === 'nochain' ? ' sep' : ''}`;
          if (!e || !isFinite(e.p)) return `<td class="${cls}">${fitted ? '–' : '<span class="muted">…</span>'}</td>`;
          const compared = k !== 'main' && main && isFinite(main.p);
          if (compared) made[k]++;
          const flip = compared && (main.p < 0.05) !== (e.p < 0.05);
          if (flip) flips[k].push(lower(name.replace(/^[AB] · /, '')));
          return `<td class="${cls}${e.p < 0.05 ? ' r-sig' : ''}"><b>${fmt(e.est)}</b><span class="rp">${LAB.fmtP(e.p)}</span>${flip ? '<span class="flip">verdict differs</span>' : ''}</td>`;
        }).join('') + '</tr>';
      }).join('') + '</tbody>';
    // Count only the comparisons that were made, and name any check that could not run.
    const finished = R.done >= R.total && mainDone, LBL = Object.fromEntries(ROBUST_COLS);
    const nMade = made.nochain + made.coverage + made.percentile, nFlip = flips.nochain.length + flips.coverage.length + flips.percentile.length;
    const notRun = ['nochain', 'coverage', 'percentile'].filter(k => !made[k]).map(k => k === 'coverage' ? `${LBL[k]} (${R.variants.coverage.n} of ${total} students qualify)` : `${LBL[k]} (could not be fitted)`);
    $('#a-robust-sum').innerHTML = !finished ? '' : (!nMade ? '<strong>No comparisons could be made yet.</strong>'
      : nFlip ? `<strong>${nFlip} of ${nMade} verdicts differ from the main analysis.</strong> ` + ['nochain', 'coverage', 'percentile'].filter(k => flips[k].length).map(k => `${LBL[k]}: ${flips[k].join('; ')}.`).join(' ')
      : `<strong>Every verdict holds</strong> in the ${nMade} comparisons that could be made.`) +
      (notRun.length ? ` Not run: ${notRun.join('; ')}.` : '');
    const nGood = R.variants.coverage.n;
    $('#a-robust-note').innerHTML = 'Each cell: the estimate and its <i>p</i>; bold: significant at .05. “Verdict differs”: significant in one analysis and not in the other. ' +
      '<b>No chain intercepts</b>: random intercepts for students and seeds only. ' +
      `<b>Good coverage only</b>: students with at least 70% of their possible transitions valid in both languages (${isFinite(nGood) ? nGood + ' of ' + total : '–'}); the cut-off was fixed before looking at results. ` +
      '<b>Percentile equating</b>: each Chinese rating takes the English value at the same percentile of the two whole norm sets, instead of the linear link (the state boundary stays at 5). Linear equating is the same as z-scoring each norm set, so z-scores would not be a different check.';
    const M = R.miss;
    if (!M) { $('#a-miss').innerHTML = ''; $('#a-miss-note').textContent = R.done < R.total ? 'Fitting…' : ''; return; }
    if (!M.ok) { $('#a-miss').innerHTML = ''; $('#a-miss-note').textContent = `The model of unscored answers could not be fitted (${whyNot(M).toLowerCase()}).`; return; }
    const or = v => Math.exp(v).toFixed(2);
    $('#a-miss').innerHTML = `<thead><tr><th scope="col">Predictor of an answer being scored</th><th class="num" scope="col">Odds ratio</th><th class="num" scope="col">95% CI</th><th class="num sep" scope="col"><i>z</i></th><th class="num" scope="col"><i>p</i></th></tr></thead><tbody>` +
      M.coef.filter(c => c.name !== '(Intercept)').map(c => `<tr><th scope="row">${c.name}</th><td class="num"><strong>${or(c.b)}</strong></td><td class="num">${or(c.ci[0])} to ${or(c.ci[1])}</td><td class="num sep">${b2(c.z)}</td>${pCell(c)}</tr>`).join('') + '</tbody>';
    const lang = M.coefOf(LANGT), svc = M.coefOf('Seed valence (per point)'), pos = M.coefOf('Position (per step)');
    $('#a-miss-note').innerHTML = `Logistic model of whether the norms scored an answer (${M.n.toLocaleString('en-US')} answers; random intercepts for students and seeds). ` +
      (lang ? `English answers were ${or(lang.b)} times as likely, in odds, to be scored as Chinese ones (${LAB.fmtP(lang.p)}). ` : '') +
      (svc ? (svc.p < 0.05 ? `Scoring also depended on the seed’s valence (odds ratio ${or(svc.b)} per point, ${LAB.fmtP(svc.p)}), so missing answers are not unrelated to the affective context. ` : `Scoring did not depend on the seed’s valence (${LAB.fmtP(svc.p)}). `) : '') +
      (pos ? (pos.p < 0.05 ? `It changed along the chain (odds ratio ${or(pos.b)} per answer, ${LAB.fmtP(pos.p)}).` : `It did not change along the chain (${LAB.fmtP(pos.p)}).`) : '');
    syncScrollers();
  }

  function taskStats(rows) {
    const inc = included(rows);
    const eff = inc.map(r => num(r.effect)).filter(isFinite);
    const errEff = inc.map(r => num(r.err_effect)).filter(isFinite);
    return {
      n: rows.length, nInc: inc.length, eff,
      mean: LAB.mean(eff), ci: LAB.ci95(eff), test: LAB.ttest(eff, 0),
      rel: LAB.mean(inc.map(r => num(r.rt_related)).filter(isFinite)),
      ctl: LAB.mean(inc.map(r => num(r.rt_control)).filter(isFinite)),
      accW: LAB.mean(inc.map(r => num(r.acc_words)).filter(isFinite)),
      accN: LAB.mean(inc.map(r => num(r.acc_nonwords)).filter(isFinite)),
      // accuracy analysis: error rates per condition, and their difference
      errRel: LAB.mean(inc.map(r => num(r.err_related)).filter(isFinite)),
      errCtl: LAB.mean(inc.map(r => num(r.err_control)).filter(isFinite)),
      errEff: errEff, errEffMean: LAB.mean(errEff), errCI: LAB.ci95(errEff), errTest: LAB.ttest(errEff, 0)
    };
  }

  function renderWords(m, v) {
    const M = taskStats(m), V = taskStats(v);
    const tile = (label, S) => `<div class="stat${kind(S.test, 1) === 'yes' ? ' key' : ''}"><span class="stat-label">${label}</span>` +
      `<span class="stat-value">${isFinite(S.mean) ? LAB.signed(S.mean) + '<small>ms</small>' : '–'}</span>` +
      `<span class="stat-note">95% CI ${fmtCI(S.ci)}\u00a0· <i>n</i>\u00a0=\u00a0${S.nInc}${small(S.nInc)}</span><span class="stat-test">${testLine(S.test, 1)}</span></div>`;
    $('#w-stats').innerHTML = tile('Masked priming (60 ms)', M) + tile('Visible priming (200 ms)', V) +
      `<div class="stat"><span class="stat-label">Took part</span><span class="stat-value">${m.length} · ${v.length}</span><span class="stat-note">masked · visible runs</span></div>`;

    const host = $('#w-strip');
    if (!m.length && !v.length) { host.innerHTML = '<p class="empty">No runs yet for this class. Results appear here as students finish.</p>'; }
    else {
      LAB.stripPlot(host, [
        { label: 'Masked', sub: '60 ms prime', values: m.map(r => ({ v: num(r.effect), excluded: String(r.include) !== '1' })) },
        { label: 'Visible', sub: '200 ms prime', values: v.map(r => ({ v: num(r.effect), excluded: String(r.include) !== '1' })) }
      ], {
        width: 1000, r: 7, domain: [-40, 120],
        xLabel: 'Priming effect (ms): unrelated − translation',
        ariaLabel: `Masked mean ${Math.round(M.mean)} ms (n ${M.nInc}); visible mean ${Math.round(V.mean)} ms (n ${V.nInc})`
      });
    }

    const pct1 = v => isFinite(v) ? (v * 100).toFixed(1) + '%' : '–';
    const signedPct = v => isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v * 100).toFixed(1) : '–';

    const rtRow = (name, S) => `<tr><th scope="row">${name}</th><td class="num">${S.nInc} / ${S.n}</td>` +
      `<td class="num">${fmtMs(S.rel)}</td><td class="num">${fmtMs(S.ctl)}</td>` +
      `<td class="num"><strong>${isFinite(S.mean) ? LAB.signed(S.mean) + ' ms' : '–'}</strong></td><td class="num">${fmtCI(S.ci)}</td>` +
      `${tCell(S.test)}${pCell(S.test)}${esCell(S.test)}${resultCell(S.test, 1)}</tr>`;
    $('#w-rt-table').innerHTML =
      `<thead><tr><th scope="col">Task</th><th class="num" scope="col">n</th><th class="num" scope="col">Translation</th>` +
      `<th class="num" scope="col">Unrelated</th><th class="num" scope="col">Priming</th><th class="num" scope="col">95% CI</th>${tHead('<i>d</i><sub>z</sub>')}</tr></thead>` +
      `<tbody>${rtRow('Masked', M)}${rtRow('Visible', V)}</tbody>`;

    const accRow = (name, S) => `<tr><th scope="row">${name}</th><td class="num">${S.nInc} / ${S.n}</td>` +
      `<td class="num">${pct1(S.errRel)}</td><td class="num">${pct1(S.errCtl)}</td>` +
      `<td class="num"><strong>${signedPct(S.errEffMean)}${isFinite(S.errEffMean) ? ' pts' : ''}</strong></td>` +
      `<td class="num">${isFinite(S.errCI[0]) ? signedPct(S.errCI[0]) + '\u00a0to\u00a0' + signedPct(S.errCI[1]) : '–'}</td>` +
      `${tCell(S.errTest)}${pCell(S.errTest)}${resultCell(S.errTest, 1)}` +
      `<td class="num sep">${LAB.pct(S.accN)}</td></tr>`;
    $('#w-acc-table').innerHTML =
      `<thead><tr><th scope="col">Task</th><th class="num" scope="col">n</th><th class="num" scope="col">Errors after translation</th>` +
      `<th class="num" scope="col">Errors after unrelated</th><th class="num" scope="col">Priming</th><th class="num" scope="col">95% CI</th>${tHead('')}` +
      `<th class="num sep" scope="col">Non-words correct</th></tr></thead>` +
      `<tbody>${accRow('Masked', M)}${accRow('Visible', V)}</tbody>`;

    // Awareness of the masked primes
    const labels = [['nothing', 'Saw nothing else'], ['flicker', 'A flicker'], ['saw_chinese', 'Chinese, unreadable'], ['read_chinese', 'Read some Chinese']];
    const count = k => m.filter(r => r.awareness === k).length;
    const tot = m.filter(r => r.awareness).length;
    $('#w-aware').innerHTML = labels.map(([k, l]) => {
      const n = count(k);
      const p = tot ? n / tot : 0;
      return `<div class="bar-row"><span>${l}</span><div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${p * 100}%"></div></div><span class="v">${n}</span></div>`;
    }).join('');
    const unaware = included(m).filter(r => r.awareness === 'nothing' || r.awareness === 'flicker').map(r => num(r.effect)).filter(isFinite);
    const aware = included(m).filter(r => r.awareness === 'saw_chinese' || r.awareness === 'read_chinese').map(r => num(r.effect)).filter(isFinite);
    const A = LAB.welch(unaware, aware);   // aware − unaware
    $('#w-aware-note').innerHTML = isFinite(A.p)
      ? `Priming among those who saw no Chinese: ${LAB.signed(LAB.mean(unaware))} ms (n = ${unaware.length}); among those who saw it: ${LAB.signed(LAB.mean(aware))} ms (n = ${aware.length}). Difference ${LAB.isSig(A) ? 'significant' : 'not significant'}: ${LAB.fmtTest(A)} (Welch).`
      : 'Once at least two people in each group have answered, this compares priming for those who did and did not see the Chinese words.';

    // Screens
    const hz = {};
    m.concat(v).forEach(r => { const h = Math.round(num(r.frame_hz)); if (isFinite(h)) hz[h] = (hz[h] || 0) + 1; });
    const mp = m.map(r => num(r.prime_ms_median)).filter(isFinite);
    const hzText = Object.keys(hz).sort((a, b) => a - b).map(h => `${h} Hz × ${hz[h]}`).join(', ');
    $('#w-screens').textContent = hzText
      ? `Refresh rates: ${hzText}. The masked prime was set to 60 ms and rounded to whole frames; it actually lasted ${Math.round(Math.min(...mp))}–${Math.round(Math.max(...mp))} ms across laptops (median ${Math.round(LAB.median(mp))} ms).`
      : 'Refresh rates and actual prime durations appear here once people have finished.';

    // Summary
    const items = [['Masked priming', M], ['Visible priming', V]].map(([name, S]) => {
      const T = S.test;
      if (!isFinite(T.p)) return item(null, `${lead(name, T)} ${novar(T) ? SAME : `${S.nInc} usable run${S.nInc === 1 ? '' : 's'} so far; the test needs at least 2.`}`);
      return item(T, `${lead(name, T, 1)} English words were recognised ${Math.abs(Math.round(T.m))} ms ${T.m >= 0 ? 'faster' : 'slower'} after their Chinese translation than after an unrelated word ${inline(`${LAB.fmtTest(T)}, ${LAB.fmtES(T, '<i>d</i><sub>z</sub>')}, <i>n</i>\u00a0=\u00a0${T.n}${smallTag(T.n)}`)}.`);
    });
    const acc = [['masked', M], ['visible', V]].filter(([, S]) => isFinite(S.errTest.p));
    if (acc.length) {
      const part = ([name, S]) => { const T = S.errTest, pts = Math.abs(T.m * 100).toFixed(1);
        return `${cap(name)} task: ${pts} points ${T.m >= 0 ? 'fewer' : 'more'} errors after the translation, ${LAB.isSig(T) ? 'significant' : 'not significant'} ${inline(LAB.fmtTest(T))}.`; };
      items.push(`<li><strong>Accuracy.</strong> ${acc.map(part).join(' ')}</li>`);
    }
    if (tot) {
      let t = `<strong>Awareness.</strong> ${count('read_chinese')} of ${tot} said they read some of the masked Chinese` +
        (count('saw_chinese') ? `, and ${count('saw_chinese')} saw Chinese they could not read.` : '.');
      if (isFinite(A.p)) t += ` Priming ${LAB.isSig(A) ? 'differed significantly' : 'did not differ significantly'} between those who saw Chinese (${LAB.signed(LAB.mean(aware))} ms) and those who did not (${LAB.signed(LAB.mean(unaware))} ms): ${bare(LAB.fmtTest(A))}.`;
      items.push(item(A, t));
    }
    $('#w-summary').innerHTML = items.join('');
  }

  /* ---------- sentence task: typicality ---------- */
  /* A run counts if the task interpreted it (accuracy ≥ 80%, ≥ 12 valid trials
     per condition), and only each person's first such run. */
  function svtRuns(rows) {
    const seen = new Set();
    return rows.map(r => {
      const counted = String(r.include) === '1' && !seen.has(r.pid);
      if (counted) seen.add(r.pid);
      return { r, counted };
    });
  }

  function renderSvt(rows) {
    const runs = svtRuns(rows), inc = runs.filter(x => x.counted).map(x => x.r);
    const col = k => inc.map(r => num(r[k])).filter(isFinite);
    const eff = col('effect'), T = LAB.ttest(eff, 0);
    const hi = LAB.mean(col('rt_high')), lo = LAB.mean(col('rt_low'));
    const people = new Set(rows.map(r => r.pid)).size;
    const notCounted = runs.filter(x => !x.counted);
    const repeats = notCounted.filter(x => String(x.r.include) === '1').length;

    $('#v-stats').innerHTML =
      `<div class="stat${kind(T, 1) === 'yes' ? ' key' : ''}"><span class="stat-label">Typicality effect</span>` +
      `<span class="stat-value">${isFinite(T.m) ? LAB.signed(T.m) + '<small>ms</small>' : '–'}</span>` +
      `<span class="stat-note">low − high typicality · 95% CI ${fmtCI(T.ci)} · <i>n</i> = ${inc.length}${small(inc.length)}</span>` +
      `<span class="stat-test">${testLine(T, 1)}</span></div>` +
      `<div class="stat"><span class="stat-label">High-typicality true statements</span><span class="stat-value">${isFinite(hi) ? Math.round(hi) + '<small>ms</small>' : '–'}</span><span class="stat-note">mean of each person’s median</span></div>` +
      `<div class="stat"><span class="stat-label">Low-typicality true statements</span><span class="stat-value">${isFinite(lo) ? Math.round(lo) + '<small>ms</small>' : '–'}</span><span class="stat-note">mean of each person’s median</span></div>` +
      `<div class="stat"><span class="stat-label">Took part</span><span class="stat-value">${people}</span><span class="stat-note">${inc.length} counted · ${rows.length} run${rows.length === 1 ? '' : 's'}</span></div>`;

    const host = $('#v-strip');
    if (!rows.length) host.innerHTML = '<p class="empty">No runs yet for this class. Results appear here as students finish.</p>';
    else LAB.stripPlot(host, [{ label: '', values: runs.map(x => ({ v: num(x.r.effect), excluded: !x.counted })) }], {
      width: 1000, r: 7, domain: [-100, 200],
      xLabel: 'Typicality effect (ms): low − high typicality median',
      ariaLabel: `Typicality effects: ${inc.length} people counted, mean ${isFinite(T.m) ? Math.round(T.m) : '–'} ms`
    });

    $('#v-table').innerHTML =
      `<thead><tr><th scope="col">Statements</th><th class="num" scope="col">n</th><th class="num" scope="col">High typicality</th><th class="num" scope="col">Low typicality</th>` +
      `<th class="num" scope="col">Effect</th><th class="num" scope="col">95% CI</th>${tHead('<i>d</i><sub>z</sub>')}</tr></thead>` +
      `<tbody><tr><th scope="row">True statements</th><td class="num">${inc.length} / ${rows.length}</td><td class="num">${fmtMs(hi)}</td><td class="num">${fmtMs(lo)}</td>` +
      `<td class="num"><strong>${isFinite(T.m) ? LAB.signed(T.m) + ' ms' : '–'}</strong></td><td class="num">${fmtCI(T.ci)}</td>` +
      `${tCell(T)}${pCell(T)}${esCell(T)}${resultCell(T, 1)}</tr></tbody>`;

    const pct = k => { const a = col(k); return a.length ? Math.round(LAB.mean(a) * 100) + '%' : '–'; };
    const lowAcc = notCounted.filter(x => String(x.r.include) !== '1').length;
    $('#v-quality').textContent = rows.length
      ? `Counted runs: accuracy ${pct('acc')} on average (true statements ${pct('acc_targets')}, false ${pct('acc_fillers')}); ` +
        `${LAB.round(LAB.mean(col('n_high')), 1) || '–'} and ${LAB.round(LAB.mean(col('n_low')), 1) || '–'} valid trials per person out of 28 (high, low). ` +
        `Not counted: ${lowAcc} run${lowAcc === 1 ? '' : 's'} with accuracy below 80% or too few valid trials, ${repeats} repeat run${repeats === 1 ? '' : 's'}.`
      : '';

    const items = [!isFinite(T.p)
      ? item(null, `${lead('Typicality', T)} ${novar(T) ? SAME : `${inc.length} usable run${inc.length === 1 ? '' : 's'} so far; the test needs at least 2.`}`)
      : item(T, `${lead('Typicality', T, 1)} True statements about high-typicality members were verified ${Math.abs(Math.round(T.m))} ms ${T.m >= 0 ? 'faster' : 'slower'} than statements about low-typicality members ${inline(`${LAB.fmtTest(T)}, ${LAB.fmtES(T, '<i>d</i><sub>z</sub>')}, <i>n</i> = ${T.n}${smallTag(T.n)}`)}.`)];

    /* English proficiency (exploratory). For each self-rating: least-squares
       slopes of each student's high and low medians on the rating, and of
       their effect (low − high), whose slope is the interaction. */
    const P = SVT_SKILLS.map(([k, name]) => {
      const pts = inc.map(r => ({ x: num(r[k]), hi: num(r.rt_high), lo: num(r.rt_low), eff: num(r.effect) }))
        .filter(q => isFinite(q.x) && isFinite(q.hi) && isFinite(q.lo) && isFinite(q.eff));
      const xs = pts.map(q => q.x), fit = key => LAB.ols(xs, pts.map(q => q[key]));
      const fe = fit('eff');
      return { k, name, pts, xs, hi: fit('hi'), lo: fit('lo'), eff: fe, test: fe ? { diff: fe.b, t: fe.t, df: fe.df, p: fe.p, ci: fe.ciB } : null };
    });
    const sel = (document.querySelector('#v-prof-skill input:checked') || {}).value || 'eng_mean';
    const cur = P.find(o => o.k === sel) || P[0];
    const xLabel = `English self-rating: ${cur.name.toLowerCase()} (1–7)`;
    const none = '<p class="empty">No counted runs with English self-ratings yet.</p>';
    const spreadOf = o => o.xs.length ? Math.max(...o.xs) - Math.min(...o.xs) : 0;
    if (cur.pts.length && !spreadOf(cur)) {
      const msg = `<p class="empty">Everyone so far gave the same ${cur.name === 'Mean of five' ? 'mean rating' : cur.name.toLowerCase() + ' rating'}, so there is nothing to compare yet.</p>`;
      $('#v-prof-rt').innerHTML = msg; $('#v-prof-eff').innerHTML = msg;
    } else if (cur.pts.length) {
      // Lower and upper half on the chosen rating (ties at the median go to the lower half,
      // unless that would leave the upper half empty); each group named by its range.
      const med = LAB.median(cur.xs);
      let low = cur.pts.filter(q => q.x <= med);
      if (low.length === cur.pts.length) low = cur.pts.filter(q => q.x < med);
      const up = cur.pts.filter(q => !low.includes(q));
      const range = g => { const v = g.map(q => q.x), a = +Math.min(...v).toFixed(1), b = +Math.max(...v).toFixed(1); return a === b ? `rated ${a}` : `rated ${a}–${b}`; };
      const grp = (key, name, g) => ({ key, name, sub: g.length ? range(g) : '', n: g.length, hi: g.map(q => q.hi), lo: g.map(q => q.lo) });
      SVT_CHARTS.groups($('#v-prof-rt'), { groups: [grp('upper', 'Higher English', up), grp('lower', 'Lower English', low)],
        label: `Mean reaction time for high- and low-typicality statements, students in the upper (n = ${up.length}) and lower (n = ${low.length}) half of English self-ratings (${cur.name.toLowerCase()})` });
      SVT_CHARTS.effect($('#v-prof-eff'), { points: cur.pts, fit: cur.eff, xLabel,
        label: `Typicality effect by English self-rating (${cur.name.toLowerCase()}), n = ${cur.pts.length}` + (cur.eff ? `, slope ${LAB.signed(cur.eff.b)} ms per point` : '') });
    } else { $('#v-prof-rt').innerHTML = none; $('#v-prof-eff').innerHTML = none; }
    $('#v-prof-cap').innerHTML = '<em>Lower vs higher English:</em> students split at the median of the chosen rating; the mean of their medians with 95% confidence intervals. ' +
      'If the two lines are not parallel, the typicality effect differs with English proficiency. ' +
      '<em>Typicality effect by English rating:</em> each student’s effect against their rating, with the least-squares line and its 95% band; its slope is the interaction, tested without splitting the class.' +
      (cur.test && isFinite(cur.test.p) ? ` Here: ${LAB.signed(cur.test.diff)} ms per rating point (${LAB.fmtTest(cur.test)}, <i>n</i> = ${cur.pts.length}).` : '');
    if (P.some(o => o.eff)) {
      SVT_CHARTS.slopes($('#v-prof-all'), P.map(o => ({ label: o.name, b: o.eff ? o.eff.b : NaN, lo: o.eff ? o.eff.ciB[0] : NaN, hi: o.eff ? o.eff.ciB[1] : NaN, p: o.test ? o.test.p : NaN,
        note: o.pts.length < 3 ? 'fewer than 3 students' : 'the ratings do not vary' })),
        { xLabel: 'Change in the typicality effect per rating point (ms)', xLabelShort: 'Change per rating point (ms)', label: 'For each English rating, the change in the typicality effect per rating point, with 95% confidence intervals' });
    } else $('#v-prof-all').innerHTML = P.some(o => o.pts.length >= 3) ? '<p class="empty">The ratings do not vary yet, so there is nothing to compare.</p>' : '<p class="empty">Needs at least 3 counted runs with English self-ratings.</p>';
    const slope = f => f ? LAB.signed(f.b) : '–';
    $('#v-prof-table').innerHTML =
      `<thead><tr><th scope="col">English rating</th><th class="num" scope="col">n</th><th class="num" scope="col">Mean (range)</th>` +
      `<th class="num sep" scope="col">High-typicality slope</th><th class="num" scope="col">Low-typicality slope</th>` +
      `<th class="num sep" scope="col">Interaction (ms per point)</th><th class="num" scope="col">95% CI</th>${tHead('')}</tr></thead><tbody>` +
      P.map(o => `<tr><th scope="row">${o.name}</th><td class="num">${o.pts.length}</td>` +
        `<td class="num">${o.xs.length ? LAB.mean(o.xs).toFixed(1) + ` (${+Math.min(...o.xs).toFixed(1)}–${+Math.max(...o.xs).toFixed(1)})` : '–'}</td>` +
        `<td class="num sep">${slope(o.hi)}</td><td class="num">${slope(o.lo)}</td>` +
        `<td class="num sep"><strong>${slope(o.eff)}</strong></td><td class="num">${o.eff ? fmtCI(o.eff.ciB) : '–'}</td>` +
        `${tCell(o.test)}${pCell(o.test)}${resultCell(o.test, 0)}</tr>`).join('') + '</tbody>';
    const M = P[0];
    if (M.test && isFinite(M.test.p)) items.push(item(M.test, `${lead('English proficiency × typicality', M.test)} The typicality effect changed by ${LAB.signed(M.test.diff)} ms per point of self-rated English, mean of five ${inline(`${LAB.fmtTest(M.test)}, <i>n</i> = ${M.pts.length}${smallTag(M.pts.length)}`)}; exploratory.`));
    else if (inc.length) items.push(item(null, `<strong>English proficiency × typicality: not enough rated runs yet.</strong> ${M.pts.length} so far; the test needs at least 3 with different ratings.`));
    $('#v-summary').innerHTML = items.join('');
  }
  $('#v-prof-skill').addEventListener('change', () => { lastKey = ''; render(); });

  function renderShapes(rows) {
    const inc = included(rows);
    const col = k => inc.map(r => num(r['round_' + k])).filter(isFinite);
    const pctOf = k => col(k).map(x => x * 100);
    const diffOf = (a, b) => inc.map(r => (num(r['round_' + a]) - num(r['round_' + b])) * 100).filter(isFinite);
    const cons = ['son', 'vcd', 'vcl'];
    const names = { son: 'm n l', vcd: 'b d g', vcl: 'p t k', back: 'u o', front: 'i e' };
    const pcTxt = k => { const a = col(k); return a.length ? Math.round(LAB.mean(a) * 100) + '%' : '–'; };
    const s1 = v => (v >= 0.05 ? '+' : v <= -0.05 ? '−' : '±') + Math.abs(v).toFixed(1);
    const pts = v => isFinite(v) ? s1(v) + '\u00a0pts' : '–';
    const ciPts = c => isFinite(c[0]) ? `${s1(c[0])}\u00a0to\u00a0${s1(c[1])}` : '–';

    // Paired comparisons (percentage points) and each sound class against chance.
    const C = [
      { a: 'back', b: 'front', name: 'Vowels', label: 'u o vs i e words' },
      { a: 'son', b: 'vcl', name: 'Consonants', label: 'm n l vs p t k words' },
      { a: 'son', b: 'vcd', label: 'm n l vs b d g words' },
      { a: 'vcd', b: 'vcl', label: 'b d g vs p t k words' }
    ].map(c => Object.assign(c, { r: LAB.ttest(diffOf(c.a, c.b), 0) }));
    const chance = ['back', 'front', 'son', 'vcd', 'vcl'].map(k => ({ k, r: LAB.ttest(pctOf(k), 50) }));

    const tile = c => `<div class="stat${kind(c.r, 1) === 'yes' ? ' key' : ''}"><span class="stat-label">${c.label}</span>` +
      `<span class="stat-value">${isFinite(c.r.m) ? s1(c.r.m) + '<small>pts</small>' : '–'}</span>` +
      `<span class="stat-note">${pcTxt(c.a)} vs ${pcTxt(c.b)} chose the round shape\u00a0· 95% CI ${ciPts(c.r.ci)}${small(inc.length)}</span>` +
      `<span class="stat-test">${testLine(c.r, 1)}</span></div>`;
    $('#s-stats').innerHTML = tile(C[0]) + tile(C[1]) +
      `<div class="stat"><span class="stat-label">Took part</span><span class="stat-value">${inc.length}</span><span class="stat-note">runs</span></div>`;

    const items = [];
    if (inc.length < 2) items.push(item(null, `<strong>Not enough runs yet.</strong> ${inc.length} so far; the tests need at least 2.`));
    else {
      const stats = r => isFinite(r.p) ? ' ' + inline(`${pts(r.m)}, ${LAB.fmtTest(r)}, <i>n</i>\u00a0=\u00a0${r.n}${smallTag(r.n)}`) : '';
      items.push(item(C[0].r, `${lead('Vowels', C[0].r, 1)} Words with u or o got the round shape ${pcTxt('back')} of the time, words with i or e ${pcTxt('front')}${stats(C[0].r)}.`));
      items.push(item(C[1].r, `${lead('Consonants', C[1].r, 1)} Words with m n l got the round shape ${pcTxt('son')} of the time, words with p t k ${pcTxt('vcl')}${stats(C[1].r)}; b d g words fell at ${pcTxt('vcd')}.`));
    }
    $('#s-summary').innerHTML = items.join('');

    if (!rows.length) { $('#s-plot').innerHTML = '<p class="empty">No runs yet for this class.</p>'; $('#s-table').innerHTML = ''; $('#s-tests').innerHTML = ''; return; }
    const ser = { a: [], b: [], aCI: [], bCI: [] };
    cons.forEach(c => {
      const a = col(c + '_back'), b = col(c + '_front');
      ser.a.push(LAB.mean(a)); ser.b.push(LAB.mean(b)); ser.aCI.push(LAB.ci95(a)); ser.bCI.push(LAB.ci95(b));
    });
    LAB.interactionPlot($('#s-plot'), ser, { width: 560, height: 360, ariaLabel: `Round-shape choices by consonant and vowel class, n = ${inc.length}` });
    const cell = k => { const a = col(k); return a.length ? Math.round(LAB.mean(a) * 100) + '%' : '–'; };
    $('#s-table').innerHTML = `<thead><tr><th scope="col">Consonants</th><th class="num" scope="col">u o</th><th class="num" scope="col">i e</th><th class="num" scope="col">Both</th></tr></thead><tbody>` +
      cons.map(c => `<tr><th scope="row">${names[c]}</th><td class="num">${cell(c + '_back')}</td><td class="num">${cell(c + '_front')}</td><td class="num"><strong>${cell(c)}</strong></td></tr>`).join('') +
      `<tr><th scope="row">All</th><td class="num"><strong>${cell('back')}</strong></td><td class="num"><strong>${cell('front')}</strong></td><td class="num">n = ${inc.length}</td></tr></tbody>`;
    const want = { back: 1, front: -1, son: 1, vcd: 0, vcl: -1 };
    $('#s-tests').innerHTML = `<thead><tr><th scope="col"></th><th class="num" scope="col">Estimate</th><th class="num" scope="col">95% CI</th>${tHead('')}</tr></thead><tbody>` +
      `<tr class="group"><th scope="rowgroup" colspan="6">Comparisons, in percentage points</th></tr>` +
      C.map(c => `<tr><th scope="row">${c.label}</th><td class="num"><strong>${pts(c.r.m)}</strong></td><td class="num">${ciPts(c.r.ci)}</td>${tCell(c.r)}${pCell(c.r)}${resultCell(c.r, 1)}</tr>`).join('') +
      `<tr class="group"><th scope="rowgroup" colspan="6">Round-shape choices against chance (50%)</th></tr>` +
      chance.map(c => `<tr><th scope="row">${names[c.k]} words</th><td class="num"><strong>${isFinite(c.r.m) ? Math.round(c.r.m) + '%' : '–'}</strong></td><td class="num">${isFinite(c.r.ci[0]) ? Math.round(c.r.ci[0]) + '%\u00a0to\u00a0' + Math.round(c.r.ci[1]) + '%' : '–'}</td>${tCell(c.r)}${pCell(c.r)}${resultCell(c.r, want[c.k])}</tr>`).join('') +
      '</tbody>';
  }

  /* ---------- bird task: typicality ratings → semantic map ----------
     The analysis of Bird plot.Rmd, run in the browser (bird-map.js): mean and
     SD per bird, then a PCA of the ratings; each bird sits at its loadings on
     the first two components. */
  const BM = window.BIRD_MAP;
  const birdState = { geom: null, load: null, session: '', w: 0, still: false };
  $('#b-csv').addEventListener('click', () => LAB.download(`lt5461-bird-ratings-${state.session}.csv`, LAB.toCSV(BM.formRows(state.rows.birds))));

  function renderBirds(rows) {
    // Until the first answer arrives the space stays reserved (no jump when it does).
    if (!state.fetched && LAB.connected()) return;
    $('#panel-birds').classList.remove('waiting');
    // A new class starts afresh; otherwise the map keeps its orientation.
    // The orientation is remembered per class on this device, so a reload
    // never shows the class a mirrored map.
    if (birdState.session !== state.session) {
      birdState.geom = null; birdState.session = state.session;
      birdState.load = (LAB.store.get('bird-orient', {}) || {})[state.session] || null;
    }
    const res = BM.analyse(rows, birdState.load);
    if (res.placed.length) {
      birdState.load = Object.fromEntries(res.placed.map(b => [b.key, [+b.pc1.toFixed(4), +b.pc2.toFixed(4)]]));
      const saved = LAB.store.get('bird-orient', {}) || {};
      delete saved[state.session];                       // most recent last, so it is kept
      saved[state.session] = birdState.load;
      LAB.store.set('bird-orient', Object.fromEntries(Object.entries(saved).slice(-12)));
    }
    const rated = res.birds.filter(b => b.n);
    const byMean = rated.slice().sort((x, y) => y.mean - x.mean || x.name.localeCompare(y.name));
    const f1 = v => isFinite(v) ? v.toFixed(1) : '–';
    const list = bs => bs.map(b => `${b.name} ${f1(b.mean)}`).join(', ');
    // The top (or bottom) k, and every bird tied with the k-th.
    const ends = (arr, k) => arr.filter(b => Math.abs(b.mean - arr[k - 1].mean) < 1e-9 || arr.indexOf(b) < k);

    // Summary
    const items = [];
    if (!res.n) items.push(item(null, '<strong>No runs yet for this class.</strong> Results appear here as students finish.'));
    else {
      const k = Math.max(1, Math.min(3, Math.floor(byMean.length / 2)));
      const top = ends(byMean, k), bottom = ends(byMean.slice().reverse(), k);
      if (byMean.length < 2) items.push(`<li><strong>Mean rating:</strong> ${list(byMean)} ${inline('1–5')}.</li>`);
      else if (byMean[0].mean - byMean[byMean.length - 1].mean < 1e-9) items.push(`<li><strong>Every bird has the same mean rating:</strong> ${f1(byMean[0].mean)} ${inline('1–5')}.</li>`);
      else if (top.length + bottom.length > byMean.length) items.push(`<li><strong>Mean ratings</strong> ${inline('1–5')}: ${list(byMean)}.</li>`);
      else {
        items.push(`<li><strong>Most typical:</strong> ${list(top)} ${inline('mean rating, 1–5')}.</li>`);
        items.push(`<li><strong>Least typical:</strong> ${list(bottom)}.</li>`);
      }
      const bySd = rated.filter(b => isFinite(b.sd)).sort((x, y) => y.sd - x.sd || x.name.localeCompare(y.name));
      if (bySd.length) items.push(`<li><strong>Most disagreement:</strong> ${bySd.slice(0, 2).map(b => `${b.name} ${inline('SD ' + b.sd.toFixed(2))}`).join(' and ')}.</li>`);
      items.push(res.placed.length
        ? `<li><strong>The map</strong> shows ${BM.pct(res.shares[0] + res.shares[1])} of the variation in the ratings: ${BM.pct(res.shares[0])} on component 1 and ${BM.pct(res.shares[1])} on component 2 ${inline(`<i>n</i> = ${res.n}`)}.</li>`
        : `<li><strong>The map needs at least ${BM.MIN_N} runs.</strong> ${res.n} so far.</li>`);
    }
    $('#b-summary').innerHTML = items.join('');

    // Map
    const host = $('#b-map');
    birdState.w = $('#panel-birds').clientWidth;
    if (res.placed.length < 2) {
      host.innerHTML = `<p class="empty">${res.n ? `The map appears once ${BM.MIN_N} students have finished; ${res.n} so far.` : 'No runs yet for this class.'}</p>`;
      birdState.geom = null;
    } else {
      const right = res.placed.slice().sort((x, y) => y.pc1 - x.pc1);
      birdState.geom = BM.draw(host, res, {
        width: host.clientWidth || birdState.w, prev: birdState.geom, still: birdState.still,
        ariaLabel: `Map of the birds on principal components 1 (${BM.pct(res.shares[0])} of variance) and 2 (${BM.pct(res.shares[1])}), n = ${res.n}. ` +
          `From right to left on component 1: ${right.map(b => b.name).join(', ')}.`
      });
    }
    birdState.still = false;
    $('#b-off').textContent = res.off.length && res.placed.length
      ? 'Not on the map: ' + res.off.map(b => `${b.name} (${b.why})`).join('; ') + '.' : '';

    // Table, most typical first; the swatch is the dot's colour on the map.
    const P = res.placed, lo = Math.min(...P.map(b => b.mean)), hi = Math.max(...P.map(b => b.mean));
    const sw = b => P.includes(b) ? `<span class="swatch" style="background:${BM.fillAt(hi > lo ? (b.mean - lo) / (hi - lo) : 0.5)}" aria-hidden="true"></span>` : '<span class="swatch" style="visibility:hidden" aria-hidden="true"></span>';
    $('#b-table').innerHTML = !rated.length ? '' :
      `<thead><tr><th scope="col">Bird</th><th class="num" scope="col">Mean</th><th class="num" scope="col">SD</th><th class="num" scope="col"><i>n</i></th>` +
      `<th class="num sep" scope="col">PC1</th><th class="num" scope="col">PC2</th></tr></thead><tbody>` +
      byMean.map(b => `<tr><th scope="row">${sw(b)}${b.name}</th><td class="num"><strong>${b.mean.toFixed(2)}</strong></td><td class="num">${BM.fmt2(b.sd)}</td><td class="num">${b.n}</td>` +
        `<td class="num sep">${BM.fmt2(b.pc1)}</td><td class="num">${BM.fmt2(b.pc2)}</td></tr>`).join('') + '</tbody>';
  }

  if (!LAB.connected()) $('#not-connected').hidden = false;
  // Count the seconds while the first answer is awaited, so a slow start
  // is visibly different from a page that is not running.
  const t0 = Date.now();
  state.waitTimer = setInterval(() => {
    if (/^Connecting/.test($('#status .label').textContent)) setStatus(`Connecting… ${Math.round((Date.now() - t0) / 1000)} s`, false);
  }, 1000);
  // Reopen the last tab viewed. This must run after everything above is
  // defined, because selecting a tab draws it.
  const savedTab = LAB.store.get('dash-tab', null);
  const saved = tabs.find(t => t.id === savedTab);
  if (saved && saved !== tabs[0]) selectTab(saved);
  loadSessions();
  refresh();
  schedule();
})();
