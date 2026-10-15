/* Group-level semantic networks from binary student × word matrices, ported
   from SemNeT 2.0.0 (Christensen & Kenett) so the results page builds the
   same networks R does:
     finalize(minimum_cases = 2) → equate() across groups → similarity(cosine)
     → TMFG() → semnetmeas(weighted = FALSE): ASPL, CC, Q.
   Unweighted measures binarise the TMFG network first (as semnetmeas does):
     CC: per node, links among its neighbours ÷ (k² − k), rounded to 3
         decimals, then averaged (SemNeT's cc());
     ASPL: per node, the mean shortest-path length to every other node, then
         averaged (SemNeT's aspl());
     Q: modularity of a Louvain partition (resolution 1) of the binary network.
   The cosine weights stay on the edges for drawing only.
   Checked against R (SemNeT 2.0.0): edges, CC and ASPL identical; Q identical
   to SemNeT's q(A, seed = s) for the same seed.
   Exposes window.SEMNET (also a CommonJS module, for the Node check). */
(function (root) {
  'use strict';

  // R's mean(): the sum divided by n, then one correction pass.
  function rMean(a) {
    const n = a.length; let s = 0;
    for (let i = 0; i < n; i++) s += a[i];
    s /= n;
    if (isFinite(s)) { let t = 0; for (let i = 0; i < n; i++) t += a[i] - s; s += t / n; }
    return s;
  }

  /* M: {rows: [ids], cols: [words], X: rows × cols of 0/1}. Keeps the words given by at least min rows. */
  function finalize(M, min) {
    const keep = M.cols.map((_, j) => M.X.reduce((s, r) => s + r[j], 0) >= (min || 2));
    return { rows: M.rows.slice(), cols: M.cols.filter((_, j) => keep[j]), X: M.X.map(r => r.filter((_, j) => keep[j])) };
  }
  // The words every group has, sorted by code point (R's sort(method = "radix")), in every group.
  function equate(Ms) {
    const sets = Ms.map(M => new Set(M.cols));
    const shared = Ms[0].cols.filter(w => sets.every(s => s.has(w))).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return Ms.map(M => { const idx = shared.map(w => M.cols.indexOf(w)); return { rows: M.rows.slice(), cols: shared.slice(), X: M.X.map(r => idx.map(j => r[j])) }; });
  }
  // Cosine similarity between the words (columns): crossprod(x) / outer(norms, norms).
  function cosine(M) {
    const n = M.cols.length, dot = Array.from({ length: n }, () => new Array(n).fill(0));
    M.X.forEach(r => { for (let i = 0; i < n; i++) if (r[i]) for (let j = 0; j < n; j++) if (r[j]) dot[i][j] += r[i] * r[j]; });
    const norm = dot.map((r, i) => Math.sqrt(r[i]));
    return dot.map((r, i) => r.map((d, j) => d / (norm[i] * norm[j])));
  }

  /* Triangulated Maximally Filtered Graph, as SemNeT's tmfg() (depend = FALSE):
     returns the adjacency matrix with the similarity on each kept edge and 1 on the diagonal. */
  function tmfg(S) {
    const n = S.length;
    if (n < 4) return null;
    const C = S.map(r => r.map(Math.abs));
    const avg = rMean([].concat(...C));
    const strength = C.map(r => { let s = 0; for (let j = 0; j < n; j++) s += r[j] * (r[j] > avg ? 1 : 0); return s; });
    // order(strength, decreasing = TRUE): ties keep their original order
    const inserted = strength.map((s, i) => i).sort((a, b) => strength[b] - strength[a] || a - b).slice(0, 4);
    let remaining = []; for (let i = 0; i < n; i++) if (!inserted.includes(i)) remaining.push(i);
    const tri = [[inserted[0], inserted[1], inserted[2]], [inserted[1], inserted[2], inserted[3]], [inserted[0], inserted[1], inserted[3]], [inserted[0], inserted[2], inserted[3]]];
    const edges = [];
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) edges.push([inserted[a], inserted[b]]);
    const T = 2 * (n - 2);
    const gain = Array.from({ length: n }, () => new Array(T).fill(-Infinity));
    const sum3 = (r, t) => C[r][t[0]] + C[r][t[1]] + C[r][t[2]];
    remaining.forEach(r => { for (let t = 0; t < 4; t++) gain[r][t] = sum3(r, tri[t]); });
    let nTri = 4;
    for (let step = 4; step < n; step++) {
      let best, chosenCol;
      if (remaining.length === 1) {
        chosenCol = 0; const g = gain[remaining[0]]; best = 0;
        for (let t = 1; t < T; t++) if (g[t] > g[best]) best = t;
      } else {
        // per triangle (column): the best remaining node (first on ties); then the best triangle (first on ties)
        let bestGain = -Infinity; best = 0; chosenCol = 0;
        for (let t = 0; t < T; t++) {
          let mx = -Infinity, arg = 0;
          for (let k = 0; k < remaining.length; k++) { const v = gain[remaining[k]][t]; if (v > mx) { mx = v; arg = k; } }
          if (t === 0 || mx > bestGain) { bestGain = mx; best = t; chosenCol = arg; }
        }
      }
      const node = remaining[chosenCol];
      remaining = remaining.filter((_, k) => k !== chosenCol);
      inserted.push(node);
      tri[best].forEach(nb => edges.push([node, nb]));
      const b = tri[best];
      tri[nTri] = [b[0], b[2], node]; tri[nTri + 1] = [b[1], b[2], node]; tri[best] = [b[0], b[1], node];
      gain[node].fill(0);
      remaining.forEach(r => { gain[r][best] = sum3(r, tri[best]); gain[r][nTri] = sum3(r, tri[nTri]); gain[r][nTri + 1] = sum3(r, tri[nTri + 1]); });
      nTri += 2;
    }
    const A = Array.from({ length: n }, () => new Array(n).fill(0));
    edges.forEach(([i, j]) => { A[i][j] = S[i][j]; A[j][i] = S[j][i]; });
    for (let i = 0; i < n; i++) A[i][i] = S[i][i];
    return A;
  }

  const binary = A => A.map((r, i) => r.map((v, j) => (i !== j && v !== 0 ? 1 : 0)));
  // SemNeT's cc(weighted = FALSE): local clustering rounded to 3 decimals, averaged.
  function cc(A) {
    const B = binary(A), n = B.length, per = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const nb = []; for (let j = 0; j < n; j++) if (B[i][j]) nb.push(j);
      const k = nb.length;
      if (k >= 2) { let s = 0; nb.forEach(a => nb.forEach(b => { s += B[a][b]; })); per[i] = Math.round(s / (k * k - k) * 1000) / 1000; }
    }
    return { cc: rMean(per), node: per };
  }
  // Unweighted shortest paths by breadth-first search.
  function distances(A) {
    const B = binary(A), n = B.length;
    return B.map((_, s) => {
      const d = new Array(n).fill(Infinity); d[s] = 0; const q = [s];
      for (let h = 0; h < q.length; h++) { const u = q[h]; for (let v = 0; v < n; v++) if (B[u][v] && d[v] === Infinity) { d[v] = d[u] + 1; q.push(v); } }
      return d;
    });
  }
  // SemNeT's aspl(weighted = FALSE): each node's mean distance to the others (unreachable left out), averaged.
  function aspl(A) {
    const D = distances(A), n = D.length, per = [];
    for (let j = 0; j < n; j++) { const v = []; for (let i = 0; i < n; i++) if (i !== j && isFinite(D[i][j])) v.push(D[i][j]); if (v.length) per.push(rMean(v)); }
    return per.length ? rMean(per) : NaN;
  }

  /* ---------- Louvain, ported line for line from SemNeT 2.0.0's src/louvain.c ----------
     (vendored there from EGAnet): xoshiro256++ shuffles the node order on
     every pass; a move needs a gain above 1e-10; levels are aggregated until
     modularity stops rising, and a level that merges everything into one
     community is never returned. SemNeT seeds the generator from the clock
     when no seed is given (as semnetmeas() does), so R's own Q varies a
     little between runs; here the seed is fixed. */
  const M64 = (1n << 64n) - 1n;
  const rotl = (x, k) => ((x << BigInt(k)) | (x >> BigInt(64 - k))) & M64;
  function xoshiro(seed) {
    let x = BigInt.asUintN(64, BigInt(seed));
    const split = () => { x = (x + 0x9e3779b97f4a7c15n) & M64; let z = x; z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M64; z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M64; return z ^ (z >> 31n); };
    // seed_xoshiro256: each splitmix64 output becomes the next input
    const st = [];
    for (let i = 0; i < 4; i++) { const v = split(); x = v; st.push(v); }
    return () => {
      const result = (rotl((st[0] + st[3]) & M64, 23) + st[0]) & M64;
      const t = (st[1] << 17n) & M64;
      st[2] ^= st[0]; st[3] ^= st[1]; st[1] ^= st[2]; st[0] ^= st[3]; st[2] ^= t; st[3] = rotl(st[3], 45);
      return result;
    };
  }
  // net: flat row-major Float64Array, cols × cols
  function modValues(net, cols, res) {
    const cs = new Float64Array(cols);
    for (let i = 0; i < cols; i++) for (let j = i; j < cols; j++) { const e = net[i * cols + j]; if (e !== 0) { cs[i] += e; if (i !== j) cs[j] += e; } }
    let total = 0; for (let i = 0; i < cols; i++) total += cs[i];
    const nz = total !== 0, vals = new Float64Array(cols * (cols - 1) / 2 + cols);
    let c = 0;
    for (let i = 0; i < cols; i++) for (let j = i; j < cols; j++) { if (nz) vals[c] = (net[i * cols + j] - (res * cs[i] * cs[j] / total)) / total; c++; }
    return { vals, total, nz };
  }
  function modularity(Qv, mem, cols) {
    let Q = 0, c = 0;
    for (let i = 0; i < cols; i++) for (let j = i; j < cols; j++) { if (mem[i] === mem[j]) { const v = Qv.nz ? Qv.vals[c] : 0; Q += v * 2; if (i === j) Q -= v; } c++; }
    return Q;
  }
  function higherOrder(net, mem, cols) {
    let num = 0; for (let i = 0; i < cols; i++) if (mem[i] > num) num = mem[i];
    num += 1;
    const H = new Float64Array(num * num);
    for (let i = 0; i < cols; i++) for (let j = i; j < cols; j++) { const e = net[i * cols + j]; H[mem[i] * num + mem[j]] += e; H[mem[j] * num + mem[i]] += e; }
    return { H, num };
  }
  function reindex(mem, cols) {
    const idx = new Int32Array(Math.max(cols, ...Array.from(mem.slice(0, cols))) + 1); let count = 0;
    for (let i = 0; i < cols; i++) if (idx[mem[i]] === 0) idx[mem[i]] = ++count;
    for (let i = 0; i < cols; i++) mem[i] = idx[mem[i]] - 1;
    return mem;
  }
  function adjacency(net, cols) {
    const nb = [], w = [], start = [0], deg = new Float64Array(cols);
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < cols; j++) { const e = net[i * cols + j]; deg[i] += e; if (e !== 0 && j !== i) { nb.push(j); w.push(e); } }
      start.push(nb.length);
    }
    return { nb, w, start, deg };
  }
  function mainLouvain(net, Qv, memCopy, prevQ, cols, orig, res, next, first) {
    let mem = Array.from({ length: cols }, (_, i) => i), index = mem.slice();
    let upd = modularity(Qv, mem, cols);
    let adj = adjacency(net, cols), sigma = Float64Array.from(adj.deg), total = Qv.total;
    let kin = new Float64Array(cols), stamp = new Int32Array(cols).fill(-1), touched = new Int32Array(cols), epoch = 0;
    for (;;) {
      for (let i = cols - 1; i > 0; i--) { const j = Number(next() % BigInt(i + 1)); const t = index[i]; index[i] = index[j]; index[j] = t; }
      let gain = 0;
      for (let i = 0; i < cols; i++) {
        let best = 0; const o = index[i], tm = mem[o]; let nm = tm; const kv = adj.deg[o];
        let nt = 0; epoch++;
        for (let e = adj.start[o]; e < adj.start[o + 1]; e++) { const c = mem[adj.nb[e]]; if (stamp[c] !== epoch) { stamp[c] = epoch; kin[c] = 0; touched[nt++] = c; } kin[c] += adj.w[e]; }
        const kt = stamp[tm] === epoch ? kin[tm] : 0, st = sigma[tm];
        for (let t = 0; t < nt; t++) {
          const c = touched[t]; if (c === tm) continue;
          const g = (2.0 * (kin[c] - kt) - (2.0 * res * kv / total) * (sigma[c] - st + kv)) / total;
          if (g > best) { best = g; nm = c; }
        }
        if (best > 1e-10) { sigma[tm] -= kv; sigma[nm] += kv; mem[o] = nm; upd += best; gain = 1; }
      }
      if (!first) {
        if (prevQ === upd) gain = 0;
        else {
          prevQ = upd;
          reindex(mem, cols);
          for (let i = 0; i < cols; i++) for (let j = 0; j < orig; j++) if (memCopy[j] === i) memCopy[j] = mem[i];
          const h = higherOrder(net, mem, cols);
          net = h.H; cols = h.num;
          mem = Array.from({ length: cols }, (_, i) => i); index = mem.slice();
          Qv = modValues(net, cols, res);
          upd = modularity(Qv, mem, cols);
          adj = adjacency(net, cols); sigma = Float64Array.from(adj.deg); total = Qv.total;
          kin = new Float64Array(cols); stamp = new Int32Array(cols).fill(-1); touched = new Int32Array(cols); epoch = 0;
        }
      }
      if (gain === 0) break;
    }
    if (first) {
      if (cols === 1) memCopy.fill(0);
      else { reindex(mem, orig); for (let i = 0; i < orig; i++) memCopy[i] = mem[i]; }
    } else {
      if (cols === 1) memCopy.fill(0);
      else reindex(memCopy, orig);
    }
  }
  function louvain(A, seed) {
    const n = A.length, B = binary(A), net = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) net[i * n + j] = B[i][j];
    const next = xoshiro(seed || 1), res = 1;
    const memCopy = new Int32Array(n), mods = [], mems = [];
    const Q0 = modValues(net, n, res);
    mainLouvain(net, Q0, memCopy, 0.0, n, n, res, next, true);
    mods.push(modularity(Q0, memCopy, n)); mems.push(Array.from(memCopy));
    let valid = 1, level = 0, maxC = Math.max(...memCopy);
    while (maxC !== n - 1) {
      level++;
      const h = higherOrder(net, memCopy, n), Qv = modValues(h.H, h.num, res);
      mainLouvain(h.H, Qv, memCopy, mods[level - 1], h.num, n, res, next, false);
      mods.push(modularity(Q0, memCopy, n)); mems.push(Array.from(memCopy));
      if (mods[level] <= mods[level - 1]) break;
      if (mems[level].every(v => v === 0)) break;
      valid = level + 1;
      maxC = Math.max(...mems[level]);
    }
    const m = mems[valid - 1];
    return { membership: m.map(v => v + 1), modularity: mods[valid - 1], communities: Math.max(...m) + 1 };
  }

  function measures(A, seed) {
    const L = louvain(A, seed), C = cc(A);
    let edges = 0; for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) if (A[i][j] !== 0) edges++;
    return { nodes: A.length, edges, cc: C.cc, aspl: aspl(A), q: L.modularity, communities: L.communities, membership: L.membership, degree: binary(A).map(r => r.reduce((a, b) => a + b, 0)) };
  }

  /* One network from a binary matrix: cosine → TMFG → measures. */
  function network(M, seed) {
    if (M.cols.length < 4) return { M, A: null, why: `${M.cols.length} word${M.cols.length === 1 ? '' : 's'}; a network needs at least 4` };
    const S = cosine(M), A = tmfg(S);
    return Object.assign({ M, S, A }, measures(A, seed));
  }

  /* ---------- layout: Fruchterman–Reingold, seeded, deterministic ---------- */
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  // A: weighted adjacency (weights in 0–1). Returns [[x, y]] in −1..1.
  function layout(A, seed, iters) {
    const n = A.length, r = rng(seed || 7);
    if (!n) return [];
    const P = Array.from({ length: n }, (_, i) => { const a = 2 * Math.PI * i / n; return [Math.cos(a) + (r() - 0.5) * 0.1, Math.sin(a) + (r() - 0.5) * 0.1]; });
    const kk = Math.sqrt(4 / n), I = iters || 600;
    for (let it = 0; it < I; it++) {
      const t = 0.1 * (1 - it / I) + 0.002, F = P.map(() => [0, 0]);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        let dx = P[i][0] - P[j][0], dy = P[i][1] - P[j][1], d = Math.hypot(dx, dy) || 1e-6;
        const rep = kk * kk / d; let f = rep;
        if (A[i][j]) f -= d * d / kk * (0.4 + Math.abs(A[i][j]));      // attraction grows with the edge weight
        dx /= d; dy /= d; F[i][0] += dx * f; F[i][1] += dy * f; F[j][0] -= dx * f; F[j][1] -= dy * f;
      }
      for (let i = 0; i < n; i++) {
        F[i][0] -= P[i][0] * 0.02; F[i][1] -= P[i][1] * 0.02;            // a weak pull to the centre keeps loose nodes in
        const d = Math.hypot(F[i][0], F[i][1]) || 1e-9, s = Math.min(d, t) / d;
        P[i][0] += F[i][0] * s; P[i][1] += F[i][1] * s;
      }
    }
    const mx = Math.max(1e-9, ...P.map(p => Math.abs(p[0])), ...P.map(p => Math.abs(p[1])));
    return P.map(p => [p[0] / mx, p[1] / mx]);
  }

  const api = { rMean, finalize, equate, cosine, tmfg, cc, aspl, louvain, xoshiro, measures, network, layout };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SEMNET = api;
})(typeof window !== 'undefined' ? window : this);
