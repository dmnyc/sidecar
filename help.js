// Sidecar — Help & guides page.
// Highlights the current section in the sticky nav as the reader scrolls.

(() => {
  'use strict';

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
