const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const { Pool } = require('pg');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 5000;

// Render (and most cloud platforms) run behind a reverse proxy.
// This is required for secure session cookies to work over HTTPS.
app.set('trust proxy', 1);

// Connect to Database
// Connect to Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const db = {
  prepare: (query) => {
    let i = 1;
    const pgQuery = query.replace(/\?/g, () => `$${i++}`);
    return {
      get: async (...args) => {
        const res = await pool.query(pgQuery, args);
        return res.rows[0];
      },
      all: async (...args) => {
        const res = await pool.query(pgQuery, args);
        return res.rows;
      },
      run: async (...args) => {
        let finalQuery = pgQuery;
        if (/^\s*INSERT\s/i.test(finalQuery)) {
          finalQuery += ' RETURNING *';
        }
        const res = await pool.query(finalQuery, args);
        const firstRow = res.rows[0];
        const lastId = firstRow ? (firstRow.reg_id || firstRow.date_id || firstRow.id) : null;
        return { lastInsertRowid: lastId, changes: res.rowCount };
      }
    };
  },
  transaction: (callback) => {
    return async (list) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        // callback에 전달하기 위해 래퍼 교체 필요하지만, 
        // 래퍼 없이 글로벌 pool을 사용해도 됨 (단, 동시성 문제가 있을 수 있으나 소규모 앱이므로 일단 pool 통일)
        // 트랜잭션 내에서 await 처리가 필요하므로 callback 내부도 비동기로 변경되어야 함
        await callback(list); 

        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    };
  },
  exec: async (query) => {
    return pool.query(query);
  }
};

(async () => {
// Database Migration: Add 'region' column if not exists
try {
  await await db.exec("ALTER TABLE training_dates ADD COLUMN region TEXT DEFAULT '수도권'");
  console.log("Database Migration Success: Added 'region' column to training_dates");
} catch (e) {
  // Column already exists, safe to ignore
}

// Defensive Admin Auto-Repair Block
try {
  const adminEmpId = 'admin';
  const ADMIN_DEFAULT_PASSWORD = 'lgadmin';

  const adminEmpExists = await db.prepare('SELECT COUNT(*) as count FROM employees WHERE emp_id = ?').get(adminEmpId).then(r => Number(r.count));
  if (adminEmpExists === 0) {
    await db.prepare(`
      INSERT INTO employees (emp_id, name, gender, position, department, email, phone)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(adminEmpId, '관리자', '남', '운영진', 'HR팀', 'admin@company.com', '010-0000-0000');
    console.log('Auto-repaired: admin employee record created.');
  }

  const adminUser = await db.prepare('SELECT * FROM users WHERE emp_id = ?').get(adminEmpId);
  if (!adminUser) {
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(ADMIN_DEFAULT_PASSWORD, salt);
    await db.prepare(`
      INSERT INTO users (emp_id, password_hash, role)
      VALUES (?, ?, ?)
    `).run(adminEmpId, passwordHash, 'ADMIN');
    console.log(`Auto-repaired: admin user record created (Password: ${ADMIN_DEFAULT_PASSWORD}).`);
  } else {
    // 기존 admin 비밀번호가 'lgadmin'와 일치하지 않으면 재설정
    const isMatch = bcrypt.compareSync(ADMIN_DEFAULT_PASSWORD, adminUser.password_hash);
    if (!isMatch) {
      const salt = bcrypt.genSaltSync(10);
      const passwordHash = bcrypt.hashSync(ADMIN_DEFAULT_PASSWORD, salt);
      await db.prepare('UPDATE users SET password_hash = ? WHERE emp_id = ?').run(passwordHash, adminEmpId);
      console.log(`Auto-repaired: admin password reset to '${ADMIN_DEFAULT_PASSWORD}'.`);
    } else {
      console.log('Admin account OK.');
    }
  }
} catch (e) {
  console.error('Admin auto-repair error:', e);
}
})();

// Middleware
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5000',
  'https://hyunaan-ship-it.github.io',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // origin이 없으면 같은 서버에서 온 요청 (서버사이드 등)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: ${origin} 허용되지 않은 출처입니다.`));
    }
  },
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session management
// Postgres Session Store
app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'sessions',
    createTableIfMissing: true
  }),
  secret: 'company-training-secret-key-123',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 1 day
  }
}));

