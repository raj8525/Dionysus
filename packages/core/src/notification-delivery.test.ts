import { describe, expect, it } from "vitest";
import { buildNotificationPayload, buildTelegramRequest, resolveNotificationChannels } from "./notification-delivery.js";

describe("notification delivery planning", () => {
  it("always includes console delivery", () => {
    expect(resolveNotificationChannels({})).toEqual([
      {
        type: "console",
        name: "Codex console",
        config: {}
      }
    ]);
  });

  it("enables Telegram and email webhook only when configured", () => {
    const channels = resolveNotificationChannels({
      DIONYSUS_TELEGRAM_BOT_TOKEN: "token",
      DIONYSUS_TELEGRAM_CHAT_ID: "chat",
      DIONYSUS_EMAIL_WEBHOOK_URL: "https://mail.example/send",
      DIONYSUS_EMAIL_TO: "owner@example.com"
    });

    expect(channels.map((channel) => channel.type)).toEqual(["console", "telegram", "email"]);
    expect(channels[1].config).toMatchObject({ botToken: "token", chatId: "chat" });
    expect(channels[2].config).toMatchObject({ url: "https://mail.example/send", to: "owner@example.com" });
  });

  it("builds provider payloads without secrets", () => {
    const message = {
      id: "notification-1",
      milestoneId: "milestone-1",
      title: "里程碑完成",
      body: "可以验收"
    };

    expect(buildNotificationPayload(message)).toEqual({
      notificationId: "notification-1",
      milestoneId: "milestone-1",
      title: "里程碑完成",
      body: "可以验收"
    });
    expect(buildTelegramRequest({ botToken: "secret", chatId: "chat", message })).toEqual({
      url: "https://api.telegram.org/botsecret/sendMessage",
      body: {
        chat_id: "chat",
        text: "里程碑完成\n\n可以验收"
      }
    });
  });
});
