# Infraestructura de asistencia con Pulumi

Equivalente en TypeScript de los 18 recursos del módulo raíz de `../../../terraform/` (`config.tf`, `network.tf`, `compute.tf` y `outputs.tf`). Este programa es independiente de Terraform: no carga archivos `.tf` ni utiliza su estado.

## Despliegue activo: 20 de octubre de 2026

Los 18 recursos del laboratorio y los siete recursos de su backend OpenTofu fueron eliminados. El laboratorio se recreó desde cero con este proyecto: stack `lab`, cuenta `222234418877`, región `us-east-2`. No fue necesaria una importación. Los respaldos privados del estado anterior están en `terraform/state-backups/rebuild-2026-10-20/`.

| Servidor | ID | IP pública | IP privada |
| --- | --- | --- | --- |
| Cliente | `i-04469c31d367c0a3b` | `3.138.121.97` | `10.42.1.10` |
| Backend | `i-068cdcc3819bb81f6` | `3.14.245.164` | `10.42.1.20` |

AMI utilizada: `ami-0d31a22b09ceec4db`. La IP administrativa configurada para SSH es `181.188.164.3/32`, verificada desde esta conexión. Las IP públicas pueden cambiar: consultar siempre las salidas vigentes. Los servidores son nuevos; la instalación y el despliegue de la aplicación siguen siendo manuales.

Verificación realizada: `pulumi preview --expect-no-changes` sin cambios pendientes y conexión SSH correcta a ambos EC2. Se guardó un respaldo del nuevo estado en `.pulumi/rebuild-2026-10-20.json`.

## Estado compartido en S3

El estado activo del laboratorio está en `s3://globomatics-pulumi-state-222234418877-us-east-2/globomatics?region=us-east-2`. Se migró desde el backend local sin recrear recursos. El bucket es privado, cifrado, versionado y protegido contra eliminación; Pulumi administra los bloqueos por stack.

El proyecto separado [`bootstrap/`](bootstrap/README.md), stack `shared`, administra el bucket y guarda su estado en el mismo backend. Consulta su guía para permisos, incorporación de compañeros y recuperación. La contraseña de secretos permanece fuera de S3 y Git.

## Infraestructura reproducida

| Elemento | Configuración |
| --- | --- |
| Cuenta y región | Solo `222234418877`; `us-east-2` por defecto |
| Resource Group | `rg-globomatics-lab`, filtro `Project=globomatics` |
| VPC | `10.42.0.0/16`, DNS y hostnames habilitados |
| Subred | `10.42.1.0/24`, primera AZ disponible; IP pública solicitada por cada EC2 |
| Internet | Internet Gateway, ruta `0.0.0.0/0` y asociación de tabla |
| Cliente | `t3.micro`, `10.42.1.10`, EBS gp3 cifrado de 12 GiB |
| Backend | `t3.micro`, `10.42.1.20`, EBS gp3 cifrado de 20 GiB |
| Sistema | Amazon Linux 2023 x86_64, familia kernel 6.18, IMDSv2 obligatorio |
| Entrada | SSH en ambos desde una IPv4 `/32`; 80/443 públicos solo al cliente; 8090 al backend solo desde el SG cliente |
| Salida | Todo IPv4 desde ambos grupos de seguridad |
| Clave | Solo la pública existente `~/globomatics-ec2.pub` |

Se conservan nombres y etiquetas `Name` de Terraform. `ManagedBy` pasa de `OpenTofu` a `Pulumi`. Los discos se eliminan al terminar su instancia, igual que en el original. Las IP públicas son dinámicas. Abrir 443 no instala un certificado ni configura HTTPS.

No se añaden IAM, RDS, NAT Gateway, Elastic IP ni instalación automática. MySQL sigue siendo local al backend; no hay entrada de red para bases de datos. Nginx, Node.js, MySQL y systemd se configuran con la [guía manual](../../docs/despliegue-manual-aws.md).

El bucket y la política de acceso de `terraform/bootstrap/` se retiraron al completar la reconstrucción. No pertenecen a los 18 recursos de la aplicación y no se recrean con Pulumi. Los proyectos `terraform/pulumi/` y `terraform/pulumi-ec2/` son independientes de este.

## Archivos

- `index.ts`: Resource Group y salidas compatibles `servers` y `ssh_commands`.
- `src/config.ts`: proveedor, cuenta autorizada, clave pública, CIDR SSH y etiquetas.
- `src/network.ts`: red y rutas.
- `src/security.ts`: grupos y reglas independientes.
- `src/compute.ts`: consulta de AMI, clave y EC2.
- `tests/`: comprobación del inventario y restricciones con mocks; no accede a AWS.

