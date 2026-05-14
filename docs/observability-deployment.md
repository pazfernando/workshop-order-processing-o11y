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
- por defecto reutiliza la managed suite ya existente y consume sus outputs
- antes de la validación dispara un workflow host-side que publica o actualiza un dashboard Grafana por caller sobre la suite reutilizada
- fija `instrumentation_mode` en `code`
- persiste `validation.txt`, `plan.json` y `bindings.json` en `build/observability/`
- transforma `bindings.json` en un archivo `terraform.tfvars.json`
- reconcilia el state de Terraform importando recursos AWS del stack si ya existen
- despliega la app con Terraform, incluyendo un dashboard CloudWatch por workload
- no crea plataforma de observabilidad compartida

## Inputs visibles del deploy

El `workflow_dispatch` expone solo inputs operativos de la app:

| Input | Uso |
| :--- | :--- |
| `resource_prefix` | Prefijo de recursos y nombres del stack. |
| `payment_failure_mode` | Modo de falla del simulador de pagos. |
| `log_retention_in_days` | Retención de logs de CloudWatch. |

Los parámetros OTLP, ADOT, EMF y de managed suite ya no forman parte de la interfaz normal del consumidor en este repo. Quedan resueltos por defaults del IDP o por variables internas del entorno GitHub.

Credenciales:

- el job `observability` corre con `environment: aws-dev`
- la composite action recibe los secrets ya resueltos en el contexto del caller
- el camino estándar reutiliza la managed suite existente y necesita `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` y opcionalmente `AWS_SESSION_TOKEN` para leer su state y consumir sus outputs

El password de Grafana ya no viaja desde el caller. El workflow host-side `publish-caller-dashboard.yml` corre en `workshop-idp-o11y` y toma `OBSERVABILITY_SUITE_GRAFANA_ADMIN_PASSWORD` directamente de los secrets del host.

## Outputs consumidos downstream

El job `deploy` consume estos outputs del job `observability`, que a su vez expone los outputs de la composite action:

- `validation_message`
- `plan_json`
- `bindings_json`
- `managed_suite_enabled`
- `managed_suite_grafana_url`
- `caller_grafana_dashboard_url`
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
