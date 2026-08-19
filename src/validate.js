'use strict';

/**
 * src/validate.js
 * Validates caller-supplied parameters (bgId, orgId, custNo).
 * DB credentials come entirely from .env — never from the HTTP request.
 */

function extractParams(body, { requireBgId = false, requireCustNo = false } = {}) {
  const { bgId, orgId, custNo } = body ?? {};

  const parsedBgId = bgId ? parseInt(bgId, 10) : 0;
  if (requireBgId && (!parsedBgId || parsedBgId < 1))
    throw new Error('bgId is required. Please select a country from the slicer.');

  const parsedOrgId = orgId ? parseInt(orgId, 10) : 0;

  if (requireCustNo && (!custNo || !String(custNo).trim()))
    throw new Error('custNo (customer account number) is required.');

  return {
    bgId:   parsedBgId,
    orgId:  parsedOrgId,
    custNo: custNo ? String(custNo).trim() : undefined,
  };
}

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

module.exports = { extractParams, asyncRoute };
