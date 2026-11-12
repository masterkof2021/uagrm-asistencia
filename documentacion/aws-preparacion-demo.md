# Preparación de la demo en AWS Ohio

La primera entrega se desarrolla en AWS `us-east-2`. La propuesta inicial usa OpenTofu como motor principal y CloudFormation como segunda implementación. El panel, Prometheus y Grafana pueden ejecutarse en local durante la demo. Cada tenant tiene su propio frontend, backend y MySQL, y los dos tenants de prueba usan datos ficticios.

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

AWS también denegó la inspección de políticas adjuntas y `iam:SimulatePrincipalPolicy`. Los permisos de escritura de S3, parámetros privados y creación de pilas quedan pendientes hasta probar los recursos concretos con el perfil de despliegue. El perfil `default` devolvió un token inválido y `asistencia-deploy` tiene la sesión vencida.

Para continuar con la verificación de despliegue, renueva la sesión y comprueba la identidad activa. [Inicio de sesión con AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html).

```powershell
aws login --profile asistencia-deploy --region us-east-2
aws sts get-caller-identity --profile asistencia-deploy --region us-east-2
```
