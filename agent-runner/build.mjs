// Bundle the runner into ONE file that can be committed into somebody else's
// repository and run there with no install step: `node .devdigest/runner.mjs`.
//
// Everything the runner needs is inlined — the shared contracts, the
// reviewer-core engine (both consumed as TypeScript source through the tsconfig
// path aliases) and the three npm dependencies. Nothing is left external,
// because the target repository has no node_modules of ours.
//
// The output is committed at dist/runner.mjs and the agent-runner workflow runs
// this script and then `git diff --exit-code -- dist/`: a committed bundle that
// no longer matches its source is the one failure mode a committed artefact has.
import { build } from 'esbuild';

const result = await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/runner.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  // Keep the bundle readable-ish: a reviewer of the export pull request may want
  // to see what lands in their repository, and minifying buys nothing here.
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  metafile: true,
  // esbuild follows tsconfig `paths`, which is how @devdigest/shared and
  // @devdigest/reviewer-core resolve to their TypeScript sources.
  tsconfig: 'tsconfig.json',
  banner: {
    // `require` in an ESM bundle, and the reason it has to be here.
    //
    // The runner shares the studio's OpenRouter provider, which is the OpenAI
    // SDK v4. That SDK ships CommonJS runtime shims (`_shims/node-runtime.js` →
    // `node-fetch`) whose internal `require("stream")` esbuild cannot rewrite,
    // because the requiring file is CJS. Bundled to ESM with no `require` in
    // scope, esbuild's fallback throws `Dynamic require of "stream" is not
    // supported` on the very first import — measured, before this banner
    // existed. `createRequire` gives those calls a real resolver.
    //
    // Every specifier that reaches it is a Node builtin, with one exception:
    // node-fetch's optional `require("encoding")`, which it makes inside a
    // try/catch and never needs on this path. So the bundle stays SELF-
    // CONTAINED — nothing here resolves a file in the repository it lands in.
    js: [
      '// DevDigest CI runner — generated bundle, do not edit. Source: agent-runner/src.',
      "import { createRequire as __devdigestCreateRequire } from 'node:module';",
      'const require = __devdigestCreateRequire(import.meta.url);',
    ].join('\n'),
  },
});

const out = result.metafile.outputs['dist/runner.mjs'];
console.log(`dist/runner.mjs — ${out ? out.bytes : 0} bytes`);
