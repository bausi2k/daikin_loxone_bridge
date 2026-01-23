# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei dokumentiert.

## [1.2.0] - 2026-01-23

### ✨ Neu (Features)
- **Persistentes Logging:** System-Logs werden nun in der SQLite-Datenbank (`system_logs`) gespeichert und gehen bei Neustarts nicht mehr verloren.
- **Log Explorer:** Neuer Datepicker im "Logs"-Tab erlaubt das Abrufen historischer Protokolle.
- **Lokalisierung:** Zeitstempel im UI verwenden nun das österreichische 24h-Format (`de-AT`).
- **API:** Neuer Endpunkt `/api/logs?date=YYYY-MM-DD` zum Abrufen von Logdaten.

### 🛠 Technik
- **Datenbank:** Schema-Erweiterung um Tabelle `system_logs` mit Auto-Cleanup (Logs > 30 Tage werden gelöscht).
- **Backend:** `sendLog` Helper schreibt nun synchron in DB und sendet WebSocket-Events.


## [1.1.0] - 2026-01-23

### ✨ Verbesserungen
- **UDP Heartbeat:** Neuer Mechanismus, der alle 90 Sekunden (konfigurierbar) alle Werte an Loxone sendet, um "Offline"-Status zu verhindern.
- **UI Feedback:** Sofortige Aktualisierung des Status im Webinterface nach Klick (keine Wartezeit mehr).
- **Log System:** Kategorisierung der Logs (Input/Output/System) mit Filter-Tabs im UI.
- **Mobile Design:** Optimiertes Layout für Smartphones (Sidebar ausgeblendet, Header fixiert).

### 🐛 Bugfixes
- **Loxone XML Export:** Formatierung der Einheiten korrigiert (`<v.1>`), damit Loxone Nachkommastellen korrekt anzeigt.
- **Layout:** CSS-Fixes für den Header in der Desktop-Ansicht.

## [1.0.0] - 2023-10-27

### ✨ Neu (Features)
- **Modern Dashboard:** Komplettes Redesign des Webinterfaces (Dark Mode, Glassmorphismus, Mobile-Responsive).
- **Analytics Module:** Integration einer SQLite Datenbank (`history.db`) zur Speicherung von Sensorwerten.
- **Charts:** Interaktive Diagramme für Vorlauf, Warmwasser, Innen- und Außentemperatur (Chart.js).
- **Smart Filters:** Vergleichsansichten (Heute vs. Gestern, Monatsvergleich) im UI.
- **MQTT Integration:** Vollständiger Support für MQTT (Lesen/Schreiben) zur Anbindung an Home Assistant/ioBroker.
- **Loxone UDP Heartbeat:** Konfigurierbares Keep-Alive Intervall (Standard 90s), um Loxone-Werte aktuell zu halten.
- **Auto-Discovery:** `scanner.js` Skript zum automatischen Finden der Daikin-Anlage im Netzwerk.
- **Docker Support:** Offizielles `Dockerfile` und `docker-compose.yml` für einfache Installation.
- **GHCR Integration:** Automatischer Build-Workflow für GitHub Container Registry.

### 🛠 Technik & Fixes
- **Backend:** Umstellung auf Node.js Event-basierte Architektur.
- **Logic:** Automatische "Power On" Logik beim Wechseln des Modus (Heizen/Kühlen).
- **Network:** Nutzung von `network_mode: host` im Docker Container für problemlose UDP-Kommunikation.
- **Config:** Automatische Erstellung von XML-Vorlagen (`VIU` und `VO`) für den Loxone Import.

### 📖 Dokumentation
- Umfangreiches README mit Installationsanleitung für Docker und Node.js.
- API Dokumentation im Webinterface integriert.