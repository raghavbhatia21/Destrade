/**
 * Destrade Pro — NSE API Layer (v6)
 * OI Clock, PCR, Volume Shockers, 52W Scanners, Live Search, Smart Caching
 */

class NSEApi {
    constructor() {
        const isCapacitor = !!(window.Capacitor || window.location.protocol === 'capacitor:' || window.location.href?.includes('android_asset'));
        const host = window.location.hostname;
        const isLocalDevServer = !isCapacitor && (host === 'localhost' || host === '127.0.0.1' || /^192\.168\./.test(host) || /^10\./.test(host) || host.endsWith('.local'));
        
        // Use local dev server if running node server locally on desktop, otherwise stream directly via Groww & Firebase
        if (isLocalDevServer && window.location.port) {
            this.proxyUrl = `${window.location.protocol}//${window.location.host}`;
        } else {
            this.proxyUrl = '';
        }
        this.isCapacitor = isCapacitor;
        this._cache = new Map();
        this._cacheTTL = 800; // 0.8s cache TTL for 1s real-time streaming
        this.fnoSymbols = ["360ONE","ABB","ABCAPITAL","ADANIENSOL","ADANIENT","ADANIGREEN","ADANIPORTS","ADANIPOWER","ALKEM","AMBER","AMBUJACEM","ANGELONE","APLAPOLLO","APOLLOHOSP","ASHOKLEY","ASIANPAINT","ASTRAL","ATHERENERG","AUBANK","AUROPHARMA","AXISBANK","BAJAJ-AUTO","BAJAJFINSV","BAJAJHLDNG","BAJFINANCE","BANDHANBNK","BANKBARODA","BANKINDIA","BANKNIFTY","BDL","BEL","BHARATFORG","BHARTIARTL","BHEL","BIOCON","BLUESTARCO","BOSCHLTD","BPCL","BRITANNIA","BSE","CAMS","CANBK","CDSL","CGPOWER","CHOLAFIN","CIPLA","COALINDIA","COCHINSHIP","COFORGE","COLPAL","CONCOR","CROMPTON","CUMMINSIND","DABUR","DELHIVERY","DIVISLAB","DIXON","DLF","DMART","DRREDDY","EICHERMOT","ETERNAL","FEDERALBNK","FINNIFTY","FORCEMOT","FORTIS","GAIL","GLENMARK","GMRAIRPORT","GODFRYPHLP","GODREJCP","GODREJPROP","GRASIM","GVT&D","HAL","HAVELLS","HCLTECH","HDFCAMC","HDFCBANK","HDFCLIFE","HEROMOTOCO","HINDALCO","HINDPETRO","HINDUNILVR","HINDZINC","HYUNDAI","ICICIBANK","ICICIGI","ICICIPRULI","IDEA","IDFCFIRSTB","IEX","INDHOTEL","INDIANB","INDIGO","INDUSINDBK","INDUSTOWER","INFY","INOXWIND","IOC","IREDA","IRFC","ITC","JINDALSTEL","JIOFIN","JSWENERGY","JSWSTEEL","JUBLFOOD","KALYANKJIL","KAYNES","KEI","KFINTECH","KOTAKBANK","KPITTECH","LAURUSLABS","LICHSGFIN","LICI","LODHA","LT","LTF","LTM","LUPIN","M&M","MAHABANK","MANAPPURAM","MANKIND","MARICO","MARUTI","MAXHEALTH","MAZDOCK","MCX","MFSL","MIDCPNIFTY","MOTHERSON","MOTILALOFS","MPHASIS","MUTHOOTFIN","NAM-INDIA","NATIONALUM","NAUKRI","NBCC","NESTLEIND","NHPC","NIFTY","NIFTYNXT50","NMDC","NTPC","NYKAA","OBEROIRLTY","OFSS","OIL","ONGC","PAGEIND","PATANJALI","PAYTM","PERSISTENT","PETRONET","PFC","PGEL","PHOENIXLTD","PIDILITIND","PIIND","PNB","PNBHOUSING","POLICYBZR","POLYCAB","POWERGRID","POWERINDIA","PREMIERENE","PRESTIGE","RADICO","RBLBANK","RECLTD","RELIANCE","RVNL","SAGILITY","SAIL","SBICARD","SBILIFE","SBIN","SHREECEM","SHRIRAMFIN","SIEMENS","SOLARINDS","SONACOMS","SRF","SUNPHARMA","SUPREMEIND","SUZLON","SWIGGY","TATACONSUM","TATAELXSI","TATAPOWER","TATASTEEL","TCS","TECHM","TIINDIA","TITAN","TMPV","TORNTPHARM","TRENT","TVSMOTOR","ULTRACEMCO","UNIONBANK","UNITDSPR","UNOMINDA","UPL","VBL","VEDL","VMM","VOLTAS","WAAREEENER","WIPRO","YESBANK","ZYDUSLIFE"];
        this.proxyDetails = { status: 'Checking...', lastError: null };
        this.dynamicSlugMap = new Map();
        this.config = {
            source: 'groww', // 'nse' or 'groww'
            preferGrowwForOptionChain: true
        };
    }

    async checkProxy() {
        if (this.proxyUrl) {
            try {
                const res = await fetch(`${this.proxyUrl}/api/health`, { signal: AbortSignal.timeout(2500) });
                const text = await res.text();
                // Guard: if health endpoint returns HTML (e.g. SPA fallback), proxy is not running
                if (text.trim().startsWith('<')) throw new Error('HTML response');
                const data = JSON.parse(text);
                if (data.status === 'ok') {
                    this.proxyDetails = {
                        status: 'Connected',
                        session: data.session || 'unknown',
                        cached: data.cached || 0,
                        lastError: null
                    };
                    return true;
                }
            } catch (e) {}
        }

        // Local proxy is NOT available — clear proxyUrl so _fetch() and runNse skip dead localhost calls
        this.proxyUrl = '';
        this.proxyDetails = { status: 'Direct Stream (Groww)', session: 'direct', cached: 0, lastError: null };
        this.config.source = 'groww';
        return true;
    }

    async _fetch(endpoint, retries = 2, backoff = 1000) {
        // NSE endpoints require a local dev-proxy to bypass CORS/WAF. Skip entirely if no proxy.
        if (!this.proxyUrl) return null;

        const isOC = endpoint.includes('option-chain') || endpoint.includes('quote-equity');
        const cacheKey = `nse_${endpoint}`;
        if (this._cache.has(cacheKey)) {
            const entry = this._cache.get(cacheKey);
            if (Date.now() - entry.time < this._cacheTTL) return entry.data;
        }

        // De-duplicate concurrent identical in-flight fetches
        if (this._inFlight && this._inFlight.has(endpoint)) {
            return this._inFlight.get(endpoint);
        }

        if (!this._inFlight) this._inFlight = new Map();

        const fetchPromise = (async () => {
            const url = `${this.proxyUrl}${endpoint}`;
            for (let i = 0; i <= retries; i++) {
                try {
                    const res = await fetch(url, { signal: AbortSignal.timeout(isOC ? 7000 : 5000) });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const text = await res.text();
                    if (text.trim().startsWith('<')) throw new Error('Proxy returned HTML');
                    const data = JSON.parse(text);
                    this._cache.set(cacheKey, { data, time: Date.now() });
                    this.proxyDetails.status = 'Connected';
                    this.proxyDetails.lastError = null;
                    return data;
                } catch (e) {
                    if (i < retries) {
                        await new Promise(r => setTimeout(r, backoff * (i + 1)));
                    }
                }
            }
            return null;
        })().finally(() => {
            if (this._inFlight) this._inFlight.delete(endpoint);
        });

        this._inFlight.set(endpoint, fetchPromise);
        return fetchPromise;
    }

    async _fetchGroww(path) {
        const rawUrl = path.startsWith('http') ? path : `https://groww.in${path.startsWith('/') ? '' : '/'}${path}`;

        // 1. Local Node Dev-Proxy (when running local server on desktop)
        if (this.proxyUrl) {
            try {
                const localUrl = `${this.proxyUrl}/api/proxy?url=${encodeURIComponent(rawUrl)}`;
                const res = await fetch(localUrl, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
                if (res.ok) {
                    const text = await res.text();
                    if (text && !text.trim().startsWith('<')) {
                        const data = JSON.parse(text);
                        if (data && !data.error && !data.errorCode) return data;
                    }
                }
            } catch (e) {}
        }

        // 2. Cloud CORS Proxy (Fast & Reliable on mobile WebView & remote web)
        try {
            const cloudUrl = `https://destrade-market-worker.onrender.com/api/proxy?url=${encodeURIComponent(rawUrl)}`;
            const res = await fetch(cloudUrl, { cache: 'no-store', signal: AbortSignal.timeout(7000) });
            if (res.ok) {
                const text = await res.text();
                if (text && !text.trim().startsWith('<')) {
                    const data = JSON.parse(text);
                    if (data && !data.error && !data.errorCode) return data;
                }
            }
        } catch (e) {}

        return null;
    }

    // ===== GROWW LIVE PRICE (Index + Stock) =====
    async getLivePriceGroww(symbol = 'NIFTY') {
        const up = symbol.toUpperCase();
        const indices = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
        const isIndex = indices.includes(up);

        let ticker = up;
        let endpoint;

        if (isIndex) {
            // Indices: use tr_live_indices
            endpoint = `/v1/api/stocks_data/v1/tr_live_indices/exchange/NSE/segment/CASH/${ticker}/latest`;
        } else {
            // Stocks: use tr_live_prices with NSE ticker directly
            endpoint = `/v1/api/stocks_data/v1/tr_live_prices/exchange/NSE/segment/CASH/${ticker}/latest`;
        }

        const d = await this._fetchGroww(endpoint);

        if (isIndex) {
            return d?.value || d?.lastPrice || d?.ltp || 0;
        } else {
            return d?.ltp || d?.lastPrice || d?.value || 0;
        }
    }

    // ===== MARKET STATUS =====
    async getMarketStatus() {
        if (!this.proxyUrl) {
            // Netlify fallback: estimate market status locally to prevent WAF 403
            const now = new Date();
            const day = now.getDay();
            const hours = now.getHours();
            const minutes = now.getMinutes();
            const timeVal = hours * 100 + minutes;
            
            let status = 'Closed';
            if (day >= 1 && day <= 5) {
                if (timeVal >= 915 && timeVal <= 1530) {
                    status = 'Open';
                }
            }
            return { marketStatus: status, market: 'Capital Market' };
        }
        const d = await this._fetch('/marketStatus');
        return d?.marketState?.[0] || { marketStatus: 'Closed', market: 'Capital Market' };
    }



    // Universal Snapshot Normalizer: seamless support for both Ultra-Compact Array & Legacy Object formats
    normalizeSnapshotItem(s) {
        if (!s) return null;
        if (Array.isArray(s)) {
            const curTime = s[0] || 0;
            const curVal = s[1] || 0;
            const curSpot = s[2] || 0;
            const curTimeStr = s[3] || '';
            const m5Val = s[4] || 0;
            const m15Val = s[5] || 0;
            const m30Val = s[6] || 0;
            const h1Val = s[7] || 0;
            const m5Spot = s[12] || 0;
            const m15Spot = s[13] || 0;
            const m30Spot = s[14] || 0;
            const h1Spot = s[15] || 0;

            return {
                curTime,
                curVal,
                curSpot,
                curTimeStr,
                m5: m5Val > 0 ? [s[8] || (curTime - 300), m5Val, m5Spot || curSpot] : null,
                m15: m15Val > 0 ? [s[9] || (curTime - 900), m15Val, m15Spot || curSpot] : null,
                m30: m30Val > 0 ? [s[10] || (curTime - 1800), m30Val, m30Spot || curSpot] : null,
                h: h1Val > 0 ? [s[11] || (curTime - 3600), h1Val, h1Spot || curSpot] : null,
                c: [curTime, curVal, curSpot, curTimeStr],
                cur: { time: curTime, value: curVal, spot: curSpot, timeStr: curTimeStr },
                h1: { time: s[11] || 0, value: h1Val, spot: h1Spot }
            };
        }

        const curVal = s.c ? s.c[1] : (s.cur ? s.cur.value : 0);
        const curSpot = s.c ? s.c[2] : (s.cur ? s.cur.spot : 0);
        const curTime = s.c ? s.c[0] : (s.cur ? s.cur.time : 0);
        const curTimeStr = s.c ? s.c[3] : (s.cur ? s.cur.timeStr : '');
        const h1Val = s.h ? s.h[1] : (s.h1 ? s.h1.value : 0);
        const h1Spot = s.h ? s.h[2] : (s.h1 ? s.h1.spot : 0);
        const h1Time = s.h ? s.h[0] : (s.h1 ? s.h1.time : 0);

        return {
            curTime,
            curVal,
            curSpot,
            curTimeStr,
            m5: s.m5 || null,
            m15: s.m15 || null,
            m30: s.m30 || null,
            h: s.h || (h1Val > 0 ? [h1Time, h1Val, h1Spot] : null),
            c: s.c || [curTime, curVal, curSpot, curTimeStr],
            cur: s.cur || { time: curTime, value: curVal, spot: curSpot, timeStr: curTimeStr },
            h1: s.h1 || { time: h1Time, value: h1Val, spot: h1Spot }
        };
    }

    // ===== ROBUST STOCK DATA FETCH & MERGE =====
    async _getRawStockDataAndOI() {
        if (this._rawStockCache && (Date.now() - (this._rawStockCacheTime || 0) < 10000)) {
            return this._rawStockCache;
        }

        const growwGainersEp = '/v1/api/stocks_fo_data/v1/live-aggregations/explore/market_trends/instrument/STOCKS?exchange=NSE&interval=ONE_DAY&limit=300&marketTrendFactor=PRICE&type=GAINERS';
        const growwLosersEp = '/v1/api/stocks_fo_data/v1/live-aggregations/explore/market_trends/instrument/STOCKS?exchange=NSE&interval=ONE_DAY&limit=300&marketTrendFactor=PRICE&type=LOSERS';

        const runNse = !!this.proxyUrl;

        const [growwGainers, growwLosers, gainersData, loosersData, oiData, underData] = await Promise.all([
            this._fetchGroww(growwGainersEp).catch(() => null),
            this._fetchGroww(growwLosersEp).catch(() => null),
            runNse ? this._fetch('/live-analysis-variations?index=gainers').catch(() => null) : Promise.resolve(null),
            runNse ? this._fetch('/live-analysis-variations?index=loosers').catch(() => null) : Promise.resolve(null),
            runNse ? this._fetch('/live-analysis-oi-spurts-underlyings').catch(() => null) : Promise.resolve(null),
            runNse ? this._fetch('/underlying-information').catch(() => null) : Promise.resolve(null)
        ]);

        const stockMap = new Map();
        const discovered = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];

        // 1. Populate from Groww Market Trends (Pure F&O Gainers & Losers)
        const growwList = [
            ...(growwGainers?.companyDetailsList || []),
            ...(growwLosers?.companyDetailsList || [])
        ];

        growwList.forEach(item => {
            const sym = item.identifier || item.symbol;
            if (sym && sym !== 'NIFTY 50' && sym !== 'NIFTY BANK') {
                if (item.searchId) {
                    this.dynamicSlugMap.set(sym.toUpperCase(), item.searchId);
                }
                stockMap.set(sym, {
                    symbol: sym,
                    lastPrice: item.livePriceDetailsDto?.ltp || 0,
                    pChange: item.livePriceDetailsDto?.dayChangePerc || 0,
                    totalTradedVolume: item.livePriceDetailsDto?.volume || 0,
                    yearHigh: 0,
                    yearLow: 0
                });
                if (!discovered.includes(sym)) discovered.push(sym);
            }
        });

        // 2. Merge F&O variations (FOSec only, not cash market allSec)
        const foVariations = [
            ...(gainersData?.FOSec?.data || []),
            ...(loosersData?.FOSec?.data || [])
        ];

        foVariations.forEach(item => {
            if (item.symbol && item.symbol !== 'NIFTY 50' && item.symbol !== 'NIFTY BANK') {
                const existing = stockMap.get(item.symbol) || {};
                stockMap.set(item.symbol, {
                    symbol: item.symbol,
                    lastPrice: existing.lastPrice || item.ltp || item.open_price || 0,
                    pChange: existing.pChange !== undefined ? existing.pChange : (item.perChange || 0),
                    totalTradedVolume: existing.totalTradedVolume || item.trade_quantity || 0,
                    yearHigh: existing.yearHigh || 0,
                    yearLow: existing.yearLow || 0
                });
                if (!discovered.includes(item.symbol)) discovered.push(item.symbol);
            }
        });

        // 3. Add NSE Underlying List for complete F&O contract discovery
        if (underData?.data?.UnderlyingList) {
            underData.data.UnderlyingList.forEach(u => {
                if (u.symbol && !discovered.includes(u.symbol)) discovered.push(u.symbol);
            });
        }

        // 4. Resilient Fallback: Populate stockMap directly from App._liveSnapshot (215 symbols)
        if (window.App && window.App._liveSnapshot) {
            const snap = window.App._liveSnapshot;
            Object.keys(snap).forEach(sym => {
                if (!this.fnoSymbols.includes(sym)) return;
                const norm = this.normalizeSnapshotItem(snap[sym]);
                if (!norm || norm.curSpot <= 0) return;

                const curSpot = norm.curSpot;
                const h1Spot = norm.h ? norm.h[2] : curSpot;
                let diff = curSpot - h1Spot;
                let curPcr = norm.curVal || 1.0;
                let h1Pcr = norm.h ? norm.h[1] : curPcr;
                let pcrDiff = curPcr - h1Pcr;

                // Off-market / weekend fallback: if spot price has 0 diff, compute bias from PCR & 5m/15m/30m trends
                if (Math.abs(diff) < 0.001) {
                    const m5Spot = norm.m5 ? norm.m5[2] : 0;
                    const m15Spot = norm.m15 ? norm.m15[2] : 0;
                    const spotRef = m15Spot || m5Spot || curSpot;
                    diff = curSpot - spotRef;
                    if (Math.abs(diff) < 0.001) {
                        diff = pcrDiff !== 0 ? pcrDiff : (curPcr >= 1.0 ? 0.05 : -0.05);
                    }
                }

                const pChange = h1Spot > 0 ? ((diff / h1Spot) * 100) : (diff > 0 ? 0.2 : -0.2);

                stockMap.set(sym, {
                    symbol: sym,
                    lastPrice: curSpot,
                    pChange: pChange,
                    totalTradedVolume: Math.round(100000 + Math.abs(pcrDiff * 500000)),
                    yearHigh: curSpot * 1.05,
                    yearLow: curSpot * 0.95
                });
            });
        }

        const result = {
            stocks: Array.from(stockMap.values()),
            oiData: oiData?.data || []
        };
        // Only cache if we got meaningful data — never cache empty results
        if (result.stocks.length > 5) {
            this._rawStockCache = result;
            this._rawStockCacheTime = Date.now();
        }
        return result;
    }

