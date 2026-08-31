# 리뷰 봇 재설계 계획

작성 2026-08-31. 이 문서는 구현 중 참조용이며, 결정이 바뀌면 여기를 먼저 고친다.

## 1. 배경

지금 봇은 GSML 게이트웨이 단일 모델에 묶여 있다. 모델 서버가 슬롯을 하나만 주기 때문에
큐 동시성이 1이고, push마다 재리뷰하지 않으며, 그 게이트웨이가 죽으면 리뷰가 통째로 멈춘다.
또 GSML이 OpenAI `tools` 파라미터를 조용히 버려서 도구 호출을 system 메시지 주입과
`<tool_call>` XML 파싱으로 흉내 내고 있다 — 응답이 `max_tokens`에서 잘리면 블록이 닫히지
않아 통째로 버려지고, "모델이 도구를 안 불렀다"와 구분되지 않는다.

재설계의 목표는 **모델 provider를 다섯 개로 늘려 가용성과 품질을 확보하고, 그에 맞는
내구성 있는 실행 기반을 갖추는 것**이다.

참고 대상은 `it-play/sandrone-code-review-bot`(Go, hexagonal)이다. 구조를 베끼지는 않고
diff 파싱의 `Complete` 플래그와 hunk 해시 개념만 가져온다.

## 2. 확정된 결정

| 축 | 결정 | 근거 |
|---|---|---|
| 이행 전략 | 껍데기 교체, 코어 보존 | `diff` 줄 번호 계산과 `prepareFindings`는 GitHub 422를 부르는 위험 구역인데 테스트가 없다. 재작성이 가장 위험한 코드다 |
| 디렉터리 | `src/core/`(도메인 + 포트) + `src/modules/`(어댑터 + 프로세스 경계) | 핵심 로직을 core 에 두되 구체 구현이 아니라 포트에 의존시킨다. 위험 구역이 격리되어 나중에 테스트를 붙일 때 구조를 다시 안 건드린다 |
| 프레임워크 | NestJS | 사용자가 아는 백엔드 프레임워크 |
| 빌드 | tsc + `tsc-alias`, CJS, `node_modules` 포함 | esbuild는 `emitDecoratorMetadata` 를 지원하지 않아 Nest 기본 DI 가 안 돈다. Nest 공식 구성이 CJS 라 문서·예제와 맞춘다 — 코드에 ESM 전용 문법이 없어 전환 비용이 없었다 |
| 큐 | Redis + `@nestjs/bullmq` | 재시도·지연·동시성 제한·중복 제거를 직접 안 짜도 된다. 마커도 같은 Redis에 둔다 |
| 멀티턴 | `read_file` 도구 루프 유지 | diff만 보고 내리는 오탐을 줄이는 장치 |
| 출력 규약 | 네이티브 tool calling | 서버측 그래머 강제라 파싱 실패가 구조적으로 줄어든다 |
| 코드 반출 | 제약 폐기 | 리포 종류와 무관하게 모든 provider를 쓴다 |
| GSML | 체인에서 제거 | 반출 제약이 사라지면 남는 가치는 무료 쿼터뿐인데, 유일하게 XML 어댑터가 필요한 특수 케이스다 |
| provider | Google AI Studio, OpenRouter, GitHub Models, Mistral, GLM | tool calling 지원 + 서버 사이드 적합 |
| failover | 고정 순위 + cooldown, 배치 단위 전환 | cooldown이 provider 단위라 한 번 429가 뜨면 그 PR의 남은 배치도 같은 대체 provider로 간다 — 실제 품질 편차는 작다 |
| 배치 예산 | provider별 예산, 폴백 시 재분할 | 1순위에서 큰 묶음으로 호출 수를 줄이고, 작은 provider로 내려가도 배치가 들어간다 |
| 재리뷰 | push 증분 + debounce | 완료 마커가 이미 필요하므로 증분이 거의 공짜다 |
| 배치/마커 | 배치=파일 묶음(휘발), 마커=파일별 hunk 해시(영속) | 배치 단위 마커는 안 바뀐 파일까지 다시 보내게 된다. 파일 단위면 배치 재분할도 자유롭다 |
| 게시 | 인라인은 추가, 요약은 하나를 edit | push마다 요약이 쌓이는 것을 막는다 |
| 부분 실패 | 매 시도 후 증분 게시 + 백오프 재시도, 최종 실패는 요약에 명시 | 사용자가 수십 분 동안 아무것도 못 보는 상황을 막는다 |
| 검증 라이브러리 | zod | LLM 출력 검증이 HTTP 경계 밖 `core/`에 있고, 웹훅·finding이 판별 유니온이다 |
| 관측 | 구조화 로그, 대시보드는 나중 | 인프라를 안 늘리고 대부분의 운영 질문에 답한다 |
| 테스트 | 후속으로 미룸 | `core/`는 순수하게 유지해 나중에 붙일 때 재구조화가 없게 한다 |
| 쓰레드 답글 | 같이 이전 | 배치·마커와 무관하고 provider 체인만 갈아끼우면 된다 |
| 작업 순서 | core 분리 → 인프라 → provider 교체 | 구조를 두 번 안 건드린다 |

