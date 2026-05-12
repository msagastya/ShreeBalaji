(function(){
  const PREFIX = 'sb:data:v1:';
  const LIST_TTL = 2 * 60 * 1000;
  const DETAIL_TTL = 24 * 60 * 60 * 1000;

  function key(parts){
    return PREFIX + parts.map(part => encodeURIComponent(String(part || '').trim().toLowerCase())).join(':');
  }

  function read(cacheKey, ttlMs){
    try{
      const raw = localStorage.getItem(cacheKey);
      if(!raw) return null;
      const entry = JSON.parse(raw);
      if(!entry || Date.now() - entry.savedAt > ttlMs){
        localStorage.removeItem(cacheKey);
        return null;
      }
      return entry.value;
    }catch(_){
      localStorage.removeItem(cacheKey);
      return null;
    }
  }

  function write(cacheKey, value){
    try{
      localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), value }));
    }catch(_){}
    return value;
  }

  async function cached(cacheKey, ttlMs, loader, options){
    if(!options || !options.force){
      const hit = read(cacheKey, ttlMs);
      if(hit) return hit;
    }
    return write(cacheKey, await loader());
  }

  function removeByPrefix(prefix){
    Object.keys(localStorage).forEach(itemKey => {
      if(itemKey.startsWith(prefix)) localStorage.removeItem(itemKey);
    });
  }

  window.SBDataCache = {
    listInvoices(api, options){
      return cached(key(['listInvoices']), LIST_TTL, () => api('listInvoices'), options);
    },
    invoiceSummaries(api, options){
      return cached(key(['invoiceSummaries']), LIST_TTL, () => api('invoiceSummaries'), options);
    },
    paymentLedger(api, options){
      return cached(key(['paymentLedger']), LIST_TTL, () => api('paymentLedger'), options);
    },
    reportSummary(api, options){
      return cached(key(['reportSummary']), LIST_TTL, () => api('reportSummary'), options);
    },
    listParties(api, options){
      return cached(key(['listParties']), LIST_TTL, () => api('listParties'), options);
    },
    loadInvoice(api, invoiceNo, options){
      return cached(key(['loadInvoice', invoiceNo]), DETAIL_TTL, () => api('loadInvoice', { invoiceNo }), options);
    },
    loadParty(api, name, options){
      return cached(key(['loadParty', name]), DETAIL_TTL, () => api('loadParty', { name }), options);
    },
    invalidateInvoice(invoiceNo){
      if(invoiceNo) localStorage.removeItem(key(['loadInvoice', invoiceNo]));
      localStorage.removeItem(key(['listInvoices']));
      localStorage.removeItem(key(['invoiceSummaries']));
      localStorage.removeItem(key(['paymentLedger']));
      localStorage.removeItem(key(['reportSummary']));
      localStorage.removeItem(key(['listParties']));
    },
    invalidateParty(name){
      if(name) localStorage.removeItem(key(['loadParty', name]));
      localStorage.removeItem(key(['listParties']));
    },
    clearAll(){
      removeByPrefix(PREFIX);
    }
  };
})();
