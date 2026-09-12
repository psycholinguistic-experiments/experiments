/**
 * LT5461 — one-off repair, in its own file.
 *
 * Fills in the accuracy columns for runs recorded before the accuracy analysis
 * existed, recomputing them from the *_trials tabs. Nothing else is touched,
 * and only empty cells are filled, so running it twice is safe.
 *
 * How to run: pick backfillAccuracy in the function list at the top of the
 * editor and press Run. No deployment needed.
 */
function backfillAccuracy() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var report = [];
  ['masked', 'visible'].forEach(function (exp) {
    var people = ss.getSheetByName(exp + '_people');
    if (!people || people.getLastRow() < 2) return;

    // Tally each run's trials: [correct, total] per condition.
    var agg = {};
    bf_readObjects_(ss, exp + '_trials').forEach(function (t) {
      if (String(t.phase) !== 'main') return;
      var id = String(t.submission_id);
      var a = agg[id] || (agg[id] = { related: [0, 0], control: [0, 0], nonword: [0, 0], trimmed: 0 });
      // A trial counts only if the student saw it properly.
      if (String(t.timing_ok) !== '1' || String(t.interrupted) === '1') return;
      var cond = String(t.cond);
      if (!a[cond]) return;
      var correct = Number(t.correct) === 1 ? 1 : 0;
      a[cond][0] += correct;
      a[cond][1] += 1;
      var rt = Number(t.rt);
      if (correct && cond !== 'nonword' && (rt < 200 || rt > 5000)) a.trimmed += 1;
    });

    var values = people.getRange(1, 1, people.getLastRow(), people.getLastColumn()).getValues();
    var header = values[0].map(String);
    var needed = ['acc_related', 'acc_control', 'err_related', 'err_control', 'err_effect',
      'n_related_trials', 'n_control_trials', 'rt_trimmed', 'acc_words', 'acc_nonwords'];
    needed.forEach(function (k) {
      if (header.indexOf(k) < 0) {
        header.push(k);
        people.getRange(1, header.length).setValue(k).setFontWeight('bold');
      }
    });
    values[0] = header.slice();   // keep the new column names when writing back
    var col = {};
    header.forEach(function (k, i) { col[k] = i; });

    // Sheets guesses a date format for fresh columns, which turns 0.05 into a
    // time value. Force plain numbers on every column that is not text or a
    // timestamp, so the results page can read them back.
    var textCols = ['pid', 'session', 'submission_id', 'exp', 'script', 'hand', 'input',
      'awareness', 'english', 'exclude_reason', 'started_at', 'submitted_at', 'received_at'];
    var lastRow = Math.max(people.getMaxRows(), values.length);
    header.forEach(function (k, i) {
      if (textCols.indexOf(k) < 0) people.getRange(2, i + 1, lastRow - 1, 1).setNumberFormat('0.######');
    });
    var width = header.length;
    var idCol = col['submission_id'];
    var filled = 0, missing = 0;

    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      while (row.length < width) row.push('');
      var a = agg[String(row[idCol])];
      if (!a) { missing++; continue; }

      var rate = function (p) { return p[1] ? p[0] / p[1] : ''; };
      var accRel = rate(a.related), accCtl = rate(a.control);
      if (accRel === '' || accCtl === '') continue;
      var round = function (v) { return Math.round(v * 1000) / 1000; };
      row[col['acc_related']] = round(accRel);
      row[col['acc_control']] = round(accCtl);
      row[col['err_related']] = round(1 - accRel);
      row[col['err_control']] = round(1 - accCtl);
      row[col['err_effect']] = round((1 - accCtl) - (1 - accRel));
      row[col['n_related_trials']] = a.related[1];
      row[col['n_control_trials']] = a.control[1];
      row[col['rt_trimmed']] = a.trimmed;
      var words = [a.related[0] + a.control[0], a.related[1] + a.control[1]];
      if (row[col['acc_words']] === '' || row[col['acc_words']] === null) row[col['acc_words']] = round(rate(words));
      if (row[col['acc_nonwords']] === '' || row[col['acc_nonwords']] === null) row[col['acc_nonwords']] = round(rate(a.nonword));
      values[r] = row;
      filled++;
    }
    people.getRange(1, 1, values.length, width).setValues(values.map(function (row) {
      while (row.length < width) row.push('');
      return row.slice(0, width);
    }));
    report.push(exp + ': ' + filled + ' rows filled' + (missing ? ', ' + missing + ' without trial data' : ''));
  });
  var msg = report.join('\n') || 'nothing to do';
  Logger.log(msg);
  return msg;
}

/* Local copy of the sheet reader, so this file works on its own. */
function bf_readObjects_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var header = values.shift().map(String);
  return values.map(function (row) {
    var o = {};
    header.forEach(function (k, i) { o[k] = row[i]; });
    return o;
  });
}
