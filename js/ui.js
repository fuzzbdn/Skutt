import { state, getAbsoluteMinutes } from './state.js';
import { getY, getTimeFromY, getX, margin, getStationFromX, formatTime } from './math.js';
import { canvas, drawGraph, getNodeX } from './canvas.js';
import { saveTrainsToDatabase, debouncedSave, loadWorksFromDatabase, deleteWorkFromDatabase } from './api.js';

// ==========================================
// MATTE OCH HJÄLPFUNKTIONER FÖR MUSEN
// ==========================================
function getClosestBound(x, isLeftBound) {
    let minDiff = Infinity;
    let result = { station: 0, inc: true };
    for (let i = 0; i < state.stations.length; i++) {
        let sx = getX(i, canvas.width);
        let diff = Math.abs(x - sx);
        if (diff < minDiff) { minDiff = diff; result = { station: i, inc: true }; }
        if (i < state.stations.length - 1) {
            let mx = (getX(i, canvas.width) + getX(i+1, canvas.width)) / 2;
            let diffM = Math.abs(x - mx);
            if (diffM < minDiff) { minDiff = diffM; result = { station: isLeftBound ? i : i + 1, inc: false }; }
        }
    }
    return result;
}

function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
    let l2 = (x1 - x2) ** 2 + (y1 - y2) ** 2;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

function getHitTrainIndex(mx, my) {
    let bestTrain = null, minDist = 12; 
    for (let i = 0; i < state.trains.length; i++) {
        if(!state.trains[i].timetable || state.trains[i].timetable.length < 2) continue;
        for (let j = 0; j < state.trains[i].timetable.length - 1; j++) {
            let n1 = state.trains[i].timetable[j], n2 = state.trains[i].timetable[j+1];
            let x1 = getNodeX(i, j), x2 = getNodeX(i, j+1);
            if (n1.arrival !== n1.departure && pointToSegmentDistance(mx, my, x1, getY(n1.arrival, canvas.height), x1, getY(n1.departure, canvas.height)) < minDist) { minDist = pointToSegmentDistance(mx, my, x1, getY(n1.arrival, canvas.height), x1, getY(n1.departure, canvas.height)); bestTrain = i; }
            if (pointToSegmentDistance(mx, my, x1, getY(n1.departure, canvas.height), x2, getY(n2.arrival, canvas.height)) < minDist) { minDist = pointToSegmentDistance(mx, my, x1, getY(n1.departure, canvas.height), x2, getY(n2.arrival, canvas.height)); bestTrain = i; }
        }
    }
    return bestTrain;
}

function getHoveredNode(mx, my) {
    if (state.selectedTrainIndex === null) return null;
    let bestNode = null, minDistance = 15;
    state.trains[state.selectedTrainIndex].timetable.forEach((node, j) => {
        const nx = getNodeX(state.selectedTrainIndex, j);
        const yArr = getY(node.arrival, canvas.height);
        const yDep = getY(node.departure, canvas.height);
        const distArr = Math.hypot(mx - nx, my - yArr);
        const distDep = Math.hypot(mx - nx, my - yDep);

        if (node.arrival === node.departure) {
            if (distArr < minDistance) { minDistance = distArr; bestNode = { trainIndex: state.selectedTrainIndex, nodeIndex: j, type: 'departure' }; }
        } else {
            if (distDep < minDistance) { minDistance = distDep; bestNode = { trainIndex: state.selectedTrainIndex, nodeIndex: j, type: 'departure' }; }
            if (distArr < minDistance) { minDistance = distArr; bestNode = { trainIndex: state.selectedTrainIndex, nodeIndex: j, type: 'arrival' }; }
        }
    });
    return bestNode;
}

