# Observability Deployment Guide

Guía corta para elegir `code` vs `adot_layer` y `direct` vs `collector` en este repo.

## Decisiones

Hay dos ejes:

1. Quién inicializa OpenTelemetry
2. A dónde se exporta la telemetría

### 1. Quién inicializa OpenTelemetry

| Variable | Valores | Qué significa | Cuándo usarlo |
| :--- | :--- | :--- | :--- |
| `OTEL_MODE` | `code` | La propia Lambda inicializa el SDK OTel | Default del repo |
| `OTEL_MODE` | `adot_layer` | Un Lambda Layer de ADOT inicializa OTel antes del handler | Útil para CloudWatch directo |
| `ADOT_LAMBDA_LAYER_ARN` | ARN o vacío | ARN del layer ADOT | Obligatorio si `OTEL_MODE=adot_layer` |

Notas de este repo:

- con el layer Node.js administrado por AWS usado aquí, el wrapper efectivo es `AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler`
- cuando `OTEL_MODE=adot_layer`, Terraform adjunta `CloudWatchLambdaApplicationSignalsExecutionRolePolicy` a los execution roles de las Lambdas

### 2. A dónde se exporta la telemetría

| Variable | Valores | Qué significa | Cuándo usarlo |
| :--- | :--- | :--- | :--- |
| `OTEL_EXPORT_STRATEGY` | `direct` | La Lambda exporta OTLP directo al backend final | Default operativo hoy |
| `OTEL_EXPORT_STRATEGY` | `collector` | La Lambda exporta OTLP primero a un Collector | En este repo provisiona la suite EC2 con Alloy |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | URL o vacío | Endpoint base OTLP del backend final | Solo con `direct` |
| `OTEL_COLLECTOR_ENDPOINT` | URL o vacío | Endpoint base OTLP del Collector | Solo con `collector`; opcional si Terraform infiere Alloy |

## Combinaciones

| Modo | Qué hace | Ventaja principal | Costo / tradeoff |
| :--- | :--- | :--- | :--- |
| `code + direct` | App arranca OTel y exporta directo | Más simple | No sirve para CloudWatch OTLP directo |
| `code + collector` | App arranca OTel y exporta a Collector | Camino soportado para métricas custom del negocio en Grafana | Requiere Collector |
| `adot_layer + direct` | ADOT arranca OTel y exporta directo | Habilita CloudWatch directo | Requiere SigV4 |
| `adot_layer + collector` | ADOT arranca OTel y exporta a Collector | No usar en este repo | El deploy lo bloquea para evitar un falso positivo de métricas |

### Señales soportadas por combinación

| Combinación | Trazas | Métricas custom del negocio | Estado en este repo |
| :--- | :--- | :--- | :--- |
| `code + direct` | Sí | Sí, hacia OTLP genérico no-AWS | Soportado |
| `code + collector` | Sí | Sí, hacia Alloy/Prometheus/Grafana | Soportado |
| `adot_layer + direct` | Sí | Sí, para CloudWatch OTLP directo | Soportado |
| `adot_layer + collector` | Sí, potencialmente | No garantizado para las métricas custom de este repo | No soportado y bloqueado |

## Suite EC2 para `collector`

Cuando `OTEL_EXPORT_STRATEGY=collector`, este repo usa una sola EC2 para:

- `Alloy` como collector OTLP
- `Prometheus` como backend de métricas
- `Tempo` como backend de trazas
- `Grafana` como visualizador
- `Loki` como backend listo para logs OTLP futuros

Alcance actual:

- métricas OTLP: soportadas y visualizadas en Grafana vía Prometheus
- trazas OTLP: soportadas y explorables en Grafana vía Tempo
- logs OTLP: collector y Loki listos para usarse cuando la app los emita
- red: intenta usar primero una subnet pública de la región y, si no existe, cae a la primera subnet disponible
- acceso a Grafana: usa `admin` y toma la contraseña de `OBSERVABILITY_SUITE_GRAFANA_ADMIN_PASSWORD` desde GitHub `Secrets` si existe; si no, cae a `Variables` y luego a una aleatoria de Terraform

## Recomendación

### Hoy

Usa:

```text
OTEL_MODE=code
OTEL_EXPORT_STRATEGY=direct
OBSERVABILITY_EMF_COMPATIBILITY_MODE=true
```

