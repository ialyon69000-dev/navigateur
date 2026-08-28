#!/bin/bash
# Deploy InfinityFree htdocs via FTP (alternative to GitHub Actions)
# Usage:
#   FTP_SERVER=ftpupload.net FTP_USERNAME=if0_xxxx FTP_PASSWORD=xxx ./scripts/deploy-infinityfree.sh [--include-data]
#
# --include-data : inclut aussi le dossier data/ (première installation)
# Sans option : déploie tout sauf data/ pour préserver les données serveur

set -e

LOCAL_DIR="infinityfree/htdocs"
REMOTE_DIR="htdocs"
INCLUDE_DATA=false

if [[ "$1" == "--include-data" ]]; then
  INCLUDE_DATA=true
fi

if [[ -z "$FTP_SERVER" || -z "$FTP_USERNAME" || -z "$FTP_PASSWORD" ]]; then
  echo "❌ Variables manquantes. Définis : FTP_SERVER, FTP_USERNAME, FTP_PASSWORD"
  echo "Exemple : FTP_SERVER=ftpupload.net FTP_USERNAME=if0_12345678 FTP_PASSWORD=xxx $0"
  exit 1
fi

if ! command -v lftp &> /dev/null; then
  echo "📦 Installation de lftp..."
  sudo apt-get update -qq && sudo apt-get install -y -qq lftp
fi

echo "🚀 Déploiement vers $FTP_SERVER / $REMOTE_DIR"
echo "   Local : $LOCAL_DIR"
echo "   Include data : $INCLUDE_DATA"
echo ""

EXCLUDE_ARGS=""
if [[ "$INCLUDE_DATA" == "false" ]]; then
  echo "ℹ️  Mode préservation : data/ ne sera PAS écrasé sur le serveur"
  EXCLUDE_CMD="glob -a --exclude data/"
else
  echo "⚠️  Mode première install : data/ SERA envoyé"
  EXCLUDE_CMD=""
fi

# lftp mirror
# On utilise mirror -R pour upload récursif
LFTP_CMDS="
set ftp:ssl-allow no
set ftp:passive-mode on
open -u $FTP_USERNAME,$FTP_PASSWORD $FTP_SERVER
cd $REMOTE_DIR || mkdir -p $REMOTE_DIR; cd $REMOTE_DIR
lcd $LOCAL_DIR
"

if [[ "$INCLUDE_DATA" == "false" ]]; then
  LFTP_CMDS+="
mirror -R --parallel=4 --exclude-glob .git* --exclude-glob data/ --exclude-glob data/** --verbose
"
else
  LFTP_CMDS+="
mirror -R --parallel=4 --exclude-glob .git* --verbose
"
fi

LFTP_CMDS+="
bye
"

echo "$LFTP_CMDS" | lftp

echo ""
echo "✅ Déploiement terminé"
echo "Test : https://ton-domaine/api/health"
