'use strict';
 
/**

* src/db.js — Oracle connection helper

*/
 
const fs       = require('fs');
const oracledb = require('oracledb');
 
const REQUIRED = ['DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_SERVICE'];

const missing  = REQUIRED.filter(k => !process.env[k]);

if (missing.length) {

  console.error('[db] FATAL — missing .env variables:', missing.join(', '));

  process.exit(1);

}
 
const clientLib = process.env.ORACLE_CLIENT_LIB;
const hasClient = !!(clientLib && fs.existsSync(clientLib));

if (hasClient) {
  try {
    oracledb.initOracleClient({ libDir: clientLib });
    console.log('[db] Thick mode —', clientLib);
  } catch (e) {
    if (!e.message.includes('already initialized')) {
      console.warn('[db] Instant Client unavailable, using Thin mode:', e.message);
    }
  }
} else {
  console.log('[db] Thin mode — Oracle Instant Client not found (unset ORACLE_CLIENT_LIB on Azure)');
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
 