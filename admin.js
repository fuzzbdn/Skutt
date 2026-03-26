// --- Datahantering ---
let graphs = [];
let activeGraphId = null;

const graphList = document.getElementById('graphList');
const emptyState = document.getElementById('emptyState');
const graphEditor = document.getElementById('graphEditor');
const graphNameInput = document.getElementById('graphNameInput');
const stationTableBody = document.getElementById('stationTableBody');

// Hämta token
const token = localStorage.getItem('skutt_token');
if (!token) {
    alert("Du är inte inloggad. Omdirigerar...");
    window.location.href = 'index.html';
}

// --- Initiering ---
async function init() {
    // Hämta grafer från databasen istället för bara localStorage
    try {
        const res = await fetch('/api/graphs', { 
            headers: { 'Authorization': `Bearer ${token}` } 
        });
        if (res.ok) {
            graphs = await res.json();
            localStorage.setItem('mto_graphs', JSON.stringify(graphs)); // Backup
        } else {
            graphs = JSON.parse(localStorage.getItem('mto_graphs')) || [];
        }
    } catch(e) {
        graphs = JSON.parse(localStorage.getItem('mto_graphs')) || [];
    }
    renderGraphList();
}

// --- Renderingsfunktioner ---
function renderGraphList() {
    graphList.innerHTML = '';
    
    graphs.forEach(graph => {
        const btn = document.createElement('button');
        btn.className = `graph-item ${graph.id === activeGraphId ? 'active' : ''}`;
        btn.textContent = graph.name || 'Namnlös graf';
        btn.onclick = () => selectGraph(graph.id);
        graphList.appendChild(btn);
    });
}

function selectGraph(id) {
    activeGraphId = id;
    const graph = graphs.find(g => g.id === id);
    
    if (graph) {
        emptyState.style.display = 'none';
        graphEditor.style.display = 'flex';
        graphNameInput.value = graph.name;
        renderStations();
        renderGraphList(); 
    }
}

