const fs = require('fs');
const path = 'd:\\Code of Content\\destrade-mobile\\www\\js\\nse-api.js';
const buf = fs.readFileSync(path);

// Check first 10 bytes for BOM or hidden chars
console.log('First 20 bytes hex:', buf.slice(0, 20).toString('hex'));
console.log('First 20 bytes text:', buf.slice(0, 20).toString('utf8'));

// Check around line 588
const content = buf.toString('utf8');
const lines = content.split('\n');
console.log('\nLine 587:', JSON.stringify(lines[586]));
console.log('Line 588:', JSON.stringify(lines[587]));
console.log('Line 589:', JSON.stringify(lines[588]));

// Check for any non-ASCII characters in the entire file
for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
        const code = line.charCodeAt(j);
        if (code > 127 && code !== 8212 && code !== 8216 && code !== 8217) {
            console.log(`Non-ASCII at line ${i+1}, col ${j+1}: char=${line[j]} code=${code}`);
        }
    }
}

// Check for any \r\n vs \n issues
const crlfCount = (content.match(/\r\n/g) || []).length;
const lfCount = (content.match(/(?<!\r)\n/g) || []).length;
console.log(`\nLine endings: CRLF=${crlfCount}, LF-only=${lfCount}`);

// Try eval just the class to see if it fails
try {
    new Function(content);
    console.log('\nFunction() constructor: PASS');
} catch(e) {
    console.log(`\nFunction() constructor: FAIL at ${e.message}`);
}
