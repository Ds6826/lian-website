const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const STOPWORDS = new Set(
  'a an and are as at be been but by did do does for from had has have he her hers him his how i in is it its me my of on or our she so that the their them they this to was we were what when where which who why will with you your'.split(' ')
);

const clean = (value) => String(value || '').trim().replace(/\s+/g, ' ');
const terms = (value) => (clean(value).toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || []);
const fingerprint = (memory) => clean(memory?.content ?? memory?.text ?? memory?.value).toLowerCase();
const dialogueCoordinate = (memory) => {
  const id = String(memory?.metadata?.dia_id || memory?.dia_id || memory?.id || '');
  const match = id.match(/^D(\d+):(\d+)$/i);
  return match ? { session: Number(match[1]), turn: Number(match[2]) } : null;
};

const generateQueryVariants = (query, maxVariants = 4) => {
  const original = clean(query).slice(0, 500);
  if (!original) return [];
  const variants = [original];
  const keywords = terms(original).filter((term) => !STOPWORDS.has(term));
  if (keywords.length >= 2) variants.push(keywords.join(' '));

  if (/\bwhen\b|\bhow long\b|\bbefore\b|\bafter\b|\brecent|\bfirst\b|\blast\b/i.test(original)) {
    variants.push(`${keywords.join(' ')} date time chronology`);
  }
  if (/\b(both|all|activities|events|ways|types|kinds|pieces|items|places|books|artists|instruments)\b/i.test(original)) {
    variants.push(`${keywords.join(' ')} complete history examples`);
  }
  if (/\b(would|likely|why|how did|relationship|identity|career|personality)\b/i.test(original)) {
    variants.push(`${keywords.join(' ')} background preference reason evidence`);
  }

  const clauses = original.split(/\s+(?:and|or|versus|vs\.?)\s+|[,;:]/i)
    .map(clean)
    .filter((part) => terms(part).filter((term) => !STOPWORDS.has(term)).length >= 2);
  variants.push(...clauses);

  const seen = new Set();
  return variants.filter((variant) => {
    const key = variant.toLowerCase();
    if (!variant || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, clamp(Number(maxVariants) || 4, 1, 6));
};

const reciprocalRankFusion = (results, {
  limit = 50,
  rankConstant = 60,
  dialogueNeighbors = true,
  dialogueNeighborWeight = .1,
} = {}) => {
  const fused = new Map();
  results.forEach(({ query, result }, queryIndex) => {
    (result?.memories || []).forEach((memory, rank) => {
      const key = String(memory.id || '') || fingerprint(memory);
      if (!key) return;
      const current = fused.get(key) || {
        ...memory,
        score: 0,
        retrieval: { matched_queries: [], ranks: [], best_base_score: 0 },
      };
      const baseScore = clamp(Number(memory.score ?? memory.relevance_score) || 0, 0, 1);
      const queryWeight = queryIndex === 0 ? 1.2 : 1;
      current.score += queryWeight / (rankConstant + rank + 1);
      current.retrieval.best_base_score = Math.max(current.retrieval.best_base_score, baseScore);
      current.retrieval.matched_queries.push(query);
      current.retrieval.ranks.push(rank + 1);
      fused.set(key, current);
    });
  });
  const memories = [...fused.values()];
  const ceiling = Math.max(1e-9, ...memories.map((memory) => memory.score));
  for (const memory of memories) {
    const fusedScore = memory.score / ceiling;
    memory.score = Number(clamp(fusedScore * .8 + memory.retrieval.best_base_score * .2, 0, 1).toFixed(6));
    memory.retrieval.query_support = memory.retrieval.matched_queries.length;
    memory.retrieval.policy = 'weighted-rrf-plus-base-score-v1';
  }
  if (dialogueNeighbors && dialogueNeighborWeight > 0) {
    const byCoordinate = new Map(memories.map((memory) => [dialogueCoordinate(memory), memory])
      .filter(([coordinate]) => coordinate)
      .map(([coordinate, memory]) => [`${coordinate.session}:${coordinate.turn}`, memory]));
    for (const memory of memories) {
      const coordinate = dialogueCoordinate(memory);
      if (!coordinate) continue;
      const neighborScore = Math.max(
        byCoordinate.get(`${coordinate.session}:${coordinate.turn - 1}`)?.score || 0,
        byCoordinate.get(`${coordinate.session}:${coordinate.turn + 1}`)?.score || 0
      );
      memory.retrieval.dialogue_support_score = Number(neighborScore.toFixed(6));
      memory.score = Number(clamp(memory.score + dialogueNeighborWeight * neighborScore, 0, 1).toFixed(6));
    }
  }
  memories.sort((a, b) =>
    b.score - a.score ||
    b.retrieval.query_support - a.retrieval.query_support ||
    Math.min(...a.retrieval.ranks) - Math.min(...b.retrieval.ranks)
  );
  const boundedLimit = clamp(Number(limit) || 50, 1, 200);
  if (boundedLimit < 4 || !dialogueNeighbors) return memories.slice(0, boundedLimit);

  // Preserve most relevance-ranked seeds, then use the remaining slots for
  // same-session neighboring turns already surfaced by any query. Dialogue
  // evidence frequently spans a statement and its immediate response.
  const seedCount = Math.max(1, Math.floor(boundedLimit * .8));
  const selected = memories.slice(0, seedCount);
  const selectedKeys = new Set(selected.map((memory) => String(memory.id || '') || fingerprint(memory)));
  const candidateByCoordinate = new Map();
  for (const memory of memories) {
    const coordinate = dialogueCoordinate(memory);
    if (coordinate) candidateByCoordinate.set(`${coordinate.session}:${coordinate.turn}`, memory);
  }
  for (const seed of [...selected]) {
    const coordinate = dialogueCoordinate(seed);
    if (!coordinate) continue;
    for (const offset of [-1, 1]) {
      const neighbor = candidateByCoordinate.get(`${coordinate.session}:${coordinate.turn + offset}`);
      const key = neighbor && (String(neighbor.id || '') || fingerprint(neighbor));
      if (!neighbor || selectedKeys.has(key) || selected.length >= boundedLimit) continue;
      neighbor.retrieval.dialogue_neighbor_of = String(seed.id || '');
      selected.push(neighbor);
      selectedKeys.add(key);
    }
  }
  for (const memory of memories) {
    const key = String(memory.id || '') || fingerprint(memory);
    if (selected.length >= boundedLimit) break;
    if (!selectedKeys.has(key)) {
      selected.push(memory);
      selectedKeys.add(key);
    }
  }
  return selected;
};

const hybridRecall = async ({
  recall,
  agentId,
  query,
  k = 20,
  asOf = null,
  maxVariants = 4,
  perQueryK = 200,
} = {}) => {
  if (typeof recall !== 'function') throw new TypeError('recall must be a function.');
  const variants = generateQueryVariants(query, maxVariants);
  const started = Date.now();
  const settled = await Promise.allSettled(variants.map((variant) =>
    recall({ agentId, query: variant, k: clamp(Number(perQueryK) || 200, 1, 200), asOf })
  ));
  const successful = settled.flatMap((entry, index) =>
    entry.status === 'fulfilled' ? [{ query: variants[index], result: entry.value }] : []);
  if (!successful.length) {
    const firstError = settled.find((entry) => entry.status === 'rejected');
    throw firstError?.reason || new Error('All hybrid recall queries failed.');
  }
  return {
    memories: reciprocalRankFusion(successful, {
      limit: clamp(Number(k) || 20, 1, 200),
      dialogueNeighbors: !/\b(would|likely|might|political leaning|personality)\b/i.test(query),
      dialogueNeighborWeight: .1,
    }),
    query,
    query_variants: variants,
    successful_queries: successful.length,
    failed_queries: settled.length - successful.length,
    retrieval_policy: 'multi-query-weighted-rrf-v1',
    latency_ms: Date.now() - started,
    as_of: successful[0].result?.as_of || asOf || null,
  };
};

module.exports = { generateQueryVariants, reciprocalRankFusion, hybridRecall, dialogueCoordinate };
