# AI Chat / Projects Exporter

AI Chat / Projects Exporter is a local-first browser extension for exporting AI chat conversations from ChatGPT, and Claude. Including their Canvas / Documents.

[![Firefox Addon](firefox-get-the-addon.svg)](https://addons.mozilla.org/en-US/firefox/addon/ai-chat-project-exporter/)

> [!NOTE]
> This project were built entirely with AI as proof of concept, but it works.

> [!IMPORTANT]
> I didnt publish to Chrome Store, if needed, just clone the project and run `pnpm i; pnpm build; pnpm zip` and in the `.output` folder, drag-and-drop the `.zip` into chrome extension view, with `Developer Mode` enabled.

## Implemention

- Uses JSON responses rather than the DOM to retrieve content, to prevent content from not being included, when from different AI models or functionality, like canvas / documents are used.
- Export to Markdown or HTML.
- Clipboard and Selectable Content options.
- Float button can be repositioned using drag-and-drop. Also shown / hidden.
- A project (only) or a single chat that contain canvas or documents (if a project, from each chat within) are exported to a single zip file.
- It may use an additional tab when exporting entire projects. You will see status indicator on the popup or float button.

## Why I built the extension

- I found many issues after trying out the better or most maintained options available, at least in Firefox, I didnt find any that would extract all the content, like canvas, documents, or some outputs from bigger models.
- I noticed that most of the problems were due to the other extensions using CSS Selectors / DOM to extract information.
- They didnt include relevant information in extracted file. Some showed as popup on each extraction instead.
- I needed this kind of tool for information extraction.

## Privacy Guarantees

This extension does NOT store, upload, or share any data remotely.

It does NOT store any personal or private or identifiable data.

All exported content is generated and saved locally on the user's machine, or copied to the user's clipboard.

The extension only stores local configuration needed for usability.

## Platforms

- ChatGPT (incl projects)
- Claude (incl projects)
- Gemini (not supported)

---

## Not planned

- All chats in account backup - However, it would be possible.
