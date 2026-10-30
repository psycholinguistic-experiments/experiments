"""Build assets/data/emotion-paper.json from the OSF files of
Chaouch-Orozco, Li & Li (2026), Humanities and Social Sciences Communications
13:387, https://doi.org/10.1057/s41599-026-06623-3 (data: https://osf.io/pjzbx/).

Reads emotion_data.csv (one row per participant and word pair), ksi_data.csv
(Hofstede scores by language) and geo_distance.csv. Writes, for each of the 15
languages, the mean distance of every one of the 1081 word pairs (the
"aggregate matrix" of the paper), plus the 50 Chinese speakers' agreement with
their own group (each speaker's 1081 distances against the mean of the other 49,
Spearman), so the class can be compared with the paper's Chinese speakers.

The 47 words are in the order of the paper's Appendix A (Supplementary
Information), with the Chinese labels used there. Valence and arousal are the
English labels' ratings from Warriner et al. (2013) (assets/data/norms-en.csv),
as in the paper's Fig. 5.

    python3 materials/emotion/build_paper_data.py <folder with the OSF csv files>
"""
import csv, json, math, os, sys
from collections import defaultdict
from scipy.stats import spearmanr

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OSF = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/Documents/Claude Test/emotion-space-lab/data/osf')

# Appendix A order: English, Chinese
WORDS = [('melancholy', '忧郁'), ('loneliness', '寂寞'), ('enjoyment', '愉快'), ('dislike', '厌恶'), ('worry', '忧虑'),
         ('sympathy', '同情'), ('awe', '敬畏'), ('satisfaction', '满意'), ('serenity', '平静'), ('sorrow', '哀伤'),
         ('annoyance', '烦恼'), ('gratitude', '感激'), ('embarrassment', '尴尬'), ('admiration', '钦佩'), ('relief', '安心'),
         ('amusement', '开心'), ('love', '爱'), ('surprise', '惊讶'), ('shame', '羞愧'), ('sadness', '忧伤'),
         ('despair', '绝望'), ('fear', '恐惧'), ('guilt', '愧疚'), ('disappointment', '失望'), ('anxiety', '焦虑'),
         ('stress', '紧张'), ('compassion', '怜悯'), ('disgust', '反感'), ('happiness', '快乐'), ('pleasure', '欢愉'),
         ('contentment', '满足'), ('joy', '喜悦'), ('pride', '自豪'), ('jealousy', '嫉妒'), ('hatred', '憎恨'),
         ('irritation', '恼怒'), ('contempt', '蔑视'), ('anger', '愤怒'), ('grief', '悲伤'), ('envy', '羡慕'),
         ('regret', '遗憾'), ('pity', '怜惜'), ('hope', '期望'), ('desire', '渴望'), ('concern', '担心'),
         ('excitement', '兴奋'), ('boredom', '无聊')]
LABEL = {'arabic': 'Arabic', 'chinese': 'Chinese', 'english': 'English', 'estonian': 'Estonian', 'french': 'French',
         'greek': 'Greek', 'hebrew': 'Hebrew', 'hindi': 'Hindi', 'hungarian': 'Hungarian', 'japanese': 'Japanese',
         'latvian': 'Latvian', 'spanish': 'Spanish', 'swedish': 'Swedish', 'tagalog': 'Tagalog', 'turkish': 'Turkish'}


def main():
    K = len(WORDS)
    idx = {w: i for i, (w, _) in enumerate(WORDS)}
    pairs = [(i, j) for i in range(K) for j in range(i + 1, K)]
    pidx = {p: k for k, p in enumerate(pairs)}
    norms = {r['word']: r for r in csv.DictReader(open(os.path.join(ROOT, 'assets/data/norms-en.csv'), encoding='utf-8'))}

    # per participant: 1081 distances in our pair order
    people = defaultdict(lambda: [None] * len(pairs))
    lang_of = {}
    with open(os.path.join(OSF, 'emotion_data.csv'), encoding='utf-8') as f:
        for r in csv.DictReader(f):
            a, b = idx[r['word1']], idx[r['word2']]
            k = pidx[(min(a, b), max(a, b))]
            key = (r['native'], r['ppn'])
            people[key][k] = float(r['distance'])
            lang_of[key] = r['native']
    assert all(all(v is not None for v in vec) for vec in people.values()), 'a participant is missing a pair'

    by_lang = defaultdict(list)
    for key, vec in people.items():
        by_lang[lang_of[key]].append(vec)

    hof = {r['country']: r for r in csv.DictReader(open(os.path.join(OSF, 'ksi_data.csv'), encoding='utf-8-sig'))}
    geo = {}
    for r in csv.DictReader(open(os.path.join(OSF, 'geo_distance.csv'), encoding='utf-8-sig')):
        a, b = r['language_pair'].lower().split('.')
        if 'chinese' in (a, b):
            geo[b if a == 'chinese' else a] = float(r['geo_distance'])
    geo['chinese'] = 0.0

    langs = []
    for lang in sorted(by_lang):
        vecs = by_lang[lang]
        mean = [sum(v[k] for v in vecs) / len(vecs) for k in range(len(pairs))]
        h = hof[lang]
        num = lambda s: float(s) if s not in ('', None) else None
        langs.append({'key': lang, 'label': LABEL[lang], 'n': len(vecs),
                      'hofstede': {d: num(h[d]) for d in ('power', 'individualism', 'masculinity', 'uncertainty', 'orientation', 'indulgence')},
                      'geo_km_from_china': round(geo[lang], 1),
                      'mean': [round(x, 4) for x in mean]})

    # the Chinese speakers' agreement with the rest of their group (leave one out)
    ch = by_lang['chinese']
    n = len(ch)
    tot = [sum(v[k] for v in ch) for k in range(len(pairs))]
    loo = []
    for v in ch:
        others = [(tot[k] - v[k]) / (n - 1) for k in range(len(pairs))]
        loo.append(round(spearmanr(v, others).statistic, 4))

    # how the 15 aggregate matrices relate (Spearman over the 1081 pairs), for the methods note
    chi = next(l for l in langs if l['key'] == 'chinese')['mean']
    rs = {l['label']: round(spearmanr(chi, l['mean']).statistic, 3) for l in langs if l['key'] != 'chinese'}

    out = {
        'about': 'Mean distance per word pair and language from the OSF data of Chaouch-Orozco, Li & Li (2026), '
                 'Humanities and Social Sciences Communications 13:387 (https://osf.io/pjzbx/). Pairs are i<j over the '
                 'word order below. chinese_loo: each Chinese speaker\'s Spearman r with the mean of the other 49. '
                 'Valence/arousal: Warriner et al. (2013), English labels. Built by materials/emotion/build_paper_data.py.',
        'doi': 'https://doi.org/10.1057/s41599-026-06623-3',
        'words': [{'key': w, 'zh': z, 'valence': float(norms[w]['valence']), 'arousal': float(norms[w]['arousal'])} for w, z in WORDS],
        'languages': langs,
        'chinese_loo': loo,
    }
    path = os.path.join(ROOT, 'assets/data/emotion-paper.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'wrote {path} ({os.path.getsize(path) // 1024} KB): {len(langs)} languages, {len(pairs)} pairs')
    print('n per language:', {l["label"]: l["n"] for l in langs})
    loo_sorted = sorted(loo)
    print('Chinese speakers vs the other 49: median r %.3f (range %.3f to %.3f)' % (loo_sorted[n // 2], loo_sorted[0], loo_sorted[-1]))
    print('Chinese aggregate vs the others (Spearman):', dict(sorted(rs.items(), key=lambda x: -x[1])))


if __name__ == '__main__':
    main()
