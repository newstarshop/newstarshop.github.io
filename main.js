import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

/* ===================================================================
   1. إعدادات قاعدة البيانات (Supabase)
   حط الرابط والـ Key بتوع مشروعك هنا (نفس اللي في الكاشير)
=================================================================== */
const SUPABASE_URL = 'https://pdukovqsxmbsdflhrwsz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Al4sIi3PI3X9rdjFLTxZWA_P7Blpd85';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let PRODUCTS = []; // المنتجات هتيجي من الداتابيز وتتحط هنا
let currentPage = 0;
let isLoadingMore = false;
let hasMoreProducts = true;
let currentSearchQuery = ''; // <-- أضف هذا المتغير الجديد
/* ===================================================================
   2. إدارة السلة (Cart)
=================================================================== */
const CART_KEY = 'masbah_cart_v1';

function loadCart(){
  try{
    const raw = localStorage.getItem(CART_KEY);
    if(!raw) return [];
    const parsed = JSON.parse(raw);
    if(!Array.isArray(parsed)) return [];
    // هنرجع البيانات زي ما هي لأننا بقينا نحفظ الـ product كامل جواها
    return parsed;
  }catch(e){ return []; }
}

function saveCart(cart){
  try{
    // تم التعديل: نحفظ فقط البيانات الأساسية لمنع امتلاء الذاكرة (LocalStorage) ولتجنب حفظ أسعار/بيانات قديمة
    const serializable = cart.map(({ id, color, size, qty }) => ({ id, color, size, qty }));
    localStorage.setItem(CART_KEY, JSON.stringify(serializable));
  }catch(e){ console.error('Cart Save Error:', e); }
}

// --- دوال حفظ واسترجاع المفضلة (Wishlist) ---
const WISHLIST_KEY = 'masbah_wishlist_v1';

function loadWishlist(){
  try { return JSON.parse(localStorage.getItem(WISHLIST_KEY)) || []; }
  catch(e) { return []; }
}

function saveWishlist(list){
  try { localStorage.setItem(WISHLIST_KEY, JSON.stringify(list)); }
  catch(e) { console.error('Wishlist Save Error:', e); }
}

const state = new Proxy({
  lang: 'en',
  cart: [],
  filters: { cats: [], genders: [], priceMin: 0, priceMax: 10000, sort: 'featured' },
  activeProduct: null,
  qvColorIdx: 0, qvSizeIdx: 0, qvQty: 1, qvImgIdx: 0,
  wishlist: loadWishlist() // جلب المفضلة المحفوظة عند فتح الموقع
}, {
  set(target, key, value){
    target[key] = value;
    if(key === 'cart'){ saveCart(value); renderCart(); updateCartBadge(); }
    if(key === 'wishlist'){ saveWishlist(value); } // حفظ تلقائي عند أي تغيير
    return true;
  }
});

/* ===================================================================
   3. الترجمة والتفاعل (UI Logic)
=================================================================== */
function t(){
  const lang = state.lang;
  document.querySelectorAll('[data-en]').forEach(node => {
    const val = node.getAttribute(lang === 'ar' ? 'data-ar' : 'data-en');
    if(val !== null) node.textContent = val;
  });
  document.querySelectorAll('[data-ph-en]').forEach(node => {
    const val = node.getAttribute(lang === 'ar' ? 'data-ph-ar' : 'data-ph-en');
    if(val !== null) node.setAttribute('placeholder', val);
  });
}

function applyLanguage(lang){
  state.lang = lang;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('data-lang', lang);
  t();
  updateRangeUI(); // <--- السطر الجديد اللي ضفناه هنا
  renderGrid();
  if(state.activeProduct) renderQuickView(state.activeProduct);
  renderCart();
}


