import { Module } from "@nestjs/common";
import { LlmModule } from "../llm/llm.module";
import { StateModule } from "../state/state.module";
import { HandlerService } from "./handler.service";

@Module({
	imports: [StateModule, LlmModule],
	providers: [HandlerService],
	exports: [HandlerService],
})
export class HandlerModule {}