    // ===== SCREENER & ANALYSIS DATA =====
    async getScreenerData() {
        const { stocks, oiData } = await this._getRawStockDataAndOI();

        if (!stocks || stocks.length === 0) {
            return { longBuildup: [], shortBuildup: [], high52w: [], low52w: [], volumeShockers: [], priceSurges: [], all: [] };
        }

        const oiMap = new Map();
        if (oiData) {
            oiData.forEach(item => oiMap.set(item.symbol, item));
        }

        const all = stocks.map(s => {
            const pc = s.pChange || 0;
            const oi = oiMap.get(s.symbol);
            const oic = oi ? (oi.pChange || 0) : 0;
            return {
                symbol: s.symbol,
                price: s.lastPrice || 0,
                pChange: pc,
                oiChange: oic,
                oiValue: oi ? (oi.latestOI || 0) : 0,
                volume: s.totalTradedVolume || 0,
                tag: this._deriveBuildup(pc, oic),
                yearHigh: s.yearHigh || 0,
                yearLow: s.yearLow || 0
            };
        });

        return {
            longBuildup: all.filter(s => s.tag === 'Long Buildup' || (s.pChange > 0 && s.price > 0)).sort((a, b) => b.pChange - a.pChange),
            shortBuildup: all.filter(s => s.tag === 'Short Buildup' || (s.pChange < 0 && s.price > 0)).sort((a, b) => a.pChange - b.pChange),
            high52w: all.filter(s => s.yearHigh > 0 && s.price >= (s.yearHigh * 0.98)).sort((a, b) => b.pChange - a.pChange),
            low52w: all.filter(s => s.yearLow > 0 && s.price <= (s.yearLow * 1.02)).sort((a, b) => a.pChange - b.pChange),
            volShockers: [...all].sort((a, b) => b.volume - a.volume).slice(0, 15),
            priceSurges: [...all].sort((a, b) => b.pChange - a.pChange).slice(0, 15),
            all: all
        };
    }

    _deriveBuildup(priceChange, oiChange) {
        if (oiChange > 0) {
            return priceChange >= 0 ? 'Long Buildup' : 'Short Buildup';
        } else if (oiChange < 0) {
            return priceChange >= 0 ? 'Short Covering' : 'Long Unwinding';
        }
        
        // Smart fallback when live OI spurt API is offline/closed:
        if (priceChange > 2.0) return 'Long Buildup';
        if (priceChange < -2.0) return 'Short Buildup';
        if (priceChange > 0) return 'Short Covering';
        if (priceChange < 0) return 'Long Unwinding';
        return 'Neutral';
    }

    // ===== MARKET PULSE =====
    async getMarketPulse() {
        const { stocks, oiData } = await this._getRawStockDataAndOI();

        if (!stocks || stocks.length === 0) {
            return { trend: 'NEUTRAL', advances: 0, declines: 0, unchanged: 0, ratio: '1.00', newHighs: 0, newLows: 0, volShockers: 0, longBuildups: 0, shortBuildups: 0 };
        }

        const oiMap = new Map();
        if (oiData) {
            oiData.forEach(item => oiMap.set(item.symbol, item));
        }

        const adv = stocks.filter(s => (s.pChange || 0) > 0).length;
        const dec = stocks.filter(s => (s.pChange || 0) < 0).length;
        const unc = stocks.length - adv - dec;

        const avgVol = stocks.reduce((a, b) => a + (b.totalTradedVolume || 0), 0) / (stocks.length || 1);
        const volShockers = stocks.filter(s => (s.totalTradedVolume || 0) > avgVol * 1.8).length;

        const enriched = stocks.map(s => {
            const oi = oiMap.get(s.symbol);
            return {
                ...s,
                oiChange: oi ? (oi.avgInOI || 0) : 0
            };
        });

        let longB = enriched.filter(s => (s.pChange || 0) > 0 && (s.oiChange || 0) > 0).length;
        let shortB = enriched.filter(s => (s.pChange || 0) < 0 && (s.oiChange || 0) > 0).length;

        if (longB === 0 && shortB === 0 && stocks.length > 0) {
            longB = stocks.filter(s => (s.pChange || 0) > 0.25).length;
            shortB = stocks.filter(s => (s.pChange || 0) < -0.25).length;
        }

        return {
            trend: adv > dec * 1.2 ? 'BULLISH' : dec > adv * 1.2 ? 'BEARISH' : 'NEUTRAL',
            advances: adv, declines: dec, unchanged: unc,
            ratio: (adv / (dec || 1)).toFixed(2),
            newHighs: stocks.filter(s => (s.yearHigh || 0) > 0 && (s.lastPrice || 0) >= ((s.yearHigh || 0) * 0.98)).length,
            newLows: stocks.filter(s => (s.yearLow || 0) > 0 && (s.lastPrice || 0) <= ((s.yearLow || 0) * 1.02)).length,
            volShockers,
            longBuildups: longB,
            shortBuildups: shortB
        };
    }

    // ===== SECTORS =====
    async getSectors() {
        const d = await this._fetch('/allIndices');
        if (d?.data && d.data.length > 0) {
            const names = ['NIFTY BANK', 'NIFTY IT', 'NIFTY AUTO', 'NIFTY PHARMA', 'NIFTY METAL', 'NIFTY FMCG', 'NIFTY REALTY', 'NIFTY ENERGY', 'NIFTY MEDIA'];
            return d.data.filter(i => names.includes(i.index)).map(s => ({
                name: s.index, label: s.index.replace('NIFTY ', ''),
                price: s.last || s.lastPrice || 0, change: s.percentChange || s.pChange || 0,
                open: s.open || 0, high: s.high || 0, low: s.low || 0
            }));
        }

        // Resilient fallback when /allIndices is unreachable
        const { stocks } = await this._getRawStockDataAndOI();
        if (!stocks || stocks.length === 0) return [];

        const mapping = {
            'BANK': ['HDFCBANK', 'ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK'],
            'IT': ['TCS', 'INFY', 'HCLTECH', 'WIPRO', 'TECHM'],
            'AUTO': ['MARUTI', 'TATAMOTORS', 'M&M', 'BAJAJ-AUTO'],
            'PHARMA': ['SUNPHARMA', 'CIPLA', 'DRREDDY', 'DIVISLAB'],
            'METAL': ['TATASTEEL', 'HINDALCO', 'JSWSTEEL', 'COALINDIA'],
            'FMCG': ['HINDUNILVR', 'ITC', 'NESTLEIND', 'BRITANNIA'],
            'REALTY': ['DLF', 'GODREJPROP', 'OBEROIRLTY'],
            'ENERGY': ['RELIANCE', 'ONGC', 'NTPC', 'POWERGRID'],
            'MEDIA': ['ZEEL', 'PVRINOX', 'SUNTV']
        };

        const stockMap = new Map(stocks.map(s => [s.symbol, s]));
        const sectors = [];

        for (const [secLabel, syms] of Object.entries(mapping)) {
            const matched = syms.map(s => stockMap.get(s)).filter(Boolean);
            if (matched.length > 0) {
                const avgChg = matched.reduce((a, b) => a + (b.pChange || 0), 0) / matched.length;
                const avgPrice = matched.reduce((a, b) => a + (b.price || 0), 0) / matched.length;
                sectors.push({
                    name: `NIFTY ${secLabel}`,
                    label: secLabel,
                    price: Math.round(avgPrice),
                    change: avgChg,
                    open: Math.round(avgPrice),
                    high: Math.round(avgPrice * 1.01),
                    low: Math.round(avgPrice * 0.99)
                });
            }
        }
        return sectors;
    }

    async getLiveQuoteGroww(symbol = 'NIFTY') {
        const up = symbol.toUpperCase();
        const indices = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
        const isIndex = indices.includes(up);

        let ticker = up;
        let endpoint;

        if (isIndex) {
            endpoint = `/v1/api/stocks_data/v1/tr_live_indices/exchange/NSE/segment/CASH/${ticker}/latest`;
        } else {
            endpoint = `/v1/api/stocks_data/v1/tr_live_prices/exchange/NSE/segment/CASH/${ticker}/latest`;
        }

        const d = await this._fetchGroww(endpoint);
        if (!d) return null;

        return {
            lastPrice: d.ltp || d.value || d.lastPrice || 0,
            pChange: d.dayChangePerc || 0,
            change: d.dayChange || 0,
            open: d.open || 0,
            high: d.high || 0,
            low: d.low || 0,
            previousClose: d.close || 0,
            yearHigh: d.yearHighPrice || 0,
            yearLow: d.yearLowPrice || 0,
            volume: d.volume || 0
        };
    }

    async getAllIndices() {
        const mainIndices = [
            { index: 'NIFTY 50', symbol: 'NIFTY' },
            { index: 'NIFTY BANK', symbol: 'BANKNIFTY' },
            { index: 'NIFTY FINANCIAL SERVICES', symbol: 'FINNIFTY' },
            { index: 'NIFTY MIDCAP 100', symbol: 'MIDCPNIFTY' }
        ];

        if (window.App && window.App._liveSnapshot) {
            const snap = window.App._liveSnapshot;
            const list = mainIndices.map(item => {
                const norm = this.normalizeSnapshotItem(snap[item.symbol]);
                if (!norm || norm.curSpot <= 0) return null;
                const curSpot = norm.curSpot;
                const h1Spot = norm.h ? norm.h[2] : curSpot;
                const diff = curSpot - h1Spot;
                const pChange = h1Spot > 0 ? ((diff / h1Spot) * 100) : 0;
                return {
                    index: item.index,
                    last: curSpot,
                    pChange: pChange,
                    open: h1Spot,
                    high: Math.max(curSpot, h1Spot),
                    low: Math.min(curSpot, h1Spot)
                };
            }).filter(Boolean);

            if (list.length > 0) return list;
        }

        const d = await this._fetch('/allIndices');
        if (d && d.data && Array.isArray(d.data) && d.data.length > 0) {
            return d.data;
        }

        const results = await Promise.all(mainIndices.map(async item => {
            try {
                const q = await this.getLiveQuoteGroww(item.symbol);
                if (q && q.lastPrice > 0) {
                    return {
                        index: item.index,
                        last: q.lastPrice,
                        pChange: q.pChange,
                        open: q.open || q.lastPrice,
                        high: q.high || q.lastPrice,
                        low: q.low || q.lastPrice
                    };
                }
            } catch (e) {}
            return null;
        }));

        return results.filter(Boolean);
    }

    // ===== QUOTE =====
    async getQuote(symbol) {
        const up = symbol.toUpperCase();
        const isIdx = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'].some(k => up.includes(k));
        if (isIdx) {
            const indices = await this.getAllIndices();
            const clean = up.includes('BANK') ? 'NIFTY BANK' : up.includes('50') || up === 'NIFTY' ? 'NIFTY 50' : up;
            const found = indices?.find(i => i.index === clean || i.index === up);
            if (found && found.last > 0) {
                return { lastPrice: found.last, pChange: found.pChange, open: found.open, high: found.high, low: found.low, previousClose: found.previousClose };
            }
        }
        return await this.getLiveQuoteGroww(up);
    }

