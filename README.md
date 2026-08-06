# GLM Code Review Bot

[z.ai GLM-4.7-Flash](https://docs.z.ai/guides/llm/glm-4.7)로 GitHub Pull Request를 리뷰하고, 결과를 **인라인 리뷰 코멘트**로 남기는 GitHub Action이다. `gemini-code-assist` 대체용으로 만들었다.

- **코드가 OpenAI로 나가지 않는다.** z.ai API를 fetch로 직접 호출한다. OpenAI SDK나 게이트웨이를 거치지 않는다.
- **모델 비용 0원.** `glm-4.7-flash`는 무료 티어다 (200K 컨텍스트 / 128K 출력).
- **코드베이스 맥락을 안다.** diff만 던지지 않고, 변경 파일의 전체 내용 + import 그래프 + 호출부 + 리포지토리 메모리를 함께 넣는다.
- **코멘트로 트리거한다.** PR에 `/review` 한 줄이면 된다.
- TypeScript로 작성했고 외부 런타임 의존이 없다 (번들 하나로 실행).

---

## 빠른 시작

### 1. z.ai API 키 발급

[z.ai 콘솔](https://z.ai/manage-apikey/apikey-list)에서 키를 발급받아, 리뷰를 붙일 리포지토리의
**Settings → Secrets and variables → Actions** 에 `ZAI_API_KEY` 로 등록한다.

### 2. 워크플로 추가

리뷰 대상 리포지토리에 `.github/workflows/code-review.yml` 을 만든다.

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

      # 코드베이스 맥락을 읽으려면 체크아웃이 필요하다
      - uses: actions/checkout@v5
        with:
          ref: ${{ steps.pr.outputs.sha }}

      - uses: it-play/Code-Review-Bot@main
        with:
          zai-api-key: ${{ secrets.ZAI_API_KEY }}
```

### 3. 끝

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
model: glm-4.7-flash
language: ko
minSeverity: minor # 이 미만은 코멘트하지 않는다
maxInlineComments: 25
exclude:
  - 'docs/**'
customInstructions: |
  - any 사용을 지적하라.
  - 외부 API 호출에는 타임아웃과 재시도가 있어야 한다.
```

워크플로 `with:` 로 준 값이 설정 파일보다 우선한다.

| input | 기본값 | 설명 |
| --- | --- | --- |
| `zai-api-key` | (필수) | z.ai API 키 |
| `github-token` | `${{ github.token }}` | 코멘트 작성용 토큰 |
| `model` | `glm-4.7-flash` | `glm-4.7-flashx`, `glm-4.7` 등으로 교체 가능 (유료 모델은 잔액 필요) |
| `fallback-models` | `glm-4.5-flash` | 기본 모델이 막힐 때 시도할 대체 모델 (쉼표 구분) |
| `language` | `ko` | `en`, `ja`, `zh` |
| `min-severity` | `minor` | `critical` / `major` / `minor` / `nit` |
| `auto-review` | `true` | PR 이벤트 시 자동 리뷰 |
| `max-files` | `40` | 한 번에 리뷰할 최대 파일 수 |
| `instructions` | — | 리포지토리별 추가 지침 |

출력은 `findings`, `verdict`, `prompt_tokens`, `completion_tokens`.

---

## 리뷰 품질을 위해 하는 일

LLM 리뷰가 흔히 망하는 지점들을 코드로 막아뒀다.

- **엉뚱한 줄에 코멘트** — diff 렌더링에 변경 후 줄 번호를 직접 박아 넣고, 모델이 지목한 줄을 diff 안의 유효한 위치로 검증·스냅한다. 범위 밖이면 인라인 대신 요약에 싣는다.
- **리뷰 전체가 422로 거절** — 인라인 코멘트가 하나라도 위치 검증에 실패하면 GitHub은 리뷰 전체를 거절한다. 실패 시 요약만 다시 게시해 결과가 사라지지 않게 한다.
- **같은 말 반복** — 기존 봇 코멘트에서 제목을 되뽑아 `파일:줄:제목` 키로 중복을 걸러낸다.
- **깨진 JSON** — `response_format: json_object` 로 요청하고, 코드펜스가 섞여도 균형 잡힌 JSON을 추출한다. 스키마가 안 맞으면 오류를 붙여 한 번 교정을 요청한다.
- **추측성 지적** — 확신도를 함께 받아 `minConfidence` 미만은 버리고, 0.7 미만은 코멘트에 "오탐일 수 있다"를 붙인다.
- **nit 폭격** — 심각도 임계값과 인라인 개수 상한을 둔다.

## 무료 티어에서 알아둘 것

`glm-4.7-flash`는 **공용 무료 용량**이라 혼잡한 시간대에는 요청이 통째로 거절된다 (HTTP 429, 코드 `1305 service temporarily overloaded`).
계정 문제가 아니고, 재시도로 늘 뚫리지도 않는다. 그래서 두 단계로 버틴다.

1. 모델당 최대 4회 지수 백오프 재시도 (`Retry-After` 헤더를 존중한다)
2. 그래도 막히면 `fallbackModels` 의 다음 모델로 전환 — 기본값은 같은 무료 티어의 `glm-4.5-flash`

실제로 응답한 모델은 리뷰 코멘트 하단에 표시된다. 폴백이 자주 걸린다면 z.ai 콘솔에서 잔액을 충전하고
`model: glm-4.7-flashx` 로 바꾸는 편이 낫다 — 입력 $0.07 / 출력 $0.4 per 1M 토큰이라, 이 리포지토리
전체(약 70K 입력 토큰) 리뷰 한 번이 1센트 미만이다.

**주의:** `thinking: true` 일 때 reasoning 토큰도 `maxOutputTokens` 를 소비한다. 부족하면 `finish_reason: length` 로
JSON이 잘린 채 돌아온다. 기본값 24576은 그 여유를 감안한 값이다.

---

## 로컬에서 돌려보기

```bash
npm install
cp .env.example .env   # ZAI_API_KEY, GITHUB_TOKEN 채우기

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
2. 위 워크플로를 추가하고 `ZAI_API_KEY` 시크릿을 등록한다.
3. 기존에 `.gemini/styleguide.md` 를 쓰고 있었다면 그 내용을 `.reviewbot/context.md` 로 옮긴다 — 매 리뷰에 그대로 실린다.

트리거는 `/gemini review` → `/review`, `/gemini summary` → `/summary` 로 대응된다.

---

## 개발

```bash
npm run typecheck   # tsc --noEmit
npm test            # 순수 로직 단위 테스트 (네트워크 없음)
npm run build       # dist/index.mjs 번들
```

`dist/` 는 커밋한다 — Action이 `npm install` 없이 실행되어야 하기 때문이다.
소스를 고쳤으면 `npm run build` 결과를 같이 커밋해야 하고, CI가 어긋남을 검사한다.

```
src/
  index.ts          GitHub Actions 진입점 · 이벤트 라우팅
  cli.ts            로컬 실행용 CLI
  config.ts         기본값 → .reviewbot/config.yml → 액션 input 병합
  glm/client.ts     z.ai 호출 · 재시도 · JSON 검증/교정
  github/
    event.ts        이벤트 페이로드 → 트리거 정규화
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
