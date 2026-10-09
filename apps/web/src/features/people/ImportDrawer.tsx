import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import type { ImportResult } from '@opsvera/shared';
import { Drawer } from '../../components/ui/Drawer';
import { Button } from '../../components/ui/Button';
import { Panel } from '../../components/ui/Panel';
import { Pill } from '../../components/ui/Pill';
import { ApiRequestError, getAccessToken } from '../../lib/api';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';

/**
 * Bulk import, in two deliberate stages.
 *
 * The file is always validated first and the row-level errors shown; the
 * commit button only appears once the sheet is clean. The server imports in a
 * single transaction, so a partial org can never result.
 */
export function ImportDrawer({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('dryRun', String(dryRun));

      // FormData needs the browser to set its own multipart boundary, so this
      // one request bypasses the JSON helper.
      const response = await fetch(`${BASE_URL}/employees/import`, {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        body: form,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new ApiRequestError(response.status, payload);

      const imported = payload as ImportResult;
      setResult(imported);

      if (!dryRun && imported.created > 0) {
        await queryClient.invalidateQueries({ queryKey: ['people'] });
        toast.success(`Imported ${imported.created} employees`);
        onClose();
      } else if (dryRun) {
        toast(
          imported.errors.length === 0
            ? `All ${imported.totalRows} rows look good`
            : `${imported.errors.length} problems found across ${imported.totalRows} rows`,
        );
      }
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplate() {
    const response = await fetch(`${BASE_URL}/employees/import/template`, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
    });
    if (!response.ok) {
      toast.error('Could not download the template.');
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'opsvera-employee-import.xlsx';
    link.click();
    URL.revokeObjectURL(url);
  }

  const clean = result !== null && result.errors.length === 0;

  return (
    <Drawer
      open
      onClose={onClose}
      title="Import employees"
      subtitle="Validate first, then commit. Nothing is written until the sheet is clean."
      width="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" disabled={!file || busy} onClick={() => send(true)}>
            Validate
          </Button>
          <Button
            variant="primary"
            disabled={!clean || busy}
            loading={busy && clean}
            onClick={() => send(false)}
          >
            {clean ? `Import ${result!.valid} employees` : 'Import'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Panel
          title="1. Start from the template"
          subtitle="It has the exact headers, an example row and notes on each column."
        >
          <Button variant="secondary" leadingIcon={<Download />} onClick={downloadTemplate}>
            Download template (.xlsx)
          </Button>
        </Panel>

        <Panel title="2. Upload your sheet" subtitle="Excel .xlsx, up to 5 MB and 2,000 rows.">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="sr-only"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setResult(null);
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center gap-3 rounded-card border border-dashed border-line bg-surface-2 px-4 py-5 text-left transition-colors hover:border-blue-2/60 hover:bg-pill-blue-bg/40"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-card bg-surface text-muted">
              {file ? <FileSpreadsheet className="size-5" /> : <Upload className="size-5" />}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-body font-heavy text-ink">
                {file ? file.name : 'Choose a spreadsheet'}
              </span>
              <span className="mt-0.5 block text-sub text-muted">
                {file
                  ? `${(file.size / 1024).toFixed(0)} KB — click to pick a different file`
                  : 'Only .xlsx is supported'}
              </span>
            </span>
          </button>
        </Panel>

        {result && (
          <Panel
            title="3. Validation report"
            subtitle={`${result.totalRows} rows read · ${result.valid} ready to import`}
          >
            {clean ? (
              <div className="flex items-start gap-2.5 rounded-card border border-pill-green-bg bg-pill-green-bg/50 p-3">
                <CheckCircle2 aria-hidden className="mt-px size-4 shrink-0 text-pill-green-fg" />
                <p className="text-sub text-pill-green-fg">
                  Every row is valid. Nothing has been written yet — press Import to commit all{' '}
                  {result.valid} in one transaction.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-2.5 rounded-card border border-[#ffd7d8] bg-[#fff4f4] p-3">
                  <AlertTriangle aria-hidden className="mt-px size-4 shrink-0 text-pill-red-fg" />
                  <p className="text-sub text-pill-red-fg">
                    {result.errors.length} problem{result.errors.length === 1 ? '' : 's'} across{' '}
                    {new Set(result.errors.map((e) => e.rowNumber)).size} row
                    {new Set(result.errors.map((e) => e.rowNumber)).size === 1 ? '' : 's'}. Fix the
                    sheet and validate again — nothing has been imported.
                  </p>
                </div>

                <div className="scroll-slim mt-3 max-h-80 overflow-auto rounded-card border border-line">
                  <table className="w-full border-collapse">
                    <thead className="sticky top-0 bg-surface-2">
                      <tr>
                        {['Row', 'Code', 'Column', 'Problem'].map((header) => (
                          <th
                            key={header}
                            scope="col"
                            className="whitespace-nowrap border-b border-line px-3 py-2 text-left text-micro font-heavy uppercase text-[#7d8a9f]"
                          >
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.map((error, index) => (
                        <tr
                          key={`${error.rowNumber}-${error.field}-${index}`}
                          className="border-b border-line-soft last:border-b-0"
                        >
                          <td className="px-3 py-2 tabular-nums">{error.rowNumber}</td>
                          <td className="px-3 py-2 font-mono text-sub">
                            {error.employeeCode || '—'}
                          </td>
                          <td className="px-3 py-2">
                            <Pill tone="red" dot={false}>
                              {error.field}
                            </Pill>
                          </td>
                          <td className="px-3 py-2 text-sub">{error.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Panel>
        )}
      </div>
    </Drawer>
  );
}
