'use client';

import * as React from 'react';

/**
 * Tiny set of shadcn-flavored primitives (Button, Card, Input, Select,
 * Switch, Badge). Hand-rolled with Tailwind so we don't pull the shadcn CLI
 * in this scaffolding PR. We can swap to real shadcn/ui later — same API
 * shape on purpose.
 */

function cx(...args: (string | undefined | null | false)[]): string {
  return args.filter(Boolean).join(' ');
}

export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cx(
      'rounded-xl border border-slate-200 bg-white shadow-sm',
      className,
    )}
    {...props}
  />
));
Card.displayName = 'Card';

export function CardHeader({
  title,
  subtitle,
  className,
  children,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cx('px-5 pt-5 pb-3', className)}>
      {title && <h3 className="font-semibold text-slate-900">{title}</h3>}
      {subtitle && (
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      )}
      {children}
    </div>
  );
}

export function CardBody({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return <div className={cx('px-5 pb-5', className)}>{children}</div>;
}

export const Label = ({
  htmlFor,
  children,
  hint,
}: {
  htmlFor?: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) => (
  <label
    htmlFor={htmlFor}
    className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500"
  >
    <span>{children}</span>
    {hint && <span className="font-normal normal-case text-slate-400">{hint}</span>}
  </label>
);

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cx(
      'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900',
      'placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900',
      'num text-right',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cx(
      'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900',
      'focus:outline-none focus:ring-2 focus:ring-slate-900',
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = 'Select';

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-1',
        checked ? 'bg-slate-900' : 'bg-slate-300',
      )}
    >
      <span className="sr-only">{label}</span>
      <span
        className={cx(
          'pointer-events-none inline-block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow ring-0 transition',
          checked && 'translate-x-[1.375rem]',
        )}
      />
    </button>
  );
}

export function Badge({
  children,
  variant = 'default',
}: {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const styles = {
    default: 'bg-slate-100 text-slate-700',
    success: 'bg-emerald-100 text-emerald-800',
    warning: 'bg-amber-100 text-amber-800',
    danger:  'bg-rose-100 text-rose-800',
    info:    'bg-sky-100 text-sky-800',
  } as const;
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        styles[variant],
      )}
    >
      {children}
    </span>
  );
}

export function StatRow({
  label,
  value,
  emphasis,
  hint,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  emphasis?: boolean;
  hint?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-2 last:border-b-0">
      <div className="flex flex-col">
        <span
          className={cx(
            'text-sm',
            emphasis ? 'font-semibold text-slate-900' : 'text-slate-600',
          )}
        >
          {label}
        </span>
        {hint && <span className="text-xs text-slate-400">{hint}</span>}
      </div>
      <span className={cx('num', emphasis && 'font-semibold')}>{value}</span>
    </div>
  );
}
