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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const frontendDistPath = path.resolve(__dirname, "../../frontend/dist");

export function createApp(): express.Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(compression());
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req: Request, res: Response<HealthResponse>) => {
    res.json({
      status: "ok",
      service: "api",
      product: PRODUCT_NAME,
    });
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
