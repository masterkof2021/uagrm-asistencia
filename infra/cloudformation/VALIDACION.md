# Evidencia local y limites de la entrega

## Estado actual verificado, 23-10-2026

Evidencia proporcionada por el estudiante: UPDATE_COMPLETE, buckets reincorporados sin reemplazar EC2, Flow Log ACTIVE/SUCCESS/REJECT y sin error, grupos sin salidas globales IPv4/IPv6. `dnf makecache`, metadata de express en npm y descarga HTTPS de RPM-GPG-KEY-mysql-2025 funcionan desde cliente y backend. Se agregaron las IP de MySQL observadas en Ohio mediante dos actualizaciones exclusivas de ApprovedDownloads. Ambas EC2 quedaron stopped. No se verifico una instalacion completa de paquetes ni se instalo la aplicacion.

El template actual tiene 33 recursos. Reporte del estudiante `reports/20261023-130406`: cfn-lint 0, Guard 0, Conftest 0, Gitleaks 0 y Trivy 1 con exclusivamente AWS-0132 (SSE-S3 en vez de clave KMS propia, excepcion explicita de presupuesto). Pruebas negativas repetidas correctamente: `negative-c3ae5ee7` y `negative-151133ac`. Los reportes permanecen privados y excluidos de Git.

No se ha verificado aun drift de todos los recursos importados, contenido de registros de trafico rechazado en S3 ni retencion de CloudTrail. Ver REMEDIACION-TRIVY.md para alcance, costos y decisiones.

## Historial de la validacion inicial (23 recursos, antes de remediacion)


Fecha de revision: 23 de octubre de 2026, America/La_Paz. Se ejecutaron los escaneres en Windows, con Python 3.14 en un entorno aislado. Posteriormente el estudiante desplego el stack y compartio las salidas de AWS y SSH que se registran al final de este documento.

Compatibilidad comprobada adicionalmente con Windows PowerShell 5.1: se corrigio la captura de stderr nativo con `scripts/run-tool.py`, porque los mensajes INFO de Trivy se convertian en `NativeCommandError` antes de completar el runner. La repeticion completa genero la tabla de las cinco herramientas, con Trivy=1 por hallazgos y las otras cuatro=0. Reporte de esa comprobacion: `reports/20261023-031126/`. Los streams se conservan en archivos separados; no se ignoran los codigos de salida.

## Resultado del template principal

`templates/asistencia.yaml`: 11501 bytes, 23 recursos; dentro del limite inline de 51200 bytes. El archivo mantiene los mismos dos servidores y red funcional que Pulumi, con diferencias de seguridad documentadas en README.

| Comprobacion | Exit code | Resultado observado |
| --- | --- | --- |
| cfn-lint 1.58.0, region us-east-2 | 0 | Sin errores ni advertencias en el reporte JSON |
| CloudFormation Guard 3.2.1 | 0 | Cumple las cinco reglas locales: IMDSv2, discos cifrados, CPU standard, API privada y ausencia de ingreso global literal |
| OPA/Conftest 0.71.1 | 0 | Diez politicas evaluadas, sin denegaciones |
| Trivy 0.76.1, modo config/CloudFormation | 1 | Cinco hallazgos de configuracion, no un error de instalacion |
| Gitleaks 8.30.1, snapshot versionable | 0 | Sin secretos detectados por las reglas seleccionadas en ese alcance |
| Parser de PowerShell | 0 errores | Sintaxis valida en scripts ps1 |

Reportes crudos privados: `reports/20261023-011431/`. Estan excluidos de Git; repetir el runner genera un nuevo directorio. Las versiones Python transitivas se registraron con `pip freeze` en `requirements-scanners.lock.txt`; no es un lock con hashes de todas las dependencias. El instalador si verifica hashes fijados para los cuatro binarios portables.

## Hallazgos de Trivy sin ocultar

### AWS-0104: cuatro CRITICAL segun la herramienta

Recursos: `ClientHttpOutbound`, `ClientHttpsOutbound`, `BackendHttpOutbound`, `BackendHttpsOutbound`.

Cada regla permite destinos `0.0.0.0/0`, aunque solo para TCP 80 o 443. El scanner considera inseguro el destino global; la severidad es la asignada por su catalogo, no una prueba de explotacion. No es una regla de entrada ni expone directamente MySQL o SSH al mundo, pero permite salida a destinos externos y puede facilitar exfiltracion si un servidor se compromete.

