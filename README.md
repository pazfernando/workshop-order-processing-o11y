# Observability Business Case

Caso base para talleres técnicos senior sobre arquitectura serverless, resiliencia y observabilidad. Esta iteración mantiene el flujo funcional de procesamiento de órdenes y reemplaza la infraestructura SAM por Terraform para simplificar CI/CD y el control del estado de la infraestructura.

## Arquitectura

- Amazon API Gateway HTTP API expone `POST /orders` y `GET /orders/{orderId}`.
- Lambda `create-order` valida el payload, calcula `totalAmount`, persiste la orden en DynamoDB con estado `PENDING` y publica `OrderCreated` en EventBridge.
- Lambda `order-processor` consume el evento, mueve la orden a `PROCESSING`, invoca sincrónicamente al simulador de pago y actualiza el estado final.
- Lambda `payment-simulator` simula pagos con modos configurables para escenarios de falla.
- DynamoDB almacena el estado y atributos de la orden.
- CloudWatch Logs concentra logs JSON de cada Lambda y access logs del API.
- CloudWatch Metrics recibe métricas custom vía Embedded Metric Format (EMF) sin librerías adicionales.
- AWS X-Ray queda habilitado en las Lambdas para ver latencia y errores por función.

## Observabilidad implementada

- Correlación end-to-end con `x-correlation-id`, `requestId`, `awsRequestId` y `orderId`.
- Propagación de `correlationId` desde `POST /orders` hacia EventBridge, `order-processor` y `payment-simulator`.
- Logs JSON consistentes por servicio con contexto reutilizable.
- Métricas EMF para creación de órdenes, lecturas, órdenes procesadas, errores y latencia del simulador de pago.
- Retención explícita de CloudWatch Logs configurable desde Terraform.
- Access logs para API Gateway HTTP API.

Nota: esta solución usa API Gateway HTTP API. Esa variante no soporta tracing activo con X-Ray como sí ocurre con REST API, así que el API se observa mediante access logs; el tracing queda habilitado en las Lambdas.

## Estructura

```text
.
├── README.md
├── package.json
├── infra
│   └── terraform
│       ├── main.tf
│       ├── outputs.tf
│       └── variables.tf
├── scripts
│   ├── create-order.sh
│   ├── generate-load.sh
│   ├── get-order.sh
│   └── prepare-lambda-package.sh
└── src
    ├── order-api
    ├── order-processor
    ├── payment-simulator
    └── shared
```

## Requisitos

- Node.js 20.x
- Terraform CLI 1.6 o superior
- AWS CLI configurado con credenciales válidas

## Variables de despliegue

- `STACK_NAME`: prefijo para los recursos AWS. Default: `observability-business-case`
- `RESOURCE_PREFIX`: prefijo general opcional para namespacing de recursos. Default en CI/CD: el nombre del environment
- `AWS_REGION`: región de despliegue. Default: `us-east-1`
- `PAYMENT_FAILURE_MODE`: `none`, `always_fail`, `random_fail`, `slow_response`, `random_reject`
- `LOG_RETENTION_IN_DAYS`: retención de logs en CloudWatch. Default Terraform: `7`
- `METRICS_NAMESPACE`: namespace de métricas EMF. Default Terraform: `Workshop/OrderProcessing`
- `TF_STATE_BUCKET`: opcional. Si no se define en GitHub Actions, el workflow crea uno automáticamente
- `TF_STATE_KEY`: opcional. Default en CI/CD: `${environment}/${STACK_NAME}.tfstate`

## Despliegue local

### 1. Configurar credenciales AWS

Puedes usar AWS CLI:

```bash
aws configure
```

O variables de entorno:

```bash
export AWS_ACCESS_KEY_ID="<tu-access-key-id>"
export AWS_SECRET_ACCESS_KEY="<tu-secret-access-key>"
export AWS_REGION="us-east-1"
```

### 2. Configurar variables de despliegue

```bash
export STACK_NAME="observability-business-case"
export RESOURCE_PREFIX="aws-dev"
export AWS_REGION="us-east-1"
export PAYMENT_FAILURE_MODE="none"
export LOG_RETENTION_IN_DAYS="7"
export METRICS_NAMESPACE="Workshop/OrderProcessing"
```

Si quieres mantener estado remoto también localmente:

```bash
export TF_STATE_BUCKET="<tu-bucket-terraform-state>"
export TF_STATE_KEY="observability-business-case.tfstate"
```

### 3. Instalar dependencias y empaquetar Lambda

```bash
npm install
bash scripts/prepare-lambda-package.sh
```

### 4. Inicializar Terraform

Si usas estado remoto:

```bash
terraform -chdir=infra/terraform init -reconfigure \
  -backend-config="bucket=${TF_STATE_BUCKET}" \
  -backend-config="key=${TF_STATE_KEY:-${STACK_NAME}.tfstate}" \
  -backend-config="region=${AWS_REGION}"
```

Si trabajas localmente sin backend remoto:

```bash
terraform -chdir=infra/terraform init -backend=false
```

### 5. Aplicar infraestructura

```bash
terraform -chdir=infra/terraform apply \
  -var="aws_region=${AWS_REGION}" \
  -var="stack_name=${STACK_NAME}" \
  -var="resource_prefix=${RESOURCE_PREFIX}" \
  -var="payment_failure_mode=${PAYMENT_FAILURE_MODE}" \
  -var="log_retention_in_days=${LOG_RETENTION_IN_DAYS}" \
  -var="metrics_namespace=${METRICS_NAMESPACE}"
```