function renderStations() {
    stationTableBody.innerHTML = '';
    const graph = graphs.find(g => g.id === activeGraphId);
    
    if (!graph.stations) graph.stations = [];
    graph.stations.sort((a, b) => a.km - b.km);

    graph.stations.forEach((station, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="text" value="${station.name}" onchange="updateStation(${index}, 'name', this.value)"></td>
            <td><input type="text" value="${station.sign}" onchange="updateStation(${index}, 'sign', this.value)"></td>
            <td><input type="number" step="0.1" value="${station.km}" onchange="updateStation(${index}, 'km', this.value)"></td>
            <td><button class="del-btn" onclick="deleteStation(${index})" title="Ta bort">×</button></td>
        `;
        stationTableBody.appendChild(tr);
    });
}

// --- Interaktioner ---
document.getElementById('createNewGraphBtn').addEventListener('click', () => {
    const newGraph = {
        id: Date.now().toString(), 
        name: "Ny Graf",
        stations: []
    };
    graphs.push(newGraph);
    saveData();
    selectGraph(newGraph.id);
});

document.getElementById('saveGraphBtn').addEventListener('click', () => {
    if (!activeGraphId) return;
    const graph = graphs.find(g => g.id === activeGraphId);
    graph.name = graphNameInput.value;
    saveData();
    renderGraphList();
    
    const btn = document.getElementById('saveGraphBtn');
    const originalText = btn.textContent;
    btn.textContent = "✅ Sparad!";
    btn.style.backgroundColor = "rgba(46, 125, 50, 0.2)";
    setTimeout(() => {
        btn.textContent = originalText;
        btn.style.backgroundColor = "";
    }, 1500);
});

document.getElementById('addStationBtn').addEventListener('click', () => {
    if (!activeGraphId) return;
    const nameInput = document.getElementById('newStationName');
    const signInput = document.getElementById('newStationSign');
    const kmInput = document.getElementById('newStationKm');
    
    if (!nameInput.value || !signInput.value) return alert("Ange åtminstone namn och beteckning.");

    const graph = graphs.find(g => g.id === activeGraphId);
    graph.stations.push({
        name: nameInput.value,
        sign: signInput.value,
        km: parseFloat(kmInput.value) || 0
    });
    
    nameInput.value = ''; signInput.value = ''; kmInput.value = '';
    saveData();
    renderStations();
});

window.updateStation = function(index, field, value) {
    const graph = graphs.find(g => g.id === activeGraphId);
    graph.stations[index][field] = field === 'km' ? (parseFloat(value) || 0) : value;
    saveData();
};

window.deleteStation = function(index) {
    if(confirm("Är du säker på att du vill ta bort driftplatsen?")) {
        const graph = graphs.find(g => g.id === activeGraphId);
        graph.stations.splice(index, 1);
        saveData();
        renderStations();
    }
};

async function saveData() {
    localStorage.setItem('mto_graphs', JSON.stringify(graphs));
    const activeGraph = graphs.find(g => g.id === activeGraphId);
    if (!activeGraph) return;

    try {
        await fetch('/api/graphs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(activeGraph)
        });
    } catch (error) { console.error("Kunde inte spara grafen", error); }
}

// XML Import/Export-funktionerna (kan ligga kvar orörda här för att bygga mallar)
function escapeXML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

document.getElementById('exportAllXmlBtn').addEventListener('click', () => {
    if (!graphs || graphs.length === 0) return alert("Inga grafer att exportera.");
    let xmlString = `<?xml version="1.0" encoding="UTF-8"?>\n<Graphs>\n`;
    graphs.forEach(graph => {
        xmlString += `    <Graph>\n        <Id>${escapeXML(graph.id)}</Id>\n        <Name>${escapeXML(graph.name)}</Name>\n        <Stations>\n`;
        const sortedStations = [...(graph.stations || [])].sort((a, b) => a.km - b.km);
        sortedStations.forEach(station => {
            xmlString += `            <Station>\n                <Name>${escapeXML(station.name)}</Name>\n                <Sign>${escapeXML(station.sign)}</Sign>\n                <Km>${station.km}</Km>\n            </Station>\n`;
        });
        xmlString += `        </Stations>\n    </Graph>\n`;
    });
    xmlString += `</Graphs>`;
    const blob = new Blob([xmlString], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `grafer_export_${new Date().toISOString().split('T')[0]}.xml`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
});

document.getElementById('importXmlBtn').addEventListener('click', () => document.getElementById('importXmlInput').click());

document.getElementById('importXmlInput').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const xmlDoc = new DOMParser().parseFromString(e.target.result, "text/xml");
        if (xmlDoc.getElementsByTagName("parsererror").length > 0) return alert("Fel vid inläsning.");
        const importedGraphs = [];
        const graphNodes = xmlDoc.getElementsByTagName("Graph");

        for (let i = 0; i < graphNodes.length; i++) {
            const node = graphNodes[i];
            const newGraph = {
                id: node.getElementsByTagName("Id")[0]?.textContent || Date.now().toString() + i,
                name: node.getElementsByTagName("Name")[0]?.textContent || "Namnlös",
                stations: Array.from(node.getElementsByTagName("Station")).map(st => ({
                    name: st.getElementsByTagName("Name")[0]?.textContent || "",
                    sign: st.getElementsByTagName("Sign")[0]?.textContent || "",
                    km: parseFloat(st.getElementsByTagName("Km")[0]?.textContent) || 0
                }))
            };
            importedGraphs.push(newGraph);
        }

        if (importedGraphs.length > 0) {
            if (confirm(`Hittade ${importedGraphs.length} grafer. Klicka OK för att LÄGGA TILL, Avbryt för att ERSÄTTA.`)) {
                graphs = graphs.concat(importedGraphs);
            } else {
                graphs = importedGraphs; activeGraphId = null; graphEditor.style.display = 'none'; emptyState.style.display = 'block';
            }
            saveData(); renderGraphList(); alert("Graferna importerades!");
        }
        event.target.value = '';
    };
    reader.readAsText(file);
});

init();
