# GSML Code Review Bot

GSML 게이트웨이의 모델로 GitHub Pull Request를 리뷰하고, 결과를 **인라인 리뷰 코멘트**로 남기는 GitHub App이다. `gemini-code-assist` 대체용으로 만들었다.

- **코드가 상용 LLM 제공자로 나가지 않는다.** GSML은 학교에서 직접 서빙하는 모델이고, OpenAI 호환 엔드포인트를 fetch로 직접 호출한다. OpenAI SDK나 중계 게이트웨이를 거치지 않는다.
- **모델 비용 0원.** 하루 13,107,200 토큰까지 쓸 수 있다 (컨텍스트 131K).
- **코드베이스 맥락을 안다.** diff만 던지지 않고, 변경 파일의 전체 내용 + import 그래프 + 호출부 + 리포지토리 메모리를 함께 넣는다.
- **코멘트로 트리거한다.** PR에 `/review` 한 줄이면 된다.
- **GitHub Actions를 쓰지 않는다.** 웹훅을 직접 받는 서버로 돌아가서, Actions 실행 기록도 Actions 분 소모도 없다.
- TypeScript로 작성했고 런타임 의존이 없다 (번들 하나 + git).

---

## 빠른 시작

리뷰 서버를 한 번 띄워두면, 그 뒤로는 App을 설치한 리포지토리마다 설정할 게 없다.

### 1. GSML API 키 발급

