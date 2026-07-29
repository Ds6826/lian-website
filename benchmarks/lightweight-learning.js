const { performance } = require('node:perf_hooks');
const { rerankRecall, validateExperience, validateOutcome } = require('../experience-learning');
const { compileContext } = require('../context-compiler');

const cases = [];
const add = (name, category, run) => cases.push({ name, category, run });

const completed = (reward, ids) => ({ status: 'completed', reward, context_memory_ids: ids });

add('positive outcomes break equal-relevance ties', 'outcome_learning', () => {
  const result = rerankRecall(
    { memories: [{ id: 'unhelpful', score: .8 }, { id: 'helpful', score: .8 }] },
    [completed(-1, ['unhelpful']), completed(1, ['helpful']), completed(1, ['helpful'])]
  );
  return result.memories[0].id === 'helpful';
});

add('negative outcomes demote repeated mistakes', 'outcome_learning', () => {
  const result = rerankRecall(
    { memories: [{ id: 'mistake', score: .82 }, { id: 'neutral', score: .8 }] },
    [completed(-1, ['mistake']), completed(-.8, ['mistake']), completed(-1, ['mistake'])]
  );
  return result.memories[0].id === 'neutral';
});

add('cold-start ordering is unchanged', 'stability', () => {
  const result = rerankRecall({ memories: [{ id: 'a', score: .91 }, { id: 'b', score: .72 }, { id: 'c', score: .4 }] }, []);
  return result.memories.map((item) => item.id).join(',') === 'a,b,c' &&
    result.memories.every((item) => item.score === item.base_score);
});

add('strong relevance survives misleading experience', 'negative_transfer', () => {
  const result = rerankRecall(
    { memories: [{ id: 'correct', score: .92 }, { id: 'popular-but-wrong', score: .74 }] },
    Array.from({ length: 10 }, () => completed(1, ['popular-but-wrong']))
  );
  return result.memories[0].id === 'correct';
});

add('bad experience cannot erase an otherwise valid candidate', 'negative_transfer', () => {
  const result = rerankRecall(
    { memories: [{ id: 'm1', score: .95 }] },
    Array.from({ length: 10 }, () => completed(-1, ['m1']))
  );
  return result.memories.length === 1 && result.memories[0].score > 0;
});

add('open experiences never influence ranking', 'governance', () => {
  const result = rerankRecall(
    { memories: [{ id: 'a', score: .8 }, { id: 'b', score: .8 }] },
    [{ status: 'open', reward: 1, context_memory_ids: ['b'] }]
  );
  return result.memories[0].id === 'a' && result.learning_applied === false;
});

add('learning metadata explains every changed score', 'auditability', () => {
  const result = rerankRecall(
    { memories: [{ id: 'a', score: .8 }] },
    [completed(.8, ['a'])]
  );
  const learning = result.memories[0].learning;
  return result.memories[0].base_score === .8 &&
    learning.completed_uses === 1 &&
    learning.successful_uses === 1 &&
    Number.isFinite(learning.average_reward) &&
    result.ranking_policy === 'relevance-plus-observed-outcomes-v1';
});

add('empty retrieval correctly abstains', 'abstention', () => {
  const result = rerankRecall({ memories: [] }, [completed(1, ['missing'])]);
  return result.memories.length === 0;
});

add('invalid rewards are rejected', 'input_safety', () =>
  validateOutcome({ outcome: { success: true }, reward: 1.1 }).error === 'reward must be a number between -1 and 1.');

add('unattributed decisions are rejected', 'input_safety', () =>
  validateExperience({ agent_id: 'a', task: 'task', decision: { action: 'x' }, context_memory_ids: [] }).error ===
  'context_memory_ids must contain at least one memory id.');

const syntheticRankingTrials = 500;
add('synthetic outcome signal improves pairwise ranking', 'outcome_learning', () => {
  let correct = 0;
  for (let index = 0; index < syntheticRankingTrials; index++) {
    const base = .55 + (index % 30) / 100;
    const helpful = `helpful-${index}`;
    const harmful = `harmful-${index}`;
    const result = rerankRecall(
      { memories: [{ id: harmful, score: base }, { id: helpful, score: base }] },
      [completed(-.8, [harmful]), completed(.8, [helpful]), completed(.9, [helpful])]
    );
    if (result.memories[0].id === helpful) correct++;
  }
  return correct / syntheticRankingTrials >= .99;
});

const capacityMemories = 1000;
const capacityExperiences = 5000;
add('reranks 1k memories against 5k experiences under 150ms', 'efficiency', () => {
  const memories = Array.from({ length: capacityMemories }, (_, index) => ({
    id: `memory-${index}`,
    score: 1 - index / (capacityMemories * 1.1),
  }));
  const experiences = Array.from({ length: capacityExperiences }, (_, index) =>
    completed((index % 9 - 4) / 4, [`memory-${index % capacityMemories}`]));
  const before = performance.now();
  const result = rerankRecall({ memories }, experiences);
  const duration = performance.now() - before;
  return result.memories.length === capacityMemories &&
    result.memories.every((memory) => memory.score >= 0 && memory.score <= 1) &&
    duration < 150;
});

add('compiles a bounded context pack from 1k candidates under 150ms', 'efficiency', () => {
  const memories = Array.from({ length: capacityMemories }, (_, index) => ({
    id: `context-memory-${index}`,
    content: `Validated workflow observation ${index}: use policy revision ${index % 12}.`,
    score: 1 - index / (capacityMemories * 1.1),
    event_time: `2026-07-${String(index % 28 + 1).padStart(2, '0')}`,
  }));
  const before = performance.now();
  const result = compileContext({ recallResult: { memories }, maxItems: 8, maxTokens: 1000 });
  const duration = performance.now() - before;
  return result.memories.length === 8 &&
    result.budget.estimated_tokens <= 1000 &&
    result.provenance.total_candidates === capacityMemories &&
    duration < 150;
});

const timings = [];
const started = performance.now();
const results = cases.map((benchmark) => {
  const before = performance.now();
  let passed = false;
  let error = null;
  try { passed = Boolean(benchmark.run()); } catch (caught) { error = caught.message; }
  timings.push(performance.now() - before);
  return { name: benchmark.name, category: benchmark.category, passed, error };
});
const elapsedMs = performance.now() - started;

const sorted = [...timings].sort((a, b) => a - b);
const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
const passed = results.filter((result) => result.passed).length;
const report = {
  suite: 'lians-lightweight-learning-v1',
  generated_at: new Date().toISOString(),
  runtime: 'deterministic-js-no-model-no-embeddings',
  cases: results.length,
  passed,
  failed: results.length - passed,
  pass_rate: Number((passed / results.length).toFixed(4)),
  synthetic_pairwise_trials: syntheticRankingTrials,
  capacity_fixture: { memories: capacityMemories, experiences: capacityExperiences },
  elapsed_ms: Number(elapsedMs.toFixed(3)),
  p50_case_ms: Number(percentile(.5).toFixed(3)),
  p95_case_ms: Number(percentile(.95).toFixed(3)),
  results,
};

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  console.log(`\n${report.suite}`);
  console.log(`${'─'.repeat(72)}`);
  for (const result of results) console.log(`${result.passed ? 'PASS' : 'FAIL'}  ${result.category.padEnd(18)} ${result.name}${result.error ? ` (${result.error})` : ''}`);
  console.log(`${'─'.repeat(72)}`);
  console.log(`${passed}/${results.length} passed · ${report.elapsed_ms}ms total · p95 ${report.p95_case_ms}ms · no model/GPU`);
}

if (report.failed) process.exitCode = 1;
