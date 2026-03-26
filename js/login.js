import { setupAuth } from './auth.js';

document.addEventListener('DOMContentLoaded', () => {
    // Starta inloggningslogiken. 
    // Funktionen inuti körs bara om inloggningen lyckas eller om vi redan är inloggade.
    setupAuth(() => {
        window.location.href = 'graph.html';
    });
});
