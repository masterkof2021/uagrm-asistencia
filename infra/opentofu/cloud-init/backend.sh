retry dnf install -y nodejs24 nodejs24-npm
fetch_app
cd /opt/asistencia
retry npm-24 ci --omit=dev
getent passwd asistencia >/dev/null || useradd --system --user-group --no-create-home asistencia
db_password=$(read_secret db)
admin_password=$(read_secret admin)
install -o root -g asistencia -m 0640 /dev/null .env.backend
cat > .env.backend <<ENV
BACKEND_HOST=$backend_ip
PORT=8090
FRONTEND_ORIGINS=$web_origin
TRUSTED_PROXIES=$frontend_ip
DB_HOST=$database_ip
DB_PORT=3306
DB_USER=asistencia
DB_PASSWORD=Aa1!$db_password
DB_NAME=uagrm_asistencia
ADMIN_USER=admin
ADMIN_PASSWORD=$admin_password
INSTITUTION_TIMEZONE=America/La_Paz
ENV
unset db_password admin_password
retry /usr/bin/node-24 --env-file=.env.backend scripts/init-db.js
sed 's|/usr/bin/node |/usr/bin/node-24 |' deploy/backend/asistencia.service > /etc/systemd/system/asistencia.service
systemctl daemon-reload
systemctl enable --now asistencia
