(() => {
    // API_BASE: in production set window.API_BASE in HTML to your backend URL
    const API_BASE = (typeof window !== 'undefined' && window.API_BASE) || window.location.origin;
    let categoriesData = [];
    
    // Validate session before allowing access to voting page
    // SIMPLIFIED: Only redirect on clear authentication failure, not on network errors
    async function checkSessionBeforeVoting() {
        try {
            // Try session cookie first (most reliable)
            const sessionResponse = await fetch(`${API_BASE}/validate_session`, {
                method: "GET",
                credentials: 'include',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });
            
            if (sessionResponse.ok) {
                const sessionData = await sessionResponse.json();
                if (sessionData.valid) {
                    return true; // Session is valid - allow access
                }
                // If response says not valid, redirect
                if (sessionData.valid === false) {
                    localStorage.removeItem("token");
                    sessionStorage.removeItem("user_access_code_fallback");
                    window.location.href = "../Auth/login.html";
                    return false;
                }
            } else if (sessionResponse.status === 401) {
                // Clear 401 means not authenticated - redirect
                localStorage.removeItem("token");
                sessionStorage.removeItem("user_access_code_fallback");
                window.location.href = "../Auth/login.html";
                return false;
            }
            
            // If we get here, it might be a network error or unclear response
            // Don't redirect - let the existing checkAuthAndRedirect() handle it
            // This prevents false logouts on network issues
            console.log("Session validation unclear, letting existing auth check handle it");
            return null;
        } catch (error) {
            console.error("Session validation error:", error);
            // On any error, don't redirect - let existing auth check handle it
            // This prevents false logouts on network issues
            return null;
        }
    }
    
    // Auth check on page load - redirect if not authenticated
    async function checkAuthAndRedirect() {
        try {
            // Get fallback code from sessionStorage if available (for cross-domain cookie issues)
            let fallbackCode = null;
            try {
                fallbackCode = sessionStorage.getItem('user_access_code_fallback');
                if (fallbackCode) {
                    fallbackCode = fallbackCode.toUpperCase().trim();
                }
            } catch (e) {
                console.warn('Could not read sessionStorage:', e);
            }
            
            // Try with cookie first
            let response = null;
            let data = null;
            
            try {
                response = await fetch(`${API_BASE}/api/check-session`, {
                    method: 'GET',
                    credentials: 'include',
                    cache: 'no-store',
                    headers: {
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    }
                });
                
                if (response.ok) {
                    try {
                        data = await response.json();
                    } catch (e) {
                        console.warn('Failed to parse session check response:', e);
                    }
                }
            } catch (e) {
                console.warn('Cookie-based session check failed:', e);
            }
            
            // If session check fails, try with header fallback
            if ((!data || !data.logged_in || !data.user) && fallbackCode) {
                console.log('Using header fallback authentication');
                try {
                    response = await fetch(`${API_BASE}/api/check-session`, {
                        method: 'GET',
                        credentials: 'include',
                        cache: 'no-store',
                        headers: {
                            'X-Access-Code': fallbackCode,
                            'Cache-Control': 'no-cache',
                            'Pragma': 'no-cache'
                        }
                    });
                    
                    if (response.ok) {
                        try {
                            data = await response.json();
                            // If header fallback succeeded, wait for session cookie to be set
                            if (data && data.logged_in && data.user) {
                                console.log('Header fallback authentication successful');
                                // Give more time for session cookie to be established
                                await new Promise(resolve => setTimeout(resolve, 500));
                                // Verify session is now working with cookies
                                try {
                                    const verifyResponse = await fetch(`${API_BASE}/api/check-session`, {
                                        method: 'GET',
                                        credentials: 'include',
                                        cache: 'no-store',
                                        headers: {
                                            'Cache-Control': 'no-cache',
                                            'Pragma': 'no-cache'
                                        }
                                    });
                                    if (verifyResponse.ok) {
                                        const verifyData = await verifyResponse.json();
                                        if (verifyData && verifyData.logged_in && verifyData.user) {
                                            console.log('Session cookie verified after header fallback');
                                        }
                                    }
                                } catch (e) {
                                    console.warn('Session verification failed:', e);
                                }
                            }
                        } catch (e) {
                            console.warn('Failed to parse header fallback response:', e);
                        }
                    } else {
                        console.warn('Header fallback request failed with status:', response.status);
                    }
                } catch (e) {
                    console.warn('Header fallback check failed:', e);
                }
            }
            
            // Final check - only redirect if both cookie and header fallback failed
            if (!data || !data.logged_in || !data.user) {
                console.warn('Authentication failed - both cookie and header fallback failed');
                // Not authenticated - redirect to login
                window.location.replace('../Auth/login.html');
                return false;
            }
            
            console.log('Authentication successful');
            return true;
        } catch (error) {
            console.error('Auth check failed with error:', error);
            // Only redirect on critical errors, not on network issues
            if (error.name !== 'TypeError' && !error.message.includes('fetch')) {
                window.location.replace('../Auth/login.html');
            }
            return false;
        }
    }

    /**
     * Normalize a name for matching with image filenames
     * Converts "Jola Ade" to "jola-ade" (lowercase, spaces to hyphens)
     */
    function normalizeNameForMatching(name) {
        return name
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')  // Replace spaces with hyphens
            .replace(/[^a-z0-9-]/g, '');  // Remove special characters except hyphens
    }

    /**
     * Find matching image for a nominee name
     * Checks for exact match first, then tries variations
     * Returns image path or null if not found
     */
    function findNomineeImage(nomineeName) {
        if (!nomineeName) return null;
        
        // List of available image filenames (without extensions)
        // This avoids needing to fetch directory listings
        // Updated to match all actual image files in frontend/images/category1/
        const availableImages = [
            'abel-ehiaguina',
            'adenekan-kehinde',
            'adeniran-hallelujah',
            'adeniran-oyinkansola',
            'adeosun-king',
            'akinwunmi-kehinde',
            'akinwunmi-taiwo',
            'ayepe-vanessa',
            'balogun-oluwatosin',
            'bamidele-michael',
            'blessing-obaji',
            'bukola-ajisafe',
            'bunmi-ogundapo',
            'confidence-felix',
            'duthen-funmilayo',
            'elisha-maurice',
            'ememekwe-emmanuel',
            'emmanuel-nasir',
            'eniola-ayinde',
            'eric-agwa',
            'favour-odey',
            'gamsheya-lumsunya',
            'gbadebo-elizabeth',
            'ibrahim-fabolude',
            'ijeoma-nwabueze',
            'joseph-abiodun',
            'joy-adaku',
            'joy-essiet',
            'justina-samuel',
            'love-ayinde',
            'marvelous-musa',
            'momoh-precious',
            'monson-odonokwu',
            'ogbor-nnamdi',
            'okolie-arinze',
            'olasunkanmi-olamilekan',
            'oreoluwa-adebiyi',
            'peter-prosperity',
            'precious-ochigbo',
            'richard-gbadamashi',
            'richard-olawepo',
            'ruth-mbonu',
            'samson-obaji',
            'samuel-nasir',
            'suleiman-abraham',
            'taiwo-yusuf',
            'tajudeen-abiodun',
            'thomas-tunmise',
            'veronica-akinwande',
            'victor-nweze',
            'victoria-ekpenyong',
            'victory-igein',
            'zion-ita'
        ];

        const normalizedName = normalizeNameForMatching(nomineeName);
        let matchedFilename = null;
        
        // Special name mappings for variations
        const specialMappings = {
            'prosperity-peter': 'peter-prosperity',
            'peter-prosperity': 'peter-prosperity',
            'adebowale-micheal': null, // No image available - will use placeholder
            'abraham-ikpe': null, // No image available - will use placeholder
            'olubisi-olamilekan': 'olasunkanmi-olamilekan',
            'elisha-okon-maurice': 'elisha-maurice',
            'musa-dauda-marvelous': 'marvelous-musa',
            'dauda-musa-marvelous': 'marvelous-musa',
            'marvelous-musa': 'marvelous-musa',
            'adenekan-kehinde-adedamola': 'adenekan-kehinde',
            'ochigbo-precious': 'precious-ochigbo',
            'precious-ochigbo': 'precious-ochigbo',
            'love-ayinde-feyisola': 'love-ayinde',
            'gamsheya-ezra-lumsunya': 'gamsheya-lumsunya',
            'ogbor-edward-nnamdi': 'ogbor-nnamdi',
            'zion-ita-udong-abasi': 'zion-ita',
            'joy-ford-adaku': 'joy-adaku',
            'joseph-abiodun-wasiu': 'joseph-abiodun',
            'ememekwe-emmanuel-chidera': 'ememekwe-emmanuel',
            'adeosun-o-king': 'adeosun-king'
        };
        
        // Check special mappings first
        if (specialMappings.hasOwnProperty(normalizedName)) {
            const mapped = specialMappings[normalizedName];
            if (mapped === null) {
                // Explicitly no image available - return null to use placeholder
                return null;
            }
            if (mapped && availableImages.includes(mapped)) {
                matchedFilename = mapped;
            }
        }
        
        // Try exact match if no special mapping found
        if (!matchedFilename && availableImages.includes(normalizedName)) {
            matchedFilename = normalizedName;
        } else if (!matchedFilename) {
            // Extract name parts for better matching (handles reversed order)
            const nameParts = normalizedName.split('-').filter(p => p.length > 0);
            
            // Try fuzzy matching with multiple strategies
            let bestMatch = null;
            let bestScore = 0;
            
            for (const img of availableImages) {
                const imgParts = img.split('-').filter(p => p.length > 0);
                let score = 0;
                
                // Strategy 1: Check if all name parts exist in image (handles reversed order)
                const allPartsMatch = nameParts.every(part => 
                    imgParts.some(imgPart => imgPart.includes(part) || part.includes(imgPart))
                );
                
                // Strategy 2: Check if image contains nominee name or vice versa
                const containsMatch = img.includes(normalizedName) || normalizedName.includes(img);
                
                // Strategy 3: Check if significant parts match (first and last name parts)
                const firstPartMatch = nameParts.length > 0 && imgParts.some(ip => 
                    ip.includes(nameParts[0]) || nameParts[0].includes(ip)
                );
                const lastPartMatch = nameParts.length > 1 && imgParts.some(ip => 
                    ip.includes(nameParts[nameParts.length - 1]) || nameParts[nameParts.length - 1].includes(ip)
                );
                
                // Calculate score
                if (allPartsMatch && nameParts.length === imgParts.length) {
                    score = 100; // Perfect match
                } else if (allPartsMatch) {
                    score = 80; // All parts match but different length
                } else if (containsMatch) {
                    score = 60; // Contains match
                } else if (firstPartMatch && lastPartMatch) {
                    score = 40; // First and last match
                } else if (firstPartMatch || lastPartMatch) {
                    score = 20; // Partial match
                }
                
                // Prefer longer matches for same score
                if (score > bestScore || (score === bestScore && img.length > (bestMatch?.length || 0))) {
                    bestScore = score;
                    bestMatch = img;
                }
            }
            
            // Only use match if score is reasonable (at least 20)
            if (bestMatch && bestScore >= 20) {
                matchedFilename = bestMatch;
            }
        }
        
        if (matchedFilename) {
            // Return jpg path (all images in category1 are .jpg based on file listing)
            return `../images/category1/${matchedFilename}.jpg`;
        }
        
        return null;
    }

    /**
     * Generate placeholder image if no real image is found
     */
    function generatePlaceholderImage(name) {
        const colors = ['#c9a227', '#b38a10', '#8b6914', '#6b4f0a'];
        const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const color = colors[hash % colors.length];
        return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="60" fill="${color}"/><text x="60" y="70" font-family="Arial" font-size="40" font-weight="bold" fill="white" text-anchor="middle">${name.charAt(0).toUpperCase()}</text></svg>`)}`;
    }

    /**
     * Get the best image source for a nominee
     * Returns real image path if found, otherwise placeholder
     */
    function getNomineeImageSrc(nomineeName) {
        const realImage = findNomineeImage(nomineeName);
        return realImage || generatePlaceholderImage(nomineeName);
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
        "LEADERSHIP APPRECIATION AWARD": "leadership.jpeg",
        "YSA GATHERING PLACE PARTICIPATION AWARD": "gathering.jpg"
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
                    ${category.nominees.map((nominee, idx) => {
                        const imageSrc = getNomineeImageSrc(nominee);
                        const isRealImage = imageSrc.startsWith('../images/');
                        return `
                        <div class="nominee-card">
                            <img 
                                src="${imageSrc}" 
                                alt="${nominee}" 
                                class="nominee-image ${isRealImage ? 'nominee-image-real' : 'nominee-image-placeholder'}"
                                onerror="this.onerror=null; this.src='${generatePlaceholderImage(nominee)}'; this.classList.remove('nominee-image-real'); this.classList.add('nominee-image-placeholder');"
                            />
                            <div class="nominee-name">${nominee}</div>
                            <button class="vote-btn" data-nominee="${nominee}" data-nominee-index="${idx}" data-nominee-id="${idx + 1}" data-category="${category.number}">
                                Vote
                            </button>
                        </div>
                    `;
                    }).join('')}
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
    let votingActive = true;
    // REMOVED: INACTIVITY_TIMEOUT and inactivityTimer - 30-minute auto-logout removed
    let votingStatusCheckInterval = null;
    let lastVoteClickTime = 0;
    const VOTE_CLICK_COOLDOWN = 1000; // 1 second cooldown between vote clicks

    // Check voting status
    async function checkVotingStatus(immediate = false) {
        try {
            const response = await fetch(`${API_BASE}/api/voting-status?t=${Date.now()}`, {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });
            const data = await response.json();
            if (data.success !== undefined) {
                const wasActive = votingActive;
                votingActive = data.voting_active;
                
                // Update UI immediately when status changes
                if (!votingActive) {
                    showVotingClosedMessage();
                    disableAllVoteButtons();
                } else {
                    // If voting just became active, hide message and enable buttons immediately
                    if (!wasActive && votingActive) {
                        hideVotingClosedMessage();
                        enableAllVoteButtons();
                    }
                }
                
                // Adjust polling frequency based on status
                if (votingStatusCheckInterval) {
                    clearInterval(votingStatusCheckInterval);
                }
                // Poll more frequently when voting is disabled (every 5 seconds)
                // Poll less frequently when voting is active (every 60 seconds)
                const pollInterval = votingActive ? 60000 : 5000;
                votingStatusCheckInterval = setInterval(() => checkVotingStatus(false), pollInterval);
            }
        } catch (error) {
            console.error('Error checking voting status:', error);
        }
    }

    // Show voting closed message - highly visible
    function showVotingClosedMessage() {
        let messageEl = document.getElementById('votingClosedMessage');
        if (!messageEl) {
            messageEl = document.createElement('div');
            messageEl.id = 'votingClosedMessage';
            document.body.appendChild(messageEl);
            
            // Add pulse animation style
            const style = document.createElement('style');
            style.id = 'votingClosedMessageStyle';
            style.textContent = `
                @keyframes votingPulse {
                    0%, 100% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 0 0 rgba(220, 53, 69, 0.7); }
                    50% { transform: translate(-50%, -50%) scale(1.02); box-shadow: 0 0 0 15px rgba(220, 53, 69, 0); }
                }
                #votingClosedMessage {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: #DC3545;
                    color: #FFFFFF;
                    padding: 12px 18px;
                    border-radius: 8px;
                    box-shadow: 0 4px 16px rgba(220, 53, 69, 0.5), 0 0 0 2px rgba(255, 255, 255, 0.4);
                    z-index: 99999;
                    font-weight: 600;
                    font-size: 13px;
                    text-align: center;
                    max-width: 70%;
                    width: auto;
                    border: 2px solid #FFFFFF;
                    animation: votingPulse 2s infinite;
                    text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
                    letter-spacing: 0.2px;
                    white-space: nowrap;
                    line-height: 1.4;
                }
                @media (max-width: 768px) {
                    #votingClosedMessage {
                        padding: 8px 14px;
                        font-size: 11px;
                        max-width: 70%;
                        border-radius: 6px;
                        border-width: 2px;
                        font-weight: 600;
                        letter-spacing: 0.1px;
                    }
                }
            `;
            if (!document.getElementById('votingClosedMessageStyle')) {
                document.head.appendChild(style);
            }
        }
        messageEl.textContent = '⚠️ Voting Session Has Ended ⚠️';
        messageEl.style.display = 'block';
    }

    // Hide voting closed message
    function hideVotingClosedMessage() {
        const messageEl = document.getElementById('votingClosedMessage');
        if (messageEl) {
            messageEl.style.display = 'none';
        }
    }

    // Disable all vote buttons
    function disableAllVoteButtons() {
        document.querySelectorAll('.vote-btn').forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        });
    }

    // Enable all vote buttons
    function enableAllVoteButtons() {
        document.querySelectorAll('.vote-btn').forEach(btn => {
            if (!btn.classList.contains('voted')) {
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
            }
        });
    }

    // REMOVED: 30-minute inactivity detection and auto-logout
    // Sessions now persist until they expire naturally (31 days)
    // This prevents false logouts when users navigate between pages

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
                const nomineeIdForBackend = Number(btn.dataset.nomineeId);

                // Prevent voting if already voted in this category
                if (btn.classList.contains('voted')) return;
                if (btn.getAttribute('data-locked') === 'true') return;
                if (btn.hasAttribute('disabled')) return;

                // Rate limiting: Prevent rapid clicks
                const now = Date.now();
                if (now - lastVoteClickTime < VOTE_CLICK_COOLDOWN) {
                    console.log('Vote click cooldown active, ignoring rapid click');
                    return;
                }
                lastVoteClickTime = now;

                // nomineeIdForBackend is precomputed in the DOM to avoid any off-by-one issues

                // Validate values before sending
                if (isNaN(categoryId) || isNaN(nomineeIdForBackend) || categoryId <= 0 || nomineeIdForBackend <= 0) {
                    console.error('Invalid vote data:', { categoryId, nomineeIdx, nomineeIdForBackend });
                    alert('Invalid vote data. Please try again.');
                    return;
                }

                // CRITICAL: Check voting status immediately before submitting (fresh check)
                // This prevents rapid-click bypasses
                try {
                    const statusResponse = await fetch(`${API_BASE}/api/voting-status?t=${Date.now()}`, {
                        method: 'GET',
                        credentials: 'include',
                        cache: 'no-store',
                        headers: {
                            'Cache-Control': 'no-cache',
                            'Pragma': 'no-cache'
                        }
                    });
                    const statusData = await statusResponse.json();
                    if (statusData.success !== undefined && !statusData.voting_active) {
                        // Update local state
                        votingActive = false;
                        showVotingClosedMessage();
                        disableAllVoteButtons();
                        alert('Voting session is closed.');
                        return;
                    }
                    // Update local state if voting is active
                    if (statusData.success !== undefined && statusData.voting_active) {
                        votingActive = true;
                    }
                } catch (e) {
                    console.warn('Failed to check voting status before vote:', e);
                    // If status check fails, still check local state
                    if (!votingActive) {
                        showVotingClosedMessage();
                        alert('Voting session is closed.');
                        return;
                    }
                }

                try {
                    // Build headers - include header fallback for cross-domain cookie issues
                    const headers = { 'Content-Type': 'application/json' };
                    
                    // Add access code header fallback if available
                    try {
                        const fallbackCode = sessionStorage.getItem('user_access_code_fallback');
                        if (fallbackCode) {
                            headers['X-Access-Code'] = fallbackCode.toUpperCase().trim();
                        }
                    } catch (e) {
                        // sessionStorage not available, ignore
                    }
                    
                    const resp = await fetch(`${API_BASE}/api/vote`, {
                        method: 'POST',
                        headers,
                        credentials: 'include',
                        body: JSON.stringify({
                            category_id: categoryId,
                            nominee_id: nomineeIdForBackend,
                            nominee_name: nomineeName,
                            nominee_index: nomineeIdx
                        })
                    });
                    if (resp.status === 401) {
                        // Not logged in – redirect to login
                        alert('Please log in to vote. You will be redirected to the login page.');
                        window.location.replace('../Auth/login.html#login');
                        return;
                    }
                    if (resp.status === 403) {
                        // Voting session closed - update state immediately
                        const errorData = await resp.json().catch(() => ({}));
                        const message = errorData.message || 'Voting session is closed.';
                        votingActive = false;
                        showVotingClosedMessage();
                        disableAllVoteButtons();
                        // Immediately check status again to sync
                        checkVotingStatus(true);
                        alert(message);
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
                    
                    // Invalidate cache to ensure fresh data on next fetch
                    try {
                        localStorage.removeItem('vote_cache_timestamp');
                    } catch(_) {}
                    
                    // Immediately check voting status after successful vote
                    // This ensures UI stays in sync if admin toggles during voting
                    checkVotingStatus(true);
                    
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
        // Force fresh fetch on page load to ensure we have latest data
        refreshMyVotes(true);
        
        // Listen for vote reset events from admin dashboard (cross-tab communication)
        window.addEventListener('storage', (e) => {
            if (e.key === 'votes_reset' || e.key === 'vote_cache_timestamp') {
                // Votes were reset, force fresh fetch
                refreshMyVotes(true);
            }
        });
        
        // Also listen for focus events to refresh when tab becomes active
        window.addEventListener('focus', () => {
            refreshMyVotes(true);
        });
        
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
    async function refreshMyVotes(forceFresh = false){
        try {
            // Check cache timestamp - if votes were reset, force fresh fetch
            const cacheTimestamp = localStorage.getItem('vote_cache_timestamp');
            const lastReset = localStorage.getItem('votes_reset');
            if (lastReset || forceFresh || !cacheTimestamp) {
                // Force fresh fetch - clear any cached data
                try {
                    localStorage.removeItem('cached_votes');
                } catch(_) {}
            }
            
            // Build headers with header fallback for cross-domain cookie issues
            const headers = {};
            try {
                const fallbackCode = sessionStorage.getItem('user_access_code_fallback');
                if (fallbackCode) {
                    headers['X-Access-Code'] = fallbackCode.toUpperCase().trim();
                }
            } catch (e) {
                // sessionStorage not available, ignore
            }
            
            // Add timestamp to prevent caching
            const timestamp = Date.now();
            const resp = await fetch(`${API_BASE}/api/my-votes?t=${timestamp}`, { 
                credentials: 'include', 
                headers
            });
            if (!resp.ok) {
                console.warn('Failed to fetch votes:', resp.status);
                return;
            }
            const data = await resp.json();
            if (!data || !data.success) {
                console.warn('Invalid vote data response:', data);
                return;
            }
            
            // Update cache timestamp
            try {
                localStorage.setItem('vote_cache_timestamp', Date.now().toString());
            } catch(_) {}
            
            // Mark all voted categories
            if (data.votes && Array.isArray(data.votes)) {
                data.votes.forEach(v => {
                const cid = Number(v.category_id);
                    const backendNomineeId = Number(v.nominee_id); // This is 1-based from backend
                    // Convert 1-based backend ID to 0-based frontend index
                    const frontendNomineeIdx = backendNomineeId - 1;
                // resolve nominee name via DOM dataset or through index
                    markCategoryVoted(cid, undefined, frontendNomineeIdx);
            });
            }
        } catch (e) {
            console.error('Error refreshing votes:', e);
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
    
    async function waitForCategories() {
        // Validate session first (at the very top) - but don't block on network errors
        const sessionValid = await checkSessionBeforeVoting();
        if (sessionValid === false) {
            return; // Already redirected to login (clear authentication failure)
        }
        // If sessionValid is null (network error), continue to checkAuthAndRedirect
        
        // Check authentication - this is the main auth check
        const isAuthenticated = await checkAuthAndRedirect();
        if (!isAuthenticated) {
            return; // Redirect will happen in checkAuthAndRedirect
        }
        
        // Load user's existing votes to restore UI state
        await refreshMyVotes(true); // Force fresh fetch after authentication
        
        // Check voting status immediately
        await checkVotingStatus(true);
        // Note: checkVotingStatus() now manages its own interval with dynamic polling
        
        // REMOVED: 30-minute inactivity detection - sessions persist until they expire naturally
        // initInactivityDetection();
        
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

