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
  // Three states with the given cut-points: negative < lo ≤ neutral < hi ≤ positive.
  A.state3cuts = (lo, hi) => v => v === null || v === undefined ? null : v < lo ? 'N' : v < hi ? 'U' : 'P';
  A.state3 = A.state3cuts(4.2, 5.8);

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
     (chains, when present: a student's answers to one seed). A factor is
     [name, level of a row] for a random intercept, or [name, level, value of
     a row] for a random slope: the term is then θ·value at the row's level
     (an uncorrelated slope, as lme4's ||). The last factor is an intercept. */
  A.design = function (data, cols, yFn, factors) {
    const lv = factors.map(([, f]) => { const m = new Map(); data.forEach(d => { const k = f(d); if (!m.has(k)) m.set(k, m.size); }); return m; });
    return {
      data, cols, names: cols.map(c => c[0]),
      X: data.map(d => cols.map(c => c[1](d))), y: data.map(yFn),
      groups: factors.map(([, f], k) => data.map(d => lv[k].get(f(d)))),
      zv: factors.map(f => f[2] ? Float64Array.from(data, f[2]) : null),
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

  /* Model A, continuous and curved (a check on the three-state model that
     needs no cut-points): the next answer's valence on the previous answer's
     valence (centred at 5) and its square, by language. The joint test of
     Language × previous valence and Language × previous valence² asks whether
     the relationship differs in shape between the languages. */
  A.modelDataC1Q = function (trans, opts) {
    const ok = trans.filter(t => isFinite(t.seedValence) && isFinite(t.prevV) && isFinite(t.nextV));
    const svMean = mean(ok.map(t => t.seedValence));
    const pv = t => t.prevV - 5, pq = t => pv(t) * pv(t);
    const D = A.design(ok, [
      ['(Intercept)', () => 1],
      [LANG, lc],
      ['Previous valence (per point)', pv],
      ['Previous valence²', pq],
      ['Language × previous valence', t => lc(t) * pv(t)],
      ['Language × previous valence²', t => lc(t) * pq(t)],
      ['Seed valence (per point)', t => t.seedValence - svMean],
      ['Position (per step)', t => t.position - 5],
      ['Block (second − first)', bc]
    ], t => t.nextV, factorsFor((opts || {}).chain));
    D.svMean = svMean;
    return D;
  };

  /* Model A, three states: where the next answer goes (negative, neutral or
     positive), given the previous answer's state, by language. Multinomial
     (baseline-category) logit, two logits against the reference destination
     (opts.ref, an index into STATES3; negative by default); the same terms in
     each. Previous state: indicators for neutral and positive (negative the
     reference), so "Language" is the language difference after a negative
     answer. Random intercepts for students, seeds and chains, each a pair
     (one per logit) with an unstructured covariance. */
  A.modelData3 = function (trans, opts) {
    opts = opts || {};
    const ok = trans.filter(t => isFinite(t.seedValence));
    const svMean = mean(ok.map(t => t.seedValence));
    const u = t => t.prev === 'U' ? 1 : 0, pp = t => t.prev === 'P' ? 1 : 0;
    const D = A.design(ok, [
      ['(Intercept)', () => 1],
      [LANG, lc],
      ['Previous neutral', u],
      ['Previous positive', pp],
      ['Language × previous neutral', t => lc(t) * u(t)],
      ['Language × previous positive', t => lc(t) * pp(t)],
      ['Seed valence (per point)', t => t.seedValence - svMean],
      ['Position (per step)', t => t.position - 5],
      ['Block (second − first)', bc]
    ], t => A.STATES3.indexOf(t.next), factorsFor(opts.chain));
    D.svMean = svMean; D.C = 3; D.ref = opts.ref || 0;
    return D;
  };
  // The language terms of the three-state model, and the two that make up the
  // language difference after each previous state (per logit).
  A.LANG3 = [LANG, 'Language × previous neutral', 'Language × previous positive'];
  A.ROW3 = { N: [[LANG, 1]], U: [[LANG, 1], ['Language × previous neutral', 1]], P: [[LANG, 1], ['Language × previous positive', 1]] };

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

  /* Model C with position as a category (sensitivity check for the curve's
     shape): valence ~ language × position (answer 1 the reference) + seed
     valence + block. The language × position terms' joint test asks whether
     the language difference changes across positions, with no assumed shape. */
  A.modelDataCcat = function (ans, opts) {
    const ok = ans.filter(a => a.scored && isFinite(a.seedValence));
    const svMean = mean(ok.map(a => a.seedValence));
    const ks = [2, 3, 4, 5, 6, 7, 8, 9, 10];
    const D = A.design(ok, [['(Intercept)', () => 1], [LANG, lc]]
      .concat(ks.map(k => [`Position ${k}`, a => a.position === k ? 1 : 0]))
      .concat(ks.map(k => [`Language × position ${k}`, a => a.position === k ? lc(a) : 0]))
      .concat([['Seed valence (per point)', a => a.seedValence - svMean], ['Block (second − first)', bc]]),
      a => a.valence, factorsFor((opts || {}).chain));
    D.svMean = svMean;
    return D;
  };

  /* Proficiency (exploratory): does a student's English self-rating change
     the language differences? prof: Map of student key → rating; the rating is
     centred on the mean over the students in the model. The rating varies only
     between students, so the language terms get by-student random slopes
     (uncorrelated, as lme4's ||): without them the cross-level interactions'
     standard errors would be too small. */
  const withRating = (rows, prof) => {
    const ok = rows.filter(d => isFinite(d.seedValence) && isFinite(prof.get(d.pid))).map(d => Object.assign({}, d, { rating: prof.get(d.pid) }));
    const byStudent = new Map(ok.map(d => [d.pid, d.rating]));
    return { ok, rMean: mean([...byStudent.values()]) };
  };
  A.modelDataProfA = function (trans, prof) {
    const { ok, rMean } = withRating(trans, prof);
    const svMean = mean(ok.map(t => t.seedValence));
    const pc = t => t.prev === 'P' ? 0.5 : -0.5, r = t => t.rating - rMean;
    const D = A.design(ok, [
      ['(Intercept)', () => 1],
      [LANG, lc],
      ['Previous state (positive − negative)', pc],
      ['Language × previous state', t => lc(t) * pc(t)],
      ['Seed valence (per point)', t => t.seedValence - svMean],
      ['Position (per step)', t => t.position - 5],
      ['Block (second − first)', bc],
      ['Proficiency (per point)', r],
      ['Language × proficiency', t => lc(t) * r(t)],
      ['Previous state × proficiency', t => pc(t) * r(t)],
      ['Language × previous state × proficiency', t => lc(t) * pc(t) * r(t)]
    ], t => t.next === 'P' ? 1 : 0, [['Student', t => t.pid], ['Student: language', t => t.pid, lc], ['Student: language × previous state', t => t.pid, t => lc(t) * pc(t)],
      ['Seed', t => t.seed], ['Chain', t => t.pid + '|' + t.seed]]);
    D.svMean = svMean; D.rMean = rMean;
    return D;
  };
  A.modelDataProfV = function (ans, prof) {
    const { ok, rMean } = withRating(ans.filter(a => a.scored), prof);
    const svMean = mean(ok.map(a => a.seedValence));
    const ps = a => a.position - 5.5, p2 = a => ps(a) * ps(a) - 8.25, r = a => a.rating - rMean;
    const D = A.design(ok, [
      ['(Intercept)', () => 1],
      [LANG, lc],
      ['Position (per step)', ps],
      ['Position² (curve)', p2],
      ['Language × position', a => lc(a) * ps(a)],
      ['Language × position²', a => lc(a) * p2(a)],
      ['Seed valence (per point)', a => a.seedValence - svMean],
      ['Block (second − first)', bc],
      ['Proficiency (per point)', r],
      ['Language × proficiency', a => lc(a) * r(a)]
    ], a => a.valence, [['Student', a => a.pid], ['Student: language', a => a.pid, lc], ['Seed', a => a.seed], ['Chain', a => a.pid + '|' + a.seed]]);
    D.svMean = svMean; D.rMean = rMean;
    return D;
  };

  /* The same model with uncorrelated by-student random slopes added (each
     [name, value of a row]); the student factor must come first. For the
     robustness check: the language terms' effects may differ between
     students. */
  A.addSlopes = function (D, slopes) {
    const g0 = D.groups[0];
    return Object.assign({}, D, {
      groups: [g0].concat(slopes.map(() => g0), D.groups.slice(1)),
      zv: [null].concat(slopes.map(([, f]) => Float64Array.from(D.data, f)), (D.zv || D.groups.map(() => null)).slice(1)),
      nLevels: [D.nLevels[0]].concat(slopes.map(() => D.nLevels[0]), D.nLevels.slice(1)),
      groupNames: [D.groupNames[0]].concat(slopes.map(([n]) => n), D.groupNames.slice(1))
    });
  };
  const slopesFor = (model, D) => {
    const pc = t => t.prev === 'P' ? 0.5 : -0.5, sv = a => a.seedValence - D.svMean;
    return model === 'A' ? [['Student: language', lc], ['Student: language × previous state', t => lc(t) * pc(t)]]
      : model === 'C1' ? [['Student: language', lc], ['Student: language × previous valence', t => lc(t) * (t.prevV - 5)]]
      : model === 'C' ? [['Student: language', lc], ['Student: language × position', a => lc(a) * (a.position - 5.5)]]
      : [['Student: language × seed valence', a => lc(a) * sv(a)], ['Student: language × seed valence × position', a => lc(a) * sv(a) * Math.log2(a.position)]];
  };

  /* A student-level moderator (Map of student key → value), centred on the
     mean over the students in the model; rows without a value are left out. */
  const withMod = (rows, mod) => {
    const ok = rows.filter(d => isFinite(d.seedValence) && isFinite(mod.get(d.pid))).map(d => Object.assign({}, d, { mod: mod.get(d.pid) }));
    const byStudent = new Map(ok.map(d => [d.pid, d.mod]));
    return { ok, mMean: mean([...byStudent.values()]) };
  };
  /* Exploratory: does a student's English − Chinese difference in cross-chain
     reuse (M) go with their English − Chinese difference in how the starting
     word's influence changes along the chain? The starting-word model, every
     term also × M; the key term is Language × seed valence × position × M.
     M varies only between students, so the term it moderates gets a
     by-student random slope. */
  A.modelDataBmod = function (ans, mod) {
    const { ok, mMean } = withMod(ans.filter(a => a.scored), mod);
    const svMean = mean(ok.map(a => a.seedValence));
    const sv = a => a.seedValence - svMean, ps = a => Math.log2(a.position), m = a => a.mod - mMean;
    const base = [[LANG, lc], ['Seed valence (per point)', sv], ['Position (per doubling, from answer 1)', ps], ['Language × seed valence', a => lc(a) * sv(a)],
      ['Language × position', a => lc(a) * ps(a)], ['Seed valence × position', a => sv(a) * ps(a)], ['Language × seed valence × position', a => lc(a) * sv(a) * ps(a)]];
    const D = A.design(ok, [['(Intercept)', () => 1]].concat(base, [['Block (second − first)', bc], ['M (per point)', m]], base.map(([n, f]) => [`${n} × M`, a => f(a) * m(a)])),
      a => a.valence, [['Student', a => a.pid], ['Student: language × seed valence × position', a => a.pid, a => lc(a) * sv(a) * ps(a)], ['Seed', a => a.seed], ['Chain', a => a.pid + '|' + a.seed]]);
    D.svMean = svMean; D.mMean = mMean;
    return D;
  };
  /* Exploratory, Chinese (L1) answers only: does a bilingual-experience measure
     X (English age of acquisition, English use, or English − Chinese overall
     rating; centred) go with how the starting word's influence changes along
     the Chinese chain (key term: seed valence × position × X), or with the
     Chinese trajectory's shape (joint test: position × X, position² × X)? */
  A.modelDataL1Seed = function (ans, mod) {
    const { ok, mMean } = withMod(ans.filter(a => a.scored && a.lang === 'zh'), mod);
    const svMean = mean(ok.map(a => a.seedValence));
    const sv = a => a.seedValence - svMean, ps = a => Math.log2(a.position), x = a => a.mod - mMean;
    const D = A.design(ok, [['(Intercept)', () => 1], ['Seed valence (per point)', sv], ['Position (per doubling, from answer 1)', ps], ['Seed valence × position', a => sv(a) * ps(a)],
      ['Block (second − first)', bc], ['X (per unit)', x], ['Seed valence × X', a => sv(a) * x(a)], ['Position × X', a => ps(a) * x(a)], ['Seed valence × position × X', a => sv(a) * ps(a) * x(a)]],
      a => a.valence, [['Student', a => a.pid], ['Student: seed valence × position', a => a.pid, a => sv(a) * ps(a)], ['Seed', a => a.seed], ['Chain', a => a.pid + '|' + a.seed]]);
    D.svMean = svMean; D.mMean = mMean;
    return D;
  };
  A.modelDataL1Traj = function (ans, mod) {
    const { ok, mMean } = withMod(ans.filter(a => a.scored && a.lang === 'zh'), mod);
    const svMean = mean(ok.map(a => a.seedValence));
    const ps = a => a.position - 5.5, p2 = a => ps(a) * ps(a) - 8.25, x = a => a.mod - mMean;
    const D = A.design(ok, [['(Intercept)', () => 1], ['Position (per step)', ps], ['Position² (curve)', p2], ['Seed valence (per point)', a => a.seedValence - svMean],
      ['Block (second − first)', bc], ['X (per unit)', x], ['Position × X', a => ps(a) * x(a)], ['Position² × X', a => p2(a) * x(a)]],
      a => a.valence, [['Student', a => a.pid], ['Student: position', a => a.pid, ps], ['Seed', a => a.seed], ['Chain', a => a.pid + '|' + a.seed]]);
    D.svMean = svMean; D.mMean = mMean;
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
  /* R: linear predictors per row (1, or 2 for the three-state model's two
     logits); every fixed effect and every factor level then has R unknowns,
     a level's R next to each other. */
  function layout(D, R) {
    R = R || 1;
    const px = D.X[0].length, p = R * px, K = D.groups.length, off = [];
    let m1 = p;
    for (let k = 0; k < K - 1; k++) { off.push(m1); m1 += R * D.nLevels[k]; }
    // When the last factor is nested in the first (each chain belongs to one
    // student), the factors with the first factor's grouping (a student's
    // intercept and any slopes) touch no other student's, so S holds one small
    // block per student; factorise() eliminates those too. Otherwise (e.g. the
    // last factor is the seed, shared by all students) S stays dense.
    const levelsOf = k => { const own = new Int32Array(D.nLevels[K - 1]).fill(-1);
      for (let i = 0; i < D.y.length; i++) { const c = D.groups[K - 1][i]; if (own[c] < 0) own[c] = D.groups[k][i]; else if (own[c] !== D.groups[k][i]) return false; }
      return true; };
    const nested = K > 1 && levelsOf(0);
    let lastNested = true;
    for (let k = 0; k < K - 1 && lastNested; k++) lastNested = levelsOf(k);
    const same = [];
    if (nested) for (let k = 0; k < K - 1; k++) if (D.nLevels[k] === D.nLevels[0] && D.groups[k].every((g, i) => g === D.groups[0][i])) same.push(k);
    const blocks = same.length ? Array.from({ length: D.nLevels[0] }, (_, j) => same.flatMap(k => Array.from({ length: R }, (__, d) => off[k] + R * j + d))) : [];
    const inB = new Uint8Array(m1); blocks.forEach(b => b.forEach(i => { inB[i] = 1; }));
    const dense = []; for (let i = 0; i < m1; i++) if (!inB[i]) dense.push(i);
    return { p, px, R, K, off, m1, qK: D.nLevels[K - 1], m: m1 + R * D.nLevels[K - 1], blocks, dense, lastNested };
  }
  /* Factorise S by eliminating the per-student blocks: S' = S_DD − Σ_b S_Db
     S_bb⁻¹ S_bD on the dense part (fixed effects first, then e.g. the seeds).
     Gives solves with S, log|S|, log|S without the fixed effects| and the
     fixed-effect block of S⁻¹ (which is that of S'⁻¹). null if not PD. */
  function factorise(S, Lo) {
    const { blocks, dense, p } = Lo, nd = dense.length;
    const Sp = dense.map(i => Float64Array.from(dense, j => S[i][j]));
    const Bs = [];
    let logdetB = 0;
    for (const ib of blocks) {
      const Lb = chol(ib.map(i => ib.map(j => S[i][j])));
      if (!Lb) return null;
      logdetB += logdetChol(Lb);
      const Q = dense.map(i => Float64Array.from(ib, j => S[i][j]));          // S_Db, nd × s
      const W = Q.map(q => cholSolve(Lb, q));                                   // rows of S_Db S_bb⁻¹
      for (let a = 0; a < nd; a++) { const qa = Q[a]; for (let c = 0; c <= a; c++) { const wc = W[c]; let s = 0; for (let t = 0; t < ib.length; t++) s += qa[t] * wc[t]; Sp[a][c] -= s; } }
      Bs.push({ ib, Lb, Q });
    }
    for (let a = 0; a < nd; a++) for (let c = a + 1; c < nd; c++) Sp[a][c] = Sp[c][a];
    const Ld = chol(Sp);
    if (!Ld) return null;
    return {
      logdet: logdetB + logdetChol(Ld),
      logdetU() { if (nd === p) return logdetB; const Lu = chol(Array.from(Sp.slice(p), r => r.slice(p))); return Lu ? logdetB + logdetChol(Lu) : NaN; },
      solve(rhs) {
        const yD = Float64Array.from(dense, i => rhs[i]);
        Bs.forEach(B => { const z = cholSolve(B.Lb, Float64Array.from(B.ib, i => rhs[i])); for (let a = 0; a < nd; a++) { let s = 0; for (let t = 0; t < z.length; t++) s += B.Q[a][t] * z[t]; yD[a] -= s; } });
        const xD = cholSolve(Ld, yD), x = new Float64Array(rhs.length);
        dense.forEach((i, a) => { x[i] = xD[a]; });
        Bs.forEach(B => { const r = Float64Array.from(B.ib, (i, t) => { let s = rhs[i]; for (let a = 0; a < nd; a++) s -= B.Q[a][t] * xD[a]; return s; }); const xb = cholSolve(B.Lb, r); B.ib.forEach((i, t) => { x[i] = xb[t]; }); });
        return x;
      },
      betaCov() {
        const cov = Array.from({ length: p }, () => new Float64Array(p));
        for (let j = 0; j < p; j++) { const e = new Float64Array(nd); e[j] = 1; const col = cholSolve(Ld, e); for (let i = 0; i < p; i++) cov[i][j] = col[i]; }
        return cov;
      }
    };
  }
  /* The last factor's column of the system, per level, is kept sparse: {ix,
     v}, its nonzero positions and values. When every row of a level shares
     all its factor levels (a chain: one student, one seed), those positions
     are the same for each of its rows and are filled in place. */
  function assemble(D, Lo, theta, w, r) {
    const { p, K, off, m1, qK } = Lo, n = D.y.length, tK = theta[K - 1], nnz = p + K - 1, Xf = D.Xf, G = D.G, Z = D.Z;
    const S = Array.from({ length: m1 }, () => new Float64Array(m1));
    const dK = new Float64Array(qK).fill(1);
    const g1 = new Float64Array(m1), g2 = new Float64Array(qK);
    const idx = new Int32Array(nnz), val = new Float64Array(nnz);
    const compact = Lo.lastNested;
    const Bi = compact ? new Int32Array(qK * nnz) : null, Bv = compact ? new Float64Array(qK * nnz) : null;
    const Bc = compact ? null : Array.from({ length: qK }, () => new Float64Array(m1));
    for (let i = 0; i < n; i++) {
      const wi = w ? w[i] : 1, ri = r[i], xo = i * p;
      for (let j = 0; j < p; j++) { idx[j] = j; val[j] = Xf[xo + j]; }
      for (let k = 0; k < K - 1; k++) { idx[p + k] = off[k] + G[k][i]; val[p + k] = Z[k] ? theta[k] * Z[k][i] : theta[k]; }
      const c = G[K - 1][i], co = c * nnz;
      for (let a = 0; a < nnz; a++) {
        const ia = idx[a], wa = wi * val[a], row = S[ia];
        g1[ia] += val[a] * ri;
        if (compact) { Bi[co + a] = ia; Bv[co + a] += wa * tK; } else Bc[c][ia] += wa * tK;
        for (let b = 0; b <= a; b++) row[idx[b]] += wa * val[b];   // idx ascending: lower triangle
      }
      dK[c] += wi * tK * tK;
      g2[c] += tK * ri;
    }
    for (let j = p; j < m1; j++) S[j][j] += 1;
    for (let a = 0; a < m1; a++) for (let b = a + 1; b < m1; b++) S[a][b] = S[b][a];
    const B = compact ? Array.from({ length: qK }, (_, c) => ({ ix: Bi.subarray(c * nnz, (c + 1) * nnz), v: Bv.subarray(c * nnz, (c + 1) * nnz) }))
      : Bc.map(b => { const ix = []; for (let j = 0; j < m1; j++) if (b[j] !== 0) ix.push(j); return { ix, v: ix.map(j => b[j]) }; });
    B.forEach(({ ix, v }, c) => { const d = dK[c]; for (let a = 0; a < ix.length; a++) { const f = v[a] / d, row = S[ix[a]]; for (let e = 0; e < ix.length; e++) row[ix[e]] -= f * v[e]; } });
    return { S, dK, B, g1, g2 };
  }
  function solveSys(sys, L, g1, g2) {
    const rhs = Float64Array.from(g1);
    sys.B.forEach(({ ix, v }, c) => { const f = g2[c] / sys.dK[c]; for (let a = 0; a < ix.length; a++) rhs[ix[a]] -= v[a] * f; });
    const x1 = L.solve(rhs), x2 = new Float64Array(sys.dK.length);
    sys.B.forEach(({ ix, v }, c) => { let s = g2[c]; for (let a = 0; a < ix.length; a++) s -= v[a] * x1[ix[a]]; x2[c] = s / sys.dK[c]; });
    return [x1, x2];
  }
  const sumLog = a => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.log(a[i]); return s; };
  // log|θZᵀWZθ + I|: the eliminated chains' diagonal plus S without the fixed effects.
  const logdetU = (sys, F) => sumLog(sys.dK) + F.logdetU();
  // Linear predictor: x·β + Σ θ_k v_k at the row's levels.
  function linpred(D, Lo, theta, par) {
    const { p, K, off, m1 } = Lo, n = D.y.length, e = new Float64Array(n), Xf = D.Xf, G = D.G, Z = D.Z;
    for (let i = 0; i < n; i++) {
      let s = 0; const xo = i * p;
      for (let j = 0; j < p; j++) s += Xf[xo + j] * par[j];
      for (let k = 0; k < K - 1; k++) s += (Z[k] ? theta[k] * Z[k][i] : theta[k]) * par[off[k] + G[k][i]];
      e[i] = s + theta[K - 1] * par[m1 + G[K - 1][i]];
    }
    return e;
  }
  // The β block of S⁻¹ (= the β block of H⁻¹).
  const betaBlock = F => F.betaCov();

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
      L = factorise(sys.S, Lo);
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
    const ld = logdetU(sys, L);
    if (!isFinite(ld)) return { ok: false };
    return { ok: true, par, dev: -2 * (f - 0.5 * ld), L, iterations: it };
  }

  /* ---------- the multinomial (baseline-category) logit: R = C − 1 logits ----------
     A row's linear predictors η_c = x·β_c + Σ_k z_k (Λ_k v_k)_c, c = 1…R,
     against the reference destination (η = 0). Each factor level carries R
     spherical effects v; Λ_k is R × R lower-triangular, so the level's
     random effects have the unstructured covariance Λ_kΛ_kᵀ. With weights
     W = diag(μ) − μμᵀ per row the system is H = Σ Aᵀ W A + I on the v's (A:
     the row's R × unknowns design). The last factor's R × R blocks are
     eliminated as in assemble(). */
  /* Rows with the same level of every factor (and the same slope values: a
     chain's rows, since a chain has one language) share their random-effect
     columns, so those parts of H are summed per such group (sig, rep: a row's
     group and each group's first row). Only the fixed-effect block is summed
     row by row. */
  function sigGroups(D) {
    const K = D.G.length, m = new Map(), sig = new Int32Array(D.y.length), rep = [];
    for (let i = 0; i < D.y.length; i++) {
      let key = ''; for (let k = 0; k < K; k++) key += D.G[k][i] + (D.Z[k] ? ':' + D.Z[k][i] : '') + '|';
      let g = m.get(key); if (g === undefined) { g = rep.length; m.set(key, g); rep.push(i); }
      sig[i] = g;
    }
    return { sig, rep: Int32Array.from(rep) };
  }
  function assembleM(D, Lo, Lam, W, r) {
    const { px, R, K, off, m1, qK } = Lo, n = D.y.length, Xf = D.Xf, G = D.G, Z = D.Z;
    const RR = R * R, p = R * px, nR = R * (K - 1), nA = p + nR, { sig, rep } = D.sg, ng = rep.length;
    const S = Array.from({ length: m1 }, () => new Float64Array(m1));
    const g1 = new Float64Array(m1), g2 = new Float64Array(R * qK), Dk = new Float64Array(qK * RR);
    const SW = new Float64Array(ng * RR), SWX = new Float64Array(ng * RR * px), Sr = new Float64Array(ng * R);
    for (let i = 0; i < n; i++) {
      const xo = i * px, wo = i * RR, g = sig[i];
      for (let c = 0; c < R; c++) {
        const rc = r[i * R + c];
        Sr[g * R + c] += rc;
        for (let j = 0; j < px; j++) g1[c * px + j] += rc * Xf[xo + j];
        for (let e = 0; e < R; e++) {
          const w = W[wo + c * R + e], so = (g * RR + c * R + e) * px;
          SW[g * RR + c * R + e] += w;
          for (let j = 0; j < px; j++) SWX[so + j] += w * Xf[xo + j];
        }
      }
    }
    // fixed–fixed, lower triangle: Σ_i W_ce x_j x_j', as dot products over the columns (Xc: column-major X)
    const Xc = D.Xc, wv = new Float64Array(n), xw = new Float64Array(n);
    for (let c = 0; c < R; c++) for (let e = 0; e <= c; e++) {
      for (let i = 0; i < n; i++) wv[i] = W[i * RR + c * R + e];
      for (let j = 0; j < px; j++) {
        const xj = Xc[j], row = S[c * px + j], top = e === c ? j : px - 1, eo = e * px;
        for (let i = 0; i < n; i++) xw[i] = wv[i] * xj[i];
        for (let jj = 0; jj <= top; jj++) { const xk = Xc[jj]; let s = 0; for (let i = 0; i < n; i++) s += xw[i] * xk[i]; row[eo + jj] += s; }
      }
    }
    const compact = Lo.lastNested;
    const Bi = compact ? new Int32Array(qK * nA) : null, Bv = compact ? new Float64Array(qK * nA * R) : null;
    const Bc = compact ? null : Array.from({ length: qK }, () => new Float64Array(m1 * R));
    const idx = new Int32Array(nR), Ar = new Float64Array(R * nR), AL = new Float64Array(RR), T = new Float64Array(R * nR), TL = new Float64Array(RR);
    const LK = Lam[K - 1];
    for (let g = 0; g < ng; g++) {
      const i = rep[g], sw = g * RR;
      Ar.fill(0);
      let a0 = 0;
      for (let k = 0; k < K - 1; k++) {
        const z = Z[k] ? Z[k][i] : 1, base = off[k] + R * G[k][i], Lk = Lam[k];
        for (let d = 0; d < R; d++) { idx[a0 + d] = base + d; for (let c = d; c < R; c++) Ar[c * nR + a0 + d] = z * Lk[c * R + d]; }
        a0 += R;
      }
      const zK = Z[K - 1] ? Z[K - 1][i] : 1;
      for (let c = 0; c < R; c++) for (let d = 0; d < R; d++) AL[c * R + d] = d <= c ? zK * LK[c * R + d] : 0;
      for (let c = 0; c < R; c++) {
        for (let a = 0; a < nR; a++) { let s = 0; for (let e = 0; e < R; e++) s += SW[sw + c * R + e] * Ar[e * nR + a]; T[c * nR + a] = s; }
        for (let d = 0; d < R; d++) { let s = 0; for (let e = 0; e < R; e++) s += SW[sw + c * R + e] * AL[e * R + d]; TL[c * R + d] = s; }
      }
      for (let a = 0; a < nR; a++) {
        const row = S[idx[a]];
        let ga = 0; for (let c = 0; c < R; c++) ga += Ar[c * nR + a] * Sr[g * R + c];
        g1[idx[a]] += ga;
        for (let b = 0; b <= a; b++) { let s = 0; for (let c = 0; c < R; c++) s += Ar[c * nR + a] * T[c * nR + b]; row[idx[b]] += s; }
        // random–fixed: Σ over the group's rows of (A_rand)ᵀ W x
        for (let c = 0; c < R; c++) for (let j = 0; j < px; j++) { let s = 0; for (let e = 0; e < R; e++) s += Ar[e * nR + a] * SWX[(sw + e * R + c) * px + j]; row[c * px + j] += s; }
      }
      const cK = G[K - 1][i];
      for (let d = 0; d < R; d++) {
        let gs = 0; for (let c = 0; c < R; c++) gs += AL[c * R + d] * Sr[g * R + c];
        g2[cK * R + d] += gs;
        for (let e = 0; e < R; e++) { let s = 0; for (let c = 0; c < R; c++) s += AL[c * R + d] * TL[c * R + e]; Dk[cK * RR + d * R + e] += s; }
      }
      // cross terms with the last factor: fixed columns, then the other factors' columns
      for (let a = 0; a < nA; a++) for (let d = 0; d < R; d++) {
        let s = 0, col;
        if (a < p) { const c = (a / px) | 0, j = a - c * px; col = a; for (let e = 0; e < R; e++) s += SWX[(sw + c * R + e) * px + j] * AL[e * R + d]; }
        else { const b = a - p; col = idx[b]; for (let c = 0; c < R; c++) s += Ar[c * nR + b] * TL[c * R + d]; }
        if (compact) { Bi[cK * nA + a] = col; Bv[(cK * nA + a) * R + d] += s; } else Bc[cK][col * R + d] += s;
      }
    }
    for (let j = R * px; j < m1; j++) S[j][j] += 1;
    const B = compact ? Array.from({ length: qK }, (_, c) => ({ ix: Bi.subarray(c * nA, (c + 1) * nA), v: Bv.subarray(c * nA * R, (c + 1) * nA * R) }))
      : Bc.map(b => { const ix = [], v = []; for (let j = 0; j < m1; j++) { let nz = false; for (let d = 0; d < R; d++) if (b[j * R + d] !== 0) nz = true; if (nz) { ix.push(j); for (let d = 0; d < R; d++) v.push(b[j * R + d]); } } return { ix, v }; });
    // Each last-factor level's block D_c = (AᵀWA)_c + I, inverted; S −= B_c D_c⁻¹ B_cᵀ.
    const Dinv = new Float64Array(qK * RR);
    let logdetD = 0;
    for (let c = 0; c < qK; c++) {
      const Lc = chol(Array.from({ length: R }, (_, d) => Array.from({ length: R }, (__, e) => Dk[c * RR + d * R + e] + (d === e ? 1 : 0))));
      if (!Lc) return null;
      logdetD += logdetChol(Lc);
      for (let e = 0; e < R; e++) { const u = new Float64Array(R); u[e] = 1; const col = cholSolve(Lc, u); for (let d = 0; d < R; d++) Dinv[c * RR + d * R + e] = col[d]; }
      const { ix, v } = B[c], nb = ix.length, U = new Float64Array(nb * R);
      for (let a = 0; a < nb; a++) for (let d = 0; d < R; d++) { let s = 0; for (let e = 0; e < R; e++) s += v[a * R + e] * Dinv[c * RR + e * R + d]; U[a * R + d] = s; }
      // lower triangle only (ix ascending in the compact case; otherwise by index)
      for (let a = 0; a < nb; a++) { const ia = ix[a], row = S[ia]; for (let b = 0; b < nb; b++) { const ib = ix[b]; if (ib > ia) continue; let s = 0; for (let d = 0; d < R; d++) s += U[a * R + d] * v[b * R + d]; row[ib] -= s; } }
    }
    for (let a = 0; a < m1; a++) for (let b = a + 1; b < m1; b++) S[a][b] = S[b][a];
    return { S, B, Dinv, logdetD, g1, g2 };
  }
  function solveSysM(sys, F, g1, g2, R) {
    const RR = R * R, rhs = Float64Array.from(g1), qK = sys.B.length;
    const t = new Float64Array(R);
    sys.B.forEach(({ ix, v }, c) => {
      for (let d = 0; d < R; d++) { let s = 0; for (let e = 0; e < R; e++) s += sys.Dinv[c * RR + d * R + e] * g2[c * R + e]; t[d] = s; }
      for (let a = 0; a < ix.length; a++) for (let d = 0; d < R; d++) rhs[ix[a]] -= v[a * R + d] * t[d];
    });
    const x1 = F.solve(rhs), x2 = new Float64Array(R * qK), s = new Float64Array(R);
    sys.B.forEach(({ ix, v }, c) => {
      for (let d = 0; d < R; d++) { let q = g2[c * R + d]; for (let a = 0; a < ix.length; a++) q -= v[a * R + d] * x1[ix[a]]; s[d] = q; }
      for (let d = 0; d < R; d++) { let q = 0; for (let e = 0; e < R; e++) q += sys.Dinv[c * RR + d * R + e] * s[e]; x2[c * R + d] = q; }
    });
    return [x1, x2];
  }
  function linpredM(D, Lo, Lam, par) {
    const { px, R, K, off, m1 } = Lo, n = D.y.length, e = new Float64Array(n * R), Xf = D.Xf, G = D.G, Z = D.Z, { sig, rep } = D.sg;
    const u = new Float64Array(rep.length * R);   // each group's random part
    for (let g = 0; g < rep.length; g++) {
      const i = rep[g];
      for (let c = 0; c < R; c++) {
        let s = 0;
        for (let k = 0; k < K; k++) {
          const z = Z[k] ? Z[k][i] : 1, base = (k < K - 1 ? off[k] : m1) + R * G[k][i], Lk = Lam[k];
          for (let d = 0; d <= c; d++) s += z * Lk[c * R + d] * par[base + d];
        }
        u[g * R + c] = s;
      }
    }
    for (let i = 0; i < n; i++) {
      const xo = i * px, g = sig[i];
      for (let c = 0; c < R; c++) {
        let s = u[g * R + c];
        for (let j = 0; j < px; j++) s += Xf[xo + j] * par[c * px + j];
        e[i * R + c] = s;
      }
    }
    return e;
  }
  // Penalised IRLS for fixed Λ's (multinomial): as pirls().
  function pirlsM(D, Lo, Lam, start) {
    const n = D.y.length, { p, m1, m, R } = Lo, RR = R * R, yc = D.yc;
    let par = start && start.length === m ? Float64Array.from(start) : new Float64Array(m);
    const mu = new Float64Array(n * R);
    const probs = e => {   // μ for the non-reference destinations; returns Σ log μ(observed)
      let ll = 0;
      for (let i = 0; i < n; i++) {
        let mx = 0; for (let c = 0; c < R; c++) mx = Math.max(mx, e[i * R + c]);
        let den = Math.exp(-mx); for (let c = 0; c < R; c++) den += Math.exp(e[i * R + c] - mx);
        for (let c = 0; c < R; c++) mu[i * R + c] = Math.exp(e[i * R + c] - mx) / den;
        ll += (yc[i] >= 0 ? e[i * R + yc[i]] : 0) - mx - Math.log(den);
      }
      return ll;
    };
    const objective = (par, e) => { let s = probs(e); for (let j = p; j < m; j++) s -= 0.5 * par[j] * par[j]; return s; };
    let e = linpredM(D, Lo, Lam, par), f = objective(par, e), sys, F, it = 0;
    const W = new Float64Array(n * RR), r = new Float64Array(n * R);
    for (; it < 80; it++) {
      for (let i = 0; i < n; i++) for (let c = 0; c < R; c++) {
        const mc = mu[i * R + c];
        r[i * R + c] = (yc[i] === c ? 1 : 0) - mc;
        for (let d = 0; d < R; d++) W[i * RR + c * R + d] = (c === d ? mc : 0) - mc * mu[i * R + d];
      }
      sys = assembleM(D, Lo, Lam, W, r);
      F = sys && factorise(sys.S, Lo);
      if (!F) return { ok: false };
      const g1 = Float64Array.from(sys.g1), g2 = Float64Array.from(sys.g2);
      for (let j = p; j < m1; j++) g1[j] -= par[j];
      for (let c = 0; c < g2.length; c++) g2[c] -= par[m1 + c];
      const [s1, s2] = solveSysM(sys, F, g1, g2, R);
      const step = new Float64Array(m); step.set(s1); step.set(s2, m1);
      let big = 0; for (let j = 0; j < m; j++) big = Math.max(big, Math.abs(step[j]));
      if (big < 1e-7) break;
      let t = 1, next, en, fn;
      for (let h = 0; h < 30; h++, t /= 2) {
        next = par.map((x, j) => x + t * step[j]);
        en = linpredM(D, Lo, Lam, next); fn = objective(next, en);
        if (fn >= f - 1e-12) break;
      }
      if (!(fn >= f - 1e-12)) break;   // mu was last set at a rejected point; the system above belongs to the mode
      par = next; e = en; f = fn;
    }
    const ld = sys.logdetD + F.logdetU();
    if (!isFinite(ld)) return { ok: false };
    return { ok: true, par, dev: -2 * (f - 0.5 * ld), F, iterations: it };
  }

  /* Penalised least squares for fixed theta (linear): β̂, v̂, the penalised
     residual sum of squares r², and log|M| for the REML criterion
     (M: the joint system, whose determinant is |L_θ|²|R_X|²). */
  function pls(D, Lo, theta) {
    const n = D.y.length, { p, m1, m } = Lo;
    const sys = assemble(D, Lo, theta, null, D.y);
    const L = factorise(sys.S, Lo);
    if (!L) return { ok: false };
    const [x1, x2] = solveSys(sys, L, sys.g1, sys.g2);
    const par = new Float64Array(m); par.set(x1); par.set(x2, m1);
    const e = linpred(D, Lo, theta, par);
    let r2 = 0;
    for (let i = 0; i < n; i++) r2 += (D.y[i] - e[i]) * (D.y[i] - e[i]);
    for (let j = p; j < m; j++) r2 += par[j] * par[j];
    return { ok: true, par, r2, L, logdetM: sumLog(sys.dK) + L.logdet };
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
  // Regularised upper incomplete gamma Q(a, x) (Numerical Recipes gser/gcf).
  function gammaQ(a, x) {
    if (!(x > 0)) return 1;
    const gln = lgamma(a);
    if (x < a + 1) {
      let sum = 1 / a, del = sum, ap = a;
      for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 3e-14) break; }
      return 1 - sum * Math.exp(-x + a * Math.log(x) - gln);
    }
    let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
    for (let i = 1; i < 500; i++) {
      const an = -i * (i - a); b += 2;
      d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300; c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d;
      const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-14) break;
    }
    return Math.exp(-x + a * Math.log(x) - gln) * h;
  }
  A.pChi2 = (x, df) => isFinite(x) && df > 0 ? gammaQ(df / 2, x / 2) : NaN;
  A.pF = (F, d1, d2) => isFinite(F) && d1 > 0 && d2 > 0 ? (F <= 0 ? 1 : ibeta(d2 / (d2 + d1 * F), d2 / 2, d1 / 2)) : NaN;
  A.pT = (t, df) => isFinite(t) && df > 0 ? (df > 1e6 ? A.pNorm(t) : ibeta(df / (df + t * t), df / 2, 0.5)) : NaN;
  A.qT = df => {   // t such that two-tailed p = .05
    if (!(df > 0)) return NaN;
    if (df > 1e6) return 1.959964;
    let lo = 0, hi = 1000;
    for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (A.pT(mid, df) > 0.05) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };

  function jacobiEigen(M) {
    const n = M.length, a = M.map(r => Array.from(r)), v = a.map((_, i) => a.map((__, j) => i === j ? 1 : 0));
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
      if (off < 1e-30) break;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
        for (let k = 0; k < n; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
        for (let k = 0; k < n; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
      }
    }
    return { values: a.map((r, i) => r[i]), vectors: a.map((_, j) => v.map(r => r[j])) };   // vectors[j]: the j-th eigenvector
  }

  // Columns the data cannot estimate are dropped (e.g. block while every
  // student so far did the same order).
  function prepare(Din) {
    const keep = estimable(Din.X, Din.names);
    const D = Object.assign({}, Din, { X: Din.X.map(r => keep.map(j => r[j])), names: keep.map(j => Din.names[j]), cols: keep.map(j => Din.cols[j]) });
    const p = keep.length;
    D.Xf = new Float64Array(D.X.length * p); D.X.forEach((r, i) => { for (let j = 0; j < p; j++) D.Xf[i * p + j] = r[j]; });
    D.G = Din.groups.map(g => Int32Array.from(g));
    D.Z = Din.groups.map((_, k) => Din.zv && Din.zv[k] ? Din.zv[k] : null);
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
    /* Joint (omnibus) Wald test that the named coefficients are all zero.
       Logistic: χ² = bᵀ V⁻¹ b on q df. Linear: F = χ²/q, with Satterthwaite
       denominator df for a multi-df contrast, as lmerTest's contest():
       eigen-decompose L·Cov·Lᵀ, take each eigen-contrast's Satterthwaite df
       ν_m, E = Σ ν_m/(ν_m − 2) and ddf = 2E/(E − q) (2 if any ν_m ≤ 2). */
    out.wald = names => {
      const ix = names.map(idx);
      if (ix.some(i => i < 0)) return null;
      const q = ix.length, b = ix.map(i => beta[i]), V = ix.map(i => ix.map(j => cov[i][j]));
      const Lc = chol(V);
      if (!Lc) return null;
      const w = cholSolve(Lc, Float64Array.from(b));
      let chi2 = 0; for (let k = 0; k < q; k++) chi2 += b[k] * w[k];
      if (!dfOf) return { names, q, chi2, stat: chi2, df: q, p: A.pChi2(chi2, q), kind: 'chi2' };
      const eg = jacobiEigen(V);
      const nus = eg.vectors.map(vec => { const full = new Array(p).fill(0); ix.forEach((i, k) => { full[i] = vec[k]; }); return dfOf(full); });
      let ddf;
      if (q === 1) ddf = nus[0];
      else if (nus.some(nu => !(nu > 2))) ddf = 2;
      else { const E = nus.reduce((s, nu) => s + nu / (nu - 2), 0); ddf = E > q ? 2 * E / (E - q) : 2; }
      const F = chi2 / q;
      return { names, q, F, stat: F, df: q, ddf, p: A.pF(F, q, ddf), kind: 'F' };
    };
    // Wald χ² that several linear combinations ({name: weight} each) are all zero.
    out.waldL = combos => {
      const L = combos.map(w => D.names.map(n => w[n] || 0));
      if (combos.some(w => Object.keys(w).some(n => idx(n) < 0))) return null;
      const q = L.length, b = L.map(l => l.reduce((s, x, a) => s + x * beta[a], 0));
      const V = L.map(la => L.map(lb => { let v = 0; for (let a = 0; a < p; a++) { if (!la[a]) continue; for (let c = 0; c < p; c++) v += la[a] * lb[c] * cov[a][c]; } return v; }));
      const Lc = chol(V);
      if (!Lc) return null;
      const w = cholSolve(Lc, Float64Array.from(b));
      let chi2 = 0; for (let k = 0; k < q; k++) chi2 += b[k] * w[k];
      return { q, chi2, stat: chi2, df: q, p: A.pChi2(chi2, q), kind: 'chi2' };
    };
    out.names = D.names; out.beta = beta; out.cov = cov;
    return out;
  }

  /* Logistic mixed model (Laplace, β estimated with the random effects as
     lme4's nAGQ = 0). trans: the transitions, for model A's separation check. */
  A.glmm = function (Din, trans, start) {
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
    const maxEval = 250 * K, nm = nelderMead(dev, start && start.length === K ? start.slice() : new Array(K).fill(1), 0.5, maxEval);
    const theta = nm.x.map(Math.abs);
    const fit = pirls(D, Lo, theta, warm);
    if (!fit.ok) return { ok: false, reason: 'converge' };
    const p = Lo.p, cov = betaBlock(fit.L), beta = Array.from(fit.par.slice(0, p));
    const out = finish({ ok: true, kind: 'glmm', n, nLevels: D.nLevels, groupNames: D.groupNames, theta, sd: theta, deviance: fit.dev, dropped, evals: nm.evals, D }, D, beta, cov, null);
    out.converged = out.coef.every(c => isFinite(c.se) && c.se < 50) && nm.evals < maxEval;
    return out;
  };

  /* Multinomial logit mixed model (Laplace, β estimated with the random
     effects as lme4's nAGQ = 0; Nelder–Mead on the Λ's, log-free: the
     diagonal enters as |θ|). Din.C destinations, Din.ref the reference;
     coefficient names "<destination> vs <reference>: <term>". */
  A.mglmm = function (Din, trans, start) {
    const n = Din.y.length, C = Din.C || 3, R = C - 1, ref = Din.ref || 0;
    if (n < 20 || Din.nLevels.slice(0, 2).some(q => q < 2)) return { ok: false, reason: 'few' };
    if (trans) {
      const empty = [];
      ['zh', 'en'].forEach(lang => A.STATES3.forEach(prev => A.STATES3.forEach(next => {
        if (trans.some(t => t.lang === lang && t.prev === prev) && !trans.some(t => t.lang === lang && t.prev === prev && t.next === next)) empty.push({ lang, prev, next });
      })));
      if (empty.length) return { ok: false, reason: 'separation', empty };
    }
    for (let c = 0; c < C; c++) if (!Din.y.includes(c)) return { ok: false, reason: 'novar' };
    const { D, dropped } = prepare(Din), Lo = layout(D, R), K = D.groups.length, nt = R * (R + 1) / 2;
    D.yc = Int32Array.from(D.y, y => y === ref ? -1 : y < ref ? y : y - 1);
    D.sg = sigGroups(D);
    D.Xc = Array.from({ length: Lo.px }, (_, j) => Float64Array.from(D.X, row => row[j]));
    const cats = Array.from({ length: C }, (_, c) => c).filter(c => c !== ref);
    const diag = Array.from({ length: nt }, (_, q) => { let k = 0; for (let c = 0; c < R; c++) for (let d = 0; d <= c; d++, k++) if (k === q) return c === d; return false; });
    const toLam = th => Array.from({ length: K }, (_, k) => {
      const L = new Float64Array(R * R); let q = k * nt;
      for (let c = 0; c < R; c++) for (let d = 0; d <= c; d++, q++) L[c * R + d] = c === d ? Math.abs(th[q]) : th[q];
      return L;
    });
    let warm = null;
    const dev = th => { const r = pirlsM(D, Lo, toLam(th), warm); if (!r.ok) return 1e300; warm = r.par; return r.dev; };
    const x0 = start && start.length === K * nt ? start.slice() : Array.from({ length: K * nt }, (_, q) => diag[q % nt] ? 0.5 : 0);
    const maxEval = 400 * K * nt, nm = nelderMead(dev, x0, 0.25, maxEval);
    const Lam = toLam(nm.x), fit = pirlsM(D, Lo, Lam, warm);
    if (!fit.ok) return { ok: false, reason: 'converge' };
    const p = Lo.p, cov = fit.F.betaCov(), beta = Array.from(fit.par.slice(0, p));
    const SN = Din.stateNames || A.STATES3.map(s => ({ N: 'negative', U: 'neutral', P: 'positive' })[s]);
    const names = cats.flatMap(c => D.names.map(nm0 => `${SN[c]} vs ${SN[ref]}: ${nm0}`));
    // each factor's covariance Λ Λᵀ: SDs and the correlation between the two logits' effects
    const re = Lam.map((L, k) => {
      const Sg = Array.from({ length: R }, (_, a) => Array.from({ length: R }, (__, b) => { let s = 0; for (let d = 0; d < R; d++) s += L[a * R + d] * L[b * R + d]; return s; }));
      const sd = Sg.map((r0, a) => Math.sqrt(r0[a]));
      return { name: D.groupNames[k], sd, corr: R > 1 ? (sd[0] > 0 && sd[1] > 0 ? Sg[1][0] / (sd[0] * sd[1]) : NaN) : null };
    });
    const out = finish({ ok: true, kind: 'mglmm', n, nLevels: D.nLevels, groupNames: D.groupNames, theta: nm.x, re, deviance: fit.dev, dropped, evals: nm.evals, D, px: Lo.px, R, ref, cats }, { names }, beta, cov, null);
    out.converged = out.coef.every(c => isFinite(c.se) && c.se < 50) && nm.evals < maxEval;
    return out;
  };

  /* Linear mixed model by REML (lme4's default), with Satterthwaite degrees
     of freedom for every test (as lmerTest): the variance parameters'
     covariance from the REML criterion's curvature, and the gradient of each
     contrast's variance, both by finite differences. */
  A.lmm = function (Din, start) {
    const n = Din.y.length;
    if (n < 20 || Din.nLevels.slice(0, 2).some(q => q < 2)) return { ok: false, reason: 'few' };
    const { D, dropped } = prepare(Din), Lo = layout(D), K = D.groups.length, p = Lo.p;
    const crit = th => { const f = pls(D, Lo, th.map(Math.abs)); return f.ok ? remlDev(n, p, f) : 1e300; };
    const maxEval = 250 * K, nm = nelderMead(crit, start && start.length === K ? start.slice() : new Array(K).fill(1), 0.5, maxEval);
    const theta = nm.x.map(Math.abs);
    const f = pls(D, Lo, theta);
    if (!f.ok) return { ok: false, reason: 'converge' };
    const sigma = Math.sqrt(f.r2 / (n - p));
    const covAt = (th, sg) => { const g = pls(D, Lo, th.map(Math.abs)); const c = betaBlock(g.L); return c.map(r => r.map(x => x * sg * sg)); };
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
    const keep = ['ok', 'kind', 'n', 'nLevels', 'groupNames', 'theta', 'sd', 'sigma', 'reml', 'deviance', 'dropped', 'evals', 'converged', 'names', 'beta', 'sat', 'carry', 'rMean', 'profCurve', 'mMean', 're', 'px', 'R', 'ref', 'cats', 'm3'];
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
      case 'C1Q': return A.lmm(A.modelDataC1Q(j.tr, o), j.start);
      case 'B': return A.lmm(A.modelDataB(j.ans, o));
      case 'C': return A.lmm(A.modelDataC(j.ans, o));
      case 'Ccat': return A.lmm(A.modelDataCcat(j.ans, o));
      case 'Miss': return A.glmm(A.modelDataMiss(j.ans));
      case 'PA': { const D = A.modelDataProfA(j.tr, new Map(j.prof)), f = A.glmm(D, D.data, j.start); if (f.ok) { f.rMean = D.rMean; f.profCurve = A.profCurve(f, j.grid); } return f; }
      case 'PV': { const D = A.modelDataProfV(j.ans, new Map(j.prof)), f = A.lmm(D, j.start); if (f.ok) f.rMean = D.rMean; return f; }
      case 'AS': { const D0 = A.modelData(j.tr), f = A.glmm(A.addSlopes(D0, slopesFor('A', D0)), j.tr, j.start); if (f.ok) f.carry = A.carryOver(f); return f; }
      case 'C1S': { const D0 = A.modelDataC1(j.tr); return A.lmm(A.addSlopes(D0, slopesFor('C1', D0)), j.start); }
      case 'CS': { const D0 = A.modelDataC(j.ans); return A.lmm(A.addSlopes(D0, slopesFor('C', D0)), j.start); }
      case 'BS': { const D0 = A.modelDataB(j.ans); return A.lmm(A.addSlopes(D0, slopesFor('B', D0)), j.start); }
      case 'T': return A.lmm(A.modelDataTiming(j.trows, j.measure));
      case 'M3': {   // three-state transitions; j.tr: transitions in three states; j.slopes: by-student language slopes
        const D0 = A.modelData3(j.tr, { chain: j.chain !== false, ref: j.ref });
        const f = A.mglmm(j.slopes ? A.addSlopes(D0, [['Student: language', lc]]) : D0, j.tr, j.start);
        if (f.ok) f.m3 = A.summary3(f);
        return f;
      }
      case 'BM': { const D = A.modelDataBmod(j.ans, new Map(j.mod)), f = A.lmm(D, j.start); if (f.ok) f.mMean = D.mMean; return f; }
      case 'L1S': { const D = A.modelDataL1Seed(j.ans, new Map(j.mod)), f = A.lmm(D, j.start); if (f.ok) f.mMean = D.mMean; return f; }
      case 'L1T': { const D = A.modelDataL1Traj(j.ans, new Map(j.mod)), f = A.lmm(D, j.start); if (f.ok) f.mMean = D.mMean; return f; }
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

  /* The three-state model on the probability scale: average marginal
     predictions, as carryOver(). Every observed transition is predicted with
     language and previous state set (random effects at zero) and the three
     destination probabilities averaged, so each row sums to 1 (checked).
     Delta-method CIs. Tests on the coefficients: the omnibus language test
     (the language terms of both logits, 6 df) and, after each previous state,
     the language difference in both logits (2 df: the three destination
     probabilities are the same in both languages for every combination of the
     covariates), Holm-adjusted across the three. */
  A.summary3 = function (fit) {
    if (!fit || !fit.ok) return null;
    const D = fit.D, px = fit.px, R = fit.R, ref = fit.ref, C = R + 1, cats = fit.cats, beta = fit.beta, cov = fit.cov, P = R * px;
    const S3 = A.STATES3, SN = { N: 'negative', U: 'neutral', P: 'positive' }, z95 = 1.959964;
    const rows = D.data.map(t => Object.assign({}, t)), n = rows.length, x = new Float64Array(px), eta = new Float64Array(R), mu = new Float64Array(C);
    const amp = (lang, prev) => {
      const m = new Float64Array(C), g = Array.from({ length: C }, () => new Float64Array(P));
      rows.forEach(t => {
        t.lang = lang; t.prev = prev;
        for (let j = 0; j < px; j++) x[j] = D.cols[j][1](t);
        let mx = 0;
        for (let c = 0; c < R; c++) { let s = 0; for (let j = 0; j < px; j++) s += x[j] * beta[c * px + j]; eta[c] = s; mx = Math.max(mx, s); }
        let den = Math.exp(-mx); for (let c = 0; c < R; c++) den += Math.exp(eta[c] - mx);
        mu[ref] = Math.exp(-mx) / den; cats.forEach((k, c) => { mu[k] = Math.exp(eta[c] - mx) / den; });
        for (let k = 0; k < C; k++) {
          m[k] += mu[k];
          cats.forEach((kc, c) => { const d = mu[k] * ((k === kc ? 1 : 0) - mu[kc]); for (let j = 0; j < px; j++) g[k][c * px + j] += d * x[j]; });
        }
      });
      return { est: Array.from(m, v => v / n), g: g.map(a => Array.from(a, v => v / n)) };
    };
    const sd = gr => { let v = 0; for (let a = 0; a < P; a++) { if (!gr[a]) continue; for (let b = 0; b < P; b++) v += gr[a] * gr[b] * cov[a][b]; } return Math.sqrt(v); };
    const M = { zh: {}, en: {} };
    ['zh', 'en'].forEach(l => S3.forEach(s => {
      M[l][s] = amp(l, s);
      const sum = M[l][s].est.reduce((a, b) => a + b, 0);
      if (!(Math.abs(sum - 1) < 1e-9)) throw new Error(`three-state probabilities after ${s} in ${l} sum to ${sum}`);
    }));
    const prob = { zh: {}, en: {} }, diff = {};
    ['zh', 'en'].forEach(l => S3.forEach(s => { prob[l][s] = {}; S3.forEach((k, ki) => { const e = M[l][s].est[ki], se = sd(M[l][s].g[ki]); prob[l][s][k] = { est: e, se, lo: e - z95 * se, hi: e + z95 * se }; }); }));
    S3.forEach(s => { diff[s] = {}; S3.forEach((k, ki) => {
      const g = M.en[s].g[ki].map((v, j) => v - M.zh[s].g[ki][j]), est = M.en[s].est[ki] - M.zh[s].est[ki], se = sd(g), z = est / se;
      diff[s][k] = { est, se, lo: est - z95 * se, hi: est + z95 * se, z, p: A.pNorm(z) };
    }); });
    const term = (c, t) => `${SN[S3[cats[c]]]} vs ${SN[S3[ref]]}: ${t}`;
    const omni = fit.wald(cats.flatMap((_, c) => A.LANG3.map(t => term(c, t))).filter(nm => fit.names.includes(nm)));
    const rowT = {};
    S3.forEach(s => { rowT[s] = fit.waldL(cats.map((_, c) => Object.fromEntries(A.ROW3[s].map(([t, w]) => [term(c, t), w])))); });
    const adj = A.holm(S3.map(s => rowT[s] ? rowT[s].p : NaN));
    S3.forEach((s, i) => { if (rowT[s]) rowT[s].padj = adj[i]; });
    const pick = o => o && { chi2: o.chi2, df: o.df, p: o.p, padj: o.padj };
    return { n, prob, diff, omni: pick(omni), rows: { N: pick(rowT.N), U: pick(rowT.U), P: pick(rowT.P) } };
  };
  // Holm adjusted p-values (same order as given).
  A.holm = ps => {
    const ix = ps.map((p, i) => [p, i]).filter(x => isFinite(x[0])).sort((a, b) => a[0] - b[0]), m = ix.length, out = ps.map(() => NaN);
    let run = 0;
    ix.forEach(([p, i], k) => { run = Math.max(run, Math.min(1, (m - k) * p)); out[i] = run; });
    return out;
  };

  /* The proficiency transition model on the probability scale: at each rating
     in grid, the English − Chinese difference in staying positive,
     P(next positive | previous positive), and in staying negative,
     P(next negative | previous negative), as average marginal predictions
     (every transition with language, previous state and rating set; random
     effects at zero), with delta-method 95% CIs. */
  A.profCurve = function (fit, grid) {
    const D = fit.D, p = fit.beta.length, logistic = x => 1 / (1 + Math.exp(-x));
    const rows = D.data.map(t => Object.assign({}, t)), x = new Float64Array(p);
    const amp = (lang, prev, rating) => {
      let m = 0; const g = new Float64Array(p);
      rows.forEach(t => {
        t.lang = lang; t.prev = prev; t.rating = rating;
        for (let j = 0; j < p; j++) x[j] = D.cols[j][1](t);
        let e = 0; for (let j = 0; j < p; j++) e += x[j] * fit.beta[j];
        const q = logistic(e); m += q;
        for (let j = 0; j < p; j++) g[j] += q * (1 - q) * x[j];
      });
      return { est: m / rows.length, g: g.map(v => v / rows.length) };
    };
    const diff = (a, b, sign) => {
      const g = a.g.map((v, j) => sign * (v - b.g[j])); let v = 0;
      for (let i = 0; i < p; i++) for (let k = 0; k < p; k++) v += g[i] * g[k] * fit.cov[i][k];
      const est = sign * (a.est - b.est), se = Math.sqrt(v);
      return { est, lo: est - 1.959964 * se, hi: est + 1.959964 * se };
    };
    const out = { PP: [], NN: [] };
    grid.forEach(x => {
      out.PP.push(Object.assign({ x }, diff(amp('en', 'P', x), amp('zh', 'P', x), 1)));
      out.NN.push(Object.assign({ x }, diff(amp('en', 'N', x), amp('zh', 'N', x), -1)));   // staying negative = 1 − P(next positive)
    });
    return out;
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

  /* ---------- lexical reuse (exploratory) ----------
     Exact-response reuse within a student's own chains, in one language.
     Three response keys, for sensitivity:
       raw   the answer as typed, trimmed;
       norm  NFKC; Latin letters lower-cased; curly quotes, dashes and the
             like made plain; quotation marks and leading/trailing
             punctuation or symbols removed; internal whitespace collapsed
             (Chinese: all whitespace, punctuation and symbols removed, as
             they are not part of a single typed word). Nothing is
             translated, stemmed, lemmatised or split;
       lemma the key the site uses for repetitions (the English lemma when
             the norms know the word, else the normalised form).
     Empty answers are not responses: they count in no numerator or
     denominator. */
  A.lexNorm = (raw, lang) => {
    let s = String(raw === null || raw === undefined ? '' : raw).normalize('NFKC');
    s = s.replace(/[‘’‚‛ʼ`´]/g, "'").replace(/[“”„‟«»]/g, '"').replace(/[‐‑‒–—―−]/g, '-');
    if (lang === 'zh') return s.replace(/[\s\p{P}\p{S}]/gu, '');
    s = s.toLowerCase().replace(/"/g, '').replace(/\s+/g, ' ').trim();
    return s.replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '');
  };
  A.lexKey = mode => mode === 'raw' ? (t => String(t === null || t === undefined ? '' : t).trim())
    : mode === 'lemma' ? null : (t, lang) => A.lexNorm(t, lang);
  /* For one student and language (chains: [{seed, answers: [text]}], with the
     answers already keyed): within-chain repetition, response diversity and
     cross-chain reuse.
       within  share of answers equal to the chain's starting word or to an
               earlier answer in the same chain;
       unique  distinct response types / answers (1 − unique is the share of
               answers that repeat a response given anywhere before);
       cross   each chain reduced to its distinct types; a type found in k
               chains adds k − 1; the sum over types / the number of
               chain-distinct types (0: no type recurs across chains);
       multi   share of the distinct types found in more than one chain. */
  A.lexicalMetrics = function (chains) {
    let n = 0, within = 0, chainTypes = 0;
    const inChains = new Map();
    chains.forEach(c => {
      const seen = new Set(c.seed ? [c.seed] : []), set = new Set();
      c.answers.forEach(a => {
        if (!a) return;
        n++;
        if (seen.has(a)) within++;
        seen.add(a); set.add(a);
      });
      chainTypes += set.size;
      set.forEach(t => inChains.set(t, (inChains.get(t) || 0) + 1));
    });
    let excess = 0, multi = 0;
    inChains.forEach(k => { excess += k - 1; if (k > 1) multi++; });
    const U = inChains.size;
    return { n, types: U, unique: n ? U / n : NaN, within: n ? within / n : NaN, cross: chainTypes ? excess / chainTypes : NaN, multi: U ? multi / U : NaN, excess, chainTypes };
  };
  // Per student: the metrics in each language, under one response key.
  A.lexicalByStudent = function (parts, mode) {
    const kf = A.lexKey(mode || 'norm');
    return parts.map(P => {
      const out = { key: P.key };
      ['zh', 'en'].forEach(lang => {
        const chains = P.chains.filter(c => c.lang === lang).map(c => kf
          ? { seed: kf(lang === 'zh' ? c.word : c.word, lang), answers: c.answers.map(a => kf(a.text, lang)) }
          : { seed: c.seedNorm, answers: c.answers.map(a => a.norm || '') });
        out[lang] = chains.length ? A.lexicalMetrics(chains) : null;
      });
      return out;
    });
  };

  /* ---------- response timing ----------
     Only each student's median times per language are stored with the
     summaries (rt_median_*: answer shown → answer submitted; onset_median_*:
     answer shown → first keystroke), in ms. Two rows per student: language,
     and block (first or second language done, from the order field). */
  A.timingRows = rows => rows.flatMap(r => {
    const ord = String(r.order || '').split('-');
    if (ord.length !== 2 || !ord.includes('zh') || !ord.includes('en')) return [];
    return ['zh', 'en'].map(lang => ({
      pid: r.pid + '|' + r.session, lang, block: ord.indexOf(lang) + 1, order: r.order,
      total: Number(r[`rt_median_${lang}`]) / 1000, onset: r[`onset_median_${lang}`] === '' || r[`onset_median_${lang}`] === null || r[`onset_median_${lang}`] === undefined ? NaN : Number(r[`onset_median_${lang}`]) / 1000
    }));
  });
  /* log seconds ~ language × block + (1 | student). Language: English +½;
     block: second +½. With two rows per student, the language × block term
     is a between-student comparison: the two order groups differ by half of
     it in mean log time. */
  A.modelDataTiming = function (trows, measure) {
    const ok = trows.filter(t => t[measure] > 0);
    const both = new Set(), seen = new Map();
    ok.forEach(t => seen.set(t.pid, (seen.get(t.pid) || 0) + 1));
    seen.forEach((k, pid) => { if (k === 2) both.add(pid); });
    const d = ok.filter(t => both.has(t.pid));
    const L = t => t.lang === 'en' ? 0.5 : -0.5, B = t => t.block === 2 ? 0.5 : -0.5;
    return A.design(d, [['(Intercept)', () => 1], [LANG, L], ['Block (second − first)', B], ['Language × block', t => L(t) * B(t)]],
      t => Math.log(t[measure]), [['Student', t => t.pid]]);
  };

  /* Timing outliers (sensitivity only), on the timing models' own data: each
     student's log median time, per language and measure. Robust z (Iglewicz
     & Hoaglin's modified z) = 0.6745 (x − median) / MAD, MAD the median
     absolute deviation (unscaled); |z| > 3.5 flags. Where MAD is 0, the outer
     fences instead: below Q1 − 3·IQR or above Q3 + 3·IQR (quartiles by linear
     interpolation, R's type 7). A student is flagged for a measure if either
     language is. Fixed in advance; nothing here is tuned to the data. */
  const median = a => { const s = Float64Array.from(a).sort(), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
  const quantile7 = (a, q) => { const s = Float64Array.from(a).sort(), h = (s.length - 1) * q, i = Math.floor(h); return i + 1 < s.length ? s[i] + (h - i) * (s[i + 1] - s[i]) : s[i]; };
  A.robustFlags = function (xs) {
    const med = median(xs), mad = median(xs.map(x => Math.abs(x - med)));
    if (mad > 0) {
      const z = xs.map(x => 0.6745 * (x - med) / mad);
      return { method: 'mad', med, mad, z, flag: z.map(v => Math.abs(v) > 3.5) };
    }
    const q1 = quantile7(xs, 0.25), q3 = quantile7(xs, 0.75), lo = q1 - 3 * (q3 - q1), hi = q3 + 3 * (q3 - q1);
    return { method: 'fence', med, mad, lo, hi, z: xs.map(() => NaN), flag: xs.map(x => x < lo || x > hi) };
  };
  A.timingOutliers = function (trows) {
    const out = {};
    ['onset', 'total'].forEach(measure => {
      const d = A.modelDataTiming(trows, measure).data, flagged = new Set(), flagRows = new Set(), byLang = {};
      ['zh', 'en'].forEach(lang => {
        const rows = d.filter(t => t.lang === lang), r = A.robustFlags(rows.map(t => Math.log(t[measure])));
        rows.forEach((t, i) => { if (r.flag[i]) { flagged.add(t.pid); flagRows.add(t.pid + '|' + lang); } });
        const slow = rows.filter((t, i) => r.flag[i] && Math.log(t[measure]) > r.med).length;
        byLang[lang] = { n: rows.length, method: r.method, flagged: r.flag.filter(Boolean).length, slow };
      });
      out[measure] = { n: new Set(d.map(t => t.pid)).size, flagged, flagRows, byLang };
    });
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
