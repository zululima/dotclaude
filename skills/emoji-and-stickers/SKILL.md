---
name: emoji-and-stickers
description: Emoji the user picks in an app and stickers they add by hand: search text per emoji, U+FE0F, the file table. Load before naming an emoji for the user to pick, writing any emoji, or listing files the user picks from a folder.
---

# Emoji and stickers

- An emoji the user is to pick in an app, such as one per sticker of a sticker pack, stands beside
  the shortest text, typed from the start of a word of its name, that the app's emoji search finds
  it alone by, with the full name in brackets after it, such as coll (collision), so the user types
  a few letters instead of scanning the grid for the symbol. The text is counted letter by letter
  against every emoji's names, never stopped at a whole word. The names come from the app's own
  emoji data, read from its source where the app is open source, which also shows how its search
  matches, and otherwise are the Unicode CLDR short names, called not checked in that app. Where
  nothing typed finds the emoji alone, the text that finds the fewest stands, and the reply says
  which others it shows. Every emoji a session writes takes U+FE0F after it when Unicode's
  `emoji-variation-sequences.txt` lists an emoji style for it, as for U+26AB: without it, a font
  with a plain glyph draws the emoji in the text colour, so a black circle shows white on a dark
  theme.
- A list of files the user picks from a folder, such as stickers to drag in with their emoji, is
  sorted by file name, A to Z, as Finder shows the folder. Every reply on stickers the user adds to
  an app by hand, such as a Signal pack, shows that list as a table of every sticker still to add,
  with its emoji and search text, also when the turn changed one sticker or none.
