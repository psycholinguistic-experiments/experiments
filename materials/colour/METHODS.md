# Colour task: methods

“Do colour names shape perception?” A classroom version of the category
advantage in colour discrimination: are two colours matched faster when the
person calls them by different names than when they call them by the same name,
at a similar physical distance? Names come from each student's own naming, not
from a fixed boundary, because Mandarin speakers differ in where (and whether)
they use 青, 蓝 and 绿.

Files: `colour-task.html` (task and personal results), `assets/colour.js`,
`assets/colour-core.js` (stimuli, trial list, label rules),
`assets/colour-analysis.js` (classification, results, charts, exports,
simulation), the “Colour” tab of `results.html`. Stimuli:
`make_stimuli.py` → `stimuli.json` (this folder).

## Participants and setting

Students in class, on their own laptop or desktop (a phone works but is not
recommended). Before starting they say whether Mandarin is a first or an
additional language, which script they type (simplified or traditional), and,
optionally, whether they have any difficulty seeing colours. Nobody is
excluded on these answers; they are stored so they can be used in analyses.

## Stimuli

14 colours, C01–C14, in OKLCH with lightness 0.70 and chroma 0.10 fixed and
hue from 160° (green) to 264° (blue) in 8° steps. All 14 are inside the sRGB
gamut, so every screen shows the colour that was intended rather than a
clipped one (`make_stimuli.py` checks this and rounds to hex).

| | |
|---|---|
| C01 #62b289 | C08 #47aec6 |
| C02 #58b292 | C09 #4eaccc |
| C03 #4fb39c | C10 #57a9d2 |
| C04 #47b3a5 | C11 #60a7d6 |
| C05 #42b2ae | C12 #6aa4da |
| C06 #40b1b7 | C13 #75a1dc |
| C07 #42b0bf | C14 #7f9edd |

Colour difference between the pairs (CIEDE2000, from the hex values):
neighbours 2.8–3.8; two steps apart 6.2–7.6; three steps apart 9.3–11.1;
four steps apart (practice) 12.1–14.6. Equal hue steps are therefore not
perfectly equal perceptual steps, which is why the model below includes the
pair as a random effect.

Screens are not calibrated. The same hex values look different across
devices, brightness settings and room lighting.

## Procedure

1. **Naming (28 trials).** One colour at a time on a grey background; the
   student types a name in Mandarin and presses Enter. Each colour is named
   twice, in two independently shuffled passes (the second pass never starts
   with the colour that ended the first). Typing time is recorded but not
   analysed.
2. **Practice matching (8 trials).** A reference square above and two squares
   below; one of the two is identical to the reference. The student presses
   1 (left) or 2 (right), or clicks or taps a square. Pairs are four steps
   apart, with feedback (900 ms).
3. **Main matching (60 trials).** The same procedure without feedback:
   fixation 400 ms, then the three squares until a response or 3 s (a
   timeout), then 350 ms blank. Reaction time is measured from the frame the
   colours appear. The first response counts; held keys are ignored.

The 60 comparisons are the same for everyone: every pair two steps apart
(C01–C03 … C12–C14, 12 pairs shown 3, 2, 3, 2 … times = 30 trials) and every
pair three steps apart (C01–C04 … C11–C14, 11 pairs shown 3, 3, 2 … times =
30). Within each separation the lower colour is the reference in 15 trials and
the higher in 15. Only the order and the side of the match (exactly 30 left,
30 right) are randomised per student. Progress is saved after every trial; a
reload offers to continue where the student left off.

Then the student sees their personal results and the debrief.

## Labels

Each typed name is normalised: Unicode NFKC, spaces, punctuation and symbols
removed, traditional 藍/綠 → 蓝/绿, a final 的 or 颜色 removed, and a final 色
removed when something is left (青色 → 青, 蓝色 → 蓝, but 色 alone stays).
Names are then grouped as 青, 蓝, 绿, other (any other word, kept as typed,
e.g. 蓝绿 or 湖蓝) or none (empty).

A colour has a **stable label** when its two normalised names are identical.
A colour named differently the two times is **uncertain**.

## Classification (per student)

Each main trial is classified with that student's own labels:

- **same label (within):** both colours have the same stable label;
- **different labels (between):** both have stable labels, and they differ;
- **unclassified (ambiguous):** at least one of the two colours has no stable
  label.

A trial is **used for reaction times** when it is correct, not a timeout, at
least 200 ms, and within or between.

## Measures

