"""Choose the association-task seeds: 10 Chinese words and 10 English words.

    python3 materials/fast/select_seeds.py

Every student gets the same 20 seeds: the Chinese set in the Chinese block and
the English set in the English block. The two sets are different words (not
translations of each other) and share no concept, so no student meets the
same idea in both languages. Each set has 4 negative, 4 positive and 2 neutral
seeds.

Inputs (all published with the site):
    materials/fast/candidates.csv   candidate concepts, each with an English and a
                                    (simplified) Chinese word; a concept is used
                                    in one language at most
    assets/data/norms-en.csv        Warriner, Brysbaert, SUBTLEX-US
    assets/data/norms-zh.csv        Chan & Tse (2024), SUBTLEX-CH; valence, arousal
                                    and concreteness also on the English scales

Outputs:
    assets/fast-stimuli.js          the two sets the task presents
    materials/fast/selection.md     every candidate's values, why it passed or
                                    failed, and how well the sets are matched

A word is eligible in its language if it meets CRITERIA there: the valence
range of its category (Chinese values on the English scale, so the ranges mean
the same in both languages) and a place among the most frequent words of the
language (the students' English is limited). The choice minimises, per
category, the difference between the Chinese and the English set on valence,
arousal, concreteness and frequency, and, within each language, the
difference between positive and negative seeds (arousal above all); it
prefers emotion-laden concepts over emotion labels, nouns, and the most
frequent words. The search is seeded, so the result is reproducible.
"""
import datetime
import hashlib
import json
import math
import os
import random

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')

CRITERIA = {
    # Normative valence on the English 1–9 scale (Chinese values equated to it).
    'valence': {'negative': (1.5, 3.2), 'positive': (6.8, 8.5), 'neutral': (4.5, 5.5)},
    'top': 2000,                   # frequency rank in SUBTLEX-US or SUBTLEX-CH
    'letters': (4, 12),            # English word length
    'characters': 2,               # Chinese word length (every Chan & Tse word)
}
N_PER_SET = {'negative': 4, 'positive': 4, 'neutral': 2}
# Preferences, as a cost per seed (a squared SMD of imbalance costs 1).
PENALTY = {'emotion_label': 0.75, 'not_noun': 0.5, 'per_zipf_below_5': 0.5}
MATCH = ['valence', 'arousal', 'concreteness', 'zipf']          # Chinese set vs English set
MATCH_WEIGHT = {'valence': 2.0, 'arousal': 2.0}
POSNEG = ['arousal', 'concreteness', 'zipf']                      # positive vs negative, per language
POSNEG_WEIGHT = {'arousal': 3.0}
PRACTICE = {'en': 'street', 'zh': '街道'}   # neutral in both norms
SEED = 5461
CATS = ['negative', 'positive', 'neutral']
LANGS = ['zh', 'en']
LABEL = {'valence': 'Valence (1–9)', 'arousal': 'Arousal (1–9)', 'concreteness': 'Concreteness (1–5)', 'zipf': 'Frequency (Zipf)'}


def load():
    en = pd.read_csv(os.path.join(ROOT, 'assets/data/norms-en.csv'), keep_default_na=False, na_values=['']).set_index('word')
    zh = pd.read_csv(os.path.join(ROOT, 'assets/data/norms-zh.csv'), keep_default_na=False, na_values=[''])
    # Written in simplified characters; where two traditional words share one
    # simplified form, the more frequent one is meant.
    zh = zh.sort_values('zipf', ascending=False).drop_duplicates('simp').set_index('simp')
    cands = pd.read_csv(os.path.join(HERE, 'candidates.csv'), keep_default_na=False, dtype=str)
    return en, zh, cands


