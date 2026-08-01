const https = require('https');
const fs = require('fs');
const path = require('path');

function download(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    console.log(`✅ Downloaded: ${dest} (${fs.statSync(dest).size} bytes)`);
                    resolve();
                });
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
}

async function run() {
    const pcLib = path.join(__dirname, '..', 'js', 'lib');
    const mobLib = path.join(__dirname, '..', '..', 'destrade-mobile', 'www', 'js', 'lib');

    fs.mkdirSync(pcLib, { recursive: true });
    fs.mkdirSync(mobLib, { recursive: true });

    const appUrl = 'https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js';
    const dbUrl = 'https://www.gstatic.com/firebasejs/8.10.1/firebase-database.js';

    console.log('Downloading Firebase JS SDKs...');
    await download(appUrl, path.join(pcLib, 'firebase-app.js'));
    await download(dbUrl, path.join(pcLib, 'firebase-database.js'));

    fs.copyFileSync(path.join(pcLib, 'firebase-app.js'), path.join(mobLib, 'firebase-app.js'));
    fs.copyFileSync(path.join(pcLib, 'firebase-database.js'), path.join(mobLib, 'firebase-database.js'));

    console.log('🎉 Firebase SDKs bundled locally in js/lib!');
}

run().catch(console.error);
