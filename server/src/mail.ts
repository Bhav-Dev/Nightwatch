/** Outgoing email. Console for development and tests, Resend over HTTP in production. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Logs messages and keeps them, so tests can read the magic link out of the "inbox". */
export class ConsoleMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  constructor(private readonly quiet = false) {}

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    if (!this.quiet) console.log(`[mail] to ${message.to}: ${message.subject}\n${message.text}`);
  }
}

/** Resend's REST API with plain fetch, so it needs no SDK on Node or Deno. */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const res = await this.fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text }),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
  }
}

export function mailerFromEnv(env: Record<string, string | undefined>): Mailer {
  if (env.RESEND_API_KEY && env.MAIL_FROM) return new ResendMailer(env.RESEND_API_KEY, env.MAIL_FROM);
  console.warn('RESEND_API_KEY or MAIL_FROM not set: sign-in emails are printed to the log instead of sent');
  return new ConsoleMailer();
}

/** Copy: sentence case, no exclamation marks. */
export function magicLinkEmail(to: string, link: string, ttlMinutes: number): MailMessage {
  return {
    to,
    subject: 'Your SnoreHive sign-in link',
    text: [
      'Open this link on your phone to sign in to SnoreHive:',
      '',
      link,
      '',
      `The link works once and expires in ${ttlMinutes} minutes.`,
      'If you did not ask to sign in, you can ignore this email.',
    ].join('\n'),
  };
}
