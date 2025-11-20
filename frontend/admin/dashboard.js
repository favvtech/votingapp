(function() {
    'use strict';

    // API_BASE: in production set window.API_BASE in HTML to your backend URL
    const API_BASE = (typeof window !== 'undefined' && window.API_BASE) || window.location.origin;

    let currentRole = 'admin'; // No sessionStorage for auth - get from backend
    let allUsers = [];
    let categoriesData = window.CATEGORIES || [];
    let inactivityTimer = null;
    const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds

    // Helper function to get admin headers for API requests (no sessionStorage for auth)
    // Includes header fallback for cross-domain cookie issues
    function getAdminHeaders() {
        const headers = {
            'Content-Type': 'application/json'
        };
        
        // Add header fallback if cookies aren't working (from sessionStorage)
        try {
            const fallbackCode = sessionStorage.getItem('admin_access_code_fallback');
            if (fallbackCode) {
                headers['X-Admin-Code'] = fallbackCode;
            }
        } catch (e) {
            // sessionStorage not available, ignore
        }
        
        return headers;
    }

    // Check admin/analyst session on load (no sessionStorage for auth)
    async function checkAdminSession() {
        try {
            // Get fallback code from sessionStorage if available
            let fallbackCode = null;
            let fallbackRole = null;
            try {
                fallbackCode = sessionStorage.getItem('admin_access_code_fallback');
                fallbackRole = sessionStorage.getItem('admin_role_fallback');
                // Ensure code is uppercase and trimmed
                if (fallbackCode) {
                    fallbackCode = fallbackCode.toUpperCase().trim();
                }
            } catch (e) {
                console.warn('Could not read sessionStorage:', e);
            }
            
            let data = null;
            let response = null;
            
            // Try with cookie first
            try {
                response = await fetch(`${API_BASE}/api/admin/check-session`, {
                method: 'GET',
                    credentials: 'include',
                    cache: 'no-store',
                    headers: {
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    }
                });
                
                if (response.ok) {
                    data = await response.json();
                } else {
                    console.warn('Cookie-based session check failed with status:', response.status);
                }
            } catch (e) {
                console.warn('Cookie-based session check error:', e);
            }
            
            // If session check fails or didn't work, try with header fallback
            if ((!data || !data.logged_in) && fallbackCode) {
                try {
                    response = await fetch(`${API_BASE}/api/admin/check-session`, {
                        method: 'GET',
                        credentials: 'include',
                        cache: 'no-store',
                        headers: {
                            'X-Admin-Code': fallbackCode,
                            'Cache-Control': 'no-cache',
                            'Pragma': 'no-cache'
                        }
                    });
                    
                    if (response.ok) {
                        data = await response.json();
                        
                        // If header fallback worked, update role if needed
                        if (data.logged_in && fallbackRole) {
                            currentRole = fallbackRole;
                        }
                    } else {
                        console.warn('Header fallback check failed with status:', response.status);
                    }
                } catch (e) {
                    console.error('Header fallback check error:', e);
                }
            }
            
            // Final check - if still not logged in, redirect to login
            if (!data || !data.logged_in) {
                // Clear any fallback data before redirecting
                try {
                    sessionStorage.removeItem('admin_access_code_fallback');
                    sessionStorage.removeItem('admin_role_fallback');
                } catch (e) {}
                window.location.replace('login.html');
                return;
            }

            // Session is valid - update role and continue
            currentRole = data.role || currentRole || fallbackRole || 'admin';
            updateUIForRole();
        } catch (error) {
            console.error('Session check error:', error);
            // Clear any fallback data before redirecting
            try {
                sessionStorage.removeItem('admin_access_code_fallback');
                sessionStorage.removeItem('admin_role_fallback');
            } catch (e) {}
            window.location.replace('login.html');
        }
    }

    function updateUIForRole() {
        const roleBadge = document.getElementById('roleBadge');
        const userName = document.getElementById('userName');
        const navUsers = document.getElementById('navUsers');
        const navVotes = document.getElementById('navVotes');
        const navRegistration = document.getElementById('navRegistration');
        const navNominees = document.getElementById('navNominees');

        if (roleBadge) {
            roleBadge.textContent = currentRole === 'admin' ? 'Admin' : 'Analyst';
        }

        if (userName) {
            userName.textContent = currentRole === 'admin' ? 'Admin' : 'Analyst';
        }

        // Hide admin-only nav items for analyst
        if (currentRole === 'analyst') {
            if (navUsers) navUsers.style.display = 'none';
            if (navVotes) navVotes.style.display = 'none';
            if (navRegistration) navRegistration.style.display = 'none';
            if (navNominees) navNominees.style.display = 'none';
        }
    }

    // Navigation system
    function initNavigation() {
        const navItems = document.querySelectorAll('.nav-item[data-page]');
        const pages = document.querySelectorAll('.page');
        const sidebar = document.getElementById('sidebar');
        const sidebarToggle = document.getElementById('sidebarToggle');
        const mobileMenuToggle = document.getElementById('mobileMenuToggle');

        // Page switching
        navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const targetPage = item.dataset.page;
                
                // Update active nav item
                navItems.forEach(nav => nav.classList.remove('active'));
                item.classList.add('active');
                
                // Show target page
                pages.forEach(page => page.style.display = 'none');
                const targetPageEl = document.getElementById(`page-${targetPage}`);
                if (targetPageEl) {
                    targetPageEl.style.display = 'block';
                }
                
                // Close sidebar on mobile
                if (window.innerWidth <= 1024) {
                    sidebar.classList.remove('open');
                }
            });
        });

        // Sidebar toggle
        if (sidebarToggle) {
            sidebarToggle.addEventListener('click', () => {
                sidebar.classList.toggle('open');
            });
        }

        if (mobileMenuToggle) {
            mobileMenuToggle.addEventListener('click', () => {
                sidebar.classList.toggle('open');
            });
        }

        // Close sidebar when clicking outside on mobile
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 1024 && sidebar.classList.contains('open')) {
                if (!sidebar.contains(e.target) && !mobileMenuToggle.contains(e.target)) {
                    sidebar.classList.remove('open');
                }
            }
        });

        // Show dashboard by default
        document.getElementById('page-dashboard').style.display = 'block';
    }

    // Initialize
    async function init() {
        await checkAdminSession();
        initNavigation();
        initUserDropdown();
        await loadAnalytics();
        initInactivityDetection();
        
        // Make Total Votes card clickable
        const totalVotesCard = document.getElementById('totalVotesCard');
        if (totalVotesCard) {
            totalVotesCard.addEventListener('click', () => {
                // Add highlight class
                document.querySelectorAll('.stat-card').forEach(card => card.classList.remove('highlight'));
                totalVotesCard.classList.add('highlight');
                showNomineesOverview();
            });
        }
        
        // Make Vote Distribution card clickable
        const voteDistributionCard = document.getElementById('voteDistributionCard');
        if (voteDistributionCard) {
            voteDistributionCard.addEventListener('click', () => {
                // Add highlight class
                document.querySelectorAll('.stat-card').forEach(card => card.classList.remove('highlight'));
                voteDistributionCard.classList.add('highlight');
                showVoteDistributionModal();
            });
        }
        
        // Make Total Users card clickable (admin only)
        const totalUsersCard = document.getElementById('totalUsersCard');
        if (totalUsersCard) {
            if (currentRole === 'admin') {
                totalUsersCard.addEventListener('click', () => {
                    // Add highlight class
                    document.querySelectorAll('.stat-card').forEach(card => card.classList.remove('highlight'));
                    totalUsersCard.classList.add('highlight');
                    showAllUsers();
                });
            } else {
                totalUsersCard.classList.remove('clickable-stat');
            }
        }
        
        // Make Categories card clickable
        const categoriesCard = document.getElementById('categoriesCard');
        if (categoriesCard) {
            categoriesCard.addEventListener('click', () => {
                // Add highlight class
                document.querySelectorAll('.stat-card').forEach(card => card.classList.remove('highlight'));
                categoriesCard.classList.add('highlight');
                showAllCategories();
            });
        }
        
        if (currentRole === 'admin') {
            await loadUsers();
            setupAdminHandlers();
        }
    }

    // Show all users modal
    async function showAllUsers() {
        if (currentRole !== 'admin') {
            showToast('Admin access required', 'error');
            return;
        }

        if (allUsers.length === 0) {
            await loadUsers();
        }

        const modalContent = `
            <div class="users-overview-modal">
                <div class="modal-header-info">
                    <p class="modal-info-text">All registered users in the system</p>
                </div>
                <div class="users-list-modal">
                    ${allUsers.map(user => {
                        const votesCount = user.votes ? user.votes.length : 0;
                        return `
                            <div class="user-row-modal clickable" data-user-id="${user.id}">
                                <div class="user-avatar-modal">
                                    ${user.fullname ? user.fullname.charAt(0).toUpperCase() : 'U'}
                                </div>
                                <div class="user-details-modal">
                                    <div class="user-name-full">${escapeHtml(user.fullname || 'N/A')}</div>
                                    <div class="user-meta-modal">
                                        <span>${escapeHtml(user.email || 'No email')}</span>
                                        <span>•</span>
                                        <span>${escapeHtml(user.phone || 'N/A')}</span>
                                    </div>
                                </div>
                                <div class="user-votes-info">
                                    <div class="vote-badge">${votesCount}</div>
                                    <span class="vote-text-small">votes</span>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;

        showModal('All Users', modalContent);
        
        // Make user rows clickable
        setTimeout(() => {
            document.querySelectorAll('.user-row-modal.clickable').forEach(row => {
                row.addEventListener('click', () => {
                    const userId = parseInt(row.dataset.userId);
                    // Close current modal
                    document.querySelector('.custom-modal')?.remove();
                    // Show user details
                    showUserDetails(userId);
                });
            });
        }, 100);
    }

    // Show vote distribution modal (detailed view with participation stats)
    async function showVoteDistributionModal() {
        const categoriesContent = [];
        
        // Fetch data for all categories
        for (const category of categoriesData) {
            const timestamp = Date.now();
            const response = await fetch(`${API_BASE}/api/categories/${category.number}/results?t=${timestamp}`, {
                credentials: 'include'
            });
            
            if (response.ok) {
                const data = await response.json();
                const nominees = category.nominees;
                const nomineesVoted = new Set(data.results.map(r => r.nominee_id));
                const nomineesVotedCount = nomineesVoted.size;
                const percentage = nominees.length > 0 ? ((nomineesVotedCount / nominees.length) * 100).toFixed(1) : 0;
                const totalVotes = data.results.reduce((sum, r) => sum + r.votes, 0);
                
                categoriesContent.push({
                    category: category,
                    nomineesVoted: nomineesVotedCount,
                    totalNominees: nominees.length,
                    percentage: percentage,
                    totalVotes: totalVotes
                });
            }
        }

        // Sort by percentage descending
        categoriesContent.sort((a, b) => b.percentage - a.percentage);

        const modalContent = `
            <div class="categories-overview-modal">
                <div class="modal-header-info">
                    <p class="modal-info-text">All categories with nominee participation</p>
                </div>
                <div class="categories-grid-modal">
                    ${categoriesContent.map(cat => `
                        <div class="category-card-modal clickable" data-category-id="${cat.category.number}">
                            <div class="category-card-header-modal">
                                <h4 class="category-title-modal">${escapeHtml(cat.category.title)}</h4>
                                <div class="category-number-badge">Category ${cat.category.number}</div>
                            </div>
                            <div class="category-stats-modal">
                                <div class="category-stat-item">
                                    <span class="stat-label-modal">Nominees Voted</span>
                                    <span class="stat-value-modal">${cat.nomineesVoted}/${cat.totalNominees}</span>
                                </div>
                                <div class="category-stat-item">
                                    <span class="stat-label-modal">Participation</span>
                                    <span class="stat-value-modal">${cat.percentage}%</span>
                                </div>
                                <div class="category-stat-item">
                                    <span class="stat-label-modal">Total Votes</span>
                                    <span class="stat-value-modal">${cat.totalVotes}</span>
                                </div>
                            </div>
                            <div class="category-progress-bar-modal">
                                <div class="category-progress-fill-modal" style="width: ${cat.percentage}%"></div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        showModal('Vote Distribution by Category', modalContent);
        
        // Make category cards clickable
        setTimeout(() => {
            document.querySelectorAll('.category-card-modal.clickable').forEach(card => {
                card.addEventListener('click', () => {
                    const categoryId = parseInt(card.dataset.categoryId);
                    // Close current modal
                    document.querySelector('.custom-modal')?.remove();
                    // Show category details
                    showCategoryDetails(categoryId);
                });
            });
        }, 100);
    }

    // Show all categories modal (simple list for Categories card)
    async function showAllCategories() {
        const modalContent = `
            <div class="categories-simple-modal">
                <div class="modal-header-info">
                    <p class="modal-info-text">All available categories</p>
                </div>
                <div class="categories-simple-list">
                    ${categoriesData.map(category => `
                        <div class="category-simple-row">
                            <div class="category-name-simple">${escapeHtml(category.title)}</div>
                            <div class="category-nominee-count">${category.nominees.length} ${category.nominees.length === 1 ? 'nominee' : 'nominees'}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        showModal('All Categories', modalContent);
    }

    // Analytics
    async function loadAnalytics() {
        try {
            // Force fresh fetch with cache-busting
            const timestamp = Date.now();
            // Get total votes (available for both admin and analyst)
            try {
                const votesResponse = await fetch(`${API_BASE}/api/admin/total-votes?t=${timestamp}`, {
                    credentials: 'include',
                    headers: getAdminHeaders()
                });
                if (votesResponse.ok) {
            const votesData = await votesResponse.json();
            if (votesData.success) {
                        const totalVotesEl = document.getElementById('totalVotes');
                        if (totalVotesEl) {
                            totalVotesEl.textContent = votesData.total || 0;
                        }
                    } else {
                        console.error('Failed to get total votes:', votesData);
                        const totalVotesEl = document.getElementById('totalVotes');
                        if (totalVotesEl) totalVotesEl.textContent = '0';
                    }
                } else {
                    console.error('Failed to fetch total votes:', votesResponse.status);
                    const totalVotesEl = document.getElementById('totalVotes');
                    if (totalVotesEl) totalVotesEl.textContent = '0';
                }
            } catch (error) {
                console.error('Error loading total votes:', error);
                const totalVotesEl = document.getElementById('totalVotes');
                if (totalVotesEl) totalVotesEl.textContent = '0';
            }

            // Get total users (admin and analyst - same count)
            if (currentRole === 'admin' || currentRole === 'analyst') {
                try {
                    const usersTimestamp = Date.now();
                    const usersResponse = await fetch(`${API_BASE}/api/admin/users?t=${usersTimestamp}`, {
                        credentials: 'include',
                        headers: getAdminHeaders()
                    });
                    if (usersResponse.ok) {
                    const usersData = await usersResponse.json();
                        if (usersData.success && usersData.users) {
                        const totalUsers = usersData.users.length;
                            const totalUsersEl = document.getElementById('totalUsers');
                            if (totalUsersEl) {
                                totalUsersEl.textContent = totalUsers;
                            }
                            // Only store allUsers for admin (analyst doesn't need full user list)
                            if (currentRole === 'admin') {
                        allUsers = usersData.users;
                            }
                        } else {
                            console.error('Failed to get users:', usersData);
                            const totalUsersEl = document.getElementById('totalUsers');
                            if (totalUsersEl) totalUsersEl.textContent = '0';
                        }
                    } else {
                        console.error('Failed to fetch users:', usersResponse.status);
                        const totalUsersEl = document.getElementById('totalUsers');
                        if (totalUsersEl) totalUsersEl.textContent = '0';
                    }
                } catch (error) {
                    console.error('Error loading users:', error);
                    const totalUsersEl = document.getElementById('totalUsers');
                    if (totalUsersEl) totalUsersEl.textContent = '0';
                }
            }

            // Load distribution
            await loadDistributionChart();
        } catch (error) {
            console.error('Analytics error:', error);
            showToast('Failed to load analytics', 'error');
        }
    }

    let distributionData = [];
    let hasAnimated = false;

    async function loadDistributionChart() {
        try {
            const distributionChart = document.getElementById('distributionChart');
            const distributionPreview = document.getElementById('distributionPreview');
            if (!distributionChart) return;

            distributionData = [];
            
            for (let i = 0; i < categoriesData.length; i++) {
                const category = categoriesData[i];
                const categoryId = category.number;
                const totalNominees = category.nominees.length;
                
                const timestamp = Date.now();
                const response = await fetch(`${API_BASE}/api/categories/${categoryId}/results?t=${timestamp}`, {
                    credentials: 'include'
                });
                
                if (response.ok) {
                    const data = await response.json();
                    // Count unique nominees that have been voted for
                    const nomineesVoted = new Set(data.results.map(r => r.nominee_id));
                    const nomineesVotedCount = nomineesVoted.size;
                    const percentage = totalNominees > 0 ? ((nomineesVotedCount / totalNominees) * 100).toFixed(1) : 0;
                    
                    distributionData.push({
                        categoryId: categoryId,
                        name: category.title,
                        nomineesVoted: nomineesVotedCount,
                        totalNominees: totalNominees,
                        percentage: parseFloat(percentage)
                    });
                }
            }

            // Update preview
            if (distributionPreview) {
                const topCategory = distributionData.sort((a, b) => b.percentage - a.percentage)[0];
                if (topCategory) {
                    distributionPreview.innerHTML = `<strong>${topCategory.name}</strong>: ${topCategory.nomineesVoted}/${topCategory.totalNominees} nominees voted`;
                }
            }

            // Update full chart with animation
            renderDistributionChart(distributionChart, true);
        } catch (error) {
            console.error('Distribution error:', error);
        }
    }

    function renderDistributionChart(container, animate = false) {
        if (!container) return;
        
        container.innerHTML = distributionData.map((cat, index) => {
            const percentage = cat.percentage;
            
            return `
                <div class="distribution-item clickable" data-category-id="${cat.categoryId}">
                    <div class="distribution-item-name">${cat.name}</div>
                    <div class="distribution-item-bar">
                        <div class="distribution-item-fill" 
                             data-width="${percentage}" 
                             style="width: ${animate ? 0 : percentage}%"></div>
                    </div>
                    <div class="distribution-item-value">${cat.nomineesVoted}/${cat.totalNominees} (${percentage}%)</div>
                </div>
            `;
        }).join('');

        // Animate bars on first load
        if (animate && !hasAnimated) {
            hasAnimated = true;
            setTimeout(() => {
                container.querySelectorAll('.distribution-item-fill').forEach((fill, index) => {
                    setTimeout(() => {
                        const width = fill.dataset.width;
                        fill.style.transition = 'width 0.8s ease-out';
                        fill.style.width = width + '%';
                    }, index * 100);
                });
            }, 100);
        }

        // Make category items clickable
        container.querySelectorAll('.distribution-item.clickable').forEach(item => {
            item.addEventListener('click', () => {
                const categoryId = parseInt(item.dataset.categoryId);
                showCategoryDetails(categoryId);
            });
        });
    }

    // Show category details modal
    async function showCategoryDetails(categoryId) {
        const category = categoriesData.find(c => c.number === categoryId);
        if (!category) return;

        // Fetch vote results for this category
        const timestamp = Date.now();
        const response = await fetch(`${API_BASE}/api/categories/${categoryId}/results?t=${timestamp}`, {
            credentials: 'include'
        });
        
        if (!response.ok) return;
        
        const data = await response.json();
        const nominees = category.nominees;
        // Create a map from nominee_id (1-based) to vote count
        const voteCountByNomineeId = {};
        data.results.forEach(r => {
            voteCountByNomineeId[r.nominee_id] = r.votes;
        });
        
        // Map nominee names to votes by iterating nominees in order
        // nominee_id = array_index + 1 (1-based)
        const voteMap = {};
        nominees.forEach((nominee, index) => {
            const nomineeId = index + 1; // Convert 0-based index to 1-based nominee_id
            voteMap[nominee] = voteCountByNomineeId[nomineeId] || 0;
        });

        // Create modal content
        const modalContent = `
            <div class="category-details-modal">
                <div class="modal-category-header">
                    <h3>${category.title}</h3>
                    <p class="modal-category-subtitle">Category ${category.number}</p>
                </div>
                <div class="nominees-grid">
                    ${nominees.map((nominee, index) => {
                        const votes = voteMap[nominee] || 0;
                        const hasVotes = votes > 0;
                        return `
                            <div class="nominee-card-modal ${hasVotes ? 'has-votes' : ''}">
                                <div class="nominee-avatar">
                                    ${nominee.charAt(0).toUpperCase()}
                                </div>
                                <div class="nominee-info-modal">
                                    <div class="nominee-name-modal">${escapeHtml(nominee)}</div>
                                    <div class="nominee-votes-modal">
                                        <span class="vote-count">${votes}</span>
                                        <span class="vote-label">votes</span>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;

        showModal('Category Details', modalContent);
    }

    // Show nominees overview modal (from Total Votes card) - Optimized version
    async function showNomineesOverview() {
        // Show loading state
        const loadingContent = `
            <div class="nominees-overview-modal">
                <div class="modal-header-info">
                    <p class="modal-info-text">Loading nominees data...</p>
                </div>
                <div class="nominees-list-modal" style="text-align: center; padding: 40px;">
                    <div class="loading-spinner"></div>
                </div>
            </div>
        `;
        showModal('All Nominees', loadingContent);

        try {
            const allNomineesData = [];
            
            // Fetch vote data for all categories in parallel for better performance
            const fetchPromises = categoriesData.map(category => {
                const timestamp = Date.now();
                return fetch(`${API_BASE}/api/categories/${category.number}/results?t=${timestamp}`, {
                    credentials: 'include'
                }).then(response => {
                    if (response.ok) {
                        return response.json().then(data => ({ category, data }));
                    }
                    return null;
                }).catch(() => null);
            });

            const results = await Promise.all(fetchPromises);

            // Process all results
            results.forEach(result => {
                if (!result) return;
                
                const { category, data } = result;
                const nominees = category.nominees;
                
                if (data.results) {
                    // Create a map from nominee_id to vote count
                    const voteCountByNomineeId = {};
                    data.results.forEach(r => {
                        voteCountByNomineeId[r.nominee_id] = r.votes;
                    });
                    
                    // Map votes to nominee names by iterating nominees in order
                    // nominee_id = array_index + 1 (1-based)
                    nominees.forEach((nominee, index) => {
                        const nomineeId = index + 1; // Convert 0-based index to 1-based nominee_id
                        const votes = voteCountByNomineeId[nomineeId] || 0;
                        if (votes > 0) {
                            allNomineesData.push({
                                name: nominee,
                                votes: votes
                            });
                        }
                    });
                }
            });

            // Aggregate votes by nominee name (same nominee might be in multiple categories)
            const nomineeMap = {};
            allNomineesData.forEach(n => {
                if (nomineeMap[n.name]) {
                    nomineeMap[n.name].votes += n.votes;
                } else {
                    nomineeMap[n.name] = {
                        name: n.name,
                        votes: n.votes
                    };
                }
            });

            // Sort by votes descending
            const sortedNominees = Object.values(nomineeMap).sort((a, b) => b.votes - a.votes);

            const modalContent = `
                <div class="nominees-overview-modal">
                    <div class="modal-header-info">
                        <p class="modal-info-text">All nominees with total votes</p>
                    </div>
                    <div class="nominees-list-modal">
                        ${sortedNominees.map(nominee => `
                            <div class="nominee-row-modal">
                                <div class="nominee-avatar-small">${nominee.name.charAt(0).toUpperCase()}</div>
                                <div class="nominee-details-modal">
                                    <div class="nominee-name-full">${escapeHtml(nominee.name)}</div>
                                </div>
                                <div class="nominee-votes-total">
                                    <span class="vote-number">${nominee.votes}</span>
                                    <span class="vote-text">votes</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;

            // Update modal with content
            const existingModal = document.querySelector('.custom-modal');
            if (existingModal) {
                const contentDiv = existingModal.querySelector('.custom-modal-body');
                if (contentDiv) {
                    contentDiv.innerHTML = modalContent;
                }
            } else {
                showModal('All Nominees', modalContent);
            }
        } catch (error) {
            console.error('Error loading nominees:', error);
            showToast('Failed to load nominees data', 'error');
            
            // Remove modal on error
            const existingModal = document.querySelector('.custom-modal');
            if (existingModal) {
                existingModal.remove();
            }
        }
    }

    // Generic modal function
    function showModal(title, content) {
        // Remove existing modal if any
        const existingModal = document.querySelector('.custom-modal');
        if (existingModal) {
            existingModal.remove();
        }

        const modal = document.createElement('div');
        modal.className = 'custom-modal';
        modal.innerHTML = `
            <div class="custom-modal-overlay"></div>
            <div class="custom-modal-content">
                <div class="custom-modal-header">
                    <h3>${title}</h3>
                    <button class="custom-modal-close" aria-label="Close">×</button>
                </div>
                <div class="custom-modal-body">
                    ${content}
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Close handlers
        const closeBtn = modal.querySelector('.custom-modal-close');
        const overlay = modal.querySelector('.custom-modal-overlay');
        
        const closeModal = () => modal.remove();
        
        closeBtn.addEventListener('click', closeModal);
        overlay.addEventListener('click', closeModal);
        
        // Close on Escape key
        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);
    }

    // User Management
    async function loadUsers() {
        try {
            const timestamp = Date.now();
            const response = await fetch(`${API_BASE}/api/admin/users?t=${timestamp}`, {
                credentials: 'include',
                headers: getAdminHeaders()
            });
            const data = await response.json();
            
            if (data.success) {
                allUsers = data.users;
                renderUsers(allUsers);
            }
        } catch (error) {
            console.error('Load users error:', error);
            showToast('Failed to load users', 'error');
        }
    }

    function renderUsers(users) {
        const tbody = document.getElementById('usersTableBody');
        if (!tbody) return;

        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty">No users found</td></tr>';
            return;
        }

        tbody.innerHTML = users.map(user => {
            const votes = user.votes || [];
            const votesCount = votes.length;
            const votesDisplay = votesCount > 0 
                ? `<a href="#" class="view-votes-link" data-user-id="${user.id}">${votesCount}</a>`
                : '0';

            return `
                <tr>
                    <td>${escapeHtml(user.fullname || 'N/A')}</td>
                    <td>${escapeHtml(user.email || 'N/A')}</td>
                    <td>${escapeHtml(user.phone || 'N/A')}</td>
                    <td><code>${escapeHtml(user.access_code || 'N/A')}</code></td>
                    <td>${votesDisplay}</td>
                    <td>
                        <button class="btn-small danger delete-user-btn" data-user-id="${user.id}">Delete</button>
                    </td>
                </tr>
            `;
        }).join('');

        // Attach event listeners
        document.querySelectorAll('.delete-user-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const userId = e.target.dataset.userId;
                deleteUser(userId);
            });
        });

        document.querySelectorAll('.view-votes-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const userId = parseInt(e.target.dataset.userId || e.target.closest('.view-votes-link')?.dataset.userId);
                if (userId) {
                    showUserVotesModal(userId);
                }
            });
        });
    }

    async function deleteUser(userId) {
        if (!confirm('Are you sure you want to delete this user? All their votes will also be deleted.')) {
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: getAdminHeaders()
            });
            const data = await response.json();
            
            if (data.success) {
                showToast('User deleted successfully', 'success');
                await loadUsers();
                await loadAnalytics();
            } else {
                showToast(data.message || 'Failed to delete user', 'error');
            }
        } catch (error) {
            console.error('Delete user error:', error);
            showToast('Failed to delete user', 'error');
        }
    }

    // Show user votes modal with nominee cards
    async function showUserVotesModal(userId) {
        const user = allUsers.find(u => u.id === userId);
        if (!user) {
            showToast('User not found', 'error');
            return;
        }

        const votes = user.votes || [];
        
        if (votes.length === 0) {
            const modalContent = `
                <div class="user-votes-modal">
                    <div class="modal-header-info">
                        <p class="modal-info-text">${escapeHtml(user.fullname)} has not voted for any nominees yet.</p>
                    </div>
                    <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
                        <p>No votes found</p>
                    </div>
                </div>
            `;
            showModal(`Votes - ${escapeHtml(user.fullname)}`, modalContent);
            return;
        }

        // Build nominee cards from votes
        const nomineeCards = votes.map(vote => {
            const category = categoriesData.find(c => c.number === vote.category_id);
            if (!category) {
                return null;
            }
            
            // nominee_id is 1-based, so subtract 1 to get array index
            const nomineeIndex = vote.nominee_id - 1;
            const nominee = category.nominees[nomineeIndex];
            
            if (!nominee) {
                return null;
            }
            
            // Get first letter of nominee name for avatar
            const firstLetter = nominee.charAt(0).toUpperCase();
            
            // Format vote date if available
            let voteDate = '';
            if (vote.created_at) {
                try {
                    voteDate = new Date(vote.created_at).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    });
                } catch (e) {
                    voteDate = '';
                }
            }
            
            return `
                <div class="nominee-card-modal has-votes">
                    <div class="nominee-avatar">${firstLetter}</div>
                    <div class="nominee-info-modal">
                        <div class="nominee-name-modal">${escapeHtml(nominee)}</div>
                        <div class="nominee-category-badge">${escapeHtml(category.title)}</div>
                        ${voteDate ? `<div class="vote-date" style="font-size: 11px; color: var(--text-muted); margin-top: 8px;">${voteDate}</div>` : ''}
                    </div>
                </div>
            `;
        }).filter(card => card !== null);

        if (nomineeCards.length === 0) {
            const modalContent = `
                <div class="user-votes-modal">
                    <div class="modal-header-info">
                        <p class="modal-info-text">Unable to load vote details for ${escapeHtml(user.fullname)}.</p>
                    </div>
                </div>
            `;
            showModal(`Votes - ${escapeHtml(user.fullname)}`, modalContent);
            return;
        }

        const modalContent = `
            <div class="user-votes-modal">
                <div class="modal-header-info">
                    <p class="modal-info-text">${escapeHtml(user.fullname)} has voted for ${nomineeCards.length} ${nomineeCards.length === 1 ? 'nominee' : 'nominees'}</p>
                </div>
                <div class="nominees-grid">
                    ${nomineeCards.join('')}
                </div>
            </div>
        `;

        showModal(`Votes - ${escapeHtml(user.fullname)}`, modalContent);
    }

    async function showUserDetails(userId) {
        const user = allUsers.find(u => u.id === userId);
        if (!user) return;

        const modal = document.getElementById('userDetailsModal');
        const content = document.getElementById('userDetailsContent');
        
        const votesList = user.votes && user.votes.length > 0
            ? user.votes.map(vote => {
                const category = categoriesData.find(c => c.number === vote.category_id);
                const nominee = category ? category.nominees[vote.nominee_id - 1] : 'Unknown';
                return `<li>${category ? category.title : 'Category ' + vote.category_id}: ${nominee}</li>`;
            }).join('')
            : '<li>No votes</li>';

        content.innerHTML = `
            <div style="line-height: 1.8;">
                <p><strong>Name:</strong> ${escapeHtml(user.fullname)}</p>
                <p><strong>Email:</strong> ${escapeHtml(user.email || 'N/A')}</p>
                <p><strong>Phone:</strong> ${escapeHtml(user.phone)}</p>
                <p><strong>Access Code:</strong> <code>${escapeHtml(user.access_code)}</code></p>
                <p><strong>Birthdate:</strong> ${escapeHtml(user.birthdate)}</p>
                <p><strong>Registered:</strong> ${new Date(user.created_at).toLocaleString()}</p>
                <p><strong>Votes (${user.votes ? user.votes.length : 0}):</strong></p>
                <ul style="margin-left: 20px; margin-top: 8px;">
                    ${votesList}
                </ul>
            </div>
        `;

        modal.style.display = 'flex';
    }

    // Vote Management
    function setupAdminHandlers() {
        // Voting Session Toggle
        const votingToggle = document.getElementById('votingSessionToggle');
        const votingLabel = document.getElementById('votingSessionLabel');
        
        async function loadVotingStatus() {
            try {
                const headers = {
                    ...getAdminHeaders(),
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                };
                const response = await fetch(`${API_BASE}/api/admin/voting-status?t=${Date.now()}`, {
                    method: 'GET',
                    credentials: 'include',
                    cache: 'no-store',
                    headers
                });
                const data = await response.json();
                if (data.success !== undefined && votingToggle) {
                    // Only update if state actually changed to prevent flickering
                    const currentState = votingToggle.checked;
                    const serverState = data.voting_active;
                    
                    if (currentState !== serverState) {
                        // Temporarily remove event listener to prevent recursive calls
                        if (handleToggleChange) {
                            votingToggle.removeEventListener('change', handleToggleChange);
                        }
                        votingToggle.checked = serverState;
                        // Re-add listener after a short delay
                        setTimeout(() => {
                            if (handleToggleChange) {
                                votingToggle.addEventListener('change', handleToggleChange);
                            }
                        }, 100);
                    }
                    if (votingLabel) {
                        votingLabel.textContent = serverState ? 'ON' : 'OFF';
                    }
                }
            } catch (error) {
                console.error('Error loading voting status:', error);
            }
        }
        
        async function updateVotingStatus(active) {
            try {
                const response = await fetch(`${API_BASE}/api/admin/voting-status`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: getAdminHeaders(),
                    body: JSON.stringify({ voting_active: active }),
                    cache: 'no-store'
                });
                const data = await response.json();
                if (data.success) {
                    // Immediately update toggle state to prevent flickering
                    if (votingToggle) {
                        // Temporarily remove event listener to prevent recursive calls
                        votingToggle.removeEventListener('change', handleToggleChange);
                        votingToggle.checked = active;
                        // Re-add listener after a short delay
                        setTimeout(() => {
                            votingToggle.addEventListener('change', handleToggleChange);
                        }, 100);
                    }
                    if (votingLabel) {
                        votingLabel.textContent = active ? 'ON' : 'OFF';
                    }
                    showToast(data.message || `Voting session ${active ? 'activated' : 'deactivated'}`, 'success');
                    
                    // Verify status after a short delay (don't reload immediately to prevent flickering)
                    setTimeout(() => {
                        loadVotingStatus();
                    }, 1000);
                } else {
                    showToast(data.message || 'Failed to update voting status', 'error');
                    // Revert toggle
                    if (votingToggle) {
                        votingToggle.removeEventListener('change', handleToggleChange);
                        votingToggle.checked = !active;
                        setTimeout(() => {
                            votingToggle.addEventListener('change', handleToggleChange);
                        }, 100);
                    }
                    // Reload status
                    loadVotingStatus();
                }
            } catch (error) {
                console.error('Error updating voting status:', error);
                showToast('Failed to update voting status', 'error');
                // Revert toggle
                if (votingToggle) {
                    votingToggle.removeEventListener('change', handleToggleChange);
                    votingToggle.checked = !active;
                    setTimeout(() => {
                        votingToggle.addEventListener('change', handleToggleChange);
                    }, 100);
                }
                // Reload status
                loadVotingStatus();
            }
        }
        
        // Store toggle change handler for removal/re-addition
        let handleToggleChange = null;
        
        if (votingToggle) {
            // Load initial status
            loadVotingStatus();
            
            // Store pending state
            let pendingToggleState = null;
            const authModal = document.getElementById('votingToggleAuthModal');
            const accessCodeInput = document.getElementById('votingToggleAccessCode');
            const toggleActionText = document.getElementById('toggleActionText');
            const toggleError = document.getElementById('votingToggleError');
            const confirmBtn = document.getElementById('confirmVotingToggleBtn');
            const cancelBtn = document.getElementById('cancelVotingToggleBtn');
            
            // Show auth modal before toggling
            function showAuthModal(newState) {
                pendingToggleState = newState;
                const action = newState ? 'activate' : 'deactivate';
                if (toggleActionText) {
                    toggleActionText.textContent = action;
                }
                if (accessCodeInput) {
                    accessCodeInput.value = '';
                    accessCodeInput.type = 'password'; // Reset to password type
                    accessCodeInput.focus();
                }
                // Reset visibility toggle icon
                const accessCodeToggleIcon = document.getElementById('votingToggleAccessCodeToggleIcon');
                if (accessCodeToggleIcon) {
                    accessCodeToggleIcon.innerHTML = `
                        <path d="M12 5C7 5 2.73 8.11 1 12c1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7Z" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke-linecap="round" stroke-linejoin="round"/>
                    `;
                }
                if (toggleError) {
                    toggleError.style.display = 'none';
                    toggleError.textContent = '';
                }
                if (authModal) {
                    authModal.style.display = 'flex';
                }
            }
            
            // Hide auth modal
            function hideAuthModal() {
                const previousState = pendingToggleState;
                pendingToggleState = null;
                if (authModal) {
                    authModal.style.display = 'none';
                }
                if (accessCodeInput) {
                    accessCodeInput.value = '';
                }
                if (toggleError) {
                    toggleError.style.display = 'none';
                    toggleError.textContent = '';
                }
                // Revert toggle to original state
                if (votingToggle && previousState !== null) {
                    votingToggle.checked = !previousState;
                }
            }
            
            // Verify access code and toggle
            async function verifyAndToggle() {
                const code = accessCodeInput ? accessCodeInput.value.trim().toUpperCase() : '';
                if (!code) {
                    if (toggleError) {
                        toggleError.textContent = 'Please enter your admin access code';
                        toggleError.style.display = 'block';
                    }
                    return;
                }
                
                try {
                    // Verify admin access code
                    const verifyResponse = await fetch(`${API_BASE}/api/admin/login`, {
                        method: 'POST',
                        credentials: 'include',
                        headers: getAdminHeaders(),
                        body: JSON.stringify({ access_code: code })
                    });
                    const verifyData = await verifyResponse.json();
                    
                    if (verifyResponse.ok && verifyData.success) {
                        // Access code verified, proceed with toggle
                        const targetState = pendingToggleState;
                        hideAuthModal();
                        // Update toggle immediately before API call
                        if (votingToggle) {
                            votingToggle.checked = targetState;
                        }
                        if (votingLabel) {
                            votingLabel.textContent = targetState ? 'ON' : 'OFF';
                        }
                        await updateVotingStatus(targetState);
                    } else {
                        // Invalid access code
                        if (toggleError) {
                            toggleError.textContent = verifyData.message || 'Invalid admin access code';
                            toggleError.style.display = 'block';
                        }
                        if (accessCodeInput) {
                            accessCodeInput.value = '';
                            accessCodeInput.focus();
                        }
                    }
                } catch (error) {
                    console.error('Error verifying access code:', error);
                    if (toggleError) {
                        toggleError.textContent = 'Error verifying access code. Please try again.';
                        toggleError.style.display = 'block';
                    }
                }
            }
            
            // Password visibility toggle for access code
            const accessCodeToggleBtn = document.getElementById('votingToggleAccessCodeToggle');
            const accessCodeToggleIcon = document.getElementById('votingToggleAccessCodeToggleIcon');
            if (accessCodeToggleBtn && accessCodeInput && accessCodeToggleIcon) {
                accessCodeToggleBtn.addEventListener('click', () => {
                    const isPassword = accessCodeInput.type === 'password';
                    accessCodeInput.type = isPassword ? 'text' : 'password';
                    // Update icon
                    if (isPassword) {
                        // Show eye-off icon
                        accessCodeToggleIcon.innerHTML = `
                            <path d="M3 3l18 18" stroke="currentColor" stroke-linecap="round"/>
                            <path d="M10.58 10.58A4 4 0 0 0 12 16a4 4 0 0 0 3.42-6.42M17.94 17.94C16.22 19.23 14.18 20 12 20 7 20 2.73 16.89 1 13c.56-1.25 1.38-2.41 2.4-3.43M6.06 6.06C7.78 4.77 9.82 4 12 4c5 0 9.27 3.11 11 7-.48 1.08-1.13 2.1-1.92 3" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>
                        `;
                    } else {
                        // Show eye icon
                        accessCodeToggleIcon.innerHTML = `
                            <path d="M12 5C7 5 2.73 8.11 1 12c1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7Z" stroke-linecap="round" stroke-linejoin="round"/>
                            <path d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke-linecap="round" stroke-linejoin="round"/>
                        `;
                    }
                });
            }
            
            // Update on toggle - show auth modal first
            handleToggleChange = (e) => {
                const newState = e.target.checked;
                // Prevent immediate toggle, show modal first
                e.preventDefault();
                votingToggle.checked = !newState; // Revert immediately
                showAuthModal(newState);
            };
            votingToggle.addEventListener('change', handleToggleChange);
            
            // Handle access code input - auto uppercase (works for both text and password types)
            if (accessCodeInput) {
                accessCodeInput.addEventListener('input', (e) => {
                    const originalValue = e.target.value;
                    const upperValue = originalValue.toUpperCase().replace(/[^A-Z0-9]/g, '');
                    if (originalValue !== upperValue) {
                        e.target.value = upperValue;
                    }
                    if (toggleError) {
                        toggleError.style.display = 'none';
                    }
                });
                
                accessCodeInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        verifyAndToggle();
                    }
                });
            }
            
            // Confirm button
            if (confirmBtn) {
                confirmBtn.addEventListener('click', verifyAndToggle);
            }
            
            // Cancel button
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    hideAuthModal();
                });
            }
            
            // Close modal on outside click
            if (authModal) {
                authModal.addEventListener('click', (e) => {
                    if (e.target === authModal) {
                        hideAuthModal();
                    }
                });
            }
            
            // Refresh status periodically
            // Load voting status every 60 seconds (reduced from 30 to save resources)
            // Poll voting status every 30 seconds (reduced from 60 to keep UI in sync)
            // This prevents toggle flickering while still maintaining reasonable polling frequency
            setInterval(loadVotingStatus, 30000);
        }
        
        // Reset all votes
        const resetAllBtn = document.getElementById('resetAllVotesBtn');
        if (resetAllBtn) {
            resetAllBtn.addEventListener('click', async () => {
                if (!confirm('Are you sure you want to reset ALL votes? This action cannot be undone.')) {
                    return;
                }

                try {
                    const headers = getAdminHeaders();
                    headers['Cache-Control'] = 'no-cache';
                    headers['Pragma'] = 'no-cache';
                    
                    // Create AbortController for timeout
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
                    
                    const response = await fetch(`${API_BASE}/api/admin/reset-votes`, {
                        method: 'POST',
                        credentials: 'include',
                        headers: headers,
                        body: JSON.stringify({}), // Send empty JSON body
                        signal: controller.signal
                    });
                    
                    clearTimeout(timeoutId);
                    
                    // Check response status before parsing JSON
                    if (!response.ok) {
                        let errorMessage = 'Failed to reset votes';
                        try {
                            const errorData = await response.json();
                            errorMessage = errorData.message || errorMessage;
                        } catch (_) {
                            errorMessage = `Server error: ${response.status} ${response.statusText}`;
                        }
                        showToast(errorMessage, 'error');
                        console.error('Reset votes failed:', response.status, errorMessage);
                        return;
                    }
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        // Invalidate all vote caches
                        try {
                            localStorage.removeItem('vote_cache_timestamp');
                            localStorage.removeItem('cached_votes');
                            // Set new timestamp to force fresh fetch
                            localStorage.setItem('vote_cache_timestamp', Date.now().toString());
                        } catch (_) {}
                        
                        showToast('All votes reset successfully', 'success');
                        // Force fresh reload of analytics
                        await loadAnalytics();
                        
                        // Trigger page reload for all open tabs (via storage event)
                        try {
                            localStorage.setItem('votes_reset', Date.now().toString());
                            localStorage.removeItem('votes_reset');
                        } catch (_) {}
                    } else {
                        showToast(data.message || 'Failed to reset votes', 'error');
                    }
                } catch (error) {
                    console.error('Reset votes error:', error);
                    // Handle different types of errors
                    if (error.name === 'AbortError') {
                        showToast('Failed to reset votes: Request timed out. Please try again.', 'error');
                    } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
                        showToast('Failed to reset votes: Unable to connect to server. Please check your connection.', 'error');
                    } else if (error.message) {
                        showToast('Failed to reset votes: ' + error.message, 'error');
                    } else {
                        showToast('Failed to reset votes: Network error', 'error');
                    }
                }
            });
        }

        // Reset user votes
        const resetUserBtn = document.getElementById('resetUserVotesBtn');
        const resetUserModal = document.getElementById('resetUserModal');
        const confirmResetUserBtn = document.getElementById('confirmResetUserBtn');
        const cancelResetUserBtn = document.getElementById('cancelResetUserBtn');

        if (resetUserBtn) {
            resetUserBtn.addEventListener('click', () => {
                resetUserModal.style.display = 'flex';
            });
        }

        if (cancelResetUserBtn) {
            cancelResetUserBtn.addEventListener('click', () => {
                resetUserModal.style.display = 'none';
                document.getElementById('resetUserIdInput').value = '';
            });
        }

        if (confirmResetUserBtn) {
            confirmResetUserBtn.addEventListener('click', async () => {
                const input = document.getElementById('resetUserIdInput').value.trim().toUpperCase();
                if (!input) {
                    showToast('Please enter a user ID or access code', 'error');
                    return;
                }

                try {
                    let response;
                    // Check if input is numeric (database ID) or alphanumeric (access code)
                    if (/^\d+$/.test(input)) {
                        // Numeric - use database ID
                        response = await fetch(`${API_BASE}/api/admin/users/${input}/reset-votes`, {
                            method: 'POST',
                            credentials: 'include',
                            headers: getAdminHeaders()
                        });
                    } else {
                        // Alphanumeric - use access code
                        response = await fetch(`${API_BASE}/api/admin/reset-user-votes-by-code`, {
                            method: 'POST',
                            headers: getAdminHeaders(),
                            credentials: 'include',
                            body: JSON.stringify({ access_code: input })
                        });
                    }
                    
                    // Check response status before parsing JSON
                    if (!response.ok) {
                        let errorMessage = 'Failed to reset user votes';
                        try {
                            const errorData = await response.json();
                            errorMessage = errorData.message || errorMessage;
                        } catch (_) {
                            errorMessage = `Server error: ${response.status} ${response.statusText}`;
                        }
                        showToast(errorMessage, 'error');
                        console.error('Reset user votes failed:', response.status, errorMessage);
                        return;
                    }
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        showToast('User votes reset successfully', 'success');
                        resetUserModal.style.display = 'none';
                        document.getElementById('resetUserIdInput').value = '';
                        await loadUsers();
                        await loadAnalytics();
                    } else {
                        showToast(data.message || 'Failed to reset user votes', 'error');
                    }
                } catch (error) {
                    console.error('Reset user votes error:', error);
                    showToast('Failed to reset user votes: ' + (error.message || 'Network error'), 'error');
                }
            });
        }

        // Reset category votes
        const resetCategoryBtn = document.getElementById('resetCategoryVotesBtn');
        const resetCategoryModal = document.getElementById('resetCategoryModal');
        const confirmResetCategoryBtn = document.getElementById('confirmResetCategoryBtn');
        const cancelResetCategoryBtn = document.getElementById('cancelResetCategoryBtn');

        if (resetCategoryBtn) {
            resetCategoryBtn.addEventListener('click', () => {
                resetCategoryModal.style.display = 'flex';
            });
        }

        if (cancelResetCategoryBtn) {
            cancelResetCategoryBtn.addEventListener('click', () => {
                resetCategoryModal.style.display = 'none';
                document.getElementById('resetCategoryInput').value = '';
            });
        }

        if (confirmResetCategoryBtn) {
            confirmResetCategoryBtn.addEventListener('click', async () => {
                const categoryInput = document.getElementById('resetCategoryInput').value.trim();
                if (!categoryInput) {
                    showToast('Please enter a category name or number', 'error');
                    return;
                }

                try {
                    const response = await fetch(`${API_BASE}/api/admin/reset-category-votes`, {
                        method: 'POST',
                        headers: getAdminHeaders(),
                        credentials: 'include',
                        body: JSON.stringify({ category: categoryInput })
                    });
                    
                    // Check response status before parsing JSON
                    if (!response.ok) {
                        let errorMessage = 'Failed to reset category votes';
                        try {
                            const errorData = await response.json();
                            errorMessage = errorData.message || errorMessage;
                        } catch (_) {
                            errorMessage = `Server error: ${response.status} ${response.statusText}`;
                        }
                        showToast(errorMessage, 'error');
                        console.error('Reset category votes failed:', response.status, errorMessage);
                        return;
                    }
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        showToast(data.message || 'Category votes reset successfully', 'success');
                        resetCategoryModal.style.display = 'none';
                        document.getElementById('resetCategoryInput').value = '';
                        await loadAnalytics();
                    } else {
                        showToast(data.message || 'Failed to reset category votes', 'error');
                    }
                } catch (error) {
                    console.error('Reset category votes error:', error);
                    showToast('Failed to reset category votes: ' + (error.message || 'Network error'), 'error');
                }
            });
        }

        // Registration entry form
        // Phone formatting function (Nigeria +234, 10 digits)
        function formatPhoneNigeria(digits) {
            const trimmed = digits.slice(0, 10);
            if (trimmed.length === 0) return '';
            if (trimmed.length <= 3) return `(${trimmed}`;
            if (trimmed.length <= 6) return `(${trimmed.slice(0, 3)}) ${trimmed.slice(3)}`;
            return `(${trimmed.slice(0, 3)}) ${trimmed.slice(3, 6)}-${trimmed.slice(6)}`;
        }

        // Attach phone mask for Nigeria (+234, 10 digits)
        function attachPhoneMaskNigeria(inputId) {
            const input = document.getElementById(inputId);
            if (!input) return;
            
            const update = () => {
                const digitsOnly = input.value.replace(/\D/g, '');
                input.value = formatPhoneNigeria(digitsOnly);
            };
            
            input.addEventListener('input', update);
            input.addEventListener('keydown', (e) => {
                const allowedKeys = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End'];
                if (allowedKeys.includes(e.key) || (e.ctrlKey || e.metaKey)) return;
                const isDigit = /\d/.test(e.key);
                if (!isDigit) {
                e.preventDefault();
                    return;
                }
                const currentDigits = input.value.replace(/\D/g, '');
                if (currentDigits.length >= 10) {
                    e.preventDefault();
                }
            });
            update();
        }

        // Auto-capitalize first letter of name
        function attachNameCapitalization(inputId) {
            const input = document.getElementById(inputId);
            if (!input) return;
            
            input.addEventListener('blur', () => {
                const value = input.value.trim();
                if (value) {
                    input.value = value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
                }
            });
        }

        // Initialize phone masks and name capitalization
        attachPhoneMaskNigeria('registrationPhone');
        attachPhoneMaskNigeria('deleteRegistrationPhone');
        attachNameCapitalization('registrationFirstName');
        attachNameCapitalization('registrationLastName');
        attachNameCapitalization('deleteRegistrationFirstName');
        attachNameCapitalization('deleteRegistrationLastName');

        // Add Registration Form with Confirmation Modal
        const addRegistrationForm = document.getElementById('addRegistrationForm');
        const addRegistrationConfirmModal = document.getElementById('addRegistrationConfirmModal');
        const addRegistrationConfirmMessage = document.getElementById('addRegistrationConfirmMessage');
        const confirmAddRegistrationBtn = document.getElementById('confirmAddRegistrationBtn');
        const cancelAddRegistrationBtn = document.getElementById('cancelAddRegistrationBtn');
        
        let pendingAddData = null;

        if (addRegistrationForm) {
            addRegistrationForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const firstName = document.getElementById('registrationFirstName').value.trim();
                const lastName = document.getElementById('registrationLastName').value.trim();
                const phoneInput = document.getElementById('registrationPhone').value.replace(/\D/g, '');

                if (!firstName || !lastName || !phoneInput) {
                    showToast('Please fill all fields', 'error');
                    return;
                }

                if (phoneInput.length !== 10) {
                    showToast('Phone number must be 10 digits', 'error');
                    return;
                }

                // Store pending data and show confirmation modal
                pendingAddData = {
                    first_name: firstName,
                    last_name: lastName,
                    phone: `+234${phoneInput}`
                };

                if (addRegistrationConfirmMessage) {
                    addRegistrationConfirmMessage.textContent = `Do you want to add ${firstName} ${lastName} to the system?`;
                }
                if (addRegistrationConfirmModal) {
                    addRegistrationConfirmModal.style.display = 'flex';
                }
            });
        }

        // Confirm Add Registration
        if (confirmAddRegistrationBtn) {
            confirmAddRegistrationBtn.addEventListener('click', async () => {
                if (!pendingAddData) return;

                try {
                    const response = await fetch(`${API_BASE}/api/admin/event-registration-users`, {
                        method: 'POST',
                        headers: getAdminHeaders(),
                        credentials: 'include',
                        body: JSON.stringify(pendingAddData)
                    });
                    const data = await response.json();
                    
                    if (data.success) {
                        showToast(data.message || 'Registration record added successfully', 'success');
                        if (addRegistrationForm) {
                            addRegistrationForm.reset();
                            // Re-initialize phone mask after reset
                            attachPhoneMaskNigeria('registrationPhone');
                        }
                        // Refresh registered users list
                        await loadRegisteredUsersList();
                    } else {
                        showToast(data.message || 'Failed to add registration record', 'error');
                    }
                } catch (error) {
                    console.error('Add registration error:', error);
                    showToast('Failed to add registration record', 'error');
                } finally {
                    pendingAddData = null;
                    if (addRegistrationConfirmModal) {
                        addRegistrationConfirmModal.style.display = 'none';
                    }
                }
            });
        }

        // Cancel Add Registration
        if (cancelAddRegistrationBtn) {
            cancelAddRegistrationBtn.addEventListener('click', () => {
                pendingAddData = null;
                if (addRegistrationConfirmModal) {
                    addRegistrationConfirmModal.style.display = 'none';
                }
            });
        }

        // Close Add Registration Modal on outside click
        if (addRegistrationConfirmModal) {
            addRegistrationConfirmModal.addEventListener('click', (e) => {
                if (e.target === addRegistrationConfirmModal) {
                    pendingAddData = null;
                    addRegistrationConfirmModal.style.display = 'none';
                }
            });
        }

        // Delete Registration Form with Confirmation Modal
        const deleteRegistrationForm = document.getElementById('deleteRegistrationForm');
        const deleteRegistrationConfirmModal = document.getElementById('deleteRegistrationConfirmModal');
        const deleteRegistrationConfirmMessage = document.getElementById('deleteRegistrationConfirmMessage');
        const confirmDeleteRegistrationBtn = document.getElementById('confirmDeleteRegistrationBtn');
        const cancelDeleteRegistrationBtn = document.getElementById('cancelDeleteRegistrationBtn');
        
        let pendingDeleteData = null;

        if (deleteRegistrationForm) {
            deleteRegistrationForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const firstName = document.getElementById('deleteRegistrationFirstName').value.trim();
                const lastName = document.getElementById('deleteRegistrationLastName').value.trim();
                const phoneInput = document.getElementById('deleteRegistrationPhone').value.replace(/\D/g, '');

                if (!firstName || !lastName || !phoneInput) {
                    showToast('Please fill all fields', 'error');
                    return;
                }

                if (phoneInput.length !== 10) {
                    showToast('Phone number must be 10 digits', 'error');
                    return;
                }

                // Store pending data and show confirmation modal
                pendingDeleteData = {
                    first_name: firstName,
                    last_name: lastName,
                    phone: `+234${phoneInput}`
                };

                if (deleteRegistrationConfirmMessage) {
                    deleteRegistrationConfirmMessage.textContent = `Do you want to delete ${firstName} ${lastName} from the system?`;
                }
                if (deleteRegistrationConfirmModal) {
                    deleteRegistrationConfirmModal.style.display = 'flex';
                }
            });
        }

        // Confirm Delete Registration
        if (confirmDeleteRegistrationBtn) {
            confirmDeleteRegistrationBtn.addEventListener('click', async () => {
                if (!pendingDeleteData) return;

                try {
                    const response = await fetch(`${API_BASE}/api/admin/event-registration-users/delete`, {
                        method: 'POST',
                        headers: getAdminHeaders(),
                        credentials: 'include',
                        body: JSON.stringify(pendingDeleteData)
                    });
                    
                    if (!response.ok) {
                        let errorMessage = 'Failed to delete registration record';
                        try {
                            const errorData = await response.json();
                            errorMessage = errorData.message || errorMessage;
                        } catch (_) {
                            errorMessage = `Server error: ${response.status} ${response.statusText}`;
                        }
                        showToast(errorMessage, 'error');
                        return;
                    }
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        showToast(data.message || 'Registration record deleted successfully', 'success');
                        if (deleteRegistrationForm) {
                            deleteRegistrationForm.reset();
                            // Re-initialize phone mask after reset
                            attachPhoneMaskNigeria('deleteRegistrationPhone');
                        }
                        // Reload users if on users page
                        if (typeof loadUsers === 'function') {
                            await loadUsers();
                        }
                        // Refresh registered users list
                        await loadRegisteredUsersList();
                    } else {
                        showToast(data.message || 'Failed to delete registration record', 'error');
                    }
                } catch (error) {
                    console.error('Delete registration error:', error);
                    showToast('Failed to delete registration record', 'error');
                } finally {
                    pendingDeleteData = null;
                    if (deleteRegistrationConfirmModal) {
                        deleteRegistrationConfirmModal.style.display = 'none';
                    }
                }
            });
        }

        // Cancel Delete Registration
        if (cancelDeleteRegistrationBtn) {
            cancelDeleteRegistrationBtn.addEventListener('click', () => {
                pendingDeleteData = null;
                if (deleteRegistrationConfirmModal) {
                    deleteRegistrationConfirmModal.style.display = 'none';
                }
            });
        }

        // Close Delete Registration Modal on outside click
        if (deleteRegistrationConfirmModal) {
            deleteRegistrationConfirmModal.addEventListener('click', (e) => {
                if (e.target === deleteRegistrationConfirmModal) {
                    pendingDeleteData = null;
                    deleteRegistrationConfirmModal.style.display = 'none';
                }
            });
        }

        // Registered Users List functionality
        let registeredUsersRefreshInterval = null;

        async function loadRegisteredUsersList() {
            const tbody = document.getElementById('registeredUsersTableBody');
            const summaryEl = document.getElementById('registeredUsersSummary');
            
            if (!tbody) return;

            try {
                tbody.innerHTML = '<tr><td colspan="5" class="loading">Loading registered users...</td></tr>';
                
                const response = await fetch(`${API_BASE}/api/admin/registered-users`, {
                    method: 'GET',
                    headers: getAdminHeaders(),
                    credentials: 'include'
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json();
                
                if (!data.success) {
                    throw new Error(data.message || 'Failed to load registered users');
                }

                const users = data.users || [];
                const total = data.total || 0;
                const withAccounts = data.with_accounts || 0;
                const withoutAccounts = data.without_accounts || 0;

                // Update summary
                if (summaryEl) {
                    summaryEl.textContent = `Total: ${total} | Users: ${withAccounts} | Registered: ${withoutAccounts}`;
                }

                // Render table
                if (users.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px; color: var(--text-muted);">No registered users found</td></tr>';
                    return;
                }

                tbody.innerHTML = users.map((user, index) => {
                    const statusClass = user.has_account ? 'status-badge-user' : 'status-badge-registered';
                    const statusText = user.status || (user.has_account ? 'User' : 'Registered');
                    
                    return `
                        <tr>
                            <td class="row-number-cell">
                                <span class="row-number">${index + 1}</span>
                            </td>
                            <td>${escapeHtml(user.last_name || '')}</td>
                            <td>${escapeHtml(user.first_name || '')}</td>
                            <td>${escapeHtml(user.phone || '')}</td>
                            <td>
                                <span class="status-badge ${statusClass}">${escapeHtml(statusText)}</span>
                            </td>
                        </tr>
                    `;
                }).join('');

            } catch (error) {
                console.error('Error loading registered users:', error);
                tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 40px; color: var(--error);">Failed to load registered users. Please try again.</td></tr>`;
                if (summaryEl) {
                    summaryEl.textContent = 'Error loading data';
                }
            }
        }

        // Refresh button handler
        const refreshRegisteredUsersBtn = document.getElementById('refreshRegisteredUsersBtn');
        if (refreshRegisteredUsersBtn) {
            refreshRegisteredUsersBtn.addEventListener('click', async () => {
                await loadRegisteredUsersList();
            });
        }

        // Load registered users list when registration page is shown (no auto-refresh)
        const originalNavHandler = document.querySelectorAll('.nav-item[data-page]');
        originalNavHandler.forEach(item => {
            item.addEventListener('click', (e) => {
                const targetPage = item.getAttribute('data-page');
                if (targetPage === 'registration') {
                    // Load list when registration page is shown
                    setTimeout(loadRegisteredUsersList, 100);
                }
            });
        });

        // Also check on initial load if registration page is active
        if (document.getElementById('page-registration') && 
            document.getElementById('page-registration').style.display !== 'none') {
            loadRegisteredUsersList();
        }

        // User search (on users page)
        const userSearch = document.getElementById('userSearch');
        if (userSearch) {
            userSearch.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase().trim();
                if (query === '') {
                    renderUsers(allUsers);
                } else {
                    const filtered = allUsers.filter(user => 
                        (user.fullname && user.fullname.toLowerCase().includes(query)) ||
                        (user.email && user.email.toLowerCase().includes(query)) ||
                        (user.phone && user.phone.includes(query)) ||
                        (user.access_code && user.access_code.toLowerCase().includes(query))
                    );
                    renderUsers(filtered);
                }
            });
        }

        // Nominee management
        loadCategories();
    }

    async function loadCategories() {
        const categoriesList = document.getElementById('categoriesList');
        if (!categoriesList) return;

        categoriesList.innerHTML = categoriesData.map((category, catIndex) => {
            const nomineesHtml = category.nominees.map((nominee, nomIndex) => `
                <div class="nominee-item">
                    <span class="nominee-name">${escapeHtml(nominee)}</span>
                    <div class="nominee-actions">
                        <button class="btn-small danger remove-nominee-btn" 
                                data-category-id="${category.number}" 
                                data-nominee-index="${nomIndex}">Remove</button>
                    </div>
                </div>
            `).join('');

            return `
                <div class="category-item">
                    <div class="category-item-header">
                        <span class="category-item-title">${escapeHtml(category.title)}</span>
                    </div>
                    <div class="nominees-list">
                        ${nomineesHtml}
                        <form class="add-nominee-form" data-category-id="${category.number}">
                            <input type="text" placeholder="Add nominee name" required>
                            <button type="submit" class="btn-primary btn-small">Add</button>
                        </form>
                    </div>
                </div>
            `;
        }).join('');

        // Attach event listeners
        document.querySelectorAll('.remove-nominee-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const categoryId = parseInt(e.target.dataset.categoryId);
                const nomineeIndex = parseInt(e.target.dataset.nomineeIndex);
                await removeNominee(categoryId, nomineeIndex);
            });
        });

        document.querySelectorAll('.add-nominee-form').forEach(form => {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const categoryId = parseInt(e.target.dataset.categoryId);
                const nameInput = e.target.querySelector('input');
                const name = nameInput.value.trim();
                if (name) {
                    await addNominee(categoryId, name);
                    nameInput.value = '';
                }
            });
        });
    }

    async function addNominee(categoryId, name) {
        try {
            const response = await fetch(`${API_BASE}/api/admin/nominees`, {
                method: 'POST',
                headers: getAdminHeaders(),
                credentials: 'include',
                body: JSON.stringify({ category_id: categoryId, name })
            });
            const data = await response.json();
            
            if (data.success) {
                showToast('Nominee added successfully', 'success');
                // Reload categories data
                if (window.CATEGORIES) {
                    const category = window.CATEGORIES.find(c => c.number === categoryId);
                    if (category) {
                        category.nominees.push(name);
                    }
                }
                await loadCategories();
            } else {
                showToast(data.message || 'Failed to add nominee', 'error');
            }
        } catch (error) {
            console.error('Add nominee error:', error);
            showToast('Failed to add nominee', 'error');
        }
    }

    async function removeNominee(categoryId, nomineeIndex) {
        if (!confirm('Are you sure you want to remove this nominee? All votes for this nominee will be lost.')) {
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/api/admin/nominees`, {
                method: 'DELETE',
                headers: getAdminHeaders(),
                credentials: 'include',
                body: JSON.stringify({ category_id: categoryId, nominee_index: nomineeIndex })
            });
            const data = await response.json();
            
            if (data.success) {
                showToast('Nominee removed successfully', 'success');
                // Reload categories data
                if (window.CATEGORIES) {
                    const category = window.CATEGORIES.find(c => c.number === categoryId);
                    if (category) {
                        category.nominees.splice(nomineeIndex, 1);
                    }
                }
                await loadCategories();
            } else {
                showToast(data.message || 'Failed to remove nominee', 'error');
            }
        } catch (error) {
            console.error('Remove nominee error:', error);
            showToast('Failed to remove nominee', 'error');
        }
    }

    // User profile dropdown
    function initUserDropdown() {
        const userAvatarBtn = document.getElementById('userAvatarBtn');
        const userDropdown = document.getElementById('userDropdown');
        const headerLogoutBtn = document.getElementById('headerLogoutBtn');
        
        if (!userAvatarBtn || !userDropdown) return;
        
        // Toggle dropdown
        userAvatarBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = userDropdown.hasAttribute('hidden');
            if (isHidden) {
                userDropdown.removeAttribute('hidden');
                userAvatarBtn.setAttribute('aria-expanded', 'true');
            } else {
                userDropdown.setAttribute('hidden', 'true');
                userAvatarBtn.setAttribute('aria-expanded', 'false');
            }
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!userAvatarBtn.contains(e.target) && !userDropdown.contains(e.target)) {
                userDropdown.setAttribute('hidden', 'true');
                userAvatarBtn.setAttribute('aria-expanded', 'false');
            }
        });
        
        // Header logout button
        if (headerLogoutBtn) {
            headerLogoutBtn.addEventListener('click', async () => {
                await performLogout();
            });
        }
    }
    
    // Logout function
    async function performLogout() {
            try {
                await fetch(`${API_BASE}/api/admin/logout`, {
                    method: 'POST',
                credentials: 'include',
                headers: getAdminHeaders(),
                cache: 'no-store'
                });
            } catch (error) {
                console.error('Logout error:', error);
            }
        
        // Clear vote cache (but keep theme and other non-auth data)
        try {
            localStorage.removeItem('vote_cache_timestamp');
            localStorage.removeItem('cached_votes');
            localStorage.removeItem('votes_reset');
        } catch (_) {}
        
        // Clear sessionStorage fallback codes
        try {
            sessionStorage.removeItem('admin_access_code_fallback');
            sessionStorage.removeItem('admin_role_fallback');
        } catch (_) {}
        
        // Use replace to prevent back button from restoring state
        window.location.replace('login.html');
    }

    // Sidebar logout
    const logoutBtn = document.getElementById('sidebarLogoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await performLogout();
        });
    }

    // Global search - redirects to users page and filters
    const globalSearch = document.getElementById('globalSearch');
    if (globalSearch) {
        let searchTimeout;
        globalSearch.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            clearTimeout(searchTimeout);
            
            searchTimeout = setTimeout(() => {
                if (query === '') {
                    // Clear search - stay on current page
                    if (document.getElementById('page-users').style.display !== 'none') {
                        renderUsers(allUsers);
                    }
                } else {
                    // If on users page, filter users
                    if (document.getElementById('page-users').style.display !== 'none') {
                        const filtered = allUsers.filter(user => 
                            (user.fullname && user.fullname.toLowerCase().includes(query)) ||
                            (user.email && user.email.toLowerCase().includes(query)) ||
                            (user.phone && user.phone.includes(query)) ||
                            (user.access_code && user.access_code.toLowerCase().includes(query))
                        );
                        renderUsers(filtered);
                    } else if (currentRole === 'admin') {
                        // Auto-navigate to users page if searching
                        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
                        const usersNav = document.querySelector('.nav-item[data-page="users"]');
                        if (usersNav) {
                            usersNav.classList.add('active');
                            document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
                            document.getElementById('page-users').style.display = 'block';
                            // Focus on user search input
                            const userSearchInput = document.getElementById('userSearch');
                            if (userSearchInput) {
                                userSearchInput.value = query;
                                userSearchInput.dispatchEvent(new Event('input'));
                            }
                        }
                    }
                }
            }, 300);
        });
    }

    // Refresh users button
    const refreshUsersBtn = document.getElementById('refreshUsersBtn');
    if (refreshUsersBtn) {
        refreshUsersBtn.addEventListener('click', async () => {
            await loadUsers();
            showToast('Users refreshed', 'success');
        });
    }

    // Close user details modal
    const closeUserModalBtn = document.getElementById('closeUserModalBtn');
    if (closeUserModalBtn) {
        closeUserModalBtn.addEventListener('click', () => {
            document.getElementById('userDetailsModal').style.display = 'none';
        });
    }

    // Utility functions
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        if (!toast) return;

        toast.textContent = message;
        toast.className = `toast ${type} show`;
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    // Inactivity detection and auto-logout
    function resetInactivityTimer() {
        if (inactivityTimer) {
            clearTimeout(inactivityTimer);
        }
        inactivityTimer = setTimeout(() => {
            handleInactivityLogout();
        }, INACTIVITY_TIMEOUT);
    }

    async function handleInactivityLogout() {
        // Save state before logout
        try {
            // Save current page state
            const currentState = {
                page: window.location.pathname,
                hash: window.location.hash,
                timestamp: Date.now()
            };
            // Store in sessionStorage temporarily (will be cleared on logout)
            sessionStorage.setItem('inactivity_logout_state', JSON.stringify(currentState));
        } catch (e) {
            console.warn('Could not save state:', e);
        }

        // Perform logout
        try {
            await fetch(`${API_BASE}/api/admin/logout`, {
                method: 'POST',
                credentials: 'include',
                headers: getAdminHeaders(),
                cache: 'no-store'
            });
        } catch (e) {
            console.warn('Logout request failed:', e);
        }

        // Clear any cached data
        try {
            localStorage.removeItem('vote_cache_timestamp');
            localStorage.removeItem('cached_votes');
            localStorage.removeItem('votes_reset');
            // Clear sessionStorage fallback codes
            sessionStorage.removeItem('admin_access_code_fallback');
            sessionStorage.removeItem('admin_role_fallback');
        } catch (e) {}

        // Redirect with message
        const loginUrl = 'login.html?inactivity=1';
        window.location.replace(loginUrl);
    }

    // Initialize inactivity detection
    function initInactivityDetection() {
        const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
        events.forEach(event => {
            document.addEventListener(event, resetInactivityTimer, { passive: true });
        });
        
        // Reset timer on page navigation (back/forward buttons, tab switching)
        window.addEventListener('pageshow', (e) => {
            if (e.persisted) {
                // Page was loaded from cache (back/forward navigation)
                resetInactivityTimer();
            }
        });
        
        // Reset timer on focus (when user switches back to tab/window)
        window.addEventListener('focus', resetInactivityTimer);
        
        resetInactivityTimer(); // Start timer
    }

    // Initialize on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

