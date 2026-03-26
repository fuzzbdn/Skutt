import { state } from './state.js';
import { setupAuth, createLogoutButton } from './auth.js';
import { loadTrainsFromDatabase, loadWorksFromDatabase } from './api.js';
import { setupUI } from './ui.js';

document.addEventListener('DOMContentLoaded', () => {
    // Vi skickar in funktionen initApp som en "callback"
    setupAuth(initApp);
});

export async function initApp() {
    createLogoutButton();
    
    // Hämta grafer från databasen
    try {
        const res = await fetch('/api/graphs', { 
            headers: { 'Authorization': `Bearer ${state.token}` } 
        });
        if (res.ok) {
            state.savedGraphs = await res.json();
            localStorage.setItem('mto_graphs', JSON.stringify(state.savedGraphs));
        } else {
            state.savedGraphs = JSON.parse(localStorage.getItem('mto_graphs')) || [];
        }
    } catch (e) { 
        console.error("Kunde inte hämta grafer", e); 
        state.savedGraphs = JSON.parse(localStorage.getItem('mto_graphs')) || [];
    }

    // Setup väljare för graf
    const sel = document.getElementById('activeGraphSelect');
    if (sel && state.savedGraphs.length > 0) {
        sel.innerHTML = '';
        state.savedGraphs.forEach(g => sel.appendChild(new Option(g.name, g.id)));
        
        // När användaren byter graf i rullgardinslistan
        sel.addEventListener('change', async (e) => {
            await loadGraphData(e.target.value);
        });
        
        // Ladda den första grafen vid start
        await loadGraphData(state.savedGraphs[0].id);
    }

    // Starta canvas-klick och rit-loopen
    setupUI();
}

async function loadGraphData(graphId) {
    state.activeGraphId = graphId;
    const graph = state.savedGraphs.find(g => g.id === graphId);
    
    // Hämta och sortera stationerna säkert
    if (graph && graph.stations) {
        state.stations = [...graph.stations].sort((a, b) => a.km - b.km);
    } else {
        state.stations = [];
    }
    
    // 🚨 MYCKET VIKTIGT: Nollställ alla gamla val från förra grafen!
    // Annars kraschar renderingsloopen (och menyn) när den försöker 
    // visa ett tåg eller arbete som fanns i förra grafen men inte i den nya.
    state.selectedTrainIndex = null;
    state.activeNode = null;
    state.expandedWorkId = null;
    state.editingWorkId = null;
    state.draggingConflict = null;
    state.draggingNode = null;

    // Töm grafens data temporärt medan vi hämtar nytt (rensar canvasen)
    state.trains = [];
    state.trackWorks = [];
    state.conflicts = [];
    state.conflictSegments = new Set();
    
    // Ladda in de nya tågen och banarbetena från servern
    await loadTrainsFromDatabase();
    await loadWorksFromDatabase();
    
    // Säg åt canvasen och sidomenyn att rita upp allt på nytt för den nya grafen!
    state.needsRedraw = true;
    state.needsSidebarUpdate = true;
}
