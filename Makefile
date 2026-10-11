.PHONY: dev build test lint docker migrate generate compatibility

dev:
	pnpm dev

build:
	pnpm build
	go build ./apps/server/cmd/piggybudget

test:
	pnpm test
	go test ./...

lint:
	pnpm lint
	gofmt -d apps/server

generate:
	pnpm generate:api
	pnpm generate:client

docker:
	docker buildx build --load -t piggybudget:dev .

migrate:
	go run ./apps/server/cmd/piggybudget migrate up

compatibility:
	sh scripts/backup-restore-smoke-test.sh
