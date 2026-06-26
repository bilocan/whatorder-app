const { parseTimestamp } = require('./firestoreAuditChecks');

const DEFAULT_RETENTION = {
  orders: '0d', // pre-pilot reset-style: all orders when using retention with 0d
  sessions: '24h',
  processedMessages: '48h',
  stripeEvents: '30d',
};

/**
 * @param {string} value e.g. 7d, 24h, 0d
 * @returns {number} milliseconds
 */
function parseDuration(value) {
  const match = String(value).trim().match(/^(\d+)(h|d)$/i);
  if (!match) {
    throw new Error(`Invalid duration "${value}" — use e.g. 7d or 24h`);
  }
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 'h') return amount * 60 * 60 * 1000;
  return amount * 24 * 60 * 60 * 1000;
}

/**
 * @param {Date} cutoff
 * @param {unknown} timestampField
 */
function isOlderThan(cutoff, timestampField) {
  const ts = parseTimestamp(timestampField);
  if (!ts) return true; // missing timestamp → eligible for cleanup
  return ts.getTime() < cutoff.getTime();
}

/**
 * @param {'reset' | 'retention'} mode
 * @param {Date | null} ordersCutoff null in reset mode
 * @param {Record<string, unknown>} data
 */
function shouldDeleteOrder(mode, ordersCutoff, data) {
  if (mode === 'reset') return true;
  return isOlderThan(ordersCutoff, data.createdAt);
}

/**
 * @param {'reset' | 'retention'} mode
 * @param {Date | null} sessionsCutoff
 * @param {Record<string, unknown>} data
 */
function shouldDeleteSession(mode, sessionsCutoff, data) {
  if (mode === 'reset') return true;
  return isOlderThan(sessionsCutoff, data.updatedAt);
}

/**
 * @param {'reset' | 'retention'} mode
 * @param {Date | null} cutoff
 * @param {Record<string, unknown>} data
 * @param {string} field
 */
function shouldDeleteEphemeral(mode, cutoff, data, field) {
  if (mode === 'reset') return true;
  return isOlderThan(cutoff, data[field]);
}

/**
 * @param {string[]} argv
 */
function parseCleanupArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const confirm = argv.includes('--confirm');
  const mode = argv.includes('--mode=retention') ? 'retention' : 'reset';

  const businessIdx = argv.indexOf('--business');
  const businessId = businessIdx >= 0 ? argv[businessIdx + 1] : null;
  if (businessIdx >= 0 && !businessId) {
    throw new Error('Missing value for --business');
  }

  const readDuration = (flag, fallback) => {
    const entry = argv.find((a) => a.startsWith(`${flag}=`));
    return entry ? entry.slice(flag.length + 1) : fallback;
  };

  const ordersOlderThan = readDuration('--orders-older-than', DEFAULT_RETENTION.orders);
  const sessionsOlderThan = readDuration('--sessions-older-than', DEFAULT_RETENTION.sessions);
  const processedMessagesOlderThan = readDuration(
    '--processed-messages-older-than',
    DEFAULT_RETENTION.processedMessages,
  );
  const stripeEventsOlderThan = readDuration(
    '--stripe-events-older-than',
    DEFAULT_RETENTION.stripeEvents,
  );

  const now = Date.now();
  const cutoffs =
    mode === 'reset'
      ? {
          orders: null,
          sessions: null,
          processedMessages: null,
          stripeEvents: null,
        }
      : {
          orders: new Date(now - parseDuration(ordersOlderThan)),
          sessions: new Date(now - parseDuration(sessionsOlderThan)),
          processedMessages: new Date(now - parseDuration(processedMessagesOlderThan)),
          stripeEvents: new Date(now - parseDuration(stripeEventsOlderThan)),
        };

  return {
    dryRun,
    confirm,
    mode,
    businessId,
    ordersOlderThan,
    sessionsOlderThan,
    processedMessagesOlderThan,
    stripeEventsOlderThan,
    cutoffs,
  };
}

/**
 * @param {string[]} allBusinessIds
 * @param {string | null} filterBusinessId
 */
function resolveBusinessIds(allBusinessIds, filterBusinessId) {
  if (!filterBusinessId) return allBusinessIds;
  if (!allBusinessIds.includes(filterBusinessId)) {
    throw new Error(`Business not found: ${filterBusinessId}`);
  }
  return [filterBusinessId];
}

module.exports = {
  DEFAULT_RETENTION,
  parseDuration,
  parseCleanupArgs,
  isOlderThan,
  shouldDeleteOrder,
  shouldDeleteSession,
  shouldDeleteEphemeral,
  resolveBusinessIds,
};
