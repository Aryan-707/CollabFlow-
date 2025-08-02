import { Worker, Job } from "bullmq";
import { redisConnection, taskQueue, failedQueue } from "../services/queue";
import { orchestrateWithAI } from "../services/ai";
import logger from "../utils/logger";
import { generateIdempotencyKey } from "../services/idempotency";

interface AiJobData {
  prompt: string;
  projectId: string;
  userId: string;
}

const aiWorker = new Worker(
  "aiQueue",
  async (job: Job<AiJobData>) => {
    const { prompt, projectId, userId } = job.data;

    logger.info(
      { jobId: job.id, prompt: prompt.substring(0, 60) },
      "Processing AI orchestration job"
    );

    // Call the AI service (which handles retries + caching internally)
    const aiResult = await orchestrateWithAI(prompt);

    // For each generated task, add a job to the taskQueue
    const createdJobs = [];

    for (const task of aiResult.tasks) {
      const taskData = {
        title: task.title,
        description: task.subtasks.join("\n- "),
        priority: task.priority.toUpperCase(),
        dueDate: task.dueDate || null,
        status: "TODO",
      };

      const idempotencyKey = generateIdempotencyKey({
        ...taskData,
        projectId,
        source: "ai",
        jobId: job.id,
      });

      const taskJob = await taskQueue.add("create-task", {
        type: "CREATE" as const,
        idempotencyKey,
        userId,
        projectId,
        data: taskData,
      });

      createdJobs.push({
        jobId: taskJob.id,
        title: task.title,
      });
    }

    logger.info(
      {
        jobId: job.id,
        tasksCreated: createdJobs.length,
      },
      "AI orchestration completed, task jobs queued"
    );

    return {
      prompt,
      tasksGenerated: aiResult.tasks.length,
      jobs: createdJobs,
    };
  },
  {
    connection: redisConnection,
    concurrency: 2, // Limit concurrency for AI calls
  }
);

aiWorker.on("failed", async (job, err) => {
  if (job && job.attemptsMade >= (job.opts?.attempts || 3)) {
    logger.error(
      { jobId: job.id, err: err.message },
      "AI job moved to dead-letter queue"
    );
    await failedQueue.add("failed-ai", {
      originalQueue: "aiQueue",
      originalJobId: job.id,
      data: job.data,
      error: err.message,
      failedAt: new Date().toISOString(),
    });
  }
});

aiWorker.on("completed", (job) => {
  logger.info({ jobId: job.id }, "AI job completed");
});

export default aiWorker;
