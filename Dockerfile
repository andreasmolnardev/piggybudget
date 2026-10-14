# Frontend assets are architecture-independent; build them natively so esbuild
# does not need to execute a target-architecture binary through QEMU.
FROM --platform=$BUILDPLATFORM node:22.23.2-alpine3.24 AS web-build
WORKDIR /src
ARG VITE_BUILD_ID
ARG VITE_BUILD_TIMESTAMP
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts && pnpm rebuild esbuild
COPY apps/web apps/web
RUN VITE_BUILD_ID="$VITE_BUILD_ID" VITE_BUILD_TIMESTAMP="$VITE_BUILD_TIMESTAMP" pnpm --filter @piggybudget/web build

FROM --platform=$BUILDPLATFORM golang:1.27.1-alpine3.24 AS server-build
WORKDIR /src
ARG TARGETOS
ARG TARGETARCH
COPY go.mod go.sum ./
RUN go mod download
COPY apps/server apps/server
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -o /piggybudget ./apps/server/cmd/piggybudget

FROM alpine:3.24.2
RUN addgroup -S piggybudget && adduser -S piggybudget -G piggybudget
WORKDIR /app
COPY --from=server-build /piggybudget /app/piggybudget
COPY --from=web-build /src/apps/web/dist /app/public
RUN mkdir -p /app/pb_data && chown -R piggybudget:piggybudget /app
USER piggybudget
VOLUME ["/app/pb_data"]
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 CMD wget -qO- http://127.0.0.1:8090/api/health || exit 1
CMD ["/app/piggybudget", "serve", "--http=0.0.0.0:8090"]