### 6. Obtener la URL del API

```bash
terraform -chdir=infra/terraform output -raw api_base_url
```

Exporta la URL:

```bash
export API_BASE_URL="$(terraform -chdir=infra/terraform output -raw api_base_url)"
```

Las rutas operativas son `${API_BASE_URL}/orders` y `${API_BASE_URL}/orders/{orderId}`.

## Destruir infraestructura

```bash
terraform -chdir=infra/terraform destroy \
  -var="aws_region=${AWS_REGION}" \
  -var="stack_name=${STACK_NAME}" \
  -var="resource_prefix=${RESOURCE_PREFIX}" \
  -var="payment_failure_mode=${PAYMENT_FAILURE_MODE}" \
  -var="log_retention_in_days=${LOG_RETENTION_IN_DAYS}" \
  -var="metrics_namespace=${METRICS_NAMESPACE}"
```

## CI/CD con GitHub Actions

El repositorio incluye tres workflows:

- [ci.yml](/Users/pazfernando/Documents/projects/windsurf/workshop-order-processing/.github/workflows/ci.yml): valida sintaxis JavaScript, empaqueta Lambda y ejecuta `terraform fmt` y `terraform validate`
- [deploy.yml](/Users/pazfernando/Documents/projects/windsurf/workshop-order-processing/.github/workflows/deploy.yml): despliega automáticamente a AWS cuando hay push a `main`, y permite ejecución manual con `workflow_dispatch`
- [teardown.yml](/Users/pazfernando/Documents/projects/windsurf/workshop-order-processing/.github/workflows/teardown.yml): destruye manualmente la infraestructura con `terraform destroy` usando el mismo backend remoto

### Secrets y variables requeridos en GitHub

Secrets:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_SESSION_TOKEN` si usas credenciales temporales de STS

Variables:

- `AWS_REGION`
- `STACK_NAME`
- `RESOURCE_PREFIX` opcional
- `PAYMENT_FAILURE_MODE`
- `TF_STATE_KEY` opcional

### Backend remoto de Terraform en GitHub Actions

En GitHub Actions el backend remoto no es opcional. El runner es efímero, así que el workflow asegura un bucket S3 para el estado antes de ejecutar `terraform init`.

Si `TF_STATE_BUCKET` no está definido, el workflow crea uno automáticamente en la cuenta destino con este patrón:

- `${resource_prefix}-${stack_name}-${account_id}-${aws_region}-tfstate`

Si ese nombre excede el límite de 63 caracteres de S3, el workflow lo recorta de forma determinística y agrega un hash corto para mantener unicidad.

Luego usa una key por environment:

- `${environment}/${STACK_NAME}.tfstate`

En este repositorio, para el environment `aws-dev`, la key por defecto queda:

- `aws-dev/observability-business-case.tfstate`

Y los recursos nombrados quedan con este patrón:

- `${RESOURCE_PREFIX}-${STACK_NAME}-...`

### Flujo de despliegue

1. Crear un branch y abrir Pull Request.
2. GitHub Actions ejecuta `CI`.
3. Al hacer merge a `main`, GitHub Actions ejecuta `Deploy`.
4. El workflow empaqueta la app, ejecuta `terraform init` y luego `terraform apply`.
5. Al final imprime `api_base_url` desde Terraform.

### Teardown manual

El workflow `Teardown` solo corre por `workflow_dispatch` y exige escribir el `STACK_NAME` exacto como confirmación.

Destruye los recursos Terraform, pero no elimina el bucket S3 del backend ni el objeto del `tfstate`.

## Permisos IAM mínimos sugeridos para el usuario de despliegue

El usuario o credencial usada en GitHub Actions debe poder operar al menos con:

- S3 para backend de estado de Terraform
- IAM
- Lambda
- API Gateway v2
- DynamoDB
- EventBridge
- CloudWatch Logs

## Probar el flujo

Crear una orden:

```bash
bash scripts/create-order.sh
```

Ejemplo `curl`:

```bash
curl -X POST "${API_BASE_URL}/orders" \
  -H "content-type: application/json" \
  -H "x-correlation-id: demo-001" \
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

## Qué observar en AWS

- CloudWatch Logs:
  - [infra/terraform/main.tf](/Users/pazfernando/Documents/projects/windsurf/workshop-order-processing/infra/terraform/main.tf) crea log groups dedicados para cada Lambda y para el access log del API.
  - Busca `correlationId`, `requestId` y `orderId` para seguir la ejecución completa.
- CloudWatch Metrics:
  - Namespace por defecto: `Workshop/OrderProcessing`
  - Métricas esperadas: `OrdersCreated`, `OrdersProcessed`, `OrderProcessorErrors`, `PaymentSimulationLatencyMs`, `CreateOrderLatencyMs`
- X-Ray:
  - Revisa los traces de las Lambdas `create-order`, `get-order`, `order-processor` y `payment-simulator`.
  - El API no emite traces X-Ray por ser HTTP API; usa el access log para ese borde.

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

## Comandos útiles

- Instalar dependencias: `npm install`
- Verificación rápida: `npm run check`
- Empaquetar Lambda: `npm run package:lambda`
- Formatear/verificar Terraform: `npm run terraform:fmt`
- Validar Terraform: `npm run terraform:validate`