const header = document.getElementById('siteHeader');
function onScroll(){
  if(window.scrollY > 40) header.classList.add('solid');
  else header.classList.remove('solid');
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

function toggleLang(){ applyLanguage(state.lang === 'en' ? 'ar' : 'en'); }
document.getElementById('langToggle').addEventListener('click', toggleLang);
document.getElementById('langToggleMobile').addEventListener('click', toggleLang);

const cursorDot = document.getElementById('cursorDot');
if(window.matchMedia('(hover: hover) and (pointer: fine)').matches){
  window.addEventListener('mousemove', e => {
    cursorDot.style.left = e.clientX + 'px';
    cursorDot.style.top = e.clientY + 'px';
  });
  document.querySelectorAll('a, button').forEach(el => {
    el.addEventListener('mouseenter', () => cursorDot.classList.add('hover-big'));
    el.addEventListener('mouseleave', () => cursorDot.classList.remove('hover-big'));
  });
}

const magBtn = document.getElementById('heroCta');
magBtn.addEventListener('mousemove', e => {
  const r = magBtn.getBoundingClientRect();
  const x = (e.clientX - r.left - r.width/2) * 0.2;
  const y = (e.clientY - r.top - r.height/2) * 0.3;
  magBtn.style.transform = `translate(${x}px, ${y}px)`;
});
magBtn.addEventListener('mouseleave', () => { magBtn.style.transform = 'translate(0,0)'; });
magBtn.addEventListener('click', () => document.getElementById('shop').scrollIntoView({ behavior: 'smooth' }));

const searchOverlay = document.getElementById('searchOverlay');
document.getElementById('searchTrigger').addEventListener('click', () => {
  searchOverlay.classList.add('open');
  setTimeout(() => document.getElementById('searchInput').focus(), 300);
});
document.getElementById('searchClose').addEventListener('click', () => searchOverlay.classList.remove('open'));
searchOverlay.addEventListener('click', e => { if(e.target === searchOverlay) searchOverlay.classList.remove('open'); });

let searchTimeout;
let searchController = null; // ضفنا الكنترولر عشان نوقف أي ريكويست قديم

document.getElementById('searchInput').addEventListener('input', e => {
  currentSearchQuery = e.target.value.trim();
  clearTimeout(searchTimeout);

  if(!currentSearchQuery){
    if (searchController) { searchController.abort(); searchController = null; }
    hasMoreProducts = true; 
    loadStoreProducts(0, false); 
    return;
  }

  searchTimeout = setTimeout(() => {
    // نطلب من دالة التحميل الأساسية جلب الصفحة 0 (وستقوم هي بتطبيق كلمة البحث والفلاتر معاً)
    loadStoreProducts(0, false);
  }, 400);
});


const navDrawer = document.getElementById('navDrawer');
const navOverlay = document.getElementById('navOverlay');
function openNav(){ navDrawer.classList.add('open'); navOverlay.classList.add('open'); }
function closeNav(){ navDrawer.classList.remove('open'); navOverlay.classList.remove('open'); }
document.getElementById('menuTrigger').addEventListener('click', openNav);
document.getElementById('navClose').addEventListener('click', closeNav);
navOverlay.addEventListener('click', closeNav);
document.querySelectorAll('[data-navlink]').forEach(a => a.addEventListener('click', closeNav));

const filterDrawer = document.getElementById('filterDrawer');
const filterOverlay = document.getElementById('filterOverlay');
function openFilterDrawer(){ filterDrawer.classList.add('open'); filterOverlay.classList.add('open'); }
function closeFilterDrawer(){ filterDrawer.classList.remove('open'); filterOverlay.classList.remove('open'); }
document.getElementById('filterTrigger').addEventListener('click', openFilterDrawer);
document.getElementById('filterClose').addEventListener('click', closeFilterDrawer);
filterOverlay.addEventListener('click', closeFilterDrawer);

const rangeMin = document.getElementById('rangeMin');
const rangeMax = document.getElementById('rangeMax');
const rangeFill = document.getElementById('rangeFill');

function updateRangeUI(){
  let min = parseInt(rangeMin.value), max = parseInt(rangeMax.value);
  
  if (min > max) { 
    [min, max] = [max, min]; 
    rangeMin.value = min; 
    rangeMax.value = max; 
  } 
  
  const bounds = { min: 0, max: 10000 };
  const pctMin = ((min - bounds.min) / (bounds.max - bounds.min)) * 100;
  const pctMax = ((max - bounds.min) / (bounds.max - bounds.min)) * 100;

  // تم التعديل بناءً على تقرير QA: توحيد حسابات التعبئة للعمل بدقة مع اللغتين
  if (state.lang === 'ar') {
    rangeFill.style.right = pctMin + '%';
    rangeFill.style.width = (pctMax - pctMin) + '%';
    rangeFill.style.left = 'auto';
  } else {
    rangeFill.style.left = pctMin + '%';
    rangeFill.style.width = (pctMax - pctMin) + '%';
    rangeFill.style.right = 'auto';
  }

  document.getElementById('priceMin').textContent = min + ' EGP';
  document.getElementById('priceMax').textContent = max + ' EGP';
  state.filters.priceMin = min;
  state.filters.priceMax = max;
}


rangeMin.addEventListener('input', updateRangeUI);
rangeMax.addEventListener('input', updateRangeUI);
updateRangeUI();

document.querySelectorAll('.catFilter').forEach(box => {
  box.addEventListener('change', () => {
    // بنجمع كل القيم اللي مفصولة بفاصلة ونحولها لمصفوفة واحدة مسطحة
    const selectedVals = Array.from(document.querySelectorAll('.catFilter:checked')).map(b => b.value);
    state.filters.cats = selectedVals.flatMap(v => v.split(',')); 
  });
});

document.querySelectorAll('.genderFilter').forEach(box => {
  box.addEventListener('change', () => {
    state.filters.genders = Array.from(document.querySelectorAll('.genderFilter:checked')).map(b => b.value);
  });
});

document.querySelectorAll('input[name="sort"]').forEach(radio => {
  radio.addEventListener('change', () => { state.filters.sort = radio.value; });
});
document.getElementById('applyFilters').addEventListener('click', () => { 
  loadStoreProducts(0, false); // بيطلب المنتجات متفلترة من صفحة صفر بـ Limit 20
  closeFilterDrawer(); 
});

document.getElementById('clearFilters').addEventListener('click', () => {
  // 1. تنظيف كل علامات الصح من الفلاتر
  document.querySelectorAll('.catFilter').forEach(b => b.checked = false);
  document.querySelectorAll('.genderFilter').forEach(b => b.checked = false); 
  
  // 2. إرجاع الترتيب للوضع الافتراضي
  document.querySelector('input[name="sort"][value="featured"]').checked = true;
  
  // 3. تصفير شريط السعر
  rangeMin.value = 0; rangeMax.value = 10000;
  updateRangeUI();
  
  // 4. تفريغ الـ State بالكامل
  state.filters = { cats: [], genders: [], priceMin: 0, priceMax: 10000, sort: 'featured' };
  
  // 5. استدعاء المنتجات الجديدة بناءً على الفلاتر الفاضية
  loadStoreProducts(0, false); 
});

const productGrid = document.getElementById('productGrid');
const resultCount = document.getElementById('resultCount');

function getFilteredProducts(){
  let list = PRODUCTS.filter(p => {
    const inCat = state.filters.cats.length === 0 || state.filters.cats.includes(p.cat);
    const inGender = state.filters.genders.length === 0 || state.filters.genders.includes(p.gender); // سطر جديد
    const inPrice = p.price >= state.filters.priceMin && p.price <= state.filters.priceMax;
    return inCat && inGender && inPrice; // ضفنا inGender للشرط
  });
  if(state.filters.sort === 'price-asc') list = list.slice().sort((a,b) => a.price - b.price);
  if(state.filters.sort === 'price-desc') list = list.slice().sort((a,b) => b.price - a.price);
  return list;
}


function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function renderGrid(customList, isAppend = false){
  const lang = state.lang;
  const list = customList || getFilteredProducts();
  
  // تظبيط العداد بتاع المنتجات
  const currentCount = isAppend ? document.querySelectorAll('.product-card').length : 0;
  const totalCount = currentCount + list.length;
  resultCount.textContent = lang === 'ar' ? `${totalCount} قطعة` : `${totalCount} piece${totalCount === 1 ? '' : 's'}`;

  const htmlString = list.map((p, i) => {
    const oos = !!p.outOfStock;
    const badge = oos
      ? `<span class="card-badge oos">${lang==='ar' ? 'نفذت الكمية' : 'Sold Out'}</span>`
      : (p.tag ? `<span class="card-badge ${p.tag.en === 'Sale' ? 'sale' : ''}">${p.tag[lang]}</span>` : '');
    return `
    <article class="product-card ${oos ? 'is-oos' : ''}" data-id="${p.id}" style="animation-delay:${i * 0.07}s">
      <div class="card-media">
        ${badge}
        <button class="card-wish ${state.wishlist.includes(p.id) ? 'active' : ''}" data-wish="${p.id}" aria-label="Wishlist">${state.wishlist.includes(p.id) ? '♥' : '♡'}</button>
        <img class="card-media-img" src="${p.images[0]}" alt="${escapeHtml(p.name[lang])}" loading="lazy">
        ${oos ? '' : `
        <div class="card-reveal">
          <span class="reveal-row-label">${lang === 'ar' ? 'اللون' : 'Color'}</span>
          <div class="reveal-swatches">
            ${p.colors.map(c => `<span class="reveal-swatch" style="background:${escapeHtml(c.hex)}" title="${escapeHtml(c.name[lang])}"></span>`).join('')}
          </div>
          <span class="reveal-row-label">${lang === 'ar' ? 'المقاس' : 'Size'}</span>
          <div class="reveal-sizes">
            ${p.sizes.slice(0,5).map(s => `<span class="reveal-size">${escapeHtml(s)}</span>`).join('')}
          </div>
          <button class="reveal-add-btn" data-quickadd="${p.id}">
            <span>${lang === 'ar' ? 'أضف إلى الحقيبة' : 'Add to Bag'}</span>
          </button>
        </div>`}
      </div>
      <div class="card-info">
        <div>
          <span class="card-cat">${escapeHtml(p.catLabel[lang])}</span>
          <h3 class="card-name">${escapeHtml(p.name[lang])}</h3>
        </div>
        <div class="card-price-wrap">
          ${p.original ? `<span class="card-price-original">${p.original} EGP</span>` : ''}
          <span class="card-price">${p.price} EGP</span>
        </div>
      </div>
    </article>`;
  }).join('');

  // لو append بنضيفهم تحت القدام، لو لأ بنمسح ونرسم جديد
  if (isAppend) {
    productGrid.insertAdjacentHTML('beforeend', htmlString);
  } else {
    productGrid.innerHTML = htmlString;
  }
}

// =========================================================
// التعديل هنا: Event Delegation مجمع خارج الدالة عشان ميحصلش تكرار ونهلك الرامات
// =========================================================
document.getElementById('productGrid').addEventListener('click', e => {
  // 1. نبحث هل تم الضغط على زر المفضلة
  const wishBtn = e.target.closest('[data-wish]');
  if (wishBtn) {
    e.stopPropagation();
    const id = wishBtn.dataset.wish;
    
    if(state.wishlist.includes(id)) {
      state.wishlist = state.wishlist.filter(wId => wId !== id); 
    } else {
      state.wishlist = [...state.wishlist, id]; 
    }
    
    document.querySelectorAll(`[data-wish="${id}"]`).forEach(btn => {
      btn.classList.toggle('active', state.wishlist.includes(id));
      btn.textContent = state.wishlist.includes(id) ? '♥' : '♡';
    });
    return;
  }

  // 2. نبحث هل تم الضغط على زر الإضافة السريعة للسلة
  const quickAddBtn = e.target.closest('[data-quickadd]');
  if (quickAddBtn) {
    e.stopPropagation();
    const id = quickAddBtn.dataset.quickadd;
    const product = PRODUCTS.find(p => p.id === id);
    if(product) {
      addToCart(product, product.colors[0], product.sizes[0], 1);
      // مسحنا الـ Toast من هنا لأن دالة addToCart بتظهره تلقائياً
    }
    return;
  }

  // 3. لو الضغطة على كارت المنتج نفسه (عشان نفتح الـ Quick View)
  const card = e.target.closest('.product-card');
  if (card) {
    openQuickView(card.dataset.id);
  }
});


const qvOverlay = document.getElementById('qvOverlay');
const quickview = document.getElementById('quickview');
function openQuickView(id){
  state.activeProduct = id;
  state.qvColorIdx = 0; state.qvSizeIdx = 0; state.qvQty = 1; state.qvImgIdx = 0;
  renderQuickView(id);
  quickview.classList.add('open');
  qvOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeQuickView(){
  quickview.classList.remove('open');
  qvOverlay.classList.remove('open');
  document.body.style.overflow = '';
}
document.getElementById('qvClose').addEventListener('click', closeQuickView);
qvOverlay.addEventListener('click', closeQuickView);

function renderQuickView(id){
  const p = PRODUCTS.find(x => x.id === id);
  if(!p) return;
  const lang = state.lang;
  const productOos = !!p.outOfStock;

  document.getElementById('qvMainImg').src = p.images[state.qvImgIdx];
  document.getElementById('qvMainImg').alt = p.name[lang];
  const tagEl = document.getElementById('qvTag');
  if(productOos){
    tagEl.style.display = 'block';
    tagEl.textContent = lang === 'ar' ? 'نفدت الكمية' : 'Sold Out';
  } else if(p.tag){
    tagEl.style.display = 'block';
    tagEl.textContent = p.tag[lang];
  } else {
    tagEl.style.display = 'none';
  }

  document.getElementById('qvCategory').textContent = p.catLabel[lang];
  document.getElementById('qvName').textContent = p.name[lang];
  document.getElementById('qvDesc').textContent = p.desc[lang];
  document.getElementById('qvPrice').textContent = p.price + ' EGP';
  document.getElementById('qvOriginal').textContent = p.original ? p.original + ' EGP' : '';

  document.getElementById('qvThumbs').innerHTML = p.images.map((src, i) =>
    `<div class="qv-thumb ${i === state.qvImgIdx ? 'active' : ''}" data-thumb="${i}"><img src="${src}" alt=""></div>`
  ).join('');
  document.querySelectorAll('.qv-thumb').forEach(th => {
    th.addEventListener('click', () => {
      state.qvImgIdx = parseInt(th.dataset.thumb);
      renderQuickView(id);
    });
  });

  // --- السحر الهندسي يبدأ هنا ---
  const selectedColor = p.colors[state.qvColorIdx];
  const targetColorName = selectedColor.name.ar || selectedColor.name.en;
  const selectedSize = p.sizes[state.qvSizeIdx];

  // فحص المخزون للون والمقاس المحددين حالياً (عشان زرار الإضافة)
  const currentVariant = p.variants?.find(v => v.color === targetColorName && v.size === selectedSize);
  const currentVariantStock = currentVariant?.inventory?.reduce((sum, inv) => sum + (inv.quantity || 0), 0) || 0;
  const isVariantOos = currentVariantStock <= 0;

  document.getElementById('qvColorName').textContent = selectedColor.name[lang];
  
  // 1. رسم الألوان (مع فحص إذا كان اللون منتهي من كل المقاسات)
  document.getElementById('qvColors').innerHTML = p.colors.map((c, i) => {
    const cName = c.name.ar || c.name.en;
    const colorVariants = p.variants?.filter(v => v.color === cName) || [];
    const totalColorStock = colorVariants.reduce((sum, v) => sum + (v.inventory?.reduce((s, inv) => s + (inv.quantity || 0), 0) || 0), 0);
    const isColorCompletelyOos = totalColorStock <= 0;

    return `<span class="qv-swatch ${i === state.qvColorIdx ? 'active' : ''} ${isColorCompletelyOos ? 'disabled-variant' : ''}" style="background:${escapeHtml(c.hex)}" data-coloridx="${i}" title="${escapeHtml(c.name[lang])}"></span>`
  }).join('');

  document.querySelectorAll('[data-coloridx]').forEach(sw => {
    sw.addEventListener('click', () => { 
      if(sw.classList.contains('disabled-variant')) return; // حماية إضافية من الجافاسكريبت
      state.qvColorIdx = parseInt(sw.dataset.coloridx); 
      state.qvQty = 1; 
      renderQuickView(id); 
    });
  });

  // 2. رسم المقاسات (مع فحص المخزون بناءً على اللون المحدد حالياً)
  document.getElementById('qvSizes').innerHTML = p.sizes.map((s, i) => {
    const variantToCheck = p.variants?.find(v => v.color === targetColorName && v.size === s);
    const stock = variantToCheck?.inventory?.reduce((sum, inv) => sum + (inv.quantity || 0), 0) || 0;
    const isSizeOos = stock <= 0;
    
    return `<span class="qv-size-btn ${i === state.qvSizeIdx ? 'active' : ''} ${isSizeOos ? 'disabled-variant' : ''}" data-sizeidx="${i}">${escapeHtml(s)}</span>`
  }).join('');

  document.querySelectorAll('[data-sizeidx]').forEach(sz => {
    sz.addEventListener('click', () => { 
      if(sz.classList.contains('disabled-variant')) return; // حماية إضافية
      state.qvSizeIdx = parseInt(sz.dataset.sizeidx); 
      state.qvQty = 1; 
      renderQuickView(id); 
    });
  });

  document.getElementById('qtyVal').textContent = state.qvQty;
  document.getElementById('qvAddCartPrice').textContent = (p.price * state.qvQty) + ' EGP';

  // 3. تأمين زرار الإضافة للحقيبة
  const addBtn = document.getElementById('qvAddCart');
  const addText = addBtn.querySelector('.add-cart-text');
  
  if(productOos){
    addBtn.disabled = true;
    addText.textContent = lang === 'ar' ? 'نفدت الكمية' : 'Sold Out';
  } else if (isVariantOos) {
    // لو اللون متاح بس المقاس ده تحديداً خلصان
    addBtn.disabled = true;
    addText.textContent = lang === 'ar' ? 'المقاس غير متاح بهذا اللون' : 'Size Unavailable in Color';
  } else {
    addBtn.disabled = false;
    addText.textContent = lang === 'ar' ? 'أضف إلى الحقيبة' : 'Add to Bag';
  }

  document.getElementById('qvPrev').onclick = () => { state.qvImgIdx = (state.qvImgIdx - 1 + p.images.length) % p.images.length; renderQuickView(id); };
  document.getElementById('qvNext').onclick = () => { state.qvImgIdx = (state.qvImgIdx + 1) % p.images.length; renderQuickView(id); };
}

document.getElementById('qtyMinus').addEventListener('click', () => { 
  if(state.qvQty > 1){ state.qvQty--; renderQuickView(state.activeProduct); } 
});

document.getElementById('qtyPlus').addEventListener('click', () => { 
  const p = PRODUCTS.find(x => x.id === state.activeProduct);
  if(!p) return;
  
  // جلب المخزن للون والمقاس المحددين حالياً
  const color = p.colors[state.qvColorIdx];
  const size = p.sizes[state.qvSizeIdx];
  const targetColor = color.name.ar || color.name.en;
  
  const matchedVariant = p.variants?.find(v => v.color === targetColor && v.size === size);
  const availableStock = matchedVariant?.inventory?.reduce((sum, inv) => sum + (inv.quantity || 0), 0) || 0;
  
  // جلب الكمية المضافة مسبقاً في السلة لخصمها من المتاح
  const existing = state.cart.find(item => item.id === p.id && item.color.hex === color.hex && item.size === size);
  const cartQty = existing ? existing.qty : 0;
  
  // السماح بالزيادة فقط إذا كانت الكمية لم تتجاوز المخزن
  if (state.qvQty + cartQty < availableStock) {
    state.qvQty++; 
    renderQuickView(state.activeProduct); 
  } else {
    showToast(state.lang === 'ar' ? `أقصى كمية متاحة هي ${availableStock} قطعة.` : `Maximum available quantity is ${availableStock}.`);
  }
});

document.getElementById('qvAddCart').addEventListener('click', () => {
  const p = PRODUCTS.find(x => x.id === state.activeProduct);
  if(!p || p.outOfStock) return;
  
  const success = addToCart(p, p.colors[state.qvColorIdx], p.sizes[state.qvSizeIdx], state.qvQty);
  
  // لو الإضافة تمت فعلاً بناءً على المخزن، اقفل النافذة وافتح السلة
  if (success) {
    closeQuickView();
    openCartDrawer();
  }
});

function addToCart(product, color, size, qty) {
  const targetColor = color.name.ar || color.name.en;
  const matchedVariant = product.variants?.find(v => v.color === targetColor && v.size === size);
  const availableStock = matchedVariant?.inventory?.reduce((sum, inv) => sum + (inv.quantity || 0), 0) || 0;
  
  if (availableStock <= 0) {
    showToast(state.lang === 'ar' ? 'عفواً، الكمية نفدت من هذا المقاس واللون.' : 'Sorry, this size and color is out of stock.');
    return false; // فشل
  }

  const existing = state.cart.find(item => item.id === product.id && item.color.hex === color.hex && item.size === size);
  let currentCartQty = existing ? existing.qty : 0;
  
  if (currentCartQty + qty > availableStock) {
    showToast(state.lang === 'ar' ? `أقصى كمية متاحة هي ${availableStock} قطعة.` : `Maximum available quantity is ${availableStock}.`);
    return false; // فشل
  }

  let newCart;
  if(existing){
    newCart = state.cart.map(item => item === existing ? { ...item, qty: item.qty + qty } : item);
  } else {
    newCart = [...state.cart, { id: product.id, color, size, qty, product }];
  }
  state.cart = newCart;
  
  // إظهار رسالة النجاح من هنا فقط
  showToast(state.lang === 'ar' ? `أُضيف ${product.name.ar} إلى الحقيبة` : `${product.name.en} added to bag`);
  return true; // نجاح
}


function changeQty(idx, delta) {
  const item = state.cart[idx];
  
  // نجيب المخزون وقت تعديل الكمية من جوه السلة
  const targetColor = item.color.name.ar || item.color.name.en;
  const matchedVariant = item.product.variants?.find(v => v.color === targetColor && v.size === item.size);
  const availableStock = matchedVariant?.inventory?.reduce((sum, inv) => sum + (inv.quantity || 0), 0) || 0;

  const newQty = Math.max(1, item.qty + delta);
  
  if (newQty > availableStock) {
    showToast(state.lang === 'ar' ? `أقصى كمية متاحة هي ${availableStock} قطعة.` : `Maximum available quantity is ${availableStock}.`);
    return;
  }

  state.cart = state.cart.map((cartItem, i) => i !== idx ? cartItem : { ...cartItem, qty: newQty });
}

function removeFromCart(idx){ state.cart = state.cart.filter((_, i) => i !== idx); }


function updateCartBadge(){
  const count = state.cart.reduce((s, item) => s + item.qty, 0);
  const badge = document.getElementById('cartBadge');
  badge.textContent = count;
  badge.classList.toggle('show', count > 0);
}
function renderCart(){
  const lang = state.lang;
  const cartItems = document.getElementById('cartItems');
  const cartEmpty = document.getElementById('cartEmpty');
  const cartFoot = document.getElementById('cartFoot');

  if(state.cart.length === 0){
    cartItems.style.display = 'none';
    cartEmpty.style.display = 'flex';
    cartFoot.style.display = 'none';
    return;
  }
  cartItems.style.display = 'block';
  cartEmpty.style.display = 'none';
  cartFoot.style.display = 'block';

  cartItems.innerHTML = state.cart.map((item, idx) => `
    <div class="cart-item">
      <div class="cart-item-img"><img src="${item.product.images[0]}" alt="${escapeHtml(item.product.name[lang])}"></div>
      <div>
        <p class="cart-item-name">${escapeHtml(item.product.name[lang])}</p>
        <p class="cart-item-meta">${escapeHtml(item.color.name[lang])} · ${escapeHtml(item.size)}</p>
        <div class="cart-item-qty">
          <button data-qtyminus="${idx}">−</button>
          <span>${item.qty}</span>
          <button data-qtyplus="${idx}">+</button>
        </div>
      </div>
      <div>
        <p class="cart-item-price">${item.product.price * item.qty} EGP</p>
        <button class="cart-item-remove" data-remove="${idx}">${lang === 'ar' ? 'إزالة' : 'Remove'}</button>
      </div>
    </div>
  `).join('');

  document.getElementById('cartSubtotal').textContent = '$' + state.cart.reduce((s, item) => s + item.product.price * item.qty, 0);

  cartItems.querySelectorAll('[data-qtyminus]').forEach(btn => btn.addEventListener('click', () => changeQty(parseInt(btn.dataset.qtyminus), -1)));
  cartItems.querySelectorAll('[data-qtyplus]').forEach(btn => btn.addEventListener('click', () => changeQty(parseInt(btn.dataset.qtyplus), 1)));
  cartItems.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => removeFromCart(parseInt(btn.dataset.remove))));
}

