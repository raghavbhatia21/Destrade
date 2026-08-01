const https = require('https');

function fetchJson(url) {
    return new Promise((resolve) => {
        https.get(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

async function test() {
    const syms = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'SBIN', 'TATAMOTORS', 'BHARTIARTL'];
    for (const sym of syms) {
        const res = await fetchJson(`https://groww.in/v1/api/stocks_data/v1/tr_live_prices/exchange/NSE/segment/CASH/${sym}/latest`);
        if (res) {
            console.log(`✅ ${sym}: LTP ₹${res.ltp}, Chg%: ${res.dayChangePerc?.toFixed(2)}%, Vol: ${res.volume}`);
        } else {
            console.log(`❌ ${sym}: Failed`);
        }
    }
}

test();
