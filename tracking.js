// =====================================================
// Shared analytics/pixel layer (Meta + Google)
// Loaded by both the storefront (index.html/store.js) and the Linktree (links.html).
// Pixel IDs come from store_settings (admin-editable); if a field is blank,
// that pixel is never loaded, so tracking stays fully dormant until IDs are added.
// =====================================================

(function () {
    let metaReady = false;
    let googleReady = false;
    let initialized = false;

    function loadMeta(pixelId) {
        if (!pixelId || window.fbq) return;
        /* Standard Meta Pixel base snippet */
        !function (f, b, e, v, n, t, s) {
            if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments) };
            if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
            t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s)
        }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
        window.fbq('init', pixelId);
        metaReady = true;
    }

    function loadGoogle(tagId) {
        if (!tagId || window.gtag) return;
        const s = document.createElement('script');
        s.async = true;
        s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(tagId);
        document.head.appendChild(s);
        window.dataLayer = window.dataLayer || [];
        window.gtag = function () { window.dataLayer.push(arguments); };
        window.gtag('js', new Date());
        window.gtag('config', tagId);
        googleReady = true;
    }

    // Call once, after store_settings is fetched. Injects whichever pixels are configured
    // and fires the PageView. Safe to call again (no-ops).
    window.initTracking = function (settings) {
        if (initialized) return;
        initialized = true;
        settings = settings || {};
        loadMeta((settings.meta_pixel_id || '').trim());
        loadGoogle((settings.google_tag_id || '').trim());
        // PageView: Meta needs an explicit call; Google fires page_view via config.
        if (metaReady) window.fbq('track', 'PageView');
    };

    // Fire a logical commerce event on whichever pixels are active.
    // data = { value, currency, contents: [{ id, name, quantity, price }] }
    window.trackEvent = function (name, data) {
        data = data || {};
        const currency = data.currency || 'BRL';
        const contents = Array.isArray(data.contents) ? data.contents : [];
        const value = typeof data.value === 'number'
            ? data.value
            : contents.reduce(function (s, c) { return s + (Number(c.price) || 0) * (Number(c.quantity) || 0); }, 0);
        const numItems = contents.reduce(function (s, c) { return s + (Number(c.quantity) || 0); }, 0);

        if (metaReady && window.fbq) {
            window.fbq('track', name, {
                content_type: 'product',
                content_ids: contents.map(function (c) { return c.id; }),
                value: value,
                currency: currency,
                num_items: numItems
            });
        }
        if (googleReady && window.gtag) {
            const gaEvent = name === 'AddToCart' ? 'add_to_cart'
                : name === 'InitiateCheckout' ? 'begin_checkout'
                    : name;
            window.gtag('event', gaEvent, {
                currency: currency,
                value: value,
                items: contents.map(function (c) {
                    return { item_id: c.id, item_name: c.name, quantity: c.quantity, price: c.price };
                })
            });
        }
    };
})();
