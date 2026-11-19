import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { createCorsMiddleware } from "./cors";
import { clearLegacySessionCookie } from "./cookies";
import { registerBrokerWebhook } from "../webhooks/broker";
import { registerManualAuthRoutes } from "./manual-auth-routes";
import { registerGuestSupportRoutes } from "../guest-support";
import { registerHealthRoutes } from "../health";
import { createExternalSavingsAutoPayoutHandler, registerSavingsAutoPayoutHeartbeat, SAVINGS_EXTERNAL_AUTO_PAYOUT_PATH } from "../savings-heartbeat";
import { ensureSavingsAutoPayoutHeartbeat } from "../savings-scheduler";

async function startServer() {
  const app = express();
  const server = createServer(app);
  const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "web");

  app.use(createCorsMiddleware());
  app.use(clearLegacySessionCookie());

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Production serves the exported Expo Web app from the same origin as the API.
  // In local development Metro owns port 8081, so this is intentionally a no-op
  // when the production export directory is not present.
  app.use(express.static(webRoot, { index: "index.html" }));

  registerStorageProxy(app);
  registerManualAuthRoutes(app);
  registerGuestSupportRoutes(app);
  registerBrokerWebhook(app);
  registerSavingsAutoPayoutHeartbeat(app);
  app.get(SAVINGS_EXTERNAL_AUTO_PAYOUT_PATH, createExternalSavingsAutoPayoutHandler());

  registerHealthRoutes(app);

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  // Expo Router's static build needs an HTML fallback for client-side routes.
  // Never turn an unknown API path into HTML, otherwise health/webhook failures
  // become misleading 200 responses.
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(resolve(webRoot, "index.html"), (error) => {
      if (error) next();
    });
  });

  const port = parseInt(process.env.PORT || "3000");
  server.listen(port, "0.0.0.0", () => {
    console.log("[api] server listening");
  });
  if (process.env.NODE_ENV === "production") {
    void ensureSavingsAutoPayoutHeartbeat().catch((error) => {
      console.error("[savings-auto-payout] startup schedule check failed", error instanceof Error ? error.name : "unknown");
    });
  }
  let stopping=false;
  const shutdown=()=>{
    if(stopping)return;stopping=true;
    console.log("[api] graceful shutdown");
    server.close(()=>process.exit(0));
    setTimeout(()=>process.exit(1),15000).unref();
  };
  process.once("SIGTERM",shutdown);process.once("SIGINT",shutdown);
}

startServer().catch(() => {
  console.error("[api] server failed to start");
  process.exitCode=1;
});
