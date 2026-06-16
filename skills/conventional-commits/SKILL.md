---
name: conventional-commits
description: Write git commit messages following the Conventional Commits spec
triggers: commit, commit message, changelog
---

# Conventional Commits

When asked to write a commit message, follow the Conventional Commits 1.0.0 format:

```
<type>(<optional scope>): <description>

<optional body>

<optional footer>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.

Guidelines:
- Use the imperative mood ("add", not "added").
- Keep the description under 72 characters.
- Add a body explaining *why* when the change is non-trivial.
- Use `BREAKING CHANGE:` in the footer for breaking changes.

Before composing, inspect the staged diff with the `git` tool (`git diff --staged`).
