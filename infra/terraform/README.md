# Terraform en AWS Ohio

Terraform utiliza el [módulo HCL compartido con OpenTofu](../opentofu/README.md) y los mismos scripts de arranque. El panel ejecuta la CLI `terraform` con este lockfile, configura las etiquetas del motor y usa la clave de estado `tenants/panel/terraform/<tenant>/terraform.tfstate` del bucket del proyecto. Cada operación usa el bloqueo de S3. Las dos credenciales de arranque usan recursos efímeros y argumentos de solo escritura de Parameter Store. [Recursos efímeros y argumentos de solo escritura en Terraform](https://developer.hashicorp.com/terraform/tutorials/aws/rds-upgrade).

Instala Terraform 1.11 o posterior dentro de la rama 1.x y configura el [perfil AWS del panel](../../plataforma/README.md#despliegue-desde-el-panel). Selecciona **Terraform** al registrar la institución. **Desplegar en AWS** revisa el plan y comprueba Nginx, la API y MySQL. **Suspender** y **Reanudar** operan las mismas EC2. **Preparar retiro** muestra el plan de destrucción, que el panel aplica después de confirmarlo.

El historial conserva la versión de Terraform, los proveedores, la aplicación y la huella del módulo. La copia de cada intento, sus variables y planes queda fuera de Git, en `plataforma/data/despliegues/<tenant>/<id>/infra/terraform`.
