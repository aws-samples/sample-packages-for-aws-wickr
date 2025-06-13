#!/bin/bash
# Important logs:
# /var/log/cloud-init.log and
# /var/log/cloud-init-output.log

set -euo pipefail

curl https://kots.io/install | bash

# Install tinyproxy to proxy connections to the EKS API
yum install -y gcc

TINYPROXY_VERSION="1.11.2"
SHA512="d7cdc3aa273881ca1bd3027ff83d1fa3d3f40424a3f665ea906a3de059df2795455b65aeebde0f75ae5cacf9bba57219bc0c468808a9a75278e93f8d7913bac5"
curl https://github.com/tinyproxy/tinyproxy/releases/download/${TINYPROXY_VERSION}/tinyproxy-${TINYPROXY_VERSION}.tar.gz -Lo tinyproxy-${TINYPROXY_VERSION}.tar.gz

echo "${SHA512}  tinyproxy-${TINYPROXY_VERSION}.tar.gz" | sha512sum --check || exit 1

tar xvzf tinyproxy-${TINYPROXY_VERSION}.tar.gz
cd ./tinyproxy-${TINYPROXY_VERSION}
./configure --prefix= && make && make install

yum remove -y gcc

echo "Listen 127.0.0.1" >> /etc/tinyproxy/tinyproxy.conf
sed -i 's/#PidFile /PidFile /' /etc/tinyproxy/tinyproxy.conf

# The directory will be created at boot and its content should be preserved.
cat << "EOF" | tee /etc/tmpfiles.d/tinyproxy.conf
d /var/run/tinyproxy
x /var/run/tinyproxy/*
EOF

systemd-tmpfiles --create

cat << "EOF" >> /usr/lib/systemd/system/tinyproxy.service
# /usr/lib/systemd/system/tinyproxy.service
[Unit]
Description=small, efficient HTTP/SSL proxy daemon
Documentation=man:tinyproxy(8)
After=network.target

[Service]
Type=forking
ExecStart=/usr/bin/tinyproxy
ExecReload=/bin/kill -HUP $MAINPID
PIDFile=/var/run/tinyproxy/tinyproxy.pid

[Install]
WantedBy=multi-user.target
EOF

systemctl enable --now tinyproxy
