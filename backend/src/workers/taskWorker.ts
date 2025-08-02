import { Worker, Job } from "bullmq";
import { redisConnection, failedQueue } from "../services/queue";
import {
  checkIdempotency,
  storeIdempotencyResult,
} from "../services/idempotency";
import prisma from "../services/prisma";
import logger from "../utils/logger";
import { getSocketIO } from "../sockets";

interface TaskJobData {
  type:
    | "CREATE"
    | "UPDATE"
    | "DELETE"
    | "CREATE_COMMENT"
    | "CREATE_PROJECT"
    | "UPDATE_PROJECT"
    | "DELETE_PROJECT";
  idempotencyKey: string;
  userId?: string;
  projectId?: string;
  taskId?: string;
  data: Record<string, any>;
  clientVersion?: number;
}

const taskWorker = new Worker(
  "taskQueue",
  async (job: Job<TaskJobData>) => {
    const { type, idempotencyKey, userId, projectId, taskId, data, clientVersion } =
      job.data;

    logger.info(
      { jobId: job.id, type, idempotencyKey },
      "Processing task job"
    );

    // Double-check idempotency before writing
    const existing = await checkIdempotency(idempotencyKey);
    if (existing) {
      logger.info({ idempotencyKey }, "Job already processed (idempotent skip)");
      return JSON.parse(existing);
    }

    let result: any;

    switch (type) {
      case "CREATE": {
        if (!projectId || !data.title) {
          throw new Error("Missing required fields for task creation");
        }

        result = await prisma.task.create({
          data: {
            title: data.title,
            description: data.description || null,
            status: data.status || "TODO",
            priority: data.priority || "MEDIUM",
            dueDate: data.dueDate ? new Date(data.dueDate) : null,
            projectId: projectId,
            createdBy: userId || null,
            parentId: data.parentId || null,
          },
        });

        // Emit real-time update to project room
        const io = getSocketIO();
        if (io) {
          io.to(`project:${projectId}`).emit("task:created", result);
        }

        // Create a notification for the task creator
        if (userId) {
          await prisma.notification.create({
            data: {
              title: "Task Created",
              message: `Task "${data.title}" has been created successfully.`,
              type: "TASK_CREATED",
              userId: userId,
              entityId: result.id,
            },
          });
        }
        break;
      }

      case "UPDATE": {
        if (!taskId) {
          throw new Error("Missing taskId for task update");
        }

        // Optimistic concurrency control using version field
        const currentTask = await prisma.task.findUnique({
          where: { id: taskId },
        });

        if (!currentTask) {
          throw new Error(`Task ${taskId} not found`);
        }

        if (
          clientVersion !== undefined &&
          clientVersion !== currentTask.version
        ) {
          // Version mismatch - emit conflict event via socket
          const io = getSocketIO();
          if (io) {
            io.to(`project:${currentTask.projectId}`).emit("task:conflict", {
              taskId,
              serverVersion: currentTask.version,
              clientVersion,
              currentData: currentTask,
            });
          }
          throw new Error(
            `Version conflict: expected ${clientVersion}, found ${currentTask.version}`
          );
        }

        result = await prisma.task.update({
          where: { id: taskId },
          data: {
            ...data,
            dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
            version: { increment: 1 },
          },
        });

        const ioUpdate = getSocketIO();
        if (ioUpdate) {
          ioUpdate
            .to(`project:${currentTask.projectId}`)
            .emit("task:updated", result);
        }
        break;
      }

      case "DELETE": {
        if (!taskId) {
          throw new Error("Missing taskId for task deletion");
        }

        const taskToDelete = await prisma.task.findUnique({
          where: { id: taskId },
        });

        if (!taskToDelete) {
          throw new Error(`Task ${taskId} not found`);
        }

        result = await prisma.task.delete({
          where: { id: taskId },
        });

        const ioDelete = getSocketIO();
        if (ioDelete) {
          ioDelete
            .to(`project:${taskToDelete.projectId}`)
            .emit("task:deleted", { taskId });
        }
        break;
      }

      case "CREATE_COMMENT": {
        if (!taskId || !data.content) {
          throw new Error("Missing taskId or content for comment creation");
        }

        result = await prisma.taskComment.create({
          data: {
            content: data.content,
            taskId: taskId,
            authorId: userId!,
          },
          include: {
            author: {
              select: { id: true, email: true, firstName: true, lastName: true },
            },
          },
        });

        // Find the task's project to emit socket event
        const commentTask = await prisma.task.findUnique({
          where: { id: taskId },
          select: { projectId: true },
        });

        if (commentTask) {
          const ioComment = getSocketIO();
          if (ioComment) {
            ioComment
              .to(`project:${commentTask.projectId}`)
              .emit("comment:created", { taskId, comment: result });
          }
        }

        logger.info(
          { commentId: result.id, taskId },
          "Comment created via queue"
        );
        break;
      }

      case "CREATE_PROJECT": {
        if (!data.name) {
          throw new Error("Missing project name for project creation");
        }

        // Generate a unique slug from the project name
        const slug =
          data.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") +
          "-" +
          Date.now().toString(36);

        result = await prisma.project.create({
          data: {
            name: data.name,
            slug,
            description: data.description || null,
            color: data.color || "#6366f1",
            members: {
              create: {
                userId: userId!,
                role: "OWNER",
              },
            },
          },
          include: {
            members: {
              include: {
                user: {
                  select: { id: true, email: true, firstName: true, lastName: true },
                },
              },
            },
          },
        });

        logger.info(
          { projectId: result.id, userId },
          "Project created via queue"
        );
        break;
      }

      case "UPDATE_PROJECT": {
        const projId = job.data.projectId;
        if (!projId) {
          throw new Error("Missing projectId for project update");
        }

        const updateFields: any = {};
        if (data.name !== undefined) updateFields.name = data.name;
        if (data.description !== undefined) updateFields.description = data.description;
        if (data.color !== undefined) updateFields.color = data.color;

        result = await prisma.project.update({
          where: { id: projId },
          data: updateFields,
        });

        logger.info({ projectId: projId }, "Project updated via queue");
        break;
      }

      case "DELETE_PROJECT": {
        const delProjId = job.data.projectId;
        if (!delProjId) {
          throw new Error("Missing projectId for project deletion");
        }

        result = await prisma.project.delete({
          where: { id: delProjId },
        });

        logger.info({ projectId: delProjId }, "Project deleted via queue");
        break;
      }

      default:
        throw new Error(`Unknown task job type: ${type}`);
    }

    // Store result for idempotency
    await storeIdempotencyResult(idempotencyKey, result);

    logger.info(
      { jobId: job.id, type, resultId: result?.id },
      "Task job completed successfully"
    );

    return result;
  },
  {
    connection: redisConnection,
    concurrency: 5,
  }
);

// Move to dead-letter queue after all retries exhausted
taskWorker.on("failed", async (job, err) => {
  if (job && job.attemptsMade >= (job.opts?.attempts || 3)) {
    logger.error(
      { jobId: job.id, err: err.message, attempts: job.attemptsMade },
      "Task job moved to dead-letter queue"
    );
    await failedQueue.add("failed-task", {
      originalQueue: "taskQueue",
      originalJobId: job.id,
      data: job.data,
      error: err.message,
      failedAt: new Date().toISOString(),
    });
  }
});

taskWorker.on("completed", (job) => {
  logger.info({ jobId: job.id }, "Task job completed");
});

export default taskWorker;
