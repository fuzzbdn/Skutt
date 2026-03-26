import { state } from './state.js';

// ==========================================
// HÄMTA DATA FRÅN DATABASEN
// ==========================================
export async function loadWorksFromDatabase() {
    if (!state.activeGraphId) return;
    try {
        const response = await fetch(`/api/works?graphId=${state.activeGraphId}`, {
            headers: { 'Authorization': `Bearer ${state.token}` }
        });
        if (response.ok) {
            state.trackWorks = await response.json();
        } else {
            state.trackWorks = [];
        }
    } catch (error) {
        console.error("Kunde inte hämta arbeten:", error);
        state.trackWorks = [];
    }
}

export async function loadTrainsFromDatabase() {
    if (!state.activeGraphId) return;
    try {
        const response = await fetch(`/api/trains?graphId=${state.activeGraphId}`, {
            headers: { 'Authorization': `Bearer ${state.token}` }
        });
        let savedDbTrains = [];
        if (response.ok) savedDbTrains = await response.json();
        
        state.trains = savedDbTrains.map(train => {
            let convertedTimetable = [];
            train.timetable.forEach(stop => {
                let stIdx = state.stations.findIndex(s => s.sign === stop.stationSign);
                if (stIdx !== -1) {
                    convertedTimetable.push({ station: stIdx, arrival: stop.arrival, departure: stop.departure });
                }
            });
            convertedTimetable.sort((a, b) => a.arrival - b.arrival);
            let sDate = train.startDate ? train.startDate.split('T')[0] : "";
            
            return { id: train.id, startDate: sDate, timetable: convertedTimetable };
        }).filter(t => t.timetable.length >= 2);

    } catch (error) {
        console.error("Kunde inte hämta tåg:", error);
        state.trains = [];
    }
}

// ==========================================
// SPARA DATA TILL DATABASEN
// ==========================================
export async function saveTrainsToDatabase() {
    if (!state.activeGraphId) return;
    
    let exportTrains = state.trains.map(train => {
        let exportTimetable = train.timetable.map(node => {
            return {
                stationSign: state.stations[node.station].sign,
                arrival: node.arrival,
                departure: node.departure
            };
        });
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

// Timer för att inte spara till databasen för ofta när man skrollar tider
let saveDbTimeout;
export function debouncedSave() {
    clearTimeout(saveDbTimeout);
    saveDbTimeout = setTimeout(saveTrainsToDatabase, 500);
}
