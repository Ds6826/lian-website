const fs = require('node:fs');
const path = require('node:path');
const { compileContext } = require('../context-compiler');

const args = process.argv.slice(2);
const inputIndex = args.indexOf('--inputs');
const outputIndex = args.indexOf('--out');
const kIndex = args.indexOf('--k');
const k = kIndex >= 0 ? Number(args[kIndex + 1]) : 20;
const inputValues = [];
if (inputIndex >= 0) {
  for (let index = inputIndex + 1; index < args.length && !args[index].startsWith('--'); index++) {
    inputValues.push(args[index]);
  }
}
const inputPaths = inputValues.map((value) => path.resolve(value));
const outputPath = outputIndex >= 0 ? path.resolve(args[outputIndex + 1]) : '';
if (!inputPaths.length) throw new Error('Pass one or more candidate reports after --inputs.');

const stopwords = new Set(
  'a an and are as at be been but by did do does for from had has have he her hers him his how i in is it its me my of on or our she so that the their them they this to was we were what when where which who why will with you your'.split(' ')
);
const stem = (token) => token
  .replace(/ies$/, 'y')
  .replace(/ing$/, '')
  .replace(/ed$/, '')
  .replace(/s$/, '');
const tokens = (text) => (String(text || '').toLowerCase().match(/[a-z0-9]+/g) || [])
  .filter((token) => token.length > 1 && !stopwords.has(token))
  .map(stem);
const coordinate = (candidate) => {
  const id = String(candidate.metadata?.dia_id || candidate.dia_id || '');
  const match = id.match(/^D(\d+):(\d+)$/);
  return match ? [Number(match[1]), Number(match[2])] : null;
};
const evidenceId = (candidate) => String(candidate.metadata?.dia_id || candidate.dia_id || candidate.id || '');
const normalizeGoldEvidence = (values) => [...new Set((values || []).flatMap((value) => {
  const text = String(value || '');
  const dialogueIds = text.match(/D\d+:\d+/g);
  return dialogueIds?.length ? dialogueIds : [text];
}).filter(Boolean))];
const evidenceIds = (candidate) => [...new Set([
  evidenceId(candidate),
  candidate.context_before_2_metadata?.dia_id,
  candidate.context_before_metadata?.dia_id,
  candidate.context_after_metadata?.dia_id,
  candidate.context_after_2_metadata?.dia_id,
].map((value) => String(value || '')).filter(Boolean))];

const rows = inputPaths.flatMap((input) => JSON.parse(fs.readFileSync(input, 'utf8')).detail || [])
  .map((row) => ({ ...row, evidence: normalizeGoldEvidence(row.evidence) }))
  .filter((row) => Number(row.category) !== 5 && Array.isArray(row.candidates) && row.evidence?.length);

const enrich = (row) => {
  const queryTerms = new Set(tokens(row.question));
  const candidates = row.candidates.map((candidate, rank) => {
    const retrievalText = [
      candidate.context_before_2 ? `[before-2] ${candidate.context_before_2}` : '',
      candidate.context_before ? `[before] ${candidate.context_before}` : '',
      candidate.content,
      candidate.context_after ? `[after] ${candidate.context_after}` : '',
      candidate.context_after_2 ? `[after-2] ${candidate.context_after_2}` : '',
    ].filter(Boolean).join('\n');
    const documentTerms = tokens(retrievalText);
    const overlap = documentTerms.filter((term) => queryTerms.has(term)).length /
      Math.max(1, Math.sqrt(documentTerms.length * queryTerms.size));
    return {
      ...candidate,
      retrievalText,
      evidenceIds: evidenceIds(candidate),
      base: Number(candidate.score) || (1 - rank / Math.max(1, row.candidates.length)),
      lexical: overlap,
      coord: coordinate(candidate),
    };
  });
  const byCoord = new Map(candidates.filter((candidate) => candidate.coord)
    .map((candidate) => [candidate.coord.join(':'), candidate]));
  for (const candidate of candidates) {
    candidate.neighbor = candidate.coord
      ? Math.max(
          byCoord.get(`${candidate.coord[0]}:${candidate.coord[1] - 1}`)?.base || 0,
          byCoord.get(`${candidate.coord[0]}:${candidate.coord[1] + 1}`)?.base || 0
        )
      : 0;
  }
  return { ...row, candidates };
};
const enriched = rows.map(enrich);

