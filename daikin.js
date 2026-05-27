const WebSocket = require('ws');
const EventEmitter = require('events');

const POLL_PATHS = [
  '/[0]/MNAE/1/Sensor/IndoorTemperature/la',
  '/[0]/MNAE/1/Sensor/OutdoorTemperature/la',
  '/[0]/MNAE/2/Sensor/TankTemperature/la',
  '/[0]/MNAE/1/Sensor/LeavingWaterTemperatureCurrent/la',
  '/[0]/MNAE/1/Operation/Power/la',
  '/[0]/MNAE/1/Operation/OperationMode/la',
  '/[0]/MNAE/1/Operation/LeavingWaterTemperatureOffsetHeating/la',
  '/[0]/MNAE/1/Operation/LeavingWaterTemperatureOffsetCooling/la',
  '/[0]/MNAE/1/Operation/LeavingWaterTemperatureHeating/la',
  '/[0]/MNAE/1/Operation/LeavingWaterTemperatureCooling/la',
  '/[0]/MNAE/2/Operation/Power/la',
  '/[0]/MNAE/2/Operation/TargetTemperature/la',
  '/[0]/MNAE/2/Operation/Powerful/la',
  '/[0]/MNAE/2/UnitStatus/ReheatState/la',
  '/[0]/MNAE/1/UnitStatus/ErrorState/la',
  '/[0]/MNAE/1/UnitStatus/WarningState/la',
  '/[0]/MNAE/1/UnitStatus/EmergencyState/la',
];

/**
 * Daikin Altherma 3 Client
 */
class DaikinClient extends EventEmitter {
  /**
   * @param {Object} config 
   */
  constructor(config) {
    super();
    this.ws = null;
    this.isConnected = false;
    this.state = {};
    this.lastPacketTime = Date.now();
    this.reconnectAttempts = 0;
    this.rqiCounter = 0;
    this.commandQueue = [];
    this.isProcessingQueue = false;
    this.pendingRequests = new Map();
    this.isPollingActive = false;
    this.updateConfig(config);
  }

  /**
   * @param {Object} config 
   */
  updateConfig(config) {
    this.ip = config.daikinIp;
    this.pollingIntervalMs = (config.daikinPollingInterval || 60) * 1000;
    this.watchdogTimeoutMs = Math.max(this.pollingIntervalMs * 2.5, 180000);

    if (this.isConnected) {
      this.startPolling();
    }
  }

  /**
   * @param {string} msg 
   * @param {string} type 
   */
  log(msg, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('de-AT');
    console.log(`[DAIKIN][${type.toUpperCase()}] ${msg}`);
    this.emit('log', { time: timestamp, msg: msg, type: type });
  }

  connect() {
    if (this.ws) {
      try {
        this.ws.terminate();
      } catch (e) {
        // Ignore
      }
      this.ws = null;
    }

    const url = `ws://${this.ip}/mca`;
    this.log(`Verbinde zu Daikin unter ${url}...`, 'system');

    try {
      this.ws = new WebSocket(url, {
        handshakeTimeout: 5000
      });
    } catch (e) {
      this.log(`WS Fehler beim Erstellen: ${e.message}`, 'error');
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this.log('Daikin: Verbunden!', 'success');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.lastPacketTime = Date.now();
      this.startPolling();
    });

    this.ws.on('message', (data) => {
      this.lastPacketTime = Date.now();
      try {
        const json = JSON.parse(data.toString());
        this.handleMessage(json);
      } catch (e) {
        this.log(`Parse Error: ${e.message}`, 'error');
      }
    });

    this.ws.on('close', () => {
      if (this.isConnected) {
        this.log('Verbindung getrennt.', 'warning');
      }
      this.isConnected = false;
      this.scheduleReconnect();
    });

