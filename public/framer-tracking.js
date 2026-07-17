/* Orion visitor tracking for Framer Custom Code. No PII is collected. */
(function () {
  'use strict';
  if (window.__ORION_ANALYTICS_INSTANCE__) return;
  window.__ORION_ANALYTICS_INSTANCE__ = true;
  var config = window.ORION_ANALYTICS_CONFIG || {};
  var apiBase = String(config.apiBase || '').replace(/\/$/, '');
  var requireConsent = config.requireConsent === true;
  var storageKey = 'orion_analytics';
  var sessionKey = 'orion_session';
  var firstTouchKey = 'orion_first_touch';
  var latestTouchKey = 'orion_latest_touch';
  var state;
  var disabled = false;

  function uuid(prefix) { try { return (prefix || 'evt') + '_' + crypto.randomUUID(); } catch (_) { return (prefix || 'evt') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2); } }
  function safeGet(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } }
  function safeSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} }
  function cookie(name) { var found = document.cookie.split('; ').find(function (row) { return row.indexOf(name + '=') === 0; }); return found ? decodeURIComponent(found.split('=').slice(1).join('=')) : ''; }
  function text(value, max) { return typeof value === 'string' ? value.replace(/[<>\u0000-\u001F\u007F]/g, '').trim().slice(0, max || 500) : null; }
  function hasConsent() { if (!requireConsent) return true; try { return safeGet('orion_consent') === true || window.localStorage.getItem('orion_consent') === 'accepted'; } catch (_) { return false; } }
  function touch() {
    var params = new URLSearchParams(location.search);
    var data = { utm_source: text(params.get('utm_source'), 120), utm_medium: text(params.get('utm_medium'), 120), utm_campaign: text(params.get('utm_campaign'), 180), utm_content: text(params.get('utm_content'), 180), utm_term: text(params.get('utm_term'), 180), fbclid: text(params.get('fbclid'), 250) };
    var hasTouch = Object.keys(data).some(function (key) { return Boolean(data[key]); });
    if (hasTouch) safeSet(latestTouchKey, data);
    if (!safeGet(firstTouchKey) && hasTouch) safeSet(firstTouchKey, data);
    return { first: safeGet(firstTouchKey) || {}, latest: safeGet(latestTouchKey) || {} };
  }
  function device() { var ua = navigator.userAgent || ''; return /ipad|tablet|playbook|silk/i.test(ua) ? 'tablet' : /mobi|android|iphone|ipod/i.test(ua) ? 'mobile' : 'desktop'; }
  function browser() { var ua = navigator.userAgent || ''; return /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Other'; }
  function os() { var ua = navigator.userAgent || ''; return /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|Mac OS/.test(ua) ? 'Apple' : /Linux/.test(ua) ? 'Linux' : 'Other'; }
  function send(path, payload) { if (disabled || !apiBase || !hasConsent()) return; try { fetch(apiBase + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), keepalive: true, credentials: 'omit' }).catch(function () {}); } catch (_) {} }
  function pixel(name, data, eventId) { if (typeof window.fbq !== 'function' || !hasConsent()) return; try { window.fbq('track', name, data || {}, { eventID: eventId }); } catch (_) {} }
  function event(name, metadata) { if (disabled || !hasConsent()) return; var eventId = uuid('evt'); send('/api/track/event', { visitor_id: state.visitor_id, session_id: state.session_id, event_name: name, event_id: eventId, page_url: location.href, fbp: cookie('_fbp'), fbc: cookie('_fbc'), metadata: metadata || {} }); return eventId; }
  function funnelEvent(name, plan) { if (disabled || !hasConsent() || !state) return; var eventId = uuid('funnel'); send('/api/track/funnel', { visitor_id: state.visitor_id, session_id: state.session_id, event_name: name, event_id: eventId, page_url: location.href, plan: plan || null, fbp: cookie('_fbp'), fbc: cookie('_fbc'), metadata: { surface: 'public_site', plan: plan || null } }); return eventId; }
  function boot() {
    if (!hasConsent() || state) return;
    state = safeGet(storageKey) || { visitor_id: uuid('v') };
    var session = safeGet(sessionKey) || {};
    state.session_id = session.session_id || uuid('s');
    session.session_id = state.session_id; session.started_at = session.started_at || new Date().toISOString(); session.pages_viewed = (session.pages_viewed || 0) + 1;
    safeSet(storageKey, state); safeSet(sessionKey, session);
    var attribution = touch();
    var visitorPayload = { visitor_id: state.visitor_id, session_id: state.session_id, landing_page: location.href, referrer: document.referrer || null, device_type: device(), browser: browser(), operating_system: os(), fbp: cookie('_fbp'), fbc: cookie('_fbc'), utm_source: attribution.latest.utm_source || attribution.first.utm_source || null, utm_medium: attribution.latest.utm_medium || attribution.first.utm_medium || null, utm_campaign: attribution.latest.utm_campaign || attribution.first.utm_campaign || null, utm_content: attribution.latest.utm_content || attribution.first.utm_content || null, utm_term: attribution.latest.utm_term || attribution.first.utm_term || null, fbclid: attribution.latest.fbclid || attribution.first.fbclid || null };
    send('/api/track/visitor', visitorPayload);
    send('/api/track/session', { visitor_id: state.visitor_id, session_id: state.session_id, started_at: session.started_at, pages_viewed: session.pages_viewed });
    var pageKey = 'orion_pageview_' + location.pathname + location.search;
    var pageSeen = false; try { pageSeen = Boolean(sessionStorage.getItem(pageKey)); if (!pageSeen) sessionStorage.setItem(pageKey, '1'); } catch (_) {}
    if (!pageSeen) { var pageEvent = event('PageView'); pixel('PageView', {}, pageEvent); }
    var contentEvent = event('ViewContent', { content_name: document.title || 'Orion landing page' }); pixel('ViewContent', { content_name: 'ORION SCALPER' }, contentEvent);
    document.addEventListener('click', function (click) {
      var target = click.target && click.target.closest ? click.target.closest('a,button') : null;
      if (!target) return;
      var label = text(target.textContent || '', 120) || '';
      var href = target.getAttribute('href') || '';
      try {
        var purchaseUrl = new URL(href, location.href);
        var purchasePlan = /^(basic|premium|lifetime)$/.test(purchaseUrl.searchParams.get('plan') || '') ? purchaseUrl.searchParams.get('plan') : '';
        if (purchaseUrl.hostname === 'app.orionscalper.com' && purchaseUrl.pathname === '/client-register' && state && !disabled && hasConsent()) {
          var selectionId = purchasePlan ? funnelEvent('PlanSelected', purchasePlan) : uuid('handoff');
          var handoff = new URLSearchParams();
          handoff.set('tracking', 'enabled');
          handoff.set('visitor_id', state.visitor_id);
          handoff.set('session_id', state.session_id);
          handoff.set('source_event_id', selectionId || uuid('funnel'));
          if (cookie('_fbp')) handoff.set('fbp', cookie('_fbp'));
          if (cookie('_fbc')) handoff.set('fbc', cookie('_fbc'));
          purchaseUrl.hash = handoff.toString();
          href = purchaseUrl.toString();
          target.setAttribute('href', href);
        }
      } catch (_) {}
      var isSupport = /support|contact|help/i.test(label);
      var isTrackedJoin = Boolean(config.joinEndpoint) && href.indexOf(String(config.joinEndpoint)) === 0;
      var isTelegram = !isSupport && (isTrackedJoin || /telegram|t\.me/i.test(href + ' ' + label));
      if (isTelegram) { var id = event('TelegramClick', { label: label, href: href }); if (config.joinEndpoint && state) { try { var join = new URL(config.joinEndpoint); var latest = safeGet(latestTouchKey) || safeGet(firstTouchKey) || {}; join.searchParams.set('visitor_id', state.visitor_id); join.searchParams.set('session_id', state.session_id); join.searchParams.set('event_id', id || uuid('tg')); join.searchParams.set('page_url', location.href); Object.keys(latest).forEach(function (key) { if (latest[key]) join.searchParams.set(key, latest[key]); }); if (cookie('_fbp')) join.searchParams.set('fbp', cookie('_fbp')); if (cookie('_fbc')) join.searchParams.set('fbc', cookie('_fbc')); target.setAttribute('href', join.toString()); } catch (_) {} } pixel('Lead', { content_name: 'Official Telegram' }, id); if (!config.joinEndpoint) send('/api/meta/conversion', { event_name: 'Lead', event_id: id, event_source_url: location.href, visitor_id: state.visitor_id, fbp: cookie('_fbp'), fbc: cookie('_fbc'), metadata: { label: label } }); }
      else if (isSupport) { var supportId = event('SupportClick', { label: label, href: href }); pixel('Contact', { content_name: 'Support' }, supportId); send('/api/meta/conversion', { event_name: 'Contact', event_id: supportId, event_source_url: location.href, visitor_id: state.visitor_id, fbp: cookie('_fbp'), fbc: cookie('_fbc') }); }
    }, true);
    window.addEventListener('pagehide', function () { var session = safeGet(sessionKey) || {}; send('/api/track/session', { visitor_id: state.visitor_id, session_id: state.session_id, started_at: session.started_at, ended_at: new Date().toISOString(), duration_seconds: session.started_at ? Math.round((Date.now() - Date.parse(session.started_at)) / 1000) : 0, pages_viewed: session.pages_viewed || 1 }); });
  }
  window.OrionAnalytics = { consent: function (accepted) { try { localStorage.setItem('orion_consent', accepted ? 'accepted' : 'denied'); } catch (_) {} if (accepted) boot(); else disabled = true; }, disable: function () { disabled = true; }, getVisitorId: function () { return state && state.visitor_id; } };
  if (hasConsent()) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot(); }
}());
