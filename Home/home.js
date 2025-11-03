(() => {
    const yearEl = document.querySelector('[data-year]');
    const indicatorsRoot = document.querySelector('[data-indicators]');
    const prevBtn = document.querySelector('[data-prev]');
    const nextBtn = document.querySelector('[data-next]');
    const navToggle = document.querySelector('.nav-toggle');
    const navList = document.querySelector('[data-nav]');
    const navLinks = document.querySelectorAll('[data-navlink]');
    const backdrop = document.querySelector('[data-backdrop]');

    if (yearEl) yearEl.textContent = String(new Date().getFullYear());

    function setMenuOpen(open) {
        if (!navList) return;
        if (open) navList.classList.add('is-open'); else navList.classList.remove('is-open');
        if (backdrop) {
            if (open) backdrop.classList.add('is-visible'); else backdrop.classList.remove('is-visible');
        }
        if (navToggle) {
            navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            navToggle.classList.toggle('is-open', open);
        }
        // Allow page scrolling while drawer is open as requested
    }

    if (navToggle && navList) {
        navToggle.addEventListener('click', () => {
            const willOpen = !navList.classList.contains('is-open');
            setMenuOpen(willOpen);
        });
    }
    if (backdrop) backdrop.addEventListener('click', () => setMenuOpen(false));
    navLinks.forEach(a => a.addEventListener('click', () => setMenuOpen(false)));

    // active nav ring
    function setActiveNav(target) {
        navLinks.forEach(a => a.classList.remove('is-current'));
        if (target) target.classList.add('is-current');
    }
    navLinks.forEach(a => {
        a.addEventListener('click', () => setActiveNav(a));
    });
    // default to Home on load
    setActiveNav(document.querySelector('[data-navlink].active'));

    // Hero carousel with fade transition - following exact pattern
    const heroSlides = document.querySelectorAll(".hero-slide");
    let currentSlideIndex = 0;

    // Load hero images and set as background
    async function loadHeroImages() {
        const base = 'images/testing/';
        const imageSets = [
            ['WhatsApp 06.jpg', 'WhatsApp 06.jpeg', 'WhatsApp 06.png', 'WhatsApp 6.jpg'],
            ['WhatsApp 07.jpg', 'WhatsApp 07.jpeg', 'WhatsApp 07.png', 'WhatsApp 7.jpg'],
            ['WhatsApp 08.jpg', 'WhatsApp 08.jpeg', 'WhatsApp 08.png', 'WhatsApp 8.jpg'],
            ['WhatsApp 09.jpg', 'WhatsApp 09.jpeg', 'WhatsApp 09.png', 'WhatsApp 9.jpg']
        ];
        
        const loadPromises = imageSets.map((candidates, slideIndex) => {
            return new Promise((resolve) => {
                let loaded = false;
                candidates.forEach((filename) => {
                    if (loaded) return;
                    const testImg = new Image();
                    const url = (base + filename).replace(/ /g, '%20');
                    testImg.onload = () => {
                        if (!loaded && heroSlides[slideIndex]) {
                            heroSlides[slideIndex].style.backgroundImage = `url(${url})`;
                            loaded = true;
                            resolve(url);
                        }
                    };
                    testImg.onerror = () => {};
                    testImg.src = url;
                });
            });
        });
        
        await Promise.all(loadPromises);
    }

    function showSlide(index) {
        heroSlides.forEach((slide) => {
            slide.classList.remove('active');
        });
        if (heroSlides[index]) {
            heroSlides[index].classList.add('active');
        }
        
        // Update indicators
        if (indicatorsRoot) {
            const dots = indicatorsRoot.querySelectorAll('.dot');
            dots.forEach((dot, i) => {
                if (i === index) dot.classList.add('active');
                else dot.classList.remove('active');
            });
        }
    }

    function nextSlide() {
        currentSlideIndex = (currentSlideIndex + 1) % heroSlides.length;
        showSlide(currentSlideIndex);
    }

    function prevSlide() {
        currentSlideIndex = (currentSlideIndex - 1 + heroSlides.length) % heroSlides.length;
        showSlide(currentSlideIndex);
    }

    // Auto-advance every 5 seconds
    setInterval(nextSlide, 5000);

    // Previous/Next button handlers
    if (prevBtn) prevBtn.addEventListener('click', () => { prevSlide(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { nextSlide(); });
    
    // Indicator click handlers
    if (indicatorsRoot) {
        indicatorsRoot.innerHTML = '';
        heroSlides.forEach((_, i) => {
            const dot = document.createElement('div');
            dot.className = 'dot' + (i === currentSlideIndex ? ' active' : '');
            dot.addEventListener('click', () => {
                currentSlideIndex = i;
                showSlide(currentSlideIndex);
            });
            indicatorsRoot.appendChild(dot);
        });
    }

    // Initialize carousel
    (async function init() {
        await loadHeroImages();
        showSlide(currentSlideIndex);

        // Lazy-load survey images from local folder: images/testing
        const surveyImgs = document.querySelectorAll('[data-survey-img][data-lazy]');

        // Provide candidates (webp/jpg/png) with graceful fallback per card
        const localCandidates = [
            ['images/testing/WhatsApp 01.jpg'],
            ['images/testing/WhatsApp 02.jpg'],
            ['images/testing/WhatsApp 03.jpg'],
            ['images/testing/WhatsApp 04.jpg'],
            ['images/testing/WhatsApp 05.jpg']
        ].map(list => list.map(src => src.replace(/ /g, '%20')));

        const candidateMap = new WeakMap();
        surveyImgs.forEach((img, i) => {
            const list = localCandidates[i % localCandidates.length].slice();
            candidateMap.set(img, list);
            img.dataset.src = list[0];
            img.loading = 'lazy';
        });

        const io = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const el = entry.target;
                const list = candidateMap.get(el) || [];

                function tryNext() {
                    if (!list.length) { el.onerror = null; return; }
                    const nextSrc = list.shift();
                    candidateMap.set(el, list);
                    el.src = nextSrc;
                }

                el.onerror = () => tryNext();
                // start with data-src first
                const first = el.getAttribute('data-src');
                if (first) {
                    // ensure first is at front of list
                    if (!list.length || list[0] !== first) list.unshift(first);
                }
                tryNext();
                observer.unobserve(el);
            });
        }, { rootMargin: '200px' });

        surveyImgs.forEach(img => io.observe(img));
    })();

    // Mobile dropdown toggle for Vote nav - using button approach
    const voteDropdownParent = document.querySelector('.nav-dropdown-parent');
    if (voteDropdownParent) {
        const voteMobileToggle = voteDropdownParent.querySelector('.vote-mobile-toggle');
        const voteDropdown = voteDropdownParent.querySelector('.nav-dropdown');
        
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
    }
})();