## Preparación y validación

Requiere Node.js >=22, npm, CLI de Pulumi y una identidad AWS autorizada. Desde `asistencia/`:

```bash
cd infra/pulumi
npm ci
npm run check
npm test

# Autenticación mediante AWS CLI; abre Brave para autorizar la sesión.
BROWSER=/usr/bin/brave-browser aws login --profile default --region us-east-2

# El adaptador usa las credenciales temporales sin imprimirlas ni guardarlas en código.
python3 scripts/aws-session.py pulumi stack select lab
python3 scripts/aws-session.py pulumi preview
python3 scripts/aws-session.py pulumi up
python3 scripts/aws-session.py pulumi stack output servers
python3 scripts/aws-session.py pulumi stack output ssh_commands
```

En un clon nuevo, recibir la contraseña del stack por un canal seguro, seleccionar `lab` y ejecutar `python3 scripts/aws-session.py pulumi config refresh --force` para recuperar la configuración vigente desde S3. No crear otro stack para administrar estos mismos recursos.

`Pulumi.yaml` selecciona el backend S3 compartido. `scripts/aws-session.py` obtiene credenciales temporales de AWS CLI en memoria y usa los plugins en `.pulumi/home`. Lee la contraseña existente de `.pulumi/passphrase` o de `PULUMI_CONFIG_PASSPHRASE_FILE`; no genera otra contraseña. Los archivos privados se excluyen de Git. El adaptador permite `--profile OTRO_PERFIL` antes del comando. No conservar un `PULUMI_BACKEND_URL` local en el entorno, porque sobrescribiría el backend del proyecto.

Los valores opcionales se configuran con `python3 scripts/aws-session.py pulumi config set CLAVE VALOR`. `Pulumi.lab.yaml.example` documenta las opciones; los archivos reales de stack se excluyen de Git. Las rutas relativas de clave se resuelven desde `infra/pulumi`. La clave privada nunca se lee. Si tu privada tiene otro nombre, ajustar el comando SSH exportado al conectarte.

Todos los compañeros deben usar el mismo backend S3, proyecto y stack `lab`, con sus propias credenciales autorizadas. El estado de Terraform y su antiguo bucket ya no se utilizan.

## Referencia para futuras importaciones de recursos existentes

