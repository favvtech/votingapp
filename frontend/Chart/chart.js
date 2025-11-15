(() => {
  // API_BASE: in production set window.API_BASE in HTML to your backend URL
  const API_BASE = (typeof window !== 'undefined' && window.API_BASE) || window.location.origin;
  const categories = (window.CATEGORIES || []).map(c => c.title);

  // Mock nominees per category; when unknown, generate placeholders
  const nomineesByCategory = (window.CATEGORIES || []).reduce((acc, c, idx)=>{
    acc[idx] = c.nominees.slice();
    return acc;
  }, {});

  // Vote data will be fetched from backend
  // Structure: { categoryIndex: { "nomineeName": voteCount, ... }, ... }
  let voteData = {};
  // Scaling and animation state
  const STEP = 10; // Y-axis grows in steps of 10
  const MIN_MAX = 50; // baseline max
  let currentMax = MIN_MAX; // dynamic Y-axis max
  const firstRenderDone = {}; // per-category first render flag
  
  // Function to update vote data from backend
  // Call this function with new vote data to refresh the chart
  function updateVoteData(newData) {
    voteData = newData || {};
    // Re-render current chart with new data
    const sel = document.getElementById('category');
    const currentIndex = sel ? Number(sel.value || 0) : 0;
    render(currentIndex, { animateReplay: false });
  }
  
  // Expose updateVoteData globally for backend integration
  window.updateVoteData = updateVoteData;

  async function fetchCategoryResults(categoryIndex){
    const categoryId = Number(categoryIndex) + 1; // backend uses 1-based ids
    try {
      // Force fresh fetch with cache-busting
      const timestamp = Date.now();
      const resp = await fetch(`${API_BASE}/api/categories/${categoryId}/results?t=${timestamp}`, { 
        credentials: 'include'
      });
      if (!resp.ok) return;
      const data = await resp.json();
      // Build mapping name -> votes for this category
      const names = nomineesByCategory[categoryIndex] || [];
      const counts = Object.create(null);
      names.forEach(n => counts[n] = 0);
      // Create a map from nominee_id (1-based) to vote count
      const voteCountByNomineeId = {};
      (data.results || []).forEach(r => {
        voteCountByNomineeId[r.nominee_id] = Number(r.votes) || 0;
      });
      // Map votes to nominee names by iterating names in order
      // nominee_id = array_index + 1 (1-based)
      names.forEach((name, index) => {
        const nomineeId = index + 1; // Convert 0-based index to 1-based nominee_id
        counts[name] = voteCountByNomineeId[nomineeId] || 0;
      });
      // Update Y-axis scaling only when a vote exceeds currentMax
      const localMax = Math.max(0, ...Object.values(counts));
      if (localMax > currentMax) {
        currentMax = Math.max(MIN_MAX, Math.ceil(localMax / STEP) * STEP);
      }
      const merged = {};
      merged[categoryIndex] = counts;
      updateVoteData(Object.assign({}, voteData, merged));
    } catch(_){ /* ignore */ }
  }

  let pollTimer = null;
  function startPolling(categoryIndex){
    if (pollTimer) clearInterval(pollTimer);
    // immediate fetch with fresh data
    fetchCategoryResults(categoryIndex);
    // Poll every 3 seconds (reduced from 2 to save resources)
    // Only poll when page is visible
    pollTimer = setInterval(()=> {
      if (!document.hidden) {
        fetchCategoryResults(categoryIndex);
      }
    }, 3000);
  }
  
  // Listen for vote reset events from admin dashboard (cross-tab communication)
  window.addEventListener('storage', (e) => {
    if (e.key === 'votes_reset' || e.key === 'vote_cache_timestamp') {
      // Votes were reset, refresh current category if polling
      if (pollTimer) {
        const categorySelect = document.getElementById('category');
        if (categorySelect) {
          const currentIndex = categorySelect.selectedIndex;
          if (currentIndex >= 0) {
            fetchCategoryResults(currentIndex);
          }
        }
      }
    }
  });
  
  // Also refresh when tab becomes active
  window.addEventListener('focus', () => {
    if (pollTimer) {
      const categorySelect = document.getElementById('category');
      if (categorySelect) {
        const currentIndex = categorySelect.selectedIndex;
        if (currentIndex >= 0) {
          fetchCategoryResults(currentIndex);
        }
      }
    }
  });

  function buildOptions(){
    const sel = document.getElementById('category');
    const pills = document.querySelector('.pills');
    const bsSheet = document.querySelector('[data-bs-sheet]');
    const bsContent = document.querySelector('[data-bs-content]');
    const bsLabel = document.querySelector('[data-bs-label]');
    const bsToggle = document.querySelector('[data-bs-toggle]');
    const bsOverlay = document.querySelector('[data-bs-overlay]');
    sel.innerHTML = '';
    pills.innerHTML = '';
    if (bsContent) bsContent.innerHTML = '';
    
    // BULLETPROOF: Track touch state and disable items immediately
    let touchStart = { x: 0, y: 0, time: 0 };
    let touchMoved = false;
    let itemsDisabledTimeout = null;
    let isScrolling = false;
    
    // Helper functions to enable/disable items via CSS
    function disableItems(){
      if (bsContent) bsContent.classList.add('items-disabled');
    }
    
    function enableItems(){
      if (bsContent) bsContent.classList.remove('items-disabled');
    }
    
    // Track scroll events
    if (bsContent){
      bsContent.addEventListener('scroll', ()=>{
        isScrolling = true;
        disableItems(); // Disable items during scroll
        if (itemsDisabledTimeout) clearTimeout(itemsDisabledTimeout);
        // Keep disabled for 1000ms after scroll stops
        itemsDisabledTimeout = setTimeout(()=>{
          isScrolling = false;
          enableItems();
        }, 1000);
      }, { passive: true });
      
      // Track touch start - don't disable yet, wait to see if it's a scroll
      bsContent.addEventListener('touchstart', (e)=>{
        touchStart = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          time: Date.now()
        };
        touchMoved = false;
      }, { passive: true });
      
      // Track if user is moving (scrolling) - THEN disable items
      bsContent.addEventListener('touchmove', (e)=>{
        if (touchStart.time > 0){
          const deltaX = Math.abs(e.touches[0].clientX - touchStart.x);
          const deltaY = Math.abs(e.touches[0].clientY - touchStart.y);
          // If moved more than 5px, it's a scroll gesture - disable items NOW
          if (deltaX > 5 || deltaY > 5){
            touchMoved = true;
            isScrolling = true;
            // IMMEDIATELY disable items - prevents events from reaching them
            disableItems();
          }
        }
      }, { passive: true });
      
      // On touchend, decide: scroll or tap?
      bsContent.addEventListener('touchend', (e)=>{
        // If it was a scroll (moved), keep items disabled for 1000ms
        if (touchMoved || isScrolling){
          if (itemsDisabledTimeout) clearTimeout(itemsDisabledTimeout);
          itemsDisabledTimeout = setTimeout(()=>{
            isScrolling = false;
            enableItems();
          }, 1000);
        }
        // If it was a tap (no movement), items are still enabled - allow tap through
        
        // Reset
        touchStart = { x: 0, y: 0, time: 0 };
        touchMoved = false;
      }, { passive: true });
    }
    
    categories.forEach((c,i)=>{
      const o = document.createElement('option'); o.value=String(i); o.textContent=c; sel.appendChild(o);
      const pill = document.createElement('button'); pill.className='pill'; pill.role='tab'; pill.textContent=c; pill.setAttribute('aria-selected', i===0?'true':'false');
      pill.addEventListener('click', ()=> setActive(i));
      pills.appendChild(pill);
      if (bsContent){
        const item = document.createElement('button'); 
        item.className='bs-item'; 
        item.textContent=c; 
        item.setAttribute('aria-selected', i===0?'true':'false');
        
        // SIMPLIFIED: Items only need to handle clicks/taps
        // CSS pointer-events handles the blocking during scroll
        item.addEventListener('click', (e)=>{
          // Only allow if items are not disabled (CSS class check)
          if (!bsContent.classList.contains('items-disabled') && !isScrolling){
            e.preventDefault();
            e.stopPropagation();
            setActive(i); 
            closeBS(); 
          }
        });
        
        // Touch handler - simplified since CSS blocks during scroll
        item.addEventListener('touchend', (e)=>{
          // Only allow if items are enabled (not blocked by CSS)
          if (!bsContent.classList.contains('items-disabled') && !isScrolling){
            e.preventDefault();
            e.stopPropagation();
            setActive(i); 
            closeBS(); 
          }
        });
        
        bsContent.appendChild(item);
      }
    });
    sel.addEventListener('change', ()=> setActive(Number(sel.value)) );

    const mobileDropdown = document.querySelector('[data-mobile-dd]');
    
    function openBS(){ 
      if (!bsToggle||!bsSheet||!bsOverlay) return; 
      bsToggle.setAttribute('aria-expanded','true'); 
      bsSheet.hidden=false; 
      bsOverlay.hidden=false; 
      document.body.style.overflow = 'hidden';
      // Reset scroll state
      isScrolling = false;
      touchMoved = false;
      touchStart = { x: 0, y: 0, time: 0 };
      if (itemsDisabledTimeout) clearTimeout(itemsDisabledTimeout);
      enableItems(); // Ensure items are enabled when sheet opens
    }
    function closeBS(){ 
      if (!bsToggle||!bsSheet||!bsOverlay) return; 
      bsToggle.setAttribute('aria-expanded','false'); 
      bsSheet.hidden=true; 
      bsOverlay.hidden=true; 
      document.body.style.overflow = '';
      // Reset scroll state
      isScrolling = false;
      touchMoved = false;
      touchStart = { x: 0, y: 0, time: 0 };
      if (itemsDisabledTimeout) clearTimeout(itemsDisabledTimeout);
      enableItems(); // Clean up
    }
    
    // Handle bottom sheet interactions
    if (bsSheet){
      bsSheet.onclick = (e)=>{
        e.stopPropagation();
      };
      bsSheet.ontouchend = (e)=>{
        e.stopPropagation();
      };
    }
    
    // Add debounce to prevent rapid toggling
    let toggleTimeout = null;
    const handleToggle = ()=>{
      if (toggleTimeout) clearTimeout(toggleTimeout);
      toggleTimeout = setTimeout(()=>{
        const exp = bsToggle.getAttribute('aria-expanded')==='true'; 
        exp ? closeBS() : openBS(); 
      }, 150);
    };
    
    if (bsToggle){
      bsToggle.onclick = (e)=>{
        e.stopPropagation();
        handleToggle();
      };
      bsToggle.ontouchend = (e)=>{
        e.stopPropagation();
        handleToggle();
      };
    }
    
    // Swipe to dismiss functionality
    let touchStartY = 0;
    let touchCurrentY = 0;
    let isDragging = false;
    
    if (bsSheet){
      const bsHandle = bsSheet.querySelector('.bs-handle');
      
      const startDrag = (e)=>{
        if (!bsSheet.hidden){
          touchStartY = e.touches ? e.touches[0].clientY : e.clientY;
          isDragging = true;
        }
      };
      
      const onDrag = (e)=>{
        if (!isDragging || bsSheet.hidden) return;
        touchCurrentY = e.touches ? e.touches[0].clientY : e.clientY;
        const deltaY = touchCurrentY - touchStartY;
        if (deltaY > 0){
          bsSheet.style.transform = `translateY(${deltaY}px)`;
        }
      };
      
      const endDrag = ()=>{
        if (!isDragging) return;
        isDragging = false;
        const deltaY = touchCurrentY - touchStartY;
        if (deltaY > 100){
          closeBS();
        }
        bsSheet.style.transform = '';
        touchStartY = 0;
        touchCurrentY = 0;
      };
      
      if (bsHandle){
        bsHandle.addEventListener('touchstart', startDrag);
        bsHandle.addEventListener('mousedown', startDrag);
        document.addEventListener('touchmove', onDrag);
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('touchend', endDrag);
        document.addEventListener('mouseup', endDrag);
      }
    }
    
    // Overlay click handler - close on overlay click
    if (bsOverlay){
      bsOverlay.onclick = (e)=>{
        if (e.target === bsOverlay){
          e.stopPropagation();
          closeBS();
        }
      };
      bsOverlay.ontouchend = (e)=>{
        if (e.target === bsOverlay){
          e.stopPropagation();
          closeBS();
        }
      };
    }
    
    // Close on Escape key
    document.addEventListener('keydown', (e)=>{ 
      if (e.key==='Escape' && bsToggle && bsToggle.getAttribute('aria-expanded')==='true'){ 
        closeBS(); 
      } 
    });
    
    function updateBSLabel(index){ 
      if (bsLabel) bsLabel.textContent = categories[index] || 'Select category';
      if (bsContent){
        const items = bsContent.querySelectorAll('.bs-item');
        items.forEach((item, i)=>{
          item.setAttribute('aria-selected', i===index ? 'true' : 'false');
        });
      }
    }
    buildOptions.updateBSLabel = updateBSLabel; // expose to setActive
  }

  function getAxisMax() { return currentMax; }

  function render(idx, {animateReplay=false}={}){
    const title = categories[idx] || 'Category';
    const titleEl = document.querySelector('[data-chart-title]');
    if (titleEl) titleEl.textContent = title;

    const svg = document.getElementById('chart');
    const width = 800, height = 420;
    const margin = { top: 20, right: 16, bottom: 70, left: 40 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.innerHTML = '';

    const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
    const grad = document.createElementNS('http://www.w3.org/2000/svg','linearGradient');
    grad.setAttribute('id','barFill'); grad.setAttribute('x1','0'); grad.setAttribute('y1','0'); grad.setAttribute('x2','0'); grad.setAttribute('y2','1');
    const s1 = document.createElementNS('http://www.w3.org/2000/svg','stop'); s1.setAttribute('offset','0%'); s1.setAttribute('stop-color','var(--bar-2)');
    const s2 = document.createElementNS('http://www.w3.org/2000/svg','stop'); s2.setAttribute('offset','100%'); s2.setAttribute('stop-color','var(--bar)');
    grad.appendChild(s1); grad.appendChild(s2); defs.appendChild(grad); svg.appendChild(defs);

    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('transform', `translate(${margin.left},${margin.top})`);
    svg.appendChild(g);

    const names = (nomineesByCategory[idx] || ["A","B","C"]).slice();
    // Get vote data from backend (voteData structure)
    const categoryVotes = voteData[idx] || {};
    // Map names to votes, defaulting to 0 if no vote data exists
    // IMPORTANT: Keep bars in original nominee order (no sorting by votes)
    const data = names.map((n) => ({
      name: n,
      value: categoryVotes[n] || 0
    }));

    // Use dynamic axis max (baseline 100, grows by 50 when exceeded)
    const maxVal = getAxisMax();

    // scales
    const bandCount = data.length;
    const bandPadding = 0.2;
    const bandWidth = innerW / bandCount;
    const barWidth = Math.max(18, bandWidth * (1 - bandPadding));
    const x = i => i * bandWidth + (bandWidth - barWidth)/2;
    const y = v => innerH - innerH * (v / (maxVal || 1));

    // gridlines
    const grid = document.createElementNS('http://www.w3.org/2000/svg','g');
    grid.setAttribute('class','grid');
    const ticks = 6;
    for (let i=0;i<=ticks;i++){
      const val = (maxVal/ticks)*i;
      const yy = y(val);
      const line = document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1','0'); line.setAttribute('y1',`${yy}`);
      line.setAttribute('x2',`${innerW}`); line.setAttribute('y2',`${yy}`);
      grid.appendChild(line);
    }
    g.appendChild(grid);

    // axes – left Y and bottom X (forming L)
    const yAxis = document.createElementNS('http://www.w3.org/2000/svg','g'); yAxis.setAttribute('class','axis');
    for (let i=0;i<=ticks;i++){
      const val = (maxVal/ticks)*i; const yy = y(val);
      const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
      txt.setAttribute('x', '-6'); txt.setAttribute('y', `${yy+4}`);
      txt.setAttribute('text-anchor','end'); txt.textContent = String(Math.round(val));
      yAxis.appendChild(txt);
    }
    const yLine = document.createElementNS('http://www.w3.org/2000/svg','line');
    yLine.setAttribute('x1','0'); yLine.setAttribute('y1','0'); yLine.setAttribute('x2','0'); yLine.setAttribute('y2',`${innerH}`);
    yAxis.appendChild(yLine);
    g.appendChild(yAxis);

    const xAxis = document.createElementNS('http://www.w3.org/2000/svg','g'); xAxis.setAttribute('class','axis');
    const xLine = document.createElementNS('http://www.w3.org/2000/svg','line');
    xLine.setAttribute('x1','0'); xLine.setAttribute('y1',`${innerH}`); xLine.setAttribute('x2',`${innerW}`); xLine.setAttribute('y2',`${innerH}`);
    xAxis.appendChild(xLine);
    function splitLabel(str){
      const parts = String(str).trim().split(/\s+/);
      if (parts.length >= 2){
        return [parts[0], parts.slice(1).join(' ')];
      }
      const s = parts[0] || '';
      if (s.length > 10){
        return [s.slice(0,10), s.slice(10)];
      }
      return [s];
    }
    data.forEach((d,i)=>{
      const cx = x(i)+barWidth/2;
      const baseY = innerH + 14; // first line
      const lines = splitLabel(d.name);
      const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
      txt.setAttribute('x', `${cx}`); txt.setAttribute('y', `${baseY}`);
      txt.setAttribute('text-anchor','middle');
      lines.forEach((ln, li)=>{
        const tspan = document.createElementNS('http://www.w3.org/2000/svg','tspan');
        if (li === 0){
          tspan.setAttribute('x', `${cx}`); tspan.setAttribute('dy', '0');
        } else {
          tspan.setAttribute('x', `${cx}`); tspan.setAttribute('dy', '14');
        }
        tspan.textContent = ln;
        txt.appendChild(tspan);
      });
      xAxis.appendChild(txt);
    });
    g.appendChild(xAxis);

    // bars + animated growth + value count-up + tooltip
    const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
    const duration = 900; // ms
    const start = performance.now();

    // create nodes first
    const rects = [];
    const labels = [];
    const tooltip = document.querySelector('[data-tooltip]');
    data.forEach((d,i)=>{
      const bx = x(i);
      const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
      rect.setAttribute('class','bar'); rect.setAttribute('x',`${bx}`); rect.setAttribute('y',`${innerH}`);
      rect.setAttribute('width',`${barWidth}`); rect.setAttribute('height','0');
      rect.addEventListener('mousemove', (e)=>{
        if (!tooltip) return; tooltip.hidden = false; tooltip.textContent = `${d.name}: ${d.value}`;
        const wrap = e.currentTarget.ownerSVGElement.getBoundingClientRect();
        tooltip.style.left = `${e.clientX - wrap.left}px`; tooltip.style.top = `${e.clientY - wrap.top - 16}px`;
      });
      rect.addEventListener('mouseleave', ()=>{ if (tooltip) tooltip.hidden = true; });
      g.appendChild(rect); rects.push({node:rect, value:d.value});

      const v = document.createElementNS('http://www.w3.org/2000/svg','text');
      v.setAttribute('class','value-label'); v.setAttribute('x', `${bx+barWidth/2}`); v.setAttribute('y', `${innerH-6}`);
      v.textContent = '0'; g.appendChild(v); labels.push({node:v, value:d.value});
    });

    function frame(now){
      const t = Math.min(1, (now - start) / duration);
      const e = easeOutCubic(t);
      rects.forEach((r, i)=>{
        // stagger
        const localT = Math.min(1, Math.max(0, (t - i*0.06)) / (1 - i*0.06));
        const ee = easeOutCubic(localT);
        const by = y(r.value * ee); const bh = innerH - by;
        r.node.setAttribute('y', `${by}`);
        r.node.setAttribute('height', `${bh}`);
      });
      labels.forEach((l, i)=>{
        const localT = Math.min(1, Math.max(0, (t - i*0.06)) / (1 - i*0.06));
        const ee = easeOutCubic(localT);
        l.node.textContent = String(Math.round(l.value * ee));
      });
      if (t < 1) requestAnimationFrame(frame);
    }
    if (animateReplay) {
      requestAnimationFrame(frame);
    } else {
      // Set final state without replay animation
      rects.forEach((r)=>{
        const by = y(r.value); const bh = innerH - by;
        r.node.setAttribute('y', `${by}`);
        r.node.setAttribute('height', `${bh}`);
      });
      labels.forEach((l)=>{ l.node.textContent = String(Math.round(l.value)); });
    }
  }

  function setActive(index){
    document.querySelectorAll('.pill').forEach((p,pi)=> p.setAttribute('aria-selected', pi===index?'true':'false'));
    const sel = document.getElementById('category');
    if (sel && sel.value !== String(index)) sel.value = String(index);
    if (typeof buildOptions.updateBSLabel === 'function') buildOptions.updateBSLabel(index);
    const shouldAnimate = !firstRenderDone[index];
    render(index, {animateReplay: shouldAnimate});
    firstRenderDone[index] = true;
    startPolling(index);
  }

  // Expose functions globally for dashboard use
  window.buildOptions = buildOptions;
  window.render = render;
  window.startPolling = startPolling;
  window.setActive = setActive;

  // Check if we're in dashboard (has .dashboard-container)
  const isDashboard = document.querySelector('.dashboard-container');
  
  // Initialize chart - only auto-init if not in dashboard
  if (!isDashboard) {
    buildOptions();
    render(0, {animateReplay:true});
    firstRenderDone[0] = true;
    startPolling(0);
  }

  // Setup replay and theme toggle buttons
  function setupChartButtons() {
    const replayBtn = document.querySelector('[data-replay]');
    if (replayBtn && !replayBtn.dataset.setup) {
      replayBtn.dataset.setup = 'true';
      const handleReplay = ()=>{
        const sel = document.getElementById('category');
        if (sel) render(Number(sel.value||0), {animateReplay:true});
      };
      replayBtn.onclick = handleReplay;
      replayBtn.ontouchend = (e)=>{
        e.preventDefault();
        handleReplay();
      };
    }

    const themeBtn = document.querySelector('[data-theme-toggle]');
    if (themeBtn && !themeBtn.dataset.setup) {
      themeBtn.dataset.setup = 'true';
      // initialize theme from localStorage or system, and persist
      (function initTheme(){
        const stored = localStorage.getItem('theme');
        const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        const theme = stored || (systemDark ? 'dark' : 'light');
        document.documentElement.dataset.theme = theme;
        if (themeBtn) themeBtn.textContent = theme==='dark' ? 'Light' : 'Dark';
      })();
      const handleTheme = ()=>{
        const dark = document.documentElement.dataset.theme !== 'dark';
        const next = dark ? 'dark' : 'light';
        document.documentElement.dataset.theme = next;
        localStorage.setItem('theme', next);
        themeBtn.textContent = next==='dark' ? 'Light' : 'Dark';
      };
      themeBtn.onclick = handleTheme;
      themeBtn.ontouchend = (e)=>{
        e.preventDefault();
        handleTheme();
      };
    }
  }

  // Setup buttons - use setTimeout to ensure DOM is ready
  setTimeout(() => {
    setupChartButtons();
  }, 100);

  // Initialize chart function for dashboard
  window.initChart = function() {
    if (!window.CATEGORIES || window.CATEGORIES.length === 0) {
      // Wait for categories to load
      setTimeout(window.initChart, 100);
      return;
    }
    const chartEl = document.getElementById('chart');
    const categorySel = document.getElementById('category');
    if (!chartEl || !categorySel) return;
    
    buildOptions();
    render(0, {animateReplay:true});
    firstRenderDone[0] = true;
    startPolling(0);
    setupChartButtons();
  };
})();


