const https = require('https');

function testSlug(sym, slug, type) {
    const url = `https://groww.in/v1/api/option_chain_service/v1/option_chain/${slug}?type=${type}`;
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
                        console.log(`✅ MATCH! ${sym} (${slug}): Spot ₹${spot} | PCR ${pcr} | Rows: ${oc.optionChains?.length}`);
                        resolve({ sym, slug, pcr, spot, ok: true });
                    } else {
                        console.log(`❌ Failed ${sym} (${slug}): No optionChain`);
                        resolve(null);
                    }
                } catch (e) {
                    console.log(`❌ Failed ${sym} (${slug}): Parse Error`);
                    resolve(null);
                }
            });
        }).on('error', () => resolve(null));
    });
}

async function runSlugTest() {
    const pairs = [
        { sym: 'NIFTY', slug: 'nifty', type: 'INDICES' },
        { sym: 'BANKNIFTY', slug: 'nifty-bank', type: 'INDICES' },
        { sym: 'BANKNIFTY', slug: 'bank-nifty', type: 'INDICES' },
        { sym: 'FINNIFTY', slug: 'fin-nifty', type: 'INDICES' },
        { sym: 'FINNIFTY', slug: 'nifty-financial-services', type: 'INDICES' },
        { sym: 'MIDCPNIFTY', slug: 'midcap-nifty', type: 'INDICES' },
        { sym: 'MIDCPNIFTY', slug: 'nifty-midcap-select', type: 'INDICES' },
        { sym: 'RELIANCE', slug: 'reliance-industries', type: 'STOCKS' },
        { sym: 'TCS', slug: 'tata-consultancy-services', type: 'STOCKS' },
        { sym: 'HDFCBANK', slug: 'hdfc-bank', type: 'STOCKS' },
        { sym: 'INFY', slug: 'infosys', type: 'STOCKS' },
        { sym: 'PAGEIND', slug: 'page-industries', type: 'STOCKS' },
        { sym: 'SBIN', slug: 'state-bank-of-india', type: 'STOCKS' },
        { sym: 'TATAMOTORS', slug: 'tata-motors', type: 'STOCKS' }
    ];

    for (const p of pairs) {
        await testSlug(p.sym, p.slug, p.type);
    }
}

runSlugTest();
