/**
 * Destrade Pro — Autonomous Cloud Market Worker
 * Polls market data & updates Firebase Realtime DB during trading hours (Mon-Fri 09:15 - 15:30 IST)
 */

const https = require('https');

const FIREBASE_HOST = 'destrade-default-rtdb.firebaseio.com';

const fs = require('fs');
const path = require('path');

let SLUG_MAP = {
    'NIFTY': { slug: 'nifty', type: 'INDICES' },
    'BANKNIFTY': { slug: 'nifty-bank', type: 'INDICES' },
    'FINNIFTY': { slug: 'nifty-financial-services', type: 'INDICES' },
    'MIDCPNIFTY': { slug: 'nifty-midcap-select', type: 'INDICES' },
    'RELIANCE': { slug: 'reliance-industries-ltd', type: 'STOCKS' },
    'TCS': { slug: 'tata-consultancy-services-ltd', type: 'STOCKS' },
    'HDFCBANK': { slug: 'hdfc-bank-ltd', type: 'STOCKS' },
    'INFY': { slug: 'infosys-ltd', type: 'STOCKS' },
    'ICICIBANK': { slug: 'icici-bank-ltd', type: 'STOCKS' },
    'SBIN': { slug: 'state-bank-of-india', type: 'STOCKS' },
    'BHARTIARTL': { slug: 'bharti-airtel-ltd', type: 'STOCKS' },
    'AXISBANK': { slug: 'axis-bank-ltd', type: 'STOCKS' },
    'KOTAKBANK': { slug: 'kotak-mahindra-bank-ltd', type: 'STOCKS' },
    'LT': { slug: 'larsen-toubro-ltd', type: 'STOCKS' },
    'ITC': { slug: 'itc-ltd', type: 'STOCKS' },
    'HINDUNILVR': { slug: 'hindustan-unilever-ltd', type: 'STOCKS' },
    'BAJFINANCE': { slug: 'bajaj-finance-ltd', type: 'STOCKS' },
    'MARUTI': { slug: 'maruti-suzuki-india-ltd', type: 'STOCKS' },
    'SUNPHARMA': { slug: 'sun-pharmaceutical-industries-ltd', type: 'STOCKS' },
    'TATASTEEL': { slug: 'tata-steel-ltd', type: 'STOCKS' },
    'NTPC': { slug: 'ntpc-ltd', type: 'STOCKS' },
    'POWERGRID': { slug: 'power-grid-corporation-of-india-ltd', type: 'STOCKS' },
    'TATAMOTORS': { slug: 'tata-motors-ltd', type: 'STOCKS' },
    'WIPRO': { slug: 'wipro-ltd', type: 'STOCKS' },
    'TITAN': { slug: 'titan-company-ltd', type: 'STOCKS' },
    'ULTRACEMCO': { slug: 'ultratech-cement-ltd', type: 'STOCKS' },
    'ADANIENT': { slug: 'adani-enterprises-ltd', type: 'STOCKS' },
    'HEROMOTOCO': { slug: 'hero-motocorp-ltd', type: 'STOCKS' },
    'ONGC': { slug: 'oil-natural-gas-corporation-ltd', type: 'STOCKS' },
    'COALINDIA': { slug: 'coal-india-ltd', type: 'STOCKS' },
    'COFORGE': { slug: 'niit-technologies-ltd', type: 'STOCKS' },
    'DIVISLAB': { slug: 'divis-laboratories-ltd', type: 'STOCKS' },
    'EICHERMOT': { slug: 'eicher-motors-ltd', type: 'STOCKS' },
    'GRASIM': { slug: 'grasim-industries-ltd', type: 'STOCKS' },
    'HCLTECH': { slug: 'hcl-technologies-ltd', type: 'STOCKS' },
    'HDFCLIFE': { slug: 'hdfc-standard-life-insurance-co-ltd', type: 'STOCKS' },
    'PAGEIND': { slug: 'page-industries-ltd', type: 'STOCKS' }
};

try {
    const jsonPath = path.join(__dirname, 'scratch', 'slug_map.json');
    if (fs.existsSync(jsonPath)) {
        const fullMap = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        SLUG_MAP = { ...SLUG_MAP, ...fullMap };
    }
} catch(e) {}

const SYMBOLS = Object.keys(SLUG_MAP);

function getISTDate() {
    const d = new Date();
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    return new Date(utc + (5.5 * 60 * 60 * 1000));
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
    return d ? (d.ltp || d.value || 0) : 0;
}

