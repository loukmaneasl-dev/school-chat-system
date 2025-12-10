
const express = require('express');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const xlsx = require('xlsx');
const fs = require('fs');
const crypto = require('crypto');

// --- LICENSE CONFIGURATION ---
const EXPIRY_DATE = "2099-12-31"; 
const DEV_RESET_CODE = "DEV-2024-RESET"; // كود المطور لتصفير العداد
// -----------------------------

const app = express();
const DEFAULT_PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// License Check
app.use((req, res, next) => {
    const today = new Date();
    const expiry = new Date(EXPIRY_DATE);
    if (today > expiry) {
        return res.status(402).send(`
            <div style="font-family:sans-serif;text-align:center;padding:50px;direction:rtl">
                <h1>انتهت صلاحية النسخة التجريبية</h1>
                <p>يرجى التواصل مع المطور لتفعيل النسخة الكاملة.</p>
            </div>
        `);
    }
    next();
});

// Folders
const folders = ['uploads', 'uploads/excel', 'uploads/lessons', 'public'];
folders.forEach(folder => {
    const dirPath = path.join(__dirname, folder);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
});

// Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + file.originalname)
});
const upload = multer({ storage });

const excelStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads/excel')),
    filename: (req, file, cb) => cb(null, Date.now() + '.xlsx')
});
const uploadExcel = multer({ storage: excelStorage });

const lessonStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads/lessons')),
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, unique + ext);
    }
});
const uploadLesson = multer({ storage: lessonStorage });

// Database
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) console.error('DB Error:', err.message);
    else console.log('Connected to SQLite.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        email TEXT, 
        type TEXT CHECK(type IN ('admin','teacher','student')) NOT NULL,
        phone TEXT,
        avatar TEXT,
        level_id INTEGER,
        group_id INTEGER,
        registration_number TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        login_count INTEGER DEFAULT 0,
        last_login DATETIME
    )`);
    // Ensure email column exists
    db.all("PRAGMA table_info(users)", (err, rows) => {
        if (!rows.find(r => r.name === 'email')) db.run("ALTER TABLE users ADD COLUMN email TEXT");
        if (!rows.find(r => r.name === 'login_count')) db.run("ALTER TABLE users ADD COLUMN login_count INTEGER DEFAULT 0");
        if (!rows.find(r => r.name === 'last_login')) db.run("ALTER TABLE users ADD COLUMN last_login DATETIME");
    });

    db.run(`CREATE TABLE IF NOT EXISTS password_resets (
        token TEXT PRIMARY KEY,
        user_id INTEGER,
        expires_at DATETIME
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS subjects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS levels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        level_id INTEGER,
        FOREIGN KEY(level_id) REFERENCES levels(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS teacher_subjects (
        teacher_id INTEGER,
        subject_id INTEGER,
        PRIMARY KEY (teacher_id, subject_id)
    )`);
    // Teacher Groups (Assignments)
    db.run(`CREATE TABLE IF NOT EXISTS teacher_groups (
        teacher_id INTEGER,
        group_id INTEGER,
        PRIMARY KEY (teacher_id, group_id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS student_teacher_links (
        student_id INTEGER,
        teacher_id INTEGER,
        PRIMARY KEY (student_id, teacher_id)
    )`);
    
    // --- CHAT GROUPS TABLES ---
    db.run(`CREATE TABLE IF NOT EXISTS chat_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        allow_private_chat BOOLEAN DEFAULT 0,
        only_admins_can_send BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // Ensure only_admins_can_send column exists
    db.all("PRAGMA table_info(chat_groups)", (err, rows) => {
        if (!rows.find(r => r.name === 'only_admins_can_send')) db.run("ALTER TABLE chat_groups ADD COLUMN only_admins_can_send BOOLEAN DEFAULT 0");
    });

    db.run(`CREATE TABLE IF NOT EXISTS group_members (
        group_id INTEGER,
        user_id INTEGER,
        is_admin BOOLEAN DEFAULT 0,
        PRIMARY KEY (group_id, user_id)
    )`);
    // Ensure is_admin column exists
    db.all("PRAGMA table_info(group_members)", (err, rows) => {
        if (!rows.find(r => r.name === 'is_admin')) db.run("ALTER TABLE group_members ADD COLUMN is_admin BOOLEAN DEFAULT 0");
    });

    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER,
        receiver_id INTEGER,
        group_id INTEGER,
        subject_id INTEGER,
        message_text TEXT,
        message_type TEXT DEFAULT 'text',
        file_path TEXT,
        file_name TEXT,
        file_size INTEGER,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        read_at DATETIME
    )`);
    // Ensure group_id column exists in messages
    db.all("PRAGMA table_info(messages)", (err, rows) => {
        if (!rows.find(r => r.name === 'group_id')) db.run("ALTER TABLE messages ADD COLUMN group_id INTEGER");
    });

    db.run(`CREATE TABLE IF NOT EXISTS lessons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER,
        subject_id INTEGER,
        title TEXT,
        description TEXT,
        file_path TEXT,
        target_all BOOLEAN DEFAULT 0,
        target_levels TEXT,
        target_groups TEXT,
        target_students TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // Ensure target_all column exists in lessons
    db.all("PRAGMA table_info(lessons)", (err, rows) => {
        if (!rows.find(r => r.name === 'target_all')) db.run("ALTER TABLE lessons ADD COLUMN target_all BOOLEAN DEFAULT 0");
    });

    db.run(`CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        message TEXT,
        link TEXT,
        is_read BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.get("SELECT * FROM users WHERE username = 'admin'", (err, row) => {
        if (!row) {
            const hash = bcrypt.hashSync('admin123', 10);
            db.run("INSERT INTO users (name, username, password, email, type) VALUES (?, ?, ?, ?, ?)", 
                ['السيد المدير', 'admin', hash, 'admin@school.com', 'admin']);
        } else {
            // Force update name to "السيد المدير" if it was different
            db.run("UPDATE users SET name = 'السيد المدير' WHERE username = 'admin'");
        }
    });
});

// --- Auth ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(400).json({ error: 'المستخدم غير موجود' });

        const valid = bcrypt.compareSync(password, user.password);
        if (!valid) return res.status(400).json({ error: 'كلمة المرور غير صحيحة' });

        // Update login stats
        db.run("UPDATE users SET login_count = COALESCE(login_count, 0) + 1, last_login = CURRENT_TIMESTAMP WHERE id = ?", [user.id]);

        let subjects = '';
        if (user.type === 'teacher') {
            db.all("SELECT s.name FROM subjects s JOIN teacher_subjects ts ON ts.subject_id = s.id WHERE ts.teacher_id = ?", [user.id], (err, rows) => {
                subjects = rows.map(r => r.name).join(', ');
                res.json({ success: true, user: { ...user, subjects } });
            });
        } else if (user.type === 'student') {
             db.get(`SELECT l.name as l_name, g.name as g_name FROM levels l LEFT JOIN groups g ON g.level_id = l.id WHERE l.id = ? AND (g.id = ? OR ? IS NULL)`, 
             [user.level_id, user.group_id, user.group_id], (err, row) => {
                 res.json({ success: true, user: { ...user, level_name: row?.l_name, group_name: row?.g_name } });
             });
        } else {
            res.json({ success: true, user });
        }
    });
});

app.post('/api/admin/change-credentials', (req, res) => {
    const { id, oldPassword, newPassword, newEmail } = req.body;
    db.get("SELECT * FROM users WHERE id = ? AND type = 'admin'", [id], (err, user) => {
        if (!user) return res.status(404).json({error: 'المستخدم غير موجود'});
        const valid = bcrypt.compareSync(oldPassword, user.password);
        if (!valid) return res.status(400).json({error: 'كلمة المرور القديمة غير صحيحة'});
        let sql = "UPDATE users SET email = ?";
        let params = [newEmail];
        if (newPassword) {
            sql += ", password = ?";
            params.push(bcrypt.hashSync(newPassword, 10));
        }
        sql += " WHERE id = ?";
        params.push(id);
        db.run(sql, params, (err) => {
            if (err) return res.status(500).json({error: err.message});
            res.json({success: true});
        });
    });
});

app.post('/api/auth/forgot-password', (req, res) => {
    const { email } = req.body;
    db.get("SELECT * FROM users WHERE email = ? AND type = 'admin'", [email], (err, user) => {
        if (!user) return res.status(404).json({error: 'البريد غير مسجل'});
        const token = crypto.randomBytes(32).toString('hex');
        const expires = Date.now() + 3600000;
        db.run("INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, ?)", [token, user.id, expires], (err) => {
            if(err) return res.status(500).json({error: err.message});
            const resetLink = `${req.protocol}://${req.get('host')}/admin?reset=${token}`;
            res.json({ success: true, message: 'تم إنشاء رابط الاستعادة.', link: resetLink });
        });
    });
});

