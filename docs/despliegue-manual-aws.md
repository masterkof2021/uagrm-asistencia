# Despliegue manual completo en AWS · Globomatics

Esta guía parte de los dos EC2 ya aprovisionados para el laboratorio y termina con la aplicación funcionando como servicios del sistema. Todos los comandos de instalación y configuración se ejecutan manualmente. El despliegue de la aplicación no requiere volver a aplicar la infraestructura.

Está preparada para **Amazon Linux 2023 x86_64, kernel 6.18**, con un servidor cliente Nginx y un servidor backend Node.js 24 + MySQL Community 8.4. Los ejemplos corresponden al código y al estado local de OpenTofu consultados el **16 de octubre de 2026**. Las instalaciones y las pruebas en los EC2 deben realizarlas quien siga esta guía; redactarla no las ha ejecutado.

## 1. Identificar dónde ejecutar cada comando

Se utilizarán tres terminales:

- **LOCAL:** tu computadora, en la raíz de este repositorio. Desde aquí se crean los paquetes y se copian con SCP.
- **BACKEND:** sesión SSH en el EC2 backend, como `ec2-user`.
- **CLIENTE:** sesión SSH en el EC2 cliente, como `ec2-user`.

Los comandos requieren Bash. Ejecuta los apartados en orden y detente si aparece un error. `sudoedit` abre el editor configurado; si necesitas uno sencillo, instala `nano` y usa `EDITOR=nano sudoedit RUTA`. Los textos `REEMPLAZAR_...` deben sustituirse antes de utilizar la configuración.

### Direcciones del despliegue actual

| Dato | Cliente | Backend |
|---|---|---|
| Nombre | `ec2-cliente-globomatics-lab` | `ec2-backend-globomatics-lab` |
| ID de instancia | `i-0b8c3e57a2831a597` | `i-074e5a49871b500f9` |
| IP pública observada | `18.217.126.171` | `18.117.100.115` |
| IP privada | `10.42.1.10` | `10.42.1.20` |
| Servicio de aplicación | Nginx, TCP 80/443 | Node.js/Express, TCP 8090 |
| Base de datos | No se instala | MySQL, `127.0.0.1:3306` |

Región: `us-east-2`. Clave SSH privada: `~/globomatics-ec2`. Usuario SSH de Amazon Linux: `ec2-user`.

La IaC con Pulumi se encuentra en [`infra/pulumi`](../infra/pulumi/README.md). Consulta las salidas del stack Pulumi desde `asistencia/` con los siguientes comandos. El adaptador utiliza la sesión temporal de AWS CLI y utiliza el backend S3 compartido configurado en el proyecto.

Confirma las direcciones antes de empezar, desde **LOCAL**:

```bash
cd '/home/borysquiroga/Documentos/docs/Diplomado/Módulo 2/asistencia'
(cd infra/pulumi && python3 scripts/aws-session.py pulumi stack output servers)
(cd infra/pulumi && python3 scripts/aws-session.py pulumi stack output ssh_commands)
```

`output` lee el estado; si un EC2 se detuvo/inició desde la consola, comprueba también su IP pública actual en **AWS → EC2 → Instances**, en `us-east-2`. Las IP públicas automáticas pueden cambiar. En los siguientes comandos utiliza siempre las IP vigentes.

### Recorrido de una petición

```text
Navegador → IP pública/dominio del CLIENTE:80 o :443
          → Nginx: /api/... → 10.42.1.20:8090/api/...
                          → Node.js → 127.0.0.1:3306 → MySQL
```

El navegador utiliza `/api` en el mismo origen del sitio. La configuración manual de Nginx es necesaria para que funcione con el grupo de seguridad del backend, que permite 8090 solo desde el cliente. No se configura la IP pública del backend en el JavaScript del navegador.

## 2. Comprobar acceso y preparar el equipo local

**LOCAL:** comprueba que tienes `ssh`, `scp`, `tar`, `sha256sum` y la clave privada. OpenTofu solo hace falta para consultar las salidas anteriores.

```bash
command -v ssh scp tar sha256sum
test -f "$HOME/globomatics-ec2"
chmod 600 "$HOME/globomatics-ec2"

SSH_KEY="$HOME/globomatics-ec2"
CLIENT_PUBLIC=18.217.126.171
BACKEND_PUBLIC=18.117.100.115
```

Mantén esta terminal abierta: las variables se usan al copiar y actualizar archivos. Si abres otra, vuelve a definirlas. No copies la clave privada a ninguno de los servidores.

Los grupos de seguridad deben conservar estas entradas:

| Destino | Puerto | Origen |
|---|---|---|
| Ambos EC2 | TCP 22 | Tu IP pública administrativa, actualmente `181.114.108.136/32` |
| Cliente | TCP 80 y 443 | Internet, `0.0.0.0/0` |
| Backend | TCP 8090 | Grupo de seguridad del cliente |
| Backend | TCP 3306/33060 | Sin entrada desde la red |

Desde **LOCAL**, abre las dos sesiones en terminales distintas:

```bash
# Terminal BACKEND
ssh -i "$SSH_KEY" "ec2-user@$BACKEND_PUBLIC"

# Terminal CLIENTE, desde otra terminal LOCAL con las variables definidas
ssh -i "$SSH_KEY" "ec2-user@$CLIENT_PUBLIC"
```

En la primera conexión verifica la identidad del servidor antes de aceptar su huella SSH. Si hay un timeout, revisa IP, estado del EC2, ruta a Internet y la IP autorizada para SSH. Los EC2 no admiten SSH entre sí con las reglas actuales; todas las copias salen de tu equipo local.

## 3. Preparación común de ambos servidores

Ejecuta este bloque **una vez en BACKEND y una vez en CLIENTE**:

```bash
cat /etc/os-release
uname -m
uname -r
ip -4 address show
df -h /
free -h

sudo dnf upgrade --refresh -y
sudo dnf install -y tar gzip curl openssl nano chrony
sudo timedatectl set-timezone America/La_Paz
sudo systemctl enable --now chronyd
timedatectl
chronyc tracking
```

Esperado: Amazon Linux 2023, arquitectura `x86_64`, kernel de la familia 6.18 y la IP privada correcta. La zona horaria del servidor facilita leer registros; la aplicación también usa `INSTITUTION_TIMEZONE=America/La_Paz`. No cambies la configuración de sincronización de hora de AWS si ya funciona.

