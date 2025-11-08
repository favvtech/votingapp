// Restrict Chart access to admin/analyst only
(function() {
    'use strict';

    // API_BASE: in production set window.API_BASE in HTML to your backend URL
    const API_BASE = (typeof window !== 'undefined' && window.API_BASE) || window.location.origin;

    async function checkAdminAccess() {
        try {
            const headers = {};
            try {
                const code = sessionStorage.getItem('admin_code');
                if (code) headers['X-Admin-Code'] = code;
            } catch(_) {}
            const response = await fetch(`${API_BASE}/api/admin/check-session`, {
                method: 'GET',
                credentials: 'include',
                headers: headers
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

