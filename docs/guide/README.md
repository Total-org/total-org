# Total — a short user guide

Total keeps a shop's or a small business's books on your own computer: bills, purchases, money in
and out, stock, GST, and reports for your accountant. It works without the internet. No account,
no cloud: your books are a folder in your **Documents** folder (`Documents/total`).

This guide is the short version. Every screen in the app has its own help: press **?** (or the
**Help** button at the top) to read the page for the screen you are on. Words in **bold** are what
you see on screen.

## 1. Install

- **Mac** (Apple Silicon, macOS 13 or later): download Total from the website. The app is not yet
  signed by Apple, so the first launch needs one extra step — the website's
  [docs page](https://irminflow.com/docs) shows it.
- **Windows** (preview): download the installer. Windows may say **Windows protected your PC** the
  first time; choose **More info**, then **Run anyway**. Windows is a preview: it is tested
  automatically on every change but has had little use on real computers yet.

Updates: Total tells you when a new version is out and asks before it downloads anything.

## 2. Set up your business

The first screen asks a few plain questions: your language (English, हिन्दी or Hinglish — Hindi
and Hinglish are marked **beta** until a native speaker has checked them), the business name and
state, what kind of business it is, whether you are registered for GST, whether you keep stock,
and when your books start. If you were already in business, Total then asks **what you had on day
one** — cash, bank, what customers owed you, what you owed suppliers, your stock.

Coming from Tally? Say so in the setup and Total opens the Tally import afterwards.

Just looking? **Try with sample data** opens a sample shop with a few months of entries.

## 3. Two ways to use Total

- **Simple** (the default for new businesses): plain words, one task per screen. No accounting
  terms needed.
- **Full app** (for accountants): the complete double-entry books, every report and register,
  keyboard-first. See [the full app](full-app.md).

Both work on the same books. You can switch in **Settings → How Total looks**, or open any simple
screen's **Accountant view** to see the same entry in the full app.

## 4. Everyday tasks (simple)

| You want to… | Go to |
|---|---|
| Make a bill for a customer | **+ Sale** on Home (or Sell → Make a bill) |
| Record a bill from a supplier | **+ Purchase** (Buy → Record a purchase) |
| Record money that came in or went out | **+ Money in** / **+ Money out** |
| Move money between cash and bank | Money → Move money |
| Check your bank statement against the books | Money → Bank (drop the statement file) |
| Take back goods, or return goods to a supplier | Sell → Sale returns / Buy → Purchase returns |
| See who owes you, remind them | People (a person's page has **Remind**) |
| Count your stock | Stock → Count your stock |
| See how the business is doing | Reports |
| Get your GST ready to file | Taxes |
| Ask a question ("how much do customers owe?") | **Ask** (⌘J) — answered by Total itself, no internet |

After every save, a card says what was recorded, with **Undo** for a day while nothing else
depends on it, and **Print** / **Share**. Home shows what needs your attention: late customers,
GST due dates, a backup that is too old.

## 5. GST

Total prepares GSTR-1 and GSTR-3B from your bills; **you file** them on the GST portal. Taxes
shows the three figures that matter (GST on sales, credit you can use, cash to pay), the due dates
and the steps. Some tax rules in Total are not yet checked by a chartered accountant — they carry a
**Check with your CA** badge.

## 6. Keep your books safe

- Press **Back up now** at the end of the day; Home reminds you after a week. Total also backs up
  when you open the books and checks every backup can be restored.
- Copy your backups somewhere else now and then (a pen drive, a cloud folder you trust).
- **Settings → Lock and safety** (Security in the full app): a passphrase that encrypts the books on disk, sign-ins with a PIN
  for each person (owner, accountant, viewer), and a lock after a few idle minutes (⌘L locks now).
  A lost passphrase cannot be recovered.

## 7. The AI helper (optional, off by default)

Total works fully without AI. If you want, **Settings → AI helper** connects an AI service you pay
for separately (OpenAI, Gemini, a local model…). Nothing is sent until you turn it on; GSTIN, PAN
and account numbers are hidden before anything leaves; nothing it suggests is saved until you
approve it. Details: [AI and privacy](../ai-and-privacy.md).

## 8. Keys worth knowing

| Key | Does |
|---|---|
| ⌘K | Search everything / jump to any screen |
| ⌘J | Ask Total |
| ⌘↵ | Save |
| Esc | Close / go back |
| ? or ⌘/ | Help for this screen |
| ⌘L | Lock |

On Windows use **Ctrl** for ⌘.
