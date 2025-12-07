---
id: 56eaee0b-a625-4de1-9075-099eb732dd97
title: AI SDK OpenAI provider - image input support
tags: [ai-sdk, openai, multimodal, docs]
files: []
createdAt: 2025-12-07T01:44:30.241Z
updatedAt: 2025-12-07T01:44:30.241Z
---

## Summary
The OpenAI provider in the AI SDK (v5 docs, OpenAI provider page) explains that the Responses and Chat APIs accept multimodal prompts containing images when the target model supports vision (for example GPT-5/GPT-4o-class models).

## Sending image content
- Build messages with `content` arrays that mix `{ type: 'text', text: '...' }` and `{ type: 'image', image: ... }` blocks.
- The `image` field accepts:
  * Raw binary (`Buffer`/`Uint8Array`) read from disk, e.g. `fs.readFileSync('./data/image.png')`.
  * An OpenAI Files API file id string (e.g. `'file-abc123'`).
  * A publicly accessible URL string.
- When referencing PDFs you must use `{ type: 'file', data: <binary|fileId|url>, mediaType: 'application/pdf' }`, but for images the `image` key is used directly.

## Example (Responses API via `generateText`)
```ts
const result = await generateText({
  model: openai('gpt-5'),
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Please describe the image.' },
        { type: 'image', image: fs.readFileSync('./data/image.png') },
      ],
    },
  ],
});
```

## Notes
- The same structure applies to chat models created with `openai.chat(...)`; they also expose an "Image Inputs" subsection with identical payload rules.
- The doc explicitly states: “The image should be passed using the `image` field.”
- File ids and URLs are interchangeable ways to point the model at remote assets without embedding raw bytes.
- Use models that advertise vision support; otherwise the request will fail.

_Source: https://ai-sdk.dev/providers/ai-sdk-providers/openai (fetched 2025-12-07 via manual download while `webFetchMarkdown` was down)._