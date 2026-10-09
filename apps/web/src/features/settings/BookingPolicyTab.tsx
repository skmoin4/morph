import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import type { BookingPolicyInput } from '@opsvera/shared';
import { Button } from '../../components/ui/Button';
import { Panel } from '../../components/ui/Panel';
import { SkeletonText } from '../../components/ui/Skeleton';
import { TextField } from '../../components/ui/Field';
import { api } from '../../lib/api';
import {
  settingsKeys,
  useBookingPolicy,
  useSettingsMutation,
  type BookingPolicy,
} from './useSettings';

/**
 * The booking rules the client has not settled. Everything here has a safe
 * default (nobody narrowed, no approval, a 7-day reminder), so the screen can
 * be changed live in a demo without anything breaking.
 */
export function BookingPolicyTab({ canEdit }: { canEdit: boolean }) {
  const { data, isLoading } = useBookingPolicy();

  const [createRoles, setCreateRoles] = useState<string[]>([]);
  const [confirmRoles, setConfirmRoles] = useState<string[]>([]);
  const [approval, setApproval] = useState(false);
  const [graceDays, setGraceDays] = useState('7');

  useEffect(() => {
    if (!data) return;
    setCreateRoles(data.bookingCreateRoleIds);
    setConfirmRoles(data.bookingConfirmRoleIds);
    setApproval(data.bookingRequiresApproval);
    setGraceDays(String(data.verbalEmailGraceDays));
  }, [data]);

  const days = Number(graceDays);
  const daysError =
    graceDays.trim() === '' || !Number.isInteger(days) || days < 0 || days > 365
      ? 'Enter a whole number from 0 to 365.'
      : undefined;

  const save = useSettingsMutation({
    mutationFn: (values: BookingPolicyInput) =>
      api.put<BookingPolicy>('/settings/booking-policy', values),
    invalidate: [settingsKeys.bookingPolicy, ['bookings']],
    successMessage: 'Booking policy saved',
  });

  if (isLoading || !data) {
    return (
      <Panel title="Booking policy">
        <SkeletonText lines={6} />
      </Panel>
    );
  }

  const dirty =
    JSON.stringify([...createRoles].sort()) !==
      JSON.stringify([...data.bookingCreateRoleIds].sort()) ||
    JSON.stringify([...confirmRoles].sort()) !==
      JSON.stringify([...data.bookingConfirmRoleIds].sort()) ||
    approval !== data.bookingRequiresApproval ||
    days !== data.verbalEmailGraceDays;

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (daysError) return;
        save.mutate({
          bookingCreateRoleIds: createRoles,
          bookingConfirmRoleIds: confirmRoles,
          bookingRequiresApproval: approval,
          verbalEmailGraceDays: days,
        });
      }}
    >
      <div className="flex items-start gap-2.5 rounded-card border border-line bg-surface p-3 text-sub text-ink-2">
        <Info aria-hidden className="mt-px size-4 shrink-0 text-blue" />
        <p>
          These rules can only <strong className="font-heavy">narrow</strong> what a role&apos;s
          permissions already allow — they never grant extra access. Leave a list empty to let the
          permission alone decide.
        </p>
      </div>

      <Panel
        title="Who can create a booking"
        subtitle="Applies on top of the booking.create permission."
      >
        <RoleChecklist
          roles={data.roles}
          selected={createRoles}
          onChange={setCreateRoles}
          disabled={!canEdit}
          emptyLabel="Any role with the booking.create permission"
        />
      </Panel>

      <Panel
        title="Who can confirm a booking"
        subtitle="Applies on top of the booking.confirm permission."
      >
        <RoleChecklist
          roles={data.roles}
          selected={confirmRoles}
          onChange={setConfirmRoles}
          disabled={!canEdit}
          emptyLabel="Any role with the booking.confirm permission"
        />
      </Panel>

      <Panel title="Approval and reminders">
        <fieldset disabled={!canEdit} className="space-y-4">
          <label className="flex items-start gap-2.5 text-body text-ink">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-blue"
              checked={approval}
              onChange={(event) => setApproval(event.target.checked)}
            />
            <span>
              <span className="font-heavy">A confirmed booking needs approval</span>
              <span className="block text-sub text-muted">
                It stops at “confirmed”. The project and its code are created only when someone with
                booking.approve accepts it.
              </span>
            </span>
          </label>

          <TextField
            label="Remind about a missing email after (days)"
            inputMode="numeric"
            containerClassName="max-w-xs"
            hint="For bookings confirmed verbally. A reminder only — it never blocks anything. 0 turns it off."
            error={daysError}
            value={graceDays}
            onChange={(event) => setGraceDays(event.target.value)}
          />
        </fieldset>
      </Panel>

      {canEdit && (
        <div className="flex justify-end">
          <Button
            type="submit"
            variant="primary"
            loading={save.isPending}
            disabled={!dirty || Boolean(daysError)}
          >
            Save booking policy
          </Button>
        </div>
      )}
    </form>
  );
}

function RoleChecklist({
  roles,
  selected,
  onChange,
  disabled,
  emptyLabel,
}: {
  roles: Array<{ id: string; name: string }>;
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
  emptyLabel: string;
}) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <fieldset disabled={disabled}>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {roles.map((role) => (
          <label
            key={role.id}
            className="flex items-center gap-2.5 rounded-card border border-line bg-surface-2 px-3 py-2 text-body text-ink"
          >
            <input
              type="checkbox"
              className="size-4 accent-blue"
              checked={selected.includes(role.id)}
              onChange={() => toggle(role.id)}
            />
            {role.name}
          </label>
        ))}
      </div>
      <p className="mt-2.5 text-sub text-muted">
        {selected.length === 0
          ? `Currently: ${emptyLabel}.`
          : `Only the ${selected.length} selected role${selected.length === 1 ? '' : 's'} can.`}
      </p>
    </fieldset>
  );
}