async function fetchOptionChainPCR(symbol) {
    const info = SLUG_MAP[symbol] || { slug: symbol.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-ltd', type: 'STOCKS' };
    const url = `https://groww.in/v1/api/option_chain_service/v1/option_chain/${info.slug}?type=${info.type}`;
    
    const d = await fetchUrl(url);
    if (!d || !d.optionChain) return null;

    const oc = d.optionChain;
    let totalCE = 0, totalPE = 0;
    let spot = oc.underlyingValue || oc.lastPrice || 0;

    if (spot === 0) {
        spot = await fetchSpotPrice(symbol, info.type === 'INDICES');
    }

    if (oc.optionChains && Array.isArray(oc.optionChains)) {
        oc.optionChains.forEach(row => {
            if (row.callOption) totalCE += (row.callOption.openInterest || 0);
            if (row.putOption) totalPE += (row.putOption.openInterest || 0);
        });
    }

    if (totalCE === 0) return null;
    const pcr = parseFloat((totalPE / totalCE).toFixed(2));
    return { pcr, spot };
}

async function runCloudWorker() {
    const ist = getISTDate();
    const day = ist.getDay();
    const hour = ist.getHours();
    const min = ist.getMinutes();
    const totalMin = (hour * 60) + min;

    const dateStr = ist.toISOString().split('T')[0];
    const timeStr = ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    console.log(`⏱️ [Cloud Worker] IST Time: ${dateStr} ${timeStr} (Day: ${day})`);

    // Check if Weekend (0 = Sun, 6 = Sat)
    if (day === 0 || day === 6) {
        console.log('🌴 Market Closed (Weekend). Cloud Worker skipping update.');
        await firebasePut('/cron_status.json', {
            lastRun: ist.toISOString(),
            status: 'Market Closed (Weekend)',
            dateStr: dateStr
        });
        return;
    }

    // Check Market Hours (09:10 AM to 03:40 PM IST)
    const marketStart = (9 * 60) + 10;
    const marketEnd = (15 * 60) + 40;

    if (totalMin < marketStart || totalMin > marketEnd) {
        console.log('🌙 Outside Market Hours (09:15 - 15:30 IST). Cloud Worker skipping update.');
        await firebasePut('/cron_status.json', {
            lastRun: ist.toISOString(),
            status: 'Outside Market Hours',
            dateStr: dateStr
        });
        return;
    }

    console.log(`⚡ Market Live! Fetching PCR data for ${SYMBOLS.length} symbols...`);

    const summary = {};
    const batchSize = 10;

    for (let i = 0; i < SYMBOLS.length; i += batchSize) {
        const batch = SYMBOLS.slice(i, i + batchSize);
        await Promise.all(batch.map(async sym => {
            try {
                const data = await fetchOptionChainPCR(sym);
                if (data && data.pcr > 0) {
                    summary[sym] = data;

                    const path = `/pcr_history/${sym}/${dateStr}.json`;
                    const existing = await firebaseGet(path);
                    const list = Array.isArray(existing) ? existing : (existing ? Object.values(existing) : []);

                    const lastEntry = list[list.length - 1];
                    if (!lastEntry || lastEntry.timeStr !== timeStr) {
                        list.push({
                            time: Math.floor(Date.now() / 1000),
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

    await firebasePut('/cron_status.json', {
        lastRun: ist.toISOString(),
        status: 'Active (Live Market Sync)',
        dateStr: dateStr,
        symbolsSynced: Object.keys(summary).length,
        summary: summary
    });

    console.log(`🎉 Cloud Worker Pass Completed! Synced ${Object.keys(summary).length}/${SYMBOLS.length} symbols!`);
}

async function startAutonomousWorker() {
    console.log('🚀 Autonomous Cloud Market Worker Started!');
    const startTime = Date.now();
    const DURATION_MS = 4.5 * 60 * 1000; // 4.5 minutes continuous loop per job run

    let pass = 0;
    while (Date.now() - startTime < DURATION_MS) {
        pass++;
        console.log(`\n⏱️ --- Starting Continuous Market Sync Pass #${pass} ---`);
        try {
            await runCloudWorker();
        } catch (e) {
            console.error('Market sync error:', e.message);
        }

        const elapsed = Date.now() - startTime;
        if (elapsed < DURATION_MS - 60000) {
            console.log('⏳ Waiting 60 seconds for next live tick pass...');
            await new Promise(r => setTimeout(r, 60000));
        } else {
            break;
        }
    }
    console.log('\n🏁 4.5-Minute Continuous Execution Complete. Exiting cleanly.');
}

startAutonomousWorker().catch(console.error);

