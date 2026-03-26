import { state, getAbsoluteMinutes } from './state.js';
import { getY, getTimeFromY, getX, margin, getStationFromX } from './math.js';
import { canvas, drawGraph, getNodeX } from './canvas.js';
import { saveTrainsToDatabase, debouncedSave, loadWorksFromDatabase } from './api.js';

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
}

// ==========================================
// FUNKTIONER FÖR ARBETSMEDALEN
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
    return (parseInt(parts[0]) * 60) + parseInt(parts[1]);
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

// Den funktion som faktiskt kommunicerar med ditt API för att spara!
async function saveMtoWork(status) {
    const workType = document.getElementById('workType').value;
    const rawLabel = document.getElementById('workLabel').value;
    const trainRef = document.getElementById('workTrainReference').value;
    
    let startTime = getFormMinutes('workStartTime'); 
    let endTime = getFormMinutes('workEndTime');
    
    if(isNaN(startTime)) startTime = state.currentRealMinutes;
    if(isNaN(endTime)) endTime = state.currentRealMinutes + 60;

    const existingWork = state.editingWorkId ? state.trackWorks.find(w => w.id === state.editingWorkId) : null;
    if (status === 'Startad' && (!existingWork || existingWork.status !== 'Startad')) startTime = state.currentRealMinutes;
    if (status === 'Avslutad' && (!existingWork || existingWork.status !== 'Avslutad')) endTime = state.currentRealMinutes;
    
    let displayLabel = rawLabel ? `${workType}: ${rawLabel}` : workType;
    if (workType === 'Efter tåg' && trainRef) displayLabel = `Efter tåg ${trainRef}: ${rawLabel}`;

    const newWork = {
        id: state.editingWorkId || Date.now().toString(), 
        graph_id: state.activeGraphId,
        label: displayLabel, 
        type: workType, 
        rawLabel: rawLabel, 
        trainReference: trainRef,
        status: status,
        startStation: parseInt(document.getElementById('workStartStation').value), 
        endStation: parseInt(document.getElementById('workEndStation').value),
        incStart: document.getElementById('incStart').value === 'true',
        incEnd: document.getElementById('incEnd').value === 'true',
        startTime: startTime, 
        endTime: endTime, 
        track: document.getElementById('workTrack').value,
        endPlace: document.getElementById('workEndPlace').value,
        bounds: document.getElementById('workBounds').value, 
        blockedArea: document.getElementById('workBlockedArea').value,
        switches: document.getElementById('workSwitches').value,
        consultation: document.getElementById('workConsultation').value,
        contactName: document.getElementById('workContactName').value, 
        contactPhone: document.getElementById('workContactPhone').value, 
        detailsText: document.getElementById('workDetails').value
    };
    
    try {
        await fetch('/api/works', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.token}`
            },
            body: JSON.stringify(newWork)
        });
        
        await loadWorksFromDatabase();
        document.getElementById('workModal').style.display = 'none'; 
        state.needsRedraw = true;
    } catch (error) {
        console.error("Kunde inte spara:", error);
        alert("Något gick snett när datan skulle sparas till molnet.");
    }
}


// ==========================================
// KNYT IHOP ALLA HÄNDELSER
// ==========================================
export function setupUI() {
    const scrollContainer = document.getElementById('scrollContainer');
    const scrollContent = document.getElementById('scrollContent');

    // -- KOPPLA KNAPPAR FÖR BANARBETEN --
    const planWorkBtn = document.getElementById('planWorkBtn');
    if (planWorkBtn) planWorkBtn.onclick = () => saveMtoWork('Planerad');
    
    const startWorkBtn = document.getElementById('startWorkBtn');
    if (startWorkBtn) startWorkBtn.onclick = () => saveMtoWork('Startad');
    
    const finishWorkBtn = document.getElementById('finishWorkBtn');
    if (finishWorkBtn) finishWorkBtn.onclick = () => saveMtoWork('Avslutad');
    
    const cancelWorkBtn = document.getElementById('cancelWorkBtn');
    if (cancelWorkBtn) cancelWorkBtn.onclick = () => document.getElementById('workModal').style.display = 'none';

    // -- KOPPLA PIL-KNAPPARNA I MODALEN --
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


    // -- SCROLL OCH FÖNSTER --
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


    // -- MUSHÄNDELSER PÅ GRAFEN --
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
        
        // Öppna arbetsmodalen
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
            
            updateWorkAreaDisplay(); // VIKTIG: Denna saknades och skapade fel förut!
            
            state.editingWorkId = null; 
            document.getElementById('workType').value = 'A-s';
            document.getElementById('workStatusBox').textContent = 'A';
            document.getElementById('workModal').style.display = 'flex'; 
            state.needsRedraw = true; 
            return;
        }
        state.needsRedraw = true;
    });

    canvas.addEventListener('wheel', (e) => {
        const timeDelta = e.deltaY < 0 ? 2 : -2; 
        if (state.activeNode) {
            e.preventDefault();
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
        scrollContainer.scrollTop += e.deltaY; 
        
        const maxScroll = scrollContent.clientHeight - scrollContainer.clientHeight;
        const maxTime = state.currentRealMinutes + 48 * 60;
        const minTime = state.currentRealMinutes - 24 * 60;
        state.currentStartTime = (maxTime - state.viewDuration) - (scrollContainer.scrollTop / maxScroll) * (maxTime - minTime - state.viewDuration);
        state.needsRedraw = true;
    });

    setInterval(() => {
        state.currentRealMinutes = getAbsoluteMinutes();
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
        requestAnimationFrame(renderLoop);
    }

    setTimeout(resizeCanvas, 50);
    requestAnimationFrame(renderLoop);
}
