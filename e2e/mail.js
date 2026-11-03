// Reads the emails of the local Supabase. Nothing is really sent: the local setup collects the
// emails in a test mailbox (Mailpit) that has a small web API.
const MAILBOX = 'http://127.0.0.1:54324/api/v1';

async function listFor(address) {
  const response = await fetch(`${MAILBOX}/search?query=${encodeURIComponent(`to:${address}`)}`);
  return (await response.json()).messages ?? [];
}

// Waits for the newest email to `address` and returns { subject, html, text }
export async function waitForEmail(address, { timeoutMs = 15_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [newest] = await listFor(address);
    if (newest) {
      const message = await (await fetch(`${MAILBOX}/message/${newest.ID}`)).json();
      return { subject: message.Subject, html: message.HTML, text: message.Text };
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`No email arrived for ${address} within ${timeoutMs} ms`);
}

// How many emails the mailbox holds for `address`
export async function countEmails(address) {
  return (await listFor(address)).length;
}

// The first link of an email that points at the auth server (the one the user would click)
export function authLink(email) {
  const href = email.html.match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/)?.[1];
  if (!href) throw new Error(`No auth link in the email "${email.subject}"`);
  return href.replaceAll('&amp;', '&');
}
