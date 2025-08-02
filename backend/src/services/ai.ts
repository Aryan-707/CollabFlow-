import Groq from "groq-sdk";
import { redisConnection } from "./queue";
import logger from "../utils/logger";
import crypto from "crypto";

const AI_CACHE_TTL = 3600; // 1 hour

// Groq client - initialized lazily so app doesn't crash if key is missing
let groqClient: Groq | null = null;

function getGroqClient(): Groq {
  if (!groqClient) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("GROQ_API_KEY environment variable is not set");
    }
    groqClient = new Groq({ apiKey });
  }
  return groqClient;
}

// The JSON schema we expect from the LLM
export interface AiTaskOutput {
  tasks: Array<{
    title: string;
    subtasks: string[];
    priority: "high" | "medium" | "low";
    dueDate?: string;
  }>;
}

/**
 * Validate the parsed AI response against our expected schema.
 * Returns true if valid, false otherwise.
 */
function validateAiResponse(data: any): data is AiTaskOutput {
  if (!data || typeof data !== "object") return false;
  if (!Array.isArray(data.tasks)) return false;

  for (const task of data.tasks) {
    if (!task.title || typeof task.title !== "string") return false;
    if (!Array.isArray(task.subtasks)) return false;
    if (!["high", "medium", "low"].includes(task.priority)) return false;
    // dueDate is optional, but if present must be a string
    if (task.dueDate !== undefined && typeof task.dueDate !== "string") {
      return false;
    }
  }
  return true;
}

/**
 * Build the system prompt that forces the LLM to output
 * a strictly formatted JSON object.
 */
function buildSystemPrompt(): string {
  return `You are a project management AI assistant. When given a prompt describing a feature or project, you must break it down into actionable tasks.

You MUST respond with ONLY a valid JSON object with this exact structure:
{
  "tasks": [
    {
      "title": "string - a clear, actionable task title",
      "subtasks": ["string - subtask descriptions"],
      "priority": "high" | "medium" | "low",
      "dueDate": "optional ISO date string (YYYY-MM-DD)"
    }
  ]
}

Rules:
- Always output valid JSON. No markdown, no code blocks, no explanation.
- Create between 3-8 tasks based on the complexity of the prompt.
- Each task should have 1-4 subtasks.
- Set priority based on importance and urgency.
- If the prompt is vague, make reasonable assumptions.`;
}

/**
 * Call the Groq API with retry logic. Retries up to 2 times
 * if the response fails schema validation.
 */
export async function orchestrateWithAI(
  prompt: string
): Promise<AiTaskOutput> {
  // Check cache first
  const cacheKey = `ai:${crypto
    .createHash("md5")
    .update(prompt)
    .digest("hex")}`;

  try {
    const cached = await redisConnection.get(cacheKey);
    if (cached) {
      logger.info({ prompt: prompt.substring(0, 50) }, "AI cache hit");
      return JSON.parse(cached) as AiTaskOutput;
    }
  } catch (err) {
    logger.warn({ err }, "Failed to check AI cache, proceeding without cache");
  }

  const maxRetries = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const client = getGroqClient();

      const userPrompt =
        attempt === 0
          ? prompt
          : `IMPORTANT: You must output a JSON object with a "tasks" array. Each task must have "title" (string), "subtasks" (string array), and "priority" ("high", "medium", or "low"). Original request: ${prompt}`;

      const chatCompletion = await client.chat.completions.create({
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: userPrompt },
        ],
        model: "llama-3.3-70b-versatile",
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: 2048,
      });

      const content = chatCompletion.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from Groq API");
      }

      const parsed = JSON.parse(content);

      if (!validateAiResponse(parsed)) {
        throw new Error(
          `Schema validation failed on attempt ${attempt + 1}`
        );
      }

      // Cache successful response
      try {
        await redisConnection.setex(
          cacheKey,
          AI_CACHE_TTL,
          JSON.stringify(parsed)
        );
      } catch (cacheErr) {
        logger.warn({ cacheErr }, "Failed to cache AI response");
      }

      logger.info(
        { taskCount: parsed.tasks.length, attempt: attempt + 1 },
        "AI orchestration successful"
      );

      return parsed;
    } catch (err) {
      lastError = err as Error;
      logger.warn(
        { err, attempt: attempt + 1, maxRetries: maxRetries + 1 },
        "AI orchestration attempt failed"
      );

      if (attempt < maxRetries) {
        // Wait a bit before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  // All retries exhausted - return fallback
  logger.error({ err: lastError, prompt: prompt.substring(0, 100) },
    "AI orchestration failed after all retries, returning fallback"
  );

  return {
    tasks: [
      {
        title: "Review and plan: " + prompt.substring(0, 80),
        subtasks: [
          "Analyze the requirements",
          "Break down into smaller tasks",
          "Estimate effort and priority",
        ],
        priority: "medium",
      },
    ],
  };
}
