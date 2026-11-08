# ---- build stage: restore and publish with the .NET SDK ----
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY TaskApi.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app --no-restore

# ---- runtime stage: ASP.NET runtime only (no SDK) ----
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
# The official image listens on 8080 and provides a non-root user.
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "TaskApi.dll"]
