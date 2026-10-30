# Emotion task: methods

A classroom version of the task in Chaouch-Orozco, Li & Li (2026), "Cultural
attitudes towards the future shape the semantic structure of emotion concepts",
*Humanities and Social Sciences Communications* 13:387,
https://doi.org/10.1057/s41599-026-06623-3 (data and code: https://osf.io/pjzbx/).
Chinese only: the class arranges the paper's 47 Chinese emotion words, and the
class's arrangement is compared with the paper's 50 Chinese speakers and with
its 15 languages.

Files: `emotion-task.html`, `assets/emotion.js` (the task),
`assets/emotion-core.js` (words, storage format, distances),
`assets/emotion-analysis.js` (results, charts, downloads, simulation), the
"Emotion" tab of `results.html`, `assets/data/emotion-paper.json` (the paper's
data, built by `build_paper_data.py` in this folder).

## Words

The 47 emotion concepts of the paper in the Chinese of its Appendix A
(Supplementary Information), in the same order: 忧郁 melancholy, 寂寞
loneliness, 愉快 enjoyment … 兴奋 excitement, 无聊 boredom (the full list is in
`emotion-core.js`). As in the paper, 灾难 ("catastrophe") appears twice as an
attention check: someone arranging by meaning puts the two copies together.
49 names in all.

## Procedure

The page is in Chinese. Students say whether Chinese (any variety) is a first
language, then read the instructions: drag the words so that words closer in
meaning sit closer together and words more different in meaning sit further
apart, use the whole box, move every word. Words can also be moved by tapping a
word and then the spot, or with the arrow keys.

All 49 names start in a 7 × 7 block in the middle of the box, in a new random
order for each student (the paper: "all the emotion concepts appeared in the
centre of the screen, with the order being randomly changed for each
participant"). The box fills the screen below one line of instructions
(at least 360 px high). "完成" (done) is enabled once every name has been
moved; a confirmation follows. Progress is kept on the device after every move,
so a reload offers to continue. About 8 minutes; a laptop or desktop is
recommended. Students see only "已提交" (submitted) at the end, as in the other
in-class tasks; there is no debrief on screen.

Differences from the paper: the paper used Q-SpAM (Koch et al., 2022) in
Qualtrics; here the box is the site's own and fills the screen, so its size and
shape vary with the device; and every word must be moved.

## Distances

For each student, the distance between the centres of two words as they left
them, in pixels, divided by the box's diagonal (so 0–1, like the paper's
distances). 1,081 pairs of the 47 words. The rank-based comparisons below do
not depend on this scaling.

## The paper's checks

- **灾难 together**: the two 灾难 within 10% of the box's diagonal of each other.
  The paper excluded participants who did not put them "in close proximity"
  without giving a number; 10% is this site's choice (about the width of two
  or three words on a laptop). Each student's distance is shown in the table.
