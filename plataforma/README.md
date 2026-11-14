# Plataforma de tenants

El panel local permite elegir entre tres planes, registrar una institución y consultar el registro por nombre o identificador, plan, entorno y estado. La API guarda los registros en SQLite con un identificador único y conserva la configuración del plan elegida al registrar cada tenant.

## Ejecutar en local

Requiere Node.js 24 o posterior. Elige un usuario para el administrador del panel y una contraseña de 12 a 256 caracteres. Desde la raíz del repositorio, introduce la contraseña con el indicador de PowerShell.

```powershell
$env:PFM2_ADMIN_USUARIO = 'operador'
$env:PFM2_ADMIN_CLAVE = [Net.NetworkCredential]::new('', (Read-Host 'Contraseña del panel' -AsSecureString)).Password
try {
  npm.cmd --prefix plataforma start
} finally {
  Remove-Item Env:PFM2_ADMIN_CLAVE -ErrorAction SilentlyContinue
}
```

Abre el panel e inicia sesión. La sesión vence a las ocho horas o al reiniciar el proceso. El servicio escucha únicamente en la interfaz local. Los registros y la auditoría se guardan en `plataforma/data/tenants.sqlite`, fuera de Git. Las variables `PORT` y `TENANTS_DB` permiten seleccionar otro puerto o ruta de SQLite. [Panel local](http://127.0.0.1:4173)

En **Tenants → Ver actividad**, la sección **Actividad del operador** muestra quién registró el tenant o solicitó cada operación, su fecha en Bolivia y el número de trabajo cuando corresponde. La auditoría conserva las atribuciones registradas previamente.

Selecciona un plan y comprueba la memoria y el almacenamiento de las tres capas en el resumen. El entorno inicial es **Pruebas** y el motor inicial es **OpenTofu**. Las capacidades y los límites de estudiantes del catálogo son valores iniciales para la demo. El estado **Registrado** indica que el tenant está pendiente de aprovisionamiento. El panel está diseñado para un operador en su equipo local.

## Despliegue desde el panel

Configura primero las credenciales locales del panel en la misma terminal.

Para probar el arranque con Ansible, inicia el panel con `PFM2_ANSIBLE=1` y `PFM2_AMI_ID` apuntando a la AMI privada de Packer. Registra un tenant nuevo para el ensayo. El panel fija el modo de arranque y la imagen en el directorio del tenant y los incluye en el historial al verificar los servicios. [Construcción de la AMI](../infra/packer/README.md).

Cloud-init ejecuta Ansible Core 2.20.1 localmente en cada EC2. Los playbooks están en [cloud-init](../infra/opentofu/cloud-init/). El del frontend configura el proxy y los archivos estáticos con módulos de Ansible. Los de la API y MySQL ejecutan la inicialización existente cuando falta el archivo que indica que terminó y habilitan el servicio. Los valores de arranque llegan desde Parameter Store o Secrets Manager según el motor. [Conexión local de Ansible](https://docs.ansible.com/projects/ansible-core/2.20/collections/ansible/builtin/local_connection.html).

El 13 de noviembre de 2026, el panel desplegó el tenant Básico `ansible-basico-20261113031235` con OpenTofu y la AMI privada de Packer. Las tres EC2 ejecutaron sus playbooks al primer arranque y el panel confirmó MySQL, la API y Nginx sin intervención en las instancias. Las sondas del panel comprobaron HTTP 200 en la portada y HTTP 401 en la API sin sesión. El historial registró el modo `ansible` y la AMI.

El panel usa AWS CLI y un perfil que asume el rol `pfm2-panel-deploy`. El rol y el límite de permisos de las instancias se definen en [panel-iam.yaml](../infra/opentofu/panel-iam.yaml). Con el rol disponible, configura el perfil con el usuario IAM autorizado como origen y valida la identidad antes de habilitar el ejecutor. Instala OpenTofu para tenants de ese motor. [Perfiles de rol de AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-role.html).

```powershell
aws sts get-caller-identity --profile pfm2-deploy
$env:PFM2_DEPLOY_PROFILE = 'pfm2-deploy'
$env:PFM2_AWS_ACCOUNT = '487450071663'
$env:PFM2_STATE_BUCKET = 'pfm2-state-487450071663-us-east-2'
npm.cmd --prefix plataforma start
```

En **Tenants**, elige **Desplegar en AWS** en un registro de OpenTofu. El botón crea recursos facturables. **Ver actividad** abre un panel lateral con los eventos de ejecución, agrupados por operación y diferenciados por herramienta. El panel consulta novedades cada dos segundos mientras está abierto. El tenant pasa a **Operativo** cuando se comprueban sus tres servicios. Si falla, **Reintentar en AWS** usa la misma clave de estado en S3 y la AMI fijada para el tenant. El selector permite consultar intentos anteriores. Para las operaciones registradas antes de esta mejora, se conserva la última fase disponible, junto con los escaneos y la auditoría.

Pulumi usa un programa JavaScript y una pila con estado en S3. Instala su CLI y las dependencias Node para usar ese motor. [Operación con Pulumi](../infra/pulumi/README.md).

Los registros creados con motores retirados conservan su historial y auditoría. Gestiona cualquier infraestructura anterior con el estado y la versión del proyecto que la creó.

El estado se almacena en `tenants/panel/<tenant>/terraform.tfstate`. La copia local de cada intento de despliegue y sus planes quedan fuera de Git, en `data/despliegues/<tenant>/<id>/infra/opentofu`. Conserva esa carpeta para que el panel pueda operar el despliegue.

Con los permisos `ec2:StopInstances` y `ec2:StartInstances`, **Suspender** detiene las tres EC2 y conserva sus discos EBS. El almacenamiento sigue facturándose durante la suspensión. **Reanudar** enciende las mismas instancias y comprueba Nginx, la API y MySQL antes de marcar el tenant como **Operativo**. Si AWS deja una operación a medias, el reintento actúa sobre las instancias que todavía requieren el cambio. [Detención y arranque de Amazon EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Stop_Start.html).

**Preparar retiro** genera un plan de destrucción para un tenant operativo o suspendido. En **Revisar retiro** puedes ver los recursos y discos afectados, incluido el disco con los registros de MySQL. **Cancelar retiro** devuelve el tenant a su estado previo. **Confirmar retiro** ejecuta el plan revisado y conserva en SQLite el historial del tenant. Si cambió el plan o se agregaron discos fuera de OpenTofu, el panel pide revisar el entorno antes de continuar.

Con `PFM2_MONITORING=1`, la vista **Tenants** muestra las alertas activas y el historial reciente de detecciones y resoluciones, y enlaza al dashboard de Grafana. [Arranque de la observabilidad](../observabilidad/README.md).

## Acceso a cada institución

Al registrar una institución, el panel le reserva un puerto local único y guarda la asignación en SQLite. Los motores configuran la API para aceptar el origen de ese puerto. En una base nueva, los dos primeros enlaces son `http://127.0.0.1:8081` y `http://127.0.0.1:8082`.

En **Tenants → Acceso por Systems Manager**, copia el comando de la institución operativa. Ejecuta cada comando en su propia terminal con el complemento de Session Manager instalado y una identidad AWS autorizada para abrir la sesión. Para seleccionar un perfil específico, añade `--profile <perfil-autorizado>`. Deja ambas terminales abiertas y abre cada enlace en una pestaña. Si suspendes una institución, vuelve a abrir su túnel después de reanudarla. Los registros anteriores conservan su acceso por el puerto 8080. Registra instituciones nuevas para la demostración con enlaces simultáneos. [Reenvío de puertos de AWS](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-sessions-start.html#sessions-start-port-forwarding).

## Escaneos antes de desplegar

En Windows, instala los binarios verificados desde la raíz del repositorio con `powershell -File plataforma/Install-Scanners.ps1`. En Linux, agrega `trivy`, `gitleaks` y `conftest` al PATH. El panel ejecuta los tres controles por defecto antes de aplicar un despliegue nuevo o un reintento. Si arrancas con `PFM2_ESCANEOS=0`, el panel registra que los omitió. Suspender, reanudar y retirar un tenant no ejecuta estos controles.

- Trivy revisa el plan JSON de OpenTofu o las dependencias fijadas de Pulumi.
- Gitleaks revisa los archivos versionables de infraestructura, del panel y del código y despliegue de Asistencia. Excluye los archivos ignorados y elimina el informe temporal después de resumirlo.
- Conftest verifica que haya tres EC2 y comprueba IMDSv2 y cifrado en el plan de OpenTofu o las altas de la vista previa de Pulumi.

Abre **Tenants → Ver actividad** y elige un intento de despliegue para ver el avance y los resultados a medida que termina cada herramienta. El resumen muestra fecha en Bolivia, herramienta, versión, alcance, conteo y códigos de reglas por intento. Los hallazgos son informativos. Un error al ejecutar cualquiera de las herramientas detiene el intento antes de aplicar y el historial conserva los resultados obtenidos. [Formatos de IaC de Trivy](https://trivy.dev/docs/latest/coverage/iac/).

## API local

Para automatizar operaciones, inicia sesión con `POST /api/sesion` enviando `usuario` y `clave` como JSON. Conserva la cookie de sesión para las demás llamadas y cierra la sesión con `POST /api/salir`. Prometheus consulta `GET /metrics` desde el equipo local sin cookie.

| Ruta de auditoría | Operación |
| --- | --- |
| `GET /api/tenants/<tenant>/auditoria` | Consultar la actividad atribuida al operador. |

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
| `GET /api/tenants/<tenant>/actividad?operacion=<id>` | Consultar los eventos de una operación, auditoría y estado del monitor. El identificador de operación es opcional. |
| `GET /api/tenants/<tenant>/despliegues` | Consultar el historial, la fase y el resultado de cada operación. |
| `GET /metrics` | Exponer la última muestra en formato Prometheus con el monitor habilitado. |
| `GET /api/alertas` | Consultar alertas activas de Prometheus con el monitor habilitado. |
| `GET /api/alertas/resumen` | Consultar alertas activas, estado de la fuente y eventos de las últimas 24 horas con el monitor habilitado. |

```powershell
npm.cmd --prefix plataforma test
```

Las pruebas ejercitan la API real en un puerto temporal, incluidos los conflictos de identificador, la persistencia al reabrir SQLite y los filtros.
