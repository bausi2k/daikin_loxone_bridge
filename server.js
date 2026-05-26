const express = require('express');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const DaikinClient = require('./daikin');
const db = require('./database');
const MqttManager = require('./mqtt_manager');
const LoxoneManager = require('./loxone_manager');
const Validator = require('./validator');
const packageJson = require('./package.json');

// --- CONFIGURATION ---
const CONFIG_FILE = './config.json';
let config = {
  daikinIp: '192.168.1.36',
  loxoneIp: '192.168.1.200',
  loxonePort: 7888,
  webPort: 8666,
  udpKeepAlive: 90,
  daikinPollingInterval: 60,
  convertTextToNum: true,
  mqttBroker: '',
  mqttTopic: 'daikin',
  mqttUser: '',
  mqttPass: '',
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE).toString()) };
    } else {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    }
  } catch (e) {
    console.error('[CONFIG] Error loading config:', e.message);
  }
}
loadConfig();

// --- MANAGERS ---
const loxone = new LoxoneManager(config);
const mqtt = new MqttManager(config);
const daikin = new DaikinClient(config);

// --- SETUP EXPRESS & WEBSOCKET ---
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- HELPERS ---
function sendLog(msg, type = 'system') {
  const timestamp = Date.now();
  db.saveLog(type, msg);
  broadcastToUI('log', { timestamp, msg, type });
}

