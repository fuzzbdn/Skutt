const token = localStorage.getItem('skutt_token');
if (!token) window.location.href = 'index.html';

const scrollSpeedInput = document.getElementById('scrollSpeedInput');
const scrollSpeedValue = document.getElementById('scrollSpeedValue');
const viewDurationInput = document.getElementById('viewDurationInput');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');

// Uppdatera texten när man drar i reglaget
scrollSpeedInput.addEventListener('input', (e) => {
    let val = parseFloat(e.target.value);
    scrollSpeedValue.textContent = `${val}x ${val < 0.5 ? '(Mjukare)' : (val > 1 ? '(Snabbare)' : '(Standard)')}`;
});

// Hämta inställningar vid start
async function loadSettings() {
    try {
        const res = await fetch('/api/settings', { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) {
            const data = await res.json();
            scrollSpeedInput.value = data.scroll_sensitivity || 0.4;
            viewDurationInput.value = data.view_duration || 120;
            // Trigga input-eventet för att uppdatera texten
            scrollSpeedInput.dispatchEvent(new Event('input')); 
        }
    } catch (e) { console.error("Kunde inte hämta inställningar"); }
}

// Spara inställningar
saveSettingsBtn.addEventListener('click', async () => {
    const payload = {
        scroll_sensitivity: parseFloat(scrollSpeedInput.value),
        view_duration: parseInt(viewDurationInput.value)
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
