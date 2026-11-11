// /data 아래 파일 저장소.
//   pages/<id>/meta.json     제목, 조회수, 반응, 함께 쌓는 숫자(좋아요 등)
//   pages/<id>/b-<v>/...     페이지 파일 묶음 (다시 올릴 때마다 새 폴더로 갈아 끼운다)
//   session.key              관리자 세션 서명용 무작위 키
// 쓰기는 동기 I/O + 임시 파일 rename이라 요청끼리 섞이지 않고, 중간에 꺼져도 반쯤 쓴 파일이 남지 않는다.

import { randomBytes } from 'node:crypto';
import { accessSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILE_NAME, type BundleFile } from './bundle.ts';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export const ID_PATTERN = /^[A-Za-z0-9]{10}$/;
export const REACTION_KEY = /^[a-z0-9_-]{1,24}$/;
export const MAX_REACTION_KEYS = 20;
export const MAX_REACTION_VALUE = 80;
/** 한 번에 더할 수 있는 최대치. 연타를 모아 보내도 이 안에 든다. */
export const MAX_COUNT_STEP = 500;

export function randomId(length: number): string {
  const bytes = randomBytes(length * 2);
  let out = '';
  for (let i = 0; i < bytes.length && out.length < length; i++) {
    const b = bytes[i] as number;
    if (b < 256 - (256 % ALPHABET.length)) out += ALPHABET[b % ALPHABET.length];
  }
  return out.length === length ? out : randomId(length);
}

export interface Reaction {
  value: string;
  count: number;
  firstAt: string;
  lastAt: string;
}

export interface PageMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  bundle: string;
  views: number;
  reactions: Record<string, Reaction>;
  /** 방문자 모두가 함께 쌓는 숫자. 예전 페이지에는 없을 수 있다. */
  counts?: Record<string, number>;
}

export class FileStore {
  readonly root: string;
  private readonly pagesDir: string;

  constructor(root: string) {
    this.root = root;
    this.pagesDir = join(root, 'pages');
    mkdirSync(this.pagesDir, { recursive: true });
  }

  sessionKey(): Buffer {
    const file = join(this.root, 'session.key');
    if (existsSync(file)) {
      const key = readFileSync(file);
      if (key.length >= 32) return key;
    }
    const key = randomBytes(32);
    this.writeAtomic(file, key, 0o600);
    return key;
  }

  /** /data에 실제로 쓸 수 있는지 확인한다. 헬스 체크용. */
  assertWritable(): void {
    accessSync(this.pagesDir, constants.W_OK);
  }

  list(): PageMeta[] {
    const items: PageMeta[] = [];
    for (const name of readdirSync(this.pagesDir)) {
      const meta = this.get(name);
      if (meta) items.push(meta);
    }
    return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): PageMeta | null {
    if (!ID_PATTERN.test(id)) return null;
    try {
      return JSON.parse(readFileSync(this.metaPath(id), 'utf8')) as PageMeta;
    } catch {
      return null;
    }
  }

  /** 새 페이지를 만든다. 파일 묶음은 checkBundle을 통과한 것이어야 한다. */
  create(title: string, files: readonly BundleFile[], now = new Date()): PageMeta {
    let id = randomId(10);
    while (existsSync(join(this.pagesDir, id))) id = randomId(10);
    mkdirSync(join(this.pagesDir, id));
    let bundle: string;
    try {
      bundle = this.writeBundle(id, files);
    } catch (err) {
      rmSync(join(this.pagesDir, id), { recursive: true, force: true });
      throw err;
    }
    const stamp = now.toISOString();
    const meta: PageMeta = { id, title, createdAt: stamp, updatedAt: stamp, bundle, views: 0, reactions: {} };
    this.save(meta);
    return meta;
  }

  /** 같은 주소를 유지한 채 파일만 갈아 끼운다. 조회수와 반응은 그대로 둔다. */
  replace(id: string, title: string, files: readonly BundleFile[], now = new Date()): PageMeta | null {
    const current = this.get(id);
    if (!current) return null;
    const next: PageMeta = { ...current, title, bundle: this.writeBundle(id, files), updatedAt: now.toISOString() };
    this.save(next);
    this.removeBundle(id, current.bundle);
    return next;
  }

