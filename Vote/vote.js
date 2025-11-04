(() => {
    const categoriesData = [
        {
            number: 1,
            title: "PEACEMAKER AWARDS",
            nominees: [
                "Momoh Precious", "Victor Nweze", "Nasir Samuel", "Ogbor Emmanuel Nnamdi",
                "Thomas Tunmise", "Ayep Vanessa", "Richard Gbadamosi"
            ]
        },
        {
            number: 2,
            title: "YSA OF THE YEAR (MALE)",
            nominees: [
                "Momoh Precious", "Suleiman Abraham", "Harrison Eyiki", "Abel",
                "Abraham Suleiman", "Ibrahim Fabolude"
            ]
        },
        {
            number: 3,
            title: "YSA OF THE YEAR (FEMALE)",
            nominees: [
                "Adenekan Kehinde Adedamola", "Bukola Ajisafe", "Ochigbo Precious",
                "Duthen Funmilayo", "Thomas Tunmise", "Bukola Ajisafe", "Victory Igein"
            ]
        },
        {
            number: 4,
            title: "ENTREPRENEUR OF THE YEAR",
            nominees: [
                "Abraham Suleiman", "Harrison Eyiki", "Balogun Oluwatosin",
                "Favour Odey", "Blessing Obaji", "Ruth Mbonu"
            ]
        },
        {
            number: 5,
            title: "MUSICAL VOICE AWARDS",
            nominees: [
                "Bukola Ajisafe", "Adeniran Hallelujah", "Eniola Ayinde",
                "Ijeoma Nwabueze", "Blessings Obaji", "Ruth Mbonu"
            ]
        },
        {
            number: 6,
            title: "BEST DRESSED MALE",
            nominees: [
                "Zion Ita Udong Abasi", "Harrison Eyiki",
                "Peter Prosperity Sunday", "Samuel Nasir"
            ]
        },
        {
            number: 7,
            title: "BEST DRESSED FEMALE",
            nominees: [
                "Veronica Akinwande", "Thomas Precious Titi", "Thomas Tunmise",
                "Adebimpe Gbadebo", "Justina Samuel"
            ]
        },
        {
            number: 8,
            title: "YSA PARTICIPATION AWARD",
            nominees: [
                "Joy Ford Adaku", "Harrison Eyiki", "Joseph Abiodun Wasiu",
                "Thomas Tunmise", "Bamidele Michael", "Emmanuel Nasir"
            ]
        },
        {
            number: 9,
            title: "MOST CHRISTLIKE AWARD",
            nominees: [
                "Ememekwe Emmanuel Chidera", "Eric Iorfa Maurice", "Ibrahim Fabolude",
                "Love Ayinde Feyisola", "Thomas Tunmise", "Confidence Felix", "Samuel Nasir"
            ]
        },
        {
            number: 10,
            title: "LEADERSHIP APPRECIATION AWARD",
            nominees: [
                "Olubisi Olasunkanmi Olamilekan", "Elisha Okon Maurice", "Abraham Suleiman",
                "Adeosun O. King", "Abel", "Oreoluwa Adebiyi", "Samuel Nasir"
            ]
        }
    ];

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
                    ${category.nominees.map(nominee => `
                        <div class="nominee-card">
                            <img src="${generatePlaceholderImage(nominee)}" alt="${nominee}" class="nominee-image" />
                            <div class="nominee-name">${nominee}</div>
                            <button class="vote-btn" data-nominee="${nominee}" data-category="${category.number}">
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

    function initializeCategories() {
        const grid = document.getElementById('categories-grid');
        if (!grid) return;

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
                if (e.target === toggle || (toggle && toggle.contains(e.target))) return;
                toggleCategory(card);
            });
            if (toggle) {
                toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleCategory(card);
                });
            }
        });

        // Add vote button handlers
        document.querySelectorAll('.vote-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const nominee = btn.dataset.nominee;
                const category = btn.dataset.category;
                
                if (btn.classList.contains('voted')) return;
                
                btn.classList.add('voted');
                btn.textContent = 'Voted ✓';
                
                // Store vote in localStorage (temporary until backend)
                const votes = JSON.parse(localStorage.getItem('votes') || '{}');
                if (!votes[category]) votes[category] = [];
                votes[category].push(nominee);
                localStorage.setItem('votes', JSON.stringify(votes));
                
                console.log(`Voted for ${nominee} in category ${category}`);
            });
        });

        // Reset all votes - clear localStorage and remove voted states
        localStorage.removeItem('votes');
        document.querySelectorAll('.vote-btn').forEach(btn => {
            btn.classList.remove('voted');
            btn.textContent = 'Vote';
        });
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

    // Initialize
    initializeCategories();

    // If navigated with #categories-grid, ensure it scrolls into view below sticky header
    (function handleHashScroll() {
        if (location.hash === '#categories-grid') {
            const el = document.getElementById('categories-grid');
            if (el) {
                // Delay to ensure layout is painted
                setTimeout(() => {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 50);
            }
        }
    })();
})();

