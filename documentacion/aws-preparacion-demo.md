# Preparación de la demo en AWS Ohio

La primera entrega se desarrolla en AWS `us-east-2`. El panel admite OpenTofu, CloudFormation, Terraform y Pulumi. El panel, Prometheus y Grafana pueden ejecutarse en local durante la demo. Cada tenant tiene su propio frontend, backend y MySQL, y los dos tenants de prueba usan datos ficticios.

## Presupuesto mínimo de pruebas

**USD 3 de tope operativo incremental** para una prueba controlada. Con los dos tenants encendidos hasta 16 horas en total y sus discos aprovisionados hasta 48 horas, el cálculo da **USD 2,26** por EC2, IPv4 y EBS. Para repetir la demo o extenderla a 24 horas, reservar **USD 5**. Un tope operativo es un límite de tiempo y gasto acordado, que se controla retirando los recursos cuando termine la prueba.

| Supuesto | Cálculo |
| --- | --- |
| Básico | Tres `t3.micro`, con 12 GiB para Nginx, 20 GiB para Node.js y 20 GiB para MySQL. |
| Estándar | Dos `t3.micro` y una `t3.small` para MySQL, con discos de 12, 20 y 32 GiB. |
| EC2 Linux bajo demanda | Cinco `t3.micro` a USD 0,0104/h y una `t3.small` a USD 0,0208/h. Total de USD 0,0728/h. |
| IPv4 públicas | Hasta seis IPv4 automáticas a USD 0,005/h cada una, para cubrir el arranque y las descargas sin NAT Gateway. Las reglas de entrada de backend y MySQL limitan el acceso a sus orígenes autorizados. |
| EBS | 116 GiB gp3 a USD 0,08/GiB-mes. Prorrateo sobre un mes de 30 días. |
| Escenarios | 4 h de ejecución y discos durante 4 h → USD 0,46. 16 h de ejecución y discos durante 48 h → USD 2,26. 24 h de ejecución y discos durante 48 h → USD 3,09. |

