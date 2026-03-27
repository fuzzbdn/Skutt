let savedGraphs = JSON.parse(localStorage.getItem('mto_graphs')) || [];
let activeGraphId = null;
let stations = [];

let currentTrains = [];
let activeTrainIndex = null;

const token = localStorage.getItem('skutt_token');
if (!token) {
    alert("Du är inte inloggad. Omdirigerar...");
    window.location.href = 'index.html';
}

const activeGraphSelect = document.getElementById('activeGraphSelect');
const trainList = document.getElementById('trainList');
const emptyState = document.getElementById('emptyState');
const trainEditor = document.getElementById('trainEditor');
const trainIdInput = document.getElementById('trainIdInput');
const trainStartDateInput = document.getElementById('trainStartDateInput');
const timetableBody = document.getElementById('timetableBody');

async function init() {
    if (savedGraphs.length === 0) {
        alert("Inga grafer finns. Skapa en graf först i inställningarna.");
        window.location.href = 'admin.html';
        return;
    }
    
    savedGraphs.forEach(g => activeGraphSelect.appendChild(new Option(g.name, g.id)));
    activeGraphSelect.addEventListener('change', (e) => loadGraph(e.target.value));
    
    await loadGraph(savedGraphs[0].id);
}

async function loadGraph(graphId) {
    activeGraphId = graphId;
    const graph = savedGraphs.find(g => g.id === graphId);
    stations = graph.stations ? graph.stations.sort((a,b) => a.km - b.km) : [];
    
    const cleanSign = (sign) => sign ? sign.toString().trim().toLowerCase() : "";
    
    try {
        const res = await fetch(`/api/trains?graphId=${activeGraphId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.status === 401) {
            localStorage.clear();
            window.location.href = 'index.html';
            return;
        }

        if (res.ok) {
            const allGlobalTrains = await res.json();
            
            currentTrains = allGlobalTrains.filter(train => {
                const matchingStops = train.timetable.filter(stop => 
                    stations.some(s => cleanSign(s.sign) === cleanSign(stop.stationSign))
                );
                return matchingStops.length >= 2;
            });
        } else {
            currentTrains = [];
        }
    } catch(e) {
        currentTrains = [];
    }
    
    activeTrainIndex = null;
    renderTrainList();
    trainEditor.style.display = 'none';
    emptyState.style.display = 'flex';
}

// Liten sax för att rensa bort T00:00:00.000Z från databas-datum
function getCleanDate(dateStr) {
    if (!dateStr) return "Inget datum angivet";
    return String(dateStr).split('T')[0];
}

function renderTrainList() {
    trainList.innerHTML = '';
    const groupedTrains = {};
    
    currentTrains.forEach((train, idx) => {
        // Använd saxen här så rubrikerna blir snygga (endast ÅÅÅÅ-MM-DD)
        const date = getCleanDate(train.startDate);
        if (!groupedTrains[date]) groupedTrains[date] = [];
        groupedTrains[date].push({ train, idx });
    });

    const sortedDates = Object.keys(groupedTrains).sort((a, b) => {
        if (a === "Inget datum angivet") return 1;
        if (b === "Inget datum angivet") return -1;
        return a.localeCompare(b);
    });

    sortedDates.forEach(date => {
        const header = document.createElement('div');
        header.style.cssText = 'color: #909296; font-size: 0.75em; text-transform: uppercase; letter-spacing: 1px; margin: 15px 0 5px 0; padding-bottom: 4px; border-bottom: 1px solid #373a40; font-weight: bold;';
        header.textContent = date;
        trainList.appendChild(header);

        groupedTrains[date].forEach(item => {
            const btn = document.createElement('button');
            btn.className = `graph-item ${item.idx === activeTrainIndex ? 'active' : ''}`;
            btn.textContent = `Tåg ${item.train.id}`;
            btn.onclick = () => selectTrain(item.idx);
            trainList.appendChild(btn);
        });
    });
}

function selectTrain(idx) {
    activeTrainIndex = idx;
    const train = currentTrains[idx];
    
    emptyState.style.display = 'none';
    trainEditor.style.display = 'flex';
    trainIdInput.value = train.id;
    
    // Använd saxen här så webbläsaren godkänner formatet i kalendern
    trainStartDateInput.value = train.startDate ? getCleanDate(train.startDate) : "";
    
    renderTimetable(train.timetable, getCleanDate(train.startDate));
    renderTrainList();
}

function renderTimetable(timetable, startDate) {
    timetableBody.innerHTML = '';
    
    const formatForInput = (val, baseDate) => {
        if (val === null || val === undefined || val === '') return '';
        let strVal = String(val);
        const safeDate = baseDate || new Date().toISOString().split('T')[0];

        if (strVal.includes('T')) return strVal.substring(0, 16);
        
        if (strVal.includes(':')) {
            let parts = strVal.split(':');
            return `${safeDate}T${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
        }
        
        if (!isNaN(strVal)) {
            let num = parseInt(strVal, 10);
            let days = Math.floor(num / 1440); 
            let remainingMins = num % 1440;
            if (remainingMins < 0) remainingMins += 1440; 
            let h = Math.floor(remainingMins / 60);
            let m = remainingMins % 60;
            let d =
