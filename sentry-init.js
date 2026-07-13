// Client-side error monitoring. Runs after the Sentry browser SDK (loaded from jsDelivr)
// and after config.js has set window.__lian_config. No-ops cleanly if either is missing,
// so monitoring can never break the app.
(function () {
  var dsn = (window.__lian_config || {}).sentryDsn;
  if (!dsn || !window.Sentry || typeof window.Sentry.init !== 'function') return;
  try {
    window.Sentry.init({
      dsn: dsn,
      environment: location.hostname === 'www.lians.ai' ? 'production' : 'development',
      // Errors only for now - no performance tracing or session replay.
      tracesSampleRate: 0,
      release: (window.__lian_config || {}).build || undefined,
    });
  } catch (e) {
    // Never let monitoring setup throw into the page.
  }
})();
