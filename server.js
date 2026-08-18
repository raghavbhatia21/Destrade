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

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0'
];

function fetchUrl(url) {
    const randomUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    return new Promise((resolve) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': randomUA,
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Origin': 'https://groww.in',
                'Referer': 'https://groww.in/options/nifty'
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

// In-memory cache to prevent redundant Firebase GET requests and keep bandwidth ultra-low (Free Tier Safe)
let memoryHistoryCache = {};
let memoryCacheDateStr = '';

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

    // Reset memory cache on new day
    if (dateStr !== memoryCacheDateStr) {
        memoryHistoryCache = {};
        memoryCacheDateStr = dateStr;
        console.log(`📅 New trading day detected (${dateStr}). In-memory cache reset.`);
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

                    // Load baseline from Firebase only ONCE per day if not in memory
                    if (!memoryHistoryCache[sym]) {
                        const existing = await firebaseGet(path);
                        memoryHistoryCache[sym] = Array.isArray(existing) ? existing : (existing ? Object.values(existing) : []);
                    }

                    const list = memoryHistoryCache[sym];
                    const lastEntry = list[list.length - 1];
                    const timeElapsed = lastEntry ? (nowSec - lastEntry.time) : 999;
                    
                    // Ultra-Lean Free Tier Safe Rule:
                    // Require min 120 seconds (2 mins) between ticks AND a meaningful PCR or Spot price shift
                    const pcrChanged = !lastEntry || Math.abs(lastEntry.value - data.pcr) >= 0.0001;
                    const spotChanged = !lastEntry || Math.abs(lastEntry.spot - data.spot) >= 0.05;

                    if (timeElapsed >= 120 && (pcrChanged || spotChanged)) {
                        list.push({
                            time: nowSec,
                            timeStr: timeStr,
                            value: data.pcr,
                            spot: data.spot
                        });

                        // Keep max 250 ticks per symbol per day (~8 hours of 2-min ticks)
                        const trimmedList = list.slice(-250);
                        memoryHistoryCache[sym] = trimmedList;

                        await firebasePut(path, trimmedList);
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
        status: 'Active (Continuous Scanner - 24/7 Cloud Alerts Active)',
        dateStr: dateStr,
        symbolsSynced: Object.keys(summary).length,
        summary: summary
    };

    await firebasePut('/cron_status.json', lastSyncStatus);

    // Write lightweight snapshot: only latest tick per symbol (~30KB vs ~2.5MB full history)
    // Client polls this every 30s for near-real-time Market Bias updates
    const snapshot = {};
    for (const sym of Object.keys(memoryHistoryCache)) {
        const list = memoryHistoryCache[sym];
        if (Array.isArray(list) && list.length > 0) {
            const latest = list[list.length - 1];
            // Also include the tick closest to 1 hour ago for 1h bias calculation
            const targetTime = latest.time - 3600;
            let tick1hAgo = list[0];
            let minDelta = Math.abs(tick1hAgo.time - targetTime);
            for (let i = 1; i < list.length - 1; i++) {
                const delta = Math.abs(list[i].time - targetTime);
                if (delta < minDelta) { minDelta = delta; tick1hAgo = list[i]; }
            }
            snapshot[sym] = {
                cur: { time: latest.time, value: latest.value, spot: latest.spot, timeStr: latest.timeStr },
                h1: { time: tick1hAgo.time, value: tick1hAgo.value, spot: tick1hAgo.spot },
                len: list.length
            };
        }
    }
    await firebasePut('/pcr_snapshot.json', snapshot);

    console.log(`🎉 Full Scan Cycle Completed! Synced ${Object.keys(summary).length}/${SYMBOLS.length} symbols! Snapshot: ${Object.keys(snapshot).length} symbols.`);

    // Run 24/7 Server-Side Background Alert Detection
    try {
        await evaluateServerSideAlerts(dateStr, timeStr);
    } catch(e) {
        console.warn('Server alert evaluation error:', e);
    }

    return true; // signal: market is live
}

// ===== 24/7 SERVER-SIDE BACKGROUND ALERT ENGINE =====
const serverAlertCooldowns = {};
let previousTop5BiasSymbols = { bull: [], bear: [] };
let lastServerGlobalNotificationTime = 0;

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
                        console.log(`🔔 [SERVER BIAS ALERT DETECTED] ${title} - ${body}`);
                    }
                }
            }
        });
    }

    previousTop5BiasSymbols = { bull: currBullSyms, bear: currBearSyms };
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

    // Keep-Alive Self-Ping Engine (every 2 minutes to prevent Render free instance from sleeping)
    const selfUrls = [
        process.env.RENDER_EXTERNAL_URL,
        'https://destrade.onrender.com'
    ].filter(Boolean);

    setInterval(() => {
        selfUrls.forEach(url => {
            try {
                const client = url.startsWith('https') ? https : http;
                client.get(`${url}/ping`, (res) => {
                    console.log(`🏓 Self-ping to ${url} succeeded (status: ${res.statusCode})`);
                }).on('error', (err) => {
                    console.warn(`🏓 Self-ping to ${url} notice:`, err.message);
                });
            } catch(e) {}
        });
    }, 2 * 60 * 1000);
});

