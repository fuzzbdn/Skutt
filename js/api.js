import { state } from './state.js';

// --- TOLK 1: När Grafen HÄMTAR tåg ---
// Gör om '2026-03-27T12:00' till minuter från Dagens Midnatt
function parseToMins(val) {
    if (val === null || val === undefined || val === '') return 0;
    let strVal = String(val);

    if (strVal.includes('T')) {
        let datePart = strVal.split('T')[0];
        let timePart = strVal.split('T')[1];
        let parts = timePart.split(':');
        let minsFromMidnight = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);

        let targetDate = new Date(datePart + "T00:00:00");
        let today = new Date();
        today.setHours(0, 0, 0, 0);

        // Diff i dagar ignorerar helt sommartid/vintertid och ger alltid rena 24-timmars-hopp!
        let diffDays = Math.round((targetDate.getTime() - today.getTime()) / 86400000);

        return (diffDays * 1440) + minsFromMidnight;
    }

    if (strVal.includes(':')) {
        let parts = strVal.split(':');
        return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    }
    return parseInt(strVal, 10) || 0;
}

// --- HJÄLPFUNKTION: Rensa stationsnamn (tar bort mellanslag och gemener) ---
function cleanSign(sign) {
    if (!sign) return "";
    return sign.toString().trim().toLowerCase();
}

export async function loadWorksFromDatabase() {
    if (!state.activeGraphId) return;
    try {
        const response = await fetch(`/api/works?graphId=${state.activeGraphId}`, {
            headers: { 'Authorization': `Bearer ${state.token}` }
        });

        if (response.status === 401) {
            alert("Din session har gått ut. Vänligen logga in igen.");
            localStorage.clear();
            window.location.href = 'index.html';
            return;
        }

        if (response.ok) {
            const rawWorks = await response.json();
            state.trackWorks = rawWorks.map(w => ({
                id: w.id, type: w.type, label: w.label, status: w.status,
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
        const response = await fetch(`/api/works?id=${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${state.token}` }
        });

        if (response.status === 401) {
            alert("Din session har gått ut. Vänligen logga in igen.");
            localStorage.clear();
            window.location.href = 'index.html';
            return;
        }
    } catch (error) { console.error("Kunde inte radera:", error); }
}

export async function loadTrainsFromDatabase() {
    if (!state.activeGraphId) return;
    try {
        const response = await fetch(`/api/trains?graphId=${state.activeGraphId}`, {
            headers: { 'Authorization': `Bearer ${state.token}` }
        });

        if (response.status === 401) {
            alert("Din session har gått ut. Vänligen logga in igen.");
            localStorage.clear();
            window.location.href = 'index.html';
            return;
        }

        if (response.ok) {
            const savedDbTrains = await response.json();
            state.trains = savedDbTrains.map(train => {
                let timetable = (train.timetable || []).map(stop => {
                    let stIdx = state.stations.findIndex(s => cleanSign(s.sign) === cleanSign(stop.stationSign));
                    return stIdx !== -1 ? { 
                        station: stIdx, 
                        arrival: parseToMins(stop.arrival), 
                        departure: parseToMins(stop.departure) 
                    } : null;
                }).filter(n => n !== null);
                
                timetable.sort((a, b) => a.arrival - b.arrival);
                
                return { id: train.id, startDate: train.startDate, timetable };
            }).filter(t => {
                if (t.timetable.length < 2) return false;
                
                // 🚨 SMART FILTER: Dölj historiska tåg! 🚨
                // Vi filtrerar bort tåg som är äldre än 24 timmar eller framtidståg längre bort än 48h
                const firstStop = t.timetable[0].arrival;
                const lastStop = t.timetable[t.timetable.length - 1].departure;
                
                // Endast tåg som avslutar sin rutt >= -1440 (Igår 00:00) 
                // och börjar sin rutt <= 2880 (I övermorgon 00:00) visas i grafen.
                return lastStop >= -1440 && firstStop <= 2880;
            });
            state.needsRedraw = true;
        }
    } catch (error) { console.error("API Fel (trains):", error); }
}

// --- TOLK 2: När Grafen SPARAR tåg ---
// Gör om minuter från Dagens Midnatt tillbaka till 'YYYY-MM-DDThh:mm' på ett sommartidssäkert sätt
export async function saveTrainsToDatabase() {
    if (!state.activeGraphId || state.trains.length === 0) return;

    const minsToDateString = (mins) => {
        let days = Math.floor(mins / 1440);
        let remainingMins = mins % 1440;
        if (remainingMins < 0) remainingMins += 1440; 
        
        let d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + days); // Lägg till antal dagar
        
        let yyyy = d.getFullYear();
        let mm = String(d.getMonth() + 1).padStart(2, '0');
        let dd = String(d.getDate()).padStart(2, '0');
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

        if (response.status === 401) {
            alert("Din session har gått ut. Vänligen logga in igen.");
            localStorage.clear();
            window.location.href = 'index.html';
            return;
        }
    } catch (error) { console.error("Kunde inte spara tåg:", error); }
}

let saveTimeout;
export function debouncedSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveTrainsToDatabase, 1000);
}
