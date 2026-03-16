import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { CONTENT_MATCHES } from '../lib/constants';
import {
  exportChat,
  exportProject,
  getActiveConversationData,
  getActiveProjectData,
  getRenderedChat,
  getUiContext,
  initializeController,
  setFloatingButtonVisible,
  shouldRenderFloatingButton,
} from '../features/content/controller';
import { mountFloatingUi } from '../features/content/floating-ui';
import type { RuntimeMessage } from '../lib/types';

export default defineContentScript({
  matches: [...CONTENT_MATCHES],
  runAt: 'document_start',
  main() {
    let mounted = false;
    const initPromise = initializeController();

    const mountIfNeeded = async () => {
      await initPromise;
      if (!mounted && shouldRenderFloatingButton()) {
        mounted = true;
        mountFloatingUi({
          getContext: getUiContext,
          onExportChat: async (format) => exportChat(format, 'file'),
          onCopyChat: async (format) => exportChat(format, 'clipboard'),
          onExportProject: exportProject,
        });
      }
    };

    const queueRefresh = () => { void mountIfNeeded(); };
    window.addEventListener('popstate', queueRefresh);
    window.addEventListener('hashchange', queueRefresh);
    void mountIfNeeded();

    browser.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
      if (
        message.type !== 'GET_UI_CONTEXT' &&
        message.type !== 'SET_FLOATING_VISIBILITY' &&
        message.type !== 'GET_RENDERED_CHAT' &&
        message.type !== 'GET_ACTIVE_CONVERSATION_DATA' &&
        message.type !== 'GET_ACTIVE_PROJECT_DATA' &&
        message.type !== 'EXPORT_CHAT' &&
        message.type !== 'EXPORT_PROJECT' &&
        message.type !== 'PROJECT_EXPORT_PROGRESS'
      ) {
        return undefined;
      }

      if (message.type === 'PROJECT_EXPORT_PROGRESS') {
        sendResponse({ ok: true });
        return undefined;
      }

      void (async () => {
        try {
          await initPromise;
          if (message.type === 'GET_UI_CONTEXT') {
            sendResponse(await getUiContext());
            return;
          }
          if (message.type === 'SET_FLOATING_VISIBILITY') {
            sendResponse(await setFloatingButtonVisible(message.value));
            return;
          }
          if (message.type === 'GET_RENDERED_CHAT') {
            sendResponse({ ok: true, text: await getRenderedChat(message.format) });
            return;
          }
          if (message.type === 'GET_ACTIVE_CONVERSATION_DATA') {
            sendResponse({ ok: true, conversation: await getActiveConversationData(message.allowNetworkFallback !== false) });
            return;
          }
          if (message.type === 'GET_ACTIVE_PROJECT_DATA') {
            sendResponse({ ok: true, project: await getActiveProjectData(message.allowNetworkFallback !== false) });
            return;
          }
          if (message.type === 'EXPORT_CHAT') {
            await exportChat(message.format, message.target);
            sendResponse({ ok: true });
            return;
          }
          if (message.type === 'EXPORT_PROJECT') {
            await exportProject(message.format);
            sendResponse({ ok: true });
            return;
          }
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    });
  },
});