Mantiene el repo funcional sin exigir Collector.

### Siguiente paso recomendado

Usa:

```text
OTEL_MODE=code
OTEL_EXPORT_STRATEGY=collector
OTEL_COLLECTOR_ENDPOINT=
OBSERVABILITY_EMF_COMPATIBILITY_MODE=true
```

Desacopla la instrumentación del backend final.

### CloudWatch directo

Usa:

```text
OTEL_MODE=adot_layer
ADOT_LAMBDA_LAYER_ARN=arn:aws:lambda:...
OTEL_EXPORT_STRATEGY=direct
```

Usa el layer ADOT para CloudWatch OTLP directo cuando esa sea la meta operativa.

## Variables relevantes

### Stack base

| Variable | Valores permitidos | Obligatoria | Recomendado |
| :--- | :--- | :--- | :--- |
| `STACK_NAME` | string | Sí | `observability-business-case` |
| `RESOURCE_PREFIX` | string | Sí | `aws-dev-1` |
| `AWS_REGION` | región AWS válida | Sí | `us-east-1` |
| `PAYMENT_FAILURE_MODE` | `none`, `always_fail`, `random_fail`, `slow_response`, `random_reject` | Sí | `random_fail` |
| `LOG_RETENTION_IN_DAYS` | entero positivo | No | `7` |
| `METRICS_NAMESPACE` | string | No | `Workshop/OrderProcessing` |

### OTel y ADOT

| Variable | Valores permitidos | Obligatoria | Recomendado |
| :--- | :--- | :--- | :--- |
| `OTEL_MODE` | `code`, `adot_layer` | Sí | `code` |
| `ADOT_LAMBDA_LAYER_ARN` | ARN o vacío | Solo con `adot_layer` | vacío |
| `OTEL_EXPORT_STRATEGY` | `direct`, `collector` | Sí | `direct` hoy |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | URL o vacío | Solo con `direct` | vacío |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | URL o vacío | No | vacío |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | URL o vacío | No | vacío |
| `OTEL_COLLECTOR_ENDPOINT` | URL o vacío | Solo con `collector` | vacío para inferir Alloy |
| `OTEL_COLLECTOR_TRACES_ENDPOINT` | URL o vacío | No | vacío |
| `OTEL_COLLECTOR_METRICS_ENDPOINT` | URL o vacío | No | vacío |
| `OTEL_METRIC_EXPORT_INTERVAL_MS` | entero positivo | No | `10000` |
| `OBSERVABILITY_EMF_COMPATIBILITY_MODE` | `true`, `false` | No | `true` |

### Dashboard y alarmas

| Variable | Valores permitidos | Obligatoria | Recomendado |
| :--- | :--- | :--- | :--- |
| `CREATE_OBSERVABILITY_DASHBOARD` | `true`, `false` | No | `true` |
| `CREATE_OBSERVABILITY_ALARMS` | `true`, `false` | No | `true` |
| `API_5XX_ALARM_THRESHOLD` | entero no negativo | No | `1` |
| `ORDER_PROCESSOR_ERROR_ALARM_THRESHOLD` | entero no negativo | No | `1` |
| `PAYMENT_LATENCY_ALARM_THRESHOLD_MS` | entero no negativo | No | `3000` |

### Estado remoto

| Variable | Valores permitidos | Obligatoria | Recomendado |
| :--- | :--- | :--- | :--- |
| `TF_STATE_BUCKET` | bucket S3 o vacío | No | vacío si el workflow lo crea |
| `TF_STATE_KEY` | key S3 o vacío | No | `${environment}/${RESOURCE_PREFIX}-${STACK_NAME}.tfstate` |

### Suite EC2

| Variable | Valores permitidos | Obligatoria | Recomendado |
| :--- | :--- | :--- | :--- |
| `OBSERVABILITY_SUITE_INSTANCE_TYPE` | tipo EC2 válido | No | `t3.small` |
| `OBSERVABILITY_SUITE_GRAFANA_ADMIN_PASSWORD` | string o vacío | No | vacío |
| `OBSERVABILITY_SUITE_ROOT_VOLUME_SIZE_GB` | entero positivo | No | `20` |
| `OBSERVABILITY_SUITE_GRAFANA_ALLOWED_CIDRS` | lista JSON de CIDRs | No | `["0.0.0.0/0"]` |
| `OBSERVABILITY_SUITE_OTLP_ALLOWED_CIDRS` | lista JSON de CIDRs | No | `["0.0.0.0/0"]` |

