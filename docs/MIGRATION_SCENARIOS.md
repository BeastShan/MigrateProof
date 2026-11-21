# Migration scenarios

The lab seeds synthetic records into a new database for each attempt. Every scenario can be reproduced with `npm run lab -- rehearse ID`. A single rehearsal returns `1` when it detects the targeted failure. Run `npm run lab -- verify` for the full expected-outcome suite.

| ID | Proposed outcome | Correction or review |
| --- | --- | --- |
| [`column-rename`](../scenarios/column-rename) | The rename commits. The existing customer query references the removed identifier and fails with `42703`. | A generated alias lets new clients read the new name. A legacy update propagates to the alias. New clients still need a deliberate write-contract migration. |
| [`not-null`](../scenarios/not-null) | Deliveries 2 and 3 have null states, so `SET NOT NULL` fails with `23502` and rolls back. | Backfill those rows to `pending`, preserve the existing state, add the constraint, and assert a null insert is rejected. |
| [`unique-conflict`](../scenarios/unique-conflict) | Alias `alpha` occurs on IDs 1 and 2. Unique constraint creation fails with `23505`. | Use fixture order to retain the first alias and deterministically suffix other aliases. Confirm the constraint rejects a newly duplicated value. Real collision rules need product approval. |
| [`performance`](../scenarios/performance) | Dropping the index changes the measured selective lookup from an index scan to a sequential scan on 75,000 rows. | Test a covering replacement index, then compare plans and buffers. Wall time varies by host and run. |
| [`lock-contention`](../scenarios/lock-contention) | An independent `ACCESS SHARE` lock blocks the proposal. A third session observes the blocking PID and PostgreSQL cancels the statement with `55P03`. | Verify rollback leaves the schema intact. Acquire and release the competing lock on a fresh baseline before retrying and confirm the new column exists. |
| [`irreversible-drop`](../scenarios/irreversible-drop) | The drop commits. Two row identities survive, but the populated payload is inaccessible. | Creating an empty replacement column cannot recover the old values. Require explicit review and tested backup or archival recovery evidence. |

The SQL files hold the schema, seed, proposal, and applicable correction. [Scenario check definitions](../src/scenarios.ts) hold exact expected rows, representative queries, and expected failures. The [evidence index](EVIDENCE.md) links to recorded runs.
