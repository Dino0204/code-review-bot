import type { IncomingMessage, ServerResponse } from "node:http";
import type { RawEvent } from "@/github/event/model/types";
import { log } from "@/logger";
import { accept } from "../handler/model/accept";
import type { HandlerDeps } from "../handler/model/types";
import type { ReviewQueue } from "../queue/model/create-review-queue";
import { readBody } from "../webhook/lib/read-body";
import { verifySignature } from "../webhook/lib/verify-signature";

export function send(
	response: ServerResponse,
	status: number,
	body: string,
): void {
	response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
	response.end(body);
}

export async function handle(
	request: IncomingMessage,
	response: ServerResponse,
	deps: HandlerDeps,
	queue: ReviewQueue,
	webhookSecret: string,
): Promise<void> {
	const url = request.url ?? "/";

	if (request.method === "GET" && (url === "/health" || url === "/")) {
		send(
			response,
			200,
			JSON.stringify({
				ok: true,
				queued: queue.size,
				active: queue.active ?? null,
			}),
		);
		return;
	}

	if (request.method !== "POST" || !url.startsWith("/webhook")) {
		send(response, 404, "not found");
		return;
	}

	const body = await readBody(request);
	if (
		!verifySignature(
			webhookSecret,
			body,
			request.headers["x-hub-signature-256"] as string | undefined,
		)
	) {
		log.warn("서명이 맞지 않는 웹훅 요청을 거절했다");
		send(response, 401, "bad signature");
		return;
	}

	const eventName =
		(request.headers["x-github-event"] as string | undefined) ?? "";
	if (eventName === "ping") {
		send(response, 200, "pong");
		return;
	}

	let payload: RawEvent;
	try {
		payload = JSON.parse(body.toString("utf8")) as RawEvent;
	} catch {
		send(response, 400, "invalid json");
		return;
	}

	const accepted = accept(deps, eventName, payload);
	if (!accepted) {
		send(response, 200, "ignored");
		return;
	}

	// 리뷰는 몇 분씩 걸린다. 웹훅은 바로 닫고 큐에서 처리한다.
	queue.enqueue(accepted.key, accepted.run);
	send(response, 202, "queued");
}
