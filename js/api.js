import { state, referenceMidnightUTC } from './state.js';

function parseToMins(val, startDateStr) {
    if (!val) return 0;
    let strVal = String(val);

    let yyyy, mm, dd, hh, min;

    if (strVal.includes('T')) {
        let parts = strVal.split('T');
        let dParts = parts[0].split('-');
        let tParts = parts[1].split(':');
        yyyy = parseInt(dParts[0], 10); mm = parseInt(dParts[1], 10); dd = parseInt(dParts[2], 10);
        hh = parseInt(tParts[0], 10); min = parseInt(tParts[1], 10);
    } else if (strVal.includes(':')) {
        let fDate = startDateStr ? String(startDateStr).split('T')[0] : new Date().toISOString().split('T')[0];
        let dParts = fDate.split('-');
        let tParts = strVal.split(':');
        yyyy = parseInt(dParts[0], 10); mm = parseInt(dParts[1], 10); dd = parseInt(dParts[2], 10);
        hh = parseInt(tParts[0], 10); min = parseInt(tParts[1], 10);
    } else {
        return parseInt(strVal, 10) || 0;
    }

    let targetUTC = Date.UTC(yyyy, mm - 1, dd);
    let diffDays = Math.round((targetUTC - referenceMidnightUTC) / 86400000);
    let minsFromMidnight = (hh * 60) + min;

    return (diffDays * 1440) + minsFromMidnight;
}

function cleanSign(sign) {
    if (!sign) return "";
    return sign.toString().trim().toLowerCase();
}

export async function loadWorksFromDatabase() {
    if (!state.activeGraphId) return;
    try {
        const response = await fetch(`/api/works?graphId=${state.activeGraphId}`, { headers: { 'Authorization': `Bearer ${state.token}` } });
        if (response.status === 401) { alert("Session utgången."); localStorage.clear(); window.location.href = 'index.html'; return; }
        if (response.ok) {
            const rawWorks = await response.json();
            state.trackWorks = rawWorks.map(w => ({
                id: w.id, type: w.type, label: w.label, status: w.status,
                startTime: parseToMins(w.start_time, null), 
                endTime: parseToMins(w.end_time, null),
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
        const response = await fetch(`/api/works?id=${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${state.token}` } });
        if (response.status === 401) { localStorage.clear(); window.location.href = 'index.html'; }
    } catch (error) { console.error("Kunde inte radera:", error); }
}

export async function loadTrainsFromDatabase() {
    if (!state.activeGraphId) return;
    try {
        const response = await fetch(`/api/trains?graphId=${state.activeGraphId}`, { headers: { 'Authorization': `Bearer ${state.token}` } });
        if (response.status === 401) { localStorage.clear(); window.location.href = 'index.html'; return; }
        if (response.ok) {
            const savedDbTrains = await response.json();
            state.trains = savedDbTrains.map(train => {
                let timetable = (train.timetable || []).map(stop => {
                    let stIdx = state.stations.findIndex(s => cleanSign(s.sign) === cleanSign(stop.stationSign));
                    return stIdx !== -1 ? { 
                        station: stIdx, 
                        arrival: parseToMins(stop.arrival, train.startDate), 
                        departure: parseToMins(stop.departure, train.startDate) 
                    } : null;
                }).filter(n => n !== null);
                
                timetable.sort((a, b) => a.arrival - b.arrival);
                return { id: train.id, startDate: train.startDate, timetable };
            }).filter(t => t.timetable.length >= 2);
            // 🚨 Det gamla filtret är nu borttaget så vi inte förlorar data!
            state.needsRedraw = true;
        }
    } catch (error) { console.error("API Fel (trains):", error); }
}

export async function saveTrainsToDatabase() {
    if (!state.activeGraphId || state.trains.length === 0) return;

    const minsToDateString = (mins) => {
        let days = Math.floor(mins / 1440);
        let remainingMins = mins % 1440;
        if (remainingMins < 0) remainingMins += 1440; 
        
        let targetUTC = new Date(referenceMidnightUTC + (days * 86400000));
        
        let yyyy = targetUTC.getUTCFullYear();
        let mm = String(targetUTC.getUTCMonth() + 1).padStart(2, '0');
        let dd = String(targetUTC.getUTCDate()).padStart(2, '0');
        let hh = String(Math.floor(remainingMins / 60)).padStart(2, '0');
        let m = String(remainingMins % 60).padStart(2, '0');
        
        return `${yyyy}-${mm}-${dd}T${hh}:${m}`;
    };

    const exportData = {
        graphId: state.activeGraphId,
        trains: state.trains.map(t => ({
            id: t.id, 
            startDate: t.startDate,
            timetable: t.timetable.map(n => ({
                stationSign: state.stations[n.station].sign,
                arrival: minsToDateString(Math.round(n.arrival)), 
                departure: minsToDateString(Math.round(n.departure))
            }))
        }))
    };

    try {
        const response = await fetch('/api/trains', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
            body: JSON.stringify(exportData)
        });
        if (response.status === 401) { localStorage.clear(); window.location.href = 'index.html'; }
    } catch (error) { console.error("Kunde inte spara tåg:", error); }
}

let saveTimeout;
export function debouncedSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveTrainsToDatabase, 1000);
}
