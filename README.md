# Observability Business Case

Caso base para talleres técnicos sobre arquitectura serverless, resiliencia y observabilidad.

Este repositorio contiene la aplicación `workshop-order-processing`. La plataforma compartida de observabilidad ya no vive aquí. Este repo ahora actúa como consumidor de un IDP externo de observabilidad y solo mantiene:

- la aplicación
- su instrumentación OpenTelemetry
- su contrato de observabilidad
- los bindings OTEL necesarios para desplegarla

## Arquitectura

- Amazon API Gateway HTTP API expone `POST /orders` y `GET /orders/{orderId}`.
- Lambda `create-order` valida el payload, calcula `totalAmount`, persiste la orden en DynamoDB con estado `PENDING` y publica `OrderCreated` en EventBridge.
- Lambda `order-processor` consume el evento, mueve la orden a `PROCESSING`, invoca sincrónicamente al simulador de pago y actualiza el estado final.
- Lambda `payment-simulator` simula pagos con modos configurables para escenarios de falla.
- DynamoDB almacena el estado y atributos de la orden.
- CloudWatch Logs concentra logs JSON de cada Lambda y access logs del API.
- AWS X-Ray queda habilitado en las Lambdas para ver latencia y errores por función.
- La base de instrumentación compartida vive en `src/shared/observability.js` y la convención del repositorio es `otel-first`.

## Observabilidad en este repo

Este repo conserva la responsabilidad de emitir telemetría y de declarar su necesidad observability al IDP.

Se mantiene:

- correlación end-to-end con `x-correlation-id`, `requestId`, `awsRequestId` y `orderId`
- propagación de `correlationId` entre API, EventBridge, `order-processor` y `payment-simulator`
- respuestas API con `x-correlation-id` y, cuando existe contexto, `x-trace-id`
- instrumentación OpenTelemetry en código compatible con `adot_layer`
- métricas de negocio emitidas desde `src/shared/observability.js`
- compatibilidad opcional con EMF mediante `OBSERVABILITY_EMF_COMPATIBILITY_MODE`

No se mantiene aquí:

- collectors compartidos
- Grafana, Tempo, Loki o Prometheus
- dashboards gestionados por plataforma
- alertas gestionadas por plataforma
- infraestructura compartida de observabilidad

## Contrato e integración con IDP

- Contrato del consumidor: [contracts/observability/order-processing.observability.yaml](/Users/pazfernando/Documents/projects/windsurf/workshop-order-processing/contracts/observability/order-processing.observability.yaml)
- Guía de consumo OTEL e IDP: [docs/observability-deployment.md](/Users/pazfernando/Documents/projects/windsurf/workshop-order-processing/docs/observability-deployment.md)

El flujo esperado es:

1. este repo versiona su contrato de observabilidad
2. el IDP externo valida ese contrato
3. el IDP devuelve bindings OTEL efectivos
4. este repo despliega la app usando esos bindings

## Métricas de negocio

| Métrica | Servicio | Qué representa |
| :--- | :--- | :--- |
| `OrdersCreated` | `order-api` | Órdenes creadas exitosamente |
| `CreateOrderLatencyMs` | `order-api` | Latencia de `POST /orders` |
| `CreateOrderErrors` | `order-api` | Errores al crear órdenes |
| `OrdersRead` | `order-api` | Lecturas exitosas de órdenes |
| `OrdersNotFound` | `order-api` | Consultas de órdenes inexistentes |
| `GetOrderLatencyMs` | `order-api` | Latencia de `GET /orders/{orderId}` |
| `GetOrderErrors` | `order-api` | Errores en `GET /orders/{orderId}` |
| `OrdersProcessed` | `order-processor` | Eventos procesados con resultado final |
| `PaymentInvocationLatencyMs` | `order-processor` | Latencia de la invocación al simulador de pago |
| `OrderProcessorIgnoredEvents` | `order-processor` | Eventos ignorados por payload inválido |
| `OrderProcessorDuplicateEvents` | `order-processor` | Eventos duplicados o ya procesados |
| `OrderProcessorErrors` | `order-processor` | Errores del procesador de órdenes |
| `PaymentsSimulated` | `payment-simulator` | Pagos simulados con estado final |
| `PaymentSimulationLatencyMs` | `payment-simulator` | Latencia del simulador de pago |
| `PaymentSimulationErrors` | `payment-simulator` | Errores del simulador de pago |

## Desarrollo

Requisitos:

- Node.js 20.x
- Terraform CLI 1.6 o superior
- AWS CLI configurado con credenciales válidas

Comandos principales:

- `npm install`
- `npm run check`
- `bash scripts/prepare-lambda-package.sh`
- `npm run test:otel-local`
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
- bindings OTEL entregados por el IDP
- Terraform solo para recursos propios de la aplicación
