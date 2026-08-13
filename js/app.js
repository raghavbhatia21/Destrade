/**
 * Destrade Pro — Core Application (v4)
 * TradeFinder-grade analytics dashboard
 */

let watchlist = JSON.parse(localStorage.getItem('destrade_watchlist') || '["NIFTY 50","RELIANCE","TCS","HDFCBANK","INFY"]');

const App = {
    state: {
        indices: [],
        movers: { gainers: [], losers: [] },
        marketStatus: {},
        activeMoverTab: 'gainers',
        activeSymbol: null,
        activeTimeframe: '1m',
        chart: null,
        chartSeries: {},
        lastCandle: null,
        activeView: 'dashboard',
        screenerTab: 'longBuildup',
        discoveryMode: 'screener', // 'screener' or 'analysis'
        screenerSort: { key: 'pChange', dir: 'desc' },
        analysisSort: { key: 'oiChange', dir: 'desc' },
        analysisSearch: '',
        analysisBuildup: 'ALL',
        watchlistPrices: {},
        pcrHistory: (function() {
            try {
                const d = JSON.parse(localStorage.getItem('destrade_pcr_history'));
                return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
            } catch (e) { return {}; }
        })(),
        scannerCache: { sell: [], buy: [], status: 'idle', completed: false },
        scannerExpiryMode: 'current',
        marginModel: localStorage.getItem('destrade_margin_model') || 'zerodha_live',
        scannerCapitalMin: parseFloat(localStorage.getItem('destrade_scanner_capital_min')) || null,
        scannerCapitalMax: parseFloat(localStorage.getItem('destrade_scanner_capital_max')) || null,
        scannerOtmMin: parseFloat(localStorage.getItem('destrade_scanner_otm_min')) || 4,
        scannerOtmMax: parseFloat(localStorage.getItem('destrade_scanner_otm_max')) || 10,
        sectorMapping: {
            'BANK': ['HDFCBANK', 'ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK', 'INDUSINDBK', 'BAJFINANCE'],
            'IT': ['TCS', 'INFY', 'HCLTECH', 'WIPRO', 'LTIM', 'TECHM'],
            'AUTO': ['MARUTI', 'TATAMOTORS', 'M&M', 'BAJAJ-AUTO', 'EICHERMOT', 'HEROMOTOCO'],
            'PHARMA': ['SUNPHARMA', 'CIPLA', 'DRREDDY', 'DIVISLAB', 'APOLLOHOSP', 'AUROPHARMA', 'LUPIN', 'GLENMARK'],
            'METAL': ['TATASTEEL', 'HINDALCO', 'JSWSTEEL', 'COALINDIA', 'NMDC', 'SAIL', 'NATIONALUM', 'VEDL'],
            'FMCG': ['HINDUNILVR', 'ITC', 'NESTLEIND', 'BRITANNIA', 'MARICO', 'VBL', 'COLPAL', 'GODREJCP'],
            'REALTY': ['DLF', 'GODREJPROP', 'OBEROIRLTY', 'PHENIXLTD', 'PRESTIGE'],
            'ENERGY': ['RELIANCE', 'ONGC', 'NTPC', 'POWERGRID', 'BPCL', 'IOC', 'GAIL', 'TATAPOWER', 'ADANIGREEN'],
            'MEDIA': ['ZEEL', 'PVRINOX', 'SUNTV', 'PVR'],
            'FINANCE': ['HDFCBANK', 'ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK', 'BAJFINANCE', 'PFC', 'RECLTD', 'CHOLAFIN', 'MUTHOOTFIN'],
        },
        activeSector: null,
    },

    init() {
        console.log('🚀 Destrade Pro Initializing...');
        try { this.setupFirebaseSync(); } catch (e) { console.warn(e); }
        try { this.initFirebaseTimeEngine('NIFTY'); } catch (e) { console.warn(e); }
        try { this.setupViews(); } catch (e) { console.warn(e); }
        try { this.setupListeners(); } catch (e) { console.warn(e); }
        try { this.startClock(); } catch (e) { console.warn(e); }
        try { this.render(); } catch (e) { console.warn(e); }
        try { this.startDataPolling(); } catch (e) { console.warn(e); }
        try { this.startIntradayHearts(); } catch (e) { console.warn(e); }
        try { this.setupVisibilityAPI(); } catch (e) { console.warn(e); }
        try { this.setupPcrSearchClickOutside(); } catch (e) { console.warn(e); }
        try { this.setupPcrCanvasResizeListener(); } catch (e) { console.warn(e); }
        try { this.updatePhoneAlertsButtonUI(); } catch (e) { console.warn(e); }
    },

    setupPcrCanvasResizeListener() {
        window.addEventListener('resize', () => {
            if (this.state.activeView === 'pcr-analytics' && this.state.pcrAnalyticsSymbol) {
                if (this._pcrResizeTimer) clearTimeout(this._pcrResizeTimer);
                this._pcrResizeTimer = setTimeout(() => {
                    this.renderPcrAnalyticsChartCanvas(this.state.pcrAnalyticsSymbol);
                }, 150);
            }
        });
    },

    setupPcrSearchClickOutside() {
        document.addEventListener('click', (e) => {
            const wrapper = document.getElementById('pcr-search-wrapper');
            const popup = document.getElementById('pcr-symbol-suggestions');
            if (wrapper && popup && !wrapper.contains(e.target)) {
                popup.style.display = 'none';
            }
        });
    },

    setupVisibilityAPI() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('💤 Tab hidden, pausing polling...');
                this._stopPolling = true;
            } else {
                console.log('✨ Tab visible, resuming polling...');
                this._stopPolling = false;
                this.fetchData(); // Immediate fetch on resume
            }
        });
    },

    setupFirebaseSync() {
        try {
            if (window.db && typeof db.ref === 'function') {
                console.log('🔥 Setting up Firebase Sync...');
                db.ref('watchlist').on('value', snap => {
                    if (snap.exists()) {
                        watchlist = snap.val();
                        this.renderWatchlist();
                    }
                }, () => {});
                db.ref('sectors').on('value', snap => {
                    if (snap.exists()) {
                        this.state.sectorMapping = snap.val();
                        if (this.state.activeView === 'sectors' || this.state.activeView === 'dashboard') this.render();
                    }
                }, () => {});
            }
            // Auto-prefill full PCR history for Screener on startup
            this.prefillAllPcrHistoryForScreener();
        } catch (e) {
            console.warn('Firebase Sync Warning:', e.message);
        }
    },

    async prefillAllPcrHistoryForScreener() {
        try {
            const dateStr = this.getTargetTradingDateStr();
            const url = `https://destrade-default-rtdb.firebaseio.com/pcr_history.json`;
            const res = await fetch(url);
            if (!res.ok) return;
            const data = await res.json();
            if (data && typeof data === 'object') {
                if (typeof this.state.pcrHistory !== 'object' || Array.isArray(this.state.pcrHistory)) {
                    this.state.pcrHistory = {};
                }
                Object.keys(data).forEach(sym => {
                    const dateObj = data[sym];
                    if (dateObj && typeof dateObj === 'object') {
                        const ticks = dateObj[dateStr] || dateObj[Object.keys(dateObj).pop()];
                        if (Array.isArray(ticks)) {
                            this.state.pcrHistory[sym] = ticks;
                        }
                    }
                });
                console.log(`🔥 Bulk prefilled ${Object.keys(this.state.pcrHistory).length} symbols for PCR Screener!`);
                this.renderPcrIntradayScreener();
            }
        } catch (e) {
            console.warn('Screener Bulk Prefill Warning:', e);
        }
    },

    setupViews() {
        const views = ['dashboard', 'symbol-overview', 'option-chain', 'oi-clock', 'discovery', 'sectors'];
        views.forEach(v => {
            const el = document.getElementById(`view-${v}`);
            if (!el) {
                const div = document.createElement('div');
                div.id = `view-${v}`;
                div.className = 'view-container';
                document.querySelector('.main-content').appendChild(div);
            }
        });
    },

    switchView(viewId) {
        document.querySelectorAll('.view-container').forEach(v => v.classList.remove('active'));
        const target = document.getElementById(`view-${viewId}`);
        if (target) {
            target.classList.add('active');
            target.style.animation = 'none';
            target.offsetHeight;
            target.style.animation = '';
        }

        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const navItem = document.querySelector(`.nav-item[data-view="${viewId}"]`);
        if (navItem) navItem.classList.add('active');

        this.state.activeView = viewId;

        // Stop option chain auto-refresh when leaving that view
        if (viewId !== 'option-chain') this._stopOCAutoRefresh();

        if (viewId === 'oi-clock') this.renderOIClock();
        if (viewId === 'discovery') this.renderDiscovery();
        if (viewId === 'sectors') this.renderSectors();
        if (viewId === 'pcr-analytics') this.renderPcrAnalyticsView();
        if (viewId === 'symbol-overview' && !this.state.activeSymbol) this.showSymbolOverview('NIFTY 50');
    },

    setupListeners() {
        document.querySelectorAll('.nav-item[data-view]').forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                this.switchView(link.dataset.view);
                document.querySelector('.sidebar').classList.remove('mobile-active');
            });
        });

        const mobileToggle = document.getElementById('mobile-sidebar-toggle');
        if (mobileToggle) {
            mobileToggle.addEventListener('click', () => {
                document.querySelector('.sidebar').classList.toggle('mobile-active');
            });
        }

        document.querySelectorAll('.movers-tabs button').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.movers-tabs button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.activeMoverTab = btn.innerText.toLowerCase();
                this.renderMovers();
            });
        });

        document.addEventListener('click', e => {
            const el = e.target.closest('[data-symbol]');
            if (el) { e.preventDefault(); this.showSymbolOverview(el.dataset.symbol); }
        });

        const input = document.getElementById('symbol-search');
        const results = document.getElementById('search-results');
        if (input && results) {
            let debounce;
            input.addEventListener('input', () => {
                clearTimeout(debounce);
                debounce = setTimeout(() => {
                    const q = input.value.trim();
                    if (q.length < 1) { results.style.display = 'none'; return; }
                    const matches = window.nseApi.searchSymbols(q);
                    if (matches.length) {
                        results.innerHTML = matches.map(s => `
                            <div class="search-item" data-symbol="${s}">
                                <span>${s}</span>
                                <span class="search-meta">F&O</span>
                            </div>
                        `).join('');
                        results.style.display = 'block';
                    } else {
                        results.style.display = 'none';
                    }
                }, 150);
            });
            document.addEventListener('click', e => { if (!input.contains(e.target) && !results.contains(e.target)) results.style.display = 'none'; });
        }

        document.addEventListener('keydown', e => {
            if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
                e.preventDefault();
                document.getElementById('symbol-search')?.focus();
            }
            if (e.key === 'Escape') {
                if (document.activeElement.tagName === 'INPUT') {
                    document.activeElement.blur();
                    return;
                }
                document.getElementById('search-results').style.display = 'none';
                if (this.state.activeView !== 'dashboard') this.switchView('dashboard');
                if (document.querySelector('.modal-overlay.active')) {
                    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
                }
            }
        });

        window.addEventListener('resize', () => {
            if (this._resizeTimeout) clearTimeout(this._resizeTimeout);
            this._resizeTimeout = setTimeout(() => {
                if (this.state.activeView === 'oi-clock' || this.state.activeView === 'option-chain' || this.state.activeView === 'symbol-overview') {
                    const sym = this.state.activeSymbol || 'NIFTY';
                    const cont = document.getElementById('pcr-chart-container');
                    if (cont && cont.style.display !== 'none') {
                        this.renderPcrChartCanvas(sym);
                    }
                }
            }, 150);
        });
    },

    startClock() {
        const update = () => {
            const now = this.getISTDate();
            const t = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
            const el = document.getElementById('clock-time');
            if (el) el.textContent = t;

            const lastUpEl = document.getElementById('last-update');
            if (lastUpEl) lastUpEl.textContent = t;

            const h = now.getHours();
            const m = now.getMinutes();
            const mins = h * 60 + m;
            const sessionEl = document.getElementById('clock-session');
            if (sessionEl) {
                if (mins >= 555 && mins < 570) { sessionEl.textContent = 'PRE-OPEN'; sessionEl.style.background = 'var(--amber-soft)'; sessionEl.style.color = 'var(--amber)'; }
                else if (mins >= 570 && mins < 930) { sessionEl.textContent = 'LIVE'; sessionEl.style.background = 'var(--up-soft)'; sessionEl.style.color = 'var(--up)'; }
                else if (mins >= 930 && mins < 960) { sessionEl.textContent = 'POST-MKT'; sessionEl.style.background = 'var(--amber-soft)'; sessionEl.style.color = 'var(--amber)'; }
                else { sessionEl.textContent = 'CLOSED'; sessionEl.style.background = 'var(--down-soft)'; sessionEl.style.color = 'var(--down)'; }
            }
        };
        update();
        setInterval(update, 1000);
    },

    isLiveMarketHours() {
        const now = this.getISTDate();
        const day = now.getDay();
        if (day === 0 || day === 6) return false; // Weekend
        const mins = now.getHours() * 60 + now.getMinutes();
        return mins >= 555 && mins < 930; // 09:15 AM to 03:30 PM IST
    },

    startLivePcrCloudRelay() {
        if (this._pcrRelayStarted) return;
        this._pcrRelayStarted = true;

        const runRelay = async () => {
            if (this.isLiveMarketHours()) {
                const mainSymbols = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
                if (this.state.activeSymbol) {
                    const cleanActive = this.state.activeSymbol.replace('NIFTY 50', 'NIFTY').replace('NIFTY BANK', 'BANKNIFTY').toUpperCase();
                    if (!mainSymbols.includes(cleanActive)) mainSymbols.push(cleanActive);
                }

                for (const sym of mainSymbols) {
                    try {
                        const topData = await window.nseApi.getTopPCR(sym);
                        if (topData && topData.pcr) {
                            this.recordPcr(sym, parseFloat(topData.pcr), parseFloat(topData.spot) || 0);
                        }
                    } catch(e) {}
                }
            }
        };

        runRelay();
        setInterval(runRelay, 300000); // 5-minute background sync for Firebase PCR history
    },

    async startDataPolling() {
        if (this._isPolling) return;
        this._isPolling = true;
        this.startLivePcrCloudRelay();

        const poll = async () => {
            if (!this._stopPolling) {
                await this.fetchData();
            }
            // Live market hours: 2s poll. Outside market hours: 60s background check
            const delay = this.isLiveMarketHours() ? 2000 : 60000;
            setTimeout(poll, delay);
        };
        poll();
    },

    async fetchData() {
        try {
            const alive = await window.nseApi.checkProxy();
            this.updateProxyBadge(alive);

            // Outside market hours: if closing snapshot loaded, freeze data to prevent post-market settlement fluctuations
            const isLive = this.isLiveMarketHours();
            if (!isLive && this._hasLoadedPostMarketData) {
                return;
            }

            // Batch 1: Essential Dashboard Info
            const [indices, screenerData, status] = await Promise.all([
                window.nseApi.getAllIndices().catch(() => []),
                window.nseApi.getScreenerData().catch(() => ({ all: [] })),
                window.nseApi.getMarketStatus().catch(() => ({ marketStatus: 'Closed' }))
            ]);

            this.state.indices = indices || [];
            if (screenerData && screenerData.all && screenerData.all.length > 0) {
                this.state.movers = {
                    gainers: [...(screenerData.all || [])].sort((a, b) => b.pChange - a.pChange).slice(0, 10),
                    losers: [...(screenerData.all || [])].sort((a, b) => a.pChange - b.pChange).slice(0, 10)
                };
                if (!isLive) {
                    this._hasLoadedPostMarketData = true; // Lock static closing values
                }
            }
            this.state.marketStatus = status;

            this.render();

            // Batch 2: View-Specific Deep Dives (Conditional)
            if (this.state.activeSymbol && this.state.activeView === 'symbol-overview') {
                this.updateLivePrice();
            }

            // Batch 3: Background tasks (Lower priority)
            if (this.state.activeView === 'dashboard') {
                this.updateWatchlistPrices();
            }

            const lastUpEl = document.getElementById('last-update');
            if (lastUpEl) lastUpEl.textContent = this.getISTDate().toLocaleTimeString('en-IN', { hour12: false });
        } catch (e) { console.error('Poll Error:', e); }
    },

    render() {
        this.renderStatus();
        this.renderTicker();
        this.renderMovers();
        this.renderMarketPulse();
        this.renderSectorQuickLook();
        this.renderWatchlist();
        this.renderPcrIntradayScreener();
    },

    renderStatus() {
        const dot = document.querySelector('.status-dot');
        const text = document.querySelector('.status-text');
        if (dot && text) {
            const s = this.state.marketStatus.marketStatus || 'Closed';
            text.textContent = `MARKET ${s.toUpperCase()}`;
            dot.style.background = (s.includes('Open') || s.includes('Live')) ? 'var(--up)' : 'var(--amber)';
        }
    },

    updateProxyBadge(alive) {
        const b = document.getElementById('proxy-badge');
        if (b) {
            b.textContent = `BRIDGE: ${alive ? 'LIVE' : 'DOWN'}`;
            b.style.background = alive ? 'var(--up-soft)' : 'var(--down-soft)';
            b.style.color = alive ? 'var(--up)' : 'var(--down)';
        }
    },

    renderTicker() {
        const container = document.getElementById('indices-ticker');
        if (!container || !this.state.indices.length) return;

        const priority = ['NIFTY 50', 'NIFTY BANK', 'NIFTY FINANCIAL SERVICES', 'NIFTY NEXT 50', 'NIFTY MIDCAP 100'];
        const sorted = [...this.state.indices].sort((a, b) => {
            const ia = priority.indexOf(a.index);
            const ib = priority.indexOf(b.index);
            if (ia !== -1 && ib !== -1) return ia - ib;
            return ia !== -1 ? -1 : (ib !== -1 ? 1 : 0);
        });

        const tickerData = sorted.slice(0, 15);
        if (container.children.length === 0) {
            const getHtml = (data) => data.map(i => `
                <div class="ticker-item" data-index-node="${i.index}">
                    <span class="ticker-label">${i.index}</span>
                    <span class="ticker-value mono">₹${i.last.toLocaleString()}</span>
                    <span class="ticker-change ${i.pChange >= 0 ? 'up' : 'down'}">${i.pChange >= 0 ? '▲' : '▼'} ${Math.abs(i.pChange).toFixed(2)}%</span>
                </div>
            `).join('');
            container.innerHTML = getHtml(tickerData) + getHtml(tickerData);
            return;
        }

        tickerData.forEach(data => {
            const nodes = container.querySelectorAll(`[data-index-node="${data.index}"]`);
            nodes.forEach(node => {
                const valEl = node.querySelector('.ticker-value');
                const chgEl = node.querySelector('.ticker-change');
                if (valEl) valEl.textContent = `₹${data.last.toLocaleString()}`;
                if (chgEl) {
                    chgEl.textContent = `${data.pChange >= 0 ? '▲' : '▼'} ${Math.abs(data.pChange).toFixed(2)}%`;
                    chgEl.className = `ticker-change ${data.pChange >= 0 ? 'up' : 'down'}`;
                }
            });
        });
    },

    async renderMarketPulse() {
        const c = document.getElementById('market-overview');
        if (!c) return;
        try {
            const p = await window.nseApi.getMarketPulse().catch(() => null);
            const pData = p || { trend: 'NEUTRAL', advances: 0, declines: 0, unchanged: 0, ratio: '1.00', newHighs: 0, newLows: 0, volShockers: 0, longBuildups: 0, shortBuildups: 0 };
            const trendClass = pData.trend === 'BULLISH' ? 'tag-bullish' : pData.trend === 'BEARISH' ? 'tag-bearish' : 'tag-neutral';
            c.innerHTML = `
                <div class="pulse-grid">
                    <div class="pulse-stat"><div class="stat-label">Sentiment</div><div class="stat-value"><span class="tag ${trendClass}">${pData.trend}</span></div></div>
                    <div class="pulse-stat"><div class="stat-label">Advances</div><div class="stat-value up">${pData.advances}</div></div>
                    <div class="pulse-stat"><div class="stat-label">Declines</div><div class="stat-value down">${pData.declines}</div></div>
                    <div class="pulse-stat"><div class="stat-label">L. Buildup</div><div class="stat-value up">${pData.longBuildups || 0}</div></div>
                    <div class="pulse-stat"><div class="stat-label">S. Buildup</div><div class="stat-value down">${pData.shortBuildups || 0}</div></div>
                    <div class="pulse-stat"><div class="stat-label">A/D Ratio</div><div class="stat-value">${pData.ratio}</div></div>
                    <div class="pulse-stat"><div class="stat-label">Vol Shockers</div><div class="stat-value" style="color:var(--primary)">${pData.volShockers || 0}</div></div>
                    <div class="pulse-stat"><div class="stat-label">52W High</div><div class="stat-value up">${pData.newHighs}</div></div>
                    <div class="pulse-stat"><div class="stat-label">52W Low</div><div class="stat-value down">${pData.newLows}</div></div>
                    <div class="pulse-stat"><div class="stat-label">Unchanged</div><div class="stat-value">${pData.unchanged}</div></div>
                </div>
            `;
        } catch (e) {
            c.innerHTML = `
                <div class="pulse-grid">
                    <div class="pulse-stat"><div class="stat-label">Sentiment</div><div class="stat-value"><span class="tag tag-neutral">NEUTRAL</span></div></div>
                    <div class="pulse-stat"><div class="stat-label">Advances</div><div class="stat-value up">0</div></div>
                    <div class="pulse-stat"><div class="stat-label">Declines</div><div class="stat-value down">0</div></div>
                    <div class="pulse-stat"><div class="stat-label">L. Buildup</div><div class="stat-value up">0</div></div>
                    <div class="pulse-stat"><div class="stat-label">S. Buildup</div><div class="stat-value down">0</div></div>
                    <div class="pulse-stat"><div class="stat-label">A/D Ratio</div><div class="stat-value">1.00</div></div>
                    <div class="pulse-stat"><div class="stat-label">Vol Shockers</div><div class="stat-value" style="color:var(--primary)">0</div></div>
                    <div class="pulse-stat"><div class="stat-label">52W High</div><div class="stat-value up">0</div></div>
                    <div class="pulse-stat"><div class="stat-label">52W Low</div><div class="stat-value down">0</div></div>
                    <div class="pulse-stat"><div class="stat-label">Unchanged</div><div class="stat-value">0</div></div>
                </div>
            `;
        }
    },

    async renderSectorQuickLook() {
        const c = document.getElementById('sector-quick-look');
        if (!c) return;
        const sectors = await window.nseApi.getSectors().catch(() => []);
        if (!sectors || !sectors.length) {
            c.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:1rem;width:100%">Sector data unavailable</p>';
            return;
        }
        c.innerHTML = sectors.slice(0, 8).map(s => `
            <div class="sector-card ${s.change >= 0 ? 'positive' : 'negative'}" onclick="App.showSectorStocks('${s.name}')">
                <div class="sector-name">${s.label}</div>
                <div class="sector-change ${s.change >= 0 ? 'up' : 'down'}">${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%</div>
                <div class="sector-price">₹${s.price.toLocaleString()}</div>
            </div>
        `).join('');
    },

    renderMovers() {
        const c = document.getElementById('top-movers-list');
        if (!c) return;
        const data = this.state.movers[this.state.activeMoverTab] || [];
        if (!data || !data.length) {
            c.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:1rem">No market movers data</p>';
            return;
        }
        c.innerHTML = data.map(m => `
            <div class="mover-row" data-symbol="${m.symbol}">
                <span class="mover-symbol">${m.symbol}</span>
                <div style="text-align:right">
                    <div class="mover-price">₹${(m.price || 0).toLocaleString()}</div>
                    <div class="mover-change ${m.pChange >= 0 ? 'up' : 'down'}">${m.pChange >= 0 ? '+' : ''}${(m.pChange || 0).toFixed(2)}%</div>
                </div>
            </div>
        `).join('');
    },

    renderWatchlist() {
        const c = document.getElementById('watchlist');
        if (!c) return;
        if (!watchlist.length) { c.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:1.5rem">Search and add symbols to your watchlist</p>'; return; }
        c.innerHTML = watchlist.map(s => {
            const p = this.state.watchlistPrices[s] || {};
            return `
                <div class="watchlist-item" data-symbol="${s}">
                    <div class="wl-info">
                        <span class="wl-symbol">${s}</span>
                        <span class="wl-price">${p.lastPrice ? '₹' + p.lastPrice.toLocaleString() : '---'}</span>
                    </div>
                     <div style="display:flex;align-items:center">
                        <span class="wl-change ${(p.pChange || 0) >= 0 ? 'up' : 'down'}">${p.pChange ? (p.pChange >= 0 ? '+' : '') + p.pChange.toFixed(2) + '%' : '--'}</span>
                        <span class="wl-remove" onclick="event.stopPropagation(); App.removeFromWatchlist('${s}')"><i class="fas fa-times"></i></span>
                    </div>
                </div>
            `;
        }).join('');
    },

    async updateWatchlistPrices() {
        for (const s of watchlist.slice(0, 8)) {
            const q = await window.nseApi.getQuote(s);
            if (q) this.state.watchlistPrices[s] = q;
        }
        if (this.state.activeView === 'dashboard') this.renderWatchlist();
    },

    addToWatchlist(symbol) {
        if (!watchlist.includes(symbol)) {
            watchlist.push(symbol);
            if (window.db) db.ref('watchlist').set(watchlist);
            else localStorage.setItem('destrade_watchlist', JSON.stringify(watchlist));
            this.renderWatchlist();
        }
    },

    removeFromWatchlist(symbol) {
        watchlist = watchlist.filter(s => s !== symbol);
        if (window.db) db.ref('watchlist').set(watchlist);
        else localStorage.setItem('destrade_watchlist', JSON.stringify(watchlist));
        this.renderWatchlist();
    },

    // ===== SYMBOL OVERVIEW / DEEP DIVE =====
    async showSymbolOverview(symbol) {
        this.state.activeSymbol = symbol;
        this.switchView('symbol-overview');
        const container = document.getElementById('view-symbol-overview');

        container.innerHTML = `
            <div class="view-header">
                <div class="view-title">
                    <i class="fas fa-chart-line"></i> <span id="overview-symbol">${symbol}</span>
                    <span id="overview-price" class="mono" style="margin-left:1rem; font-size:1.1rem">--</span>
                </div>
                <div class="header-actions" style="display:flex; gap:0.5rem; align-items:center;">
                    <button class="chart-action-btn" onclick="App.showOptionChain('${symbol}')" style="background:var(--up-soft); color:var(--up);"><i class="fas fa-stream"></i> Option Chain</button>
                    <button class="chart-action-btn" onclick="App.toggleSectorAssignment('${symbol}')" style="background:var(--primary-soft); color:var(--primary);"><i class="fas fa-folder-plus"></i> Set Sector</button>
                    <button class="back-btn" onclick="App.switchView('dashboard')"><i class="fas fa-arrow-left"></i> Back</button>
                </div>
            </div>

            <div class="overview-grid">
                <div class="overview-sidebar" style="display:flex; flex-direction:column; gap:1rem">
                    <div class="card glass metrics-card">
                        <div class="card-title">Analysis Snapshot</div>
                        <div id="overview-metrics-content" class="metrics-list">
                            <div class="skeleton-loader" style="height:200px"></div>
                        </div>
                    </div>
                </div>

                <div class="overview-main">
                    <div class="card glass" id="symbol-oi-analysis-container" style="padding: 2.5rem; min-height: 550px; display: flex; flex-direction: column; align-items: center; text-align:center">
                        <div class="skeleton-loader" style="width:100%; height:400px"></div>
                    </div>
                </div>
            </div>
        `;

        this.updateLivePrice();
        this._renderOIGauge('symbol-oi-analysis-container', symbol);
    },

    toggleSectorAssignment(symbol) {
        const modal = document.getElementById('sector-assignment-modal');
        const list = document.getElementById('sector-assignment-list');
        const symEl = document.getElementById('asm-symbol');
        if (!modal || !list || !symEl) return;

        symEl.textContent = symbol;
        const currentSectors = Object.entries(this.state.sectorMapping)
            .filter(([id, stocks]) => stocks.includes(symbol))
            .map(([id]) => id);

        list.innerHTML = Object.keys(this.state.sectorMapping).map(id => `
            <div class="metrics-row" style="cursor:pointer; padding:0.75rem" onclick="App.updateSectorAssignment('${symbol}', '${id}')">
                <span>${id}</span>
                <i class="fas ${currentSectors.includes(id) ? 'fa-check-square' : 'fa-square'}" style="color:${currentSectors.includes(id) ? 'var(--primary)' : 'var(--text-muted)'}"></i>
            </div>
        `).join('');

        modal.classList.add('active');
    },

    async updateSectorAssignment(symbol, sectorId) {
        const mapping = { ...this.state.sectorMapping };
        if (!mapping[sectorId]) mapping[sectorId] = [];

        if (mapping[sectorId].includes(symbol)) {
            mapping[sectorId] = mapping[sectorId].filter(s => s !== symbol);
        } else {
            mapping[sectorId].push(symbol);
        }

        if (window.db) {
            await db.ref('sectors').set(mapping);
        } else {
            this.state.sectorMapping = mapping;
        }

        this.toggleSectorAssignment(symbol);
    },

    async updateLivePrice() {
        if (!this.state.activeSymbol) return;
        const symbol = this.state.activeSymbol;
        let q = await window.nseApi.getQuote(symbol);
        const oi = await window.nseApi.getOIClock(symbol);

        if (!q && oi?.underlying) {
            q = {
                lastPrice: oi.underlying,
                pChange: 0,
                change: 0,
                open: oi.underlying,
                high: oi.underlying,
                low: oi.underlying,
                previousClose: oi.underlying,
                volume: 0
            };
        }
        if (!q) return;

        const el = document.getElementById('overview-price');
        if (el) {
            el.textContent = `₹${q.lastPrice.toLocaleString()}`;
            el.className = `mono ${(q.pChange || 0) >= 0 ? 'up' : 'down'}`;
        }

        // Update Snapshot Metrics
        const metrics = document.getElementById('overview-metrics-content');
        if (metrics) {
            metrics.innerHTML = `
                <div class="metrics-row"><span>LTP</span><b class="${(q.pChange || 0) >= 0 ? 'up' : 'down'}">₹${q.lastPrice.toLocaleString()}</b></div>
                <div class="metrics-row"><span>Change %</span><b class="${(q.pChange || 0) >= 0 ? 'up' : 'down'}">${(q.pChange || 0).toFixed(2)}%</b></div>
                <div class="metrics-row"><span>Volume</span><b>${this.formatNumber(q.volume || 0)}</b></div>
                ${oi ? `<div class="metrics-row"><span>PCR</span><b class="${oi.pcr > 1 ? 'up' : 'down'}">${oi.pcr}</b></div>` : ''}
                <div class="metrics-row"><span>Max Pain</span><b>${oi?.maxPainStrike || '---'}</b></div>
            `;
        }
    },

    // ===== OPTION CHAIN =====
    _ocRefreshTimer: null,
    _ocSymbol: null,

    _stopOCAutoRefresh() {
        if (this._ocRefreshTimer) {
            clearInterval(this._ocRefreshTimer);
            this._ocRefreshTimer = null;
            console.log('[OC] Auto-refresh stopped');
        }
    },

    async changeExpiry(expiry) {
        this.state.activeExpiry = expiry;
        await this.showOptionChain(this.state.activeSymbol, expiry);
    },

    async showOptionChain(symbol = 'NIFTY', expiryDate = '') {
        this.switchView('option-chain');
        this.state.activeSymbol = symbol;
        const clean = symbol.replace('NIFTY 50', 'NIFTY');

        const view = document.getElementById('view-option-chain');
        if (!view) return;

        view.innerHTML = `
            <div class="view-header">
                <div class="view-title" style="display:flex; align-items:center; gap:1rem">
                    <span><i class="fas fa-stream"></i> Option Chain: ${symbol}</span>
                    <select id="oc-expiry-dropdown" onchange="App.changeExpiry(this.value)" style="background:var(--bg-glass); color:var(--text-bright); border:1px solid rgba(255,255,255,0.2); padding:0.3rem 0.6rem; border-radius:6px; font-size:0.8rem; cursor:pointer; outline:none">
                        <option value="">Loading Expiries...</option>
                    </select>
                </div>
                <div style="display:flex; gap:0.5rem">
                    <button class="chart-action-btn" id="oc-greek-toggle" onclick="App.toggleGreeks(this)">
                        <i class="fas fa-calculator"></i> Greeks
                    </button>
                    <button class="back-btn" onclick="App.switchView('dashboard')"><i class="fas fa-arrow-left"></i> Back</button>
                </div>
            </div>
            <div id="oc-content">
                <div class="skeleton-loader" style="height:400px"></div>
            </div>
        `;

        const oi = await window.nseApi.getOIClock(clean, this.state.activeExpiry);
        const content = document.getElementById('oc-content');
        if (!oi) {
            content.innerHTML = '<div class="card glass" style="padding:4rem; text-align:center;">Option Data not available for this symbol.</div>';
            return;
        }

        this.state.activeExpiry = oi.currentExpiry || this.state.activeExpiry;

        if (oi.pcr) {
            this.recordPcr(clean, parseFloat(oi.pcr));
        }

        // Populate Expiry Dropdown
        const expirySelect = document.getElementById('oc-expiry-dropdown');
        if (expirySelect && oi.expiryDates?.length > 0) {
            expirySelect.innerHTML = oi.expiryDates.map(exp => `
                <option value="${exp}" ${exp === oi.currentExpiry ? 'selected' : ''}>Expiry: ${exp}</option>
            `).join('');
        }

        const underlying = oi.underlying || 0;

        content.innerHTML = `
            <div class="card glass oc-top-stats" style="padding:0.75rem 1rem;margin-bottom:1rem;display:flex;gap:1rem;font-size:0.8rem;align-items:center;flex-wrap:wrap;justify-content:space-between">
                <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap">
                    <span style="color:var(--text-bright);font-weight:700">Underlying: ${underlying ? '₹' + underlying.toLocaleString() : '---'}</span>
                    <span class="pcr-badge ${oi.pcr > 1 ? 'up' : 'down'}" style="font-weight:700">PCR: ${oi.pcr}</span>
                    <span style="color:var(--text-muted)">Max Pain: <b style="color:var(--primary)">${oi.maxPainStrike || '-'}</b></span>
                </div>
                <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap">
                    <button class="chart-action-btn" onclick="App.togglePcrChart('${clean}')" style="padding:0.35rem 0.75rem; font-size:0.75rem; background:rgba(99,102,241,0.15); color:var(--primary); border:1px solid rgba(99,102,241,0.3); border-radius:6px; font-weight:600">
                        <i class="fas fa-chart-line"></i> Intraday PCR Trend
                    </button>
                    <span style="color:var(--text-muted);font-size:0.7rem"><i class="far fa-clock"></i> ${oi.timestamp}</span>
                </div>
            </div>
            <div id="pcr-chart-container" class="card glass" style="display:none; padding:1.25rem; margin-bottom:1rem">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem; flex-wrap:wrap; gap:0.5rem">
                    <span style="font-size:0.85rem; font-weight:600; color:var(--text-bright)">
                        <i class="fas fa-chart-line" style="color:var(--primary)"></i> Live Intraday Put-Call Ratio (PCR) Stream
                    </span>
                    <div style="font-size:0.75rem; color:var(--text-muted)">
                        <span style="color:#10b981; font-weight:600">■ > 1.0 Bullish</span> &nbsp;|&nbsp; <span style="color:#ef4444; font-weight:600">■ < 1.0 Bearish</span>
                    </div>
                </div>
                <div id="pcr-chart-canvas" style="width:100%; height:180px"></div>
            </div>
            <div class="card glass" style="padding:0;overflow:auto;max-height:calc(100vh - 260px)">
                <table class="pro-table oc-table">
                    <thead>
                        <tr class="oc-main-header">
                            <th colspan="4" class="up oc-header-calls" style="text-align:center">CALLS</th>
                            <th class="oc-header-strike" style="color:var(--primary);text-align:center;width:80px">STRIKE</th>
                            <th colspan="4" class="down oc-header-puts" style="text-align:center">PUTS</th>
                        </tr>
                        <tr class="oc-sub-header">
                            <th class="greek-col" style="display:none">Vega</th>
                            <th class="greek-col" style="display:none">Gamma</th>
                            <th class="greek-col" style="display:none">Theta</th>
                            <th class="greek-col" style="display:none">Delta</th>
                            <th>IV</th><th>OI</th><th title="Change in Open Interest">OI CHG</th><th>LTP</th>
                            <th style="background:rgba(99, 102, 241, 0.05)"></th>
                            <th>LTP</th><th title="Change in Open Interest">OI CHG</th><th>OI</th><th>IV</th>
                            <th class="greek-col" style="display:none">Delta</th>
                            <th class="greek-col" style="display:none">Theta</th>
                            <th class="greek-col" style="display:none">Gamma</th>
                            <th class="greek-col" style="display:none">Vega</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${oi.data.map((r, idx) => {
            const ce = r.CE || {}; const pe = r.PE || {};
            const ceG = ce.greeks || {}; const peG = pe.greeks || {};
            const isITM_CE = r.strikePrice < underlying;
            const isITM_PE = r.strikePrice > underlying;
            const isATM = Math.abs(r.strikePrice - underlying) < 25; // Close to strike (e.g. 50 pt intervals)

            return `
                                <tr class="${isATM ? 'atm-row' : ''}">
                                    <td class="greek-col mono small" style="display:none; color:var(--primary)">${ceG.vega || '-'}</td>
                                    <td class="greek-col mono small" style="display:none; color:var(--primary)">${ceG.gamma || '-'}</td>
                                    <td class="greek-col mono small" style="display:none; color:var(--down)">${ceG.theta || '-'}</td>
                                    <td class="greek-col mono small" style="display:none; color:var(--primary)">${ceG.delta || '-'}</td>
                                    <td class="mono small" style="color:var(--amber); ${isITM_CE ? 'background:rgba(16, 185, 129, 0.05)' : ''}">${(ce.impliedVolatility || 0).toFixed(1)}%</td>
                                    <td style="${isITM_CE ? 'background:rgba(16, 185, 129, 0.05)' : ''}">${this.formatNumber(ce.openInterest)}</td>
                                    <td class="${(ce.changeinOpenInterest || 0) >= 0 ? 'up' : 'down'}" style="${isITM_CE ? 'background:rgba(16, 185, 129, 0.05)' : ''}">${this.formatNumber(ce.changeinOpenInterest)}</td>
                                    <td class="mono" style="${isITM_CE ? 'background:rgba(16, 185, 129, 0.05); font-weight:600' : ''}">₹${(ce.lastPrice || 0).toFixed(2)}</td>
                                    
                                    <td class="strike-cell">${r.strikePrice}</td>
                                    
                                    <td class="mono" style="${isITM_PE ? 'background:rgba(239, 68, 68, 0.05); font-weight:600' : ''}">₹${(pe.lastPrice || 0).toFixed(2)}</td>
                                    <td class="${(pe.changeinOpenInterest || 0) >= 0 ? 'up' : 'down'}" style="${isITM_PE ? 'background:rgba(239, 68, 68, 0.05)' : ''}">${this.formatNumber(pe.changeinOpenInterest)}</td>
                                    <td style="${isITM_PE ? 'background:rgba(239, 68, 68, 0.05)' : ''}">${this.formatNumber(pe.openInterest)}</td>
                                    <td class="mono small" style="color:var(--amber); ${isITM_PE ? 'background:rgba(239, 68, 68, 0.05)' : ''}">${(pe.impliedVolatility || 0).toFixed(1)}%</td>
                                    <td class="greek-col mono small" style="display:none; color:var(--primary)">${peG.delta || '-'}</td>
                                    <td class="greek-col mono small" style="display:none; color:var(--down)">${peG.theta || '-'}</td>
                                    <td class="greek-col mono small" style="display:none; color:var(--primary)">${peG.gamma || '-'}</td>
                                    <td class="greek-col mono small" style="display:none; color:var(--primary)">${peG.vega || '-'}</td>
                                </tr>
                            `;
        }).join('')}
                    </tbody>
                </table>
            </div>
        `;

        // Scroll to ATM & auto-center horizontal scroll on STRIKE column on mobile
        setTimeout(() => {
            const tableCard = document.querySelector('.oc-table')?.closest('.card');
            if (tableCard) {
                const strikeHeader = document.querySelector('.oc-header-strike');
                if (strikeHeader) {
                    const scrollLeft = strikeHeader.offsetLeft - (tableCard.clientWidth / 2) + (strikeHeader.clientWidth / 2);
                    tableCard.scrollLeft = Math.max(0, scrollLeft);
                }
            }

            const rows = document.querySelectorAll('.oc-table tbody tr');
            let closestRow = null;
            let minDiff = Infinity;

            rows.forEach(row => {
                const strike = parseFloat(row.querySelector('.strike-cell')?.textContent);
                const diff = Math.abs(strike - underlying);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestRow = row;
                }
            });

            if (closestRow) {
                closestRow.classList.add('atm-row');
                closestRow.scrollIntoView({ behavior: 'auto', block: 'center' });
            }
        }, 100);

        // Start 5s auto-refresh for live option chain data
        this._startOCAutoRefresh(clean);
    },

    _startOCAutoRefresh(symbol) {
        if (this._ocTimer) {
            clearInterval(this._ocTimer);
            this._ocTimer = null;
        }
        this._ocTimer = setInterval(() => {
            if (this.state.activeView === 'option-chain') {
                this.silentlyUpdateOptionChain(symbol);
            } else {
                clearInterval(this._ocTimer);
                this._ocTimer = null;
            }
        }, 300000); // 5-minute auto refresh for option chain
    },

    async silentlyUpdateOptionChain(symbol = 'NIFTY') {
        const clean = symbol.replace('NIFTY 50', 'NIFTY');
        const oi = await window.nseApi.getOIClock(clean, this.state.activeExpiry);
        if (!oi) return;

        const underlying = oi.underlying || 0;
        const container = document.getElementById('oc-content');
        if (!container) return;

        // Update top bar stats
        const topBar = container.querySelector('.card.glass:first-child');
        if (topBar) {
            topBar.innerHTML = `
                <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap">
                    <span style="color:var(--text-bright);font-weight:700">Underlying: ${underlying ? '₹' + underlying.toLocaleString() : '---'}</span>
                    <span class="pcr-badge ${oi.pcr > 1 ? 'up' : 'down'}" style="font-weight:700">PCR: ${oi.pcr}</span>
                    <span style="color:var(--text-muted)">Max Pain: <b style="color:var(--primary)">${oi.maxPainStrike || '-'}</b></span>
                </div>
                <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap">
                    <button class="chart-action-btn" onclick="App.togglePcrChart()" style="padding:0.35rem 0.75rem; font-size:0.75rem; background:rgba(99,102,241,0.15); color:var(--primary); border:1px solid rgba(99,102,241,0.3); border-radius:6px; font-weight:600">
                        <i class="fas fa-chart-line"></i> Intraday PCR Trend
                    </button>
                    <span style="color:var(--text-muted);font-size:0.7rem"><i class="far fa-clock"></i> ${oi.timestamp}</span>
                </div>
            `;
        }

        const tbody = document.querySelector('.oc-table tbody');
        if (tbody) {
            tbody.innerHTML = oi.data.map((r, idx) => {
                const ce = r.CE || {}; const pe = r.PE || {};
                const ceG = ce.greeks || {}; const peG = pe.greeks || {};
                const isITM_CE = r.strikePrice < underlying;
                const isITM_PE = r.strikePrice > underlying;
                const isATM = Math.abs(r.strikePrice - underlying) < 25;

                return `
                    <tr class="${isATM ? 'atm-row' : ''}">
                        <td class="greek-col mono small" style="display:none; color:var(--primary)">${ceG.vega || '-'}</td>
                        <td class="greek-col mono small" style="display:none; color:var(--primary)">${ceG.gamma || '-'}</td>
                        <td class="greek-col mono small" style="display:none; color:var(--down)">${ceG.theta || '-'}</td>
                        <td class="greek-col mono small" style="display:none; color:var(--primary)">${ceG.delta || '-'}</td>
                        <td class="mono small" style="color:var(--amber); ${isITM_CE ? 'background:rgba(16, 185, 129, 0.05)' : ''}">${(ce.impliedVolatility || 0).toFixed(1)}%</td>
                        <td style="${isITM_CE ? 'background:rgba(16, 185, 129, 0.05)' : ''}">${this.formatNumber(ce.openInterest)}</td>
                        <td class="${(ce.changeinOpenInterest || 0) >= 0 ? 'up' : 'down'}" style="${isITM_CE ? 'background:rgba(16, 185, 129, 0.05)' : ''}">${this.formatNumber(ce.changeinOpenInterest)}</td>
                        <td class="mono" style="${isITM_CE ? 'background:rgba(16, 185, 129, 0.05); font-weight:600' : ''}">₹${(ce.lastPrice || 0).toFixed(2)}</td>
                        
                        <td class="strike-cell">${r.strikePrice}</td>
                        
                        <td class="mono" style="${isITM_PE ? 'background:rgba(239, 68, 68, 0.05); font-weight:600' : ''}">₹${(pe.lastPrice || 0).toFixed(2)}</td>
                        <td class="${(pe.changeinOpenInterest || 0) >= 0 ? 'up' : 'down'}" style="${isITM_PE ? 'background:rgba(239, 68, 68, 0.05)' : ''}">${this.formatNumber(pe.changeinOpenInterest)}</td>
                        <td style="${isITM_PE ? 'background:rgba(239, 68, 68, 0.05)' : ''}">${this.formatNumber(pe.openInterest)}</td>
                        <td class="mono small" style="color:var(--amber); ${isITM_PE ? 'background:rgba(239, 68, 68, 0.05)' : ''}">${(pe.impliedVolatility || 0).toFixed(1)}%</td>
                        <td class="greek-col mono small" style="display:none; color:var(--primary)">${peG.delta || '-'}</td>
                        <td class="greek-col mono small" style="display:none; color:var(--down)">${peG.theta || '-'}</td>
                        <td class="greek-col mono small" style="display:none; color:var(--primary)">${peG.gamma || '-'}</td>
                        <td class="greek-col mono small" style="display:none; color:var(--primary)">${peG.vega || '-'}</td>
                    </tr>
                `;
            }).join('');

            const btn = document.getElementById('oc-greek-toggle');
            if (btn && btn.classList.contains('active')) {
                document.querySelectorAll('.greek-col').forEach(c => c.style.display = 'table-cell');
            }
        }
    },

    toggleGreeks(btn) {
        const active = btn.classList.toggle('active');
        const display = active ? 'table-cell' : 'none';
        const colspan = active ? 8 : 4;
        document.querySelectorAll('.greek-col').forEach(c => c.style.display = display);
        document.querySelectorAll('.oc-header-calls').forEach(c => c.colSpan = colspan);
        document.querySelectorAll('.oc-header-puts').forEach(c => c.colSpan = colspan);
    },

    getISTInfo(dateObj) {
        const d = dateObj || new Date();
        const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        const timeStr = d.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
        
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Kolkata',
            hour: 'numeric',
            minute: 'numeric',
            hour12: false
        }).formatToParts(d);
        
        let hour = 0, min = 0;
        parts.forEach(p => {
            if (p.type === 'hour') hour = parseInt(p.value, 10);
            if (p.type === 'minute') min = parseInt(p.value, 10);
        });

        const dayName = d.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' });
        const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayName);
        
        return { dateStr, timeStr, hour, min, day, totalMin: (hour * 60) + min };
    },

    getISTDate() {
        return new Date();
    },

    getISTDateStr(dateObj) {
        const target = dateObj || new Date();
        return target.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    },

    getISTTimeString(dateObj) {
        const target = dateObj || new Date();
        return target.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    },

    isWeekend(istDate = new Date()) {
        const info = this.getISTInfo(istDate);
        return info.day === 0 || info.day === 6;
    },

    getLastTradingDateStr(fromDateObj) {
        const d = fromDateObj ? new Date(fromDateObj.getTime()) : new Date();
        d.setDate(d.getDate() - 1);
        let info = this.getISTInfo(d);
        while (info.day === 0 || info.day === 6) {
            d.setDate(d.getDate() - 1);
            info = this.getISTInfo(d);
        }
        return info.dateStr;
    },

    getTargetTradingDateStr() {
        const info = this.getISTInfo();

        // Weekend (Saturday or Sunday) -> Use last Friday
        if (info.day === 0 || info.day === 6) {
            return this.getLastTradingDateStr();
        }

        // Before 09:15 AM IST on a weekday -> Use previous trading day
        if (info.totalMin < (9 * 60 + 15)) {
            return this.getLastTradingDateStr();
        }

        // During/After 09:15 AM IST on a weekday -> Use today
        return info.dateStr;
    },

    initFirebaseTimeEngine(sym) {
        try {
            if (!window.firebase || typeof window.firebase.database !== 'function') return;

            // Real-time Multi-Device PCR Stream Listener
            const cleanSym = (sym || this.state.activeSymbol || 'NIFTY').replace('NIFTY 50', 'NIFTY').replace('NIFTY BANK', 'BANKNIFTY').toUpperCase();
            const dateStr = this.getTargetTradingDateStr();
            const streamPath = `pcr_history/${cleanSym}/${dateStr}`;

            if (this._fbActiveStreamPath === streamPath) return;
            if (this._fbActiveStreamRef) {
                try { this._fbActiveStreamRef.off(); } catch (e) {}
            }

            const db = window.firebase.database();
            this._fbActiveStreamPath = streamPath;
            this._fbActiveStreamRef = db.ref(streamPath);

            this._fbActiveStreamRef.on('value', (snapshot) => {
                if (snapshot.exists()) {
                    const val = snapshot.val();
                    const list = Array.isArray(val) ? val : Object.values(val);
                    if (list && list.length > 0) {
                        if (typeof this.state.pcrHistory !== 'object' || Array.isArray(this.state.pcrHistory)) {
                            this.state.pcrHistory = {};
                        }
                        // Merge intelligently without losing existing ticks
                        const current = this.state.pcrHistory[cleanSym] || [];
                        const mergedMap = new Map();
                        [...list, ...current].forEach(item => {
                            if (item && item.time) mergedMap.set(item.time, item);
                        });
                        const sortedList = Array.from(mergedMap.values()).sort((a, b) => a.time - b.time);
                        this.state.pcrHistory[cleanSym] = sortedList;

                        if (this.state.activeView === 'pcr-analytics' && (cleanSym === (this.state.pcrAnalyticsSymbol || 'NIFTY'))) {
                            this.renderPcrAnalyticsChartCanvas(cleanSym);
                            this.renderPcrSnapshotsTable(cleanSym);
                        } else if ((this.state.activeView === 'oi-clock' || this.state.activeView === 'option-chain' || this.state.activeView === 'symbol-overview') && (this.state.activeSymbol || 'NIFTY').toUpperCase().includes(cleanSym)) {
                            this.renderPcrChartCanvas(cleanSym);
                        }
                    }
                }
            }, () => {});
        } catch (e) {
            console.warn('Firebase Time Engine Warning:', e.message);
        }
    },

    sanitize5MinPcrList(rawList) {
        if (!Array.isArray(rawList)) return [];
        const valid = rawList.filter(item => item && typeof item === 'object' && typeof item.value === 'number' && !isNaN(item.value) && item.value > 0);
        if (valid.length === 0) return [];

        // Calculate Midnight IST for Today to filter out previous days' leftover ticks
        const now = new Date();
        const istDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        const todayMidnightIst = Math.floor(new Date(istDateStr + 'T00:00:00+05:30').getTime() / 1000);

        const todayValid = valid.filter(item => {
            const timeSec = item.time || (item.timestamp ? Math.floor(item.timestamp / 1000) : 0);
            return timeSec >= todayMidnightIst;
        });

        const targetList = todayValid.length >= 2 ? todayValid : valid;

        // Forward-fill missing spot prices so spot never drops to 0 creating red vertical lines
        let lastValidSpot = 0;
        for (let i = 0; i < targetList.length; i++) {
            const s = parseFloat(targetList[i].spot) || 0;
            if (s > 0) lastValidSpot = s;
            else if (lastValidSpot > 0) targetList[i].spot = lastValidSpot;
        }

        // Sort strictly ascending by epoch timestamp
        targetList.sort((a, b) => (a.time || a.timestamp || 0) - (b.time || b.timestamp || 0));

        // Identify if original entries with AM/PM or non-300sec exist
        const hasOriginals = targetList.some(item => {
            const str = item.timeStr || '';
            const isExactStr = /[ap]m/i.test(str);
            const isExactSec = (item.time || 0) % 300 !== 0;
            return isExactStr || isExactSec;
        });

        let filtered = targetList;
        if (hasOriginals) {
            // Filter out synthetic 24h bucket entries (time % 300 === 0 and 24h HH:MM without am/pm)
            filtered = valid.filter(item => {
                const str = (item.timeStr || '').trim();
                const isSynthetic = (item.time % 300 === 0) && (/^\d{2}:\d{2}$/.test(str));
                return !isSynthetic;
            });
        }

        const cleanMap = new Map();
        for (const item of filtered) {
            let timeSec = item.time || (item.timestamp ? Math.floor(item.timestamp / 1000) : 0);
            if (!timeSec) continue;

            let str = (item.timeStr || '').trim();
            if (!str || /^\d{2}:\d{2}$/.test(str)) {
                const d = new Date((timeSec + 5.5 * 3600) * 1000);
                let h = d.getUTCHours();
                const m = String(d.getUTCMinutes()).padStart(2, '0');
                const ampm = h >= 12 ? 'pm' : 'am';
                h = h % 12 || 12;
                str = `${String(h).padStart(2, '0')}:${m} ${ampm}`;
            }

            cleanMap.set(timeSec, {
                time: timeSec,
                timeStr: str,
                value: parseFloat(item.value.toFixed(4)),
                spot: item.spot ? parseFloat(parseFloat(item.spot).toFixed(2)) : 0
            });
        }

        const sorted = Array.from(cleanMap.values()).sort((a, b) => a.time - b.time);

        // Ensure all items have a valid spot price fallback
        const validSpots = sorted.map(d => d.spot).filter(s => s > 0);
        if (validSpots.length > 0) {
            const firstValid = validSpots[0];
            const lastValid = validSpots[validSpots.length - 1];
            let current = firstValid;
            sorted.forEach(d => {
                if (d.spot > 0) current = d.spot;
                else d.spot = current || lastValid;
            });
        }

        return sorted;
    },

    async prefillIntradayPcrHistory(sym) {
        const cleanSym = sym.replace('NIFTY 50', 'NIFTY').replace('NIFTY BANK', 'BANKNIFTY').toUpperCase();
        if (typeof this.state.pcrHistory !== 'object' || Array.isArray(this.state.pcrHistory)) {
            this.state.pcrHistory = {};
        }

        let targetDateStr = this.getTargetTradingDateStr();

        // Initialize Firebase Time Engine & Live Multi-Device Sync
        this.initFirebaseTimeEngine(cleanSym);

        let loadedList = [];

        // 1. Try loading target date from Firebase Realtime DB
        if (window.firebase && window.firebase.apps && window.firebase.apps.length > 0 && window.firebase.database) {
            try {
                const snapshot = await window.firebase.database().ref(`pcr_history/${cleanSym}/${targetDateStr}`).once('value');
                if (snapshot.exists()) {
                    const val = snapshot.val();
                    loadedList = this.sanitize5MinPcrList(Array.isArray(val) ? val : Object.values(val));
                }
            } catch(e) {}
        }

        // 2. If target date has < 5 snapshots (e.g. pre-market or early trading session), fall back to previous trading day
        if (loadedList.length < 5) {
            const prevDateStr = this.getLastTradingDateStr();
            if (prevDateStr !== targetDateStr && window.firebase && window.firebase.database) {
                try {
                    const snapshotPrev = await window.firebase.database().ref(`pcr_history/${cleanSym}/${prevDateStr}`).once('value');
                    if (snapshotPrev.exists()) {
                        const valPrev = snapshotPrev.val();
                        const listPrev = this.sanitize5MinPcrList(Array.isArray(valPrev) ? valPrev : Object.values(valPrev));
                        if (listPrev.length > loadedList.length) {
                            loadedList = listPrev;
                        }
                    }
                } catch(e) {}
            }
        }

        // 3. Fallback to local storage if needed
        if (loadedList.length < 1) {
            try {
                const cacheKey = 'destrade_pcr_hist_' + targetDateStr;
                const saved = localStorage.getItem(cacheKey);
                if (saved) {
                    const parsed = JSON.parse(saved);
                    if (parsed[cleanSym]) {
                        loadedList = this.sanitize5MinPcrList(parsed[cleanSym]);
                    }
                }
            } catch(e) {}
        }

        if (loadedList.length >= 1) {
            this.state.pcrHistory[cleanSym] = loadedList;
            if (this.state.activeView === 'pcr-analytics') {
                this.renderPcrAnalyticsChartCanvas(cleanSym);
            } else {
                this.renderPcrChartCanvas(cleanSym);
            }
        }
    },

    recordPcr(symbol, pcrVal, underlying = 0) {
        if (!symbol || isNaN(pcrVal) || pcrVal <= 0) return;

        const ist = this.getISTDate();
        const day = ist.getDay();
        if (day === 0 || day === 6) return; // Skip weekends

        const totalMin = (ist.getHours() * 60) + ist.getMinutes();
        if (totalMin < (9 * 60 + 10) || totalMin > (15 * 60 + 40)) return; // Only record during market hours (09:10 - 15:40)

        const sym = symbol.replace('NIFTY 50', 'NIFTY').replace('NIFTY BANK', 'BANKNIFTY').toUpperCase();

        if (typeof this.state.pcrHistory !== 'object' || Array.isArray(this.state.pcrHistory)) {
            this.state.pcrHistory = {};
        }
        if (!this.state.pcrHistory[sym]) {
            this.state.pcrHistory[sym] = [];
        }

        let list = this.sanitize5MinPcrList(this.state.pcrHistory[sym]);
        const nowSec = Math.floor(Date.now() / 1000);
        const timeStr = this.getISTTimeString();
        const lastEntry = list[list.length - 1];

        // Record ticks every 3 minutes (>= 150 seconds)
        if (!lastEntry || (nowSec - lastEntry.time) >= 150) {
            list.push({ time: nowSec, timeStr: timeStr, value: parseFloat(pcrVal), spot: parseFloat(underlying) || 0 });
            if (list.length > 2500) list.shift();

            this.state.pcrHistory[sym] = list;

            const dateStr = this.getISTDateStr();
            const todayKey = 'destrade_pcr_hist_' + dateStr;
            try {
                localStorage.setItem(todayKey, JSON.stringify(this.state.pcrHistory));
            } catch(e) {}

            // MERGE with existing Firebase data
            if (window.firebase && window.firebase.database && (!this._lastFbPush || Date.now() - this._lastFbPush > 5000)) {
                this._lastFbPush = Date.now();
                const fbRef = window.firebase.database().ref(`pcr_history/${sym}/${dateStr}`);
                fbRef.once('value').then(snapshot => {
                    let serverList = [];
                    if (snapshot.exists()) {
                        const val = snapshot.val();
                        serverList = Array.isArray(val) ? val : Object.values(val);
                    }
                    const mergedMap = new Map();
                    [...serverList, ...list].forEach(item => {
                        if (item && item.time) mergedMap.set(item.time, item);
                    });
                    const merged = Array.from(mergedMap.values())
                        .filter(x => x && typeof x.value === 'number' && x.value > 0)
                        .sort((a, b) => a.time - b.time)
                        .slice(-150);
                    this.state.pcrHistory[sym] = merged;
                    fbRef.set(merged).catch(() => {});
                }).catch(() => {});
            }
        }

        if (this.state.activeView === 'pcr-analytics') {
            this.renderPcrAnalyticsChartCanvas(sym);
        } else if ((this.state.activeView === 'oi-clock' || this.state.activeView === 'symbol-overview') && (this.state.activeSymbol || 'NIFTY').toUpperCase().includes(sym)) {
            this.renderPcrChartCanvas(sym);
        }
    },

    togglePcrChart(targetSymbol) {
        const cont = document.getElementById('pcr-chart-container');
        if (!cont) return;
        const visible = cont.style.display !== 'none';
        cont.style.display = visible ? 'none' : 'block';
        if (!visible) {
            const sym = targetSymbol || this.state.activeSymbol || 'NIFTY';
            this.renderPcrChartCanvas(sym);
        }
    },

    renderPcrChartCanvas(targetSymbol) {
        const container = document.getElementById('pcr-chart-canvas');
        if (!container) return;

        const sym = (targetSymbol || this.state.activeSymbol || 'NIFTY').replace('NIFTY 50', 'NIFTY').replace('NIFTY BANK', 'BANKNIFTY').toUpperCase();

        let rawList = [];
        if (this.state.pcrHistory && typeof this.state.pcrHistory === 'object' && !Array.isArray(this.state.pcrHistory)) {
            rawList = this.state.pcrHistory[sym] || [];
        }

        // Sanitize & deduplicate to strict 5-minute ticks
        let data = this.sanitize5MinPcrList(rawList);
        this.state.pcrHistory[sym] = data;

        if (!data || data.length < 1) {
            container.innerHTML = `<div style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding-top:60px"><i class="fas fa-spinner fa-spin"></i> Synchronizing intraday stream for ${sym}...</div>`;
            this.prefillIntradayPcrHistory(sym);
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        const width = container.clientWidth || 340;
        const height = container.clientHeight || 200;
        container.innerHTML = `<canvas id="pcr-canvas-element" width="${Math.round(width * dpr)}" height="${Math.round(height * dpr)}" style="width:${width}px; height:${height}px; cursor:crosshair; touch-action:none"></canvas>`;
        const canvas = document.getElementById('pcr-canvas-element');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        const values = data.map(d => d.value);
        const rawMin = Math.min(...values);
        const rawMax = Math.max(...values);
        const padding = Math.max(0.03, (rawMax - rawMin) * 0.18);
        const minVal = Math.max(0.1, rawMin - padding);
        const maxVal = (rawMax === rawMin) ? (rawMax + 0.1) : (rawMax + padding);

        const spots = data.map(d => parseFloat(d.spot) || 0).filter(s => s > 0);
        const hasSpot = spots.length > 1;
        const spotMin = hasSpot ? Math.min(...spots) * 0.999 : 0;
        const spotMax = hasSpot ? Math.max(...spots) * 1.001 : 1;

        const paddingLeft = 42;
        const paddingRight = hasSpot ? 55 : 45;
        const paddingTop = 22;
        const paddingBottom = 28;
        const chartW = width - paddingLeft - paddingRight;
        const chartH = height - paddingTop - paddingBottom;

        const pts = data.map((d, i) => {
            const x = (data.length === 1) ? (paddingLeft + chartW / 2) : (paddingLeft + (i / (data.length - 1)) * chartW);
            const y = paddingTop + chartH * (1 - (d.value - minVal) / (maxVal - minVal || 1));
            const spotY = hasSpot ? paddingTop + chartH * (1 - ((parseFloat(d.spot) || 0) - spotMin) / ((spotMax - spotMin) || 1)) : 0;
            return { x, y, spotY, val: d.value, spot: parseFloat(d.spot) || 0, timeStr: d.timeStr || '--' };
        });

        let hoverIdx = null;

        const drawChart = () => {
            ctx.clearRect(0, 0, width, height);

            // 1. Draw Horizontal Gridlines & Y-Axis Labels
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.lineWidth = 1;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
            ctx.font = '10px monospace';
            ctx.textAlign = 'right';

            const gridSteps = 4;
            for (let g = 0; g <= gridSteps; g++) {
                const ratio = g / gridSteps;
                const y = paddingTop + chartH * (1 - ratio);
                const val = (minVal + ratio * (maxVal - minVal)).toFixed(2);

                ctx.beginPath();
                ctx.moveTo(paddingLeft, y);
                ctx.lineTo(width - paddingRight, y);
                ctx.stroke();

                ctx.fillText(val, paddingLeft - 6, y + 3);

                if (hasSpot) {
                    const spotVal = Math.round(spotMin + ratio * (spotMax - spotMin));
                    ctx.textAlign = 'left';
                    ctx.fillStyle = 'rgba(56, 189, 248, 0.7)';
                    ctx.fillText('₹' + spotVal, width - paddingRight + 6, y + 3);
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
                    ctx.textAlign = 'right';
                }
            }

            // 2. Draw Spot Price Line (Subtle Cyan Overlay) if available
            if (hasSpot && pts.length > 1) {
                ctx.beginPath();
                ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([3, 3]);
                ctx.moveTo(pts[0].x, pts[0].spotY);
                for (let i = 1; i < pts.length; i++) {
                    ctx.lineTo(pts[i].x, pts[i].spotY);
                }
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // 3. Smooth Area Gradient Fill for PCR
            const lastPt = pts[pts.length - 1];
            const isBullish = lastPt.val >= 1.0;
            const grad = ctx.createLinearGradient(0, paddingTop, 0, height - paddingBottom);
            if (isBullish) {
                grad.addColorStop(0, 'rgba(16, 185, 129, 0.28)');
                grad.addColorStop(1, 'rgba(16, 185, 129, 0.01)');
            } else {
                grad.addColorStop(0, 'rgba(239, 68, 68, 0.28)');
                grad.addColorStop(1, 'rgba(239, 68, 68, 0.01)');
            }

            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 0; i < pts.length - 1; i++) {
                const xc = (pts[i].x + pts[i + 1].x) / 2;
                const yc = (pts[i].y + pts[i + 1].y) / 2;
                ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
            }
            ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
            ctx.lineTo(pts[pts.length - 1].x, height - paddingBottom);
            ctx.lineTo(pts[0].x, height - paddingBottom);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();

            // 4. Smooth Bezier Curved PCR Line Graph (Razor Sharp)
            ctx.beginPath();
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = isBullish ? '#10b981' : '#ef4444';

            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 0; i < pts.length - 1; i++) {
                const xc = (pts[i].x + pts[i + 1].x) / 2;
                const yc = (pts[i].y + pts[i + 1].y) / 2;
                ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
            }
            ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
            ctx.stroke();
            ctx.shadowBlur = 0; // reset shadow

            // 5. Live Endpoint Pulse Dot
            ctx.beginPath();
            ctx.arc(lastPt.x, lastPt.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = isBullish ? '#10b981' : '#ef4444';
            ctx.fill();

            ctx.fillStyle = isBullish ? '#10b981' : '#ef4444';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`PCR ${lastPt.val.toFixed(4)}`, lastPt.x + 6, lastPt.y + 3);

            // 6. Interactive Crosshair & Tooltip Overlay
            if (hoverIdx !== null && pts[hoverIdx]) {
                const hp = pts[hoverIdx];

                // Vertical Crosshair Line
                ctx.beginPath();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 2]);
                ctx.moveTo(hp.x, paddingTop);
                ctx.lineTo(hp.x, height - paddingBottom);
                ctx.stroke();
                ctx.setLineDash([]);

                // Highlighted Data Point
                ctx.beginPath();
                ctx.arc(hp.x, hp.y, 6, 0, Math.PI * 2);
                ctx.fillStyle = hp.val >= 1.0 ? '#10b981' : '#ef4444';
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();

                // Floating Glass Tooltip Box
                const tipText = `Time: ${hp.timeStr} | PCR: ${hp.val.toFixed(4)}${hp.spot ? ` | Spot: ₹${hp.spot.toLocaleString()}` : ''}`;
                ctx.font = 'bold 10px sans-serif';
                const textW = ctx.measureText(tipText).width + 16;
                let tipX = hp.x - textW / 2;
                if (tipX < paddingLeft) tipX = paddingLeft;
                if (tipX + textW > width - paddingRight) tipX = width - paddingRight - textW;

                const tipY = paddingTop + 4;

                ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
                ctx.strokeStyle = 'rgba(99, 102, 241, 0.5)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                if (typeof ctx.roundRect === 'function') ctx.roundRect(tipX, tipY, textW, 22, 6);
                else ctx.rect(tipX, tipY, textW, 22);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = '#f8fafc';
                ctx.textAlign = 'left';
                ctx.fillText(tipText, tipX + 8, tipY + 15);
            }

            // 7. Timeline Labels at Bottom (09:15 to 15:30)
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.font = '9px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(pts[0].timeStr || '09:15', paddingLeft, height - 6);
            ctx.textAlign = 'center';
            if (hasSpot) {
                ctx.fillStyle = 'rgba(56, 189, 248, 0.7)';
                ctx.fillText('── Spot Price Overlay', width / 2, height - 6);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            }
            ctx.textAlign = 'right';
            ctx.fillText(pts[pts.length - 1].timeStr || '15:30', width - paddingRight, height - 6);
        };

        const updateHover = (e) => {
            const rect = canvas.getBoundingClientRect();
            const clientX = e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX);
            if (!clientX) return;
            const mouseX = clientX - rect.left;
            if (mouseX >= paddingLeft && mouseX <= width - paddingRight) {
                const ratio = (mouseX - paddingLeft) / chartW;
                hoverIdx = Math.min(pts.length - 1, Math.max(0, Math.round(ratio * (pts.length - 1))));
            } else {
                hoverIdx = null;
            }
            drawChart();
        };

        canvas.onmousemove = updateHover;
        canvas.ontouchmove = updateHover;
        drawChart();

        // 8. Render NiftyTrader-style Intraday History Table below chart
        let tableEl = document.getElementById('pcr-intraday-table-container');
        if (!tableEl) {
            const parent = container.parentElement;
            if (parent) {
                tableEl = document.createElement('div');
                tableEl.id = 'pcr-intraday-table-container';
                tableEl.style.cssText = 'margin-top:1.25rem; overflow-x:auto; border-top:1px solid rgba(255,255,255,0.08); padding-top:1rem;';
                parent.appendChild(tableEl);
            }
        }
        if (tableEl) {
            const reversedData = [...data].reverse();
            tableEl.innerHTML = `
                <div style="font-size:0.85rem; font-weight:700; color:var(--text-bright); margin-bottom:0.75rem; display:flex; justify-content:space-between; align-items:center;">
                    <span><i class="fas fa-list-alt" style="color:var(--primary)"></i> Intraday PCR History Snapshots</span>
                    <span style="font-size:0.75rem; font-weight:400; color:var(--text-muted)">${data.length} snapshots recorded today</span>
                </div>
                <table class="pro-table" style="width:100%; font-size:0.78rem; border-collapse:collapse;">
                    <thead>
                        <tr style="background:rgba(15, 23, 42, 0.6); color:var(--text-muted); text-align:left;">
                            <th style="padding:0.5rem 0.75rem;">Time (IST)</th>
                            <th style="padding:0.5rem 0.75rem; text-align:right;">OI PCR</th>
                            <th style="padding:0.5rem 0.75rem; text-align:center;">Sentiment</th>
                            <th style="padding:0.5rem 0.75rem; text-align:right;">Spot Price</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${reversedData.map(d => {
                            const valNum = (d && typeof d.value === 'number' && !isNaN(d.value)) ? d.value : 0;
                            const isBull = valNum >= 1.0;
                            const valStr = valNum ? valNum.toFixed(4) : '0.0000';
                            const spotNum = parseFloat(d.spot) || 0;
                            return `
                                <tr style="border-bottom:1px solid rgba(255,255,255,0.04)">
                                    <td style="padding:0.5rem 0.75rem; font-family:monospace; color:var(--text-bright)">${d.timeStr || '--'}</td>
                                    <td style="padding:0.5rem 0.75rem; text-align:right; font-weight:700; color:${isBull ? '#10b981' : '#ef4444'}">${valStr}</td>
                                    <td style="padding:0.5rem 0.75rem; text-align:center;">
                                        <span class="badge ${isBull ? 'up' : 'down'}" style="font-size:0.7rem; padding:0.15rem 0.5rem;">
                                            ${isBull ? 'Bullish (Put Higher)' : 'Bearish (Call Higher)'}
                                        </span>
                                    </td>
                                    <td style="padding:0.5rem 0.75rem; text-align:right; font-family:monospace; color:var(--primary)">${spotNum ? '₹' + spotNum.toLocaleString() : '---'}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;
        }
    },

    // ===== INTRADAY SCAN TIMELINE LOG MODAL =====
    scanLogFilter: 'all', // 'all', 'bull', 'bear', 'dual'

    openScanHistoryModal() {
        const modal = document.getElementById('scan-history-modal');
        if (modal) {
            modal.classList.add('active');
            this.renderScanHistoryTimeline();
        }
    },

    filterScanHistoryLog(filter) {
        this.scanLogFilter = filter || 'all';
        const btns = ['all', 'bull', 'bear', 'dual', 'spike'];
        btns.forEach(b => {
            const btn = document.getElementById(`scan-log-btn-${b}`);
            if (btn) {
                const isActive = (b === this.scanLogFilter);
                btn.classList.toggle('active', isActive);
                btn.style.background = isActive ? (b === 'spike' ? 'rgba(245, 158, 11, 0.25)' : 'rgba(56, 189, 248, 0.2)') : 'rgba(255,255,255,0.05)';
                btn.style.borderColor = isActive ? (b === 'spike' ? '#f59e0b' : '#38bdf8') : 'rgba(255,255,255,0.1)';
                btn.style.color = isActive ? (b === 'spike' ? '#f59e0b' : '#38bdf8') : 'var(--text-muted)';
            }
        });
        this.renderScanHistoryTimeline();
    },

    parseTimeToMinutes(timeStr) {
        if (!timeStr || typeof timeStr !== 'string') return 0;
        const match = timeStr.match(/(\d+):(\d+)(?::(\d+))?\s*(AM|PM)/i);
        if (!match) return 0;
        let hrs = parseInt(match[1], 10);
        const mins = parseInt(match[2], 10);
        const ampm = match[4].toUpperCase();
        if (ampm === 'PM' && hrs < 12) hrs += 12;
        if (ampm === 'AM' && hrs === 12) hrs = 0;
        return hrs * 60 + mins;
    },

    calculateDualSpikePowerScore(pcrMult, spotMult) {
        const raw = (pcrMult * spotMult) * (pcrMult + spotMult);
        let score = Math.round(40 + (Math.log2(raw + 1) * 8.5));
        return Math.min(99, Math.max(50, score));
    },

    renderScanHistoryTimeline() {
        const container = document.getElementById('scan-history-modal-body');
        if (!container) return;

        const pcrHist = this.state.pcrHistory || {};
        const symbols = Object.keys(pcrHist);
        const filterMode = this.scanLogFilter || 'all';

        const timeMap = {};
        const lastTriggeredMins = {}; // Track symbol -> last triggered minute to enforce 30m cooling off

        symbols.forEach(sym => {
            const rawList = pcrHist[sym];
            if (!Array.isArray(rawList) || rawList.length < 4) return;

            const cleanList = this.sanitize5MinPcrList(rawList);
            if (cleanList.length < 4) return;

            // Compute All-Day Average 5-Min Tick Shifts for this symbol
            let sumPcrDiff = 0, sumSpotDiff = 0, cnt = 0;
            for (let k = 1; k < cleanList.length; k++) {
                sumPcrDiff += Math.abs(cleanList[k].value - cleanList[k-1].value);
                sumSpotDiff += Math.abs((cleanList[k].spot || 0) - (cleanList[k-1].spot || 0));
                cnt++;
            }
            const avgPcrDiff = cnt > 0 ? (sumPcrDiff / cnt) : 0.001;
            const avgSpotDiff = cnt > 0 ? (sumSpotDiff / cnt) : 1.0;

            // Scan every tick
            for (let i = 3; i < cleanList.length; i++) {
                const cur = cleanList[i];
                const prev = cleanList[i - 3]; // 15m window
                const tickPrev = cleanList[i - 1]; // Single tick (5m)

                const timeStr = cur.timeStr || '--';
                const tickMins = this.parseTimeToMinutes(timeStr);

                const pcrCur = cur.value;
                const pcrPrev = prev.value;
                const pcrDiff = pcrCur - pcrPrev;
                const pcrPct = pcrPrev > 0 ? ((pcrDiff / pcrPrev) * 100) : 0;

                const spotCur = cur.spot || 0;
                const spotPrev = prev.spot || 0;
                const spotDiff = (spotCur && spotPrev) ? (spotCur - spotPrev) : 0;
                const spotPct = spotPrev > 0 ? ((spotDiff / spotPrev) * 100) : 0;

                // Single Tick Shift Analysis
                const singlePcrDiff = pcrCur - tickPrev.value;
                const singleSpotDiff = (spotCur && tickPrev.spot) ? (spotCur - tickPrev.spot) : 0;

                // 1. Strict Dual Trend Alignment Guard:
                // Single tick movement AND 15-minute trend MUST move in the exact same direction!
                const isBullishAligned = (singleSpotDiff > 0 && spotDiff > 0) && (singlePcrDiff > 0 && pcrDiff > 0);
                const isBearishAligned = (singleSpotDiff < 0 && spotDiff < 0) && (singlePcrDiff < 0 && pcrDiff < 0);

                const pcrMultiplier = avgPcrDiff > 0 ? (Math.abs(singlePcrDiff) / avgPcrDiff) : 0;
                const spotMultiplier = avgSpotDiff > 0 ? (Math.abs(singleSpotDiff) / avgSpotDiff) : 0;
                const avgMultiplier = (pcrMultiplier + spotMultiplier) / 2;

                // 2. Strict PCR Floor Guard & Volatility Floor:
                // PCR MUST have a real feelable movement (>= 0.8% PCR change or >= 0.003 absolute shift)!
                const isSignificantPcr = Math.abs(pcrPct) >= 0.8 || Math.abs(pcrDiff) >= 0.003;
                const isSignificantSpot = Math.abs(spotPct) >= 0.15;

                // Genuine Dual Tick Spike ONLY:
                // Must be trend-aligned, feelable PCR shift, significant price movement, and both PCR & Spot multipliers >= 1.2x of day average!
                const isDualSpike = (isBullishAligned || isBearishAligned) && isSignificantPcr && isSignificantSpot && (pcrMultiplier >= 1.2 && spotMultiplier >= 1.2);

                if (!isDualSpike) continue; // REMOVE ALL DEFAULT SIGNALS! ONLY KEEP DUAL TICK SPIKES!

                // 3. 30-Minute Symbol Cooling-Off Rule:
                // If this symbol already triggered a signal in the last 30 minutes, suppress it to prevent repeated clutter!
                if (lastTriggeredMins[sym] && (tickMins - lastTriggeredMins[sym]) < 30) {
                    continue;
                }
                lastTriggeredMins[sym] = tickMins;

                if (!timeMap[timeStr]) timeMap[timeStr] = [];

                const type = isBullishAligned ? 'BULLISH' : 'BEARISH';
                const tag = isBullishAligned ? '🚀 PURE DUAL SURGE' : '📉 PURE DUAL CRASH';
                const tagBg = isBullishAligned ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)';
                const tagColor = isBullishAligned ? '#10b981' : '#ef4444';

                // HARMONIC DUAL SCORE: Geometric mean of Spot % AND PCR %!
                const absSpotPct = Math.abs(spotPct);
                const absPcrPct = Math.abs(pcrPct);
                const harmonicPct = Math.sqrt(absSpotPct * absPcrPct);
                let rawScore = 45 + (harmonicPct * 22) + (avgMultiplier * 4);
                const powerScore = Math.min(99, Math.max(50, Math.round(rawScore)));

                timeMap[timeStr].push({
                    symbol: sym,
                    type,
                    tag,
                    tagBg,
                    tagColor,
                    pcrCur,
                    pcrDiff,
                    pcrPct,
                    spotCur,
                    spotDiff,
                    spotPct,
                    isDualSpike: true,
                    pcrMultiplier,
                    spotMultiplier,
                    powerScore,
                    score: powerScore
                });
            }
        });

        // Sort timestamps chronologically descending (Latest time of day first)
        const sortedTimeObjects = Object.keys(timeMap).map(t => ({
            timeStr: t,
            mins: this.parseTimeToMinutes(t)
        })).sort((a, b) => b.mins - a.mins);

        let totalEvents = 0;
        let html = '';

        sortedTimeObjects.forEach(item => {
            const t = item.timeStr;
            let events = timeMap[t] || [];

            if (filterMode === 'bull') events = events.filter(e => e.type === 'BULLISH');
            else if (filterMode === 'bear') events = events.filter(e => e.type === 'BEARISH');
            else if (filterMode === 'dual') events = events.filter(e => e.tag.includes('DUAL'));
            else if (filterMode === 'spike') events = events.filter(e => e.isDualSpike);

            if (events.length === 0) return;
            totalEvents += events.length;

            if (filterMode === 'spike') {
                events.sort((a, b) => b.powerScore - a.powerScore);
            } else {
                events.sort((a, b) => b.score - a.score);
            }

            html += `
                <div style="margin-bottom: 1rem; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 0.75rem 1rem;">
                    <div style="font-weight: 800; font-size: 0.88rem; color: #38bdf8; margin-bottom: 0.6rem; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 0.4rem;">
                        <span><i class="far fa-clock"></i> ${t} IST</span>
                        <span style="font-size: 0.72rem; padding: 0.1rem 0.4rem; background: rgba(56,189,248,0.15); border-radius: 4px; color: #38bdf8; font-weight:700;">${events.length} Signals</span>
                    </div>

                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0.5rem;">
            `;

            events.forEach(e => {
                const pcrDiffStr = (e.pcrDiff > 0 ? '+' : '') + e.pcrDiff.toFixed(4);
                const spotDiffStr = (e.spotDiff > 0 ? '+' : '') + e.spotDiff.toFixed(2);
                const spotPctStr = (e.spotPct > 0 ? '+' : '') + Number(e.spotPct).toFixed(2) + '%';

                const scorePill = `<span style="font-family:'JetBrains Mono',monospace; font-weight:800; font-size:0.75rem; color:${e.tagColor}; background:${e.tagBg}; padding:0.15rem 0.45rem; border-radius:6px; border:1px solid ${e.tagColor}50;">${e.powerScore || e.score}<span style="font-size:0.65rem; opacity:0.75;">/100</span></span>`;

                html += `
                    <div onclick="document.getElementById('scan-history-modal').classList.remove('active'); App.switchView('pcr-analytics'); App.changePcrSymbol('${e.symbol}');"
                         style="background: rgba(0,0,0,0.3); border: 1px solid ${e.tagColor}30; border-radius: 6px; padding: 0.5rem 0.65rem; cursor: pointer; transition: all 0.18s;"
                         onmouseover="this.style.borderColor='${e.tagColor}'; this.style.transform='translateY(-1px)';"
                         onmouseout="this.style.borderColor='${e.tagColor}30'; this.style.transform='none';">
                        
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.25rem;">
                            <div style="font-weight: 700; color: #f8fafc; font-size: 0.85rem; display: flex; align-items: center; gap: 0.35rem;">
                                ${e.symbol}
                                <span style="font-size: 0.55rem; padding: 0.08rem 0.35rem; border-radius: 3px; font-weight: 800; background: ${e.tagBg}; color: ${e.tagColor};">${e.tag}</span>
                            </div>
                            ${scorePill}
                        </div>

                        <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.7rem; color: var(--text-muted);">
                            <span>Spot: <strong style="color: #f8fafc;">₹${e.spotCur ? e.spotCur.toLocaleString() : '---'}</strong></span>
                            <span style="color: ${e.spotDiff >= 0 ? '#10b981' : '#ef4444'}; font-weight:700;">${spotDiffStr} (${spotPctStr})</span>
                        </div>

                        <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.7rem; color: var(--text-muted); margin-top: 0.15rem;">
                            <span>PCR: <strong style="color: #38bdf8;">${e.pcrCur.toFixed(4)}</strong></span>
                            <span style="color: ${e.pcrDiff >= 0 ? '#10b981' : '#ef4444'}; font-weight:700;">15m: ${pcrDiffStr}</span>
                        </div>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        });

        if (totalEvents === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding: 3rem 1rem; color: var(--text-muted); font-size: 0.85rem;">
                    <i class="fas fa-history" style="font-size: 1.8rem; margin-bottom: 0.5rem; opacity: 0.5;"></i><br>
                    No historical scan signals recorded for the selected filter yet.
                </div>
            `;
            return;
        }

        container.innerHTML = html;
    },

    phoneAlertsEnabled: localStorage.getItem('destrade_phone_alerts') === 'true',
    alertCooldowns: {},

    getLocalNotificationsPlugin() {
        if (window.Capacitor) {
            if (window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) {
                return window.Capacitor.Plugins.LocalNotifications;
            }
            if (typeof window.Capacitor.registerPlugin === 'function') {
                try {
                    const plugin = window.Capacitor.registerPlugin('LocalNotifications');
                    if (plugin) return plugin;
                } catch(e) {}
            }
        }
        return null;
    },

    async initAndroidNotificationChannel() {
        const LN = this.getLocalNotificationsPlugin();
        if (!LN || typeof LN.createChannel !== 'function') return;
        try {
            await LN.createChannel({
                id: 'destrade_high_alerts',
                name: 'Destrade Breakout Alerts',
                description: 'High priority notifications for 70+ Power Score stock breakouts',
                importance: 5, // MAX importance (makes sound, banner & vibration)
                visibility: 1, // PUBLIC
                sound: 'beep.wav',
                vibration: true,
                lights: true,
                lightColor: '#10b981'
            });
            console.log('✅ Android Notification Channel destrade_high_alerts initialized!');
        } catch(e) {
            console.warn('Channel creation error:', e);
        }
    },

    async togglePhoneAlerts() {
        if (!this.phoneAlertsEnabled) {
            const LN = this.getLocalNotificationsPlugin();
            let granted = false;

            if (LN && typeof LN.requestPermissions === 'function') {
                try {
                    const res = await LN.requestPermissions();
                    console.log('Capacitor LocalNotifications permission response:', res);
                    granted = (res && (res.display === 'granted' || res.receive === 'granted'));
                } catch(e) {
                    console.warn('LocalNotifications permission request failed:', e);
                }
            }

            if (!granted && 'Notification' in window) {
                try {
                    const res = await Notification.requestPermission();
                    granted = (res === 'granted');
                } catch(e) {}
            }

            await this.initAndroidNotificationChannel();

            this.phoneAlertsEnabled = true;
            localStorage.setItem('destrade_phone_alerts', 'true');
            this.showToast('🔔 Phone Alerts Enabled for Power Scores > 70!');

            // Send test welcome notification
            await this.sendPhoneNotification('⚡ Destrade Phone Alerts Active!', 'You will receive instant phone notifications whenever any stock crosses 70+ Power Score!');
        } else {
            this.phoneAlertsEnabled = false;
            localStorage.setItem('destrade_phone_alerts', 'false');
            this.showToast('🔕 Phone Alerts Disabled');
        }
        this.updatePhoneAlertsButtonUI();
    },

    updatePhoneAlertsButtonUI() {
        const btn = document.getElementById('btn-toggle-phone-alerts');
        if (!btn) return;
        if (this.phoneAlertsEnabled) {
            btn.style.background = 'rgba(16, 185, 129, 0.2)';
            btn.style.border = '1px solid #10b981';
            btn.style.color = '#10b981';
            btn.innerHTML = '<i class="fas fa-bell"></i> 🔔 Alerts ON (>70 Score)';
        } else {
            btn.style.background = 'rgba(245, 158, 11, 0.15)';
            btn.style.border = '1px solid rgba(245, 158, 11, 0.4)';
            btn.style.color = '#f59e0b';
            btn.innerHTML = '<i class="fas fa-bell"></i> 🔔 Phone Alerts (>70 Score)';
        }
    },

    async sendPhoneNotification(title, body) {
        // 1. Web Audio Beep Tone Alert
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.35);
        } catch(e) {}

        // 2. Native Capacitor Android Notification
        const LN = this.getLocalNotificationsPlugin();
        if (LN && typeof LN.schedule === 'function') {
            try {
                await this.initAndroidNotificationChannel();

                const notifId = Math.floor(Math.random() * 900000) + 100000;
                const notifObj = {
                    notifications: [{
                        title: title,
                        body: body,
                        id: notifId,
                        schedule: { at: new Date(Date.now() + 100) },
                        channelId: 'destrade_high_alerts',
                        sound: null,
                        attachments: null,
                        actionTypeId: '',
                        extra: null
                    }]
                };

                const res = await LN.schedule(notifObj);
                console.log('✅ Android Capacitor LocalNotification Scheduled:', res);
                return;
            } catch(e) {
                console.warn('Capacitor local notification schedule failed:', e);
            }
        }

        // 3. Web Browser System Notification
        if ('Notification' in window && Notification.permission === 'granted') {
            try {
                new Notification(title, {
                    body: body,
                    icon: 'https://destrade-default-rtdb.firebaseio.com/favicon.ico'
                });
            } catch(e) {}
        }
    },

    checkAndTriggerHighPowerAlert(item) {
        if (!this.phoneAlertsEnabled || item.powerScore < 70) return;

        const now = Date.now();
        const lastSent = this.alertCooldowns[item.symbol] || 0;
        // 15-minute cooldown per symbol
        if (now - lastSent < 15 * 60 * 1000) return;

        this.alertCooldowns[item.symbol] = now;

        const isBull = item.tag.includes('SURGE') || item.spotDiff >= 0;
        const emoji = isBull ? '🚀' : '📉';
        const spotPctStr = (item.spotPct > 0 ? '+' : '') + item.spotPct.toFixed(2) + '%';
        const pcrDiffStr = (item.pcrDiff > 0 ? '+' : '') + item.pcrDiff.toFixed(4);

        const title = `${emoji} ${item.symbol} (${item.powerScore}/100 Power Score)`;
        const body = `Spot: ₹${item.spotCur ? item.spotCur.toLocaleString() : '---'} (${spotPctStr}) | PCR: ${pcrDiffStr}. ${item.tag}!`;

        this.sendPhoneNotification(title, body);
    },

    // ===== INTRADAY PCR & PRICE MOMENTUM RADAR (Dashboard) =====
    renderPcrIntradayScreener() {
        const container = document.getElementById('pcr-intraday-screener-content');
        if (!container) return;

        const pcrHist = this.state.pcrHistory || {};
        const symbols = Object.keys(pcrHist);

        const bullList = [];
        const bearList = [];

        symbols.forEach(sym => {
            const rawList = pcrHist[sym];
            if (!Array.isArray(rawList) || rawList.length < 2) return;

            const cleanList = this.sanitize5MinPcrList(rawList);
            if (cleanList.length < 2) return;

            const latest = cleanList[cleanList.length - 1];
            const tick15m = cleanList[Math.max(0, cleanList.length - 4)];

            const pcrCur = latest.value;
            const pcrPrev = tick15m.value;
            const pcrDiff = pcrCur - pcrPrev;
            const pcrPct = pcrPrev > 0 ? ((pcrDiff / pcrPrev) * 100) : 0;

            const spotCur = latest.spot || 0;
            const spotPrev = tick15m.spot || 0;
            const spotDiff = (spotCur && spotPrev) ? (spotCur - spotPrev) : 0;
            const spotPct = spotPrev > 0 ? ((spotDiff / spotPrev) * 100) : 0;

            // Compute All-Day Average 5-Min Tick Shifts for this symbol
            let sumPcrDiff = 0, sumSpotDiff = 0, cnt = 0;
            for (let k = 1; k < cleanList.length; k++) {
                sumPcrDiff += Math.abs(cleanList[k].value - cleanList[k-1].value);
                sumSpotDiff += Math.abs((cleanList[k].spot || 0) - (cleanList[k-1].spot || 0));
                cnt++;
            }
            const avgPcrDiff = cnt > 0 ? (sumPcrDiff / cnt) : 0.001;
            const avgSpotDiff = cnt > 0 ? (sumSpotDiff / cnt) : 1.0;

            const tickPrev = cleanList[cleanList.length - 2] || tick15m;
            const singlePcrDiff = pcrCur - tickPrev.value;
            const singleSpotDiff = (spotCur && tickPrev.spot) ? (spotCur - tickPrev.spot) : 0;

            const pcrMultiplier = avgPcrDiff > 0 ? (Math.abs(singlePcrDiff) / avgPcrDiff) : 0;
            const spotMultiplier = avgSpotDiff > 0 ? (Math.abs(singleSpotDiff) / avgSpotDiff) : 0;
            const avgMultiplier = (pcrMultiplier + spotMultiplier) / 2;

            const absSpotPct = Math.abs(spotPct);
            const absPcrPct = Math.abs(pcrPct);
            const harmonicPct = Math.sqrt(absSpotPct * absPcrPct);

            let powerScore = Math.round(45 + (harmonicPct * 22) + (avgMultiplier * 4));
            powerScore = Math.min(99, Math.max(50, powerScore));

            // 1. Strict Dual Trend Alignment Guard:
            // Single tick movement AND 15-minute trend MUST move in the exact same direction!
            const isBullishAligned = (singleSpotDiff > 0 && spotDiff > 0) && (singlePcrDiff > 0 && pcrDiff > 0);
            const isBearishAligned = (singleSpotDiff < 0 && spotDiff < 0) && (singlePcrDiff < 0 && pcrDiff < 0);

            if (!isBullishAligned && !isBearishAligned) return; // REMOVE ALL PCR-ONLY OR PRICE-ONLY NOISE!

            // 2. Minimum Volatility Floor
            const isSignificantPcr = Math.abs(pcrPct) >= 0.5 || Math.abs(pcrDiff) >= 0.002;
            const isSignificantSpot = Math.abs(spotPct) >= 0.10;
            if (!isSignificantPcr || !isSignificantSpot) return;

            if (isBullishAligned) {
                const item = {
                    symbol: sym,
                    pcrCur,
                    pcrDiff,
                    pcrPct,
                    spotCur,
                    spotDiff,
                    spotPct,
                    powerScore,
                    tag: '🚀 PURE DUAL SURGE',
                    tagBg: 'rgba(16, 185, 129, 0.25)',
                    tagColor: '#10b981',
                    timeStr: latest.timeStr || ''
                };
                bullList.push(item);
                this.checkAndTriggerHighPowerAlert(item);
            }

            if (isBearishAligned) {
                const item = {
                    symbol: sym,
                    pcrCur,
                    pcrDiff,
                    pcrPct,
                    spotCur,
                    spotDiff,
                    spotPct,
                    powerScore,
                    tag: '📉 PURE DUAL CRASH',
                    tagBg: 'rgba(239, 68, 68, 0.25)',
                    tagColor: '#ef4444',
                    timeStr: latest.timeStr || ''
                };
                bearList.push(item);
                this.checkAndTriggerHighPowerAlert(item);
            }
        });

        bullList.sort((a, b) => b.powerScore - a.powerScore);
        bearList.sort((a, b) => b.powerScore - a.powerScore);

        const topBull = bullList.slice(0, 5);
        const topBear = bearList.slice(0, 5);

        if (topBull.length === 0 && topBear.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding: 2rem; color: var(--text-muted); font-size: 0.85rem;">
                    <i class="fas fa-bolt" style="font-size: 1.5rem; color: #f59e0b; margin-bottom: 0.5rem;"></i><br>
                    Scanning live 5-minute ticks for Pure Dual Action (PCR & Price synchronized breakouts)...
                </div>
            `;
            return;
        }

        const renderRows = (list, isBull) => {
            if (list.length === 0) return `<div style="text-align:center; padding:1.5rem; color:var(--text-muted); font-size:0.78rem;">No live ${isBull ? 'bullish dual surges' : 'bearish dual crashes'} active in current tick window.</div>`;

            return list.map((item, idx) => {
                const pcrDiffStr = (item.pcrDiff > 0 ? '+' : '') + item.pcrDiff.toFixed(4);
                const spotDiffStr = (item.spotDiff > 0 ? '+' : '') + item.spotDiff.toFixed(2);
                const spotPctStr = (item.spotPct > 0 ? '+' : '') + item.spotPct.toFixed(2) + '%';

                return `
                    <div class="radar-row" onclick="App.switchView('pcr-analytics'); App.changePcrSymbol('${item.symbol}');"
                         style="display: flex; align-items: center; justify-content: space-between; background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 0.6rem 0.85rem; cursor: pointer; transition: all 0.18s;"
                         onmouseover="this.style.borderColor='${isBull ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)'}'; this.style.transform='translateX(${isBull ? '3px' : '-3px'})';"
                         onmouseout="this.style.borderColor='rgba(255,255,255,0.06)'; this.style.transform='none';">
                        
                        <div style="display: flex; align-items: center; gap: 0.6rem;">
                            <div style="width: 22px; height: 22px; border-radius: 50%; background: ${isBull ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}; color: ${isBull ? '#10b981' : '#ef4444'}; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.72rem;">
                                #${idx + 1}
                            </div>
                            <div>
                                <div style="font-weight: 700; color: #f8fafc; font-size: 0.88rem; display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
                                    ${item.symbol}
                                    <span style="font-size: 0.58rem; padding: 0.1rem 0.35rem; border-radius: 3px; font-weight: 800; background: ${item.tagBg}; color: ${item.tagColor}; border: 1px solid ${item.tagColor}40;">
                                        ${item.tag}
                                    </span>
                                </div>
                                <div style="font-size: 0.7rem; color: var(--text-muted);">
                                    Spot: <strong style="color: #f8fafc;">₹${item.spotCur ? item.spotCur.toLocaleString() : '---'}</strong> <span style="color: ${item.spotDiff >= 0 ? '#10b981' : '#ef4444'}; font-weight:700;">(${spotDiffStr} | ${spotPctStr})</span>
                                </div>
                            </div>
                        </div>

                        <div style="text-align: right;">
                            <span style="font-family:'JetBrains Mono',monospace; font-weight:800; font-size:0.82rem; color:${item.tagColor}; background:${item.tagBg}; padding:0.2rem 0.55rem; border-radius:6px; border:1px solid ${item.tagColor}50;">
                                ${item.powerScore}<span style="font-size:0.65rem; opacity:0.75;">/100</span>
                            </span>
                        </div>
                    </div>
                `;
            }).join('');
        };

        container.innerHTML = `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(310px, 1fr)); gap: 1rem;">
                <!-- Left: Live Bullish Dual Surges -->
                <div style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 10px; padding: 0.85rem 1rem;">
                    <div style="font-weight: 700; color: #10b981; font-size: 0.88rem; margin-bottom: 0.75rem; display: flex; align-items: center; justify-content: space-between;">
                        <span><i class="fas fa-arrow-trend-up"></i> 🟢 Live Bullish Dual Surges</span>
                        <span style="font-size: 0.65rem; padding: 0.15rem 0.4rem; background: rgba(16, 185, 129, 0.15); border-radius: 4px; color: #10b981; font-weight:800;">DUAL ACTION MODE</span>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                        ${renderRows(topBull, true)}
                    </div>
                </div>

                <!-- Right: Live Bearish Dual Crashes -->
                <div style="background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 10px; padding: 0.85rem 1rem;">
                    <div style="font-weight: 700; color: #ef4444; font-size: 0.88rem; margin-bottom: 0.75rem; display: flex; align-items: center; justify-content: space-between;">
                        <span><i class="fas fa-arrow-trend-down"></i> 🔴 Live Bearish Dual Crashes</span>
                        <span style="font-size: 0.65rem; padding: 0.15rem 0.4rem; background: rgba(239, 68, 68, 0.15); border-radius: 4px; color: #ef4444; font-weight:800;">DUAL ACTION MODE</span>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                        ${renderRows(topBear, false)}
                    </div>
                </div>
            </div>
        `;
    },

    // ===== FULL-SCREEN PCR ANALYTICS & OI TREND WORKSPACE =====
    statePcrMode: 'pcr',

    setPcrChartMode(mode) {
        this.statePcrMode = mode || 'pcr';
        const radios = document.querySelectorAll('input[name="pcr-mode-radio"]');
        radios.forEach(r => {
            r.checked = (r.value === this.statePcrMode);
            if (r.parentElement) {
                r.parentElement.style.color = r.checked ? '#ffffff' : '#94a3b8';
            }
        });
        const sym = this.state.pcrAnalyticsSymbol || this.state.activeSymbol || 'NIFTY';
        this.renderPcrAnalyticsChartCanvas(sym);
    },

    changePcrSymbol(symbol) {
        if (!symbol) return;
        const cleanSym = symbol.replace('NIFTY 50', 'NIFTY').replace('NIFTY BANK', 'BANKNIFTY').toUpperCase();
        this.state.pcrAnalyticsSymbol = cleanSym;

        // Immediately update search input placeholder
        const input = document.getElementById('pcr-symbol-search');
        if (input) {
            input.value = '';
            input.placeholder = `Search symbol (${cleanSym})...`;
        }

        // Instantly show loading indicator in canvas and snapshot table
        const canvasContainer = document.getElementById('pcr-analytics-chart-canvas');
        if (canvasContainer) {
            canvasContainer.innerHTML = `<div style="text-align:center; padding: 4rem; color: #38bdf8; font-size: 0.9rem; font-weight: 700;"><i class="fas fa-spinner fa-spin"></i> Loading ${cleanSym} PCR Chart...</div>`;
        }
        const tableContainer = document.getElementById('pcr-snapshots-table-container');
        if (tableContainer) {
            tableContainer.innerHTML = `<div style="text-align:center; padding: 2rem; color: var(--text-muted); font-size: 0.85rem;"><i class="fas fa-spinner fa-spin"></i> Loading ${cleanSym} PCR intraday snapshots...</div>`;
        }

        this.renderPcrAnalyticsView(cleanSym);
    },

    refreshPcrAnalytics() {
        const sym = this.state.pcrAnalyticsSymbol || this.state.activeSymbol || 'NIFTY';
        this.renderPcrAnalyticsView(sym);
    },

    // ===== PCR SYMBOL AUTO-SUGGEST SEARCH ENGINE =====
    statePcrSuggestIdx: -1,

    getPcrSymbolList() {
        const indices = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
        let stocks = [];
        const growwMap = (window.nseApi && typeof window.nseApi.getGrowwMap === 'function') ? window.nseApi.getGrowwMap() : (window.nseApi ? window.nseApi._growwMap : null);
        if (growwMap && Object.keys(growwMap).length > 0) {
            stocks = Object.keys(growwMap).filter(s => !indices.includes(s)).sort();
        } else {
            stocks = [
                '360ONE', 'ABB', 'ABCAPITAL', 'ADANIENSOL', 'ADANIENT', 'ADANIGREEN', 'ADANIPORTS', 'ADANIPOWER',
                'ALKEM', 'AMBER', 'AMBUJACEM', 'ANGELONE', 'APLAPOLLO', 'APOLLOHOSP', 'ASHOKLEY', 'ASIANPAINT',
                'ASTRAL', 'AUBANK', 'AUROPHARMA', 'AXISBANK', 'BAJAJ-AUTO', 'BAJAJFINSV', 'BAJAJHLDNG', 'BAJFINANCE',
                'BANDHANBNK', 'BANKBARODA', 'BANKINDIA', 'BDL', 'BEL', 'BHARATFORG', 'BHARTIARTL', 'BHEL',
                'BIOCON', 'BLUESTARCO', 'BOSCHLTD', 'BPCL', 'BRITANNIA', 'BSE', 'CAMS', 'CANBK',
                'CDSL', 'CGPOWER', 'CHOLAFIN', 'CIPLA', 'COALINDIA', 'COCHINSHIP', 'COFORGE', 'COLPAL',
                'CONCOR', 'CROMPTON', 'CUMMINSIND', 'DABUR', 'DALBHARAT', 'DELHIVERY', 'DIVISLAB', 'DIXON',
                'DLF', 'DMART', 'DRREDDY', 'EICHERMOT', 'ETERNAL', 'EXIDEIND', 'FEDERALBNK', 'FORCEMOT',
                'GAIL', 'GLENMARK', 'GODREJCP', 'GODREJPROP', 'GRANULES', 'GRASIM', 'GUJGASLTD', 'HAL',
                'HAVELLS', 'HCLTECH', 'HDFCAMC', 'HDFCBANK', 'HDFCLIFE', 'HEROMOTOCO', 'HINDALCO', 'HINDPETRO',
                'HINDUNILVR', 'HINDZINC', 'HUDCO', 'ICICIBANK', 'ICICIGI', 'ICICIPRULI', 'IDEA', 'IDFCFIRSTB',
                'IEX', 'IGL', 'INDHOTEL', 'INDIAMART', 'INDIANB', 'INDIGO', 'INDUSINDBK', 'INDUSTOWER',
                'INFY', 'INOXWIND', 'IOC', 'IPCALAB', 'IRCTC', 'IREDA', 'IRFC', 'ITC',
                'JINDALSTEL', 'JIOFIN', 'JSWENERGY', 'JSWSTEEL', 'JUBLFOOD', 'KALYANKJIL', 'KAYNES', 'KEI',
                'KFINTECH', 'KOTAKBANK', 'KPITTECH', 'LAURUSLABS', 'LICHSGFIN', 'LODHA', 'LT', 'LTF',
                'LTIM', 'LUPIN', 'M&M', 'M&MFIN', 'MANAPPURAM', 'MANKIND', 'MARICO', 'MARUTI',
                'MAXHEALTH', 'MAZDOCK', 'MCX', 'MFSL', 'MGL', 'MOTILALOFS', 'MPHASIS', 'MRF',
                'MUTHOOTFIN', 'NAM-INDIA', 'NAUKRI', 'NAVINFLUOR', 'NESTLEIND', 'NHPC', 'NMDC', 'NTPC',
                'NUVAMA', 'OBEROIRLTY', 'OFSS', 'OIL', 'ONGC', 'PAGEIND', 'PATANJALI', 'PERSISTENT',
                'PETRONET', 'PFC', 'PHOENIXLTD', 'PIDILITIND', 'PIIND', 'PNB', 'PNBHOUSING', 'POLYCAB',
                'POWERGRID', 'POWERINDIA', 'PPLPHARMA', 'PREMIERENE', 'PRESTIGE', 'RBLBANK', 'RECLTD', 'RELIANCE',
                'RVNL', 'SAIL', 'SAMMAANCAP', 'SBICARD', 'SBILIFE', 'SBIN', 'SHREECEM', 'SHRIRAMFIN',
                'SIEMENS', 'SONACOMS', 'SRF', 'SUNPHARMA', 'SUPREMEIND', 'SWIGGY', 'SYNGENE', 'TATACONSUM',
                'TATAELXSI', 'TATAMOTORS', 'TATAPOWER', 'TATASTEEL', 'TATATECH', 'TCS', 'TECHM', 'TIINDIA',
                'TITAN', 'TMPV', 'TORNTPHARM', 'TORNTPOWER', 'TRENT', 'TVSMOTOR', 'ULTRACEMCO', 'UNIONBANK',
                'UNITDSPR', 'UNOMINDA', 'UPL', 'VBL', 'VEDL', 'VOLTAS', 'WAAREEENER', 'WIPRO',
                'YESBANK', 'ZYDUSLIFE'
            ];
        }
        return [...indices, ...stocks];
    },

    findClosestPcrSymbol(query) {
        if (!query || typeof query !== 'string') return 'NIFTY';
        const q = query.trim().toUpperCase();
        if (!q) return 'NIFTY';

        const all = this.getPcrSymbolList();

        // 1. Exact match
        if (all.includes(q)) return q;

        // 2. Starts-with prefix match
        const prefix = all.find(s => s.startsWith(q));
        if (prefix) return prefix;

        // 3. Contains substring match
        const contains = all.find(s => s.includes(q));
        if (contains) return contains;

        // 4. Fallback to NIFTY
        return all[0] || 'NIFTY';
    },

    onPcrSearchFocus() {
        const input = document.getElementById('pcr-symbol-search');
        if (input) {
            this.renderPcrSearchSuggestions(input.value || '');
        }
    },

    onPcrSearchInput(val) {
        this.renderPcrSearchSuggestions(val);
    },

    renderPcrSearchSuggestions(query) {
        const popup = document.getElementById('pcr-symbol-suggestions');
        if (!popup) return;

        const q = (query || '').trim().toUpperCase();
        const all = this.getPcrSymbolList();
        const indices = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];

        let matches = [];
        if (!q) {
            matches = all.slice(0, 15);
        } else {
            const prefixMatches = all.filter(s => s.startsWith(q));
            const containsMatches = all.filter(s => !s.startsWith(q) && s.includes(q));
            matches = [...prefixMatches, ...containsMatches].slice(0, 20);
        }

        if (matches.length === 0) {
            popup.style.display = 'none';
            return;
        }

        this.statePcrSuggestIdx = -1;

        popup.innerHTML = matches.map((sym, idx) => {
            const isIdx = indices.includes(sym);
            const label = sym === 'NIFTY' ? 'NIFTY 50' : sym;
            return `
                <div class="pcr-suggest-item" data-idx="${idx}" data-sym="${sym}"
                     onclick="App.selectPcrSearchSymbol('${sym}')"
                     style="padding: 0.55rem 0.85rem; display: flex; align-items: center; justify-content: space-between; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.06); color: #f8fafc; font-weight: 600; font-size: 0.85rem; transition: background 0.15s;">
                    <span>${label}</span>
                    <span style="font-size: 0.65rem; padding: 0.1rem 0.4rem; border-radius: 4px; font-weight: 700; background: ${isIdx ? 'rgba(56, 189, 248, 0.2)' : 'rgba(148, 163, 184, 0.15)'}; color: ${isIdx ? '#38bdf8' : '#94a3b8'};">
                        ${isIdx ? 'INDEX' : 'STOCK'}
                    </span>
                </div>
            `;
        }).join('');

        popup.style.display = 'block';
    },

    onPcrSearchKeyDown(e) {
        const popup = document.getElementById('pcr-symbol-suggestions');
        const items = popup ? popup.querySelectorAll('.pcr-suggest-item') : [];
        const input = document.getElementById('pcr-symbol-search');
        if (!input) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (items.length > 0) {
                this.statePcrSuggestIdx = (this.statePcrSuggestIdx + 1) % items.length;
                this.updatePcrSuggestHighlight(items);
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (items.length > 0) {
                this.statePcrSuggestIdx = (this.statePcrSuggestIdx - 1 + items.length) % items.length;
                this.updatePcrSuggestHighlight(items);
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (this.statePcrSuggestIdx >= 0 && items[this.statePcrSuggestIdx]) {
                const sym = items[this.statePcrSuggestIdx].getAttribute('data-sym');
                this.selectPcrSearchSymbol(sym);
            } else {
                const closest = this.findClosestPcrSymbol(input.value);
                this.selectPcrSearchSymbol(closest);
            }
        } else if (e.key === 'Escape') {
            if (popup) popup.style.display = 'none';
        }
    },

    updatePcrSuggestHighlight(items) {
        items.forEach((item, i) => {
            if (i === this.statePcrSuggestIdx) {
                item.style.background = 'rgba(56, 189, 248, 0.25)';
                item.style.color = '#ffffff';
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.style.background = 'transparent';
                item.style.color = '#f8fafc';
            }
        });
    },

    selectPcrSearchSymbol(symbol) {
        if (!symbol) return;
        const cleanSym = symbol.replace('NIFTY 50', 'NIFTY').replace('NIFTY BANK', 'BANKNIFTY').toUpperCase();
        const input = document.getElementById('pcr-symbol-search');
        if (input) {
            input.value = '';
            input.placeholder = `Search symbol (${cleanSym})...`;
        }

        const popup = document.getElementById('pcr-symbol-suggestions');
        if (popup) popup.style.display = 'none';

        this.changePcrSymbol(cleanSym);
    },

    async renderPcrAnalyticsView(symbolInput) {
        const rawSym = symbolInput || this.state.pcrAnalyticsSymbol || this.state.activeSymbol || 'NIFTY';
        const cleanSym = rawSym.replace('NIFTY 50', 'NIFTY').replace('NIFTY BANK', 'BANKNIFTY').toUpperCase();
        this.state.pcrAnalyticsSymbol = cleanSym;

        // Clear input value and set active symbol placeholder
        const input = document.getElementById('pcr-symbol-search');
        if (input) {
            input.value = '';
            input.placeholder = `Search symbol (${cleanSym})...`;
        }

        // Initialize Firebase Time Engine for live streaming
        this.initFirebaseTimeEngine(cleanSym);

        // Fetch live top PCR & Option Chain summary
        const topData = (window.nseApi && typeof window.nseApi.getTopPCR === 'function') ? await window.nseApi.getTopPCR(cleanSym) : null;

        // Race condition guard: exit if user switched symbols while fetching top PCR
        if (cleanSym !== this.state.pcrAnalyticsSymbol) return;

        // Lot Size Dictionary
        const LOT_SIZES = {
            'NIFTY': 75, 'BANKNIFTY': 30, 'FINNIFTY': 65, 'MIDCPNIFTY': 120,
            'RELIANCE': 250, 'TCS': 175, 'HDFCBANK': 550, 'INFY': 400,
            'ICICIBANK': 700, 'SBIN': 1500, 'BHARTIARTL': 475, 'ITC': 1600,
            'LT': 300, 'AXISBANK': 625, 'BAJFINANCE': 125, 'SWIGGY': 1700,
            'POWERINDIA': 25, 'CONCOR': 1250, 'HUDCO': 3500, 'NUVAMA': 150,
            'PPLPHARMA': 3200, 'TATATECH': 600, 'TORNTPOWER': 750, 'SAMMAANCAP': 4000
        };

        const lotSize = LOT_SIZES[cleanSym] || '--';
        // Force fresh load from Firebase if local cache has fewer than 20 ticks
        if (this.state.pcrHistory && this.state.pcrHistory[cleanSym] && this.state.pcrHistory[cleanSym].length < 20) {
            delete this.state.pcrHistory[cleanSym];
        }

        // Ensure intraday history is prefilled from Firebase
        await this.prefillIntradayPcrHistory(cleanSym);

        // Race condition guard: exit if user switched symbols while prefilling history
        if (cleanSym !== this.state.pcrAnalyticsSymbol) return;

        const currentHistory = this.state.pcrHistory[cleanSym] || [];
        const lastTick = currentHistory[currentHistory.length - 1];
        const spotPrice = (topData && topData.spot) ? topData.spot : (lastTick ? lastTick.spot : 0);

        let maxPain = '--';
        if (topData && topData.maxPain) {
            maxPain = '₹' + topData.maxPain.toLocaleString();
        } else if (spotPrice > 0) {
            let step = 100;
            if (cleanSym.includes('NIFTY') && !cleanSym.includes('BANK')) step = 50;
            if (cleanSym.includes('BANKNIFTY')) step = 100;
            if (cleanSym.includes('FINNIFTY')) step = 50;
            if (spotPrice < 500) step = 5;
            else if (spotPrice < 1500) step = 10;
            else if (spotPrice < 3000) step = 20;
            else if (spotPrice < 10000) step = 50;
            const estStrike = Math.round(spotPrice / step) * step;
            maxPain = '₹' + estStrike.toLocaleString();
        }
        const pcrVal = (topData && topData.pcr) ? topData.pcr.toFixed(4) : '--';

        // Calculate CHG IN OI PCR estimate
        let chgPcrVal = '--';
        if (topData && topData.callOI > 0 && topData.putOI > 0) {
            chgPcrVal = (topData.putOI / topData.callOI).toFixed(4);
        }

        // Update Header Badges
        const elMaxPain = document.getElementById('pcr-m-maxpain');
        if (elMaxPain) elMaxPain.textContent = maxPain;

        const elLot = document.getElementById('pcr-m-lotsize');
        if (elLot) elLot.textContent = lotSize;

        const elPcr = document.getElementById('pcr-m-pcr');
        if (elPcr) elPcr.textContent = pcrVal;

        const elChgPcr = document.getElementById('pcr-m-chgpcr');
        if (elChgPcr) elChgPcr.textContent = chgPcrVal !== '--' ? chgPcrVal : pcrVal;

        // Record live PCR tick if valid
        if (topData && topData.pcr) {
            this.recordPcr(cleanSym, parseFloat(topData.pcr), parseFloat(topData.spot) || 0);
        }

        // Render full-screen chart canvas & snapshots table
        this.renderPcrAnalyticsChartCanvas(cleanSym);
        this.renderPcrSnapshotsTable(cleanSym);

        // Setup 15-second auto-refresh timer for PCR view
        if (this._pcrAutoRefreshTimer) clearInterval(this._pcrAutoRefreshTimer);
        this._pcrAutoRefreshTimer = setInterval(() => {
            if (this.state.activeView === 'pcr-analytics' && !this._stopPolling && this.state.pcrAnalyticsSymbol === cleanSym) {
                this.renderPcrAnalyticsView(cleanSym);
            }
        }, 15000);
    },

    renderPcrAnalyticsChartCanvas(targetSymbol) {
        const container = document.getElementById('pcr-analytics-chart-canvas');
        if (!container) return;

        const sym = (targetSymbol || this.state.pcrAnalyticsSymbol || this.state.activeSymbol || 'NIFTY').replace('NIFTY 50', 'NIFTY').replace('NIFTY BANK', 'BANKNIFTY').toUpperCase();

        // Strict guard: NEVER render if sym does not match the active pcrAnalyticsSymbol workspace
        if (this.state.pcrAnalyticsSymbol && sym !== this.state.pcrAnalyticsSymbol) return;

        let rawList = [];
        if (this.state.pcrHistory && typeof this.state.pcrHistory === 'object' && !Array.isArray(this.state.pcrHistory)) {
            rawList = this.state.pcrHistory[sym] || [];
        }

        let data = this.sanitize5MinPcrList(rawList);
        this.state.pcrHistory[sym] = data;

        if (!data || data.length < 1) {
            container.innerHTML = `<div style="color:var(--text-muted);font-size:0.95rem;text-align:center;padding-top:120px"><i class="fas fa-satellite-dish fa-spin" style="font-size:2rem;color:var(--primary);margin-bottom:1rem"></i><br>Connecting to live multi-device market stream for ${sym}...</div>`;
            return;
        }

        const mode = this.statePcrMode || 'pcr';

        const dpr = window.devicePixelRatio || 1;
        const width = container.clientWidth || 800;
        const height = container.clientHeight || 480;
        container.innerHTML = `<canvas id="pcr-analytics-canvas" width="${Math.round(width * dpr)}" height="${Math.round(height * dpr)}" style="width:${width}px; height:${height}px; cursor:crosshair; touch-action:none"></canvas>`;
        const canvas = document.getElementById('pcr-analytics-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        const values = data.map((d, idx) => {
            if (mode === 'chg_pcr' && idx > 0) {
                const prev = data[idx - 1].value;
                return parseFloat((d.value - prev + 1.0).toFixed(4));
            }
            return d.value;
        });

        const rawMin = Math.min(...values);
        const rawMax = Math.max(...values);
        const padding = Math.max(0.03, (rawMax - rawMin) * 0.18);
        const minVal = Math.max(0.05, rawMin - padding);
        const maxVal = (rawMax === rawMin) ? (rawMax + 0.1) : (rawMax + padding);

        const spots = data.map(d => parseFloat(d.spot) || 0).filter(s => s > 0);
        const hasSpot = spots.length > 1;
        const spotMin = hasSpot ? Math.min(...spots) * 0.998 : 0;
        const spotMax = hasSpot ? Math.max(...spots) * 1.002 : 1;

        const isMobile = width < 600;
        const paddingLeft = isMobile ? 42 : 52;
        const paddingRight = isMobile ? (hasSpot ? 62 : 44) : (hasSpot ? 72 : 54);
        const paddingTop = isMobile ? 22 : 28;
        const paddingBottom = isMobile ? 42 : 42;
        const chartW = width - paddingLeft - paddingRight;
        const chartH = height - paddingTop - paddingBottom;

        const pts = data.map((d, i) => {
            const val = values[i];
            const x = (data.length === 1) ? (paddingLeft + chartW / 2) : (paddingLeft + (i / (data.length - 1)) * chartW);
            const y = paddingTop + chartH * (1 - (val - minVal) / (maxVal - minVal || 1));
            const spotY = hasSpot ? paddingTop + chartH * (1 - ((parseFloat(d.spot) || 0) - spotMin) / ((spotMax - spotMin) || 1)) : 0;
            return { x, y, spotY, val, pcrRaw: d.value, spot: parseFloat(d.spot) || 0, timeStr: d.timeStr || '--' };
        });

        let hoverIdx = null;

        const drawChart = () => {
            ctx.clearRect(0, 0, width, height);

            // 1. Gridlines & Y-Axes
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
            ctx.lineWidth = 1;
            ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
            ctx.font = isMobile ? '600 10px JetBrains Mono, monospace' : '600 11px JetBrains Mono, monospace';
            ctx.textAlign = 'right';

            const gridSteps = 5;
            for (let g = 0; g <= gridSteps; g++) {
                const ratio = g / gridSteps;
                const y = paddingTop + chartH * (1 - ratio);
                const val = (minVal + ratio * (maxVal - minVal)).toFixed(3);

                ctx.beginPath();
                ctx.moveTo(paddingLeft, y);
                ctx.lineTo(width - paddingRight, y);
                ctx.stroke();

                // Left Y-Axis: PCR Value (NiftyTrader Blue)
                ctx.fillStyle = '#38bdf8';
                ctx.fillText(val, paddingLeft - 5, y + 3);

                // Right Y-Axis: Spot Price (NiftyTrader Red)
                if (hasSpot) {
                    const spotVal = (spotMin + ratio * (spotMax - spotMin)).toFixed(1);
                    ctx.textAlign = 'left';
                    ctx.fillStyle = '#ef4444';
                    ctx.fillText('₹' + spotVal, width - paddingRight + 5, y + 3);
                    ctx.textAlign = 'right';
                }
            }

            // 1.5 X-Axis Bottom Time Labels (Clean, widely-spaced 09:15, 11:30, 13:45, 15:30)
            if (pts.length > 3) {
                ctx.font = isMobile ? '600 10px JetBrains Mono, monospace' : '600 11px JetBrains Mono, monospace';
                ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
                ctx.textAlign = 'center';

                const maxLabels = isMobile ? 3 : 5;
                for (let k = 0; k <= maxLabels; k++) {
                    const pIdx = Math.min(pts.length - 1, Math.round((k / maxLabels) * (pts.length - 1)));
                    const pt = pts[pIdx];
                    if (pt && pt.timeStr) {
                        const cleanT = pt.timeStr.replace(/\s*(AM|PM)/i, '').trim();
                        ctx.fillText(cleanT, pt.x, height - paddingBottom + 16);
                    }
                }
            }

            // 2. Draw Spot Price Curve (NiftyTrader Vibrant Red Curve)
            if (hasSpot && pts.length > 1) {
                ctx.beginPath();
                ctx.strokeStyle = '#ef4444';
                ctx.lineWidth = 2.2;
                ctx.moveTo(pts[0].x, pts[0].spotY);
                for (let i = 0; i < pts.length - 1; i++) {
                    const xc = (pts[i].x + pts[i + 1].x) / 2;
                    const yc = (pts[i].spotY + pts[i + 1].spotY) / 2;
                    ctx.quadraticCurveTo(pts[i].x, pts[i].spotY, xc, yc);
                }
                ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].spotY);
                ctx.stroke();
            }

            // 3. Draw PCR Translucent Soft Blue Gradient Fill (NiftyTrader Area Chart Style)
            const grad = ctx.createLinearGradient(0, paddingTop, 0, height - paddingBottom);
            grad.addColorStop(0, 'rgba(56, 189, 248, 0.25)');
            grad.addColorStop(1, 'rgba(56, 189, 248, 0.01)');

            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 0; i < pts.length - 1; i++) {
                const xc = (pts[i].x + pts[i + 1].x) / 2;
                const yc = (pts[i].y + pts[i + 1].y) / 2;
                ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
            }
            ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
            ctx.lineTo(pts[pts.length - 1].x, height - paddingBottom);
            ctx.lineTo(pts[0].x, height - paddingBottom);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();

            // 4. Draw PCR Line (NiftyTrader Bright Blue)
            ctx.beginPath();
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = '#38bdf8';
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 0; i < pts.length - 1; i++) {
                const xc = (pts[i].x + pts[i + 1].x) / 2;
                const yc = (pts[i].y + pts[i + 1].y) / 2;
                ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
            }
            ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
            ctx.stroke();

            // 5. Bottom Legend
            ctx.font = isMobile ? 'bold 10px Inter, sans-serif' : 'bold 11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#38bdf8';
            ctx.fillText('— PCR Trend', width / 2 - (isMobile ? 45 : 65), height - 8);
            if (hasSpot) {
                ctx.fillStyle = '#ef4444';
                ctx.fillText('— Spot Price', width / 2 + (isMobile ? 45 : 65), height - 8);
            }

            // 6. Interactive Crosshair & Floating Tooltip
            if (hoverIdx !== null && pts[hoverIdx]) {
                const hp = pts[hoverIdx];

                // Vertical Crosshair Line
                ctx.beginPath();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                ctx.moveTo(hp.x, paddingTop);
                ctx.lineTo(hp.x, height - paddingBottom);
                ctx.stroke();
                ctx.setLineDash([]);

                // PCR Dot
                ctx.beginPath();
                ctx.arc(hp.x, hp.y, 6, 0, Math.PI * 2);
                ctx.fillStyle = '#38bdf8';
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();

                // Spot Dot
                if (hasSpot) {
                    ctx.beginPath();
                    ctx.arc(hp.x, hp.spotY, 5, 0, Math.PI * 2);
                    ctx.fillStyle = '#ef4444';
                    ctx.fill();
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                }

                // Floating Tooltip Box
                const tipText = `Time: ${hp.timeStr} | PCR: ${hp.pcrRaw.toFixed(4)}${hp.spot ? ` | Spot: ₹${hp.spot.toLocaleString()}` : ''}`;
                ctx.font = '600 12px JetBrains Mono, monospace';
                const textW = ctx.measureText(tipText).width + 20;
                let tipX = hp.x - textW / 2;
                if (tipX < paddingLeft) tipX = paddingLeft;
                if (tipX + textW > width - paddingRight) tipX = width - paddingRight - textW;

                const tipY = paddingTop + 10;

                ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
                ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                if (typeof ctx.roundRect === 'function') ctx.roundRect(tipX, tipY, textW, 28, 6);
                else ctx.rect(tipX, tipY, textW, 28);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = '#f8fafc';
                ctx.textAlign = 'left';
                ctx.fillText(tipText, tipX + 10, tipY + 18);
            }
        };

        const updateHover = (e) => {
            const rect = canvas.getBoundingClientRect();
            const clientX = e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX);
            if (!clientX) return;
            const mouseX = clientX - rect.left;
            if (mouseX >= paddingLeft && mouseX <= width - paddingRight) {
                const ratio = (mouseX - paddingLeft) / chartW;
                hoverIdx = Math.min(pts.length - 1, Math.max(0, Math.round(ratio * (pts.length - 1))));
            } else {
                hoverIdx = null;
            }
            drawChart();
        };

        canvas.onmousemove = updateHover;
        canvas.ontouchmove = updateHover;
        drawChart();
    },

    renderPcrSnapshotsTable(targetSymbol) {
        const container = document.getElementById('pcr-snapshots-table-container');
        if (!container) return;

        const sym = (targetSymbol || this.state.pcrAnalyticsSymbol || this.state.activeSymbol || 'NIFTY').replace('NIFTY 50', 'NIFTY').replace('NIFTY BANK', 'BANKNIFTY').toUpperCase();

        // Strict guard: NEVER render if sym does not match the active pcrAnalyticsSymbol workspace
        if (this.state.pcrAnalyticsSymbol && sym !== this.state.pcrAnalyticsSymbol) return;

        let rawList = [];
        if (this.state.pcrHistory && typeof this.state.pcrHistory === 'object' && !Array.isArray(this.state.pcrHistory)) {
            rawList = this.state.pcrHistory[sym] || [];
        }

        let data = this.sanitize5MinPcrList(rawList);
        if (!data || data.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding: 2rem; color: var(--text-muted); font-size: 0.85rem;"><i class="fas fa-spinner fa-spin"></i> Loading PCR intraday snapshots...</div>`;
            return;
        }

        // Calculate snapshot-to-snapshot changes (reverse order so newest is at the top)
        const reversed = [...data].reverse();
        
        let html = `
            <div class="card pcr-snapshots-card" style="margin-top: 1.2rem; border-radius: 12px; background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255,255,255,0.08); padding: 1rem 1.25rem;">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
                    <div style="font-weight: 700; color: #f8fafc; font-size: 0.95rem; display: flex; align-items: center; gap: 0.5rem;">
                        <i class="fas fa-list-ol" style="color:var(--primary);"></i>
                        Intraday PCR Snapshots History (${sym})
                        <span style="font-size:0.75rem; font-weight:600; color:var(--text-muted); padding:0.15rem 0.5rem; background:rgba(255,255,255,0.06); border-radius:4px;">${data.length} snapshots</span>
                    </div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">
                        <i class="fas fa-arrow-up" style="color:#10b981;"></i> Increasing PCR = Bullish | <i class="fas fa-arrow-down" style="color:#ef4444;"></i> Decreasing PCR = Bearish
                    </div>
                </div>

                <div class="table-responsive" style="max-height: 380px; overflow-y: auto;">
                    <table class="table pcr-snapshot-table" style="width:100%; border-collapse:collapse; font-size: 0.82rem;">
                        <thead>
                            <tr style="border-bottom: 1px solid rgba(255,255,255,0.12); color: var(--text-muted); text-align: left; position: sticky; top: 0; background: rgba(15, 23, 42, 0.95); z-index: 2;">
                                <th style="padding: 0.6rem 0.75rem;">Time</th>
                                <th style="padding: 0.6rem 0.75rem; text-align: right;">PCR Value</th>
                                <th style="padding: 0.6rem 0.75rem; text-align: center;">PCR Shift (Trend)</th>
                                <th style="padding: 0.6rem 0.75rem; text-align: right;">Spot Price</th>
                                <th style="padding: 0.6rem 0.75rem; text-align: center;">Spot Shift ($\Delta$)</th>
                                <th style="padding: 0.6rem 0.75rem; text-align: center;">Market Bias</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        for (let i = 0; i < reversed.length; i++) {
            const cur = reversed[i];
            const prev = (i < reversed.length - 1) ? reversed[i + 1] : null;

            const pcrVal = cur.value;
            const pcrDiff = prev ? (pcrVal - prev.value) : 0;

            const spotVal = cur.spot || 0;
            const prevSpot = prev ? (prev.spot || 0) : 0;
            const spotDiff = (spotVal && prevSpot) ? (spotVal - prevSpot) : 0;

            let pcrBadge = '= Stable';
            let pcrColor = '#94a3b8';

            if (pcrDiff > 0.0005) {
                pcrBadge = `▲ +${pcrDiff.toFixed(4)} (Increasing)`;
                pcrColor = '#10b981';
            } else if (pcrDiff < -0.0005) {
                pcrBadge = `▼ ${pcrDiff.toFixed(4)} (Decreasing)`;
                pcrColor = '#ef4444';
            }

            let spotTrendColor = '#94a3b8';
            let spotBadge = '0.00';
            if (spotDiff > 0.05) {
                spotTrendColor = '#10b981';
                spotBadge = `▲ +${spotDiff.toFixed(1)}`;
            } else if (spotDiff < -0.05) {
                spotTrendColor = '#ef4444';
                spotBadge = `▼ ${spotDiff.toFixed(1)}`;
            }

            let biasLabel = 'NEUTRAL';
            let biasColor = '#94a3b8';
            let biasBg = 'rgba(148, 163, 184, 0.15)';

            if (pcrDiff > 0.0002) {
                biasLabel = 'BULLISH';
                biasColor = '#10b981';
                biasBg = 'rgba(16, 185, 129, 0.15)';
            } else if (pcrDiff < -0.0002) {
                biasLabel = 'BEARISH';
                biasColor = '#ef4444';
                biasBg = 'rgba(239, 68, 68, 0.15)';
            } else {
                biasLabel = 'NEUTRAL';
                biasColor = '#94a3b8';
                biasBg = 'rgba(148, 163, 184, 0.15)';
            }

            html += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background='transparent'">
                    <td style="padding: 0.55rem 0.75rem; font-family: 'JetBrains Mono', monospace; font-weight: 600; color: #f8fafc;">
                        ${cur.timeStr || '--'}
                    </td>
                    <td style="padding: 0.55rem 0.75rem; text-align: right; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #38bdf8; font-size: 0.88rem;">
                        ${pcrVal.toFixed(4)}
                    </td>
                    <td style="padding: 0.55rem 0.75rem; text-align: center; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: ${pcrColor}; font-size: 0.82rem;">
                        ${pcrBadge}
                    </td>
                    <td style="padding: 0.55rem 0.75rem; text-align: right; font-family: 'JetBrains Mono', monospace; font-weight: 600; color: #f8fafc;">
                        ${spotVal ? '₹' + spotVal.toLocaleString() : '---'}
                    </td>
                    <td style="padding: 0.55rem 0.75rem; text-align: center; font-family: 'JetBrains Mono', monospace; font-weight: 600; color: ${spotTrendColor}; font-size: 0.82rem;">
                        ${spotBadge}
                    </td>
                    <td style="padding: 0.55rem 0.75rem; text-align: center;">
                        <span style="display:inline-block; font-size:0.68rem; font-weight:700; padding:0.18rem 0.5rem; border-radius:4px; background:${biasBg}; color:${biasColor}; border: 1px solid ${biasColor}40;">
                            ${biasLabel}
                        </span>
                    </td>
                </tr>
            `;
        }

        html += `
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        // Preserve user's scroll position before re-rendering HTML
        const existingScrollEl = container.querySelector('.table-responsive');
        const savedScrollTop = existingScrollEl ? existingScrollEl.scrollTop : 0;

        container.innerHTML = html;

        if (savedScrollTop > 0) {
            const newScrollEl = container.querySelector('.table-responsive');
            if (newScrollEl) {
                newScrollEl.scrollTop = savedScrollTop;
            }
        }
    },

    async shareTradeSignal(symbol, type, strike, price, margin, roi) {
        const text = `📊 *DESTRADE PRO SIGNAL*\n` +
            `🔹 *Script:* ${symbol} ${type} ${strike}\n` +
            `💰 *Option LTP:* ₹${price}\n` +
            `🛡️ *Required Margin:* ₹${Number(margin).toLocaleString()}\n` +
            `📈 *Est. Yield (ROI):* ${roi}%\n\n` +
            `⚡ *Sent via Destrade Pro Trading Terminal*`;

        if (navigator.share) {
            try {
                await navigator.share({
                    title: `Destrade Signal: ${symbol} ${strike} ${type}`,
                    text: text
                });
                return;
            } catch (err) {
                // Fallback to clipboard if user cancels share modal
            }
        }

        // Clipboard fallback
        try {
            await navigator.clipboard.writeText(text);
            alert('Trade Signal copied to clipboard!\n\n' + text);
        } catch (e) {
            alert(text);
        }
    },

    // ===== OI CLOCK & RECOMMENDATIONS =====
    async renderOIClock() {
        const symbol = this.state.activeSymbol || 'NIFTY';
        const cleanSym = symbol.replace('NIFTY 50', 'NIFTY');

        const view = document.getElementById('view-oi-clock');
        if (!view) return;

        view.innerHTML = `
            <div class="view-header">
                <div class="view-title"><i class="fas fa-clock"></i> Options Intelligence</div>
                <button class="back-btn" onclick="App.switchView('dashboard')"><i class="fas fa-arrow-left"></i> Back</button>
            </div>
            <div class="mode-tabs glass" style="margin-bottom: 1.5rem; display: flex; padding: 0.25rem; border-radius: 10px; width: fit-content;">
                <button class="mode-tab ${this.state.oiMode !== 'recommendation' ? 'active' : ''}" data-mode="clock" onclick="App.switchOIMode('clock')">Symbol OI Gauge</button>
                <button class="mode-tab ${this.state.oiMode === 'recommendation' ? 'active' : ''}" data-mode="recommendation" onclick="App.switchOIMode('recommendation')">Global Trade Recommendations</button>
            </div>
            <div id="oi-main-content">
                <div class="skeleton-loader" style="height: 400px;"></div>
            </div>
        `;

        this.switchOIMode(this.state.oiMode || 'clock', true);
    },

    // ===== MARKET DISCOVERY VIEW =====
    async renderDiscovery() {
        const view = document.getElementById('view-discovery');
        if (!view) return;
        let c = document.getElementById('discovery-content');
        if (!c) {
            c = document.createElement('div');
            c.id = 'discovery-content';
            view.appendChild(c);
        }

        if (!this.state.discoveryMode) this.state.discoveryMode = 'screener';
        if (!this.state.screenerSubTab) this.state.screenerSubTab = 'longBuildup';
        if (!this.state.oiFilter) this.state.oiFilter = 'ALL';

        document.querySelectorAll('#view-discovery .mode-tab').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === this.state.discoveryMode);
        });

        c.innerHTML = '<div class="skeleton-loader" style="height: 350px; border-radius:12px;"></div>';

        const data = await window.nseApi.getScreenerData().catch(() => null);

        if (this.state.discoveryMode === 'screener') {
            this.renderScreenerView(c, data);
        } else {
            this.renderOIInterpretationView(c, data);
        }
    },

    switchOIInterpretationFilter(filter) {
        this.state.oiFilter = filter;
        this.renderDiscovery();
    },

    filterOIInterpretationSearch(val) {
        this.state.oiSearch = val.toUpperCase().trim();
        const container = document.getElementById('oi-interpretation-table-body');
        if (container) {
            this.renderOIInterpretationRows(container, this.state.screenerDataCache);
        }
    },

    renderOIInterpretationView(container, data) {
        this.state.screenerDataCache = data;
        const activeFilter = this.state.oiFilter || 'ALL';
        const searchQ = this.state.oiSearch || '';

        container.innerHTML = `
            <div class="card glass" style="padding: 1.25rem; margin-bottom: 1.5rem;">
                <div class="movers-tabs" style="display:flex; gap:0.4rem; flex-wrap:wrap; margin-bottom:1rem;">
                    <button class="${activeFilter === 'ALL' ? 'active' : ''}" onclick="App.switchOIInterpretationFilter('ALL')">ALL</button>
                    <button class="${activeFilter === 'Long Buildup' ? 'active' : ''}" onclick="App.switchOIInterpretationFilter('Long Buildup')">Long</button>
                    <button class="${activeFilter === 'Short Buildup' ? 'active' : ''}" onclick="App.switchOIInterpretationFilter('Short Buildup')">Short</button>
                    <button class="${activeFilter === 'Short Covering' ? 'active' : ''}" onclick="App.switchOIInterpretationFilter('Short Covering')">Short Covering</button>
                    <button class="${activeFilter === 'Long Unwinding' ? 'active' : ''}" onclick="App.switchOIInterpretationFilter('Long Unwinding')">Long Unwinding</button>
                </div>

                <div style="position:relative; margin-bottom:1rem;">
                    <input type="text" placeholder="Search Symbol (e.g. RELIANCE, TCS)..." value="${searchQ}" oninput="App.filterOIInterpretationSearch(this.value)" style="width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:var(--text-bright); padding:0.65rem 1rem; border-radius:8px; font-size:0.85rem; outline:none;">
                </div>

                <div style="overflow-x:auto;">
                    <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.85rem;">
                        <thead>
                            <tr style="border-bottom:1px solid rgba(255,255,255,0.1); color:var(--text-muted);">
                                <th style="padding:0.75rem">Symbol</th>
                                <th style="padding:0.75rem; text-align:right">Price</th>
                                <th style="padding:0.75rem; text-align:right">Price Chg %</th>
                                <th style="padding:0.75rem; text-align:right">Traded Vol</th>
                                <th style="padding:0.75rem; text-align:center">Buildup Tag</th>
                            </tr>
                        </thead>
                        <tbody id="oi-interpretation-table-body">
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        this.renderOIInterpretationRows(document.getElementById('oi-interpretation-table-body'), data);
    },

    renderOIInterpretationRows(tbody, data) {
        if (!tbody) return;
        const allStocks = data?.all || [];
        const activeFilter = this.state.oiFilter || 'ALL';
        const searchQ = this.state.oiSearch || '';

        let filtered = allStocks;
        if (activeFilter !== 'ALL') {
            filtered = filtered.filter(s => s.tag === activeFilter);
        }
        if (searchQ) {
            filtered = filtered.filter(s => s.symbol.toUpperCase().includes(searchQ));
        }

        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align:center; padding:2.5rem; color:var(--text-muted);">
                        No stocks matching "${activeFilter}" criteria.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = filtered.slice(0, 40).map(s => {
            const tagStyle = s.tag === 'Long Buildup' ? 'tag-bullish' :
                             s.tag === 'Short Buildup' ? 'tag-bearish' :
                             s.tag === 'Short Covering' ? 'tag-bullish' :
                             s.tag === 'Long Unwinding' ? 'tag-bearish' : 'tag-neutral';
            return `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.03); cursor:pointer;" onclick="App.showSymbolOverview('${s.symbol}')">
                    <td style="padding:0.75rem; font-weight:700; color:var(--text-bright)">${s.symbol}</td>
                    <td style="padding:0.75rem; text-align:right; font-family:var(--font-mono)">₹${(s.price || 0).toLocaleString()}</td>
                    <td style="padding:0.75rem; text-align:right; font-family:var(--font-mono)" class="${s.pChange >= 0 ? 'up' : 'down'}">
                        ${s.pChange >= 0 ? '+' : ''}${(s.pChange || 0).toFixed(2)}%
                    </td>
                    <td style="padding:0.75rem; text-align:right; font-family:var(--font-mono); color:var(--text-muted)">
                        ${(s.volume || 0).toLocaleString()}
                    </td>
                    <td style="padding:0.75rem; text-align:center">
                        <span class="tag ${tagStyle}">${s.tag}</span>
                    </td>
                </tr>
            `;
        }).join('');
    },

    showScriptManager() {
        const modal = document.getElementById('script-manager-modal');
        if (modal) modal.classList.add('active');
    },

    closeScriptManager() {
        const modal = document.getElementById('script-manager-modal');
        if (modal) modal.classList.remove('active');
    },

    switchDiscoveryMode(mode) {
        this.state.discoveryMode = mode;
        this.renderDiscovery();
    },

    switchScreenerSubTab(tab) {
        this.state.screenerSubTab = tab;
        this.renderDiscovery();
    },

    renderScreenerView(container, data) {
        const activeTab = this.state.screenerSubTab || 'longBuildup';
        const longB = data?.longBuildup || [];
        const shortB = data?.shortBuildup || [];
        const surges = data?.priceSurges || data?.all || [];
        const vols = data?.volShockers || [];

        let currentList = [];
        if (activeTab === 'longBuildup') currentList = longB.length > 0 ? longB : surges.filter(s => s.pChange > 0);
        else if (activeTab === 'shortBuildup') currentList = shortB.length > 0 ? shortB : surges.filter(s => s.pChange < 0);
        else if (activeTab === 'surges') currentList = surges;
        else if (activeTab === 'volume') currentList = vols;

        container.innerHTML = `
            <div class="card glass" style="padding: 1.25rem; margin-bottom: 1.5rem;">
                <div class="movers-tabs" style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:1.25rem;">
                    <button class="${activeTab === 'longBuildup' ? 'active' : ''}" onclick="App.switchScreenerSubTab('longBuildup')">
                        🔥 Long Buildup (${longB.length || surges.filter(s => s.pChange > 0).length})
                    </button>
                    <button class="${activeTab === 'shortBuildup' ? 'active' : ''}" onclick="App.switchScreenerSubTab('shortBuildup')">
                        ❄️ Short Buildup (${shortB.length || surges.filter(s => s.pChange < 0).length})
                    </button>
                    <button class="${activeTab === 'surges' ? 'active' : ''}" onclick="App.switchScreenerSubTab('surges')">
                        🚀 Price Surges (${surges.length})
                    </button>
                    <button class="${activeTab === 'volume' ? 'active' : ''}" onclick="App.switchScreenerSubTab('volume')">
                        ⚡ Vol Shockers (${vols.length})
                    </button>
                </div>

                ${currentList.length === 0 ? `
                    <div style="text-align:center; padding:3rem 1rem; color:var(--text-muted);">
                        <i class="fas fa-search" style="font-size:2rem; margin-bottom:1rem; opacity:0.5;"></i>
                        <p>No matching stocks found for this buildup criteria in real-time stream.</p>
                    </div>
                ` : `
                    <div style="overflow-x:auto;">
                        <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.85rem;">
                            <thead>
                                <tr style="border-bottom:1px solid rgba(255,255,255,0.1); color:var(--text-muted);">
                                    <th style="padding:0.75rem">Symbol</th>
                                    <th style="padding:0.75rem; text-align:right">Price</th>
                                    <th style="padding:0.75rem; text-align:right">Price Chg %</th>
                                    <th style="padding:0.75rem; text-align:right">Traded Vol</th>
                                    <th style="padding:0.75rem; text-align:center">Signal Tag</th>
                                    <th style="padding:0.75rem; text-align:center">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${currentList.slice(0, 25).map(s => `
                                    <tr style="border-bottom:1px solid rgba(255,255,255,0.03); cursor:pointer;" onclick="App.showSymbolOverview('${s.symbol}')">
                                        <td style="padding:0.75rem; font-weight:700; color:var(--text-bright)">${s.symbol}</td>
                                        <td style="padding:0.75rem; text-align:right; font-family:var(--font-mono)">₹${(s.price || 0).toLocaleString()}</td>
                                        <td style="padding:0.75rem; text-align:right; font-family:var(--font-mono)" class="${s.pChange >= 0 ? 'up' : 'down'}">
                                            ${s.pChange >= 0 ? '+' : ''}${(s.pChange || 0).toFixed(2)}%
                                        </td>
                                        <td style="padding:0.75rem; text-align:right; font-family:var(--font-mono); color:var(--text-muted)">
                                            ${(s.volume || 0).toLocaleString()}
                                        </td>
                                        <td style="padding:0.75rem; text-align:center">
                                            <span class="tag ${s.pChange >= 0 ? 'tag-bullish' : 'tag-bearish'}">
                                                ${s.tag || (s.pChange >= 0 ? 'Long Buildup' : 'Short Buildup')}
                                            </span>
                                        </td>
                                        <td style="padding:0.75rem; text-align:center" onclick="event.stopPropagation();">
                                            <button class="chart-action-btn" onclick="App.showSymbolOverview('${s.symbol}')" style="padding:0.3rem 0.6rem; font-size:0.75rem">
                                                View
                                            </button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
        `;
    },

    switchOIMode(mode, force = false) {
        if (this.state.oiMode === mode && !force) return;
        this.state.oiMode = mode;

        document.querySelectorAll('#view-oi-clock .mode-tab').forEach(t => t.classList.remove('active'));
        const tab = document.querySelector(`#view-oi-clock .mode-tab[data-mode="${mode}"]`);
        if (tab) tab.classList.add('active');

        const content = document.getElementById('oi-main-content');
        if (!content) return;

        if (mode === 'clock') {
            const sym = this.state.activeSymbol || 'NIFTY';
            content.innerHTML = `
                <div style="display:flex; justify-content:center; align-items:center; flex-direction:column; gap:1rem;">
                    <div class="card glass" id="oi-gauge-standalone-container" style="padding: 2.5rem; min-height: 400px; width: 100%; display: flex; flex-direction: column; align-items: center; text-align:center">
                        <div class="skeleton-loader" style="width:100%; height:300px"></div>
                    </div>
                </div>
            `;
            this._renderOIGauge('oi-gauge-standalone-container', sym);
        } else if (mode === 'recommendation') {
            this.renderTradeRecommendations(content);
        }
    },

    async calculateMargin(spot, strike, premium, type, isIndex, lotSize, expiryDate = '', symbol = '', model = this.state.marginModel || 'zerodha_live') {
        if (model === 'zerodha_live' && symbol && window.nseApi && window.nseApi.fetchZerodhaSpanMargin) {
            const liveMargin = await window.nseApi.fetchZerodhaSpanMargin(symbol, strike, type, lotSize, expiryDate);
            if (liveMargin) {
                return {
                    span: liveMargin.span,
                    exposure: liveMargin.exposure,
                    total: liveMargin.total,
                    premiumReceivable: premium * lotSize,
                    modelName: 'Zerodha Live SPAN'
                };
            }
        }
        if (model === 'zerodha_live' || model === 'zerodha') {
            const contractValue = spot * lotSize;
            const spanPercent = isIndex ? 0.12 : 0.20;
            const expPercent = isIndex ? 0.02 : 0.035;

            const spanBase = contractValue * spanPercent;
            const expMargin = contractValue * expPercent;

            let otmAmount = 0;
            if (type === 'CE' && strike > spot) otmAmount = (strike - spot) * lotSize;
            else if (type === 'PE' && strike < spot) otmAmount = (spot - strike) * lotSize;

            const floorSpan = contractValue * (isIndex ? 0.05 : 0.08);
            const finalSpan = Math.max(floorSpan, spanBase - (otmAmount * 0.5));

            // Zerodha alternative option margin rule: (strike + premium) * lotSize * 0.025
            const altMargin = (strike + premium) * lotSize * 0.025;
            const totalMargin = Math.max(finalSpan + expMargin, altMargin);

            return {
                span: finalSpan,
                exposure: expMargin,
                total: totalMargin,
                premiumReceivable: premium * lotSize,
                modelName: 'Zerodha Formula'
            };
        } else {
            // Backup Heuristic Model
            const spanPercent = isIndex ? 0.12 : 0.23;
            const expPercent = isIndex ? 0.02 : 0.035;
            const minPercent = isIndex ? 0.05 : 0.10;

            const contractValue = spot * lotSize;
            let spanBase = contractValue * spanPercent;
            let expMargin = contractValue * expPercent;

            let otmAmount = 0;
            if (type === 'CE' && strike > spot) otmAmount = (strike - spot) * lotSize;
            else if (type === 'PE' && strike < spot) otmAmount = (spot - strike) * lotSize;

            let finalSpan = spanBase - (otmAmount * 0.4);
            const floorSpan = contractValue * minPercent;

            finalSpan = Math.max(finalSpan, floorSpan);
            let totalMargin = finalSpan + expMargin;

            return {
                span: finalSpan,
                exposure: expMargin,
                total: totalMargin,
                premiumReceivable: premium * lotSize,
                modelName: 'Backup SPAN'
            };
        }
    },

    changeMarginModel(model) {
        this.state.marginModel = model;
        localStorage.setItem('destrade_margin_model', model);
        if (this.state.scannerCache && this.state.scannerCache.completed) {
            this.runTradeScanner(true);
        }
    },

    applyScannerFilters() {
        const minEl = document.getElementById('scanner-capital-min');
        const maxEl = document.getElementById('scanner-capital-max');
        if (minEl) {
            const valMin = parseFloat(minEl.value) || 0;
            this.state.scannerCapitalMin = valMin > 0 ? valMin : null;
            if (valMin > 0) {
                localStorage.setItem('destrade_scanner_capital_min', valMin);
            } else {
                localStorage.removeItem('destrade_scanner_capital_min');
            }
        }
        if (maxEl) {
            const valMax = parseFloat(maxEl.value) || 0;
            this.state.scannerCapitalMax = valMax > 0 ? valMax : null;
            if (valMax > 0) {
                localStorage.setItem('destrade_scanner_capital_max', valMax);
            } else {
                localStorage.removeItem('destrade_scanner_capital_max');
            }
        }

        const minOtmEl = document.getElementById('scanner-otm-min');
        const maxOtmEl = document.getElementById('scanner-otm-max');
        if (minOtmEl) {
            this.state.scannerOtmMin = parseFloat(minOtmEl.value) || 4;
            localStorage.setItem('destrade_scanner_otm_min', this.state.scannerOtmMin);
        }
        if (maxOtmEl) {
            this.state.scannerOtmMax = parseFloat(maxOtmEl.value) || 10;
            localStorage.setItem('destrade_scanner_otm_max', this.state.scannerOtmMax);
        }

        if (this.state.scannerCache && this.state.scannerCache.completed) {
            this._renderScannerResults(this.state.scannerCache.sell, this.state.scannerCache.buy);
        }
    },

    renderTradeRecommendations(container) {
        container.innerHTML = `
            <div class="card glass" style="padding: 1.5rem; margin-bottom: 1.5rem;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem">
                    <div>
                        <h3 style="margin-bottom:0.5rem"><i class="fas fa-robot"></i> AI Options Scanner</h3>
                        <p style="color:var(--text-muted); font-size:0.9rem">
                            Scans active F&O scripts to find the best Selling and Buying opportunities based on premium yields and momentum.
                        </p>
                    </div>
                </div>
                
                <div class="scanner-controls-container" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem; margin-top:1.25rem; padding-top:1.25rem; border-top:1px solid rgba(255,255,255,0.05)">
                    <!-- Scanner Controls -->
                    <div class="scanner-controls-row" style="display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap">
                        <select id="scanner-margin-model" onchange="App.changeMarginModel(this.value)" style="background:var(--bg-glass); color:var(--text-bright); border:1px solid rgba(255,255,255,0.2); padding:0.75rem 1rem; border-radius:8px; font-size:0.85rem; cursor:pointer; outline:none">
                            <option value="zerodha_live" ${(this.state.marginModel || 'zerodha_live') === 'zerodha_live' ? 'selected' : ''}>Model: Zerodha Live SPAN API</option>
                            <option value="zerodha" ${this.state.marginModel === 'zerodha' ? 'selected' : ''}>Model: Zerodha Formula</option>
                            <option value="heuristic" ${this.state.marginModel === 'heuristic' ? 'selected' : ''}>Model: Backup SPAN</option>
                        </select>
                        <select id="scanner-expiry-mode" style="background:var(--bg-glass); color:var(--text-bright); border:1px solid rgba(255,255,255,0.2); padding:0.75rem 1rem; border-radius:8px; font-size:0.85rem; cursor:pointer; outline:none">
                            <option value="current" ${this.state.scannerExpiryMode === 'current' ? 'selected' : ''}>Current Expiry (Near Month)</option>
                            <option value="next" ${this.state.scannerExpiryMode === 'next' ? 'selected' : ''}>Next Expiry (Next Month)</option>
                            <option value="far" ${this.state.scannerExpiryMode === 'far' ? 'selected' : ''}>Far Expiry (Far Month)</option>
                        </select>
                        <button class="btn chart-action-btn" id="btn-run-scanner" onclick="App.runTradeScanner(true)" style="background:var(--primary); color:white; padding:0.8rem 1.5rem">
                            <i class="fas fa-play"></i> Start Full Scan
                        </button>
                    </div>

                    <!-- Dynamic Filters Input panel -->
                    <div class="scanner-filters-row" style="display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap">
                        <!-- Capital Range Inputs -->
                        <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); padding:0.45rem 0.8rem; border-radius:8px">
                            <label style="font-size:0.8rem; color:var(--text-muted); margin-bottom:0">Capital Range: ₹</label>
                            <input type="number" id="scanner-capital-min" placeholder="Min" value="${this.state.scannerCapitalMin || ''}" oninput="App.applyScannerFilters()" style="background:transparent; border:none; color:var(--text-bright); font-size:0.85rem; width:80px; outline:none; text-align:center">
                            <span style="color:var(--text-muted); font-size:0.8rem">to</span>
                            <input type="number" id="scanner-capital-max" placeholder="Max" value="${this.state.scannerCapitalMax || ''}" oninput="App.applyScannerFilters()" style="background:transparent; border:none; color:var(--text-bright); font-size:0.85rem; width:80px; outline:none; text-align:center">
                        </div>
                        
                        <!-- OTM Selector -->
                        <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); padding:0.45rem 0.8rem; border-radius:8px">
                            <label style="font-size:0.8rem; color:var(--text-muted); margin-bottom:0">OTM Range:</label>
                            <input type="number" id="scanner-otm-min" placeholder="Min %" value="${this.state.scannerOtmMin}" onchange="App.applyScannerFilters()" style="background:transparent; border:none; color:var(--text-bright); font-size:0.85rem; width:45px; outline:none; text-align:center">%
                            <span style="color:var(--text-muted); font-size:0.8rem">to</span>
                            <input type="number" id="scanner-otm-max" placeholder="Max %" value="${this.state.scannerOtmMax}" onchange="App.applyScannerFilters()" style="background:transparent; border:none; color:var(--text-bright); font-size:0.85rem; width:45px; outline:none; text-align:center">%
                        </div>
                    </div>
                </div>
                
                <div id="scanner-progress-container" style="display:none; margin-top:2rem">
                    <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:0.8rem; color:var(--text-bright)">
                        <span id="scanner-status">Fetching scripts...</span>
                        <span id="scanner-progress-text">0 / 0</span>
                    </div>
                    <div style="width:100%; height:8px; background:rgba(255,255,255,0.05); border-radius:4px; overflow:hidden;">
                        <div id="scanner-progress-bar" style="width:0%; height:100%; background:var(--primary); transition:width 0.2s ease;"></div>
                    </div>
                </div>
            </div>

            <!-- Results Section -->
            <div id="scanner-results" style="display:none;">
                <div class="movers-tabs" style="margin-bottom:1rem">
                    <button class="active" onclick="App.switchScannerTab('sell')">Best to Sell (Yield)</button>
                    <button onclick="App.switchScannerTab('buy')">Best to Buy (Momentum)</button>
                </div>
                
                <div id="scanner-sell-results" class="scanner-tab-target active"></div>
                <div id="scanner-buy-results" class="scanner-tab-target" style="display:none;"></div>
            </div>
        `;

        // Auto-show cached data if we switch views back
        if (this.state.scannerCache && this.state.scannerCache.completed) {
            setTimeout(() => this.runTradeScanner(false), 10);
        } else if (this.state.scannerCache && this.state.scannerCache.status === 'scanning') {
            document.getElementById('scanner-progress-container').style.display = 'block';
            document.getElementById('scanner-status').textContent = "Scan in progress locally...";
        }
    },

    switchScannerTab(tab) {
        document.querySelectorAll('#scanner-results .movers-tabs button').forEach((b, i) => {
            if ((tab === 'sell' && i === 0) || (tab === 'buy' && i === 1)) b.classList.add('active');
            else b.classList.remove('active');
        });
        document.getElementById('scanner-sell-results').style.display = tab === 'sell' ? 'block' : 'none';
        document.getElementById('scanner-buy-results').style.display = tab === 'buy' ? 'block' : 'none';
    },

    async runTradeScanner(force = true, isBackground = false) {
        const btn = document.getElementById('btn-run-scanner');
        const progCont = document.getElementById('scanner-progress-container');
        const pText = document.getElementById('scanner-progress-text');
        const pBar = document.getElementById('scanner-progress-bar');
        const sStatus = document.getElementById('scanner-status');
        const resultsBox = document.getElementById('scanner-results');

        const expiryModeEl = document.getElementById('scanner-expiry-mode');
        const targetExpiryMode = expiryModeEl ? expiryModeEl.value : (this.state.scannerExpiryMode || 'current');
        this.state.scannerExpiryMode = targetExpiryMode;

        const marginModelEl = document.getElementById('scanner-margin-model');
        if (marginModelEl) this.state.marginModel = marginModelEl.value;

        // If just loading from cache
        if (!force && this.state.scannerCache.completed) {
            if (resultsBox) resultsBox.style.display = 'block';
            this._renderScannerResults(this.state.scannerCache.sell, this.state.scannerCache.buy);
            return;
        }

        // Prevent multiple simultaneous scans
        if (this.state.scannerCache.status === 'scanning') return;
        this.state.scannerCache.status = 'scanning';

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Scanning...`;
        }
        if (progCont) progCont.style.display = 'block';
        if (resultsBox) resultsBox.style.display = 'none';

        // Pre-fetch Screener Data to populate fnoSymbols if missing
        if (!window.nseApi.fnoSymbols || window.nseApi.fnoSymbols.length === 0) {
            await window.nseApi.getScreenerData();
        }

        let symbols = window.nseApi.fnoSymbols || [];
        if (symbols.length === 0) {
            sStatus.textContent = "Error: F&O Symbol list unavailable.";
            btn.disabled = false;
            btn.innerHTML = `<i class="fas fa-play"></i> Retry Scan`;
            return;
        }

        const buyCandidates = [];
        const sellCandidates = [];
        let completed = 0;
        const total = symbols.length;

        // Process in batches of 4 to prevent rate limiting (429)
        for (let i = 0; i < total; i += 4) {
            const batch = symbols.slice(i, i + 4);
            if (sStatus) sStatus.textContent = `Analyzing ${batch[0]} and others (${targetExpiryMode.toUpperCase()} expiry)...`;

            const promises = batch.map(async (sym) => {
                try {
                    const oi = await window.nseApi.getOIClock(sym, targetExpiryMode);
                    if (!oi || !oi.data || oi.data.length === 0) return;

                    const lotSize = oi.lotSize || (typeof window.nseApi._getLotSize === 'function' ? window.nseApi._getLotSize(sym) : 100);
                    const spot = oi.underlying;
                    if (!spot || spot === 0) return;

                    const isIndex = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'].some(idx => sym.includes(idx));

                    const minOtmVal = parseFloat(document.getElementById('scanner-otm-min')?.value) || App.state.scannerOtmMin;
                    const maxOtmVal = parseFloat(document.getElementById('scanner-otm-max')?.value) || App.state.scannerOtmMax;

                    // Proportional scaling for indices (indices are less volatile than individual stocks)
                    const finalMinOtm = isIndex ? Math.max(0.5, minOtmVal * 0.4) : minOtmVal;
                    const finalMaxOtm = isIndex ? Math.max(1.5, maxOtmVal * 0.8) : maxOtmVal;

                    const ceMinDist = 1 + (finalMinOtm / 100);
                    const ceMaxDist = 1 + (finalMaxOtm / 100);

                    const peMaxDist = 1 - (finalMinOtm / 100);
                    const peMinDist = 1 - (finalMaxOtm / 100);

                    for (const row of oi.data) {
                        const strike = row.strikePrice;

                        // CE Sell (Near OTM with user selected parameters & Daily OI Change > 0)
                        if (strike >= spot * ceMinDist && strike <= spot * ceMaxDist && row.CE && row.CE.lastPrice > 0 && (row.CE.openInterest || 0) > 0 && (row.CE.changeinOpenInterest || 0) > 0) {
                            const premiumValue = row.CE.lastPrice * lotSize;
                            const estMargin = await this.calculateMargin(spot, strike, row.CE.lastPrice, 'CE', isIndex, lotSize, oi.currentExpiry || '', sym);

                            const roi = (premiumValue / estMargin.total) * 100;
                            if (roi > 0.5 && roi < 50) { // filter out absurd outliers
                                sellCandidates.push({
                                    symbol: sym, type: 'CE', strike, spot, premium: row.CE.lastPrice, lotSize,
                                    margin: estMargin, value: premiumValue, roi, iv: row.CE.impliedVolatility || 0,
                                    oiChg: row.CE.changeinOpenInterest, expiry: oi.currentExpiry || ''
                                });
                            }
                        }
                        // PE Sell (Near OTM with user selected parameters & Daily OI Change > 0)
                        if (strike <= spot * peMaxDist && strike >= spot * peMinDist && row.PE && row.PE.lastPrice > 0 && (row.PE.openInterest || 0) > 0 && (row.PE.changeinOpenInterest || 0) > 0) {
                            const premiumValue = row.PE.lastPrice * lotSize;
                            const estMargin = await this.calculateMargin(spot, strike, row.PE.lastPrice, 'PE', isIndex, lotSize, oi.currentExpiry || '', sym);

                            const roi = (premiumValue / estMargin.total) * 100;
                            if (roi > 0.5 && roi < 50) {
                                sellCandidates.push({
                                    symbol: sym, type: 'PE', strike, spot, premium: row.PE.lastPrice, lotSize,
                                    margin: estMargin, value: premiumValue, roi, iv: row.PE.impliedVolatility || 0,
                                    oiChg: row.PE.changeinOpenInterest, expiry: oi.currentExpiry || ''
                                });
                            }
                        }

                        // Buy Logic: ATM options with active Price & Daily OI Change > 0
                        if (Math.abs(strike - spot) / spot <= 0.025) {
                            if (row.CE && row.CE.lastPrice > 0 && row.CE.pChange > 0 && (row.CE.changeinOpenInterest || 0) > 0 && (row.CE.openInterest || 0) > 0) {
                                const buyMargin = isIndex ? (row.CE.lastPrice * lotSize * 0.70) : (row.CE.lastPrice * lotSize);
                                buyCandidates.push({
                                    symbol: sym, type: 'CE', strike, spot, premium: row.CE.lastPrice, lotSize,
                                    margin: buyMargin,
                                    pChange: row.CE.pChange,
                                    oiChg: row.CE.changeinOpenInterest, oi: row.CE.openInterest,
                                    score: row.CE.pChange * (row.CE.changeinOpenInterest / (row.CE.openInterest || 1)) * 100,
                                    expiry: oi.currentExpiry || ''
                                });
                            }
                            if (row.PE && row.PE.lastPrice > 0 && row.PE.pChange > 0 && (row.PE.changeinOpenInterest || 0) > 0 && (row.PE.openInterest || 0) > 0) {
                                const buyMargin = isIndex ? (row.PE.lastPrice * lotSize * 0.70) : (row.PE.lastPrice * lotSize);
                                buyCandidates.push({
                                    symbol: sym, type: 'PE', strike, spot, premium: row.PE.lastPrice, lotSize,
                                    margin: buyMargin,
                                    pChange: row.PE.pChange,
                                    oiChg: row.PE.changeinOpenInterest, oi: row.PE.openInterest,
                                    score: row.PE.pChange * (row.PE.changeinOpenInterest / (row.PE.openInterest || 1)) * 100,
                                    expiry: oi.currentExpiry || ''
                                });
                            }
                        }
                    }
                } catch (e) {
                    // Fail silently for bad scripts
                }
            });

            await Promise.all(promises);
            completed += batch.length;
            if (pText) pText.textContent = `${completed} / ${total}`;
            if (pBar) pBar.style.width = `${(completed / total) * 100}%`;

            await new Promise(r => setTimeout(r, 120)); // Rate-limit safe buffer
        }
        this.state.scannerCache = {
            sell: sellCandidates,
            buy: buyCandidates,
            status: 'idle',
            completed: true
        };

        if (sStatus) sStatus.textContent = "Scan Complete!";

        // Render Results if view is active
        if (resultsBox) {
            this._renderScannerResults(sellCandidates, buyCandidates);
            resultsBox.style.display = 'block';
        }
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fas fa-play"></i> Re-Scan`;
        }
        if (progCont) setTimeout(() => { progCont.style.display = 'none'; }, 2000);
    },

    _renderScannerResults(sell, buy) {
        const minCap = this.state.scannerCapitalMin || 0;
        const maxCap = this.state.scannerCapitalMax || Infinity;

        let filteredSell = sell;
        let filteredBuy = buy;

        if (minCap > 0 || maxCap !== Infinity) {
            filteredSell = sell.filter(d => {
                const margin = d.margin?.total || 0;
                return margin >= minCap && margin <= maxCap;
            });
            filteredBuy = buy.filter(d => {
                const reqMargin = typeof d.margin === 'number' ? d.margin : (d.margin?.total || 0);
                return reqMargin >= minCap && reqMargin <= maxCap;
            });
        }

        const ceSell = filteredSell.filter(d => d.type === 'CE').sort((a, b) => b.roi - a.roi).slice(0, 30);
        const peSell = filteredSell.filter(d => d.type === 'PE').sort((a, b) => b.roi - a.roi).slice(0, 30);
        const topBuy = filteredBuy.sort((a, b) => b.score - a.score).slice(0, 50);

        const renderTable = (data, isSell, title) => {
            const emptyMsg = `<div class="card glass" style="padding:2rem;text-align:center;color:var(--text-muted)">No ${title || 'options'} matched the scanning criteria.</div>`;
            if (data.length === 0) return emptyMsg;

            return `
                ${title ? `<div style="padding: 1rem 1.25rem; border-bottom: 1px solid rgba(255,255,255,0.05); display:flex; align-items:center; gap:0.75rem">
                    <i class="fas ${isSell ? (title.includes('Call') ? 'fa-arrow-down' : 'fa-arrow-up') : 'fa-bolt'}" style="color:${isSell ? (title.includes('Call') ? 'var(--down)' : 'var(--up)') : 'var(--primary)'}"></i>
                    <b style="font-size:0.9rem; letter-spacing:0.05em; text-transform:uppercase">${title}</b>
                    <span style="margin-left:auto; font-size:0.7rem; color:var(--text-muted)">Showing Top ${data.length}</span>
                </div>` : ''}
                <table class="pro-table" style="width:100%; text-align:left; font-size:0.85rem">
                    <thead>
                        <tr>
                            <th>Symbol</th>
                            <th>Expiry</th>
                            <th>Action</th>
                            <th>Strike</th>
                            <th>Lot</th>
                            <th>Premium</th>
                            ${isSell ? '<th>Est. Margin</th><th>Est. ROI</th>' : '<th>Est. Margin</th><th>Price Chg %</th><th>Score</th>'}
                            <th style="text-align:center">Share</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(d => `
                            <tr style="cursor:pointer" onclick="App.showOptionChain('${d.symbol}', '${d.expiry || ''}')">
                                <td><b>${d.symbol}</b> <span style="color:var(--text-muted);font-size:0.7rem">(Spot: ${d.spot.toFixed(1)})</span></td>
                                <td class="mono" style="color:var(--primary); font-size:0.75rem">${d.expiry || '---'}</td>
                                <td class="${d.type === 'CE' ? (isSell ? 'down' : 'up') : (isSell ? 'up' : 'down')}">
                                    <span class="tag ${d.type === 'CE' ? (isSell ? 'tag-bearish' : 'tag-bullish') : (isSell ? 'tag-bullish' : 'tag-bearish')}">${isSell ? 'SELL' : 'BUY'} ${d.type}</span>
                                </td>
                                <td class="mono" style="color:var(--primary)">${d.strike}</td>
                                <td class="mono" style="color:var(--text-muted)">${d.lotSize}</td>
                                <td class="mono">₹${parseFloat(d.premium).toFixed(2)}</td>
                                ${isSell ? `
                                    <td class="mono">
                                        <div style="font-weight:600; color:var(--text-bright); margin-bottom:2px">₹${Math.round(d.margin.total).toLocaleString()}</div>
                                        <div style="font-size:0.65rem; color:var(--text-muted); line-height:1.2">
                                            Span: ₹${Math.round(d.margin.span).toLocaleString()}<br>
                                            Exp: ₹${Math.round(d.margin.exposure).toLocaleString()}
                                        </div>
                                        <div style="font-size:0.65rem; color:var(--up); margin-top:2px; font-weight:600">
                                            Rec: ₹${Math.round(d.margin.premiumReceivable).toLocaleString()}
                                        </div>
                                    </td>
                                    <td class="up mono" style="font-weight:bold">${d.roi.toFixed(1)}%</td>
                                ` : `
                                    <td class="mono" style="color:var(--text-muted)">₹${Math.round(d.margin).toLocaleString()}</td>
                                    <td class="up mono">+${d.pChange.toFixed(1)}%</td>
                                    <td class="mono" style="color:var(--primary); font-weight:bold">${d.score.toFixed(1)}</td>
                                `}
                                <td style="text-align:center">
                                    <button class="chart-action-btn" onclick="event.stopPropagation(); App.shareTradeSignal('${d.symbol}', '${d.type}', ${d.strike}, ${parseFloat(d.premium).toFixed(2)}, ${Math.round(d.margin?.total || d.margin || 0)}, ${(d.roi || 0).toFixed(1)})" style="padding:0.3rem 0.6rem; background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.3)" title="Share Trade Signal">
                                        <i class="fas fa-share-alt"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        };

        document.getElementById('scanner-sell-results').innerHTML = `
            <div class="card glass" style="padding:0; overflow:hidden; margin-bottom: 2rem;">${renderTable(ceSell, true, 'Call Options (CE) Yields')}</div>
            <div class="card glass" style="padding:0; overflow:hidden">${renderTable(peSell, true, 'Put Options (PE) Yields')}</div>
        `;
        document.getElementById('scanner-buy-results').innerHTML = `<div class="card glass" style="padding:0; overflow:hidden">${renderTable(topBuy, false, 'Momentum Buying Opportunities')}</div>`;
    },

    async _renderOIGauge(containerId, symbol) {
        const c = document.getElementById(containerId);
        const oi = await window.nseApi.getOIClock(symbol);
        if (!oi) { c.innerHTML = '<p style="color:var(--text-muted)">Data unavailable</p>'; return; }

        const total = oi.totalCEOI + oi.totalPEOI || 1;
        const cePercent = ((oi.totalCEOI / total) * 100).toFixed(0);
        const pePercent = ((oi.totalPEOI / total) * 100).toFixed(0);
        const sentColor = oi.sentiment === 'BULLISH' ? 'var(--up)' : oi.sentiment === 'BEARISH' ? 'var(--down)' : 'var(--amber)';
        const sentClass = oi.sentiment === 'BULLISH' ? 'tag-bullish' : oi.sentiment === 'BEARISH' ? 'tag-bearish' : 'tag-neutral';
        const summary = window.nseApi.getMarketAnalysisAndRecommendation(oi, symbol);

        c.innerHTML = `
            <h3 style="margin-bottom:1.5rem;color:var(--text-bright)">${symbol}</h3>
            <div class="oi-gauge" style="background:conic-gradient(var(--down) 0% ${cePercent}%, var(--up) ${cePercent}% 100%)">
                <div class="oi-gauge-inner">
                    <div class="oi-gauge-value" style="color:${sentColor}">${oi.pcr}</div>
                    <div class="oi-gauge-label">PCR</div>
                </div>
            </div>
            <div style="display:flex;justify-content:center;gap:2rem;margin-bottom:1rem;font-size:0.75rem">
                <span><span class="down">●</span> CE: ${cePercent}%</span>
                <span><span class="up">●</span> PE: ${pePercent}%</span>
            </div>
            <span class="tag ${sentClass}">${oi.sentiment}</span>
            <div class="oi-stats" style="margin-top:2rem">
                <div class="oi-stat"><div class="oi-stat-label">Max CE OI</div><div class="oi-stat-value">${oi.maxCEStrike}</div></div>
                <div class="oi-stat"><div class="oi-stat-label">Max PE OI</div><div class="oi-stat-value">${oi.maxPEStrike}</div></div>
                <div class="oi-stat"><div class="oi-stat-label">Max Pain</div><div class="oi-stat-value up">${oi.maxPainStrike}</div></div>
            </div>

            <!-- Option Chain Analysis Card -->
            ${summary ? `
            <div class="ai-advisor-card glass" style="margin-top:2rem; padding:1.25rem; border:1px solid rgba(99, 102, 241, 0.3); background:rgba(15, 23, 42, 0.6); border-radius:12px; text-align:left;">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1.25rem; flex-wrap:wrap; gap:0.5rem">
                    <div style="display:flex; align-items:center; gap:0.5rem">
                        <i class="fas fa-brain" style="color:var(--primary); font-size:1.2rem"></i>
                        <b style="font-size:1rem; letter-spacing:0.05em; color:var(--text-bright)">QUANTITATIVE MARKET ANALYSIS</b>
                    </div>
                    <div style="display:inline-flex; align-items:center; justify-content:center; gap:0.35rem; background:${summary.biasColor}18; border:1.5px solid ${summary.biasColor}; color:${summary.biasColor}; padding:0.35rem 0.85rem; border-radius:20px; font-weight:800; font-size:0.82rem; white-space:nowrap; box-shadow:0 0 12px ${summary.biasColor}30; width:fit-content;">
                        <i class="fas ${parseFloat(summary.pcr) >= 1.0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}" style="font-size:0.75rem"></i> ${summary.marketType} (${summary.confidence})
                    </div>
                </div>

                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:1rem; margin-bottom:1.25rem;">
                    <div style="background:rgba(0,0,0,0.25); padding:0.85rem; border-radius:8px; border:1px solid rgba(255,255,255,0.05)">
                        <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase; margin-bottom:0.5rem; font-weight:700">Context & PCR</div>
                        <div style="display:flex; justify-content:space-between; margin-bottom:0.3rem"><span style="font-size:0.8rem; color:var(--text-muted)">Spot Price</span><span class="mono" style="font-size:0.85rem; color:var(--text-bright); font-weight:600">₹${summary.spot}</span></div>
                        <div style="display:flex; justify-content:space-between; margin-bottom:0.3rem"><span style="font-size:0.8rem; color:var(--text-muted)">PCR Sentiment</span><span class="mono" style="font-size:0.85rem; color:${summary.biasColor}; font-weight:bold">${summary.pcr}</span></div>
                        <div style="display:flex; justify-content:space-between; margin-bottom:0.3rem"><span style="font-size:0.8rem; color:var(--text-muted)">Max Pain</span><span class="mono" style="font-size:0.85rem; color:var(--text-bright)">${summary.maxPain}</span></div>
                        <div style="display:flex; justify-content:space-between;"><span style="font-size:0.8rem; color:var(--text-muted)">Pain Distance</span><span class="mono" style="font-size:0.8rem; color:${parseFloat(summary.maxPainDiff) >= 0 ? 'var(--up)' : 'var(--down)'}">${parseFloat(summary.maxPainDiff) > 0 ? '+' : ''}${summary.maxPainDiff} pts</span></div>
                    </div>

                    <div style="background:rgba(0,0,0,0.25); padding:0.85rem; border-radius:8px; border:1px solid rgba(255,255,255,0.05)">
                        <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase; margin-bottom:0.5rem; font-weight:700">Key Levels (OI)</div>
                        <div style="display:flex; justify-content:space-between; margin-bottom:0.3rem"><span style="font-size:0.8rem; color:var(--text-muted)">Max Support</span><span class="mono" style="font-size:0.85rem; color:var(--up); font-weight:bold">${summary.strongSupport}</span></div>
                        <div style="display:flex; justify-content:space-between; margin-bottom:0.3rem"><span style="font-size:0.8rem; color:var(--text-muted)">Max Resistance</span><span class="mono" style="font-size:0.85rem; color:var(--down); font-weight:bold">${summary.strongResistance}</span></div>
                        <div style="display:flex; justify-content:space-between;"><span style="font-size:0.8rem; color:var(--text-muted)">Expected Range</span><span class="mono" style="font-size:0.8rem; color:var(--text-bright)">${summary.marketRange}</span></div>
                    </div>

                    <div style="background:rgba(0,0,0,0.25); padding:0.85rem; border-radius:8px; border:1px solid rgba(255,255,255,0.05)">
                        <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase; margin-bottom:0.5rem; font-weight:700">Intraday Build-up</div>
                        <div style="display:flex; justify-content:space-between; margin-bottom:0.3rem"><span style="font-size:0.8rem; color:var(--text-muted)">PE Build-up</span><span class="mono" style="font-size:0.85rem; color:var(--up); font-weight:600">${summary.supportBuilding}</span></div>
                        <div style="display:flex; justify-content:space-between; margin-bottom:0.3rem"><span style="font-size:0.8rem; color:var(--text-muted)">CE Build-up</span><span class="mono" style="font-size:0.85rem; color:var(--down); font-weight:600">${summary.resistanceBuilding}</span></div>
                        <div style="display:flex; justify-content:space-between;"><span style="font-size:0.8rem; color:var(--text-muted)">Lot Size</span><span class="mono" style="font-size:0.8rem; color:var(--text-bright)">${summary.lotSize}</span></div>
                    </div>
                </div>

                <div style="background:rgba(99, 102, 241, 0.12); border: 1px solid rgba(99, 102, 241, 0.35); padding:1.1rem; border-radius:10px; display:flex; flex-direction:column; gap:0.5rem">
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem">
                        <div style="font-size:0.75rem; color:var(--primary); text-transform:uppercase; font-weight:800; letter-spacing:0.05em"><i class="fas fa-bolt"></i> RECOMMENDED TRADE SETUP</div>
                        <div style="font-size:0.75rem; color:var(--text-muted)">Target: <b style="color:var(--up)">${summary.target}</b> | StopLoss: <b style="color:var(--down)">${summary.stopLoss}</b></div>
                    </div>
                    <div class="mono" style="font-size:1.1rem; color:var(--text-bright); font-weight:800">${summary.tradeAction}</div>
                    <div style="font-size:0.8rem; color:var(--text-muted); line-height:1.4">${summary.tradeDetails}</div>
                </div>
            </div>
            ` : ''}
        `;
    },

    // ===== MARKET DISCOVERY (Unified) =====
    renderDiscovery() {
        const content = document.getElementById('discovery-content');
        if (!content) return;
        if (this.state.discoveryMode === 'screener') this.renderScreener(content);
        else this.renderAnalysis(content);

        document.querySelectorAll('.mode-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.mode === this.state.discoveryMode);
        });
    },

    switchDiscoveryMode(mode) {
        this.state.discoveryMode = mode;
        this.renderDiscovery();
    },

    async renderScreener(mountPoint) {
        const c = mountPoint || document.getElementById('discovery-content');
        if (!c) return;

        c.innerHTML = `
            <div class="screener-tabs">
                ${['longBuildup', 'shortBuildup', 'high52w', 'low52w', 'volShockers', 'priceSurges'].map(t => `
                    <button class="screener-tab ${this.state.screenerTab === t ? 'active' : ''}" onclick="App.switchScreenerTab('${t}')">${t.replace(/([A-Z])/g, ' $1').replace('vol', 'Volume')}</button>
                `).join('')}
            </div>
            <div class="card glass" style="padding:0;overflow:auto;max-height:calc(100vh - 300px)">
                <table class="pro-table">
                    <thead>
                        <tr>
                            <th onclick="App.setScreenerSort('symbol')">Symbol ${this._getSortIcon('symbol')}</th>
                            <th onclick="App.setScreenerSort('price')">Price ${this._getSortIcon('price')}</th>
                            <th onclick="App.setScreenerSort('pChange')">Chg % ${this._getSortIcon('pChange')}</th>
                            <th onclick="App.setScreenerSort('volume')">Vol ${this._getSortIcon('volume')}</th>
                            <th onclick="App.setScreenerSort('oiChange')">OI Chg ${this._getSortIcon('oiChange')}</th>
                            <th onclick="App.setScreenerSort('oiValue')">OI Val ${this._getSortIcon('oiValue')}</th>
                            <th>Signal</th>
                        </tr>
                    </thead>
                    <tbody id="screener-body"></tbody>
                </table>
            </div>
        `;
        const data = await window.nseApi.getScreenerData();
        this._renderScreenerTable(data[this.state.screenerTab] || []);
    },

    switchScreenerTab(tab) {
        this.state.screenerTab = tab;
        this.renderDiscovery();
    },

    setScreenerSort(key) {
        if (this.state.screenerSort.key === key) this.state.screenerSort.dir = this.state.screenerSort.dir === 'asc' ? 'desc' : 'asc';
        else { this.state.screenerSort.key = key; this.state.screenerSort.dir = 'desc'; }
        this.renderDiscovery();
    },

    _getSortIcon(key, isAnalysis = false) {
        const sort = isAnalysis ? this.state.analysisSort : this.state.screenerSort;
        if (sort.key !== key) return '<i class="fas fa-sort" style="opacity:0.3"></i>';
        return sort.dir === 'asc' ? '<i class="fas fa-sort-up"></i>' : '<i class="fas fa-sort-down"></i>';
    },

    _renderScreenerTable(stocks) {
        const body = document.getElementById('screener-body');
        if (!body) return;
        const sorted = [...stocks].sort((a, b) => {
            const { key, dir } = this.state.screenerSort;
            if (typeof a[key] === 'string') return dir === 'asc' ? a[key].localeCompare(b[key]) : b[key].localeCompare(a[key]);
            return dir === 'asc' ? a[key] - b[key] : b[key] - a[key];
        });

        body.innerHTML = sorted.map(s => `
            <tr data-symbol="${s.symbol}">
                <td onclick="App.showSymbolOverview('${s.symbol}')">
                    <div style="display:flex; align-items:center; gap:0.5rem">
                        <b>${s.symbol}</b>
                        <i class="fas fa-stream" style="font-size:0.75rem; color:var(--primary); cursor:pointer; opacity:0.6" onclick="event.stopPropagation(); App.showOptionChain('${s.symbol}')" title="Option Chain"></i>
                    </div>
                </td>
                <td class="mono">₹${s.price.toLocaleString()}</td>
                <td class="mono ${s.pChange >= 0 ? 'up' : 'down'}">${s.pChange.toFixed(2)}%</td>
                <td class="mono">${this.formatNumber(s.volume)}</td>
                <td class="mono ${s.oiChange >= 0 ? 'up' : 'down'}">${s.oiChange.toFixed(1)}%</td>
                <td class="mono">${this.formatNumber(s.oiValue)}</td>
                <td><span class="tag ${s.tag.includes('Long Buildup') || s.tag.includes('Short Covering') ? 'tag-bullish' : s.tag === 'Neutral' ? 'tag-neutral' : 'tag-bearish'}">${s.tag}</span></td>
            </tr>
        `).join('');
    },

    formatNumber(num) {
        if (!num || num === 0) return '0';
        const abs = Math.abs(num);
        const sign = num < 0 ? '-' : '';
        let res = abs.toString();

        if (abs >= 10000000) res = (abs / 10000000).toFixed(2) + 'Cr';
        else if (abs >= 100000) res = (abs / 100000).toFixed(2) + 'L';
        else if (abs >= 1000) res = (abs / 1000).toFixed(1) + 'K';

        return sign + res;
    },

    // ===== SECTORS =====
    async renderSectors() {
        const view = document.getElementById('view-sectors');
        if (!view) return;
        const sectors = await window.nseApi.getSectors();
        view.innerHTML = `
            <div class="view-header">
                <div class="view-title"><i class="fas fa-layer-group"></i> Sector Scope</div>
                <button class="back-btn" onclick="App.switchView('dashboard')"><i class="fas fa-arrow-left"></i> Back</button>
            </div>
            <div class="sector-grid">
                ${sectors.map(s => `
                    <div class="sector-card ${s.change >= 0 ? 'positive' : 'negative'}" onclick="App.showSectorStocks('${s.name}')">
                        <div class="sector-name">${s.label}</div>
                        <div class="sector-change ${s.change >= 0 ? 'up' : 'down'}">${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%</div>
                        <div class="sector-price">₹${s.price.toLocaleString()}</div>
                    </div>
                `).join('')}
            </div>
        `;
    },

    async showSectorStocks(sector) {
        this.state.activeSector = sector;
        this.state.discoveryMode = 'analysis';
        this.switchView('discovery');
    },

    async renderAnalysis(mountPoint) {
        const c = mountPoint || document.getElementById('discovery-content');
        if (!c) return;

        const sector = this.state.activeSector;

        c.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;gap:1rem">
                <div class="view-subtitle" style="font-size: 0.9rem; color: var(--primary); font-weight: 800;">
                    ${sector ? `<i class="fas fa-layer-group"></i> ${sector} Scope` : `<i class="fas fa-brain"></i> OI Interpretation`}
                    ${sector ? `<button class="close-btn" style="font-size:0.6rem; margin-left:0.5rem" onclick="App.clearActiveSector()">✕ Clear</button>` : ''}
                </div>
                <div class="screener-tabs" style="margin:0;flex:1;max-width:500px">
                    ${['ALL', 'Long Buildup', 'Short Buildup', 'Short Covering', 'Long Unwinding', 'Neutral'].map(t => `
                        <button class="screener-tab ${this.state.analysisBuildup === t ? 'active' : ''}" onclick="App.setAnalysisBuildup('${t}')">${t.replace(' Buildup', '')}</button>
                    `).join('')}
                </div>
                <div class="global-search glass" style="max-width:200px;margin:0">
                    <i class="fas fa-search"></i>
                    <input type="text" placeholder="Filter symbol..." id="analysis-search-input" value="${this.state.analysisSearch}" oninput="App.handleAnalysisSearch(this.value)">
                </div>
            </div>
            <div class="card glass" style="padding:0;overflow:auto;max-height:calc(100vh - 300px)">
                <table class="pro-table">
                    <thead>
                        <tr>
                            <th onclick="App.setAnalysisSort('symbol')">Symbol ${this._getSortIcon('symbol', true)}</th>
                            <th onclick="App.setAnalysisSort('price')">Price ${this._getSortIcon('price', true)}</th>
                            <th onclick="App.setAnalysisSort('pChange')">Chg % ${this._getSortIcon('pChange', true)}</th>
                            <th onclick="App.setAnalysisSort('volume')">Vol ${this._getSortIcon('volume', true)}</th>
                            <th onclick="App.setAnalysisSort('oiChange')">OI Chg % ${this._getSortIcon('oiChange', true)}</th>
                            <th onclick="App.setAnalysisSort('oiValue')">OI Val ${this._getSortIcon('oiValue', true)}</th>
                            <th>Sentiment</th>
                        </tr>
                    </thead>
                    <tbody id="analysis-body"></tbody>
                </table>
            </div>
        `;
        this.renderAnalysisList();
    },

    clearActiveSector() {
        this.state.activeSector = null;
        this.renderDiscovery();
    },

    handleAnalysisSearch(val) {
        this.state.analysisSearch = val.toUpperCase();
        this.renderAnalysisList();
    },

    async renderAnalysisList() {
        const data = await window.nseApi.getScreenerData();
        let list = data.all || [];
        if (this.state.activeSector) {
            const sh = this.state.activeSector.replace('NIFTY ', '');
            const components = this.state.sectorMapping[this.state.activeSector] || this.state.sectorMapping[sh] || [];
            list = list.filter(s => components.includes(s.symbol));
        }
        this._renderAnalysisTable(list);
    },

    setAnalysisBuildup(val) {
        this.state.analysisBuildup = val;
        this.renderDiscovery();
    },

    _renderAnalysisTable(data) {
        const body = document.getElementById('analysis-body');
        if (!body) return;
        const { key, dir } = this.state.analysisSort;
        const search = this.state.analysisSearch;
        const buildup = this.state.analysisBuildup;

        const filtered = data.filter(s => {
            const matchSearch = s.symbol.includes(search);
            const matchBuildup = buildup === 'ALL' || s.tag === buildup;
            return matchSearch && matchBuildup;
        });

        const sorted = [...filtered].sort((a, b) => {
            if (typeof a[key] === 'string') return dir === 'asc' ? a[key].localeCompare(b[key]) : b[key].localeCompare(a[key]);
            return dir === 'asc' ? a[key] - b[key] : b[key] - a[key];
        });

        body.innerHTML = sorted.map(s => `
            <tr data-symbol="${s.symbol}">
                <td onclick="App.showSymbolOverview('${s.symbol}')">
                    <div style="display:flex; align-items:center; gap:0.5rem">
                        <b>${s.symbol}</b>
                        <i class="fas fa-stream" style="font-size:0.75rem; color:var(--primary); cursor:pointer; opacity:0.6" onclick="event.stopPropagation(); App.showOptionChain('${s.symbol}')" title="Option Chain"></i>
                    </div>
                </td>
                <td class="mono">₹${s.price.toLocaleString()}</td>
                <td class="mono ${s.pChange >= 0 ? 'up' : 'down'}">${s.pChange.toFixed(2)}%</td>
                <td class="mono">${this.formatNumber(s.volume)}</td>
                <td class="mono ${s.oiChange >= 0 ? 'up' : 'down'}">${s.oiChange.toFixed(1)}%</td>
                <td class="mono">${this.formatNumber(s.oiValue)}</td>
                <td><span class="tag ${s.tag.includes('Long Buildup') || s.tag.includes('Short Covering') ? 'tag-bullish' : s.tag === 'Neutral' ? 'tag-neutral' : 'tag-bearish'}">${s.tag}</span></td>
            </tr>
        `).join('');
    },

    setAnalysisSort(key) {
        if (this.state.analysisSort.key === key) this.state.analysisSort.dir = this.state.analysisSort.dir === 'asc' ? 'desc' : 'asc';
        else { this.state.analysisSort.key = key; this.state.analysisSort.dir = 'desc'; }
        this.renderDiscovery();
    },

    // ===== SCRIPT MANAGER (Pool) =====
    showScriptManager() {
        const modal = document.getElementById('script-manager-modal');
        if (modal) { this.renderScriptList(); modal.classList.add('active'); }
    },

    renderScriptList(filter = '') {
        const container = document.getElementById('script-list-container');
        if (!container) return;
        const activeBatch = JSON.parse(localStorage.getItem('destrade_active_scripts') || '[]');
        const symbols = window.nseApi.fnoSymbols || [];
        const filtered = symbols.filter(s => s.includes(filter.toUpperCase())).sort();
        container.innerHTML = filtered.map(s => `
            <div class="script-toggle-item ${activeBatch.includes(s) ? 'active' : ''}" onclick="App.toggleScriptInPool('${s}')">
                <span>${s}</span>
                <i class="fas ${activeBatch.includes(s) ? 'fa-check-circle' : 'fa-circle'}"></i>
            </div>
        `).join('');
    },

    toggleScriptInPool(symbol) {
        let batch = JSON.parse(localStorage.getItem('destrade_active_scripts') || '[]');
        batch = batch.includes(symbol) ? batch.filter(s => s !== symbol) : [...batch, symbol];
        localStorage.setItem('destrade_active_scripts', JSON.stringify(batch));
        this.renderScriptList(document.getElementById('script-manager-search')?.value || '');
    },

    toggleAllScripts(selectAll) {
        const batch = selectAll ? (window.nseApi.fnoSymbols || []) : [];
        localStorage.setItem('destrade_active_scripts', JSON.stringify(batch));
        this.renderScriptList();
    },

    closeScriptManager() {
        document.getElementById('script-manager-modal').classList.remove('active');
        this.fetchData();
    },

    // ===== INTRADAY SNAPSHOT HEARTBEAT =====
    startIntradayHearts() {
        this.runIntradaySnapshot();
        const delay = (5 - (new Date().getMinutes() % 5)) * 60000;
        setTimeout(() => {
            this.runIntradaySnapshot();
            setInterval(() => this.runIntradaySnapshot(), 300000);
        }, delay);
    },

    async runIntradaySnapshot() {
        if (!window.db) return;
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const timeKey = now.getHours().toString().padStart(2, '0') + ':' + (Math.floor(now.getMinutes() / 5) * 5).toString().padStart(2, '0');

        const meta = await db.ref('intraday_meta').once('value');
        if (meta.val()?.date !== today) {
            await db.ref('intraday').set(null);
            await db.ref('intraday_meta').set({ date: today });
        }

        const data = await window.nseApi.getScreenerData();
        const all = data.all || [];
        const updates = {};
        all.forEach(s => {
            updates[`intraday/${s.symbol}/${timeKey}`] = { price: s.price, vol: s.volume, oi: s.oiValue, time: timeKey };
        });
        await db.ref().update(updates);
    }
};

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(() => App.init(), 1);
} else {
    document.addEventListener('DOMContentLoaded', () => App.init());
}
