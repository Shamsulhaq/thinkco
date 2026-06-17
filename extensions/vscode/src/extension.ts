/**
 * VS Code activation glue. Imports `vscode` (only available inside the extension host) and the
 * thinkco core. All agent logic lives in the headless `VscodeBridge`; this file just wires a
 * webview chat panel to it and surfaces tool approvals as native dialogs.
 *
 * Build with `npm install && npm run build` inside this folder (requires @types/vscode).
 */
import * as vscode from 'vscode';
import {
  VscodeBridge,
  ProviderRegistry,
  ToolRegistry,
  registerCoreTools,
  loadConfig,
} from 'thinkco';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('thinkco.openChat', () => openChat(context)),
  );
}

function openChat(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel('thinkcoChat', 'thinkco', vscode.ViewColumn.Beside, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  panel.webview.html = chatHtml();

  const cfg = vscode.workspace.getConfiguration('thinkco');
  const config = loadConfig({ overrides: { defaultProvider: cfg.get('provider') || 'anthropic' } });
  const registry = new ProviderRegistry();
  registry.registerConfiguredProviders(config);
  const providerName = config.defaultProvider;
  const model = (cfg.get('model') as string) || registry.resolveModel(providerName, config);
  const tools = new ToolRegistry();
  registerCoreTools(tools);
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

  let bridge: VscodeBridge;
  try {
    bridge = new VscodeBridge({ provider: registry.create(providerName, config), model, tools, cwd });
  } catch (err) {
    void vscode.window.showErrorMessage(`thinkco: ${(err as Error).message}`);
    return;
  }

  panel.webview.onDidReceiveMessage(async (msg: { type: string; text?: string }) => {
    if (msg.type !== 'send' || !msg.text) return;
    await bridge.send(msg.text, {
      onText: (delta) => void panel.webview.postMessage({ type: 'text', delta }),
      onToolCall: (call) => void panel.webview.postMessage({ type: 'tool', name: call.name }),
      onNotice: (m) => void panel.webview.postMessage({ type: 'notice', text: m }),
      onError: (m) => void panel.webview.postMessage({ type: 'error', text: m }),
      // Surface write/execute approvals as a native modal so nothing destructive runs silently.
      approve: async (call) => {
        const pick = await vscode.window.showWarningMessage(
          `Allow tool "${call.name}"?`,
          { modal: true },
          'Allow',
          'Deny',
        );
        return pick === 'Allow';
      },
    });
    void panel.webview.postMessage({ type: 'done' });
  });
}

function chatHtml(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
<style>
  body { font-family: var(--vscode-font-family); margin: 0; display: flex; flex-direction: column; height: 100vh; }
  #log { flex: 1; overflow-y: auto; padding: 8px; white-space: pre-wrap; }
  #row { display: flex; border-top: 1px solid var(--vscode-panel-border); }
  #input { flex: 1; padding: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: none; }
</style></head><body>
<div id="log"></div>
<div id="row"><input id="input" placeholder="Ask thinkco…" /></div>
<script>
  const vscode = acquireVsCodeApi();
  const log = document.getElementById('log');
  const input = document.getElementById('input');
  function append(t) { log.textContent += t; log.scrollTop = log.scrollHeight; }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      append('\\n\\n> ' + input.value + '\\n');
      vscode.postMessage({ type: 'send', text: input.value });
      input.value = '';
    }
  });
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'text') append(m.delta);
    else if (m.type === 'tool') append('\\n[tool: ' + m.name + ']\\n');
    else if (m.type === 'notice') append('\\n(' + m.text + ')\\n');
    else if (m.type === 'error') append('\\n[error: ' + m.text + ']\\n');
  });
</script></body></html>`;
}

export function deactivate(): void {
  /* no-op */
}
