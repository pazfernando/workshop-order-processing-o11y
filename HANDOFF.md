# HANDOFF.md

## Estado actual

El repositorio implementa un MVP funcional de procesamiento de órdenes sobre AWS Serverless para uso en talleres técnicos.

Arquitectura actual:

- API Gateway HTTP API
- Lambda para `POST /orders`
- Lambda para `GET /orders/{orderId}`
- DynamoDB `Orders`
- EventBridge para evento `OrderCreated`
- Lambda `OrderProcessor`
- Lambda `PaymentSimulator`

## Objetivo del proyecto

Servir como laboratorio reutilizable para:

- observabilidad
- OpenTelemetry
- tracing distribuido
- logs estructurados
- métricas
- resiliencia
- idempotencia
- diagnóstico de fallas

En esta iteración no se agregó OpenTelemetry ni observabilidad avanzada. La base quedó preparada para eso.

## Archivos principales

- `template.yaml`: infraestructura AWS SAM
- `src/order-api/create-order.js`: crea la orden, valida, persiste y publica evento
- `src/order-api/get-order.js`: consulta la orden
- `src/order-processor/process-order-created.js`: procesa el evento y actualiza el estado
- `src/payment-simulator/process-payment.js`: simulador de pago configurable
- `src/shared/*`: utilidades compartidas
- `scripts/deploy.sh`: despliegue local con SAM
- `.github/workflows/ci.yml`: pipeline de validación
- `.github/workflows/deploy.yml`: pipeline de despliegue a AWS
- `AGENTS.md`: reglas operativas del repo
- `README.md`: documentación principal

## Flujo funcional implementado

1. Cliente llama `POST /orders`
2. Se valida el payload
3. Se calcula `totalAmount`
4. Se guarda la orden con estado `PENDING`
5. Se publica `OrderCreated` en EventBridge
6. `OrderProcessor` consume el evento
7. La orden pasa a `PROCESSING`
8. Se invoca `PaymentSimulator`
9. La orden termina en `APPROVED`, `REJECTED` o `FAILED`
10. Cliente consulta por `GET /orders/{orderId}`

## Reglas de diseño aplicadas

- Mantener el MVP simple
- No agregar SQS, Step Functions ni componentes extra por ahora
- No agregar OpenTelemetry en esta fase
- Mantener logs JSON simples
- Conservar estructura modular y fácil de explicar en workshop
- Usar AWS SDK v3
- Usar Node.js 20.x
- Usar AWS SAM para IaC

## CI/CD actual

### CI

Archivo:

- `.github/workflows/ci.yml`

Ejecuta:

- `npm install`
- `npm run check`
- `sam validate`
- `sam build`

### Deploy

Archivo:

- `.github/workflows/deploy.yml`

Comportamiento:

- despliega en push a `main`
- permite ejecución manual con `workflow_dispatch`
- usa GitHub Secrets para autenticarse contra AWS

Secrets requeridos:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Variables recomendadas:

- `AWS_REGION`
- `STACK_NAME`
- `PAYMENT_FAILURE_MODE`

Environment actual configurado en workflow:

- `aws-dev`

## Despliegue local

Requisitos:

- Node.js 20.x
- AWS CLI
- AWS SAM CLI

Autenticación local:

- `aws configure`

o:

```bash
export AWS_ACCESS_KEY_ID="<tu-access-key-id>"
export AWS_SECRET_ACCESS_KEY="<tu-secret-access-key>"
export AWS_REGION="us-east-1"
```

Desplegar:

```bash
export STACK_NAME=observability-business-case
export AWS_REGION=us-east-1
export PAYMENT_FAILURE_MODE=none
bash scripts/deploy.sh
```

## Validaciones hechas

- La sintaxis JavaScript fue validada con `node --check`
- `npm run check` pasó correctamente

Limitación del entorno donde se trabajó:

- no fue posible ejecutar `sam validate` ni desplegar desde esta sesión porque `sam` no estaba instalado en el entorno local de trabajo de Codex

## Próximos pasos sugeridos

1. Agregar OpenTelemetry en las Lambdas
2. Propagar contexto entre API, EventBridge y Lambda invocada
3. Añadir métricas de negocio y técnicas
4. Estandarizar correlación por `orderId`, `eventId` y `requestId`
5. Agregar ambientes `dev` y `prod` en GitHub Actions
6. Endurecer permisos IAM del usuario de despliegue
7. Opcionalmente cambiar de access keys a OIDC en GitHub Actions si luego quieres un modelo más seguro

## Instrucción para retomar en otra sesión de Codex

Al abrir este proyecto en la nueva ruta, conviene decir:

```text
Lee AGENTS.md, README.md y HANDOFF.md y continúa desde el estado actual del proyecto.
```