## 3. 구조

경계 기준은 **핵심 로직인가**다. 도메인 로직과 그것이 의존하는 포트 인터페이스는 `core/`,
포트의 구체 구현(어댑터)과 프로세스 경계(HTTP 서버, 부팅, 큐 배선)는 `modules/` 다.

I/O 유무를 기준으로 삼지 않는 이유는, 이 봇의 핵심 로직인 `runReview` · `requestReview` 가
GitHub 과 모델을 부르기 때문이다. 그것을 I/O 라는 이유로 밖에 두면 정작 중요한 것이 core
바깥에 남는다. 대신 그 로직들이 구체 구현이 아니라 포트에 의존하게 한다 — 이미 그렇게 되어
있었다. `runReview` 는 Octokit 을 모르고 `GitHubClient` 타입만 안다.

```
src/
  core/                    도메인. modules 를 import 하지 않는다 (단방향)
    config/                설정 타입·병합 (consts, lib, model)
    diff/                  unified diff 파싱, 줄 스냅, 렌더 (lib, model)
    event/                 웹훅 payload 파싱 (lib, model)
    github/port.ts         GitHubClient 포트
    llm/                   도구 호출 파싱, 타입, LlmClient 포트 (lib, model)
    ports/logger.ts        Logger 포트 + setLogger
    review/                리뷰 도메인 전부
      commands/            트리거 판정
      prompt/              프롬프트 조립
      render/              코멘트 문자열 생성
      runner/              배치 구성, 도구 루프, finding 정제
      schema/              zod 스키마
      source/              파일 원본 발췌
      thread/              쓰레드 답글

  modules/                 어댑터와 배선
    github/app/            App 인증 어댑터
    github/client/         Octokit 어댑터
    llm/client.ts          LlmClient 구현
    logger.ts              Logger 구현 (콘솔)
    net.ts                 fetch 오류 해석
    server/                Nest 앱 — HTTP, 웹훅, 큐, 핸들러 배선
```

경계는 두 명령으로 검증한다. 둘 다 결과가 없어야 한다.

```bash
grep -rn '@/modules/' src/core/          # core → modules 의존
grep -rn 'octokit\|fetch(\|node:fs\|process\.env' src/core/   # core 안의 직접 I/O
```

import 규약은 기존과 같다 — 슬라이스를 넘을 때는 `@/` 별칭(`tsconfig.json` 의 `paths`,
`@/*` → `src/*`)을 쓰고, 같은 슬라이스 안에서는 상대 경로를 유지한다.

