// crawler.js
const WebSocket = require('ws');
const fs = require('fs');

let config = { daikinIp: "192.168.1.36" };
try {
    if (fs.existsSync('./config.json')) config = JSON.parse(fs.readFileSync('./config.json'));
} catch (e) {}

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
    
    // NEU: rcn=5 teilt Daikin mit, dass wir die "Children" (Unterordner) sehen wollen!
    const folderData = await sendRequest(path, 5);
    
    if (!folderData || !folderData['m2m:cnt']) {
        console.log("   -> Kein lesbarer Container (oder leer).");
        return;
    }

    const children = folderData['m2m:cnt'].ch; 
    
    if (!children || children.length === 0) {
        console.log("   -> Leer.");
        return;
    }

    for (const child of children) {
        const name = child.nm; 
        const fullPath = `${path}/${name}/la`; 
        
        // Hier holen wir den konkreten Wert (ohne rcn)
        const valueData = await sendRequest(fullPath);
        
        if (valueData && valueData['m2m:cin']) {
            const val = valueData['m2m:cin'].con;
            console.log(`   Found: [${name}]`);
            console.log(`     -> WERT: ${val}`);
            console.log(`     -> PFAD: ${fullPath}`);
        } else {
            console.log(`   Found: [${name}] (Scheint ein Unterordner zu sein)`);
            // Gehe eine Ebene tiefer bei Bedarf
            if (path.includes("Consumption") || path.includes("Operation")) {
                await exploreFolder(`${path}/${name}`);
            }
        }
    }
}

function sendRequest(path, rcn = undefined) {
    return new Promise((resolve) => {
        const rqi = "crawl_" + Math.random().toString(36).substring(7);
        const payload = {
            "m2m:rqp": {
                "op": 2, 
                "to": path,
                "fr": "/S",
                "rqi": rqi
            }
        };

        // RCN anhängen, falls definiert
        if (rcn !== undefined) {
            payload["m2m:rqp"].rcn = rcn;
        }

        const listener = (data) => {
            try {
                const json = JSON.parse(data);
                if (json['m2m:rsp'] && json['m2m:rsp'].rqi === rqi) {
                    ws.off('message', listener);
                    resolve(json['m2m:rsp'].pc); 
                }
            } catch (e) {}
        };

        ws.on('message', listener);
        ws.send(JSON.stringify(payload));
        
        setTimeout(() => {
            ws.off('message', listener);
            resolve(null);
        }, 500);
    });
}