// --- CONFIGURATION ---
const CONFIG = {
    supabaseUrl: 'https://awcmwwhxtwdwfqhtahec.supabase.co',
    supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3Y213d2h4dHdkd2ZxaHRhaGVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwOTAyNDksImV4cCI6MjA4NTY2NjI0OX0.TGYfoqV5H7VPjYFRk-yPh5cPzr2pL5cBXtJy_5kRsCA',
    whatsapp: '5511999999999',
    n8nWebhookUrl: 'YOUR_N8N_WEBHOOK_URL', // Replace with your N8N webhook URL
    minOrderItems: 10
};

// Single shared Supabase client (avoids re-creating one per query)
const sbClient = (typeof supabase !== 'undefined' && CONFIG.supabaseUrl.includes('supabase.co'))
    ? supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey)
    : null;

// Escape any product/cart value before inserting it into innerHTML.
// Product data is admin-managed, but defense-in-depth against stored XSS.
function escapeHtml(v) {
    if (v === null || v === undefined) return '';
    return String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Serve Supabase Storage images resized via the on-the-fly render endpoint.
// Product photos are uploaded at full camera resolution (~3MB); cards only need ~600px.
function optimizeImg(url, width, quality = 75) {
    if (typeof url !== 'string' || !url.includes('/storage/v1/object/public/')) return url;
    const resized = url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
    // resize=contain keeps the source aspect ratio. Without it, width-only requests
    // squash the image (Supabase keeps the original height), which CSS object-fit then
    // crops into a distorted "zoomed" result.
    return `${resized}${resized.includes('?') ? '&' : '?'}width=${width}&resize=contain&quality=${quality}`;
}

// --- GLOBAL STATE ---
const state = {
    allProducts: [],
    filtered: [],
    filters: { search: '', category: 'all', size: 'all' },
    modal: {
        activeProduct: null,
        currentImageIndex: 0
    },
    cart: JSON.parse(localStorage.getItem('cart') || '[]'),
    sizeModal: {
        activeProduct: null
    },
    storeOpen: true,
    emergencyClosed: false
};

// --- MOCK DATA ---
const MOCK_DATA = [
    { id: 1, name: 'Shorts com brilho lateral', price: 30.00, category: 'Shorts', sizes: ['P', 'M'], images: ['https://images.unsplash.com/photo-1591195853828-11db59a44f6b?auto=format&fit=crop&w=800&q=80'], is_new: true },
    { id: 2, name: 'Shorts jeans com seta', price: 30.00, category: 'Shorts', sizes: ['P', 'M', 'G'], images: ['https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=800&q=80'] },
    { id: 3, name: 'Saia MIDI sem laycra', price: 40.00, category: 'Saias', sizes: ['M', 'G'], images: ['https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?auto=format&fit=crop&w=800&q=80'], is_new: true },
    { id: 4, name: 'Cropped preto sem brilho', price: 30.00, category: 'Blusas', sizes: ['U'], images: ['https://images.unsplash.com/photo-1503342394128-c104d54dba01?auto=format&fit=crop&w=800&q=80'] },
    { id: 5, name: 'Jaqueta Jeans Cargo', price: 99.90, category: 'Conjuntos', sizes: ['P', 'M', 'G', 'GG'], images: ['https://images.unsplash.com/photo-1544642899-f0d6e5f6ed6f?auto=format&fit=crop&w=800&q=80'] },
    { id: 6, name: 'Calça Jeans Skinny', price: 89.90, category: 'Calças', sizes: ['P', 'M', 'G', 'GG'], images: ['https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=800&q=80'], is_new: true },
    { id: 7, name: 'Vestido Longo Floral', price: 129.90, category: 'Vestidos', sizes: ['P', 'M', 'G'], images: ['https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?auto=format&fit=crop&w=800&q=80'] }
];

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 App Starting...");

    try { initCarousel(); } catch (err) { console.error("Banner Init Error:", err); }
    initData();
    setupFilters();
    setupModal();
    setupZoom();
    setupCart();
    setupSizeModal();
    setupOrderForm();
    updateCartUI();
    initStoreStatus();
});

// --- CAROUSEL LOGIC ---
function initCarousel() {
    const slides = document.querySelectorAll('.slide');
    const dots = document.querySelectorAll('.dot');
    let index = 0;

    if (!slides.length) return;

    // Slides 2+ carry their image in data-bg so they don't compete with the
    // hero image at load time; apply them before the first rotation (4s).
    setTimeout(() => {
        slides.forEach(el => {
            if (el.dataset.bg) {
                el.style.backgroundImage = `url('${el.dataset.bg}')`;
                delete el.dataset.bg;
            }
        });
    }, 1500);

    function show(i) {
        if (i >= slides.length) index = 0;
        if (i < 0) index = slides.length - 1;

        slides.forEach(el => el.classList.remove('active'));
        dots.forEach(el => el.classList.remove('active'));

        slides[index].classList.add('active');
        if (dots[index]) dots[index].classList.add('active');
    }

    setInterval(() => { index++; show(index); }, 4000);
    show(0);
}