**Nest 배선.** `server/` 아래 모듈은 `config`(`@nestjs/config` 네임스페이스) · `queue`(리뷰 큐) ·
`handler`(App 인증과 이벤트 판정) · `webhook`(POST /webhook) · `health`(GET /, /health) 다.
본문은 Express 파서 대신 `raw` 로 받는다 — 서명은 원본 바이트에 대해 계산되고, 파서가 먼저
400 을 내면 서명 없는 요청과 깨진 JSON 이 구분되지 않는다. 프레임워크 로그는
`nest-logger.ts` 가 Logger 포트로 넘겨 출력 형식을 하나로 유지한다.

환경변수는 `@nestjs/config` 로만 읽는다. `config/model/server-config.ts` 의 `registerAs("server", …)`
하나가 zod 로 검증까지 하고, 리포 설정 위에 얹을 `REVIEWBOT_*` 값도 같은 자리에서 만든다 —
`modules/config/env-overrides.ts` 는 없앴고 그 결과는 `HandlerDeps.repoOverrides` 로 흘러간다.
형식이 틀린 값은 부팅을 멈춘다. 예외는 `modules/logger.ts` 의 `REVIEWBOT_DEBUG` 뿐이다 —
로거는 Nest 가 뜨기 전에 꽂아야 해서 DI 밖에 있다.

biome 의 `style/useImportType` 은 껐다. 주입받는 클래스의 import 를 `import type` 으로
바꿔버리는데, 그러면 `emitDecoratorMetadata` 가 타입 대신 `Object` 를 실어 Nest 가 의존을
못 찾는다 — 타입체크는 통과하고 런타임에만 터지는 종류의 고장이다.

**Logger 포트.** 도메인도 무슨 일이 있었는지는 남겨야 한다 — 지적을 몇 건 왜 버렸는지는
밖에서 다시 계산할 수 없다. 그래서 로그 호출을 걷어내는 대신 인터페이스만 core 에 두고
구현은 `modules/logger.ts` 가 넣는다. 부팅에서 `setLogger(consoleLogger)` 를 부르지 않으면
아무 데도 나가지 않는다 — 테스트에서 로그가 새지 않게 하려는 것이다.

## 4. 데이터 흐름

```
GitHub 웹훅
  → 서명 검증 → 이벤트 파싱 → 202 즉시 응답
  → BullMQ enqueue (jobId = owner/repo#pr, debounce delay)

리뷰 잡 (워커)
  → PR diff 수집, 리포 설정·지침 로드
  → 파일별 hunk 해시 계산
  → Redis 마커와 대조 → 다시 볼 파일만 추림
  → 없으면 종료 (요약만 갱신)
  → 1순위 provider 예산으로 배치 구성 (경로 정렬 = 결정적)
  → 배치마다:
       provider 체인 순회
         → 컨텍스트 초과면 배치를 반으로 쪼개 재시도
         → 429/5xx/timeout이면 cooldown 등록 후 다음 provider
         → 스키마 위반이면 그 배치 실패로 확정 (우회하지 않음)
       성공하면 즉시 파일 마커 기록
  → 성공분으로 finding 정제 (경로 해석 → 줄 스냅 → 심각도 → dedupe → 개수 제한)
  → 이미 게시한 dedupeKey 제외
  → 인라인 코멘트 게시 (새 리뷰)
  → 요약 코멘트: 마커로 찾아 edit, 없으면 생성
  → 실패 배치가 남았고 시도 여유가 있으면 throw → BullMQ 백오프
  → 최종 시도면 요약에 못 본 파일을 명시하고 정상 종료
```

크래시 재개와 증분 재리뷰가 **같은 경로를 탄다.** 프로세스가 배치 도중 죽어도, push가 와도,
마커가 없는 파일만 다시 배치로 묶인다. 분기가 없다.

## 5. Redis 키 설계

