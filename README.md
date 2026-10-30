# LT5461 in-class experiments

Browser experiments for **LT5461 Cognition and Language Differences** (City
University of Hong Kong). Students run them in class. Their anonymous data go
into a Google Sheet, and the class results update live on the projector.

- **Students:** https://psycholinguistic-experiments.github.io/experiments/ (lists all experiments)
- **Projector:** https://psycholinguistic-experiments.github.io/experiments/results.html
- **Code:** https://github.com/psycholinguistic-experiments/experiments (GitHub Pages, `main` branch)

| Page | For | What it is |
|---|---|---|
| `index.html` | students | Start page listing all experiments |
| `word-task-1.html` | students | Masked translation priming (60 ms prime), lexical decision |
| `word-task-2.html` | students | Visible translation priming (200 ms prime), lexical decision |
| `shape-task.html` | students | Sound symbolism (bouba/kiki), 3 × 2 |
| `judgement-task.html` | students | Foreign-language effect: gambles, sunk cost, superstition (Chinese vs English) |
| `association-task.html` | students | Association task (FAST): chained associations in Chinese and in English |
| `sentence-task.html` | students | Sentence verification: the typicality effect (true/false statements) |
| `bird-task.html` | students | Bird task: how typical 12 pictures are as birds (1–5), mapped as a semantic space |
| `report-task.html` | students | Report task: crime framed as a beast or a virus (Thibodeau & Boroditsky, 2011), in Chinese or English |
| `animal-task.html` | students | Animal task: arrange 20 mammals by similarity, then 30 similarity-based inferences (after Douven et al., 2023) |
| `fluency-task.html` | students | Fluency task (in Chinese): two 120-s semantic fluency blocks (animals; fruits and vegetables), then joyous exploration and deprivation sensitivity from the 5DC |
| `reading-task.html` | students | Reading task: self-paced reading of 30 passages with or without “because”, a recognition probe and some comprehension questions (after Millis & Just, 1994) |
| `colour-task.html` | students | Colour task (Mandarin): name 14 blue-green colours twice, then 60 colour-matching trials; are pairs with different names matched faster? |
| `emotion-task.html` | students | Emotion task (in Chinese): arrange 47 emotion words by meaning, as in Chaouch-Orozco, Li & Li (2026) |
| `results.html` | you | Live class results for the projector |
| `apps-script/Code.gs` | you | The Google Apps Script behind the data |

The site is plain HTML, CSS and JavaScript. There is no build step and no
dependencies.

## In class, every year

1. **Before class, rehearse** by adding `?test` to any task address, for example
   `…/word-task-1.html?test`. Test runs are filed under a separate
   `test-<date>` class, so they never mix with the real data.
2. **Put the start page on a slide**, as a link or QR code.
3. **Open `results.html` on the projector.**
   - It shows **today's class** and updates every 5 seconds.
   - *Hide results* shows only the running counts while students are still
     working. Untick it to reveal the results.
   - The *Class* menu shows earlier dates. *All 2026 classes* pools the whole
     year, which is useful for comparing years.
   - *Download this class (CSV)* gives one row per student.
   - Each tab opens with a short **Summary**: one line per finding, with its
     test and whether it is significant. It stays hidden while *Hide results*
     is ticked.

Nothing needs changing from one year to the next. Each class is simply the
Hong Kong date on which the students did the tasks.

## The data

All data go into the Google Sheet (personal Gmail) that the Apps Script is
attached to. There are two tabs per task (`masked_*`, `visible_*`, `bouba_*`, `fle_*`, `fast_*`, `svt_*`, `birds_*`, `report_*`, `animals_*`, `fluency_*`, `reading_*`, `reading_start_*`, `colour_*`, `colour_start_*`, `emotion_*`; the report task sends no trials, so it has only `report_people`):

- `*_people`: one row per student, with the numbers the results page uses.
  - Word tasks: priming effect, condition means, accuracy, screen refresh rate,
    and the measured prime duration.
  - Masked task: also the awareness answer.
  - Shape task: the six cell means.
  - Judgement task: language, the three scores, the checks.
  - Association task: group, language order, lists, the language questions,
    the ten 0–10 self-ratings, and every answer (each chain as two fields,
    `c_<seed>_a` = language + answers 1–5 and `c_<seed>_b` = answers 6–10).
    No valence is stored: the results page scores the answers each time.
  - Sentence task: median RT for high- and low-typicality true statements,
    the typicality effect, accuracy, valid-trial counts, time-outs.
  - Bird task: one column per bird (`house_sparrow` … `flying_fox`, 1–5),
    the median rating time and the five English self-ratings.
