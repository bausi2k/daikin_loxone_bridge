const mqtt = require('mqtt');
const EventEmitter = require('events');

class MqttManager extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.client = null;
    this.connected = false;
  }

  updateConfig(config) {
    this.config = config;
    this.connect();
  }

  connect() {
    if (this.client) {
      this.client.end();
      this.client = null;
    }

    if (!this.config.mqttBroker) {
      this.connected = false;
      this.emit('status', false);
      return;
    }

    console.log(`[MQTT] Verbinde zu ${this.config.mqttBroker}...`);
    const options = {};
    if (this.config.mqttUser) {
      options.username = this.config.mqttUser;
      options.password = this.config.mqttPass;
    }

    this.client = mqtt.connect(this.config.mqttBroker, options);

    this.client.on('connect', () => {
      console.log('[MQTT] Verbunden!');
      this.connected = true;
      this.emit('status', true);
      this.emit('log', 'MQTT Verbunden', 'system');
      
      this.client.subscribe(`${this.config.mqttTopic}/set/#`);
    });

    this.client.on('close', () => {
      if (this.connected) {
        console.log('[MQTT] Verbindung verloren');
        this.connected = false;
        this.emit('status', false);
      }
    });

    this.client.on('error', (err) => {
      console.error('[MQTT] Error:', err.message);
      this.emit('error', err);
    });

    this.client.on('message', (topic, message) => {
      this.emit('message', topic, message.toString());
    });
  }

  publish(topic, value, options = { retain: true }) {
    if (!this.connected || !this.client) return;
    
    const fullTopic = topic.startsWith(this.config.mqttTopic) 
      ? topic 
      : `${this.config.mqttTopic}/${topic}`;
      
    this.client.publish(fullTopic, String(value), options);
  }

  publishState(state) {
    if (!this.connected || !this.client || !state) return;
    
    console.log('[MQTT] Sende kompletten Status (Retained)...');
    for (const [key, value] of Object.entries(state)) {
      this.publish(key, value);
    }
  }

  isConnected() {
    return this.connected;
  }

  close() {
    if (this.client) {
      this.client.end();
    }
  }
}

module.exports = MqttManager;
