/**
 * Destrade Pro — Distributed 24/7 Cloud Background Market Server
 * Runs as a WORKER in a fleet of 5 Render free accounts.
 * Each worker scans its assigned slice of F&O symbols and writes to shared Firebase.
 * Workers auto-detect dead/throttled peers and absorb their symbols.
 *
 * ENV VARS:
 *   WORKER_ID      = 0-4 (required, unique per Render service)
 *   TOTAL_WORKERS   = 5 (default)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const FIREBASE_HOST = 'destrade-default-rtdb.firebaseio.com';

// ===== DISTRIBUTED WORKER CONFIG =====
const WORKER_ID = parseInt(process.env.WORKER_ID || '0', 10);
const TOTAL_WORKERS = parseInt(process.env.TOTAL_WORKERS || '5', 10);
const BANDWIDTH_LIMIT_BYTES = 4.2 * 1024 * 1024 * 1024; // 4.2 GB safety threshold (of 5 GB free)
let estimatedBandwidthBytes = 0;
let isThrottled = false;

// Load full F&O Symbol Mapping
const cloudCronContent = fs.readFileSync(path.join(__dirname, 'cloud-cron.js'), 'utf8');

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

const ALL_SYMBOLS = Object.keys(SLUG_MAP);

// Compute this worker's base symbol slice
function computeBaseSlice(workerId, totalWorkers) {
    const chunkSize = Math.ceil(ALL_SYMBOLS.length / totalWorkers);
    const start = workerId * chunkSize;
    const end = Math.min(start + chunkSize, ALL_SYMBOLS.length);
    return { start, end };
}

let activeSymbols = [];
let absorbedFrom = []; // IDs of workers whose symbols we absorbed

function recalculateActiveSymbols(deadWorkerIds) {
    const myBase = computeBaseSlice(WORKER_ID, TOTAL_WORKERS);
    let mySymbols = ALL_SYMBOLS.slice(myBase.start, myBase.end);

    // Absorb dead workers' symbols — split equally among alive workers
    if (deadWorkerIds.length > 0) {
        const aliveWorkerIds = [];
        for (let i = 0; i < TOTAL_WORKERS; i++) {
            if (!deadWorkerIds.includes(i)) aliveWorkerIds.push(i);
        }
        const myRank = aliveWorkerIds.indexOf(WORKER_ID);
        if (myRank >= 0) {
            deadWorkerIds.forEach(deadId => {
                const deadSlice = computeBaseSlice(deadId, TOTAL_WORKERS);
                const deadSymbols = ALL_SYMBOLS.slice(deadSlice.start, deadSlice.end);
                // Split dead worker's symbols equally among alive workers
                const perAlive = Math.ceil(deadSymbols.length / aliveWorkerIds.length);
                const myShare = deadSymbols.slice(myRank * perAlive, (myRank + 1) * perAlive);
                mySymbols = mySymbols.concat(myShare);
            });
        }
    }

    absorbedFrom = deadWorkerIds;
    activeSymbols = mySymbols;
    return mySymbols;
}

// Auto-leadership: lowest alive worker ID becomes leader (runs alerts + cron_status)
let isLeader = (WORKER_ID === 0);

// Initialize with base slice
recalculateActiveSymbols([]);
console.log(`🚀 Destrade Worker #${WORKER_ID} initialized! Scanning ${activeSymbols.length}/${ALL_SYMBOLS.length} symbols (base slice: ${computeBaseSlice(WORKER_ID, TOTAL_WORKERS).start}-${computeBaseSlice(WORKER_ID, TOTAL_WORKERS).end - 1})`);
console.log(`📡 Worker fleet: ${TOTAL_WORKERS} workers | Leader: ${isLeader ? 'YES' : 'NO'} | Bandwidth limit: ${(BANDWIDTH_LIMIT_BYTES / (1024*1024*1024)).toFixed(1)} GB`);

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

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0'
];

function fetchUrl(url) {
    const randomUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const delim = url.includes('?') ? '&' : '?';
    const cbUrl = url + delim + '_t=' + Date.now();
    // Track outbound bandwidth (request URL + headers ~500 bytes + response body)
    estimatedBandwidthBytes += 500 + cbUrl.length;
    return new Promise((resolve) => {
        const req = https.get(cbUrl, {
            headers: {
                'User-Agent': randomUA,
                'Accept': 'application/json, text/plain, */*',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Accept-Language': 'en-US,en;q=0.9',
                'Origin': 'https://groww.in',
                'Referer': 'https://groww.in/options/nifty'
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => { body += chunk; estimatedBandwidthBytes += chunk.length; });
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
        const delim = path.includes('?') ? '&' : '?';
        const cbPath = path + delim + 't=' + Date.now();
        https.get(`https://${FIREBASE_HOST}${cbPath}`, {
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }
        }, (res) => {
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
        estimatedBandwidthBytes += Buffer.byteLength(payload) + 200; // payload + HTTP overhead
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
            res.on('data', chunk => { body += chunk; estimatedBandwidthBytes += chunk.length; });
            res.on('end', () => resolve(res.statusCode === 200));
        });
        req.on('error', () => resolve(false));
        req.write(payload);
        req.end();
    });
}

