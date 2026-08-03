const https = require('https');
const fs = require('fs');

const FO_STOCKS = [
    'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'SBIN', 'BHARTIARTL', 'AXISBANK', 
    'KOTAKBANK', 'LT', 'ITC', 'HINDUNILVR', 'BAJFINANCE', 'MARUTI', 'SUNPHARMA', 'TATASTEEL', 
    'NTPC', 'POWERGRID', 'TATAMOTORS', 'WIPRO', 'TITAN', 'ULTRACEMCO', 'ADANIENT', 'HEROMOTOCO', 
    'ONGC', 'COALINDIA', 'COFORGE', 'DIVISLAB', 'EICHERMOT', 'GRASIM', 'HCLTECH', 'HDFCLIFE', 'PAGEIND',
    'ASHOKLEY', 'ASTRAL', 'AUROPHARMA', 'BALKRISIND', 'BANDHANBNK', 'BANKBARODA', 'BEL', 'BHARATFORG',
    'BPCL', 'BRITANNIA', 'BSOFT', 'CANBK', 'CHOLAFIN', 'CIPLA', 'CONCOR', 'COROMANDEL', 'CUMMINSIND',
    'DABUR', 'DALBHARAT', 'DEEPAKNTR', 'DELTATECH', 'DRREDDY', 'ESCORTS', 'FEDERALBNK', 'GAIL', 'GLENMARK',
    'GODREJPROP', 'GRANULES', 'HAVELLES', 'IDFCFIRSTB', 'IEX', 'IGL', 'INDHOTEL', 'INDIAMART', 'INDUSINDBK',
    'INDUSTOWER', 'IPCALAB', 'IRCTC', 'JINDALSTEL', 'JKCEMENT', 'JSWSTEEL', 'JUBLFOOD', 'LTIM', 'LUPIN',
    'M&M', 'MANAPPURAM', 'MARICO', 'MCDOWELL-N', 'MCX', 'METROPOLIS', 'MFSL', 'MGL', 'MOTHERSON', 'MPHASIS',
    'MRF', 'MUTHOOTFIN', 'NATIONALUM', 'NAVINFLUOR', 'NESTLEIND', 'NMDC', 'OBEROIRTY', 'OFSS', 'PEL',
    'PERSISTENT', 'PETRONET', 'PFC', 'PIDILITIND', 'PIIND', 'PNB', 'POLYCAB', 'RBLBANK', 'RECLTD', 'SAIL',
    'SBICARD', 'SBILIFE', 'SHREECEM', 'SHRIRAMFIN', 'SIEMENS', 'SRF', 'TATACHEM', 'TATACOMM', 'TATACONSUM',
    'TATAPOWER', 'TECHM', 'TRENT', 'TVSMOTOR', 'UBL', 'VEDL', 'VOLTAS', 'ZEEL'
];

const manualOverrides = {
    'LT': 'larsen-toubro-ltd',
    'POWERGRID': 'power-grid-corporation-of-india-ltd',
    'TATAMOTORS': 'tata-motors-ltd',
    'M&M': 'mahindra-mahindra-ltd',
    'MCDOWELL-N': 'united-spirits-ltd'
};

async function getSlug(sym) {
    if (manualOverrides[sym]) return manualOverrides[sym];

    return new Promise(resolve => {
        const url = 'https://groww.in/v1/api/search/v1/entity?app=false&query=' + encodeURIComponent(sym) + '&page=0&size=5';
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
            let b = '';
            res.on('data', c => b += c);
            res.on('end', () => {
                try {
                    const d = JSON.parse(b);
                    const item = d.content?.find(x => x.search_id && x.search_id.includes('-ltd'));
                    if (item) return resolve(item.search_id);
                    const anyItem = d.content?.find(x => x.search_id);
                    resolve(anyItem ? anyItem.search_id : sym.toLowerCase());
                } catch(e) {
                    resolve(sym.toLowerCase());
                }
            });
        }).on('error', () => resolve(sym.toLowerCase()));
    });
}

(async () => {
    const slugMap = {
        'NIFTY': { slug: 'nifty', type: 'INDICES' },
        'BANKNIFTY': { slug: 'nifty-bank', type: 'INDICES' },
        'FINNIFTY': { slug: 'nifty-financial-services', type: 'INDICES' },
        'MIDCPNIFTY': { slug: 'nifty-midcap-select', type: 'INDICES' }
    };

    console.log('Resolving slugs for all F&O stocks...');
    for (const sym of FO_STOCKS) {
        const slug = await getSlug(sym);
        slugMap[sym] = { slug: slug, type: 'STOCKS' };
        console.log(`  '${sym}': { slug: '${slug}', type: 'STOCKS' },`);
    }

    fs.writeFileSync('d:\\Code of Content\\destrade\\scratch\\slug_map.json', JSON.stringify(slugMap, null, 2));
    console.log('✅ Generated d:\\Code of Content\\destrade\\scratch\\slug_map.json');
})();
