# Proyecto final · Módulo 2

Plataforma para aprovisionar y administrar instancias aisladas de UAGRM Asistencia por institución educativa.

| Carpeta | Contenido |
| --- | --- |
| [asistencia](asistencia/README.md) | Aplicación base de [UAGRM Asistencia](https://github.com/masterkof2021/uagrm-asistencia), commit `ba7a8216be0c1c836925ea8964ad463295d961d0`. El repositorio del proyecto final conserva su historial. |
| [plataforma](plataforma/README.md) | Panel local, catálogo de planes y registro persistente de tenants. |
| [infra/opentofu](infra/opentofu/README.md) | Infraestructura AWS de tres EC2 por tenant y scripts de arranque. |
| [infra/cloudformation](infra/cloudformation/README.md) | Segundo motor AWS. Usa una pila y un conjunto de cambios por tenant. |
| [infra/terraform](infra/terraform/README.md) | Terraform con el módulo HCL compartido, proveedores fijados y estado propio. |
| [infra/pulumi](infra/pulumi/README.md) | Programa nativo de Pulumi para AWS y estado por pila en S3. |
| [infra/packer](infra/packer/README.md) | Plantilla para construir una AMI privada y seleccionarla en el panel. |
| [observabilidad](observabilidad/README.md) | Métricas y alertas por tenant en el panel, con Prometheus y Grafana locales. |
| [Requisitos](documentacion/requisitos.md) | Alcance vigente, criterios de demostración y aclaraciones del docente. |
| [Plan de cierre](documentacion/plan-de-cierre.md) | Pasos para integrar la AMI, Ansible y los escáneres, validar la demo y preparar la entrega. |
| [Manual de reproducción](documentacion/manual-reproduccion-ia.md) | Instrucciones para reproducir la versión probada del proyecto. |
| [Revisión de AWS](documentacion/aws-inventario-y-costos.md) | Inventario de Ohio, estimación de almacenamiento y candidatos para retirar. Contiene identificadores de recursos de la cuenta. |
| [Preparación de AWS](documentacion/aws-preparacion-demo.md) | Presupuesto de la demo, permisos requeridos y comprobaciones de la cuenta. |
| [Demo de aislamiento](documentacion/demo-aislamiento.md) | Demostración con dos planes, datos ficticios, persistencia y monitoreo. |

La aplicación base implementa el registro de asistencia y la administración de módulos con Nginx, Node.js/Express y MySQL. El panel registra tenants en SQLite y ejecuta en segundo plano el despliegue, la suspensión, la reanudación y el retiro en AWS con OpenTofu, CloudFormation, Terraform y Pulumi. Los cuatro motores usan el catálogo de planes del panel.
