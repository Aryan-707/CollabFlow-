import { Queue, Worker, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import logger from "../utils/logger";

// Redis connection singleton - shared across all queues and workers
const redisConnection = new IORedis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB || "0"),
  maxRetriesPerRequest: null,
});

redisConnection.on("error", (err) => {
  logger.error({ err }, "Redis connection error");
});

redisConnection.on("connect", () => {
  logger.info("Redis connected successfully");
});

// Queue definitions
export const taskQueue = new Queue("taskQueue", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

export const aiQueue = new Queue("aiQueue", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 200 },
  },
});

export const notificationQueue = new Queue("notificationQueue", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
});

// Dead-letter queue for jobs that fail after all retries
export const failedQueue = new Queue("failedQueue", {
  connection: redisConnection,
});

export { redisConnection };

// Helper to get queue stats for metrics
export async function getQueueLengths(): Promise<
  { name: string; length: number }[]
> {
  const queues = [
    { name: "taskQueue", queue: taskQueue },
    { name: "aiQueue", queue: aiQueue },
    { name: "notificationQueue", queue: notificationQueue },
    { name: "failedQueue", queue: failedQueue },
  ];

  const results = [];
  for (const { name, queue } of queues) {
    try {
      const waiting = await queue.getWaitingCount();
      const active = await queue.getActiveCount();
      results.push({ name, length: waiting + active });
    } catch (err) {
      logger.error({ err, queue: name }, "Failed to get queue length");
      results.push({ name, length: 0 });
    }
  }
  return results;
}