[GSML 콘솔](https://gsmsv.site)에서 키를 발급받는다. 서버 환경변수 `GSML_API_KEY` 로 넣는다.
키에는 만료일이 있고, 만료되면 리뷰가 401로 실패하므로 콘솔에서 연장하거나 재발급한다.

리뷰는 **서버에 넣은 키 하나**로 전부 처리된다. App을 여러 리포지토리에 설치해도
할당량은 그 키 하나에서 나가므로, 의도치 않은 소모를 막으려면 아래 `REVIEWBOT_ALLOWED_REPOS` 를 채운다.

### 2. GitHub App 만들기

**Settings → Developer settings → GitHub Apps → New GitHub App**

| 항목 | 값 |
| --- | --- |
| Webhook | **Active 체크** |
| Webhook URL | `https://<서버 주소>/webhook` |
| Webhook secret | 임의의 긴 문자열 (서버의 `GITHUB_WEBHOOK_SECRET` 과 같아야 한다) |
| Repository permissions → Pull requests | `Read & write` |
| Repository permissions → Issues | `Read & write` |
| Repository permissions → Contents | `Read-only` (`memoryAutoCommit: true` 면 `Read & write`) |
| Subscribe to events | **Pull request**, **Issue comment**, **Pull request review comment** |

만든 뒤 **Private key** 를 발급해 `.pem` 파일을 받고, App을 리뷰할 리포지토리에 **Install** 한다.

### 3. 서버 띄우기

```bash
git clone https://github.com/it-play/Code-Review-Bot.git
cd Code-Review-Bot

mkdir -p secrets
cp ~/Downloads/your-app.private-key.pem secrets/app-private-key.pem

cat > .env <<'EOF'
GSML_API_KEY=...
GITHUB_APP_ID=123456
GITHUB_WEBHOOK_SECRET=...
REVIEWBOT_ALLOWED_REPOS=it-play/Code-Review-Bot
EOF

docker compose up -d --build
curl http://localhost:3000/health   # {"ok":true,"queued":0,"active":null}
```

| 환경변수 | 필수 | 설명 |
| --- | --- | --- |
| `GSML_API_KEY` | ✅ | 모델 호출에 쓸 키. 모든 리뷰가 이 키를 쓴다 |
| `GITHUB_APP_ID` | ✅ | App 설정 상단의 숫자 |
| `GITHUB_WEBHOOK_SECRET` | ✅ | App에 설정한 웹훅 시크릿과 같아야 한다 |
| `GITHUB_APP_PRIVATE_KEY_PATH` | ✅* | `.pem` 파일 경로 (compose가 마운트한다) |
| `GITHUB_APP_PRIVATE_KEY` | ✅* | 경로 대신 PEM 내용을 직접 줄 때 |
| `REVIEWBOT_ALLOWED_REPOS` | | `owner/repo` 쉼표 구분. 비우면 설치된 모든 리포지토리를 리뷰한다 |
| `REVIEWBOT_BASE_URL` | | 모델 서버 주소. 같은 호스트면 `http://localhost:26145/v1` 로 두는 게 좋다 |
| `PORT` | | 기본 3000 |

\* 둘 중 하나는 있어야 한다.

### 4. 서버를 GitHub이 부를 수 있게 열기

GitHub이 웹훅을 보내려면 서버가 **공개 주소**로 열려 있어야 한다. HTTPS를 권한다 —
평문 HTTP로 두면 PR 제목·diff 메타데이터가 그대로 오간다.

- 도메인이 있다면 nginx/Caddy로 리버스 프록시 + Let's Encrypt
- 포트를 못 여는 환경이면 `cloudflared tunnel` 이 제일 간단하다 (HTTPS 주소를 공짜로 준다)

열고 나서 App 설정의 **Advanced → Recent Deliveries** 에서 ping이 200으로 갔는지 확인한다.

### 5. 끝

PR을 열면 자동으로 리뷰가 달리고, 언제든 코멘트로 다시 부를 수 있다.

---

## 코멘트 명령

| 명령 | 하는 일 |
| --- | --- |
| `/review` | 변경된 diff를 리뷰한다 |
| `/review security` | 특정 관점(security, performance, 동시성 …)을 우선해서 리뷰한다 |
| `/review full` | 이전 지적 이력을 무시하고 처음부터 다시 리뷰한다 |
| `/ask <질문>` | PR과 코드베이스 맥락을 근거로 답한다 |
| `/summary` | PR 변경 사항을 요약한다 |
| `/learn` | 이 PR에서 배운 것을 코드베이스 메모리에 반영한다 |
| `/review help` | 사용법 |

`/ask`, `/summary`, `/learn` 은 `/review ask …` 처럼 서브커맨드로도 쓸 수 있다.
쓰기 권한이 없는 사용자의 명령은 무시하고 👀 대신 😕 리액션을 단다.

---

## 코드베이스 맥락을 어떻게 기억하나

diff만 보는 리뷰어는 "이 함수를 누가 부르는지", "이 팀이 뭘 금지하는지"를 모른다.
이 봇은 매 리뷰마다 네 갈래로 맥락을 모아 프롬프트에 싣는다.

| 갈래 | 출처 | 무엇을 해결하나 |
| --- | --- | --- |
| **리포지토리 개요** | `git ls-files` 기반 디렉터리 맵, `package.json`, README/CLAUDE.md | 프로젝트가 무엇이고 어떤 스택인지 |
| **관련 코드** | 변경 파일의 import 1홉 + 그 파일을 import 하는 **호출부** + 새 심볼이 등장하는 파일 (`git grep`) | 시그니처 변경이 다른 곳을 깨뜨리는지 |
| **영속 메모리** | `.reviewbot/context.md` (사람이 관리) + `.reviewbot/memory.md` (`/learn` 이 갱신) | 아키텍처 규약, 반복되는 실수 패턴, 건드리면 위험한 영역 |
| **PR 이력** | 이 PR의 기존 봇 코멘트와 사람 논의 | 같은 지적 반복 금지, 이미 합의된 사항 존중 |

예산(`maxPromptChars`)을 넘으면 **diff가 가장 마지막까지 살아남고** 리포지토리 개요부터 잘려나간다.
diff 자체가 예산을 넘으면 파일 단위로 청크를 나눠 여러 번 호출한 뒤 결과를 합친다.

`/learn` 은 이 PR과 기존 메모리를 함께 읽고 **갱신본**을 만든다. 기본값은 코멘트로 제안만 하고,
`memoryAutoCommit: true` + 워크플로에 `contents: write` 를 주면 기본 브랜치에 직접 커밋한다.

---

## 설정

리포지토리 루트의 `.reviewbot/config.yml` 로 조정한다. 전체 항목은 [이 리포의 예시](.reviewbot/config.yml) 참고.

```yaml
model: darwin-35b-q4_k_m.gguf
language: ko
minSeverity: minor # 이 미만은 코멘트하지 않는다
maxInlineComments: 25
exclude:
  - 'docs/**'
customInstructions: |
  - any 사용을 지적하라.
  - 외부 API 호출에는 타임아웃과 재시도가 있어야 한다.
```

설정은 **리포지토리마다** 다르게 줄 수 있다 — 서버가 매 리뷰에서 체크아웃한 리포지토리의
`.reviewbot/config.yml` 을 읽기 때문이다.

서버 환경변수로 전체 기본값을 덮어쓸 수도 있다. 이쪽이 설정 파일보다 우선한다.

| 환경변수 | 대응 설정 |
| --- | --- |
| `REVIEWBOT_MODEL` | `model` |
| `REVIEWBOT_BASE_URL` | `baseUrl` |
| `REVIEWBOT_FALLBACK_MODELS` | `fallbackModels` (쉼표 구분) |
| `REVIEWBOT_LANGUAGE` | `language` |
| `REVIEWBOT_MIN_SEVERITY` | `minSeverity` |
| `REVIEWBOT_AUTO_REVIEW` | `autoReview` |
| `REVIEWBOT_MAX_FILES` | `maxFiles` |
| `REVIEWBOT_TRIGGER_PREFIX` | `triggerPrefix` |
| `REVIEWBOT_INSTRUCTIONS` | `customInstructions` |

---

## 리뷰 품질을 위해 하는 일

LLM 리뷰가 흔히 망하는 지점들을 코드로 막아뒀다.

- **엉뚱한 줄에 코멘트** — diff 렌더링에 변경 후 줄 번호를 직접 박아 넣고, 모델이 지목한 줄을 diff 안의 유효한 위치로 검증·스냅한다. 범위 밖이면 인라인 대신 요약에 싣는다.
- **리뷰 전체가 422로 거절** — 인라인 코멘트가 하나라도 위치 검증에 실패하면 GitHub은 리뷰 전체를 거절한다. 실패 시 요약만 다시 게시해 결과가 사라지지 않게 한다.
- **같은 말 반복** — 기존 봇 코멘트에서 제목을 되뽑아 `파일:줄:제목` 키로 중복을 걸러낸다.
- **깨진 JSON** — `response_format: json_object` 로 요청하고, 코드펜스가 섞여도 균형 잡힌 JSON을 추출한다. 스키마가 안 맞으면 오류를 붙여 한 번 교정을 요청한다.
- **추론 초안이 리뷰로 게시되는 사고** — 이 모델은 본문 앞에 `<think>...</think>` 블록을 붙이는데, 그 안에 답안 JSON 초안이 그대로 들어 있는 경우가 많다. 블록을 먼저 떼어낸 뒤에 JSON을 찾는다.
- **추측성 지적** — 확신도를 함께 받아 `minConfidence` 미만은 버리고, 0.7 미만은 코멘트에 "오탐일 수 있다"를 붙인다.
- **nit 폭격** — 심각도 임계값과 인라인 개수 상한을 둔다.

## GSML을 쓸 때 알아둘 것

GSML은 학교에서 직접 돌리는 llama.cpp 서버다. 상용 API와 다른 점이 몇 가지 있고, 클라이언트가 그 차이를 흡수한다.

**추론을 끌 수 없다.** 모델이 항상 본문 앞에 `<think>...</think>` 블록을 붙이고, 그 추론 토큰도
`maxOutputTokens` 를 함께 소비한다. `enable_thinking: false` 같은 옵션은 무시된다. 그래서
`thinking` 설정 항목은 없앴다 — 켜고 끌 수 없는 것을 설정으로 두면 거짓말이 된다.
추론 블록 안에는 모델이 검토하던 답안 JSON 초안이 들어 있는 경우가 많아서, JSON을 찾기 전에 반드시 떼어낸다.

**응답이 잘려도 `finish_reason` 이 `stop` 으로 온다.** 규격대로라면 `length` 여야 하지만 그렇지 않다.
그래서 `completion_tokens` 가 요청한 `max_tokens` 에 닿았는지로 직접 판별한다.
잘린 것을 확인하면 출력 예산을 두 배(상한 32768)로 올려 한 번 더 부른다. 그래도 잘리면 `maxFiles` 를 줄여야 한다.

**모델이 하나뿐이다.** `/v1/models` 에 뜨는 모델 하나만 서빙하므로 `fallbackModels` 기본값이 비어 있다.
용량이 부족하면 8초에서 60초까지 벌려가며 4회까지 재시도한다 (`Retry-After` 헤더가 있으면 그쪽을 따른다).

**느리다.** 35B 모델을 로컬 GPU에서 돌리므로 큰 프롬프트 하나에 몇 분이 걸린다.
요청 타임아웃은 600초다 — 클라이언트가 먼저 끊어도 서버는 계속 처리하며 슬롯을 물고 있으니 중도 포기가 손해다.
**여러 PR을 동시에 리뷰한다면 호출을 직렬화하는 편이 안전하다.**

**컨텍스트는 131,072토큰이고 출력도 여기서 나눠 쓴다.** 기본값은 프롬프트 140,000자(≈40K 토큰) +
출력 16,384토큰이라 여유가 있다. 하루 한도는 13,107,200토큰이고 콘솔에서 사용량을 볼 수 있다.

### 주의: 엔드포인트가 평문 HTTP다

기본 base URL `http://ssh.gsmsv.site:26145/v1` 은 TLS가 아니다. **API 키가 Authorization 헤더에 평문으로 실려 나가고,
리뷰 대상 코드도 암호화 없이 오간다.** 사내망 밖(예: GitHub Actions 러너)에서 호출한다면 이 점을 감수하는 것이다.
서버에 HTTPS가 붙으면 `base-url` 을 그쪽으로 바꾸는 것이 좋다.

GitHub Actions에서 쓰려면 러너가 `ssh.gsmsv.site:26145` 에 닿을 수 있어야 한다.
학교 네트워크 안에서만 열려 있다면 Actions에서는 실패하고 로컬 실행(`npm run review`)만 동작한다.

---

## 대안: GitHub Actions로 돌리기

서버를 띄우기 어렵다면 Action으로도 쓸 수 있다. 다만 리뷰마다 Actions 실행 기록이 남고
Actions 분을 소모한다 — 이 리포지토리가 서버 방식으로 옮겨온 이유가 그것이다.

리뷰 대상 리포지토리에 워크플로를 추가하고 `GSML_API_KEY` 시크릿을 등록한다.

```yaml
name: Code Review

on:
  pull_request:
    types: [opened, reopened, synchronize, ready_for_review]
  issue_comment:
    types: [created]

concurrency:
  group: code-review-${{ github.event.issue.number || github.event.pull_request.number }}
  cancel-in-progress: true

permissions:
  contents: read
  pull-requests: write
  issues: write

jobs:
  review:
    if: >-
      github.event_name == 'pull_request' ||
      (github.event.issue.pull_request != null && startsWith(github.event.comment.body, '/'))
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Resolve PR head
        id: pr
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          if [ "${{ github.event_name }}" = "issue_comment" ]; then
            sha=$(gh api "repos/${{ github.repository }}/pulls/${{ github.event.issue.number }}" --jq .head.sha)
          else
            sha="${{ github.event.pull_request.head.sha }}"
          fi
          echo "sha=$sha" >> "$GITHUB_OUTPUT"

      - uses: actions/checkout@v5
        with:
          ref: ${{ steps.pr.outputs.sha }}

      - uses: it-play/Code-Review-Bot@main
        with:
          gsml-api-key: ${{ secrets.GSML_API_KEY }}
```

`/review` 코멘트로 트리거하려면 이 워크플로가 **기본 브랜치에** 있어야 한다 —
GitHub은 `issue_comment` 이벤트에 대해 기본 브랜치의 워크플로만 읽는다.

액션 input은 [`action.yml`](action.yml) 참고. `auto-review: false` 로 두면 코멘트로 부를 때만 돈다.

---

## 로컬에서 돌려보기

```bash
npm install
cp .env.example .env   # GSML_API_KEY, GITHUB_TOKEN 채우기 (로컬 CLI는 개인 토큰을 쓴다)

# 게시하지 않고 결과만 확인
npm run review -- --repo it-play/Code-Review-Bot --pr 12 --dry-run

# 실제로 코멘트 게시
npm run review -- --repo it-play/Code-Review-Bot --pr 12
npm run review -- --repo it-play/Code-Review-Bot --pr 12 --ask "이 변경이 캐시를 깨뜨리나?"
```

`--dry-run` 은 프롬프트 길이, 수집된 관련 파일, 지적 목록을 콘솔에 뿌린다. 프롬프트 튜닝에 쓴다.

---

## gemini-code-assist에서 갈아타기

1. 리포지토리 설정에서 gemini-code-assist GitHub App을 제거하거나, `.gemini/config.yaml` 에서 자동 리뷰를 끈다.
2. 리뷰 서버를 띄우고, App을 그 리포지토리에 설치한다. 리포지토리에는 아무것도 추가하지 않아도 된다.
3. 기존에 `.gemini/styleguide.md` 를 쓰고 있었다면 그 내용을 `.reviewbot/context.md` 로 옮긴다 — 매 리뷰에 그대로 실린다.

트리거는 `/gemini review` → `/review`, `/gemini summary` → `/summary` 로 대응된다.

---

## 개발

```bash
npm run typecheck   # tsc --noEmit
npm test            # 순수 로직 단위 테스트 (네트워크 없음)
npm run build       # dist/index.mjs 번들
```

`npm run build` 는 `dist/index.mjs`(Actions용)와 `dist/server.mjs`(도커용) 두 개를 만든다.
`dist/` 는 커밋한다 — Action이 `npm install` 없이 실행되어야 하기 때문이다.
소스를 고쳤으면 빌드 결과를 같이 커밋해야 하고, CI가 어긋남을 검사한다.

**워크트리에서 빌드할 때 주의**: 워크트리에 자체 `node_modules` 가 없으면 node가 상위 디렉터리의
것을 쓰고, esbuild가 번들에 `../../../node_modules/...` 경로를 박아 CI 재빌드와 어긋난다.
워크트리 안에서 `npm ci` 를 먼저 돌려야 한다.

```
src/
  server/
    index.ts        웹훅 서버 진입점 (HTTP · 라우팅)
    webhook.ts      서명 검증 · 본문 읽기
    handler.ts      이벤트 필터 · 권한 확인 · 리뷰 실행
    queue.ts        동시 실행 1의 작업 큐
    workspace.ts    리뷰 대상 커밋 얕은 체크아웃
  index.ts          GitHub Actions 진입점 (대안 경로)
  cli.ts            로컬 실행용 CLI
  config.ts         기본값 → .reviewbot/config.yml → 환경변수 병합
  llm/client.ts     OpenAI 호환 호출 · 재시도 · 추론 블록 분리 · JSON 검증/교정
  github/
    event.ts        이벤트 페이로드 → 트리거 정규화 (Actions·웹훅 공용)
    app.ts          GitHub App JWT 서명 · 설치 토큰 발급
    client.ts       Octokit 래퍼 (리뷰 게시, 권한 확인, 파일 커밋)
    diff.ts         unified diff 파서 · 줄 번호 계산 · 위치 검증
  context/
    repoMap.ts      디렉터리 맵 · 매니페스트 · 문서
    retriever.ts    import 그래프 · 호출부 · 심볼 검색
    memory.ts       영속 메모리 파일 · PR 이력
    budget.ts       프롬프트 예산 배분
  review/
    commands.ts     코멘트 명령 파싱
    prompt.ts       시스템/유저 프롬프트 조립
    schema.ts       모델 출력 스키마 (zod)
    runner.ts       오케스트레이션 · 결과 정제
    render.ts       코멘트 마크다운 렌더링
```

## 라이선스

MIT
