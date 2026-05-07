#!/usr/bin/env bash

set -euo pipefail

API_BASE_URL="${API_BASE_URL:?Set API_BASE_URL to the deployed API base URL}"
ORDER_ID="${1:?Provide the orderId as the first argument}"

curl -sS "${API_BASE_URL}/orders/${ORDER_ID}"
echo

