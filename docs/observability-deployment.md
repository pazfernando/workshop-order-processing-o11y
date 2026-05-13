# Observability Deployment Guide

Guía de consumo de observabilidad para este repo.

## Rol de este repositorio

`workshop-order-processing` ya no provisiona la plataforma de observabilidad. Este repo solo:

- versiona su contrato de observabilidad
- resuelve un `providerRef` desde el IDP externo
- despliega la aplicación sin runtime OTEL embebido

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

En este repo no se consumen ya bindings OTEL de runtime, layers ADOT ni endpoints OTLP.

## Validación local

Puedes validar la infraestructura propia de la app así:

```bash
terraform -chdir=infra/terraform fmt -check -recursive
terraform -chdir=infra/terraform init -backend=false
terraform -chdir=infra/terraform validate
```

## Deploy

El workflow [deploy.yml](/Users/pazfernando/Documents/projects/windsurf/workshop-order-processing/.github/workflows/deploy.yml):

- valida que exista el contrato del consumidor
- puede pedir al IDP la provisión de observabilidad antes del deploy
- envía el contrato versionado y un bloque de inputs operativos al IDP
- resuelve el `providerRef` desde la respuesta del IDP
- despliega la app con Terraform
- no crea plataforma de observabilidad compartida

## Inputs de CD para el IDP

Cuando `idp_provision_observability=true`, el workflow usa estos inputs:

| Input | Uso |
| :--- | :--- |
| `idp_api_base_url` | URL base del IDP |
| `idp_api_path` | Path HTTP del endpoint de provisión |
| `idp_tenant` | Tenant o cuenta lógica en la plataforma |
| `idp_environment` | Ambiente lógico pedido al IDP |
| `idp_capability_profile` | Perfil o bundle de capacidades del IDP |
| `idp_wait_for_ready` | Espera activa hasta recibir bindings listos |
| `idp_timeout_seconds` | Timeout de espera para provisión asíncrona |
| `idp_request_overrides_json` | JSON libre para opciones adicionales del IDP |

Autenticación:

- si el IDP requiere token bearer, define el secret `OBSERVABILITY_IDP_TOKEN`
- para ejecuciones por `push`, puedes activar este modo con la variable de entorno/repo `IDP_PROVISION_OBSERVABILITY=true`

## Forma esperada de la respuesta del IDP

Este repo espera una respuesta JSON con un `providerRef` utilizable, por ejemplo:

```json
{
  "providerRef": "obs/aws-dev/order-processing"
}
```

También se aceptan variantes equivalentes bajo `provider.ref` o `metadata.providerRef`.
