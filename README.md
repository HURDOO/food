# 은혜 갚는 호랑이 (food)

밥약 끝나고 올리는 감사 스토리에 붙이는 **선배 헌정관**. 링크를 누르면 선배를 신문 1면, 영수증, 상장으로 치켜세우는 6장면이 인스타 스토리처럼 탭으로 넘어간다. 만드는 사람은 나 한 명이고, 보는 사람은 링크를 받은 선배와 스토리를 본 친구들이다.

- 기획과 시안: [`docs/plan.html`](docs/plan.html)
- 헌정관: `/h/<id>` (링크만 있으면 열림, 검색엔진 색인 안 함)
- 만들기·관리: `/admin` (비밀번호 로그인)

## 장면

1. 입장: 워드아트, 경고문, 방문자 카운터(진짜 조회수)
2. 속보: 밥약일보 1면. 올린 사진과 내가 쓴 한마디가 기사에 들어간다
3. 은혜 영수증: 금액은 기본 비공개
4. 상장: 주접 레벨(1 예의 바름, 2 주접, 3 광기)에 따라 상 이름과 문구가 바뀐다
5. "또 사주실 거죠?": '아니요'는 도망가고 '네'를 누르면 기록된다
6. 보은권: 선배가 고른 메뉴가 기록된다. 관리 화면에서 볼 수 있다

## 로컬 실행

```bash
pnpm install
pnpm dev        # http://localhost:3000/admin, 개발용 비밀번호는 dev
```

`pnpm dev`는 브라우저 파일을 지켜보며 다시 빌드하고, 서버는 `src/server/index.ts`를 Node의 TypeScript 실행 기능으로 바로 돌린다. 데이터는 `./data`에 쌓인다(Git에서 제외).

| 명령 | 하는 일 |
| --- | --- |
| `pnpm check` | 타입 검사 + 테스트 + 빌드 (배포 전 검사도 이것) |
| `pnpm test` | `node --test`로 `test/*.test.ts` 실행 |
| `pnpm build` | `dist/public`(해시 붙은 JS·CSS, `manifest.json`)과 `dist/server.mjs` |
| `pnpm start` | 빌드된 서버 실행 |

## 설정

| 이름 | 어디서 | 설명 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | deployd **Secrets** (필수) | 관리자 비밀번호. 운영에서는 8자 이상. 바꾸면 기존 로그인이 모두 풀린다 |
| `APP_BASE_URL` | deployd 제공 | 링크·카톡 미리보기 이미지의 절대 주소 |
| `STORAGE_DIR` | deployd 제공 (`/data`) | 데이터 위치. 로컬 기본값 `./data` |
| `PORT`, `HOST`, `NODE_ENV` | deployd 제공 | 기본 3000, 0.0.0.0 |
| `ALLOW_DEV_PASSWORD` | 로컬 전용 | `1`이고 운영이 아니면 비밀번호 없이 `dev`를 쓴다. `pnpm dev`가 켠다 |

비밀번호 값은 저장소, 이미지, 핸드오프 JSON 어디에도 넣지 않는다.

## 데이터

```
/data
  tributes/<id>.json      헌정관 하나 (입력값 + 조회수·약속·보은 선택)
  photos/<id>-<v>.jpg     사진. 바꿀 때마다 새 이름
  session.key             관리자 세션 서명 키 (처음 실행할 때 생성)
```

DB 없이 파일로 저장한다. 쓰기는 임시 파일에 쓴 뒤 이름을 바꾸는 방식이라 중간에 꺼져도 반쯤 쓴 파일이 남지 않는다. 이미지 롤백은 `/data`를 되돌리지 않는다.

## 보안·개인정보

- 사진은 관리 화면에서 긴 쪽 1600px JPEG로 줄여 올리고, 서버에서 한 번 더 EXIF(위치정보)·주석을 지운다. JPEG가 아니면 받지 않는다.
- 헌정관 주소는 무작위 10자라 남이 짐작하기 어렵다. `noindex`로 검색에 안 잡히게 한다.
- 관리자 쿠키는 HttpOnly·Secure·SameSite=Lax, 다른 사이트에서 온 POST는 막는다. 비밀번호는 15분에 10번까지만 틀릴 수 있다.
- 조회수는 내가 로그인한 상태로 연 것과 링크 미리보기 봇은 세지 않는다.

## 배포 (deployd)

`deploy.json`은 `ghcr.io/hurdoo/food`, 내부망 전용(`access: private`, LAN·WireGuard에서만 접속), `/data` 사용, 필수 secret `ADMIN_PASSWORD`로 잡혀 있다. 주소는 `https://food.app.hurdoo.kr`.

처음에는 내부망에서 폰으로 확인한 뒤 공개한다. 헌정관은 선배가 인스타에서 바로 열어야 하므로 실제로 쓸 때는 공개가 필요하다. 관리 화면은 공개 후에도 비밀번호로 잠긴다.

공개로 바꾸기: `deploy.json`의 `access`를 `public`으로 바꿔 커밋하고, `node /Users/hurdoo/coding/production/bin/deployctl.mjs --json --compact settings food`의 출력을 대시보드 앱의 **설정**에 붙여 넣는다. 이미지는 다시 만들지 않는다.

1. GitHub에 `HURDOO/food` 저장소를 만들고 `hurdooagent`를 Write 권한 협업자로 추가한 뒤, 커밋을 올린다 (`deployctl publish`는 깨끗한 커밋에서만 동작).
2. 처음 한 번은 GitHub Actions의 **Bootstrap GHCR package**를 손으로 실행해 패키지를 저장소에 연결한다.
3. 이 프로젝트를 작업 폴더로 Codex 세션을 열고 `deploy-project` 스킬로 "배포해줘" → 이미지 publish와 핸드오프 JSON.
4. deployd 대시보드 **새 앱 배포**에 JSON을 붙여 넣고 제출한다. 첫 배포는 `ADMIN_PASSWORD`가 아직 없어서 secret preflight에서 멈추는 게 정상이다.
5. 앱의 **Secrets**에 `ADMIN_PASSWORD`를 넣고, **배포**에서 같은 이미지로 다시 시도한다.
6. `https://food.app.hurdoo.kr/admin`에서 로그인해 헌정관을 만든다.

이미지는 deployd 실행 조건(UID 0, 권한 전부 제거, `no-new-privileges`, 읽기 전용 루트, `/tmp` tmpfs, `/data`만 쓰기)에서 동작하도록 만들었다.

## 구조

```
src/shared/tribute.ts   데이터 형식, 검증, 조사 처리, 화면용 값
src/shared/scenes.ts    6장면 HTML (서버 렌더링과 관리 화면 미리보기가 같이 씀)
src/server/             Hono 서버: 라우트(app.ts), 파일 저장소, 세션, JPEG 정리, 페이지
src/client/tribute.ts   헌정관 동작 (페이지에 직접 들어가고 CSP 해시로 허용)
src/client/admin.ts     관리 화면 동작 (사진 줄이기, 미리보기, 복사, 삭제)
test/                   단위·통합 테스트
```
