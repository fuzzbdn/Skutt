import { state } from './state.js';
import { margin, formatTime, getX, getY, getLineIntersection } from './math.js';

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

    // 1. Rita stationer
    ctx.lineWidth = 1; ctx.strokeStyle = theme.grid; 
    state.stations.forEach((st, i) => { 
        ctx.beginPath(); ctx.moveTo(getX(i, canvas.width), margin.top); ctx.lineTo(getX(i, canvas.width), canvas.height - margin.bottom); ctx.stroke(); 
    });

    ctx.save(); 
    ctx.beginPath(); ctx.rect(0, margin.top, canvas.width, canvas.height - margin.top - margin.bottom); ctx.clip();
    
    // 2. Rita Tidslinjer
    const startGridTime = Math.floor(state.currentStartTime / 10) * 10 - 10;
    const endGridTime = state.currentStartTime + state.viewDuration + 10;
    ctx.lineWidth = 1; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'right';
    for (let time = startGridTime; time <= endGridTime; time += 10) {
        const y = getY(time, canvas.height); ctx.beginPath();
        if (time % 30 === 0) { ctx.setLineDash([]); ctx.strokeStyle = theme.grid; } else { ctx.setLineDash([3, 3]); ctx.strokeStyle = '#2f3136'; }
        ctx.moveTo(margin.left, y); ctx.lineTo(canvas.width - margin.right, y); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = theme.timeLabel; ctx.fillText(formatTime(time), margin.left - 10, y + 4);
    }

    // 3. Rita Tåg
    const viewEnd = state.currentStartTime + state.viewDuration;
    state.trains.forEach((train, i) => {
        if (!train.timetable || train.timetable.length < 2) return;
        let validTimes = train.timetable.flatMap(n => [n.arrival, n.departure]).filter(t => t !== null && !isNaN(t));
        if (validTimes.length === 0) return;
        if (Math.max(...validTimes) < state.currentStartTime || Math.min(...validTimes) > viewEnd) return; 

        const isSelected = (i === state.selectedTrainIndex);
        
        for (let j = 1; j < train.timetable.length; j++) {
            const startX = getNodeX(i, j-1), startY = getY(train.timetable[j-1].departure, canvas.height);
            const endX = getNodeX(i, j), endY = getY(train.timetable[j].arrival, canvas.height);
            ctx.beginPath(); ctx.lineWidth = isSelected ? 2.5 : 1.8;
            ctx.strokeStyle = isSelected ? '#33ccff' : theme.trainLine;
            ctx.moveTo(startX, startY); ctx.lineTo(endX, endY); ctx.stroke();
        }

        ctx.fillStyle = theme.trainNumber; ctx.font = 'bold 11px system-ui, sans-serif';
        if (train.timetable.length >= 2) {
            const x1 = getNodeX(i, 0), x2 = getNodeX(i, 1);
            const dy = getY(train.timetable[1].arrival, canvas.height) - getY(train.timetable[0].departure, canvas.height);
            ctx.save(); ctx.translate((x1 + x2) / 2, (getY(train.timetable[0].departure, canvas.height) + getY(train.timetable[1].arrival, canvas.height)) / 2); 
            let angle = Math.atan2(dy, x2 - x1); if ((x2 - x1) < 0) angle += Math.PI; ctx.rotate(angle);
            ctx.fillStyle = isSelected ? '#33ccff' : theme.trainNumber; ctx.fillText(train.id, 0, -5); ctx.restore();
        }
    });

    // 4. Rita Nutids-linjen
    const yNow = getY(state.currentRealMinutes, canvas.height);
    if (yNow >= margin.top && yNow <= canvas.height - margin.bottom) {
        const lineColor = state.simulationOffsetMinutes !== 0 ? theme.simLine : theme.nowLine;
        ctx.beginPath(); ctx.strokeStyle = lineColor; ctx.lineWidth = 2; ctx.setLineDash([10, 5]); 
        ctx.moveTo(margin.left, yNow); ctx.lineTo(canvas.width - margin.right, yNow); ctx.stroke(); ctx.setLineDash([]);
    }
    
    ctx.restore();

    // 5. Rita Stationsnamn i botten
    ctx.font = '500 11px system-ui, sans-serif'; ctx.fillStyle = theme.stationLabel; ctx.textAlign = 'left';
    state.stations.forEach((st, i) => { 
        ctx.save(); ctx.translate(getX(i, canvas.width), canvas.height - margin.bottom + 12); ctx.rotate(-Math.PI / 4); ctx.fillText(st.sign, 0, 0); ctx.restore(); 
    });
}
