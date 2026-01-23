# ❄️ Daikin Altherma 3 Loxone Bridge (v1.0.0)

> **Bridges Daikin LAN Adapter BRP069A61 / BRP069A62 to Loxone and MQTT.**

Eine moderne, leichtgewichtige Bridge, um **Daikin Altherma 3 Wärmepumpen** (getestet mit LAN-Adapter **BRP069A61** und **BRP069A62**) nahtlos in **Loxone** und **MQTT**-Umgebungen zu integrieren.

### Features
* 🚀 **Echtzeit-Brücke:** Sendet Statusänderungen sofort per UDP an Loxone.
* 📊 **Analytics Dashboard:** Integrierte Datenbank (SQLite) mit Diagrammen (Vorlauf, Warmwasser, Außen) und historischen Vergleichen (Heute vs. Gestern, Monatsvergleich).
* 📱 **Modernes UI:** Responsive "Google Home"-Style Webinterface mit Dark Mode.
* ⚡ **MQTT Support:** Volle Integration für Home Assistant, ioBroker, etc.
* 🛠 **Auto-Config:** Generiert fertige XML-Vorlagen für den Loxone-Import (Virtuelle Ein- und Ausgänge).

---

## 🚀 Quick Start (Docker)

Die einfachste Art, die Bridge zu betreiben.

1. Repository klonen:
   ```bash
   git clone [https://github.com/bausi2k/daikin_loxone_bridge.git](https://github.com/bausi2k/daikin_loxone_bridge.git)
   cd daikin_loxone_bridge

```

2. Container starten:
```bash
docker-compose up -d

```


3. Browser öffnen:
* **UI:** `http://[DEINE-IP]:8666`



---

## ⚙️ Konfiguration

Beim ersten Start wird eine `config.json` erstellt. Du kannst diese im Webinterface unter **Setup** bearbeiten.

```json
{
  "daikinIp": "192.168.1.36",    // IP deiner Wärmepumpe
  "loxoneIp": "192.168.1.200",   // IP deines Miniservers
  "loxonePort": 7888,            // UDP Port in Loxone
  "webPort": 8666,               // Port für dieses Dashboard
  "udpKeepAlive": 90,            // Sek. Intervall für Zwangs-Update an Loxone
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
* *Virtuelle Eingänge* -> *Vorlage importieren*
* *Virtuelle Ausgänge* -> *Vorlage importieren*



---

## 📂 Developer Info & Tools

Das Repository enthält neben dem Hauptserver (`server.js`) nützliche Skripte zur Diagnose, falls deine Anlage einen anderen Chipsatz oder Firmware nutzt.

* **`daikin.js`**: Die Core-Library. Kommuniziert mit der Hardware.
* **`scanner.js`**: Findet Daikin-Anlagen im lokalen Netzwerk (Auto-Discovery).
* **`deep_scanner.js`**: Reverse-Engineering Tool. Scannt eine IP auf alle möglichen HTTP-Endpunkte ab, um versteckte Parameter zu finden.
* **`crawler.js`**: Zieht alle JSON-Daten der Anlage zur Analyse ab.

---

## ⚠️ Sicherheitshinweis

Die `config.json` speichert Passwörter im Klartext. Die `history.db` enthält Verlaufsdaten. Stelle sicher, dass der Ordner nicht öffentlich im Internet zugänglich ist.

---

**Lizenz:** MIT

```

---

### 2. `docker-compose.yml` (NEU)

Erstelle diese Datei im Hauptverzeichnis. Damit kann jeder User (und du selbst auf dem NAS) das Projekt mit einem Befehl starten, ohne Node.js installieren zu müssen.

```yaml
version: '3.8'

services:
  daikin-bridge:
    image: node:18-alpine
    container_name: daikin-bridge
    restart: unless-stopped
    # Zeitzone setzen für korrekte Logs
    environment:
      - TZ=Europe/Vienna
    # Ordner in den Container mappen
    volumes:
      - ./:/app
      - /app/node_modules
    working_dir: /app
    ports:
      - "8666:8666"
    # Installiert beim Start fehlende Pakete und startet dann
    command: sh -c "npm install && node server.js"

```

