# Inventario y costos de AWS

Revisión del 12 de noviembre de 2026, hora de Bolivia, con el perfil `pulumi-lab`. Los recursos confirmados corresponden a Ohio (`us-east-2`). AWS denegó las consultas de EC2, EBS, snapshots, Elastic IP, NAT Gateway y VPC endpoints en las otras 16 regiones habilitadas.

## Retiro verificado y revisión de los discos restantes

AWS confirmó el retiro del volumen desasociado `vol-08ca7a8ded5ddea42`, gp3 de 12 GiB, y luego la terminación de las seis EC2 cliente antiguas con sus seis discos raíz de 12 GiB cada uno. El retiro de los clientes liberó **72 GiB** y reduce el costo estimado de EBS en **USD 5,76 al mes**. Los dos retiros suman **USD 6,72 al mes** estimados. El inventario posterior confirmó **10 EC2 detenidas y 10 discos gp3**, con **200 GiB** y un costo estimado de **USD 16,00 al mes** en EBS. [Tarifas de EBS](https://aws.amazon.com/ebs/pricing/) · [Eliminación de EBS al terminar una instancia](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/preserving-volumes-on-termination.html).

El retiro de los clientes se ejecutó directamente por ID en EC2. Los estados y plantillas de los laboratorios pueden seguir registrando esas instancias y requerir reconciliación antes del próximo despliegue.

| Discos restantes | GiB | USD/mes estimados | Resultado de la revisión |
| --- | ---: | ---: | --- |
| Cuatro backends con base de datos separada | 80 | 6,40 | El arranque de Node.js está automatizado y la persistencia de asistencia está en MySQL. Confirmar si se necesita conservar algún registro operativo antes de retirar las EC2 con sus discos. |
| Cuatro servidores de MySQL y dos backends de laboratorios de dos capas | 120 | 9,60 | Conservar hasta verificar los datos. Globomatics sí alojó MySQL en el backend. La guía de `asistencia-cfn-lab` documenta pruebas de conectividad y descargas, sin verificación actual del contenido del disco. |

Los cuatro backends de tres capas corresponden a `asistencia-cfn-reintento`, `asistencia-cfn-tres`, Pulumi y Terraform. El proyecto final se aprovisionará con recursos nuevos. Las guías y el código se pueden usar como referencia para reconstruir los servicios. [Laboratorios de dos EC2](../../Proyecto-con-Pulumi/asistencia/documentacion/06-laboratorios-dos-ec2.md) · [Práctica de tres EC2](../../Proyecto-con-Pulumi/asistencia/documentacion/05-operacion.md#resultados-de-la-práctica).

## Decisión para el proyecto final

**Aprovisionar discos nuevos por tenant con IaC.** Así se puede demostrar que cada despliegue crea sus propios recursos y que los datos de cada institución están aislados. Para trasladar datos de prueba útiles, exportar los registros de MySQL que se quieran conservar y restaurarlos en la base del tenant correspondiente. Las plantillas de los laboratorios previos se pueden adaptar sin depender de sus discos.

El volumen retirado era el disco conservado del laboratorio Terraform y Ansible del miércoles 4, según la copia de estado `proyecto miercoles 4/clase/aws/terraform.tfstate.backup` y la [guía de cierre del laboratorio](../../Proyecto-con-Pulumi/asistencia/documentacion/09-laboratorio-terraform-ansible.md#cierre-de-aws-con-el-disco-conservado). Estaba en `us-east-2b`. Los discos restantes están en `us-east-2a`.

## Cargos potenciales en Ohio antes del retiro

Las 16 EC2 observadas son `t3.micro` y estaban detenidas, sin IPv4 pública. Sus 16 discos raíz y el disco desasociado suman **284 GiB**. Todos son gp3 con 3.000 IOPS y 125 MiB/s. El almacenamiento aprovisionado sigue generando cargos con las máquinas detenidas. La estimación usa **USD 0,08 por GiB-mes**, tarifa pública de referencia, durante un mes completo. Es un importe bruto estimado para EBS antes de créditos o impuestos. [Ciclo de vida de EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-lifecycle.html) · [Tarifa de gp3](https://docs.aws.amazon.com/prescriptive-guidance/latest/optimize-costs-microsoft-workloads/ebs-migrate-gp2-gp3.html) · [Referencia de AWS para Ohio](https://d1.awsstatic.com/events/Summits/awstorontosummit/Important_habits_to_reduce_your_cloud_costs_STP202.pdf).

| Entorno | Discos | GiB | USD/mes estimados | Propuesta |
| --- | ---: | ---: | ---: | --- |
| Laboratorio Terraform y Ansible del miércoles 4 | 1 | 12 | 0,96 | Retirar si ya se verificó que su contenido es prescindible. |
| Globomatics | 2 | 32 | 2,56 | Revisar primero entre los entornos con EC2. Retirar por su configuración de origen si la práctica terminó. |
| `asistencia-cfn-lab` | 2 | 32 | 2,56 | Revisar si el backend de dos capas contiene datos útiles. Retirar la pila cuando termine la práctica. |
| `asistencia-cfn-reintento` | 3 | 52 | 4,16 | Comparar los datos de MySQL con los otros entornos. Retirar por CloudFormation cuando ya no se necesite. |
| `asistencia-cfn-tres` | 3 | 52 | 4,16 | Conservar temporalmente si se necesita como referencia en vivo. Revisar recursos retenidos al retirar la pila raíz. |
| Asistencia con Pulumi | 3 | 52 | 4,16 | Si ya concluyó, retirar mediante su stack de Pulumi después de revisar el disco de MySQL. |
| Asistencia con Terraform | 3 | 52 | 4,16 | Si ya concluyó, retirar mediante su estado de Terraform después de revisar el disco de MySQL. |
| **Total EBS** | **17** | **284** | **22,72** | Ahorro bruto máximo de este inventario si se retiran todos los discos. |

La consulta de Ohio devolvió cero snapshots propios de EBS, AMI propias, Elastic IP, NAT Gateways, VPC endpoints y reservas EC2 activas. La columna `Borra al terminar` indica el efecto de terminar directamente una EC2. Las políticas de retención de CloudFormation también pueden conservar la instancia o los buckets al retirar la pila. [Retención de CloudFormation](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-deletionpolicy.html) · [Conservar volúmenes al terminar EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/preserving-volumes-on-termination.html).

## Inventario por disco antes del retiro

| Volumen | EC2 asociada | GiB | Borra al terminar |
| --- | --- | ---: | --- |
| `vol-08ca7a8ded5ddea42` | Retirado y verificado | 12 | — |
| `vol-07a5bed9b3dcba4ca` | ec2-cliente-globomatics-lab (`i-04746b93aaf608ecc`) | 12 | Retirado y verificado |
| `vol-081f64b574ea0f45c` | ec2-backend-globomatics-lab | 20 | Sí |
| `vol-0f0496c9d848c22e1` | asistencia-cfn-lab-cliente (`i-09f218d4a58732914`) | 12 | Retirado y verificado |
| `vol-0fd7d0d799ce2d149` | asistencia-cfn-lab-backend | 20 | Sí |
| `vol-0c2b221498b0193df` | asistencia-cfn-client (`i-0e7adbf92a51ba6f0`) | 12 | Retirado y verificado |
| `vol-0ac40901d39847131` | asistencia-cfn-backend | 20 | Sí |
| `vol-02f5eafb30029ed51` | asistencia-cfn-database | 20 | **Se conserva** |
| `vol-053b3708b70f8ac25` | asistencia-cfn-tres-cliente (`i-0ca87701a6a299bd4`) | 12 | Retirado y verificado |
| `vol-08b9455c2eacff8e7` | asistencia-cfn-tres-backend | 20 | Sí |
| `vol-0a5a3842fdac80d1b` | asistencia-cfn-tres-mysql | 20 | Sí |
| `vol-0c303e3266f564813` | asistencia-pulumi-client (`i-071c68afd4d2afbb9`) | 12 | Retirado y verificado |
| `vol-070bbdefa2c566e28` | asistencia-pulumi-backend | 20 | Sí |
| `vol-0e8c2ae0f0dbee082` | asistencia-pulumi-database | 20 | **Se conserva** |
| `vol-0c8602f3e8b0e745c` | asistencia-tf-client (`i-09e8ec5a8060fc355`) | 12 | Retirado y verificado |
| `vol-0ee074d575195a629` | asistencia-tf-backend | 20 | Sí |
| `vol-0786f6e44f7ebac9c` | asistencia-tf-database | 20 | **Se conserva** |

## Otros recursos y facturación pendiente

- **S3 y VPC Flow Logs.** Las pilas identificaron cuatro buckets de auditoría. Los dos de `asistencia-cfn-lab` devolvieron cero versiones y marcadores al consultar S3. AWS denegó el listado en los dos de `asistencia-cfn-tres`. El flow log `fl-0b70516a88a33236a` reporta entrega exitosa al bucket S3 de flow logs de `asistencia-cfn-tres`. Hay que revisar retención y cargos de entrega y almacenamiento. [Facturación de Flow Logs](https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html) · [Tarifas de S3](https://aws.amazon.com/s3/pricing/).
- **Artefactos y estado de IaC.** El bucket de artefactos de Git Sync `asistencia-cfn-artifacts-487450071663-us-east-2` devolvió cuatro objetos actuales con 37.755 bytes en total. El perfil carece de permiso para listar sus versiones y para enumerar todos los buckets. Si se retiran artefactos, confirmar antes qué pila o pipeline los consume. Identificar y conservar los estados de IaC activos.
- **Facturación y otros servicios.** AWS denegó `ce:GetCostAndUsage`, Cost Optimization Hub y las consultas a CloudWatch Logs, RDS, balanceadores, Route 53, CloudFront, ECR, ECS, EKS, EFS, AWS Backup y Savings Plans. Para completar la auditoría se necesita un perfil con acceso de lectura a facturación e inventario, o una exportación de [AWS Billing → Bills](https://console.aws.amazon.com/billing/home#/bills) de octubre y noviembre de 2026, desglosada por servicio, región y tipo de uso. Eso permite identificar los cargos efectivos y dirigir el inventario a los servicios que los generan. [Acceso a facturación](https://docs.aws.amazon.com/cost-management/latest/userguide/control-access-billing.html).

Antes de retirar un entorno, validar si contiene datos útiles de MySQL, comprobar el stack o estado que lo administra y revisar los discos y buckets que quedan tras su retiro.
