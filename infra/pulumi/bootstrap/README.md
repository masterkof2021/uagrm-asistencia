# Backend S3 compartido de Pulumi

Proyecto independiente `asistencia-state-backend`, stack `shared`, que administra seis recursos S3 protegidos contra eliminación. El laboratorio sigue en el proyecto `asistencia-infra`, stack `lab`.

| Dato | Valor |
| --- | --- |
| Cuenta | `222234418877` |
| Región | `us-east-2` |
| Bucket | `globomatics-pulumi-state-222234418877-us-east-2` |
| Backend de ambos proyectos | `s3://globomatics-pulumi-state-222234418877-us-east-2/globomatics?region=us-east-2` |
| Estado del laboratorio | `globomatics/.pulumi/stacks/asistencia-infra/lab.json` |
| Estado del bucket | `globomatics/.pulumi/stacks/asistencia-state-backend/shared.json` |

El bucket tiene versionado, cifrado SSE-S3 (AES256), los cuatro bloqueos de acceso público, ACL deshabilitadas y una política que rechaza tráfico sin HTTPS. El bucket y sus controles tienen `protect: true`, y `forceDestroy` permanece en `false`. Destruir el stack `lab` no elimina el backend. Retirar el backend requiere una operación administrativa independiente y una migración previa de sus estados.

Pulumi administra los bloqueos por stack en `.pulumi/locks/` y el historial en `.pulumi/history/`. No hace falta DynamoDB ni S3 Object Lock. Object Lock no debe confundirse con el bloqueo de operaciones de Pulumi: una retención de objetos podría impedir actualizar estados o eliminar bloqueos.

## Incorporar un compañero

Necesita el mismo código actualizado, Node.js >=22, npm, Pulumi CLI y su propia identidad AWS autorizada. El administrador debe concederle acceso al bucket y los permisos AWS de los recursos que administrará. No se crearon usuarios, claves ni concesiones de acceso a identidades concretas durante esta implementación.

El acceso habitual al backend requiere `s3:GetBucketLocation` y `s3:ListBucket` sobre este bucket, más `s3:GetObject`, `s3:PutObject` y `s3:DeleteObject` sobre su prefijo `globomatics/`. Limitar estos permisos a la cuenta y al bucket/prefijo autorizados; para separar operadores del laboratorio y administradores del backend, restringir además los archivos de cada proyecto en `stacks/`, `locks/`, `history/` y los metadatos necesarios. Consultar los nombres reales en S3 antes de aprobar la política. Leer versiones antiguas para recuperación requiere permisos adicionales de versionado. Los permisos de S3 no sustituyen los de EC2, redes, Resource Groups o administración del propio bucket.

Los secretos del stack conservan cifrado por contraseña. Recibir la contraseña existente por un canal seguro y guardarla en `infra/pulumi/.pulumi/passphrase` con permisos `600`, o indicar un archivo externo mediante `PULUMI_CONFIG_PASSPHRASE_FILE`. La contraseña y las claves SSH privadas no se guardan en S3 ni en Git. El adaptador no genera una contraseña nueva para un stack existente.

Desde `asistencia/infra/pulumi`:

```bash
npm ci
npm run check
npm test

# Usar el perfil personal autorizado, con sesión vigente de AWS CLI.
python3 scripts/aws-session.py --profile mi-perfil pulumi stack select lab
# Recuperar la configuración vigente y los metadatos de cifrado desde S3.
python3 scripts/aws-session.py --profile mi-perfil pulumi config refresh --force
python3 scripts/aws-session.py --profile mi-perfil pulumi preview
python3 scripts/aws-session.py --profile mi-perfil pulumi up
python3 scripts/aws-session.py --profile mi-perfil pulumi stack output servers
```

Seleccionar el stack existente; no ejecutar `stack init lab` ni importar otra copia de estado. Mantener código y configuración sincronizados antes de aplicar. Si otra operación tiene el bloqueo, esperar y comprobar quién está trabajando antes de cancelar o retirar un bloqueo. `PULUMI_BACKEND_URL` sobrescribe la configuración del proyecto: evitar un valor local antiguo en el entorno.

## Administración del bucket

Se usan las dependencias del proyecto padre. Desde `asistencia/infra/pulumi`:

```bash
python3 scripts/aws-session.py pulumi stack select shared --cwd bootstrap
python3 scripts/aws-session.py pulumi config refresh --cwd bootstrap --force
python3 scripts/aws-session.py pulumi preview --cwd bootstrap --stack shared
```

Modificar `bootstrap/index.ts`, revisar el preview y aplicar únicamente con la identidad administradora autorizada. Mantener respaldos privados mediante `pulumi stack export`, además del versionado S3. Un backend que almacena su propio estado necesita especial cuidado al retirarse: migrar primero ambos stacks a otro backend. Las copias locales previas a la migración son solo respaldos y no deben usarse para nuevas actualizaciones.

## Migración realizada

El 20 de octubre de 2026 se respaldó el estado local y se creó este bucket con Pulumi. Se migraron `asistencia-infra/lab` y `asistencia-state-backend/shared` con `pulumi stack migrate --secrets-provider passphrase`, conservando los identificadores de los recursos. El backend activo se fija en el `Pulumi.yaml` de cada proyecto. Los respaldos privados previos y posteriores se conservan dentro de `../.pulumi/`.

La contraseña de cifrado se conserva separada del estado remoto. Perderla impide descifrar secretos; respaldarla por un medio seguro. La migración no transfiere el historial local anterior; S3 conserva los checkpoints migrados y las operaciones posteriores.

## Validación

Se compararon los inventarios antes y después: los 18 recursos AWS del laboratorio y los seis del backend conservan sus identificadores. Ambos stacks pasaron `refresh --expect-no-changes` y `preview --expect-no-changes` usando S3. Se verificó el acceso desde un cliente sin estado local y la recuperación de su configuración con `config refresh`. Las pruebas de infraestructura y de seguridad del bucket pasan, y TypeScript compila.

El backend local anterior se archivó en `../.pulumi/local-state-before-s3-2026-10-20/`; es un respaldo, no un backend activo. Se conservaron exports privados de ambos stacks antes y después de la migración.

## Costos y observabilidad

S3 cobra por almacenamiento, solicitudes y las versiones retenidas. El versionado aumenta el almacenamiento con el tiempo; no se configuró expiración automática para conservar capacidad de recuperación. No se añadió DynamoDB ni una clave KMS administrada por el cliente. Consultar [precios de S3](https://aws.amazon.com/s3/pricing/) antes de fijar una política de retención.

Para una auditoría más completa, se recomienda habilitar eventos de datos de CloudTrail, registros de acceso S3 y métricas/alertas de CloudWatch. Requieren configuración y costos adicionales; no se crearon destinos de registros ni un trail como parte de este bucket.

Documentación: [backends de Pulumi](https://www.pulumi.com/docs/iac/concepts/state-and-backends/), [backend S3 y bloqueos](https://www.pulumi.com/docs/iac/operations/stack-management/using-a-diy-backend/), [seguridad S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html).
