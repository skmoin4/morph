import { useRef, useState } from 'react';
import { FileText, Loader2, Paperclip, X } from 'lucide-react';
import {
  CONFIRMATION_FILE_EXTENSIONS,
  describeConfirmationFileRules,
  validateConfirmationFile,
} from '@opsvera/shared';
import { Button, IconButton } from '../../components/ui/Button';
import { ApiRequestError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { uploadConfirmationFile, type UploadedFile } from './useBookings';

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Picks a file and uploads it immediately, so the booking only ever refers to a
 * document that already exists. The browser runs the same size/type check the
 * API runs — a convenience; the API's check is the rule.
 */
export function FileUpload({
  label,
  category,
  value,
  onChange,
  error,
  hint,
}: {
  label: string;
  category: string;
  value: UploadedFile | null;
  onChange: (file: UploadedFile | null) => void;
  error?: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function handle(file: File | undefined) {
    if (!file) return;
    setProblem(null);

    const verdict = validateConfirmationFile({ name: file.name, size: file.size, type: file.type });
    if (!verdict.ok) {
      setProblem(verdict.message);
      return;
    }

    setUploading(true);
    try {
      onChange(await uploadConfirmationFile(file, category));
    } catch (err) {
      setProblem(
        err instanceof ApiRequestError
          ? err.status === 413
            ? 'That file is over the 10 MB limit.'
            : err.message
          : 'Upload failed. Try again.',
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const message = error ?? problem;

  return (
    <div>
      <p className="mb-1.5 text-sub font-heavy text-ink-2">{label}</p>

      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-card border border-line bg-surface-2 p-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <FileText aria-hidden className="size-5 shrink-0 text-blue" />
            <div className="min-w-0">
              <p className="truncate text-body font-heavy text-ink">{value.fileName}</p>
              <p className="text-micro tracking-normal text-muted">
                {formatSize(value.sizeBytes)} · uploaded
              </p>
            </div>
          </div>
          <IconButton label={`Remove ${value.fileName}`} size="sm" onClick={() => onChange(null)}>
            <X />
          </IconButton>
        </div>
      ) : (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void handle(event.dataTransfer.files[0]);
          }}
          className={cn(
            'flex flex-col items-center gap-2 rounded-card border border-dashed p-4 text-center transition-colors',
            dragging ? 'border-blue bg-pill-blue-bg/50' : 'border-line bg-surface-2',
            message && 'border-red/60',
          )}
        >
          {uploading ? (
            <p className="inline-flex items-center gap-2 text-sub text-muted">
              <Loader2 aria-hidden className="size-4 animate-spin" /> Uploading…
            </p>
          ) : (
            <>
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Paperclip />}
                onClick={() => inputRef.current?.click()}
              >
                Choose file
              </Button>
              <p className="text-micro tracking-normal text-muted">
                {hint ?? `or drop it here — ${describeConfirmationFileRules()}`}
              </p>
            </>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label={label}
        accept={CONFIRMATION_FILE_EXTENSIONS.join(',')}
        onChange={(event) => void handle(event.target.files?.[0])}
      />

      {message && (
        <p role="alert" className="mt-1.5 text-micro tracking-normal text-red">
          {message}
        </p>
      )}
    </div>
  );
}
