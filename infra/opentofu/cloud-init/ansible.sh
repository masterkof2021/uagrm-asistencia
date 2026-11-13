umask 077
install -d -m 0700 /opt/pfm2 /etc/pfm2
cat > /etc/pfm2/arranque.yml <<'PFM2_PLAYBOOK'
