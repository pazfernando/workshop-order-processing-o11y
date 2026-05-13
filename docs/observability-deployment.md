# Observability Deployment Guide

Guía de consumo de observabilidad para este repo.

## Rol de este repositorio

`workshop-order-processing` ya no provisiona la plataforma de observabilidad. Este repo solo:

- versiona su contrato de observabilidad
- consume el reusable workflow del IDP
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

En este repo el contrato se entrega al workflow reusable del IDP, y el deploy consume su `bindings.json` para propagar variables de entorno, layers y managed policies a las Lambdas.

## Validación local

Puedes validar la infraestructura propia de la app así:

```bash
terraform -chdir=infra/terraform fmt -check -recursive
terraform -chdir=infra/terraform init -backend=false
terraform -chdir=infra/terraform validate
```

## Deploy

El workflow [deploy.yml](/Users/pazfernando/Documents/projects/windsurf/workshop-order-processing/.github/workflows/deploy.yml):

- llama al reusable workflow `pazfernando/workshop-idp-o11y/.github/workflows/contract-consumer.yml@main`
- delega en la plataforma la validación del contrato, el plan y la generación de bindings
- por defecto pide a la plataforma que despliegue primero la managed suite
- persiste `validation.txt`, `plan.json` y `bindings.json` en `build/observability/`
- transforma `bindings.json` en un archivo `terraform.tfvars.json`
- reconcilia el state de Terraform importando recursos AWS del stack si ya existen
- despliega la app con Terraform
- no crea plataforma de observabilidad compartida

## Inputs de CD para el reusable workflow

Los principales inputs expuestos por este repo al `workflow_dispatch` son:

| Input | Uso |
| :--- | :--- |
| `observability_instrumentation_mode` | `code` o `adot_layer`; default `code` |
| `observability_collector_endpoint` | Endpoint base OTLP para collector mode |
| `observability_direct_endpoint` | Endpoint base OTLP para direct mode |
| `observability_emf_compatibility_mode` | Compatibilidad EMF en bindings AWS Lambda; default `true` |
| `deploy_managed_suite` | Si la plataforma debe desplegar primero su managed suite; default `true` |
| `managed_suite_name` | Nombre base de la managed suite |
| `managed_suite_grafana_allowed_cidrs` | CIDRs para acceso a Grafana |
| `managed_suite_otlp_allowed_cidrs` | CIDRs para acceso a OTLP |
| `managed_suite_ssh_allowed_cidrs` | CIDRs para acceso SSH |

Credenciales:

- el reusable workflow usa `secrets: inherit`
- si `deploy_managed_suite=true`, deben existir `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` y opcionalmente `AWS_SESSION_TOKEN`
- opcionalmente `OBSERVABILITY_SUITE_GRAFANA_ADMIN_PASSWORD`

## Outputs consumidos downstream

El job `deploy` consume estos outputs del reusable workflow:

- `validation_message`
- `plan_json`
- `bindings_json`
- `managed_suite_enabled`
- `managed_suite_grafana_url`
- `managed_suite_otlp_http_endpoint`
- `effective_collector_endpoint`

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
