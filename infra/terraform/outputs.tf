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