// Note: Frontend is served via GitHub Pages. This server is API-only.

// Helper to format phone number
function formatPhone(phone) {
  if (!phone) return '';
  return phone.replace(/★/g, '-');
}

// Authentication Middlewares
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ error: '로그인이 필요한 서비스입니다.' });
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ error: '로그인이 필요한 서비스입니다.' });
  }
  if (req.session.user.role !== 'ADMIN') {
    return res.status(403).json({ error: '운영진 권한이 필요합니다.' });
  }
  next();
};

// ==========================================
// 1. AUTHENTICATION API (/api/v1/auth)
// ==========================================

// Login
app.post('/api/v1/auth/login', async (req, res) => {
  const { emp_id, password } = req.body;

  if (!emp_id || !password) {
    return res.status(400).json({ error: '사번과 비밀번호를 모두 입력해주세요.' });
  }

  try {
    const rawEmpId = String(emp_id).trim();
    const trimmedEmpId = rawEmpId.toLowerCase() === 'admin' ? 'admin' : rawEmpId;
    
    const employee = await db.prepare('SELECT * FROM employees WHERE emp_id = ?').get(trimmedEmpId);
    if (!employee) {
      return res.status(401).json({ error: '존재하지 않는 사번입니다. 사번을 다시 확인해주세요.' });
    }

    let user = await db.prepare('SELECT * FROM users WHERE emp_id = ?').get(trimmedEmpId);

    // Dynamic sign-up for existing employees with default password 'lg[사번]' (with legacy '1234' & 'lg[사번]!' fallbacks)
    if (!user) {
      const defaultPassword = `lg${trimmedEmpId}`;
      const legacyPasswordWithExclamation = `lg${trimmedEmpId}!`;
      if (password === defaultPassword || password === legacyPasswordWithExclamation || password === '1234') {
        const salt = bcrypt.genSaltSync(10);
        const hash = bcrypt.hashSync(password, salt);
        await db.prepare('INSERT INTO users (emp_id, password_hash, role) VALUES (?, ?, ?)').run(trimmedEmpId, hash, 'LEADER');
        user = await db.prepare('SELECT * FROM users WHERE emp_id = ?').get(trimmedEmpId);
      } else {
        return res.status(401).json({ error: `초기 비밀번호는 lg[사번] 형식입니다. (예: lg${trimmedEmpId})` });
      }
    } else {
      const isMatch = bcrypt.compareSync(password, user.password_hash);
      if (!isMatch) {
        return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
      }
    }

    await db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = ?').run(user.user_id);

    req.session.user = {
      emp_id: employee.emp_id,
      name: employee.name,
      role: user.role,
      position: employee.position,
      department: employee.department
    };

    res.json({ message: '로그인에 성공했습니다.', user: req.session.user });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.', message: error.message, stack: error.stack });
  }
});

// Logout
app.post('/api/v1/auth/logout', async (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: '로그아웃 실패' });
    }
    res.clearCookie('connect.sid');
    res.json({ message: '로그아웃 되었습니다.' });
  });
});

// Get current session user info
app.get('/api/v1/auth/me', async (req, res) => {
  if (req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.json({ user: null });
  }
});

// ==========================================
// 2. EMPLOYEE API (/api/v1/employee)
// ==========================================