def words(cands, en, zh):
    """One row per candidate word (a concept in one language), with its values
    on the common scales and the reasons it fails, if any."""
    out = []
    for _, c in cands.iterrows():
        for lang in LANGS:
            key = c['english'] if lang == 'en' else c['chinese']
            table = en if lang == 'en' else zh
            r = {'id': f"{c['id']}_{lang}", 'concept': c['id'], 'lang': lang, 'word': key, 'category': c['category'],
                 'family': c['family'], 'pos': c['pos'], 'emotion_label': c['emotion_label'], 'exclude': c['exclude'], 'note': c['note']}
            why = [c['note'] or 'left out'] if c['exclude'] else []
            if key not in table.index:
                why.append('not in the norms')
            else:
                n = table.loc[key]
                if lang == 'en':
                    r.update(valence=n['valence'], arousal=n['arousal'], concreteness=n['concreteness'], zipf=n['zipf'], rank=n['rank'], letters=len(key))
                else:
                    r.update(valence=n['valence_en'], arousal=n['arousal_en'], concreteness=n['concreteness_en'], zipf=n['zipf'], rank=n['rank'],
                             valence_raw=n['valence'], arousal_raw=n['arousal'], trad=n['trad'])
                lo, hi = CRITERIA['valence'][c['category']]
                if not lo <= r['valence'] <= hi:
                    why.append(f"valence {r['valence']:.2f}")
                if pd.isna(r['rank']) or r['rank'] > CRITERIA['top']:
                    why.append(f"frequency rank {int(r['rank']):,}" if pd.notna(r['rank']) else 'not in SUBTLEX')
                if pd.isna(r['concreteness']):
                    why.append('concreteness not rated')
                if lang == 'en' and not CRITERIA['letters'][0] <= len(key) <= CRITERIA['letters'][1]:
                    why.append(f'length {len(key)} letters')
                if lang == 'zh' and len(key) != CRITERIA['characters']:
                    why.append(f'length {len(key)} characters')
            r['fails'] = '; '.join(why)
            out.append(r)
    return pd.DataFrame(out)


class Scorer:
    def __init__(self, pool):
        self.sd = {v: pool[v].std() or 1.0 for v in MATCH}
        self.val = {r['id']: {v: r[v] for v in MATCH} for _, r in pool.iterrows()}
        self.pen = {r['id']: PENALTY['emotion_label'] * (r['emotion_label'] == '1') + PENALTY['not_noun'] * (r['pos'] != 'noun')
                    + PENALTY['per_zipf_below_5'] * max(0, 5 - r['zipf']) for _, r in pool.iterrows()}

    def mean(self, ids, v):
        return sum(self.val[i][v] for i in ids) / len(ids)

    def terms(self, sel):
        """sel: {cat: {'zh': [ids], 'en': [ids]}}"""
        t = {'languages': 0.0, 'pos_neg': 0.0, 'symmetry': 0.0, 'preferences': 0.0}
        for cat in CATS:
            for v in MATCH:
                d = (self.mean(sel[cat]['zh'], v) - self.mean(sel[cat]['en'], v)) / self.sd[v]
                t['languages'] += MATCH_WEIGHT.get(v, 1.0) * d * d
        for L in LANGS:
            P, N = sel['positive'][L], sel['negative'][L]
            for v in POSNEG:
                d = (self.mean(P, v) - self.mean(N, v)) / self.sd[v]
                t['pos_neg'] += POSNEG_WEIGHT.get(v, 1.0) * d * d
            # positive seeds as far above 5 as negative seeds are below it
            d = ((self.mean(P, 'valence') - 5) - (5 - self.mean(N, 'valence'))) / self.sd['valence']
            t['symmetry'] += 0.5 * d * d
        t['preferences'] = sum(self.pen[i] for cat in CATS for L in LANGS for i in sel[cat][L])
        return t

    def cost(self, sel):
        return sum(self.terms(sel).values())


