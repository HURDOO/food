// /data 아래 파일 저장소.
//   tributes/<id>.json   헌정관 하나
//   photos/<id>-<v>.jpg   사진 (바꿀 때마다 새 이름이라 캐시가 꼬이지 않는다)
//   session.key           관리자 세션 서명용 무작위 키
// 쓰기는 동기 I/O + 임시 파일 rename이라 요청끼리 섞이지 않고, 중간에 꺼져도 반쯤 쓴 파일이 남지 않는다.

import { randomBytes } from 'node:crypto';
import { accessSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isCouponOption, type CouponOption, type Tribute, type TributeInput } from '../shared/tribute.ts';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export const ID_PATTERN = /^[A-Za-z0-9]{10}$/;
export const PHOTO_PATTERN = /^[A-Za-z0-9]{10}-[A-Za-z0-9]{6}\.jpg$/;

function randomId(length: number): string {
  const bytes = randomBytes(length * 2);
  let out = '';
  for (let i = 0; i < bytes.length && out.length < length; i++) {
    const b = bytes[i] as number;
    if (b < 256 - (256 % ALPHABET.length)) out += ALPHABET[b % ALPHABET.length];
  }
  return out.length === length ? out : randomId(length);
}

export type PhotoChange = { kind: 'keep' } | { kind: 'remove' } | { kind: 'replace'; data: Buffer };

export class FileStore {
  readonly root: string;
  private readonly tributesDir: string;
  private readonly photosDir: string;

  constructor(root: string) {
    this.root = root;
    this.tributesDir = join(root, 'tributes');
    this.photosDir = join(root, 'photos');
    mkdirSync(this.tributesDir, { recursive: true });
    mkdirSync(this.photosDir, { recursive: true });
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
    accessSync(this.tributesDir, constants.W_OK);
    accessSync(this.photosDir, constants.W_OK);
  }

  list(): Tribute[] {
    const items: Tribute[] = [];
    for (const name of readdirSync(this.tributesDir)) {
      if (!name.endsWith('.json')) continue;
      const t = this.get(name.slice(0, -5));
      if (t) items.push(t);
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Tribute | null {
    if (!ID_PATTERN.test(id)) return null;
    try {
      return JSON.parse(readFileSync(this.tributePath(id), 'utf8')) as Tribute;
    } catch {
      return null;
    }
  }

  create(input: TributeInput, photo: Buffer | null, now = new Date()): Tribute {
    let id = randomId(10);
    while (existsSync(this.tributePath(id))) id = randomId(10);
    const stamp = now.toISOString();
    const tribute: Tribute = {
      ...input,
      id,
      photo: photo ? this.writePhoto(id, photo) : null,
      createdAt: stamp,
      updatedAt: stamp,
      stats: { views: 0, agreedAt: null, coupon: null, couponAt: null },
    };
    this.save(tribute);
    return tribute;
  }

  update(id: string, input: TributeInput, change: PhotoChange, now = new Date()): Tribute | null {
    const current = this.get(id);
    if (!current) return null;
    let photo = current.photo;
    if (change.kind === 'replace') photo = this.writePhoto(id, change.data);
    if (change.kind === 'remove') photo = null;
    const next: Tribute = { ...current, ...input, id, photo, updatedAt: now.toISOString() };
    this.save(next);
    if (current.photo && current.photo !== photo) this.removePhoto(current.photo);
    return next;
  }

  delete(id: string): boolean {
    const current = this.get(id);
    if (!current) return false;
    rmSync(this.tributePath(id), { force: true });
    if (current.photo) this.removePhoto(current.photo);
    return true;
  }

  recordView(id: string): Tribute | null {
    return this.mutateStats(id, (s) => ({ ...s, views: s.views + 1 }));
  }

  recordYes(id: string, now = new Date()): Tribute | null {
    return this.mutateStats(id, (s) => (s.agreedAt ? s : { ...s, agreedAt: now.toISOString() }));
  }

  recordCoupon(id: string, choice: CouponOption, now = new Date()): Tribute | null {
    if (!isCouponOption(choice)) return null;
    return this.mutateStats(id, (s) => ({ ...s, coupon: choice, couponAt: now.toISOString() }));
  }

  readPhoto(file: string): Buffer | null {
    if (!PHOTO_PATTERN.test(file)) return null;
    try {
      return readFileSync(join(this.photosDir, file));
    } catch {
      return null;
    }
  }

  private mutateStats(id: string, fn: (s: Tribute['stats']) => Tribute['stats']): Tribute | null {
    const current = this.get(id);
    if (!current) return null;
    const next = { ...current, stats: fn(current.stats) };
    this.save(next);
    return next;
  }

  private writePhoto(id: string, data: Buffer): string {
    const file = `${id}-${randomId(6)}.jpg`;
    this.writeAtomic(join(this.photosDir, file), data);
    return file;
  }

  private removePhoto(file: string): void {
    if (PHOTO_PATTERN.test(file)) rmSync(join(this.photosDir, file), { force: true });
  }

  private save(t: Tribute): void {
    this.writeAtomic(this.tributePath(t.id), `${JSON.stringify(t, null, 2)}\n`);
  }

  private tributePath(id: string): string {
    return join(this.tributesDir, `${id}.json`);
  }

  private writeAtomic(file: string, data: string | Buffer, mode = 0o644): void {
    const tmp = `${file}.${process.pid}.${randomId(6)}.tmp`;
    writeFileSync(tmp, data, { mode });
    renameSync(tmp, file);
  }
}
