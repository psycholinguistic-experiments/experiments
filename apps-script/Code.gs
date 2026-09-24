/**
 * LT5461 class data: Google Apps Script web app.
 *
 * Paste this into the Apps Script editor of a Google Sheet
 * (Extensions → Apps Script) and deploy it as a web app. See SETUP.md.
 *
 * It keeps two tabs per experiment, created on first use:
 *   masked_people   one row per person (their summary)
 *   masked_trials   one row per trial (raw data)
 * and likewise visible_* and bouba_*.
 *
 * The results pages only ever read the *_people tabs, which hold anonymous
 * per-person summaries: a random code, the class date, and the numbers.
 */

// Any short lower-case name is accepted, so new tasks need no script change.
var EXP_RE = /^[a-z][a-z0-9_]{1,19}$/;
var MAX_BYTES = 500000;
var CACHE_SECONDS = 5;

/* ---------- write: a finished run ---------- */
function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > MAX_BYTES) return json_({ ok: false, error: 'payload missing or too large' });
    var p = JSON.parse(raw);
    if (!EXP_RE.test(p.exp || '')) return json_({ ok: false, error: 'unknown experiment' });
    if (!/^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(p.pid)) return json_({ ok: false, error: 'bad code' });
    if (!/^(test-)?\d{4}-\d{2}-\d{2}$/.test(p.session)) return json_({ ok: false, error: 'bad session' });
    if (!/^[A-Z0-9]{8,20}$/.test(p.submissionId)) return json_({ ok: false, error: 'bad id' });

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var people = sheet_(ss, p.exp + '_people');
      // A retry after a dropped connection must not create a second row.
      if (hasValue_(people, 'submission_id', p.submissionId)) return json_({ ok: true, duplicate: true });

      var summary = clean_(p.summary || {});
      summary.pid = p.pid;
      summary.session = p.session;
      summary.submission_id = p.submissionId;
      summary.received_at = new Date();
      append_(people, [summary]);

      var trials = (p.trials || []).slice(0, 400).map(function (t) {
        var row = clean_(t);
        row.pid = p.pid;
        row.session = p.session;
        row.submission_id = p.submissionId;
        return row;
      });
      if (trials.length) append_(sheet_(ss, p.exp + '_trials'), trials);
      CacheService.getScriptCache().remove(cacheKey_(p.exp, p.session));
    } finally {
      lock.releaseLock();
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* ---------- read: anonymous summaries for the results pages ---------- */
function doGet(e) {
  var q = (e && e.parameter) || {};
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (q.action === 'summary') {
      if (!EXP_RE.test(q.exp || '')) return json_({ ok: false, error: 'unknown experiment' });
      // A class is one Hong Kong date (2026-09-11); a bare year (2026) pools
      // every real class of that year, leaving rehearsal runs out.
      var yearMode = /^\d{4}$/.test(q.session || '');
      if (!yearMode && !/^(test-)?\d{4}-\d{2}-\d{2}$/.test(q.session || '')) return json_({ ok: false, error: 'bad session' });
      var cache = CacheService.getScriptCache();
      var key = cacheKey_(q.exp, q.session);
      var hit = cache.get(key);
      if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
      var rows = readObjects_(ss, q.exp + '_people').filter(function (r) {
        return yearMode ? String(r.session).indexOf(q.session + '-') === 0 : r.session === q.session;
      });
      rows.forEach(function (r) { delete r.submission_id; delete r.received_at; });
      var out = JSON.stringify({ ok: true, exp: q.exp, session: q.session, rows: rows });
      if (out.length < 95000) cache.put(key, out, CACHE_SECONDS);
      return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
    }
    if (q.action === 'sessions') {
      var counts = {};
      ss.getSheets().map(function (sh) { return sh.getName(); }).filter(function (n) {
        return /_people$/.test(n);
      }).forEach(function (name) {
        readObjects_(ss, name).forEach(function (r) {
          counts[r.session] = (counts[r.session] || 0) + 1;
        });
      });
      var sessions = Object.keys(counts).filter(Boolean).map(function (s) { return { session: s, n: counts[s] }; });
      return json_({ ok: true, sessions: sessions });
    }
    return json_({ ok: true, service: 'LT5461 class data' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* ---------- helpers ---------- */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function cacheKey_(exp, session) { return 'sum:' + exp + ':' + session; }

function sheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// Only flat primitive fields with simple names; long strings are cut, and any
// string Sheets would treat as a formula is stored as plain text.
function clean_(obj) {
  var out = {};
  Object.keys(obj).slice(0, 80).forEach(function (k) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(k)) return;
    var v = obj[k];
    if (v === null || v === undefined) return;
    if (typeof v === 'number') { if (isFinite(v)) out[k] = v; return; }
    if (typeof v === 'boolean') { out[k] = v ? 1 : 0; return; }
    if (typeof v === 'string') {
      v = v.slice(0, 200);
      if (/^[=+\-@]/.test(v)) v = "'" + v;
      out[k] = v;
    }
  });
  return out;
}

function header_(sh) {
  var n = sh.getLastColumn();
  return n ? sh.getRange(1, 1, 1, n).getValues()[0].map(String) : [];
}

function append_(sh, objs) {
  var header = header_(sh);
  var added = [];
  objs.forEach(function (o) {
    Object.keys(o).forEach(function (k) {
      if (header.indexOf(k) < 0 && added.indexOf(k) < 0) added.push(k);
    });
  });
  if (added.length) {
    var start = header.length + 1;
    sh.getRange(1, start, 1, added.length).setValues([added]).setFontWeight('bold');
    // Keep codes and class dates as text so Sheets never turns them into dates.
    added.forEach(function (k, i) {
      var rng = sh.getRange(2, start + i, sh.getMaxRows() - 1, 1);
      if (k === 'pid' || k === 'session' || k === 'submission_id') rng.setNumberFormat('@');
      // Otherwise force plain numbers: a fresh column would otherwise be given
      // a date format, and 0.05 would be stored as a time.
      else if (k.indexOf('_at') !== k.length - 3) rng.setNumberFormat('0.######');
    });
    header = header.concat(added);
    sh.setFrozenRows(1);
  }
  var rows = objs.map(function (o) {
    return header.map(function (k) { return o[k] === undefined ? '' : o[k]; });
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, header.length).setValues(rows);
}

function hasValue_(sh, col, value) {
  var header = header_(sh);
  var c = header.indexOf(col);
  if (c < 0 || sh.getLastRow() < 2) return false;
  var vals = sh.getRange(2, c + 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]) === value) return true;
  return false;
}

function readObjects_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var tz = ss.getSpreadsheetTimeZone();
  var values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var header = values.shift().map(String);
  return values.map(function (row) {
    var o = {};
    header.forEach(function (k, i) {
      var v = row[i];
      if (v instanceof Date) v = (k === 'session') ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v.toISOString();
      if (typeof v === 'string' && v.charAt(0) === "'") v = v.slice(1);
      o[k] = v;
    });
    return o;
  });
}

/**
 * One-off repair: fills in the accuracy columns for runs recorded before the
 * accuracy analysis existed, recomputing them from the *_trials tabs.
 *
 * Run it from the Apps Script editor: pick backfillAccuracy in the function
 * list and press Run. It only fills empty cells, so running it twice is safe.
 */
function backfillAccuracy() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var report = [];
  ['masked', 'visible'].forEach(function (exp) {
    var people = ss.getSheetByName(exp + '_people');
    if (!people || people.getLastRow() < 2) return;

    // Tally each run's trials: [correct, total] per condition.
    var agg = {};
    readObjects_(ss, exp + '_trials').forEach(function (t) {
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
    var width = header.length;
    var idCol = col['submission_id'];
    var filled = 0, missing = 0;

    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      while (row.length < width) row.push('');
      var a = agg[String(row[idCol])];
      if (!a) { missing++; continue; }
      if (row[col['err_related']] !== '' && row[col['err_related']] !== null) continue;
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
