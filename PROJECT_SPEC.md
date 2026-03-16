# AIChatProj Exporter - Project Specification

Last Updated: 2026/03/12 18:41:59 BRT

## 1. Purpose

AIChatProj Exporter is a local-first browser extension that exports AI chat conversations and, where possible, project-scoped sets of conversations from ChatGPT and Claude.

The design goal is to remain simple while fixing the main reliability problems found in selector-based exporters.

## 2. Goals

### 2.1 Primary goals

- export the current chat reliably
- support project or grouped-chat export where the platform exposes enough metadata locally
- preserve complete response content, including canvas or artifact related content and the remaining non-canvas text in the same answer
- extract Markdown, then HTML from the same canonical model
- keep all processing local to the browser extension

### 2.2 Secondary goals

- maintain one shared export pipeline across all supported platforms
- minimize per-platform maintenance cost
- keep the settings and UI small

### 2.3 Non-goals

- cloud storage
- account sync
- remote processing
- local database indexing of all chats
- background crawling of all history without user action
- editing or rewriting chats

## 3. Privacy and data handling requirements

### 3.1 Hard privacy requirements

The extension must:

- not store, upload, or share any chat content remotely
- not collect analytics or telemetry
- not persist exported chat content in extension storage after export completion
- process chat content in-memory for the active export only

### 3.2 Allowed local storage

The extension may store only local configuration values such as:

- selected output format
- relative save folder

## 4. Supported platforms

- ChatGPT
- Claude

Each platform must have its own adapter module and must feed one shared canonical conversation model.

## 5. Supported export scopes

### 5.1 Chat scope

Export the currently open chat from the active tab. But may open others if project based extraction.

### 5.2 Project scope

Where the platform exposes grouped-chat metadata locally, the extension may:

1. collect project or folder name
2. collect related chat identifiers and titles
3. visit each related chat locally
4. export each chat individually
5. save outputs under a consistent folder structure

If the platform does not expose enough information, the extension must not pretend project export is available.

## 6. Supported formats

- Markdown
- HTML

Markdown is the primary target format.

## 7. Root-cause design decision

### 7.1 Problem

Selector-based extraction is fragile and may miss content when the DOM does not fully represent the underlying response.

### 7.2 Root-cause fix

The primary extraction path must use structured response data from the platform whenever available.

## 8. Architecture

```text
Injected page hook
    -> provider adapter
    -> canonical conversation builder
    -> formatter
    -> download exporter
```

### 8.1 Main modules

- provider adapters
- canonical model
- formatter layer
- export orchestrator
- settings store
- small popup and options UI

### 8.2 Provider adapters

One adapter per platform:

- `chatgpt`
- `claude`

Responsibilities:

- identify relevant platform responses
- extract message units and metadata
- normalize platform-specific fields into the canonical model

## 9. Extraction requirements

### 9.1 Primary extraction path

The extension should capture the platform's own structured response payloads and parse the relevant content from them.

### 9.2 Complete-answer requirement

If an answer contains both:

- canvas or artifact data
- additional non-canvas text

then both parts must be included in the export.

### 9.3 Project export requirement

If project export is supported on a platform, the implementation must preserve:

- project name
- chat titles
- message amount
- total characters
- export order
- stable output filenames
- datetime of each answer, if available

## 10. Formatting requirements

### 10.1 Markdown

Markdown output must preserve:

- speaker sections
- paragraphs
- headings
- code fences
- lists
- tables where feasible
- inline links
- artifact references or embedded sections where available

### 10.2 HTML

They output should be produced from the canonical model or Markdown representation, not from a second scraping path.

## 11. Save behavior requirements

### 11.1 Filename rules

The filename should include the chat title when available.

Recommended pattern:

```text
{title}_{platform}_chat-export_{yyyy}-{mm}-{dd}_{hh}-{mm}.{ext}
```

### 11.2 Folder rules

The extension may support a relative subfolder path under the browser Downloads directory.

The extension must not claim support for arbitrary absolute filesystem paths.

### 11.3 Popup rules

User options may include:

- include one-line extraction info inside the saved file
- specify relative save to file path

## 12. UI requirements

### 12.1 Toolbar control

Add a single export control near the existing chat actions.

### 12.2 Popup

Popup should stay minimal:

- if in a chat, export chat
- if in a project, export project
- output format may be in the export button

### 12.3 Options page

Options should stay minimal:

- default format
- relative downloads subfolder
- extraction info header toggle

## 13. Error handling

The extension must:

- fail clearly when a platform response cannot be parsed
- report unsupported project export rather than silently exporting partial data
- preserve partial export when possible instead of discarding the whole job

## 14. Acceptance criteria

A release is acceptable when all are true:

1. current chat export works on ChatGPT, and Claude
2. at least Markdown export is complete and stable
3. canvas or artifact related content does not cause the rest of the answer to be dropped
4. no chat content is stored or sent remotely
5. project export is either supported correctly or clearly marked unsupported per platform
6. save settings remain inside browser-supported behavior only
