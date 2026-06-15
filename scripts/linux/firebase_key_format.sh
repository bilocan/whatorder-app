#!/usr/bin/env bash
# Extracts the Firebase private key from a service account JSON and formats it
# for use as a Vercel environment variable (real newlines → literal \n).
#
# Usage:
#   ./firebase_key_format.sh path/to/service-account.json
#
# Paste the output into Vercel → Settings → Environment Variables → FIREBASE_PRIVATE_KEY

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 path/to/service-account.json" >&2
  exit 1
fi

formatted=$(jq -r '.private_key' "$1" | tr '\n' '\\' | sed 's/\\/\\n/g')

echo ""
echo "FIREBASE_PRIVATE_KEY value (copy everything between the lines):"
echo "----------------------------------------------------------------"
echo "$formatted"
echo "----------------------------------------------------------------"
