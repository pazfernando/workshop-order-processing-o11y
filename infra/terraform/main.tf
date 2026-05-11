terraform {
  required_version = ">= 1.6.0"

  backend "s3" {}

  required_providers {
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
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

data "aws_subnets" "public" {
  count = var.otel_export_strategy == "collector" ? 1 : 0

  filter {
    name   = "map-public-ip-on-launch"
    values = ["true"]
  }
}

data "aws_subnets" "all" {
  count = var.otel_export_strategy == "collector" ? 1 : 0
}

data "aws_subnet" "observability_suite" {
  count = var.otel_export_strategy == "collector" ? 1 : 0
  id    = local.observability_suite_subnet_id
}

data "aws_ami" "amazon_linux_2023" {
  count       = var.otel_export_strategy == "collector" ? 1 : 0
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }

  filter {
    name   = "state"
    values = ["available"]
  }
}

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
  event_bus_arn                       = "arn:${data.aws_partition.current.partition}:events:${var.aws_region}:${data.aws_caller_identity.current.account_id}:event-bus/default"
  deployment_environment              = local.normalized_resource_prefix != "" ? local.normalized_resource_prefix : "local"
  observability_suite_name            = "${local.name_prefix}-observability-suite"
  observability_suite_dashboard_uid   = "workshop-order-processing"
  observability_suite_dashboard_title = "Workshop Order Processing"
  observability_suite_enabled         = var.otel_export_strategy == "collector"
  configured_grafana_admin_password   = trim(var.observability_suite_grafana_admin_password, " ")
  observability_suite_subnet_id = local.observability_suite_enabled ? (
    length(data.aws_subnets.public[0].ids) > 0 ? sort(data.aws_subnets.public[0].ids)[0] : (
      length(data.aws_subnets.all[0].ids) > 0 ? sort(data.aws_subnets.all[0].ids)[0] : ""
    )
  ) : ""
  observability_suite_vpc_id = local.observability_suite_enabled ? data.aws_subnet.observability_suite[0].vpc_id : ""
  effective_grafana_admin_password = local.observability_suite_enabled ? (
    local.configured_grafana_admin_password != "" ? local.configured_grafana_admin_password : random_password.grafana_admin_password[0].result
  ) : ""
  adot_supported_regions = toset([
    "ap-northeast-1",
    "ap-northeast-2",
    "ap-south-1",
    "ap-southeast-1",
    "ap-southeast-2",
    "ca-central-1",
    "eu-central-1",
    "eu-north-1",
    "eu-west-1",
    "eu-west-2",
    "eu-west-3",
    "sa-east-1",
    "us-east-1",
    "us-east-2",
    "us-west-1",
    "us-west-2"
  ])
  adot_layer_architecture                   = "amd64"
  inferred_adot_lambda_layer_arn            = contains(local.adot_supported_regions, var.aws_region) ? "arn:aws:lambda:${var.aws_region}:901920570463:layer:aws-otel-nodejs-${local.adot_layer_architecture}-ver-1-30-2:1" : ""
  effective_adot_lambda_layer_arn           = trim(var.adot_lambda_layer_arn, " ") != "" ? trim(var.adot_lambda_layer_arn, " ") : local.inferred_adot_lambda_layer_arn
  direct_otlp_base_endpoint                 = trim(var.otel_exporter_otlp_endpoint, " ")
  direct_otlp_traces_endpoint               = trim(var.otel_exporter_otlp_traces_endpoint, " ")
  direct_otlp_metrics_endpoint              = trim(var.otel_exporter_otlp_metrics_endpoint, " ")
  collector_otlp_base_endpoint              = trim(var.otel_collector_endpoint, " ")
  collector_otlp_traces_endpoint            = trim(var.otel_collector_traces_endpoint, " ")
  collector_otlp_metrics_endpoint           = trim(var.otel_collector_metrics_endpoint, " ")
  inferred_cloudwatch_traces_otlp_endpoint  = "https://xray.${var.aws_region}.amazonaws.com/v1/traces"
  inferred_cloudwatch_metrics_otlp_endpoint = "https://monitoring.${var.aws_region}.amazonaws.com/v1/metrics"
  observability_suite_otlp_http_endpoint    = local.observability_suite_enabled ? "http://${aws_eip.observability_suite[0].public_ip}:4318" : ""
  observability_suite_otlp_grpc_endpoint    = local.observability_suite_enabled ? "${aws_eip.observability_suite[0].public_ip}:4317" : ""
  infer_cloudwatch_direct_endpoints = (
    var.otel_mode == "adot_layer" &&
    var.otel_export_strategy == "direct" &&
    local.direct_otlp_base_endpoint == "" &&
    local.direct_otlp_traces_endpoint == "" &&
    local.direct_otlp_metrics_endpoint == ""
  )
  direct_targets_cloudwatch = (
    length(regexall("^https://(monitoring|xray)\\.[^.]+\\.amazonaws\\.com/v1/(metrics|traces)$", local.direct_otlp_base_endpoint)) > 0 ||
    length(regexall("^https://xray\\.[^.]+\\.amazonaws\\.com/v1/traces$", local.direct_otlp_traces_endpoint)) > 0 ||
    length(regexall("^https://monitoring\\.[^.]+\\.amazonaws\\.com/v1/metrics$", local.direct_otlp_metrics_endpoint)) > 0 ||
    local.infer_cloudwatch_direct_endpoints
  )
  effective_otlp_endpoint = var.otel_export_strategy == "collector" ? (
    local.collector_otlp_base_endpoint != "" ? local.collector_otlp_base_endpoint : (
      local.observability_suite_enabled ? local.observability_suite_otlp_http_endpoint : ""
    )
    ) : (
    local.direct_otlp_base_endpoint != "" ? local.direct_otlp_base_endpoint : (
      local.infer_cloudwatch_direct_endpoints ? "cloudwatch-managed-per-signal" : ""
    )
  )
  effective_otlp_traces_endpoint = var.otel_export_strategy == "collector" ? (
    local.collector_otlp_traces_endpoint != "" ? local.collector_otlp_traces_endpoint : ""
    ) : (
    local.direct_otlp_traces_endpoint != "" ? local.direct_otlp_traces_endpoint : (
      local.direct_otlp_base_endpoint != "" ? "" : (
        local.infer_cloudwatch_direct_endpoints ? local.inferred_cloudwatch_traces_otlp_endpoint : ""
      )
    )
  )
  effective_otlp_metrics_endpoint = var.otel_export_strategy == "collector" ? (
    local.collector_otlp_metrics_endpoint != "" ? local.collector_otlp_metrics_endpoint : ""
    ) : (
    local.direct_otlp_metrics_endpoint != "" ? local.direct_otlp_metrics_endpoint : (
      local.direct_otlp_base_endpoint != "" ? "" : (
        local.infer_cloudwatch_direct_endpoints ? local.inferred_cloudwatch_metrics_otlp_endpoint : ""
      )
    )
  )
  otlp_export_status = local.effective_otlp_endpoint != "" || local.effective_otlp_traces_endpoint != "" || local.effective_otlp_metrics_endpoint != "" ? "active" : "inactive"
  effective_otlp_authentication_mode = var.otel_export_strategy == "collector" ? "collector-managed" : (
    local.direct_targets_cloudwatch ? "sigv4" : (
      local.otlp_export_status == "active" ? "backend-defined" : "inactive"
    )
  )
  effective_lambda_exec_wrapper           = var.otel_mode == "adot_layer" ? "/opt/otel-handler" : ""
  application_signals_role_policy_enabled = var.otel_mode == "adot_layer"
  grafana_dashboard_json = local.observability_suite_enabled ? templatefile("${path.module}/../observability-suite/grafana-dashboard.json.tftpl", {
    dashboard_title = local.observability_suite_dashboard_title
  }) : ""
  grafana_datasources_yaml        = local.observability_suite_enabled ? templatefile("${path.module}/../observability-suite/grafana-datasources.yml.tftpl", {}) : ""
  grafana_dashboard_provider_yaml = local.observability_suite_enabled ? templatefile("${path.module}/../observability-suite/grafana-dashboard-provider.yml.tftpl", {}) : ""
  prometheus_config_yaml          = local.observability_suite_enabled ? templatefile("${path.module}/../observability-suite/prometheus.yml.tftpl", {}) : ""
  loki_config_yaml                = local.observability_suite_enabled ? templatefile("${path.module}/../observability-suite/loki-config.yml.tftpl", {}) : ""
  tempo_config_yaml               = local.observability_suite_enabled ? templatefile("${path.module}/../observability-suite/tempo-config.yml.tftpl", {}) : ""
  alloy_config = local.observability_suite_enabled ? templatefile("${path.module}/../observability-suite/alloy-config.alloy.tftpl", {
    loki_otlp_endpoint       = "http://loki:3100/otlp"
    prometheus_remote_write  = "http://prometheus:9090/api/v1/write"
    tempo_otlp_grpc_endpoint = "tempo:4319"
    deployment_environment   = local.deployment_environment
  }) : ""
  observability_suite_compose = local.observability_suite_enabled ? templatefile("${path.module}/../observability-suite/docker-compose.yml.tftpl", {
    grafana_admin_user_json     = jsonencode("admin")
    grafana_admin_password_json = jsonencode(local.effective_grafana_admin_password)
    grafana_image               = "grafana/grafana:latest"
    alloy_image                 = "grafana/alloy:latest"
    loki_image                  = "grafana/loki:latest"
    tempo_image                 = "grafana/tempo:2.10.4"
    prometheus_image            = "prom/prometheus:latest"
  }) : ""
  observability_suite_user_data = local.observability_suite_enabled ? templatefile("${path.module}/../observability-suite/user-data.sh.tftpl", {
    compose_b64                    = base64encode(local.observability_suite_compose)
    alloy_config_b64               = base64encode(local.alloy_config)
    prometheus_config_b64          = base64encode(local.prometheus_config_yaml)
    loki_config_b64                = base64encode(local.loki_config_yaml)
    tempo_config_b64               = base64encode(local.tempo_config_yaml)
    grafana_datasources_b64        = base64encode(local.grafana_datasources_yaml)
    grafana_dashboard_provider_b64 = base64encode(local.grafana_dashboard_provider_yaml)
    grafana_dashboard_b64          = base64encode(local.grafana_dashboard_json)
  }) : null
  otel_common_env = {
    OBSERVABILITY_OTEL_ENABLED           = var.otel_mode == "code" ? "true" : "false"
    OBSERVABILITY_EMF_COMPATIBILITY_MODE = var.observability_emf_compatibility_mode ? "true" : "false"
    OTEL_EXPORTER_OTLP_ENDPOINT          = local.effective_otlp_endpoint
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT   = local.effective_otlp_traces_endpoint
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT  = local.effective_otlp_metrics_endpoint
    OTEL_METRIC_EXPORT_INTERVAL_MS       = tostring(var.otel_metric_export_interval_ms)
    OTEL_TRACES_EXPORTER                 = "otlp"
    OTEL_METRICS_EXPORTER                = "otlp"
    OTEL_EXPORTER_OTLP_PROTOCOL          = "http/protobuf"
    OTEL_PROPAGATORS                     = "tracecontext,baggage,xray"
    OTEL_RESOURCE_ATTRIBUTES             = "deployment.environment=${local.deployment_environment}"
    OTEL_EXPORT_STRATEGY                 = var.otel_export_strategy
  }
  lambda_wrapper_env = var.otel_mode == "adot_layer" ? {
    AWS_LAMBDA_EXEC_WRAPPER = local.effective_lambda_exec_wrapper
  } : {}
  adot_layer_arns = var.otel_mode == "adot_layer" ? [local.effective_adot_lambda_layer_arn] : []
}

