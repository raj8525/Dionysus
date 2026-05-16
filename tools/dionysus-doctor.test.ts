import { describe, expect, it } from "vitest";

import { compactDoctorResult } from "./dionysus-doctor.js";

describe("doctor compact result", () => {
  it("keeps health and summarizes CLI models instead of dumping all models", () => {
    expect(compactDoctorResult({
      ok: true,
      apiBase: "http://localhost:23100",
      health: { ok: true, database: { ok: true } },
      cliProbe: [
        { cliType: "mock", available: true, models: ["mock/default"] },
        { cliType: "opencode", available: true, models: ["m1", "m2", "m3"] }
      ]
    })).toEqual({
      ok: true,
      apiBase: "http://localhost:23100",
      health: { ok: true, database: { ok: true } },
      cliProbe: [
        { cliType: "mock", available: true, command: undefined, version: undefined, modelCount: 1 },
        { cliType: "opencode", available: true, command: undefined, version: undefined, modelCount: 3 }
      ],
      goalStatus: undefined
    });
  });
});
