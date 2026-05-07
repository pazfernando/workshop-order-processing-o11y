# AGENTS.md

## Propósito del repositorio

Este repositorio contiene un caso de negocio base para talleres técnicos sobre AWS Serverless. La prioridad es mantener un flujo funcional, simple de explicar y fácil de extender con observabilidad en iteraciones posteriores.

## Cómo trabajar en este repo

- Mantener el MVP simple. No introducir Step Functions, SQS, Event Sourcing ni patrones adicionales salvo que el usuario lo pida explícitamente.
- Conservar la arquitectura actual basada en API Gateway, Lambda, DynamoDB, EventBridge y una Lambda separada para el simulador de pago.
- Favorecer cambios pequeños, legibles y fáciles de demostrar en un workshop.
- No agregar dependencias innecesarias.
- Mantener logs en JSON y evitar instrumentación avanzada hasta que se solicite.
- Preservar puntos claros para futuras extensiones de OpenTelemetry, tracing, métricas y correlación.

## Convenciones técnicas

- Runtime: Node.js 20.x
- IaC: AWS SAM
- SDK: AWS SDK v3
- Módulos JavaScript en CommonJS
- Scripts shell en `scripts/`
- Utilidades compartidas en `src/shared/`

## Comandos preferidos

- Instalar dependencias: `npm install`
- Verificación rápida: `npm run check`
- Validar plantilla SAM: `sam validate`
- Compilar aplicación: `sam build`
- Desplegar localmente: `bash scripts/deploy.sh`

## CI/CD

- La validación continua vive en `.github/workflows/ci.yml`
- El despliegue continuo vive en `.github/workflows/deploy.yml`
- El deploy en GitHub Actions usa `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY` desde GitHub Secrets
- Las variables de despliegue esperadas son `AWS_REGION`, `STACK_NAME` y `PAYMENT_FAILURE_MODE`

## Guía para cambios futuros

- Si se agrega observabilidad, hacerlo de forma incremental y sin romper el flujo funcional actual.
- Si se cambia el modelo de despliegue o autenticación AWS, actualizar también `README.md`, `scripts/deploy.sh` y los workflows de GitHub Actions.
- Si se agregan nuevos componentes AWS, documentar claramente el motivo y el impacto en el taller.

