import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import cors from "cors";
import express, {
  type ErrorRequestHandler,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import { PRODUCT_NAME, type HealthResponse } from "@tlhn/shared";
import type { DatabaseHealth } from "./db/health.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const frontendDistPath = path.resolve(__dirname, "../../frontend/dist");

export interface AppDependencies {
  checkDatabaseHealth: () => Promise<DatabaseHealth>;
}

export function createApp(dependencies: AppDependencies): express.Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(compression());
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", async (_req: Request, res: Response<HealthResponse>, next) => {
    try {
      const database = await dependencies.checkDatabaseHealth();
      const status = database.status === "ok" ? "ok" : "error";

      res.status(status === "ok" ? 200 : 503).json({
        status,
        service: "api",
        product: PRODUCT_NAME,
        database,
      });
    } catch (error) {
      next(error);
    }
  });

  app.use(express.static(frontendDistPath));

  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(path.join(frontendDistPath, "index.html"), (error) => {
      if (error) {
        res.status(404).json({
          error: "Frontend build not found. Run `npm run build` first.",
        });
      }
    });
  });

  app.use(errorHandler);

  return app;
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error("Unhandled request error", err);

  if (res.headersSent) {
    return;
  }

  res.status(500).json({ error: "Internal server error" });
};
