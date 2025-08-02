import { Router, Request, Response } from "express";
import prisma from "../services/prisma";
import { taskQueue } from "../services/queue";
import {
  checkIdempotency,
  generateIdempotencyKey,
} from "../services/idempotency";
import logger from "../utils/logger";

const router = Router();

// GET /api/projects - list all projects for the current user
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    const projects = await prisma.project.findMany({
      where: {
        members: {
          some: { userId },
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
        _count: { select: { tasks: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    return res.json(projects);
  } catch (err) {
    logger.error({ err }, "Failed to list projects");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/projects/:id
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id as string },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, email: true, firstName: true, lastName: true },
            },
          },
        },
        _count: { select: { tasks: true } },
      },
    });

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    return res.json(project);
  } catch (err) {
    logger.error({ err }, "Failed to get project");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/projects - queue project creation (202 Accepted)
router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { name, description, color } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Project name is required" });
    }

    const idempotencyKey =
      (req.headers["idempotency-key"] as string) ||
      generateIdempotencyKey({ name, userId, action: "create-project" });

    const existingResult = await checkIdempotency(idempotencyKey);
    if (existingResult) {
      logger.info({ idempotencyKey }, "Duplicate project creation request");
      return res.status(200).json({
        message: "Already processed",
        result: JSON.parse(existingResult),
      });
    }

    // Queue the project creation - do NOT write to DB directly
    const job = await taskQueue.add("create-project", {
      type: "CREATE_PROJECT" as any,
      idempotencyKey,
      userId,
      data: { name, description, color },
    });

    logger.info({ jobId: job.id, idempotencyKey }, "Project creation job queued");

    return res.status(202).json({
      message: "Project creation queued",
      jobId: job.id,
      idempotencyKey,
    });
  } catch (err) {
    logger.error({ err }, "Failed to queue project creation");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/projects/:id - queue project update (202 Accepted)
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const projectId = req.params.id as string;
    const { name, description, color } = req.body;

    const idempotencyKey =
      (req.headers["idempotency-key"] as string) ||
      generateIdempotencyKey({ projectId, name, description, color, action: "update-project" });

    const existingResult = await checkIdempotency(idempotencyKey);
    if (existingResult) {
      return res.status(200).json({
        message: "Already processed",
        result: JSON.parse(existingResult),
      });
    }

    const job = await taskQueue.add("update-project", {
      type: "UPDATE_PROJECT" as any,
      idempotencyKey,
      userId,
      projectId,
      data: { name, description, color },
    });

    logger.info({ jobId: job.id, projectId }, "Project update job queued");

    return res.status(202).json({
      message: "Project update queued",
      jobId: job.id,
      idempotencyKey,
    });
  } catch (err) {
    logger.error({ err }, "Failed to queue project update");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/projects/:id - queue project deletion (202 Accepted)
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const projectId = req.params.id as string;

    const idempotencyKey =
      (req.headers["idempotency-key"] as string) ||
      generateIdempotencyKey({ projectId, action: "delete-project" });

    const existingResult = await checkIdempotency(idempotencyKey);
    if (existingResult) {
      return res.status(200).json({
        message: "Already processed",
        result: JSON.parse(existingResult),
      });
    }

    const job = await taskQueue.add("delete-project", {
      type: "DELETE_PROJECT" as any,
      idempotencyKey,
      userId,
      projectId,
      data: {},
    });

    logger.info({ jobId: job.id, projectId }, "Project deletion job queued");

    return res.status(202).json({
      message: "Project deletion queued",
      jobId: job.id,
      idempotencyKey,
    });
  } catch (err) {
    logger.error({ err }, "Failed to queue project deletion");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
