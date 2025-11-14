(function() {
    'use strict';

    // API_BASE: in production set window.API_BASE in HTML to your backend URL
    const API_BASE = (typeof window !== 'undefined' && window.API_BASE) || window.location.origin;

    let selectedRole = 'admin';
    const form = document.getElementById('adminLoginForm');
    const accessCodeInput = document.getElementById('accessCode');
    const submitBtn = document.getElementById('submitBtn');
    const errorMessage = document.getElementById('errorMessage');
    const roleButtons = document.querySelectorAll('.role-btn');

    // Role selection
    roleButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            selectedRole = btn.dataset.role;
            roleButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            errorMessage.classList.remove('show');
            errorMessage.textContent = '';
        });
    });

    // Auto-uppercase and format code input
    accessCodeInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        
        // Set max length based on role
        if (selectedRole === 'admin') {
            e.target.maxLength = 6;
        } else {
            e.target.maxLength = 6;
        }
    });

    // Form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorMessage.classList.remove('show');
        errorMessage.textContent = '';

        const code = accessCodeInput.value.trim();

        if (!code) {
            showError('Please enter an access code');
            return;
        }

        // Validate format
        if (selectedRole === 'admin') {
            // Admin: 3 letters + 3 numbers (mixed)
            if (!/^[A-Z0-9]{6}$/.test(code)) {
                showError('Invalid admin code format');
                return;
            }
        } else {
            // Analyst: 4 letters + 2 numbers
            if (!/^[A-Z]{4}[0-9]{2}$/.test(code)) {
                showError('Invalid analyst code format');
                return;
            }
        }

        setLoading(true);

        try {
            const endpoint = selectedRole === 'admin' ? '/api/admin/login' : '/api/analyst/login';
            const response = await fetch(`${API_BASE}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({ access_code: code })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                // Redirect to dashboard - use replace to prevent back button
                window.location.replace('dashboard.html');
            } else {
                showError(data.message || 'Invalid access code');
            }
        } catch (error) {
            console.error('Login error:', error);
            showError('Network error. Please check your connection.');
        } finally {
            setLoading(false);
        }
    });

    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.classList.add('show');
    }

    function setLoading(loading) {
        submitBtn.disabled = loading;
        accessCodeInput.disabled = loading;
        if (loading) {
            submitBtn.innerHTML = '<span>Verifying...</span>';
        } else {
            submitBtn.innerHTML = '<span>Access Dashboard</span>';
        }
    }

    // Check for inactivity logout message
    (function() {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('inactivity') === '1') {
            const messageDiv = document.createElement('div');
            messageDiv.style.cssText = `
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: var(--warning, #ffc107);
                color: white;
                padding: 16px 24px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                z-index: 10000;
                font-weight: 600;
                text-align: center;
                max-width: 90%;
            `;
            messageDiv.textContent = 'You were logged out due to inactivity.';
            document.body.appendChild(messageDiv);
            
            setTimeout(() => {
                messageDiv.remove();
            }, 5000);
            
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    })();
})();

