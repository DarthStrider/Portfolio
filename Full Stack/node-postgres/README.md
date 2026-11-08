# Task Tracker: Node.js + PostgreSQL

**Built for: [Vention](../../vention/).** TypeScript end to end (React frontend, Node.js API), matching Vention's TypeScript and React stack.

A small full-stack task tracker packaged with **Docker** and deployed to **Kubernetes**.
It's deliberately simple on the app side so the focus stays on how the pieces are containerized,
wired together, and run in a cluster.

| Layer    | Tech |
|----------|------|
| Frontend | React 19 + TypeScript (Vite), served by nginx |
| API      | Node.js 22 + Express 5 + TypeScript, `pg` driver |
| Database | PostgreSQL 17 |
| Runtime  | Docker Compose (local) and Kubernetes (Docker Desktop) |

## Architecture

```
browser ──► web (nginx) ──/api──► api (2 replicas) ──► postgres
            serves React          Express + TypeScript               StatefulSet + volume
```

nginx serves the built React app and forwards anything under `/api/` to the `api` service, so the
browser only ever talks to one origin (no CORS setup needed). The same `nginx.conf` works in both
Docker Compose and Kubernetes because both resolve the name `api` through their internal DNS.

## Project layout

```
node-postgres/
├── frontend/            React app + nginx.conf + Dockerfile
├── api/                 Express + TypeScript + Dockerfile
├── docker-compose.yml   run everything locally with one command
└── k8s/                 Kubernetes manifests (kustomize)
    ├── namespace.yaml
    ├── db-secret.yaml
    ├── postgres.yaml
    ├── api.yaml
    └── web.yaml
```

## Run with Docker Compose

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```powershell
cd "node-postgres"
docker compose up --build
```

Open **http://localhost:8080**. Stop with `Ctrl+C`; add `docker compose down -v` to
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
cd "node-postgres"
docker build -t tasks-node-api:1.0 ./api
docker build -t tasks-node-web:1.0 ./frontend
```

(`docker compose build` builds the same two images, if you've already run Compose.)

**3. Deploy.**

```powershell
kubectl apply -k k8s
kubectl get pods -n tasks-node -w
```

Wait until every pod shows `1/1 Running` (usually under a minute), then `Ctrl+C` and open
**http://localhost:8080**. If Compose is still running, stop it first: both use port 8080.

**4. Things to try.**

```powershell
# The footer shows which API pod answered. Refresh a few times to see requests spread across replicas.
kubectl scale deployment api -n tasks-node --replicas=4

# Kill an API pod: Kubernetes replaces it, and the app keeps working on the other replica.
kubectl delete pod -n tasks-node -l app=api --wait=false

# Restart the database: your tasks survive because they live on a persistent volume.
kubectl rollout restart statefulset postgres -n tasks-node

# Logs from all API pods
kubectl logs -n tasks-node -l app=api --prefix
```

**5. Clean up.** Deleting the namespace removes everything, including the database volume.

```powershell
kubectl delete namespace tasks-node
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

## Design decisions

- **Multi-stage Dockerfiles.** Build tools (the TypeScript compiler and dev dependencies, `npm` for the frontend) stay in the build
  stage; the final images contain only what runs. The API container runs as a non-root user.
- **Liveness vs. readiness vs. startup probes.** Liveness only checks the process, so a database outage
  doesn't make Kubernetes restart healthy API pods in a loop. Readiness checks the database, so traffic
  only goes to pods that can serve it. A startup probe gives the API time to wait for the database on
  first boot.
- **Database as a StatefulSet.** A stable name (`postgres`) and a persistent volume claim, so data
  survives pod restarts and rescheduling.
- **Config and secrets from the environment.** Credentials live in a Kubernetes Secret and are injected
  as environment variables; the same image runs unchanged in Compose and Kubernetes.
- **Schema on startup.** The API creates the `tasks` table if it doesn't exist, retrying while Postgres boots. Fine for a demo; a real app would use migrations.
- **Resource requests and limits** on every container, so the scheduler can place pods sensibly.

## What I'd add next

- A real migrations tool instead of create-on-startup
- An Ingress controller with a hostname instead of a LoadBalancer port
- HorizontalPodAutoscaler on the API (needs metrics-server)
- GitHub Actions to build and test the images on every push
- Secrets from a secret manager instead of a committed manifest

## Troubleshooting

- **Pods stuck in `ErrImageNeverPull` / `ImagePullBackOff`:** the image wasn't built, the tag doesn't
  match, or the cluster type is *kind* (which doesn't see local images). Rebuild with the exact tags
  above, or switch Docker Desktop's cluster type to kubeadm.
- **API pods restarting:** check `kubectl logs -n tasks-node -l app=api`. Usually the database is still starting.
- **Port 8080 already in use:** stop Compose (`docker compose down`) or whatever else is on that port.
