import { Pool } from 'pg';
const pool = new Pool({ connectionString: 'postgresql://zfloat:zfloat_dev_password@127.0.0.1:5432/zfloat', max: 1 });
const result = await pool.query('SELECT 1');
console.log('Connected:', result.rows);
await pool.end();
