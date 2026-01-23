// server.js
const express = require('express');
const dgram = require('dgram'); 
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const mqtt = require('mqtt'); 
const DaikinClient = require('./daikin'); 
const db = require('./database'); 

// --- CONFIG LADEN ---
const CONFIG_FILE = './config.json';
let config = { 
    daikinIp: "192.168.1.36", 
    loxoneIp: "192.168.1.200", 
    loxonePort: 7888, 
    webPort: 8666, 
    udpKeepAlive: 90,
    convertTextToNum: true,
    mqttBroker: "", mqttTopic: "daikin", mqttUser: "", mqttPass: ""
};

try {
    if (fs.existsSync(CONFIG_FILE)) {
        config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE)) };
    } else {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    }
} catch (e) { console.error("Config Error", e); }

// --- SETUP ---
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server }); 

const daikin = new DaikinClient(config);
const udpClient = dgram.createSocket('udp4');

// --- HELPER ---
function sendToLoxone(key, value) {
    let finalVal = value;
    if (config.convertTextToNum) {
        if (value === 'on') finalVal = 1;
        else if (value === 'standby') finalVal = 0;
        else if (value === 'heating') finalVal = 1;
        else if (value === 'cooling') finalVal = 2;
        else if (value === 'auto') finalVal = 3;
        else if (value === true) finalVal = 1;
        else if (value === false) finalVal = 0;
    }
    const message = `WP_${key}: ${finalVal}`;
    udpClient.send(Buffer.from(message), config.loxonePort, config.loxoneIp, (err) => {
        if (err) console.error("UDP Error:", err);
    });
}

function sendLog(msg, type = 'system') {
    const time = new Date().toLocaleTimeString('de-DE');
    broadcastToUI('log', { time, msg, type });
}

// --- MQTT ---
let mqttClient = null;
let mqttConnected = false; 

function connectMqtt() {
    if (mqttClient) { mqttClient.end(); mqttClient = null; }
    if (!config.mqttBroker) return;

    console.log(`[MQTT] Verbinde zu ${config.mqttBroker}...`);
    const options = {};
    if(config.mqttUser) { options.username = config.mqttUser; options.password = config.mqttPass; }

    mqttClient = mqtt.connect(config.mqttBroker, options);

    mqttClient.on('connect', () => {
        console.log('[MQTT] Verbunden!');
        mqttConnected = true;
        broadcastMqttStatus();
        sendLog('MQTT Verbunden', 'system');
        mqttClient.subscribe(`${config.mqttTopic}/set/#`);
    });

    mqttClient.on('close', () => {
        if(mqttConnected) {
            console.log('[MQTT] Verbindung verloren');
            mqttConnected = false;
            broadcastMqttStatus();
        }
    });

    mqttClient.on('error', (err) => { console.error('[MQTT] Error:', err.message); });
}
connectMqtt();

// --- PERIODIC TASKS ---
setInterval(() => {
    if (!daikin.state.VLT) return;
    const entry = {
        vlt: parseFloat(daikin.state.VLT || 0),
        outdoor: parseFloat(daikin.state.OutdoorTemp || 0),
        indoor: parseFloat(daikin.state.IndoorTemp || 0),
        tank: parseFloat(daikin.state.TankTemp || 0),
        target: parseFloat(daikin.state.Mode === 'cooling' ? (daikin.state.TargetVLT_Cool||0) : (daikin.state.TargetVLT_Heat||0))
    };
    db.saveReading(entry);
}, 60000); 

// UDP Heartbeat
let udpInterval = null;
function startUdpHeartbeat() {
    if (udpInterval) clearInterval(udpInterval);
    let intervalSec = parseInt(config.udpKeepAlive);
    if (isNaN(intervalSec) || intervalSec < 10) intervalSec = 90;
    console.log(`[UDP] Heartbeat Intervall: ${intervalSec} Sekunden`);

    udpInterval = setInterval(() => {
        if (Object.keys(daikin.state).length === 0) return;
        for (const [key, value] of Object.entries(daikin.state)) {
            sendToLoxone(key, value);
        }
        const power = daikin.state.Power_Heating; 
        const mode = daikin.state.Mode; 
        let loxoneMode = 0; 
        if (power === 'on') {
            if (mode === 'heating') loxoneMode = 1;
            else if (mode === 'cooling') loxoneMode = 2;
            else if (mode === 'auto') loxoneMode = 3;
        }
        udpClient.send(Buffer.from(`WP_Mode: ${loxoneMode}`), config.loxonePort, config.loxoneIp);
    }, intervalSec * 1000);
}
startUdpHeartbeat();

