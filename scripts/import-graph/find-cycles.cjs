/**
 * find-cycles
 *
 * Finds and normalises import cycles in a graph built by check-import-graph.cjs.
 * Only runtime (`static`) edges can close a cycle. Not responsible for the baseline.
 */

/**
 * Rotate a cycle so it starts at its smallest node, making the same cycle
 * compare equal whichever node it was found from.
 *
 * @param {string[]} cycle - Nodes in edge order, first node not repeated / 循環のノード列
 * @returns {string} Canonical `a -> b -> a` form / 正規化した循環
 */
function normalizeCycle(cycle) {
  let min = 0;
  for (let i = 1; i < cycle.length; i++) if (cycle[i] < cycle[min]) min = i;
  const rotated = [...cycle.slice(min), ...cycle.slice(0, min)];
  return [...rotated, rotated[0]].join(' -> ');
}

/**
 * Strongly connected components with more than one node (Tarjan, iterative).
 *
 * @param {string[]} nodes - All nodes / 全ノード
 * @param {Map<string, string[]>} adj - Adjacency list / 隣接リスト
 * @returns {string[][]} Each cyclic component / 循環を含む強連結成分
 */
function cyclicComponents(nodes, adj) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const out = [];
  let counter = 0;
  for (const start of nodes) {
    if (index.has(start)) continue;
    const work = [[start, 0]];
    index.set(start, counter);
    low.set(start, counter++);
    stack.push(start);
    onStack.add(start);
    while (work.length) {
      const frame = work[work.length - 1];
      const [v, i] = frame;
      const next = adj.get(v) || [];
      if (i < next.length) {
        frame[1]++;
        const w = next[i];
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter++);
          stack.push(w);
          onStack.add(w);
          work.push([w, 0]);
        } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent), low.get(v)));
      }
      if (low.get(v) === index.get(v)) {
        const comp = [];
        let w;
        do {
          w = stack.pop();
          onStack.delete(w);
          comp.push(w);
        } while (w !== v);
        if (comp.length > 1) out.push(comp.sort());
      }
    }
  }
  return out;
}

/** Safety valve: a component with more elementary cycles than this fails loudly. */
const MAX_CYCLES_PER_COMPONENT = 2000;

/**
 * Every elementary import cycle over runtime edges, normalised.
 *
 * NOTE: Enumerating elementary cycles is exponential in the worst case. It is
 * fine here because the cyclic components are tiny (largest: 4 files,
 * 2026-11-03), and MAX_CYCLES_PER_COMPONENT turns a future tangle into a
 * loud failure instead of a hung CI job. Whole cycles (not just the edges in
 * them) are the baseline unit so an entry disappears only when that cycle is
 * actually broken.
 *
 * @param {string} pkg - Package name, prefixed onto paths / パッケージ名
 * @param {string[]} nodes - Graph nodes / ノード
 * @param {{from: string, to: string, kind: string}[]} edges - Graph edges / エッジ
 * @returns {string[]} Sorted, de-duplicated normalised cycles / 正規化した循環一覧
 * @throws {Error} When one component exceeds MAX_CYCLES_PER_COMPONENT / 循環数が上限を超えた場合
 */
function findCycles(pkg, nodes, edges) {
  const adj = new Map();
  for (const e of edges) {
    if (e.kind !== 'static') continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.get(e.from).includes(e.to)) adj.get(e.from).push(e.to);
  }
  for (const list of adj.values()) list.sort();
  const out = new Set();
  for (const comp of cyclicComponents(nodes, adj)) {
    const inComp = new Set(comp);
    let found = 0;
    // Each cycle is found exactly once: from its smallest node, through
    // larger nodes only.
    for (const start of comp) {
      const pathNodes = [start];
      const onPath = new Set([start]);
      const walk = (v) => {
        for (const w of adj.get(v) || []) {
          if (!inComp.has(w) || w < start) continue;
          if (w === start) {
            out.add(normalizeCycle(pathNodes.map((f) => `${pkg}/${f}`)));
            if (++found > MAX_CYCLES_PER_COMPONENT) {
              throw new Error(
                `import-graph: more than ${MAX_CYCLES_PER_COMPONENT} cycles among ${pkg}/${comp[0]}…`,
              );
            }
          } else if (!onPath.has(w)) {
            pathNodes.push(w);
            onPath.add(w);
            walk(w);
            pathNodes.pop();
            onPath.delete(w);
          }
        }
      };
      walk(start);
    }
  }
  return [...out].sort();
}

module.exports = { normalizeCycle, findCycles };
