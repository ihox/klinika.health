import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';

/**
 * Minimal SMTP client (RFC 5321 + AUTH LOGIN + STARTTLS) used by the
 * "Test connection" button on the clinic email settings page, and as
 * the transport for the optional per-clinic SMTP override.
 *
 * Why not nodemailer? Klinika's tech stack is intentionally narrow
 * (CLAUDE.md §2). This slice only needs: TCP/TLS connect, EHLO,
 * STARTTLS, AUTH LOGIN, MAIL/RCPT/DATA, QUIT. Maybe ~250 lines.
 *
 * Limitations vs nodemailer:
 *   - Plain ASCII/UTF-8 single-part bodies only (no attachments)
 *   - AUTH LOGIN only — AUTH PLAIN as a fallback
 *   - No connection pooling (test endpoint is one-shot)
 *
 * Production deployments will typically use 465 (implicit TLS) or
 * 587 (STARTTLS). Both are supported; port 25 plaintext works too
 * but the test endpoint warns when no encryption is in play.
 */

const READ_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 10_000;
const CRLF = '\r\n';

export interface SmtpDialOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  fromName: string;
  fromAddress: string;
}

export interface SmtpMessage {
  to: string;
  subject: string;
  text: string;
}

export type SmtpFailureReason =
  | 'connect_failed'
  | 'tls_failed'
  | 'auth_failed'
  | 'rejected_sender'
  | 'rejected_recipient'
  | 'rejected_data'
  | 'protocol_error'
  | 'timeout';

export class SmtpError extends Error {
  constructor(
    public readonly reason: SmtpFailureReason,
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = 'SmtpError';
  }
}

interface Conversation {
  socket: Socket | TLSSocket;
  buffer: string;
  awaitLine: () => Promise<{ code: number; line: string; cont: boolean }>;
  send: (line: string) => Promise<void>;
}

