import {it,expect} from "vitest";
import {DSH_MODEL_BUDGET_MS,DSH_REVIEW_INTERVAL_MS,sdkRequestTimeout} from "../src/server/dsh/limits.js";
import {pendingDshPolicy} from "../src/server/dsh/executor.js";
it("allows one hour without a hidden ten minute SDK wait cutoff",()=>{
expect(DSH_MODEL_BUDGET_MS).toBe(3600000);
expect(pendingDshPolicy.maxRuntimeMs).toBe(DSH_MODEL_BUDGET_MS);
expect(sdkRequestTimeout("session/wait")).toBeGreaterThan(DSH_MODEL_BUDGET_MS);
expect(sdkRequestTimeout("session/get")).toBe(25000);
expect(DSH_REVIEW_INTERVAL_MS).toBe(900000);
});
