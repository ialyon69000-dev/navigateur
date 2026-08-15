#!/bin/bash
# Setup Oracle Always Free VM Ubuntu 22.04/24.04 pour OKNO
# A lancer en SSH sur la VM fraîche en tant qu'ubuntu
set -e

echo "=== MAJ système ==="
sudo apt update && sudo apt -y upgrade
sudo apt -y install git curl ufw nginx certbot python3-certbot-nginx fail2ban

echo "=== UFW firewall ==="
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable || true

echo "=== Node.js 20 LTS ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs
node -v && npm -v

echo "=== PM2 ==="
sudo npm install -g pm2

echo "=== Dossier app ==="
APP_DIR=$HOME/empreinte
DATA_DIR=$HOME/data
mkdir -p $DATA_DIR
if [ ! -d "$APP_DIR/.git" ]; then
  git clone https://github.com/ialyon69000-dev/navigateur.git $APP_DIR
else
  cd $APP_DIR && git pull
fi

cd $APP_DIR
npm ci --only=production || npm install --production

# Migration ancienne data/visits.json -> ~/data si besoin
if [ -f "$APP_DIR/data/visits.json" ] && [ ! -f "$DATA_DIR/visits.json" ]; then
  cp "$APP_DIR/data/visits.json" "$DATA_DIR/visits.json"
fi
if [ ! -f "$DATA_DIR/visits.json" ]; then
  echo "[]" > "$DATA_DIR/visits.json"
fi
chmod 664 "$DATA_DIR/visits.json"

echo "=== ENV ==="
cat > $APP_DIR/.env <<EOF
NODE_ENV=production
PORT=3000
DATA_DIR=$DATA_DIR
HOST=0.0.0.0
EOF

echo "=== PM2 start ==="
cd $APP_DIR
pm2 delete empreinte || true
pm2 start server.js --name empreinte --env production
pm2 save
pm2 startup systemd -u $USER --hp $HOME | tail -n 1 | sudo bash || true

echo "=== Nginx ==="
# Copie le nginx.conf fourni
if [ -f "deploy/oracle/nginx.conf" ]; then
  # Remplace server_name par IP ou domaine si fourni en arg $1
  DOMAIN=${1:-_}
  sudo cp deploy/oracle/nginx.conf /etc/nginx/sites-available/empreinte
  sudo sed -i "s/server_name .*/server_name $DOMAIN;/" /etc/nginx/sites-available/empreinte
  sudo ln -sf /etc/nginx/sites-available/empreinte /etc/nginx/sites-enabled/empreinte
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t && sudo systemctl restart nginx
fi

echo "=== Done ==="
echo "App sur http://$(curl -s ifconfig.me):3000"
echo "Nginx sur http://$(curl -s ifconfig.me)"
echo "DATA_DIR=$DATA_DIR"
pm2 logs empreinte --lines 20 --nostream || true
