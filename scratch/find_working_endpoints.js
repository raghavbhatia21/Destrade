const https = require('https');

function testEndpoint(url) {
    return new Promise((resolve) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Referer': 'https://groww.in/'
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                const len = body.length;
                let isOk = false;
                try {
                    const parsed = JSON.parse(body);
                    isOk = true;
                    console.log(`[${res.statusCode}] SUCCESS (${len} bytes): ${url}`);
                    console.log('   Keys:', Object.keys(parsed).join(', '));
                    resolve({ url, status: res.statusCode, data: parsed });
                } catch (e) {
                    console.log(`[${res.statusCode}] FAILED HTML/Invalid (${len} bytes): ${url}`);
                    resolve(null);
                }
            });
        });
        req.on('error', (e) => {
            console.log(`[ERR] ${e.message}: ${url}`);
            resolve(null);
        });
    });
}

async function findWorking() {
    const urls = [
        'https://groww.in/v1/api/option_chain_service/v1/option_chain/nifty?type=INDICES',
        'https://groww.in/v1/api/option_chain_service/v1/option_chain/NIFTY?type=INDICES',
        'https://groww.in/v1/api/stocks_data/v1/option_chain/NIFTY',
        'https://groww.in/v1/api/stocks_data/v1/option_chain/nifty',
        'https://groww.in/v1/api/option_chain_service/v1/option_chain/exchange/NSE/segment/CASH/nifty',
        'https://groww.in/v1/api/stocks_data/v1/tr_live_prices/exchange/NSE/segment/CASH/NIFTY/latest',
        'https://groww.in/v1/api/stocks_data/v1/company/search_id/nifty-50',
        'https://groww.in/v1/api/stocks_data/v1/company/search_id/reliance-industries',
        'https://groww.in/v1/api/stocks_data/v1/all_stocks/market_gainers/FO',
        'https://groww.in/v1/api/stocks_data/v1/all_stocks/market_loosers/FO',
        'https://groww.in/v1/api/stocks_data/v1/fno/derivatives/nifty-50'
    ];

    for (const url of urls) {
        await testEndpoint(url);
    }
}

findWorking();