// --- DATA LOGIC (ROBUST PARSING) ---
async function initData() {
    setLoading(true);

    let data = [];
    let useMock = true;

    try {
        if (sbClient) {
            const { data: dbData, error } = await sbClient
                .from('store_items')
                .select('*')
                .order('created_at', { ascending: false });

            if (!error && dbData && dbData.length > 0) {
                console.log("📦 Raw Supabase Data:", dbData);

                // Parse Images Safely
                data = dbData.map(item => {
                    let imgs = [];

                    if (item.images) {
                        // Case A: Already an Array
                        if (Array.isArray(item.images)) {
                            imgs = item.images;
                        }
                        // Case B: String
                        else if (typeof item.images === 'string') {
                            try {
                                // Try JSON Parse (e.g. '["url1", "url2"]')
                                const parsed = JSON.parse(item.images);
                                if (Array.isArray(parsed)) imgs = parsed;
                            } catch (e) {
                                // Try Postgres Text Format (e.g. '{url1,url2}')
                                // Remove braces and quotes
                                let clean = item.images.replace(/^\{|\}$/g, '');
                                // Split by comma
                                imgs = clean.split(',').map(u => u.replace(/"/g, '').trim()).filter(u => u.length > 0);
                            }
                        }
                    }

                    // Fallback to legacy image_url column
                    if (imgs.length === 0 && item.image_url) {
                        imgs = [item.image_url];
                    }

                    // Parse Sizes Safely (New)
                    let sizes = [];
                    if (item.sizes) {
                        if (Array.isArray(item.sizes)) sizes = item.sizes;
                        else if (typeof item.sizes === 'string') {
                            try {
                                const parsed = JSON.parse(item.sizes);
                                if (Array.isArray(parsed)) sizes = parsed;
                            } catch (e) {
                                // Postgres format {P,M,G}
                                let clean = item.sizes.replace(/^\{|\}$/g, '');
                                sizes = clean.split(',').map(s => s.replace(/"/g, '').trim()).filter(s => s.length > 0);
                            }
                        }
                    }

                    return {
                        ...item,
                        images: imgs.length > 0 ? imgs : null,
                        sizes: sizes.length > 0 ? sizes : (item.sizes || [])
                    };
                });

                useMock = false;
                console.log("✅ Parsed Data:", data);
            } else if (error) {
                console.error("Supabase Error:", error);
            }
        }
    } catch (err) {
        console.warn("Supabase Exception:", err);
    }

    if (useMock) {
        console.log("ℹ️ Using Mock Data (Supabase failed or empty)");
        data = MOCK_DATA;
        await new Promise(r => setTimeout(r, 600));
    }

    // Hide out-of-stock products from the storefront (they remain manageable in admin)
    data = data.filter(p => !p.is_out_of_stock);

    state.allProducts = data;
    state.filtered = data;

    renderGrid();
    setupVideoSection();
    setLoading(false);
}

// --- FILTER LOGIC ---
function setupFilters() {
    const inputs = {
        search: document.getElementById('search-input'),
        cat: document.getElementById('category-filter'),
        size: document.getElementById('size-filter')
    };

    function filter() {
        const term = inputs.search ? inputs.search.value.toLowerCase() : '';
        const cat = inputs.cat ? inputs.cat.value : 'all';
        const size = inputs.size ? inputs.size.value : 'all';

        state.filtered = state.allProducts.filter(p => {
            const matchName = (p.name && p.name.toLowerCase().includes(term)) || (p.category && p.category.toLowerCase().includes(term));
            const matchCat = cat === 'all' || p.category === cat;
            const matchSize = size === 'all' || (p.sizes && p.sizes.includes(size));
            return matchName && matchCat && matchSize;
        });
        renderGrid();
    }

    // Debounce typing so the full grid isn't rebuilt on every keystroke
    let searchTimer = null;
    function debouncedFilter() {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(filter, 200);
    }

    if (inputs.search) inputs.search.addEventListener('input', debouncedFilter);
    if (inputs.cat) inputs.cat.addEventListener('change', filter);
    if (inputs.size) inputs.size.addEventListener('change', filter);
}

// --- RENDER LOGIC ---
// --- RENDER LOGIC ---
function renderGrid() {
    const grid = document.getElementById('product-grid');
    const saleGrid = document.getElementById('sale-grid');
    const saleSection = document.getElementById('sale-section');
    const newGrid = document.getElementById('new-grid');
    const newSection = document.getElementById('new-arrivals');
    const count = document.getElementById('result-count');
    const empty = document.getElementById('empty-state');

    // 1. Render Main Grid & Sale Grid
    if (!grid) return;
    grid.innerHTML = '';
    if (saleGrid) saleGrid.innerHTML = '';

    // 2. Render New Arrivals (Only from ALL products, not filtered ones)
    if (newGrid && newSection) {
        newGrid.innerHTML = '';
        const newItems = state.allProducts.filter(p => p.is_new === true && !p.is_on_sale);

        if (newItems.length > 0) {
            newSection.classList.remove('hidden');
            const newFrag = document.createDocumentFragment();
            newItems.forEach((p, i) => newFrag.appendChild(createCard(p, true, i < 2)));
            newGrid.appendChild(newFrag);
        } else {
            newSection.classList.add('hidden');
        }
    }

    // 3. Render Filtered Main Grid & Sale Grid
    const list = state.filtered;

    // Split into Main and Sale
    const mainItems = list.filter(p => !p.is_on_sale);
    const saleItems = list.filter(p => p.is_on_sale);

    // Update Total Count
    if (count) count.innerText = `${list.length} itens encontrados`;

    if (list.length === 0) {
        if (empty) empty.classList.remove('hidden');
        if (saleSection) saleSection.classList.add('hidden');
        return;
    }
    if (empty) empty.classList.add('hidden');

    // Render Main Items (batched in a fragment: single layout pass)
    const mainFrag = document.createDocumentFragment();
    mainItems.forEach((p, i) => {
        mainFrag.appendChild(createCard(p, false, i < 4));
    });
    grid.appendChild(mainFrag);

    // Render Sale Items
    if (saleItems.length > 0 && saleGrid && saleSection) {
        saleSection.classList.remove('hidden');
        const saleFrag = document.createDocumentFragment();
        saleItems.forEach(p => {
            saleFrag.appendChild(createCard(p, false));
        });
        saleGrid.appendChild(saleFrag);
    } else if (saleSection) {
        saleSection.classList.add('hidden');
    }
}

// Helper to create card
function createCard(p, isNewSection, eager = false) {
    const el = document.createElement('div');
    el.className = 'card';
    el.onclick = (e) => {
        if (e.target.closest('.btn-add-cart')) return;
        openModal(p);
    };

    const price = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.price || 0);
    const sizes = (p.sizes || []).map(s => `<span class="size-badge">${escapeHtml(s)}</span>`).join('');

    const rawImages = p.images && p.images.length ? p.images : ['https://via.placeholder.com/400?text=Sem+Foto'];
    const images = rawImages.map(u => optimizeImg(u, 600));
    const mainImg = images[0];

    // Unique ID for hover effect
    const uniqueId = `img-${p.id}-${isNewSection ? 'new' : 'main'}`;
    const isOutOfStock = p.is_out_of_stock;
    const isOnSale = p.is_on_sale;

    let badgeHTML = '';
    if (isOutOfStock) {
        badgeHTML = `<div class="badge-out">Esgotado</div>`;
    } else if (isOnSale) {
        badgeHTML = `<div class="badge-sale">Promoção</div>`;
    } else if (p.is_new && !isNewSection) {
        badgeHTML = `<div class="badge-new">NOVO</div>`;
    }

    el.innerHTML = `
        ${badgeHTML}
        <div class="card-image-wrapper">
            <img src="${escapeHtml(mainImg)}" class="card-image ${isOutOfStock ? 'out-of-stock-img' : ''}" loading="${eager ? 'eager' : 'lazy'}" ${eager ? 'fetchpriority="high"' : ''} decoding="async" id="${uniqueId}">
        </div>
        <div class="card-content">
            <div class="card-category">${escapeHtml(p.category)}</div>
            <h3 class="card-title">${escapeHtml(p.name)}</h3>
            <div class="card-price">${price}</div>
            <div class="card-sizes">${sizes}</div>
            <button class="btn-whatsapp btn-add-cart ${isOutOfStock || !state.storeOpen ? 'disabled-btn' : ''}" 
                data-product-id="${p.id}" 
                ${isOutOfStock || !state.storeOpen ? 'disabled' : ''}>
                <i class="fa-solid ${isOutOfStock ? 'fa-ban' : (!state.storeOpen ? 'fa-lock' : 'fa-cart-plus')}"></i> 
                <span class="btn-text">${isOutOfStock ? 'Esgotado' : (!state.storeOpen ? 'Loja Fechada' : 'Adicionar ao Carrinho')}</span>
            </button>
        </div>
    `;

    // If the resize endpoint ever fails, fall back to the original image
    const cardImg = el.querySelector('.card-image');
    if (cardImg && mainImg !== rawImages[0]) {
        cardImg.onerror = () => { cardImg.onerror = null; cardImg.src = rawImages[0]; };
    }

    // Add to cart button click
    const addCartBtn = el.querySelector('.btn-add-cart');
    addCartBtn.onclick = (e) => {
        e.stopPropagation();
        openSizeModal(p);
    };

    // Hover Slideshow
    if (images.length > 1) {
        let interval;
        let imgIdx = 0;
        const imgEl = el.querySelector(`#${uniqueId}`);

        el.onmouseenter = () => {
            interval = setInterval(() => {
                imgIdx = (imgIdx + 1) % images.length;
                imgEl.src = images[imgIdx];
            }, 1200);
        };

        el.onmouseleave = () => {
            clearInterval(interval);
            imgIdx = 0;
            imgEl.src = images[0];
        };
    }

    return el;
}

// --- MODAL LOGIC ---
function setupModal() {
    const modal = document.getElementById('product-modal');
    const closeBtn = document.getElementById('close-modal');
    const prevBtn = document.getElementById('modal-prev');
    const nextBtn = document.getElementById('modal-next');

    if (!modal) return;

    closeBtn.onclick = closeModal;
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    if (prevBtn) prevBtn.onclick = (e) => { e.stopPropagation(); changeImage(-1); };
    if (nextBtn) nextBtn.onclick = (e) => { e.stopPropagation(); changeImage(1); };
}

function openModal(product) {
    state.modal.activeProduct = product;
    state.modal.currentImageIndex = 0;

    const modal = document.getElementById('product-modal');
    const catEl = document.getElementById('modal-cat');
    const titleEl = document.getElementById('modal-title');
    const priceEl = document.getElementById('modal-price');
    const sizesEl = document.getElementById('modal-sizes');
    const buyEl = document.getElementById('modal-buy');

    if (!modal) return;

    if (catEl) catEl.innerText = product.category || 'Categoria';
    if (titleEl) titleEl.innerText = product.name || 'Produto';
    if (priceEl) priceEl.innerText = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(product.price || 0);

    if (sizesEl) {
        sizesEl.innerHTML = (product.sizes || []).map(s => `<span class="size-badge">${escapeHtml(s)}</span>`).join('');
    }

    if (buyEl) {
        if (product.is_out_of_stock) {
            buyEl.disabled = true;
            buyEl.classList.add('disabled-btn');
            buyEl.innerHTML = '<i class="fa-solid fa-ban"></i> Esgotado';
            buyEl.onclick = null;
        } else if (!state.storeOpen) {
            buyEl.disabled = true;
            buyEl.classList.add('disabled-btn');
            buyEl.innerHTML = '<i class="fa-solid fa-lock"></i> Loja Fechada';
            buyEl.onclick = null;
        } else {
            buyEl.disabled = false;
            buyEl.classList.remove('disabled-btn');
            buyEl.innerHTML = '<i class="fa-solid fa-cart-plus"></i> Adicionar ao Carrinho';
            buyEl.onclick = () => {
                closeModal();
                openSizeModal(product);
            };
        }
    }

    updateModalImage();

    modal.classList.add('open');
    modal.style.zIndex = '4000';
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    const modal = document.getElementById('product-modal');
    if (modal) modal.classList.remove('open');
    document.body.style.overflow = '';
    resetZoom();
}

function changeImage(dir) {
    const p = state.modal.activeProduct;
    if (!p || !p.images) return;

    const len = p.images.length;
    let newIdx = state.modal.currentImageIndex + dir;

    if (newIdx < 0) newIdx = len - 1;
    if (newIdx >= len) newIdx = 0;

    state.modal.currentImageIndex = newIdx;
    updateModalImage();
}

function updateModalImage() {
    const p = state.modal.activeProduct;
    if (!p) return;

    const rawImages = p.images && p.images.length ? p.images : ['https://via.placeholder.com/600'];
    const images = rawImages.map(u => optimizeImg(u, 1200, 80));
    const idx = state.modal.currentImageIndex;

    const imgEl = document.getElementById('modal-img');
    if (imgEl) {
        imgEl.onerror = () => { imgEl.onerror = null; imgEl.src = rawImages[idx]; };
        imgEl.src = images[idx];
    }

    // Preload adjacent images for smoother navigation
    const preloadNext = new Image();
    const preloadPrev = new Image();
    if (images[(idx + 1) % images.length]) preloadNext.src = images[(idx + 1) % images.length];
    if (images[(idx - 1 + images.length) % images.length]) preloadPrev.src = images[(idx - 1 + images.length) % images.length];

    const prev = document.getElementById('modal-prev');
    const next = document.getElementById('modal-next');
    const dots = document.getElementById('modal-dots');
    const hasMultiple = images.length > 1;

    if (prev) prev.style.display = hasMultiple ? 'flex' : 'none';
    if (next) next.style.display = hasMultiple ? 'flex' : 'none';

    if (dots) {
        dots.innerHTML = hasMultiple ? images.map((_, i) =>
            `<div class="modal-dot ${i === idx ? 'active' : ''}" onclick="state.modal.currentImageIndex = ${i}; updateModalImage()"></div>`
        ).join('') : '';
    }

    // Reset zoom when switching images
    resetZoom();
}

// --- ZOOM / MAGNIFIER LOGIC ---
function resetZoom() {
    const gallery = document.getElementById('modal-gallery');
    const img = document.getElementById('modal-img');
    const toggleBtn = document.getElementById('zoom-toggle');
    if (gallery) gallery.classList.remove('zoomed');
    if (img) {
        img.style.transform = '';
        img.style.transformOrigin = '';
    }
    if (toggleBtn) toggleBtn.classList.remove('active');
}

function setupZoom() {
    const gallery = document.getElementById('modal-gallery');
    const img = document.getElementById('modal-img');
    const toggleBtn = document.getElementById('zoom-toggle');

    if (!gallery || !img) return;

    const ZOOM_LEVEL = 2.5;
    let isMobile = window.matchMedia('(max-width: 768px)').matches;
    let mobileZoomed = false;

    // Re-check on resize
    window.addEventListener('resize', () => {
        isMobile = window.matchMedia('(max-width: 768px)').matches;
        resetZoom();
        mobileZoomed = false;
    });

    // === DESKTOP: Hover to zoom with edge safe zones ===
    const SAFE_ZONE = 60; // px from each edge where zoom pauses
    let desktopZoomed = false;

    function activateZoom() {
        if (desktopZoomed) return;
        desktopZoomed = true;
        gallery.classList.add('zoomed');
        img.style.transform = `scale(${ZOOM_LEVEL})`;
    }

    function deactivateZoom() {
        if (!desktopZoomed) return;
        desktopZoomed = false;
        gallery.classList.remove('zoomed');
        img.style.transform = '';
        img.style.transformOrigin = '';
    }

    gallery.addEventListener('mousemove', (e) => {
        if (isMobile) return;
        const rect = gallery.getBoundingClientRect();
        const localX = e.clientX - rect.left;

        // Check if cursor is in the edge safe zones (arrow areas)
        if (localX < SAFE_ZONE || localX > rect.width - SAFE_ZONE) {
            // In safe zone — pause zoom, let arrows be clickable
            deactivateZoom();
        } else {
            // In center — activate zoom and track position
            activateZoom();
            const x = (localX / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;
            img.style.transformOrigin = `${x}% ${y}%`;
        }
    });

    gallery.addEventListener('mouseleave', () => {
        if (isMobile) return;
        deactivateZoom();
    });

    // === MOBILE: Toggle Zoom Button ===
    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!isMobile) return;

            mobileZoomed = !mobileZoomed;

            if (mobileZoomed) {
                gallery.classList.add('zoomed');
                toggleBtn.classList.add('active');
                img.style.transform = `scale(${ZOOM_LEVEL})`;
                img.style.transformOrigin = 'center center';
            } else {
                gallery.classList.remove('zoomed');
                toggleBtn.classList.remove('active');
                img.style.transform = '';
                img.style.transformOrigin = '';
            }
        });
    }

    // === MOBILE: Drag to Pan when zoomed ===
    let isDragging = false;
    let startX, startY, originX, originY;

    gallery.addEventListener('touchstart', (e) => {
        if (!mobileZoomed || !isMobile) return;
        if (e.touches.length !== 1) return;

        // Don't intercept taps on the toggle button — let the click event fire
        if (toggleBtn && (e.target === toggleBtn || toggleBtn.contains(e.target))) return;

        isDragging = true;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;

        // Parse current origin
        const origin = img.style.transformOrigin || 'center center';
        const parts = origin.split(' ');
        originX = parseFloat(parts[0]) || 50;
        originY = parseFloat(parts[1]) || 50;

        e.preventDefault();
    }, { passive: false });

    gallery.addEventListener('touchmove', (e) => {
        if (!isDragging || !mobileZoomed || !isMobile) return;
        if (e.touches.length !== 1) return;

        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;

        const rect = gallery.getBoundingClientRect();
        const sensitivity = 100 / (rect.width / 2);

        let newX = originX - (dx * sensitivity);
        let newY = originY - (dy * sensitivity);

        // Clamp between 0% and 100%
        newX = Math.max(0, Math.min(100, newX));
        newY = Math.max(0, Math.min(100, newY));

        img.style.transformOrigin = `${newX}% ${newY}%`;

        e.preventDefault();
    }, { passive: false });

    gallery.addEventListener('touchend', () => {
        if (!isMobile) return;
        isDragging = false;
        // Update origin to current for next drag
        const origin = img.style.transformOrigin || 'center center';
        const parts = origin.split(' ');
        originX = parseFloat(parts[0]) || 50;
        originY = parseFloat(parts[1]) || 50;
    });
}

