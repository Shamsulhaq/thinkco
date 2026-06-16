---
name: conventional-commits
description: Write commit messages following the Conventional Commits specification
triggers: commit, commit message, conventional commit, changelog
---
# Conventional Commits

Write commit messages as `type(scope): summary`.

**Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

Rules:
- Summary in imperative mood, lowercase, no trailing period, ≤ 72 chars.
- `scope` is optional and names the affected area, e.g. `feat(parser): ...`.
- Breaking changes: add `!` after the type/scope (`feat!: ...`) and a `BREAKING CHANGE:` footer.
- Body (optional, after a blank line) explains the *why*; footers reference issues (`Closes #123`).

Examples:
- `fix(auth): reject expired tokens before refresh`
- `feat(cli): add --json output to headless mode`
- `refactor!: drop Node 18 support` + footer `BREAKING CHANGE: requires Node >= 20`.

Derive the type and scope from the actual diff; do not invent changes that aren't present.
