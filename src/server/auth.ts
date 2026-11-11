import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'bt_admin';
export const SESSION_DAYS = 30;

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest();

export interface Auth {
  checkPassword(input: string): boolean;
  issue(now?: number): string;
  verify(token: string | undefined, now?: number): boolean;
}

/**
 * 관리자 세션. 쿠키 값은 "만료시각.서명"이고, 서명 키는 /data의 무작위 키와 비밀번호로 만든다.
 * 그래서 비밀번호를 바꾸면 기존 로그인은 모두 풀린다.
 */
export function createAuth(password: string, storedKey: Buffer): Auth {
  const passwordHash = sha256(password);
  const signingKey = createHmac('sha256', storedKey).update(password).digest();
  const sign = (exp: number) => createHmac('sha256', signingKey).update(`session:${exp}`).digest('base64url');

  return {
    checkPassword(input) {
      return timingSafeEqual(sha256(input), passwordHash);
    },
    issue(now = Date.now()) {
      const exp = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
      return `${exp}.${sign(exp)}`;
    },
    verify(token, now = Date.now()) {
      if (!token) return false;
      const m = /^(\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(token);
      if (!m) return false;
      const exp = Number(m[1]);
      if (exp <= now) return false;
      const expected = Buffer.from(sign(exp));
      const given = Buffer.from(m[2] as string);
      return expected.length === given.length && timingSafeEqual(expected, given);
    },
  };
}

/** 비밀번호 대입을 막는 전역 제한. 관리자는 한 명뿐이라 IP 구분 없이 센다. */
export function createLoginLimiter(maxFailures = 10, windowMs = 15 * 60 * 1000) {
  let failures: number[] = [];
  const prune = (now: number) => {
    failures = failures.filter((t) => now - t < windowMs);
  };
  return {
    blocked(now = Date.now()) {
      prune(now);
      return failures.length >= maxFailures;
    },
    fail(now = Date.now()) {
      prune(now);
      failures.push(now);
    },
    reset() {
      failures = [];
    },
  };
}