function broadcastToUI(type, data) {
  const msg = JSON.stringify({ type, data });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

function getLoxoneMode() {
  const power = daikin.state.Power_Heating;
  const mode = daikin.state.Mode;
  if (power === 'on') {
    if (mode === 'heating') return 1;
    if (mode === 'cooling') return 2;
    if (mode === 'auto') return 3;
  }
  return 0;
}

// --- EVENT HANDLERS ---
daikin.on('log', (logEntry) => {
  const type = logEntry.type === 'error' ? 'error' : 'system';
  const ts = Date.now();
  db.saveLog(type, logEntry.msg);
  broadcastToUI('log', { timestamp: ts, msg: logEntry.msg, type });
});

daikin.on('update', (data) => {
  loxone.send(data.key, data.value);
  mqtt.publish(data.key, data.value);

  broadcastToUI('state', daikin.state);
  sendLog(`${data.key}: ${data.value}`, 'input');

  if (data.key === 'Power_Heating' || data.key === 'Mode') {
    const loxoneMode = getLoxoneMode();
    loxone.sendRaw(`WP_Mode: ${loxoneMode}`);
    mqtt.publish('Mode_Int', loxoneMode);
  }
});

mqtt.on('status', (connected) => {
  broadcastToUI('mqtt_status', { connected });
});

mqtt.on('log', (msg, type) => sendLog(msg, type));

mqtt.on('message', (topic, message) => {
  // MQTT Set Handler (Optional for later)
  console.log(`[MQTT] Incoming: ${topic} -> ${message}`);
});

// --- PERIODIC TASKS ---
// Save readings to DB every 60s
setInterval(() => {
  if (!daikin.state.VLT) return;

  const entry = {
    vlt: parseFloat(daikin.state.VLT || 0),
    outdoor: parseFloat(daikin.state.OutdoorTemp || 0),
    indoor: parseFloat(daikin.state.IndoorTemp || 0),
    tank: parseFloat(daikin.state.TankTemp || 0),
    target: parseFloat(
      daikin.state.Mode === 'cooling'
        ? daikin.state.TargetVLT_Cool || 0
        : daikin.state.TargetVLT_Heat || 0,
    ),
    ww_active: daikin.state.Power_WW === 'on' ? 1 : 0,
    heating_active: daikin.state.Power_Heating === 'on' ? 1 : 0,
  };
  db.saveReading(entry);
}, 60000);

// Heartbeat for Loxone
let udpInterval = null;
function startUdpHeartbeat() {
  if (udpInterval) clearInterval(udpInterval);
  let intervalSec = parseInt(config.udpKeepAlive.toString());
  if (isNaN(intervalSec) || intervalSec < 10) intervalSec = 90;

  udpInterval = setInterval(() => {
    if (Object.keys(daikin.state).length === 0) return;
    loxone.sendFullState(daikin.state);
    loxone.sendRaw(`WP_Mode: ${getLoxoneMode()}`);
  }, intervalSec * 1000);
}

// --- WEBSOCKET CONNECTION ---
wss.on('connection', (ws) => {
  if (Object.keys(daikin.state).length > 0)
    ws.send(JSON.stringify({ type: 'state', data: daikin.state }));
  ws.send(JSON.stringify({ type: 'mqtt_status', data: { connected: mqtt.isConnected() } }));
});

// --- API ROUTES ---
app.get('/api/config', (req, res) => {
  res.json({ ...config, appVersion: packageJson.version });
});

app.post('/api/config', (req, res) => {
  const error = Validator.validateConfig(req.body);
  if (error) return res.status(400).json({ success: false, error });

  config = { ...config, ...req.body };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

  daikin.updateConfig(config);
  mqtt.updateConfig(config);
  loxone.updateConfig(config);
  startUdpHeartbeat();

  res.json({ success: true });
});

app.get('/set', (req, res) => {
  const { cmd } = req.query;
  let { val } = req.query;
  
  if (!Validator.validateCommand(cmd, val)) {
    return res.status(400).send('Invalid Command or Value');
  }

  daikin.executeCommand(cmd, val);
  sendLog(`${cmd} -> ${val}`, 'output');

  setTimeout(() => daikin.pollAll(), 1500);
  res.send(`OK: ${cmd}=${val}`);
});

app.post('/refresh', (req, res) => {
  daikin.pollAll();
  sendLog('Manueller Refresh', 'system');
  res.json({ success: true });
});

app.get('/api/history', async (req, res) => {
  const mode = req.query.mode || '24h';
  try {
    if (mode.startsWith('compare_')) {
      const data = await db.getComparison(mode);
      res.json(data);
    } else {
      const data = await db.getHistory(mode);
      res.json(data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/stats', async (req, res) => {
  const mode = req.query.mode || '14d';
  try {
    const data = await db.getStats(mode);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/logs', async (req, res) => {
  try {
    const data = await db.getLogs(req.query.date);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// XML Export Routes
app.get('/api/loxone.xml', (req, res) => {
  const port = config.loxonePort;
  const title = config.mqttTopic || 'Daikin_Bridge';
  const cmds = [
    { title: 'WP Vorlauf Ist', check: 'WP_VLT: \\v', unit: '&lt;v.1&gt;°C', min: -50, max: 100 },
    { title: 'WP Aussen Temp', check: 'WP_OutdoorTemp: \\v', unit: '&lt;v.1&gt;°C', min: -50, max: 100 },
    { title: 'WP Innen Temp', check: 'WP_IndoorTemp: \\v', unit: '&lt;v.1&gt;°C', min: -50, max: 100 },
    { title: 'WP WW Ist Temp', check: 'WP_TankTemp: \\v', unit: '&lt;v.1&gt;°C', min: -50, max: 100 },
    { title: 'WP WW Status', check: 'WP_Power_WW: \\v', unit: '&lt;v&gt;', min: 0, max: 1 },
    { title: 'WP Heiz Status', check: 'WP_Power_Heating: \\v', unit: '&lt;v&gt;', min: 0, max: 1 },
    { title: 'WP WW Turbo', check: 'WP_Powerful_WW: \\v', unit: '&lt;v&gt;', min: 0, max: 1 },
    { title: 'WP Fehlercode', check: 'WP_Error: \\v', unit: '&lt;v&gt;', min: 0, max: 1000 },
    { title: 'WP Kombi Modus', check: 'WP_Mode: \\v', unit: '&lt;v&gt;', min: 0, max: 10 },
    { title: 'WP Soll VLT Heizen', check: 'WP_TargetVLT_Heat: \\v', unit: '&lt;v.1&gt;°C', min: 0, max: 100 },
    { title: 'WP Soll VLT Kuehlen', check: 'WP_TargetVLT_Cool: \\v', unit: '&lt;v.1&gt;°C', min: 0, max: 100 },
    { title: 'WP Soll WW Temp', check: 'WP_TargetTemp_WW: \\v', unit: '&lt;v.1&gt;°C', min: 0, max: 100 },
    { title: 'WP Offset Heizen', check: 'WP_Offset_Heat: \\v', unit: '&lt;v.1&gt;K', min: -10, max: 10 },
    { title: 'WP Offset Kuehlen', check: 'WP_Offset_Cool: \\v', unit: '&lt;v.1&gt;K', min: -10, max: 10 },
  ];
  let xml = `<?xml version="1.0" encoding="utf-8"?>\n<VirtualInUdp Title="${title}" Comment="" Address="" Port="${port}">\n\t<Info templateType="1" minVersion="16011106"/>\n`;
  cmds.forEach((c) => {
    xml += `\t<VirtualInUdpCmd Title="${c.title}" Comment="" Address="" Check="${c.check}" Signed="true" Analog="true" SourceValLow="0" DestValLow="0" SourceValHigh="100" DestValHigh="100" DefVal="0" MinVal="${c.min}" MaxVal="${c.max}" Unit="${c.unit}" HintText=""/>\n`;
  });
  xml += `</VirtualInUdp>`;
  res.set('Content-Type', 'text/xml');
  res.attachment('VIU_Daikin_Sensors.xml');
  res.send(xml);
});

app.get('/api/loxone_out.xml', (req, res) => {
  const cmds = [
    { title: 'WP Set Heizung Power', cmd: '/set?cmd=power&val=<v>', info: '0=Aus, 1=An' },
    { title: 'WP Set Modus', cmd: '/set?cmd=mode&val=<v>', info: '1=Heiz, 2=Kühl, 3=Auto' },
    { title: 'WP Set VLT Soll', cmd: '/set?cmd=vlt&val=<v>', info: 'Temperatur' },
    { title: 'WP Set Offset', cmd: '/set?cmd=offset_heat&val=<v>', info: '-5 bis +5' },
    { title: 'WP Set WW Power', cmd: '/set?cmd=ww_power&val=<v>', info: '0=Aus, 1=An' },
    { title: 'WP Set WW Turbo', cmd: '/set?cmd=ww_powerful&val=<v>', info: '0=Aus, 1=An' },
    { title: 'WP Set WW Soll', cmd: '/set?cmd=ww_temp&val=<v>', info: 'Temperatur' },
  ];
  let xml = `<?xml version="1.0" encoding="utf-8"?>\n<VirtualOut Title="Daikin_Control" Comment="Auto-generated" Address="http://BRIDGE_IP:${config.webPort}" CmdInit="" HintText="" CloseAfterSend="true" CmdSep=";">\n\t<Info templateType="3" minVersion="16011106"/>\n`;
  cmds.forEach((c) => {
    xml += `\t<VirtualOutCmd Title="${c.title}" Comment="${c.info}" CmdOnMethod="GET" CmdOn="${c.cmd}" CmdOnHTTP="" CmdOnPost="" CmdOff="" CmdOffHTTP="" CmdOffPost="" CmdAnswer="" HintText="" Analog="true" Repeat="0" RepeatRate="0" SourceValHigh="100" DestValHigh="100"/>\n`;
  });
  xml += `</VirtualOut>`;
  res.set('Content-Type', 'text/xml');
  res.attachment('VO_Daikin_Control.xml');
  res.send(xml);
});

// --- STARTUP ---
server.listen(config.webPort, () => {
  console.log(`Bridge läuft auf http://localhost:${config.webPort}`);
  mqtt.connect();
  daikin.connect();
  startUdpHeartbeat();
});

// --- GRACEFUL SHUTDOWN ---
function gracefulShutdown() {
  console.log('[SYSTEM] Fahre Bridge herunter...');
  daikin.close();
  mqtt.close();
  loxone.close();
  server.close(() => {
    console.log('[SYSTEM] Server geschlossen.');
    db.db.close(() => {
      console.log('[SYSTEM] Datenbank geschlossen. Bis bald!');
      process.exit(0);
    });
  });
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);