| 키 | 타입 | 내용 | TTL |
|---|---|---|---|
| `rb:marker:{owner}/{repo}#{pr}` | Hash | field=파일경로, value=파일 해시 | 30일 (갱신 시 연장) |
| `rb:posted:{owner}/{repo}#{pr}` | Set | 이미 게시한 dedupeKey | 30일 |
| `rb:summary:{owner}/{repo}#{pr}` | String | 요약 issue comment id | 30일 |
| `rb:cooldown:{provider}` | String | cooldown 사유 | 사유별 (429는 분 단위, 일일 한도는 시간 단위) |
| BullMQ `review` 큐 | — | jobId = `{owner}/{repo}#{pr}` | — |
| BullMQ `thread` 큐 | — | jobId = 코멘트 id | — |

PR이 closed/merged 되면 `rb:*:{owner}/{repo}#{pr}` 를 지운다. TTL은 그 이벤트를 놓쳤을
때의 안전망이다.

## 6. providers.yml

서버 운영자 소관이다. 리포지토리의 `.reviewbot/config.yml`에서는 provider를 못 고른다 —
리포 주인이 운영자 키로 임의 모델을 부르는 것을 막기 위해서다.

```yaml
# 위에서부터 순서대로 시도한다
providers:
  - name: google
    api: google              # pi-ai의 API surface
    model: <확정 필요>
    apiKey: ${GOOGLE_API_KEY}
    maxPromptChars: 400000
    timeoutMs: 120000

  - name: glm
    api: openai
    baseUrl: https://api.z.ai/api/paas/v4    # 중국 본토는 open.bigmodel.cn
    model: <확정 필요>
    apiKey: ${GLM_API_KEY}
    maxPromptChars: 200000
    timeoutMs: 120000

  - name: openrouter
    api: openai
    baseUrl: https://openrouter.ai/api/v1
    model: <tool calling 지원 :free 모델로 고정>
    apiKey: ${OPENROUTER_API_KEY}
    maxPromptChars: 100000
    timeoutMs: 120000

  - name: github-models
    api: openai
    baseUrl: https://models.github.ai/inference
    model: <확정 필요>
    apiKey: ${GITHUB_MODELS_TOKEN}
    maxPromptChars: 100000
    timeoutMs: 120000

  - name: mistral
    api: openai
    baseUrl: https://api.mistral.ai/v1
    model: <확정 필요>
    apiKey: ${MISTRAL_API_KEY}
    maxPromptChars: 100000
    timeoutMs: 120000

cooldown:
  rateLimitMs: 300000        # 429 → 5분
  quotaMs: 3600000           # 일일 한도 소진 → 1시간
  serverErrorMs: 60000       # 5xx → 1분
```

zod로 파싱한다. `${VAR}` 는 env에서 치환하고, 값이 비면 **그 provider만 체인에서 빼고
로그를 남긴다** — 키 하나 없다고 봇이 안 뜨면 안 된다. 전부 비면 부팅 실패다.

모델명은 구현 시점에 각 provider 문서에서 확인해 채운다. 여기에 추측으로 적지 않는다.

## 7. 에러 분류

`core/llm/classify-error.ts` — provider 체인이 이 분류로만 판단한다.

| 분류 | 조건 | 동작 |
|---|---|---|
| `cooldown-rate-limit` | 429, `rate limit`, `too many requests` | provider를 5분 cooldown, 다음 provider |
| `cooldown-quota` | `insufficient_quota`, `out of budget`, `usage limit reached` | provider를 1시간 cooldown, 다음 provider |
| `cooldown-server` | 500/502/503/504, timeout, connection error, socket hang up | provider를 1분 cooldown, 다음 provider |
| `split-batch` | context length exceeded, `too many tokens` | cooldown 없이 배치를 반으로 쪼개 같은 provider 재시도. 파일 하나까지 쪼갰는데도 넘치면 그 파일을 건너뛰고 요약에 명시 |
| `fail-fast` | 400 잘못된 요청, 401/403 인증 | cooldown 없이 그 provider를 이번 잡에서 제외. 모든 provider에서 같은 이유로 실패할 요청에 다섯 번 재시도하는 것은 낭비다 |
| `schema-violation` | 응답이 zod 스키마를 통과하지 못함 | **우회하지 않고 그 배치를 실패시킨다.** 다른 provider로 넘기지도 않는다 — 모델이 규격을 지키게 하는 것이 클라이언트가 덮는 것보다 낫다. 덮으면 틀린 줄 번호가 그대로 GitHub까지 가서 422가 된다 |

