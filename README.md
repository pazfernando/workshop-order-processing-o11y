# Observability Business Case

Caso base para talleres técnicos senior sobre arquitectura serverless, resiliencia y observabilidad. Esta primera iteración implementa un flujo funcional de procesamiento de órdenes en AWS sin OpenTelemetry ni instrumentación avanzada, dejando puntos claros para agregarlos después.

## Arquitectura

- Amazon API Gateway HTTP API expone `POST /orders` y `GET /orders/{orderId}`.
- Lambda `CreateOrderFunction` valida el payload, calcula `totalAmount`, persiste la orden en DynamoDB con estado `PENDING` y publica `OrderCreated` en EventBridge.
- Lambda `OrderProcessorFunction` consume el evento, mueve la orden a `PROCESSING`, invoca sincrónicamente a `PaymentSimulatorFunction` y actualiza el estado final.
- Lambda `PaymentSimulatorFunction` simula pagos con modos configurables para escenarios de falla.
- DynamoDB `Orders` almacena el estado y atributos de la orden.

## Estructura

```text
.
├── README.md
├── package.json
├── template.yaml
├── scripts
│   ├── cleanup.sh
│   ├── create-order.sh
│   ├── deploy.sh
│   ├── generate-load.sh
│   └── get-order.sh
└── src
    ├── order-api
    │   ├── create-order.js
    │   └── get-order.js
    ├── order-processor
    │   └── process-order-created.js
    ├── payment-simulator
    │   └── process-payment.js
    └── shared
        ├── errors.js
        ├── logger.js
        ├── response.js
        └── validation.js
```

## Requisitos

- Node.js 20.x
- AWS SAM CLI
- AWS CLI configurado con credenciales válidas

## Despliegue local

### 1. Configurar credenciales AWS localmente

Antes de desplegar, el entorno local debe tener credenciales válidas. La forma más simple es configurar AWS CLI:

```bash
aws configure
```

Esto pedirá:

- `AWS Access Key ID`
- `AWS Secret Access Key`
- región por defecto, por ejemplo `us-east-1`
- formato de salida, por ejemplo `json`

Alternativamente, puedes exportarlas por variables de entorno:

```bash
export AWS_ACCESS_KEY_ID="<tu-access-key-id>"
export AWS_SECRET_ACCESS_KEY="<tu-secret-access-key>"
export AWS_REGION="us-east-1"
```

### 2. Variables opcionales del despliegue

Instala dependencias y despliega la solución:

```bash
export STACK_NAME=observability-business-case
export AWS_REGION=us-east-1
export PAYMENT_FAILURE_MODE=none
```

### 3. Ejecutar el despliegue

```bash
cd /Users/pazfernando/Documents/workshop-order-processing
bash scripts/deploy.sh
```

El script realiza:

- `npm install`
- `sam build`
- `sam deploy`

### 4. Obtener la URL del API

```bash
aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" \
  --output text
```

Exporta la URL:

```bash
export API_BASE_URL="https://xxxx.execute-api.us-east-1.amazonaws.com"
```

Nota: el `Output` devuelve la base del HTTP API. Las rutas operativas son `${API_BASE_URL}/orders` y `${API_BASE_URL}/orders/{orderId}`.

## CI/CD con GitHub Actions

El repositorio incluye despliegue automatizado a AWS mediante GitHub Actions.

Se agregaron dos workflows:

- `CI`: valida sintaxis JavaScript, ejecuta `sam validate` y `sam build`.
- `Deploy`: despliega automáticamente a AWS cuando hay push a `main`, y también permite ejecución manual con `workflow_dispatch`.

Archivos:

- [ci.yml](/Users/pazfernando/Documents/workshop-order-processing/.github/workflows/ci.yml)
- [deploy.yml](/Users/pazfernando/Documents/workshop-order-processing/.github/workflows/deploy.yml)

### Cómo se autentica GitHub Actions en AWS

El workflow `Deploy` usa este paso:

```yaml
uses: aws-actions/configure-aws-credentials@v4
```

Y toma las credenciales desde GitHub Secrets:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Esas access keys pertenecen a un usuario IAM o credencial equivalente con permisos para desplegar el stack.

### Secrets y variables requeridos en GitHub

Secrets del repositorio o del environment:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Variables recomendadas del repositorio o del environment:

- `AWS_REGION`
- `STACK_NAME`
- `PAYMENT_FAILURE_MODE`

El workflow de deploy usa el environment `aws-dev`. Si prefieres otro nombre, ajusta [deploy.yml](/Users/pazfernando/Documents/workshop-order-processing/.github/workflows/deploy.yml).

### Cómo configurarlo en GitHub

1. Ir a `GitHub Repository > Settings > Secrets and variables > Actions`.
2. Crear los secrets `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY`.
3. Crear las variables `AWS_REGION`, `STACK_NAME` y opcionalmente `PAYMENT_FAILURE_MODE`.
4. Si quieres usar GitHub Environments, crear el environment `aws-dev` y mover allí esos secrets y variables.

