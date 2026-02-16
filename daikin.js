// daikin.js
const WebSocket = require('ws');
const EventEmitter = require('events');

// --- KONFIGURATION DER PFADE ---
const POLL_PATHS = [
    "/[0]/MNAE/1/Sensor/IndoorTemperature/la",
    "/[0]/MNAE/1/Sensor/OutdoorTemperature/la",
    "/[0]/MNAE/2/Sensor/TankTemperature/la",
    "/[0]/MNAE/1/Sensor/LeavingWaterTemperatureCurrent/la",
    
    "/[0]/MNAE/1/Operation/Power/la",
    "/[0]/MNAE/1/Operation/OperationMode/la",
    "/[0]/MNAE/1/Operation/LeavingWaterTemperatureOffsetHeating/la",
    "/[0]/MNAE/1/Operation/LeavingWaterTemperatureOffsetCooling/la",
    "/[0]/MNAE/1/Operation/LeavingWaterTemperatureHeating/la",
    "/[0]/MNAE/1/Operation/LeavingWaterTemperatureCooling/la",
    
    "/[0]/MNAE/2/Operation/Power/la",            
    "/[0]/MNAE/2/Operation/TargetTemperature/la", 
    "/[0]/MNAE/2/Operation/Powerful/la",          
    "/[0]/MNAE/2/UnitStatus/ReheatState/la",
    
    "/[0]/MNAE/1/UnitStatus/ErrorState/la",
    "/[0]/MNAE/1/UnitStatus/WarningState/la",
    "/[0]/MNAE/1/UnitStatus/EmergencyState/la"
];

// WATCHDOG CONFIG: Nach 3 Minuten ohne Antwort wird neu verbunden
const WATCHDOG_TIMEOUT = 3 * 60 * 1000; 

class DaikinClient extends EventEmitter {
    constructor(config) {
        super();
        this.updateConfig(config);
        this.ws = null;
        this.isConnected = false;
        this.state = {};
        this.lastPacketTime = Date.now(); // Initiale Zeit
    }

    updateConfig(config) { this.ip = config.daikinIp; }
    
    log(msg, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${type.toUpperCase()}] ${msg}`);
        this.emit('log', { time: timestamp, msg: msg, type: type });
    }

    connect() {
        // Falls noch eine alte Verbindung hängt, aufräumen
        if (this.ws) {
            try { this.ws.terminate(); } catch(e) {}
            this.ws = null;
        }

        const url = `ws://${this.ip}/mca`;
        this.log(`Verbinde zu Daikin unter ${url}...`, 'system');
        
        try { 
            this.ws = new WebSocket(url); 
        } catch (e) { 
            this.log(`WS Fehler: ${e.message}`, 'error'); 
            this.scheduleReconnect();
            return; 
        }

        this.ws.on('open', () => { 
            this.log('Daikin: Verbunden!', 'success'); 
            this.isConnected = true; 
            this.lastPacketTime = Date.now(); // Reset Watchdog
            this.startPolling(); 
        });
        
        this.ws.on('message', (data) => { 
            this.lastPacketTime = Date.now(); // Lebenszeichen empfangen
            try { this.handleMessage(JSON.parse(data)); } catch (e) { console.error(e); } 
        });
        
        this.ws.on('close', () => { 
            if(this.isConnected) this.log('Verbindung getrennt.', 'warning');
            this.isConnected = false; 
            this.scheduleReconnect();
        });
        
