# MigrateProof

MigrateProof is an automated PostgreSQL migration safety lab. It uses six reproducible synthetic scenarios to identify failure modes, verify scoped corrections, and produce evidence for human review.

- Analyze PostgreSQL migration files with rule-based static analysis.
- Rehearse bundled SQL in a new PostgreSQL container with networking disabled for every run.
- Compare schema catalogs, application-query results, and integrity checks before and after each migration.
- Review actual SQLSTATEs, blocker diagnostics, and JSON query plans in a Next.js dashboard backed by Fastify.
- Export pinned investigation tasks for a future Devin integration.

A clean static analysis result or a passing fixture verification provides no production safety guarantee. Human approval is required before a migration can be merged or deployed.

## Quick start

Use Node.js 24 LTS, npm, and a local Linux Docker Engine reachable at `/var/run/docker.sock`. Run these commands from the project root. A Linux VM with a local Docker daemon is suitable for developers on other platforms.

```sh
npm ci
docker pull postgres:17-bookworm@sha256:837bed18782820fe967067cb5328b02b0d9992c1be9a37ee0c9c492cfc03af3b
npm run lab -- init
npm run lab -- verify
```

Unset inherited database connection settings before running the lab. The command output includes each run ID and JSON report path.

Start the Fastify API with `npm run api` in one terminal. Run `npm run dev` in another and open [the local dashboard](http://127.0.0.1:3000). The API listens on loopback port 4300 by default. To change it, set `MIGRATEPROOF_API_PORT` to the same value for both processes. To use a different report directory, set `MIGRATEPROOF_REPORT_DIR` for the API and the CLI. Run `MIGRATEPROOF_REPORT_DIR=evidence/reports npm run api` to browse the preserved demonstration reports without Docker.

## CLI

| Command | Effect |
| --- | --- |
| `npm run --silent lab -- list` | Print the bundled migration inventory and static classifications as JSON. |
| `npm run --silent lab -- analyze path/to/change.sql` | Analyze UTF-8 PostgreSQL SQL up to 128 KiB. The command reads the file and prints classifications without executing the SQL. |
| `npm run lab -- init` | Start a disposable PostgreSQL service, initialize its restricted role and databases, then remove it. |
| `npm run lab -- rehearse column-rename` | Run one bundled scenario and write one JSON report. Use `list` for the supported IDs. |
| `npm run --silent lab -- report RUN_ID` | Print a saved report. Redirect stdout to save a copy. |
| `npm run --silent lab -- task RUN_ID` | Print an investigation task. Redirect stdout to save a copy. |
| `npm run lab -- verify` | Run and check all six fixtures and retain their reports. |
| `npm run lab -- help` | Show available commands. |

Exit status `0` means the command completed. For `verify`, intentional failures must reproduce and scoped corrections must pass. Status `1` means `rehearse` detected failures or a fixture produced unexpected outcomes. A report is retained in either case when evidence could be collected. Status `2` means an invalid input or operational error. Use `--silent` to omit npm’s own banner from machine-readable output.

## Verification

After the quick start, install the Playwright browser and run the same suite as CI.

```sh
npx playwright install --with-deps chromium
npm run verify
npm audit --audit-level=moderate
```

Browser tests target a production build of the dashboard and use reports from real rehearsals. The Playwright report, traces retained on failure, and screenshots are written to ignored local directories.

## Documentation

- [Architecture and API](docs/ARCHITECTURE.md)
- [Security and operational boundaries](docs/SECURITY.md)
- [Six migration scenarios](docs/MIGRATION_SCENARIOS.md)
- [Recorded evidence and screenshots](docs/EVIDENCE.md)
- [Devin agent prompt](docs/DEVIN_AGENT_PROMPT.md)
- [Devin integration contract](docs/DEVIN_INTEGRATION.md)
- [30-day Devin roadmap](docs/ROADMAP.md)
- [Limitations](docs/LIMITATIONS.md)

MigrateProof is available under the [MIT License](LICENSE).
