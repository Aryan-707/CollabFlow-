import { Router, Request, Response } from "express";
import { taskQueue } from "../services/queue";
import prisma from "../services/prisma";
import {
  checkIdempotency,
  generateIdempotencyKey,
} from "../services/idempotency";
import logger from "../utils/logger";

const router = Router({ mergeParams: true });

// GET /api/tasks/:taskId/comments
router.get("/", async (req: Request, res: Response) => {
  try {
    const taskId = req.params.taskId as string;

    const comments = await prisma.taskComment.findMany({
      where: { taskId },
      include: {
        author: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return res.json(comments);
  } catch (err) {
    logger.error({ err }, "Failed to list comments");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/tasks/:taskId/comments - queue comment creation
router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const taskId = req.params.taskId as string;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: "Comment content is required" });
    }

    const idempotencyKey =
      (req.headers["idempotency-key"] as string) ||
      generateIdempotencyKey({ taskId, content, userId });

    const existingResult = await checkIdempotency(idempotencyKey);
    if (existingResult) {
      return res.status(200).json({
        message: "Already processed",
        result: JSON.parse(existingResult),
      });
    }

    // We use the taskQueue for comments too, with a different job name
    const job = await taskQueue.add("create-comment", {
      type: "CREATE_COMMENT" as any,
      idempotencyKey,
      userId,
      taskId,
      data: { content },
    });

    return res.status(202).json({
      message: "Comment creation queued",
      jobId: job.id,
      idempotencyKey,
    });
  } catch (err) {
    logger.error({ err }, "Failed to queue comment creation");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
