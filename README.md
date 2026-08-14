# GSML Code Review Bot

GSML 게이트웨이의 모델로 GitHub Pull Request를 리뷰하고, 결과를 **인라인 리뷰 코멘트**로 남기는 GitHub App이다. `gemini-code-assist` 대체용으로 만들었다.

- **코드가 상용 LLM 제공자로 나가지 않는다.** GSML은 학교에서 직접 서빙하는 모델이고, OpenAI 호환 엔드포인트를 fetch로 직접 호출한다. OpenAI SDK나 중계 게이트웨이를 거치지 않는다.
- **모델 비용 0원.** 하루 13,107,200 토큰까지 쓸 수 있다 (컨텍스트 131K).
- **코멘트로 트리거한다.** PR에 `/review` 한 줄이면 된다.
- **GitHub Actions를 쓰지 않는다.** 웹훅을 직접 받는 서버로 돌아가서, Actions 실행 기록도 Actions 분 소모도 없다.
- TypeScript로 작성했고 런타임 의존이 없다 (번들 하나 + git).

## 라이선스

MIT
