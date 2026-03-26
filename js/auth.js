// fil: js/auth.js
import { state } from './state.js';
import { initApp } from './main.js';

export function setupAuth() {
    const authOverlay = document.getElementById('authOverlay');
    const authUsername = document.getElementById('authUsername');
    const authPassword = document.getElementById('authPassword');
    const authMessage = document.getElementById('authMessage');

    // Kolla om vi redan är inloggade
    if (state.token) {
        authOverlay.style.display = 'none';
        initApp(); // Starta appen!
        return;
    }

    // Koppla knapparna
    const loginBtn = document.getElementById('loginBtn');
    const registerBtn = document.getElementById('registerBtn');

    if (loginBtn && registerBtn) {
        loginBtn.addEventListener('click', () => handleAuth('login'));
        registerBtn.addEventListener('click', () => handleAuth('register'));
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
                authMessage.textContent = 'Konto skapat! Loggar in...';
                // Logga in automatiskt efter registrering
                handleAuth('login'); 
            } else if (action === 'login') {
                localStorage.setItem('skutt_token', data.token);
                localStorage.setItem('skutt_user', data.username);
                state.token = data.token;
                state.currentUser = data.username;
                
                authOverlay.style.display = 'none';
                initApp();
            }
        } catch (err) {
            authMessage.style.color = '#ff6b6b';
            authMessage.textContent = 'Kunde inte ansluta till servern.';
        }
    }
}

export function createLogoutButton() {
    const logoutBtn = document.createElement('button');
    logoutBtn.textContent = `Logga ut (${state.currentUser})`;
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