- `*_trials`: one row per trial. Every trial's forward-mask and prime
  durations are measured and stored.

Students are identified only by a random code (e.g. `K7Q-3FD`) kept on their
device, and the same code links one student's tasks. No names, student
numbers, e-mail or IP addresses are collected. These are teaching
demonstrations. Using the data for research would need ethics approval and a
consent procedure first.

Google's web-app endpoint occasionally answers with an error page (about 1
request in 8 when several arrive together), so every request retries
automatically. A submission that still fails waits on the student's device.
It is retried every 20 seconds while the page stays open, and again the next
time any task is opened. A repeated submission is never stored twice.

## One-time setup of the data connection

1. In your **personal Gmail** Google Drive, create a blank Sheet called
   *LT5461 class data*.
2. In the Sheet, open *Extensions → Apps Script*. Replace the code with the
   contents of `apps-script/Code.gs` and save.
3. Open *Deploy → New deployment →* gear icon *→ Web app*. Set *Execute as:
   Me* and *Who has access: Anyone*, then Deploy. Authorise when asked. Google
   will warn that the app is unverified; this is expected for your own
   script: *Advanced → Go to …*.
4. Copy the web-app URL (it ends in `/exec`) into `assets/config.js`.
5. Test it by opening the URL with `?action=sessions` added. You should see
   `{"ok":true,"sessions":[]}`.

The script accepts any experiment name, so new tasks need no change to it.

**Changing the script later:** edit it in the Apps Script editor, then
*Deploy → Manage deployments →* pencil icon *→ Version: New version*. The URL
stays the same. Copy the changes back into `apps-script/Code.gs`.

## Editing

- **Priming items:** `assets/stimuli.js`. Each list must stay a bijection of
  control primes; the file header explains how.
- **Shape-task words:** `WORDS` in `assets/shapes.js`.
- **Sentence-task statements:** `assets/svt-stimuli.js`.
- **Timing:** `LDT_CONFIG` at the bottom of `word-task-1.html` and
  `word-task-2.html`. If many students report reading the masked Chinese
  primes, lower `primeMs: 60` to `50`.
- **After any edit**, bump the `?v=` number on the changed file's `<link>` or
  `<script>` tag so browsers fetch the new version. Then commit and push. The
  site updates within a minute.

## Reading task (causal connectives, self-paced reading)

In English (`reading-task.html`, `assets/reading.js`, shared parts in
`assets/reading-core.js`; stimuli in `assets/data/causal-items.csv`, edited
there). Full design, measures, analysis and limitations:
`materials/reading/METHODS.md`. 2 practice + 20 critical + 8 filler passages,
lists A/B (assigned to the smaller list of the class, via exp `reading_start`),
word-by-word moving window, T/F recognition probe, Y/N questions on 12
passages. Results tab (`assets/reading-analysis.js`): descriptive comparison,
five charts, adjustable exclusions with counts, a searchable student table with
each student's trials and word times, model-based tests on request (by
students, by items, mixed model of log RT), downloads (trials, words, students,
conditions, JSON, HTML report) and import of the original HTML's files.
Tests: `dev/test_reading.py <port>` (fake clock: trial counts, lists, word
times within one frame, held keys), `dev/test_reading_import.py <port>` (runs
the original HTML in `dev/orig/` and imports its exports),
`dev/seed_reading.py <session> <seed> <port> <n>` (SIMULATED class, marked
simulated = 1; mock server only), reading cases in
`dev/test_dashboard_edges.py`.

## Emotion task (spatial arrangement of emotion words)

In Chinese (`emotion-task.html`, `assets/emotion.js`, exp `emotion`; shared parts
in `assets/emotion-core.js`). The 47 emotion words of Chaouch-Orozco, Li & Li
(2026), in the Chinese of the paper's Appendix A, plus 灾难 twice (the paper's
attention check), start in the middle of a screen-filling box; students drag
them so that words closer in meaning sit closer together, and must move every
word. Progress is kept on the device after every move, so a reload resumes.
Students see only "已提交" at the end. Full design and analysis:
`materials/emotion/METHODS.md`.

