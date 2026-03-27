const token = localStorage.getItem('skutt_token');
if (!token) window.location.href = 'index.html';

const scrollMinutesInput = document.getElementById('scrollMinutesInput');
const nodeStepInput = document.getElementById('nodeStepInput');
const viewDurationInput = document.getElementById('viewDurationInput');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');

async function loadSettings() {
    try {
        const res = await fetch('/api/settings', { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) {
            const data = await res.json();
            scrollMinutesInput.value = data.scroll_minutes || 10;
            nodeStepInput.value = data.node_step_minutes || 2;
            viewDurationInput.value = data.view_duration || 120;
        }
    } catch (e) { console.error("Kunde inte hämta inställningar"); }
}

saveSettingsBtn.addEventListener('click', async () => {
    const payload = {
        scroll_minutes: parseInt(scrollMinutesInput.value) || 10,
        node_step_minutes: parseInt(nodeStepInput.value) || 2,
        view_duration: parseInt(viewDurationInput.value) || 120
    };

    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const origText = saveSettingsBtn.textContent;
            saveSettingsBtn.textContent = "✅ Sparat!";
            saveSettingsBtn.style.backgroundColor = "rgba(51, 204, 255, 0.2)";
            setTimeout(() => {
                saveSettingsBtn.textContent = origText;
                saveSettingsBtn.style.backgroundColor = "transparent";
            }, 1500);
        } else {
            alert("Kunde inte spara inställningarna.");
        }
    } catch (e) { alert("Nätverksfel vid sparning."); }
});

loadSettings();
