/**
 * Simple validation helper for Daikin Bridge
 */
class Validator {
  /**
   * Validates a command and its value.
   * @param {string} cmd 
   * @param {any} val 
   * @returns {boolean}
   */
  static validateCommand(cmd, val) {
    const validCmds = ['power', 'ww_power', 'mode', 'vlt', 'ww_temp', 'ww_powerful', 'offset_heat'];
    if (!validCmds.includes(cmd)) return false;

    if (val === undefined || val === null) return false;

    // Additional checks based on command
    switch (cmd) {
      case 'vlt':
      case 'ww_temp':
        const temp = parseFloat(val);
        return !isNaN(temp) && temp >= 10 && temp <= 80;
      case 'offset_heat':
        const offset = parseFloat(val);
        return !isNaN(offset) && offset >= -10 && offset <= 10;
      case 'mode':
        return ['1', '2', '3', '0', 'heating', 'cooling', 'auto', 'standby'].includes(val.toString());
      default:
        return true;
    }
  }

  /**
   * Validates the configuration object.
   * @param {Object} config 
   * @returns {string|null} Error message or null if valid
   */
  static validateConfig(config) {
    if (!config.daikinIp) return "Daikin IP ist erforderlich";
    if (!config.loxoneIp) return "Loxone IP ist erforderlich";
    if (isNaN(parseInt(config.loxonePort))) return "Loxone Port muss eine Zahl sein";
    if (config.mqttBroker && !config.mqttBroker.startsWith('mqtt')) {
      return "MQTT Broker muss mit mqtt:// oder mqtts:// beginnen";
    }
    return null;
  }
}

module.exports = Validator;