        this.ws.on('error', (e) => {
            this.log(`Error: ${e.message}`, 'error');
            this.ws.terminate(); // Force close triggert 'close' Event
        });
    }

    scheduleReconnect() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), 5000); 
    }

    handleMessage(json) {
        const rsp = json['m2m:rsp'];
        const rqp = json['m2m:rqp'];
        let path = null, val = null;

        if (rsp && rsp.fr && rsp.pc?.['m2m:cin']) { path = rsp.fr; val = rsp.pc['m2m:cin'].con; } 
        else if (rqp && rqp.to && rqp.pc?.['m2m:cin']) { path = rqp.to; val = rqp.pc['m2m:cin'].con; }

        if (path && val !== undefined) this.mapData(path, val);
    }

    mapData(path, value) {
        let key = null;
        if (path.includes('Sensor/IndoorTemperature')) key = "IndoorTemp";
        else if (path.includes('Sensor/OutdoorTemperature')) key = "OutdoorTemp";
        else if (path.includes('Sensor/TankTemperature')) key = "TankTemp";
        else if (path.includes('Sensor/LeavingWaterTemperatureCurrent')) key = "VLT";
        else if (path.includes('/1/Operation/Power')) key = "Power_Heating";
        else if (path.includes('/1/Operation/OperationMode')) key = "Mode";
        else if (path.includes('OffsetHeating')) key = "Offset_Heat";
        else if (path.includes('OffsetCooling')) key = "Offset_Cool";
        else if (path.includes('LeavingWaterTemperatureHeating')) key = "TargetVLT_Heat";
        else if (path.includes('LeavingWaterTemperatureCooling')) key = "TargetVLT_Cool";
        else if (path.includes('/2/Operation/Powerful')) key = "Powerful_WW";
        else if (path.includes('/2/Operation/Power')) key = "Power_WW";
        else if (path.includes('/2/Operation/TargetTemperature')) key = "TargetTemp_WW";
        else if (path.includes('ReheatState')) key = "Reheat_WW";
        else if (path.includes('ErrorState')) key = "Error";
        else if (path.includes('WarningState')) key = "Warning";
        else if (path.includes('EmergencyState')) key = "Emergency";

        if (key) this.updateState(key, value);
    }

    updateState(key, value) {
        const changed = this.state[key] !== value;
        this.state[key] = value;
        
        if (changed) {
            this.log(`Update: ${key} = ${value}`, 'info');
            this.emit('update', { key, value });
        }
    }

    async executeCommand(cmd, val) {
        let path = "";
        let finalVal = val;
        let logCmd = cmd;

        switch(cmd) {
            case "power": case "heizen":
                path = "/[0]/MNAE/1/Operation/Power";
                finalVal = (val === "1" || val === "on" || val === "true") ? "on" : "standby";
                break;
            case "mode": 
                path = "/[0]/MNAE/1/Operation/OperationMode";
                break;
            case "vlt":
                const currentMode = this.state.Mode || 'heating'; 
                let target = parseInt(val);
                if (currentMode === 'heating') {
                    if (target <= 25) target = 30;
                    path = "/[0]/MNAE/1/Operation/LeavingWaterTemperatureHeating";
                } else if (currentMode === 'cooling') {
                    if (target >= 25) target = 20;
                    path = "/[0]/MNAE/1/Operation/LeavingWaterTemperatureCooling";
                } else return;
                finalVal = target;
                break;
            case "ww_power":
                path = "/[0]/MNAE/2/Operation/Power";
                finalVal = (val === "1" || val === "on" || val === "true") ? "on" : "standby";
                break;
            case "ww_powerful": 
                path = "/[0]/MNAE/2/Operation/Powerful";
                finalVal = (val === "1" || val === "on") ? 1 : 0;
                break;
            case "ww_temp": 
                path = "/[0]/MNAE/2/Operation/TargetTemperature";
                finalVal = parseInt(val);
                break;
            case "offset_heat":
                path = "/[0]/MNAE/1/Operation/LeavingWaterTemperatureOffsetHeating";
                finalVal = parseFloat(val);
                break;
            default:
                this.log(`Unbekannter Befehl: ${cmd}`, 'warning');
                return;
        }
        
        this.log(`Sende an Daikin: ${logCmd} -> ${finalVal}`, 'action');
        this.setValue(path, finalVal);
    }

    setValue(path, value) {
        if (!this.isConnected) return;
        const payload = {
            "m2m:rqp": { "op": 1, "to": path, "fr": "/S", "rqi": "set_" + Date.now(), "ty": 4,
                "pc": { "m2m:cin": { "con": value, "cnf": "text/plain:0" } } }
        };
        try {
            this.ws.send(JSON.stringify(payload));
        } catch (e) {
            this.log("Fehler beim Senden: " + e.message, "error");
        }
    }

    startPolling() {
        this.pollAll();
        if (this.pollInterval) clearInterval(this.pollInterval);
        this.pollInterval = setInterval(() => { this.pollAll(); }, 60000);
    }

    pollAll() {
        // --- WATCHDOG CHECK ---
        const silenceDuration = Date.now() - this.lastPacketTime;
        if (silenceDuration > WATCHDOG_TIMEOUT) {
            this.log(`WATCHDOG: Keine Daten seit ${Math.round(silenceDuration/1000)}s. Erzwinge Neustart!`, 'error');
            this.ws.terminate(); // Kill Socket -> Close Event -> Reconnect
            return;
        }
        // ----------------------

        if (!this.isConnected) {
            // Versuche es im nächsten Intervall wieder, Watchdog kümmert sich um den Rest
            return;
        }
        
        this.log(`Frage ${POLL_PATHS.length} Werte ab...`, 'system');

        let delay = 0;
        POLL_PATHS.forEach(path => { 
            setTimeout(() => this.sendRequest(path), delay); 
            delay += 200; 
        });
    }

    sendRequest(path) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const payload = { "m2m:rqp": { "op": 2, "to": path, "fr": "/S", "rqi": "req_" + Date.now().toString(36) } };
        try {
            this.ws.send(JSON.stringify(payload));
        } catch (e) {
            console.error("Send Error", e);
        }
    }
}

module.exports = DaikinClient;