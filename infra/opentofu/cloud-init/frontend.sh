retry dnf install -y nginx
fetch_app
install -d -m 0755 /var/www/asistencia
install -m 0644 /opt/asistencia/public/* /var/www/asistencia/
printf "%s\n" "log_format pfm2_api '\$msec \$status';" > /etc/nginx/conf.d/00-pfm2-metricas.conf
sed -e "s/192\.168\.1\.30:8090/$backend_ip:8090/" \
    -e 's/server_name _;/server_name ~^.+$;/' \
    -e '/location \/api\//a\        access_log /var/log/nginx/pfm2-api.log pfm2_api;' \
    /opt/asistencia/deploy/client/asistencia.conf > /etc/nginx/conf.d/asistencia.conf
nginx -t
systemctl enable --now nginx
