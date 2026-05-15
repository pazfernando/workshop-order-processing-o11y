# Observability Deployment Guide

Guía de consumo de observabilidad para este repo.

## Rol de este repositorio

`workshop-order-processing` ya no provisiona la plataforma de observabilidad. Este repo solo:

- versiona su contrato de observabilidad
- consume la composite action del IDP
- despliega la aplicación usando los bindings generados por la plataforma

La plataforma externa es responsable de toda la implementación observability:

- collector
- dashboards
- alertas
- backends de métricas, trazas y logs
- políticas compartidas de observabilidad

## Contrato del consumidor

Contrato activo:

- [contracts/observability/order-processing.observability.yaml](/Users/pazfernando/Documents/projects/windsurf/workshop-order-processing/contracts/observability/order-processing.observability.yaml)

Ese contrato describe la intención del workload. No define cómo se materializa la plataforma ni obliga a que la aplicación embeba SDKs de observabilidad.

En este repo el contrato se entrega a la composite action del IDP, y el deploy consume su `bindings.json` para propagar variables de entorno, layers y managed policies a las Lambdas.

Con el modelo actual del IDP, ese contrato también debe alinearse a métricas gobernadas por preset. Para este workload el preset soportado es `serverless-api`.

## Validación local

Puedes validar la infraestructura propia de la app así:

```bash
terraform -chdir=infra/terraform fmt -check -recursive
terraform -chdir=infra/terraform init -backend=false
terraform -chdir=infra/terraform validate
```

## Deploy

El workflow [deploy.yml](/Users/pazfernando/Documents/projects/windsurf/workshop-order-processing/.github/workflows/deploy.yml):

- ejecuta la composite action `pazfernando/workshop-idp-o11y/.github/actions/contract-consumer@main`
- delega en la plataforma la validación del contrato, el plan y la generación de bindings
- por defecto reutiliza la managed suite ya existente y consume sus outputs cuando `collector` no trae endpoint explícito
- deja elegir `instrumentation_mode` entre `code` y `adot_layer`
- deja elegir `export_strategy` entre `collector` y `direct` generando un contrato efectivo temporal antes de llamar al IDP
- acepta `collector_endpoint`, `collector_traces_endpoint` y `collector_metrics_endpoint` cuando quieres sobreescribir el collector
- en `direct`, el IDP infiere los endpoints AWS/CloudWatch relacionados
- falla antes del `terraform apply` si el contrato requiere `collector` y la plataforma no resuelve ni un endpoint explícito ni una managed suite reutilizable
- deja en el IDP la publicación del dashboard del workload y consume su URL como output
- persiste `validation.txt`, `plan.json` y `bindings.json` en `build/observability/`
- transforma `bindings.json` en un archivo `terraform.tfvars.json`
- reconcilia el state de Terraform importando recursos AWS del stack si ya existen
- despliega la app con Terraform sin materializar dashboards de observabilidad en el repo consumidor
- no crea plataforma de observabilidad compartida

## Inputs visibles del deploy

El `workflow_dispatch` ahora expone tanto inputs operativos de la app como selectores controlados de observabilidad:

| Input | Uso |
| :--- | :--- |
| `resource_prefix` | Prefijo de recursos y nombres del stack. |
| `payment_failure_mode` | Modo de falla del simulador de pagos. |
| `log_retention_in_days` | Retención de logs de CloudWatch. |
| `instrumentation_mode` | Selecciona `code` o `adot_layer`. |
| `export_strategy` | Selecciona `collector` o `direct` para el contrato efectivo del run. |
| `collector_endpoint` | Endpoint OTLP base custom para runs `collector`. |
| `collector_traces_endpoint` | Override opcional del endpoint de trazas para runs `collector`. |
| `collector_metrics_endpoint` | Override opcional del endpoint de métricas para runs `collector`. |

Reglas:

- `collector_*` no aplica con `export_strategy=direct`
- si `collector` no recibe endpoint explícito, el workflow intenta reutilizar la managed suite existente
- el workflow genera `build/observability/order-processing.effective.observability.yaml` para reflejar el `export_strategy` efectivo del run

Credenciales:

- el job `observability` corre con `environment: aws-dev`
- la composite action recibe los secrets ya resueltos en el contexto del caller
- el camino estándar reutiliza la managed suite existente y necesita `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` y opcionalmente `AWS_SESSION_TOKEN` para leer su state y consumir sus outputs

## Outputs consumidos downstream

El job `deploy` consume estos outputs del job `observability`, que a su vez expone los outputs de la composite action:

- `validation_message`
- `plan_json`
- `bindings_json`
- `managed_suite_enabled`
- `managed_suite_grafana_url`
- `managed_suite_otlp_http_endpoint`
- `effective_collector_endpoint`
- `effective_collector_source`

## Latencia y percentiles

La latencia observable del workload se modela con `HttpServerRequestDuration`, alineada al preset `serverless-api`.

`p99` no es una métrica contractual separada. Es un percentil derivado sobre `HttpServerRequestDuration`, normalmente calculado en el dashboard o backend de observabilidad y filtrable por `POST /orders`.

## Forma esperada de `bindings.json`

Este repo espera el formato emitido por `o11yctl bindings aws-lambda`, incluyendo:

```json
{
  "instrumentation": {
    "mode": "code",
    "exportStrategy": "collector",
    "otlpAuthenticationMode": "collector-managed",
    "emfCompatibilityMode": false
  },
  "environment": {
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://collector.internal:4318"
  },
  "layers": [],
  "managedPolicies": [],
  "outputs": {
    "otlpBaseEndpoint": "http://collector.internal:4318"
  }
}
```

Terraform consume ese payload completo mediante `otel_bindings_json` y desde ahí deriva environment variables, Lambda layers y managed policy attachments para todas las funciones del workload.
