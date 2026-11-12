# Remediacion de Trivy, 23-10-2026

**Estado actual:** desplegada y comprobada; ambas EC2 detenidas. Permanece solo la excepcion AWS-0132. Las secciones de preparacion y recuperacion mas abajo describen el historial, no tareas aun pendientes.

## Evidencia posterior del estudiante

El change set 20261023122548 termino UPDATE_COMPLETE. Los buckets fueron importados sin sustituir EC2. Flow Log fl-0127d5d0ee468ecdf: ACTIVE, SUCCESS, REJECT, sin error. Las reglas efectivas de ambos grupos usan pl-7ba54012 (S3) y pl-088b9d315acf679c3 (descargas), sin destinos 0.0.0.0/0 ni ::/0; API cliente-backend conservada. Las instancias se confirmaron stopped y luego se iniciaron temporalmente para comprobar descargas.

Desde backend, dnf makecache y consulta HTTPS de express en npm funcionan. repo.mysql.com falla por timeout: getent y curl en Ohio resuelven 23.60.130.135, diferente de 23.202.26.152 observada en el PC. Se agrega 23.60.130.135/32 y evidencia revisable en policies/egress-observations.json. refresh-egress.py conserva las observaciones aprobadas de EC2 al renovar DNS local; revisar y retirar observaciones obsoletas manualmente, sin ampliar redes. Posteriormente se aplicaron los change sets 20261023124528 y 20261023125411: se autorizo tambien 23.218.14.236/32 observada en el cliente. La descarga MySQL devolvio HTTP 200 desde ambos servidores. Amazon Linux y npm tambien funcionaron. Las dos EC2 volvieron a stopped. No se verifico una instalacion completa de dependencias. Reporte local 20261023-124412: cfn-lint, Guard, Conftest y Gitleaks 0; Trivy mantiene solo la excepcion AWS-0132.

El switch RecoverRetainedBuckets tambien conserva nombres literales tras la importacion: consulta los buckets ya administrados y espera importar solo los pendientes (cero si ambos ya estan en la pila). No hay que volver a crearlos. La evidencia de intentos anteriores que sigue abajo es historica.

## Historial de preparacion y recuperacion

En la fase inicial se preparo y probo localmente antes de aplicar a AWS.
La actualizacion paso del template inicial de 23 recursos al actual de 33.

## Intento de actualizacion y recuperacion pendiente

El estudiante ejecuto el change set de las 09:59:41. Los eventos de AWS muestran que VpcRejectFlowLog llego a CREATE_COMPLETE, pero a las 10:04:19 la pila inicio rollback con `Attribute 'PublicIp' does not exist`. Las EC2 estaban detenidas y las salidas intentaban resolver sus IP publicas. Termino UPDATE_ROLLBACK_COMPLETE a las 10:04:33. No aparecieron eventos CREATE_FAILED/UPDATE_FAILED: el motivo estaba en UPDATE_ROLLBACK_IN_PROGRESS de la pila.

Correccion local: IncludePublicOutputs por defecto false condiciona las cinco salidas dependientes de PublicIp. Mantener false al actualizar con instancias detenidas; consultar IP actual con EC2 cuando se inicien. cfn-lint y comprobacion de condiciones pasan. No modifica ni inicia las instancias.

**No reintentar aun:** AccessLogsBucket y FlowLogsBucket aparecen DELETE_SKIPPED por Retain; sus politicas fueron eliminadas. Consultar contenido y versiones, verificar configuracion y planificar su reincorporacion al stack o una limpieza autorizada. No borrar datos ni cambiar nombres para ocultar recursos retenidos. La recuperacion todavia esta pendiente.

