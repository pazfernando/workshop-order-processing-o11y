# Observability Business Case

Caso base para talleres técnicos sobre arquitectura serverless, resiliencia y observabilidad.

Este repositorio contiene la aplicación `workshop-order-processing`. La plataforma compartida de observabilidad ya no vive aquí. Este repo ahora actúa como consumidor de un IDP externo de observabilidad y solo mantiene:

- la aplicación
- su contrato de observabilidad
- la integración con el workflow reusable del IDP

## Arquitectura

- Amazon API Gateway HTTP API expone `POST /orders` y `GET /orders/{orderId}`.
- Lambda `create-order` valida el payload, calcula `totalAmount`, persiste la orden en DynamoDB con estado `PENDING` y publica `OrderCreated` en EventBridge.
- Lambda `order-processor` consume el evento, mueve la orden a `PROCESSING`, invoca sincrónicamente al simulador de pago y actualiza el estado final.
- Lambda `payment-simulator` simula pagos con modos configurables para escenarios de falla.
- DynamoDB almacena el estado y atributos de la orden.
- CloudWatch Logs concentra logs JSON de cada Lambda y access logs del API.
- El repo conserva solo contexto de correlación para logging operativo y propagación entre componentes.

## Observabilidad en este repo

Este repo conserva la responsabilidad de declarar su necesidad de observabilidad al IDP y de consumir los bindings generados por la plataforma durante el deploy.

Se mantiene:

- correlación end-to-end con `x-correlation-id`, `requestId`, `awsRequestId` y `orderId`
- propagación de `correlationId` entre API, EventBridge, `order-processor` y `payment-simulator`
- respuestas API con `x-correlation-id`
- contrato versionado para el IDP externo
- integración de CD con el reusable workflow del IDP
- consumo de `bindings.json` para inyectar configuración de runtime en Terraform

No se mantiene aquí:

- la lógica de validación, planning y generación de bindings duplicada localmente
- collectors compartidos, dashboards, alertas o backends de observabilidad
- la provisión de la managed suite dentro de este repositorio

## Metric Catalog

El contrato de observabilidad declara estas métricas de negocio para el workload:

| Metric | Type | Unit | Meaning |
| :--- | :--- | :--- | :--- |
| `OrdersCreated` | `counter` | `{order}` | Total de órdenes creadas exitosamente. |
| `CreateOrderLatencyMs` | `histogram` | `ms` | Latencia de `POST /orders`. |

## Contrato e integración con IDP

- Contrato del consumidor: [contracts/observability/order-processing.observability.yaml](/Users/pazfernando/Documents/projects/windsurf/workshop-order-processing/contracts/observability/order-processing.observability.yaml)
- Guía de consumo OTEL e IDP: [docs/observability-deployment.md](/Users/pazfernando/Documents/projects/windsurf/workshop-order-processing/docs/observability-deployment.md)

El flujo esperado es:

1. este repo versiona su contrato de observabilidad
2. el pipeline de CD llama al reusable workflow del IDP
3. el workflow del IDP valida el contrato, construye el plan y genera `bindings.json`
4. por defecto, el workflow del IDP despliega primero la managed suite y reutiliza su OTLP endpoint para resolver collector mode
5. este repo despliega la app consumiendo esos bindings en Terraform

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

`deploy.yml` consume la plataforma de observabilidad usando:

- el contrato versionado en este repo
- un job reusable hacia `pazfernando/workshop-idp-o11y/.github/workflows/contract-consumer.yml@main`
- inputs de `workflow_dispatch` para instrumentation mode, endpoints OTLP y managed suite, con defaults `code`, `collector` y EMF habilitado
- `bindings.json` generado por la plataforma y persistido en `build/observability/`
- Terraform para recursos propios de la aplicación y para inyectar los bindings resultantes en las Lambdas
- una reconciliación previa del state para importar recursos AWS preexistentes del stack antes del `terraform apply`
