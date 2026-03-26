// fil: js/main.js
import { state } from './state.js';
import { setupAuth, createLogoutButton } from './auth.js';

// 1. När sidan laddas, kör auth-setupen direkt
document.addEventListener('DOMContentLoaded', () => {
    setupAuth();
});

// 2. Denna körs av auth.js när inloggningen lyckas
export async function initApp() {
    createLogoutButton();
    
    // Hämta grafer från databasen
    try {
        const res = await fetch('/api/graphs', {
            headers: { 'Authorization': `Bearer ${state.token}` }
        });
        
        if (res.ok) {
            const dbGraphs = await res.json();
            if (dbGraphs.length > 0) {
                state.savedGraphs = dbGraphs;
                localStorage.setItem('mto_graphs', JSON.stringify(state.savedGraphs));
            }
        }
    } catch (e) {
        console.error("Kunde inte hämta grafer från molnet", e);
    }

    // TODO i nästa steg: Starta grafen och render-loopen här!
    console.log("Appen är redo att starta!");
}
