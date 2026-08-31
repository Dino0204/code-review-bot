# 빌드 단계 — tsc 로 컴파일하고 tsc-alias 로 @/ 별칭을 상대 경로로 바꾼다
FROM node:24 AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# 의존성 단계 — 실행에 필요한 것만 남긴다.
# 실행 이미지와 같은 base 에서 설치한다 — native 모듈이 섞여도 안전하다.
FROM node:24 AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 실행 단계 — Nest 의 데코레이터 메타데이터 때문에 번들 대신 node_modules 를 들고 간다
FROM node:24
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/modules/server/index.js"]
