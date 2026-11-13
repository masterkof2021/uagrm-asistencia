retry curl -fsSL --connect-timeout 10 https://repo.mysql.com/RPM-GPG-KEY-mysql-2025 \
    -o /etc/pki/rpm-gpg/RPM-GPG-KEY-mysql-2025
rpm --import /etc/pki/rpm-gpg/RPM-GPG-KEY-mysql-2025
cat > /etc/yum.repos.d/asistencia-mysql84.repo <<'REPO'
[asistencia-mysql84]
name=MySQL 8.4 Community EL9
baseurl=https://repo.mysql.com/yum/mysql-8.4-community/el/9/$basearch/
enabled=1
gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-mysql-2025
REPO
retry dnf install -y mysql-community-server
if ! swapon --show=NAME --noheadings | grep -qx /swapfile-asistencia; then
    if [[ ! -e /swapfile-asistencia ]]; then
        install -m 0600 /dev/null /swapfile-asistencia
        dd if=/dev/zero of=/swapfile-asistencia bs=1M count=1024 status=none
        mkswap /swapfile-asistencia
    fi
    swapon /swapfile-asistencia
    grep -q '^/swapfile-asistencia ' /etc/fstab || printf '/swapfile-asistencia none swap sw 0 0\n' >> /etc/fstab
fi
cat > /etc/my.cnf.d/asistencia.cnf <<CNF
[mysqld]
bind-address=$database_ip
mysqlx=0
innodb_buffer_pool_size=128M
max_connections=30
CNF
db_password=$(read_secret db)
systemctl enable --now mysqld
temporary=$(sed -n 's/.*temporary password is generated for root@localhost: //p' /var/log/mysqld.log | tail -1)
test -n "$temporary"
root_password=Aa1!$(openssl rand -hex 24)
umask 077
MYSQL_PWD="$temporary" mysql --connect-expired-password -uroot <<SQL
ALTER USER 'root'@'localhost' IDENTIFIED BY '$root_password';
CREATE DATABASE IF NOT EXISTS uagrm_asistencia CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'asistencia'@'$backend_ip' IDENTIFIED BY 'Aa1!$db_password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON uagrm_asistencia.* TO 'asistencia'@'$backend_ip';
SQL
printf '[client]\nuser=root\npassword=%s\n' "$root_password" > /root/.my.cnf
unset root_password temporary db_password
