import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { APP_SOURCE } from '../lib/constants';
import { isRelevantProviderApiUrl } from '../lib/provider-url';

export default defineUnlistedScript({
  main() {
    const originalFetch = window.fetch;
    const shouldCapture = (url: string) => isRelevantProviderApiUrl(url);

    const emitCapture = (url: string, text: string) => {
      window.postMessage({ source: APP_SOURCE, type: 'RAW_CAPTURE', url, text }, '*');
    };

    const emitFetchResult = (requestId: string, url: string, ok: boolean, status: number, text: string) => {
      window.postMessage({ source: APP_SOURCE, type: 'PAGE_FETCH_RESULT', requestId, url, ok, status, text }, '*');
    };

    window.addEventListener('message', async (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== APP_SOURCE) return;
      if (data.type !== 'PAGE_FETCH_REQUEST') return;

      try {
        const response = await originalFetch(data.url, { method: 'GET', credentials: 'include', headers: { accept: 'application/json, text/plain, */*' } });
        const text = await response.text();
        emitFetchResult(data.requestId, data.url, response.ok, response.status, text);
      } catch {
        emitFetchResult(data.requestId, data.url, false, 0, '');
      }
    });

    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      try {
        const request = args[0];
        const url = typeof request === 'string' ? request : request instanceof Request ? request.url : '';
        if (!url || !shouldCapture(url)) return response;
        const clone = response.clone();
        const text = await clone.text();
        if (text.trim()) emitCapture(url, text);
      } catch {
        // ignore capture failures
      }
      return response;
    };
  },
});