Preparacion posterior: el estudiante confirmo dos versiones de un marcador vacio en FlowLogsBucket y AccessLogsBucket vacio, sin truncamiento. Guardo el template vigente como stack-actual.local.json. Se compararon los recursos existentes: solo difieren las cuatro reglas previstas. New-ChangeSet.ps1 admite `-ChangeSetType UPDATE -RecoverRetainedBuckets`: verifica cuenta y propietario de los buckets, genera recovery-template.local.yaml con sus dos BucketName literales, y habilita auto-import. Se exige que el change set muestre exactamente dos acciones Import de esos buckets y se mantienen los bloqueos sobre EC2 y reemplazos no previstos. No ejecuta el change set ni borra objetos. Se esperan dos Import, ocho Add y cuatro Modify; requiere revision de la respuesta real de AWS antes de ejecutar. Importar no sustituye una comprobacion posterior de drift y de las politicas efectivas.

Referencia: [importacion automatica de recursos nombrados durante CREATE/UPDATE](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/import-resources-automatically.html). AWS requiere nombres estaticos, Retain y recursos no administrados por otra pila. La variante local satisface el requisito de nombres sin fijar cuenta/region en el template principal.

## Los cinco hallazgos originales

| Hallazgo | Cambio preparado | Limite |
| --- | --- | --- |
| AWS-0104, cuatro reglas HTTP/HTTPS | Sustituir destino global por ApprovedDownloads (PrefixList con IPv4 /32 de registry.npmjs.org y repo.mysql.com) | Instantanea DNS; requiere mantenimiento y prueba desde EC2 |
| AWS-0178, VPC sin Flow Logs | VpcRejectFlowLog registra REJECT en S3 privado | Hay cargos de entrega y almacenamiento; no captura contenido de paquetes ni trafico ACCEPT |

Para AL2023 se agregan cuatro reglas hacia la prefix list **administrada por AWS** `com.amazonaws.us-east-2.s3`. New-LabParameters.ps1 consulta su ID regional; el ID de parameters.scan.json es ficticio y sirve exclusivamente al scanner. No se crea un endpoint ni un NAT Gateway.

La lista S3 permite S3 regional, no solo un bucket de repositorios. Las IPv4 de CDN pueden alojar otros dominios: esto restringe destinos de red, **no** aplica filtrado de dominios ni inspeccion TLS. Mantener validacion TLS y no desactivar verificaciones GPG. Las reglas cubren TCP 80/443; los SG no filtran el resolver DNS provisto por AWS.

## Mantenimiento de descargas

Desde infra/cloudformation:

```powershell
.\.tools\venv\Scripts\python.exe .\scripts\refresh-egress.py
git diff -- templates/asistencia.yaml
.\scripts\Invoke-Scans.ps1
```

El actualizador modifica solo el bloque de Entries de ApprovedDownloads; consulta exclusivamente los dos hosts fijados en el script, exige IPv4 publicas /32 y falla si supera 20 entradas. No despliega. La lista reservada de 20 entradas consume cuota por regla aunque tenga menos entradas: dos reglas consumen 40 unidades por SG, mas las reglas S3 y API, dentro de la cuota estandar de 60. No aumentar MaxEntries sin revisar cuotas.

DNS puede variar entre el PC y Ohio. Antes de dar el trabajo por terminado, probar `dnf makecache`, npm y el repositorio MySQL desde las instancias, revisar los destinos/redirects que realmente utilizan y actualizar la lista mediante un change set. No autorizar una direccion obtenida de un error sin verificar su pertenencia al repositorio. Nuevas descargas, GitHub, tarballs externos o redirects a otros dominios no quedan autorizados automaticamente.

## Excepcion elegida por el estudiante

EXC-S3-001: Trivy **AWS-0132 HIGH**, solamente FlowLogsBucket, solicita una clave KMS administrada por el cliente. Se conserva SSE-S3 AES256 por presupuesto del laboratorio, decision explicita del estudiante el 23-10-2026. No es ausencia de cifrado. Se renuncia al control independiente y auditoria de uso de una clave KMS propia. Revisar antes de usar datos sensibles o pasar a produccion, y al cambiar el presupuesto.

