// Review-only locale fixture. Wait for startup before overriding its language;
// apply the same static-label pass that the real panel performs on startup.
SidecarI18n.ready = SidecarI18n.ready.then(async () => {
  const query = new URLSearchParams(location.search);
  const requested = query.has('pseudo') ? 'en-XA' : query.get('lang');
  if (requested) {
    const code = SidecarI18n.resolve(requested);
    const dict = code !== 'en' && code !== 'en-XA'
      ? await fetch('/locales/' + code + '.json').then(response => response.json()) : null;
    SidecarI18n.setLocale(code, [dict]);
  }
  SidecarI18n.applyDom();
});
