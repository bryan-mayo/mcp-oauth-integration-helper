import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { registerMetadataRoutes } from "./oauth/metadata.js";
import { registerRegisterRoute } from "./oauth/register.js";
import { registerAuthorizeRoutes } from "./oauth/authorize.js";
import { registerTokenRoute } from "./oauth/token.js";
import { registerMcpRoutes } from "./mcp/routes.js";
import { registerDevRoutes } from "./dev/routes.js";

export function createApp() {
  const app = express();

  const corsOptions: cors.CorsOptions = {
    origin: (origin, cb) => {
      // Same-origin / curl / server-to-server (no Origin header) always allowed.
      if (!origin) {
        cb(null, true);
        return;
      }
      if (config.allowedOrigins.includes(origin)) {
        cb(null, true);
        return;
      }
      cb(new Error(`CORS origin not allowed: ${origin}`));
    },
  };
  app.use(cors(corsOptions));

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  registerMetadataRoutes(app);
  registerRegisterRoute(app);
  registerAuthorizeRoutes(app);
  registerTokenRoute(app);
  registerMcpRoutes(app);
  registerDevRoutes(app);

  return app;
}
