(function () {
  'use strict';

  document.querySelectorAll('.lcb-root').forEach(function (root) {
    var blockId  = root.dataset.blockId;
    var appUrl   = (root.dataset.appUrl  || '').replace(/\/$/, '');
    var shop     = root.dataset.shop;
    var custId   = root.dataset.customerId;
    var custEmail= root.dataset.customerEmail || '';
    var custName = root.dataset.customerName  || '';

    if (!appUrl || !custId) return;

    var trigger   = document.getElementById('lcb-trigger-'  + blockId);
    var panel     = document.getElementById('lcb-panel-'    + blockId);
    var messages  = document.getElementById('lcb-messages-' + blockId);
    var input     = document.getElementById('lcb-input-'    + blockId);
    var sendBtn   = document.getElementById('lcb-send-'     + blockId);
    var closeBtn  = document.getElementById('lcb-close-'    + blockId);
    var unreadDot = document.getElementById('lcb-unread-'   + blockId);
    var iconChat  = trigger.querySelector('.lcb-icon-chat');
    var iconClose = trigger.querySelector('.lcb-icon-close');

    var isOpen    = false;
    var history   = [];

    // ── Toggle panel ──────────────────────────────────────────────────────
    function openPanel() {
      panel.style.display = 'flex';
      panel.style.flexDirection = 'column';
      isOpen = true;
      iconChat.style.display  = 'none';
      iconClose.style.display = 'block';
      if (unreadDot) unreadDot.style.display = 'none';
      setTimeout(function () { input.focus(); }, 100);
      scrollBottom();
    }

    function closePanel() {
      panel.style.display = 'none';
      isOpen = false;
      iconChat.style.display  = 'block';
      iconClose.style.display = 'none';
    }

    trigger.addEventListener('click', function () {
      isOpen ? closePanel() : openPanel();
    });
    if (closeBtn) closeBtn.addEventListener('click', closePanel);

    // ── Helpers ───────────────────────────────────────────────────────────
    function scrollBottom() {
      messages.scrollTop = messages.scrollHeight;
    }

    function addMsg(role, text) {
      var div = document.createElement('div');
      div.className = 'lcb-msg ' + (role === 'user' ? 'lcb-msg-user' : 'lcb-msg-ai');
      div.textContent = text;
      messages.appendChild(div);
      scrollBottom();
    }

    function showTyping() {
      var d = document.createElement('div');
      d.className = 'lcb-typing';
      d.id = 'lcb-typing-' + blockId;
      d.innerHTML = '<div class="lcb-dot"></div><div class="lcb-dot"></div><div class="lcb-dot"></div>';
      messages.appendChild(d);
      scrollBottom();
    }

    function hideTyping() {
      var d = document.getElementById('lcb-typing-' + blockId);
      if (d) d.remove();
    }

    // ── Send message ─────────────────────────────────────────────────────
    async function send() {
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      sendBtn.disabled = true;

      addMsg('user', text);
      showTyping();

      try {
        var res = await fetch(appUrl + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shop:          shop,
            customerId:    custId,
            customerEmail: custEmail,
            customerName:  custName,
            message:       text,
            history:       history.slice(-8),
          }),
        });
        var data = await res.json();
        hideTyping();

        if (data.reply) {
          addMsg('ai', data.reply);
          history.push({ role: 'user',      content: text       });
          history.push({ role: 'assistant', content: data.reply });
        } else {
          addMsg('ai', data.error || 'Sorry, I couldn\'t process that. Please try again.');
        }
      } catch (err) {
        hideTyping();
        addMsg('ai', 'Network error. Please check your connection and try again.');
      }

      sendBtn.disabled = false;
      input.focus();
    }

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });

    // Show unread dot after 3 seconds if panel is closed
    setTimeout(function () {
      if (!isOpen && unreadDot) unreadDot.style.display = 'flex';
    }, 3000);
  });
})();
