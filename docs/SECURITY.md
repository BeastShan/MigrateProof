# Security

## Database boundary

Invoke the lab on a trusted development machine or dedicated CI runner with a local Linux Docker daemon. Starting a rehearsal authorizes creation and deletion of the lab’s own container. The lab accepts no database URL, host, or credentials. It rejects common external PostgreSQL connection variables, selects its own private Unix socket, and ignores remote Docker context and host variables. It never accepts arbitrary SQL for execution over the dashboard, CLI, or API. The `analyze` command only parses a file.

The container uses a pinned image, disabled networking, no published ports, temporary database storage, bounded memory and CPU, a process limit, and `no-new-privileges`. The only bind mount is the PostgreSQL socket directory under a newly created host directory with mode 0700. PostgreSQL listens on Unix sockets only. The application uses a role without superuser, database creation, role creation, or replication privileges. The local administrative session only initializes the synthetic databases, then closes. Socket-local trust authentication relies on OS isolation and the host directory’s restrictive permissions. There are no persistent database credentials.

PostgreSQL enforces a 5-second statement timeout, 750-millisecond lock timeout, and 4-second idle transaction timeout. Connection readiness, Docker operations, and the lock diagnostic poll are bounded. Error evidence stores SQLSTATE and a controlled description instead of raw PostgreSQL error strings. Recorded SQL and rows are limited to the synthetic fixtures. The GitHub workflow uses read-only repository permissions, no retained checkout credentials, and no provider secrets.

## Human authorization

Every report records pending human review. A destructive operation also requires a credible recovery path. The repository has no merge, deployment, remote SQL, or live agent execution path. A future repair must have separate approval and independent verification on the pinned baseline. Exporting a task gives no authority to run an agent or apply a change.

## Residual risks

- Docker daemon access grants substantial host power. Use a trusted daemon and reviewed source. The container shares the host kernel and does not sandbox hostile code with a separate kernel.
- The lab trusts callers with the same OS user and trusts the local report directory. The local dashboard has no auth layer and should stay on loopback. Report hashes identify fixture content. They do not attest who produced a report or prevent local tampering.
- A host crash, forced termination, or Docker failure can interrupt cleanup. Use `docker ps -a --filter label=org.migrateproof.disposable=true` to identify containers. Check that a listed rehearsal is no longer active before removing its exact container ID. The reports contain no production data.
- The parser and image have independent release and security histories. Periodically update the pinned dependencies and image, rerun the suite, and review the accompanying advisories.
