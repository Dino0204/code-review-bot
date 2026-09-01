import { Module } from "@nestjs/common";
import { StateModule } from "../state/state.module";
import { ChainFactory } from "./model/chain.factory";

@Module({
	imports: [StateModule],
	providers: [ChainFactory],
	exports: [ChainFactory],
})
export class LlmModule {}