// --- VIDEO SHOWCASE SECTION ---
function setupVideoSection() {
    const section = document.getElementById('video-showcase');
    const carousel = document.getElementById('video-carousel');
    const prevBtn = document.getElementById('video-nav-prev');
    const nextBtn = document.getElementById('video-nav-next');

    if (!section || !carousel) return;

    // Filter products that have a video_url
    const videoProducts = (state.allProducts || []).filter(p => p.video_url);

    if (videoProducts.length === 0) {
        section.classList.add('hidden');
        return;
    }

    section.classList.remove('hidden');
    carousel.innerHTML = '';

    const priceFormat = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

    videoProducts.forEach(p => {
        const card = document.createElement('div');
        card.className = 'video-card';

        const thumb = p.images && p.images.length ? optimizeImg(p.images[0], 600) : 'https://via.placeholder.com/100?text=Foto';
        const price = priceFormat.format(p.price || 0);

        card.innerHTML = `
            <div class="video-card-media">
                <video src="${escapeHtml(p.video_url)}" poster="${escapeHtml(thumb)}" muted loop playsinline webkit-playsinline disablePictureInPicture preload="metadata"></video>
                <div class="video-play-icon"><i class="fa-solid fa-play"></i></div>
            </div>
            <div class="video-product-tag">
                <img class="video-product-thumb" src="${escapeHtml(thumb)}" alt="${escapeHtml(p.name)}">
                <div class="video-product-details">
                    <div class="video-product-name">${escapeHtml(p.name)}</div>
                    <div class="video-product-price">${price}</div>
                </div>
            </div>
        `;

        const video = card.querySelector('video');

        // Hover to play
        card.addEventListener('mouseenter', () => {
            video.play().catch(() => { });
        });
        card.addEventListener('mouseleave', () => {
            video.pause();
            video.currentTime = 0;
        });

        // Click to open lightbox
        card.addEventListener('click', () => {
            openVideoLightbox(p);
        });

        carousel.appendChild(card);
    });

    // Carousel navigation
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            carousel.scrollBy({ left: -240, behavior: 'smooth' });
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            carousel.scrollBy({ left: 240, behavior: 'smooth' });
        });
    }

    // Mobile: drag to scroll (touch is handled by native overflow-x)
}

