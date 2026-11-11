// 빌드: 브라우저용 JS·CSS(해시 붙은 이름 + manifest.json)와 서버 번들(dist/server.mjs).
// --watch를 주면 브라우저 파일만 바뀔 때마다 다시 만든다 (pnpm dev용).

import { build, context } from 'esbuild';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const watch = process.argv.includes('--watch');
const outdir = 'dist/public';

// 엔트리 이름(tribute.js, admin.css …) → 해시가 붙은 실제 파일 이름
const manifestPlugin = {
  name: 'manifest',
  setup(b) {
    b.onEnd((result) => {
      if (result.errors.length || !result.metafile) return;
      const manifest = {};
      for (const [file, info] of Object.entries(result.metafile.outputs)) {
        if (info.entryPoint) manifest[basename(info.entryPoint).replace(/\.ts$/, '.js')] = basename(file);
      }
      writeFileSync(join(outdir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      if (watch) console.log(`[build] client assets updated ${new Date().toLocaleTimeString()}`);
    });
  },
};

const clientOptions = {
  entryPoints: ['src/client/tribute.ts', 'src/client/admin.ts', 'src/client/tribute.css', 'src/client/admin.css'],
  outdir,
  entryNames: '[name]-[hash]',
  bundle: true,
  minify: true,
  format: 'iife',
  metafile: true,
  target: ['es2020', 'safari15', 'chrome90'],
  logLevel: 'warning',
  plugins: [manifestPlugin],
};

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

if (watch) {
  const ctx = await context(clientOptions);
  await ctx.watch();
  console.log('[build] watching client assets…');
} else {
  await build(clientOptions);
  await build({
    entryPoints: ['src/server/index.ts'],
    outfile: 'dist/server.mjs',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    legalComments: 'none',
    logLevel: 'warning',
  });
  console.log('[build] done');
}
