# AI Chat / Projects Exporter

AI Chat / Projects Exporter is a local-first browser extension for exporting AI chat conversations from ChatGPT, and Claude. Including the Canvas / Documents.

[![Firefox Addon](firefox-get-the-addon.svg)](https://addons.mozilla.org/en-US/firefox/addon/ai-chat-project-exporter/)

> Note: This project were built entirely with AI as proof of concept, but it works.

> Note2: I didnt publish to Chrome Store, if needed, just run clone the project and run `pnpm i; pnpm build; pnpm zip` and in the `.output` folder, drag-and-drop the `.zip` into chrome extension view, with `Developer Mode` enabled.

## Implemention

- Use JSON responses rather than using DOM to retrieve content, to prevent content from not being included, when from different models or AI functionality, like Canvas.
- Export to Markdown or HTML.
- It may use an additional tab when exporting entire projects. You will see status indicator on the popup or float button.

## Why I built the extension

- I found many issues after trying out the best options available, at least in Firefox, where they would not contain / extract all the content, like canvas or some outputs from bigger models.
- There was no way to pre-set a specific path to save files, the options required multiple clicks to extract a single chat.
- I noticed that most of the problems were due to the other extensions using CSS Selectors / DOM to extract information.
- They didnt include relevant information in extracted file. some showed as popup on each extraction instead.
- I needed this kind of tool for information extraction.

## Privacy Guarantees

This extension does NOT store, upload, or share any data remotely.

It does NOT store any personal or private or identifiable data.

All exported content is generated and saved locally on the user's machine, or copied to the user's clipboard.

The extension only stores local configuration needed for usability.

## Supported platforms

- ChatGPT (incl projects)
- Claude (incl projects)
- Gemini (not supported)

## Future (Maybe)

- I may consider adding per input/output selection, so, the user can select only the ones it would want, to exclude bad ones.
  - By default, all questions + answers selected.
  - Could be a modal after clicking on "Select content to export" from Export button
  - If so, each would contain a small summarized part of each question + answer.
  - The modal could also contain a Select All or None
  - Each would question + answer would have a checkbox.
