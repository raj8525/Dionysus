import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import amqp from "amqplib";
import dotenv from "dotenv";

const currentDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: findRootEnv(currentDir) });

export interface QueueMessage {
  message_id: string;
  goal_id?: string;
  task_id?: string;
  milestone_id?: string;
  type: string;
  attempt: number;
  idempotency_key: string;
  created_at: string;
}

export async function publishJson(queue: string, message: QueueMessage): Promise<void> {
  const connection = await amqp.connect(requiredMqUrl());
  const channel = await connection.createChannel();
  try {
    await channel.assertQueue(queue, { durable: true });
    channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
      contentType: "application/json",
      persistent: true,
      messageId: message.message_id
    });
  } finally {
    await channel.close();
    await connection.close();
  }
}

export async function consumeJson(
  queue: string,
  handler: (message: QueueMessage) => Promise<void>
): Promise<void> {
  const connection = await amqp.connect(requiredMqUrl());
  const channel = await connection.createChannel();
  await channel.assertQueue(queue, { durable: true });
  await channel.consume(queue, async (raw) => {
    if (!raw) return;
    try {
      const message = JSON.parse(raw.content.toString("utf8")) as QueueMessage;
      await handler(message);
      channel.ack(raw);
    } catch (error) {
      console.error(error);
      channel.nack(raw, false, false);
    }
  });
}

function requiredMqUrl(): string {
  const url = process.env.MQ_URL;
  if (!url) {
    throw new Error("MQ_URL is required");
  }
  return url;
}

function findRootEnv(startDir: string): string {
  let dir = startDir;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return ".env";
}
