#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Rock Band Song Database Setup ===${NC}"
echo ""

# Get current directory
ROCKDB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo -e "Installation directory: ${GREEN}$ROCKDB_DIR${NC}"
echo ""

# Check if in home directory
IN_HOME=false
if [[ "$ROCKDB_DIR" =~ ^/home/ ]]; then
    IN_HOME=true
    echo -e "${YELLOW}⚠️  Note: Installation is in /home directory${NC}"
    echo -e "For better security, consider moving to /opt/rockdb or /var/www/rockdb"
    echo ""
fi

# Prompt for deployment mode
echo "How would you like to deploy?"
echo "1) Standalone (Python server only, no HTTPS)"
echo "2) With my own reverse proxy (setup Python service, I'll configure proxy)"
echo "3) Full setup with Caddy + Let's Encrypt DNS (Namecheap)"
echo ""
read -p "Select option [1-3]: " DEPLOY_MODE

case $DEPLOY_MODE in
    1)
        MODE="standalone"
        echo -e "${GREEN}Selected: Standalone mode${NC}"
        ;;
    2)
        MODE="own-proxy"
        echo -e "${GREEN}Selected: Own reverse proxy${NC}"
        ;;
    3)
        MODE="caddy-dns"
        echo -e "${GREEN}Selected: Full Caddy + Let's Encrypt DNS setup${NC}"
        ;;
    *)
        echo -e "${RED}Invalid option${NC}"
        exit 1
        ;;
esac
echo ""

# Get common values
read -p "Python server host [127.0.0.1]: " SERVER_HOST
SERVER_HOST=${SERVER_HOST:-127.0.0.1}

read -p "Python server port [8000]: " SERVER_PORT
SERVER_PORT=${SERVER_PORT:-8000}

read -p "Username to run service [$USER]: " SERVICE_USER
SERVICE_USER=${SERVICE_USER:-$USER}

# Caddy-specific prompts
if [ "$MODE" == "caddy-dns" ]; then
    echo ""
    echo -e "${BLUE}Caddy Configuration${NC}"
    read -p "Domain name (e.g., songdb.example.com): " DOMAIN
    if [ -z "$DOMAIN" ]; then
        echo -e "${RED}Domain is required${NC}"
        exit 1
    fi

    read -p "Email for Let's Encrypt: " LETSENCRYPT_EMAIL
    if [ -z "$LETSENCRYPT_EMAIL" ]; then
        echo -e "${RED}Email is required${NC}"
        exit 1
    fi

    echo ""
    echo -e "${BLUE}Namecheap API Credentials${NC}"
    echo "Get these from: https://ap.www.namecheap.com/settings/tools/apiaccess/"
    read -p "Namecheap API Username: " NAMECHEAP_USER
    if [ -z "$NAMECHEAP_USER" ]; then
        echo -e "${RED}API Username is required${NC}"
        exit 1
    fi

    read -sp "Namecheap API Key: " NAMECHEAP_KEY
    echo ""
    if [ -z "$NAMECHEAP_KEY" ]; then
        echo -e "${RED}API Key is required${NC}"
        exit 1
    fi
fi

echo ""
echo -e "${BLUE}=== Configuration Summary ===${NC}"
echo "Mode: $MODE"
echo "Installation: $ROCKDB_DIR"
echo "Server: $SERVER_HOST:$SERVER_PORT"
echo "Run as: $SERVICE_USER"
[ "$MODE" == "caddy-dns" ] && echo "Domain: $DOMAIN"
[ "$MODE" == "caddy-dns" ] && echo "Email: $LETSENCRYPT_EMAIL"
echo ""
read -p "Continue with installation? [y/N]: " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Installation cancelled"
    exit 0
fi

echo ""
echo -e "${BLUE}[1/X] Creating rockdb systemd service...${NC}"

sudo tee /etc/systemd/system/rockdb.service > /dev/null << EOF
[Unit]
Description=Rock Band Song Database API
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$ROCKDB_DIR
ExecStart=/usr/bin/python3 server.py --host $SERVER_HOST --port $SERVER_PORT
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo -e "${GREEN}✓ Created rockdb.service${NC}"

if [ "$MODE" == "caddy-dns" ]; then
    echo ""
    echo -e "${BLUE}[2/X] Checking for xcaddy...${NC}"

    if ! command -v xcaddy &> /dev/null; then
        echo "xcaddy not found. Installing from AUR..."
        if command -v yay &> /dev/null; then
            yay -S --needed --noconfirm xcaddy
        elif command -v paru &> /dev/null; then
            paru -S --needed --noconfirm xcaddy
        else
            echo -e "${RED}Error: Neither yay nor paru found. Please install an AUR helper.${NC}"
            exit 1
        fi
    else
        echo -e "${GREEN}✓ xcaddy already installed${NC}"
    fi

    echo ""
    echo -e "${BLUE}[3/X] Building Caddy with Namecheap DNS module...${NC}"
    cd /tmp
    xcaddy build --with github.com/caddy-dns/namecheap

    echo ""
    echo -e "${BLUE}[4/X] Installing custom Caddy binary...${NC}"
    sudo mv caddy /usr/bin/caddy
    sudo chmod +x /usr/bin/caddy
    sudo chown root:root /usr/bin/caddy

    echo -e "${GREEN}✓ Caddy installed:${NC}"
    /usr/bin/caddy version

    echo ""
    echo -e "${BLUE}[5/X] Creating Caddyfile...${NC}"

    sudo mkdir -p /etc/caddy
    sudo tee /etc/caddy/Caddyfile > /dev/null << EOF
{
    email $LETSENCRYPT_EMAIL
}

