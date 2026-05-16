export type NotificationChannelType = "console" | "email" | "telegram" | "webhook";

export interface NotificationMessage {
  id: string;
  title: string;
  body: string;
  milestoneId: string;
}

export interface NotificationChannelDraft {
  type: NotificationChannelType;
  name: string;
  config: Record<string, string>;
}

export function resolveNotificationChannels(env: Record<string, string | undefined>): NotificationChannelDraft[] {
  const channels: NotificationChannelDraft[] = [
    {
      type: "console",
      name: "Codex console",
      config: {}
    }
  ];

  if (env.DIONYSUS_TELEGRAM_BOT_TOKEN && env.DIONYSUS_TELEGRAM_CHAT_ID) {
    channels.push({
      type: "telegram",
      name: "Telegram",
      config: {
        botToken: env.DIONYSUS_TELEGRAM_BOT_TOKEN,
        chatId: env.DIONYSUS_TELEGRAM_CHAT_ID
      }
    });
  }

  if (env.DIONYSUS_EMAIL_WEBHOOK_URL) {
    channels.push({
      type: "email",
      name: "Email webhook",
      config: {
        url: env.DIONYSUS_EMAIL_WEBHOOK_URL,
        to: env.DIONYSUS_EMAIL_TO ?? ""
      }
    });
  }

  if (env.DIONYSUS_NOTIFICATION_WEBHOOK_URL) {
    channels.push({
      type: "webhook",
      name: "Generic webhook",
      config: {
        url: env.DIONYSUS_NOTIFICATION_WEBHOOK_URL
      }
    });
  }

  return channels;
}

export function buildNotificationPayload(message: NotificationMessage): Record<string, string> {
  return {
    notificationId: message.id,
    milestoneId: message.milestoneId,
    title: message.title,
    body: message.body
  };
}

export function buildTelegramRequest(input: {
  botToken: string;
  chatId: string;
  message: NotificationMessage;
}): { url: string; body: Record<string, string> } {
  return {
    url: `https://api.telegram.org/bot${input.botToken}/sendMessage`,
    body: {
      chat_id: input.chatId,
      text: `${input.message.title}\n\n${input.message.body}`
    }
  };
}
