const test = require('node:test');
const assert = require('node:assert/strict');
const { generateQueryVariants, reciprocalRankFusion, hybridRecall } = require('../hybrid-retrieval');

test('query expansion adds temporal and complete-history retrieval cues', () => {
  const variants = generateQueryVariants('When did Melanie do all her outdoor activities?');
  assert.equal(variants[0], 'When did Melanie do all her outdoor activities?');
  assert.ok(variants.some((query) => query.includes('date time chronology')));
  assert.ok(variants.some((query) => query.includes('complete history examples')));
  assert.ok(variants.length <= 4);
});

test('reciprocal-rank fusion rewards evidence supported by multiple queries', () => {
  const memories = reciprocalRankFusion([
    { query: 'original', result: { memories: [{ id: 'a', score: .8 }, { id: 'b', score: .9 }] } },
    { query: 'expanded', result: { memories: [{ id: 'b', score: .7 }, { id: 'c', score: 1 }] } },
  ]);
  assert.equal(memories[0].id, 'b');
  assert.equal(memories[0].retrieval.query_support, 2);
  assert.equal(memories[0].retrieval.policy, 'weighted-rrf-plus-base-score-v1');
});

test('hybrid recall tolerates a failed expansion when another query succeeds', async () => {
  const calls = [];
  const result = await hybridRecall({
    agentId: 'agent',
    query: 'When did Maria volunteer?',
    maxVariants: 3,
    recall: async ({ query }) => {
      calls.push(query);
      if (query.includes('date time')) throw new Error('temporary failure');
      return { memories: [{ id: query === calls[0] ? 'original' : 'shared', content: query, score: .8 }] };
    },
  });
  assert.ok(calls.length > 1);
  assert.equal(result.successful_queries, calls.length - 1);
  assert.equal(result.failed_queries, 1);
  assert.equal(result.retrieval_policy, 'multi-query-weighted-rrf-v1');
});

test('fusion assembles adjacent dialogue evidence without exceeding k', () => {
  const ranked = Array.from({ length: 8 }, (_, index) => ({
    id: index === 7 ? 'D1:2' : `D${index + 2}:1`,
    score: 1 - index / 10,
  }));
  ranked[0].id = 'D1:1';
  const result = reciprocalRankFusion([{ query: 'q', result: { memories: ranked } }], { limit: 5 });
  assert.equal(result.length, 5);
  assert.ok(result.some((memory) => memory.id === 'D1:2'));
  assert.equal(result.find((memory) => memory.id === 'D1:2').retrieval.dialogue_neighbor_of, 'D1:1');
});
