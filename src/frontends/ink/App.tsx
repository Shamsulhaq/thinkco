/** Ink TUI App: scrollback + live stream + status bar + persistent input, with overlays. */
import React, { useSyncExternalStore } from 'react';
import { Box, Text, Static, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { type TuiController, type TuiItem, filterOverlay } from './controller.js';
import { randomHint, QUEUE_HINT } from '../../ui/hints.js';

function ItemView({ item }: { item: TuiItem }): React.ReactElement {
  if (item.kind === 'user') {
    return (
      <Box marginTop={1}>
        <Text color="cyan" bold>
          {'❯ '}
        </Text>
        <Text bold>{item.text}</Text>
      </Box>
    );
  }
  if (item.kind === 'assistant') {
    return (
      <Box marginTop={1}>
        <Text color="magenta">{'✦ '}</Text>
        <Text>{item.text}</Text>
      </Box>
    );
  }
  if (item.kind === 'tool') {
    return (
      <Text>
        <Text color="green">{'⏺ '}</Text>
        <Text color="green" bold>
          {item.text}
        </Text>
      </Text>
    );
  }
  if (item.kind === 'result') {
    return (
      <Box flexDirection="column">
        {item.text.split('\n').map((line, i) => (
          <Text key={i} color={item.isError ? 'red' : 'gray'} dimColor>
            {i === 0 ? '  ⎿  ' : '     '}
            {line}
          </Text>
        ))}
      </Box>
    );
  }
  if (item.kind === 'error') return <Text color="red">⚠ {item.text}</Text>;
  if (item.kind === 'notice') return <Text dimColor>{item.text}</Text>;
  return <Text>{item.text}</Text>;
}

export function App({ controller }: { controller: TuiController }): React.ReactElement {
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { exit } = useApp();
  const [input, setInput] = React.useState('');
  const [reqValue, setReqValue] = React.useState('');
  const [palIndex, setPalIndex] = React.useState(0);
  const [inputKey, setInputKey] = React.useState(0);
  const [exitArmed, setExitArmed] = React.useState(0);
  const [hint, setHint] = React.useState(() => randomHint());

  // Rotate the idle input hint so it isn't always the same text.
  React.useEffect(() => {
    if (snap.busy) return;
    const t = setInterval(() => setHint((h) => randomHint(h)), 6000);
    return () => clearInterval(t);
  }, [snap.busy]);
  const [, setTick] = React.useState(0);

  // Reset the highlighted suggestion whenever the typed input changes.
  React.useEffect(() => {
    setPalIndex(0);
  }, [input]);

  React.useEffect(() => {
    if (snap.exiting) exit();
  }, [snap.exiting, exit]);

  React.useEffect(() => {
    if (!snap.busy) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [snap.busy]);

  const palette = !snap.busy ? filterCommandPalette(input, controller.commands) : [];

  useInput((ch, key) => {
    if (key.tab && key.shift) {
      controller.cycleMode();
      return;
    }
    if (key.ctrl && ch === 'c') {
      const now = Date.now();
      if (snap.busy) {
        controller.interrupt();
        setExitArmed(now);
        controller.notify('Interrupted. Press Ctrl+C again to exit.');
        return;
      }
      if (now - exitArmed < 3000) {
        exit();
        return;
      }
      setExitArmed(now);
      controller.notify('Press Ctrl+C again to exit (or /exit).');
      return;
    }
    if (snap.overlay) {
      if (key.escape) controller.closeOverlay();
      else if (key.leftArrow) controller.overlayTab(-1);
      else if (key.rightArrow || key.tab) controller.overlayTab(1);
      else if (key.upArrow) controller.overlayMove(-1);
      else if (key.downArrow) controller.overlayMove(1);
      else if (key.return) controller.overlayEnter();
      else if (key.backspace || key.delete) controller.overlayType(null);
      else if (ch && !key.ctrl && !key.meta) controller.overlayType(ch);
      return;
    }
    if (snap.approval) {
      if (key.upArrow) controller.moveApproval(-1);
      else if (key.downArrow) controller.moveApproval(1);
      else if (key.return) controller.confirmApproval();
      else if (ch === '1') controller.resolveApproval(true);
      else if (ch === '2') {
        controller.onApproveAlways?.(snap.approval.toolName);
        controller.resolveApproval(true);
      } else if (ch === '3' || ch === 'n' || key.escape) controller.resolveApproval(false);
      else if (ch?.toLowerCase() === 'y') controller.resolveApproval(true);
      return;
    }
    if (snap.select) {
      if (key.upArrow) controller.moveSelect(-1);
      else if (key.downArrow) controller.moveSelect(1);
      else if (key.return) controller.confirmSelect();
      else if (key.escape) controller.cancelSelect();
      return;
    }
    // Command palette: ↑/↓ to select a suggestion, Tab to autocomplete the selected one.
    if (palette.length) {
      const sel = Math.min(palIndex, palette.length - 1);
      if (key.upArrow) {
        setPalIndex(sel <= 0 ? palette.length - 1 : sel - 1);
        return;
      }
      if (key.downArrow) {
        setPalIndex(sel >= palette.length - 1 ? 0 : sel + 1);
        return;
      }
      if (key.tab) {
        setInput(`/${palette[sel]!.name} `);
        setInputKey((k) => k + 1); // remount the input so the cursor lands at the end
        return;
      }
    }
    // Idle (no palette/modal): Tab cycles the primary agent (build → plan → compose).
    if (key.tab && !palette.length) {
      controller.cycleAgent();
      return;
    }
  });

  return (
    <Box flexDirection="column">
      <Static items={snap.items}>{(item) => <ItemView key={item.id} item={item} />}</Static>

      {snap.stream ? (
        <Box marginTop={1}>
          <Text color="magenta">{'✦ '}</Text>
          <Text>{snap.stream}</Text>
        </Box>
      ) : null}

      {snap.items.length === 0 && !snap.stream && !snap.busy ? (
        <Text dimColor>Ask me to build, fix, or explain something — I&apos;ll use tools to do it.</Text>
      ) : null}

      {/* Activity status line. */}
      <Box marginTop={1}>
        <Text dimColor>
          {snap.busy ? `${spinnerDot()} ` : ''}
          {snap.status.provider} · {snap.status.model} · {snap.status.mode}
          {snap.status.inTokens + snap.status.outTokens > 0
            ? ` · ${snap.status.inTokens}/${snap.status.outTokens} tok`
            : ''}
          {snap.busy
            ? ` · working ${Math.max(0, Math.round((Date.now() - snap.busySince) / 1000))}s${
                snap.toolCount ? ` · ${snap.toolCount} tool${snap.toolCount > 1 ? 's' : ''}` : ''
              }`
            : ''}
        </Text>
      </Box>

      {/* Approval menu. */}
      {snap.approval ? (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text color="yellow">Approve action?</Text>
          <Text>{snap.approval.summary}</Text>
          <Box marginTop={1} flexDirection="column">
            {['Yes', `Yes, and don't ask again for "${snap.approval.toolName}"`, 'No'].map((label, i) => (
              <Text key={label} color={i === snap.approval!.index ? 'cyan' : undefined}>
                {i === snap.approval!.index ? '❯ ' : '  '}
                {i + 1}. {label}
              </Text>
            ))}
          </Box>
          <Text dimColor>↑/↓ then Enter · or press 1/2/3 · Esc to deny</Text>
        </Box>
      ) : null}

      {/* Select overlay (model picker). */}
      {snap.select ? (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text dimColor>{snap.select.title} (↑/↓, Enter, Esc)</Text>
          {snap.select.options.map((opt, i) => (
            <Text key={opt} color={i === snap.select!.index ? 'cyan' : undefined}>
              {i === snap.select!.index ? '❯ ' : '  '}
              {opt}
            </Text>
          ))}
        </Box>
      ) : null}

      {/* Free-text input request (e.g. API key). */}
      {snap.inputReq ? (
        <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
          <Text color="green">{snap.inputReq.prompt}</Text>
          <Box>
            <Text color="cyan">❯ </Text>
            <TextInput
              value={reqValue}
              onChange={(v: string) => setReqValue(sanitizeTypedInput(v))}
              mask={snap.inputReq.password ? '*' : undefined}
              onSubmit={(v: string) => {
                setReqValue('');
                controller.resolveInput(v.trim().length ? v.trim() : null);
              }}
            />
          </Box>
          <Text dimColor>Enter to submit · empty to cancel</Text>
        </Box>
      ) : null}

      {/* Tabbed overlay (/help, /plugin). */}
      {snap.overlay ? (
        <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1}>
          <Box>
            <Text bold color="blue">{snap.overlay.title} </Text>
            {snap.overlay.tabs.map((tab, i) => (
              <Text key={tab} inverse={i === snap.overlay!.activeTab} color={i === snap.overlay!.activeTab ? 'blue' : undefined}>
                {' '}
                {tab}{' '}
              </Text>
            ))}
          </Box>
          <Text dimColor>search: {snap.overlay.filter || '…'}</Text>
          {(() => {
            const list = filterOverlay(snap.overlay);
            const start = Math.max(0, Math.min(snap.overlay.index - 4, list.length - 9));
            const window = list.slice(start, start + 9);
            return (
              <Box flexDirection="column">
                {start > 0 ? <Text dimColor>↑ more above</Text> : null}
                {window.length === 0 ? <Text dimColor>(no matches)</Text> : null}
                {window.map((item, i) => {
                  const idx = start + i;
                  const selected = idx === snap.overlay!.index;
                  return (
                    <Text key={item.label} color={selected ? 'cyan' : undefined}>
                      {selected ? '❯ ' : '  '}
                      {item.label}
                      {item.description ? `  ${item.description}` : ''}
                    </Text>
                  );
                })}
                {start + 9 < list.length ? <Text dimColor>↓ more below</Text> : null}
              </Box>
            );
          })()}
          <Text dimColor>type to search · ←/→ tabs · ↑/↓ move · Enter select · Esc close</Text>
        </Box>
      ) : null}

      {/* Command palette (autocomplete) above the input. */}
      {palette.length && !snap.approval && !snap.select && !snap.overlay ? (
        <Box flexDirection="column" marginTop={1}>
          {palette.map((cmd, i) => {
            const selected = i === Math.min(palIndex, palette.length - 1);
            return (
              <Box key={cmd.name}>
                <Text color={selected ? 'cyan' : 'blue'}>
                  {(selected ? '❯ ' : '  ') + `/${cmd.name}`.padEnd(18)}
                </Text>
                <Text dimColor>{cmd.description}</Text>
              </Box>
            );
          })}
          <Text dimColor>↑/↓ select · Tab complete · Enter run</Text>
        </Box>
      ) : null}

      {/* Persistent input — modern bordered box with a context hint line. */}
      {!snap.approval && !snap.select && !snap.overlay && !snap.inputReq ? (
        <Box flexDirection="column" marginTop={1}>
          <Box borderStyle="round" borderColor={snap.busy ? 'yellow' : 'cyan'} paddingX={1}>
            <Text color={snap.busy ? 'yellow' : 'cyan'} bold>
              {snap.busy ? `${spinnerDot()} ` : '❯ '}
            </Text>
            <TextInput
              key={inputKey}
              value={input}
              onChange={(v: string) => setInput(sanitizeTypedInput(v))}
              onSubmit={(v: string) => {
                // If a command suggestion is highlighted and no args were typed yet, run the
                // selected suggestion (so ↑/↓ then Enter runs that command, not the raw prefix).
                const target = resolveSubmitTarget(v, controller.commands, palIndex);
                setInput('');
                if (!controller.tryOpenOverlay(target)) controller.submit(target);
              }}
              placeholder={snap.busy ? QUEUE_HINT : hint}
            />
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}

let dotFrame = 0;
const DOTS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
function spinnerDot(): string {
  dotFrame = (dotFrame + 1) % DOTS.length;
  return DOTS[dotFrame]!;
}

/**
 * Strip terminal control/escape noise so it never lands in the input box. Some terminals emit
 * focus-event sequences (ESC[I on focus-in, ESC[O on focus-out) when you switch or minimize the
 * window; the ESC is consumed and the literal "[I"/"[O" would otherwise be typed into the input.
 */
export function sanitizeTypedInput(value: string): string {
  /* eslint-disable no-control-regex */
  return value
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '') // full CSI escape sequences (focus, cursor, …)
    .replace(/\[[IO]/g, '') // focus in/out remnants with the ESC already stripped
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); // stray control chars
  /* eslint-enable no-control-regex */
}

/** Filter slash commands for the autocomplete palette based on the current input. */
export function filterCommandPalette(
  input: string,
  commands: Array<{ name: string; description: string }>,
): Array<{ name: string; description: string }> {
  if (!input.startsWith('/')) return [];
  const first = input.split(/\s+/)[0] ?? '';
  return commands.filter((c) => `/${c.name}`.startsWith(first)).slice(0, 8);
}

/**
 * Resolve what should run when Enter is pressed. When the input is a bare slash-command prefix
 * (no arguments) and a suggestion is highlighted, run that selected command; otherwise run the
 * raw input verbatim (so commands with arguments are preserved).
 */
export function resolveSubmitTarget(
  value: string,
  commands: Array<{ name: string; description: string }>,
  palIndex: number,
): string {
  const pal = filterCommandPalette(value, commands);
  if (pal.length && value.startsWith('/') && !value.trim().includes(' ')) {
    const sel = Math.min(Math.max(palIndex, 0), pal.length - 1);
    return `/${pal[sel]!.name}`;
  }
  return value;
}
