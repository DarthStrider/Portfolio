import { Router, type Request, type Response } from "express";
import os from "node:os";
import { pool, tasks } from "./db.js";

export const router = Router();

function parseId(req: Request, res: Response): number | undefined {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "id must be a positive integer" });
    return undefined;
  }
  return id;
}

function validTitle(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200;
}

// Liveness: the process is up. Kubernetes restarts the pod if this fails.
router.get("/health/live", (_req, res) => {
  res.json({ status: "ok" });
});

// Readiness: the database is reachable. Kubernetes stops sending traffic if this fails.
router.get("/health/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "database unavailable" });
  }
});

// Which pod answered. Inside Kubernetes the hostname is the pod name.
router.get("/info", (_req, res) => {
  res.json({ hostname: os.hostname() });
});

router.get("/tasks", async (_req, res) => {
  res.json(await tasks.list());
});

router.post("/tasks", async (req, res) => {
  const { title } = req.body ?? {};
  if (!validTitle(title)) {
    res.status(400).json({ error: "title is required (1-200 characters)" });
    return;
  }
  res.status(201).json(await tasks.create(title.trim()));
});

router.patch("/tasks/:id", async (req, res) => {
  const id = parseId(req, res);
  if (id === undefined) return;
  const { title, done } = req.body ?? {};
  if (title !== undefined && !validTitle(title)) {
    res.status(400).json({ error: "title must be 1-200 characters" });
    return;
  }
  if (done !== undefined && typeof done !== "boolean") {
    res.status(400).json({ error: "done must be true or false" });
    return;
  }
  const updated = await tasks.update(id, { title: title?.trim(), done });
  if (!updated) {
    res.status(404).json({ error: "task not found" });
    return;
  }
  res.json(updated);
});

router.delete("/tasks/:id", async (req, res) => {
  const id = parseId(req, res);
  if (id === undefined) return;
  if (!(await tasks.remove(id))) {
    res.status(404).json({ error: "task not found" });
    return;
  }
  res.status(204).end();
});
