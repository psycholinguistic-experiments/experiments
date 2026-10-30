/* LT5461 — emotion task: the parts shared by the task page and the results page.

   The 47 emotion words of Chaouch-Orozco, Li & Li (2026), in the Chinese of the
   paper's Appendix A and in its order, plus 灾难 (“catastrophe”) twice, the
   paper's attention check: someone arranging by meaning puts the two copies
   together. 49 names in all.

   Positions are stored as shares of the box's width and height, each as two
   base-36 digits (0–1295, about one pixel on a laptop), four characters per
   word: words 1–25 in field p1, 26–49 in p2 (the sheet takes at most 200
   characters per field). The results page rebuilds every distance from these.
   Exposes window.EMOTION_CORE (and a CommonJS module for Node checks). */
(function (root) {
  'use strict';
  const WORDS = [
    ['melancholy', '忧郁'], ['loneliness', '寂寞'], ['enjoyment', '愉快'], ['dislike', '厌恶'], ['worry', '忧虑'],
    ['sympathy', '同情'], ['awe', '敬畏'], ['satisfaction', '满意'], ['serenity', '平静'], ['sorrow', '哀伤'],
    ['annoyance', '烦恼'], ['gratitude', '感激'], ['embarrassment', '尴尬'], ['admiration', '钦佩'], ['relief', '安心'],
    ['amusement', '开心'], ['love', '爱'], ['surprise', '惊讶'], ['shame', '羞愧'], ['sadness', '忧伤'],
    ['despair', '绝望'], ['fear', '恐惧'], ['guilt', '愧疚'], ['disappointment', '失望'], ['anxiety', '焦虑'],
    ['stress', '紧张'], ['compassion', '怜悯'], ['disgust', '反感'], ['happiness', '快乐'], ['pleasure', '欢愉'],
    ['contentment', '满足'], ['joy', '喜悦'], ['pride', '自豪'], ['jealousy', '嫉妒'], ['hatred', '憎恨'],
    ['irritation', '恼怒'], ['contempt', '蔑视'], ['anger', '愤怒'], ['grief', '悲伤'], ['envy', '羡慕'],
    ['regret', '遗憾'], ['pity', '怜惜'], ['hope', '期望'], ['desire', '渴望'], ['concern', '担心'],
    ['excitement', '兴奋'], ['boredom', '无聊']
  ].map(([key, zh], i) => ({ i, key, zh }));
  const K = WORDS.length;                                   // 47
  const ITEMS = WORDS.concat([{ i: 47, key: 'catastrophe_a', zh: '灾难', check: true }, { i: 48, key: 'catastrophe_b', zh: '灾难', check: true }]);
  const N = ITEMS.length;                                   // 49
  const VERSION = 'emo47-v1';
  const CHECK_MAX = 0.10;   // the two 灾难 count as “together” within 10% of the box's diagonal

  // pairs i < j over the 47 words, in the order of assets/data/emotion-paper.json
  const PAIRS = [];
  for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) PAIRS.push([i, j]);

  const GRID = 1295;
  const enc = v => Math.max(0, Math.min(GRID, Math.round(v * GRID))).toString(36).padStart(2, '0');
  // pos: [{x, y}] in item order, shares of the box → [p1, p2]
  const pack = pos => [pos.slice(0, 25), pos.slice(25)].map(part => part.map(p => enc(p.x) + enc(p.y)).join(''));
  function unpack(p1, p2) {
    const s = String(p1 || '') + String(p2 || '');
    if (!/^[0-9a-z]+$/.test(s) || s.length !== N * 4) return null;
    const out = [];
    for (let k = 0; k < N; k++) {
      const x = parseInt(s.slice(k * 4, k * 4 + 2), 36), y = parseInt(s.slice(k * 4 + 2, k * 4 + 4), 36);
      if (!(x <= GRID && y <= GRID)) return null;
      out.push({ x: x / GRID, y: y / GRID });
    }
    return out;
  }
  // distances between the 47 words (PAIRS order) and between the two 灾难, as shares of the box's diagonal
  function distances(pos, W, H) {
    const diag = Math.hypot(W, H), P = pos.map(p => [p.x * W, p.y * H]);
    const d = (a, b) => Math.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1]) / diag;
    return { pairs: PAIRS.map(([i, j]) => d(i, j)), check: d(47, 48) };
  }

  const api = { WORDS, ITEMS, K, N, VERSION, CHECK_MAX, PAIRS, pack, unpack, distances };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EMOTION_CORE = api;
})(typeof window !== 'undefined' ? window : this);
