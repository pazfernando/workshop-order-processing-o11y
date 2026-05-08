#!/usr/bin/env bash

set -euo pipefail

API_BASE_URL="${API_BASE_URL:?Set API_BASE_URL to the deployed API base URL}"
COUNT="${1:-10}"

for ((i = 1; i <= COUNT; i++)); do
  amount=$((50 * i))

  curl -sS -X POST "${API_BASE_URL}/orders" \
    -H "content-type: application/json" \
    --data "{
      \"customerId\": \"customer-${i}\",
      \"items\": [
        {
          \"sku\": \"SKU-${i}\",
          \"quantity\": 1,
          \"unitPrice\": ${amount}
        }
      ],
      \"currency\": \"USD\"
    }"

  echo
done

