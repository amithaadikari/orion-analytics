# Framer installation

Paste the following before the closing body tag in Framer Project Settings → Custom Code. Replace the domain and keep the origin in `TRACKING_ALLOWED_ORIGINS`.

```html
<script>
window.ORION_ANALYTICS_CONFIG = {
  apiBase: 'https://analytics.example.com',
  joinEndpoint: 'https://analytics.example.com/api/join',
  requireConsent: true
};
</script>
<script src="https://analytics.example.com/framer-tracking.js"></script>
```

Paste the Meta Pixel snippet from `public/meta-pixel.js` beneath it, replacing the pixel ID. Optional consent UI is in `public/consent-banner.html`.

The script detects official Telegram buttons and support links. It records anonymous PageView, ViewContent, TelegramClick and SupportClick events, captures first/latest UTM attribution, and silently stops if storage, consent or the API is unavailable.
