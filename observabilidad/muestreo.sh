set -eu
export LC_ALL=C

read -r -a cpu1 < /proc/stat
sleep 1
read -r -a cpu2 < /proc/stat
awk -v a="${cpu1[*]}" -v b="${cpu2[*]}" 'BEGIN {
    split(a,x," "); split(b,y," ")
    for(i=2;i<=9;i++) total+=y[i]-x[i]
    idle=y[5]-x[5]+y[6]-x[6]
    if(total>0) printf "cpu_ratio=%.6f\n", (total-idle)/total
}'
awk '/^MemTotal:/ {total=$2} /^MemAvailable:/ {disponible=$2}
    END {if(total>0) printf "memoria_ratio=%.6f\n", (total-disponible)/total}' /proc/meminfo

case "$ROL" in
    frontend)
        portada=$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1/ || true)
        if [ "$portada" = 200 ]; then echo 'servicio_up=1'; else echo 'servicio_up=0'; fi
        api=$(curl -s --max-time 5 -o /dev/null -w '%{http_code} %{time_total}' http://127.0.0.1/api/me || true)
        read -r codigo segundos <<< "$api"
        if [ "$codigo" = 401 ]; then
            echo 'api_up=1'
            printf 'api_latencia_seconds=%s\n' "$segundos"
        else
            echo 'api_up=0'
        fi
        if [ -f /var/log/nginx/pfm2-api.log ]; then
            ahora=$(date +%s)
            awk -v inicio="$((ahora - 300))" '$1 >= inicio && $2 >= 500 && $2 < 600 {errores++}
                END {printf "api_errores_5m=%d\n", errores}' /var/log/nginx/pfm2-api.log
        fi
        ;;
    backend)
        if systemctl is-active --quiet asistencia; then echo 'servicio_up=1'; else echo 'servicio_up=0'; fi
        ;;
    database)
        if mysql --defaults-file=/root/.my.cnf --connect-timeout=3 -Nse 'SELECT 1' >/dev/null 2>&1; then
            echo 'servicio_up=1'
        else
            echo 'servicio_up=0'
        fi
        ;;
esac
