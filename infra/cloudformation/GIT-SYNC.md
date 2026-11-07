# CloudFormation con tres EC2 y Git Sync

Usa la región **Ohio (`us-east-2`)** y el nombre de stack **`asistencia-cfn-tres`**. Este nombre también se usa para los permisos, el prefijo de artefactos y el inventario. El destino del despliegue es un stack nuevo. Aplicar esta estructura como actualización de `asistencia-cfn-lab` haría que CloudFormation tratara los recursos trasladados como altas y bajas. [Refactorización de stacks existentes](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-refactoring.html).

## Contexto de la clase

- El docente muestra una raíz con plantillas de red, seguridad y servidores mediante `TemplateURL`. También propone que un integrante haga un cambio en Git y otro muestre su efecto en AWS. Al cerrar la clase deja Bicep para después y pide el refactor y la sincronización en AWS. Los tres servidores en AWS corresponden al objetivo de este repositorio. [Diseño a partir de 2:12:53](https://www.youtube.com/watch?v=lkHfrZWuy9c&t=7973s), [cierre a partir de 2:37:05](https://www.youtube.com/watch?v=lkHfrZWuy9c&t=9425s).
- Los equipos muestran las hijas publicadas en S3, el archivo de despliegue en GitHub y la actualización visible en CloudFormation después de un commit. En esta guía la demostración modifica una etiqueta de la EC2 cliente y comprueba el cambio con los tres IDs originales. [Plantillas hijas y S3 a partir de 29:06](https://www.youtube.com/watch?v=9qpG7n_pATo&t=1746s), [cambio en equipo a partir de 1:35:18](https://www.youtube.com/watch?v=9qpG7n_pATo&t=5718s), [archivo de despliegue a partir de 1:38:47](https://www.youtube.com/watch?v=9qpG7n_pATo&t=5927s).

| Plantilla | Responsabilidad |
| --- | --- |
| [asistencia-anidada.yaml](templates/asistencia-anidada.yaml) | Stack raíz e inventario. Pasa parámetros y reúne las salidas. |
| [network.yaml](templates/nested/network.yaml) | VPC, subred, ruta de Internet y Flow Logs de rechazos a S3. |
| [security.yaml](templates/nested/security.yaml) | Grupos de seguridad, reglas entre capas y prefijos de descarga. |
| [compute.yaml](templates/nested/compute.yaml) | Clave SSH pública y tres EC2 `t3.micro` con IMDSv2 y discos cifrados. |

| EC2 | IP privada | Acceso entrante |
| --- | --- | --- |
| Cliente Nginx | `10.42.1.10` | SSH y web desde las IPv4 autorizadas. |
| Backend Node.js | `10.42.1.20` | SSH desde el operador y API TCP 8090 desde el cliente. |
| Base de datos MySQL | `10.42.1.30` | SSH y TCP 3306 desde el grupo del backend. |

La EC2 de datos recibe una IPv4 pública dinámica para la salida limitada a repositorios. Se administra por SSH con salto a través del backend usando la IP privada. Las tres EC2 se crean en una zona y usan 52 GiB de EBS en total. Revisa los costos de EC2, EBS, IPv4 y registros antes de crear el stack. [Precios de EC2](https://aws.amazon.com/ec2/pricing/on-demand/), [precios de EBS](https://aws.amazon.com/ebs/pricing/), [precios de IPv4](https://aws.amazon.com/vpc/pricing/).

## 1. Verificar la cuenta y validar las plantillas

Ejecuta este bloque desde PowerShell en la raíz del repositorio.

```powershell
$region = 'us-east-2'
$profile = 'pulumi-lab'
aws sts get-caller-identity --profile $profile
aws cloudformation list-stacks --profile $profile --region $region --query 'StackSummaries[?StackName==`asistencia-cfn-tres`].[StackName,StackStatus]' --output table

git switch -c codex/cloudformation-git-sync
Push-Location infra/cloudformation
$lint = '.\.tools\venv\Scripts\cfn-lint.exe'
if (-not (Test-Path $lint)) { .\scripts\Install-Scanners.ps1 }
& $lint -i W3002 -r $region -t templates/asistencia-anidada.yaml templates/nested/network.yaml templates/nested/security.yaml templates/nested/compute.yaml
if ($LASTEXITCODE -ne 0) { throw 'Revisa el resultado de cfn-lint.' }
Pop-Location
```

En esta primera pasada se omite `W3002` por las rutas relativas de `TemplateURL`. La validación posterior del archivo empaquetado incluye esa regla. El runner de escáneres del laboratorio anterior valida la plantilla monolítica. Sus reportes corresponden a ese laboratorio.

## 2. Crear el bucket privado de plantillas y preparar IAM

1. En **S3 → Create bucket**, crea un bucket de propósito general en Ohio con un nombre disponible, por ejemplo `asistencia-cfn-artifacts-IDCUENTA-us-east-2`. Activa el bloqueo de acceso público, la propiedad **Bucket owner enforced**, el versionado y SSE-S3. Usa una política de bucket que deniegue solicitudes sin TLS. La identidad que empaqueta necesita `s3:GetBucketLocation`, `s3:ListBucket` y `s3:GetObject`/`s3:PutObject` en el prefijo del laboratorio. [Política de S3 para exigir TLS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/example-bucket-policies.html).
2. Pide al administrador IAM crear **`asistencia-cfn-tres-execution`** con el caso de uso **CloudFormation**, que confía en `cloudformation.amazonaws.com`. Adjunta como política en línea el [ejemplo de ejecución](permissions/nested-execution.example.json), sustituyendo `ACCOUNT_ID` y `ARTIFACT_BUCKET`. El ejemplo limita la región y los permisos de S3, CloudFormation e inventario. Los permisos de escritura de EC2 se limitan por acción y región, con comodín de recurso para abarcar los IDs nuevos y los recursos relacionados. Usa una cuenta de laboratorio y valida la política con el administrador. La plantilla usa cifrado EBS por defecto; una cuenta con clave KMS propia puede requerir permisos adicionales para esa clave. [Rol de servicio de CloudFormation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-iam-servicerole.html).
3. El operador que configura la consola necesita `iam:PassRole` para los roles concretos, permisos de CloudFormation para crear el stack y permisos de CodeConnections para la conexión y el enlace del repositorio. Git Sync usa un rol separado de coordinación. En el asistente se puede elegir **New IAM role** con ayuda del administrador o seleccionar uno ya creado según los prerrequisitos de AWS. El rol de coordinación se elige al vincular Git y el de ejecución en **Configure stack options → Permissions**. [Roles y permisos de Git Sync](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/git-sync-prereq.html).

## 3. Empaquetar las plantillas hijas y preparar el archivo Git Sync

```powershell
$bucket = Read-Host 'Nombre del bucket privado de plantillas'
$root = 'infra/cloudformation/templates/asistencia-anidada.yaml'
$packaged = 'infra/cloudformation/templates/asistencia-empaquetada.yaml'
aws cloudformation package --template-file $root --s3-bucket $bucket --s3-prefix asistencia-cfn-tres --output-template-file $packaged --profile $profile --region $region
if ($LASTEXITCODE -ne 0) { throw 'Falló el empaquetado. Revisa el acceso al bucket.' }

& infra/cloudformation/.tools/venv/Scripts/cfn-lint.exe -r $region -t $packaged
if ($LASTEXITCODE -ne 0) { throw 'Revisa el resultado de cfn-lint.' }
aws cloudformation validate-template --template-body "file://$packaged" --profile $profile --region $region
if ($LASTEXITCODE -ne 0) { throw 'CloudFormation rechazó la plantilla raíz empaquetada.' }
```

El empaquetado publica los tres hijos en S3 con claves derivadas de su contenido. En la raíz generada, cada `TemplateURL` apunta al objeto correspondiente por HTTPS. Conserva los objetos de versiones anteriores para poder volver a desplegarlas desde Git. [Plantillas anidadas y empaquetado](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-nested-stacks.html).

Si aún no tienes la clave del laboratorio, genera el par una sola vez con `ssh-keygen -t ed25519 -f "$env:USERPROFILE/globomatics-ec2"`.

```powershell
$prefixId = aws ec2 describe-managed-prefix-lists --filters 'Name=prefix-list-name,Values=com.amazonaws.us-east-2.s3' --query 'PrefixLists[0].PrefixListId' --output text --profile $profile --region $region
$prefixId

$amiPath = '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.18-x86_64'
aws ssm get-parameters --names $amiPath --query 'Parameters[0].Value' --output text --profile $profile --region $region
Copy-Item infra/cloudformation/git-sync.example.yaml infra/cloudformation/git-sync.yaml
```

Crea en Parameter Store de Ohio el parámetro /asistencia-cfn-tres/operator-ingress-cidr, de nivel **Standard**, tipo **String** y dato **text**. Guarda como valor tu IPv4 pública actual seguida de /32. El rol de CloudFormation requiere ssm:GetParameters sobre ese parámetro. El ejemplo de política de ejecución ya incluye ese permiso. CloudFormation lee el valor al crear o actualizar el stack. [Parámetros de Systems Manager en CloudFormation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cloudformation-supplied-parameter-types.html).

Edita infra/cloudformation/git-sync.yaml con el ID de la AMI de Ohio, el ID de la lista S3, el nombre del parámetro de Parameter Store y la clave pública OpenSSH sin comentario. El ID fijo de AMI evita que una actualización rutinaria vuelva a resolver la última imagen. La clave privada y las credenciales quedan en el equipo.

```powershell
git add -- infra/cloudformation/templates/asistencia-anidada.yaml infra/cloudformation/templates/nested infra/cloudformation/templates/asistencia-empaquetada.yaml infra/cloudformation/git-sync.example.yaml infra/cloudformation/git-sync.yaml infra/cloudformation/permissions/nested-execution.example.json infra/cloudformation/GIT-SYNC.md infra/cloudformation/README.md
git diff --cached --check
git diff --cached --stat
git commit -m "Dividir CloudFormation y configurar Git Sync para tres EC2"
git push -u origin codex/cloudformation-git-sync
```

## 4. Conectar GitHub y aprovisionar desde CloudFormation

1. En Ohio, abre **Developer Tools → Settings → Connections → Create connection → GitHub**. Autoriza la aplicación de AWS para `masterkof2021/uagrm-asistencia` y verifica el estado **Available**. Se necesita un usuario de GitHub con permiso para autorizar esa instalación.
2. En **CloudFormation → Create stack → With new resources → Sync from Git**, escribe `asistencia-cfn-tres`.
3. Elige **I am providing my own file in my repository**. Selecciona la conexión, el repositorio, la rama `codex/cloudformation-git-sync` y el archivo `infra/cloudformation/git-sync.yaml`. Si el asistente pide ruta de plantilla, usa `infra/cloudformation/templates/asistencia-empaquetada.yaml`.
4. Selecciona el rol de **Git Sync**. En las opciones del stack, asigna el rol **`asistencia-cfn-tres-execution`**. Revisa cuenta, región y rama antes de enviar.
5. Al enviar, Git Sync puede iniciar el aprovisionamiento. Si la consola abre un PR de inicialización, revisa sus cambios y fusiónalo en la rama configurada. Consulta **Git sync → Latest sync events**, **Events** y **Resources** hasta que la raíz y los tres hijos indiquen `CREATE_COMPLETE`. Si falla, abre los eventos del hijo que falló y revisa la primera causa. [Crear un stack con Git Sync](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/git-sync-create-stack-from-repository-source-code.html), [estado de sincronización](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/git-sync-status.html).

## 5. Verificar las tres EC2

```powershell
$stack = 'asistencia-cfn-tres'
aws cloudformation list-stack-resources --stack-name $stack --profile $profile --region $region --query "StackResourceSummaries[?ResourceType=='AWS::CloudFormation::Stack'].[LogicalResourceId,ResourceStatus]" --output table
$outputJson = aws cloudformation describe-stacks --stack-name $stack --profile $profile --region $region --query 'Stacks[0].Outputs' --output json
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron consultar los outputs.' }
$outputs = $outputJson | ConvertFrom-Json
$ids = @($outputs | Where-Object OutputKey -in @('ClientInstanceId','BackendInstanceId','DatabaseInstanceId') | ForEach-Object OutputValue)
if ($ids.Count -ne 3) { throw 'Se esperaban exactamente tres IDs de EC2.' }
aws ec2 describe-instances --instance-ids $ids --profile $profile --region $region --query 'Reservations[].Instances[].[InstanceId,State.Name,PrivateIpAddress,PublicIpAddress]' --output table
aws ec2 describe-instance-status --instance-ids $ids --profile $profile --region $region --query 'InstanceStatuses[].[InstanceId,SystemStatus.Status,InstanceStatus.Status]' --output table
```

Para probar SSH, usa la IPv4 pública actual de cliente y backend. Para la base de datos, añade estos hosts a tu configuración SSH local y ejecuta `ssh asistencia-db`.

```sshconfig
Host asistencia-backend
    HostName IP_PUBLICA_ACTUAL_BACKEND
    User ec2-user
    IdentityFile ~/globomatics-ec2
    IdentitiesOnly yes

Host asistencia-db
    HostName 10.42.1.30
    User ec2-user
    IdentityFile ~/globomatics-ec2
    IdentitiesOnly yes
    ProxyJump asistencia-backend
```

CloudFormation aprovisiona las máquinas. Si luego instalas la aplicación, instala MySQL en la EC2 de datos, haz que escuche en `10.42.1.30:3306` y autoriza al usuario de la aplicación desde `10.42.1.20`. Carga `database/schema.sql` con una sesión administrativa en la EC2 de datos. En el backend configura `DB_HOST=10.42.1.30` y `BACKEND_HOST=10.42.1.20`, y omite la dependencia systemd del MySQL local. En Nginx usa `10.42.1.20:8090` para el proxy. Los repositorios de paquetes dependen de la lista de egreso vigente. [Guía de instalación manual](../../docs/despliegue-manual-aws.md).

## 6. Demostrar una actualización desde Git

1. Crea una rama de trabajo a partir de `codex/cloudformation-git-sync`. Agrega `- {Key: DemoGitSync, Value: verificado}` debajo de `ClientInstance.Properties.Tags` en `templates/nested/compute.yaml`.
2. Valida, vuelve a ejecutar `aws cloudformation package` y agrega el hijo y la raíz empaquetada al mismo commit. Comprueba en el diff que cambió la URL de `Compute`. Ese cambio activa la actualización del hijo desde la raíz observada por Git Sync.
3. Abre un PR hacia `codex/cloudformation-git-sync`. Revisa el diff y fusiónalo. Si el cambio puede afectar recursos, revisa también un change set que incluya los stacks anidados antes de fusionar.
4. En AWS verifica el ID del commit en **Latest sync events**, el estado `UPDATE_COMPLETE` de la raíz y de `Compute`, la etiqueta en la EC2 cliente y los mismos tres IDs de instancia. Para recuperar una versión previa, revisa el impacto y revierte el commit en la rama sincronizada. Conserva sus artefactos S3. [Actualizaciones de propiedades de EC2 en CloudFormation](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html).

Para pausar el laboratorio tras la demostración, comprueba los tres IDs del paso 5 y detén esas instancias desde EC2. EBS y los registros pueden seguir generando cargos. La EC2 de MySQL y los buckets de auditoría tienen retención. Antes de borrar o cambiar la AMI, prepara respaldo y migración de datos. Si un cambio exige reemplazar una EC2, planifica una IP privada distinta para la instancia nueva y actualiza sus consumidores. CloudFormation crea el reemplazo antes de retirar la instancia anterior. La retención conserva recursos facturables y la instancia retenida puede impedir la eliminación de la VPC. [Reemplazo de EC2 con IP privada fija](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html#cfn-ec2-instance-privateipaddress).
