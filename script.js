// ==========================================
// GLOBALA VARIABLER OCH DOM-REFERENSER
// ==========================================
const scrollContainer = document.getElementById('scrollContainer');
const scrollContent = document.getElementById('scrollContent');
const canvas = document.getElementById('trainGraph');
const ctx = canvas.getContext('2d');

const margin = { top: 40, bottom: 60, left: 60, right: 40 };

const theme = {
    grid: '#3f4147',          
    timeLabel: '#888888',     
    stationLabel: '#888888',
    trainLine: '#eed57e',      
    trainNumber: '#ffffff',
    nowLine: '#ff6b6b',       
    simLine: '#e67e22',       
    selectionFill: 'rgba(51, 204, 255, 0.15)', 
    selectionStroke: 'rgba(51, 204, 255, 0.7)'
};

let simulationOffsetMinutes = 0; 
let currentRealMinutes = getAbsoluteMinutes();
const baseTime = currentRealMinutes; 
const minTime = baseTime - 24 * 60; 
const maxTime = baseTime + 48 * 60; 
const totalTimelineMinutes = maxTime - minTime; 
const viewDuration = 120; 

let isTrackingNow = true; 
let nowOffsetPercentage = 0.3; 
let currentStartTime = currentRealMinutes - (viewDuration * nowOffsetPercentage);

let needsRedraw = true; 

// OBS: Graferna läses fortfarande från localStorage tills vi bygger om admin.js
let savedGraphs = JSON.parse(localStorage.getItem('mto_graphs')) || [];
if (savedGraphs.length === 0) {
    savedGraphs = [{
        id: "default",
        name: "Exempelsträcka",
        stations: [
            { name: 'Vännäs', sign: 'Vän', km: 870.5 },
            { name: 'Tvärålund', sign: 'Två', km: 890.2 },
            { name: 'Vindeln', sign: 'Vdn', km: 902.1 }
        ]
    }];
    localStorage.setItem('mto_graphs', JSON.stringify(savedGraphs));
}

let activeGraphId = null;
let stations = [];
let trains = [];
let trackWorks = [];

let isSelecting = false;
let isDraggingNowLine = false;
let startPos = { x: 0, y: 0 };
let currentMouseX = 0, currentMouseY = 0;
let expandedWorkId = null, editingWorkId = null;

let selectedTrainIndex = null, draggingNode = null, activeNode = null; 
let conflicts = [], conflictSegments = new Set(), draggingConflict = null;

let activeTooltipNode = null;
let tooltipHitboxes = null;

function getAbsoluteMinutes() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return ((now - startOfDay) / 60000) + simulationOffsetMinutes;
}

function loadGraphSelector() {
    const sel = document.getElementById('activeGraphSelect');
    sel.innerHTML = '';
    savedGraphs.forEach(g => {
        sel.appendChild(new Option(g.name || 'Namnlös graf', g.id));
    });
    sel.addEventListener('change', (e) => loadGraphData(e.target.value));
    loadGraphData(savedGraphs[0].id);
}

// NYTT: Ändrad till async eftersom vi nu måste vänta på databasen
async function loadGraphData(graphId) {
    activeGraphId = graphId;
    const graph = savedGraphs.find(g => g.id === graphId);
    stations = graph && graph.stations ? graph.stations.sort((a, b) => a.km - b.km) : [];
    
    // Hämta tåg och arbeten från vår nya Vercel-backend
    await loadTrainsFromDatabase(); 
    await loadWorksFromDatabase();
    
    expandedWorkId = null;
    selectedTrainIndex = null;
    activeNode = null;
    draggingConflict = null;
    activeTooltipNode = null;
    tooltipHitboxes = null;
    
    renderSidebar();
    needsRedraw = true;
}

// ==========================================
// API / DATABASHANTERING (Vercel & Neon)
// ==========================================

async function loadWorksFromDatabase() {
    if (!activeGraphId) return;
    try {
        const response = await fetch(`/api/works?graphId=${activeGraphId}`);
        if (response.ok) {
            trackWorks = await response.json();
        } else {
            trackWorks = [];
        }
    } catch (error) {
        console.error("Kunde inte hämta arbeten:", error);
        trackWorks = [];
    }
}

async function loadTrainsFromDatabase() {
    if (!activeGraphId) return;
    try {
        const response = await fetch(`/api/trains?graphId=${activeGraphId}`);
        let savedDbTrains = [];
        if (response.ok) savedDbTrains = await response.json();
        
        trains = savedDbTrains.map(train => {
            let convertedTimetable = [];
            
            // Nu när databasen ger oss rena minuter, slipper vi räkna om tid!
            train.timetable.forEach(stop => {
                let stIdx = stations.findIndex(s => s.sign === stop.stationSign);
                if (stIdx !== -1) {
                    convertedTimetable.push({ 
                        station: stIdx, 
                        arrival: stop.arrival, 
                        departure: stop.departure 
                    });
                }
            });
            
            convertedTimetable.sort((a, b) => a.arrival - b.arrival);
            
            // Snygga till datumet om Postgres skickar med en tidszon (t.ex. 2026-03-26T00:00:00.000Z)
            let sDate = train.startDate ? train.startDate.split('T')[0] : "";
            
            return { id: train.id, startDate: sDate, timetable: convertedTimetable };
        }).filter(t => t.timetable.length >= 2);

    } catch (error) {
        console.error("Kunde inte hämta tåg:", error);
        trains = [];
    }
}

async function saveTrainsToDatabase() {
    if (!activeGraphId) return;
    
    let exportTrains = trains.map(train => {
        let exportTimetable = train.timetable.map(node => {
            return {
                stationSign: stations[node.station].sign,
                arrival: node.arrival,     // Skickar rena minuter (Integer) till databasen
                departure: node.departure  // Skickar rena minuter (Integer) till databasen
            };
        });
        
        return { id: train.id, startDate: train.startDate, timetable: exportTimetable };
    });
    
    try {
        await fetch('/api/trains', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ graphId: activeGraphId, trains: exportTrains })
        });
    } catch (error) {
        console.error("Kunde inte spara tåg:", error);
    }
}

let saveDbTimeout;
function debouncedSave() {
    clearTimeout(saveDbTimeout);
    saveDbTimeout = setTimeout(saveTrainsToDatabase, 500);
}

// ==========================================
// RENDERINGS-LOOP OCH TIDSHANTERING
// ==========================================
setInterval(() => {
    currentRealMinutes = getAbsoluteMinutes();
    if (isTrackingNow) {
        currentStartTime = currentRealMinutes - (viewDuration * nowOffsetPercentage);
        updateScrollFromTime();
    }
    needsRedraw = true; 
}, 1000);

function renderLoop() {
    if (needsRedraw) {
        drawGraph();
        needsRedraw = false;
    }
    requestAnimationFrame(renderLoop);
}

