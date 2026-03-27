import { state } from './state.js';
import { createLogoutButton } from './auth.js';
import { loadTrainsFromDatabase, loadWorksFromDatabase } from './api.js';
import { setupUI } from './ui.js';

document.addEventListener('DOMContentLoaded', () => {
    // 1. Säkerhetskontroll: Har vi en giltig biljett?
    const token = localStorage.getItem('skutt_token');
    if (!token) {
        // Kastas ut till inloggningssidan!
        window.location.href = 'index.html';
        return;
    }
    
    // Fyll på state så resten av appen fungerar
    state.token = token;
    state.currentUser = localStorage.getItem('skutt_user');
    
    // Starta graf-appen
    initApp();
});

export async function initApp() {
    createLogoutButton();
    // HÄMTA ANVÄNDARINSTÄLLNINGAR GLOBALT
    try {
        const settingsRes = await fetch('/api/settings', { headers: { 'Authorization': `Bearer ${state.token}` } });
        if (settingsRes.ok) {
            const settingsData = await settingsRes.json();
            if (settingsData.scroll_sensitivity) state.scrollSpeed = parseFloat(settingsData.scroll_sensitivity);
            if (settingsData.view_duration) state.viewDuration = parseInt(settingsData.view_duration);
        }
    } catch (e) { console.error("Kunde inte ladda personliga inställningar", e); }
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

    const sel = document.getElementById('activeGraphSelect');
    if (sel && state.savedGraphs.length > 0) {
        sel.innerHTML = '';
        state.savedGraphs.forEach(g => sel.appendChild(new Option(g.name, g.id)));
        
        sel.addEventListener('change', async (e) => {
            await loadGraphData(e.target.value);
        });
        
        await loadGraphData(state.savedGraphs[0].id);
    }

    setupUI();
}

async function loadGraphData(graphId) {
    state.activeGraphId = graphId;
    const graph = state.savedGraphs.find(g => g.id === graphId);
    
    if (graph && graph.stations) {
        state.stations = [...graph.stations].sort((a, b) => a.km - b.km);
    } else {
        state.stations = [];
    }
    
    state.selectedTrainIndex = null;
    state.activeNode = null;
    state.expandedWorkId = null;
    state.editingWorkId = null;
    state.draggingConflict = null;
    state.draggingNode = null;

    state.trains = [];
    state.trackWorks = [];
    state.conflicts = [];
    state.conflictSegments = new Set();
    
    await loadTrainsFromDatabase();
    await loadWorksFromDatabase();
    
    state.needsRedraw = true;
    state.needsSidebarUpdate = true;
}
