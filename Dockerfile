FROM node:18-alpine

# Zeitzone setzen (wichtig für korrekte Logs)
RUN apk add --no-cache tzdata
ENV TZ=Europe/Vienna

WORKDIR /app

# Erst package.json kopieren und installieren (Caching nutzen)
COPY package.json ./
RUN npm install

# Dann den Rest kopieren
COPY . .

# Ports dokumentieren
EXPOSE 3000

# Startbefehl
CMD ["node", "server.js"]