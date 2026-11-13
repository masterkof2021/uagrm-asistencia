# Pulumi en AWS Ohio

El programa nativo de Pulumi crea una VPC, tres EC2 con EBS cifrado y dos parámetros SecureString de arranque por tenant. Comparte el catálogo y los scripts de arranque con los otros motores. La pila usa el backend S3 del proyecto, con checkpoints y bloqueos bajo `tenants/panel/pulumi/.pulumi/`. [Backend S3 de Pulumi](https://www.pulumi.com/docs/iac/operations/stack-management/using-a-diy-backend/#aws-s3).

## Preparación

Instala AWS CLI y Pulumi CLI 3.270.0 o posterior de la rama 3.x. Desde la raíz del repositorio instala las dependencias fijadas.

```powershell
npm.cmd ci --prefix infra/pulumi
```

Configura el [perfil de despliegue del panel](../../plataforma/README.md#despliegue-desde-el-panel). El rol necesita acceso a los objetos del backend y a los bloqueos S3 de Pulumi, además de los permisos de ciclo de vida para las EC2 etiquetadas `ManagedBy=Pulumi`. [Plantilla de IAM](../opentofu/panel-iam.yaml).

## Operación

1. Selecciona **Pulumi** al registrar el tenant y elige **Desplegar en AWS**. El panel genera una vista previa, comprueba que corresponda a las tres capas del tenant y aplica el plan guardado.
2. Usa **Suspender** y **Reanudar** para conservar las EC2, sus discos y los datos. El panel comprueba Nginx, Node.js y MySQL al reanudar.
3. Usa **Preparar retiro** para revisar los recursos registrados y sus discos en AWS. La confirmación revalida el inventario y ejecuta el retiro de la pila. El historial de estado queda en S3.

Conserva `plataforma/data/despliegues/<tenant>/pulumi` y la base SQLite. La carpeta contiene el programa fijado del tenant, los metadatos del stack y la clave local `clave.local`. La clave se usa para cifrar secretos del estado y derivar las dos credenciales de arranque. La carpeta queda fuera de Git. Protege la clave como una credencial de AWS. [Campos de solo escritura en Pulumi](https://www.pulumi.com/docs/iac/concepts/secrets/write-only-fields/).
