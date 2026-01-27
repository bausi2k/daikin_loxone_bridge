// public/script.js
let currentState = {};
const logContainer = document.getElementById('log-container');
let chartVLT = null, chartTank = null, chartIndoor = null, chartOutdoor = null;
let currentFilter = 'all';

// Init: Setze Datepicker auf heute
document.getElementById('logDate').valueAsDate = new Date();

function switchTab(name) {
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    document.getElementById('view-' + name).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.b-nav-item').forEach(el => el.classList.remove('active'));
    const idx = name === 'dashboard' ? 0 : name === 'charts' ? 1 : name === 'logs' ? 2 : 3;
    document.querySelectorAll('.nav-btn')[idx].classList.add('active');
    document.querySelectorAll('.b-nav-item')[idx].classList.add('active');
    
    if(name === 'charts') loadHistory();
    if(name === 'logs') fetchLogs(); // Logs initial laden
}

function connectWS() {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${window.location.host}`);
    ws.onopen = () => { document.getElementById('connDot').classList.add('connected'); document.getElementById('connDotMobile').classList.add('connected'); };
    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            
            if (msg.type === 'state') updateDashboard(msg.data);
            if (msg.type === 'log') addLog(msg.data); 
            
            if (msg.type === 'mqtt_status') {
                // ROBUSTHEITS-FIX: Prüfe beide Formate
                const isConnected = (msg.data && msg.data.connected !== undefined) 
                                    ? msg.data.connected 
                                    : msg.connected;
                updateMqttStatus(isConnected);
            }
        } catch (e) {
            console.warn("Fehler beim Verarbeiten der WebSocket-Nachricht:", e);
        }
    };
    ws.onclose = () => { document.getElementById('connDot').classList.remove('connected'); document.getElementById('connDotMobile').classList.remove('connected'); setTimeout(connectWS, 3000); };
}
connectWS();

function updateMqttStatus(connected) {
    const dots = document.querySelectorAll('.mqtt-dot');
    dots.forEach(d => connected ? d.classList.add('ok') : d.classList.remove('ok'));
}

function updateDashboard(data) {
    currentState = data;
    setText('val-vlt', Math.round(data.VLT));
    setText('val-indoor', data.IndoorTemp);
    setText('val-outdoor', data.OutdoorTemp);
    setText('val-tank', Math.round(data.TankTemp));
    setText('val-ww-target', data.TargetTemp_WW || data.TargetTemp_WW_Alt || "--");
    let vltTarget = "--";
    if(data.Mode === 'heating') vltTarget = data.TargetVLT_Heat;
    else if(data.Mode === 'cooling') vltTarget = data.TargetVLT_Cool;
    setText('val-vlt-target', vltTarget);
    
    const tileVlt = document.getElementById('tile-vlt');
    tileVlt.className = 'tile';
    if(data.Power_Heating === 'on') {
        if(data.Mode === 'heating') tileVlt.classList.add('active-heat');
        else if(data.Mode === 'cooling') tileVlt.classList.add('active-cool');
    }
    const tileTank = document.getElementById('tile-tank');
    tileTank.className = 'tile';
    if(data.Power_WW === 'on') tileTank.classList.add('active-heat');

    let offsetVal = data.Offset_Heat || 0;
    if(data.Mode === 'cooling') offsetVal = data.Offset_Cool || 0;
    setText('val-offset', offsetVal);

    setBtnState('btn-heat-off', data.Power_Heating !== 'on', 'active-on');
    setBtnState('btn-mode-heat', data.Mode === 'heating' && data.Power_Heating === 'on', 'active-heat');
    setBtnState('btn-mode-cool', data.Mode === 'cooling' && data.Power_Heating === 'on', 'active-cool');
    setBtnState('btn-mode-auto', data.Mode === 'auto' && data.Power_Heating === 'on', 'active-on');

    const badge = document.getElementById('badge-mode');
    if (data.Power_Heating !== 'on') { badge.innerText = "STANDBY"; }
    else { badge.innerText = (data.Mode || "UNKNOWN").toUpperCase(); }

    setBtnState('btn-ww-on', data.Power_WW === 'on', 'active-on');
    setBtnState('btn-ww-off', data.Power_WW !== 'on', 'active-on');
    setBtnState('btn-turbo', parseInt(data.Powerful_WW || 0) === 1, 'active-turbo');

    // Status Logik (Abweichung Ist vs. Soll)
    const elStatus = document.getElementById('val-status');
    if (data.Power_Heating === 'on' && vltTarget !== '--') {
        const target = parseFloat(vltTarget);
        const current = parseFloat(data.VLT);
        const diff = current - target;
        
        if (Math.abs(diff) <= 2.0) {
            elStatus.innerText = "✅ Sollwert erreicht";
            elStatus.style.color = "var(--success)";
        } else if (diff < -2.0) {
            elStatus.innerText = `📉 Aufheizen (${Math.round(diff)}K)`;
            elStatus.style.color = "var(--heat)";
        } else if (diff > 2.0) {
            elStatus.innerText = `📈 Abkühlen (+${Math.round(diff)}K)`;
            elStatus.style.color = "var(--cool)";
        }
    } else {
        elStatus.innerText = "💤 Standby";
        elStatus.style.color = "var(--text-dim)";
    }

    const err = parseInt(data.Error || 0);
    document.getElementById('errorBanner').style.display = err !== 0 ? 'block' : 'none';
    if(err !== 0) document.getElementById('errorBanner').innerText = "⚠️ STÖRUNG: CODE " + err;
}

function setText(id, val) { const el = document.getElementById(id); if(el) el.innerText = val !== undefined ? val : '--'; }
function setBtnState(id, isActive, activeClass) { const el = document.getElementById(id); if(isActive) el.classList.add(activeClass); else el.classList.remove(activeClass); }

async function fetchLogs() {
    const date = document.getElementById('logDate').value;
    const res = await fetch(`/api/logs?date=${date}`);
    const logs = await res.json();
    
    logContainer.innerHTML = ''; 
    logs.forEach(l => {
        addLog({ timestamp: l.timestamp, msg: l.message, type: l.level }, false);
    });
}

function addLog(log, isLive = true) {
    const selectedDate = document.getElementById('logDate').value;
    const today = new Date().toISOString().split('T')[0];
    if (isLive && selectedDate !== today) return;

    const div = document.createElement('div');
    const catClass = `log-cat-${log.type}`;
    div.className = `log-entry ${catClass}`;
    div.setAttribute('data-type', log.type);
    
    if (currentFilter !== 'all' && currentFilter !== log.type) div.style.display = 'none';

    const timeStr = new Date(log.timestamp).toLocaleTimeString('de-AT');
    div.innerHTML = `<span class="log-time">${timeStr}</span><span class="log-msg">${log.msg}</span>`;
    
    if (isLive) {
        logContainer.prepend(div);
        if (logContainer.childElementCount > 100) logContainer.lastChild.remove();
    } else {
        logContainer.appendChild(div);
    }
}

function filterLogs(type, btn) {
    currentFilter = type;
    document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const entries = logContainer.children;
    for (let i = 0; i < entries.length; i++) {
        const entryType = entries[i].getAttribute('data-type');
        if (type === 'all' || entryType === type) entries[i].style.display = 'flex';
        else entries[i].style.display = 'none';
    }
}

async function sendCmd(cmd, val) {
    if(cmd === 'offset_heat') {
        let current = parseFloat(currentState.Offset_Heat || 0);
        if(currentState.Mode === 'cooling') current = parseFloat(currentState.Offset_Cool || 0);
        val = current + val;
    }
    await fetch(`/set?cmd=${cmd}&val=${val}`);
}

async function setMode(mode) {
    try {
        await fetch(`/set?cmd=mode&val=${mode}`);
        await fetch(`/set?cmd=power&val=on`);
    } catch(e) { console.error(e); }
}

function changeOffset(delta) { sendCmd('offset_heat', delta); }
function toggleTurbo() { const isTurbo = parseInt(currentState.Powerful_WW || 0); sendCmd('ww_powerful', isTurbo === 1 ? 0 : 1); }
async function manualRefresh() {
    const icons = document.querySelectorAll('.refresh-icon');
    icons.forEach(i => i.classList.add('spin'));
    try { await fetch('/refresh', { method: 'POST' }); setTimeout(() => icons.forEach(i => i.classList.remove('spin')), 1000); } catch (e) { icons.forEach(i => i.classList.remove('spin')); }
}

async function loadHistory() {
    const mode = document.getElementById('chartFilter').value;
    const res = await fetch(`/api/history?mode=${mode}`);
    const data = await res.json();
    if (data.current && data.previous) renderComparison(data.current, data.previous, mode);
    else renderStandard(data);
}

function renderStandard(data) {
    const labels = data.map(d => new Date(d.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}));
    const backgroundData = data.map(d => d.ww_active === 1 ? 1 : null);
    
    // NEU: Hintergrund für Heiz-Status
    const heatingBackgroundData = data.map(d => d.heating_active === 1 ? 1 : null);

    // NEU: vltChart mit Hintergrund
    updateChart('vltChart', chartVLT, labels, [
        { 
            label: 'Heizung Aktiv', 
            data: heatingBackgroundData, 
            borderColor: 'transparent', 
            backgroundColor: 'rgba(255, 183, 77, 0.2)', // Orange-Transparent
            fill: true, 
            radius: 0, 
            stepped: true, 
            yAxisID: 'y_status' 
        },
        { label: 'Vorlauf Ist', data: data.map(d => d.vlt), borderColor: '#ffb74d', tension: 0.5, yAxisID: 'y' },
        { label: 'Soll', data: data.map(d => d.target), borderColor: '#ffcc80', borderDash: [5,5], tension: 0, yAxisID: 'y' }
    ], (c) => chartVLT = c, true); // <--- Dual Axis Mode

    updateChart('tankChart', chartTank, labels, [
        { label: 'WW Aktiv', data: backgroundData, borderColor: 'transparent', backgroundColor: 'rgba(109, 213, 140, 0.2)', fill: true, radius: 0, stepped: true, yAxisID: 'y_status' },
        { label: 'Warmwasser', data: data.map(d => d.tank), borderColor: '#6dd58c', backgroundColor: '#6dd58c', tension: 0.5, yAxisID: 'y' }
    ], (c) => chartTank = c, true);

    updateChart('indoorChart', chartIndoor, labels, [{ label: 'Innen', data: data.map(d => d.indoor), borderColor: '#a8c7fa', tension: 0.5 }], (c) => chartIndoor = c);
    updateChart('outdoorChart', chartOutdoor, labels, [{ label: 'Außen', data: data.map(d => d.outdoor), borderColor: '#78d9f5', tension: 0.5 }], (c) => chartOutdoor = c);
}

function renderComparison(current, previous, mode) {
    const labels = current.map(d => new Date(d.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}));
    const prevLabel = mode.includes('day') ? 'Gestern' : 'Letzter Monat';
    const currLabel = mode.includes('day') ? 'Heute' : 'Dieser Monat';
    updateChart('vltChart', chartVLT, labels, [
        { label: currLabel, data: current.map(d => d.vlt), borderColor: '#ffb74d', tension: 0.5 },
        { label: prevLabel, data: previous.map(d => d.vlt), borderColor: '#666', borderDash: [5,5], tension: 0.5 }
    ], (c) => chartVLT = c);
    updateChart('tankChart', chartTank, labels, [
        { label: currLabel, data: current.map(d => d.tank), borderColor: '#6dd58c', tension: 0.5 },
        { label: prevLabel, data: previous.map(d => d.tank), borderColor: '#666', borderDash: [5,5], tension: 0.5 }
    ], (c) => chartTank = c);
    updateChart('indoorChart', chartIndoor, labels, [
        { label: currLabel, data: current.map(d => d.indoor), borderColor: '#a8c7fa', tension: 0.5 },
        { label: prevLabel, data: previous.map(d => d.indoor), borderColor: '#666', borderDash: [5,5], tension: 0.5 }
    ], (c) => chartIndoor = c);
    updateChart('outdoorChart', chartOutdoor, labels, [
        { label: currLabel, data: current.map(d => d.outdoor), borderColor: '#78d9f5', tension: 0.5 },
        { label: prevLabel, data: previous.map(d => d.outdoor), borderColor: '#666', borderDash: [5,5], tension: 0.5 }
    ], (c) => chartOutdoor = c);
}

function updateChart(id, chartInstance, labels, datasets, setInstanceCallback, useDualAxis = false) {
    const ctx = document.getElementById(id).getContext('2d');
    if(chartInstance) chartInstance.destroy();

    let scalesConfig = {
        x: { ticks: { color: '#8e918f' }, grid: { color: '#2d2f38' } },
        y: { ticks: { color: '#8e918f' }, grid: { color: '#2d2f38' } }
    };

    if (useDualAxis) {
        scalesConfig.y_status = { type: 'linear', display: false, position: 'right', min: 0, max: 1 };
    }

    const newChart = new Chart(ctx, {
        type: 'line',
        data: { labels: labels, datasets: datasets },
        options: { 
            responsive: true, maintainAspectRatio: false, 
            interaction: { mode: 'index', intersect: false },
            scales: scalesConfig, 
            plugins: { 
                legend: { 
                    labels: { 
                        color: '#e2e2e6',
                        filter: function(item) { return item.text !== 'WW Aktiv' && item.text !== 'Heizung Aktiv'; }
                    } 
                } 
            },
            elements: { point: { radius: 0, hitRadius: 10 } }
        }
    });
    setInstanceCallback(newChart);
}

async function loadConfig() {
    try {
        const res = await fetch('/api/config');
        const cfg = await res.json();
        
        // --- NEU: Version in alle Platzhalter schreiben mit 'v' ---
        if (cfg.appVersion) {
            document.querySelectorAll('.version-tag').forEach(el => {
                el.innerText = 'v' + cfg.appVersion;
            });
        }
        
        document.getElementById('cfg-daikin').value = cfg.daikinIp || "";
        document.getElementById('cfg-loxone').value = cfg.loxoneIp || "";
        document.getElementById('cfg-port').value = cfg.loxonePort || 7000;
        document.getElementById('cfg-keepAlive').value = cfg.udpKeepAlive || 90;
        document.getElementById('cfg-mqttBroker').value = cfg.mqttBroker || "";
        document.getElementById('cfg-mqttTopic').value = cfg.mqttTopic || "daikin";
        document.getElementById('cfg-mqttUser').value = cfg.mqttUser || "";
        document.getElementById('cfg-mqttPass').value = cfg.mqttPass || "";
    } catch(e) {}
}

async function saveConfig() {
    const newCfg = {
        daikinIp: document.getElementById('cfg-daikin').value,
        loxoneIp: document.getElementById('cfg-loxone').value,
        loxonePort: parseInt(document.getElementById('cfg-port').value),
        udpKeepAlive: parseInt(document.getElementById('cfg-keepAlive').value),
        mqttBroker: document.getElementById('cfg-mqttBroker').value,
        mqttTopic: document.getElementById('cfg-mqttTopic').value,
        mqttUser: document.getElementById('cfg-mqttUser').value,
        mqttPass: document.getElementById('cfg-mqttPass').value
    };
    await fetch('/api/config', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(newCfg) });
    alert("Gespeichert. Server startet neu.");
}
loadConfig();