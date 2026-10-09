import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Camera, CameraOff, LocateFixed, MapPin, RefreshCw } from 'lucide-react';
import { distanceMetres } from '@opsvera/shared';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { ApiRequestError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { timeIn, usePunchMobile, type MyToday } from './useAttendance';

type Location =
  | { state: 'locating' }
  | { state: 'ok'; latitude: number; longitude: number; accuracyM: number }
  | { state: 'error'; message: string };

type Camera = { state: 'starting' } | { state: 'live' } | { state: 'unavailable'; message: string };

function geolocationMessage(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) {
    return 'Location is blocked for this site. Allow it in your browser settings, then try again.';
  }
  if (error.code === error.TIMEOUT) {
    return 'Could not get a location fix in time. Move near a window or try again.';
  }
  return 'Your device could not work out where it is. Check that location is switched on.';
}

/** Shrinks a camera frame to something a punch can upload quickly. */
async function frameToJpeg(video: HTMLVideoElement): Promise<Blob> {
  const maxWidth = 960;
  const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((video.videoWidth || maxWidth) * scale);
  canvas.height = Math.round((video.videoHeight || maxWidth * 0.75) * scale);
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No image'))),
      'image/jpeg',
      0.85,
    ),
  );
}

/**
 * Clock in or out from a phone: where you are, and a selfie.
 *
 * The distance shown here is a courtesy computed in the browser so people know
 * before they tap; the server measures it again from the same coordinates and
 * is the one that decides.
 */
