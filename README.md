# AI Chat / Projects Exporter

AI Chat / Projects Exporter is a local-first browser extension for exporting AI chat conversations from ChatGPT, and Claude. Including the Canvas / Documents. Also contain selectable content.

[![Firefox Addon](firefox-get-the-addon.svg)](https://addons.mozilla.org/en-US/firefox/addon/ai-chat-project-exporter/)

> [!NOTE]
> This project were built entirely with AI as proof of concept, but it works.

> [!IMPORTANT]
> I didnt publish to Chrome Store, if needed, just clone the project and run `pnpm i; pnpm build; pnpm zip` and in the `.output` folder, drag-and-drop the `.zip` into chrome extension view, with `Developer Mode` enabled.

## Implemention

- Use JSON responses rather than using DOM to retrieve content, to prevent content from not being included, when from different models or AI functionality, like Canvas.
- Export to Markdown or HTML.
- Has selectable content option.
- It may use an additional tab when exporting entire projects. You will see status indicator on the popup or float button.

## Why I built the extension

- I found many issues after trying out the best options available, at least in Firefox, where they would not contain / extract all the content, like canvas, docuemnts, or some outputs from bigger models.
- I noticed that most of the problems were due to the other extensions using CSS Selectors / DOM to extract information.
- They didnt include relevant information in extracted file. some showed as popup on each extraction instead.
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
