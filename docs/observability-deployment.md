# Observability Deployment Guide

Guía operativa para desplegar esta solución con OpenTelemetry, ADOT y OTLP.

## Qué decisión estás tomando

Hay dos decisiones separadas:

1. **Quién inicializa OpenTelemetry**
2. **A dónde se exporta la telemetría**

### 1. Quién inicializa OpenTelemetry

| Variable | Valores | Qué significa | Cuándo usarlo |
| :--- | :--- | :--- | :--- |
| `OTEL_MODE` | `code` | La propia Lambda inicializa el SDK OTel desde `src/shared/otel-bootstrap.js` | Recomendado por defecto en este repo |
| `OTEL_MODE` | `adot_layer` | Un Lambda Layer de ADOT inicializa OTel antes del handler | Útil cuando quieres sacar el bootstrap fuera del código |
| `ADOT_LAMBDA_LAYER_ARN` | ARN o vacío | ARN del layer ADOT | Obligatorio si `OTEL_MODE=adot_layer` |

Notas para este repo:

- con el layer Node.js administrado por AWS usado aquí, el wrapper efectivo es `AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler`
- cuando `OTEL_MODE=adot_layer`, Terraform adjunta `CloudWatchLambdaApplicationSignalsExecutionRolePolicy` a los execution roles de las Lambdas

### 2. A dónde se exporta la telemetría

| Variable | Valores | Qué significa | Cuándo usarlo |
| :--- | :--- | :--- | :--- |
| `OTEL_EXPORT_STRATEGY` | `direct` | La Lambda exporta OTLP directo al backend final | Default operativo hoy |
| `OTEL_EXPORT_STRATEGY` | `collector` | La Lambda exporta OTLP primero a un Collector | Arquitectura objetivo |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | URL o vacío | Endpoint base OTLP del backend final | Solo con `direct` |
| `OTEL_COLLECTOR_ENDPOINT` | URL o vacío | Endpoint base OTLP del Collector | Solo con `collector` |

## Matriz de combinaciones

| Modo | Qué hace | Ventaja principal | Costo / tradeoff |
| :--- | :--- | :--- | :--- |
| `code + direct` | La app arranca OTel y exporta directo al backend | Más simple para empezar | Menos desacople |
| `code + collector` | La app arranca OTel y exporta a Collector | Mejor equilibrio entre claridad y arquitectura | Requiere Collector |
| `adot_layer + direct` | ADOT arranca OTel y exporta directo | Menos bootstrap en código | Requiere endpoints válidos y autenticación SigV4 |
| `adot_layer + collector` | ADOT arranca OTel y exporta a Collector | Muy buen desacople entre app y backend | Mayor complejidad operativa |

## Recomendación por etapa

### Etapa actual del repo

Usa:

```text
OTEL_MODE=code
OTEL_EXPORT_STRATEGY=direct
OBSERVABILITY_EMF_COMPATIBILITY_MODE=true
```

Esto mantiene el repo funcional sin exigir un Collector que todavía no está aprovisionado.

### Etapa objetivo

Usa:

```text
OTEL_MODE=code
OTEL_EXPORT_STRATEGY=collector
OTEL_COLLECTOR_ENDPOINT=http://collector.internal:4318
OBSERVABILITY_EMF_COMPATIBILITY_MODE=true
```

Esto deja la instrumentación desacoplada del backend final y permite fan-out.

### Etapa SRE / plataforma más madura

Usa:

```text
OTEL_MODE=adot_layer
ADOT_LAMBDA_LAYER_ARN=arn:aws:lambda:...
OTEL_EXPORT_STRATEGY=collector
OTEL_COLLECTOR_ENDPOINT=http://collector.internal:4318
```

Esto mueve el bootstrap OTel fuera del código de aplicación y deja la operación más centralizada.

## Variables operativas completas

### Variables base del stack

