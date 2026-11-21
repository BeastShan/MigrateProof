# Limitations

- The rule engine inspects PostgreSQL 17 parse trees. It does not infer dynamic SQL, permissions, cross-file dependencies, implicit application contracts, or every table rewrite. Parsed syntax can still fail during execution.
- The executable lab runs six repository-owned scenario manifests. Custom SQL can be analyzed, and teams can add reviewed fixture scenarios in source. The current release has no general-purpose remote migration upload, repository discovery, or plugin runner.
- Fixtures use a single PostgreSQL 17 image and a transaction wrapper. Some production operations, including concurrent index builds, require a different transaction strategy.
- The correction for a column rename verifies legacy reads and writes and new reads. A generated alias is read-only and may have table rewrite and storage costs.
- The demonstration backfills run on tiny fixtures. Production concurrency, batching, deployment order, uniqueness policy, replication effects, and crash recovery remain unverified.
- The performance demonstration samples actual plans, buffers and execution time for a selective lookup. PostgreSQL planner decisions and timings depend on data, configuration, caching, and hardware.
- Reports are local files with a 1 MiB size limit per report. The dashboard lists the latest 100 saved runs. Multi-user authentication, report signing, retention policies and team approval tracking are outside this prototype.
- The local PostgreSQL boundary requires Linux Docker with its daemon on the same host filesystem. Engine operators and privileged host users can access containers.
- The Devin adapter stays disabled until authentication, permissions, approval persistence, cancellation and session budget enforcement are implemented and verified.
