"""Build the two norm tables the association task uses, from the original files.

    python3 materials/fast/build_norms.py

Reads the original datasets from materials/fast/sources/ (not published; see
SOURCES.md for where each one comes from) and writes

    assets/data/norms-en.csv   one row per Warriner et al. (2013) lemma
    assets/data/norms-zh.csv   one row per Chan & Tse (2024) word
    assets/data/equating.json  how Chinese valence, arousal and concreteness are
                               put on the English scales (see equate() below)
    assets/data/lemmas-en.csv  irregular English forms and their lemma, from
                               the WordNet 3.0 exception lists, for lemmatising
                               responses (only lemmas the English norms rate)

Both tables are published with the site. select_seeds.py uses them to choose
the seeds, and the results page loads them to score every response.
"""
import json
import os
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'sources')
OUT = os.path.join(HERE, '..', '..', 'assets', 'data')


def english():
    # keep_default_na=False: 'null' and 'nan' are real words in these lists.
    war = pd.read_csv(os.path.join(SRC, 'warriner2013.csv'), usecols=['Word', 'V.Mean.Sum', 'A.Mean.Sum'], keep_default_na=False)
    war.columns = ['word', 'valence', 'arousal']
    con = pd.read_excel(os.path.join(SRC, 'brysbaert2014_concreteness.xlsx'), usecols=['Word', 'Conc.M'], keep_default_na=False, na_values=[''])
    con.columns = ['word', 'concreteness']
    gl = pd.read_csv(os.path.join(SRC, 'scott2019_glasgow.csv'), header=[0, 1], keep_default_na=False, na_values=[''])
    gl = pd.DataFrame({'word': gl.iloc[:, 0], 'familiarity': gl[('FAM', 'M')]})
    us = pd.read_excel(os.path.join(SRC, 'subtlex_us.xlsx'), usecols=['Word', 'FREQcount', 'Zipf-value'], keep_default_na=False, na_values=[''])
    us.columns = ['word', 'count', 'zipf']
    # Frequency rank among all SUBTLEX-US word forms (1 = most frequent).
    us['rank'] = us['count'].rank(ascending=False, method='min').astype(int)
    for d in (war, con, gl, us):
        d['word'] = d['word'].astype(str).str.strip().str.lower()
    # One value per word. Warriner lists ten words twice by case (aids/AIDS,
    # tv/TV): responses are matched in lower case, so the lower-case entry,
    # which comes first, is kept. The other lists' few duplicates likewise.
    con, gl, us = (d.drop_duplicates('word') for d in (con, gl, us))
    war['valence'] = pd.to_numeric(war['valence'])
    war['arousal'] = pd.to_numeric(war['arousal'])
    en = war.drop_duplicates('word').merge(con, on='word', how='left').merge(gl, on='word', how='left').merge(us, on='word', how='left')
    en['rank'] = en['rank'].astype('Int64')
    return en[['word', 'valence', 'arousal', 'concreteness', 'familiarity', 'zipf', 'rank']].sort_values('word')


def chinese():
    ct = pd.read_excel(os.path.join(SRC, 'chan_tse2024.xlsx'),
                       usecols=['Word_Trad', 'Word_Sim', 'valence_mean', 'arousal_mean', 'conc_mean', 'fami_mean'])
    ct.columns = ['trad', 'simp', 'valence', 'arousal', 'concreteness', 'familiarity']
    # SUBTLEX-CH is in simplified characters: Zipf = log10(frequency per million) + 3.
    wf = pd.read_csv(os.path.join(SRC, 'subtlex_ch_wf.txt'), sep='\t', skiprows=2, encoding='gb18030')
    wf = pd.DataFrame({'simp': wf['Word'], 'zipf': np.log10(wf['W/million']) + 3,
                       # frequency rank among all SUBTLEX-CH words (1 = most frequent)
                       'rank': wf['WCount'].rank(ascending=False, method='min').astype(int)}).drop_duplicates('simp')
    zh = ct.drop_duplicates('trad').merge(wf, on='simp', how='left')
    zh['rank'] = zh['rank'].astype('Int64')
    return zh[['trad', 'simp', 'valence', 'arousal', 'concreteness', 'familiarity', 'zipf', 'rank']].sort_values('trad')


def irregular(en):
    """WordNet's irregular inflections (went -> go, children -> child), kept only
    where the lemma is rated and the form itself is not."""
    rated = set(en['word'])
    rows = []
    for pos in ('noun', 'verb', 'adj'):
        for line in open(os.path.join(SRC, 'wordnet', f'{pos}.exc'), encoding='utf-8'):
            form, *lemmas = line.split()
            form = form.replace('_', ' ')
            if form in rated or ' ' in form:
                continue
            for lemma in lemmas:
                if lemma in rated and lemma != form:
                    rows.append((form, lemma))
                    break
    return pd.DataFrame(rows, columns=['form', 'lemma']).drop_duplicates('form').sort_values('form')


EQUATED = ['valence', 'arousal', 'concreteness']


def equate(en, zh):
    """Put Chinese ratings on the English scales (linear, mean–sigma equating).

    The two norm sets use the same 1–9 valence and arousal scales, but the
    Chinese ratings are compressed towards the middle, and concreteness uses
    1–7 against 1–5. Taking each norm set as a large sample of its language's
    vocabulary, the Chinese values are shifted and stretched so that, over the
    whole set, they have the English mean and SD:
        chinese_on_english = mean_en + (chinese − mean_zh) × sd_en / sd_zh
    Only the published norms are used (no translations). For valence this
    gives the same link as equating over translation equivalents.
    """
    out = {'method': 'linear (mean-sigma) equating over the whole norm sets', 'variables': {}}
    for v in EQUATED:
        e, z = en[v].dropna(), zh[v].dropna()
        slope = e.std() / z.std()
        intercept = e.mean() - slope * z.mean()
        out['variables'][v] = {'n_en': int(len(e)), 'n_zh': int(len(z)),
                               'intercept': round(float(intercept), 4), 'slope': round(float(slope), 4),
                               'mean_en': round(float(e.mean()), 3), 'mean_zh': round(float(z.mean()), 3),
                               'sd_en': round(float(e.std()), 3), 'sd_zh': round(float(z.std()), 3)}
        zh[v + '_en'] = (intercept + slope * zh[v]).round(2)
    return zh, out


def main():
    os.makedirs(OUT, exist_ok=True)
    en = english()
    zh, eq = equate(en, chinese())
    json.dump(eq, open(os.path.join(OUT, 'equating.json'), 'w'), indent=2)
    for v, e in eq['variables'].items():
        print(f"equating {v}: English = {e['intercept']:+.3f} + {e['slope']:.3f} × Chinese")
    for name, df in (('norms-en.csv', en), ('norms-zh.csv', zh), ('lemmas-en.csv', irregular(en))):
        path = os.path.join(OUT, name)
        df.to_csv(path, index=False, float_format='%.2f', encoding='utf-8')
        print(f'{name}: {len(df):,} rows, {os.path.getsize(path) / 1024:,.0f} KB')


if __name__ == '__main__':
    main()
