#!/bin/sh
set -e
npm run db:migrate
exec npx tsx src/index.ts