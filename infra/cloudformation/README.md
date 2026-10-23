# CloudFormation y tres controles de seguridad

Este laboratorio prepara la defensa academica del aprovisionamiento de los mismos dos servidores usados con Terraform/OpenTofu/Pulumi. El template principal es **`templates/asistencia.yaml`**. Se despliega en un stack **nuevo**, por ejemplo `asistencia-cfn-lab`, sin transferir ni tocar recursos de Pulumi.

**Estado de entrega (23-10-2026):** stack `asistencia-cfn-lab` actualizado en Ohio con `UPDATE_COMPLETE`, 33 recursos, salidas restringidas por listas autorizadas y VPC Flow Logs ACTIVE/SUCCESS para REJECT. Se comprobaron `dnf makecache`, consulta npm y descarga de la clave MySQL desde ambas EC2; ambas quedaron detenidas. Trivy conserva solo AWS-0132 por la excepcion SSE-S3 aprobada; Conftest y Gitleaks pasan. Las pruebas negativas detectan los fallos esperados. Ver [REMEDIACION-TRIVY.md](REMEDIACION-TRIVY.md) y [VALIDACION.md](VALIDACION.md). La aplicacion aun no esta instalada en estas nuevas instancias.

## Contexto de la clase y archivos recibidos

Se consulto la transcripcion del [video del docente, tramo 1:24 a 2:44](https://www.youtube.com/watch?v=MZD6SrDalHc&t=5040s). Es una transcripcion automatica y puede contener errores en nombres tecnicos.

- 1:24-1:41: secretos, diferencias entre configuracion IaC y dependencias del codigo, CVE y actualizacion de bases de reglas.
- 1:42-2:18: templates YAML/JSON, parametros, recursos, salidas, stack y rollback.
- 2:18-2:38: crear y revisar change sets, consultar eventos/recursos/salidas y actualizar de S3 a S3+EC2.
- 2:39-2:43: dos servidores y su infraestructura, **tres** escaneres, template local y ejecucion en vivo por consola web o CLI. Aunque antes menciona dos, la instruccion final es tres.
- 2:42: no reproducir el backend de estado Terraform en S3. CloudFormation conserva el estado del stack en AWS; no administramos un `.tfstate` propio.

No se reproducen afirmaciones generales del video como garantias: un rollback puede fallar o conservar recursos segun sus politicas; CloudFormation tiene estado, pero lo administra el servicio; los nombres logicos y las palabras reservadas tienen restricciones diferentes.

Se conservaron copias de referencia **sin cambios**:

| Fuente | Contenido y observaciones |
| --- | --- |
| `references/teacher/01-s3-bucket.yaml` | S3 con parametros Proyecto/Ambiente y outputs nombre/ARN. No declara versionado, bloqueo publico explicito, politica HTTPS ni retencion. S3 tiene protecciones por defecto del servicio; ausencia de una propiedad no prueba por si sola que el bucket sea publico. |
| `references/teacher/01.1-s3-bucket-ec2.yaml` | Agrega una EC2 y la AMI Amazon Linux por SSM. Omite subred, grupo SSH, clave, IMDSv2 y cifrado explicito de EBS. Depende de la red predeterminada: no equivale a nuestros dos servidores y red propia. |
| `references/asistencia-original.yaml` | Ubuntu 24.04, red 10.24.0.0/16, frontend 8080, API 3000 con origen global por defecto, ambos discos de 12 GiB. Es un antecedente, no el despliegue Pulumi que validamos. |

ZIP original: `01.1-s3-bucket-ec2.zip`, SHA-256 `144523A99A301EC7128D71A5B693D0B87E6AC0CB1614452DC7456FFE5E99D048`. No se extraen ni ejecutan instrucciones de terceros como autorizacion. **No subir las plantillas de `references` al crear el stack de esta entrega.** El bucket de los ejemplos no es necesario para el laboratorio principal.

## Arquitectura y equivalencia

| Parte | CloudFormation |
| --- | --- |
| Red propia | VPC 10.42.0.0/16, subred 10.42.1.0/24, gateway, ruta y asociacion |
| Cliente | Amazon Linux 2023, t3.micro, privada 10.42.1.10, disco gp3 cifrado de 12 GiB |
| Backend | Misma AMI/tipo, privada 10.42.1.20, disco gp3 cifrado de 20 GiB |
| Identidad SSH | Clave PUBLICA importada con nombre derivado del stack; privada permanece en el PC |
| Seguridad | IMDSv2 obligatorio, SSH /32, API 8090 solo desde grupo cliente, MySQL sin entrada de red |
| Inventario | Grupo de recursos con etiqueta `Deployment` exclusiva del stack |
| Aplicacion | Nginx, Node.js y MySQL se instalan manualmente; no se aprovisionan por este template |

El template actual tiene **33 recursos**: incluye las reglas de salida independientes, una lista de destinos autorizados, Flow Logs y dos buckets de auditoria con sus politicas. El numero no mide equivalencia por si mismo.

Cambios de seguridad deliberados respecto a Pulumi: web 80/443 limitada a la IP /32 del presentador; salida HTTP/HTTPS restringida a listas de destinos autorizados y API privada; creditos CPU `standard` para evitar cargos de CPU excedente. La IP del docente puede ser distinta: en ese caso la pagina no sera accesible desde su conexion hasta actualizar el parametro autorizado.

Dos VPC pueden repetir estos CIDR sin conectarse entre ellas. No crear peering/rutas entre ellas sin redisenar las redes superpuestas. Nombres fisicos derivados de `AWS::StackName` evitan colisiones con `globomatics-lab` de Pulumi.

### Datos y eliminacion

El backend tiene `DeletionPolicy: Retain` y `UpdateReplacePolicy: Retain`. Esto conserva la instancia completa si se elimina o reemplaza: **puede seguir encendida y consumiendo creditos**. Sus interfaces tambien pueden impedir eliminar subred/VPC y dejar el stack en `DELETE_FAILED`. No confundir retencion con respaldo de MySQL.

Antes de demostrar borrado, detener ambas EC2, respaldar los datos y decidir explicitamente si conservar el backend o autorizar su eliminacion. No ejecutar un `delete-stack` a ciegas esperando limpieza completa. El cliente no tiene retencion y su disco raiz se elimina al terminar la instancia.

## Los tres escaneres elegidos de las imagenes

Se excluyen TFLint y Checkov. Tampoco se presenta `cfn-lint` como sustituto de los tres controles de seguridad.

| Herramienta principal | Que revisa en esta entrega | Etapa de la cadena | Que NO demuestra |
| --- | --- | --- | --- |
| **Trivy `config`** | Reglas incorporadas para CloudFormation: red, IMDS, cifrado, observabilidad | Analisis estatico de IaC antes del aprovisionamiento | No busca CVE de npm con este comando; tampoco prueba la cuenta AWS |
| **Gitleaks** | Posibles claves/tokens/secretos en snapshot de archivos versionables, incluidos archivos nuevos | Desarrollo/control de versiones, antes del commit | No verifica si las credenciales estan activas; no revisa AWS ni el historial Git con `dir` |
| **OPA/Conftest** | Politicas Rego propias: IMDSv2, EBS cifrado, SSH /32, API entre SG, ausencia de entrada MySQL, CPU standard | Politicas y cumplimiento: puerta previa al despliegue | No incluye nuestras politicas de forma magica; reglas incompletas producen cobertura incompleta |

Complementos: **cfn-lint** valida sintaxis, referencias y propiedades contra esquemas AWS; **CloudFormation Guard** aplica las reglas explicitas de `policies/security.guard`. Guard y Conftest se superponen intencionalmente para comparar mecanismos; no equivalen a dos bases independientes de CVE.

Comandos y rutas se ejecutan mediante el script para evitar errores de espacios en Windows. Las herramientas son portables/aisladas: Guard 3.2.1, Trivy 0.76.1, Gitleaks 8.30.1, Conftest 0.71.1 y cfn-lint 1.58.0. El instalador verifica SHA-256 de los binarios contra los hashes oficiales fijados. Esto verifica integridad de descarga, no sustituye una auditoria del proveedor. Las reglas externas de Trivy pueden actualizarse independientemente del ejecutable.

## 1. Instalar y correr localmente (PowerShell)

Desde la raiz del repositorio:

```powershell
cd infra/cloudformation
.\scripts\Install-Scanners.ps1
.\scripts\Invoke-Scans.ps1
```

El instalador solo hace falta inicialmente. No necesita administrador ni credenciales AWS. Requiere Python 3.10-3.14, Git, tar y salida HTTPS a PyPI/GitHub y al registro publico de reglas de Trivy. No instalar Ruby ni usar `gem install` para esta seleccion.

El runner genera `reports/FECHA-HORA/summary.json`, reportes JSON y stderr por herramienta. `cfn-lint` debe pasar antes de continuar. Un codigo distinto de cero significa hallazgos **o** un error de ejecucion; revisar el reporte y stderr, no declarar aprobacion. Gitleaks usa `--redact=100`; no publicar reportes crudos sin revisarlos.

El snapshot de Gitleaks respeta `.gitignore`: `.env`, claves y estados privados quedan fuera. Eso protege la demostracion, pero limita su alcance; no certifica todo el disco ni la ausencia de secretos en commits antiguos. Revision adicional del historial, si se requiere:

```powershell
.\.tools\gitleaks\gitleaks.exe git ../.. --redact=100 --no-banner --report-format json --report-path reports/gitleaks-history.json
```

### Comandos individuales para explicar en la defensa

Desde `infra/cloudformation`, normalizar las funciones YAML a JSON sin consultar AWS:

```powershell
.\.tools\venv\Scripts\python.exe scripts/prepare-template.py templates/asistencia.yaml reports/asistencia.json
.\.tools\conftest\conftest.exe test reports/asistencia.json --policy policies/security.rego --output json
.\.tools\trivy\trivy.exe config --misconfig-scanners cloudformation --cf-params parameters.scan.json --format json --exit-code 1 templates/asistencia.yaml
```

Gitleaks se ejecuta sobre `source-snapshot` creado por el runner, y no sobre toda la carpeta con estados privados. Ver su comando exacto en `scripts/Invoke-Scans.ps1`. Para Trivy, el runner aisla temporalmente la configuracion Docker de credenciales para descargar reglas publicas sin usar el helper de Docker Desktop; restaura el entorno al terminar.

**Dependencias:** `Trivy config` no detecta vulnerabilidades de `package-lock.json`. Para esa etapa se usa separadamente `trivy fs --scanners vuln` sobre los manifiestos de la aplicacion; requiere descargar su base de vulnerabilidades y no forma parte del resultado IaC reportado aqui. Snyk/Dependabot son otras alternativas de esa etapa, no sustitutos de validar el template.

## 2. Demostrar que los controles detectan errores

```powershell
.\.tools\venv\Scripts\python.exe scripts/test-scanners.py
```

Genera copias en `reports/negative-.../`: IMDS opcional, disco sin cifrar, SSH global y un token **ficticio**. Verifica que Guard, Conftest y Trivy detecten fallos y Gitleaks detecte el token con una regla de demostracion explicita. El token no prueba todas las reglas por defecto de Gitleaks. **Nunca desplegar `DO-NOT-DEPLOY.json`.** El template principal no se modifica.

## 3. Preparar acceso AWS y parametros

El usuario IAM `pulumi-estudiante` tiene los permisos del laboratorio para EC2/Resource Groups/lectura SSM en Ohio y el estudiante agrego `CloudFormationLaboratorioOhio` usando `permissions/cloudformation-lab.json`. El complemento permite stacks y change sets `asistencia-cfn-*` y la lectura `ssm:GetParameters` del parametro publico exacto de la AMI. Para otro usuario, revisar y asignar el complemento mediante una identidad administradora; no adjuntar `AdministratorAccess`. La consola web puede requerir permisos adicionales de lectura/S3 para subir archivos, por lo que la ruta CLI evita un bucket de carga del template.

Para los buckets y la entrega de Flow Logs se adjunta ademas la politica administrada por el cliente `CloudFormationFlowLogsLaboratorioOhio`, definida en `permissions/flow-logs-lab.json`; evita el limite acumulado de 2048 caracteres de politicas insertadas en un usuario.

El complemento no concede `iam:PassRole` ni crea usuarios. CloudFormation usa una sesion derivada del operador, sin execution role adicional. Los permisos de recursos existentes siguen siendo necesarios: el complemento no reduce los permisos EC2 que ya tenga el usuario. Se verificaron listado, lectura SSM, validacion, creacion de change set y consulta del stack en vivo. Se probaron las actualizaciones documentadas; no todas las operaciones de eliminacion de la politica; cualquier `AccessDenied` debe diagnosticarse por accion y recurso.

Preparar solo una clave publica y la IPv4 actual, nunca passwords ni tokens:

```powershell
aws sts get-caller-identity --profile pulumi-lab --no-cli-pager
$operatorIp = (curl.exe -4 --fail --silent --show-error https://checkip.amazonaws.com).Trim()
.\scripts\New-LabParameters.ps1 -OperatorIp $operatorIp
```

Se escribe `parameters.local.json`, excluido de Git. `parameters.scan.json` usa una direccion documental para analisis y **no sirve para desplegar**. Los parametros del template restringen el acceso /32; no pegar claves privadas.

## 4. Presentacion desde la web AWS

1. Mantener los servidores Pulumi detenidos para no pagar dos laboratorios encendidos.
2. Abrir CloudFormation en **Ohio/us-east-2** y comprobar la cuenta.
3. Crear stack con recursos nuevos y cargar **`templates/asistencia.yaml`**. La subida web puede almacenar una copia del template en S3; no es un backend de estado Terraform.
4. Nombre `asistencia-cfn-lab`. Completar SshIngressCidr y WebIngressCidr con la IPv4 publica actual + `/32`, y SshPublicKey con el contenido del archivo `.pub`. Obtener S3PrefixListId con New-LabParameters.ps1; conservar IncludePublicOutputs=false para permitir actualizaciones con EC2 detenidas. Consultar las IP publicas vigentes desde EC2 al iniciarlas.
5. Conservar `t3.micro` y el parametro SSM de Amazon Linux. No crear IAM ni aceptar capacidades IAM innecesarias: el template no incluye recursos IAM.
6. Revisar opciones/rollback, etiquetas y costos. Crear un **change set** para revisar los 33 recursos nuevos. No importar los IDs de Pulumi.
7. Tras revisar los hallazgos y permisos, ejecutar el change set. Aqui comienza la creacion de servidores y el consumo AWS. Esperar `CREATE_COMPLETE` y revisar eventos/recursos/outputs. Si falla, diagnosticar el primer fallo y los efectos de rollback/Retain; no crear stacks repetidos a ciegas.
8. Mostrar outputs y probar SSH. La aplicacion no se instala automaticamente; aprovisionar servidores es el requisito de esta defensa. Si se quiere tambien la web, seguir la guia manual con los outputs de **CloudFormation**, nunca los de Pulumi.

## 5. Alternativa por consola

Solo despues de validar herramientas, revisar hallazgos y preparar permisos/parametros:

```powershell
.\scripts\New-ChangeSet.ps1
```

El script comprueba la cuenta, valida el template en el servicio y crea un change set tipo CREATE; **no lo ejecuta**. Deja el stack en revision. No usarlo para actualizar un stack existente; para UPDATE revisar el template actual y preparar un change set especifico.

Consultar validaciones del servicio por `aws cloudformation describe-stack-events --stack-name asistencia-cfn-lab --profile pulumi-lab --region us-east-2 --no-cli-pager`. Esta fase de permisos/cuotas/AMI solo se podra declarar validada cuando realmente se ejecute en la cuenta. Los eventos disponibles por defecto no equivalen a tener habilitado un trail completo de CloudTrail: no se comprobo la retencion de auditoria de la cuenta.

Para ejecutar un change set ya revisado, recuperar su nombre sin escribir marcadores:

```powershell
$changeSets = aws cloudformation list-change-sets --stack-name asistencia-cfn-lab --profile pulumi-lab --region us-east-2 --output json --no-cli-pager | ConvertFrom-Json
$ready = @($changeSets.Summaries | Where-Object { $_.Status -eq 'CREATE_COMPLETE' -and $_.ExecutionStatus -eq 'AVAILABLE' })
if ($ready.Count -ne 1) { throw 'Revisar manualmente los change sets: se esperaba exactamente uno disponible.' }
aws cloudformation execute-change-set --stack-name asistencia-cfn-lab --change-set-name $ready[0].ChangeSetName --profile pulumi-lab --region us-east-2 --no-cli-pager
aws cloudformation wait stack-create-complete --stack-name asistencia-cfn-lab --profile pulumi-lab --region us-east-2
aws cloudformation describe-stacks --stack-name asistencia-cfn-lab --profile pulumi-lab --region us-east-2 --query 'Stacks[0].Outputs' --output table --no-cli-pager
```

**No ejecutar este bloque durante la fase de preparacion.** En caso de error de `execute-change-set`, detenerse sin continuar con los comandos siguientes.

## 6. Costos y cierre de la demostracion

El escaneo local no aprovisiona AWS. El nuevo stack si agrega dos EC2, 32 GiB EBS y dos IPv4 publicas; es infraestructura adicional a la que sigue existiendo en Pulumi. No asumir que los creditos cubren cualquier servicio ni que detener las instancias elimina el costo EBS.

Para detener SOLO las instancias del stack CloudFormation, obtener sus IDs de los outputs:

```powershell
$outputsText = aws cloudformation describe-stacks --stack-name asistencia-cfn-lab --profile pulumi-lab --region us-east-2 --query 'Stacks[0].Outputs' --output json --no-cli-pager
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron leer las salidas.' }
$outputs = $outputsText | ConvertFrom-Json
$ids = @($outputs | Where-Object { $_.OutputKey -in @('ClientInstanceId','BackendInstanceId') } | ForEach-Object OutputValue)
if ($ids.Count -ne 2) { throw 'Revisar outputs antes de detener recursos.' }
aws ec2 stop-instances --profile pulumi-lab --region us-east-2 --instance-ids $ids --no-cli-pager
aws ec2 wait instance-stopped --profile pulumi-lab --region us-east-2 --instance-ids $ids
```

La eliminacion definitiva se prepara por separado con respaldo y decision sobre Retain. No se incluye un script de destruccion automatico. Eliminar un stack tampoco borra sus copias de template en S3 ni recursos retenidos.

## Guion breve para el docente

1. Explicar YAML: Parameters son entradas, Resources describen infraestructura, Ref/GetAtt relacionan recursos y Outputs muestran resultados.
2. Comparar el ZIP: ejemplo minimo S3+una EC2 frente a red completa y dos EC2 con controles explicitos.
3. Ejecutar los tres escaneres, distinguir hallazgos de errores y explicar por que no son lo mismo que CVE de dependencias.
4. Ejecutar controles negativos y mostrar que las herramientas detectan cambios inseguros sin desplegarlos.
5. Crear/revisar change set, aprovisionar y mostrar CREATE_COMPLETE/Resources/Outputs/SSH.
6. Explicar estado administrado por AWS, costos, retencion y detencion de instancias.

Fuentes: [CloudFormation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/Welcome.html), [cfn-lint](https://github.com/aws-cloudformation/cfn-lint), [Guard](https://github.com/aws-cloudformation/cloudformation-guard), [Trivy CloudFormation](https://trivy.dev/docs/latest/guide/coverage/iac/cloudformation/), [Conftest](https://www.conftest.dev/), [Gitleaks](https://github.com/gitleaks/gitleaks).

## Actualizar el laboratorio existente

Para esta cuenta, los buckets fueron retenidos durante un rollback y despues reincorporados. Usar:

```powershell
.\scripts\New-ChangeSet.ps1 -ChangeSetType UPDATE -RecoverRetainedBuckets
```

El switch mantiene sus nombres literales y solo importa buckets pendientes; no los recrea. Conserva la representacion YAML de las referencias para evitar reemplazos por conversion a JSON. El script no ejecuta cambios, bloquea modificaciones en instancias, eliminaciones y reemplazos no previstos. Revisar cada propuesta antes de ejecutarla. La lista de IP de npm/MySQL requiere mantenimiento; ver `scripts/refresh-egress.py` y `policies/egress-observations.json`. Las descargas comprobadas no demuestran que todos los paquetes, redirects o dominios de dependencias esten autorizados.