app.post('/api/auth/reset-password', (req, res) => {
    const { token, newPassword } = req.body;
    db.get("SELECT * FROM password_resets WHERE token = ?", [token], (err, reset) => {
        if (!reset || Date.now() > reset.expires_at) return res.status(400).json({error: 'رابط غير صالح أو منتهي'});
        const hash = bcrypt.hashSync(newPassword, 10);
        db.run("UPDATE users SET password = ? WHERE id = ?", [hash, reset.user_id], (err) => {
            db.run("DELETE FROM password_resets WHERE token = ?", [token]);
            res.json({success: true});
        });
    });
});

// --- API Routes ---
app.get('/api/teachers/all', (req, res) => {
    db.all("SELECT * FROM users WHERE type = 'teacher' ORDER BY name", [], (err, rows) => res.json(rows));
});
app.post('/api/teachers', (req, res) => {
    const { name, username, phone } = req.body;
    const hash = bcrypt.hashSync(phone || '123456', 10);
    db.run("INSERT INTO users (name, username, password, type, phone) VALUES (?, ?, ?, 'teacher', ?)", 
        [name, username, hash, phone], function(err) {
            if (err) return res.status(400).json({ error: 'خطأ: قد يكون الاسم مكرراً' });
            res.json({ id: this.lastID });
    });
});

