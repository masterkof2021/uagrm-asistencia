# Observabilidad de tenants

El panel toma una muestra cada minuto de las tres EC2 de cada tenant operativo mediante AWS Systems Manager. Usa el perfil de despliegue del proyecto y las instancias que figuran en el registro local. Los tenants suspendidos y retirados quedan fuera del muestreo. Prometheus consulta el panel cada 15 segundos y conserva el historial en el equipo local.

Grafana muestra disponibilidad de Nginx, estado del servicio de la API y de MySQL, CPU, memoria, latencia y respuestas 5xx, con filtros por tenant y entorno. La sonda consulta `/api/me` a través de Nginx y espera HTTP 401, la respuesta normal de una sesión sin autenticar. MySQL se verifica con `SELECT 1`. El frontend registra la hora y el código HTTP de las rutas de API en `/var/log/nginx/pfm2-api.log`. La métrica de 5xx requiere que la EC2 se haya aprovisionado con esa configuración de Nginx.

Las reglas distinguen una sonda sin respuesta de un servicio caído. Los umbrales iniciales son 85 % de CPU o memoria durante tres minutos, más de un segundo de latencia durante dos minutos y al menos cinco respuestas 5xx en una ventana de cinco minutos durante un minuto. El panel muestra las alertas activas, el tenant, el entorno y la hora de detección en Bolivia. [Reglas de alertas de Prometheus](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/).

En **Tenants → Monitoreo → Eventos recientes** se muestran hasta 50 detecciones y resoluciones de las últimas 24 horas. El panel consulta las reglas de Prometheus cada 15 segundos y conserva en SQLite los eventos que observa, aunque la vista esté cerrada. La resolución se registra al observar que la alerta dejó de estar activa. Si Prometheus no responde o sus reglas aún no están disponibles, el panel conserva el historial y espera una lectura válida antes de registrar resoluciones. [API HTTP de Prometheus](https://prometheus.io/docs/prometheus/latest/querying/api/#rules).

## Arranque local en Windows

Descarga los archivos de Windows y extráelos en `observabilidad/data/herramientas/prometheus` y `observabilidad/data/herramientas/grafana`. Conserva una sola versión de cada herramienta en esos directorios. [Prometheus 3.16.0](https://github.com/prometheus/prometheus/releases/tag/v3.16.0) · [Grafana OSS 13.2.1](https://grafana.com/grafana/download/13.2.1?edition=oss&platform=windows).

Abre tres terminales PowerShell desde la raíz del repositorio. En la primera, configura el [perfil de despliegue de AWS](../plataforma/README.md#despliegue-desde-el-panel), cierra cualquier ejecución anterior del panel y arráncalo en su puerto predeterminado.

```powershell
$env:PFM2_MONITORING = '1'
npm.cmd --prefix plataforma start
```

En la segunda terminal, inicia Prometheus.

```powershell
$exe = (Get-ChildItem observabilidad/data/herramientas/prometheus -Recurse -Filter prometheus.exe).FullName
$datos = (Resolve-Path observabilidad/data).Path
& $exe --config.file=observabilidad/prometheus.yml "--storage.tsdb.path=$datos/prometheus" --web.listen-address=127.0.0.1:9090
```

En la tercera terminal, inicia Grafana. La base de datos, las credenciales locales y los registros quedan en `observabilidad/data`, fuera de Git.

```powershell
$exe = (Get-ChildItem observabilidad/data/herramientas/grafana -Recurse -Filter grafana.exe).FullName
$datos = (Resolve-Path observabilidad/data).Path
$env:GF_PATHS_PROVISIONING = (Resolve-Path observabilidad/grafana/provisioning).Path
$env:PFM2_GRAFANA_DASHBOARDS = (Resolve-Path observabilidad/grafana/dashboards).Path
$env:GF_PATHS_DATA = Join-Path $datos 'grafana'
$env:GF_PATHS_LOGS = Join-Path $datos 'grafana-logs'
$env:GF_SERVER_HTTP_ADDR = '127.0.0.1'
$env:GF_SERVER_HTTP_PORT = '3000'
New-Item -ItemType Directory -Force -Path $env:GF_PATHS_DATA,$env:GF_PATHS_LOGS | Out-Null
& $exe server --homepath (Split-Path (Split-Path $exe))
```

En un arranque nuevo, inicia sesión con el usuario y la contraseña iniciales `admin` y establece una contraseña propia cuando Grafana lo solicite. El dashboard y la conexión a Prometheus se cargan desde los archivos del repositorio. [Provisionamiento de Grafana](https://grafana.com/docs/grafana/latest/administration/provisioning/).

- [Alertas del panel](http://127.0.0.1:4173/#tenants)
- [Dashboard Salud de tenants](http://127.0.0.1:3000/d/pfm2-tenants)
- [Estado de la recolección en Prometheus](http://127.0.0.1:9090/targets)

El monitoreo local funciona mientras los procesos y la sesión de AWS estén activos. Al cerrar el panel, Prometheus detecta la pérdida de la fuente de métricas.

## Demostrar una alerta

1. Despliega un tenant temporal en el entorno **Pruebas**. Espera a que Grafana muestre sus tres servicios disponibles y cero errores 5xx.
2. En Systems Manager, ejecuta `systemctl stop asistencia` en la EC2 de backend de ese tenant. En la EC2 de frontend, consulta cinco veces `http://127.0.0.1/api/me` para provocar respuestas 502 mientras el backend está detenido.
3. Observa la caída y el aumento de 5xx en Grafana y en **Tenants → Alertas activas**. La sonda corre cada minuto y la regla de caída requiere dos minutos de evaluación sostenida.
4. Ejecuta `systemctl start asistencia` en la EC2 de backend. Comprueba que vuelva la disponibilidad y que **Eventos recientes** muestre la resolución de la alerta de caída. La alerta de errores puede continuar mientras las respuestas 5xx sigan dentro de la ventana de cinco minutos. Retira el tenant temporal desde el panel.
