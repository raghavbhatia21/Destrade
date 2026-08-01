const https = require('https');

function testFirebaseREST() {
    const data = JSON.stringify({
        test_cron: true,
        timestamp: new Date().toISOString()
    });

    const options = {
        hostname: 'destrade-default-rtdb.firebaseio.com',
        path: '/cron_status.json',
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };

    const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            console.log(`Firebase REST Test Status: ${res.statusCode}`);
            console.log(`Firebase Response: ${body}`);
        });
    });

    req.on('error', (err) => {
        console.error('Firebase REST Error:', err.message);
    });

    req.write(data);
    req.end();
}

testFirebaseREST();
