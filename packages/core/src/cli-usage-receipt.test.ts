import { describe, expect, it } from "vitest";

import { parseCliUsageReceipt } from "./cli-usage-receipt.js";

describe("parseCliUsageReceipt", () => {
  it("extracts model calls from a Dionysus usage JSON line", () => {
    expect(parseCliUsageReceipt([
      "normal output",
      "DIONYSUS_USAGE_JSON={\"modelCalls\":3,\"provider\":\"minimax\"}"
    ].join("\n"))).toEqual({
      modelCalls: 3,
      raw: {
        modelCalls: 3,
        provider: "minimax"
      }
    });
  });

  it("uses the Dionysus done marker as a model usage receipt", () => {
    expect(parseCliUsageReceipt([
      "final report",
      "DIONYSUS_DONE_JSON={\"status\":\"done\",\"modelCalls\":2}"
    ].join("\n"))).toEqual({
      modelCalls: 2,
      raw: {
        status: "done",
        modelCalls: 2
      }
    });
  });

  it("uses Markdown-wrapped Dionysus done markers as model usage receipts", () => {
    expect(parseCliUsageReceipt([
      "final report",
      "**DIONYSUS_DONE_JSON={\"status\":\"done\",\"modelCalls\":2}**"
    ].join("\n"))).toEqual({
      modelCalls: 2,
      raw: {
        status: "done",
        modelCalls: 2
      }
    });
  });

  it("ignores invalid or missing usage receipts", () => {
    expect(parseCliUsageReceipt("DIONYSUS_USAGE_JSON={bad")).toBeNull();
    expect(parseCliUsageReceipt("no usage here")).toBeNull();
  });
});