  delete(id: string): boolean {
    if (!this.get(id)) return false;
    rmSync(join(this.pagesDir, id), { recursive: true, force: true });
    return true;
  }

  readFile(id: string, name: string): { meta: PageMeta; data: Buffer } | null {
    const meta = this.get(id);
    if (!meta || !FILE_NAME.test(name)) return null;
    try {
      return { meta, data: readFileSync(join(this.pagesDir, id, meta.bundle, name)) };
    } catch {
      return null;
    }
  }

  hasFile(id: string, name: string): boolean {
    const meta = this.get(id);
    return !!meta && FILE_NAME.test(name) && existsSync(join(this.pagesDir, id, meta.bundle, name));
  }

  recordView(id: string): PageMeta | null {
    return this.mutate(id, (m) => ({ ...m, views: m.views + 1 }));
  }

  /** 반응을 남긴다. 키마다 마지막 값과 횟수를 둔다. 키 개수는 정해진 만큼만 받는다. */
  recordReaction(id: string, key: string, value: string, now = new Date()): PageMeta | null {
    if (!REACTION_KEY.test(key)) return null;
    const clean = value.replace(/\s+/g, ' ').trim().slice(0, MAX_REACTION_VALUE);
    const stamp = now.toISOString();
    return this.mutate(id, (m) => {
      const prev = m.reactions[key];
      if (!prev && Object.keys(m.reactions).length >= MAX_REACTION_KEYS) return m;
      const reaction: Reaction = { value: clean, count: (prev?.count ?? 0) + 1, firstAt: prev?.firstAt ?? stamp, lastAt: stamp };
      return { ...m, reactions: { ...m.reactions, [key]: reaction } };
    });
  }

  /** 함께 쌓는 숫자에 더하고 새 합계를 돌려준다. 키 규칙과 개수 제한은 반응과 같다. */
  addCount(id: string, key: string, add: number): number | null {
    if (!REACTION_KEY.test(key) || !Number.isInteger(add) || add < 1 || add > MAX_COUNT_STEP) return null;
    const meta = this.mutate(id, (m) => {
      const counts = m.counts ?? {};
      if (counts[key] === undefined && Object.keys(counts).length >= MAX_REACTION_KEYS) return m;
      return { ...m, counts: { ...counts, [key]: (counts[key] ?? 0) + add } };
    });
    return meta?.counts?.[key] ?? null;
  }

  private mutate(id: string, fn: (m: PageMeta) => PageMeta): PageMeta | null {
    const current = this.get(id);
    if (!current) return null;
    const next = fn(current);
    if (next !== current) this.save(next);
    return next;
  }

  private writeBundle(id: string, files: readonly BundleFile[]): string {
    const bundle = `b-${randomId(8)}`;
    const tmp = join(this.pagesDir, id, `.tmp-${randomId(8)}`);
    mkdirSync(tmp);
    try {
      for (const f of files) {
        if (!FILE_NAME.test(f.name)) throw new Error(`bad file name: ${f.name}`);
        writeFileSync(join(tmp, f.name), f.data, { mode: 0o644 });
      }
      renameSync(tmp, join(this.pagesDir, id, bundle));
    } catch (err) {
      rmSync(tmp, { recursive: true, force: true });
      throw err;
    }
    return bundle;
  }

  private removeBundle(id: string, bundle: string): void {
    if (/^b-[A-Za-z0-9]{8}$/.test(bundle)) rmSync(join(this.pagesDir, id, bundle), { recursive: true, force: true });
  }

  private save(meta: PageMeta): void {
    this.writeAtomic(this.metaPath(meta.id), `${JSON.stringify(meta, null, 2)}\n`);
  }

  private metaPath(id: string): string {
    return join(this.pagesDir, id, 'meta.json');
  }

  private writeAtomic(file: string, data: string | Buffer, mode = 0o644): void {
    const tmp = `${file}.${process.pid}.${randomId(6)}.tmp`;
    writeFileSync(tmp, data, { mode });
    renameSync(tmp, file);
  }
}
