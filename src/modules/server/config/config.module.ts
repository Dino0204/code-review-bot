import { Global, Module } from "@nestjs/common";
import { loadServerEnv } from "./api/load-server-env";
import { SERVER_ENV } from "./model/server-env";

/** 설정은 어느 모듈에서나 필요하다 — 전역으로 두고 import 를 되풀이하지 않는다 */
@Global()
@Module({
	providers: [{ provide: SERVER_ENV, useFactory: loadServerEnv }],
	exports: [SERVER_ENV],
})
export class ConfigModule {}
