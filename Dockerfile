# One image: the API serves its own API and the built single-page app, so there is one thing to
# deploy, one origin, no CORS and no second bill.

# ---- 1. build the SPA ----
FROM node:22-alpine AS web
WORKDIR /web

# Dependencies are copied on their own so this layer is reused whenever only source changed.
COPY src/web/package.json src/web/package-lock.json ./
RUN npm ci

COPY src/web/ ./
# Overridden here because the local build writes straight into the API project's wwwroot, which
# does not exist as a path in this stage.
RUN npm run build -- --outDir dist --emptyOutDir

# ---- 2. publish the API ----
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api
WORKDIR /src

COPY src/RepTracker.Api/RepTracker.Api.csproj RepTracker.Api/
RUN dotnet restore RepTracker.Api/RepTracker.Api.csproj

COPY src/RepTracker.Api/ RepTracker.Api/
COPY --from=web /web/dist RepTracker.Api/wwwroot

RUN dotnet publish RepTracker.Api/RepTracker.Api.csproj \
    -c Release -o /app --no-restore /p:UseAppHost=false

# ---- 3. runtime ----
FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS runtime
WORKDIR /app

COPY --from=api /app ./

# The .NET images already ship a non-root "app" account; the process runs as that rather than root.
USER $APP_UID

ENV ASPNETCORE_HTTP_PORTS=8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_gcServer=0

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

ENTRYPOINT ["dotnet", "RepTracker.Api.dll"]
