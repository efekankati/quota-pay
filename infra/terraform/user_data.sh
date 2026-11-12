#!/bin/bash
set -euxo pipefail

# =============================================================================
# Quota Pay — EC2 Spot Instance Bootstrap Script (Amazon Linux 2023 / eu-south-1)
# Installs Docker & Docker Compose, clones https://github.com/efekankati/quota-pay.git,
# writes runtime .env, and launches the Quota Pay + Caddy HTTPS + Watchtower stack.
# =============================================================================

dnf install -y docker git cronie

systemctl enable docker
systemctl start docker
systemctl enable crond
systemctl start crond

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
NODE_OPTIONS=--max-old-space-size=512
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

# Build directly from the latest cloned dev branch (Node 22 + zero-WebSocket ledger)
sed -i 's|ghcr.io/efekankati/quota-pay:latest|quota-pay-local:latest|g' /opt/quota-pay/docker-compose.yml
DOCKER_BUILDKIT=0 docker build -t quota-pay-local:latest -f server/Dockerfile .
docker compose up -d --no-build

# Auto-sync cron job: polls origin/dev every 60s and rebuilds container on new commits
cat <<'EOF' > /usr/local/bin/quota-git-sync.sh
#!/bin/bash
cd /opt/quota-pay || exit 0
git fetch origin dev
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/dev)
if [ "$LOCAL" != "$REMOTE" ]; then
  git reset --hard origin/dev
  sed -i 's|ghcr.io/efekankati/quota-pay:latest|quota-pay-local:latest|g' /opt/quota-pay/docker-compose.yml
  DOCKER_BUILDKIT=0 docker build -t quota-pay-local:latest -f server/Dockerfile .
  docker compose up -d --no-build --force-recreate
fi
EOF
chmod +x /usr/local/bin/quota-git-sync.sh
echo "* * * * * root /usr/local/bin/quota-git-sync.sh >> /var/log/quota-git-sync.log 2>&1" > /etc/cron.d/quota-git-sync
chmod 644 /etc/cron.d/quota-git-sync

# Dead Man's Switch: Auto-terminates EC2 Spot instance if no client heartbeat or after max session TTL
cat <<'EOF' > /usr/local/bin/quota-deadman-watchdog.sh
#!/bin/bash
HEARTBEAT_FILE="/tmp/quota_last_heartbeat"
TIMEOUT_SEC=900    # 15 minutes without local client connection
MAX_TTL_SEC=14400  # 4 hours absolute session ceiling

UPTIME_SEC=$(awk '{print int($1)}' /proc/uptime)
if [ "$UPTIME_SEC" -gt "$MAX_TTL_SEC" ]; then
  echo "[DeadManSwitch] Max session TTL reached ($MAX_TTL_SEC s). Terminating Spot instance." | logger -t quota-deadman
  shutdown -h now
  exit 0
fi

if [ -f "$HEARTBEAT_FILE" ]; then
  LAST_PING=$(stat -c %Y "$HEARTBEAT_FILE")
  NOW=$(date +%s)
  DIFF=$((NOW - LAST_PING))
  if [ "$DIFF" -gt "$TIMEOUT_SEC" ]; then
    echo "[DeadManSwitch] No client heartbeat for $DIFF s (limit $TIMEOUT_SEC s). Terminating Spot instance." | logger -t quota-deadman
    shutdown -h now
  fi
else
  # If 20 minutes passed since boot without any initial heartbeat, terminate
  if [ "$UPTIME_SEC" -gt 1200 ]; then
    echo "[DeadManSwitch] No initial heartbeat received within 20m. Terminating Spot instance." | logger -t quota-deadman
    shutdown -h now
  fi
fi
EOF
chmod +x /usr/local/bin/quota-deadman-watchdog.sh
echo "*/2 * * * * root /usr/local/bin/quota-deadman-watchdog.sh >> /var/log/quota-deadman.log 2>&1" > /etc/cron.d/quota-deadman
chmod 644 /etc/cron.d/quota-deadman

