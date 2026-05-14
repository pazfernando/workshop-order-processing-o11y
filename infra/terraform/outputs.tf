output "api_base_url" {
  description = "Base URL for the HTTP API."
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "orders_table_name" {
  description = "DynamoDB table name."
  value       = aws_dynamodb_table.orders.name
}

output "payment_simulator_name" {
  description = "Payment simulator Lambda function name."
  value       = aws_lambda_function.payment_simulator.function_name
}

output "api_access_log_group_name" {
  description = "CloudWatch log group for API Gateway access logs."
  value       = aws_cloudwatch_log_group.api_access.name
}

output "workload_service_instance_id" {
  description = "Stable service.instance.id injected into OTEL resource attributes for this deployment."
  value       = local.name_prefix
}

output "observability_instrumentation_mode" {
  description = "Instrumentation mode resolved from the observability bindings payload."
  value       = try(local.otel_instrumentation.mode, "")
}

output "effective_otlp_base_endpoint" {
  description = "Effective OTLP base endpoint configured through bindings."
  value       = try(local.otel_outputs.otlpBaseEndpoint, "")
}

output "effective_otlp_traces_endpoint" {
  description = "Effective OTLP traces endpoint configured through bindings."
  value       = try(local.otel_outputs.otlpTracesEndpoint, "")
}

output "effective_otlp_metrics_endpoint" {
  description = "Effective OTLP metrics endpoint configured through bindings."
  value       = try(local.otel_outputs.otlpMetricsEndpoint, "")
}

output "effective_otlp_authentication_mode" {
  description = "Authentication mode required by the effective OTLP route."
  value       = try(local.otel_instrumentation.otlpAuthenticationMode, "")
}

output "effective_lambda_exec_wrapper" {
  description = "AWS Lambda exec wrapper configured through bindings."
  value       = try(local.otel_outputs.lambdaExecWrapper, "")
}

output "effective_adot_lambda_layer_arn" {
  description = "ADOT Lambda layer ARN configured through bindings."
  value       = try(local.otel_outputs.adotLambdaLayerArn, "")
}

output "otlp_export_status" {
  description = "Whether the deployed configuration has OTLP export endpoints effectively enabled."
  value = (
    try(local.otel_outputs.otlpBaseEndpoint, "") != "" ||
    try(local.otel_outputs.otlpTracesEndpoint, "") != "" ||
    try(local.otel_outputs.otlpMetricsEndpoint, "") != ""
  ) ? "active" : "inactive"
}

output "application_signals_execution_role_policy_enabled" {
  description = "Whether the bindings requested the Application Signals execution role managed policy."
  value       = contains(local.otel_managed_policies, "arn:aws:iam::aws:policy/CloudWatchLambdaApplicationSignalsExecutionRolePolicy")
}
