const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const reportsIndex = args.indexOf('--reports');
const outputIndex = args.indexOf('--out');
const reportValues = [];
if (reportsIndex >= 0) {
  for (let index = reportsIndex + 1; index < args.length && !args[index].startsWith('--'); index++) {
    reportValues.push(args[index]);
  }
}
if (!reportValues.length) throw new Error('Pass all frozen rerank reports after --reports.');

const reports = reportValues.map((value) => {
  const reportPath = path.resolve(value);
  return { path: reportPath, report: JSON.parse(fs.readFileSync(reportPath, 'utf8')) };
});
const expectedConfig = JSON.stringify({ base: 1, lexical: 0, neighbor: .1 });
const expectedQuestions = 1536;
const tokenBudget = 1200;
let questions = 0;
let hits = 0;
let compiledHits = 0;
let allHits = 0;
let compiledAllHits = 0;
let weightedTokens = 0;
let overBudget = 0;
const category = {};
const inputs = [];

for (const { path: reportPath, report } of reports) {
  const frozen = report.frozen;
  if (!frozen) throw new Error(`${reportPath} has no frozen result.`);
  if (JSON.stringify(frozen.config) !== expectedConfig) {
    throw new Error(`${reportPath} uses a non-frozen configuration.`);
  }
  questions += frozen.questions;
  hits += Math.round(frozen.evidence_hit * frozen.questions);
  compiledHits += Math.round(frozen.compiled_evidence_hit * frozen.questions);
  allHits += Math.round(frozen.evidence_all * frozen.questions);
  compiledAllHits += Math.round(frozen.compiled_evidence_all * frozen.questions);
  weightedTokens += frozen.mean_context_tokens * frozen.questions;
  overBudget += frozen.packs_over_budget;
  inputs.push(...(report.inputs || []));
  for (const [name, stats] of Object.entries(frozen.by_category || {})) {
    const aggregate = category[name] ||= { questions: 0, hits: 0, all_hits: 0 };
    aggregate.questions += stats.n;
    aggregate.hits += Math.round(stats.evidence_hit * stats.n);
    aggregate.all_hits += Math.round(stats.evidence_all * stats.n);
  }
}

const result = {
  suite: 'lians-locomo-goal95-verifier-v1',
  protocol: 'semantic top-200, frozen base+0.1 dialogue support, radius-2 attributed bundles, top-50 fair-share context',
  leakage_policy: 'Gold evidence is used only after retrieval for scoring; no evidence IDs or answers enter retrieval, ranking, bundling, or compilation.',
  configuration: JSON.parse(expectedConfig),
  inputs: [...new Set(inputs)],
  reports: reports.length,
  questions,
  evidence_hits: hits,
  evidence_hit: questions ? hits / questions : 0,
  evidence_all_hits: allHits,
  evidence_all: questions ? allHits / questions : 0,
  compiled_evidence_hits: compiledHits,
  compiled_evidence_hit: questions ? compiledHits / questions : 0,
  compiled_evidence_all_hits: compiledAllHits,
  compiled_evidence_all: questions ? compiledAllHits / questions : 0,
  retrieved_hit_retention: hits ? compiledHits / hits : 0,
  mean_context_tokens: questions ? weightedTokens / questions : 0,
  token_budget: tokenBudget,
  packs_over_budget: overBudget,
  by_category: Object.fromEntries(Object.entries(category).map(([name, stats]) => [
    name,
    {
      questions: stats.questions,
      evidence_hit: stats.hits / stats.questions,
      evidence_all: stats.all_hits / stats.questions,
    },
  ])),
};
result.gates = {
  complete_dataset: result.questions === expectedQuestions,
  score_at_least_95: result.evidence_hit >= .95,
  compiled_score_at_least_95: result.compiled_evidence_hit >= .95,
  one_hundred_percent_retention: result.retrieved_hit_retention === 1,
  no_context_over_budget: result.packs_over_budget === 0 && result.mean_context_tokens <= tokenBudget,
  all_categories_present: ['1', '2', '3', '4'].every((name) => result.by_category[name]?.questions > 0),
};
result.passed = Object.values(result.gates).every(Boolean);

if (outputIndex >= 0) {
  const outputPath = path.resolve(args[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
