# Task Tracker: ASP.NET Core + SQL Server

**Built for: [Genetec](../../genetec/).** C# and SQL Server on the backend with a React frontend, matching Genetec's .NET and SQL Server stack.

A small full-stack task tracker packaged with **Docker** and deployed to **Kubernetes**.
It's deliberately simple on the app side so the focus stays on how the pieces are containerized,
wired together, and run in a cluster.

| Layer    | Tech |
|----------|------|
| Frontend | React 19 + TypeScript (Vite), served by nginx |
| API      | ASP.NET Core 10 minimal API + Entity Framework Core |
| Database | SQL Server 2022 (Linux container) |
| Runtime  | Docker Compose (local) and Kubernetes (Docker Desktop) |

## Architecture

```
browser ──► web (nginx) ──/api──► api (2 replicas) ──► sqlserver
            serves React          ASP.NET Core + EF Core               StatefulSet + volume
```

nginx serves the built React app and forwards anything under `/api/` to the `api` service, so the
browser only ever talks to one origin (no CORS setup needed). The same `nginx.conf` works in both
Docker Compose and Kubernetes because both resolve the name `api` through their internal DNS.

## Project layout

```
dotnet-sqlserver/
├── frontend/            React app + nginx.conf + Dockerfile (+ tests/ for the API client)
├── api/                 ASP.NET Core + EF Core + Dockerfile
├── tests/TaskApi.Tests/ xUnit: the title rule, and every endpoint against a real SQL Server
├── TaskApi.slnx         the API and its tests, for dotnet build/test and Visual Studio
├── global.json          pins the .NET SDK (10.0, any feature band) and the test runner
├── docker-compose.yml   run everything locally with one command
└── k8s/                 Kubernetes manifests (kustomize)
    ├── namespace.yaml
    ├── db-secret.yaml
    ├── sqlserver.yaml
    ├── api.yaml
    └── web.yaml
```

## Run with Docker Compose

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```powershell
cd "dotnet-sqlserver"
docker compose up --build
```

Open **http://localhost:8081**. SQL Server takes 20 to 30 seconds to start on the first run, so the API waits for it. Stop with `Ctrl+C`; add `docker compose down -v` to
also delete the database volume.

## Run on Kubernetes (Docker Desktop)

**1. Turn on Kubernetes.** Docker Desktop → Settings → Kubernetes → *Enable Kubernetes* → Apply.
If it asks for a cluster type, pick **kubeadm** (its cluster can use images you build locally,
which these manifests rely on). Then check it's up:

```powershell
kubectl config use-context docker-desktop
kubectl get nodes
```

**2. Build the images.** The cluster uses them straight from Docker's local image store, so there's
no registry or push step:

```powershell
cd "dotnet-sqlserver"
docker build -t tasks-dotnet-api:1.0 ./api
docker build -t tasks-dotnet-web:1.0 ./frontend
```

