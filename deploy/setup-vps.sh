#!/bin/bash
set -e

VPS="root@178.238.236.103"
KEY="$HOME/.ssh/disparo_vps"

echo "=== Testando conexao SSH ==="
ssh -i "$KEY" -o StrictHostKeyChecking=no "$VPS" "echo 'SSH OK' && lsb_release -a 2>/dev/null || cat /etc/os-release"

echo ""
echo "=== Instalando Docker ==="
ssh -i "$KEY" -o StrictHostKeyChecking=no "$VPS" "
  apt-get update -y &&
  apt-get install -y ca-certificates curl gnupg &&
  install -m 0755 -d /etc/apt/keyrings &&
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes &&
  chmod a+r /etc/apt/keyrings/docker.gpg &&
  echo \"deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \$(. /etc/os-release && echo \$VERSION_CODENAME) stable\" > /etc/apt/sources.list.d/docker.list &&
  apt-get update -y &&
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin &&
  systemctl enable docker &&
  systemctl start docker &&
  docker --version &&
  docker compose version
"

echo ""
echo "=== Clonando repositorio ==="
ssh -i "$KEY" -o StrictHostKeyChecking=no "$VPS" "
  rm -rf /opt/disparo &&
  git clone https://github.com/JonthanCarpini/Disparo.git /opt/disparo &&
  echo 'Clone OK'
"

echo ""
echo "=== Setup concluido! ==="
echo "Agora configure o .env na VPS e suba os containers."
