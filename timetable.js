let savedGraphs = JSON.parse(localStorage.getItem('mto_graphs')) || [];
let activeGraphId = null;
let stations = [];

let allTrains = JSON.parse(localStorage.getItem('mto_xml_trains')) || {};
let currentTrains = [];
let activeTrainIndex = null;

const activeGraphSelect = document.getElementById('activeGraphSelect');
const trainList = document.getElementById('trainList');
const emptyState = document.getElementById('emptyState');
const trainEditor = document.getElementById('trainEditor');
const trainIdInput = document.getElementById('trainIdInput');
const trainStartDateInput = document.getElementById('trainStartDateInput');
const timetableBody = document.getElementById('timetableBody');

function init() {
    if (savedGraphs.length === 0) {
        alert("Inga grafer finns. Skapa en graf först i inställningarna.");
        window.location.href = 'admin.html';
        return;
    }
    
    savedGraphs.forEach(g => activeGraphSelect.appendChild(new Option(g.name, g.id)));
    activeGraphSelect.addEventListener('change', (e) => loadGraph(e.target.value));
    
    loadGraph(savedGraphs[0].id);
}

function loadGraph(graphId) {
    activeGraphId = graphId;
    const graph = savedGraphs.find(g => g.id === graphId);
    stations = graph.stations ? graph.stations.sort((a,b) => a.km - b.km) : [];
    
    if (!allTrains[graphId]) allTrains[graphId] = [];
    currentTrains = allTrains[graphId];
    
    activeTrainIndex = null;
    renderTrainList();
    trainEditor.style.display = 'none';
    emptyState.style.display = 'flex';
}

function renderTrainList() {
    trainList.innerHTML = '';

    // 1. Gruppera tågen baserat på deras startdatum
    const groupedTrains = {};
    currentTrains.forEach((train, idx) => {
        const date = train.startDate || "Inget datum angivet";
        if (!groupedTrains[date]) groupedTrains[date] = [];
        groupedTrains[date].push({ train, idx });
    });

    // 2. Sortera datumen i ordning
    const sortedDates = Object.keys(groupedTrains).sort((a, b) => {
        if (a === "Inget datum angivet") return 1;
        if (b === "Inget datum angivet") return -1;
        return a.localeCompare(b);
    });

    // 3. Bygg upp listan med rubriker
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
    trainStartDateInput.value = train.startDate || "";
    
    renderTimetable(train.timetable);
    renderTrainList();
}

function renderTimetable(timetable) {
    timetableBody.innerHTML = '';
    timetable.forEach((stop) => {
        timetableBody.appendChild(createRow(stop.stationSign, stop.arrival, stop.departure));
    });
}

// Skapar den ultra-kompakta, rena rutnäts-designen
function createRow(stationSign = '', arr = '', dep = '') {
    const tr = document.createElement('tr');
    tr.style.borderBottom = "1px solid #2a2b30";

    const inputStyle = "width:100%; padding:6px; background:transparent; color:#ececec; border:1px solid transparent; font-size:1em; text-align:center; border-radius:3px; outline:none; transition: all 0.2s;";
    const focusLogic = "this.style.backgroundColor='#25262b'; this.style.borderColor='#33ccff'";
    const blurLogic = "this.style.backgroundColor='transparent'; this.style.borderColor='transparent'";

    let sel = `<select class="st-sel" style="width:100%; padding:6px; background:transparent; color:#ececec; border:1px solid transparent; font-size:1em; font-weight:bold; cursor:pointer; outline:none;" onfocus="${focusLogic}" onblur="${blurLogic}">`;
    let found = false;
    
    stations.forEach(st => {
        const isSelected = st.sign === stationSign;
        if(isSelected) found = true;
        sel += `<option value="${st.sign}" ${isSelected ? 'selected' : ''} style="background:#25262b;">${st.name} (${st.sign})</option>`;
    });

    if (stationSign && !found) {
        sel += `<option value="${stationSign}" selected style="background:#25262b; color:#ff6b6b;">⚠ Okänd: ${stationSign}</option>`;
    }

    sel += `</select>`;
    
    tr.innerHTML = `
        <td style="padding: 2px;">${sel}</td>
        <td style="padding: 2px;"><input type="time" class="arr-in" value="${arr}" style="${inputStyle}" onfocus="${focusLogic}" onblur="${blurLogic}"></td>
        <td style="padding: 2px;"><input type="time" class="dep-in" value="${dep}" style="${inputStyle}" onfocus="${focusLogic}" onblur="${blurLogic}"></td>
        <td style="padding: 2px; text-align: center;"><button class="del-btn" title="Ta bort rad" style="background:transparent; border:none; color:#ff6b6b; font-size:1.5em; cursor:pointer; padding:0; height:30px;">×</button></td>
    `;
    
    tr.querySelector('.del-btn').onclick = () => tr.remove();
    return tr;
}

