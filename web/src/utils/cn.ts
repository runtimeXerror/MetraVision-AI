import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Class composer.
 *
 * `twMerge` resolves conflicts so a caller's `className` can always override a
 * component's default — without it, `<Button className="bg-white">` would lose
 * to the variant's own background depending on stylesheet order.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
