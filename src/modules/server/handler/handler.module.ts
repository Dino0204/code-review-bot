import { Module } from "@nestjs/common";
import { StateModule } from "../state/state.module";
import { HandlerService } from "./handler.service";

@Module({
	imports: [StateModule],
	providers: [HandlerService],
	exports: [HandlerService],
})
export class HandlerModule {}
