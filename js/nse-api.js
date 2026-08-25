/**
 * Destrade Pro — NSE API Layer (v6)
 * OI Clock, PCR, Volume Shockers, 52W Scanners, Live Search, Smart Caching
 */

class NSEApi {
    constructor() {
        const isCapacitor = !!(window.Capacitor || window.location.protocol === 'capacitor:' || window.location.href.includes('android_asset'));
        const host = window.location.hostname;
        const isLocalDevServer = !isCapacitor && (host === 'localhost' || host === '127.0.0.1' || /^192\.168\./.test(host) || /^10\./.test(host) || host.endsWith('.local'));
        
        // Use local dev server if running node server locally on desktop, otherwise stream directly via Groww & Firebase
        if (isLocalDevServer && window.location.port) {
            this.proxyUrl = `${window.location.protocol}//${window.location.host}`;
        } else {
            this.proxyUrl = '';
        }
        this._cache = new Map();
        this._cacheTTL = 800; // 0.8s cache TTL for 1s real-time streaming
        this.fnoSymbols = ["360ONE","ABB","ABCAPITAL","ADANIENSOL","ADANIENT","ADANIGREEN","ADANIPORTS","ADANIPOWER","ALKEM","AMBER","AMBUJACEM","ANGELONE","APLAPOLLO","APOLLOHOSP","ASHOKLEY","ASIANPAINT","ASTRAL","AUBANK","AUROPHARMA","AXISBANK","BAJAJ-AUTO","BAJAJFINSV","BAJAJHLDNG","BAJFINANCE","BANDHANBNK","BANKBARODA","BANKINDIA","BANKNIFTY","BDL","BEL","BHARATFORG","BHARTIARTL","BHEL","BIOCON","BLUESTARCO","BOSCHLTD","BPCL","BRITANNIA","BSE","CAMS","CANBK","CDSL","CGPOWER","CHOLAFIN","CIPLA","COALINDIA","COCHINSHIP","COFORGE","COLPAL","CONCOR","CROMPTON","CUMMINSIND","DABUR","DALBHARAT","DELHIVERY","DIVISLAB","DIXON","DLF","DMART","DRREDDY","EICHERMOT","ETERNAL","EXIDEIND","FEDERALBNK","FINNIFTY","FORCEMOT","FORTIS","GAIL","GLENMARK","GMRAIRPORT","GODFRYPHLP","GODREJCP","GODREJPROP","GRASIM","HAL","HAVELLS","HCLTECH","HDFCAMC","HDFCBANK","HDFCLIFE","HEROMOTOCO","HINDALCO","HINDPETRO","HINDUNILVR","HINDZINC","HUDCO","HYUNDAI","ICICIBANK","ICICIGI","ICICIPRULI","IDEA","IDFCFIRSTB","IEX","INDHOTEL","INDIANB","INDIGO","INDUSINDBK","INDUSTOWER","INFY","INOXWIND","IOC","IREDA","IRFC","ITC","JINDALSTEL","JIOFIN","JSWENERGY","JSWSTEEL","JUBLFOOD","KALYANKJIL","KAYNES","KEI","KFINTECH","KOTAKBANK","KPITTECH","LAURUSLABS","LICHSGFIN","LICI","LODHA","LT","LTF","LTM","LUPIN","M&M","MANAPPURAM","MANKIND","MARICO","MARUTI","MAXHEALTH","MAZDOCK","MCX","MFSL","MIDCPNIFTY","MOTHERSON","MOTILALOFS","MPHASIS","MUTHOOTFIN","NAM-INDIA","NATIONALUM","NAUKRI","NBCC","NESTLEIND","NHPC","NIFTY","NMDC","NTPC","NUVAMA","NYKAA","OBEROIRLTY","OFSS","OIL","ONGC","PAGEIND","PATANJALI","PAYTM","PERSISTENT","PETRONET","PFC","PGEL","PHOENIXLTD","PIDILITIND","PIIND","PNB","PNBHOUSING","POLICYBZR","POLYCAB","POWERGRID","POWERINDIA","PPLPHARMA","PREMIERENE","PRESTIGE","RBLBANK","RECLTD","RELIANCE","RVNL","SAIL","SAMMAANCAP","SBICARD","SBILIFE","SBIN","SHREECEM","SHRIRAMFIN","SIEMENS","SOLARINDS","SONACOMS","SRF","SUNPHARMA","SUPREMEIND","SUZLON","SWIGGY","TATACONSUM","TATAELXSI","TATAPOWER","TATASTEEL","TATATECH","TCS","TECHM","TIINDIA","TITAN","TMPV","TORNTPHARM","TORNTPOWER","TRENT","TVSMOTOR","ULTRACEMCO","UNIONBANK","UNITDSPR","UNOMINDA","UPL","VBL","VEDL","VMM","VOLTAS","WAAREEENER","WIPRO","YESBANK","ZYDUSLIFE","NIFTYNXT50"];
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
        const effectiveRetries = isOC ? 0 : retries;

        // 1. Client-side cache check
        const cached = this._cache.get(endpoint);
        if (cached && Date.now() - cached.t < this._cacheTTL) {
            return cached.d;
        }

        // 2. In-flight request deduplication
        if (!this._inFlight) this._inFlight = new Map();
        if (this._inFlight.has(endpoint)) {
            return this._inFlight.get(endpoint);
        }

        // 3. Perform the actual fetch
        const fetchPromise = (async () => {
            const clean = endpoint.startsWith('/api') ? endpoint : `/api${endpoint}`;
            const connector = clean.includes('?') ? '&' : '?';
            const bustedEndpoint = `${clean}${connector}_t=${Date.now()}`;
            const url = this.proxyUrl ? `${this.proxyUrl}${bustedEndpoint}` : bustedEndpoint;

            try {
                const res = await fetch(url, {
                    cache: 'no-store',
                    headers: {
                        'Accept': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest',
                        'Referer': 'https://www.nseindia.com/'
                    },
                    signal: AbortSignal.timeout(isOC ? 4000 : 15 * 1000)
                });

                const contentType = res.headers.get('content-type') || '';
                if (!res.ok || contentType.includes('text/html')) {
                    if (effectiveRetries > 0 && res.status !== 404 && !contentType.includes('text/html')) {
                        console.warn(`[API RETRY] ${url} Status: ${res.status}. Retrying in ${backoff}ms...`);
                        await new Promise(r => setTimeout(r, backoff));
                        return this._fetch(endpoint, effectiveRetries - 1, backoff * 2);
                    }
                    this.proxyDetails.lastError = `Unreachable endpoint ${endpoint}`;
                    return null;
                }

                const text = await res.text();
                if (!text || text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
                    return null;
                }

                const data = JSON.parse(text);
                this._cache.set(endpoint, { d: data, t: Date.now() });
                this.proxyDetails.lastError = null;
                return data;
            } catch (e) {
                if (effectiveRetries > 0) {
                    console.warn(`[API RETRY] ${url} Error: ${e.message}. Retrying in ${backoff}ms...`);
                    await new Promise(r => setTimeout(r, backoff));
                    return this._fetch(endpoint, effectiveRetries - 1, backoff * 2);
                }
                if (!isOC) console.warn(`⚠️ ${endpoint}: ${e.message}`);
                this.proxyDetails.lastError = e.message;
                return null;
            } finally {
                this._inFlight.delete(endpoint);
            }
        })();

        this._inFlight.set(endpoint, fetchPromise);
        return fetchPromise;
    }