`fail-fast`와 `schema-violation`은 반드시 로그에 원문 일부를 남긴다. 사용자 입력은 그대로
안 싣는다.

## 8. core 공개 계약

구현 시 이 시그니처를 기준으로 삼는다. 전부 순수 함수다.

```ts
// core/diff
parseUnifiedDiff(raw: string): DiffFile[]
hunkHash(hunk: DiffHunk): string                          // 줄 번호 제외
fileHash(file: DiffFile): string                          // complete 한 hunk 해시들만
snapToCommentableLine(file: DiffFile, line: number): number | undefined

// core/batch
selectChangedFiles(files: DiffFile[], markers: Map<string, string>): DiffFile[]
buildBatches(files: DiffFile[], budget: BatchBudget): DiffFile[][]   // 경로 정렬 후 구성
splitBatch(batch: DiffFile[]): [DiffFile[], DiffFile[]] | undefined  // 컨텍스트 초과 시

// core/review
prepareFindings(result, files, config): { inline: Finding[]; overflow: Finding[] }
dedupeKey(path: string, line: number, title: string): string
mergeResults(results: ReviewResult[]): ReviewResult

// core/llm
classifyError(error: unknown): ErrorClass
```

`DiffHunk`에 `complete: boolean` 을 추가한다. 헤더가 선언한 `oldLines`/`newLines` 와 실제
센 줄 수가 맞는지 검사한 결과다. 불완전한 hunk를 근거로 줄 번호를 계산하면 422가 나므로
`complete: false` 인 hunk는 코멘트 대상에서 뺀다.

실제 API 응답을 확인한 결과는 다음과 같다. 공식 문서에는 3000파일 제한만 있고 patch 잘림은
문서화되어 있지 않다.

- `GET /pulls/{n}/files` 는 큰 파일의 `patch` 를 **자르는 것이 아니라 통째로 생략**한다.
  `facebook/react#37382` 에서 `yarn.lock`(changes=2180)의 `patch` 필드가 아예 없었다.
  같은 응답에서 `microsoft/vscode#333394` 는 70,986자 patch를 온전히 줬다 — 크기만의 문제는 아니다.
- diff media type(`Accept: application/vnd.github.diff`, 우리가 쓰는 쪽)은 같은 PR에서
  `yarn.lock` 을 포함한 61개 파일을 모두 온전히 줬다. 276KB 였다.

즉 지금 확인된 범위에서 잘린 hunk는 관측되지 않았다. `complete` 는 방어막으로 남기되,
**이것이 실제로 걸리는 상황을 봤다면 그 조건을 여기 적는다.**

## 9. 작업 단계

메모리 규칙에 따라 단계마다 커밋한다. push는 SSH 원격(`git@github.com:it-play/Code-Review-Bot.git`).

| # | 작업 | 배포 가능 | 검증 |
|---|---|---|---|
| 0 | 이 문서 추가, CLAUDE.md 삭제, 봇 이름을 colombina로 변경 | — | 완료 |
| 1 | `src/core/` · `src/modules/` 분리, Logger 포트 도입 | 예 | 완료 — typecheck, build, biome |
| 2 | hunk 해시 + `complete` 플래그 추가 | 예 | 완료 — 스모크 확인. **큰 PR 로 실제 확인 필요** |
| 3 | tsc 빌드 전환(CJS), Dockerfile 멀티스테이지 조정 | 예 | 완료 — 빌드·실행 확인. **도커 이미지 빌드는 미검증**(로컬 데몬 꺼짐, CI 가 확인) |
| 4 | Nest 스캐폴드 + `modules/` 어댑터, 기존 http-server 대체 | 예 | 완료 — 로컬 기동 후 서명 웹훅으로 ping·큐 적재·거절·종료 확인, 설정 검증 실패 경로 확인 |
| 5 | Redis + BullMQ 도입, 인메모리 큐 제거, compose에 redis 추가 | 예 | 재기동 후 잡 재개 확인 |
| 6 | 마커 저장소 + 증분 재리뷰 + push debounce | 예 | **실제 PR 필요** — 증분 판정 |
| 7 | 요약 코멘트 edit 방식으로 전환 | 예 | 실제 PR 필요 |
| 8 | 부분 실패 게시 + 백오프 재시도 | 예 | 실패 주입으로 확인 |
| 9 | pi-ai 도입 + provider 체인 + failover, GSML 제거 | 예 | **실제 PR 필요** — 최대 변경 |
| 10 | providers.yml + 구조화 로그 | 예 | — |
| 11 | 쓰레드 답글을 새 구조로 이전 | 예 | 실제 PR 필요 |

