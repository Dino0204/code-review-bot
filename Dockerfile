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
FROM node:24-alpine
# 리뷰 대상 커밋을 얕게 받아오는 데 git이 필요하다.
#
# 알파인 기본 CDN(dl-cdn)이 닿지 않아 빌드가 몇 분씩 멈추는 망이 있다. 국내 미러를 먼저 쓰고,
# 3분 안에 못 받으면 원래 CDN으로 되돌아간다 — 실패가 아니라 지연이라 timeout으로 끊어야 한다.
RUN cp /etc/apk/repositories /etc/apk/repositories.orig \
 && sed -i 's|dl-cdn.alpinelinux.org|mirror.kakao.com|g' /etc/apk/repositories \
 && { timeout 180 apk add --no-cache git \
      || { cp /etc/apk/repositories.orig /etc/apk/repositories && apk add --no-cache git; }; } \
 && rm -f /etc/apk/repositories.orig \
 && git --version
WORKDIR /app

COPY --from=build /app/dist/server.mjs ./server.mjs

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
