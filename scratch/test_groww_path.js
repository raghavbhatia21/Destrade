const https = require('https');

function fetchGroww(path) {
    return new Promise((resolve) => {
        const options = {
            hostname: 'groww.in',
            path: path,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Referer': 'https://groww.in/'
            }
        };
        https.get(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`Path: ${path.substring(0, 100)}... => Status: ${res.statusCode}`);
                if (res.statusCode === 200) {
                    try {
                        const parsed = JSON.parse(data);
                        console.log("Count:", parsed.companyDetailsList?.length, "Sample item:", parsed.companyDetailsList?.[0]?.identifier);
                    } catch(e) {}
                }
                resolve(null);
            });
        }).on('error', err => resolve(null));
    });
}

async function main() {
    console.log("Testing Groww PRICE & VOLUME paths...");
    const p1 = '/v1/api/stocks_fo_data/v1/live-aggregations/explore/market_trends/instrument/STOCKS?exchange=NSE&interval=ONE_DAY&limit=300&marketTrendFactor=PRICE&type=GAINERS';
    const p2 = '/v1/api/stocks_fo_data/v1/live-aggregations/explore/market_trends/instrument/STOCKS?exchange=NSE&interval=ONE_DAY&limit=300&marketTrendFactor=PRICE&type=LOSERS';
    const p3 = '/v1/api/stocks_fo_data/v1/live-aggregations/explore/market_trends/instrument/STOCKS?exchange=NSE&interval=ONE_DAY&limit=300&marketTrendFactor=VOLUME&type=GAINERS';
    const p4 = '/v1/api/stocks_fo_data/v1/live-aggregations/explore/market_trends/instrument/STOCKS?exchange=NSE&interval=ONE_DAY&limit=300&marketTrendFactor=VOLUME&type=LOSERS';

    await fetchGroww(p1);
    await fetchGroww(p2);
    await fetchGroww(p3);
    await fetchGroww(p4);
}

main();
