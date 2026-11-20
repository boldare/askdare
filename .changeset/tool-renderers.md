---
'@boldare/askdare': minor
---

Tool cards in the chat inside your page (ADR-0017). Give `Root` your components with `toolRenderers={{ find_slots: SlotList }}`, and the chat draws each tool's `ui` payload with its component under the answer, live and after a reload. A component gets `{ data, name, callId }`, typed from the tool with `ToolRendererProps<typeof findSlots>` and `import type`; `satisfies ToolRenderers<[typeof findSlots]>` checks the whole map. New primitives: `ToolResults` (parts `tool-results` and `tool-result`, with `data-ask-tool`), which `DefaultChat` places under the answer's text, and `Link`, which allows only `https`, `http` and `mailto` URLs from a payload. A tool without a component shows nothing, and a component that throws leaves out only its card. In the script-tag widget, a bot draws them when its iframe shows your own page (`embedPath` and `EmbedRoot`); askdare's own iframe page has no components to draw them with.
