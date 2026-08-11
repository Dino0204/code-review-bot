# GSML Code Review Bot

GSML 게이트웨이의 모델로 GitHub Pull Request를 리뷰하고, 결과를 **인라인 리뷰 코멘트**로 남기는 GitHub App이다. `gemini-code-assist` 대체용으로 만들었다.

- **코드가 상용 LLM 제공자로 나가지 않는다.** GSML은 학교에서 직접 서빙하는 모델이고, OpenAI 호환 엔드포인트를 fetch로 직접 호출한다. OpenAI SDK나 중계 게이트웨이를 거치지 않는다.
- **모델 비용 0원.** 하루 13,107,200 토큰까지 쓸 수 있다 (컨텍스트 131K).
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
| Repository permissions → Contents | `Read-only` |
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

명령은 `/review` 하나뿐이다. PR 코멘트에 이 줄이 있으면 변경된 diff를 리뷰한다.
줄 맨 앞에 있을 때만 인정하므로 `경로는 /review 디렉터리에 있어` 같은 문장에는 반응하지 않는다.
접두사는 `triggerPrefix` 로 바꿀 수 있고, 뒤에 붙는 말은 무시한다.

쓰기 권한이 없는 사용자의 명령은 무시하고 👀 대신 😕 리액션을 단다.

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

설정은 **리포지토리마다** 다르게 줄 수 있다 — 서버가 매 리뷰에서 GitHub API로 그 리포지토리의
`.reviewbot/config.yml` 을 읽기 때문이다.

서버 환경변수로 전체 기본값을 덮어쓸 수도 있다. 이쪽이 설정 파일보다 우선한다.

| 환경변수 | 대응 설정 |
| --- | --- |
| `REVIEWBOT_MODEL` | `model` |
| `REVIEWBOT_BASE_URL` | `baseUrl` |
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
- **파괴적인 제안** — GitHub의 ` ```suggestion ` 블록은 "이 코드로 교체" 버튼이다. 모델이 여기에 설명문을 넣는 일이 잦은데, 그대로 게시하면 누른 사람의 코드가 한국어 문장으로 바뀐다. 코드로 확신할 수 없으면 제안 블록을 만들지 않고 본문에 서술로 남긴다.
- **한 회차 안의 중복** — `파일:줄:제목` 키로 같은 지적을 걸러낸다.
- **깨진 JSON** — `response_format: json_object` 로 요청하고, 코드펜스가 섞여도 균형 잡힌 JSON을 추출한다.
- **추측성 지적** — 확신도를 함께 받아 `minConfidence` 미만은 버리고, 0.7 미만은 코멘트에 "오탐일 수 있다"를 붙인다.
- **nit 폭격** — 심각도 임계값과 인라인 개수 상한을 둔다.

## GSML을 쓸 때 알아둘 것

GSML은 학교에서 직접 돌리는 llama.cpp 서버다. OpenAI 규격에서 벗어나는 점이 몇 가지 있는데,
**클라이언트는 이를 우회하지 않는다.** 감추면 서버의 문제가 드러나지 않기 때문이다.
아래 상황에서는 리뷰가 그냥 실패하고, 그 사실이 PR 코멘트와 로그에 남는다.

**추론을 끌 수 없다.** 모델이 항상 본문 앞에 `<think>...</think>` 블록을 붙이고, 그 추론 토큰도
`maxOutputTokens` 를 함께 소비한다. `enable_thinking: false` 같은 옵션은 무시된다.
블록 안에 답안 JSON 초안이 들어 있으면 **그 초안이 리뷰 결과로 파싱될 수 있다.**

**응답이 잘려도 `finish_reason` 이 `stop` 으로 온다.** 규격대로라면 `length` 여야 한다.
잘린 JSON은 파싱에 실패해 리뷰가 중단된다. `maxFiles` 나 `maxPromptChars` 를 줄여야 한다.

**용량이 부족하면 429가 온다.** 재시도하지 않으므로 그 회차 리뷰는 실패한다.

**느리다.** 35B 모델을 로컬 GPU에서 돌리므로 큰 프롬프트 하나에 몇 분이 걸린다.
요청 타임아웃은 600초다. 서버 슬롯이 하나라 리뷰 큐는 동시 실행 1로 직렬화되어 있다.

**컨텍스트는 131,072토큰이고 출력도 여기서 나눠 쓴다.** 기본값은 프롬프트 140,000자(≈40K 토큰) +
출력 16,384토큰이라 여유가 있다. 하루 한도는 13,107,200토큰이고 콘솔에서 사용량을 볼 수 있다.

### 주의: 엔드포인트가 평문 HTTP다

기본 base URL `http://ssh.gsmsv.site:26145/v1` 은 TLS가 아니다. **API 키가 Authorization 헤더에 평문으로 실려 나가고,
리뷰 대상 코드도 암호화 없이 오간다.** 사내망 밖에서 호출한다면 이 점을 감수하는 것이다.
서버에 HTTPS가 붙으면 `REVIEWBOT_BASE_URL` 을 그쪽으로 바꾸는 것이 좋다.

리뷰 서버를 모델과 같은 호스트에서 돌린다면 `REVIEWBOT_BASE_URL` 을 `localhost` 로 두는 것이 가장 안전하다 —
키가 아예 네트워크를 건너지 않는다.

---

## gemini-code-assist에서 갈아타기

1. 리포지토리 설정에서 gemini-code-assist GitHub App을 제거하거나, `.gemini/config.yaml` 에서 자동 리뷰를 끈다.
2. 리뷰 서버를 띄우고, App을 그 리포지토리에 설치한다. 리포지토리에는 아무것도 추가하지 않아도 된다.
3. 기존에 `.gemini/styleguide.md` 를 쓰고 있었다면 그 내용을 `.reviewbot/config.yml` 의 `customInstructions` 로 옮긴다.

트리거는 `/gemini review` → `/review` 로 대응된다. 요약·질의 명령은 없고 리뷰만 남긴다.

---

## 개발

```bash
npm run typecheck   # tsc --noEmit
npm run build       # dist/server.mjs 번들
```

`npm run build` 는 의존성을 통째로 말아넣은 `dist/server.mjs` 하나를 만든다.
`dist/` 는 커밋하므로 소스를 고쳤으면 빌드 결과를 같이 커밋해야 한다.
(도커 이미지는 소스에서 다시 빌드하므로 이미지 자체는 커밋된 번들에 의존하지 않는다.)

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
  config.ts         기본값 → .reviewbot/config.yml → 환경변수 병합
  llm.ts            OpenAI 호환 호출 · JSON 추출 · 스키마 검증
  github/
    event.ts        웹훅 페이로드 → 트리거 정규화
    app.ts          GitHub App 설치 토큰 (@octokit/auth-app) · PEM 복원
    client.ts       Octokit 래퍼 (리뷰 게시, 권한 확인)
    diff.ts         unified diff 파서 · 줄 번호 계산 · 위치 검증
  review/
    commands.ts     코멘트 명령 파싱
    prompt.ts       시스템/유저 프롬프트 조립
    schema.ts       모델 출력 스키마 (zod)
    runner.ts       오케스트레이션 · 결과 정제
    render.ts       코멘트 마크다운 렌더링
```

## 라이선스

MIT
