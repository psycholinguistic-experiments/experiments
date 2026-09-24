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

Nothing needs changing from one year to the next. Each class is simply the
Hong Kong date on which the students did the tasks.

## The data

All data go into the Google Sheet (personal Gmail) that the Apps Script is
attached to. There are two tabs per task (`masked_*`, `visible_*`, `bouba_*`, `fle_*`):

- `*_people`: one row per student, with the numbers the results page uses.
  - Word tasks: priming effect, condition means, accuracy, screen refresh rate,
    and the measured prime duration.
  - Masked task: also the awareness answer.
  - Shape task: the six cell means.
  - Judgement task: language, the three scores, the checks.
- `*_trials`: one row per trial. Every trial's forward-mask and prime
  durations are measured and stored.

Students are identified only by a random code (e.g. `K7Q-3FD`) kept on their
device, and the same code links one student's tasks. No names, student
numbers, e-mail or IP addresses are collected. These are teaching
demonstrations. Using the data for research would need ethics approval and a
consent procedure first.

If the network drops, a student's results wait on their device and are sent
the next time a task page is opened.

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
- **Timing:** `LDT_CONFIG` at the bottom of `word-task-1.html` and
  `word-task-2.html`. If many students report reading the masked Chinese
  primes, lower `primeMs: 60` to `50`.
- **After any edit**, bump the `?v=` number on the changed file's `<link>` or
  `<script>` tag so browsers fetch the new version. Then commit and push. The
  site updates within a minute.

## Judgement task (foreign-language effect)

Between-subjects. Each student is randomly assigned **Chinese (Simplified)
or English** for the whole task, and stays in it if they reload. To force a
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

## English self-ratings

The word tasks and the judgement task (both languages) end with five 1–7
self-ratings of English: reading, listening, writing, speaking, and overall
(`eng_reading` … `eng_overall`, plus `eng_mean`). A student who answers on
one task finds the answers pre-filled on the next.

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
