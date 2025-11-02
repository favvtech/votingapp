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
                "Love Ayjnde Feyisola", "Thomas Tunmise", "Confidence Felix", "Samuel Nasir"
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

    function createCategoryCard(category) {
        const card = document.createElement('div');
        card.className = 'category-card';
        card.dataset.categoryId = category.number;

        // Generate gradient background based on category number
        const hue = (category.number * 36) % 360;
        const gradient = `linear-gradient(135deg, hsl(${hue}, 70%, 45%) 0%, hsl(${hue}, 70%, 30%) 100%)`;

        card.innerHTML = `
            <div class="category-image" style="background: ${gradient};">
                <div style="background: rgba(0,0,0,0.2); width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 64px; font-weight: 800; text-shadow: 0 4px 12px rgba(0,0,0,0.3);">${category.number}</div>
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

    function initializeCategories() {
        const grid = document.getElementById('categories-grid');
        if (!grid) return;

        categoriesData.forEach(category => {
            const card = createCategoryCard(category);
            grid.appendChild(card);
        });

        // Add click handlers for category cards
        document.querySelectorAll('.category-card').forEach(card => {
            const toggle = card.querySelector('.category-toggle');
            card.addEventListener('click', (e) => {
                if (e.target === toggle || toggle.contains(e.target)) return;
                card.classList.toggle('is-open');
            });
            if (toggle) {
                toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    card.classList.toggle('is-open');
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

        // Restore voted state from localStorage
        const votes = JSON.parse(localStorage.getItem('votes') || '{}');
        Object.keys(votes).forEach(categoryId => {
            votes[categoryId].forEach(nominee => {
                const btn = document.querySelector(`[data-nominee="${nominee}"][data-category="${categoryId}"]`);
                if (btn) {
                    btn.classList.add('voted');
                    btn.textContent = 'Voted ✓';
                }
            });
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

    // Initialize
    initializeCategories();
})();

