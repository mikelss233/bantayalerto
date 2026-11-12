// =====================================================================
// ALERT SENDING SERVICE  (API #6: Semaphore SMS + Resend email)
//
// WHAT IT DOES:
//   When an admin sends an alert (Alerts page), this file delivers it:
//   - by SMS (text message) through Semaphore, a Philippine SMS company
//   - by email through Resend
//
// API KEYS:
//   These two APIs need a key (a password for the API), which costs money for SMS.
//   The keys are stored in Render's settings, never in the code:
//     SEMAPHORE_API_KEY  and  RESEND_API_KEY
//
// "SIMULATED" MODE:
//   If there is no key, we don't send anything. We only write the message in the
//   server log and report "simulated". This lets us demonstrate the whole alert
//   feature without paying. Adding the keys turns on real sending, with no code change.
//
// WHAT EACH FUNCTION RETURNS (saved with the alert and shown to the admin):
//   { channel: 'sms' or 'email', sent: how many, mode: 'none' | 'simulated' | 'live' | 'failed' }
// =====================================================================
const { fetchJson } = require('./http'); // our helper for calling APIs

// Sends one text message to a list of phone numbers.
async function sendSms(numbers, message) {
  // No users with a phone number -> nothing to send.
  if (!numbers.length) return { channel: 'sms', sent: 0, mode: 'none' };

  // No API key -> simulated mode: only write it in the server log.
  if (!process.env.SEMAPHORE_API_KEY) {
    console.log(`[SMS simulated] -> ${numbers.length} recipients: ${message}`);
    return { channel: 'sms', sent: numbers.length, mode: 'simulated' };
  }

  // We have a key -> really send it through Semaphore.
  try {
    await fetchJson('Semaphore SMS', 'https://api.semaphore.co/api/v4/messages', {
      method: 'POST', ttlMs: 0, // POST = send something; ttlMs 0 = never reuse a saved answer
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, // Semaphore expects form data
      // apikey = our key, number = all phone numbers separated by commas,
      // sendername = the name shown as the sender on the phone
      body: new URLSearchParams({ apikey: process.env.SEMAPHORE_API_KEY, number: numbers.join(','), message, sendername: process.env.SEMAPHORE_SENDER || 'BantayAlert' }).toString(),
    });
    return { channel: 'sms', sent: numbers.length, mode: 'live' };
  } catch (e) {
    // If sending fails, report it instead of crashing, so the email can still go out.
    return { channel: 'sms', sent: 0, mode: 'failed', error: e.message };
  }
}

// Sends one email to a list of email addresses. Works the same way as sendSms above.
async function sendEmail(addresses, subject, message) {
  if (!addresses.length) return { channel: 'email', sent: 0, mode: 'none' };

  // No API key -> simulated mode.
  if (!process.env.RESEND_API_KEY) {
    console.log(`[Email simulated] -> ${addresses.length} recipients: ${subject}`);
    return { channel: 'email', sent: addresses.length, mode: 'simulated' };
  }

  // We have a key -> really send it through Resend.
  try {
    await fetchJson('Resend Email', 'https://api.resend.com/emails', {
      method: 'POST', ttlMs: 0,
      // Resend checks our key in the "Authorization" header.
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || 'BantayAlerto <onboarding@resend.dev>', to: addresses, subject, text: message }),
    });
    return { channel: 'email', sent: addresses.length, mode: 'live' };
  } catch (e) {
    return { channel: 'email', sent: 0, mode: 'failed', error: e.message };
  }
}

module.exports = { sendSms, sendEmail };