Results tab "Emotion" (`assets/emotion-analysis.js`): the paper's checks (灾难
together, at least 100 s, time within 3 SD; switchable), the class map (MDS,
aligned to the paper's Chinese map, with arrows on request), the class against
the paper's 15 languages, the relation with long-term orientation and distance
across the other 14, agreement (students with the class and with the paper,
against the paper's own Chinese speakers), the words placed most differently,
a student table with each student's own arrangement, and downloads (distances
in the paper's OSF format, positions, students, class matrix, codebook). The
paper's per-language mean matrices are in `assets/data/emotion-paper.json`,
built from its OSF files by `materials/emotion/build_paper_data.py`.

Demo: `results.html?demo` shows 40 simulated students (made in the browser from
the paper's Chinese map; nothing stored). Tests: `dev/test_emotion.py <port>`
(two runs incl. a reload, taps, arrow keys and a failed check; stored positions
= screen; the tab's numbers = a scipy recount), `dev/check_emotion.py <folder>`
(recomputes the tab from its downloads), emotion cases in
`dev/test_dashboard_edges.py`. Mantel test, MDS and Procrustes match R's vegan.

## Colour task (colour names and colour matching)

In Mandarin naming, English instructions (`colour-task.html`, `assets/colour.js`,
exp `colour`; start pings go to `colour_start`). Shared parts in
`assets/colour-core.js` (stimuli, trial list, label normalisation) and
`assets/colour-analysis.js` (per-student classification, personal results,
class charts, exports, simulation). Stimuli are made and checked by
`materials/colour/make_stimuli.py` (`stimuli.json`). Full design, measures,
analysis and cautions: `materials/colour/METHODS.md`.

14 colours (OKLCH L 0.70, C 0.10, hue 160°–264°), each named twice; 8 practice
matches with feedback; 60 fixed matches (30 two steps apart, 30 three steps),
order and side of the match randomised. Each student's own stable names decide
whether a pair is "same label", "different labels" or unclassified. Progress is
saved after every trial, so a reload resumes. Results tab "Colour": class
summary, pooled reaction times, each student's advantage, how the class named
the colours, where the names change, a student table with each student's
personal page, an exploratory mixed model, and downloads (naming trials,
matching trials, students, combined, codebook).

Demo: `results.html?demo` shows 45 simulated students (made in the browser,
nothing stored). `colour-task.html?test&demo` adds a button that fills the rest
of a rehearsal run with simulated answers (marked simulated = 1, test class).
Tests: `dev/test_colour.py <port>` (fake clock: trial counts, field limits,
resume after reload, timeouts, double presses, page = recount),
colour cases in `dev/test_dashboard_edges.py`.

## Fluency task (semantic fluency and curiosity)

In Chinese (`fluency-task.html`, `assets/fluency.js`, exp `fluency`). First
language (Chinese yes/no; "no" sets include = 0). Two 120-s blocks, animals
and fruits and vegetables, in an order flipped at every opening
(`?first=animals|fruitveg` forces it; written into the address so a reload
keeps it). One word per Enter (or "添加"); an Enter that only confirms a
Chinese input-method candidate is ignored; several words typed together
(punctuation or spaces) become separate answers; paste is blocked; a word left
in the box at 120 s counts. Then 10 items of the Five-Dimensional Curiosity
Scale (Kashdan et al., 2018, Appendix A), in my Chinese translation (not a
validated version): joy1–5 (joyous exploration) and depriv1–5 (deprivation
sensitivity), in the published order, 1–7 with all seven labels.

- `fluency_people`: `first`, `an_pos`/`fv_pos`, per block the words
  (`an_w1`–`an_w4`, '|'-separated, in the order typed) and times in seconds
  from the block start (`an_t1`–`an_t4`), `*_n`, `*_cut` (answers that did not
  fit; 0), `*_hidden_ms` (time away from the page), `*_pastes`; the 10 items;
  `je`, `ds` (4-item sums without joy2 and depriv5, as in the earlier
  Curiosity Scale Analysis Rmd and the 5DCR; 4–28) and `je5`, `ds5` (5-item
  sums). `fluency_trials`: one row per answer (category, block, position,
  response, t_ms, repeat).
- Results tab (`assets/fluency-analysis.js`): a student's total responses are
  their different valid words (repeats once); unique responses are those no
  other student in the class gave. Valid (default): in SUBTLEX-CH
  (`assets/data/subtlex-ch-wf.txt`, Cai & Brysbaert, 2010) and on the list for
  the block's category (`assets/data/category-animals.txt`, 3,957 words;
  `category-fruitveg.txt`, 1,580 words); the switch also offers SUBTLEX-CH only
  or every different entry. Every entry that does not count is listed with
  the reason (not in SUBTLEX-CH, e.g. 考拉, 蓝莓, 火龙果, 西兰花, 牛油果; not on
  the list, e.g. 动物, 桌子; on the other category's list).
  - The category lists (`materials/fluency/categories/`): rules in
    `RULES.md`; `candidates.py` picks the 5,082 SUBTLEX-CH words with animal or
    fruit/vegetable characters, each judged against the rules
    (`review/classified_*.tsv`); `lists/` adds names listed domain by domain
    (mammals and birds; other animals; fruits and nuts; vegetables), so the
    lists also hold words SUBTLEX-CH lacks; `build.py` merges them, applies
    the exclusions again and writes the two files. Edit `RULES.md` or the
    inputs and rerun `python3 materials/fluency/categories/build.py`. Curiosity: the 5-item sums (default) or,
  with the switch, the 4-item 5DCR sums of the Rmd; profiles as in the Rmd:
  high = above the class median, on each subscale.
  - Groups (whole class and the four profiles), per category: mean total and
    unique responses, different words, and a semantic network built as SemNeT
    2.0.0 does (`assets/semnet.js`, a port: finalize(minimum_cases = 2), the
    four profiles equated, cosine similarity, TMFG; unweighted CC, ASPL and Q
    as semnetmeas(weighted = FALSE)). SemNeT's Louvain is ported with its
    xoshiro256++ generator; Q uses seed 1 and the range over seeds 1–100 is
    shown, because semnetmeas() passes no seed and SemNeT then seeds from the
    clock (its Q changes slightly between runs). Checked against R: 480 random
    networks identical in edges, CC, ASPL, partitions and Q (seeds 1, 7, 123);
    and the page's own networks rebuilt by `materials/fluency/networks.R` from
    its matrix downloads match exactly. Drawn with one layout shared by the
    four profiles (from the network of every student's answers on the equated
    words); edges by cosine weight; descriptive, no tests.
  - Students: total or unique responses against joyous exploration,
    deprivation sensitivity and their sum (Pearson r, t-test, Fisher-z CI), and
    a regression on both subscales (each adjusted for the other; R², F).
  - The class's most frequent answers, order and quality checks. Downloads:
    every answer (SUBTLEX-CH status, whether it counts, unique), one row per
    student (totals, uniques, scores), a binary student × word matrix per
    category for SemNeT, and the networks' measures, nodes and edges.
  - `Rscript materials/fluency/networks.R <folder>` rebuilds the ten networks
    from the two matrix CSVs with SemNeT and writes the same three tables.
- Tests: `dev/test_fluency.py <port>` (phone and desktop, fake clock);
  `dev/seed_fluency.py <session> <seed> <port> <n>`; fluency cases in
  `dev/test_dashboard_edges.py`.

## Animal task (spatial arrangement and inference)

After Douven et al. (2023), in English. Part 1: the names of 20 mammals
(`assets/animal-items.js`; never reorder it, the data store inferences by
index) start in two random columns of ten; students drag them (or tap a name,
then a spot; or use the arrow keys) so that more similar animals are closer,
and must move every name and confirm. The box fills the screen below one line
of reminder, on phones too. Part 2: the paper's practice question (elephants →
bears, Q2), then 30 ordered pairs drawn at random from the 380 (never the
practice pair), each with its own letter–digit property, answered on a 0–100%
slider that starts at 50% and must be moved. Then the five English
self-ratings.

- `animals_people`, one row per student: `x_<animal>`, `y_<animal>` (shares of
  the box), `arena_w`, `arena_h` (pixels), `inf_a`, `inf_b` (fifteen
  `premise>conclusion:response` each, by item index), times, practice answer.
  `animals_trials`: the 30 inferences with names and properties.
- Results tab: distances as each student left them (pixels), divided by that
  student's mean distance; the class map is classical MDS of the mean
  distances, scaled to fit −1 to 1 and drawn on a square grid (as the paper's
  Figure 7). Per student, the correlation between the 30 answers and the
  distance in their own arrangement, and in the class's arrangement without
  them; Fisher-z one-sample t-tests against 0 and a paired t-test of own vs
  class (`assets/animal-map.js`). Decay curves, strength = a·e^(−b·distance)
  by least squares: each question's mean answer against its distance on the
  class map (as the paper's Figure 9), and every answer against the distance
  in the student's own arrangement. English (exploratory): the slope of each
  student's own-arrangement correlation on each self-rating, a median split,
  and the ratings themselves. "Inferences with distances (CSV)" gives every
  answer with the three distances (own, class without the student, class
  map) and the student's English self-ratings.
- Tests: `dev/test_animals.py <port>` (phone and desktop runs);
  `dev/seed_animals.py <session> <seed> <port>`.

## Report task (metaphor framing × language)

2 × 2 between subjects, after Thibodeau & Boroditsky (2011). Each time a
student opens the task, one coin flip assigns the **frame** (crime as a
*beast* or a *virus*) and another the **language** (Chinese or English).
Reloading keeps the same version; `?frame=beast|virus` and `?lang=zh|en` in
the address force one (e.g. for four separate links).

- Screens: the first-language question; the report paragraph (the instructor's
  Canvas wording, with the metaphor word in bold) and one choice, Punishment
  or Reform (always in that order); then language difficulty (1–7), language
  aid, and the five English self-ratings.
- Stored per student: `frame`, `lang`, `choice`, `punish` (1 = Punishment),
  `read_ms` (report shown → answer confirmed), the checks and self-ratings,
  `include` (0 if Chinese is not a first language or a language aid was used).
- Results tab: each student counts once (their first run). Shares choosing
  Punishment with Wilson 95% CIs; the metaphor effect (Beast − Virus) across
  both languages and within each; the language difference in that effect
  (English effect − Chinese effect); the language main effect. Differences use
  the adjusted Wald interval (2/c successes and 4/c trials added to each of the
  c groups in the contrast; Agresti & Caffo, 2000; Price & Bonett, 2004) and
  the z test from the same estimate, so the CI and p agree. Exploratory: the
  metaphor effect in the English version above vs at or below the median
  English self-rating.
- Tests: `dev/test_report.py <port>` (assignment, forced versions, full runs
  in both languages); `dev/seed_report.py <session> <seed> <port>` seeds a
  synthetic class on a mock server.

## Judgement task (foreign-language effect)

Between-subjects. Each time a student opens the task (e.g. from the start
page), a coin flip assigns **Chinese (Simplified) or English** for the whole
task. Reloading the page keeps the same language. To force a
language, add `?lang=zh` or `?lang=en` to the address, e.g. for two separate
A/B links or QR codes.

| Part | Items | Score per student | Predicted in English |
|---|---|---|---|
| 1. Choices | 8 favourable 50/50 gambles, accept/reject | `gamble_accept`, the share accepted | higher (less loss aversion) |
| 2. Everyday decisions | 4 sunk-cost scenarios, 1–7 | `sunk_mean` | lower |
| 3. Reactions | 3 bad-luck, 3 good-luck, 2 neutral situations, 1–9 | `sup_intensity` = (good − bad) / 2 | lower |

- Item order is randomised within each part.
- Checks: language difficulty (1–7, should be higher in English) and the
  neutral items (should be similar).
- A student is left out of the class averages if Chinese is not one of their
  first languages, or if they used a translation aid.
- The results page compares the languages student by student: each measure's
  mean per language, and English − Chinese with a Welch 95% CI.
- Students see only a "submitted" message. No results are shown, so the
  conditions stay hidden until you reveal them.
- **Proficiency × language.** For each measure, the results page regresses
  the score on English self-rating, separately in each language. You can use
  the mean of the five self-ratings or any single skill. It plots the English
  group with its fitted line against the Chinese mean, and reports each slope
  and the interaction (English slope − Chinese slope) with 95% CIs. If the
  effect fades as English improves, the English line approaches the Chinese
  mean at higher ratings.

## Association task (FAST, Chinese and English)

A typed adaptation of the Free Association Semantic Task (Andrews-Hanna et al.,
2022), within subjects. It is written for students from Mainland China, so all
Chinese is simplified.

**What students do.**

- They start with a few questions: first language, the age they started
  English, and daily English use. Then they rate their Chinese and English on
  five 0–10 scales.
- Then come two blocks, one per language. Each block opens with numbered steps
  and an example chain in that language (table → glass → bottle → box →
  paper; 桌子 → 玻璃 → 瓶子 → 盒子 → 纸张). The example words are everyday
  objects that are neutral in both norms (valence 4.9–5.5), unlike the seeds.
  A three-answer practice follows (street / 街道, also neutral).
- Each block has 10 chains of 10 answers. A chain starts from a seed word, and
  every answer becomes the cue for the next. The seed is shown only for the
  first answer.
- Answers in the wrong script are refused. Every answer's time is recorded.
- Progress is saved after every answer, so a reload resumes.
- Students see only "Submitted" at the end.

**Seeds.** Every student gets the same 20 seeds: 10 Chinese words in the
Chinese block and 10 different English words in the English block. The two
sets are not translations of each other and share no concept, not even a
close relative or an opposite (war/peace, heaven/hell). Each set has 4
negative, 4 positive and 2 neutral seeds. The seeds are chosen from the
published norms by `materials/fast/select_seeds.py`, and
`materials/fast/selection.md` lists every candidate's values.

- The students' English is limited, so every seed is among the 2,000 most
  frequent words of its language (SUBTLEX-US, SUBTLEX-CH), and the most
  frequent are preferred.
- Chinese valence, arousal and concreteness are put on the English scales
  first. The Chan & Tse ratings are compressed towards the middle, so they are
  equated to the English norms over the two whole norm sets
  (`assets/data/equating.json`). The criteria and the matching then mean the
  same in both languages.
- The Chinese and English sets are matched on valence, arousal, concreteness
  and frequency within each category. Within each language, the positive and
  negative seeds are matched too, arousal above all.
- Words that could distress students (death, murder, suicide) are left out.

**Groups.** Only the language order is counterbalanced: group 1 does Chinese
then English, group 2 English then Chinese. The group is random each time the
task is opened. For balanced groups, use two links or QR codes ending in
`?group=1` and `?group=2`.

**Scoring.** The results page loads the norm tables in `assets/data/` and
scores every answer each time it draws.

- English answers use Warriner et al. (2013). They are matched after lower
  case, British → American spelling and lemmatisation (WordNet's irregular
  forms plus suffix rules).
- Chinese answers use Chan & Tse (2024), through its simplified forms, on the
  English scale (equated as above). The downloads also keep the raw rating.
- An answer the norms do not rate stays in its chain as missing. It is never
  translated, averaged over its parts, or bridged. Only runs made with the
  current seed lists are analysed.

**The results tab.**

1. **Summary.** One line per finding, with its test.
2. **Descriptive results.**
   - The two-state transition matrices (negative < 5 ≤ positive; answers
     1→2 … 9→10, pooled) for Chinese and English.
   - One table crossing language with seed valence. It shows staying negative,
     P(N→N); staying positive, P(P→P); the mean valence of the answers; and
     the share of repeated answers.
   - Valence along the chain.
   - The three-state matrices, in a fold-out.
3. **Inferential results.**
   - A mixed-effects logistic regression on every valid transition: next
     answer positive ~ language × previous state + seed valence + position +
     block (first or second language), with random intercepts for students
     and seeds. It is fitted
     in the browser and gives the same estimates as lme4's `glmer`
     (`nAGQ = 0`) to four decimals. The page reports the language effect on
     staying negative and on staying positive, the language × previous-state
     interaction, and the overall shift towards positive answers.
   - Two paired t-tests on one score per student and language: the seed
     valence × language interaction on the answers' valence (positive − negative
     seeds), and repeated answers.
   - Relative proficiency (exploratory).
4. **Data quality.** The share of answers the norms scored, and of the 90
   possible transitions per student and language that were valid.
5. **Downloads.** Answers with valence, and transitions, as CSV files for R.

A **repeated answer** repeats an earlier word of the same chain, the seed
included. English words are compared as lemmas (friend = friends).

## Sentence task (typicality)

A sentence verification task for the Week 2 prototype-theory sequence: are
true statements about typical category members verified faster than true
statements about less typical ones ("A sparrow is a bird" vs "A penguin is a
bird")?

**Design.** 8 practice trials, then 112 scored trials: 56 true targets and 56
false fillers across seven familiar categories (animal, bird, vehicle,
furniture, clothing, sport, musical instrument). Each category has 4 high- and
4 low-typicality targets and 8 fillers. Fillers have no typicality level and
are never analysed by typicality; they only make the decision real. Every noun
appears once. Each category keeps one sentence frame for targets and fillers.
Clothing uses the plural ("Socks are clothing."), since trousers, socks,
gloves and pyjamas have no singular frame. The items are in
`assets/svt-stimuli.js`.

**Before the task**, students give the five English self-ratings (1–7), as on
the other English tasks. They are pre-filled if given on an earlier task.

**Each trial.**

- A fixation cross for 500 ms.
- The sentence, until the first response or 5,000 ms (a time-out).
- A blank 650 ms.

Students press F for False and J for True, or use the two buttons on screen
(touch screens hide the key labels). The first response locks the trial at
once: the buttons are disabled and the timing stops. Key repeats, extra clicks
and presses while no sentence is on screen are all ignored until the next
sentence appears. Practice gives *Correct*, *Incorrect* or *Too slow*
feedback; the scored trials give none. If the student leaves the window, that
trial is marked invalid and the task pauses until they press *Continue*.

**Order.** A new random order for every run, with constraints. There are at
most 3 trials in a row with the same answer (so at most 3 targets or 3 fillers
in a row) and at most 2 in a row from one category. Each half of the task
holds 14 high and 14 low targets.

**Scoring (per student).**

- Only correct target trials count, with 250 ms ≤ RT < 5,000 ms and focus kept.
- `rt_high`, `rt_low`: the median RT for each typicality level.
- `effect` = `rt_low` − `rt_high`. Positive is the predicted direction.
- `acc`: overall accuracy over all 112 trials; time-outs count as errors.

A run is not interpreted (`include = 0`) if accuracy is below 80% or fewer
than 12 valid trials remain in either condition. The student then sees the
data-quality message instead of their RT result.

**What students see.** Their accuracy, the number of valid target trials, both
medians and the difference, as tiles and a two-bar chart. Then the debrief
from the implementation brief, with one sentence on their own direction.
*Start over* draws a new order and clears everything. A repeat run is stored,
numbered (`run`), and left out of the class results.

**The results tab.** The class mean of each person's medians, and each
person's effect as a dot. Test: the effects against 0 (one-sample t-test, the
same as a paired t-test of low vs high), with d<sub>z</sub>. Only each
student's first interpreted run counts.

**English proficiency × typicality (exploratory).** For the mean of the five
ratings or any single one:

- **Lower vs higher English.** The classic interaction plot: students split at
  the median rating; the mean of their high and low medians with 95% CIs.
  Lines that are not parallel mean the effect differs with proficiency.
- **Typicality effect by English rating.** Each student's effect against their
  rating, with the least-squares line. Its slope (ms per rating point) is the
  interaction, tested without splitting the class. It equals the low slope
  minus the high slope.
- **All five ratings.** That slope with its 95% CI for every rating, and a
  table of the slopes and tests. Six exploratory tests, uncorrected.

Charts: `assets/svt-charts.js`.

**The module.** `assets/svt.js` is self-contained. It sets no page styles, its
CSS (`assets/svt.css`) is scoped to `.svt`, and it sends nothing itself.
`SentenceVerification.mount(element, options)` returns `reset()` and
`unmount()`, which cancel every timer and listener. It hands each finished run
to `options.onComplete` and to an `svt:complete` event. The run includes
`accuracy`, `highTypicalityMedianRt`, `lowTypicalityMedianRt`,
`typicalityEffectRt`, `nValidHigh`, `nValidLow`, `nTimeouts` and every trial's
record. `sentence-task.html` stores it through the class data connection, as
the other tasks do.

## Bird task (prototype theory)

The materials of the LT5461 Google Form "Prototype theory test": the same 12
pictures (House Sparrow, European Robin, Blackbird, Blue Tit, Swan, Penguin,
Ostrich, Peacock, Flamingo, Kiwi, Emu, Flying fox), the same names, and the same
1–5 scale with its two end labels. The photos are copied from the form into
`assets/img/birds/` (AVIF, WebP and JPEG, several widths); names, files and
scale are in `assets/bird-items.js`.

- One picture per screen, in a new random order for every run (the form
  shuffled too). Answers: click or tap a number, or press 1–5. Unlike the form,
  every picture must be rated.
- A picture is rated only once it is on screen. One that fails to load is
  fetched again; if it fails twice (or takes over a minute), its trial is
  skipped, stored with an empty rating and `img_failed = 1`, and the run
  goes on.
- It ends with the five English self-ratings. Students see only "Submitted".

**The results tab** runs the analysis of *Bird plot.Rmd* (Week 4) in the
browser (`assets/bird-map.js`):

- Mean and SD of the ratings per bird; a missing rating would take the bird's
  mean, as in the Rmd.
- `prcomp(scale. = TRUE)`: a PCA of the correlations between birds. Each bird
  sits at its loadings on components 1 and 2. Dot size and colour show the
  mean (light to dark blue, `#e6f7ff` → `#005a9e`), the grey halo the SD, and
  the labels are kept clear of each other with leader lines, as
  `geom_text_repel` does. The page gives the same numbers as R to 12 decimal
  places (`dev/check_birds.R`).
- Two differences from the Rmd. Each axis is scaled to its own data in a wide
  frame instead of `coord_fixed(ratio = 0.5)`: PC1 often spans little
  (students who rate every bird higher or lower load all birds alike), and a
  fixed ratio then squeezes the birds into a narrow column. Each axis spans at
  least 0.25 and, while the page updates, only grows, so a new run moves the
  birds rather than the whole frame. A component's sign is arbitrary: the
  first drawing for a class puts the more typical birds to the right (when
  PC1 shows a clear trend with typicality) and PC2's largest loading on top,
  and the map then keeps that orientation for the class, also after a reload
  (remembered in the projector browser). It never mirrors as runs arrive.
- The map needs 3 runs. A bird everyone rated the same has no variance:
  `prcomp` stops on it, the page leaves it off the map and names it.
- **Ratings for R (CSV)** downloads one row per student with the columns of the
  Google Forms export, so *Bird plot.Rmd* runs on it unchanged (read it into
  `responses1`).

## English self-ratings

The word tasks, the judgement task (both languages) and the bird task end with five 1–7
self-ratings of English (the sentence task asks them before it starts): reading, listening, writing, speaking, and overall
(`eng_reading` … `eng_overall`, plus `eng_mean`). A student who answers on
one task finds the answers pre-filled on the next.

## Significance tests on the results page

All tests are two-tailed at α = .05, on one score per student. A result is
labelled *Significant, as predicted*, *Significant, opposite to the
prediction*, or *Not significant*. Each 95% CI excludes 0 exactly when
p < .05. A test needs at least two students (two per group for the judgement
task).

| Task | Test |
|---|---|
| Word tasks | One-sample t-test of each person's priming effect (RT and errors) against 0 |
| Shape task | Paired t-tests on each student's own percentages: u o vs i e, m n l vs p t k, m n l vs b d g, b d g vs p t k; one-sample t-tests of each sound class against 50% |
| Judgement task | Welch's t-test, English vs Chinese, for every measure (d = difference ÷ pooled SD); proficiency slopes against 0; interaction = English slope − Chinese slope, Welch–Satterthwaite t |
| Sentence task | One-sample t-test of each person's typicality effect (low − high median RT) against 0, with d<sub>z</sub>; proficiency: the slope of the effect on each English rating against 0 |
| Fluency task | Pearson r across students between the number of words (SUBTLEX-CH words, or every different entry) and each curiosity subscale, t-test, 95% CI by Fisher z (six tests, uncorrected); order check: Welch t |
| Animal task | Per-student Pearson r between inference strength and distance (own arrangement; class arrangement without the student): one-sample t on Fisher z against 0; own vs class: paired t on Fisher z; English: OLS slope of the own-arrangement r on each self-rating (exploratory) |
| Report task | Differences in the share choosing Punishment (Beast − Virus; English − Chinese; difference of differences): adjusted Wald z test and 95% CI; checks: Welch's t |

## How the priming data are analysed

Per student, then averaged across students (means of each person's own mean,
with 95% CIs across students):

**Reaction times** — word trials only; nonword trials never enter the effect.
- Correct responses only.
- RTs between 200 and 5,000 ms (Baayen & Milin, 2010; as in both papers).
- Trials dropped if the browser skipped a frame during the prime
  (`timing_ok = 0`) or the student left the tab (`interrupted = 1`).
- `effect` = mean RT control − mean RT related. Positive = faster after the
  translation.
- **Test:** each person's effect against 0 (one-sample t-test, the same as a
  paired t-test of related vs control), with d<sub>z</sub> = mean ÷ SD.

**Accuracy** — the same word trials, but every one the student saw properly,
right or wrong. No RT trimming, since errors are the measure.
- `acc_related`, `acc_control`, and their error counterparts `err_related`,
  `err_control`.
- `err_effect` = error rate control − error rate related. Positive = more
  errors without the translation, i.e. priming in accuracy as well as speed.
  A negative RT effect with a positive error effect is a speed–accuracy
  trade-off, which is worth showing the class.
- `acc_nonwords` is reported separately as a check that students were doing
  the task.
- **Test:** `err_effect` against 0, as for reaction times.
- **Awareness (masked task):** priming in students who saw Chinese vs those
  who did not, Welch's t-test.

**A run is excluded** from the class averages (but still stored) if the
student does not read Chinese, overall accuracy is below 75%, or fewer than 8
usable trials remain in either condition. `rt_trimmed` records how many
correct trials the 200–5,000 ms window removed.

## Design notes

**Masked task** follows Chaouch-Orozco, González Alonso & Rothman (2021,
*Applied Psycholinguistics*): `########` for 500 ms, then a 60 ms prime, then
the target until response.

**Visible task** follows Chaouch-Orozco et al. (2023, *SSLA*): a fixation
cross for 500 ms, then a 200 ms prime.

**Both word tasks:**
- **Timing.** Durations are counted in whole screen frames, and the actual
  durations are measured and stored on every trial.
- **Keys.** 0 means YES for right-handers; the mapping is inverted for
  left-handers.
- **Scoring.** RT trimming is 200–5,000 ms.
- **Lists.** Two Latin-square lists. Control primes re-pair the translations
  within the control set (a bijection, and every pair has unrelated meanings).
  Nonword targets get their own primes, and the masked and visible tasks use
  separate items.
- **Matching.** Lists are matched on SUBTLEX-UK Zipf frequency and length. No
  pseudoword appears in SUBTLEX-UK.

**Chinese primes:**
- The mask is enlarged by 25% so it covers a whole CJK character.
- The primes use system CJK fonts, and students choose Simplified or
  Traditional characters.
