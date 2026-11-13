# Plataforma de tenants

El panel local permite elegir entre tres planes, registrar una institución y consultar el registro por nombre o identificador, plan, entorno y estado. La API guarda los registros en SQLite con un identificador único y conserva la configuración del plan elegida al registrar cada tenant.

## Ejecutar en local

Requiere Node.js 24 o posterior. Desde la raíz del repositorio ejecuta:

```powershell
npm.cmd --prefix plataforma start
```

Abre [http://127.0.0.1:4173](http://127.0.0.1:4173). El servicio escucha únicamente en la interfaz local. Los registros se guardan en `plataforma/data/tenants.sqlite`, fuera de Git. Las variables `PORT` y `TENANTS_DB` permiten seleccionar otro puerto o ruta de SQLite.

Selecciona un plan y comprueba la memoria y el almacenamiento de las tres capas en el resumen. El entorno inicial es **Pruebas** y el motor inicial es **OpenTofu**. Las capacidades y los límites de estudiantes del catálogo son valores iniciales para la demo. El estado **Registrado** indica que el tenant está pendiente de aprovisionamiento. El panel está diseñado para un operador en su equipo local.

## Despliegue desde el panel

El panel usa AWS CLI y un perfil que asume el rol `pfm2-panel-deploy`. El rol y el límite de permisos de las instancias se definen en [panel-iam.yaml](../infra/opentofu/panel-iam.yaml). Con el rol disponible, configura el perfil con el usuario IAM autorizado como origen y valida la identidad antes de habilitar el ejecutor. Instala OpenTofu para tenants de ese motor. [Perfiles de rol de AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-role.html).

```powershell
aws sts get-caller-identity --profile pfm2-deploy
$env:PFM2_DEPLOY_PROFILE = 'pfm2-deploy'
$env:PFM2_AWS_ACCOUNT = '487450071663'
$env:PFM2_STATE_BUCKET = 'pfm2-state-487450071663-us-east-2'
npm.cmd --prefix plataforma start
```

En **Tenants**, elige **Desplegar en AWS** en un registro de OpenTofu. El botón crea recursos facturables. La tabla muestra la cola, el plan, el aprovisionamiento y la verificación por Systems Manager. El tenant pasa a **Operativo** cuando se comprueban sus tres servicios. Si falla, **Reintentar en AWS** usa la misma clave de estado en S3 y la AMI fijada para el tenant. Los intentos anteriores quedan en el historial.

Para un tenant de CloudFormation, usa el mismo flujo. El estado queda en la pila del tenant y el panel guarda su ARN, los recursos de las tres capas y la huella de la plantilla. [Operación con CloudFormation](../infra/cloudformation/README.md).

Terraform usa el módulo HCL compartido y un estado propio en S3. Pulumi usa un programa JavaScript y una pila con estado en S3. Instala la CLI del motor que vas a seleccionar y, para Pulumi, sus dependencias Node. [Operación con Terraform](../infra/terraform/README.md) · [Operación con Pulumi](../infra/pulumi/README.md).

El estado se almacena en `tenants/panel/<tenant>/terraform.tfstate`. La copia local de cada intento de despliegue y sus planes quedan fuera de Git, en `data/despliegues/<tenant>/<id>/infra/opentofu`. Conserva esa carpeta para que el panel pueda operar el despliegue.

Con los permisos `ec2:StopInstances` y `ec2:StartInstances`, **Suspender** detiene las tres EC2 y conserva sus discos EBS. El almacenamiento sigue facturándose durante la suspensión. **Reanudar** enciende las mismas instancias y comprueba Nginx, la API y MySQL antes de marcar el tenant como **Operativo**. Si AWS deja una operación a medias, el reintento actúa sobre las instancias que todavía requieren el cambio. [Detención y arranque de Amazon EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Stop_Start.html).

**Preparar retiro** genera un plan de destrucción para un tenant operativo o suspendido. En **Revisar retiro** puedes ver los recursos y discos afectados, incluido el disco con los registros de MySQL. **Cancelar retiro** devuelve el tenant a su estado previo. **Confirmar retiro** ejecuta el plan revisado y conserva en SQLite el historial del tenant. Si cambió el plan o se agregaron discos fuera de OpenTofu, el panel pide revisar el entorno antes de continuar.

Con `PFM2_MONITORING=1`, la vista **Tenants** muestra las alertas activas y el historial reciente de detecciones y resoluciones, y enlaza al dashboard de Grafana. [Arranque de la observabilidad](../observabilidad/README.md).

## API local

| Método y ruta | Operación |
| --- | --- |
| `GET /api/catalogo` | Planes, región, entornos y motores. |
| `GET /api/tenants` | Listar registros. Acepta `buscar`, `plan`, `entorno` y `estado`. |
| `POST /api/tenants` | Registrar a partir de `nombre`, `identificador`, `correo`, `entorno`, `plan` y `motor`. |
| `POST /api/tenants/<tenant>/despliegues` | Poner un despliegue en cola con el ejecutor habilitado. |
| `POST /api/tenants/<tenant>/suspender` | Detener las EC2 de un tenant operativo. |
| `POST /api/tenants/<tenant>/reanudar` | Encender las EC2 de un tenant suspendido. |
| `POST /api/tenants/<tenant>/preparar-retiro` | Generar el plan y el inventario de retiro. |
| `POST /api/tenants/<tenant>/cancelar-retiro/<revision>` | Cancelar la revisión vigente. |
| `POST /api/tenants/<tenant>/retirar/<revision>` | Confirmar y encolar el retiro de la revisión vigente. |
| `GET /api/tenants/<tenant>/despliegues` | Consultar el historial, la fase y el resultado de cada operación. |
| `GET /metrics` | Exponer la última muestra en formato Prometheus con el monitor habilitado. |
| `GET /api/alertas` | Consultar alertas activas de Prometheus con el monitor habilitado. |
| `GET /api/alertas/resumen` | Consultar alertas activas, estado de la fuente y eventos de las últimas 24 horas con el monitor habilitado. |

```powershell
npm.cmd --prefix plataforma test
```

Las pruebas ejercitan la API real en un puerto temporal, incluidos los conflictos de identificador, la persistencia al reabrir SQLite y los filtros.
