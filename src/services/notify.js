// API 5 (Semaphore SMS) and API 6 (Resend email). Keys are optional: without them the
// message is "simulated" (logged) so the whole alert flow can still be demonstrated.
const { fetchJson } = require('./http');

async function sendSms(numbers, message) {
  if (!numbers.length) return { channel: 'sms', sent: 0, mode: 'none' };
  if (!process.env.SEMAPHORE_API_KEY) {
    console.log(`[SMS simulated] -> ${numbers.length} recipients: ${message}`);
    return { channel: 'sms', sent: numbers.length, mode: 'simulated' };
  }
  try {
    await fetchJson('Semaphore SMS', 'https://api.semaphore.co/api/v4/messages', {
      method: 'POST', ttlMs: 0,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ apikey: process.env.SEMAPHORE_API_KEY, number: numbers.join(','), message, sendername: process.env.SEMAPHORE_SENDER || 'BantayAlert' }).toString(),
    });
    return { channel: 'sms', sent: numbers.length, mode: 'live' };
  } catch (e) {
    return { channel: 'sms', sent: 0, mode: 'failed', error: e.message };
  }
}

async function sendEmail(addresses, subject, message) {
  if (!addresses.length) return { channel: 'email', sent: 0, mode: 'none' };
  if (!process.env.RESEND_API_KEY) {
    console.log(`[Email simulated] -> ${addresses.length} recipients: ${subject}`);
    return { channel: 'email', sent: addresses.length, mode: 'simulated' };
  }
  try {
    await fetchJson('Resend Email', 'https://api.resend.com/emails', {
      method: 'POST', ttlMs: 0,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || 'BantayAlerto <onboarding@resend.dev>', to: addresses, subject, text: message }),
    });
    return { channel: 'email', sent: addresses.length, mode: 'live' };
  } catch (e) {
    return { channel: 'email', sent: 0, mode: 'failed', error: e.message };
  }
}

module.exports = { sendSms, sendEmail };
