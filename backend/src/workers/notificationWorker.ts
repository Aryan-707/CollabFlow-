import { Worker, Job } from "bullmq";
import { redisConnection, failedQueue } from "../services/queue";
import prisma from "../services/prisma";
import logger from "../utils/logger";
import { getSocketIO } from "../sockets";

interface NotificationJobData {
  type: string;
  userId: string;
  title: string;
  message: string;
  entityId?: string;
}

const notificationWorker = new Worker(
  "notificationQueue",
  async (job: Job<NotificationJobData>) => {
    const { type, userId, title, message, entityId } = job.data;

    logger.info(
      { jobId: job.id, type, userId },
      "Processing notification job"
    );

    // Create notification in database
    const notification = await prisma.notification.create({
      data: {
        title,
        message,
        type,
        userId,
        entityId: entityId || null,
      },
    });

    // Push real-time notification to user via Socket.io
    const io = getSocketIO();
    if (io) {
      io.to(`user:${userId}`).emit("notification:new", notification);
    }

    logger.info(
      { jobId: job.id, notificationId: notification.id },
      "Notification created and emitted"
    );

    return notification;
  },
  {
    connection: redisConnection,
    concurrency: 10,
  }
);

notificationWorker.on("failed", async (job, err) => {
  if (job && job.attemptsMade >= (job.opts?.attempts || 3)) {
    logger.error(
      { jobId: job.id, err: err.message },
      "Notification job moved to dead-letter queue"
    );
    await failedQueue.add("failed-notification", {
      originalQueue: "notificationQueue",
      originalJobId: job.id,
      data: job.data,
      error: err.message,
      failedAt: new Date().toISOString(),
    });
  }
});

notificationWorker.on("completed", (job) => {
  logger.info({ jobId: job.id }, "Notification job completed");
});

export default notificationWorker;
