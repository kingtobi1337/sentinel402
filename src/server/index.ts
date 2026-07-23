import { serve } from "@hono/node-server";
import { loadConfig } from "../config.js";
import { createApp } from "../app.js";

const config = loadConfig();
const { app } = createApp(config);

const server = serve({ fetch: app.fetch, port: config.port }, info => {
  console.log(`[sentinel402] listening on http://${info.address}:${info.port}`);
  console.log(`[sentinel402] payments=${config.hederaNetwork} buyer=${config.buyer ? "ready" : "not-configured"}`);
});

function shutdown(signal: string) {
  console.log(`[sentinel402] ${signal} received; closing server`);
  server.close(error => {
    if (error) {
      console.error("[sentinel402] shutdown failed", error.message);
      process.exitCode = 1;
    }
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
