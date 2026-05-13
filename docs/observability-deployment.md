# Observability Deployment Guide

Guía de consumo de observabilidad para este repo.

## Rol de este repositorio

`workshop-order-processing` ya no provisiona la plataforma de observabilidad. Este repo solo:

- emite telemetría
- versiona su contrato de observabilidad
- recibe bindings OTEL del IDP externo
- despliega la aplicación con esos bindings

La plataforma externa es responsable de:

- collector
- dashboards
- alertas
- backends de métricas, trazas y logs
- políticas compartidas de observabilidad

## Contrato del consumidor

Contrato activo:

- [contracts/observability/order-processing.observability.yaml](/Users/pazfernando/Documents/projects/windsurf/workshop-order-processing/contracts/observability/order-processing.observability.yaml)

Ese contrato describe la intención del workload. No define cómo se materializa la plataforma.

En particular:

- `backendClass` debe leerse como una clase lógica de capacidad, no como un producto concreto
- este consumidor usa clases neutrales como `traces-standard`, `metrics-standard` y `logs-standard`
- el IDP es responsable de mapear esas clases a implementaciones reales

## Bindings OTEL esperados

El deploy de este repo consume estas variables como bindings de runtime:

| Variable | Uso |
| :--- | :--- |
| `OTEL_MODE` | `code` o `adot_layer` |
| `ADOT_LAMBDA_LAYER_ARN` | Layer ARN si el binding usa `adot_layer` |
| `OTEL_EXPORT_STRATEGY` | `direct` o `collector` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Endpoint base OTLP directo |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Endpoint directo por señal para trazas |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | Endpoint directo por señal para métricas |
| `OTEL_COLLECTOR_ENDPOINT` | Endpoint base del collector externo |
| `OTEL_COLLECTOR_TRACES_ENDPOINT` | Endpoint del collector para trazas |
| `OTEL_COLLECTOR_METRICS_ENDPOINT` | Endpoint del collector para métricas |
| `OBSERVABILITY_EMF_COMPATIBILITY_MODE` | Compatibilidad temporal EMF |
| `OTEL_METRIC_EXPORT_INTERVAL_MS` | Intervalo de exportación del SDK |

## Reglas de uso

- Si `OTEL_EXPORT_STRATEGY=collector`, este repo espera endpoints entregados por el IDP.
- Si `OTEL_MODE=adot_layer`, `ADOT_LAMBDA_LAYER_ARN` debe existir o poder inferirse.
- Si usas endpoints base OTLP/HTTP, el SDK deriva `/v1/traces` y `/v1/metrics`.
- `code + direct` no debe apuntar a CloudWatch OTLP directo porque ese camino requiere `SigV4`.
- `adot_layer + direct` es el camino válido para CloudWatch OTLP directo.
- `code + collector` es el camino válido para un collector externo.
- `adot_layer + collector` no está soportado en este repo para métricas custom del negocio.

## Recomendaciones

### Opción 1: backend OTLP directo no AWS

```text
OTEL_MODE=code
OTEL_EXPORT_STRATEGY=direct
OTEL_EXPORTER_OTLP_ENDPOINT=https://your-otlp-backend.example.com
```

### Opción 2: collector externo entregado por el IDP

```text
OTEL_MODE=code
OTEL_EXPORT_STRATEGY=collector
OTEL_COLLECTOR_ENDPOINT=http://collector.example.internal:4318
```

### Opción 3: CloudWatch OTLP directo

```text
OTEL_MODE=adot_layer
ADOT_LAMBDA_LAYER_ARN=arn:aws:lambda:...
OTEL_EXPORT_STRATEGY=direct
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://xray.<region>.amazonaws.com/v1/traces
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=https://monitoring.<region>.amazonaws.com/v1/metrics
```

## Validación local

Puedes validar el runtime OTEL así:

```bash
npm run test:otel-local
```

Y la infraestructura propia de la app así:

```bash
terraform -chdir=infra/terraform fmt -check -recursive
terraform -chdir=infra/terraform init -backend=false
terraform -chdir=infra/terraform validate
```

## Deploy

El workflow [deploy.yml](/Users/pazfernando/Documents/projects/windsurf/workshop-order-processing/.github/workflows/deploy.yml):

- valida que exista el contrato del consumidor
- recibe los bindings OTEL del IDP
- despliega la app con Terraform
- no crea plataforma de observabilidad compartida