    getGrowwMap() {
        return {
            '360ONE': { slug: 'iifl-wealth-management-ltd-1568865430949', type: 'STOCKS' },
            'ABB': { slug: 'abb-india-ltd', type: 'STOCKS' },
            'ABCAPITAL': { slug: 'aditya-birla-capital-ltd', type: 'STOCKS' },
            'ADANIENSOL': { slug: 'adani-transmission-ltd', type: 'STOCKS' },
            'ADANIENT': { slug: 'adani-enterprises-ltd', type: 'STOCKS' },
            'ADANIGREEN': { slug: 'adani-green-energy-ltd', type: 'STOCKS' },
            'ADANIPORTS': { slug: 'adani-ports-and-special-economic-zone-ltd', type: 'STOCKS' },
            'ADANIPOWER': { slug: 'adani-power-ltd', type: 'STOCKS' },
            'ALKEM': { slug: 'alkem-laboratories-ltd', type: 'STOCKS' },
            'AMBER': { slug: 'amber-enterprises-india-ltd', type: 'STOCKS' },
            'AMBUJACEM': { slug: 'ambuja-cements-ltd', type: 'STOCKS' },
            'ANGELONE': { slug: 'angel-broking-ltd', type: 'STOCKS' },
            'APLAPOLLO': { slug: 'apl-apollo-tubes-ltd', type: 'STOCKS' },
            'APOLLOHOSP': { slug: 'apollo-hospitals-enterprise-ltd', type: 'STOCKS' },
            'ASHOKLEY': { slug: 'ashok-leyland-ltd', type: 'STOCKS' },
            'ASIANPAINT': { slug: 'asian-paints-ltd', type: 'STOCKS' },
            'ASTRAL': { slug: 'astral-poly-technik-ltd', type: 'STOCKS' },
            'ATHERENERG': { slug: 'ather-energy-ltd', type: 'STOCKS' },
            'AUBANK': { slug: 'au-small-finance-bank-ltd', type: 'STOCKS' },
            'AUROPHARMA': { slug: 'aurobindo-pharma-ltd', type: 'STOCKS' },
            'AXISBANK': { slug: 'axis-bank-ltd', type: 'STOCKS' },
            'BAJAJ-AUTO': { slug: 'bajaj-auto-ltd', type: 'STOCKS' },
            'BAJAJFINSV': { slug: 'bajaj-finserv-ltd', type: 'STOCKS' },
            'BAJAJHLDNG': { slug: 'bajaj-holdings-investment-ltd', type: 'STOCKS' },
            'BAJFINANCE': { slug: 'bajaj-finance-ltd', type: 'STOCKS' },
            'BANDHANBNK': { slug: 'bandhan-bank-ltd', type: 'STOCKS' },
            'BANKBARODA': { slug: 'bank-of-baroda', type: 'STOCKS' },
            'BANKINDIA': { slug: 'bank-of-india', type: 'STOCKS' },
            'BANKNIFTY': { slug: 'nifty-bank', type: 'INDICES' },
            'BDL': { slug: 'bharat-dynamics-ltd', type: 'STOCKS' },
            'BEL': { slug: 'bharat-electronics-ltd', type: 'STOCKS' },
            'BHARATFORG': { slug: 'bharat-forge-ltd', type: 'STOCKS' },
            'BHARTIARTL': { slug: 'bharti-airtel-ltd', type: 'STOCKS' },
            'BHEL': { slug: 'bharat-heavy-electricals-ltd', type: 'STOCKS' },
            'BIOCON': { slug: 'biocon-ltd', type: 'STOCKS' },
            'BLUESTARCO': { slug: 'blue-star-ltd', type: 'STOCKS' },
            'BOSCHLTD': { slug: 'bosch-ltd', type: 'STOCKS' },
            'BPCL': { slug: 'bharat-petroleum-corporation-ltd', type: 'STOCKS' },
            'BRITANNIA': { slug: 'britannia-industries-ltd', type: 'STOCKS' },
            'BSE': { slug: 'bse-ltd', type: 'STOCKS' },
            'CAMS': { slug: 'computer-age-management-services-ltd', type: 'STOCKS' },
            'CANBK': { slug: 'canara-bank', type: 'STOCKS' },
            'CDSL': { slug: 'central-depository-services-india-ltd', type: 'STOCKS' },
            'CGPOWER': { slug: 'cg-power-industrial-solutions-ltd', type: 'STOCKS' },
            'CHOLAFIN': { slug: 'cholamandalam-investment-finance-company-ltd', type: 'STOCKS' },
            'CIPLA': { slug: 'cipla-ltd', type: 'STOCKS' },
            'COALINDIA': { slug: 'coal-india-ltd', type: 'STOCKS' },
            'COCHINSHIP': { slug: 'cochin-shipyard-ltd', type: 'STOCKS' },
            'COFORGE': { slug: 'niit-technologies-ltd', type: 'STOCKS' },
            'COLPAL': { slug: 'colgatepalmolive-india-ltd', type: 'STOCKS' },
            'CONCOR': { slug: 'container-corporation-of-india-ltd', type: 'STOCKS' },
            'CROMPTON': { slug: 'crompton-greaves-consumer-electricals-ltd', type: 'STOCKS' },
            'CUMMINSIND': { slug: 'cummins-india-ltd', type: 'STOCKS' },
            'DABUR': { slug: 'dabur-india-ltd', type: 'STOCKS' },
            'DELHIVERY': { slug: 'delhivery-ltd', type: 'STOCKS' },
            'DIVISLAB': { slug: 'divis-laboratories-ltd', type: 'STOCKS' },
            'DIXON': { slug: 'dixon-technologies-india-ltd', type: 'STOCKS' },
            'DLF': { slug: 'dlf-ltd', type: 'STOCKS' },
            'DMART': { slug: 'avenue-supermarts-ltd', type: 'STOCKS' },
            'DRREDDY': { slug: 'dr-reddys-laboratories-ltd', type: 'STOCKS' },
            'EICHERMOT': { slug: 'eicher-motors-ltd', type: 'STOCKS' },
            'ETERNAL': { slug: 'zomato-ltd', type: 'STOCKS' },
            'FEDERALBNK': { slug: 'the-federal-bank-ltd', type: 'STOCKS' },
            'FINNIFTY': { slug: 'nifty-financial-services', type: 'INDICES' },
            'FORCEMOT': { slug: 'force-motors-ltd', type: 'STOCKS' },
            'FORTIS': { slug: 'fortis-healthcare-ltd', type: 'STOCKS' },
            'GAIL': { slug: 'gail-india-ltd', type: 'STOCKS' },
            'GLENMARK': { slug: 'glenmark-pharmaceuticals-ltd', type: 'STOCKS' },
            'GMRAIRPORT': { slug: 'gmr-infrastructure-ltd', type: 'STOCKS' },
            'GODFRYPHLP': { slug: 'godfrey-phillips-india-ltd', type: 'STOCKS' },
            'GODREJCP': { slug: 'godrej-consumer-products-ltd', type: 'STOCKS' },
            'GODREJPROP': { slug: 'godrej-properties-ltd', type: 'STOCKS' },
            'GRASIM': { slug: 'grasim-industries-ltd', type: 'STOCKS' },
            'GVT&D': { slug: 'ge-td-india-ltd', type: 'STOCKS' },
            'HAL': { slug: 'hindustan-aeronautics-ltd', type: 'STOCKS' },
            'HAVELLS': { slug: 'havells-india-ltd', type: 'STOCKS' },
            'HCLTECH': { slug: 'hcl-technologies-ltd', type: 'STOCKS' },
            'HDFCAMC': { slug: 'hdfc-asset-management-company-ltd', type: 'STOCKS' },
            'HDFCBANK': { slug: 'hdfc-bank-ltd', type: 'STOCKS' },
            'HDFCLIFE': { slug: 'hdfc-standard-life-insurance-co-ltd', type: 'STOCKS' },
            'HEROMOTOCO': { slug: 'hero-motocorp-ltd', type: 'STOCKS' },
            'HINDALCO': { slug: 'hindalco-industries-ltd', type: 'STOCKS' },
            'HINDPETRO': { slug: 'hindustan-petroleum-corporation-ltd', type: 'STOCKS' },
            'HINDUNILVR': { slug: 'hindustan-unilever-ltd', type: 'STOCKS' },
            'HINDZINC': { slug: 'hindustan-zinc-ltd', type: 'STOCKS' },
            'HYUNDAI': { slug: 'hyundai-motor-india-ltd', type: 'STOCKS' },
            'ICICIBANK': { slug: 'icici-bank-ltd', type: 'STOCKS' },
            'ICICIGI': { slug: 'icici-lombard-general-insurance-co-ltd', type: 'STOCKS' },
            'ICICIPRULI': { slug: 'icici-prudential-life-insurance-company-ltd', type: 'STOCKS' },
            'IDEA': { slug: 'vodafone-idea-ltd', type: 'STOCKS' },
            'IDFCFIRSTB': { slug: 'idfc-bank-ltd', type: 'STOCKS' },
            'IEX': { slug: 'indian-energy-exchange-ltd', type: 'STOCKS' },
            'INDHOTEL': { slug: 'the-indian-hotels-company-ltd', type: 'STOCKS' },
            'INDIANB': { slug: 'indian-bank', type: 'STOCKS' },
            'INDIGO': { slug: 'interglobe-aviation-ltd', type: 'STOCKS' },
            'INDUSINDBK': { slug: 'indusind-bank-ltd', type: 'STOCKS' },
            'INDUSTOWER': { slug: 'bharti-infratel-ltd', type: 'STOCKS' },
            'INFY': { slug: 'infosys-ltd', type: 'STOCKS' },
            'INOXWIND': { slug: 'inox-wind-ltd', type: 'STOCKS' },
            'IOC': { slug: 'indian-oil-corporation-ltd', type: 'STOCKS' },
            'IREDA': { slug: 'indian-renewable-energy-development-agency-ltd-1569588972606', type: 'STOCKS' },
            'IRFC': { slug: 'indian-railway-finance-corporation-ltd', type: 'STOCKS' },
            'ITC': { slug: 'itc-ltd', type: 'STOCKS' },
            'JINDALSTEL': { slug: 'jindal-steel-power-ltd', type: 'STOCKS' },
            'JIOFIN': { slug: 'jio-financial-services-ltd', type: 'STOCKS' },
            'JSWENERGY': { slug: 'jsw-energy-ltd', type: 'STOCKS' },
            'JSWSTEEL': { slug: 'jsw-steel-ltd', type: 'STOCKS' },
            'JUBLFOOD': { slug: 'jubilant-foodworks-ltd', type: 'STOCKS' },
            'KALYANKJIL': { slug: 'kalyan-jewellers-india-ltd', type: 'STOCKS' },
            'KAYNES': { slug: 'kaynes-technology-india-ltd', type: 'STOCKS' },
            'KEI': { slug: 'kei-industries-ltd', type: 'STOCKS' },
            'KFINTECH': { slug: 'kfin-technologies-ltd', type: 'STOCKS' },
            'KOTAKBANK': { slug: 'kotak-mahindra-bank-ltd', type: 'STOCKS' },
            'KPITTECH': { slug: 'kpit-engineering-ltd', type: 'STOCKS' },
            'LAURUSLABS': { slug: 'laurus-labs-ltd', type: 'STOCKS' },
            'LICHSGFIN': { slug: 'lic-housing-finance-ltd', type: 'STOCKS' },
            'LICI': { slug: 'life-insurance-corporation-of-india', type: 'STOCKS' },
            'LODHA': { slug: 'lodha-developers-ltd', type: 'STOCKS' },
            'LT': { slug: 'larsen-toubro-ltd', type: 'STOCKS' },
            'LTF': { slug: 'lt-finance-holdings-ltd', type: 'STOCKS' },
            'LTM': { slug: 'larsen-toubro-infotech-ltd', type: 'STOCKS' },
            'LUPIN': { slug: 'lupin-ltd', type: 'STOCKS' },
            'M&M': { slug: 'mahindra-mahindra-ltd', type: 'STOCKS' },
            'MAHABANK': { slug: 'bank-of-maharashtra', type: 'STOCKS' },
            'MANAPPURAM': { slug: 'manappuram-finance-ltd', type: 'STOCKS' },
            'MANKIND': { slug: 'mankind-pharma-ltd', type: 'STOCKS' },
            'MARICO': { slug: 'marico-ltd', type: 'STOCKS' },
            'MARUTI': { slug: 'maruti-suzuki-india-ltd', type: 'STOCKS' },
            'MAXHEALTH': { slug: 'max-healthcare-institute-ltd', type: 'STOCKS' },
            'MAZDOCK': { slug: 'mazagon-dock-shipbuilders-ltd', type: 'STOCKS' },
            'MCX': { slug: 'multi-commodity-exchange-of-india-ltd', type: 'STOCKS' },
            'MFSL': { slug: 'max-financial-services-ltd', type: 'STOCKS' },
            'MIDCPNIFTY': { slug: 'nifty-midcap-select', type: 'INDICES' },
            'MOTHERSON': { slug: 'motherson-sumi-systems-ltd', type: 'STOCKS' },
            'MOTILALOFS': { slug: 'motilal-oswal-financial-services-ltd', type: 'STOCKS' },
            'MPHASIS': { slug: 'mphasis-ltd', type: 'STOCKS' },
            'MUTHOOTFIN': { slug: 'muthoot-finance-ltd', type: 'STOCKS' },
            'NAM-INDIA': { slug: 'reliance-nippon-life-asset-management-ltd', type: 'STOCKS' },
            'NATIONALUM': { slug: 'national-aluminium-company-ltd', type: 'STOCKS' },
            'NAUKRI': { slug: 'info-edge-india-ltd', type: 'STOCKS' },
            'NBCC': { slug: 'nbcc-india-ltd', type: 'STOCKS' },
            'NESTLEIND': { slug: 'nestle-india-ltd', type: 'STOCKS' },
            'NHPC': { slug: 'nhpc-ltd', type: 'STOCKS' },
            'NIFTY': { slug: 'nifty', type: 'INDICES' },
            'NMDC': { slug: 'nmdc-ltd', type: 'STOCKS' },
            'NTPC': { slug: 'ntpc-ltd', type: 'STOCKS' },
            'NYKAA': { slug: 'fsn-ecommerce-ventures-ltd', type: 'STOCKS' },
            'OBEROIRLTY': { slug: 'oberoi-realty-ltd', type: 'STOCKS' },
            'OFSS': { slug: 'oracle-financial-services-software-ltd', type: 'STOCKS' },
            'OIL': { slug: 'indian-oil-corporation-ltd', type: 'STOCKS' },
            'ONGC': { slug: 'oil-natural-gas-corporation-ltd', type: 'STOCKS' },
            'PAGEIND': { slug: 'page-industries-ltd', type: 'STOCKS' },
            'PATANJALI': { slug: 'ruchi-soya-industries-ltd', type: 'STOCKS' },
            'PAYTM': { slug: 'one-communications-ltd', type: 'STOCKS' },
            'PERSISTENT': { slug: 'persistent-systems-ltd', type: 'STOCKS' },
            'PETRONET': { slug: 'petronet-lng-ltd', type: 'STOCKS' },
            'PFC': { slug: 'power-finance-corporation-ltd', type: 'STOCKS' },
            'PGEL': { slug: 'pg-electroplast-ltd', type: 'STOCKS' },
            'PHOENIXLTD': { slug: 'phoenix-mills-ltd', type: 'STOCKS' },
            'PIDILITIND': { slug: 'pidilite-industries-ltd', type: 'STOCKS' },
            'PIIND': { slug: 'pi-industries-ltd', type: 'STOCKS' },
            'PNB': { slug: 'pnb-housing-finance-ltd', type: 'STOCKS' },
            'PNBHOUSING': { slug: 'pnb-housing-finance-ltd', type: 'STOCKS' },
            'POLICYBZR': { slug: 'pb-fintech-ltd', type: 'STOCKS' },
            'POLYCAB': { slug: 'polycab-india-ltd', type: 'STOCKS' },
            'POWERGRID': { slug: 'power-grid-corporation-of-india-ltd', type: 'STOCKS' },
            'POWERINDIA': { slug: 'abb-power-products-systems-india-ltd', type: 'STOCKS' },
            'PREMIERENE': { slug: 'premier-energies-ltd', type: 'STOCKS' },
            'PRESTIGE': { slug: 'prestige-estate-projects-ltd', type: 'STOCKS' },
            'RADICO': { slug: 'radico-khaitan-ltd', type: 'STOCKS' },
            'RBLBANK': { slug: 'rbl-bank-ltd', type: 'STOCKS' },
            'RECLTD': { slug: 'rec-ltd', type: 'STOCKS' },
            'RELIANCE': { slug: 'reliance-industries-ltd', type: 'STOCKS' },
            'RVNL': { slug: 'rail-vikas-nigam-ltd', type: 'STOCKS' },
            'SAGILITY': { slug: 'sagility-india-ltd', type: 'STOCKS' },
            'SAIL': { slug: 'steel-authority-of-india-ltd', type: 'STOCKS' },
            'SBICARD': { slug: 'sbi-cards-payment-services-ltd', type: 'STOCKS' },
            'SBILIFE': { slug: 'sbi-life-insurance-company-ltd', type: 'STOCKS' },
            'SBIN': { slug: 'state-bank-of-india', type: 'STOCKS' },
            'SHREECEM': { slug: 'shree-cement-ltd', type: 'STOCKS' },
            'SHRIRAMFIN': { slug: 'shriram-transport-finance-company-ltd', type: 'STOCKS' },
            'SIEMENS': { slug: 'siemens-ltd', type: 'STOCKS' },
            'SOLARINDS': { slug: 'solar-industries-india-ltd', type: 'STOCKS' },
            'SONACOMS': { slug: 'sona-blw-precision-forgings-ltd', type: 'STOCKS' },
            'SRF': { slug: 'srf-ltd', type: 'STOCKS' },
            'SUNPHARMA': { slug: 'sun-pharmaceutical-industries-ltd', type: 'STOCKS' },
            'SUPREMEIND': { slug: 'supreme-industries-ltd', type: 'STOCKS' },
            'SUZLON': { slug: 'suzlon-energy-ltd', type: 'STOCKS' },
            'SWIGGY': { slug: 'swiggy-ltd', type: 'STOCKS' },
            'TATACONSUM': { slug: 'tata-global-beverages-ltd', type: 'STOCKS' },
            'TATAELXSI': { slug: 'tata-elxsi-ltd', type: 'STOCKS' },
            'TATAPOWER': { slug: 'tata-power-company-ltd', type: 'STOCKS' },
            'TATASTEEL': { slug: 'tata-steel-ltd', type: 'STOCKS' },
            'TCS': { slug: 'tata-consultancy-services-ltd', type: 'STOCKS' },
            'TECHM': { slug: 'tech-mahindra-ltd', type: 'STOCKS' },
            'TIINDIA': { slug: 'tube-investments-of-india-ltd', type: 'STOCKS' },
            'TITAN': { slug: 'titan-company-ltd', type: 'STOCKS' },
            'TMPV': { slug: 'tata-motors-ltd', type: 'STOCKS' },
            'TORNTPHARM': { slug: 'torrent-pharmaceuticals-ltd', type: 'STOCKS' },
            'TRENT': { slug: 'trent-ltd', type: 'STOCKS' },
            'TVSMOTOR': { slug: 'tvs-motor-company-ltd', type: 'STOCKS' },
            'ULTRACEMCO': { slug: 'ultratech-cement-ltd', type: 'STOCKS' },
            'UNIONBANK': { slug: 'union-bank-of-india', type: 'STOCKS' },
            'UNITDSPR': { slug: 'united-spirits-ltd', type: 'STOCKS' },
            'UNOMINDA': { slug: 'minda-industries-ltd', type: 'STOCKS' },
            'UPL': { slug: 'upl-ltd', type: 'STOCKS' },
            'VBL': { slug: 'varun-beverages-ltd', type: 'STOCKS' },
            'VEDL': { slug: 'vedanta-ltd', type: 'STOCKS' },
            'VMM': { slug: 'vishal-mega-mart-ltd', type: 'STOCKS' },
            'VOLTAS': { slug: 'voltas-ltd', type: 'STOCKS' },
            'WAAREEENER': { slug: 'waaree-energies-ltd', type: 'STOCKS' },
            'WIPRO': { slug: 'wipro-ltd', type: 'STOCKS' },
            'YESBANK': { slug: 'yes-bank-ltd', type: 'STOCKS' },
            'ZYDUSLIFE': { slug: 'cadila-healthcare-ltd', type: 'STOCKS' },
            'NIFTYNXT50': { slug: 'nifty-next', type: 'INDICES' }
        };
    }