- Per student: median RT of the used within trials and of the used between
  trials; accuracy (all main trials, and per condition); number of stable
  names; naming consistency (share of the 14 colours with a stable label);
  where the labels change along the continuum.
- **Category advantage** = within median − between median, in ms. Positive
  means faster when the labels differed.
- **Enough data** = at least 8 used trials in each condition. Without that the
  advantage is reported as “insufficient data” and the student is left out of
  the RT summaries (but stays in the naming charts).
- Personal verdict: a clear advantage when ≥ +30 ms, a clear reverse effect
  when ≤ −30 ms, “similar” otherwise. The 30 ms is a teaching convention,
  not a test; the page says so.

## Class results (“Colour” tab)

- Summary text and tiles: who started and finished, who had enough data,
  accuracy, the class advantage (median and mean of the students'
  advantages), and how many were positive.
- Reaction times: the mean of the students' within and between medians, as
  bars and a table.
- Each student's advantage, as a histogram (≤ 0, 0–20, 20–40, 40–60,
  > 60 ms); hovering a bar lists the students.
- How the class named each colour (stacked bars of 青, 蓝, 绿, other,
  uncertain).
- Where the names change: for each neighbouring pair, the share of students
  whose stable labels differ.
- A student table (sortable, searchable) that opens each student's personal
  page, as they saw it. Students appear as P01, P02 … in order of submission;
  participant codes are never shown.

Only the first finished run per participant code is used. Rehearsal runs
(`?test`) go to a separate test class.

## Exploratory model

A linear mixed model of log RT on the used trials of all students:

    log RT ~ different labels (±0.5) + three steps (±0.5) + trial ((t − 30.5) / 60)
             + (1 | student) + (1 | pair)

Fitted in the browser by REML, with Satterthwaite degrees of freedom (the same
code as the other tabs; checked against lme4/lmerTest on these data:
identical estimates and CIs, t within 0.01, df within 1%). Estimates are shown
as a percentage change in RT with a 95% CI. It runs only with at least 6
students and 30 used trials in each condition. It is exploratory: the
between-label pairs are not a random sample of pairs (they sit where each
student's names change), so the pair effect and the distance term only
partly control for that.

## A design limit to know about

With a single 绿/蓝 boundary, only about 13 of the 60 comparisons fall across
it, so many students end up with fewer than 8 usable between-label trials. In
the 45-student simulation, 16 students (about a third) had insufficient data.
Students who use 青 for the middle colours have two boundaries and more
between-label trials. More main trials (or more trials around the middle of
the continuum) would reduce this; the fixed list was kept as specified.

## Data

Sent to the class Google Sheet (exp `colour`; a start ping goes to
`colour_start` when the student begins).

- `colour_people`: one row per run. Background answers, timing, input device,
  whether the run was resumed, the stimulus version
  (`oklch-0.70-0.10-h160-264-v1`), the student's stable labels, consistency,
  number of categories, accuracy, trials and medians per condition, enough
  data, advantage, include, and the packed trial fields (`nm1`–`nm4`,
  `pr`, `d1`–`d4`) from which the results page rebuilds every trial.
- `colour_trials`: one row per trial (28 naming, 8 practice, 60 main), with
  the category for the main trials.

Downloads on the results tab: naming trials, matching trials, students,
combined (one row per matching trial with the student's names for both
colours), and a codebook. Missing values are NA, never 0. Every number on the
tab can be recomputed from the matching or combined file.

## Demo and tests

- `results.html?demo`: 45 simulated students, generated in the browser
  (fixed seed); nothing is stored. A banner says so.
- `colour-task.html?test&demo`: a rehearsal run with a button that fills the
  rest with simulated answers. The run goes to the test class and is marked
  simulated = 1.
- `dev/test_colour.py`: two scripted students on a fake clock (one reloads
  mid-naming and resumes, one timeout, a double key press). It checks trial
  counts, the sheet's field limits, labels, classification, and that the
  advantage on the page equals an independent recount from the stored trials.
- Colour cases in `dev/test_dashboard_edges.py`: an empty class, one student,
  everyone naming the same way (no boundary), random naming, and an
  incomplete session.

## Cautions (also on the tab)

Naming differs between people, so students contribute different numbers of
trials per condition, and some none at all. Screens are not calibrated.
Between-label pairs may also be easier or harder for reasons other than
names. Fast and wrong is possible: read accuracy alongside RT. 60 trials make
individual advantages noisy. Naming first may have made the names more active
during matching. This is an observational classroom exercise; it cannot show
that language causes a change in perception.
