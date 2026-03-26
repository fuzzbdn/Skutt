import { state, getAbsoluteMinutes } from './state.js';
import { getY, getTimeFromY } from './math.js';
import { canvas, drawGraph } from './canvas.js';

export function setupUI() {
    const scrollContainer = document.getElementById('scrollContainer');
    const scrollContent = document.getElementById('scrollContent');

    // Hantera fönstrets storlek
    window.addEventListener('resize', resizeCanvas);
    function resizeCanvas() {
        if (!canvas) return;
        canvas.width = scrollContainer.clientWidth;
        canvas.height = scrollContainer.clientHeight;
        scrollContent.style.height = ((state.viewDuration * 2) * (canvas.height / state.viewDuration)) + "px";
        updateScrollFromTime();
        state.needsRedraw = true;
    }

    // Hantera scrollning för tid
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

    // Följ nutid-knappen
    const snapBtn = document.getElementById('snapToNowBtn');
    if (snapBtn) {
        snapBtn.addEventListener('click', () => {
            state.isTrackingNow = true;
            state.currentStartTime = state.currentRealMinutes - (state.viewDuration * state.nowOffsetPercentage);
            updateScrollFromTime();
            state.needsRedraw = true;
        });
    }

    // Starta rit-loopen!
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

    // Första setup
    setTimeout(resizeCanvas, 50);
    requestAnimationFrame(renderLoop);
}
