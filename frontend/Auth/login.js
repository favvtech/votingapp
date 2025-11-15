(function() {
    'use strict';

    // API_BASE: in production set window.API_BASE in HTML to your backend URL
    // CRITICAL: Never fallback to window.location.origin in production - it will be wrong!
    let API_BASE;
    if (typeof window !== 'undefined' && window.API_BASE) {
        API_BASE = window.API_BASE;
    } else {
        // Only use localhost fallback for local development
        const hostname = window.location.hostname;
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            API_BASE = 'http://127.0.0.1:5000';
        } else {
            // Production: Use the known backend URL
            API_BASE = 'https://votingapp-1-jwdq.onrender.com';
            console.warn('⚠️ API_BASE not set in HTML, using default backend URL:', API_BASE);
        }
    }
    
    // Log API_BASE for debugging
    console.log('🔗 API_BASE configured:', API_BASE);

    // Check backend connectivity on page load
    async function checkBackendConnectivity() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout for health check
            
            const response = await fetch(`${API_BASE}/api/health`, {
                method: 'GET',
                credentials: 'include',
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const data = await response.json();
                console.log('✅ Backend is reachable:', data);
                return true;
            } else {
                console.warn('⚠️ Backend health check returned non-OK status:', response.status);
                return false;
            }
        } catch (error) {
            console.warn('⚠️ Backend connectivity check failed:', error.name, error.message);
            console.warn('Backend URL:', API_BASE);
            // Don't show error to user yet - they might not be trying to login yet
            // The error will show when they actually try to login/signup
            return false;
        }
    }

    // Run connectivity check when page loads (non-blocking)
    if (typeof window !== 'undefined') {
        // Use setTimeout to avoid blocking page load
        setTimeout(() => {
            checkBackendConnectivity().then(isConnected => {
                if (!isConnected) {
                    console.warn('Backend may be unreachable. Users will see an error when attempting to login/signup.');
                }
            });
        }, 1000); // Wait 1 second after page load
    }

    // DOM Elements
    const loginTab = document.querySelector('[data-tab="login"]');
    const signupTab = document.querySelector('[data-tab="signup"]');
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    const authMessage = document.getElementById('authMessage');
    const accessCodeCircle = document.getElementById('accessCodeCircle');
    const acCircleBtn = document.getElementById('acCircleBtn');
    const acClose = document.getElementById('acClose');
    const acCodeDisplay = document.getElementById('acCodeDisplay');

    // Initialize birthdate dropdowns
    function initBirthdateDropdowns() {
        // Populate day dropdowns (1-31)
        function populateDayDropdown(dropdownId, maxDays = 31) {
            const dropdown = document.getElementById(dropdownId);
            if (!dropdown) return;
            dropdown.innerHTML = '';
            for (let i = 1; i <= maxDays; i++) {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'birthdate-item';
                item.dataset.value = i;
                item.textContent = i;
                dropdown.appendChild(item);
            }
        }

        // Populate year dropdown (1900-2100)
        function populateYearDropdown(dropdownId) {
            const dropdown = document.getElementById(dropdownId);
            if (!dropdown) return;
            dropdown.innerHTML = '';
            for (let year = 2100; year >= 1900; year--) {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'birthdate-item';
                item.dataset.value = year;
                item.textContent = year;
                dropdown.appendChild(item);
            }
        }

        // Initialize day dropdowns
        populateDayDropdown('birthDayDropdown', 31);

        // Initialize year dropdowns
        populateYearDropdown('birthYearDropdown');

        // Initialize birthdate combo functionality
        function initBirthdateCombo(inputId, toggleId, dropdownId, hiddenInputId, type = 'day') {
            const input = document.getElementById(inputId);
            const toggle = document.getElementById(toggleId);
            const dropdown = document.getElementById(dropdownId);
            const hiddenInput = document.getElementById(hiddenInputId);
            const parent = input?.closest('.birthdate-combo');

            if (!input || !toggle || !dropdown || !hiddenInput || !parent) return;

            const isMobile = window.matchMedia('(max-width: 640px)').matches;
            if (isMobile) {
                input.setAttribute('readonly', 'readonly');
            }

            // Toggle dropdown
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = parent.classList.contains('is-open');
                closeAllCombos();
                if (!isOpen) {
                    parent.classList.add('is-open');
                    toggle.setAttribute('aria-expanded', 'true');
                    filterBirthdateDropdown(input, dropdown, type);
                }
            });

            // Open dropdown on focus/click in the input
            input.addEventListener('focus', () => {
                if (!parent.classList.contains('is-open')) {
                    parent.classList.add('is-open');
                    toggle.setAttribute('aria-expanded', 'true');
                }
            });
            input.addEventListener('click', () => {
                if (!parent.classList.contains('is-open')) {
                    parent.classList.add('is-open');
                    toggle.setAttribute('aria-expanded', 'true');
                }
            });

            // Handle input typing (kept for desktop accessibility, though readOnly prevents on mobile)
            input.addEventListener('input', (e) => {
                const value = e.target.value.trim();
                if (type === 'day') {
                    // Only allow numbers, max 2 digits, 1-31
                    const numValue = value.replace(/[^0-9]/g, '').slice(0, 2);
                    if (numValue && (parseInt(numValue) < 1 || parseInt(numValue) > 31)) {
                        e.target.value = numValue.slice(0, -1);
                        return;
                    }
                    input.value = numValue;
                    hiddenInput.value = numValue || '';
                } else if (type === 'month') {
                    // Allow month name or number
                    const monthMatch = matchMonth(value);
                    if (monthMatch) {
                        input.value = monthMatch.text;
                        hiddenInput.value = monthMatch.value;
                    } else {
                        const numValue = value.replace(/[^0-9]/g, '').slice(0, 2);
                        if (numValue && (parseInt(numValue) < 1 || parseInt(numValue) > 12)) {
                            e.target.value = numValue.slice(0, -1);
                            return;
                        }
                        input.value = numValue;
                        hiddenInput.value = numValue || '';
                    }
                } else if (type === 'year') {
                    // Only allow numbers, max 4 digits, 1900-2100
                    const numValue = value.replace(/[^0-9]/g, '').slice(0, 4);
                    if (numValue && (parseInt(numValue) < 1900 || parseInt(numValue) > 2100)) {
                        e.target.value = numValue.slice(0, -1);
                        return;
                    }
                    input.value = numValue;
                    hiddenInput.value = numValue || '';
                }
                
                filterBirthdateDropdown(input, dropdown, type);
                if (value && !parent.classList.contains('is-open')) {
                    parent.classList.add('is-open');
                    toggle.setAttribute('aria-expanded', 'true');
                }
                
                // Trigger day update if month/year changed
                if (type === 'month' || type === 'year') {
                    setTimeout(() => updateDaysForSelectedMonth(), 100);
                }
            });

            // Select item
            function attachItemHandlers() {
                dropdown.querySelectorAll('.birthdate-item').forEach(item => {
                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const value = item.dataset.value;
                        const text = item.dataset.text || item.textContent;
                        hiddenInput.value = value;
                        input.value = text;
                        parent.classList.remove('is-open');
                        toggle.setAttribute('aria-expanded', 'false');
                        
                        // Trigger day update if month/year changed
                        if (type === 'month' || type === 'year') {
                            setTimeout(() => updateDaysForSelectedMonth(), 100);
                        }
                    });
                });
            }

            attachItemHandlers();
            
            // Re-attach handlers when dropdown content changes (for day dropdowns)
            if (type === 'day') {
                const observer = new MutationObserver(() => {
                    attachItemHandlers();
                });
                observer.observe(dropdown, { childList: true });
            }
        }

        function matchMonth(value) {
            const months = [
                { value: '1', text: 'January', abbr: 'jan' },
                { value: '2', text: 'February', abbr: 'feb' },
                { value: '3', text: 'March', abbr: 'mar' },
                { value: '4', text: 'April', abbr: 'apr' },
                { value: '5', text: 'May', abbr: 'may' },
                { value: '6', text: 'June', abbr: 'jun' },
                { value: '7', text: 'July', abbr: 'jul' },
                { value: '8', text: 'August', abbr: 'aug' },
                { value: '9', text: 'September', abbr: 'sep' },
                { value: '10', text: 'October', abbr: 'oct' },
                { value: '11', text: 'November', abbr: 'nov' },
                { value: '12', text: 'December', abbr: 'dec' }
            ];
            const lowerValue = value.toLowerCase().trim();
            return months.find(m => 
                m.text.toLowerCase().startsWith(lowerValue) || 
                m.abbr === lowerValue ||
                m.value === lowerValue
            );
        }

        function filterBirthdateDropdown(input, dropdown, type) {
            const searchTerm = input.value.toLowerCase().trim();
            const items = dropdown.querySelectorAll('.birthdate-item');
            let hasVisible = false;
            
            items.forEach(item => {
                const text = (item.dataset.text || item.textContent).toLowerCase();
                const value = item.dataset.value.toLowerCase();
                const matches = !searchTerm || text.includes(searchTerm) || text.startsWith(searchTerm) || value === searchTerm;
                item.style.display = matches ? 'flex' : 'none';
                if (matches) hasVisible = true;
            });
            
            // Show "No results" if no matches
            let noResults = dropdown.querySelector('.no-results');
            if (!hasVisible && searchTerm) {
                if (!noResults) {
                    noResults = document.createElement('div');
                    noResults.className = 'no-results';
                    noResults.textContent = 'No results found';
                    noResults.style.padding = '10px 16px';
                    noResults.style.color = 'var(--muted)';
                    noResults.style.fontSize = '14px';
                    dropdown.appendChild(noResults);
                }
            } else if (noResults) {
                noResults.remove();
            }
        }

        // Initialize all birthdate combos
        initBirthdateCombo('birthDayInput', 'birthDayToggle', 'birthDayDropdown', 'birthDay', 'day');
        initBirthdateCombo('birthMonthInput', 'birthMonthToggle', 'birthMonthDropdown', 'birthMonth', 'month');
        initBirthdateCombo('birthYearInput', 'birthYearToggle', 'birthYearDropdown', 'birthYear', 'year');
    }

    function updateDaysForSelectedMonth() {
        // Update signup day dropdown
        const birthMonthInput = document.getElementById('birthMonth');
        const birthYearInput = document.getElementById('birthYear');
        const birthDayDropdown = document.getElementById('birthDayDropdown');
        const birthDayValue = document.getElementById('birthDayValue');
        const birthDayInput = document.getElementById('birthDay');

        if (birthMonthInput && birthYearInput && birthDayDropdown) {
            const month = parseInt(birthMonthInput.value);
            const year = parseInt(birthYearInput.value);
            if (month && year) {
                const daysInMonth = new Date(year, month, 0).getDate();
                const currentDay = parseInt(birthDayInput?.value || 0);
                
                birthDayDropdown.innerHTML = '';
                for (let i = 1; i <= daysInMonth; i++) {
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'birthdate-item';
                    item.dataset.value = i;
                    item.textContent = i;
                    birthDayDropdown.appendChild(item);
                    
                    // Attach click handler
                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const value = item.dataset.value;
                        if (birthDayInput) birthDayInput.value = value;
                        if (birthDayValue) birthDayValue.textContent = i;
                        const parentEl = item.closest('.birthdate-dropdown-parent');
                        if (parentEl) {
                            parentEl.classList.remove('is-open');
                            const toggle = parentEl.querySelector('.birthdate-toggle');
                            if (toggle) toggle.setAttribute('aria-expanded', 'false');
                        }
                    });
                }
                
                // Reset if current day is invalid
                if (currentDay > daysInMonth && birthDayInput && birthDayValue) {
                    birthDayInput.value = '';
                    birthDayValue.textContent = 'Day';
                }
            }
        }

    }

    // Initialize birthdate dropdowns on load
    initBirthdateDropdowns();

    // Respect #signup or #login in URL to preselect tab
    (function selectTabFromHash() {
        const hash = (window.location.hash || '').toLowerCase();
        if (hash === '#signup') {
            switchTab('signup');
        } else if (hash === '#login') {
            switchTab('login');
        }
    })();

    // Tab switching
    function switchTab(tab) {
        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        if (tab === 'login') {
            loginTab.classList.add('active');
            loginForm.classList.add('active');
            signupForm.classList.remove('active');
        } else {
            signupTab.classList.add('active');
            signupForm.classList.add('active');
            loginForm.classList.remove('active');
        }
        // Clear messages and errors
        clearMessage();
        clearErrors();
    }

    if (loginTab) {
        loginTab.addEventListener('click', () => switchTab('login'));
    }
    if (signupTab) {
        signupTab.addEventListener('click', () => switchTab('signup'));
    }


    // Show error message
    function showError(inputId, message) {
        const errorEl = document.querySelector(`[data-error="${inputId}"]`);
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.classList.add('show');
        }
        
        const input = document.getElementById(inputId);
        if (input) {
            input.style.borderColor = 'var(--error)';
        }
    }

    // Clear error
    function clearError(inputId) {
        const errorEl = document.querySelector(`[data-error="${inputId}"]`);
        if (errorEl) {
            errorEl.textContent = '';
            errorEl.classList.remove('show');
        }
        
        const input = document.getElementById(inputId);
        if (input) {
            input.style.borderColor = '';
        }
    }

    // Clear all errors
    function clearErrors() {
        document.querySelectorAll('.form-error').forEach(el => {
            el.textContent = '';
            el.classList.remove('show');
        });
        document.querySelectorAll('.form-input, .form-select').forEach(el => {
            el.style.borderColor = '';
        });
    }

    // Show message
    function showMessage(text, type = 'error') {
        authMessage.textContent = text;
        authMessage.className = `auth-message ${type} show`;
        setTimeout(() => {
            authMessage.classList.remove('show');
        }, 5000);
    }

    // Clear message
    function clearMessage() {
        authMessage.textContent = '';
        authMessage.classList.remove('show', 'success', 'error');
    }

    // Set loading state
    function setLoading(button, loading) {
        if (loading) {
            button.classList.add('loading');
            button.disabled = true;
        } else {
            button.classList.remove('loading');
            button.disabled = false;
        }
    }

    // Login form handler
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearErrors();
            clearMessage();

            const firstname = document.getElementById('loginFirstname').value.trim();
            const lastname = document.getElementById('loginLastname').value.trim();
            const accessCode = document.getElementById('loginAccessCode').value.trim().toUpperCase();
            const submitBtn = document.getElementById('loginSubmit');

            // Validate required fields
            let hasError = false;
            if (!firstname) {
                showError('loginFirstname', 'First name is required');
                hasError = true;
            }
            if (!lastname) {
                showError('loginLastname', 'Last name is required');
                hasError = true;
            }
            // no phone required for login
            if (!accessCode || accessCode.length !== 6) {
                showError('loginAccessCode', 'Access code is required (6 characters: 4 letters + 2 numbers)');
                hasError = true;
            }

            if (hasError) {
                return;
            }

            setLoading(submitBtn, true);

            try {
                // Create timeout controller (fallback for browsers without AbortSignal.timeout)
                // Increased timeout to 15 seconds to account for retry logic and backend cold starts
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000);
                
                const response = await fetch(`${API_BASE}/api/login`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                        firstname,
                        lastname,
                        access_code: accessCode
                    }),
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);

                // Check if response is OK before parsing JSON
                if (!response.ok) {
                    let errorMessage = 'Login failed';
                    try {
                        const errorData = await response.json();
                        errorMessage = errorData.message || errorMessage;
                    } catch (e) {
                        errorMessage = `Server error: ${response.status} ${response.statusText}`;
                    }
                    
                    if (errorMessage.toLowerCase().includes('access code')) {
                        showError('loginAccessCode', errorMessage);
                    } else if (errorMessage.toLowerCase().includes('sign up')) {
                        showMessage(errorMessage, 'error');
                    } else {
                        showMessage(errorMessage, 'error');
                    }
                    return;
                }

                const data = await response.json();

                if (data.success) {
                    showMessage(data.message || 'Login successful! Redirecting...', 'success');
                    
                    // Store access code in sessionStorage for header-based fallback (if cookies fail)
                    if (data.user && data.user.access_code) {
                        try {
                            const codeUpper = data.user.access_code.toUpperCase().trim();
                            sessionStorage.setItem('user_access_code_fallback', codeUpper);
                            // Also store as token in localStorage for compatibility
                            localStorage.setItem('token', codeUpper);
                            console.log('Access code stored:', codeUpper);
                        } catch (e) {
                            console.warn('Could not store access code:', e);
                        }
                    }
                    
                    // ALWAYS show access code from response immediately (fastest)
                    if (data.user && data.user.access_code) {
                        const codeToShow = data.user.access_code;
                        const showCode = () => {
                            const circle = document.getElementById('accessCodeCircle');
                            const display = document.getElementById('acCodeDisplay');
                            if (circle && display) {
                                display.textContent = codeToShow;
                                circle.style.display = 'block';
                                circle.style.visibility = 'visible';
                                circle.style.opacity = '1';
                                circle.style.zIndex = '10000';
                    setTimeout(() => {
                                    circle.classList.add('show-popup');
                                }, 100);
                                console.log('Access code displayed from response:', codeToShow);
                            }
                        };
                        // Show immediately with multiple retries
                        showCode();
                        setTimeout(showCode, 50);
                        setTimeout(showCode, 200);
                        setTimeout(showCode, 500);
                    }
                    
                    // Also fetch from server with retries to ensure it's always visible
                    // Wait a bit for session to be fully established
                    await new Promise(resolve => setTimeout(resolve, 500));
                    const loaded = await loadAccessCode();
                    
                    // If server fetch succeeded, it will have updated the display
                    // If it failed, the response-based display above should still work
                    if (!loaded && data.user && data.user.access_code) {
                        console.warn('Server fetch failed, but response-based display should work');
                    }
                    
                    // Clear only stale vote cache (not all localStorage)
                    try {
                        // Only clear vote-related cache, keep other data
                        const voteCacheTimestamp = localStorage.getItem('vote_cache_timestamp');
                        if (voteCacheTimestamp) {
                            const cacheAge = Date.now() - parseInt(voteCacheTimestamp, 10);
                            // Only clear if cache is older than 1 hour
                            if (cacheAge > 3600000) {
                                localStorage.removeItem('vote_cache_timestamp');
                                localStorage.removeItem('cached_votes');
                            }
                        }
                        localStorage.removeItem('votes_reset');
                    } catch (_) {}
                    
                    // CRITICAL: Give user time to see and copy their access code before redirect
                    // Access code is vital - users need at least 5 seconds to see and save it
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    
                    // Redirect to Vote page
                    window.location.replace('../Vote/index.html');
                } else {
                    if (data.message && data.message.toLowerCase().includes('access code')) {
                        showError('loginAccessCode', data.message);
                    } else if (data.message && data.message.toLowerCase().includes('sign up')) {
                        showMessage(data.message, 'error');
                    } else {
                    showMessage(data.message || 'Login failed. Please try again.', 'error');
                    }
                }
            } catch (error) {
                console.error('Login error:', error);
                console.error('API_BASE:', API_BASE);
                console.error('Error details:', {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                });
                
                let errorMsg = 'Network error. Please check your connection and ensure the backend is running.';
                
                if (error.name === 'AbortError' || error.name === 'TimeoutError') {
                    errorMsg = 'Request timed out. The backend may be starting up. Please wait a moment and try again.';
                } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
                    // Check if it's a CORS error
                    if (error.message.includes('CORS') || error.message.includes('Failed to fetch')) {
                        errorMsg = 'Cannot connect to backend server. This may be a CORS or network issue. Please check your connection.';
                    } else {
                        errorMsg = `Cannot connect to backend server at ${API_BASE}. Please check your connection and ensure the backend is running.`;
                    }
                } else if (error.message && error.message.includes('CORS')) {
                    errorMsg = 'CORS error: The backend may not be configured to accept requests from this origin.';
                }
                
                showMessage(errorMsg, 'error');
            } finally {
                setLoading(submitBtn, false);
            }
        });
    }

    // Signup form handler
    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearErrors();
            clearMessage();

            const firstname = document.getElementById('signupFirstname').value.trim();
            const lastname = document.getElementById('signupLastname').value.trim();
            const phone = document.getElementById('signupPhone').value.replace(/\D/g, '').trim();
            const countryCode = document.getElementById('signupCountryCode').value;
            const email = document.getElementById('signupEmail').value.trim();
            const day = parseInt(document.getElementById('birthDay').value) || parseInt(document.getElementById('birthDayInput')?.value);
            const month = parseInt(document.getElementById('birthMonth').value) || parseInt(document.getElementById('birthMonthInput')?.value);
            const year = parseInt(document.getElementById('birthYear').value) || parseInt(document.getElementById('birthYearInput')?.value);
            const submitBtn = document.getElementById('signupSubmit');

            // Validate required fields
            let hasError = false;
            if (!firstname) {
                showError('signupFirstname', 'First name is required');
                hasError = true;
            }
            if (!lastname) {
                showError('signupLastname', 'Last name is required');
                hasError = true;
            }
            if (!phone) {
                showError('signupPhone', 'Phone number is required');
                hasError = true;
            }
            if (!day || !month || !year) {
                showError('birthdate', 'Please select your birthdate');
                hasError = true;
            }

            if (hasError) {
                return;
            }

            // Validate email if provided
            if (email && !email.includes('@')) {
                showError('signupEmail', 'Please enter a valid email address');
                return;
            }

            setLoading(submitBtn, true);

            try {
                // Create timeout controller (fallback for browsers without AbortSignal.timeout)
                // Increased timeout to 15 seconds to account for retry logic and backend cold starts
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000);
                
                const response = await fetch(`${API_BASE}/api/signup`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                        firstname,
                        lastname,
                        phone,
                        country_code: countryCode,
                        email: email || null,
                        day,
                        month,
                        year
                    }),
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);

                // Check if response is OK before parsing JSON
                if (!response.ok) {
                    let errorMessage = 'Signup failed';
                    try {
                        const errorData = await response.json();
                        errorMessage = errorData.message || errorMessage;
                    } catch (e) {
                        errorMessage = `Server error: ${response.status} ${response.statusText}`;
                    }
                    
                    if (errorMessage.toLowerCase().includes('phone')) {
                        showError('signupPhone', errorMessage);
                    } else if (errorMessage.toLowerCase().includes("cant create an account")) {
                        showError('signupFirstname', errorMessage);
                        showError('signupPhone', errorMessage);
                    } else if (errorMessage.includes('email')) {
                        showError('signupEmail', errorMessage);
                    } else {
                        showError('signupFirstname', errorMessage);
                    }
                    showMessage(errorMessage, 'error');
                    return;
                }

                const data = await response.json();

                if (data.success) {
                    showMessage(data.message || 'Account created successfully! Redirecting...', 'success');
                    
                    // Store access code in sessionStorage for header-based fallback (if cookies fail)
                    if (data.user && data.user.access_code) {
                        try {
                            const codeUpper = data.user.access_code.toUpperCase().trim();
                            sessionStorage.setItem('user_access_code_fallback', codeUpper);
                            // Also store as token in localStorage for compatibility
                            localStorage.setItem('token', codeUpper);
                            console.log('Access code stored:', codeUpper);
                        } catch (e) {
                            console.warn('Could not store access code:', e);
                        }
                    }
                    
                    // ALWAYS show access code from response immediately (fastest)
                    if (data.user && data.user.access_code) {
                        const codeToShow = data.user.access_code;
                        const showCode = () => {
                            const circle = document.getElementById('accessCodeCircle');
                            const display = document.getElementById('acCodeDisplay');
                            if (circle && display) {
                                display.textContent = codeToShow;
                                circle.style.display = 'block';
                                circle.style.visibility = 'visible';
                                circle.style.opacity = '1';
                                circle.style.zIndex = '10000';
                    setTimeout(() => {
                                    circle.classList.add('show-popup');
                                }, 100);
                                console.log('Access code displayed from response:', codeToShow);
                            }
                        };
                        // Show immediately with multiple retries
                        showCode();
                        setTimeout(showCode, 50);
                        setTimeout(showCode, 200);
                        setTimeout(showCode, 500);
                    }
                    
                    // Also fetch from server with retries to ensure it's always visible
                    // Wait a bit for session to be fully established
                    await new Promise(resolve => setTimeout(resolve, 500));
                    const loaded = await loadAccessCode();
                    
                    // If server fetch succeeded, it will have updated the display
                    // If it failed, the response-based display above should still work
                    if (!loaded && data.user && data.user.access_code) {
                        console.warn('Server fetch failed, but response-based display should work');
                    }
                    
                    // Clear only stale vote cache (not all localStorage)
                    try {
                        // Only clear vote-related cache, keep other data
                        const voteCacheTimestamp = localStorage.getItem('vote_cache_timestamp');
                        if (voteCacheTimestamp) {
                            const cacheAge = Date.now() - parseInt(voteCacheTimestamp, 10);
                            // Only clear if cache is older than 1 hour
                            if (cacheAge > 3600000) {
                                localStorage.removeItem('vote_cache_timestamp');
                                localStorage.removeItem('cached_votes');
                            }
                        }
                        localStorage.removeItem('votes_reset');
                    } catch (_) {}
                    
                    // CRITICAL: Give user time to see and copy their access code before redirect
                    // Access code is vital - users need at least 5 seconds to see and save it
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    
                    // Redirect to Vote page
                    window.location.replace('../Vote/index.html');
                } else {
                    if (data.message && data.message.toLowerCase().includes('phone')) {
                        showError('signupPhone', data.message);
                    } else if (data.message && data.message.toLowerCase().includes("cant create an account")) {
                        showError('signupFirstname', data.message);
                        showError('signupPhone', data.message);
                    } else if (data.message && data.message.includes('email')) {
                        showError('signupEmail', data.message);
                    } else {
                        showError('signupFirstname', data.message || 'Signup failed. Please try again.');
                    }
                    showMessage(data.message || 'Signup failed. Please try again.', 'error');
                }
            } catch (error) {
                console.error('Signup error:', error);
                console.error('API_BASE:', API_BASE);
                console.error('Error details:', {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                });
                
                let errorMsg = 'Network error. Please check your connection and ensure the backend is running.';
                
                if (error.name === 'AbortError' || error.name === 'TimeoutError') {
                    errorMsg = 'Request timed out. The backend may be starting up. Please wait a moment and try again.';
                } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
                    // Check if it's a CORS error
                    if (error.message.includes('CORS') || error.message.includes('Failed to fetch')) {
                        errorMsg = 'Cannot connect to backend server. This may be a CORS or network issue. Please check your connection.';
                    } else {
                        errorMsg = `Cannot connect to backend server at ${API_BASE}. Please check your connection and ensure the backend is running.`;
                    }
                } else if (error.message && error.message.includes('CORS')) {
                    errorMsg = 'CORS error: The backend may not be configured to accept requests from this origin.';
                }
                
                showError('signupFirstname', errorMsg);
                showMessage(errorMsg, 'error');
            } finally {
                setLoading(submitBtn, false);
            }
        });
    }

    // Load access code from server - ALWAYS use session cookie (most reliable)
    async function loadAccessCode(retryCount = 0) {
        try {
            const maxRetries = 5; // Increased retries
            const retryDelays = [300, 600, 1000, 1500, 2000]; // Progressive delays
            
            // Always try with session cookie first (most reliable)
            const response = await fetch(`${API_BASE}/get_access_code`, {
                method: "GET",
                credentials: 'include',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });

            if (response.ok) {
                const data = await response.json();
                if (data.access_code) {
                    // Use multiple attempts to find and update elements
                    let updated = false;
                    for (let attempt = 0; attempt < 5; attempt++) {
                        const circle = document.getElementById('accessCodeCircle');
                        const display = document.getElementById('acCodeDisplay');
                        if (circle && display) {
                            display.textContent = data.access_code;
                            circle.style.display = 'block';
                            circle.style.visibility = 'visible';
                            circle.style.opacity = '1';
                            circle.style.zIndex = '10000'; // Ensure it's on top
                            setTimeout(() => {
                                circle.classList.add('show-popup');
                            }, 100);
                            console.log('Access code loaded and displayed:', data.access_code);
                            updated = true;
                            break;
                        }
                        // Wait a bit and retry finding elements
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                    if (updated) {
                        return true; // Success
                    } else {
                        console.warn('Access code elements not found after multiple attempts');
                    }
                } else {
                    console.log("Access code missing from response:", data);
                }
            } else if (response.status === 401 && retryCount < maxRetries) {
                // Session might not be established yet, retry with delay
                console.log(`Session not ready, retrying in ${retryDelays[retryCount]}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, retryDelays[retryCount]));
                return await loadAccessCode(retryCount + 1);
            } else {
                console.warn('Failed to load access code:', response.status, response.statusText);
            }
        } catch (error) {
            console.error("Error loading access code:", error);
            // Retry on network errors
            if (retryCount < maxRetries - 1) {
                const retryDelays = [300, 600, 1000, 1500, 2000];
                await new Promise(resolve => setTimeout(resolve, retryDelays[retryCount] || 1000));
                return await loadAccessCode(retryCount + 1);
            }
        }
        return false;
    }

    // Check if user is already logged in
    async function checkSession() {
        try {
            const response = await fetch(`${API_BASE}/api/check-session`, {
                method: 'GET',
                credentials: 'include'
            });

            const data = await response.json();

            if (data.logged_in && data.user) {
                // User is logged in, clear stale cache and redirect to Vote page
                try {
                    localStorage.removeItem('vote_cache_timestamp');
                    localStorage.removeItem('cached_votes');
                    localStorage.removeItem('votes_reset');
                } catch (_) {}
                window.location.replace('../Vote/index.html');
            }
        } catch (error) {
            console.error('Session check error:', error);
            // Continue with login/signup if check fails
        }
    }

    // Check for inactivity logout message
    (function() {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('inactivity') === '1') {
            // Show inactivity message
            const messageDiv = document.createElement('div');
            messageDiv.style.cssText = `
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: var(--warning);
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
            
            // Remove message after 5 seconds
            setTimeout(() => {
                messageDiv.remove();
            }, 5000);
            
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    })();

    // Check session on page load
    checkSession();

    // Initialize country code combo boxes
    function initCountryCodeCombo(inputId, toggleId, dropdownId, hiddenInputId) {
        const input = document.getElementById(inputId);
        const toggle = document.getElementById(toggleId);
        const dropdown = document.getElementById(dropdownId);
        const hiddenInput = document.getElementById(hiddenInputId);
        const parent = input?.closest('.country-code-combo');

        if (!input || !toggle || !dropdown || !hiddenInput || !parent) return;

        // Toggle dropdown
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = parent.classList.contains('is-open');
            closeAllCombos();
            if (!isOpen) {
                parent.classList.add('is-open');
                toggle.setAttribute('aria-expanded', 'true');
                filterDropdown(input, dropdown);
            }
        });

        // Filter dropdown on input
        input.addEventListener('input', (e) => {
            const value = e.target.value.trim();
            hiddenInput.value = value;
            filterDropdown(input, dropdown);
            if (value && !parent.classList.contains('is-open')) {
                parent.classList.add('is-open');
                toggle.setAttribute('aria-expanded', 'true');
            }
        });

        // Select country code
        dropdown.querySelectorAll('.country-code-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const value = item.dataset.value;
                input.value = value;
                hiddenInput.value = value;
                parent.classList.remove('is-open');
                toggle.setAttribute('aria-expanded', 'false');
            });
        });
    }

    function filterDropdown(input, dropdown) {
        const searchTerm = input.value.toLowerCase().trim();
        const items = dropdown.querySelectorAll('.country-code-item');
        let hasVisible = false;
        
        items.forEach(item => {
            const text = item.textContent.toLowerCase();
            const value = item.dataset.value.toLowerCase();
            const matches = !searchTerm || text.includes(searchTerm) || value.includes(searchTerm);
            item.style.display = matches ? 'flex' : 'none';
            if (matches) hasVisible = true;
        });
        
        // Show "No results" if no matches
        let noResults = dropdown.querySelector('.no-results');
        if (!hasVisible && searchTerm) {
            if (!noResults) {
                noResults = document.createElement('div');
                noResults.className = 'no-results';
                noResults.textContent = 'No results found';
                noResults.style.padding = '10px 16px';
                noResults.style.color = 'var(--muted)';
                noResults.style.fontSize = '14px';
                dropdown.appendChild(noResults);
            }
        } else if (noResults) {
            noResults.remove();
        }
    }

    function closeAllCombos() {
        document.querySelectorAll('.country-code-combo, .birthdate-combo').forEach(parent => {
            parent.classList.remove('is-open');
            const toggle = parent.querySelector('.combo-dropdown-btn');
            if (toggle) toggle.setAttribute('aria-expanded', 'false');
        });
    }

    // Close combos when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.country-code-combo') && !e.target.closest('.birthdate-combo')) {
            closeAllCombos();
        }
    });

    // Phone formatting rules per country code
    const COUNTRY_PHONE_RULES = {
        '+234': { max: 10, groups: [3,3,4] },   // Nigeria now 10 digits (e.g. 7026499743)
        '+1':   { max: 10, groups: [3,3,4] },   // US/Canada
        '+44':  { max: 10, groups: [3,3,4] },
        '+233': { max: 9,  groups: [3,3,3] },
        '+254': { max: 9,  groups: [3,3,3] },
        '+27':  { max: 9,  groups: [3,3,3] },
        '+91':  { max: 10, groups: [3,3,4] },
        '+86':  { max: 11, groups: [3,4,4] },
        '+81':  { max: 10, groups: [3,3,4] },
        '+49':  { max: 11, groups: [3,4,4] },
        '+33':  { max: 9,  groups: [3,3,3] },
        '+39':  { max: 10, groups: [3,3,4] },
        '+61':  { max: 9,  groups: [3,3,3] },
        '+55':  { max: 11, groups: [3,4,4] },
        '+52':  { max: 10, groups: [3,3,4] },
    };

    function formatPhone(countryCode, digits) {
        const rule = COUNTRY_PHONE_RULES[countryCode] || { max: 10, groups: [3,3,4] };
        const trimmed = digits.slice(0, rule.max);
        const parts = [];
        let idx = 0;
        for (let i = 0; i < rule.groups.length && idx < trimmed.length; i++) {
            const len = rule.groups[i];
            parts.push(trimmed.substring(idx, idx + len));
            idx += len;
        }
        if (parts.length === 0) return '';
        if (parts.length === 1) return `(${parts[0]}`;
        if (parts.length === 2) return `(${parts[0]}) ${parts[1]}`;
        return `(${parts[0]}) ${parts[1]}-${parts[2]}`;
    }

    function attachPhoneMask(inputId, countryHiddenId) {
        const input = document.getElementById(inputId);
        const countryHidden = document.getElementById(countryHiddenId);
        if (!input || !countryHidden) return;
        const update = () => {
            const countryCode = countryHidden.value || '+234';
            const digitsOnly = input.value.replace(/\D/g, '');
            input.value = formatPhone(countryCode, digitsOnly);
            // Update placeholder with randomized inactive sample
            input.placeholder = randomSampleForCountry(countryCode);
        };
        input.addEventListener('input', update);

        // Prevent typing more digits than the country's max
        input.addEventListener('keydown', (e) => {
            const allowedKeys = ['Backspace','Delete','ArrowLeft','ArrowRight','Tab','Home','End'];
            if (allowedKeys.includes(e.key) || (e.ctrlKey || e.metaKey)) return;
            const isDigit = /\d/.test(e.key);
            if (!isDigit) return; // non digit filtered later by masking
            const countryCode = countryHidden.value || '+234';
            const rule = COUNTRY_PHONE_RULES[countryCode] || { max: 10 };
            const currentDigits = input.value.replace(/\D/g, '');
            if (currentDigits.length >= rule.max) {
                e.preventDefault();
            }
        });
        update();
    }

    // Initialize country code combos
    initCountryCodeCombo('signupCountryCodeInput', 'signupCountryCodeToggle', 'signupCountryCodeDropdown', 'signupCountryCode');

    // Attach phone masks
    attachPhoneMask('signupPhone', 'signupCountryCode');

    // When country code changes via dropdown, reformat phone immediately
    function onCountryChanged(hiddenId, inputId) {
        const hidden = document.getElementById(hiddenId);
        const input = document.getElementById(inputId);
        if (!hidden || !input) return;
        const digits = input.value.replace(/\D/g, '');
        input.value = formatPhone(hidden.value, digits);
        input.placeholder = randomSampleForCountry(hidden.value);
    }
    function randomSampleForCountry(countryCode) {
        const rule = COUNTRY_PHONE_RULES[countryCode] || { max: 10, groups: [3,3,4] };
        // generate random digits with plausible starting patterns per country
        let digits = '';
        const starts = {
            '+234': ['702','703','704','705','706','707','708','809','813','814','816','903','906'],
            '+1':   ['201','415','617','718','801','917','305'],
            '+44':  ['020','016','012','013','014'],
        };
        const start = (starts[countryCode] || ['555'])[Math.floor(Math.random() * (starts[countryCode]?.length || 1))];
        digits += start;
        while (digits.length < rule.max) {
            digits += Math.floor(Math.random() * 10).toString();
        }
        digits = digits.slice(0, rule.max);
        return formatPhone(countryCode, digits);
    }

    // Access Code Circle Functionality
    if (acCircleBtn) {
        acCircleBtn.addEventListener('click', () => {
            const circle = document.getElementById('accessCodeCircle');
            circle?.classList.toggle('show-popup');
        });
    }

    if (acClose) {
        acClose.addEventListener('click', () => {
            const circle = document.getElementById('accessCodeCircle');
            circle?.classList.remove('show-popup');
        });
    }

    // Close popup when clicking outside
    if (accessCodeCircle) {
        document.addEventListener('click', (e) => {
            if (!accessCodeCircle.contains(e.target) && accessCodeCircle.classList.contains('show-popup')) {
                accessCodeCircle.classList.remove('show-popup');
            }
        });
    }

    // Show access code after successful signup (no localStorage storage)
    function showAccessCode(code) {
        if (accessCodeCircle && acCodeDisplay) {
            acCodeDisplay.textContent = code;
            accessCodeCircle.style.display = 'block';
            // Auto-show popup once
            setTimeout(() => {
                accessCodeCircle.classList.add('show-popup');
            }, 500);
        }
    }

    // Access code input - auto uppercase and limit to 6 characters (4 letters + 2 numbers)
    const loginAccessCodeInput = document.getElementById('loginAccessCode');
    if (loginAccessCodeInput) {
        loginAccessCodeInput.addEventListener('input', (e) => {
            let value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            // Limit to 6 characters
            if (value.length > 6) value = value.substring(0, 6);
            e.target.value = value;
            clearError('loginAccessCode');
        });
    }

    // Real-time validation
    document.querySelectorAll('.form-input, .form-select').forEach(input => {
        const inputId = input.id;
        input.addEventListener('blur', () => {
            if (inputId && input.required && !input.value.trim()) {
                showError(inputId, 'This field is required');
            } else {
                clearError(inputId);
            }
        });

        input.addEventListener('input', () => {
            if (input.style.borderColor === 'var(--error)') {
                clearError(inputId);
            }
        });
    });

})();

