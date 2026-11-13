# Plan de cierre del Proyecto Final del Módulo 2

El proyecto ya tiene código y presentación en GitHub. Se ensayó en AWS Ohio el aislamiento de dos tenants simultáneos con OpenTofu. Los cuatro motores verificaron en ensayos individuales el arranque con la AMI privada de Packer y Ansible. El panel ya incorpora los tres escáneres y conserva sus resultados en el historial. [Requisitos y aclaraciones del docente](requisitos.md#aclaraciones-de-la-segunda-clase) · [Ensayos de los motores](aws-preparacion-demo.md#pruebas-con-la-ami-de-packer-y-ansible) · [Escaneos](../plataforma/README.md#escaneos-antes-de-desplegar).

## 1. Preparar la ejecución

- Usar AWS Ohio (`us-east-2`) y OpenTofu como primer motor de integración. Mantener Terraform, Pulumi y CloudFormation disponibles en el panel.
- Revisar la sesión y los permisos del rol de despliegue. Definir un perfil separado para la construcción de imágenes y verificar los permisos y el alcance de la EC2 temporal, la AMI y su snapshot.
- Confirmar los cupos y el costo de la prueba antes de construir. La demo simultánea requiere dos cupos de VPC y 12 vCPU Standard. Planificar la construcción antes del ensayo de seis EC2 y contabilizar aparte el snapshot de la imagen. [Preparación de AWS](aws-preparacion-demo.md).

**Cierre del paso.** Cuenta, región, permisos, capacidad y costo estimado registrados para la construcción y la demo.

## 2. Construir la AMI con Packer

- Versionar la plantilla de Packer y la preparación de una AMI privada de Amazon Linux 2023 para las tres capas. Probar primero una imagen común con herramientas compartidas y mantener la configuración de cada servicio en su rol. Registrar la versión del código de construcción y el ID de la AMI.
- Comprobar que la instancia de construcción se retira y que la imagen arranca en Ohio. Conservar la imagen y su snapshot mientras se necesiten para despliegues y reintentos. Mantener las credenciales y los datos de las instituciones fuera de la imagen.

**Cierre del paso.** AMI personalizada disponible, reproducible a partir de archivos del repositorio, con evidencia de arranque y limpieza de los recursos temporales.

## 3. Integrar la imagen y configurar las capas con Ansible

- Adaptar la selección compartida de AMI en el panel. Validar región, propietario, arquitectura y disponibilidad de la imagen configurada. Fijar el ID por tenant antes de crear recursos y conservarlo en los reintentos y en el historial. Los registros existentes conservan la imagen con la que se aprovisionaron.
- Usar cloud-init para iniciar la configuración y pasar los parámetros de cada entorno. Usar roles de Ansible para configurar Nginx, Node.js y MySQL. Obtener las credenciales de cada tenant en tiempo de ejecución mediante los mecanismos de AWS que ya usa cada motor.
- Ejecutar primero el flujo en OpenTofu. Confirmar que Terraform comparte la misma entrada y que Pulumi y CloudFormation reciben la misma imagen y la configuración de arranque equivalente.

**Cierre del paso.** El historial identifica la AMI y la versión de configuración. La configuración puede repetirse sin duplicar datos ni perder una asistencia existente. Los cuatro motores consumen la imagen fijada y verifican sus tres servicios.

## 4. Integrar tres escáneres al aprovisionamiento

- Reutilizar Trivy para configuración de IaC, Gitleaks para secretos en archivos versionables y Conftest para políticas del proyecto. Adaptar las entradas al motor seleccionado y documentar qué inspecciona cada herramienta. Usar el [laboratorio previo](../asistencia/infra/cloudformation/README.md) como referencia.
- Ejecutar los escáneres antes de aplicar la infraestructura. Registrar por intento y por tenant el nombre y la versión, el resultado, el número de hallazgos y la fecha. Diferenciar un escaneo sin hallazgos, uno con hallazgos y un fallo de ejecución. Mostrar un resumen en el historial y redactar los valores sensibles.
- Documentar cómo se tratan los hallazgos y los fallos de ejecución. Mostrar el resultado de los tres escáneres en ambos tenants de la demo.

**Cierre del paso.** Cada despliegue deja tres resultados trazables y visibles en el panel, incluidos los reintentos y los errores de ejecución.

## 5. Cerrar el acceso y la auditoría del panel

- El panel local ya autentica al administrador y registra al operador que solicita cada operación. [Configuración y auditoría](../plataforma/README.md#ejecutar-en-local).
- Verificar si el docente acepta el acceso actual por Systems Manager. Si exige una URL directa, probar una URL distinta por tenant con acceso controlado al frontend y actualizarla al reanudar si cambia la dirección. Mantener la API y MySQL accesibles únicamente desde sus capas autorizadas.

**Cierre del paso.** El operador abre la aplicación correcta desde el panel o con el acceso documentado, y el historial permite saber quién inició cada operación nueva.

## 6. Probar y documentar la demostración final

- Ejecutar las pruebas locales del panel, las validaciones de los cuatro motores y un despliegue real de prueba con la AMI. Repetir el despliegue con Terraform, Pulumi y CloudFormation para comprobar el nuevo arranque y el retiro.
- Crear simultáneamente dos instituciones ficticias, Básico y Estándar, con OpenTofu. Mostrar las tres EC2 por tenant, la AMI fijada y los tres resultados de escaneo por intento. Registrar una asistencia propia por institución, comprobar el rechazo cruzado y revisar ambas exportaciones.
- Suspender y reanudar un tenant y comprobar la persistencia en sus mismos discos. Mostrar las seis instancias en Grafana y demostrar una alerta y su resolución manteniendo el otro tenant operativo. Retirar los dos tenants y confirmar en AWS el retiro de sus recursos. Registrar por separado qué AMI y snapshot se conservan para reproducir la entrega.

**Cierre del paso.** Un único ensayo documenta los requisitos nuevos y los que ya se habían probado en ensayos anteriores. [Guía de aislamiento](demo-aislamiento.md) · [Procedimiento de alertas](../observabilidad/README.md#demostrar-una-alerta).

## 7. Preparar y entregar el material

- Redactar una guía sencilla desde el panel que cubra registro, despliegue, estado, historial, reintento, suspensión, reanudación y retiro. Actualizar el manual técnico, los diagramas y la presentación con las nuevas pruebas.
- Grabar hasta 15 minutos por grupo. Mostrar el sistema en funcionamiento, la AMI y el arranque, los escáneres, el aislamiento y Grafana. Mostrar las partes del código que respalden la explicación de cada integrante.
- Publicar en GitHub el código y la documentación finales. El líder presenta el nombre del equipo, sus integrantes y el enlace al video según las indicaciones del curso.

**Cierre del paso.** Guía y presentación alineadas con la versión publicada, enlace al video verificado y entrega académica preparada.
