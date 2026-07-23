import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { AppConfig } from "./config.js";
import { publicConfig } from "./config.js";
import {
  BudgetError,
  InputError,
  TOOL_DEFINITIONS,
  getTool,
  parseAccountId,
  parseBudgetTinybar,
  parseDepth,
  publicTool,
} from "./domain.js";
import { MirrorClient, MirrorError } from "./mirror.js";
import { createBuyerHttpClient, createToolPaymentMiddleware, purchaseTool } from "./payment.js";
import { DemoGate, RunEngine, RunStore } from "./runs.js";
import { createToolExecutors } from "./tools.js";

type Variables = { accountId: string };

export type AppDependencies = {
  mirror?: MirrorClient;
  paymentMiddleware?: MiddlewareHandler;
  runStore?: RunStore;
};

function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
  };
}

function openApi(config: AppConfig) {
  const toolPaths = Object.fromEntries(
    TOOL_DEFINITIONS.map(tool => [
      tool.endpoint,
      {
        get: {
          summary: `${tool.name} (x402 protected)`,
          description: tool.description,
          parameters: [{ name: "account", in: "query", required: true, schema: { type: "string", pattern: "^0\\.0\\.[0-9]+$" } }],
          responses: {
            "200": { description: "Paid evidence result; PAYMENT-RESPONSE contains settlement proof" },
            "400": { description: "Invalid account id" },
            "402": { description: `${tool.priceTinybar} tinybar required through Hedera x402` },
          },
        },
      },
    ]),
  );
  return {
    openapi: "3.1.0",
    info: { title: "Sentinel402", version: "0.1.0", description: "Autonomous pay-per-evidence procurement on Hedera x402" },
    servers: [{ url: config.publicBaseUrl }],
    paths: {
      "/api/health": { get: { summary: "Service health", responses: { "200": { description: "Healthy" } } } },
      "/api/catalog": { get: { summary: "Discover paid tools", responses: { "200": { description: "Tool catalog" } } } },
      "/api/runs": { post: { summary: "Start an autonomous buyer run", responses: { "202": { description: "Run queued" }, "429": { description: "Demo cooldown" }, "503": { description: "Buyer not configured" } } } },
      "/api/runs/{id}": { get: { summary: "Poll a run", responses: { "200": { description: "Run state" }, "404": { description: "Unknown run" } } } },
      ...toolPaths,
    },
  };
}

export function createApp(config: AppConfig, dependencies: AppDependencies = {}) {
  const app = new Hono<{ Variables: Variables }>();
  const mirror = dependencies.mirror ?? new MirrorClient(config.mirrorUrl);
  const tools = createToolExecutors(mirror, config.evidenceWindowMinutes);
  const store = dependencies.runStore ?? new RunStore();
  const gate = new DemoGate(config.demoCooldownSeconds);
  const buyerClient = createBuyerHttpClient(config);
  const engine = buyerClient ? new RunEngine(store, config.internalBaseUrl, buyerClient, purchaseTool, () => gate.leave()) : null;

  app.use("*", securityHeaders());
  app.use("/api/*", async (c, next) => {
    const requestId = crypto.randomUUID();
    c.header("X-Request-Id", requestId);
    const started = performance.now();
    await next();
    c.header("Server-Timing", `app;dur=${(performance.now() - started).toFixed(1)}`);
  });

  app.onError((error, c) => {
    if (error instanceof InputError || error instanceof BudgetError) return c.json({ error: error.message }, error.status);
    if (error instanceof MirrorError) return c.json({ error: "Evidence source unavailable", detail: error.message }, 502);
    console.error("[sentinel402] request failed", error instanceof Error ? error.message : error);
    return c.json({ error: "Internal server error" }, 500);
  });

  app.get("/api/health", c => c.json({ status: "ok", service: "sentinel402", version: "0.1.0", ...publicConfig(config) }));
  app.get("/api/catalog", c => c.json({ protocol: "x402-v2", tools: TOOL_DEFINITIONS.map(publicTool), policyDepths: ["quick", "standard", "deep"], ...publicConfig(config) }));
  app.get("/openapi.json", c => c.json(openApi(config)));

  app.get("/api/runs/recent", c => c.json({ runs: store.recent() }));
  app.get("/api/runs/:id", c => {
    const run = store.get(c.req.param("id"));
    return run ? c.json(run) : c.json({ error: "Run not found" }, 404);
  });

  app.post("/api/runs", async c => {
    if (!engine) return c.json({ error: "Autonomous buyer is not configured" }, 503);
    const contentLength = Number(c.req.header("content-length") ?? "0");
    if (contentLength > 4_096) throw new InputError("request body is too large");
    const body = await c.req.json<Record<string, unknown>>().catch(() => {
      throw new InputError("request body must be valid JSON");
    });
    const accountId = parseAccountId(body.account);
    const depth = parseDepth(body.depth);
    const budget = parseBudgetTinybar(body.budgetTinybar, config.demoMaxBudgetTinybar);
    const gateResult = gate.enter();
    if (!gateResult.ok) {
      c.header("Retry-After", String(gateResult.retryAfterSeconds));
      return c.json({ error: gateResult.reason, retryAfterSeconds: gateResult.retryAfterSeconds }, 429);
    }
    try {
      const run = store.create(accountId, depth, budget);
      engine.start(run.id);
      c.header("Location", `/api/runs/${run.id}`);
      return c.json(run, 202);
    } catch (error) {
      gate.leave();
      throw error;
    }
  });

  app.use("/api/tools/:tool", async (c, next) => {
    const tool = getTool(c.req.param("tool"));
    if (!tool) return c.json({ error: "Tool not found" }, 404);
    c.set("accountId", parseAccountId(c.req.query("account")));
    await next();
  });

  app.use("/api/tools/*", dependencies.paymentMiddleware ?? createToolPaymentMiddleware(config));
  app.get("/api/tools/identity", async c => c.json(await tools.identity(c.get("accountId"))));
  app.get("/api/tools/flow", async c => c.json(await tools.flow(c.get("accountId"))));
  app.get("/api/tools/risk", async c => c.json(await tools.risk(c.get("accountId"))));

  app.use("/*", serveStatic({ root: "./public" }));
  app.get("*", serveStatic({ path: "./public/index.html" }));

  return { app, store };
}