export function PunchDialog({ today, onClose }: { today: MyToday; onClose: () => void }) {
  const punch = usePunchMobile();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [location, setLocation] = useState<Location>({ state: 'locating' });
  const [camera, setCamera] = useState<Camera>({ state: 'starting' });
  const [selfie, setSelfie] = useState<{ blob: Blob; url: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const acting = today.nextAction === 'IN' ? 'Clock in' : 'Clock out';

  const locate = useCallback(() => {
    setLocation({ state: 'locating' });
    if (!('geolocation' in navigator)) {
      setLocation({ state: 'error', message: 'This browser cannot share a location.' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        setLocation({
          state: 'ok',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: Math.round(position.coords.accuracy),
        }),
      (error) => setLocation({ state: 'error', message: geolocationMessage(error) }),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }, []);

  const startCamera = useCallback(async () => {
    setCamera({ state: 'starting' });
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera({
        state: 'unavailable',
        message: 'This browser cannot open the camera here. You can take a photo instead.',
      });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setCamera({ state: 'live' });
    } catch {
      setCamera({
        state: 'unavailable',
        message:
          'The camera is blocked or in use. Allow it in your browser settings, or take a photo instead.',
      });
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    locate();
    void startCamera();
    return stopCamera;
  }, [locate, startCamera, stopCamera]);

  // Free the preview image when it is replaced or the dialog goes away.
  useEffect(
    () => () => {
      if (selfie) URL.revokeObjectURL(selfie.url);
    },
    [selfie],
  );

  // The <video> only exists while there is no photo, so the stream is attached
  // whenever both are there — including after a retake.
  useEffect(() => {
    if (camera.state === 'live' && !selfie && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(() => undefined);
    }
  }, [camera.state, selfie]);

  async function capture() {
    if (!videoRef.current) return;
    try {
      const blob = await frameToJpeg(videoRef.current);
      setSelfie({ blob, url: URL.createObjectURL(blob) });
      stopCamera();
    } catch {
      setProblem('Could not take the photo. Try again.');
    }
  }

  function retake() {
    setSelfie(null);
    setProblem(null);
    void startCamera();
  }

  function pickFile(file: File | undefined) {
    if (!file) return;
    setSelfie({ blob: file, url: URL.createObjectURL(file) });
  }

  const { office } = today;
  const distance =
    location.state === 'ok' && office.latitude !== null && office.longitude !== null
      ? distanceMetres(
          { lat: office.latitude, lng: office.longitude },
          { lat: location.latitude, lng: location.longitude },
        )
      : null;
  const outside = distance !== null && distance > office.geofenceRadiusM;
  const refused = outside && office.geofenceMode === 'REJECT';

  async function submit() {
    if (location.state !== 'ok' || !selfie) return;
    setProblem(null);
    try {
      const result = await punch.mutateAsync({
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyM: location.accuracyM,
        selfie: selfie.blob,
      });
      const at = timeIn(result.punch.punchedAt, office.timezone);
      toast.success(
        result.punch.type === 'IN' ? `Clocked in at ${at}` : `Clocked out at ${at}`,
        result.punch.isFlagged
          ? { description: 'It was recorded outside the site radius and flagged for review.' }
          : undefined,
      );
      onClose();
    } catch (error) {
      setProblem(
        error instanceof ApiRequestError ? error.message : 'Could not record the punch. Try again.',
      );
    }
  }

  const ready = location.state === 'ok' && Boolean(selfie) && !refused;

  return (
    <Dialog
      open
      onClose={punch.isPending ? () => undefined : onClose}
      title={`${acting} from your phone`}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={punch.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={punch.isPending} disabled={!ready} onClick={submit}>
            {acting}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Where you are */}
        <div
          className={cn(
            'flex items-start gap-3 rounded-card border p-3',
            location.state === 'error' || refused
              ? 'border-pill-red-bg bg-pill-red-bg/50'
              : outside
                ? 'border-pill-amber-bg bg-pill-amber-bg/50'
                : 'border-line bg-surface-2',
          )}
        >
          <span aria-hidden className="mt-0.5 text-muted [&>svg]:size-5">
            {location.state === 'ok' ? <MapPin /> : <LocateFixed />}
          </span>
          <div className="min-w-0 flex-1 text-sub">
            {location.state === 'locating' && (
              <p className="font-heavy text-ink">Finding your location…</p>
            )}
            {location.state === 'error' && (
              <>
                <p className="font-heavy text-pill-red-fg">{location.message}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2"
                  leadingIcon={<RefreshCw />}
                  onClick={locate}
                >
                  Try again
                </Button>
              </>
            )}
            {location.state === 'ok' && (
              <>
                <p className="font-heavy text-ink">
                  {distance === null
                    ? 'Location found'
                    : outside
                      ? `${distance.toLocaleString('en-IN')} m from ${office.name}`
                      : `At ${office.name} (${distance} m from the pin)`}
                </p>
                <p className="text-muted">
                  {distance === null
                    ? 'This site has no map pin, so the distance cannot be checked.'
                    : refused
                      ? `Punching is only allowed within ${office.geofenceRadiusM} m of the site, so this will be refused.`
                      : outside
                        ? `The limit is ${office.geofenceRadiusM} m. It will be recorded, but flagged for your manager to review.`
                        : `Within the ${office.geofenceRadiusM} m radius.`}
                  {location.accuracyM > 100 &&
                    ` Location accuracy is only ±${location.accuracyM} m.`}
                </p>
              </>
            )}
          </div>
        </div>

        {/* A selfie */}
        <div>
          <p className="mb-1.5 text-sub font-heavy text-ink-2">Selfie</p>

          {selfie ? (
            <div className="space-y-2">
              <img
                src={selfie.url}
                alt="Your selfie"
                className="mx-auto max-h-64 rounded-card border border-line object-cover"
              />
              <Button size="sm" variant="ghost" leadingIcon={<RefreshCw />} onClick={retake}>
                Retake
              </Button>
            </div>
          ) : camera.state === 'unavailable' ? (
            <div className="rounded-card border border-line bg-surface-2 p-3 text-sub">
              <p className="flex items-start gap-2 text-ink-2">
                <CameraOff aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
                {camera.message}
              </p>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="user"
                className="sr-only"
                tabIndex={-1}
                aria-label="Take a selfie"
                onChange={(event) => pickFile(event.target.files?.[0])}
              />
              <Button
                className="mt-2"
                size="sm"
                variant="primary"
                leadingIcon={<Camera />}
                onClick={() => fileRef.current?.click()}
              >
                Take a photo
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative overflow-hidden rounded-card bg-ink">
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  autoPlay
                  // Mirrored, like a mirror — what people expect from a selfie preview.
                  className="mx-auto max-h-64 w-full -scale-x-100 object-cover"
                />
                {camera.state === 'starting' && (
                  <p className="absolute inset-0 grid place-items-center text-sub text-white">
                    Starting the camera…
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="primary"
                leadingIcon={<Camera />}
                disabled={camera.state !== 'live'}
                onClick={capture}
              >
                Take selfie
              </Button>
            </div>
          )}
        </div>

        {problem && (
          <p
            role="alert"
            className="rounded-card bg-pill-red-bg/60 p-3 text-sub font-heavy text-pill-red-fg"
          >
            {problem}
          </p>
        )}
      </div>
    </Dialog>
  );
}