document.getElementById('createNewTrainBtn').addEventListener('click', () => {
    const today = new Date();
    const dateStr = today.getFullYear() + "-" + String(today.getMonth()+1).padStart(2,'0') + "-" + String(today.getDate()).padStart(2,'0');
    
    const newTrain = {
        id: "Nytt",
        startDate: dateStr,
        timetable: [
            { stationSign: stations[0]?.sign || '', arrival: '12:00', departure: '12:00' },
            { stationSign: stations[stations.length-1]?.sign || '', arrival: '13:00', departure: '13:00' }
        ]
    };
    currentTrains.push(newTrain);
    saveData();
    selectTrain(currentTrains.length - 1);
});

document.getElementById('addTimetableRowBtn').addEventListener('click', () => {
    timetableBody.appendChild(createRow());
    // Scrolla ner automatiskt till den nya raden
    const container = document.querySelector('.table-container');
    container.scrollTop = container.scrollHeight;
});

document.getElementById('saveTrainBtn').addEventListener('click', () => {
    if (activeTrainIndex === null) return;
    
    const train = currentTrains[activeTrainIndex];
    train.id = trainIdInput.value;
    train.startDate = trainStartDateInput.value;
    
    const rows = timetableBody.querySelectorAll('tr');
    const newTimetable = [];
    rows.forEach(row => {
        newTimetable.push({
            stationSign: row.querySelector('.st-sel').value,
            arrival: row.querySelector('.arr-in').value,
            departure: row.querySelector('.dep-in').value
        });
    });
    train.timetable = newTimetable;
    
    saveData();
    renderTrainList(); // Sorterar om ifall datumet ändrades
    
    const btn = document.getElementById('saveTrainBtn');
    const orig = btn.textContent;
    btn.textContent = "✅ Sparat!";
    setTimeout(() => btn.textContent = orig, 1500);
});

document.getElementById('deleteTrainBtn').addEventListener('click', () => {
    if (activeTrainIndex === null) return;
    if (confirm("Är du säker på att du vill ta bort detta tåg?")) {
        currentTrains.splice(activeTrainIndex, 1);
        activeTrainIndex = null;
        saveData();
        renderTrainList();
        trainEditor.style.display = 'none';
        emptyState.style.display = 'flex';
    }
});

function saveData() {
    allTrains[activeGraphId] = currentTrains;
    localStorage.setItem('mto_xml_trains', JSON.stringify(allTrains));
}

// --- LÄS IN TRAFIKVERKET XML ---
const importExternalXmlBtn = document.getElementById('importExternalXmlBtn');
const externalXmlFileInput = document.getElementById('externalXmlFileInput');

importExternalXmlBtn.addEventListener('click', () => externalXmlFileInput.click());

externalXmlFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        parseTrafikverketXML(event.target.result);
        externalXmlFileInput.value = ''; // Återställ
    };
    reader.readAsText(file);
});

