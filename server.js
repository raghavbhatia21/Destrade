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

function getISTInfo() {
    const d = new Date();
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
    
    return { dateStr, timeStr, hour, min, day, totalMin: (hour * 60) + min, iso: d.toISOString() };
}

function getISTDate() {
    return new Date();
}

function getISTDateStr(d) {
    const target = d || new Date();
    return target.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
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
    const cleanSym = symbol.toUpperCase().replace('NIFTY 50', 'NIFTY').replace('NIFTY BANK', 'BANKNIFTY');
    const ep = isIndex 
        ? `https://groww.in/v1/api/stocks_data/v1/tr_live_indices/exchange/NSE/segment/CASH/${cleanSym}/latest`
        : `https://groww.in/v1/api/stocks_data/v1/tr_live_prices/exchange/NSE/segment/CASH/${cleanSym}/latest`;
    
    let d = await fetchUrl(ep);
    let spot = d ? (d.value || d.ltp || d.lastPrice || 0) : 0;
    
    // Retry once if spot returned 0
    if (!spot) {
        await new Promise(r => setTimeout(r, 500));
        d = await fetchUrl(ep);
        spot = d ? (d.value || d.ltp || d.lastPrice || 0) : 0;
    }
    return spot;
}

async function fetchOptionChainPCR(symbol) {
    const info = SLUG_MAP[symbol] || { slug: symbol.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-ltd', type: 'STOCKS' };
    const isIdx = info.type === 'INDICES' || ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'].includes(symbol.toUpperCase());
    
    // 1. Fetch TRUE Cash Market Spot Price
    let spot = await fetchSpotPrice(symbol, isIdx);

    // 2. Fetch PCR from Groww Top Endpoint
    const topUrl = `https://groww.in/v1/api/stocks_fo_data/v1/contracts/${info.slug}/top`;
    const topData = await fetchUrl(topUrl);

    if (topData && (topData.callOI > 0 || typeof topData.pcr === 'number')) {
        // Only for stocks if spot is still 0, fall back to futures price
        if (spot === 0 && !isIdx && topData.futures && topData.futures[0] && topData.futures[0].livePrice) {
            spot = topData.futures[0].livePrice.ltp || topData.futures[0].livePrice.close || 0;
        }
        const calcPcr = (topData.callOI > 0 && topData.putOI > 0) ? (topData.putOI / topData.callOI) : (topData.pcr || 0);

        return {
            pcr: parseFloat(calcPcr.toFixed(4)),
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
        pcr: parseFloat(pcr.toFixed(4)),
        callOI: totalCE,
        putOI: totalPE,
        spot: spot
    };
}

async function executeMarketSync() {
    const istInfo = getISTInfo();
    const { day, totalMin, dateStr, timeStr, iso } = istInfo;

    console.log(`\n⏱️ [24/7 Cloud Worker] IST Time: ${dateStr} ${timeStr} (Day: ${day}, TotalMin: ${totalMin})`);

    // Check Weekend
    if (day === 0 || day === 6) {
        console.log('🌴 Market Closed (Weekend). Skipping sync.');
        lastSyncStatus = { lastRun: iso, status: 'Market Closed (Weekend)', dateStr, symbolsSynced: 0 };
        await firebasePut('/cron_status.json', lastSyncStatus);
        return false; // signal: not market hours
    }

    // Check Market Hours (09:10 AM to 03:40 PM IST)
    const marketStart = (9 * 60) + 10;
    const marketEnd = (15 * 60) + 40;

    if (totalMin < marketStart || totalMin > marketEnd) {
        console.log('🌙 Outside Market Hours (09:15 - 15:30 IST). Skipping sync.');
        lastSyncStatus = { lastRun: iso, status: 'Outside Market Hours', dateStr, symbolsSynced: 0 };
        await firebasePut('/cron_status.json', lastSyncStatus);
        return false; // signal: not market hours
    }

    console.log(`⚡ Market Live! Scanning ${SYMBOLS.length} F&O symbols continuously...`);

    const summary = {};
    const nowSec = Math.floor(Date.now() / 1000);
    const BATCH_SIZE = 10;
    const BATCH_DELAY_MS = 1000;

    for (let i = 0; i < SYMBOLS.length; i += BATCH_SIZE) {
        const batch = SYMBOLS.slice(i, i + BATCH_SIZE);
        const batchIdx = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(SYMBOLS.length / BATCH_SIZE);

        await Promise.all(batch.map(async (sym) => {
            try {
                const data = await fetchOptionChainPCR(sym);
                if (data && data.pcr > 0) {
                    summary[sym] = { pcr: data.pcr, spot: data.spot };

                    const path = `/pcr_history/${sym}/${dateStr}.json`;
                    const existing = await firebaseGet(path);
                    const list = Array.isArray(existing) ? existing : (existing ? Object.values(existing) : []);

                    const lastEntry = list[list.length - 1];
                    
                    // Write new tick whenever PCR or Spot actually changed (no time gate)
                    const pcrChanged = !lastEntry || lastEntry.value !== data.pcr;
                    const spotChanged = !lastEntry || lastEntry.spot !== data.spot;

                    if (pcrChanged || spotChanged) {
                        list.push({
                            time: nowSec,
                            timeStr: timeStr,
                            value: data.pcr,
                            spot: data.spot
                        });

                        await firebasePut(path, list.slice(-500));
                    }
                }
            } catch (err) {}
        }));

        // Log batch progress every 5 batches
        if (batchIdx % 5 === 0 || batchIdx === totalBatches) {
            console.log(`  📦 Batch ${batchIdx}/${totalBatches} done (${Object.keys(summary).length} symbols synced so far)`);
        }

        // Pause between batches to avoid hammering the API
        if (i + BATCH_SIZE < SYMBOLS.length) {
            await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
        }
    }

    lastSyncStatus = {
        lastRun: iso,
        status: 'Active (Continuous Scanner)',
        dateStr: dateStr,
        symbolsSynced: Object.keys(summary).length,
        summary: summary
    };

    await firebasePut('/cron_status.json', lastSyncStatus);
    console.log(`🎉 Full Scan Cycle Completed! Synced ${Object.keys(summary).length}/${SYMBOLS.length} symbols!`);
    return true; // signal: market is live
}

// ===== CONTINUOUS SCANNING ENGINE =====
// Instead of fixed intervals, runs back-to-back scans during market hours
// with a small cooldown between cycles. This prevents Render from sleeping.
let isScanRunning = false;
let cycleCount = 0;

async function continuousScanLoop() {
    if (isScanRunning) {
        console.log('⚠️ Previous scan cycle still running. Skipping overlap.');
        return;
    }

    isScanRunning = true;
    cycleCount++;
    const cycleStart = Date.now();
    console.log(`\n🔄 ===== SCAN CYCLE #${cycleCount} STARTING =====`);

    try {
        const isMarketLive = await executeMarketSync();

        const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
        console.log(`⏱️ Cycle #${cycleCount} completed in ${elapsed}s`);

        if (isMarketLive) {
            // Market is live: wait only 5 seconds between full cycles
            // Each cycle takes ~22-30s (22 batches × 1s pause), so effective rate is ~1 full scan every ~30s
            console.log('⚡ Market live — starting next cycle in 5 seconds...');
            setTimeout(continuousScanLoop, 5 * 1000);
        } else {
            // Outside market hours: check every 2 minutes
            console.log('🌙 Market closed — re-checking in 2 minutes...');
            setTimeout(continuousScanLoop, 2 * 60 * 1000);
        }
    } catch (err) {
        console.error('❌ Scan cycle error:', err);
        // On error, retry after 30 seconds
        setTimeout(continuousScanLoop, 30 * 1000);
    } finally {
        isScanRunning = false;
    }
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
            app: 'Destrade Pro Continuous 24/7 Cloud Scanner & CORS Proxy',
            uptime: Math.floor(process.uptime()) + ' seconds',
            scanCycles: cycleCount,
            status: lastSyncStatus
        }, null, 2));
    }
});

server.listen(PORT, () => {
    console.log(`🌐 Destrade Continuous Cloud Scanner running on port ${PORT}`);
    
    // Start the continuous scan loop immediately
    continuousScanLoop();

    // Self-ping every 4 minutes to prevent Render free instance from sleeping
    const selfUrl = process.env.RENDER_EXTERNAL_URL || 'https://destrade-market-worker.onrender.com';
    setInterval(() => {
        https.get(`${selfUrl}/`, () => {}).on('error', () => {});
        console.log(`🏓 Self-ping sent to keep Render alive`);
    }, 4 * 60 * 1000);
});

