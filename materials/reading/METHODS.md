# Reading task: causal connectives (classroom study)

After Millis & Just (1994), *The influence of connectives on sentence
comprehension*. A classroom demonstration, not a confirmatory experiment.

## Question

Does the causal connective *because* help readers integrate two clauses, and
does it make the first clause's content easier to retrieve afterwards (the
reactivation hypothesis)?

    With "because":  The teacher congratulated the students at the assembly because their science project had won the regional competition.
    No connective:   The teacher congratulated the students at the assembly. Their science project had won the regional competition.

## Design

- 30 trials per student: 2 practice, 20 critical, 8 fillers
  (`assets/data/causal-items.csv`; edit the stimuli there, not in the code).
- Two lists. List A: odd-numbered critical items with "because", even ones
  without; list B the reverse. Each student reads 10 critical passages in
  each condition, and every item appears in both conditions across students,
  never twice for one student. Fillers and practice items have no connective.
- List assignment: when a student starts, the page counts the students of
  that class already on each list and takes the smaller list (a coin flip on
  a tie, or if the class list cannot be read in 5 s). When many students start
  in the same seconds the counts are not yet visible, so the lists are close
  to, not exactly, equal.
- Order: the two practice passages, then four blocks of five critical items
  and two fillers, shuffled within each block (fillers spread through the
  session; no long run of one condition).
- No working-memory load.

## Procedure and measures

- Non-cumulative moving window, word by word, with the space bar. Every
  letter and digit is shown as a dash; punctuation stays; a monospaced font
  keeps every word in place. The first clause, then the second clause on the
  line below; no going back. A held key's auto-repeat is ignored, and the
  space bar must be released before it counts again.
- Word reading time: from the frame on which the word appeared to the key
  press that replaced it, so the time belongs to the word on screen.
- Recognition probe after the passage: *Did this word appear in the
  passage?* T / F, timed from the probe's appearance. Critical probes are the
  first-clause verb (always present); filler probes are absent words.
- Comprehension: a yes/no question after every practice passage and after
  C02, C04, C07, C09, C12, C14, C17, C19, F03 and F07 (as in the original
  experiment): 4 critical questions per condition per student.
- Leaving the page (another tab or window) during a passage, probe or
  question is recorded for that trial.

Dependent variables (critical trials): recognition RT (correct responses by
default); early second-clause reading time (mean of its first three words);
final second-clause reading time (mean of its last three words);
comprehension accuracy.

## Analysis on the results page

- Descriptive by default: condition means of the students' own means
  (recognition RT also as the median of their medians), the mean
  within-student difference with a 95% CI over students, the number of
  students and trials. Charts use Cousineau–Morey within-student 95% CIs.
- Exclusions (adjustable, with counts): incorrect probe responses (for
  recognition RT), recognition RTs outside 200–5000 ms, word times outside
  100–3000 ms, trials during which the student left the page, incomplete
  sessions, students below 60% comprehension accuracy. Stored data are never
  changed; downloads keep everything, with the reason a trial was left out.
- Model-based (opened on request): paired t-tests by students and by items;
  a linear mixed model of log RT with the condition (because +½, none −½) and
  crossed random intercepts for students and items, fitted by REML with
  Satterthwaite df (the site's `FAST_ANALYSIS.lmm`, checked against
  lme4/lmerTest). The effect is a ratio of RTs (below 1: faster with
  "because"). A warning appears below 12 students or 6 per list.

## Limitations

- The connective manipulation also changes punctuation and the sentence
  boundary (one sentence vs two).
- Every critical probe is present and every filler probe absent, so the
  answer can be predicted from the trial type, and false alarms on critical
  items cannot be estimated.
- Faster recognition shows easier access to the first-clause verb; on its own
  it does not show causal integration.
- The early and final regions are approximations of where the causal link
  becomes diagnostic, which differs between passages.
- Trial order, item differences and individual reading speed affect reading
  times; the counterbalancing and the by-student / by-item analyses address
  them only in part.

## Data

- `reading_people` (one row per student): list, list_assigned, times,
  accuracy and condition means, and every trial packed into `t01`–`t30`:
  `item;because(1/0);probe T/F;probe ms;probe correct;question Y/N/-;question ms;question correct;page leaves;clause-1 word ms/clause-2 word ms`
  (word times in base 36, to fit the store's 200-character cells).
- `reading_trials` (one row per trial): the same, with the words and word
  times in plain milliseconds.
- `reading_start_people`: one row per student who started (for "started" and
  the list balance).
- Results-page downloads: trials, words, students, conditions (CSV), the
  whole dataset (JSON), and a report (HTML with the tables and figures).
  Missing values are `NA`, never 0.
- Earlier files from the class's original HTML version (trial CSV, word CSV,
  JSON) can be imported on the results page; they stay in that browser.
