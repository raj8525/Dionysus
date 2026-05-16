import { describe, expect, it } from "vitest";
import { queueForRole } from "./role-queues.js";

describe("role queue routing", () => {
  it("routes each agent role to its dedicated RabbitMQ queue", () => {
    expect(queueForRole("master")).toBe("dionysus.master");
    expect(queueForRole("rule_writer")).toBe("dionysus.rule_writer");
    expect(queueForRole("test_writer")).toBe("dionysus.test_writer");
    expect(queueForRole("worker")).toBe("dionysus.worker");
  });
});