function formatTime(totalMinutes) {
    let m = Math.floor(((totalMinutes % 60) + 60) % 60);
    let h = Math.floor(totalMinutes / 60);
    let displayH = ((h % 24) + 24) % 24;
    let dayOffset = Math.floor(h / 24);
    let dayStr = dayOffset > 0 ? `(+${dayOffset}d) ` : (dayOffset < 0 ? `(${dayOffset}d) ` : "");
    return dayStr + `${displayH.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

window.addEventListener('resize', resizeCanvas);
function resizeCanvas() {
    canvas.width = scrollContainer.clientWidth;
    canvas.height = scrollContainer.clientHeight;
    scrollContent.style.height = (totalTimelineMinutes * (canvas.height / viewDuration)) + "px";
    updateScrollFromTime();
    needsRedraw = true;
}

scrollContainer.addEventListener('scroll', () => {
    if (!isTrackingNow && !isDraggingNowLine) {
        const maxScroll = scrollContent.clientHeight - scrollContainer.clientHeight;
        if (maxScroll <= 0) return;
        currentStartTime = (maxTime - viewDuration) - (scrollContainer.scrollTop / maxScroll) * (maxTime - minTime - viewDuration);
        needsRedraw = true;
    }
});

function updateScrollFromTime() {
    const maxScroll = scrollContent.clientHeight - scrollContainer.clientHeight;
    const percentage = (maxTime - viewDuration - currentStartTime) / (maxTime - minTime - viewDuration);
    const tempTracking = isTrackingNow; 
    scrollContainer.scrollTop = percentage * maxScroll;
    isTrackingNow = tempTracking;
}

// ==========================================
// MATEMATIK & KOORDINATER
// ==========================================
function getX(stationIndex) {
    if (stations.length === 0) return margin.left;
    if (stations.length === 1) return margin.left;
    const width = canvas.width - margin.left - margin.right;
    const minKm = stations[0].km;
    const maxKm = stations[stations.length - 1].km;
    const totalKm = Math.abs(maxKm - minKm);
    if (totalKm === 0) return margin.left + stationIndex * (width / (stations.length - 1));
    return margin.left + (Math.abs(stations[stationIndex].km - minKm) / totalKm * width);
}

function getStationFromX(x) {
    if (stations.length === 0) return 0;
    let closestIndex = 0, minDistance = Infinity;
    for (let i = 0; i < stations.length; i++) {
        const dist = Math.abs(getX(i) - x);
        if (dist < minDistance) { minDistance = dist; closestIndex = i; }
    }
    return closestIndex;
}

function getClosestBound(x, isLeftBound) {
    let minDiff = Infinity;
    let result = { station: 0, inc: true };

    for (let i = 0; i < stations.length; i++) {
        let sx = getX(i);
        let diff = Math.abs(x - sx);
        if (diff < minDiff) { minDiff = diff; result = { station: i, inc: true }; }

        if (i < stations.length - 1) {
            let mx = (getX(i) + getX(i+1)) / 2;
            let diffM = Math.abs(x - mx);
            if (diffM < minDiff) { 
                minDiff = diffM; 
                if (isLeftBound) {
                    result = { station: i, inc: false }; 
                } else {
                    result = { station: i + 1, inc: false }; 
                }
            }
        }
    }
    return result;
}

function updateTrainLanes() {
    for (let i = 0; i < trains.length; i++) {
        if (!trains[i].timetable) continue;
        for (let j = 0; j < trains[i].timetable.length; j++) {
            const node = trains[i].timetable[j];
            let occupiedLanes = new Set();
            for (let prevI = 0; prevI < i; prevI++) {
                if (!trains[prevI].timetable) continue;
                for (let prevJ = 0; prevJ < trains[prevI].timetable.length; prevJ++) {
                    const prevNode = trains[prevI].timetable[prevJ];
                    if (prevNode.station === node.station && prevNode.arrival <= node.departure && prevNode.departure >= node.arrival) {
                        occupiedLanes.add(prevNode._lane || 0);
                    }
                }
            }
            let lane = 0;
            while (occupiedLanes.has(lane)) lane++;
            node._lane = lane;
        }
    }
}

function getNodeX(tIndex, nIndex) {
    const node = trains[tIndex].timetable[nIndex];
    const baseX = getX(node.station);
    const lane = node._lane || 0;
    if (lane === 0) return baseX;
    const offsetAmount = 8; 
    return lane % 2 === 1 ? baseX + Math.ceil(lane / 2) * offsetAmount : baseX - (lane / 2) * offsetAmount;
}

function getY(timeInMinutes) {
    return canvas.height - margin.bottom - ((timeInMinutes - currentStartTime) / viewDuration * (canvas.height - margin.top - margin.bottom));
}

function getTimeFromY(y) {
    const height = canvas.height - margin.top - margin.bottom;
    const clampedY = Math.max(margin.top, Math.min(y, canvas.height - margin.bottom));
    return currentStartTime + ((canvas.height - margin.bottom - clampedY) / height) * viewDuration;
}

function getLineIntersection(p0_x, p0_y, p1_x, p1_y, p2_x, p2_y, p3_x, p3_y) {
    let s1_x = p1_x - p0_x, s1_y = p1_y - p0_y;
    let s2_x = p3_x - p2_x, s2_y = p3_y - p2_y;
    let denom = -s2_x * s1_y + s1_x * s2_y;
    if (denom === 0) return null; 
    let s = (-s1_y * (p0_x - p2_x) + s1_x * (p0_y - p2_y)) / denom;
    let t = ( s2_x * (p0_y - p2_y) - s2_y * (p0_x - p2_x)) / denom;
    if (s >= 0.01 && s <= 0.99 && t >= 0.01 && t <= 0.99) return { x: p0_x + (t * s1_x), y: p0_y + (t * s1_y) };
    return null;
}

function updateConflicts() {
    conflicts = [];
    conflictSegments.clear();
    for (let i = 0; i < trains.length; i++) {
        if (!trains[i].timetable || trains[i].timetable.length < 2) continue;
        
        let t1Min = trains[i].timetable[0].arrival;
        let t1Max = trains[i].timetable[trains[i].timetable.length-1].departure;
        if (t1Min > t1Max) { let tmp = t1Min; t1Min = t1Max; t1Max = tmp; }

        for (let j = 0; j < trains[i].timetable.length - 1; j++) {
            let x1_base = getX(trains[i].timetable[j].station);
            let y1 = getY(trains[i].timetable[j].departure);
            let x2_base = getX(trains[i].timetable[j+1].station);
            let y2 = getY(trains[i].timetable[j+1].arrival);
            
            for (let k = i + 1; k < trains.length; k++) {
                if (!trains[k].timetable || trains[k].timetable.length < 2) continue;
                
                let t2Min = trains[k].timetable[0].arrival;
                let t2Max = trains[k].timetable[trains[k].timetable.length-1].departure;
                if (t2Min > t2Max) { let tmp = t2Min; t2Min = t2Max; t2Max = tmp; }

                if (t1Max < t2Min || t1Min > t2Max) continue;

                for (let l = 0; l < trains[k].timetable.length - 1; l++) {
                    let x3_base = getX(trains[k].timetable[l].station);
                    let y3 = getY(trains[k].timetable[l].departure);
                    let x4_base = getX(trains[k].timetable[l+1].station);
                    let y4 = getY(trains[k].timetable[l+1].arrival);
                    
                    let intersectLogic = getLineIntersection(x1_base, y1, x2_base, y2, x3_base, y3, x4_base, y4);
                    
                    if (intersectLogic) {
                        let vx1 = getNodeX(i, j), vy1 = y1;
                        let vx2 = getNodeX(i, j+1), vy2 = y2;
                        let vx3 = getNodeX(k, l), vy3 = y3;
                        let vx4 = getNodeX(k, l+1), vy4 = y4;
                        
                        let intersectVisual = getLineIntersection(vx1, vy1, vx2, vy2, vx3, vy3, vx4, vy4);
                        let finalIntersect = intersectVisual || intersectLogic; 
                        
                        conflicts.push({ x: finalIntersect.x, y: finalIntersect.y, t1: i, seg1: j, t2: k, seg2: l });
                        conflictSegments.add(`${i}-${j}`); conflictSegments.add(`${k}-${l}`);
                    }
                }
            }
        }
    }
}

function resolveConflict(conflict, stIdx) {
    const ensureNode = (trainIdx) => {
        let train = trains[trainIdx];
        let nodeIdx = train.timetable.findIndex(n => n.station === stIdx);
        if (nodeIdx !== -1) {
            return { node: train.timetable[nodeIdx], index: nodeIdx };
        }
        
        const targetKm = stations[stIdx].km;
        for (let i = 0; i < train.timetable.length - 1; i++) {
            let km1 = stations[train.timetable[i].station].km;
            let km2 = stations[train.timetable[i+1].station].km;
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
        yieldTrainIdx = conflict.t1;
        yieldNode = t1Node;
        prioNode = t2Node;
        yieldTrObj = trains[conflict.t1];
    } else {
        yieldTrainIdx = conflict.t2;
        yieldNode = t2Node;
        prioNode = t1Node;
        yieldTrObj = trains[conflict.t2];
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

    selectedTrainIndex = yieldTrainIdx;
    activeNode = { trainIndex: yieldTrainIdx, nodeIndex: yieldTrObj.timetable.indexOf(yieldNode), type: 'departure' };
    
    saveTrainsToDatabase();
    renderSidebar();
    needsRedraw = true;
}

function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
    let l2 = (x1 - x2) ** 2 + (y1 - y2) ** 2;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

function getHitTrainIndex(mx, my) {
    let bestTrain = null, minDist = 12; 
    for (let i = 0; i < trains.length; i++) {
        if(!trains[i].timetable || trains[i].timetable.length < 2) continue;
        for (let j = 0; j < trains[i].timetable.length - 1; j++) {
            let n1 = trains[i].timetable[j], n2 = trains[i].timetable[j+1];
            let x1 = getNodeX(i, j), x2 = getNodeX(i, j+1);
            if (n1.arrival !== n1.departure && pointToSegmentDistance(mx, my, x1, getY(n1.arrival), x1, getY(n1.departure)) < minDist) { minDist = pointToSegmentDistance(mx, my, x1, getY(n1.arrival), x1, getY(n1.departure)); bestTrain = i; }
            if (pointToSegmentDistance(mx, my, x1, getY(n1.departure), x2, getY(n2.arrival)) < minDist) { minDist = pointToSegmentDistance(mx, my, x1, getY(n1.departure), x2, getY(n2.arrival)); bestTrain = i; }
        }
        let lastJ = trains[i].timetable.length-1;
        if (trains[i].timetable[lastJ].arrival !== trains[i].timetable[lastJ].departure && pointToSegmentDistance(mx, my, getNodeX(i, lastJ), getY(trains[i].timetable[lastJ].arrival), getNodeX(i, lastJ), getY(trains[i].timetable[lastJ].departure)) < minDist) bestTrain = i;
    }
    return bestTrain;
}

function getHoveredNode(mx, my) {
    if (selectedTrainIndex === null) return null;
    let bestNode = null, minDistance = 15;
    trains[selectedTrainIndex].timetable.forEach((node, j) => {
        const nx = getNodeX(selectedTrainIndex, j);
        const yArr = getY(node.arrival);
        const yDep = getY(node.departure);

        const distArr = Math.hypot(mx - nx, my - yArr);
        const distDep = Math.hypot(mx - nx, my - yDep);

        if (node.arrival === node.departure) {
            if (distArr < minDistance) {
                minDistance = distArr;
                bestNode = { trainIndex: selectedTrainIndex, nodeIndex: j, type: 'departure' };
            }
        } else {
            if (distDep < minDistance) {
                minDistance = distDep;
                bestNode = { trainIndex: selectedTrainIndex, nodeIndex: j, type: 'departure' };
            }
            if (distArr < minDistance) {
                minDistance = distArr;
                bestNode = { trainIndex: selectedTrainIndex, nodeIndex: j, type: 'arrival' };
            }
        }
    });
    return bestNode;
}

function drawNodeTooltip() {
    if (!activeTooltipNode) return;
    
    const info = activeTooltipNode;
    const arrTimeStr = formatTime(info.node.arrival).trim();
    const depTimeStr = formatTime(info.node.departure).trim();

    ctx.font = 'bold 11px system-ui, sans-serif';
    const arrWidth = ctx.measureText("Ank: " + arrTimeStr).width;
    const depWidth = ctx.measureText("Avg: " + depTimeStr).width;
    const boxW = Math.max(arrWidth, depWidth) + 20;
    const boxH = 44; 

    const boxX = info.x + 15;
    const midY = (info.yArr + info.yDep) / 2;
    const boxY = midY - boxH / 2;

    ctx.fillStyle = 'rgba(37, 38, 43, 0.95)';
    ctx.strokeStyle = '#5c5f66';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 4);
    ctx.fill();
    ctx.stroke();

    const arrRect = { x: boxX, y: boxY, w: boxW, h: 22 };
    const depRect = { x: boxX, y: boxY + 22, w: boxW, h: 22 };

    if (tooltipHitboxes && 
        currentMouseX >= arrRect.x && currentMouseX <= arrRect.x + arrRect.w && 
        currentMouseY >= arrRect.y && currentMouseY <= arrRect.y + arrRect.h) {
        ctx.fillStyle = 'rgba(51, 204, 255, 0.2)';
        ctx.beginPath(); ctx.roundRect(arrRect.x, arrRect.y, arrRect.w, arrRect.h, [4, 4, 0, 0]); ctx.fill();
    }
    if (tooltipHitboxes && 
        currentMouseX >= depRect.x && currentMouseX <= depRect.x + depRect.w && 
        currentMouseY >= depRect.y && currentMouseY <= depRect.y + depRect.h) {
        ctx.fillStyle = 'rgba(255, 107, 107, 0.2)';
        ctx.beginPath(); ctx.roundRect(depRect.x, depRect.y, depRect.w, depRect.h, [0, 0, 4, 4]); ctx.fill();
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = '#33ccff'; 
    ctx.fillText("Ank: " + arrTimeStr, arrRect.x + 10, arrRect.y + 15);
    ctx.fillStyle = '#ff6b6b'; 
    ctx.fillText("Avg: " + depTimeStr, depRect.x + 10, depRect.y + 15);

    tooltipHitboxes = { arrRect, depRect, trainIndex: info.trainIndex, nodeIndex: info.nodeIndex };
}

// ==========================================
// RITFUNKTIONER (CANVAS)
// ==========================================
function drawGraph() {
    updateTrainLanes(); 
    updateConflicts(); 

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if(stations.length === 0) return;

    drawStationLines();
    ctx.save(); ctx.beginPath(); ctx.rect(0, margin.top, canvas.width, canvas.height - margin.top - margin.bottom); ctx.clip();
    
    drawTimeLines();
    drawWorks();
    drawTrains();
    drawConflicts();
    
    if (draggingConflict) {
        ctx.beginPath(); ctx.moveTo(draggingConflict.x, draggingConflict.y); ctx.lineTo(currentMouseX, currentMouseY);
        ctx.strokeStyle = '#ff4d4d'; ctx.setLineDash([5, 5]); ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
        let stX = getX(getStationFromX(currentMouseX));
        ctx.beginPath(); ctx.moveTo(stX, margin.top); ctx.lineTo(stX, canvas.height - margin.bottom);
        ctx.strokeStyle = 'rgba(255, 77, 77, 0.3)'; ctx.lineWidth = 6; ctx.stroke();
    }
    
    if (isSelecting && !draggingConflict) {
        ctx.fillStyle = theme.selectionFill; ctx.fillRect(startPos.x, startPos.y, currentMouseX - startPos.x, currentMouseY - startPos.y);
        ctx.strokeStyle = theme.selectionStroke; ctx.lineWidth = 1; ctx.strokeRect(startPos.x, startPos.y, currentMouseX - startPos.x, currentMouseY - startPos.y);
    }
    
    ctx.save();
    ctx.textAlign = 'right';
    const wmX = canvas.width - margin.right - 20;
    const wmY = canvas.height - margin.bottom - 40;
    ctx.globalAlpha = 0.06; 
    ctx.font = '900 64px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('S K U T T', wmX, wmY); 
    ctx.globalAlpha = 0.3; 
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillStyle = theme.simLine; 
    ctx.fillText('Smart Kontrollverktyg för Uppdatering av Trassliga Tidtabeller', wmX, wmY + 20); 
    ctx.restore();

    drawNowLine();
    
    if (activeTooltipNode) {
        drawNodeTooltip();
    }
    
    ctx.restore();
    drawStationNames();
    document.getElementById('snapToNowBtn').style.opacity = isTrackingNow ? '0.5' : '1';
}

function drawStationLines() {
    ctx.lineWidth = 1; ctx.strokeStyle = theme.grid; 
    stations.forEach((st, i) => { ctx.beginPath(); ctx.moveTo(getX(i), margin.top); ctx.lineTo(getX(i), canvas.height - margin.bottom); ctx.stroke(); });
}

function drawStationNames() {
    ctx.font = '500 11px system-ui, sans-serif'; ctx.fillStyle = theme.stationLabel; ctx.textAlign = 'left';
    stations.forEach((st, i) => { ctx.save(); ctx.translate(getX(i), canvas.height - margin.bottom + 12); ctx.rotate(-Math.PI / 4); ctx.fillText(st.sign, 0, 0); ctx.restore(); });
}

function drawTimeLines() {
    ctx.lineWidth = 1; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'right';
    const startGridTime = Math.floor(currentStartTime / 10) * 10 - 10, endGridTime = currentStartTime + viewDuration + 10;
    for (let time = startGridTime; time <= endGridTime; time += 10) {
        const y = getY(time); ctx.beginPath();
        if (time % 30 === 0) { ctx.setLineDash([]); ctx.strokeStyle = theme.grid; } else { ctx.setLineDash([3, 3]); ctx.strokeStyle = '#2f3136'; }
        ctx.moveTo(margin.left, y); ctx.lineTo(canvas.width - margin.right, y); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = theme.timeLabel; ctx.fillText(formatTime(time), margin.left - 10, y + 4);
    }
}

function drawWorks() {
    const viewEnd = currentStartTime + viewDuration;
    trackWorks.forEach(work => {
        if (work.endTime < currentStartTime || work.startTime > viewEnd) return;

        let minSt = Math.min(work.startStation, work.endStation);
        let maxSt = Math.max(work.startStation, work.endStation);
        let incMin = work.startStation === minSt ? work.incStart : work.incEnd;
        let incMax = work.endStation === maxSt ? work.incEnd : work.incStart;
        
        let x1 = getX(minSt);
        let x2 = getX(maxSt);

        const yBottom = Math.max(getY(work.startTime), getY(work.endTime));
        const yTop = Math.min(getY(work.startTime), getY(work.endTime));
        const midX = (x1 + x2) / 2;
        let workColor = work.status === 'Planerad' ? '#ffd700' : (work.status === 'Avslutad' ? '#666666' : '#ff4d4d');

        if (work.id === expandedWorkId) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'; 
            let boxX = (minSt === maxSt) ? x1 - 5 : x1;
            let boxW = (minSt === maxSt) ? 10 : (x2 - x1);
            
            ctx.fillRect(boxX - 10, yTop - 10, boxW + 20, (yBottom - yTop) + 20);
            ctx.strokeStyle = workColor; 
            ctx.setLineDash([4, 4]); ctx.lineWidth = 1; 
            ctx.strokeRect(boxX - 10, yTop - 10, boxW + 20, (yBottom - yTop) + 20); 
            ctx.setLineDash([]);
        }

        ctx.beginPath(); ctx.strokeStyle = workColor; ctx.lineWidth = 2.5;
        
        if (minSt === maxSt) {
            ctx.moveTo(x1 - 5, yTop); ctx.lineTo(x1 + 5, yTop); 
            ctx.moveTo(x1 - 5, yBottom); ctx.lineTo(x1 + 5, yBottom); 
        } else {
            ctx.moveTo(x1, yTop); ctx.lineTo(x2, yTop); 
            ctx.moveTo(x1, yBottom); ctx.lineTo(x2, yBottom); 
        }

        for (let i = 0; i < stations.length; i++) {
            let sx = getX(i);
            if (sx >= x1 - 0.1 && sx <= x2 + 0.1) {
                let drawVert = true;
                if (minSt !== maxSt) {
                    if (i === minSt && !incMin) drawVert = false;
                    if (i === maxSt && !incMax) drawVert = false;
                }
                if (drawVert) {
                    ctx.moveTo(sx, yTop); ctx.lineTo(sx, yBottom);
                }
            }
            if (i < stations.length - 1) {
                let mx = (getX(i) + getX(i+1)) / 2;
                if (mx >= x1 - 0.1 && mx <= x2 + 0.1) {
                    ctx.moveTo(mx, yTop); ctx.lineTo(mx, yBottom);
                }
            }
        }
        ctx.stroke();
        
        if(work.label) {
            ctx.font = '500 11px system-ui, sans-serif'; ctx.textAlign = 'center'; const midY = (yTop + yBottom) / 2;
            ctx.save(); ctx.fillStyle = '#1a1b1e'; const txtWidth = ctx.measureText(work.label).width; ctx.fillRect(midX - txtWidth/2 - 2, midY - 14, txtWidth + 4, 16);
            ctx.fillStyle = workColor; ctx.fillText(work.label, midX, midY - 3); ctx.restore();
        }
    });
}

function drawTrains() {
    const viewEnd = currentStartTime + viewDuration;
    trains.forEach((train, i) => {
        if (!train.timetable || train.timetable.length < 2) return;
        
        let validTimes = train.timetable.flatMap(n => [n.arrival, n.departure]).filter(t => t !== null && !isNaN(t));
        if (validTimes.length === 0) return;
        
        let tMin = Math.min(...validTimes);
        let tMax = Math.max(...validTimes);

        if (tMax < currentStartTime || tMin > viewEnd) return; 

        const isSelected = (i === selectedTrainIndex);
        
        const firstNode = train.timetable[0];
        if (firstNode.arrival !== firstNode.departure) {
            ctx.beginPath(); ctx.lineWidth = isSelected ? 2.5 : 1.8; ctx.strokeStyle = isSelected ? '#33ccff' : theme.trainLine;
            ctx.moveTo(getNodeX(i, 0), getY(firstNode.arrival)); ctx.lineTo(getNodeX(i, 0), getY(firstNode.departure)); ctx.stroke();
        }
        
        for (let j = 1; j < train.timetable.length; j++) {
            const startX = getNodeX(i, j-1), startY = getY(train.timetable[j-1].departure);
            const endX = getNodeX(i, j), endY = getY(train.timetable[j].arrival);
            ctx.beginPath(); ctx.lineWidth = isSelected ? 2.5 : 1.8;
            ctx.strokeStyle = conflictSegments.has(`${i}-${j-1}`) ? '#ff4d4d' : (isSelected ? '#33ccff' : theme.trainLine);
            ctx.moveTo(startX, startY); ctx.lineTo(endX, endY); ctx.stroke();
            
            if (train.timetable[j].arrival !== train.timetable[j].departure) {
                ctx.beginPath(); ctx.strokeStyle = isSelected ? '#33ccff' : theme.trainLine;
                ctx.moveTo(endX, endY); ctx.lineTo(endX, getY(train.timetable[j].departure)); ctx.stroke();
            }
        }

        ctx.fillStyle = theme.trainNumber; ctx.font = 'bold 11px system-ui, sans-serif';
        const drawTrainId = (idx1, idx2) => {
            const x1 = getNodeX(i, idx1), x2 = getNodeX(i, idx2);
            const dx = x2 - x1, dy = getY(train.timetable[idx2].arrival) - getY(train.timetable[idx1].departure);
            let angle = Math.atan2(dy, dx); if (dx < 0) angle += Math.PI; 
            ctx.save(); ctx.translate((x1 + x2) / 2, (getY(train.timetable[idx1].departure) + getY(train.timetable[idx2].arrival)) / 2); ctx.rotate(angle);
            ctx.fillStyle = isSelected ? 'rgba(51, 204, 255, 0.2)' : 'rgba(37, 38, 43, 0.6)';
            const txtWidth = ctx.measureText(train.id).width; ctx.fillRect(-txtWidth/2 - 2, -12, txtWidth + 4, 14);
            ctx.fillStyle = isSelected ? '#33ccff' : theme.trainNumber; ctx.fillText(train.id, 0, 0); ctx.restore();
        };

        if (train.timetable.length > 5) {
            drawTrainId(0, 1);
            let midIndex = Math.floor(train.timetable.length / 2); drawTrainId(midIndex - 1, midIndex);
            drawTrainId(train.timetable.length - 2, train.timetable.length - 1);
        } else {
            let longestSeg = 0, bestI1 = 0, bestI2 = 1;
            for (let j = 0; j < train.timetable.length - 1; j++) {
                let dist = Math.pow(getNodeX(i, j+1) - getNodeX(i, j), 2) + Math.pow(getY(train.timetable[j+1].arrival) - getY(train.timetable[j].departure), 2);
                if (dist > longestSeg) { longestSeg = dist; bestI1 = j; bestI2 = j+1; }
            }
            drawTrainId(bestI1, bestI2);
        }

        if (isSelected) {
            train.timetable.forEach((node, j) => {
                const x = getNodeX(i, j), yArr = getY(node.arrival), yDep = getY(node.departure);
                const isArrActive = activeNode && activeNode.trainIndex === i && activeNode.nodeIndex === j && activeNode.type === 'arrival';
                const isDepActive = activeNode && activeNode.trainIndex === i && activeNode.nodeIndex === j && activeNode.type === 'departure';

                ctx.fillStyle = isArrActive ? '#ffffff' : '#1a1b1e'; ctx.beginPath(); ctx.arc(x, yArr, isArrActive ? 7 : 5, 0, Math.PI*2); ctx.fill();
                ctx.strokeStyle = '#33ccff'; ctx.lineWidth = isArrActive ? 3 : 2; ctx.beginPath(); ctx.arc(x, yArr, isArrActive ? 7 : 5, 0, Math.PI*2); ctx.stroke();

                if (node.arrival !== node.departure || isDepActive) {
                    ctx.fillStyle = isDepActive ? '#ffffff' : '#1a1b1e'; ctx.beginPath(); ctx.arc(x, yDep, isDepActive ? 7 : 5, 0, Math.PI*2); ctx.fill();
                    ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = isDepActive ? 3 : 2; ctx.beginPath(); ctx.arc(x, yDep, isDepActive ? 7 : 5, 0, Math.PI*2); ctx.stroke();
                }
            });
        }
    });
}

function drawConflicts() {
    conflicts.forEach(c => {
        if(c.y < margin.top || c.y > canvas.height - margin.bottom) return; 
        ctx.beginPath(); ctx.arc(c.x, c.y, 8, 0, Math.PI * 2); ctx.fillStyle = '#ff4d4d'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
        ctx.beginPath(); ctx.arc(c.x, c.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
    });
}

function drawNowLine() {
    const y = getY(currentRealMinutes);
    if (y >= margin.top && y <= canvas.height - margin.bottom) {
        const isSimulating = simulationOffsetMinutes !== 0;
        const lineColor = isSimulating ? theme.simLine : theme.nowLine;
        ctx.beginPath(); ctx.strokeStyle = lineColor; ctx.lineWidth = 2; ctx.setLineDash([10, 5]); 
        ctx.moveTo(margin.left, y); ctx.lineTo(canvas.width - margin.right, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = lineColor; ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(`${isSimulating ? "SIM-TID" : "NU"} • ${formatTime(currentRealMinutes).trim()}`, canvas.width - margin.right - 10, y - 8);
    }
}

// ==========================================
// MUSINTERAKTION
// ==========================================
canvas.addEventListener('mousedown', (e) => {
    if(stations.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    startPos.x = e.clientX - rect.left; startPos.y = e.clientY - rect.top;
    
    if (Math.abs(startPos.y - getY(currentRealMinutes)) < 12) {
        isDraggingNowLine = true; isTrackingNow = true; canvas.style.cursor = 'ns-resize'; return; 
    }

    let hitConflict = conflicts.find(c => Math.hypot(startPos.x - c.x, startPos.y - c.y) < 12);
    if (hitConflict) { 
        draggingConflict = hitConflict; 
        canvas.style.cursor = 'move'; 
        return; 
    }

    if (tooltipHitboxes) {
        if (startPos.x >= tooltipHitboxes.arrRect.x && startPos.x <= tooltipHitboxes.arrRect.x + tooltipHitboxes.arrRect.w) {
            if (startPos.y >= tooltipHitboxes.arrRect.y && startPos.y <= tooltipHitboxes.arrRect.y + tooltipHitboxes.arrRect.h) {
                draggingNode = { trainIndex: tooltipHitboxes.trainIndex, nodeIndex: tooltipHitboxes.nodeIndex, type: 'arrival' };
                activeNode = draggingNode;
                canvas.style.cursor = 'ns-resize';
                needsRedraw = true;
                return;
            }
            if (startPos.y >= tooltipHitboxes.depRect.y && startPos.y <= tooltipHitboxes.depRect.y + tooltipHitboxes.depRect.h) {
                draggingNode = { trainIndex: tooltipHitboxes.trainIndex, nodeIndex: tooltipHitboxes.nodeIndex, type: 'departure' };
                activeNode = draggingNode;
                canvas.style.cursor = 'ns-resize';
                needsRedraw = true;
                return;
            }
        }
    }

    const hNode = getHoveredNode(startPos.x, startPos.y);
    if (hNode) { draggingNode = hNode; activeNode = hNode; canvas.style.cursor = 'ns-resize'; needsRedraw = true; return; }
    
    const hitTrain = getHitTrainIndex(startPos.x, startPos.y);
    if (hitTrain !== null) {
        selectedTrainIndex = hitTrain; activeNode = null; expandedWorkId = null;
        const stIdx = getStationFromX(startPos.x);
        if (Math.abs(startPos.x - getX(stIdx)) < 15) {
            const tr = trains[hitTrain];
            if (!tr.timetable.find(n => n.station === stIdx)) {
                const timeAtClick = Math.round(getTimeFromY(startPos.y));
                tr.timetable.push({ station: stIdx, arrival: timeAtClick, departure: timeAtClick });
                tr.timetable.sort((a, b) => a.arrival - b.arrival);
                activeNode = draggingNode = { trainIndex: hitTrain, nodeIndex: tr.timetable.findIndex(n => n.station === stIdx), type: 'arrival' };
                canvas.style.cursor = 'ns-resize';
            }
        }
        renderSidebar(); needsRedraw = true; return;
    }

    activeNode = selectedTrainIndex = null; renderSidebar();
    if (startPos.x >= margin.left && startPos.x <= canvas.width - margin.right && startPos.y >= margin.top && startPos.y <= canvas.height - margin.bottom) {
        isSelecting = true; currentMouseX = startPos.x; currentMouseY = startPos.y;
    }
});

canvas.addEventListener('mousemove', (e) => {
    if(stations.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    currentMouseX = e.clientX - rect.left; currentMouseY = e.clientY - rect.top;
    
    if (isDraggingNowLine) {
        const clampedY = Math.max(margin.top, Math.min(currentMouseY, canvas.height - margin.bottom));
        nowOffsetPercentage = (canvas.height - margin.bottom - clampedY) / (canvas.height - margin.top - margin.bottom);
        currentStartTime = currentRealMinutes - (viewDuration * nowOffsetPercentage);
        updateScrollFromTime(); needsRedraw = true; return;
    }
    
    if (draggingConflict) { 
        canvas.style.cursor = 'move'; 
        needsRedraw = true; 
        return; 
    }

    if (draggingNode) {
        const tr = trains[draggingNode.trainIndex], node = tr.timetable[draggingNode.nodeIndex];
        let newTime = Math.round(getTimeFromY(currentMouseY));

        if (draggingNode.type === 'arrival') {
            let minAllowedTime = draggingNode.nodeIndex > 0 ? tr.timetable[draggingNode.nodeIndex - 1].departure : -Infinity;
            newTime = Math.max(newTime, minAllowedTime);

            node.arrival = newTime;
            
            if (node.arrival > node.departure) {
                let diff = node.arrival - node.departure; 
                node.departure = node.arrival;
                for (let k = draggingNode.nodeIndex + 1; k < tr.timetable.length; k++) { 
                    tr.timetable[k].arrival += diff; 
                    tr.timetable[k].departure += diff; 
                }
            }
        } else {
            let diff = Math.max(newTime, node.arrival) - node.departure; 
            node.departure += diff;
            
            for (let k = draggingNode.nodeIndex + 1; k < tr.timetable.length; k++) { 
                tr.timetable[k].arrival += diff; 
                tr.timetable[k].departure += diff; 
            }
        }
        needsRedraw = true; return;
    }
    
    if (!isSelecting) {
        let isInsideTooltip = false;
        
        if (tooltipHitboxes && 
            currentMouseX >= tooltipHitboxes.arrRect.x && currentMouseX <= tooltipHitboxes.arrRect.x + tooltipHitboxes.arrRect.w &&
            currentMouseY >= tooltipHitboxes.arrRect.y && currentMouseY <= tooltipHitboxes.depRect.y + tooltipHitboxes.depRect.h) {
            isInsideTooltip = true;
        }

        let foundHover = isInsideTooltip ? activeTooltipNode : null;

        if (!isInsideTooltip && selectedTrainIndex !== null && !draggingNode) {
            let minDist = 20;
            trains[selectedTrainIndex].timetable.forEach((node, j) => {
                const nx = getNodeX(selectedTrainIndex, j);
                const yArr = getY(node.arrival);
                const yDep = getY(node.departure);
                const distArr = Math.hypot(currentMouseX - nx, currentMouseY - yArr);
                const distDep = Math.hypot(currentMouseX - nx, currentMouseY - yDep);
                
                if (distArr < minDist || distDep < minDist) {
                    minDist = Math.min(distArr, distDep);
                    foundHover = { trainIndex: selectedTrainIndex, nodeIndex: j, x: nx, yArr: yArr, yDep: yDep, node: node };
                }
            });
        }

        if (activeTooltipNode !== foundHover) {
            activeTooltipNode = foundHover;
            if (!activeTooltipNode) tooltipHitboxes = null; 
            needsRedraw = true;
        }

        if (conflicts.find(c => Math.hypot(currentMouseX - c.x, currentMouseY - c.y) < 12)) canvas.style.cursor = 'move'; 
        else if (isInsideTooltip) canvas.style.cursor = 'pointer';
        else if (Math.abs(currentMouseY - getY(currentRealMinutes)) < 12) canvas.style.cursor = 'ns-resize';
        else if (getHoveredNode(currentMouseX, currentMouseY)) canvas.style.cursor = 'ns-resize';
        else if (getHitTrainIndex(currentMouseX, currentMouseY) !== null) canvas.style.cursor = 'pointer';
        else canvas.style.cursor = 'default';
    }
    
    if (isSelecting) needsRedraw = true; 
});

canvas.addEventListener('mouseup', (e) => {
    if(stations.length === 0) return;
    if (isDraggingNowLine) { isDraggingNowLine = false; canvas.style.cursor = 'default'; return; }
    
    if (draggingConflict) {
        resolveConflict(draggingConflict, getStationFromX(currentMouseX));
        draggingConflict = null; canvas.style.cursor = 'default'; needsRedraw = true; return;
    }

    if (draggingNode) {
        trains[draggingNode.trainIndex].timetable.sort((a, b) => a.arrival - b.arrival); 
        draggingNode = null; canvas.style.cursor = 'default'; saveTrainsToDatabase(); needsRedraw = true; return;
    }

    if (!isSelecting) return;
    isSelecting = false;
    
    if (Math.abs(currentMouseX - startPos.x) > 10 || Math.abs(currentMouseY - startPos.y) > 10) {
        let minX = Math.min(startPos.x, currentMouseX);
        let maxX = Math.max(startPos.x, currentMouseX);
        
        let leftBound = getClosestBound(minX, true);
        let rightBound = getClosestBound(maxX, false);

        let lVal = leftBound.station + (leftBound.inc ? 0 : 0.5);
        let rVal = rightBound.station - (rightBound.inc ? 0 : 0.5);
        if (lVal > rVal) { rightBound = leftBound; }

        document.getElementById('workStartStation').value = leftBound.station;
        document.getElementById('incStart').value = leftBound.inc;
        document.getElementById('workEndStation').value = rightBound.station;
        document.getElementById('incEnd').value = rightBound.inc;
        
        let t1 = Math.round(getTimeFromY(startPos.y)), t2 = Math.round(getTimeFromY(currentMouseY));
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
        
        editingWorkId = null; 
        document.getElementById('workType').value = 'A-s';
        document.getElementById('workTrainReference').style.display = 'none';
        document.getElementById('workStatusBox').textContent = 'A';
        document.getElementById('workModal').style.display = 'flex'; 
        needsRedraw = true; 
        return;
    }
    
    let foundWork = trackWorks.find(w => {
        let minSt = Math.min(w.startStation, w.endStation);
        let maxSt = Math.max(w.startStation, w.endStation);
        let x1 = getX(minSt);
        let x2 = getX(maxSt);
        return startPos.x >= x1 - 10 && startPos.x <= x2 + 10 && startPos.y >= Math.min(getY(w.startTime), getY(w.endTime)) && startPos.y <= Math.max(getY(w.startTime), getY(w.endTime));
    });
    expandedWorkId = foundWork ? (expandedWorkId === foundWork.id ? null : foundWork.id) : null;
    if (foundWork) { selectedTrainIndex = null; activeNode = null; }
    
    renderSidebar(); needsRedraw = true;
});

canvas.addEventListener('wheel', (e) => {
    const timeDelta = e.deltaY < 0 ? 2 : -2; 
    if (activeNode) {
        e.preventDefault();
        const tr = trains[activeNode.trainIndex], node = tr.timetable[activeNode.nodeIndex];
        
        if (activeNode.type === 'arrival') {
            let minAllowedTime = activeNode.nodeIndex > 0 ? tr.timetable[activeNode.nodeIndex - 1].departure : -Infinity;
            let targetTime = node.arrival + timeDelta;
            node.arrival = Math.max(targetTime, minAllowedTime);
            
            if (node.arrival > node.departure) {
                let diff = node.arrival - node.departure; 
                node.departure = node.arrival; 
                for (let k = activeNode.nodeIndex + 1; k < tr.timetable.length; k++) { 
                    tr.timetable[k].arrival += diff; 
                    tr.timetable[k].departure += diff; 
                }
            }
        } else {
            let diff = Math.max(node.arrival, node.departure + timeDelta) - node.departure; 
            node.departure += diff;
            for (let k = activeNode.nodeIndex + 1; k < tr.timetable.length; k++) { 
                tr.timetable[k].arrival += diff; 
                tr.timetable[k].departure += diff; 
            }
        }
        needsRedraw = true; debouncedSave(); return;
    }

    const hitTrain = getHitTrainIndex(currentMouseX, currentMouseY);
    if (hitTrain !== null && selectedTrainIndex === hitTrain) {
        e.preventDefault(); trains[hitTrain].timetable.forEach(node => { node.arrival += timeDelta; node.departure += timeDelta; });
        needsRedraw = true; debouncedSave(); return;
    }

    e.preventDefault(); isTrackingNow = false; scrollContainer.scrollTop += e.deltaY; 
    const maxScroll = scrollContent.clientHeight - scrollContainer.clientHeight;
    currentStartTime = (maxTime - viewDuration) - (scrollContainer.scrollTop / maxScroll) * (maxTime - minTime - viewDuration);
    needsRedraw = true;
});

// ==========================================
// KNAPPAR & SIDOPANEL
// ==========================================
const simTimeInput = document.getElementById('simulatedTimeInput');
const setSimTimeBtn = document.getElementById('setSimTimeBtn');
const resetSimTimeBtn = document.getElementById('resetSimTimeBtn');

function updateSimTimeInput() { const now = new Date(); simTimeInput.value = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0'); }
if(simTimeInput) updateSimTimeInput();

if(setSimTimeBtn) {
    setSimTimeBtn.addEventListener('click', () => {
        if(!simTimeInput.value) return;
        const [h, m] = simTimeInput.value.split(':').map(Number);
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        simulationOffsetMinutes = (h * 60 + m) - ((now - startOfDay) / 60000);
        currentRealMinutes = getAbsoluteMinutes(); isTrackingNow = true; currentStartTime = currentRealMinutes - (viewDuration * nowOffsetPercentage);
        updateScrollFromTime(); needsRedraw = true; resetSimTimeBtn.style.display = 'inline-block'; setSimTimeBtn.textContent = 'Uppdatera sim-tid';
    });
}

if(resetSimTimeBtn) {
    resetSimTimeBtn.addEventListener('click', () => {
        simulationOffsetMinutes = 0; currentRealMinutes = getAbsoluteMinutes(); isTrackingNow = true; currentStartTime = currentRealMinutes - (viewDuration * nowOffsetPercentage);
        updateScrollFromTime(); needsRedraw = true; updateSimTimeInput(); resetSimTimeBtn.style.display = 'none'; setSimTimeBtn.textContent = 'Ställ tid';
    });
}

const clearTrainsBtn = document.getElementById('clearTrainsBtn');
if (clearTrainsBtn) {
    clearTrainsBtn.addEventListener('click', async () => {
        if (confirm("Vill du verkligen ta bort ALLA tåg från grafen? Detta går inte att ångra.")) {
            trains = [];
            selectedTrainIndex = null;
            activeNode = null;
            await saveTrainsToDatabase();
            renderSidebar();
            needsRedraw = true;
        }
    });
}

function renderSidebar() {
    const container = document.getElementById('workInfo'); 
    if(!container) return;
    
    if (selectedTrainIndex !== null) {
        const tr = trains[selectedTrainIndex];
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
                    <button class="sidebar-btn full-width" style="border-color:#f09170; color:#f09170; margin-top:5px;" onclick="deleteSelectedTrain()">🗑️ Ta bort tåg</button>
                </div>
            </div>
        `;
        return;
    }

    if (trackWorks.length === 0) return container.innerHTML = '<p style="color:#5c5f66; font-size:0.9em;">Inga anordningar uppritade. Dra en ruta i grafen.</p>';

    let html = `<div class="work-list">`;
    trackWorks.forEach(work => {
        let color = work.status === 'Planerad' ? '#ffd700' : (work.status === 'Avslutad' ? '#666666' : '#ff4d4d'); 
        let isExpanded = work.id === expandedWorkId;
        
        html += `
            <div class="work-card ${isExpanded ? 'selected' : ''}" style="border-left-color: ${color}">
                <div class="work-card-header" onclick="toggleWork('${work.id}')">
                    <div class="work-card-title"><span>${work.label || 'Ny anordning'}</span> <span style="color:${color}">${work.status.charAt(0)}</span></div>
                    <div class="work-card-meta">${work.blockedArea || '?'} | ${formatTime(work.startTime).trim()} - ${formatTime(work.endTime).trim()}</div>
                </div>
                ${isExpanded ? `
                <div class="work-card-body">
                    <div class="work-card-detail">
                        <strong>Spår:</strong> ${work.track || '-'}<br>
                        <strong>Slutplats:</strong> ${work.endPlace || '-'}<br>
                        <strong>Gränsp.:</strong> ${work.bounds || '-'}<br>
                        <strong>Avspärrat dp:</strong> ${work.blockedArea || '-'}<br>
                        <strong>Växlar:</strong> ${work.switches || '-'}<br>
                        <strong>Samråd:</strong> ${work.consultation || '-'}<br>
                        <strong>Kontakt:</strong> ${work.contactName || '-'} ${work.contactPhone || ''}<br>
                        <strong>Övrigt:</strong> ${work.detailsText || '-'}
                    </div>
                    <div class="sidebar-btn-group">
                        ${work.status !== 'Startad' ? `<button class="sidebar-btn" style="border-color:#ff4d4d; color:#ff4d4d;" onclick="quickSetStatus('${work.id}', 'Startad')">▶ Starta</button>` : ''}
                        ${work.status !== 'Avslutad' ? `<button class="sidebar-btn" style="border-color:#888888; color:#888888;" onclick="quickSetStatus('${work.id}', 'Avslutad')">■ Avsluta</button>` : ''}
                        ${work.status !== 'Planerad' ? `<button class="sidebar-btn" style="border-color:#ffd700; color:#ffd700;" onclick="quickSetStatus('${work.id}', 'Planerad')">◷ Planera</button>` : ''}
                        <button class="sidebar-btn full-width" style="border-color:#33ccff; color:#33ccff;" onclick="openEditModal('${work.id}')">✏️ Editera info</button>
                        <button class="sidebar-btn full-width" style="border-color:#f09170; color:#f09170; margin-top:5px;" onclick="deleteWork('${work.id}')">🗑️ Ta bort</button>
                    </div>
                </div>` : ''}
            </div>
        `;
    });
    html += `</div>`;
    container.innerHTML = html;
}

