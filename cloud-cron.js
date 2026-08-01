/**
 * Destrade Pro — Autonomous Cloud Market Worker
 * Polls market data & updates Firebase Realtime DB during trading hours (Mon-Fri 09:15 - 15:30 IST)
 */

const https = require('https');

const FIREBASE_HOST = 'destrade-default-rtdb.firebaseio.com';
const INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
const ALL_FO_SYMBOLS = [
    ...INDICES,
    'AARTIIND', 'ABB', 'ABBOTINDIA', 'ABCAPITAL', 'ABFRL', 'ACC', 'ADANIENSOL', 'ADANIENT', 
    'ADANIPORTS', 'ALKEM', 'AMBUJACEM', 'APOLLOHOSP', 'APOLLOTYRE', 'ASHOKLEY', 'ASIANPAINT', 
    'ASTRAL', 'ATUL', 'AUBANK', 'AUROPHARMA', 'AXISBANK', 'BAJAJ-AUTO', 'BAJAJFINSV', 
    'BAJFINANCE', 'BALKRISIND', 'BALRAMCHIN', 'BANDHANBNK', 'BANKBARODA', 'BATAINDIA', 
    'BEL', 'BERGEPAINT', 'BHARATFORG', 'BHARTIARTL', 'BHEL', 'BIOCON', 'BOSCHLTD', 
    'BPCL', 'BRITANNIA', 'BSOFT', 'CANBK', 'CANFINHOME', 'CHAMBLFERT', 'CHOLAFIN', 
    'CIPLA', 'COALINDIA', 'COFORGE', 'COLPAL', 'CONCOR', 'COROMANDEL', 'CROMPTON', 
    'CUMMINSIND', 'CYIENT', 'DABUR', 'DALBHARAT', 'DEEPAKNTR', 'DIVISLAB', 'DIXON', 
    'DLF', 'DRREDDY', 'EICHERMOT', 'ESCORTS', 'EXIDEIND', 'FEDERALBNK', 'GAIL', 
    'GLENMARK', 'GMMPFAUDLR', 'GMRINFRA', 'GNFC', 'GODREJCP', 'GODREJPROP', 'GRANULES', 
    'GRASIM', 'GUJGASLTD', 'HAL', 'HAVELLS', 'HCLTECH', 'HDFCAMC', 'HDFCBANK', 
    'HDFCLIFE', 'HEROMOTOCO', 'HINDALCO', 'HINDCOPPER', 'HINDPETRO', 'HINDUNILVR', 
    'ICICIBANK', 'ICICIGI', 'ICICIPRULI', 'IDEA', 'IDFC', 'IDFCFIRSTB', 'IEX', 
    'IGL', 'INDHOTEL', 'INDIACEM', 'INDIAMART', 'INDIGO', 'INDUSINDBK', 'INDUSTOWER', 
    'INFY', 'IOC', 'IPCALAB', 'IRCTC', 'ITC', 'JINDALSTEL', 'JKCEMENT', 'JSWSTEEL', 
    'JUBLFOOD', 'KALYANKJIL', 'KEI', 'KOTAKBANK', 'LALPATHLAB', 'LAURUSLABS', 
    'LICHSGFIN', 'LTIM', 'LT', 'LTF', 'LUPIN', 'M&M', 'M&MFIN', 'MANAPPURAM', 
    'MARICO', 'MARUTI', 'MCDOWELL-N', 'MCX', 'METROPOLIS', 'MFSL', 'MGL', 
    'MOTHERSON', 'MPHASIS', 'MRF', 'MUTHOOTFIN', 'NATIONALUM', 'NAVINFLUOR', 
    'NESTLEIND', 'NMDC', 'NTPC', 'OBEROIRLTY', 'OFSS', 'OIL', 'ONGC', 'PAGEIND', 
    'PERSISTENT', 'PETRONET', 'PFC', 'PIDILITIND', 'PIIND', 'PNB', 'POLYCAB', 
    'POWERGRID', 'PRESTIGE', 'PVRINOX', 'RAMCOCEM', 'RBLBANK', 'RECLTD', 'RELIANCE', 
    'SAIL', 'SBICARD', 'SBILIFE', 'SBIN', 'SHREECEM', 'SHRIRAMFIN', 'SIEMENS', 
    'SRF', 'SUNPHARMA', 'SUNTV', 'SYNGENE', 'TATACOMM', 'TATACONSUM', 'TATELXSI', 
    'TATAMOTORS', 'TATAPOWER', 'TATASTEEL', 'TCS', 'TECHM', 'TIINDIA', 'TITAN', 
    'TORNTPHARM', 'TORNTPOWER', 'TRENT', 'TVSMOTOR', 'UBL', 'ULTRACEMCO', 'UPL', 
    'VEDL', 'VOLTAS', 'WIPRO', 'YESBANK', 'ZEEL'
];

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
                'Accept': 'application/json'
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

async function fetchOptionChainPCR(symbol) {
    const isIdx = INDICES.includes(symbol);
    const type = isIdx ? 'INDICES' : 'STOCKS';
    const url = `https://groww.in/v1/api/option_chain_service/v1/option_chain/exchange/NSE/segment/CASH/${symbol}?type=${type}`;
    
    const d = await fetchUrl(url);
    if (!d || !d.optionChain) return null;

    const oc = d.optionChain;
    let totalCE = 0, totalPE = 0;
    let spot = oc.underlyingValue || oc.lastPrice || 0;

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
    const timeStr = ist.toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit' });

    console.log(`⏱️ [Cloud Worker] IST Time: ${dateStr} ${timeStr} (Day: ${day})`);

    // Check if Weekend (0 = Sun, 6 = Sat)
    if (day === 0 || day === 6) {
        console.log('🌴 Market Closed (Weekend). Cloud Worker skipping update.');
        await firebasePut('/cron_status.json', {
            lastRun: ist.toISOString(),
            status: 'Market Closed (Weekend)',
            dateStr: dateStr,
            symbolCount: ALL_FO_SYMBOLS.length
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
            dateStr: dateStr,
            symbolCount: ALL_FO_SYMBOLS.length
        });
        return;
    }

    console.log(`⚡ Market Live! Parallel processing ${ALL_FO_SYMBOLS.length} F&O symbols...`);

    const summary = {};
    const batchSize = 15;

    for (let i = 0; i < ALL_FO_SYMBOLS.length; i += batchSize) {
        const batch = ALL_FO_SYMBOLS.slice(i, i + batchSize);
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

    console.log(`🎉 Cloud Worker Completed! Synced ${Object.keys(summary).length}/${ALL_FO_SYMBOLS.length} F&O symbols!`);
}

runCloudWorker().catch(console.error);
