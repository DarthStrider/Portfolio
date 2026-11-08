import express, { type NextFunction, type Request, type Response } from "express";
import { migrate, pool } from "./db.js";
import { router } from "./routes.js";

const port = Number(process.env.PORT ?? 8080);

const app = express();
app.use(express.json());
app.use("/api", router);

// Express 5 forwards errors from async handlers here.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "internal server error" });
});

await migrate();
const server = app.listen(port, () => console.log(`API listening on :${port}`));

// Kubernetes sends SIGTERM before stopping a pod: finish in-flight requests, then exit.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}