export function resolveConflict(conflict, stIdx) {
    const ensureNode = (trainIdx) => {
        let train = state.trains[trainIdx];
        let nodeIdx = train.timetable.findIndex(n => n.station === stIdx);
        if (nodeIdx !== -1) {
            return { node: train.timetable[nodeIdx], index: nodeIdx };
        }
        
        const targetKm = state.stations[stIdx].km;
        for (let i = 0; i < train.timetable.length - 1; i++) {
            let km1 = state.stations[train.timetable[i].station].km;
            let km2 = state.stations[train.timetable[i+1].station].km;
            if ((targetKm > Math.min(km1, km2)) && (targetKm < Math.max(km1, km2))) {
                let ratio = Math.abs(targetKm - km1) / Math.abs(km2 - km1);
                let time = train.timetable[i].departure + (train.timetable[i+1].arrival - train.timetable[i].departure) * ratio;
                let snapped = Math.round(time);
                let newNode = { station: stIdx, arrival: snapped, departure: snapped };
                train.timetable.splice(i + 1, 0, newNode);
                return { node: newNode, index: i + 1 };
            }
        }
        return null;
    };

    let t1Info = ensureNode(conflict.t1);
    let t2Info = ensureNode(conflict.t2);

    if (!t1Info || !t2Info) return alert("Möte kan inte planeras här. Stationen ligger utanför ett av tågens rutt.");

    let t1Node = t1Info.node;
    let t2Node = t2Info.node;

    let yieldTrainIdx, yieldNode, prioNode, yieldTrObj;

    if (t1Node.arrival <= t2Node.arrival) {
        yieldTrainIdx = conflict.t1; yieldNode = t1Node; prioNode = t2Node; yieldTrObj = state.trains[conflict.t1];
    } else {
        yieldTrainIdx = conflict.t2; yieldNode = t2Node; prioNode = t1Node; yieldTrObj = state.trains[conflict.t2];
    }

    let newDeparture = Math.max(yieldNode.departure, Math.ceil(prioNode.departure));
    let diff = newDeparture - yieldNode.departure;
    
    if (diff > 0) {
        yieldNode.departure = newDeparture;
        let yIndex = yieldTrObj.timetable.indexOf(yieldNode);
        for (let k = yIndex + 1; k < yieldTrObj.timetable.length; k++) {
            yieldTrObj.timetable[k].arrival += diff;
            yieldTrObj.timetable[k].departure += diff;
        }
    }

    state.selectedTrainIndex = yieldTrainIdx;
    state.activeNode = { trainIndex: yieldTrainIdx, nodeIndex: yieldTrObj.timetable.indexOf(yieldNode), type: 'departure' };
    
    saveTrainsToDatabase();
    state.needsRedraw = true;
    state.needsSidebarUpdate = true;
}

// ==========================================
// FUNKTIONER FÖR ARBETSMEDALEN OCH SIDOMENYN
// ==========================================
function updateWorkAreaDisplay() {
    const startIdx = parseInt(document.getElementById('workStartStation').value);
    const endIdx = parseInt(document.getElementById('workEndStation').value);
    const incStart = document.getElementById('incStart').value === 'true';
    const incEnd = document.getElementById('incEnd').value === 'true';
    
    if (isNaN(startIdx) || isNaN(endIdx) || !state.stations[startIdx] || !state.stations[endIdx]) return;

    let startSign = state.stations[startIdx].sign;
    let endSign = state.stations[endIdx].sign;
    let startName = state.stations[startIdx].name;
    let endName = state.stations[endIdx].name;

    let sTextSign = incStart ? startSign : `(${startSign})`;
    let eTextSign = incEnd ? endSign : `(${endSign})`;
    let sTextName = incStart ? startName : `(${startName})`;
    let eTextName = incEnd ? endName : `(${endName})`;

    if (startIdx === endIdx && incStart && incEnd) {
        document.getElementById('workAreaDisplay').textContent = startSign;
        document.getElementById('workBlockedArea').value = startName;
    } else {
        document.getElementById('workAreaDisplay').textContent = `${sTextSign} - ${eTextSign}`;
        document.getElementById('workBlockedArea').value = `${sTextName}-${eTextName}`;
    }
}

function getFormMinutes(timeId) {
    const timeEl = document.getElementById(timeId);
    if (!timeEl || !timeEl.value) return NaN;
    const parts = timeEl.value.split(':');
    return (parseInt(parts[0], 10) * 60) + parseInt(parts[1], 10);
}

function setWorkBounds(sIdx, sInc, eIdx, eInc) {
    document.getElementById('workStartStation').value = sIdx;
    document.getElementById('incStart').value = sInc;
    document.getElementById('workEndStation').value = eIdx;
    document.getElementById('incEnd').value = eInc;
    updateWorkAreaDisplay();
}

function getBoundVal(sIdx, sInc, isLeft) {
    return isLeft ? sIdx + (sInc ? 0 : 0.5) : sIdx - (sInc ? 0 : 0.5);
}

