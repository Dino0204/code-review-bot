export function hasReviewTrigger(
  body: string,
  triggerPrefix = "/review",
): boolean {
  return body
    .split("\n")
    .map((line) => line.trim())
    .some(
      (line) => line === triggerPrefix || line.startsWith(`${triggerPrefix} `),
    );
}
