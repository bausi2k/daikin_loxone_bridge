# Basis Image: Klein und sicher
FROM node:18-alpine

# Metadaten
LABEL org.opencontainers.image.source=https://github.com/bausi2k/daikin_loxone_bridge
LABEL org.opencontainers.image.description="Daikin Altherma 3 Bridge to Loxone & MQTT"
LABEL org.opencontainers.image.licenses=MIT

# Arbeitsverzeichnis im Container
WORKDIR /app

# Zeitzone und SQLite Abhängigkeiten installieren (wichtig für Alpine Linux)
RUN apk add --no-cache tzdata sqlite

# Abhängigkeiten kopieren und installieren
COPY package*.json ./
RUN npm install --production

# Restlichen Code kopieren
COPY . .

# Port freigeben
EXPOSE 8666

# Startbefehl
CMD ["node", "server.js"]