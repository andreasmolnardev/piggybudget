#!/bin/sh
set -e

docker compose -f docker-compose.dev.yaml up -d --wait
open http://localhost:5174/auth/login
docker compose -f docker-compose.dev.yaml logs -f
