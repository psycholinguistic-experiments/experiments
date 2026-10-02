/* LT5461 — association task (FAST) analysis.

   Every answer is scored with the published norms each time the results are
   computed: Warriner et al. (2013) for English, Chan & Tse (2024) for Chinese.
   Chinese valence is used on the English scale (the valence_en column: the
   Chan & Tse ratings are compressed towards the middle, so build_norms.py
   equates them over translation pairs); the raw value is kept for export.
   An answer the norms do not rate stays in its chain as missing and makes
   every transition it takes part in invalid; missing answers are never
   bridged, translated, or scored from their parts.

     scoring      English: lower case, spelling (British → American), then
                  WordNet-style lemmatisation (irregular forms + suffix rules).
                  Chinese: traditional or simplified form, as listed in the norms.
     2 states     negative < 5 ≤ positive (the primary model)
     3 states     negative < 4.2 ≤ neutral < 5.8 ≤ positive
     transitions  answer k → answer k + 1 (k = 1–9); the seed → answer 1
                  transition is left out
     model        mixed-effects logistic regression of "next state positive"
                  on language × previous state + seed valence + position +
                  block, random intercepts for participant and seed
                  (Laplace approximation; the fixed effects are estimated
                  jointly with the random effects, as lme4's nAGQ = 0).

   Browser: window.FAST_ANALYSIS. Node (tests): module.exports. */
