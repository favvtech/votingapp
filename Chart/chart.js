(() => {
  const categories = [
    "PEACEMAKER AWARDS",
    "YSA OF THE YEAR (MALE)",
    "YSA OF THE YEAR (FEMALE)",
    "ENTREPRENEUR OF THE YEAR",
    "MUSICAL VOICE AWARDS",
    "BEST DRESSED MALE",
    "BEST DRESSED FEMALE",
    "YSA PARTICIPATION AWARD",
    "MOST CHRISTLIKE AWARD",
    "LEADERSHIP APPRECIATION AWARD"
  ];

  // Mock nominees per category; when unknown, generate placeholders
  const nomineesByCategory = {
    0: ["Momoh Precious","Victor Nweze","Nasir Samuel","Ogbor Emmanuel","Nnamdi Thomas","Tunmise","Ayep Vanessa","Richard Gbadamosi"],
    1: ["Momoh Precious","Suleiman Abraham","Harrison Eyiki","Abel Abraham","Suleiman Ibrahim","Fabolude"],
    2: ["Adenekan Kehinde","Adedamola Bukola","Ajisafe Ochigbo","Precious Duthen","Funmilayo Thomas","Tunmise","Bukola Ajisafe","Victory Igein"],
    3: ["Abraham Suleiman","Harrison Eyiki","Balogun Oluwatosin","Favour Odey","Blessing Obaji","Ruth Mbonu"],
    4: ["Bukola Ajisafe","Adeniran Hallelujah","Eniola Ayinde","Ijeoma Nwabueze","Blessings Obaji","Ruth Mbonu"],
    5: ["Zion Ita","Udong Abasi","Harrison Eyiki","Peter Prosperity","Sunday Samuel","Nasir"],
    6: ["Veronica Akinwande","Thomas Precious","Titi","Thomas Tunmise","Adebimpe Gbadebo","Justina Samuel"],
    7: ["Joy Ford","Adaku","Harrison Eyiki","Joseph Abiodun","Wasiu","Thomas Tunmise","Bamidele Michael","Emmanuel Nasir"],
    8: ["Ememekwe Emmanuel","Chidera Eric","Iorfa Maurice","Ibrahim Fabolude","Love Ayjnde","Feyisola","Thomas Tunmise","Confidence Felix","Samuel Nasir"],
    9: ["Olubisi O.","Olamilekan","Elisha Okon","Maurice","Abraham Suleiman","Adeosun O.","King Abel","Oreoluwa Adebiyi","Samuel Nasir"]
  };

  // Vote data will be fetched from backend
  // Structure: { categoryIndex: { "nomineeName": voteCount, ... }, ... }
  let voteData = {};
  
  // Function to update vote data from backend
  // Call this function with new vote data to refresh the chart
  function updateVoteData(newData) {
    voteData = newData || {};
    // Re-render current chart with new data
    const sel = document.getElementById('category');
    const currentIndex = sel ? Number(sel.value || 0) : 0;
    render(currentIndex, { animateReplay: true });
  }
  
  // Expose updateVoteData globally for backend integration
  window.updateVoteData = updateVoteData;

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

  function niceMax(maxVal) {
    if (!isFinite(maxVal) || maxVal <= 0) return 1;
    // Cap at 250 maximum
    if (maxVal >= 250) return 250;
    const exp = Math.floor(Math.log10(maxVal));
    const base = Math.pow(10, exp);
    const n = maxVal / base;
    let m; if (n <= 1) m = 1; else if (n <= 2) m = 2; else if (n <= 5) m = 5; else m = 10;
    return m * base;
  }

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
    const data = names.map((n) => ({
      name: n,
      value: categoryVotes[n] || 0
    })).sort((a, b) => b.value - a.value);

    // Handle empty data (all votes are 0)
    const maxVote = Math.max(...data.map(d=>d.value), 0);
    const maxVal = maxVote > 0 ? niceMax(maxVote) : 250; // Default to 250 if no votes

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
    if (animateReplay) requestAnimationFrame(frame); else requestAnimationFrame(frame);
  }

  function setActive(index){
    document.querySelectorAll('.pill').forEach((p,pi)=> p.setAttribute('aria-selected', pi===index?'true':'false'));
    const sel = document.getElementById('category');
    if (sel && sel.value !== String(index)) sel.value = String(index);
    if (typeof buildOptions.updateBSLabel === 'function') buildOptions.updateBSLabel(index);
    render(index, {animateReplay:true});
  }

  // init
  buildOptions();
  render(0, {animateReplay:true});

  // replay and theme toggle - use setTimeout to ensure DOM is ready
  setTimeout(()=>{
    const replayBtn = document.querySelector('[data-replay]');
    if (replayBtn){
      const handleReplay = ()=>{
        const sel = document.getElementById('category');
        render(Number(sel.value||0), {animateReplay:true});
      };
      replayBtn.onclick = handleReplay;
      replayBtn.ontouchend = (e)=>{
        e.preventDefault();
        handleReplay();
      };
    }

    const themeBtn = document.querySelector('[data-theme-toggle]');
    // initialize theme from localStorage or system, and persist
    (function initTheme(){
      const stored = localStorage.getItem('theme');
      const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const theme = stored || (systemDark ? 'dark' : 'light');
      document.documentElement.dataset.theme = theme;
      if (themeBtn) themeBtn.textContent = theme==='dark' ? 'Light' : 'Dark';
    })();
    if (themeBtn){
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
  }, 100);
})();


