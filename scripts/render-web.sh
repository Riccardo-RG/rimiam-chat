#!/bin/sh
set -eu

node dist/backend/migrate.js
exec ./node_modules/.bin/next start --hostname 0.0.0.0 --port "${PORT:-10000}"
