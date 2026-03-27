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
            let d = new Date(safeDate);
            d.setDate(d.getDate() + days); 
            
            let yyyy = d.getFullYear();
            let mm = String(d.getMonth() + 1).padStart(2, '0');
            let dd = String(d.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        }
        return '';
    };

    timetable.forEach((stop) => {
        timetableBody.appendChild(createRow(
            stop.stationSign, 
            formatForInput(stop.arrival, startDate), 
            formatForInput(stop.departure, startDate)
        ));
    });
}

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

    if (stationSign && !found) sel += `<option value="${stationSign}" selected style="background:#25262b; color:#ff6b6b;">⚠ Okänd: ${stationSign}</option>`;
    sel += `</select>`;
    
    tr.innerHTML = `
        <td style="padding: 2px;">${sel}</td>
        <td style="padding: 2px;"><input type="datetime-local" class="arr-in" value="${arr}" style="${inputStyle}" onfocus="${focusLogic}" onblur="${blurLogic}"></td>
        <td style="padding: 2px;"><input type="datetime-local" class="dep-in" value="${dep}" style="${inputStyle}" onfocus="${focusLogic}" onblur="${blurLogic}"></td>
        <td style="padding: 2px; text-align: center;"><button class="del-btn" title="Ta bort rad" style="background:transparent; border:none; color:#ff6b6b; font-size:1.5em; cursor:pointer; padding:0; height:30px;">×</button></td>
    `;
    
    tr.querySelector('.del-btn').onclick = () => tr.remove();
    return tr;
}

document.getElementById('createNewTrainBtn').addEventListener('click', async () => {
    const today = new Date();
    const dateStr = today.getFullYear() + "-" + String(today.getMonth()+1).padStart(2,'0') + "-" + String(today.getDate()).padStart(2,'0');
    const timeStr = `${dateStr}T12:00`;
    
    const newTrain = {
        id: "Nytt",
        startDate: dateStr,
        timetable: [
            { stationSign: stations[0]?.sign || '', arrival: timeStr, departure: timeStr },
            { stationSign: stations[stations.length-1]?.sign || '', arrival: `${dateStr}T13:00`, departure: `${dateStr}T13:00` }
        ]
    };
    currentTrains.push(newTrain);
    await saveData();
    selectTrain(currentTrains.length - 1);
});

document.getElementById('addTimetableRowBtn').addEventListener('click', () => {
    timetableBody.appendChild(createRow());
    const container = document.querySelector('.table-container');
    container.scrollTop = container.scrollHeight;
});

document.getElementById('saveTrainBtn').addEventListener('click', async () => {
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
    
    await saveData();
    renderTrainList(); 
    
    const btn = document.getElementById('saveTrainBtn');
    const orig = btn.textContent;
    btn.textContent = "✅ Sparat!";
    setTimeout(() => btn.textContent = orig, 1500);
});

document.getElementById('deleteTrainBtn').addEventListener('click', async () => {
    if (activeTrainIndex === null) return;
    if (confirm("Är du säker på att du vill ta bort detta tåg?")) {
        currentTrains.splice(activeTrainIndex, 1);
        activeTrainIndex = null;
        await saveData();
        renderTrainList();
        trainEditor.style.display = 'none';
        emptyState.style.display = 'flex';
    }
});

async function saveData() {
    try {
        const response = await fetch('/api/trains', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ graphId: activeGraphId, trains: currentTrains })
        });
        
        if (response.status === 401) {
            alert("Din session har gått ut. Vänligen logga in igen.");
            localStorage.clear();
            window.location.href = 'index.html';
            return;
        }
    } catch (error) {
        console.error("Kunde inte spara tåg till databasen", error);
    }
}

// --- LÄS IN BÅDA XML-TYPERNA TILL DATABASEN ---
const importExternalXmlBtn = document.getElementById('importExternalXmlBtn');
const externalXmlFileInput = document.getElementById('externalXmlFileInput');

if (importExternalXmlBtn && externalXmlFileInput) {
    importExternalXmlBtn.addEventListener('click', () => externalXmlFileInput.click());

    externalXmlFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const xmlStr = event.target.result;
            if (xmlStr.includes("<Timetable")) {
                parseCustomXML(xmlStr); 
            } else {
                parseTrafikverketXML(xmlStr); 
            }
            externalXmlFileInput.value = ''; 
        };
        reader.readAsText(file);
    });
}

