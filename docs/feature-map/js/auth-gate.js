/* Cairn Feature Map — password gate
 * 前端密码门锁（不是真安全，挡住意外访客）
 * 通过后写 sessionStorage，关闭浏览器即失效
 */
(function () {
  'use strict';

  var PASS_HASH = '44e1bf76fa000538f66c8ebcc6ba509e92bac90340dedafd8f48fa2e85551607';
  var STORAGE_KEY = 'cairn_fm_auth';

  // Check existing session (sessionStorage = closes with browser/tab)
  try {
    if (sessionStorage.getItem(STORAGE_KEY) === '1') {
      return; // already authed this session
    }
  } catch (e) { /* ignore */ }

  // Clean up legacy localStorage entry from previous version
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }

  // SHA-256 via SubtleCrypto
  async function sha256Hex(str) {
    var buf = new TextEncoder().encode(str);
    var hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash))
      .map(function (b) { return b.toString(16).padStart(2, '0'); })
      .join('');
  }

  // Build gate UI
  var style = document.createElement('style');
  style.textContent =
    '#cairn-gate{position:fixed;inset:0;z-index:99999;background:#0d0d10;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
    '#cairn-gate .box{background:#17171c;border:1px solid #2a2a32;border-radius:12px;padding:32px 36px;min-width:320px;box-shadow:0 20px 60px rgba(0,0,0,.5)}' +
    '#cairn-gate h1{margin:0 0 4px;color:#e8e8ec;font-size:18px;font-weight:600;letter-spacing:.5px}' +
    '#cairn-gate p{margin:0 0 20px;color:#7a7a85;font-size:13px}' +
    '#cairn-gate input{width:100%;box-sizing:border-box;background:#0d0d10;border:1px solid #2a2a32;color:#e8e8ec;padding:10px 12px;border-radius:6px;font-size:14px;outline:none;transition:border-color .15s}' +
    '#cairn-gate input:focus{border-color:#5b8def}' +
    '#cairn-gate input.err{border-color:#e85a5a;animation:shake .35s}' +
    '#cairn-gate button{margin-top:12px;width:100%;background:#5b8def;color:#fff;border:0;border-radius:6px;padding:10px;font-size:14px;font-weight:500;cursor:pointer;transition:background .15s}' +
    '#cairn-gate button:hover{background:#4a7adb}' +
    '#cairn-gate button:disabled{background:#2a2a32;cursor:wait}' +
    '#cairn-gate .msg{margin-top:10px;font-size:12px;color:#e85a5a;min-height:16px}' +
    '@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}';
  document.head.appendChild(style);

  // Hide page until authed
  var hideStyle = document.createElement('style');
  hideStyle.id = 'cairn-gate-hide';
  hideStyle.textContent = 'body > *:not(#cairn-gate){visibility:hidden!important}';
  document.head.appendChild(hideStyle);

  function mount() {
    var gate = document.createElement('div');
    gate.id = 'cairn-gate';
    gate.innerHTML =
      '<div class="box">' +
      '<h1>Cairn Feature Map</h1>' +
      '<p>请输入访问密码</p>' +
      '<input type="password" id="cairn-gate-input" autocomplete="current-password" autofocus>' +
      '<button id="cairn-gate-btn" type="button">进入</button>' +
      '<div class="msg" id="cairn-gate-msg"></div>' +
      '</div>';
    document.body.appendChild(gate);

    var input = document.getElementById('cairn-gate-input');
    var btn = document.getElementById('cairn-gate-btn');
    var msg = document.getElementById('cairn-gate-msg');

    async function attempt() {
      var val = input.value;
      if (!val) return;
      btn.disabled = true;
      msg.textContent = '';
      try {
        var h = await sha256Hex(val);
        if (h === PASS_HASH) {
          try {
            sessionStorage.setItem(STORAGE_KEY, '1');
          } catch (e) { /* ignore */ }
          gate.remove();
          var hide = document.getElementById('cairn-gate-hide');
          if (hide) hide.remove();
        } else {
          input.classList.add('err');
          msg.textContent = '密码错误';
          btn.disabled = false;
          setTimeout(function () { input.classList.remove('err'); }, 400);
          input.select();
        }
      } catch (e) {
        msg.textContent = '校验失败：' + e.message;
        btn.disabled = false;
      }
    }

    btn.addEventListener('click', attempt);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') attempt();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
