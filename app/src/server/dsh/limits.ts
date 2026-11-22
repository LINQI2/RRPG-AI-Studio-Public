// Producer-approved execution and review limits. Unity verification has its own deadlines.
export const DSH_MODEL_BUDGET_MS = 60 * 60 * 1000;
export const DSH_REVIEW_INTERVAL_MS = 15 * 60 * 1000;
export function sdkRequestTimeout(method: string) {
  // Let the executor own budget expiry and record the outcome before transport expiry.
  return method === "session/wait" ? DSH_MODEL_BUDGET_MS + 30_000 : 25_000;
}
