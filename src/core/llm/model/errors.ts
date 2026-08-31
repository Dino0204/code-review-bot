export class LlmError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LlmError";
	}
}