resource "random_password" "grafana_admin_password" {
  count   = local.observability_suite_enabled && local.configured_grafana_admin_password == "" ? 1 : 0
  length  = 20
  special = false
}

resource "aws_security_group" "observability_suite" {
  count       = local.observability_suite_enabled ? 1 : 0
  name        = "${local.observability_suite_name}-sg"
  description = "Security group for the observability suite EC2 instance."
  vpc_id      = local.observability_suite_vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_vpc_security_group_ingress_rule" "observability_suite_grafana" {
  for_each = local.observability_suite_enabled ? toset(var.observability_suite_grafana_allowed_cidrs) : toset([])

  security_group_id = aws_security_group.observability_suite[0].id
  cidr_ipv4         = each.value
  from_port         = 3000
  to_port           = 3000
  ip_protocol       = "tcp"
  description       = "Grafana access"
}

resource "aws_vpc_security_group_ingress_rule" "observability_suite_otlp_http" {
  for_each = local.observability_suite_enabled ? toset(var.observability_suite_otlp_allowed_cidrs) : toset([])

  security_group_id = aws_security_group.observability_suite[0].id
  cidr_ipv4         = each.value
  from_port         = 4318
  to_port           = 4318
  ip_protocol       = "tcp"
  description       = "Alloy OTLP HTTP ingest"
}

