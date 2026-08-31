/**
 * 웹훅 서버 진입점.
 *
 * GitHub App 웹훅을 직접 받아 리뷰를 돌린다. GitHub Actions를 쓰지 않으므로
 * Actions 실행 기록도, Actions 분 소모도 없다.
 *
 *   node dist/server.mjs
 */

import { main } from "./model/bootstrap";

main();
