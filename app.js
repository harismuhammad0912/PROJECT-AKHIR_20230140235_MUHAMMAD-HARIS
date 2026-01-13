const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({ 
    secret: 'vortex_secret_key', 
    resave: false, 
    saveUninitialized: true 
}));

// === KONEKSI DATABASE ===
const db = mysql.createConnection({
    host: 'localhost',
    port: 3306,           // Port Temanmu
    user: 'root',
    password: 'haris0912', // Password Temanmu
    database: 'vortex_games'
});

db.connect((err) => {
    if (err) console.error('❌ Database Error:', err.message);
    else {
        console.log('✅ Connected to VortexGames Database!');
        logSystem('SERVER_START', 'Server online on port ' + PORT); // Log otomatis saat nyala
    }
});

// === FUNGSI PENCATAT LOG (HELPER) ===
function logSystem(action, details) {
    const sql = "INSERT INTO system_logs (action, details) VALUES (?, ?)";
    db.query(sql, [action, details], (err) => {
        if(err) console.error("Gagal mencatat log:", err);
    });
}

// === MIDDLEWARE ===
const checkAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') next();
    else res.status(403).json({ message: '⛔ Admin Only' });
};

const cekApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ message: '⚠️ Butuh API Key' });
    db.query('SELECT * FROM api_keys WHERE api_key = ?', [apiKey], (err, result) => {
        if (result.length > 0) next();
        else res.status(403).json({ message: '⚠️ API Key Invalid' });
    });
};

// === AUTHENTICATION ===
app.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    db.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, results) => {
        if (results.length > 0) {
            req.session.user = results[0];
            logSystem('LOGIN_SUCCESS', `User ${username} logged in`); // <--- CATAT LOG
            res.json({ success: true, role: results[0].role });
        } else {
            logSystem('LOGIN_FAIL', `Failed login attempt for ${username}`); // <--- CATAT LOG
            res.json({ success: false, message: 'Username/Password Salah!' });
        }
    });
});

app.get('/auth/me', (req, res) => {
    if (req.session.user) res.json({ loggedIn: true, user: req.session.user });
    else res.json({ loggedIn: false });
});

app.get('/auth/logout', (req, res) => {
    if(req.session.user) logSystem('LOGOUT', `User ${req.session.user.username} logged out`);
    req.session.destroy();
    res.json({ success: true });
});

// === API KEYS ===
app.get('/api/my-keys', (req, res) => {
    if (!req.session.user) return res.status(401).json([]);
    db.query('SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC', [req.session.user.id], (e, r) => res.json(r));
});

app.post('/api/create-key', (req, res) => {
    if (!req.session.user) return res.status(401).json({ message: 'Login dulu' });
    const newKey = 'vtx-' + uuidv4().slice(0, 8); 
    db.query('INSERT INTO api_keys (user_id, key_label, api_key) VALUES (?, ?, ?)', 
        [req.session.user.id, req.body.label, newKey], () => {
            logSystem('KEY_GENERATE', `User ${req.session.user.username} created key: ${req.body.label}`);
            res.json({ success: true });
        });
});

app.delete('/api/revoke-key/:id', (req, res) => {
    if (!req.session.user) return res.status(401).json({ message: 'Login dulu' });
    db.query('DELETE FROM api_keys WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id], () => {
        logSystem('KEY_REVOKE', `User ${req.session.user.username} revoked a key`);
        res.json({ success: true });
    });
});

// === PUBLIC API ===
app.get('/api/v1/games', cekApiKey, (req, res) => {
    db.query('SELECT * FROM games', (err, results) => {
        res.json({ meta: { platform: 'VortexGames API', total: results.length }, data: results });
    });
});
app.get('/api/v1/games/search', cekApiKey, (req, res) => {
    const q = req.query.q;
    db.query("SELECT * FROM games WHERE title LIKE ?", [`%${q}%`], (err, results) => {
        res.json({ meta: { query: q }, data: results });
    });
});

// === ADMIN CMS (STATS, USERS, LOGS) ===
app.get('/api/admin/stats', checkAdmin, (req, res) => {
    db.query("SELECT COUNT(*) as u FROM users WHERE role='user'", (e1, r1) => {
        db.query("SELECT COUNT(*) as k FROM api_keys", (e2, r2) => {
            db.query("SELECT COUNT(*) as g FROM games", (e3, r3) => {
                res.json({ users: r1[0].u, keys: r2[0].k, games: r3[0].g });
            });
        });
    });
});

// 1. ENDPOINT GAMES
app.get('/api/admin/games', checkAdmin, (req, res) => {
    db.query('SELECT * FROM games ORDER BY id DESC', (e, r) => res.json(r));
});
app.post('/api/admin/games', checkAdmin, (req, res) => {
    const { title, developer, platform, price, rating } = req.body;
    db.query('INSERT INTO games (title, developer, platform, price, rating) VALUES (?,?,?,?,?)', 
        [title, developer, platform, price, rating], () => {
            logSystem('GAME_ADD', `Admin added game: ${title}`);
            res.json({ success: true });
        });
});

app.put('/api/admin/games/:id', checkAdmin, (req, res) => {
    const { title, developer, platform, price, rating } = req.body;
    const id = req.params.id;
    
    const sql = 'UPDATE games SET title=?, developer=?, platform=?, price=?, rating=? WHERE id=?';
    
    db.query(sql, [title, developer, platform, price, rating, id], (err) => {
        if(err) return res.status(500).json({message: err.message});
        
        // Catat ke log sistem
        logSystem('GAME_EDIT', `Admin updated game ID: ${id}`);
        res.json({ success: true });
    });
});

app.delete('/api/admin/games/:id', checkAdmin, (req, res) => {
    db.query('DELETE FROM games WHERE id = ?', [req.params.id], () => {
        logSystem('GAME_DELETE', `Admin deleted game ID: ${req.params.id}`);
        res.json({ success: true });
    });
});

// 2. ENDPOINT USERS (BARU)
app.get('/api/admin/users', checkAdmin, (req, res) => {
    db.query("SELECT id, username, role, created_at FROM users WHERE role='user'", (e, r) => res.json(r));
});
app.delete('/api/admin/users/:id', checkAdmin, (req, res) => {
    const id = req.params.id;
    db.query('DELETE FROM users WHERE id = ?', [id], () => {
        logSystem('USER_BAN', `Admin banned user ID: ${id}`);
        res.json({ success: true });
    });
});

// 3. ENDPOINT LOGS (BARU)
app.get('/api/admin/logs', checkAdmin, (req, res) => {
    // Ambil 50 log terakhir
    db.query('SELECT * FROM system_logs ORDER BY id DESC LIMIT 50', (e, r) => res.json(r));
});

// START
app.listen(PORT, () => console.log(`🚀 VortexGames Server Running on http://localhost:${PORT}`));