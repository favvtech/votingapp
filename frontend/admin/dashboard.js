(function() {
    'use strict';

    // API_BASE: in production set window.API_BASE in HTML to your backend URL
    const API_BASE = (typeof window !== 'undefined' && window.API_BASE) || window.location.origin;

    let currentRole = sessionStorage.getItem('admin_role') || 'admin';
    let allUsers = [];
    let categoriesData = window.CATEGORIES || [];

    // Check admin/analyst session on load
    async function checkAdminSession() {
        try {
            const headers = {};
            try {
                const code = sessionStorage.getItem('admin_code');
                if (code) headers['X-Admin-Code'] = code;
            } catch(_) {}
            const response = await fetch(`${API_BASE}/api/admin/check-session`, {
                method: 'GET',
                credentials: 'include',
                headers
            });
            const data = await response.json();
            
            if (!data.logged_in) {
                window.location.href = 'login.html';
                return;
            }

            currentRole = data.role || currentRole;
            sessionStorage.setItem('admin_role', currentRole);
            updateUIForRole();
        } catch (error) {
            console.error('Session check error:', error);
            window.location.href = 'login.html';
        }
    }

    function updateUIForRole() {
        const roleBadge = document.getElementById('roleBadge');
        const userName = document.getElementById('userName');
        const navUsers = document.getElementById('navUsers');
        const navVotes = document.getElementById('navVotes');
        const navBirthdates = document.getElementById('navBirthdates');
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
            if (navBirthdates) navBirthdates.style.display = 'none';
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
        await loadAnalytics();
        
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
                    credentials: 'include'
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

            // Get total users (admin only)
            if (currentRole === 'admin') {
                try {
                    const usersTimestamp = Date.now();
                    const usersResponse = await fetch(`${API_BASE}/api/admin/users?t=${usersTimestamp}`, {
                        credentials: 'include'
                    });
                    if (usersResponse.ok) {
                        const usersData = await usersResponse.json();
                        if (usersData.success && usersData.users) {
                            const totalUsers = usersData.users.length;
                            const totalUsersEl = document.getElementById('totalUsers');
                            if (totalUsersEl) {
                                totalUsersEl.textContent = totalUsers;
                            }
                            allUsers = usersData.users;
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
            } else {
                // For analyst, show placeholder
                const totalUsersEl = document.getElementById('totalUsers');
                if (totalUsersEl) totalUsersEl.textContent = '-';
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
                credentials: 'include'
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
                credentials: 'include'
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
        // Reset all votes
        const resetAllBtn = document.getElementById('resetAllVotesBtn');
        if (resetAllBtn) {
            resetAllBtn.addEventListener('click', async () => {
                if (!confirm('Are you sure you want to reset ALL votes? This action cannot be undone.')) {
                    return;
                }

                try {
                    const response = await fetch(`${API_BASE}/api/admin/reset-votes`, {
                        method: 'POST',
                        credentials: 'include',
                        headers: {
                            'Cache-Control': 'no-cache',
                            'Pragma': 'no-cache'
                        }
                    });
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
                    showToast('Failed to reset votes', 'error');
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
                            credentials: 'include'
                        });
                    } else {
                        // Alphanumeric - use access code
                        response = await fetch(`${API_BASE}/api/admin/reset-user-votes-by-code`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            credentials: 'include',
                            body: JSON.stringify({ access_code: input })
                        });
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
                    showToast('Failed to reset user votes', 'error');
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
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        credentials: 'include',
                        body: JSON.stringify({ category: categoryInput })
                    });
                    
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
                    showToast('Failed to reset category votes', 'error');
                }
            });
        }

        // Birth date form
        const addBirthdateForm = document.getElementById('addBirthdateForm');
        if (addBirthdateForm) {
            addBirthdateForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const day = parseInt(document.getElementById('birthDay').value);
                const month = parseInt(document.getElementById('birthMonth').value);
                const year = parseInt(document.getElementById('birthYear').value);

                if (!day || !month || !year) {
                    showToast('Please fill all fields', 'error');
                    return;
                }

                try {
                    const response = await fetch(`${API_BASE}/api/admin/birthdates`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        credentials: 'include',
                        body: JSON.stringify({ day, month, year })
                    });
                    const data = await response.json();
                    
                    if (data.success) {
                        showToast('Birth date added successfully', 'success');
                        addBirthdateForm.reset();
                    } else {
                        showToast(data.message || 'Failed to add birth date', 'error');
                    }
                } catch (error) {
                    console.error('Add birth date error:', error);
                    showToast('Failed to add birth date', 'error');
                }
            });
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
                headers: {
                    'Content-Type': 'application/json'
                },
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
                headers: {
                    'Content-Type': 'application/json'
                },
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

    // Logout
    const logoutBtn = document.getElementById('sidebarLogoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await fetch(`${API_BASE}/api/admin/logout`, {
                    method: 'POST',
                    credentials: 'include'
                });
            } catch (error) {
                console.error('Logout error:', error);
            }
            
            // Clear admin-related storage
            try {
                sessionStorage.removeItem('admin_role');
                sessionStorage.removeItem('admin_code');
                localStorage.removeItem('vote_cache_timestamp');
                localStorage.removeItem('cached_votes');
                localStorage.removeItem('votes_reset');
            } catch (_) {}
            
            // Use replace to prevent back button from restoring state
            window.location.replace('login.html');
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

    // Initialize on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