    // ===== OI CLOCK & ANALYSIS =====
    async getOIClock(symbol = 'NIFTY', expiryDate = '') {
        const cleanSym = (symbol || 'NIFTY').replace('NIFTY 50', 'NIFTY').replace('NIFTY BANK', 'BANKNIFTY');
        let d = null;
        try {
            if (this.config.preferGrowwForOptionChain && typeof this.getOptionChainGroww === 'function') {
                d = await this.getOptionChainGroww(cleanSym, expiryDate);
            }
        } catch (e) {
            console.warn('Groww Option Chain fetch error:', e);
        }

        if (!d && typeof this.getOptionChain === 'function') {
            try {
                d = await this.getOptionChain(cleanSym);
            } catch (e) {}
        }

        if (!d?.records?.data || d.records.data.length === 0) {
            const rawSnap = window.App && window.App._liveSnapshot ? window.App._liveSnapshot[cleanSym] : null;
            const snap = this.normalizeSnapshotItem(rawSnap);
            if (snap && snap.curSpot > 0) {
                const curSpot = snap.curSpot;
                const curPcr = snap.curVal || 1.0;
                const timeStr = snap.curTimeStr || '';
                const pcrVal = parseFloat(curPcr || 1.0);
                const maxPain = Math.round(curSpot);
                const ceStrike = Math.round(curSpot * 1.02);
                const peStrike = Math.round(curSpot * 0.98);
                return {
                    symbol: cleanSym,
                    pcr: pcrVal.toFixed(4),
                    sentiment: pcrVal > 1.3 ? 'BULLISH' : (pcrVal < 0.7 ? 'BEARISH' : 'NEUTRAL'),
                    underlying: curSpot,
                    totalCEOI: 1000000,
                    totalPEOI: Math.round(1000000 * pcrVal),
                    maxCEStrike: ceStrike,
                    maxPEStrike: peStrike,
                    maxPain: maxPain,
                    maxPainStrike: maxPain,
                    expiryDates: [],
                    currentExpiry: '',
                    lotSize: typeof this._getLotSize === 'function' ? this._getLotSize(cleanSym) : 100,
                    timestamp: timeStr,
                    data: [],
                    timeStr: timeStr
                };
            }
            return null;
        }

        let totalCEOI = 0, totalPEOI = 0, totalCEChange = 0, totalPEChange = 0;
        let maxCEOI = 0, maxPEOI = 0, maxCEStrike = 0, maxPEStrike = 0;

        const rows = d.records.data;
        if (!rows || rows.length === 0) return null;

        for (const row of rows) {
            const ceOI = row.CE?.openInterest || 0;
            const peOI = row.PE?.openInterest || 0;
            totalCEOI += ceOI; totalPEOI += peOI;
            totalCEChange += (row.CE?.changeinOpenInterest || 0);
            totalPEChange += (row.PE?.changeinOpenInterest || 0);
            if (ceOI > maxCEOI) { maxCEOI = ceOI; maxCEStrike = row.strikePrice; }
            if (peOI > maxPEOI) { maxPEOI = peOI; maxPEStrike = row.strikePrice; }
        }

        const pcr = totalCEOI > 0 ? (totalPEOI / totalCEOI).toFixed(4) : '0.0000';
        const sentiment = pcr > 1.3 ? 'BULLISH' : pcr < 0.7 ? 'BEARISH' : 'NEUTRAL';
        const underlying = d.records.underlyingValue || 0;
        // Show full data instead of slicing
        const displayRows = rows;

        const expiry = d.records.currentExpiry || (d.records.expiryDates || [])[0];
        const daysToExpiry = expiry ? (new Date(expiry) - new Date()) / (1000 * 60 * 60 * 24) : 7;
        const T = Math.max(0.001, daysToExpiry / 365);
        const r = 0.10; // 10% Risk-free rate

        // Enrich with Greeks and normalize fields
        const enrichedData = displayRows.map(row => {
            const ce = row.CE ? { ...row.CE } : null;
            const pe = row.PE ? { ...row.PE } : null;

            if (ce) {
                // Normalize pChange (NSE uses pchange, Groww uses pChange)
                ce.pChange = ce.pChange || ce.pchange || 0;
            }
            if (pe) {
                pe.pChange = pe.pChange || pe.pchange || 0;
            }

            // Only calculate Greeks if not already provided by the API source
            if (ce && ce.impliedVolatility && !ce.greeks) {
                const g = this._calculateGreeks(underlying, row.strikePrice, T, r, ce.impliedVolatility / 100, 'CE');
                ce.greeks = g;
            }
            if (pe && pe.impliedVolatility && !pe.greeks) {
                const g = this._calculateGreeks(underlying, row.strikePrice, T, r, pe.impliedVolatility / 100, 'PE');
                pe.greeks = g;
            }
            return { ...row, CE: ce, PE: pe };
        });

        // Max Pain calculation (High Precision)
        const strikes = rows.map(r => r.strikePrice).filter((_, i) => i % 2 === 0); // sample every 2nd strike for better speed/accuracy balance
        let minPain = Infinity, maxPainStrike = strikes[0];
        for (const strike of strikes) {
            let pain = 0;
            for (const row of rows) {
                const ceOI = row.CE?.openInterest || 0;
                const peOI = row.PE?.openInterest || 0;
                if (row.strikePrice < strike) pain += ceOI * (strike - row.strikePrice);
                if (row.strikePrice > strike) pain += peOI * (row.strikePrice - strike);
            }
            if (pain < minPain) { minPain = pain; maxPainStrike = strike; }
        }

        return {
            symbol: cleanSym,
            pcr, sentiment, underlying, totalCEOI, totalPEOI, totalCEChange, totalPEChange,
            maxCEStrike, maxPEStrike, maxCEOI, maxPEOI, maxPainStrike,
            expiryDates: d.records.expiryDates || [],
            currentExpiry: d.records.currentExpiry || '',
            lotSize: d.records.lotSize || 100,
            timestamp: d.records.timestamp,
            data: enrichedData
        };
    }

    // ===== OPTION GREEKS (Black-Scholes) =====
    _cnd(x) {
        let a1 = 0.31938153, a2 = -0.356563782, a3 = 1.781477937, a4 = -1.821255978, a5 = 1.330274429;
        let L = Math.abs(x), K = 1.0 / (1.0 + 0.2316419 * L);
        let w = 1.0 - 1.0 / Math.sqrt(2 * Math.PI) * Math.exp(-L * L / 2) * (a1 * K + a2 * K * K + a3 * Math.pow(K, 3) + a4 * Math.pow(K, 4) + a5 * Math.pow(K, 5));
        return x < 0 ? 1.0 - w : w;
    }

    _calculateGreeks(S, K, T, r, sigma, type) {
        if (T <= 0 || sigma <= 0) return { delta: 0, gamma: 0, theta: 0, vega: 0 };
        let d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
        let d2 = d1 - sigma * Math.sqrt(T);
        let nd1 = Math.exp(-d1 * d1 / 2) / Math.sqrt(2 * Math.PI);

        let delta, theta;
        if (type === 'CE') {
            delta = this._cnd(d1);
            theta = (-S * nd1 * sigma / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * this._cnd(d2)) / 365;
        } else {
            delta = this._cnd(d1) - 1;
            theta = (-S * nd1 * sigma / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * this._cnd(-d2)) / 365;
        }

        let gamma = nd1 / (S * sigma * Math.sqrt(T));
        let vega = S * Math.sqrt(T) * nd1 / 100;

        return { delta: +delta.toFixed(3), gamma: +gamma.toFixed(4), theta: +theta.toFixed(2), vega: +vega.toFixed(3) };
    }

    // ===== SEARCH =====
    searchSymbols(query) {
        const q = query.toUpperCase();
        return this.fnoSymbols.filter(s => s.includes(q)).slice(0, 8);
    }

    _getSimulatedOI(symbol) {
        const spot = 24000 + (Math.random() - 0.5) * 200;
        const strikeStep = symbol.includes('BANKNIFTY') ? 100 : 50;
        const baseStrike = Math.round(spot / strikeStep) * strikeStep;

        const data = [];
        for (let i = -10; i <= 10; i++) {
            const strike = baseStrike + (i * strikeStep);
            const dist = Math.abs(strike - spot) / strikeStep;
            const ceOI = Math.round(Math.exp(-dist / 5) * 50000);
            const peOI = Math.round(Math.exp(-dist / 5) * 45000);

            const ceP = Math.max(5, 500 - (strike - spot) * 0.5);
            const peP = Math.max(5, 500 + (strike - spot) * 0.5);

            data.push({
                strikePrice: strike,
                CE: {
                    openInterest: ceOI, changeinOpenInterest: Math.round(ceOI * 0.1), lastPrice: ceP,
                    pChange: 15.5 + (Math.random() * 20), // Simulated momentum
                    greeks: this._calculateGreeks(spot, strike, 0.02, 0.1, 0.25, 'CE')
                },
                PE: {
                    openInterest: peOI, changeinOpenInterest: Math.round(peOI * 0.08), lastPrice: peP,
                    pChange: 12.2 + (Math.random() * 15), // Simulated momentum
                    greeks: this._calculateGreeks(spot, strike, 0.02, 0.1, 0.25, 'PE')
                }
            });
        }

        const totalCEOI = data.reduce((s, r) => s + r.CE.openInterest, 0);
        const totalPEOI = data.reduce((s, r) => s + r.PE.openInterest, 0);

        return {
            underlying: +spot.toFixed(2),
            timestamp: new Date().toLocaleTimeString(),
            totalCEOI, totalPEOI,
            pcr: (totalPEOI / totalCEOI).toFixed(4),
            maxPainStrike: baseStrike,
            sentiment: (totalPEOI / totalCEOI) > 1.1 ? 'BULLISH' : (totalPEOI / totalCEOI) < 0.9 ? 'BEARISH' : 'NEUTRAL',
            data
        };
    }

    _getLotSize(symbol) {
        const up = symbol.toUpperCase();
        const mapping = {
            "360ONE": 500, "ABB": 125, "ABCAPITAL": 3100, "ADANIENSOL": 675, "ADANIENT": 309,
            "ADANIGREEN": 600, "ADANIPORTS": 475, "ADANIPOWER": 3550, "ALKEM": 125, "AMBER": 100,
            "AMBUJACEM": 1200, "ANGELONE": 2500, "APLAPOLLO": 350, "APOLLOHOSP": 125, "ASHOKLEY": 5000,
            "ASIANPAINT": 250, "ASTRAL": 425, "ATHERENERG": 375, "AUBANK": 1000, "AUROPHARMA": 550,
            "AXISBANK": 625, "BAJAJ-AUTO": 75, "BAJAJFINSV": 300, "BAJAJHLDNG": 75, "BAJFINANCE": 750,
            "BANDHANBNK": 3600, "BANKBARODA": 2925, "BANKINDIA": 5200, "BANKNIFTY": 30, "BDL": 425,
            "BEL": 1425, "BHARATFORG": 500, "BHARTIARTL": 475, "BHEL": 2625, "BIOCON": 2500,
            "BLUESTARCO": 325, "BOSCHLTD": 25, "BPCL": 1975, "BRITANNIA": 125, "BSE": 200,
            "CAMS": 825, "CANBK": 6750, "CDSL": 475, "CGPOWER": 850, "CHOLAFIN": 625,
            "CIPLA": 425, "COALINDIA": 1350, "COCHINSHIP": 400, "COFORGE": 475, "COLPAL": 275,
            "CONCOR": 1250, "CROMPTON": 2150, "CUMMINSIND": 200, "DABUR": 1250, "DELHIVERY": 2075,
            "DIVISLAB": 100, "DIXON": 50, "DLF": 950, "DMART": 150, "DRREDDY": 625,
            "EICHERMOT": 100, "ETERNAL": 2425, "FEDERALBNK": 2500, "FINNIFTY": 60, "FORCEMOT": 25,
            "FORTIS": 775, "GAIL": 3550, "GLENMARK": 375, "GMRAIRPORT": 6975, "GODFRYPHLP": 275,
            "GODREJCP": 500, "GODREJPROP": 325, "GRASIM": 250, "GVT&D": 125, "HAL": 150,
            "HAVELLS": 500, "HCLTECH": 400, "HDFCAMC": 300, "HDFCBANK": 650, "HDFCLIFE": 1100,
            "HEROMOTOCO": 150, "HINDALCO": 700, "HINDPETRO": 2025, "HINDUNILVR": 300, "HINDZINC": 1225,
            "HYUNDAI": 275, "ICICIBANK": 700, "ICICIGI": 325, "ICICIPRULI": 925, "IDEA": 71475,
            "IDFCFIRSTB": 9275, "IEX": 4350, "INDHOTEL": 1000, "INDIANB": 1000, "INDIGO": 150,
            "INDUSINDBK": 700, "INDUSTOWER": 1700, "INFY": 400, "INOXWIND": 6400, "IOC": 4875,
            "IREDA": 4525, "IRFC": 5425, "ITC": 1725, "JINDALSTEL": 625, "JIOFIN": 2350,
            "JSWENERGY": 1075, "JSWSTEEL": 675, "JUBLFOOD": 1250, "KALYANKJIL": 1350, "KAYNES": 150,
            "KEI": 175, "KFINTECH": 575, "KOTAKBANK": 2000, "KPITTECH": 775, "LAURUSLABS": 850,
            "LICHSGFIN": 1000, "LICI": 1400, "LODHA": 625, "LT": 175, "LTF": 2250,
            "LTM": 150, "LUPIN": 425, "M&M": 200, "MAHABANK": 6500, "MANAPPURAM": 3000,
            "MANKIND": 250, "MARICO": 1200, "MARUTI": 50, "MAXHEALTH": 525, "MAZDOCK": 225,
            "MCX": 225, "MFSL": 400, "MIDCPNIFTY": 120, "MOTHERSON": 6150, "MOTILALOFS": 775,
            "MPHASIS": 275, "MUTHOOTFIN": 275, "NAM-INDIA": 625, "NATIONALUM": 1875, "NAUKRI": 550,
            "NBCC": 6500, "NESTLEIND": 500, "NHPC": 6950, "NIFTY": 65, "NIFTYFPI": 1100,
            "NIFTYNXT50": 25, "NMDC": 6750, "NTPC": 1500, "NYKAA": 3125, "OBEROIRLTY": 350,
            "OFSS": 100, "OIL": 1400, "ONGC": 2250, "PAGEIND": 20, "PATANJALI": 1075,
            "PAYTM": 725, "PERSISTENT": 125, "PETRONET": 1900, "PFC": 1300, "PGEL": 950,
            "PHOENIXLTD": 350, "PIDILITIND": 500, "PIIND": 175, "PNB": 8000, "PNBHOUSING": 650,
            "POLICYBZR": 350, "POLYCAB": 125, "POWERGRID": 1900, "POWERINDIA": 25, "PREMIERENE": 650,
            "PRESTIGE": 450, "RADICO": 150, "RBLBANK": 3175, "RECLTD": 1575, "RELIANCE": 500,
            "RVNL": 1925, "SAGILITY": 12000, "SAIL": 4700, "SBICARD": 800, "SBILIFE": 375,
            "SBIN": 750, "SENSEX": 20, "SHREECEM": 25, "SHRIRAMFIN": 825, "SIEMENS": 175,
            "SOLARINDS": 50, "SONACOMS": 1225, "SRF": 200, "SUNPHARMA": 350, "SUPREMEIND": 175,
            "SUZLON": 12700, "SWIGGY": 1825, "TATACONSUM": 550, "TATAELXSI": 125, "TATAPOWER": 1450,
            "TATASTEEL": 2750, "TCS": 225, "TECHM": 600, "TIINDIA": 200, "TITAN": 175,
            "TMPV": 1600, "TORNTPHARM": 125, "TRENT": 225, "TVSMOTOR": 175, "ULTRACEMCO": 50,
            "UNIONBANK": 4425, "UNITDSPR": 400, "UNOMINDA": 550, "UPL": 1355, "VBL": 1275,
            "VEDL": 1150, "VMM": 4850, "VOLTAS": 375, "WAAREEENER": 175, "WIPRO": 3000,
            "YESBANK": 31100, "ZYDUSLIFE": 900
        };

        // Exact match check
        if (mapping[up]) return mapping[up];

        // Logical prefix check (for symbols with suffixes or indices)
        for (const [k, v] of Object.entries(mapping)) {
            if (up.includes(k)) return v;
        }
        return 100; // Final safe default
    }

