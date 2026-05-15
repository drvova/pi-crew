const fs = require('fs');
let c = fs.readFileSync('src/utils/visual.ts', 'utf8');
c = c.replace(/\r\n/g, '\n');

// Simply remove the overly broad 0x2600-0x27BF range.
// Most chars in that range (✓✗★☆✦✧⚡ etc) are narrow (1 col) in modern terminals.
// Real emoji are covered by 0x1F300+ ranges and variation selectors (0xFE00-0xFE0F).
// The 0x2702-0x27B0 range is redundant with removal and was already overlapping.

// Remove [0x2600, 0x27BF] line
c = c.replace(/\t\[0x2600, 0x27BF\],  \/\/ Miscellaneous Symbols \+ Dingbats \(includes ✅\)\n/, '');

// Remove [0x2702, 0x27B0] line (was redundant and also wrong)
c = c.replace(/\t\[0x2702, 0x27B0\],   \/\/ Dingbats\n/, '');

fs.writeFileSync('src/utils/visual.ts', c);
console.log('Removed overly broad 0x2600-0x27BF and 0x2702-0x27B0 ranges from isWideCodePoint');
