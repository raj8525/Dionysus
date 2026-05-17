import { describe, expect, it } from "vitest";

import { deriveWorkerHealth } from "./runtime-health.js";

describe("runtime health", () => {
  it("marks worker ok when a recent heartbeat exists", () => {
    expect(deriveWorkerHealth({
      nowIso: "2026-05-16T12:00:00.000Z",
      maxAgeSeconds: 60,
      events: [{
        eventType: "worker.heartbeat",
        createdAt: "2026-05-16T11:59:45.000Z",
        payload: { pid: 123 }
      }]
    })).toEqual({
      ok: true,
      status: "ok",
      lastEventType: "worker.heartbeat",
      lastSeenAt: "2026-05-16T11:59:45.000Z",
      ageSeconds: 15,
      maxAgeSeconds: 60,
      runtime: { pid: 123 }
    });
  });

  it("surfaces worker runtime metadata from heartbeat payload", () => {
    expect(deriveWorkerHealth({
      nowIso: "2026-05-16T12:00:00.000Z",
      maxAgeSeconds: 60,
      events: [{
        eventType: "worker.heartbeat",
        createdAt: "2026-05-16T11:59:59.000Z",
        payload: {
          pid: 456,
          runtimeInstanceId: "runtime-1",
          runtimeStartedAt: "2026-05-16T11:00:00.000Z",
          codeCommitSha: "abc123",
          workerCliType: "opencode",
          workerCliModel: "minimax-cn-coding-plan/MiniMax-M2.7"
        }
      }]
    })).toMatchObject({
      ok: true,
      runtime: {
        pid: 456,
        runtimeInstanceId: "runtime-1",
        runtimeStartedAt: "2026-05-16T11:00:00.000Z",
        codeCommitSha: "abc123",
        workerCliType: "opencode",
        workerCliModel: "minimax-cn-coding-plan/MiniMax-M2.7"
      }
    });
  });

  it("marks worker stale when the latest heartbeat is too old", () => {
    expect(deriveWorkerHealth({
      nowIso: "2026-05-16T12:00:00.000Z",
      maxAgeSeconds: 60,
      events: [{
        eventType: "worker.heartbeat",
        createdAt: "2026-05-16T11:58:00.000Z",
        payload: {}
      }]
    })).toMatchObject({
      ok: false,
      status: "stale",
      ageSeconds: 120
    });
  });

  it("marks worker missing when no worker event exists", () => {
    expect(deriveWorkerHealth({
      nowIso: "2026-05-16T12:00:00.000Z",
      maxAgeSeconds: 60,
      events: []
    })).toEqual({
      ok: false,
      status: "missing",
      maxAgeSeconds: 60
    });
  });
});
