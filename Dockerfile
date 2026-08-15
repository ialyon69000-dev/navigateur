# Node 20 slim - compatible Fly.io, Koyeb, Northflank, Railway
FROM node:20-alpine

WORKDIR /app

# Deps
COPY package.json package-lock.json* ./
RUN npm ci --only=production || npm install --production

# App
COPY . .

# Data dir par défaut = /data pour volume persistant
# Sur Render free (éphémère) ça reste ./data si DATA_DIR non défini
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

# Création du dossier (sera écrasé par le volume si monté)
RUN mkdir -p /data && chown -R node:node /app /data

USER node

EXPOSE 3000

CMD ["node", "server.js"]
