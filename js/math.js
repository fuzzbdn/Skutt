import { state } from './state.js';

// Konstanter för grafens marginaler
export const margin = { top: 40, bottom: 60, left: 60, right: 40 };

export function formatTime(totalMinutes) {
    let m = Math.floor(((totalMinutes % 60) + 60) % 60);
    let h = Math.floor(totalMinutes / 60);
    let displayH = ((h % 24) + 24) % 24;
    let dayOffset = Math.floor(h / 24);
    let dayStr = dayOffset > 0 ? `(+${dayOffset}d) ` : (dayOffset < 0 ? `(${dayOffset}d) ` : "");
    return dayStr + `${displayH.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

export function getX(stationIndex, canvasWidth) {
    if (state.stations.length === 0) return margin.left;
    if (state.stations.length === 1) return margin.left;
    const width = canvasWidth - margin.left - margin.right;
    const minKm = state.stations[0].km;
    const maxKm = state.stations[state.stations.length - 1].km;
    const totalKm = Math.abs(maxKm - minKm);
    if (totalKm === 0) return margin.left + stationIndex * (width / (state.stations.length - 1));
    return margin.left + (Math.abs(state.stations[stationIndex].km - minKm) / totalKm * width);
}

export function getY(timeInMinutes, canvasHeight) {
    return canvasHeight - margin.bottom - ((timeInMinutes - state.currentStartTime) / state.viewDuration * (canvasHeight - margin.top - margin.bottom));
}

export function getTimeFromY(y, canvasHeight) {
    const height = canvasHeight - margin.top - margin.bottom;
    const clampedY = Math.max(margin.top, Math.min(y, canvasHeight - margin.bottom));
    return state.currentStartTime + ((canvasHeight - margin.bottom - clampedY) / height) * state.viewDuration;
}

export function getStationFromX(x, canvasWidth) {
    if (state.stations.length === 0) return 0;
    let closestIndex = 0, minDistance = Infinity;
    for (let i = 0; i < state.stations.length; i++) {
        const dist = Math.abs(getX(i, canvasWidth) - x);
        if (dist < minDistance) { minDistance = dist; closestIndex = i; }
    }
    return closestIndex;
}

// Används för att räkna ut exakt var linjer korsar varandra (tågmöten)
export function getLineIntersection(p0_x, p0_y, p1_x, p1_y, p2_x, p2_y, p3_x, p3_y) {
    let s1_x = p1_x - p0_x, s1_y = p1_y - p0_y;
    let s2_x = p3_x - p2_x, s2_y = p3_y - p2_y;
    let denom = -s2_x * s1_y + s1_x * s2_y;
    if (denom === 0) return null; 
    let s = (-s1_y * (p0_x - p2_x) + s1_x * (p0_y - p2_y)) / denom;
    let t = ( s2_x * (p0_y - p2_y) - s2_y * (p0_x - p2_x)) / denom;
    if (s >= 0.01 && s <= 0.99 && t >= 0.01 && t <= 0.99) return { x: p0_x + (t * s1_x), y: p0_y + (t * s1_y) };
    return null;
}