window.toggleWork = (id) => { expandedWorkId = expandedWorkId === id ? null : id; renderSidebar(); needsRedraw = true; };

// NYTT: Asynkrona metoder för API
window.quickSetStatus = async (id, status) => { 
    const w = trackWorks.find(x => x.id === id); 
    if(w) { 
        if (status === 'Startad' && w.status !== 'Startad') w.startTime = currentRealMinutes; 
        if (status === 'Avslutad' && w.status !== 'Avslutad') w.endTime = currentRealMinutes; 
        w.status = status; 
        
        try {
            await fetch('/api/works', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...w, graph_id: activeGraphId })
            });
            await loadWorksFromDatabase();
            renderSidebar(); 
            needsRedraw = true; 
        } catch(e) { console.error("Kunde inte uppdatera status", e); }
    } 
};

window.deleteWork = async (id) => { 
    if(confirm("Radera anordningen?")) { 
        try {
            // Kräver att ditt API kan hantera DELETE, annars failar den tyst
            await fetch(`/api/works?id=${id}`, { method: 'DELETE' });
            await loadWorksFromDatabase();
            expandedWorkId = null; 
            renderSidebar(); 
            needsRedraw = true; 
        } catch(e) { console.error("Kunde inte radera", e); }
    } 
};

window.deleteSelectedTrain = async () => { 
    if (selectedTrainIndex !== null && confirm("Ta bort detta tåg helt?")) { 
        trains.splice(selectedTrainIndex, 1); 
        selectedTrainIndex = null; 
        activeNode = null; 
        await saveTrainsToDatabase(); 
        renderSidebar(); 
        needsRedraw = true; 
    } 
};

