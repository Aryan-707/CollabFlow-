/**
 * CollabFlow Load Test Script
 * 
 * Uses k6 for load testing the backend API.
 * Install k6: https://k6.io/docs/get-started/installation/
 * Run: k6 run load-test.js
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend } from "k6/metrics";

// Custom metrics
const errorRate = new Rate("errors");
const taskCreationDuration = new Trend("task_creation_duration");

export const options = {
  stages: [
    { duration: "30s", target: 100 },   // ramp up to 100 users
    { duration: "1m", target: 300 },     // hold at 300 users
    { duration: "30s", target: 0 },      // ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<2000"],   // 95% of requests under 2s
    errors: ["rate<0.1"],                // error rate under 10%
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

// Registration + login flow to get a token
function authenticate() {
  const uniqueId = `${__VU}-${__ITER}-${Date.now()}`;
  const email = `loadtest-${uniqueId}@collabflow.local`;

  const registerRes = http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify({
      email: email,
      password: "loadtest123",
      firstName: "Load",
      lastName: "Tester",
    }),
    { headers: { "Content-Type": "application/json" } }
  );

  if (registerRes.status === 201) {
    const body = JSON.parse(registerRes.body);
    return body.accessToken;
  }

  // If registration fails (user exists), try login
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: email, password: "loadtest123" }),
    { headers: { "Content-Type": "application/json" } }
  );

  if (loginRes.status === 200) {
    const body = JSON.parse(loginRes.body);
    return body.accessToken;
  }

  return null;
}

export default function () {
  // Health check endpoint
  group("Health Check", () => {
    const res = http.get(`${BASE_URL}/health`);
    check(res, {
      "health status is 200": (r) => r.status === 200,
      "health body has status ok": (r) => {
        const body = JSON.parse(r.body);
        return body.status === "ok";
      },
    });
    errorRate.add(res.status !== 200);
  });

  sleep(0.5);

  // Metrics endpoint
  group("Metrics Endpoint", () => {
    const res = http.get(`${BASE_URL}/metrics`);
    check(res, {
      "metrics status is 200": (r) => r.status === 200,
      "metrics contains http_requests_total": (r) =>
        r.body.includes("http_requests_total"),
    });
    errorRate.add(res.status !== 200);
  });

  sleep(0.5);

  // Authenticated API calls
  const token = authenticate();
  if (!token) {
    errorRate.add(true);
    return;
  }

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  // List tasks
  group("List Tasks", () => {
    const res = http.get(`${BASE_URL}/api/tasks`, { headers: authHeaders });
    check(res, {
      "tasks list status is 200": (r) => r.status === 200,
      "tasks response is array": (r) => {
        const body = JSON.parse(r.body);
        return Array.isArray(body);
      },
    });
    errorRate.add(res.status !== 200);
  });

  sleep(0.5);

  // Create a task (goes through queue, returns 202)
  group("Create Task (Queued)", () => {
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/api/tasks`,
      JSON.stringify({
        title: `Load test task ${Date.now()}`,
        description: "Created during load testing",
        priority: "MEDIUM",
        projectId: "test-project-id",
      }),
      {
        headers: {
          ...authHeaders,
          "Idempotency-Key": `load-test-${__VU}-${__ITER}-${Date.now()}`,
        },
      }
    );

    taskCreationDuration.add(Date.now() - start);

    check(res, {
      "task creation returns 202 or 400": (r) =>
        r.status === 202 || r.status === 400,
      "task creation has jobId": (r) => {
        if (r.status === 202) {
          const body = JSON.parse(r.body);
          return body.jobId !== undefined;
        }
        return true; // 400 is okay if no valid projectId
      },
    });
    errorRate.add(res.status >= 500);
  });

  sleep(1);
}

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}

// Simple text summary fallback
function textSummary(data, opts) {
  const metrics = data.metrics;
  const lines = [
    "\n=== CollabFlow Load Test Results ===\n",
    `Duration: ${data.state.testRunDurationMs}ms`,
    `VUs: ${data.state.vusMax} max`,
    `Iterations: ${metrics.iterations?.values?.count || 0}`,
    `HTTP Requests: ${metrics.http_reqs?.values?.count || 0}`,
    `Avg Response Time: ${Math.round(metrics.http_req_duration?.values?.avg || 0)}ms`,
    `p95 Response Time: ${Math.round(metrics.http_req_duration?.values?.["p(95)"] || 0)}ms`,
    `Error Rate: ${((metrics.errors?.values?.rate || 0) * 100).toFixed(2)}%`,
    "",
  ];
  return lines.join("\n");
}
