---
name: reviewer
description: Systematic code-review checklist
triggers: review, code review, pull request
---

# Code Review Checklist

When reviewing code, work through these dimensions:

1. **Correctness** — logic errors, off-by-one, null/undefined handling, edge cases.
2. **Security** — input validation, injection, secrets in code, authz checks.
3. **Performance** — unnecessary work, N+1 queries, blocking I/O.
4. **Readability** — naming, dead code, oversized functions.
5. **Tests** — are new paths covered? Do existing tests still hold?

Report findings grouped by severity (blocker / major / minor / nit), each with a file:line
reference and a concrete suggested fix.
