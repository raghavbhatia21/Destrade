/**
 * Destrade Pro — Autonomous Cloud Market Worker
 * Polls market data & updates Firebase Realtime DB during trading hours (Mon-Fri 09:15 - 15:30 IST)
 */

const https = require('https');

const FIREBASE_HOST = 'destrade-default-rtdb.firebaseio.com';

const fs = require('fs');
const path = require('path');

const SLUG_MAP = {
    '360ONE': { slug: 'iifl-wealth-management-ltd-1568865430949', type: 'STOCKS' },
    'ABB': { slug: 'abb-india-ltd', type: 'STOCKS' },
    'ABCAPITAL': { slug: 'aditya-birla-capital-ltd', type: 'STOCKS' },
    'ADANIENSOL': { slug: 'adani-transmission-ltd', type: 'STOCKS' },
    'ADANIENT': { slug: 'adani-enterprises-ltd', type: 'STOCKS' },
    'ADANIGREEN': { slug: 'adani-green-energy-ltd', type: 'STOCKS' },
    'ADANIPORTS': { slug: 'adani-ports-and-special-economic-zone-ltd', type: 'STOCKS' },
    'ADANIPOWER': { slug: 'adani-power-ltd', type: 'STOCKS' },
    'ALKEM': { slug: 'alkem-laboratories-ltd', type: 'STOCKS' },
    'AMBER': { slug: 'amber-enterprises-india-ltd', type: 'STOCKS' },
    'AMBUJACEM': { slug: 'ambuja-cements-ltd', type: 'STOCKS' },
    'ANGELONE': { slug: 'angel-broking-ltd', type: 'STOCKS' },
    'APLAPOLLO': { slug: 'apl-apollo-tubes-ltd', type: 'STOCKS' },
    'APOLLOHOSP': { slug: 'apollo-hospitals-enterprise-ltd', type: 'STOCKS' },
    'ASHOKLEY': { slug: 'ashok-leyland-ltd', type: 'STOCKS' },
    'ASIANPAINT': { slug: 'asian-paints-ltd', type: 'STOCKS' },
    'ASTRAL': { slug: 'astral-poly-technik-ltd', type: 'STOCKS' },
    'AUBANK': { slug: 'au-small-finance-bank-ltd', type: 'STOCKS' },
    'AUROPHARMA': { slug: 'aurobindo-pharma-ltd', type: 'STOCKS' },
    'AXISBANK': { slug: 'axis-bank-ltd', type: 'STOCKS' },
    'BAJAJ-AUTO': { slug: 'bajaj-auto-ltd', type: 'STOCKS' },
    'BAJAJFINSV': { slug: 'bajaj-finserv-ltd', type: 'STOCKS' },
    'BAJAJHLDNG': { slug: 'bajaj-holdings-investment-ltd', type: 'STOCKS' },
    'BAJFINANCE': { slug: 'bajaj-finance-ltd', type: 'STOCKS' },
    'BANDHANBNK': { slug: 'bandhan-bank-ltd', type: 'STOCKS' },
    'BANKBARODA': { slug: 'bank-of-baroda', type: 'STOCKS' },
    'BANKINDIA': { slug: 'bank-of-india', type: 'STOCKS' },
    'BANKNIFTY': { slug: 'nifty-bank', type: 'INDICES' },
    'BDL': { slug: 'bharat-dynamics-ltd', type: 'STOCKS' },
    'BEL': { slug: 'bharat-electronics-ltd', type: 'STOCKS' },
    'BHARATFORG': { slug: 'bharat-forge-ltd', type: 'STOCKS' },
    'BHARTIARTL': { slug: 'bharti-airtel-ltd', type: 'STOCKS' },
    'BHEL': { slug: 'bharat-heavy-electricals-ltd', type: 'STOCKS' },
    'BIOCON': { slug: 'biocon-ltd', type: 'STOCKS' },
    'BLUESTARCO': { slug: 'blue-star-ltd', type: 'STOCKS' },
    'BOSCHLTD': { slug: 'bosch-ltd', type: 'STOCKS' },
    'BPCL': { slug: 'bharat-petroleum-corporation-ltd', type: 'STOCKS' },
    'BRITANNIA': { slug: 'britannia-industries-ltd', type: 'STOCKS' },
    'BSE': { slug: 'bse-ltd', type: 'STOCKS' },
    'CAMS': { slug: 'computer-age-management-services-ltd', type: 'STOCKS' },
    'CANBK': { slug: 'canara-bank', type: 'STOCKS' },
    'CDSL': { slug: 'central-depository-services-india-ltd', type: 'STOCKS' },
    'CGPOWER': { slug: 'cg-power-industrial-solutions-ltd', type: 'STOCKS' },
    'CHOLAFIN': { slug: 'cholamandalam-investment-finance-company-ltd', type: 'STOCKS' },
    'CIPLA': { slug: 'cipla-ltd', type: 'STOCKS' },
    'COALINDIA': { slug: 'coal-india-ltd', type: 'STOCKS' },
    'COCHINSHIP': { slug: 'cochin-shipyard-ltd', type: 'STOCKS' },
    'COFORGE': { slug: 'niit-technologies-ltd', type: 'STOCKS' },
    'COLPAL': { slug: 'colgatepalmolive-india-ltd', type: 'STOCKS' },
    'CONCOR': { slug: 'concord-biotech-ltd', type: 'STOCKS' },
    'CROMPTON': { slug: 'crompton-greaves-consumer-electricals-ltd', type: 'STOCKS' },
    'CUMMINSIND': { slug: 'cummins-india-ltd', type: 'STOCKS' },
    'DABUR': { slug: 'dabur-india-ltd', type: 'STOCKS' },
    'DALBHARAT': { slug: 'odisha-cement-ltd', type: 'STOCKS' },
    'DELHIVERY': { slug: 'delhivery-ltd', type: 'STOCKS' },
    'DIVISLAB': { slug: 'divis-laboratories-ltd', type: 'STOCKS' },
    'DIXON': { slug: 'dixon-technologies-india-ltd', type: 'STOCKS' },
    'DLF': { slug: 'dlf-ltd', type: 'STOCKS' },
    'DMART': { slug: 'avenue-supermarts-ltd', type: 'STOCKS' },
    'DRREDDY': { slug: 'dr-reddys-laboratories-ltd', type: 'STOCKS' },
    'EICHERMOT': { slug: 'eicher-motors-ltd', type: 'STOCKS' },
    'ETERNAL': { slug: 'zomato-ltd', type: 'STOCKS' },
    'EXIDEIND': { slug: 'exide-industries-ltd', type: 'STOCKS' },
    'FEDERALBNK': { slug: 'the-federal-bank-ltd', type: 'STOCKS' },
    'FINNIFTY': { slug: 'nifty-financial-services', type: 'INDICES' },
    'FORCEMOT': { slug: 'force-motors-ltd', type: 'STOCKS' },
    'FORTIS': { slug: 'fortis-healthcare-ltd', type: 'STOCKS' },
    'GAIL': { slug: 'gail-india-ltd', type: 'STOCKS' },
    'GLENMARK': { slug: 'glenmark-pharmaceuticals-ltd', type: 'STOCKS' },
    'GMRAIRPORT': { slug: 'gmr-infrastructure-ltd', type: 'STOCKS' },
    'GODFRYPHLP': { slug: 'godfrey-phillips-india-ltd', type: 'STOCKS' },
    'GODREJCP': { slug: 'godrej-consumer-products-ltd', type: 'STOCKS' },
    'GODREJPROP': { slug: 'godrej-properties-ltd', type: 'STOCKS' },
    'GRASIM': { slug: 'grasim-industries-ltd', type: 'STOCKS' },
    'HAL': { slug: 'hindustan-aeronautics-ltd', type: 'STOCKS' },
    'HAVELLS': { slug: 'havells-india-ltd', type: 'STOCKS' },
    'HCLTECH': { slug: 'hcl-technologies-ltd', type: 'STOCKS' },
    'HDFCAMC': { slug: 'hdfc-asset-management-company-ltd', type: 'STOCKS' },
    'HDFCBANK': { slug: 'hdfc-bank-ltd', type: 'STOCKS' },
    'HDFCLIFE': { slug: 'hdfc-standard-life-insurance-co-ltd', type: 'STOCKS' },
    'HEROMOTOCO': { slug: 'hero-motocorp-ltd', type: 'STOCKS' },
    'HINDALCO': { slug: 'hindalco-industries-ltd', type: 'STOCKS' },
    'HINDPETRO': { slug: 'hindustan-petroleum-corporation-ltd', type: 'STOCKS' },
    'HINDUNILVR': { slug: 'hindustan-unilever-ltd', type: 'STOCKS' },
    'HINDZINC': { slug: 'hindustan-zinc-ltd', type: 'STOCKS' },
    'HUDCO': { slug: 'housing-urban-development-corporation-ltd', type: 'STOCKS' },
    'HYUNDAI': { slug: 'hyundai-motor-india-ltd', type: 'STOCKS' },
    'ICICIBANK': { slug: 'icici-bank-ltd', type: 'STOCKS' },
    'ICICIGI': { slug: 'icici-lombard-general-insurance-co-ltd', type: 'STOCKS' },
    'ICICIPRULI': { slug: 'icici-prudential-life-insurance-company-ltd', type: 'STOCKS' },
    'IDEA': { slug: 'vodafone-idea-ltd', type: 'STOCKS' },
    'IDFCFIRSTB': { slug: 'idfc-bank-ltd', type: 'STOCKS' },
    'IEX': { slug: 'indian-energy-exchange-ltd', type: 'STOCKS' },
    'INDHOTEL': { slug: 'the-indian-hotels-company-ltd', type: 'STOCKS' },
    'INDIANB': { slug: 'indian-bank', type: 'STOCKS' },
    'INDIGO': { slug: 'interglobe-aviation-ltd', type: 'STOCKS' },
    'INDUSINDBK': { slug: 'indusind-bank-ltd', type: 'STOCKS' },
    'INDUSTOWER': { slug: 'bharti-infratel-ltd', type: 'STOCKS' },
    'INFY': { slug: 'infosys-ltd', type: 'STOCKS' },
    'INOXWIND': { slug: 'inox-wind-ltd', type: 'STOCKS' },
    'IOC': { slug: 'indian-oil-corporation-ltd', type: 'STOCKS' },
    'IREDA': { slug: 'indian-renewable-energy-development-agency-ltd-1569588972606', type: 'STOCKS' },
    'IRFC': { slug: 'indian-railway-finance-corporation-ltd', type: 'STOCKS' },
    'ITC': { slug: 'itc-ltd', type: 'STOCKS' },
    'JINDALSTEL': { slug: 'jindal-steel-power-ltd', type: 'STOCKS' },
    'JIOFIN': { slug: 'jio-financial-services-ltd', type: 'STOCKS' },
    'JSWENERGY': { slug: 'jsw-energy-ltd', type: 'STOCKS' },
    'JSWSTEEL': { slug: 'jsw-steel-ltd', type: 'STOCKS' },
    'JUBLFOOD': { slug: 'jubilant-foodworks-ltd', type: 'STOCKS' },
    'KALYANKJIL': { slug: 'kalyan-jewellers-india-ltd', type: 'STOCKS' },
    'KAYNES': { slug: 'kaynes-technology-india-ltd', type: 'STOCKS' },
    'KEI': { slug: 'kei-industries-ltd', type: 'STOCKS' },
    'KFINTECH': { slug: 'kfin-technologies-ltd', type: 'STOCKS' },
    'KOTAKBANK': { slug: 'kotak-mahindra-bank-ltd', type: 'STOCKS' },
    'KPITTECH': { slug: 'kpit-engineering-ltd', type: 'STOCKS' },
    'LAURUSLABS': { slug: 'laurus-labs-ltd', type: 'STOCKS' },
    'LICHSGFIN': { slug: 'lic-housing-finance-ltd', type: 'STOCKS' },
    'LICI': { slug: 'life-insurance-corporation-of-india', type: 'STOCKS' },
    'LODHA': { slug: 'lodha-developers-ltd', type: 'STOCKS' },
    'LT': { slug: 'larsen-toubro-ltd', type: 'STOCKS' },
    'LTF': { slug: 'lt-finance-holdings-ltd', type: 'STOCKS' },
    'LTM': { slug: 'larsen-toubro-infotech-ltd', type: 'STOCKS' },
    'LUPIN': { slug: 'lupin-ltd', type: 'STOCKS' },
    'M&M': { slug: 'mahindra-mahindra-ltd', type: 'STOCKS' },
    'MANAPPURAM': { slug: 'manappuram-finance-ltd', type: 'STOCKS' },
    'MANKIND': { slug: 'mankind-pharma-ltd', type: 'STOCKS' },
    'MARICO': { slug: 'marico-ltd', type: 'STOCKS' },
    'MARUTI': { slug: 'maruti-suzuki-india-ltd', type: 'STOCKS' },
    'MAXHEALTH': { slug: 'max-healthcare-institute-ltd', type: 'STOCKS' },
    'MAZDOCK': { slug: 'mazagon-dock-shipbuilders-ltd', type: 'STOCKS' },
    'MCX': { slug: 'multi-commodity-exchange-of-india-ltd', type: 'STOCKS' },
    'MFSL': { slug: 'max-financial-services-ltd', type: 'STOCKS' },
    'MIDCPNIFTY': { slug: 'nifty-midcap-select', type: 'INDICES' },
    'MOTHERSON': { slug: 'motherson-sumi-systems-ltd', type: 'STOCKS' },
    'MOTILALOFS': { slug: 'motilal-oswal-financial-services-ltd', type: 'STOCKS' },
    'MPHASIS': { slug: 'mphasis-ltd', type: 'STOCKS' },
    'MUTHOOTFIN': { slug: 'muthoot-finance-ltd', type: 'STOCKS' },
    'NAM-INDIA': { slug: 'reliance-nippon-life-asset-management-ltd', type: 'STOCKS' },
    'NATIONALUM': { slug: 'national-aluminium-company-ltd', type: 'STOCKS' },
    'NAUKRI': { slug: 'info-edge-india-ltd', type: 'STOCKS' },
    'NBCC': { slug: 'nbcc-india-ltd', type: 'STOCKS' },
    'NESTLEIND': { slug: 'nestle-india-ltd', type: 'STOCKS' },
    'NHPC': { slug: 'nhpc-ltd', type: 'STOCKS' },
    'NIFTY': { slug: 'nifty', type: 'INDICES' },
    'NMDC': { slug: 'nmdc-ltd', type: 'STOCKS' },
    'NTPC': { slug: 'ntpc-ltd', type: 'STOCKS' },
    'NUVAMA': { slug: 'nuvama-wealth-management-ltd', type: 'STOCKS' },
    'NYKAA': { slug: 'fsn-ecommerce-ventures-ltd', type: 'STOCKS' },
    'OBEROIRLTY': { slug: 'oberoi-realty-ltd', type: 'STOCKS' },
    'OFSS': { slug: 'oracle-financial-services-software-ltd', type: 'STOCKS' },
    'OIL': { slug: 'indian-oil-corporation-ltd', type: 'STOCKS' },
    'ONGC': { slug: 'oil-natural-gas-corporation-ltd', type: 'STOCKS' },
    'PAGEIND': { slug: 'page-industries-ltd', type: 'STOCKS' },
    'PATANJALI': { slug: 'ruchi-soya-industries-ltd', type: 'STOCKS' },
    'PAYTM': { slug: 'one-communications-ltd', type: 'STOCKS' },
    'PERSISTENT': { slug: 'persistent-systems-ltd', type: 'STOCKS' },
    'PETRONET': { slug: 'petronet-lng-ltd', type: 'STOCKS' },
    'PFC': { slug: 'power-finance-corporation-ltd', type: 'STOCKS' },
    'PGEL': { slug: 'pg-electroplast-ltd', type: 'STOCKS' },
    'PHOENIXLTD': { slug: 'phoenix-mills-ltd', type: 'STOCKS' },
    'PIDILITIND': { slug: 'pidilite-industries-ltd', type: 'STOCKS' },
    'PIIND': { slug: 'pi-industries-ltd', type: 'STOCKS' },
    'PNB': { slug: 'pnb-housing-finance-ltd', type: 'STOCKS' },
    'PNBHOUSING': { slug: 'pnb-housing-finance-ltd', type: 'STOCKS' },
    'POLICYBZR': { slug: 'pb-fintech-ltd', type: 'STOCKS' },
    'POLYCAB': { slug: 'polycab-india-ltd', type: 'STOCKS' },
    'POWERGRID': { slug: 'power-grid-corporation-of-india-ltd', type: 'STOCKS' },
    'POWERINDIA': { slug: 'abb-power-products-systems-india-ltd', type: 'STOCKS' },
    'PPLPHARMA': { slug: 'piramal-pharma-ltd', type: 'STOCKS' },
    'PREMIERENE': { slug: 'premier-energies-ltd', type: 'STOCKS' },
    'PRESTIGE': { slug: 'prestige-estate-projects-ltd', type: 'STOCKS' },
    'RBLBANK': { slug: 'rbl-bank-ltd', type: 'STOCKS' },
    'RECLTD': { slug: 'rec-ltd', type: 'STOCKS' },
    'RELIANCE': { slug: 'reliance-industries-ltd', type: 'STOCKS' },
    'RVNL': { slug: 'rail-vikas-nigam-ltd', type: 'STOCKS' },
    'SAIL': { slug: 'steel-authority-of-india-ltd', type: 'STOCKS' },
    'SAMMAANCAP': { slug: 'indiabulls-housing-finance-ltd', type: 'STOCKS' },
    'SBICARD': { slug: 'sbi-cards-payment-services-ltd', type: 'STOCKS' },
    'SBILIFE': { slug: 'sbi-life-insurance-company-ltd', type: 'STOCKS' },
    'SBIN': { slug: 'state-bank-of-india', type: 'STOCKS' },
    'SHREECEM': { slug: 'shree-cement-ltd', type: 'STOCKS' },
    'SHRIRAMFIN': { slug: 'shriram-transport-finance-company-ltd', type: 'STOCKS' },
    'SIEMENS': { slug: 'siemens-ltd', type: 'STOCKS' },
    'SOLARINDS': { slug: 'solar-industries-india-ltd', type: 'STOCKS' },
    'SONACOMS': { slug: 'sona-blw-precision-forgings-ltd', type: 'STOCKS' },
    'SRF': { slug: 'srf-ltd', type: 'STOCKS' },
    'SUNPHARMA': { slug: 'sun-pharmaceutical-industries-ltd', type: 'STOCKS' },
    'SUPREMEIND': { slug: 'supreme-industries-ltd', type: 'STOCKS' },
    'SUZLON': { slug: 'suzlon-energy-ltd', type: 'STOCKS' },
    'SWIGGY': { slug: 'swiggy-ltd', type: 'STOCKS' },
    'TATACONSUM': { slug: 'tata-global-beverages-ltd', type: 'STOCKS' },
    'TATAELXSI': { slug: 'tata-elxsi-ltd', type: 'STOCKS' },
    'TATAPOWER': { slug: 'tata-power-company-ltd', type: 'STOCKS' },
    'TATASTEEL': { slug: 'tata-steel-ltd', type: 'STOCKS' },
    'TATATECH': { slug: 'tata-technologies-ltd', type: 'STOCKS' },
    'TCS': { slug: 'tata-consultancy-services-ltd', type: 'STOCKS' },
    'TECHM': { slug: 'tech-mahindra-ltd', type: 'STOCKS' },
    'TIINDIA': { slug: 'tube-investments-of-india-ltd', type: 'STOCKS' },
    'TITAN': { slug: 'titan-company-ltd', type: 'STOCKS' },
    'TMPV': { slug: 'tata-motors-ltd', type: 'STOCKS' },
    'TORNTPHARM': { slug: 'torrent-pharmaceuticals-ltd', type: 'STOCKS' },
    'TORNTPOWER': { slug: 'torrent-power-ltd', type: 'STOCKS' },
    'TRENT': { slug: 'trent-ltd', type: 'STOCKS' },
    'TVSMOTOR': { slug: 'tvs-motor-company-ltd', type: 'STOCKS' },
    'ULTRACEMCO': { slug: 'ultratech-cement-ltd', type: 'STOCKS' },
    'UNIONBANK': { slug: 'union-bank-of-india', type: 'STOCKS' },
    'UNITDSPR': { slug: 'united-spirits-ltd', type: 'STOCKS' },
    'UNOMINDA': { slug: 'minda-industries-ltd', type: 'STOCKS' },
    'UPL': { slug: 'upl-ltd', type: 'STOCKS' },
    'VBL': { slug: 'varun-beverages-ltd', type: 'STOCKS' },
    'VEDL': { slug: 'vedanta-ltd', type: 'STOCKS' },
    'VMM': { slug: 'vishal-mega-mart-ltd', type: 'STOCKS' },
    'VOLTAS': { slug: 'voltas-ltd', type: 'STOCKS' },
    'WAAREEENER': { slug: 'waaree-energies-ltd', type: 'STOCKS' },
    'WIPRO': { slug: 'wipro-ltd', type: 'STOCKS' },
    'YESBANK': { slug: 'yes-bank-ltd', type: 'STOCKS' },
    'ZYDUSLIFE': { slug: 'cadila-healthcare-ltd', type: 'STOCKS' },
    'NIFTYNXT50': { slug: 'nifty-next-50', type: 'INDICES' }
};

