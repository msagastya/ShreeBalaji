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
      @media screen{
        body.logged-in{background:linear-gradient(135deg,#edf4f7 0%,#f7f8ef 45%,#eef3f6 100%)!important;min-height:100vh}
        .toolbar,.topbar{
          background:linear-gradient(90deg,#102433 0%,#17394a 45%,#314235 100%)!important;
          color:#fff!important;
          border:0!important;
          box-shadow:0 10px 26px rgba(15,23,42,.18)!important;
        }
        .toolbar .tb-title,.topbar .brand{
          color:#fff!important;
          font-size:14px!important;
          font-weight:800!important;
          letter-spacing:.8px!important;
          text-transform:uppercase!important;
          white-space:nowrap!important;
        }
        .toolbar a,.topbar a,.nav-link{
          color:#fff!important;
          background:rgba(255,255,255,.1)!important;
          border:1px solid rgba(255,255,255,.12)!important;
          border-radius:6px!important;
          font-weight:800!important;
          text-decoration:none!important;
          transition:background .15s ease,transform .15s ease,border-color .15s ease!important;
        }
        .toolbar a:hover,.topbar a:hover,.nav-link:hover{
          background:rgba(255,255,255,.18)!important;
          border-color:rgba(255,255,255,.25)!important;
          transform:translateY(-1px)!important;
        }
        .toolbar a.active,.topbar a.active,.nav-link.active{
          background:#d6b767!important;
          color:#102433!important;
          border-color:#d6b767!important;
          box-shadow:0 4px 12px rgba(214,183,103,.28)!important;
        }
        .db-status,.status{
          color:#e8f0f4!important;
          font-weight:700!important;
          white-space:nowrap!important;
        }
        .logout,.toolbar .logout,.topbar .logout{
          background:#263d4d!important;
          color:#fff!important;
          border:1px solid rgba(255,255,255,.14)!important;
          border-radius:6px!important;
          font-weight:800!important;
        }
        .login-screen{
          background:linear-gradient(135deg,#102433 0%,#1d5363 52%,#d6b767 100%)!important;
        }
        .login-box{
          border:0!important;
          border-radius:10px!important;
          box-shadow:0 24px 70px rgba(0,0,0,.22)!important;
        }
        .login-box button{
          background:#102433!important;
          color:#fff!important;
          border-radius:7px!important;
          font-weight:800!important;
        }
        .wrap,.container,.preview-shell,.entry-shell{
          width:100%!important;
        }
        @media (min-width: 721px){
          .wrap{max-width:1400px!important}
          .container:not(.inv){max-width:min(1400px,calc(100vw - 44px))!important}
        }
      }
      @media screen and (max-width:720px){
        .sb-progress{top:auto;bottom:0;height:4px}
        .toolbar,.topbar{
          background:linear-gradient(90deg,#102433 0%,#17394a 100%)!important;
        }
        .toolbar a,.topbar a,.nav-link{
          min-height:42px!important;
          display:flex!important;
          align-items:center!important;
          justify-content:center!important;
        }
      }
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
