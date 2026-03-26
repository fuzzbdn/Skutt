// fil: js/state.js

export const state = {
    // Data
    activeGraphId: null,
    savedGraphs: [],
    stations: [],
    trains: [],
    trackWorks: [],

    // Tid
    simulationOffsetMinutes: 0,
    currentRealMinutes: 0,
    currentStartTime: 0,
    isTrackingNow: true,
    nowOffsetPercentage: 0.3,
    viewDuration: 120,

    // Användare
    token: localStorage.getItem('skutt_token') || null,
    currentUser: localStorage.getItem('skutt_user') || null,

    // Interaktion & Mus
    isSelecting: false,
    isDraggingNowLine: false,
    startPos: { x: 0, y: 0 },
    currentMouseX: 0,
    currentMouseY: 0,
    
    // UI & Valda objekt
    expandedWorkId: null,
    editingWorkId: null,
    selectedTrainIndex: null,
    draggingNode: null,
    activeNode: null,
    
    // Rendering & Konflikter
    needsRedraw: true,
    conflicts: [],
    conflictSegments: new Set(),
    draggingConflict: null,
    activeTooltipNode: null,
    tooltipHitboxes: null
};

// En hjälpfunktion för att räkna ut absolut tid
export function getAbsoluteMinutes() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return ((now - startOfDay) / 60000) + state.simulationOffsetMinutes;
}