async function saveMtoWork(status) {
    const workType = document.getElementById('workType').value;
    const rawLabel = document.getElementById('workLabel').value;
    const trainRef = document.getElementById('workTrainReference')?.value || '';
    
    let startTime = getFormMinutes('workStartTime'); 
    let endTime = getFormMinutes('workEndTime');
    if(isNaN(startTime)) startTime = state.currentRealMinutes;
    if(isNaN(endTime)) endTime = state.currentRealMinutes + 60;

    const existingWork = state.editingWorkId ? state.trackWorks.find(w => w.id === state.editingWorkId) : null;
    if (status === 'Startad' && (!existingWork || existingWork.status !== 'Startad')) startTime = state.currentRealMinutes;
    if (status === 'Avslutad' && (!existingWork || existingWork.status !== 'Avslutad')) endTime = state.currentRealMinutes;

    let displayLabel = rawLabel || workType;
    if (workType === 'Efter tåg' && trainRef) displayLabel = `Efter tåg ${trainRef}: ${rawLabel}`;

    const newWork = {
        id: state.editingWorkId || Date.now().toString(), 
        graph_id: state.activeGraphId,
        type: workType,
        label: displayLabel, 
        status: status,
        start_time: Math.round(startTime), 
        end_time: Math.round(endTime), 
        start_station: parseInt(document.getElementById('workStartStation').value), 
        end_station: parseInt(document.getElementById('workEndStation').value),
        inc_start: document.getElementById('incStart').value === 'true',
        inc_end: document.getElementById('incEnd').value === 'true',
        track: document.getElementById('workTrack').value || '',
        end_place: document.getElementById('workEndPlace').value || '',
        bounds: document.getElementById('workBounds').value || '', 
        blocked_area: document.getElementById('workBlockedArea').value || '',
        switches: document.getElementById('workSwitches').value || '',
        consultation: document.getElementById('workConsultation').value || '',
        contact_name: document.getElementById('workContactName').value || '', 
        contact_phone: document.getElementById('workContactPhone').value || '', 
        details_text: document.getElementById('workDetails').value || ''
    };
    
    try {
        const response = await fetch('/api/works', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
            body: JSON.stringify(newWork)
        });
        if (response.ok) {
            await loadWorksFromDatabase();
            document.getElementById('workModal').style.display = 'none'; 
            state.needsRedraw = true;
            state.needsSidebarUpdate = true;
        } else {
            const errData = await response.json();
            alert("Fel vid sparande: " + errData.error);
        }
    } catch (error) { console.error("Kunde inte spara:", error); }
}

function renderSidebar() {
    const container = document.getElementById('workInfo'); 
    if(!container) return;
    
    if (state.selectedTrainIndex !== null) {
        const tr = state.trains[state.selectedTrainIndex];
        container.innerHTML = `
            <div class="work-card selected" style="border-left-color: #33ccff; margin-bottom: 15px;">
                <div class="work-card-header"><div class="work-card-title"><span>Tåg ${tr.id}</span></div><div class="work-card-meta">Vald i grafen</div></div>
                <div class="work-card-body">
                    <p style="font-size:0.85em; color:#c1c2c5;">
                        • <strong>Klicka på en ring</strong> för att låsa scrollen till den (lyser vitt) och rulla sedan på mushjulet för att justera tider.<br>
                        • <strong>Klicka på tåglinjen</strong> vid en station för att skapa ett uppehåll.<br>
                        • <strong>Dra en röd varningsring</strong> till en driftplats för att planera ett möte!
                    </p>
                    <button class="sidebar-btn full-width" style="border-color:#33ccff; color:#33ccff; margin-top:5px;" onclick="window.location.href='timetable.html'">✏️ Ändra i tabell-vy</button>
                    <button class="sidebar-btn full-width" style="border-color:#f09170; color:#f09170; margin-top:5px;" onclick="window.deleteSelectedTrain()">🗑️ Ta bort tåg</button>
                </div>
            </div>
        `;
        return;
    }

    if (state.trackWorks.length === 0) {
        container.innerHTML = '<p style="color:#5c5f66; font-size:0.9em;">Inga anordningar uppritade. Dra en ruta i grafen.</p>';
        return;
    }

    // Dela upp arbetena i "Aktiva" och "Avslutade"
    const activeWorks = state.trackWorks.filter(w => w.status !== 'Avslutad');
    const finishedWorks = state.trackWorks.filter(w => w.status === 'Avslutad');

    let html = `<div class="work-list">`;

    // Hjälpfunktion för att bygga HTML-kortet för varje arbete
    const buildCard = (work) => {
        let color = work.status === 'Planerad' ? '#ffd700' : (work.status === 'Avslutad' ? '#666666' : '#ff4d4d'); 
        let isExpanded = work.id === state.expandedWorkId;
        
        return `
            <div class="work-card ${isExpanded ? 'selected' : ''}" style="border-left-color: ${color}">
                <div class="work-card-header" onclick="window.toggleWork('${work.id}')">
                    <div class="work-card-title"><span>${work.label || 'Ny anordning'}</span> <span style="color:${color}">${work.status.charAt(0)}</span></div>
                    <div class="work-card-meta">${work.blockedArea || '?'} | ${formatTime(work.startTime).trim()} - ${formatTime(work.endTime).trim()}</div>
                </div>
                ${isExpanded ? `
                <div class="work-card-body">
                    <div class="work-card-detail">
                        <strong>Spår:</strong> ${work.track || '-'}<br>
                        <strong>Växlar:</strong> ${work.switches || '-'}<br>
                        <strong>Samråd:</strong> ${work.consultation || '-'}<br>
                        <strong>Kontakt:</strong> ${work.contactName || '-'} ${work.contactPhone ? '(' + work.contactPhone + ')' : ''}<br>
                        <strong>Info:</strong> ${work.detailsText || '-'}
                    </div>
                    <button class="sidebar-btn full-width" style="border-color:#33ccff; color:#33ccff; margin-bottom:5px;" onclick="window.editWork('${work.id}')">✏️ Redigera / Ändra tid</button>
                    <button class="sidebar-btn full-width" style="border-color:#ff4d4d; color:#ff4d4d;" onclick="window.deleteWork('${work.id}')">🗑️ Ta bort anordning</button>
                </div>` : ''}
            </div>`;
    };

    // Rendera Planerade och Startade arbeten först
    activeWorks.forEach(work => { html += buildCard(work); });

    // Rendera Avslutade arbeten längst ner
    if (finishedWorks.length > 0) {
        if (activeWorks.length > 0) {
            html += `<div style="margin: 15px 0 10px 0; border-bottom: 1px solid #3f4147;"></div>`;
        }
        html += `<div style="font-size: 0.8em; color: #888; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px;">Avslutade anordningar</div>`;
        finishedWorks.forEach(work => { html += buildCard(work); });
    }

    html += `</div>`;
    container.innerHTML = html;
}