// --- WEBSOCKET ---
wss.on('connection', (ws) => {
    if (Object.keys(daikin.state).length > 0) ws.send(JSON.stringify({ type: 'state', data: daikin.state }));
    ws.send(JSON.stringify({ type: 'mqtt_status', connected: mqttConnected }));
});

function broadcastToUI(type, data) {
    const msg = JSON.stringify({ type: type, data: data });
    wss.clients.forEach(client => { if (client.readyState === WebSocket.OPEN) client.send(msg); });
}

function broadcastMqttStatus() { broadcastToUI('mqtt_status', { connected: mqttConnected }); }

daikin.on('log', (logEntry) => {
    const type = logEntry.type === 'error' ? 'error' : 'system';
    broadcastToUI('log', { ...logEntry, type });
});

daikin.on('update', (data) => {
    sendToLoxone(data.key, data.value);
    if (mqttConnected) mqttClient.publish(`${config.mqttTopic}/${data.key}`, String(data.value));
    broadcastToUI('state', daikin.state);
    sendLog(`${data.key}: ${data.value}`, 'input');

    if (data.key === 'Power_Heating' || data.key === 'Mode') {
        const power = daikin.state.Power_Heating; 
        const mode = daikin.state.Mode; 
        let loxoneMode = 0; 
        if (power === 'on') {
            if (mode === 'heating') loxoneMode = 1;
            else if (mode === 'cooling') loxoneMode = 2;
            else if (mode === 'auto') loxoneMode = 3;
        }
        udpClient.send(Buffer.from(`WP_Mode: ${loxoneMode}`), config.loxonePort, config.loxoneIp);
        if (mqttConnected) mqttClient.publish(`${config.mqttTopic}/Mode_Int`, String(loxoneMode));
    }
});

// --- API ---
app.get('/api/config', (req, res) => res.json(config));
app.post('/api/config', (req, res) => {
    config = { ...config, ...req.body };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    daikin.updateConfig(config);
    connectMqtt();
    startUdpHeartbeat();
    res.json({ success: true });
});

app.get('/set', (req, res) => {
    const cmd = req.query.cmd;
    let val = req.query.val;
    if (!cmd || val === undefined) return res.status(400).send("Error");

    if (cmd === 'power' || cmd === 'ww_power') {
        if (val === '1' || val === 'true') val = 'on';
        if (val === '0' || val === 'false') val = 'standby';
    }
    if (cmd === 'mode') {
        if (val === '1') val = 'heating';
        else if (val === '2') val = 'cooling';
        else if (val === '3') val = 'auto';
        else if (val === '0') val = 'standby';
    }

    daikin.executeCommand(cmd, val);
    sendLog(`${cmd} -> ${val}`, 'output');
    
    // WICHTIG: Nach kurzer Zeit Refresh erzwingen, damit UI aktualisiert!
    setTimeout(() => {
        daikin.pollAll();
    }, 1500); // 1.5s warten bis Daikin reagiert hat

    res.send(`OK: ${cmd}=${val}`);
});

app.post('/refresh', (req, res) => { daikin.pollAll(); sendLog("Manueller Refresh", "system"); res.json({ success: true }); });

app.get('/api/history', (req, res) => {
    const mode = req.query.mode || '24h';
    if (mode.startsWith('compare_')) db.getComparison(mode, (data) => res.json(data));
    else db.getHistory(mode, (data) => res.json(data));
});