    async _fetchGroww(path) {
        const rawUrl = path.startsWith('http') ? path : `https://groww.in${path.startsWith('/') ? '' : '/'}${path}`;
        const isCapacitor = typeof window !== 'undefined' && window.Capacitor;

        // 1. Native Mobile App (Capacitor Android/iOS APK): Direct Fetch with timeout
        if (isCapacitor) {
            try {
                const res = await fetch(rawUrl, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
                if (res.ok) {
                    const text = await res.text();
                    if (text && !text.trim().startsWith('<')) {
                        const data = JSON.parse(text);
                        if (data && !data.error && !data.errorCode) return data;
                    }
                }
            } catch (e) {
                // Direct fetch failed (blocked/timeout), fall through to cloud proxy
            }
        }

        // 2. Cloud CORS Proxy (works for both web browsers and mobile apps)
        try {
            const cloudUrl = `https://destrade-market-worker.onrender.com/api/proxy?url=${encodeURIComponent(rawUrl)}`;
            const res = await fetch(cloudUrl, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
            if (res.ok) {
                const text = await res.text();
                if (text && !text.trim().startsWith('<')) {
                    const data = JSON.parse(text);
                    if (data && !data.error && !data.errorCode) return data;
                }
            }
        } catch (e) {}

        // 3. Fallback: Local Node Dev-Proxy (only when running locally, skip on Capacitor)
        if (!isCapacitor && this.proxyUrl) {
            const cleanPath = rawUrl.replace('https://groww.in', '');
            const endpoint = `/groww${cleanPath.startsWith('/') ? '' : '/'}${cleanPath}`;
            return this._fetch(endpoint);
        }

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

        // 4. Resilient Fallback: Populate stockMap directly from App._liveSnapshot (210 symbols)
        if (window.App && window.App._liveSnapshot) {
            const snap = window.App._liveSnapshot;
            Object.keys(snap).forEach(sym => {
                const s = snap[sym];
                if (!s) return;
                const curSpot = s.c ? s.c[2] : (s.cur ? s.cur.spot : 0);
                const h1Spot = s.h ? s.h[2] : (s.h1 ? (s.h1.spot || curSpot) : curSpot);
                if (!curSpot) return;

                let diff = curSpot - h1Spot;
                let curPcr = s.c ? s.c[1] : (s.cur ? s.cur.value : 1.0);
                let h1Pcr = s.h ? s.h[1] : (s.h1 ? s.h1.value : curPcr);
                let pcrDiff = curPcr - h1Pcr;

                // Off-market / weekend fallback: if spot price has 0 diff, compute bias from PCR & 5m/15m/30m trends
                if (Math.abs(diff) < 0.001) {
                    const m5Spot = s.m5 ? s.m5[2] : 0;
                    const m15Spot = s.m15 ? s.m15[2] : 0;
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
                if (!discovered.includes(sym)) discovered.push(sym);
            });
        }

        if (discovered.length > 10) {
            if (JSON.stringify(discovered) !== JSON.stringify(this.fnoSymbols)) {
                this.fnoSymbols = discovered;
                console.log(`✨ Discovered ${this.fnoSymbols.length} Pure F&O Symbols`);
            }
        }

        const result = {
            stocks: Array.from(stockMap.values()),
            oiData: oiData?.data || []
        };
        this._rawStockCache = result;
        this._rawStockCacheTime = Date.now();
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
                const s = snap[item.symbol];
                const curSpot = s?.cur?.spot || 0;
                const h1Spot = s?.h1?.spot || curSpot;
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
            }).filter(x => x.last > 0);

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
        if (this._growwMap) return this._growwMap;
        return this.getGrowwSlug('NIFTY') ? this._growwMap : {};
    }

    getGrowwSlug(symbol) {
        const s = (symbol || 'NIFTY').toUpperCase().replace('NIFTY 50', 'NIFTY').replace('NIFTY BANK', 'BANKNIFTY');
        const map = {
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
            'DALBHARAT': { slug: 'odisha-cement-ltd', type: 'STOCKS' },
            'DELHIVERY': { slug: 'delhivery-ltd', type: 'STOCKS' },
            'DIVISLAB': { slug: 'divis-laboratories-ltd', type: 'STOCKS' },
            'DIXON': { slug: 'dixon-technologies-india-ltd', type: 'STOCKS' },
            'DLF': { slug: 'dlf-ltd', type: 'STOCKS' },
            'DMART': { slug: 'avenue-supermarts-ltd', type: 'STOCKS' },
            'DRREDDY': { slug: 'dr-reddys-laboratories-ltd', type: 'STOCKS' },
            'EICHERMOT': { slug: 'eicher-motors-ltd', type: 'STOCKS' },
            'ETERNAL': { slug: 'zomato-ltd', type: 'STOCKS' },
            'EXIDEIND': { slug: 'exide-industries-ltd', type: 'STOCKS' },
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
            'HUDCO': { slug: 'housing-urban-development-corporation-ltd', type: 'STOCKS' },
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
            'NUVAMA': { slug: 'nuvama-wealth-management-ltd', type: 'STOCKS' },
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
            'PPLPHARMA': { slug: 'piramal-pharma-ltd', type: 'STOCKS' },
            'PREMIERENE': { slug: 'premier-energies-ltd', type: 'STOCKS' },
            'PRESTIGE': { slug: 'prestige-estate-projects-ltd', type: 'STOCKS' },
            'RBLBANK': { slug: 'rbl-bank-ltd', type: 'STOCKS' },
            'RECLTD': { slug: 'rec-ltd', type: 'STOCKS' },
            'RELIANCE': { slug: 'reliance-industries-ltd', type: 'STOCKS' },
            'RVNL': { slug: 'rail-vikas-nigam-ltd', type: 'STOCKS' },
            'SAIL': { slug: 'steel-authority-of-india-ltd', type: 'STOCKS' },
            'SAMMAANCAP': { slug: 'indiabulls-housing-finance-ltd', type: 'STOCKS' },
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
            'TATATECH': { slug: 'tata-technologies-ltd', type: 'STOCKS' },
            'TCS': { slug: 'tata-consultancy-services-ltd', type: 'STOCKS' },
            'TECHM': { slug: 'tech-mahindra-ltd', type: 'STOCKS' },
            'TIINDIA': { slug: 'tube-investments-of-india-ltd', type: 'STOCKS' },
            'TITAN': { slug: 'titan-company-ltd', type: 'STOCKS' },
            'TMPV': { slug: 'tata-motors-ltd', type: 'STOCKS' },
            'TORNTPHARM': { slug: 'torrent-pharmaceuticals-ltd', type: 'STOCKS' },
            'TORNTPOWER': { slug: 'torrent-power-ltd', type: 'STOCKS' },
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
            'NIFTYNXT50': { slug: 'nifty-next-50', type: 'INDICES' }
        };
        this._growwMap = map;
        if (map[s]) return map[s];
        return { slug: s.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-ltd', type: 'STOCKS' };
    }

    // ===== DIRECT PCR & OI SUMMARY (Groww top endpoint) =====
    async getTopPCR(symbol = 'NIFTY') {
        const up = symbol.replace('NIFTY 50', 'NIFTY').replace('NIFTY BANK', 'BANKNIFTY').toUpperCase();
        const indices = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
        const isIdx = indices.includes(up);
        const info = this.getGrowwSlug(up);
        const endpoint = `/v1/api/stocks_fo_data/v1/contracts/${info.slug}/top`;
        
        try {
            const [d, livePrice] = await Promise.all([
                this._fetchGroww(endpoint).catch(() => null),
                this.getLivePriceGroww(up).catch(() => 0)
            ]);

            if (d && (d.callOI > 0 || typeof d.pcr === 'number')) {
                let spot = livePrice || 0;
                if (!spot && !isIdx && d.futures && d.futures[0] && d.futures[0].livePrice) {
                    spot = d.futures[0].livePrice.ltp || d.futures[0].livePrice.close || 0;
                }
                const calcPcr = (d.callOI > 0 && d.putOI > 0) ? (d.putOI / d.callOI) : (d.pcr || 0);

                return {
                    pcr: parseFloat(calcPcr.toFixed(4)),
                    callOI: d.callOI || 0,
                    putOI: d.putOI || 0,
                    spot: spot,
                    timestamp: new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
                };
            }
        } catch (e) {
            console.warn(`[API] getTopPCR error for ${symbol}:`, e.message);
        }

        // Fallback to getOIClock if top endpoint is unreachable
        const oi = await this.getOIClock(symbol);
        if (oi) {
            return {
                pcr: parseFloat(oi.pcr || 0),
                callOI: oi.totalCEOI || 0,
                putOI: oi.totalPEOI || 0,
                spot: oi.underlying || 0,
                timestamp: new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
            };
        }
        return null;
    }

    // ===== OPTION CHAIN (100% Live Groww Direct Stream) =====
    async getOptionChain(symbol = 'NIFTY') {
        const info = this.getGrowwSlug(symbol);
        const endpoint = `/v1/api/option_chain_service/v1/option_chain/${info.slug}?type=${info.type}`;
        
        try {
            const d = await this._fetchGroww(endpoint);
            if (d && d.optionChain) {
                const oc = d.optionChain;
                let uv = oc.underlyingValue || oc.lastPrice || 0;
                if (uv === 0) {
                    const q = await this.getQuote(symbol);
                    if (q) uv = q.lastPrice || 0;
                }

                const rawRows = oc.optionChains || [];
                const data = rawRows.map(r => {
                    const strike = (r.strikePrice > 100000) ? (r.strikePrice / 100) : r.strikePrice;
                    return {
                        strikePrice: strike,
                        CE: r.callOption ? {
                            strikePrice: strike,
                            underlyingValue: uv,
                            openInterest: r.callOption.openInterest || 0,
                            changeinOpenInterest: r.callOption.changeInOpenInterest || 0,
                            pchangeinOpenInterest: r.callOption.pchangeInOpenInterest || 0,
                            totalTradedVolume: r.callOption.totalTradedVolume || 0,
                            impliedVolatility: r.callOption.impliedVolatility || 0,
                            lastPrice: r.callOption.ltp || 0,
                            change: r.callOption.dayChange || 0,
                            pChange: r.callOption.dayChangePerc || 0
                        } : null,
                        PE: r.putOption ? {
                            strikePrice: strike,
                            underlyingValue: uv,
                            openInterest: r.putOption.openInterest || 0,
                            changeinOpenInterest: r.putOption.changeInOpenInterest || 0,
                            pchangeinOpenInterest: r.putOption.pchangeInOpenInterest || 0,
                            totalTradedVolume: r.putOption.totalTradedVolume || 0,
                            impliedVolatility: r.putOption.impliedVolatility || 0,
                            lastPrice: r.putOption.ltp || 0,
                            change: r.putOption.dayChange || 0,
                            pChange: r.putOption.dayChangePerc || 0
                        } : null
                    };
                });

                return {
                    records: {
                        data: data,
                        expiryDates: oc.expiries || [],
                        underlyingValue: uv,
                        timestamp: new Date().toLocaleTimeString()
                    }
                };
            }
        } catch (e) {
            console.warn(`[API] Groww Option Chain error for ${symbol}:`, e.message);
        }

        return null;
    }

    // ===== OI CLOCK & PCR =====
    async getOIClock(symbol = 'NIFTY', expiryDate = '') {
        let d;
        const cleanSym = symbol.replace('NIFTY 50', 'NIFTY').replace('NIFTY BANK', 'BANKNIFTY').toUpperCase();

        if (this.config.preferGrowwForOptionChain && typeof this.getOptionChainGroww === 'function') {
            d = await this.getOptionChainGroww(cleanSym, expiryDate);
        }

        if (!d) {
            d = await this.getOptionChain(cleanSym);
        }

        if (!d?.records?.data) {
            const snap = window.App && window.App._liveSnapshot ? window.App._liveSnapshot[cleanSym] : null;
            if (snap) {
                const curSpot = snap.c ? snap.c[2] : (snap.cur ? snap.cur.spot : 0);
                const curPcr = snap.c ? snap.c[1] : (snap.cur ? snap.cur.value : 1.0);
                const timeStr = snap.c ? snap.c[3] : (snap.cur ? snap.cur.timeStr : '');
                if (curSpot > 0) {
                    const pcrVal = parseFloat(curPcr || 1.0);
                    return {
                        symbol: cleanSym,
                        pcr: pcrVal.toFixed(4),
                        sentiment: pcrVal > 1.3 ? 'BULLISH' : (pcrVal < 0.7 ? 'BEARISH' : 'NEUTRAL'),
                        underlying: curSpot,
                        totalCEOI: 1000000,
                        totalPEOI: Math.round(1000000 * pcrVal),
                        maxCEStrike: curSpot * 1.02,
                        maxPEStrike: curSpot * 0.98,
                        maxPain: curSpot,
                        data: [],
                        timeStr: timeStr
                    };
                }
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
            "AMBUJACEM": 1050, "ANGELONE": 2500, "APLAPOLLO": 350, "APOLLOHOSP": 125, "ASHOKLEY": 5000,
            "ASIANPAINT": 250, "ASTRAL": 425, "AUBANK": 1000, "AUROPHARMA": 550, "AXISBANK": 625,
            "BAJAJ-AUTO": 75, "BAJAJFINSV": 250, "BAJAJHLDNG": 50, "BAJFINANCE": 750, "BANDHANBNK": 3600,
            "BANKBARODA": 2925, "BANKINDIA": 5200, "BANKNIFTY": 30, "BDL": 350, "BEL": 1425,
            "BHARATFORG": 500, "BHARTIARTL": 475, "BHEL": 2625, "BIOCON": 2500, "BLUESTARCO": 325,
            "BOSCHLTD": 25, "BPCL": 1975, "BRITANNIA": 125, "BSE": 375, "CAMS": 750,
            "CANBK": 6750, "CDSL": 475, "CGPOWER": 850, "CHOLAFIN": 625, "CIPLA": 375,
            "COALINDIA": 1350, "COCHINSHIP": 400, "COFORGE": 375, "COLPAL": 225, "CONCOR": 1250,
            "CROMPTON": 1800, "CUMMINSIND": 200, "DABUR": 1250, "DALBHARAT": 325, "DELHIVERY": 2075,
            "DIVISLAB": 100, "DIXON": 50, "DLF": 825, "DMART": 150, "DRREDDY": 625,
            "EICHERMOT": 100, "ETERNAL": 2425, "EXIDEIND": 1800, "FEDERALBNK": 5000, "FINNIFTY": 60,
            "FORCEMOT": 25, "FORTIS": 775, "GAIL": 3150, "GLENMARK": 375, "GMRAIRPORT": 6975,
            "GODFRYPHLP": 275, "GODREJCP": 500, "GODREJPROP": 275, "GRASIM": 250, "HAL": 150,
            "HAVELLS": 500, "HCLTECH": 350, "HDFCAMC": 300, "HDFCBANK": 550, "HDFCLIFE": 1100,
            "HEROMOTOCO": 150, "HINDALCO": 700, "HINDPETRO": 2025, "HINDUNILVR": 300, "HINDZINC": 1225,
            "HUDCO": 2775, "HYUNDAI": 275, "ICICIBANK": 700, "ICICIGI": 325, "ICICIPRULI": 925,
            "IDEA": 71475, "IDFCFIRSTB": 9275, "IEX": 3750, "INDHOTEL": 1000, "INDIANB": 1000,
            "INDIGO": 150, "INDUSINDBK": 700, "INDUSTOWER": 1700, "INFY": 400, "INOXWIND": 3575,
            "IOC": 4875, "IREDA": 3450, "IRFC": 4250, "ITC": 1600, "JINDALSTEL": 625,
            "JIOFIN": 2350, "JSWENERGY": 1000, "JSWSTEEL": 675, "JUBLFOOD": 1250, "KALYANKJIL": 1175,
            "KAYNES": 100, "KEI": 175, "KFINTECH": 500, "KOTAKBANK": 2000, "KPITTECH": 425,
            "LAURUSLABS": 850, "LICHSGFIN": 1000, "LICI": 700, "LODHA": 450, "LT": 175,
            "LTF": 2250, "LTM": 150, "LUPIN": 425, "M&M": 200, "MANAPPURAM": 3000,
            "MANKIND": 225, "MARICO": 1200, "MARUTI": 50, "MAXHEALTH": 525, "MAZDOCK": 200,
            "MCX": 625, "MFSL": 400, "MIDCPNIFTY": 120, "MOTHERSON": 6150, "MOTILALOFS": 775,
            "MPHASIS": 275, "MUTHOOTFIN": 275, "NAM-INDIA": 625, "NATIONALUM": 3750, "NAUKRI": 375,
            "NBCC": 6500, "NESTLEIND": 500, "NHPC": 6400, "NIFTY": 65, "NMDC": 6750,
            "NTPC": 1500, "NUVAMA": 500, "NYKAA": 3125, "OBEROIRLTY": 350, "OFSS": 75,
            "OIL": 1400, "ONGC": 2250, "PAGEIND": 15, "PATANJALI": 900, "PAYTM": 725,
            "PERSISTENT": 100, "PETRONET": 1900, "PFC": 1300, "PGEL": 950, "PHOENIXLTD": 350,
            "PIDILITIND": 500, "PIIND": 175, "PNB": 8000, "PNBHOUSING": 650, "POLICYBZR": 350,
            "POLYCAB": 125, "POWERGRID": 1900, "POWERINDIA": 50, "PPLPHARMA": 2625, "PREMIERENE": 575,
            "PRESTIGE": 450, "RBLBANK": 3175, "RECLTD": 1400, "RELIANCE": 500, "RVNL": 1525,
            "SAIL": 4700, "SAMMAANCAP": 4300, "SBICARD": 800, "SBILIFE": 375, "SBIN": 750,
            "SHREECEM": 25, "SHRIRAMFIN": 825, "SIEMENS": 175, "SOLARINDS": 50, "SONACOMS": 1225,
            "SRF": 200, "SUNPHARMA": 350, "SUPREMEIND": 175, "SUZLON": 9025, "SWIGGY": 1300,
            "TATACONSUM": 550, "TATAELXSI": 100, "TATAPOWER": 1450, "TATASTEEL": 5500, "TATATECH": 800,
            "TCS": 175, "TECHM": 600, "TIINDIA": 200, "TITAN": 175, "TMPV": 800,
            "TORNTPHARM": 250, "TORNTPOWER": 425, "TRENT": 100, "TVSMOTOR": 175, "ULTRACEMCO": 50,
            "UNIONBANK": 4425, "UNITDSPR": 400, "UNOMINDA": 550, "UPL": 1355, "VBL": 1125,
            "VEDL": 1150, "VMM": 4850, "VOLTAS": 375, "WAAREEENER": 175, "WIPRO": 3000,
            "YESBANK": 31100, "ZYDUSLIFE": 900, "NIFTYNXT50": 25
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
        const map = {
            "NIFTY": "nifty",
            "BANKNIFTY": "nifty-bank",
            "FINNIFTY": "nifty-financial-services",
            "MIDCPNIFTY": "nifty-midcap-select",
            "NIFTYMIDSELECT": "nifty-midcap-select",
            "360ONE": "iifl-wealth-management-ltd-1568865430949",
            "ABB": "abb-india-ltd",
            "ABCAPITAL": "aditya-birla-capital-ltd",
            "ADANIENSOL": "adani-transmission-ltd",
            "ADANIENT": "adani-enterprises-ltd",
            "ADANIGREEN": "adani-green-energy-ltd",
            "ADANIPORTS": "adani-ports-and-special-economic-zone-ltd",
            "ADANIPOWER": "adani-power-ltd",
            "ALKEM": "alkem-laboratories-ltd",
            "AMBER": "amber-enterprises-india-ltd",
            "AMBUJACEM": "ambuja-cements-ltd",
            "ANGELONE": "angel-broking-ltd",
            "APLAPOLLO": "apl-apollo-tubes-ltd",
            "APOLLOHOSP": "apollo-hospitals-enterprise-ltd",
            "ASHOKLEY": "ashok-leyland-ltd",
            "ASIANPAINT": "asian-paints-ltd",
            "ASTRAL": "astral-poly-technik-ltd",
            "AUBANK": "au-small-finance-bank-ltd",
            "AUROPHARMA": "aurobindo-pharma-ltd",
            "AXISBANK": "axis-bank-ltd",
            "BAJAJ-AUTO": "bajaj-auto-ltd",
            "BAJAJFINSV": "bajaj-finserv-ltd",
            "BAJAJHLDNG": "bajaj-holdings-investment-ltd",
            "BAJFINANCE": "bajaj-finance-ltd",
            "BANDHANBNK": "bandhan-bank-ltd",
            "BANKBARODA": "bank-of-baroda",
            "BANKINDIA": "bank-of-india",
            "BDL": "bharat-dynamics-ltd",
            "BEL": "bharat-electronics-ltd",
            "BHARATFORG": "bharat-forge-ltd",
            "BHARTIARTL": "bharti-airtel-ltd",
            "BHEL": "bharat-heavy-electricals-ltd",
            "BIOCON": "biocon-ltd",
            "BLUESTARCO": "blue-star-ltd",
            "BOSCHLTD": "bosch-ltd",
            "BPCL": "bharat-petroleum-corporation-ltd",
            "BRITANNIA": "britannia-industries-ltd",
            "BSE": "bse-ltd",
            "CAMS": "computer-age-management-services-ltd",
            "CANBK": "canara-bank",
            "CDSL": "central-depository-services-india-ltd",
            "CGPOWER": "cg-power-industrial-solutions-ltd",
            "CHOLAFIN": "cholamandalam-investment-finance-company-ltd",
            "CIPLA": "cipla-ltd",
            "COALINDIA": "coal-india-ltd",
            "COCHINSHIP": "cochin-shipyard-ltd",
            "COFORGE": "niit-technologies-ltd",
            "COLPAL": "colgatepalmolive-india-ltd",
            "CONCOR": "container-corporation-of-india-ltd",
            "CROMPTON": "crompton-greaves-consumer-electricals-ltd",
            "CUMMINSIND": "cummins-india-ltd",
            "DABUR": "dabur-india-ltd",
            "DALBHARAT": "odisha-cement-ltd",
            "DELHIVERY": "delhivery-ltd",
            "DIVISLAB": "divis-laboratories-ltd",
            "DIXON": "dixon-technologies-india-ltd",
            "DLF": "dlf-ltd",
            "DMART": "avenue-supermarts-ltd",
            "DRREDDY": "dr-reddys-laboratories-ltd",
            "EICHERMOT": "eicher-motors-ltd",
            "ETERNAL": "zomato-ltd",
            "EXIDEIND": "exide-industries-ltd",
            "FEDERALBNK": "the-federal-bank-ltd",
            "FORCEMOT": "force-motors-ltd",
            "FORTIS": "fortis-healthcare-ltd",
            "GAIL": "gail-india-ltd",
            "GLENMARK": "glenmark-pharmaceuticals-ltd",
            "GMRAIRPORT": "gmr-infrastructure-ltd",
            "GODFRYPHLP": "godfrey-phillips-india-ltd",
            "GODREJCP": "godrej-consumer-products-ltd",
            "GODREJPROP": "godrej-properties-ltd",
            "GVT&D": "godrej-consumer-products-ltd",
            "GRASIM": "grasim-industries-ltd",
            "HAL": "hindustan-aeronautics-ltd",
            "HAVELLS": "havells-india-ltd",
            "HCLTECH": "hcl-technologies-ltd",
            "HDFCAMC": "hdfc-asset-management-company-ltd",
            "HDFCBANK": "hdfc-bank-ltd",
            "HDFCLIFE": "hdfc-standard-life-insurance-co-ltd",
            "HEROMOTOCO": "hero-motocorp-ltd",
            "HINDALCO": "hindalco-industries-ltd",
            "HINDPETRO": "hindustan-petroleum-corporation-ltd",
            "HINDUNILVR": "hindustan-unilever-ltd",
            "HINDZINC": "hindustan-zinc-ltd",
            "HUDCO": "housing-urban-development-corporation-ltd",
            "HYUNDAI": "hyundai-motor-india-ltd",
            "ICICIBANK": "icici-bank-ltd",
            "ICICIGI": "icici-lombard-general-insurance-co-ltd",
            "ICICIPRULI": "icici-prudential-life-insurance-company-ltd",
            "IDEA": "vodafone-idea-ltd",
            "IDFCFIRSTB": "idfc-bank-ltd",
            "IEX": "indian-energy-exchange-ltd",
            "INDHOTEL": "the-indian-hotels-company-ltd",
            "INDIANB": "indian-bank",
            "INDIGO": "interglobe-aviation-ltd",
            "INDUSINDBK": "indusind-bank-ltd",
            "INDUSTOWER": "bharti-infratel-ltd",
            "INFY": "infosys-ltd",
            "INOXWIND": "inox-wind-ltd",
            "IOC": "indian-oil-corporation-ltd",
            "IREDA": "indian-renewable-energy-development-agency-ltd-1569588972606",
            "IRFC": "indian-railway-finance-corporation-ltd",
            "ITC": "itc-ltd",
            "JINDALSTEL": "jindal-steel-power-ltd",
            "JIOFIN": "jio-financial-services-ltd",
            "JSWENERGY": "jsw-energy-ltd",
            "JSWSTEEL": "jsw-steel-ltd",
            "JUBLFOOD": "jubilant-foodworks-ltd",
            "KALYANKJIL": "kalyan-jewellers-india-ltd",
            "KAYNES": "kaynes-technology-india-ltd",
            "KEI": "kei-industries-ltd",
            "KFINTECH": "kfin-technologies-ltd",
            "KOTAKBANK": "kotak-mahindra-bank-ltd",
            "KPITTECH": "kpit-engineering-ltd",
            "LAURUSLABS": "laurus-labs-ltd",
            "LICHSGFIN": "lic-housing-finance-ltd",
            "LICI": "life-insurance-corporation-of-india",
            "LODHA": "lodha-developers-ltd",
            "LT": "larsen-toubro-ltd",
            "LTF": "lt-finance-holdings-ltd",
            "LTM": "larsen-toubro-infotech-ltd",
            "LUPIN": "lupin-ltd",
            "M&M": "mahindra-mahindra-ltd",
            "MANAPPURAM": "manappuram-finance-ltd",
            "MANKIND": "mankind-pharma-ltd",
            "MARICO": "marico-ltd",
            "MARUTI": "maruti-suzuki-india-ltd",
            "MAXHEALTH": "max-healthcare-institute-ltd",
            "MAZDOCK": "mazagon-dock-shipbuilders-ltd",
            "MCX": "multi-commodity-exchange-of-india-ltd",
            "MFSL": "max-financial-services-ltd",
            "MOTHERSON": "motherson-sumi-systems-ltd",
            "MOTILALOFS": "motilal-oswal-financial-services-ltd",
            "MPHASIS": "mphasis-ltd",
            "MUTHOOTFIN": "muthoot-finance-ltd",
            "NAM-INDIA": "reliance-nippon-life-asset-management-ltd",
            "NATIONALUM": "national-aluminium-company-ltd",
            "NAUKRI": "info-edge-india-ltd",
            "NBCC": "nbcc-india-ltd",
            "NESTLEIND": "nestle-india-ltd",
            "NHPC": "nhpc-ltd",
            "NMDC": "nmdc-ltd",
            "NTPC": "ntpc-ltd",
            "NUVAMA": "nuvama-wealth-management-ltd",
            "NYKAA": "fsn-ecommerce-ventures-ltd",
            "OBEROIRLTY": "oberoi-realty-ltd",
            "OFSS": "oracle-financial-services-software-ltd",
            "OIL": "oil-india-ltd",
            "ONGC": "oil-natural-gas-corporation-ltd",
            "PAGEIND": "page-industries-ltd",
            "PATANJALI": "ruchi-soya-industries-ltd",
            "PAYTM": "one-communications-ltd",
            "PERSISTENT": "persistent-systems-ltd",
            "PETRONET": "petronet-lng-ltd",
            "PFC": "power-finance-corporation-ltd",
            "PGEL": "pg-electroplast-ltd",
            "PHOENIXLTD": "phoenix-mills-ltd",
            "PIDILITIND": "pidilite-industries-ltd",
            "PIIND": "pi-industries-ltd",
            "PNB": "punjab-national-bank",
            "PNBHOUSING": "pnb-housing-finance-ltd",
            "POLICYBZR": "pb-fintech-ltd",
            "POLYCAB": "polycab-india-ltd",
            "POWERGRID": "power-grid-corporation-of-india-ltd",
            "POWERINDIA": "abb-power-products-systems-india-ltd",
            "PPLPHARMA": "piramal-pharma-ltd",
            "PREMIERENE": "premier-energies-ltd",
            "PRESTIGE": "prestige-estate-projects-ltd",
            "RBLBANK": "rbl-bank-ltd",
            "RECLTD": "rec-ltd",
            "RELIANCE": "reliance-industries-ltd",
            "RVNL": "rail-vikas-nigam-ltd",
            "SAIL": "steel-authority-of-india-ltd",
            "SAMMAANCAP": "indiabulls-housing-finance-ltd",
            "SBICARD": "sbi-cards-payment-services-ltd",
            "SBILIFE": "sbi-life-insurance-company-ltd",
            "SBIN": "state-bank-of-india",
            "SHREECEM": "shree-cement-ltd",
            "SHRIRAMFIN": "shriram-transport-finance-company-ltd",
            "SIEMENS": "siemens-ltd",
            "SOLARINDS": "solar-industries-india-ltd",
            "SONACOMS": "sona-blw-precision-forgings-ltd",
            "SRF": "srf-ltd",
            "SUNPHARMA": "sun-pharmaceutical-industries-ltd",
            "SUPREMEIND": "supreme-industries-ltd",
            "SUZLON": "suzlon-energy-ltd",
            "SWIGGY": "swiggy-ltd",
            "TATACONSUM": "tata-global-beverages-ltd",
            "TATAELXSI": "tata-elxsi-ltd",
            "TATAPOWER": "tata-power-company-ltd",
            "TATASTEEL": "tata-steel-ltd",
            "TATATECH": "tata-technologies-ltd",
            "TCS": "tata-consultancy-services-ltd",
            "TECHM": "tech-mahindra-ltd",
            "TIINDIA": "tube-investments-of-india-ltd",
            "TITAN": "titan-company-ltd",
            "TMPV": "tata-motors-ltd",
            "TORNTPHARM": "torrent-pharmaceuticals-ltd",
            "TORNTPOWER": "torrent-power-ltd",
            "TRENT": "trent-ltd",
            "TVSMOTOR": "tvs-motor-company-ltd",
            "ULTRACEMCO": "ultratech-cement-ltd",
            "UNIONBANK": "union-bank-of-india",
            "UNITDSPR": "united-spirits-ltd",
            "UNOMINDA": "minda-industries-ltd",
            "UPL": "upl-ltd",
            "VBL": "varun-beverages-ltd",
            "VEDL": "vedanta-ltd",
            "VMM": "vishal-mega-mart-ltd",
            "VOLTAS": "voltas-ltd",
            "WAAREEENER": "waaree-energies-ltd",
            "WIPRO": "wipro-ltd",
            "YESBANK": "yes-bank-ltd",
            "ZYDUSLIFE": "cadila-healthcare-ltd"
        };
        return map[up] || up.toLowerCase().replace(/\s+/g, '-');
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

    async fetchZerodhaSpanMargin(symbol, strike, type, lotSize, expiryDate) {
        const cleanSym = symbol.replace(/[^A-Z0-9&\-]/g, '');
        
        let scrip = `${cleanSym}26JUL`; // default fallback
        if (expiryDate && expiryDate.length >= 7) {
            const parts = expiryDate.split('-');
            if (parts.length === 3) {
                const yearFull = parts[0];
                const yy = yearFull.slice(2);
                const mm = parts[1];
                const dd = parts[2];

                const monthIdx = parseInt(mm) - 1;
                const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
                
                const isIndex = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'].some(idx => cleanSym.includes(idx));
                
                const expiryDateObj = new Date(yearFull, monthIdx, parseInt(dd));
                const nextWeekDateObj = new Date(expiryDateObj.getTime() + 7 * 24 * 60 * 60 * 1000);
                const isMonthly = !isIndex || (expiryDateObj.getMonth() !== nextWeekDateObj.getMonth());

                if (isMonthly) {
                    const mmm = months[monthIdx] || 'JUL';
                    scrip = `${cleanSym}${yy}${mmm}`;
                } else {
                    let mChar = String(monthIdx + 1);
                    if (mChar === '10') mChar = 'O';
                    else if (mChar === '11') mChar = 'N';
                    else if (mChar === '12') mChar = 'D';
                    
                    const dChar = dd.padStart(2, '0');
                    scrip = `${cleanSym}${yy}${mChar}${dChar}`;
                }
            }
        }
        
        const body = `action=calculate&exchange%5B%5D=NFO&product%5B%5D=OPT&scrip%5B%5D=${encodeURIComponent(scrip)}&option_type%5B%5D=${type}&strike_price%5B%5D=${strike}&qty%5B%5D=${lotSize}&trade%5B%5D=sell`;

        try {
            const res = await fetch('/api/zerodha-margin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body
            });
            const data = await res.json();
            if (data && data.total && typeof data.total.total === 'number' && data.total.total > 0) {
                return {
                    span: data.total.span,
                    exposure: data.total.exposure,
                    total: data.total.total,
                    modelName: 'Zerodha Live SPAN'
                };
            }
        } catch (e) {
            // failover
        }
        return null;
    }
}

window.nseApi = new NSEApi();
