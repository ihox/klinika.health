import { cn } from '@/lib/utils';

interface SectionCardProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function SectionCard({
  title,
  description,
  children,
  actions,
  className,
}: SectionCardProps) {
  return (
    <div
      className={cn(
        'bg-white border border-stone-200 rounded-xl shadow-xs mb-5 overflow-hidden',
        className,
      )}
    >
      <div className="px-6 py-4 border-b border-stone-200 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[14px] font-semibold text-stone-900">{title}</h3>
          {description ? (
            <div className="text-[12px] text-stone-500 mt-0.5">{description}</div>
          ) : null}
        </div>
      </div>
      <div className="px-6 py-5">{children}</div>
      {actions ? (
        <div className="px-6 py-3.5 border-t border-stone-200 bg-stone-50 flex justify-end gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function PaneHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-5">
      <h2 className="font-display text-[18px] font-semibold text-stone-900 tracking-[-0.015em]">
        {title}
      </h2>
      {description ? (
        <p className="text-[13px] text-stone-500 mt-0.5">{description}</p>
      ) : null}
    </header>
  );
}

export function InfoTip({
  children,
  tone = 'info',
}: {
  children: React.ReactNode;
  tone?: 'info' | 'warning';
}) {
  const styles =
    tone === 'warning'
      ? 'bg-amber-50 border-amber-200 text-amber-900'
      : 'bg-teal-50 border-teal-200 text-teal-900';
  const icon = tone === 'warning' ? '!' : 'i';
  return (
    <div
      className={cn(
        'flex gap-2.5 px-3 py-2.5 border rounded-md text-[12px] leading-[1.5] items-start',
        styles,
      )}
    >
      <span
        className={`h-4 w-4 mt-0.5 grid place-items-center rounded-full text-[10px] font-bold italic shrink-0 text-white ${
          tone === 'warning' ? 'bg-amber-700' : 'bg-teal-600'
        }`}
        aria-hidden
      >
        {icon}
      </span>
      <div>{children}</div>
    </div>
  );
}

export function FormGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-x-7 gap-y-4 items-start">{children}</div>
  );
}

export function FieldLabel({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="pt-2.5 text-[13px] text-stone-500 font-medium"
    >
      {children}
    </label>
  );
}

export function FieldHelp({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 text-[12px] text-stone-400">{children}</div>;
}
