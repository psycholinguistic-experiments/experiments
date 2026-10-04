# Association task: materials

The seeds and the norms behind the association task (`association-task.html`).
The norm tables are published with the site, because the results page scores
every answer against them each time it computes the results.

| File | What it is |
|---|---|
| `candidates.csv` | Candidate concepts, each with an English and a (simplified) Chinese word. A concept is used in one language at most, and a family (close relatives and opposites) at most once over both sets. Also part of speech, emotion-label flag and an exclusion column |
| `build_norms.py` | Builds the tables in `assets/data/` from the original datasets, and equates the Chinese ratings to the English scales |
| `select_seeds.py` | Applies the criteria and chooses the Chinese set and the English set (10 seeds each), matched across the languages; writes `assets/fast-stimuli.js` and `selection.md` |
| `selection.md` | Every candidate's values, why it passed or failed, and how well the lists match |
| `sources/` | The original datasets (not published; see below) |

## Rebuilding

```bash
python3 materials/fast/build_norms.py
```

```bash
python3 materials/fast/select_seeds.py
```

Run them from the repository root. The first needs the original files in
`materials/fast/sources/`; the second needs only the published tables. The
selection is seeded, so it gives the same lists every time. It changes only
if you edit `candidates.csv` or the criteria at the top of `select_seeds.py`.
After a new selection, bump `?v=` on `fast-stimuli.js` in
`association-task.html` and `results.html`.

## Published tables (`assets/data/`)

| File | Rows | Columns |
|---|---|---|
| `norms-en.csv` | 13,905 English lemmas (Warriner et al.) | word, valence, arousal (1–9), concreteness (1–5), familiarity (1–7), Zipf frequency, frequency rank in SUBTLEX-US |
| `norms-zh.csv` | 25,281 two-character words (Chan & Tse) | traditional, simplified, valence, arousal (1–9), concreteness, familiarity (1–7), Zipf frequency, frequency rank in SUBTLEX-CH, and valence, arousal and concreteness on the English scales |
| `lemmas-en.csv` | 2,175 irregular English forms | form, lemma (e.g. went → go), for lemmatising answers |
| `equating.json` | 3 variables | the linear link from Chinese to English for valence, arousal and concreteness |

## Equating Chinese to the English scales