Si la actualización instaló un kernel nuevo y necesitas cargarlo, ejecuta `sudo reboot`, espera a que vuelva y reconecta por SSH desde LOCAL. Un reinicio normal no equivale a detener/iniciar la instancia desde AWS.

### Swap para el backend t3.micro

El backend comparte la memoria entre MySQL y Node.js. Antes de instalar MySQL revisa `free -h` y `swapon --show`. Si no hay swap, puedes crear 1 GiB **solo en BACKEND**:

```bash
swapon --show
if [ ! -e /swapfile ] && [ -z "$(swapon --show --noheadings)" ]; then
  sudo dd if=/dev/zero of=/swapfile bs=1M count=1024 status=progress &&
  sudo chmod 600 /swapfile &&
  sudo mkswap /swapfile &&
  sudo swapon /swapfile &&
  printf '/swapfile none swap sw 0 0\n' | sudo tee -a /etc/fstab
else
  printf 'Ya existe swap o /swapfile; revisar antes de crear otra.\n'
fi
swapon --show
free -h
```

No repitas la creación sobre un archivo existente. La swap ayuda ante picos; si la memoria se agota frecuentemente, revisa consumo y capacidad del EC2.

## 4. Empaquetar y copiar exactamente los archivos necesarios

**LOCAL, desde la raíz del proyecto**, crea un directorio temporal y dos paquetes. No se incluyen `.git`, `node_modules`, estados de OpenTofu, claves ni `.env.backend` con credenciales.

```bash
cd '/home/borysquiroga/Documentos/docs/Diplomado/Módulo 2/asistencia'
DEPLOY_DIR=$(mktemp -d /tmp/globomatics-deploy.XXXXXX)

tar -czf "$DEPLOY_DIR/backend.tar.gz" \
  package.json package-lock.json .env.backend.example \
  src scripts database deploy/backend

tar -czf "$DEPLOY_DIR/client.tar.gz" \
  public/index.html public/app.js public/styles.css public/config.js \
  deploy/client/asistencia.conf

tar -tzf "$DEPLOY_DIR/backend.tar.gz"
tar -tzf "$DEPLOY_DIR/client.tar.gz"
cd "$DEPLOY_DIR"
sha256sum backend.tar.gz > backend.sha256
sha256sum client.tar.gz > client.sha256

scp -i "$SSH_KEY" backend.tar.gz backend.sha256 "ec2-user@$BACKEND_PUBLIC:~/"
scp -i "$SSH_KEY" client.tar.gz client.sha256 "ec2-user@$CLIENT_PUBLIC:~/"

cd '/home/borysquiroga/Documentos/docs/Diplomado/Módulo 2/asistencia'
```

En **BACKEND**:

```bash
cd "$HOME"
sha256sum -c backend.sha256
mkdir -p "$HOME/globomatics-upload/backend"
tar -xzf backend.tar.gz -C "$HOME/globomatics-upload/backend"
ls -la "$HOME/globomatics-upload/backend"
```

En **CLIENTE**:

```bash
cd "$HOME"
sha256sum -c client.sha256
mkdir -p "$HOME/globomatics-upload/client"
tar -xzf client.tar.gz -C "$HOME/globomatics-upload/client"
ls -la "$HOME/globomatics-upload/client/public"
```

Ambos checksums deben indicar `OK`. No continúes con un paquete incompleto o alterado.

## 5. Backend: instalar Node.js 24

Todos los comandos de los apartados 5 a 10 se ejecutan en **BACKEND**.