Esta sección es una referencia para otros entornos; el laboratorio activo ya se recreó desde cero. El código no migra automáticamente el estado de Terraform. Un stack vacío propondrá crear recursos; no ejecutar `pulumi up` sobre el laboratorio existente hasta importarlos. La importación registra los recursos existentes sin recrearlos, según la [guía oficial de Pulumi](https://www.pulumi.com/docs/iac/guides/migration/import/).

1. Coordinar con el equipo una pausa en las operaciones de Terraform/OpenTofu. Obtener un respaldo privado y actualizado mediante `tofu -chdir=../../../terraform state pull` desde esta carpeta. Guardarlo fuera de Git, con permisos restringidos.
2. Consultar los IDs, AMIs actuales y AZ en el estado o AWS. Configurar `availabilityZone`, `clientAmiId` y `backendAmiId` con los valores de los recursos existentes. Esto evita adoptar una AMI nueva del parámetro SSM o una AZ distinta que provoquen reemplazos.
3. Ejecutar `pulumi preview --import-file import.json` para generar la plantilla de importación a partir de este programa. Completar los IDs reales de los 18 recursos según la tabla siguiente; conservar los tipos, nombres y referencias al proveedor explícito que genera Pulumi. Importar en el mismo stack con `pulumi import --file import.json --generate-code=false --protect=false`. La opción `--protect=false` conserva la ausencia de protección del módulo original; se puede omitir para proteger los recursos importados contra eliminación. Guardar el inventario fuera de Git. No ejecutar `up` durante una importación parcial.
4. Ejecutar `pulumi preview --diff`. Resolver diferencias antes de aplicar: no debe proponer creaciones, destrucciones ni reemplazos. El cambio de etiqueta `ManagedBy` es intencional. Conservar la AMI fijada mientras se completa la migración; retirar esa configuración posteriormente puede proponer reemplazar los EC2.
5. Tras comprobar la importación completa y respaldar ambos estados, retirar los 18 recursos del estado de OpenTofu con `tofu state rm` usando las direcciones exactas del inventario, sin destruirlos. Retirar también las declaraciones de su configuración activa o archivar el módulo completo para que otro `apply` no vuelva a crearlos. No retirar el backend bootstrap. Este paso cambia la administración compartida y debe coordinarse con el equipo.
6. Revisar nuevamente `pulumi preview`, aplicar los cambios revisados y consultar las salidas. A partir de ahí usar exclusivamente Pulumi para esos recursos.

| Dirección Terraform (prefijo `aws_`) | Tipo Pulumi | Nombre lógico | ID de importación |
| --- | --- | --- | --- |
| `resourcegroups_group.globomatics` | `aws:resourcegroups/group:Group` | `globomatics` | Nombre del grupo |
| `vpc.globomatics` | `aws:ec2/vpc:Vpc` | `globomatics` | `vpc-…` |
| `subnet.globomatics_public` | `aws:ec2/subnet:Subnet` | `globomatics-public` | `subnet-…` |
| `internet_gateway.globomatics` | `aws:ec2/internetGateway:InternetGateway` | `globomatics` | `igw-…` |
| `route_table.globomatics_public` | `aws:ec2/routeTable:RouteTable` | `globomatics-public` | `rtb-…` |
| `route_table_association.globomatics_public` | `aws:ec2/routeTableAssociation:RouteTableAssociation` | `globomatics-public` | `subnet-ID/rtb-ID` |
| `security_group.globomatics_client` | `aws:ec2/securityGroup:SecurityGroup` | `globomatics-client` | `sg-…` |
| `security_group.globomatics_backend` | `aws:ec2/securityGroup:SecurityGroup` | `globomatics-backend` | `sg-…` |
| `vpc_security_group_ingress_rule.globomatics_ssh["client"]` | `aws:vpc/securityGroupIngressRule:SecurityGroupIngressRule` | `globomatics-ssh-client` | `sgr-…` |
| `vpc_security_group_ingress_rule.globomatics_ssh["backend"]` | `aws:vpc/securityGroupIngressRule:SecurityGroupIngressRule` | `globomatics-ssh-backend` | `sgr-…` |
| `vpc_security_group_ingress_rule.globomatics_web["http"]` | `aws:vpc/securityGroupIngressRule:SecurityGroupIngressRule` | `globomatics-web-http` | `sgr-…` |
| `vpc_security_group_ingress_rule.globomatics_web["https"]` | `aws:vpc/securityGroupIngressRule:SecurityGroupIngressRule` | `globomatics-web-https` | `sgr-…` |
| `vpc_security_group_ingress_rule.globomatics_api` | `aws:vpc/securityGroupIngressRule:SecurityGroupIngressRule` | `globomatics-api` | `sgr-…` |
| `vpc_security_group_egress_rule.globomatics_outbound["client"]` | `aws:vpc/securityGroupEgressRule:SecurityGroupEgressRule` | `globomatics-outbound-client` | `sgr-…` |
| `vpc_security_group_egress_rule.globomatics_outbound["backend"]` | `aws:vpc/securityGroupEgressRule:SecurityGroupEgressRule` | `globomatics-outbound-backend` | `sgr-…` |
| `key_pair.globomatics` | `aws:ec2/keyPair:KeyPair` | `globomatics` | `key-globomatics-lab` |
| `instance.globomatics_client` | `aws:ec2/instance:Instance` | `globomatics-client` | `i-…` |
| `instance.globomatics_backend` | `aws:ec2/instance:Instance` | `globomatics-backend` | `i-…` |

Las opciones `clientAmiId` y `backendAmiId` son independientes porque las instancias existentes pueden tener imágenes diferentes. Sin esas opciones se consulta exactamente el mismo parámetro SSM que Terraform. Una nueva publicación de AMI puede proponer reemplazos en futuros previews; respaldar MySQL antes de aceptar reemplazos.

## Crear en un entorno vacío

Este programa mantiene los nombres fijos `globomatics-lab`; cambiar solo el nombre del stack no crea aislamiento. Para recrear el laboratorio, comprobar primero que esos recursos y nombres no existen en la cuenta/región seleccionada. Revisar el preview antes de ejecutar:

```bash
python3 scripts/aws-session.py pulumi up
python3 scripts/aws-session.py pulumi stack output servers
python3 scripts/aws-session.py pulumi stack output ssh_commands
```

Estas operaciones generan costos de AWS. Las pruebas con mocks validan el programa y sus restricciones, pero no sustituyen un preview autenticado ni verifican permisos, cuotas o disponibilidad de la AMI en AWS.
