// Shared functionality for authentication and navigation
(function() {
    'use strict';

    // API_BASE: in production set window.API_BASE in HTML to your backend URL
    // Falls back to window.location.origin if not set
    const API_BASE = (typeof window !== 'undefined' && window.API_BASE) || window.location.origin;

    // Check if user is logged in - NO localStorage for auth state
    async function checkAuthStatus() {
        try {
            const response = await fetch(`${API_BASE}/api/check-session`, {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store' // Prevent caching
            });
            const data = await response.json();
            if (data.logged_in && data.user) {
                return data.user;
            }
            return null;
        } catch (error) {
            console.error('Auth check error:', error);
            return null;
        }
    }

    // Paths helper
    function getPaths() {
        const isVotePage = /\/Vote\//.test(window.location.pathname);
        return {
            isVotePage,
            categoriesHref: isVotePage ? 'index.html' : 'Vote/index.html',
            loginHref: isVotePage ? '../Auth/login.html' : 'Auth/login.html',
            homeHref: isVotePage ? '../index.html' : './index.html'
        };
    }

    // Update navigation and links based on auth status
    function updateNavigation(isLoggedIn) {
        const { categoriesHref, loginHref } = getPaths();

        // Update Vote dropdown item target (keep dropdown visible always)
        const voteDropdownLink = document.querySelector('.nav-dropdown .dropdown-item');
        if (voteDropdownLink) {
            voteDropdownLink.setAttribute('href', isLoggedIn ? categoriesHref : loginHref);
        }

        // Update hero "View Categories" button
        const viewBtn = document.getElementById('viewCategoriesBtn');
        if (viewBtn) {
            viewBtn.setAttribute('href', isLoggedIn ? categoriesHref : loginHref);
        }

        // Hide Signup/Login buttons when logged in
        const signupBtn = document.querySelector('.cta-signup');
        const loginBtn = document.querySelector('.cta-login');
        if (signupBtn) signupBtn.style.display = isLoggedIn ? 'none' : '';
        if (loginBtn) loginBtn.style.display = isLoggedIn ? 'none' : '';
        const ctaGroup = document.querySelector('.cta-group');
        if (ctaGroup) ctaGroup.style.display = isLoggedIn ? 'none' : '';

        // Profile menu visibility
        const profileMenu = document.getElementById('profileMenu');
        if (profileMenu) profileMenu.style.display = isLoggedIn ? 'inline-block' : 'none';

        // Mobile logout visibility
        const mobileLogoutItem = document.querySelector('.mobile-logout-item');
        if (mobileLogoutItem) {
            const isMobile = window.matchMedia('(max-width: 767px)').matches;
            mobileLogoutItem.style.display = isLoggedIn && isMobile ? 'flex' : 'none';
        }
    }

    // Show A/C circle on pages (not on login page) - get user from backend
    async function showAccessCodeCircle() {
        // Don't show on login page
        if (window.location.pathname.includes('login.html')) {
            return;
        }

        // Get user from backend, not localStorage
        const user = await checkAuthStatus();
        if (!user || !user.access_code) {
            // Remove circle if user is not logged in or has no access code
            const existingCircle = document.getElementById('accessCodeCircle');
            if (existingCircle) {
                existingCircle.remove();
            }
            return;
        }

        // Check if A/C circle already exists
        let acCircle = document.getElementById('accessCodeCircle');
        if (!acCircle) {
            // Create A/C circle
            acCircle = document.createElement('div');
            acCircle.className = 'access-code-circle';
            acCircle.id = 'accessCodeCircle';
            document.body.appendChild(acCircle);
        }
        
        // Update or set the innerHTML
        acCircle.innerHTML = `
            <button type="button" class="ac-circle-btn" id="acCircleBtn" aria-label="Show access code">
                <span class="ac-text">A/C</span>
            </button>
            <div class="access-code-popup" id="accessCodePopup">
                <div class="ac-popup-header">
                    <h3>Your Access Code</h3>
                    <button type="button" class="ac-close" id="acClose" aria-label="Close">×</button>
                </div>
                <div class="ac-popup-content">
                    <div class="ac-code-display" id="acCodeDisplay">${user.access_code}</div>
                    <p class="ac-warning">Keep this code safe. You'll need it to log in.</p>
                </div>
            </div>
        `;

        // Add event listeners (after innerHTML update, elements are fresh)
        const acCircleBtn = document.getElementById('acCircleBtn');
        const acClose = document.getElementById('acClose');
        
        if (acCircleBtn) {
            acCircleBtn.addEventListener('click', () => {
                acCircle.classList.toggle('show-popup');
            });
        }

        if (acClose) {
            acClose.addEventListener('click', () => {
                acCircle.classList.remove('show-popup');
            });
        }

        // Close popup when clicking outside
        const handleClickOutside = (e) => {
            if (acCircle && !acCircle.contains(e.target) && acCircle.classList.contains('show-popup')) {
                acCircle.classList.remove('show-popup');
            }
        };
        document.addEventListener('click', handleClickOutside);
    }

    // Initialize on page load
    function initPasswordToggles() {
        const eye = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 5C7 5 2.73 8.11 1 12c1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        const eyeOff = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 3l18 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M10.58 10.58A4 4 0 0 0 12 16a4 4 0 0 0 3.42-6.42M17.94 17.94C16.22 19.23 14.18 20 12 20 7 20 2.73 16.89 1 13c.56-1.25 1.38-2.41 2.4-3.43M6.06 6.06C7.78 4.77 9.82 4 12 4c5 0 9.27 3.11 11 7-.48 1.08-1.13 2.1-1.92 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        const toggleButtons = document.querySelectorAll('[data-pw-toggle]');
        toggleButtons.forEach((btn) => {
            const targetId = btn.getAttribute('aria-controls');
            const input = targetId ? document.getElementById(targetId) : null;
            if (!input) return;
            // initialize icon
            const label = btn.querySelector('[data-pw-label]');
            if (label) label.innerHTML = eye;
            btn.addEventListener('click', () => {
                const isPassword = input.getAttribute('type') === 'password';
                input.setAttribute('type', isPassword ? 'text' : 'password');
                btn.setAttribute('aria-pressed', isPassword ? 'true' : 'false');
                if (label) label.innerHTML = isPassword ? eyeOff : eye;
            });
        });
    }

    async function init() {
        // Handle browser back/forward navigation - always verify session
        window.addEventListener('pageshow', async (e) => {
            if (e.persisted) {
                // Page was loaded from cache (back/forward button)
                // Force fresh session check
                const user = await checkAuthStatus();
                if (!user) {
                    // Clear vote cache but keep it for non-auth purposes
                    try {
                        localStorage.removeItem('vote_cache_timestamp');
                        localStorage.removeItem('cached_votes');
                        localStorage.removeItem('votes_reset');
                    } catch (_) {}
                    updateNavigation(false);
                    const ac = document.getElementById('accessCodeCircle');
                    if (ac) ac.remove();
                    // Redirect to login if on protected page
                    const paths = getPaths();
                    if (paths.isVotePage) {
                        window.location.replace(paths.loginHref);
                    }
                } else {
                    // User is logged in, update UI
                    updateNavigation(true);
                    await showAccessCodeCircle();
                }
            }
        });
        
        // Check auth status - retry up to 3 times if first check fails (for fresh signups)
        let user = await checkAuthStatus();
        if (!user) {
            // Wait a bit and retry (in case session cookie is still being set after redirect)
            for (let i = 0; i < 3 && !user; i++) {
                await new Promise(resolve => setTimeout(resolve, 200));
                user = await checkAuthStatus();
            }
        }
        
        // If not logged in, clear UI state
        if (!user) {
            try {
                localStorage.removeItem('vote_cache_timestamp');
                localStorage.removeItem('cached_votes');
                localStorage.removeItem('votes_reset');
            } catch (_) {}
            const ac = document.getElementById('accessCodeCircle');
            if (ac) ac.remove();
            updateNavigation(false);
        } else {
            // User is logged in, update UI
            updateNavigation(true);
            await showAccessCodeCircle();
        }
        
        wireProfileMenu();
        initPasswordToggles();

        // Re-evaluate mobile-only elements on resize
        window.addEventListener('resize', () => {
            checkAuthStatus().then(u => updateNavigation(!!u));
        });
    }

    // Run on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Profile menu wiring and logout
    function wireProfileMenu() {
        const profileMenu = document.getElementById('profileMenu');
        const trigger = document.getElementById('profileTrigger');
        const dropdown = document.getElementById('profileDropdown');
        const logoutBtn = document.getElementById('logoutBtn');
        const mobileLogoutBtn = document.getElementById('mobileLogoutBtn');
        if (!profileMenu || !trigger || !dropdown || !logoutBtn) {
            // still wire mobile logout if present
            if (mobileLogoutBtn) {
                mobileLogoutBtn.addEventListener('click', handleLogout);
            }
            return;
        }

        // Toggle
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = profileMenu.classList.toggle('is-open');
            trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!profileMenu.contains(e.target)) {
                profileMenu.classList.remove('is-open');
                trigger.setAttribute('aria-expanded', 'false');
            }
        });

        // Logout
        logoutBtn.addEventListener('click', handleLogout);
        if (mobileLogoutBtn) mobileLogoutBtn.addEventListener('click', handleLogout);
    }

    async function handleLogout() {
        try {
            await fetch(`${API_BASE}/api/logout`, { 
                method: 'POST', 
                credentials: 'include',
                cache: 'no-store'
            });
        } catch (_) {}
        
        // Clear vote cache (but keep theme and other non-auth data)
        try {
            localStorage.removeItem('vote_cache_timestamp');
            localStorage.removeItem('cached_votes');
            localStorage.removeItem('votes_reset');
        } catch (_) {}
        
        updateNavigation(false);
        const { homeHref } = getPaths();
        
        // Use replace to prevent back button from restoring state
        window.location.replace(homeHref);
    }

    // Expose for external use
    window.updateAuthStatus = updateNavigation;
    window.showAccessCodeCircle = showAccessCodeCircle;

})();

