# ❄️ Daikin Altherma 3 Loxone Bridge

> **Bridges Daikin LAN Adapter BRP069A61 / BRP069A62 to Loxone and MQTT.**

[![Docker](https://github.com/bausi2k/daikin_loxone_bridge/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/bausi2k/daikin_loxone_bridge/actions/workflows/docker-publish.yml)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-orange.svg?style=flat&logo=buy-me-a-coffee)](https://www.buymeacoffee.com/bausi2k)

Eine moderne, leichtgewichtige Bridge, um **Daikin Altherma 3 Wärmepumpen** (getestet mit LAN-Adapter **BRP069A61** und **BRP069A62**) nahtlos in **Loxone** und **MQTT**-Umgebungen zu integrieren.

### Features
* 🚀 **Echtzeit-Brücke:** Sendet Statusänderungen sofort per UDP an Loxone.
* 📊 **Analytics Dashboard:** Integrierte Datenbank (SQLite) mit Diagrammen (Vorlauf, Warmwasser, Außen) und historischen Vergleichen (Heute vs. Gestern, Monatsvergleich).
* 📱 **Modernes UI:** Responsive "Google Home"-Style Webinterface mit Dark Mode.
* ⚡ **MQTT Support:** Volle Integration für Home Assistant, ioBroker, etc.
* 🛠 **Auto-Config:** Generiert fertige XML-Vorlagen für den Loxone-Import (Virtuelle Ein- und Ausgänge).

---

## 🚀 Quick Start (Docker)

Die einfachste Art, die Bridge zu betreiben. Du benötigst kein Node.js, nur Docker.

### 1. Vorbereitung
Erstelle einen Ordner auf deinem Server/NAS und lege eine leere `config.json` Datei an (oder kopiere die `sample.config.json` aus diesem Repo).

```bash
mkdir daikin-bridge
cd daikin-bridge
touch config.json
touch history.db

```

### 2. Docker Compose

Erstelle eine `docker-compose.yml` mit folgendem Inhalt:

```yaml
version: '3.8'

services:
  daikin-bridge:
    # Offizielles Image von GitHub Container Registry
    image: ghcr.io/bausi2k/daikin_loxone_bridge:latest
    container_name: daikin-bridge
    restart: unless-stopped
    
    # WICHTIG: Host Mode für direkte UDP Kommunikation mit Loxone & Auto-Discovery
    network_mode: host
    
    environment:
      - TZ=Europe/Vienna
    volumes:
      - ./config.json:/app/config.json
      - ./history.db:/app/history.db

```

### 3. Starten

```bash
docker-compose up -d

```

Das Webinterface ist nun erreichbar unter: `http://[DEINE-IP]:8666`

---

## ⚙️ Konfiguration

Beim ersten Start wird die `config.json` automatisch befüllt. Du kannst diese bequem im Webinterface unter dem Tab **Setup** bearbeiten.

**Beispiel Konfiguration:**

```json
{
  "daikinIp": "192.168.1.36",    // IP deiner Wärmepumpe
  "loxoneIp": "192.168.1.200",   // IP deines Miniservers
  "loxonePort": 7888,            // UDP Port in Loxone (Virtueller UDP Eingang)
  "webPort": 8666,               // Port für dieses Dashboard
  "udpKeepAlive": 90,            // Sek. Intervall für Zwangs-Update an Loxone (Heartbeat)
  "mqttBroker": "mqtt://192.168.1.5", // Optional: MQTT Broker
  "mqttTopic": "daikin"          // Optional: Topic Prefix
}

```

---

## 🏡 Loxone Integration

Die Bridge generiert automatisch Import-Dateien für Loxone Config. Sparen Sie sich das manuelle Anlegen!

1. Öffne das Webinterface -> Tab **Setup**.
2. Lade die Vorlagen herunter:
* **Eingänge (UDP):** `VIU_Daikin_Sensors.xml` (Sensoren & Status)
* **Ausgänge (HTTP):** `VO_Daikin_Control.xml` (Steuerung)


3. In Loxone Config:
* Klicke auf *Virtuelle Eingänge* -> *Vorlage importieren*.
* Klicke auf *Virtuelle Ausgänge* -> *Vorlage importieren*.



---

## 📂 Developer Info & Helper Tools

Das Repository enthält neben dem Hauptserver (`server.js`) nützliche Skripte zur Diagnose, falls deine Anlage einen anderen Chipsatz oder Firmware nutzt.

* **`server.js`**: Der Hauptprozess (Webserver, UDP, MQTT, DB).
* **`daikin.js`**: Die Core-Library. Kommuniziert mit der Hardware.
* **`database.js`**: Verwaltet die SQLite Datenbank für die Historie.
* **`scanner.js`**: Ein Tool, um Daikin-Anlagen im lokalen Netzwerk zu finden (Auto-Discovery via UDP Broadcast).
* **`deep_scanner.js`**: Reverse-Engineering Tool. Scannt eine IP auf alle möglichen HTTP-Endpunkte ab, um versteckte Parameter zu finden.
* **`crawler.js`**: Zieht alle JSON-Daten der Anlage zur Analyse ab und speichert sie lokal.

---

## ⚠️ Sicherheitshinweis

Die `config.json` speichert Passwörter (für MQTT) im Klartext. Die `history.db` enthält Verlaufsdaten. Stelle sicher, dass der Ordner auf deinem Server gesichert ist und nicht öffentlich im Internet zugänglich ist.

---

**Lizenz:** MIT
