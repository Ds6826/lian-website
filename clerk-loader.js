(() => {
  const config = window.__lian_config || {};
  const setStatus = (state, detail = '') => {
    window.__liansClerkStatus = { state, detail };
    window.dispatchEvent(new CustomEvent(`lians:clerk-${state}`, { detail }));
  };
  if (!config.clerkPublishableKey || !config.clerkJsUrl) {
    setStatus('error', 'Clerk is not configured. Add CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY to .env, then restart the server.');
    return;
  }

  setStatus('loading');
  let loadTimeout;
  const loadClerkUi = () => new Promise((resolve, reject) => {
    if (window.__internal_ClerkUICtor) return resolve();
    if (!config.clerkUiUrl) return reject(new Error('Clerk UI is not configured.'));
    const uiScript = document.createElement('script');
    uiScript.async = true;
    uiScript.crossOrigin = 'anonymous';
    uiScript.integrity = config.clerkUiIntegrity;
    uiScript.src = config.clerkUiUrl;
    uiScript.onload = resolve;
    uiScript.onerror = () => reject(new Error('Unable to load the secure sign-in interface.'));
    document.head.append(uiScript);
  });

  const fail = () => {
    window.clearTimeout(loadTimeout);
    setStatus('error', 'Unable to load secure sign-in. Check your Clerk publishable key, allowed domains, and network connection.');
  };
  const loadScript = () => {
    if (!config.clerkJsUrl || !config.clerkJsIntegrity) return fail();
    window.clearTimeout(loadTimeout);
    // Failover timer covers only the script DOWNLOAD. It must be cleared the moment
    // onload fires - otherwise it can fire during the (network-bound) Clerk.load()
    // call below, rip out clerk-js v5 (which has the billing API) and fall back to
    // the v4 CDN, leaving window.Clerk half-initialized and billing checkout broken.
    loadTimeout = window.setTimeout(() => {
      script.remove();
      fail();
    }, 6000);

    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.integrity = config.clerkJsIntegrity;
    script.dataset.clerkJsScript = 'true';
    script.dataset.clerkPublishableKey = config.clerkPublishableKey;
    script.src = clerkScriptUrls[index];
    script.onload = async () => {
      window.clearTimeout(loadTimeout);
      try {
        await loadClerkUi();
        await window.Clerk.load({
          publishableKey: config.clerkPublishableKey,
          ui: { ClerkUI: window.__internal_ClerkUICtor },
        });
        setStatus('ready');
      } catch (error) {
        window.clearTimeout(loadTimeout);
        const clerkError = error?.errors?.[0]?.longMessage || error?.errors?.[0]?.message || error?.message;
        const message = /Origin header must be equal to or a subdomain/i.test(clerkError || '')
          ? 'This Clerk key is configured for the production domain. For local testing, use Clerk development keys or configure localhost in Clerk.'
          : clerkError;
        setStatus('error', message || 'Unable to start secure sign-in. Check that Google/GitHub are enabled in Clerk and this domain is allowed.');
      }
    };
    script.onerror = () => {
      window.clearTimeout(loadTimeout);
      script.remove();
      fail();
    };
    document.head.append(script);
  };
  loadScript();
})();
