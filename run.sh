#!/usr/bin/env bash
# Usage: ./run.sh <service> <command...>
# Loads Railway vars for <service>, then overrides with .env
# Example: ./run.sh api cargo run --release --package tileforge-api

set -euo pipefail

SERVICE="${1:?Usage: ./run.sh <service> <command...>}"
shift

# Load Railway vars as baseline
eval "$(railway variables -s "$SERVICE" --json 2>/dev/null | jq -r 'to_entries[] | "export \(.key)=\(.value | @sh)"')"

# Override with local .env (public URLs, etc.)
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

exec "$@"
