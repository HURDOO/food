# 은혜 갚는 호랑이 (food)

밥약 끝나고 스토리에 붙이는 **손수 만든 고마움 페이지**. 정해진 템플릿 대신, 상대와 테마에 맞춰 페이지를 매번 코드로 새로 쓴다. 서버는 올린 페이지를 비밀 주소(`/h/<id>/`)로 보여 주고, 조회수와 반응(버튼을 눌렀는지, 무엇을 골랐는지)을 기록한다.

- 페이지 만드는 규칙: [`AGENTS.md`](AGENTS.md)
- 공용 도구 사용법: [`src/kit/kit.ts`](src/kit/kit.ts) 맨 위 주석
- 예시 페이지(가짜 이름): [`examples/sample/`](examples/sample/)
- 처음 기획과 시안: [`docs/plan.html`](docs/plan.html)

## 흐름

```bash
pnpm install
pnpm dev                      # http://localhost:3000/dev/ 에서 pages/·examples/ 미리보기
pnpm page new minsu-1111      # pages/minsu-1111/ 만들기 (examples/sample 복사)
# … pages/minsu-1111/ 의 index.html, style.css, 사진을 고친다
pnpm page push minsu-1111     # 운영 서버에 올리고 링크 출력. 다시 올리면 같은 주소로 고쳐짐
```

`pages/`는 실제 이름과 사진이 들어가서 Git과 Docker 이미지에서 빠진다. 페이지는 이미지가 아니라 서버의 `/data`에 올라가므로, 새 페이지를 낼 때 이미지를 다시 배포할 필요가 없다.

`pnpm page push`는 사진을 긴 쪽 1600px로 줄이고(macOS `sips`) 위치정보를 지운 뒤, 그 시점의 `kit.js`·`kit.css`를 같이 올린다. 운영 서버 비밀번호는 프로젝트 폴더의 `password.txt` 한 줄에서 읽는다(Git·Docker 제외, 값은 출력하지 않음). deployd Secrets의 `ADMIN_PASSWORD`와 같은 값이어야 한다.

`--to http://localhost:3000`처럼 로컬·내부망 개발 서버로 올릴 때는 개발용 비밀번호 `dev`를 쓴다.

## 공용 도구 (kit)

HTML에 `data-*` 속성만 달면 동작한다. 자세한 건 `src/kit/kit.ts` 주석.

| 기능 | 쓰는 법 |
| --- | --- |
| 스토리 무대 | `<main data-story>` 안에 `<section class="scene">`. 280×580 설계, 탭으로 넘김, 진행 막대 |
| 넘기기 | `data-next`, `data-next="1500"`, `data-prev`, `data-go="0"` |
| 도망가는 버튼 | `data-arena` 안에 `data-dodge="아니|진짜?"`, 커지는 버튼은 `data-grow` |
| 꽃가루 | `data-confetti`, 이모지는 `data-confetti="🍖,🍜"` |
| 반응 기록 | `data-react="키"` (버튼, 라디오 묶음, 선택 상자) |
| 보이기·숨기기 | `data-show="id"`, `data-hide="id"`, `data-reset` |
| LED 방문자 수 | `<span class="k-counter" data-counter="6">%VIEWS%</span>` |
| 표지 재료 | `.k-night` `.k-marquee` `.k-sparkles` `.k-wordart` `.k-tag` `.k-warn` `.k-btn95` `.k-stamp` |

## 명령

| 명령 | 하는 일 |
| --- | --- |
| `pnpm dev` | 개발 서버. 관리 화면 파일과 kit를 지켜보며 다시 빌드 |
| `pnpm page new/push` | 페이지 만들기·올리기 |
| `pnpm check` | 타입 검사 + 테스트 + 빌드 (배포 전 검사도 이것) |
| `pnpm build` | `dist/public`(관리 화면), `dist/kit`(공용 도구), `dist/server.mjs` |
| `pnpm start` | 빌드된 서버 실행 |

## 설정