def search(pool, scorer, rng, restarts=80, iters=4000):
    fam = dict(zip(pool['id'], pool['family']))
    options = {(c, L): list(pool[(pool.category == c) & (pool.lang == L)]['id']) for c in CATS for L in LANGS}

    def used(sel, drop=None):
        return {fam[i] for c in CATS for L in LANGS for i in sel[c][L] if i != drop}

    def random_sel():
        for _ in range(1000):
            sel = {c: {'zh': [], 'en': []} for c in CATS}
            ok = True
            for c in CATS:
                for L in rng.sample(LANGS, 2):
                    avail = [i for i in options[(c, L)] if fam[i] not in used(sel)]
                    rng.shuffle(avail)
                    for i in avail:
                        if len(sel[c][L]) == N_PER_SET[c]:
                            break
                        if fam[i] not in used(sel):
                            sel[c][L].append(i)
                    ok = ok and len(sel[c][L]) == N_PER_SET[c]
            if ok:
                return sel
        raise SystemExit('Not enough eligible words: relax the criteria or add candidates.')

    def neighbour(sel):
        new = {c: {L: sel[c][L][:] for L in LANGS} for c in CATS}
        c, L = rng.choice(CATS), rng.choice(LANGS)
        k = rng.randrange(N_PER_SET[c])
        out = new[c][L][k]
        taken = used(new, drop=out)
        alts = [i for i in options[(c, L)] if fam[i] not in taken and i != out]
        if alts:
            new[c][L][k] = rng.choice(alts)
        return new

    best, best_cost = None, math.inf
    for _ in range(restarts):
        cur = random_sel()
        cur_cost = scorer.cost(cur)
        temp = 1.0
        for _ in range(iters):
            cand = neighbour(cur)
            cc = scorer.cost(cand)
            if cc < cur_cost or rng.random() < math.exp((cur_cost - cc) / max(temp, 1e-6)):
                cur, cur_cost = cand, cc
                if cc < best_cost:
                    best, best_cost = {c: {L: cur[c][L][:] for L in LANGS} for c in CATS}, cc
            temp *= 0.998
    return best, best_cost


def fmt(v, k=''):
    if pd.isna(v):
        return '–'
    return f'{int(v):,}' if k in ('rank', 'letters') else f'{v:.2f}'


def report(allw, pool, sel, scorer, path):
    L_ = []
    w = L_.append
    P = pool.set_index('id')
    chosen = {i: L for c in CATS for L in LANGS for i in sel[c][L]}
    name = {'zh': 'Chinese', 'en': 'English'}
    w('# Association task: seed selection\n')
    w(f'Generated by `select_seeds.py` on {datetime.date.today().isoformat()}. Do not edit by hand; change `candidates.csv` or the criteria and run the script again.\n')
    w('Every student gets the same 20 seeds: 10 Chinese words in the Chinese block and 10 English words in the English block. '
      'The two sets are different words, not translations, and share no concept.\n')
    w('## Criteria\n')
    w('Chinese valence, arousal and concreteness are used on the English scales (equated over the whole norm sets by `build_norms.py`; see `assets/data/equating.json`), '
      'so the criteria and the comparisons below mean the same in both languages.\n')
    w('| | Negative | Positive | Neutral |\n|---|---|---|---|')
    w('| Valence (1–9) | ' + ' | '.join(f'{a}–{b}' for a, b in (CRITERIA['valence'][c] for c in CATS)) + ' |\n')
    w(f"- **Very high frequency:** among the {CRITERIA['top']:,} most frequent words of its language (SUBTLEX-US, SUBTLEX-CH), preferring the most frequent.")
    w(f"- **Length:** English {CRITERIA['letters'][0]}–{CRITERIA['letters'][1]} letters; Chinese {CRITERIA['characters']} characters.")
    w('- **Different concepts:** no concept (or close relative, e.g. fear and afraid) appears in both sets.')
    w('- **Matched across languages:** the Chinese and English sets have the same mean valence, arousal, concreteness and frequency in each category (valence and arousal weigh double).')
    w('- **Positive vs negative:** matched within each language on arousal (weighs triple), concreteness and frequency.')
    w('- **Left out:** words that may distress students in class.')
    w('- **Preferred:** emotion-laden concepts over emotion labels, and nouns.\n')
    w('## The two sets\n')
    w('| Category | Chinese | V / A | rank | English | V / A | rank |\n|---|---|---|---|---|---|---|')
    for c in CATS:
        for k in range(N_PER_SET[c]):
            z, e = P.loc[sel[c]['zh'][k]], P.loc[sel[c]['en'][k]]
            w(f"| {c} | {z['word']} | {z['valence']:.2f} / {z['arousal']:.2f} | {fmt(z['rank'], 'rank')} | {e['word']} | {e['valence']:.2f} / {e['arousal']:.2f} | {fmt(e['rank'], 'rank')} |")
    w('\nV = valence, A = arousal (Chinese on the English scale). Rank 1 = the most frequent word of the language.\n')
    w('## Chinese set vs English set\n')
    w('| Category | ' + ' | '.join(LABEL[v] for v in MATCH) + ' |\n|---|' + '---|' * len(MATCH))
    for c in CATS:
        cells = []
        for v in MATCH:
            z, e = P.loc[sel[c]['zh'], v].mean(), P.loc[sel[c]['en'], v].mean()
            cells.append(f'{z:.2f} / {e:.2f} ({(z - e) / scorer.sd[v]:+.2f})')
        w(f'| {c} | ' + ' | '.join(cells) + ' |')
    w('\nChinese / English means (SMD, Chinese − English, over the SD of all eligible words).\n')
    w('## Positive vs negative seeds\n')
    w('| Language | ' + ' | '.join(LABEL[v] for v in MATCH) + ' |\n|---|' + '---|' * len(MATCH))
    for L in LANGS:
        cells = []
        for v in MATCH:
            p, n = P.loc[sel['positive'][L], v].mean(), P.loc[sel['negative'][L], v].mean()
            cells.append(f'{p:.2f} / {n:.2f} ({(p - n) / scorer.sd[v]:+.2f})')
        w(f'| {name[L]} | ' + ' | '.join(cells) + ' |')
    w('\nPositive / negative means (SMD). Valence should differ; nothing else should.\n')
    w('## Every candidate word\n')
    w('| Word | Language | Category | Family | V / A / C / rank | Result |\n|---|---|---|---|---|---|')
    for _, r in allw.iterrows():
        vals = ' / '.join(fmt(r.get(k), k) for k in ['valence', 'arousal', 'concreteness', 'rank'])
        res = f"**{name[chosen[r['id']]]} set**" if r['id'] in chosen else ('eligible' if not r['fails'] else r['fails'])
        w(f"| {r['word']} | {name[r['lang']]} | {r['category']} | {r['family']} | {vals} | {res} |")
    w('\nV = valence, A = arousal, C = concreteness; Chinese values on the English scales.\n')
    open(path, 'w', encoding='utf-8').write('\n'.join(L_))


