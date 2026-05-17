import { describe, expect, it, vi } from "vitest";
import { safelyAck, safelyNack } from "./rabbitmq.js";

const message = {} as Parameters<typeof safelyAck>[1];

describe("RabbitMQ consumer settlement", () => {
  it("ignores ack attempts after the channel is already closing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const channel = {
      ack: () => {
        throw new Error("Channel closing");
      },
      nack: vi.fn()
    };

    expect(safelyAck(channel, message, "dionysus.worker")).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ignored RabbitMQ ack"));
    warn.mockRestore();
  });

  it("ignores nack attempts after the channel is already closed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const channel = {
      ack: vi.fn(),
      nack: () => {
        throw new Error("Channel closed");
      }
    };

    expect(safelyNack(channel, message, "dionysus.worker")).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ignored RabbitMQ nack"));
    warn.mockRestore();
  });

  it("rethrows non-channel settlement errors", () => {
    const channel = {
      ack: () => {
        throw new Error("unexpected settlement failure");
      },
      nack: vi.fn()
    };

    expect(() => safelyAck(channel, message, "dionysus.worker")).toThrow("unexpected settlement failure");
  });
});
