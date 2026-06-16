---
name: code-review
description: Guidance for reviewing code changes for correctness, security, and clarity
triggers: review, code review, pull request, pr
---
# Code Review

When reviewing changes, prioritize by impact rather than style nits a linter would catch:

- **Correctness**: logic errors, edge cases, off-by-one, null/undefined handling, concurrency.
- **Security**: injection, unsafe input handling, secrets in code, missing authz/authn, SSRF.
- **Design**: cohesion, duplication, leaky abstractions, unnecessary complexity.
- **Tests**: are new behaviors covered, and do the assertions actually verify them?
- **Consistency**: does the change match the project's existing conventions?

For each issue give `file:line`, the concrete risk, and a suggested fix. Order findings blocker → major → minor, and state clearly when the change looks good.