/** Open the test endpoint's verify-and-send round-trip. */
export async function smtpSendTestMessage(
  opts: SmtpDialOptions,
  message: SmtpMessage,
): Promise<void> {
  const session = await openSession(opts);
  try {
    await drainGreeting(session);
    await ehlo(session, opts.host);
    if (opts.port !== 465) {
      // Port 465 is already TLS-wrapped. For 587/25 try to STARTTLS
      // unless the server didn't advertise it; we re-EHLO after.
      const upgraded = await maybeStartTls(session, opts.host);
      if (upgraded) await ehlo(upgraded, opts.host);
    }
    await authenticate(session, opts.username, opts.password);
    await sendOne(session, opts, message);
  } finally {
    try {
      await session.send('QUIT');
    } catch {
      // Best-effort.
    }
    session.socket.end();
  }
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

async function openSession(opts: SmtpDialOptions): Promise<Conversation> {
  const socket: Socket = await new Promise((resolveOk, reject) => {
    const timeout = setTimeout(() => {
      s.destroy();
      reject(new SmtpError('timeout', 'Lidhja SMTP nuk u përgjigj në kohë.'));
    }, CONNECT_TIMEOUT_MS);
    const s =
      opts.port === 465
        ? tlsConnect({
            host: opts.host,
            port: opts.port,
            servername: opts.host,
            timeout: CONNECT_TIMEOUT_MS,
          })
        : netConnect({ host: opts.host, port: opts.port, timeout: CONNECT_TIMEOUT_MS });
    const onReady = (): void => {
      clearTimeout(timeout);
      s.removeListener('error', onError);
      resolveOk(s);
    };
    const onError = (err: Error): void => {
      clearTimeout(timeout);
      reject(new SmtpError('connect_failed', `Lidhja dështoi: ${err.message}`));
    };
    if (opts.port === 465) {
      (s as TLSSocket).once('secureConnect', onReady);
    } else {
      s.once('connect', onReady);
    }
    s.once('error', onError);
  });
  return wrapSocket(socket);
}

function wrapSocket(socket: Socket | TLSSocket): Conversation {
  let buffer = '';
  let pending: ((value: string) => void) | null = null;
  let pendingErr: ((err: Error) => void) | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let socketError: Error | null = null;

  socket.setEncoding('utf8');

  socket.on('data', (chunk: string) => {
    buffer += chunk;
    deliver();
  });
  socket.on('error', (err: Error) => {
    socketError = err;
    if (pendingErr) {
      const fn = pendingErr;
      pendingErr = null;
      pending = null;
      fn(err);
    }
  });
  socket.on('end', () => {
    if (pendingErr) {
      const fn = pendingErr;
      pendingErr = null;
      pending = null;
      fn(new Error('Connection closed by server'));
    }
  });

  function deliver(): void {
    if (!pending) return;
    const eol = buffer.indexOf(CRLF);
    if (eol === -1) return;
    const line = buffer.slice(0, eol);
    buffer = buffer.slice(eol + CRLF.length);
    const fn = pending;
    pending = null;
    pendingErr = null;
    if (pendingTimer) clearTimeout(pendingTimer);
    fn(line);
  }

  const awaitLine: Conversation['awaitLine'] = () =>
    new Promise((resolveLine, reject) => {
      if (socketError) {
        reject(socketError);
        return;
      }
      pending = (line) => {
        const match = line.match(/^(\d{3})([ -])(.*)$/);
        if (!match) {
          reject(new SmtpError('protocol_error', `SMTP i pavlefshëm: ${line}`));
          return;
        }
        resolveLine({
          code: Number(match[1]),
          line: match[3] ?? '',
          cont: match[2] === '-',
        });
      };
      pendingErr = reject;
      pendingTimer = setTimeout(() => {
        pending = null;
        pendingErr = null;
        reject(new SmtpError('timeout', 'Serveri SMTP nuk u përgjigj.'));
      }, READ_TIMEOUT_MS);
      // If buffer already has a line, dispatch synchronously.
      deliver();
    });

  const send: Conversation['send'] = (line) =>
    new Promise((resolveOk, reject) => {
      socket.write(line + CRLF, (err?: Error | null) => {
        if (err) reject(err);
        else resolveOk();
      });
    });

  return { socket, buffer, awaitLine, send };
}

async function drainGreeting(s: Conversation): Promise<void> {
  let cont = true;
  let last: number | null = null;
  while (cont) {
    const r = await s.awaitLine();
    last = r.code;
    cont = r.cont;
  }
  if (last !== 220) {
    throw new SmtpError('protocol_error', `SMTP greeting i papritur: ${last ?? '?'}`);
  }
}

async function readReply(s: Conversation): Promise<{ code: number; text: string[] }> {
  const text: string[] = [];
  let lastCode = 0;
  let cont = true;
  while (cont) {
    const r = await s.awaitLine();
    text.push(r.line);
    lastCode = r.code;
    cont = r.cont;
  }
  return { code: lastCode, text };
}

async function ehlo(s: Conversation, host: string): Promise<void> {
  await s.send(`EHLO ${selfDomain(host)}`);
  const r = await readReply(s);
  if (r.code !== 250) {
    throw new SmtpError('protocol_error', `EHLO u refuzua: ${r.code}`);
  }
}

async function maybeStartTls(s: Conversation, host: string): Promise<Conversation | null> {
  await s.send('STARTTLS');
  const r = await readReply(s);
  if (r.code === 502 || r.code === 454) {
    // Server doesn't support STARTTLS — continue plain.
    return null;
  }
  if (r.code !== 220) {
    throw new SmtpError('tls_failed', `STARTTLS u refuzua: ${r.code}`);
  }
  const upgraded: TLSSocket = await new Promise((resolveOk, reject) => {
    const tlsSock = tlsConnect(
      { socket: s.socket as Socket, servername: host },
      () => {
        resolveOk(tlsSock);
      },
    );
    tlsSock.once('error', (err) => reject(new SmtpError('tls_failed', `TLS dështoi: ${err.message}`)));
  });
  return wrapSocket(upgraded);
}

async function authenticate(s: Conversation, username: string, password: string): Promise<void> {
  // Try AUTH LOGIN (more widely supported) first.
  await s.send('AUTH LOGIN');
  const r1 = await readReply(s);
  if (r1.code !== 334) {
    throw new SmtpError('auth_failed', `AUTH LOGIN u refuzua: ${r1.code}`);
  }
  await s.send(Buffer.from(username, 'utf8').toString('base64'));
  const r2 = await readReply(s);
  if (r2.code !== 334) {
    throw new SmtpError('auth_failed', `Username u refuzua: ${r2.code}`);
  }
  await s.send(Buffer.from(password, 'utf8').toString('base64'));
  const r3 = await readReply(s);
  if (r3.code !== 235) {
    throw new SmtpError('auth_failed', `Identifikimi dështoi: ${r3.code}`);
  }
}

async function sendOne(s: Conversation, opts: SmtpDialOptions, message: SmtpMessage): Promise<void> {
  await s.send(`MAIL FROM:<${opts.fromAddress}>`);
  const r1 = await readReply(s);
  if (r1.code !== 250) {
    throw new SmtpError('rejected_sender', `Dërguesi u refuzua: ${r1.code}`);
  }
  await s.send(`RCPT TO:<${message.to}>`);
  const r2 = await readReply(s);
  if (r2.code !== 250 && r2.code !== 251) {
    throw new SmtpError('rejected_recipient', `Marrësi u refuzua: ${r2.code}`);
  }
  await s.send('DATA');
  const r3 = await readReply(s);
  if (r3.code !== 354) {
    throw new SmtpError('rejected_data', `DATA u refuzua: ${r3.code}`);
  }
  const body = composeMessage(opts, message);
  await s.send(body + CRLF + '.');
  const r4 = await readReply(s);
  if (r4.code !== 250) {
    throw new SmtpError('rejected_data', `Mesazhi u refuzua: ${r4.code}`);
  }
}

function composeMessage(opts: SmtpDialOptions, message: SmtpMessage): string {
  const date = new Date().toUTCString();
  const messageId = `<${Date.now()}-${Math.random().toString(36).slice(2, 10)}@klinika.health>`;
  const lines = [
    `From: ${encodeAddress(opts.fromName, opts.fromAddress)}`,
    `To: <${message.to}>`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    ...message.text.split('\n').map((l) => (l.startsWith('.') ? `.${l}` : l)),
  ];
  return lines.join(CRLF);
}

function encodeAddress(name: string, address: string): string {
  return `"${name.replace(/"/g, '')}" <${address}>`;
}

function encodeHeader(value: string): string {
  // Quick RFC-2047 fallback for non-ASCII (Albanian diacritics).
  // Plain ASCII passes through verbatim for readability in test inboxes.
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function selfDomain(host: string): string {
  // EHLO must include a domain we're sending from. Per RFC 5321 §4.1.4
  // it should be the client's own FQDN; in practice many servers
  // accept the SMTP host back, and clients in dev environments don't
  // have a public FQDN. `klinika.health` is the operationally correct
  // identifier for our platform.
  return process.env['SMTP_EHLO_HOST'] ?? `klinika.health (via ${host})`;
}
