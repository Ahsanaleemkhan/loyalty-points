/**
 * Loyalty Points Widget — Premium v2
 * Features: animated balance, tier progress, skeleton loader, social share,
 *           expiry warning, estimated points preview, referral tab.
 */
(function () {
  'use strict';

  // ── Utilities ────────────────────────────────────────────────────────────

  function formatMoney(amount, currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency', currency: currency || 'USD',
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      }).format(amount);
    } catch (e) {
      return (currency || '') + ' ' + Number(amount).toFixed(2);
    }
  }

  function formatDate(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return iso; }
  }

  /** Animate a number counter from 0 → target */
  function animateCount(el, target, duration) {
    if (!el) return;
    var start = performance.now();
    function step(now) {
      var elapsed = now - start;
      var progress = Math.min(elapsed / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(target * eased).toLocaleString();
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /** Compress an image File to JPEG ≤ maxKB. Returns a Promise<base64 string>. */
  function compressImage(file, maxKB) {
    return new Promise(function (resolve) {
      if (!file.type.startsWith('image/') || file.size < maxKB * 1024) {
        var reader = new FileReader();
        reader.onload = function (e) { resolve(e.target.result); };
        reader.readAsDataURL(file);
        return;
      }
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var canvas = document.createElement('canvas');
        var ratio = Math.min(1200 / img.width, 1200 / img.height, 1);
        canvas.width  = img.width  * ratio;
        canvas.height = img.height * ratio;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        var quality = 0.82;
        var result = canvas.toDataURL('image/jpeg', quality);
        while (result.length > maxKB * 1024 * 1.37 && quality > 0.3) {
          quality -= 0.1;
          result = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(result);
      };
      img.src = url;
    });
  }

  const TX_LABELS = {
    EARNED_ONLINE:   { label: 'Online Purchase', bg: '#d1fae5', color: '#065f46' },
    EARNED_PHYSICAL: { label: 'Physical Receipt', bg: '#dbeafe', color: '#1e40af' },
    EARNED_RULE:     { label: 'Bonus Points',     bg: '#ede9fe', color: '#6d28d9' },
    MANUAL_ADJUST:   { label: 'Manual Adjustment',bg: '#f3e8ff', color: '#6b21a8' },
    REDEEMED:        { label: 'Redeemed',         bg: '#ffedd5', color: '#9a3412' },
    EXPIRED:         { label: 'Expired',          bg: '#f3f4f6', color: '#6b7280' },
  };

  const SUB_STATUS = {
    PENDING:  { bg: '#fef3c7', color: '#d97706' },
    APPROVED: { bg: '#d1fae5', color: '#065f46' },
    REJECTED: { bg: '#fee2e2', color: '#b91c1c' },
  };

  // ── HTML Builder (used when widget div is empty — custom embed mode) ─────

  function buildWidgetHTML(id, color) {
    var c = color || '#008060';
    var dark = c; // use same color; CSS darkens on hover
    return '<div id="lw-skeleton-' + id + '" class="lw-skeleton" style="display:block">' +
      '<div class="lw-skel-card"></div>' +
      '<div class="lw-skel-line" style="margin-top:14px"></div>' +
      '<div class="lw-skel-line lw-skel-short"></div>' +
      '</div>' +
      '<div id="lw-content-' + id + '" style="display:none">' +
        '<div class="lw-balance-card" style="background:linear-gradient(135deg,' + dark + ' 0%,' + c + ' 60%,#00b884 100%)">' +
          '<div class="lw-balance-label">🏆 Points Balance</div>' +
          '<div id="lw-balance-' + id + '" class="lw-balance-num">0</div>' +
          '<div class="lw-balance-sub">points available</div>' +
          '<div id="lw-tier-' + id + '" class="lw-tier-badge" style="display:none"></div>' +
        '</div>' +
        '<div id="lw-tier-progress-' + id + '" class="lw-tier-progress" style="display:none">' +
          '<div class="lw-tier-row"><span id="lw-tier-from-' + id + '"></span><span id="lw-tier-to-' + id + '"></span></div>' +
          '<div class="lw-tier-track"><div id="lw-tier-fill-' + id + '" class="lw-tier-fill" style="width:0%;background:' + c + '"></div></div>' +
          '<div id="lw-tier-hint-' + id + '" class="lw-tier-hint"></div>' +
        '</div>' +
        '<div id="lw-expiry-warn-' + id + '" class="lw-expiry-warn" style="display:none">' +
          '⚠️ <span id="lw-expiry-msg-' + id + '"></span>' +
        '</div>' +
        '<div class="lw-tabs">' +
          '<button class="lw-tab-btn lw-tab-active" data-tab="history">History</button>' +
          '<button class="lw-tab-btn" data-tab="redeem">Redeem</button>' +
          '<button class="lw-tab-btn" data-tab="codes">My Codes</button>' +
          '<button class="lw-tab-btn" data-tab="birthday">🎂 Birthday</button>' +
          '<button class="lw-tab-btn" data-tab="refer">Refer &amp; Earn</button>' +
          '<button class="lw-tab-btn" data-tab="submit">Submit Receipt</button>' +
          '<button class="lw-tab-btn" data-tab="chat">💬 Ask AI</button>' +
        '</div>' +
        /* History pane */
        '<div id="lw-tab-history-' + id + '" class="lw-tab-pane lw-tab-active-pane"><div id="lw-history-' + id + '" class="lw-history-list"></div></div>' +
        /* Redeem pane */
        '<div id="lw-tab-redeem-' + id + '" class="lw-tab-pane">' +
          '<div class="lw-redeem-box">' +
            '<div class="lw-redeem-labels"><span>Points to redeem</span><span class="lw-redeem-val"><span id="lw-redeem-pts-' + id + '">0</span> pts = <span id="lw-redeem-val-' + id + '">$0.00</span></span></div>' +
            '<input id="lw-redeem-slider-' + id + '" class="lw-slider" type="range" min="0" max="1000" value="0" style="accent-color:' + c + '">' +
            '<button id="lw-redeem-btn-' + id + '" class="lw-btn-primary" style="background:' + c + ';margin-top:4px">Redeem Points</button>' +
            '<div id="lw-redeem-result-' + id + '" class="lw-redeem-result" style="display:none"></div>' +
          '</div>' +
        '</div>' +
        /* My Codes pane */
        '<div id="lw-tab-codes-' + id + '" class="lw-tab-pane"><div id="lw-redemptions-' + id + '" class="lw-codes-list"></div></div>' +
        /* Birthday pane */
        '<div id="lw-tab-birthday-' + id + '" class="lw-tab-pane">' +
          '<div class="lw-birthday-box">' +
            '<p class="lw-birthday-desc">🎂 Save your birthday and we\'ll send you bonus points on your special day every year!</p>' +
            '<form id="lw-birthday-form-' + id + '" style="display:flex;flex-direction:column;gap:10px">' +
              '<div><label class="lw-label">Your Birthday</label>' +
              '<input id="lw-bday-' + id + '" class="lw-input" type="date" name="birthday" required></div>' +
              '<button id="lw-bday-btn-' + id + '" type="submit" class="lw-btn-primary" style="background:' + c + '">Save Birthday</button>' +
              '<div id="lw-bday-msg-' + id + '" class="lw-msg" style="display:none"></div>' +
            '</form>' +
          '</div>' +
        '</div>' +
        /* Refer pane */
        '<div id="lw-tab-refer-' + id + '" class="lw-tab-pane"><div id="lw-refer-box-' + id + '" class="lw-refer-box"><div class="lw-refer-loading">Loading your referral code…</div></div></div>' +
        /* Submit Receipt pane */
        '<div id="lw-tab-submit-' + id + '" class="lw-tab-pane">' +
          '<form id="lw-submit-form-' + id + '" class="lw-receipt-form">' +
            '<div id="lw-dropzone-' + id + '" class="lw-dropzone">' +
              '<div class="lw-drop-inner">' +
                '<div class="lw-drop-icon">📷</div>' +
                '<div style="font-size:13px;color:#6d7175;font-weight:500">Tap to upload your receipt</div>' +
                '<div style="font-size:11px;color:#9ca3af;margin-top:4px">JPG, PNG, PDF · Max 5MB</div>' +
                '<input id="lw-file-' + id + '" type="file" accept="image/*,application/pdf" capture="environment" style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%">' +
              '</div>' +
              '<div id="lw-preview-' + id + '" class="lw-receipt-preview" style="display:none;align-items:center;gap:8px;flex-wrap:wrap;"></div>' +
            '</div>' +
            '<div><label class="lw-label">Purchase Amount <span style="color:#dc2626">*</span></label>' +
            '<input id="lw-amount-' + id + '" class="lw-input" type="number" name="purchaseAmount" step="0.01" min="0" placeholder="0.00" required>' +
            '<div id="lw-pts-preview-' + id + '" class="lw-pts-preview" style="display:none"></div></div>' +
            '<div><label class="lw-label">Purchase Date <span style="color:#dc2626">*</span></label>' +
            '<input class="lw-input" type="date" name="purchaseDate" required></div>' +
            '<div><label class="lw-label">Store / Location (optional)</label>' +
            '<input class="lw-input" type="text" name="storeLocation" placeholder="e.g. Main Street Store"></div>' +
            '<div><label class="lw-label">Notes (optional)</label>' +
            '<textarea class="lw-input lw-textarea" name="notes" rows="2" placeholder="Any notes for the reviewer"></textarea></div>' +
            '<button id="lw-submit-btn-' + id + '" type="submit" class="lw-btn-primary" style="background:' + c + '">Submit Receipt</button>' +
            '<div id="lw-submit-msg-' + id + '" class="lw-msg" style="display:none"></div>' +
          '</form>' +
        '</div>' +
        /* AI Chat pane */
        '<div id="lw-tab-chat-' + id + '" class="lw-tab-pane">' +
          '<div class="lw-chat-wrap">' +
            '<div id="lw-chat-messages-' + id + '" class="lw-chat-messages">' +
              '<div class="lw-chat-bubble lw-chat-ai">👋 Hi! I\'m your rewards assistant. Ask me about your points balance, how to earn more, or how to redeem for discounts!</div>' +
            '</div>' +
            '<div class="lw-chat-input-row">' +
              '<input id="lw-chat-input-' + id + '" class="lw-chat-input" type="text" placeholder="Ask about your rewards…" maxlength="300">' +
              '<button id="lw-chat-send-' + id + '" class="lw-chat-send" type="button" aria-label="Send" style="background:' + c + '">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
              '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ── Full-Page Dashboard HTML ─────────────────────────────────────────────
  // Used when data-layout="full" — renders a proper loyalty account page.

  function buildFullPageHTML(id, color, customerName) {
    var c = color || '#008060';
    var firstName = (customerName || 'there').split(' ')[0];
    var tabDefs = [
      { key: 'history',  icon: '📜', label: 'Points History' },
      { key: 'redeem',   icon: '🎟️', label: 'Redeem' },
      { key: 'codes',    icon: '🏷️', label: 'My Codes' },
      { key: 'birthday', icon: '🎂', label: 'Birthday' },
      { key: 'refer',    icon: '👥', label: 'Refer & Earn' },
      { key: 'submit',   icon: '🧾', label: 'Submit Receipt' },
      { key: 'chat',     icon: '💬', label: 'Ask AI' },
    ];

    var navItems = tabDefs.map(function(t, i) {
      return '<button class="lw-fp-nav-btn' + (i === 0 ? ' lw-fp-nav-active' : '') + '" data-tab="' + t.key + '" style="' + (i === 0 ? '--lw-nav-active:1;' : '') + '">' +
        '<span class="lw-fp-nav-icon">' + t.icon + '</span>' +
        '<span class="lw-fp-nav-label">' + t.label + '</span>' +
      '</button>';
    }).join('');

    var panes = tabDefs.map(function(t, i) {
      var inner = '';
      if (t.key === 'history') {
        inner = '<div class="lw-fp-pane-header"><h3 class="lw-fp-pane-title">📜 Points History</h3><p class="lw-fp-pane-sub">Your complete earning and spending record.</p></div>' +
                '<div id="lw-history-' + id + '" class="lw-history-list"></div>';
      } else if (t.key === 'redeem') {
        inner = '<div class="lw-fp-pane-header"><h3 class="lw-fp-pane-title">🎟️ Redeem Points</h3><p class="lw-fp-pane-sub">Convert your points into a discount code at checkout.</p></div>' +
                '<div class="lw-redeem-box" style="max-width:540px">' +
                  '<div class="lw-redeem-labels"><span>Points to redeem</span><span class="lw-redeem-val"><span id="lw-redeem-pts-' + id + '">0</span> pts = <span id="lw-redeem-val-' + id + '">$0.00</span></span></div>' +
                  '<input id="lw-redeem-slider-' + id + '" class="lw-slider" type="range" min="0" max="1000" value="0" style="accent-color:' + c + '">' +
                  '<button id="lw-redeem-btn-' + id + '" class="lw-btn-primary" style="background:' + c + ';margin-top:4px">Redeem Points</button>' +
                  '<div id="lw-redeem-result-' + id + '" class="lw-redeem-result" style="display:none"></div>' +
                '</div>';
      } else if (t.key === 'codes') {
        inner = '<div class="lw-fp-pane-header"><h3 class="lw-fp-pane-title">🏷️ My Discount Codes</h3><p class="lw-fp-pane-sub">Codes you\'ve generated — use them at checkout.</p></div>' +
                '<div id="lw-redemptions-' + id + '" class="lw-codes-list"></div>';
      } else if (t.key === 'birthday') {
        inner = '<div class="lw-fp-pane-header"><h3 class="lw-fp-pane-title">🎂 Birthday Bonus</h3><p class="lw-fp-pane-sub">Save your birthday and receive bonus points every year!</p></div>' +
                '<form id="lw-birthday-form-' + id + '" style="max-width:360px;display:flex;flex-direction:column;gap:14px">' +
                  '<div><label class="lw-label">Your Birthday</label><input id="lw-bday-' + id + '" class="lw-input" type="date" name="birthday" required></div>' +
                  '<button id="lw-bday-btn-' + id + '" type="submit" class="lw-btn-primary" style="background:' + c + '">Save Birthday</button>' +
                  '<div id="lw-bday-msg-' + id + '" class="lw-msg" style="display:none"></div>' +
                '</form>';
      } else if (t.key === 'refer') {
        inner = '<div class="lw-fp-pane-header"><h3 class="lw-fp-pane-title">👥 Refer & Earn</h3><p class="lw-fp-pane-sub">Share your link and earn points for every friend who shops.</p></div>' +
                '<div id="lw-refer-box-' + id + '" class="lw-refer-box"><div class="lw-refer-loading">Loading your referral code…</div></div>';
      } else if (t.key === 'submit') {
        inner = '<div class="lw-fp-pane-header"><h3 class="lw-fp-pane-title">🧾 Submit Receipt</h3><p class="lw-fp-pane-sub">Upload a receipt from a physical purchase to earn points.</p></div>' +
                '<form id="lw-submit-form-' + id + '" class="lw-receipt-form" style="max-width:580px">' +
                  '<div id="lw-dropzone-' + id + '" class="lw-dropzone">' +
                    '<div class="lw-drop-inner">' +
                      '<div class="lw-drop-icon">📷</div>' +
                      '<div style="font-size:13px;color:#6d7175;font-weight:500">Tap to upload your receipt</div>' +
                      '<div style="font-size:11px;color:#9ca3af;margin-top:4px">JPG, PNG, PDF · Max 5MB</div>' +
                      '<input id="lw-file-' + id + '" type="file" accept="image/*,application/pdf" capture="environment" style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%">' +
                    '</div>' +
                    '<div id="lw-preview-' + id + '" class="lw-receipt-preview" style="display:none;align-items:center;gap:8px;flex-wrap:wrap;"></div>' +
                  '</div>' +
                  '<div><label class="lw-label">Purchase Amount <span style="color:#dc2626">*</span></label>' +
                  '<input id="lw-amount-' + id + '" class="lw-input" type="number" name="purchaseAmount" step="0.01" min="0" placeholder="0.00" required>' +
                  '<div id="lw-pts-preview-' + id + '" class="lw-pts-preview" style="display:none"></div></div>' +
                  '<div><label class="lw-label">Purchase Date <span style="color:#dc2626">*</span></label><input class="lw-input" type="date" name="purchaseDate" required></div>' +
                  '<div><label class="lw-label">Store / Location (optional)</label><input class="lw-input" type="text" name="storeLocation" placeholder="e.g. Main Street Store"></div>' +
                  '<div><label class="lw-label">Notes (optional)</label><textarea class="lw-input lw-textarea" name="notes" rows="2" placeholder="Any notes for the reviewer"></textarea></div>' +
                  '<button id="lw-submit-btn-' + id + '" type="submit" class="lw-btn-primary" style="background:' + c + '">Submit Receipt</button>' +
                  '<div id="lw-submit-msg-' + id + '" class="lw-msg" style="display:none"></div>' +
                '</form>';
      } else if (t.key === 'chat') {
        inner = '<div class="lw-fp-pane-header"><h3 class="lw-fp-pane-title">💬 Ask AI</h3><p class="lw-fp-pane-sub">Get instant answers about your points and rewards.</p></div>' +
                '<div class="lw-chat-wrap" style="max-width:640px">' +
                  '<div id="lw-chat-messages-' + id + '" class="lw-chat-messages">' +
                    '<div class="lw-chat-bubble lw-chat-ai">👋 Hi ' + firstName + '! I\'m your rewards assistant. Ask me about your points balance, how to earn more, or how to redeem for discounts!</div>' +
                  '</div>' +
                  '<div class="lw-chat-input-row">' +
                    '<input id="lw-chat-input-' + id + '" class="lw-chat-input" type="text" placeholder="Ask about your rewards…" maxlength="300">' +
                    '<button id="lw-chat-send-' + id + '" class="lw-chat-send" type="button" aria-label="Send" style="background:' + c + '">' +
                      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
                    '</button>' +
                  '</div>' +
                '</div>';
      }
      return '<div id="lw-tab-' + t.key + '-' + id + '" class="lw-fp-pane' + (i === 0 ? ' lw-fp-pane-active' : '') + '">' + inner + '</div>';
    }).join('');

    return (
      /* ── Skeleton ── */
      '<div id="lw-skeleton-' + id + '" class="lw-fp-skeleton">' +
        '<div class="lw-fp-skel-hero"></div>' +
        '<div class="lw-fp-skel-body">' +
          '<div class="lw-fp-skel-nav"></div>' +
          '<div class="lw-fp-skel-content">' +
            '<div class="lw-skel-line" style="width:40%;margin:0 0 12px;"></div>' +
            '<div class="lw-skel-line" style="width:70%;margin:0 0 8px;"></div>' +
            '<div class="lw-skel-line lw-skel-short" style="margin:0;"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      /* ── Content ── */
      '<div id="lw-content-' + id + '" style="display:none">' +

        /* Hero */
        '<div class="lw-fp-hero" style="background:linear-gradient(135deg,' + c + ' 0%,' + c + 'cc 55%,#00c896 100%)">' +
          '<div class="lw-fp-hero-inner">' +
            '<div class="lw-fp-hero-left">' +
              '<div class="lw-fp-greeting">Welcome back, <strong>' + firstName + '</strong> 👋</div>' +
              '<div class="lw-fp-balance-wrap">' +
                '<div class="lw-fp-balance-label">Your Points Balance</div>' +
                '<div id="lw-balance-' + id + '" class="lw-fp-balance-num">0</div>' +
                '<div class="lw-fp-balance-sub">points available to redeem</div>' +
              '</div>' +
              '<div id="lw-tier-' + id + '" class="lw-tier-badge" style="display:none;margin-top:16px;"></div>' +
            '</div>' +
            '<div class="lw-fp-hero-right">' +
              '<div id="lw-fp-stat-lifetime-' + id + '" class="lw-fp-stat-card">' +
                '<div class="lw-fp-stat-label">Lifetime Earned</div>' +
                '<div class="lw-fp-stat-val" id="lw-fp-lifetime-' + id + '">—</div>' +
              '</div>' +
              '<div class="lw-fp-stat-card">' +
                '<div class="lw-fp-stat-label">Total Redeemed</div>' +
                '<div class="lw-fp-stat-val" id="lw-fp-redeemed-' + id + '">—</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          /* Tier progress inside hero */
          '<div id="lw-tier-progress-' + id + '" class="lw-fp-tier-bar" style="display:none">' +
            '<div class="lw-fp-tier-row">' +
              '<span id="lw-tier-from-' + id + '"></span>' +
              '<span id="lw-tier-to-' + id + '"></span>' +
            '</div>' +
            '<div class="lw-fp-tier-track"><div id="lw-tier-fill-' + id + '" class="lw-fp-tier-fill"></div></div>' +
            '<div id="lw-tier-hint-' + id + '" class="lw-fp-tier-hint"></div>' +
          '</div>' +
        '</div>' +

        /* Expiry banner */
        '<div id="lw-expiry-warn-' + id + '" class="lw-expiry-warn" style="display:none">' +
          '⚠️ <span id="lw-expiry-msg-' + id + '"></span>' +
        '</div>' +

        /* Body: sidebar nav + pane */
        '<div class="lw-fp-body">' +
          '<nav class="lw-fp-nav">' + navItems + '</nav>' +
          '<div class="lw-fp-content">' + panes + '</div>' +
        '</div>' +

      '</div>'
    );
  }

  // ── Widget Initialiser ───────────────────────────────────────────────────

  function initWidget(widget) {
    var blockId       = widget.dataset.blockId;
    var appUrl        = (widget.dataset.appUrl || '').replace(/\/$/, '');
    var shop          = widget.dataset.shop;
    var currency      = widget.dataset.currency || 'USD';
    var customerId    = widget.dataset.customerId;
    var customerEmail = widget.dataset.customerEmail;
    var customerName  = widget.dataset.customerName || '';
    var primaryColor  = widget.style.getPropertyValue('--lw-primary').trim() || '#008060';
    var layout        = (widget.dataset.layout || '').toLowerCase(); // "full" | "" (compact, default)

    if (!customerId || !appUrl) return;

    // Make sure the layout attribute is on the container so CSS can target it
    // (works whether the merchant set data-layout or not)
    if (layout) widget.setAttribute('data-layout', layout);

    // If the widget container is empty (custom embed mode), inject the HTML structure
    if (!blockId || !widget.querySelector('[id^="lw-skeleton-"]')) {
      blockId = blockId || ('embed-' + Math.random().toString(36).slice(2, 8));
      widget.dataset.blockId = blockId;
      widget.innerHTML = layout === 'full'
        ? buildFullPageHTML(blockId, primaryColor, customerName)
        : buildWidgetHTML(blockId, primaryColor);
    }

    var $ = function (id) { return document.getElementById(id); };

    var skeletonEl   = $('lw-skeleton-' + blockId);
    var contentEl    = $('lw-content-' + blockId);
    var balanceEl    = $('lw-balance-' + blockId);
    var tierEl       = $('lw-tier-' + blockId);
    var tierProgEl   = $('lw-tier-progress-' + blockId);
    var tierFromEl   = $('lw-tier-from-' + blockId);
    var tierToEl     = $('lw-tier-to-' + blockId);
    var tierFillEl   = $('lw-tier-fill-' + blockId);
    var tierHintEl   = $('lw-tier-hint-' + blockId);
    var expiryWarnEl = $('lw-expiry-warn-' + blockId);
    var expiryMsgEl  = $('lw-expiry-msg-' + blockId);

    // Redeem tab
    var redeemSlider   = $('lw-redeem-slider-' + blockId);
    var redeemPtsEl    = $('lw-redeem-pts-' + blockId);
    var redeemValEl    = $('lw-redeem-val-' + blockId);
    var redeemBtn      = $('lw-redeem-btn-' + blockId);
    var redeemResultEl = $('lw-redeem-result-' + blockId);

    // Submit tab
    var submitForm  = $('lw-submit-form-' + blockId);
    var dropzone    = $('lw-dropzone-' + blockId);
    var fileInput   = $('lw-file-' + blockId);
    var previewEl   = $('lw-preview-' + blockId);
    var submitMsgEl = $('lw-submit-msg-' + blockId);
    var submitBtn   = $('lw-submit-btn-' + blockId);
    var ptsPrevEl   = $('lw-pts-preview-' + blockId);
    var amountInput = $('lw-amount-' + blockId);

    var appData      = null;
    var selectedFile = null;
    var fileDataUrl  = null;

    // ── Load Data ─────────────────────────────────────────────────────────

    async function loadData() {
      try {
        var res = await fetch(
          appUrl + '/api/widget?shop=' + encodeURIComponent(shop) +
          '&customerId=' + encodeURIComponent(customerId) +
          (customerEmail ? '&customerEmail=' + encodeURIComponent(customerEmail) : '')
        );
        if (!res.ok) throw new Error('load failed');
        appData = await res.json();
        renderAll();
        if (skeletonEl) skeletonEl.style.display = 'none';
        if (contentEl)  { contentEl.style.display = 'block'; contentEl.style.animation = 'lw-fade-in .3s ease'; }
      } catch (e) {
        if (skeletonEl) skeletonEl.innerHTML = '<p style="text-align:center;color:#b91c1c;padding:20px;font-size:13px;">Could not load loyalty data. Please refresh.</p>';
      }
    }

    // ── Render ────────────────────────────────────────────────────────────

    function renderAll() {
      if (!appData) return;
      var bal = appData.balance || 0;

      // Animated balance count-up
      animateCount(balanceEl, bal, 900);

      // Tier badge
      if (appData.tier && tierEl) {
        tierEl.textContent = appData.tier.name + ' Member';
        tierEl.style.display = 'inline-block';
        tierEl.style.background = appData.tier.color || 'var(--lw-primary)';
      }

      // Full-page stat cards (lifetime earned / redeemed)
      var lifetimeEl = $('lw-fp-lifetime-' + blockId);
      var redeemedEl = $('lw-fp-redeemed-' + blockId);
      if (lifetimeEl || redeemedEl) {
        var txs = appData.transactions || [];
        var lifetime = 0, redeemed = 0;
        txs.forEach(function(t) {
          if (t.points > 0) lifetime += t.points;
          else redeemed += Math.abs(t.points);
        });
        if (lifetimeEl) lifetimeEl.textContent = lifetime.toLocaleString() + ' pts';
        if (redeemedEl) redeemedEl.textContent = redeemed.toLocaleString() + ' pts';
      }

      // Wire full-page sidebar navigation
      var fpNavBtns = widget.querySelectorAll('.lw-fp-nav-btn');
      if (fpNavBtns.length > 0) {
        fpNavBtns.forEach(function(btn) {
          btn.addEventListener('click', function() {
            fpNavBtns.forEach(function(b) { b.classList.remove('lw-fp-nav-active'); });
            btn.classList.add('lw-fp-nav-active');
            var tab = btn.dataset.tab;
            widget.querySelectorAll('.lw-fp-pane').forEach(function(p) { p.classList.remove('lw-fp-pane-active'); });
            var pane = $('lw-tab-' + tab + '-' + blockId);
            if (pane) pane.classList.add('lw-fp-pane-active');
          });
        });
      }

      // Tier progress bar (uses nextTier from API — we compute client-side from tiers data)
      renderTierProgress(bal, appData.tiers);

      // Expiry warning
      renderExpiryWarning(appData.expiringPoints);

      renderHistory();
      renderRedemptions();
      renderRedeemTab();
      loadReferralCode();
    }

    function renderTierProgress(balance, tiers) {
      if (!tiers || !tiers.length || !tierProgEl) return;
      var sorted = tiers.slice().sort(function (a, b) { return a.minPoints - b.minPoints; });
      var current = null, next = null;
      for (var i = sorted.length - 1; i >= 0; i--) {
        if (balance >= sorted[i].minPoints) { current = sorted[i]; next = sorted[i + 1] || null; break; }
      }
      if (!next) return; // already at top tier
      var pct = Math.min((balance / next.minPoints) * 100, 100);
      tierProgEl.style.display = 'block';
      if (tierFromEl) tierFromEl.textContent = (current ? current.name : 'New Member') + ' · ' + balance.toLocaleString() + ' pts';
      if (tierToEl)   tierToEl.textContent = next.name + ' · ' + next.minPoints.toLocaleString() + ' pts';
      if (tierFillEl) {
        tierFillEl.style.background = next.color || 'var(--lw-primary)';
        setTimeout(function () { tierFillEl.style.width = pct.toFixed(1) + '%'; }, 100);
      }
      if (tierHintEl) {
        var remaining = next.minPoints - balance;
        tierHintEl.textContent = remaining.toLocaleString() + ' pts to unlock ' + next.name + ' (' + next.multiplier + 'x earning)';
      }
    }

    function renderExpiryWarning(expiringPoints) {
      if (!expiringPoints || expiringPoints <= 0 || !expiryWarnEl) return;
      expiryWarnEl.style.display = 'block';
      if (expiryMsgEl) expiryMsgEl.textContent = expiringPoints.toLocaleString() + ' points expire within 30 days. Redeem them before they\'re gone!';
    }

    function badge(text, bg, color) {
      return '<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;background:' + bg + ';color:' + color + ';text-transform:uppercase;letter-spacing:.3px;">' + text + '</span>';
    }

    function renderHistory() {
      var el = $('lw-history-' + blockId);
      if (!el || !appData) return;
      var txs = appData.transactions || [];
      if (!txs.length) {
        el.innerHTML = '<div class="lw-empty-state"><div class="lw-empty-icon">🌱</div><p>No transactions yet. Start earning points on your next purchase!</p></div>';
        return;
      }
      el.innerHTML = txs.map(function (t) {
        var lbl  = TX_LABELS[t.type] || { label: t.type, bg: '#f3f4f6', color: '#374151' };
        var sign = t.points >= 0 ? '+' : '';
        return '<div class="lw-tx-row">' +
          '<div class="lw-tx-left">' +
            badge(lbl.label, lbl.bg, lbl.color) +
            '<div class="lw-tx-date">' + formatDate(t.createdAt) + (t.note ? ' · ' + t.note : '') + '</div>' +
          '</div>' +
          '<strong class="lw-tx-pts" style="color:' + (t.points >= 0 ? '#008060' : '#dc2626') + ';">' + sign + t.points.toLocaleString() + ' pts</strong>' +
        '</div>';
      }).join('');
    }

    function renderRedemptions() {
      var el = $('lw-redemptions-' + blockId);
      if (!el || !appData) return;
      var list = appData.redemptions || [];
      var curr = (appData.settings && appData.settings.currency) || currency;
      if (!list.length) {
        el.innerHTML = '<div class="lw-empty-state"><div class="lw-empty-icon">🎟️</div><p>No discount codes yet. Redeem your points to generate a code!</p></div>';
        return;
      }
      el.innerHTML = list.map(function (r) {
        var s = SUB_STATUS[r.status] || { bg: '#fef3c7', color: '#d97706' };
        return '<div class="lw-tx-row lw-code-row">' +
          '<div class="lw-tx-left">' +
            '<div class="lw-code-wrap">' +
              '<code class="lw-code-text">' + r.discountCode + '</code>' +
              '<button class="lw-copy-inline" data-code="' + r.discountCode + '" type="button">Copy</button>' +
            '</div>' +
            '<div class="lw-tx-date">' + r.pointsSpent.toLocaleString() + ' pts · ' + formatDate(r.createdAt) + '</div>' +
          '</div>' +
          '<div style="text-align:right;">' +
            '<div class="lw-code-val">' + formatMoney(r.discountValue, curr) + '</div>' +
            badge(r.status, s.bg, s.color) +
          '</div>' +
        '</div>';
      }).join('');

      // Wire copy buttons
      el.querySelectorAll('.lw-copy-inline').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var code = btn.dataset.code;
          navigator.clipboard.writeText(code).then(function () {
            btn.textContent = '✓ Copied!';
            btn.classList.add('copied');
            setTimeout(function () { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
          }).catch(function () {});
        });
      });
    }

    function renderRedeemTab() {
      if (!redeemSlider || !appData) return;
      var s   = appData.settings || {};
      var bal = appData.balance || 0;
      var min = s.minPointsRedeem || 100;
      var curr = s.currency || currency;

      if (!s.redemptionEnabled || bal < min) {
        if (redeemBtn) {
          redeemBtn.disabled = true;
          redeemBtn.textContent = bal < min ? 'Need ' + min + ' points to redeem' : 'Redemptions disabled';
        }
        if (redeemSlider) redeemSlider.disabled = true;
        return;
      }

      redeemSlider.min   = min;
      redeemSlider.max   = bal;
      redeemSlider.step  = min;
      redeemSlider.value = min;
      updateRedeemDisplay();
      redeemSlider.addEventListener('input', updateRedeemDisplay);

      function updateRedeemDisplay() {
        var pts = Number(redeemSlider.value);
        var val = (pts / (s.pointsPerDiscount || 100)) * (s.discountValue || 1);
        if (redeemPtsEl) redeemPtsEl.textContent = pts.toLocaleString() + ' points';
        if (redeemValEl) redeemValEl.textContent = formatMoney(val, curr) + ' discount';
      }

      if (redeemBtn) {
        redeemBtn.disabled = false;
        redeemBtn.addEventListener('click', async function () {
          var pts = Number(redeemSlider.value);
          redeemBtn.disabled = true;
          redeemBtn.textContent = 'Processing…';
          if (redeemResultEl) redeemResultEl.style.display = 'none';

          try {
            var res = await fetch(appUrl + '/api/redeem', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ shop, customerId, customerEmail, customerName, pointsToRedeem: pts }),
            });
            var result = await res.json();

            if (!res.ok || result.error) {
              showRedeemResult(result.error || 'Redemption failed.', false);
              redeemBtn.disabled = false;
              redeemBtn.textContent = 'Redeem Points';
            } else {
              showRedeemResult(
                'Your discount code: <strong class="lw-code-inline">' + result.discountCode + '</strong>' +
                '<button class="lw-copy-inline" id="lw-result-copy-' + blockId + '" data-code="' + result.discountCode + '" type="button">Copy</button>' +
                '<br><small>Value: ' + formatMoney(result.discountValue, curr) + ' · Use at checkout</small>',
                true
              );
              // Wire result copy button
              var rcBtn = document.getElementById('lw-result-copy-' + blockId);
              if (rcBtn) {
                rcBtn.addEventListener('click', function () {
                  navigator.clipboard.writeText(result.discountCode).then(function () {
                    rcBtn.textContent = '✓ Copied!'; rcBtn.classList.add('copied');
                    setTimeout(function () { rcBtn.textContent = 'Copy'; rcBtn.classList.remove('copied'); }, 2000);
                  });
                });
              }
              appData.balance = result.newBalance || 0;
              animateCount(balanceEl, appData.balance, 600);
              redeemSlider.max = appData.balance;
              if (appData.balance < min) {
                redeemSlider.disabled = true;
                redeemBtn.disabled = true;
                redeemBtn.textContent = 'Need ' + min + ' points to redeem';
              } else {
                redeemBtn.disabled = false;
                redeemBtn.textContent = 'Redeem Points';
              }
              setTimeout(loadData, 1500);
            }
          } catch (e) {
            showRedeemResult('Network error. Please try again.', false);
            redeemBtn.disabled = false;
            redeemBtn.textContent = 'Redeem Points';
          }
        });
      }

      function showRedeemResult(html, success) {
        if (!redeemResultEl) return;
        redeemResultEl.innerHTML = html;
        redeemResultEl.className = 'lw-msg ' + (success ? 'lw-msg-success' : 'lw-msg-error');
        redeemResultEl.style.display = 'block';
        redeemResultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    // ── Tabs ──────────────────────────────────────────────────────────────

    var tabBtns  = widget.querySelectorAll('.lw-tab-btn');
    var tabPanes = widget.querySelectorAll('.lw-tab-pane');

    tabBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        tabBtns.forEach(function (b) { b.classList.remove('lw-tab-active'); });
        tabPanes.forEach(function (p) {
          p.style.display = 'none';
          p.classList.remove('lw-tab-active-pane');
          p.classList.remove('lw-tab-active');
        });
        btn.classList.add('lw-tab-active');
        // Try ID lookup first, then fall back to data-tab attribute
        var tab = btn.dataset.tab;
        var target = $('lw-tab-' + tab + '-' + blockId);
        if (!target) {
          // Fallback: find pane by data-tab attribute within this widget
          var panes = widget.querySelectorAll('.lw-tab-pane[data-tab="' + tab + '"]');
          target = panes.length ? panes[0] : null;
        }
        if (target) {
          target.style.display = 'block';
          target.classList.add('lw-tab-active-pane');
        }
      });
    });

    // ── Auto-switch to data-default-tab if specified ──────────────────────
    var defaultTab = widget.dataset.defaultTab;
    if (defaultTab) {
      // Works for both compact (.lw-tab-btn) and full-page (.lw-fp-nav-btn) layouts
      var defaultBtn = widget.querySelector('.lw-tab-btn[data-tab="' + defaultTab + '"]') ||
                       widget.querySelector('.lw-fp-nav-btn[data-tab="' + defaultTab + '"]');
      if (defaultBtn) defaultBtn.click();
    }

    // ── Receipt estimated points preview ──────────────────────────────────

    if (amountInput && ptsPrevEl) {
      amountInput.addEventListener('input', function () {
        var amt = parseFloat(amountInput.value);
        if (!amt || !appData || !appData.settings) { ptsPrevEl.style.display = 'none'; return; }
        var s = appData.settings;
        var pts = Math.floor((amt / (s.amountPerPoints || 100)) * (s.pointsPerAmount || 10));
        if (pts > 0) {
          ptsPrevEl.textContent = '≈ ' + pts + ' points for this purchase';
          ptsPrevEl.style.display = 'block';
        } else {
          ptsPrevEl.style.display = 'none';
        }
      });
    }

    // ── File Upload ───────────────────────────────────────────────────────

    async function handleFile(file) {
      if (!file) return;
      var allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
      if (file.size > 5 * 1024 * 1024) { showSubmitMsg('File too large (max 5MB).', 'error'); return; }
      if (!allowed.includes(file.type) && !file.type.startsWith('image/')) {
        showSubmitMsg('Invalid file type. Use JPG, PNG, WebP or PDF.', 'error'); return;
      }
      selectedFile = file;
      try {
        fileDataUrl = await compressImage(file, 400); // compress to ≤400KB
      } catch (e) {
        var reader = new FileReader();
        reader.onload = function (ev) { fileDataUrl = ev.target.result; };
        reader.readAsDataURL(file);
      }
      if (previewEl) {
        previewEl.style.display = 'flex';
        previewEl.innerHTML = file.type.startsWith('image/')
          ? '<img src="' + (fileDataUrl || URL.createObjectURL(file)) + '" alt="Preview" /><span>' + file.name + '</span>'
          : '<span>📄 ' + file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)</span>';
        var inner = dropzone && dropzone.querySelector('.lw-drop-inner');
        if (inner) inner.style.display = 'none';
      }
    }

    if (fileInput) fileInput.addEventListener('change', function (e) { handleFile(e.target.files[0]); });
    if (dropzone) {
      dropzone.addEventListener('dragover',  function (e) { e.preventDefault(); dropzone.classList.add('lw-over'); });
      dropzone.addEventListener('dragleave', function ()  { dropzone.classList.remove('lw-over'); });
      dropzone.addEventListener('drop',      function (e) { e.preventDefault(); dropzone.classList.remove('lw-over'); handleFile(e.dataTransfer.files[0]); });
      dropzone.addEventListener('click',     function (e) { if (e.target !== fileInput) fileInput.click(); });
    }

    // ── Submit Form ───────────────────────────────────────────────────────

    if (submitForm) {
      submitForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        clearSubmitMsg();
        var amount = submitForm.querySelector('[name="purchaseAmount"]').value;
        var date   = submitForm.querySelector('[name="purchaseDate"]').value;
        var store  = (submitForm.querySelector('[name="storeLocation"]') || {}).value || '';
        var notes  = (submitForm.querySelector('[name="notes"]') || {}).value || '';
        if (!amount || !date) { showSubmitMsg('Please fill all required fields.', 'error'); return; }
        if (!selectedFile || !fileDataUrl) { showSubmitMsg('Please upload your receipt.', 'error'); return; }

        setSubmitLoading(true);
        try {
          var res = await fetch(appUrl + '/api/widget', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              shop, customerId, customerEmail, customerName,
              receiptData: fileDataUrl, receiptName: selectedFile.name,
              receiptType: selectedFile.type,
              receiptSize: selectedFile.size,
              purchaseAmount: parseFloat(amount), purchaseDate: date,
              storeLocation: store, notes,
            }),
          });
          var result = await res.json();
          if (!res.ok || result.error) {
            showSubmitMsg(result.error || 'Submission failed.', 'error');
          } else {
            showSubmitMsg('Receipt submitted! We will review it within 1-2 business days.', 'success');
            submitForm.reset();
            selectedFile = null; fileDataUrl = null;
            if (previewEl) { previewEl.style.display = 'none'; previewEl.innerHTML = ''; }
            var inner = dropzone && dropzone.querySelector('.lw-drop-inner');
            if (inner) inner.style.display = '';
            if (ptsPrevEl) ptsPrevEl.style.display = 'none';
            setTimeout(loadData, 1000);
          }
        } catch (err) {
          showSubmitMsg('Network error. Please try again.', 'error');
        } finally {
          setSubmitLoading(false);
        }
      });
    }

    function showSubmitMsg(text, type) {
      if (!submitMsgEl) return;
      submitMsgEl.textContent = text;
      submitMsgEl.className   = 'lw-msg lw-msg-' + type;
      submitMsgEl.style.display = 'block';
    }
    function clearSubmitMsg() { if (submitMsgEl) submitMsgEl.style.display = 'none'; }
    function setSubmitLoading(on) {
      if (!submitBtn) return;
      submitBtn.disabled    = on;
      submitBtn.textContent = on ? 'Submitting…' : 'Submit Receipt';
    }

    // ── Referral Tab ──────────────────────────────────────────────────────

    async function loadReferralCode() {
      var referBox = $('lw-refer-box-' + blockId);
      if (!referBox || !appUrl) return;
      try {
        var url = appUrl + '/api/referral?shop=' + encodeURIComponent(shop) +
          '&customerId=' + encodeURIComponent(customerId) +
          '&customerEmail=' + encodeURIComponent(customerEmail) +
          '&customerName=' + encodeURIComponent(customerName);
        var res  = await fetch(url);
        var data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error);
        renderReferralBox(referBox, data.code, data.converted);
      } catch (e) {
        referBox.innerHTML = '<p style="color:#b91c1c;font-size:13px;text-align:center;padding:16px;">Could not load referral code.</p>';
      }
    }

    function renderReferralBox(referBox, code, converted) {
      var shareUrl = window.location.origin + '?ref=' + code;
      referBox.innerHTML =
        '<div class="lw-refer-code-wrap">' +
          '<div class="lw-refer-code-label">Your Referral Code</div>' +
          '<div class="lw-refer-code" id="lw-refcode-' + blockId + '">' + code + '</div>' +
          '<div class="lw-refer-actions">' +
            '<button class="lw-secondary-btn" id="lw-copy-code-' + blockId + '" type="button">Copy Code</button>' +
            '<button class="lw-secondary-btn" id="lw-share-btn-' + blockId + '" type="button">Share Link</button>' +
          '</div>' +
        '</div>' +
        '<div class="lw-refer-social" id="lw-refer-social-' + blockId + '">' +
          '<div class="lw-refer-code-label" style="margin-bottom:8px;">Share on</div>' +
          '<div class="lw-social-btns">' +
            '<a class="lw-social-btn lw-social-wa"  href="https://wa.me/?text=' + encodeURIComponent('Get rewards on your first order! Use my referral link: ' + shareUrl) + '" target="_blank" rel="noopener">WhatsApp</a>' +
            '<a class="lw-social-btn lw-social-tw"  href="https://twitter.com/intent/tweet?text=' + encodeURIComponent('Earn loyalty rewards! Use my referral link: ' + shareUrl) + '" target="_blank" rel="noopener">Twitter/X</a>' +
            '<a class="lw-social-btn lw-social-fb"  href="https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(shareUrl) + '" target="_blank" rel="noopener">Facebook</a>' +
          '</div>' +
          '<input class="lw-input" id="lw-refurl-' + blockId + '" type="text" readonly value="' + shareUrl + '" style="margin-top:10px;font-size:12px;" />' +
        '</div>' +
        (converted
          ? '<div class="lw-msg lw-msg-success" style="margin-top:12px;">🎉 Someone used your code! Bonus points have been credited.</div>'
          : '<div class="lw-refer-hint">Your code has not been used yet. Share it to earn bonus points!</div>') +
        '<div id="lw-refer-msg-' + blockId + '" class="lw-msg" style="display:none;margin-top:10px;"></div>';

      // Social share section toggle
      var socialDiv = $('lw-refer-social-' + blockId);
      if (socialDiv) socialDiv.style.display = 'none';

      var shareBtn = $('lw-share-btn-' + blockId);
      if (shareBtn) {
        shareBtn.addEventListener('click', async function () {
          // Try native share first (mobile)
          if (navigator.share) {
            try {
              await navigator.share({ title: 'Join our rewards program', text: 'Use my referral link to earn rewards!', url: shareUrl });
              return;
            } catch (e) {}
          }
          // Fallback: toggle social panel
          if (socialDiv) socialDiv.style.display = socialDiv.style.display === 'none' ? 'block' : 'none';
        });
      }

      var copyCodeBtn = $('lw-copy-code-' + blockId);
      if (copyCodeBtn) {
        copyCodeBtn.addEventListener('click', function () {
          navigator.clipboard.writeText(code).then(function () {
            copyCodeBtn.textContent = '✓ Copied!'; copyCodeBtn.classList.add('copied');
            setTimeout(function () { copyCodeBtn.textContent = 'Copy Code'; copyCodeBtn.classList.remove('copied'); }, 2000);
          }).catch(function () {
            var url = $('lw-refurl-' + blockId); if (url) { url.select(); }
          });
        });
      }
    }

    // ── Birthday Form ─────────────────────────────────────────────────────

    var bdayForm = $('lw-birthday-form-' + blockId);
    var bdayBtn  = $('lw-bday-btn-' + blockId);
    var bdayMsg  = $('lw-bday-msg-' + blockId);

    if (bdayForm) {
      bdayForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var input = $('lw-bday-' + blockId);
        if (!input || !input.value) return;
        bdayBtn.disabled = true;
        bdayBtn.textContent = 'Saving…';
        if (bdayMsg) bdayMsg.style.display = 'none';

        try {
          var res = await fetch(appUrl + '/api/birthday', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shop, customerId, birthday: input.value }),
          });
          var result = await res.json();
          if (!res.ok || result.error) {
            bdayMsg.textContent = result.error || 'Could not save birthday.';
            bdayMsg.className   = 'lw-msg lw-msg-error';
          } else {
            bdayMsg.innerHTML = '🎂 Birthday saved! You\'ll receive bonus points on your birthday each year.';
            bdayMsg.className = 'lw-msg lw-msg-success';
            bdayBtn.textContent = 'Saved ✓';
          }
          bdayMsg.style.display = 'block';
        } catch (err) {
          bdayMsg.textContent = 'Network error. Please try again.';
          bdayMsg.className   = 'lw-msg lw-msg-error';
          bdayMsg.style.display = 'block';
          bdayBtn.disabled = false;
          bdayBtn.textContent = 'Save Birthday';
        }
      });
    }

    loadData();

    // ── AI Chat ─────────────────────────────────────────────────────────────
    (function initChat() {
      var chatMessages = widget.querySelector('#lw-chat-messages-' + blockId);
      var chatInput    = widget.querySelector('#lw-chat-input-'    + blockId);
      var chatSend     = widget.querySelector('#lw-chat-send-'     + blockId);
      if (!chatMessages || !chatInput || !chatSend) return;

      var chatHistory = []; // { role, content }

      function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }

      function addBubble(role, text) {
        var div = document.createElement('div');
        div.className = 'lw-chat-bubble ' + (role === 'user' ? 'lw-chat-user' : 'lw-chat-ai');
        div.textContent = text;
        chatMessages.appendChild(div);
        scrollToBottom();
        return div;
      }

      function showTyping() {
        var div = document.createElement('div');
        div.className = 'lw-chat-typing';
        div.id = 'lw-chat-typing-' + blockId;
        div.innerHTML = '<div class="lw-chat-dot"></div><div class="lw-chat-dot"></div><div class="lw-chat-dot"></div>';
        chatMessages.appendChild(div);
        scrollToBottom();
      }

      function hideTyping() {
        var el = chatMessages.querySelector('#lw-chat-typing-' + blockId);
        if (el) el.remove();
      }

      async function sendMessage() {
        var text = chatInput.value.trim();
        if (!text) return;

        chatInput.value = '';
        chatSend.disabled = true;
        addBubble('user', text);
        showTyping();

        try {
          var res = await fetch(appUrl + '/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              shop:          shop,
              customerId:    customerId,
              customerEmail: widget.dataset.customerEmail || '',
              customerName:  widget.dataset.customerName  || '',
              message:       text,
              history:       chatHistory.slice(-8),
            }),
          });

          var data = await res.json();
          hideTyping();

          if (data.reply) {
            chatHistory.push({ role: 'user',      content: text       });
            chatHistory.push({ role: 'assistant', content: data.reply });
            addBubble('ai', data.reply);
          } else {
            addBubble('ai', data.error || 'Sorry, something went wrong. Please try again.');
          }
        } catch (err) {
          hideTyping();
          addBubble('ai', 'Network error. Please check your connection and try again.');
        } finally {
          chatSend.disabled = false;
          chatInput.focus();
        }
      }

      chatSend.addEventListener('click', sendMessage);
      chatInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
      });
    })();
  }

  function boot() { document.querySelectorAll('.loyalty-widget[data-customer-id]').forEach(initWidget); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
