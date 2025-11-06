// Restrict Chart access to admin/analyst only
(function() {
    'use strict';

    const API_BASE = window.API_BASE || (window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
        ? 'http://127.0.0.1:5000'
        : window.location.origin);

    async function checkAdminAccess() {
        try {
            const response = await fetch(`${API_BASE}/api/admin/check-session`, {
                method: 'GET',
                credentials: 'include'
            });
            const data = await response.json();
            
            if (!data.logged_in) {
                // Redirect to admin login
                window.location.href = '../admin/login.html';
                return false;
            }
            return true;
        } catch (error) {
            console.error('Auth check error:', error);
            window.location.href = '../admin/login.html';
            return false;
        }
    }

    // Check access before allowing page to load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', async () => {
            const hasAccess = await checkAdminAccess();
            if (!hasAccess) {
                document.body.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100vh; font-family: system-ui; color: #fff; background: #0a0a0a;"><p>Redirecting to admin login...</p></div>';
            }
        });
    } else {
        checkAdminAccess().then(hasAccess => {
            if (!hasAccess) {
                document.body.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100vh; font-family: system-ui; color: #fff; background: #0a0a0a;"><p>Redirecting to admin login...</p></div>';
            }
        });
    }
})();

