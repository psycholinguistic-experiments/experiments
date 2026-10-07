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
| A, three states | multinomial (baseline-category) logit: next state ∈ {negative, neutral, positive} ~ language × previous state (3 levels) + seed valence + position + block; negative the reference destination | joint Wald χ²(6) of the language terms of both logits; after each previous state a 2-df test, Holm-adjusted; contrasts named in advance: negative → positive, positive → positive (average marginal predictions) |
| Exploratory: English proficiency | the transition and trajectory models + rating × language terms, with by-student random slopes for the language terms (uncorrelated, lme4's `\|\|`) | change in the English − Chinese difference per rating point (staying negative, staying positive, mean valence); overall rating primary, four skills BH-adjusted |

Analysed sample: every analysis uses the students who pass two behavioural
and data-quality rules, stated at the top of the tab with the counts. A
student is excluded when
- more than half of their answers in a language repeat the starting word or
  an earlier answer in the same chain;
- their first-language answer here contradicts their Judgement-task answer
  under the same code (the code is never shown).

Normative coverage is not an exclusion criterion: it decides which answers
can be scored (unscored answers drop out with the transitions on either side
of them), not who is analysed. Requiring at least 50%, 60%, 70% or 80% usable
transitions per language is a sensitivity analysis (Robustness).

Response times are not trimmed or capped: the timing models use each
student's median per language on a log scale, and a student is left out of
a timing model only if a median is missing. The answers and transitions
downloads keep every student, with `analysed` and `excluded_for`
(repetition; l1) columns.

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

The three-state model (states: negative < 4.2 ≤ neutral < 5.8 ≤ positive,
on the same transitions as the two-state model) is a multinomial logit with
two logits against the negative destination. Its random intercepts for
students, seeds and chains are pairs (one per logit) with an unstructured
2 × 2 covariance each, so the fit does not depend on the reference
destination. It is fitted like the logistic model (Laplace, β with the random
effects, as nAGQ = 0), in its own worker (about a minute for 88 students on a
laptop). `dev/third_pass/check_m3.R` refits it with an independent sparse-matrix
implementation in R (same deviance, coefficients, SEs, tests and
probabilities) and with RTMB's full Laplace approximation (probabilities
within .011, the same omnibus verdict); `dev/test_three_state.js` checks
the coding, the cut-points, row sums and reference invariance. Its checks
run in the background after the main fits: cut-points 4.0 / 6.0 and
4.5 / 5.5; all students, no chain intercepts, by-student language slopes,
percentile equating. Leaving out each starting word in turn (20 refits) runs
only when its section is opened, and reports only ranges. A check without
cut-points, next valence ~ language × (V + V²) + seed valence + position +
block (V = previous valence − 5), tests the two language × V terms jointly;
if it is not clear while the three-state verdicts change with the cut-points,
the page calls the three-state evidence threshold-sensitive and secondary
(`dev/third_pass/check_C1Q.R` matches lmerTest).

The robustness checks are fitted in the background once the main models
are done, in three workers. They rerun the primary conclusions (and the
continuous-valence check and the trajectory contrasts at answers 1, 5, 10):
- without chain intercepts;
- with uncorrelated by-student random slopes for the language terms;
- with all students (no exclusions);
- for the primary models and the three-state model, on only the students
  with at least 50%, 60%, 70% or 80% usable transitions in both languages
  (the repetition and first-language rules kept), as a sensitivity table;
- with percentile instead of linear equating of Chinese valence;
- for the trajectory, with position as a category (a 9-df joint test).

They also model which answers go unscored, and a collapsed panel counts
the exclusions and other participant-level checks (never codes). `random-slopes.R` refits the
transition model with per-student slopes from the Transitions download.

Timing outliers (sensitivity only): on each student's log median, per
language and measure, robust z = 0.6745 (x − median) / MAD (unscaled MAD),
|z| > 3.5 flags (outer fences Q1 − 3·IQR, Q3 + 3·IQR if MAD is 0); a student
is flagged for a measure if either language is. Flagged students are left
out only of the timing sensitivity models, which have the same
specification; they stay in every other analysis. The individual timing
plots use a log scale and draw flagged values as open circles.

Response timing: only each student's median onset (first keystroke) and
total (submit) time per language are stored with the summaries; every
answer's times are kept in the sheet's `fast_trials` tab, which the page
cannot read. Section C models log(median) ~ language × block + (1 | student)
for each measure and reports predicted seconds (geometric means) and ratios.

Exploratory section "What might produce the trajectory difference?"
(collapsed; its models are fitted only when it is opened):
- lexical reuse within each student's chains: cross-chain reuse, the
  unique-response proportion and within-chain repetition, English −
  Chinese by paired t-tests (BH across the three) on the analysed sample,
  with raw, normalised and lemma response keys;
- whether each student's English − Chinese cross-chain reuse moderates the
  language difference in starting-word decay (the starting-word model × M,
  with a by-student slope for the decay term);
- Chinese (L1) dynamics against English age of acquisition, English use and
  the English − Chinese overall rating: starting-word persistence and
  trajectory shape (mixed models with by-student slopes) and Chinese
  cross-chain reuse (least squares, HC3), BH across the nine tests;
- no semantic-space analysis (no multilingual embedding model is available
  offline).

`dev/test_lexical.js` checks the lexical metrics, normalisation and timing
rows on synthetic data; the timing, mechanism, L1 and slope models were
checked against lme4/lmerTest on the class data.

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
