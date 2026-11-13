# AMI de UAGRM Asistencia

Packer prepara una AMI privada y cifrada de Amazon Linux 2023 en Ohio. La imagen común incluye Nginx, Node.js 24, npm y el agente de Systems Manager. El arranque de cada tenant sigue instalando o configurando sus componentes según la capa. La migración de esa configuración a Ansible se describe en el [plan de cierre](../../documentacion/plan-de-cierre.md).

## Preparar AWS

- Usar un perfil de construcción autorizado para crear y retirar la EC2 y sus claves temporales, iniciar y cerrar sesiones de Systems Manager, crear y etiquetar la AMI y sus snapshots, y pasar únicamente el perfil de instancia elegido para el constructor. El rol habitual del panel carece de permiso para crear claves.
- Usar una subred de Ohio con salida HTTPS y un grupo de seguridad de construcción sin reglas de entrada. La instancia usa IPv4 pública para la salida y Packer se conecta por Systems Manager. El perfil de instancia debe permitir al agente registrarse y abrir sus canales, por ejemplo mediante `AmazonSSMManagedInstanceCore`.
- Instalar Packer y el [plugin de Session Manager para AWS CLI](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html). El plugin Amazon de Packer se instala con `packer init`.

La plantilla [preparacion.yaml](preparacion.yaml) define el perfil y el grupo de seguridad del constructor en una VPC existente. Sus salidas proporcionan los valores para Packer. El rol de la instancia tiene permisos de Systems Manager. El perfil que ejecuta Packer necesita por separado los permisos de construcción, incluido `iam:PassRole` sobre el rol de esa instancia.

## Validar y construir desde la raíz del repositorio

```powershell
$env:AWS_PROFILE = '<perfil-de-construccion>'
$cuentaEsperada = '<id-de-la-cuenta>'
$cuentaActual = aws sts get-caller-identity --query Account --output text
if ($LASTEXITCODE -ne 0 -or $cuentaActual -ne $cuentaEsperada) { throw 'Revisa la sesión y la cuenta de AWS.' }
$amiBase = aws ssm get-parameter --region us-east-2 --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --query Parameter.Value --output text
if ($LASTEXITCODE -ne 0) { throw 'No se pudo resolver la AMI base.' }
$variables = @(
  '-var', "ami_base=$amiBase",
  '-var', 'subred=<subred-de-construccion>',
  '-var', 'grupo_seguridad=<grupo-de-construccion>',
  '-var', 'perfil_instancia=<perfil-ssm-de-construccion>',
  '-var', 'version_imagen=demo-001'
)
New-Item -ItemType Directory -Path tmp/packer -Force | Out-Null
packer init infra/packer
if ($LASTEXITCODE -ne 0) { throw 'Falló la instalación del plugin de Packer.' }
packer validate @variables infra/packer
if ($LASTEXITCODE -ne 0) { throw 'Falló la validación de Packer.' }
packer build -on-error=cleanup @variables infra/packer
if ($LASTEXITCODE -ne 0) { throw 'Falló la construcción. Revisa los recursos temporales en Ohio.' }
```

Si Packer devuelve `No valid credential sources found` con un perfil de `aws login`, ejecuta la construcción en una terminal dedicada y pasa la sesión temporal de la CLI al proceso. Evita imprimir la respuesta de `export-credentials`.

```powershell
$sesionPacker = aws configure export-credentials --profile $env:AWS_PROFILE --format process | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or !$sesionPacker.SessionToken) { throw 'Falta una sesión temporal de AWS.' }
$env:AWS_ACCESS_KEY_ID = $sesionPacker.AccessKeyId
$env:AWS_SECRET_ACCESS_KEY = $sesionPacker.SecretAccessKey
$env:AWS_SESSION_TOKEN = $sesionPacker.SessionToken
Remove-Variable sesionPacker
try {
  packer build -on-error=cleanup @variables infra/packer
  if ($LASTEXITCODE -ne 0) { throw 'Falló la construcción. Revisa los recursos temporales en Ohio.' }
} finally {
  Remove-Item Env:AWS_ACCESS_KEY_ID, Env:AWS_SECRET_ACCESS_KEY, Env:AWS_SESSION_TOKEN
}
```

El manifiesto queda en `tmp/packer/manifest.json`. Usa una versión de imagen nueva para cada construcción. Comprueba que la imagen esté disponible y sea privada, que el snapshot esté cifrado y que la instancia de construcción haya terminado.

## Usar la imagen desde el panel

Antes de iniciar el panel con su perfil de despliegue, configura `PFM2_AMI_ID` con el ID de la AMI privada. El panel valida la imagen en Ohio y guarda su ID en el directorio del tenant. Los reintentos conservan el ID guardado aunque cambie la configuración del panel. Si se omite la variable, los tenants nuevos mantienen el flujo anterior con la AMI pública. Para la demo con Packer, usa registros de tenant nuevos y comprueba el ID en su historial.

Conserva la AMI y el snapshot mientras haya tenants o reintentos que los necesiten. [Constructor Amazon EBS de Packer](https://developer.hashicorp.com/packer/integrations/hashicorp/amazon/latest/components/builder/ebs).

## Ensayo en Ohio del 13 de noviembre de 2026

La construcción produjo `ami-07277c62be0b7d88f`, privada y disponible, con IMDSv2 y el snapshot cifrado `snap-0c1fa4501ce2e4ada`. Packer recibió `RequestExpired` después de registrar la AMI y antes de generar el manifiesto. Se verificó la imagen con la CLI de AWS y se retiraron manualmente la EC2 de construcción y su clave temporal. AWS confirmó la eliminación del disco raíz de esa EC2.

El panel desplegó un tenant Básico con OpenTofu 1.13.1. Las tres EC2 arrancaron con la AMI personalizada y el panel verificó Nginx, la API y MySQL mediante Systems Manager sobre las mismas instancias tras el reintento. El primer intento agotó el tiempo de verificación mientras MySQL seguía instalándose.

El panel retiró el tenant de prueba. La consulta posterior a AWS devolvió cero EC2 activas, cero volúmenes EBS y cero VPC del tenant. La AMI y su snapshot quedan disponibles para la integración con Ansible.
