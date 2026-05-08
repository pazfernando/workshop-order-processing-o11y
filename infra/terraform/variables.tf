variable "aws_region" {
  description = "AWS region where the stack will be deployed."
  type        = string
  default     = "us-east-1"
}

variable "stack_name" {
  description = "Prefix used for Terraform-managed AWS resources."
  type        = string
  default     = "observability-business-case"
}

variable "resource_prefix" {
  description = "Optional general prefix added to all named AWS resources."
  type        = string
  default     = "fp-ws"
}

variable "payment_failure_mode" {
  description = "Failure behavior for the payment simulator Lambda."
  type        = string
  default     = "random_fail"

  validation {
    condition = contains([
      "none",
      "always_fail",
      "random_fail",
      "slow_response",
      "random_reject"
    ], var.payment_failure_mode)
    error_message = "payment_failure_mode must be one of: none, always_fail, random_fail, slow_response, random_reject."
  }
}

variable "log_retention_in_days" {
  description = "Retention period for CloudWatch log groups."
  type        = number
  default     = 7
}

variable "metrics_namespace" {
  description = "CloudWatch metrics namespace used by embedded metric format logs."
  type        = string
  default     = "Workshop/OrderProcessing"
}

variable "otel_mode" {
  description = "OpenTelemetry runtime mode. Use 'code' to bootstrap OTel in-process, or 'adot_layer' to delegate bootstrap to an ADOT Lambda layer."
  type        = string
  default     = "code"

  validation {
    condition     = contains(["code", "adot_layer"], var.otel_mode)
    error_message = "otel_mode must be one of: code, adot_layer."
  }
}

variable "adot_lambda_layer_arn" {
  description = "ARN of the ADOT Lambda layer. Required when otel_mode is 'adot_layer'."
  type        = string
  default     = ""

  validation {
    condition     = var.otel_mode != "adot_layer" || trim(var.adot_lambda_layer_arn, " ") != ""
    error_message = "adot_lambda_layer_arn must be set when otel_mode is 'adot_layer'."
  }
}

variable "otel_exporter_otlp_endpoint" {
  description = "Optional base OTLP endpoint for traces and metrics."
  type        = string
  default     = ""
}

variable "otel_export_strategy" {
  description = "OTLP routing strategy. Use 'direct' to export straight to a backend endpoint, or 'collector' to route first through an OpenTelemetry Collector."
  type        = string
  default     = "direct"

  validation {
    condition     = contains(["direct", "collector"], var.otel_export_strategy)
    error_message = "otel_export_strategy must be one of: direct, collector."
  }
}

variable "otel_collector_endpoint" {
  description = "Optional base OTLP endpoint for the collector gateway, for example http://collector.internal:4318."
  type        = string
  default     = ""
}

variable "otel_collector_traces_endpoint" {
  description = "Optional OTLP traces endpoint override for the collector gateway."
  type        = string
  default     = ""
}

variable "otel_collector_metrics_endpoint" {
  description = "Optional OTLP metrics endpoint override for the collector gateway."
  type        = string
  default     = ""
}

variable "otel_exporter_otlp_traces_endpoint" {
  description = "Optional OTLP traces endpoint override."
  type        = string
  default     = ""
}

variable "otel_exporter_otlp_metrics_endpoint" {
  description = "Optional OTLP metrics endpoint override."
  type        = string
  default     = ""
}

variable "otel_metric_export_interval_ms" {
  description = "Metric export interval in milliseconds for the in-process OTel SDK."
  type        = number
  default     = 10000
}

variable "observability_emf_compatibility_mode" {
  description = "Whether to keep emitting CloudWatch EMF metrics in parallel while OTel is introduced."
  type        = bool
  default     = true
}

variable "create_observability_dashboard" {
  description = "Whether to create a CloudWatch dashboard for the workshop."
  type        = bool
  default     = true
}

variable "create_observability_alarms" {
  description = "Whether to create CloudWatch alarms for key operational signals."
  type        = bool
  default     = true
}

variable "api_5xx_alarm_threshold" {
  description = "Threshold for API Gateway 5xx alarm within a one-minute period."
  type        = number
  default     = 1
}

variable "order_processor_error_alarm_threshold" {
  description = "Threshold for order processor errors within a one-minute period."
  type        = number
  default     = 1
}

variable "payment_latency_alarm_threshold_ms" {
  description = "Threshold in milliseconds for high average payment simulation latency."
  type        = number
  default     = 3000
}

variable "observability_suite_instance_type" {
  description = "EC2 instance type used for the observability suite."
  type        = string
  default     = "t3.small"
}

variable "observability_suite_root_volume_size_gb" {
  description = "Root volume size in GiB for the observability suite EC2 instance."
  type        = number
  default     = 20
}

variable "observability_suite_grafana_allowed_cidrs" {
  description = "CIDR ranges allowed to access Grafana on port 3000."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "observability_suite_otlp_allowed_cidrs" {
  description = "CIDR ranges allowed to send OTLP traffic to Alloy on ports 4317 and 4318."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}
