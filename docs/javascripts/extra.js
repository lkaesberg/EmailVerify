/* EmailVerify — site behaviour.
 *
 * Loaded once per full page load. With `navigation.instant` the <body> is
 * swapped without re-running this file, so everything here is bound to
 * `document` (delegation) or to `document.body` (observer) rather than to
 * elements that get replaced.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
   * Click-to-load YouTube facade.
   *
   * Nothing is requested from Google until the visitor clicks: the poster
   * frame is served from this site and the iframe is created on demand,
   * against youtube-nocookie.com. Keeps the embed off the cookie-consent
   * critical path and off the initial page weight.
   * ------------------------------------------------------------------ */
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-ev-video]');
    if (!button) return;

    var id = button.getAttribute('data-ev-video');
    if (!id || !/^[\w-]{6,20}$/.test(id)) return;

    var container = button.closest('.ev-video');
    if (!container) return;

    var frame = document.createElement('iframe');
    frame.src = 'https://www.youtube-nocookie.com/embed/' + id +
      '?autoplay=1&rel=0&modestbranding=1';
    frame.title = button.getAttribute('data-ev-title') || 'Video';
    frame.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allowFullscreen = true;

    container.innerHTML = '';
    container.appendChild(frame);
  });

  /* ------------------------------------------------------------------
   * Re-broadcast palette changes.
   *
   * Material rewrites `data-md-color-scheme` on <body> when the header
   * toggle is used. Canvas-based widgets (the Chart.js graphs on the
   * statistics page) read their colours from CSS variables at construction
   * time and cannot repaint themselves, so give them a hook.
   * ------------------------------------------------------------------ */
  var lastScheme = document.body.getAttribute('data-md-color-scheme');

  new MutationObserver(function () {
    var scheme = document.body.getAttribute('data-md-color-scheme');
    if (scheme === lastScheme) return;
    lastScheme = scheme;
    document.dispatchEvent(new CustomEvent('ev:scheme-change', { detail: { scheme: scheme } }));
  }).observe(document.body, { attributes: true, attributeFilter: ['data-md-color-scheme'] });
})();
