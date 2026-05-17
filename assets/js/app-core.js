(function(){
  const SESSION_KEY = 'sb_auth_v2';
  const LEGACY_USER = 'sb_user';
  const LEGACY_PASS = 'sb_pass';
  const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

  function now(){
    return Date.now();
  }

  function readSession(){
    try{
      const raw = sessionStorage.getItem(SESSION_KEY);
      if(raw){
        const session = JSON.parse(raw);
        if(session && session.username && (session.password || session.sessionToken) && Number(session.expiresAt || 0) > now()){
          return session;
        }
        clearAuth();
        return null;
      }
    }catch(_){
      clearAuth();
      return null;
    }

    const username = sessionStorage.getItem(LEGACY_USER) || '';
    const password = sessionStorage.getItem(LEGACY_PASS) || '';
    if(username && password){
      const session = saveAuth(username, password);
      return session;
    }
    return null;
  }

  function getAuth(){
    const session = readSession();
    return {
      username: session?.username || '',
      password: session?.sessionToken ? '__session__' : (session?.password || ''),
      sessionToken: session?.sessionToken || '',
      role: session?.role || '',
    };
  }

  function isLoggedIn(){
    const auth = getAuth();
    return !!auth.username && !!auth.password;
  }

  function saveAuth(username, password, role, sessionToken){
    const session = {
      username: String(username || '').trim(),
      password: sessionToken ? '' : String(password || ''),
      sessionToken: String(sessionToken || ''),
      role: role || '',
      savedAt: now(),
      expiresAt: now() + DEFAULT_TTL_MS,
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    sessionStorage.setItem(LEGACY_USER, session.username);
    if(session.password) sessionStorage.setItem(LEGACY_PASS, session.password);
    else sessionStorage.removeItem(LEGACY_PASS);
    return session;
  }

  function updatePassword(password){
    const auth = getAuth();
    if(auth.username) saveAuth(auth.username, password, auth.role);
  }

  function clearAuth(){
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(LEGACY_USER);
    sessionStorage.removeItem(LEGACY_PASS);
  }

  async function api(action, payload = {}){
    const apiUrl = window.API_URL || 'https://hhtwjimbtppatyxtjemz.supabase.co/functions/v1/shreebalaji-api';
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ action, ...getAuth(), ...payload }),
    });
    const result = await response.json().catch(() => ({}));
    if(!response.ok){
      if(response.status === 401) clearAuth();
      throw new Error(result.error || 'Request failed');
    }
    return result;
  }

  function applyBodyLoginState(){
    document.body.classList.toggle('logged-in', isLoggedIn());
    document.body.classList.toggle('logged-out', !isLoggedIn());
  }

  window.SBApp = {
    api,
    getAuth,
    saveAuth,
    updatePassword,
    clearAuth,
    isLoggedIn,
    applyBodyLoginState,
  };
})();
