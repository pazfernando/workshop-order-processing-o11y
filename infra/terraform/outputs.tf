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

output "observability_dashboard_name" {
  description = "CloudWatch dashboard name for the workshop."
  value       = try(aws_cloudwatch_dashboard.observability[0].dashboard_name, null)
}

output "observability_alarm_names" {
  description = "CloudWatch alarm names created for operational monitoring."
  value = compact([
    try(aws_cloudwatch_metric_alarm.api_5xx[0].alarm_name, null),
    try(aws_cloudwatch_metric_alarm.order_processor_errors[0].alarm_name, null),
    try(aws_cloudwatch_metric_alarm.payment_latency[0].alarm_name, null)
  ])
}

output "effective_otlp_base_endpoint" {
  description = "Effective OTLP base endpoint configured for the Lambda functions."
  value       = local.effective_otlp_endpoint
}

output "effective_otlp_traces_endpoint" {
  description = "Effective OTLP traces endpoint configured for the Lambda functions."
  value       = local.effective_otlp_traces_endpoint
}

output "effective_otlp_metrics_endpoint" {
  description = "Effective OTLP metrics endpoint configured for the Lambda functions."
  value       = local.effective_otlp_metrics_endpoint
}

output "otlp_export_status" {
  description = "Whether the deployed configuration has OTLP export endpoints effectively enabled."
  value       = local.otlp_export_status
}

output "effective_otlp_authentication_mode" {
  description = "Authentication mode required by the effective OTLP route."
  value       = local.effective_otlp_authentication_mode
}

output "effective_adot_lambda_layer_arn" {
  description = "Effective ADOT Lambda layer ARN configured for the Lambda functions."
  value       = local.effective_adot_lambda_layer_arn
}
