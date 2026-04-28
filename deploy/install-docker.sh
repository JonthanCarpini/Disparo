#!/bin/bash
set -e

echo ">>> Atualizando pacotes..."
apt-get update -y

echo ">>> Instalando dependencias..."
apt-get install -y ca-certificates curl gnupg git

echo ">>> Adicionando repositorio Docker..."
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
chmod a+r /etc/apt/keyrings/docker.gpg

. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list

echo ">>> Instalando Docker..."
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo ">>> Iniciando Docker..."
systemctl enable docker
systemctl start docker

echo ""
echo "=== VERSOES ==="
docker --version
docker compose version
echo "=== DOCKER OK ==="