### Flujo de ejecución recomendado

1. Crear un branch y abrir Pull Request.
2. GitHub Actions ejecuta `CI`.
3. Al hacer merge a `main`, GitHub Actions ejecuta `Deploy`.
4. El workflow compila la app y ejecuta `bash scripts/deploy.sh`.
5. Al final imprime la URL del API creada por CloudFormation.

### Despliegue manual desde GitHub Actions

También puedes lanzar el workflow manualmente:

1. Ir a `Actions`.
2. Seleccionar `Deploy`.
3. Ejecutar `Run workflow`.
4. Elegir opcionalmente `payment_failure_mode`.

### Permisos IAM mínimos sugeridos para el usuario de despliegue

El usuario cuyas access keys uses en GitHub debe poder operar al menos con:

- CloudFormation
- S3 para artefactos de SAM
- Lambda
- IAM para crear roles de ejecución de Lambda
- API Gateway
- DynamoDB
- EventBridge
- CloudWatch Logs

Para un laboratorio interno se puede empezar con permisos amplios controlados por cuenta o environment, pero para producción conviene endurecer esta política.

Modos disponibles para `PAYMENT_FAILURE_MODE`:

- `none`
- `always_fail`
- `random_fail`
- `slow_response`
- `random_reject`

## Probar el flujo

Crear una orden:

```bash
bash scripts/create-order.sh
```

Ejemplo `curl`:

```bash
curl -X POST "${API_BASE_URL}/orders" \
  -H "content-type: application/json" \
  --data '{
    "customerId": "customer-001",
    "items": [
      {
        "sku": "SKU-001",
        "quantity": 2,
        "unitPrice": 25.5
      }
    ],
    "currency": "USD"
  }'
```

Respuesta esperada:

```json
{
  "orderId": "generated-id",
  "status": "PENDING"
}
```

Consultar una orden:

```bash
bash scripts/get-order.sh <orderId>
```

Ejemplo `curl`:

```bash
curl "${API_BASE_URL}/orders/<orderId>"
```

Respuesta esperada:

```json
{
  "orderId": "generated-id",
  "customerId": "customer-001",
  "items": [
    {
      "sku": "SKU-001",
      "quantity": 2,
      "unitPrice": 25.5
    }
  ],
  "currency": "USD",
  "totalAmount": 51,
  "status": "APPROVED",
  "paymentStatus": "APPROVED",
  "createdAt": "2026-05-07T00:00:00.000Z",
  "updatedAt": "2026-05-07T00:00:05.000Z",
  "processingAttempts": 1
}
```

Generar varias órdenes:

```bash
bash scripts/generate-load.sh 20
```

## Limpieza

```bash
bash scripts/cleanup.sh
```

## Flujo funcional implementado

1. Cliente envía `POST /orders`.
2. La Lambda de API valida el payload y calcula `totalAmount`.
3. La orden se guarda en DynamoDB con estado `PENDING`.
4. Se publica el evento `OrderCreated` en EventBridge.
5. EventBridge activa `OrderProcessorFunction`.
6. El procesador mueve la orden a `PROCESSING`.
7. El procesador invoca `PaymentSimulatorFunction`.
8. La orden termina en `APPROVED`, `REJECTED` o `FAILED`.
9. Cliente consulta el estado por `GET /orders/{orderId}`.

## Manejo básico de errores y diseño para siguientes iteraciones

- Validación explícita de payload y cálculo de `totalAmount` en backend.
- Logs JSON simples para facilitar futuras búsquedas e instrumentación.
- Idempotencia básica en el procesador usando transición condicional `PENDING -> PROCESSING`.
- Fallas inesperadas en procesamiento se reflejan como `FAILED`.
- El código está separado en módulos para facilitar agregar OpenTelemetry, tracing, métricas y correlación en una siguiente iteración.

## Comandos útiles

Validar plantilla:

```bash
sam validate
```

Construir:

```bash
sam build
```

Ejecutar solo chequeos locales rápidos:

```bash
npm install
npm run check
```

## Archivo AGENTS.md

El repositorio ahora incluye [AGENTS.md](/Users/pazfernando/Documents/workshop-order-processing/AGENTS.md) para dejar explícitas las reglas operativas del proyecto para Codex y otros agentes. Si cambias la arquitectura, CI/CD o el modelo de despliegue, conviene actualizar ese archivo junto con este README.

## Próximos pasos sugeridos

- Agregar tracing distribuido con OpenTelemetry en las tres Lambdas.
- Incorporar propagación de contexto entre API, EventBridge y Lambda invocada.
- Estandarizar atributos de logs para correlación por `orderId`, `eventId` y `requestId`.
- Exponer métricas de negocio y técnicas: órdenes creadas, aprobadas, rechazadas, latencia y errores.
- Añadir dashboards y ejercicios controlados de resiliencia usando los modos del simulador de pago.
