umask 077
install -d -m 0700 /etc/pfm2
cat > /etc/pfm2/capa.sh <<'PFM2_CAPA'
#!/bin/bash
set -euo pipefail
umask 022
app_commit="$PFM2_APP_COMMIT"
frontend_ip="$PFM2_FRONTEND_IP"
backend_ip="$PFM2_BACKEND_IP"
database_ip="$PFM2_DATABASE_IP"
web_origin="$PFM2_WEB_ORIGIN"
read_secret() {
    case "$1" in
        db) printf '%s' "$PFM2_DB_PASSWORD" ;;
        admin) printf '%s' "$PFM2_ADMIN_PASSWORD" ;;
        *) return 1 ;;
    esac
}