// PATCH merges keys into existing Firebase object (critical for multi-worker snapshot writes)
function firebasePatch(fbPath, data) {
    return new Promise((resolve) => {
        const payload = JSON.stringify(data);
        estimatedBandwidthBytes += Buffer.byteLength(payload) + 200;
        const req = https.request({
            hostname: FIREBASE_HOST,
            path: fbPath,
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => { body += chunk; estimatedBandwidthBytes += chunk.length; });
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

// In-memory cache to prevent redundant Firebase GET requests and keep bandwidth ultra-low (Free Tier Safe)
let memoryHistoryCache = {};
let memoryCacheDateStr = '';

async function executeMarketSync() {
    const istInfo = getISTInfo();
    const { day, totalMin, dateStr, timeStr, iso } = istInfo;

    console.log(`\n⏱️ [Worker #${WORKER_ID}] IST Time: ${dateStr} ${timeStr} (Day: ${day}, TotalMin: ${totalMin})`);

    // Check if this worker is bandwidth-throttled
    if (estimatedBandwidthBytes >= BANDWIDTH_LIMIT_BYTES) {
        if (!isThrottled) {
            isThrottled = true;
            console.log(`🚫 [Worker #${WORKER_ID}] BANDWIDTH LIMIT REACHED! (${(estimatedBandwidthBytes / (1024*1024*1024)).toFixed(2)} GB). Self-throttling...`);
            // Notify other workers via Firebase
            await firebasePatch('/worker_status.json', {
                [WORKER_ID]: {
                    id: WORKER_ID,
                    active: false,
                    throttled: true,
                    estimatedBandwidthMB: Math.round(estimatedBandwidthBytes / (1024 * 1024)),
                    lastHeartbeat: Date.now(),
                    symbolCount: 0
                }
            });
        }
        return false;
    }

    // Check Weekend
    if (day === 0 || day === 6) {
        console.log('🌴 Market Closed (Weekend). Skipping sync.');
        lastSyncStatus = { lastRun: iso, status: 'Market Closed (Weekend)', dateStr, symbolsSynced: 0 };
        // Only worker 0 updates cron_status to avoid conflicts
        if (isLeader) await firebasePut('/cron_status.json', lastSyncStatus);
        return false;
    }

    // Check Market Hours (09:10 AM to 03:40 PM IST)
    const marketStart = (9 * 60) + 10;
    const marketEnd = (15 * 60) + 40;

    if (totalMin < marketStart || totalMin > marketEnd) {
        console.log('🌙 Outside Market Hours (09:15 - 15:30 IST). Skipping sync.');
        lastSyncStatus = { lastRun: iso, status: 'Outside Market Hours', dateStr, symbolsSynced: 0 };
        if (WORKER_ID === 0) await firebasePut('/cron_status.json', lastSyncStatus);
        return false;
    }

    // Reset memory cache on new day
    if (dateStr !== memoryCacheDateStr) {
        memoryHistoryCache = {};
        memoryCacheDateStr = dateStr;
        // Reset bandwidth counter at start of each month (approximate: new day + day 1)
        const dayOfMonth = parseInt(dateStr.split('-')[2], 10);
        if (dayOfMonth === 1) {
            estimatedBandwidthBytes = 0;
            isThrottled = false;
            console.log(`📅 Monthly bandwidth counter reset!`);
        }
        console.log(`📅 New trading day detected (${dateStr}). In-memory cache reset.`);
    }

    // ===== FAILOVER CHECK: Detect dead/throttled workers every 10 cycles =====
    if (cycleCount % 10 === 0) {
        try {
            const allStatus = await firebaseGet('/worker_status.json');
            const deadWorkers = [];
            if (allStatus && typeof allStatus === 'object') {
                for (let wId = 0; wId < TOTAL_WORKERS; wId++) {
                    if (wId === WORKER_ID) continue; // skip self
                    const ws = allStatus[wId];
                    if (!ws) continue; // worker never registered — it uses its base slice
                    const timeSinceHeartbeat = Date.now() - (ws.lastHeartbeat || 0);
                    // Worker is dead if: explicitly throttled OR no heartbeat for 15 minutes
                    if (ws.throttled === true || ws.active === false || timeSinceHeartbeat > 15 * 60 * 1000) {
                        deadWorkers.push(wId);
                    }
                }
            }

            if (deadWorkers.length !== absorbedFrom.length || !deadWorkers.every(d => absorbedFrom.includes(d))) {
                recalculateActiveSymbols(deadWorkers);
                if (deadWorkers.length > 0) {
                    console.log(`⚠️ [Worker #${WORKER_ID}] FAILOVER: Absorbing symbols from dead workers [${deadWorkers.join(', ')}]. Now scanning ${activeSymbols.length} symbols.`);
                } else {
                    console.log(`✅ [Worker #${WORKER_ID}] All workers alive. Scanning base ${activeSymbols.length} symbols.`);
                }
            }

            // Auto-promote leadership: lowest alive worker ID becomes leader
            const aliveIds = [];
            for (let i = 0; i < TOTAL_WORKERS; i++) {
                if (!deadWorkers.includes(i)) aliveIds.push(i);
            }
            const newLeader = (aliveIds.length > 0 && aliveIds[0] === WORKER_ID);
            if (newLeader !== isLeader) {
                isLeader = newLeader;
                console.log(isLeader
                    ? `👑 [Worker #${WORKER_ID}] PROMOTED TO LEADER! Now running alerts & cron_status.`
                    : `📋 [Worker #${WORKER_ID}] Leadership transferred to lower worker.`);
            }
        } catch(e) {
            console.warn('Failover check error:', e.message);
        }
    }

    console.log(`⚡ [Worker #${WORKER_ID}] Market Live! Scanning ${activeSymbols.length} symbols (BW: ${(estimatedBandwidthBytes / (1024*1024)).toFixed(0)} MB)...`);

    const summary = {};
    const nowSec = Math.floor(Date.now() / 1000);
    const BATCH_SIZE = 10;
    const BATCH_DELAY_MS = 1200;

    for (let i = 0; i < activeSymbols.length; i += BATCH_SIZE) {
        const batch = activeSymbols.slice(i, i + BATCH_SIZE);
        const batchIdx = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(activeSymbols.length / BATCH_SIZE);

        await Promise.all(batch.map(async (sym) => {
            try {
                const data = await fetchOptionChainPCR(sym);
                const histPath = `/pcr_history/${sym}/${dateStr}.json`;

                if (data && data.pcr > 0) {
                    summary[sym] = { pcr: data.pcr, spot: data.spot };

                    if (!memoryHistoryCache[sym]) {
                        const existing = await firebaseGet(histPath);
                        memoryHistoryCache[sym] = Array.isArray(existing) ? existing : (existing ? Object.values(existing) : []);
                    }

                    const list = memoryHistoryCache[sym];
                    const lastEntry = list[list.length - 1];
                    const timeElapsed = lastEntry ? (nowSec - lastEntry.time) : 999;

                    const pcrChanged = !lastEntry || Math.abs(lastEntry.value - data.pcr) >= 0.0001;
                    const spotChanged = !lastEntry || Math.abs(lastEntry.spot - data.spot) >= 0.05;

                    // Record history tick every 45 seconds if data changed, or every 120 seconds to keep timeline moving
                    if ((timeElapsed >= 45 && (pcrChanged || spotChanged)) || timeElapsed >= 120) {
                        list.push({
                            time: nowSec,
                            timeStr: timeStr,
                            value: data.pcr,
                            spot: data.spot
                        });

                        const trimmedList = list.slice(-250);
                        memoryHistoryCache[sym] = trimmedList;
                        await firebasePut(histPath, trimmedList);
                    }
                } else {
                    // Fallback: read from Firebase if Groww blocked
                    const existing = await firebaseGet(histPath);
                    if (existing) {
                        const list = Array.isArray(existing) ? existing : Object.values(existing);
                        if (list.length > 0) {
                            memoryHistoryCache[sym] = list;
                            const latest = list[list.length - 1];
                            summary[sym] = { pcr: latest.value, spot: latest.spot };
                        }
                    }
                }
            } catch (err) {}
        }));

        if (batchIdx % 5 === 0 || batchIdx === totalBatches) {
            console.log(`  📦 [W#${WORKER_ID}] Batch ${batchIdx}/${totalBatches} (${Object.keys(summary).length} synced)`);
        }

        if (i + BATCH_SIZE < activeSymbols.length) {
            await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
        }
    }

    // Update cron_status (only worker 0, no redundant summary object)
    lastSyncStatus = {
        lastRun: iso,
        status: `Active (Worker #${WORKER_ID} — ${activeSymbols.length} symbols)`,
        dateStr: dateStr,
        symbolsSynced: Object.keys(summary).length
    };
    if (isLeader) {
        await firebasePut('/cron_status.json', lastSyncStatus);
    }

    // Write this worker's snapshot slice using PATCH (merge, not overwrite)
    const snapshot = {};
    for (const sym of Object.keys(memoryHistoryCache)) {
        const list = memoryHistoryCache[sym];
        if (Array.isArray(list) && list.length > 0) {
            const latest = list[list.length - 1];
            const targetTime = latest.time - 3600;
            let tick1hAgo = list[0];
            let minDelta = Math.abs(tick1hAgo.time - targetTime);
            for (let i = 1; i < list.length - 1; i++) {
                const delta = Math.abs(list[i].time - targetTime);
                if (delta < minDelta) { minDelta = delta; tick1hAgo = list[i]; }
            }
            const live = summary[sym];
            const curTime = live ? nowSec : latest.time;
            const curTimeStr = live ? timeStr : (latest.timeStr || '');
            const curPcr = live ? live.pcr : latest.value;
            const curSpot = live ? live.spot : latest.spot;

            snapshot[sym] = {
                c: [curTime, curPcr, curSpot, curTimeStr],
                h: [tick1hAgo.time, tick1hAgo.value, tick1hAgo.spot],
                l: list.length
            };
        }
    }
    // Use PATCH so each worker merges its symbols into the shared snapshot
    await firebasePatch('/pcr_snapshot.json', snapshot);

    // Write worker heartbeat status
    await firebasePatch('/worker_status.json', {
        [WORKER_ID]: {
            id: WORKER_ID,
            active: true,
            throttled: false,
            estimatedBandwidthMB: Math.round(estimatedBandwidthBytes / (1024 * 1024)),
            lastHeartbeat: Date.now(),
            symbolCount: activeSymbols.length,
            syncedCount: Object.keys(summary).length,
            absorbed: absorbedFrom
        }
    });

    console.log(`🎉 [Worker #${WORKER_ID}] Cycle done! Synced ${Object.keys(summary).length}/${activeSymbols.length} symbols. BW: ${(estimatedBandwidthBytes / (1024*1024)).toFixed(0)} MB`);

    // Only worker 0 runs alert detection (avoid duplicate push notifications)
    if (isLeader) {
        try {
            await evaluateServerSideAlerts(dateStr, timeStr);
        } catch(e) {
            console.warn('Server alert evaluation error:', e);
        }
    }

    return true; // signal: market is live
}

// ===== 24/7 SERVER-SIDE BACKGROUND ALERT ENGINE =====
const serverAlertCooldowns = {};
let previousTop5BiasSymbols = { bull: [], bear: [] };
let lastServerGlobalNotificationTime = 0;

async function sendFcmPushToAllDevices(title, body) {
    try {
        const tokensData = await firebaseGet('/fcm_tokens.json');
        if (!tokensData || typeof tokensData !== 'object') return;

        const tokens = Object.values(tokensData).map(x => x && x.token).filter(Boolean);
        if (tokens.length === 0) return;

        const apiKey = 'AIzaSyDnPF-XXuI0kW5b9QcTPy1pV3c3dz0ZoIU';

        tokens.forEach(token => {
            const payload = JSON.stringify({
                to: token,
                priority: 'high',
                notification: {
                    title: title,
                    body: body,
                    sound: 'default',
                    channel_id: 'destrade_high_alerts'
                },
                data: {
                    title: title,
                    body: body,
                    timestamp: Date.now()
                }
            });

            const req = https.request({
                hostname: 'fcm.googleapis.com',
                path: '/fcm/send',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'key=' + apiKey,
                    'Content-Length': Buffer.byteLength(payload)
                }
            }, (res) => {
                let d = '';
                res.on('data', chunk => d += chunk);
                res.on('end', () => console.log(`📲 [FCM PUSH SENT] to ${token.substring(0, 15)}... (Status: ${res.statusCode})`));
            });
            req.on('error', () => {});
            req.write(payload);
            req.end();
        });
    } catch(e) {
        console.warn('FCM Push broadcast error:', e);
    }
}

async function evaluateServerSideAlerts(dateStr, timeStr) {
    const symbols = Object.keys(memoryHistoryCache);
    const biasBull = [];
    const biasBear = [];
    const nowMs = Date.now();

    symbols.forEach(sym => {
        const cleanList = memoryHistoryCache[sym];
        if (!Array.isArray(cleanList) || cleanList.length < 2) return;

        const latest = cleanList[cleanList.length - 1];
        const oldest = cleanList[0];

        // 1-Hour Bias Evaluation (min 30 mins history, 1hr timestamp match)
        if ((latest.time - oldest.time) >= 1800) {
            const targetTime = latest.time - 3600;
            let tick1hAgo = cleanList[0];
            let minDelta = Math.abs(tick1hAgo.time - targetTime);
            for (let i = 1; i < cleanList.length - 1; i++) {
                const delta = Math.abs(cleanList[i].time - targetTime);
                if (delta < minDelta) {
                    minDelta = delta;
                    tick1hAgo = cleanList[i];
                }
            }

            const pcrCur = latest.value;
            const pcr1h = tick1hAgo.value;
            const pcr1hDiff = pcrCur - pcr1h;
            const pcr1hPct = pcr1h > 0 ? ((pcr1hDiff / pcr1h) * 100) : 0;
            const spotCur = latest.spot || 0;
            const spot1h = tick1hAgo.spot || 0;
            const spot1hDiff = (spotCur && spot1h) ? (spotCur - spot1h) : 0;
            const spot1hPct = spot1h > 0 ? ((spot1hDiff / spot1h) * 100) : 0;

            const item = { symbol: sym, pcrCur, pcr1h, pcr1hDiff, pcr1hPct, spotCur, spot1hDiff, spot1hPct };
            if (pcr1hDiff > 0) biasBull.push(item);
            if (pcr1hDiff < 0) biasBear.push(item);
        }

        // Live High-Power Score Check (>75 Score)
        const tick15m = cleanList[Math.max(0, cleanList.length - 4)];
        const pcrCur = latest.value;
        const pcrPrev = tick15m.value;
        const pcrDiff = pcrCur - pcrPrev;
        const pcrPct = pcrPrev > 0 ? ((pcrDiff / pcrPrev) * 100) : 0;
        const spotCur = latest.spot || 0;
        const spotPrev = tick15m.spot || 0;
        const spotDiff = (spotCur && spotPrev) ? (spotCur - spotPrev) : 0;
        const spotPct = spotPrev > 0 ? ((spotDiff / spotPrev) * 100) : 0;

        const isBullishAligned = (spotDiff > 0) && (pcrDiff > 0);
        const isBearishAligned = (spotDiff < 0) && (pcrDiff < 0);

        if (isBullishAligned || isBearishAligned) {
            const absSpotPct = Math.abs(spotPct);
            const absPcrPct = Math.abs(pcrPct);
            const harmonicPct = Math.sqrt(absSpotPct * absPcrPct);
            let powerScore = Math.round(45 + (harmonicPct * 22));
            powerScore = Math.min(99, Math.max(50, powerScore));

            if (powerScore >= 75) {
                // Global Anti-Spam Rate Limiter: Minimum 3 minutes between ANY alerts
                if (nowMs - lastServerGlobalNotificationTime >= 3 * 60 * 1000) {
                    const lastSent = serverAlertCooldowns[sym + '_power'] || 0;
                    if (nowMs - lastSent >= 30 * 60 * 1000) { // 30-min per-symbol cooldown
                        serverAlertCooldowns[sym + '_power'] = nowMs;
                        lastServerGlobalNotificationTime = nowMs;

                        const emoji = isBullishAligned ? '🚀' : '📉';
                        const tag = isBullishAligned ? 'PURE DUAL SURGE' : 'PURE DUAL CRASH';
                        const title = `${emoji} ${sym} (${powerScore}/100 Power Score)`;
                        const body = `Spot: ₹${spotCur ? spotCur.toLocaleString() : '---'} (${spotPct > 0 ? '+' : ''}${spotPct.toFixed(2)}%) | PCR Shift: ${pcrDiff > 0 ? '+' : ''}${pcrDiff.toFixed(4)}. ${tag}!`;

                        const alertObj = { id: `alert_${nowMs}_${sym}`, symbol: sym, title, body, powerScore, timeStr, timestamp: nowMs };
                        firebasePut(`/live_alerts/${sym}.json`, alertObj).catch(() => {});
                        firebasePut(`/latest_alert.json`, alertObj).catch(() => {});
                        sendFcmPushToAllDevices(title, body).catch(() => {});
                        console.log(`🔔 [SERVER ALERT DETECTED] ${title} - ${body}`);
                    }
                }
            }
        }
    });

    // Sort Top 5 Bias Leaders
    biasBull.sort((a, b) => b.pcr1hDiff - a.pcr1hDiff);
    biasBear.sort((a, b) => a.pcr1hDiff - b.pcr1hDiff);

    const topBull = biasBull.slice(0, 5);
    const topBear = biasBear.slice(0, 5);
    const currBullSyms = topBull.map(x => x.symbol);
    const currBearSyms = topBear.map(x => x.symbol);

    if (previousTop5BiasSymbols.bull.length > 0 || previousTop5BiasSymbols.bear.length > 0) {
        topBull.forEach((item, idx) => {
            // Require minimum PCR shift magnitude: |pcr1hDiff| >= 0.0250 or |pcr1hPct| >= 3.0%
            const absDiff = Math.abs(item.pcr1hDiff);
            const absPct = Math.abs(item.pcr1hPct);
            if (absDiff < 0.0250 && absPct < 3.0) return;

            if (!previousTop5BiasSymbols.bull.includes(item.symbol)) {
                // Global Anti-Spam Rate Limiter: Minimum 3 minutes between ANY alerts
                if (nowMs - lastServerGlobalNotificationTime >= 3 * 60 * 1000) {
                    const lastSent = serverAlertCooldowns[item.symbol + '_bias'] || 0;
                    if (nowMs - lastSent >= 30 * 60 * 1000) { // 30-min per-symbol cooldown
                        serverAlertCooldowns[item.symbol + '_bias'] = nowMs;
                        lastServerGlobalNotificationTime = nowMs;

                        const rank = idx + 1;
                        const title = `🟢 NEW 1-HR BIAS LEADER (#${rank}): ${item.symbol}`;
                        const body = `${item.symbol} entered Top 5 Bullish Bias Leaders! 1h PCR Shift: ${item.pcr1hDiff > 0 ? '+' : ''}${item.pcr1hDiff.toFixed(4)} (${item.pcr1hPct > 0 ? '+' : ''}${item.pcr1hPct.toFixed(1)}%) | Spot: ₹${item.spotCur ? item.spotCur.toLocaleString() : '---'}.`;

                        const alertObj = { id: `alert_${nowMs}_${item.symbol}_bias`, symbol: item.symbol, title, body, rank, timeStr, timestamp: nowMs };
                        firebasePut(`/live_alerts/${item.symbol}_bias.json`, alertObj).catch(() => {});
                        firebasePut(`/latest_alert.json`, alertObj).catch(() => {});
                        sendFcmPushToAllDevices(title, body).catch(() => {});
                        console.log(`🔔 [SERVER BIAS ALERT DETECTED] ${title} - ${body}`);
                    }
                }
            }
        });

        topBear.forEach((item, idx) => {
            // Require minimum PCR shift magnitude: |pcr1hDiff| >= 0.0250 or |pcr1hPct| >= 3.0%
            const absDiff = Math.abs(item.pcr1hDiff);
            const absPct = Math.abs(item.pcr1hPct);
            if (absDiff < 0.0250 && absPct < 3.0) return;

            if (!previousTop5BiasSymbols.bear.includes(item.symbol)) {
                // Global Anti-Spam Rate Limiter: Minimum 3 minutes between ANY alerts
                if (nowMs - lastServerGlobalNotificationTime >= 3 * 60 * 1000) {
                    const lastSent = serverAlertCooldowns[item.symbol + '_bias'] || 0;
                    if (nowMs - lastSent >= 30 * 60 * 1000) { // 30-min per-symbol cooldown
                        serverAlertCooldowns[item.symbol + '_bias'] = nowMs;
                        lastServerGlobalNotificationTime = nowMs;

                        const rank = idx + 1;
                        const title = `🔴 NEW 1-HR BIAS LEADER (#${rank}): ${item.symbol}`;
                        const body = `${item.symbol} entered Top 5 Bearish Bias Leaders! 1h PCR Shift: ${item.pcr1hDiff.toFixed(4)} (${item.pcr1hPct.toFixed(1)}%) | Spot: ₹${item.spotCur ? item.spotCur.toLocaleString() : '---'}.`;

                        const alertObj = { id: `alert_${nowMs}_${item.symbol}_bias`, symbol: item.symbol, title, body, rank, timeStr, timestamp: nowMs };
                        firebasePut(`/live_alerts/${item.symbol}_bias.json`, alertObj).catch(() => {});
                        firebasePut(`/latest_alert.json`, alertObj).catch(() => {});
                        sendFcmPushToAllDevices(title, body).catch(() => {});
                        console.log(`🔔 [SERVER BIAS ALERT DETECTED] ${title} - ${body}`);
                    }
                }
            }
        });
    }

    previousTop5BiasSymbols = { bull: currBullSyms, bear: currBearSyms };
}

// ===== CONTINUOUS SCANNING ENGINE (Distributed Workers) =====
let isScanRunning = false;
let cycleCount = 0;

async function continuousScanLoop() {
    if (isScanRunning) {
        console.log('⚠️ Previous scan cycle still running. Skipping overlap.');
        return;
    }

    // Stop scanning if throttled
    if (isThrottled) {
        console.log(`🚫 [Worker #${WORKER_ID}] Throttled — bandwidth exhausted. Checking again in 10 minutes...`);
        setTimeout(continuousScanLoop, 10 * 60 * 1000);
        return;
    }

    isScanRunning = true;
    cycleCount++;
    const cycleStart = Date.now();
    console.log(`\n🔄 ===== [Worker #${WORKER_ID}] SCAN CYCLE #${cycleCount} =====`);

    try {
        const isMarketLive = await executeMarketSync();

        const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
        console.log(`⏱️ [W#${WORKER_ID}] Cycle #${cycleCount} completed in ${elapsed}s`);

        if (isMarketLive) {
            // Market is live: scan every 60 seconds (1 minute interval)
            console.log(`⚡ [W#${WORKER_ID}] Market live — next cycle in 60 seconds...`);
            setTimeout(continuousScanLoop, 60 * 1000);
        } else {
            // Outside market hours: check every 5 minutes
            console.log(`🌙 [W#${WORKER_ID}] Market closed — re-checking in 5 minutes...`);
            setTimeout(continuousScanLoop, 5 * 60 * 1000);
        }
    } catch (err) {
        console.error('❌ Scan cycle error:', err);
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

    if (req.url === '/api/health' || req.url === '/ping') {
        res.writeHead(200);
        res.end(JSON.stringify({
            status: 'ok',
            workerId: WORKER_ID,
            uptime: Math.floor(process.uptime()),
            symbols: activeSymbols.length,
            totalSymbols: ALL_SYMBOLS.length,
            synced: lastSyncStatus.symbolsSynced || 0,
            bandwidthMB: Math.round(estimatedBandwidthBytes / (1024 * 1024)),
            throttled: isThrottled
        }));
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
        res.end(JSON.stringify({ message: `Worker #${WORKER_ID} Manual Sync Triggered`, status: lastSyncStatus }));
    } else {
        res.writeHead(200);
        res.end(JSON.stringify({
            app: `Destrade Worker #${WORKER_ID} (Fleet: ${TOTAL_WORKERS} workers)`,
            uptime: Math.floor(process.uptime()) + ' seconds',
            scanCycles: cycleCount,
            symbols: `${activeSymbols.length}/${ALL_SYMBOLS.length}`,
            bandwidthMB: Math.round(estimatedBandwidthBytes / (1024 * 1024)),
            throttled: isThrottled,
            absorbed: absorbedFrom,
            status: lastSyncStatus
        }, null, 2));
    }
});

server.listen(PORT, () => {
    console.log(`🌐 Destrade Worker #${WORKER_ID} running on port ${PORT}`);
    console.log(`📊 Symbols: ${activeSymbols.length}/${ALL_SYMBOLS.length} | Fleet: ${TOTAL_WORKERS} workers`);
    
    // Start the continuous scan loop immediately
    continuousScanLoop();

    // Keep-Alive Self-Ping Engine (every 10 minutes — Render keeps alive for 15 min)
    const selfUrls = [
        process.env.RENDER_EXTERNAL_URL
    ].filter(Boolean);

    setInterval(() => {
        selfUrls.forEach(url => {
            try {
                const client = url.startsWith('https') ? https : http;
                client.get(`${url}/ping`, (res) => {
                    console.log(`🏓 [W#${WORKER_ID}] Self-ping OK (${res.statusCode}) | BW: ${(estimatedBandwidthBytes / (1024*1024)).toFixed(0)} MB`);
                }).on('error', (err) => {
                    console.warn(`🏓 Self-ping notice:`, err.message);
                });
            } catch(e) {}
        });
    }, 10 * 60 * 1000);
});

