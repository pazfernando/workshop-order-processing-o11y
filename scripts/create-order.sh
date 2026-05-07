#!/usr/bin/env bash

set -euo pipefail

API_BASE_URL="${API_BASE_URL:?Set API_BASE_URL to the deployed API base URL}"
PAYLOAD_FILE="${1:-}"

if [[ -n "$PAYLOAD_FILE" ]]; then
  curl -sS -X POST "${API_BASE_URL}/orders" \
    -H "content-type: application/json" \
    --data @"$PAYLOAD_FILE"
  echo
  exit 0
fi

curl -sS -X POST "${API_BASE_URL}/orders" \
  -H "content-type: application/json" \
  --data '{
    "customerId": "customer-001",
    "items": [
      {
        "sku": "SKU-001",
        "quantity": 2,
        "unitPrice": 25.5
      }
    ],
    "currency": "USD"
  }'
echo

