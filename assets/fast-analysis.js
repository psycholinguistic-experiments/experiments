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
     models       A: logistic, next state positive ~ language × previous
                  state + seed valence + position + block (Laplace; β with
                  the random effects, as lme4's nAGQ = 0), and its continuous
                  twin, next valence ~ language × previous valence + … (REML).
                  B: answer valence ~ language × seed valence × position.
                  C: answer valence ~ language × (position + position²).
                  All with random intercepts for students, seeds and chains
                  (a student's answers to one seed); linear models' tests use
                  Satterthwaite degrees of freedom (as lmerTest).

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
    const enList = [], zhRawList = [];
    table(enText).forEach(r => { const v = parseFloat(r.valence); if (isFinite(v)) { en.set(r.word, v); enList.push(v); } });
    const simp = new Map();
    table(zhText).forEach(r => {
      const v = parseFloat(r.valence_en), raw = parseFloat(r.valence);
      if (!isFinite(v)) return;
      zh.set(r.trad, v); zhRaw.set(r.trad, raw); zhRawList.push(raw);
      if (r.simp && r.simp !== r.trad) (simp.get(r.simp) || simp.set(r.simp, []).get(r.simp)).push([v, raw]);
    });
    // A simplified form shared by two traditional words (证明: 證明, 証明) takes their mean.
    simp.forEach((vs, k) => {
      if (zh.has(k)) return;
      zh.set(k, vs.reduce((s, x) => s + x[0], 0) / vs.length);
      zhRaw.set(k, vs.reduce((s, x) => s + x[1], 0) / vs.length);
    });
    table(lemText).forEach(r => lemmas.set(r.form, r.lemma));
    return { en, zh, zhRaw, lemmas, enList, zhRawList };
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
          seedValence: sc ? sc.valence : NaN, seedRaw: sc ? (sc.raw !== undefined ? sc.raw : sc.valence) : NaN,
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
  /* ---------- the models' data ----------
     A design: the rows' source objects (data), the fixed-effect columns as
     [name, function of a row] (cols, kept so rows can be re-predicted with a
     value changed), the response, and the grouping factors, largest last
     (chains, when present: a student's answers to one seed). */
  A.design = function (data, cols, yFn, factors) {
    const lv = factors.map(([, f]) => { const m = new Map(); data.forEach(d => { const k = f(d); if (!m.has(k)) m.set(k, m.size); }); return m; });
    return {
      data, cols, names: cols.map(c => c[0]),
      X: data.map(d => cols.map(c => c[1](d))), y: data.map(yFn),
      groups: factors.map(([, f], k) => data.map(d => lv[k].get(f(d)))),
      nLevels: lv.map(m => m.size), groupNames: factors.map(f => f[0])
    };
  };
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
  const LANG = 'Language (English − Chinese)', lc = d => d.lang === 'en' ? 0.5 : -0.5, bc = d => d.block === 2 ? 0.5 : -0.5;
  const factorsFor = chain => [['Student', d => d.pid], ['Seed', d => d.seed]].concat(chain === false ? [] : [['Chain', d => d.pid + '|' + d.seed]]);

  /* Model A (the main question): is the next answer positive, given the
     previous answer's state, by language. Logistic, random intercepts for
     students, seeds and chains (opts.chain === false: students and seeds). */
  A.modelData = function (trans, opts) {
    const ok = trans.filter(t => isFinite(t.seedValence));
    const svMean = mean(ok.map(t => t.seedValence));
    const pc = t => t.prev === 'P' ? 0.5 : -0.5;
    const D = A.design(ok, [
      ['(Intercept)', () => 1],
      [LANG, lc],
      ['Previous state (positive − negative)', pc],
      ['Language × previous state', t => lc(t) * pc(t)],
      ['Seed valence (per point)', t => t.seedValence - svMean],
      ['Position (per step)', t => t.position - 5],
      ['Block (second − first)', bc]
    ], t => t.next === 'P' ? 1 : 0, factorsFor((opts || {}).chain));
    D.svMean = svMean;
    return D;
  };

  /* Model A, continuous: the next answer's valence (1–9) on the previous
     answer's valence (centred at 5, the state boundary), by language. */
  A.modelDataC1 = function (trans, opts) {
    const ok = trans.filter(t => isFinite(t.seedValence) && isFinite(t.prevV) && isFinite(t.nextV));
    const svMean = mean(ok.map(t => t.seedValence));
    const pv = t => t.prevV - 5;
    const D = A.design(ok, [
      ['(Intercept)', () => 1],
      [LANG, lc],
      ['Previous valence (per point)', pv],
      ['Language × previous valence', t => lc(t) * pv(t)],
      ['Seed valence (per point)', t => t.seedValence - svMean],
      ['Position (per step)', t => t.position - 5],
      ['Block (second − first)', bc]
    ], t => t.nextV, factorsFor((opts || {}).chain));
    D.svMean = svMean;
    return D;
  };

  /* Every answer as a row: scored or not, with its chain's details. */
  A.answers = parts => parts.flatMap(P => P.chains.flatMap(c => c.answers.map((a, k) => ({
    pid: P.key, seed: c.id, lang: c.lang, block: c.block, category: c.category, position: k + 1,
    valence: a.valence, scored: a.valence !== null && a.valence !== undefined, seedValence: c.seedValence
  }))));

  /* Model B (the seed): an answer's valence on its seed's valence, by language
     and position. The pull fades fast at first and then levels off, so
     position enters as log2(position): 0 at answer 1, 1 at answer 2, 2 at
     answer 4, … "Language × seed valence" is then the language difference in
     the seed's pull on the first answer, and "Seed valence × position" how
     that pull changes each time the position doubles (negative: it fades). */
  A.modelDataB = function (ans, opts) {
    const ok = ans.filter(a => a.scored && isFinite(a.seedValence));
    const svMean = mean(ok.map(a => a.seedValence));
    const sv = a => a.seedValence - svMean, ps = a => Math.log2(a.position);
    const D = A.design(ok, [
      ['(Intercept)', () => 1],
      [LANG, lc],
      ['Seed valence (per point)', sv],
      ['Position (per doubling, from answer 1)', ps],
      ['Language × seed valence', a => lc(a) * sv(a)],
      ['Language × position', a => lc(a) * ps(a)],
      ['Seed valence × position', a => sv(a) * ps(a)],
      ['Language × seed valence × position', a => lc(a) * sv(a) * ps(a)],
      ['Block (second − first)', bc]
    ], a => a.valence, factorsFor((opts || {}).chain));
    D.svMean = svMean;
    return D;
  };

  /* Model C (the chain over time): an answer's valence by position, with a
     curve (position², centred), by language; position centred mid-chain. */
  A.modelDataC = function (ans, opts) {
    const ok = ans.filter(a => a.scored && isFinite(a.seedValence));
    const svMean = mean(ok.map(a => a.seedValence));
    const ps = a => a.position - 5.5, p2 = a => ps(a) * ps(a) - 8.25;
    const D = A.design(ok, [
      ['(Intercept)', () => 1],
      [LANG, lc],
      ['Position (per step)', ps],
      ['Position² (curve)', p2],
      ['Language × position', a => lc(a) * ps(a)],
      ['Language × position²', a => lc(a) * p2(a)],
      ['Seed valence (per point)', a => a.seedValence - svMean],
      ['Block (second − first)', bc]
    ], a => a.valence, factorsFor((opts || {}).chain));
    D.svMean = svMean;
    return D;
  };

  /* Missing valence: is an answer scored by the norms? Logistic, random
     intercepts for students and seeds. */
  A.modelDataMiss = function (ans) {
    const ok = ans.filter(a => isFinite(a.seedValence));
    const svMean = mean(ok.map(a => a.seedValence));
    return A.design(ok, [
      ['(Intercept)', () => 1],
      [LANG, lc],
      ['Position (per step)', a => a.position - 5.5],
      ['Seed valence (per point)', a => a.seedValence - svMean],
      ['Block (second − first)', bc]
    ], a => a.scored ? 1 : 0, factorsFor(false));
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

  /* ---------- the shared solver ----------
     Unknowns: the fixed effects β, then each factor's spherical random effects
     v (u = θ·v), the last factor's at the end. For weights w the system is
     H = Σ w a aᵀ + I on the v's, where a is a row's design: its x, then θ_k at
     its level of each factor. The last factor's block of H is diagonal (a row
     has one level of it), so it is eliminated exactly, S = A − B D⁻¹ Bᵀ, and
     only S (fixed effects + the smaller factors) is factorised. This keeps a
     model with hundreds of chains as cheap as one with students and seeds. */
  function layout(D) {
    const p = D.X[0].length, K = D.groups.length, off = [];
    let m1 = p;
    for (let k = 0; k < K - 1; k++) { off.push(m1); m1 += D.nLevels[k]; }
    return { p, K, off, m1, qK: D.nLevels[K - 1], m: m1 + D.nLevels[K - 1] };
  }
  function assemble(D, Lo, theta, w, r) {
    const { p, K, off, m1, qK } = Lo, n = D.y.length, tK = theta[K - 1], nnz = p + K - 1;
    const Am = Array.from({ length: m1 }, () => new Float64Array(m1));
    const dK = new Float64Array(qK).fill(1), Bc = Array.from({ length: qK }, () => new Float64Array(m1));
    const g1 = new Float64Array(m1), g2 = new Float64Array(qK);
    const idx = new Int32Array(nnz), val = new Float64Array(nnz);
    for (let i = 0; i < n; i++) {
      const x = D.X[i], wi = w ? w[i] : 1, ri = r[i];
      for (let j = 0; j < p; j++) { idx[j] = j; val[j] = x[j]; }
      for (let k = 0; k < K - 1; k++) { idx[p + k] = off[k] + D.groups[k][i]; val[p + k] = theta[k]; }
      const c = D.groups[K - 1][i], bcol = Bc[c];
      for (let a = 0; a < nnz; a++) {
        const ia = idx[a], wa = wi * val[a], row = Am[ia];
        g1[ia] += val[a] * ri;
        bcol[ia] += wa * tK;
        for (let b = 0; b <= a; b++) row[idx[b]] += wa * val[b];   // idx ascending: lower triangle
      }
      dK[c] += wi * tK * tK;
      g2[c] += tK * ri;
    }
    for (let j = p; j < m1; j++) Am[j][j] += 1;
    for (let a = 0; a < m1; a++) for (let b = a + 1; b < m1; b++) Am[a][b] = Am[b][a];
    const nzs = Bc.map(b => { const ix = []; for (let j = 0; j < m1; j++) if (b[j] !== 0) ix.push(j); return ix; });
    const S = Am.map(row => Float64Array.from(row));
    Bc.forEach((b, c) => { const ix = nzs[c], d = dK[c]; for (const a of ix) { const f = b[a] / d; for (const e of ix) S[a][e] -= f * b[e]; } });
    return { S, dK, Bc, nzs, g1, g2 };
  }
  function solveSys(sys, L, g1, g2) {
    const rhs = Float64Array.from(g1);
    sys.Bc.forEach((b, c) => { const f = g2[c] / sys.dK[c]; for (const a of sys.nzs[c]) rhs[a] -= b[a] * f; });
    const x1 = cholSolve(L, rhs), x2 = new Float64Array(sys.dK.length);
    sys.Bc.forEach((b, c) => { let s = g2[c]; for (const a of sys.nzs[c]) s -= b[a] * x1[a]; x2[c] = s / sys.dK[c]; });
    return [x1, x2];
  }
  const sumLog = a => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.log(a[i]); return s; };
  // log|θZᵀWZθ + I|: the eliminated block's diagonal plus S without the fixed effects.
  function logdetU(sys, p) {
    const m1 = sys.S.length;
    if (m1 === p) return sumLog(sys.dK);
    const Lu = chol(sys.S.slice(p).map(r => r.slice(p)));
    return Lu ? sumLog(sys.dK) + logdetChol(Lu) : NaN;
  }
  // Linear predictor: x·β + Σ θ_k v_k at the row's levels.
  function linpred(D, Lo, theta, par) {
    const { p, K, off, m1 } = Lo, n = D.y.length, e = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0; const x = D.X[i];
      for (let j = 0; j < p; j++) s += x[j] * par[j];
      for (let k = 0; k < K - 1; k++) s += theta[k] * par[off[k] + D.groups[k][i]];
      e[i] = s + theta[K - 1] * par[m1 + D.groups[K - 1][i]];
    }
    return e;
  }
  // The β block of S⁻¹ (= the β block of H⁻¹).
  function betaBlock(L, p) {
    const m1 = L.length, cov = Array.from({ length: p }, () => new Float64Array(p));
    for (let j = 0; j < p; j++) {
      const e = new Float64Array(m1); e[j] = 1;
      const col = cholSolve(L, e);
      for (let i = 0; i < p; i++) cov[i][j] = col[i];
    }
    return cov;
  }

  /* Penalised IRLS for fixed theta (logistic): the joint mode of (β, v).
     Returns the Laplace deviance and the pieces needed afterwards. */
  function pirls(D, Lo, theta, start) {
    const n = D.y.length, { p, m1, m } = Lo;
    let par = start && start.length === m ? Float64Array.from(start) : new Float64Array(m);
    const objective = (par, e) => {   // log-likelihood − ½|v|²
      let s = 0;
      for (let i = 0; i < n; i++) s += D.y[i] * e[i] - (e[i] > 0 ? e[i] + Math.log1p(Math.exp(-e[i])) : Math.log1p(Math.exp(e[i])));
      for (let j = p; j < m; j++) s -= 0.5 * par[j] * par[j];
      return s;
    };
    let e = linpred(D, Lo, theta, par), f = objective(par, e), sys, L, it = 0;
    const w = new Float64Array(n), r = new Float64Array(n);
    // Each pass builds the system at the current point; the loop ends before
    // moving once the step is negligible, so the system belongs to the mode.
    for (; it < 80; it++) {
      for (let i = 0; i < n; i++) { const mu = 1 / (1 + Math.exp(-e[i])); w[i] = mu * (1 - mu); r[i] = D.y[i] - mu; }
      sys = assemble(D, Lo, theta, w, r);
      L = chol(sys.S);
      if (!L) return { ok: false };
      const g1 = Float64Array.from(sys.g1), g2 = Float64Array.from(sys.g2);
      for (let j = p; j < m1; j++) g1[j] -= par[j];
      for (let c = 0; c < g2.length; c++) g2[c] -= par[m1 + c];
      const [s1, s2] = solveSys(sys, L, g1, g2);
      const step = new Float64Array(m); step.set(s1); step.set(s2, m1);
      let big = 0; for (let j = 0; j < m; j++) big = Math.max(big, Math.abs(step[j]));
      if (big < 1e-7) break;
      let t = 1, next, en, fn;
      for (let h = 0; h < 30; h++, t /= 2) {
        next = par.map((x, j) => x + t * step[j]);
        en = linpred(D, Lo, theta, next); fn = objective(next, en);
        if (fn >= f - 1e-12) break;
      }
      if (!(fn >= f - 1e-12)) break;   // no ascent possible: at the mode
      par = next; e = en; f = fn;
    }
    // Laplace: deviance = −2 [ℓ(β̂, û) − ½|v̂|² − ½ log|θZᵀWZθ + I|], all at the mode.
    const ld = logdetU(sys, p);
    if (!isFinite(ld)) return { ok: false };
    return { ok: true, par, dev: -2 * (f - 0.5 * ld), L, iterations: it };
  }

  /* Penalised least squares for fixed theta (linear): β̂, v̂, the penalised
     residual sum of squares r², and log|M| for the REML criterion
     (M: the joint system, whose determinant is |L_θ|²|R_X|²). */
  function pls(D, Lo, theta) {
    const n = D.y.length, { p, m1, m } = Lo;
    const sys = assemble(D, Lo, theta, null, D.y);
    const L = chol(sys.S);
    if (!L) return { ok: false };
    const [x1, x2] = solveSys(sys, L, sys.g1, sys.g2);
    const par = new Float64Array(m); par.set(x1); par.set(x2, m1);
    const e = linpred(D, Lo, theta, par);
    let r2 = 0;
    for (let i = 0; i < n; i++) r2 += (D.y[i] - e[i]) * (D.y[i] - e[i]);
    for (let j = p; j < m; j++) r2 += par[j] * par[j];
    return { ok: true, par, r2, L, logdetM: sumLog(sys.dK) + logdetChol(L) };
  }
  const remlDev = (n, p, f) => f.logdetM + (n - p) * (1 + Math.log(2 * Math.PI * f.r2 / (n - p)));

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

  /* t distribution: two-tailed p and the 97.5% quantile (regularised
     incomplete beta, Numerical Recipes' continued fraction). */
  function lgamma(x) {
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t);
    let ser = 1.000000000190015; for (const k of c) ser += k / ++y;
    return -t + Math.log(2.5066282746310005 * ser / x);
  }
  function betacf(a, b, x) {
    let c = 1, d = 1 - (a + b) * x / (a + 1); if (Math.abs(d) < 1e-300) d = 1e-300; d = 1 / d; let h = d;
    for (let m = 1; m <= 300; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; h *= d * c;
      aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1));
      d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d;
      const del = d * c; h *= del;
      if (Math.abs(del - 1) < 3e-14) break;
    }
    return h;
  }
  function ibeta(x, a, b) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }
  A.pT = (t, df) => isFinite(t) && df > 0 ? (df > 1e6 ? A.pNorm(t) : ibeta(df / (df + t * t), df / 2, 0.5)) : NaN;
  A.qT = df => {   // t such that two-tailed p = .05
    if (!(df > 0)) return NaN;
    if (df > 1e6) return 1.959964;
    let lo = 0, hi = 1000;
    for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (A.pT(mid, df) > 0.05) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };

  // Columns the data cannot estimate are dropped (e.g. block while every
  // student so far did the same order).
  function prepare(Din) {
    const keep = estimable(Din.X, Din.names);
    const D = Object.assign({}, Din, { X: Din.X.map(r => keep.map(j => r[j])), names: keep.map(j => Din.names[j]), cols: keep.map(j => Din.cols[j]) });
    return { D, dropped: Din.names.filter((_, j) => !keep.includes(j) && j > 0) };
  }
  // A fitted model's common face: coefficients, contrasts, predictions.
  function finish(out, D, beta, cov, dfOf) {
    const p = beta.length, z95 = 1.959964;
    const test = (b, v, df) => {
      const se = Math.sqrt(v), st = b / se, q = df ? A.qT(df) : z95;
      return { b, se, df: df || null, stat: st, z: st, p: df ? A.pT(st, df) : A.pNorm(st), ci: [b - q * se, b + q * se] };
    };
    out.coef = D.names.map((name, j) => Object.assign({ name }, test(beta[j], cov[j][j], dfOf ? dfOf(D.names.map((_, k) => k === j ? 1 : 0)) : null)));
    const idx = name => D.names.indexOf(name);
    out.contrast = w => {   // w: {name: weight}
      const v = D.names.map(n => w[n] || 0);
      let b = 0, va = 0;
      for (let a = 0; a < p; a++) { b += v[a] * beta[a]; for (let c = 0; c < p; c++) va += v[a] * v[c] * cov[a][c]; }
      return test(b, va, dfOf ? dfOf(v) : null);
    };
    out.coefOf = name => out.coef[idx(name)] || null;
    out.names = D.names; out.beta = beta; out.cov = cov;
    return out;
  }

  /* Logistic mixed model (Laplace, β estimated with the random effects as
     lme4's nAGQ = 0). trans: the transitions, for model A's separation check. */
  A.glmm = function (Din, trans) {
    const n = Din.y.length;
    if (n < 20 || Din.nLevels.slice(0, 2).some(q => q < 2)) return { ok: false, reason: 'few' };
    const empty = trans ? A.emptyCells(trans) : [];
    if (empty.length) return { ok: false, reason: 'separation', empty };
    if (Din.y.every(y => y === Din.y[0])) return { ok: false, reason: 'novar' };
    const { D, dropped } = prepare(Din), Lo = layout(D), K = D.groups.length;
    let warm = null;
    const dev = th => {
      const r = pirls(D, Lo, th.map(Math.abs), warm);
      if (!r.ok) return 1e300;
      warm = r.par;
      return r.dev;
    };
    const maxEval = 250 * K, nm = nelderMead(dev, new Array(K).fill(1), 0.5, maxEval);
    const theta = nm.x.map(Math.abs);
    const fit = pirls(D, Lo, theta, warm);
    if (!fit.ok) return { ok: false, reason: 'converge' };
    const p = Lo.p, cov = betaBlock(fit.L, p), beta = Array.from(fit.par.slice(0, p));
    const out = finish({ ok: true, kind: 'glmm', n, nLevels: D.nLevels, groupNames: D.groupNames, theta, sd: theta, deviance: fit.dev, dropped, evals: nm.evals, D }, D, beta, cov, null);
    out.converged = out.coef.every(c => isFinite(c.se) && c.se < 50) && nm.evals < maxEval;
    return out;
  };

  /* Linear mixed model by REML (lme4's default), with Satterthwaite degrees
     of freedom for every test (as lmerTest): the variance parameters'
     covariance from the REML criterion's curvature, and the gradient of each
     contrast's variance, both by finite differences. */
  A.lmm = function (Din) {
    const n = Din.y.length;
    if (n < 20 || Din.nLevels.slice(0, 2).some(q => q < 2)) return { ok: false, reason: 'few' };
    const { D, dropped } = prepare(Din), Lo = layout(D), K = D.groups.length, p = Lo.p;
    const crit = th => { const f = pls(D, Lo, th.map(Math.abs)); return f.ok ? remlDev(n, p, f) : 1e300; };
    const maxEval = 250 * K, nm = nelderMead(crit, new Array(K).fill(1), 0.5, maxEval);
    const theta = nm.x.map(Math.abs);
    const f = pls(D, Lo, theta);
    if (!f.ok) return { ok: false, reason: 'converge' };
    const sigma = Math.sqrt(f.r2 / (n - p));
    const covAt = (th, sg) => { const g = pls(D, Lo, th.map(Math.abs)); const c = betaBlock(g.L, p); return c.map(r => r.map(x => x * sg * sg)); };
    const cov = covAt(theta, sigma), beta = Array.from(f.par.slice(0, p));
    // Satterthwaite: φ = (θ, σ); the unprofiled criterion; boundary θ's left out.
    const phi = theta.concat([sigma]);
    const devU = ph => { const g = pls(D, Lo, ph.slice(0, K).map(Math.abs)); return g.ok ? g.logdetM + (n - p) * Math.log(2 * Math.PI * ph[K] * ph[K]) + g.r2 / (ph[K] * ph[K]) : NaN; };
    const act = phi.map((x, j) => j === K || x > 1e-4 ? j : -1).filter(j => j >= 0);
    const h = act.map(j => 1e-4 * Math.max(Math.abs(phi[j]), 0.05));
    const at = (pairs) => { const q = phi.slice(); pairs.forEach(([j, d]) => { q[j] += d; }); return q; };
    const Hm = act.map(() => new Float64Array(act.length));
    const f0 = devU(phi);
    act.forEach((a, ia) => act.forEach((b, ib) => {
      if (ib < ia) return;
      const ha = h[ia], hb = h[ib];
      const v = ia === ib
        ? (devU(at([[a, ha]])) - 2 * f0 + devU(at([[a, -ha]]))) / (ha * ha)
        : (devU(at([[a, ha], [b, hb]])) - devU(at([[a, ha], [b, -hb]])) - devU(at([[a, -ha], [b, hb]])) + devU(at([[a, -ha], [b, -hb]]))) / (4 * ha * hb);
      Hm[ia][ib] = Hm[ib][ia] = v;
    }));
    const LH = chol(Array.from(Hm, r => Array.from(r)));
    let Avar = null;
    if (LH) Avar = act.map((_, j) => { const e = new Float64Array(act.length); e[j] = 2; return cholSolve(LH, e); });   // 2 H⁻¹
    const dCov = act.map((j, ia) => {
      const up = covAt(at([[j, h[ia]]]).slice(0, K), at([[j, h[ia]]])[K]), dn = covAt(at([[j, -h[ia]]]).slice(0, K), at([[j, -h[ia]]])[K]);
      return up.map((r, a) => r.map((x, b) => (x - dn[a][b]) / (2 * h[ia])));
    });
    const sat = { dCov: dCov.map(M => M.map(r => Array.from(r))), Avar: Avar ? Avar.map(r => Array.from(r)) : null };
    const out = finish({ ok: true, kind: 'lmm', n, nLevels: D.nLevels, groupNames: D.groupNames, theta, sigma, sd: theta.map(t => t * sigma), reml: remlDev(n, p, f), dropped, evals: nm.evals, D, sat }, D, beta, cov, makeDf(cov, sat));
    out.converged = out.coef.every(c => isFinite(c.se)) && nm.evals < maxEval;
    return out;
  };
  // Satterthwaite df for a contrast v: 2V² / (gᵀ A g), V = vᵀ Cov v, g_j = vᵀ ∂Cov/∂φ_j v.
  function makeDf(cov, sat) {
    if (!sat || !sat.Avar) return null;
    const p = cov.length, { dCov, Avar } = sat;
    return v => {
      let V = 0; const g = dCov.map(() => 0);
      for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) { V += v[a] * v[b] * cov[a][b]; dCov.forEach((M, j) => { g[j] += v[a] * v[b] * M[a][b]; }); }
      let q = 0; g.forEach((ga, i) => g.forEach((gb, j) => { q += ga * gb * Avar[i][j]; }));
      const df = 2 * V * V / q;
      return isFinite(df) && df > 0 ? Math.min(df, 1e7) : null;
    };
  }

  /* A fit as plain data (no functions, no design), so it can be posted from a
     Web Worker; revive() gives it its methods back. The column means stand in
     for the design where a prediction needs "the average" of a covariate. */
  A.plain = f => {
    if (!f || !f.ok) return f ? { ok: false, reason: f.reason, empty: f.empty || null } : null;
    const colMeans = {};
    f.D.names.forEach((name, j) => { let s = 0; f.D.X.forEach(r => { s += r[j]; }); colMeans[name] = s / f.D.X.length; });
    const keep = ['ok', 'kind', 'n', 'nLevels', 'groupNames', 'theta', 'sd', 'sigma', 'reml', 'deviance', 'dropped', 'evals', 'converged', 'names', 'beta', 'sat', 'carry'];
    const out = { colMeans, cov: f.cov.map(r => Array.from(r)) };
    keep.forEach(k => { if (f[k] !== undefined) out[k] = f[k]; });
    return out;
  };
  A.revive = p => {
    if (!p || !p.ok) return p;
    const out = finish(Object.assign({}, p), { names: p.names }, p.beta, p.cov, makeDf(p.cov, p.sat));
    out.converged = p.converged;
    out.cm = name => p.colMeans[name] !== undefined ? p.colMeans[name] : 0;
    return out;
  };

  /* One model-fitting job (the page's Web Worker runs these; so does the page
     itself where workers are unavailable). j: {model, tr | ans, chain}. */
  A.runJob = j => {
    const o = { chain: j.chain !== false };
    switch (j.model) {
      case 'A': { const f = A.glmm(A.modelData(j.tr, o), j.tr); if (f.ok) f.carry = A.carryOver(f); return f; }
      case 'C1': return A.lmm(A.modelDataC1(j.tr, o));
      case 'B': return A.lmm(A.modelDataB(j.ans, o));
      case 'C': return A.lmm(A.modelDataC(j.ans, o));
      case 'Miss': return A.glmm(A.modelDataMiss(j.ans));
    }
    return { ok: false, reason: 'unknown' };
  };

  /* Model A on the probability scale: average marginal predictions. Every
     observed transition is predicted with language and previous state set as
     given (random effects at zero), then averaged, so the probabilities
     average over this class's actual seeds, positions and blocks. CIs by the
     delta method. */
  A.carryOver = function (fit) {
    if (!fit || !fit.ok) return null;
    const D = fit.D, p = fit.beta.length, logistic = x => 1 / (1 + Math.exp(-x));
    const amp = (lang, prev) => {
      let m = 0; const g = new Float64Array(p);
      D.data.forEach(t => {
        const t2 = Object.assign({}, t, { lang, prev });
        const x = D.cols.map(c => c[1](t2));
        let e = 0; for (let j = 0; j < p; j++) e += x[j] * fit.beta[j];
        const q = logistic(e); m += q;
        for (let j = 0; j < p; j++) g[j] += q * (1 - q) * x[j];
      });
      return { est: m / D.data.length, g: g.map(v => v / D.data.length) };
    };
    const comb = terms => {   // Σ weight · prediction
      const g = new Float64Array(p); let est = 0;
      terms.forEach(([wt, a]) => { est += wt * a.est; for (let j = 0; j < p; j++) g[j] += wt * a.g[j]; });
      let v = 0; for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) v += g[a] * g[b] * fit.cov[a][b];
      const se = Math.sqrt(v), z = est / se;
      return { est, se, lo: est - 1.959964 * se, hi: est + 1.959964 * se, z, p: A.pNorm(z) };
    };
    const P = { zh: { N: amp('zh', 'N'), P: amp('zh', 'P') }, en: { N: amp('en', 'N'), P: amp('en', 'P') } };
    const next = { zh: { N: comb([[1, P.zh.N]]), P: comb([[1, P.zh.P]]) }, en: { N: comb([[1, P.en.N]]), P: comb([[1, P.en.P]]) } };
    return {
      next,                                                     // P(next positive) by language and previous state
      diff: { N: comb([[1, P.en.N], [-1, P.zh.N]]), P: comb([[1, P.en.P], [-1, P.zh.P]]) },   // English − Chinese
      carry: { zh: comb([[1, P.zh.P], [-1, P.zh.N]]), en: comb([[1, P.en.P], [-1, P.en.N]]) },  // after positive − after negative
      did: comb([[1, P.en.P], [-1, P.en.N], [-1, P.zh.P], [1, P.zh.N]]),                       // carry-over, English − Chinese
      interaction: fit.coefOf('Language × previous state')
    };
  };

  /* An alternative link for the sensitivity check: percentile (equipercentile)
     equating. A Chinese rating takes the English value at the same percentile
     of the two whole norm sets (mid-rank for ties), instead of the linear
     mean–sigma link (which is the same as z-scoring each set). */
  A.percentileLink = function (N) {
    const zh = Float64Array.from(N.zhRawList).sort(), en = Float64Array.from(N.enList).sort();
    const below = (a, v) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; } return lo; };
    const atMost = (a, v) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= v) lo = m + 1; else hi = m; } return lo; };
    return raw => {
      const q = (below(zh, raw) + atMost(zh, raw)) / 2 / zh.length;
      const pos = Math.min(en.length - 1, Math.max(0, q * en.length - 0.5)), i = Math.floor(pos), f = pos - i;
      return i + 1 < en.length ? en[i] * (1 - f) + en[i + 1] * f : en[i];
    };
  };
  // The same students with Chinese valence (answers and seeds) re-linked.
  A.relink = (parts, link) => parts.map(P => Object.assign({}, P, {
    chains: P.chains.map(c => c.lang !== 'zh' ? c : Object.assign({}, c, {
      seedValence: isFinite(c.seedRaw) ? link(c.seedRaw) : NaN,
      answers: c.answers.map(a => a.raw === null || a.raw === undefined ? a : Object.assign({}, a, { valence: link(a.raw) }))
    }))
  }));

  // Benjamini–Hochberg adjusted p-values (same order as given).
  A.bh = ps => {
    const ix = ps.map((p, i) => [p, i]).filter(x => isFinite(x[0])).sort((a, b) => b[0] - a[0]), m = ix.length, out = ps.map(() => NaN);
    let run = 1;
    ix.forEach(([p, i], k) => { run = Math.min(run, p * m / (m - k)); out[i] = run; });
    return out;
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
