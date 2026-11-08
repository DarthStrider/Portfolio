# Full Stack

The same task-tracker app built on two different stacks, each containerized with Docker and deployed
to Kubernetes. Same React frontend, same REST API contract, different backend and database, so the
two are easy to compare side by side.

| Project | Targets | Stack | Local URL |
|---|---|---|---|
| [node-postgres](node-postgres/) | [Vention](../vention/) | React · Node.js + Express + TypeScript · PostgreSQL | http://localhost:8080 |
| [dotnet-sqlserver](dotnet-sqlserver/) | [Genetec](../genetec/) | React · ASP.NET Core + EF Core · SQL Server | http://localhost:8081 |

They use different ports and Kubernetes namespaces, so both can run at the same time.
Each folder's README covers running it with Docker Compose and on Docker Desktop's Kubernetes.