// CORRECTED TEACHER IMPORT
app.post('/api/teachers/import', uploadExcel.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    try {
        const workbook = xlsx.readFile(req.file.path);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = xlsx.utils.sheet_to_json(sheet);
        let imported = 0;

        await new Promise((resolve, reject) => {
            db.serialize(() => {
                const stmt = db.prepare("INSERT INTO users (name, username, password, type, phone) VALUES (?, ?, ?, 'teacher', ?)");
                let pending = rows.length;
                if (pending === 0) { stmt.finalize(); resolve(); return; }

                rows.forEach(row => {
                    // Mapping columns flexibly
                    const keys = Object.keys(row).reduce((acc, k) => { acc[k.toLowerCase().trim()] = row[k]; return acc; }, {});
                    
                    const name = keys['name'] || keys['الاسم'];
                    const username = keys['username'] || keys['اسم المستخدم'];
                    const phone = keys['phone'] || keys['phone number'] || keys['الهاتف'] || '123456';

                    if (name && username) {
                        const password = bcrypt.hashSync(String(phone), 10);
                        stmt.run(name, username, password, String(phone), (err) => {
                            if (!err) imported++;
                            pending--;
                            if (pending === 0) { stmt.finalize(); resolve(); }
                        });
                    } else {
                        pending--;
                        if (pending === 0) { stmt.finalize(); resolve(); }
                    }
                });
            });
        });

        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.json({ imported, success: true });
    } catch (e) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/users/:id', (req, res) => {
    const { name, username, password, phone, level_id, group_id } = req.body;
    let sql = "UPDATE users SET name = ?, username = ?";
    const params = [name, username];
    if (password) { sql += ", password = ?"; params.push(bcrypt.hashSync(password, 10)); }
    if (phone !== undefined) { sql += ", phone = ?"; params.push(phone); }
    if (level_id !== undefined) { sql += ", level_id = ?"; params.push(level_id); }
    if (group_id !== undefined) { sql += ", group_id = ?"; params.push(group_id); }
    sql += " WHERE id = ?"; params.push(req.params.id);
    db.run(sql, params, function(err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/students/all', (req, res) => {
    db.all(`SELECT u.*, l.name as level_name, g.name as group_name FROM users u LEFT JOIN levels l ON u.level_id = l.id LEFT JOIN groups g ON u.group_id = g.id WHERE u.type = 'student' ORDER BY u.name`, [], (err, rows) => res.json(rows));
});
app.post('/api/students', (req, res) => {
    const { name, username, level_id, group_id } = req.body;
    const regNum = Math.floor(100000 + Math.random() * 900000).toString();
    const hash = bcrypt.hashSync(regNum, 10);
    db.run(`INSERT INTO users (name, username, password, type, level_id, group_id, registration_number) VALUES (?, ?, ?, 'student', ?, ?, ?)`, 
        [name, username, hash, level_id || null, group_id || null, regNum], function(err) {
            if (err) return res.status(400).json({ error: err.message });
            res.json({ id: this.lastID, registration_number: regNum });
    });
});

// CORRECTED STUDENT IMPORT
app.post('/api/students/import', uploadExcel.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    try {
        const workbook = xlsx.readFile(req.file.path);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = xlsx.utils.sheet_to_json(sheet);
        let imported = 0;

        const levels = await new Promise((resolve) => db.all("SELECT * FROM levels", (err, rows) => resolve(rows || [])));
        const groups = await new Promise((resolve) => db.all("SELECT * FROM groups", (err, rows) => resolve(rows || [])));

        await new Promise((resolve, reject) => {
            db.serialize(() => {
                const stmt = db.prepare("INSERT INTO users (name, username, password, type, level_id, group_id, registration_number) VALUES (?, ?, ?, 'student', ?, ?, ?)");
                let pending = rows.length;
                if (pending === 0) { stmt.finalize(); resolve(); return; }

                rows.forEach(row => {
                    const keys = Object.keys(row).reduce((acc, k) => { acc[k.toLowerCase().trim()] = row[k]; return acc; }, {});
                    
                    const name = keys['name'] || keys['الاسم'];
                    const username = keys['username'] || keys['اسم المستخدم'];
                    const levelName = keys['level'] || keys['المستوى'];
                    const groupName = keys['group'] || keys['الفوج'];

                    if (name && username) {
                        let lvlId = null, grpId = null;
                        
                        if (levelName) {
                            const l = levels.find(x => x.name.trim().toLowerCase() === String(levelName).trim().toLowerCase());
                            if (l) lvlId = l.id;
                        }
                        
                        if (groupName) {
                            const matches = groups.filter(g => g.name.trim().toLowerCase() === String(groupName).trim().toLowerCase());
                            if (matches.length > 0) {
                                if (lvlId) {
                                    const g = matches.find(x => x.level_id === lvlId);
                                    if (g) grpId = g.id;
                                } else {
                                    grpId = matches[0].id;
                                    lvlId = matches[0].level_id;
                                }
                            }
                        }

                        const regNum = Math.floor(100000 + Math.random() * 900000).toString();
                        const password = bcrypt.hashSync(regNum, 10);

                        stmt.run(name, username, password, lvlId, grpId, regNum, (err) => {
                            if (!err) imported++;
                            pending--;
                            if (pending === 0) { stmt.finalize(); resolve(); }
                        });
                    } else {
                        pending--;
                        if (pending === 0) { stmt.finalize(); resolve(); }
                    }
                });
            });
        });

        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.json({ imported, success: true });
    } catch (e) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/levels', (req, res) => db.all("SELECT * FROM levels", (e, r) => res.json(r)));
app.post('/api/levels', (req, res) => db.run("INSERT INTO levels (name) VALUES (?)", [req.body.name], function(e){ if(e)return res.status(400).json({error:e.message}); res.json({id:this.lastID}); }));
app.put('/api/levels/:id', (req, res) => db.run("UPDATE levels SET name = ? WHERE id = ?", [req.body.name, req.params.id], (e)=>res.json({success:true})));

app.get('/api/groups', (req, res) => db.all("SELECT * FROM groups", (e, r) => res.json(r)));
app.post('/api/groups', (req, res) => db.run("INSERT INTO groups (name, level_id) VALUES (?, ?)", [req.body.name, req.body.level_id], function(e){ if(e)return res.status(400).json({error:e.message}); res.json({id:this.lastID}); }));
app.put('/api/groups/:id', (req, res) => db.run("UPDATE groups SET name = ?, level_id = ? WHERE id = ?", [req.body.name, req.body.level_id, req.params.id], (e)=>res.json({success:true})));

app.get('/api/subjects', (req, res) => db.all("SELECT * FROM subjects", (e, r) => res.json(r)));
app.post('/api/subjects', (req, res) => db.run("INSERT INTO subjects (name, description) VALUES (?, ?)", [req.body.name, req.body.description], function(e){ res.json({id:this.lastID}); }));
app.put('/api/subjects/:id', (req, res) => db.run("UPDATE subjects SET name = ?, description = ? WHERE id = ?", [req.body.name, req.body.description, req.params.id], (e)=>res.json({success:true})));

// Teacher Subjects
app.get('/api/teacher-subjects', (req, res) => db.all(`SELECT ts.*, u.name as teacher_name, s.name as subject_name FROM teacher_subjects ts JOIN users u ON u.id=ts.teacher_id JOIN subjects s ON s.id=ts.subject_id`, [], (e,r)=>res.json(r)));
app.post('/api/teacher-subjects', (req, res) => db.run("INSERT OR IGNORE INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)", [req.body.teacher_id, req.body.subject_id], (e)=>res.json({success:true})));
// Bulk Teacher Subjects
app.post('/api/teacher-subjects/bulk', (req, res) => {
    const { teacher_id, subject_ids } = req.body;
    if(!teacher_id) return res.status(400).json({error:'Missing teacher'});
    db.serialize(() => {
        db.run("DELETE FROM teacher_subjects WHERE teacher_id = ?", [teacher_id]);
        if (subject_ids && subject_ids.length > 0) {
            const stmt = db.prepare("INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)");
            subject_ids.forEach(sid => stmt.run(teacher_id, sid));
            stmt.finalize();
        }
        res.json({success: true});
    });
});
app.delete('/api/teacher-subjects/:tid/:sid', (req, res) => db.run("DELETE FROM teacher_subjects WHERE teacher_id = ? AND subject_id = ?", [req.params.tid, req.params.sid], (e)=>res.json({success:true})));

// Teacher Groups (Assignments)
app.get('/api/teacher-groups', (req, res) => db.all(`SELECT tg.*, u.name as teacher_name, g.name as group_name, l.name as level_name FROM teacher_groups tg JOIN users u ON u.id=tg.teacher_id JOIN groups g ON g.id=tg.group_id JOIN levels l ON g.level_id=l.id`, [], (e,r)=>res.json(r)));
app.post('/api/teacher-groups', (req, res) => db.run("INSERT OR IGNORE INTO teacher_groups (teacher_id, group_id) VALUES (?, ?)", [req.body.teacher_id, req.body.group_id], (e)=>res.json({success:true})));
// Bulk Teacher Groups
app.post('/api/teacher-groups/bulk', (req, res) => {
    const { teacher_id, group_ids } = req.body;
    if(!teacher_id) return res.status(400).json({error:'Missing teacher'});
    db.serialize(() => {
        db.run("DELETE FROM teacher_groups WHERE teacher_id = ?", [teacher_id]);
        if (group_ids && group_ids.length > 0) {
            const stmt = db.prepare("INSERT INTO teacher_groups (teacher_id, group_id) VALUES (?, ?)");
            group_ids.forEach(gid => stmt.run(teacher_id, gid));
            stmt.finalize();
        }
        res.json({success: true});
    });
});
app.delete('/api/teacher-groups/:tid/:gid', (req, res) => db.run("DELETE FROM teacher_groups WHERE teacher_id = ? AND group_id = ?", [req.params.tid, req.params.gid], (e)=>res.json({success:true})));

// Teacher Scope (What they teach)
app.get('/api/teachers/:id/scope', (req, res) => {
    const tid = req.params.id;
    const response = { levels: [], groups: [], students: [] };
    
    // Get assigned groups
    db.all(`SELECT g.id, g.name, g.level_id, l.name as level_name FROM teacher_groups tg JOIN groups g ON tg.group_id = g.id JOIN levels l ON g.level_id = l.id WHERE tg.teacher_id = ?`, [tid], (err, groups) => {
        if(err || !groups) return res.json(response);
        
        response.groups = groups;
        const levelsMap = new Map();
        groups.forEach(g => levelsMap.set(g.level_id, { id: g.level_id, name: g.level_name }));
        response.levels = Array.from(levelsMap.values());
        
        if (groups.length === 0) return res.json(response);

        const groupIds = groups.map(g => g.id).join(',');
        db.all(`SELECT id, name, level_id, group_id, registration_number FROM users WHERE type='student' AND group_id IN (${groupIds})`, [], (err, students) => {
            response.students = students || [];
            res.json(response);
        });
    });
});

// Student Teacher Links
app.get('/api/student-teacher-links', (req, res) => db.all(`SELECT l.*, s.name as student_name, t.name as teacher_name FROM student_teacher_links l JOIN users s ON s.id=l.student_id JOIN users t ON t.id=l.teacher_id`, [], (e,r)=>res.json(r)));
app.post('/api/student-teacher-links', (req, res) => db.run("INSERT OR IGNORE INTO student_teacher_links (student_id, teacher_id) VALUES (?, ?)", [req.body.student_id, req.body.teacher_id], (e)=>res.json({success:true})));
app.delete('/api/student-teacher-links', (req, res) => db.run("DELETE FROM student_teacher_links WHERE student_id = ? AND teacher_id = ?", [req.body.student_id, req.body.teacher_id], (e)=>res.json({success:true})));

// Bulk Link API
app.post('/api/student-teacher-links/bulk', (req, res) => {
    const { teacher_id, student_ids } = req.body;
    if (!teacher_id || !student_ids || !student_ids.length) return res.status(400).json({error:'Invalid data'});
    
    const stmt = db.prepare("INSERT OR IGNORE INTO student_teacher_links (student_id, teacher_id) VALUES (?, ?)");
    student_ids.forEach(sid => stmt.run(sid, teacher_id));
    stmt.finalize();
    res.json({success: true, count: student_ids.length});
});

// --- CHAT GROUPS API ---
app.get('/api/chat-groups', (req, res) => {
    db.all("SELECT * FROM chat_groups ORDER BY created_at DESC", [], (e, r) => {
        if(e) return res.status(500).json({error: e.message});
        const groups = r;
        const promises = groups.map(g => new Promise(resolve => {
            db.get("SELECT COUNT(*) as c FROM group_members WHERE group_id = ?", [g.id], (e, row) => {
                g.member_count = row ? row.c : 0;
                resolve(g);
            });
        }));
        Promise.all(promises).then(data => res.json(data));
    });
});

app.get('/api/chat-groups/:id/details', (req, res) => {
    const gid = req.params.id;
    db.get("SELECT * FROM chat_groups WHERE id = ?", [gid], (err, group) => {
        if(err || !group) return res.status(404).json({error: 'Group not found'});
        db.all("SELECT gm.user_id, gm.is_admin, u.name, u.type FROM group_members gm JOIN users u ON gm.user_id = u.id WHERE gm.group_id = ?", [gid], (err, members) => {
            group.members = members;
            res.json(group);
        });
    });
});

// Public endpoint for members to see who is in the group
app.get('/api/chat-groups/:id/members', (req, res) => {
    const gid = req.params.id;
    db.all("SELECT u.id, u.name, u.type, u.avatar, gm.is_admin FROM group_members gm JOIN users u ON gm.user_id = u.id WHERE gm.group_id = ? ORDER BY gm.is_admin DESC, u.name ASC", [gid], (err, members) => {
        if(err) return res.status(500).json({error: err.message});
        res.json(members);
    });
});

app.post('/api/chat-groups', (req, res) => {
    const { name, allow_private, only_admins_can_send, members } = req.body; // members is array of {user_id, is_admin}
    db.run("INSERT INTO chat_groups (name, allow_private_chat, only_admins_can_send) VALUES (?, ?, ?)", [name, allow_private ? 1 : 0, only_admins_can_send ? 1 : 0], function(e) {
        if(e) return res.status(500).json({error: e.message});
        const gid = this.lastID;
        if (members && members.length > 0) {
            const stmt = db.prepare("INSERT INTO group_members (group_id, user_id, is_admin) VALUES (?, ?, ?)");
            members.forEach(m => stmt.run(gid, m.user_id, m.is_admin ? 1 : 0));
            stmt.finalize();
        }
        res.json({success: true, id: gid});
    });
});

app.put('/api/chat-groups/:id', (req, res) => {
    const { name, allow_private, only_admins_can_send, members } = req.body; // members is array of {user_id, is_admin}
    const gid = req.params.id;
    
    db.serialize(() => {
        db.run("UPDATE chat_groups SET name = ?, allow_private_chat = ?, only_admins_can_send = ? WHERE id = ?", 
            [name, allow_private ? 1 : 0, only_admins_can_send ? 1 : 0, gid], function(e) {
                if(e) return res.status(500).json({error: e.message});
            });
            
        // Sync members: Remove all and re-add (Simple strategy for now)
        db.run("DELETE FROM group_members WHERE group_id = ?", [gid], (e) => {
            if (members && members.length > 0) {
                const stmt = db.prepare("INSERT INTO group_members (group_id, user_id, is_admin) VALUES (?, ?, ?)");
                members.forEach(m => stmt.run(gid, m.user_id, m.is_admin ? 1 : 0));
                stmt.finalize();
            }
            res.json({success: true});
        });
    });
});

// Toggle settings by Group Admin
app.post('/api/chat-groups/:id/settings', (req, res) => {
    const { user_id, only_admins_can_send } = req.body;
    const gid = req.params.id;
    
    // Verify user is group admin
    db.get("SELECT is_admin FROM group_members WHERE group_id = ? AND user_id = ?", [gid, user_id], (err, row) => {
        if (!row || !row.is_admin) return res.status(403).json({error: 'Unauthorized'});
        
        db.run("UPDATE chat_groups SET only_admins_can_send = ? WHERE id = ?", [only_admins_can_send ? 1 : 0, gid], (err) => {
            if(err) return res.status(500).json({error: err.message});
            res.json({success: true});
        });
    });
});

app.post('/api/chat-groups/delete', (req, res) => {
    const { id, password } = req.body;
    db.get("SELECT password FROM users WHERE username = 'admin'", (err, admin) => {
        if (!admin || !bcrypt.compareSync(password, admin.password)) return res.status(403).json({error: 'كلمة المرور غير صحيحة'});
        db.serialize(() => {
            db.run("DELETE FROM chat_groups WHERE id = ?", [id]);
            db.run("DELETE FROM group_members WHERE group_id = ?", [id]);
            db.run("DELETE FROM messages WHERE group_id = ?", [id]);
            res.json({success: true});
        });
    });
});

app.get('/api/user/:id/chat-groups', (req, res) => {
    db.all(`SELECT g.*, (SELECT COUNT(*) FROM messages WHERE group_id = g.id AND read_at IS NULL AND sender_id != ?) as unread_count, (SELECT sent_at FROM messages WHERE group_id = g.id ORDER BY sent_at DESC LIMIT 1) as last_msg_time, gm.is_admin as my_role_admin FROM chat_groups g JOIN group_members gm ON g.id = gm.group_id WHERE gm.user_id = ? ORDER BY last_msg_time DESC NULLS LAST`, [req.params.id, req.params.id], (e, r) => res.json(r || []));
});

app.get('/api/chat-groups/:id/messages', (req, res) => {
    db.all(`SELECT m.*, u.name as sender_name, u.avatar as sender_avatar FROM messages m LEFT JOIN users u ON m.sender_id = u.id WHERE m.group_id = ? ORDER BY m.sent_at ASC`, [req.params.id], (e, r) => res.json(r || []));
});

// --- Chat Messaging Logic Update ---
app.get('/api/teacher/:id/linked-students', (req, res) => {
    // Include Admin in the linked list for teachers
    const sql = `
        SELECT DISTINCT u.id, u.name, u.avatar, l.name as level_name, g.name as group_name, 
        (SELECT COUNT(*) FROM messages WHERE sender_id = u.id AND receiver_id = ? AND read_at IS NULL) as unread_count, 
        (SELECT sent_at FROM messages WHERE (sender_id = u.id AND receiver_id = ?) OR (sender_id = ? AND receiver_id = u.id) ORDER BY sent_at DESC LIMIT 1) as last_msg_time 
        FROM users u 
        LEFT JOIN levels l ON u.level_id = l.id 
        LEFT JOIN groups g ON u.group_id = g.id 
        JOIN student_teacher_links stl ON stl.student_id = u.id 
        WHERE stl.teacher_id = ?
        UNION
        SELECT id, name, avatar, 'إدارة' as level_name, '' as group_name,
        (SELECT COUNT(*) FROM messages WHERE sender_id = id AND receiver_id = ? AND read_at IS NULL) as unread_count,
        (SELECT sent_at FROM messages WHERE (sender_id = id AND receiver_id = ?) OR (sender_id = ? AND receiver_id = id) ORDER BY sent_at DESC LIMIT 1) as last_msg_time
        FROM users WHERE type = 'admin'
        ORDER BY last_msg_time DESC NULLS LAST
    `;
    const p = req.params.id;
    db.all(sql, [p, p, p, p, p, p, p], (e, r) => res.json(r || []));
});
app.get('/api/student/:id/linked-teachers', (req, res) => {
    db.all(`SELECT DISTINCT u.id, u.name, u.avatar, (SELECT GROUP_CONCAT(s.name, ', ') FROM subjects s JOIN teacher_subjects ts ON ts.subject_id = s.id WHERE ts.teacher_id = u.id) as subjects, (SELECT COUNT(*) FROM messages WHERE sender_id = u.id AND receiver_id = ? AND read_at IS NULL) as unread_count, (SELECT sent_at FROM messages WHERE (sender_id = u.id AND receiver_id = ?) OR (sender_id = ? AND receiver_id = u.id) ORDER BY sent_at DESC LIMIT 1) as last_msg_time FROM users u JOIN student_teacher_links stl ON stl.teacher_id = u.id WHERE stl.student_id = ? ORDER BY last_msg_time DESC NULLS LAST`, [req.params.id, req.params.id, req.params.id, req.params.id], (e, r) => res.json(r || []));
});
app.get('/api/conversation/:u1/:u2', (req, res) => {
    db.all(`SELECT m.*, u.name as sender_name FROM messages m JOIN users u ON m.sender_id = u.id WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) ORDER BY sent_at ASC`, [req.params.u1, req.params.u2, req.params.u2, req.params.u1], (e, r) => res.json(r));
});
app.post('/api/conversation/mark-read', (req, res) => {
    if (req.body.group_id) {
        res.json({success: true});
    } else {
        db.run("UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL", [req.body.sender_id, req.body.reader_id], (e)=>res.json({success:true}));
    }
});

app.post('/api/message/send', (req, res) => {
    const { sender_id, receiver_id, group_id, subject_id, message_text } = req.body;
    
    if (group_id) {
        // Check Permissions for Group Messaging
        db.get("SELECT only_admins_can_send FROM chat_groups WHERE id = ?", [group_id], (err, group) => {
            if (err || !group) return res.status(404).json({error: 'Group not found'});
            
            if (group.only_admins_can_send) {
                // Check if sender is group admin or super admin
                db.get("SELECT type FROM users WHERE id = ?", [sender_id], (e, u) => {
                    if (u && u.type === 'admin') {
                         insertMsg(); // Super Admin can always post
                    } else {
                        db.get("SELECT is_admin FROM group_members WHERE group_id = ? AND user_id = ?", [group_id, sender_id], (e2, member) => {
                             if (member && member.is_admin) {
                                 insertMsg();
                             } else {
                                 return res.status(403).json({error: 'Sending disabled for members'});
                             }
                        });
                    }
                });
            } else {
                insertMsg();
            }
        });

        function insertMsg() {
            db.run("INSERT INTO messages (sender_id, group_id, message_text) VALUES (?, ?, ?)", [sender_id, group_id, message_text], (e) => {
                if(e) return res.status(500).json({error: e.message});
                res.json({success: true});
            });
        }
    } else {
        // Check permissions for Private Messaging
        // 1. Linked Student <-> Teacher
        // 2. Member <-> Member in allowed group
        // 3. Admin <-> Anyone
        
        db.get("SELECT type FROM users WHERE id = ?", [sender_id], (e, sender) => {
            if (sender && sender.type === 'admin') {
                insertPrivateMsg(); // Admin can message anyone
                return;
            }
            
            db.get("SELECT type FROM users WHERE id = ?", [receiver_id], (e, receiver) => {
                if (receiver && receiver.type === 'admin') {
                    insertPrivateMsg(); // Anyone can message admin (usually)
                    return;
                }

                // Normal check
                const checkLink = `SELECT 1 FROM student_teacher_links WHERE (student_id = ? AND teacher_id = ?) OR (student_id = ? AND teacher_id = ?)`;
                const checkGroup = `SELECT 1 FROM chat_groups g JOIN group_members m1 ON g.id = m1.group_id JOIN group_members m2 ON g.id = m2.group_id WHERE m1.user_id = ? AND m2.user_id = ? AND CAST(g.allow_private_chat AS INTEGER) = 1`;
                
                db.get(checkLink, [sender_id, receiver_id, receiver_id, sender_id], (e, linkRow) => {
                    if (linkRow) {
                        insertPrivateMsg();
                    } else {
                        db.get(checkGroup, [sender_id, receiver_id], (e2, groupRow) => {
                            if (groupRow) {
                                insertPrivateMsg();
                            } else {
                                res.status(403).json({error: 'غير مسموح بالمراسلة الخاصة'});
                            }
                        });
                    }
                });
            });
        });

        function insertPrivateMsg() {
            db.run("INSERT INTO messages (sender_id, receiver_id, subject_id, message_text) VALUES (?, ?, ?, ?)", [sender_id, receiver_id, subject_id, message_text], function(e){
                if(e) return res.status(500).json({error:e.message});
                res.json({success:true});
            });
        }
    }
});

app.post('/api/message/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const { sender_id, receiver_id, group_id, subject_id } = req.body;
    
    if (group_id) {
        db.get("SELECT only_admins_can_send FROM chat_groups WHERE id = ?", [group_id], (err, group) => {
            if (group && group.only_admins_can_send) {
                 db.get("SELECT is_admin FROM group_members WHERE group_id = ? AND user_id = ?", [group_id, sender_id], (e2, member) => {
                     db.get("SELECT type FROM users WHERE id = ?", [sender_id], (e3, u) => {
                         if ((u && u.type === 'admin') || (member && member.is_admin)) {
                             proceedUpload();
                         } else {
                             fs.unlinkSync(req.file.path);
                             return res.status(403).json({error: 'Sending disabled'});
                         }
                     });
                 });
            } else {
                proceedUpload();
            }
        });
    } else {
        proceedUpload();
    }

    function proceedUpload() {
        const columns = group_id ? "sender_id, group_id, message_type, file_path, file_name, file_size" : "sender_id, receiver_id, subject_id, message_type, file_path, file_name, file_size";
        const values = group_id ? [sender_id, group_id, 'file', req.file.filename, req.file.originalname, req.file.size] : [sender_id, receiver_id, subject_id, 'file', req.file.filename, req.file.originalname, req.file.size];
        const placeholders = group_id ? "?, ?, ?, ?, ?, ?" : "?, ?, ?, ?, ?, ?, ?";
    
        db.run(`INSERT INTO messages (${columns}) VALUES (${placeholders})`, values, (e)=>res.json({success:true}));
    }
});

app.post('/api/admin/message/delete', (req, res) => {
    const { id, password } = req.body;
    db.get("SELECT password FROM users WHERE username = 'admin'", (err, admin) => {
        if(err) return res.status(500).json({error: err.message});
        if(!admin) return res.status(404).json({error: 'Admin not found'});
        if(bcrypt.compareSync(password, admin.password)) {
            db.run("DELETE FROM messages WHERE id = ?", [id], function(err) {
                if(err) return res.status(500).json({error: err.message});
                res.json({success: true});
            });
        } else {
            res.status(403).json({error: 'كلمة المرور غير صحيحة'});
        }
    });
});

app.post('/api/lessons', uploadLesson.single('file'), (req, res) => {
    if(!req.file) return res.status(400).json({error:'No file'});
    const { teacher_id, subject_id, title, description, target_all, target_levels, target_groups, target_students } = req.body;
    const isAll = target_all === 'true' || target_all === '1';
    db.run(`INSERT INTO lessons (teacher_id, subject_id, title, description, file_path, target_all, target_levels, target_groups, target_students) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [teacher_id, subject_id, title, description, req.file.filename, isAll, target_levels, target_groups, target_students],
        function(err) {
            if(err) return res.status(500).json({error:err});
            const msg = `درس جديد: ${title}`;
            let sql = "SELECT id FROM users WHERE type='student'";
            if (!isAll) {
                if (target_students) sql += ` AND id IN (${target_students})`;
                else if (target_groups) sql += ` AND group_id IN (${target_groups})`;
                else if (target_levels) sql += ` AND level_id IN (${target_levels})`;
            }
            db.all(sql, [], (err, rows) => {
                if(rows) {
                    const stmt = db.prepare("INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)");
                    rows.forEach(u => stmt.run(u.id, msg, `/api/lessons/files/${req.file.filename}`));
                    stmt.finalize();
                }
            });
            res.json({success:true});
        });
});
app.get('/api/lessons', (req, res) => {
    const { user_id, user_group, user_level } = req.query;
    db.all(`SELECT l.*, u.name as teacher_name, u.type as teacher_type, s.name as subject_name FROM lessons l LEFT JOIN users u ON l.teacher_id = u.id LEFT JOIN subjects s ON l.subject_id = s.id ORDER BY l.created_at DESC`, [], (err, rows) => {
        if(!user_id) return res.json(rows);
        const filtered = rows.filter(l => {
            if (l.target_all) return true;
            if (l.target_students && l.target_students.split(',').includes(String(user_id))) return true;
            if (l.target_groups && user_group && l.target_groups.split(',').includes(String(user_group))) return true;
            if (l.target_levels && user_level && l.target_levels.split(',').includes(String(user_level))) return true;
            return false;
        });
        res.json(filtered);
    });
});
app.get('/api/lessons/files/:filename', (req, res) => {
    const fp = path.join(__dirname, 'uploads/lessons', req.params.filename);
    if(fs.existsSync(fp)) res.sendFile(fp); else res.status(404).send('Not found');
});
app.delete('/api/lessons/:id', (req, res) => db.run("DELETE FROM lessons WHERE id = ?", [req.params.id], (e)=>res.json({success:true})));
app.get('/api/teachers/:id/lessons', (req, res) => {
    db.all(`SELECT l.*, u.name as teacher_name, s.name as subject_name FROM lessons l LEFT JOIN users u ON l.teacher_id = u.id LEFT JOIN subjects s ON l.subject_id = s.id WHERE l.teacher_id = ? ORDER BY l.created_at DESC`, [req.params.id], (e,r)=>res.json(r));
});

// Notifications
app.get('/api/notifications/:uid', (req, res) => db.all("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", [req.params.uid], (e,r)=>res.json(r)));
app.post('/api/notifications/read/:id', (req, res) => db.run("UPDATE notifications SET is_read = 1 WHERE id = ?", [req.params.id], ()=>res.json({success:true})));
app.post('/api/notifications/read-all/:uid', (req, res) => db.run("UPDATE notifications SET is_read = 1 WHERE user_id = ?", [req.params.uid], ()=>res.json({success:true})));

// Admin Stats
app.get('/api/admin/stats', (req, res) => {
    const stats = {};
    db.serialize(() => {
        db.get("SELECT COUNT(*) as c FROM users WHERE type='teacher'", (e,r)=>stats.teachers=r.c);
        db.get("SELECT COUNT(*) as c FROM users WHERE type='student'", (e,r)=>stats.students=r.c);
        db.get("SELECT COUNT(*) as c FROM messages", (e,r)=>stats.messages=r.c);
        db.get("SELECT COUNT(*) as c FROM subjects", (e,r)=>stats.subjects=r.c);
        db.get("SELECT COUNT(*) as c FROM student_teacher_links", (e,r)=>stats.links=r.c);
        db.get("SELECT COUNT(*) as c FROM lessons", (e,r)=>stats.lessons=r.c);
        // Active users: login_count > 0
        db.get("SELECT COUNT(*) as c FROM users WHERE login_count > 0", (e,r)=> { stats.active_users = r.c; res.json(stats); });
    });
});

app.get('/api/admin/usage-stats', (req, res) => {
    db.all("SELECT id, name, type, login_count, last_login FROM users WHERE login_count > 0 ORDER BY last_login DESC", (err, rows) => {
        if(err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

app.post('/api/admin/reset-stats', (req, res) => {
    const { code } = req.body;
    if (code !== DEV_RESET_CODE) return res.status(403).json({error: 'كود المطور غير صحيح'});
    
    db.run("UPDATE users SET login_count = 0, last_login = NULL", (err) => {
        if(err) return res.status(500).json({error: err.message});
        res.json({success: true});
    });
});

// Updated Conversation Stats to include Groups
app.get('/api/admin/conversations', (req, res) => {
    db.all(`
        SELECT 
            u1.id as user1_id, u1.name as user1_name, u1.type as user1_type,
            u2.id as user2_id, u2.name as user2_name, u2.type as user2_type,
            COUNT(m.id) as msg_count, MAX(m.sent_at) as last_message_at,
            NULL as group_id, NULL as group_name
        FROM messages m 
        JOIN users u1 ON m.sender_id = u1.id 
        JOIN users u2 ON m.receiver_id = u2.id 
        WHERE m.group_id IS NULL
        GROUP BY CASE WHEN u1.id < u2.id THEN u1.id ELSE u2.id END, CASE WHEN u1.id < u2.id THEN u2.id ELSE u1.id END
        UNION ALL
        SELECT 
            NULL, NULL, NULL, NULL, NULL, NULL,
            COUNT(m.id), MAX(m.sent_at),
            g.id, g.name
        FROM messages m
        JOIN chat_groups g ON m.group_id = g.id
        WHERE m.group_id IS NOT NULL
        GROUP BY g.id
        ORDER BY last_message_at DESC
    `, [], (e,r)=>res.json(r));
});

// Endpoint for Admin Inbox Summary
app.get('/api/admin/inbox-summary', (req, res) => {
    // Get list of conversations involving Admin where last message is NOT from Admin (or just list generally)
    // We assume there is only one admin for now or we filter by the logged in admin ID from frontend filtering
    // This returns raw conversation data for processing
    db.all(`
        SELECT 
            u.id as other_id, u.name as other_name, u.type as other_type,
            m.message_text, m.sent_at, m.read_at, m.sender_id
        FROM messages m
        JOIN users u ON (m.sender_id = u.id OR m.receiver_id = u.id)
        WHERE (m.receiver_id = (SELECT id FROM users WHERE type='admin' LIMIT 1) OR m.sender_id = (SELECT id FROM users WHERE type='admin' LIMIT 1))
        AND u.type != 'admin'
        ORDER BY m.sent_at DESC
    `, [], (e, rows) => {
        // Group by user
        const conversations = {};
        rows.forEach(r => {
            if (!conversations[r.other_id]) {
                conversations[r.other_id] = {
                    id: r.other_id,
                    name: r.other_name,
                    type: r.other_type,
                    last_message: r.message_text,
                    last_time: r.sent_at,
                    unread_count: 0
                };
            }
            // Count unread incoming messages (where sender is NOT admin)
            // Assuming we check "read_at" is null and sender != admin
            // We need admin ID to check sender. 
            // Simplified: if sender_id == other_id and read_at is null
            if (r.sender_id == r.other_id && !r.read_at) {
                conversations[r.other_id].unread_count++;
            }
        });
        res.json(Object.values(conversations).sort((a,b) => new Date(b.last_time) - new Date(a.last_time)));
    });
});

app.post('/api/bulk-delete', (req, res) => {
    const { ids, type } = req.body;
    let table = '';
    if(type==='student'||type==='teacher') table='users'; else if(type==='subjects') table='subjects'; else if(type==='levels') table='levels'; else if(type==='groups') table='groups'; else if(type==='lessons') table='lessons';
    if(table && ids.length) db.run(`DELETE FROM ${table} WHERE id IN (${ids.map(()=>'?').join(',')})`, ids, function(e){ if(e)return res.status(500).json({error:e}); res.json({deleted:this.changes}); });
    else res.status(400).json({error:'Invalid'});
});
app.delete('/api/users/:id', (req, res) => {
    db.run("DELETE FROM users WHERE id = ?", [req.params.id], function(e) {
        db.run("DELETE FROM student_teacher_links WHERE student_id = ? OR teacher_id = ?", [req.params.id, req.params.id]);
        db.run("DELETE FROM teacher_subjects WHERE teacher_id = ?", [req.params.id]);
        db.run("DELETE FROM teacher_groups WHERE teacher_id = ?", [req.params.id]);
        db.run("DELETE FROM group_members WHERE user_id = ?", [req.params.id]);
        res.json({deleted:this.changes});
    });
});
app.delete('/api/subjects/:id', (req, res) => db.run("DELETE FROM subjects WHERE id = ?", [req.params.id], (e)=>res.json({success:true})));
app.delete('/api/levels/:id', (req, res) => db.run("DELETE FROM levels WHERE id = ?", [req.params.id], (e)=>res.json({success:true})));
app.delete('/api/groups/:id', (req, res) => db.run("DELETE FROM groups WHERE id = ?", [req.params.id], (e)=>res.json({success:true})));

// Catch-all for SPA
app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({error:'Not found'});
    
    // Explicit mappings for SPA
    if (req.path === '/chat') return res.sendFile(path.join(__dirname, 'public', 'chat.html'));
    if (req.path === '/admin') return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
    
    // Check if file exists in public
    const publicPath = path.join(__dirname, 'public', req.path);
    if (fs.existsSync(publicPath) && fs.lstatSync(publicPath).isFile()) {
        return res.sendFile(publicPath);
    }
    
    // Default to index.html in public
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) res.sendFile(indexPath);
    else res.status(404).send('Error: public/index.html not found.');
});

// Auto-detect port
function startServer(port) {
    const server = app.listen(port, () => console.log(`Server running on port ${port}`));
    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.log(`⚠️ Port ${port} is in use, trying ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error(e);
        }
    });
}

startServer(DEFAULT_PORT);
