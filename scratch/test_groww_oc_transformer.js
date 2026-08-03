const https = require('https');

const SYMBOL_SLUGS = {
    'NIFTY': { slug: 'nifty', type: 'INDICES' },
    'NIFTY 50': { slug: 'nifty', type: 'INDICES' },
    'BANKNIFTY': { slug: 'nifty-bank', type: 'INDICES' },
    'NIFTY BANK': { slug: 'nifty-bank', type: 'INDICES' },
    'FINNIFTY': { slug: 'nifty-financial-services', type: 'INDICES' },
    'MIDCPNIFTY': { slug: 'nifty-midcap-select', type: 'INDICES' },
    'RELIANCE': { slug: 'reliance-industries', type: 'STOCKS' },
    'TCS': { slug: 'tata-consultancy-services', type: 'STOCKS' },
    'HDFCBANK': { slug: 'hdfc-bank-ltd', type: 'STOCKS' },
    'INFY': { slug: 'infosys-ltd', type: 'STOCKS' },
    'SBIN': { slug: 'state-bank-of-india', type: 'STOCKS' },
    'TATAMOTORS': { slug: 'tata-motors-ltd', type: 'STOCKS' }
};

function fetchUrl(url) {
    return new Promise((resolve) => {
        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Referer': 'https://groww.in/'
            }
        }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

async function testTransform(symbol) {
    const info = SYMBOL_SLUGS[symbol] || { slug: symbol.toLowerCase(), type: 'STOCKS' };
    const url = `https://groww.in/v1/api/option_chain_service/v1/option_chain/${info.slug}?type=${info.type}`;
    const d = await fetchUrl(url);

    if (!d || !d.optionChain) {
        console.log(`❌ ${symbol}: Groww returned no optionChain`);
        return;
    }

    const oc = d.optionChain;
    const expiries = oc.expiries || [];
    const underlyingValue = oc.underlyingValue || oc.lastPrice || 0;
    const rawRows = oc.optionChains || [];

    const data = rawRows.map(r => ({
        strikePrice: r.strikePrice,
        CE: r.callOption ? {
            strikePrice: r.strikePrice,
            underlyingValue: underlyingValue,
            openInterest: r.callOption.openInterest || 0,
            changeinOpenInterest: r.callOption.changeInOpenInterest || 0,
            pchangeinOpenInterest: r.callOption.pchangeInOpenInterest || 0,
            totalTradedVolume: r.callOption.totalTradedVolume || 0,
            impliedVolatility: r.callOption.impliedVolatility || 0,
            lastPrice: r.callOption.ltp || 0,
            change: r.callOption.dayChange || 0,
            pChange: r.callOption.dayChangePerc || 0
        } : null,
        PE: r.putOption ? {
            strikePrice: r.strikePrice,
            underlyingValue: underlyingValue,
            openInterest: r.putOption.openInterest || 0,
            changeinOpenInterest: r.putOption.changeInOpenInterest || 0,
            pchangeinOpenInterest: r.putOption.pchangeInOpenInterest || 0,
            totalTradedVolume: r.putOption.totalTradedVolume || 0,
            impliedVolatility: r.putOption.impliedVolatility || 0,
            lastPrice: r.putOption.ltp || 0,
            change: r.putOption.dayChange || 0,
            pChange: r.putOption.dayChangePerc || 0
        } : null
    }));

    console.log(`✅ TRANSFORMATION SUCCESS: ${symbol}`);
    console.log(`   Underlying Spot: ₹${underlyingValue}`);
    console.log(`   Expiries (${expiries.length}):`, expiries.slice(0, 3));
    console.log(`   Rows Count: ${data.length}`);
    console.log(`   Sample Strike Row:`, JSON.stringify(data[Math.floor(data.length / 2)], null, 2));
}

async function run() {
    await testTransform('NIFTY');
    await testTransform('BANKNIFTY');
    await testTransform('FINNIFTY');
}

run();