El hallazgo **no se ignora ni se elimina del reporte**. Invoke-Scans.ps1 sigue terminando con error porque Trivy retorna 1. Solo esta excepcion conocida puede revisarse manualmente; cualquier otro hallazgo o error de ejecucion exige investigacion. No afirmar que todos los scans estan en verde ni agregar una exclusion global AWS-0132.

Ambos buckets: bloqueo publico, versionado, politica que exige HTTPS y expiracion de versiones actuales a los 7 dias y anteriores 7 dias despues de volverse no actuales. Las eliminaciones por lifecycle son asincronas. El bucket de acceso usa SSE-S3 y recibe auditoria del principal; no se registra a si mismo recursivamente. Los dos tienen Retain: siguen existiendo y pueden costar tras borrar el stack. El backend Retain original se conserva.

## Verificacion local y procedimiento de despliegue

Reportes privados `reports/20261023-092835`: cfn-lint 0, Guard 0, Conftest 0, Gitleaks 0; Trivy 1 con **unicamente AWS-0132**. Los cinco hallazgos originales ya no aparecen en este template local. `reports/negative-9f210b78`: al introducir salida global y quitar Flow Logs, Guard, Conftest y Trivy los detectan; Gitleaks detecta el secreto ficticio. No se han probado aun descargas, permisos ni entrega de logs en AWS.

1. Regenerar parametros con New-LabParameters.ps1 para obtener el ID S3 real.
2. Agregar la politica adicional permissions/flow-logs-lab.json al usuario del laboratorio mediante una identidad administradora. No sustituir sus permisos anteriores. No necesita IAM PassRole ni KMS. Los permisos EC2 existentes cubren prefix lists y Flow Logs.
3. Consultar interfaces y grupos de ambas EC2 para confirmar que solo afectan al laboratorio. Mantener detenidas las EC2 de Pulumi.
4. Preparar `scripts/New-ChangeSet.ps1 -ChangeSetType UPDATE`. Nunca ejecutar CREATE sobre el stack existente.
5. Revisar diff: se esperan diez recursos nuevos y cuatro reglas modificadas; no cambios en instancias, discos, VPC o subred. El script permite el reemplazo esperado de las cuatro reglas de salida; rechaza cambios en instancias EC2, eliminaciones y otros reemplazos, incluido si el parametro SSM resolviera una AMI nueva. En ese caso detenerse y resolver sin reemplazar servidores.
6. Solo despues de revision y decision del estudiante, ejecutar desde la consola AWS. Confirmar UPDATE_COMPLETE, grupos aplicados y politica del bucket que conserva DenyInsecureTransport.
7. Verificar descargas reales y FlowLogStatus ACTIVE/DeliverLogsStatus SUCCESS; la entrega S3 es asincrona, no esperar archivos instantaneos ni provocar escaneos externos. Probar un rechazo controlado entre servidores del propio lab. Detener EC2 al terminar.

## Fuentes

- [AWS PrefixList en CloudFormation](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-prefixlist.html)
- [Listas administradas por AWS y pesos de cuota](https://docs.aws.amazon.com/vpc/latest/userguide/working-with-aws-managed-prefix-lists.html)
- [Permisos S3 para VPC Flow Logs](https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs-s3-permissions.html)
- [VPC Flow Logs](https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html)

La propuesta 20261023122222 fue bloqueada porque AWS marco NetworkInterfaces de ambas instancias como DirectModification/Always. La comparacion normalizada mostraba equivalencia; la variante JSON cambiaba la representacion GetAtt respecto del YAML desplegado. Se retiro esa conversion del flujo de recuperacion: ahora solo se sustituyen literalmente los dos BucketName, conservando todo el resto del YAML. cfn-lint pasa y una comparacion textual confirma solo esas dos sustituciones. El siguiente change set debe confirmar que desaparecen los reemplazos; no ejecutar el anterior.
