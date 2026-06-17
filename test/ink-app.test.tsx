import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App, sanitizeTypedInput, visibleTranscriptItems } from '../src/frontends/ink/App.js';
import { pluginOverlayItems } from '../src/frontends/ink/index.js';
import { TuiController, filterOverlay } from '../src/frontends/ink/controller.js';
import { PluginManager } from '../src/plugins/manager.js';

function ctrl() {
  return new TuiController({ provider: 'ollama', model: 'qwen', mode: 'default', inTokens: 0, outTokens: 0 });
}

describe('Ink App', () => {
  it('renders the status bar and input prompt', () => {
    const c = ctrl();
    const { lastFrame, unmount } = render(React.createElement(App, { controller: c }));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('ollama');
    expect(frame).toContain('qwen');
    expect(frame).toContain('❯');
    unmount();
  });

  it('renders the selectable approval menu', () => {
    const c = ctrl();
    c.sink().toolCall({ id: '1', name: 'write', input: { path: 'a.ts' } });
    void c.requestApproval('Write file "a.ts"', 'write');
    const { lastFrame, unmount } = render(React.createElement(App, { controller: c }));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Approve action?');
    expect(frame).toMatch(/1\. Yes/);
    expect(frame).toMatch(/don't ask again for "write"/);
    expect(frame).toMatch(/3\. No/);
    unmount();
  });

  it('renders the select overlay', () => {
    const c = ctrl();
    void c.requestSelect('Select model', ['m1', 'm2'], 1);
    const { lastFrame, unmount } = render(React.createElement(App, { controller: c }));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Select model');
    expect(frame).toContain('m1');
    expect(frame).toContain('m2');
    unmount();
  });

  it('filters slash commands for the palette (pure)', async () => {
    const { filterCommandPalette } = await import('../src/frontends/ink/App.js');
    const cmds = [
      { name: 'models', description: 'Pick a model' },
      { name: 'mode', description: 'Permission mode' },
      { name: 'help', description: 'Show help' },
    ];
    expect(filterCommandPalette('/mo', cmds).map((c) => c.name)).toEqual(['models', 'mode']);
    expect(filterCommandPalette('hello', cmds)).toEqual([]);
    expect(filterCommandPalette('/', cmds).length).toBe(3);
  });

  it('resolves the submit target from the highlighted suggestion (pure)', async () => {
    const { resolveSubmitTarget } = await import('../src/frontends/ink/App.js');
    const cmds = [
      { name: 'models', description: 'Pick a model' },
      { name: 'mode', description: 'Permission mode' },
      { name: 'help', description: 'Show help' },
    ];
    // ↑/↓ then Enter runs the selected command (index 1 = mode), not the raw prefix.
    expect(resolveSubmitTarget('/mo', cmds, 1)).toBe('/mode');
    expect(resolveSubmitTarget('/mo', cmds, 0)).toBe('/models');
    // Commands with arguments run verbatim.
    expect(resolveSubmitTarget('/mode plan', cmds, 0)).toBe('/mode plan');
    // Plain prose runs verbatim.
    expect(resolveSubmitTarget('hello there', cmds, 0)).toBe('hello there');
    // Out-of-range index is clamped.
    expect(resolveSubmitTarget('/mo', cmds, 99)).toBe('/mode');
  });

  it('tracks busy state and timing on submit (controller)', () => {
    const c = ctrl();
    c.onSubmit = () => new Promise(() => {}); // never resolves → stays busy
    c.submit('do something');
    const snap = c.getSnapshot();
    expect(snap.busy).toBe(true);
    expect(snap.busySince).toBeGreaterThan(0);
  });

  it('queues input while busy and drains it one at a time (controller)', async () => {
    const c = ctrl();
    const runs: string[] = [];
    let release!: () => void;
    c.onSubmit = (text: string) => {
      runs.push(text);
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    c.submit('first'); // starts running
    c.submit('second'); // busy → queued
    c.submit('third'); // busy → queued
    expect(runs).toEqual(['first']);
    expect(c.getSnapshot().busy).toBe(true);
    // queued items appear as notices
    expect(c.getSnapshot().items.some((i) => i.kind === 'notice' && /Queued \(1\)/.test(i.text))).toBe(true);

    release(); // finish 'first' → drains 'second'
    await new Promise((r) => setTimeout(r, 0));
    expect(runs).toEqual(['first', 'second']);

    release(); // finish 'second' → drains 'third'
    await new Promise((r) => setTimeout(r, 0));
    expect(runs).toEqual(['first', 'second', 'third']);
  });

  it('keeps the latest transcript items visible near the bottom prompt', () => {
    const c = ctrl();
    for (let i = 0; i < 40; i++) c.notify(`old-${i}`);
    const window = visibleTranscriptItems(c.getSnapshot().items, 18);
    expect(window.map((i) => i.text)).not.toContain('old-0');
    expect(window.at(-1)?.text).toBe('old-39');

    const { lastFrame, unmount } = render(React.createElement(App, { controller: c }));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('old-39');
    expect(frame).toContain('ollama · qwen · default');
    expect(frame.lastIndexOf('❯')).toBeGreaterThan(frame.lastIndexOf('ollama · qwen · default'));
    unmount();
  });
});

describe('TuiController approval menu', () => {
  it('navigates and confirms options', async () => {
    const c = ctrl();
    let always = '';
    c.onApproveAlways = (t) => (always = t);
    const p = c.requestApproval('Edit "a.ts"', 'edit');
    c.moveApproval(1); // → option 2 (always)
    expect(c.getSnapshot().approval?.index).toBe(1);
    c.confirmApproval();
    expect(await p).toBe(true);
    expect(always).toBe('edit');
  });

  it('option 3 (No) denies', async () => {
    const c = ctrl();
    const p = c.requestApproval('Run rm', 'shell');
    c.moveApproval(2); // → No
    c.confirmApproval();
    expect(await p).toBe(false);
  });
});

describe('TuiController tabbed overlay', () => {
  it('opens a Help overlay split into General/Commands/Custom', () => {
    const c = ctrl();
    c.builtinNames = new Set(['help', 'models']);
    c.commands = [
      { name: 'help', description: 'Show help' },
      { name: 'models', description: 'Pick a model' },
      { name: 'review', description: 'Custom review command' },
    ];
    expect(c.tryOpenOverlay('/help')).toBe(true);
    const o = c.getSnapshot().overlay!;
    expect(o.tabs).toEqual(['General', 'Commands', 'Custom']);
    expect(o.data[0]!.map((i) => i.label)).toEqual(['/help', '/models']); // General = builtins
    expect(o.data[2]!.map((i) => i.label)).toEqual(['/review']); // Custom = non-builtins
  });

  it('switches tabs, filters, and closes', () => {
    const c = ctrl();
    c.pluginsProvider = () => ({
      installed: [{ label: 'code-review', description: 'enabled' }],
      registry: [
        { label: 'ruby-lsp', description: 'Ruby LSP' },
        { label: 'aws', description: 'AWS tools' },
      ],
    });
    expect(c.tryOpenOverlay('/plugin')).toBe(true);
    expect(c.getSnapshot().overlay!.tabs).toEqual(['Installed', 'Discover']);
    c.overlayTab(1); // → Discover
    expect(c.getSnapshot().overlay!.activeTab).toBe(1);
    c.overlayType('ruby');
    expect(filterOverlay(c.getSnapshot().overlay!).map((i) => i.label)).toEqual(['ruby-lsp']);
    c.closeOverlay();
    expect(c.getSnapshot().overlay).toBeNull();
  });

  it('Enter on a Discover item triggers install', () => {
    const c = ctrl();
    let installed = '';
    c.onPluginInstall = (name) => {
      installed = name;
      return `installed ${name}`;
    };
    c.pluginsProvider = () => ({ installed: [], registry: [{ label: 'ruby-lsp', description: 'Ruby LSP' }] });
    c.tryOpenOverlay('/plugin');
    c.overlayTab(1);
    c.overlayEnter();
    expect(installed).toBe('ruby-lsp');
  });

  it('Enter on a typed Discover source installs that git URL', () => {
    const c = ctrl();
    let installed = '';
    c.onPluginInstall = (name) => {
      installed = name;
      return `installed ${name}`;
    };
    c.pluginsProvider = () => ({ installed: [], registry: [] });
    c.tryOpenOverlay('/plugin');
    c.overlayTab(1);
    for (const ch of 'https://github.com/acme/plugin.git') c.overlayType(ch);
    expect(filterOverlay(c.getSnapshot().overlay!)).toEqual([
      { label: 'https://github.com/acme/plugin.git', description: 'Install from git URL or local path' },
    ]);
    c.overlayEnter();
    expect(installed).toBe('https://github.com/acme/plugin.git');
  });

  it('Enter on a typed Discover local path installs that path', () => {
    const c = ctrl();
    let installed = '';
    c.onPluginInstall = (name) => {
      installed = name;
      return `installed ${name}`;
    };
    c.pluginsProvider = () => ({ installed: [], registry: [] });
    c.tryOpenOverlay('/plugin');
    c.overlayTab(1);
    for (const ch of './plugins/my-plugin') c.overlayType(ch);
    expect(filterOverlay(c.getSnapshot().overlay!)[0]?.label).toBe('./plugins/my-plugin');
    c.overlayEnter();
    expect(installed).toBe('./plugins/my-plugin');
  });

  it('refreshes Installed after a Discover install', () => {
    const c = ctrl();
    let isInstalled = false;
    c.onPluginInstall = () => {
      isInstalled = true;
      return 'installed ruby-lsp';
    };
    c.pluginsProvider = () => ({
      installed: isInstalled ? [{ label: 'ruby-lsp', description: 'enabled' }] : [],
      registry: isInstalled ? [] : [{ label: 'ruby-lsp', description: 'Ruby LSP' }],
    });
    c.tryOpenOverlay('/plugin');
    c.overlayTab(1);
    c.overlayEnter();
    const o = c.getSnapshot().overlay!;
    expect(o.activeTab).toBe(0);
    expect(o.data[0]!.map((i) => i.label)).toEqual(['ruby-lsp']);
    expect(o.data[1]).toEqual([]);
  });
});

describe('Ink App overlay render', () => {
  it('renders the tabbed overlay with tabs and items', () => {
    const c = ctrl();
    c.commands = [{ name: 'help', description: 'Show help' }];
    c.builtinNames = new Set(['help']);
    c.tryOpenOverlay('/help');
    const { lastFrame, unmount } = render(React.createElement(App, { controller: c }));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Help');
    expect(frame).toContain('General');
    expect(frame).toContain('Commands');
    expect(frame).toContain('/help');
    unmount();
  });
});

describe('Ink plugin overlay data', () => {
  it('shows installed plugins and omits them from Discover', () => {
    const dir = mkdtempSync(join(tmpdir(), 'thinkco-ink-plugins-'));
    try {
      const mgr = new PluginManager(dir);
      mgr.scaffold('code-review');
      mgr.enable('code-review');
      const data = pluginOverlayItems(mgr);
      expect(data.installed.map((i) => i.label)).toContain('code-review');
      expect(data.registry.map((i) => i.label)).not.toContain('code-review');
      expect(data.registry.map((i) => i.label)).not.toEqual(
        expect.arrayContaining(['terraform-iac', 'release-notes', 'ruflo-core']),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('sanitizeTypedInput', () => {
  it('strips focus-event remnants (ESC stripped) anywhere in the value', () => {
    expect(sanitizeTypedInput('[O[I[O[I')).toBe('');
    expect(sanitizeTypedInput('hel[I[Olo')).toBe('hello');
  });
  it('strips full CSI escape sequences and control chars', () => {
    expect(sanitizeTypedInput('\u001b[Ihi\u001b[O')).toBe('hi');
    expect(sanitizeTypedInput('a\u0007b')).toBe('ab');
  });
  it('leaves normal input untouched', () => {
    expect(sanitizeTypedInput('/help build a site')).toBe('/help build a site');
    expect(sanitizeTypedInput('arr[0] = x')).toBe('arr[0] = x');
  });
});
