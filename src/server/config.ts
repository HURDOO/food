import { resolve } from 'node:path';

export interface Config {
  production: boolean;
  port: number;
  host: string;
  baseUrl: string;
  storageDir: string;
  assetsDir: string;
  adminPassword: string;
  secureCookies: boolean;
}

/**
 * 실행 설정. APP_BASE_URL, STORAGE_DIR, PORT, HOST, NODE_ENV는 deployd가 넣어 준다.
 * ADMIN_PASSWORD는 대시보드 Secrets로만 넣는다. 로컬 개발에서는 ALLOW_DEV_PASSWORD=1일 때만 'dev'를 쓴다.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('PORT must be a valid port number');

  let adminPassword = env.ADMIN_PASSWORD ?? '';
  if (!adminPassword) {
    if (!production && env.ALLOW_DEV_PASSWORD === '1') adminPassword = 'dev';
    else throw new Error('ADMIN_PASSWORD is required');
  }
  if (production && adminPassword.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters');

  const baseUrl = (env.APP_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');
  new URL(baseUrl); // 잘못된 주소면 여기서 멈춘다

  return {
    production,
    port,
    host: env.HOST || '0.0.0.0',
    baseUrl,
    storageDir: resolve(env.STORAGE_DIR || 'data'),
    assetsDir: resolve(env.ASSETS_DIR || 'dist/public'),
    adminPassword,
    secureCookies: baseUrl.startsWith('https://'),
  };
}