9단계가 가장 크다. 필요하면 provider를 하나(Google)만 먼저 붙여 돌려보고 나머지를 더한다.

## 10. 확인이 필요한 가정

구현 전에 실제로 확인한다. 여기에 추측을 사실처럼 적지 않는다.

- **pi-ai가 다섯 provider를 다 커버하는가.** 확인된 것: 재시도는 같은 provider 한정
  (`utils/retry.ts`, `provider-retry.ts`)이고 cross-provider failover는 없다 — 우리가 짠다.
  API surface 4종(OpenAI Completions/Responses, Anthropic Messages, Google Generative AI)을
  지원한다고 되어 있으니 Google은 native, 나머지 넷은 OpenAI 호환으로 붙을 것으로 보이나
  GLM·GitHub Models의 tool calling 응답 형식이 그대로 파싱되는지는 확인해야 한다.
- **BullMQ의 debounce 방식.** BullMQ 5.x에 `deduplication` 옵션이 있는 것으로 알고 있으나
  버전과 동작(기존 delayed 잡의 delay 갱신 여부)을 문서에서 확인한다. 안 되면 `jobId` +
  `delay` 로 직접 구현한다.
- **각 provider의 모델명·엔드포인트·무료 한도.** providers.yml의 `<확정 필요>` 자리다.
이미 확인한 것 (다시 조사하지 않는다):

- **pi-ai의 reasoning 처리 범위.** `packages/ai/src/api/openai-completions.ts:596` 에서
  `reasoning_content` / `reasoning` / `reasoning_text` 를 순서대로 보고 첫 비어있지 않은
  필드만 써서 `ThinkingContent` 블록으로 분리한다. OpenRouter의 `reasoning_details` 도
  다루고, llama.cpp 계열도 주석에 명시돼 있다. **그러나 본문 텍스트에 인라인된
  `<think>...</think>` 는 파싱하지 않는다** — 파일 전체에 그 문자열이 없다.
  따라서 `strip-think-block.ts` 는 남긴다. 다만 위치가 바뀐다 — 파싱 경로가 아니라
  본문을 받은 뒤의 방어적 후처리다. 어떤 provider가 태그를 본문에 섞어 보내는지는
  9단계에서 실제로 보고 로그에 남긴다.

## 11. 후속 작업

- **`core/`에 단위 테스트.** node:test 내장 러너로 의존성 없이. diff 파싱, hunk 해시,
  배치 구성, 줄 스냅, finding 검증에 골든 케이스를 둔다. 실제로 422를 냈던 diff를 고정
  픽스처로 박아두면 회귀를 막는다. `core/`를 순수하게 유지하는 이유가 이것이다.
- **bull-board 대시보드.** 큐 상태·재시도·실패 잡을 웹 UI로. 인증을 같이 붙인다.
- **리포별 provider 선호.** 서버가 허용 목록을 정하고 리포는 그 안에서 순서만 고르는 형태.
- **큰 파일의 hunk 분할.** 지금은 `maxFileChars` 로 자른다. 잘린 부분은 리뷰되지 않는다.
