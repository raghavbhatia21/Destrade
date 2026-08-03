const https = require('https');

function getGrowwSearchSlug(query) {
    const url = `https://groww.in/v1/api/search/v1/entity/search?app=false&entity_type=stocks&query=${encodeURIComponent(query)}&size=3`;
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
                try {
                    const parsed = JSON.parse(body);
                    const content = parsed.content || [];
                    const match = content.find(c => c.search_id) || content[0];
                    if (match) {
                        console.log(`🔍 [SEARCH] ${query} -> search_id: "${match.search_id}" (title: "${match.title}")`);
                        resolve(match.search_id);
                    } else {
                        console.log(`❌ [SEARCH] ${query} -> No search_id match`);
                        resolve(null);
                    }
                } catch (e) {
                    console.log(`❌ [SEARCH] ${query} -> Parse Error`);
                    resolve(null);
                }
            });
        }).on('error', () => resolve(null));
    });
}

function testOptionChainSlug(sym, slug) {
    const url = `https://groww.in/v1/api/option_chain_service/v1/option_chain/${slug}?type=STOCKS`;
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
                    if (d && d.optionChain && d.optionChain.optionChains) {
                        const oc = d.optionChain;
                        let totalCE = 0, totalPE = 0;
                        oc.optionChains.forEach(row => {
                            if (row.callOption) totalCE += (row.callOption.openInterest || 0);
                            if (row.putOption) totalPE += (row.putOption.openInterest || 0);
                        });
                        const pcr = totalCE > 0 ? parseFloat((totalPE / totalCE).toFixed(2)) : 0;
                        console.log(`   ✅ [OC MATCH] ${sym} ("${slug}"): Spot ₹${oc.underlyingValue} | PCR ${pcr} | Rows: ${oc.optionChains.length}`);
                        resolve(pcr);
                    } else {
                        console.log(`   ❌ [OC FAIL] ${sym} ("${slug}"): Status ${res.statusCode}`);
                        resolve(null);
                    }
                } catch (e) {
                    console.log(`   ❌ [OC FAIL] ${sym} ("${slug}"): Parse Error`);
                    resolve(null);
                }
            });
        }).on('error', () => resolve(null));
    });
}

async function runFindStockSlugs() {
    const testSymbols = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'PAGEIND', 'TATAMOTORS', 'CHOLAFIN', 'BAJFINANCE', 'ICICIBANK'];
    for (const sym of testSymbols) {
        const slug = await getGrowwSearchSlug(sym);
        if (slug) {
            await testOptionChainSlug(sym, slug);
        }
    }
}

runFindStockSlugs();
