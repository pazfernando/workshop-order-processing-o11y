# AGENTS.md

## Propósito del repositorio

Este repositorio contiene un caso de negocio base para talleres técnicos sobre AWS Serverless. La prioridad es mantener un flujo funcional, simple de explicar y fácil de extender con observabilidad en iteraciones posteriores.

## Cómo trabajar en este repo

- Mantener el MVP simple. No introducir Step Functions, SQS, Event Sourcing ni patrones adicionales salvo que el usuario lo pida explícitamente.
- Conservar la arquitectura actual basada en API Gateway, Lambda, DynamoDB, EventBridge y una Lambda separada para el simulador de pago.
- Favorecer cambios pequeños, legibles y fáciles de demostrar en un workshop.
- No agregar dependencias innecesarias.
- Mantener logs en JSON.
- La convención de observabilidad es `otel-first`: nueva instrumentación de trazas, métricas y correlación debe diseñarse primero con OpenTelemetry y no acoplarse a un backend específico.
- CloudWatch sigue siendo el backend de observabilidad por defecto en AWS, pero la instrumentación debe permitir exportar las mismas señales a terceros en el futuro, por ejemplo Datadog, Grafana Cloud o Prometheus, con cambios mínimos fuera de la capa de exportación.
- Favorecer una capa compartida de observabilidad en `src/shared/observability.js` para centralizar inicialización, nombres de métricas, atributos comunes, correlación y la estrategia de exportación.
- Preservar puntos claros para futuras extensiones con OpenTelemetry SDK, OTLP y Collector sin romper el flujo funcional actual.
- Si se agrega, renombra o elimina una métrica emitida por la aplicación, actualizar en el mismo cambio el catálogo de métricas en `README.md` y la sección `Collected Business Metrics` del artifact generado por `.github/workflows/deploy.yml`.

## Convenciones técnicas

- Runtime: Node.js 20.x
- IaC: Terraform
- SDK: AWS SDK v3
- Módulos JavaScript en CommonJS
- Scripts shell en `scripts/`
- Utilidades compartidas en `src/shared/`

## Comandos preferidos

- Instalar dependencias: `npm install`
- Verificación rápida: `npm run check`
- Empaquetar Lambdas: `bash scripts/prepare-lambda-package.sh`
- Validar Terraform: `terraform -chdir=infra/terraform init -backend=false && terraform -chdir=infra/terraform validate`
- Formatear Terraform: `terraform -chdir=infra/terraform fmt -recursive`
- Desplegar localmente: `terraform -chdir=infra/terraform apply`

## CI/CD

- La validación continua vive en `.github/workflows/ci.yml`
- El despliegue continuo vive en `.github/workflows/deploy.yml`
- La destrucción manual vive en `.github/workflows/teardown.yml`
- El deploy en GitHub Actions usa `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY` desde GitHub Secrets
- Las variables de despliegue esperadas son `AWS_REGION`, `STACK_NAME`, `RESOURCE_PREFIX`, `PAYMENT_FAILURE_MODE`, `TF_STATE_BUCKET` y `TF_STATE_KEY`

## Guía para cambios futuros

- Si se agrega o migra observabilidad, hacerlo de forma incremental y sin romper el flujo funcional actual.
- Priorizar estándares semánticos de OpenTelemetry cuando aplique, especialmente para HTTP, AWS SDK y dependencias.
- Evitar que el código de negocio dependa directamente de CloudWatch EMF, X-Ray o vendors específicos; encapsular esas decisiones en la capa compartida de observabilidad.
- Si en una iteración futura se incorpora OpenTelemetry Collector, usarlo como punto de consolidación y enrutamiento para exportar a CloudWatch y a vendors externos sin reescribir la instrumentación de la aplicación.
- Si se cambia el modelo de despliegue o autenticación AWS, actualizar también `README.md`, `infra/terraform/*`, `scripts/prepare-lambda-package.sh` y los workflows de GitHub Actions.
- Si se agregan nuevos componentes AWS, documentar claramente el motivo y el impacto en el taller.
- `README.md` es la referencia operativa principal del repositorio; no mantener documentos transitorios paralelos.