async function parseCustomXML(xmlString) {
    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, "text/xml");
        const trains = xmlDoc.getElementsByTagName("Train");
        
        let graphImportedTrains = [];
        const defaultDate = new Date().toISOString().split('T')[0]; 
        
        let graphStations = stations;
        let validSigns = graphStations.map(s => s.sign.toLowerCase());

        for (let i = 0; i < trains.length; i++) {
            const trainNode = trains[i];
            const trainId = trainNode.getAttribute("id");
            let startDateStr = trainNode.getAttribute("startDate") || defaultDate;
            
            const stops = trainNode.getElementsByTagName("Stop");
            let timetable = [];
            
            let currentBaseDate = new Date(startDateStr);
            let lastTimeMins = -1;

            for (let j = 0; j < stops.length; j++) {
                const stopNode = stops[j];
                const sign = stopNode.getAttribute("sign");
                let arr = stopNode.getAttribute("arrival");
                let dep = stopNode.getAttribute("departure");
                
                if (!arr) arr = dep;
                if (!dep) dep = arr;

                if (!validSigns.includes(sign.toLowerCase())) continue;

                const formatTime = (timeStr) => {
                    if (!timeStr) return "";
                    let parts = timeStr.split(':');
                    let mins = parseInt(parts[0]) * 60 + parseInt(parts[1]);
                    
                    if (lastTimeMins !== -1 && mins < lastTimeMins - 120) {
                        currentBaseDate.setDate(currentBaseDate.getDate() + 1);
                    }
                    lastTimeMins = mins;

                    let yyyy = currentBaseDate.getFullYear();
                    let mm = String(currentBaseDate.getMonth() + 1).padStart(2, '0');
                    let dd = String(currentBaseDate.getDate()).padStart(2, '0');
                    
                    return `${yyyy}-${mm}-${dd}T${timeStr}`;
                };

                timetable.push({
                    stationSign: sign,
                    arrival: formatTime(arr),
                    departure: formatTime(dep)
                });
            }

            if (timetable.length >= 2) {
                graphImportedTrains.push({
                    id: trainId,
                    startDate: startDateStr,
                    timetable: timetable
                });
            }
        }

        if (graphImportedTrains.length > 0) {
            let isReplace = false;
            if (currentTrains.length > 0) {
                isReplace = confirm(`Hittade ${graphImportedTrains.length} tåg för denna sträcka.\n\nKlicka OK för att ERSÄTTA dina nuvarande tåg.\nKlicka Avbryt för att LÄGGA TILL utöver de gamla.`);
                if (isReplace) currentTrains = [];
            }
            currentTrains = currentTrains.concat(graphImportedTrains);
            await saveData();
            renderTrainList();
            alert(`✅ Importeringen lyckades!\n\n${graphImportedTrains.length} tåg lästes in.`);
            if (currentTrains.length > 0) selectTrain(currentTrains.length - 1);
        } else {
            alert("Hittade inga tåg i filen som stannar på driftplatserna i denna graf.");
        }

    } catch (err) {
        alert("Kunde inte läsa XML-filen."); console.error(err);
    }
}

async function parseTrafikverketXML(xmlString) {
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
                
                const yyyy = dateObj.getFullYear();
                const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
                const dd = String(dateObj.getDate()).padStart(2, '0');
                const hh = String(dateObj.getHours()).padStart(2, '0');
                const mins = String(dateObj.getMinutes()).padStart(2, '0');
                const datetimeLocal = `${yyyy}-${mm}-${dd}T${hh}:${mins}`;

                parsedData[trainId].push({ 
                    loc: locNode.textContent, 
                    type: activityNode.textContent, 
                    time: datetimeLocal,
                    timestamp: dateObj.getTime(), 
                    dateStr: `${yyyy}-${mm}-${dd}` 
                });
            }
        }

        let isReplace = false;
        if (currentTrains.length > 0) {
            isReplace = confirm("Databasen innehåller redan tåg.\n\nKlicka OK för att ERSÄTTA.\nKlicka Avbryt för att LÄGGA TILL utöver de gamla.");
            if (isReplace) currentTrains = [];
        }

        let graphStations = stations;
        let validSigns = graphStations.map(s => s.sign.toLowerCase());
        let graphImportedTrains = [];

        for (const trainId in parsedData) {
            let trainAnns = parsedData[trainId].filter(ann => validSigns.includes(ann.loc.toLowerCase()));
            if (trainAnns.length < 2) continue; 

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
                    currentStop = { stationSign: ann.loc, arrival: ann.type === "Ankomst" ? ann.time : "", departure: ann.type === "Avgang" ? ann.time : "" };
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

            if (timetable.length >= 2) graphImportedTrains.push({ id: trainId, startDate: trainStartDate, timetable: timetable });
        }

        currentTrains = currentTrains.concat(graphImportedTrains);
        await saveData();
        renderTrainList();
        
        alert(`✅ Importeringen lyckades!\n\n${graphImportedTrains.length} tåg lades till i denna graf.`);
        if(currentTrains.length > 0) selectTrain(currentTrains.length - 1); 
        
    } catch (err) {
        alert("Kunde inte läsa XML-filen."); console.error(err);
    }
}
// --- EXPORTERA TILL XML FRÅN DAGSPLANERINGEN ---
const exportXmlBtn = document.getElementById('exportXmlBtn');
if (exportXmlBtn) {
    exportXmlBtn.addEventListener('click', () => {
        if (!currentTrains || currentTrains.length === 0) {
            return alert("Det finns inga tåg att exportera för denna sträcka.");
        }

        // Bygg XML-huvudet
        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Timetable graphId="${activeGraphId}">\n`;
        
        // Hjälpfunktion för att plocka ut "hh:mm" från databasens "YYYY-MM-DDThh:mm"
        const getHHMM = (dateStr) => {
            if (!dateStr) return "";
            if (dateStr.includes('T')) {
                const parts = dateStr.split('T')[1].split(':');
                return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
            }
            if (dateStr.includes(':')) {
                const parts = dateStr.split(':');
                return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
            }
            return dateStr;
        };

        // Loopa igenom alla tåg i dagsplaneringens lista
        currentTrains.forEach(t => {
            // Skapa Train-taggen med startdatum
            const safeDate = t.startDate ? String(t.startDate).split('T')[0] : new Date().toISOString().split('T')[0];
            xml += `\t<Train id="${t.id}" startDate="${safeDate}">\n`;
            
            // Loopa igenom varje hållplats
            t.timetable.forEach((stop) => {
                let sign = stop.stationSign;
                let arr = getHHMM(stop.arrival);
                let dep = getHHMM(stop.departure);
                
                // Skriv ut alla hållplatser
                xml += `\t\t<Stop sign="${sign}" arrival="${arr}" departure="${dep}"/>\n`;
            });
            
            xml += `\t</Train>\n`;
        });
        
        xml += `</Timetable>`;

        // Skapa och ladda ner filen
        const blob = new Blob([xml], { type: 'text/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dagsplanering_export_${Date.now()}.xml`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
}
init();