| 이름 | 어디서 | 설명 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | deployd **Secrets** (필수) | 관리 화면 로그인과 페이지 올리기 비밀번호. 운영에서는 8자 이상 |
| `APP_BASE_URL` | deployd 제공 | 링크와 `%PAGE_URL%`의 절대 주소 |
| `STORAGE_DIR` | deployd 제공 (`/data`) | 데이터 위치. 로컬 기본값 `./data` |
| `PORT`, `HOST`, `NODE_ENV` | deployd 제공 | 기본 3000, 0.0.0.0 |
| `ALLOW_DEV_PASSWORD`, `DEV_PAGE_DIRS` | 로컬 전용 | `pnpm dev`가 켠다. 운영에서는 무시 |

## 서버

| 경로 | 내용 |
| --- | --- |
| `/` | 공개 홈. 올린 밥약 카드 목록 (제목, `og:description`, `og:image` 사진, 올린 날) |
| `/h/<id>/` | 올린 페이지. 봇과 내가 로그인한 채 연 건 조회수에 안 셈 |
| `POST /h/<id>/react` | 반응 기록 (kit가 부름) |
| `/admin` | 올린 페이지 목록, 조회수·반응, 링크 복사, 내리기 |
| `POST /api/pages`, `PUT /api/pages/<id>` | 페이지 올리기 (`pnpm page push`가 부름, 비밀번호 필요) |
| `/dev/<이름>/` | 개발 서버에서만. `pages/`·`examples/`를 바로 보여 줌 |

데이터는 파일로 저장한다.

```
/data
  pages/<id>/meta.json   제목, 조회수, 반응
  pages/<id>/b-<v>/      페이지 파일 (다시 올리면 새 폴더로 갈아 끼움)
  session.key            관리자 세션 서명 키
```

## 보안·개인정보

- 페이지에는 같이 올린 스크립트만 돌 수 있다(CSP `script-src 'self'`). 인라인 스크립트는 막힌다.
- 사진은 Mac에서 한 번, 서버에서 한 번 더 EXIF(위치정보)를 지운다.
- 홈(`/`)에 올린 페이지가 모두 보인다. 링크를 아는 사람만 보게 하려면 페이지를 올리지 말 것. 페이지 주소는 무작위 10자, `noindex`. 관리자 쿠키는 HttpOnly·SameSite=Lax(https면 Secure), 다른 사이트에서 온 쓰기 요청은 막는다. 비밀번호는 15분에 10번까지만 틀릴 수 있다.

## 배포 (deployd)

`deploy.json`은 `ghcr.io/hurdoo/food`, 공개(`access: public`, 선배·동기가 인스타에서 열 수 있게), `/data` 사용, 필수 secret `ADMIN_PASSWORD`. 주소는 `https://food.app.hurdoo.kr`. 페이지 주소는 무작위라 아는 사람만 열 수 있고, 올리기와 관리 화면은 비밀번호가 있어야 한다.

1. GitHub에 `HURDOO/food` 저장소를 만들고 `hurdooagent`를 Write 권한 협업자로 추가한 뒤 커밋을 올린다.
2. 처음 한 번 GitHub Actions의 **Bootstrap GHCR package**를 실행한다.
3. 이 프로젝트를 연 Codex 세션에서 `deploy-project` 스킬로 "배포해줘" → 이미지 publish와 핸드오프 JSON.
4. deployd 대시보드 **새 앱 배포**에 붙여 넣고 제출한다. 첫 배포는 `ADMIN_PASSWORD`가 없어서 secret preflight에서 멈추는 게 정상이다.
5. 앱 **Secrets**에 `ADMIN_PASSWORD`를 넣고 다시 배포한다. 같은 값을 Mac의 `password.txt`에도 넣는다.

이미지는 deployd 실행 조건(UID 0, 권한 전부 제거, `no-new-privileges`, 읽기 전용 루트, `/tmp` tmpfs, `/data`만 쓰기)에서 동작한다. 이미지 롤백은 `/data`(올린 페이지)를 되돌리지 않는다.
