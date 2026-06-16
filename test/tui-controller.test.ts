import { describe, it, expect } from 'vitest';
import { TuiController } from '../src/frontends/ink/controller.js';

function makeController() {
  return new TuiController({ provider: 'fake', model: 'fake-1', mode: 'default', inTokens: 0, outTokens: 0 });
}

describe('TuiController', () => {
  it('streams text and flushes to an assistant item on usage', () => {
    const c = makeController();
    const sink = c.sink();
    sink.text('Hello ');
    sink.text('world');
    expect(c.getSnapshot().stream).toBe('Hello world');
    sink.usage({ inputTokens: 5, outputTokens: 3 });
    const snap = c.getSnapshot();
    expect(snap.stream).toBe('');
    expect(snap.items.at(-1)).toMatchObject({ kind: 'assistant', text: 'Hello world' });
    expect(snap.status.inTokens).toBe(5);
    expect(snap.status.outTokens).toBe(3);
  });

  it('records tool calls and results', () => {
    const c = makeController();
    const sink = c.sink();
    sink.toolCall({ id: '1', name: 'shell', input: { command: 'ls -la' } });
    sink.toolResult({ id: '1', name: 'shell', input: {} }, { output: 'a\nb', isError: false });
    const kinds = c.getSnapshot().items.map((i) => i.kind);
    expect(kinds).toContain('tool');
    expect(kinds).toContain('result');
  });

  it('approval flow resolves the pending promise', async () => {
    const c = makeController();
    const p = c.requestApproval('Write file "a.ts"', 'write');
    expect(c.getSnapshot().approval).toMatchObject({ toolName: 'write' });
    c.resolveApproval(true);
    expect(await p).toBe(true);
    expect(c.getSnapshot().approval).toBeNull();
  });

  it('select flow navigates and confirms', async () => {
    const c = makeController();
    const p = c.requestSelect('Pick', ['a', 'b', 'c'], 0);
    c.moveSelect(1);
    expect(c.getSnapshot().select?.index).toBe(1);
    c.confirmSelect();
    expect(await p).toBe('b');
    expect(c.getSnapshot().select).toBeNull();
  });

  it('submit is ignored while busy or during an overlay', () => {
    const c = makeController();
    let calls = 0;
    c.onSubmit = async () => {
      calls++;
    };
    c.submit('first'); // starts a turn (busy true)
    c.submit('second'); // ignored: busy
    expect(calls).toBe(1);
    expect(c.getSnapshot().items.some((i) => i.kind === 'user' && i.text === 'first')).toBe(true);
  });

  it('cycleMode updates status via the callback', () => {
    const c = makeController();
    c.onCycleMode = () => 'plan';
    c.cycleMode();
    expect(c.getSnapshot().status.mode).toBe('plan');
  });

  it('requestExit sets the exiting flag', () => {
    const c = makeController();
    expect(c.getSnapshot().exiting).toBe(false);
    c.requestExit();
    expect(c.getSnapshot().exiting).toBe(true);
  });

  it('requestInput resolves with the submitted value', async () => {
    const c = makeController();
    const p = c.requestInput('API key:', { password: true });
    expect(c.getSnapshot().inputReq).toMatchObject({ prompt: 'API key:', password: true });
    c.resolveInput('sk-123');
    expect(await p).toBe('sk-123');
    expect(c.getSnapshot().inputReq).toBeNull();
  });
});
