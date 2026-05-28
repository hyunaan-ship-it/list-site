const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');

if(!process.env.DATABASE_URL) { console.warn('DATABASE_URL is missing, skipping init-db if run directly. Please configure it in Render.'); }
console.log('Connecting to Postgres Database...');

// Delete old database to cleanly recreate with new columns


// postgres uses pool

// Create tables
(async () => {
console.log('Creating database tables...');
await pool.query(`
  CREATE TABLE IF NOT EXISTS employees (
    emp_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    gender TEXT,
    position TEXT NOT NULL,
    department TEXT NOT NULL,
    email TEXT,
    phone TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    emp_id TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT CHECK(role IN ('ADMIN', 'LEADER')) DEFAULT 'LEADER',
    last_login TIMESTAMP,
    FOREIGN KEY (emp_id) REFERENCES employees(emp_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS training_dates (
    date_id SERIAL PRIMARY KEY,
    training_date TEXT NOT NULL UNIQUE, -- YYYY-MM-DD
    title TEXT NOT NULL,                -- e.g. "1차수 (11.04)"
    max_capacity INTEGER DEFAULT 60,    -- STRICT 60 CAPACITY
    status TEXT CHECK(status IN ('ACTIVE', 'CLOSED')) DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS registrations (
    reg_id SERIAL PRIMARY KEY,
    date_id INTEGER NOT NULL,
    emp_id TEXT NOT NULL,
    leader_emp_id TEXT NOT NULL,
    parent_center TEXT,                 -- 모센터
    sub_center TEXT,                    -- 분소센터
    registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (date_id) REFERENCES training_dates(date_id) ON DELETE CASCADE,
    FOREIGN KEY (emp_id) REFERENCES employees(emp_id) ON DELETE CASCADE,
    FOREIGN KEY (leader_emp_id) REFERENCES employees(emp_id) ON DELETE CASCADE,
    UNIQUE(date_id, emp_id)
  );

  CREATE INDEX IF NOT EXISTS idx_reg_leader ON registrations(leader_emp_id);
  CREATE INDEX IF NOT EXISTS idx_reg_date ON registrations(date_id);
`);

console.log('Tables created successfully.');

// Helper function to clean names (e.g. "김성은.Se Eun Kim.金世恩" -> "김성은")
function cleanName(rawName) {
  if (!rawName) return '';
  const str = String(rawName).trim();
  const dotIndex = str.indexOf('.');
  if (dotIndex !== -1) {
    return str.substring(0, dotIndex).trim();
  }
  return str;
}

// Helper function to clean cellular numbers (e.g. "010★5561★7452" -> "010-5561-7452")
function cleanPhone(rawPhone) {
  if (!rawPhone) return '';
  let str = String(rawPhone).trim();
  str = str.replace(/★/g, '-');
  return str;
}

// Helper function to clean department names (e.g. "BK110A.AI선행개발팀" -> "AI선행개발팀")
function cleanDepartment(rawDept) {
  if (!rawDept) return '소속없음';
  const str = String(rawDept).trim();
  const dotIndex = str.indexOf('.');
  if (dotIndex !== -1) {
    return str.substring(dotIndex + 1).trim();
  }
  return str;
}

// Helper function to clean gender
function cleanGender(rawGender) {
  if (!rawGender) return '';
  const str = String(rawGender).trim().toUpperCase();
  if (str === 'M' || str === '남' || str === '男' || str === 'MALE') return '남';
  if (str === 'F' || str === '여' || str === '女' || str === 'FEMALE') return '여';
  return str;
}

// Check if Excel data should be loaded
const empCountRes = await pool.query('SELECT COUNT(*) as count FROM employees');
const empCount = parseInt(empCountRes.rows[0].count);

if (empCount === 0) {
  const excelPath = path.join(__dirname, '..', '26년_1월 인사정보.xlsx');
  if (fs.existsSync(excelPath)) {
    console.log('Loading Excel data from:', excelPath);
    console.log('Reading Excel file... (this may take a few seconds due to file size)');
    
    const workbook = XLSX.readFile(excelPath);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    console.log('Converting sheet to JSON...');
    const rows = XLSX.utils.sheet_to_json(worksheet);
    console.log(`Found ${rows.length} rows in the Excel file.`);

    console.log('Inserting employees in a single transaction...');
    const insertEmp = 'INSERT INTO employees (emp_id, name, gender, position, department, email, phone) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (emp_id) DO UPDATE SET name=EXCLUDED.name, gender=EXCLUDED.gender, position=EXCLUDED.position, department=EXCLUDED.department, email=EXCLUDED.email, phone=EXCLUDED.phone';

    const insertTransaction = async (employeeRows) => {
      let count = 0;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const row of employeeRows) {
          const empIdRaw = row['사원번호'];
          if (!empIdRaw) continue;

          const empId = String(empIdRaw).trim();
          const name = cleanName(row['성명']);
          const gender = cleanGender(row['성별']);
          const position = String(row['직위호칭'] || row['POSITION'] || '사원').trim();
          const department = cleanDepartment(row['조직'] || row['ORG2'] || '');
          const email = String(row['메일ID'] || '').trim();
          const phone = cleanPhone(row['CELLULAR_NO']);

          await client.query(insertEmp, [empId, name, gender, position, department, email, phone]);
          count++;
        }
        await client.query('COMMIT');
      } catch(e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      return count;
    };

    const insertedCount = await insertTransaction(rows);
    console.log(`Successfully imported ${insertedCount} employees into the database.`);
  } else {
    console.warn(`Excel file not found at: ${excelPath}. Skipped importing.`);
  }
} else {
  console.log(`Employees table already has ${empCount} records. Skipping Excel import.`);
}

// Create admin user
const adminEmpId = 'admin';
const adminEmpExistsRes = await pool.query('SELECT COUNT(*) as count FROM employees WHERE emp_id = $1', [adminEmpId]);
const adminEmpExists = parseInt(adminEmpExistsRes.rows[0].count);
if (adminEmpExists === 0) {
  await pool.query('INSERT INTO employees (emp_id, name, gender, position, department, email, phone) VALUES ($1, $2, $3, $4, $5, $6, $7)', [adminEmpId, '관리자', '남', '운영진', 'HR팀', 'admin@company.com', '010-0000-0000']);
}

const adminUserExistsRes = await pool.query('SELECT COUNT(*) as count FROM users WHERE emp_id = $1', [adminEmpId]);
const adminUserExists = parseInt(adminUserExistsRes.rows[0].count);
if (adminUserExists === 0) {
  console.log('Creating default admin user...');
  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync('admin123', salt);
  await pool.query('INSERT INTO users (emp_id, password_hash, role) VALUES ($1, $2, $3)', [adminEmpId, passwordHash, 'ADMIN']);
  console.log('Admin account created: emp_id: "admin", password: "admin123"');
}

// Seed the specific multi-session dates (Strictly 60 limit per session)
const dateCountRes = await pool.query('SELECT COUNT(*) as count FROM training_dates');
const dateCount = parseInt(dateCountRes.rows[0].count);
if (dateCount === 0) {
  console.log('Seeding specific multi-session dates (Strictly 60 limit)...');
  const insertDate = 'INSERT INTO training_dates (training_date, title, max_capacity, status) VALUES ($1, $2, $3, $4)';
  
  // Specific course sessions
  await pool.query(insertDate, ['2026-11-04', '1차수 (11.04)', 60, 'ACTIVE']);
  await pool.query(insertDate, ['2026-11-11', '2차수 (11.11)', 60, 'ACTIVE']);
  await pool.query(insertDate, ['2026-11-18', '3차수 (11.18)', 60, 'ACTIVE']);
  await pool.query(insertDate, ['2026-11-25', '4차수 (11.25)', 60, 'ACTIVE']);
  await pool.query(insertDate, ['2026-12-02', '5차수 (12.02)', 60, 'ACTIVE']);
  console.log('Sessions seeded successfully.');
}

console.log('Database initialization completed successfully.');
await pool.end();
})();
