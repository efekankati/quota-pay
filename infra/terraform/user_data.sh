#!/bin/bash
set -euxo pipefail

# =============================================================================
# Quota Pay — EC2 Spot Instance Bootstrap Script (Amazon Linux 2023 / eu-south-1)
# Installs Docker & Docker Compose, clones https://github.com/efekankati/quota-pay.git,
# writes runtime .env, and launches the Quota Pay + Caddy HTTPS + Watchtower stack.
# =============================================================================

dnf install -y docker git

systemctl enable docker
systemctl start docker

# Install Docker Compose v2 plugin (curl-minimal is pre-installed on AL2023)
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# Add 2GB swap file on t3.small so multi-stage Expo Web + TypeScript Docker builds never OOM
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
fi

rm -rf /opt/quota-pay
git clone -b dev https://github.com/efekankati/quota-pay.git /opt/quota-pay || \
  git clone https://github.com/efekankati/quota-pay.git /opt/quota-pay

cd /opt/quota-pay

# Write runtime environment configuration
cat <<'EOF' > /opt/quota-pay/.env
NODE_ENV=production
PORT=3000
AWS_REGION=eu-south-1
DOMAIN_NAME=${domain_name}
GEMINI_API_KEY=${gemini_api_key}
EXPO_PUBLIC_GEMINI_API_KEY=${gemini_api_key}
SUPABASE_URL=${supabase_url}
SUPABASE_ANON_KEY=${supabase_anon_key}
EXPO_PUBLIC_SUPABASE_URL=${supabase_url}
EXPO_PUBLIC_SUPABASE_ANON_KEY=${supabase_anon_key}
AI_MAX_BUDGET_USD=${ai_max_budget_usd}
SPOT_HOURLY_RATE_USD=0.005
EOF
chmod 600 /opt/quota-pay/.env

# Try pulling prebuilt GHCR image first; fallback to standard docker build from cloned repo
if ! docker pull ghcr.io/efekankati/quota-pay:latest; then
  DOCKER_BUILDKIT=0 docker build -t ghcr.io/efekankati/quota-pay:latest -f server/Dockerfile .
fi
docker compose up -d --no-build
