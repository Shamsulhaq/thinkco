// Bundle thinkco into a single self-contained file: dist/thinkco.mjs
// Optional native deps (playwright, @ast-grep/napi) stay external and degrade gracefully.
import { build } from 'esbuild';
import { chmodSync } from 'node:fs';

const outfile = 'dist/thinkco.mjs';

await build({
  entryPoints: ['src/cli/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  banner: {
    js: [
      // The source entry already carries a shebang; esbuild hoists it to the top.
      // Shim require() for any bundled CJS deps that need it under ESM.
      "import { createRequire as __thinkco_cr } from 'node:module';",
      'const require = __thinkco_cr(import.meta.url);',
    ].join('\n'),
  },
  // Native/optional deps cannot be bundled; keep them external (lazy-loaded at runtime).
  external: ['playwright', '@ast-grep/napi'],
  // ink's dev-only devtools dep is stubbed so the bundle has no missing imports.
  alias: { 'react-devtools-core': new URL('./devtools-stub.mjs', import.meta.url).pathname },
  logLevel: 'info',
});

chmodSync(outfile, 0o755);
console.log(`Bundled → ${outfile}`);
