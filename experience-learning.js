const crypto = require('node:crypto');
const { neon } = require('@neondatabase/serverless');

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const cleanText = (value, max = 2000) => String(value || '').trim().slice(0, max);
const normalizeTask = (value) => cleanText(value, 300).toLowerCase().replace(/\s+/g, ' ');
const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const asIds = (value, max = 100) => [...new Set((Array.isArray(value) ? value : []).map((id) => cleanText(id, 200)).filter(Boolean))].slice(0, max);

const validateExperience = (body) => {
  const agentId = cleanText(body?.agent_id, 200);
  const task = cleanText(body?.task, 1000);
  const decision = asObject(body?.decision);
  const contextMemoryIds = asIds(body?.context_memory_ids);
  if (!agentId) return { error: 'agent_id is required.' };
  if (!task) return { error: 'task is required.' };
  if (!Object.keys(decision).length) return { error: 'decision must be a non-empty object.' };
  if (!contextMemoryIds.length) return { error: 'context_memory_ids must contain at least one memory id.' };
  return { ok: true, value: { agentId, task, decision, contextMemoryIds, metadata: asObject(body?.metadata) } };
};

const validateOutcome = (body) => {
  const outcome = asObject(body?.outcome);
  const reward = Number(body?.reward);
  if (!Object.keys(outcome).length) return { error: 'outcome must be a non-empty object.' };
  if (!Number.isFinite(reward) || reward < -1 || reward > 1) return { error: 'reward must be a number between -1 and 1.' };
  return { ok: true, value: { outcome, reward, reviewerFeedback: cleanText(body?.reviewer_feedback, 4000) || null } };
};

const learningStats = (experiences) => {
  const byMemory = new Map();
  for (const experience of experiences) {
    if (experience.status !== 'completed' || !Number.isFinite(Number(experience.reward))) continue;
    for (const memoryId of asIds(experience.context_memory_ids)) {
      const current = byMemory.get(memoryId) || { count: 0, rewardSum: 0, positive: 0, negative: 0 };
      const reward = Number(experience.reward);
      current.count += 1;
      current.rewardSum += reward;
      if (reward > 0) current.positive += 1;
      if (reward < 0) current.negative += 1;
      byMemory.set(memoryId, current);
    }
  }
  return byMemory;
};

const rerankRecall = (recallResult, experiences = []) => {
  const memories = Array.isArray(recallResult?.memories) ? recallResult.memories : [];
  const stats = learningStats(experiences);
  const reranked = memories.map((memory, index) => {
    const baseScore = clamp(Number(memory.score ?? memory.relevance_score ?? (1 - index / Math.max(memories.length, 1))), 0, 1);
    const signal = stats.get(String(memory.id)) || { count: 0, rewardSum: 0, positive: 0, negative: 0 };
    const averageReward = signal.count ? signal.rewardSum / signal.count : 0;
    const confidence = Math.min(1, Math.log2(signal.count + 1) / 3);
    const support = Math.min(signal.count, 10) / 10;
    const learnedScore = signal.count
      ? baseScore + averageReward * confidence * .12 + Math.sign(averageReward) * support * .02
      : baseScore;
    return {
      ...memory,
      base_score: Number(baseScore.toFixed(6)),
      score: Number(clamp(learnedScore, 0, 1).toFixed(6)),
      learning: {
        completed_uses: signal.count,
        successful_uses: signal.positive,
        unsuccessful_uses: signal.negative,
        average_reward: Number(averageReward.toFixed(6)),
        confidence: Number(confidence.toFixed(6)),
      },
    };
  }).sort((a, b) => b.score - a.score);
  return { ...recallResult, memories: reranked, learning_applied: experiences.some((item) => item.status === 'completed'), ranking_policy: 'relevance-plus-observed-outcomes-v1' };
};