Amazon Linux distribuye Node.js por versión, con ejecutables como `node-24` y `npm-24`. Esta guía usa la ruta específica en systemd para evitar cambios al seleccionar otra versión. [Documentación de Node.js en AL2023](https://docs.aws.amazon.com/linux/al2023/ug/nodejs.html).

```bash
sudo dnf install -y nodejs24 nodejs24-npm
sudo alternatives --set node /usr/bin/node-24
/usr/bin/node-24 --version
/usr/bin/npm-24 --version
node --version
command -v node-24 npm-24
```

Esperado: Node `v24.x`. No utilices una instalación de Node en el directorio personal de `ec2-user`: el servicio de la aplicación tiene `ProtectHome=true`.

Si DNF no encuentra los paquetes, consulta `sudo dnf check-release-update` y la versión de los repositorios de Amazon Linux antes de continuar. No sustituyas Node por una versión antigua: los scripts usan `--env-file`.

## 6. Backend: instalar MySQL Community 8.4

Se instalará **MySQL**, que es el motor utilizado por el proyecto. El repositorio oficial de MySQL publica RPM para EL9; Amazon Linux 2023 no figura entre las distribuciones soportadas en esa guía. El procedimiento siguiente usa esos RPM como opción de compatibilidad para este laboratorio: verifica que DNF resuelva correctamente todas sus dependencias. No se ha acreditado la instalación en estos EC2 al redactar este documento. [Plataformas e instalación del repositorio MySQL](https://dev.mysql.com/doc/mysql-yum-repo-quick-guide/en/).

Comprueba primero que no existe otro motor instalado:

```bash
rpm -qa | grep -Ei '^(mysql|mariadb)' || true
sudo ls /etc/yum.repos.d/
```

Si ya existe una base configurada, conserva sus datos y revisa su instalación antes de seguir. Los pasos siguientes son para un backend nuevo.

### 6.1. Añadir el repositorio de la familia 8.4

Se define explícitamente la ruta `el/9`: no se usa `$releasever`, que en Amazon Linux puede resolverse a `2023`. Este repositorio contiene solo la familia 8.4 y evita seleccionar otra versión mayor por defecto. [RPM oficiales MySQL 8.4 para EL9](https://repo.mysql.com/yum/mysql-8.4-community/el/9/x86_64/).

```bash
sudo curl --fail --location --proto '=https' \
  https://repo.mysql.com/RPM-GPG-KEY-mysql-2025 \
  -o /etc/pki/rpm-gpg/RPM-GPG-KEY-mysql-2025
sudo rpm --import /etc/pki/rpm-gpg/RPM-GPG-KEY-mysql-2025

sudo tee /etc/yum.repos.d/globomatics-mysql84.repo > /dev/null <<'REPO'
[globomatics-mysql84]
name=Globomatics - MySQL Community 8.4 EL9
baseurl=https://repo.mysql.com/yum/mysql-8.4-community/el/9/$basearch/
enabled=1
gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-mysql-2025
REPO

sudo dnf --refresh info mysql-community-server
```

Verifica que la versión ofrecida sea **8.4.x** y proceda de `globomatics-mysql84`. Si ya hay otros repositorios MySQL habilitados, no continúes hasta deshabilitar los que compiten por otra versión. No deshabilites el repositorio `amazonlinux`, necesario para dependencias.

Instala y comprueba:

```bash
sudo dnf install -y mysql-community-server
mysql --version
rpm -q mysql-community-server
```

Si hay un error de dependencias, firmas o clave vencida, detente y verifica la compatibilidad y la [clave publicada por MySQL](https://repo.mysql.com/RPM-GPG-KEY-mysql-2025). No fuerces la instalación con `--nodeps`, `--nogpgcheck` ni `gpgcheck=0`.

### 6.2. Escuchar solo en localhost

Guarda el archivo original y prepara un directorio de configuración:

```bash
sudo cp -a /etc/my.cnf /etc/my.cnf.globomatics-original
sudo install -d -m 755 /etc/my.cnf.d
sudo cat /etc/my.cnf
```

Verifica que `/etc/my.cnf` tenga una línea `!includedir /etc/my.cnf.d`. **Solo si no existe**, añádela:

```bash
printf '\n!includedir /etc/my.cnf.d\n' | sudo tee -a /etc/my.cnf
```

Crea la configuración del laboratorio:

```bash
sudo tee /etc/my.cnf.d/globomatics.cnf > /dev/null <<'MYSQLCONF'
[mysqld]
bind-address=127.0.0.1
port=3306
mysqlx=0
innodb_buffer_pool_size=128M
max_connections=30
MYSQLCONF

sudo mysqld --validate-config
sudo systemctl enable --now mysqld
sudo systemctl status mysqld --no-pager
sudo ss -lntp | grep -E ':3306\b|:33060\b' || true
```

Esperado: MySQL activo, escucha TCP en `127.0.0.1:3306` y sin 33060. Los límites de memoria/conexiones son una configuración inicial para el laboratorio. Se deshabilita X Plugin porque esta aplicación no lo usa. [Configuración de MySQL](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html) y [deshabilitación de X Plugin](https://dev.mysql.com/doc/refman/8.4/en/x-plugin-disabling.html).

### 6.3. Establecer la contraseña de administración y crear la base

Consulta la contraseña temporal y entra al cliente MySQL. La contraseña se solicita de forma interactiva; no la pongas como argumento del comando.

```bash
sudo grep 'temporary password' /var/log/mysqld.log
MYSQL_HISTFILE=/dev/null mysql -u root -p
```

En el indicador **`mysql>`**, sustituye los dos textos de contraseña por valores distintos y privados antes de ejecutar:

```sql
ALTER USER 'root'@'localhost' IDENTIFIED BY 'REEMPLAZAR_CLAVE_ROOT_MYSQL';

CREATE DATABASE IF NOT EXISTS uagrm_asistencia
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'asistencia'@'127.0.0.1'
  IDENTIFIED BY 'REEMPLAZAR_CLAVE_USUARIO_ASISTENCIA';
GRANT ALL PRIVILEGES ON uagrm_asistencia.* TO 'asistencia'@'127.0.0.1';

SHOW GRANTS FOR 'asistencia'@'127.0.0.1';
EXIT;
```

Usa contraseñas largas con mayúsculas, minúsculas, números y símbolos. Para facilitar el uso posterior en `.env`, evita comillas, barras invertidas, espacios y `#` en la contraseña de la cuenta de aplicación; por ejemplo puedes generar un valor con `openssl rand -base64 32` y guardarlo en tu gestor de contraseñas, comprobando que satisface la política de MySQL. No uses literalmente los marcadores del ejemplo.

La cuenta `asistencia` tiene permisos sobre su base, necesarios también para inicializar tablas, y no administra otras bases. Si ya existe, no la borres: comprueba sus permisos y cambia su contraseña con `ALTER USER` solo si corresponde. No se necesita `FLUSH PRIVILEGES` tras `CREATE USER`/`GRANT`.

Comprueba la conexión **TCP**, con la contraseña del usuario de aplicación:

```bash
mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u asistencia -p \
  -D uagrm_asistencia -e 'SELECT VERSION(), CURRENT_USER(), DATABASE();'
```

## 7. Backend: instalar los archivos y dependencias de la aplicación

Crea el usuario del servicio y copia el paquete ya verificado:

```bash
getent group asistencia || sudo groupadd --system asistencia
id asistencia || sudo useradd --system --gid asistencia \
  --home-dir /opt/asistencia --no-create-home --shell /sbin/nologin asistencia

sudo install -d -o ec2-user -g asistencia -m 750 /opt/asistencia
cp -a "$HOME/globomatics-upload/backend/." /opt/asistencia/
cd /opt/asistencia

/usr/bin/npm-24 ci --omit=dev
/usr/bin/node-24 --check src/server.js
```

`npm ci` usa el lockfile y descarga las dependencias en el servidor. No copies `node_modules` desde tu computadora ni ejecutes `npm audit fix --force` como parte del despliegue.

## 8. Backend: crear el archivo de entorno

```bash
cd /opt/asistencia
umask 077
cp .env.backend.example .env.backend
nano .env.backend
```

Deja el archivo con estos campos, reemplazando las contraseñas. Si cambió la IP pública del cliente, corrige los orígenes antes de guardar:

```dotenv
BACKEND_HOST=10.42.1.20
PORT=8090
FRONTEND_ORIGINS=http://18.217.126.171,http://ec2-18-217-126-171.us-east-2.compute.amazonaws.com
TRUSTED_PROXIES=10.42.1.10

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=asistencia
DB_PASSWORD=REEMPLAZAR_CLAVE_USUARIO_ASISTENCIA
DB_NAME=uagrm_asistencia

ADMIN_USER=admin
ADMIN_PASSWORD=REEMPLAZAR_CLAVE_ADMIN_APLICACION
INSTITUTION_TIMEZONE=America/La_Paz
```

- `DB_PASSWORD` debe ser exactamente la usada en `CREATE USER`.
- `ADMIN_PASSWORD` es la contraseña de acceso a la aplicación, distinta de las de MySQL y con al menos 12 caracteres. El login acepta hasta 200 caracteres.
- `FRONTEND_ORIGINS` acepta una lista separada por comas, sin espacios innecesarios ni barra final. Un origen es protocolo + host + puerto si no es el predeterminado. Añade el origen HTTPS cuando completes el apartado 13.
- `TRUSTED_PROXIES` identifica la IP privada del cliente; no uses `0.0.0.0/0`.
- No uses el archivo `.env.backend` local del desarrollador sin revisarlo: sus direcciones y credenciales pueden corresponder a otra instalación.

## 9. Backend: fijar permisos e inicializar la base

Después de instalar dependencias y editar el entorno:

```bash
sudo chown -R root:asistencia /opt/asistencia
sudo chmod -R u=rwX,g=rX,o= /opt/asistencia
sudo chmod 640 /opt/asistencia/.env.backend

cd "$HOME"
sudo -u asistencia /usr/bin/node-24 \
  --env-file=/opt/asistencia/.env.backend \
  /opt/asistencia/scripts/init-db.js
```

Con estos permisos, `ec2-user` ya no puede entrar directamente a `/opt/asistencia`: el acceso queda para `root` y el grupo `asistencia`. Por eso la inicialización se ejecuta como el usuario del servicio con rutas absolutas desde el directorio personal. Para editar después el entorno, utiliza `sudoedit /opt/asistencia/.env.backend`.

Esperado: `Base de datos lista. El administrador existente conserva su contraseña.` El script crea el esquema y la cuenta administrativa sin borrar registros existentes. Si ya había un administrador con ese nombre, cambiar `ADMIN_PASSWORD` en el entorno no cambia su contraseña guardada.

Verifica las tablas y la cuenta desde MySQL, sin mostrar hashes ni secretos:

```bash
mysql --protocol=TCP -h 127.0.0.1 -u asistencia -p \
  -D uagrm_asistencia \
  -e 'SHOW TABLES; SELECT id, username FROM administrators;'
```

Deben aparecer `administrators`, `modules`, `students`, `class_dates`, `attendances` y `activities`.

## 10. Backend: registrar Node.js como servicio systemd

Instala la unidad incluida en el repositorio y fija explícitamente Node 24:

```bash
sudo install -o root -g root -m 644 \
  /opt/asistencia/deploy/backend/asistencia.service \
  /etc/systemd/system/asistencia.service

sudo install -d -m 755 /etc/systemd/system/asistencia.service.d
sudo tee /etc/systemd/system/asistencia.service.d/globomatics.conf > /dev/null <<'UNIT'
[Unit]
Requires=mysqld.service
After=mysqld.service

[Service]
ExecStart=
ExecStart=/usr/bin/node-24 --env-file=/opt/asistencia/.env.backend /opt/asistencia/src/server.js
UNIT

sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/asistencia.service
sudo systemctl enable --now asistencia
sudo systemctl status asistencia --no-pager
sudo journalctl -u asistencia -n 50 --no-pager
sudo ss -lntp | grep ':8090\b'
```

Esperado: unidad activa y Node escuchando en **`10.42.1.20:8090`**. No ejecutes además `npm start`: habría dos procesos intentando ocupar el mismo puerto. El usuario `asistencia` puede leer el código y el entorno, pero no modificarlos.

Prueba la API desde el mismo backend:

```bash
curl -i --connect-timeout 3 http://10.42.1.20:8090/api/me
```

Esperado: **HTTP 401** y un mensaje que solicita iniciar sesión. Esta ruta requiere autenticación; 401 confirma que la API está respondiendo, aunque aún no prueba una consulta de base de datos. No uses `127.0.0.1:8090` para esta prueba: Node está enlazado a la IP privada.

## 11. Cliente: instalar Nginx y publicar los archivos estáticos

Los apartados 11 a 13 se ejecutan en **CLIENTE**, salvo los bloques identificados como LOCAL o BACKEND.

```bash
sudo dnf install -y nginx
sudo install -d -o root -g root -m 755 /var/www/asistencia
sudo install -o root -g root -m 644 \
  "$HOME/globomatics-upload/client/public/index.html" \
  "$HOME/globomatics-upload/client/public/app.js" \
  "$HOME/globomatics-upload/client/public/styles.css" \
  "$HOME/globomatics-upload/client/public/config.js" \
  /var/www/asistencia/
```

El cliente no necesita Node.js, npm, MySQL ni un proceso adicional de frontend. Solo se publican esos cuatro archivos. No copies archivos `.env`, fuentes del backend, claves o estados de OpenTofu a `/var/www/asistencia`.

### 11.1. Configuración principal de Nginx para este EC2 nuevo

El paquete puede traer un bloque `server` predeterminado en `/etc/nginx/nginx.conf`. Para evitar que se muestre la página inicial de Nginx, usa esta configuración principal mínima en el **servidor nuevo dedicado a esta aplicación**. Si el EC2 ya aloja otros sitios, integra los bloques sin reemplazar su configuración existente.

```bash
sudo cp -a /etc/nginx/nginx.conf /etc/nginx/nginx.conf.globomatics-original
sudo tee /etc/nginx/nginx.conf > /dev/null <<'NGINX'
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /run/nginx.pid;
include /usr/share/nginx/modules/*.conf;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    access_log /var/log/nginx/access.log;
    sendfile on;
    keepalive_timeout 65;
    include /etc/nginx/conf.d/*.conf;
}
NGINX
```

### 11.2. Configuración del sitio y proxy de la API

Copia el archivo entregado y cambia las direcciones del ejemplo por las del despliegue:

```bash
sudo install -o root -g root -m 644 \
  "$HOME/globomatics-upload/client/deploy/client/asistencia.conf" \
  /etc/nginx/conf.d/globomatics-client.conf

sudo sed -i \
  -e 's/listen 80;/listen 80 default_server;/' \
  -e 's/192\.168\.1\.30:8090/10.42.1.20:8090/' \
  -e 's/server_name _;/server_name 18.217.126.171 ec2-18-217-126-171.us-east-2.compute.amazonaws.com;/' \
  /etc/nginx/conf.d/globomatics-client.conf

sudo cat /etc/nginx/conf.d/globomatics-client.conf
sudo ls -l /etc/nginx/conf.d/
```

Confirma estos valores en el archivo, utilizando `sudoedit` si las direcciones actuales son diferentes:

```nginx
listen 80 default_server;
server_name 18.217.126.171 ec2-18-217-126-171.us-east-2.compute.amazonaws.com;
root /var/www/asistencia;

# Dentro de location /api/:
proxy_pass http://10.42.1.20:8090;
```

Conserva el resto del archivo: cabeceras de seguridad, límite de carga de 4 MB, rutas de archivos y cabeceras del proxy. **`proxy_pass` no lleva `/api` ni barra final**: Nginx conserva `/api/...` al reenviar. No agregues otro bloque duplicado para este sitio en `conf.d/`. [Comportamiento de `proxy_pass`](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass).

Verifica que el cliente estático siga apuntando al mismo origen:

```bash
cat /var/www/asistencia/config.js
```

Debe contener `apiBaseUrl: '/api'`. `.env.frontend` no se utiliza en este despliegue.

### 11.3. SELinux y firewall del sistema, si están activos

```bash
getenforce
sudo systemctl is-active firewalld || true
```

Amazon Linux 2023 trae SELinux en modo permisivo de forma predeterminada, pero comprueba el modo real. Si indica **Enforcing**, ejecuta en CLIENTE:

```bash
sudo dnf install -y policycoreutils-python-utils
sudo semanage fcontext -a -t httpd_sys_content_t '/var/www/asistencia(/.*)?'
sudo restorecon -Rv /var/www/asistencia
sudo setsebool -P httpd_can_network_connect 1
```

Si la regla de contexto ya existe, utiliza `semanage fcontext -m` en vez de `-a`. La política permite a Nginx leer el contenido y conectarse a la API; no es necesario deshabilitar SELinux. [SELinux en Amazon Linux 2023](https://docs.aws.amazon.com/linux/al2023/ug/selinux.html).

No es necesario instalar `firewalld` para este laboratorio: los grupos de seguridad ya limitan la red. **Si ya está activo**, revisa `sudo firewall-cmd --get-active-zones` y permite HTTP/HTTPS en la zona de la interfaz, conservando el acceso SSH. Para una zona llamada `public`:

```bash
sudo firewall-cmd --zone=public --permanent --add-service=http
sudo firewall-cmd --zone=public --permanent --add-service=https
sudo firewall-cmd --reload
```

En BACKEND, si también existe un firewall activo, permite TCP 8090 solo desde `10.42.1.10/32` en su zona real:

```bash
# BACKEND, solo si firewalld está activo y su zona es public.
sudo firewall-cmd --zone=public --permanent \
  --add-rich-rule='rule family="ipv4" source address="10.42.1.10/32" port port="8090" protocol="tcp" accept'
sudo firewall-cmd --reload
```

### 11.4. Comprobar el backend desde el cliente e iniciar Nginx

En **CLIENTE**:

```bash
curl -i --connect-timeout 3 http://10.42.1.20:8090/api/me
# Esperado: HTTP 401.

sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
sudo systemctl status nginx --no-pager
sudo ss -lntp | grep ':80\b'

curl -I http://127.0.0.1/
curl -i http://127.0.0.1/api/me
```

Esperado: configuración válida, interfaz HTTP 200 y `/api/me` HTTP 401. [Validación y recarga de Nginx](https://nginx.org/en/docs/beginners_guide.html).

## 12. Verificación desde el equipo local y el navegador

En **LOCAL**, con las variables del apartado 2:

```bash
curl -I "http://$CLIENT_PUBLIC/"
curl -fsS "http://$CLIENT_PUBLIC/config.js"
curl -i "http://$CLIENT_PUBLIC/api/me"
curl -i -H "Origin: http://$CLIENT_PUBLIC" "http://$CLIENT_PUBLIC/api/me"
curl -i -H 'Origin: http://origen-no-autorizado.invalid' "http://$CLIENT_PUBLIC/api/me"
```

Esperado: interfaz 200, configuración con `/api`, API 401 sin sesión —también con origen permitido— y 403 para el origen no autorizado. Esas respuestas pasan por Nginx y comprueban la comunicación entre ambos EC2.

Verifica además que el puerto del backend no sea público:

```bash
curl -v --connect-timeout 3 --max-time 5 "http://$BACKEND_PUBLIC:8090/api/me"
```

Esperado: timeout o conexión rechazada, sin respuesta de la API. El acceso a la base de datos tampoco debe estar publicado. Para usar credenciales reales desde Internet, completa HTTPS antes del login del apartado 14.

## 13. Habilitar HTTPS manualmente

El grupo de seguridad ya permite 443; el servicio TLS todavía debe configurarse en Nginx. Elige **una** de estas dos opciones.

### Opción A. Dominio propio y certificado público

Requisitos: disponer de un dominio/subdominio que controles, por ejemplo `asistencia.tudominio.com`, y acceso para modificar su DNS. El nombre DNS público de AWS observado en el estado no es un dominio propio para este procedimiento.

1. En tu proveedor DNS crea un registro **A** del nombre elegido hacia la IP pública actual del CLIENTE. Si existe un registro AAAA, debe apuntar a una conectividad IPv6 funcional; este despliegue usa IPv4.
2. Espera a que el DNS resuelva correctamente. En LOCAL puedes comprobarlo con `getent ahostsv4 asistencia.tudominio.com`.
3. En CLIENTE edita `/etc/nginx/conf.d/globomatics-client.conf`: agrega el dominio real a `server_name`. Ejecuta `sudo nginx -t` y `sudo systemctl reload nginx`.
4. En BACKEND agrega `https://asistencia.tudominio.com` a `FRONTEND_ORIGINS` en `/opt/asistencia/.env.backend`, conservando los orígenes que aún vayas a usar. Ejecuta `sudo systemctl restart asistencia`.

En **CLIENTE**, instala Certbot en un entorno Python dedicado. Las instrucciones oficiales describen esta instalación con pip; su compatibilidad en distribuciones menos habituales es de mejor esfuerzo. [Instrucciones oficiales de Certbot para Nginx](https://certbot.eff.org/instructions?ws=nginx&os=pip).

```bash
sudo dnf install -y python3 python3-pip
sudo python3 -m venv /opt/certbot
sudo /opt/certbot/bin/pip install --upgrade pip
sudo /opt/certbot/bin/pip install certbot certbot-nginx

sudo cp -a /etc/nginx/conf.d/globomatics-client.conf \
  /etc/nginx/conf.d/globomatics-client.conf.before-tls

# Sustituye el dominio y el correo antes de ejecutar.
sudo /opt/certbot/bin/certbot --nginx \
  -d asistencia.tudominio.com \
  --email REEMPLAZAR_CORREO_REAL --agree-tos --redirect

sudo nginx -t
sudo systemctl reload nginx
sudo /opt/certbot/bin/certbot certificates
sudo /opt/certbot/bin/certbot renew --dry-run
```

El desafío necesita que Internet alcance el puerto 80 del dominio. Certbot instala el certificado, adapta Nginx y configura la redirección HTTPS. Revisa la configuración resultante; conserva el proxy `/api/` y las restricciones de archivos. No uses los valores de ejemplo del dominio/correo literalmente.

Configura la renovación desatendida mediante un temporizador del sistema en CLIENTE:

```bash
sudo tee /etc/systemd/system/globomatics-certbot-renew.service > /dev/null <<'UNIT'
[Unit]
Description=Renovar certificado HTTPS de Globomatics
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/opt/certbot/bin/certbot renew --quiet --deploy-hook "systemctl reload nginx"
UNIT

sudo tee /etc/systemd/system/globomatics-certbot-renew.timer > /dev/null <<'TIMER'
[Unit]
Description=Comprobar certificado de Globomatics dos veces al dia

[Timer]
OnCalendar=*-*-* 00,12:00:00
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
TIMER

sudo systemctl daemon-reload
sudo systemctl enable --now globomatics-certbot-renew.timer
sudo systemctl list-timers globomatics-certbot-renew.timer
```

En **LOCAL** verifica `curl -I https://asistencia.tudominio.com/` sin `-k` y abre esa URL en el navegador. Comprueba que `http://asistencia.tudominio.com/` redirija. En el futuro, revisa periódicamente el registro del servicio de renovación y actualiza Certbot con `sudo /opt/certbot/bin/pip install --upgrade certbot certbot-nginx` en CLIENTE.

### Opción B. HTTPS de laboratorio por IP, con certificado autofirmado

Esta alternativa cifra el tráfico, pero el navegador mostrará una advertencia hasta que confíes explícitamente en el certificado del laboratorio. No ofrece la validación pública de identidad de la opción A. Si no necesitas HTTPS durante las pruebas preliminares puedes posponer este apartado, manteniendo pendiente el acceso seguro.

En **CLIENTE**, con la IP pública vigente:

```bash
sudo install -d -m 700 /etc/nginx/tls
sudo openssl req -x509 -nodes -newkey rsa:3072 -sha256 -days 90 \
  -keyout /etc/nginx/tls/globomatics.key \
  -out /etc/nginx/tls/globomatics.crt \
  -subj '/CN=18.217.126.171' \
  -addext 'subjectAltName=IP:18.217.126.171'
sudo chmod 600 /etc/nginx/tls/globomatics.key
sudo chmod 644 /etc/nginx/tls/globomatics.crt

sudo cp /etc/nginx/conf.d/globomatics-client.conf \
  /etc/nginx/conf.d/globomatics-client-https.conf
sudoedit /etc/nginx/conf.d/globomatics-client-https.conf
```

En la copia HTTPS reemplaza `listen 80 default_server;` por estas líneas y conserva el resto del bloque:

```nginx
listen 443 ssl default_server;
ssl_certificate /etc/nginx/tls/globomatics.crt;
ssl_certificate_key /etc/nginx/tls/globomatics.key;
ssl_protocols TLSv1.2 TLSv1.3;
```

No generes una copia HTTPS si ya ejecutaste la opción A. En **BACKEND**, añade `https://18.217.126.171` a `FRONTEND_ORIGINS` y reinicia `asistencia`. En **CLIENTE**:

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo ss -lntp | grep ':443\b'
sudo openssl x509 -in /etc/nginx/tls/globomatics.crt \
  -noout -subject -dates -ext subjectAltName
```

Para verificarlo desde **LOCAL** sin omitir la comprobación de certificado, copia únicamente el certificado público mediante SSH:

```bash
ssh -i "$SSH_KEY" "ec2-user@$CLIENT_PUBLIC" \
  'sudo cat /etc/nginx/tls/globomatics.crt' > "$DEPLOY_DIR/globomatics.crt"
curl --cacert "$DEPLOY_DIR/globomatics.crt" -I "https://$CLIENT_PUBLIC/"
```

Para el navegador importa ese certificado como confiable solo en el entorno de pruebas o acepta de forma consciente la excepción del laboratorio, tras comprobar su huella. No copies la clave privada TLS fuera del servidor. Debes renovar el certificado antes de que expire y regenerarlo si cambia la IP incluida en su SAN.

## 14. Primer uso y comprobación funcional completa

Desde **LOCAL**, abre la URL HTTP para una comprobación sin credenciales o la URL HTTPS configurada para iniciar sesión.

1. En la página de acceso selecciona **Administrador** y utiliza `ADMIN_USER` y la contraseña configurada antes de inicializar la base.
2. Confirma que el panel carga sin errores. Esta operación comprueba autenticación y consultas reales a MySQL, más allá del 401 de diagnóstico.
3. Crea un módulo con nombre reconocible. Descarga las plantillas de estudiantes y fechas desde la aplicación.
4. Completa una lista de prueba: registro como texto para conservar ceros, nombre completo y correo. En fechas incluye ayer, hoy y mañana con hora inicial menor que la final. Guarda en `.xlsx`, no CSV.
5. Importa ambos archivos, revisa la vista previa y confirma la activación. Los archivos admiten hasta 3 MB y 5000 filas; no uses fórmulas ni filas duplicadas.
6. Cierra sesión y entra como estudiante usando registro o correo del módulo activo. Verifica Falta para ayer sin marca, Pendiente para fechas sin asistencia y disponibilidad de marcar solo hoy.
7. Marca hoy y vuelve a intentar: debe existir una sola marca. Como administrador corrige una asistencia y revisa la actividad de auditoría.
8. Descarga el Excel de asistencia y comprueba que los estados coincidan con pantalla. Prueba también una importación válida mayor de 1 MB, dentro del límite de la aplicación, para verificar el proxy.
9. En las herramientas de desarrollo del navegador comprueba que las peticiones vayan a `/api/...` del **cliente**. No deben ir a la IP pública del backend ni presentar errores de CORS o contenido mixto.
10. En BACKEND ejecuta `sudo systemctl restart asistencia`. Vuelve a ingresar: las sesiones y borradores en memoria se pierden, pero módulos, estudiantes, asistencias y auditorías deben persistir.
11. Reinicia cada EC2 de forma controlada, uno a la vez, y comprueba los servicios con `systemctl is-active`. MySQL y `asistencia` deben arrancar en BACKEND; Nginx y el temporizador de certificados, si lo configuraste, en CLIENTE.

Después de la prueba puedes retirar los datos de laboratorio mediante el procedimiento de administración que corresponda. No borres la base para corregir un problema de configuración. El código actual no incluye una interfaz para restablecer la contraseña administrativa ni para consultar módulos históricos; no presupongas que cambiar `.env.backend` restablece una cuenta existente.

## 15. Copia de seguridad y recuperación

MySQL guarda sus datos en el disco raíz del backend. Haz un respaldo antes de actualizar o reemplazar ese EC2; destruirlo con OpenTofu elimina el disco según la configuración actual.

### 15.1. Crear y descargar un respaldo

En **BACKEND**, entra temporalmente a una shell de root. `-p` solicita la contraseña root de MySQL:

```bash
sudo -i
umask 077
install -d -m 700 /var/backups/globomatics
BACKUP_FILE="/var/backups/globomatics/asistencia-$(date +%Y%m%d-%H%M%S).sql"
mysqldump -u root -p --single-transaction --no-tablespaces \
  --set-gtid-purged=OFF --databases uagrm_asistencia > "$BACKUP_FILE"
```

Continúa solo si `mysqldump` terminó con código 0. Después, en la misma shell:

```bash
gzip "$BACKUP_FILE"
ls -lh "$BACKUP_FILE.gz"
install -o ec2-user -g ec2-user -m 600 "$BACKUP_FILE.gz" \
  /home/ec2-user/globomatics-backup.sql.gz
exit
```

En **LOCAL**:

```bash
mkdir -p "$HOME/globomatics-backups"
chmod 700 "$HOME/globomatics-backups"
BACKUP_LOCAL="$HOME/globomatics-backups/asistencia-$(date +%Y%m%d-%H%M%S).sql.gz"
scp -i "$SSH_KEY" "ec2-user@$BACKEND_PUBLIC:~/globomatics-backup.sql.gz" "$BACKUP_LOCAL"
chmod 600 "$BACKUP_LOCAL"
gzip -t "$BACKUP_LOCAL"
```

El respaldo contiene datos personales y hashes de contraseñas; guárdalo con acceso restringido, también fuera de la instancia. Conserva por separado las credenciales y configuraciones necesarias para recuperar el servicio. Un dump no incluye automáticamente los usuarios/grants de MySQL. [Opciones de `mysqldump`](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html).

### 15.2. Restauración controlada

Primero comprueba la restauración en una instalación de recuperación con la base vacía. El dump incluye instrucciones para reemplazar tablas: no lo importes encima de datos actuales sin respaldo y sin aceptar que se sobrescribirán.

1. Prepara MySQL y la cuenta `asistencia` siguiendo los apartados anteriores.
2. Desde LOCAL define la dirección del BACKEND de recuperación y sube el dump elegido:

```bash
# Sustituye por la IP real del equipo de recuperación.
RECOVERY_BACKEND_PUBLIC=REEMPLAZAR_IP_RECUPERACION
scp -i "$SSH_KEY" "$BACKUP_LOCAL" \
  "ec2-user@$RECOVERY_BACKEND_PUBLIC:~/globomatics-restore.sql.gz"
```

3. En BACKEND de recuperación detén la API, descomprime y carga el archivo:

```bash
sudo systemctl stop asistencia
umask 077
gzip -dc "$HOME/globomatics-restore.sql.gz" > "$HOME/globomatics-restore.sql"
mysql -u root -p < "$HOME/globomatics-restore.sql"
```

Solo si la importación termina correctamente:

```bash
sudo systemctl start asistencia
sudo systemctl status asistencia --no-pager
```

Repite la comprobación funcional. La contraseña administrativa restaurada es la del dump, no un nuevo valor de `ADMIN_PASSWORD`.

## 16. Actualizar la aplicación sin reinstalar servicios

1. Realiza y descarga el respaldo del apartado 15.
2. En LOCAL vuelve a crear los paquetes del apartado 4 con el código nuevo y cópialos. Los paquetes siguen excluyendo `.env.backend` y claves.
3. En cada EC2 extrae su paquete en un directorio de carga **nuevo**, para no mezclar archivos antiguos.
4. Conserva la versión anterior del código y del frontend antes de copiar los nuevos archivos.

En **BACKEND**, verifica y extrae el paquete nuevo (el directorio `backend-new` debe estar libre):

```bash
cd "$HOME"
sha256sum -c backend.sha256
mkdir "$HOME/globomatics-upload/backend-new"
tar -xzf backend.tar.gz -C "$HOME/globomatics-upload/backend-new"
```

Si ya existe `backend-new`, utiliza otro nombre de directorio vacío y ajusta los comandos siguientes. Una vez comprobado el paquete:

```bash
sudo systemctl stop asistencia
sudo cp -a /opt/asistencia "/opt/asistencia-backup-$(date +%Y%m%d-%H%M%S)"

sudo install -o root -g asistencia -m 640 \
  "$HOME/globomatics-upload/backend-new/package.json" \
  "$HOME/globomatics-upload/backend-new/package-lock.json" /opt/asistencia/
sudo cp -a "$HOME/globomatics-upload/backend-new/src/." /opt/asistencia/src/
sudo cp -a "$HOME/globomatics-upload/backend-new/scripts/." /opt/asistencia/scripts/
sudo cp -a "$HOME/globomatics-upload/backend-new/database/." /opt/asistencia/database/

cd "$HOME"
sudo /usr/bin/npm-24 --prefix /opt/asistencia ci --omit=dev
sudo chown -R root:asistencia /opt/asistencia
sudo chmod -R u=rwX,g=rX,o= /opt/asistencia
sudo chmod 640 /opt/asistencia/.env.backend
sudo systemctl start asistencia
sudo systemctl status asistencia --no-pager
```

No reemplaces `.env.backend` ni el override systemd. Si la nueva versión elimina archivos de código, retíralos conforme a ese cambio; la copia anterior no elimina archivos obsoletos. Si requiere cambios de esquema, revisa una migración específica antes del arranque: el inicializador actual crea tablas que faltan, no migra automáticamente columnas de tablas existentes. Para una actualización solo de código no es necesario repetirlo.

En **CLIENTE**, verifica y extrae de la misma forma, usando un directorio nuevo:

```bash
cd "$HOME"
sha256sum -c client.sha256
mkdir "$HOME/globomatics-upload/client-new"
tar -xzf client.tar.gz -C "$HOME/globomatics-upload/client-new"
```

Después publica los archivos:

```bash
sudo cp -a /var/www/asistencia "/var/www/asistencia-backup-$(date +%Y%m%d-%H%M%S)"
sudo install -o root -g root -m 644 \
  "$HOME/globomatics-upload/client-new/public/index.html" \
  "$HOME/globomatics-upload/client-new/public/app.js" \
  "$HOME/globomatics-upload/client-new/public/styles.css" \
  "$HOME/globomatics-upload/client-new/public/config.js" \
  /var/www/asistencia/
```

No vuelvas a copiar la configuración Nginx de ejemplo sobre la configuración real con TLS. Para cambios solo de estáticos no es necesario reiniciar Nginx. Si editas su configuración, ejecuta `sudo nginx -t` y después `sudo systemctl reload nginx`. Haz una recarga completa del navegador y prueba login y exportaciones.

Para volver a la versión anterior, identifica los directorios de respaldo creados en esa actualización. En BACKEND:

```bash
# Sustituye el nombre por el respaldo que acabas de crear.
BACKEND_ROLLBACK=/opt/asistencia-backup-REEMPLAZAR_FECHA
sudo test -f "$BACKEND_ROLLBACK/.env.backend"
# Continúa solo si el respaldo existe y corresponde a esta instalación.
sudo systemctl stop asistencia
sudo mv /opt/asistencia "/opt/asistencia-version-fallida-$(date +%Y%m%d-%H%M%S)"
sudo cp -a "$BACKEND_ROLLBACK" /opt/asistencia
sudo systemctl start asistencia
```

En CLIENTE restaura la versión correspondiente de los estáticos:

```bash
CLIENT_ROLLBACK=/var/www/asistencia-backup-REEMPLAZAR_FECHA
sudo test -f "$CLIENT_ROLLBACK/index.html"
# Continúa solo si has seleccionado el respaldo correcto.
sudo cp -a "$CLIENT_ROLLBACK/." /var/www/asistencia/
```

Si hubo migraciones incompatibles de base, la reversión requiere el procedimiento específico de esa migración; recuperar solo código puede ser insuficiente.

## 17. Comandos de operación y solución de problemas

### Backend

```bash
sudo systemctl status mysqld asistencia --no-pager
sudo systemctl is-enabled mysqld asistencia
sudo journalctl -u asistencia -n 100 --no-pager
sudo journalctl -u mysqld -n 100 --no-pager
sudo tail -n 100 /var/log/mysqld.log
sudo systemctl cat asistencia
sudo ss -lntp
free -h
df -h /
sudo journalctl -k --no-pager | grep -Ei 'out of memory|killed process' || true
```

Si reinicias MySQL manualmente, comprueba después la API y arráncala con `sudo systemctl restart asistencia` si se detuvo por su dependencia de MySQL.

### Cliente

```bash
sudo nginx -t
sudo systemctl status nginx --no-pager
sudo tail -n 100 /var/log/nginx/error.log
sudo tail -n 100 /var/log/nginx/access.log
sudo nginx -T
curl -i --connect-timeout 3 http://10.42.1.20:8090/api/me
```

| Síntoma | Revisar / corregir |
|---|---|
| SSH no conecta | IP pública vigente, IP administrativa permitida, clave y usuario `ec2-user`; no abrir 22 a todo Internet. |
| Página de bienvenida de Nginx | Otro `server` predeterminado; inspeccionar `nginx -T` y el archivo principal del apartado 11. |
| HTTP 502 | API detenida, IP/puerto de `proxy_pass`, permisos SELinux o reglas de red. Probar primero `curl` a la IP privada desde CLIENTE. |
| Timeout entre EC2 | Grupo correcto asociado a cada instancia, regla 8090 desde el grupo del cliente, firewall local, escucha de Node en `10.42.1.20`. |
| HTTP 403 / origen no permitido | Agregar el origen exacto con protocolo y puerto a `FRONTEND_ORIGINS` y reiniciar `asistencia`. |
| HTTP 401 en `/api/me` | Es normal sin token; volver a iniciar sesión si la API se reinició. |
| HTTP 404 en `/api/...` | Conservar el prefijo `/api`: quitar la barra final de `proxy_pass`. |
| HTTP 413 al importar | Conservar `client_max_body_size 4m`; el archivo sigue limitado a 3 MB por la API. |
| `EADDRINUSE` | Ya hay un proceso en 8090; usar solo systemd, no `npm start` simultáneo. |
| `EADDRNOTAVAIL` | `BACKEND_HOST` no es una dirección del EC2 backend actual. |
| MySQL `Access denied` | Cuenta `asistencia` para `127.0.0.1`, contraseña correcta y permisos sobre la base. Probar con `--protocol=TCP`. |
| API no puede leer `.env.backend` | Propietario `root:asistencia`, archivo 640 y ruta `/opt/asistencia` accesible al grupo. |
| `status=203/EXEC` | Comprobar `/usr/bin/node-24` y el override; no utilizar Node dentro de `/home/ec2-user`. |
| Login no acepta nueva clave admin | La cuenta ya existía: editar el entorno no cambia el hash guardado en MySQL. |
| MySQL/Node se detiene por memoria | Revisar registros del kernel, RAM y swap; ajustar consumo/capacidad. No borrar datos para recuperar memoria. |
| Certificado inválido | Dominio/IP debe coincidir con SAN, DNS vigente y certificado no vencido; en autofirmado se requiere confianza explícita. |
| HTTP funciona, HTTPS no | Nginx debe escuchar 443 con certificado, además de la regla de seguridad AWS. |

Si cambia la IP pública del cliente, actualiza DNS, orígenes del backend y nombres de Nginx que contengan la IP antigua. En un certificado autofirmado por IP también debes regenerar el SAN. La IP privada del backend se usa exclusivamente en el proxy y no se sustituye por su IP pública.

## 18. Lista final de entrega

- [ ] Cliente: solo Nginx y los cuatro archivos estáticos necesarios para la aplicación.
- [ ] Backend: Node.js 24, MySQL 8.4 y código en `/opt/asistencia`.
- [ ] MySQL en `127.0.0.1:3306`; X Plugin deshabilitado.
- [ ] API en `10.42.1.20:8090`, accesible desde CLIENTE y bloqueada desde Internet.
- [ ] `mysqld`, `asistencia` y `nginx` habilitados y activos en sus equipos correspondientes.
- [ ] Credenciales reales, diferentes y fuera del repositorio/directorio público.
- [ ] HTTPS configurado y comprobado según la opción elegida; renovación prevista.
- [ ] Login, importación, activación, marca, corrección y exportación verificados.
- [ ] Datos persisten tras reiniciar los servicios y EC2.
- [ ] Copia de seguridad descargada y procedimiento de restauración probado.
- [ ] Infraestructura OpenTofu conservada como aprovisionamiento básico, sin configuración de servidores.
