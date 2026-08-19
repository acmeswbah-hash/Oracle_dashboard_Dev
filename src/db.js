'use strict';
 
/**

* src/db.js — Oracle connection helper

*/
 
const oracledb = require('oracledb');
 
const REQUIRED = ['DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_SERVICE'];

const missing  = REQUIRED.filter(k => !process.env[k]);

if (missing.length) {

  console.error('[db] FATAL — missing .env variables:', missing.join(', '));

  process.exit(1);

}
 
if (!process.env.ORACLE_CLIENT_LIB) {

  console.error('[db] FATAL — ORACLE_CLIENT_LIB not set in .env');

  process.exit(1);

}

try {

  oracledb.initOracleClient({ libDir: process.env.ORACLE_CLIENT_LIB });

  console.log('[db] Thick mode —', process.env.ORACLE_CLIENT_LIB);

} catch (e) {

  if (!e.message.includes('already initialized')) {

    console.error('[db] Instant Client error:', e.message);

    process.exit(1);

  }

}
 
oracledb.outFormat     = oracledb.OUT_FORMAT_OBJECT;

oracledb.autoCommit    = false;

oracledb.fetchAsString = [oracledb.CLOB];
 
const DB_CONFIG = {

  user:          process.env.DB_USER,

  password:      process.env.DB_PASSWORD,

  connectString: `${process.env.DB_HOST}:${process.env.DB_PORT || '1521'}/${process.env.DB_SERVICE}`,

};
 
async function query(sql, binds, maxRows = 10000) {

  let conn;

  try {

    conn = await oracledb.getConnection(DB_CONFIG);

    const opts = { outFormat: oracledb.OUT_FORMAT_OBJECT, maxRows };

    const hasBinds = binds && typeof binds === 'object' && Object.keys(binds).length > 0;

    // In oracledb Thick mode, pass binds as positional array [] when no binds,

    // or named object when binds exist

    const result = await conn.execute(sql, hasBinds ? binds : [], opts);

    return (result.rows || []).map(row => {

      const out = {};

      for (const [k, v] of Object.entries(row))

        out[k.toLowerCase()] = v instanceof Date ? v.toISOString() : (v ?? null);

      return out;

    });

  } finally {

    if (conn) try { await conn.close(); } catch (_) {}

  }

}
 
async function ping() {

  let conn;

  try {

    conn = await oracledb.getConnection(DB_CONFIG);

    await conn.execute('SELECT 1 FROM DUAL', [], { outFormat: oracledb.OUT_FORMAT_OBJECT });

    return { ok: true, user: DB_CONFIG.user, connectString: DB_CONFIG.connectString };

  } finally {

    if (conn) try { await conn.close(); } catch (_) {}

  }

}
 
module.exports = { query, ping, DB_CONFIG };
 