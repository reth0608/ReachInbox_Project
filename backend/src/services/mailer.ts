import nodemailer, { type Transporter } from 'nodemailer';
import type { Sender } from '../db/schema';
import { childLogger } from '../utils/logger';

const log = childLogger('mailer');

export interface SendEmailInput {
  sender: Sender;
  to: string;
  subject: string;
  html: string;
}

export interface SendEmailResult {
  messageId: string;
  /** Ethereal's hosted preview URL for the sent message, when available. */
  previewUrl: string | false;
}

export class MailerError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MailerError';
  }
}

// One SMTP transport per sender, reused across sends rather than
// reconnecting every time.
const transportCache = new Map<string, Transporter>();

function getTransport(sender: Sender): Transporter {
  const cached = transportCache.get(sender.id);
  if (cached) return cached;

  const transport = nodemailer.createTransport({
    host: sender.smtpHost,
    port: sender.smtpPort,
    secure: sender.smtpPort === 465,
    auth: {
      user: sender.smtpUser,
      pass: sender.smtpPass,
    },
    // Fail fast on network issues rather than hanging a worker slot -
    // BullMQ's own retry/backoff is what should handle the retry, not a
    // stalled TCP connection.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });

  transportCache.set(sender.id, transport);
  return transport;
}

/**
 * Sends one email via the given sender's SMTP credentials (Ethereal in
 * development). Throws MailerError on any failure, wrapping the underlying
 * transport error so callers get a clean, loggable message.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const transport = getTransport(input.sender);

  try {
    const info = await transport.sendMail({
      from: `"${input.sender.name}" <${input.sender.smtpUser}>`,
      to: input.to,
      subject: input.subject,
      html: input.html,
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    log.info({ to: input.to, messageId: info.messageId, previewUrl }, 'email sent');

    return { messageId: info.messageId, previewUrl };
  } catch (err) {
    log.error({ err, to: input.to }, 'email send failed');
    throw new MailerError(err instanceof Error ? err.message : 'Unknown SMTP error', err);
  }
}

/** Used only by the seed script to provision a working Ethereal test account. */
export async function createTestSenderCredentials() {
  return nodemailer.createTestAccount();
}
