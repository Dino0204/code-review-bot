import { z } from "zod";
import { findingSchema } from "./finding";

export const reviewResultSchema = z.object({
	summary: z.string().default(""),
	findings: z.array(findingSchema).default([]),
});

export type ReviewResult = z.infer<typeof reviewResultSchema>;
