import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { createRouter } from "./routes.js";
import type { TaskStore } from "./store.js";

/** The Express app, given where tasks are stored. index.ts passes PostgreSQL; tests pass memory. */
export function createApp(tasks: TaskStore): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", createRouter(tasks));

  // Express 5 forwards errors from async handlers here.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "internal server error" });
  });

  return app;
}