// --- VIDEO LIGHTBOX ---
let videoLightboxProduct = null;

function openVideoLightbox(product) {
    videoLightboxProduct = product;
    const overlay = document.getElementById('video-lightbox');
    const player = document.getElementById('video-lightbox-player');
    const thumb = document.getElementById('video-lightbox-thumb');
    const name = document.getElementById('video-lightbox-name');
    const price = document.getElementById('video-lightbox-price');

    if (!overlay || !player) return;

    const priceFormat = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

    player.src = product.video_url;
    player.muted = true;
    player.play().catch(() => { });

    thumb.src = product.images && product.images.length ? optimizeImg(product.images[0], 200) : '';
    name.textContent = product.name;
    price.textContent = priceFormat.format(product.price || 0);

    // Respect out-of-stock / store closed status
    const cartBtn = document.getElementById('video-lightbox-cart');
    if (cartBtn) {
        const isOutOfStock = product.is_out_of_stock;
        if (isOutOfStock || !state.storeOpen) {
            cartBtn.disabled = true;
            cartBtn.classList.add('disabled-btn');
            cartBtn.innerHTML = `<i class="fa-solid ${isOutOfStock ? 'fa-ban' : 'fa-lock'}"></i> ${isOutOfStock ? 'Esgotado' : 'Loja Fechada'}`;
        } else {
            cartBtn.disabled = false;
            cartBtn.classList.remove('disabled-btn');
            cartBtn.innerHTML = '<i class="fa-solid fa-cart-plus"></i> Adicionar';
        }
    }

    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeVideoLightbox() {
    const overlay = document.getElementById('video-lightbox');
    const player = document.getElementById('video-lightbox-player');

    if (overlay) overlay.classList.remove('open');
    if (player) {
        player.pause();
        player.src = '';
    }
    document.body.style.overflow = '';
    videoLightboxProduct = null;
}

// Close button
document.getElementById('video-lightbox-close')?.addEventListener('click', closeVideoLightbox);

// Close on overlay click
document.getElementById('video-lightbox')?.addEventListener('click', (e) => {
    if (e.target.id === 'video-lightbox') closeVideoLightbox();
});

// Close on Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('video-lightbox')?.classList.contains('open')) {
        closeVideoLightbox();
    }
});

