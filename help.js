// Sidecar — Help & guides page.
// Highlights the current section in the sticky nav as the reader scrolls.

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

  const links = Array.from(document.querySelectorAll('#helpnav-links a'));
  if (!links.length) return;

  const sections = links
    .map((a) => document.getElementById(a.getAttribute('href').slice(1)))
    .filter(Boolean);

  function setActive(id) {
    links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + id));
  }

  // Track which sections are in view; the topmost visible one wins.
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