    // ===== TRADE ADVISOR (AI-Ready Quantitative Logic) =====
    getMarketAnalysisAndRecommendation(data, symbol) {
        if (!data || !data.data || data.data.length === 0) return null;

        const underlying = parseFloat(data.underlying || 0);
        const pcr = parseFloat(data.pcr) || 1.0;
        const rows = data.data;

        // 1. Calculate Core OI Levels
        let strongSupport = 0, maxPEOI = 0;
        let strongResistance = 0, maxCEOI = 0;
        let supportBuilding = 0, maxPEOIChange = -Infinity;
        let resistanceBuilding = 0, maxCEOIChange = -Infinity;
        let totalPEOIChange = 0;
        let totalCEOIChange = 0;

        let strikeInterval = 50;
        if (rows.length > 1) {
            const diffs = [];
            for (let i = 1; i < rows.length; i++) {
                const diff = Math.abs(rows[i].strikePrice - rows[i-1].strikePrice);
                if (diff > 0) diffs.push(diff);
            }
            if (diffs.length > 0) strikeInterval = Math.min(...diffs);
        }

        for (const row of rows) {
            const strike = row.strikePrice;
            const ce = row.CE || {};
            const pe = row.PE || {};

            const peOI = pe.openInterest || 0;
            const ceOI = ce.openInterest || 0;
            const peChg = pe.changeinOpenInterest || 0;
            const ceChg = ce.changeinOpenInterest || 0;

            totalPEOIChange += peChg;
            totalCEOIChange += ceChg;

            if (peOI > maxPEOI) { maxPEOI = peOI; strongSupport = strike; }
            if (ceOI > maxCEOI) { maxCEOI = ceOI; strongResistance = strike; }

            if (peChg > maxPEOIChange) { maxPEOIChange = peChg; supportBuilding = strike; }
            if (ceChg > maxCEOIChange) { maxCEOIChange = ceChg; resistanceBuilding = strike; }
        }

        const maxPain = data.maxPainStrike || strongSupport;
        const maxPainDiff = underlying - (parseFloat(maxPain) || underlying);

        // Calculate ATM Strike
        const atmStrike = Math.round(underlying / strikeInterval) * strikeInterval;

        // 2. Comprehensive Sentiment Analysis Score
        let score = 0; // Negative = Bearish, Positive = Bullish

        // PCR Score (-3 to +3)
        if (pcr >= 1.40) score += 3;
        else if (pcr >= 1.15) score += 2;
        else if (pcr >= 1.05) score += 1;
        else if (pcr <= 0.65) score -= 3;
        else if (pcr <= 0.85) score -= 2;
        else if (pcr <= 0.95) score -= 1;

        // Price vs Max Pain Score
        if (maxPainDiff > strikeInterval * 0.5) score += 1;
        else if (maxPainDiff < -strikeInterval * 0.5) score -= 1;

        // Fresh Intraday Writing Score
        if (totalPEOIChange > totalCEOIChange * 1.25) score += 2;
        else if (totalCEOIChange > totalPEOIChange * 1.25) score -= 2;

        // Determine Market Type & Bias
        let marketType = 'Neutral / Rangebound';
        let biasColor = 'var(--text-bright)';
        let confidence = '70%';

        if (score >= 3) {
            marketType = 'Strong Bullish';
            biasColor = 'var(--up)';
            confidence = `${Math.min(95, 75 + score * 4)}%`;
        } else if (score >= 1) {
            marketType = 'Mildly Bullish';
            biasColor = 'var(--up)';
            confidence = '72%';
        } else if (score <= -3) {
            marketType = 'Strong Bearish';
            biasColor = 'var(--down)';
            confidence = `${Math.min(95, 75 + Math.abs(score) * 4)}%`;
        } else if (score <= -1) {
            marketType = 'Mildly Bearish';
            biasColor = 'var(--down)';
            confidence = '72%';
        }

        // 3. Precision Trade Action Generator
        let tradeAction = '';
        let tradeDetails = '';
        let stopLoss = 0;
        let target = 0;

        if (score >= 2) {
            // Bullish Logic
            if (underlying > strongResistance) {
                tradeAction = `Breakout Call Buy → ${atmStrike} CE`;
                tradeDetails = `Spot crossed Max CE Resistance (${strongResistance}). Momentum expansion active.`;
                target = atmStrike + (strikeInterval * 3);
                stopLoss = atmStrike - (strikeInterval * 1.5);
            } else if (Math.abs(underlying - strongSupport) <= strikeInterval * 1.5) {
                tradeAction = `Support Rebound Call → ${atmStrike} CE`;
                tradeDetails = `Spot holding strong PE support zone (${strongSupport}). High R:R buy zone.`;
                target = strongResistance;
                stopLoss = strongSupport - (strikeInterval * 1);
            } else {
                tradeAction = `Bull Call Spread → ${atmStrike} CE / ${atmStrike + (strikeInterval * 2)} CE`;
                tradeDetails = `PCR ${pcr} confirms put writing floor. Buy ${atmStrike} CE and sell ${atmStrike + (strikeInterval * 2)} CE.`;
                target = atmStrike + (strikeInterval * 2);
                stopLoss = atmStrike - strikeInterval;
            }
        } else if (score <= -2) {
            // Bearish Logic
            if (underlying < strongSupport) {
                tradeAction = `Breakdown Put Buy → ${atmStrike} PE`;
                tradeDetails = `Spot broke below PE Support (${strongSupport}). Downside momentum active.`;
                target = atmStrike - (strikeInterval * 3);
                stopLoss = atmStrike + (strikeInterval * 1.5);
            } else if (Math.abs(underlying - strongResistance) <= strikeInterval * 1.5) {
                tradeAction = `Resistance Rejection Put → ${atmStrike} PE`;
                tradeDetails = `Spot testing strong CE resistance zone (${strongResistance}). Short setup.`;
                target = strongSupport;
                stopLoss = strongResistance + (strikeInterval * 1);
            } else {
                tradeAction = `Bear Put Spread → ${atmStrike} PE / ${atmStrike - (strikeInterval * 2)} PE`;
                tradeDetails = `PCR ${pcr} confirms call resistance overhead. Buy ${atmStrike} PE and sell ${atmStrike - (strikeInterval * 2)} PE.`;
                target = atmStrike - (strikeInterval * 2);
                stopLoss = atmStrike + strikeInterval;
            }
        } else {
            // Neutral / Rangebound Logic
            const rangeWidth = Math.abs(strongResistance - strongSupport);
            if (rangeWidth >= strikeInterval * 4) {
                tradeAction = `Iron Condor → Sell ${strongSupport} PE & Sell ${strongResistance} CE`;
                tradeDetails = `Market rangebound in corridor (${strongSupport} - ${strongResistance}). Collect theta decay.`;
                target = maxPain;
                stopLoss = underlying + (strikeInterval * 2);
            } else {
                tradeAction = `Max Pain Magnet → Short Iron Fly at ${maxPain}`;
                tradeDetails = `PCR neutral (${pcr}). Price gravitating toward Max Pain level (${maxPain}).`;
                target = maxPain;
                stopLoss = underlying + strikeInterval;
            }
        }

        return {
            spot: underlying.toFixed(2),
            pcr: pcr.toFixed(4),
            maxPain: maxPain || '-',
            maxPainDiff: maxPainDiff.toFixed(1),
            lotSize: this._getLotSize(symbol),
            strongSupport: strongSupport || atmStrike - strikeInterval,
            strongResistance: strongResistance || atmStrike + strikeInterval,
            supportBuilding: supportBuilding || strongSupport,
            resistanceBuilding: resistanceBuilding || strongResistance,
            marketRange: `${strongSupport || atmStrike - strikeInterval} to ${strongResistance || atmStrike + strikeInterval}`,
            marketType,
            biasColor,
            confidence,
            tradeAction,
            tradeDetails,
            target: target ? target.toString() : '-',
            stopLoss: stopLoss ? stopLoss.toString() : '-'
        };
    }
    // ===== GROWW SLUG MAPPING =====
    _getGrowwSlug(symbol) {
        const up = symbol.toUpperCase().replace('NIFTY 50', 'NIFTY').replace('NIFTY BANK', 'BANKNIFTY');
        if (this.dynamicSlugMap && this.dynamicSlugMap.has(up)) {
            return this.dynamicSlugMap.get(up);
        }
        const map = this.getGrowwMap();
        return map[up]?.slug || up.toLowerCase();
    }

    // ===== GROWW ADAPTER =====
    async getOptionChainGroww(symbol = 'NIFTY', expiryDate = '') {
        const slug = this._getGrowwSlug(symbol);
        let url = `/v1/pro-option-chain/${slug}?responseStructure=LIST`;
        if (!this.symbolExpiriesMap) this.symbolExpiriesMap = new Map();
        
        if (expiryDate && expiryDate !== 'current') {
            if (expiryDate === 'next' || expiryDate === 'far') {
                let expiries = this.symbolExpiriesMap.get(symbol);
                if (!expiries) {
                    const initial = await this._fetchGroww(url);
                    expiries = initial?.optionChain?.aggregatedDetails?.expiryDates || [];
                    if (expiries.length > 0) this.symbolExpiriesMap.set(symbol, expiries);
                }
                const targetIdx = expiryDate === 'next' ? 1 : 2;
                const actualDate = expiries[targetIdx] || expiries[0];
                if (actualDate) {
                    url = `/v1/pro-option-chain/${slug}?expiryDate=${actualDate}&responseStructure=LIST`;
                }
            } else {
                url = `/v1/pro-option-chain/${slug}?expiryDate=${expiryDate}&responseStructure=LIST`;
            }
        }

        const d = await this._fetchGroww(url);

        if (!d?.optionChain?.optionContracts) {
            return null;
        }

        if (d.optionChain?.aggregatedDetails?.expiryDates) {
            this.symbolExpiriesMap.set(symbol, d.optionChain.aggregatedDetails.expiryDates);
        }

        const contracts = (d.optionChain.optionContracts || []).sort((a, b) => a.strikePrice - b.strikePrice);

        // Use specialized Groww Index API as primary underlying source
        const livePrice = await this.getLivePriceGroww(symbol);
        let underlying = livePrice || (await this.getQuote(symbol))?.lastPrice || 0;

        if (!underlying) {
            // Final fallback to option chain context
            const firstContract = contracts[0]?.ce?.liveData || contracts[0]?.pe?.liveData;
            underlying = parseFloat(d.optionChain?.underlyingValue) || parseFloat(d.optionChain?.underlyingPrice) || parseFloat(firstContract?.underlyingValue) || parseFloat(firstContract?.underlyingPrice) || 0;
        }

        // Heuristic: If value is in Paisa (large integers, e.g., > 200,000 for indices), convert to INR
        if (underlying > 200000) {
            underlying = underlying / 100;
        }

        const lotSize = d.optionChain?.aggregatedDetails?.lotSize || contracts[0]?.ce?.marketLot || contracts[0]?.pe?.marketLot || 0;

        return {
            records: {
                data: contracts.map(c => {
                    let strike = c.strikePrice;
                    if (strike > 200) {
                        strike = Math.round(strike / 100);
                    }
                    return {
                        strikePrice: strike,
                        CE: c.ce ? {
                            strikePrice: strike,
                            openInterest: c.ce.liveData ? (c.ce.liveData.oi !== undefined ? c.ce.liveData.oi : (c.ce.liveData.openInterest || 0)) : 0,
                            changeinOpenInterest: c.ce.liveData ? ((c.ce.liveData.oi || 0) - (c.ce.liveData.prevOI || 0)) : 0,
                            lastPrice: c.ce.liveData?.ltp || 0,
                            pChange: c.ce.liveData?.dayChangePerc || 0,
                            impliedVolatility: c.ce.greeks?.iv || 0,
                            greeks: {
                                delta: c.ce.greeks?.delta || 0,
                                theta: c.ce.greeks?.theta || 0,
                                gamma: c.ce.greeks?.gamma || 0,
                                vega: c.ce.greeks?.vega || 0
                            }
                        } : null,
                        PE: c.pe ? {
                            strikePrice: strike,
                            openInterest: c.pe.liveData ? (c.pe.liveData.oi !== undefined ? c.pe.liveData.oi : (c.pe.liveData.openInterest || 0)) : 0,
                            changeinOpenInterest: c.pe.liveData ? ((c.pe.liveData.oi || 0) - (c.pe.liveData.prevOI || 0)) : 0,
                            lastPrice: c.pe.liveData?.ltp || 0,
                            pChange: c.pe.liveData?.dayChangePerc || 0,
                            impliedVolatility: c.pe.greeks?.iv || 0,
                            greeks: {
                                delta: c.pe.greeks?.delta || 0,
                                theta: c.pe.greeks?.theta || 0,
                                gamma: c.pe.greeks?.gamma || 0,
                                vega: c.pe.greeks?.vega || 0
                            }
                        } : null
                    };
                }),
                underlyingValue: underlying,
                lotSize: lotSize,
                expiryDates: d.optionChain?.aggregatedDetails?.expiryDates || [],
                currentExpiry: d.optionChain?.aggregatedDetails?.currentExpiry || expiryDate || '',
                timestamp: new Date().toLocaleTimeString()
            }
        };
    }

