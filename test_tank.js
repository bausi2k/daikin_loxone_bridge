const WebSocket = require('ws');
const fs = require('fs');

// Config laden, um die IP-Adresse dynamisch zu beziehen
let config = { daikinIp: "192.168.1.36" };
try {
    if (fs.existsSync(__dirname + '/config.json')) {
        config = JSON.parse(fs.readFileSync(__dirname + '/config.json'));
    }
} catch (e) {
    console.warn("Konnte config.json nicht lesen, nutze Standard-IP:", config.daikinIp);
}

const path = "/[0]/MNAE/2/Sensor/TankTemperature/la";
console.log(`Verbinde zu Daikin Altherma (${config.daikinIp})...`);
console.log(`Frage rohen Wert ab für: ${path}\n`);

const ws = new WebSocket(`ws://${config.daikinIp}/mca`);

ws.on('open', () => {
    // RQI generieren
    const rqi = "req_tank_" + Date.now();
    const payload = {
        "m2m:rqp": {
            "op": 2,
            "to": path,
            "fr": "/S",
            "rqi": rqi
        }
    };

    ws.send(JSON.stringify(payload));
});

ws.on('message', (data) => {
    try {
        const parsed = JSON.parse(data.toString());
        // Prüfen, ob dies unsere Antwort ist
        if (parsed['m2m:rsp']) {
            console.log("=== RAW JSON ANTWORT ===");
            console.log(JSON.stringify(parsed, null, 2));
            
            const cin = parsed['m2m:rsp'].pc && parsed['m2m:rsp'].pc['m2m:cin'];
            if (cin && cin.con !== undefined) {
                console.log("\n-> Extrahierter Raw-Wert (con):", cin.con);
            } else {
                console.log("\n-> Kein 'con' Wert im Antwort-Payload gefunden.");
            }
            
            ws.terminate();
            process.exit(0);
        }
    } catch (e) {
        console.error("Fehler beim Parsen der Antwort:", e.message);
    }
});

ws.on('error', (err) => {
    console.error("WebSocket Fehler:", err.message);
    process.exit(1);
});

// Timeout nach 5 Sekunden
setTimeout(() => {
    console.error("\nTimeout: Keine Antwort von der Wärmepumpe nach 5 Sekunden erhalten.");
    ws.terminate();
    process.exit(1);
}, 5000);
