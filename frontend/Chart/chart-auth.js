// Restrict Chart access to admin/analyst only
(function() {
    'use strict';

    // API_BASE: in production set window.API_BASE in HTML to your backend URL
    const API_BASE = (typeof window !== 'undefined' && window.API_BASE) || window.location.origin;

    async function checkAdminAccess() {
        try {
            // Get fallback code from sessionStorage if available (for cross-domain cookie issues)
            let fallbackCode = null;
            try {
                fallbackCode = sessionStorage.getItem('admin_access_code_fallback');
                if (fallbackCode) {
                    fallbackCode = fallbackCode.toUpperCase().trim();
                }
            } catch (e) {
                // sessionStorage not available, ignore
            }
            
            // Try with cookie first
            let response = await fetch(`${API_BASE}/api/admin/check-session`, {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });
            
            let data = null;
            if (response.ok) {
                data = await response.json();
            }
            
            // If session check fails, try with header fallback
            if ((!data || !data.logged_in) && fallbackCode) {
                try {
                    response = await fetch(`${API_BASE}/api/admin/check-session`, {
                        method: 'GET',
                        credentials: 'include',
                        cache: 'no-store',
                        headers: {
                            'X-Admin-Code': fallbackCode,
                            'Cache-Control': 'no-cache',
                            'Pragma': 'no-cache'
                        }
                    });
                    
                    if (response.ok) {
                        data = await response.json();
                    }
                } catch (e) {
                    console.warn('Header fallback check failed:', e);
                }
            }
            
            if (!data || !data.logged_in) {
                // Redirect to admin login - use replace to prevent back button
                window.location.replace('../admin/login.html');
                return false;
            }
            return true;
        } catch (error) {
            console.error('Auth check error:', error);
            window.location.replace('../admin/login.html');
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

