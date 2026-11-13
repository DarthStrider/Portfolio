#!/usr/bin/env node
/**
 * Starts all five Vention snacks with one command:  npm start  (from this folder)
 *
 *   Snack 5  Parts inventory: database + API + page, in Docker   http://localhost:8081
 *   Snack 1  The robot arm (saves to Snack 5)                     http://localhost:5173
 *   Snack 2  The React control panel                              http://localhost:5174
 *   Snack 3  Conveyor + physics                                   http://localhost:5175
 *   Snack 4  The refactor kata: no app, so it prints a quote and runs its tests once
 *
 * Options:  --mongo   MongoDB instead of PostgreSQL for Snack 5
 *           --open    open the four pages in the browser
 *
 * Ctrl+C stops the three web servers. The database keeps running so the next start is quick;
 * `npm run stop` stops it. No dependencies: only Node's own modules, so it runs before any
 * `npm ci`, and does those itself the first time.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const PROFILE = args.has("--mongo") ? "mongo" : "postgres";
const COMPOSE = join(ROOT, "snack5-inventory", "docker-compose.yml");

/** The three browser apps, each on a fixed port so the URLs never change. */
const APPS = [
  { name: "snack1", dir: "snack1-robot-arm", port: 5173, title: "Robot arm", color: 36 },
  { name: "snack2", dir: "snack2-control-panel", port: 5174, title: "Control panel", color: 35 },
  { name: "snack3", dir: "snack3-conveyor-physics", port: 5175, title: "Conveyor + physics", color: 33 },
];

const children = [];
const paint = (code, text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
const say = (text) => console.log(paint(1, `\n▸ ${text}`));

/** Runs a command to completion, showing its output with a [name] prefix. */
function run(name, color, cmd, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    pipe(child, name, color);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${name}: "${cmd}" exited with ${code}`))));
  });
}

/** Starts a long-running command; its output is prefixed so you can tell the apps apart. */
function start(name, color, cmd, cwd) {
  const child = spawn(cmd, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
  pipe(child, name, color);
  child.on("exit", (code) => {
    if (!stopping) console.log(paint(31, `[${name}] stopped (exit code ${code})`));
  });
  children.push(child);
}

function pipe(child, name, color) {
  const tag = paint(color, `[${name}]`.padEnd(9));
  for (const stream of [child.stdout, child.stderr]) {
    let rest = "";
    stream.on("data", (chunk) => {
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop();
      for (const line of lines) if (line.trim()) console.log(`${tag} ${line}`);
    });
  }
}

/** Installs a project's packages the first time it's started (later, run `npm ci` in it after pulling changes). */
async function install(dir, name, color) {
  const cwd = join(ROOT, dir);
  if (existsSync(join(cwd, "node_modules"))) return;
  console.log(`${paint(color, `[${name}]`.padEnd(9))} first run: npm ci`);
  await run(name, color, "npm ci --no-audit --no-fund", cwd);
}

let stopping = false;
function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  console.log(paint(1, "\nStopping the web servers. The database keeps running: `npm run stop` stops it."));
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => stopAll());
process.on("SIGTERM", () => stopAll());

try {
  say(`Snack 5: parts inventory (${PROFILE}), in Docker. The first time builds the images, which takes a minute or two.`);
  await run("snack5", 32, `docker compose -f "${COMPOSE}" --profile ${PROFILE} up -d --build --wait`, ROOT);

  say("Snack 4: the refactor kata has no app, so here's a quote from it, and its tests.");
  await install("snack4-refactor-kata", "snack4", 34);
  await run("snack4", 34, "npm run demo", join(ROOT, "snack4-refactor-kata"));
  await run("snack4", 34, "npm test", join(ROOT, "snack4-refactor-kata")).catch((e) => console.log(paint(31, e.message)));

  say("Snacks 1–3: starting the web servers.");
  for (const app of APPS) await install(app.dir, app.name, app.color);
  for (const app of APPS) {
    start(app.name, app.color, `npx vite --port ${app.port} --strictPort${args.has("--open") ? " --open" : ""}`, join(ROOT, app.dir));
  }

  // Wait until all three answer, then print where everything is.
  await Promise.all(APPS.map((app) => waitFor(`http://localhost:${app.port}/`)));
  const rows = [
    ["1", "Robot arm", "http://localhost:5173"],
    ["2", "Control panel", "http://localhost:5174"],
    ["3", "Conveyor + physics", "http://localhost:5175"],
    ["4", "Refactor kata", "(printed above)"],
    ["5", "Parts inventory", "http://localhost:8081"],
  ];
  if (args.has("--open")) openUrl("http://localhost:8081");
  console.log(paint(1, "\nAll five Vention snacks are running:\n"));
  for (const [n, title, url] of rows) console.log(`  Snack ${n}  ${title.padEnd(20)} ${paint(36, url)}`);
  console.log("\nCtrl+C stops the web servers.\n");
} catch (e) {
  console.error(paint(31, `\n${e.message}`));
  if (/docker/i.test(e.message)) console.error("Is Docker Desktop running?");
  stopAll(1);
}

async function waitFor(url, seconds = 60) {
  for (let i = 0; i < seconds * 2; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} didn't answer within ${seconds} s`);
}

function openUrl(url) {
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  spawn(cmd, { shell: true, stdio: "ignore" }).unref();
}