$DOMAIN {
    # DNS challenge with Namecheap
    tls {
        dns namecheap {
            api_key {env.NAMECHEAP_API_KEY}
            user {env.NAMECHEAP_API_USER}
        }
        propagation_delay 120s
        propagation_timeout 10m
    }

    root * $ROCKDB_DIR
    file_server

    # Proxy API requests to Python server
    reverse_proxy /api/* $SERVER_HOST:$SERVER_PORT

    # Cache static assets
    @static path *.css *.js *.json
    header @static Cache-Control "public, max-age=3600"

    # Gzip compression
    encode gzip
}
EOF

    echo -e "${GREEN}✓ Created Caddyfile${NC}"

    echo ""
    echo -e "${BLUE}[6/X] Configuring Caddy systemd service...${NC}"

    sudo mkdir -p /etc/systemd/system/caddy.service.d

    if [ "$IN_HOME" = true ]; then
        echo -e "${YELLOW}⚠️  Disabling ProtectHome for /home access${NC}"
        sudo tee /etc/systemd/system/caddy.service.d/override.conf > /dev/null << EOF
[Service]
Environment="NAMECHEAP_API_KEY=$NAMECHEAP_KEY"
Environment="NAMECHEAP_API_USER=$NAMECHEAP_USER"
# Allow Caddy to access files in /home directory
ProtectHome=false
EOF
        # Ensure parent directory is readable
        PARENT_DIR=$(dirname "$ROCKDB_DIR")
        chmod 755 "$PARENT_DIR"
        echo -e "${GREEN}✓ Set $PARENT_DIR to 755${NC}"
    else
        sudo tee /etc/systemd/system/caddy.service.d/override.conf > /dev/null << EOF
[Service]
Environment="NAMECHEAP_API_KEY=$NAMECHEAP_KEY"
Environment="NAMECHEAP_API_USER=$NAMECHEAP_USER"
EOF
    fi

    sudo chmod 600 /etc/systemd/system/caddy.service.d/override.conf
    echo -e "${GREEN}✓ Created Caddy systemd override${NC}"

    # Ensure Caddy systemd service exists
    if [ ! -f /usr/lib/systemd/system/caddy.service ]; then
        echo ""
        echo -e "${BLUE}[7/X] Creating Caddy systemd service...${NC}"
        sudo tee /usr/lib/systemd/system/caddy.service > /dev/null << 'EOF'
[Unit]
Description=Caddy web server
Documentation=https://caddyserver.com/docs/
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
Restart=on-abnormal

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/caddy /var/log/caddy
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF

        # Create caddy user if doesn't exist
        if ! id caddy &> /dev/null; then
            sudo useradd -r -s /usr/sbin/nologin -d /var/lib/caddy caddy
        fi

        # Create necessary directories
        sudo mkdir -p /var/lib/caddy /var/log/caddy
        sudo chown -R caddy:caddy /var/lib/caddy /var/log/caddy

        echo -e "${GREEN}✓ Created Caddy service${NC}"
    fi
fi

echo ""
echo -e "${BLUE}[Final] Starting services...${NC}"

sudo systemctl daemon-reload
sudo systemctl enable rockdb
sudo systemctl restart rockdb

if [ "$MODE" == "caddy-dns" ]; then
    sudo systemctl enable caddy
    sudo systemctl restart caddy
fi

echo ""
echo -e "${GREEN}=== Setup Complete! ===${NC}"
echo ""

case $MODE in
    standalone)
        echo "Python server is running at: http://$SERVER_HOST:$SERVER_PORT"
        echo ""
        echo "Check status:"
        echo "  sudo systemctl status rockdb"
        ;;
    own-proxy)
        echo "Python server is running at: http://$SERVER_HOST:$SERVER_PORT"
        echo ""
        echo "Configure your reverse proxy to:"
        echo "  - Serve static files from: $ROCKDB_DIR"
        echo "  - Proxy /api/* to: http://$SERVER_HOST:$SERVER_PORT"
        echo ""
        echo "Check status:"
        echo "  sudo systemctl status rockdb"
        ;;
    caddy-dns)
        echo "Services are running:"
        echo "  - Python API: http://$SERVER_HOST:$SERVER_PORT"
        echo "  - Public site: https://$DOMAIN"
        echo ""
        echo "Important next steps:"
        echo "  1. Ensure DNS A record for $DOMAIN points to this server"
        echo "  2. Whitelist this server's IP in Namecheap API settings"
        echo "  3. Certificate acquisition may take 2-5 minutes"
        echo ""
        echo "Monitor certificate acquisition:"
        echo "  sudo journalctl -u caddy -f"
        echo ""
        echo "Check status:"
        echo "  sudo systemctl status rockdb"
        echo "  sudo systemctl status caddy"
        ;;
esac

echo ""
