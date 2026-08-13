#!/usr/bin/env bash
# CI가 SSH stdin으로 흘려넣어 배포 서버에서 실행하는 스크립트.
# IMAGE_TAG · GHCR_USER · GHCR_TOKEN · DEPLOY_PATH 는 앞줄에서 export 되어 들어온다.
set -euo pipefail

cd "$DEPLOY_PATH"

# compose 파일을 최신 main에 맞춘다. .env 와 secrets/ 는 gitignore라 그대로 남는다
git fetch --prune origin
git merge --ff-only origin/main

printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

export IMAGE_TAG
docker compose pull
docker compose up -d

# 컨테이너가 healthy 로 올라올 때까지 기다린다.
# 안 기다리면 죽은 배포도 CD는 초록으로 끝나고, 웹훅이 조용히 유실된다
container="$(docker compose ps -q reviewbot)"
for _ in $(seq 1 30); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$container")"
  case "$status" in
    healthy)
      echo "배포 완료: $IMAGE_TAG"
      docker image prune -f >/dev/null
      exit 0
      ;;
    unhealthy)
      break
      ;;
  esac
  sleep 2
done

echo "헬스체크가 통과하지 않았다 (마지막 상태: ${status:-unknown}). 최근 로그:" >&2
docker compose logs --tail 50 reviewbot >&2
exit 1
