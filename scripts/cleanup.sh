#!/usr/bin/env bash

set -euo pipefail

STACK_NAME="${STACK_NAME:-observability-business-case}"
AWS_REGION="${AWS_REGION:-us-east-1}"

aws cloudformation delete-stack \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION"

echo "Delete requested for stack ${STACK_NAME}"

