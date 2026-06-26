/**
 * Read-only Firestore inventory and integrity audit.
 *
 * Usage:
 *   node scripts/firestore-audit.js
 *   node scripts/firestore-audit.js --json
 *   node scripts/firestore-audit.js --business biz_enes_kebap_9450w
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });

const { db } = require('../src/lib/firebase');
const { businessRef, configRef } = require('../src/lib/collections');
const { normalizeCustomerPhone } = require('../src/lib/phone');
const {
  PROTECTED_BUSINESS_IDS,
  checkOrder,
  checkBusinessRouting,
  checkSession,
  checkIntentLearning,
  checkCustomerAggregates,
  countOrdersByCustomer,
  normalizeMenuName,
} = require('./lib/firestoreAuditChecks');

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const strictExit = args.includes('--strict');
const businessFlagIdx = args.indexOf('--business');
const singleBusinessId = businessFlagIdx >= 0 ? args[businessFlagIdx + 1] : null;

if (businessFlagIdx >= 0 && !singleBusinessId) {
  console.error('Usage: --business <businessId>');
  process.exit(1);
}

/** @param {FirebaseFirestore.CollectionReference} ref */
async function listDocs(ref) {
  const snap = await ref.get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

/**
 * @param {string} businessId
 * @param {Set<string>} businessIds
 */
async function auditBusiness(businessId, businessIds) {
  const menuDocs = await listDocs(businessRef(businessId).collection('menu'));
  const orderDocs = await listDocs(businessRef(businessId).collection('orders'));
  const customerDocs = await listDocs(businessRef(businessId).collection('customers'));
  const learningDocs = await listDocs(businessRef(businessId).collection('intentLearnings'));

  const menuNames = new Set(menuDocs.map((d) => normalizeMenuName(d.data.name ?? '')));

  const orderIssues = orderDocs.flatMap((doc) => checkOrder(doc));

  const ordersByCustomer = countOrdersByCustomer(orderDocs, normalizeCustomerPhone);

  const customerIssues = customerDocs.flatMap((doc) => {
    const key = normalizeCustomerPhone(doc.id || doc.data.phone);
    const count = ordersByCustomer.get(key) ?? 0;
    return checkCustomerAggregates(doc, count);
  });

  const learningIssues = learningDocs.flatMap((doc) => checkIntentLearning(doc, menuNames));

  return {
    businessId,
    protected: PROTECTED_BUSINESS_IDS.has(businessId),
    counts: {
      menu: menuDocs.length,
      orders: orderDocs.length,
      customers: customerDocs.length,
      intentLearnings: learningDocs.length,
    },
    issues: [...orderIssues, ...customerIssues, ...learningIssues],
  };
}

async function runAudit() {
  const [
    businessDocs,
    phoneRoutingDocs,
    ownerDocs,
    adminDocs,
    sessionDocs,
    processedMessageDocs,
    stripeEventDocs,
  ] = await Promise.all([
    listDocs(db.collection('businesses')),
    listDocs(db.collection('phoneRouting')),
    listDocs(db.collection('owners')),
    listDocs(db.collection('admins')),
    listDocs(db.collection('sessions')),
    listDocs(db.collection('processedMessages')),
    listDocs(db.collection('stripeEvents')),
  ]);

  const configSnap = await configRef().get();
  const allBusinessIds = businessDocs.map((d) => d.id);
  const businessIdSet = new Set(allBusinessIds);

  const routingBusinessIds = phoneRoutingDocs.flatMap((d) => {
    const ids = d.data.businessIds;
    return Array.isArray(ids) ? ids.map(String) : [];
  });

  const routingCheck = checkBusinessRouting(routingBusinessIds, allBusinessIds);

  const sessionIssues = sessionDocs.flatMap((doc) => checkSession(doc, businessIdSet));

  const businessIdsToAudit = singleBusinessId
    ? allBusinessIds.filter((id) => id === singleBusinessId)
    : allBusinessIds;

  if (singleBusinessId && businessIdsToAudit.length === 0) {
    console.error(`Business not found: ${singleBusinessId}`);
    process.exit(1);
  }

  const perBusiness = [];
  for (const businessId of businessIdsToAudit) {
    perBusiness.push(await auditBusiness(businessId, businessIdSet));
  }

  const integrityIssues = [
    ...routingCheck.routingMissingBusiness.map(
      (id) => `phoneRouting references missing business "${id}"`,
    ),
    ...sessionIssues,
    ...perBusiness.flatMap((b) => b.issues.map((issue) => `${b.businessId}: ${issue}`)),
  ];

  const manualDeleteSuggestions = routingCheck.orphanBusinesses.map((id) => ({
    businessId: id,
    reason: 'Not referenced in any phoneRouting.businessIds',
    action: 'Review and delete manually if unused',
  }));

  const report = {
    generatedAt: new Date().toISOString(),
    project: process.env.FIREBASE_PROJECT_ID ?? null,
    protectedBusinessIds: [...PROTECTED_BUSINESS_IDS],
    counts: {
      businesses: businessDocs.length,
      phoneRouting: phoneRoutingDocs.length,
      owners: ownerDocs.length,
      admins: adminDocs.length,
      sessions: sessionDocs.length,
      processedMessages: processedMessageDocs.length,
      stripeEvents: stripeEventDocs.length,
      configWhatorder: configSnap.exists ? 1 : 0,
    },
    perBusiness: perBusiness.map(({ businessId, protected: isProtected, counts, issues }) => ({
      businessId,
      protected: isProtected,
      counts,
      issueCount: issues.length,
      issues,
    })),
    routing: {
      referencedBusinessIds: [...new Set(routingBusinessIds)],
      missingBusinessDocs: routingCheck.routingMissingBusiness,
      protectedNotInRouting: routingCheck.protectedOrphans,
    },
    manualDeleteSuggestions,
    integrityIssueCount: integrityIssues.length,
    integrityIssues,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  printHumanReport(report);
  return report;
}

/** @param {ReturnType<typeof runAudit> extends Promise<infer R> ? R : never} report */
function printHumanReport(report) {
  console.log('Firestore audit (read-only)\n');
  console.log(`Project: ${report.project ?? '(unknown)'}`);
  console.log(`Generated: ${report.generatedAt}\n`);

  console.log('Top-level counts');
  for (const [key, value] of Object.entries(report.counts)) {
    console.log(`  ${key}: ${value}`);
  }

  console.log('\nPer business');
  for (const b of report.perBusiness) {
    const tag = b.protected ? ' [protected]' : '';
    console.log(
      `  ${b.businessId}${tag}: menu=${b.counts.menu} orders=${b.counts.orders} customers=${b.counts.customers} intentLearnings=${b.counts.intentLearnings} issues=${b.issueCount}`,
    );
  }

  if (report.routing.missingBusinessDocs.length) {
    console.log('\nRouting corruption (fix before cleanup)');
    for (const id of report.routing.missingBusinessDocs) {
      console.log(`  phoneRouting → missing businesses/${id}`);
    }
  }

  if (report.routing.protectedNotInRouting.length) {
    console.log('\nProtected businesses not in phoneRouting (OK to keep)');
    for (const id of report.routing.protectedNotInRouting) {
      console.log(`  ${id}`);
    }
  }

  if (report.manualDeleteSuggestions.length) {
    console.log('\nSuggest manual delete (not auto-deleted by cleanup job)');
    for (const s of report.manualDeleteSuggestions) {
      console.log(`  ${s.businessId}: ${s.reason}`);
    }
  }

  if (report.integrityIssues.length) {
    console.log(`\nIntegrity issues (${report.integrityIssueCount})`);
    console.log('  (customer drift = stale aggregates; intentLearnings = phrase cache vs menu names)');
    const limit = 50;
    for (const issue of report.integrityIssues.slice(0, limit)) {
      console.log(`  ${issue}`);
    }
    if (report.integrityIssues.length > limit) {
      console.log(`  … and ${report.integrityIssues.length - limit} more (use --json for full list)`);
    }
  } else {
    console.log('\nNo integrity issues found.');
  }

  console.log('\nNext: review report, then run cleanup (PR 2) with --dry-run.');
  if (report.integrityIssueCount > 0) {
    console.log('Audit finished with findings. Use --strict to exit 1 for CI.');
  }
}

runAudit()
  .then((report) => {
    if (strictExit && report.integrityIssueCount > 0) process.exitCode = 1;
  })
  .catch((err) => {
    console.error('Audit failed:', err);
    process.exit(1);
  });
