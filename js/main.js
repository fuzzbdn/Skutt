// fil: js/main.js
import { state } from './state.js';
import { setupAuth, createLogoutButton } from './auth.js';
import { loadTrainsFromDatabase, loadWorksFromDatabase } from './api.js';
import { setupUI } from './ui.js';

// 1. När sidan laddas, starta inloggningskontrollen direkt
document.addEventListener('DOMContentLoaded', () => {
    setupAuth();
});

// 2. Denna funktion anropas inifrån auth.js så fort inloggningen har lyckats
export async function initApp() {
    createLogoutButton();
    
    // Hämta just DINA grafer från databasen
    try {
        const res = await fetch('/api/graphs', { 
            headers: { 'Authorization': `Bearer ${state.token}` } 
        });
        
        if (res.ok) {
            const dbGraphs = await res.json();
            if (dbGraphs.length > 0) {
                state.savedGraphs = dbGraphs;
                // Vi sparar en kopia lokalt ifall admin.js behöver läsa dem
                localStorage.setItem('mto_graphs', JSON.stringify(state.savedGraphs));
            }
        }
    } catch (e) { 
        console.error("Kunde inte hämta grafer från molnet", e); 
    }

    // Fyll rullgardinsmenyn i toppen med dina grafer
    const sel = document.getElementById('activeGraphSelect');
    if (sel && state.savedGraphs.length > 0) {
        sel.innerHTML = '';
        state.savedGraphs.forEach(g => {
            sel.appendChild(new Option(g.name || 'Namnlös graf', g.id));
        });
        
        // Lyssna på om användaren byter graf
        sel.addEventListener('change', (e) => loadGraphData(e.target.value));
        
        // Ladda in den allra första grafen automatiskt
        await loadGraphData(state.savedGraphs[0].id);
    } else if (sel) {
        sel.innerHTML = '<option>Inga grafer hittades för din användare</option>';
    }

    // Starta Canvas, ritslingan och alla mus-events!
    setupUI();
    
    console.log("SKUTT har startat framgångsrikt i modulläge!");
}

// 3. Funktion för att ladda data när en specifik graf väljs
export async function loadGraphData(graphId) {
    state.activeGraphId = graphId;
    const graph = state.savedGraphs.find(g => g.id === graphId);
    
    // Sortera driftplatserna efter km-tal
    state.stations = graph && graph.stations ? graph.stations.sort((a, b) => a.km - b.km) : [];
    
    // Nollställ eventuella val som användaren hade i den förra grafen
    state.expandedWorkId = null;
    state.editingWorkId = null;
    state.selectedTrainIndex = null;
    state.activeNode = null;
    state.draggingConflict = null;
    state.activeTooltipNode = null;
    state.tooltipHitboxes = null;

    // Hämta in tågen och banarbetena från servern för just denna graf
    await loadTrainsFromDatabase();
    await loadWorksFromDatabase();
    
    // Om du har en renderSidebar()-funktion inlagd i ui.js senare kan du anropa den här:
    // renderSidebar(); 
    
    // Tvinga canvasen att rita om sig med den nya datan
    state.needsRedraw = true;
}
