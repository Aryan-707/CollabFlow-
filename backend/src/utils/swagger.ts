import swaggerJsdoc from "swagger-jsdoc";

const swaggerOptions: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "CollabFlow API",
      version: "1.0.0",
      description:
        "Event-Driven AI Workflow Engine with Real-Time Collaboration. " +
        "All write operations (POST/PUT/DELETE) go through BullMQ queues and return 202 Accepted with a jobId. " +
        "The actual database write is performed asynchronously by background workers.",
      contact: {
        name: "Aryan Aggarwal",
        email: "aryanaggarwal0420@gmail.com",
      },
      license: {
        name: "MIT",
        url: "https://github.com/Aryan-707/CollabFlow-/blob/main/LICENSE",
      },
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Local development server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Enter your JWT access token",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        QueuedResponse: {
          type: "object",
          properties: {
            message: { type: "string", example: "Task creation queued" },
            jobId: { type: "string", example: "1" },
            idempotencyKey: { type: "string", example: "abc123def456" },
          },
        },
        User: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            email: { type: "string", format: "email" },
            firstName: { type: "string" },
            lastName: { type: "string" },
            avatar: { type: "string", nullable: true },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Task: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            title: { type: "string" },
            description: { type: "string", nullable: true },
            status: { type: "string", enum: ["TODO", "IN_PROGRESS", "DONE"] },
            priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
            dueDate: { type: "string", format: "date-time", nullable: true },
            version: { type: "integer" },
            projectId: { type: "string", format: "uuid" },
            createdBy: { type: "string", format: "uuid", nullable: true },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        Project: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            slug: { type: "string" },
            description: { type: "string", nullable: true },
            color: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        AiOrchestrateRequest: {
          type: "object",
          required: ["prompt", "projectId"],
          properties: {
            prompt: { type: "string", example: "Plan a user authentication system" },
            projectId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    paths: {
      "/health": {
        get: {
          tags: ["System"],
          summary: "Health check",
          description: "Returns server health status, timestamp, and uptime",
          responses: {
            "200": {
              description: "Server is healthy",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string", example: "ok" },
                      timestamp: { type: "string", format: "date-time" },
                      uptime: { type: "number" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/auth/register": {
        post: {
          tags: ["Authentication"],
          summary: "Register a new user",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: {
                    email: { type: "string", format: "email" },
                    password: { type: "string", minLength: 3 },
                    firstName: { type: "string" },
                    lastName: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "User registered, returns tokens" },
            "409": { description: "Email already exists" },
          },
        },
      },
      "/api/auth/login": {
        post: {
          tags: ["Authentication"],
          summary: "Login with email and password",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: {
                    email: { type: "string", format: "email" },
                    password: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Login success, returns tokens" },
            "401": { description: "Invalid credentials" },
          },
        },
      },
      "/api/auth/refresh": {
        post: {
          tags: ["Authentication"],
          summary: "Refresh access token",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["refreshToken"],
                  properties: {
                    refreshToken: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "New token pair returned" },
            "401": { description: "Invalid refresh token" },
          },
        },
      },
      "/api/users/me": {
        get: {
          tags: ["Users"],
          summary: "Get current user profile",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "User profile",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/User" },
                },
              },
            },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/projects": {
        get: {
          tags: ["Projects"],
          summary: "List user's projects",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Array of projects",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Project" },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["Projects"],
          summary: "Create a new project (queued)",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: false,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    color: { type: "string", example: "#6366f1" },
                  },
                },
              },
            },
          },
          responses: {
            "202": {
              description: "Project creation queued",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/QueuedResponse" },
                },
              },
            },
          },
        },
      },
      "/api/tasks": {
        get: {
          tags: ["Tasks"],
          summary: "List tasks",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "projectId", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "priority", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "Array of tasks",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Task" },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["Tasks"],
          summary: "Create a task (queued via BullMQ)",
          description:
            "Adds a task creation job to the queue. Returns 202 with jobId. " +
            "The task will appear in the database after worker processing.",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: false,
              schema: { type: "string" },
              description: "Prevents duplicate creation within 24 hours",
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["title", "projectId"],
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                    status: { type: "string", default: "TODO" },
                    priority: { type: "string", default: "MEDIUM" },
                    dueDate: { type: "string", format: "date-time" },
                    projectId: { type: "string", format: "uuid" },
                    parentId: { type: "string", format: "uuid" },
                  },
                },
              },
            },
          },
          responses: {
            "202": {
              description: "Task creation queued",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/QueuedResponse" },
                },
              },
            },
          },
        },
      },
      "/api/ai/orchestrate": {
        post: {
          tags: ["AI Orchestration"],
          summary: "Generate tasks from natural language prompt",
          description:
            "Sends a prompt to the Groq LLM, which generates structured tasks. " +
            "Each task is then added to the BullMQ queue for creation. " +
            "Includes schema validation, 2-retry logic, and Redis caching (1h TTL).",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AiOrchestrateRequest" },
              },
            },
          },
          responses: {
            "202": {
              description: "AI orchestration job queued",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      message: { type: "string" },
                      jobId: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/metrics": {
        get: {
          tags: ["System"],
          summary: "Prometheus metrics",
          description: "Returns metrics in Prometheus exposition format",
          responses: {
            "200": { description: "Prometheus formatted metrics" },
          },
        },
      },
    },
  },
  apis: [],
};

export const swaggerSpec = swaggerJsdoc(swaggerOptions);
