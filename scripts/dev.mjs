// 로컬 개발: 관리 화면 파일과 공용 도구(kit)를 지켜보며 다시 빌드하고, 서버는 소스(.ts)를 바로 실행한다.
// pages/와 examples/의 페이지는 /dev/<이름>/에서 바로 볼 수 있다.
// 관리자 비밀번호를 따로 주지 않으면 개발용 'dev'를 쓴다 (운영에서는 쓸 수 없음).

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('pages', { recursive: true });

const env = {
  ...process.env,
  ALLOW_DEV_PASSWORD: '1',
  STORAGE_DIR: process.env.STORAGE_DIR || 'data',
  DEV_PAGE_DIRS: 'pages,examples',
};
const children = [spawn(process.execPath, ['scripts/build.mjs', '--watch'], { stdio: 'inherit', env })];

// 첫 빌드가 manifest를 쓸 시간을 조금 준다.
setTimeout(() => {
  children.push(spawn(process.execPath, ['--watch', 'src/server/index.ts'], { stdio: 'inherit', env }));
}, 800);

const stop = () => {
  for (const child of children) child.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
