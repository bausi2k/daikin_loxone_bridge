// scanner.js
const WebSocket = require('ws');
const fs = require('fs');

// Config laden
let config = { daikinIp: "192.168.1.36" };
try {
    if (fs.existsSync('./config.json')) {
        config = JSON.parse(fs.readFileSync('./config.json'));
    }
} catch (e) {}

console.log(`Starte Scanner auf ${config.daikinIp}...`);

// --- LISTE DER BEKANNTEN MÖGLICHEN PFADE ---
// Diese Pfade existieren bei vielen Daikin Altherma Modellen
const CANDIDATES = [
    // Sensoren (Wasser & Durchfluss sind sehr interessant!)
    "/[0]/MNAE/1/Sensor/FlowRateSensor/la",
    "/[0]/MNAE/1/Sensor/WaterPressureSensor/la",
    "/[0]/MNAE/1/Sensor/ReturnWaterTemperature/la",
    "/[0]/MNAE/1/Sensor/IndoorAmbientTemperature/la",
    
    // Energieverbrauch (Oft vorhanden!)
    "/[0]/MNAE/1/Consumption/Power/Electrical/Heating/la",
    "/[0]/MNAE/1/Consumption/Power/Electrical/Cooling/la",
    "/[0]/MNAE/1/Consumption/Power/Electrical/DomesticHotWater/la",
    "/[0]/MNAE/1/Consumption/Energy/Thermal/Heating/la",
    "/[0]/MNAE/1/Consumption/Energy/Thermal/DomesticHotWater/la",

    // Gateway Info
    "/[0]/MNAE/0/UnitInfo/ModelNumber/la",
    "/[0]/MNAE/0/UnitInfo/SerialNumber/la",
    "/[0]/MNAE/0/UnitInfo/Version/la",

    // Unit 2 (Warmwasser) Details
    "/[0]/MNAE/2/Operation/TargetTemperature/la",
    "/[0]/MNAE/2/UnitStatus/ErrorState/la",
];

// Ordner, die wir versuchen aufzulisten (Discovery)
const DISCOVERY_ROOTS = [
    "/[0]/MNAE/1/Sensor",
    "/[0]/MNAE/1/Consumption",
    "/[0]/MNAE/1/Operation",
    "/[0]/MNAE/2/Operation"
];

const ws = new WebSocket(`ws://${config.daikinIp}/mca`);

ws.on('open', async () => {
    console.log("Verbunden! Starte Scan...");
    
    // 1. Discovery Versuch (Ordner auflisten)
    console.log("\n--- PHASE 1: DISCOVERY (Ordner durchsuchen) ---");
    for (const path of DISCOVERY_ROOTS) {
        await checkPath(path, true);
    }

    // 2. Brute Force Versuch (Bekannte Pfade testen)
    console.log("\n--- PHASE 2: DEEP SCAN (Bekannte Pfade testen) ---");
    for (const path of CANDIDATES) {
        await checkPath(path, false);
    }

    console.log("\n--- SCAN BEENDET ---");
    process.exit(0);
});

function checkPath(path, isDiscovery) {
    return new Promise((resolve) => {
        // Request ID generieren
        const rqi = "scan_" + Math.random().toString(36).substring(7);
        
        // Payload: Wir fragen nach den Kindern (rcn=1) bei Discovery
        // oder einfach nach dem Wert (Standard)
        const payload = {
            "m2m:rqp": {
                "op": 2,
                "to": path,
                "fr": "/S",
                "rqi": rqi
            }
        };

        // Handler für die Antwort
        const listener = (data) => {
            try {
                const json = JSON.parse(data);
                const rsp = json['m2m:rsp'];
                
                if (rsp && rsp.rqi === rqi) {
                    ws.off('message', listener); // Listener entfernen
                    
                    if (rsp.rsc === 2000) { // 2000 = OK
                        console.log(`[GEFUNDEN] ${path}`);
                        
                        // Wenn wir Inhalt haben, zeigen wir ihn kurz
                        if (rsp.pc && rsp.pc['m2m:cin']) {
                            console.log(`   -> Wert: ${rsp.pc['m2m:cin'].con}`);
                        }
                        // Wenn wir Kinder haben (bei Discovery)
                        if (rsp.pc && rsp.pc['m2m:cnt'] && rsp.pc['m2m:cnt'].ch) {
                            console.log(`   -> Enthält: ${JSON.stringify(rsp.pc['m2m:cnt'].ch)}`);
                        }
                    } else {
                        // console.log(`[---] ${path} (Code: ${rsp.rsc})`);
                    }
                    resolve();
                }
            } catch (e) {}
        };

        ws.on('message', listener);
        ws.send(JSON.stringify(payload));
        
        // Timeout, falls keine Antwort kommt
        setTimeout(() => {
            ws.off('message', listener);
            resolve();
        }, 300); // 300ms warten pro Pfad
    });
}