const https = require('https');

function fetchRaw(url) {
    return new Promise((resolve) => {
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Referer': 'https://groww.in/'
            }
        };
        https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`URL: ${url} | Status: ${res.statusCode}`);
                if (res.statusCode === 200) {
                    try { resolve(JSON.parse(data)); } catch (e) { resolve(data.substring(0, 200)); }
                } else {
                    resolve(null);
                }
            });
        }).on('error', err => resolve(err.message));
    });
}

async function main() {
    console.log("Testing Groww candlestick endpoints...");
    const urls = [
        'https://groww.in/v1/api/stocks_data/v1/candlesticks/interval/1m/exchange/NSE/segment/CASH/nifty-50/latest',
        'https://groww.in/v1/api/stocks_data/v1/candlesticks/interval/1m/exchange/NSE/segment/CASH/NIFTY50/latest',
        'https://groww.in/v1/api/stocks_data/v1/candlesticks/interval/1m/exchange/NSE/segment/CASH/GVT_INDEX_NIFTY/latest',
        'https://groww.in/v1/api/charting_service/v2/chart/exchange/NSE/segment/INDEX/nifty-50/1m'
    ];
    for (const url of urls) {
        const res = await fetchRaw(url);
        if (res && res.candles) console.log("FOUND CANDLES! Length:", res.candles.length, "Sample:", res.candles[0]);
    }
}

main();
