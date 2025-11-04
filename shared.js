// Shared functionality for authentication and navigation
(function() {
    'use strict';

    const API_BASE = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
        ? 'http://127.0.0.1:5000'
        : window.location.origin;

    // Check if user is logged in
    async function checkAuthStatus() {
        try {
            const response = await fetch(`${API_BASE}/api/check-session`, {
                method: 'GET',
                credentials: 'include'
            });
            const data = await response.json();
            return data.logged_in && data.user;
        } catch (error) {
            console.error('Auth check error:', error);
            // Fallback to localStorage
            const user = localStorage.getItem('user');
            return user ? JSON.parse(user) : null;
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

    // Show A/C circle on pages (not on login page)
    function showAccessCodeCircle() {
        // Don't show on login page
        if (window.location.pathname.includes('login.html')) {
            return;
        }

        const userStr = localStorage.getItem('user');
        if (!userStr) return;

        try {
            const user = JSON.parse(userStr);
            if (!user || !user.access_code) return;

            // Check if A/C circle already exists
            let acCircle = document.getElementById('accessCodeCircle');
            if (!acCircle) {
                // Create A/C circle
                acCircle = document.createElement('div');
                acCircle.className = 'access-code-circle';
                acCircle.id = 'accessCodeCircle';
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
                document.body.appendChild(acCircle);

                // Add event listeners
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
                document.addEventListener('click', (e) => {
                    if (acCircle && !acCircle.contains(e.target) && acCircle.classList.contains('show-popup')) {
                        acCircle.classList.remove('show-popup');
                    }
                });
            } else {
                // Update existing circle
                const acCodeDisplay = document.getElementById('acCodeDisplay');
                if (acCodeDisplay) {
                    acCodeDisplay.textContent = user.access_code;
                }
                acCircle.style.display = 'flex';
            }
        } catch (error) {
            console.error('Error showing access code circle:', error);
        }
    }

    // Initialize on page load
    async function init() {
        const user = await checkAuthStatus();
        wireProfileMenu();
        updateNavigation(!!user);
        showAccessCodeCircle();

        // Re-evaluate mobile-only elements on resize
        window.addEventListener('resize', () => updateNavigation(!!user));
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
            await fetch(`${API_BASE}/api/logout`, { method: 'POST', credentials: 'include' });
        } catch (_) {}
        localStorage.removeItem('user');
        localStorage.removeItem('user_access_code');
        updateNavigation(false);
        const { homeHref } = getPaths();
        window.location.href = homeHref;
    }

    // Expose for external use
    window.updateAuthStatus = updateNavigation;
    window.showAccessCodeCircle = showAccessCodeCircle;

})();

