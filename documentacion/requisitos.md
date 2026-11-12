# Alcance del proyecto final

El PDF **Requisitos del proyecto finalv2.pdf** define el alcance. Se revisaron visualmente sus cinco páginas y se omitieron los renglones tachados. La explicación oral aporta contexto de implementación y de la demostración. [Clase, 1:44:00–2:16:10](https://www.youtube.com/watch?v=jwO0Ojz_O1U&t=6240s).

## Requisitos funcionales vigentes

| ID | Comportamiento |
| --- | --- |
| RF-01–03 | Mostrar un catálogo Básico, Estándar y Avanzado. Definir cómputo, almacenamiento, tamaño de base de datos y límites de uso por plan. Mostrar sus características al seleccionarlo. |
| RF-07–10 | Registrar nombre de la institución, identificador único, contacto, entorno y plan. Permitir elegir Terraform, OpenTofu, Pulumi o CloudFormation. Aprovisionar frontend, backend y base de datos, desplegar la aplicación y conectarla a la base del tenant. |
| RF-11–13 | Mostrar progreso, resultado y errores comprensibles. Reintentar una operación fallida sin duplicar recursos. Registrar la versión de la aplicación, las plantillas y las herramientas en cada despliegue. |
| RF-14 | Consultar tenants por nombre, estado, plan y entorno. |
| RF-16–18 | Suspender y reanudar tenants, conservar sus datos según la política de retención y mostrar recursos y datos afectados antes de solicitar confirmación para eliminar. |
| RF-21 | Mantener las funciones de UAGRM Asistencia, incluidas marcas, gestión de módulos e importación desde Excel. |
| RF-25–29 | Integrar Grafana por tenant y entorno. Mostrar disponibilidad, CPU, memoria, latencia, errores del backend y estado de la base de datos. Alertar por caídas, aumento de errores o límites de recursos, con tenant afectado y hora de detección en la plataforma. |

El PDF conserva RF-12, aunque el docente describe el reintento como avanzado y el criterio de aceptación correspondiente aparece tachado. El historial de operaciones y resultados también sigue vigente en la sección 5. El entregable 6 conserva la mención de actualizar, respaldar y restaurar, mientras que los requisitos funcionales correspondientes están tachados. La guía de operación cubrirá las operaciones implementadas según los requisitos vigentes.

## Arquitectura y operación

- Aislar los datos por tenant. Cada institución tiene su propio frontend, backend, base de datos y URL. El administrador de la plataforma gestiona tenants y despliegues. El administrador de cada institución y los usuarios de asistencia acceden según sus permisos.
- Ejecutar los aprovisionamientos como trabajos en segundo plano con estado consultable, historial persistente y operaciones repetibles. Documentar el almacenamiento y la protección del estado de IaC.
- Proteger credenciales fuera del código y del repositorio. Mostrar errores sin secretos. El docente planteó una revisión de secretos antes del aprovisionamiento.
- Permitir detener o eliminar recursos de prueba para controlar costos. El panel de administración puede correr en local y aprovisionar en la nube. Para la demostración basta una IP distinta por tenant. [Clase, 1:59:00](https://www.youtube.com/watch?v=jwO0Ojz_O1U&t=7140s) · [Clase, 2:06:00](https://www.youtube.com/watch?v=jwO0Ojz_O1U&t=7560s) · [Clase, 2:14:00](https://www.youtube.com/watch?v=jwO0Ojz_O1U&t=8040s).
- Usar Terraform u OpenTofu como motor principal recomendado. El PDF contempla Pulumi y CloudFormation para una implementación pequeña o comparación técnica. Explicar el papel de cada herramienta, incluido cloud-init para arranque, Ansible para configuración posterior, Packer para imágenes y Grafana para observabilidad.

## Entregables y demostración

- Código del frontend y backend, infraestructura y configuración. Diagramas de arquitectura y del flujo de creación. Catálogo de planes con capacidades y límites. Tablero de Grafana con métricas y alertas. Guía de operación, evidencia de aislamiento y presentación del diseño.
- Crear dos tenants de planes distintos y desplegar frontend, backend y base de datos para cada uno. Suspender y reanudar uno verificando que sus datos persisten. Mostrar su salud y una alerta en Grafana. Demostrar que un tenant no puede consultar datos del otro.
- La primera entrega y la demostración usarán AWS Ohio. Una variante en Azure se decidirá después de completar el proyecto. La propuesta inicial es OpenTofu como motor principal y CloudFormation como segunda implementación en AWS. El requisito RF-08 sigue registrando los cuatro motores que enumera el PDF. [Clase, 1:55:00–1:58:00](https://www.youtube.com/watch?v=jwO0Ojz_O1U&t=6900s).
- Grabar una demostración de hasta 15 minutos. El docente permite pausar la grabación durante el aprovisionamiento y pide que cada integrante explique su contribución. La guía de usuario debe poder seguirla una persona sin conocimientos técnicos. [Clase, 2:09:00](https://www.youtube.com/watch?v=jwO0Ojz_O1U&t=7740s) · [Clase, 2:12:00–2:16:10](https://www.youtube.com/watch?v=jwO0Ojz_O1U&t=7920s).

## Base para la implementación

Usar la aplicación clonada en [asistencia](../asistencia/README.md) para RF-21. El [README de las prácticas previas](../../Proyecto-con-Pulumi/asistencia/documentacion/README.md) documenta tres capas con Pulumi, CloudFormation y Terraform, además de cloud-init, Ansible, separación de red y operación en Ohio. Es una referencia para parametrizar por tenant los nombres, la red, el plan y el estado de IaC. Antes de fijar tamaños de planes, probar el consumo de MySQL, Node.js y Grafana con datos de demostración.
