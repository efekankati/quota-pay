#!/bin/bash
set -euxo pipefail

# =============================================================================
# Quota Pay — EC2 Spot Instance Bootstrap Script (Amazon Linux 2023 / eu-south-1)
# Installs Docker & Docker Compose, writes Caddyfile & docker-compose.yml,
# and launches the Quota Pay + Caddy HTTPS + Watchtower stack.
# =============================================================================

dnf update -y
dnf install -y docker git curl

systemctl enable docker
systemctl start docker

# Install Docker Compose v2 plugin
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

mkdir -p /opt/quota-pay
cd /opt/quota-pay

# Write runtime environment configuration
cat <<'EOF' > /opt/quota-pay/.env
NODE_ENV=production
PORT=3000
AWS_REGION=eu-south-1
DOMAIN_NAME=${domain_name}
GEMINI_API_KEY=${gemini_api_key}
SUPABASE_URL=${supabase_url}
SUPABASE_ANON_KEY=${supabase_anon_key}
AI_MAX_BUDGET_USD=${ai_max_budget_usd}
SPOT_HOURLY_RATE_USD=0.005
EOF
chmod 600 /opt/quota-pay/.env

# Write Caddyfile for automatic Let's Encrypt SSL/TLS termination
cat <<'EOF' > /opt/quota-pay/Caddyfile
{$DOMAIN_NAME::80} {
  encode zstd gzip

  reverse_proxy app:3000 {
    header_up Host {host}
    header_up X-Real-IP {remote_host}
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto {scheme}
  }

  header {
    X-Content-Type-Options "nosniff"
    X-Frame-Options "SAMEORIGIN"
    Referrer-Policy "strict-origin-when-cross-origin"
  }
}
EOF

# Pull or write docker-compose.yml and launch stack
cat <<'EOF' > /opt/quota-pay/docker-compose.yml
version: "3.9"

services:
  app:
    image: ghcr.io/efekankati/quota-pay:latest
    container_name: quota-pay-app
    restart: unless-stopped
    env_file:
      - .env
    expose:
      - "3000"
    networks:
      - quota-net
    labels:
      - "com.centurylinklabs.watchtower.enable=true"

  caddy:
    image: caddy:2-alpine
    container_name: quota-pay-https
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    env_file:
      - .env
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - app
    networks:
      - quota-net

  watchtower:
    image: containrrr/watchtower:latest
    container_name: quota-pay-watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: --interval 60 --cleanup --label-enable
    networks:
      - quota-net

networks:
  quota-net:
    driver: bridge

volumes:
  caddy_data:
  caddy_config:
EOF

docker compose pull || true
docker compose up -d

