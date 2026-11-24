# ---------- Stage 1: build ----------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Restore first so this layer is cached until the .csproj changes
COPY RecipeApp.Api.csproj ./
RUN dotnet restore

# Copy the rest of the source and publish a Release build
COPY . .
RUN dotnet publish -c Release -o /app/publish --no-restore

# ---------- Stage 2: run ----------
FROM mcr.microsoft.com/dotnet/aspnet:11.0 AS runtime
WORKDIR /app

# Kerberos library that Npgsql probes for (silences a startup warning)
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgssapi-krb5-2 \
    && rm -rf /var/lib/apt/lists/*

# Copy only the published app from stage 1
COPY --from=build /app/publish .

EXPOSE 8080

# Run as the built-in non-root user
USER $APP_UID

ENTRYPOINT ["dotnet", "RecipeApp.Api.dll"]