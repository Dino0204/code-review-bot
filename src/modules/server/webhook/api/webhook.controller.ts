import {
	Controller,
	Headers,
	Post,
	type RawBodyRequest,
	Req,
	Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { WebhookService } from "../model/webhook.service";

@Controller("webhook")
export class WebhookController {
	constructor(private readonly webhook: WebhookService) {}

	/**
	 * 경우마다 상태 코드가 달라서 응답 객체를 직접 만진다.
	 * `passthrough` 라 본문은 반환값으로 그대로 나간다.
	 */
	@Post()
	receive(
		@Req() request: RawBodyRequest<Request>,
		@Res({ passthrough: true }) response: Response,
		@Headers("x-github-event") eventName?: string,
		@Headers("x-hub-signature-256") signature?: string,
	): string {
		const outcome = this.webhook.handle(
			eventName ?? "",
			signature,
			request.rawBody,
		);
		response.status(outcome.status);
		return outcome.body;
	}
}
