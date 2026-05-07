#!/usr/bin/env bash

set -euo pipefail

STACK_NAME="${STACK_NAME:-observability-business-case}"
AWS_REGION="${AWS_REGION:-us-east-1}"
PAYMENT_FAILURE_MODE="${PAYMENT_FAILURE_MODE:-none}"

if [ ! -d node_modules ]; then
  npm install
fi

sam build
sam deploy \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --capabilities CAPABILITY_IAM \
  --resolve-s3 \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset \
  --parameter-overrides "PaymentFailureMode=${PAYMENT_FAILURE_MODE}"