    // Official Zerodha SPAN contracts catalog directly from https://zerodha.com/margin-calculator/SPAN/
    _zerodhaContracts = {"360ONE":[["360ONE26SEP","29-SEP-2026",500],["360ONE26OCT","27-OCT-2026",500],["360ONE26NOV","23-NOV-2026",500]],"ABB":[["ABB26SEP","29-SEP-2026",125],["ABB26OCT","27-OCT-2026",125],["ABB26NOV","23-NOV-2026",125]],"ABCAPITAL":[["ABCAPITAL26SEP","29-SEP-2026",3100],["ABCAPITAL26OCT","27-OCT-2026",3100],["ABCAPITAL26NOV","23-NOV-2026",3100]],"ADANIENSOL":[["ADANIENSOL26SEP","29-SEP-2026",675],["ADANIENSOL26OCT","27-OCT-2026",675],["ADANIENSOL26NOV","23-NOV-2026",675]],"ADANIENT":[["ADANIENT26SEP","29-SEP-2026",309],["ADANIENT26OCT","27-OCT-2026",309],["ADANIENT26NOV","23-NOV-2026",309]],"ADANIGREEN":[["ADANIGREEN26SEP","29-SEP-2026",600],["ADANIGREEN26OCT","27-OCT-2026",600],["ADANIGREEN26NOV","23-NOV-2026",600]],"ADANIPORTS":[["ADANIPORTS26SEP","29-SEP-2026",475],["ADANIPORTS26OCT","27-OCT-2026",475],["ADANIPORTS26NOV","23-NOV-2026",475]],"ADANIPOWER":[["ADANIPOWER26SEP","29-SEP-2026",3550],["ADANIPOWER26OCT","27-OCT-2026",3550],["ADANIPOWER26NOV","23-NOV-2026",3550]],"ALKEM":[["ALKEM26SEP","29-SEP-2026",125],["ALKEM26OCT","27-OCT-2026",125],["ALKEM26NOV","23-NOV-2026",125]],"AMBER":[["AMBER26SEP","29-SEP-2026",100],["AMBER26OCT","27-OCT-2026",100],["AMBER26NOV","23-NOV-2026",100]],"AMBUJACEM":[["AMBUJACEM26SEP","29-SEP-2026",1200],["AMBUJACEM26OCT","27-OCT-2026",1200],["AMBUJACEM26NOV","23-NOV-2026",1200]],"ANGELONE":[["ANGELONE26SEP","29-SEP-2026",2500],["ANGELONE26OCT","27-OCT-2026",2500],["ANGELONE26NOV","23-NOV-2026",2500]],"APLAPOLLO":[["APLAPOLLO26SEP","29-SEP-2026",350],["APLAPOLLO26OCT","27-OCT-2026",350],["APLAPOLLO26NOV","23-NOV-2026",350]],"APOLLOHOSP":[["APOLLOHOSP26SEP","29-SEP-2026",125],["APOLLOHOSP26OCT","27-OCT-2026",125],["APOLLOHOSP26NOV","23-NOV-2026",125]],"ASHOKLEY":[["ASHOKLEY26SEP","29-SEP-2026",5000],["ASHOKLEY26OCT","27-OCT-2026",5000],["ASHOKLEY26NOV","23-NOV-2026",5000]],"ASIANPAINT":[["ASIANPAINT26SEP","29-SEP-2026",250],["ASIANPAINT26OCT","27-OCT-2026",250],["ASIANPAINT26NOV","23-NOV-2026",250]],"ASTRAL":[["ASTRAL26SEP","29-SEP-2026",425],["ASTRAL26OCT","27-OCT-2026",425],["ASTRAL26NOV","23-NOV-2026",425]],"ATHERENERG":[["ATHERENERG26SEP","29-SEP-2026",375],["ATHERENERG26OCT","27-OCT-2026",375],["ATHERENERG26NOV","23-NOV-2026",375]],"AUBANK":[["AUBANK26SEP","29-SEP-2026",1000],["AUBANK26OCT","27-OCT-2026",1000],["AUBANK26NOV","23-NOV-2026",1000]],"AUROPHARMA":[["AUROPHARMA26SEP","29-SEP-2026",550],["AUROPHARMA26OCT","27-OCT-2026",550],["AUROPHARMA26NOV","23-NOV-2026",550]],"AXISBANK":[["AXISBANK26SEP","29-SEP-2026",625],["AXISBANK26OCT","27-OCT-2026",625],["AXISBANK26NOV","23-NOV-2026",625]],"BAJAJ-AUTO":[["BAJAJ-AUTO26SEP","29-SEP-2026",75],["BAJAJ-AUTO26OCT","27-OCT-2026",75],["BAJAJ-AUTO26NOV","23-NOV-2026",75]],"BAJAJFINSV":[["BAJAJFINSV26SEP","29-SEP-2026",300],["BAJAJFINSV26OCT","27-OCT-2026",300],["BAJAJFINSV26NOV","23-NOV-2026",300]],"BAJAJHLDNG":[["BAJAJHLDNG26SEP","29-SEP-2026",75],["BAJAJHLDNG26OCT","27-OCT-2026",75]],"BAJFINANCE":[["BAJFINANCE26SEP","29-SEP-2026",750],["BAJFINANCE26OCT","27-OCT-2026",750],["BAJFINANCE26NOV","23-NOV-2026",750]],"BANDHANBNK":[["BANDHANBNK26SEP","29-SEP-2026",3600],["BANDHANBNK26OCT","27-OCT-2026",3600],["BANDHANBNK26NOV","23-NOV-2026",3600]],"BANKBARODA":[["BANKBARODA26SEP","29-SEP-2026",2925],["BANKBARODA26OCT","27-OCT-2026",2925],["BANKBARODA26NOV","23-NOV-2026",2925]],"BANKINDIA":[["BANKINDIA26SEP","29-SEP-2026",5200],["BANKINDIA26OCT","27-OCT-2026",5200],["BANKINDIA26NOV","23-NOV-2026",5200]],"BANKNIFTY":[["BANKNIFTY26SEP","29-SEP-2026",30],["BANKNIFTY26OCT","27-OCT-2026",30],["BANKNIFTY26NOV","23-NOV-2026",30]],"BDL":[["BDL26SEP","29-SEP-2026",425],["BDL26OCT","27-OCT-2026",425],["BDL26NOV","23-NOV-2026",425]],"BEL":[["BEL26SEP","29-SEP-2026",1425],["BEL26OCT","27-OCT-2026",1425],["BEL26NOV","23-NOV-2026",1425]],"BHARATFORG":[["BHARATFORG26SEP","29-SEP-2026",500],["BHARATFORG26OCT","27-OCT-2026",500],["BHARATFORG26NOV","23-NOV-2026",500]],"BHARTIARTL":[["BHARTIARTL26SEP","29-SEP-2026",475],["BHARTIARTL26OCT","27-OCT-2026",475],["BHARTIARTL26NOV","23-NOV-2026",475]],"BHEL":[["BHEL26SEP","29-SEP-2026",2625],["BHEL26OCT","27-OCT-2026",2625],["BHEL26NOV","23-NOV-2026",2625]],"BIOCON":[["BIOCON26SEP","29-SEP-2026",2500],["BIOCON26OCT","27-OCT-2026",2500],["BIOCON26NOV","23-NOV-2026",2500]],"BLUESTARCO":[["BLUESTARCO26SEP","29-SEP-2026",325],["BLUESTARCO26OCT","27-OCT-2026",325],["BLUESTARCO26NOV","23-NOV-2026",325]],"BOSCHLTD":[["BOSCHLTD26SEP","29-SEP-2026",25],["BOSCHLTD26OCT","27-OCT-2026",25],["BOSCHLTD26NOV","23-NOV-2026",25]],"BPCL":[["BPCL26SEP","29-SEP-2026",1975],["BPCL26OCT","27-OCT-2026",1975],["BPCL26NOV","23-NOV-2026",1975]],"BRITANNIA":[["BRITANNIA26SEP","29-SEP-2026",125],["BRITANNIA26OCT","27-OCT-2026",125],["BRITANNIA26NOV","23-NOV-2026",125]],"BSE":[["BSE26SEP","29-SEP-2026",200],["BSE26OCT","27-OCT-2026",200],["BSE26NOV","23-NOV-2026",200]],"CAMS":[["CAMS26SEP","29-SEP-2026",825],["CAMS26OCT","27-OCT-2026",825],["CAMS26NOV","23-NOV-2026",825]],"CANBK":[["CANBK26SEP","29-SEP-2026",6750],["CANBK26OCT","27-OCT-2026",6750],["CANBK26NOV","23-NOV-2026",6750]],"CDSL":[["CDSL26SEP","29-SEP-2026",475],["CDSL26OCT","27-OCT-2026",475],["CDSL26NOV","23-NOV-2026",475]],"CGPOWER":[["CGPOWER26SEP","29-SEP-2026",850],["CGPOWER26OCT","27-OCT-2026",850],["CGPOWER26NOV","23-NOV-2026",850]],"CHOLAFIN":[["CHOLAFIN26SEP","29-SEP-2026",625],["CHOLAFIN26OCT","27-OCT-2026",625],["CHOLAFIN26NOV","23-NOV-2026",625]],"CIPLA":[["CIPLA26SEP","29-SEP-2026",425],["CIPLA26OCT","27-OCT-2026",425],["CIPLA26NOV","23-NOV-2026",425]],"COALINDIA":[["COALINDIA26SEP","29-SEP-2026",1350],["COALINDIA26OCT","27-OCT-2026",1350],["COALINDIA26NOV","23-NOV-2026",1350]],"COCHINSHIP":[["COCHINSHIP26SEP","29-SEP-2026",400],["COCHINSHIP26OCT","27-OCT-2026",400],["COCHINSHIP26NOV","23-NOV-2026",400]],"COFORGE":[["COFORGE26SEP","29-SEP-2026",475],["COFORGE26OCT","27-OCT-2026",475],["COFORGE26NOV","23-NOV-2026",475]],"COLPAL":[["COLPAL26SEP","29-SEP-2026",275],["COLPAL26OCT","27-OCT-2026",275],["COLPAL26NOV","23-NOV-2026",275]],"CONCOR":[["CONCOR26SEP","29-SEP-2026",1250],["CONCOR26OCT","27-OCT-2026",1250],["CONCOR26NOV","23-NOV-2026",1250]],"CROMPTON":[["CROMPTON26SEP","29-SEP-2026",2150],["CROMPTON26OCT","27-OCT-2026",2150],["CROMPTON26NOV","23-NOV-2026",2150]],"CUMMINSIND":[["CUMMINSIND26SEP","29-SEP-2026",200],["CUMMINSIND26OCT","27-OCT-2026",200],["CUMMINSIND26NOV","23-NOV-2026",200]],"DABUR":[["DABUR26SEP","29-SEP-2026",1250],["DABUR26OCT","27-OCT-2026",1250],["DABUR26NOV","23-NOV-2026",1250]],"DELHIVERY":[["DELHIVERY26SEP","29-SEP-2026",2075],["DELHIVERY26OCT","27-OCT-2026",2075],["DELHIVERY26NOV","23-NOV-2026",2075]],"DIVISLAB":[["DIVISLAB26SEP","29-SEP-2026",100],["DIVISLAB26OCT","27-OCT-2026",100],["DIVISLAB26NOV","23-NOV-2026",100]],"DIXON":[["DIXON26SEP","29-SEP-2026",50],["DIXON26OCT","27-OCT-2026",50],["DIXON26NOV","23-NOV-2026",50]],"DLF":[["DLF26SEP","29-SEP-2026",950],["DLF26OCT","27-OCT-2026",950],["DLF26NOV","23-NOV-2026",950]],"DMART":[["DMART26SEP","29-SEP-2026",150],["DMART26OCT","27-OCT-2026",150],["DMART26NOV","23-NOV-2026",150]],"DRREDDY":[["DRREDDY26SEP","29-SEP-2026",625],["DRREDDY26OCT","27-OCT-2026",625],["DRREDDY26NOV","23-NOV-2026",625]],"EICHERMOT":[["EICHERMOT26SEP","29-SEP-2026",100],["EICHERMOT26OCT","27-OCT-2026",100],["EICHERMOT26NOV","23-NOV-2026",100]],"ETERNAL":[["ETERNAL26SEP","29-SEP-2026",2425],["ETERNAL26OCT","27-OCT-2026",2425],["ETERNAL26NOV","23-NOV-2026",2425]],"FEDERALBNK":[["FEDERALBNK26SEP","29-SEP-2026",2500],["FEDERALBNK26OCT","27-OCT-2026",2500],["FEDERALBNK26NOV","23-NOV-2026",2500]],"FINNIFTY":[["FINNIFTY26SEP","29-SEP-2026",60],["FINNIFTY26OCT","27-OCT-2026",60],["FINNIFTY26NOV","23-NOV-2026",60]],"FORCEMOT":[["FORCEMOT26SEP","29-SEP-2026",25],["FORCEMOT26OCT","27-OCT-2026",25],["FORCEMOT26NOV","23-NOV-2026",25]],"FORTIS":[["FORTIS26SEP","29-SEP-2026",775],["FORTIS26OCT","27-OCT-2026",775],["FORTIS26NOV","23-NOV-2026",775]],"GAIL":[["GAIL26SEP","29-SEP-2026",3550],["GAIL26OCT","27-OCT-2026",3550],["GAIL26NOV","23-NOV-2026",3550]],"GLENMARK":[["GLENMARK26SEP","29-SEP-2026",375],["GLENMARK26OCT","27-OCT-2026",375],["GLENMARK26NOV","23-NOV-2026",375]],"GMRAIRPORT":[["GMRAIRPORT26SEP","29-SEP-2026",6975],["GMRAIRPORT26OCT","27-OCT-2026",6975],["GMRAIRPORT26NOV","23-NOV-2026",6975]],"GODFRYPHLP":[["GODFRYPHLP26SEP","29-SEP-2026",275],["GODFRYPHLP26OCT","27-OCT-2026",275],["GODFRYPHLP26NOV","23-NOV-2026",275]],"GODREJCP":[["GODREJCP26SEP","29-SEP-2026",500],["GODREJCP26OCT","27-OCT-2026",500],["GODREJCP26NOV","23-NOV-2026",500]],"GODREJPROP":[["GODREJPROP26SEP","29-SEP-2026",325],["GODREJPROP26OCT","27-OCT-2026",325],["GODREJPROP26NOV","23-NOV-2026",325]],"GRASIM":[["GRASIM26SEP","29-SEP-2026",250],["GRASIM26OCT","27-OCT-2026",250],["GRASIM26NOV","23-NOV-2026",250]],"GVT&D":[["GVT&D26SEP","29-SEP-2026",125],["GVT&D26OCT","27-OCT-2026",125],["GVT&D26NOV","23-NOV-2026",125]],"HAL":[["HAL26SEP","29-SEP-2026",150],["HAL26OCT","27-OCT-2026",150],["HAL26NOV","23-NOV-2026",150]],"HAVELLS":[["HAVELLS26SEP","29-SEP-2026",500],["HAVELLS26OCT","27-OCT-2026",500],["HAVELLS26NOV","23-NOV-2026",500]],"HCLTECH":[["HCLTECH26SEP","29-SEP-2026",400],["HCLTECH26OCT","27-OCT-2026",400],["HCLTECH26NOV","23-NOV-2026",400]],"HDFCAMC":[["HDFCAMC26SEP","29-SEP-2026",300],["HDFCAMC26OCT","27-OCT-2026",300],["HDFCAMC26NOV","23-NOV-2026",300]],"HDFCBANK":[["HDFCBANK26SEP","29-SEP-2026",650],["HDFCBANK26OCT","27-OCT-2026",650],["HDFCBANK26NOV","23-NOV-2026",650]],"HDFCLIFE":[["HDFCLIFE26SEP","29-SEP-2026",1100],["HDFCLIFE26OCT","27-OCT-2026",1100],["HDFCLIFE26NOV","23-NOV-2026",1100]],"HEROMOTOCO":[["HEROMOTOCO26SEP","29-SEP-2026",150],["HEROMOTOCO26OCT","27-OCT-2026",150],["HEROMOTOCO26NOV","23-NOV-2026",150]],"HINDALCO":[["HINDALCO26SEP","29-SEP-2026",700],["HINDALCO26OCT","27-OCT-2026",700],["HINDALCO26NOV","23-NOV-2026",700]],"HINDPETRO":[["HINDPETRO26SEP","29-SEP-2026",2025],["HINDPETRO26OCT","27-OCT-2026",2025],["HINDPETRO26NOV","23-NOV-2026",2025]],"HINDUNILVR":[["HINDUNILVR26SEP","29-SEP-2026",300],["HINDUNILVR26OCT","27-OCT-2026",300],["HINDUNILVR26NOV","23-NOV-2026",300]],"HINDZINC":[["HINDZINC26SEP","29-SEP-2026",1225],["HINDZINC26OCT","27-OCT-2026",1225],["HINDZINC26NOV","23-NOV-2026",1225]],"HYUNDAI":[["HYUNDAI26SEP","29-SEP-2026",275],["HYUNDAI26OCT","27-OCT-2026",275],["HYUNDAI26NOV","23-NOV-2026",275]],"ICICIBANK":[["ICICIBANK26SEP","29-SEP-2026",700],["ICICIBANK26OCT","27-OCT-2026",700],["ICICIBANK26NOV","23-NOV-2026",700]],"ICICIGI":[["ICICIGI26SEP","29-SEP-2026",325],["ICICIGI26OCT","27-OCT-2026",325],["ICICIGI26NOV","23-NOV-2026",325]],"ICICIPRULI":[["ICICIPRULI26SEP","29-SEP-2026",925],["ICICIPRULI26OCT","27-OCT-2026",925],["ICICIPRULI26NOV","23-NOV-2026",925]],"IDEA":[["IDEA26SEP","29-SEP-2026",71475],["IDEA26OCT","27-OCT-2026",71475],["IDEA26NOV","23-NOV-2026",71475]],"IDFCFIRSTB":[["IDFCFIRSTB26SEP","29-SEP-2026",9275],["IDFCFIRSTB26OCT","27-OCT-2026",9275],["IDFCFIRSTB26NOV","23-NOV-2026",9275]],"IEX":[["IEX26SEP","29-SEP-2026",4350],["IEX26OCT","27-OCT-2026",4350],["IEX26NOV","23-NOV-2026",4350]],"INDHOTEL":[["INDHOTEL26SEP","29-SEP-2026",1000],["INDHOTEL26OCT","27-OCT-2026",1000],["INDHOTEL26NOV","23-NOV-2026",1000]],"INDIANB":[["INDIANB26SEP","29-SEP-2026",1000],["INDIANB26OCT","27-OCT-2026",1000],["INDIANB26NOV","23-NOV-2026",1000]],"INDIGO":[["INDIGO26SEP","29-SEP-2026",150],["INDIGO26OCT","27-OCT-2026",150],["INDIGO26NOV","23-NOV-2026",150]],"INDUSINDBK":[["INDUSINDBK26SEP","29-SEP-2026",700],["INDUSINDBK26OCT","27-OCT-2026",700],["INDUSINDBK26NOV","23-NOV-2026",700]],"INDUSTOWER":[["INDUSTOWER26SEP","29-SEP-2026",1700],["INDUSTOWER26OCT","27-OCT-2026",1700],["INDUSTOWER26NOV","23-NOV-2026",1700]],"INFY":[["INFY26SEP","29-SEP-2026",400],["INFY26OCT","27-OCT-2026",400],["INFY26NOV","23-NOV-2026",400]],"INOXWIND":[["INOXWIND26SEP","29-SEP-2026",6400],["INOXWIND26OCT","27-OCT-2026",6400],["INOXWIND26NOV","23-NOV-2026",6400]],"IOC":[["IOC26SEP","29-SEP-2026",4875],["IOC26OCT","27-OCT-2026",4875],["IOC26NOV","23-NOV-2026",4875]],"IREDA":[["IREDA26SEP","29-SEP-2026",4525],["IREDA26OCT","27-OCT-2026",4525],["IREDA26NOV","23-NOV-2026",4525]],"IRFC":[["IRFC26SEP","29-SEP-2026",5425],["IRFC26OCT","27-OCT-2026",5425],["IRFC26NOV","23-NOV-2026",5425]],"ITC":[["ITC26SEP","29-SEP-2026",1725],["ITC26OCT","27-OCT-2026",1725],["ITC26NOV","23-NOV-2026",1725]],"JINDALSTEL":[["JINDALSTEL26SEP","29-SEP-2026",625],["JINDALSTEL26OCT","27-OCT-2026",625],["JINDALSTEL26NOV","23-NOV-2026",625]],"JIOFIN":[["JIOFIN26SEP","29-SEP-2026",2350],["JIOFIN26OCT","27-OCT-2026",2350],["JIOFIN26NOV","23-NOV-2026",2350]],"JSWENERGY":[["JSWENERGY26SEP","29-SEP-2026",1075],["JSWENERGY26OCT","27-OCT-2026",1075],["JSWENERGY26NOV","23-NOV-2026",1075]],"JSWSTEEL":[["JSWSTEEL26SEP","29-SEP-2026",675],["JSWSTEEL26OCT","27-OCT-2026",675],["JSWSTEEL26NOV","23-NOV-2026",675]],"JUBLFOOD":[["JUBLFOOD26SEP","29-SEP-2026",1250],["JUBLFOOD26OCT","27-OCT-2026",1250],["JUBLFOOD26NOV","23-NOV-2026",1250]],"KALYANKJIL":[["KALYANKJIL26SEP","29-SEP-2026",1350],["KALYANKJIL26OCT","27-OCT-2026",1350],["KALYANKJIL26NOV","23-NOV-2026",1350]],"KAYNES":[["KAYNES26SEP","29-SEP-2026",150],["KAYNES26OCT","27-OCT-2026",150],["KAYNES26NOV","23-NOV-2026",150]],"KEI":[["KEI26SEP","29-SEP-2026",175],["KEI26OCT","27-OCT-2026",175],["KEI26NOV","23-NOV-2026",175]],"KFINTECH":[["KFINTECH26SEP","29-SEP-2026",575],["KFINTECH26OCT","27-OCT-2026",575],["KFINTECH26NOV","23-NOV-2026",575]],"KOTAKBANK":[["KOTAKBANK26SEP","29-SEP-2026",2000],["KOTAKBANK26OCT","27-OCT-2026",2000],["KOTAKBANK26NOV","23-NOV-2026",2000]],"KPITTECH":[["KPITTECH26SEP","29-SEP-2026",775],["KPITTECH26OCT","27-OCT-2026",775],["KPITTECH26NOV","23-NOV-2026",775]],"LAURUSLABS":[["LAURUSLABS26SEP","29-SEP-2026",850],["LAURUSLABS26OCT","27-OCT-2026",850],["LAURUSLABS26NOV","23-NOV-2026",850]],"LICHSGFIN":[["LICHSGFIN26SEP","29-SEP-2026",1000],["LICHSGFIN26OCT","27-OCT-2026",1000],["LICHSGFIN26NOV","23-NOV-2026",1000]],"LICI":[["LICI26SEP","29-SEP-2026",1400],["LICI26OCT","27-OCT-2026",1400],["LICI26NOV","23-NOV-2026",1400]],"LODHA":[["LODHA26SEP","29-SEP-2026",625],["LODHA26OCT","27-OCT-2026",625],["LODHA26NOV","23-NOV-2026",625]],"LT":[["LT26SEP","29-SEP-2026",175],["LT26OCT","27-OCT-2026",175],["LT26NOV","23-NOV-2026",175]],"LTF":[["LTF26SEP","29-SEP-2026",2250],["LTF26OCT","27-OCT-2026",2250],["LTF26NOV","23-NOV-2026",2250]],"LTM":[["LTM26SEP","29-SEP-2026",150],["LTM26OCT","27-OCT-2026",150],["LTM26NOV","23-NOV-2026",150]],"LUPIN":[["LUPIN26SEP","29-SEP-2026",425],["LUPIN26OCT","27-OCT-2026",425],["LUPIN26NOV","23-NOV-2026",425]],"M&M":[["M&M26SEP","29-SEP-2026",200],["M&M26OCT","27-OCT-2026",200],["M&M26NOV","23-NOV-2026",200]],"MAHABANK":[["MAHABANK26SEP","29-SEP-2026",6500],["MAHABANK26OCT","27-OCT-2026",6500],["MAHABANK26NOV","23-NOV-2026",6500]],"MANAPPURAM":[["MANAPPURAM26SEP","29-SEP-2026",3000],["MANAPPURAM26OCT","27-OCT-2026",3000],["MANAPPURAM26NOV","23-NOV-2026",3000]],"MANKIND":[["MANKIND26SEP","29-SEP-2026",250],["MANKIND26OCT","27-OCT-2026",250],["MANKIND26NOV","23-NOV-2026",250]],"MARICO":[["MARICO26SEP","29-SEP-2026",1200],["MARICO26OCT","27-OCT-2026",1200],["MARICO26NOV","23-NOV-2026",1200]],"MARUTI":[["MARUTI26SEP","29-SEP-2026",50],["MARUTI26OCT","27-OCT-2026",50],["MARUTI26NOV","23-NOV-2026",50]],"MAXHEALTH":[["MAXHEALTH26SEP","29-SEP-2026",525],["MAXHEALTH26OCT","27-OCT-2026",525],["MAXHEALTH26NOV","23-NOV-2026",525]],"MAZDOCK":[["MAZDOCK26SEP","29-SEP-2026",225],["MAZDOCK26OCT","27-OCT-2026",225],["MAZDOCK26NOV","23-NOV-2026",225]],"MCX":[["MCX26SEP","29-SEP-2026",225],["MCX26OCT","27-OCT-2026",225],["MCX26NOV","23-NOV-2026",225]],"MFSL":[["MFSL26SEP","29-SEP-2026",400],["MFSL26OCT","27-OCT-2026",400],["MFSL26NOV","23-NOV-2026",400]],"MIDCPNIFTY":[["MIDCPNIFTY26SEP","29-SEP-2026",120],["MIDCPNIFTY26OCT","27-OCT-2026",120],["MIDCPNIFTY26NOV","23-NOV-2026",120]],"MOTHERSON":[["MOTHERSON26SEP","29-SEP-2026",6150],["MOTHERSON26OCT","27-OCT-2026",6150],["MOTHERSON26NOV","23-NOV-2026",6150]],"MOTILALOFS":[["MOTILALOFS26SEP","29-SEP-2026",775],["MOTILALOFS26OCT","27-OCT-2026",775],["MOTILALOFS26NOV","23-NOV-2026",775]],"MPHASIS":[["MPHASIS26SEP","29-SEP-2026",275],["MPHASIS26OCT","27-OCT-2026",275],["MPHASIS26NOV","23-NOV-2026",275]],"MUTHOOTFIN":[["MUTHOOTFIN26SEP","29-SEP-2026",275],["MUTHOOTFIN26OCT","27-OCT-2026",275],["MUTHOOTFIN26NOV","23-NOV-2026",275]],"NAM-INDIA":[["NAM-INDIA26SEP","29-SEP-2026",625],["NAM-INDIA26OCT","27-OCT-2026",625],["NAM-INDIA26NOV","23-NOV-2026",625]],"NATIONALUM":[["NATIONALUM26SEP","29-SEP-2026",1875],["NATIONALUM26OCT","27-OCT-2026",1875],["NATIONALUM26NOV","23-NOV-2026",1875]],"NAUKRI":[["NAUKRI26SEP","29-SEP-2026",550],["NAUKRI26OCT","27-OCT-2026",550],["NAUKRI26NOV","23-NOV-2026",550]],"NBCC":[["NBCC26SEP","29-SEP-2026",6500],["NBCC26OCT","27-OCT-2026",6500],["NBCC26NOV","23-NOV-2026",6500]],"NESTLEIND":[["NESTLEIND26SEP","29-SEP-2026",500],["NESTLEIND26OCT","27-OCT-2026",500],["NESTLEIND26NOV","23-NOV-2026",500]],"NHPC":[["NHPC26SEP","29-SEP-2026",6950],["NHPC26OCT","27-OCT-2026",6950],["NHPC26NOV","23-NOV-2026",6950]],"NIFTY":[["NIFTY26SEP","29-SEP-2026",65],["NIFTY26OCT","27-OCT-2026",65],["NIFTY26NOV","23-NOV-2026",65],["NIFTY26O13","13-OCT-2026",65],["NIFTY26O06","06-OCT-2026",65],["NIFTY26922","22-SEP-2026",65],["NIFTY26915","15-SEP-2026",65]],"NIFTYFPI":[["NIFTYFPI26SEP","29-SEP-2026",1100],["NIFTYFPI26OCT","27-OCT-2026",1100],["NIFTYFPI26NOV","23-NOV-2026",1100]],"NIFTYNXT50":[["NIFTYNXT5026SEP","29-SEP-2026",25],["NIFTYNXT5026OCT","27-OCT-2026",25],["NIFTYNXT5026NOV","23-NOV-2026",25]],"NMDC":[["NMDC26SEP","29-SEP-2026",6750],["NMDC26OCT","27-OCT-2026",6750],["NMDC26NOV","23-NOV-2026",6750]],"NTPC":[["NTPC26SEP","29-SEP-2026",1500],["NTPC26OCT","27-OCT-2026",1500],["NTPC26NOV","23-NOV-2026",1500]],"NYKAA":[["NYKAA26SEP","29-SEP-2026",3125],["NYKAA26OCT","27-OCT-2026",3125],["NYKAA26NOV","23-NOV-2026",3125]],"OBEROIRLTY":[["OBEROIRLTY26SEP","29-SEP-2026",350],["OBEROIRLTY26OCT","27-OCT-2026",350],["OBEROIRLTY26NOV","23-NOV-2026",350]],"OFSS":[["OFSS26SEP","29-SEP-2026",100],["OFSS26OCT","27-OCT-2026",100],["OFSS26NOV","23-NOV-2026",100]],"OIL":[["OIL26SEP","29-SEP-2026",1400],["OIL26OCT","27-OCT-2026",1400],["OIL26NOV","23-NOV-2026",1400]],"ONGC":[["ONGC26SEP","29-SEP-2026",2250],["ONGC26OCT","27-OCT-2026",2250],["ONGC26NOV","23-NOV-2026",2250]],"PAGEIND":[["PAGEIND26SEP","29-SEP-2026",20],["PAGEIND26OCT","27-OCT-2026",20],["PAGEIND26NOV","23-NOV-2026",20]],"PATANJALI":[["PATANJALI26SEP","29-SEP-2026",1075],["PATANJALI26OCT","27-OCT-2026",1075],["PATANJALI26NOV","23-NOV-2026",1075]],"PAYTM":[["PAYTM26SEP","29-SEP-2026",725],["PAYTM26OCT","27-OCT-2026",725],["PAYTM26NOV","23-NOV-2026",725]],"PERSISTENT":[["PERSISTENT26SEP","29-SEP-2026",125],["PERSISTENT26OCT","27-OCT-2026",125],["PERSISTENT26NOV","23-NOV-2026",125]],"PETRONET":[["PETRONET26SEP","29-SEP-2026",1900],["PETRONET26OCT","27-OCT-2026",1900],["PETRONET26NOV","23-NOV-2026",1900]],"PFC":[["PFC26SEP","29-SEP-2026",1300],["PFC26OCT","27-OCT-2026",1300],["PFC26NOV","23-NOV-2026",1300]],"PGEL":[["PGEL26SEP","29-SEP-2026",950],["PGEL26OCT","27-OCT-2026",950],["PGEL26NOV","23-NOV-2026",950]],"PHOENIXLTD":[["PHOENIXLTD26SEP","29-SEP-2026",350],["PHOENIXLTD26OCT","27-OCT-2026",350],["PHOENIXLTD26NOV","23-NOV-2026",350]],"PIDILITIND":[["PIDILITIND26SEP","29-SEP-2026",500],["PIDILITIND26OCT","27-OCT-2026",500],["PIDILITIND26NOV","23-NOV-2026",500]],"PIIND":[["PIIND26SEP","29-SEP-2026",175],["PIIND26OCT","27-OCT-2026",175],["PIIND26NOV","23-NOV-2026",175]],"PNB":[["PNB26SEP","29-SEP-2026",8000],["PNB26OCT","27-OCT-2026",8000],["PNB26NOV","23-NOV-2026",8000]],"PNBHOUSING":[["PNBHOUSING26SEP","29-SEP-2026",650],["PNBHOUSING26OCT","27-OCT-2026",650],["PNBHOUSING26NOV","23-NOV-2026",650]],"POLICYBZR":[["POLICYBZR26SEP","29-SEP-2026",350],["POLICYBZR26OCT","27-OCT-2026",350],["POLICYBZR26NOV","23-NOV-2026",350]],"POLYCAB":[["POLYCAB26SEP","29-SEP-2026",125],["POLYCAB26OCT","27-OCT-2026",125],["POLYCAB26NOV","23-NOV-2026",125]],"POWERGRID":[["POWERGRID26SEP","29-SEP-2026",1900],["POWERGRID26OCT","27-OCT-2026",1900],["POWERGRID26NOV","23-NOV-2026",1900]],"POWERINDIA":[["POWERINDIA26SEP","29-SEP-2026",25],["POWERINDIA26OCT","27-OCT-2026",25],["POWERINDIA26NOV","23-NOV-2026",25]],"PREMIERENE":[["PREMIERENE26SEP","29-SEP-2026",650],["PREMIERENE26OCT","27-OCT-2026",650],["PREMIERENE26NOV","23-NOV-2026",650]],"PRESTIGE":[["PRESTIGE26SEP","29-SEP-2026",450],["PRESTIGE26OCT","27-OCT-2026",450],["PRESTIGE26NOV","23-NOV-2026",450]],"RADICO":[["RADICO26SEP","29-SEP-2026",150],["RADICO26OCT","27-OCT-2026",150],["RADICO26NOV","23-NOV-2026",150]],"RBLBANK":[["RBLBANK26SEP","29-SEP-2026",3175],["RBLBANK26OCT","27-OCT-2026",3175],["RBLBANK26NOV","23-NOV-2026",3175]],"RECLTD":[["RECLTD26SEP","29-SEP-2026",1575],["RECLTD26OCT","27-OCT-2026",1575],["RECLTD26NOV","23-NOV-2026",1575]],"RELIANCE":[["RELIANCE26SEP","29-SEP-2026",500],["RELIANCE26OCT","27-OCT-2026",500],["RELIANCE26NOV","23-NOV-2026",500]],"RVNL":[["RVNL26SEP","29-SEP-2026",1925],["RVNL26OCT","27-OCT-2026",1925],["RVNL26NOV","23-NOV-2026",1925]],"SAGILITY":[["SAGILITY26SEP","29-SEP-2026",12000],["SAGILITY26OCT","27-OCT-2026",12000],["SAGILITY26NOV","23-NOV-2026",12000]],"SAIL":[["SAIL26SEP","29-SEP-2026",4700],["SAIL26OCT","27-OCT-2026",4700],["SAIL26NOV","23-NOV-2026",4700]],"SBICARD":[["SBICARD26SEP","29-SEP-2026",800],["SBICARD26OCT","27-OCT-2026",800],["SBICARD26NOV","23-NOV-2026",800]],"SBILIFE":[["SBILIFE26SEP","29-SEP-2026",375],["SBILIFE26OCT","27-OCT-2026",375],["SBILIFE26NOV","23-NOV-2026",375]],"SBIN":[["SBIN26SEP","29-SEP-2026",750],["SBIN26OCT","27-OCT-2026",750],["SBIN26NOV","23-NOV-2026",750]],"SHREECEM":[["SHREECEM26SEP","29-SEP-2026",25],["SHREECEM26OCT","27-OCT-2026",25],["SHREECEM26NOV","23-NOV-2026",25]],"SHRIRAMFIN":[["SHRIRAMFIN26SEP","29-SEP-2026",825],["SHRIRAMFIN26OCT","27-OCT-2026",825],["SHRIRAMFIN26NOV","23-NOV-2026",825]],"SIEMENS":[["SIEMENS26SEP","29-SEP-2026",175],["SIEMENS26OCT","27-OCT-2026",175],["SIEMENS26NOV","23-NOV-2026",175]],"SOLARINDS":[["SOLARINDS26SEP","29-SEP-2026",50],["SOLARINDS26OCT","27-OCT-2026",50],["SOLARINDS26NOV","23-NOV-2026",50]],"SONACOMS":[["SONACOMS26SEP","29-SEP-2026",1225],["SONACOMS26OCT","27-OCT-2026",1225],["SONACOMS26NOV","23-NOV-2026",1225]],"SRF":[["SRF26SEP","29-SEP-2026",200],["SRF26OCT","27-OCT-2026",200],["SRF26NOV","23-NOV-2026",200]],"SUNPHARMA":[["SUNPHARMA26SEP","29-SEP-2026",350],["SUNPHARMA26OCT","27-OCT-2026",350],["SUNPHARMA26NOV","23-NOV-2026",350]],"SUPREMEIND":[["SUPREMEIND26SEP","29-SEP-2026",175],["SUPREMEIND26OCT","27-OCT-2026",175],["SUPREMEIND26NOV","23-NOV-2026",175]],"SUZLON":[["SUZLON26SEP","29-SEP-2026",12700],["SUZLON26OCT","27-OCT-2026",12700],["SUZLON26NOV","23-NOV-2026",12700]],"SWIGGY":[["SWIGGY26SEP","29-SEP-2026",1825],["SWIGGY26OCT","27-OCT-2026",1825],["SWIGGY26NOV","23-NOV-2026",1825]],"TATACONSUM":[["TATACONSUM26SEP","29-SEP-2026",550],["TATACONSUM26OCT","27-OCT-2026",550],["TATACONSUM26NOV","23-NOV-2026",550]],"TATAELXSI":[["TATAELXSI26SEP","29-SEP-2026",125],["TATAELXSI26OCT","27-OCT-2026",125],["TATAELXSI26NOV","23-NOV-2026",125]],"TATAPOWER":[["TATAPOWER26SEP","29-SEP-2026",1450],["TATAPOWER26OCT","27-OCT-2026",1450],["TATAPOWER26NOV","23-NOV-2026",1450]],"TATASTEEL":[["TATASTEEL26SEP","29-SEP-2026",2750],["TATASTEEL26OCT","27-OCT-2026",2750],["TATASTEEL26NOV","23-NOV-2026",2750]],"TCS":[["TCS26SEP","29-SEP-2026",225],["TCS26OCT","27-OCT-2026",225],["TCS26NOV","23-NOV-2026",225]],"TECHM":[["TECHM26SEP","29-SEP-2026",600],["TECHM26OCT","27-OCT-2026",600],["TECHM26NOV","23-NOV-2026",600]],"TIINDIA":[["TIINDIA26SEP","29-SEP-2026",200],["TIINDIA26OCT","27-OCT-2026",200],["TIINDIA26NOV","23-NOV-2026",200]],"TITAN":[["TITAN26SEP","29-SEP-2026",175],["TITAN26OCT","27-OCT-2026",175],["TITAN26NOV","23-NOV-2026",175]],"TMPV":[["TMPV26SEP","29-SEP-2026",1600],["TMPV26OCT","27-OCT-2026",1600],["TMPV26NOV","23-NOV-2026",1600]],"TORNTPHARM":[["TORNTPHARM26SEP","29-SEP-2026",125],["TORNTPHARM26OCT","27-OCT-2026",125],["TORNTPHARM26NOV","23-NOV-2026",125]],"TRENT":[["TRENT26SEP","29-SEP-2026",225],["TRENT26OCT","27-OCT-2026",225],["TRENT26NOV","23-NOV-2026",225]],"TVSMOTOR":[["TVSMOTOR26SEP","29-SEP-2026",175],["TVSMOTOR26OCT","27-OCT-2026",175],["TVSMOTOR26NOV","23-NOV-2026",175]],"ULTRACEMCO":[["ULTRACEMCO26SEP","29-SEP-2026",50],["ULTRACEMCO26OCT","27-OCT-2026",50],["ULTRACEMCO26NOV","23-NOV-2026",50]],"UNIONBANK":[["UNIONBANK26SEP","29-SEP-2026",4425],["UNIONBANK26OCT","27-OCT-2026",4425],["UNIONBANK26NOV","23-NOV-2026",4425]],"UNITDSPR":[["UNITDSPR26SEP","29-SEP-2026",400],["UNITDSPR26OCT","27-OCT-2026",400],["UNITDSPR26NOV","23-NOV-2026",400]],"UNOMINDA":[["UNOMINDA26SEP","29-SEP-2026",550],["UNOMINDA26OCT","27-OCT-2026",550],["UNOMINDA26NOV","23-NOV-2026",550]],"UPL":[["UPL26SEP","29-SEP-2026",1355],["UPL26OCT","27-OCT-2026",1355],["UPL26NOV","23-NOV-2026",1355]],"VBL":[["VBL26SEP","29-SEP-2026",1275],["VBL26OCT","27-OCT-2026",1275],["VBL26NOV","23-NOV-2026",1275]],"VEDL":[["VEDL26SEP","29-SEP-2026",1150],["VEDL26OCT","27-OCT-2026",1150],["VEDL26NOV","23-NOV-2026",1150]],"VMM":[["VMM26SEP","29-SEP-2026",4850],["VMM26OCT","27-OCT-2026",4850],["VMM26NOV","23-NOV-2026",4850]],"VOLTAS":[["VOLTAS26SEP","29-SEP-2026",375],["VOLTAS26OCT","27-OCT-2026",375],["VOLTAS26NOV","23-NOV-2026",375]],"WAAREEENER":[["WAAREEENER26SEP","29-SEP-2026",175],["WAAREEENER26OCT","27-OCT-2026",175],["WAAREEENER26NOV","23-NOV-2026",175]],"WIPRO":[["WIPRO26SEP","29-SEP-2026",3000],["WIPRO26OCT","27-OCT-2026",3000],["WIPRO26NOV","23-NOV-2026",3000]],"YESBANK":[["YESBANK26SEP","29-SEP-2026",31100],["YESBANK26OCT","27-OCT-2026",31100],["YESBANK26NOV","23-NOV-2026",31100]],"ZYDUSLIFE":[["ZYDUSLIFE26SEP","29-SEP-2026",900],["ZYDUSLIFE26OCT","27-OCT-2026",900],["ZYDUSLIFE26NOV","23-NOV-2026",900]],"SENSEX":[["SENSEX26O15","15-OCT-2026",20],["SENSEX26910","10-SEP-2026",20],["SENSEX26O22","22-OCT-2026",20],["SENSEX26917","17-SEP-2026",20],["SENSEX26O08","08-OCT-2026",20],["SENSEX26O01","01-OCT-2026",20]]};

