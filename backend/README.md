# AuditFlow backend (free stack)
Express + Puppeteer + Cheerio. No paid APIs.

    npm install        # downloads Chromium for Puppeteer (free)
    npm start

    curl -X POST localhost:4000/api/audit -H "content-type: application/json" -d '{"url":"stripe.com"}'
    curl localhost:4000/api/audit/<id>      # status, step, then report

Scores come from rules in analyzer.js. Add your own rules there.
Reports are held in memory; next step is Prisma + PostgreSQL.
