#!/usr/bin/env bash
# sql helper via Management API (never prints secret values)
set -a; . ./.env.local; set +a
curl -s -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "{\"query\":$(python -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1")}"