// ==========================================
// ARBETSMEDAL OCH FORMULÄR
// ==========================================
function setWorkBounds(sIdx, sInc, eIdx, eInc) {
    document.getElementById('workStartStation').value = sIdx;
    document.getElementById('incStart').value = sInc;
    document.getElementById('workEndStation').value = eIdx;
    document.getElementById('incEnd').value = eInc;
    updateWorkAreaDisplay();
}

function getBoundVal(sIdx, sInc, isLeft) {
    if (isLeft) return sIdx + (sInc ? 0 : 0.5);
    return sIdx - (sInc ? 0 : 0.5);
}

if(document.getElementById('btnExpandLeft')) {
    document.getElementById('btnExpandLeft').onclick = () => {
        let sIdx = parseInt(document.getElementById('workStartStation').value);
        let sInc = document.getElementById('incStart').value === 'true';
        if (!sInc) { 
            sInc = true; 
            setWorkBounds(sIdx, sInc, parseInt(document.getElementById('workEndStation').value), document.getElementById('incEnd').value === 'true');
        } else if (sIdx > 0) { 
            sIdx--; 
            sInc = false; 
            setWorkBounds(sIdx, sInc, parseInt(document.getElementById('workEndStation').value), document.getElementById('incEnd').value === 'true');
        }
    };

    document.getElementById('btnShrinkLeft').onclick = () => {
        let sIdx = parseInt(document.getElementById('workStartStation').value);
        let sInc = document.getElementById('incStart').value === 'true';
        let eIdx = parseInt(document.getElementById('workEndStation').value);
        let eInc = document.getElementById('incEnd').value === 'true';
        
        let nextSIdx = sIdx;
        let nextSInc = sInc;

        if (sInc) { nextSInc = false; }
        else if (sIdx < stations.length - 1) { nextSIdx++; nextSInc = true; }

        if (getBoundVal(nextSIdx, nextSInc, true) <= getBoundVal(eIdx, eInc, false)) {
            setWorkBounds(nextSIdx, nextSInc, eIdx, eInc);
        }
    };

    document.getElementById('btnExpandRight').onclick = () => {
        let eIdx = parseInt(document.getElementById('workEndStation').value);
        let eInc = document.getElementById('incEnd').value === 'true';
        if (!eInc) { 
            eInc = true; 
            setWorkBounds(parseInt(document.getElementById('workStartStation').value), document.getElementById('incStart').value === 'true', eIdx, eInc);
        } else if (eIdx < stations.length - 1) { 
            eIdx++; 
            eInc = false; 
            setWorkBounds(parseInt(document.getElementById('workStartStation').value), document.getElementById('incStart').value === 'true', eIdx, eInc);
        }
    };

    document.getElementById('btnShrinkRight').onclick = () => {
        let sIdx = parseInt(document.getElementById('workStartStation').value);
        let sInc = document.getElementById('incStart').value === 'true';
        let eIdx = parseInt(document.getElementById('workEndStation').value);
        let eInc = document.getElementById('incEnd').value === 'true';
        
        let nextEIdx = eIdx;
        let nextEInc = eInc;

        if (eInc) { nextEInc = false; }
        else if (eIdx > 0) { nextEIdx--; nextEInc = true; }

        if (getBoundVal(sIdx, sInc, true) <= getBoundVal(nextEIdx, nextEInc, false)) {
            setWorkBounds(sIdx, sInc, nextEIdx, nextEInc);
        }
    };
}

