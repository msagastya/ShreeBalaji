(function(){
  function ensure(){
    if(document.getElementById('sb-loading-style')) return;
    const style = document.createElement('style');
    style.id = 'sb-loading-style';
    style.textContent = `
      .sb-progress{position:fixed;left:0;right:0;top:0;height:3px;background:transparent;z-index:9999;overflow:hidden;pointer-events:none}
      .sb-progress::after{content:"";display:block;width:38%;height:100%;background:#d6b767;transform:translateX(-100%);opacity:0;transition:opacity .15s ease}
      .sb-busy .sb-progress::after{opacity:1;animation:sb-slide 1.05s ease-in-out infinite}
      @keyframes sb-slide{0%{transform:translateX(-100%)}55%{transform:translateX(140%)}100%{transform:translateX(260%)}}
      .sb-spinner{display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,.35);border-top-color:#d6b767;border-radius:50%;animation:sb-spin .7s linear infinite;margin-right:6px;vertical-align:-2px}
      @keyframes sb-spin{to{transform:rotate(360deg)}}
      .sb-nav-loading{opacity:.72;position:relative}
      .sb-nav-loading::after{content:"";display:inline-block;width:10px;height:10px;border:2px solid rgba(255,255,255,.38);border-top-color:#d6b767;border-radius:50%;animation:sb-spin .7s linear infinite;margin-left:7px;vertical-align:-1px}
      .skeleton{position:relative;color:transparent!important;background:#e6edf2!important;border-radius:3px;overflow:hidden}
      .skeleton::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.7),transparent);animation:sb-shimmer 1.1s infinite;transform:translateX(-100%)}
      @keyframes sb-shimmer{to{transform:translateX(100%)}}
    `;
    document.head.appendChild(style);
    const bar = document.createElement('div');
    bar.className = 'sb-progress';
    document.body.prepend(bar);
  }

  function setBusy(on, label){
    ensure();
    document.body.classList.toggle('sb-busy', !!on);
    const status = document.getElementById('db-status');
    if(status && label !== undefined){
      status.innerHTML = on ? `<span class="sb-spinner"></span>${label}` : label;
    }
  }

  function wireNavigation(){
    ensure();
    document.addEventListener('click', event => {
      const link = event.target.closest('a[href]');
      if(!link || link.target || link.href === location.href || link.href.startsWith('javascript:')) return;
      link.classList.add('sb-nav-loading');
      setBusy(true, 'Opening...');
    });
  }

  window.SBUI = { setBusy, wireNavigation };
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', wireNavigation);
  }else{
    wireNavigation();
  }
})();