Se redujo la salida original de todos los protocolos a HTTP/HTTPS y API privada. Persiste un riesgo: los repositorios de paquetes tienen destinos variables y el laboratorio necesita descargar software. Opciones de mejora: proxy de salida con control de dominios, mirror privado y/o endpoints apropiados para cada servicio. Las reglas de SG no aceptan nombres DNS como destinos; no sustituirlos por IP de ejemplo ni afirmar que un endpoint S3 cubre todo Internet.

No se han creado proxies, NAT Gateways, firewalls ni endpoints con cargo adicional. **El hallazgo no esta silenciado ni resuelto.** La decision de aceptar esta salida para la practica debe explicarse antes de ejecutar el change set; no presentarla como certificacion de seguridad.

### AWS-0178: un MEDIUM

No se habilitaron VPC Flow Logs. Los grupos de seguridad siguen funcionando, pero falta esa fuente de observabilidad de trafico. Remediacion posible: logs hacia CloudWatch o S3 con permisos de servicio y retencion controlada. Puede generar cargos por ingestion, almacenamiento y consultas. No se habilita automaticamente debido al presupuesto del laboratorio. Sigue pendiente.

## Remediacion posterior preparada localmente

La descripcion anterior corresponde al template desplegado inicialmente. El 23-10-2026 se prepararon cambios locales de egress y Flow Logs. Los cinco hallazgos originales ya no aparecen en el template local; permanece AWS-0132 por conservar SSE-S3, decision explicita del estudiante. Esta fase local fue seguida por el despliegue y las pruebas indicadas en Estado actual verificado. Ver [REMEDIACION-TRIVY.md](REMEDIACION-TRIVY.md) para evidencia, excepcion y limites.

## Controles negativos

Ejecutado `scripts/test-scanners.py`. Resultado: los cuatro controles verificaron rechazos esperados, sin modificar el template principal.

- Guard detecto IMDSv2 incumplido y disco sin cifrado.
- Conftest genero denegaciones para las configuraciones inseguras.
- Trivy genero hallazgos adicionales al quitar cifrado/IMDSv2 y abrir SSH.
- Gitleaks detecto y redacto un token artificial generado para la regla `lab-demo-token`. No se uso una credencial real ni se valido una cuenta externa.

Artefactos privados en `reports/negative-78dfa25a/`. El archivo `DO-NOT-DEPLOY.json` es exclusivamente una prueba negativa y no debe cargarse en AWS.

## Despliegue verificado en AWS

Evidencia proporcionada por el estudiante el 23 de octubre de 2026:

- Se corrigio el generador de parametros para escribir UTF-8 sin BOM, compatible con AWS CLI y Windows PowerShell 5.1.
- Se agrego el permiso faltante `ssm:GetParameters`, limitado al parametro publico de Amazon Linux usado por el template. La consulta devolvio `ami-053ef5d7ebe355f4a`.
- El script creo `asistencia-cfn-preview-20261023084717` con 23 acciones Add; se reviso antes de ejecutarlo desde la consola web.
- Antes de ejecutar se confirmaron detenidas las dos EC2 de Pulumi.
- `describe-stacks` devolvio `CREATE_COMPLETE` para `asistencia-cfn-lab`, region `us-east-2`.
- VPC nueva: `vpc-004a05a073b2e2d8f`.

| Rol | Instancia | IP privada | IP publica observada |
| --- | --- | --- | --- |
| Cliente | `i-09f218d4a58732914` | `10.42.1.10` | `18.118.217.231` |
| Backend | `i-04b7ab330a4930fb8` | `10.42.1.20` | `18.219.77.195` |

Las dos conexiones SSH con la clave privada conservada en el PC funcionaron. `hostname` mostro las IP privadas previstas y `/etc/os-release` identifico Amazon Linux `2023.12.20261021`. Las IP publicas son observaciones del despliegue y pueden cambiar al detener/iniciar.

No se instalaron Nginx/Node.js/MySQL ni se migraron datos a estas EC2 en esta validacion. Tampoco se comprobo comunicacion de API con procesos reales, retencion de auditoria/CloudTrail, actualizaciones de stack o eliminacion/recuperacion con Retain. Los cinco hallazgos iniciales fueron remediados posteriormente, como indica el estado actual al comienzo de este documento. No se debe administrar el mismo recurso desde Pulumi y CloudFormation. Al terminar la practica, detener las nuevas instancias o preparar una limpieza explicita, considerando el backend Retain y sus costos.
