PFM2_PLAYBOOK
if [[ ! -x /opt/pfm2/ansible/bin/ansible-playbook ]]; then
    rpm -q python3.12 python3.12-pip >/dev/null || retry dnf install -y python3.12 python3.12-pip
    python3.12 -m venv /opt/pfm2/ansible
    retry /opt/pfm2/ansible/bin/pip install --no-cache-dir 'ansible-core==2.20.1'
fi
export PFM2_FRONTEND_IP="$frontend_ip" PFM2_BACKEND_IP="$backend_ip"
export PFM2_DATABASE_IP="$database_ip" PFM2_WEB_ORIGIN="$web_origin"
export PFM2_APP_COMMIT="$app_commit" PFM2_ROL="$pfm2_rol"
case "$pfm2_rol" in
    backend)
        PFM2_DB_PASSWORD=$(read_secret db)
        PFM2_ADMIN_PASSWORD=$(read_secret admin)
        export PFM2_DB_PASSWORD PFM2_ADMIN_PASSWORD
        ;;
    database)
        PFM2_DB_PASSWORD=$(read_secret db)
        export PFM2_DB_PASSWORD
        ;;
esac
if [[ "$pfm2_rol" != frontend ]]; then
    export -f retry fetch_app
fi
ANSIBLE_NOCOLOR=1 /opt/pfm2/ansible/bin/ansible-playbook -i localhost, -c local /etc/pfm2/arranque.yml
/opt/pfm2/ansible/bin/ansible-playbook --version
