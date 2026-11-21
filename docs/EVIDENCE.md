# Rehearsal evidence

These reports record actual runs on PostgreSQL 17.12 with the pinned Docker image, Node.js 24.22.3, and deterministic synthetic data. An expected failure can coexist with a passing fixture verification. Every report requires human review.

| Scenario | Confirmed observation | Captured report |
| --- | --- | --- |
| Breaking column rename | Legacy read failed with `42703`. The generated alias preserved legacy writes and exposed new reads. | [Report](../evidence/reports/817d4ed2-65c2-4734-99eb-89597b8b86db.json) |
| Unsafe NOT NULL constraint | DDL failed with `23502`. IDs 2 and 3 were backfilled, and the corrected constraint rejected a new null. | [Report](../evidence/reports/363e2243-85e0-4d06-b83a-9cd2ebb7589b.json) |
| Unique constraint conflict | DDL failed with `23505`. The report identifies alias `alpha` on IDs 1 and 2 and verifies the corrected constraint. | [Report](../evidence/reports/b3ad0c7b-4c40-4b03-993c-0e898af43211.json) |
| Query performance regression | The selective query changed from an index scan to a sequential scan. The replacement gave an index-only scan. | [Report](../evidence/reports/a88aaa77-b78d-4640-a719-67ca0ca42f37.json) |
| Migration lock contention | The observer confirmed one relation blocker. PostgreSQL returned `55P03` after about 754 ms wall time. The migration rolled back, and the retry committed after release. | [Report](../evidence/reports/f4ee1225-6b5f-43a8-bc1d-1af36b1cb4d7.json) |
| Irreversible column drop | The drop committed. The rows remained, but the previously populated column was inaccessible with `42703`. Recovery review is required. | [Report](../evidence/reports/bcac4a24-00d9-4657-9470-ebd0fc88692e.json) |

## Measured query plans

One run of the 75,000-row performance fixture recorded the following root plans and execution times. Shared blocks are the sum of the root plan’s shared buffer hits and reads. Timing depends on the host and cache state and is excluded from the pass criterion.

| Phase | Plan | Shared blocks | PostgreSQL execution time |
| --- | --- | ---: | ---: |
| Baseline | Index Scan | 3 | 0.017 ms |
| Proposed drop | Seq Scan | 1,830 | 5.138 ms |
| Replacement index | Index Only Scan | 3 | 0.039 ms |

## Dashboard captures

[Migration inventory and history](../evidence/screenshots/dashboard.png) · [Performance report](../evidence/screenshots/performance.png)

Playwright captured the production-built Next.js dashboard reading the six saved reports through the Fastify API.

## Local verification

The locked dependencies installed with npm 11.19.1. The PostgreSQL startup and cleanup probe, TypeScript checks, and Next.js production build succeeded. The final per-suite totals were 38 unit tests, 15 real PostgreSQL integration tests and 4 Playwright browser tests, all passing. The scenario CLI matched 6 of 6 fixture expectations. The browser suite checked report downloads, task provenance, error handling and narrow-screen layout.

## Reproduce

After installing the prerequisites in the [README](../README.md), run:

```sh
npm run lab -- verify
npm run --silent lab -- report RUN_ID > report.json
npm run --silent lab -- task RUN_ID > engineering-task.json
```

Each new run creates a different UUID. Compare the SQLSTATEs, catalog changes, result rows and plan shape against the preserved reports. Timing and transient diagnostics can vary. The baseline hash is SHA-256 over the UTF-8 schema SQL, a NUL separator, and the fixture seed SQL. The migration hashes cover the raw UTF-8 proposal and correction files.
