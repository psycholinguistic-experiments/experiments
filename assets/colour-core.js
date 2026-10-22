/* LT5461 — colour task ("Do colour names shape perception?"): the parts
   shared by the task page and the results page.

   Stimuli: 14 fixed colours, OKLCH L = 0.70, C = 0.10, hue 160°–264° in 8°
   steps (green → turquoise → blue), all inside sRGB; made and checked by
   materials/colour/make_stimuli.py (CIEDE2000 between neighbours 2.8–3.8).
   Discrimination: the same 60 comparisons for every student — every pair two
   steps apart (C01–C03 … C12–C14: 12 pairs, used 3, 2, 3, 2 … times = 30
   trials) and three steps apart (C01–C04 … C11–C14: 11 pairs, used 3, 3, 2 …
   = 30), the reference alternating between the pair's two colours. Only the
   order and the side of the match vary between students. Practice: 8
   comparisons four steps apart, with feedback.
   Naming: each colour twice, in two independently shuffled passes (no colour
   twice in a row). Labels are normalised (青/青色 → 青; 蓝/藍/蓝色/藍色 → 蓝;
   绿/綠/绿色/綠色 → 绿; other words kept as typed, without a final 色), and a
   colour has a stable label only when both namings agree.
   Exposes window.COLOUR_CORE (and a CommonJS module for Node checks). */
(function (root) {
  'use strict';
  const STIM = [
    ['C01', 160, '#62b289'], ['C02', 168, '#58b292'], ['C03', 176, '#4fb39c'], ['C04', 184, '#47b3a5'],
    ['C05', 192, '#42b2ae'], ['C06', 200, '#40b1b7'], ['C07', 208, '#42b0bf'], ['C08', 216, '#47aec6'],
    ['C09', 224, '#4eaccc'], ['C10', 232, '#57a9d2'], ['C11', 240, '#60a7d6'], ['C12', 248, '#6aa4da'],
    ['C13', 256, '#75a1dc'], ['C14', 264, '#7f9edd']
  ].map(([id, h, hex], i) => ({ id, i, hue: h, hex, oklch: `oklch(0.70 0.10 ${h})` }));
  // CIEDE2000 between the pairs used (from the 8-bit hex values; make_stimuli.py)
  const DE = {"C01-C03": 6.4, "C01-C04": 9.67, "C01-C05": 13.36, "C02-C04": 6.56, "C02-C05": 10.27, "C02-C06": 14.14, "C03-C05": 7.04, "C03-C06": 10.9, "C03-C07": 14.41, "C04-C06": 7.6, "C04-C07": 11.1, "C04-C08": 14.56, "C05-C07": 7.34, "C05-C08": 10.82, "C05-C09": 13.85, "C06-C08": 7.02, "C06-C09": 10.14, "C06-C10": 13.59, "C07-C09": 6.75, "C07-C10": 10.36, "C07-C11": 12.94, "C08-C10": 6.96, "C08-C11": 9.68, "C08-C12": 12.86, "C09-C11": 6.57, "C09-C12": 9.84, "C09-C13": 12.8, "C10-C12": 6.16, "C10-C13": 9.25, "C10-C14": 12.08, "C11-C13": 6.49, "C11-C14": 9.42, "C12-C14": 6.28};

  /* The 60 main comparisons, fixed. reps: how many times each pair is shown. */
  const MAIN = (() => {
    const out = [];
    const add = (steps, reps) => {
      for (let a = 0; a + steps < STIM.length; a++) {
        const n = reps[a], b = a + steps;
        for (let r = 0; r < n; r++) {
          // the reference alternates between the pair's colours; where the pair starts is set so that the lower
          // colour is the reference in exactly half of each separation's trials (15 of 30)
          const firstLower = steps === 2 ? (a % 4 === 0 || a % 2 === 1) : a % 2 === 0;
          const lower = (r % 2 === 0) === firstLower, ref = lower ? a : b, dist = lower ? b : a;
          out.push({ steps, pair: `${STIM[a].id}-${STIM[b].id}`, ref, dist, de: DE[`${STIM[a].id}-${STIM[b].id}`] });
        }
      }
    };
    add(2, [3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2]);         // 30
    add(3, [3, 3, 2, 3, 3, 2, 3, 3, 2, 3, 3]);            // 30
    return out.map((t, k) => Object.assign({ tid: 'M' + String(k + 1).padStart(2, '0') }, t));
  })();
  const PRACTICE = [[0, 4], [5, 1], [2, 6], [7, 3], [4, 8], [9, 5], [6, 10], [13, 9]]
    .map(([ref, dist], k) => { const pair = [STIM[Math.min(ref, dist)].id, STIM[Math.max(ref, dist)].id].join('-'); return { tid: 'P' + (k + 1), steps: 4, pair, ref, dist, de: DE[pair] }; });

  const shuffle = (a, r) => { r = r || Math.random; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // Naming order: two shuffled passes; the second never starts with the colour that ended the first.
  function namingOrder(r) {
    const p1 = shuffle(STIM.map(s => s.i), r);
    let p2; do { p2 = shuffle(STIM.map(s => s.i), r); } while (p2[0] === p1[p1.length - 1]);
    return p1.map(i => ({ i, pass: 1 })).concat(p2.map(i => ({ i, pass: 2 })));
  }
  // A trial list with the match on the left in exactly half the trials (an extra one goes either way).
  function withSides(trials, r) {
    const sides = trials.map((_, k) => (k % 2 ? 'R' : 'L'));
    shuffle(sides, r);
    return shuffle(trials.map((t, k) => Object.assign({}, t, { match: sides[k] })), r);
  }

  /* Labels. */
  const TRAD = { 藍: '蓝', 綠: '绿', 紅: '红', 黃: '黄', 紫: '紫', 灰: '灰', 淺: '浅', 深: '深', 湖: '湖', 碧: '碧', 翠: '翠' };
  function normalise(raw) {
    let s = String(raw || '').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
    s = s.replace(/[藍綠紅黃淺]/g, c => TRAD[c] || c);
    s = s.replace(/(的|颜色|顏色)$/u, '');
    if (s.length > 1) s = s.replace(/色$/u, '');
    return s;
  }
  const BASIC = new Set(['青', '蓝', '绿']);
  const group = norm => (!norm ? 'none' : BASIC.has(norm) ? norm : 'other');

  const api = { STIM, DE, MAIN, PRACTICE, namingOrder, withSides, shuffle, normalise, group, BASIC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.COLOUR_CORE = api;
})(typeof window !== 'undefined' ? window : this);