resource "aws_vpc_security_group_ingress_rule" "observability_suite_otlp_grpc" {
  for_each = local.observability_suite_enabled ? toset(var.observability_suite_otlp_allowed_cidrs) : toset([])

  security_group_id = aws_security_group.observability_suite[0].id
  cidr_ipv4         = each.value
  from_port         = 4317
  to_port           = 4317
  ip_protocol       = "tcp"
  description       = "Alloy OTLP gRPC ingest"
}

resource "aws_vpc_security_group_ingress_rule" "observability_suite_ssh" {
  for_each = local.observability_suite_enabled ? toset(var.observability_suite_ssh_allowed_cidrs) : toset([])

  security_group_id = aws_security_group.observability_suite[0].id
  cidr_ipv4         = each.value
  from_port         = 22
  to_port           = 22
  ip_protocol       = "tcp"
  description       = "SSH access"
}

resource "aws_iam_role" "observability_suite" {
  count              = local.observability_suite_enabled ? 1 : 0
  name               = "${local.observability_suite_name}-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
}

resource "aws_iam_role_policy_attachment" "observability_suite_ssm" {
  count      = local.observability_suite_enabled ? 1 : 0
  role       = aws_iam_role.observability_suite[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "observability_suite" {
  count = local.observability_suite_enabled ? 1 : 0
  name  = "${local.observability_suite_name}-profile"
  role  = aws_iam_role.observability_suite[0].name
}

resource "aws_instance" "observability_suite" {
  count                       = local.observability_suite_enabled ? 1 : 0
  ami                         = data.aws_ami.amazon_linux_2023[0].id
  instance_type               = var.observability_suite_instance_type
  subnet_id                   = local.observability_suite_subnet_id
  vpc_security_group_ids      = [aws_security_group.observability_suite[0].id]
  iam_instance_profile        = aws_iam_instance_profile.observability_suite[0].name
  associate_public_ip_address = true
  user_data                   = local.observability_suite_user_data
  user_data_replace_on_change = true

  lifecycle {
    precondition {
      condition     = local.observability_suite_vpc_id != "" && local.observability_suite_subnet_id != ""
      error_message = "Collector mode requires at least one usable subnet in the target account and region for the EC2 observability suite."
    }
    ignore_changes = [ami]
  }

  root_block_device {
    volume_size = var.observability_suite_root_volume_size_gb
    volume_type = "gp3"
  }

  tags = {
    Name = local.observability_suite_name
  }
}

resource "aws_eip" "observability_suite" {
  count    = local.observability_suite_enabled ? 1 : 0
  domain   = "vpc"
  instance = aws_instance.observability_suite[0].id

  tags = {
    Name = "${local.observability_suite_name}-eip"
  }
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

  lifecycle {
    precondition {
      condition     = !(var.otel_mode == "code" && var.otel_export_strategy == "direct" && local.direct_targets_cloudwatch)
      error_message = "CloudWatch direct OTLP endpoints require SigV4-capable ADOT runtime support. In this repo, use otel_mode='adot_layer' for CloudWatch direct OTLP or keep otel_mode='code' with a non-AWS OTLP backend."
    }
  }
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

data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
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

resource "aws_iam_role_policy_attachment" "create_order_application_signals" {
  count      = local.application_signals_role_policy_enabled ? 1 : 0
  role       = aws_iam_role.create_order.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchLambdaApplicationSignalsExecutionRolePolicy"
}

resource "aws_iam_role_policy_attachment" "get_order_logs" {
  role       = aws_iam_role.get_order.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "get_order_xray" {
  role       = aws_iam_role.get_order.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy_attachment" "get_order_application_signals" {
  count      = local.application_signals_role_policy_enabled ? 1 : 0
  role       = aws_iam_role.get_order.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchLambdaApplicationSignalsExecutionRolePolicy"
}

resource "aws_iam_role_policy_attachment" "payment_simulator_logs" {
  role       = aws_iam_role.payment_simulator.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "payment_simulator_xray" {
  role       = aws_iam_role.payment_simulator.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy_attachment" "payment_simulator_application_signals" {
  count      = local.application_signals_role_policy_enabled ? 1 : 0
  role       = aws_iam_role.payment_simulator.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchLambdaApplicationSignalsExecutionRolePolicy"
}

resource "aws_iam_role_policy_attachment" "order_processor_logs" {
  role       = aws_iam_role.order_processor.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "order_processor_xray" {
  role       = aws_iam_role.order_processor.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy_attachment" "order_processor_application_signals" {
  count      = local.application_signals_role_policy_enabled ? 1 : 0
  role       = aws_iam_role.order_processor.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchLambdaApplicationSignalsExecutionRolePolicy"
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

  lifecycle {
    precondition {
      condition     = !(var.otel_export_strategy == "collector" && var.otel_mode == "adot_layer")
      error_message = "In this repo, otel_export_strategy='collector' requires otel_mode='code' for custom business metrics. Use adot_layer only with direct CloudWatch OTLP."
    }

    precondition {
      condition     = var.otel_mode != "adot_layer" || local.effective_adot_lambda_layer_arn != ""
      error_message = "Unable to resolve an ADOT Lambda layer ARN for the selected region. Set adot_lambda_layer_arn explicitly or use a supported region."
    }
  }

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
