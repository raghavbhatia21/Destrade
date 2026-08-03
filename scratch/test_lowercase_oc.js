const https = require('https');

function fetchOptionChain(symbol) {
    const cleanSym = symbol.toLowerCase().replace('nifty 50', 'nifty').replace('nifty bank', 'banknifty');
    const isIdx = ['nifty', 'banknifty', 'finnifty', 'midcpnifty'].includes(cleanSym);
    const type = isIdx ? 'INDICES' : 'STOCKS';
    const url = `https://groww.in/v1/api/option_chain_service/v1/option_chain/${cleanSym}?type=${type}`;

    return new Promise((resolve) => {
        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Referer': 'https://groww.in/'
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const d = JSON.parse(body);
                    if (d && d.optionChain) {
                        const oc = d.optionChain;
                        let totalCE = 0, totalPE = 0;
                        const spot = oc.underlyingValue || oc.lastPrice || 0;
                        if (oc.optionChains && Array.isArray(oc.optionChains)) {
                            oc.optionChains.forEach(row => {
                                if (row.callOption) totalCE += (row.callOption.openInterest || 0);
                                if (row.putOption) totalPE += (row.putOption.openInterest || 0);
                            });
                        }
                        const pcr = totalCE > 0 ? parseFloat((totalPE / totalCE).toFixed(2)) : 0;
                        console.log(`✅ [${res.statusCode}] ${symbol.toUpperCase()}: Spot ₹${spot} | PCR ${pcr} | Expiries: ${oc.expiries?.length} | Rows: ${oc.optionChains?.length}`);
                        resolve({ symbol, pcr, spot, count: oc.optionChains?.length });
                    } else {
                        console.log(`❌ [${res.statusCode}] ${symbol.toUpperCase()}: No optionChain object`);
                        resolve(null);
                    }
                } catch (e) {
                    console.log(`❌ [${res.statusCode}] ${symbol.toUpperCase()}: JSON Parse Error`);
                    resolve(null);
                }
            });
        }).on('error', (err) => {
            console.log(`❌ [ERR] ${symbol.toUpperCase()}:`, err.message);
            resolve(null);
        });
    });
}

async function runTests() {
    const testSymbols = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'PAGEIND', 'SBIN', 'TATAMOTORS', 'CHOLAFIN', 'BAJFINANCE'];
    for (const sym of testSymbols) {
        await fetchOptionChain(sym);
    }
}

runTests();
