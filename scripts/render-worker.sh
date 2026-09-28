#!/bin/sh
set -eu

node dist/backend/migrate.js
exec node dist/backend/worker.js
