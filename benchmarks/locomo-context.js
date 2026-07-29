const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { compileContext } = require('../context-compiler');
const { generateQueryVariants, reciprocalRankFusion } = require('../hybrid-retrieval');

const args = process.argv.slice(2);
const valueFor = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const numeric = (name, fallback) => Number(valueFor(name, fallback));
const defaultDataset = path.resolve(
  __dirname,
  '..',
  '..',
  '.projects',
  'Lians-canonical',
  'agentmem',
  'benchmarks',
  'data',
  'locomo10.json'
);
const datasetPath = path.resolve(valueFor('--dataset', defaultDataset));
const questionLimit = numeric('--questions', 100);
const conversationLimit = numeric('--conversations', 1);
const retrievalK = numeric('--k', 20);
const maxItems = numeric('--max-items', 20);
const maxTokens = numeric('--max-tokens', 1200);
const outputPath = valueFor('--out', '');

const stopwords = new Set(
  'a an and are as at be been but by did do does for from had has have he her hers him his how i in is it its me my of on or our she so that the their them they this to was we were what when where which who why will with you your'.split(' ')
);
const tokens = (text) => String(text || '')
  .toLowerCase()
  .match(/[a-z0-9]+/g)
  ?.filter((token) => token.length > 1 && !stopwords.has(token)) || [];

const conversationTurns = (conversation) => Object.entries(conversation)
  .filter(([key, value]) => /^session_\d+$/.test(key) && Array.isArray(value))
  .sort(([a], [b]) => Number(a.split('_')[1]) - Number(b.split('_')[1]))
  .flatMap(([, turns]) => turns)
  .map((turn) => ({
    id: String(turn.dia_id || ''),
    content: `${turn.speaker || 'speaker'}: ${turn.text || ''}${turn.blip_caption ? ` [shared a photo: ${turn.blip_caption}]` : ''}`,
  }));

const lexicalRecall = (turns, question, k) => {
  const query = new Set(tokens(question));
  const scored = turns.map((turn, index) => {
    const terms = tokens(turn.content);
    const overlap = terms.reduce((sum, term) => sum + (query.has(term) ? 1 : 0), 0);
    const phrase = [...query].some((term) => turn.content.toLowerCase().includes(term)) ? 0.15 : 0;
    return { ...turn, score: overlap / Math.max(1, Math.sqrt(terms.length * query.size)) + phrase, index };
  });
  scored.sort((a, b) => b.score - a.score || b.index - a.index);
  const top = scored.slice(0, k);
  const ceiling = Math.max(1, ...top.map((item) => item.score));
  return top.map(({ index, ...item }) => ({ ...item, score: Math.min(1, item.score / ceiling) }));
};

if (!fs.existsSync(datasetPath)) {
  throw new Error(`LoCoMo dataset not found: ${datasetPath}. Pass --dataset <path>.`);
}

const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8')).slice(0, conversationLimit);
const details = [];
const started = performance.now();

for (const sample of dataset) {
  const turns = conversationTurns(sample.conversation);
  for (const qa of sample.qa || []) {
    if (details.length >= questionLimit) break;
    const evidence = (qa.evidence || []).map(String);
    if (!evidence.length || Number(qa.category) === 5) continue;
    const baseline = lexicalRecall(turns, qa.question, retrievalK);
    const variants = generateQueryVariants(qa.question);
    const recalled = reciprocalRankFusion(
      variants.map((query) => ({ query, result: { memories: lexicalRecall(turns, query, retrievalK) } })),
      {
        limit: retrievalK,
        dialogueNeighbors: !/\b(would|likely|might|political leaning|personality)\b/i.test(qa.question),
      }
    );
    const compiled = compileContext({
      recallResult: { memories: recalled },
      maxItems,
      maxTokens,
    });
    const baselineIds = new Set(baseline.map((memory) => memory.id));
    const rawIds = new Set(recalled.map((memory) => memory.id));
    const compiledIds = new Set(compiled.memories.map((memory) => memory.id));
    const evidenceRanks = evidence
      .map((id) => recalled.findIndex((memory) => memory.id === id) + 1)
      .filter((rank) => rank > 0);
    details.push({
      sample: sample.sample_id,
      category: Number(qa.category),
      question: qa.question,
      evidence,
      baseline_hit: evidence.some((id) => baselineIds.has(id)),
      baseline_all: evidence.every((id) => baselineIds.has(id)),
      raw_hit: evidence.some((id) => rawIds.has(id)),
      compiled_hit: evidence.some((id) => compiledIds.has(id)),
      raw_all: evidence.every((id) => rawIds.has(id)),
      compiled_all: evidence.every((id) => compiledIds.has(id)),
      candidates: recalled.length,
      selected: compiled.memories.length,
      estimated_tokens: compiled.budget.estimated_tokens,
      evidence_ranks: evidenceRanks,
      exclusion_reasons: compiled.excluded.reduce((counts, item) => {
        counts[item.reason] = (counts[item.reason] || 0) + 1;
        return counts;
      }, {}),
    });
  }
  if (details.length >= questionLimit) break;
}

const rate = (field) => details.length
  ? details.filter((row) => row[field]).length / details.length
  : 0;
const mean = (field) => details.length
  ? details.reduce((sum, row) => sum + row[field], 0) / details.length
  : 0;
const byCategory = Object.fromEntries([...new Set(details.map((row) => row.category))].sort().map((category) => {
  const rows = details.filter((row) => row.category === category);
  const categoryRate = (field) => rows.filter((row) => row[field]).length / rows.length;
  return [category, {
    questions: rows.length,
    baseline_hit: Number(categoryRate('baseline_hit').toFixed(4)),
    hybrid_hit: Number(categoryRate('raw_hit').toFixed(4)),
    compiled_hit: Number(categoryRate('compiled_hit').toFixed(4)),
  }];
}));
const report = {
  suite: 'lians-locomo-context-pack-v1',
  generated_at: new Date().toISOString(),
  protocol: 'judge-free lexical retrieval and context-budget evidence retention',
  note: 'Outcome learning is intentionally disabled: LoCoMo supplies no leakage-safe prior outcome log.',
  dataset: datasetPath,
  conversations: dataset.length,
  questions: details.length,
  configuration: { retrieval_k: retrievalK, max_items: maxItems, max_tokens: maxTokens },
  metrics: {
    baseline_evidence_hit_at_k: Number(rate('baseline_hit').toFixed(4)),
    baseline_evidence_all_at_k: Number(rate('baseline_all').toFixed(4)),
    raw_evidence_hit_at_k: Number(rate('raw_hit').toFixed(4)),
    compiled_evidence_hit: Number(rate('compiled_hit').toFixed(4)),
    evidence_hit_retention: Number((rate('raw_hit') ? rate('compiled_hit') / rate('raw_hit') : 0).toFixed(4)),
    raw_evidence_all_at_k: Number(rate('raw_all').toFixed(4)),
    compiled_evidence_all: Number(rate('compiled_all').toFixed(4)),
    mean_selected_items: Number(mean('selected').toFixed(2)),
    mean_estimated_tokens: Number(mean('estimated_tokens').toFixed(2)),
    elapsed_ms: Number((performance.now() - started).toFixed(2)),
  },
  by_category: byCategory,
  detail: details,
};

if (outputPath) {
  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify(report, null, args.includes('--json') ? 2 : 0));
