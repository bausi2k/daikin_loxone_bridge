const dgram = require('dgram');

class LoxoneManager {
  constructor(config) {
    this.config = config;
    this.udpClient = dgram.createSocket('udp4');
    this.udpClient.on('error', (err) => {
      console.error("[UDP] Socket Error:", err.message);
    });
  }

  updateConfig(config) {
    this.config = config;
  }

  /**
   * Sends a value to Loxone via UDP.
   * @param {string} key 
   * @param {any} value 
   */
  send(key, value) {
    let finalVal = value;
    
    if (this.config.convertTextToNum) {
      if (value === 'on') finalVal = 1;
      else if (value === 'standby') finalVal = 0;
      else if (value === 'heating') finalVal = 1;
      else if (value === 'cooling') finalVal = 2;
      else if (value === 'auto') finalVal = 3;
      else if (value === true) finalVal = 1;
      else if (value === false) finalVal = 0;
    }

    const message = `WP_${key}: ${finalVal}`;
    
    try {
      this.udpClient.send(
        Buffer.from(message), 
        this.config.loxonePort, 
        this.config.loxoneIp, 
        (err) => {
          if (err) console.error("[UDP] Error sending to Loxone:", err);
        }
      );
    } catch (e) {
      console.error("[UDP] Exception sending to Loxone:", e.message);
    }
  }

  /**
   * Sends multiple values to Loxone.
   * @param {Object} state 
   */
  sendFullState(state) {
    if (!state) return;
    for (const [key, value] of Object.entries(state)) {
      this.send(key, value);
    }
  }

  /**
   * Sends a raw message to Loxone.
   * @param {string} message 
   */
  sendRaw(message) {
    try {
      this.udpClient.send(
        Buffer.from(message),
        this.config.loxonePort,
        this.config.loxoneIp
      );
    } catch (e) {
      console.error("[UDP] Error sending raw message:", e.message);
    }
  }

  close() {
    if (this.udpClient) {
      this.udpClient.close();
    }
  }
}

module.exports = LoxoneManager;
