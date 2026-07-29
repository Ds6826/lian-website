# Lightweight benchmarks

These benchmarks exercise Lians learning, safety, and ranking behavior without
running a language model, embedding model, vector database, or LLM judge.

Run:

```bash
npm run benchmark:light
```

Machine-readable output:

```bash
node benchmarks/lightweight-learning.js --json
```

## `lians-lightweight-learning-v1`

The suite currently measures:

- positive outcome lift for equally relevant memories;
- demotion of memories associated with repeated failures;
- cold-start stability when no outcomes exist;
- resistance to negative transfer from popular but less relevant experience;
- preservation of candidates even after poor outcomes;
- exclusion of incomplete experiences from learning;
- inspectable score provenance;
- abstention on empty retrieval;
- validation of bounded rewards and attributed decisions;
- pairwise ranking over 500 deterministic synthetic trials; and
- CPU-only reranking of 1,000 memories against 5,000 completed experiences.
- token-budgeted context compilation from 1,000 recall candidates.

## Baseline run

Run on 2026-07-28:

```text
13 / 13 passed
500 synthetic pairwise trials
1,000-memory / 5,000-experience capacity fixture passed
44.262 ms total
23.468 ms p95 case time
No model or GPU
```

Timing is diagnostic rather than a cross-machine performance guarantee. CI
should treat pass/fail invariants as blocking and retain latency as a trend.

## Relationship to public benchmarks

This is not presented as a substitute for LongMemEval, LoCoMo, MemBench, or
MemoryAgentBench. It is the inexpensive inner loop for every commit. Public
dataset runs remain the outer loop for release candidates.

A practical schedule is:

- every commit: `lians-lightweight-learning-v1`;
- nightly: retrieval-only public benchmark subsets without answer generation;
- release candidate: full public benchmark and fixed-model answer evaluation;
- major release: multi-system comparison under equal model and token budgets.

## LoCoMo context-pack benchmark

`locomo-context.js` measures query expansion, weighted reciprocal-rank fusion,
and whether the context compiler preserves LoCoMo's gold evidence while
reducing retrieval to a bounded agent context. It uses deterministic lexical
retrieval, no model, no embeddings, and no judge. Outcome learning is
deliberately disabled because LoCoMo does not provide a leakage-safe prior
outcome log.

Run the full dataset:

```bash
node benchmarks/locomo-context.js --questions 5000 --conversations 10 \
  --k 20 --max-items 16 --max-tokens 1200 \
  --out results/locomo-context-full.json --json
```

Optimized full run on 2026-07-28 (1,536 questions):

```text
raw evidence_hit@20:       55.08%
compiled evidence hit:     55.08%
retrieved-hit retention:   100.00%
raw evidence_all@20:       45.96%
compiled evidence all:     45.96%
mean compiled context:     19.88 items / 759.14 estimated tokens
packs over 1,200 tokens:   0
elapsed:                   5.82 seconds
```

The compiler preserves 100% of the evidence found by the raw retriever. This
result evaluates context packing, not end-to-end answer accuracy: the lexical
retriever itself finds gold evidence for 55.08% of questions.

The hybrid query/fusion/adjacent-dialogue pass improves the same lexical
control from 55.08% to 55.60% hit@20, including temporal retrieval from 58.26%
to 59.50%, while retaining 100% of its hits in the compiled context. The
production semantic engine must be used for publishable retrieval accuracy;
this deterministic proxy is an inexpensive regression gate.

## Leakage-free semantic LoCoMo gate

The release gate uses semantic top-200 retrieval from the canonical Lians
engine, a frozen reranker (`base=1`, `lexical=0`, `neighbor=0.1`), attributed
radius-2 dialogue bundles, and the top-50 fair-share context compiler. Gold
evidence IDs and answers are used only after retrieval for scoring; they never
enter retrieval, ranking, bundling, or compilation.

Verified on 2026-07-28 across all 1,536 answerable LoCoMo questions:

```text
overall evidence_hit:       97.53% (1,498 / 1,536)
compiled evidence_hit:      97.53% (1,498 / 1,536)
retrieved-hit retention:   100.00%
mean compiled context:    1,084.26 estimated tokens
configured token budget:  1,200 estimated tokens
packs over budget:            0
strict verifier:            PASS
```

This is a judge-free retrieval and context-compilation result, not an
end-to-end answer-accuracy claim. Category evidence-hit rates are 96.45%
multi-hop, 97.82% temporal, 89.13% open-domain, and 98.69% single-hop.

From PowerShell in the website repository, reproduce the strict aggregation
over the ten frozen per-conversation reports with:

```powershell
$reports = Get-ChildItem results -Filter 'semantic-rerank-*-r2.json' |
  Sort-Object Name |
  ForEach-Object { $_.FullName }
node benchmarks\verify-goal95.js --reports @reports --out results\goal95-final.json
```

The verifier requires exactly 1,536 questions, all four answerable categories,
the frozen reranker configuration, at least 95% raw and compiled evidence hit,
100% retrieved-hit retention, and no context pack over 1,200 estimated tokens.
