import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Camera, FileText, Paperclip, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { SelectField, TextAreaField, TextField } from '../../components/ui/Field';
import { ApiRequestError } from '../../lib/api';
import {
  formatFileSize,
  formatRupees,
  parseAmountInput,
  useCreateExpense,
  useExpenseLookups,
  useSubmitExpense,
  useUpdateExpense,
  useUploadReceipt,
  type ExpenseRow,
} from './useExpenses';

const RECEIPT_MAX = 10 * 1024 * 1024;

/** Claim an expense: save as a draft, or send straight to your manager. */
export function ExpenseDialog({
  expense,
  today,
  onClose,
}: {
  expense?: ExpenseRow;
  today: string;
  onClose: () => void;
}) {
  const { data: lookups } = useExpenseLookups();
  const create = useCreateExpense();
  const update = useUpdateExpense();
  const submit = useSubmitExpense();
  const upload = useUploadReceipt();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [categoryId, setCategoryId] = useState(expense?.category.id ?? '');
  const [projectId, setProjectId] = useState(expense?.project?.id ?? '');
  const [expenseDate, setExpenseDate] = useState(expense?.expenseDate ?? today);
  const [amount, setAmount] = useState(expense ? String(Number(expense.amount)) : '');
  const [isBillable, setIsBillable] = useState(expense?.isBillable ?? false);
  const [description, setDescription] = useState(expense?.description ?? '');
  const [receipt, setReceipt] = useState<{
    id: string;
    fileName: string;
    sizeBytes: number;
    mimeType: string;
  } | null>(expense?.receipt ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<string[]>([]);

  const category = lookups?.categories.find((c) => c.id === categoryId);
  const parsed = parseAmountInput(amount);
  const busy = create.isPending || update.isPending || submit.isPending || upload.isPending;

  // The limit hint appears as soon as it would apply; it never blocks.
  const overClaim =
    parsed && category?.perClaimLimit && Number(parsed) > Number(category.perClaimLimit)
      ? `Over the ${formatRupees(category.perClaimLimit)} per-claim limit. Your approvers will see it flagged.`
      : null;

  async function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > RECEIPT_MAX) {
      setErrors((e) => ({ ...e, receiptDocumentId: 'That file is over 10 MB.' }));
      return;
    }
    try {
      const doc = await upload.mutateAsync(file);
      setReceipt(doc);
      setErrors((e) => ({ ...e, receiptDocumentId: '' }));
    } catch (error) {
      setErrors((e) => ({
        ...e,
        receiptDocumentId:
          error instanceof ApiRequestError ? error.message : 'Could not upload the receipt.',
      }));
    }
  }

  function validate(): ExpenseFormValues | null {
    const next: Record<string, string> = {};
    if (!categoryId) next.categoryId = 'Choose a category';
    if (!parsed) next.amount = 'Enter the amount, like 1250 or 1,250.50';
    if (!expenseDate) next.expenseDate = 'Pick the date';
    if (Object.keys(next).length) {
      setErrors(next);
      return null;
    }
    return {
      categoryId,
      projectId: projectId || null,
      expenseDate,
      amount: parsed!,
      isBillable,
      description: description || null,
      receiptDocumentId: receipt?.id ?? null,
    };
  }

  async function save(andSubmit: boolean) {
    const values = validate();
    if (!values) return;
    if (andSubmit && category?.requiresReceipt && !receipt) {
      setErrors({ receiptDocumentId: `${category.name} claims need a receipt.` });
      return;
    }
    try {
      const saved = expense
        ? await update.mutateAsync({ id: expense.id, input: values })
        : await create.mutateAsync(values);
      if (saved.warnings?.length) setWarnings(saved.warnings);
      if (andSubmit) {
        await submit.mutateAsync(saved.id);
        toast.success('Sent to your manager');
      } else {
        toast.success('Saved as a draft');
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiRequestError && Object.keys(error.fieldErrors).length > 0) {
        setErrors(error.fieldErrors);
      } else {
        setErrors({
          amount: error instanceof ApiRequestError ? error.message : 'Could not save the claim.',
        });
      }
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={expense ? 'Change this claim' : 'New expense'}
      description="Add the receipt, save a draft or send it to your manager."
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="secondary" loading={busy} onClick={() => save(false)}>
            Save draft
          </Button>
          <Button variant="primary" loading={busy} onClick={() => save(true)}>
            Submit
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Category"
          required
          error={errors.categoryId}
          value={categoryId}
          onChange={(event) => {
            setCategoryId(event.target.value);
            setErrors({});
          }}
          options={[
            { value: '', label: 'Choose…' },
            ...(lookups?.categories ?? []).map((c) => ({ value: c.id, label: c.name })),
          ]}
          hint={
            category
              ? [
                  category.perClaimLimit
                    ? `Up to ${formatRupees(category.perClaimLimit)} a claim`
                    : null,
                  category.perMonthLimit ? `${formatRupees(category.perMonthLimit)} a month` : null,
                  category.requiresReceipt ? 'receipt needed' : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || undefined
              : undefined
          }
        />
        <TextField
          label="Amount (₹)"
          required
          inputMode="decimal"
          placeholder="1250"
          error={errors.amount}
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            setErrors({});
          }}
        />
        <TextField
          label="Date"
          type="date"
          required
          max={today}
          error={errors.expenseDate}
          value={expenseDate}
          onChange={(event) => setExpenseDate(event.target.value)}
        />
        <SelectField
          label="Project (optional)"
          error={errors.projectId}
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          options={[
            { value: '', label: 'No project (general)' },
            ...(lookups?.projects ?? []).map((p) => ({
              value: p.id,
              label: `${p.projectCode} · ${p.name}`,
            })),
          ]}
          hint={projectId ? 'Approved claims become project cost.' : undefined}
        />
        <TextAreaField
          label="What was it for?"
          rows={2}
          containerClassName="sm:col-span-2"
          error={errors.description}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <label className="flex items-center gap-2 text-body text-ink-2 sm:col-span-2">
          <input
            type="checkbox"
            className="size-4 accent-blue"
            checked={isBillable}
            onChange={(event) => setIsBillable(event.target.checked)}
          />
          Billable to the client
        </label>

        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sub font-heavy text-ink-2">
            Receipt{category?.requiresReceipt && <span className="ml-0.5 text-red">*</span>}
          </p>
          {receipt ? (
            <div className="flex items-center gap-3 rounded-control border border-line bg-surface-2 px-3 py-2.5">
              <FileText aria-hidden className="size-4 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body text-ink">{receipt.fileName}</p>
                <p className="text-micro text-muted">{formatFileSize(receipt.sizeBytes)}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<Trash2 />}
                onClick={() => setReceipt(null)}
              >
                Remove
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Camera />}
                loading={upload.isPending}
                onClick={() => cameraRef.current?.click()}
              >
                Take a photo
              </Button>
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<Paperclip />}
                loading={upload.isPending}
                onClick={() => fileRef.current?.click()}
              >
                Choose a file
              </Button>
              <p className="self-center text-micro text-muted">Photo or PDF, up to 10 MB</p>
            </div>
          )}
          {/* `capture` opens the camera on a phone and is ignored on a desktop. */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            aria-label="Take a receipt photo"
            onChange={(event) => {
              void pick(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose a receipt file"
            onChange={(event) => {
              void pick(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          {errors.receiptDocumentId && (
            <p className="mt-1.5 text-sub text-red">{errors.receiptDocumentId}</p>
          )}
        </div>
      </div>

      {(overClaim || warnings.length > 0) && (
        <p className="mt-3 rounded-control border border-amber/40 bg-pill-amber-bg px-3 py-2 text-sub text-pill-amber-fg">
          {overClaim ?? warnings.join(' ')}
        </p>
      )}
    </Dialog>
  );
}

interface ExpenseFormValues {
  categoryId: string;
  projectId: string | null;
  expenseDate: string;
  amount: string;
  isBillable: boolean;
  description: string | null;
  receiptDocumentId: string | null;
}