| Variable | Valores permitidos | Obligatoria | Recomendado |
| :--- | :--- | :--- | :--- |
| `STACK_NAME` | string | Sí | `observability-business-case` |
| `RESOURCE_PREFIX` | string | Sí | `aws-dev` |
| `AWS_REGION` | región AWS válida | Sí | `us-east-1` |
| `PAYMENT_FAILURE_MODE` | `none`, `always_fail`, `random_fail`, `slow_response`, `random_reject` | Sí | `none` |
| `LOG_RETENTION_IN_DAYS` | entero positivo | No | `7` |
| `METRICS_NAMESPACE` | string | No | `Workshop/OrderProcessing` |

### Variables de OTel y ADOT

| Variable | Valores permitidos | Obligatoria | Recomendado |
| :--- | :--- | :--- | :--- |
| `OTEL_MODE` | `code`, `adot_layer` | Sí | `code` |
| `ADOT_LAMBDA_LAYER_ARN` | ARN o vacío | Solo con `adot_layer` | vacío |
| `OTEL_EXPORT_STRATEGY` | `direct`, `collector` | Sí | `direct` hoy |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | URL o vacío | Solo con `direct` | vacío |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | URL o vacío | No | vacío |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | URL o vacío | No | vacío |
| `OTEL_COLLECTOR_ENDPOINT` | URL o vacío | Solo con `collector` | vacío hasta tener Collector |
| `OTEL_COLLECTOR_TRACES_ENDPOINT` | URL o vacío | No | vacío |
| `OTEL_COLLECTOR_METRICS_ENDPOINT` | URL o vacío | No | vacío |
| `OTEL_METRIC_EXPORT_INTERVAL_MS` | entero positivo | No | `10000` |
| `OBSERVABILITY_EMF_COMPATIBILITY_MODE` | `true`, `false` | No | `true` |

### Variables de dashboard y alarmas

| Variable | Valores permitidos | Obligatoria | Recomendado |
| :--- | :--- | :--- | :--- |
| `CREATE_OBSERVABILITY_DASHBOARD` | `true`, `false` | No | `true` |
| `CREATE_OBSERVABILITY_ALARMS` | `true`, `false` | No | `true` |
| `API_5XX_ALARM_THRESHOLD` | entero no negativo | No | `1` |
| `ORDER_PROCESSOR_ERROR_ALARM_THRESHOLD` | entero no negativo | No | `1` |
| `PAYMENT_LATENCY_ALARM_THRESHOLD_MS` | entero no negativo | No | `3000` |

### Estado remoto de Terraform

| Variable | Valores permitidos | Obligatoria | Recomendado |
| :--- | :--- | :--- | :--- |
| `TF_STATE_BUCKET` | bucket S3 o vacío | No | vacío si el workflow lo crea |
| `TF_STATE_KEY` | key S3 o vacío | No | `${environment}/${STACK_NAME}.tfstate` |

## Ejemplos listos para usar

### Ejemplo 1: deploy simple del repo

```bash
export OTEL_MODE="code"
export OTEL_EXPORT_STRATEGY="direct"
export OTEL_EXPORTER_OTLP_ENDPOINT=""
export OBSERVABILITY_EMF_COMPATIBILITY_MODE="true"
```

### Ejemplo 2: deploy directo a backend OTLP

```bash
export OTEL_MODE="code"
export OTEL_EXPORT_STRATEGY="direct"
export OTEL_EXPORTER_OTLP_ENDPOINT="https://monitoring.us-east-1.amazonaws.com/v1/metrics"
export OBSERVABILITY_EMF_COMPATIBILITY_MODE="true"
```

Nota:

- CloudWatch no usa un único endpoint base para trazas y métricas.
- Para CloudWatch directo usa `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://xray.<region>.amazonaws.com/v1/traces` y `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=https://monitoring.<region>.amazonaws.com/v1/metrics`.
- Los endpoints OTLP de CloudWatch requieren autenticación `SigV4`.
- En este repo, el camino soportado para CloudWatch directo es `OTEL_MODE=adot_layer`.
- En este repo, el wrapper efectivo para ese layer Node.js es `/opt/otel-handler`.

### Ejemplo 3: deploy con Collector

```bash
export OTEL_MODE="code"
export OTEL_EXPORT_STRATEGY="collector"
export OTEL_COLLECTOR_ENDPOINT="http://collector.internal:4318"
export OBSERVABILITY_EMF_COMPATIBILITY_MODE="true"
```

