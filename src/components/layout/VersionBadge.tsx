// Small build-version marker pinned to the bottom-right corner so it's easy to tell
// at a glance whether a new version has shipped. The number (git commit count) bumps
// on every deploy. Non-interactive and unobtrusive — never blocks clicks.
export function VersionBadge() {
  return (
    <div
      className="fixed bottom-2 right-2 z-50 pointer-events-none select-none
                 rounded-full bg-gray-800/70 text-white text-[10px] leading-none
                 px-2 py-1 font-mono tracking-tight shadow-sm"
      title={`Build ${__GIT_SHA__} · ${__BUILD_DATE__}`}
    >
      v{__APP_VERSION__}
      <span className="text-gray-300"> · {__BUILD_DATE__}</span>
    </div>
  );
}
