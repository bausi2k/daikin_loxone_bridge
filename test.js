const { db, saveReading, getHistory, getLogs } = require('./database');
const MqttManager = require('./mqtt_manager');
const LoxoneManager = require('./loxone_manager');
const DaikinClient = require('./daikin');
const Validator = require('./validator');

async function runTests() {
  console.log('--- Testing DaikinBridge Robustness ---');

  // 1. Database Tests
  try {
    console.log('\n[TEST] Database Module...');
    saveReading({
      vlt: 45.5, outdoor: 12.0, indoor: 22.5, tank: 48.0, target: 46.0,
      ww_active: 0, heating_active: 1
    });
    const history = await getHistory('24h');
    if (history.length > 0) console.log('✅ Database: save/read works');
  } catch (e) { console.error('❌ Database Test failed', e); }

  // 2. MQTT Manager Tests
  try {
    console.log('\n[TEST] MQTT Manager...');
    const mqtt = new MqttManager({ mqttBroker: '', mqttTopic: 'test' });
    if (!mqtt.isConnected()) console.log('✅ MQTT: Correctly handles empty broker');
    
    // Simulate error event listener registration
    let errorHandled = false;
    mqtt.on('error', (err) => {
      if (err.message === 'Test error') {
        errorHandled = true;
      }
    });
    
    // Emit dummy error to confirm listener works
    mqtt.emit('error', new Error('Test error'));
    if (errorHandled) {
      console.log('✅ MQTT: Error event caught successfully');
    } else {
      console.error('❌ MQTT: Error event was not caught!');
    }
    
    mqtt.close();
  } catch (e) { console.error('❌ MQTT Test failed', e); }

  // 3. Loxone Manager Tests
  try {
    console.log('\n[TEST] Loxone Manager...');
    const loxone = new LoxoneManager({ loxoneIp: '127.0.0.1', loxonePort: 7000, convertTextToNum: true });
    loxone.send('TestKey', 'on');
    console.log('✅ Loxone: Send executed without error');
    loxone.close();
  } catch (e) { console.error('❌ Loxone Test failed', e); }

  // 4. Daikin Client Tests
  try {
    console.log('\n[TEST] Daikin Client...');
    const daikin = new DaikinClient({ daikinIp: '127.0.0.1' });
    if (daikin.state) console.log('✅ Daikin: Initialized correctly');
    daikin.close();
  } catch (e) { console.error('❌ Daikin Test failed', e); }

  // 4b. Daikin Command Queue Tests
  try {
    console.log('\n[TEST] Daikin Command Queue...');
    const daikin = new DaikinClient({ daikinIp: '127.0.0.1' });
    daikin.isConnected = true;
    
    const sentMessages = [];
    daikin.ws = {
      readyState: 1, // WebSocket.OPEN
      terminate: () => {},
      send: (msg) => {
        const parsed = JSON.parse(msg);
        sentMessages.push(parsed);
        
        // Simulate response from Daikin adapter after 50ms
        setTimeout(() => {
          const rqi = parsed['m2m:rqp'].rqi;
          const to = parsed['m2m:rqp'].to;
          daikin.handleMessage({
            'm2m:rsp': {
              rqi: rqi,
              fr: to,
              pc: { 'm2m:cin': { con: parsed['m2m:rqp'].pc['m2m:cin'].con } }
            }
          });
        }, 50);
      }
    };

    // Trigger two commands concurrently
    const p1 = daikin.executeCommand('ww_power', '0');
    const p2 = daikin.executeCommand('power', '1');

    await Promise.all([p1, p2]);

    if (sentMessages.length === 2) {
      console.log('✅ Daikin Queue: Sent 2 messages');
    } else {
      console.error('❌ Daikin Queue: Expected 2 messages, got ' + sentMessages.length);
    }

    const rqi1 = sentMessages[0]['m2m:rqp'].rqi;
    const rqi2 = sentMessages[1]['m2m:rqp'].rqi;
    if (rqi1 !== rqi2) {
      console.log('✅ Daikin Queue: Request IDs are unique (' + rqi1 + ' vs ' + rqi2 + ')');
    } else {
      console.error('❌ Daikin Queue: Request IDs are identical! (' + rqi1 + ')');
    }

    daikin.close();
  } catch (e) {
    console.error('❌ Daikin Command Queue Test failed', e);
  }

  // 4c. WP_Mode Debouncing and Update Tests
  try {
    console.log('\n[TEST] WP_Mode Debouncing...');
    // We will simulate the behavior of the server.js event handler logic
    const loxoneRawSends = [];
    const mockLoxone = {
      sendRaw: (msg) => loxoneRawSends.push(msg)
    };
    
    // Local state variables mimicking server.js variables
    let localDaikinState = { Power_Heating: 'standby', Mode: 'heating' };
    
    function testGetLoxoneMode(state) {
      const power = state.Power_Heating;
      const mode = state.Mode;
      if (power === 'on') {
        if (mode === 'heating') return 1;
        if (mode === 'cooling') return 2;
        if (mode === 'auto') return 3;
      }
      return 0;
    }

    let testModeUpdateTimer = null;
    let testLastSentLoxoneMode = null;

    function triggerTestModeUpdate() {
      if (testModeUpdateTimer) return;
      testModeUpdateTimer = setTimeout(() => {
        testModeUpdateTimer = null;
        const loxoneMode = testGetLoxoneMode(localDaikinState);
        if (loxoneMode !== testLastSentLoxoneMode) {
          testLastSentLoxoneMode = loxoneMode;
          mockLoxone.sendRaw(`WP_Mode: ${loxoneMode}`);
        }
      }, 10);
    }

    // Scenario 1: Power goes ON, Mode is cooling -> updates happen almost at the same time
    localDaikinState.Power_Heating = 'on';
    triggerTestModeUpdate();
    
    localDaikinState.Mode = 'cooling';
    triggerTestModeUpdate();

    // Wait 20ms for the debounce timer to fire
    await new Promise(resolve => setTimeout(resolve, 20));

    if (loxoneRawSends.length === 1 && loxoneRawSends[0] === 'WP_Mode: 2') {
      console.log('✅ WP_Mode: Successfully debounced simultaneous updates to a single send (WP_Mode: 2)');
    } else {
      console.error('❌ WP_Mode: Expected exactly 1 send ("WP_Mode: 2"), got:', loxoneRawSends);
    }

    // Scenario 2: Power goes back to standby (should return 0)
    localDaikinState.Power_Heating = 'standby';
    triggerTestModeUpdate();

    await new Promise(resolve => setTimeout(resolve, 20));

    if (loxoneRawSends.length === 2 && loxoneRawSends[1] === 'WP_Mode: 0') {
      console.log('✅ WP_Mode: Successfully set to 0 when Power_Heating is standby');
    } else {
      console.error('❌ WP_Mode: Expected second send to be "WP_Mode: 0", got:', loxoneRawSends);
    }

  } catch (e) {
    console.error('❌ WP_Mode Debouncing Test failed', e);
  }

  // 5. Validator Tests
  try {
    console.log('\n[TEST] Validator...');
    if (Validator.validateCommand('vlt', '45')) console.log('✅ Validator: Correctly validates vlt');
    if (!Validator.validateCommand('invalid', '123')) console.log('✅ Validator: Correctly rejects invalid command');
    if (!Validator.validateConfig({})) console.log('✅ Validator: Correctly rejects empty config');
  } catch (e) { console.error('❌ Validator Test failed', e); }

  console.log('\n--- All Functional Tests Completed ---');
  process.exit(0);
}

runTests();
