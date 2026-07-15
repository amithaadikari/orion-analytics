/* Orion Meta Pixel loader. The Pixel ID is public; access tokens remain server-only. */
(function () {
  'use strict';
  var pixelId = '2033151167283745';
  if (window.__ORION_META_PIXEL_ID__ === pixelId) return;

  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
  window.fbq('init', pixelId);
  window.__ORION_META_PIXEL_ID__ = pixelId;
}());
/* PageView and Lead are emitted by framer-tracking.js. */
