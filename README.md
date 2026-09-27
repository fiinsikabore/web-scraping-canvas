# Canvas Travaux Scraper

A web scraping project: it reads our Canvas **Travaux** page (saved as `canvas.html`) with **JavaScript + jQuery** and rebuilds it as a responsive, iOS-widget style page.

![Preview](preview.png)

## Features
- Shows every task with its **name, type, due date, availability, score and status**
- Sorts tasks into **Active**, **Past** and **Graded**
- **Description** panel for each task
- **Search**, **filters**, and a **Par date / Par type** view
- **Export to CSV**
- **Responsive:** works on laptop and phone

## Files
| File | Role |
|---|---|
| `index.html` | Page structure |
| `style.css` | Design (Helvetica Bold, warm palette, widgets) |
| `script.js` | 1. Scraping · 2. Display · 3. Events |
| `canvas.html` | The saved Canvas page, which is the data being scraped (personal info removed) |

## How it works
1. `$.get('canvas.html')` loads the saved page.
2. `scrapePage()` finds the data with jQuery selectors, for example:
   - `.ig-row` → one task
   - `.ig-title` → name
   - `.score-display` → score
   - `.assignment-date-due time` → due date
3. Rules:
   - **Past** = Canvas says "Fermé" or the due date has passed; otherwise **Active**.
   - **Graded** = the task has a score.
4. `showWidgets()` and `showTasks()` build the page. Clicks and search are handled with jQuery `.on()`.

## Error handling
- **File:** it can't be loaded, it's empty, or it's the wrong page → a message is shown.
- **Data:** an empty name, a score that is not a number or is negative, unreadable characters, or a bad date → the value is skipped and listed under "data warnings".

## Run it
Open the folder in **VS Code** → right-click `index.html` → **Open with Live Server**.
(If you open it by double-click instead, the page asks you to choose `canvas.html`.)

## Author
**Fiinsi Kabore**, Software Engineering, African Leadership University
