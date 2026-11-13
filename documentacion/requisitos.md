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
| RF-25–29 | Integrar Grafana por tenant y entorno. Mostrar disponibilidad, CPU, memoria, latencia, errores del backend y estado de la base de datos. Alertar por caídas, aumento de errores o límites de recursos. Mostrar en la plataforma las alertas y los eventos recientes, con tenant afectado y hora de detección. |

RF-12 y el historial de operaciones y resultados de la sección 5 siguen vigentes. La guía de operación cubrirá el registro y despliegue de tenants, la consulta de estado e historial, el reintento, la suspensión, la reanudación y el retiro, según los requisitos funcionales vigentes.

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

## Aclaraciones de la segunda clase

El [plan de cierre](plan-de-cierre.md) ordena los cambios técnicos y define qué verificar antes de la entrega.

Se revisó la transcripción automática en español de **DCID-V1E1 - 02**, entre 0:17:10 y 1:44:30. Los renglones tachados del PDF siguen excluidos. Las marcas de tiempo permiten consultar el contexto de cada aclaración. [Inicio del tramo](https://www.youtube.com/watch?v=TXxD9qJSB94&t=1030s).

| Aclaración del docente | Estado en el proyecto |
| --- | --- |
| Construir una imagen personalizada de antemano y hacer que el motor aprovisione desde esa imagen. El ejemplo usa Packer para construirla, cloud-init para el arranque y Ansible para la configuración posterior. [0:19:23](https://www.youtube.com/watch?v=TXxD9qJSB94&t=1163s) · [1:13:46](https://www.youtube.com/watch?v=TXxD9qJSB94&t=4426s) · [1:23:05](https://www.youtube.com/watch?v=TXxD9qJSB94&t=4985s) | Los cuatro motores desplegaron un tenant Básico en Ohio con la AMI privada de Packer y Ansible en las tres capas. [Ensayos en Ohio](aws-preparacion-demo.md#pruebas-con-la-ami-de-packer-y-ansible). |
| Aplicar al menos tres escáneres y dejar sus resultados visibles en el flujo de creación. Para la evaluación, el docente pide que se registren los hallazgos de los escáneres. [1:35:50](https://www.youtube.com/watch?v=TXxD9qJSB94&t=5750s) · [1:37:11](https://www.youtube.com/watch?v=TXxD9qJSB94&t=5831s) | El panel integra Trivy, Gitleaks y Conftest. Con `PFM2_ESCANEOS=1`, registra el resultado por intento antes de aplicar y lo muestra en el historial. [Configuración y alcance](../plataforma/README.md#escaneos-antes-de-desplegar). |
| Mantener tres EC2 por tenant y una base de datos independiente. Grafana debe seguir disponible durante una caída de la aplicación y mostrar las seis instancias de los dos tenants. El docente deja abierta la organización del tablero. [1:22:43](https://www.youtube.com/watch?v=TXxD9qJSB94&t=4963s) · [1:33:33](https://www.youtube.com/watch?v=TXxD9qJSB94&t=5613s) · [1:39:38](https://www.youtube.com/watch?v=TXxD9qJSB94&t=5978s) | El ensayo en Ohio confirmó seis EC2, dos VPC y bases independientes. Grafana local consultó seis series de disponibilidad. La caída y recuperación del backend se probaron por separado. [Evidencia](demo-aislamiento.md) · [Prueba de alertas](aws-preparacion-demo.md#prueba-de-observabilidad). |
| El panel de plataforma puede correr localmente y AWS por sí solo es suficiente. En el ejemplo se muestra el historial de actividad y el docente distingue el acceso del administrador de la plataforma del acceso a cada aplicación. También confirma que debe poder abrirse la URL de cada tenant. [1:08:41](https://www.youtube.com/watch?v=TXxD9qJSB94&t=4121s) · [1:32:25](https://www.youtube.com/watch?v=TXxD9qJSB94&t=5545s) · [1:37:38](https://www.youtube.com/watch?v=TXxD9qJSB94&t=5858s) · [1:40:56](https://www.youtube.com/watch?v=TXxD9qJSB94&t=6056s) | El panel local exige inicio de sesión y registra la actividad del administrador por tenant. Los accesos de la aplicación se validaron por institución. La demo documentada accede a los frontends mediante túneles de Systems Manager. Queda por validar si ese acceso cubre la expectativa de abrir una URL directamente. |
| Grabar un video de hasta 15 minutos por grupo. Mostrar el sistema en funcionamiento y las partes relevantes del código. Cada integrante explica su contribución. Basta grabar la pantalla. El líder sube la documentación con el nombre del equipo, los integrantes y el enlace al video. El manual de usuario debe ser sencillo. [1:28:19](https://www.youtube.com/watch?v=TXxD9qJSB94&t=5299s) · [1:30:22](https://www.youtube.com/watch?v=TXxD9qJSB94&t=5422s) · [1:32:49](https://www.youtube.com/watch?v=TXxD9qJSB94&t=5569s) · [1:38:26](https://www.youtube.com/watch?v=TXxD9qJSB94&t=5906s) | El repositorio, los diagramas, el manual técnico y la presentación están disponibles. Faltan la guía para usuarios, la grabación y los datos del equipo para completar la entrega. |

La clase muestra Node Exporter, Process Exporter y canales de notificación como ejemplos de observabilidad. El proyecto recopila las métricas por Systems Manager y carga el dashboard de Grafana desde el repositorio. [0:32:11](https://www.youtube.com/watch?v=TXxD9qJSB94&t=1931s) · [0:52:41](https://www.youtube.com/watch?v=TXxD9qJSB94&t=3161s) · [Observabilidad del proyecto](../observabilidad/README.md).

Para la demostración, preparar evidencia de las herramientas en los dos despliegues. En la ronda de preguntas el docente responde que deben usarse en ambos. La transcripción automática omite parte de la pregunta, por lo que ese pasaje por sí solo no aclara el alcance por motor de IaC. [1:34:25](https://www.youtube.com/watch?v=TXxD9qJSB94&t=5665s).
