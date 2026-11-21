# Devin integration contract

The application exports a provider-neutral JSON task with a version, stage, title, run ID, fixture and migration SHA-256 hashes, PostgreSQL version and image, evidence, scope, acceptance criteria, and mandatory-review flag. The application currently emits investigation tasks. Repair and independent verification have distinct schemas that require a separate approval reference and approved commit. Verification also requires the candidate commit.

The TypeScript contract exposes `start`, `status`, and `cancel`. Invocation carries an abort signal and references to a session budget. The only implementation rejects all calls. Approval reference fields specify the payload shape and establish no trust on their own. The repository contains no provider authentication, dispatch, session persistence, or provider result ingestion.

## Enablement criteria

- Authenticate to the provider through separately scoped credentials. Confirm access in a sandbox, with redaction and least-privilege checks.
- Validate and persist user approvals bound to the repository, commit, stage, scope, and expiry. Deny missing, expired, out-of-scope or reused approvals.
- Reserve bounded duration and spending before dispatch. Reconcile terminal sessions, retries, and failed cancellation. Fail closed when limits or provider state are unknown.
- Make investigation, repair, and verification separate sessions. Restrict repository permissions according to stage and require a new environment and verifier identity where available.
- Record provider status and evidence only from authenticated provider responses. Validate output schemas and inspect the actual candidate Git diff.
- Keep merge and deployment under explicit human control. Do not grant the provider merge or deployment permissions.

[Agent prompts](DEVIN_AGENT_PROMPT.md) · [30-day plan](ROADMAP.md)
