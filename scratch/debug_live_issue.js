const https = require('https');

function fetchUrl(url) {
    return new Promise((resolve) => {
        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

async function debugLiveIssue() {
    console.log('=== 1. CHECKING FIREBASE CRON STATUS ===');
    const cronStatus = await fetchUrl('https://destrade-default-rtdb.firebaseio.com/cron_status.json');
    console.log('Cron Status in Firebase:', JSON.stringify(cronStatus, null, 2));

    console.log('\n=== 2. CHECKING TODAY PCR HISTORY FOR NIFTY & RELIANCE ===');
    const todayStr = new Date().toISOString().split('T')[0];
    console.log('Today ISO Date:', todayStr);

    const niftyPcr = await fetchUrl(`https://destrade-default-rtdb.firebaseio.com/pcr_history/NIFTY/${todayStr}.json`);
    console.log('NIFTY PCR count today:', Array.isArray(niftyPcr) ? niftyPcr.length : (niftyPcr ? Object.keys(niftyPcr).length : 0));
    if (niftyPcr) console.log('Sample NIFTY PCR tick:', Array.isArray(niftyPcr) ? niftyPcr[niftyPcr.length - 1] : Object.values(niftyPcr).pop());

    const relPcr = await fetchUrl(`https://destrade-default-rtdb.firebaseio.com/pcr_history/RELIANCE/${todayStr}.json`);
    console.log('RELIANCE PCR count today:', Array.isArray(relPcr) ? relPcr.length : (relPcr ? Object.keys(relPcr).length : 0));

    console.log('\n=== 3. CHECKING GROWW OPTION CHAIN LIVE RESPONSE ===');
    const growwUrl = 'https://groww.in/v1/api/option_chain_service/v1/option_chain/exchange/NSE/segment/CASH/NIFTY?type=INDICES';
    const growwData = await fetchUrl(growwUrl);
    console.log('Groww Option Chain Returned:', !!growwData?.optionChain);
    if (growwData?.optionChain) {
        console.log('Underlying Price:', growwData.optionChain.underlyingValue);
        console.log('Expiries count:', growwData.optionChain.expiries?.length);
        console.log('Sample Option Chain row:', growwData.optionChain.optionChains?.[0]);
    }
}

debugLiveIssue();
