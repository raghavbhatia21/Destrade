const https = require('https');

function fetchUrl(url, headers = {}) {
    return new Promise((resolve) => {
        const u = new URL(url);
        const req = https.request({
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
                ...headers
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`[${res.statusCode}] ${url} (${data.length} bytes)`);
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, error: e.message, raw: data.substring(0, 200) });
                }
            });
        });
        req.on('error', err => {
            console.error(`[ERR] ${url}: ${err.message}`);
            resolve(null);
        });
        req.end();
    });
}

async function test() {
    console.log('Testing Groww endpoints...');
    const g1 = await fetchUrl('https://groww.in/v1/api/stocks_fo_data/v1/live-aggregations/explore/market_trends/instrument/STOCKS?exchange=NSE&interval=ONE_DAY&limit=300&marketTrendFactor=PRICE&type=GAINERS');
    const g2 = await fetchUrl('https://groww.in/v1/api/option_chain/v1/option_chain/NIFTY');
    
    console.log('Testing Netlify proxy server if deployed...');
}

test();