## Ejemplos

### Ejemplo 1: deploy simple del repo

```bash
export OTEL_MODE="code"
export OTEL_EXPORT_STRATEGY="direct"
export OTEL_EXPORTER_OTLP_ENDPOINT=""
export OBSERVABILITY_EMF_COMPATIBILITY_MODE="true"
```

### Ejemplo 2: direct a backend OTLP genérico

```bash
export OTEL_MODE="code"
export OTEL_EXPORT_STRATEGY="direct"
export OTEL_EXPORTER_OTLP_ENDPOINT="https://your-otlp-backend.example.com"
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

Resultado esperado:

- métricas custom del negocio llegan a Alloy y Prometheus
- Grafana puede visualizarlas desde el datasource `Prometheus`
- trazas OTLP siguen llegando a Alloy y Tempo

### Ejemplo 4: combinación no soportada en este repo

```bash
export OTEL_MODE="adot_layer"
export ADOT_LAMBDA_LAYER_ARN="arn:aws:lambda:<region>:<account-or-publisher>:layer:<adot-layer-name>:<version>"
export OTEL_EXPORT_STRATEGY="collector"
export OTEL_COLLECTOR_ENDPOINT="http://collector.internal:4318"
```

Resultado esperado:

- el deploy falla de forma explícita
- la razón es que, en este repo, `adot_layer + collector` no garantiza que las métricas custom del negocio lleguen al Collector
- usa `code + collector` para Grafana/Alloy/Prometheus o `adot_layer + direct` para CloudWatch OTLP directo

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
- el output `effective_otlp_authentication_mode` queda en `sigv4`, indicando un requisito del backend OTLP efectivo, no un input manual del workflow
- el output `effective_lambda_exec_wrapper` queda en `/opt/otel-handler`
- el output `application_signals_execution_role_policy_enabled` queda en `true`

### Ejemplo 6: suite EC2 con Alloy + Grafana + Prometheus + Tempo + Loki

```bash
export OBSERVABILITY_SUITE_INSTANCE_TYPE="t3.small"
export OTEL_EXPORT_STRATEGY="collector"
export OTEL_COLLECTOR_ENDPOINT=""
export OTEL_COLLECTOR_TRACES_ENDPOINT=""
export OTEL_COLLECTOR_METRICS_ENDPOINT=""
```

Resultado esperado:

- Terraform crea una EC2 con Grafana, Alloy, Prometheus, Tempo y Loki
- Terraform infiere el endpoint HTTP de Alloy para trazas y métricas si `collector` está activo y no diste endpoints explícitos
- Grafana queda provisionado con un dashboard para las métricas de negocio actuales

## Collector de referencia

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

`collector-cloudwatch-third-party.yaml` hace lo mismo, pero además reenvía a un backend OTLP adicional.

## Workflows

### `deploy.yml`

`deploy.yml` instala dependencias, empaqueta Lambdas, valida observabilidad y ejecuta `terraform apply`.

Reglas de validación de observabilidad:

- si `OTEL_MODE=adot_layer`, `ADOT_LAMBDA_LAYER_ARN` debe existir
- si `OTEL_EXPORT_STRATEGY=collector`, puedes dejar vacío `OTEL_COLLECTOR_ENDPOINT` para que Terraform infiera Alloy, o definirlo si quieres un Collector externo
- si `OTEL_EXPORT_STRATEGY=direct` y `OTEL_MODE=adot_layer`, dejar vacíos los endpoints directos hace que Terraform infiera CloudWatch OTLP por señal
- si `OTEL_EXPORT_STRATEGY=direct` y `OTEL_MODE=code`, no uses endpoints OTLP de CloudWatch porque este repo no firma SigV4 en el bootstrap en código
- si `OTEL_EXPORT_STRATEGY=collector`, puedes dejar vacíos `OTEL_COLLECTOR_TRACES_ENDPOINT` y `OTEL_COLLECTOR_METRICS_ENDPOINT`; Terraform los infiere hacia Alloy

`teardown.yml` reutiliza las mismas variables para destruir el stack y ahora confirma contra el nombre efectivo, incluyendo `RESOURCE_PREFIX` cuando aplique.