Las tarifas de EC2 y EBS corresponden al catálogo público de Ohio publicado el 10 de noviembre de 2026. El cálculo excluye impuestos, créditos, transferencia, solicitudes y almacenamiento S3, créditos excedentes de CPU y una construcción de AMI con Packer. Para la demo corta, usa instancias T3 en modo Standard y retira discos, snapshots y AMI de pruebas al concluir si ya no son necesarios. Los **USD 16/mes estimados de los discos existentes** pertenecen a los laboratorios anteriores. [Catálogo AWS de Ohio](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/us-east-2/index.json) · [Precios de IPv4](https://aws.amazon.com/vpc/pricing/) · [Inventario previo](aws-inventario-y-costos.md).

## Permisos previstos

La lista sirve para revisar el rol de despliegue contra el primer plan de OpenTofu y el primer conjunto de cambios de CloudFormation. Las pruebas de acceso se realizaron sin crear recursos ni cambiar IAM.

| Área | Permisos que necesita la arquitectura propuesta | Verificación en Ohio con `pulumi-lab` |
| --- | --- | --- |
| EC2, VPC y EBS | Consultar AMI y zonas. Crear y etiquetar VPC, subredes, rutas, internet gateway, grupos de seguridad, instancias y discos. Leer, detener, reanudar y retirar los recursos del proyecto. | Lectura de EC2/EBS confirmada. Pasaron los `dry-run` de `CreateVpc`, `CreateVolume` y `RunInstances`. El lanzamiento se simuló con subred y grupo de referencia, con y sin un perfil EC2 existente. Queda validar el ciclo completo con los recursos y etiquetas definitivos. |
| Cuota de EC2 | Consultar la cuota regional de instancias Standard bajo demanda. El diseño de dos tenants necesita **12 vCPU libres**, más cualquier instancia temporal de construcción si se ejecuta al mismo tiempo. | `servicequotas:GetServiceQuota` denegado. Un `dry-run` con una instancia comprueba permisos sobre esa solicitud y deja pendiente confirmar capacidad para las seis. |
| Estado remoto en S3 | Acceso al bucket y prefijo del proyecto. `s3:ListBucket` limitado al prefijo, lectura y escritura del objeto de estado, y lectura, escritura y borrado del objeto de bloqueo S3. El aprovisionamiento inicial del bucket privado y versionado puede hacerse con un rol de preparación. | `s3:ListAllMyBuckets` denegado. Falta probar las operaciones sobre el bucket y prefijo específicos. [Backend S3 de OpenTofu](https://opentofu.org/docs/language/settings/backends/s3/). |
| Parameter Store y perfiles EC2 | El rol de despliegue administra parámetros del prefijo del proyecto. Los perfiles de instancia leen los parámetros de su tenant y descifran con KMS si se elige una clave administrada por el cliente. Limitar `iam:PassRole` a los roles de EC2 previstos. | Lectura del parámetro público de Amazon Linux 2023 confirmada. `ssm:DescribeParameters` denegado. La prueba con el perfil EC2 histórico no verifica acceso a los parámetros ni autorización para pasar los roles nuevos. |
| CloudFormation | Validar plantillas, crear y ejecutar change sets, consultar eventos y retirar pilas del proyecto. Si se usa un rol de servicio, limitar `iam:PassRole` a ese rol y dar al rol los permisos EC2/VPC/EBS/SSM que use la plantilla. | Lectura de pila y `ValidateTemplate` confirmadas. Falta validar creación, ejecución y retiro de una pila del proyecto. [Rol de servicio de CloudFormation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-iam-servicerole.html). |
| Grafana y métricas | El Grafana local puede usar Prometheus para la demo. Si se añade CloudWatch, su lector necesita consultar métricas y, cuando se use, registros. | `logs:DescribeLogGroups` denegado. Prometheus local puede consultar los exportadores del tenant mediante acceso restringido. |
| Packer, si se construye una AMI en AWS | El rol de construcción necesita lanzar y retirar la EC2 temporal y crear, etiquetar y retirar la AMI y los snapshots correspondientes. | Pendiente de validar cuando esté definida la construcción. |

AWS también denegó la inspección de políticas adjuntas y `iam:SimulatePrincipalPolicy` a `pulumi-lab`.

## Verificación con la sesión renovada

El 12 de noviembre de 2026, `asistencia-deploy` se autenticó correctamente con el usuario raíz de la cuenta `masterkof`.

- **Capacidad:** la cuota de EC2 Standard bajo demanda en Ohio es de 32 vCPU. AWS devolvió cero instancias en ejecución o pendientes. La demo requiere 12 vCPU.
- **Simulaciones aprobadas:** creación de VPC y EBS gp3 cifrado, y lanzamiento de `t3.micro` y `t3.small` con el perfil EC2 de referencia.
- **Lecturas confirmadas:** inventario de S3, metadatos de Parameter Store, CloudWatch Logs y validación de plantillas de CloudFormation.
- **Planes de OpenTofu verificados:** Básico y Estándar dieron 30 altas por tenant en modo SSH, con tres EC2 y 52 o 64 GiB de EBS respectivamente. [Módulo de OpenTofu](../infra/opentofu/README.md).

## Prueba de despliegue con OpenTofu

Se desplegó `smoke-basico` en Ohio con la sesión temporal de `asistencia-deploy`. El modo Systems Manager creó 31 recursos, incluidas tres EC2 `t3.micro`, y permitió comprobar los servicios sin abrir SSH. Nginx devolvió HTTP 200 en la portada y HTTP 401 en la API sin sesión. También pasaron el inicio de sesión de administrador y la consulta de MySQL.

El bucket `pfm2-state-487450071663-us-east-2` quedó privado, versionado y cifrado con SSE-S3. OpenTofu escribió el estado con bloqueo de S3 bajo `tenants/smoke-basico/terraform.tfstate`. Se comprobó que el estado carecía de los valores de las dos contraseñas de Parameter Store.

OpenTofu retiró los 31 recursos de la prueba. Las consultas posteriores confirmaron cero EC2 activas, discos, VPC y parámetros de ese tenant. Se conserva el bucket con el historial de estado. Quedan pendientes el rol de despliegue para el panel y la validación de CloudFormation.

## Rol de despliegue del panel

CloudFormation ejecutó el conjunto aprobado `crear-rol-y-limite` de la pila `pfm2-panel-iam` en Ohio. La pila creó el rol `pfm2-panel-deploy` y el límite `pfm2-instance-boundary` para las instancias. El perfil local `pfm2-deploy` asumió el rol desde `pulumi-lab`, que usa el usuario IAM `pulumi-estudiante`.

El panel registró y encoló un tenant temporal, generó el plan con estado en S3 y creó 19 recursos. AWS denegó `ssm:DescribeParameters` y la autorización de reglas de entrada y salida al crear reglas etiquetadas. OpenTofu retiró los 19 recursos con la sesión de preparación. AWS confirmó que la prueba quedó sin EC2 activas, VPC ni parámetros.

CloudFormation ejecutó el conjunto aprobado `ajustar-permisos-opentofu`. El rol existente puede consultar metadatos de Parameter Store en Ohio y crear reglas de seguridad etiquetadas para el proyecto. [Plantilla de IAM](../infra/opentofu/panel-iam.yaml).

La segunda prueba, `panel-ajuste-mwdghfdy`, llegó a **Operativo** desde el panel con el perfil `pfm2-deploy`. OpenTofu creó 31 recursos y el panel verificó Nginx, la API y MySQL mediante Systems Manager. La prueba conservó en el historial local los ID de las instancias y las versiones de la aplicación, la plantilla, OpenTofu y sus proveedores.

El mismo perfil retiró los 31 recursos de la prueba. Las consultas de AWS confirmaron cero VPC, EC2 activas, discos y parámetros del tenant.

CloudFormation aplicó el conjunto aprobado `suspender-y-reanudar-ec2`. El rol del panel puede detener y encender las EC2 etiquetadas para el proyecto y administradas por OpenTofu en Ohio.

El panel desplegó, suspendió y reanudó el tenant temporal `panel-ciclo-mwdh5ll7` con el perfil `pfm2-deploy`. La prueba confirmó los mismos tres identificadores de EC2 y EBS al completar ambas operaciones. El panel volvió a verificar Nginx, la API y MySQL. Una consulta de MySQL devolvió el registro ficticio escrito antes de la suspensión.

OpenTofu retiró los 31 recursos de la prueba con el rol dedicado. AWS confirmó cero VPC, EC2 activas, discos y parámetros de ese tenant.

El panel probó el retiro con el tenant temporal `panel-retiro-mwdlli1i`. La primera revisión enumeró 31 recursos y tres discos EBS. Tras cancelarla, las tres EC2 seguían en ejecución. La API rechazó confirmar la revisión cancelada y aceptó la revisión vigente. OpenTofu retiró los 31 recursos y el panel verificó en AWS que no quedaran EC2 activas, discos EBS, VPC ni parámetros del tenant.

## Prueba de observabilidad

Con `pfm2-deploy`, el tenant temporal `panel-monitor-mwdnvmx0` entregó métricas de Nginx, Node.js y MySQL por Systems Manager. La primera verificación de la API agotó su tiempo mientras arrancaba MySQL. El reintento completó la verificación sobre las mismas instancias. El panel comprueba ahora MySQL y el backend antes de probar la API a través de Nginx.

Grafana consultó CPU, memoria y disponibilidad de las tres instancias, además de latencia y errores 5xx. La detención controlada del backend produjo cinco respuestas 5xx. Grafana y la API del panel registraron la caída del servicio, la pérdida de disponibilidad de la API y el aumento de errores para el tenant de pruebas. Al reiniciar el backend se recuperó la API y se cerró la alerta de caída.

El panel retiró los 31 recursos del tenant, incluidas las tres EC2 y sus discos raíz. AWS confirmó que no quedaban instancias activas, volúmenes EBS, VPC ni parámetros del tenant. [Guía de observabilidad](../observabilidad/README.md).

## Prueba del motor CloudFormation

Los conjuntos de cambios `agregar-motor-cloudformation` y `limitar-roles-cfn` ampliaron el rol dedicado del panel a las pilas `pfm2-cfn-*` de Ohio y al prefijo de roles y perfiles que usa ese motor. La primera pila temporal se detuvo al consultar un rol IAM antes de crearlo. Se retiró esa pila y el ajuste conservó el límite de permisos obligatorio para los roles de instancia.

El panel reintentó el tenant Básico `panel-cfn-mwdrsixv` con `pfm2-deploy`. CloudFormation validó y ejecutó 25 altas. Systems Manager confirmó Nginx, la API y MySQL. La suspensión y reanudación conservaron las tres EC2, sus tres discos y el registro ficticio escrito antes de la suspensión.

El panel mostró el inventario para revisar y ejecutó el retiro confirmado. AWS verificó la eliminación de la pila, las EC2, los discos y la VPC. La consulta a Secrets Manager confirmó que los dos secretos de prueba dejaron de estar activos. La plantilla usada pasó `cfn-lint` y las [reglas de seguridad del proyecto](../infra/cloudformation/seguridad.guard). [Guía de CloudFormation](../infra/cloudformation/README.md).

## Pruebas de Terraform y Pulumi

El conjunto `habilitar-terraform-y-pulumi` añadió al rol dedicado los permisos de ciclo de vida de EC2 para ambos motores y el borrado de bloqueos de Pulumi bajo su prefijo de S3.

El tenant Estándar `panel-pulumi-mwdt8x3q` completó el despliegue, la suspensión, la reanudación y el retiro desde el panel. Conservó las mismas tres EC2 y los tres discos, y MySQL devolvió el registro ficticio escrito antes de suspender. La vista previa de reintento mostró cero cambios. La revisión del checkpoint en S3 confirmó que las credenciales de arranque estaban cifradas. [Guía de Pulumi](../infra/pulumi/README.md).

El tenant Básico `panel-terraform-mwdt8x3p` encontró la cuota de ocho VPC de Ohio durante el primer intento simultáneo. Después de retirar Pulumi, Terraform reusó el mismo estado de S3, conservó 13 recursos y añadió los 18 restantes. También conservó las EC2, los discos y el registro de MySQL tras suspender y reanudar. Se comprobó que los valores de las credenciales no aparecían en el estado de Terraform cifrado en S3. [Guía de Terraform](../infra/terraform/README.md).

AWS confirmó el retiro de 31 recursos y tres discos raíz en cada prueba. La demostración de aislamiento con dos tenants simultáneos requiere dos cupos disponibles de VPC en Ohio.

La cuota aplicada de Ohio subió a nueve VPC. El ensayo posterior desplegó dos tenants simultáneos con OpenTofu, verificó su aislamiento y confirmó el retiro de ambos. [Guía y evidencia de la demo de aislamiento](demo-aislamiento.md).

## Pruebas con la AMI de Packer y Ansible

El 13 de noviembre de 2026, el panel desplegó un tenant Básico por motor en Ohio con la AMI privada `ami-07277c62be0b7d88f`. Cada tenant arrancó tres EC2 y el panel verificó Nginx, la API y MySQL mediante Systems Manager. El historial guardó la AMI y el modo de arranque `ansible`.

| Motor | Tenant temporal | Resultado |
| --- | --- | --- |
| OpenTofu 1.13.1 | `ansible-basico-20261113031235` | Operativo y retirado |
| Terraform 1.16.6 | `ansible-terraform-20261113053307` | Operativo y retirado |
| CloudFormation | `ansible-cloudformation-20261113053307` | Operativo y pila retirada |
| Pulumi 3.270.0 | `ansible-pulumi-20261113054120` | Operativo y retirado |

Terraform y CloudFormation se ejecutaron en paralelo. Pulumi empezó tras liberar el cupo de Terraform. AWS confirmó cero EC2 activas, discos EBS y VPC de los tres últimos ensayos y un total de siete VPC de las nueve permitidas en Ohio. La AMI privada se conserva para la demo. [Configuración de Ansible](../plataforma/README.md#despliegue-desde-el-panel).

## Ensayo de escaneos antes de desplegar

El 13 de noviembre de 2026, el panel ejecutó Trivy 0.76.1, Gitleaks 8.30.1 y Conftest 0.71.1 antes de aplicar los despliegues. Los cuatro tenants usaron la AMI privada y Ansible. El panel verificó las tres capas de cada tenant y guardó los resultados en el historial.

| Tenant | Trivy | Gitleaks | Conftest |
| --- | --- | --- | --- |
| Básico con OpenTofu | 3 hallazgos, reglas AWS-0029 y AWS-0178 | 0 hallazgos | 0 hallazgos |
| Estándar con CloudFormation | 9 hallazgos, reglas AWS-0098, AWS-0104, AWS-0124 y AWS-0178 | 0 hallazgos | 0 hallazgos |
| Básico con Terraform | 3 hallazgos, reglas AWS-0029 y AWS-0178 | 0 hallazgos | 0 hallazgos |
| Estándar con Pulumi | 2 hallazgos en dependencias, CVE-2026-118773 y CVE-2026-118764 | 0 hallazgos | 0 hallazgos |

OpenTofu y CloudFormation se probaron en la primera ronda. Terraform y Pulumi completaron la segunda. El panel registró los cuatro retiros y AWS devolvió cero EC2 activas, discos EBS y VPC asociados a cada ronda. [Alcance de cada escáner](../plataforma/README.md#escaneos-antes-de-desplegar).

Para verificar la identidad de la CLI en otra sesión, consulta STS después de autenticarte. [Inicio de sesión con AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html).

```powershell
aws login --profile asistencia-deploy --region us-east-2
aws sts get-caller-identity --profile asistencia-deploy --region us-east-2
```
