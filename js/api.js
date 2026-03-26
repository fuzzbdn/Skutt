import { state } from './state.js';

export async function loadWorksFromDatabase() {
    if (!state.activeGraphId) return;
    try {
        const response = await fetch(`/api/works?graphId=${state.activeGraphId}`, {
            headers: { 'Authorization': `Bearer ${state.token}` }
        });
        if (response.ok) {
            const rawWorks = await response.json();
            // Översätt från databasens namn (start_time) till grafens namn (startTime)
            state.trackWorks = rawWorks.map(w => ({
                id: w.id,
                type: w.type,
                label: w.label,
                status: w.status,
                startTime: w.start_time,
                endTime: w.end_time,
                startStation: w.start_station,
                endStation: w.end_station,
                track: w.track,
                blockedArea: w.blocked_area
                // Lägg till fler vid behov...
            }));
        }
    } catch (error) {
        console.error("Kunde inte hämta arbeten:", error);
    }
}
