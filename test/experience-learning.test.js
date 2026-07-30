const test = require('node:test');
const assert = require('node:assert/strict');
const { learningStats, rerankRecall, validateExperience, validateOutcome } = require('../experience-learning');

test('experience validation requires an agent, task, decision, and recalled memory ids', () => {
  assert.equal(validateExperience({}).error, 'agent_id is required.');
  assert.equal(validateExperience({ agent_id: 'agent', task: 'answer', decision: {}, context_memory_ids: ['m1'] }).error, 'decision must be a non-empty object.');
  assert.deepEqual(validateExperience({
    agent_id: 'agent',
    task: 'Answer a support question',
    decision: { answer: 'Restart the worker' },
    context_memory_ids: ['m1', 'm1', 'm2'],
  }).value.contextMemoryIds, ['m1', 'm2']);
});

test('outcome validation accepts bounded rewards and rejects unmeasurable outcomes', () => {
  assert.equal(validateOutcome({ outcome: { accepted: true }, reward: .8 }).ok, true);
  assert.equal(validateOutcome({ outcome: {}, reward: .8 }).error, 'outcome must be a non-empty object.');
  assert.equal(validateOutcome({ outcome: { accepted: false }, reward: 2 }).error, 'reward must be a number between -1 and 1.');
});

test('learning stats aggregate positive and negative outcomes by contributing memory', () => {
  const stats = learningStats([
    { status: 'completed', reward: 1, context_memory_ids: ['m1', 'm2'] },
    { status: 'completed', reward: -.5, context_memory_ids: ['m1'] },
    { status: 'open', reward: 1, context_memory_ids: ['m1'] },
  ]);
  assert.deepEqual(stats.get('m1'), { count: 2, rewardSum: .5, positive: 1, negative: 1 });
  assert.deepEqual(stats.get('m2'), { count: 1, rewardSum: 1, positive: 1, negative: 0 });
});

test('adaptive recall reranks equal-relevance memories using observed outcomes', () => {
  const recalled = { memories: [{ id: 'bad', score: .8 }, { id: 'good', score: .8 }] };
  const experiences = [
    { status: 'completed', reward: -1, context_memory_ids: ['bad'] },
    { status: 'completed', reward: 1, context_memory_ids: ['good'] },
    { status: 'completed', reward: 1, context_memory_ids: ['good'] },
  ];
  const result = rerankRecall(recalled, experiences);
  assert.equal(result.memories[0].id, 'good');
  assert.equal(result.learning_applied, true);
  assert.equal(result.ranking_policy, 'relevance-plus-observed-outcomes-v1');
  assert.deepEqual(result.memories[0].learning, {
    completed_uses: 2,
    successful_uses: 2,
    unsuccessful_uses: 0,
    average_reward: 1,
    confidence: 0.528321,
  });
});

test('adaptive recall preserves base ordering when no outcomes exist', () => {
  const result = rerankRecall({ memories: [{ id: 'a', score: .9 }, { id: 'b', score: .4 }] }, []);
  assert.deepEqual(result.memories.map((memory) => memory.id), ['a', 'b']);
  assert.equal(result.learning_applied, false);
});
