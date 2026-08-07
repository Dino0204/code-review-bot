# 코드베이스 컨텍스트

리뷰 봇이 매 리뷰마다 읽는 문서다. 사람이 직접 관리한다.
(봇이 스스로 축적하는 메모리는 `.reviewbot/memory.md` 에 쌓인다.)

## 이 리포지토리가 하는 일

GSML 게이트웨이(OpenAI 호환)의 모델로 GitHub Pull Request를 리뷰하고 결과를 PR 코멘트로 남기는 GitHub Action이다.
gemini-code-assist를 대체하는 것이 목적이며, 리뷰 대상 코드는 OpenAI를 포함한 상용 LLM 제공자로 나가지 않는다.

## 모듈 경계

| 디렉터리 | 책임 | 다른 계층 의존 |
| --- | --- | --- |
| `src/llm/` | OpenAI 호환 HTTP 호출, 재시도, 추론 블록 분리, JSON 파싱/교정 | GitHub·리뷰 로직을 몰라야 한다 |
| `src/github/` | Octokit 호출, unified diff 파싱, 코멘트 게시 | 모델 계층을 몰라야 한다 |
| `src/context/` | 코드베이스 맥락 수집 (리포 맵, import 그래프, 메모리 파일) | 순수 파일시스템·git 작업 |
| `src/review/` | 프롬프트 조립, 결과 정제, 오케스트레이션 | 위 세 계층을 조합한다 |
| `src/index.ts` | GitHub Actions 진입점, 이벤트 라우팅 | — |

`src/llm` 과 `src/github` 사이에 직접 import가 생기면 설계가 깨진 것이다.

## 규약

- 모든 사용자 노출 문자열(코멘트, 로그)은 한국어. 식별자·경로·에러 원문은 그대로 둔다.
- 외부 입력(모델 응답, 이벤트 페이로드)은 항상 신뢰하지 않고 검증한다. 모델 출력은 zod 스키마로 받는다.
- 네트워크 호출에는 타임아웃과 재시도가 있어야 한다.
- `dist/` 는 빌드 산출물이지만 커밋한다 — GitHub Action이 설치 없이 실행되어야 하기 때문이다.
  소스를 고치면 `npm run build` 를 함께 커밋해야 하고, CI가 이를 검사한다.

## 건드릴 때 주의할 곳

- `src/github/diff.ts` 의 줄 번호 계산 — 여기가 틀리면 인라인 코멘트가 엉뚱한 줄에 붙거나 GitHub이 리뷰 전체를 422로 거절한다.
- `src/review/runner.ts` 의 `prepareFindings` — 중복 코멘트 방지와 위치 검증이 모두 여기에 걸려 있다.
- 프롬프트 예산(`assemble`) — diff가 먼저 잘리면 리뷰 품질이 곧바로 무너진다. 잘려야 할 것은 리포지토리 개요다.
- `src/llm/client.ts` 의 `splitReasoning` — 모델이 본문 앞에 붙이는 `<think>` 블록을 떼는 곳이다.
  블록 안에는 모델이 검토하던 JSON 초안이 들어 있어서, 안 떼면 초안이 리뷰 결과로 게시된다.

## 테스트

`npm test` — 순수 로직(diff 파서, 명령 파서, 결과 정제)만 다룬다. 네트워크를 타는 테스트는 없다.
실제 PR로 확인하려면 `npm run review -- --repo owner/name --pr N --dry-run`.