    this.ws.on('error', (e) => {
      this.log(`Socket Error: ${e.message}`, 'error');
      if (this.ws) this.ws.terminate();
    });
  }

  scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    
    // Exponential backoff: 5s, 10s, 20s, max 60s
    this.reconnectAttempts++;
    const delay = Math.min(5000 * Math.pow(2, Math.min(this.reconnectAttempts - 1, 3)), 60000);
    
    this.log(`Versuche Reconnect in ${delay / 1000}s... (Versuch ${this.reconnectAttempts})`, 'system');
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  /**
   * @param {Object} json 
   */
  handleMessage(json) {
    const rsp = json['m2m:rsp'];
    const rqp = json['m2m:rqp'];
    let path = null, val = null;
    let rqi = null;

    if (rsp) {
      rqi = rsp.rqi;
      if (rsp.fr && rsp.pc && rsp.pc['m2m:cin']) {
        path = rsp.fr;
        val = rsp.pc['m2m:cin'].con;
      }
    } else if (rqp) {
      rqi = rqp.rqi;
      if (rqp.to && rqp.pc && rqp.pc['m2m:cin']) {
        path = rqp.to;
        val = rqp.pc['m2m:cin'].con;
      }
    }

    if (rqi && this.pendingRequests.has(rqi)) {
      const resolvePending = this.pendingRequests.get(rqi);
      this.pendingRequests.delete(rqi);
      resolvePending();
    }

    if (path && val !== undefined) {
      this.mapData(path, val);
    }
  }

  /**
   * @param {string} path 
   * @param {any} value 
   */
  mapData(path, value) {
    let key = null;
    if (path.includes('Sensor/IndoorTemperature')) key = 'IndoorTemp';
    else if (path.includes('Sensor/OutdoorTemperature')) key = 'OutdoorTemp';
    else if (path.includes('Sensor/TankTemperature')) key = 'TankTemp';
    else if (path.includes('Sensor/LeavingWaterTemperatureCurrent')) key = 'VLT';
    else if (path.includes('/1/Operation/Power')) key = 'Power_Heating';
    else if (path.includes('/1/Operation/OperationMode')) key = 'Mode';
    else if (path.includes('OffsetHeating')) key = 'Offset_Heat';
    else if (path.includes('OffsetCooling')) key = 'Offset_Cool';
    else if (path.includes('LeavingWaterTemperatureHeating')) key = 'TargetVLT_Heat';
    else if (path.includes('LeavingWaterTemperatureCooling')) key = 'TargetVLT_Cool';
    else if (path.includes('/2/Operation/Powerful')) key = 'Powerful_WW';
    else if (path.includes('/2/Operation/Power')) key = 'Power_WW';
    else if (path.includes('/2/Operation/TargetTemperature')) key = 'TargetTemp_WW';
    else if (path.includes('ReheatState')) key = 'Reheat_WW';
    else if (path.includes('ErrorState')) key = 'Error';
    else if (path.includes('WarningState')) key = 'Warning';
    else if (path.includes('EmergencyState')) key = 'Emergency';

    if (key) {
      this.updateState(key, value);
    }
  }

  /**
   * @param {string} key 
   * @param {any} value 
   */
  updateState(key, value) {
    const changed = this.state[key] !== value;
    this.state[key] = value;
    if (changed) {
      this.log(`Update: ${key} = ${value}`, 'info');
      this.emit('update', { key, value });
    }
  }

  /**
   * @param {string} cmd 
   * @param {any} val 
   */
  async executeCommand(cmd, val) {
    let path = '';
    let finalVal = val;

    switch (cmd) {
      case 'power':
      case 'heizen':
        path = '/[0]/MNAE/1/Operation/Power';
        finalVal = val === '1' || val === 'on' || val === 'true' ? 'on' : 'standby';
        break;
      case 'mode':
        path = '/[0]/MNAE/1/Operation/OperationMode';
        break;
      case 'vlt':
        const currentMode = this.state.Mode || 'heating';
        let target = parseInt(val);
        if (currentMode === 'heating') {
          if (target <= 25) target = 30;
          path = '/[0]/MNAE/1/Operation/LeavingWaterTemperatureHeating';
        } else if (currentMode === 'cooling') {
          if (target >= 25) target = 20;
          path = '/[0]/MNAE/1/Operation/LeavingWaterTemperatureCooling';
        } else return;
        finalVal = target;
        break;
      case 'ww_power':
        path = '/[0]/MNAE/2/Operation/Power';
        finalVal = val === '1' || val === 'on' || val === 'true' ? 'on' : 'standby';
        break;
      case 'ww_powerful':
        path = '/[0]/MNAE/2/Operation/Powerful';
        finalVal = val === '1' || val === 'on' ? 1 : 0;
        break;
      case 'ww_temp':
        path = '/[0]/MNAE/2/Operation/TargetTemperature';
        finalVal = parseInt(val);
        break;
      case 'offset_heat':
        path = '/[0]/MNAE/1/Operation/LeavingWaterTemperatureOffsetHeating';
        finalVal = parseFloat(val);
        break;
      default:
        return;
    }

    this.log(`Sende an Daikin: ${cmd} -> ${finalVal}`, 'action');
    return this.queueCommand(path, finalVal);
  }

  /**
   * @param {string} path 
   * @param {any} value 
   */
  queueCommand(path, value) {
    return new Promise((resolve, reject) => {
      this.rqiCounter = (this.rqiCounter || 0) + 1;
      const rqi = `set_${Date.now()}_${this.rqiCounter}`;

      this.commandQueue.push({
        path,
        value,
        rqi,
        resolve,
        reject
      });

      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessingQueue || this.commandQueue.length === 0) return;
    this.isProcessingQueue = true;

    while (this.commandQueue.length > 0) {
      const item = this.commandQueue[0];
      
      try {
        await this.sendQueuedCommand(item);
        item.resolve();
      } catch (err) {
        this.log(`Queue command failed: ${err.message}`, 'error');
        item.reject(err);
      }

      this.commandQueue.shift();
      // Cooldown delay after each command to avoid overloading the Daikin MCA
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    this.isProcessingQueue = false;
  }

  sendQueuedCommand(item) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Senden fehlgeschlagen: Nicht verbunden.'));
        return;
      }

      const payload = {
        'm2m:rqp': {
          op: 1,
          to: item.path,
          fr: '/S',
          rqi: item.rqi,
          ty: 4,
          pc: { 'm2m:cin': { con: item.value, cnf: 'text/plain:0' } },
        },
      };

      // Set up response listener
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(item.rqi);
        this.log(`Timeout für Command rqi=${item.rqi}`, 'warning');
        resolve(); // resolve on timeout to not block the queue permanently
      }, 2000);

      this.pendingRequests.set(item.rqi, () => {
        clearTimeout(timeout);
        resolve();
      });

      try {
        this.ws.send(JSON.stringify(payload));
      } catch (e) {
        clearTimeout(timeout);
        this.pendingRequests.delete(item.rqi);
        reject(e);
      }
    });
  }

  resetPollInterval() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = setInterval(() => {
      this.pollAll();
    }, this.pollingIntervalMs);
  }

  startPolling() {
    this.pollAll();
    this.resetPollInterval();
  }

  pollAll() {
    if (this.isPollingActive) {
      this.log('Abfrage bereits aktiv. Überspringe Überlappung.', 'system');
      return;
    }

    // --- WATCHDOG CHECK ---
    const silenceDuration = Date.now() - this.lastPacketTime;
    if (silenceDuration > this.watchdogTimeoutMs) {
      this.log(
        `WATCHDOG: Keine Daten seit ${Math.round(silenceDuration / 1000)}s. Erzwinge Neustart!`,
        'error',
      );
      if (this.ws) this.ws.terminate();
      return;
    }

    if (!this.isConnected) return;

    this.isPollingActive = true;
    this.log(`Frage Werte ab (Intervall: ${this.pollingIntervalMs / 1000}s)...`, 'system');

    // Reset periodic timer so the next interval starts *after* this poll run
    this.resetPollInterval();

    let delay = 0;
    POLL_PATHS.forEach((path, idx) => {
      setTimeout(() => {
        this.sendRequest(path);
        if (idx === POLL_PATHS.length - 1) {
          this.isPollingActive = false;
        }
      }, delay);
      delay += 200;
    });
  }

  /**
   * @param {string} path 
   */
  sendRequest(path) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    const payload = {
      'm2m:rqp': { op: 2, to: path, fr: '/S', rqi: 'req_' + Date.now().toString(36) },
    };
    
    try {
      this.ws.send(JSON.stringify(payload));
    } catch (e) {
      // Ignore
    }
  }

  close() {
    if (this.ws) {
      this.ws.terminate();
    }
    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
  }
}

module.exports = DaikinClient;