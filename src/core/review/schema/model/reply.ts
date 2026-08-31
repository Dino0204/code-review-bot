import { z } from "zod";

/**
 * 인라인 쓰레드에 다는 답글. 본문만 있으면 되고, 코드로 답할 수 있을 때만 suggestion이 붙는다.
 */
export const replySchema = z.object({
	reply: z.string().min(1),
	suggestion: z.string().nullish(),
});

export type RawReply = z.infer<typeof replySchema>;
