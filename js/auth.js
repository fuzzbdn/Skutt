import { state } from './state.js';

export function setupAuth(onSuccess) {
    const authUsername = document.getElementById('authUsername');
    const authPassword = document.getElementById('authPassword');
    const authMessage = document.getElementById('authMessage');

    // 1. Redan inloggad? Skicka vidare direkt!
    if (localStorage.getItem('skutt_token')) {
        onSuccess();
        return;
    }

    // 2. Koppla knappar
    document.getElementById('loginBtn')?.addEventListener('click', () => handleAuth('login'));
    document.getElementById('registerBtn')?.addEventListener('click', () => handleAuth('register'));

    async function handleAuth(action) {
        const username = authUsername.value.trim();
        const password = authPassword.value;

        if (!username || !password) {
            authMessage.textContent = 'Fyll i båda fälten.';
            return;
        }

        try {
            const res = await fetch(`/api/auth?action=${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();

            if (!res.ok) {
                authMessage.textContent = data.error || 'Ett fel uppstod.';
                return;
            }

            if (action === 'register') {
                authMessage.style.color = '#33ccff';
                authMessage.textContent = 'Konto skapat! Loggar in...';
                handleAuth('login'); 
            } else if (action === 'login') {
                localStorage.setItem('skutt_token', data.token);
                localStorage.setItem('skutt_user', data.username);
                
                // SKICKA VIDARE TILL GRAFEN!
                onSuccess(); 
            }
        } catch (err) {
            authMessage.textContent = 'Kunde inte ansluta till servern.';
        }
    }
}

export function createLogoutButton() {
    if (document.getElementById('logoutBtn')) return;
    const logoutBtn = document.createElement('button');
    logoutBtn.id = 'logoutBtn';
    logoutBtn.textContent = `Logga ut (${state.currentUser || localStorage.getItem('skutt_user')})`;
    logoutBtn.className = 'sidebar-btn';
    logoutBtn.style.cssText = 'position:absolute; top:10px; right:10px; z-index:9999; border-color:#ff4d4d; color:#ff4d4d;';
    logoutBtn.onclick = () => {
        localStorage.clear(); // Töm alla tokens
        window.location.href = 'index.html'; // Skicka tillbaka till inloggningen
    };
    document.body.appendChild(logoutBtn);
}