// Add to cart from video lightbox
document.getElementById('video-lightbox-cart')?.addEventListener('click', () => {
    if (videoLightboxProduct && !videoLightboxProduct.is_out_of_stock && state.storeOpen) {
        const product = videoLightboxProduct;
        closeVideoLightbox();
        openSizeModal(product);
    }
});

function setLoading(isLoading) {
    // Reserve vertical space for the grid while products load so the
    // hours section / footer don't jump up the page (CLS)
    const grid = document.getElementById('product-grid');
    if (grid) grid.classList.toggle('is-loading', isLoading);

    const loader = document.getElementById('loading');
    if (!loader) return;
    if (isLoading) loader.classList.remove('hidden');
    else {
        loader.classList.add('hidden');
        loader.style.display = 'none'; // Force hide
    }
}

// =====================================================
// SHOPPING CART FUNCTIONALITY
// =====================================================

// Setup Cart UI
function setupCart() {
    const cartBtn = document.getElementById('cart-btn');
    const closeCart = document.getElementById('close-cart');
    const cartOverlay = document.getElementById('cart-overlay');
    const checkoutBtn = document.getElementById('btn-checkout');

    if (cartBtn) cartBtn.onclick = openCartDrawer;
    if (closeCart) closeCart.onclick = closeCartDrawer;
    if (cartOverlay) cartOverlay.onclick = closeCartDrawer;
    if (checkoutBtn) checkoutBtn.onclick = openOrderModal;
}

