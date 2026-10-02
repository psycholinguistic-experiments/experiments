/* LT5461 — live class dashboard (projector view). Reads anonymous per-person
   summaries from the Apps Script endpoint and redraws every 5 seconds. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const num = LAB.num;
  const EXPS = ['masked', 'visible', 'bouba', 'fle', 'fast'];
  const state = {
    session: LAB.params.get('session') || LAB.hkDate(),
    rows: { masked: [], visible: [], bouba: [], fle: [], fast: [] },
    timer: null,
    loadedOnce: false
  };
  let lastKey = '';

  const included = rows => rows.filter(r => String(r.include) === '1');
  const fmtMs = v => isFinite(v) ? Math.round(v) + ' ms' : '–';
  const fmtCI = a => isFinite(a[0]) ? `${LAB.signed(a[0])}\u00a0to\u00a0${LAB.signed(a[1])}` : '–';

  /* ---------- tabs ---------- */
  const tabs = [$('#tab-words'), $('#tab-shapes'), $('#tab-fle'), $('#tab-fast')];
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
  hide.addEventListener('change', () => document.body.classList.toggle('hidden-results', hide.checked));
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
    render();
    if (!state.loadedOnce) { state.loadedOnce = true; loadSessions(); }
  }

  // A table wrapper is a keyboard stop only when it actually scrolls.
  function syncScrollers() {
    document.querySelectorAll('.table-wrap').forEach(w => {
      const scrolls = w.offsetParent && w.scrollWidth > w.clientWidth + 1;
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
      syncScrollers();
    }, 150);
  });

  function schedule() {
    clearInterval(state.timer);
    if (live.checked) state.timer = setInterval(() => { if (!document.hidden) refresh(); }, 5000);
  }

  /* ---------- rendering ---------- */
  function render() {
    const m = state.rows.masked, v = state.rows.visible, b = state.rows.bouba, f = state.rows.fle, a = state.rows.fast;
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
    // Redraw charts only when the data changed, so the dot animation does not
    // replay every five seconds.
    const key = JSON.stringify([state.session, m.length, v.length, b.length, m.map(r => r.pid + r.effect), v.map(r => r.pid + r.effect), b.map(r => r.pid), f.map(r => r.pid + r.lang), a.map(r => r.pid + r.session), fastState.norms ? 1 : 0]) + tabs.find(t => t.getAttribute('aria-selected') === 'true').id;
    if (key === lastKey) return;
    lastKey = key;
    if (!$('#panel-words').hidden) renderWords(m, v);
    if (!$('#panel-shapes').hidden) renderShapes(b);
    if (!$('#panel-fle').hidden) renderFLE(f);
    if (!$('#panel-fast').hidden) renderFast(a);
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
     fast-analysis.js; charts: fast-charts.js). The tab is led by questions;
     each gives its descriptive chart, then its test, with the exact numbers in
     a fold-out. */
  const FA = window.FAST_ANALYSIS, STIM = window.FAST_STIMULI, FC = window.FAST_CHARTS;
  const fastState = { norms: null, loading: null, error: '', fitKey: '', fit: null, parts: [], timer: null };
  const STATE_NAME = { N: 'negative', U: 'neutral', P: 'positive' };
  const LANG_NAME = { zh: 'Chinese', en: 'English' };
  const CATS = ['negative', 'neutral', 'positive'];
  // Probabilities in APA style (no leading zero); signed numbers with U+2212.
  const p2 = v => isFinite(v) ? (v < 0 ? '−' : '') + Math.abs(v).toFixed(2).replace(/^0/, '') : '–';
  const b2 = v => isFinite(v) ? (v <= -0.005 ? '−' : '') + Math.abs(v).toFixed(2) : '–';
  const s2 = v => isFinite(v) ? (v <= -0.005 ? '−' : v >= 0.005 ? '+' : '') + Math.abs(v).toFixed(2) : '–';
  const b3 = v => isFinite(v) ? (v <= -0.0005 ? '−' : v >= 0.0005 ? '+' : '') + Math.abs(v).toFixed(3) : '–';
  const pct0 = v => isFinite(v) ? Math.round(v * 100) + '%' : '–';
  const pct1 = v => isFinite(v) ? (v * 100).toFixed(1) + '%' : '–';
  const pts1 = v => isFinite(v) ? (v <= -0.0005 ? '−' : v >= 0.0005 ? '+' : '') + Math.abs(v * 100).toFixed(1) + ' pts' : '–';
  const zStat = r => r && isFinite(r.z) ? `<i>z</i> = ${b2(r.z)}` : '';
  const asTest = r => r ? { p: r.p, diff: r.b, t: r.z } : null;
  // A difference shown next to two rounded values is computed from those
  // rounded values, so it always adds up on screen.
  const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
  const fig = (host, heading) => {
    const f = document.createElement('figure');
    f.className = 'figure';
    f.innerHTML = `<h3>${heading}</h3><div></div>`;
    host.appendChild(f);
    return f.querySelector('div');
  };

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
  const gate = T => T.n >= 3 ? T : Object.assign({}, T, { t: NaN, p: NaN, reason: 'few' });
  // Likewise, a 95% CI across students is drawn from 3 students.
  const ci3 = a => a.length >= 3 ? LAB.ci95(a) : [NaN, NaN];

  function ensureNorms() {
    if (fastState.norms || fastState.loading) return;
    fastState.loading = FA.loadNorms('')
      .then(n => { fastState.norms = n; fastState.error = ''; })
      .catch(e => { fastState.error = e.message || String(e); })
      .finally(() => { fastState.loading = null; lastKey = ''; render(); });
  }
  $('#a-prof-key').addEventListener('change', () => { lastKey = ''; render(); });
  $('#a-csv-answers').addEventListener('click', () => LAB.download(`lt5461-association-answers-${state.session}.csv`, LAB.toCSV(FA.responseRows(fastState.parts))));
  $('#a-csv-transitions').addEventListener('click', () => LAB.download(`lt5461-association-transitions-${state.session}.csv`, LAB.toCSV(FA.transitionRows(fastState.parts))));

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

  // A test line: what was tested, the verdict, the statistics.
  // "×" never starts or ends a line in a name
  const keepX = name => name.replace(/ × /g, '\u00a0×\u00a0');
  const testItem = (name, r, stats, noFit) => `<li><span class="t-name">${keepX(name)}</span>` +
    (r && isFinite(r.p) ? `${badge(r, 0)}<span>${stats}</span>` : `<span class="sig na">${noFit || 'Too few runs to test'}</span>`) + '</li>';

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

    const tr2 = FA.transitions(parts, FA.state2), tr3 = FA.transitions(parts, FA.state3);
    const P = { zh: FA.matrix(tr2.filter(t => t.lang === 'zh'), FA.STATES2), en: FA.matrix(tr2.filter(t => t.lang === 'en'), FA.STATES2) };

    // ---- 1. Where does the next answer go? ----
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

    // ---- 2. Does the seed's valence carry into the chain? ----
    const reps = FA.repetitions(parts), mv = FA.meanValence(parts), per = FA.perParticipant(parts);
    const pooled = (cat, lang, key) => { const m = FA.matrix(tr2.filter(t => t.lang === lang && (cat === 'all' || t.category === cat)), FA.STATES2); return m.probs[key][key]; };
    const meanV = (cat, lang) => LAB.mean(mv.map(x => x[lang][cat]).filter(isFinite));
    const ciV = (cat, lang) => { const a = mv.map(x => x[lang][cat]).filter(isFinite); return a.length >= 3 ? LAB.ci95(a) : [NaN, NaN]; };
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

    // ---- 3. Valence along the chain ----
    const nPos = STIM.responsesPerSeed, traj = FA.trajectories(parts, nPos);
    const stat = arr => ({ m: LAB.mean(arr), ci: arr.length >= 3 ? LAB.ci95(arr) : [NaN, NaN], n: arr.length });
    const TS = {};
    CATS.forEach(c => { TS[c] = { zh: traj.zh[c].map(stat), en: traj.en[c].map(stat) }; });
    const tv = CATS.flatMap(c => ['zh', 'en'].flatMap(l => TS[c][l].flatMap(s => [s.m, s.ci[0], s.ci[1]]))).filter(isFinite);
    const tDom = [Math.max(1, Math.floor(Math.min(4, ...tv))), Math.min(9, Math.ceil(Math.max(6, ...tv)))];
    const th = $('#a-traj');
    th.innerHTML = '';
    CATS.forEach(c => {
      const ends = l => { const a = TS[c][l]; return `${LANG_NAME[l]} from ${b2(a[0] && a[0].m)} to ${b2(a[nPos - 1] && a[nPos - 1].m)}`; };
      FC.trajectory(fig(th, `${cap(c)} seeds`), TS[c], nPos, tDom, `${cap(c)} seeds: mean valence by answer position, ${ends('zh')}, ${ends('en')}`);
    });
    const tcell = d => d && isFinite(d.m) ? `<td class="num">${d.m.toFixed(2)}${isFinite(d.ci[0]) ? `<span class="ci">${d.ci[0].toFixed(2)}–${d.ci[1].toFixed(2)}</span>` : ''}</td>` : '<td class="num">–</td>';
    $('#a-traj-table').innerHTML = `<thead><tr><th scope="col" rowspan="2">Answer</th>${CATS.map(c => `<th scope="colgroup" colspan="2" class="sep">${cap(c)} seeds</th>`).join('')}</tr>` +
      `<tr>${'<th class="num sep" scope="col">Chinese</th><th class="num" scope="col">English</th>'.repeat(3)}</tr></thead><tbody>` +
      Array.from({ length: nPos }, (_, k) => `<tr><th scope="row">${k + 1}</th>${CATS.map(c => tcell(TS[c].zh[k]).replace('<td class="num">', '<td class="num sep">') + tcell(TS[c].en[k])).join('')}</tr>`).join('') + '</tbody>';
    const tn = CATS.flatMap(c => ['zh', 'en'].flatMap(l => TS[c][l].map(d => d.n)));
    $('#a-traj-note').textContent = `Mean valence (1–9) of the answers at each position, with its 95% CI across students below. Each mean is over ${Math.min(...tn)}${Math.max(...tn) > Math.min(...tn) ? '–' + Math.max(...tn) : ''} students with a scored answer there.`;

    // ---- 4. Repeated answers ----
    const rate = (x, lang) => x[lang].all[1] ? x[lang].all[0] / x[lang].all[1] : NaN;
    const rz = reps.map(x => rate(x, 'zh')), re = reps.map(x => rate(x, 'en'));
    const repDiff = re.map((v, i) => v - rz[i]).filter(isFinite);
    const repeat = { zh: LAB.mean(rz.filter(isFinite)), en: LAB.mean(re.filter(isFinite)), test: gate(LAB.ttest(repDiff, 0)) };
    FC.paired($('#a-repeats'), rz.map((z, i) => ({ zh: z, en: re[i] })), {
      step: 0.02, minMax: 0.1, tick: v => Math.round(v * 100) + '%', fmt: pct1,
      mean: { zh: { m: repeat.zh, ci: ci3(rz.filter(isFinite)) }, en: { m: repeat.en, ci: ci3(re.filter(isFinite)) } },
      label: `Repeated answers per student: Chinese mean ${pct1(repeat.zh)}, English mean ${pct1(repeat.en)}`
    });

    // ---- seed valence × language, per student ----
    // (positive − negative seeds) per student and language; only students with
    // both languages scored, so the two means and the test share one sample.
    const both = mv.map(x => ({ zh: x.zh.positive - x.zh.negative, en: x.en.positive - x.en.negative })).filter(d => isFinite(d.zh) && isFinite(d.en));
    const polarity = { zh: LAB.mean(both.map(d => d.zh)), en: LAB.mean(both.map(d => d.en)), test: gate(LAB.ttest(both.map(d => d.en - d.zh), 0)) };

    // ---- 5. Relative proficiency (exploratory) ----
    const pk = $('#a-prof-key').value;
    const rel = p => pk === 'overall' ? p.prof.en_overall - p.prof.zh_overall
      : (p.prof.en_speaking + p.prof.en_writing) / 2 - (p.prof.zh_speaking + p.prof.zh_writing) / 2;
    const profHost = $('#a-prof');
    profHost.innerHTML = '';
    const PROF = [['NN', 'Staying negative, English − Chinese'], ['PP', 'Staying positive, English − Chinese']].map(([k, ttl]) => {
      const pts = per.map(p => ({ x: rel(p), y: p.lang.en[k] - p.lang.zh[k] })).filter(q => isFinite(q.x) && isFinite(q.y));
      const fit = LAB.ols(pts.map(q => q.x), pts.map(q => q.y));
      const xs = pts.map(q => q.x);
      const x0 = Math.min(-4, Math.floor(Math.min(0, ...xs)) - 1), x1 = Math.max(2, Math.ceil(Math.max(0, ...xs)) + 1);
      const ym = Math.min(1, Math.max(0.5, Math.ceil(Math.max(...pts.map(q => Math.abs(q.y)), 0) * 4) / 4));
      LAB.scatterPlot(fig(profHost, ttl), {
        points: pts, fit, xDomain: [x0, x1], xStep: x1 - x0 > 10 ? 2 : 1, yDomain: [-ym, ym], yStep: ym > 0.5 ? 0.5 : 0.25,
        xFmt: v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v),
        yFmt: v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2).replace(/^0/, ''),
        xLabel: 'Self-rating, English − Chinese (0–10 scales)', ref: { value: 0, label: '' },
        ariaLabel: `${ttl} by relative proficiency, n = ${pts.length}` + (fit ? `, slope ${b3(fit.b)}` : '')
      });
      return { k, title: ttl, n: pts.length, fit, test: fit ? { diff: fit.b, t: fit.t, df: fit.df, p: fit.p } : null };
    });
    $('#a-prof-table').innerHTML = `<thead><tr><th scope="col">Difference</th><th class="num" scope="col">n</th><th class="num" scope="col">Slope per rating point</th><th class="num" scope="col">95% CI</th>${tHead('')}</tr></thead><tbody>` +
      PROF.map(o => `<tr><th scope="row">${o.title}</th><td class="num">${o.n}</td><td class="num"><strong>${o.fit ? b3(o.fit.b) : '–'}</strong></td>` +
        `<td class="num">${o.fit ? b3(o.fit.ciB[0]) + ' to ' + b3(o.fit.ciB[1]) : '–'}</td>${tCell(o.test)}${pCell(o.test)}${resultCell(o.test, 0)}</tr>`).join('') + '</tbody>';

    // ---- 6. Data quality ----
    const cov = lang => {
      const L = per.map(p => p.lang[lang]).filter(q => q.answers);
      const sum = k => L.reduce((s, q) => s + q[k], 0);
      const share = (a, b) => L.map(q => q[b] ? q[a] / q[b] : NaN).filter(isFinite);
      const rt = rows.map(r => num(r['rt_median_' + lang])).filter(isFinite);
      return { n: L.length, scored: sum('scored') / sum('answers'), valid: sum('valid') / sum('possible'), validN: sum('valid'),
        sRange: share('scored', 'answers'), vRange: share('valid', 'possible'), rt: LAB.median(rt) };
    };
    const C = { zh: cov('zh'), en: cov('en') };
    const range = a => a.length ? `${pct0(Math.min(...a))}–${pct0(Math.max(...a))} per student` : '';
    const meter = (l, label, v, note) => `<div class="meter"><span>${label}</span><span class="meter-track" role="img" aria-label="${label}: ${pct0(v)}"><span class="meter-fill ${l}" style="display:block;width:${Math.round(v * 100)}%"></span></span><span class="v">${pct0(v)}</span></div><div class="meter-note">${note}</div>`;
    $('#a-coverage').innerHTML = ['zh', 'en'].map(l => `<div><div class="meter-lang">${LANG_NAME[l]}</div>` +
      meter(l, 'Answers scored', C[l].scored, range(C[l].sRange)) +
      meter(l, 'Valid transitions', C[l].valid, `${C[l].validN.toLocaleString('en-US')} transitions · ${range(C[l].vRange)}`) +
      `<div class="meter-note" style="margin-top:0.35rem">Median time per answer: ${isFinite(C[l].rt) ? (C[l].rt / 1000).toFixed(1) + ' s' : '–'}</div></div>`).join('');

    // ---- the mixed-effects model: fitted once per change of data, after the rest is drawn ----
    const ctx = { other, n, P, C, polarity, repeat, PROF };
    const fitKey = JSON.stringify([state.session, parts.map(x => x.key)]);
    if (fitKey === fastState.fitKey && fastState.fit) { renderFastModel(ctx); return; }
    fastState.fitKey = fitKey; fastState.fit = null;
    renderFastModel(ctx);   // everything but the model, which follows
    clearTimeout(fastState.timer);
    fastState.timer = setTimeout(() => {
      const fit = FA.glmm(FA.modelData(tr2), tr2);
      if (fastState.fitKey !== fitKey) return;
      fastState.fit = { fit, sum: FA.modelSummary(fit) };
      renderFastModel(ctx);
    }, 30);
  }

  function renderFastModel(x) {
    const pending = !fastState.fit;
    const fit = pending ? null : fastState.fit.fit, sum = pending ? null : fastState.fit.sum;
    const ok = fit && fit.ok;
    const why = pending ? 'pending' : fit.reason;
    const noFit = why === 'pending' ? 'Fitting the model…' : why === 'converge' ? 'Model did not converge' : why === 'separation' ? 'Not estimable yet' : 'Too few runs to test';
    const emptyText = why === 'separation' ? [...new Set(fit.empty.map(c => c.prev + c.next))].map(k => {
      const langs = fit.empty.filter(c => c.prev + c.next === k).map(c => c.lang);
      return `${langs.length === 2 ? 'in either language' : 'in ' + LANG_NAME[langs[0]]}, no ${STATE_NAME[k[0]]} answer was followed by a ${STATE_NAME[k[1]]} one`;
    }).join('; ') : '';
    // Staying negative is the complement of moving on: flip the sign of the
    // "next answer positive after a negative one" contrast.
    const stayN = ok ? Object.assign({}, sum.afterN, { b: -sum.afterN.b, z: -sum.afterN.z, ci: [-sum.afterN.ci[1], -sum.afterN.ci[0]] }) : null;
    const stayP = ok ? sum.afterP : null;
    const coef = name => ok ? fit.coef.find(c => c.name === name) : null;
    const inter = coef('Language × previous state'), lang = coef('Language (English − Chinese)');
    const { C, polarity, repeat, PROF, n, other, P } = x;

    // Tiles: the language difference in each key measure.
    // Where a test sits beside a probability, the probability is the model's
    // (the one the test is about); pooled only while the model is not in.
    const ci = ok ? sum.impliedCI : null;
    const val = (l, k) => ci ? ci[l][k].p : P[l].probs[k[0]][k[1]];
    const src = ci ? 'model' : 'pooled';
    const dP = k => s2(r2(val('en', k)) - r2(val('zh', k))).replace(/^([+−]?)0/, '$1');
    const pill = r => r && isFinite(r.p) ? badge(r, 0) : `<span class="sig na">${noFit}</span>`;
    const tile = (label, value, note, r, stat) => `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span>` +
      `<span class="stat-note">${note}</span><span class="stat-test">${pill(r)}${stat ? `<span>${stat}</span>` : ''}</span></div>`;
    $('#a-stats').innerHTML =
      tile('Staying negative, P(N→N)', dP('NN'), `English − Chinese, ${src} (${p2(val('en', 'NN'))} vs ${p2(val('zh', 'NN'))})`, asTest(stayN), stayN ? zStat(stayN) : '') +
      tile('Staying positive, P(P→P)', dP('PP'), `English − Chinese, ${src} (${p2(val('en', 'PP'))} vs ${p2(val('zh', 'PP'))})`, asTest(stayP), stayP ? zStat(stayP) : '') +
      tile('Repeated answers', pts1(r3(repeat.en) - r3(repeat.zh)).replace(' pts', '<small>pts</small>'), `English − Chinese (${pct1(repeat.en)} vs ${pct1(repeat.zh)})`, repeat.test, isFinite(repeat.test.t) ? LAB.fmtT(repeat.test) : '') +
      `<div class="stat"><span class="stat-label">Took part</span><span class="stat-value">${n}</span><span class="stat-note">students · ${(P.zh.n + P.en.n).toLocaleString('en-US')} valid transitions</span></div>`;

    // 1. the dumbbell: model probabilities with CIs (pooled values until the model is in)
    const cell = (l, k) => ci ? ci[l][k] : { p: P[l].probs[k[0]][k[1]], lo: NaN, hi: NaN };
    FC.dumbbell($('#a-dumbbell'), [
      { label: 'Staying negative', sub: 'P(N→N)', zh: cell('zh', 'NN'), en: cell('en', 'NN') },
      { label: 'Staying positive', sub: 'P(P→P)', zh: cell('zh', 'PP'), en: cell('en', 'PP') }
    ], { xLabel: 'Probability of staying in the same state', label: 'Staying negative and staying positive, Chinese and English, with 95% CIs' });
    const lo = r => `<i>b</i> = ${s2(r.b)}, ${zStat(r)}, ${LAB.fmtP(r.p)}`;
    $('#a-tests-markov').innerHTML =
      testItem('Staying negative, English − Chinese', asTest(stayN), stayN ? lo(stayN) : '', noFit) +
      testItem('Staying positive, English − Chinese', asTest(stayP), stayP ? lo(stayP) : '', noFit) +
      testItem('Language × previous state', asTest(inter), inter ? lo(inter) : '', noFit);
    $('#a-tests-seed').innerHTML = testItem('Seed valence × language',
      polarity.test, isFinite(polarity.test.t) ? `positive − negative seeds: ${b2(polarity.zh)} in Chinese, ${b2(polarity.en)} in English · ${LAB.fmtTest(polarity.test)}` : '');
    $('#a-tests-rep').innerHTML = testItem('Repeated answers, English − Chinese',
      repeat.test, isFinite(repeat.test.t) ? `${pts1(r3(repeat.en) - r3(repeat.zh))} · ${LAB.fmtTest(repeat.test)}` : '');

    // 6. the forest plot and the full tests table
    const fhost = $('#a-forest');
    if (ok) {
      FC.forest(fhost, [
        { label: 'Language differences in staying', rows: [
          { label: 'Staying negative, English − Chinese', b: stayN.b, lo: stayN.ci[0], hi: stayN.ci[1], p: stayN.p },
          { label: 'Staying positive, English − Chinese', b: stayP.b, lo: stayP.ci[0], hi: stayP.ci[1], p: stayP.p }] },
        { label: 'Model terms (next answer positive)', rows: fit.coef.filter(c => c.name !== '(Intercept)').map(c => ({ label: c.name, b: c.b, lo: c.ci[0], hi: c.ci[1], p: c.p })) }
      ], { xLabel: 'Log-odds (95% CI)', label: 'Language differences in staying, and the model terms, in log-odds with 95% confidence intervals' });
    } else fhost.innerHTML = `<p class="empty">${why === 'pending' ? 'Fitting the model…' : noFit + '.'}</p>`;
    const row = (name, zh, en, diff, cint, stat, r) => `<tr><th scope="row">${keepX(name)}</th><td class="num sep">${zh}</td><td class="num">${en}</td>` +
      `<td class="num sep"><strong>${diff}</strong></td><td class="num">${cint}</td><td class="num sep">${stat || '–'}</td>${pCell(r)}${r && isFinite(r.p) ? resultCell(r, 0) : `<td class="result"><span class="sig na">${noFit}</span></td>`}</tr>`;
    const mrow = (name, zh, en, r) => r ? row(name, zh, en, `${s2(r.b)} <small>log‑odds</small>`, `${s2(r.ci[0])} to ${s2(r.ci[1])}`, zStat(r), asTest(r)) : row(name, zh, en, '–', '–', '', null);
    const imp = ok ? sum.implied : null;
    const tt = (T, fmt) => ({ ci: isFinite(T.ci[0]) ? `${fmt(T.ci[0])} to ${fmt(T.ci[1])}` : '–', stat: isFinite(T.t) ? LAB.fmtT(T) : '' });
    const pol = tt(polarity.test, s2), rp = tt(repeat.test, v => pts1(v).replace('\u00a0pts', ''));
    if (rp.ci !== '–') rp.ci += '\u00a0pts';
    $('#a-tests').innerHTML = `<thead><tr><th scope="col">Question</th><th class="num sep" scope="col">Chinese</th><th class="num" scope="col">English</th>` +
      `<th class="num sep" scope="col">English − Chinese</th><th class="num" scope="col">95% CI</th><th class="num sep" scope="col">Test</th><th class="num" scope="col"><i>p</i></th><th class="result" scope="col">Result</th></tr></thead><tbody>` +
      `<tr class="group"><th scope="rowgroup" colspan="8"><span class="stick">Where the next answer goes (mixed-effects model)</span></th></tr>` +
      mrow('Staying negative, P(N→N)', imp ? p2(imp.zh.NN) : '–', imp ? p2(imp.en.NN) : '–', stayN) +
      mrow('Staying positive, P(P→P)', imp ? p2(imp.zh.PP) : '–', imp ? p2(imp.en.PP) : '–', stayP) +
      mrow('Language × previous state', '', '', inter) +
      mrow('Language (English − Chinese)', '', '', lang) +
      `<tr class="group"><th scope="rowgroup" colspan="8"><span class="stick">Per student (paired t-tests)</span></th></tr>` +
      row('Seed valence × language', b2(polarity.zh), b2(polarity.en), `${s2(r2(polarity.en) - r2(polarity.zh))} <small>points</small>`, pol.ci, pol.stat, polarity.test) +
      row('Repeated answers', pct1(repeat.zh), pct1(repeat.en), pts1(r3(repeat.en) - r3(repeat.zh)), rp.ci, rp.stat, repeat.test) +
      '</tbody>';
    $('#a-tests-note').innerHTML = 'Model: mixed-effects logistic regression on every valid two-state transition, next answer positive ~ language × previous state + seed valence + position + block (first or second language), ' +
      'with random intercepts for students and seeds (Laplace approximation, as lme4’s nAGQ = 0; Wald <i>z</i>). Its Chinese and English columns are the probabilities it implies at the average seed and the middle of the chain. ' +
      'Language × previous state: how much less (negative) or more closely the next answer follows the previous answer’s state in English. Language (English − Chinese): the overall shift towards positive answers in English. ' +
      'Seed valence × language: answers after positive minus after negative seeds, in valence points. Paired t-tests use one score per student and language. Two-tailed, α = .05.' +
      (why === 'separation' ? ` <strong>The model cannot be estimated yet:</strong> ${emptyText}.` : why === 'converge' ? ' <strong>The model did not converge</strong> with these runs; download the transitions to fit it elsewhere.' : '') +
      (ok && fit.dropped.length ? ` Not estimable with the runs so far, so left out of the model: ${fit.dropped.map(d => d.toLowerCase()).join('; ')}.` : '');
    $('#a-model').innerHTML = !ok ? '' : `<thead><tr><th scope="col">Fixed effect</th><th class="num" scope="col"><i>b</i></th><th class="num" scope="col">SE</th><th class="num" scope="col">95% CI</th>` +
      `<th class="num sep" scope="col"><i>z</i></th><th class="num" scope="col"><i>p</i></th></tr></thead><tbody>` +
      fit.coef.map(c => `<tr><th scope="row">${c.name}</th><td class="num">${b2(c.b)}</td><td class="num">${c.se.toFixed(2)}</td><td class="num">${b2(c.ci[0])} to ${b2(c.ci[1])}</td>` +
        `<td class="num sep">${b2(c.z)}</td>${pCell(asTest(c))}</tr>`).join('') +
      `<tr class="group"><th scope="rowgroup" colspan="6"><span class="stick">Random intercepts (SD) · ${fit.n.toLocaleString('en-US')} transitions</span></th></tr>` +
      fit.groupNames.map((g, i) => `<tr><th scope="row">${g}s (${fit.nLevels[i]})</th><td class="num">${fit.theta[i].toFixed(2)}</td><td colspan="4"></td></tr>`).join('') + '</tbody>';

    // Summary: one line per finding, the test in brackets.
    const items = [];
    const lead2 = (name, r, verdictWords) => `<strong>${name}: ${r && isFinite(r.p) ? (LAB.isSig(r) ? verdictWords : 'no significant language difference') : why === 'pending' ? 'fitting the model…' : noFit.toLowerCase()}.</strong>`;
    // "A negative answer was followed by another negative one 69% of the time in Chinese and 65% in English",
    // said differently when a language has no answers in that state yet.
    const shareText = key => {
      const w = STATE_NAME[key], k = key + key, has = l => isFinite(val(l, k));
      if (!has('zh') && !has('en')) return `No answer was ${w} yet in either language, so this cannot be computed`;
      if (!has('zh') || !has('en')) { const l = has('zh') ? 'zh' : 'en', o = l === 'zh' ? 'en' : 'zh';
        return `Pooled over all students, the probability that a ${w} answer was followed by another ${w} one was ${p2(val(l, k))} in ${LANG_NAME[l]}; no ${LANG_NAME[o]} answer was ${w} yet`; }
      return ci ? `The model puts the probability that a ${w} answer is followed by another ${w} one at ${p2(val('zh', k))} in Chinese and ${p2(val('en', k))} in English`
        : `Pooled over all students, the probability that a ${w} answer was followed by another ${w} one was ${p2(val('zh', k))} in Chinese and ${p2(val('en', k))} in English`;
    };
    const pst = (key, r, more, less) => item(asTest(r), `${lead2(key === 'N' ? 'Staying negative' : 'Staying positive', asTest(r), r && r.b > 0 ? more : less)} ` +
      shareText(key) +
      (r ? ` ${inline(`<i>b</i> = ${s2(r.b)}, ${zStat(r)}, ${LAB.fmtP(r.p)}${smallTag(n)}`)}` : '') + '.');
    items.push(pst('N', stayN, 'more likely in English', 'less likely in English'));
    items.push(pst('P', stayP, 'more likely in English', 'less likely in English'));
    if (inter) items.push(item(asTest(inter), `<strong>Language × previous state: ${LAB.isSig(asTest(inter)) ? 'significant' : 'not significant'}.</strong> ` +
      (LAB.isSig(asTest(inter)) ? `The next answer followed the previous answer’s state ${inter.b < 0 ? 'less' : 'more'} closely in English` : 'The next answer followed the previous answer’s state about as closely in both languages') +
      ` ${inline(`${zStat(inter)}, ${LAB.fmtP(inter.p)}`)}.`));
    const PT = polarity.test;
    items.push(item(PT, `<strong>Seed valence × language: ${isFinite(PT.p) ? (LAB.isSig(PT) ? `the seeds’ valence carried ${PT.m > 0 ? 'further' : 'less far'} into the English chains` : 'no significant language difference') : 'not enough runs to test yet'}.</strong> ` +
      `Answers after positive seeds were ${b2(polarity.zh)} points more positive than after negative seeds in Chinese, and ${b2(polarity.en)} in English` +
      (isFinite(PT.t) ? ` ${inline(`${LAB.fmtTest(PT)}`)}` : '') + '.'));
    const RT = repeat.test;
    items.push(item(RT, `<strong>Repeated answers: ${isFinite(RT.p) ? (LAB.isSig(RT) ? `${RT.m > 0 ? 'more' : 'fewer'} in English` : 'no significant language difference') : 'not enough runs to test yet'}.</strong> ` +
      `${pct1(repeat.zh)} of Chinese and ${pct1(repeat.en)} of English answers repeated an earlier word of the same chain` +
      (isFinite(RT.t) ? ` ${inline(LAB.fmtTest(RT))}` : '') + '.'));
    const gap = Math.abs(C.zh.valid - C.en.valid);
    items.push(`<li><strong>Coverage.</strong> The norms scored ${pct0(C.zh.scored)} of Chinese and ${pct0(C.en.scored)} of English answers; ` +
      `${pct0(C.zh.valid)} and ${pct0(C.en.valid)} of possible transitions were valid.` +
      (gap >= 0.1 ? ` The ${C.zh.valid < C.en.valid ? 'Chinese' : 'English'} results rest on noticeably fewer transitions.` : '') +
      (other ? ` ${other} run${other > 1 ? 's' : ''} with an earlier set of seed words ${other > 1 ? 'are' : 'is'} not included.` : '') + '</li>');
    const pr = PROF.filter(o => o.test && isFinite(o.test.p));
    if (pr.length) {
      const sig = pr.filter(o => LAB.isSig(o.test));
      items.push(`<li><strong>Relative proficiency (exploratory): ${sig.length ? 'significant slope for ' + sig.map(o => o.k === 'NN' ? 'staying negative' : 'staying positive').join(' and ') : 'no significant slope'}.</strong> ` +
        pr.map(o => `${o.k === 'NN' ? 'Staying negative' : 'Staying positive'}: ${b3(o.fit.b)} per rating point ${inline(LAB.fmtTest(o.test))}`).join('; ') + '.</li>');
    }
    $('#a-summary').innerHTML = items.join('');
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
