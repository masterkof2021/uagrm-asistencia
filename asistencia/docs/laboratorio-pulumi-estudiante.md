# Laboratorio Pulumi: despliegue y operación

## Entorno verificado

Sesión del 22 de octubre de 2026, zona horaria America/La_Paz. Las comprobaciones fueron ejecutadas por el estudiante y sus salidas revisadas durante el acompañamiento.

- Proyecto: `asistencia-infra`, carpeta `infra/pulumi`.
- Stack activo: `lab-estudiante`; perfil AWS: `pulumi-lab`; región: `us-east-2`.
- Backend: `file://~`. El estado principal reside en `.pulumi` del usuario de Windows, no en GitHub.
- El stack antiguo `lab` tiene una frase desconocida. Se conserva con sus respaldos; no ejecutar operaciones sobre él ni importar sus checkpoints en el stack nuevo. Ambos estados pueden mencionar el mismo grupo existente.
- Se importó `rg-globomatics-lab` con el proveedor explícito `globomatics`. Se retiró después la configuración temporal `resourceGroupImportId`.
- Se crearon los otros 17 recursos AWS. Pulumi registra 20 recursos contando stack y proveedor.

| Servidor | Instancia | IP privada | Software comprobado |
| --- | --- | --- | --- |
| Cliente | `i-04746b93aaf608ecc` | `10.42.1.10` | Amazon Linux 2023, Nginx 1.30.5 |
| Backend | `i-0ec84813c8271f842` | `10.42.1.20` | Amazon Linux 2023, Node.js 24.21.0, MySQL 8.4.13 |

Las IP públicas son dinámicas: consultar AWS cada vez que se inician las instancias. Las configuraciones manuales de servicios no están automatizadas por Pulumi; recrear una instancia exige reinstalar la aplicación y restaurar sus datos.

## Configuración de los servicios

Backend: aplicación en `/opt/asistencia`, configuración privada `.env.backend`, servicio `asistencia`, usuario Linux `asistencia`. Los archivos pertenecen a `root:asistencia`; el archivo de entorno tiene permisos `640`. La unidad usa `/usr/bin/node-24`.

API: `10.42.1.20:8090`; proxy de confianza `10.42.1.10`. `FRONTEND_ORIGINS` contiene el origen HTTP vigente del cliente. MySQL escucha solamente en `127.0.0.1:3306`, con X Plugin deshabilitado, buffer InnoDB de 128 MiB y máximo 30 conexiones. Base `uagrm_asistencia`, usuario MySQL `asistencia@127.0.0.1`. El backend tiene 1 GiB de swap persistente. No abrir puertos de MySQL en los grupos de seguridad.

MySQL Community se instaló desde el repositorio oficial de la serie 8.4 para EL9, con verificación de firmas. Amazon Linux 2023 no figura como plataforma admitida en la guía de ese repositorio; la instalación y arranque funcionaron en estas instancias.

Cliente: archivos públicos en `/var/www/asistencia`; configuración en `/etc/nginx/conf.d/asistencia.conf`. `server_name` contiene su IP pública vigente y `proxy_pass` apunta a `http://10.42.1.20:8090`, sin barra final. La interfaz usa `/api`.

## Validaciones realizadas

- TypeScript sin errores y dos pruebas con mocks aprobadas. La prueba S3 no despliega un bucket.
- SSH a ambos servidores y comunicación privada cliente → API.
- MySQL activo y conexión TCP con el usuario de aplicación; inicialización de tablas y administrador completada.
- Servicio `asistencia` habilitado y activo. `/api/me` sin sesión devuelve 401.
- Nginx validado con `nginx -t`; página devuelve 200 y proxy `/api/me` devuelve 401.
- Página y acceso de administrador comprobados desde el navegador.
- `pulumi preview --stack lab-estudiante --expect-no-changes`: `20 unchanged`, antes de detener las instancias.
- Estado exportado en `.pulumi/lab-estudiante-desplegado-20261022-200219.json`, 102033 bytes. La carpeta está excluida de Git. Conservar además una copia privada externa y la frase de cifrado separada.
- Al finalizar se confirmó `stopped` para ambas instancias.

## Reanudar el laboratorio

En PowerShell, desde `infra/pulumi`, seleccionar el perfil y comprobar la identidad:

