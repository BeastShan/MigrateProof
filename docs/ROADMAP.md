# 30-day Devin integration roadmap

Estimate for one engineer with part-time repository and security review. Days are elapsed project days. The estimate includes internal tests and integration, with sandbox access and provider capabilities as dependencies.

| Days | Milestone | Dependencies | Acceptance criteria | Engineering effort |
| --- | --- | --- | --- | --- |
| 1–5 | Verify sandbox API and permissions | Provider sandbox credentials, current provider documentation, sandbox repository | Document authenticated start/status/cancel capability and scopes. Prove invalid and read-only credentials fail where expected. Keep the default adapter disabled. | 12–18 hours |
| 6–12 | Implement approval and session lifecycle | Approved repository permissions, storage for approval and session state | Bind approval to task digest, repository, commit, stage and expiry. Verify durable transitions and idempotent retries. Reject replay and scope drift in automated tests. | 18–28 hours |
| 13–18 | Enforce budgets and cancellation | Verified provider usage signals and cancellation contract | Reserve before dispatch, enforce concurrency and time budgets, reconcile actual use and test cancellation races. Block live dispatch if enforceable limits cannot be verified. | 16–24 hours |
| 19–25 | Pilot investigation, repair and verification | Sandbox API, approvals and budget checks, separate branch permissions | Reproduce one failure, repair on a separately approved branch, verify from a fresh baseline, inspect the actual diff and reject a deliberately out-of-scope change. | 18–28 hours |
| 26–30 | Audit the pilot and document enablement | Reproducible pilot run, maintainer and security review | Produce redacted audit trails, runbooks and explicit rollout criteria. Demonstrate default-off behavior and recovery from provider timeouts or lost responses. | 12–20 hours |

Total estimated engineering effort is **76–118 hours**. Provider fees and usage require actual sandbox measurements and current pricing. Review lead time and waiting for provider access may extend the calendar schedule.
