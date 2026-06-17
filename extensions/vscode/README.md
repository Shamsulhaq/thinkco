# thinkco for VS Code

A thin VS Code extension that wraps thinkco's **headless agent core**. The chat panel talks to
the same `AgentLoop`, tools, and permission engine as the CLI — the editor is just another
frontend. All agent logic lives in the core (`src/frontends/vscode/bridge.ts`, `VscodeBridge`);
this folder only contains the activation glue that imports the `vscode` API.

## Develop

```bash
cd extensions/vscode
npm install          # pulls @types/vscode and links the local thinkco core (file:../..)
npm run build        # tsc → dist/extension.js
```

Then press **F5** in VS Code (with this folder open) to launch an Extension Development Host,
and run **“thinkco: Open Chat”** from the command palette.

## Configuration

- `thinkco.provider` — default provider (e.g. `anthropic`, `openai`, `gemini`).
- `thinkco.model` — default model (blank uses the provider default).

API keys are read from your environment / global thinkco config, same as the CLI.

## Security

Tool calls that write or execute surface a **native modal approval** before running — the
extension never runs destructive actions silently. The permission model is the same headless
engine used everywhere else in thinkco.

## Package

```bash
npm run package      # produces a .vsix via @vscode/vsce
```