const createExperienceLearningService = ({ env = process.env, sql: injectedSql } = {}) => {
  const sql = injectedSql || (env.DATABASE_URL ? neon(env.DATABASE_URL) : null);
  let schemaReady;
  const configured = () => Boolean(sql);
  const ensureSchema = () => {
    if (!sql) throw new Error('DATABASE_URL is not configured.');
    if (!schemaReady) schemaReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS agent_experiences (
        id uuid PRIMARY KEY,
        namespace text NOT NULL,
        agent_id text NOT NULL,
        task text NOT NULL,
        task_key text NOT NULL,
        decision jsonb NOT NULL,
        context_memory_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        outcome jsonb,
        reward double precision,
        reviewer_feedback text,
        status text NOT NULL DEFAULT 'open',
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz
      )`;
      await sql`CREATE INDEX IF NOT EXISTS agent_experiences_namespace_agent_idx
        ON agent_experiences (namespace, agent_id, created_at DESC)`;
      await sql`CREATE TABLE IF NOT EXISTS reflection_proposals (
        id uuid PRIMARY KEY,
        namespace text NOT NULL,
        agent_id text NOT NULL,
        task_key text NOT NULL,
        content text NOT NULL,
        supporting_experience_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        confidence double precision NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        reviewer_note text,
        promoted_memory_id text,
        created_at timestamptz NOT NULL DEFAULT now(),
        reviewed_at timestamptz
      )`;
      await sql`ALTER TABLE reflection_proposals ADD COLUMN IF NOT EXISTS promoted_memory_id text`;
      await sql`CREATE INDEX IF NOT EXISTS reflection_proposals_namespace_status_idx
        ON reflection_proposals (namespace, status, created_at DESC)`;
    })();
    return schemaReady;
  };

  const createExperience = async (namespace, body, id = crypto.randomUUID()) => {
    const validation = validateExperience(body);
    if (!validation.ok) { const error = new Error(validation.error); error.status = 400; throw error; }
    await ensureSchema();
    const { agentId, task, decision, contextMemoryIds, metadata } = validation.value;
    const rows = await sql`
      INSERT INTO agent_experiences (id, namespace, agent_id, task, task_key, decision, context_memory_ids, metadata)
      VALUES (${id}, ${namespace}, ${agentId}, ${task}, ${normalizeTask(task)}, ${JSON.stringify(decision)}::jsonb, ${JSON.stringify(contextMemoryIds)}::jsonb, ${JSON.stringify(metadata)}::jsonb)
      RETURNING *
    `;
    return rows[0];
  };

  const recordOutcome = async (namespace, id, body) => {
    const validation = validateOutcome(body);
    if (!validation.ok) { const error = new Error(validation.error); error.status = 400; throw error; }
    await ensureSchema();
    const { outcome, reward, reviewerFeedback } = validation.value;
    const rows = await sql`
      UPDATE agent_experiences
      SET outcome = ${JSON.stringify(outcome)}::jsonb, reward = ${reward}, reviewer_feedback = ${reviewerFeedback},
          status = 'completed', completed_at = now()
      WHERE id = ${id} AND namespace = ${namespace} AND status = 'open'
      RETURNING *
    `;
    if (!rows.length) { const error = new Error('Open experience not found.'); error.status = 404; throw error; }
    return rows[0];
  };

  const listExperiences = async (namespace, { agentId, status, limit = 100 } = {}) => {
    await ensureSchema();
    const bounded = clamp(Number(limit) || 100, 1, 500);
    if (agentId && status) return sql`SELECT * FROM agent_experiences WHERE namespace = ${namespace} AND agent_id = ${agentId} AND status = ${status} ORDER BY created_at DESC LIMIT ${bounded}`;
    if (agentId) return sql`SELECT * FROM agent_experiences WHERE namespace = ${namespace} AND agent_id = ${agentId} ORDER BY created_at DESC LIMIT ${bounded}`;
    if (status) return sql`SELECT * FROM agent_experiences WHERE namespace = ${namespace} AND status = ${status} ORDER BY created_at DESC LIMIT ${bounded}`;
    return sql`SELECT * FROM agent_experiences WHERE namespace = ${namespace} ORDER BY created_at DESC LIMIT ${bounded}`;
  };

  const createReflectionProposals = async (namespace, agentId) => {
    const experiences = await listExperiences(namespace, { agentId, status: 'completed', limit: 500 });
    const groups = new Map();
    for (const experience of experiences) {
      if (Number(experience.reward) < .6) continue;
      const group = groups.get(experience.task_key) || [];
      group.push(experience);
      groups.set(experience.task_key, group);
    }
    const created = [];
    for (const [taskKey, support] of groups) {
      if (support.length < 2) continue;
      const average = support.reduce((sum, item) => sum + Number(item.reward), 0) / support.length;
      const ids = support.slice(0, 20).map((item) => item.id);
      const content = `For “${support[0].task}”, ${support.length} completed experiences produced positive outcomes. Prefer the validated context patterns from these decisions, subject to current policy and source validity.`;
      const id = crypto.randomUUID();
      const existing = await sql`SELECT id FROM reflection_proposals WHERE namespace = ${namespace} AND agent_id = ${agentId} AND task_key = ${taskKey} AND status = 'pending' LIMIT 1`;
      if (existing.length) continue;
      const rows = await sql`
        INSERT INTO reflection_proposals (id, namespace, agent_id, task_key, content, supporting_experience_ids, confidence)
        VALUES (${id}, ${namespace}, ${agentId}, ${taskKey}, ${content}, ${JSON.stringify(ids)}::jsonb, ${clamp(average, 0, 1)})
        RETURNING *
      `;
      created.push(rows[0]);
    }
    return created;
  };

  const listReflectionProposals = async (namespace, status = 'pending') => {
    await ensureSchema();
    return sql`SELECT * FROM reflection_proposals WHERE namespace = ${namespace} AND status = ${status} ORDER BY created_at DESC LIMIT 200`;
  };

  const getReflectionProposal = async (namespace, id, status = 'pending') => {
    await ensureSchema();
    const rows = await sql`SELECT * FROM reflection_proposals WHERE id = ${id} AND namespace = ${namespace} AND status = ${status} LIMIT 1`;
    if (!rows.length) { const error = new Error(`${status[0].toUpperCase()}${status.slice(1)} reflection proposal not found.`); error.status = 404; throw error; }
    return rows[0];
  };

  const reviewReflectionProposal = async (namespace, id, action, note, promotedMemoryId = null) => {
    if (!['approve', 'reject'].includes(action)) { const error = new Error('Action must be approve or reject.'); error.status = 400; throw error; }
    await ensureSchema();
    const rows = await sql`
      UPDATE reflection_proposals
      SET status = ${action === 'approve' ? 'approved' : 'rejected'}, reviewer_note = ${cleanText(note, 2000) || null},
          promoted_memory_id = ${promotedMemoryId}, reviewed_at = now()
      WHERE id = ${id} AND namespace = ${namespace} AND status = 'pending'
      RETURNING *
    `;
    if (!rows.length) { const error = new Error('Pending reflection proposal not found.'); error.status = 404; throw error; }
    return rows[0];
  };

  return { configured, ensureSchema, createExperience, recordOutcome, listExperiences, createReflectionProposals, listReflectionProposals, getReflectionProposal, reviewReflectionProposal };
};

module.exports = { createExperienceLearningService, learningStats, rerankRecall, validateExperience, validateOutcome };