(`docker compose build` builds the same two images, if you've already run Compose.)

**3. Deploy.**

```powershell
kubectl apply -k k8s
kubectl get pods -n tasks-dotnet -w
```

Wait until every pod shows `1/1 Running` (SQL Server takes a minute or two the first time), then `Ctrl+C` and open
**http://localhost:8081**. If Compose is still running, stop it first: both use port 8081.

**4. Things to try.**

```powershell
# The footer shows which API pod answered. Refresh a few times to see requests spread across replicas.
kubectl scale deployment api -n tasks-dotnet --replicas=4

# Kill an API pod: Kubernetes replaces it, and the app keeps working on the other replica.
kubectl delete pod -n tasks-dotnet -l app=api --wait=false

# Restart the database: your tasks survive because they live on a persistent volume.
kubectl rollout restart statefulset sqlserver -n tasks-dotnet

# Logs from all API pods
kubectl logs -n tasks-dotnet -l app=api --prefix
```

**5. Clean up.** Deleting the namespace removes everything, including the database volume.

```powershell
kubectl delete namespace tasks-dotnet
```

## API

| Method | Path | Body | Result |
|--------|------|------|--------|
| GET    | `/api/tasks` | | All tasks |
| POST   | `/api/tasks` | `{ "title": "..." }` | 201 + created task |
| PATCH  | `/api/tasks/{id}` | `{ "title"?: "...", "done"?: true }` | Updated task |
| DELETE | `/api/tasks/{id}` | | 204 |
| GET    | `/api/health/live` | | Process is up (liveness) |
| GET    | `/api/health/ready` | | Database reachable (readiness) |
| GET    | `/api/info` | | Hostname of the pod that answered |

## Tests

```powershell
cd dotnet-sqlserver
dotnet test --solution TaskApi.slnx
cd frontend; npm ci; npm test
```

| Suite | What it covers |
|---|---|
| `tests/TaskApi.Tests/TaskRulesTests.cs` | the title rule |
| `tests/TaskApi.Tests/TasksApiTests.cs` | every endpoint over HTTP with `WebApplicationFactory<Program>`: the real app, EF Core and a real SQL Server database created for each test and dropped after |
| `frontend/tests/api.test.ts` | the browser's API client against a fake `fetch` |

The HTTP tests need a SQL Server. Without `TEST_SQLSERVER` they're reported as skipped. With the
Compose database running (add `ports: ["1433:1433"]` under `db` to reach it from the host):

```powershell
$env:TEST_SQLSERVER = "Server=localhost,1433;User Id=sa;Password=Tasks-dev-Passw0rd;TrustServerCertificate=True"
dotnet test --solution TaskApi.slnx
```

## Dependencies, versions and CI

- **Locked versions.** `packages.lock.json` (api and tests) and `frontend/package-lock.json` record the exact version of every dependency, direct or
  transitive. The Dockerfiles and CI install with `dotnet restore --locked-mode` and `npm ci`, which fail rather than
  quietly resolve something different. Change dependencies on purpose (`npm install <pkg>`, or edit
  the `.csproj`), then commit the lock file with it.
- **Versioning.** The app follows [Semantic Versioning](https://semver.org/); changes are in
  [CHANGELOG.md](CHANGELOG.md). For a web API, removing or renaming a route or a JSON field is a
  breaking change (a new major version); adding one is a minor one.
- **CI.** `.github/workflows/fullstack-dotnet-sqlserver.yml` runs on every push and pull request: install from
  the lock files, type-check, all the tests (including against a real database), a production build,
  `docker compose build`, and an audit that fails on high or critical vulnerabilities.
- **Updates.** Dependabot (`.github/dependabot.yml`) opens weekly pull requests for npm and NuGet
  packages and monthly ones for the Docker base images; CI tests each before you merge.
- **Walkthrough.** [walkthrough/](walkthrough/) explains every file, line by line.

## Design decisions

- **Multi-stage Dockerfiles.** Build tools (the .NET SDK, `npm` for the frontend) stay in the build
  stage; the final images contain only what runs. The API container runs as a non-root user.
- **Liveness vs. readiness vs. startup probes.** Liveness only checks the process, so a database outage
  doesn't make Kubernetes restart healthy API pods in a loop. Readiness checks the database, so traffic
  only goes to pods that can serve it. A startup probe gives the API time to wait for the database on
  first boot.
- **Database as a StatefulSet.** A stable name (`sqlserver`) and a persistent volume claim, so data
  survives pod restarts and rescheduling.
- **Config and secrets from the environment.** Credentials live in a Kubernetes Secret and are injected
  as environment variables; the same image runs unchanged in Compose and Kubernetes.
- **Schema on startup.** The API calls EF Core's `EnsureCreated()` on startup, retrying while SQL Server boots. Fine for a demo; a real app would use EF Core migrations.
- **Resource requests and limits** on every container, so the scheduler can place pods sensibly.

## What I'd add next

- A real migrations tool instead of create-on-startup
- An Ingress controller with a hostname instead of a LoadBalancer port
- HorizontalPodAutoscaler on the API (needs metrics-server)
- Secrets from a secret manager instead of a committed manifest

## Troubleshooting

- **Pods stuck in `ErrImageNeverPull` / `ImagePullBackOff`:** the image wasn't built, the tag doesn't
  match, or the cluster type is *kind* (which doesn't see local images). Rebuild with the exact tags
  above, or switch Docker Desktop's cluster type to kubeadm.
- **API pods restarting:** check `kubectl logs -n tasks-dotnet -l app=api`. Usually the database is still starting.
- **Port 8081 already in use:** stop Compose (`docker compose down`) or whatever else is on that port.
- **SQL Server pod stuck `Pending` or `OOMKilled`:** it needs at least 2 GB of memory. Give Docker Desktop more
  memory (Settings → Resources, or `.wslconfig` on the WSL 2 backend).
