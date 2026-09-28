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

  /* ------------------------------------------------------------------
   * Website analytics (PostHog, cookieless) — only with consent.
   *
   * Answers one question: which pages and which referrers lead to someone
   * clicking "Add to Discord". Nothing is loaded until the visitor clicks
   * "Allow" in the consent banner; "Decline" (or withdrawing later via the
   * "Privacy settings" link in the footer) keeps PostHog off entirely.
   *
   * Even with consent, `persistence: 'memory'` keeps every identifier in the
   * page's memory, so nothing is written to cookies or storage; a full reload
   * is a new, anonymous visitor. The only thing stored on the device is the
   * choice itself, which is strictly necessary to honour it. Instant
   * navigation keeps the page alive, so the landing page and its UTM tags stay
   * attached to clicks later in the same visit.
   *
   * Configured in mkdocs.yml; the privacy policy (legal/datenschutz, section
   * 4.1) describes exactly this — keep them in step.
   * ------------------------------------------------------------------ */
  var analytics = null;
  try {
    var configNode = document.getElementById('ev-analytics');
    if (configNode) analytics = JSON.parse(configNode.textContent);
  } catch (e) {
    analytics = null;
  }
  var analyticsAvailable = !!(analytics && analytics.key && analytics.host);

  // Bump the version to ask everyone again after a material change to what is
  // collected (and update the privacy policy with it).
  var CONSENT_KEY = 'ev-analytics-consent';
  var CONSENT_VERSION = 1;

  function readConsent() {
    try {
      var stored = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
      return stored && stored.v === CONSENT_VERSION ? stored.choice : null;
    } catch (e) {
      return null;
    }
  }

  function saveConsent(choice) {
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: CONSENT_VERSION, choice: choice, at: new Date().toISOString() }));
    } catch (e) {
      // Storage blocked (private mode, strict settings): the choice holds for
      // this page only, and the banner asks again next time. Never assume yes.
    }
  }

  function doNotTrack() {
    return navigator.doNotTrack === '1' || window.doNotTrack === '1';
  }

  var analyticsStarted = false;

  function startAnalytics() {
    if (analyticsStarted || !analyticsAvailable) return;
    analyticsStarted = true;

    var script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.src = analytics.host.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/array.js';
    script.onload = function () {
      var lib = window.posthog;
      if (!lib || typeof lib.init !== 'function') return;
      lib.init(analytics.key, {
        api_host: analytics.host,
        persistence: 'memory',
        person_profiles: 'identified_only',
        capture_pageview: 'history_change',
        capture_pageleave: false,
        autocapture: false,
        disable_session_recording: true,
        disable_surveys: true,
        advanced_disable_flags: true,
        respect_dnt: true,
        mask_personal_data_properties: true
      });
      var params = new URLSearchParams(location.search);
      lib.register({
        landing_page: location.pathname,
        landing_referrer: document.referrer || null,
        landing_utm_source: params.get('utm_source'),
        landing_utm_medium: params.get('utm_medium'),
        landing_utm_campaign: params.get('utm_campaign')
      });
    };
    document.head.appendChild(script);
  }

  // Withdrawing while PostHog runs reloads the page rather than calling its
  // opt-out: that would write PostHog's own entry to storage, and a page
  // loaded with "denied" stored never loads PostHog in the first place.
  function stopAnalytics() {
    if (analyticsStarted) location.reload();
  }

  function track(event, properties) {
    var ph = window.posthog;
    if (!ph || !ph.__loaded || readConsent() !== 'granted') return;
    // The click usually navigates away at once; a beacon survives the unload.
    ph.capture(event, properties, { transport: 'sendBeacon' });
  }

  /* Consent banner. Non-modal, both choices equally prominent, nothing
   * pre-selected. English, like the rest of the site. */
  var CONSENT_TEXT = {
    title: 'Help us improve EmailVerify',
    body: 'With your consent we measure which pages and links lead people to add EmailVerify, using PostHog (EU cloud). No cookies, no profiles, nothing stored on your device for analytics. You can withdraw any time via “Privacy settings” at the bottom of each page.',
    policy: 'Privacy policy',
    allow: 'Allow analytics',
    deny: 'Decline'
  };

  function showConsentBanner() {
    if (!analyticsAvailable || document.getElementById('ev-consent')) return;

    var banner = document.createElement('div');
    banner.id = 'ev-consent';
    banner.className = 'ev-consent';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-labelledby', 'ev-consent-title');

    var title = document.createElement('p');
    title.id = 'ev-consent-title';
    title.className = 'ev-consent__title';
    title.textContent = CONSENT_TEXT.title;

    var body = document.createElement('p');
    body.className = 'ev-consent__body';
    body.textContent = CONSENT_TEXT.body + ' ';
    if (analytics.privacy) {
      var policy = document.createElement('a');
      policy.href = analytics.privacy;
      policy.textContent = CONSENT_TEXT.policy;
      body.appendChild(policy);
    }

    var actions = document.createElement('div');
    actions.className = 'ev-consent__actions';
    [['granted', CONSENT_TEXT.allow], ['denied', CONSENT_TEXT.deny]].forEach(function (option) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'ev-consent__button';
      button.setAttribute('data-ev-consent', option[0]);
      button.textContent = option[1];
      actions.appendChild(button);
    });

    banner.appendChild(title);
    banner.appendChild(body);
    banner.appendChild(actions);
    document.body.appendChild(banner);
    return banner;
  }

  document.addEventListener('click', function (event) {
    var choice = event.target.closest && event.target.closest('[data-ev-consent]');
    if (choice) {
      var value = choice.getAttribute('data-ev-consent') === 'granted' ? 'granted' : 'denied';
      saveConsent(value);
      var banner = document.getElementById('ev-consent');
      if (banner) banner.remove();
      if (value === 'granted') startAnalytics(); else stopAnalytics();
      return;
    }

    var reopen = event.target.closest && event.target.closest('[data-ev-consent-open]');
    if (reopen) {
      event.preventDefault();
      var shown = showConsentBanner();
      var first = shown && shown.querySelector('button');
      if (first) first.focus();
    }
  });

  function applyConsent() {
    if (!analyticsAvailable || doNotTrack()) return;
    var choice = readConsent();
    if (choice === 'granted') startAnalytics();
    else if (choice === null) showConsentBanner();
  }

  applyConsent();
  // Instant navigation can replace the page body; keep asking while undecided.
  if (window.document$ && typeof window.document$.subscribe === 'function') {
    window.document$.subscribe(applyConsent);
  }

  document.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a[href]');
    if (!link) return;
    var href = link.href;
    var kind = /discord\.com\/(api\/)?oauth2\/authorize/.test(href) ? 'invite_clicked'
      : /discord\.com\/application-directory\/[^/]+\/store/.test(href) ? 'store_clicked'
      : /discord\.(gg|com\/invite)\//.test(href) ? 'support_clicked'
      : null;
    if (!kind) return;
    track(kind, {
      page: location.pathname,
      link_text: (link.textContent || '').trim().slice(0, 80) || null
    });
  });
})();
