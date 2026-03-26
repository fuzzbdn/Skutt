import { state } from './state.js';

// --- HJÄLPFUNKTION: Tolka alltid tid till minuter för grafen ---
function parseToMins(val) {
    if (typeof val === 'number') return Math.round(val);
    if (typeof val === 'string' && val.includes(':')) {
        const parts = val.split(':');
        return (parseInt(parts[0], 10) * 60) + parseInt(parts[1], 10);
    }
    return parseInt(val, 10) || 0;
}

export async function loadWorksFromDatabase() {
    if (!state.activeGraphId) return;
    try {
        const response = await fetch(`/api/works?graphId=${state.activeGraphId}`, {
            headers: { 'Authorization': `Bearer ${state.token}` }
        });
        if (response.ok) {
            const rawWorks = await response.json();
            state.trackWorks = rawWorks.map(w => ({
                id: w.id, type: w.type, label: w.label, status: w.status,
                // Tvinga till minuter för grafen!
                startTime: parseToMins(w.start_time), 
                endTime: parseToMins(w.end_time),
                startStation: w.start_station, endStation: w.end_station,
                track: w.track, blockedArea: w.blocked_area,
                incStart: w.inc_start ?? true, incEnd: w.inc_end ?? true,
                switches: w.switches, consultation: w.consultation,
                contactName: w.contact_name, contactPhone: w.contact_phone,
                detailsText: w.details_text, endPlace: w.end_place, bounds: w.bounds
            }));
            state.needsRedraw = true;
        }
    } catch (error) { console.error("API Fel (works):", error); }
}

export async function deleteWorkFromDatabase(id) {
    try {
        await fetch(`/api/works?id=${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${state.token}` }
        });
    } catch (error) { console.error("Kunde inte radera:", error); }
}

export async function loadTrainsFromDatabase() {
    if (!state.activeGraphId) return;
    try {
        const response = await fetch(`/api/trains?graphId=${state.activeGraphId}`, {
            headers: { 'Authorization': `Bearer ${state.token}` }
        });
        if (response.ok) {
            const savedDbTrains = await response.json();
            state.trains = savedDbTrains.map(train => {
                let timetable = train.timetable.map(stop => {
                    let stIdx = state.stations.findIndex(s => s.sign === stop.stationSign);
                    // Tvinga till minuter för grafen!
                    return stIdx !== -1 ? { 
                        station: stIdx, 
                        arrival: parseToMins(stop.arrival), 
                        departure: parseToMins(stop.departure) 
                    } : null;
                }).filter(n => n !== null);
                
                // MÅSTE sorteras i tid för att linjen ska ritas från vänster till höger
                timetable.sort((a, b) => a.arrival - b.arrival);
                
                return { id: train.id, startDate: train.startDate, timetable };
            }).filter(t => t.timetable.length >= 2);
            state.needsRedraw = true;
        }
    } catch (error) { console.error("API Fel (trains):", error); }
}

export async function saveTrainsToDatabase() {
    if (!state.activeGraphId || state.trains.length === 0) return;
    const exportData = {
        graphId: state.activeGraphId,
        trains: state.trains.map(t => ({
            id: t.id, startDate: t.startDate,
            timetable: t.timetable.map(n => ({
                stationSign: state.stations[n.station].sign,
                arrival: Math.round(n.arrival), 
                departure: Math.round(n.departure)
            }))
        }))
    };
    try {
        await fetch('/api/trains', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
            body: JSON.stringify(exportData)
        });
    } catch (error) { console.error("Kunde inte spara tåg:", error); }
}

let saveTimeout;
export function debouncedSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveTrainsToDatabase, 1000);
}
