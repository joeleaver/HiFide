# Verification and Execution Policy

## Principles
- Treat “make sure it runs/tests/builds” as authorization to execute safe checks.
- Consider success only with exit code 0 and clean logs.
- Prefer smallest scope: single test → file → suite.

## Safe-by-default checks
- Unit/integration tests
- Linters and type-checkers
- Builds and CLI --help

## Risky actions (confirmation required)
- Package installs/updates (pnpm add/remove)
- DB migrations, deploys, destructive filesystem ops
- Long-running or external-cost actions

## Loop after edits
1. Run focused verification (impacted tests, lints, type-check, build).
2. If failures: summarize key logs and propose minimal fix.
3. Re-run targeted checks. Cap retries; ask user if blocked.

## Reporting
- Summarize: command, cwd, exit code, key log lines.
- Always show diffs before writing changes.

