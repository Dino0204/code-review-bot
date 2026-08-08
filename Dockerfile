# 빌드 단계 — 의존성을 번들에 통째로 말아넣는다
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

# 실행 단계 — 번들이 자체 완결이라 node_modules를 들고 갈 필요가 없다
# 리뷰 대상 커밋을 얕게 받아오는 데 git이 필요하다.
#
# alpine을 쓰면 `apk add git` 으로 받아야 하는데, 알파인 패키지 저장소(dl-cdn)에 닿지 못하는
# 망이 있다. 실패가 아니라 응답이 없는 형태라 빌드가 통째로 멈춘다. 국내 미러도 마찬가지였다.
# node:24(데비안)에는 git이 이미 들어 있어 패키지 설치 단계 자체가 사라진다 —
# 이미지가 커지는 대신 Docker Hub 말고는 아무 데도 의존하지 않는다.
FROM node:24
RUN git --version
WORKDIR /app

COPY --from=build /app/dist/server.mjs ./server.mjs

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
