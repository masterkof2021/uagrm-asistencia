# Guion para grabar la demostración final

Graben la pantalla y la voz de cada integrante mientras el sistema funciona en AWS Ohio. El video puede durar hasta 15 minutos. Pausen o recorten la espera del despliegue, las alertas y el retiro. El guion ocupa 14 minutos y deja un minuto de margen.

## Antes de grabar

- Preparen el panel local con inicio de sesión, la AMI privada de Packer, Ansible, los tres escáneres y el monitoreo. Comprueben la sesión de AWS, dos cupos de VPC libres, 12 vCPU Standard disponibles y el acceso a Grafana. [Preparación técnica](manual-reproduccion-ia.md).
- Preparen dos instituciones ficticias en **Pruebas** con OpenTofu y planes Básico y Estándar. Dejen listos los Excel con las matrículas `BASICO-701` y `ESTANDAR-902` y la fecha del día en Bolivia. Usen una terminal para cada túnel y abran las ventanas necesarias antes de grabar. [Procedimiento de aislamiento](demo-aislamiento.md).
- Asignen cada tramo a quien hizo esa parte. Tengan a mano los archivos de código que mostrarán y oculten contraseñas, tokens y credenciales de AWS.

## Secuencia de grabación

| Tiempo | Qué se muestra en pantalla |
| --- | --- |
| 0:00–1:00 | Nombre del equipo, integrantes, problema y arquitectura. Dos VPC y tres EC2 por institución. |
| 1:00–4:00 | Registro y despliegue desde el panel autenticado. Tras la espera, mostrar ambos estados operativos, la AMI, Ansible y el resultado de Trivy, Gitleaks y Conftest en el historial. Mostrar los archivos relevantes de infraestructura y del panel. |
| 4:00–8:00 | Abrir ambas URLs con los túneles activos. En cada sitio, mostrar el módulo activo, marcar con la matrícula propia, intentar el acceso con la ajena y exportar Excel. Mostrar que cada archivo contiene solo la matrícula de esa institución. |
| 8:00–10:00 | Suspender el Básico mientras el Estándar sigue disponible. Reanudar, abrir otra vez el túnel del Básico y verificar la asistencia anterior y los mismos discos en el historial. |
| 10:00–13:00 | Mostrar las seis series de servicio en Grafana. Simular una caída del backend de prueba, mostrar la detección en Grafana y en el panel y recuperar el servicio. [Procedimiento de alerta](../observabilidad/README.md#demostrar-una-alerta). |
| 13:00–14:00 | Revisar el retiro de ambos tenants, mostrar el resultado confirmado y abrir el repositorio con la guía y la evidencia. |

La evidencia del 12 de noviembre cubre matrículas, Excel, suspensión y métricas. La del 13 cubre las dos URLs simultáneas con Packer, Ansible y los escáneres. La grabación final reúne esos pasos en una sola demostración. [Evidencia de los ensayos](demo-aislamiento.md).

## Entrega del equipo

1. Completen el nombre oficial del equipo y la lista de integrantes. Identifiquen al líder y asignen a cada persona el tramo donde explica su contribución.
2. Suban el video y prueben su enlace desde otra sesión con los permisos que tendrá el docente. Comprueben audio, legibilidad y duración.
3. El líder presenta la documentación y el enlace al video en el canal indicado por el curso. Incluyan la [guía de usuario](guia-operar-panel.md), el [manual técnico](manual-reproduccion-ia.md), la [presentación](presentacion-proyecto-final-modulo-2.pptx) y el [repositorio](https://github.com/masterkof2021/uagrm-asistencia). [Requisitos de entrega](requisitos.md#entregables-y-demostración).
