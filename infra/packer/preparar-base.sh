#!/bin/bash
set -euo pipefail

cloud-init status --wait
dnf install -y nginx nodejs24 nodejs24-npm
systemctl disable --now nginx

rpm -q nginx nodejs24 nodejs24-npm
node-24 --version
npm-24 --version
systemctl is-enabled amazon-ssm-agent

dnf clean all
if cloud-init clean --help | grep -F -- --machine-id >/dev/null; then
    cloud-init clean --logs --machine-id
else
    cloud-init clean --logs
    printf 'uninitialized\n' > /etc/machine-id
fi
