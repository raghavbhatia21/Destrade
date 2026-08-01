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
    const gainersUrl = 'https://groww.in/v1/api/stocks_fo_data/v1/live-aggregations/explore/market_trends/instrument/STOCKS?exchange=NSE&interval=ONE_DAY&limit=300&marketTrendFactor=PRICE&type=GAINERS';
    const data = await fetchJson(gainersUrl);
    console.log('Gainers Keys:', Object.keys(data || {}));
    if (data && data.companyDetailsList) {
        console.log('Item Count:', data.companyDetailsList.length);
        console.log('Sample Item 0:', JSON.stringify(data.companyDetailsList[0], null, 2));
    }
}

test();
