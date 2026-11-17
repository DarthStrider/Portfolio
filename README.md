# Recipe App

A full-stack recipe manager: save recipes, organize them by cuisine and meal, and turn them into a combined grocery list.

> 🚧 **Status:** in active development. The API and database are working; the React front end is next.

## Features

**Done**
- REST API to create, read, update and delete recipes, with ingredients and numbered steps
- Ingredient names are normalized ("  Flour " → "flour") and shared across recipes
- Request validation with clear `400` error responses
- Sample recipes seeded automatically in development
- Runs fully in Docker with one command

**Planned**
- React front end
- Filter by cuisine, meal type and ingredient
- "What can I make?" – match recipes to the ingredients you have
- Combined grocery list from several recipes
- Import recipes from a website URL or a cookbook photo
- Accounts, friends and recipe sharing

## Tech stack

| Area | Tools |
|---|---|
| API | C#, ASP.NET Core 10 (Web API) |
| Data | PostgreSQL 17, Entity Framework Core 10 |
| Containers | Docker, Docker Compose |
| CI/CD | GitHub Actions, Dependabot |
| API docs | OpenAPI + Scalar |

## Run locally

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
git clone https://github.com/DarthStrider/Portfolio.git
cd Portfolio
cp .env.example .env      # then set your own POSTGRES_PASSWORD
docker compose up --build
```

- **API reference:** http://localhost:8080/scalar
- The database is created, migrated and seeded with sample recipes on first start.

| Command | Purpose |
|---|---|
| `docker compose up -d --build` | Start in the background |
| `docker compose logs -f api` | Follow API logs |
| `docker compose down` | Stop (data is kept) |
| `docker compose down -v` | Stop and delete the database |

## API endpoints

| Method | Route | Description |
|---|---|---|
| GET | `/api/recipes` | List recipe summaries |
| GET | `/api/recipes/{id}` | Get one recipe with ingredients and steps |
| POST | `/api/recipes` | Create a recipe |
| PUT | `/api/recipes/{id}` | Replace a recipe |
| DELETE | `/api/recipes/{id}` | Delete a recipe |

## Project structure

```
api/RecipeApp.Api/
├── Controllers/   HTTP endpoints
├── Services/      Recipe logic (RecipeService, ingredient normalizing)
├── Dtos/          Request and response shapes
├── Models/        EF Core entities
├── Data/          DbContext and seed data
└── Migrations/    Database schema history
web/               React front end (coming soon)
```

## Development workflow

- Work is tracked in [GitHub Issues](https://github.com/DarthStrider/Portfolio/issues), grouped into milestones by phase
- Every change goes through a pull request; `main` is protected and requires the CI build to pass
- Dependabot keeps NuGet packages and GitHub Actions up to date

## License

[MIT](LICENSE)