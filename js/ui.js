import { state, getAbsoluteMinutes } from './state.js';
import { getY, getTimeFromY, getX, margin } from './math.js';
import { canvas, drawGraph, getNodeX } from './canvas.js';
import { saveTrainsToDatabase, debouncedSave } from './api.js';

// --- Nödvändiga matte-funktioner för musen ---
function getStationFromX(x) {
    if (state.stations.length === 0) return 0;
    let closestIndex = 0, minDistance = Infinity;
    for (let i = 0; i < state.stations.length; i++) {
        const dist = Math.abs(getX(i, canvas.width) - x);
        if (dist < minDistance) { minDistance = dist; closestIndex = i; }
    }
    return closestIndex;
}

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

export function setupUI() {
    const scrollContainer = document.getElementById('scrollContainer');
    const scrollContent = document.getElementById('scrollContent');

    window.addEventListener('resize', resizeCanvas);
    function resizeCanvas() {
        if (!canvas) return;
        canvas.width = scrollContainer.clientWidth;
        canvas.height = scrollContainer.clientHeight;
        scrollContent.style.height = ((state.viewDuration * 2) * (canvas.height / state.viewDuration)) + "px";
        updateScrollFromTime();
        state.needsRedraw = true;
    }

    // Scroll med rullist
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

    // --- MUSHÄNDELSER (Dra arbeten och scrolla med mushjul) ---
    canvas.addEventListener('mousedown', (e) => {
        if(state.stations.length === 0) return;
        const rect = canvas.getBoundingClientRect();
        state.startPos.x = e.clientX - rect.left; state.startPos.y = e.clientY - rect.top;
        
        if (Math.abs(state.startPos.y - getY(state.currentRealMinutes, canvas.height)) < 12) {
            state.isDraggingNowLine = true; state.isTrackingNow = true; canvas.style.cursor = 'ns-resize'; return; 
        }

        const hNode = getHoveredNode(state.startPos.x, state.startPos.y);
        if (hNode) { state.draggingNode = hNode; state.activeNode = hNode; canvas.style.cursor = 'ns-resize'; state.needsRedraw = true; return; }
        
        const hitTrain = getHitTrainIndex(state.startPos.x, state.startPos.y);
        if (hitTrain !== null) {
            state.selectedTrainIndex = hitTrain; state.activeNode = null; state.expandedWorkId = null;
            const stIdx = getStationFromX(state.startPos.x);
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
        
        if (state.draggingNode) {
            state.trains[state.draggingNode.trainIndex].timetable.sort((a, b) => a.arrival - b.arrival); 
            state.draggingNode = null; canvas.style.cursor = 'default'; saveTrainsToDatabase(); state.needsRedraw = true; return;
        }

        if (!state.isSelecting) return;
        state.isSelecting = false;
        
        // Öppna arbetsmodalen när man dragit en ruta
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
            
            state.editingWorkId = null; 
            document.getElementById('workType').value = 'A-s';
            document.getElementById('workStatusBox').textContent = 'A';
            document.getElementById('workModal').style.display = 'flex'; 
            state.needsRedraw = true; 
            return;
        }
        state.needsRedraw = true;
    });

    // Scrolla med mushjul
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

    // Starta ritslingan
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
