import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate } from 'react-router-dom';
import { loginSchema, type LoginInput } from '@opsvera/shared';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import { ApiRequestError } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';

export function LoginPage() {
  const { user, loading, signIn } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberMe: false },
  });

  if (loading) return <SplashScreen />;
  if (user) return <Navigate to="/" replace />;

  async function onSubmit(values: LoginInput) {
    setFormError(null);
    try {
      await signIn(values);
    } catch (error) {
      setFormError(
        error instanceof ApiRequestError
          ? error.message
          : 'Could not reach the server. Check your connection and try again.',
      );
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* The brand panel is decoration; it is hidden rather than read aloud. */}
      <aside
        aria-hidden
        className="relative hidden flex-col justify-between bg-nav-gradient p-10 text-white lg:flex"
      >
        <div className="flex items-center gap-3">
          <span className="relative grid size-9 place-items-center rounded-[11px] bg-brand-gradient shadow-brand">
            <span className="absolute left-[9px] top-[9px] h-1.5 w-[17px] rounded-[5px] bg-white" />
            <span className="absolute left-[14px] top-[13px] h-4 w-1.5 rounded-[5px] bg-white" />
          </span>
          <div>
            <b className="block text-[17px] font-black tracking-[0.04em]">OPSVERA</b>
            <small className="mt-0.5 block text-[10px] font-heavy tracking-[0.12em] text-[#8496b5]">
              BUSINESS OPERATIONS OS
            </small>
          </div>
        </div>

        <div className="max-w-md">
          <p className="text-display font-black leading-tight">
            From booking to live cost, in one connected system.
          </p>
          <p className="mt-4 text-body leading-relaxed text-nav-text">
            Book a project, confirm it with the client, generate its code, plan the work, track
            attendance and time, approve it, and watch cost and margin move — without a spreadsheet
            in between.
          </p>
        </div>

        <ol className="grid gap-2 text-sub text-nav-text">
          {['Booking', 'Confirmation', 'Project Code', 'Project Created', 'Scheduled'].map(
            (stage, index) => (
              <li key={stage} className="flex items-center gap-2.5">
                <span className="grid size-5 place-items-center rounded-md bg-white/10 text-[10px] font-black">
                  {String(index + 1).padStart(2, '0')}
                </span>
                {stage}
              </li>
            ),
          )}
        </ol>
      </aside>

      <main className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <h1 className="text-display font-black text-ink">Sign in</h1>
          <p className="mt-1.5 text-body text-muted">
            Use the work email your administrator invited.
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
            {formError && (
              <div
                role="alert"
                className="rounded-card border border-[#ffd7d8] bg-[#fff4f4] px-3 py-2.5 text-sub text-pill-red-fg"
              >
                {formError}
              </div>
            )}

            <TextField
              label="Work email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@company.com"
              error={errors.email?.message}
              {...register('email')}
            />

            <TextField
              label="Password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••••"
              error={errors.password?.message}
              {...register('password')}
            />

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sub text-muted">
                <input
                  type="checkbox"
                  className="size-4 rounded border-line text-blue focus-visible:ring-2 focus-visible:ring-blue"
                  {...register('rememberMe')}
                />
                Keep me signed in
              </label>
              <a href="/forgot-password" className="text-sub font-heavy text-blue hover:underline">
                Forgot password?
              </a>
            </div>

            <Button type="submit" variant="primary" size="lg" fullWidth loading={isSubmitting}>
              Sign in
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}

/** Shown while the silent refresh decides whether there is a session. */
export function SplashScreen() {
  return (
    <div className="grid min-h-screen place-items-center bg-bg">
      <div className="text-center">
        <span className="relative mx-auto grid size-11 animate-pulse place-items-center rounded-[13px] bg-brand-gradient shadow-brand">
          <span className="absolute left-[11px] top-[11px] h-2 w-5 rounded-[6px] bg-white" />
          <span className="absolute left-[17px] top-[16px] h-5 w-2 rounded-[6px] bg-white" />
        </span>
        <p className="mt-4 text-sub text-muted" role="status">
          Loading OPSVERA…
        </p>
      </div>
    </div>
  );
}
