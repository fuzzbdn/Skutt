import { state } from './state.js';
import { margin, formatTime, getX, getY } from './math.js';

export const canvas = document.getElementById('trainGraph');
export const ctx = canvas ? canvas.getContext('2d') : null;

export const theme = {
    grid: '#3f4147', timeLabel: '#888888', stationLabel: '#888888',
    trainLine: '#eed57e', trainNumber: '#ffffff',
    nowLine: '#ff6b6b', simLine: '#e67e22',
    selectionFill: 'rgba(51, 204, 255, 0.15)', selectionStroke: 'rgba(51, 204, 255, 0.7)'
};

export function getNodeX(tIndex, nIndex) {
    const node = state.trains[tIndex].timetable[nIndex];
    const baseX = getX(node.station, canvas.width);
    const lane = node._lane || 0;
    if (lane === 0) return baseX;
    return lane % 2 === 1 ? baseX + Math.ceil(lane / 2) * 8 : baseX - (lane / 2) * 8;
}

export function updateTrainLanes() {
    for (let i = 0; i < state.trains.length; i++) {
        if (!state.trains[i].timetable) continue;
        for (let j = 0; j < state.trains[i].timetable.length; j++) {
            const node = state.trains[i].timetable[j];
            let occupiedLanes = new Set();
            for (let prevI = 0; prevI < i; prevI++) {
                if (!state.trains[prevI].timetable) continue;
                for (let prevJ = 0; prevJ < state.trains[prevI].timetable.length; prevJ++) {
                    const prevNode = state.trains[prevI].timetable[prevJ];
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

export function drawGraph() {
    if (!ctx || state.stations.length === 0) return;
    updateTrainLanes(); 

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.lineWidth = 1; ctx.strokeStyle = theme.grid; 
    state.stations.forEach((st, i) => { 
        ctx.beginPath(); ctx.moveTo(getX(i, canvas.width), margin.top); ctx.lineTo(getX(i, canvas.width), canvas.height - margin.bottom); ctx.stroke(); 
    });

    ctx.save(); 
    ctx.beginPath(); ctx.rect(0, margin.top, canvas.width, canvas.height - margin.top - margin.bottom); ctx.clip();
    
    // Rita tidslinjer
    const startGridTime = Math.floor(state.currentStartTime / 10) * 10 - 10;
    const endGridTime = state.currentStartTime + state.viewDuration + 10;
    ctx.lineWidth = 1; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'right';
    for (let time = startGridTime; time <= endGridTime; time += 10) {
        const y = getY(time, canvas.height); ctx.beginPath();
        if (time % 30 === 0) { ctx.setLineDash([]); ctx.strokeStyle = theme.grid; } else { ctx.setLineDash([3, 3]); ctx.strokeStyle = '#2f3136'; }
        ctx.moveTo(margin.left, y); ctx.lineTo(canvas.width - margin.right, y); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = theme.timeLabel; ctx.fillText(formatTime(time), margin.left - 10, y + 4);
    }

    // Rita banarbeten (ÅTERSTÄLLD FUNKTION)
    const viewEnd = state.currentStartTime + state.viewDuration;
    state.trackWorks.forEach(work => {
        if (work.endTime < state.currentStartTime || work.startTime > viewEnd) return;

        let minSt = Math.min(work.startStation, work.endStation);
        let maxSt = Math.max(work.startStation, work.endStation);
        let x1 = getX(minSt, canvas.width);
        let x2 = getX(maxSt, canvas.width);
        const yBottom = Math.max(getY(work.startTime, canvas.height), getY(work.endTime, canvas.height));
        const yTop = Math.min(getY(work.startTime, canvas.height), getY(work.endTime, canvas.height));
        const midX = (x1 + x2) / 2;
        let workColor = work.status === 'Planerad' ? '#ffd700' : (work.status === 'Avslutad' ? '#666666' : '#ff4d4d');

        if (work.id === state.expandedWorkId) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'; 
            let boxX = (minSt === maxSt) ? x1 - 5 : x1;
            let boxW = (minSt === maxSt) ? 10 : (x2 - x1);
            ctx.fillRect(boxX - 10, yTop - 10, boxW + 20, (yBottom - yTop) + 20);
            ctx.strokeStyle = workColor; ctx.setLineDash([4, 4]); ctx.lineWidth = 1; 
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
        
        for (let i = 0; i < state.stations.length; i++) {
            let sx = getX(i, canvas.width);
            if (sx >= x1 - 0.1 && sx <= x2 + 0.1) {
                ctx.moveTo(sx, yTop); ctx.lineTo(sx, yBottom);
            }
        }
        ctx.stroke();
        
        if(work.label) {
            ctx.font = '500 11px system-ui, sans-serif'; ctx.textAlign = 'center'; const midY = (yTop + yBottom) / 2;
            ctx.save(); ctx.fillStyle = '#1a1b1e'; const txtWidth = ctx.measureText(work.label).width; 
            ctx.fillRect(midX - txtWidth/2 - 2, midY - 14, txtWidth + 4, 16);
            ctx.fillStyle = workColor; ctx.fillText(work.label, midX, midY - 3); ctx.restore();
        }
    });

    // Rita tåg
    state.trains.forEach((train, i) => {
        if (!train.timetable || train.timetable.length < 2) return;
        let validTimes = train.timetable.flatMap(n => [n.arrival, n.departure]).filter(t => t !== null && !isNaN(t));
        if (validTimes.length === 0) return;
        if (Math.max(...validTimes) < state.currentStartTime || Math.min(...validTimes) > viewEnd) return; 

        const isSelected = (i === state.selectedTrainIndex);
        
        // Lodrätt streck för första stationen (ÅTERSTÄLLT)
        const firstNode = train.timetable[0];
        if (firstNode.arrival !== firstNode.departure) {
            ctx.beginPath(); ctx.lineWidth = isSelected ? 2.5 : 1.8; ctx.strokeStyle = isSelected ? '#33ccff' : theme.trainLine;
            ctx.moveTo(getNodeX(i, 0), getY(firstNode.arrival, canvas.height)); 
            ctx.lineTo(getNodeX(i, 0), getY(firstNode.departure, canvas.height)); 
            ctx.stroke();
        }
        
        for (let j = 1; j < train.timetable.length; j++) {
            const startX = getNodeX(i, j-1), startY = getY(train.timetable[j-1].departure, canvas.height);
            const endX = getNodeX(i, j), endY = getY(train.timetable[j].arrival, canvas.height);
            ctx.beginPath(); ctx.lineWidth = isSelected ? 2.5 : 1.8;
            ctx.strokeStyle = isSelected ? '#33ccff' : theme.trainLine;
            ctx.moveTo(startX, startY); ctx.lineTo(endX, endY); ctx.stroke();
            
            // Lodräta streck för uppehåll längs linjen (ÅTERSTÄLLT)
            if (train.timetable[j].arrival !== train.timetable[j].departure) {
                ctx.beginPath(); ctx.strokeStyle = isSelected ? '#33ccff' : theme.trainLine;
                ctx.moveTo(endX, endY); ctx.lineTo(endX, getY(train.timetable[j].departure, canvas.height)); ctx.stroke();
            }
        }

        // Tågnummer
        ctx.fillStyle = theme.trainNumber; ctx.font = 'bold 11px system-ui, sans-serif';
        if (train.timetable.length >= 2) {
            const x1 = getNodeX(i, 0), x2 = getNodeX(i, 1);
            const dy = getY(train.timetable[1].arrival, canvas.height) - getY(train.timetable[0].departure, canvas.height);
            ctx.save(); ctx.translate((x1 + x2) / 2, (getY(train.timetable[0].departure, canvas.height) + getY(train.timetable[1].arrival, canvas.height)) / 2); 
            let angle = Math.atan2(dy, x2 - x1); if ((x2 - x1) < 0) angle += Math.PI; ctx.rotate(angle);
            ctx.fillStyle = isSelected ? 'rgba(51, 204, 255, 0.2)' : 'rgba(37, 38, 43, 0.6)';
            const txtWidth = ctx.measureText(train.id).width; ctx.fillRect(-txtWidth/2 - 2, -12, txtWidth + 4, 14);
            ctx.fillStyle = isSelected ? '#33ccff' : theme.trainNumber; ctx.fillText(train.id, 0, 0); ctx.restore();
        }

        // Markera valda noder (ÅTERSTÄLLT)
        if (isSelected) {
            train.timetable.forEach((node, j) => {
                const x = getNodeX(i, j), yArr = getY(node.arrival, canvas.height), yDep = getY(node.departure, canvas.height);
                const isArrActive = state.activeNode && state.activeNode.trainIndex === i && state.activeNode.nodeIndex === j && state.activeNode.type === 'arrival';
                const isDepActive = state.activeNode && state.activeNode.trainIndex === i && state.activeNode.nodeIndex === j && state.activeNode.type === 'departure';

                ctx.fillStyle = isArrActive ? '#ffffff' : '#1a1b1e'; ctx.beginPath(); ctx.arc(x, yArr, isArrActive ? 7 : 5, 0, Math.PI*2); ctx.fill();
                ctx.strokeStyle = '#33ccff'; ctx.lineWidth = isArrActive ? 3 : 2; ctx.beginPath(); ctx.arc(x, yArr, isArrActive ? 7 : 5, 0, Math.PI*2); ctx.stroke();

                if (node.arrival !== node.departure || isDepActive) {
                    ctx.fillStyle = isDepActive ? '#ffffff' : '#1a1b1e'; ctx.beginPath(); ctx.arc(x, yDep, isDepActive ? 7 : 5, 0, Math.PI*2); ctx.fill();
                    ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = isDepActive ? 3 : 2; ctx.beginPath(); ctx.arc(x, yDep, isDepActive ? 7 : 5, 0, Math.PI*2); ctx.stroke();
                }
            });
        }
    });

    // Selektionsruta för att rita banarbeten (ÅTERSTÄLLD)
    if (state.isSelecting) {
        ctx.fillStyle = theme.selectionFill; ctx.fillRect(state.startPos.x, state.startPos.y, state.currentMouseX - state.startPos.x, state.currentMouseY - state.startPos.y);
        ctx.strokeStyle = theme.selectionStroke; ctx.lineWidth = 1; ctx.strokeRect(state.startPos.x, state.startPos.y, state.currentMouseX - state.startPos.x, state.currentMouseY - state.startPos.y);
    }

    const yNow = getY(state.currentRealMinutes, canvas.height);
    if (yNow >= margin.top && yNow <= canvas.height - margin.bottom) {
        const lineColor = state.simulationOffsetMinutes !== 0 ? theme.simLine : theme.nowLine;
        ctx.beginPath(); ctx.strokeStyle = lineColor; ctx.lineWidth = 2; ctx.setLineDash([10, 5]); 
        ctx.moveTo(margin.left, yNow); ctx.lineTo(canvas.width - margin.right, yNow); ctx.stroke(); ctx.setLineDash([]);
    }
    
    ctx.restore();

    ctx.font = '500 11px system-ui, sans-serif'; ctx.fillStyle = theme.stationLabel; ctx.textAlign = 'left';
    state.stations.forEach((st, i) => { 
        ctx.save(); ctx.translate(getX(i, canvas.width), canvas.height - margin.bottom + 12); ctx.rotate(-Math.PI / 4); ctx.fillText(st.sign, 0, 0); ctx.restore(); 
    });
}
