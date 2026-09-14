const {randomInt} = require('node:crypto');
// One independent winning ticket out of 10,000 = 0.01% per awarded Pokémon.
function rollShiny() { return randomInt(10000) === 0; }
module.exports = {rollShiny};
