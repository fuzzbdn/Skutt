// --- Datahantering via LocalStorage ---
// Hämta befintliga grafer eller skapa en tom array
let graphs = JSON.parse(localStorage.getItem('mto_graphs')) || [];
let activeGraphId = null;

// Referenser till DOM-element
const graphList = document.getElementById('graphList');
const emptyState = document.getElementById('emptyState');
const graphEditor = document.getElementById('graphEditor');
const graphNameInput = document.getElementById('graphNameInput');
const stationTableBody = document.getElementById('stationTableBody');

// --- Initiering ---
function init() {
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
        renderGraphList(); // Uppdatera aktiv CSS-klass
    }
}

function renderStations() {
    stationTableBody.innerHTML = '';
    const graph = graphs.find(g => g.id === activeGraphId);
    
    if (!graph.stations) graph.stations = [];

    // Sortera driftplatser på Km-tal
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
        id: Date.now().toString(), // Unikt ID baserat på tid
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
    
    // Visuell feedback
    const btn = document.getElementById('saveGraphBtn');
    const originalText = btn.textContent;
    btn.textContent = "✅ Sparad!";
    btn.style.backgroundColor = "rgba(46, 125, 50, 0.2)";
    setTimeout(() => {
        btn.textContent = originalText;
        btn.style.backgroundColor = "";
    }, 1500);
});

// Lägg till ny driftplats från botten-raden
document.getElementById('addStationBtn').addEventListener('click', () => {
    if (!activeGraphId) return;
    
    const nameInput = document.getElementById('newStationName');
    const signInput = document.getElementById('newStationSign');
    const kmInput = document.getElementById('newStationKm');
    
    if (!nameInput.value || !signInput.value) {
        alert("Ange åtminstone namn och beteckning.");
        return;
    }

    const graph = graphs.find(g => g.id === activeGraphId);
    graph.stations.push({
        name: nameInput.value,
        sign: signInput.value,
        km: parseFloat(kmInput.value) || 0
    });
    
    // Rensa inmatningsfälten
    nameInput.value = '';
    signInput.value = '';
    kmInput.value = '';
    
    saveData();
    renderStations();
});

// --- Uppdatera / Ta bort driftplatser ---
window.updateStation = function(index, field, value) {
    const graph = graphs.find(g => g.id === activeGraphId);
    if (field === 'km') {
        graph.stations[index][field] = parseFloat(value) || 0;
    } else {
        graph.stations[index][field] = value;
    }
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

// --- Spara till webbläsaren ---
function saveData() {
    localStorage.setItem('mto_graphs', JSON.stringify(graphs));
}


// ==========================================
// --- XML Export & Import (Alla grafer) ---
// ==========================================

function escapeXML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// 1. Exportera
document.getElementById('exportAllXmlBtn').addEventListener('click', () => {
    if (!graphs || graphs.length === 0) {
        alert("Det finns inga grafer att exportera.");
        return;
    }

    let xmlString = `<?xml version="1.0" encoding="UTF-8"?>\n<Graphs>\n`;

    graphs.forEach(graph => {
        xmlString += `    <Graph>\n`;
        xmlString += `        <Id>${escapeXML(graph.id)}</Id>\n`;
        xmlString += `        <Name>${escapeXML(graph.name)}</Name>\n`;
        xmlString += `        <Stations>\n`;

        const sortedStations = [...(graph.stations || [])].sort((a, b) => a.km - b.km);
        sortedStations.forEach(station => {
            xmlString += `            <Station>\n`;
            xmlString += `                <Name>${escapeXML(station.name)}</Name>\n`;
            xmlString += `                <Sign>${escapeXML(station.sign)}</Sign>\n`;
            xmlString += `                <Km>${station.km}</Km>\n`;
            xmlString += `            </Station>\n`;
        });

        xmlString += `        </Stations>\n`;
        xmlString += `    </Graph>\n`;
    });

    xmlString += `</Graphs>`;

    const blob = new Blob([xmlString], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    // Generera ett filnamn med dagens datum
    const dateStr = new Date().toISOString().split('T')[0];
    a.download = `grafer_export_${dateStr}.xml`;
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// 2. Importera
document.getElementById('importXmlBtn').addEventListener('click', () => {
    document.getElementById('importXmlInput').click();
});

document.getElementById('importXmlInput').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const xmlText = e.target.result;
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");

        if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
            alert("Fel vid inläsning. Kontrollera att det är en giltig XML-fil.");
            return;
        }

        const importedGraphs = [];
        const graphNodes = xmlDoc.getElementsByTagName("Graph");

        for (let i = 0; i < graphNodes.length; i++) {
            const node = graphNodes[i];
            const idNode = node.getElementsByTagName("Id")[0];
            const nameNode = node.getElementsByTagName("Name")[0];
            const stationNodes = node.getElementsByTagName("Station");

            const newGraph = {
                id: idNode ? idNode.textContent : Date.now().toString() + i,
                name: nameNode ? nameNode.textContent : "Namnlös graf",
                stations: []
            };

            for (let j = 0; j < stationNodes.length; j++) {
                const stNode = stationNodes[j];
                const stName = stNode.getElementsByTagName("Name")[0];
                const stSign = stNode.getElementsByTagName("Sign")[0];
                const stKm = stNode.getElementsByTagName("Km")[0];

                newGraph.stations.push({
                    name: stName ? stName.textContent : "",
                    sign: stSign ? stSign.textContent : "",
                    km: stKm ? parseFloat(stKm.textContent) : 0
                });
            }
            importedGraphs.push(newGraph);
        }

        if (importedGraphs.length > 0) {
            if (confirm(`Hittade ${importedGraphs.length} grafer i filen.\n\nKlicka OK för att LÄGGA TILL dem i din nuvarande lista.\nKlicka Avbryt för att SKRIVA ÖVER dina nuvarande grafer.`)) {
                graphs = graphs.concat(importedGraphs);
            } else {
                graphs = importedGraphs;
                activeGraphId = null;
                graphEditor.style.display = 'none';
                emptyState.style.display = 'block';
            }

            saveData();
            renderGraphList();
            alert("Graferna har importerats framgångsrikt!");
        } else {
            alert("Hittade inga grafer i XML-filen.");
        }
        
        event.target.value = '';
    };
    
    reader.readAsText(file);
});

// Starta
init();