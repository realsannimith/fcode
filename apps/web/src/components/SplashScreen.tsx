// FILE: SplashScreen.tsx
// Purpose: Render the branded startup face while the app is still booting a route or session.
// Layer: Shared app loading presentation
//
// Uses the same black-backdrop logo treatment as the HTML boot splash (public/splash.png)
// so the pre-React boot screen and this in-app loading screen are one continuous experience.

export function SplashScreen({
  errorMessage,
  onRetry,
}: {
  errorMessage?: string | null;
  onRetry?: (() => void) | null;
}) {
  const showRetry = Boolean(errorMessage && onRetry);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-black">
      <div className="flex flex-col items-center gap-5 select-none">
        <img
          src="/splash.png"
          alt="FCode"
          draggable={false}
          className="w-[min(56vmin,360px)] animate-pulse"
        />

        {errorMessage ? (
          <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
            <span className="text-sm text-white/70">{errorMessage}</span>
            {showRetry ? (
              <button
                type="button"
                className="rounded-md border border-white/20 px-3 py-1.5 text-sm text-white/85 transition-colors hover:bg-white/10"
                onClick={onRetry ?? undefined}
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
