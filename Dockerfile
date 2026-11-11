# syntax=docker/dockerfile:1

# 빌드 결과(JS 번들)는 플랫폼과 무관해서, 빌드는 빌드하는 기계의 플랫폼에서 돌린다.
FROM --platform=$BUILDPLATFORM node:24.15.0-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.12.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN pnpm build

# 실행 이미지에는 번들(dist)만 들어간다. node_modules가 필요 없다.
FROM node:24.15.0-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist ./dist
# deployd는 UID 0 + 권한 제거 상태로 실행하므로 모든 파일을 누구나 읽을 수 있게 둔다.
RUN chmod -R a+rX /app
EXPOSE 3000
CMD ["node", "dist/server.mjs"]
