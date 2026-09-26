/* LT5461 — live class dashboard (projector view). Reads anonymous per-person
   summaries from the Apps Script endpoint and redraws every 5 seconds. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const num = LAB.num;
  const EXPS = ['masked', 'visible', 'bouba', 'fle'];
  const state = {
    session: LAB.params.get('session') || LAB.hkDate(),
    rows: { masked: [], visible: [], bouba: [], fle: [] },
    timer: null,
    loadedOnce: false
  };
  let lastKey = '';

  const included = rows => rows.filter(r => String(r.include) === '1');
  const fmtMs = v => isFinite(v) ? Math.round(v) + ' ms' : '–';
  const fmtCI = a => isFinite(a[0]) ? `${LAB.signed(a[0])}\u00a0to\u00a0${LAB.signed(a[1])}` : '–';

  /* ---------- tabs ---------- */
  const tabs = [$('#tab-words'), $('#tab-shapes'), $('#tab-fle')];
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
  window.addEventListener('resize', () => { clearTimeout(state.rs); state.rs = setTimeout(syncScrollers, 150); });

  function schedule() {
    clearInterval(state.timer);
    if (live.checked) state.timer = setInterval(() => { if (!document.hidden) refresh(); }, 5000);
  }

  /* ---------- rendering ---------- */
  function render() {
    const m = state.rows.masked, v = state.rows.visible, b = state.rows.bouba, f = state.rows.fle;
    $('#n-words').textContent = m.length + v.length;
    $('#n-shapes').textContent = b.length;
    $('#n-fle').textContent = f.length;
    $('#veil-masked').textContent = m.length;
    $('#veil-visible').textContent = v.length;
    $('#veil-shapes').textContent = b.length;
    $('#veil-fle-zh').textContent = f.filter(r => r.lang === 'zh').length;
    $('#veil-fle-en').textContent = f.filter(r => r.lang === 'en').length;
    // Redraw charts only when the data changed, so the dot animation does not
    // replay every five seconds.
    const key = JSON.stringify([state.session, m.length, v.length, b.length, m.map(r => r.pid + r.effect), v.map(r => r.pid + r.effect), b.map(r => r.pid), f.map(r => r.pid + r.lang)]) + tabs.find(t => t.getAttribute('aria-selected') === 'true').id;
    if (key === lastKey) return;
    lastKey = key;
    if (!$('#panel-words').hidden) renderWords(m, v);
    if (!$('#panel-shapes').hidden) renderShapes(b);
    if (!$('#panel-fle').hidden) renderFLE(f);
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
