// 빌드
//   dist/public  관리 화면 JS·CSS (해시 붙은 이름 + manifest.json)
//   dist/kit     페이지 공용 도구 kit.js·kit.css (페이지를 올릴 때 같이 들어간다)
//   dist/server.mjs  서버 번들
// --watch를 주면 브라우저 파일만 바뀔 때마다 다시 만든다 (pnpm dev용).

import { build, context } from 'esbuild';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const watch = process.argv.includes('--watch');
const outdir = 'dist/public';
const kitdir = 'dist/kit';
const target = ['es2020', 'safari15', 'chrome90'];

// 엔트리 이름(admin.js, admin.css) → 해시가 붙은 실제 파일 이름
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
      if (watch) console.log(`[build] admin assets updated ${new Date().toLocaleTimeString()}`);
    });
  },
};

const logKit = {
  name: 'log-kit',
  setup(b) {
    b.onEnd((result) => {
      if (watch && !result.errors.length) console.log(`[build] kit updated ${new Date().toLocaleTimeString()}`);
    });
  },
};

const adminOptions = {
  entryPoints: ['src/client/admin.ts', 'src/client/admin.css'],
  outdir,
  entryNames: '[name]-[hash]',
  bundle: true,
  minify: true,
  format: 'iife',
  metafile: true,
  target,
  logLevel: 'warning',
  plugins: [manifestPlugin],
};

const kitOptions = {
  entryPoints: ['src/kit/kit.ts', 'src/kit/kit.css'],
  outdir: kitdir,
  entryNames: '[name]',
  bundle: true,
  minify: true,
  format: 'iife',
  target,
  logLevel: 'warning',
  plugins: [logKit],
};

for (const dir of [outdir, kitdir]) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

if (watch) {
  for (const options of [adminOptions, kitOptions]) await (await context(options)).watch();
  console.log('[build] watching admin assets and kit…');
} else {
  await build(adminOptions);
  await build(kitOptions);
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
