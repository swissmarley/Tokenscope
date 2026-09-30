import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

const SIZES = { sm: 'h-8 w-8', md: 'h-9 w-9', lg: 'h-12 w-12' } as const;

export function IconButton({ label, active = false, size = 'md', className = '', children, ...rest }: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={
        `inline-flex ${SIZES[size]} items-center justify-center rounded-lg border transition-[background-color,border-color,transform,box-shadow] duration-150 ease-out-quint active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 ` +
        (active
          ? 'border-phase-model/50 bg-phase-model/15 text-text shadow-glow-model'
          : 'border-line bg-surface-2 text-text-muted hover:border-line-strong hover:bg-surface-3 hover:text-text') +
        ' ' +
        className
      }
      {...rest}
    >
      {children}
    </button>
  );
}
