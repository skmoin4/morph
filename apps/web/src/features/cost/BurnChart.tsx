import { useMemo, useState } from 'react';
import { cn } from '../../lib/cn';
import { formatDisplayDate } from '../../lib/format';
import { formatHoursPlain, type CostSummary } from './useCost';

const W = 640;
const H = 230;
const PAD = { top: 16, right: 18, bottom: 28, left: 46 };

const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/**
 * Hours burned against the hours budget, as a running total.
 *
 * One axis, one data series. The budget and the 80 % mark are reference lines,
 * labelled in place. Hover (or touch) a posting date for its figure; the same
 * numbers are available as a table, so nothing depends on seeing the line.
 */
export function BurnChart({
  series,
  budgetHours,
  today,
}: {
  series: CostSummary['series'];
  budgetHours: number;
  /** Extends the line to today so a quiet stretch reads as flat, not as missing. */
  today: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const geometry = useMemo(() => {
    if (series.length === 0) return null;
    const last = series[series.length - 1];
    const firstDay = dayNumber(series[0].date) - 3;
    const lastDay = Math.max(dayNumber(last.date), dayNumber(today)) + 1;
    const top = Math.max(budgetHours * 1.12, last.hours * 1.1, 10);
    const x = (day: number) =>
      PAD.left + ((day - firstDay) / Math.max(1, lastDay - firstDay)) * (W - PAD.left - PAD.right);
    const y = (hours: number) => PAD.top + (1 - hours / top) * (H - PAD.top - PAD.bottom);

    const points = [{ date: series[0].date, hours: 0 }, ...series].map((p) => ({
      ...p,
      px: x(dayNumber(p.date)),
      py: y(p.hours),
    }));
    // A step line: the total holds until the next posting.
    const path = points.map((p, i) => (i === 0 ? `M${p.px},${p.py}` : `H${p.px}V${p.py}`)).join('');
    const todayX = x(dayNumber(today));
    const area = `${path}H${todayX}V${y(0)}H${points[0].px}Z`;

    const ticks = [0, 0.25, 0.5, 0.75, 1]
      .map((f) => Math.round((top * f) / 5) * 5)
      .filter((v, i, a) => a.indexOf(v) === i);
    return { points, path: `${path}H${todayX}`, area, todayX, y, x, ticks, top };
  }, [series, budgetHours, today]);

  if (!geometry) {
    return (
      <p className="rounded-card bg-surface-2 px-4 py-8 text-center text-sub text-muted">
        No hours have posted yet. The curve starts with the first approved timesheet.
      </p>
    );
  }
  const { points, path, area, todayX, y, ticks } = geometry;
  const shown = hover === null ? series[series.length - 1] : series[hover];
  const budgetY = y(budgetHours);
  const warnY = y(budgetHours * 0.8);

  if (asTable) {
    return (
      <div>
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            className="text-sub font-heavy text-blue"
            onClick={() => setAsTable(false)}
          >
            Show as chart
          </button>
        </div>
        <div className="max-h-64 overflow-auto rounded-card border border-line">
          <table className="w-full text-body">
            <thead className="sticky top-0 bg-surface-2 text-left text-micro uppercase text-muted">
              <tr>
                <th className="px-3 py-2">Posting date</th>
                <th className="px-3 py-2 text-right">Hours so far</th>
                <th className="px-3 py-2 text-right">% of budget</th>
              </tr>
            </thead>
            <tbody>
              {series.map((p) => (
                <tr key={p.date} className="border-t border-line">
                  <td className="px-3 py-1.5">{formatDisplayDate(p.date)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatHoursPlain(p.hours)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {budgetHours > 0 ? `${Math.round((p.hours / budgetHours) * 1000) / 10}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sub text-ink-2">
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-5 rounded bg-blue" /> Hours posted
            (running total)
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-5 border-t-2 border-dashed border-ink-2" />{' '}
            Budget
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-5 border-t-2 border-dashed border-amber" />{' '}
            80 % alert
          </li>
        </ul>
        <button
          type="button"
          className="text-sub font-heavy text-blue"
          onClick={() => setAsTable(true)}
        >
          Show as table
        </button>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Hours posted against a budget of ${budgetHours} hours. Latest total ${series[series.length - 1].hours} hours.`}
          className="h-auto w-full"
          onMouseLeave={() => setHover(null)}
        >
          {/* Recessive grid and the value axis */}
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
                {t}
              </text>
            </g>
          ))}

          {/* Reference lines, labelled in place */}
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={warnY}
            y2={warnY}
            className="stroke-amber"
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={budgetY}
            y2={budgetY}
            className="stroke-ink-2"
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
          <text
            x={W - PAD.right}
            y={budgetY - 5}
            textAnchor="end"
            className="fill-ink-2 text-[10px] font-semibold"
          >
            Budget {budgetHours} h
          </text>

          {/* The running total */}
          <path d={area} className="fill-blue/10" />
          <path
            d={path}
            fill="none"
            className="stroke-blue"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <circle
            cx={todayX}
            cy={points[points.length - 1].py}
            r={4.5}
            className="fill-blue stroke-surface"
            strokeWidth={2}
          />

          {/* Hit targets: wider than the marks they reveal */}
          {series.map((p, i) => {
            const cx = points[i + 1].px;
            return (
              <g key={p.date}>
                <circle
                  cx={cx}
                  cy={points[i + 1].py}
                  r={hover === i ? 5 : 3}
                  className="fill-blue stroke-surface"
                  strokeWidth={2}
                />
                <rect
                  x={cx - 12}
                  y={PAD.top}
                  width={24}
                  height={H - PAD.top - PAD.bottom}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onClick={() => setHover(i)}
                  tabIndex={0}
                  aria-label={`${formatDisplayDate(p.date)}: ${p.hours} hours so far`}
                />
              </g>
            );
          })}
          <text x={PAD.left} y={H - 8} className="fill-muted text-[10px]">
            {formatDisplayDate(series[0].date)}
          </text>
          <text x={W - PAD.right} y={H - 8} textAnchor="end" className="fill-muted text-[10px]">
            {formatDisplayDate(today)}
          </text>
        </svg>
      </div>

      <p className={cn('mt-1 text-sub tabular-nums text-ink-2')} aria-live="polite">
        {hover === null ? 'Latest' : formatDisplayDate(shown.date)}:{' '}
        <strong>{formatHoursPlain(shown.hours)}</strong>
        {budgetHours > 0 && (
          <> · {Math.round((shown.hours / budgetHours) * 1000) / 10}% of budget</>
        )}
      </p>
    </div>
  );
}