// Lookup single employee by ID (with global duplicate session check)
app.get('/api/v1/employee/:emp_id', requireAuth, async (req, res) => {
  const { emp_id } = req.params;
  try {
    const employee = await db.prepare('SELECT emp_id, name, gender, position, department, email, phone FROM employees WHERE emp_id = ?').get(emp_id);
    if (!employee) {
      return res.status(404).json({ error: '존재하지 않는 사번입니다.' });
    }
    
    // Check global duplicate session registration
    const reg = await db.prepare(`
      SELECT t.title 
      FROM registrations r 
      JOIN training_dates t ON r.date_id = t.date_id 
      WHERE r.emp_id = ?
    `).get(emp_id);
    employee.registered_session = reg ? reg.title : null;
    
    employee.phone = formatPhone(employee.phone);
    res.json(employee);
  } catch (error) {
    console.error('Employee query error:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// [BULK LOOKUP] Query multiple employee details (with global duplicate session check)
app.post('/api/v1/employee/bulk-lookup', requireAuth, async (req, res) => {
  const { emp_ids } = req.body;
  if (!emp_ids || !Array.isArray(emp_ids) || emp_ids.length === 0) {
    return res.status(400).json({ error: '조회할 사번 목록이 비어있습니다.' });
  }

  try {
    // Unique clean IDs to prevent massive SQL injections or DB load
    const cleanIds = Array.from(new Set(emp_ids.map(id => String(id).trim()).filter(id => id.length > 0)));
    if (cleanIds.length === 0) {
      return res.json({});
    }

    // SQLite parameters placeholders
    const placeholders = cleanIds.map(() => '?').join(',');
    
    // Join with registrations and training_dates to retrieve registered_session in a single optimized query!
    const query = `
      SELECT e.emp_id, e.name, e.gender, e.position, e.department, e.email, e.phone,
             t.title as registered_session
      FROM employees e
      LEFT JOIN registrations r ON e.emp_id = r.emp_id
      LEFT JOIN training_dates t ON r.date_id = t.date_id
      WHERE e.emp_id IN (${placeholders})
    `;
    
    const matched = await db.prepare(query).all(cleanIds);
    
    // Map them for quick O(1) front-end lookup
    const resultMap = {};
    matched.forEach(emp => {
      emp.phone = formatPhone(emp.phone);
      resultMap[emp.emp_id] = emp;
    });

    res.json(resultMap);
  } catch (error) {
    console.error('Bulk employee lookup error:', error);
    res.status(500).json({ error: '서버 조회 처리 중 오류가 발생했습니다.' });
  }
});

// ==========================================
// 3. SCHEDULE API (/api/v1/schedule)
// ==========================================

// Get all schedules (with global registration counts)
app.get('/api/v1/schedule', requireAuth, async (req, res) => {
  try {
    const schedules = await db.prepare(`
      SELECT t.*, 
             (SELECT COUNT(*) FROM registrations WHERE date_id = t.date_id) as current_count
      FROM training_dates t
      ORDER BY t.training_date ASC
    `).all();
    schedules.forEach(s => s.current_count = Number(s.current_count));
    res.json(schedules);
  } catch (error) {
    console.error('Schedule fetch error:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// Create schedule (Admin only)
app.post('/api/v1/schedule', requireAdmin, async (req, res) => {
  const { training_date, title, max_capacity, region } = req.body;
  if (!training_date) {
    return res.status(400).json({ error: '날짜를 입력해주세요.' });
  }

  // 8-digit numeric string formatting helper (e.g. 20261109 -> 2026-11-09)
  let formattedDate = String(training_date).trim();
  if (/^\d{8}$/.test(formattedDate)) {
    formattedDate = formattedDate.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  }

  // Date format pattern verification (must be YYYY-MM-DD or similar)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(formattedDate)) {
    return res.status(400).json({ error: '올바른 날짜 형식이 아닙니다. (예: 2026-11-09 또는 20261109)' });
  }

  // Auto-generate title if not specified by user
  let targetTitle = title ? String(title).trim() : '';
  if (!targetTitle) {
    const parts = formattedDate.split('-');
    if (parts.length === 3) {
      targetTitle = `${parts[1]}.${parts[2]}`;
    } else {
      targetTitle = formattedDate;
    }
  }

  const targetRegion = region ? String(region).trim() : '수도권';

  try {
    const capacity = parseInt(max_capacity) || 60; // Strict default 60 capacity
    const result = await db.prepare(`
      INSERT INTO training_dates (training_date, title, max_capacity, region)
      VALUES (?, ?, ?, ?)
    `).run(formattedDate, targetTitle, capacity, targetRegion);
    
    const newSchedule = {
      date_id: result.lastInsertRowid,
      training_date: formattedDate,
      title: targetTitle,
      max_capacity: capacity,
      region: targetRegion,
      status: 'ACTIVE'
    };
    res.status(201).json(newSchedule);
  } catch (error) {
    console.error('Schedule create error:', error);
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ error: '해당 날짜에 이미 등록된 교육 일정이 있습니다.' });
    }
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// Bulk Delete schedules (Admin only)
app.post('/api/v1/schedule/bulk-delete', requireAdmin, async (req, res) => {
  const { date_ids } = req.body;
  if (!date_ids || !Array.isArray(date_ids) || date_ids.length === 0) {
    return res.status(400).json({ error: '삭제할 차수 ID 목록이 비어있습니다.' });
  }
  try {
    const placeholders = date_ids.map(() => '?').join(',');
    await db.prepare(`DELETE FROM training_dates WHERE date_id IN (${placeholders})`).run(date_ids);
    res.json({ message: `${date_ids.length}개의 교육 차수가 성공적으로 삭제되었습니다.` });
  } catch (error) {
    console.error('Bulk schedule delete error:', error);
    res.status(500).json({ error: '서버 삭제 처리 중 오류가 발생했습니다.' });
  }
});

// Update schedule status/info (Admin only)
app.put('/api/v1/schedule/:date_id', requireAdmin, async (req, res) => {
  const { date_id } = req.params;
  const { title, max_capacity, status, region } = req.body;

  try {
    await db.prepare(`
      UPDATE training_dates 
      SET title = COALESCE(?, title),
          max_capacity = COALESCE(?, max_capacity),
          status = COALESCE(?, status),
          region = COALESCE(?, region)
      WHERE date_id = ?
    `).run(title, max_capacity, status, region, date_id);
    
    res.json({ message: '교육 일정이 수정되었습니다.' });
  } catch (error) {
    console.error('Schedule update error:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// Delete schedule (Admin only)
app.delete('/api/v1/schedule/:date_id', requireAdmin, async (req, res) => {
  const { date_id } = req.params;
  try {
    await db.prepare('DELETE FROM training_dates WHERE date_id = ?').run(date_id);
    res.json({ message: '교육 일정이 삭제되었습니다.' });
  } catch (error) {
    console.error('Schedule delete error:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ==========================================
// 4. REGISTRATION API (/api/v1/registration)
// ==========================================

// Get registrations (Filtered by user role - sorted ASC for 1차수 at top)
app.get('/api/v1/registration', requireAuth, async (req, res) => {
  const user = req.session.user;
  try {
    let registrations = [];
    if (user.role === 'ADMIN') {
      registrations = await db.prepare(`
        SELECT r.reg_id, r.date_id, r.emp_id, r.leader_emp_id, r.parent_center, r.sub_center, r.registered_at,
               t.training_date, t.title as training_title,
               e.name as emp_name, e.gender as emp_gender, e.position as emp_position, e.department as emp_dept, e.phone as emp_phone,
               l.name as leader_name, l.department as leader_dept
        FROM registrations r
        JOIN training_dates t ON r.date_id = t.date_id
        JOIN employees e ON r.emp_id = e.emp_id
        JOIN employees l ON r.leader_emp_id = l.emp_id
        ORDER BY t.training_date ASC, r.registered_at ASC
      `).all();
    } else {
      registrations = await db.prepare(`
        SELECT r.reg_id, r.date_id, r.emp_id, r.leader_emp_id, r.parent_center, r.sub_center, r.registered_at,
               t.training_date, t.title as training_title,
               e.name as emp_name, e.gender as emp_gender, e.position as emp_position, e.department as emp_dept, e.phone as emp_phone
        FROM registrations r
        JOIN training_dates t ON r.date_id = t.date_id
        JOIN employees e ON r.emp_id = e.emp_id
        JOIN employees l ON l.emp_id = ?
        WHERE r.leader_emp_id = l.emp_id OR e.department = l.department
        ORDER BY t.training_date ASC, r.registered_at ASC
      `).all(user.emp_id);
    }
    
    registrations.forEach(reg => {
      reg.emp_phone = formatPhone(reg.emp_phone);
    });

    res.json(registrations);
  } catch (error) {
    console.error('Registration fetch error:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// [BULK UPDATE REGISTRATIONS] Update multiple registration dates at once (Admin bypasses capacity, Leaders validated)
app.post('/api/v1/registration/bulk-update', requireAuth, async (req, res) => {
  const { updates } = req.body;
  const user = req.session.user;

  if (!updates || !Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: '업데이트할 변경 내역이 없습니다.' });
  }

  try {
    const isAdmin = user.role === 'ADMIN';
    const targets = [];
    const sessionChangeDeltas = {}; // date_id -> net change count

    for (const up of updates) {
      const reg = await db.prepare('SELECT * FROM registrations WHERE reg_id = ?').get(up.reg_id);
      if (!reg) {
        return res.status(404).json({ error: `신청 내역(ID: ${up.reg_id})을 찾을 수 없습니다.` });
      }
      if (!isAdmin && reg.leader_emp_id !== user.emp_id) {
        return res.status(403).json({ error: '본인이 등록한 신청 내역만 수정 가능합니다.' });
      }
      
      const oldDateId = reg.date_id;
      const newDateId = Number(up.date_id);
      if (oldDateId !== newDateId) {
        targets.push({ reg, newDateId });
        sessionChangeDeltas[oldDateId] = (sessionChangeDeltas[oldDateId] || 0) - 1;
        sessionChangeDeltas[newDateId] = (sessionChangeDeltas[newDateId] || 0) + 1;
      }
    }

    if (targets.length === 0) {
      return res.json({ message: '변경사항이 없습니다.' });
    }

    // Check capacity limit for leaders (Admin bypasses!)
    if (!isAdmin) {
      for (const [dateIdStr, delta] of Object.entries(sessionChangeDeltas)) {
        const dateId = Number(dateIdStr);
        if (delta > 0) {
          const session = await db.prepare('SELECT title, max_capacity, (SELECT COUNT(*) FROM registrations WHERE date_id = ?) as current_count FROM training_dates WHERE date_id = ?').get(dateId, dateId);
          if (!session) {
            return res.status(404).json({ error: '선택하신 교육 차수 일정이 존재하지 않습니다.' });
          }
          const maxCap = session.max_capacity || 60;
          const currCount = Number(session.current_count);
          if (currCount + delta > maxCap) {
            return res.status(400).json({ error: `[정원 초과] ${session.title}는 정원(${maxCap}명)을 초과하여 변경할 수 없습니다. (현재: ${currCount}명, 추가하려는 수: ${delta}명)` });
          }
        }
      }
    }

    // Execute inside a single SQLite transaction
    const updateStmt = await db.prepare('UPDATE registrations SET date_id = ? WHERE reg_id = ?');
    
    const runTx = db.transaction(async (list) => {
      for (const item of list) {
        await updateStmt.run(item.newDateId, item.reg.reg_id);
      }
    });

    runTx(targets);

    res.json({ message: `성공적으로 ${targets.length}건의 교육 신청 정보가 일괄 저장되었습니다.` });
  } catch (error) {
    console.error('Bulk update registrations error:', error);
    res.status(500).json({ error: '서버 일괄 저장 처리 중 오류가 발생했습니다.' });
  }
});

// [BULK REGISTRATION] Register multiple employees under 60-person strict limit (Admin bypasses capacity)
app.post('/api/v1/registration/bulk', requireAuth, async (req, res) => {
  const user = req.session.user;
  const { date_id, registrations } = req.body;

  if (!date_id || !registrations || !Array.isArray(registrations) || registrations.length === 0) {
    return res.status(400).json({ error: '등록할 일정 및 대상자 데이터가 올바르지 않습니다.' });
  }

  try {
    const isAdmin = user.role === 'ADMIN';

    // 1. Fetch Session Info & Strict Max Capacity
    const targetSession = await db.prepare('SELECT title, status, max_capacity, (SELECT COUNT(*) FROM registrations WHERE date_id = ?) as current_count FROM training_dates WHERE date_id = ?').get(date_id, date_id);
    
    if (!targetSession) {
      return res.status(404).json({ error: '선택된 차수 일정이 존재하지 않습니다.' });
    }
    if (targetSession.status !== 'ACTIVE') {
      return res.status(400).json({ error: '해당 차수는 이미 마감되어 추가 등록할 수 없습니다.' });
    }

    const maxCapacity = targetSession.max_capacity || 60;
    const currentCount = Number(targetSession.current_count);
    const remainingSpots = maxCapacity - currentCount;

    // Admin bypasses capacity check!
    if (!isAdmin && registrations.length > remainingSpots) {
      return res.status(400).json({ 
        error: `[등록 정원 초과] 선택하신 차수(정원: ${maxCapacity}명)에는 현재 ${remainingSpots}명만 추가 등록이 가능합니다. (신청하려는 인원: ${registrations.length}명)` 
      });
    }

    // 2. Perform Batch Insertion in a single SQLite Transaction
    const insertStatement = await db.prepare(`
      INSERT INTO registrations (date_id, emp_id, leader_emp_id, parent_center, sub_center)
      VALUES (?, ?, ?, ?, ?)
    `);

    // We keep track of successful and duplicated registrations
    let successCount = 0;
    let duplicateCount = 0;
    const duplicates = [];

    const runBulkTx = db.transaction(async (list) => {
      for (const item of list) {
        const empId = String(item.emp_id).trim();
        const pCenter = item.parent_center ? String(item.parent_center).trim() : '';
        const sCenter = item.sub_center ? String(item.sub_center).trim() : '';

        // Verify if already registered globally in any session!
        const globalReg = await db.prepare(`
          SELECT t.title 
          FROM registrations r 
          JOIN training_dates t ON r.date_id = t.date_id 
          WHERE r.emp_id = ?
        `).get(empId);

        if (globalReg) {
          duplicateCount++;
          const empInfo = await db.prepare('SELECT name FROM employees WHERE emp_id = ?').get(empId);
          duplicates.push(`${empInfo ? empInfo.name : empId}(이미 ${globalReg.title}에 등록됨)`);
          continue;
        }

        await insertStatement.run(date_id, empId, user.emp_id, pCenter, sCenter);
        successCount++;
      }
    });

    runBulkTx(registrations);

    res.status(201).json({
      message: `총 ${successCount}명의 임직원 등록이 완료되었습니다.`,
      successCount,
      duplicateCount,
      duplicates,
    });

  } catch (error) {
    console.error('Bulk registration error:', error);
    res.status(500).json({ error: '서버 예약 처리 중 심각한 오류가 발생했습니다. 데이터를 확인해주세요.' });
  }
});

// Single employee register (Admin bypasses capacity)
app.post('/api/v1/registration', requireAuth, async (req, res) => {
  const user = req.session.user;
  const { date_id, emp_id, parent_center, sub_center } = req.body;

  if (!date_id || !emp_id) {
    return res.status(400).json({ error: '교육 일정과 사번을 지정해주세요.' });
  }

  try {
    const trimmedEmpId = String(emp_id).trim();
    const isAdmin = user.role === 'ADMIN';

    const targetEmp = await db.prepare('SELECT name FROM employees WHERE emp_id = ?').get(trimmedEmpId);
    if (!targetEmp) {
      return res.status(400).json({ error: '존재하지 않는 사번입니다.' });
    }

    const targetDate = await db.prepare('SELECT status, max_capacity, (SELECT COUNT(*) FROM registrations WHERE date_id = ?) as current_count FROM training_dates WHERE date_id = ?').get(date_id, date_id);
    if (!targetDate) {
      return res.status(400).json({ error: '존재하지 않는 교육 일정입니다.' });
    }
    if (targetDate.status !== 'ACTIVE') {
      return res.status(400).json({ error: '이미 마감된 교육 일정입니다.' });
    }
    
    const maxCapacity = targetDate.max_capacity || 60;
    // Admin bypasses capacity check!
    if (!isAdmin && Number(targetDate.current_count) >= maxCapacity) {
      return res.status(400).json({ error: `정원 초과! 한 차수에는 최대 ${maxCapacity}명까지만 등록할 수 있습니다.` });
    }

    const result = await db.prepare(`
      INSERT INTO registrations (date_id, emp_id, leader_emp_id, parent_center, sub_center)
      VALUES (?, ?, ?, ?, ?)
    `).run(date_id, trimmedEmpId, user.emp_id, parent_center || '', sub_center || '');

    res.status(201).json({
      message: `${targetEmp.name}님의 교육 신청이 정상 접수되었습니다.`,
      reg_id: result.lastInsertRowid
    });
  } catch (error) {
    console.error('Registration create error:', error);
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ error: '이 직원은 이미 해당 날짜 교육에 등록되어 있습니다.' });
    }
    res.status(500).json({ error: '서버 신청 중 오류가 발생했습니다.' });
  }
});

// Edit registration (Admin bypasses capacity check)
app.put('/api/v1/registration/:reg_id', requireAuth, async (req, res) => {
  const { reg_id } = req.params;
  const { date_id, parent_center, sub_center } = req.body;
  const user = req.session.user;

  try {
    const reg = await db.prepare('SELECT * FROM registrations WHERE reg_id = ?').get(reg_id);
    if (!reg) {
      return res.status(404).json({ error: '신청 내역을 찾을 수 없습니다.' });
    }

    const isAdmin = user.role === 'ADMIN';

    // Authorization
    if (!isAdmin && reg.leader_emp_id !== user.emp_id) {
      return res.status(403).json({ error: '수정할 권한이 없습니다.' });
    }

    // If changing the session, check strict 60 capacity constraint (Admin bypasses!)
    if (date_id && Number(date_id) !== reg.date_id) {
      const targetSession = await db.prepare('SELECT title, max_capacity, (SELECT COUNT(*) FROM registrations WHERE date_id = ?) as current_count FROM training_dates WHERE date_id = ?').get(date_id, date_id);
      if (!targetSession) {
        return res.status(404).json({ error: '선택하신 차수 일정이 존재하지 않습니다.' });
      }
      const maxCap = targetSession.max_capacity || 60;
      // Admin bypasses capacity check!
      if (!isAdmin && Number(targetSession.current_count) >= maxCap) {
        return res.status(400).json({ error: `[이동 불가] 변경하려는 ${targetSession.title}는 이미 정원(${maxCap}명)이 마감되었습니다.` });
      }
    }

    await db.prepare(`
      UPDATE registrations
      SET date_id = COALESCE(?, date_id),
          parent_center = COALESCE(?, parent_center),
          sub_center = COALESCE(?, sub_center)
      WHERE reg_id = ?
    `).run(date_id, parent_center, sub_center, reg_id);

    res.json({ message: '신청 정보가 성공적으로 수정되었습니다.' });
  } catch (error) {
    console.error('Update registration error:', error);
    res.status(500).json({ error: '서버 업데이트 중 오류가 발생했습니다.' });
  }
});

// Cancel registration
app.delete('/api/v1/registration/:reg_id', requireAuth, async (req, res) => {
  const { reg_id } = req.params;
  const user = req.session.user;

  try {
    const registration = await db.prepare(`
      SELECT r.leader_emp_id, r.emp_id, e.name as emp_name 
      FROM registrations r
      JOIN employees e ON r.emp_id = e.emp_id
      WHERE r.reg_id = ?
    `).get(reg_id);

    if (!registration) {
      return res.status(404).json({ error: '신청 내역을 찾을 수 없습니다.' });
    }

    if (user.role !== 'ADMIN' && registration.leader_emp_id !== user.emp_id) {
      return res.status(403).json({ error: '자신이 등록한 일정만 취소할 수 있습니다.' });
    }

    await db.prepare('DELETE FROM registrations WHERE reg_id = ?').run(reg_id);
    res.json({ message: `${registration.emp_name}님의 교육 신청이 취소되었습니다.` });
  } catch (error) {
    console.error('Registration delete error:', error);
    res.status(500).json({ error: '서버 취소 중 오류가 발생했습니다.' });
  }
});

// Bulk cancel registration
app.post('/api/v1/registration/bulk-delete', requireAuth, async (req, res) => {
  const { reg_ids } = req.body;
  const user = req.session.user;

  if (!reg_ids || !Array.isArray(reg_ids) || reg_ids.length === 0) {
    return res.status(400).json({ error: '취소할 대상이 없습니다.' });
  }

  try {
    const isAdmin = user.role === 'ADMIN';
    let cancelCount = 0;

    const runBulkCancel = db.transaction(async (ids) => {
      for (const id of ids) {
        const registration = await db.prepare('SELECT leader_emp_id FROM registrations WHERE reg_id = ?').get(id);
        if (registration) {
          if (isAdmin || registration.leader_emp_id === user.emp_id) {
            await db.prepare('DELETE FROM registrations WHERE reg_id = ?').run(id);
            cancelCount++;
          }
        }
      }
    });

    runBulkCancel(reg_ids);

    if (cancelCount === 0) {
      return res.status(403).json({ error: '취소할 수 있는 권한이 없거나 대상이 존재하지 않습니다.' });
    }

    res.json({ message: `선택하신 ${cancelCount}건의 교육 신청이 일괄 취소되었습니다.` });
  } catch (error) {
    console.error('Registration bulk delete error:', error);
    res.status(500).json({ error: '서버 일괄 취소 중 오류가 발생했습니다.' });
  }
});

// 404 fallback for unknown API routes
app.use((req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