function parseTrafikverketXML(xmlString) {
    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, "text/xml");
        const announcements = xmlDoc.getElementsByTagName("TrainAnnouncement");
        
        let parsedData = {};

        for (let i = 0; i < announcements.length; i++) {
            const node = announcements[i];
            const trainIdNode = node.getElementsByTagName("OperationalTrainNumber")[0];
            const activityNode = node.getElementsByTagName("ActivityType")[0];
            const timeNode = node.getElementsByTagName("AdvertisedTimeAtLocation")[0];
            const locNode = node.getElementsByTagName("LocationSignature")[0];

            if (trainIdNode && activityNode && timeNode && locNode) {
                const trainId = trainIdNode.textContent;
                if (!parsedData[trainId]) parsedData[trainId] = [];
                
                const dateObj = new Date(timeNode.textContent);
                const hhmm = dateObj.getHours().toString().padStart(2, '0') + ':' + 
                             dateObj.getMinutes().toString().padStart(2, '0');
                             
                const dateStr = dateObj.getFullYear() + '-' + 
                                String(dateObj.getMonth()+1).padStart(2,'0') + '-' + 
                                String(dateObj.getDate()).padStart(2,'0');

                parsedData[trainId].push({
                    loc: locNode.textContent,
                    type: activityNode.textContent, 
                    time: hhmm,
                    timestamp: dateObj.getTime(),
                    dateStr: dateStr 
                });
            }
        }

        let isReplace = false;
        let hasAnyTrains = Object.values(allTrains).some(arr => arr.length > 0);
        if (hasAnyTrains) {
            isReplace = confirm("Databasen innehåller redan tåg.\n\nKlicka OK för att ERSÄTTA (tömmer alla grafer först).\nKlicka Avbryt för att LÄGGA TILL utöver de gamla.");
            if (isReplace) {
                allTrains = {};
            }
        }

        let totalImportedToCurrent = 0;

        // Loopa igenom ALLA sparade grafer
        savedGraphs.forEach(graph => {
            if (!allTrains[graph.id]) allTrains[graph.id] = [];
            let graphStations = graph.stations || [];
            let validSigns = graphStations.map(s => s.sign);
            let graphImportedTrains = [];

            for (const trainId in parsedData) {
                // Filtrera ut enbart de händelser som tillhör stationer i just DENNA graf
                let trainAnns = parsedData[trainId].filter(ann => validSigns.includes(ann.loc));
                if (trainAnns.length < 2) continue; // Tåget måste ha minst en ankomst och en avgång i grafen

                trainAnns.sort((a, b) => a.timestamp - b.timestamp);
                let trainStartDate = trainAnns[0].dateStr;
                let timetable = [];
                let currentStop = null;

                trainAnns.forEach(ann => {
                    if (!currentStop || currentStop.stationSign !== ann.loc) {
                        if (currentStop) {
                            if (!currentStop.departure) currentStop.departure = currentStop.arrival;
                            timetable.push(currentStop);
                        }
                        currentStop = {
                            stationSign: ann.loc,
                            arrival: ann.type === "Ankomst" ? ann.time : "",
                            departure: ann.type === "Avgang" ? ann.time : ""
                        };
                    } else {
                        if (ann.type === "Ankomst") currentStop.arrival = ann.time;
                        if (ann.type === "Avgang") currentStop.departure = ann.time;
                    }
                });

                if (currentStop) {
                    if (!currentStop.arrival) currentStop.arrival = currentStop.departure;
                    if (!currentStop.departure) currentStop.departure = currentStop.arrival;
                    timetable.push(currentStop);
                }

                if (timetable.length >= 2) {
                    graphImportedTrains.push({
                        id: trainId,
                        startDate: trainStartDate,
                        timetable: timetable
                    });
                }
            }

            allTrains[graph.id] = allTrains[graph.id].concat(graphImportedTrains);
            
            // Håll koll på hur många som importerades till just den graf användaren tittar på
            if (graph.id === activeGraphId) {
                totalImportedToCurrent = graphImportedTrains.length;
            }
        });

        // Uppdatera vyn för den aktuella grafen
        currentTrains = allTrains[activeGraphId] || [];
        saveData();
        renderTrainList();
        
        alert(`✅ Importeringen lyckades!\n\n${totalImportedToCurrent} tåg lades till i din aktuella vy, och övriga matchande sträckor har pytsats ut till dina andra grafer.`);
        
        if(currentTrains.length > 0) selectTrain(currentTrains.length - 1); 
        
    } catch (err) {
        alert("Kunde inte läsa XML-filen. Kontrollera formatet.");
        console.error(err);
    }
}
// --- EXPORT TILL KNAS ---
document.getElementById('exportXmlBtn').addEventListener('click', () => {
    if (currentTrains.length === 0) {
        alert("Det finns inga tåg att exportera.");
        return;
    }
    
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Timetable graphId="${activeGraphId}">\n`;
    currentTrains.forEach(t => {
        let dateAttr = t.startDate ? ` startDate="${t.startDate}"` : '';
        xml += `  <Train id="${t.id}"${dateAttr}>\n`;
        
        t.timetable.forEach(stop => {
            xml += `    <Stop sign="${stop.stationSign}" arrival="${stop.arrival}" departure="${stop.departure}" />\n`;
        });
        xml += `  </Train>\n`;
    });
    xml += `</Timetable>`;
    
    const blob = new Blob([xml], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tidtabell_${activeGraphId}.xml`;
    a.click();
    URL.revokeObjectURL(url);
});

init();