const https = require('https');

function testGrowwHeaders(headers) {
    return new Promise((resolve) => {
        const req = https.get('https://groww.in/v1/api/option_chain_service/v1/option_chain/exchange/NSE/segment/CASH/NIFTY?type=INDICES', {
            headers: headers
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                console.log(`Status ${res.statusCode} for headers:`, Object.keys(headers).join(', '));
                try {
                    const parsed = JSON.parse(body);
                    console.log('  OptionChain returned:', !!parsed.optionChain);
                    resolve(parsed);
                } catch (e) {
                    console.log('  JSON parse failed. Body snippet:', body.slice(0, 150));
                    resolve(null);
                }
            });
        });
        req.on('error', (err) => {
            console.log('  HTTP Error:', err.message);
            resolve(null);
        });
    });
}

async function runTest() {
    console.log('--- Test 1: Minimal Chrome User-Agent ---');
    await testGrowwHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    });

    console.log('\n--- Test 2: Groww Mobile Web Headers ---');
    await testGrowwHeaders({
        'User-Agent': 'Mozilla/5.0 (Linux; Android 12; Xiaomi 21091116AI) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-APP-VERSION': '4.5.0',
        'X-PLATFORM': 'web'
    });

    console.log('\n--- Test 3: Groww Live Quote API (v2) ---');
    const req2 = https.get('https://groww.in/v1/api/stocks_data/v2/user/boxes/search/NIFTY', {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        }
    }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => console.log('Live Box Search Status:', res.statusCode, body.slice(0, 200)));
    });
}

runTest();
