(() => {
    const API_BASE = window.API_BASE || ((window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1'))
        ? 'http://127.0.0.1:5000'
        : window.location.origin);
    let categoriesData = [];

    function generatePlaceholderImage(name) {
        const colors = ['#c9a227', '#b38a10', '#8b6914', '#6b4f0a'];
        const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const color = colors[hash % colors.length];
        return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="60" fill="${color}"/><text x="60" y="70" font-family="Arial" font-size="40" font-weight="bold" fill="white" text-anchor="middle">${name.charAt(0).toUpperCase()}</text></svg>`)}`;
    }

    const categoryImageMap = {
        "PEACEMAKER AWARDS": "peaceimage.jpeg",
        "YSA OF THE YEAR (MALE)": "ysamale.jpeg",
        "YSA OF THE YEAR (FEMALE)": "ysafemale.jpeg",
        "ENTREPRENEUR OF THE YEAR": "enterpreneur.jpeg",
        "MUSICAL VOICE AWARDS": "musical.jpeg",
        "BEST DRESSED MALE": "dressedmale.jpeg",
        "BEST DRESSED FEMALE": "dressedfemale.jpeg",
        "YSA PARTICIPATION AWARD": "active.jpeg",
        "MOST CHRISTLIKE AWARD": "christlike.jpeg",
        "LEADERSHIP APPRECIATION AWARD": "leadership.jpeg"
    };

    function getCategoryImage(categoryTitle) {
        const file = categoryImageMap[categoryTitle];
        if (!file) return null;
        // Vote page lives in /Vote, images live at /images/category
        return `../images/category/${file}`;
    }

    function getBackgroundPosition(categoryTitle) {
        // Default focus
        let pos = 'center';
        if (categoryTitle === 'BEST DRESSED FEMALE') pos = 'center 8%'; // show more upper
        else if (categoryTitle === 'BEST DRESSED MALE') pos = 'center 85%'; // more lower (unchanged)
        else if (categoryTitle === 'YSA OF THE YEAR (FEMALE)') pos = 'center 90%'; // show more lower
        return pos;
    }

    function createCategoryCard(category) {
        const card = document.createElement('div');
        card.className = 'category-card';
        card.dataset.categoryId = category.number;

        // Background image per category with a soft overlay fallback
        const imgSrc = getCategoryImage(category.title);
        const hue = (category.number * 36) % 360; // keeps distinct accent if image missing
        const gradient = `linear-gradient(135deg, hsl(${hue}, 70%, 45%) 0%, hsl(${hue}, 70%, 30%) 100%)`;
        const backgroundStyle = imgSrc
            ? `background-image: linear-gradient(rgba(0,0,0,0.08), rgba(0,0,0,0.08)), url('${imgSrc}'); background-size: cover; background-position: ${getBackgroundPosition(category.title)};`
            : `background: ${gradient};`;

        card.innerHTML = `
            <div class="category-image" style="${backgroundStyle}">
                <div style="background: rgba(0,0,0,0.10); width: 100%; height: 100%;"></div>
            </div>
            <div class="category-header">
                <div>
                    <div class="category-number">Category ${category.number}</div>
                    <h2 class="category-title">${category.title}</h2>
                </div>
                <button class="category-toggle" aria-label="Toggle category">▼</button>
            </div>
            <div class="category-content">
                <div class="nominees-list">
                    ${category.nominees.map((nominee, idx) => `
                        <div class="nominee-card">
                            <img src="${generatePlaceholderImage(nominee)}" alt="${nominee}" class="nominee-image" />
                            <div class="nominee-name">${nominee}</div>
                            <button class="vote-btn" data-nominee="${nominee}" data-nominee-index="${idx}" data-category="${category.number}">
                                Vote
                            </button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        return card;
    }

    function updateOpenCategoryToast() {
        const toast = document.querySelector('.open-category-toast');
        if (!toast) return;
        const openCard = document.querySelector('.category-card.is-open');
        if (openCard) {
            const titleEl = openCard.querySelector('.category-title');
            const title = titleEl ? titleEl.textContent.trim() : '';
            toast.textContent = title ? `${title} is currently open` : 'A category is currently open';
            toast.classList.add('is-visible');
            toast.removeAttribute('hidden');
        } else {
            toast.classList.remove('is-visible');
            toast.setAttribute('hidden', '');
        }
    }

    let categoriesInitialized = false;
    
    function initializeCategories() {
        // Prevent multiple initializations
        if (categoriesInitialized) {
            console.warn('Categories already initialized, skipping...');
            return;
        }
        
        const grid = document.getElementById('categories-grid');
        if (!grid) {
            console.error('Categories grid not found');
            return;
        }

        if (!categoriesData || categoriesData.length === 0) {
            console.error('No categories data available', categoriesData);
            grid.innerHTML = '<p style="text-align: center; padding: 40px; color: var(--muted);">Categories failed to load. Please refresh the page.</p>';
            return;
        }

        // Clear existing categories to prevent duplicates
        grid.innerHTML = '';
        console.log(`Initializing ${categoriesData.length} categories...`);

        categoriesData.forEach(category => {
            const card = createCategoryCard(category);
            grid.appendChild(card);
        });

        // Helpers to enforce single-open behavior
        function closeAllExcept(exceptCard) {
            document.querySelectorAll('.category-card.is-open').forEach(openCard => {
                if (openCard !== exceptCard) openCard.classList.remove('is-open');
            });
        }
        function toggleCategory(card) {
            const willOpen = !card.classList.contains('is-open');
            closeAllExcept(willOpen ? card : null);
            card.classList.toggle('is-open', willOpen);
            updateOpenCategoryToast();
        }

        // Add click handlers for category cards
        document.querySelectorAll('.category-card').forEach(card => {
            const toggle = card.querySelector('.category-toggle');
            card.addEventListener('click', (e) => {
                // Don't toggle if clicking on toggle button, vote buttons, or nominee cards
                if (e.target === toggle || (toggle && toggle.contains(e.target))) return;
                if (e.target.closest('.vote-btn')) return;
                if (e.target.closest('.nominee-card')) return;
                toggleCategory(card);
            });
            if (toggle) {
                toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleCategory(card);
                });
            }
        });

        // Add vote button handlers using event delegation for better reliability
        if (grid) {
            grid.addEventListener('click', async (e) => {
                const btn = e.target.closest('.vote-btn');
                if (!btn) return;
                
                e.stopPropagation();
                e.preventDefault();
                
                const nomineeName = btn.dataset.nominee;
                const categoryId = Number(btn.dataset.category);
                const nomineeIdx = Number(btn.dataset.nomineeIndex);

                // Prevent voting if already voted in this category
                if (btn.classList.contains('voted')) return;
                if (btn.getAttribute('data-locked') === 'true') return;
                if (btn.hasAttribute('disabled')) return;

                // Convert 0-based index to 1-based for backend (backend expects 1-based indices)
                const nomineeIdForBackend = nomineeIdx + 1;

                // Validate values before sending
                if (isNaN(categoryId) || isNaN(nomineeIdForBackend) || categoryId <= 0 || nomineeIdForBackend <= 0) {
                    console.error('Invalid vote data:', { categoryId, nomineeIdx, nomineeIdForBackend });
                    alert('Invalid vote data. Please try again.');
                    return;
                }

                try {
                    const resp = await fetch(`${API_BASE}/api/vote`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ category_id: categoryId, nominee_id: nomineeIdForBackend })
                    });
                    if (resp.status === 401) {
                        // Not logged in – show clear feedback and send to login
                        alert('Please log in to vote. You will be redirected to the login page.');
                        try {
                            // Preserve return path to categories after login
                            sessionStorage.setItem('postLoginRedirect', '../Vote/index.html');
                        } catch(_) {}
                        window.location.href = '../Auth/login.html#login';
                        return;
                    }
                    if (resp.status === 409) {
                        // Already voted
                        markCategoryVoted(categoryId);
                        console.info('You have already voted in this category.');
                        return;
                    }
                    if (!resp.ok) {
                        // Get error message from response if available
                        let errorMsg = 'Could not record your vote. Please try again.';
                        try {
                            const errorData = await resp.json();
                            if (errorData.message) {
                                errorMsg = errorData.message;
                            }
                        } catch (e) {
                            // If response is not JSON, use default message
                        }
                        console.error('Vote failed:', resp.status, errorMsg);
                        alert(errorMsg);
                        return;
                    }

                    // Success – mark as voted in UI and keep category open
                    markCategoryVoted(categoryId, nomineeName, nomineeIdx);
                    
                    // Ensure the category stays open after voting
                    const categoryCard = document.querySelector(`.category-card[data-category-id="${categoryId}"]`);
                    if (categoryCard && !categoryCard.classList.contains('is-open')) {
                        categoryCard.classList.add('is-open');
                        updateOpenCategoryToast();
                    }
                } catch (err) {
                    console.error(err);
                    alert('Network error. Please try again.');
                }
            });
        }

        // On load, disable categories already voted by this user
        refreshMyVotes();
        
        // Mark as initialized
        categoriesInitialized = true;
        console.log('Categories initialized successfully');
    }

    function markCategoryVoted(categoryId, nomineeName, nomineeIdx){
        document.querySelectorAll(`.vote-btn[data-category="${categoryId}"]`).forEach(b => {
            // lock all buttons to prevent further votes without changing their visual style
            b.setAttribute('data-locked','true');
            b.setAttribute('aria-disabled','true');
            b.setAttribute('disabled','disabled');
            // Only the chosen nominee gets the voted style/text
            const isChosen = (nomineeName && b.dataset.nominee === nomineeName) ||
                             (typeof nomineeIdx === 'number' && Number(b.dataset.nomineeIndex) === Number(nomineeIdx));
            if (isChosen){
                b.classList.add('voted');
                b.textContent = 'Voted ✓';
                b.removeAttribute('disabled'); // Allow the voted button to show its state
            } else {
                b.classList.remove('voted');
                b.textContent = 'Vote';
            }
        });
    }
    async function refreshMyVotes(){
        try {
            const resp = await fetch(`${API_BASE}/api/my-votes`, { credentials: 'include' });
            if (!resp.ok) return;
            const data = await resp.json();
            if (!data || !data.success) return;
            (data.votes || []).forEach(v => {
                const cid = Number(v.category_id);
                const backendNomineeId = Number(v.nominee_id); // This is 1-based from backend
                // Convert 1-based backend ID to 0-based frontend index
                const frontendNomineeIdx = backendNomineeId - 1;
                // resolve nominee name via DOM dataset or through index
                markCategoryVoted(cid, undefined, frontendNomineeIdx);
            });
        } catch (e) {
            // ignore
        }
    }

    // Year in footer
    const yearEl = document.querySelector('[data-year]');
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());

    // Active nav state
    const navLinks = document.querySelectorAll('[data-navlink]');
    function setActiveNav(target) {
        navLinks.forEach(a => a.classList.remove('is-current'));
        if (target) target.classList.add('is-current');
    }
    setActiveNav(document.querySelector('[data-navlink].active'));

    // Mobile nav toggle
    const navToggle = document.querySelector('.nav-toggle');
    const navList = document.querySelector('[data-nav]');
    const backdrop = document.querySelector('[data-backdrop]');

    function setMenuOpen(open) {
        if (!navList) return;
        if (open) navList.classList.add('is-open');
        else navList.classList.remove('is-open');
        if (backdrop) {
            if (open) backdrop.classList.add('is-visible');
            else backdrop.classList.remove('is-visible');
        }
        if (navToggle) navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    if (navToggle && navList) {
        navToggle.addEventListener('click', () => {
            const willOpen = !navList.classList.contains('is-open');
            setMenuOpen(willOpen);
        });
    }
    if (backdrop) backdrop.addEventListener('click', () => setMenuOpen(false));

    // Mobile dropdown toggle for Vote nav - using button approach
    const voteDropdownParent = document.querySelector('.nav-dropdown-parent');
    if (voteDropdownParent) {
        const voteMobileToggle = voteDropdownParent.querySelector('.vote-mobile-toggle');
        const voteDropdown = voteDropdownParent.querySelector('.nav-dropdown');
        const voteTopLink = voteDropdownParent.querySelector('a[data-vote-link]');
        
        // For mobile: toggle on button click
        function isMobile() {
            return window.matchMedia('(max-width: 767px)').matches;
        }
        
        if (voteMobileToggle && voteDropdown) {
            // Toggle dropdown when button is clicked (mobile only)
            voteMobileToggle.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                voteDropdownParent.classList.toggle('is-open');
            });
            
            // Also handle touch events for better mobile support
            voteMobileToggle.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                voteDropdownParent.classList.toggle('is-open');
            });
            
            // Close dropdown when clicking outside on mobile
            if (isMobile()) {
                const clickOutsideHandler = (e) => {
                    if (voteDropdownParent.classList.contains('is-open') && 
                        !voteDropdownParent.contains(e.target) && 
                        e.target !== voteMobileToggle) {
                        voteDropdownParent.classList.remove('is-open');
                    }
                };
                document.addEventListener('click', clickOutsideHandler);
                document.addEventListener('touchend', clickOutsideHandler);
            }
        }

        // Desktop only: prevent navigating when clicking the top "Vote" link
        if (voteTopLink) {
            const isDesktop = () => window.matchMedia('(min-width: 768px)').matches;
            voteTopLink.addEventListener('click', (e) => {
                if (!isDesktop()) return;
                e.preventDefault();
                // Optionally toggle dropdown open on click (desktop)
                voteDropdownParent.classList.toggle('is-open');
            });
            voteTopLink.addEventListener('keydown', (e) => {
                if (!isDesktop()) return;
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    voteDropdownParent.classList.toggle('is-open');
                }
            });
            // Close on click outside (desktop) when opened via click
            document.addEventListener('click', (e) => {
                if (!isDesktop()) return;
                if (voteDropdownParent.classList.contains('is-open') && !voteDropdownParent.contains(e.target)) {
                    voteDropdownParent.classList.remove('is-open');
                }
            });
        }
    }

    // Initialize - wait for categories to be loaded, with robust dynamic loading fallback
    let retryCount = 0;
    const maxRetries = 200; // 10 seconds max wait (200 * 50ms)
    let initializationStarted = false;
    let categoriesScriptInjected = false;

    function injectCategoriesScriptOnce() {
        if (categoriesScriptInjected) return;
        categoriesScriptInjected = true;
        const tried = new Set();
        const paths = [
            // Preferred: categories shipped under frontend root
            '../data/categories.js',
            // Fallback absolute from site origin when app is deployed at domain root
            `${window.location.origin}/frontend/data/categories.js`,
            // Legacy location if site root serves repo root
            `${window.location.origin}/data/categories.js`,
        ];
        paths.forEach((src) => {
            if (tried.has(src)) return; tried.add(src);
            const s = document.createElement('script');
            s.src = src;
            s.defer = true;
            s.onload = () => {
                if (window.CATEGORIES && Array.isArray(window.CATEGORIES) && window.CATEGORIES.length > 0) {
                    if (!initializationStarted) {
                        categoriesData = window.CATEGORIES.slice();
                        initializeCategories();
                        initializationStarted = true;
                    }
                }
            };
            document.head.appendChild(s);
        });
    }
    
    function waitForCategories() {
        // Check if categories are available
        if (window.CATEGORIES && Array.isArray(window.CATEGORIES) && window.CATEGORIES.length > 0) {
            // Update categoriesData with the loaded categories
            categoriesData = window.CATEGORIES.slice();
            console.log(`Loaded ${categoriesData.length} categories`);
            initializeCategories();
            initializationStarted = true;
        } else if (retryCount < maxRetries) {
            retryCount++;
            // Retry after a short delay if categories aren't loaded yet
            setTimeout(waitForCategories, 50);
        } else {
            console.error('Categories failed to load after maximum retries');
            // Try dynamic injection once as a last resort
            injectCategoriesScriptOnce();
            const grid = document.getElementById('categories-grid');
            if (grid) {
                grid.innerHTML = '<p style="text-align: center; padding: 40px; color: var(--muted);">Categories failed to load. Please refresh the page.</p>';
            }
        }
    }
    
    // Also listen for when the categories script loads (backup mechanism)
    window.addEventListener('load', () => {
        // Give it a bit more time after window load
        setTimeout(() => {
            if (!initializationStarted && window.CATEGORIES && Array.isArray(window.CATEGORIES) && window.CATEGORIES.length > 0) {
                categoriesData = window.CATEGORIES.slice();
                console.log(`Loaded ${categoriesData.length} categories (on window load)`);
                initializeCategories();
                initializationStarted = true;
            } else if (!initializationStarted) {
                console.warn('Categories still not loaded after window load event');
                // Try one more time after a short delay
                setTimeout(() => {
                    if (window.CATEGORIES && Array.isArray(window.CATEGORIES) && window.CATEGORIES.length > 0) {
                        categoriesData = window.CATEGORIES.slice();
                        console.log(`Loaded ${categoriesData.length} categories (delayed check)`);
                        initializeCategories();
                        initializationStarted = true;
                    }
                }, 500);
            }
        }, 100);
    });
    
    // Expose a manual initialization function as last resort
    window.manualInitCategories = function() {
        if (window.CATEGORIES && Array.isArray(window.CATEGORIES) && window.CATEGORIES.length > 0) {
            categoriesData = window.CATEGORIES.slice();
            console.log(`Manually loaded ${categoriesData.length} categories`);
            initializeCategories();
            initializationStarted = true;
            return true;
        }
        return false;
    };
    
    // Wait for DOM and categories to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', waitForCategories);
    } else {
        waitForCategories();
    }

    // Handle hash navigation for categories
    (function handleHashNavigation() {
        // Wait for categories to be initialized
        setTimeout(() => {
            const hash = location.hash;
            if (hash && hash.startsWith('#category-')) {
                const categoryId = parseInt(hash.replace('#category-', ''));
                if (categoryId) {
                    const categoryCard = document.querySelector(`.category-card[data-category-id="${categoryId}"]`);
                    if (categoryCard && !categoryCard.classList.contains('is-open')) {
                        // Close all categories first
                        document.querySelectorAll('.category-card.is-open').forEach(card => {
                            card.classList.remove('is-open');
                        });
                        // Open the requested category
                        categoryCard.classList.add('is-open');
                        updateOpenCategoryToast();
                        // Scroll to category
                        setTimeout(() => {
                            categoryCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, 100);
                    }
                }
            } else if (hash === '#categories-grid') {
                const el = document.getElementById('categories-grid');
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }
        }, 300); // Wait for categories to be fully initialized
    })();
})();