// ==========================================
// KNYT IHOP ALLA HÄNDELSER & RENDER LOOP
// ==========================================
export function setupUI() {
    window.toggleWork = function(id) {
        state.expandedWorkId = state.expandedWorkId === id ? null : id;
        state.needsRedraw = true;
        state.needsSidebarUpdate = true;
    };

    window.editWork = function(id) {
        const work = state.trackWorks.find(w => w.id === id);
        if(!work) return;
        state.editingWorkId = id;
        
        document.getElementById('workType').value = work.type || 'A-s';
        document.getElementById('workLabel').value = work.label || '';
        document.getElementById('workStartStation').value = work.startStation;
        document.getElementById('workEndStation').value = work.endStation;
        document.getElementById('incStart').value = work.incStart;
        document.getElementById('incEnd').value = work.incEnd;
        
        const setFormTime = (totalMins, timeId) => {
            let m = Math.floor(((totalMins % 60) + 60) % 60), h = Math.floor(totalMins / 60);
            document.getElementById(timeId).value = `${(((h % 24) + 24) % 24).toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        };
        setFormTime(work.startTime, 'workStartTime');
        setFormTime(work.endTime, 'workEndTime');
        
        document.getElementById('workTrack').value = work.track || '';
        document.getElementById('workEndPlace').value = work.endPlace || '';
        document.getElementById('workBlockedArea').value = work.blockedArea || '';
        document.getElementById('workSwitches').value = work.switches || '';
        document.getElementById('workConsultation').value = work.consultation || '';
        document.getElementById('workContactName').value = work.contactName || '';
        document.getElementById('workContactPhone').value = work.contactPhone || '';
        document.getElementById('workDetails').value = work.detailsText || '';
        
        updateWorkAreaDisplay();
        document.getElementById('workModal').style.display = 'flex';
    };

    window.deleteWork = async function(id) {
        if(confirm('Vill du ta bort anordningen?')) {
            await deleteWorkFromDatabase(id);
            await loadWorksFromDatabase(); 
            state.expandedWorkId = null;
            state.needsRedraw = true;
            state.needsSidebarUpdate = true;
        }
    };

    window.deleteSelectedTrain = function() {
        if(confirm('Vill du radera det valda tåget?')) {
            state.trains.splice(state.selectedTrainIndex, 1);
            state.selectedTrainIndex = null;
            state.activeNode = null;
            saveTrainsToDatabase();
            state.needsRedraw = true;
            state.needsSidebarUpdate = true;
        }
    };

    const scrollContainer = document.getElementById('scrollContainer');
    const scrollContent = document.getElementById('scrollContent');

    const planWorkBtn = document.getElementById('planWorkBtn');
    if (planWorkBtn) planWorkBtn.onclick = () => saveMtoWork('Planerad');
    
    const startWorkBtn = document.getElementById('startWorkBtn');
    if (startWorkBtn) startWorkBtn.onclick = () => saveMtoWork('Startad');
    
    const finishWorkBtn = document.getElementById('finishWorkBtn');
    if (finishWorkBtn) finishWorkBtn.onclick = () => saveMtoWork('Avslutad');
    
    const cancelWorkBtn = document.getElementById('cancelWorkBtn');
    if (cancelWorkBtn) cancelWorkBtn.onclick = () => {
        document.getElementById('workModal').style.display = 'none';
        state.needsRedraw = true;
    };

    const btnExpandLeft = document.getElementById('btnExpandLeft');
    if (btnExpandLeft) btnExpandLeft.onclick = () => {
        let sIdx = parseInt(document.getElementById('workStartStation').value);
        let sInc = document.getElementById('incStart').value === 'true';
        if (!sInc) { sInc = true; setWorkBounds(sIdx, sInc, parseInt(document.getElementById('workEndStation').value), document.getElementById('incEnd').value === 'true'); } 
        else if (sIdx > 0) { sIdx--; sInc = false; setWorkBounds(sIdx, sInc, parseInt(document.getElementById('workEndStation').value), document.getElementById('incEnd').value === 'true'); }
    };

    const btnShrinkLeft = document.getElementById('btnShrinkLeft');
    if (btnShrinkLeft) btnShrinkLeft.onclick = () => {
        let sIdx = parseInt(document.getElementById('workStartStation').value);
        let sInc = document.getElementById('incStart').value === 'true';
        let eIdx = parseInt(document.getElementById('workEndStation').value);
        let eInc = document.getElementById('incEnd').value === 'true';
        let nextSIdx = sIdx, nextSInc = sInc;
        if (sInc) nextSInc = false; else if (sIdx < state.stations.length - 1) { nextSIdx++; nextSInc = true; }
        if (getBoundVal(nextSIdx, nextSInc, true) <= getBoundVal(eIdx, eInc, false)) setWorkBounds(nextSIdx, nextSInc, eIdx, eInc);
    };

    const btnExpandRight = document.getElementById('btnExpandRight');
    if (btnExpandRight) btnExpandRight.onclick = () => {
        let eIdx = parseInt(document.getElementById('workEndStation').value);
        let eInc = document.getElementById('incEnd').value === 'true';
        if (!eInc) { eInc = true; setWorkBounds(parseInt(document.getElementById('workStartStation').value), document.getElementById('incStart').value === 'true', eIdx, eInc); } 
        else if (eIdx < state.stations.length - 1) { eIdx++; eInc = false; setWorkBounds(parseInt(document.getElementById('workStartStation').value), document.getElementById('incStart').value === 'true', eIdx, eInc); }
    };

    const btnShrinkRight = document.getElementById('btnShrinkRight');
    if (btnShrinkRight) btnShrinkRight.onclick = () => {
        let sIdx = parseInt(document.getElementById('workStartStation').value);
        let sInc = document.getElementById('incStart').value === 'true';
        let eIdx = parseInt(document.getElementById('workEndStation').value);
        let eInc = document.getElementById('incEnd').value === 'true';
        let nextEIdx = eIdx, nextEInc = eInc;
        if (eInc) nextEInc = false; else if (eIdx > 0) { nextEIdx--; nextEInc = true; }
        if (getBoundVal(sIdx, sInc, true) <= getBoundVal(nextEIdx, nextEInc, false)) setWorkBounds(sIdx, sInc, nextEIdx, nextEInc);
    };

    window.addEventListener('resize', resizeCanvas);
    function resizeCanvas() {
        if (!canvas) return;
        canvas.width = scrollContainer.clientWidth;
        canvas.height = scrollContainer.clientHeight;
        scrollContent.style.height = ((state.viewDuration * 2) * (canvas.height / state.viewDuration)) + "px";
        updateScrollFromTime();
        state.needsRedraw = true;
    }

    scrollContainer?.addEventListener('scroll', () => {
        if (!state.isTrackingNow && !state.isDraggingNowLine) {
            const maxScroll = scrollContent.clientHeight - scrollContainer.clientHeight;
            if (maxScroll <= 0) return;
            const maxTime = state.currentRealMinutes + 48 * 60;
            const minTime = state.currentRealMinutes - 24 * 60;
            state.currentStartTime = (maxTime - state.viewDuration) - (scrollContainer.scrollTop / maxScroll) * (maxTime - minTime - state.viewDuration);
            state.needsRedraw = true;
        }
    });

    function updateScrollFromTime() {
        if (!scrollContainer) return;
        const maxScroll = scrollContent.clientHeight - scrollContainer.clientHeight;
        const maxTime = state.currentRealMinutes + 48 * 60;
        const minTime = state.currentRealMinutes - 24 * 60;
        const percentage = (maxTime - state.viewDuration - state.currentStartTime) / (maxTime - minTime - state.viewDuration);
        const tempTracking = state.isTrackingNow; 
        scrollContainer.scrollTop = percentage * maxScroll;
        state.isTrackingNow = tempTracking;
    }

    const snapBtn = document.getElementById('snapToNowBtn');
    if (snapBtn) {
        snapBtn.addEventListener('click', () => {
            state.isTrackingNow = true;
            state.currentStartTime = state.currentRealMinutes - (state.viewDuration * state.nowOffsetPercentage);
            updateScrollFromTime();
            state.needsRedraw = true;
        });
    }

    // --- STÄLL TID / SIMULERING (SKOTTSÄKER TIDSUTRÄKNING) ---
    const setSimTimeBtn = document.getElementById('setSimTimeBtn');
    const resetSimTimeBtn = document.getElementById('resetSimTimeBtn');
    const simulatedTimeInput = document.getElementById('simulatedTimeInput');

    const getSafeLocalMinutes = () => {
        const now = new Date();
        return (now.getHours() * 60) + now.getMinutes() + (now.getSeconds() / 60);
    };

    if (setSimTimeBtn && simulatedTimeInput) {
        setSimTimeBtn.addEventListener('click', () => {
            const timeVal = simulatedTimeInput.value;
            if (!timeVal) return;
            
            const parts = timeVal.split(':');
            const simMins = (parseInt(parts[0], 10) * 60) + (parts[1] ? parseInt(parts[1], 10) : 0);
            const realMins = getSafeLocalMinutes();
            
            state.simulationOffsetMinutes = simMins - realMins;
            if (resetSimTimeBtn) resetSimTimeBtn.style.display = 'inline-block';
            
            state.isTrackingNow = true;
            state.currentRealMinutes = getSafeLocalMinutes() + state.simulationOffsetMinutes;
            state.currentStartTime = state.currentRealMinutes - (state.viewDuration * state.nowOffsetPercentage);
            
            updateScrollFromTime();
            state.needsRedraw = true;
        });
    }

    if (resetSimTimeBtn) {
        resetSimTimeBtn.addEventListener('click', () => {
            state.simulationOffsetMinutes = 0;
            if (simulatedTimeInput) simulatedTimeInput.value = '';
            resetSimTimeBtn.style.display = 'none';
            
            state.isTrackingNow = true;
            state.currentRealMinutes = getSafeLocalMinutes();
            state.currentStartTime = state.currentRealMinutes - (state.viewDuration * state.nowOffsetPercentage);
            
            updateScrollFromTime();
            state.needsRedraw = true;
        });
    }

    canvas.addEventListener('mousedown', (e) => {
        if(state.stations.length === 0) return;
        const rect = canvas.getBoundingClientRect();
        state.startPos.x = e.clientX - rect.left; state.startPos.y = e.clientY - rect.top;
        
        if (Math.abs(state.startPos.y - getY(state.currentRealMinutes, canvas.height)) < 12) {
            state.isDraggingNowLine = true; state.isTrackingNow = true; canvas.style.cursor = 'ns-resize'; return; 
        }

        let hitConflict = state.conflicts.find(c => Math.hypot(state.startPos.x - c.x, state.startPos.y - c.y) < 12);
        if (hitConflict) { 
            state.draggingConflict = hitConflict; 
            canvas.style.cursor = 'move'; 
            return; 
        }

        const hNode = getHoveredNode(state.startPos.x, state.startPos.y);
        if (hNode) { state.draggingNode = hNode; state.activeNode = hNode; canvas.style.cursor = 'ns-resize'; state.needsRedraw = true; return; }
        
        const hitTrain = getHitTrainIndex(state.startPos.x, state.startPos.y);
        if (hitTrain !== null) {
            if (state.selectedTrainIndex !== hitTrain) state.needsSidebarUpdate = true;
            
            state.selectedTrainIndex = hitTrain; state.activeNode = null; state.expandedWorkId = null;
            const stIdx = getStationFromX(state.startPos.x, canvas.width);
            if (Math.abs(state.startPos.x - getX(stIdx, canvas.width)) < 15) {
                const tr = state.trains[hitTrain];
                if (!tr.timetable.find(n => n.station === stIdx)) {
                    const timeAtClick = Math.round(getTimeFromY(state.startPos.y, canvas.height));
                    tr.timetable.push({ station: stIdx, arrival: timeAtClick, departure: timeAtClick });
                    tr.timetable.sort((a, b) => a.arrival - b.arrival);
                    state.activeNode = state.draggingNode = { trainIndex: hitTrain, nodeIndex: tr.timetable.findIndex(n => n.station === stIdx), type: 'arrival' };
                    canvas.style.cursor = 'ns-resize';
                }
            }
            state.needsRedraw = true; return;
        }

        if (state.selectedTrainIndex !== null) state.needsSidebarUpdate = true;
        state.activeNode = state.selectedTrainIndex = null; 
        
        if (state.startPos.x >= margin.left && state.startPos.x <= canvas.width - margin.right && state.startPos.y >= margin.top && state.startPos.y <= canvas.height - margin.bottom) {
            state.isSelecting = true; state.currentMouseX = state.startPos.x; state.currentMouseY = state.startPos.y;
        }
        state.needsRedraw = true;
    });

    canvas.addEventListener('mousemove', (e) => {
        if(state.stations.length === 0) return;
        const rect = canvas.getBoundingClientRect();
        state.currentMouseX = e.clientX - rect.left; state.currentMouseY = e.clientY - rect.top;
        
        if (state.isDraggingNowLine) {
            const clampedY = Math.max(margin.top, Math.min(state.currentMouseY, canvas.height - margin.bottom));
            state.nowOffsetPercentage = (canvas.height - margin.bottom - clampedY) / (canvas.height - margin.top - margin.bottom);
            state.currentStartTime = state.currentRealMinutes - (state.viewDuration * state.nowOffsetPercentage);
            updateScrollFromTime(); state.needsRedraw = true; return;
        }
        
        if (state.draggingConflict) { 
            canvas.style.cursor = 'move'; 
            state.needsRedraw = true; 
            return; 
        }

        if (state.draggingNode) {
            const tr = state.trains[state.draggingNode.trainIndex], node = tr.timetable[state.draggingNode.nodeIndex];
            let newTime = Math.round(getTimeFromY(state.currentMouseY, canvas.height));

            if (state.draggingNode.type === 'arrival') {
                let minAllowedTime = state.draggingNode.nodeIndex > 0 ? tr.timetable[state.draggingNode.nodeIndex - 1].departure : -Infinity;
                node.arrival = Math.max(newTime, minAllowedTime);
                if (node.arrival > node.departure) {
                    let diff = node.arrival - node.departure; node.departure = node.arrival;
                    for (let k = state.draggingNode.nodeIndex + 1; k < tr.timetable.length; k++) { tr.timetable[k].arrival += diff; tr.timetable[k].departure += diff; }
                }
            } else {
                let diff = Math.max(newTime, node.arrival) - node.departure; node.departure += diff;
                for (let k = state.draggingNode.nodeIndex + 1; k < tr.timetable.length; k++) { tr.timetable[k].arrival += diff; tr.timetable[k].departure += diff; }
            }
            state.needsRedraw = true; return;
        }
        
        if (state.isSelecting) state.needsRedraw = true; 
    });

    canvas.addEventListener('mouseup', (e) => {
        if(state.stations.length === 0) return;
        if (state.isDraggingNowLine) { state.isDraggingNowLine = false; canvas.style.cursor = 'default'; return; }
        
        if (state.draggingConflict) {
            resolveConflict(state.draggingConflict, getStationFromX(state.currentMouseX, canvas.width));
            state.draggingConflict = null; canvas.style.cursor = 'default'; state.needsRedraw = true; return;
        }

        if (state.draggingNode) {
            state.trains[state.draggingNode.trainIndex].timetable.sort((a, b) => a.arrival - b.arrival); 
            state.draggingNode = null; canvas.style.cursor = 'default'; saveTrainsToDatabase(); state.needsRedraw = true; return;
        }

        if (!state.isSelecting) return;
        state.isSelecting = false;
        
        if (Math.abs(state.currentMouseX - state.startPos.x) > 10 || Math.abs(state.currentMouseY - state.startPos.y) > 10) {
            let minX = Math.min(state.startPos.x, state.currentMouseX);
            let maxX = Math.max(state.startPos.x, state.currentMouseX);
            
            let leftBound = getClosestBound(minX, true);
            let rightBound = getClosestBound(maxX, false);

            let lVal = leftBound.station + (leftBound.inc ? 0 : 0.5);
            let rVal = rightBound.station - (rightBound.inc ? 0 : 0.5);
            if (lVal > rVal) rightBound = leftBound; 

            document.getElementById('workStartStation').value = leftBound.station;
            document.getElementById('incStart').value = leftBound.inc;
            document.getElementById('workEndStation').value = rightBound.station;
            document.getElementById('incEnd').value = rightBound.inc;
            
            let t1 = Math.round(getTimeFromY(state.startPos.y, canvas.height)), t2 = Math.round(getTimeFromY(state.currentMouseY, canvas.height));
            const setFormTime = (totalMins, timeId) => {
                let m = Math.floor(((totalMins % 60) + 60) % 60), h = Math.floor(totalMins / 60);
                document.getElementById(timeId).value = `${(((h % 24) + 24) % 24).toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
            };
            setFormTime(Math.min(t1, t2), 'workStartTime'); 
            setFormTime(Math.max(t1, t2), 'workEndTime');
            
            ['workLabel', 'workTrainReference', 'workTrack', 'workEndPlace', 'workBounds', 'workBlockedArea', 'workSwitches', 'workDetails', 'workConsultation', 'workContactName', 'workContactPhone'].forEach(id => { 
                if(document.getElementById(id)) document.getElementById(id).value = ""; 
            });
            
            updateWorkAreaDisplay();
            state.editingWorkId = null; 
            document.getElementById('workType').value = 'A-s';
            document.getElementById('workStatusBox').textContent = 'A';
            document.getElementById('workModal').style.display = 'flex'; 
            state.needsRedraw = true; 
            return;
        }
        state.needsRedraw = true;
    });

    // NY HJUL-LOGIK (Använder Inställningar)
    canvas.addEventListener('wheel', (e) => {
        if (state.activeNode) {
            e.preventDefault();
            const timeDelta = e.deltaY < 0 ? state.nodeStepMinutes : -state.nodeStepMinutes;

            const tr = state.trains[state.activeNode.trainIndex], node = tr.timetable[state.activeNode.nodeIndex];
            if (state.activeNode.type === 'arrival') {
                let minAllowedTime = state.activeNode.nodeIndex > 0 ? tr.timetable[state.activeNode.nodeIndex - 1].departure : -Infinity;
                node.arrival = Math.max(node.arrival + timeDelta, minAllowedTime);
                if (node.arrival > node.departure) {
                    let diff = node.arrival - node.departure; node.departure = node.arrival; 
                    for (let k = state.activeNode.nodeIndex + 1; k < tr.timetable.length; k++) { tr.timetable[k].arrival += diff; tr.timetable[k].departure += diff; }
                }
            } else {
                let diff = Math.max(node.arrival, node.departure + timeDelta) - node.departure; node.departure += diff;
                for (let k = state.activeNode.nodeIndex + 1; k < tr.timetable.length; k++) { tr.timetable[k].arrival += diff; tr.timetable[k].departure += diff; }
            }
            state.needsRedraw = true; debouncedSave(); return;
        }

        e.preventDefault(); 
        state.isTrackingNow = false; 
        
        const timeChange = e.deltaY > 0 ? -state.scrollMinutes : state.scrollMinutes;

        const maxTime = state.currentRealMinutes + 48 * 60;
        const minTime = state.currentRealMinutes - 24 * 60;
        
        state.currentStartTime += timeChange;
        state.currentStartTime = Math.max(minTime, Math.min(maxTime - state.viewDuration, state.currentStartTime));
        
        updateScrollFromTime();
        state.needsRedraw = true;
    });

    setInterval(() => {
        const realMins = getSafeLocalMinutes();
        state.currentRealMinutes = realMins + state.simulationOffsetMinutes;
        
        if (state.isTrackingNow) {
            state.currentStartTime = state.currentRealMinutes - (state.viewDuration * state.nowOffsetPercentage);
            updateScrollFromTime();
        }
        state.needsRedraw = true; 
    }, 1000);

    function renderLoop() {
        if (state.needsRedraw) {
            drawGraph();
            state.needsRedraw = false;
        }
        
        if (state.needsSidebarUpdate) {
            renderSidebar();
            state.needsSidebarUpdate = false;
        }
        
        requestAnimationFrame(renderLoop);
    }

    setTimeout(resizeCanvas, 50);
    requestAnimationFrame(renderLoop);
}