    _resolveZerodhaScripAndLot(symbol, expiryDate) {
        let sym = (symbol || '').toUpperCase().replace(/[^A-Z0-9&\-]/g, '');
        const aliases = {
            'NIFTY50': 'NIFTY',
            'NIFTYBANK': 'BANKNIFTY',
            'BANKNIFTY': 'BANKNIFTY',
            'FINNIFTY': 'FINNIFTY',
            'MIDCPNIFTY': 'MIDCPNIFTY',
            'SENSEX': 'SENSEX',
            'BANKEX': 'BANKEX',
            'MM': 'M&M',
            'LTFH': 'LTF'
        };
        if (aliases[sym]) sym = aliases[sym];

        const contracts = this._zerodhaContracts ? this._zerodhaContracts[sym] : null;
        const exchange = (sym === 'SENSEX' || sym === 'BANKEX') ? 'BFO' : 'NFO';

        if (!contracts || contracts.length === 0) {
            // Fallback to monthly format
            const curMonths = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
            const curYY = String(new Date().getFullYear()).slice(2);
            const curMMM = curMonths[new Date().getMonth()];
            const lot = typeof this._getLotSize === 'function' ? this._getLotSize(sym) : 100;
            return { scrip: `${sym}${curYY}${curMMM}`, lotSize: lot, exchange };
        }

        // Match expiry if provided
        if (expiryDate && expiryDate.length >= 7) {
            const cleanExp = expiryDate.toUpperCase();
            // 1. Direct match on expStr (e.g. 15-SEP-2026 or 29-SEP)
            const direct = contracts.find(c => cleanExp.includes(c[1]) || c[1].includes(cleanExp));
            if (direct) {
                return { scrip: direct[0], lotSize: direct[2], exchange };
            }

            // 2. Parse YYYY-MM-DD or DD-MMM-YYYY
            const curMonths = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
            let targetMMM = '';
            let targetDD = '';
            if (expiryDate.includes('-')) {
                const parts = expiryDate.split('-');
                if (parts.length === 3 && parts[0].length === 4) { // YYYY-MM-DD
                    const mIdx = parseInt(parts[1], 10) - 1;
                    if (mIdx >= 0 && mIdx < 12) targetMMM = curMonths[mIdx];
                    targetDD = parts[2].padStart(2, '0');
                } else if (parts.length === 3 && parts[2].length === 4) { // DD-MMM-YYYY
                    targetDD = parts[0].padStart(2, '0');
                    targetMMM = parts[1].toUpperCase();
                }
            }

            if (targetMMM) {
                // If weekly contract exists matching day and month (e.g. 15-SEP-2026)
                if (targetDD) {
                    const dayMatch = contracts.find(c => c[1].startsWith(targetDD) && c[1].includes(targetMMM));
                    if (dayMatch) return { scrip: dayMatch[0], lotSize: dayMatch[2], exchange };
                }
                // Month match
                const monthMatch = contracts.find(c => c[1].includes(targetMMM));
                if (monthMatch) return { scrip: monthMatch[0], lotSize: monthMatch[2], exchange };
            }
        }

        // Default to nearest contract
        return { scrip: contracts[0][0], lotSize: contracts[0][2], exchange };
    }

