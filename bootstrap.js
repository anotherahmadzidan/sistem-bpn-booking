const safePool = require('./dbPool');

// Sejumlah modul lama mengimpor config/db secara langsung. Pasang pool yang
// dibatasi sebelum server dan controller dimuat agar semuanya berbagi pool ini.
const legacyDbPath = require.resolve('./config/db');
require.cache[legacyDbPath] = {
    id: legacyDbPath,
    filename: legacyDbPath,
    loaded: true,
    exports: safePool
};

const adminController = require('./controllers/adminController');
require('./adminPetugasOverrides').install(adminController);

require('./server');