Valence and arousal are 1–9 scales in both norm sets, but the two sets are
not calibrated to each other. Chan & Tse ratings are compressed towards the
middle (SD 0.97 against Warriner's 1.27, from about the same mean), and
concreteness uses different scales (1–7 against 1–5).

`build_norms.py` links the two by linear (mean–sigma) equating over the two
whole norm sets, using only the published norms. For each variable, the Chinese
values are shifted and stretched to have the English mean and SD. They are
stored as `valence_en`, `arousal_en` and `concreteness_en` in `norms-zh.csv`,
and the raw Chan & Tse columns are kept. For valence the link,
English = −1.53 + 1.31 × Chinese, is the same one that equating over
translation equivalents gives.

Everything that compares or matches the languages uses the equated values:
the seed criteria and matching, the Markov states, the answer valence and the
trajectories.

## The analysis on the results page

`assets/fast-analysis.js` scores every answer and fits the models in the
browser (in a Web Worker, `assets/fast-worker.js`) each time the results are
drawn. The page answers two primary questions and one related one, each
English − Chinese:

| Question | Model | Main test |
|---|---|---|
| A. Do transition probabilities differ? | logistic: next answer positive ~ language × previous state + seed valence + position + block | joint Wald χ²(2) of Language and Language × previous state; follow-ups after a negative and a positive answer as average marginal predictions |
| A, check | linear: next valence ~ language × (previous valence − 5) + seed valence + position + block | Language × previous valence |
| B. Do valence trajectories differ? | linear: valence ~ language × (P + P² − 8.25) + seed valence + block, P = position − 5.5 | joint *F*-test (Satterthwaite) of Language × P and Language × P²; model-adjusted contrasts at answers 1, 5 and 10 |
| B. Does the starting word's influence fade differently? | linear: valence ~ language × seed valence × log2(position) + block | Language × seed valence × log2(position); English − Chinese gap at answers 1 and 10 |
| Exploratory: English proficiency | the transition and trajectory models + rating × language terms, with by-student random slopes for the language terms (uncorrelated, lme4's `\|\|`) | change in the English − Chinese difference per rating point (staying negative, staying positive, mean valence); overall rating primary, four skills BH-adjusted |

Every model has random intercepts for students, seeds and chains (a
student's ten answers to one seed). The logistic model uses the Laplace
approximation (as lme4's `nAGQ = 0`). The linear models use REML, with
Satterthwaite degrees of freedom (as lmerTest), including the joint tests
(as lmerTest's `contest`). Every sentence on the page is generated from
the current class's fit. For an omnibus test, "clear evidence" means joint
*p* < .05; for a single estimate, a 95% CI that excludes zero. Sentences
follow the same rule: something is said to differ, rise, fall or shrink only
when that difference or change has clear evidence; otherwise the estimate is
given and called not clear. No size word comes from a cut-off. The trajectory
wording comes from the predicted values at answers 1, 5 and 10, the
English − Chinese contrasts there, and the changes between them.

Design limitation: Chinese and English used separate matched sets of starting
words rather than translation equivalents. Language comparisons therefore
generalise across these matched sets, but cannot completely separate language
from item-set differences. The seed random intercept absorbs variation among
the words; it does not make the comparison item-matched.

The proficiency models add each student's English rating (centred) and its
interactions with language (and previous state) to the transition and
trajectory models. The rating varies only between students, so the language
terms get by-student random slopes; without them the cross-level
interactions' standard errors would be too small. They are fitted in their
own workers, the overall rating first, starting from the main models'
estimates.

Every model and joint test, the proficiency models included, was checked
against lme4 and lmerTest in R on the class data.

The robustness checks are fitted in the background once the main models
are done. They rerun the three conclusions in four ways:
- without chain intercepts;
- with only the students who have at least 70% of their transitions valid
  in both languages;
- with percentile instead of linear equating of Chinese valence;
- for the trajectory, with position as a category (a 9-df joint test).

They also model which answers go unscored. `random-slopes.R` refits the
transition model, in both its logistic and continuous forms, with
per-student slopes from the Transitions download.

## Sources

Put these in `sources/` under the names shown to rebuild the tables.

- `warriner2013.csv`: Warriner, A. B., Kuperman, V., & Brysbaert, M. (2013).
  Norms of valence, arousal, and dominance for 13,915 English lemmas.
  *Behavior Research Methods, 45*, 1191–1207. Supplementary file
  `BRM-emot-submit.csv`.
- `brysbaert2014_concreteness.xlsx`: Brysbaert, M., Warriner, A. B., &
  Kuperman, V. (2014). Concreteness ratings for 40 thousand generally known
  English word lemmas. *Behavior Research Methods, 46*, 904–911.
  Supplementary file `13428_2013_403_MOESM1_ESM.xlsx`.
- `scott2019_glasgow.csv`: Scott, G. G., Keitel, A., Becirspahic, M., Yao,
  B., & Sereno, S. C. (2019). The Glasgow Norms: Ratings of 5,500 words on
  nine scales. *Behavior Research Methods, 51*, 1258–1270. Supplementary
  file `13428_2018_1099_MOESM2_ESM.csv`.
- `subtlex_us.xlsx`: Brysbaert, M., & New, B. (2009). Moving beyond Kučera
  and Francis: A critical evaluation of current word frequency norms and the
  introduction of a new and improved word frequency measure for American
  English. *Behavior Research Methods, 41*, 977–990. SUBTLEX-US with Zipf
  values.
- `chan_tse2024.xlsx`: Chan, Y.-L., & Tse, C.-S. (2024). Decoding the
  essence of two-character Chinese words: Unveiling valence, arousal,
  concreteness, familiarity, and imageability through word norming.
  *Behavior Research Methods, 56*, 7574–7601. The file includes the
  traditional and simplified forms.
- `subtlex_ch_wf.txt`: Cai, Q., & Brysbaert, M. (2010). SUBTLEX-CH: Chinese
  word and character frequencies based on film subtitles. *PLoS ONE, 5*,
  e10729. The word-frequency file `SUBTLEX-CH-WF` (GB18030).
- `wordnet/{noun,verb,adj}.exc` and `wordnet/LICENSE`: WordNet 3.0
  exception lists (Princeton University; the licence permits
  redistribution with its notice).

The English and Chinese norms come from different populations: US adults, and
Hong Kong readers of traditional characters. Chinese is scored through the
norms' simplified forms, and the task shows only simplified characters.
