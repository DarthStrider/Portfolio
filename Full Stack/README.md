# Full Stack

The first two projects are the same task-tracker app built on two different stacks, each containerized with Docker and deployed
to Kubernetes. Same React frontend, same REST API contract, different backend and database, so the
two are easy to compare side by side.

| Project | Targets | Stack | Local URL |
|---|---|---|---|
| [node-postgres](node-postgres/) | [Vention](../vention/) | React · Node.js + Express + TypeScript · PostgreSQL | http://localhost:8080 |
| [dotnet-sqlserver](dotnet-sqlserver/) | [Genetec](../genetec/) | React · ASP.NET Core + EF Core · SQL Server | http://localhost:8081 |
| [go-php-mongo](go-php-mongo/) | — | React · Go + PHP (Laravel) microservices · MongoDB · RabbitMQ | http://localhost:8090 |

The third project is a different app: a complete online store split into four services (three in
Go, one in PHP) that share nothing but events and a JWT public key. Its folder includes a
line-by-line walkthrough PDF.

All three use different ports, so they can run at the same time. Each folder's README covers
running it with Docker Compose; the two task trackers also cover Docker Desktop's Kubernetes.
