import React from 'react';
import { ArrowUpRight } from 'lucide-react';

interface Props {
  title: string;
  subtitle?: string;
  tone?: 'glass' | 'spotlight';
  accent?: string;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  onDrill?: () => void;
  drillLabel?: string;
  /** Stagger index for the entrance choreography. */
  index?: number;
  /** Paint the coloured bloom behind this card's content. */
  glow?: boolean;
}

/**
 * The Insight card.
 *
 * A machined outer tray, a single pane of glass inside it, and an editorial
 * header. The tray owns the rim and the lift; the pane owns the one blur. No
 * child may add a second backdrop-filter — that is the nested-blur rule this
 * app learned the expensive way.
 *
 * The spotlight tone is theme-adaptive: tinted periwinkle glass in light (the
 * operator rejected a black card sitting in a white room), deep navy in dark.
 * Both readings use token ink, so the contrast gates grade the real pairing.
 */
export const InsightsCard: React.FC<Props> = ({
  title,
  subtitle,
  tone = 'glass',
  accent = '#818cf8',
  className = '',
  contentClassName = '',
  children,
  action,
  onDrill,
  drillLabel = 'records',
  index = 0,
  glow = false,
}) => {
  const spotlight = tone === 'spotlight';

  const style = {
    '--insight-accent': accent,
    '--insight-i': index,
  } as React.CSSProperties;

  return (
    <div className={`insight-rise group relative h-full ${className}`} style={style} data-tone={tone}>
      <div className="insight-tray">
        <section
          className={`insight-core relative flex h-full flex-col overflow-hidden rounded-[25px] bg-ds-surface/80 ${
            spotlight ? 'insight-core--spotlight' : ''
          }`}
        >
          {glow && <div aria-hidden className="insight-card-glow" />}

          <header className="relative z-[1] flex items-start justify-between gap-3 px-5 pb-2 pt-4">
            <div className="min-w-0">
              <h3 className="text-[13px] font-bold leading-tight tracking-[-0.01em] text-ds-ink">
                {title}
              </h3>
              {subtitle && (
                <p className="mt-0.5 text-[10.5px] font-semibold text-ink-muted">{subtitle}</p>
              )}
            </div>

            {action ??
              (onDrill ? (
                <button
                  type="button"
                  onClick={onDrill}
                  aria-label={`View ${drillLabel} behind ${title}`}
                  title={`View ${drillLabel}`}
                  className="insight-drill text-ds-accent"
                >
                  <ArrowUpRight className="h-[15px] w-[15px]" strokeWidth={1.7} aria-hidden />
                </button>
              ) : null)}
          </header>

          <div className={`relative z-[1] flex min-h-0 flex-1 flex-col px-5 pb-5 pt-1 ${contentClassName}`}>
            {children}
          </div>
        </section>
      </div>
    </div>
  );
};
