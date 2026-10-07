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
     fast-analysis.js; charts: fast-charts.js; model fitting: fast-worker.js).
     The page answers two primary questions and one related one:
       A  Do one-step transition probabilities differ between the languages?
          Main test: the joint (2-df) Wald test of Language and Language ×
          Previous state in the logistic transition model.
       B  Do the valence trajectories over the ten answers differ?
          Main test: the joint test of Language × Position and Language ×
          Position² in the quadratic trajectory model; the description comes
          from the model's predictions at answers 1, 5 and 10.
          Within B: does the starting word's influence fade differently?
          (Language × Seed valence × log2 position in the starting-word model.)
     then secondary results, exploratory proficiency, robustness, methods.
     Every sentence is written from the current class's numbers. */
  const FA = window.FAST_ANALYSIS, STIM = window.FAST_STIMULI, FC = window.FAST_CHARTS;
  const fastState = { norms: null, loading: null, error: '', fitKey: '', fits: {}, parts: [], ctx: null, robust: null, robustKey: '' };
  const STATE_NAME = { N: 'negative', U: 'neutral', P: 'positive' };
  const LANG_NAME = { zh: 'Chinese', en: 'English' };
  const CATS = ['negative', 'neutral', 'positive'];
  const LANGT = 'Language (English − Chinese)', PREV = 'Language × previous state';
  // Probabilities in APA style (no leading zero); signed numbers with U+2212.
  const p2 = v => isFinite(v) ? (v < 0 ? '−' : '') + Math.abs(v).toFixed(2).replace(/^0/, '') : '–';
  const p3 = v => isFinite(v) ? (v < 0 ? '−' : '') + Math.abs(v).toFixed(3).replace(/^0/, '') : '–';
  const pr2 = v => isFinite(v) ? (v <= -0.005 ? '−' : v >= 0.005 ? '+' : '') + Math.abs(v).toFixed(2).replace(/^0/, '') : '–';
  const b1 = v => isFinite(v) ? (v <= -0.05 ? '−' : '') + Math.abs(v).toFixed(1) : '–';
  const b2 = v => isFinite(v) ? (v <= -0.005 ? '−' : '') + Math.abs(v).toFixed(2) : '–';
  const s1 = v => isFinite(v) ? (v <= -0.05 ? '−' : v >= 0.05 ? '+' : '') + Math.abs(v).toFixed(1) : '–';
  const s2 = v => isFinite(v) ? (v <= -0.005 ? '−' : v >= 0.005 ? '+' : '') + Math.abs(v).toFixed(2) : '–';
  const b3 = v => isFinite(v) ? (v <= -0.0005 ? '−' : v >= 0.0005 ? '+' : '') + Math.abs(v).toFixed(3) : '–';
  const pct0 = v => isFinite(v) ? Math.round(v * 100) + '%' : '–';
  const pct1 = v => isFinite(v) ? (v * 100).toFixed(1) + '%' : '–';
  const ppts = v => isFinite(v) ? (v <= -0.0005 ? '−' : v >= 0.0005 ? '+' : '') + Math.abs(v * 100).toFixed(1) : '–';
  const sec1 = v => isFinite(v) ? v.toFixed(1) + ' s' : '–';
  const dfShow = df => df >= 1000 ? Math.round(df).toLocaleString('en-US') : df >= 100 || Math.abs(df - Math.round(df)) < 1e-9 ? String(Math.round(df)) : df.toFixed(1);
  // One shape for every estimate: a model term or contrast ({b, ci, stat, df,
  // p}), a marginal prediction ({est, lo, hi, z, p}) or a paired t-test.
  const U = r => !r ? null : 'est' in r ? Object.assign({ stat: r.z, df: null }, r) : { est: r.b, lo: r.ci[0], hi: r.ci[1], se: r.se, stat: r.stat, df: r.df, p: r.p };
  const ttE = T => T && isFinite(T.t) ? { est: T.m, lo: T.ci[0], hi: T.ci[1], stat: T.t, df: T.df, p: T.p } : null;
  const scaleE = (e, k) => e && { est: e.est * k, lo: Math.min(e.lo * k, e.hi * k), hi: Math.max(e.lo * k, e.hi * k), stat: e.stat, df: e.df, p: e.p };
  const asT = e => e ? { p: e.p, diff: e.est, t: e.stat } : null;
  const statTxt = e => !e || !isFinite(e.stat) ? '' : (e.df ? `<i>t</i>(${dfShow(e.df)}) = ${b2(e.stat)}` : `<i>z</i> = ${b2(e.stat)}`) + `, ${LAB.fmtP(e.p)}`;
  const wTxt = w => !w ? '' : (w.kind === 'F' ? `<i>F</i>(${w.q}, ${dfShow(w.ddf)}) = ${w.F.toFixed(2)}` : `χ²(${w.q}) = ${w.chi2.toFixed(2)}`) + `, ${LAB.fmtP(w.p)}`;
  const fine = (fmt, v) => isFinite(v) && v !== 0 && !/[1-9]/.test(fmt(v)) ? (v < 0 ? '−' : '+') + (fmt === pr2 ? Math.abs(v).toFixed(3).replace(/^0/, '') : Math.abs(v).toFixed(3)) : fmt(v);
  const eTxt = (e, fmt, unit) => e ? `${fmt(e.est)}${unit ? '\u00a0' + unit : ''} [${fine(fmt, e.lo)}, ${fine(fmt, e.hi)}]` : '–';
  // "Clear evidence": joint p < .05 for an omnibus test; a 95% CI that excludes 0 for an estimate.
  const clearW = w => !!w && isFinite(w.p) && w.p < 0.05;
  const clearCI = e => !!e && isFinite(e.lo) && isFinite(e.hi) && (e.lo > 0 || e.hi < 0);
  const fig = (host, heading, level) => {
    const f = document.createElement('figure');
    f.className = 'figure';
    const h = 'h' + (level || 3);
    f.innerHTML = `<${h}>${heading}</${h}><div></div>`;
    host.appendChild(f);
    return f.querySelector('div');
  };
  const cm = (f, name) => f && f.cm ? f.cm(name) : 0;
  const WHY = { few: 'Too few runs to test', separation: 'Not estimable yet', converge: 'Model did not converge', novar: 'No variation to test', dropped: 'Not estimable yet' };
  const whyNot = f => !f ? 'Fitting the model…' : f.ok ? '' : WHY[f.reason] || 'Not estimable yet';
  // One result: its status (primary, follow-up, …), the answer in words, then the numbers.
  const rTxt = p => `<td class="result">${isFinite(p) ? (p < 0.05 ? '<span class="verdict-txt">Clear evidence</span>' : '<span class="verdict-txt no">No clear evidence</span>') : '–'}</td>`;
  const res = (kind, sent, stat, cls) => `<li${cls ? ` class="${cls}"` : ''}>${kind ? `<span class="r-kind">${kind}</span>` : ''}<p class="r-sent">${sent}</p>${stat ? `<p class="r-stat">${stat}</p>` : ''}</li>`;
  const pending = f => `<li><p class="r-sent muted">${whyNot(f)}</p></li>`;

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
  $('#a-prof-measure').addEventListener('change', () => { lastKey = ''; render(); });
  // Downloads keep every student, marked with whether they are analysed and, if not, why.
  const withExclusion = rs => rs.map(r => { const k = r.pid + '|' + r.session, E = fastState.excl;
    const why = E ? [E.extreme.has(k) && 'repetition', E.l1.has(k) && 'l1'].filter(Boolean) : [];
    return Object.assign(r, { analysed: why.length ? 0 : 1, excluded_for: why.join(';') || 'NA' }); });
  $('#a-csv-answers').addEventListener('click', () => LAB.download(`lt5461-association-answers-${state.session}.csv`, LAB.toCSV(withExclusion(FA.responseRows(fastState.allParts || [])))));
  $('#a-csv-transitions').addEventListener('click', () => LAB.download(`lt5461-association-transitions-${state.session}.csv`, LAB.toCSV(withExclusion(FA.transitionRows(fastState.allParts || [])))));
  $('#a-robust-more').addEventListener('toggle', () => { if ($('#a-robust-more').open) runRobust(); });
  $('#a-m3-loso-more').addEventListener('toggle', () => { if ($('#a-m3-loso-more').open) runLoso(); });
  // the exploratory mechanism models are fitted only once someone opens that section
  $('#a-mech-more').addEventListener('toggle', () => { if ($('#a-mech-more').open) { renderLex(); runMech(); renderMech(); } });

  // Observed transition probabilities: a 2 × 2 table per language.
  function tmTable(m, lang) {
    const cell = (a, b) => { const p = m.probs[a][b]; return isFinite(p) ? `<td style="--p:${p.toFixed(3)}">${p2(p)}</td>` : '<td>–</td>'; };
    return `<table class="tm"><caption>${LANG_NAME[lang]} <span class="n">${m.n.toLocaleString('en-US')} transitions</span></caption>` +
      `<thead><tr><th scope="col"><span class="visually-hidden">Previous answer</span></th><th scope="col">Next negative</th><th scope="col">Next positive</th></tr></thead><tbody>` +
      ['N', 'P'].map(a => `<tr><th scope="row">Previous ${STATE_NAME[a]}</th>${cell(a, 'N')}${cell(a, 'P')}</tr>`).join('') + '</tbody></table>';
  }
  // The same, with counts, for the fold-out (two and three states).
  function matrixTable(tr, lang, states) {
    const m = FA.matrix(tr.filter(t => t.lang === lang), states);
    const cell = (a, b) => {
      const p = m.probs[a][b];
      return isFinite(p) ? `<td style="--p:${p.toFixed(3)}"><b>${p2(p)}</b><i class="visually-hidden">, </i><span class="cnt-long">${m.counts[a][b].toLocaleString('en-US')} of ${m.rowN[a].toLocaleString('en-US')}</span><span class="cnt-short" aria-hidden="true">${m.counts[a][b].toLocaleString('en-US')}/${m.rowN[a].toLocaleString('en-US')}</span></td>`
        : `<td class="undef"><b>–</b><span>none from here</span></td>`;
    };
    return `<div><h4>${LANG_NAME[lang]} <span class="n">${m.n.toLocaleString('en-US')} transition${m.n === 1 ? '' : 's'}</span></h4>` +
      `<table class="matrix"><caption class="visually-hidden">${LANG_NAME[lang]}: probability of the next answer's state given the previous answer's state</caption>` +
      `<colgroup><col class="head">${states.map(() => '<col>').join('')}</colgroup>` +
      `<thead><tr><th scope="col"><span class="visually-hidden">Previous answer</span></th>${states.map(b => `<th scope="col">to ${STATE_NAME[b]}</th>`).join('')}</tr></thead><tbody>` +
      states.map(a => `<tr><th scope="row">from ${STATE_NAME[a]}</th>${states.map(b => cell(a, b)).join('')}</tr>`).join('') + '</tbody></table></div>';
  }

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
    // Only runs made with the current starting words: an earlier set may share
    // some ids, and its runs would be read half-way.
    const other = rows.filter(r => r.stim_version !== STIM.version).length;
    rows = rows.filter(r => r.stim_version === STIM.version);
    const allParts = FA.participants(rows, STIM, fastState.norms);
    // Exclusion criteria, applied before any analysis (the robustness column "All students" shows the analysis without them).
    const EX = exclusions(allParts);
    const parts = allParts.filter(Pp => !EX.any.has(Pp.key));
    rows = rows.filter(r => !EX.any.has(r.pid + '|' + r.session));
    fastState.parts = parts; fastState.allParts = allParts; fastState.excl = EX;
    const n = parts.length;
    renderSample(EX, allParts.length, n);
    if (!n) {
      $('#a-summary').innerHTML = '<li class="plain"><strong>' + (allParts.length ? 'No student meets the inclusion criteria yet.' : 'No runs yet for this class.') + '</strong> Results appear here as students finish.' +
        (other ? ` (${other} run${other > 1 ? 's' : ''} used an earlier set of starting words and ${other > 1 ? 'are' : 'is'} not shown.)` : '') + '</li>';
      $('#a-other').textContent = ''; $('#a-datanote').textContent = '';
      $('#a-body').hidden = true;
      return;
    }
    $('#a-body').hidden = false;
    $('#a-body').classList.toggle('few', n < 3);

    const tr2 = FA.transitions(parts, FA.state2), tr3 = FA.transitions(parts, FA.state3), ans = FA.answers(parts);
    const P = { zh: FA.matrix(tr2.filter(t => t.lang === 'zh'), FA.STATES2), en: FA.matrix(tr2.filter(t => t.lang === 'en'), FA.STATES2) };
    const nPos = STIM.responsesPerSeed;

    // ---- A: observed transition probabilities, and their counts ----
    $('#a-tm').innerHTML = tmTable(P.zh, 'zh') + tmTable(P.en, 'en');
    $('#a-matrices').innerHTML = matrixTable(tr2, 'zh', FA.STATES2) + matrixTable(tr2, 'en', FA.STATES2);
    $('#a-matrices3').innerHTML = matrixTable(tr3, 'zh', FA.STATES3) + matrixTable(tr3, 'en', FA.STATES3);
    $('#a-m3-n').textContent = ` (${tr3.length.toLocaleString('en-US')})`;
    // timing: each student's medians, and the robust rule's flags (for the sensitivity analysis only)
    const trows = FA.timingRows(rows), tOut = FA.timingOutliers(trows);
    renderSample(EX, allParts.length, n, { trans: tr2.length, tOn: tOut.onset.n, tTot: tOut.total.n, fOn: tOut.onset.flagged.size, fTot: tOut.total.flagged.size });
    renderStateShares(parts);

    // ---- B: observed trajectories after each kind of starting word ----
    const reps = FA.repetitions(parts), mv = FA.meanValence(parts), per = FA.perParticipant(parts);
    const traj = FA.trajectories(parts, nPos);
    const stat = arr => ({ m: LAB.mean(arr), ci: ci3(arr), n: arr.length });
    const TS = {};
    CATS.forEach(c => { TS[c] = { zh: traj.zh[c].map(stat), en: traj.en[c].map(stat) }; });
    const tv = CATS.flatMap(c => ['zh', 'en'].flatMap(l => TS[c][l].flatMap(s => [s.m, s.ci[0], s.ci[1]]))).filter(isFinite);
    const tDom = [Math.max(1, Math.floor(Math.min(4, ...tv))), Math.min(9, Math.ceil(Math.max(6, ...tv)))];
    const th = $('#a-traj');
    th.innerHTML = '';
    CATS.forEach(c => {
      const ends = l => { const a = TS[c][l]; return `${LANG_NAME[l]} from ${b2(a[0] && a[0].m)} to ${b2(a[nPos - 1] && a[nPos - 1].m)}`; };
      FC.trajectory(fig(th, `${cap(c)} starting words`, 5), TS[c], nPos, tDom, `Observed mean valence by answer position after ${c} starting words: ${ends('zh')}, ${ends('en')}`);
    });
    const tcell = d => d && isFinite(d.m) ? `<td class="num">${d.m.toFixed(2)}${isFinite(d.ci[0]) ? `<span class="ci">${d.ci[0].toFixed(2)}–${d.ci[1].toFixed(2)}</span>` : ''}</td>` : '<td class="num">–</td>';
    $('#a-traj-table').innerHTML = `<thead><tr><th scope="col" rowspan="2">Answer</th>${CATS.map(c => `<th scope="colgroup" colspan="2" class="sep">${cap(c)} starting words</th>`).join('')}</tr>` +
      `<tr>${'<th class="num sep" scope="col">Chinese</th><th class="num" scope="col">English</th>'.repeat(3)}</tr></thead><tbody>` +
      Array.from({ length: nPos }, (_, k) => `<tr><th scope="row">${k + 1}</th>${CATS.map(c => tcell(TS[c].zh[k]).replace('<td class="num">', '<td class="num sep">') + tcell(TS[c].en[k])).join('')}</tr>`).join('') + '</tbody>';
    const tn = CATS.flatMap(c => ['zh', 'en'].flatMap(l => TS[c][l].map(d => d.n)));
    $('#a-traj-note').textContent = `Observed mean valence (1–9) of the answers at each position${n >= 3 ? ', with its 95% CI across students below' : ''}. Each mean is over ${Math.min(...tn)}${Math.max(...tn) > Math.min(...tn) ? '–' + Math.max(...tn) : ''} students with a scored answer there.`;
    const pooled = (cat, lang, key) => { const m = FA.matrix(tr2.filter(t => t.lang === lang && (cat === 'all' || t.category === cat)), FA.STATES2); return m.probs[key][key]; };
    const meanV = (cat, lang) => LAB.mean(mv.map(x => x[lang][cat]).filter(isFinite));
    const repRate = (cat, lang) => { const s = reps.reduce((a, x) => [a[0] + x[lang][cat][0], a[1] + x[lang][cat][1]], [0, 0]); return s[1] ? s[0] / s[1] : NaN; };
    const pair = (f, fmt) => `<td class="num sep">${fmt(f('zh'))}</td><td class="num">${fmt(f('en'))}</td>`;
    $('#a-bycat').innerHTML =
      `<thead><tr><th scope="col" rowspan="2">Starting words</th><th scope="colgroup" colspan="2" class="sep">Staying negative</th><th scope="colgroup" colspan="2" class="sep">Staying positive</th>` +
      `<th scope="colgroup" colspan="2" class="sep">Valence of the answers</th><th scope="colgroup" colspan="2" class="sep">Repeated answers</th></tr>` +
      `<tr>${'<th class="num sep" scope="col">Chinese</th><th class="num" scope="col">English</th>'.repeat(4)}</tr></thead><tbody>` +
      CATS.concat('all').map(cat => `<tr><th scope="row">${cat === 'all' ? '<strong>All</strong>' : cap(cat)}</th>` +
        pair(l => pooled(cat, l, 'N'), p2) + pair(l => pooled(cat, l, 'P'), p2) + pair(l => meanV(cat, l), b2) + pair(l => repRate(cat, l), pct1) + '</tr>').join('') + '</tbody>';

    // ---- C: repeated answers and response times, per student (paired) ----
    const rate = (x, lang) => x[lang].all[1] ? x[lang].all[0] / x[lang].all[1] : NaN;
    const rz = reps.map(x => rate(x, 'zh')), re = reps.map(x => rate(x, 'en'));
    const repeat = { zh: LAB.mean(rz.filter(isFinite)), en: LAB.mean(re.filter(isFinite)), test: gate(LAB.ttest(re.map((v, i) => v - rz[i]).filter(isFinite), 0)) };
    // Most students repeat nothing and a few repeat almost everything: counts of students in bands of repetition.
    const BANDS = [['0%', 0], ['1%', 0.015], ['2%', 0.025], ['3–5%', 0.055], ['6–10%', 0.105], ['11–25%', 0.255], ['26–50%', 0.505], ['51–100%', Infinity]];
    const band = v => v === 0 ? 0 : BANDS.findIndex(([, up], k) => k > 0 && v < up);
    const bandRows = BANDS.map(([label], k) => ({ label, zh: rz.filter(v => isFinite(v) && band(v) === k).length, en: re.filter(v => isFinite(v) && band(v) === k).length }));
    FC.mirror($('#a-repeats'), bandRows, { head: 'Repeated',
      label: `Number of students by share of repeated answers. ${bandRows.map(r => `${r.label}: ${r.zh} in Chinese, ${r.en} in English`).join('; ')}` });
    $('#a-repeats-means').textContent = isFinite(repeat.zh) && isFinite(repeat.en) ? ` Class means: ${pct1(repeat.zh)} in Chinese, ${pct1(repeat.en)} in English.` : '';
    const tz = rows.map(r => num(r.rt_median_zh) / 1000), te = rows.map(r => num(r.rt_median_en) / 1000);
    const okRT = tz.map((v, i) => isFinite(v) && isFinite(te[i]));
    const rt = { zh: LAB.mean(tz.filter((v, i) => okRT[i])), en: LAB.mean(te.filter((v, i) => okRT[i])), test: gate(LAB.ttest(te.map((v, i) => v - tz[i]).filter((v, i) => okRT[i]), 0)) };
    // each student's medians on a log scale (as the models use), every value at its own place; flagged values open
    const geo = a => { const lg = a.map(Math.log), c = ci3(lg); return { m: Math.exp(LAB.mean(lg)), ci: [Math.exp(c[0]), Math.exp(c[1])] }; };
    const drawRT = (host, measure, name) => {
      const by = new Map();
      trows.forEach(t => { if (t[measure] > 0) { const o = by.get(t.pid) || {}; o[t.lang] = t[measure]; by.set(t.pid, o); } });
      const pairs = [...by].filter(([, o]) => o.zh > 0 && o.en > 0).map(([pid, o]) => ({ zh: o.zh, en: o.en, flag: { zh: tOut[measure].flagRows.has(pid + '|zh'), en: tOut[measure].flagRows.has(pid + '|en') } }));
      if (!pairs.length) { host.innerHTML = '<p class="empty">No timing data yet.</p>'; return; }
      const g = { zh: geo(pairs.map(q => q.zh)), en: geo(pairs.map(q => q.en)) };
      FC.paired(host, pairs, { log: true, ticks: [0.5, 1, 1.5, 2, 3, 5, 10, 20, 30, 60], tick: v => v + ' s', fmt: v => v.toFixed(2) + ' s', meanName: 'geometric mean',
        flagNote: 'flagged by the robust timing rule: in the primary model, left out of the sensitivity analysis', mean: g,
        label: `${name}: each student’s median time per answer on a log scale; geometric means ${sec1(g.zh.m)} in Chinese and ${sec1(g.en.m)} in English; ${pairs.filter(q => q.flag.zh || q.flag.en).length} student(s) with a flagged value, drawn open` });
    };
    drawRT($('#a-rto'), 'onset', 'Onset'); drawRT($('#a-rt'), 'total', 'Total time');
    const nfo = tOut.onset.flagRows.size, nft = tOut.total.flagRows.size;
    $('#a-rt-flag').textContent = nfo || nft ? `Open circles: values flagged by the prespecified robust timing rule (${nfo} onset, ${nft} total); they are in the primary timing models and left out only of the sensitivity analysis.` : 'No value is flagged by the robust timing rule.';
    const second = [
      ['Repeated answers', ttE(repeat.test), repeat.test, e => clearCI(e) ? `Repetition was ${e.est > 0 ? 'more' : 'less'} frequent in English by <b>${ppts(Math.abs(e.est)).replace('+', '')}</b> percentage points [${ppts(Math.min(Math.abs(e.lo), Math.abs(e.hi))).replace('+', '')}, ${ppts(Math.max(Math.abs(e.lo), Math.abs(e.hi))).replace('+', '')}]` : `No clear language difference in repetition (English − Chinese ${ppts(e.est)} percentage points [${ppts(e.lo)}, ${ppts(e.hi)}])`, `${pct1(repeat.zh)} of Chinese and ${pct1(repeat.en)} of English answers repeated an earlier word of the chain`]
    ];
    const sec = $('#a-secondary');
    sec.innerHTML = second.map(([name, e, T, say, extra], i) => `<div class="est-row"><span class="er-name">${name}</span><div class="er-chart" id="a-er-${i}"></div>` +
      `<p class="er-text">${e ? `${say(e)}; ${statTxt(e)}${smallTag(n)}. <span class="muted">Observed: ${extra}.</span>` : `${T.reason === 'novar' ? 'No variation to test' : 'Too few runs to test'}. <span class="muted">Observed: ${extra}.</span>`}</p></div>`).join('');
    second.forEach(([name, e], i) => { if (e) FC.estimate($('#a-er-' + i), { est: e.est, lo: e.lo, hi: e.hi, clear: clearCI(e), label: `${name}, English − Chinese, with 95% CI` }); });

    // ---- per student: the starting word's valence, by language (kept in the full tests) ----
    const both = mv.map(x => ({ zh: x.zh.positive - x.zh.negative, en: x.en.positive - x.en.negative })).filter(d => isFinite(d.zh) && isFinite(d.en));
    const polarity = { zh: LAB.mean(both.map(d => d.zh)), en: LAB.mean(both.map(d => d.en)), test: gate(LAB.ttest(both.map(d => d.en - d.zh), 0)) };

    // ---- Exploratory: English proficiency (the observed part) ----
    // Each student's own English − Chinese difference, for the plot's dots. The
    // tests come from the proficiency mixed models (runProf, renderProf).
    const valueOf = (i, k, lang) => k === 'V' ? mv[i][lang].all : per[i].lang[lang][k];
    const PROF = {};
    Object.keys(MEAS).forEach(k => { PROF[k] = per.map((p, i) => ({ x: p.prof.en_overall, y: valueOf(i, k, 'en') - valueOf(i, k, 'zh') })).filter(q => isFinite(q.x) && isFinite(q.y)); });

    // ---- data quality ----
    const cov = lang => {
      const L = per.map(p => p.lang[lang]).filter(q => q.answers);
      const sum = k => L.reduce((s, q) => s + q[k], 0);
      const share = (a, b) => L.map(q => q[b] ? q[a] / q[b] : NaN).filter(isFinite);
      return { n: L.length, scored: sum('scored') / sum('answers'), valid: sum('valid') / sum('possible'), validN: sum('valid'),
        sRange: share('scored', 'answers'), vRange: share('valid', 'possible') };
    };
    const C = { zh: cov('zh'), en: cov('en') };
    // students who repeated an earlier word in more than half of their answers in a language
    const repOut = ['zh', 'en'].map(l => ({ l, n: reps.filter(x => rate(x, l) > 0.5).length })).filter(o => o.n);
    const range = a => a.length ? `${pct0(Math.min(...a))}–${pct0(Math.max(...a))} per student` : '';
    const meter = (l, label, v, note) => `<div class="meter"><span>${label}</span><span class="meter-track" role="img" aria-label="${label}: ${pct0(v)}"><span class="meter-fill ${l}" style="display:block;width:${Math.round(v * 100)}%"></span></span><span class="v">${pct0(v)}</span></div><div class="meter-note">${note}</div>`;
    $('#a-coverage').innerHTML = ['zh', 'en'].map(l => `<div><div class="meter-lang">${LANG_NAME[l]}</div>` +
      meter(l, 'Answers scored', C[l].scored, range(C[l].sRange)) +
      meter(l, 'Valid transitions', C[l].valid, `${C[l].validN.toLocaleString('en-US')} transitions · ${range(C[l].vRange)}`) + '</div>').join('') +
      (repOut.length ? `<p class="small column rep-flag">${repOut.map((o, i) => `${i ? 'in' : 'In'} ${LANG_NAME[o.l]}, ${o.n}\u00a0student${o.n > 1 ? 's' : ''} repeated an earlier word in more than half of their answers`).join('; ')}. Their answers are kept in the main analysis; the robustness checks and the exploratory analyses also show results without them. See “Show individual data” under C.</p>` : '');
    const lowL = C.zh.valid <= C.en.valid ? 'zh' : 'en', hiL = lowL === 'zh' ? 'en' : 'zh';
    const gapCov = pct0(C.zh.valid) !== pct0(C.en.valid);
    const dqText = `Normative-valence coverage: ${pct0(C.zh.scored)} of Chinese and ${pct0(C.en.scored)} of English answers could be scored, and ${pct0(C.zh.valid)} and ${pct0(C.en.valid)} of possible transitions are usable.` +
      (repOut.length ? ` ${repOut.map((o, i) => `${i ? 'in' : 'In'} ${LANG_NAME[o.l]}, ${o.n}\u00a0student${o.n > 1 ? 's' : ''} repeated an earlier word in more than half of their answers`).join('; ')}.` : '');

    // ---- the models: fitted in the worker, after everything above is drawn ----
    const seeds = new Map();
    parts.forEach(Pp => Pp.chains.forEach(c => { if (isFinite(c.seedValence)) seeds.set(c.lang + ':' + c.id, c); }));
    const catMean = cat => LAB.mean([...seeds.values()].filter(c => c.category === cat).map(c => c.seedValence));
    const dSV = catMean('positive') - catMean('negative');
    // ---- checks on the analysed students (the exclusions are in EX) ----
    // Nobody left in the sample meets an exclusion rule, so the exploratory "without …" comparisons fall away.
    const extreme = new Set(), l1Flag = new Set();
    const qc = {
      missingBg: parts.filter(Pp => !isFinite(Pp.eng_age) || !isFinite(Pp.en_use) || !isFinite(Pp.prof.en_overall) || !isFinite(Pp.prof.zh_overall)).length,
      noType: per.filter(q => ['zh', 'en'].some(l => !q.lang[l].nN || !q.lang[l].nP)).length
    };
    // lexical reuse, per student and language, under three response keys (exploratory)
    const lex = { norm: FA.lexicalByStudent(parts, 'norm'), raw: FA.lexicalByStudent(parts, 'raw'), lemma: FA.lexicalByStudent(parts, 'lemma') };
    fastState.ctx = { other, n, P, C, polarity, repeat, rt, PROF, tr2, tr3, ans, parts, nPos, gapCov, lowL, hiL, dSV, dqText, extreme, l1Flag, qc, lex, rows, EX, allN: allParts.length, trows, tOut };
    renderQC();
    renderLex();
    $('#a-print-title').textContent = `Association task · ${$('#session').selectedOptions[0] ? $('#session').selectedOptions[0].textContent.replace(/\s*\(\d+\)$/, '') : state.session}`;
    const fitKey = JSON.stringify([state.session, parts.map(x => x.key)]);
    // New runs: the last results stay on screen, marked as updating, until the
    // new fits are all in (a different class starts afresh). Then the
    // robustness checks are fitted again, in their own worker.
    const fresh = fitKey !== fastState.fitKey;
    if (fresh) {
      const sameClass = fastState.session === state.session && Object.keys(fastState.fits).length > 0;
      fastState.fitKey = fitKey; fastState.session = state.session; fastState.updating = sameClass;
      if (!sameClass) { fastState.fits = {}; fastState.robust = null; fastState.robustNext = null; fastState.robustKey = ''; fastState.m3 = null; fastState.extras = null; }
    }
    $('#a-updating').hidden = !fastState.updating;
    renderFastModels();
    if (!fresh) return;
    // the timing sensitivity models: the same specification, without the students the robust rule flags for that measure
    const tSub = m => trows.filter(t => !tOut[m].flagged.has(t.pid));
    const got = {}, jobs = [{ key: 'A', model: 'A', tr: tr2 }, { key: 'C', model: 'C', ans }, { key: 'B', model: 'B', ans }, { key: 'C1', model: 'C1', tr: tr2 }, { key: 'C1Q', model: 'C1Q', tr: tr2 },
      { key: 'TO', model: 'T', trows, measure: 'onset' }, { key: 'TT', model: 'T', trows, measure: 'total' },
      { key: 'TOx', model: 'T', trows: tSub('onset'), measure: 'onset' }, { key: 'TTx', model: 'T', trows: tSub('total'), measure: 'total' }];
    // The three-state model takes longest, so it has a worker of its own; its checks follow it.
    fitJobs('m3', [{ key: 'M3', model: 'M3', tr: tr3 }], (key, f) => {
      if (fastState.fitKey !== fitKey) return;
      fastState.m3 = f; fastState.m3Key = fitKey;
      renderFastModels();
      runExtras();
      if ($('#a-m3-loso-more').open) runLoso();
    });
    fitJobs('main', jobs, (key, f) => {
      if (fastState.fitKey !== fitKey) return;
      got[key] = f;
      if (!fastState.updating) fastState.fits[key] = f;
      if (Object.keys(got).length === jobs.length) {
        fastState.fits = got; fastState.updating = false;
        $('#a-updating').hidden = true;
        runRobust();
        runProf();
        runExtras();
      }
      renderFastModels();
    });
  }

  /* ---------- Exploratory: English proficiency (mixed models) ----------
     For each English self-rating, the transition and valence models are
     refitted with the rating (centred) and its interactions with language,
     and by-student random slopes for the language terms. The overall rating
     is primary (three tests); the four skills are follow-ups, judged on
     Benjamini–Hochberg adjusted p-values across their twelve tests. */
  const SKILL = { overall: 'Overall', listening: 'Listening', speaking: 'Speaking', reading: 'Reading', writing: 'Writing' };
  const MEAS = { NN: 'Staying negative', PP: 'Staying positive', V: 'Mean valence' };
  const MEASW = { NN: 'staying negative', PP: 'staying positive', V: 'mean valence' };
  const PUNIT = { NN: 'log-odds', PP: 'log-odds', V: 'valence points' };
  // The change in the English − Chinese difference per rating point. Staying
  // positive: the language effect after a positive answer, β(L×R) + ½β(L×Prev×R);
  // staying negative: minus the language effect on a positive next answer after
  // a negative one, −β(L×R) + ½β(L×Prev×R). Both on the log-odds scale.
  const profE = (fit, k) => {
    if (!fit || !fit.ok || !fit.coefOf('Language × proficiency')) return null;
    if (k === 'V') return U(fit.coefOf('Language × proficiency'));
    if (!fit.coefOf('Language × previous state × proficiency')) return null;
    return U(fit.contrast(k === 'PP' ? { 'Language × proficiency': 1, 'Language × previous state × proficiency': 0.5 } : { 'Language × proficiency': -1, 'Language × previous state × proficiency': 0.5 }));
  };
  const profFit = (sk, k) => { const P = fastState.prof; return P && P.fits[sk] ? P.fits[sk][k === 'V' ? 'PV' : 'PA'] : undefined; };
  const profFew = () => { const F = fastState.fits; return fastState.parts.length < MECH_MIN || (F.A && !F.A.ok) || (F.C && !F.C.ok); };
  function runProf() {
    const key = fastState.fitKey, F = fastState.fits;
    if (!fastState.parts.length || profFew() || !F.A || !F.C || fastState.profKey === key) return;
    fastState.profKey = key;
    const P = { fits: {}, done: 0, total: 0 };
    fastState.profNext = P;
    const x = fastState.ctx, parts = fastState.parts;
    // The overall rating first (its fits start from the main models'); then the
    // four skills, each in its own worker, starting from the overall fits.
    const jobsFor = (sk, sA, sV) => {
      const prof = parts.map(Pp => [Pp.key, Pp.prof['en_' + sk]]).filter(([, r]) => isFinite(r));
      const rs = prof.map(([, r]) => r), grid = [];
      for (let r = Math.min(...rs); r <= Math.max(...rs) + 1e-9; r += 0.5) grid.push(r);
      return [{ key: sk + ':PA', model: 'PA', tr: x.tr2, prof, grid, start: sA }, { key: sk + ':PV', model: 'PV', ans: x.ans, prof, start: sV }];
    };
    Object.keys(SKILL).forEach(sk => { P.fits[sk] = {}; });
    P.total = 2 * Object.keys(SKILL).length;
    const got = (k, f) => {
      if (fastState.profNext !== P) return;
      const [sk, m] = k.split(':');
      P.fits[sk][m] = f; P.done++;
      if (sk === 'overall' && P.fits.overall.PA && P.fits.overall.PV) {
        fastState.prof = P;   // the last set stays on screen until the new primary fits are in
        const oA = P.fits.overall.PA, oV = P.fits.overall.PV;
        const sA = oA.ok ? oA.theta : [F.A.theta[0], 0.3, 0.3, F.A.theta[1], F.A.theta[2]], sV = oV.ok ? oV.theta : [F.C.theta[0], 0.15, F.C.theta[1], F.C.theta[2]];
        Object.keys(SKILL).filter(s => s !== 'overall').forEach(s => fitJobs('prof:' + s, jobsFor(s, sA, sV), got));
      }
      if (fastState.prof === P) { renderProf(); if (sk === 'overall') renderFastModels(); }
    };
    fitJobs('prof:overall', jobsFor('overall', [F.A.theta[0], 0.3, 0.3, F.A.theta[1], F.A.theta[2]], [F.C.theta[0], 0.15, F.C.theta[1], F.C.theta[2]]), got);
  }
  function renderProf() {
    const x = fastState.ctx, P = fastState.prof;
    if (!x) return;
    const st = smallTag(x.n), all = !!P && P.done >= P.total;
    const E = {};
    Object.keys(SKILL).forEach(sk => { E[sk] = {}; Object.keys(MEAS).forEach(k => { E[sk][k] = profE(profFit(sk, k), k); }); });
    // the skills' twelve tests, adjusted together once all are in
    const follow = Object.keys(SKILL).filter(sk => sk !== 'overall').flatMap(sk => Object.keys(MEAS).map(k => ({ sk, k })));
    const adj = all ? FA.bh(follow.map(o => E[o.sk][o.k] ? E[o.sk][o.k].p : NaN)) : follow.map(() => NaN);
    const padj = {}; follow.forEach((o, i) => { padj[o.sk + o.k] = adj[i]; });
    const judgedP = (sk, k) => sk === 'overall' ? (E[sk][k] ? E[sk][k].p : NaN) : padj[sk + k];
    const few = profFew(), pending = !few && (!P || !P.fits.overall || !profFit('overall', 'NN'));
    const why = (sk, k) => { const f = profFit(sk, k); return few ? `Needs at least ${MECH_MIN} students` : !f ? 'Being estimated' : !f.ok ? whyNot(f) : 'Not estimable yet'; };
    const unitTxt = k => `${PUNIT[k]} per rating point`;
    // primary: the overall rating
    const prim = Object.keys(MEAS).map(k => ({ k, e: E.overall[k] })), primOk = prim.filter(o => o.e), primClear = primOk.filter(o => clearCI(o.e));
    $('#a-prof-line').innerHTML = few ? `<li><p class="r-sent muted">Needs at least ${MECH_MIN} students with both languages scored (${x.n} so far).</p></li>` : res('Exploratory', pending ? '<span class="muted">Being estimated: whether overall English proficiency changes the English − Chinese difference in staying negative, staying positive or mean valence.</span>'
      : !primOk.length ? `${why('overall', 'NN')}.`
      : primClear.length ? `The English − Chinese difference in ${andList(primClear.map(o => MEASW[o.k]))} changes with overall English proficiency${primOk.length > primClear.length ? `; there is no clear evidence for ${orList(primOk.filter(o => !clearCI(o.e)).map(o => MEASW[o.k]))}` : ''}.`
      : `No clear evidence that overall English proficiency changes the English − Chinese difference in ${orList(primOk.map(o => MEASW[o.k]))}.`,
      pending ? 'Staying negative and staying positive: the change in log-odds per rating point, with its 95% CI and Wald z · Mean valence: the change in valence points per rating point, with its 95% CI and Satterthwaite t · The models take a few seconds to fit.'
        : primOk.map(o => `${MEAS[o.k]}: ${eTxt(o.e, s2, unitTxt(o.k))}, ${statTxt(o.e)}`).join(' · ') + st);
    // the plot for one measure: each student's observed difference, and the model's difference by rating
    const mk = (document.querySelector('#a-prof-measure input:checked') || {}).value || 'NN';
    const pts = x.PROF[mk], fit = profFit('overall', mk), e = E.overall[mk];
    let curve = null;
    if (fit && fit.ok) {
      if (mk === 'V') {
        const rs = x.parts.map(Pp => Pp.prof.en_overall).filter(isFinite), lo = Math.min(...rs), hi = Math.max(...rs);
        curve = [];
        for (let r = lo; r <= hi + 1e-9; r += 0.25) { const c = fit.contrast({ [LANGT]: 1, 'Language × position': fit.cm('Position (per step)'), 'Language × position²': fit.cm('Position² (curve)'), 'Language × proficiency': r - fit.rMean }); curve.push({ x: r, est: c.b, lo: c.ci[0], hi: c.ci[1] }); }
      } else curve = fit.profCurve ? fit.profCurve[mk] : null;
    }
    const rat = x.parts.map(Pp => Pp.prof.en_overall).filter(isFinite);
    const base = mk === 'V' ? 0.5 : 0.1;
    const raw = Math.max(mk === 'V' ? 1 : 0.2, ...pts.map(q => Math.abs(q.y)), ...(curve || []).flatMap(c => [Math.abs(c.lo), Math.abs(c.hi)]).filter(isFinite));
    const ystep = raw / base > 6 ? base * 2 : base, ym = Math.ceil(raw / ystep - 1e-9) * ystep;   // ticks fall on 0
    if (pts.length) FC.diffScatter($('#a-prof'), {
      points: pts, curve, xDomain: [Math.max(0, (rat.length ? Math.min(...rat) : 1) - 1), 10], yDomain: [-ym, ym], yStep: ystep,
      yFmt: mk === 'V' ? s1 : pr2, vFmt: mk === 'V' ? s2 : pr2, xLabel: 'Overall English rating (0–10)', yLabel: 'English − Chinese',
      curveTitle: c => `Model: English − Chinese ${(mk === 'V' ? s2 : pr2)(c.est)} at rating ${c.x}`,
      label: `${MEAS[mk]}: each student's observed English − Chinese difference against their overall English rating, ${pts.length} students` + (e ? `; model: ${eTxt(e, s2, unitTxt(mk))}` : '')
    });
    else $('#a-prof').innerHTML = '<p class="empty">No students with both languages scored yet.</p>';
    $('#a-prof-cap').innerHTML = `<strong>Observed dots, model line.</strong> Each dot is one student’s own English − Chinese difference in ${mk === 'V' ? 'mean answer valence' : `the share of ${mk === 'NN' ? 'negative' : 'positive'} answers followed by another ${mk === 'NN' ? 'negative' : 'positive'} one (students with no such answers in one language are left out)`}. Line and band: the mixed model’s English − Chinese difference at each rating, with its 95% CI${mk === 'V' ? '' : ' (model-adjusted probabilities)'}. Dashed line: no language difference.`;
    $('#a-res-prof').innerHTML = res('Exploratory', !e ? `${why('overall', mk)}.` : clearCI(e) ? `The English − Chinese difference in ${MEASW[mk]} ${e.est > 0 ? 'increases' : 'decreases'} with overall English proficiency.` : `No clear evidence that overall English proficiency changes the English − Chinese difference in ${MEASW[mk]}.`,
      e ? `Change per rating point: ${eTxt(e, s2, PUNIT[mk])}; ${statTxt(e)}${st}` : '');
    // follow-ups: every rating, for each measure
    const allHost = $('#a-prof-all');
    allHost.innerHTML = '';
    Object.keys(MEAS).forEach(k => {
      const rowsF = Object.keys(SKILL).filter(sk => E[sk][k] && isFinite(judgedP(sk, k)) || sk === 'overall' && E[sk][k]).map(sk => ({ label: sk === 'overall' ? 'Overall*' : SKILL[sk], b: E[sk][k].est, lo: E[sk][k].lo, hi: E[sk][k].hi, p: judgedP(sk, k) }));
      const hostF = fig(allHost, MEAS[k], 3);
      if (rowsF.length > 1) FC.forest(hostF, [{ label: '', rows: rowsF }], { xLabel: `${PUNIT[k] === 'log-odds' ? 'Log-odds' : 'Valence points'} per rating point`, minLim: k === 'V' ? 0.1 : 0.1, fmt: s2, left: 96, narrowAt: 0,
        label: `${MEAS[k]}: for each English rating, the change in the English − Chinese difference per rating point, with 95% confidence intervals` });
      else hostF.innerHTML = `<p class="empty">${all ? 'Not estimable yet.' : 'Being estimated…'}</p>`;
    });
    const rating = sk => x.parts.map(Pp => Pp.prof['en_' + sk]).filter(isFinite);
    const cell = (sk, k) => { const o = E[sk][k];
      return o ? `<td class="num sep"><strong>${s2(o.est)}</strong></td><td class="num">${fine(s2, o.lo)} to ${fine(s2, o.hi)}</td><td class="num sep">${statTxt(o).replace(/, (<i>p<\/i>|p)[\s\S]*$/, '')}</td>${pCell(o)}` +
        `<td class="num">${sk === 'overall' ? '<span class="muted">–</span>' : isFinite(padj[sk + k]) ? LAB.fmtPval(padj[sk + k]) : '–'}</td>${rTxt(judgedP(sk, k))}`
        : `<td class="num sep">–</td><td class="num">–</td><td class="num sep">–</td><td class="num">–</td><td class="num">–</td><td class="result"><span class="sig na">${why(sk, k)}</span></td>`; };
    $('#a-prof-table').innerHTML = `<thead><tr><th scope="col">English rating</th><th class="num" scope="col">Mean (range)</th><th class="num" scope="col">Students</th>` +
      `<th class="num sep" scope="col">Change per point</th><th class="num" scope="col">95% CI</th><th class="num sep" scope="col">Test</th><th class="num" scope="col"><i>p</i></th><th class="num" scope="col"><i>p</i> (BH)</th><th class="result" scope="col">Result</th></tr></thead>` +
      Object.keys(MEAS).map(k => `<tbody><tr class="group"><th scope="rowgroup" colspan="9"><span class="stick">${MEAS[k]}: English − Chinese, ${unitTxt(k)}</span></th></tr>` +
        Object.keys(SKILL).map(sk => { const rt2 = rating(sk);
          return `<tr><th scope="row">${SKILL[sk]}${sk === 'overall' ? ' <span class="muted">(primary)</span>' : ''}</th><td class="num">${rt2.length ? LAB.mean(rt2).toFixed(1) + ' <span class="muted">(' + Math.min(...rt2) + '–' + Math.max(...rt2) + ')</span>' : '–'}</td><td class="num">${rt2.length}</td>${cell(sk, k)}</tr>`; }).join('') + '</tbody>').join('');
    syncScrollers();
  }

  /* ---------- exclusion criteria (applied before any analysis) ----------
     Behavioural and data-quality rules only. A student is excluded when (1)
     more than half of their answers in a language repeat the starting word or
     an earlier answer in the same chain, or (2) their first-language answer
     here contradicts their answer to the Judgement task under the same code
     (classes on the page). Normative coverage decides which answers can be
     scored, not who is analysed: lowCov (fewer than 70% of the possible
     transitions usable in either language) is kept for the coverage-threshold
     sensitivity analysis only. */
  function exclusions(all) {
    const per = FA.perParticipant(all), reps = FA.repetitions(all);
    const rate = (x, l) => x[l].all[1] ? x[l].all[0] / x[l].all[1] : NaN;
    const lowCov = new Set(all.filter((Pp, i) => !['zh', 'en'].every(l => per[i].lang[l].possible > 0 && per[i].lang[l].valid / per[i].lang[l].possible >= 0.7)).map(Pp => Pp.key));
    const extreme = new Set(all.filter((Pp, i) => rate(reps[i], 'zh') > 0.5 || rate(reps[i], 'en') > 0.5).map(Pp => Pp.key));
    const fleL1 = new Map(); (state.rows.fle || []).forEach(r => { if (r.l1_chinese) fleL1.set(r.pid, String(r.l1_chinese)); });
    const l1 = new Set(all.filter(Pp => Pp.l1 && fleL1.has(Pp.pid) && ((Pp.l1 !== 'chinese') === (fleL1.get(Pp.pid) === 'yes'))).map(Pp => Pp.key));
    return { lowCov, extreme, l1, any: new Set([...extreme, ...l1]), l1Checked: all.filter(Pp => fleL1.has(Pp.pid)).length,
      l1NotZhUnchecked: all.filter(Pp => Pp.l1 && Pp.l1 !== 'chinese' && !fleL1.has(Pp.pid)).length };
  }
  // The statement at the top of the tab: who is analysed, who is excluded and why, and how response times are handled.
  function renderSample(EX, N, n, S) {
    const st = k => `${k} student${k === 1 ? '' : 's'}`;
    const also = (set, earlier) => { const k = [...set].filter(key => earlier.some(e => e.has(key))).length; return k ? ` (${k} of them also excluded above)` : ''; };
    $('#a-sample').innerHTML = !N ? '' :
      `<p><strong>Sample:</strong> ${n} of ${N} students are analysed. A student is excluded when</p><ul>` +
      `<li>more than half of their answers in a language repeat the starting word or an earlier answer in the same chain: ${st(EX.extreme.size)};</li>` +
      `<li>their first-language answer here contradicts their answer to the Judgement task under the same code: ${EX.l1Checked ? st(EX.l1.size) + also(EX.l1, [EX.extreme]) : 'not checkable for this class (nobody also did the Judgement task)'}.</li></ul>` +
      `<p><strong>Coverage</strong> is not an exclusion criterion: an answer the valence norms do not rate is left out as an observation (with the transitions on either side of it), but the student stays in. Requiring at least 50%, 60%, 70% or 80% usable transitions is a sensitivity analysis (under Robustness).</p>` +
      (n && S ? `<p><strong>Analysis sizes:</strong> the valence, transition and trajectory analyses use ${n} of ${N} students (${S.trans.toLocaleString('en-US')} transitions; the three-state analysis uses the same transitions); the timing models use ${S.tOn === S.tTot ? `${S.tOn} students` : `${S.tOn} students (onset) and ${S.tTot} (total)`}${S.fOn || S.fTot ? `, and the timing sensitivity analysis ${S.tOn - S.fOn} (onset) and ${S.tTot - S.fTot} (total)` : ''}.</p>` : '') +
      (n ? `<p><strong>Timing:</strong> no response times are trimmed or capped. The timing models use each student’s median per language on a log scale, which damps slow outliers without removing anyone. A student is left out of a timing model only if a median is missing. A robust rule fixed in advance flags extreme medians; flagged students are left out only of a timing sensitivity analysis.</p>` : '');
  }

  /* ---------- participant-level data checks (counts only, never codes) ---------- */
  function renderQC() {
    const x = fastState.ctx;
    if (!x) return;
    const q = x.qc, E = x.EX, st = n => `${n} student${n === 1 ? '' : 's'}`;
    $('#a-qc').innerHTML = [
      `<li><strong>Excluded before the analysis:</strong> ${st(E.any.size)} of ${x.allN} (extreme repetition ${E.extreme.size}, first-language inconsistency ${E.l1.size}; a student can meet both rules). Not an exclusion: ${st(E.lowCov.size)} have fewer than 70% usable transitions in a language (see the coverage-threshold analysis). Codes belong to a device, so a first-language inconsistency may not be an error.${E.l1NotZhUnchecked ? ` ${st(E.l1NotZhUnchecked)} gave a first language other than Chinese here but could not be cross-checked, and stay in the analysis.` : ''}</li>`,
      `<li><strong>Missing language-background values</strong> among the analysed students (English age of acquisition, English use, overall self-ratings): ${st(q.missingBg)}.</li>`,
      `<li><strong>No usable transition of a required type</strong> among the analysed students (from a negative, or from a positive, answer in a language): ${st(q.noType)}.</li>`
    ].join('');
  }

  /* ---------- exploratory: lexical reuse (cheap; computed on the page) ---------- */
  const LEXM = [['cross', 'Cross-chain reuse'], ['unique', 'Unique-response proportion'], ['within', 'Within-chain repetition']];
  const LEXKEY = { norm: 'normalised', raw: 'raw (trimmed)', lemma: 'site lemma' };
  function lexTests(lexRows, keep) {
    const out = LEXM.map(([k]) => {
      const d = lexRows.filter((L, i) => keep(i) && L.zh && L.en && isFinite(L.zh[k]) && isFinite(L.en[k])).map(L => (L.en[k] - L.zh[k]) * 100);
      return Object.assign({ k }, ttE(gate(LAB.ttest(d, 0))) || { est: NaN, p: NaN });
    });
    const adj = FA.bh(out.map(o => o.p));
    out.forEach((o, i) => { o.padj = adj[i]; });
    return out;
  }
  function renderLex() {
    const x = fastState.ctx;
    if (!x) return;
    const parts = x.parts, notExtreme = i => !x.extreme.has(parts[i].key), all = () => true;
    const T = {};
    Object.keys(LEXKEY).forEach(key => { T[key] = { all: lexTests(x.lex[key], all), no: lexTests(x.lex[key], notExtreme) }; });
    const A0 = T.norm.all, N0 = T.norm.no, nE = x.extreme.size;
    const ppx = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);
    const ci = o => `${ppx(o.est)} percentage points [${ppx(o.lo)}, ${ppx(o.hi)}], adjusted ${LAB.fmtP(o.padj)}`;
    const ok = o => o && isFinite(o.est), clr = o => ok(o) && o.padj < 0.05;
    // filled: clear after the Benjamini–Hochberg adjustment (the label the text uses)
    const g = LEXM.map(([k, label], i) => ({ label, rows: [{ label: 'Analysed students', b: A0[i].est, lo: A0[i].lo, hi: A0[i].hi, p: A0[i].padj }].concat(nE ? [{ label: 'Without extreme repeaters', b: N0[i].est, lo: N0[i].lo, hi: N0[i].hi, p: N0[i].padj }] : []).filter(r => isFinite(r.b)) })).filter(gr => gr.rows.length);
    if (g.length) FC.forest($('#a-lex'), g, { xLabel: 'English − Chinese, percentage points (95% CI)', xLabelShort: 'English − Chinese, pp (95% CI)', minLim: 2, fmt: ppx, left: 220, narrowAt: 560,
      label: `English − Chinese differences in lexical reuse, in percentage points, all students${nE ? ' and without extreme repeaters' : ''}: ${LEXM.map(([, l], i) => `${l} ${ppx(A0[i].est)}${nE && ok(N0[i]) ? ` and ${ppx(N0[i].est)}` : ''}`).join('; ')}` });
    else $('#a-lex').innerHTML = '<p class="r-sent muted">Too few runs to compare yet.</p>';
    $('#a-lex-cap').innerHTML = `<strong>Observed, one value per student and language.</strong> English − Chinese with 95% CIs (paired <i>t</i>-tests), for the ${x.n} analysed students${nE ? ` and without the ${nE} with extreme within-chain repetition` : ''}; responses normalised (see the definitions). Filled: clear after adjustment. 0 = no language difference.`;
    const [cA, uA, wA] = A0, [cN, uN, wN] = N0;
    const say = [];
    if (ok(cA)) say.push(clr(cA) ? `English responses recur across a student’s different chains ${cA.est > 0 ? 'more' : 'less'} often than Chinese responses (${ci(cA)})${nE ? (clr(cN) ? `, also without the students with extreme repetition (${ci(cN)})` : `, but not clearly without the students with extreme repetition (${ci(cN)})`) : ''}.`
      : `No clear language difference in cross-chain reuse (${ci(cA)}).`);
    if (ok(uA)) say.push(clr(uA) ? `English answers contain a ${uA.est < 0 ? 'smaller' : 'larger'} share of distinct responses (${ci(uA)})${nE ? (clr(uN) ? `, also without them (${ci(uN)})` : `, but not clearly without them (${ci(uN)})`) : ''}.`
      : `No clear language difference in the share of distinct responses (${ci(uA)}).`);
    if (ok(wA)) say.push(nE && ok(wN) ? (clr(wN) ? `Within-chain repetition is ${wN.est > 0 ? 'higher' : 'lower'} in English without the extreme repeaters (${ci(wN)}).` : `Within-chain repetition shows no clear language difference without the extreme repeaters (${ci(wN)}); with them, ${ci(wA)}.`)
      : clr(wA) ? `Within-chain repetition is ${wA.est > 0 ? 'higher' : 'lower'} in English (${ci(wA)}).` : `Within-chain repetition shows no clear language difference (${ci(wA)}).`);
    // no comparison between the measures is claimed: they are not tested against each other
    const steady = clr(cA) && (!nE || clr(cN));
    if (steady && !clr(nE ? wN : wA)) say.push('Of the two repetition measures (cross-chain reuse and within-chain repetition), only cross-chain reuse shows a clear language difference that holds without the extreme repeaters; the two are not tested against each other.');
    if (steady && cA.est > 0) say.push('This is consistent with more constrained L2 associative search. A possible alternative: Chinese and English used different starting words, and a set whose words are semantically closer to one another would also produce more reuse across chains. Exact-response reuse is not the same as semantic convergence.');
    const keysAgree = A0.every(ok) && Object.keys(LEXKEY).every(key => T[key].all.every((o, i) => clr(o) === clr(A0[i])) && T[key].no.every((o, i) => clr(o) === clr(N0[i])));
    if (A0.some(ok)) say.push(keysAgree ? 'The same labels hold with raw strings and with the site’s English lemmas.' : 'Some labels change with raw strings or with the site’s English lemmas; see the full table.');
    const repC = ttE(x.repeat.test);
    if (A0.some(ok) && repC) say.push(`Section C’s repetition measure uses the site’s lemma form, so it differs slightly (${ppts(repC.est)} percentage points there).`);
    $('#a-res-lex').innerHTML = A0.some(ok) ? res('Exploratory', say.join(' '), `Benjamini–Hochberg adjustment across the three comparisons${nE ? ', within each sample' : ''}${smallTag(x.n)}.`) : '';
    $('#a-lex-cap').hidden = !A0.some(ok);
    $('#a-lex-def').innerHTML = 'Per student and language, over the non-empty answers. <b>Cross-chain reuse</b>: each chain reduced to its distinct responses; a response found in <i>k</i> of the student’s chains adds <i>k</i> − 1; the sum is divided by the number of chain-distinct responses (0 = nothing recurs across chains). <b>Unique-response proportion</b>: distinct responses / answers (one minus it is the share of answers that repeat a response given anywhere before). <b>Within-chain repetition</b>: share of answers equal to the chain’s starting word or to an earlier answer in the same chain. ' +
      '<b>Normalised</b> responses: Unicode NFKC; curly quotes and dashes made plain; Latin letters lower-cased; quotation marks and leading or trailing punctuation removed; internal spaces collapsed; in Chinese, spaces and punctuation removed. Nothing is translated, stemmed, lemmatised or split. <b>Raw</b>: the answer as typed, trimmed. <b>Site lemma</b>: the form the site uses for repetitions (the English lemma when the norms know the word). Each comparison: paired <i>t</i>-test of the English − Chinese difference.';
    $('#a-lex-table').innerHTML = `<thead><tr><th scope="col">Measure</th><th scope="col">Responses</th><th scope="col">Sample</th><th class="num sep" scope="col">English − Chinese (pp)</th><th class="num" scope="col">95% CI</th><th class="num sep" scope="col"><i>t</i> (df)</th><th class="num" scope="col"><i>p</i></th><th class="num" scope="col"><i>p</i> (BH)</th><th class="result" scope="col">Result</th></tr></thead><tbody>` +
      LEXM.map(([, label], i) => Object.keys(LEXKEY).map(key => [['all', 'Analysed students'], ['no', 'Without extreme repeaters']].filter(([s]) => s === 'all' || nE).map(([s, sl]) => { const o = T[key][s][i];
        return `<tr><th scope="row">${label}</th><td>${LEXKEY[key]}</td><td>${sl}</td>` + (ok(o) ? `<td class="num sep"><strong>${ppx(o.est)}</strong></td><td class="num">${ppx(o.lo)} to ${ppx(o.hi)}</td><td class="num sep">${statTxt(o).replace(/, (<i>p<\/i>|p)[\s\S]*$/, '')}</td><td class="num">${LAB.fmtPval(o.p)}</td><td class="num">${LAB.fmtPval(o.padj)}</td>${rTxt(o.padj)}`
          : '<td class="num sep">–</td><td class="num">–</td><td class="num sep">–</td><td class="num">–</td><td class="num">–</td><td class="result">Too few runs</td>') + '</tr>'; }).join('')).join('')).join('') + '</tbody>';
    fastState.lexT = T;
  }

  /* ---------- exploratory: the mechanism and L1 models (fitted when the section is opened) ---------- */
  const L1X = [['aoa', 'English age of acquisition', 'per year', Pp => Pp.eng_age], ['use', 'English use', 'per 10 percentage points', Pp => Pp.en_use / 10], ['rel', 'English − Chinese overall rating', 'per rating point', Pp => Pp.prof.en_overall - Pp.prof.zh_overall]];
  const L1O = [['S', 'Chinese starting-word persistence', 'change from answer 1 to 10 in the gap between positive and negative starting words, in points'], ['T', 'Chinese trajectory shape', 'joint test; the estimate is the change in predicted valence from answer 1 to 10, in points'], ['R', 'Chinese cross-chain reuse', 'in percentage points, by least squares with HC3 errors']];
  const MECH_MIN = 10;   // between-student moderators need a class, not a handful of students
  function runMech() {
    const x = fastState.ctx, F = fastState.fits;
    if (!x || !$('#a-mech-more').open || !F.B || !F.B.ok || fastState.mechKey === fastState.fitKey) return;
    fastState.mechKey = fastState.fitKey;
    const parts = x.parts, L = x.lex.norm, ans = x.ans;
    const conv = parts.map((Pp, i) => [Pp.key, L[i].zh && L[i].en ? (L[i].en.cross - L[i].zh.cross) * 100 : NaN]).filter(([, v]) => isFinite(v));
    const M = { fits: {}, done: 0, total: 0, few: conv.length < MECH_MIN };
    fastState.mech = M;
    if (M.few) { renderMech(); return; }
    const samples = [['all', () => true], ['no', Pp => !x.extreme.has(Pp.key)]].concat(x.l1Flag.size ? [['l1', Pp => !x.l1Flag.has(Pp.key)]] : []);
    const th = F.B.theta, jobs = [[], [], []];
    samples.forEach(([s, keep], si) => {
      const keys = new Set(parts.filter(keep).map(Pp => Pp.key)), an = ans.filter(a => keys.has(a.pid));
      if (s !== 'l1') jobs[si].push({ key: `${s}:BM`, model: 'BM', ans: an, mod: conv, start: [th[0], 0.05].concat(th.slice(1)) });
      L1X.forEach(([k, , , f]) => {
        const mod = parts.filter(keep).map(Pp => [Pp.key, f(Pp)]);
        jobs[si].push({ key: `${s}:S:${k}`, model: 'L1S', ans: an, mod, start: [th[0], 0.05].concat(th.slice(1)) }, { key: `${s}:T:${k}`, model: 'L1T', ans: an, mod, start: [th[0], 0.03].concat(th.slice(1)) });
      });
    });
    M.total = jobs.reduce((t, j) => t + j.length, 0);
    renderMech();
    jobs.forEach((j, i) => { if (j.length) fitJobs('mech:' + i, j, (k, f) => { if (fastState.mech !== M) return; M.fits[k] = f; M.done++; renderMech(); }); });
  }
  // least squares with HC3 standard errors (one value per student)
  function olsHC3(xs, ys) {
    const n = xs.length; if (n < 4) return null;
    const mx = LAB.mean(xs), my = LAB.mean(ys), sxx = xs.reduce((s, v) => s + (v - mx) ** 2, 0);
    if (!(sxx > 0)) return null;
    const b = xs.reduce((s, v, i) => s + (v - mx) * (ys[i] - my), 0) / sxx, a = my - b * mx;
    const vb = xs.reduce((s, v, i) => { const h = 1 / n + (v - mx) ** 2 / sxx, e = ys[i] - a - b * v; return s + (v - mx) ** 2 * e * e / (1 - h) ** 2; }, 0) / sxx ** 2;
    const se = Math.sqrt(vb), t = b / se, q = FA.qT(n - 2);
    return { est: b, lo: b - q * se, hi: b + q * se, stat: t, df: n - 2, p: FA.pT(t, n - 2) };
  }
  function renderMech() {
    const x = fastState.ctx, M = fastState.mech;
    if (!x || !$('#a-mech-more').open) return;
    if (!M) {
      const FB = fastState.fits.B, msg = x.n < MECH_MIN ? `Needs at least ${MECH_MIN} students with both languages scored (${x.n} so far).` : FB && !FB.ok ? 'Not estimable yet with these runs.' : '';
      $('#a-res-mech').innerHTML = msg ? `<li><p class="r-sent muted">${msg}</p></li>` : pending(null); $('#a-res-l1').innerHTML = msg ? `<li><p class="r-sent muted">${msg}</p></li>` : pending(null); $('#a-l1-table').innerHTML = ''; return;
    }
    if (M.few) {
      const msg = `<li><p class="r-sent muted">Needs at least ${MECH_MIN} students with both languages scored (${x.n} so far).</p></li>`;
      $('#a-res-mech').innerHTML = msg; $('#a-res-l1').innerHTML = msg; $('#a-l1-table').innerHTML = ''; return;
    }
    const st = smallTag(x.n), parts = x.parts, L = x.lex.norm, FB = fastState.fits.B;
    // 2 · convergence × decay
    const seeds = new Map(); parts.forEach(Pp => Pp.chains.forEach(c => { if (isFinite(c.seedValence)) seeds.set(c.lang + ':' + c.id, c); }));
    const catM = (cat, lang) => LAB.mean([...seeds.values()].filter(c => c.category === cat && (!lang || c.lang === lang)).map(c => c.seedValence));
    const sc = (catM('positive') - catM('negative')) * Math.log2(10);
    const mechE = s => { const f = M.fits[`${s}:BM`]; if (!f) return undefined; if (!f.ok || !f.coefOf('Language × seed valence × position × M')) return null;
      const e = U(f.coefOf('Language × seed valence × position × M')), d = U(f.coefOf('Language × seed valence × position'));
      return { est: e.est * sc, lo: e.lo * sc, hi: e.hi * sc, stat: e.stat, df: e.df, p: e.p }; };
    // the average language difference in the gap's change: the main starting-word model's, as everywhere else on the page
    const base = FB && FB.ok && FB.coefOf('Language × seed valence × position') ? FB.coefOf('Language × seed valence × position').b * sc : NaN;
    const mA = mechE('all'), mN = mechE('no'), nE = x.extreme.size;
    const conv = parts.map((Pp, i) => L[i].zh && L[i].en ? (L[i].en.cross - L[i].zh.cross) * 100 : NaN).filter(isFinite);
    const sdM = conv.length > 2 ? Math.sqrt(conv.reduce((s, v) => s + (v - LAB.mean(conv)) ** 2, 0) / (conv.length - 1)) : NaN;
    const f3 = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(3);
    $('#a-res-mech').innerHTML = mA === undefined ? pending(null) : !mA ? `<li><p class="r-sent muted">Not estimable yet.</p></li>` :
      res('Exploratory', (clearCI(mA) ? `Students with a larger English − Chinese difference in cross-chain reuse show a ${mA.est * base > 0 ? 'larger' : 'smaller'} English − Chinese difference in how much the starting-word gap changes. This is a cross-sectional association across students, not evidence about cause.`
        : `No clear evidence that the English − Chinese difference in cross-chain reuse goes with the English − Chinese difference in how much the starting-word gap changes.`) +
        (isFinite(sdM) && isFinite(base) ? ` Per standard deviation of the reuse difference (${sdM.toFixed(1)} percentage points), the 95% CI runs from ${s2(mA.lo * sdM)} to ${s2(mA.hi * sdM)} points; the average language difference in the gap’s change is ${s2(base)} points, ` +
          (Math.min(mA.lo * sdM, mA.hi * sdM) <= -Math.abs(base) || Math.max(mA.lo * sdM, mA.hi * sdM) >= Math.abs(base) ? 'and the interval reaches values that large.' : 'so the interval excludes an association as large as that average per standard deviation; associations within the interval remain possible.') : ''),
        `Language × seed valence × position × reuse difference, in points of the gap’s change (answer 1 → 10) per percentage point: ${f3(mA.est)} [${f3(mA.lo)}, ${f3(mA.hi)}]; ${statTxt(mA)}` +
        (nE && mN ? `. Without the extreme repeaters: ${f3(mN.est)} [${f3(mN.lo)}, ${f3(mN.hi)}]; ${statTxt(mN)}` : '') + st);
    // 3 · L1 dynamics and bilingual experience: the whole family of nine
    const zhSc = (catM('positive', 'zh') - catM('negative', 'zh')) * Math.log2(10);
    const famFor = (s, keep) => {
      const ps = parts.map((Pp, i) => [Pp, i]).filter(([Pp]) => keep(Pp));
      const out = [];
      L1X.forEach(([k, , , f]) => {
        const fs = M.fits[`${s}:S:${k}`], ft = M.fits[`${s}:T:${k}`];
        const es = fs === undefined ? undefined : fs && fs.ok && fs.coefOf('Seed valence × position × X') ? (e => ({ est: e.est * zhSc, lo: e.lo * zhSc, hi: e.hi * zhSc, stat: e.stat, df: e.df, p: e.p }))(U(fs.coefOf('Seed valence × position × X'))) : null;
        let et = ft === undefined ? undefined : null;
        if (ft && ft.ok && ft.coefOf('Position × X') && ft.coefOf('Position² × X')) {
          const w = ft.wald(['Position × X', 'Position² × X']), q1 = -4.5, q10 = 4.5, c = U(ft.contrast({ 'Position × X': q10 - q1, 'Position² × X': (q10 * q10 - 8.25) - (q1 * q1 - 8.25) }));
          et = w && isFinite(w.p) ? { est: c.est, lo: c.lo, hi: c.hi, w, p: w.p } : null;
        }
        const xs = ps.map(([Pp]) => f(Pp)), ys = ps.map(([, i]) => L[i].zh ? L[i].zh.cross * 100 : NaN), okI = xs.map((v, j) => isFinite(v) && isFinite(ys[j]));
        const er = olsHC3(xs.filter((v, j) => okI[j]), ys.filter((v, j) => okI[j]));
        out.push({ k, o: 'S', e: es }, { k, o: 'T', e: et }, { k, o: 'R', e: er });
      });
      const ready = out.every(o => o.e !== undefined), adj = ready ? FA.bh(out.map(o => o.e ? o.e.p : NaN)) : out.map(() => NaN);
      out.forEach((o, i) => { o.padj = adj[i]; });
      return { out, ready };
    };
    const fam = famFor('all', () => true), famN = nE ? famFor('no', Pp => !x.extreme.has(Pp.key)) : null, famL = x.l1Flag.size ? famFor('l1', Pp => !x.l1Flag.has(Pp.key)) : null;
    const lab = o => isFinite(o.padj) && o.padj < 0.05;
    const aoaAdult = parts.filter(Pp => Pp.eng_age >= 18).length, aoaChild = parts.filter(Pp => Pp.eng_age < 18).length;
    if (!fam.ready) { $('#a-res-l1').innerHTML = `<li><p class="r-sent muted">Being estimated: the nine tests (${M.done} of ${M.total} models fitted).</p></li>`; $('#a-l1-table').innerHTML = ''; }
    else if (!fam.out.some(o => o.e)) { $('#a-res-l1').innerHTML = '<li><p class="r-sent muted">Not estimable yet with these runs.</p></li>'; $('#a-l1-table').innerHTML = ''; }
    else {
      const ps = fam.out.map(o => o.padj).filter(isFinite), clearOnes = fam.out.filter(lab);
      const lo = Math.min(...ps), hi = Math.max(...ps), range = LAB.fmtPval(lo) === LAB.fmtPval(hi) ? `adjusted <i>p</i> = ${LAB.fmtPval(lo)}` : `adjusted <i>p</i> from ${LAB.fmtPval(lo)} to ${LAB.fmtPval(hi)}`;
      const nTested = fam.out.filter(o => o.e).length;
      const sens = [famN && ['without the extreme repeaters', famN], famL && ['in the L1-consistent sample', famL]].filter(Boolean).map(([w, fm]) => {
        const ch = fm.ready ? fm.out.filter((o, i) => lab(o) !== lab(fam.out[i])) : null;
        return !fm.ready ? '' : ch.length ? `${w}, ${ch.length} label${ch.length > 1 ? 's' : ''} change${ch.length > 1 ? '' : 's'} (outlier-sensitive)` : `${w}, no label changes`;
      }).filter(Boolean);
      $('#a-res-l1').innerHTML = res('Exploratory', (clearOnes.length ? `${clearOnes.length} of the ${nTested} associations ${clearOnes.length > 1 ? 'are' : 'is'} clear after adjustment: ${clearOnes.map(o => `${L1X.find(z => z[0] === o.k)[1].toLowerCase()} with ${L1O.find(z => z[0] === o.o)[1].toLowerCase()}`).join('; ')}. L1 dynamics vary with this bilingual-experience measure; without a monolingual comparison group, this cannot separate bilingual experience from pre-existing individual differences.`
        : `None of the ${nTested === 9 ? 'nine' : nTested} associations is clear after adjustment (${range}).`) +
        (sens.length ? ` ${sens.join('; ').replace(/^./, c => c.toUpperCase())}.` : '') +
        (aoaAdult >= 3 && aoaChild >= 3 ? ` English age of acquisition is split here (${aoaAdult} students learned English at 18 or later, ${aoaChild} before), so its linear term largely contrasts early and late learners.` : ''),
        `Benjamini–Hochberg adjustment across the nine tests${st}.`);
      // grouped by measure of bilingual experience; outcome units in the note below the table
      $('#a-l1-table').innerHTML = `<thead><tr><th scope="col">Chinese (L1) outcome</th><th class="num sep" scope="col">Estimate</th><th class="num" scope="col">95% CI</th><th class="num sep" scope="col">Test</th><th class="num" scope="col"><i>p</i></th><th class="num" scope="col"><i>p</i> (BH)</th><th class="result" scope="col">Result</th></tr></thead>` +
        L1X.map(([k, name, unit]) => `<tbody><tr class="group"><th scope="rowgroup" colspan="7"><span class="stick">${name}, ${unit}</span></th></tr>` +
          fam.out.filter(o => o.k === k).map(o => { const O = L1O.find(z => z[0] === o.o), e = o.e;
            return `<tr><th scope="row">${O[1].replace(/^Chinese /, '').replace(/^./, c => c.toUpperCase())}</th>` + (e ? `<td class="num sep"><strong>${s2(e.est)}</strong></td><td class="num">${fine(s2, e.lo)} to ${fine(s2, e.hi)}</td><td class="num sep">${e.w ? wTxt(e.w).replace(/, (<i>p<\/i>|p)[\s\S]*$/, '') : statTxt(e).replace(/, (<i>p<\/i>|p)[\s\S]*$/, '')}</td><td class="num">${LAB.fmtPval(e.p)}</td><td class="num">${LAB.fmtPval(o.padj)}</td>${rTxt(o.padj)}`
              : '<td class="num sep">–</td><td class="num">–</td><td class="num sep">–</td><td class="num">–</td><td class="num">–</td><td class="result">Not estimable yet</td>') + '</tr>'; }).join('') + '</tbody>').join('') +
        '';
      $('#a-l1-note').innerHTML = `Estimates per unit of the bilingual-experience measure. ${L1O.map(([, n, u]) => `${n.replace(/^Chinese /, '').replace(/^./, c => c.toUpperCase())}: ${u}.`).join(' ')} <i>p</i> (BH): adjusted across all nine tests.`;
    }
    syncScrollers();
  }

  /* ---------- what the models say, in words ----------
     Each story returns sentences built only from the current fit. Omnibus
     tests decide the headline answers; follow-ups and single coefficients
     only describe, and never overturn them. */
  const qv = k => [k - 5.5, (k - 5.5) * (k - 5.5) - 8.25];
  const dot = t => /[.…]$/.test(t) ? t : t + '.';
  /* Wording rules. A sentence that says two things differ follows that
     difference's own test: joint p < .05 for an omnibus test, a 95% CI that
     excludes zero for an estimate or contrast. Everything else is said with the
     estimates themselves (predicted values, differences, changes), never with
     a size word chosen by a cut-off. */
  function transitionStory(fA) {
    const co = fA.carry, w = fA.wald([LANGT, PREV]);
    const inter = U(fA.coefOf(PREV));
    if (!co || !w || !inter) return null;
    const dN = co.diff.N, dP = co.diff.P, nx = co.next, big = Math.abs(dP.est) >= Math.abs(dN.est) ? dP : dN;
    const lead = clearW(w) ? 'The transition probabilities differ between Chinese and English.' : 'There is no clear overall language difference in transition probabilities.';
    const values = `After a positive answer, the next answer is positive with a model-adjusted probability of ${p2(nx.zh.P.est)} in Chinese and ${p2(nx.en.P.est)} in English; after a negative answer, ${p2(nx.zh.N.est)} and ${p2(nx.en.N.est)}.`;
    const clearFollow = [['negative', dN], ['positive', dP]].filter(([, d]) => clearCI(d));
    const explain = !clearW(w) ? '' : clearFollow.map(([s, d]) => `After a ${s} answer, the next answer is positive ${d.est > 0 ? 'more' : 'less'} often in English (${pr2(d.est)}).`).join(' ') || 'Neither follow-up comparison is clear on its own; the difference lies in the overall pattern.';
    const primary = clearW(w) ? 'Overall, the transition probabilities differ between Chinese and English.' : 'Overall, there is no clear evidence that the transition probabilities differ between Chinese and English.';
    // A follow-up describes one comparison; it never overturns the overall test.
    const follow = (s, d, robust) => {
      if (!clearCI(d)) return `After a ${s} answer, there is no clear language difference in how often the next answer is positive.`;
      const how = `After a ${s} answer, the model-adjusted probability that the next answer is positive is ${p2(Math.abs(d.est))} ${d.est > 0 ? 'higher' : 'lower'} in English.`;
      return clearW(w) ? how : `${how} The overall test is not clear${robust === false ? ' and this comparison does not hold in every robustness check' : ''}, so this is not evidence of a language difference on its own.`;
    };
    const interSay = clearCI(inter) ? `The previous answer’s state matters ${inter.est > 0 ? 'more' : 'less'} in English than in Chinese.` : 'No clear evidence that the previous answer’s state matters more in one language than the other.';
    return { w, lead, values, explain, primary, follow, interSay, inter, co, big };
  }
  // "answer 1", "answers 1 and 5", "answers 1, 5 and 10"
  const answersAt = ks => ks.length === 1 ? `answer ${ks[0]}` : `answers ${ks.slice(0, -1).join(', ')} and ${ks[ks.length - 1]}`;
  const andList = a => a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
  const orList = a => a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} or ${a[a.length - 1]}`;
  /* The trajectory in words, from the model's predictions at answers 1, 5 and
     10: the predicted values, which English − Chinese differences are clear,
     and, where the gap changes clearly between two of those answers, how each
     language moves there. */
  function trajectoryStory(fC, RV) {
    const cv = { '(Intercept)': 1, 'Seed valence (per point)': cm(fC, 'Seed valence (per point)'), 'Block (second − first)': cm(fC, 'Block (second − first)') };
    const pred = (L, k) => { const [q, q2] = qv(k); return U(fC.contrast(Object.assign({ [LANGT]: L, 'Position (per step)': q, 'Position² (curve)': q2, 'Language × position': L * q, 'Language × position²': L * q2 }, cv))); };
    const diff = k => { const [q, q2] = qv(k); return U(fC.contrast({ [LANGT]: 1, 'Language × position': q, 'Language × position²': q2 })); };
    const between = (a, b, L) => { const [qa, qa2] = qv(a), [qb, qb2] = qv(b); return U(fC.contrast(L === null ? { 'Language × position': qb - qa, 'Language × position²': qb2 - qa2 }
      : { 'Position (per step)': qb - qa, 'Position² (curve)': qb2 - qa2, 'Language × position': L * (qb - qa), 'Language × position²': L * (qb2 - qa2) })); };
    const w = fC.wald(['Language × position', 'Language × position²']);
    if (!w || !fC.coefOf(LANGT)) return null;
    const K = [1, 5, 10], d = K.map(diff), [d1, d5, d10] = d;
    const v = { zh: K.map(k => pred(-0.5, k).est), en: K.map(k => pred(0.5, k).est) };
    const lead = clearW(w) ? 'The trajectories differ between Chinese and English.' : 'There is no clear evidence that the trajectories differ in shape between Chinese and English.';
    const values = `Predicted mean valence at answers 1, 5 and 10 (averaged across starting words): Chinese ${v.zh.map(b2).join(', ')}; English ${v.en.map(b2).join(', ')}.`;
    const ks = f => K.filter((k, i) => f(d[i]));
    const enK = ks(e => clearCI(e) && e.est > 0), zhK = ks(e => clearCI(e) && e.est < 0), unK = ks(e => !clearCI(e));
    // a clear contrast that some robustness check overturns says so
    const val = k => s2(d[K.indexOf(k)].est), cav = k => RV && RV['d' + k] === false ? ', though not in every robustness check' : '';
    // one caveat for the group: which of these clear differences some robustness check overturns
    const cavs = ks => { const c = ks.filter(k => cav(k)); return !c.length ? '' : c.length === ks.length ? (ks.length > 1 ? ', though neither holds in every robustness check' : ', though not in every robustness check') : `, though the difference at answer ${c.join(' and ')} does not hold in every robustness check`; };
    const said = [];
    if (enK.length) said.push(`English answers are more positive at ${answersAt(enK)} (${andList(enK.map(val))} points${cavs(enK)})`);
    if (zhK.length) said.push(`Chinese answers are more positive at ${answersAt(zhK)} (${andList(zhK.map(k => s2(-d[K.indexOf(k)].est)))} points${cavs(zhK)})`);
    if (unK.length) said.push(`${said.length ? 'the' : 'The'} English − Chinese difference${unK.length > 1 ? 's' : ''} at ${unK.length > 1 ? 'answers ' + andList(unK.map(k => `${k} (${val(k)})`)) : `answer ${unK[0]} (${val(unK[0])})`} ${unK.length > 1 ? 'are' : 'is'} not clear`);
    // Without a clear overall test, no single answer's difference is called a difference: the estimates only.
    const diffs = clearW(w) ? said.join('; ').replace(/^./, c => c.toUpperCase()) + '.' : `The English − Chinese differences at answers 1, 5 and 10 are ${d.map(e => s2(e.est)).join(', ')}.`;
    const segs = [[1, 5], [5, 10]].map(([a, b]) => ({ a, b, g: between(a, b, null), zh: between(a, b, -0.5), en: between(a, b, 0.5), da: d[K.indexOf(a)].est, db: d[K.indexOf(b)].est }));
    const pv = (l, k) => b2(v[l][K.indexOf(k)]);
    const move = (name, l, c, a, b) => clearCI(c) ? `${name} answers become more ${c.est > 0 ? 'positive' : 'negative'} (${pv(l, a)} → ${pv(l, b)})` : `${name} answers show no clear change (${pv(l, a)} → ${pv(l, b)})`;
    const gapSay = !clearW(w) ? '' : segs.filter(s => clearCI(s.g)).map(s => `From answer ${s.a} to ${s.b} the gap ${Math.abs(s.db) < Math.abs(s.da) ? 'narrows' : 'widens'}: ${move('Chinese', 'zh', s.zh, s.a, s.b)}, ${move('English', 'en', s.en, s.a, s.b)}.`).join(' ');
    // the main-test result: the changes between the three answers, with their CIs (the table beside it has the differences)
    const cl = e => clearCI(e) ? 'clear' : 'not clear';
    const detail = segs.map(s => `From answer ${s.a} to ${s.b} the English − Chinese gap changes by ${eTxt(s.g, s2)}, ${cl(s.g)}; Chinese answers change by ${eTxt(s.zh, s2)}, ${cl(s.zh)}, and English answers by ${eTxt(s.en, s2)}, ${cl(s.en)}.`).join(' ') + ' Changes are computed before rounding.';
    return { w, pred, diff, d1, d5, d10, segs, lead, values, diffs, gapSay, detail, label: `${values} ${diffs}` };
  }
  /* Response timing from the per-student medians (log seconds ~ language ×
     block + (1 | student)): each language's predicted time (geometric mean
     over students, averaged over blocks), their difference in seconds with a
     delta-method 95% CI, and the language, block and language × block terms
     as ratios. */
  function timingStory(f) {
    if (!f || !f.ok || !f.coefOf(LANGT) || !f.coefOf('Block (second − first)')) return null;
    const ix = f.names.indexOf('(Intercept)'), il = f.names.indexOf(LANGT), cv = f.cov, b0 = f.beta[ix], bL = f.beta[il];
    const zh = Math.exp(b0 - bL / 2), en = Math.exp(b0 + bL / 2), d = en - zh, g = [d, (en + zh) / 2];
    const L = U(f.coefOf(LANGT)), se = Math.sqrt(g[0] * g[0] * cv[ix][ix] + 2 * g[0] * g[1] * cv[ix][il] + g[1] * g[1] * cv[il][il]), q = FA.qT(L.df || 1e7);
    const ratio = c => { const e = U(f.coefOf(c)); return e && { est: Math.exp(e.est), lo: Math.exp(e.lo), hi: Math.exp(e.hi), stat: e.stat, df: e.df, p: e.p, log: e }; };
    // Chinese-first ÷ English-first group, overall: with ±½ coding the groups' log difference is β(language × block) / 2
    const og = U(f.coefOf('Language × block')), order = og && { est: Math.exp(og.est / 2), lo: Math.exp(og.lo / 2), hi: Math.exp(og.hi / 2), stat: og.stat, df: og.df, p: og.p, log: og };
    return { zh, en, est: d, lo: d - q * se, hi: d + q * se, stat: L.stat, df: L.df, p: L.p, lang: ratio(LANGT), block: ratio('Block (second − first)'), order, n: f.n / 2 };
  }
  const xr = v => '×' + v.toFixed(2);

  /* The starting word: the separation between chains that began with a positive
     and with a negative starting word, in valence points, at answer 1 and at the
     last answer, and the language differences in it (each with its own test). */
  function seedStory(fB, dSV, nPos, RV) {
    if (!isFinite(dSV) || !fB.coefOf('Language × seed valence') || !fB.coefOf('Language × seed valence × position') || !fB.coefOf('Seed valence × position')) return null;
    const slope = (L, k) => U(fB.contrast({ 'Seed valence (per point)': 1, 'Language × seed valence': L, 'Seed valence × position': Math.log2(k), 'Language × seed valence × position': L * Math.log2(k) }));
    const sep = (L, k) => scaleE(slope(L, k), dSV);
    const lg = Math.log2(nPos);
    const init = scaleE(U(fB.coefOf('Language × seed valence')), dSV);                                   // English − Chinese separation at answer 1
    const decay = scaleE(U(fB.coefOf('Language × seed valence × position')), dSV * lg);                    // … in its change from answer 1 to the last
    const endD = scaleE(U(fB.contrast({ 'Language × seed valence': 1, 'Language × seed valence × position': lg })), dSV);   // … at the last answer
    const fall = L => scaleE(U(fB.contrast({ 'Seed valence × position': lg, 'Language × seed valence × position': L * lg })), dSV);   // each language's change, answer 1 → last
    const fz = fall(-0.5), fe = fall(0.5);
    const z1 = sep(-0.5, 1).est, zN = sep(-0.5, nPos).est, e1 = sep(0.5, 1).est, eN = sep(0.5, nPos).est;
    const iC = clearCI(init), dC = clearCI(decay), eC = clearCI(endD), iL = init.est > 0 ? 'English' : 'Chinese', fastL = decay.est < 0 ? 'English' : 'Chinese';
    const shrinks = clearCI(fz) && clearCI(fe) && fz.est < 0 && fe.est < 0;
    const verb = shrinks ? 'shrinks' : 'changes';
    const lead = iC || dC ? 'The starting word influences the developing chain differently across languages.' : 'There is no clear evidence that the starting word influences the chain differently across languages.';
    // each language's gap at answer 1 and at the last answer, and whether it is clearly above (or below) zero
    const s1 = { en: sep(0.5, 1), zh: sep(-0.5, 1) }, sN = { en: sep(0.5, nPos), zh: sep(-0.5, nPos) };
    const unclear = g => ['en', 'zh'].filter(l => !clearCI(g[l])).map(l => LANG_NAME[l]);
    const note = g => { const u = unclear(g); return !u.length ? '' : u.length === 2 ? 'neither gap is clearly different from zero' : `the ${u[0]} gap is not clearly different from zero`; };
    const n1 = note(s1), nN = note(sN);
    const values = (n1 ? `At answer 1, the gap between chains that began with a positive and with a negative starting word is ${b2(e1)} valence points in English and ${b2(z1)} in Chinese (${n1})`
      : `At answer 1, chains that began with a positive rather than a negative starting word are ${b2(e1)} valence points more positive in English and ${b2(z1)} in Chinese`) +
      `; at answer ${nPos} the gap is ${b2(eN)} in English and ${b2(zN)} in Chinese${nN ? `, and ${nN}` : ''}.`;
    const c1 = iC ? `The gap is larger in ${iL} at answer 1${RV && RV.si === false ? ' (though not in every robustness check)' : ''}` : 'There is no clear language difference in the gap at answer 1';
    const c2 = dC ? (iC && iL === fastL ? ` and ${verb} faster there` : `${iC ? ', and it' : ', but it'} ${verb} faster in ${fastL}`) : `, and there is no clear difference in how fast it ${verb}`;
    const c3 = eC ? `at answer ${nPos} it is still larger in ${endD.est > 0 ? 'English' : 'Chinese'}` : `at answer ${nPos} there is no clear language difference`;
    const compare = `${c1}${c2}; ${c3}.`;
    const card = iC && dC && iL === fastL && !eC ? `Stronger at first in ${iL}; no clear difference by answer ${nPos}`
      : dC ? `${shrinks ? 'Shrinks' : 'Changes'} faster in ${fastL}` : iC ? `Stronger at first in ${iL}` : 'No clear language difference';
    const mainSay = dC ? `The gap ${verb} faster in ${fastL}.` : `No clear evidence that the gap ${verb === 'shrinks' ? 'shrinks' : 'changes'} at a different rate in the two languages.`;
    const neg = e => ({ est: -e.est, lo: -e.hi, hi: -e.lo });
    const mainNumbers = `From answer 1 to ${nPos} it ${shrinks ? `falls by ${eTxt(neg(fe), b2, 'points')} in English and ${eTxt(neg(fz), b2)} in Chinese` : `changes by ${eTxt(fe, s2, 'points')} in English and ${eTxt(fz, s2)} in Chinese`}.`;
    return { sep, init, decay, endD, eC, s1, sN, lead, values, compare, card, mainSay, mainNumbers, numbers: values, z1, zN, e1, eN, fastL, iC, dC, coef: U(fB.coefOf('Language × seed valence × position')) };
  }
  /* The robustness verdicts, once every check is fitted: does each conclusion
     keep its verdict (and, for the fading difference, its direction)? */
  function robustVerdicts() {
    const R = fastState.robust, x = fastState.ctx;
    if (!R || !x || R.done < R.total || !['A', 'B', 'C'].every(k => fastState.fits[k])) return null;
    const V = Object.assign({ main: fastState.fits }, R.variants);
    const rows = robustRows(x.dSV), get = key => rows.find(r => r.key === key);
    const verdict = (r, e) => r.joint ? clearW(e) : clearCI(e);
    const keeps = (key, alts) => { const r = get(key), m = r.get(V.main); if (!m) return null; const es = alts.map(k => r.get(V[k])).filter(e => e && isFinite(e.p)); return es.length ? es.every(e => verdict(r, e) === verdict(r, m)) : null; };
    const sameDir = key => { const r = get(key), m = r.get(V.main); if (!m) return null; const es = ALTS.map(k => r.get(V[k])).filter(e => e && isFinite(e.p)); return es.length ? es.every(e => Math.sign(e.est) === Math.sign(m.est)) : null; };
    // For a data-quality subset: which primary conclusions (transition pattern, trajectory shape, starting-word decay) change verdict there.
    const PRIMARY = [['tw', 'the transition conclusion'], ['jw', 'the trajectory conclusion'], ['sd', 'the starting-word decay conclusion']];
    const changedIn = k => R.variants[k] && R.variants[k].n !== undefined ? PRIMARY.filter(([key]) => keeps(key, [k]) === false).map(([, name]) => name) : null;
    return { trans: keeps('tw', ALTS), traj: keeps('jw', ALTS.concat(['cat'])), fade: keeps('sd', ALTS), fadeDir: sameDir('sd'), si: keeps('si', ALTS), fp: keeps('fp', ALTS), fn: keeps('fn', ALTS),
      all: changedIn('all'),
      d1: keeps('d1', ALTS.concat(['cat'])), d5: keeps('d5', ALTS.concat(['cat'])), d10: keeps('d10', ALTS.concat(['cat'])) };
  }

  function renderFastModels() {
    const x = fastState.ctx;
    if (!x) return;
    const F = fastState.fits, fA = F.A, fC1 = F.C1, fB = F.B, fC = F.C;
    const TO = timingStory(F.TO), TT = timingStory(F.TT);
    const okA = fA && fA.ok, okC1 = fC1 && fC1.ok, okB = fB && fB.ok, okC = fC && fC.ok;
    const { C, polarity, repeat, rt, PROF, n, other, P, tr2, ans, parts, nPos, gapCov, lowL, hiL, dSV } = x;
    const st = smallTag(n);
    const RV = robustVerdicts();
    const T = okA ? transitionStory(fA) : null, J = okC ? trajectoryStory(fC, RV) : null, S = okB ? seedStory(fB, dSV, nPos, RV) : null;
    const M3 = renderM3(x, J);
    const TOx = timingStory(F.TOx), TTx = timingStory(F.TTx);
    const nA = okA && !T ? { ok: false, reason: 'dropped' } : fA, nC = okC && !J ? { ok: false, reason: 'dropped' } : fC, nB = okB && !S ? { ok: false, reason: 'dropped' } : fB;
    const emptyText = fA && fA.reason === 'separation' ? [...new Set(fA.empty.map(c => c.prev + c.next))].map(k => {
      const langs = fA.empty.filter(c => c.prev + c.next === k).map(c => c.lang);
      return `${langs.length === 2 ? 'in either language' : 'in ' + LANG_NAME[langs[0]]}, no ${STATE_NAME[k[0]]} answer was followed by a ${STATE_NAME[k[1]]} one`;
    }).join('; ') : '';

    // ---- what we found: three findings, other results, a data note ----
    const FITTING = {
      A: 'Being estimated: whether the chance that the next answer is positive, given whether the answer before it was positive or negative, differs between Chinese and English. The model-adjusted probabilities for each language will appear here, with a note on how robust the verdict is.',
      C: 'Being estimated: whether the trajectories differ between Chinese and English. This finding will give the predicted mean valence at answers 1, 5 and 10 in each language, averaged across all the starting words; the English − Chinese difference at each of those answers and whether it is clear; and, where the gap changes clearly between two of those answers, how each language’s mean valence moves from one of those answers to the next. The trajectory model takes a few seconds to fit.',
      B: 'Being estimated: whether the starting word influences the chain differently in the two languages. This finding will give how much more positive chains that began with a positive rather than a negative starting word are at answer 1 and at answer 10 in each language, whether each of those gaps is clearly different from zero, and whether the gap differs between the languages at answer 1, shrinks at a different rate, or still differs at answer 10. The starting-word model takes a few seconds to fit.' };
    const waitLine = (f, k) => `<span class="muted">${!f ? FITTING[k] : whyNot(f)}${f && f.reason === 'separation' && emptyText ? ': ' + emptyText : ''}</span>`;
    $('#a-summary').innerHTML =
      `<li><strong>Transitions.</strong> ${T ? `${T.lead} ${T.values}${T.explain ? ' ' + T.explain : ''} ${!RV ? '<span class="muted">Its robustness checks are still being fitted.</span>' : RV.trans === false ? 'This verdict is sensitive to modelling choices.' : RV.trans ? 'This verdict holds in all robustness checks.' : 'Too few runs yet to check its robustness.'}` : waitLine(nA, 'A')}` +
        // one sentence on the three-state model, only when its overall test is clear
        (T && M3 && M3.clearO ? (M3.secondary
          ? ` Separating a neutral state shows a language difference in the three-state transition pattern (${wTxt(M3.w)}), but it changes with the cut-points and a check without cut-points finds no clear difference, so it is treated as descriptive and secondary.`
          : ` Separating a neutral state shows a language difference in the three-state transition pattern (${wTxt(M3.w)})${[M3.NP, M3.PP].filter(c => c.ok).map(c => `; ${c.say.replace(/\.$/, '').replace(/^./, ch => ch.toLowerCase())}`).join('')}${M3.cutsDiffer && M3.cutsDiffer.length ? '; this depends on the cut-points' : ''}` +
            // and what the check without cut-points shows: a difference in shape, or only in level
            (!M3.Q ? '.' : M3.Q.clear ? '; on the continuous scale the next answer’s valence also depends on the previous answer’s differently in the two languages.'
              : clearCI(M3.Q.lvl) ? `; on the continuous scale, English next answers are ${M3.Q.lvl.est > 0 ? 'more' : 'less'} positive at the same previous valence (${s2(M3.Q.lvl.est)} points), with no clear difference in shape.` : '; on the continuous scale there is no clear language difference.')) : '') + `</li>` +
      `<li><strong>Trajectories.</strong> ${J ? `${J.lead} ${J.values} ${J.diffs}${J.gapSay ? ' ' + J.gapSay : ''}${RV && RV.traj === false ? ' This verdict is sensitive to modelling choices.' : ''}` : waitLine(nC, 'C')}</li>` +
      `<li><strong>Starting word.</strong> ${S ? `${S.lead} ${S.values} ${S.compare}${RV && RV.fade === false ? (RV.fadeDir === false ? ' The direction of the difference in how fast the gap changes is sensitive to modelling choices.' : ' The decay verdict is sensitive to modelling choices.') : ''}` : waitLine(nB, 'B')}</li>`;
    const rtE = ttE(rt.test), repE = ttE(repeat.test);
    $('#a-other').innerHTML = '<strong>Other results:</strong> ' + [
      TT ? (clearCI(TT) ? `English answers were ${TT.est > 0 ? 'slower' : 'faster'} (${s2(TT.est)} s)${TO && clearCI(TO) && TO.est > 0 && TT.est > 0 ? `, and already slower before the first keystroke (${s2(TO.est)} s)` : TO && !clearCI(TO) ? ', with no clear difference at the first keystroke' : ''}` : 'response times showed no clear language difference')
        : F.TT === undefined && rtE ? (clearCI(rtE) ? `English answers were ${rtE.est > 0 ? 'slower' : 'faster'}; timing at the first keystroke is being estimated` : 'response times showed no clear language difference') : 'response times could not be compared yet',
      repE ? (clearCI(repE) ? `repetition was ${repE.est > 0 ? 'more' : 'less'} frequent in English` : 'repetition showed no clear language difference') : 'repetition could not be compared yet'
    ].join('; ') + '.';
    $('#a-datanote').innerHTML = (n < 10 ? `<strong>Small class:</strong> only ${n} student${n === 1 ? '' : 's'} so far, so treat every result as provisional. ` : '') +
      `<strong>Data note:</strong> ${pct0(C.zh.scored)} of Chinese and ${pct0(C.en.scored)} of English answers have a normative valence score${gapCov ? `, so ${LANG_NAME[lowL]} has fewer usable transitions (${pct0(C[lowL].valid)} vs ${pct0(C[hiL].valid)})` : ''}. The two languages used different, matched starting words, not translations. See Robustness and data quality.`;

    // ---- headline estimates: the three main tests, in words first ----
    const card = (label, verdict, note, test) => `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value verdict">${verdict}</span><span class="stat-note">${note}</span><span class="stat-test">${test}</span></div>`;
    $('#a-stats').innerHTML =
      card('Transition pattern', T ? (clearW(T.w) ? 'Differs by language' : 'No clear language difference') : fA ? '–' : 'Being estimated',
        T ? `Largest English − Chinese difference in a transition probability: ${pr2(T.big.est)}; ${!RV ? 'robustness checks running' : RV.trans === false ? 'sensitive to modelling choices' : RV.trans ? 'holds in all robustness checks' : 'robustness not checkable yet'}` : fA ? whyNot(nA) : 'Largest English − Chinese difference in a transition probability: being estimated', T ? wTxt(T.w) + st : '') +
      card('Trajectory shape', J ? (clearW(J.w) ? 'Differs by language' : 'No clear language difference') : fC ? '–' : 'Being estimated',
        J ? `English − Chinese mean valence: ${s2(J.d1.est)} at answer 1, ${s2(J.d5.est)} at answer 5, ${s2(J.d10.est)} at answer 10` : fC ? whyNot(nC) : 'English − Chinese mean valence at answers 1, 5 and 10: being estimated', J ? wTxt(J.w) + st : '') +
      card('Starting-word influence over time', S ? S.card : fB ? '–' : 'Being estimated',
        S ? `Positive − negative starting words, answer 1 → ${nPos}: Chinese ${b2(S.z1)} → ${b2(S.zN)}, English ${b2(S.e1)} → ${b2(S.eN)} points${RV && RV.si === false ? '; the answer-1 difference does not hold in every robustness check' : ''}` : fB ? whyNot(nB) : `Positive − negative starting words, answer 1 → ${nPos}: being estimated`, S ? 'Language difference in the change: ' + statTxt(S.coef) + st : '') +
      `<div class="stat"><span class="stat-label">Participants</span><span class="stat-value">${n}</span><span class="stat-note">students analysed, of ${x.allN} · ${(P.zh.n + P.en.n).toLocaleString('en-US')} valid transitions</span></div>`;

    // ---- C: response timing, from the models of the per-student medians ----
    const tRow = (name, id, e, why) => `<div class="est-row"><span class="er-name">${name}</span><div class="er-chart" id="${id}"></div><p class="er-text">` +
      (e ? `English − Chinese <b>${s2(e.est)}\u00a0s</b> [${s2(e.lo)}, ${s2(e.hi)}]; ${statTxt(e)}${st}. <span class="muted">Model-predicted: ${b2(e.zh)}\u00a0s in Chinese, ${b2(e.en)}\u00a0s in English (${xr(e.lang.est)}).</span>`
        : `<span class="muted">${why}</span>`) + '</p></div>';
    const whyT = f => !f ? 'Being estimated: the English − Chinese difference in seconds, with its 95% CI, from a model of each student’s median times.' : whyNot(f) || 'Not estimable yet';
    $('#a-timing').innerHTML = tRow('Onset (first keystroke)', 'a-er-onset', TO, whyT(F.TO)) + tRow('Total (answer submitted)', 'a-er-total', TT, whyT(F.TT));
    // one scale for both rows (both in seconds), so their lengths compare
    const tLim = Math.max(1e-9, ...[TO, TT].filter(Boolean).flatMap(e => [Math.abs(e.lo), Math.abs(e.hi), Math.abs(e.est)])) * 1.15;
    [[TO, 'a-er-onset', 'Response onset'], [TT, 'a-er-total', 'Total response time']].forEach(([e, id, nm]) => { if (e) FC.estimate($('#' + id), { est: e.est, lo: e.lo, hi: e.hi, lim: tLim, clear: clearCI(e), label: `${nm}, English − Chinese in seconds, with 95% CI (same scale as the other timing row)` }); });
    $('#a-timing-say').innerHTML = !TO || !TT ? '' : [
      clearCI(TO) && clearCI(TT) && TO.est > 0 && TT.est > 0
        ? `English answers were slower already at the first keystroke: ${s2(TO.est)} s at onset against ${s2(TT.est)} s by submission, so the onset difference is ${Math.round(100 * TO.est / TT.est)}% of the total (point estimates).` +
          (!TOx || !TTx ? '' : ' ' + timingSensSay(TO, TT, TOx, TTx, x.tOut) + (clearCI(TOx) && clearCI(TTx) && TOx.est > 0 && TTx.est > 0 ? ' English responses are already slower before the first keystroke, so the total English cost is not simply due to slower typing or response completion.' : ' Without the extreme timing medians this pattern is not clear, so it is not interpreted further.'))
        : clearCI(TT) && !clearCI(TO) ? `English answers took longer to submit, with no clear language difference at the first keystroke.` : '',
      TO.block && TT.block ? (clearCI(TO.block.log) || clearCI(TT.block.log)
        ? `On average over the two languages, answers were ${TT.block.est < 1 ? 'faster' : 'slower'} in the second block (onset ${xr(TO.block.est)} [${TO.block.lo.toFixed(2)}, ${TO.block.hi.toFixed(2)}], total ${xr(TT.block.est)} [${TT.block.lo.toFixed(2)}, ${TT.block.hi.toFixed(2)}]); the language differences are estimated with the block in the model.`
        : 'On average over the two languages, there is no clear difference between the first and the second block.') : '',
      TO.order && TT.order ? `${clearCI(TO.order.log) || clearCI(TT.order.log) ? 'The two order groups differ' : 'The two order groups did not clearly differ'} in overall speed (students who did Chinese first, relative to those who did English first: onset ${xr(TO.order.est)} [${TO.order.lo.toFixed(2)}, ${TO.order.hi.toFixed(2)}], total ${xr(TT.order.est)} [${TT.order.lo.toFixed(2)}, ${TT.order.hi.toFixed(2)}]).` : '',
      // the sensitivity sentence sits with the onset sentence above when that one is shown
      clearCI(TO) && clearCI(TT) && TO.est > 0 && TT.est > 0 && TOx && TTx ? '' : timingSensSay(TO, TT, TOx, TTx, x.tOut)
    ].filter(Boolean).join(' ');
    renderTimingSens(TO, TT, TOx, TTx, x);

    // ---- A: the model-adjusted plot and its four results ----
    const box = (id, html) => { $(id).innerHTML = `<p class="empty">${html}</p>`; };
    // Why the model-adjusted numbers can differ from the observed table above.
    $('#a-inter-note').innerHTML = '';
    if (T) {
      const gapObs = Math.max(...['zh', 'en'].flatMap(l => ['N', 'P'].map(k => Math.abs(T.co.next[l][k].est - P[l].probs[k].P))));
      if (gapObs >= 0.005) {   // the two show different numbers at two decimals
        const svAll = LAB.mean(tr2.map(t => t.seedValence).filter(isFinite)), svN = LAB.mean(tr2.filter(t => t.prev === 'N').map(t => t.seedValence).filter(isFinite));
        $('#a-inter-note').innerHTML = ` These model-adjusted values differ from the observed proportions above (after a negative answer: ${p2(T.co.next.zh.N.est)} vs ${p2(P.zh.probs.N.P)} in Chinese, ${p2(T.co.next.en.N.est)} vs ${p2(P.en.probs.N.P)} in English) because the model compares both kinds of answer on the class’s whole mix of starting words and positions, with student, starting-word and chain differences set to zero` +
          (isFinite(svAll) && isFinite(svN) && b2(svN) !== b2(svAll) ? `; in the raw data, transitions after a negative answer come from chains whose starting words have a mean valence of ${b2(svN)}, against ${b2(svAll)} over all transitions.` : '.');
      }
    }
    if (T) FC.interaction($('#a-inter'), { next: T.co.next, label: `Model-adjusted probability that the next answer is positive: after a negative answer ${p2(T.co.next.zh.N.est)} in Chinese and ${p2(T.co.next.en.N.est)} in English; after a positive answer ${p2(T.co.next.zh.P.est)} and ${p2(T.co.next.en.P.est)}` });
    else box('#a-inter', emptyText ? whyNot(nA) + ': ' + emptyText + '.' : dot(whyNot(nA)));
    $('#a-res-a').innerHTML = !T ? pending(nA) :
      res('Main test', `<span class="r-lead">${T.primary}</span>`, `Joint test of the two language terms: ${wTxt(T.w)}${st}`, 'primary') +
      res('Secondary', T.interSay, `Language × previous state: ${eTxt(T.inter, s2, 'log-odds')}; ${statTxt(T.inter)}${st}`) +
      res('Follow-up', T.follow('negative', T.co.diff.N, RV ? RV.fn : null), `English − Chinese ${eTxt(T.co.diff.N, pr2)}; ${statTxt(U(T.co.diff.N))}${st}`) +
      res('Follow-up', T.follow('positive', T.co.diff.P, RV ? RV.fp : null), `English − Chinese ${eTxt(T.co.diff.P, pr2)}; ${statTxt(U(T.co.diff.P))}${st}`);
    $('#a-carry').innerHTML = T ? `Carry-over is the difference between the two model-adjusted probabilities in the plot above: P(next positive | previous positive) − P(next positive | previous negative). It was ${p3(T.co.carry.zh.est)} in Chinese and ${p3(T.co.carry.en.est)} in English; English − Chinese ${pr2(T.co.did.est)} [${pr2(T.co.did.lo)}, ${pr2(T.co.did.hi)}], ${statTxt(U(T.co.did))}.` : whyNot(nA) + '.';

    // ---- A: the continuous-valence check ----
    const nC1 = okC1 && !fC1.coefOf('Language × previous valence') ? { ok: false, reason: 'dropped' } : fC1;
    if (okC1 && nC1 === fC1) {
      const sl = l => U(fC1.contrast({ 'Previous valence (per point)': 1, 'Language × previous valence': l === 'en' ? 0.5 : -0.5 }));
      const lpv = U(fC1.coefOf('Language × previous valence')), sz = sl('zh'), se = sl('en');
      const both = clearCI(sz) && clearCI(se);
      const say = `${both ? 'In both languages, the' : 'The'} exact valence of one answer ${both ? 'predicts' : 'does not clearly predict'} the next (${b2(sz.est)} points per point in Chinese, ${b2(se.est)} in English), ${!clearCI(lpv) ? 'with no clear language difference in the slope' : `with a steeper slope in ${lpv.est > 0 ? 'English' : 'Chinese'}`}.`;
      $('#a-c1-sum').textContent = `: slopes ${b2(sz.est)} in Chinese and ${b2(se.est)} in English${!clearCI(lpv) ? ', no clear difference' : `, steeper in ${lpv.est > 0 ? 'English' : 'Chinese'}`}`;
      $('#a-res-c1').innerHTML = res('Check', say, `Change in the next answer’s valence per point of the previous answer’s: Chinese ${b2(sz.est)}, English ${b2(se.est)}; English − Chinese ${eTxt(lpv, s2)}; ${statTxt(lpv)}${st}`);
      const lv = { '(Intercept)': 1, 'Seed valence (per point)': cm(fC1, 'Seed valence (per point)'), 'Position (per step)': cm(fC1, 'Position (per step)'), 'Block (second − first)': cm(fC1, 'Block (second − first)') };
      const pv = tr2.map(t => t.prevV), lo = Math.max(1, Math.floor(Math.min(...pv))), hi = Math.min(9, Math.ceil(Math.max(...pv)));
      const series = {};
      ['zh', 'en'].forEach(l => {
        const L = l === 'en' ? 0.5 : -0.5, line = [];
        for (let v = lo; v <= hi + 1e-9; v += 0.25) { const c = fC1.contrast(Object.assign({ [LANGT]: L, 'Previous valence (per point)': v - 5, 'Language × previous valence': L * (v - 5) }, lv)); line.push({ x: v, y: c.b, lo: c.ci[0], hi: c.ci[1] }); }
        const dots = [];
        for (let b = lo; b <= hi; b++) { const ys = tr2.filter(t => t.lang === l && Math.round(t.prevV) === b).map(t => t.nextV); if (ys.length >= 10) dots.push({ x: b, y: LAB.mean(ys), n: ys.length }); }
        series[l] = { line, dots };
      });
      FC.lines($('#a-c1'), { series, faint: true, xDomain: [lo, hi], xTicks: Array.from({ length: hi - lo + 1 }, (_, k) => lo + k), xLabel: 'Previous answer’s valence',
        yStep: 1, yFmt: v => String(Math.round(v)), yRef: 5, yFloor: 1, yCeil: 9, yLabel: 'Next answer’s valence',
        dotTitle: (l, d) => `${LANG_NAME[l]}, observed: previous answers rated about ${d.x}, next answer ${d.y.toFixed(2)} on average (${d.n} transitions)`,
        lineTitle: l => `${LANG_NAME[l]}, model-adjusted: ${b2(sl(l).est)} per point`,
        label: `Next answer’s valence against the previous answer’s valence, model-adjusted: ${b2(sz.est)} per point in Chinese, ${b2(se.est)} in English` });
    } else { $('#a-c1-sum').textContent = fC1 ? '' : ': slopes in Chinese and English and their difference, still being fitted'; $('#a-res-c1').innerHTML = pending(nC1); box('#a-c1', dot(whyNot(nC1))); }

    // ---- B: the model-adjusted trajectory, three positions, the shape test ----
    if (J) {
      const series = {};
      ['zh', 'en'].forEach(l => {
        const L = l === 'en' ? 0.5 : -0.5, line = [];
        for (let k = 1; k <= nPos + 1e-9; k += 0.25) { const p = J.pred(L, k); line.push({ x: k, y: p.est, lo: p.lo, hi: p.hi }); }
        const dots = [];
        for (let k = 0; k < nPos; k++) {
          const vals = parts.map(Pp => { const v = Pp.chains.filter(c => c.lang === l).map(c => c.answers[k] && c.answers[k].valence).filter(z => z !== null && z !== undefined); return v.length ? LAB.mean(v) : NaN; }).filter(isFinite);
          dots.push({ x: k + 1, y: LAB.mean(vals), n: vals.length });
        }
        series[l] = { line, dots };
      });
      const vals = ['zh', 'en'].flatMap(l => series[l].line.flatMap(d => [d.lo, d.hi]).concat(series[l].dots.map(d => d.y))).filter(isFinite);
      const step = Math.max(...vals) - Math.min(...vals) > 1.6 ? 0.5 : 0.25;
      FC.lines($('#a-traj-main'), { series, faint: true, xDomain: [1, nPos], xTicks: Array.from({ length: nPos }, (_, k) => k + 1), xLabel: 'Answer position',
        yStep: step, yFmt: v => v.toFixed(step < 0.5 ? 2 : 1), yRef: 5, yFloor: 1, yCeil: 9, yLabel: 'Mean valence (1–9)',
        dotTitle: (l, d) => `${LANG_NAME[l]}, observed mean at answer ${d.x}: ${d.y.toFixed(2)} (${d.n} students)`,
        lineTitle: l => `${LANG_NAME[l]}, model-adjusted trajectory`,
        label: `Model-adjusted mean valence by answer position. ${J.label}` });
      $('#a-traj-contrasts').innerHTML = `<caption class="tbl-cap">Model-adjusted mean valence</caption><thead><tr><th scope="col">Answer</th><th class="num" scope="col">Chinese</th><th class="num" scope="col">English</th><th class="num sep" scope="col">English − Chinese</th></tr></thead><tbody>` +
        [[1, J.d1], [5, J.d5], [10, J.d10]].map(([k, d]) => `<tr><th scope="row">${k}</th><td class="num">${b2(J.pred(-0.5, k).est)}</td><td class="num">${b2(J.pred(0.5, k).est)}</td><td class="num sep"><strong>${s2(d.est)}</strong><span class="ci">[${s2(d.lo)}, ${s2(d.hi)}]</span></td></tr>`).join('') + '</tbody>';
      $('#a-res-b').innerHTML = res('Main test', `<span class="r-lead">${J.lead}</span> ${J.detail}`, `Joint test of the language × position terms (linear and curved): ${wTxt(J.w)}${st}`, 'primary');
    } else { box('#a-traj-main', dot(whyNot(nC))); $('#a-traj-contrasts').innerHTML = ''; $('#a-res-b').innerHTML = pending(nC); }

    // ---- B: does the starting word's influence fade differently? ----
    $('#a-sep-cap').innerHTML = `<strong>Model-adjusted.</strong> The difference in answer valence between chains that began with a positive and with a negative starting word, with 95% bands; 0 = the starting word no longer matters. It uses the starting words’ own norm ratings: positive starting words are rated ${isFinite(dSV) ? dSV.toFixed(2) : '–'} points higher than negative ones on average (all starting words of both languages, so the same for both).`;
    if (S) {
      const series = {};
      ['zh', 'en'].forEach(l => {
        const L = l === 'en' ? 0.5 : -0.5, line = [];
        for (let k = 1; k <= nPos + 1e-9; k += 0.25) { const p = S.sep(L, k); line.push({ x: k, y: p.est, lo: p.lo, hi: p.hi }); }
        series[l] = { line, dots: [] };
      });
      FC.lines($('#a-sep'), { series, xDomain: [1, nPos], xTicks: Array.from({ length: nPos }, (_, k) => k + 1), xLabel: 'Answer position',
        yStep: 0.5, yFmt: v => (Math.abs(v) < 1e-9 ? '0' : (v < 0 ? '−' : '') + Math.abs(v).toFixed(1)), yRef: 0, yLabel: 'Positive − negative start',
        lineTitle: l => `${LANG_NAME[l]}: ${b2(l === 'en' ? S.e1 : S.z1)} at answer 1, ${b2(l === 'en' ? S.eN : S.zN)} at answer ${nPos}`,
        label: `Separation between chains that began with positive and negative starting words. ${S.numbers}` });
      $('#a-res-seed').innerHTML =
        res('Main test', `<span class="r-lead">${S.mainSay}</span> ${S.mainNumbers}`,
          `English − Chinese difference in how much the gap changes from answer 1 to ${nPos}: ${eTxt(S.decay, s2, 'points')}; ${statTxt(S.coef)}${st}`, 'primary') +
        res('Follow-up', S.iC ? `At answer 1 the gap is larger in ${S.init.est > 0 ? 'English' : 'Chinese'}.${RV && RV.si === false ? ' This comparison does not hold in every robustness check.' : ''}` : 'No clear language difference in the gap at answer 1.',
          `Gap at answer 1: English ${eTxt(S.s1.en, b2)}, Chinese ${eTxt(S.s1.zh, b2)} points. English − Chinese: ${eTxt(S.init, s2, 'points')}; ${statTxt(U(fB.coefOf('Language × seed valence')))}${st}`) +
        res('Follow-up', S.eC ? `At answer ${nPos} the gap is still larger in ${S.endD.est > 0 ? 'English' : 'Chinese'}.` : `No clear language difference in the gap at answer ${nPos}.`,
          `Gap at answer ${nPos}: English ${eTxt(S.sN.en, b2)}, Chinese ${eTxt(S.sN.zh, b2)} points. English − Chinese: ${eTxt(S.endD, s2, 'points')}; ${statTxt(S.endD)}${st}`);
    } else { box('#a-sep', dot(whyNot(nB))); $('#a-res-seed').innerHTML = pending(nB); }

    // ---- robustness and data quality: one visible line ----
    const rob = !RV ? 'Robustness: the primary conclusions are being re-tested under alternative modelling choices.' : (() => {
      const holds = [], sens = [], none = [];
      const put = (v, name) => (v === null ? none : v ? holds : sens).push(name);
      put(RV.traj, 'the trajectory conclusion');
      put(RV.fade, 'the starting-word decay conclusion');
      put(RV.si, 'the conclusion about the starting-word gap at answer 1');
      put(RV.trans, 'the transition conclusion');
      const list = andList;
      const parts = [holds.length ? `${list(holds)} ${holds.length > 1 ? 'hold' : 'holds'} in all checks` : '',
        sens.length ? `${list(sens)} ${sens.length > 1 ? 'are' : 'is'} sensitive to modelling choices` : '',
        none.length ? `${list(none)} cannot be checked yet (too few runs)` : ''].filter(Boolean);
      // first: what the exclusions change (all students against the analysed sample)
      const dq = x.EX.any.size && RV.all ? (RV.all.length ? `With all ${x.allN} students (no exclusions), ${andList(RV.all)} ${RV.all.length > 1 ? 'change' : 'changes'} verdict. `
        : `With all ${x.allN} students (no exclusions), the primary conclusions are the same. `) : '';
      return `Robustness: ${dq}${parts.join('; ').replace(/^./, c => c.toUpperCase())}.`;
    })();
    const CV = renderCov();
    $('#a-dq-line').innerHTML = `${rob}${CV ? ` Requiring at least 50%, 60%, 70% or 80% usable transitions per student: ${CV.say.replace(/^./, c => c.toLowerCase())}` : ''} ${x.dqText}`;

    // ---- methods and full statistical output (collapsed) ----
    const fhost = $('#a-forest');
    if (okA) {
      const row = (label, c) => ({ label, b: c.b, lo: c.ci[0], hi: c.ci[1], p: c.p });
      FC.forest(fhost, [
        { label: 'Language terms and simple effects', rows: [row('Language × previous state', fA.coefOf(PREV)), row('Language (average over states)', fA.coefOf(LANGT)),
          row('Language, after a negative answer', fA.contrast({ [LANGT]: 1, [PREV]: -0.5 })),
          row('Language, after a positive answer', fA.contrast({ [LANGT]: 1, [PREV]: 0.5 }))] },
        { label: 'Other terms', rows: fA.coef.filter(c => !['(Intercept)', PREV, LANGT].includes(c.name)).map(c => row(c.name, c)) }
      ], { xLabel: 'Log-odds (95% CI)', label: 'Transition model terms in log-odds with 95% confidence intervals' });
    } else fhost.innerHTML = `<p class="empty">${whyNot(nA)}${emptyText ? ': ' + emptyText : ''}.</p>`;
    const head = `<thead><tr><th scope="col">Test</th><th class="num" scope="col">Estimate</th><th class="num" scope="col">95% CI</th><th class="num sep" scope="col">Statistic</th><th class="num" scope="col"><i>p</i></th><th class="result" scope="col">Result</th></tr></thead>`;
    const grp = t => `<tr class="group"><th scope="rowgroup" colspan="6"><span class="stick">${t}</span></th></tr>`;
    const na = why => `<td class="num">–</td><td class="num">–</td><td class="num sep">–</td><td class="num">–</td><td class="result"><span class="sig na">${why || 'Too few runs to test'}</span></td>`;
    const trow = (name, e, fmt, unit, why, under) => `<tr><th scope="row">${name}</th>` + (e && isFinite(e.p)
      ? `<td class="num"><strong>${fmt(e.est)}</strong>${unit ? ' <small>' + unit + '</small>' : ''}</td><td class="num">${fine(fmt, e.lo)} to ${fine(fmt, e.hi)}</td><td class="num sep">${statTxt(e).replace(/, (<i>p<\/i>|p)[\s\S]*$/, '')}</td>${pCell(e)}` +
        (under && !clearW(under) && clearCI(e) ? '<td class="result">Clear on its own<span class="dir">overall test not clear</span></td>' : rTxt(e.p))
      : na(why)) + '</tr>';
    const wrow = (name, w, why) => `<tr><th scope="row">${name}</th>` + (w && isFinite(w.p)
      ? `<td class="num muted">joint</td><td class="num">–</td><td class="num sep">${wTxt(w).replace(/, (<i>p<\/i>|p)[\s\S]*$/, '')}</td>${pCell({ p: w.p })}${rTxt(w.p)}` : na(why)) + '</tr>';
    $('#a-tests').innerHTML = head + '<tbody>' +
      grp('A · Transition probabilities (logistic model)') +
      wrow('Main test: overall transition-pattern difference (Language + Language × previous state)', T && T.w, whyNot(nA)) +
      trow('Secondary: language × previous state', T && T.inter, s2, 'log-odds', whyNot(nA)) +
      trow('Follow-up: after a negative answer, English − Chinese', T && U(T.co.diff.N), pr2, 'probability', whyNot(nA), T && T.w) +
      trow('Follow-up: after a positive answer, English − Chinese', T && U(T.co.diff.P), pr2, 'probability', whyNot(nA), T && T.w) +
      trow('Additional: carry-over, English − Chinese', T && U(T.co.did), pr2, 'probability', whyNot(nA)) +
      grp('A · Three-state transitions (multinomial model)') +
      (() => { const mm = fastState.m3 && fastState.m3.ok && fastState.m3.m3, why = whyNot(fastState.m3), w = mm && m3W(mm.omni);
        return wrow('Main test: overall three-state difference (the six language terms)', w, why) +
          ['N', 'U', 'P'].map(a => wrow(`Follow-up: after a ${NM3[a]} answer (2 df)${mm ? `; Holm-adjusted ${LAB.fmtP(mm.rows[a].padj)}` : ''}`, mm && m3W(mm.rows[a]), why)).join('') +
          trow('Contrast named in advance: negative → positive, English − Chinese', mm && U(mm.diff.N.P), pr2, 'probability', why, w) +
          trow('Contrast named in advance: positive → positive, English − Chinese', mm && U(mm.diff.P.P), pr2, 'probability', why, w); })() +
      (() => { const Q = c1qStory(F.C1Q); return wrow('Check without cut-points: language × previous valence and × previous valence² (curved continuous model)', Q && Q.w, whyNot(F.C1Q)); })() +
      grp('A · Continuous-valence check (linear model)') +
      trow('Language × previous valence', okC1 ? U(fC1.coefOf('Language × previous valence')) : null, s2, 'per point', whyNot(fC1)) +
      grp('B · Trajectories (linear model, quadratic in position)') +
      wrow('Main test: overall trajectory-shape difference (Language × position + Language × position²)', J && J.w, whyNot(nC)) +
      [1, 5, 10].map(k => trow(`English − Chinese at answer ${k}`, J && J.diff(k), s2, 'valence', whyNot(nC), J && J.w)).join('') +
      grp('B · Starting word (linear model, log₂ position)') +
      trow(`Main test: language difference in how much the gap changes, answer 1 → ${nPos}`, S && S.decay, s2, 'points', whyNot(nB)) +
      trow('Follow-up: language difference in the gap at answer 1', S && S.init, s2, 'points', whyNot(nB)) +
      trow(`Follow-up: language difference in the gap at answer ${nPos}`, S && S.endD, s2, 'points', whyNot(nB)) +
      trow('Per-student check: English − Chinese difference in each student’s positive − negative starting-word gap, averaged over all answers (paired <i>t</i>-test)', ttE(polarity.test), s2, 'points', '') +
      grp('C · Other behavioural differences') +
      trow('Response onset, English − Chinese (model of students’ medians)', TO, s2, 's', whyT(F.TO)) +
      trow('Total response time, English − Chinese (model of students’ medians)', TT, s2, 's', whyT(F.TT)) +
      trow(`Sensitivity, onset without flagged medians (${x.tOut.onset.flagged.size} students)`, TOx, s2, 's', whyT(F.TOx)) +
      trow(`Sensitivity, total without flagged medians (${x.tOut.total.flagged.size} students)`, TTx, s2, 's', whyT(F.TTx)) +
      trow('Second − first block, onset', TO && TO.block, xr, 'ratio', whyT(F.TO)) +
      trow('Second − first block, total', TT && TT.block, xr, 'ratio', whyT(F.TT)) +
      trow('Order groups (Chinese first ÷ English first), onset', TO && TO.order, xr, 'ratio', whyT(F.TO)) +
      trow('Order groups (Chinese first ÷ English first), total', TT && TT.order, xr, 'ratio', whyT(F.TT)) +
      trow('Repeated answers (paired t-test)', repE, ppts, 'percentage points', repeat.test.reason === 'novar' ? 'No variation to test' : '') +
      grp('Exploratory · English proficiency, overall rating (mixed models with by-student language slopes)') +
      Object.keys(MEAS).map(k => trow(`${MEAS[k]}: change in the English − Chinese difference per rating point`, profE(profFit('overall', k), k), s2, PUNIT[k], profFit('overall', k) ? whyNot(profFit('overall', k)) || 'Not estimable yet' : 'Being estimated')).join('') +
      '</tbody>';
    $('#a-tests-note').innerHTML = 'Joint rows have no single estimate: they test several coefficients at once (χ² for the logistic model; <i>F</i> with Satterthwaite denominator degrees of freedom for the linear models). ' +
      'Starting-word rows are in valence points between chains that began with a positive and a negative starting word. Timing rows: English − Chinese in seconds from the models of the students’ median times; ratios below 1 mean faster. The exploratory lexical, mechanism and L1 tests are in their own section’s tables. Two-tailed, α = .05.' +
      (fA && fA.reason === 'separation' ? ` <strong>The transition model cannot be estimated yet:</strong> ${emptyText}.` : '') +
      (okA && fA.dropped.length ? ` Not estimable with the runs so far, so left out: ${fA.dropped.map(d => d.toLowerCase()).join('; ')}.` : '');
    renderProf();
    runMech(); renderMech();
    const MODELS = [
      ['Transition model (logistic)', fA, 'logit P(next positive) ~ language * previous_state + seed_valence + position + block'],
      ['Continuous-valence check (linear)', fC1, 'next_valence ~ language * (previous_valence − 5) + seed_valence + position + block'],
      ['Check without cut-points (curved, linear model)', F.C1Q, 'next_valence ~ language * (V + V^2) + seed_valence + position + block,  V = previous_valence − 5'],
      ['Trajectory model (linear)', fC, 'valence ~ language * (P + (P^2 − 8.25)) + seed_valence + block,  P = position − 5.5'],
      ['Starting-word model (linear)', fB, 'valence ~ language * seed_valence * log2(position) + block'],
      ['Response onset (linear, log seconds)', F.TO, 'log(median onset) ~ language * block', ' + (1 | student)'],
      ['Total response time (linear, log seconds)', F.TT, 'log(median total) ~ language * block', ' + (1 | student)'],
      ['Response onset, without flagged medians (linear, log seconds)', F.TOx, 'log(median onset) ~ language * block', ' + (1 | student)'],
      ['Total response time, without flagged medians (linear, log seconds)', F.TTx, 'log(median total) ~ language * block', ' + (1 | student)'],
      ['Three-state transition model (multinomial logit)', fastState.m3, 'log[P(next = k) / P(next = negative)] ~ language * previous_state3 + seed_valence + position + block,  k = neutral, positive', ' + (1 | student) + (1 | seed) + (1 | chain), each a pair over k with an unstructured covariance']
    ];
    $('#a-models').innerHTML = MODELS.map(([ttl, f, formula, re]) => `<h4 class="model-h">${ttl}</h4><p class="small muted"><code>${formula}${re || ' + (1 | student) + (1 | seed) + (1 | chain)'}</code></p>` +
      (!f || !f.ok ? `<p class="small">${whyNot(f)}.</p>` :
        `<div class="table-wrap" data-label="${ttl}"><table class="data"><thead><tr><th scope="col">Fixed effect</th><th class="num" scope="col"><i>b</i></th><th class="num" scope="col">SE</th><th class="num" scope="col">95% CI</th>` +
        `<th class="num sep" scope="col">${f.kind === 'lmm' ? '<i>t</i> (df)' : '<i>z</i>'}</th><th class="num" scope="col"><i>p</i></th></tr></thead><tbody>` +
        f.coef.map(c => `<tr><th scope="row">${c.name}</th><td class="num">${b3(c.b)}</td><td class="num">${c.se.toFixed(3)}</td><td class="num">${b3(c.ci[0])} to ${b3(c.ci[1])}</td>` +
          `<td class="num sep">${b2(c.stat)}${c.df ? ` (${dfShow(c.df)})` : ''}</td>${pCell(c)}</tr>`).join('') +
        `<tr class="group"><th scope="rowgroup" colspan="6"><span class="stick">Random intercepts (SD) · ${f.n.toLocaleString('en-US')} ${f === fA || f === fC1 || f === F.C1Q || f.kind === 'mglmm' ? 'transitions' : [F.TO, F.TT, F.TOx, F.TTx].includes(f) ? 'student medians' : 'answers'}${f.kind === 'lmm' ? ` · residual SD ${f.sigma.toFixed(2)}` : ''}</span></th></tr>` +
        (f.kind === 'mglmm' ? f.re.map((r, i) => `<tr><th scope="row">${r.name}s (${f.nLevels[i]})</th><td class="num" colspan="5">SD ${r.sd.map(v => v.toFixed(3)).join(' (neutral) and ')} (positive); correlation ${isFinite(r.corr) ? b2(r.corr) : '–'}</td></tr>`).join('')
          : f.groupNames.map((g, i) => `<tr><th scope="row">${g}s (${f.nLevels[i]})</th><td class="num">${f.sd[i].toFixed(3)}</td><td colspan="4"></td></tr>`).join('')) + '</tbody></table></div>')).join('');
    if ($('#a-robust-more').open) renderRobust();
    syncScrollers();
  }

  /* ---------- three-state transitions (multinomial model) ----------
     A: the omnibus test of the language terms; B: after each previous state, a
     2-df test, Holm-adjusted across the three; C: the two contrasts named in
     advance, negative → positive and positive → positive. A contrast is said
     to differ only when its CI excludes 0, its row's adjusted test is clear
     and the omnibus test is clear; otherwise the estimates are given. */
  const NM3 = { N: 'negative', U: 'neutral', P: 'positive' };
  const m3W = o => o && isFinite(o.p) ? { q: o.df, chi2: o.chi2, p: o.p, kind: 'chi2' } : null;
  const CUTS = [['c40', 4.0, 6.0, '4.0 / 6.0'], ['c45', 4.5, 5.5, '4.5 / 5.5']];
  const M3V = [['omni', 'the overall test', mm => clearW(m3W(mm.omni))],
    ['N', 'the test after a negative answer', mm => mm.rows.N.padj < 0.05], ['U', 'the test after a neutral answer', mm => mm.rows.U.padj < 0.05], ['P', 'the test after a positive answer', mm => mm.rows.P.padj < 0.05],
    ['NP', 'the negative → positive contrast', mm => clearCI(mm.diff.N.P)], ['PP', 'the positive → positive contrast', mm => clearCI(mm.diff.P.P)]];
  const m3Changes = (mm, main) => M3V.filter(([, , f]) => f(mm) !== f(main)).map(([k, name, f]) => ({ k, name, clear: f(mm) }));
  function m3Story(m) {
    const w = m3W(m.omni), clearO = clearW(w), adj = s => m.rows[s] ? m.rows[s].padj : NaN;
    const rowOK = s => isFinite(adj(s)) && adj(s) < 0.05;
    const pr = (l, a, b) => m.prob[l][a][b].est, d = (a, b) => U(m.diff[a][b]);
    const lead = clearO ? 'The three-state transition pattern differs between Chinese and English.' : 'There is no clear overall language difference in the three-state transition pattern.';
    const clearRows = ['N', 'U', 'P'].filter(rowOK), otherRows = ['N', 'U', 'P'].filter(s => !rowOK(s));
    const rowsSay = !clearRows.length ? 'Taken one previous state at a time, none shows a clear language difference in where the next answer goes (Holm-adjusted).'
      : `After a ${orList(clearRows.map(s => NM3[s]))} answer, the distribution of the next state differs by language (Holm-adjusted)${otherRows.length ? `; after a ${orList(otherRows.map(s => NM3[s]))} answer there is no clear difference` : ''}.` +
        (clearO ? '' : ' The overall test is not clear, so this is not evidence of a language difference on its own.');
    const rowStat = ['N', 'U', 'P'].map(s => m.rows[s] ? `after a ${NM3[s]} answer χ²(2) = ${m.rows[s].chi2.toFixed(2)}, ${LAB.fmtP(m.rows[s].p)} (Holm-adjusted ${LAB.fmtP(m.rows[s].padj)})` : '').filter(Boolean).join('; ');
    // a contrast and, when it is supported, its complement in the same row
    const cell = (a, b, verb, comp, compVerb) => {
      const e = d(a, b), en = pr('en', a, b), zh = pr('zh', a, b), ok = clearO && rowOK(a) && clearCI(e);
      const c = d(a, comp), compSay = ok && clearCI(c) ? ` and ${compVerb} ${c.est > 0 ? 'more' : 'less'} often (${p2(pr('en', a, comp))} vs ${p2(pr('zh', a, comp))})` : '';
      const name = `${cap(NM3[a])} → ${NM3[b]}`;
      const say = ok ? `After a ${NM3[a]} answer, English ${verb} ${e.est > 0 ? 'more' : 'less'} often than Chinese (${p2(en)} vs ${p2(zh)})${compSay}.`
        : clearCI(e) ? `${name}: English ${p2(en)}, Chinese ${p2(zh)}. The difference’s CI excludes zero, but ${!clearO ? 'the overall test is not clear' : `the test after a ${NM3[a]} answer is not clear after adjustment`}, so this is not evidence of a language difference on its own.`
        : `${name}: English ${p2(en)}, Chinese ${p2(zh)}; no clear language difference.`;
      return { e, ok, say, name, stat: `English − Chinese ${eTxt(e, pr2)}; ${statTxt(e)}` };
    };
    const NP = cell('N', 'P', 'moves to a positive state', 'N', 'stays negative'), PP = cell('P', 'P', 'stays in a positive state', 'U', 'moves to a neutral state');
    return { w, clearO, lead, rowsSay, rowStat, NP, PP, rowOK };
  }
  /* The check without cut-points: next valence as a curve of previous valence
     (linear and squared, centred at 5), by language. Its test is the joint
     test of the two language × previous-valence terms (a difference in shape);
     the language term is the level difference at a previous valence of 5. */
  function c1qStory(f) {
    if (!f || !f.ok) return null;
    const w = f.wald(['Language × previous valence', 'Language × previous valence²']), lvl = U(f.coefOf(LANGT));
    if (!w || !lvl) return null;
    const cv = { '(Intercept)': 1, 'Seed valence (per point)': cm(f, 'Seed valence (per point)'), 'Position (per step)': cm(f, 'Position (per step)'), 'Block (second − first)': cm(f, 'Block (second − first)') };
    const pred = (L, v) => U(f.contrast(Object.assign({ [LANGT]: L, 'Previous valence (per point)': v - 5, 'Previous valence²': (v - 5) * (v - 5), 'Language × previous valence': L * (v - 5), 'Language × previous valence²': L * (v - 5) * (v - 5) }, cv)));
    const say = clearW(w) ? 'The two curves differ in shape: the next answer’s valence depends on the previous answer’s differently in Chinese and English.'
      : 'No clear language difference in how the next answer’s valence depends on the previous answer’s: the two curves do not clearly differ in shape.';
    const level = clearCI(lvl) ? ` At a previous valence of 5 the next answer is ${s2(lvl.est)} points ${lvl.est > 0 ? 'more' : 'less'} positive in English (a difference in level, not in shape).` : '';
    return { w, lvl, pred, say: say + level, clear: clearW(w) };
  }
  function renderC1Q(x, Q) {
    const f = fastState.fits.C1Q;
    if (!Q) { $('#a-c1q').innerHTML = `<p class="empty">${dot(whyNot(f))}</p>`; $('#a-res-c1q').innerHTML = pending(f); return; }
    $('#a-res-c1q').innerHTML = res('Check without cut-points', Q.say, `Joint test of Language × previous valence and Language × previous valence²: ${wTxt(Q.w)}; English − Chinese at a previous valence of 5: ${eTxt(Q.lvl, s2, 'points')}${smallTag(x.n)}`, 'primary');
    const series = {};
    ['zh', 'en'].forEach(l => {
      const L = l === 'en' ? 0.5 : -0.5, line = [];
      for (let v = 1; v <= 9 + 1e-9; v += 0.25) { const c = Q.pred(L, v); line.push({ x: v, y: c.est, lo: c.lo, hi: c.hi }); }
      const dots = [];
      for (let b = 1; b <= 9; b++) { const ys = x.tr2.filter(t => t.lang === l && Math.round(t.prevV) === b).map(t => t.nextV); if (ys.length >= 10) dots.push({ x: b, y: LAB.mean(ys), n: ys.length }); }
      series[l] = { line, dots };
    });
    FC.lines($('#a-c1q'), { series, faint: true, xDomain: [1, 9], xTicks: [1, 2, 3, 4, 5, 6, 7, 8, 9], xLabel: 'Previous answer’s valence',
      yStep: 1, yFmt: v => String(Math.round(v)), yRef: 5, yFloor: 1, yCeil: 9, yLabel: 'Next answer’s valence',
      dotTitle: (l, d) => `${LANG_NAME[l]}, observed: previous answers rated about ${d.x}, next answer ${d.y.toFixed(2)} on average (${d.n} transitions)`,
      lineTitle: l => `${LANG_NAME[l]}, model-adjusted curve`,
      label: `Next answer’s valence as a curve of the previous answer’s valence, model-adjusted, by language. ${Q.say}` });
  }
  /* Leave one starting word out: the three-state model refitted without each
     starting word in turn (fitted when its section is opened). Only ranges and
     counts are shown, never which word. */
  function runLoso() {
    const key = fastState.fitKey, M = fastState.m3, x = fastState.ctx;
    if (!x || !M || !M.ok || fastState.m3Key !== key) { renderLoso(); return; }
    if (fastState.loso && fastState.loso.key === key) { renderLoso(); return; }
    const seeds = [...new Set(x.tr3.map(t => t.seed))].sort();
    const L = { key, fits: {}, total: seeds.length, done: 0 };
    fastState.loso = L;
    const lanes = [[], [], [], []];
    seeds.forEach((sd, i) => lanes[i % 4].push({ key: 'loso:' + sd, model: 'M3', tr: x.tr3.filter(t => t.seed !== sd), start: M.theta }));
    lanes.forEach((jobs, i) => fitJobs('loso:' + i, jobs, (k, f) => { if (fastState.loso !== L) return; L.fits[k.slice(5)] = f; L.done++; renderLoso(); }));
    renderLoso();
  }
  function renderLoso() {
    const L = fastState.loso, M = fastState.m3, st = $('#a-m3-loso-status');
    if (!M || !M.ok || !L || L.key !== fastState.fitKey) {
      st.textContent = !M ? 'Waits for the three-state model.' : !M.ok ? 'The three-state model could not be estimated.' : $('#a-m3-loso-more').open ? 'Starting…' : '';
      $('#a-m3-loso').innerHTML = ''; $('#a-m3-loso-note').textContent = ''; return;
    }
    const fin = L.done >= L.total, m = M.m3;
    st.textContent = fin ? 'All refits done.' : `Fitting… ${L.done} of ${L.total}`;
    st.classList.toggle('visually-hidden', fin);
    const fits = Object.values(L.fits).filter(f => f && f.ok && f.m3).map(f => f.m3), bad = L.done - fits.length;
    const mainO = clearW(m3W(m.omni));
    const rows = [
      ['Overall test, χ²(6)', mm => mm.omni.chi2, v => v.toFixed(2), mm => clearW(m3W(mm.omni)), mm => mm.omni.p],
      ['Negative → positive, E − C', mm => mm.diff.N.P.est, pr2, mm => clearCI(mm.diff.N.P), mm => mm.diff.N.P.p],
      ['Positive → positive, E − C', mm => mm.diff.P.P.est, pr2, mm => clearCI(mm.diff.P.P), mm => mm.diff.P.P.p],
      // the claim about positive → positive also rests on this test
      ['Test after a positive answer, Holm-adjusted <i>p</i>', mm => mm.rows.P.padj, v => LAB.fmtPval(v), mm => mm.rows.P.padj < 0.05, null]
    ];
    const lo = (g, fmt) => fits.length ? `${fmt(Math.min(...fits.map(g)))} to ${fmt(Math.max(...fits.map(g)))}` : '–';
    $('#a-m3-loso').innerHTML = `<thead><tr><th scope="col">Result</th><th class="num" scope="col">Main analysis</th><th class="num sep" scope="col">Across the refits</th><th class="num" scope="col">Same verdict</th></tr></thead><tbody>` +
      rows.map(([name, g, fmt, ok, pv]) => `<tr><th scope="row">${name}</th><td class="num">${fmt(g(m))}${pv ? ` <span class="rp">${LAB.fmtP(pv(m))}</span>` : ''}</td>` +
        `<td class="num sep">${lo(g, fmt)}${pv ? ` <span class="rp">${fits.length ? `<i>p</i> ${LAB.fmtPval(Math.min(...fits.map(pv)))} to ${LAB.fmtPval(Math.max(...fits.map(pv)))}` : ''}</span>` : ''}</td>` +
        `<td class="num">${fits.length ? `${fits.filter(mm => ok(mm) === ok(m)).length} of ${fits.length}` : '–'}</td></tr>`).join('') + '</tbody>';
    const flipO = fits.filter(mm => clearW(m3W(mm.omni)) !== mainO).length, flipP = fits.filter(mm => (mm.rows.P.padj < 0.05) !== (m.rows.P.padj < 0.05)).length;
    const say = !fin ? '' : `${!fits.length ? 'No refit could be estimated.' : flipO ? `Leaving out one starting word changes the overall verdict in ${flipO} of ${fits.length} refits.` : `Leaving out any one starting word keeps the overall verdict (${mainO ? 'clear' : 'not clear'}) in all ${fits.length} refits.`}${bad ? ` ${bad} refit${bad > 1 ? 's' : ''} could not be estimated.` : ''}`;
    $('#a-m3-loso-note').innerHTML = `Same verdict: a clear omnibus test (<i>p</i> &lt; .05), a contrast whose CI excludes zero, or an adjusted <i>p</i> below .05, as in the main analysis. ${say}${fin && flipP ? ` The test after a positive answer, which the positive → positive statement also needs, changes verdict in ${flipP} of ${fits.length} refits, so that statement depends on the particular set of starting words.` : ''}`;
    $('#a-m3-loso-sum').textContent = !fin ? `: fitting ${L.done} of ${L.total}` : !fits.length ? '' : flipO ? `: the overall verdict changes in ${flipO} of ${fits.length} refits` : `: the same overall verdict in all ${fits.length} refits`;
  }
  // The share of each language's scored answers in each state, under the main and the alternative cut-points and equating.
  function renderStateShares(parts) {
    const pct = FA.relink(parts, FA.percentileLink(fastState.norms));
    const share = (ps, st) => { const o = {}; ['zh', 'en'].forEach(l => { const v = ps.flatMap(Pp => Pp.chains.filter(c => c.lang === l).flatMap(c => c.answers.map(a => st(a.valence)))).filter(Boolean);
      o[l] = { n: v.length }; FA.STATES3.forEach(k => { o[l][k] = v.length ? v.filter(x => x === k).length / v.length : NaN; }); }); return o; };
    const R = [['Linear equating, 4.2 / 5.8 (main)', share(parts, FA.state3)], ['Percentile equating, 4.2 / 5.8', share(pct, FA.state3)], ['Linear equating, 4.0 / 6.0', share(parts, FA.state3cuts(4, 6))], ['Linear equating, 4.5 / 5.5', share(parts, FA.state3cuts(4.5, 5.5))]];
    $('#a-m3-props').innerHTML = `<caption class="tbl-cap">Share of scored answers in each state</caption><thead><tr><th scope="col" rowspan="2">States from</th><th scope="colgroup" colspan="3" class="sep">Chinese</th><th scope="colgroup" colspan="3" class="sep">English</th></tr>` +
      `<tr>${'<th class="num sep" scope="col">Neg.</th><th class="num" scope="col">Neutral</th><th class="num" scope="col">Pos.</th>'.repeat(2)}</tr></thead><tbody>` +
      R.map(([name, o]) => `<tr><th scope="row">${name}</th>${['zh', 'en'].map(l => FA.STATES3.map((k, i) => `<td class="num${i ? '' : ' sep'}">${pct1(o[l][k])}</td>`).join('')).join('')}</tr>`).join('') + '</tbody>';
    const m = R[0][1], q = R[1][1];
    $('#a-m3-props-note').textContent = `Descriptive. Every scored answer, wherever it sits in a chain (${m.zh.n.toLocaleString('en-US')} Chinese, ${m.en.n.toLocaleString('en-US')} English); unscored answers are in no state, and an unscored answer removes the transitions on either side of it in both analyses. Under the main cut-points, ${pct1(m.zh.U)} of Chinese and ${pct1(m.en.U)} of English answers are neutral; percentile equating changes only the Chinese values (neutral ${pct1(q.zh.U)}).`;
  }
  function renderM3(x, J) {
    const f = fastState.m3, m = f && f.ok && f.m3, X = fastState.extras, st = smallTag(x.n), Q = c1qStory(fastState.fits.C1Q);
    renderC1Q(x, Q);
    renderLoso();
    if (!m) {
      $('#a-m3-sum').textContent = !f ? ': still being fitted' : `: ${whyNot(f).toLowerCase()}`;
      $('#a-res-m3').innerHTML = pending(f); $('#a-m3').innerHTML = `<p class="empty">${dot(whyNot(f))}</p>`;
      $('#a-m3-table').innerHTML = ''; $('#a-m3-table-note').textContent = ''; $('#a-m3-cuts').innerHTML = ''; $('#a-m3-cuts-note').textContent = ''; $('#a-m3-cuts-sum').textContent = '';
      return null;
    }
    const M = m3Story(m);
    $('#a-m3-sum').innerHTML = `: ${M.clearO ? 'differs by language' : 'no clear overall language difference'} (${wTxt(M.w)})`;
    FC.dest3($('#a-m3'), { prob: m.prob, label: `Model-adjusted three-state transition probabilities. ${['N', 'U', 'P'].map(a => `After a ${NM3[a]} answer, next negative, neutral, positive: Chinese ${['N', 'U', 'P'].map(b => p2(m.prob.zh[a][b].est)).join(', ')}; English ${['N', 'U', 'P'].map(b => p2(m.prob.en[a][b].est)).join(', ')}`).join('. ')}.` });
    // the cut-point checks, once fitted
    const cutF = X && X.key === fastState.fitKey ? X.cuts : {};
    const cutW = CUTS.map(([k, lo, hi, label]) => { const f = cutF[k], mm = f && f.ok && f.m3; return { label, f, mm, w: mm ? m3W(mm.omni) : null, ch: mm ? m3Changes(mm, m) : [] }; });
    const cutsDone = cutW.every(c => c.f), cutsDiffer = cutW.filter(c => c.w && clearW(c.w) !== M.clearO), anyCh = cutW.some(c => c.ch.length);
    const cutSay = !cutsDone ? 'The same model with other cut-points is being fitted.' :
      cutW.map(c => !c.mm ? `At ${c.label} the model could not be estimated.` : `At ${c.label} (overall ${wTxt(c.w)}), ${c.ch.length ? andList(c.ch.map(x => `${x.name} ${x.clear ? 'becomes clear' : 'is no longer clear'}`)) : 'every verdict is the same as at 4.2 / 5.8'}.`).join(' ') +
      (cutsDiffer.length ? ' So the overall three-state verdict depends on where the neutral band is drawn.' : anyCh ? ' The overall verdict is the same, but some follow-up verdicts depend on the cut-points.' : '');
    // the robustness checks, once fitted
    const R3 = X && X.key === fastState.fitKey ? X.r3 : {}, RK = [['all', 'with all students'], ['nochain', 'without chain intercepts'], ['slopes', 'with by-student language slopes'], ['percentile', 'with percentile equating']];
    const r3Done = RK.every(([k]) => R3[k]), r3W = RK.map(([k, t]) => ({ t, f: R3[k], w: R3[k] && R3[k].ok && R3[k].m3 ? m3W(R3[k].m3.omni) : null }));
    // threshold-sensitive: no clear difference without cut-points, and some verdict changes with them
    const secondary = !!Q && !Q.clear && cutsDone && anyCh;
    const r3Say = !r3Done ? 'Its robustness checks are being fitted.' : (() => {
      const est = r3W.filter(c => c.w), no = r3W.filter(c => !c.w), diff = est.filter(c => clearW(c.w) !== M.clearO);
      const same = est.filter(c => clearW(c.w) === M.clearO);
      return (est.length ? (diff.length ? `In the robustness checks the overall verdict ${same.length ? `is the same ${andList(same.map(c => c.t))}, but it ` : ''}changes ${andList(diff.map(c => `${c.t} (${wTxt(c.w)})`))}` : `The overall verdict is the same in ${est.length === RK.length ? 'all four' : `the ${est.length} estimable`} robustness checks`) : 'No robustness check could be estimated') +
        (no.length ? `; ${andList(no.map(c => c.t))}: could not be estimated` : '') + '.';
    })();
    $('#a-res-m3').innerHTML =
      res('Main test', `<span class="r-lead">${M.lead}</span>`, `Joint test of the six language terms (both logits): ${wTxt(M.w)}${st}`, 'primary') +
      res('Follow-up, by previous state', M.rowsSay, M.rowStat + st) +
      res('Contrast named in advance', M.NP.say, M.NP.stat + st) +
      res('Contrast named in advance', M.PP.say, M.PP.stat + st) +
      res('Sensitivity', `${cutSay} ${r3Say}`, '') +
      (Q ? res('Check without cut-points', Q.say, `${wTxt(Q.w)} (see below)`) : '') +
      (secondary ? res('Conclusion', `The check without cut-points finds no clear language difference in the shape of the transitions, while the three-state verdicts change with the cut-points. The three-state evidence is therefore threshold-sensitive and is treated as descriptive and secondary.`, '') : '') +
      (() => {   // the bridge to the trajectory result, only when every part of it is supported
        const seg = J && J.segs && J.segs[1], laterZh = seg && clearW(J.w) && clearCI(seg.g) && clearCI(seg.zh) && !clearCI(seg.en);
        const pat = [M.NP.ok && M.NP.e.est > 0 && 'more moves from a negative to a positive state', M.PP.ok && M.PP.e.est > 0 && 'more positive persistence'].filter(Boolean);
        return M.clearO && pat.length && laterZh && !cutsDiffer.length ? res('Interpretation', `The three-state transitions may help describe how the broader trajectories develop: English shows ${andList(pat)}, while Chinese continues changing in mean valence later in the chain. This describes; it does not show that the transitions produce the trajectories.`, '') : '';
      })();
    // numbers
    const ci = e => `<span class="ci">[${p2(e.lo)}, ${p2(e.hi)}]</span>`;
    $('#a-m3-table').innerHTML = `<caption class="tbl-cap">Model-adjusted three-state transition probabilities</caption><thead><tr><th scope="col">Next state</th><th class="num" scope="col">Chinese</th><th class="num" scope="col">English</th><th class="num sep" scope="col">English − Chinese</th></tr></thead><tbody>` +
      ['N', 'U', 'P'].map(a => `<tr class="group"><th scope="rowgroup" colspan="4"><span class="stick">After a ${NM3[a]} answer · χ²(2) = ${m.rows[a].chi2.toFixed(2)}, ${LAB.fmtP(m.rows[a].p)}, Holm-adjusted ${LAB.fmtP(m.rows[a].padj)}</span></th></tr>` +
        ['N', 'U', 'P'].map(b => { const e = m.diff[a][b], key = (a === 'N' && b === 'P') || (a === 'P' && b === 'P');
          return `<tr><th scope="row">${cap(NM3[b])}${key ? ' <small class="muted">(named in advance)</small>' : ''}</th><td class="num">${p2(m.prob.zh[a][b].est)}${ci(m.prob.zh[a][b])}</td><td class="num">${p2(m.prob.en[a][b].est)}${ci(m.prob.en[a][b])}</td>` +
            `<td class="num sep${clearCI(e) ? ' r-sig' : ''}"><strong>${pr2(e.est)}</strong><span class="ci">[${fine(pr2, e.lo)}, ${fine(pr2, e.hi)}]</span>${key ? `<span class="rp">${LAB.fmtP(e.p)}</span>` : ''}</td></tr>`; }).join('')).join('') + '</tbody>';
    $('#a-m3-table-note').innerHTML = `Model-adjusted probabilities with 95% CIs; within each previous state the three sum to 1 in each language. Group rows: the joint test of the language difference after that previous state (χ², 2 df) and its Holm-adjusted <i>p</i> across the three. <i>p</i> is shown only for the two contrasts named in advance. ${m.n.toLocaleString('en-US')} transitions.`;
    // cut-point table
    // bold: clear; "clear here" / "not clear here": a verdict that differs from the main cut-points
    const cutRow = (label, mm, note) => {
      if (!mm) return `<tr><th scope="row">${label}</th><td colspan="6" class="muted">${note}</td></tr>`;
      const ch = mm === m ? [] : m3Changes(mm, m), flip = k => { const c = ch.find(x => x.k === k); return c ? `<span class="flip">${c.clear ? 'clear here' : 'not clear here'}</span>` : ''; };
      const bold = (on, t) => on ? `<b>${t}</b>` : t;
      return `<tr><th scope="row">${label}</th><td class="num${clearW(m3W(mm.omni)) ? ' r-sig' : ''}">${bold(clearW(m3W(mm.omni)), mm.omni.chi2.toFixed(2))}<span class="rp">${LAB.fmtP(mm.omni.p)}</span>${flip('omni')}</td>` +
        ['N', 'U', 'P'].map(a => `<td class="num${mm.rows[a].padj < 0.05 ? ' r-sig' : ''}">${bold(mm.rows[a].padj < 0.05, LAB.fmtPval(mm.rows[a].padj))}${flip(a)}</td>`).join('') +
        [['N', 'P', 'NP'], ['P', 'P', 'PP']].map(([a, b, k]) => { const e = mm.diff[a][b]; return `<td class="num${clearCI(e) ? ' r-sig' : ''}">${bold(clearCI(e), pr2(e.est))} <span class="rci">[${fine(pr2, e.lo)}, ${fine(pr2, e.hi)}]</span>${flip(k)}</td>`; }).join('') + '</tr>';
    };
    $('#a-m3-cuts').innerHTML = `<thead><tr><th scope="col">Cut-points</th><th class="num" scope="col">Overall χ²(6)</th><th class="num" scope="col">After neg. (Holm <i>p</i>)</th><th class="num" scope="col">After neutral</th><th class="num" scope="col">After pos.</th><th class="num sep" scope="col">Neg. → pos., E − C</th><th class="num" scope="col">Pos. → pos., E − C</th></tr></thead><tbody>` +
      cutRow('4.2 / 5.8 (main)', m) + cutW.map(c => cutRow(c.label, c.f && c.f.ok ? c.f.m3 : null, !c.f ? 'Being fitted…' : `${whyNot(c.f)}.`)).join('') + '</tbody>';
    $('#a-m3-cuts-note').innerHTML = `Each row is the same model with its own neutral band (negative below the first value, positive from the second). Bold: clear (omnibus <i>p</i> &lt; .05, Holm-adjusted <i>p</i> &lt; .05, or a CI excluding zero); “clear here” / “not clear here”: the verdict differs from 4.2 / 5.8. ${cutsDone ? cutSay : ''}`;
    $('#a-m3-cuts-sum').textContent = !cutsDone ? '' : cutsDiffer.length ? ': the overall verdict depends on the cut-points' : anyCh ? ': some follow-up verdicts depend on the cut-points' : ': the same verdicts';
    return Object.assign(M, { cutsDiffer, cutsDone, secondary, Q });
  }

  /* ---------- timing: with and without the medians the robust rule flags ---------- */
  // One sentence: do the language differences keep their verdicts without the flagged medians? (The counts and intervals are in the fold.)
  function timingSensSay(TO, TT, TOx, TTx, O) {
    if (!TO || !TT) return '';
    const nf = { onset: O.onset.flagged.size, total: O.total.flagged.size };
    if (!nf.onset && !nf.total) return 'The prespecified robust timing rule flags no student’s median.';
    if ((nf.onset && !TOx) || (nf.total && !TTx)) return 'The timing models without the medians flagged by the robust timing rule are being fitted.';
    const both = [[TO, TOx, 'onset'], [TT, TTx, 'total']].filter(([, , nm]) => nf[nm]);
    const S = '\u00a0s', nums = both.map(([a, b, nm]) => `${nm} ${s2(b.est)}${S} (${xr(b.lang.est)}), against ${s2(a.est)}${S} with everyone`).join('; ');
    const flagged = `flagged: ${andList(both.map(([, , nm]) => `${nf[nm]} student${nf[nm] === 1 ? '' : 's'} for ${nm}`))}`;
    const kept = both.every(([a, b]) => clearCI(a) && clearCI(b) && a.est > 0 && b.est > 0);
    const flips = both.filter(([a, b]) => clearCI(a) !== clearCI(b)).map(([, , nm]) => nm);
    return kept ? `English responses remained slower after excluding extreme timing observations (${flagged}): ${nums}.`
      : `Without the extreme timing observations (${flagged}): ${nums}${flips.length ? `; the ${andList(flips)} difference changes verdict` : ''}.`;
  }
  function renderTimingSens(TO, TT, TOx, TTx, x) {
    const O = x.tOut, ci = e => `<span class="ci">[${e.lo.toFixed(2)}, ${e.hi.toFixed(2)}]</span>`;
    const row = (label, e, n) => !e ? `<tr><th scope="row">${label}</th><td colspan="8" class="muted">Being fitted…</td></tr>` :
      `<tr><th scope="row">${label}</th><td class="num">${n}</td><td class="num">${b2(e.zh)}</td><td class="num">${b2(e.en)}</td>` +
      `<td class="num sep${clearCI(e) ? ' r-sig' : ''}"><strong>${s2(e.est)}</strong><span class="ci">[${s2(e.lo)}, ${s2(e.hi)}]</span></td><td class="num">${xr(e.lang.est)}${ci(e.lang)}</td><td class="num">${LAB.fmtPval(e.p)}</td>` +
      `<td class="num sep">${xr(e.block.est)}${ci(e.block)}</td><td class="num">${xr(e.order.est)}${ci(e.order)} <span class="rp">${LAB.fmtP(e.order.p)}</span></td></tr>`;
    $('#a-tsens').innerHTML = `<thead><tr><th scope="col">Model</th><th class="num" scope="col">Students</th><th class="num" scope="col">Chinese (s)</th><th class="num" scope="col">English (s)</th><th class="num sep" scope="col">English − Chinese (s)</th><th class="num" scope="col">Ratio</th><th class="num" scope="col"><i>p</i></th><th class="num sep" scope="col">Block, second ÷ first</th><th class="num" scope="col">Order groups (language × block)</th></tr></thead><tbody>` +
      ['onset', 'total'].map(m => { const all = m === 'onset' ? TO : TT, sub = m === 'onset' ? TOx : TTx, nf = O[m].flagged.size, Nm = cap(m);
        return row(`${Nm}, all analysed students`, all, O[m].n) + (nf ? row(`${Nm}, without the ${nf} flagged`, sub, O[m].n - nf) : `<tr><th scope="row">${Nm}: no value flagged</th><td colspan="8" class="muted">The sensitivity model is the primary model.</td></tr>`); }).join('') + '</tbody>';
    const desc = m => ['zh', 'en'].filter(l => O[m].byLang[l].flagged).map(l => { const b = O[m].byLang[l]; return `${b.flagged} ${LANG_NAME[l]} median${b.flagged > 1 ? 's' : ''} (${b.slow === b.flagged ? 'slow' : !b.slow ? 'fast' : `${b.slow} slow, ${b.flagged - b.slow} fast`})`; }).join(' and ') || 'none';
    $('#a-tsens-note').innerHTML = `Flagged values: onset ${desc('onset')}; total ${desc('total')}. ` + 'The same model in every row: log(median time) ~ language × block + (1 | student). Chinese and English: predicted times (geometric means over students); ratio: English ÷ Chinese; order groups: Chinese-first ÷ English-first, from the language × block term. Flagged: |robust <i>z</i>| &gt; 3.5 on a log median in either language (see Methods). Flagged students stay in every other analysis.';
    $('#a-tsens-method').textContent = `In this class: ${O.onset.flagged.size} student${O.onset.flagged.size === 1 ? '' : 's'} flagged for onset and ${O.total.flagged.size} for total time, of ${O.onset.n} and ${O.total.n}${['onset', 'total'].some(m => ['zh', 'en'].some(l => O[m].byLang[l].method !== 'mad')) ? '; the fences were used where MAD was 0' : ''}.`;
  }

  /* ---------- after the main fits and the three-state model: their checks ----------
     The three-state model with other cut-points and in the robustness checks,
     and the primary models and the three-state model with other coverage
     thresholds (the repetition and first-language rules kept). Each
     three-state fit starts from the main fit's covariance parameters. */
  const COVTH = [0.5, 0.6, 0.7, 0.8];
  function coverageSample(th) {
    const all = fastState.allParts, E = fastState.excl, per = FA.perParticipant(all);
    return all.filter((Pp, i) => !E.extreme.has(Pp.key) && !E.l1.has(Pp.key) && (th <= 0 || ['zh', 'en'].every(l => per[i].lang[l].possible > 0 && per[i].lang[l].valid / per[i].lang[l].possible >= th)));
  }
  function runExtras() {
    const key = fastState.fitKey, F = fastState.fits, M = fastState.m3;
    if (!fastState.norms || !fastState.parts.length || fastState.updating) return;
    if (!M || fastState.m3Key !== key || !['A', 'B', 'C', 'TO', 'TT'].every(k => F[k])) return;
    if (fastState.extras && fastState.extras.key === key) return;
    const X = { key, cuts: {}, r3: {}, cov: {}, done: 0, total: 0 };
    fastState.extras = X;
    const parts = fastState.parts, th3 = M.ok ? M.theta : null;
    const pct = FA.relink(parts, FA.percentileLink(fastState.norms));
    const m3job = (k, ps, extra) => Object.assign({ key: k, model: 'M3', tr: FA.transitions(ps, FA.state3), start: th3 }, extra || {});
    const cut = ([k, lo, hi]) => ({ key: 'cut:' + k, model: 'M3', tr: FA.transitions(parts, FA.state3cuts(lo, hi)), start: th3 });
    const cov = th => {
      const ps = coverageSample(th), tr = FA.transitions(ps, FA.state2), an = FA.answers(ps);
      X.cov[th] = { n: ps.length };
      return [{ key: `cov:${th}:A`, model: 'A', tr }, { key: `cov:${th}:C`, model: 'C', ans: an }, { key: `cov:${th}:B`, model: 'B', ans: an }, m3job(`cov:${th}:M3`, ps)];
    };
    // four workers of about equal length (the all-students three-state fit is the largest single job)
    const lanes = [
      [m3job('r3:all', fastState.allParts)],
      [cut(CUTS[1])].concat(cov(0.7), cov(0.8)),
      [cut(CUTS[0]), m3job('r3:nochain', parts, { chain: false, start: th3 && th3.slice(0, 6) })].concat(cov(0.5)),
      [m3job('r3:percentile', pct), m3job('r3:slopes', parts, { slopes: true, start: th3 && th3.slice(0, 3).concat([0.3, 0, 0.3], th3.slice(3)) })].concat(cov(0.6))
    ];
    X.total = lanes.reduce((s0, l) => s0 + l.length, 0);
    const got = (k, f) => {
      if (fastState.extras !== X) return;
      const [g, a, b] = k.split(':');
      if (g === 'cut') X.cuts[a] = f; else if (g === 'r3') X.r3[a] = f; else X.cov[a][b] = f;
      X.done++;
      renderFastModels();
    };
    lanes.forEach((jobs, i) => fitJobs('extra:' + i, jobs, got));
    renderFastModels();
  }
  // The primary conclusions (and the three-state test) at each coverage threshold.
  function covRows() {
    const X = fastState.extras, x = fastState.ctx, F = fastState.fits;
    if (!X || X.key !== fastState.fitKey || !x) return null;
    const seedW = fB => fB && fB.ok ? scaleE(U(fB.coefOf('Language × seed valence × position')), x.dSV * Math.log2(x.nPos)) : null;
    const one = (th, n, fA, fC, fB, f3) => ({ th, n, fA, fC, fB, f3,
      A: fA && fA.ok ? fA.wald([LANGT, PREV]) : null, C: fC && fC.ok ? fC.wald(['Language × position', 'Language × position²']) : null, B: seedW(fB), M3: f3 && f3.ok && f3.m3 ? m3W(f3.m3.omni) : null });
    const rows = COVTH.map(th => { const c = X.cov[th]; return one(th, c.n, c.A, c.C, c.B, c.M3); });
    rows.unshift(one(0, x.n, F.A, F.C, F.B, fastState.m3));
    return rows;
  }
  function renderCov() {
    const rows = covRows();
    if (!rows) { $('#a-cov').innerHTML = ''; $('#a-cov-status').textContent = 'Fitted after the main models.'; $('#a-cov-sum').textContent = ''; return null; }
    const X = fastState.extras, covJobs = COVTH.length * 4, covDone = COVTH.reduce((s0, th) => s0 + ['A', 'C', 'B', 'M3'].filter(k => X.cov[th][k]).length, 0);
    const st = $('#a-cov-status'), fin = covDone >= covJobs;
    st.textContent = fin ? 'All thresholds fitted.' : `Fitting… ${covDone} of ${covJobs}`;
    st.classList.toggle('visually-hidden', fin);
    const main = rows.find(r => r.th === 0);
    const verdict = (k, e) => k === 'B' ? clearCI(e) : clearW(e);
    const cell = (r, k, f, sep) => {
      const e = r[k];
      if (!e) return `<td class="num${sep ? ' sep' : ''} muted">${!f ? '…' : '–'}</td>`;
      const flip = r !== main && main[k] && verdict(k, main[k]) !== verdict(k, e);
      const body = k === 'B' ? `<b>${s2(e.est)}</b> <span class="rci">[${fine(s2, e.lo)}, ${fine(s2, e.hi)}]</span>` : `<b>${(k === 'C' ? e.F : e.chi2).toFixed(2)}</b>`;
      return `<td class="num${sep ? ' sep' : ''}${verdict(k, e) ? ' r-sig' : ''}">${body}<span class="rp">${LAB.fmtP(e.p)}</span>${flip ? `<span class="flip">${verdict(k, e) ? 'clear here' : 'not clear here'}</span>` : ''}</td>`;
    };
    $('#a-cov').innerHTML = `<thead><tr><th scope="col">Coverage rule</th><th class="num" scope="col">Students</th><th class="num sep" scope="col">Transition pattern, χ²(2)</th><th class="num" scope="col">Trajectory shape, <i>F</i></th><th class="num" scope="col">Starting-word decay, E − C (points)</th><th class="num" scope="col">Three-state, χ²(6)</th></tr></thead><tbody>` +
      rows.map(r => `<tr${r === main ? ' class="main-row"' : ''}><th scope="row">${r.th ? `At least ${Math.round(r.th * 100)}%` : 'None'}${r === main ? ' <small class="muted">(main analysis)</small>' : ''}</th><td class="num">${r.n}</td>` +
        `${cell(r, 'A', r.fA, true)}${cell(r, 'C', r.fC)}${cell(r, 'B', r.fB)}${cell(r, 'M3', r.f3)}</tr>`).join('') + '</tbody>';
    // which conclusions change verdict at another threshold
    const NAMES = [['A', 'the transition conclusion'], ['C', 'the trajectory conclusion'], ['B', 'the starting-word decay conclusion'], ['M3', 'the three-state conclusion']];
    const changes = NAMES.map(([k, name]) => ({ name, at: rows.filter(r => r !== main && r[k] && main[k] && verdict(k, r[k]) !== verdict(k, main[k])).map(r => `${Math.round(r.th * 100)}%`) })).filter(c => c.at.length);
    const say = !fin ? '' : !changes.length ? 'Every conclusion has the same verdict at every threshold.' :
      `${cap(andList(changes.map(c => `${c.name} changes verdict with ${andList(c.at)}`)))}; the others keep their verdicts.`;
    $('#a-cov-note').innerHTML = `Repetition and first-language rules kept in every row; bold: clear (joint <i>p</i> &lt; .05, or a CI excluding zero); “clear here” / “not clear here”: the verdict differs from the main analysis (no coverage rule). ${say}`;
    $('#a-cov-sum').textContent = !fin ? '' : changes.length ? ': some conclusions depend on the threshold' : ': the same verdicts at every threshold';
    return fin ? { changes, say } : null;
  }

  /* ---------- robustness: the three conclusions under other choices ----------
     Fitted when the fold-out opens: (1) no chain random intercepts, (2) all
     students, without the exclusions, (3) Chinese valence on the English
     scale by percentile instead of linear equating, and for the trajectory
     (4) position as a category, assuming no curve shape. Plus a model of which
     answers go unscored. Judged by direction, size and precision, not by
     counting p-values on either side of .05. */
  // The checks: random effects, then subsets of students, then measurement and model form.
  // The checks: the sample without exclusions, then random effects, measurement and model form.
  const RALL = [['main', 'Main analysis'], ['all', 'All students (no exclusions)'], ['nochain', 'No chain intercepts'], ['slopes', 'By-student random slopes'], ['percentile', 'Percentile equating'], ['cat', 'Position as a category']];
  const ALTS = ['all', 'nochain', 'slopes', 'percentile'];
  const rcols = () => RALL;
  function robustRows(dSV) {
    const seedE = (v, name, k) => v.B && v.B.ok ? scaleE(U(v.B.coefOf(name)), dSV * k) : null;
    return [
      { group: '1 · Transition pattern' },
      { name: 'Overall test (joint, 2 df)', key: 'tw', get: v => v.A && v.A.ok ? v.A.wald([LANGT, PREV]) : null, joint: true },
      { name: 'Follow-up: after a negative answer', unit: 'probability', key: 'fn', get: v => v.A && v.A.ok ? U(v.A.carry.diff.N) : null, fmt: pr2 },
      { name: 'Follow-up: after a positive answer', unit: 'probability', key: 'fp', get: v => v.A && v.A.ok ? U(v.A.carry.diff.P) : null, fmt: pr2 },
      { name: 'Continuous-valence check: language × previous valence', unit: 'per point', key: 'c1', get: v => v.C1 && v.C1.ok ? U(v.C1.coefOf('Language × previous valence')) : null, fmt: s2 },
      { group: '1b · Three-state transitions' },
      { name: 'Overall test (joint, 6 df)', key: 'm3w', m3: true, get: v => v.M3 && v.M3.ok && v.M3.m3 ? m3W(v.M3.m3.omni) : null, joint: true },
      { name: 'Contrast: negative → positive', unit: 'probability', key: 'm3np', m3: true, get: v => v.M3 && v.M3.ok && v.M3.m3 ? U(v.M3.m3.diff.N.P) : null, fmt: pr2 },
      { name: 'Contrast: positive → positive', unit: 'probability', key: 'm3pp', m3: true, get: v => v.M3 && v.M3.ok && v.M3.m3 ? U(v.M3.m3.diff.P.P) : null, fmt: pr2 },
      { group: '2 · Trajectory shape' },
      { name: 'Overall test (joint)', key: 'jw', get: v => v.C && v.C.ok ? v.C.wald(['Language × position', 'Language × position²']) : v.Ccat && v.Ccat.ok ? v.Ccat.wald([2, 3, 4, 5, 6, 7, 8, 9, 10].map(k => `Language × position ${k}`)) : null, joint: true },
      ...[1, 5, 10].map(k => ({ name: `Follow-up: English − Chinese at answer ${k}`, unit: 'valence', key: 'd' + k, fmt: s2,
        get: v => { const [q, q2] = qv(k);
          if (v.C && v.C.ok) return U(v.C.contrast({ [LANGT]: 1, 'Language × position': q, 'Language × position²': q2 }));
          if (v.Ccat && v.Ccat.ok) return U(v.Ccat.contrast(k === 1 ? { [LANGT]: 1 } : { [LANGT]: 1, [`Language × position ${k}`]: 1 }));
          return null; } })),
      { group: '3 · Starting word' },
      { name: 'Language difference in the gap’s change, 1 → 10', unit: 'points', key: 'sd', get: v => seedE(v, 'Language × seed valence × position', Math.log2(10)), fmt: s2 },
      { name: 'Language difference in the gap at answer 1', unit: 'points', key: 'si', get: v => seedE(v, 'Language × seed valence', 1), fmt: s2 }
    ];
  }
  function runRobust() {
    const key = fastState.fitKey;
    if (!fastState.norms || !fastState.parts.length) return;
    if (fastState.robustKey === key) { renderRobust(); return; }
    if (Object.keys(fastState.fits).length < 4 || fastState.updating) return;   // after the main models; runs again when they finish
    fastState.robustKey = key;
    // The last finished checks stay on screen until these are all in.
    const R = { variants: { all: {}, nochain: {}, slopes: {}, percentile: {}, cat: {} }, miss: null, done: 0, total: 0 };
    fastState.robustNext = R;
    if (!fastState.robust) fastState.robust = R;
    const parts = fastState.parts, per = FA.perParticipant(parts), x = fastState.ctx, F = fastState.fits;
    const pct = FA.relink(parts, FA.percentileLink(fastState.norms));
    const four = (k, ps, chain) => {
      R.variants[k].n = ps.length;
      const tr = FA.transitions(ps, FA.state2), an = FA.answers(ps);
      return [{ key: k + ':A', model: 'A', tr, chain }, { key: k + ':C', model: 'C', ans: an, chain }, { key: k + ':B', model: 'B', ans: an, chain }, { key: k + ':C1', model: 'C1', tr, chain }];
    };
    const tr0 = FA.transitions(parts, FA.state2), an0 = FA.answers(parts), th = (f, mid) => f && f.ok ? [f.theta[0]].concat(mid, f.theta.slice(1)) : null;
    R.variants.slopes.n = parts.length;
    const lanes = [
      four('all', fastState.allParts || parts, true).concat([{ key: 'cat:Ccat', model: 'Ccat', ans: an0 }]),
      four('nochain', parts, false).concat([{ key: 'slopes:A', model: 'AS', tr: tr0, start: th(F.A, [0.3, 0.3]) }, { key: 'slopes:C1', model: 'C1S', tr: tr0, start: th(F.C1, [0.1, 0.05]) }]),
      four('percentile', pct, true).concat([{ key: 'slopes:C', model: 'CS', ans: an0, start: th(F.C, [0.15, 0.03]) }, { key: 'slopes:B', model: 'BS', ans: an0, start: th(F.B, [0.05, 0.05]) }, { key: 'miss', model: 'Miss', ans: an0 }])
    ];
    R.total = lanes.reduce((s, l) => s + l.length, 0);
    renderRobust();
    const got = (k, f) => {
      if (fastState.robustNext !== R) return;
      if (k === 'miss') R.miss = f; else { const [v, m] = k.split(':'); R.variants[v][m] = f; }
      R.done++;
      if (R.done >= R.total) fastState.robust = R;
      if (fastState.robust === R) { renderRobust(); if (R.done >= R.total) renderFastModels(); }
    };
    lanes.forEach((jobs, i) => fitJobs('robust:' + i, jobs, got));
  }
  function renderRobust() {
    const R = fastState.robust, x = fastState.ctx;
    if (!R || !x) return;
    // the three-state fits live with the other extra checks
    const XR = fastState.extras && fastState.extras.key === fastState.fitKey ? fastState.extras.r3 : {};
    const r3n = ['all', 'nochain', 'slopes', 'percentile'].filter(k => XR[k]).length;
    const st = $('#a-robust-status');
    const mainDone = ['A', 'C', 'B'].every(k => fastState.fits[k]);
    const finished = R.done >= R.total && mainDone;
    st.textContent = R.done < R.total ? `Fitting the checks… ${R.done} of ${R.total}` : !mainDone ? 'Waiting for the main models…' : r3n < 4 ? `Fitting the three-state checks… ${r3n} of 4` : 'All robustness checks done.';
    st.classList.toggle('done', finished);
    st.classList.toggle('visually-hidden', finished);
    const V = { main: Object.assign({}, fastState.fits, { M3: fastState.m3 || undefined }) };
    Object.keys(R.variants).forEach(k => { V[k] = Object.assign({}, R.variants[k], k in XR ? { M3: XR[k] } : {}); });
    const COLS = rcols(), rows = robustRows(x.dSV);
    const verdict = (r, e) => r.joint ? clearW(e) : clearCI(e);
    const posRow = r => ['jw', 'd1', 'd5', 'd10'].includes(r.key);
    const cell = (r, k) => {
      const cls = `num${k === 'nochain' ? ' sep' : ''}`;
      if (k === 'cat' && !posRow(r)) return `<td class="${cls} muted">—</td>`;
      const v = V[k], e = r.get(v);
      if (!e || !isFinite(e.p)) return `<td class="${cls}">${(r.m3 ? v.M3 !== undefined : Object.keys(v).some(m => ['A', 'B', 'C', 'C1', 'Ccat'].includes(m))) ? '–' : '<span class="muted">…</span>'}</td>`;
      const main = r.get(V.main);
      const flip = k !== 'main' && main && isFinite(main.p) && verdict(r, main) !== verdict(r, e);
      return `<td class="${cls}${verdict(r, e) ? ' r-sig' : ''}">` + (r.joint ? `<b>${wTxt(e).replace(/, (<i>p<\/i>|p)[\s\S]*$/, '').replace(/\u00a0=\u00a0/, ' = ')}</b>` : `<b>${r.fmt(e.est)}</b> <span class="rci">[${fine(r.fmt, e.lo)}, ${fine(r.fmt, e.hi)}]</span>`) +
        `<span class="rp">${LAB.fmtP(e.p)}</span>${flip ? `<span class="flip">${verdict(r, e) ? 'clear here' : 'not clear here'}</span>` : ''}</td>`;
    };
    const sub = { all: R.variants.all.n };
    $('#a-robust').innerHTML = `<thead><tr><th scope="col">Conclusion</th>${COLS.map(([k, t]) => `<th class="num${k === 'nochain' ? ' sep' : ''}" scope="col">${t}${sub[k] !== undefined && isFinite(sub[k]) ? `<span class="th-sub">${sub[k]} students</span>` : ''}</th>`).join('')}</tr></thead><tbody>` +
      rows.map(r => r.group ? `<tr class="group"><th scope="rowgroup" colspan="${COLS.length + 1}"><span class="stick">${r.group}</span></th></tr>`
        : `<tr><th scope="row">${r.name}${r.unit ? ` <small class="muted unit">(${r.unit})</small>` : ''}</th>${COLS.map(([k]) => cell(r, k)).join('')}</tr>`).join('') + '</tbody>';
    // ---- the four conclusions, each across every check: direction, range, evidence ----
    const ALT = { all: 'with all students (no exclusions)', nochain: 'without chain intercepts', slopes: 'with by-student random slopes', percentile: 'with percentile equating', cat: 'with position as a category' };
    const altsFor = r => COLS.map(([k]) => k).filter(k => k !== 'main' && (k !== 'cat' || posRow(r)));
    const get = key => rows.find(r => r.key === key);
    const jointLine = (key, label) => {
      const r = get(key), m = r.get(V.main);
      if (!m || !isFinite(m.p)) return '';
      const done = altsFor(r).filter(k => { const e = r.get(V[k]); return e && isFinite(e.p); });
      const differ = done.filter(k => verdict(r, r.get(V[k])) !== verdict(r, m));
      return `${label}: ${verdict(r, m) ? 'a clear' : 'no clear'} language difference in the main analysis (${wTxt(m)})` +
        (!done.length ? '; no check can be estimated yet.' : !differ.length ? `, and the same in all ${done.length} checks.`
          : `; the same in ${done.length - differ.length} of ${done.length} checks, but ${andList(differ.map(k => `${verdict(r, r.get(V[k])) ? 'clear' : 'not clear'} ${ALT[k]} (${LAB.fmtP(r.get(V[k]).p)})`))}.`);
    };
    const estLine = (key, label) => {
      const r = get(key), m = r.get(V.main);
      if (!m || !isFinite(m.p)) return '';
      const alts = altsFor(r).map(k => [k, r.get(V[k])]).filter(([, e]) => e && isFinite(e.p));
      if (!alts.length) return `${label}: ${r.fmt(m.est)} in the main analysis; no check can be estimated yet.`;
      const ests = alts.map(([, e]) => e.est), flipDir = alts.filter(([, e]) => Math.sign(e.est) !== Math.sign(m.est)).map(([k]) => ALT[k]);
      const lost = alts.filter(([, e]) => verdict(r, m) && !verdict(r, e)).map(([k]) => ALT[k]), gained = alts.filter(([, e]) => !verdict(r, m) && verdict(r, e));
      return `${label}: ${r.fmt(m.est)} in the main analysis, ${r.fmt(Math.min(...ests))} to ${r.fmt(Math.max(...ests))} across the ${alts.length} checks` +
        (flipDir.length ? `; the direction changes ${andList(flipDir)}` : '; the same direction in every check') +
        (verdict(r, m) ? (lost.length ? `; clear in the main analysis, but its CI includes zero ${andList(lost)}` : '; its CI excludes zero in every analysis')
          : (gained.length ? `; not clear in the main analysis, but clear ${andList(gained.map(([k, e]) => `${ALT[k]} (${r.fmt(e.est)} [${fine(r.fmt, e.lo)}, ${fine(r.fmt, e.hi)}])`))}` : '; not clear in any analysis')) + '.';
    };
    $('#a-robust-sum').innerHTML = !finished ? '' :
      `<p><strong>1 · Transition pattern.</strong> ${jointLine('tw', 'Overall test')} ${estLine('fn', 'After a negative answer (probability)')} ${estLine('fp', 'After a positive answer (probability)')} ${estLine('c1', 'Continuous-valence check (per point)')}</p>` +
      `<p><strong>1b · Three-state transitions.</strong> ${r3n < 4 ? 'Its checks are being fitted.' : `${jointLine('m3w', 'Overall test')} ${estLine('m3np', 'Negative → positive, English − Chinese (probability)')} ${estLine('m3pp', 'Positive → positive, English − Chinese (probability)')}` +
        (() => { const no = ['all', 'nochain', 'slopes', 'percentile'].filter(k => XR[k] && !XR[k].ok); return no.length ? ` Could not be estimated: ${andList(no.map(k => ALT[k]))}.` : ''; })()}</p>` +
      `<p><strong>2 · Trajectory shape.</strong> ${jointLine('jw', 'Overall test')} ${[1, 5, 10].map(k => estLine('d' + k, `English − Chinese at answer ${k}`)).join(' ')}</p>` +
      `<p><strong>3 · Starting-word decay.</strong> ${estLine('sd', 'Language difference in how much the gap changes from answer 1 to 10 (points)')}</p>` +
      `<p><strong>4 · Initial starting-word difference.</strong> ${estLine('si', 'Language difference in the gap at answer 1 (points)')}</p>`;
    $('#a-robust-note').innerHTML = 'Each cell: the estimate with its 95% CI (or the joint test) and its <i>p</i>; bold: clear evidence (CI excludes zero, or joint <i>p</i> &lt; .05). “Clear here” / “not clear here”: the verdict differs from the main analysis. ' +
      '<b>No chain intercepts</b>: random intercepts for students and starting words only. ' +
      '<b>By-student random slopes</b>: uncorrelated by-student slopes added for the language terms (transitions: language, language × previous state; continuous check: language, language × previous valence; trajectory: language, language × position; starting word: language × seed valence, language × seed valence × position). ' +
      `<b>All students (no exclusions)</b>: the main models on every student (${x.allN}), without the exclusion criteria stated at the top of the page. ` +
      '<b>Percentile equating</b>: each Chinese rating takes the English value at the same percentile of the two whole norm sets, instead of the linear map (the state boundary stays at 5). ' +
      '<b>Position as a category</b>: the trajectory model with one term per position instead of a curve; its joint test (9 df) asks whether the language difference changes across positions with no assumed shape. ' +
      '<b>Three-state rows</b>: the multinomial model’s omnibus test (χ², 6 df) and the two contrasts named in advance; its random slopes are by-student language slopes, one per logit, with their own 2 × 2 covariance.';
    const M = R.miss;
    if (!M) { $('#a-miss').innerHTML = ''; $('#a-miss-note').textContent = R.done < R.total ? 'Fitting…' : ''; return; }
    if (!M.ok) { $('#a-miss').innerHTML = ''; $('#a-miss-note').textContent = `The model of unscored answers could not be fitted yet. ${whyNot(M)}.`; return; }
    const or = v => Math.exp(v).toFixed(2);
    const lang = U(M.coefOf(LANGT)), svc = U(M.coefOf('Seed valence (per point)')), pos = U(M.coefOf('Position (per step)'));
    $('#a-miss-note').innerHTML = [
      lang ? (clearCI(lang) ? `${lang.est > 0 ? 'English' : 'Chinese'} answers were more likely than ${lang.est > 0 ? 'Chinese' : 'English'} answers to be found in the valence norms (odds ratio ${or(Math.abs(lang.est))}).` : 'Coverage did not clearly differ between the languages.') : '',
      pos ? (clearCI(pos) ? `Coverage ${pos.est < 0 ? 'decreased' : 'increased'} later in the chain.` : 'Coverage did not clearly change along the chain.') : '',
      svc ? (clearCI(svc) ? 'Coverage was related to the starting word’s valence, which needs care in the starting-word analysis.' : 'Coverage was not related to the starting word’s valence, which is reassuring for the starting-word analysis.') : '',
      lang && clearCI(lang) ? 'The language difference in coverage is a limitation for comparing the languages; the coverage-threshold analysis is one response to it.' : ''
    ].filter(Boolean).join(' ') + ` <span class="muted">Logistic model of whether an answer was scored (${M.n.toLocaleString('en-US')} answers; random intercepts for students and starting words).</span>`;
    $('#a-miss').innerHTML = `<thead><tr><th scope="col">Predictor of an answer being scored</th><th class="num" scope="col">Odds ratio</th><th class="num" scope="col">95% CI</th><th class="num sep" scope="col"><i>z</i></th><th class="num" scope="col"><i>p</i></th></tr></thead><tbody>` +
      M.coef.filter(c => c.name !== '(Intercept)').map(c => `<tr><th scope="row">${c.name}</th><td class="num">${or(c.b)}</td><td class="num">${or(c.ci[0])} to ${or(c.ci[1])}</td><td class="num sep">${b2(c.z)}</td>${pCell(c)}</tr>`).join('') + '</tbody>';
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
