# Deployment Profile

Este documento describe **cómo queda desplegada la solución por defecto** cuando se usa el workflow del repositorio sin overrides adicionales.

No describe la arquitectura objetivo ideal, sino el **estado operativo real** que SRE / DevOps debe asumir si solo ejecuta el deployment estándar.

## Perfil por defecto del workflow

### Inicialización de OpenTelemetry

| Variable | Valor por defecto | Estado resultante |
| :--- | :--- | :--- |
| `OTEL_MODE` | `code` | La Lambda intenta inicializar OTel desde `src/shared/otel-bootstrap.js` |
| `ADOT_LAMBDA_LAYER_ARN` | vacío | No se adjunta ADOT Lambda Layer |

Resultado:

- el deployment por defecto **no usa `adot_layer`**
- el bootstrap de OTel queda en el código

### Ruta de exportación

| Variable | Valor por defecto | Estado resultante |
| :--- | :--- | :--- |
| `OTEL_EXPORT_STRATEGY` | `direct` | No se espera un Collector como dependencia obligatoria |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | vacío | No hay endpoint OTLP directo configurado |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | vacío | Sin override de trazas |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | vacío | Sin override de métricas |
| `OTEL_COLLECTOR_ENDPOINT` | vacío | Collector no usado |

Resultado:

- el deployment por defecto **no usa Collector**
- el deployment por defecto **no exporta OTLP a ningún backend**
- con `OTEL_MODE=code`, dejar `direct` sin endpoints no infiere CloudWatch y mantiene OTLP inactivo

## Qué observabilidad queda activa realmente

Aunque el código ya está preparado con abstracciones `otel-first`, con el perfil por defecto la observabilidad efectiva sigue siendo:

| Señal | Mecanismo activo por defecto |
| :--- | :--- |
| Logs | CloudWatch Logs |
| Métricas de negocio actuales | EMF hacia CloudWatch Metrics |
| Trazas AWS Lambda | X-Ray |
| Exportación OTLP | Inactiva por falta de endpoint |
| Collector | Inactivo / no requerido |
| ADOT Layer | Inactivo / no adjunto |

## Variables efectivas por defecto

| Variable | Valor por defecto |
| :--- | :--- |
| `STACK_NAME` | `observability-business-case` |
| `RESOURCE_PREFIX` | `aws-dev` en GitHub Actions |
| `AWS_REGION` | `us-east-1` |
| `PAYMENT_FAILURE_MODE` | `none` |
| `LOG_RETENTION_IN_DAYS` | `7` |
| `METRICS_NAMESPACE` | `Workshop/OrderProcessing` |
| `OTEL_MODE` | `code` |
| `OTEL_EXPORT_STRATEGY` | `direct` |
| `ADOT_LAMBDA_LAYER_ARN` | vacío |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | vacío |
| `OTEL_COLLECTOR_ENDPOINT` | vacío |
| `OBSERVABILITY_EMF_COMPATIBILITY_MODE` | `true` |
| `CREATE_OBSERVABILITY_DASHBOARD` | `true` |
| `CREATE_OBSERVABILITY_ALARMS` | `true` |

## Qué cambia si SRE / DevOps aplica overrides

### Caso 1: activar exportación OTLP directa

Debes definir:

```text
OTEL_MODE=code
OTEL_EXPORT_STRATEGY=direct
OTEL_EXPORTER_OTLP_ENDPOINT=https://...
```

Resultado:

- la app sigue inicializando OTel desde código
- las Lambdas exportan OTLP directo al backend configurado
- este caso es para backends OTLP que no dependen de SigV4

### Caso 1b: activar CloudWatch directo con ADOT Layer

Debes definir:

```text
OTEL_MODE=adot_layer
OTEL_EXPORT_STRATEGY=direct
ADOT_LAMBDA_LAYER_ARN=arn:aws:lambda:...
OTEL_EXPORTER_OTLP_ENDPOINT=
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=
```

Resultado:

- el Layer ADOT inicializa OTel antes del handler
- Terraform infiere `https://xray.<region>.amazonaws.com/v1/traces`
- Terraform infiere `https://monitoring.<region>.amazonaws.com/v1/metrics`
- la ruta directa depende de autenticación `SigV4`
- el wrapper efectivo esperado para este repo Node.js es `/opt/otel-handler`
- Terraform adjunta `CloudWatchLambdaApplicationSignalsExecutionRolePolicy` a los execution roles

### Caso 2: activar Collector

Debes definir:

```text
OTEL_MODE=code
OTEL_EXPORT_STRATEGY=collector
OTEL_COLLECTOR_ENDPOINT=http://collector.internal:4318
```

Resultado:

- la app sigue inicializando OTel desde código
- las Lambdas exportan OTLP al Collector

### Caso 3: activar ADOT Layer + Collector

Debes definir:

```text
OTEL_MODE=adot_layer
ADOT_LAMBDA_LAYER_ARN=arn:aws:lambda:...
OTEL_EXPORT_STRATEGY=collector
OTEL_COLLECTOR_ENDPOINT=http://collector.internal:4318
```

Resultado:

- la app deja de ser responsable del bootstrap del SDK
- el Layer ADOT inicializa OTel antes del handler
- las Lambdas exportan OTLP al Collector

## Recomendación operativa actual

### Para operar el repo hoy sin agregar infraestructura extra

Asumir este perfil:

```text
OTEL_MODE=code
OTEL_EXPORT_STRATEGY=direct
OTEL_EXPORTER_OTLP_ENDPOINT=
OBSERVABILITY_EMF_COMPATIBILITY_MODE=true
```

Interpretación:

- la convención de diseño es `otel-first`
- pero la operación efectiva sigue descansando en CloudWatch Logs, EMF y X-Ray
- OTLP directo a CloudWatch no se infiere en este perfil porque el bootstrap sigue en código

### Para avanzar a una operación más madura

La siguiente transición recomendada es:

```text
OTEL_MODE=adot_layer
OTEL_EXPORT_STRATEGY=collector
ADOT_LAMBDA_LAYER_ARN=...
OTEL_COLLECTOR_ENDPOINT=http://collector.internal:4318
```

Interpretación:

- el bootstrap queda fuera del código
- el Collector se vuelve el punto central de enrutamiento
- CloudWatch y terceros pasan a ser destinos del Collector, no contratos de la app
