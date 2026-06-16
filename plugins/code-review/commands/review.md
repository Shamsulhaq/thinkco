---
name: review
description: Review the current changes for correctness, security, and clarity
---
Review the current working changes. First run `git diff` (and `git diff --staged`) to see what changed, then read surrounding context as needed.

Focus on, in priority order:
1. Correctness — logic errors, edge cases, null/undefined, race conditions.
2. Security — injection, unsafe input, secrets, missing authz/authn, SSRF.
3. Design — duplication, leaky abstractions, unnecessary complexity.
4. Tests — are new behaviors covered with meaningful assertions?

Report findings as file:line with the risk and a concrete fix, ordered blocker → major → minor. Approve clearly if it's good.

$ARGUMENTS
