import { useMemo, useState } from 'react';
import { cn } from '../../lib/cn';

export interface ColumnSeries {
  key: string;
  label: string;
  /** Tailwind classes for the swatch (`bg-*`) and the SVG fill (`fill-*`). */
  swatch: string;
  fill: string;
}

export interface ColumnDatum {
  label: string;
  values: Record<string, number>;
}

const W = 380;
const H = 200;
const PAD = { top: 16, right: 8, bottom: 24, left: 56 };

/** A "nice" ceiling so the top gridline is a round number. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return step * exp;
}

/**
 * Columns over time, one axis, optionally stacked.
 *
 * Marks are thin with a rounded top and a 2px gap between stacked segments; the
 * grid is recessive. One series needs no legend (the panel title names it);
 * two or more always get one. Hover or tab to a column for its figures, and the
 * same numbers are available as a table, so nothing depends on colour.
 */
export function ColumnChart({
  data,
  series,
  formatValue,
  formatTick = formatValue,
  ariaLabel,
  emptyText = 'Nothing to show for this period yet.',
}: {
  data: ColumnDatum[];
  series: ColumnSeries[];
  formatValue: (value: number) => string;
  formatTick?: (value: number) => string;
  ariaLabel: string;
  emptyText?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const totals = data.map((d) => series.reduce((sum, s) => sum + (d.values[s.key] ?? 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const hasData = totals.some((t) => t > 0);

  const geometry = useMemo(() => {
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const slot = innerW / Math.max(1, data.length);
    const barW = Math.min(26, slot * 0.5);
    const y = (v: number) => PAD.top + (1 - v / max) * innerH;
    const ticks = [0, 0.5, 1].map((f) => max * f);
    return { slot, barW, y, ticks, baseline: y(0) };
  }, [data.length, max]);

  if (!hasData) {
    return (
      <p className="rounded-card bg-surface-2 px-4 py-8 text-center text-sub text-muted">
        {emptyText}
      </p>
    );
  }

  const toggle = (
    <button
      type="button"
      className="text-sub font-heavy text-blue"
      onClick={() => setAsTable((v) => !v)}
    >
      {asTable ? 'Show as chart' : 'Show as table'}
    </button>
  );

  if (asTable) {
    return (
      <div>
        <div className="mb-2 flex justify-end">{toggle}</div>
        <div className="overflow-auto rounded-card border border-line">
          <table className="w-full text-body">
            <thead className="bg-surface-2 text-left text-micro uppercase text-muted">
              <tr>
                <th className="px-3 py-2">Period</th>
                {series.map((s) => (
                  <th key={s.key} className="px-3 py-2 text-right">
                    {s.label}
                  </th>
                ))}
                {series.length > 1 && <th className="px-3 py-2 text-right">Total</th>}
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={d.label} className="border-t border-line">
                  <td className="px-3 py-1.5">{d.label}</td>
                  {series.map((s) => (
                    <td key={s.key} className="px-3 py-1.5 text-right tabular-nums">
                      {formatValue(d.values[s.key] ?? 0)}
                    </td>
                  ))}
                  {series.length > 1 && (
                    <td className="px-3 py-1.5 text-right font-heavy tabular-nums">
                      {formatValue(totals[i])}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const { slot, barW, y, ticks, baseline } = geometry;
  const lastIndex = data.length - 1;

  return (
    <div>
      <div
        className={cn(
          'mb-2 flex flex-wrap items-center gap-2',
          series.length > 1 ? 'justify-between' : 'justify-end',
        )}
      >
        {series.length > 1 && (
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sub text-ink-2">
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span aria-hidden className={cn('inline-block size-2.5 rounded-sm', s.swatch)} />
                {s.label}
              </li>
            ))}
          </ul>
        )}
        {toggle}
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={ariaLabel}
          className="h-auto w-full"
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                className="stroke-line"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(t) + 3.5}
                textAnchor="end"
                className="fill-muted text-[10px]"
              >
                {formatTick(t)}
              </text>
            </g>
          ))}

          {data.map((d, i) => {
            const cx = PAD.left + slot * i + slot / 2;
            let acc = 0;
            const segments = series
              .map((s) => ({ s, v: d.values[s.key] ?? 0 }))
              .filter((seg) => seg.v > 0);
            return (
              <g
                key={d.label}
                tabIndex={0}
                role="img"
                aria-label={`${d.label}: ${series
                  .map((s) => `${s.label} ${formatValue(d.values[s.key] ?? 0)}`)
                  .join(', ')}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="outline-none"
              >
                {/* A wide, invisible hit target, bigger than the mark */}
                <rect
                  x={cx - slot / 2}
                  y={PAD.top}
                  width={slot}
                  height={H - PAD.top - PAD.bottom}
                  fill="transparent"
                />
                {hover === i && (
                  <rect
                    x={cx - slot / 2}
                    y={PAD.top}
                    width={slot}
                    height={H - PAD.top - PAD.bottom}
                    className="fill-line-soft"
                    opacity={0.7}
                  />
                )}
                {segments.map(({ s, v }, k) => {
                  const top = y(acc + v);
                  const bottom = y(acc) - (k > 0 ? 2 : 0); // 2px gap between stacked fills
                  acc += v;
                  const height = Math.max(2, bottom - top);
                  const isTop = k === segments.length - 1;
                  const r = Math.min(4, barW / 2, height);
                  const x0 = cx - barW / 2;
                  const x1 = cx + barW / 2;
                  const yTop = bottom - height;
                  // Rounded data-end on the top segment only; the base stays square.
                  const path = isTop
                    ? `M${x0},${bottom}V${yTop + r}Q${x0},${yTop} ${x0 + r},${yTop}H${x1 - r}Q${x1},${yTop} ${x1},${yTop + r}V${bottom}Z`
                    : `M${x0},${bottom}V${yTop}H${x1}V${bottom}Z`;
                  return <path key={s.key} d={path} className={s.fill} />;
                })}
                {/* Direct label on the latest column only */}
                {i === lastIndex && totals[i] > 0 && (
                  <text
                    x={cx}
                    y={y(totals[i]) - 6}
                    textAnchor="middle"
                    className="fill-ink-2 text-[10px] font-semibold"
                  >
                    {formatValue(totals[i])}
                  </text>
                )}
                <text
                  x={cx}
                  y={H - 8}
                  textAnchor="middle"
                  className={cn('text-[10px]', hover === i ? 'fill-ink-2' : 'fill-muted')}
                >
                  {d.label}
                </text>
              </g>
            );
          })}
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={baseline}
            y2={baseline}
            className="stroke-line"
            strokeWidth={1}
          />
        </svg>

        {hover !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-control border border-line bg-surface px-3 py-2 text-sub shadow-card"
            style={{
              left: `${Math.min(
                72,
                Math.max(2, ((PAD.left + slot * hover + slot / 2) / W) * 100 - 12),
              )}%`,
            }}
          >
            <p className="font-heavy text-ink">{data[hover].label}</p>
            {series.map((s) => (
              <p key={s.key} className="mt-0.5 flex items-center justify-between gap-4 text-ink-2">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className={cn('inline-block size-2 rounded-sm', s.swatch)} />
                  {s.label}
                </span>
                <span className="tabular-nums">{formatValue(data[hover].values[s.key] ?? 0)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