function updateWorkAreaDisplay() {
    const startIdx = parseInt(document.getElementById('workStartStation').value);
    const endIdx = parseInt(document.getElementById('workEndStation').value);
    const incStart = document.getElementById('incStart').value === 'true';
    const incEnd = document.getElementById('incEnd').value === 'true';
    
    if (isNaN(startIdx) || isNaN(endIdx) || !stations[startIdx] || !stations[endIdx]) return;

    let startSign = stations[startIdx].sign;
    let endSign = stations[endIdx].sign;
    let startName = stations[startIdx].name;
    let endName = stations[endIdx].name;

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

window.openEditModal = function(id) {
    const w = trackWorks.find(x => x.id === id); if(!w) return;
    editingWorkId = w.id;
    
    document.getElementById('workType').value = w.type || 'A-skydd';
    document.getElementById('workTrainReference').style.display = w.type === 'Efter tåg' ? 'block' : 'none';
    document.getElementById('workTrainReference').value = w.trainReference || '';
    document.getElementById('workLabel').value = w.rawLabel || '';
    
    const isIncStart = w.incStart !== undefined ? w.incStart : true;
    const isIncEnd = w.incEnd !== undefined ? w.incEnd : true;
    setWorkBounds(w.startStation, isIncStart, w.endStation, isIncEnd);
    
    const setFormTime = (totalMins, timeId) => {
        let m = Math.floor(((totalMins % 60) + 60) % 60), h = Math.floor(totalMins / 60);
        document.getElementById(timeId).value = `${(((h % 24) + 24) % 24).toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    };
    
    setFormTime(w.startTime, 'workStartTime'); 
    setFormTime(w.endTime, 'workEndTime');
    
    document.getElementById('workTrack').value = w.track || '';
    document.getElementById('workEndPlace').value = w.endPlace || '';
    document.getElementById('workBounds').value = w.bounds || ''; 
    document.getElementById('workBlockedArea').value = w.blockedArea || ''; 
    document.getElementById('workSwitches').value = w.switches || ''; 
    document.getElementById('workConsultation').value = w.consultation || '';
    document.getElementById('workContactName').value = w.contactName || ''; 
    document.getElementById('workContactPhone').value = w.contactPhone || '';
    document.getElementById('workDetails').value = w.detailsText || ''; 
    
    document.getElementById('workStatusBox').textContent = w.type.charAt(0).toUpperCase();
    document.getElementById('workModal').style.display = 'flex';
}

function getFormMinutes(timeId) {
    const timeEl = document.getElementById(timeId);
    if (!timeEl || !timeEl.value) return NaN;
    const parts = timeEl.value.split(':');
    return (parseInt(parts[0]) * 60) + parseInt(parts[1]);
}

if(document.getElementById('addWorkBtn')) {
    document.getElementById('addWorkBtn').onclick = () => { 
        editingWorkId = null; 
        
        ['workLabel', 'workTrainReference', 'workTrack', 'workEndPlace', 'workBounds', 'workBlockedArea', 'workSwitches', 'workDetails', 'workConsultation', 'workContactName', 'workContactPhone'].forEach(id => { 
            if(document.getElementById(id)) document.getElementById(id).value = ""; 
        }); 
        
        document.getElementById('workType').value = 'A-skydd';
        document.getElementById('workTrainReference').style.display = 'none';
        document.getElementById('workStatusBox').textContent = 'A';
        
        const now = new Date();
        const currentHHMM = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        document.getElementById('workStartTime').value = currentHHMM;
        document.getElementById('workEndTime').value = currentHHMM;
        
        document.getElementById('workModal').style.display = 'flex'; 
    };
}

if(document.getElementById('cancelWorkBtn')) document.getElementById('cancelWorkBtn').onclick = () => document.getElementById('workModal').style.display = 'none';

// NYTT: Ändrad till asynkron för att skicka JSON-data via fetch
async function saveMtoWork(status) {
    const workType = document.getElementById('workType').value;
    const rawLabel = document.getElementById('workLabel').value;
    const trainRef = document.getElementById('workTrainReference').value;
    
    let startTime = getFormMinutes('workStartTime'); 
    let endTime = getFormMinutes('workEndTime');
    
    if(isNaN(startTime)) startTime = currentRealMinutes;
    if(isNaN(endTime)) endTime = currentRealMinutes + 60;

    const existingWork = editingWorkId ? trackWorks.find(w => w.id === editingWorkId) : null;
    if (status === 'Startad' && (!existingWork || existingWork.status !== 'Startad')) startTime = currentRealMinutes;
    if (status === 'Avslutad' && (!existingWork || existingWork.status !== 'Avslutad')) endTime = currentRealMinutes;
    
    let displayLabel = rawLabel ? `${workType}: ${rawLabel}` : workType;
    if (workType === 'Efter tåg' && trainRef) displayLabel = `Efter tåg ${trainRef}: ${rawLabel}`;

    const newWork = {
        id: editingWorkId || Date.now().toString(), 
        graph_id: activeGraphId,
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newWork)
        });
        
        await loadWorksFromDatabase();
        document.getElementById('workModal').style.display = 'none'; 
        renderSidebar(); 
        needsRedraw = true;
    } catch (error) {
        console.error("Kunde inte spara:", error);
        alert("Något gick snett när datan skulle sparas till molnet.");
    }
}

if(document.getElementById('planWorkBtn')) document.getElementById('planWorkBtn').onclick = () => saveMtoWork('Planerad');
if(document.getElementById('startWorkBtn')) document.getElementById('startWorkBtn').onclick = () => saveMtoWork('Startad');
if(document.getElementById('finishWorkBtn')) document.getElementById('finishWorkBtn').onclick = () => saveMtoWork('Avslutad');
// ==========================================
// XML IMPORT OCH PARSNING (GRAF-VYN)
// ==========================================
const importXmlBtn = document.getElementById('importXmlBtn');
const xmlFileInput = document.getElementById('xmlFileInput');
if(importXmlBtn) {
    importXmlBtn.addEventListener('click', () => xmlFileInput.click());
    xmlFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader(); 
        reader.onload = (event) => { 
            parseXMLTimetable(event.target.result); 
            xmlFileInput.value = ''; 
        }; 
        reader.readAsText(file);
    });
}

async function parseXMLTimetable(xmlString) {
    try {
        const parser = new DOMParser(); 
        const xmlDoc = parser.parseFromString(xmlString, "text/xml");
        const trainNodes = xmlDoc.getElementsByTagName("Train");
        
        let isReplace = false;
        
        if (trains.length > 0) {
            isReplace = confirm("Grafen innehåller redan tåg.\n\nKlicka OK för att ERSÄTTA dem.\nKlicka Avbryt för att LÄGGA TILL utöver de gamla.");
            if (isReplace) {
                trains = []; // Töm den lokala listan
            }
        }

        let importedCount = 0;

        for (let i = 0; i < trainNodes.length; i++) {
            const tNode = trainNodes[i];
            const tId = tNode.getAttribute("id");
            const startDateAttr = tNode.getAttribute("startDate"); 
            const stopNodes = tNode.getElementsByTagName("Stop");
            
            let newTimetable = [];
            
            for (let j = 0; j < stopNodes.length; j++) {
                const sNode = stopNodes[j];
                const sign = sNode.getAttribute("sign");
                
                const stIdx = stations.findIndex(s => s.sign === sign);
                
                if (stIdx !== -1) {
                    let arrStr = sNode.getAttribute("arrival") || "";
                    let depStr = sNode.getAttribute("departure") || "";
                    
                    if (arrStr.trim() !== "" || depStr.trim() !== "") {
                        newTimetable.push({ 
                            stationSign: sign, 
                            arrival: arrStr, 
                            departure: depStr 
                        });
                    }
                }
            }
            
            // Om tåget har minst två stopp i VÅR graf lägger vi till det
            if (newTimetable.length >= 2) {
                let currentDayOffset = 0;
                let prevMinsRaw = -1;
                let convertedTimetable = [];
                let today = new Date();
                today.setHours(0,0,0,0);
                
                if (startDateAttr) {
                    let sDate = new Date(startDateAttr);
                    sDate.setHours(0,0,0,0);
                    if (!isNaN(sDate)) currentDayOffset = Math.round((sDate - today) / 86400000);
                }

                newTimetable.forEach(stop => {
                    let stIdx = stations.findIndex(s => s.sign === stop.stationSign);
                    let arrMins = null, depMins = null;
                    
                    if (stop.arrival) {
                        const [h, m] = stop.arrival.split(':').map(Number);
                        let minsRaw = h * 60 + m;
                        if (prevMinsRaw !== -1 && minsRaw < prevMinsRaw - 12 * 60) currentDayOffset++;
                        prevMinsRaw = minsRaw;
                        arrMins = minsRaw + (currentDayOffset * 24 * 60);
                    }
                    if (stop.departure) {
                        const [h, m] = stop.departure.split(':').map(Number);
                        let minsRaw = h * 60 + m;
                        if (prevMinsRaw !== -1 && minsRaw < prevMinsRaw - 12 * 60) currentDayOffset++;
                        prevMinsRaw = minsRaw;
                        depMins = minsRaw + (currentDayOffset * 24 * 60);
                    }
                    
                    convertedTimetable.push({ 
                        station: stIdx, 
                        arrival: arrMins !== null ? arrMins : depMins, 
                        departure: depMins !== null ? depMins : arrMins 
                    });
                });
                
                convertedTimetable.sort((a, b) => a.arrival - b.arrival);
                trains.push({ id: tId, startDate: startDateAttr, timetable: convertedTimetable });
                importedCount++;
            }
        }
        
        // NYTT: Spara alla tåg till Neondatabasen via vårt API!
        await saveTrainsToDatabase();
        needsRedraw = true;
        
        alert(`Klart! ${importedCount} tåg hittades för sträckan och har sparats i databasen.`);
    } catch (err) {
        alert("Kunde inte läsa XML-filen. Kontrollera formatet."); 
        console.error(err);
    }
}
// ==========================================
// UPSTART & INLOGGNING (AUTH)
// ==========================================
const authOverlay = document.getElementById('authOverlay');
const authUsername = document.getElementById('authUsername');
const authPassword = document.getElementById('authPassword');
const authMessage = document.getElementById('authMessage');

// Våra variabler för att hålla koll på inloggningen
let token = localStorage.getItem('skutt_token');
let currentUser = localStorage.getItem('skutt_user');

// 1. Kolla om vi redan är inloggade när sidan laddas
if (token) {
    authOverlay.style.display = 'none'; // Göm inloggningsrutan
    initApp(); // Starta SKUTT!
}

// 2. Lyssna på klick för Logga in / Skapa konto
if (document.getElementById('loginBtn')) {
    document.getElementById('loginBtn').addEventListener('click', () => handleAuth('login'));
    document.getElementById('registerBtn').addEventListener('click', () => handleAuth('register'));
}

async function handleAuth(action) {
    const username = authUsername.value.trim();
    const password = authPassword.value;

    if (!username || !password) {
        authMessage.style.color = '#ff6b6b';
        authMessage.textContent = 'Fyll i båda fälten.';
        return;
    }

    authMessage.style.color = '#888888';
    authMessage.textContent = 'Laddar...';

    try {
        const res = await fetch(`/api/auth?action=${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (!res.ok) {
            authMessage.style.color = '#ff6b6b';
            authMessage.textContent = data.error || 'Ett fel uppstod.';
            return;
        }

        if (action === 'register') {
            authMessage.style.color = '#33ccff';
            authMessage.textContent = 'Konto skapat! Du kan nu logga in.';
        } else if (action === 'login') {
            // Spara den hemliga biljetten (token) i webbläsaren
            localStorage.setItem('skutt_token', data.token);
            localStorage.setItem('skutt_user', data.username);
            token = data.token;
            currentUser = data.username;
            
            // Göm inloggningen och starta appen
            authOverlay.style.display = 'none';
            initApp();
        }
    } catch (err) {
        authMessage.style.color = '#ff6b6b';
        authMessage.textContent = 'Kunde inte ansluta till servern.';
    }
}

// 3. Denna funktion startar appen (ritar grafen) först när vi är inloggade
async function initApp() {
    // 1. Hämta just DINA grafer från databasen
    try {
        const res = await fetch('/api/graphs', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.ok) {
            const dbGraphs = await res.json();
            if (dbGraphs.length > 0) {
                savedGraphs = dbGraphs; // Skriv över de lokala graferna med databasens!
                localStorage.setItem('mto_graphs', JSON.stringify(savedGraphs));
            }
        }
    } catch (e) {
        console.error("Kunde inte hämta grafer från molnet", e);
    }

    // 2. Starta appen som vanligt
    if(document.getElementById('activeGraphSelect')) {
        loadGraphSelector();
        setTimeout(resizeCanvas, 50);
        requestAnimationFrame(renderLoop);
        
        const logoutBtn = document.createElement('button');
        logoutBtn.textContent = `Logga ut (${currentUser})`;
        logoutBtn.className = 'sidebar-btn';
        logoutBtn.style.position = 'absolute';
        logoutBtn.style.top = '10px';
        logoutBtn.style.right = '10px';
        logoutBtn.style.borderColor = '#ff4d4d';
        logoutBtn.style.color = '#ff4d4d';
        logoutBtn.onclick = () => {
            localStorage.removeItem('skutt_token');
            localStorage.removeItem('skutt_user');
            window.location.reload();
        };
        document.body.appendChild(logoutBtn);
    }
}
