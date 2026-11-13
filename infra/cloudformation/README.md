# CloudFormation en AWS Ohio

CloudFormation aprovisiona una pila `pfm2-cfn-<tenant>` por institución. El panel genera su plantilla JSON con el catálogo de planes, los scripts de arranque que comparte con OpenTofu y la AMI fijada para ese tenant. La pila contiene una VPC, tres EC2 con EBS cifrado y dos credenciales de arranque generadas en Secrets Manager. Nginx, Node.js y MySQL arrancan en instancias separadas, con entrada restringida a las capas autorizadas y acceso de operación por Systems Manager.

CloudFormation guarda el estado de la pila. El panel conserva en SQLite el ARN de la pila, los identificadores de EC2 y EBS, la versión de la aplicación y la huella de la plantilla. La copia local de cada intento queda en `plataforma/data/despliegues`, fuera de Git. La plantilla y el historial guardan referencias a recursos, sin los valores de las credenciales. La pila usa la sesión del rol dedicado del panel. [Control de acceso a CloudFormation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/control-access-with-iam.html).

## Desplegar desde el panel

1. Configura el perfil de AWS y aplica los permisos CloudFormation de [panel-iam.yaml](../opentofu/panel-iam.yaml) sobre la pila de IAM del proyecto. El rol `pfm2-panel-deploy` puede operar las pilas `pfm2-cfn-*` en Ohio.
2. Inicia el [panel local](../../plataforma/README.md#despliegue-desde-el-panel). Registra un tenant con motor **CloudFormation**, elige el plan y pulsa **Desplegar en AWS**.
3. El panel revisa que el conjunto de cambios contenga las altas previstas, espera a CloudFormation y verifica las tres capas con Systems Manager. Un reintento sobre una pila creada repite las comprobaciones sin volver a crear sus EC2.
4. Abre Nginx por un túnel de Systems Manager usando el ID de `InstanciaFrontend` en las salidas de la pila. Usa el puerto local `8080` y el remoto `80`. [Reenvío de puertos con Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-sessions-start.html#sessions-start-port-forwarding).

**Suspender** detiene las EC2 y conserva sus discos. **Reanudar** enciende las mismas EC2 y verifica sus servicios. **Preparar retiro** muestra los recursos de la pila y sus discos raíz. Al confirmar, el panel revalida el inventario y elimina la pila con los discos y las credenciales de arranque.

Si una operación falla, consulta la pila y sus eventos en AWS Ohio. El reintento puede reutilizar la pila o limpiar una reversión completa una vez que CloudFormation confirma que sus recursos se retiraron. Conserva la carpeta local de despliegues junto con la base SQLite para consultar la evidencia de la demo.

## Validar la plantilla

Desde la raíz del repositorio, indica la ruta de `tenant.cloudformation.json` guardada por un intento del panel y ejecuta las comprobaciones.

```powershell
$plantilla = (Resolve-Path 'plataforma/data/despliegues/mi-tenant/1/tenant.cloudformation.json').Path
cfn-lint --regions us-east-2 --template $plantilla
cfn-guard validate --rules infra/cloudformation/seguridad.guard --data $plantilla
aws cloudformation validate-template --profile pfm2-deploy --region us-east-2 --template-body "file://$plantilla"
```

Las reglas locales comprueban IMDSv2, EBS cifrado, salida HTTPS, reglas de entrada entre capas y el límite IAM de los roles de instancia. AWS también valida el conjunto de cambios antes de que el panel lo ejecute.