```powershell
$env:AWS_PROFILE = 'pulumi-lab'
$env:AWS_REGION = 'us-east-2'
$env:AWS_DEFAULT_REGION = 'us-east-2'
aws sts get-caller-identity --profile pulumi-lab --no-cli-pager
pulumi login 'file://~'
pulumi stack select lab-estudiante
```

No utilizar `.pulumi/passphrase`: el archivo histórico no desbloquea este stack. Introducir la frase propia de `lab-estudiante` cuando Pulumi la solicite. No publicar credenciales, contraseñas, claves privadas, `.env.backend`, exports o planes.

Iniciar y esperar:

```powershell
aws ec2 start-instances --profile pulumi-lab --region us-east-2 --instance-ids i-04746b93aaf608ecc i-0ec84813c8271f842 --no-cli-pager
aws ec2 wait instance-running --profile pulumi-lab --region us-east-2 --instance-ids i-04746b93aaf608ecc i-0ec84813c8271f842
aws ec2 wait instance-status-ok --profile pulumi-lab --region us-east-2 --instance-ids i-04746b93aaf608ecc i-0ec84813c8271f842
aws ec2 describe-instances --profile pulumi-lab --region us-east-2 --instance-ids i-04746b93aaf608ecc i-0ec84813c8271f842 --query 'Reservations[].Instances[].{ID:InstanceId,Estado:State.Name,IP:PublicIpAddress}' --output table --no-cli-pager
```

Usar las IP devueltas para SSH desde el PC, con la clave privada local `~/globomatics-ec2` y usuario `ec2-user`. No copiar la clave privada a los servidores.

1. Si cambió la IP del cliente, editar con `sudo nano /opt/asistencia/.env.backend` en el backend: actualizar `FRONTEND_ORIGINS` al nuevo origen, incluyendo `http://`. Reiniciar `sudo systemctl restart asistencia`.
2. En el cliente, editar con `sudo nano /etc/nginx/conf.d/asistencia.conf`: actualizar `server_name` a su nueva IP pública. Mantener el destino privado del backend. Ejecutar `sudo nginx -t` y solo si pasa, `sudo systemctl reload nginx`.
3. Comprobar los servicios: `sudo systemctl status asistencia mysqld --no-pager` en backend y `sudo systemctl status nginx --no-pager` en cliente. Probar la página y el acceso de administrador.
4. Las salidas antiguas de Pulumi pueden conservar las IP previas. Revisar `pulumi refresh --stack lab-estudiante` y confirmar solo actualizaciones esperadas del estado. Después ejecutar un preview. No aceptar reemplazos de EC2 sin respaldar MySQL y revisar el motivo; la consulta de AMI más reciente puede cambiar con el tiempo.
5. Si cambió la IP de salida del PC, actualizar `sshSourceCidr` a la IPv4 actual con `/32`, revisar el preview y aplicar exclusivamente los cambios esperados de SSH antes de conectarse.

## Detener al terminar

Desde PowerShell:

```powershell
aws ec2 stop-instances --profile pulumi-lab --region us-east-2 --instance-ids i-04746b93aaf608ecc i-0ec84813c8271f842 --no-cli-pager
aws ec2 wait instance-stopped --profile pulumi-lab --region us-east-2 --instance-ids i-04746b93aaf608ecc i-0ec84813c8271f842
```

Detener conserva discos y datos. EBS sigue consumiendo créditos; detener no elimina todos los costos. No ejecutar `pulumi destroy` como sustituto de detener: eliminaría infraestructura y los discos raíz contienen MySQL. Respaldar los datos antes de cualquier eliminación o reemplazo. Un export de Pulumi respalda el estado, no el contenido de MySQL.

## Pendientes

- HTTPS y dominio antes de utilizar datos reales o credenciales reutilizadas; el laboratorio validado utiliza HTTP.
- Respaldos de MySQL y prueba de restauración.
- Dos vulnerabilidades moderadas reportadas por `npm ci`; revisar dependencias sin ejecutar `npm audit fix --force` a ciegas.
- Las instancias arrancaron en modo de créditos CPU `unlimited`; revisar modo `standard` y su impacto antes de pruebas de carga, para evitar cargos adicionales por CPU sostenida.
- Alertas de presupuesto y seguimiento del saldo de créditos. Un presupuesto con notificaciones no detiene automáticamente el consumo.
- Herramientas de escaneo y otras actualizaciones: esperar el contexto del estudiante.
