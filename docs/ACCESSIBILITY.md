# Accessibility

KeePass Web holds the passwords to everything else you use, so if you can't get into it, you can't get into anything. Every page should work from the keyboard, with a screen reader, and with your own font size, motion and contrast settings. This page says how close we are, where we fall short, and how to tell us when something gets in your way.

## What do we aim for?

[WCAG 2.2][wcag] level AA. It's the bar we design and test against. No one outside the project has audited KeePass Web against it, so we don't claim to meet it.

## What works today?

Plain HTML does most of the work. Controls are real buttons, links and form fields. Dialogs are the browser's own modal `<dialog>`, which keeps the keyboard inside until it closes. Every page declares its language, and when a database is open, the tab names it and says whether it's locked.

From the keyboard:

- Every file picker, for a database, a key file or an attachment, is a stop on Tab, and Enter or Space opens it.
- The edges you can drag, between the groups and the entries and between table columns, also move with the arrow keys. Groups move from a menu, not by dragging.
- Showing a password leaves the caret where you were typing.
- Find (Ctrl+F or ⌘F) goes to the database search, even when focus is on the page around the app.

With a screen reader:

- Every box on the edit screen is named for what it holds, and a key file picker for its field.
- Icons are hidden, so each button is read by its own name.
- Status messages are announced once, politely. A countdown, like the clipboard's, isn't read out every second.
- The group tree says whether a group is expanded, a field's lock whether it's protected, and the tile and table buttons which view is on.
- The table's icon-only columns still have names, for table navigation.

On screen:

- Text follows your browser's default font size, and nothing blocks zoom.
- Pages follow your system's light or dark setting. A browser too old for that (before Chrome 123, Firefox 120 or Safari 17.5) gets the light palette.
- Text measures at least 4.5:1 against its background, and the edge of a text field at least 3:1, in both palettes. Status colors stay distinct under color blindness, and every status is also given in words ([#196][i196]).
- In Windows' high contrast (forced colors) mode, focus, the current group and the current view keep their marks.
- The phone drawer slides open only when your system allows motion.
- Every screen works at phone width. The group panel's smallest targets, its expand toggles and menu items, are at least 24 pixels square.

Over time:

- The clipboard clears, the screen hides and the database locks after a while. Settings lets you lengthen each: the clipboard up to 5 minutes, hiding and locking up to an hour.

## How do we check it?

With tests, like everything else. The page tests check each control's name and state, and where focus lands. The browser tests run the built pages in Chrome for what only a real browser shows: the Tab order, the names Chrome gives each control, target sizes at phone width, and the pages under reduced motion and forced colors. Every new screen is checked at phone width before it's done.

What we don't have: an automated accessibility checker in CI, or an audit by anyone outside the project.

## Contributing a change?

Every change to a page follows these rules:

- Meet WCAG 2.2 level AA.
- Reach for a native element before ARIA.
- Give every control a name, and hide icons that only decorate.
- Test the name, state and focus your change adds, in `pages/tests/` or `e2e/`.
- Check new UI at phone width, as [AGENTS.md][agents] requires.

## Where does it work?

Any modern browser with [WebCrypto][webcrypto]. The browser tests run in Chrome. The pages are in English only.

The Google Drive connector hands sign-in and file picking to Google's own popup and Picker. We can't change how accessible those are, so report a barrier there to Google.

## What doesn't work yet?

Let's be honest: there are gaps.

- There's no switch for light or dark; pages follow your system only ([#115][i115]).
- Timer settings last until you reload, because KeePass Web stores nothing. Set them again each time.

## Found a barrier?

[Open a bug report][bug]. Tell us what you were trying to do, what got in the way, your browser and OS, and the assistive technology you use, with its version. A barrier is a bug, and we treat it as one.

[wcag]: https://www.w3.org/TR/WCAG22/
[webcrypto]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API
[agents]: ../AGENTS.md
[i196]: https://github.com/keepass-web/source-application/issues/196
[i115]: https://github.com/keepass-web/source-application/issues/115
[bug]: https://github.com/keepass-web/source-application/issues/new?template=bug_report.yml
