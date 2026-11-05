---
name: read-aloud
description: Rules for turning a PDF or another document into speech. Load it before cleaning up a document's text for text-to-speech and before generating audio from it.
---

# Documents read aloud

- Text pulled from a PDF or another document for text-to-speech keeps every heading marked as
  a heading through the cleanup, section and subsection headings included, never as a plain
  paragraph. The speech step reads each heading on its own, with about two seconds of silence
  before it where a paragraph break gets under one, and about one second after it; a chapter
  title gets a longer pause still. Before generating audio, list the headings the cleanup found
  beside the table of contents and the heading-styled lines of the source, such as all-caps or
  bold lines, and account for each one.