// XML Export (Eingänge) - KORRIGIERT
app.get('/api/loxone.xml', (req, res) => {
    const port = config.loxonePort;
    const title = config.mqttTopic || "Daikin_Bridge";
    
    const cmds = [
        // --- SENSOREN (Mit <v.1> für 1 Nachkommastelle) ---
        { title: "WP Vorlauf Ist", check: "WP_VLT: \\v", unit: "&lt;v.1&gt;°C", min: -50, max: 100 },
        { title: "WP Aussen Temp", check: "WP_OutdoorTemp: \\v", unit: "&lt;v.1&gt;°C", min: -50, max: 100 },
        { title: "WP Innen Temp", check: "WP_IndoorTemp: \\v", unit: "&lt;v.1&gt;°C", min: -50, max: 100 },
        { title: "WP WW Ist Temp", check: "WP_TankTemp: \\v", unit: "&lt;v.1&gt;°C", min: -50, max: 100 },

        // --- SOLLWERTE (Mit <v.1>) ---
        { title: "WP Soll VLT Heizen", check: "WP_TargetVLT_Heat: \\v", unit: "&lt;v.1&gt;°C", min: 0, max: 100 },
        { title: "WP Soll VLT Kuehlen", check: "WP_TargetVLT_Cool: \\v", unit: "&lt;v.1&gt;°C", min: 0, max: 100 },
        { title: "WP Soll WW Temp", check: "WP_TargetTemp_WW: \\v", unit: "&lt;v.1&gt;°C", min: 0, max: 100 },

        // --- OFFSETS (Mit <v.1>) ---
        { title: "WP Offset Heizen", check: "WP_Offset_Heat: \\v", unit: "&lt;v.1&gt;K", min: -10, max: 10 },
        { title: "WP Offset Kuehlen", check: "WP_Offset_Cool: \\v", unit: "&lt;v.1&gt;K", min: -10, max: 10 },

        // --- STATUS (Digital/Integer - nur <v>) ---
        { title: "WP WW Status", check: "WP_Power_WW: \\v", unit: "&lt;v&gt;", min: 0, max: 1 },
        { title: "WP Heiz Status", check: "WP_Power_Heating: \\v", unit: "&lt;v&gt;", min: 0, max: 1 },
        { title: "WP WW Turbo", check: "WP_Powerful_WW: \\v", unit: "&lt;v&gt;", min: 0, max: 1 },
        { title: "WP Fehlercode", check: "WP_Error: \\v", unit: "&lt;v&gt;", min: 0, max: 1000 },
        { title: "WP Kombi Modus", check: "WP_Mode: \\v", unit: "&lt;v&gt;", min: 0, max: 10 }
    ];

    let xml = `<?xml version="1.0" encoding="utf-8"?>\n<VirtualInUdp Title="${title}" Comment="" Address="" Port="${port}">\n\t<Info templateType="1" minVersion="16011106"/>\n`;
    
    cmds.forEach(c => { 
        // Wichtig: Unit wird hier exakt so übernommen, wie oben definiert (mit &lt;v.1&gt;)
        xml += `\t<VirtualInUdpCmd Title="${c.title}" Comment="" Address="" Check="${c.check}" Signed="true" Analog="true" SourceValLow="0" DestValLow="0" SourceValHigh="100" DestValHigh="100" DefVal="0" MinVal="${c.min}" MaxVal="${c.max}" Unit="${c.unit}" HintText=""/>\n`; 
    });
    
    xml += `</VirtualInUdp>`;
    
    res.set('Content-Type', 'text/xml'); 
    res.attachment('VIU_Daikin_Sensors.xml'); 
    res.send(xml);
});

app.get('/api/loxone_out.xml', (req, res) => {
    const cmds = [
        { title: "WP Set Heizung Power", cmd: "/set?cmd=power&val=<v>", info: "0=Aus, 1=An" },
        { title: "WP Set Modus", cmd: "/set?cmd=mode&val=<v>", info: "1=Heiz, 2=Kühl, 3=Auto" },
        { title: "WP Set VLT Soll", cmd: "/set?cmd=vlt&val=<v>", info: "Temperatur" },
        { title: "WP Set Offset", cmd: "/set?cmd=offset_heat&val=<v>", info: "-5 bis +5" },
        { title: "WP Set WW Power", cmd: "/set?cmd=ww_power&val=<v>", info: "0=Aus, 1=An" },
        { title: "WP Set WW Turbo", cmd: "/set?cmd=ww_powerful&val=<v>", info: "0=Aus, 1=An" },
        { title: "WP Set WW Soll", cmd: "/set?cmd=ww_temp&val=<v>", info: "Temperatur" }
    ];
    let xml = `<?xml version="1.0" encoding="utf-8"?>\n<VirtualOut Title="Daikin_Control" Comment="Auto-generated" Address="http://BRIDGE_IP:${config.webPort}" CmdInit="" HintText="" CloseAfterSend="true" CmdSep=";">\n\t<Info templateType="3" minVersion="16011106"/>\n`;
    cmds.forEach(c => { xml += `\t<VirtualOutCmd Title="${c.title}" Comment="${c.info}" CmdOnMethod="GET" CmdOffMethod="GET" CmdOn="${c.cmd}" CmdOnHTTP="" CmdOnPost="" CmdOff="" CmdOffHTTP="" CmdOffPost="" CmdAnswer="" HintText="" Analog="true" Repeat="0" RepeatRate="0" SourceValHigh="100" DestValHigh="100"/>\n`; });
    xml += `</VirtualOut>`;
    res.set('Content-Type', 'text/xml'); res.attachment('VO_Daikin_Control.xml'); res.send(xml);
});

server.listen(config.webPort, () => { console.log(`Bridge läuft auf http://localhost:${config.webPort}`); });
daikin.connect();	