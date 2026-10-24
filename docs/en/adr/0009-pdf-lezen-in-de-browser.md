# PDFs are read in the browser

_Nederlands: [0009-pdf-lezen-in-de-browser.md](../../adr/0009-pdf-lezen-in-de-browser.md)_

An annual statement as a PDF is read in the browser, with pdf.js, which only loads when you choose a PDF. Only the text per page goes to the server, which looks for the values in it (with a template per provider, or by finding amounts next to a reference date) and stores nothing. The PDF itself never leaves your device and doesn't end up in the database or the backups; what remains are the values you tick, with the file name and the page as their source.

That keeps the server without a PDF library (and the Docker image the same size), and the templates and their tests work on text, just like the samples users share (`pdftotext -layout`).

## Considered

- **Reading the PDF on the server:** the original plan in [aanbieders.md](../aanbieders.md#route-the-pdf-annual-statement). Requires uploading the whole PDF and pdf.js (or something else) in the server image, without any benefit.
- **Keeping the PDF as an attachment**, like photos of precious metal: handy as evidence in the dossier, but an annual statement is full of personal data. Could come later as the user's choice.
