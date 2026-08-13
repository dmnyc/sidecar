// Sidecar — Help & guides page.
// TOC dropdown: open/close, highlight current section on scroll, update label.

(() => {
  'use strict';

  // Pin the "full history" link to this exact build's tag, not main — main can
  // legitimately be ahead of what's installed (PRs merge well before a release
  // is tagged/shipped), and a hotfix branched from an older tag must link to its
  // own snapshot, not whatever's newest on main. Falls back to the static main
  // link in the markup if the build stamp is ever missing.
  const changelogLink = document.getElementById('changelog-link');
  const build = window.SIDECAR_BUILD;
  if (changelogLink && build && build.version) {
    changelogLink.href = 'https://github.com/dmnyc/sidecar/blob/v' + build.version + '/CHANGELOG.md';
  }

  const toggle = document.getElementById('toc-toggle');
  const menu = document.getElementById('toc-menu');
  const label = document.getElementById('toc-label');
  if (!toggle || !menu) return;

  const links = Array.from(menu.querySelectorAll('a'));
  const sections = links
    .map((a) => document.getElementById(a.getAttribute('href').slice(1)))
    .filter(Boolean);

  // Open/close the dropdown.
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.hasAttribute('hidden') === false;
    if (open) close();
    else open_();
  });

  function open_() {
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
  }
  function close() {
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  }

  // Close on outside click.
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !toggle.contains(e.target)) close();
  });

  // Close on escape.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  // Close after navigating.
  links.forEach((a) => a.addEventListener('click', () => close()));

  // Highlight the current section and update the dropdown label.
  function setActive(id) {
    links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + id));
    const active = links.find((a) => a.getAttribute('href') === '#' + id);
    if (label && active) label.textContent = active.textContent;
  }

  const visible = new Set();
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) visible.add(e.target.id);
        else visible.delete(e.target.id);
      });
      const current = sections.find((s) => visible.has(s.id));
      if (current) setActive(current.id);
    },
    { rootMargin: '-80px 0px -55% 0px' }
  );
  sections.forEach((s) => observer.observe(s));
})();
