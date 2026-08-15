# Déploiement Oracle Cloud Always Free - Guide détaillé

> Objectif : héberger `ialyon69000-dev/navigateur` **tel quel en Node.js** avec `visits.json` **vraiment permanent** (pas éphémère comme Render).

Oracle Always Free = 2 VM Ampere A1 (ARM) 4 OCPU / 24GB RAM total + 200GB de boot volume + 10GB Object Storage + 2x IPv4 publiques réservées. Gratuit à vie.

---

## 1. Créer compte OCI

1. https://www.oracle.com/cloud/free/ -> Sign up
2. Carte bancaire demandée (vérif, pas débitée), choisis **Home Region = eu-marseille-1** (le plus proche de Clermont-Ferrand, latence ~15ms) ou eu-paris-1
3. Une fois validé, va dans Console OCI > Compute > Instances

## 2. Créer le réseau VCN

Si pas de VCN :
- Networking > Virtual Cloud Networks > Create VCN
- Name: `okno-vcn`, CIDR `10.0.0.0/16`, Create VCN with Internet Connectivity
- Ça crée Internet Gateway, Route Table, Security List

### Security List à ouvrir
VCN > Security Lists > Default > Add Ingress Rules :
- Source 0.0.0.0/0, TCP 22 (SSH)
- 0.0.0.0/0, TCP 80
- 0.0.0.0/0, TCP 443
- Optionnel : 0.0.0.0/0, TCP 3000 si tu veux tester direct sans Nginx

## 3. Créer la VM Always Free

Compute > Instances > Create Instance :
- Name: `okno`
- Image: **Canonical Ubuntu 22.04** ou 24.04 (aarch64)
- Shape: **VM.Standard.A1.Flex** -> Always Free eligible affiché
  - OCPU: 4, Memory: 24GB max free (mets 4 OCPU / 24GB si première VM, sinon 1 OCPU/6GB si tu en as déjà)
- Boot volume: 50GB (tu as 200GB gratuit total, mets 100GB direct)
- VCN: `okno-vcn`, Subnet public, **Assign public IPv4 = YES**
- Add SSH key: génère `ssh-keygen -t ed25519` sur ton PC et colle la clé publique
- Create

Attends ~1min, note l'**IP publique** ex: `140.238.x.x`

> Astuce IP permanente : Networking > IP Management > Reserved Public IPs > Reserve. Puis attache-la à ton instance (sinon IP éphémère change au reboot stopped).

## 4. Connexion SSH

```bash
ssh ubuntu@140.238.x.x -i ~/.ssh/id_ed25519
```

## 5. Install en 1 commande

Sur la VM :
```bash
curl -fsSL https://raw.githubusercontent.com/ialyon69000-dev/navigateur/main/deploy/oracle/setup.sh -o setup.sh || wget -O setup.sh https://raw.githubusercontent.com/ialyon69000-dev/navigateur/main/deploy/oracle/setup.sh
chmod +x setup.sh
./setup.sh ton-domaine.com  # ou ./setup.sh sans arg pour IP
```

Ce script fait :
- apt update, install git node 20 nginx certbot ufw fail2ban
- clone repo dans `~/empreinte`
- `DATA_DIR=~/data` hors du repo (donc pas écrasé par git pull) -> ton JSON permanent
- `npm ci`, migration ancien `data/visits.json` -> `~/data/visits.json`
- pm2 start + save + startup systemd
- nginx reverse proxy 80 -> 3000
- ufw open 22,80,443

Si tu clones depuis cette branche :
```bash
git clone -b arena/01a0052c-navigateur https://github.com/ialyon69000-dev/navigateur.git ~/empreinte
cd ~/empreinte && npm install
```

## 6. Nginx + HTTPS

Sans domaine (IP only) : déjà accessible http://IP

Avec domaine (recommandé) :
1. Chez OVH/Cloudflare, A record `okno.ton-domaine.fr -> IP Oracle`
2. Sur VM :
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d okno.ton-domaine.fr
# renouvellement auto via systemd, test :
sudo certbot renew --dry-run
```

## 7. Vérifier permanence JSON

```bash
cat ~/data/visits.json | head
ls -lh ~/data/
pm2 logs empreinte --lines 50
curl http://localhost:3000/api/health
curl http://localhost:3000/api/visits | jq .total
```

Même après :
```bash
sudo reboot
# ou
cd ~/empreinte && git pull && pm2 restart empreinte
```
`~/data/visits.json` reste.

## 8. Backups (gratuit)

Oracle Object Storage Always Free 10GB :
```bash
# Install OCI CLI
bash -c "$(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)"
oci os bucket create --compartment-id <id> --name okno-backup
# Cron quotidien
crontab -e
# 0 3 * * * tar czf /tmp/data-$(date +\%F).tgz ~/data && oci os object put -bn okno-backup --file /tmp/data-*.tgz
```
Ou simple rsync vers ton PC : `scp ubuntu@IP:~/data/visits.json ./backup/`

## 9. Mises à jour

```bash
cd ~/empreinte
git pull
npm install
pm2 restart empreinte
pm2 logs
```

## 10. Optimisations Always Free

- pm2 memory limit : `pm2 start server.js --max-memory-restart 400M`
- Node ARM est natif, perf excellente sur A1
- Ne supprime pas la VM sinon perte IP si pas réservée
- Monitoring : Console OCI > Compute > Instance > Metrics (gratuit)
- UFW + fail2ban déjà installés par setup.sh

## 11. Pourquoi Oracle > Render/Koyeb/Fly pour toi

- Render : FS éphémère sans disque payant [1](https://docs.render.com/disks) (vu avant)
- Koyeb : pas de volume sur free [3](https://www.srvrlss.io/provider/koyeb/)
- Fly : plus de free tier [3](https://www.saaspricepulse.com/blog/flyio-free-tier-2026)
- Oracle : vrai disque 50-200GB persistant gratuit à vie, pas de sleep, RAM 6-24GB, pas de cold start

## 12. Dépannage

- `curl: connection refused` -> `sudo ufw status`, `sudo iptables -L`, Security List OCI
- `pm2 not found` -> `source ~/.bashrc` ou `npx pm2`
- `EACCES data` -> `chmod 775 ~/data && chmod 664 ~/data/visits.json && chown ubuntu:ubuntu ~/data/*`
- Nginx 502 -> `pm2 status`, `journalctl -u nginx`

Besoin version Docker sur Oracle ?
```bash
docker build -t okno .
docker run -d -p 3000:3000 -v $HOME/data:/data --restart always -e DATA_DIR=/data okno
```

Tu veux que je te génère aussi un Terraform pour créer VCN+VM en 1 commande ?
