# One image definition for all three Go services; SERVICE picks which command to build.
# Multi-stage: the Go toolchain stays in the build stage, the final image is just the
# static binary on a minimal base (about 15 MB).
FROM golang:1.24-alpine AS build
WORKDIR /src
ENV CGO_ENABLED=0
COPY go.mod go.sum* ./
# go.sum is created on the first build if the repository doesn't have one yet.
RUN go mod download || true
COPY . .
RUN go mod tidy && go test ./...
ARG SERVICE
RUN go build -trimpath -ldflags="-s -w" -o /out/app ./cmd/${SERVICE}

FROM alpine:3.21
# /keys belongs to the app user so auth-service can write the JWT key pair into the
# shared volume (a new named volume copies this directory's ownership).
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 app && mkdir /keys && chown app /keys
COPY --from=build /out/app /usr/local/bin/app
USER app
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/app"]
