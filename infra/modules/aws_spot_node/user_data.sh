#!/bin/bash
set -euxo pipefail

# =============================================================================
# Quota Pay — AWS Spot Node Cloud-Init Bootstrap
# Target compose file: ${compose_target}
# Services: ${services}
# =============================================================================

dnf install -y docker git cronie

systemctl enable docker
systemctl start docker
systemctl enable crond
systemctl start crond

# Install Docker Compose v2 plugin
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# 2GB swap file to prevent compiler OOM on small instances
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
fi

rm -rf /opt/quota-pay
git clone https://github.com/efekankati/quota-pay.git /opt/quota-pay

cd /opt/quota-pay

# Write runtime placement environment configuration
cat <<'EOF' > /opt/quota-pay/docker/.env.placement
NODE_ENV=production
NODE_OPTIONS=--max-old-space-size=512
PORT=3000
AWS_REGION=eu-south-1
DOMAIN_NAME=:80
GEMINI_API_KEY=${gemini_api_key}
SUPABASE_URL=${supabase_url}
SUPABASE_ANON_KEY=${supabase_anon_key}
AI_MAX_BUDGET_USD=${ai_max_budget_usd}
SPOT_HOURLY_RATE_USD=0.005
EOF
chmod 600 /opt/quota-pay/docker/.env.placement

# Copy into standard .env for docker compose
cp /opt/quota-pay/docker/.env.placement /opt/quota-pay/.env

# Build and start assigned profile
cd /opt/quota-pay
docker compose -f docker/${compose_target} up -d --build

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