function openCartDrawer() {
    document.getElementById('cart-drawer').classList.add('open');
    document.getElementById('cart-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    renderCartItems();
}

function closeCartDrawer() {
    document.getElementById('cart-drawer').classList.remove('open');
    document.getElementById('cart-overlay').classList.remove('open');
    document.body.style.overflow = '';
}

// Setup Size Selection Modal
function setupSizeModal() {
    const closeBtn = document.getElementById('close-size-modal');
    const confirmBtn = document.getElementById('confirm-add-cart');
    const modal = document.getElementById('size-modal');

    if (closeBtn) closeBtn.onclick = closeSizeModal;
    if (modal) modal.onclick = (e) => { if (e.target === modal) closeSizeModal(); };
    if (confirmBtn) confirmBtn.onclick = confirmAddToCart;
}

function openSizeModal(product) {
    // Block if store is closed
    if (!state.storeOpen) {
        return;
    }

    state.sizeModal.activeProduct = product;
    const modal = document.getElementById('size-modal');
    const productName = document.getElementById('size-modal-product');
    const sizesContainer = document.getElementById('size-modal-sizes');

    if (productName) productName.innerText = product.name;

    // Build size quantity inputs
    const sizes = product.sizes || [];
    sizesContainer.innerHTML = sizes.map(size => `
        <div class="size-quantity-row">
            <label>Tamanho ${escapeHtml(size)}</label>
            <input type="number" min="0" value="0" data-size="${escapeHtml(size)}" class="size-qty-input">
        </div>
    `).join('');

    modal.classList.add('open');
    modal.style.zIndex = '4000';
}

function closeSizeModal() {
    document.getElementById('size-modal').classList.remove('open');
    state.sizeModal.activeProduct = null;
}

function confirmAddToCart() {
    // Block if store closed while modal was open
    if (!state.storeOpen) {
        closeSizeModal();
        return;
    }

    const product = state.sizeModal.activeProduct;
    if (!product) return;

    const inputs = document.querySelectorAll('.size-qty-input');
    let addedAny = false;

    inputs.forEach(input => {
        const qty = parseInt(input.value) || 0;
        const size = input.dataset.size;

        if (qty > 0) {
            addToCart(product, size, qty);
            addedAny = true;
        }
    });

    if (addedAny) {
        closeSizeModal();
        updateCartUI();
        // Show brief feedback
        const cartBtn = document.getElementById('cart-btn');
        cartBtn.classList.add('pulse');
        setTimeout(() => cartBtn.classList.remove('pulse'), 500);
    }
}

function addToCart(product, size, quantity) {
    const existingIndex = state.cart.findIndex(
        item => item.product_id === product.id && item.size === size
    );

    if (existingIndex >= 0) {
        state.cart[existingIndex].quantity += quantity;
    } else {
        state.cart.push({
            product_id: product.id,
            product_name: product.name,
            size: size,
            quantity: quantity,
            price: product.price,
            image: product.images && product.images[0] ? product.images[0] : ''
        });
    }

    saveCart();
}

function removeFromCart(index) {
    state.cart.splice(index, 1);
    saveCart();
    updateCartUI();
    renderCartItems();
}

function saveCart() {
    localStorage.setItem('cart', JSON.stringify(state.cart));
}

function updateCartQuantity(index, change) {
    if (state.cart[index]) {
        state.cart[index].quantity += change;
        if (state.cart[index].quantity <= 0) {
            removeFromCart(index);
        } else {
            saveCart();
            updateCartUI();
            renderCartItems();
        }
    }
}

function updateCartUI() {
    const countEl = document.getElementById('cart-count');
    const totalItems = state.cart.reduce((sum, item) => sum + item.quantity, 0);
    if (countEl) countEl.innerText = totalItems;

    // Update checkout button state
    const checkoutBtn = document.getElementById('btn-checkout');
    const minWarning = document.getElementById('cart-min-warning');

    if (checkoutBtn) {
        if (totalItems >= CONFIG.minOrderItems) {
            checkoutBtn.disabled = false;
            if (minWarning) minWarning.style.display = 'none';
        } else {
            checkoutBtn.disabled = true;
            if (minWarning) minWarning.style.display = 'flex';
        }
    }
}

function renderCartItems() {
    const container = document.getElementById('cart-items');
    const totalItemsEl = document.getElementById('cart-total-items');
    const totalPriceEl = document.getElementById('cart-total-price');

    if (!container) return;

    if (state.cart.length === 0) {
        container.innerHTML = `
            <div class="cart-empty">
                <i class="fa-solid fa-shopping-cart"></i>
                <p>Seu carrinho está vazio</p>
            </div>
        `;
    } else {
        container.innerHTML = state.cart.map((item, index) => `
            <div class="cart-item">
                <img src="${escapeHtml(optimizeImg(item.image, 200)) || 'https://via.placeholder.com/60'}" class="cart-item-image" alt="${escapeHtml(item.product_name)}">
                <div class="cart-item-info">
                    <div class="cart-item-name">${escapeHtml(item.product_name)}</div>
                    <div class="cart-item-details">Tamanho: ${escapeHtml(item.size)}</div>
                    <div class="cart-qty-wrapper">
                        <button class="qty-btn" onclick="updateCartQuantity(${index}, -1)">-</button>
                        <span class="qty-display">${item.quantity}</span>
                        <button class="qty-btn" onclick="updateCartQuantity(${index}, 1)">+</button>
                    </div>
                    <div class="cart-item-price">${formatPrice(item.price * item.quantity)}</div>
                </div>
                <button class="cart-item-remove" onclick="removeFromCart(${index})">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `).join('');
    }

    // Update totals
    const totalItems = state.cart.reduce((sum, item) => sum + item.quantity, 0);
    const totalPrice = state.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    if (totalItemsEl) totalItemsEl.innerText = totalItems;
    if (totalPriceEl) totalPriceEl.innerText = formatPrice(totalPrice);

    updateCartUI();
}

function formatPrice(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

// =====================================================
// ORDER FORM
// =====================================================

function setupOrderForm() {
    const closeBtn = document.getElementById('close-order-modal');
    const modal = document.getElementById('order-modal');
    const form = document.getElementById('order-form');

    if (closeBtn) closeBtn.onclick = closeOrderModal;
    if (modal) modal.onclick = (e) => { if (e.target === modal) closeOrderModal(); };
    if (form) form.onsubmit = submitOrder;
}

function openOrderModal() {
    const totalItems = state.cart.reduce((sum, item) => sum + item.quantity, 0);

    if (totalItems < CONFIG.minOrderItems) {
        showOrderError('Apenas pedidos acima de 10 peças serão aceitos');
        return;
    }

    closeCartDrawer();
    document.getElementById('order-modal').classList.add('open');
    document.getElementById('order-error').classList.add('hidden');
    document.getElementById('order-success').classList.add('hidden');
}

function closeOrderModal() {
    document.getElementById('order-modal').classList.remove('open');
}

function showOrderError(message) {
    const errorEl = document.getElementById('order-error');
    const errorMsg = document.getElementById('order-error-msg');
    if (errorMsg) errorMsg.innerText = message;
    if (errorEl) errorEl.classList.remove('hidden');
}

// Phone Input Masking
const phoneInput = document.getElementById('order-phone');
if (phoneInput) {
    phoneInput.addEventListener('input', function (e) {
        // Remove non-digits
        let raw = e.target.value.replace(/\D/g, '');

        // Limit to 11 digits (DDD + 9 digits)
        if (raw.length > 11) raw = raw.slice(0, 11);

        let formatted = raw;

        if (raw.length > 2) {
            // (XX) ...
            formatted = `(${raw.slice(0, 2)}) ${raw.slice(2)}`;
        }

        if (raw.length > 7) {
            // (XX) XXXXX-XXXX
            formatted = `(${raw.slice(0, 2)}) ${raw.slice(2, 7)}-${raw.slice(7)}`;
        }

        e.target.value = formatted;
    });
}

async function submitOrder(e) {
    e.preventDefault();

    // Block if store is closed
    if (!state.storeOpen) {
        showOrderError('A loja está fechada para pedidos neste momento.');
        return;
    }

    const totalItems = state.cart.reduce((sum, item) => sum + item.quantity, 0);

    if (totalItems < CONFIG.minOrderItems) {
        showOrderError('Apenas pedidos acima de 10 peças serão aceitos');
        return;
    }

    // Phone Validation Logic for Security
    const phoneInputRaw = document.getElementById('order-phone');
    const phoneValue = phoneInputRaw.value.replace(/\D/g, ''); // Digits only

    // 1. Length Check (11 digits: 2 DDD + 9 Number)
    if (phoneValue.length !== 11) {
        showOrderError('Por favor, digite um número de celular válido com DDD.');
        return;
    }

    // 2. DDD Check (Valid DDDs are 11-99)
    const ddd = parseInt(phoneValue.substring(0, 2));
    if (ddd < 11 || ddd > 99) {
        showOrderError('O DDD informado é inválido.');
        return;
    }

    // 3. Mobile Check (Must start with 9 after DDD)
    // phoneValue[2] corresponds to the first digit of the number
    if (phoneValue[2] !== '9') {
        showOrderError('Por favor, informe um número de celular válido (começando com 9).');
        return;
    }

    // 4. Repetitive Digits Check (e.g. 99999-9999, 11111-1111)
    // Checks if all digits in the number part are the same
    const numberPart = phoneValue.substring(2);
    if (/^(\d)\1+$/.test(numberPart)) {
        showOrderError('Número de telefone inválido (dígitos repetidos).');
        return;
    }

    const submitBtn = document.getElementById('btn-submit-order');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';

    // Gather form data
    const orderData = {
        nome_completo: document.getElementById('order-name').value.trim(),
        telefone: document.getElementById('order-phone').value.trim(),
        cidade_estado: document.getElementById('order-city').value.trim(),
        excursao_transportadora: document.getElementById('order-transport').value.trim(),
        cores_nao_desejadas: document.getElementById('order-colors').value.trim(),
        observacoes: document.getElementById('order-observations').value.trim(),
        forma_pagamento: document.getElementById('order-payment').value,
        items: state.cart,
        total_items: totalItems,
        total_price: state.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0),
        created_at: new Date().toISOString()
    };

    try {
        // 1. Save to Supabase
        if (sbClient) {
            const { error } = await sbClient.from('orders').insert([orderData]);
            if (error) console.error('Supabase Error:', error);
        }

        // Order saved to Supabase - will appear in admin panel

        // Success
        document.getElementById('order-error').classList.add('hidden');
        document.getElementById('order-success').classList.remove('hidden');

        // Clear cart
        state.cart = [];
        saveCart();
        updateCartUI();

        // Reset form and close after delay
        setTimeout(() => {
            document.getElementById('order-form').reset();
            closeOrderModal();
            document.getElementById('order-success').classList.add('hidden');
        }, 2000);

    } catch (err) {
        console.error('Order Error:', err);
        showOrderError('Erro ao enviar pedido. Tente novamente.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar Pedido';
    }
}

// =====================================================
// STORE HOURS & SCHEDULE LOGIC
// =====================================================

let storeStatusInterval = null;
let countdownInterval = null;

async function initStoreStatus() {
    // Apply the schedule-based state synchronously (no network) so the
    // closed/countdown banners are part of the first paint — no layout shift.
    applyStoreStatusUI(state.emergencyClosed);
    await updateStoreUI();
    // Re-check every 60 seconds
    storeStatusInterval = setInterval(updateStoreUI, 60000);
}

async function updateStoreUI() {
    let emergencyClosed = false;

    // Check emergency flag from Supabase
    try {
        if (sbClient) {
            const { data, error } = await sbClient
                .from('store_settings')
                .select('emergency_closed')
                .limit(1)
                .single();

            if (!error && data) {
                emergencyClosed = data.emergency_closed === true;
            }
        }
    } catch (err) {
        console.warn('Could not check emergency status:', err);
    }

    applyStoreStatusUI(emergencyClosed);
}

function applyStoreStatusUI(emergencyClosed) {
    const status = getScheduleStatus();
    state.emergencyClosed = emergencyClosed;

    const closedBanner = document.getElementById('store-closed-banner');
    const closedMsg = document.getElementById('store-closed-msg');
    const countdownBanner = document.getElementById('store-countdown-banner');
    const countdownMsg = document.getElementById('store-countdown-msg');

    // Determine final store state
    const wasOpen = state.storeOpen;

    if (emergencyClosed) {
        // EMERGENCY CLOSED
        state.storeOpen = false;
        if (closedMsg) closedMsg.textContent = 'Não estamos aceitando pedidos neste momento. Volte mais tarde ou entre em contato com nosso atendimento pelo WhatsApp disponível nesta página.';
        if (closedBanner) closedBanner.classList.remove('hidden');
        if (countdownBanner) countdownBanner.classList.add('hidden');
        stopCountdown();
    } else if (!status.isOpen) {
        // SCHEDULE CLOSED
        state.storeOpen = false;
        if (closedMsg) closedMsg.textContent = 'Aceitamos pedidos de Segunda a Quinta-feira até as 11h da manhã. Se tiver qualquer dúvida sobre o seu pedido, entre em contato com nossa equipe de atendimento pelo WhatsApp disponível neste site.';
        if (closedBanner) closedBanner.classList.remove('hidden');
        if (countdownBanner) countdownBanner.classList.add('hidden');
        stopCountdown();
    } else {
        // OPEN
        state.storeOpen = true;
        if (closedBanner) closedBanner.classList.add('hidden');

        // Check countdown (within 5 hours of closing)
        if (status.hoursUntilClose !== null && status.hoursUntilClose <= 5) {
            if (countdownBanner) countdownBanner.classList.remove('hidden');
            startCountdown(status.closeTime);
        } else {
            if (countdownBanner) countdownBanner.classList.add('hidden');
            stopCountdown();
        }
    }

    // Re-render grid if state changed (skip if products haven't loaded yet —
    // the initial render will already use the correct open/closed state)
    if (wasOpen !== state.storeOpen && state.allProducts.length > 0) {
        renderGrid();

        // Close any open overlays that may have stale button states
        if (!state.storeOpen) {
            if (typeof closeVideoLightbox === 'function') closeVideoLightbox();
            if (typeof closeModal === 'function') closeModal();
            if (typeof closeSizeModal === 'function') closeSizeModal();
        }
    }

    // Update checkout button
    const checkoutBtn = document.getElementById('btn-checkout');
    if (checkoutBtn && !state.storeOpen) {
        checkoutBtn.disabled = true;
    }
}

function getScheduleStatus() {
    // Get current time in UTC-3 (America/Sao_Paulo)
    const now = new Date();
    const brTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));

    const day = brTime.getDay(); // 0=Sun, 1=Mon, ... 5=Fri, 6=Sat
    const hours = brTime.getHours();
    const minutes = brTime.getMinutes();
    const currentMinutes = hours * 60 + minutes;

    // Store is OPEN: Monday (1) 00:00 to Thursday (4) 11:00
    // Store is CLOSED: Thursday (4) 11:01 to Sunday (0) 23:59
    let isOpen = false;
    let hoursUntilClose = null;
    let closeTime = null;

    if (day >= 1 && day <= 3) {
        // Monday to Wednesday: fully open
        isOpen = true;

        // Calculate hours until Thursday 11:00 AM
        const daysUntilThursday = 4 - day;
        const minutesUntilClose = (daysUntilThursday * 24 * 60) + (11 * 60) - currentMinutes;
        hoursUntilClose = minutesUntilClose / 60;

        // Close time for countdown
        closeTime = new Date(brTime);
        closeTime.setDate(closeTime.getDate() + daysUntilThursday);
        closeTime.setHours(11, 0, 0, 0);
    } else if (day === 4) {
        // Thursday
        if (currentMinutes <= 660) { // 11:00 = 660 minutes
            isOpen = true;
            const minutesUntilClose = 660 - currentMinutes;
            hoursUntilClose = minutesUntilClose / 60;

            closeTime = new Date(brTime);
            closeTime.setHours(11, 0, 0, 0);
        } else {
            isOpen = false;
        }
    } else {
        // Friday (5), Saturday (6) or Sunday (0): closed
        isOpen = false;
    }

    return { isOpen, hoursUntilClose, closeTime };
}

function startCountdown(closeTime) {
    stopCountdown();
    updateCountdownDisplay(closeTime);
    countdownInterval = setInterval(() => updateCountdownDisplay(closeTime), 1000);
}

function stopCountdown() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
}

function updateCountdownDisplay(closeTime) {
    const now = new Date();
    const brNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const diff = closeTime - brNow;

    if (diff <= 0) {
        // Time's up — trigger a full re-check
        stopCountdown();
        updateStoreUI();
        return;
    }

    const totalMinutes = Math.floor(diff / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    const countdownMsg = document.getElementById('store-countdown-msg');
    if (countdownMsg) {
        if (hours > 0) {
            countdownMsg.textContent = `Faltam ${hours}h ${minutes}min para encerrar os pedidos da semana. Garanta já o seu!`;
        } else {
            countdownMsg.textContent = `Faltam ${minutes} minutos para encerrar os pedidos da semana. Garanta já o seu!`;
        }
    }
}
