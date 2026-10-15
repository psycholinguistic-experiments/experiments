/* LT5461 — reading task (causal connectives, after Millis & Just, 1994):
   the parts shared by the task page and the results page.
   Stimuli live in assets/data/causal-items.csv (edit there; the code only
   reads it): item_id, type (practice / critical / filler), clause1, clause2,
   probe, present, question, correct_answer.
   Design (as the class's original HTML): 2 practice, 20 critical, 8 fillers.
   List A: odd-numbered critical items with "because", even ones without;
   list B the reverse — 10 + 10 per student, each item in both conditions
   across students. Fillers and practice items never have "because".
   Exposes window.READING (also a CommonJS module for Node checks). */
(function (root) {
  'use strict';

  // Comprehension questions follow every practice trial, and these items (as in the original experiment).
  const ASK = new Set(['C02', 'C04', 'C07', 'C09', 'C12', 'C14', 'C17', 'C19', 'F03', 'F07']);
  const truthy = v => /^(true|1|yes)$/i.test(String(v).trim());

  // Minimal CSV parser: quoted fields, doubled quotes, commas and newlines inside quotes.
  function parseCSV(text) {
    const rows = []; let row = [], f = '', q = false;
    text = String(text).replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    const head = (rows.shift() || []).map(h => h.trim());
    return { head, rows: rows.filter(r => r.some(x => x.trim() !== '')).map(r => Object.fromEntries(head.map((h, j) => [h, r[j] === undefined ? '' : r[j]]))) };
  }

  function itemsFrom(text) {
    const { head, rows } = parseCSV(text);
    const need = ['item_id', 'type', 'clause1', 'clause2', 'probe', 'present', 'question', 'correct_answer'];
    const missing = need.filter(k => !head.includes(k));
    if (missing.length) throw new Error('causal-items.csv: missing column(s) ' + missing.join(', '));
    return rows.map(r => ({
      id: r.item_id.trim(), type: r.type.trim(), a: r.clause1.trim(), b: r.clause2.trim(), probe: r.probe.trim(),
      present: truthy(r.present), q: r.question.trim(), answer: truthy(r.correct_answer), n: Number(r.item_id.trim().slice(1)),
      ask: r.type.trim() === 'practice' || ASK.has(r.item_id.trim())
    }));
  }
  let cache = null;
  function loadItems(url) {
    if (!cache) cache = fetch(url || 'assets/data/causal-items.csv?v=1').then(r => { if (!r.ok) throw new Error('items ' + r.status); return r.text(); }).then(itemsFrom);
    return cache;
  }

  // "because" for a critical item in a list.
  const connectiveFor = (item, list) => item.type === 'critical' && (item.n % 2 === 1) === (list === 'A') ? 1 : 0;

  /* The words as shown. With "because": clause 1 ends in "because", clause 2
     starts lower case. Without: clause 1 ends with a full stop, clause 2 starts
     with a capital. */
  function words(item, connective) {
    const a = item.a.split(/\s+/), b = item.b.split(/\s+/);
    if (connective) a.push('because');
    else { a[a.length - 1] += '.'; b[0] = b[0].charAt(0).toUpperCase() + b[0].slice(1); }
    return [a, b];
  }
  // Second-clause regions, as in the original: its first three words and its last three.
  const regions = n => ({ early: [0, 1, 2].filter(i => i < n), final: [n - 3, n - 2, n - 1].filter(i => i >= 0) });

  /* The trial order: practice first; then four blocks, each five critical items
     and two fillers, shuffled within the block (so fillers spread through the
     session and no long run of one condition builds up). rand: () => [0, 1). */
  function sequence(items, list, rand) {
    const r = rand || Math.random;
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const prac = items.filter(x => x.type === 'practice').map(x => Object.assign({}, x, { connective: 0 }));
    const crit = shuffle(items.filter(x => x.type === 'critical').map(x => Object.assign({}, x, { connective: connectiveFor(x, list) })));
    const fill = shuffle(items.filter(x => x.type === 'filler').map(x => Object.assign({}, x, { connective: 0 })));
    const blocks = 4, cPer = Math.ceil(crit.length / blocks), fPer = Math.ceil(fill.length / blocks), out = prac.slice();
    for (let k = 0; k < blocks; k++) out.push(...shuffle(crit.slice(k * cPer, (k + 1) * cPer).concat(fill.slice(k * fPer, (k + 1) * fPer))));
    return out;
  }

  // Word reading times are stored in base 36 to fit the store's 200-character fields.
  const enc36 = a => a.map(v => (isFinite(v) && v >= 0 ? Math.round(v).toString(36) : '')).join(',');
  const dec36 = s => (s ? String(s).split(',').map(x => (x === '' ? NaN : parseInt(x, 36))) : []);

  const api = { ASK, parseCSV, itemsFrom, loadItems, connectiveFor, words, regions, sequence, enc36, dec36, truthy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.READING = api;
})(typeof window !== 'undefined' ? window : this);
