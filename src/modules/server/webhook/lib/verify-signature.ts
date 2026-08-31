import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 웹훅 서명 검증.
 *
 * GitHub은 본문을 웹훅 시크릿으로 HMAC-SHA256 서명해 `X-Hub-Signature-256` 에 실어 보낸다.
 * 이걸 검증하지 않으면 누구나 우리 엔드포인트에 가짜 이벤트를 던져 리뷰를 돌리거나
 * 임의 리포지토리에 코멘트를 달게 만들 수 있다. 서버의 유일한 문지기다.
 *
 * 비교는 반드시 상수 시간으로 한다 — 문자열 비교는 앞자리부터 어긋나는 지점이
 * 응답 시간에 드러나서, 한 바이트씩 서명을 맞춰나갈 수 있다.
 */
export function verifySignature(
	secret: string,
	body: Buffer,
	header: string | undefined,
): boolean {
	if (!header) return false;

	const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
	const received = Buffer.from(header);
	const expectedBuffer = Buffer.from(expected);

	// timingSafeEqual은 길이가 다르면 던진다. 길이 자체는 비밀이 아니므로 먼저 거른다.
	if (received.length !== expectedBuffer.length) return false;
	return timingSafeEqual(received, expectedBuffer);
}
