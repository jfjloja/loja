
// --- configuration ---
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';
const WHATSAPP_NUMBER = '5511999999999';

// --- State ---
let allProducts = [];
let filteredProducts = [];
let filters = {
    search: '',
    category: 'all',
    size: 'all'
};
let supabase = null;

// --- Mock Data (Fallback) ---
const mockProducts = [
    {
        id: 1,
        name: 'Shorts com brilho lateral',
        price: 30.00,
        category: 'Pants',
        sizes: ['P', 'M'],
        image_url: 'https://images.unsplash.com/photo-1591195853828-11db59a44f6b?auto=format&fit=crop&w=800&q=80'
    },
    {
        id: 2,
        name: 'Shorts jeans com seta',
        price: 30.00,
        category: 'Pants',
        sizes: ['36', '38', '40'],
        image_url: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=800&q=80'
    },
    {
        id: 3,
        name: 'Saia MIDI sem laycra',
        price: 40.00,
        category: 'Dresses',
        sizes: ['M', 'G'],
        image_url: 'https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?auto=format&fit=crop&w=800&q=80'
    },
    {
        id: 4,
        name: 'Cropped preto sem brilho',
        price: 30.00,
        category: 'T-Shirts',
        sizes: ['U'],
        image_url: 'https://images.unsplash.com/photo-1503342394128-c104d54dba01?auto=format&fit=crop&w=800&q=80'
    },
    {
        id: 5,
        name: 'Jaqueta Jeans Cargo',
        price: 99.90,
        category: 'Jackets',
        sizes: ['P', 'M', 'G', 'GG'],
        image_url: 'https://images.unsplash.com/photo-1544642899-f0d6e5f6ed6f?auto=format&fit=crop&w=800&q=80'
    }
];

// --- DOM Elements ---
const gridEl = document.getElementById('product-grid');
const loadingEl = document.getElementById('loading');
const emptyStateEl = document.getElementById('empty-state');
const countEl = document.getElementById('result-count');

const searchInput = document.getElementById('search-input');
const categorySelect = document.getElementById('category-filter');
const sizeSelect = document.getElementById('size-filter');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("App initializing...");

    // Initialize Supabase
    try {
        if (typeof window.supabase !== 'undefined' && SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
            supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
            console.log("Supabase initialized");
        } else {
            console.warn("Supabase not configured or library missing. Using mock data.");
        }
    } catch (e) {
        console.error("Supabase init error:", e);
    }

    // Runs safely
    safeRun(initBanner, "Banner");
    fetchProducts(); // Async
    safeRun(setupEventListeners, "EventListeners");
});

function safeRun(fn, name) {
    try {
        fn();
    } catch (e) {
        console.error(`Error in ${name}:`, e);
    }
}

// --- Fetch Data ---
async function fetchProducts() {
    if (loadingEl) loadingEl.classList.remove('hidden');
    if (gridEl) gridEl.innerHTML = '';

    let data = [];
    let useMock = true;

    if (supabase) {
        try {
            const { data: items, error } = await supabase
                .from('store_items')
                .select('*')
                .order('created_at', { ascending: false });

            if (!error && items && items.length > 0) {
                data = items;
                useMock = false;
            } else if (error) {
                console.error("Supabase fetch error:", error);
            }
        } catch (e) {
            console.error("Network/Supabase error:", e);
        }
    }

    if (useMock) {
        console.log("Loading mock data...");
        // Simulate network delay for effect (optional, removed for speed)
        data = mockProducts;
    }

    allProducts = data || [];
    applyFilters();

    // Ensure loading spinner is hidden
    if (loadingEl) loadingEl.classList.add('hidden');
}

// --- Filtering ---
function setupEventListeners() {
    if (searchInput) searchInput.addEventListener('input', (e) => {
        filters.search = e.target.value.toLowerCase();
        applyFilters();
    });

    if (categorySelect) categorySelect.addEventListener('change', (e) => {
        filters.category = e.target.value;
        applyFilters();
    });

    if (sizeSelect) sizeSelect.addEventListener('change', (e) => {
        filters.size = e.target.value;
        applyFilters();
    });
}

function applyFilters() {
    try {
        filteredProducts = allProducts.filter(item => {
            const matchesName = item.name ? item.name.toLowerCase().includes(filters.search) : false;
            const matchesCategory = filters.category === 'all' || item.category === filters.category;
            const matchesSize = filters.size === 'all' || (item.sizes && item.sizes.includes(filters.size));
            return matchesName && matchesCategory && matchesSize;
        });

        renderProducts();
    } catch (e) {
        console.error("Filter error:", e);
    }
}

// --- Rendering ---
function renderProducts() {
    if (!gridEl) return;
    gridEl.innerHTML = '';

    if (countEl) countEl.textContent = `${filteredProducts.length} itens encontrados`;

    if (filteredProducts.length === 0) {
        if (emptyStateEl) emptyStateEl.classList.remove('hidden');
        return;
    } else {
        if (emptyStateEl) emptyStateEl.classList.add('hidden');
    }

    filteredProducts.forEach(product => {
        const card = document.createElement('div');
        card.className = 'card';

        const price = typeof product.price === 'number'
            ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(product.price)
            : product.price;

        const sizesHtml = Array.isArray(product.sizes)
            ? product.sizes.map(s => `<span class="size-badge">${s}</span>`).join('')
            : '';

        const message = `Olá! Tenho interesse no item: ${product.name}. Ele ainda está disponível?`;
        const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

        // Safe image handling
        const imageUrl = product.image_url || 'https://via.placeholder.com/400x500?text=No+Image';

        card.innerHTML = `
            <div class="card-image-wrapper">
                <img src="${imageUrl}" alt="${product.name}" class="card-image" loading="lazy">
            </div>
            <div class="card-content">
                <div class="card-category">${product.category || 'Geral'}</div>
                <h3 class="card-title">${product.name || 'Produto sem nome'}</h3>
                <div class="card-price">${price}</div>
                <div class="card-sizes">${sizesHtml}</div>
                <a href="${whatsappUrl}" target="_blank" class="btn-whatsapp">
                    <i class="fa-brands fa-whatsapp"></i> Comprar
                </a>
            </div>
        `;

        gridEl.appendChild(card);
    });
}

// --- Banner Logic ---
function initBanner() {
    const slides = document.querySelectorAll('.slide');
    const dots = document.querySelectorAll('.dot');
    let currentSlide = 0;

    // Safety check
    if (!slides || slides.length === 0) {
        console.warn("No slides found");
        return;
    }

    function showSlide(index) {
        // Ensure index is valid
        if (index < 0 || index >= slides.length) return;

        slides.forEach(s => s.classList.remove('active'));
        if (dots) dots.forEach(d => d.classList.remove('active'));

        if (slides[index]) slides[index].classList.add('active');
        if (dots && dots[index]) dots[index].classList.add('active');
    }

    function nextSlide() {
        currentSlide = (currentSlide + 1) % slides.length;
        showSlide(currentSlide);
    }

    // Start
    const intervalId = setInterval(nextSlide, 4000);
    showSlide(0);
}
