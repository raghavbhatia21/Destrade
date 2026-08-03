const https = require('https');

function getUrl(url) {
    return new Promise((resolve) => {
        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*'
            }
        }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve({ status: res.statusCode, body }));
        }).on('error', () => resolve(null));
    });
}

async function testGrowwSearch() {
    const res1 = await getUrl('https://groww.in/v1/api/search/v1/derived/search?query=reliance&size=5');
    console.log('Search v1 derived:', res1?.status, res1?.body?.slice(0, 200));

    const res2 = await getUrl('https://groww.in/v1/api/stocks_data/v1/all_stocks?page=0&size=5');
    console.log('All stocks v1:', res2?.status, res2?.body?.slice(0, 200));

    const res3 = await getUrl('https://groww.in/v1/api/search/v3/query/global/st_action?query=reliance&page=0&size=5');
    console.log('Search v3 global:', res3?.status, res3?.body?.slice(0, 200));
}

testGrowwSearch();