(function (root) {
  'use strict';
  const A = {};

  /* ---------- norms ---------- */
  // Rows of a simple CSV (no quoted fields), each as {column: value}.
  const table = text => {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
    const head = lines.shift().split(',');
    return lines.map(l => { const c = l.split(','), o = {}; head.forEach((h, k) => { o[h] = c[k]; }); return o; });
  };

  A.parseNorms = function (enText, zhText, lemText) {
    const en = new Map(), zh = new Map(), zhRaw = new Map(), lemmas = new Map();
    table(enText).forEach(r => { const v = parseFloat(r.valence); if (isFinite(v)) en.set(r.word, v); });
    const simp = new Map();
    table(zhText).forEach(r => {
      const v = parseFloat(r.valence_en), raw = parseFloat(r.valence);
      if (!isFinite(v)) return;
      zh.set(r.trad, v); zhRaw.set(r.trad, raw);
      if (r.simp && r.simp !== r.trad) (simp.get(r.simp) || simp.set(r.simp, []).get(r.simp)).push([v, raw]);
    });
    // A simplified form shared by two traditional words (证明: 證明, 証明) takes their mean.
    simp.forEach((vs, k) => {
      if (zh.has(k)) return;
      zh.set(k, vs.reduce((s, x) => s + x[0], 0) / vs.length);
      zhRaw.set(k, vs.reduce((s, x) => s + x[1], 0) / vs.length);
    });
    table(lemText).forEach(r => lemmas.set(r.form, r.lemma));
    return { en, zh, zhRaw, lemmas };
  };

  A.loadNorms = async function (base) {
    const get = f => fetch((base || '') + 'assets/data/' + f + '?v=2').then(r => { if (!r.ok) throw new Error(f + ': HTTP ' + r.status); return r.text(); });
    const [en, zh, lem] = await Promise.all([get('norms-en.csv'), get('norms-zh.csv'), get('lemmas-en.csv')]);
    return A.parseNorms(en, zh, lem);
  };

  /* ---------- English: normalise, respell, lemmatise ---------- */
  // WordNet's detachment rules (morphy), plus -ied/-ier/-iest → -y.
  const RULES = [
    ['s', ''], ['ses', 's'], ['xes', 'x'], ['zes', 'z'], ['ches', 'ch'], ['shes', 'sh'], ['men', 'man'], ['ies', 'y'],
    ['es', 'e'], ['es', ''], ['ed', 'e'], ['ed', ''], ['ied', 'y'], ['ing', 'e'], ['ing', ''],
    ['er', ''], ['est', ''], ['er', 'e'], ['est', 'e'], ['ier', 'y'], ['iest', 'y']
  ];
  const DOUBLED = /([bdgklmnprtvz])\1$/;
  // British spellings the (American) norms list the other way.
  const RESPELL = [
    [/our(?=s?$|ed$|ing$|ful|ite|able)/, 'or'], [/is(e|ed|es|ing|ation|ations)$/, 'iz$1'], [/ys(e|ed|es|ing)$/, 'yz$1'],
    [/tre(s?)$/, 'ter$1'], [/ogue(s?)$/, 'og$1'], [/ence(s?)$/, 'ense$1'], [/ll(ed|ing|er|ers)$/, 'l$1'],
    [/mme(s?)$/, 'm$1'], [/ae/, 'e'], [/oe/, 'e']
  ];

  A.enKey = raw => String(raw).normalize('NFKC').toLowerCase().replace(/[‘’ʼ`]/g, "'")
    .replace(/^[^a-z]+|[^a-z]+$/g, '').replace(/\s+/g, ' ').replace(/^(a|an|the|to) (?=\S)/, '');

  function lemmatise(w, N) {
    if (N.en.has(w)) return w;
    const irr = N.lemmas.get(w);
    if (irr && N.en.has(irr)) return irr;
    for (const [suf, rep] of RULES) {
      if (!w.endsWith(suf) || w.length - suf.length < 2) continue;
      const stem = w.slice(0, w.length - suf.length) + rep;
      if (N.en.has(stem)) return stem;
      // running → run, stopped → stop, bigger → big
      if (!rep && DOUBLED.test(stem) && N.en.has(stem.slice(0, -1))) return stem.slice(0, -1);
    }
    return null;
  }

  A.scoreEn = function (raw, N) {
    const w = A.enKey(raw);
    if (!w || /[^a-z' -]/.test(w)) return null;
    let lemma = lemmatise(w, N);
    if (!lemma) for (const [re, rep] of RESPELL) {
      if (!re.test(w)) continue;
      lemma = lemmatise(w.replace(re, rep), N);
      if (lemma) break;
    }
    return lemma ? { key: lemma, valence: N.en.get(lemma) } : null;
  };

  /* ---------- Chinese: the form as typed, in either script ---------- */
  A.zhKey = raw => String(raw).normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '');
  A.scoreZh = function (raw, N) {
    const k = A.zhKey(raw);
    if (!k || !/^\p{Script=Han}+$/u.test(k)) return null;
    return N.zh.has(k) ? { key: k, valence: N.zh.get(k), raw: N.zhRaw.get(k) } : null;
  };
  A.score = (raw, lang, N) => lang === 'en' ? A.scoreEn(raw, N) : A.scoreZh(raw, N);

  /* ---------- participants: parse the stored chains and score them ---------- */
  // Every student gets the same seeds: one set per language.
  A.seedIndex = stim => {
    const m = new Map();
    ['zh', 'en'].forEach(L => stim.sets[L].forEach(s => m.set(s.id, Object.assign({ lang: L }, s))));
    return m;
  };

  A.participants = function (rowsIn, stim, N) {
    const seeds = A.seedIndex(stim);
    return rowsIn.map(r => {
      const order = String(r.order || '').split('-');
      const P = {
        key: r.pid + '|' + r.session, pid: r.pid, session: r.session, group: Number(r.group), order: r.order,
        l1: r.l1, variety: r.variety, script: r.script, input_method: r.input_method,
        eng_age: Number(r.eng_age), en_use: Number(r.en_use), prof: {}, chains: []
      };
      ['zh', 'en'].forEach(lang => ['overall', 'listening', 'speaking', 'reading', 'writing'].forEach(s => {
        P.prof[`${lang}_${s}`] = Number(r[`prof_${lang}_${s}`]);
      }));
      seeds.forEach((seed, id) => {
        const a = r[`c_${id}_a`];
        if (a === undefined || a === null || a === '') return;
        const parts = String(a).split('|');
        const lang = parts[0];
        if (lang !== seed.lang) return;
        const b = r[`c_${id}_b`];
        const texts = parts.slice(1).concat(b === undefined || b === null || b === '' ? [] : String(b).split('|'));
        const sc = A.score(lang === 'en' ? seed.word : seed.trad || seed.word, lang, N);
        // norm: the form used to spot repetitions (the English lemma when the
        // norms know the word; otherwise the answer as typed, normalised).
        const norm = (t, s) => s && lang === 'en' ? s.key : lang === 'en' ? A.enKey(t) : A.zhKey(t);
        P.chains.push({
          id, lang, category: seed.category, word: seed.word, block: order.indexOf(lang) + 1,
          seedValence: sc ? sc.valence : NaN,
          seedNorm: lang === 'en' ? norm(seed.word, sc) : A.zhKey(seed.word),
          answers: texts.map(t => { const s = A.score(t, lang, N); return { text: t, key: s ? s.key : '', norm: norm(t, s), valence: s ? s.valence : null, raw: s ? (s.raw !== undefined ? s.raw : s.valence) : null }; })
        });
      });
      return P;
    }).filter(P => P.chains.length);
  };

  /* ---------- states and transitions ---------- */
  A.STATES2 = ['N', 'P'];
  A.STATES3 = ['N', 'U', 'P'];
  A.state2 = v => v === null || v === undefined ? null : v < 5 ? 'N' : 'P';
  A.state3 = v => v === null || v === undefined ? null : v < 4.2 ? 'N' : v < 5.8 ? 'U' : 'P';

  /* Every adjacent pair of answers (1→2 … 9→10). A pair with a missing
     answer is not a transition; nothing is bridged across a gap. */
  A.transitions = function (parts, stateFn) {
    const out = [];
    parts.forEach(P => P.chains.forEach(c => {
      for (let k = 1; k < c.answers.length; k++) {
        const a = c.answers[k - 1], b = c.answers[k];
        const s1 = stateFn(a.valence), s2 = stateFn(b.valence);
        if (!s1 || !s2) continue;
        out.push({ pid: P.key, lang: c.lang, seed: c.id, category: c.category, block: c.block,
          position: k, prev: s1, next: s2, prevV: a.valence, nextV: b.valence, seedValence: c.seedValence });
      }
    }));
    return out;
  };

  /* Pooled counts and row-conditional probabilities. A row with no
     transitions has undefined (NaN) probabilities, never zero. */
  A.matrix = function (trans, states) {
    const counts = {}, probs = {}, rowN = {};
    states.forEach(a => { counts[a] = {}; states.forEach(b => { counts[a][b] = 0; }); });
    trans.forEach(t => { counts[t.prev][t.next]++; });
    states.forEach(a => {
      rowN[a] = states.reduce((s, b) => s + counts[a][b], 0);
      probs[a] = {};
      states.forEach(b => { probs[a][b] = rowN[a] ? counts[a][b] / rowN[a] : NaN; });
    });
    return { states, counts, probs, rowN, n: trans.length };
  };

  /* Per participant and language: persistence probabilities and coverage. */
  A.perParticipant = function (parts) {
    return parts.map(P => {
      const out = { key: P.key, pid: P.pid, variety: P.variety, prof: P.prof, lang: {} };
      ['zh', 'en'].forEach(lang => {
        const chains = P.chains.filter(c => c.lang === lang);
        const answers = chains.reduce((s, c) => s + c.answers.length, 0);
        const scored = chains.reduce((s, c) => s + c.answers.filter(a => a.valence !== null).length, 0);
        const possible = chains.reduce((s, c) => s + Math.max(0, c.answers.length - 1), 0);
        const tr = A.transitions([{ key: P.key, chains }], A.state2);
        const m = A.matrix(tr, A.STATES2);
        out.lang[lang] = { answers, scored, possible, valid: tr.length, NN: m.probs.N.N, PP: m.probs.P.P, nN: m.rowN.N, nP: m.rowN.P };
      });
      return out;
    });
  };

  /* Repetitions: an answer that repeats an earlier word of the same chain,
     the seed included (A → B → A counts once, at the second A). Per student
     and language, overall and by seed category: [repeats, answers]. */
  A.repetitions = function (parts) {
    return parts.map(P => {
      const out = {};
      ['zh', 'en'].forEach(lang => {
        const r = { all: [0, 0], negative: [0, 0], neutral: [0, 0], positive: [0, 0] };
        P.chains.filter(c => c.lang === lang).forEach(c => {
          const seen = new Set([c.seedNorm]);
          c.answers.forEach(a => {
            const hit = a.norm && seen.has(a.norm) ? 1 : 0;
            if (a.norm) seen.add(a.norm);
            r.all[0] += hit; r.all[1]++;
            r[c.category][0] += hit; r[c.category][1]++;
          });
        });
        out[lang] = r;
      });
      return out;
    });
  };

  /* Mean valence of each student's scored answers, per language and seed
     category (NaN where the norms scored none). */
  A.meanValence = function (parts) {
    return parts.map(P => {
      const out = {};
      ['zh', 'en'].forEach(lang => {
        out[lang] = {};
        ['negative', 'neutral', 'positive', 'all'].forEach(cat => {
          const v = P.chains.filter(c => c.lang === lang && (cat === 'all' || c.category === cat))
            .flatMap(c => c.answers.map(a => a.valence)).filter(x => x !== null);
          out[lang][cat] = v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
        });
      });
      return out;
    });
  };

  /* Mean valence at each answer position, per participant, then across
     participants. Missing answers add no observation at their position. */
  A.trajectories = function (parts, maxPos) {
    const out = {};
    ['zh', 'en'].forEach(lang => {
      out[lang] = {};
      ['negative', 'neutral', 'positive'].forEach(cat => {
        out[lang][cat] = Array.from({ length: maxPos }, (_, k) => parts.map(P => {
          const v = P.chains.filter(c => c.lang === lang && c.category === cat).map(c => c.answers[k] && c.answers[k].valence).filter(x => x !== null && x !== undefined);
          return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
        }).filter(isFinite));
      });
    });
    return out;   // out[lang][cat][k] = one mean per participant
  };

  /* ---------- the mixed-effects logistic model ---------- */
  A.modelData = function (trans) {
    const pids = [...new Set(trans.map(t => t.pid))], seeds = [...new Set(trans.map(t => t.seed))];
    const sv = trans.map(t => t.seedValence).filter(isFinite);
    const svMean = sv.length ? sv.reduce((s, x) => s + x, 0) / sv.length : 5;
    const cols = [
      ['(Intercept)', () => 1],
      ['Language (English − Chinese)', t => t.lang === 'en' ? 0.5 : -0.5],
      ['Previous state (positive − negative)', t => t.prev === 'P' ? 0.5 : -0.5],
      ['Language × previous state', t => (t.lang === 'en' ? 0.5 : -0.5) * (t.prev === 'P' ? 0.5 : -0.5)],
      ['Seed valence (per point)', t => t.seedValence - svMean],
      ['Position (per step)', t => t.position - 5],
      ['Block (second − first)', t => t.block === 2 ? 0.5 : -0.5]
    ];
    const ok = trans.filter(t => isFinite(t.seedValence));
    const pIdx = new Map(pids.map((p, i) => [p, i])), sIdx = new Map(seeds.map((s, i) => [s, i]));
    return {
      names: cols.map(c => c[0]),
      X: ok.map(t => cols.map(c => c[1](t))),
      y: ok.map(t => t.next === 'P' ? 1 : 0),
      groups: [ok.map(t => pIdx.get(t.pid)), ok.map(t => sIdx.get(t.seed))],
      nLevels: [pids.length, seeds.length],
      groupNames: ['Participant', 'Seed'],
      svMean
    };
  };

  // Cholesky of a symmetric positive-definite matrix (array of rows); null if not PD.
  function chol(M) {
    const n = M.length, L = Array.from({ length: n }, () => new Float64Array(n));
    for (let j = 0; j < n; j++) {
      let d = M[j][j];
      for (let k = 0; k < j; k++) d -= L[j][k] * L[j][k];
      if (!(d > 1e-12)) return null;
      L[j][j] = Math.sqrt(d);
      for (let i = j + 1; i < n; i++) {
        let s = M[i][j];
        for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        L[i][j] = s / L[j][j];
      }
    }
    return L;
  }
  function cholSolve(L, b) {
    const n = L.length, y = new Float64Array(n), x = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; }
    for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
    return x;
  }
  const logdetChol = L => { let s = 0; for (let i = 0; i < L.length; i++) s += 2 * Math.log(L[i][i]); return s; };

  /* Drop fixed-effect columns that the data cannot separate from earlier ones
     (e.g. block while every student so far did the same order). */
  function estimable(X, names) {
    const keep = [], basis = [];
    for (let j = 0; j < names.length; j++) {
      let v = X.map(r => r[j]);
      const norm0 = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      if (!(norm0 > 0)) continue;
      basis.forEach(b => { const d = v.reduce((s, x, i) => s + x * b[i], 0); v = v.map((x, i) => x - d * b[i]); });
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      if (norm / norm0 > 1e-6) { keep.push(j); basis.push(v.map(x => x / norm)); }
    }
    return keep;
  }

  /* Penalised IRLS for fixed theta: the joint mode of (beta, v), u = theta·v.
     Returns the Laplace deviance and the pieces needed afterwards. */
  function pirls(D, theta, start) {
    const n = D.y.length, p = D.X[0].length, q = D.nLevels.reduce((s, x) => s + x, 0), m = p + q;
    const off = [0, D.nLevels[0]];
    const g = new Float64Array(m);
    let par = start ? Float64Array.from(start) : new Float64Array(m);
    const eta = par => {
      const e = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0; const x = D.X[i];
        for (let j = 0; j < p; j++) s += x[j] * par[j];
        for (let k = 0; k < 2; k++) s += theta[k] * par[p + off[k] + D.groups[k][i]];
        e[i] = s;
      }
      return e;
    };
    const objective = (par, e) => {   // log-likelihood − ½|v|²
      let s = 0;
      for (let i = 0; i < n; i++) s += D.y[i] * e[i] - (e[i] > 0 ? e[i] + Math.log1p(Math.exp(-e[i])) : Math.log1p(Math.exp(e[i])));
      for (let j = p; j < m; j++) s -= 0.5 * par[j] * par[j];
      return s;
    };
    let e = eta(par), f = objective(par, e), H, L, ok = true, it = 0;
    // Each pass builds the gradient and Hessian at the current point; the loop
    // ends before moving once the step is negligible, so H belongs to the mode.
    for (; it < 80; it++) {
      H = Array.from({ length: m }, () => new Float64Array(m));
      g.fill(0);
      for (let i = 0; i < n; i++) {
        const mu = 1 / (1 + Math.exp(-e[i])), w = mu * (1 - mu), r = D.y[i] - mu, x = D.X[i];
        const zi = [p + off[0] + D.groups[0][i], p + off[1] + D.groups[1][i]];
        for (let a = 0; a < p; a++) {
          g[a] += x[a] * r;
          const wa = w * x[a];
          for (let b = 0; b <= a; b++) H[a][b] += wa * x[b];
          for (let k = 0; k < 2; k++) H[zi[k]][a] += wa * theta[k];
        }
        for (let k = 0; k < 2; k++) {
          g[zi[k]] += theta[k] * r;
          H[zi[k]][zi[k]] += w * theta[k] * theta[k];
        }
        const hi = Math.max(zi[0], zi[1]), lo = Math.min(zi[0], zi[1]);
        H[hi][lo] += w * theta[0] * theta[1];
      }
      for (let j = p; j < m; j++) { g[j] -= par[j]; H[j][j] += 1; }
      for (let a = 0; a < m; a++) for (let b = a + 1; b < m; b++) H[a][b] = H[b][a];
      L = chol(H);
      if (!L) { ok = false; break; }
      const step = cholSolve(L, g);
      if (Math.max(...step.map(Math.abs)) < 1e-7) break;
      let t = 1, next, en, fn;
      for (let h = 0; h < 30; h++, t /= 2) {
        next = par.map((x, j) => x + t * step[j]);
        en = eta(next); fn = objective(next, en);
        if (fn >= f - 1e-12) break;
      }
      if (!(fn >= f - 1e-12)) break;   // no ascent possible: at the mode
      par = next; e = en; f = fn;
    }
    if (!ok || !L) return { ok: false };
    // Laplace: deviance = −2 [ℓ(β̂, û) − ½|v̂|² − ½ log|θZᵀWZθ + I|], all at the mode.
    const Hvv = Array.from({ length: q }, (_, a) => Float64Array.from({ length: q }, (_, b) => H[p + a][p + b]));
    const Lv = chol(Hvv);
    if (!Lv) return { ok: false };
    return { ok: true, par, dev: -2 * (f - 0.5 * logdetChol(Lv)), L, H, p, q, iterations: it };
  }

  function nelderMead(fn, x0, step, maxEval) {
    const n = x0.length;
    let pts = [x0.slice()].concat(x0.map((_, i) => x0.map((x, j) => j === i ? x + step : x)));
    let vals = pts.map(fn), evals = n + 1;
    while (evals < maxEval) {
      const idx = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
      pts = idx.map(i => pts[i]); vals = idx.map(i => vals[i]);
      if (Math.abs(vals[n] - vals[0]) < 1e-7 && Math.max(...pts.slice(1).map(p => Math.max(...p.map((x, j) => Math.abs(x - pts[0][j]))))) < 1e-5) break;
      const c = x0.map((_, j) => pts.slice(0, n).reduce((s, p) => s + p[j], 0) / n);
      const at = a => c.map((x, j) => x + a * (pts[n][j] - x));
      const xr = at(-1), fr = fn(xr); evals++;
      if (fr < vals[0]) { const xe = at(-2), fe = fn(xe); evals++; if (fe < fr) { pts[n] = xe; vals[n] = fe; } else { pts[n] = xr; vals[n] = fr; } }
      else if (fr < vals[n - 1]) { pts[n] = xr; vals[n] = fr; }
      else {
        const xc = at(fr < vals[n] ? -0.5 : 0.5), fc = fn(xc); evals++;
        if (fc < Math.min(fr, vals[n])) { pts[n] = xc; vals[n] = fc; }
        else { for (let i = 1; i <= n; i++) { pts[i] = pts[i].map((x, j) => pts[0][j] + 0.5 * (x - pts[0][j])); vals[i] = fn(pts[i]); evals++; } }
      }
    }
    const best = vals.indexOf(Math.min(...vals));
    return { x: pts[best], f: vals[best], evals };
  }

  // Two-tailed p for a standard normal z (erfc, |error| < 1.2e-7).
  function erfc(x) {
    const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
      t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }
  A.pNorm = z => isFinite(z) ? Math.min(1, erfc(Math.abs(z) / Math.SQRT2)) : NaN;

  /* Transitions that never happen make the model inestimable (separation):
     e.g. if a negative answer was never followed by another negative one in
     English, the English persistence log-odds run off to infinity. */
  A.emptyCells = function (trans) {
    const out = [];
    ['zh', 'en'].forEach(lang => ['N', 'P'].forEach(prev => ['N', 'P'].forEach(next => {
      if (!trans.some(t => t.lang === lang && t.prev === prev && t.next === next)) out.push({ lang, prev, next });
    })));
    return out;
  };

  A.glmm = function (Din, trans) {
    const n = Din.y.length;
    if (n < 20 || Din.nLevels[0] < 2 || Din.nLevels[1] < 2) return { ok: false, reason: 'few' };
    const empty = trans ? A.emptyCells(trans) : [];
    if (empty.length) return { ok: false, reason: 'separation', empty };
    const keep = estimable(Din.X, Din.names);
    const D = Object.assign({}, Din, { X: Din.X.map(r => keep.map(j => r[j])), names: keep.map(j => Din.names[j]) });
    const dropped = Din.names.filter((_, j) => !keep.includes(j) && j > 0);
    let warm = null;
    const dev = th => {
      const theta = th.map(Math.abs);
      const r = pirls(D, theta, warm);
      if (!r.ok) return 1e300;
      warm = r.par;
      return r.dev;
    };
    const nm = nelderMead(dev, [1, 1], 0.5, 300);
    const theta = nm.x.map(Math.abs);
    const fit = pirls(D, theta, warm);
    if (!fit.ok) return { ok: false, reason: 'converge' };
    // Cov(β) = the β block of the inverse of the joint negative Hessian.
    const p = fit.p, cov = Array.from({ length: p }, () => new Float64Array(p));
    for (let j = 0; j < p; j++) {
      const e = new Float64Array(p + fit.q); e[j] = 1;
      const col = cholSolve(fit.L, e);
      for (let i = 0; i < p; i++) cov[i][j] = col[i];
    }
    const beta = Array.from(fit.par.slice(0, p));
    const se = beta.map((_, j) => Math.sqrt(cov[j][j]));
    const coef = D.names.map((name, j) => {
      const z = beta[j] / se[j];
      return { name, b: beta[j], se: se[j], z, p: A.pNorm(z), ci: [beta[j] - 1.959964 * se[j], beta[j] + 1.959964 * se[j]] };
    });
    const idx = name => D.names.indexOf(name);
    const contrast = w => {   // w: {name: weight}; estimate, SE, z, p
      let b = 0, v = 0;
      const ks = Object.keys(w).filter(k => idx(k) >= 0);
      ks.forEach(k => { b += w[k] * beta[idx(k)]; });
      ks.forEach(a => ks.forEach(c => { v += w[a] * w[c] * cov[idx(a)][idx(c)]; }));
      const s = Math.sqrt(v), z = b / s;
      return { b, se: s, z, p: A.pNorm(z), ci: [b - 1.959964 * s, b + 1.959964 * s] };
    };
    const good = coef.every(c => isFinite(c.se) && c.se < 50) && nm.evals < 300;
    return { ok: true, converged: good, n, nLevels: D.nLevels, groupNames: D.groupNames, theta, deviance: fit.dev,
      coef, cov, names: D.names, dropped, contrast, beta, evals: nm.evals };
  };

  /* The model's own reading of the language effect: log-odds of moving to (or
     staying in) the positive state, English − Chinese, after a negative and
     after a positive answer; and the implied persistence probabilities at the
     average seed valence and the middle of the chain. */
  A.modelSummary = function (fit) {
    if (!fit || !fit.ok) return null;
    const L = 'Language (English − Chinese)', S = 'Previous state (positive − negative)', I = 'Language × previous state', C = '(Intercept)';
    const afterN = fit.contrast({ [L]: 1, [I]: -0.5 });
    const afterP = fit.contrast({ [L]: 1, [I]: 0.5 });
    const logistic = x => 1 / (1 + Math.exp(-x));
    // Implied probability of the next answer being positive, with a 95% CI
    // from the linear predictor's SE (delta method on the logit scale).
    const nextPositive = (lang, prev) => {
      const r = fit.contrast({ [C]: 1, [L]: lang, [S]: prev, [I]: lang * prev });
      return { p: logistic(r.b), lo: logistic(r.ci[0]), hi: logistic(r.ci[1]) };
    };
    const stay = (lang, key) => {
      const q = nextPositive(lang, key === 'N' ? -0.5 : 0.5);
      return key === 'N' ? { p: 1 - q.p, lo: 1 - q.hi, hi: 1 - q.lo } : q;
    };
    const implied = {
      zh: { NN: stay(-0.5, 'N').p, PP: stay(-0.5, 'P').p },
      en: { NN: stay(0.5, 'N').p, PP: stay(0.5, 'P').p }
    };
    const impliedCI = { zh: { NN: stay(-0.5, 'N'), PP: stay(-0.5, 'P') }, en: { NN: stay(0.5, 'N'), PP: stay(0.5, 'P') } };
    return { afterN, afterP, implied, impliedCI };
  };

  /* ---------- exports (CSV rows) ---------- */
  A.responseRows = parts => parts.flatMap(P => P.chains.flatMap(c => c.answers.map((a, k) => ({
    pid: P.pid, session: P.session, language: c.lang, block: c.block, seed: c.word, seed_category: c.category,
    seed_valence: isFinite(c.seedValence) ? c.seedValence : 'NA', position: k + 1, response: a.text, norm_entry: a.key || 'NA',
    valence: a.valence === null ? 'NA' : a.valence, valence_norm_raw: a.raw === null ? 'NA' : a.raw, state2: A.state2(a.valence) || 'NA', state3: A.state3(a.valence) || 'NA',
    repeat: a.norm && (a.norm === c.seedNorm || c.answers.slice(0, k).some(b => b.norm === a.norm)) ? 1 : 0
  }))));
  // Valid transitions are the same in both models (both need two scored
  // answers), so one file carries both classifications.
  A.transitionRows = parts => {
    const pidOf = new Map(parts.map(P => [P.key, P]));
    return A.transitions(parts, A.state2).map(t => ({
      pid: pidOf.get(t.pid).pid, session: pidOf.get(t.pid).session, language: t.lang, seed: t.seed, seed_category: t.category,
      seed_valence: t.seedValence, block: t.block, transition: `${t.position}-${t.position + 1}`,
      previous_valence: t.prevV, next_valence: t.nextV,
      previous_state2: t.prev, next_state2: t.next, previous_state3: A.state3(t.prevV), next_state3: A.state3(t.nextV)
    }));
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = A;
  else root.FAST_ANALYSIS = A;
})(typeof window !== 'undefined' ? window : this);
