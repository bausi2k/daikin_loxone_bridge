// crawler.js
const WebSocket = require('ws');
const fs = require('fs');

let config = { daikinIp: "192.168.1.36" };
try {
    if (fs.existsSync('./config.json')) config = JSON.parse(fs.readFileSync('./config.json'));
} catch (e) {}

// Die Ordner, die wir durchwühlen wollen (basierend auf deinem Scan)
const ROOTS = [
    "/[0]/MNAE/1/Sensor",
    "/[0]/MNAE/1/Consumption",
    "/[0]/MNAE/1/Operation",
    "/[0]/MNAE/1/UnitStatus",
    "/[0]/MNAE/2/Operation",
    "/[0]/MNAE/0/UnitInfo"
];

const ws = new WebSocket(`ws://${config.daikinIp}/mca`);

console.log(`Verbinde zu Crawler auf ${config.daikinIp}...`);

ws.on('open', async () => {
    console.log("Verbunden! Starte Analyse der Ordnerstruktur...");

    for (const root of ROOTS) {
        await exploreFolder(root);
    }

    console.log("\n--- CRAWL BEENDET ---");
    process.exit(0);
});

async function exploreFolder(path) {
    console.log(`\n📂 Untersuche Ordner: ${path}`);
    
    // 1. Hole den Inhalt des Ordners (ohne /la am Ende)
    const folderData = await sendRequest(path);
    
    if (!folderData || !folderData['m2m:cnt']) {
        console.log("   -> Kein lesbarer Container (oder leer).");
        return;
    }

    // 2. Suche nach "Children" (Unterordnern/Datenpunkten)
    const children = folderData['m2m:cnt'].ch; // Das ist eine Liste: [ { nm: "IndoorTemp", ... }, ... ]
    
    if (!children || children.length === 0) {
        console.log("   -> Leer.");
        return;
    }

    // 3. Für jedes gefundene Kind: Wert abfragen
    for (const child of children) {
        const name = child.nm; // z.B. "IndoorTemperature"
        const fullPath = `${path}/${name}/la`; // Wir bauen den Pfad zum "Latest" Wert
        
        // Wert abrufen
        const valueData = await sendRequest(fullPath);
        
        if (valueData && valueData['m2m:cin']) {
            const val = valueData['m2m:cin'].con;
            console.log(`   Found: [${name}]`);
            console.log(`     -> WERT: ${val}`);
            console.log(`     -> PFAD: ${fullPath}`);
        } else {
            // Vielleicht ist es ein Unterordner? (z.B. Consumption/Power/...)
            // Wir gehen aber nur 1 Ebene tief, sonst dauert es ewig.
            console.log(`   Found: [${name}] (Scheint ein Unterordner zu sein)`);
            
            // Optional: Einmal tiefer graben für Consumption
            if (path.includes("Consumption")) {
                await exploreFolder(`${path}/${name}`);
            }
        }
    }
}

function sendRequest(path) {
    return new Promise((resolve) => {
        const rqi = "crawl_" + Math.random().toString(36).substring(7);
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
                    // Wir geben den Inhalt (pc) zurück
                    resolve(json['m2m:rsp'].pc); 
                }
            } catch (e) {}
        };

        ws.on('message', listener);
        ws.send(JSON.stringify(payload));
        
        // Timeout
        setTimeout(() => {
            ws.off('message', listener);
            resolve(null);
        }, 500);
    });
}