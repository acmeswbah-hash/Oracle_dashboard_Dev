'use strict';

const express  = require('express');
const { query, ping, DB_CONFIG } = require('./db');
const QUERIES  = require('./queries');
const { extractParams, asyncRoute } = require('./validate');
const { requireAuth } = require('./auth');

const router = express.Router();
 
// ── GET /api/ping ─────────────────────────────────────────────────────────────

router.get('/ping', asyncRoute(async (_req, res) => {

  res.json(await ping());

}));
 
// ── GET /api/config ──────────────────────────────────────────────────────────

router.get('/config', (_req, res) => {

  res.json({
    geminiApiKey: process.env.GEMINI_API_KEY || '',
  });

});

// ── GET /api/business-groups ──────────────────────────────────────────────────

router.get('/business-groups', requireAuth, asyncRoute(async (req, res) => {
  // Always filter by username from Oracle lookup XXACG_AR_DASHBOARD
  // Add user to lookup in Oracle EBS to control their country access
  const username = req.user.username || req.user.email || '';
  const groups = await query(QUERIES.businessGroups, { username });
  res.json(groups || []);
}));
 
// ── GET /api/operating-units?bgId= ───────────────────────────────────────────

router.get('/operating-units', requireAuth, asyncRoute(async (req, res) => {
  const { bgId } = extractParams(req.query, { requireBgId: true });
  let units = await query(QUERIES.operatingUnits, { bgId });
  // Always filter by orgIds stored in JWT token (set at login from Oracle lookup)
  const allowed = (req.user.orgIds || []).map(String);
  if (allowed.length > 0) {
    units = units.filter(u => allowed.includes(String(u.org_id)));
  }
  res.json(units);
}));
 
// ── GET /api/dashboard?bgId=&orgId= ──────────────────────────────────────────

router.get('/dashboard', requireAuth, asyncRoute(async (req, res) => {

  const { bgId, orgId } = extractParams(req.query, { requireBgId: true });

  // For restricted users selecting "All companies" (orgId=0),
  // run sequential queries for each allowed org and merge
  const allowedOrgIds = (req.user.orgIds || []).map(Number).filter(Boolean);
  const isRestricted  = allowedOrgIds.length > 0 && orgId === 0;

  let customerBalance = [], projectBalance = [], agingBuckets = [];

  if (isRestricted) {
    for (const oid of allowedOrgIds) {
      const binds = { bgId, orgId: oid };
      const [cb, pb, ab] = await Promise.all([
        query(QUERIES.customerBalance, binds),
        query(QUERIES.projectBalance,  binds),
        query(QUERIES.agingBuckets,    binds),
      ]);
      customerBalance = customerBalance.concat(cb);
      projectBalance  = projectBalance.concat(pb);
      agingBuckets    = agingBuckets.concat(ab);
    }
  } else {
    const binds = { bgId, orgId };
    [customerBalance, projectBalance, agingBuckets] = await Promise.all([
      query(QUERIES.customerBalance, binds),
      query(QUERIES.projectBalance,  binds),
      query(QUERIES.agingBuckets,    binds),
    ]);
  }

  res.json({

    meta: { bgId, orgId, user: DB_CONFIG.user },

    customerBalance,

    projectBalance,

    agingBuckets,

  });

}));
 
// ── GET /api/customer-balance?bgId=&orgId= ───────────────────────────────────

router.get('/customer-balance', requireAuth, asyncRoute(async (req, res) => {

  const { bgId, orgId } = extractParams(req.query, { requireBgId: true });

  res.json(await query(QUERIES.customerBalance, { bgId, orgId }));

}));
 
// ── GET /api/project-balance?bgId=&orgId= ────────────────────────────────────

router.get('/project-balance', requireAuth, asyncRoute(async (req, res) => {

  const { bgId, orgId } = extractParams(req.query, { requireBgId: true });

  res.json(await query(QUERIES.projectBalance, { bgId, orgId }));

}));
 
// ── GET /api/aging-buckets?bgId=&orgId= ──────────────────────────────────────

router.get('/aging-buckets', requireAuth, asyncRoute(async (req, res) => {

  const { bgId, orgId } = extractParams(req.query, { requireBgId: true });

  res.json(await query(QUERIES.agingBuckets, { bgId, orgId }));

}));
 
// ── POST /api/customer-detail  { custNo, bgId, orgId? } ──────────────────────

router.post('/customer-detail', requireAuth, asyncRoute(async (req, res) => {

  const { bgId, orgId, custNo } = extractParams(req.body, { requireBgId: true, requireCustNo: true });

  res.json(await query(QUERIES.customerDetail, { bgId, orgId, custNo }));

}));
 
// ── POST /api/customer-info  { custNo } ──────────────────────────────────────

// Returns full customer profile: address, tax reg, credit info, class, status

// and all active email addresses — both queries run in parallel using custNo.

router.post('/customer-info', requireAuth, asyncRoute(async (req, res) => {

  const { custNo } = extractParams(req.body, { requireCustNo: true });
 
  // Run both queries in parallel — email query joins hz_cust_accounts_all

  // to get party_id directly, no dependency on the profile query result

  // Run all three queries in parallel
  const [rows, emailRows, creditRows] = await Promise.all([

    query(QUERIES.customerInfo,   { custNo }),

    query(QUERIES.customerEmails, { custNo }),

    query(QUERIES.creditLimit,    { custNo }),

  ]);
 
  const info = rows[0] || null;

  if (!info) return res.json(null);
 
  info.emails       = emailRows.map(r => r.email).filter(Boolean);

  info.credit_limit = creditRows[0]?.credit_limit ?? null;

  res.json(info);

}));
 
// ── POST /api/project-info  { projectNo } ────────────────────────────────────
// Returns project details, linked projects, and total funding value.

router.post('/project-info', requireAuth, asyncRoute(async (req, res) => {

  const { projectNo } = req.body || {};

  if (!projectNo) return res.status(400).json({ error: 'projectNo is required.' });

  // Step 1: fetch main project info
  const [infoRows] = await Promise.all([
    query(QUERIES.projectInfo, { projectNo }),
  ]);

  const info = infoRows[0] || null;

  if (!info) return res.json(null);

  const projectId = info.project_id;

  // Step 2: fetch linked projects + project value in parallel
  const [linkRows, valueRows] = await Promise.all([
    query(QUERIES.projectLinks, { projectId }),
    query(QUERIES.projectValue, { projectId }),
  ]);

  info.linked_projects = linkRows;
  info.project_value   = valueRows[0]?.project_value ?? null;

  res.json(info);

}));

// ── Error handler ─────────────────────────────────────────────────────────────

router.use((err, req, res, _next) => {

  const isOracle = !!err.errorNum;

  const status   = isOracle ? 500 : 400;

  const message  = isOracle

    ? `Oracle ORA-${String(err.errorNum).padStart(5,'0')}: ${err.message}`

    : err.message;

  console.error(`[ERROR] ${req.method} ${req.path} -> ${status}: ${err.message}`);

  res.status(status).json({ error: message });

});
 
module.exports = router;