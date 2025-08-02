import { Router, Request, Response } from "express";
import { aiQueue } from "../services/queue";
import logger from "../utils/logger";

const router = Router();

// POST /api/ai/orchestrate
router.post("/orchestrate", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { prompt, projectId } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    if (!projectId) {
      return res
        .status(400)
        .json({ error: "projectId is required to create tasks" });
    }

    // Add AI orchestration job to the queue
    const job = await aiQueue.add("orchestrate", {
      prompt,
      projectId,
      userId,
    });

    logger.info(
      { jobId: job.id, prompt: prompt.substring(0, 60) },
      "AI orchestration job queued"
    );

    return res.status(202).json({
      message: "AI orchestration job queued",
      jobId: job.id,
    });
  } catch (err) {
    logger.error({ err }, "Failed to queue AI orchestration");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/ai/job/:jobId - check status of an AI job
router.get("/job/:jobId", async (req: Request, res: Response) => {
  try {
    const job = await aiQueue.getJob(req.params.jobId as string);

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    const state = await job.getState();
    const result = job.returnvalue;

    return res.json({
      jobId: job.id,
      state,
      result: state === "completed" ? result : null,
      progress: job.progress,
      failedReason: state === "failed" ? job.failedReason : null,
    });
  } catch (err) {
    logger.error({ err }, "Failed to get AI job status");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
