# Observability Business Case

Caso base para talleres técnicos sobre arquitectura serverless, resiliencia y observabilidad.

Este repositorio contiene la aplicación `workshop-order-processing`. La plataforma compartida de observabilidad ya no vive aquí. Este repo ahora actúa como consumidor de un IDP externo de observabilidad y solo mantiene:

- la aplicación
- su contrato de observabilidad
- la integración con el IDP que resuelve el `providerRef` de observabilidad

## Arquitectura

- Amazon API Gateway HTTP API expone `POST /orders` y `GET /orders/{orderId}`.
- Lambda `create-order` valida el payload, calcula `totalAmount`, persiste la orden en DynamoDB con estado `PENDING` y publica `OrderCreated` en EventBridge.
- Lambda `order-processor` consume el evento, mueve la orden a `PROCESSING`, invoca sincrónicamente al simulador de pago y actualiza el estado final.
- Lambda `payment-simulator` simula pagos con modos configurables para escenarios de falla.
- DynamoDB almacena el estado y atributos de la orden.
- CloudWatch Logs concentra logs JSON de cada Lambda y access logs del API.
- El repo conserva solo contexto de correlación para logging operativo y propagación entre componentes.

## Observabilidad en este repo

Este repo conserva la responsabilidad de declarar su necesidad de observabilidad al IDP, pero no implementa ya el runtime de observabilidad.

Se mantiene:

- correlación end-to-end con `x-correlation-id`, `requestId`, `awsRequestId` y `orderId`
- propagación de `correlationId` entre API, EventBridge, `order-processor` y `payment-simulator`
- respuestas API con `x-correlation-id`
- contrato versionado para el IDP externo
- resolución del `providerRef` de observabilidad durante el deploy

No se mantiene aquí:

- OpenTelemetry embebido en la aplicación
- exportadores OTLP, ADOT Lambda layer o compatibilidad EMF
- X-Ray o Application Signals configurados desde este repo
- collectors compartidos, dashboards, alertas o backends de observabilidad

## Contrato e integración con IDP

- Contrato del consumidor: [contracts/observability/order-processing.observability.yaml](/Users/pazfernando/Documents/projects/windsurf/workshop-order-processing/contracts/observability/order-processing.observability.yaml)
- Guía de consumo OTEL e IDP: [docs/observability-deployment.md](/Users/pazfernando/Documents/projects/windsurf/workshop-order-processing/docs/observability-deployment.md)

El flujo esperado es:

1. este repo versiona su contrato de observabilidad
2. el workflow de CD envía ese contrato al IDP externo junto con los inputs de provisión requeridos por plataforma
3. el IDP externo valida ese contrato
4. el IDP devuelve un `providerRef` utilizable para el workload
5. este repo despliega la app y publica ese `providerRef` como referencia de integración

## Desarrollo

Requisitos:

- Node.js 20.x
- Terraform CLI 1.6 o superior
- AWS CLI configurado con credenciales válidas

Comandos principales:

- `npm install`
- `npm run check`
- `bash scripts/prepare-lambda-package.sh`
- `terraform -chdir=infra/terraform fmt -check -recursive`
- `terraform -chdir=infra/terraform init -backend=false`
- `terraform -chdir=infra/terraform validate`

## CI/CD

Workflows:

- [ci.yml](/Users/pazfernando/Documents/projects/windsurf/workshop-order-processing/.github/workflows/ci.yml)
- [deploy.yml](/Users/pazfernando/Documents/projects/windsurf/workshop-order-processing/.github/workflows/deploy.yml)
- [teardown.yml](/Users/pazfernando/Documents/projects/windsurf/workshop-order-processing/.github/workflows/teardown.yml)

`deploy.yml` ya no provisiona observabilidad compartida. Despliega la aplicación usando:

- el contrato versionado en este repo
- una llamada previa al IDP para provisionar observabilidad y resolver el `providerRef`
- inputs de `workflow_dispatch` para tenant, environment, profile y overrides específicos del IDP
- el secreto `OBSERVABILITY_IDP_TOKEN` cuando el IDP requiere autenticación
- Terraform solo para recursos propios de la aplicación
