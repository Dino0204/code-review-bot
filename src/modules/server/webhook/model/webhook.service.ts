import { Inject, Injectable } from "@nestjs/common";
import type { RawEvent } from "@/core/event/model/types";
import { log } from "@/core/ports/logger";
import {
	type ServerConfig,
	serverConfig,
} from "../../config/model/server-config";
import { HandlerService } from "../../handler/handler.service";
import { ReviewQueueService } from "../../queue/model/review-queue.service";
import { verifySignature } from "../lib/verify-signature";

/** 컨트롤러가 그대로 내보낼 응답. 본문을 평문으로 두는 것은 GitHub 전달 로그에서 읽기 쉬워서다. */
export interface WebhookOutcome {
	status: number;
	body: string;
}

@Injectable()
export class WebhookService {
	constructor(
		@Inject(serverConfig.KEY) private readonly config: ServerConfig,
		private readonly handler: HandlerService,
		private readonly queue: ReviewQueueService,
	) {}

	/**
	 * 서명을 검증하고, 리뷰를 돌릴 이벤트면 큐에 넣는다.
	 *
	 * 본문은 파싱된 객체가 아니라 원본 바이트를 받는다 — 서명이 그 바이트에 대해 계산되므로
	 * 파서가 손댄 값으로는 검증할 수 없다.
	 */
	async handle(
		eventName: string,
		signature: string | undefined,
		rawBody: Buffer | undefined,
	): Promise<WebhookOutcome> {
		if (!rawBody) return { status: 400, body: "empty body" };

		if (!verifySignature(this.config.webhookSecret, rawBody, signature)) {
			log.warn("서명이 맞지 않는 웹훅 요청을 거절했다");
			return { status: 401, body: "bad signature" };
		}

		if (eventName === "ping") return { status: 200, body: "pong" };

		let payload: RawEvent;
		try {
			payload = JSON.parse(rawBody.toString("utf8")) as RawEvent;
		} catch {
			return { status: 400, body: "invalid json" };
		}

		const accepted = this.handler.accept(eventName, payload);
		if (!accepted) return { status: 200, body: "ignored" };

		// 리뷰는 몇 분씩 걸린다. 웹훅은 바로 닫고 큐에서 처리한다.
		try {
			await this.queue.enqueue(accepted.key, accepted.job, accepted.delayMs);
		} catch (error) {
			// 큐에 못 넣었으면 이벤트를 잃은 것이다. 200 으로 삼키면 GitHub 전달 기록에도
			// 성공으로 남아 되돌릴 방법이 없다 — 실패를 남겨 재전송할 수 있게 한다.
			log.error(
				`큐 적재 실패 — ${error instanceof Error ? error.message : String(error)}`,
			);
			return { status: 503, body: "queue unavailable" };
		}
		return { status: 202, body: "queued" };
	}
}
