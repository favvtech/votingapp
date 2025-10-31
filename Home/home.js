(() => {
    const sliderRoot = document.querySelector('[data-hero-slider]');
    const slideEl = document.querySelector('[data-hero-slide] img');
    const indicatorsRoot = document.querySelector('[data-indicators]');
    const prevBtn = document.querySelector('[data-prev]');
    const nextBtn = document.querySelector('[data-next]');
    const yearEl = document.querySelector('[data-year]');
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

    // no logo fallback needed; SVG icon is shipped with assets

    const state = {
        urls: [],
        candidates: [],
        candidateIdx: [],
        idx: 0,
        timer: null,
        intervalMs: 5000
    };

    async function loadHeroImagesLocal() {
        const base = '../images/testing/';
        const sets = [
            ['WhatsApp 06.jpg','WhatsApp 06.jpeg','WhatsApp 06.png','WhatsApp 6.jpg','WhatsApp 6.jpeg'],
            ['WhatsApp 07.jpg','WhatsApp 07.jpeg','WhatsApp 07.png','WhatsApp 7.jpg','WhatsApp 7.jpeg'],
            ['WhatsApp 08.jpg','WhatsApp 08.jpeg','WhatsApp 08.png','WhatsApp 8.jpg','WhatsApp 8.jpeg'],
            ['WhatsApp 09.jpg','WhatsApp 09.jpeg','WhatsApp 09.png','WhatsApp 9.jpg','WhatsApp 9.jpeg']
        ];
        state.candidates = sets.map(list => list.map(n => encodeURI(base + n)));
        state.candidateIdx = new Array(sets.length).fill(0);
        state.urls = state.candidates.map(list => list[0]);
    }

    function preloadImages(urls) {
        return Promise.all(urls.map(u => new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve(u);
            img.onerror = () => resolve(u);
            img.src = u;
        })));
    }

    function renderIndicators() {
        if (!indicatorsRoot) return;
        indicatorsRoot.innerHTML = '';
        state.urls.forEach((_, i) => {
            const dot = document.createElement('div');
            dot.className = 'dot' + (i === state.idx ? ' active' : '');
            dot.addEventListener('click', () => {
                state.idx = i;
                updateSlide();
                restartTimer();
            });
            indicatorsRoot.appendChild(dot);
        });
    }

    function updateSlide() {
        const slides = document.querySelectorAll('.hero-slide');
        slides.forEach((s, i) => {
            if (i === 0) s.classList.add('is-active');
            else s.classList.remove('is-active');
        });
        if (slideEl && state.urls[state.idx]) {
            // attach per-slide fallback
            slideEl.onerror = () => {
                const ci = state.candidateIdx[state.idx] || 0;
                const nextIdx = ci + 1;
                const list = state.candidates[state.idx] || [];
                if (nextIdx < list.length) {
                    state.candidateIdx[state.idx] = nextIdx;
                    slideEl.src = list[nextIdx];
                } else {
                    slideEl.onerror = null;
                }
            };
            slideEl.src = state.urls[state.idx];
        }
        renderIndicators();
    }

    function next() {
        if (!state.urls.length) return;
        state.idx = (state.idx + 1) % state.urls.length;
        updateSlide();
    }
    function prev() {
        if (!state.urls.length) return;
        state.idx = (state.idx - 1 + state.urls.length) % state.urls.length;
        updateSlide();
    }

    function restartTimer() {
        if (state.timer) clearInterval(state.timer);
        state.timer = setInterval(next, state.intervalMs);
    }

    prevBtn && prevBtn.addEventListener('click', () => { prev(); restartTimer(); });
    nextBtn && nextBtn.addEventListener('click', () => { next(); restartTimer(); });

    (async function init() {
        await loadHeroImagesLocal();
        if (!state.urls.length) return;
        updateSlide();
        restartTimer();

        // Lazy-load survey images from local folder: ../images/testing
        const surveyImgs = document.querySelectorAll('[data-survey-img][data-lazy]');

        // Provide candidates (webp/jpg/png) with graceful fallback per card
        const localCandidates = [
            ['../images/testing/WhatsApp 01.jpg'],
            ['../images/testing/WhatsApp 02.jpg'],
            ['../images/testing/WhatsApp 03.jpg'],
            ['../images/testing/WhatsApp 04.jpg'],
            ['../images/testing/WhatsApp 05.jpg']
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
})();