### Ejemplo 4: deploy con ADOT Layer + Collector

```bash
export OTEL_MODE="adot_layer"
export ADOT_LAMBDA_LAYER_ARN="arn:aws:lambda:<region>:<account-or-publisher>:layer:<adot-layer-name>:<version>"
export OTEL_EXPORT_STRATEGY="collector"
export OTEL_COLLECTOR_ENDPOINT="http://collector.internal:4318"
```

### Ejemplo 5: deploy con ADOT Layer + CloudWatch directo

```bash
export OTEL_MODE="adot_layer"
export ADOT_LAMBDA_LAYER_ARN="arn:aws:lambda:<region>:<account-or-publisher>:layer:<adot-layer-name>:<version>"
export OTEL_EXPORT_STRATEGY="direct"
export OTEL_EXPORTER_OTLP_ENDPOINT=""
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=""
export OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=""
```

Resultado esperado:

- Terraform infiere `https://xray.<region>.amazonaws.com/v1/traces`
- Terraform infiere `https://monitoring.<region>.amazonaws.com/v1/metrics`
- el output `effective_otlp_authentication_mode` queda en `sigv4`
- el output `effective_lambda_exec_wrapper` queda en `/opt/otel-handler`
- el output `application_signals_execution_role_policy_enabled` queda en `true`

## Collectors de referencia

El repo incluye estas configuraciones:

- [collector-cloudwatch.yaml](/Users/pazfernando/Documents/projects/windsurf/workshop-order-processing/infra/otel-collector/collector-cloudwatch.yaml)
- [collector-cloudwatch-third-party.yaml](/Users/pazfernando/Documents/projects/windsurf/workshop-order-processing/infra/otel-collector/collector-cloudwatch-third-party.yaml)

### Qué hace `collector-cloudwatch.yaml`

- recibe OTLP por `4317` y `4318`
- aplica `memory_limiter`
- aplica `batch`
- filtra health checks
- elimina atributos sensibles o de alta cardinalidad
- hace `tail_sampling`
- exporta a CloudWatch OTLP metrics y X-Ray traces

### Qué hace `collector-cloudwatch-third-party.yaml`

Hace lo mismo que el anterior, pero además reenvía a un backend OTLP adicional.

Variables esperadas por ese Collector:

- `AWS_REGION`
- `THIRD_PARTY_OTLP_ENDPOINT`
- `THIRD_PARTY_OTLP_AUTHORIZATION`

## Relación con los workflows

### `deploy.yml`

El workflow de deploy:

1. instala dependencias
2. empaqueta Lambdas
3. valida backend de Terraform
4. valida coherencia de observabilidad
5. ejecuta `terraform apply`

Reglas de validación de observabilidad:

- si `OTEL_MODE=adot_layer`, `ADOT_LAMBDA_LAYER_ARN` debe existir
- si `OTEL_EXPORT_STRATEGY=collector`, `OTEL_COLLECTOR_ENDPOINT` debe existir
- si `OTEL_EXPORT_STRATEGY=direct` y `OTEL_MODE=adot_layer`, dejar vacíos los endpoints directos hace que Terraform infiera CloudWatch OTLP por señal
- si `OTEL_EXPORT_STRATEGY=direct` y `OTEL_MODE=code`, no uses endpoints OTLP de CloudWatch porque este repo no firma SigV4 en el bootstrap en código

### `teardown.yml`

El workflow de teardown reutiliza el mismo set de variables para destruir exactamente el stack creado.

## Qué debería consumir SRE / Observabilidad

Para SRE o plataforma, esta guía es la referencia operativa para:

- elegir `direct` o `collector`
- elegir `code` o `adot_layer`
- mapear variables requeridas por cada caso
- revisar configuraciones ejemplo del Collector
- entender qué valida el workflow antes de desplegar

## Siguiente paso recomendado

Si el equipo de observabilidad va a operar un Collector real, conviene además producir una versión PDF de esta guía y anexarla a la documentación operativa del ambiente.
