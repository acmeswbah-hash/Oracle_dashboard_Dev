'use strict';
 
/**
 
* src/queries.js — All Oracle EBS SQL queries
 
*
 
* Bind variables:
 
*   :bgId   — BUSINESS_GROUP_ID  (from country slicer)
 
*   :orgId  — ORG_ID             (from company slicer; 0 = all)
 
*   :custNo — ACCOUNT_NUMBER     (drill-down / customer info)
 
*
 
* OU filter pattern:  AND (:orgId = 0 OR aps.org_id = :orgId)
 
*/
 
const QUERIES = {
 
  // -- 1. Business Groups (country slicer) -------------------------------------
 
  businessGroups: `
    SELECT DISTINCT
      pbg.BUSINESS_GROUP_ID   AS business_group_id,
      pbg.name                AS bg_name,
      pbg.CURRENCY_CODE       AS currency_code
    FROM
      apps.hr_operating_units   hou,
      apps.per_business_groups  pbg,
      apps.fnd_lookup_values_vl flv
    WHERE
          flv.lookup_type          = 'XXACG_AR_DASHBOARD'
      AND hou.business_group_id    = pbg.business_group_id
      AND UPPER(flv.description)   = UPPER(:username)
      AND flv.tag                  = hou.organization_id
    ORDER BY pbg.name`,
 
  // -- 2. Operating Units (company slicer, cascades from bgId) -----------------
 
  operatingUnits: `
 
    SELECT
      hou.organization_id  AS org_id,
      hou.name             AS ou_name
    FROM
      apps.hr_operating_units   hou,
      apps.per_business_groups  pbg
    WHERE
          hou.business_group_id = pbg.business_group_id
      AND hou.BUSINESS_GROUP_ID = :bgId
    ORDER BY hou.name`,
 
  // -- 3. Customer Balance Summary ----------------------------------------------
 
  customerBalance: `
 
    SELECT
      hca.account_number                                   AS customer_number,
      hp.party_name                                        AS customer_name,
      hca.customer_class_code                              AS category,
      SUM(NVL(aps.AMOUNT_DUE_REMAINING,0)*NVL(aps.EXCHANGE_RATE,1)) AS func_outstanding,
      COUNT(aps.payment_schedule_id)                       AS trx_count
    FROM
      apps.ar_payment_schedules_all  aps,
      apps.ra_customer_trx_all       rct,
      apps.hr_operating_units        hou,
      apps.hz_parties                hp,
      apps.hz_cust_accounts_all      hca
    WHERE
          hou.business_group_id           = :bgId
      AND (:orgId = 0 OR aps.org_id      = :orgId)
      AND aps.status                      = 'OP'
      AND hou.organization_id             = aps.org_id
      AND NVL(aps.AMOUNT_DUE_REMAINING,0) != 0
      AND hp.party_id                     = hca.party_id
    AND hp.party_id                     != 1760967
      AND hca.cust_account_id             = aps.customer_id
      AND aps.customer_trx_id             = rct.customer_trx_id
    GROUP BY hca.account_number, hp.party_name, hca.customer_class_code
    ORDER BY func_outstanding DESC`,

  // -- 4. Project Balance Summary -----------------------------------------------
 
  projectBalance: `
 
    SELECT
      pp.segment1                                          AS project_no,
      pp.name                                              AS project_name,
      pps.DESCRIPTION                                      AS project_status,
      hp.party_name                                        as customer_name,
      SUM(NVL(aps.AMOUNT_DUE_REMAINING,0)*NVL(aps.EXCHANGE_RATE,1)) AS func_outstanding,
      COUNT(DISTINCT hca.cust_account_id)                  AS customer_count
    FROM
      apps.ar_payment_schedules_all  aps,
      apps.ra_customer_trx_all       rct,
      apps.hr_operating_units        hou,
      apps.hz_cust_accounts_all      hca,
      apps.pa_projects_all           pp,
      apps.pa_project_statuses       pps,
      apps.HZ_PARTIES                hp
    WHERE
          hou.business_group_id               = :bgId
      AND (:orgId = 0 OR aps.org_id          = :orgId)
      AND aps.status                          = 'OP'
      AND hou.organization_id                 = aps.org_id
      AND NVL(aps.AMOUNT_DUE_REMAINING,0)     != 0
      AND hca.cust_account_id                 = aps.customer_id
      AND aps.customer_trx_id                 = rct.customer_trx_id
      AND rct.INTERFACE_HEADER_ATTRIBUTE1     = pp.segment1
    AND hca.cust_account_id                 != 511621
      AND pps.status_type               (+)   = 'PROJECT'
      AND pps.project_status_code       (+)   = pp.project_status_code
      and hca.party_id                        = hp.party_id
    GROUP BY pp.segment1, pp.name, pps.DESCRIPTION, hp.party_name
    ORDER BY func_outstanding DESC`,
 
  // -- 5. Aging Buckets ---------------------------------------------------------
 
  agingBuckets: `
 
    SELECT
      hou.name                                             as company,
      hca.account_number                                   AS account_number,
      hp.party_name                                        AS customer_name,
      CASE
        WHEN (SYSDATE-aps.DUE_DATE) <= 0   THEN 'Current'
        WHEN (SYSDATE-aps.DUE_DATE) <= 30  THEN '1-30 days'
        WHEN (SYSDATE-aps.DUE_DATE) <= 60  THEN '31-60 days'
        WHEN (SYSDATE-aps.DUE_DATE) <= 90  THEN '61-90 days'
        WHEN (SYSDATE-aps.DUE_DATE) <= 180 THEN '91-180 days'
        WHEN (SYSDATE-aps.DUE_DATE) <= 365 THEN '181-365 days'
        ELSE '365+ days'
      END                                                  AS aging_bucket,
      SUM(NVL(aps.AMOUNT_DUE_REMAINING,0)*NVL(aps.EXCHANGE_RATE,1)) AS func_outstanding
    FROM
      apps.ar_payment_schedules_all  aps,
      apps.ra_customer_trx_all       rct,
      apps.hr_operating_units        hou,
      apps.hz_parties                hp,
      apps.hz_cust_accounts_all      hca
    WHERE
        hou.business_group_id           = :bgId
      AND (:orgId = 0 OR aps.org_id      = :orgId)
      AND aps.status                      = 'OP'
      AND hou.organization_id             = aps.org_id
      AND NVL(aps.AMOUNT_DUE_REMAINING,0) != 0
      AND hp.party_id                     = hca.party_id
      AND hca.cust_account_id                 != 511621
      AND hca.cust_account_id             = aps.customer_id
      AND aps.customer_trx_id             = rct.customer_trx_id
    GROUP BY 
      hca.account_number, hp.party_name, hou.name,
      CASE
        WHEN (SYSDATE-aps.DUE_DATE) <= 0   THEN 'Current'
        WHEN (SYSDATE-aps.DUE_DATE) <= 30  THEN '1-30 days'
        WHEN (SYSDATE-aps.DUE_DATE) <= 60  THEN '31-60 days'
        WHEN (SYSDATE-aps.DUE_DATE) <= 90  THEN '61-90 days'
        WHEN (SYSDATE-aps.DUE_DATE) <= 180 THEN '91-180 days'
        WHEN (SYSDATE-aps.DUE_DATE) <= 365 THEN '181-365 days'
        ELSE '365+ days'
      END
    ORDER BY customer_name,
      CASE
        WHEN aging_bucket='Current'      THEN 1
        WHEN aging_bucket='1-30 days'    THEN 2
        WHEN aging_bucket='31-60 days'   THEN 3
        WHEN aging_bucket='61-90 days'   THEN 4
        WHEN aging_bucket='91-180 days'  THEN 5
        WHEN aging_bucket='181-365 days' THEN 6
        ELSE 7
      END`,
 
  // -- 6. Transaction Drill-Down ------------------------------------------------
 
  customerDetail: `
 
    SELECT
      hou.name                                             AS operating_unit,
      aps.TRX_NUMBER                                       AS trx_number,
      TO_CHAR(aps.TRX_DATE,'DD-MON-YYYY')                 AS trx_date,
      aps.CLASS                                            AS class,
      TO_CHAR(aps.GL_DATE,'DD-MON-YYYY')                  AS gl_date,
      TO_CHAR(aps.DUE_DATE,'DD-MON-YYYY')                 AS due_date,
      aps.INVOICE_CURRENCY_CODE                            AS currency,
      NVL(aps.AMOUNT_DUE_ORIGINAL,0)                      AS trx_amount,
      NVL(aps.AMOUNT_DUE_REMAINING,0)                     AS outstanding,
      NVL(aps.EXCHANGE_RATE,1)                             AS exchange_rate,
      NVL(aps.AMOUNT_DUE_REMAINING,0)*NVL(aps.EXCHANGE_RATE,1) AS func_outstanding,
      ROUND(SYSDATE-aps.DUE_DATE)                          AS days_past_due,
      rct.PURCHASE_ORDER                                   AS po_number,
      NVL(rct.INTERFACE_HEADER_ATTRIBUTE1,'-')             AS project_no,
      CASE
        WHEN (SYSDATE-aps.DUE_DATE) <= 0   THEN 'Current'
        WHEN (SYSDATE-aps.DUE_DATE) <= 30  THEN '1-30 days'
        WHEN (SYSDATE-aps.DUE_DATE) <= 60  THEN '31-60 days'
        WHEN (SYSDATE-aps.DUE_DATE) <= 90  THEN '61-90 days'
        WHEN (SYSDATE-aps.DUE_DATE) <= 180 THEN '91-180 days'
        WHEN (SYSDATE-aps.DUE_DATE) <= 365 THEN '181-365 days'
        ELSE '365+ days'
      END                                                  AS aging_bucket
    FROM
      apps.ar_payment_schedules_all  aps,
      apps.ra_customer_trx_all       rct,
      apps.hr_operating_units        hou,
      apps.hz_cust_accounts_all      hca
    WHERE
          hou.business_group_id           = :bgId
      AND (:orgId = 0 OR aps.org_id      = :orgId)
      AND aps.status                      = 'OP'
      AND hou.organization_id             = aps.org_id
      AND NVL(aps.AMOUNT_DUE_REMAINING,0) != 0
      AND hca.cust_account_id             = aps.customer_id
    AND hca.cust_account_id                 != 511621
      AND hca.account_number              = :custNo
      AND aps.customer_trx_id             = rct.customer_trx_id
    ORDER BY aps.DUE_DATE ASC`,
 
  // -- 7. Customer Profile Info -------------------------------------------------
 
  // Shown when user clicks customer name — address, tax, credit, status, etc.
 
  customerInfo: `
 
    SELECT
      pv.account_number,
      HP.PARTY_NAME,
      hp.party_id,
       TO_CHAR(hp.creation_date,'DD-MON-YYYY')             AS creation_date,
      HP.ADDRESS1,
       HP.ADDRESS2,
       HP.ADDRESS3,
      HP.ADDRESS4,
      hp.CITY,
      hp.country,
      hp.ATTRIBUTE1                                        AS cr_cpr,
      HCP.CREDIT_CHECKING,
      hcp.CREDIT_HOLD,
      DECODE(pv.STATUS,'A','Active','Inactive')            AS status,
      zxr.REGISTRATION_NUMBER,
      TO_CHAR(zxr.effective_from,'DD-MON-YYYY')           AS effective_from,
      TO_CHAR(zxr.effective_to,'DD-MON-YYYY')             AS effective_to,
      zxr.rep_name,
      al.meaning                                           AS cust_class
    FROM
      apps.HZ_PARTIES               HP,
      apps.hz_cust_accounts_all     pv,
      apps.HZ_CUSTOMER_PROFILES     HCP,
      apps.ar_lookups               al,
      (SELECT
         ZP.PARTY_ID,
         SUBSTR(ZR.REGISTRATION_NUMBER, 1,
           DECODE(INSTR(ZR.REGISTRATION_NUMBER,'-'),0,50,
             INSTR(ZR.REGISTRATION_NUMBER,'-'))-1)        AS REGISTRATION_NUMBER,
         zr.effective_from,
         zr.effective_to,
         zr.rep_party_tax_name                            AS rep_name
       FROM
         apps.ZX_PARTY_TAX_PROFILE ZP,
         apps.ZX_REGISTRATIONS     ZR
       WHERE
             zp.party_type_code       = 'THIRD_PARTY'
         AND ZP.PARTY_TAX_PROFILE_ID  = ZR.PARTY_TAX_PROFILE_ID
         AND SYSDATE BETWEEN NVL(zr.effective_from,SYSDATE)
                        AND NVL(zr.effective_to,SYSDATE+1)
      ) zxr
    WHERE
          HP.PARTY_ID             = pv.PARTY_ID
      AND HP.PARTY_ID             = zxr.PARTY_ID    (+)
      AND pv.account_number       = :custNo
      AND pv.CUST_ACCOUNT_ID      = HCP.CUST_ACCOUNT_ID (+)
      AND HCP.SITE_USE_ID        IS NULL
      AND al.lookup_type          (+) = 'CUSTOMER CLASS'
      AND al.lookup_code          (+) = pv.customer_class_code
    ORDER BY 2`,
 
  // -- 8. Customer Email Addresses ----------------------------------------------
 
  // Joins hz_cust_accounts_all ? hz_parties to get party_id, then fetches
 
  // all active EMAIL contact points from hz_contact_points.
 
  customerEmails: `
 
    SELECT
      hcp.EMAIL_ADDRESS     AS email
    FROM
      apps.hz_contact_points     hcp,
      apps.hz_parties            hp,
      apps.hz_cust_accounts_all  pv
    WHERE
          pv.account_number       = :custNo
      AND hp.party_id             = pv.party_id
      AND hcp.owner_table_name    = 'HZ_PARTIES'
      AND hcp.owner_table_id      = hp.party_id
      AND hcp.CONTACT_POINT_TYPE  = 'EMAIL'
      AND hcp.status              = 'A'
    ORDER BY hcp.EMAIL_ADDRESS`,
 
  // -- 9. Credit Limit ----------------------------------------------------------
 
  // Returns the overall credit limit for a given customer account number.
 
  // Uses site-level profile amounts; picks the MAX to handle multiple sites.
 
  creditLimit: `
 
    SELECT MAX(a.overall_credit_limit) AS credit_limit
   FROM
      apps.HZ_CUST_PROFILE_AMTS   a,
      apps.HZ_CUST_ACCOUNTS_ALL   b,
      apps.ar_customers            c,
      apps.hz_cust_site_uses_all   d,
      apps.hz_cust_acct_sites_all  f,
      apps.hz_party_sites          g
    WHERE
          a.overall_credit_limit  IS NOT NULL
      AND a.cust_account_id       = b.cust_account_id
      AND b.account_number        = c.customer_number
      AND a.site_use_id           = d.site_use_id
      AND d.cust_acct_site_id     = f.cust_acct_site_id
      AND g.party_site_id         = f.party_site_id
      AND c.customer_number       = :custNo`,

  // -- 10. Project Info ---------------------------------------------------------
 
  // Main project details — bound by :projectNo (segment1)
 
  projectInfo: `
 
    SELECT
      pp.segment1                                          AS project_no,
       pp.name                                              AS project_name,
       pp.PROJECT_TYPE                                      AS project_type,
       TO_CHAR(pp.START_DATE,'DD-MON-YYYY')                AS start_date,
       TO_CHAR(pp.COMPLETION_DATE,'DD-MON-YYYY')           AS completion_date,
       pp.attribute6                                        AS main_project,
       pp.project_id                                        AS project_id,
       pps.DESCRIPTION                                      AS project_status,
       hou.name                                             AS operating_unit
     FROM
       apps.pa_projects_all     pp,
       apps.hr_operating_units  hou,
       apps.pa_project_statuses pps
     WHERE
           pp.org_id              = hou.organization_id
       AND pp.TEMPLATE_FLAG       = 'N'
       AND pp.segment1            = :projectNo
       AND pps.status_type    (+) = 'PROJECT'
       AND pps.project_status_code (+) = pp.project_status_code`,
 
  // -- 11. Project Linked (Secondary) Projects -------------------------------
 
  // Secondary projects linked via tasks — bound by :projectId
 
  projectLinks: `
 
    SELECT DISTINCT
       ppa.segment1                                         AS linked_project_no,
       ppa.name                                             AS linked_project_name
     FROM
       apps.pa_tasks            pt,
       apps.pa_projects_all     pp,
       apps.PA_PROJECT_CUSTOMERS ppc,
       apps.PA_PROJECTS_ALL     ppa
     WHERE
           pt.task_id             = ppc.RECEIVER_TASK_ID
       AND pp.project_id          = pt.project_id
       AND ppc.PROJECT_ID         = ppa.PROJECT_ID
       AND pp.project_id          = :projectId`,
 
  // -- 12. Project Value ----------------------------------------------------
 
  // Total allocated funding — bound by :projectId
 
  projectValue: `
 
    SELECT
       NVL(SUM(NVL(ALLOCATED_AMOUNT,0)),0) AS project_value
     FROM
       apps.PA_PROJECT_FUNDINGS
     WHERE
       PROJECT_ID = :projectId`,

  // -- 13. User Access (from Oracle EBS lookup) -----------------------------
  // Managed in ERP: Application Developer ? Lookups ? XXACG_AR_DASHBOARD
  // Description = username/email, Tag = org_id

  userAccess: `
    SELECT
      description AS username,
      tag         AS org_id
    FROM
      apps.fnd_lookup_values_vl flv
    WHERE
      lookup_type = 'XXACG_AR_DASHBOARD'`,

  userAccessByUsername: `
    SELECT
      tag AS org_id
    FROM
      apps.fnd_lookup_values_vl flv
    WHERE
          lookup_type = 'XXACG_AR_DASHBOARD'
      AND UPPER(description) = UPPER(:username)`,

};

module.exports = QUERIES;