# Governed experience learning

This backend-only feature lets an agent learn from observed outcomes without
silently rewriting its memory or retraining its underlying model.

## Lifecycle

1. The agent recalls memory and makes a decision.
2. The caller records an experience containing the task, decision, and exact
   memory IDs used.
3. When the real-world result is known, the caller completes the experience
   with a structured outcome, a reward from `-1` to `1`, and optional reviewer
   feedback.
4. Adaptive recall combines semantic relevance with historical outcome signals.
   Memories with no outcome history keep their original relevance score.
5. Successful repeated experiences can generate reflection proposals.
6. A proposal affects agent memory only after explicit approval. Approval writes
   the proposal to the Lians engine with its supporting experience IDs,
   confidence, and proposal ID as provenance metadata.

## Authenticated API

All routes require an authenticated, onboarded console user and remain isolated
to that user's Lians namespace.

### Record a decision experience

`POST /api/console/experiences`

```json
{
  "agent_id": "support-agent",
  "task": "Resolve a refund request",
  "context_memory_ids": ["mem_12", "mem_44"],
  "decision": {
    "action": "approve_refund",
    "amount": 49
  },
  "metadata": {
    "conversation_id": "conv_8"
  }
}
```

### Attach the observed outcome

`PATCH /api/console/experiences/:id/outcome`

```json
{
  "outcome": {
    "accepted": true,
    "customer_recontacted": false
  },
  "reward": 0.9,
  "reviewer_feedback": "Correct policy application."
}
```

### Recall using outcome evidence

`POST /api/console/adaptive-recall`

```json
{
  "agent_id": "support-agent",
  "query": "How should this refund be handled?",
  "k": 10,
  "as_of": "2026-07-28T12:00:00Z"
}
```

The response preserves each memory's `base_score` and adds an inspectable
`learning` object with completed uses, positive and negative uses, average
reward, and confidence. The current ranking policy is
`relevance-plus-observed-outcomes-v1`.

### Compile agent-ready context

`POST /api/console/context`

```json
{
  "agent_id": "support-agent",
  "query": "What context should guide this refund decision?",
  "as_of": "2026-07-28T12:00:00Z",
  "max_items": 50,
  "max_tokens": 2000,
  "minimum_score": 0.2
}
```

This endpoint performs recall, applies observed outcome signals, removes exact
duplicates, excludes memories associated with repeated harmful outcomes, and
returns a delimited `context_text` plus structured provenance. It enforces item
and estimated-token budgets so the caller can pass the result directly into an
agent without building its own memory orchestration layer.

The context header explicitly marks recalled content as reference data rather
than executable instructions. This reduces—but does not eliminate—the need for
the consuming agent to apply its own prompt-injection and policy controls.

Both `/api/console/context` and `/api/console/adaptive-recall` use one semantic
query plus attributed adjacent-turn bundles by default. This held out better
than generic query expansion on LoCoMo. Set `"query_expansion": true` (or
`"hybrid": true`) to issue up to four bounded variants: the original question,
a keyword form, and applicable temporal, complete-history, inferential, or
clause variants. Those results are deduplicated and merged with weighted
reciprocal-rank fusion. Outcome reranking and context packing run afterward.
`max_query_variants` is bounded to six and `per_query_k` to two hundred. The
larger candidate funnel is reranked into the same bounded final context; it
does not increase the configured prompt budget.

### Governed reflections

- `POST /api/console/reflections/generate` with `{"agent_id":"support-agent"}`
- `GET /api/console/reflections?status=pending`
- `PATCH /api/console/reflections/:id` with
  `{"action":"approve","note":"Reviewed against policy v6."}`

Reflection generation currently requires at least two completed experiences
with rewards of `0.6` or greater for the same normalized task. It never writes
directly to memory. Only the approval route promotes the proposed lesson.

## Storage

Apply `migrations/002_agent_experiences.sql` to the database referenced by
`DATABASE_URL`. The service also creates or upgrades its schema on first use.

This feature additionally requires `LIANS_API_URL` and `LIANS_ADMIN_SECRET` for
adaptive recall and approved-reflection promotion.