def write_js(pool, sel, zh, path):
    P = pool.set_index('id')
    def item(i):
        r = P.loc[i]
        d = {'id': r['concept'], 'category': r['category'], 'word': r['word']}
        if r['lang'] == 'zh':
            d['trad'] = r['trad']
        return d
    sets = {L: [item(i) for c in CATS for i in sel[c][L]] for L in LANGS}
    # The version names the sets themselves: any change of seeds gives a new
    # version, and the results page keeps runs of different sets apart.
    digest = hashlib.sha1(json.dumps(sets, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:8]
    stim = {
        'version': 'seeds-' + digest,   # text, never a date or number Sheets would convert
        'responsesPerSeed': 10,
        'sets': sets,
        'practice': {'en': PRACTICE['en'], 'zh': {'word': PRACTICE['zh'], 'trad': zh.loc[PRACTICE['zh'], 'trad']}},
    }
    js = ('/* Association task (FAST) seeds: one set per language, the same for every\n'
          '   student. Generated by materials/fast/select_seeds.py; do not edit by hand.\n'
          '   Criteria and matching: materials/fast/selection.md */\n'
          'window.FAST_STIMULI = ' + json.dumps(stim, ensure_ascii=False, indent=2) + ';\n')
    open(path, 'w', encoding='utf-8').write(js)


def main():
    en, zh, cands = load()
    allw = words(cands, en, zh)
    pool = allw[allw['fails'] == ''].copy()
    print(f'{len(pool)} eligible words:', ', '.join(f"{c} {L} {sum((pool.category == c) & (pool.lang == L))}" for c in CATS for L in LANGS))
    scorer = Scorer(pool)
    sel, cost = search(pool, scorer, random.Random(SEED))
    print('cost', round(cost, 3), {k: round(v, 3) for k, v in scorer.terms(sel).items()})
    P = pool.set_index('id')
    for c in CATS:
        for L in LANGS:
            print(c, L, [P.loc[i, 'word'] for i in sel[c][L]])
    report(allw, pool, sel, scorer, os.path.join(HERE, 'selection.md'))
    write_js(pool, sel, zh, os.path.join(ROOT, 'assets/fast-stimuli.js'))


if __name__ == '__main__':
    main()
