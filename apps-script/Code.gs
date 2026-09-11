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

var EXPS = ['masked', 'visible', 'bouba'];
var MAX_BYTES = 500000;
var CACHE_SECONDS = 5;

/* ---------- write: a finished run ---------- */
function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > MAX_BYTES) return json_({ ok: false, error: 'payload missing or too large' });
    var p = JSON.parse(raw);
    if (EXPS.indexOf(p.exp) < 0) return json_({ ok: false, error: 'unknown experiment' });
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
      if (EXPS.indexOf(q.exp) < 0) return json_({ ok: false, error: 'unknown experiment' });
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
      EXPS.forEach(function (exp) {
        readObjects_(ss, exp + '_people').forEach(function (r) {
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
      if (k === 'pid' || k === 'session' || k === 'submission_id') {
        sh.getRange(2, start + i, sh.getMaxRows() - 1, 1).setNumberFormat('@');
      }
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
