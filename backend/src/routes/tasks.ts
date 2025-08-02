import { Router, Request, Response } from "express";
import prisma from "../services/prisma";
import { taskQueue } from "../services/queue";
import {
  checkIdempotency,
  generateIdempotencyKey,
} from "../services/idempotency";
import logger from "../utils/logger";

const router = Router();

// GET /api/tasks - list tasks (optionally filtered by projectId)
router.get("/", async (req: Request, res: Response) => {
  try {
    const { projectId, status, priority } = req.query;

    const where: any = {};
    if (projectId) where.projectId = projectId as string;
    if (status) where.status = status as string;
    if (priority) where.priority = priority as string;

    const tasks = await prisma.task.findMany({
      where,
      include: {
        creator: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        subtasks: {
          select: { id: true, title: true, status: true },
        },
        _count: { select: { comments: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(tasks);
  } catch (err) {
    logger.error({ err }, "Failed to list tasks");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/tasks/:id
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const task = await prisma.task.findUnique({
      where: { id: req.params.id as string },
      include: {
        creator: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        subtasks: true,
        comments: {
          include: {
            author: {
              select: { id: true, email: true, firstName: true, lastName: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    return res.json(task);
  } catch (err) {
    logger.error({ err }, "Failed to get task");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/tasks - queue a task creation (202 Accepted)
router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { title, description, status, priority, dueDate, projectId, parentId } =
      req.body;

    if (!title || !projectId) {
      return res
        .status(400)
        .json({ error: "Title and projectId are required" });
    }

    // Get or generate idempotency key
    const idempotencyKey =
      (req.headers["idempotency-key"] as string) ||
      generateIdempotencyKey(req.body);

    // Check if already processed
    const existingResult = await checkIdempotency(idempotencyKey);
    if (existingResult) {
      logger.info({ idempotencyKey }, "Duplicate request detected");
      return res.status(200).json({
        message: "Already processed",
        result: JSON.parse(existingResult),
      });
    }

    // Add to queue - do NOT write to DB directly
    const job = await taskQueue.add("create-task", {
      type: "CREATE",
      idempotencyKey,
      userId,
      projectId,
      data: { title, description, status, priority, dueDate, parentId },
    });

    logger.info({ jobId: job.id, idempotencyKey }, "Task creation job queued");

    return res.status(202).json({
      message: "Task creation queued",
      jobId: job.id,
      idempotencyKey,
    });
  } catch (err) {
    logger.error({ err }, "Failed to queue task creation");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/tasks/:id - queue a task update (202 Accepted)
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const taskId = req.params.id as string;
    const { version, ...updateData } = req.body;

    const idempotencyKey =
      (req.headers["idempotency-key"] as string) ||
      generateIdempotencyKey({ taskId, ...updateData, timestamp: Date.now() });

    const existingResult = await checkIdempotency(idempotencyKey);
    if (existingResult) {
      return res.status(200).json({
        message: "Already processed",
        result: JSON.parse(existingResult),
      });
    }

    const job = await taskQueue.add("update-task", {
      type: "UPDATE",
      idempotencyKey,
      userId,
      taskId,
      data: updateData,
      clientVersion: version,
    });

    logger.info({ jobId: job.id, taskId }, "Task update job queued");

    return res.status(202).json({
      message: "Task update queued",
      jobId: job.id,
      idempotencyKey,
    });
  } catch (err) {
    logger.error({ err }, "Failed to queue task update");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/tasks/:id - queue a task deletion (202 Accepted)
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const taskId = req.params.id as string;

    const idempotencyKey =
      (req.headers["idempotency-key"] as string) ||
      generateIdempotencyKey({ taskId, action: "delete" });

    const existingResult = await checkIdempotency(idempotencyKey);
    if (existingResult) {
      return res.status(200).json({
        message: "Already processed",
        result: JSON.parse(existingResult),
      });
    }

    const job = await taskQueue.add("delete-task", {
      type: "DELETE",
      idempotencyKey,
      userId,
      taskId,
      data: {},
    });

    logger.info({ jobId: job.id, taskId }, "Task deletion job queued");

    return res.status(202).json({
      message: "Task deletion queued",
      jobId: job.id,
      idempotencyKey,
    });
  } catch (err) {
    logger.error({ err }, "Failed to queue task deletion");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
