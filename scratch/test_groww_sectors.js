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
    const indices = ['NIFTY-BANK', 'NIFTY-IT', 'NIFTY-AUTO', 'NIFTY-PHARMA', 'NIFTY-FMCG', 'NIFTY-REALTY', 'NIFTY-ENERGY', 'NIFTY-MEDIA'];
    for (const idx of indices) {
        const url = `https://groww.in/v1/api/stocks_data/v1/tr_live_indices/exchange/NSE/segment/CASH/${idx}/latest`;
        const res = await fetchJson(url);
        console.log(`${idx}:`, res ? `LTP: ${res.value || res.ltp}, Chg%: ${res.dayChangePerc}%` : 'FAILED');
    }
}

test();
