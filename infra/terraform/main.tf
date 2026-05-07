terraform {
  required_version = ">= 1.6.0"

  backend "s3" {}

  required_providers {
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "archive_file" "lambda_bundle" {
  type             = "zip"
  source_dir       = "${path.module}/../../build/lambda"
  output_path      = "${path.module}/../../build/order-processing-lambda.zip"
  output_file_mode = "0666"
}

locals {
  normalized_resource_prefix      = trim(var.resource_prefix, "- ")
  name_prefix                     = local.normalized_resource_prefix != "" ? "${local.normalized_resource_prefix}-${var.stack_name}" : var.stack_name
  orders_table_name               = "${local.name_prefix}-orders"
  create_order_function_name      = "${local.name_prefix}-create-order"
  get_order_function_name         = "${local.name_prefix}-get-order"
  payment_simulator_function_name = "${local.name_prefix}-payment-simulator"
  order_processor_function_name   = "${local.name_prefix}-order-processor"
  api_access_log_group_name       = "/aws/apigateway/${local.name_prefix}-http-api-access"
  observability_dashboard_name    = "${local.name_prefix}-observability"
  lambda_log_group_names = {
    create_order      = "/aws/lambda/${local.create_order_function_name}"
    get_order         = "/aws/lambda/${local.get_order_function_name}"
    payment_simulator = "/aws/lambda/${local.payment_simulator_function_name}"
    order_processor   = "/aws/lambda/${local.order_processor_function_name}"
  }
  event_bus_arn          = "arn:${data.aws_partition.current.partition}:events:${var.aws_region}:${data.aws_caller_identity.current.account_id}:event-bus/default"
  deployment_environment = local.normalized_resource_prefix != "" ? local.normalized_resource_prefix : "local"
  otel_common_env = {
    OBSERVABILITY_OTEL_ENABLED           = var.otel_mode == "code" ? "true" : "false"
    OBSERVABILITY_EMF_COMPATIBILITY_MODE = var.observability_emf_compatibility_mode ? "true" : "false"
    OTEL_EXPORTER_OTLP_ENDPOINT          = var.otel_exporter_otlp_endpoint
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT   = var.otel_exporter_otlp_traces_endpoint
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT  = var.otel_exporter_otlp_metrics_endpoint
    OTEL_METRIC_EXPORT_INTERVAL_MS       = tostring(var.otel_metric_export_interval_ms)
    OTEL_TRACES_EXPORTER                 = "otlp"
    OTEL_METRICS_EXPORTER                = "otlp"
    OTEL_EXPORTER_OTLP_PROTOCOL          = "http/protobuf"
    OTEL_PROPAGATORS                     = "tracecontext,baggage,xray"
    OTEL_RESOURCE_ATTRIBUTES             = "deployment.environment=${local.deployment_environment}"
  }
  lambda_wrapper_env = var.otel_mode == "adot_layer" ? {
    AWS_LAMBDA_EXEC_WRAPPER = "/opt/otel-handler"
  } : {}
  adot_layer_arns = var.otel_mode == "adot_layer" ? [var.adot_lambda_layer_arn] : []
}

resource "aws_dynamodb_table" "orders" {
  name         = local.orders_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "orderId"

  attribute {
    name = "orderId"
    type = "S"
  }
}

resource "aws_apigatewayv2_api" "orders" {
  name          = "${local.name_prefix}-http-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.orders.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access.arn
    format = jsonencode({
      requestId         = "$context.requestId"
      apiId             = "$context.apiId"
      routeKey          = "$context.routeKey"
      status            = "$context.status"
      protocol          = "$context.protocol"
      responseLength    = "$context.responseLength"
      integrationError  = "$context.integrationErrorMessage"
      integrationStatus = "$context.integrationStatus"
      sourceIp          = "$context.identity.sourceIp"
      userAgent         = "$context.identity.userAgent"
      requestTime       = "$context.requestTime"
    })
  }
}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "create_order" {
  name               = "${local.name_prefix}-create-order-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role" "get_order" {
  name               = "${local.name_prefix}-get-order-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role" "payment_simulator" {
  name               = "${local.name_prefix}-payment-simulator-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role" "order_processor" {
  name               = "${local.name_prefix}-order-processor-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role_policy_attachment" "create_order_logs" {
  role       = aws_iam_role.create_order.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "create_order_xray" {
  role       = aws_iam_role.create_order.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy_attachment" "get_order_logs" {
  role       = aws_iam_role.get_order.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "get_order_xray" {
  role       = aws_iam_role.get_order.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy_attachment" "payment_simulator_logs" {
  role       = aws_iam_role.payment_simulator.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "payment_simulator_xray" {
  role       = aws_iam_role.payment_simulator.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy_attachment" "order_processor_logs" {
  role       = aws_iam_role.order_processor.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "order_processor_xray" {
  role       = aws_iam_role.order_processor.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_cloudwatch_log_group" "api_access" {
  name              = local.api_access_log_group_name
  retention_in_days = var.log_retention_in_days
}

resource "aws_cloudwatch_log_group" "create_order" {
  name              = local.lambda_log_group_names.create_order
  retention_in_days = var.log_retention_in_days
}

resource "aws_cloudwatch_log_group" "get_order" {
  name              = local.lambda_log_group_names.get_order
  retention_in_days = var.log_retention_in_days
}

resource "aws_cloudwatch_log_group" "payment_simulator" {
  name              = local.lambda_log_group_names.payment_simulator
  retention_in_days = var.log_retention_in_days
}

resource "aws_cloudwatch_log_group" "order_processor" {
  name              = local.lambda_log_group_names.order_processor
  retention_in_days = var.log_retention_in_days
}

data "aws_iam_policy_document" "create_order" {
  statement {
    actions = [
      "dynamodb:PutItem",
      "dynamodb:UpdateItem"
    ]
    resources = [aws_dynamodb_table.orders.arn]
  }

  statement {
    actions   = ["events:PutEvents"]
    resources = [local.event_bus_arn]
  }
}

resource "aws_iam_role_policy" "create_order" {
  name   = "${local.name_prefix}-create-order-policy"
  role   = aws_iam_role.create_order.id
  policy = data.aws_iam_policy_document.create_order.json
}

data "aws_iam_policy_document" "get_order" {
  statement {
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.orders.arn]
  }
}

resource "aws_iam_role_policy" "get_order" {
  name   = "${local.name_prefix}-get-order-policy"
  role   = aws_iam_role.get_order.id
  policy = data.aws_iam_policy_document.get_order.json
}

data "aws_iam_policy_document" "order_processor" {
  statement {
    actions = [
      "dynamodb:GetItem",
      "dynamodb:UpdateItem"
    ]
    resources = [aws_dynamodb_table.orders.arn]
  }

  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.payment_simulator.arn]
  }
}

resource "aws_iam_role_policy" "order_processor" {
  name   = "${local.name_prefix}-order-processor-policy"
  role   = aws_iam_role.order_processor.id
  policy = data.aws_iam_policy_document.order_processor.json
}

resource "aws_lambda_function" "create_order" {
  function_name    = local.create_order_function_name
  role             = aws_iam_role.create_order.arn
  runtime          = "nodejs20.x"
  handler          = "src/order-api/create-order.handler"
  filename         = data.archive_file.lambda_bundle.output_path
  source_code_hash = data.archive_file.lambda_bundle.output_base64sha256
  timeout          = 10
  memory_size      = 256

  tracing_config {
    mode = "Active"
  }

  layers = local.adot_layer_arns

  environment {
    variables = merge(
      {
        ORDERS_TABLE_NAME = aws_dynamodb_table.orders.name
        EVENT_BUS_NAME    = "default"
        LOG_LEVEL         = "INFO"
        METRICS_NAMESPACE = var.metrics_namespace
        SERVICE_NAME      = "order-api"
        OTEL_SERVICE_NAME = "order-api"
      },
      local.otel_common_env,
      local.lambda_wrapper_env
    )
  }

  depends_on = [
    aws_cloudwatch_log_group.create_order,
    aws_iam_role_policy_attachment.create_order_logs,
    aws_iam_role_policy_attachment.create_order_xray
  ]
}

resource "aws_lambda_function" "get_order" {
  function_name    = local.get_order_function_name
  role             = aws_iam_role.get_order.arn
  runtime          = "nodejs20.x"
  handler          = "src/order-api/get-order.handler"
  filename         = data.archive_file.lambda_bundle.output_path
  source_code_hash = data.archive_file.lambda_bundle.output_base64sha256
  timeout          = 10
  memory_size      = 256

  tracing_config {
    mode = "Active"
  }

  layers = local.adot_layer_arns

  environment {
    variables = merge(
      {
        ORDERS_TABLE_NAME = aws_dynamodb_table.orders.name
        EVENT_BUS_NAME    = "default"
        LOG_LEVEL         = "INFO"
        METRICS_NAMESPACE = var.metrics_namespace
        SERVICE_NAME      = "order-api"
        OTEL_SERVICE_NAME = "order-api"
      },
      local.otel_common_env,
      local.lambda_wrapper_env
    )
  }

  depends_on = [
    aws_cloudwatch_log_group.get_order,
    aws_iam_role_policy_attachment.get_order_logs,
    aws_iam_role_policy_attachment.get_order_xray
  ]
}

resource "aws_lambda_function" "payment_simulator" {
  function_name    = local.payment_simulator_function_name
  role             = aws_iam_role.payment_simulator.arn
  runtime          = "nodejs20.x"
  handler          = "src/payment-simulator/process-payment.handler"
  filename         = data.archive_file.lambda_bundle.output_path
  source_code_hash = data.archive_file.lambda_bundle.output_base64sha256
  timeout          = 15
  memory_size      = 256

  tracing_config {
    mode = "Active"
  }

  layers = local.adot_layer_arns

  environment {
    variables = merge(
      {
        ORDERS_TABLE_NAME    = aws_dynamodb_table.orders.name
        EVENT_BUS_NAME       = "default"
        LOG_LEVEL            = "INFO"
        METRICS_NAMESPACE    = var.metrics_namespace
        PAYMENT_FAILURE_MODE = var.payment_failure_mode
        SERVICE_NAME         = "payment-simulator"
        OTEL_SERVICE_NAME    = "payment-simulator"
      },
      local.otel_common_env,
      local.lambda_wrapper_env
    )
  }

  depends_on = [
    aws_cloudwatch_log_group.payment_simulator,
    aws_iam_role_policy_attachment.payment_simulator_logs,
    aws_iam_role_policy_attachment.payment_simulator_xray
  ]
}

resource "aws_lambda_function" "order_processor" {
  function_name    = local.order_processor_function_name
  role             = aws_iam_role.order_processor.arn
  runtime          = "nodejs20.x"
  handler          = "src/order-processor/process-order-created.handler"
  filename         = data.archive_file.lambda_bundle.output_path
  source_code_hash = data.archive_file.lambda_bundle.output_base64sha256
  timeout          = 10
  memory_size      = 256

  tracing_config {
    mode = "Active"
  }

  layers = local.adot_layer_arns

  environment {
    variables = merge(
      {
        ORDERS_TABLE_NAME               = aws_dynamodb_table.orders.name
        EVENT_BUS_NAME                  = "default"
        LOG_LEVEL                       = "INFO"
        METRICS_NAMESPACE               = var.metrics_namespace
        PAYMENT_SIMULATOR_FUNCTION_NAME = aws_lambda_function.payment_simulator.function_name
        SERVICE_NAME                    = "order-processor"
        OTEL_SERVICE_NAME               = "order-processor"
      },
      local.otel_common_env,
      local.lambda_wrapper_env
    )
  }

  depends_on = [
    aws_cloudwatch_log_group.order_processor,
    aws_iam_role_policy.order_processor,
    aws_iam_role_policy_attachment.order_processor_logs,
    aws_iam_role_policy_attachment.order_processor_xray
  ]
}

resource "aws_apigatewayv2_integration" "create_order" {
  api_id                 = aws_apigatewayv2_api.orders.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.create_order.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "get_order" {
  api_id                 = aws_apigatewayv2_api.orders.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_order.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "create_order" {
  api_id    = aws_apigatewayv2_api.orders.id
  route_key = "POST /orders"
  target    = "integrations/${aws_apigatewayv2_integration.create_order.id}"
}

resource "aws_apigatewayv2_route" "get_order" {
  api_id    = aws_apigatewayv2_api.orders.id
  route_key = "GET /orders/{orderId}"
  target    = "integrations/${aws_apigatewayv2_integration.get_order.id}"
}

resource "aws_lambda_permission" "allow_api_gateway_create_order" {
  statement_id  = "AllowHttpApiInvokeCreateOrder"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.create_order.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.orders.execution_arn}/*/*"
}

resource "aws_lambda_permission" "allow_api_gateway_get_order" {
  statement_id  = "AllowHttpApiInvokeGetOrder"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_order.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.orders.execution_arn}/*/*"
}

resource "aws_cloudwatch_event_rule" "order_created" {
  name = "${local.name_prefix}-order-created"

  event_pattern = jsonencode({
    source        = ["workshop.orders"]
    "detail-type" = ["OrderCreated"]
  })
}

resource "aws_cloudwatch_event_target" "order_processor" {
  rule      = aws_cloudwatch_event_rule.order_created.name
  target_id = "OrderProcessorFunction"
  arn       = aws_lambda_function.order_processor.arn
}

resource "aws_lambda_permission" "allow_eventbridge_order_processor" {
  statement_id  = "AllowEventBridgeInvokeOrderProcessor"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.order_processor.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.order_created.arn
}

resource "aws_cloudwatch_dashboard" "observability" {
  count          = var.create_observability_dashboard ? 1 : 0
  dashboard_name = local.observability_dashboard_name
  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "API Traffic And Errors"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          metrics = [
            ["AWS/ApiGateway", "Count", "ApiId", aws_apigatewayv2_api.orders.id, "Stage", aws_apigatewayv2_stage.default.name, { stat = "Sum", label = "RequestCount" }],
            [".", "4xx", ".", ".", ".", ".", { stat = "Sum", label = "4xx" }],
            [".", "5xx", ".", ".", ".", ".", { stat = "Sum", label = "5xx" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "API Latency"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          metrics = [
            ["AWS/ApiGateway", "Latency", "ApiId", aws_apigatewayv2_api.orders.id, "Stage", aws_apigatewayv2_stage.default.name, { stat = "Average", label = "LatencyMs" }],
            [".", "IntegrationLatency", ".", ".", ".", ".", { stat = "Average", label = "IntegrationLatencyMs" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title   = "Lambda Errors"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          metrics = [
            ["AWS/Lambda", "Errors", "FunctionName", aws_lambda_function.create_order.function_name, { stat = "Sum", label = "create-order" }],
            [".", ".", "FunctionName", aws_lambda_function.get_order.function_name, { stat = "Sum", label = "get-order" }],
            [".", ".", "FunctionName", aws_lambda_function.order_processor.function_name, { stat = "Sum", label = "order-processor" }],
            [".", ".", "FunctionName", aws_lambda_function.payment_simulator.function_name, { stat = "Sum", label = "payment-simulator" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title   = "Lambda Duration"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          metrics = [
            ["AWS/Lambda", "Duration", "FunctionName", aws_lambda_function.create_order.function_name, { stat = "Average", label = "create-order" }],
            [".", ".", "FunctionName", aws_lambda_function.get_order.function_name, { stat = "Average", label = "get-order" }],
            [".", ".", "FunctionName", aws_lambda_function.order_processor.function_name, { stat = "Average", label = "order-processor" }],
            [".", ".", "FunctionName", aws_lambda_function.payment_simulator.function_name, { stat = "Average", label = "payment-simulator" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 12
        height = 6
        properties = {
          title   = "Business Flow Metrics"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          metrics = [
            [var.metrics_namespace, "OrdersCreated", "service", "order-api", "operation", "create-order", { stat = "Sum" }],
            [var.metrics_namespace, "OrdersProcessed", "service", "order-processor", "operation", "process-order-created", { stat = "Sum" }],
            [var.metrics_namespace, "OrdersRead", "service", "order-api", "operation", "get-order", { stat = "Sum" }],
            [var.metrics_namespace, "OrderProcessorErrors", "service", "order-processor", "operation", "process-order-created", { stat = "Sum" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 12
        width  = 12
        height = 6
        properties = {
          title   = "Payment Metrics"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          metrics = [
            [var.metrics_namespace, "PaymentSimulationLatencyMs", "service", "payment-simulator", "operation", "process-payment", { stat = "Average", label = "SimulatorLatencyMs" }],
            [var.metrics_namespace, "PaymentInvocationLatencyMs", "service", "order-processor", "operation", "process-order-created", { stat = "Average", label = "InvocationLatencyMs" }],
            [var.metrics_namespace, "PaymentSimulationErrors", "service", "payment-simulator", "operation", "process-payment", { stat = "Sum", label = "SimulationErrors" }]
          ]
        }
      }
    ]
  })
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  count               = var.create_observability_alarms ? 1 : 0
  alarm_name          = "${local.name_prefix}-api-5xx"
  alarm_description   = "HTTP API is returning 5xx responses."
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = var.api_5xx_alarm_threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ApiId = aws_apigatewayv2_api.orders.id
    Stage = aws_apigatewayv2_stage.default.name
  }
}

resource "aws_cloudwatch_metric_alarm" "order_processor_errors" {
  count               = var.create_observability_alarms ? 1 : 0
  alarm_name          = "${local.name_prefix}-order-processor-errors"
  alarm_description   = "Order processor is emitting custom error metrics."
  namespace           = var.metrics_namespace
  metric_name         = "OrderProcessorErrors"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = var.order_processor_error_alarm_threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    service   = "order-processor"
    operation = "process-order-created"
  }
}

resource "aws_cloudwatch_metric_alarm" "payment_latency" {
  count               = var.create_observability_alarms ? 1 : 0
  alarm_name          = "${local.name_prefix}-payment-latency"
  alarm_description   = "Payment simulator average latency is above the configured threshold."
  namespace           = var.metrics_namespace
  metric_name         = "PaymentSimulationLatencyMs"
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 1
  threshold           = var.payment_latency_alarm_threshold_ms
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    service   = "payment-simulator"
    operation = "process-payment"
  }
}
