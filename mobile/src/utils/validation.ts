/**
 * Form validation.
 *
 * Validators return an error string or `undefined`, which composes cleanly into
 * the `Record<string, string>` error maps the form screens keep in state.
 */

export type Validator = (value: string) => string | undefined;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Inspector badge format, e.g. `LM-INS-4471`. */
const INSPECTOR_ID_RE = /^[A-Z]{2,4}-[A-Z]{2,4}-\d{3,6}$/i;

export function required(label: string): Validator {
  return (value) => (value.trim().length === 0 ? `${label} is required` : undefined);
}

export function minLength(label: string, min: number): Validator {
  return (value) =>
    value.trim().length < min ? `${label} must be at least ${min} characters` : undefined;
}

/** The login field accepts either an email address or an inspector ID. */
export function identifier(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return 'Email or Inspector ID is required';
  if (EMAIL_RE.test(trimmed) || INSPECTOR_ID_RE.test(trimmed)) return undefined;
  return 'Enter a valid email address or Inspector ID';
}

export function email(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return 'Email is required';
  return EMAIL_RE.test(trimmed) ? undefined : 'Enter a valid email address';
}

export function password(value: string): string | undefined {
  if (!value) return 'Password is required';
  if (value.length < 6) return 'Password must be at least 6 characters';
  return undefined;
}

/** Runs a map of validators and returns only the fields that failed. */
export function validate<T extends Record<string, string>>(
  values: T,
  validators: Partial<Record<keyof T, Validator>>,
): Partial<Record<keyof T, string>> {
  const errors: Partial<Record<keyof T, string>> = {};

  for (const key of Object.keys(validators) as Array<keyof T>) {
    const validator = validators[key];
    if (!validator) continue;
    const message = validator(values[key] ?? '');
    if (message) errors[key] = message;
  }

  return errors;
}

export function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some(Boolean);
}
