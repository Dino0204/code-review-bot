# 빌드 단계 — 의존성을 번들에 통째로 말아넣는다
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

# 실행 단계 — 번들이 자체 완결이라 node_modules를 들고 갈 필요가 없다.
#
# 리포지토리를 체크아웃하지 않으므로 git도 필요 없다. 설정 파일까지 GitHub API로 읽는다.
# 덕분에 슬림 이미지를 쓸 수 있고, 나가는 트래픽이 api.github.com 하나로 모인다 —
# github.com 이 막힌 망에서도 리뷰가 돈다.
FROM node:24-slim
WORKDIR /app

COPY --from=build /app/dist/server.mjs ./server.mjs

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
