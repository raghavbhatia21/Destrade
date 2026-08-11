/**
 * Destrade Pro — Dedicated 24/7 Cloud Background Market Server
 * Runs continuously on Render, Railway, Koyeb, or any Node.js Cloud Host.
 * Syncs all 218 F&O symbols to Firebase Realtime DB every 5 minutes during market hours.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const FIREBASE_HOST = 'destrade-default-rtdb.firebaseio.com';

// Load full 218 F&O Symbol Mapping
const cloudCronContent = fs.readFileSync(path.join(__dirname, 'cloud-cron.js'), 'utf8');

// Import SLUG_MAP from cloud-cron.js safely
let SLUG_MAP = {};
try {
    const mapMatch = cloudCronContent.match(/const SLUG_MAP = (\{[\s\S]*?\n\};)/);
    if (mapMatch) {
        const evalMap = new Function('return ' + mapMatch[1]);
        SLUG_MAP = evalMap();
    }
} catch(e) {
    console.error('Error parsing SLUG_MAP:', e);
}

const SYMBOLS = Object.keys(SLUG_MAP);
console.log(`🚀 Destrade Cloud Market Engine initialized with ${SYMBOLS.length} F&O symbols!`);

let lastSyncStatus = {
    lastRun: 'Never',
    status: 'Initializing',
    symbolsSynced: 0,
    marketStatus: 'Closed'
};

function getISTDate() {
    const d = new Date();
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    return new Date(utc + (5.5 * 60 * 60 * 1000));
}

function getISTDateStr(d) {
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function fetchUrl(url) {
    return new Promise((resolve) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Referer': 'https://groww.in/'
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    });
}

function firebaseGet(path) {
    return new Promise((resolve) => {
        https.get(`https://${FIREBASE_HOST}${path}`, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

function firebasePut(path, data) {
    return new Promise((resolve) => {
        const payload = JSON.stringify(data);
        const req = https.request({
            hostname: FIREBASE_HOST,
            path: path,
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve(res.statusCode === 200));
        });
        req.on('error', () => resolve(false));
        req.write(payload);
        req.end();
    });
}

async function fetchSpotPrice(symbol, isIndex) {
    const ep = isIndex 
        ? `https://groww.in/v1/api/stocks_data/v1/tr_live_indices/exchange/NSE/segment/CASH/${symbol}/latest`
        : `https://groww.in/v1/api/stocks_data/v1/tr_live_prices/exchange/NSE/segment/CASH/${symbol}/latest`;
    const d = await fetchUrl(ep);
    return d ? (d.value || d.ltp || d.lastPrice || 0) : 0;
}

async function fetchOptionChainPCR(symbol) {
    const info = SLUG_MAP[symbol] || { slug: symbol.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-ltd', type: 'STOCKS' };
    const isIdx = info.type === 'INDICES' || ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'].includes(symbol.toUpperCase());
    
    // 1. Fetch TRUE Cash Market Spot Price
    let spot = await fetchSpotPrice(symbol, isIdx);

    // 2. Fetch PCR from Groww Top Endpoint
    const topUrl = `https://groww.in/v1/api/stocks_fo_data/v1/contracts/${info.slug}/top`;
    const topData = await fetchUrl(topUrl);

    if (topData && typeof topData.pcr === 'number') {
        if (spot === 0 && topData.futures && topData.futures[0] && topData.futures[0].livePrice) {
            spot = topData.futures[0].livePrice.ltp || topData.futures[0].livePrice.close || 0;
        }
        return {
            pcr: parseFloat(topData.pcr.toFixed(2)),
            callOI: topData.callOI || 0,
            putOI: topData.putOI || 0,
            spot: spot
        };
    }

    // Secondary Fallback Endpoint: Groww Option Chain
    const url = `https://groww.in/v1/api/option_chain_service/v1/option_chain/${info.slug}?type=${info.type}`;
    const d = await fetchUrl(url);
    if (!d || !d.optionChain) return null;

    const oc = d.optionChain;
    let totalCE = 0, totalPE = 0;
    spot = oc.underlyingValue || oc.lastPrice || 0;

    if (spot === 0) {
        spot = await fetchSpotPrice(symbol, info.type === 'INDICES');
    }

    if (oc.optionChains && Array.isArray(oc.optionChains)) {
        oc.optionChains.forEach(row => {
            if (row.callOption) totalCE += (row.callOption.openInterest || 0);
            if (row.putOption) totalPE += (row.putOption.openInterest || 0);
        });
    }

    const pcr = totalCE > 0 ? (totalPE / totalCE) : 0;
    return {
        pcr: parseFloat(pcr.toFixed(2)),
        callOI: totalCE,
        putOI: totalPE,
        spot: spot
    };
}

async function executeMarketSync() {
    const ist = getISTDate();
    const day = ist.getDay();
    const hour = ist.getHours();
    const min = ist.getMinutes();
    const totalMin = (hour * 60) + min;

    const dateStr = getISTDateStr(ist);
    const timeStr = ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    console.log(`\n⏱️ [24/7 Cloud Worker] IST Time: ${dateStr} ${timeStr} (Day: ${day})`);

    // Check Weekend
    if (day === 0 || day === 6) {
        console.log('🌴 Market Closed (Weekend). Skipping sync.');
        lastSyncStatus = { lastRun: ist.toISOString(), status: 'Market Closed (Weekend)', dateStr, symbolsSynced: 0 };
        await firebasePut('/cron_status.json', lastSyncStatus);
        return;
    }

    // Check Market Hours (09:10 AM to 03:40 PM IST)
    const marketStart = (9 * 60) + 10;
    const marketEnd = (15 * 60) + 40;

    if (totalMin < marketStart || totalMin > marketEnd) {
        console.log('🌙 Outside Market Hours (09:15 - 15:30 IST). Skipping sync.');
        lastSyncStatus = { lastRun: ist.toISOString(), status: 'Outside Market Hours', dateStr, symbolsSynced: 0 };
        await firebasePut('/cron_status.json', lastSyncStatus);
        return;
    }

    console.log(`⚡ Market Live! Syncing ${SYMBOLS.length} F&O symbols to Firebase...`);

    const summary = {};
    const BATCH_SIZE = 10;
    const nowSec = Math.floor(Date.now() / 1000);

    for (let i = 0; i < SYMBOLS.length; i += BATCH_SIZE) {
        const batch = SYMBOLS.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (sym) => {
            try {
                const data = await fetchOptionChainPCR(sym);
                if (data && data.pcr > 0) {
                    summary[sym] = { pcr: data.pcr, spot: data.spot };

                    const path = `/pcr_history/${sym}/${dateStr}.json`;
                    const existing = await firebaseGet(path);
                    const list = Array.isArray(existing) ? existing : (existing ? Object.values(existing) : []);

                    const lastEntry = list[list.length - 1];
                    
                    // Enforce strict 5-minute ticks (>= 240 seconds)
                    if (!lastEntry || (nowSec - lastEntry.time) >= 240) {
                        list.push({
                            time: nowSec,
                            timeStr: timeStr,
                            value: data.pcr,
                            spot: data.spot
                        });

                        await firebasePut(path, list.slice(-150));
                        console.log(`  ✅ ${sym}: PCR ${data.pcr} (Spot: ₹${data.spot}) saved!`);
                    }
                }
            } catch (err) {}
        }));
    }

    lastSyncStatus = {
        lastRun: ist.toISOString(),
        status: 'Active (24/7 Cloud Worker)',
        dateStr: dateStr,
        symbolsSynced: Object.keys(summary).length,
        summary: summary
    };

    await firebasePut('/cron_status.json', lastSyncStatus);
    console.log(`🎉 24/7 Market Sync Pass Completed! Synced ${Object.keys(summary).length}/${SYMBOLS.length} symbols!`);
}

// Start HTTP Server for Render / Railway Healthcheck, Proxy & Manual Trigger
const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url.startsWith('/api/proxy')) {
        try {
            const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
            const targetUrl = parsedUrl.searchParams.get('url');
            if (!targetUrl) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Missing target url parameter' }));
                return;
            }
            const data = await fetchUrl(targetUrl);
            res.writeHead(200);
            res.end(JSON.stringify(data || {}));
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    if (req.url === '/trigger') {
        executeMarketSync().catch(console.error);
        res.writeHead(200);
        res.end(JSON.stringify({ message: 'Manual Market Sync Triggered', status: lastSyncStatus }));
    } else {
        res.writeHead(200);
        res.end(JSON.stringify({
            app: 'Destrade Pro Autonomous 24/7 Cloud Market Worker & CORS Proxy',
            uptime: Math.floor(process.uptime()) + ' seconds',
            status: lastSyncStatus
        }, null, 2));
    }
});

server.listen(PORT, () => {
    console.log(`🌐 Destrade Cloud Worker HTTP Health Server running on port ${PORT}`);
    
    // Run initial check on startup
    executeMarketSync().catch(console.error);

    // Continuous 2-minute interval loop during market hours
    setInterval(() => {
        executeMarketSync().catch(console.error);
    }, 2 * 60 * 1000);

    // Self-ping every 5 minutes to prevent Render free instance from sleeping
    const selfUrl = process.env.RENDER_EXTERNAL_URL || 'https://destrade-market-worker.onrender.com';
    setInterval(() => {
        https.get(`${selfUrl}/`, () => {}).on('error', () => {});
    }, 5 * 60 * 1000);
});
