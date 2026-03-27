// Vi fryser tiden när programmet startar så att koordinaterna aldrig hoppar vid midnatt
const startupDate = new Date();
export const referenceMidnight = new Date(startupDate.getFullYear(), startupDate.getMonth(), startupDate.getDate());
export const referenceMidnightUTC = Date.UTC(startupDate.getFullYear(), startupDate.getMonth(), startupDate.getDate());

export const state = {
    token: localStorage.getItem('skutt_token'),
    user: localStorage.getItem('skutt_user'),
    activeGraphId: null,
    stations: [],
    trains: [],
    trackWorks: [],
    
    isSelecting: false,
    isDraggingNowLine: false,
    startPos: { x: 0, y: 0 },
    currentMouseX: 0, currentMouseY: 0,
    expandedWorkId: null, editingWorkId: null,
    
    selectedTrainIndex: null, draggingNode: null, activeNode: null,
    conflicts: [], conflictSegments: new Set(), draggingConflict: null,
    
    simulationOffsetMinutes: 0,
    currentRealMinutes: 0, 
    currentStartTime: 0,
    nowOffsetPercentage: 0.3,
    
    needsRedraw: true,
    needsCalculations: true, // 🚨 NY FLAGGA FÖR PRESTANDA!
    needsSidebarUpdate: false,
    isTrackingNow: true,
    
    viewDuration: 120,
    scrollMinutes: 10,
    nodeStepMinutes: 2
};

export function getAbsoluteMinutes() {
    const now = new Date();
    // Räknar alltid exakt antal minuter sedan appen startades, helt skottsäkert!
    return ((now - referenceMidnight) / 60000) + state.simulationOffsetMinutes;
}