const cartDrawer = document.getElementById('cartDrawer');
const cartOverlay = document.getElementById('cartOverlay');
function openCartDrawer(){ cartDrawer.classList.add('open'); cartOverlay.classList.add('open'); }
function closeCartDrawer(){ cartDrawer.classList.remove('open'); cartOverlay.classList.remove('open'); }
document.getElementById('cartTrigger').addEventListener('click', openCartDrawer);
document.getElementById('cartClose').addEventListener('click', closeCartDrawer);
cartOverlay.addEventListener('click', closeCartDrawer);

let toastTimer;
function showToast(msg){
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

document.addEventListener('keydown', e => {
  if(e.key === 'Escape'){
    closeQuickView(); closeFilterDrawer(); closeCartDrawer(); closeNav();
    searchOverlay.classList.remove('open');
  }
});

/* ===================================================================
   4. دالة السحب من قاعدة البيانات الحقيقية
=================================================================== */
// 1. دالة مساعدة لتحويل شكل بيانات سوبابيز لشكل الكروت في موقعك
function formatSupabaseProducts(dbProducts) {
  return dbProducts.map(p => {
    const activeVariants = p.product_variants?.filter(v => v.is_active) || [];
    const colorsMap = new Map();
    const sizesSet = new Set();
    let minPrice = Infinity;
    let totalStock = 0;

    activeVariants.forEach(v => {
      // 🔥 التعديل هنا: استخدام v.color_en لو موجود، ولو مش موجود نستخدم الأساسي
      if (v.color) colorsMap.set(v.color, { name: { en: v.color_en || v.color, ar: v.color }, hex: v.color_hex || '#1a1a1a' });
      if (v.size) sizesSet.add(v.size);
      if (v.selling_price < minPrice) minPrice = v.selling_price;
      totalStock += v.inventory?.reduce((sum, inv) => sum + (inv.quantity || 0), 0) || 0;
    });

    let images = [];
    if (p.image_paths && p.image_paths.length > 0) {
      images = p.image_paths.map(path => supabase.storage.from('product_images').getPublicUrl(path).data.publicUrl);
    } else if (p.image_path) {
      images = [supabase.storage.from('product_images').getPublicUrl(p.image_path).data.publicUrl];
    } else {
      images = ['https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=900&auto=format&fit=crop'];
    }

    // === الكود الجديد لحساب تاريخ المنتج ===
    const createdDate = p.created_at ? new Date(p.created_at) : new Date(0);
    const diffDays = Math.ceil(Math.abs(new Date() - createdDate) / (1000 * 60 * 60 * 24));
    const isNew = diffDays <= 7; // المنتجات اللي عمرها 7 أيام أو أقل
    // ===================================
    
    return {
      id: p.id,
      gender: p.gender_department || 'unisex', 
      cat: p.category || 'others',
      catLabel: { en: p.category || 'Collection', ar: p.category || 'التشكيلة' },
      name: { en: p.name || p.name_ar, ar: p.name_ar || p.name },
      desc: { 
        en: p.description || 'Premium quality crafted with care.', 
        ar: p.description_ar || 'جودة استثنائية، صُممت بعناية فائقة لتدوم.' 
      },
      price: minPrice === Infinity ? 0 : minPrice,
      original: null,
      colors: colorsMap.size > 0 ? Array.from(colorsMap.values()) : [{ name: { en:'Standard', ar:'أساسي' }, hex:'#1a1a1a' }],
      sizes: sizesSet.size > 0 ? Array.from(sizesSet) : ['One Size'],
      images: images,
      outOfStock: totalStock <= 0,
      
      // السطر ده هو اللي اتعدل عشان يقرأ من الحسبة اللي فوق
      tag: totalStock <= 0 ? null : (isNew ? { en: 'New', ar: 'جديد' } : null),
      
      variants: activeVariants
    };
  });
}

// 2. الدالة الأساسية لجلب المنتجات من الباك إند بالتدريج (Pagination + Filtering)
async function loadStoreProducts(page = 0, append = false) {
  if (isLoadingMore) return;
  isLoadingMore = true;
  currentPage = page;

  try {
    const itemsPerPage = 24; 
    const from = page * itemsPerPage;
    const to = from + itemsPerPage - 1;

    // إلغاء أي ريكويست قديم لتجنب تداخل البيانات
    if (searchController) searchController.abort();
    searchController = new AbortController();

    // السحر هنا: لو العميل بيبحث، نستخدم الـ RPC، لو مبيبحثش نستخدم الجدول العادي
    let baseQuery = currentSearchQuery 
      ? supabase.rpc('search_products_front', { p_query: currentSearchQuery })
      : supabase.from('products');

    let query = baseQuery
      .select(`
        id, name, name_ar, description, description_ar, category, gender_department, image_path, image_paths, is_active, created_at,
        product_variants(
          id, color, color_en, color_hex, size, selling_price, is_active,
          inventory(quantity)
        )
      `)
      .eq('is_active', true)
      .abortSignal(searchController.signal);

    if (state.filters.cats.length > 0) {
      query = query.in('category', state.filters.cats);
    }
    if (state.filters.genders.length > 0) {
      query = query.in('gender_department', state.filters.genders);
    }

    query = query.range(from, to);

    const { data: dbProducts, error } = await query;
    if (error) throw error;

    let fetchedProducts = formatSupabaseProducts(dbProducts);

    if(state.filters.sort === 'price-asc') fetchedProducts.sort((a,b) => a.price - b.price);
    if(state.filters.sort === 'price-desc') fetchedProducts.sort((a,b) => b.price - a.price);

    if (dbProducts.length < itemsPerPage) {
      hasMoreProducts = false;
    } else {
      hasMoreProducts = true;
    }

    // ==================== الكود الجديد هنا ====================
    // تصفية المنتجات البايظة أولاً
    let validFetchedProducts = fetchedProducts.filter(p => p.price > 0);

    // لو append بـ true هنزود المنتجات الجديدة بس في الواجهة
    if (append) {
      PRODUCTS = [...PRODUCTS, ...validFetchedProducts];
      renderGrid(validFetchedProducts, true); // الـ true دي هي اللي هتمنع الفرقعة
    } else {
      PRODUCTS = validFetchedProducts;
      renderGrid(); // تحميل عادي للصفحة من الصفر
    }

    // تم التعديل (Reconciliation): استرجاع السلة وربطها بالمنتجات الحية من السيرفر لتحديث الأسعار
    const savedCart = loadCart();
    state.cart = savedCart.map(item => {
      const liveProduct = validFetchedProducts.find(p => p.id === item.id) || PRODUCTS.find(p => p.id === item.id);
      return liveProduct ? { ...item, product: liveProduct } : null;
    }).filter(Boolean); // يحذف المنتجات التي تم إخفاؤها أو مسحها من الداتابيز
    
    renderCart();
    updateCartBadge();
    // =========================================================

  } catch (err) {
    console.error("خطأ في جلب البيانات من الداتابيز:", err);
  } finally {
    isLoadingMore = false;
  }
}


/* ============ تشغيل الموقع ============ */
loadStoreProducts();
/* ===================================================================
   CHECKOUT LOGIC (STEP 1: UI Toggle)
=================================================================== */
const checkoutModal = document.getElementById('checkoutModal');
const checkoutOverlay = document.getElementById('checkoutOverlay');
const btnOpenCheckout = document.querySelector('.cart-checkout');
const btnCloseCheckout = document.getElementById('checkoutClose');

// فتح نافذة الدفع
// فتح نافذة الدفع
btnOpenCheckout.addEventListener('click', async () => {
  if(state.cart.length === 0) return;
  
  // تم التعديل: فحص المخزون الفعلي من السيرفر (Real-time Validation) قبل فتح شاشة الدفع
  const originalText = btnOpenCheckout.innerHTML;
  btnOpenCheckout.innerHTML = state.lang === 'ar' ? '<span class="add-cart-text">جاري فحص المخزون...</span>' : '<span class="add-cart-text">Checking stock...</span>';
  btnOpenCheckout.disabled = true;

  try {
    // 1. استخراج الـ IDs الخاصة بالمنتجات في السلة
    const variantIds = state.cart.map(item => {
        const targetColor = item.color.name.ar || item.color.name.en;
        const matchedVariant = item.product.variants?.find(v => v.color === targetColor && v.size === item.size);
        return matchedVariant ? matchedVariant.id : null;
    }).filter(Boolean);

    // 2. طلب الكميات الحية من قاعدة البيانات
    const { data: liveData, error } = await supabase
        .from('product_variants')
        .select('id, inventory(quantity)')
        .in('id', variantIds);

    if (error) throw error;

    let cartChanged = false;
    
    // 3. مقارنة الكمية في السلة بالكمية الحقيقية وتعديلها (Clamping)
    const newCart = state.cart.map(item => {
        const targetColor = item.color.name.ar || item.color.name.en;
        const matchedVariant = item.product.variants?.find(v => v.color === targetColor && v.size === item.size);
        
        const liveVariant = liveData.find(v => v.id === matchedVariant?.id);
        const liveStock = liveVariant?.inventory?.reduce((sum, inv) => sum + (inv.quantity || 0), 0) || 0;

        // إذا كان العميل يطلب أكثر من المتاح
        if (item.qty > liveStock) {
            cartChanged = true;
            return liveStock > 0 ? { ...item, qty: liveStock } : null; // تقليل الكمية، أو حذفها إذا نفدت
        }
        return item;
    }).filter(Boolean);

    // 4. إذا حدث تغيير، نوقف الدفع ونحدث السلة وننبه العميل
    if (cartChanged) {
        state.cart = newCart;
        renderCart();
        updateCartBadge();
        showToast(state.lang === 'ar' ? 'عفواً، تم تعديل كميات السلة لتطابق المخزون المتاح حالياً.' : 'Cart quantities updated to match available stock.');
        btnOpenCheckout.innerHTML = originalText;
        btnOpenCheckout.disabled = false;
        return; 
    }

    // 5. إذا كان المخزون سليماً، نقفل السلة ونفتح شاشة الدفع
    closeCartDrawer();
    
    const total = state.cart.reduce((s, item) => s + item.product.price * item.qty, 0);
    document.getElementById('checkoutTotal').textContent = total + ' EGP';
    
    checkoutOverlay.classList.add('open');
    checkoutModal.classList.add('open');
    document.body.style.overflow = 'hidden';

  } catch (err) {
    console.error("Stock validation error:", err);
    showToast(state.lang === 'ar' ? 'حدث خطأ أثناء فحص المخزون.' : 'Error checking stock.');
  } finally {
    btnOpenCheckout.innerHTML = originalText;
    btnOpenCheckout.disabled = false;
  }
});

// قفل نافذة الدفع
function closeCheckout(){
  checkoutOverlay.classList.remove('open');
  checkoutModal.classList.remove('open');
  document.body.style.overflow = '';
}
function resetAndCloseCheckout() {
  closeCheckout();
  setTimeout(() => {
    document.getElementById('checkoutSuccess').style.display = 'none';
    document.getElementById('checkoutForm').style.display = 'flex';
    document.querySelector('.checkout-subtitle').style.display = 'block';
    document.querySelector('.checkout-title').style.display = 'block';
  }, 400); 
}

btnCloseCheckout.addEventListener('click', resetAndCloseCheckout);
checkoutOverlay.addEventListener('click', resetAndCloseCheckout);
document.getElementById('btnContinueShopping').addEventListener('click', resetAndCloseCheckout);


// ===================================================================
// إرسال الطلب لـ Supabase (Secure Checkout Logic)
// ===================================================================
document.getElementById('checkoutForm').addEventListener('submit', async (e) => {
  e.preventDefault(); // نمنع الصفحة تعمل Refresh

  if(state.cart.length === 0) return;

  // --- التعديل هنا: إضافة حماية الـ JS (Strict Validation) لمنع تلاعب المتصفح ---
  const phoneVal = document.getElementById('coPhone').value.trim();
  const phoneAltVal = document.getElementById('coPhoneAlt').value.trim();
  
  // Regex دقيق جداً للهواتف المصرية (يبدأ بـ 01 وبعده 0,1,2,5 ثم 8 أرقام)
  const phoneRegex = /^01[0125][0-9]{8}$/; 

  if (!phoneRegex.test(phoneVal)) {
    showToast(state.lang === 'ar' ? 'يرجى إدخال رقم موبايل صحيح (11 رقم)' : 'Please enter a valid 11-digit phone number');
    return; // نوقف الإرسال فوراً
  }
  if (phoneAltVal && !phoneRegex.test(phoneAltVal)) {
    showToast(state.lang === 'ar' ? 'رقم الموبايل البديل غير صحيح' : 'Alternative phone is invalid');
    return;
  }
  // --------------------------------------------------------------------------------

  const btn = document.querySelector('.btn-submit-order');
  const originalText = btn.innerHTML;
  btn.innerHTML = state.lang === 'ar' ? '<span class="add-cart-text">جاري تأكيد الطلب...</span>' : '<span class="add-cart-text">Confirming...</span>';
  btn.disabled = true;

  try {
    const name = document.getElementById('coName').value;
    const phone = document.getElementById('coPhone').value;
    const phoneAlt = document.getElementById('coPhoneAlt').value || null;
    const city = document.getElementById('coCity').value;
    const address = document.getElementById('coAddress').value;

    const secureOrderItems = state.cart.map(item => {
      const targetColor = item.color.name.ar || item.color.name.en;
      const matchedVariant = item.product.variants?.find(v => 
        v.color === targetColor && v.size === item.size
      );

      return {
        product_id: item.product.id,
        variant_id: matchedVariant ? matchedVariant.id : null,
        color: targetColor,
        size: item.size,
        qty: item.qty
      };
    });

    const { data: orderId, error: rpcError } = await supabase.rpc('submit_secure_web_order', {
      p_customer_name: name,
      p_phone: phone,
      p_phone_alt: phoneAlt,
      p_city: city,
      p_address: address,
      p_items: secureOrderItems
    });

    if (rpcError) throw rpcError;

    // 1. إخفاء الفورم القديم
    document.getElementById('checkoutForm').style.display = 'none';
    document.querySelector('.checkout-subtitle').style.display = 'none';
    document.querySelector('.checkout-title').style.display = 'none';
    
    // 2. تجهيز رقم الطلب المرجعي وإظهار شاشة النجاح
    const shortOrderId = String(orderId).substring(0, 8).toUpperCase();
    document.getElementById('successOrderId').textContent = '#' + shortOrderId;
    document.getElementById('checkoutSuccess').style.display = 'flex';
    
    // 3. تفريغ السلة في الخلفية
    state.cart = []; 
    document.getElementById('checkoutForm').reset(); 
    renderCart(); 
    updateCartBadge();

  } catch (err) {
    console.error("تفاصيل الخطأ:", err);
    const errorMessage = err.message.includes('نفدت') 
        ? err.message 
        : (state.lang === 'ar' ? 'حدث خطأ أثناء إرسال الطلب، يرجى المحاولة مرة أخرى.' : 'Error submitting order, please try again.');
    showToast(errorMessage);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
});
// استخدام IntersectionObserver بدل الـ Scroll لتحسين الأداء بشكل جذري
const scrollObserver = new IntersectionObserver((entries) => {
  // لو الفوتر ظهر في الشاشة (أو قرب يظهر بـ 300 بيكسل) ولسه فيه منتجات
  if (entries[0].isIntersecting && hasMoreProducts && !isLoadingMore) {
    loadStoreProducts(currentPage + 1, true); 
  }
}, { rootMargin: '600px' });

// بنخلي الأوبزيرفر يراقب الفوتر بتاع الموقع
const siteFooter = document.querySelector('.site-footer');
if (siteFooter) {
  scrollObserver.observe(siteFooter);
}

/* ===================================================================
   تحديث المخزون اللحظي (Real-time Inventory Subscription)
=================================================================== */
supabase.channel('public:inventory')
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'inventory' }, payload => {
    const { variant_id, quantity } = payload.new;
    let shouldRender = false;
    
    // البحث عن المنتج الذي يحتوي على هذا الـ Variant وتحديث كميته
    PRODUCTS.forEach(p => {
      if (p.variants) {
        const variant = p.variants.find(v => v.id === variant_id);
        if (variant) {
          if (variant.inventory && variant.inventory.length > 0) {
            variant.inventory[0].quantity = quantity;
          } else {
            variant.inventory = [{ quantity: quantity }];
          }
          
          // إعادة حساب المخزون الإجمالي للمنتج لمعرفة هل نفدت الكمية أم لا
          const totalStock = p.variants.reduce((sum, v) => sum + (v.inventory?.[0]?.quantity || 0), 0);
          p.outOfStock = totalStock <= 0;
          shouldRender = true;
        }
      }
    });

    // تحديث الواجهة فوراً إذا كان المنتج المعروض قد تم تغيير مخزونه
    if (shouldRender) {
      renderGrid(); 
      if (state.activeProduct) {
        renderQuickView(state.activeProduct); // تحديث نافذة العرض السريع لو مفتوحة
      }
    }
  })
  .subscribe();

  /* ===================================================================
=================================================================== */
document.querySelectorAll('.footer-cat-link').forEach(link => {
  link.addEventListener('click', () => {
    const catValue = link.getAttribute('data-cat');
    
    if (catValue === 'all') {
      state.filters.cats = [];
    } else {
      state.filters.cats = catValue.split(',');
    }
    
    document.querySelectorAll('.catFilter').forEach(cb => {
      cb.checked = state.filters.cats.includes(cb.value);
    });

    loadStoreProducts(0, false);
  });
});