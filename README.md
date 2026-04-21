# Knoxi → Calendar

Converts a Knoxi school timetable CSV export into an `.ics` file you can import into Apple Calendar, Google Calendar, or Outlook.

## Usage

1. In Knoxi, go to **Calendar** → **Export** → check **Timetable Days** → **Download CSV**
2. Upload the CSV on the site
3. Optionally rename events (e.g. remove the year-group prefix, shorten subject names)
4. Click **Download Calendar** and open the `.ics` file

## Deployment

Static site — no build step. Serve the three files (`index.html`, `style.css`, `app.js`) from any static host or web server.