const scoreConfig = (config, includeDetails = false) => {
  let hit = 0;
  let all = 0;
  let compiledHit = 0;
  let compiledAll = 0;
  let rawHits = 0;
  let tokenSum = 0;
  let selectedSum = 0;
  let packsOverBudget = 0;
  const detail = [];
  const byCategory = {};
  for (const row of enriched) {
    const ranked = row.candidates.map((candidate) => ({
      ...candidate,
      final: config.base * candidate.base +
        config.lexical * candidate.lexical +
        config.neighbor * candidate.neighbor,
    })).sort((a, b) => b.final - a.final).slice(0, k);
    const ids = new Set(ranked.flatMap((candidate) => candidate.evidenceIds));
    const anyHit = row.evidence.some((id) => ids.has(String(id)));
    const allHit = row.evidence.every((id) => ids.has(String(id)));
    const compiled = compileContext({
      recallResult: {
        memories: ranked.map((candidate) => ({
          ...candidate,
          id: evidenceId(candidate),
          evidence_ids: candidate.evidenceIds,
          score: candidate.final,
        })),
      },
      maxItems: k,
      maxTokens: 1200,
    });
    const compiledIds = new Set(compiled.memories.flatMap((candidate) =>
      candidate.evidence_ids.map((id) => String(id))));
    const anyCompiled = row.evidence.some((id) => compiledIds.has(String(id)));
    const allCompiled = row.evidence.every((id) => compiledIds.has(String(id)));
    hit += Number(anyHit);
    all += Number(allHit);
    rawHits += Number(anyHit);
    compiledHit += Number(anyCompiled);
    compiledAll += Number(allCompiled);
    tokenSum += compiled.budget.estimated_tokens;
    selectedSum += compiled.memories.length;
    packsOverBudget += Number(compiled.budget.estimated_tokens > 1200);
    if (includeDetails) {
      const fullRanking = row.candidates.map((candidate) => ({
        id: evidenceId(candidate),
        evidenceIds: candidate.evidenceIds,
        base: candidate.base,
        lexical: candidate.lexical,
        neighbor: candidate.neighbor,
        final: config.base * candidate.base +
          config.lexical * candidate.lexical +
          config.neighbor * candidate.neighbor,
        content: candidate.retrievalText,
      })).sort((a, b) => b.final - a.final);
      detail.push({
        sample: row.sample,
        category: row.category,
        question: row.question,
        evidence: row.evidence,
        hit: anyHit,
        evidence_ranks: row.evidence.map((id) => {
          const rank = fullRanking.findIndex((candidate) => candidate.evidenceIds.includes(String(id)));
          return rank >= 0 ? rank + 1 : null;
        }),
        evidence_candidates: row.evidence.map((id) =>
          fullRanking.find((candidate) => candidate.evidenceIds.includes(String(id))) || null),
      });
    }
    const category = byCategory[row.category] ||= { n: 0, hit: 0, all: 0 };
    category.n++;
    category.hit += Number(anyHit);
    category.all += Number(allHit);
  }
  return {
    config,
    questions: enriched.length,
    evidence_hit: hit / enriched.length,
    evidence_all: all / enriched.length,
    compiled_evidence_hit: compiledHit / enriched.length,
    compiled_evidence_all: compiledAll / enriched.length,
    retrieved_hit_retention: rawHits ? compiledHit / rawHits : 0,
    mean_context_tokens: tokenSum / enriched.length,
    mean_selected_items: selectedSum / enriched.length,
    packs_over_budget: packsOverBudget,
    ...(includeDetails ? { detail } : {}),
    by_category: Object.fromEntries(Object.entries(byCategory).map(([category, stats]) => [
      category,
      {
        n: stats.n,
        evidence_hit: stats.hit / stats.n,
        evidence_all: stats.all / stats.n,
      },
    ])),
  };
};

const configs = [];
for (const lexical of [0, .03, .06, .1, .15, .2]) {
  for (const neighbor of [0, .03, .06, .1, .15]) {
    configs.push({ base: 1, lexical, neighbor });
  }
}
const results = configs.map(scoreConfig).sort((a, b) =>
  b.evidence_hit - a.evidence_hit || b.evidence_all - a.evidence_all);
const report = {
  suite: 'lians-semantic-compact-rerank-dev-v1',
  protocol: 'gold evidence used for scoring/config selection only; never supplied to ranking',
  inputs: inputPaths,
  k,
  configurations: results.length,
  best: results[0],
  baseline: results.find((result) => result.config.lexical === 0 && result.config.neighbor === 0),
  frozen: scoreConfig({ base: 1, lexical: 0, neighbor: .1 }, true),
  results,
};
if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