- **At least 100 s** arranging (the paper's rule).
- **Arranging time within 3 SD** of the class mean (the paper's outlier rule).

Students who fail any check are left out of the class results by default; a
switch on the tab includes everyone. They always appear in the student table,
with the reason.

## Class results

- **Class matrix**: the mean of the analysed students' distances for each pair
  (as the paper's per-language aggregate matrix).
- **Map**: classical (Torgerson) multidimensional scaling of the class matrix in
  two dimensions; the caption gives the share of the structure the two
  dimensions keep. The map is rotated, reflected and scaled (Procrustes) onto
  the same kind of map of the paper's Chinese speakers, so the two can be
  compared; the second view draws a line from where the paper's speakers put
  each word to where the class put it (as the paper's Fig. 4). Colours: valence
  of the English label in Warriner et al. (2013), below 5 = negative, as the
  paper's Fig. 5.
- **The 15 languages**: Spearman correlation between the class matrix and each
  language's mean matrix over the 1,081 pairs, next to the paper's Chinese
  speakers' correlation with the same language. Against the paper's Chinese
  speakers also a Mantel test (Spearman, 999 permutations of the words,
  one-sided, as vegan's `mantel()`).
- **Long-term orientation and distance**: across the paper's 14 other
  languages, the Pearson correlation between that similarity and (a) the
  difference in Hofstede's long-term orientation from China (77) and (b) the
  geographic distance from China, with a Fisher-z 95% CI and the t-test p, for
  the class and for the paper's Chinese speakers. A negative r means more
  similar arrangements for languages of more similar cultures, the paper's
  finding. With 14 points this is imprecise.
- **Agreement**: each student's Spearman r with the mean of the rest of the
  analysed class (leave one out) and with the paper's Chinese speakers; the
  benchmark is the paper's 50 Chinese speakers, each with the mean of the other
  49 (median r = .70, range −.01 to .85).
- **Words**: for each word, the Spearman r between its 46 distances in the
  class and among the paper's Chinese speakers; low = placed differently. The
  tab lists the lowest and highest, the mean for negative and positive words
  (descriptive), and all 47 in a chart.

Students appear as P01, P02 … in order of submission; participant codes are
never shown. Only each code's first run is used. Rehearsal runs (`?test`) go to
a separate test class.

## How these numbers relate to the paper's

The paper's text describes Spearman Mantel tests between the languages' mean
distance matrices (1,081 values each). Its published R code takes one more
step: it builds each language's matrix with R's `dist()` on the word-by-word
table of mean distances, so its correlations are between distances of
distance profiles. This tab follows the text (direct mean distances), which is
simpler to explain. Its correlations between the paper's languages therefore
differ from the printed ones: for example, the Chinese speakers' matrix
correlates .70–.89 with the other 14 (closest French, furthest Tagalog),
and across those 14, long-term orientation relates to similarity with
r = −.33 (p = .25) rather than the paper's −.52 over all 105 pairs.

## Data

Sent to the class Google Sheet (exp `emotion`).

- `emotion_people`: one row per run: first language, timing (arranging time,
  first and last move), number of moves, the box's size, input device, whether
  the run was resumed, the word-list version (`emo47-v1`), the 灾难 distance
  and check, and the positions of all 49 names packed into `p1` and `p2`
  (two base-36 digits per coordinate, 0–1295 of the box's width or height).
  The results page rebuilds every distance from these.
- `emotion_trials`: one row per name (49): its position as a share of the box
  and how many times it was moved.

Downloads on the tab: distances in the columns of the paper's OSF file
`emotion_data.csv` (word1 < word2 alphabetically; columns the class did not
collect are NA; `native` = chinese if Chinese is a first language), so the
paper's R code can read the class's data; positions; students; the class
matrix; a codebook.

## Demo and tests

- `results.html?demo`: 40 simulated students made in the browser from the
  paper's Chinese map (each turned and flipped at random, with their own
  noise; a few careless or rushed). Nothing is stored.
- `dev/test_emotion.py <port>`: two full runs on the mock server. One reloads
  halfway and continues, places 10 words by tapping and nudges with the arrow
  keys; the other puts the 灾难 in opposite corners in a few seconds. Checks
  the stored positions against the screen, moves, timing, the check and the
  49 trial rows, then the results tab (who is analysed; a student's r with the
  paper = a scipy recount).
- `dev/check_emotion.py <folder>`: recomputes the tab from its downloads
  (distances from positions, checks, class matrix, all 15 correlations,
  leave-one-out r, the LTO and distance r with CI and p, the words, the MDS
  share).
- The Mantel test (r and p), the MDS and the Procrustes alignment match R's
  vegan 2.7.1 (`mantel`, `cmdscale`, `procrustes`) on the demo class.
- Emotion cases in `dev/test_dashboard_edges.py`: an empty class, one student,
  identical arrangements, every word on one spot, an unreadable row, and a
  class where nobody passes the checks.

## Cautions (also on the tab)

The class is one more sample of one language, so its similarity to the 15
languages is a description, not a new test of the paper. The relation with
long-term orientation rests on 14 languages. The box differs from Q-SpAM's, and
screens differ. A two-dimensional box forces a two-dimensional answer.
Students differ from the paper's participants (age, field, Hong Kong, English).
Valence colours come from English ratings of the English labels; a Chinese
word's valence can differ (羡慕 is milder than "envy").
