/* LT5461 — association task (FAST): fits the models off the page's main
   thread, so the results page stays responsive while they run (a phone can
   take seconds). Receives {id, jobs: [{key, model, tr | ans, chain}]} and
   posts {id, key, fit} as each model finishes; fits travel as plain data
   (FAST_ANALYSIS.plain) and get their methods back on the page (revive).
   The page opens this worker with fast-analysis.js's own ?v=… query, so the
   two always match: bump that one version (in results.html) after changing
   either file. */
importScripts('fast-analysis.js' + self.location.search);
const A = self.FAST_ANALYSIS;
self.onmessage = e => {
  const { id, jobs } = e.data;
  jobs.forEach(j => {
    let out;
    try { out = A.plain(A.runJob(j)); } catch (err) { out = { ok: false, reason: 'converge', error: String(err && err.message || err) }; }
    self.postMessage({ id, key: j.key, fit: out });
  });
};
