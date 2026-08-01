const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const NSE_HOST = 'www.nseindia.com';
let cookies = "";

function getReferer(path) {
    if (path.includes('option-chain')) return 'https://www.nseindia.com/option-chain';
    if (path.includes('stockIndices') || path.includes('stock-indices') || path.includes('live-analysis') || path.includes('underlying')) return 'https://www.nseindia.com/market-data/live-equity-market';
    return 'https://www.nseindia.com/';
}

async function initSession() {
    return new Promise((resolve) => {
        const req = https.request({
            hostname: NSE_HOST, path: '/', method: 'GET',
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' }
        }, (res) => {
            const newCookies = res.headers['set-cookie'];
            if (newCookies) cookies = newCookies.map(c => c.split(';')[0]).join('; ');
            res.on('data', () => {});
            res.on('end', () => resolve(true));
        });
        req.on('error', () => resolve(false));
        req.end();
    });
}

const server = http.createServer(async (req, res) => {
    // 1. Static File Serving Logic
    const urlPath = req.url.split('?')[0];
    const filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);
    
    if (fs.existsSync(filePath) && fs.lstatSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.wav': 'audio/wav',
            '.mp4': 'video/mp4',
            '.woff': 'application/font-woff',
            '.ttf': 'application/font-ttf',
            '.eot': 'application/vnd.ms-fontobject',
            '.otf': 'application/font-otf',
            '.wasm': 'application/wasm'
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
        return;
    }

    // 2. Proxy Logic (Existing)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    let targetPath = req.url;
    let targetHost = 'www.nseindia.com';
    let targetHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest'
    };

    if (targetPath.includes('/groww/')) {
        targetHost = 'groww.in';
        targetPath = targetPath.substring(targetPath.indexOf('/groww') + 6); 
    } else {
        if (targetPath === '/api/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', environment: 'local-dev' }));
            return;
        }

        // Zerodha SPAN Calculator Proxy
        if (targetPath.startsWith('/api/zerodha-margin')) {
            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => {
                    body += chunk.toString();
                });
                req.on('end', () => {
                    const postReq = https.request({
                        hostname: 'zerodha.com',
                        path: '/margin-calculator/SPAN/',
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Content-Length': Buffer.byteLength(body),
                            'User-Agent': 'Mozilla/5.0'
                        }
                    }, (postRes) => {
                        res.writeHead(postRes.statusCode, { 'Content-Type': 'application/json' });
                        postRes.pipe(res);
                    });
                    postReq.on('error', (e) => {
                        res.writeHead(500);
                        res.end(JSON.stringify({ error: e.message }));
                    });
                    postReq.write(body);
                    postReq.end();
                });
                return;
            }
        }

        if (!cookies) await initSession();
        targetHeaders['Referer'] = getReferer(targetPath);
        targetHeaders['Cookie'] = cookies;
    }

    const options = {
        hostname: targetHost, path: targetPath, method: 'GET',
        headers: targetHeaders
    };

    const targetReq = https.request(options, (targetRes) => {
        const newCookies = targetRes.headers['set-cookie'];
        if (newCookies) cookies = newCookies.map(c => c.split(';')[0]).join('; ');
        
        res.writeHead(targetRes.statusCode, { 'Content-Type': 'application/json' });
        targetRes.pipe(res);
    });

    targetReq.on('error', (e) => {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
    });
    targetReq.end();
});

server.listen(PORT, () => {
    console.log(`\x1b[32m[DESTRADE PRO]\x1b[0m Local Proxy & Server running at http://localhost:${PORT}`);
    console.log(`\x1b[33m[READY]\x1b[0m Dashboard: http://localhost:${PORT}/index.html`);
});
