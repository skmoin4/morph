import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Mail, Pencil, Phone, Plus, Trash2 } from 'lucide-react';
import { Drawer } from '../../components/ui/Drawer';
import { Button, IconButton } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/Dialog';
import { ListItem } from '../../components/ui/Panel';
import { Pill, StatusPill } from '../../components/ui/Pill';
import { Skeleton } from '../../components/ui/Skeleton';
import { TextField } from '../../components/ui/Field';
import { ApiRequestError } from '../../lib/api';
import { formatCurrencyShort, formatDisplayDate } from '../../lib/format';
import { useAuth } from '../../providers/AuthProvider';
import { ClientFormDrawer } from './ClientFormDrawer';
import { useAddContact, useClient, useRemoveContact, type ClientContact } from './useClients';

/** Right-side client detail: who they are, who to call, and their bookings. */
export function ClientDrawer({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canEdit = can('client.edit');
  const { data: client, isLoading } = useClient(clientId);

  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ClientContact | null>(null);
  const removeContact = useRemoveContact();

  async function confirmRemove() {
    if (!removing) return;
    try {
      await removeContact.mutateAsync(removing.id);
      toast.success(`${removing.name} removed`);
      setRemoving(null);
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not remove contact.');
    }
  }

  const location = client
    ? [client.city, client.state, client.country].filter(Boolean).join(', ')
    : '';

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={client?.name ?? 'Client'}
        subtitle={
          client ? [client.clientCode, client.industry].filter(Boolean).join(' · ') : undefined
        }
        footer={
          canEdit && client ? (
            <Button leadingIcon={<Pencil />} onClick={() => setEditing(true)}>
              Edit client
            </Button>
          ) : undefined
        }
      >
        {isLoading || !client ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={client.isActive ? 'green' : 'gray'} dot>
                {client.isActive ? 'Active' : 'Inactive'}
              </Pill>
              <Pill tone="blue">{client._count.bookings} bookings</Pill>
              <Pill tone="violet">{client._count.projects} projects</Pill>
            </div>

            <dl className="grid gap-3 text-sub sm:grid-cols-2">
              {[
                ['Location', location],
                ['GSTIN', client.gstin],
                ['Website', client.website],
                ['Address', client.addressLine1],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-micro font-heavy uppercase text-muted">{label}</dt>
                  <dd className="mt-0.5 text-body text-ink">{value || '—'}</dd>
                </div>
              ))}
            </dl>
            {client.notes && (
              <p className="rounded-card bg-surface-2 p-3 text-sub text-ink-2">{client.notes}</p>
            )}

            <section>
              <div className="mb-2.5 flex items-center justify-between">
                <h3 className="text-title font-heavy text-ink">Contacts</h3>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon={<Plus />}
                    onClick={() => setAdding(true)}
                  >
                    Add contact
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {client.contacts.length === 0 && !adding && (
                  <p className="text-sub text-muted">No contacts yet.</p>
                )}
                {client.contacts.map((contact) => (
                  <ListItem key={contact.id}>
                    <div className="min-w-0">
                      <p className="truncate text-body font-heavy text-ink">
                        {contact.name}
                        {contact.isPrimary && (
                          <Pill tone="blue" className="ml-2 align-middle">
                            Primary
                          </Pill>
                        )}
                      </p>
                      <p className="truncate text-sub text-muted">{contact.designation ?? '—'}</p>
                      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sub text-ink-2">
                        {contact.email && (
                          <span className="inline-flex items-center gap-1">
                            <Mail aria-hidden className="size-3.5" /> {contact.email}
                          </span>
                        )}
                        {contact.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone aria-hidden className="size-3.5" /> {contact.phone}
                          </span>
                        )}
                      </p>
                    </div>
                    {canEdit && (
                      <IconButton
                        label={`Remove ${contact.name}`}
                        size="sm"
                        onClick={() => setRemoving(contact)}
                      >
                        <Trash2 />
                      </IconButton>
                    )}
                  </ListItem>
                ))}
                {adding && <AddContactForm clientId={client.id} onDone={() => setAdding(false)} />}
              </div>
            </section>

            <section>
              <h3 className="mb-2.5 text-title font-heavy text-ink">Recent bookings</h3>
              {client.bookings.length === 0 ? (
                <p className="text-sub text-muted">No bookings for this client yet.</p>
              ) : (
                <div className="space-y-2">
                  {client.bookings.map((booking) => (
                    <ListItem key={booking.id}>
                      <div className="min-w-0">
                        <p className="truncate text-body font-heavy text-ink">
                          {booking.bookingNumber} · {booking.projectName}
                        </p>
                        <p className="truncate text-sub text-muted">
                          {formatDisplayDate(booking.bookingDate)} · {booking.projectType.shortCode}
                          {booking.project ? ` · ${booking.project.projectCode}` : ''}
                          {booking.projectValue
                            ? ` · ${formatCurrencyShort(booking.projectValue)}`
                            : ''}
                        </p>
                      </div>
                      <StatusPill status={booking.status} />
                    </ListItem>
                  ))}
                  {can('booking.view') && (
                    <Button
                      size="sm"
                      variant="subtle"
                      onClick={() => navigate(`/bookings?clientId=${client.id}`)}
                    >
                      Open in the booking register
                    </Button>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </Drawer>

      {editing && client && <ClientFormDrawer client={client} onClose={() => setEditing(false)} />}

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={confirmRemove}
        loading={removeContact.isPending}
        destructive
        title="Remove this contact?"
        description={removing ? `${removing.name} will no longer appear on this client.` : ''}
        confirmLabel="Remove"
      />
    </>
  );
}

function AddContactForm({ clientId, onDone }: { clientId: string; onDone: () => void }) {
  const add = useAddContact();
  const [values, setValues] = useState({ name: '', designation: '', email: '', phone: '' });
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (values.name.trim().length < 2) {
      setError('Enter the contact’s name.');
      return;
    }
    try {
      await add.mutateAsync({
        id: clientId,
        input: {
          name: values.name,
          designation: values.designation || null,
          email: values.email || null,
          phone: values.phone || null,
          isPrimary: false,
        },
      });
      toast.success('Contact added');
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not add the contact.');
    }
  }

  const set = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [key]: event.target.value }));

  return (
    <div className="grid gap-3 rounded-card border border-line bg-surface-2 p-3 sm:grid-cols-2">
      <TextField
        label="Name"
        required
        value={values.name}
        onChange={set('name')}
        error={error ?? undefined}
      />
      <TextField label="Designation" value={values.designation} onChange={set('designation')} />
      <TextField label="Email" type="email" value={values.email} onChange={set('email')} />
      <TextField label="Phone" value={values.phone} onChange={set('phone')} />
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" loading={add.isPending} onClick={save}>
          Add contact
        </Button>
      </div>
    </div>
  );
}