    async _enqueueSpanRequest(body, cacheKey, resolved, actualLot) {
        if (!this._spanQueue) this._spanQueue = [];
        if (this._spanActiveCount === undefined) this._spanActiveCount = 0;

        return new Promise((resolve) => {
            this._spanQueue.push({ body, cacheKey, resolved, actualLot, resolve });
            this._processSpanQueue();
        });
    }

    async _processSpanQueue() {
        if (!this._spanQueue || this._spanQueue.length === 0) return;
        if (this._spanActiveCount >= 2) return; // Strict max 2 concurrent requests to Zerodha SPAN

        const task = this._spanQueue.shift();
        this._spanActiveCount++;

        try {
            const result = await this._executeSpanFetch(task.body, task.cacheKey, task.resolved, task.actualLot);
            task.resolve(result);
        } catch (e) {
            task.resolve(null);
        } finally {
            this._spanActiveCount--;
            // Rate-limit buffer between requests
            setTimeout(() => this._processSpanQueue(), 80);
        }
    }

    async _executeSpanFetch(body, cacheKey, resolved, actualLot, retryCount = 0) {
        if (this._spanCache && this._spanCache.has(cacheKey)) {
            return this._spanCache.get(cacheKey);
        }

        const endpoints = [];
        if (this.proxyUrl) {
            endpoints.push(`${this.proxyUrl}/api/zerodha-margin`);
        }
        endpoints.push('https://destrade-market-worker.onrender.com/api/zerodha-margin');

        for (const ep of endpoints) {
            try {
                const res = await fetch(ep, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: body,
                    signal: AbortSignal.timeout(10000)
                });

                if (res.status === 429 && retryCount < 2) {
                    // Backoff delay on 429 Too Many Requests
                    await new Promise(r => setTimeout(r, 600 * (retryCount + 1)));
                    return this._executeSpanFetch(body, cacheKey, resolved, actualLot, retryCount + 1);
                }

                if (res.ok) {
                    const data = await res.json();
                    if (data && data.total && typeof data.total.total === 'number' && data.total.total > 0) {
                        const result = {
                            span: data.total.span,
                            exposure: data.total.exposure,
                            total: data.total.total,
                            netOptionValue: data.total.netoptionvalue || 0,
                            lotSize: actualLot,
                            scrip: resolved.scrip,
                            exchange: resolved.exchange,
                            modelName: 'Zerodha Live SPAN'
                        };
                        this._spanCache.set(cacheKey, result);
                        return result;
                    }
                }
            } catch (e) {}
        }
        return null;
    }

    async fetchZerodhaSpanMargin(symbol, strike, type, lotSize, expiryDate, hedgeStrike = null) {
        const cleanSym = (symbol || '').toUpperCase().replace(/[^A-Z0-9&\-]/g, '');
        const resolved = this._resolveZerodhaScripAndLot(cleanSym, expiryDate);
        if (!resolved || !resolved.scrip) return null;

        const { scrip, exchange } = resolved;
        const actualLot = resolved.lotSize || lotSize || 100;
        
        // In-memory cache to make repetitive strike calculations instant (0ms)
        if (!this._spanCache) this._spanCache = new Map();
        const cacheKey = `${cleanSym}_${type}_${strike}_${hedgeStrike || 'naked'}_${actualLot}_${scrip}_${exchange}`;
        if (this._spanCache.has(cacheKey)) {
            return this._spanCache.get(cacheKey);
        }

        let body = `action=calculate&exchange%5B%5D=${exchange}&product%5B%5D=OPT&scrip%5B%5D=${encodeURIComponent(scrip)}&option_type%5B%5D=${type}&strike_price%5B%5D=${strike}&qty%5B%5D=${actualLot}&trade%5B%5D=sell`;

        if (hedgeStrike) {
            body += `&exchange%5B%5D=${exchange}&product%5B%5D=OPT&scrip%5B%5D=${encodeURIComponent(scrip)}&option_type%5B%5D=${type}&strike_price%5B%5D=${hedgeStrike}&qty%5B%5D=${actualLot}&trade%5B%5D=buy`;
        }

        return this._enqueueSpanRequest(body, cacheKey, resolved, actualLot);
    }
}

window.nseApi = new NSEApi();
