// In-memory conversation state per customer phone.
// Survives across messages for a single server process (sufficient for MVP).
// State machine: idle → confirming → idle
const sessions = new Map();

function getSession(phone) {
  return sessions.get(phone) ?? { state: 'idle' };
}

function setSession(phone, data) {
  sessions.set(phone, data);
}

function clearSession(phone) {
  sessions.delete(phone);
}

module.exports = { getSession, setSession, clearSession };
