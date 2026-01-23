// deep_scanner.js
const WebSocket = require('ws');
const fs = require('fs');

let config = { daikinIp: "192.168.1.36" };
try {
    if (fs.existsSync('./config.json')) config = JSON.parse(fs.readFileSync('./config.json'));
} catch (e) {}

// Eine Liste aller möglichen Pfade, die bei Daikin Altherma jemals gesichtet wurden
const POTENTIAL_PATHS = [
    // --- SENSOREN (WICHTIG!) ---
    "/[0]/MNAE/1/Sensor/FlowRateSensor/la",           // Durchfluss (l/min)
    "/[0]/MNAE/1/Sensor/ReturnWaterTemperature/la",   // Rücklauf-Temp
    "/[0]/MNAE/1/Sensor/WaterPressureSensor/la",      // Wasserdruck
    "/[0]/MNAE/1/Sensor/IndoorAmbientTemperature/la", // Raumtemp am Gerät
    "/[0]/MNAE/1/Sensor/OutdoorTemperature/la",       // (Kennen wir schon)
    "/[0]/MNAE/1/Sensor/LeavingWaterTemperatureCurrent/la", // (Kennen wir schon)

    // --- VERBRAUCH (ELEKTRISCH - kWh) ---
    // D = Day, W = Week, M = Month
    "/[0]/MNAE/1/Consumption/Power/Electrical/Heating/D/la",
    "/[0]/MNAE/1/Consumption/Power/Electrical/Cooling/D/la",
    "/[0]/MNAE/1/Consumption/Power/Electrical/DomesticHotWater/D/la",
    
    // Aktueller Momentanverbrauch (selten verfügbar, aber einen Versuch wert)
    "/[0]/MNAE/1/Consumption/Power/Electrical/Heating/la",

    // --- ERZEUGTE ENERGIE (THERMISCH - kWh) -> Für COP Berechnung! ---
    "/[0]/MNAE/1/Consumption/Energy/Thermal/Heating/D/la",
    "/[0]/MNAE/1/Consumption/Energy/Thermal/Cooling/D/la",
    "/[0]/MNAE/1/Consumption/Energy/Thermal/DomesticHotWater/D/la",

    // --- UNIT INFO ---
    "/[0]/MNAE/0/UnitInfo/ModelNumber/la",
    "/[0]/MNAE/0/UnitInfo/SerialNumber/la",
    "/[0]/MNAE/0/UnitInfo/Version/la",

    // --- BETRIEBSSTUNDEN (Manchmal verfügbar) ---
    "/[0]/MNAE/1/Operation/CompressorRunTime/la",
    "/[0]/MNAE/1/Operation/PumpRunTime/la",

    // --- SOLLWERTE ---
    "/[0]/MNAE/1/Operation/TargetTemperature/la",
    "/[0]/MNAE/2/Operation/TargetTemperature/la"
];

const ws = new WebSocket(`ws://${config.daikinIp}/mca`);

console.log(`Verbinde zu ${config.daikinIp} und teste ${POTENTIAL_PATHS.length} mögliche Pfade...`);

ws.on('open', async () => {
    console.log("Verbunden! Scan läuft (das dauert kurz)...");
    console.log("---------------------------------------------------");

    for (const path of POTENTIAL_PATHS) {
        await checkPath(path);
    }

    console.log("---------------------------------------------------");
    console.log("Scan beendet.");
    process.exit(0);
});

function checkPath(path) {
    return new Promise((resolve) => {
        const rqi = "scan_" + Math.random().toString(36).substring(7);
        const payload = {
            "m2m:rqp": {
                "op": 2, // Retrieve
                "to": path,
                "fr": "/S",
                "rqi": rqi
            }
        };

        const listener = (data) => {
            try {
                const json = JSON.parse(data);
                if (json['m2m:rsp'] && json['m2m:rsp'].rqi === rqi) {
                    ws.off('message', listener);
                    
                    const rsc = json['m2m:rsp'].rsc;
                    
                    if (rsc === 2000) { // 2000 = OK (Gefunden!)
                        const val = json['m2m:rsp'].pc?.['m2m:cin']?.con;
                        console.log(`✅ TREFFER: ${path}`);
                        console.log(`   Wert: ${val}`);
                    } else {
                        // console.log(`❌ Nicht gefunden: ${path} (Code: ${rsc})`);
                    }
                    resolve();
                }
            } catch (e) {}
        };

        ws.on('message', listener);
        ws.send(JSON.stringify(payload));
        
        // Timeout
        setTimeout(() => {
            ws.off('message', listener);
            resolve(); // Einfach weitermachen
        }, 200); // Schnell feuern
    });
}