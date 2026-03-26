import { state } from './state.js';

// ==========================================
// BANARBETEN (WORKS)
// ==========================================
export async function loadWorksFromDatabase() {
    if (!state.activeGraphId) return;
    try {
        const response = await fetch(`/api/works?graphId=${state.activeGraphId}`, {
            headers: { 'Authorization': `Bearer ${state.token}` }
        });
        if (response.ok) {
            const rawWorks = await response.json();
            // Vi mappar om databasens snake_case till grafens camelCase
            state.trackWorks = rawWorks.map(w => ({
                id: w.id,
                type: w.type,
                label: w.label,
                status: w.status,
                startTime: w.start_time,      // Från start_time
                endTime: w.end_time,          // Från end_time
                startStation: w.start_station, // Från start_station
                endStation: w.end_station,     // Från end_station
                track: w.track,
                blockedArea: w.blocked_area,
                incStart: w.inc_start ?? true, // Fallback om de saknas
                incEnd: w.inc_end ?? true
            }));
            state.needsRedraw = true;
        }
    } catch (error) {
        console.error("Kunde inte hämta arbeten:", error);
    }
}

// ==========================================
// TÅG (TRAINS)
// ==========================================
export async function loadTrainsFromDatabase() {
    if (!state.activeGraphId) return;
    try {
        const response = await fetch(`/api/trains?graphId=${state.activeGraphId}`, {
            headers: { 'Authorization': `Bearer ${state.token}` }
        });
        if (response.ok) {
            const savedDbTrains = await response.json();
            state.trains = savedDbTrains.map(train => {
                let convertedTimetable = [];
                train.timetable.forEach(stop => {
                    let stIdx = state.stations.findIndex(s => s.sign === stop.stationSign);
                    if (stIdx !== -1) {
                        convertedTimetable.push({ 
                            station: stIdx, 
                            arrival: stop.arrival, 
                            departure: stop.departure 
                        });
                    }
                });
                convertedTimetable.sort((a, b) => a.arrival - b.arrival);
                let sDate = train.startDate ? train.startDate.split('T')[0] : "";
                return { id: train.id, startDate: sDate, timetable: convertedTimetable };
            }).filter(t => t.timetable.length >= 2);
            state.needsRedraw = true;
        }
    } catch (error) {
        console.error("Kunde inte hämta tåg:", error);
    }
}

export async function saveTrainsToDatabase() {
    if (!state.activeGraphId) return;
    
    const exportTrains = state.trains.map(train => {
        const exportTimetable = train.timetable.map(node => ({
            stationSign: state.stations[node.station].sign,
            arrival: node.arrival,
            departure: node.departure
        }));
        return { id: train.id, startDate: train.startDate, timetable: exportTimetable };
    });
    
    try {
        await fetch('/api/trains', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.token}` 
            },
            body: JSON.stringify({ graphId: state.activeGraphId, trains: exportTrains })
        });
    } catch (error) {
        console.error("Kunde inte spara tåg:", error);
    }
}

// Timer för att inte belasta databasen vid varje pixel-flytt
let saveDbTimeout;
export function debouncedSave() {
    clearTimeout(saveDbTimeout);
    saveDbTimeout = setTimeout(saveTrainsToDatabase, 500);
}
