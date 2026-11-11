import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

export type AssetName = 'admin.css' | 'admin.js';

export interface Assets {
  /** 브라우저가 받을 주소 (/assets/<해시가 붙은 이름>) */
  href(name: AssetName): string;
  file(name: string): { body: Buffer; type: string } | null;
}

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

/** scripts/build.mjs가 만든 dist/public과 manifest.json을 읽는다. 개발 중에는 매번 다시 읽는다. */
export function loadAssets(dir: string, { reload = false } = {}): Assets {
  type Loaded = { manifest: Record<AssetName, string>; files: Map<string, { body: Buffer; type: string }> };

  const load = (): Loaded => {
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Record<AssetName, string>;
    const files = new Map<string, { body: Buffer; type: string }>();
    for (const name of Object.values(manifest)) {
      files.set(name, { body: readFileSync(join(dir, name)), type: TYPES[extname(name)] ?? 'application/octet-stream' });
    }
    return { manifest, files };
  };

  let cached = load();
  const current = () => (reload ? (cached = load()) : cached);

  return {
    href: (name) => `/assets/${current().manifest[name]}`,
    file: (name) => current().files.get(name) ?? null,
  };
}