const SYMBOLS = Object.keys(SLUG_MAP);

function getISTDate() {
    const d = new Date();
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    return new Date(utc + (5.5 * 60 * 60 * 1000));
}

function getISTDateStr(d) {
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function fetchUrl(url) {
    return new Promise((resolve) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Referer': 'https://groww.in/'
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    });
}

function firebaseGet(path) {
    return new Promise((resolve) => {
        https.get(`https://${FIREBASE_HOST}${path}`, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

function firebasePut(path, data) {
    return new Promise((resolve) => {
        const payload = JSON.stringify(data);
        const req = https.request({
            hostname: FIREBASE_HOST,
            path: path,
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve(res.statusCode === 200));
        });
        req.on('error', () => resolve(false));
        req.write(payload);
        req.end();
    });
}

async function fetchSpotPrice(symbol, isIndex) {
    const ep = isIndex 
        ? `https://groww.in/v1/api/stocks_data/v1/tr_live_indices/exchange/NSE/segment/CASH/${symbol}/latest`
        : `https://groww.in/v1/api/stocks_data/v1/tr_live_prices/exchange/NSE/segment/CASH/${symbol}/latest`;
    const d = await fetchUrl(ep);
    return d ? (d.ltp || d.value || 0) : 0;
}

async function fetchOptionChainPCR(symbol) {
    const info = SLUG_MAP[symbol] || { slug: symbol.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-ltd', type: 'STOCKS' };
    const url = `https://groww.in/v1/api/option_chain_service/v1/option_chain/${info.slug}?type=${info.type}`;
    
    const d = await fetchUrl(url);
    if (!d || !d.optionChain) return null;

    const oc = d.optionChain;
    let totalCE = 0, totalPE = 0;
    let spot = oc.underlyingValue || oc.lastPrice || 0;

    if (spot === 0) {
        spot = await fetchSpotPrice(symbol, info.type === 'INDICES');
    }

    if (oc.optionChains && Array.isArray(oc.optionChains)) {
        oc.optionChains.forEach(row => {
            if (row.callOption) totalCE += (row.callOption.openInterest || 0);
            if (row.putOption) totalPE += (row.putOption.openInterest || 0);
        });
    }

    if (totalCE === 0) return null;
    const pcr = parseFloat((totalPE / totalCE).toFixed(2));
    return { pcr, spot };
}

async function runCloudWorker() {
    const ist = getISTDate();
    const day = ist.getDay();
    const hour = ist.getHours();
    const min = ist.getMinutes();
    const totalMin = (hour * 60) + min;

    const dateStr = getISTDateStr(ist);
    const timeStr = ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    console.log(`⏱️ [Cloud Worker] IST Time: ${dateStr} ${timeStr} (Day: ${day})`);

    // Check if Weekend (0 = Sun, 6 = Sat)
    if (day === 0 || day === 6) {
        console.log('🌴 Market Closed (Weekend). Cloud Worker skipping update.');
        await firebasePut('/cron_status.json', {
            lastRun: ist.toISOString(),
            status: 'Market Closed (Weekend)',
            dateStr: dateStr
        });
        return;
    }

    // Check Market Hours (09:10 AM to 03:40 PM IST)
    const marketStart = (9 * 60) + 10;
    const marketEnd = (15 * 60) + 40;

    if (totalMin < marketStart || totalMin > marketEnd) {
        console.log('🌙 Outside Market Hours (09:15 - 15:30 IST). Cloud Worker skipping update.');
        await firebasePut('/cron_status.json', {
            lastRun: ist.toISOString(),
            status: 'Outside Market Hours',
            dateStr: dateStr
        });
        return;
    }

    console.log(`⚡ Market Live! Fetching PCR data for ${SYMBOLS.length} symbols...`);

    const summary = {};
    const batchSize = 10;

    for (let i = 0; i < SYMBOLS.length; i += batchSize) {
        const batch = SYMBOLS.slice(i, i + batchSize);
        await Promise.all(batch.map(async sym => {
            try {
                const data = await fetchOptionChainPCR(sym);
                if (data && data.pcr > 0) {
                    summary[sym] = data;

                    const path = `/pcr_history/${sym}/${dateStr}.json`;
                    const existing = await firebaseGet(path);
                    const list = Array.isArray(existing) ? existing : (existing ? Object.values(existing) : []);

                    const nowSec = Math.floor(Date.now() / 1000);
                    const lastEntry = list[list.length - 1];
                    if (!lastEntry || (nowSec - lastEntry.time) >= 300) {
                        list.push({
                            time: nowSec,
                            timeStr: timeStr,
                            value: data.pcr,
                            spot: data.spot
                        });

                        await firebasePut(path, list.slice(-150));
                        console.log(`  ✅ ${sym}: PCR ${data.pcr} (Spot: ₹${data.spot}) saved!`);
                    }
                }
            } catch (err) {}
        }));
    }

    await firebasePut('/cron_status.json', {
        lastRun: ist.toISOString(),
        status: 'Active (Live Market Sync)',
        dateStr: dateStr,
        symbolsSynced: Object.keys(summary).length,
        summary: summary
    });

    console.log(`🎉 Cloud Worker Pass Completed! Synced ${Object.keys(summary).length}/${SYMBOLS.length} symbols!`);
}

async function startAutonomousWorker() {
    console.log('🚀 Autonomous Cloud Market Worker Started!');
    const startTime = Date.now();
    const DURATION_MS = 4.5 * 60 * 1000; // 4.5 minutes continuous loop per job run

    let pass = 0;
    while (Date.now() - startTime < DURATION_MS) {
        pass++;
        console.log(`\n⏱️ --- Starting Continuous Market Sync Pass #${pass} ---`);
        try {
            await runCloudWorker();
        } catch (e) {
            console.error('Market sync error:', e.message);
        }

        const elapsed = Date.now() - startTime;
        if (elapsed < DURATION_MS - 60000) {
            console.log('⏳ Waiting 60 seconds for next live tick pass...');
            await new Promise(r => setTimeout(r, 60000));
        } else {
            break;
        }
    }
    console.log('\n🏁 4.5-Minute Continuous Execution Complete. Exiting cleanly.');
}

startAutonomousWorker().catch(console.error);

