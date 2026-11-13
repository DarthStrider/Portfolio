"""Builds "Task Tracker, Line by Line: Node.js and PostgreSQL" (task-tracker-node-book.pdf) from the real source.

Run from anywhere: python3 "Full Stack/node-postgres/walkthrough/build_walkthrough.py"  (needs reportlab and the
DejaVu fonts). Line numbers are computed from the files at build time, so rebuild after changing the code; a listing
whose anchor text has gone stops the build.
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "..", "walkthrough-kit"))

from bookkit import Book, M  # noqa: E402
import frontend  # noqa: E402
from reportlab.graphics.shapes import Drawing  # noqa: E402

WF = "../../.github/workflows/fullstack-node-postgres.yml"
DB = "../../.github/dependabot.yml"


def arch(b):
    d = Drawing(486, 120)
    b.box(d, 0, 30, 90, 60, "Browser", ["React page", "calls /api/..."])
    b.box(d, 125, 30, 100, 60, "web", ["nginx", "page + /api proxy"])
    b.box(d, 260, 30, 100, 60, "api  (×2)", ["Node.js, Express", "TaskStore"])
    b.box(d, 395, 30, 91, 60, "postgres", ["PostgreSQL 17", "table: tasks"])
    b.arrow(d, 90, 60, 125, 60, label=":8080")
    b.arrow(d, 225, 60, 260, 60, label="api:8080")
    b.arrow(d, 360, 60, 395, 60, label=":5432")
    return d


def part0(b):
    b.PART("Part 0", "The big picture",
           "A task tracker in three containers: a React page served by nginx, an Express API in TypeScript, and "
           "PostgreSQL. It runs the same way under Docker Compose and Kubernetes, and every push is tested in CI.")
    b.H1("0.1 The pieces")
    b.figure(arch(b), "Figure 0.1. One request: the browser asks nginx, nginx forwards /api to the API, the API "
             "queries PostgreSQL.")
    b.T([["Piece", "Built with", "Job"],
         ["web", "React 19, Vite, nginx", "Serves the page; forwards " + M("/api/") + " to the API"],
         ["api", "Node.js 22, Express 5, pg, TypeScript", "REST endpoints, validation, SQL"],
         ["postgres", "PostgreSQL 17", "Stores tasks; its data survives restarts in a volume"]], [1.0, 2.4, 3.35])
    b.H1("0.2 The API")
    b.T([["Method and path", "Does", "Answers"],
         ["GET /api/tasks", "List tasks, oldest first", "200 + array"],
         ["POST /api/tasks", "Create from " + M("{ title }"), "201 + task; 400 if the title is bad"],
         ["PATCH /api/tasks/:id", "Change " + M("title") + " and/or " + M("done"), "200 + task; 400; 404"],
         ["DELETE /api/tasks/:id", "Delete", "204; 400; 404"],
         ["GET /api/health/live", "Is the process up?", "200"],
         ["GET /api/health/ready", "Can it reach the database?", "200 or 503"],
         ["GET /api/info", "Which pod answered", "200 + " + M("{ hostname }")]], [1.9, 2.55, 2.3])
    b.H1("0.3 The layout")
    b.T([["Path", "What's there"],
         [M("api/src/"), "store.ts (the storage interface), validation.ts, routes.ts, app.ts, db.ts (PostgreSQL), index.ts"],
         [M("api/tests/"), "Validation, routes over HTTP, and one store contract run against memory and PostgreSQL"],
         [M("frontend/"), "React app, its tests, nginx.conf and Dockerfile"],
         [M("k8s/"), "Kubernetes manifests, applied with " + M("kubectl apply -k k8s")],
         [M("docker-compose.yml"), "All three containers locally"],
         [M("walkthrough/"), "This book and the script that builds it"]], [1.9, 4.85])
    b.P("One idea shapes the API: <b>the routes don't know where tasks are stored</b>. They talk to a "
        + M("TaskStore") + " interface. The running app passes PostgreSQL; the tests pass an in-memory store. A "
        "shared contract test checks that both behave the same.")
    b.CALL("This book is generated from the source by " + M("walkthrough/build_walkthrough.py") + ". Every listing "
           "is the real file with its real line numbers, and the bold \"Line n\" notes refer to them.")


def part1(b):
    b.PART("Part 1", "The API",
           "Six small files, each with one job. Read them in this order: what storage must do, what valid input is, "
           "the routes, the app, PostgreSQL, and startup.")

    b.H1("1.1 store.ts: what storage must do")
    b.whole("api/src/store.ts", "ts")
    b.notes("api/src/store.ts", [
        ("export type TaskChanges = { title?: string; done?: boolean };", "A PATCH body: both fields optional. "
         "Missing means \"leave as is\", which is different from " + M("false") + "."),
        ("update(id: number, changes: TaskChanges): Promise<TaskRow | undefined>;", "\"Not found\" is part of the "
         "type, not an exception. The route turns it into a 404."),
        ("ping(): Promise<void>;", "For the readiness probe: throws if the database is unreachable."),
    ])
    b.P("This is the seam that makes the API testable. Express and HTTP are on one side, SQL on the other, and "
        "neither needs the other to be tested.")

    b.H1("1.2 validation.ts: what valid input is")
    b.whole("api/src/validation.ts", "ts")
    b.notes("api/src/validation.ts", [
        ("const id = Number(value);", "Route parameters are always strings. " + M("Number(\"42\")") + " is 42; "
         + M("Number(\"abc\")") + " is " + M("NaN") + "; " + M("Number(\"\")") + " is 0."),
        ("return Number.isInteger(id) && id >= 1 ? id : undefined;", M("isInteger") + " rejects " + M("NaN") +
         " and 1.5; " + M(">= 1") + " rejects 0 and negatives. SERIAL ids start at 1."),
        ("export function validTitle(value: unknown): value is string {", "A <b>type guard</b>: when it returns true, "
         "TypeScript treats " + M("value") + " as a string afterwards. The parameter is " + M("unknown") + " because "
         "a JSON body can hold anything."),
        ("return typeof value === \"string\" && value.trim().length > 0 && value.length <= MAX_TITLE;", "Not blank, "
         "and at most 200 characters, matching the " + M("VARCHAR(200)") + " column. The length is measured before "
         "trimming, so \"  x\" padded past 200 is refused even though the trimmed text would fit: strict, and simple."),
    ])
    b.P("No Express here, so these rules are tested with plain function calls.")

    b.H1("1.3 routes.ts: HTTP in, store calls out")
    b.code("api/src/routes.ts", "export function createRouter(tasks: TaskStore): Router {", "ts", end="router.get(\"/info\"")
    b.notes("api/src/routes.ts", [
        ("router.get(\"/health/live\"", "<b>Liveness</b> never touches the database. If it did, a database outage "
         "would make Kubernetes restart every API pod, which fixes nothing."),
        ("router.get(\"/health/ready\"", "<b>Readiness</b> does. While it fails, Kubernetes stops sending this pod "
         "traffic but leaves it running."),
    ])
    b.code("api/src/routes.ts", "router.get(\"/tasks\"", "ts", end="  });", after=29)
    b.code("api/src/routes.ts", "router.post(\"/tasks\"", "ts")
    b.notes("api/src/routes.ts", [
        ("const { title } = req.body ?? {};", M("req.body") + " is undefined without a JSON body; " + M("?? {}") +
         " makes destructuring safe."),
        ("res.status(201).json(await tasks.create(title.trim()));", "201 Created with the new task. " + M("title") +
         " is known to be a string here, thanks to the type guard."),
    ])
    b.code("api/src/routes.ts", "router.patch(\"/tasks/:id\"", "ts")
    b.notes("api/src/routes.ts", [
        ("if (title !== undefined && !validTitle(title)) {", "Each field is checked only if it was sent."),
        ("if (done !== undefined && typeof done !== \"boolean\") {", "A string " + M("\"true\"") + " is refused: the "
         "API takes JSON booleans, not text that looks like one."),
        ("const updated = await tasks.update(id, { title: title?.trim(), done });", M("title?.trim()") + " keeps "
         "an absent title absent."),
    ])
    b.code("api/src/routes.ts", "router.delete(\"/tasks/:id\"", "ts")
    b.P("Validation errors are always 400 with " + M("{ error }") + ", a missing task is always 404, and a delete "
        "returns 204 with no body. The front end relies on all three.")

    b.H1("1.4 app.ts: assembling Express")
    b.whole("api/src/app.ts", "ts")
    b.notes("api/src/app.ts", [
        ("export function createApp(tasks: TaskStore): Express {", "A function, not a module-level " + M("app") +
         ": each caller chooses the store. That's <b>dependency injection</b> without a framework."),
        ("app.use(express.json());", "Parses JSON request bodies into " + M("req.body") + "."),
        ("app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {", "Four parameters mark an "
         "error handler. Express 5 sends rejected promises from async handlers here (Express 4 needed a wrapper). "
         "The client gets a generic message; the details go to the log, not to the caller."),
    ])

    b.H1("1.5 db.ts: PostgreSQL")
    b.code("api/src/db.ts", "export function createPool(): pg.Pool {", "ts")
    b.P("A <b>connection pool</b> keeps up to ten connections open and lends them to queries, rather than "
        "connecting for every request. With no settings passed, " + M("pg") + " reads " + M("PGHOST") + ", "
        + M("PGUSER") + " and the rest from the environment, which Compose, Kubernetes and CI set.")
    b.code("api/src/db.ts", "const COLUMNS", "ts", end="const COLUMNS")
    b.P("The column is " + M("created_at") + " in SQL (snake_case, the PostgreSQL convention) and "
        + M("createdAt") + " in JSON. The alias does the conversion in one place, and the quotes keep the capital A: "
        "PostgreSQL lower-cases unquoted names.")
    b.code("api/src/db.ts", "export async function migrate(", "ts")
    b.notes("api/src/db.ts", [
        ("CREATE TABLE IF NOT EXISTS tasks (", "Safe to run on every start: the second time, nothing happens."),
        ("id         SERIAL PRIMARY KEY,", M("SERIAL") + " is an integer filled from a sequence. Sequences never go "
         "backwards, so a deleted id isn't reused; a contract test checks that."),
        ("created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()", M("TIMESTAMPTZ") + " stores an instant, not a wall-clock "
         "time, so the time zone of the server doesn't matter."),
        ("if (i >= attempts) throw err;", "The database may still be starting. Retry every 2 seconds, up to a minute, "
         "then give up and let the process exit."),
    ])
    b.code("api/src/db.ts", "export function pgStore(pool: pg.Pool): TaskStore {", "ts")
    b.notes("api/src/db.ts", [
        ("`INSERT INTO tasks (title) VALUES ($1) RETURNING ${COLUMNS}`,", M("$1") + " is a <b>parameter</b>: the "
         "title is sent separately from the SQL text, so a title like " + M("'); DROP TABLE tasks; --") + " is just "
         "a title. " + M("RETURNING") + " gives back the new row in the same round trip. (" + M("${COLUMNS}") +
         " is inserted by JavaScript, but it's a constant, never user input.)"),
        ("SET title = COALESCE($2, title),", M("COALESCE") + " takes the first non-null: a missing field is sent as "
         + M("null") + " and the column keeps its value. One statement handles every combination of fields."),
        ("return rows[0];", "No row means no task with that id, so this is " + M("undefined") + ", as the interface promises."),
        ("return (rowCount ?? 0) > 0;", "How many rows the DELETE removed: 1 or 0."),
    ])

    b.H1("1.6 index.ts: starting and stopping")
    b.whole("api/src/index.ts", "ts")
    b.notes("api/src/index.ts", [
        ("await migrate(pool);", "<b>Top-level await</b>, allowed in ES modules (" + M("\"type\": \"module\"") +
         " in package.json). The server doesn't listen until the table exists."),
        ("server.close(() => pool.end().then(() => process.exit(0)));", "A <b>graceful shutdown</b>: stop accepting "
         "connections, let requests in progress finish, close the pool, exit. Kubernetes sends SIGTERM and waits up "
         "to 30 seconds before killing the pod."),
    ])

    b.H1("1.7 Interview questions")
    b.QA("Why put storage behind an interface in such a small app?",
         "So the HTTP layer can be tested without a database, and so the same tests can run against the real one. "
         "It costs one small file.")
    b.QA("How does this API prevent SQL injection?",
         "Every value goes through a parameter (" + M("$1") + ", " + M("$2") + "). The driver sends values separately "
         "from the SQL text, so they're never parsed as SQL.")
    b.QA("What's the difference between liveness and readiness?",
         "Liveness: should this process be restarted? Readiness: should it get traffic right now? A database outage "
         "should fail readiness only.")
    b.QA("Why validate in the route when the column is already VARCHAR(200)?",
         "To answer with a clear 400 instead of a database error turning into a 500, and to refuse bad input before "
         "using a connection.")


def part3(b):
    b.PART("Part 3", "Containers and Kubernetes",
           "The same three images run under Docker Compose on a laptop and under Kubernetes. What changes between the "
           "two is only how they find each other and where the settings come from.")
    b.H1("3.1 The API image")
    b.whole("api/Dockerfile", "docker")
    b.notes("api/Dockerfile", [
        ("COPY package.json package-lock.json ./", "Copy only the dependency files first. Docker caches each step, so "
         "while they don't change, " + M("npm ci") + " isn't re-run when you edit the code."),
        ("RUN npm ci --omit=dev && npm cache clean --force", "The runtime image gets production dependencies only: no "
         "TypeScript, no tsx, no type packages."),
        ("USER node", "The official image has a " + M("node") + " user. A process that's broken into can't act as root."),
    ])
    b.H1("3.2 Docker Compose")
    b.whole("docker-compose.yml", "yaml")
    b.notes("docker-compose.yml", [
        ("- db-data:/var/lib/postgresql/data", "A named volume: the data outlives the container. "
         + M("docker compose down -v") + " deletes it."),
        ("test: [\"CMD-SHELL\", \"pg_isready -U tasks -d tasks\"]", "Compose runs this to decide when the database is healthy..."),
        ("condition: service_healthy", "...and starts the API only after that. The API retries anyway, because "
         "Kubernetes has no such ordering."),
        ("- \"8080:80\"", "Only the web container is published. The API and database are reachable only inside "
         "Compose's network."),
    ])
    b.H1("3.3 Kubernetes")
    b.whole("k8s/kustomization.yaml", "yaml")
    b.P(M("kubectl apply -k k8s") + " applies all five files and puts everything in the " + M("tasks-node") +
        " namespace, so " + M("kubectl delete namespace tasks-node") + " removes it all.")
    b.whole("k8s/postgres.yaml", "yaml")
    b.notes("k8s/postgres.yaml", [
        ("clusterIP: None", "A <b>headless Service</b>: just a DNS name, " + M("postgres") + ", pointing at the pod."),
        ("kind: StatefulSet", "Unlike a Deployment, a StatefulSet gives its pod a stable identity and its own volume."),
        ("value: /var/lib/postgresql/data/pgdata", "A subfolder of the volume: PostgreSQL refuses to start in a folder "
         "that isn't empty, and some volumes come with a " + M("lost+found") + " folder."),
        ("volumeClaimTemplates:", "Kubernetes creates a 1 GiB volume for the pod and re-attaches it after a restart."),
    ])
    b.whole("k8s/api.yaml", "yaml")
    b.notes("k8s/api.yaml", [
        ("replicas: 2", "Two API pods. The Service spreads requests across them; the page's footer shows which one answered."),
        ("imagePullPolicy: IfNotPresent", "Use the image built locally rather than looking for it in a registry."),
        ("valueFrom: { secretKeyRef: { name: db-credentials, key: POSTGRES_USER } }", "Credentials come from a Secret "
         "rather than being written into the Deployment."),
        ("startupProbe:", "Up to 150 seconds (30 × 5) to start, while the API waits for the database. Liveness checks "
         "begin only after this succeeds, so a slow start isn't mistaken for a hang."),
        ("limits: { memory: 256Mi }", "A pod over its memory limit is killed and restarted. The request is what the "
         "scheduler reserves."),
    ])
    b.code("k8s/web.yaml", "# LoadBalancer", "yaml", end="targetPort: 80")
    b.P("Docker Desktop publishes a " + M("LoadBalancer") + " Service on " + M("localhost") + ". In a cloud, the "
        "same manifest creates a real load balancer.")
    b.code("k8s/db-secret.yaml", "# Demo credentials", "yaml", end="POSTGRES_DB: tasks")
    b.H1("3.4 Interview questions")
    b.QA("Why a StatefulSet for the database and a Deployment for the API?",
         "The API's pods are interchangeable and keep nothing; the database pod needs the same volume every time it restarts.")
    b.QA("Why multi-stage Docker builds?",
         "The build tools stay in the first stage. The final image is smaller, starts faster, and has less in it to attack.")
    b.QA("The API starts before the database is ready. What happens?",
         "migrate() retries for a minute; the startup probe gives it 150 seconds; readiness keeps traffic away until "
         "the database answers.")


def part4(b):
    b.PART("Part 4", "Tests",
           "Three layers: plain functions, the store contract (against memory and PostgreSQL), and every route over "
           "real HTTP. 30 tests in the API (the 8-test contract runs twice), 6 in the front end.")
    b.T([["File", "Tests", "Needs"],
         [M("tests/validation.test.ts"), M("parseId") + " and " + M("validTitle"), "nothing"],
         [M("tests/memory.test.ts"), "The store contract, in memory", "nothing"],
         [M("tests/postgres.test.ts"), "The store contract, in PostgreSQL", "a database named *_test (skipped otherwise)"],
         [M("tests/routes.test.ts"), "Every route over HTTP", "nothing (in-memory store)"]], [2.1, 2.5, 2.15])
    b.P("They use Node's built-in runner, " + M("node:test") + ", with " + M("tsx") + " so TypeScript runs without a "
        "build step: " + M("npm test") + ". " + M("npm run typecheck") + " type-checks the app and the tests together "
        "using " + M("tsconfig.test.json") + ".")
    b.H1("4.1 The store contract")
    b.code("api/tests/contract.ts", "export function storeContract(", "ts", end="t(\"starts empty\"")
    b.P(M("storeContract") + " doesn't run tests itself; it <i>defines</i> them for whatever store " + M("fresh") +
        " makes. Each test gets a new, empty store, so the order they run in doesn't matter.")
    b.code("api/tests/contract.ts", "t(\"update changes only the fields given\"", "ts", end="  });")
    b.code("api/tests/contract.ts", "t(\"ids are not reused after a delete\"", "ts", end="  });")
    b.P("Rules like these are easy to get subtly different in a fake. Running the same tests against both stores "
        "is what lets the route tests trust the in-memory one.")
    b.whole("api/tests/memory.test.ts", "ts")
    b.whole("api/tests/postgres.test.ts", "ts")
    b.notes("api/tests/postgres.test.ts", [
        ("const skip = database.endsWith(\"_test\")", "A safety rule: these tests empty the table, so they refuse to "
         "run against any database whose name doesn't end in " + M("_test") + ". Running " + M("npm test") + " with "
         "your Compose settings can't wipe your tasks."),
        ("await pool!.query(\"TRUNCATE tasks RESTART IDENTITY\");", "Empty table, ids from 1 again, before every test."),
        ("await pool?.end();", "Close the pool, or Node waits on the open connections and the test run never exits."),
    ])
    b.H1("4.2 The in-memory store")
    b.code("api/tests/memoryStore.ts", "export function memoryStore(", "ts")
    b.notes("api/tests/memoryStore.ts", [
        ("const copy = (r: TaskRow): TaskRow => ({ ...r, createdAt: new Date(r.createdAt) });", "Hand out copies. "
         "PostgreSQL returns new objects every time; if this returned its own rows, a caller could change stored "
         "data by editing a result."),
        ("if (options.down) throw new Error(\"database unavailable\");", "A switch to simulate an outage, for the readiness test."),
    ])
    b.H1("4.3 Routes over HTTP")
    b.code("api/tests/routes.test.ts", "before(async () => {", "ts", end="});")
    b.notes("api/tests/routes.test.ts", [
        ("const current: TaskStore = {", "The app is created once, but each test wants a fresh store. This wrapper "
         "forwards to whatever " + M("store") + " is now, so " + M("beforeEach") + " can swap it."),
        ("server = createApp(current).listen(0);", "Port 0: the operating system picks a free port. Tests never clash "
         "with a running app or with each other."),
    ])
    b.code("api/tests/routes.test.ts", "test(\"POST /tasks rejects a missing, blank or too-long title with 400\"", "ts", end="});")
    b.code("api/tests/routes.test.ts", "test(\"health: live is always ok; ready follows the database\"", "ts", end="});")
    b.P("These are real HTTP requests with " + M("fetch") + " against the real Express app, so they test routing, "
        "JSON parsing, status codes and the error handler, everything except SQL. SQL is the contract's job.")
    b.H1("4.4 Running them")
    b.T([["Command", "Runs"],
         [M("npm test") + " in api/", "Everything; the PostgreSQL contract is skipped"],
         [M("docker compose up -d db") + ", then " + M("docker compose exec db createdb -U tasks tasks_test"),
          "Creates a test database next to the real one (once)"],
         [M("PGHOST=localhost PGUSER=tasks PGPASSWORD=tasks-dev-password PGDATABASE=tasks_test npm test"),
          "Everything, including PostgreSQL (bash syntax; the README has PowerShell. Publish port 5432 first)"],
         [M("npm run check"), "Type-check, then test: what CI runs"]], [3.9, 2.85])
    b.H1("4.5 Interview questions")
    b.QA("What's a contract test?",
         "One set of tests that every implementation of an interface must pass. It keeps fakes honest, so tests that "
         "use the fake still say something about the real thing.")
    b.QA("Why listen on port 0?",
         "The OS assigns a free port, so tests can run in parallel and alongside a dev server.")
    b.QA("How do you keep database tests from damaging real data?",
         "Run them only against a database whose name marks it as disposable, create it fresh in CI, and reset it "
         "before every test.")


def part5(b):
    b.PART("Part 5", "Keeping it working",
           "Dependencies pinned by lock files, version numbers that mean something, and CI on every push: the same "
           "three ideas as the robot arm's Appendix C.")
    b.H1("5.1 package.json")
    b.whole("api/package.json", "json")
    b.notes("api/package.json", [
        ("\"version\": \"1.1.0\"", "<b>Semantic Versioning</b>: MAJOR.MINOR.PATCH. 1.1.0 added tests and refactored "
         "storage without changing the API's behaviour, so a minor version. CHANGELOG.md says what counts as breaking: "
         "the REST API and how the app is run."),
        ("\"node\": \">=22\"", M("engines") + " says which Node versions are supported; " + M(".nvmrc") + " (22) "
         "says which one to use. CI tests 22 and 24."),
        ("\"express\": \"^5.1.0\",", "A <b>caret range</b>: any 5.x from 5.1.0 up, never 6. Under SemVer, that's "
         "everything that promises not to break."),
        ("\"@types/node\": \"^22.15.0\",", "Types for the <i>oldest</i> supported Node. With types for 24, code could "
         "call a function Node 22 doesn't have and still type-check."),
    ])
    b.H1("5.2 Lock files and npm ci")
    b.P("A range says what's allowed; " + M("package-lock.json") + " records what was actually installed: the exact "
        "version and an integrity hash for every package, including the hundreds pulled in indirectly. It's committed.")
    b.T([["", M("npm install"), M("npm ci")],
         ["Reads", "package.json; updates the lock", "the lock only"],
         ["If they disagree", "rewrites the lock", "fails"],
         ["node_modules", "updated in place", "deleted and rebuilt"],
         ["Use it", "adding or upgrading a package", "CI, Dockerfiles, a fresh clone"]], [1.4, 2.65, 2.7])
    b.P("Both Dockerfiles and every CI job use " + M("npm ci") + ", so what's tested is exactly what ships.")
    b.H1("5.3 The workflow")
    b.code(WF, "name: full stack node-postgres", "yaml", end="cancel-in-progress: true", doc=False)
    b.notes(WF, [
        ("  push:", "Every push to every branch, and every pull request: no path filters, so required checks always report."),
        ("cancel-in-progress: true", "A new push to the same branch cancels the run still going for the old one."),
    ])
    b.code(WF, "  api:", "yaml", end="- run: npm run build", doc=False)
    b.notes(WF, [
        ("node: [22, 24]", "A <b>matrix</b>: the job runs twice, once per Node version. " + M("fail-fast: false") +
         " lets both finish, so you see whether a failure is version-specific."),
        ("services:", "A <b>service container</b>: a real, empty PostgreSQL started next to the job and waited for "
         "with its health check."),
        ("PGDATABASE: tasks_test", "Ends in " + M("_test") + ", so the PostgreSQL contract runs here instead of skipping."),
        ("cache: npm", "Caches npm's download cache, keyed on the lock file."),
    ])
    b.code(WF, "  images:", "yaml", end="npm audit --omit=dev --audit-level=high", doc=False)
    b.P(M("docker compose build") + " catches a broken Dockerfile. " + M("npm audit --omit=dev") + " fails on a "
        "known high or critical vulnerability in anything that ships; dev tools never reach the image, so they aren't counted.")
    b.H1("5.4 Dependabot")
    b.code(DB, "  # ---- Full Stack ----", "yaml", end="update-types: [\"version-update:semver-major\"]", doc=False)
    b.P("Every Monday, Dependabot opens pull requests for outdated packages, minor and patch updates bundled into one. "
        "Some packages must move together: React and its types are released together, Vite's React plugin needs a "
        "matching Vite, and Stripe's two packages need each other. A <b>group</b> puts each set in one pull request. "
        "A separate entry keeps the Docker base images (" + M("node:22-alpine") + ", " + M("nginx:1.31-alpine") + ", "
        + M("postgres") + ") current, monthly. Each pull request runs the workflow above, so an update that breaks "
        "something shows up red before it's merged.")
    b.H2("Green isn't always right")
    b.P("The first Dependabot run offered " + M("node:25-alpine") + " for every Dockerfile, and the images built, so CI "
        "was green, and they were merged. But Node 25 is an odd-numbered release: short-lived, and already past its end "
        "of life. The project runs on the long-term-support line (22, matching " + M("engines") + " and " + M(".nvmrc") +
        "), so the images went back to 22, and Dependabot now skips Node majors for the images. Moving to the next LTS "
        "(24) is a deliberate change of " + M("engines") + ", " + M(".nvmrc") + " and CI together, not a base-image bump.")
    b.P("Two rules come out of it. A passing check only proves what it checks: building an image isn't running it. And "
        "for every update, read what changed and ask whether you want it, not only whether it's green.")
    b.H1("5.5 Interview questions")
    b.QA("^5.1.0 vs ~5.1.0?",
         "Caret allows minor and patch updates (5.x); tilde allows patch only (5.1.x). For 0.x versions, the caret "
         "is as strict as the tilde, because below 1.0.0 a minor bump may break.")
    b.QA("Why commit package-lock.json?",
         "So every install, on any machine, gets the same tree. Without it, two builds from the same commit can differ.")
    b.QA("Dependabot offers a major version and CI is green. Merge it?",
         "Not automatically. Green means the checks passed, not that the change is wanted: Node 25 built fine but is "
         "past end of life. Read the release notes, check it fits the support policy (LTS here), and if it's a version "
         "you'll skip, tell Dependabot to ignore it.")
    b.QA("Why test against PostgreSQL in CI if the routes are tested with a fake?",
         "The fake can't check SQL. A typo in a query, a wrong alias or a type mismatch only shows up against the "
         "real database.")


book = Book(ROOT, accent="#1d6f63", highlight="#e8a33d")
book.cover("Task Tracker, Line by Line",
           "React, Node.js and PostgreSQL in Docker and Kubernetes",
           "The node-postgres task tracker explained file by file: the Express API and its storage interface, the "
           "React page, the containers and manifests, the tests, and the CI that runs them on every push.",
           [["0. The big picture", "The pieces, the API, the layout"],
            ["1. The API", "Storage interface, validation, routes, Express, PostgreSQL, shutdown"],
            ["2. The front end", "React, a typed API client, nginx, client tests"],
            ["3. Containers and Kubernetes", "Dockerfiles, Compose, StatefulSet, probes, Secrets"],
            ["4. Tests", "Store contract against memory and PostgreSQL, routes over HTTP"],
            ["5. Keeping it working", "SemVer, lock files, npm ci, CI with a database, Dependabot"]])
ONLY = set(sys.argv[1:])
for i, part in enumerate([part0, part1, lambda bk: frontend.write(bk, 2, "React · Node.js · PostgreSQL", 8080),
                          part3, part4, part5]):
    if not ONLY or str(i) in ONLY:
        part(book)
book.build(os.path.join(HERE, "task-tracker-node-book.pdf"), "Task Tracker, Line by Line — Node.js and PostgreSQL",
           "Task Tracker, Line by Line · Node.js")
