#!/usr/bin/env bash

set -euo pipefail

STACK_NAME="${STACK_NAME:-observability-business-case}"
AWS_REGION="${AWS_REGION:-us-east-1}"
PAYMENT_FAILURE_MODE="${PAYMENT_FAILURE_MODE:-none}"
TF_STATE_KEY="${TF_STATE_KEY:-${STACK_NAME}.tfstate}"

if [ ! -d node_modules ]; then
  npm install
fi

bash scripts/prepare-lambda-package.sh

if [ -n "${TF_STATE_BUCKET:-}" ]; then
  terraform -chdir=infra/terraform init -reconfigure \
    -backend-config="bucket=${TF_STATE_BUCKET}" \
    -backend-config="key=${TF_STATE_KEY}" \
    -backend-config="region=${AWS_REGION}"
else
  terraform -chdir=infra/terraform init -backend=false
fi

terraform -chdir=infra/terraform destroy \
  -auto-approve \
  -var="aws_region=${AWS_REGION}" \
  -var="stack_name=${STACK_NAME}" \
  -var="payment_failure_mode=${PAYMENT_FAILURE_MODE}"

echo "Destroy completed for stack ${STACK_NAME}"
