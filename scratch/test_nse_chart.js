const https = require('https');

function fetchNse(endpoint) {
    return new Promise((resolve) => {
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Referer': 'https://www.nseindia.com/'
            }
        };
        https.get('https://www.nseindia.com/', options, (res) => {
            const cookies = res.headers['set-cookie'] ? res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ') : '';
            options.headers['Cookie'] = cookies;

            https.get(`https://www.nseindia.com/api${endpoint}`, options, (res2) => {
                let data = '';
                res2.on('data', chunk => data += chunk);
                res2.on('end', () => {
                    console.log(`Endpoint: ${endpoint} | Status: ${res2.statusCode}`);
                    try { resolve(JSON.parse(data)); } catch (e) { resolve(data.substring(0, 200)); }
                });
            }).on('error', err => resolve(null));
        });
    });
}

async function main() {
    console.log("Testing NSE Chart API...");
    const res1 = await fetchNse('/chart-databyindex?index=NIFTY%2050&indices=true');
    console.log("Keys:", res1 ? Object.keys(res1) : null);
    if (res1) console.log("Sample:", JSON.stringify(res1).substring(0, 300));
}

main();
