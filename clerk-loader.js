(() => {
  const config = window.__lian_config || {};
  const setStatus = (state, detail = '') => {
    window.__lianClerkStatus = { state, detail };
    window.dispatchEvent(new CustomEvent(`lian:clerk-${state}`, { detail }));
  };
  if (!config.clerkPublishableKey || !config.clerkJsUrl) {
    setStatus('error', 'Clerk is not configured. Add CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY to .env, then restart the server.');
    return;
  }

  setStatus('loading');
  const clerkScriptUrls = [...new Set([config.clerkJsUrl, config.clerkJsFallbackUrl].filter(Boolean))];
  let loadTimeout;

  const fail = () => {
    window.clearTimeout(loadTimeout);
    setStatus('error', 'Unable to load secure sign-in. Check your Clerk publishable key, allowed domains, and network connection.');
  };
  const loadScript = (index = 0) => {
    if (!clerkScriptUrls[index]) return fail();
    window.clearTimeout(loadTimeout);
    loadTimeout = window.setTimeout(() => {
      script.remove();
      loadScript(index + 1);
    }, 8000);

    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.clerkJsScript = 'true';
    script.dataset.clerkPublishableKey = config.clerkPublishableKey;
    script.src = clerkScriptUrls[index];
    script.onload = async () => {
      try {
        await window.Clerk.load({ publishableKey: config.clerkPublishableKey });
        window.clearTimeout(loadTimeout);
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
      loadScript(index + 1);
    };
    document.head.append(script);
  };
  loadScript();
})();
