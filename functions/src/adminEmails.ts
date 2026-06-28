const ADMIN_EMAILS = [
  '5329548871.eg@gmail.com',
  '5329548871,eg@gmail.com',
] as const;

const ADMIN_EMAIL_SET = new Set<string>(ADMIN_EMAILS);

export function isAdminEmail(email: unknown): boolean {
  return typeof email === 'string' && ADMIN_EMAIL_SET.has(email.toLowerCase());
}

