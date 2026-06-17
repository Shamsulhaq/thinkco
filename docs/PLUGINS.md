# Plugins & the registry

thinkco plugins bundle skills, custom commands, hooks, and MCP servers into a single installable
unit. A small **curated registry** powers discovery and install-by-name.

## Discover

```bash
/plugin                    # list installed plugins
/plugin categories         # list catalog categories
/plugin search <term>      # search by name, description, tag, or category
/plugin install <name|git-url|path>
/plugin enable <name> | disable <name> | remove <name>
```

`/plugin search` matches against each entry's name, description, **tags**, and **category**, so
`/plugin search testing`, `/plugin search k8s`, and `/plugin search react` all work. Entries marked
`[bundled]` ship with thinkco and install offline (no git required).

## Catalog entry shape

The registry (`src/plugins/registry.ts`) is a list of:

```ts
interface RegistryEntry {
  name: string;          // install-by-name id
  description: string;
  url: string;           // git URL (or bundled local copy)
  category?: string;     // e.g. "review", "git", "testing", "infra", "languages"
  tags?: string[];       // keywords matched by search
  bundled?: boolean;     // ships with thinkco
}
```

## Author a plugin

A plugin is a folder with a `plugin.json` plus any of:

- `skills/<name>/SKILL.md` — progressively-loaded skills
- `commands/*.md` — custom slash commands (`$ARGUMENTS`, `$1`, `` !`cmd` `` injection)
- hooks and MCP server declarations

thinkco also loads **Claude Code-format** plugins (`.claude/agents/*.md` → skills,
`.claude/commands/*.md` → commands). See `plugins/code-review` and `plugins/ruflo-core` for
runnable examples.

## Submit to the registry

1. Publish your plugin to a public git repo.
2. Add an entry to `KNOWN_PLUGINS` in `src/plugins/registry.ts` with a `category` and useful
   `tags` so it surfaces in `/plugin search`.
3. Open a PR. A hosted marketplace can later replace the built-in list without changing callers.
